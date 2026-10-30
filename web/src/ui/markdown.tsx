// Minimal, safe markdown renderer for brain notes (no innerHTML): headings, lists, tables,
// quotes, code, bold/italic, [[wikilinks]] (clickable) and [links](url).
import type { ReactNode } from 'react';

export interface Frontmatter { tags: string[]; day: number | null; raw: Record<string, string> }

export function splitFrontmatter(src: string): { meta: Frontmatter; body: string } {
  const meta: Frontmatter = { tags: [], day: null, raw: {} };
  const text = src.replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta, body: text };
  for (const line of m[1]!.split('\n')) {
    const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!.trim();
    meta.raw[key] = value;
    if (key === 'tags') meta.tags = value.replace(/^\[|\]$/g, '').split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    if (key === 'day' && Number.isFinite(Number(value))) meta.day = Number(value);
  }
  return { meta, body: text.slice(m[0].length) };
}

/** [[Target|Alias]] → { target, label } */
function parseWiki(inner: string): { target: string; label: string } {
  const [targetRaw, alias] = inner.split('|');
  const target = (targetRaw ?? '').split('#')[0]!.trim();
  return { target, label: (alias ?? targetRaw ?? '').trim() };
}

const INLINE = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, onWiki: (t: string) => void, known: ((t: string) => boolean) | undefined, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('[[')) {
      const { target, label } = parseWiki(tok.slice(2, -2));
      const exists = known ? known(target) : true;
      out.push(
        <button key={key} type="button" className={exists ? 'wikilink' : 'wikilink wikilink-missing'} onClick={() => onWiki(target)} title={exists ? `Ouvrir « ${target} »` : `Note « ${target} » pas encore écrite`}>
          {label}
        </button>,
      );
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(<strong key={key}>{inline(tok.slice(2, -2), onWiki, known, key)}</strong>);
    } else if (tok.startsWith('`')) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = mm?.[2] ?? '';
      if (/^https?:\/\//.test(href)) out.push(<a key={key} href={href} target="_blank" rel="noreferrer">{mm?.[1]}</a>);
      else out.push(<span key={key} className="md-link">{mm?.[1] ?? tok}</span>);
    } else {
      out.push(<em key={key}>{inline(tok.slice(1, -1), onWiki, known, key)}</em>);
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function Markdown({ text, onWikiLink, isKnown }: { text: string; onWikiLink(target: string): void; isKnown?(target: string): boolean }) {
  const { body } = splitFrontmatter(text ?? '');
  const lines = body.split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let k = 0;
  const key = () => `b${k++}`;
  const flush = () => {
    if (para.length) {
      const kk = key();
      blocks.push(<p key={kk}>{inline(para.join(' '), onWikiLink, isKnown, kk)}</p>);
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) code.push(lines[i++]!);
      blocks.push(<pre key={key()} className="md-code"><code>{code.join('\n')}</code></pre>);
      continue;
    }
    if (!trimmed) { flush(); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      flush();
      const level = Math.min(4, h[1]!.length);
      const kk = key();
      const content = inline(h[2]!, onWikiLink, isKnown, kk);
      blocks.push(level === 1 ? <h1 key={kk}>{content}</h1> : level === 2 ? <h2 key={kk}>{content}</h2> : level === 3 ? <h3 key={kk}>{content}</h3> : <h4 key={kk}>{content}</h4>);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flush(); blocks.push(<hr key={key()} />); continue; }

    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1]!.trim())) {
      flush();
      const head = splitRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(splitRow(lines[i++]!));
      i--;
      const kk = key();
      blocks.push(
        <div key={kk} className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{head.map((c, ci) => <th key={ci}>{inline(c, onWikiLink, isKnown, `${kk}h${ci}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, ci) => <td key={ci}>{inline(r[ci] ?? '', onWikiLink, isKnown, `${kk}r${ri}c${ci}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const ul = /^(\s*)([-*+])\s+(.*)$/.exec(line);
    const ol = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const ordered = !ul;
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const mu = /^(\s*)([-*+])\s+(.*)$/.exec(l);
        const mo = /^(\s*)\d+[.)]\s+(.*)$/.exec(l);
        if (ordered ? !mo : !mu) break;
        const indent = (ordered ? mo![1] : mu![1])!.length;
        items.push({ depth: Math.min(3, Math.floor(indent / 2)), text: (ordered ? mo![2] : mu![3])! });
        i++;
      }
      i--;
      const kk = key();
      const children = items.map((it, ii) => {
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(it.text);
        const content = task ? task[2]! : it.text;
        return (
          <li key={ii} className={it.depth ? `md-depth-${it.depth}` : undefined}>
            {task ? <span className={task[1] === ' ' ? 'md-check' : 'md-check md-checked'} aria-hidden="true">{task[1] === ' ' ? '' : '✓'}</span> : null}
            {inline(content, onWikiLink, isKnown, `${kk}-${ii}`)}
          </li>
        );
      });
      blocks.push(ordered ? <ol key={kk}>{children}</ol> : <ul key={kk}>{children}</ul>);
      continue;
    }

    if (trimmed.startsWith('>')) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) quote.push(lines[i++]!.trim().replace(/^>\s?/, ''));
      i--;
      const kk = key();
      blocks.push(<blockquote key={kk}>{inline(quote.join(' '), onWikiLink, isKnown, kk)}</blockquote>);
      continue;
    }

    para.push(trimmed);
  }
  flush();
  return <div className="md">{blocks}</div>;
}

/** Wikilink targets of a markdown body (for client-side graphs). */
export function extractWikilinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const { target } = parseWiki(m[1]!);
    if (target) out.add(target);
  }
  return [...out];
}
