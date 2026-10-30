/**
 * Shape guards: every value leaving the minds is complete and correctly typed, whatever the
 * source (a Claude JSON reply, a hand-edited outline, a half-filled content object).
 * `fb` is the heuristic value used to fill whatever is missing or invalid.
 */
import type { ChapterContent, GridSpec, PdfContent, VisualSpec } from '../shared.js';
import { clampNum, clean, isStr, strArr } from './util.js';

export const VISUAL_TYPES: readonly VisualSpec['type'][] = ['timeline', 'bar_chart', 'checklist_card', 'quote', 'steps_diagram', 'icon_grid', 'do_dont', 'grid'];

/** "La suite est ici : X" → "X" (the label belongs to the layout, not to the title). */
export function stripNextPrefix(s: string): string {
  return clean(s).replace(/^(?:la\s+suite\s+est\s+ici\s*(?:[:—–-]\s*)?|la\s+suite\s*[:—–-]\s*)/i, '').trim();
}

export function str(v: unknown, fb: string): string {
  return isStr(v) ? clean(v) : fb;
}

export function arr(v: unknown, fb: string[], min = 1, max = 50): string[] {
  const a = strArr(v).slice(0, max);
  return a.length >= min ? a : fb.slice(0, max);
}

export function ensureVisual(v: unknown, fb: VisualSpec | null): VisualSpec | null {
  if (!v || typeof v !== 'object') return fb;
  const o = v as Record<string, unknown>;
  const type = VISUAL_TYPES.includes(o.type as VisualSpec['type']) ? (o.type as VisualSpec['type']) : null;
  if (!type) return fb;
  if (type === 'grid') {
    const grid = ensureGrid(o.grid);
    return grid ? { type, title: str(o.title, fb?.title ?? 'À remplir'), labels: [], values: [], grid } : fb;
  }
  const labels = strArr(o.labels).slice(0, 8);
  if (labels.length === 0) return fb;
  const raw = Array.isArray(o.values) ? o.values : [];
  // a chart without its numbers stays a list: a value is never made up to fill a bar
  const measured = type === 'bar_chart' && labels.every((_, i) => typeof raw[i] === 'number' && Number.isFinite(raw[i]));
  if (type === 'bar_chart' && !measured) return { type: 'icon_grid', title: str(o.title, fb?.title ?? 'Repères'), labels, values: [] };
  const values = measured ? labels.map((_, i) => Math.round(clampNum(raw[i], 0, 100, 0))) : [];
  return { type, title: str(o.title, fb?.title ?? 'Repères'), labels: conventionLabels(type, labels), values };
}

/** A fillable table needs at least two columns and one row; cells are text or empty, nothing else. */
export function ensureGrid(v: unknown): GridSpec | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const columns = strArr(o.columns);
  const rows = Array.isArray(o.rows) ? o.rows.map((r) => (typeof r === 'string' ? clean(r) : '')) : [];
  if (columns.length < 2 || rows.length === 0) return null;
  const cells = Array.isArray(o.cells) ? o.cells.slice(0, rows.length).map((row) => (Array.isArray(row) ? row.slice(0, columns.length - 1).map((x) => (isStr(x) ? clean(x) : null)) : [])) : null;
  return { columns, rows, ...(cells ? { cells } : {}) };
}

const DO_RE = /^\s*(?:à|a)\s+faire\s*:\s*/iu;
const DONT_RE = /^\s*(?:à|a)\s+éviter\s*:\s*|^\s*a\s+eviter\s*:\s*/iu;
const DO_LOOSE = /^\s*(?:[+✓✔✅]\s*|(?:faire|do|oui|bon réflexe|à privilégier)\s*[:–—-]\s*)/iu;
const DONT_LOOSE = /^\s*(?:[-✗✘❌×]\s*|(?:éviter|eviter|don'?t|non|mauvais réflexe|erreur)\s*[:–—-]\s*)/iu;

function lowerHead(s: string): string {
  const t = clean(s);
  const first = t.split(/\s+/)[0] ?? '';
  return /^\p{Lu}.*\p{Lu}/u.test(first) ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

/**
 * VisualSpec label conventions (shared/types.ts): do_dont labels are prefixed « À faire : » /
 * « À éviter : » (unprefixed lists are read as « à éviter » first, then « à faire »); a quote is
 * [citation, attribution] without surrounding guillemets.
 */
export function conventionLabels(type: VisualSpec['type'], labels: string[]): string[] {
  if (type === 'do_dont') {
    const tagged = labels.map((l) => {
      if (DO_RE.test(l)) return { kind: 'do' as const, text: l.replace(DO_RE, '') };
      if (DONT_RE.test(l)) return { kind: 'dont' as const, text: l.replace(DONT_RE, '') };
      if (DONT_LOOSE.test(l) || /^\s*(ne pas|ne jamais|jamais|surtout pas)\b/i.test(l)) return { kind: 'dont' as const, text: l.replace(DONT_LOOSE, '') };
      if (DO_LOOSE.test(l)) return { kind: 'do' as const, text: l.replace(DO_LOOSE, '') };
      return { kind: null, text: l };
    });
    const loose = tagged.filter((t) => t.kind === null);
    const half = Math.ceil(loose.length / 2);
    let k = 0;
    return tagged.map((t) => {
      const kind = t.kind ?? (k++ < half ? 'dont' : 'do');
      return `${kind === 'do' ? 'À faire' : 'À éviter'} : ${lowerHead(t.text)}`;
    }).filter((l) => !/:\s*$/.test(l));
  }
  if (type === 'quote') {
    const [quote, ...rest] = labels;
    return [clean(quote ?? '').replace(/^[«"“]\s*/, '').replace(/\s*[»"”]$/, ''), ...rest].filter(Boolean);
  }
  return labels;
}

export function ensureChapter(v: unknown, fb: ChapterContent): ChapterContent {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const steps = arr(o.steps, fb.steps, 3, 8);
  return {
    title: str(o.title, fb.title),
    intro: str(o.intro, fb.intro),
    paragraphs: arr(o.paragraphs, fb.paragraphs, 1, 9),
    steps: steps.length >= 3 ? steps : fb.steps,
    example: o.example === null ? (fb.example ?? null) : str(o.example, fb.example ?? '') || null,
    checklist: arr(o.checklist, fb.checklist, 2, 8),
    visual: ensureVisual(o.visual, fb.visual),
  };
}

const EMPTY_CHAPTER: ChapterContent = { title: 'Chapitre', intro: '', paragraphs: [], steps: [], example: null, checklist: [], visual: null };

/** Make any (possibly partial) content safe to iterate. `fb` fills the gaps when given. */
export function ensurePdf(v: unknown, fb?: PdfContent): PdfContent {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const f: PdfContent = fb ?? {
    title: 'Guide', subtitle: '', audience: '', promise: '', introduction: [], chapters: [], bonus: EMPTY_CHAPTER,
    nextStep: { title: 'La suite est ici', text: '', upsellProductId: null }, wordCount: 0,
  };
  const rawCh = Array.isArray(o.chapters) ? o.chapters : [];
  const chapters = rawCh.length >= (fb ? 5 : 0)
    ? rawCh.slice(0, 7).map((c, i) => ensureChapter(c, f.chapters[i] ?? f.chapters[f.chapters.length - 1] ?? EMPTY_CHAPTER))
    : f.chapters;
  const ns = (o.nextStep && typeof o.nextStep === 'object' ? o.nextStep : {}) as Record<string, unknown>;
  return {
    title: str(o.title, f.title),
    subtitle: str(o.subtitle, f.subtitle),
    audience: str(o.audience, f.audience),
    promise: str(o.promise, f.promise),
    introduction: arr(o.introduction, f.introduction, fb ? 2 : 0, 8),
    chapters,
    bonus: ensureChapter(o.bonus, f.bonus),
    nextStep: {
      // the title is the NEXT guide's title: « La suite est ici » belongs to the layout (PDF page, product card)
      title: stripNextPrefix(str(ns.title, f.nextStep.title)) || stripNextPrefix(f.nextStep.title) || (str(ns.title, f.nextStep.title) ? 'Le guide suivant' : ''),
      text: str(ns.text, f.nextStep.text),
      upsellProductId: typeof ns.upsellProductId === 'string' ? ns.upsellProductId : f.nextStep.upsellProductId,
    },
    wordCount: typeof o.wordCount === 'number' ? o.wordCount : f.wordCount,
    ...(o.howTo ?? f.howTo ? { howTo: (o.howTo ?? f.howTo) as PdfContent['howTo'] } : {}),
  };
}

/** Visit every text field of a PdfContent with its French location label. */
export function forEachText(p: PdfContent, fn: (text: string, loc: string) => string): PdfContent {
  const ch = (c: ChapterContent, loc: string): ChapterContent => ({
    ...c,
    title: fn(c.title, loc),
    intro: fn(c.intro, loc),
    paragraphs: c.paragraphs.map((x) => fn(x, loc)).filter((x) => x.trim().length > 0),
    steps: c.steps.map((x) => fn(x, loc)).filter((x) => x.trim().length > 0),
    example: c.example ? fn(c.example, loc) || null : null,
    checklist: c.checklist.map((x) => fn(x, loc)).filter((x) => x.trim().length > 0),
  });
  return {
    ...p,
    title: fn(p.title, 'Titre'),
    subtitle: fn(p.subtitle, 'Sous-titre'),
    promise: fn(p.promise, 'Promesse'),
    introduction: p.introduction.map((x) => fn(x, 'Introduction')).filter((x) => x.trim().length > 0),
    chapters: p.chapters.map((c, i) => ch(c, `Chapitre ${i + 1}`)),
    bonus: ch(p.bonus, 'Bonus'),
    nextStep: { ...p.nextStep, title: fn(p.nextStep.title, 'Page « La suite »'), text: fn(p.nextStep.text, 'Page « La suite »') },
  };
}
