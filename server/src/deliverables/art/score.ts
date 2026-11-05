/** What a field of tiles is worth, from its grounds alone (pdf §12.2): the Bauhaus score every style's is measured against. */
import type { DesignSpec, InkSet } from '../../shared.js';
import { contrast } from '../color.js';
import { GROUNDS, groundsOf, HERO_CELL, type HeroPlace } from './field.js';
import { HEROES } from './heroes.js';

/** Share of each ground in a balanced field, in the order of `GROUNDS`: a, ink, b, c, paper. */
const TARGET = [0.24, 0.24, 0.2, 0.2, 0.12];
const WEAK_PAIR = 1.6;
const FULL_FOCUS = 7;

export const round1 = (v: number): number => Math.round(v * 10) / 10;

/** The two shapes a cover field takes (pdf §6.3), by the length of its title. */
export const coverHero = (rows: number): HeroPlace => ({ c: 2, r: rows - 4, s: 4 });
const COVER_ROWS = [5, 4] as const;

/** art = 0.4 balance + 0.3 rhythm + 0.3 focus, 0..100. Reads the grounds and nothing else. */
export function scoreField(grounds: number[][], inks: InkSet, heroGround: keyof InkSet): number {
  const tiles = grounds.flat().filter((g) => g !== HERO_CELL);
  if (!tiles.length) return 0;
  const shares = GROUNDS.map((_, g) => tiles.filter((t) => t === g).length / tiles.length);
  const balance = 100 * Math.max(0, 1 - shares.reduce((d, v, g) => d + Math.abs(v - TARGET[g]!), 0) / 0.9);

  const ground = (g: number): string => inks[GROUNDS[g]!];
  const at = (r: number, c: number): number | undefined => grounds[r]?.[c];
  let pairs = 0;
  let weak = 0;
  let ring = 0;
  let touching = 0;
  grounds.forEach((row, r) => row.forEach((g, c) => {
    if (g === HERO_CELL) return;
    for (const next of [at(r, c + 1), at(r + 1, c)]) {
      if (next === undefined || next === HERO_CELL) continue;
      pairs += 1;
      if (contrast(ground(g), ground(next)) < WEAK_PAIR) weak += 1;
    }
    const near = [-1, 0, 1].some((dr) => [-1, 0, 1].some((dc) => at(r + dr, c + dc) === HERO_CELL));
    if (!near) return;
    touching += 1;
    ring += Math.min(1, contrast(ground(g), inks[heroGround]) / FULL_FOCUS);
  }));
  const rhythm = 100 * (1 - weak / Math.max(1, pairs));
  const focus = touching ? 100 * (ring / touching) : 100;
  return 0.4 * balance + 0.3 * rhythm + 0.3 * focus;
}

/** A seed in one shape of cover field. */
export function fieldArt(d: Pick<DesignSpec, 'motif'>, inks: InkSet, seed: number, rows: number): number {
  const ground = HEROES[d.motif].ground;
  return round1(scoreField(groundsOf({ cols: 6, rows, seed, hero: coverHero(rows) }, ground), inks, ground));
}

/** What an art candidate is worth before the title is known, the mean of the two shapes it may be cut to. */
export function artScore(d: Pick<DesignSpec, 'motif'>, inks: InkSet, seed: number): number {
  return round1(COVER_ROWS.reduce((sum, rows) => sum + fieldArt(d, inks, seed, rows), 0) / COVER_ROWS.length);
}
