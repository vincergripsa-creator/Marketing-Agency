/** Kinetic hook: one screen per clause, each word slams on the voice, digits in gold. The guide rises if the editor brought it in. */
import { rgba } from '../../deliverables/color.js';
import type { SceneApi } from '../compose.js';
import { eBack, eOut, type TimelineBeat } from '../timeline.js';

const MAX_SIZE = 230;
const MIN_SIZE = 64;
const SIZE_STEP = 6;
const MAX_LINES = 3;
const LINE = 1.22;             // a French capital carries its accent into the line above
const WORD_GAP = 0.26;
const SLAM_SEC = 0.14;
const SLAM = 0.55;
const SHAKE = 10;
const SHAKE_SEC = 0.1;
const BOOK_SEC = 0.45;

interface Fit { size: number; lines: number[][]; y0: number } // y0: baseline of the first line

/**
 * Largest size that fits the box, whole words, in 3 lines at most. Measured on the ink: Anton's accented capitals
 * rise far above any line height, so a block placed by its lines leaves the safe zone on « ÉTAPES ».
 */
function fit(s: SceneApi, words: string[]): Fit {
  const { ctx, hero: box } = s;
  for (let size = MAX_SIZE; ; size -= SIZE_STEP) {
    s.font(size, s.display);
    const gap = size * WORD_GAP;
    const lines: number[][] = [];
    let cur: number[] = [];
    let curW = 0;
    words.forEach((word, i) => {
      const width = ctx.measureText(word).width;
      if (cur.length && curW + gap + width > box.w) { lines.push(cur); cur = []; curW = 0; }
      curW += (cur.length ? gap : 0) + width;
      cur.push(i);
    });
    if (cur.length) lines.push(cur);
    const widest = Math.max(...words.map((w) => ctx.measureText(w).width));
    const ascent = Math.max(...lines[0]!.map((i) => ctx.measureText(words[i]!).actualBoundingBoxAscent));
    const descent = Math.max(...lines.at(-1)!.map((i) => ctx.measureText(words[i]!).actualBoundingBoxDescent));
    const ink = ascent + (lines.length - 1) * size * LINE + descent;
    if (size <= MIN_SIZE || (lines.length <= MAX_LINES && widest <= box.w && ink <= box.h)) {
      return { size, lines, y0: box.y + (box.h - ink) / 2 + ascent };
    }
  }
}

export function drawHook(s: SceneApi, b: TimelineBeat, t: number): void {
  const { ctx, C, hero: box } = s;
  s.background(C.dark, C.dark2, 0.5);
  s.floaters(t, rgba(C.secondary, 0.09), 8, 11);
  const fallback = s.memo(b, () => [b.screen.split(/\s+/).map((text) => ({ text, at: 0, end: b.dur }))]);
  const screens = b.groups.length ? b.groups : fallback;
  const group = screens.findLast((g) => t >= g[0]!.at - 0.05) ?? screens[0]!;
  const words = s.memo(group, () => group.map((w) => w.text.replace(/^[«»"(]+|[«»",.:;!)]+$/g, '').toLocaleUpperCase('fr-FR')));
  const { size, lines, y0 } = s.memo(words, () => fit(s, words));
  const lineH = size * LINE;
  const latest = t - Math.max(...group.map((w) => (t >= w.at - 0.05 ? w.at - 0.05 : -1e9)));
  const shake = latest < SHAKE_SEC ? SHAKE * (1 - latest / SHAKE_SEC) : 0;
  s.font(size, s.display);
  ctx.save();
  ctx.translate(Math.sin(t * 90) * shake, Math.cos(t * 70) * shake);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowOffsetY = 9;
  lines.forEach((line, row) => {
    const widths = line.map((i) => ctx.measureText(words[i]!).width);
    const gap = size * WORD_GAP;
    let x = box.x + box.w / 2 - (widths.reduce((a, c) => a + c, 0) + gap * (line.length - 1)) / 2;
    line.forEach((i, k) => {
      const width = widths[k]!;
      const age = t - (group[i]!.at - 0.05);
      if (age >= 0) {
        const grow = 1 + SLAM * (1 - eBack(age / SLAM_SEC, 1.6));
        ctx.save();
        ctx.translate(x + width / 2, y0 + row * lineH);
        ctx.scale(grow, grow);
        ctx.fillStyle = /\d/.test(words[i]!) ? C.gold : '#fff';
        s.drawText(words[i]!, 0, 0, { moving: age < SLAM_SEC || shake > 0 });
        ctx.restore();
      }
      x += width + gap;
    });
  });
  ctx.restore();
  ctx.textAlign = 'left';
  const bookAt = s.timeline.bookSec;
  if (bookAt !== null) {
    const rise = eOut((t - bookAt) / BOOK_SEC);
    const slot = s.stage.bookSlot;
    s.book(slot.x + slot.w / 2, slot.y + slot.h / 2 + (1 - rise) * 500 + Math.sin(t * 2) * 8, slot.w, 0.14, t);
  }
}
