/** BrainVault: the run's Obsidian-style markdown vault (runs/<runId>/brain), with an in-memory search index. */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { BrainNote, BrainVault, RunPaths } from '../contracts.js';
import { seedBrainDir } from '../core/index.js';
import { basenameOf, extractWikilinks, parseNote, serializeNote, stripWikilinks, type ParsedNote } from './markdown.js';
import { fold, foldSameLength, safeFileName, tokenize } from './text.js';

/** Folders every run vault has (git does not keep the empty ones of the seed). */
export const VAULT_FOLDERS = ['lecons', 'journal', 'niches', 'produits', 'post-mortems', 'playbooks', 'rh'] as const;

const CACHE_TTL_MS = 60_000;   // safety net for writers outside this process; writes here update the index directly, and a rebuild reads every note
const EXCERPT_RADIUS = 160;

interface IndexedNote extends BrainNote {
  extra: Record<string, string>;
  titleTokens: Set<string>;
  tagTokens: Set<string>;
  tf: Map<string, number>;
  len: number;
}

interface VaultIndex {
  builtAt: number;
  notes: Map<string, IndexedNote>;
  df: Map<string, number>;
  totalLen: number;
}

/** Shared per vault root so several BrainVault instances (runtime, API) see each other's writes. */
const caches = new Map<string, VaultIndex>();
const building = new Map<string, Promise<VaultIndex>>();
const locks = new Map<string, Promise<void>>();

/** Vault-relative, forward-slash, Windows-safe note path ending in ".md" (no traversal possible). */
export function normalizeNotePath(path: string): string {
  const s = String(path ?? '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^[a-zA-Z]:/, '')
    .replace(/^\/+/, '');
  const segs = s.split('/').map((x) => x.trim()).filter((x) => x && x !== '.' && x !== '..');
  if (segs.length === 0) segs.push('note');
  segs[segs.length - 1] = segs[segs.length - 1]!.replace(/\.md$/i, '');
  return `${segs.map((seg) => safeFileName(seg)).join('/')}.md`;
}

function indexNote(path: string, p: ParsedNote): IndexedNote {
  const tf = new Map<string, number>();
  const bodyTokens = tokenize(stripWikilinks(p.body));
  for (const t of bodyTokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return {
    path,
    title: p.title,
    tags: p.tags,
    body: p.body,
    links: p.links,
    updatedDay: p.day,
    extra: p.extra,
    titleTokens: new Set(tokenize(p.title)),
    tagTokens: new Set(p.tags.flatMap((t) => tokenize(t.replace(/[-_/]/g, ' ')))),
    tf,
    len: bodyTokens.length,
  };
}

function docTerms(n: IndexedNote): Set<string> {
  return new Set([...n.tf.keys(), ...n.titleTokens, ...n.tagTokens]);
}

function addToIndex(idx: VaultIndex, n: IndexedNote): void {
  const old = idx.notes.get(n.path);
  if (old) {
    for (const t of docTerms(old)) {
      const v = (idx.df.get(t) ?? 1) - 1;
      if (v <= 0) idx.df.delete(t);
      else idx.df.set(t, v);
    }
    idx.totalLen -= old.len;
  }
  idx.notes.set(n.path, n);
  for (const t of docTerms(n)) idx.df.set(t, (idx.df.get(t) ?? 0) + 1);
  idx.totalLen += n.len;
}

function removeFromIndex(idx: VaultIndex, path: string): void {
  const old = idx.notes.get(path);
  if (!old) return;
  for (const t of docTerms(old)) {
    const v = (idx.df.get(t) ?? 1) - 1;
    if (v <= 0) idx.df.delete(t);
    else idx.df.set(t, v);
  }
  idx.totalLen -= old.len;
  idx.notes.delete(path);
}

function toBrainNote(n: IndexedNote): BrainNote {
  return { path: n.path, title: n.title, tags: [...n.tags], body: n.body, links: [...n.links], updatedDay: n.updatedDay };
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // .obsidian, .trash…
    const abs = join(dir, e.name);
    if (e.isDirectory()) await walk(root, abs, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(relative(root, abs).split(sep).join('/'));
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Windows: antivirus / Obsidian can briefly lock a file. */
async function writeWithRetry(abs: string, content: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 4 || !(code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')) throw err;
      await sleep(25 * (attempt + 1));
    }
  }
}

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  locks.set(key, chained);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}

/** Best excerpt: ±160 chars around the body position that gathers the most distinct query terms. */
function makeExcerpt(body: string, qTokens: string[]): string {
  const plain = stripWikilinks(body)
    .replace(/^---$/gm, ' ')
    .replace(/[#*>|`_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  const folded = foldSameLength(plain);
  const hits: { pos: number; tok: number }[] = [];
  qTokens.forEach((t, i) => {
    const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
    for (const m of folded.matchAll(re)) hits.push({ pos: (m.index ?? 0) + m[1]!.length, tok: i });
  });
  let center = -1;
  let best = 0;
  for (const h of hits) {
    const near = new Set(hits.filter((o) => Math.abs(o.pos - h.pos) <= EXCERPT_RADIUS).map((o) => o.tok)).size;
    if (near > best || (near === best && center >= 0 && h.pos < center)) {
      best = near;
      center = h.pos;
    }
  }
  if (center < 0) return plain.length > EXCERPT_RADIUS * 2 ? `${plain.slice(0, EXCERPT_RADIUS * 2).replace(/\s+\S*$/, '')}…` : plain;
  let start = Math.max(0, center - EXCERPT_RADIUS);
  let end = Math.min(plain.length, center + EXCERPT_RADIUS);
  if (start > 0) {
    const sp = plain.indexOf(' ', start);
    if (sp > 0 && sp < center) start = sp + 1;
  }
  if (end < plain.length) {
    const sp = plain.lastIndexOf(' ', end);
    if (sp > center) end = sp;
  }
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`;
}

const DAY_NOTE = /^jour-(\d+)\.md$/;

/**
 * Daily journals older than `keepDays` merge into journal/mois-NN.md (scale §7.2): a year of them weighs more than the rest of the
 * brain, and a search reads them all. Nothing is lost, and a merge that stopped midway finishes at the next pass.
 */
export async function mergeJournals(paths: RunPaths, day: number, keepDays: number): Promise<number> {
  const dir = join(resolve(paths.brain), 'journal');
  const names = await readdir(dir).catch(() => [] as string[]);
  const months = new Map<number, { name: string; n: number }[]>();
  for (const name of names) {
    const n = Number(DAY_NOTE.exec(name)?.[1] ?? 0);
    if (!n || day - n < keepDays) continue;
    const month = Math.ceil(n / 30);
    months.set(month, [...(months.get(month) ?? []), { name, n }]);
  }
  const vault = createBrainVault(paths);
  const root = resolve(paths.brain);
  let merged = 0;
  for (const [month, notes] of [...months].sort((a, b) => a[0] - b[0])) {
    const path = `journal/mois-${String(month).padStart(2, '0')}.md`;
    const days = notes.sort((a, b) => a.n - b.n);
    const texts = await Promise.all(days.map(async ({ name, n }) => `## Jour ${n}\n\n${parseNote(await readFile(join(dir, name), 'utf8'), name).body.trim()}`));
    await vault.append(path, texts.join('\n\n'), day);
    for (const { name } of days) {
      await rm(join(dir, name), { force: true });
      const idx = caches.get(process.platform === 'win32' ? root.toLowerCase() : root);
      if (idx) removeFromIndex(idx, `journal/${name}`);
      merged++;
    }
  }
  return merged;
}

export function createBrainVault(paths: RunPaths): BrainVault {
  const root = resolve(paths.brain);
  const cacheKey = process.platform === 'win32' ? root.toLowerCase() : root;

  function absOf(notePath: string): string {
    const abs = resolve(root, ...notePath.split('/'));
    if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`Chemin hors du cerveau : ${notePath}`);
    return abs;
  }

  function invalidate(): void {
    caches.delete(cacheKey);
  }

  async function build(): Promise<VaultIndex> {
    const files: string[] = [];
    await walk(root, root, files);
    const idx: VaultIndex = { builtAt: Date.now(), notes: new Map(), df: new Map(), totalLen: 0 };
    const parsed = await Promise.all(
      files.map(async (p) => {
        try {
          return { p, n: parseNote(await readFile(join(root, ...p.split('/')), 'utf8'), p) };
        } catch {
          return null;
        }
      }),
    );
    for (const item of parsed) if (item) addToIndex(idx, indexNote(item.p, item.n));
    return idx;
  }

  async function getIndex(): Promise<VaultIndex> {
    const cached = caches.get(cacheKey);
    if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached;
    let pending = building.get(cacheKey);
    if (!pending) {
      pending = build().finally(() => building.delete(cacheKey));
      building.set(cacheKey, pending);
    }
    const idx = await pending;
    caches.set(cacheKey, idx);
    return idx;
  }

  /** Keeps the shared index in sync after a write made through this API. */
  function updateIndex(path: string, parsed: ParsedNote): void {
    const idx = caches.get(cacheKey);
    if (idx) addToIndex(idx, indexNote(path, parsed));
  }

  async function readParsed(notePath: string): Promise<ParsedNote | null> {
    try {
      return parseNote(await readFile(absOf(notePath), 'utf8'), notePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR') return null;
      throw err;
    }
  }

  /** Obsidian-style resolution of a link target / loose path: exact path, then basename, then title. */
  function resolveTarget(idx: VaultIndex, target: string): IndexedNote | undefined {
    const raw = target.replace(/\\/g, '/').replace(/\.md$/i, '').trim();
    if (!raw) return undefined;
    const exact = idx.notes.get(`${raw}.md`) ?? idx.notes.get(normalizeNotePath(raw));
    if (exact) return exact;
    const key = fold(raw);
    const all = [...idx.notes.values()];
    if (raw.includes('/')) {
      const byPath = all.find((n) => fold(n.path.replace(/\.md$/i, '')) === key || fold(n.path.replace(/\.md$/i, '')).endsWith(`/${key}`));
      if (byPath) return byPath;
    }
    const base = fold(basenameOf(raw));
    return all.find((n) => fold(basenameOf(n.path)) === base) ?? all.find((n) => fold(n.title) === base);
  }

  return {
    async init(): Promise<void> {
      let empty = true;
      try {
        empty = (await readdir(root)).filter((n) => !n.startsWith('.')).length === 0;
      } catch {
        empty = true;
      }
      if (empty) {
        await mkdir(root, { recursive: true });
        const seed = seedBrainDir();
        let seedOk = false;
        try {
          seedOk = (await stat(seed)).isDirectory();
        } catch {
          seedOk = false;
        }
        if (seedOk) await cp(seed, root, { recursive: true, force: false, errorOnExist: false });
        else {
          await writeWithRetry(
            join(root, '00 - Accueil.md'),
            serializeNote({
              title: "Cerveau de l'agence",
              tags: ['index', 'cerveau'],
              day: 0,
              body: "Chaque agent lit le cerveau avant d'agir et l'alimente après chaque action.",
            }),
          );
        }
      }
      for (const f of VAULT_FOLDERS) await mkdir(join(root, f), { recursive: true });
      invalidate();
    },

    async list(): Promise<BrainNote[]> {
      const idx = await getIndex();
      return [...idx.notes.values()].sort((a, b) => a.path.localeCompare(b.path, 'fr')).map(toBrainNote);
    },

    async read(path: string): Promise<BrainNote | null> {
      const notePath = normalizeNotePath(path);
      const parsed = await readParsed(notePath);
      if (parsed) {
        return { path: notePath, title: parsed.title, tags: parsed.tags, body: parsed.body, links: parsed.links, updatedDay: parsed.day };
      }
      // a bare link target ("Prix", "Sommeil bébé") resolves Obsidian-style; an explicit folder path stays exact,
      // so read() remains a reliable existence check before append()
      const raw = String(path ?? '');
      if (/[\\/]/.test(raw)) return null;
      const hit = resolveTarget(await getIndex(), raw);
      return hit ? toBrainNote(hit) : null;
    },

    async search(query: string, limit = 5): Promise<{ path: string; title: string; excerpt: string; score: number }[]> {
      const qTokens = [...new Set(tokenize(query))];
      if (qTokens.length === 0 || limit <= 0) return [];
      const idx = await getIndex();
      const N = idx.notes.size;
      if (N === 0) return [];
      const avgLen = Math.max(1, idx.totalLen / N);
      let maxDay = 0;
      for (const n of idx.notes.values()) maxDay = Math.max(maxDay, n.updatedDay);
      const k1 = 1.2;
      const b = 0.5;
      const scored: { note: IndexedNote; score: number }[] = [];
      for (const note of idx.notes.values()) {
        let score = 0;
        for (const q of qTokens) {
          const df = idx.df.get(q) ?? 0;
          if (df === 0) continue;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          const count = note.tf.get(q) ?? 0;
          const tf = count > 0 ? (count * (k1 + 1)) / (count + k1 * (1 - b + (b * note.len) / avgLen)) : 0;
          score += idf * ((note.titleTokens.has(q) ? 3 : 0) + (note.tagTokens.has(q) ? 2 : 0) + tf);
        }
        if (score <= 0) continue;
        if (maxDay > 0) score *= 1 + 0.15 * (note.updatedDay / maxDay); // small recency boost
        scored.push({ note, score });
      }
      scored.sort((a, b2) => b2.score - a.score || b2.note.updatedDay - a.note.updatedDay || a.note.path.localeCompare(b2.note.path));
      return scored.slice(0, Math.floor(limit)).map(({ note, score }) => ({
        path: note.path,
        title: note.title,
        excerpt: makeExcerpt(note.body, qTokens),
        score: Math.round(score * 1000) / 1000,
      }));
    },

    async write(note: { path: string; title: string; tags: string[]; body: string; day: number }): Promise<void> {
      const notePath = normalizeNotePath(note.path);
      const abs = absOf(notePath);
      await withLock(abs.toLowerCase(), async () => {
        const content = serializeNote({ title: note.title, tags: note.tags ?? [], day: note.day, body: note.body ?? '' });
        await writeWithRetry(abs, content);
        updateIndex(notePath, parseNote(content, notePath));
      });
    },

    async append(path: string, text: string, day: number): Promise<void> {
      const notePath = normalizeNotePath(path);
      const abs = absOf(notePath);
      await withLock(abs.toLowerCase(), async () => {
        const existing = await readParsed(notePath);
        const addition = String(text ?? '').replace(/\r\n?/g, '\n').trim();
        const content = existing
          ? serializeNote({
              title: existing.title,
              tags: existing.tags,
              day: Math.max(existing.day, Math.floor(Number(day) || 0)),
              body: addition ? `${existing.body.trimEnd()}\n\n${addition}` : existing.body,
              extra: existing.extra,
            })
          : serializeNote({ title: basenameOf(notePath), tags: [], day, body: addition });
        await writeWithRetry(abs, content);
        updateIndex(notePath, parseNote(content, notePath));
      });
    },

    async graph(): Promise<{ nodes: { id: string; title: string; group: string }[]; edges: { from: string; to: string }[] }> {
      const idx = await getIndex();
      const notes = [...idx.notes.values()].sort((a, b) => a.path.localeCompare(b.path, 'fr'));
      const nodes = notes.map((n) => ({ id: n.path, title: n.title, group: n.path.includes('/') ? n.path.split('/')[0]! : 'racine' }));
      const edges: { from: string; to: string }[] = [];
      const seen = new Set<string>();
      const memo = new Map<string, IndexedNote | undefined>();
      for (const n of notes) {
        for (const target of n.links.length ? n.links : extractWikilinks(n.body)) {
          if (!memo.has(target)) memo.set(target, resolveTarget(idx, target));
          const to = memo.get(target);
          if (!to || to.path === n.path) continue;
          const key = `${n.path}\u0000${to.path}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({ from: n.path, to: to.path });
        }
      }
      return { nodes, edges };
    },
  };
}
