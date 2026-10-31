/** Logo card before the hook: the weak editor's mistake, drawn for real. It costs the first second of the ad. */
import { rgba } from '../../deliverables/color.js';
import type { SceneApi } from '../compose.js';
import { eOut, type TimelineBeat } from '../timeline.js';

export function drawTitle(s: SceneApi, _b: TimelineBeat, t: number): void {
  const { ctx, C, hero: box } = s;
  s.background(C.dark, C.dark2, 0.5);
  s.floaters(t, rgba(C.secondary, 0.09), 8, 11);
  const brand = s.assets.spec.brand.toLocaleUpperCase('fr-FR');
  let size = 150;
  for (; size > 50; size -= 6) {
    s.font(size, s.display, 2);
    if (ctx.measureText(brand).width <= box.w) break;
  }
  const x = box.x + box.w / 2;
  const y = box.y + box.h * 0.5;
  s.font(size, s.display, 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = eOut(t / 0.12);
  s.drawText(brand, x, y);
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.gold;
  s.roundBox(x - 90, y + 34, 180, 10, 5);
  ctx.fill();
  ctx.textAlign = 'left';
}
