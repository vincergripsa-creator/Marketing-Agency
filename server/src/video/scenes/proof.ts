/**
 * The real page of the real guide: wide, then punch-ins on the real line, a marker sweeping it. The strongest shot of
 * the ad, and no storyboard could do it. Each shot of the cut is a jump of this camera.
 */
import { rgba } from '../../deliverables/color.js';
import type { SceneApi } from '../compose.js';
import { eBack, eIO, type TimelineBeat } from '../timeline.js';
import { chipLabel, drawFact } from './fact.js';

const ZOOMS = [1, 1.5, 2.25, 1.75];
const TILTS = [-0.05, 0.02, -0.015, 0.03];
const WIDE = 0.815;            // of the stage
const MARKER_AT = 0.2;         // of the beat
const MARKER_SEC = 0.5;

export function drawProof(s: SceneApi, b: TimelineBeat, t: number): void {
  const proof = s.assets.proofs.get(b.index);
  if (!proof) { drawFact(s, b, t); return; }
  const { ctx, C, column: box } = s;
  s.background(C.dark2, C.dark, 0.8);
  s.floaters(t, rgba(C.secondary, 0.07), 6, 9);
  const a = proof.picture;
  const hit = proof.boxes[0]!;
  const wide = s.shot === 0;
  const look = s.shot % ZOOMS.length;
  const width = s.stage.w * WIDE * ZOOMS[look]! * (1 + 0.02 * s.since);
  const k = width / a.w;
  const focusX = (hit.x + hit.w / 2 - a.w / 2) * k;
  const focusY = (hit.y + hit.h / 2 - a.h / 2) * k;
  const anchorX = box.x + box.w / 2;
  const anchorY = box.y + box.h * 0.4;
  const px = anchorX + (wide ? 30 : -focusX);
  const py = anchorY - (wide ? focusY * 0.25 : focusY);
  const rot = TILTS[look]!;
  const shear = wide ? -0.03 : 0;
  const enter = wide ? eBack(t / 0.3, 1.3) : 1;
  ctx.save();
  ctx.translate(0, (1 - enter) * 900);
  s.page(a, px, py, width, rot, shear);
  const sweep = eIO((t - b.dur * MARKER_AT) / MARKER_SEC);
  if (sweep > 0) {
    ctx.save();
    ctx.translate(px, py); ctx.rotate(rot); ctx.transform(1, shear, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = C.gold;
    for (const h of proof.boxes) {
      s.roundBox((h.x - a.w / 2) * k - 8, (h.y - a.h / 2) * k - 4, (h.w * k + 16) * sweep, h.h * k + 8, 8);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
  s.chip(chipLabel(b), box.x, box.y + 56, t);
}
