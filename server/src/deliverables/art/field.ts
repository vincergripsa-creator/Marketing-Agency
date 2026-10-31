/**
 * A field of unit tiles with one hero (pdf §6.1): five inks, flat, no opacity. What the eye reads as one printed block
 * is the checker: no two neighbours share a ground, and no tile shares the ground of the hero it touches.
 */
import type { DesignSpec, InkSet } from '../../shared.js';
import { contrast } from '../color.js';
import { decoRng, hashString } from '../text.js';
import type { Scene } from '../scene.js';
import { HEROES, placeHero } from './heroes.js';
import { DRAWN_AS, drawTile, tileOf, type Corner } from './tiles.js';

/** The inks a tile can be grounded on, in the order `SceneMeta.grounds` indexes them. */
export const GROUNDS: readonly (keyof InkSet)[] = ['a', 'ink', 'b', 'c', 'paper'];

/** Where `SceneMeta.grounds` has a hero and not a tile. */
export const HERO_CELL = -1;

/** A shape weaker than this on its ground is lost: the bag only draws with inks that read. */
const MIN_SHAPE_CONTRAST = 1.5;
/** Rects overlap by a hair: viewers antialias a shared edge into a seam. */
const SEAM = 0.4;

export interface HeroPlace { c: number; r: number; s: number; ground?: keyof InkSet }

export interface FieldOptions {
  x: number; y: number; u: number;
  cols: number; rows: number;
  inks: InkSet;
  motif: DesignSpec['motif'];
  seed: number;
  hero: HeroPlace | null;
}

const inside = (h: HeroPlace | null, c: number, r: number): boolean => !!h && c >= h.c && c < h.c + h.s && r >= h.r && r < h.r + h.s;

/**
 * The ground of every cell, drawn alone so a designer can compare candidates with no drawing at all. One draw per cell,
 * hero or not: the 4-row and the 5-row field of a seed are the same field, which is why `pickArt` needs no title.
 */
export function groundsOf(o: Pick<FieldOptions, 'cols' | 'rows' | 'seed' | 'hero'>, heroGround: keyof InkSet): number[][] {
  const { cols, rows, seed, hero } = o;
  const rnd = decoRng(seed);
  const banned = GROUNDS.indexOf(heroGround);
  const grounds: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    grounds.push(row);
    for (let c = 0; c < cols; c++) {
      const draw = rnd();
      if (inside(hero, c, r)) {
        row.push(HERO_CELL);
        continue;
      }
      const touches = inside(hero, c - 1, r) || inside(hero, c + 1, r) || inside(hero, c, r - 1) || inside(hero, c, r + 1);
      const free = GROUNDS.map((_, g) => g).filter((g) => g !== row[c - 1] && g !== grounds[r - 1]?.[c] && !(touches && g === banned));
      row.push(free[Math.floor(draw * free.length)]!);
    }
  }
  return grounds;
}

/** The hero's own ground: the one this field asks for, or the one the drawing wears. */
export const heroGroundOf = (motif: DesignSpec['motif'], hero: HeroPlace | null): keyof InkSet => hero?.ground ?? HEROES[motif].ground;

/** The ink of the shape on a tile, `draw` in 0..1: any of the other four that reads on this ground. */
export function shapeInk(inks: InkSet, ground: keyof InkSet, draw: number): string {
  const others = GROUNDS.filter((k) => k !== ground).map((k) => inks[k]);
  const readable = others.filter((ink) => contrast(ink, inks[ground]) >= MIN_SHAPE_CONTRAST);
  const pool = readable.length ? readable : others;
  return pool[Math.floor(draw * pool.length)]!;
}

/** Draws the field and leaves its grounds and tile kinds in `s.meta`, for the evaluator. */
export function field(s: Scene, o: FieldOptions): void {
  const { x, y, u, cols, rows, inks, motif, seed, hero } = o;
  const drawn = DRAWN_AS[motif];
  const rnd = decoRng(hashString(`tiles|${seed}`));
  const grounds = groundsOf(o, heroGroundOf(motif, hero));
  const kinds: number[] = [];
  grounds.forEach((row, r) => row.forEach((g, c) => {
    if (g === HERO_CELL) return;
    const ground = GROUNDS[g]!;
    const bg = inks[ground];
    const fg = shapeInk(inks, ground, rnd());
    const tile = tileOf(drawn, rnd());
    kinds.push(tile.rank);
    const X = x + c * u;
    const Y = y + r * u;
    s.rect(X, Y, u + (c < cols - 1 ? SEAM : 0), u + (r < rows - 1 ? SEAM : 0), bg);
    drawTile(s, { kind: tile.kind, x: X, y: Y, u, fg, bg, motif: drawn, corner: Math.floor(rnd() * 4) as Corner, pick: rnd() });
  }));
  s.meta = { grounds, kinds };
  if (hero) placeHero(s, motif, { x: x + hero.c * u, y: y + hero.r * u, size: hero.s * u }, inks, seed, hero.ground);
}
