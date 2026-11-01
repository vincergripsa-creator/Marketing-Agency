/**
 * A buyer's own review, the words the voice is reading: stars, the quote lit word by word, the first name. It stands in for
 * the plate on a proof scene, and it carries no caption: the card is the caption. A review the shop cannot find back keeps
 * its words and loses its stars and its name, nothing is made up for it.
 */
import { mix, rgba } from '../../deliverables/color.js';
import type { SceneApi } from '../compose.js';
import { FACE } from '../fonts.js';
import type { ReviewCard } from '../spec.js';
import { eBack, eOut, type TimelineBeat } from '../timeline.js';

const LABEL = 'AVIS D’ACHETEUR';
const STARS = 5;
const STAR_R = 46;
const STAR_GAP = 18;
const STAR_SEC = 0.09;
const MAX_SIZE = 84;
const MIN_SIZE = 40;
const LINE = 1.24;
const PAD = 44;
const BLEED = 30;              // the card reaches past the text, the text stays in the zone
const UNSAID = 0.55;           // a word yet to be read: muted, the whole quote still reads
const EDGE = 4;                // a « J » or an « A » reaches left of its origin; `leadOf` reads a « j » that reaches further

const bare = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** What a line's first word reaches left of its origin, at the size the font is set to: a « j » at 150 px takes 11 px of the margin. */
export function leadOf(s: SceneApi, line: string): number {
  return Math.max(0, s.ctx.measureText(line.split(' ')[0]!).actualBoundingBoxLeft);
}

function star(s: SceneApi, x: number, y: number, r: number): void {
  const { ctx } = s;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const d = i % 2 ? r * 0.46 : r;
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
}

/** When the voice reaches each word of the quote: the spoken line may open with a lead-in, or run past it. */
function quoteTimes(b: TimelineBeat, words: readonly string[]): number[] {
  const first = b.words.findIndex((w, i) => bare(w.text) === bare(words[0]!) && bare(b.words[i + 1]?.text ?? '') === bare(words[1] ?? ''));
  const from = first < 0 ? Math.max(0, b.words.length - words.length) : first;
  return words.map((_, i) => b.words[from + i]?.at ?? 0);
}

/** `floor`: where the card must stop, on a deck whose foot holds its place and its arrow. */
export function drawReview(s: SceneApi, b: TimelineBeat, t: number, card: ReviewCard, floor: number | null = null): void {
  const { ctx, C, column: box } = s;
  s.background(C.light, mix(C.light, C.secondary, 0.7), 0.2);
  s.art(b.t0 + t, 0.12);
  s.band(b.t0 + t);

  const stars = card.rating === null ? 0 : STARS;
  const name = card.name ?? 'Un acheteur du guide';
  const top = box.y + 66;
  const headH = stars ? STAR_R * 2 + 34 : 0;
  const footH = 96;
  const bottom = floor ?? s.stage.captionY + 20;
  const room = bottom - top - headH - footH - PAD * 2;
  const fit = s.memo(b, () => {
    for (let size = MAX_SIZE; ; size -= 4) {
      const lines = s.wrap(`« ${card.quote} »`, size, FACE.bold, box.w - EDGE);
      s.font(size, FACE.bold, -1);
      const fits = lines.every((l) => { // « micro-entrepreneurs » has nowhere to break
        const m = ctx.measureText(l);
        return Math.max(EDGE, leadOf(s, l)) + Math.max(m.width, m.actualBoundingBoxRight) <= box.w;
      });
      if ((fits && lines.length * size * LINE <= room) || size <= MIN_SIZE) return { size, lines };
    }
  });
  const quoteH = fit.lines.length * fit.size * LINE;
  const h = headH + quoteH + footH + PAD * 2;
  const y = top + Math.max(0, (bottom - top - h) * 0.35);
  const rise = eBack(t / 0.24, 1.3);

  ctx.save();
  ctx.translate(box.x + box.w / 2, y + h / 2);
  ctx.scale(0.8 + 0.2 * rise, 0.8 + 0.2 * rise);
  ctx.translate(-(box.x + box.w / 2), -(y + h / 2));
  ctx.shadowColor = 'rgba(30,40,30,0.3)'; ctx.shadowBlur = 56; ctx.shadowOffsetY = 24;
  ctx.fillStyle = '#fff';
  s.roundBox(box.x - BLEED, y, box.w + BLEED * 2, h, 48); ctx.fill();
  ctx.shadowColor = 'transparent';

  for (let i = 0; i < stars; i++) {
    const grow = eBack((t - 0.16 - i * STAR_SEC) / 0.16, 3);
    const cx = box.x + STAR_R + i * (STAR_R * 2 + STAR_GAP);
    const cy = y + PAD + STAR_R;
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(grow, grow); ctx.rotate((1 - grow) * 0.7); ctx.translate(-cx, -cy);
    ctx.fillStyle = i < Math.round(card.rating!) ? C.pop : mix(C.light, C.ink, 0.15);
    star(s, cx, cy, STAR_R); ctx.fill();
    ctx.restore();
  }

  const words = fit.lines.flatMap((line) => line.split(' ')).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const times = s.memo(words, () => quoteTimes(b, words));
  let index = 0;
  s.font(fit.size, FACE.bold, -1);
  fit.lines.forEach((line, row) => {
    let x = box.x + Math.max(EDGE, leadOf(s, line));
    const ly = y + PAD + headH + fit.size * 0.92 + row * fit.size * LINE;
    for (const word of line.split(' ')) {
      const open = !/[\p{L}\p{N}]/u.test(word);
      const at = open ? 0 : times[index] ?? 0;
      if (!open) index += 1;
      const said = s.timeline.plain || t >= at;
      const width = ctx.measureText(`${word} `).width;
      const reading = !s.timeline.plain && !open && t >= at && t < at + 0.32;
      if (reading) {
        ctx.fillStyle = rgba(C.gold, 0.6);
        s.roundBox(x - 6, ly - fit.size * 0.86, ctx.measureText(word).width + 12, fit.size * 1.1, 10); ctx.fill();
      }
      ctx.fillStyle = said ? C.ink : rgba(C.ink, UNSAID);
      s.drawText(word, x, ly, { moving: t < 0.24 });
      x += width;
    }
  });

  const footY = y + PAD + headH + quoteH + 56;
  ctx.globalAlpha = eOut((t - 0.3) / 0.2);
  s.font(46, FACE.bold);
  ctx.fillStyle = C.primary;
  s.drawText(`— ${name}`, box.x + EDGE, footY, { moving: t < 0.5 });
  ctx.globalAlpha = 1;
  ctx.restore();

  s.font(36, FACE.bold, 3);
  ctx.fillStyle = C.primary;
  ctx.globalAlpha = eOut(t / 0.2);
  s.drawText(LABEL, box.x + EDGE, box.y + 36, { moving: t < 0.2 });
  ctx.globalAlpha = 1;
}
