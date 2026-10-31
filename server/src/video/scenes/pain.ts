/**
 * Real customer phrases in comment bubbles. They come from the research, never invented, and no fake user name.
 * A light plate, for contrast with the dark hook. The caption runs below the bubbles.
 */
import { mix, rgba } from '../../deliverables/color.js';
import type { SceneApi } from '../compose.js';
import { FACE } from '../fonts.js';
import { eBack, eOut, type TimelineBeat } from '../timeline.js';

const LABEL = 'LU DANS LES COMMENTAIRES';
const TYPING_SEC = 0.55;
const WORD_SEC = 0.045;
const REACTION_SEC = 1.5;
const SECOND_SEC = 2.3;
const LABEL_H = 76;
const TAIL = 58;
const GAP = 64;
const LINE = 1.22;
const LINE2 = 1.24;
const PAD = 90;
const PAD2 = 58;

interface Layout { size: number; lines: string[]; size2: number; lines2: string[]; h: number; h2: number }

/** The biggest phrase that leaves room for the second one above the caption. */
function layout(s: SceneApi, phrase: string, second: string | null): Layout {
  const box = s.column;
  const room = s.captionTop - box.y - LABEL_H;
  let last: Layout | null = null;
  for (let size = 78; size >= 40; size -= 4) {
    const size2 = Math.round(size * 0.7);
    const lines = s.wrap(phrase, size, FACE.bold, box.w - 120);
    const lines2 = second ? s.wrap(second, size2, FACE.bold, box.w - 200) : [];
    const h = lines.length * size * LINE + PAD;
    const h2 = second ? lines2.length * size2 * LINE2 + PAD2 : 0;
    last = { size, lines, size2, lines2, h, h2 };
    if (h + TAIL + (second ? GAP - TAIL + h2 : 0) <= room) break;
  }
  return last!;
}

function bubblePhrase(s: SceneApi, l: Layout, x: number, y: number, t: number): void {
  const { ctx, C } = s;
  s.font(l.size, FACE.bold, -1);
  ctx.fillStyle = C.ink;
  let index = 0;
  l.lines.forEach((line, row) => {
    let wx = x + 60;
    const wy = y + 46 + l.size * 0.92 + row * l.size * LINE;
    for (const word of line.split(' ')) {
      const age = t - TYPING_SEC - index * WORD_SEC;
      if (age > 0) {
        ctx.globalAlpha = eOut(age / 0.12);
        s.drawText(word, wx, wy + (1 - eOut(age / 0.14)) * 18, { moving: age < 0.14 });
      }
      wx += ctx.measureText(`${word} `).width;
      index++;
    }
  });
  ctx.globalAlpha = 1;
}

export function drawPain(s: SceneApi, b: TimelineBeat, t: number): void {
  const { ctx, C, column: box } = s;
  s.background(C.light, mix(C.light, C.secondary, 0.7), 0.2);
  s.floaters(t, rgba(C.primary, 0.09), 7, 5);
  const phrase = b.screen.replace(/^[«"\s]+|[»"\s]+$/g, '');
  const second = b.items?.[0]?.replace(/^[«"\s]+|[»"\s]+$/g, '') ?? null;
  const l = s.memo(b, () => layout(s, phrase, second));
  const typing = t < TYPING_SEC;
  const bx = box.x;
  const by = box.y + LABEL_H;
  const bw = typing ? 240 : box.w;
  const bh = typing ? 150 : l.h;
  const appear = eBack(t / 0.22);

  ctx.globalAlpha = eOut(t / 0.2);
  s.font(38, FACE.bold, 3);
  ctx.fillStyle = C.primary;
  ctx.textAlign = 'center';
  s.drawText(LABEL, box.x + box.w / 2, box.y + 44, { moving: t < 0.2 });
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(bx + 60, by + bh);
  ctx.scale(0.6 + 0.4 * appear, 0.6 + 0.4 * appear);
  ctx.translate(-(bx + 60), -(by + bh));
  ctx.shadowColor = 'rgba(30,40,30,0.28)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 22;
  ctx.fillStyle = '#fff';
  s.roundBox(bx, by, bw, bh, 56); ctx.fill();
  ctx.beginPath(); ctx.moveTo(bx + 56, by + bh - 6); ctx.lineTo(bx + 16, by + bh + TAIL); ctx.lineTo(bx + 150, by + bh - 6); ctx.fill();
  ctx.shadowColor = 'transparent';
  if (typing) {
    ctx.fillStyle = mix(C.ink, '#ffffff', 0.55);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(bx + 70 + i * 50, by + bh / 2 + Math.sin(t * 14 + i * 1.1) * 12, 16, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    bubblePhrase(s, l, bx, by, t);
    if (t > REACTION_SEC) {
      const pop = eBack((t - REACTION_SEC) / 0.2, 3);
      ctx.save();
      ctx.translate(bx + bw - 62, by + bh - 4);
      ctx.scale(pop, pop);
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.arc(0, 0, 48, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      s.font(50, FACE.bold);
      ctx.textAlign = 'center';
      s.drawText('?', 0, 18, { moving: t < REACTION_SEC + 0.2 });
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }
  ctx.restore();

  const secondAt = Math.min(SECOND_SEC, b.dur * 0.6);
  if (second && t > secondAt) {
    const grow = eBack((t - secondAt) / 0.2);
    const w2 = box.w - 110;
    const x2 = box.x + 110;
    const y2 = by + l.h + GAP;
    ctx.save();
    ctx.translate(x2 + w2 - 60, y2 + l.h2);
    ctx.scale(0.6 + 0.4 * grow, 0.6 + 0.4 * grow);
    ctx.translate(-(x2 + w2 - 60), -(y2 + l.h2));
    ctx.shadowColor = 'rgba(30,40,30,0.25)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    ctx.fillStyle = C.primary;
    s.roundBox(x2, y2, w2, l.h2, 46); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fff';
    s.font(l.size2, FACE.bold, -1);
    l.lines2.forEach((line, i) => s.drawText(line, x2 + 44, y2 + 22 + l.size2 + i * l.size2 * LINE2, { moving: t < secondAt + 0.2 }));
    ctx.restore();
  }
}
