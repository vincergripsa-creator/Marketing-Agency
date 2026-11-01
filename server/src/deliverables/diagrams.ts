/**
 * Diagrams that show what the content means (pdf §9): a loop is drawn as a loop, a plan as bars on a calendar, a choice as a ladder.
 * Each one returns a Scene, flat and in ink, and its height, so a page can place it before drawing it.
 * No number is ever added to the writer's words: the only figures set here are ranks and axes, which count things and claim nothing.
 */
import { clamp } from '../core/index.js';
import type { InkSet, VisualSpec } from '../shared.js';
import { ensureContrast, mix, readableOn } from './color.js';
import { advance, fitDisplay, sanitizeFor, wrapFace, type FaceName } from './fonts.js';
import { n, Scene } from './scene.js';
import type { Voice } from './voices.js';

/** `ticks`: the rows of a figure carry the boxes of the checklist they replace. */
export interface FigureStyle { voice: Voice; inks: InkSet; ticks?: boolean }
export interface Diagram { scene: Scene; height: number }

type Draw = (v: VisualSpec, width: number, style: FigureStyle) => Diagram | null;

interface Pen { s: Scene; aText: string; bText: string; barInk: string[] }
interface Box { x: number; top: number; font: FaceName; size: number; leading: number; fill: string; anchor?: 'start' | 'middle' | 'end' }

const BASE = 3.6;             // every vertical metric of a guide is a multiple of it (pdf §4.3)
const H2 = { size: 19, leading: 21.6 };
const LABEL = { size: 10, leading: 13 };
const BODY = { size: 9.6, leading: 12.8 };
const TINT = 0.22;
const PAD = 14;               // inside a tint panel
const RAD = Math.PI / 180;

const NODE = 15;              // radius of a cycle's node
const LINK = 6;               // clear space between a node and the arcs that reach it
const LABEL_OFF = 11;         // from a node's edge to its label
const SIDE_OF = 0.15;         // a node this close to the vertical axis keeps its label centred over it
const START = -90;            // the first node sits at twelve o'clock
const MAX_NODES = 8;          // past that a ring stops reading as one loop, its labels fall back on `labels`

const clean = (s: unknown, face: FaceName): string => sanitizeFor(face, String(s ?? '')).trim();
const linesOf = (s: unknown, face: FaceName, size: number, width: number): string[] => wrapFace(clean(s, face), face, size, width);

const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => [cx + r * Math.cos(deg * RAD), cy + r * Math.sin(deg * RAD)];

function arcD(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M${n(x0)} ${n(y0)}A${n(r)} ${n(r)} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${n(x1)} ${n(y1)}`;
}

/** Sets whole lines from the top of their box. The first baseline sits one size below it. */
function setLines(p: Pen, lines: string[], b: Box): number {
  lines.forEach((l, k) => p.s.text(l, b.x, b.top + b.size + k * b.leading, b.font, b.size, b.fill, b.anchor ? { anchor: b.anchor } : {}));
  return lines.length * b.leading;
}

/** Starts a figure: its pen and, under the title in the section-heading role, the y where the drawing begins. */
function start(title: string, width: number, { voice, inks }: FigureStyle): { p: Pen; top: number } {
  const on = mix(inks.paper, inks.c, TINT); // the darkest ground a diagram's text sits on
  const p: Pen = { s: new Scene(width, 0), aText: ensureContrast(inks.a, on, 4.5), bText: ensureContrast(inks.b, on, 4.5), barInk: [inks.a, inks.b, inks.ink] };
  const head = setLines(p, linesOf(title, voice.deck, H2.size, width), { x: 0, top: 0, font: voice.deck, ...H2, fill: inks.ink });
  return { p, top: head ? head + 2 * BASE : 0 };
}

/** The drawing ends here: its height snaps to the baseline unit, so what follows stays on the page's rhythm. */
function finish(p: Pen, bottom: number): Diagram {
  const height = Math.round(Math.ceil(bottom / BASE - 1e-6) * BASE * 100) / 100;
  p.s.h = height;
  return { scene: p.s, height };
}

/** A loop on a ring: one arc per link, the last one back to the first node, the broken link marked, each label outside on its node's side. */
export const cycleDiagram: Draw = (v, width, style) => {
  const { voice, inks } = style;
  const nodes = (v.cycle?.nodes ?? []).map((l) => clean(l, voice.textB)).filter(Boolean);
  if (nodes.length < 3 || nodes.length > MAX_NODES) return null;
  const { p, top } = start(v.title, width, style);
  const count = nodes.length;
  const step = 360 / count;
  const R = Math.max(clamp(width * 0.17, 62, 84), 9.6 * count); // never so tight that a link has no visible arc
  const out = R + NODE + LABEL_OFF;
  const cx = width / 2;
  const angle = (i: number) => START + i * step;
  const labels = nodes.map((text, i) => {
    const cos = Math.cos(angle(i) * RAD);
    const sin = Math.sin(angle(i) * RAD);
    const side = cos > SIDE_OF ? 1 : cos < -SIDE_OF ? -1 : 0;
    const x = out * cos;
    const room = side ? width / 2 - Math.abs(x) - PAD : Math.min(190, width - 2 * PAD);
    const lines = wrapFace(text, voice.textB, LABEL.size, Math.max(48, Math.min(170, room)));
    const h = lines.length * LABEL.leading;
    const y = out * sin;
    return { lines, side, x, h, top: sin < -0.8 ? y - h : sin > 0.8 ? y : y - h / 2 };
  });
  for (const side of [-1, 1]) {
    const rows = labels.filter((l) => l.side === side).sort((a, b) => a.top - b.top);
    rows.forEach((l, k) => { if (k) l.top = Math.max(l.top, rows[k - 1]!.top + rows[k - 1]!.h + 3); }); // a tall label pushes the next one down
  }
  const sides = labels.filter((l) => l.side);
  for (const l of labels.filter((x) => !x.side)) { // the labels at twelve and six o'clock clear whatever the sides pushed into them
    l.top = l.top < 0 ? Math.min(l.top, ...sides.map((x) => x.top - l.h - 3)) : Math.max(l.top, ...sides.map((x) => x.top + x.h + 3));
  }
  const up = Math.min(-R - NODE, ...labels.map((l) => l.top));
  const down = Math.max(R + NODE, ...labels.map((l) => l.top + l.h));
  const cy = top + PAD - up;
  const bottom = cy + down + PAD;
  p.s.rect(0, top, width, bottom - top, inks.c, { op: TINT });
  const broken = Number.isFinite(v.cycle?.breakAt) ? ((Math.trunc(v.cycle!.breakAt) % count) + count) % count : 1;
  const gap = (NODE + LINK) / R / RAD;
  for (let i = 0; i < count; i++) {
    const a1 = angle(i + 1) - gap;
    const ink = i === broken ? inks.b : inks.ink;
    p.s.path(arcD(cx, cy, R, angle(i) + gap, a1), undefined, { stroke: ink, sw: i === broken ? 2.6 : 1.6, ...(i === broken ? { dash: [5, 5] as [number, number] } : {}) });
    const [ax, ay] = polar(cx, cy, R, a1);
    const [hx1, hy1] = polar(ax, ay, 9, a1 + 90 + 155);
    const [hx2, hy2] = polar(ax, ay, 9, a1 + 90 - 155);
    p.s.path(`M${n(ax)} ${n(ay)}L${n(hx1)} ${n(hy1)}L${n(hx2)} ${n(hy2)}Z`, ink);
  }
  nodes.forEach((_, i) => {
    const [nx, ny] = polar(cx, cy, R, angle(i));
    p.s.circle(nx, ny, NODE, inks.a);
    p.s.text(String(i + 1), nx, ny + 4.6, voice.deck, 13, readableOn(inks.a, inks.ink, inks.paper), { anchor: 'middle' });
  });
  for (const l of labels) {
    const anchor = l.side > 0 ? 'start' : l.side < 0 ? 'end' : 'middle';
    setLines(p, l.lines, { x: cx + l.x, top: cy + l.top, font: voice.textB, ...LABEL, fill: inks.ink, anchor });
  }
  const [mx, my] = polar(cx, cy, R, angle(broken + 0.5));
  p.s.circle(mx, my, R / 7, inks.paper, { stroke: inks.b, sw: 1.6 });
  p.s.path(`M${n(mx - 4.5)} ${n(my - 4.5)}L${n(mx + 4.5)} ${n(my + 4.5)}M${n(mx + 4.5)} ${n(my - 4.5)}L${n(mx - 4.5)} ${n(my + 4.5)}`, undefined, { stroke: inks.b, sw: 2 });
  const center = clean(v.cycle?.center, voice.displayIt);
  if (center) {
    const leading = 1.2;
    const fit = fitDisplay(center, voice.displayIt, { width: 2 * (R - NODE) - 18, max: 12.5, min: 9, maxLines: 3, maxHeight: 2 * (R - NODE) - 24, leading });
    const lead = fit.size * leading;
    setLines(p, fit.lines, { x: cx, top: cy - (fit.lines.length * lead) / 2 - fit.size * 0.18, font: voice.displayIt, size: fit.size, leading: lead, fill: p.aText, anchor: 'middle' });
  }
  return finish(p, bottom);
};

/** Tracks as bars under a calendar: day numbers on top, a bar per track, dashed week rules behind the bars. Labels keep their own column, so a short bar loses nothing. */
export const planPath: Draw = (v, width, style) => {
  const { voice, inks } = style;
  const days = Math.floor(v.plan?.days ?? 0);
  const tracks = (v.plan?.tracks ?? []).map((t) => ({ ...t, lines: linesOf(t.label, voice.textB, BODY.size, Math.round(width * 0.38)) })).filter((t) => t.lines.length && Number.isFinite(t.from) && Number.isFinite(t.to));
  if (days < 1 || !tracks.length) return null;
  const { p, top } = start(v.title, width, style);
  const left = Math.round(width * 0.38) + 14;
  const cell = (width - left) / days;
  const unit = clean(v.plan?.unit, voice.labelB);
  const daily = /^(jour|nuit|soir)/iu.test(unit);
  const need = advance(voice.labelB, String(days), 8.4) + 3;
  let every = cell < need ? (daily ? 7 : 5) : 1;
  while (cell * every < need) every *= 2; // a long plan keeps its axis readable: 1, 7, 14…
  const axis = top + 9;
  if (unit) p.s.text(unit.toUpperCase(), 0, axis, voice.labelB, 7.8, inks.ink, { track: 1.6 });
  for (let d = 1; d <= days; d++) {
    if (d !== 1 && d % every) continue;
    const x = left + (d - 0.5) * cell;
    if (x + advance(voice.labelB, String(d), 8.4) / 2 <= width) p.s.text(String(d), x, axis, voice.labelB, 8.4, inks.ink, { anchor: 'middle' });
  }
  const first = axis + 8;
  const rows = tracks.map((t) => ({ ...t, h: Math.max(t.lines.length * BODY.leading, 14) + 8 }));
  const bottom = first + rows.reduce((sum, r) => sum + r.h, 0);
  if (daily) for (let d = 7; d < days; d += 7) p.s.line(left + d * cell, first - 4, left + d * cell, bottom, inks.ink, 0.5, { dash: [2, 3] });
  let y = first;
  rows.forEach((r, k) => {
    const from = clamp(Math.floor(r.from), 1, days);
    const to = clamp(Math.floor(r.to), from, days);
    p.s.rect(left + (from - 1) * cell, y, (to - from + 1) * cell, 14, p.barInk[k % p.barInk.length]!);
    setLines(p, r.lines, { x: 0, top: y, font: voice.textB, ...BODY, fill: inks.ink });
    y += r.h;
  });
  return finish(p, bottom);
};

/** « Si … alors … » as a ladder: one stem, one rung per case, nothing crosses. */
export const decisionTree: Draw = (v, width, style) => {
  const { voice, inks } = style;
  const cases = (v.tree?.cases ?? []).filter((c) => clean(c.when, voice.textB) && clean(c.then, voice.text));
  if (!cases.length) return null;
  const { p, top } = start(v.title, width, style);
  const root = linesOf(v.tree?.question, voice.deck, 12.5, width - 28);
  const rootH = root.length * 17 + 14;
  p.s.rect(0, top, width, rootH, inks.ink);
  setLines(p, root, { x: 14, top: top + 7, font: voice.deck, size: 12.5, leading: 17, fill: inks.paper });
  const stem = 14;
  const rung = 10;
  const whenX = 34;
  const whenW = Math.round(width * 0.36);
  const thenX = whenX + whenW + 22;
  const thenW = width - thenX;
  let y = top + rootH + 10;
  let last = y;
  cases.forEach((c, i) => {
    const when = linesOf(c.when, voice.textB, BODY.size, whenW - 8);
    const then = linesOf(c.then, voice.text, BODY.size, thenW);
    const mid = y + 6;
    last = mid;
    p.s.line(stem, mid, 26, mid, inks.ink, 1);
    p.s.circle(26, mid, 2.6, i % 2 ? inks.b : inks.a);
    setLines(p, when, { x: whenX, top: y, font: voice.textB, ...BODY, fill: inks.ink });
    p.s.line(whenX + whenW - 4, mid, thenX - 8, mid, inks.b, 1.2);
    p.s.path(`M${n(thenX - 4)} ${n(mid)}l-6 -3.4v6.8Z`, inks.b);
    setLines(p, then, { x: thenX, top: y, font: voice.text, ...BODY, fill: inks.ink });
    y += Math.max(when.length, then.length) * BODY.leading + rung;
    if (i < cases.length - 1) p.s.line(whenX, y - 4, width, y - 4, inks.ink, 0.25);
  });
  p.s.line(stem, top + rootH, stem, last, inks.ink, 1);
  return finish(p, y - rung); // the air under a rung is the page's, once the last one is drawn
};

/** Each mistake beside its fix: before on the left, after on a tinted column, an arrow on every row. */
export const beforeAfter: Draw = (v, width, style) => {
  const { voice, inks } = style;
  const gutter = 30;
  const colW = (width - gutter) / 2;
  const inner = colW - 2 * 8;
  const rows = (v.pairs ?? []).map((r) => ({ before: linesOf(r.before, voice.text, BODY.size, colW), after: linesOf(r.after, voice.textB, BODY.size, inner) })).filter((r) => r.before.length && r.after.length);
  if (!rows.length) return null;
  const { p, top } = start(v.title, width, style);
  const afterX = colW + gutter;
  const head = top + 22;
  const heights = rows.map((r) => Math.max(r.before.length, r.after.length) * BODY.leading + 10);
  const bottom = head + heights.reduce((sum, h) => sum + h, 0);
  p.s.rect(afterX, top, colW, bottom - top, inks.c, { op: TINT });
  p.s.text('AVANT', 0, top + 13, voice.labelB, 8, p.bText, { track: 1.6 });
  p.s.text('APRÈS', afterX + 8, top + 13, voice.labelB, 8, p.aText, { track: 1.6 });
  p.s.line(0, head - 1, width, head - 1, inks.ink, 0.9);
  let y = head;
  rows.forEach((r, i) => {
    setLines(p, r.before, { x: 0, top: y + 3, font: voice.text, ...BODY, fill: inks.ink });
    setLines(p, r.after, { x: afterX + 8, top: y + 3, font: voice.textB, ...BODY, fill: inks.ink });
    const mid = y + 9.5;
    p.s.line(colW + 7, mid, afterX - 10, mid, inks.b, 1.2);
    p.s.path(`M${n(afterX - 6)} ${n(mid)}l-6 -3.4v6.8Z`, inks.b);
    y += heights[i]!;
    if (i < rows.length - 1) p.s.line(0, y, width, y, inks.ink, 0.25);
  });
  return finish(p, bottom);
};

/** Four lists on a cross of hairlines. Words, no axis. */
export const matrixDiagram: Draw = (v, width, style) => {
  const { voice, inks } = style;
  const gap = 28;
  const colW = (width - gap) / 2;
  const marker = 10;
  const quads = [0, 1, 2, 3].map((k) => {
    const head = linesOf(v.matrix?.heads?.[k], voice.deck, 12.5, colW);
    const items = (v.matrix?.cells?.[k] ?? []).map((c) => linesOf(c, voice.text, BODY.size, colW - marker)).filter((l) => l.length);
    return { head, items, h: head.length * 15 + 6 + items.reduce((sum, l) => sum + l.length * BODY.leading + 4, 0) };
  });
  if (quads.every((q) => !q.items.length)) return null;
  const { p, top } = start(v.title, width, style);
  const upper = Math.max(quads[0]!.h, quads[1]!.h);
  const lower = Math.max(quads[2]!.h, quads[3]!.h);
  const rule = top + upper + 10;
  const bottom = rule + 12 + lower;
  p.s.line(0, rule, width, rule, inks.ink, 0.6);
  p.s.line(colW + gap / 2, top, colW + gap / 2, bottom, inks.ink, 0.6);
  quads.forEach((q, k) => {
    const x = k % 2 ? colW + gap : 0;
    let y = k < 2 ? top : rule + 12;
    y += setLines(p, q.head, { x, top: y, font: voice.deck, size: 12.5, leading: 15, fill: p.aText }) + 6;
    for (const item of q.items) {
      p.s.rect(x, y + 5.4, 3.6, 3.6, inks.b);
      y += setLines(p, item, { x: x + marker, top: y, font: voice.text, ...BODY, fill: inks.ink }) + 4;
    }
  });
  return finish(p, bottom);
};

/** Blank rulers from 0 to 10 for the reader to circle. It holds no value at all: nothing on it is ever filled in. */
export const gaugeDiagram: Draw = (v, width, style) => {
  const { voice, inks } = style;
  const textW = Math.round(width * 0.42);
  const left = textW + 16;
  const rulerW = width - left;
  const rows = (v.gauge?.rows ?? []).map((r) => linesOf(r, voice.textB, BODY.size, textW)).filter((l) => l.length);
  if (!rows.length) return null;
  const { p, top } = start(v.title, width, style);
  const cell = rulerW / 11;
  const inset = cell / 2 - 3; // the end words line up with the digits 0 and 10
  const ends = rulerW / 2 - inset - 4;
  const low = linesOf(v.gauge?.low, voice.label, 8, ends);
  const high = linesOf(v.gauge?.high, voice.label, 8, ends);
  const head = Math.max(low.length, high.length) * 10;
  setLines(p, low, { x: left + inset, top, font: voice.label, size: 8, leading: 10, fill: inks.ink });
  setLines(p, high, { x: width - inset, top, font: voice.label, size: 8, leading: 10, fill: inks.ink, anchor: 'end' });
  let y = top + head + 4;
  rows.forEach((lines) => {
    p.s.line(0, y, width, y, inks.ink, 0.3);
    const h = Math.max(lines.length * BODY.leading, 18) + 10;
    setLines(p, lines, { x: 0, top: y + 5, font: voice.textB, ...BODY, fill: inks.ink });
    const line = y + 19;
    p.s.line(left + cell / 2, line, width - cell / 2, line, inks.ink, 0.8);
    for (let k = 0; k <= 10; k++) {
      const x = left + (k + 0.5) * cell;
      p.s.line(x, line - 3, x, line + 3, inks.ink, 0.8);
      p.s.text(String(k), x, line - 6, voice.labelB, 8.4, inks.ink, { anchor: 'middle' });
    }
    y += h;
  });
  p.s.line(0, y, width, y, inks.ink, 0.3);
  return finish(p, y + 1);
};

/** The method as a line with its stations: each one says its real moment and duration, and nothing when it has none. */
export const stepPath: Draw = (v, width, style) => {
  const { voice, inks, ticks } = style;
  const disc = 11;
  const gap = 10;
  const box = 13;
  const textX = 2 * disc + 12;
  const textW = width - textX - (ticks ? box + 14 : 0);
  const stations = (v.path?.stations ?? []).map((st) => {
    const meta = [clean(st.when, voice.label), clean(st.duration, voice.label)].filter(Boolean).join(' · ');
    const label = linesOf(st.label, voice.textB, LABEL.size, textW);
    const info = wrapFace(meta, voice.label, 8.2, textW);
    return { label, info, h: Math.max(2 * disc, label.length * LABEL.leading + info.length * 11) + gap };
  }).filter((st) => st.label.length);
  if (!stations.length) return null;
  const { p, top } = start(v.title, width, style);
  let y = top;
  stations.forEach((st, i) => {
    if (i < stations.length - 1) p.s.line(disc, y + 2 * disc, disc, y + st.h, inks.a, 2.4);
    p.s.circle(disc, y + disc, disc, inks.a);
    p.s.text(String(i + 1), disc, y + disc + 4, voice.deck, 11, readableOn(inks.a, inks.ink, inks.paper), { anchor: 'middle' });
    const under = setLines(p, st.label, { x: textX, top: y + 1, font: voice.textB, ...LABEL, fill: inks.ink });
    setLines(p, st.info, { x: textX, top: y + 1 + under, font: voice.label, size: 8.2, leading: 11, fill: p.aText });
    if (ticks) p.s.rect(width - box, y + disc - box / 2, box, box, undefined, { stroke: inks.ink, sw: 0.8 });
    y += st.h;
  });
  return finish(p, y - gap);
};

const DRAW: Partial<Record<VisualSpec['type'], Draw>> = {
  cycle: cycleDiagram, plan_path: planPath, decision_tree: decisionTree, before_after: beforeAfter, matrix: matrixDiagram, gauge: gaugeDiagram, step_path: stepPath,
};

/**
 * The drawing of a visual, or null when this file has none for it: an older type, or a spec with nothing in it.
 * The caller then falls back on `labels`, which keep a plain version of the same data. Old saves drew « La boucle à casser »
 * as a `steps_diagram`, four boxes in a row: its labels are the loop, so it comes back as a ring.
 */
export function diagramFor(v: VisualSpec, width: number, style: FigureStyle): Diagram | null {
  if (v.type === 'steps_diagram' && /\bboucle\b/iu.test(v.title ?? '')) return cycleDiagram({ ...v, cycle: { nodes: v.labels ?? [], breakAt: 1, center: '' } }, width, style);
  return DRAW[v.type]?.(v, width, style) ?? null;
}
