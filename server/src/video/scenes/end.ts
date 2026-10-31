/** The guide in the light, a pulsing button, the way to the link. No caption: the voice says the same thing and they collided. */
import { rgba } from '../../deliverables/color.js';
import type { SceneApi } from '../compose.js';
import { FACE } from '../fonts.js';
import { eBack, eOut, type TimelineBeat } from '../timeline.js';

const BOOK_W = 500;
const CTA_SIZE = 64;
const PULSE = 0.035;
const SUB = 'Lien en bio';

/** « Télécharge le guide (lien en bio) »: the link has its own line. */
const ctaLabel = (cta: string): string => cta.replace(/\s*\([^)]*\)\s*$/, '').trim().toLocaleUpperCase('fr-FR');

export function drawEnd(s: SceneApi, _b: TimelineBeat, t: number): void {
  const { ctx, C, column: box } = s;
  s.background(C.dark, C.dark2, 0.5);
  s.floaters(t, rgba(C.secondary, 0.1), 8, 2);
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

  const w = Math.min(BOOK_W, box.h * 0.52) * s.jump;
  s.book(cx, yc + Math.sin(t * 2) * 8, w * eBack(t / 0.32, 1.4), -0.03, t);

  const yBtn = box.y + box.h * 0.84;
  const pulse = 1 + PULSE * Math.sin(t * 6);
  const grow = eBack((t - 0.25) / 0.24);
  const label = ctaLabel(s.assets.spec.cta);
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

  const fade = eOut((t - 0.5) / 0.2);
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  s.font(58, FACE.semi);
  ctx.fillStyle = '#fff';
  s.drawText(SUB, cx, yBtn + 128, { moving: t < 0.7 });
  ctx.textAlign = 'left';
  if (s.stage.ratio !== '1:1') { // it clips on the square (sheet5.png)
    const y = yBtn + 165 + Math.abs(Math.sin(t * 5)) * 22;
    ctx.strokeStyle = C.gold; ctx.lineWidth = 15; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + 60); ctx.moveTo(cx - 34, y + 30); ctx.lineTo(cx, y + 64); ctx.lineTo(cx + 34, y + 30); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
