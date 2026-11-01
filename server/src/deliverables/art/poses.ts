/**
 * The hero of a chapter (D66): the family stays, the picture changes. Eight poses of one drawing, cut on the unit grid of
 * their box, so that a guide opens each chapter on a picture of its own and still reads as one object. A pose is chosen from
 * what the chapter says, and two chapters of a guide never share one.
 */
import type { DesignSpec, InkSet } from '../../shared.js';
import { contrast } from '../color.js';
import { n, type Scene } from '../scene.js';
import { hashString, normalizeKey } from '../text.js';
import { placeHero, type HeroBox } from './heroes.js';
import { DRAWN_AS, mark, quarterD, type DrawnMotif } from './tiles.js';

export type Pose = 'portrait' | 'closeup' | 'array' | 'trail' | 'counter' | 'target' | 'stairs' | 'arch';

export const POSES: readonly Pose[] = ['portrait', 'closeup', 'array', 'trail', 'counter', 'target', 'stairs', 'arch'];

/** What a chapter talks about, on an accent-free title: the search, the path, the two sides, the plan that grows. */
const ASKED: readonly (readonly [RegExp, Pose])[] = [
  [/\b(pourquoi|comprendre|boucle|cause|origine|mecanisme)/, 'closeup'],
  [/\b(observ|diagnosti|point de depart|bilan|reperer|ou en)/, 'array'],
  [/\b(erreur|piege|eviter|ecueil|faux)/, 'counter'],
  [/\b(plan|jour|semaine|calendrier|programme|mois)/, 'stairs'],
  [/\b(geste|etape|methode|procedure|reglage|comment)/, 'trail'],
  [/\b(situation|cas |coince|resistance|imprevu|si )/, 'target'],
  [/\b(garder|durer|acquis|tenir|long terme|reflexe|bonus|cadeau)/, 'arch'],
];

/** A close-up frames this point of the drawing, in shares of its box: where it says what it is, and no shape left grazing its edge. */
const FOCUS: Record<DrawnMotif, readonly [number, number]> = {
  moon: [0.3, 0.52], sun: [0.445, 0.33], paw: [0.5, 0.34], heart: [0.42, 0.42], leaf: [0.56, 0.5], coin: [0.5, 0.43], chart: [0.72, 0.52], home: [0.46, 0.44], brush: [0.46, 0.54],
};

const CLOSE_UP = 1.75;
const MIN_ACCENT = 2;
const GROUNDS: readonly (keyof InkSet)[] = ['a', 'c', 'ink', 'b'];
/** What may close a section: a picture made of signs. The two poses of the drawing itself stay with the cover and the openers. */
const CLOSES: readonly Pose[] = ['trail', 'array', 'counter', 'stairs', 'target', 'arch'];

/**
 * One pose per chapter, in the order of `titles`. A chapter takes the pose its title asks for while it is free; the others
 * follow an order of their own to the guide, and only past eight openers does a pose come back.
 */
export function posesOf(titles: readonly string[], seed: number): Pose[] {
  const order = [...POSES].sort((a, b) => hashString(`${seed}|${a}`) - hashString(`${seed}|${b}`));
  const taken = new Set<Pose>();
  const poses = titles.map((title) => {
    const key = ` ${normalizeKey(title)} `;
    const asked = ASKED.find(([re, pose]) => !taken.has(pose) && re.test(key));
    if (asked) taken.add(asked[1]);
    return asked?.[1] ?? null;
  });
  const left = order.filter((p) => !taken.has(p));
  const filled = poses.map((pose) => pose ?? left.shift() ?? null);
  const drawn = filled.filter((pose) => pose !== null);
  // the neighbour's pose: the other size of hero, so that the picture itself still differs
  return filled.map((pose, k) => pose ?? drawn[(k + 1) % drawn.length]!);
}

/**
 * The hero of each section's band, `count` of them: never the pose of the opener of its section, never the one of the band
 * before it, and the least used of a guide's own order, so that a guide closes each section on another picture.
 */
export function closesOf(poses: readonly Pose[], count: number, seed: number): Pose[] {
  const order = [...CLOSES].sort((a, b) => hashString(`${seed}|end|${a}`) - hashString(`${seed}|end|${b}`));
  const uses = new Map<Pose, number>();
  const out: Pose[] = [];
  for (let k = 0; k < count; k++) {
    const free = order.filter((p) => p !== poses[k] && p !== out[k - 1]);
    const pose = [...free].sort((a, b) => (uses.get(a) ?? 0) - (uses.get(b) ?? 0))[0]!;
    uses.set(pose, (uses.get(pose) ?? 0) + 1);
    out.push(pose);
  }
  return out;
}

/** The ground of a chapter's hero. The two poses that show the drawing itself keep the one it was drawn for. */
export function poseGround(pose: Pose, number: number, seed: number): keyof InkSet | undefined {
  return pose === 'portrait' || pose === 'closeup' ? undefined : GROUNDS[((number + seed) >>> 0) % GROUNDS.length];
}

/** The other inks by how well they read on `ground`, the strongest first. */
function inksOn(inks: InkSet, ground: keyof InkSet): string[] {
  return (Object.keys(inks) as (keyof InkSet)[]).filter((k) => k !== ground).map((k) => inks[k]).sort((a, b) => contrast(b, inks[ground]) - contrast(a, inks[ground]));
}

/** An ink that stands out from `fg` and still reads on the ground. */
function accentOn(on: string[], fg: string, bg: string): string {
  const readable = on.filter((ink) => ink !== fg && contrast(ink, bg) >= MIN_ACCENT);
  return [...(readable.length ? readable : on)].sort((a, b) => contrast(b, fg) - contrast(a, fg))[0]!;
}

interface Pen { m: DrawnMotif; box: HeroBox; units: number; bg: string; on: string[]; hot: string; best: string; pick: number; paper: string }

/** A grid of signs, one tile each, and the one to look at. */
function array(s: Scene, { m, box, units, bg, on, hot, pick }: Pen): void {
  const u = box.size / units;
  const odd = pick % (units * units);
  for (let r = 0; r < units; r++) {
    for (let c = 0; c < units; c++) mark(s, m, box.x + (c + 0.5) * u, box.y + (r + 0.5) * u, u * 0.68, r * units + c === odd ? hot : on[0]!, bg);
  }
}

/** A way across the picture, one side then the other: the signs grow as they go, and the last one has arrived. */
function trail(s: Scene, { m, box, bg, on, hot, pick }: Pen): void {
  const steps = 5;
  const size = box.size;
  const side = pick % 2 ? 1 : -1;
  for (let k = 0; k < steps; k++) {
    const t = k / (steps - 1);
    const off = (k % 2 ? side : -side) * size * 0.07;
    mark(s, m, box.x + size * (0.2 + 0.6 * t) + off, box.y + size * (0.8 - 0.6 * t) + off, size * (0.19 + 0.05 * t), k === steps - 1 ? hot : on[0]!, bg, 38);
  }
}

/**
 * The same sign on two grounds, each in the other's ink: the two sides of one thing. The pane stays inside the ground, the one
 * ink the tiles around a hero keep off.
 */
function counter(s: Scene, { m, box, bg, on }: Pen): void {
  const { x, y, size } = box;
  const fg = on[0]!;
  const inset = size * 0.07;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const big = size * 0.76;
  mark(s, m, cx, cy, big, fg, bg);
  const pane = `M${n(cx)} ${n(y + inset)}H${n(x + size - inset)}V${n(y + size - inset)}H${n(cx)}Z`;
  s.path(pane, fg);
  s.clip(pane, (cl) => mark(cl, m, cx, cy, big, bg, fg));
}

/** Rings closing on the sign: the one case to aim for. */
function target(s: Scene, { m, box, bg, on, hot, best }: Pen): void {
  const cx = box.x + box.size / 2;
  const cy = box.y + box.size / 2;
  const r = box.size / 2;
  s.circle(cx, cy, r * 0.94, on[0]);
  s.circle(cx, cy, r * 0.72, bg);
  s.circle(cx, cy, r * 0.5, hot);
  mark(s, m, cx, cy, r * 0.6, best, hot);
}

/** Columns of signs that rise, one more each time: a plan that adds up. */
function stairs(s: Scene, { m, box, units, bg, on, hot }: Pen): void {
  const u = box.size / units;
  s.path(quarterD(box.x, box.y, u * (units - 1.5), 0), on[1]);
  for (let c = 0; c < units; c++) {
    for (let r = 0; r <= c; r++) mark(s, m, box.x + (c + 0.5) * u, box.y + box.size - (r + 0.5) * u, u * 0.68, r === c ? hot : on[0]!, bg);
  }
}

/** A door in the picture, the sign under it: what stays once the chapter is closed. */
function arch(s: Scene, { m, box, bg, on, paper }: Pen): void {
  const { x, y, size } = box;
  // both doors go down to the page under the picture: in the ink of the page, nothing would say where they stop
  const [fg, rim] = on.filter((ink) => ink !== paper) as [string, string];
  const foot = y + size;
  const door = (inset: number, top: number, fill: string) => {
    const r = size / 2 - inset;
    s.path(`M${n(x + inset)} ${n(foot)}V${n(top + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + size - inset)} ${n(top + r)}V${n(foot)}Z`, fill);
  };
  door(size * 0.1, y + size * 0.01, rim);
  door(size * 0.19, y + size * 0.1, fg);
  mark(s, m, x + size / 2, foot - size * 0.32, size * 0.384, bg, fg);
}

const DRAWN: Record<Exclude<Pose, 'portrait' | 'closeup'>, (s: Scene, pen: Pen) => void> = { array, trail, counter, target, stairs, arch };

/** The hero of a chapter on its ground, cropped by its box. `units` is the box in tiles: a pose sits on their grid. */
export function drawPose(s: Scene, pose: Pose, motif: DesignSpec['motif'], box: HeroBox, units: number, inks: InkSet, seed: number, ground: keyof InkSet | undefined, pick: number): void {
  if (pose === 'portrait') {
    placeHero(s, motif, box, inks, seed, ground);
    return;
  }
  if (pose === 'closeup') {
    const [fx, fy] = FOCUS[DRAWN_AS[motif]];
    const size = box.size * CLOSE_UP;
    placeHero(s, motif, { x: box.x + box.size * 0.5 - size * fx, y: box.y + box.size * 0.5 - size * fy, size }, inks, seed, ground, box);
    return;
  }
  const at = ground ?? 'a';
  const bg = inks[at];
  const on = inksOn(inks, at);
  const hot = accentOn(on, on[0]!, bg);
  const best = [bg, ...on].sort((a, b) => contrast(b, hot) - contrast(a, hot))[0]!;
  const square = `M${n(box.x)} ${n(box.y)}h${n(box.size)}v${n(box.size)}h${n(-box.size)}Z`;
  s.path(square, bg);
  s.clip(square, (cl) => DRAWN[pose](cl, { m: DRAWN_AS[motif], box, units, bg, on, hot, best, pick, paper: inks.paper }));
}
