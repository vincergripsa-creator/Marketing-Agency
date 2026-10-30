/** Obsidian-style markdown: simple frontmatter (tags: [a, b], day: N), "# Title" heading, [[wikilinks]]. */

export interface ParsedNote {
  title: string;
  tags: string[];
  day: number;
  body: string;
  links: string[];
  /** Other frontmatter keys, kept verbatim when a note is appended to. */
  extra: Record<string, string>;
}

const WIKILINK = /\[\[([^[\]\n]+?)\]\]/g;

/** Link target of a wikilink body: "Note|alias" → "Note", "Note#Section" → "Note". */
export function linkTarget(inner: string): string {
  return inner.split('|')[0]!.split('#')[0]!.split('^')[0]!.trim();
}

export function extractWikilinks(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(text ?? '').matchAll(WIKILINK)) {
    const t = linkTarget(m[1]!);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** "[[Note|alias]]" → "alias", "[[Note]]" → "Note" (for excerpts / plain text). */
export function stripWikilinks(text: string): string {
  return String(text ?? '').replace(WIKILINK, (_m, inner: string) => {
    const parts = inner.split('|');
    return (parts[1] ?? linkTarget(inner)).trim();
  });
}

export function basenameOf(path: string): string {
  const seg = path.replace(/\\/g, '/').split('/').pop() ?? path;
  return seg.replace(/\.md$/i, '');
}

function parseTags(value: string, following: string[]): string[] {
  const v = value.trim();
  if (v.startsWith('[')) return cleanTags(v.replace(/^\[|\]$/g, '').split(','));
  if (v) return cleanTags(v.split(','));
  return cleanTags(following.map((l) => l.replace(/^\s*-\s*/, '')));
}

export function cleanTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = String(raw ?? '')
      .replace(/[[\],#"']/g, '')
      .trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function parseNote(raw: string, path: string): ParsedNote {
  let text = String(raw ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n');
  let tags: string[] = [];
  let day = 0;
  const extra: Record<string, string> = {};

  if (text.startsWith('---\n')) {
    const close = text.indexOf('\n---', 3);
    const after = close >= 0 ? text.charAt(close + 4) : '';
    if (close >= 0 && (after === '\n' || after === '')) {
      const lines = text.slice(4, close).split('\n');
      text = text.slice(close + 5);
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]!.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const key = m[1]!.toLowerCase();
        const value = m[2]!;
        if (key === 'tags') {
          const following: string[] = [];
          while (!value.trim() && i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1]!)) following.push(lines[++i]!);
          tags = parseTags(value, following);
        } else if (key === 'day') {
          const d = Number.parseInt(value, 10);
          day = Number.isFinite(d) ? d : 0;
        } else {
          extra[m[1]!] = value.trim();
        }
      }
    }
  }

  const lines = text.split('\n');
  let first = 0;
  while (first < lines.length && !lines[first]!.trim()) first++;
  let title = '';
  if (first < lines.length && /^#\s+\S/.test(lines[first]!)) {
    title = lines[first]!.replace(/^#\s+/, '').trim();
    lines.splice(0, first + 1);
  }
  const body = lines.join('\n').replace(/^\n+/, '').trimEnd();
  if (!title) title = extra.title?.trim() || basenameOf(path);
  return { title, tags, day, body, links: extractWikilinks(body), extra };
}

export function serializeNote(n: { title: string; tags: readonly string[]; day: number; body: string; extra?: Record<string, string> }): string {
  const fm = [`tags: [${cleanTags(n.tags).join(', ')}]`, `day: ${Math.max(0, Math.floor(Number(n.day) || 0))}`];
  for (const [k, v] of Object.entries(n.extra ?? {})) {
    if (k === 'tags' || k === 'day' || !/^[A-Za-z0-9_-]+$/.test(k)) continue;
    fm.push(`${k}: ${String(v).replace(/\n/g, ' ')}`);
  }
  const title = String(n.title ?? '').replace(/\s+/g, ' ').trim() || 'Note';
  const body = stripLeadingH1(String(n.body ?? '').replace(/\r\n?/g, '\n')).trim();
  return `---\n${fm.join('\n')}\n---\n# ${title}\n\n${body}\n`;
}

/** Removes a leading "# Heading" from a body so the title is never duplicated. */
export function stripLeadingH1(body: string): string {
  const lines = body.split('\n');
  let first = 0;
  while (first < lines.length && !lines[first]!.trim()) first++;
  if (first < lines.length && /^#\s+\S/.test(lines[first]!)) return lines.slice(first + 1).join('\n');
  return body;
}
