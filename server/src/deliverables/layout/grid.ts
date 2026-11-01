/** The page of every guide (pdf §8.1). Single-sided: guides are read on a screen and printed page by page, so the rail stays right. */
import { advance, wrapFace, type FaceName } from '../fonts.js';
import { collapseSpaces, frenchNbsp } from '../text.js';

export const GRID = { W: 595.28, H: 841.89, left: 54, right: 54, top: 66, bottom: 64, column: 340, gutter: 18, rail: 129, full: 487, baseline: 14.4, head: 40, folio: 811.89 } as const;

export const RAIL_X = GRID.left + GRID.column + GRID.gutter;
export const BODY_BOTTOM = GRID.H - GRID.bottom;
export const BODY_H = BODY_BOTTOM - GRID.top;
export const LEAD_LINE = 17.4;

/** A page holding less than this share of content because of one leftover block is a layout bug. */
export const MIN_PAGE_FILL = 0.25;
/** The last page of a section holds this much when the page before can spare it: under it the art closes more of the page than the text does. */
export const LAST_PAGE = 0.4;
/** Under this a page is short in the audit. */
export const SHORT_PAGE = 0.45;
/** Every body page ends at least here, unless its section closes on a designed end: above it a page reads as full, under it as half empty. */
export const PAGE_FLOOR = 0.6;
/** `fill` stops at the foot of a block's last line box, a little under its ink: the paginator aims this high so that the ink itself clears the floor. */
export const PAGE_AIM = PAGE_FLOOR + 0.025;
/** What a page that feeds the last one keeps to go on reading as full. */
export const PAGE_FULL = 0.8;
/** A last page shorter than this, once it has breathed, closes on its art: past the floor is still a page with a foot to fill. */
export const PAGE_BREATH = 0.72;
/** A page shorter than this opens up its rows and its section breaks. */
export const PAGE_AIR = PAGE_FULL + 0.01;

/** Height of the section tabs on the outer edge, so that a long guide still fits them all. */
export const tabHeight = (tabs: number): number => Math.min(54, (GRID.H - 220) / Math.max(1, tabs));

/**
 * Flush-left wrap on the sum of the words' widths, the way pdfkit sets a line: word by word, each one shaped once and
 * cached, where measuring every candidate line would shape a whole guide a hundred times. `width` may change by line,
 * for a drop cap or a run-in head.
 */
export function wrapWords(text: string, face: FaceName, size: number, width: number | ((line: number) => number)): string[] {
  const room = typeof width === 'number' ? () => width : width;
  const space = advance(face, 'n n', size) - 2 * advance(face, 'n', size);
  const lines: string[] = [];
  let line = '';
  let used = 0;
  for (const word of frenchNbsp(collapseSpaces(text)).split(' ').filter(Boolean)) {
    const w = advance(face, word, size);
    if (line && used + space + w <= room(lines.length)) {
      line += ` ${word}`;
      used += space + w;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    used = w;
    if (w > room(lines.length)) {
      const parts = wrapFace(word, face, size, room(lines.length));
      lines.push(...parts.slice(0, -1));
      line = parts[parts.length - 1] ?? '';
      used = advance(face, line, size);
    }
  }
  if (line) lines.push(line);
  return lines;
}
