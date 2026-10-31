/**
 * What a piece of art is worth, from its geometry alone (pdf §12.2), and the designer's search over it (pdf §13). No world
 * draw: candidates and the noise of a weak eye are keyed on the design's seed and the index, so nothing shifts.
 */
import type { CoverAudit } from '../../contracts.js';
import type { DesignEffort, DesignSpec, InkSet } from '../../shared.js';
import { contrast } from '../color.js';
import { normalizeDesign } from '../design.js';
import { decoRng, hashString } from '../text.js';
import { GROUNDS, groundsOf, HERO_CELL, type HeroPlace } from './field.js';
import { HEROES } from './heroes.js';

/** Share of each ground in a balanced field, in the order of `GROUNDS`: a, ink, b, c, paper. */
const TARGET = [0.24, 0.24, 0.2, 0.2, 0.12];
const WEAK_PAIR = 1.6;
const FULL_FOCUS = 7;
/** How far a weak eye misreads a candidate, at taste 0. */
const EYE = 8;
/** A title reads on a 150 px wide thumbnail from 7 px, and at full marks from 13 px. */
const THUMB_MIN = 7;
const THUMB_SPAN = 6;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

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

/** Candidate 0 is the design's own seed: `artSeed` absent means exactly that. */
export const artCandidate = (seed: number, i: number): number => (i === 0 ? seed : hashString(`art|${seed}|${i}`));

/**
 * Best of `covers`, as this designer sees it: perceived = true + (1 - taste) × 8 × noise, so a weak eye sometimes keeps
 * the worse candidate. `score` is what it is really worth.
 */
export function pickArt(design: DesignSpec, effort: DesignEffort): { seed: number; score: number; explored: number } {
  const d = normalizeDesign(design);
  const inks = d.inks!;
  const explored = Math.max(1, Math.floor(effort.covers));
  let best = { seed: d.seed, score: 0, seen: -Infinity };
  for (let i = 0; i < explored; i++) {
    const seed = artCandidate(d.seed, i);
    const score = artScore(d, inks, seed);
    const noise = decoRng(hashString(`${d.seed}|${i}`))() * 2 - 1;
    const seen = score + (1 - effort.taste) * EYE * noise;
    if (seen > best.seen) best = { seed, score, seen };
  }
  return { seed: best.seed, score: best.score, explored };
}

/** cover = 0.5 art + 0.35 thumb + 0.15 balance. A long SEO title has a measured cost. */
export function coverScore(a: CoverAudit): number {
  const thumb = 100 * clamp01((a.thumbPx - THUMB_MIN) / THUMB_SPAN);
  return round1(0.5 * a.art + 0.35 * thumb + 0.15 * a.lineBalance);
}
