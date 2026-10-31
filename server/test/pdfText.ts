// Reads back what a PDF really prints. Embedded fonts: CID hex strings, decoded through each font's ToUnicode CMap, ligatures
// included. Standard fonts (the rescue voice): one WinAnsi byte per character.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const WIN_ANSI: Record<number, string> = { 0x80: '€', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—', 0x9c: 'œ', 0x8c: 'Œ', 0xa0: ' ' };

interface PdfObject { dict: string; stream: Buffer | null }

/** Every object of the file by number. A stream is skipped by its /Length: font bytes can spell « endobj ». */
function readObjects(buf: Buffer): Map<number, PdfObject> {
  const s = buf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  const re = /(\d+) 0 obj\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const from = m.index + m[0].length;
    const end = s.indexOf('endobj', from);
    if (end < 0) break;
    const open = />>\s*stream\r?\n/.exec(s.slice(from, Math.min(end, from + 4096)));
    if (!open) {
      objects.set(Number(m[1]), { dict: s.slice(from, end), stream: null });
      re.lastIndex = end;
      continue;
    }
    const dict = s.slice(from, from + open.index + 2);
    const start = from + open.index + open[0].length;
    const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? -1);
    const stop = length >= 0 ? start + length : s.indexOf('endstream', start);
    let stream: Buffer = buf.subarray(start, stop);
    if (/\/FlateDecode/.test(dict)) { try { stream = inflateSync(stream); } catch { /* left raw */ } }
    objects.set(Number(m[1]), { dict, stream });
    re.lastIndex = stop;
  }
  return objects;
}

/** Glyph id (4 hex) → text. pdfkit writes a ligature with a space inside: `<0066 0069>`. */
function readCmap(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g)) {
      const low = parseInt(r[1]!, 16);
      const items = [...r[3]!.matchAll(/<([0-9a-fA-F ]*)>/g)].map((x) => x[1]!.replace(/ /g, ''));
      items.forEach((hex, i) => out.set((low + i).toString(16).padStart(r[1]!.length, '0'), String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)))));
    }
  }
  return out;
}

const fontDictOf = (page: PdfObject, objects: Map<number, PdfObject>): string => {
  const inline = /\/Font\s*<<([\s\S]*?)>>/.exec(page.dict)?.[1];
  if (inline !== undefined) return inline;
  const resources = /\/Resources\s+(\d+) 0 R/.exec(page.dict);
  return resources ? /\/Font\s*<<([\s\S]*?)>>/.exec(objects.get(Number(resources[1]))?.dict ?? '')?.[1] ?? '' : '';
};

function pagesOf(objects: Map<number, PdfObject>): PdfObject[] {
  const root = [...objects.values()].find((o) => /\/Type\s*\/Pages\b/.test(o.dict));
  const kids = /\/Kids\s*\[([^\]]*)\]/.exec(root?.dict ?? '')?.[1] ?? '';
  return [...kids.matchAll(/(\d+) 0 R/g)].map((k) => objects.get(Number(k[1]))!);
}

const contentOf = (page: PdfObject, objects: Map<number, PdfObject>): string =>
  objects.get(Number(/\/Contents\s+(\d+) 0 R/.exec(page.dict)?.[1]))?.stream?.toString('latin1') ?? '';

/** What each page really draws, inflated: for what the text alone cannot show. */
export function pdfPageStreams(file: string): string[] {
  const objects = readObjects(readFileSync(file));
  return pagesOf(objects).map((page) => contentOf(page, objects));
}

/** Text of each page, in page order and drawing order. */
export function pdfPagesText(file: string): string[] {
  const objects = readObjects(readFileSync(file));
  return pagesOf(objects).map((page) => {
    const fonts = new Map<string, Map<string, string>>();
    for (const f of fontDictOf(page, objects).matchAll(/\/(F\d+)\s+(\d+) 0 R/g)) {
      const unicode = /\/ToUnicode\s+(\d+) 0 R/.exec(objects.get(Number(f[2]))?.dict ?? '');
      if (unicode) fonts.set(f[1]!, readCmap(objects.get(Number(unicode[1]))?.stream?.toString('latin1') ?? ''));
    }
    const text = contentOf(page, objects);
    let cmap: Map<string, string> | undefined;
    const parts: string[] = [];
    for (const t of text.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf|\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
      if (t[1]) { cmap = fonts.get(t[1]); continue; }
      const strings = t[2] !== undefined ? [...t[2].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => h[1]!) : [t[3]!];
      const current = cmap;
      parts.push(strings.map((hex) => (current
        ? (hex.match(/.{4}/g) ?? []).map((g) => current.get(g) ?? '?').join('')
        : (hex.match(/../g) ?? []).map((b) => WIN_ANSI[parseInt(b, 16)] ?? String.fromCharCode(parseInt(b, 16))).join(''))).join(''));
    }
    return parts.join(' ').replace(/\s+/g, ' ');
  });
}
