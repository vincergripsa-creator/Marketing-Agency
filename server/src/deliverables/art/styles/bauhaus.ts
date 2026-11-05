/**
 * « Bauhaus », the V1 look (pdf §6): a field of flat tiles and one hero, five inks. The adapter draws exactly what V1 drew,
 * byte for byte: a design without `style` wears it, and so does a style not built yet.
 */
import type { DesignSpec } from '../../../shared.js';
import { field } from '../field.js';
import { placeHero } from '../heroes.js';
import { artScore, coverHero, fieldArt } from '../score.js';
import { COVER_H, COVER_W, MARGIN, MEASURE, UNIT, type ArtStyleDef, type CoverArt, type CoverCall, type CoverKit } from './types.js';

const TITLE_MAX = 62;
const TITLE_MAX_TYPO = 76; // the `minimal` cover has nothing else to show: its title goes past the scale's 62
/** A title longer than this leaves a row of art to the text (pdf §6.3). */
const LONG_HEAD = 40;

/** « Affiche »: art on top, 4 or 5 rows by the length of the head, title on paper. */
function split(c: CoverKit, { head, tail, seed }: CoverCall): CoverArt {
  const { d, inks } = c;
  const rows = head.length > LONG_HEAD ? 4 : 5;
  const artH = rows * UNIT;
  field(c.s, { x: 0, y: 0, u: UNIT, cols: 6, rows, inks, motif: d.motif, seed, hero: coverHero(rows) });
  c.labels(artH + 32);
  const foot = c.audience(COVER_H - 26, MEASURE, 2);
  const title = c.headline(head, tail, artH + 50, foot - 16, MEASURE, TITLE_MAX);
  return { rows, art: fieldArt(d, inks, seed, rows), titleSize: title.size, titleLines: title.lines, sticker: { u: 0.82, v: 0.2 } };
}

/** « Typo »: paper, the title alone, one hero in the corner. No field: `art` reads the one this seed gives the openers. */
function minimal(c: CoverKit, { head, tail, seed }: CoverCall): CoverArt {
  const { d, inks } = c;
  const size = 3 * UNIT;
  const heroY = COVER_H - size;
  placeHero(c.s, d.motif, { x: COVER_W - size, y: heroY, size }, inks, seed);
  c.labels(MARGIN + 18);
  c.audience(COVER_H - 26, COVER_W - size - MARGIN - UNIT / 4, 4);
  const title = c.headline(head, tail, MARGIN + 52, heroY - 24, MEASURE, TITLE_MAX_TYPO);
  return { rows: 0, art: artScore(d, inks, seed), titleSize: title.size, titleLines: title.lines, sticker: { u: 0.8, v: 0.84 } };
}

/** `centered` and `badge` wear `split`, as in V1. */
const layoutOf = (d: Pick<DesignSpec, 'coverLayout'>): number => (d.coverLayout === 'minimal' ? 1 : 0);

export const bauhaus: ArtStyleDef = {
  id: 'bauhaus',
  compositions: [{ id: 'split', label: 'Affiche' }, { id: 'minimal', label: 'Épurée' }],
  defaultComposition: layoutOf,
  cover: (c, call) => (call.composition === 1 ? minimal(c, call) : split(c, call)),
  plate: (s, p) => field(s, { x: p.x, y: p.y, u: p.u, cols: p.cols, rows: p.rows, inks: p.inks, motif: p.motif, seed: p.seed, hero: p.hero }),
  // both shapes of field, whatever the composition: what V1's designer compared
  candidate: (d, inks, seed) => artScore(d, inks, seed),
};
