/** The guide in the light, its price, a pulsing button, the way to the link. No caption: the voice says the same thing and they collided. */
import { rgba } from '../../deliverables/color.js';
import type { DesignSpec } from '../../shared.js';
import type { SceneApi } from '../compose.js';
import { FACE } from '../fonts.js';
import { zoneAt } from '../stage.js';
import { eBack, eOut, priceAt, type TimelineBeat } from '../timeline.js';

const BOOK_W = 540;
const CTA_SIZE = 64;
const PULSE = 0.035;
const SUB = 'Lien en bio';
const STICKER_R = 132;
const PRICE_SIZE = 104;
const SLAM_SEC = 0.22;
const SLAM = 1.6;              // the price comes down from this much bigger
const HIT = 0.06;              // the book takes the blow
const HIT_SEC = 0.3;
const RING_SEC = 0.4;
const RING = 2.3;              // of the sticker: how far the blow carries
const ARROW = 15;
const ARROW_EDGE = 7;

/** « Télécharge le guide (lien en bio) »: the link has its own line. « Swipe jusqu’au bout et… » says nothing on the last card. */
export const ctaLabel = (cta: string): string => cta.replace(/\s*\([^)]*\)\s*$/, '').replace(/^swipe\b.*?\bet\s+/i, '').trim().toLocaleUpperCase('fr-FR');

/** « 19 € », « 9,90 € »: as the shop prints it. */
export const priceLabel = (price: number): string => `${(Number.isInteger(price) ? String(price) : price.toFixed(2).replace('.', ','))} €`;

/** Where a sticker lands on the cover, in shares of it: on its art, never on its title. `minimal` keeps its art low on the right, the others over the title. */
export const stickerSpot = (design: Pick<DesignSpec, 'coverLayout'>): { u: number; v: number } => (design.coverLayout === 'minimal' ? { u: 0.8, v: 0.84 } : { u: 0.82, v: 0.2 });

function priceSticker(s: SceneApi, price: number, x: number, y: number, age: number, t: number): void {
  const { ctx, C } = s;
  const grow = 1 + SLAM * (1 - eOut(age / SLAM_SEC));
  ctx.save();
  ctx.translate(x, y);
  if (age < RING_SEC) {
    ctx.strokeStyle = rgba('#ffffff', 0.7 * (1 - age / RING_SEC));
    ctx.lineWidth = 16;
    ctx.beginPath(); ctx.arc(0, 0, STICKER_R * (1 + (RING - 1) * eOut(age / RING_SEC)), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.rotate(0.14 + Math.sin(t * 3) * 0.02);
  ctx.scale(grow, grow);
  ctx.fillStyle = C.pop;
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const r = i % 2 ? STICKER_R * 0.87 : STICKER_R;
    ctx.lineTo(Math.cos(i / 24 * Math.PI * 2) * r, Math.sin(i / 24 * Math.PI * 2) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  const label = priceLabel(price);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  s.font(PRICE_SIZE, s.display);
  const fit = Math.min(1, STICKER_R * 1.5 / ctx.measureText(label).width);
  s.font(Math.floor(PRICE_SIZE * fit), s.display);
  s.drawText(label, 0, PRICE_SIZE * fit * 0.36, { moving: age < SLAM_SEC });
  ctx.textAlign = 'left';
  ctx.restore();
}

export function drawEnd(s: SceneApi, b: TimelineBeat, t: number): void {
  const { ctx, C, column: box, stage } = s;
  s.background(C.dark, C.dark2, 0.5);
  s.art(b.t0 + t, 0.2);
  s.floaters(t, rgba(C.secondary, 0.1), 8, 2);
  s.band(b.t0 + t);
  const cx = box.x + box.w / 2;
  const yc = box.y + box.h * 0.36;

  ctx.save();
  ctx.translate(cx, yc);
  ctx.rotate(t * 0.18);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-90, -1300); ctx.lineTo(90, -1300); ctx.fill();
  }
  ctx.restore();

  const { price, design, cta } = s.assets.spec;
  const age = t - priceAt(b.dur);
  const blow = price && age >= 0 ? HIT * (1 - eOut(age / HIT_SEC)) : 0;
  const w = Math.min(BOOK_W, box.h * 0.52) * s.jump;
  s.book(cx, yc + Math.sin(t * 2) * 8, w * (eBack(t / 0.32, 1.4) + blow), -0.03, t);
  if (price && age > 0) {
    const spot = stickerSpot(design);
    const y = yc + (spot.v - 0.5) * w * s.assets.cover.h / s.assets.cover.w;
    priceSticker(s, price, Math.min(cx + (spot.u - 0.5) * w, zoneAt(stage, y).x1 - STICKER_R * 0.8), y, age, t);
  }

  const yBtn = box.y + box.h * 0.84;
  const pulse = 1 + PULSE * Math.sin(t * 6);
  const grow = eBack((t - 0.25) / 0.24);
  const label = ctaLabel(cta);
  if (label) {
    s.font(CTA_SIZE, FACE.bold);
    const room = box.w / (1 + PULSE) - 90;
    const size = Math.min(CTA_SIZE, Math.floor(CTA_SIZE * room / ctx.measureText(label).width));
    ctx.save();
    ctx.translate(cx, yBtn);
    ctx.scale(grow * pulse, grow * pulse);
    s.font(size, FACE.bold);
    const pill = ctx.measureText(label).width + 90;
    ctx.fillStyle = C.pop;
    ctx.shadowColor = rgba(C.pop, 0.6); ctx.shadowBlur = 44;
    s.roundBox(-pill / 2, -66, pill, 132, 66); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    s.drawText(label, 0, 23, { moving: t < 0.5 });
    ctx.restore();
  }

  const fade = eOut((t - 0.5) / 0.2);
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  s.font(58, FACE.semi);
  ctx.fillStyle = '#fff';
  s.drawText(SUB, cx, yBtn + 128, { moving: t < 0.7 });
  ctx.textAlign = 'left';
  if (stage.band !== null) { // a frame with no foot has no room for it: it clips on the square and on 4:5
    const y = yBtn + 165 + Math.abs(Math.sin(t * 5)) * 22;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + 60); ctx.moveTo(cx - 34, y + 30); ctx.lineTo(cx, y + 64); ctx.lineTo(cx + 34, y + 30);
    ctx.strokeStyle = C.dark; ctx.lineWidth = ARROW + ARROW_EDGE * 2; ctx.stroke(); // it falls on the art: no colour of the guide reads on all of it
    ctx.strokeStyle = '#fff'; ctx.lineWidth = ARROW; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
