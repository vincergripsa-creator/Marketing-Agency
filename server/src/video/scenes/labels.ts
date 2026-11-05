/**
 * What a film says of itself (design plan D208), as the storyboard does: it is an ad, its narrator is drawn, its voice is
 * synthetic. One row of pills at the top of the safe column on every beat, white with dark type so it reads on any plate,
 * through `drawText` so QA proves it safe. The beat's own layout starts under the row: `framed` moves the column down.
 */
import { AD_LABEL, DRAWN_LABEL, VOICE_LABEL } from '../../deliverables/storyboard.js';
import type { SceneApi, SceneDraw } from '../compose.js';
import { FACE } from '../fonts.js';
import type { Rect } from '../stage.js';
import type { TimelineBeat } from '../timeline.js';

export const AD_TAG = AD_LABEL;
export const DRAWN_TAG = DRAWN_LABEL;
export const VOICE_TAG = VOICE_LABEL;

const SIZE = 28;
const PAD_X = 18;
const PILL_H = 46;
const GAP = 10;
const ROW_GAP = 8;
const BELOW = 18;              // between the row and what the beat sets under it

/** A narrator beat names its figure; a voiced beat names its voice, when the film has one. */
export function tagsOf(s: SceneApi, b: TimelineBeat): string[] {
  const voiced = !!s.assets.spec.voice && b.spoken.trim() !== '';
  return [AD_TAG, ...(b.kind === 'narrator' ? [DRAWN_TAG] : []), ...(voiced ? [VOICE_TAG] : [])];
}

/** The pills in rows that fit the column. */
function rowsOf(s: SceneApi, tags: readonly string[], width: number): { tag: string; w: number }[][] {
  s.font(SIZE, FACE.semi);
  const rows: { tag: string; w: number }[][] = [[]];
  let used = 0;
  for (const tag of tags) {
    const w = s.ctx.measureText(tag).width + PAD_X * 2;
    const row = rows[rows.length - 1]!;
    if (row.length && used + GAP + w > width) { rows.push([{ tag, w }]); used = w; continue; }
    used += (row.length ? GAP : 0) + w;
    row.push({ tag, w });
  }
  return rows;
}

/** The height the row takes at the top of the column, its gap under it included. */
export function bandOf(s: SceneApi, b: TimelineBeat, column: Rect = s.column): number {
  const rows = rowsOf(s, tagsOf(s, b), column.w);
  return rows.length * PILL_H + (rows.length - 1) * ROW_GAP + BELOW;
}

function paint(s: SceneApi, b: TimelineBeat, column: Rect): void {
  const { ctx } = s;
  const rows = rowsOf(s, tagsOf(s, b), column.w);
  ctx.save();
  s.font(SIZE, FACE.semi);
  ctx.textAlign = 'left';
  rows.forEach((row, r) => {
    let x = column.x;
    const y = column.y + r * (PILL_H + ROW_GAP);
    for (const { tag, w } of row) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      s.roundBox(x, y, w, PILL_H, PILL_H / 2);
      ctx.fill();
      ctx.fillStyle = '#16161a';
      s.drawText(tag, x + PAD_X, y + PILL_H / 2 + SIZE * 0.36);
      x += w + GAP;
    }
  });
  ctx.restore();
}

/** A scene with its mentions: the column (and the hook's box) start under the row, the row is drawn over the finished beat. */
export function framed(draw: SceneDraw): SceneDraw {
  return (s, b, t) => {
    const column = s.column;
    const band = bandOf(s, b, column);
    s.column = { ...column, y: column.y + band, h: column.h - band };
    if (s.hero.y < s.column.y) s.hero = { ...s.hero, y: s.column.y, h: s.hero.h - (s.column.y - s.hero.y) };
    draw(s, b, t);
    paint(s, b, column);
  };
}
