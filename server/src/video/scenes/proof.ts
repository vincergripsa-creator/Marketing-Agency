/**
 * The real page of the real guide, full bleed: the viewer meets the page, the camera punches in on the real line and the
 * marker sweeps it, the camera following. On a phone that line reads at the size of a message. The strongest shot of the
 * ad, and no storyboard could do it. Each shot of the cut is a jump of this camera; a plain editor holds one frame on the line.
 */
import { saidSpan } from '../../deliverables/videoCut.js';
import type { Proof, SceneApi } from '../compose.js';
import type { Rect } from '../stage.js';
import { clamp01, eBack, eIO, type TimelineBeat } from '../timeline.js';
import { chipLabel, drawFact } from './fact.js';

const TIGHT = 3.6;             // px a point on the frame: 10 pt prints at 36 px, a phone's reading size
const TIGHT_STEP = [1, 1, 0.9];    // the jumps of the shots: shot 0 is the page, the later ones never lose the line
const PLAIN_STEP = [1, 0.9];       // a plain editor stays on the line: a cut is still a cut
const TILTS = [-0.012, 0.008, -0.006, 0.01];
const PLAIN_TIGHT = 3;
const OPENER_TIGHT = 2.7;       // an opener is a picture: the camera keeps its numeral with the line
const LINE_MARGIN = 50;        // a line never touches the sides of the frame
const REST_MARGIN = 20;        // the push at rest may run into that margin, this far
const MIN_PUNCH = 1.18;        // on the full-bleed page: a punch-in is a real jump
const FOCUS_Y = 0.36;          // where the line rests, on the height of the safe band
const FOCUS_LOW = 0.6;         // the lowest it goes under the art of a tall frame
const FOCUS_OPEN = 0.74;       // on a frame with no art at its foot, the paper runs to the edge: a line near the foot of its page goes this low
const INK_REACH = 0.94;        // of the frame's height: the page's text reaches this far down, where no art takes over
const PUSH = 0.018;            // a second
const REST_PUSH = 0.0075;      // a second, once the whole mark rests: no frame is dead
const REST_MAX = 0.06;
const MARKER_AT = 0.16;        // of the beat, when the voice does not say the line
const MARKER_SEC = 0.8;
const ENTER_SEC = 0.28;
const HANDOFF_SEC = 0.42;      // the single-shot beat eases from the page to the line
const WIDE_SEC = 0.4;          // the viewer meets the page, however early the line comes
const BACK_SEC = 0.4;          // once marked, the camera steps back this long: the whole mark rests in the frame
const PAGE_CHIP = 32;
const CHIP_GAP = 16;
const CHIP_AT = 0.12;
const STRIP_H = 96;            // of the zone, under its top: the bar and the chips lie on paper, over no line of the page
const STRIP_FADE = 44;
const RETURN = 0.16;           // of an average line, on the marker's way: it waits there while the camera goes back for the next line

/**
 * Where the marker is on its way, 0..1 over the whole of it: along a line (`part`), then at its end (`back`) while the
 * camera goes to the start of the next one, the way an eye comes back at the end of a line. The ink waits for it.
 */
function markerAt(boxes: readonly Rect[], sweep: number): { line: number; part: number; back: number } {
  const length = boxes.reduce((sum, b) => sum + b.w, 0);
  const wrap = RETURN * length / boxes.length;
  let left = sweep * (length + wrap * (boxes.length - 1));
  for (let line = 0; ; line++) {
    const { w } = boxes[line]!;
    if (left <= w || line === boxes.length - 1) return { line, part: clamp01(left / Math.max(1, w)), back: 0 };
    left -= w;
    if (left < wrap) return { line, part: 1, back: left / wrap };
    left -= wrap;
  }
}

/** How far the marker has run along each of these lines. */
function marked(boxes: readonly Rect[], sweep: number): { box: Rect; part: number }[] {
  const { line, part } = markerAt(boxes, sweep);
  return boxes.map((box, i) => ({ box, part: i < line ? 1 : i === line ? part : 0 }));
}

/** The tip of the ink, in points. Null while it waits for the camera: nothing is being laid. */
export function markerTip(boxes: readonly Rect[], sweep: number): number | null {
  const { line, part, back } = markerAt(boxes, sweep);
  const box = boxes[line]!;
  return back > 0 ? null : box.x + box.w * part;
}

const leftOf = (boxes: readonly Rect[]): number => Math.min(...boxes.map((b) => b.x));
const rightOf = (boxes: readonly Rect[]): number => Math.max(...boxes.map((b) => b.x + b.w));

/** The camera once the line is marked: as close as it was, no closer than the whole mark allows. `floor` keeps it a punch-in. */
export const wholeMark = (boxes: readonly Rect[], k: number, floor: number, W: number, margin = LINE_MARGIN): number => Math.max(floor, Math.min(k, (W - margin * 2) / (rightOf(boxes) - leftOf(boxes))));

/** `sec` past the step back: the page goes on pushing, slowly, into the margin the whole mark left it, and never shrinks the type. */
export const restPush = (boxes: readonly Rect[], k: number, W: number, sec: number): number => wholeMark(boxes, k * (1 + Math.min(REST_MAX, REST_PUSH * Math.max(0, sec))), k, W, REST_MARGIN);

/**
 * Where the camera looks on the page, in points. Lines that fit the frame together stay centred: their start must not
 * leave it. Otherwise it reads the line the marker is on, panning inside that line when it is too long for the frame.
 * `rest`, 0..1: the line is marked, the camera comes back to the middle of the whole mark.
 */
export function aimAt(boxes: readonly Rect[], k: number, W: number, sweep: number, rest = 0): { x: number; y: number } {
  const x0 = leftOf(boxes);
  const x1 = rightOf(boxes);
  const half = (W / 2 - LINE_MARGIN) / k;
  const along = (box: Rect, part: number): number => (box.w / 2 <= half ? box.x + box.w / 2 : box.x + half + (box.w - half * 2) * part);
  const { line, part, back } = markerAt(boxes, sweep);
  const here = boxes[line]!;
  const next = boxes[line + 1] ?? here;
  const ease = eIO(back);
  const from = along(here, part);
  const y = here.y + here.h / 2 + (next.y - here.y) * ease;
  const centre = (x0 + x1) / 2;
  const x = (x1 - x0) / 2 <= half ? centre : from + (along(next, 0) - from) * ease;
  return { x: x + (centre - x) * rest, y };
}

/** When the voice reaches the line, and how long it takes to say it: the marker runs with the words. */
function lineTimes(b: TimelineBeat): { at: number; sec: number } {
  const span = b.proof ? saidSpan(b.proof.needle, b.words.map((w) => w.text)) : null;
  if (!span) return { at: b.dur * MARKER_AT, sec: MARKER_SEC };
  const at = b.words[span.from]!.at;
  return { at, sec: Math.max(MARKER_SEC, b.words[span.to]!.end - at) };
}

function drawMarker(s: SceneApi, proof: Proof, x: number, y: number, k: number, rot: number, sweep: number): void {
  const { ctx, C } = s;
  const a = proof.picture;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = C.marker;
  for (const { box, part } of marked(proof.boxes, sweep)) {
    if (part <= 0) continue;
    s.roundBox((box.x - a.w / 2) * k - 8, (box.y - a.h / 2) * k - 2, box.w * k * part + 16, box.h * k + 4, 8);
    ctx.fill();
  }
  ctx.restore();
}

export function drawProof(s: SceneApi, b: TimelineBeat, t: number): void {
  const proof = s.assets.proofs.get(b.index);
  if (!proof) { drawFact(s, b, t); return; }
  const { ctx, C, stage, column: box, timeline } = s;
  const { w: W, h: H } = stage;
  const { plain } = timeline;
  const a = proof.picture;
  // The sheet goes on past the page: a line near its foot still fills the frame.
  ctx.fillStyle = proof.paper;
  ctx.fillRect(0, 0, W, H);

  // Full bleed: the page covers the frame, then it comes close enough to read.
  const bleed = Math.max(W / a.w, H / a.h);
  const widest = Math.max(...proof.boxes.map((h) => h.w));
  const wanted = proof.headTop !== null ? OPENER_TIGHT : plain ? PLAIN_TIGHT : TIGHT;
  const tight = Math.max(bleed * MIN_PUNCH, Math.min(wanted, (W - LINE_MARGIN * 2) / widest));
  const steps = plain ? PLAIN_STEP : TIGHT_STEP;
  const look = s.shot % steps.length;
  const single = b.shotAt.length < 2;
  const line = s.memo(proof, () => lineTimes(b));
  const punchAt = Math.max(WIDE_SEC, Math.min(line.at, b.shotAt[1] ?? line.at)); // the camera is on the line when the voice reaches it
  const close = plain ? 1 : single ? eIO((t - Math.max(0, punchAt - HANDOFF_SEC)) / HANDOFF_SEC) : t >= punchAt ? 1 : 0;
  const pushed = (bleed + (tight * steps[look]! - bleed) * close) * (1 + PUSH * s.since);

  const markFrom = plain ? line.at : Math.max(line.at, punchAt); // the marker waits for the punch-in: it is the same gesture
  const sweep = eIO((t - markFrom) / line.sec);
  const backAt = Math.min(markFrom + line.sec, b.dur - BACK_SEC); // before the cut, when the voice runs to it
  const settled = eIO((t - backAt) / BACK_SEC);
  const k = restPush(proof.boxes, pushed + (wholeMark(proof.boxes, pushed, bleed * MIN_PUNCH, W) - pushed) * settled, W, t - backAt - BACK_SEC);
  const aim = aimAt(proof.boxes, k, W, sweep, settled);
  const focusX = (aim.x - a.w / 2) * k;
  const focusY = (aim.y - a.h / 2) * k;
  const top = stage.zones[0]!.y0;
  const safe = stage.zones.at(-1)!.y1 - top;
  // The line rests high in the safe band, unless that would leave bare paper under it: then it comes down, the page's ink with it.
  const inkEnd = (proof.inkEnd - a.h / 2) * k;
  const lowest = top + safe * (stage.band === null ? FOCUS_OPEN : FOCUS_LOW);
  const head = proof.headTop === null ? 0 : top + STRIP_H + (aim.y - proof.headTop) * k; // whole under the strip, never sliced by it
  const rest = Math.min(lowest, Math.max(top + safe * FOCUS_Y, (stage.band ?? H * INK_REACH) - inkEnd + focusY, head));
  const reach = Math.max(0, (a.w * k - W) / 2); // the sides of the page stay out of the frame
  const x = Math.max(W / 2 - reach, Math.min(W / 2 + reach, W / 2 - focusX * close));
  const y = (rest - focusY) * close + (H / 2) * (1 - close);
  const rot = plain ? 0 : TILTS[look]!;
  const enter = plain || s.shot > 0 ? 1 : eBack(t / ENTER_SEC, 1.2);
  ctx.save();
  ctx.translate(0, (1 - enter) * H * 0.5);
  s.page(a, x, y, a.w * k, rot, 0, 0);
  if (sweep > 0) drawMarker(s, proof, x, y, k, rot, sweep);
  ctx.restore();

  // The paper stops where it stops on every beat: the art takes the foot, the head stays clear for the bar and the chips.
  s.band(b.t0 + t);
  const stripEnd = top + STRIP_H;
  const strip = ctx.createLinearGradient(0, stripEnd - STRIP_FADE, 0, stripEnd);
  strip.addColorStop(0, proof.paper); strip.addColorStop(1, proof.paper.replace('rgb(', 'rgba(').replace(')', ',0)'));
  ctx.fillStyle = strip;
  ctx.fillRect(0, 0, W, stripEnd);
  const first = s.chip(chipLabel(b), box.x, box.y + 56, t);
  s.chip(`PAGE ${proof.page}`, box.x + first + CHIP_GAP, box.y + 48, t - CHIP_AT, C.dark, PAGE_CHIP);
}
