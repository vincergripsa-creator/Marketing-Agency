/** Three real pages fan out behind the book, the sticker pops on the word « cadeau ». */
import { rgba } from '../../deliverables/color.js';
import type { SceneApi } from '../compose.js';
import { FACE } from '../fonts.js';
import { eBack, eOut, type TimelineBeat } from '../timeline.js';

const FAN = [-1, 1, -0.2];
const BOOK_W = 500;

export function drawBonus(s: SceneApi, b: TimelineBeat, t: number): void {
  const { ctx, C, column: box } = s;
  s.background(C.primary, C.dark, 0.3);
  s.floaters(t, rgba('#ffffff', 0.08), 7, 21);
  const spread = eOut((t - 0.15) / 0.5);
  const cx = box.x + box.w / 2;
  const yc = box.y + box.h * 0.4;
  const w = Math.min(BOOK_W, box.h * 0.52);
  const k = w / BOOK_W;
  s.assets.fan.forEach((page, i) => {
    const dir = FAN[i] ?? 0;
    const y = yc - 40 + Math.abs(dir) * 40 * spread;
    s.page(page, cx + dir * 230 * k * spread, y + Math.sin(t * 1.4 + i) * 7, w, dir * 0.13 * spread, 0, 0.5);
  });
  s.book(cx, yc + 60 + Math.sin(t * 1.8) * 6, w, -0.02, t);
  const word = b.words.find((x) => /cadeau/i.test(x.text));
  const at = word ? word.at - 0.06 : b.dur * 0.45;
  if (t <= at) return;
  const grow = eBack((t - at) / 0.22, 3);
  ctx.save();
  ctx.translate(cx + 230 * k, yc - 300 * k);
  ctx.rotate(0.16 + Math.sin(t * 3) * 0.02);
  ctx.scale(grow * k, grow * k);
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
