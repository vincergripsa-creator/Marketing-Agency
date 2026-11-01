/** Three real pages fan out behind the book, the sticker pops on the word « cadeau ». */
import { rgba } from '../../deliverables/color.js';
import type { SceneApi } from '../compose.js';
import { FACE } from '../fonts.js';
import { eBack, eOut, type TimelineBeat } from '../timeline.js';
import { stickerSpot } from './end.js';

const FAN = [-1, 1, -0.2];
const BOOK_W = 600;
const STICKER_K = 0.92;        // tilted, its text keeps inside the zone

export function drawBonus(s: SceneApi, b: TimelineBeat, t: number): void {
  const { ctx, C, column: box } = s;
  s.background(C.primary, C.dark, 0.3);
  s.art(b.t0 + t, 0.2);
  s.floaters(t, rgba('#ffffff', 0.08), 7, 21);
  s.band(b.t0 + t);
  const spread = eOut((t - 0.15) / 0.5);
  const cx = box.x + box.w / 2;
  const w = Math.min(BOOK_W, (s.captionTop - box.y) * 0.62);
  const yc = box.y + w * 0.62;
  const k = w / BOOK_W;
  s.assets.fan.forEach((page, i) => {
    const dir = FAN[i] ?? 0;
    const y = yc - 40 + Math.abs(dir) * 40 * spread;
    s.page(page, cx + dir * 230 * k * spread, y + Math.sin(t * 1.4 + i) * 7, w, dir * 0.13 * spread, 0, 0.5);
  });
  const by = yc + 60;
  s.book(cx, by + Math.sin(t * 1.8) * 6, w, -0.02, t);
  const word = b.words.find((x) => /cadeau/i.test(x.text));
  const at = word ? word.at - 0.06 : b.dur * 0.45;
  if (t <= at) return;
  const grow = eBack((t - at) / 0.22, 3);
  const room = 172 * k * STICKER_K;
  ctx.save();
  const spot = stickerSpot(s.assets.spec.design);
  ctx.translate(Math.min(cx + (spot.u - 0.5) * w, box.x + box.w - room), Math.min(s.captionTop - room, Math.max(by + (spot.v - 0.5) * w * s.assets.cover.h / s.assets.cover.w, box.y + room)));
  ctx.rotate(0.16 + Math.sin(t * 3) * 0.02);
  ctx.scale(grow * k * STICKER_K, grow * k * STICKER_K);
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const r = i % 2 ? 150 : 172;
    const angle = i / 24 * Math.PI * 2;
    ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.textAlign = 'center';
  s.font(82, FACE.display);
  s.drawText('BONUS', 0, 8, { moving: t < at + 0.22 });
  s.font(36, FACE.bold);
  s.drawText('OFFERT', 0, 60, { moving: t < at + 0.22 });
  ctx.textAlign = 'left';
  ctx.restore();
}
