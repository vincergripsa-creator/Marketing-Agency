/**
 * Plain text plate: what a weak editor uses instead of proof, and what a proof falls back on when no page is there. On a
 * scene where the voice reads a buyer, the plate is that buyer's card.
 */
import { rgba } from '../../deliverables/color.js';
import { leadOut } from '../../deliverables/videoCut.js';
import { keyTokens, stem, stemSet } from '../../sim/text.js';
import type { SceneApi } from '../compose.js';
import { FACE } from '../fonts.js';
import { eOut, type TimelineBeat } from '../timeline.js';
import { drawReview } from './review.js';

const MAX_SIZE = 116;
const MIN_SIZE = 40;
const LINE = 1.24;
const PAD = 56;
const BLEED = 30;              // the plate reaches past the text, the text stays in the zone
export const QUOTE_LABEL = 'LU DANS LES COMMENTAIRES';
const LABEL_Y = 44;            // under the top of the column

/** A step of the method, or a landmark to keep in mind. */
export function chipLabel(b: TimelineBeat): string {
  if (!/étape|^\s*\d+[.)]/i.test(`${b.screen} ${b.spoken}`.trim())) return 'REPÈRE';
  const number = /^\s*(\d+)[.)]/.exec(b.screen)?.[1];
  return number ? `ÉTAPE ${number}` : 'ÉTAPE';
}

/** The screen, unless it says something else than the voice: a plate never holds « Plan de 14 jours » under another fact. */
export function plateText(screen: string, spoken: string): string {
  if (!screen || !spoken) return screen || spoken;
  const said = stemSet(spoken);
  if (keyTokens(screen).some((w) => said.has(stem(w)))) return screen;
  const fact = leadOut(spoken).replace(/[\s.!?…]+$/, '');
  return fact.charAt(0).toLocaleUpperCase('fr-FR') + fact.slice(1);
}

export function drawFact(s: SceneApi, b: TimelineBeat, t: number): void {
  const { ctx, C, column: box } = s;
  const review = s.assets.spec.reviews?.[b.scene];
  if (review) { drawReview(s, b, t, review); return; }
  s.background(C.dark2, C.dark, 0.8);
  s.art(b.t0 + t, 0.16);
  s.floaters(t, rgba(C.secondary, 0.07), 6, 9);
  s.band(b.t0 + t);
  const top = box.y + 96;
  const room = s.captionTop - top;
  const fit = s.memo(b, () => {
    const text = plateText(b.screen, b.spoken);
    for (let size = MAX_SIZE; ; size -= 4) {
      const lines = s.wrap(text, size, FACE.bold, box.w - PAD);
      s.font(size, FACE.bold, -1);
      const fits = lines.every((l) => ctx.measureText(l).width <= box.w - PAD); // « l’ensoleillement » has nowhere to break
      if ((fits && lines.length * size * LINE + PAD * 2 <= room) || size <= MIN_SIZE) return { size, lines };
    }
  });
  const h = fit.lines.length * fit.size * LINE + PAD * 2;
  const y = top + Math.max(0, (room - h) * 0.4) + (1 - eOut(t / 0.25)) * 60;
  ctx.fillStyle = C.light;
  s.roundBox(box.x - BLEED, y, box.w + BLEED * 2, h, 36);
  ctx.fill();
  ctx.fillStyle = C.ink;
  s.font(fit.size, FACE.bold, -1);
  fit.lines.forEach((line, i) => s.drawText(line, box.x + PAD / 2, y + PAD + fit.size * 0.92 + i * fit.size * LINE, { moving: t < 0.25 }));
  // A customer's words are no landmark of the guide, and the line that hands them over is none either.
  if (/^\s*«/.test(b.screen)) {
    s.font(38, FACE.bold, 3);
    ctx.fillStyle = C.gold;
    ctx.textAlign = 'center';
    s.drawText(QUOTE_LABEL, box.x + box.w / 2, box.y + LABEL_Y, { moving: t < 0.25 });
    ctx.textAlign = 'left';
  } else if (!/^\s*si toi\b/iu.test(b.spoken)) {
    s.chip(chipLabel(b), box.x, box.y + 56, t);
  }
}
