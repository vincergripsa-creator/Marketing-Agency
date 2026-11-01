/**
 * The card a plain editor opens on: the guide itself, its title over its art and its book under it, where a hook should be.
 * Nothing is broken, it costs the first second of the ad, and that is the mistake. The agency has no shop name to print: it signs nothing.
 */
import { splitTitle } from '../../deliverables/cover.js';
import type { SceneApi } from '../compose.js';
import type { TimelineBeat } from '../timeline.js';
import { artUnderType, BOOK_TILT } from './hook.js';

const MAX_SIZE = 170;
const MIN_SIZE = 56;
const SIZE_STEP = 6;
const LINE = 1.2;
const BAR_W = 180;
const BAR_H = 12;
const EDGE = 4;
const BAR_ROOM = 60;           // of the box, under the type
const BEARING = 10;            // a « J » reaches left of its origin

/** Frame 1 of a plain ad: it is whole from the first frame, a fade would leave it bare. A quick card draws the hook instead, in the compositor. */
export function drawTitle(s: SceneApi, b: TimelineBeat, t: number): void {
  const { ctx, C, stage } = s;
  const box = stage.heroBox;
  artUnderType(s, b.t0 + t, null);
  const title = splitTitle(s.assets.spec.title).head.toLocaleUpperCase('fr-FR');
  const fit = s.memo(b, () => {
    const room = box.h - BAR_ROOM;
    for (let size = MAX_SIZE; ; size -= SIZE_STEP) {
      const lines = s.wrap(title, size, s.display, box.w - BEARING);
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (size <= MIN_SIZE || (widest <= box.w - BEARING && lines.length * size * LINE <= room)) return { size, lines };
    }
  });
  s.font(fit.size, s.display);
  const ascent = ctx.measureText(fit.lines[0]!).actualBoundingBoxAscent; // on the ink: an accent rises above any line height
  const y = box.y + Math.max(0, (box.h - BAR_ROOM - fit.lines.length * fit.size * LINE) / 2) + ascent + EDGE;
  ctx.fillStyle = '#fff';
  fit.lines.forEach((line, i) => s.drawText(line, box.x + BEARING, y + i * fit.size * LINE));
  ctx.fillStyle = C.gold;
  s.roundBox(box.x + BEARING, y + (fit.lines.length - 1) * fit.size * LINE + 40, BAR_W, BAR_H, BAR_H / 2);
  ctx.fill();
  const slot = stage.bookSlot;
  s.book(slot.x + slot.w / 2, slot.y + slot.h / 2 + Math.sin(t * 2) * 8, slot.w, BOOK_TILT, t);
}
