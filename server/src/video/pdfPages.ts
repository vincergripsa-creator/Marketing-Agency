/**
 * Real pages of the real guide, in Node, with their text positions: the marker sweeps a line the buyer will read.
 * A guide that does not open, or a needle not found, is a `no_pages` beat, never a failed render (video §7).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Rect } from './stage.js';

export interface PageImage { img: Canvas; w: number; h: number } // w, h in points: boxes share them whatever the scale
export interface NeedleHit { page: number; boxes: Rect[] }        // one box per line of text, in points from the top left

export interface Guide {
  pages: number;
  pageImage(n: number, scale: number): Promise<PageImage>;
  findNeedle(needle: string): NeedleHit | null;
  close(): Promise<void>;
}

interface Run { x: number; y: number; w: number; h: number; length: number }
interface PageText { chars: string; at: { run: number; index: number }[]; runs: Run[] }

/** Curly apostrophes, ligatures and case differ between the writer and the PDF. Spaces go too: a line wrap makes or eats one. */
const fold = (s: string): string => s.normalize('NFKC').replace(/[’ʼ‘]/g, '\'').toLowerCase().replace(/\s+/g, '');

function textOf(items: readonly unknown[], viewport: pdfjs.PageViewport): PageText {
  const page: PageText = { chars: '', at: [], runs: [] };
  for (const item of items as { str?: string; transform?: number[]; width?: number }[]) {
    if (!item.str?.trim() || !item.transform) continue;
    const [a, , , d, e, f] = item.transform as [number, number, number, number, number, number];
    const [x, y] = viewport.convertToViewportPoint(e, f) as [number, number];
    const size = Math.abs(d || a);
    const run = page.runs.push({ x, y: y - size * 0.95, w: item.width ?? 0, h: size * 1.3, length: item.str.length }) - 1;
    let index = 0;
    for (const ch of item.str) {
      for (const c of fold(ch)) {
        page.chars += c;
        page.at.push({ run, index });
      }
      index += ch.length;
    }
  }
  return page;
}

function boxesOf(text: PageText, from: number, to: number): Rect[] {
  const spans = new Map<number, { first: number; last: number }>();
  for (const { run, index } of text.at.slice(from, to)) {
    const span = spans.get(run);
    if (span) span.last = index;
    else spans.set(run, { first: index, last: index });
  }
  return [...spans].map(([id, { first, last }]) => {
    const r = text.runs[id]!;
    return { x: r.x + r.w * (first / r.length), y: r.y, w: r.w * ((last + 1 - first) / r.length), h: r.h };
  });
}

/**
 * A guide set in Helvetica embeds no font. In Node, pdf.js hands this string to `fs.readFile`: a `file://` URL fails, and
 * silently at verbosity 0, with the page drawn in a fallback face. So a plain path, with its trailing slash.
 */
export function standardFontDir(): string | undefined {
  try {
    const main = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
    return `${join(dirname(main), 'standard_fonts').split(sep).join('/')}/`;
  } catch {
    return undefined;
  }
}

export async function openGuide(path: string): Promise<Guide> {
  const data = new Uint8Array(await readFile(path));
  const loading = pdfjs.getDocument({ data, disableFontFace: true, verbosity: 0, standardFontDataUrl: standardFontDir() });
  const doc = await loading.promise;
  const texts: PageText[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    texts.push(textOf((await page.getTextContent()).items, page.getViewport({ scale: 1 })));
  }
  return {
    pages: doc.numPages,
    async pageImage(n, scale) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const img = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      await page.render({ canvasContext: img.getContext('2d') as never, viewport, canvas: img as never }).promise;
      page.cleanup();
      return { img, w: viewport.width / scale, h: viewport.height / scale };
    },
    findNeedle(needle) {
      const wanted = fold(needle);
      if (!wanted) return null;
      for (let p = 0; p < texts.length; p++) {
        const text = texts[p]!;
        const from = text.chars.indexOf(wanted);
        if (from >= 0) return { page: p + 1, boxes: boxesOf(text, from, from + wanted.length) };
      }
      return null;
    },
    close: () => loading.destroy(),
  };
}
