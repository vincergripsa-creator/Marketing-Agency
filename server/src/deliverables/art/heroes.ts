/**
 * The heroes (pdf §6.2): the only large shape of a page, the same drawing at every scale, so a guide reads as one object.
 * Nine drawings, each on its own ground, carry the 14 motifs. A hero draws inside its box and `placeHero` crops it.
 */
import type { DesignSpec, InkSet } from '../../shared.js';
import { decoRng } from '../text.js';
import { circleD, ellipseD, n, type Scene } from '../scene.js';
import { arcs, brushD, crescent, DRAWN_AS, halfD, halftone, heartD, leafAt, paw, quarterD, type DrawnMotif } from './tiles.js';

export interface HeroBox { x: number; y: number; size: number }
/** `frame` is what crops it: the box, or less on a close-up. */
export type Hero = (s: Scene, box: HeroBox, inks: InkSet, seed: number, frame: HeroBox) => void;

const FRAME_CLEAR = 1.5;       // pt: closer, a star touches the next tile and reads as a bump on it, whole or not

/** A disc the frame leaves whole, and clear of its edge. */
const clearOf = (f: HeroBox, cx: number, cy: number, r: number): boolean => cx - r >= f.x + FRAME_CLEAR && cx + r <= f.x + f.size - FRAME_CLEAR && cy - r >= f.y + FRAME_CLEAR && cy + r <= f.y + f.size - FRAME_CLEAR;

const moon: Hero = (s, { x, y, size }, inks, seed, frame) => {
  for (let i = 6; i >= 1; i--) s.circle(x + size * 0.5, y + size * 0.5, size * 0.11 * i, undefined, { stroke: inks.a, sw: size * 0.0055 });
  crescent(s, x + size * 0.46, y + size * 0.5, size * 0.36, size * 0.14, inks.c, inks.ink);
  const rnd = decoRng(seed + 3);
  let stars = '';
  for (let i = 0; i < 18; i++) {
    // every draw stays, so that the stars left do not move
    const [cx, cy, r] = [x + rnd() * size, y + rnd() * size, size * (0.00275 + rnd() * 0.0055)];
    if (clearOf(frame, cx, cy, r)) stars += circleD(cx, cy, r);
  }
  s.path(stars, inks.paper);
};

const sun: Hero = (s, { x, y, size }, inks) => {
  const cx = x + size * 0.5;
  const cy = y + size * 0.44;
  const inner = size * 0.285;
  let rays = '';
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const outer = size * (i % 2 ? 0.385 : 0.435);
    const wid = 0.095; // half the angle of a ray: the gap between two rays stays as wide as a ray
    const at = (r: number, t: number) => `${n(cx + r * Math.cos(t))} ${n(cy + r * Math.sin(t))}`;
    rays += `M${at(inner, a - wid)}L${at(outer, a - wid * 0.8)}L${at(outer, a + wid * 0.8)}L${at(inner, a + wid)}Z`;
  }
  s.path(rays, inks.c);
  s.circle(cx, cy, size * 0.25, inks.c);
  s.path(halfD(x - size * 0.14, y + size * 0.62, size * 0.86, 0), inks.ink);
  s.path(halfD(x + size * 0.4, y + size * 0.7, size * 0.72, 0), inks.b);
};

const pawHero: Hero = (s, { x, y, size }, inks) => {
  halftone(s, x, y, size, size, size * 0.035, inks.b, (_u, v) => Math.max(0, v - 0.25) * 0.9);
  paw(s, x + size / 2, y + size * 0.53, size * 0.92, inks.ink, -6);
};

const heart: Hero = (s, { x, y, size }, inks) => {
  arcs(s, x, y, size, 3, inks.a, 7, size * 0.028);
  s.path(heartD(x + size * 0.52, y + size * 0.5, size * 0.7), inks.b);
};

const leaf: Hero = (s, { x, y, size }, inks) => {
  const sx = (t: number) => x + size * (0.34 + 0.32 * t * t);
  const sy = (t: number) => y + size * (1.02 - 0.9 * t);
  let stem = `M${n(sx(0))} ${n(sy(0))}`;
  for (let i = 1; i <= 20; i++) stem += `L${n(sx(i / 20))} ${n(sy(i / 20))}`;
  s.path(stem, undefined, { stroke: inks.ink, sw: size * 0.016, cap: 'round' });
  const pairs = 4;
  for (let i = 0; i < pairs; i++) {
    const t = 0.14 + (i / pairs) * 0.8;
    const len = size * (0.5 - 0.27 * (i / (pairs - 1)));
    const wid = len * 0.3;
    s.path(leafAt(sx(t), sy(t), len, wid, -24 + i * 4), i % 2 ? inks.c : inks.paper);
    s.path(leafAt(sx(t + 0.05), sy(t + 0.05), len * 0.86, wid * 0.9, -150 - i * 4), i % 2 ? inks.paper : inks.b);
  }
  s.path(leafAt(sx(0.96), sy(0.96), size * 0.2, size * 0.07, -64), inks.c);
};

const coin: Hero = (s, { x, y, size }, inks) => {
  for (let i = 0; i < 6; i++) {
    const yy = y + size * 0.8 - i * size * 0.09;
    s.path(ellipseD(x + size / 2, yy + size * 0.035, size * 0.34, size * 0.11), inks.a);
    s.rect(x + size * 0.16, yy, size * 0.68, size * 0.04, inks.a);
    s.path(ellipseD(x + size / 2, yy, size * 0.34, size * 0.11), i === 5 ? inks.c : inks.b);
  }
};

const chart: Hero = (s, { x, y, size }, inks) => {
  const heights = [0.2, 0.32, 0.46, 0.6, 0.76];
  const colors = [inks.paper, inks.c, inks.paper, inks.c, inks.b];
  const w = size * 0.125;
  const gap = size * 0.045;
  const left = x + size * 0.09;
  heights.forEach((h, i) => s.rect(left + i * (w + gap), y + size * (1 - h), w, size * h, colors[i]));
  // the quarter arc rises over the bars, a little above their tops
  const r = size * 0.88;
  const cx = x + size * 0.95;
  const cy = y + size * 1.0;
  const k = 0.5523 * r;
  s.path(`M${n(cx - r)} ${n(cy)}C${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)}`, undefined, { stroke: inks.ink, sw: size * 0.03, cap: 'butt' });
};

const home: Hero = (s, { x, y, size }, inks) => {
  const P = (u: number, v: number) => `${n(x + size * u)} ${n(y + size * v)}`;
  s.path(quarterD(x + size * 0.56, y, size * 0.44, 1), inks.b);
  s.rect(x + size * 0.2, y + size * 0.5, size * 0.6, size * 0.5, inks.paper);
  s.path(`M${P(0.09, 0.52)}L${P(0.5, 0.14)}L${P(0.91, 0.52)}Z`, inks.a);
  s.rect(x + size * 0.28, y + size * 0.6, size * 0.13, size * 0.13, inks.ink);
  // the arched door: a half disc on a rectangle
  const door = size * 0.18;
  s.path(halfD(x + size * 0.51, y + size * 0.6, door, 0), inks.ink);
  s.rect(x + size * 0.51, y + size * 0.6 + door / 2, door, size - size * 0.6 - door / 2, inks.ink);
  s.rect(x, y + size * 0.95, size, size * 0.05, inks.ink);
};

const brush: Hero = (s, { x, y, size }, inks) => {
  // the stroke it has just laid: flat where the bristles passed, breaking up where the paint runs out
  const top = y + size * 0.58;
  const tall = size * 0.3;
  halftone(s, x + size * 0.34, top, size * 0.66, tall, size * 0.035, inks.b, (u) => Math.max(0, 0.95 - u * 1.25));
  s.path(`M${n(x)} ${n(top)}H${n(x + size * 0.42)}C${n(x + size * 0.47)} ${n(top + tall * 0.2)} ${n(x + size * 0.4)} ${n(top + tall * 0.4)} ${n(x + size * 0.45)} ${n(top + tall * 0.6)}C${n(x + size * 0.48)} ${n(top + tall * 0.8)} ${n(x + size * 0.42)} ${n(top + tall)} ${n(x + size * 0.38)} ${n(top + tall)}H${n(x)}Z`, inks.b);
  const b = brushD(x + size * 0.27, y + size * 0.8, size * 0.98, -49);
  s.path(b.handle, inks.a);
  s.path(b.ferrule, inks.paper);
  s.path(b.bristles, inks.ink);
};

const DRAWINGS: Record<DrawnMotif, { draw: Hero; ground: keyof InkSet }> = {
  moon: { draw: moon, ground: 'ink' },
  sun: { draw: sun, ground: 'a' },
  paw: { draw: pawHero, ground: 'c' },
  heart: { draw: heart, ground: 'ink' },
  leaf: { draw: leaf, ground: 'a' },
  coin: { draw: coin, ground: 'ink' },
  chart: { draw: chart, ground: 'a' },
  home: { draw: home, ground: 'c' },
  brush: { draw: brush, ground: 'c' },
};

export const HEROES = Object.fromEntries(Object.entries(DRAWN_AS).map(([motif, drawn]) => [motif, DRAWINGS[drawn]])) as Record<DesignSpec['motif'], { draw: Hero; ground: keyof InkSet }>;

/**
 * The hero on its ground, cropped by its box, or by `frame` for a close-up. Another `ground` swaps that ink with the hero's
 * own, so the five inks stay five and nothing the drawing cut out of its ground disappears.
 */
export function placeHero(s: Scene, motif: DesignSpec['motif'], box: HeroBox, inks: InkSet, seed: number, ground?: keyof InkSet, frame: HeroBox = box): void {
  const hero = HEROES[motif];
  const worn = ground && ground !== hero.ground ? { ...inks, [hero.ground]: inks[ground], [ground]: inks[hero.ground] } : inks;
  const square = `M${n(frame.x)} ${n(frame.y)}h${n(frame.size)}v${n(frame.size)}h${n(-frame.size)}Z`;
  s.path(square, worn[hero.ground]);
  s.clip(square, (cl) => hero.draw(cl, box, worn, seed, frame));
}
