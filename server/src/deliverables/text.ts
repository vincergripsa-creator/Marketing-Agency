import PDFDocument from 'pdfkit';

/** The 14 standard PDF fonts we actually use (WinAnsi encoded, no embedding needed). */
export type StdFont =
  | 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique' | 'Helvetica-BoldOblique'
  | 'Times-Roman' | 'Times-Bold' | 'Times-Italic' | 'Times-BoldItalic'
  | 'Courier' | 'Courier-Bold' | 'Courier-Oblique';

// ───────────────────────────── escaping ─────────────────────────────

// Chars that are illegal in XML 1.0 documents (C0 controls except tab/newline/CR, lone surrogates, U+FFFE/F).
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(XML_ILLEGAL, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** HTML text/attribute escaping (same rules as XML; kept separate for readability at call sites). */
export const escapeHtml = escapeXml;

// ───────────────────────────── PDF (WinAnsi) sanitising ─────────────────────────────

// Code points outside Latin-1 that WinAnsiEncoding (and therefore pdfkit's standard fonts) can render.
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

const PDF_REPLACEMENTS: Record<string, string> = {
  '\u202f': '\u00a0', // narrow no-break space (French « ») → no-break space
  '\u2007': '\u00a0',
  '\u2060': '',
  '\u2009': ' ', '\u200a': ' ', '\u2002': ' ', '\u2003': ' ', '\u2004': ' ', '\u2005': ' ', '\u2006': ' ', '\u2008': ' ',
  '\u200b': '', '\u200c': '', '\u200d': '', '\ufeff': '', '\u00ad': '',
  '‐': '-', '‑': '-', '‒': '–', '―': '—', '−': '-', '⁃': '-',
  '′': '’', '″': '”', 'ʼ': '’', 'ʹ': '’', '‛': '’', '‟': '”',
  '․': '.', '‥': '..', '‧': '·',
  '←': '<-', '→': '->', '↔': '<->', '⇒': '=>', '➜': '->', '➡': '->', '➔': '->',
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '∞': 'infini',
  '✓': '', '✔': '', '✅': '', '✕': '', '✖': '', '✗': '', '✘': '', '❌': '',
  '★': '*', '☆': '*', '●': '•', '▪': '•', '■': '•', '‣': '•', '◦': '•', '∙': '•',
  '\u2028': '\n', '\u2029': '\n', '\t': ' ', '\r': '',
};

function winAnsiOk(cp: number): boolean {
  return cp === 0x0a || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff && cp !== 0xad) || WIN_ANSI_EXTRA.has(cp);
}

/**
 * Makes a string safe for pdfkit's standard (WinAnsi) fonts: keeps French accents, œ/Œ, « », ’, …, – —, €,
 * maps typographic look-alikes, folds other accented Latin letters to their base letter and strips emoji
 * and every other unsupported glyph (which would otherwise print as garbage).
 */
export function sanitizePdfText(value: unknown): string {
  const input = String(value ?? '').normalize('NFC');
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    if (winAnsiOk(cp)) { out += ch; continue; }
    const rep = PDF_REPLACEMENTS[ch];
    if (rep !== undefined) { out += rep; continue; }
    // ł, ă, ś, ő… → base letter when the decomposition is plain Latin.
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (base.length > 0 && [...base].every((c) => winAnsiOk(c.codePointAt(0) ?? 0))) { out += base; continue; }
    // emoji, pictographs, CJK, variation selectors, controls… → dropped
  }
  return frenchNbsp(out
    .replace(/[ \u00a0]{2,}/g, (m) => (m.includes('\u00a0') ? '\u00a0' : ' '))
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n')
    .replace(/ ([,.])/g, '$1')
    .trim());
}

/** Removes emoji / pictographs (covers and ad frames must look clean and measurable). */
export function stripEmoji(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\ufe0f\u200d\u20e3]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ───────────────────────────── French typography ─────────────────────────────

/** Collapses ordinary whitespace but keeps no-break spaces (they carry typography). */
export function collapseSpaces(value: string): string {
  return String(value ?? '').replace(/[ \t\r\n\f\v\u2000-\u200a\u2028\u2029\u3000]+/g, ' ').trim();
}

const UNIT_AFTER_NUMBER = /(\d) (?=(?:[€%]|(?:h|min|s|km|m|kg|g|ml|cl|cm|m²|°C|ans|an|mois|jours|jour|nuits|nuit|semaines|semaine|heures|heure|minutes|pages|chapitres|étapes|fois)(?![\p{L}\d])))/gu;

/** Glues numbers to their unit and French punctuation to its word with no-break spaces ("6 h", "19 €", "mot :"). */
export function frenchNbsp(value: string): string {
  return String(value ?? '')
    .replace(UNIT_AFTER_NUMBER, '$1\u00a0')
    .replace(/(\d) (?=\d{3}\b)/g, '$1\u00a0') // "4 000 €" stays on one line
    .replace(/(\d\u00a0h) (?=\d)/g, '$1\u00a0') // "19 h 30" stays on one line
    .replace(/ ([:;!?»])/g, '\u00a0$1')
    .replace(/« /g, '«\u00a0')
    .replace(/([nN]°)[ \u00a0]?(?=\d)/g, '$1\u00a0'); // "n° 3" stays on one line
}

// ───────────────────────────── measuring & wrapping ─────────────────────────────

let measurer: PDFKit.PDFDocument | null = null;

/** Width in px/pt of `text` set in a standard font (AFM metrics via pdfkit, no page needed). */
export function textWidth(text: string, font: StdFont, size: number): number {
  if (!measurer) measurer = new PDFDocument({ autoFirstPage: false });
  measurer.font(font).fontSize(size);
  return measurer.widthOfString(sanitizePdfText(text));
}

/**
 * Greedy word wrap using real font metrics. `scale` inflates widths to stay safe when browsers
 * substitute a slightly wider system font. Over-long words are hard-split.
 */
export function wrapText(text: string, maxWidth: number, font: StdFont, size: number, scale = 1): string[] {
  const words = frenchNbsp(collapseSpaces(String(text ?? ''))).split(' ').filter(Boolean);
  const lines: string[] = [];
  const fits = (s: string) => textWidth(s, font, size) * scale <= maxWidth;
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) { line = candidate; continue; }
    if (line) lines.push(line);
    if (fits(word)) { line = word; continue; }
    // hard split a word that is wider than the box on its own
    let chunk = '';
    for (const ch of word) {
      if (fits(chunk + ch)) chunk += ch;
      else { if (chunk) lines.push(chunk); chunk = ch; }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  // French typography: never start a line with a lone closing punctuation mark.
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^([»:;!?]) ?(.*)$/);
    if (m) { lines[i - 1] += ` ${m[1]}`; lines[i] = m[2]; }
  }
  return lines.filter((l) => l.length > 0);
}

/**
 * Finds the biggest font size (between max and min, step 1) at which `text` wraps into ≤ maxLines.
 * At the minimum size, extra lines are cut and the last one gets an ellipsis.
 */
export function fitText(
  text: string, opts: { maxWidth: number; maxLines: number; font: StdFont; max: number; min: number; scale?: number },
): { size: number; lines: string[] } {
  const scale = opts.scale ?? 1;
  for (let size = opts.max; size >= opts.min; size -= 1) {
    const lines = wrapText(text, opts.maxWidth, opts.font, size, scale);
    if (lines.length <= opts.maxLines) return { size, lines };
  }
  const size = opts.min;
  const lines = wrapText(text, opts.maxWidth, opts.font, size, scale);
  const kept = lines.slice(0, opts.maxLines);
  if (lines.length > opts.maxLines && kept.length > 0) {
    let last = `${kept[kept.length - 1]}…`;
    while (last.length > 2 && textWidth(last, opts.font, size) * scale > opts.maxWidth) last = `${last.slice(0, -2).trimEnd()}…`;
    kept[kept.length - 1] = last;
  }
  return { size, lines: kept };
}

/** Cuts a string at a word boundary to at most `max` characters, adding an ellipsis. */
export function truncate(value: string, max: number): string {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, Math.max(1, max - 1));
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

const CLAUSE_CUT = /\s*\(|,\s|\s[:;—–]\s|\s(?=(?:qui|que|vivant|habitant|avec|sans|dans|en|pour|de|du|des|à|au|aux|et|ou)\s)|\s(?=d['’])/giu;
const OPEN_END = /(?:^|\s)(?:qui|que|vivant|habitant|avec|sans|dans|en|pour|de|du|des|d['’]\S*|à|au|aux|et|ou|la|le|les|un|une|l['’]\S*|\d+)$/iu;

/**
 * Longest head of `text` that `fits`, cut where a phrase really ends (« … d’un chiot de 2 à 6 mois | vivant en
 * appartement »), never with an ellipsis: an audience stays a whole clause wherever it has to be shortened.
 */
export function wholeClause(text: string, fits: (s: string) => boolean): string {
  const t = collapseSpaces(String(text ?? ''));
  if (!t || fits(t)) return t;
  const cuts = [...t.matchAll(CLAUSE_CUT)].map((m) => m.index ?? 0).sort((a, b) => b - a);
  for (const i of cuts) {
    const head = t.slice(0, i).trim();
    if (head.length >= 8 && !OPEN_END.test(head) && fits(head)) return head;
  }
  // no boundary fits: the longest run of whole words, whatever the width allows
  const words = t.split(' ');
  for (let k = words.length - 1; k > 0; k--) {
    const head = words.slice(0, k).join(' ').replace(/[\s,;:]+$/, '');
    if (!OPEN_END.test(head) && fits(head)) return head;
  }
  return words[0] ?? '';
}

// ───────────────────────────── misc helpers ─────────────────────────────

export { hashString } from '../core/ids.js';

/** Tiny deterministic PRNG for decorative layout (stars, dots…). */
export function decoRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lowercase, accent-free version for keyword matching. */
export function normalizeKey(value: string): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** "19 €", "19,90 €", "0 €" — French price formatting. */
export function formatPrice(price: number): string {
  const p = Number.isFinite(price) ? Math.max(0, price) : 0;
  const rounded = Math.round(p * 100) / 100;
  if (Number.isInteger(rounded)) return `${rounded} €`;
  return `${rounded.toFixed(2).replace('.', ',')} €`;
}

/** "12,4 k" style counters for the fake TikTok UI. */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 10_000) return `${Math.round(n / 1000)} k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')} k`;
  return String(Math.max(0, Math.round(n)));
}

/** Short safe slug for ids / handles. */
export function slugify(value: string, max = 40): string {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'x';
}

/** Rounds coordinates in generated SVG to keep files small. */
export function n(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}
