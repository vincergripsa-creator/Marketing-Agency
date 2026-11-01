import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { create, type FontkitFont } from 'fontkit';
import { repoRoot } from '../core/paths.js';
import type { TypeVoice } from '../shared.js';
import { collapseSpaces, frenchNbsp, sanitizePdfText, textWidth, type StdFont } from './text.js';
import { facesOf, STD_VOICE, VOICES, type Voice } from './voices.js';

export type FaceName = string; // 'fraunces-900-normal'
export interface Face { name: FaceName; sfnt: Buffer; font: FontkitFont; unitsPerEm: number }

interface Run { width: number; glyphs: number } // width in em, glyphs after ligatures

const MAX_RUNS = 50_000; // a long run must not grow without end: past that the cache starts over, a width is cheap to redo

const FONT_DIR = join(repoRoot(), 'server', 'assets', 'fonts');

let fontDir = FONT_DIR;
const faces = new Map<FaceName, Face>();
const runs = new Map<string, Run>();

/** Points the loader at another folder and forgets what it read; no argument goes back to the committed fonts. For tests. */
export function setFontDir(dir: string = FONT_DIR): void {
  fontDir = dir;
  faces.clear();
  runs.clear();
}

/** A standard PDF font of the rescue voice: no file, AFM metrics. */
export const isStdFont = (name: FaceName): boolean => /^(Helvetica|Times|Courier)(-|$)/.test(name);

/** Rebuilds a plain sfnt from a WOFF1 file, in memory only: nothing converted is ever written, so nothing converted is distributed. */
export function woffToSfnt(buf: Buffer): Buffer {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'wOFF') throw new Error('not a WOFF file');
  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);
  const tables: { tag: string; sum: number; data: Buffer }[] = [];
  for (let i = 0; i < numTables; i++) {
    const p = 44 + i * 20;
    if (p + 20 > buf.length) throw new Error('truncated WOFF directory');
    const offset = buf.readUInt32BE(p + 4);
    const compressed = buf.readUInt32BE(p + 8);
    const original = buf.readUInt32BE(p + 12);
    if (offset + compressed > buf.length) throw new Error('truncated WOFF table');
    const raw = buf.subarray(offset, offset + compressed);
    tables.push({ tag: buf.toString('latin1', p, p + 4), sum: buf.readUInt32BE(p + 16), data: compressed === original ? Buffer.from(raw) : inflateSync(raw) });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const headerSize = 12 + 16 * numTables;
  const out = Buffer.alloc(tables.reduce((size, t) => size + ((t.data.length + 3) & ~3), headerSize));
  const log2 = Math.floor(Math.log2(numTables));
  const searchRange = (1 << log2) * 16;
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(log2, 8);
  out.writeUInt16BE(numTables * 16 - searchRange, 10);
  let offset = headerSize;
  tables.forEach((t, i) => {
    const p = 12 + i * 16;
    out.write(t.tag, p, 'latin1');
    out.writeUInt32BE(t.sum, p + 4);
    out.writeUInt32BE(offset, p + 8);
    out.writeUInt32BE(t.data.length, p + 12);
    t.data.copy(out, offset);
    offset += (t.data.length + 3) & ~3;
  });
  return out;
}

/** Reads the .woff once, unpacks it in memory to a plain sfnt, keeps it for the life of the process. Throws on a missing or corrupt file. */
export function faceOf(name: FaceName): Face {
  const known = faces.get(name);
  if (known) return known;
  const sfnt = woffToSfnt(readFileSync(join(fontDir, `${name}.woff`)));
  const font = create(sfnt);
  const face: Face = { name, sfnt, font, unitsPerEm: font.unitsPerEm };
  faces.set(name, face);
  return face;
}

/** The committed file itself, for a page that embeds it: the unpacked sfnt would distribute a converted font. Throws on a missing file. */
export const woffOf = (name: FaceName): Buffer => readFileSync(join(fontDir, `${name}.woff`));

/** pdfkit: doc.registerFont(name, face.sfnt) for each face of the voice. Lazy on pdfkit's side: unused faces are never embedded. */
export function registerVoice(doc: PDFKit.PDFDocument, v: Voice): void {
  for (const name of facesOf(v)) if (!isStdFont(name)) doc.registerFont(name, faceOf(name).sfnt);
}

/** The voice to set a guide in: the asked one when all its faces load, else the standard set, flagged. */
export function loadVoice(id: TypeVoice): { voice: Voice; degraded: boolean } {
  try {
    for (const name of facesOf(VOICES[id])) faceOf(name);
    return { voice: VOICES[id], degraded: false };
  } catch {
    return { voice: STD_VOICE, degraded: true };
  }
}

function runOf(face: FaceName, text: string): Run {
  const key = `${face}|${text}`;
  const known = runs.get(key);
  if (known) return known;
  let run: Run;
  if (isStdFont(face)) run = { width: textWidth(text, face as StdFont, 1000) / 1000, glyphs: [...text].length };
  else {
    const f = faceOf(face);
    const laid = f.font.layout(text);
    run = { width: laid.advanceWidth / f.unitsPerEm, glyphs: laid.glyphs.length };
  }
  if (runs.size >= MAX_RUNS) runs.clear();
  runs.set(key, run);
  return run;
}

/** Advance in points, cached by (face, text). Tracking goes between glyphs, so a ligature counts for one. */
export function advance(face: FaceName, text: string, size: number, track = 0): number {
  const run = runOf(face, text);
  return run.width * size + track * Math.max(0, run.glyphs - 1);
}

/** Greedy flush-left wrap on real metrics. No-break spaces stay glued, a word wider than the box is split, nothing overflows. */
export function wrapFace(text: string, face: FaceName, size: number, width: number): string[] {
  const fits = (s: string) => advance(face, s, size) <= width;
  const lines: string[] = [];
  let line = '';
  for (const word of frenchNbsp(collapseSpaces(text)).split(' ').filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) { line = candidate; continue; }
    if (line) lines.push(line);
    if (fits(word)) { line = word; continue; }
    let chunk = '';
    for (const ch of word) {
      if (fits(chunk + ch)) chunk += ch;
      else { if (chunk) lines.push(chunk); chunk = ch; }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

/** The biggest size that fits, then the narrowest measure that keeps the line count, so that no line is left with one short word. */
export function fitDisplay(text: string, face: FaceName, o: { width: number; max: number; min: number; maxLines: number; maxHeight?: number; leading?: number }): { size: number; lines: string[] } {
  const words = frenchNbsp(collapseSpaces(text)).split(' ').filter(Boolean);
  const leading = o.leading ?? 1;
  for (let size = o.max; size >= o.min; size -= 1) {
    const widest = Math.max(0, ...words.map((w) => advance(face, w, size)));
    if (widest > o.width) continue; // « Micro-entrepreneur » is never cut in two
    const lines = wrapFace(text, face, size, o.width);
    if (lines.length > o.maxLines || lines.length * size * leading > (o.maxHeight ?? Infinity)) continue;
    let lo = widest;
    let hi = o.width;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (wrapFace(text, face, size, mid).length <= lines.length) hi = mid;
      else lo = mid;
    }
    return { size, lines: wrapFace(text, face, size, hi) };
  }
  return { size: o.min, lines: wrapFace(text, face, o.min, o.width) };
}

// The marks the standard fonts have to spell out or drop: a face that draws one keeps it.
const MARKS = /[←↑→↓↔⇒➜➡➔≤≥≠≈∞✓✔✕✖✗✘★☆●▪■‣◦]/gu;

/** `sanitizePdfText` rules for one face: its own marks survive, what it lacks folds to the base letter or goes. */
export function sanitizeFor(face: FaceName, text: string): string {
  if (isStdFont(face)) return sanitizePdfText(text);
  const { font } = faceOf(face);
  const has = (ch: string) => font.hasGlyphForCodePoint(ch.codePointAt(0) ?? 0);
  const marks: string[] = [];
  const held = String(text ?? '').normalize('NFC').replace(MARKS, (m) => (has(m) ? `¤${marks.push(m) - 1}¤` : m));
  // an apostrophe between two letters is a typed one: the page sets the real one, whatever the string came from
  const clean = sanitizePdfText(held).replace(/¤(\d+)¤/g, (token, i: string) => marks[Number(i)] ?? token).replace(/(?<=\p{L})'(?=\p{L})/gu, '’');
  let out = '';
  for (const ch of clean) {
    if (ch === '\n' || has(ch)) { out += ch; continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (base !== ch && [...base].every(has)) out += base;
  }
  return out;
}
