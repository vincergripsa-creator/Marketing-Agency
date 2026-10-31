/** Plain text plate: what a weak editor uses instead of proof, and what a proof falls back on when no page is there. */
import { rgba } from '../../deliverables/color.js';
import type { SceneApi } from '../compose.js';
import { FACE } from '../fonts.js';
import { eOut, type TimelineBeat } from '../timeline.js';

const MAX_SIZE = 108;
const MIN_SIZE = 40;
const LINE = 1.24;
const PAD = 56;
const CAPTION_ROOM = 100;      // above the caption's baseline

/** A step of the method, or a landmark to keep in mind. */
export function chipLabel(b: TimelineBeat): string {
  if (!/étape|^\s*\d+[.)]/i.test(`${b.screen} ${b.spoken}`.trim())) return 'REPÈRE';
  const number = /^\s*(\d+)[.)]/.exec(b.screen)?.[1];
  return number ? `ÉTAPE ${number}` : 'ÉTAPE';
}

export function drawFact(s: SceneApi, b: TimelineBeat, t: number): void {
  const { ctx, C, column: box } = s;
  s.background(C.dark2, C.dark, 0.8);
  s.floaters(t, rgba(C.secondary, 0.07), 6, 9);
  const top = box.y + 96;
  const room = s.stage.captionY - CAPTION_ROOM - top;
  const text = b.screen || b.spoken;
  const fit = s.memo(b, () => {
    for (let size = MAX_SIZE; ; size -= 4) {
      const lines = s.wrap(text, size, FACE.bold, box.w - PAD * 2);
      if (lines.length * size * LINE + PAD * 2 <= room || size <= MIN_SIZE) return { size, lines };
    }
  });
  const h = fit.lines.length * fit.size * LINE + PAD * 2;
  const y = top + Math.max(0, (room - h) * 0.4) + (1 - eOut(t / 0.25)) * 60;
  ctx.fillStyle = C.light;
  s.roundBox(box.x, y, box.w, h, 28);
  ctx.fill();
  ctx.fillStyle = C.ink;
  s.font(fit.size, FACE.bold, -1);
  fit.lines.forEach((line, i) => s.drawText(line, box.x + PAD, y + PAD + fit.size * 0.92 + i * fit.size * LINE, { moving: t < 0.25 }));
  s.chip(chipLabel(b), box.x, box.y + 56, t);
}
