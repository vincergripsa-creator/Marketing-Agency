/**
 * What a piece of art is worth, from its geometry alone (pdf §12.2), and the designer's search over it (pdf §13). No world
 * draw: candidates and the noise of a weak eye are keyed on the design's seed and the index, so nothing shifts. Each style
 * scores its own art on Bauhaus's scale (D200): the search is the same whatever the style.
 */
import type { CoverAudit } from '../../contracts.js';
import type { DesignEffort, DesignSpec } from '../../shared.js';
import { coverAudit, type CoverInput } from '../cover.js';
import { normalizeDesign } from '../design.js';
import { decoRng, hashString } from '../text.js';
import { round1 } from './score.js';
import { compositionOf, styleOf } from './styles/index.js';

export { artScore, coverHero, fieldArt, scoreField } from './score.js';

/** How far a weak eye misreads a candidate, at taste 0. */
const EYE = 8;
/** A title reads on a 150 px wide thumbnail from 7 px, and at full marks from 13 px. */
const THUMB_MIN = 7;
const THUMB_SPAN = 6;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Candidate 0 is the design's own seed: `artSeed` absent means exactly that. */
export const artCandidate = (seed: number, i: number): number => (i === 0 ? seed : hashString(`art|${seed}|${i}`));

/**
 * Best of `covers`, as this designer sees it: perceived = true + (1 - taste) × 8 × noise, so a weak eye sometimes keeps
 * the worse candidate. `score` is what it is really worth, in the design's style and composition.
 */
export function pickArt(design: DesignSpec, effort: DesignEffort): { seed: number; score: number; explored: number } {
  const d = normalizeDesign(design);
  const inks = d.inks!;
  const style = styleOf(d);
  const composition = compositionOf(d, style);
  const explored = Math.max(1, Math.floor(effort.covers));
  let best = { seed: d.seed, score: 0, seen: -Infinity };
  for (let i = 0; i < explored; i++) {
    const seed = artCandidate(d.seed, i);
    const score = style.candidate(d, inks, seed, composition);
    const noise = decoRng(hashString(`${d.seed}|${i}`))() * 2 - 1;
    const seen = score + (1 - effort.taste) * EYE * noise;
    if (seen > best.seen) best = { seed, score, seen };
  }
  return { seed: best.seed, score: best.score, explored };
}

/**
 * The composition this designer keeps for a cover (D203), judged on the real cover with its title: the style's default
 * first, then as many others as the eye has room for, misread as `pickArt` misreads art. A full eye sees them all.
 */
export function pickComposition(input: CoverInput, effort: DesignEffort): { composition: number; score: number; explored: number } {
  const d = normalizeDesign(input.design);
  const style = styleOf(d);
  const count = style.compositions.length;
  const first = compositionOf(d, style);
  const order = [first, ...Array.from({ length: count }, (_, k) => k).filter((k) => k !== first).sort((a, b) => hashString(`${d.seed}|composition|${a}`) - hashString(`${d.seed}|composition|${b}`))];
  const eye = clamp01((effort.taste - 0.4) / 0.6);
  const explored = Math.max(1, Math.min(count, 1 + Math.round((count - 1) * eye)));
  let best = { composition: first, score: 0, seen: -Infinity };
  for (const composition of order.slice(0, explored)) {
    const score = coverScore(coverAudit({ ...input, design: { ...input.design, composition } }));
    const noise = decoRng(hashString(`${d.seed}|look|${composition}`))() * 2 - 1;
    const seen = score + (1 - effort.taste) * EYE * noise;
    if (seen > best.seen) best = { composition, score, seen };
  }
  return { composition: best.composition, score: best.score, explored };
}

/** cover = 0.5 art + 0.35 thumb + 0.15 balance. A long SEO title has a measured cost. */
export function coverScore(a: CoverAudit): number {
  const thumb = 100 * clamp01((a.thumbPx - THUMB_MIN) / THUMB_SPAN);
  return round1(0.5 * a.art + 0.35 * thumb + 0.15 * a.lineBalance);
}
