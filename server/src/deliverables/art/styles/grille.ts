/**
 * « Grille suisse » (D200): the International Typographic Style. Six columns and visible hairlines, the title flush left in
 * the voice's grotesque, the title's key figure (« 30 jours ») set huge as a typographic object in one accent, often red
 * orange, against ink and paper, the metadata in small capitals in its columns, and the motif reduced to a pictogram in a
 * cell of the grid, drawn on its construction. Three compositions: the figure on paper over hairlines, a band of colour that
 * holds it, and an element tile beside a column of metadata. Serious and clear: made for money, papers, exams and careers.
 * The seed picks the accent, the band, the grid shown and the side of the pictogram; the score reads what they give.
 */
import type { DesignSpec, InkSet } from '../../../shared.js';
import { contrast, ensureContrast, mix } from '../../color.js';
import { advance, type FaceName } from '../../fonts.js';
import { n, type Scene } from '../../scene.js';
import { decoRng, hashString } from '../../text.js';
import { boundsOf, drawShape, motifShape, type Box } from '../shapes.js';
import { bestOn, harmony, hueOf, onBauhausScale } from './common.js';
import { artText, clamp01, deckIn, figureFor, fitTitle, inkBounds, legible, pops, setDeck, setTitle, titleHeight, weighted, type Figure, type Title } from './craft.js';
import { COVER_H, COVER_W, MARGIN, MEASURE, type ArtStyleDef, type CoverArt, type CoverCall, type CoverKit, type PlateSpec } from './types.js';

const COLS = 6;
const GUTTER = 16;
const COL = (MEASURE - (COLS - 1) * GUTTER) / COLS;
const colX = (k: number): number => MARGIN + k * (COL + GUTTER);
/** The hairline between column k − 1 and column k. */
const gutterX = (k: number): number => colX(k) - GUTTER / 2;
const LABEL_Y = 56;            // baseline of the labels
const TOP_RULE = 68;
const RULE = 1.5;              // a rule that structures the page
const HAIR = 0.75;             // a line of the grid
const FOOT = COVER_H - 38;     // baseline of the audience's last line
const CELL = COL;              // the pictogram's cell at the foot
const TITLE_MAX = 92;
const LEADING = 0.98;
const TRACK = -0.022;          // em: a bold grotesque this big closes up
/** Flush left, ragged right, but no step a block would trip on: between the poster's stack and an even block. */
const BALANCE = 0.8;
const DECK = { max: 23, min: 15, lines: 3, leading: 1.24 };
const DECK_W = colX(5) - GUTTER - MARGIN;
const FIGURE_TRACK = -0.04;    // em: figures set tight, as one object
const UNIT = { size: 15, track: 1.6 };
const MIN_TEXT = 4.5;
const BUILT_FROM = 150;        // a cell this big shows the construction of its pictogram

/** How Swiss an accent is: a red orange of full chroma is the style's own, a cold or grey one is not. */
function warm(c: string): number {
  const { hue, chroma } = hueOf(c);
  const off = Math.min(Math.abs(hue - 12), 360 - Math.abs(hue - 12));
  return clamp01(1 - off / 70) * clamp01(chroma / 0.62);
}

/** The accents that show on `ground`, a red orange far likelier than a cold one. */
const accentOn = (inks: InkSet, ground: string, r: number, min: number): string | undefined =>
  weighted([inks.b, inks.c, inks.a].filter((k) => contrast(k, ground) >= min), (k) => 0.3 + 2 * warm(k), r);

interface Plan {
  composition: number;
  accent: string;                // the figure, the pictogram's cell
  hot: string | null;            // the title's number, in the accent made to read on paper
  text: string;                  // title, labels, deck, rules on paper
  tone: string;                  // the hairlines of the grid on paper
  band: string;                  // « Bandeau »: the band of colour
  onBand: string;                // « Bandeau »: the figure and the pictogram on it
  bandTone: string;              // « Bandeau »: the grid over the band
  side: 0 | 1;                   // the pictogram's side: left, right
  split: number;                 // « Bandeau »: share of the cover down to the band's foot, before the title pushes it up
  every: boolean;                // every column's hairline, or only the thirds
  raw: number;
}

/** The raw score of each composition on its own covers, measured by `scripts/styleSheet.ts`: what `onBauhausScale` maps. */
/**
 * `lift`: « Fiche » sets its title ragged at the foot, and the cover's balance term reads 8 points lower on the same
 * designs; its art sits a point over Bauhaus's mean, inside the point the plan allows, so that its cover stays neutral.
 */
const MEASURED = [{ mean: 0.79466, sd: 0.090172, lift: 0 }, { mean: 0.75724, sd: 0.080517, lift: 0 }, { mean: 0.829138, sd: 0.089655, lift: 1 }] as const;

/** Every choice the seed makes for one composition. A fixed count of draws: a pool that grows moves no other choice. */
function planOf(inks: InkSet, seed: number, composition: number): Plan {
  const rnd = decoRng(hashString(`grille|${seed}|${composition}`));
  const r = Array.from({ length: 8 }, rnd);
  const paper = inks.paper;
  const text = bestOn(paper, [inks.ink, inks.a]);
  // a figure on paper shows from 2.2; without one, the ink itself
  const accent = accentOn(inks, paper, r[0]!, 2.2) ?? inks.ink;
  const hot = r[5]! < 0.8 && accent !== text ? ensureContrast(accent, paper, MIN_TEXT) : null;
  const tone = mix(paper, text, 0.24);
  const side: 0 | 1 = r[3]! < 0.5 ? 0 : 1;
  const every = r[4]! < 0.6;
  const base = { composition, accent, hot, text, tone, side, every };
  if (composition === 1) {
    const bands = [accent, inks.ink, inks.a, inks.b].filter((k, i, all) => all.indexOf(k) === i && contrast(k, paper) >= 1.8);
    const band = bands[Math.floor(r[1]! * bands.length)] ?? inks.ink;
    const onBand = [inks.paper, accent, inks.c, inks.ink].filter((k) => k !== band).sort((x, y) => contrast(y, band) - contrast(x, band))[0]!;
    const bandTone = mix(band, bestOn(band, [inks.paper, inks.ink]), 0.2);
    const split = 0.5 + r[2]! * 0.12;
    const prop = clamp01(1 - Math.abs(split - 0.56) / 0.08);
    const raw = 0.2 * legible(text, paper) + 0.25 * pops(band, paper) + 0.2 * pops(onBand, band) + 0.15 * Math.max(warm(band), warm(onBand)) + 0.2 * prop;
    return { ...base, band, onBand, bandTone, split, raw };
  }
  if (composition === 2) {
    const onTile = bestOn(accent, [inks.paper, inks.ink]);
    const raw = 0.25 * legible(text, paper) + 0.25 * pops(onTile, accent) + 0.25 * warm(accent) + 0.15 * pops(accent, paper) + 0.1 * (every ? 1 : 0.5);
    return { ...base, band: accent, onBand: onTile, bandTone: tone, split: 1, raw };
  }
  const raw = 0.3 * legible(text, paper) + 0.25 * pops(accent, paper) + 0.25 * warm(accent) + 0.1 * harmony(accent, text) + 0.1 * (every ? 1 : 0.5);
  return { ...base, band: paper, onBand: accent, bandTone: tone, split: 1, raw };
}

const artOf = (p: Plan): number => {
  const m = MEASURED[p.composition] ?? MEASURED[0];
  return onBauhausScale(p.raw, m, m.lift);
};

// ───────────────────────────── pieces ─────────────────────────────

/** Hairlines of the grid between `top` and `bottom`: between every column, or at the thirds. */
function hairlines(s: Scene, top: number, bottom: number, ink: string, every: boolean): void {
  if (bottom - top < 8) return;
  for (let k = 1; k < COLS; k++) if (every || k % 2 === 0) s.rect(gutterX(k) - HAIR / 2, top, HAIR, bottom - top, ink);
}

/** The motif as a pictogram: flat, its holes and lines cut in the ink it stands on. */
function pictogram(s: Scene, d: Pick<DesignSpec, 'motif'>, box: Box, ink: string, on: string): void {
  drawShape(s, motifShape(d.motif), box, { body: ink, holes: on, lines: on });
}

/** The pictogram's box so that its ink, not its unit box, stands centred in a square of `side` from (x, y), `share` of it wide. */
function centred(d: Pick<DesignSpec, 'motif'>, x: number, y: number, side: number, share: number): Box {
  const b = boundsOf(motifShape(d.motif));
  const k = (side * share) / Math.max(b.x1 - b.x0, b.y1 - b.y0);
  return { x: x + side / 2 - ((b.x0 + b.x1) / 2) * k, y: y + side / 2 - ((b.y0 + b.y1) / 2) * k, w: k, h: k };
}

/**
 * The pictogram in its square cell of the grid. A big cell shows how the sign is built, as a pictogram designer draws it:
 * the circle it is inscribed in, the diagonals and the axes, in hairlines of a tone of the cell.
 */
function cellOf(s: Scene, d: Pick<DesignSpec, 'motif'>, x: number, y: number, side: number, cell: string, ink: string): void {
  s.rect(x, y, side, side, cell);
  if (side >= BUILT_FROM) {
    const line = mix(cell, ink, 0.3);
    const w = Math.max(HAIR, side / 400);
    const [cx, cy] = [x + side / 2, y + side / 2];
    s.circle(cx, cy, side * 0.42, undefined, { stroke: line, sw: w });
    s.circle(cx, cy, side * 0.21, undefined, { stroke: line, sw: w });
    s.path(`M${n(x)} ${n(y)}L${n(x + side)} ${n(y + side)}M${n(x + side)} ${n(y)}L${n(x)} ${n(y + side)}M${n(cx)} ${n(y)}L${n(cx)} ${n(y + side)}M${n(x)} ${n(cy)}L${n(x + side)} ${n(cy)}`, undefined, { stroke: line, sw: w });
  }
  pictogram(s, d, centred(d, x, y, side, side >= BUILT_FROM ? 0.6 : 0.64), ink, cell);
}

interface Glyphs { text: string; size: number; x: number; w: number; top: number }

/** The key figure as big as `width` × `capMax` allows, its sign with it, flush left on its ink. */
function figureGlyphs(face: FaceName, f: Figure, width: number, capMax: number): Glyphs {
  const text = f.sign && f.unit && !f.figure.endsWith(f.unit) ? `${f.figure} ${f.unit}` : f.figure;
  const at = (size: number) => inkBounds(face, text, size, FIGURE_TRACK * size);
  const ref = at(100);
  const size = Math.max(10, Math.min(width / Math.max(1e-6, (ref.x1 - ref.x0) / 100), capMax / Math.max(1e-6, -ref.top / 100)));
  const b = at(size);
  return { text, size, x: MARGIN - b.x0, w: b.x1 - b.x0, top: b.top };
}

/** The unit in small capitals, as art: what the figure counts. */
const unitOf = (f: Figure): string | null => (f.unit && !f.sign ? f.unit.toLocaleUpperCase('fr-FR') : null);

/** The figure standing on `baseline`, its unit beside its foot when it fits there, else over its top. */
function drawFigure(s: Scene, face: FaceName, f: Figure, g: Glyphs, baseline: number, ink: string, unitInk: string): void {
  artText(s, g.text, g.x, baseline, face, g.size, ink, FIGURE_TRACK * g.size);
  const unit = unitOf(f);
  if (!unit) return;
  const uw = advance(face, unit, UNIT.size, UNIT.track);
  const right = MARGIN + g.w + 16;
  if (right + uw <= COVER_W - MARGIN) artText(s, unit, right, baseline - 2, face, UNIT.size, unitInk, UNIT.track);
  else artText(s, unit, MARGIN, baseline + g.top - 16, face, UNIT.size, unitInk, UNIT.track);
}

interface Setting { t: Title; deck: ReturnType<typeof deckIn>; deckGap: number }

/** The title and its deck fitted to `height`, the deck in the voice's text face under it. */
function fitSetting(c: CoverKit, call: CoverCall, height: number): Setting {
  const deck = deckIn(c, c.v.label, call.tail, DECK_W, DECK);
  const deckGap = deck ? 18 : 0;
  const deckH = deck ? deck.size * 0.76 + (deck.lines.length - 1) * deck.lineHeight + deckGap + 0.22 * 40 : 0;
  const t = fitTitle(call.head, c.v.labelB, { width: MEASURE, height: height - deckH, max: TITLE_MAX, leading: LEADING, track: TRACK, balance: BALANCE });
  return { t, deck, deckGap };
}

/** From the top of the title's capitals to the baseline of the deck's last line. */
const settingHeight = (st: Setting): number => titleHeight(st.t, 0) + (st.deck ? st.t.size * 0.22 + st.deckGap + st.deck.size * 0.76 + (st.deck.lines.length - 1) * st.deck.lineHeight : 0);

/** Title then deck, from the top of the capitals. */
function setSetting(c: CoverKit, st: Setting, top: number, p: Plan): void {
  const last = setTitle(c, st.t, MARGIN, top, p.text, { hot: p.hot, width: MEASURE });
  if (st.deck) setDeck(c, st.deck, c.v.label, MARGIN, last + st.t.size * 0.22 + st.deckGap + st.deck.size * 0.76, DECK_W, p.text);
}

/** Labels and the rule under them; the audience in four columns and the pictogram's cell in the last. Returns the foot's rule. */
function frame(c: CoverKit, p: Plan, cell: boolean): number {
  const { s } = c;
  c.labels(LABEL_Y, { ink: p.text });
  s.rect(MARGIN, TOP_RULE, MEASURE, RULE, p.text);
  const top = c.audience(FOOT, colX(4) - GUTTER - MARGIN, 3, { ink: p.text });
  const rule = Math.min(top, cell ? FOOT + 3 - CELL : top) - 16;
  s.rect(MARGIN, rule, MEASURE, HAIR, p.text);
  if (cell) cellOf(s, c.d, COVER_W - MARGIN - CELL, FOOT + 3 - CELL, CELL, p.accent, bestOn(p.accent, [c.inks.paper, c.inks.ink]));
  return rule;
}

const artFor = (p: Plan, t: Title, ground: string, sticker: { u: number; v: number }): CoverArt =>
  ({ rows: 0, art: artOf(p), titleSize: t.size, titleLines: t.lines, titleWidths: t.widths, titleFace: t.face, titleInk: p.text, titleGround: ground, sticker });

// ───────────────────────────── compositions ─────────────────────────────

/** « Chiffre »: paper and hairlines, the key figure huge in the accent on the title's rule, the title under it; the pictogram signs the foot. */
function numeral(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, d, inks } = c;
  const fig = figureFor(c.v.labelB, call.head, call.tail);
  const foot = frame(c, p, !!fig);
  const room = foot - 26 - (TOP_RULE + 30);
  const st = fitSetting(c, call, room * 0.54);
  const titleTop = foot - 26 - settingHeight(st);
  const rule = titleTop - 30;
  hairlines(s, TOP_RULE + RULE, rule, p.tone, p.every);
  s.rect(MARGIN, rule, MEASURE, RULE, p.text);
  const zone = rule - TOP_RULE;
  if (fig) {
    const face = c.v.labelB;
    drawFigure(s, face, fig, figureGlyphs(face, fig, MEASURE, zone - 44), rule + 0.5, p.accent, p.text);
  } else {
    // nothing to count: the pictogram is the picture, on its construction, in a square of four columns standing on the rule
    const side = Math.min(zone - 36, 4 * COL + 3 * GUTTER);
    cellOf(s, d, p.side ? COVER_W - MARGIN - side : MARGIN, rule - side, side, p.accent, bestOn(p.accent, [inks.paper, inks.ink]));
  }
  setSetting(c, st, titleTop, p);
  return artFor(p, st.t, inks.paper, fig ? { u: 0.8, v: 0.3 } : { u: p.side ? 0.22 : 0.78, v: 0.3 });
}

/** « Bandeau »: a band of colour across the cover holds the figure and the pictogram over its own grid; the title on paper under it. */
function band(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, d, inks } = c;
  const fig = figureFor(c.v.labelB, call.head, call.tail);
  const foot = frame(c, p, false);
  const bandTop = TOP_RULE + 18;
  const lowest = Math.round(Math.min(p.split, 0.62) * COVER_H);
  const highest = Math.round(0.42 * COVER_H);
  const st = fitSetting(c, call, foot - 26 - (highest + 40));
  const split = Math.max(highest, Math.min(lowest, Math.round(foot - 26 - settingHeight(st) - 40)));
  s.rect(0, bandTop, COVER_W, split - bandTop, p.band);
  hairlines(s, bandTop, split, p.bandTone, p.every);
  const zone = split - bandTop;
  const shape = motifShape(d.motif);
  const b = boundsOf(shape);
  if (fig) {
    const face = c.v.labelB;
    // the pictogram signs the band's top corner: the figure stands beside it, or under it at the full measure
    const corner = Math.min(CELL, zone * 0.3);
    const k = corner / Math.max(b.x1 - b.x0, b.y1 - b.y0);
    pictogram(s, d, { x: COVER_W - MARGIN - b.x1 * k, y: bandTop + 18 - b.y0 * k, w: k, h: k }, p.onBand, p.band);
    const baseline = split - 24;
    const beside = figureGlyphs(face, fig, colX(5) - GUTTER - MARGIN, zone - 64);
    const under = figureGlyphs(face, fig, MEASURE, baseline - (bandTop + 18 + corner + 22));
    drawFigure(s, face, fig, beside.size >= under.size ? beside : under, baseline, p.onBand, p.onBand);
  } else {
    const side = Math.min(zone - 48, 300);
    const k = side / Math.max(b.x1 - b.x0, b.y1 - b.y0);
    const x = p.side ? COVER_W - MARGIN - b.x1 * k : MARGIN - b.x0 * k;
    pictogram(s, d, { x, y: split - 24 - b.y1 * k, w: k, h: k }, p.onBand, p.band);
  }
  setSetting(c, st, split + 40, p);
  return artFor(p, st.t, inks.paper, { u: 0.78, v: Math.max(0.2, (split - 70) / COVER_H) });
}

/**
 * « Fiche »: the title at the top at the full measure; at the foot an element tile of three columns in the accent holds the
 * figure and the pictogram, the column beside it the deck from its top and the audience on its foot, as a label on a
 * specimen. The grid's hairlines run between. Read top-down, the title still comes first.
 */
function tile(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, d, inks, v } = c;
  const fig = figureFor(c.v.labelB, call.head, call.tail);
  const side = 3 * COL + 2 * GUTTER;
  const x = p.side ? COVER_W - MARGIN - side : MARGIN;
  const colW = COVER_W - MARGIN - colX(3);
  const col = p.side ? MARGIN : colX(3);
  c.labels(LABEL_Y, { ink: p.text });
  s.rect(MARGIN, TOP_RULE, MEASURE, RULE, p.text);
  // the tile stands on the audience's last baseline
  const foot = FOOT + 3;
  const top = foot - side;
  const onTile = bestOn(p.accent, [inks.paper, inks.ink]);
  // beside the tile: the deck from its top, the audience sitting on its foot; a deck too long for the column follows the title
  const audTop = c.audience(FOOT, colW, 4, { x: col, ink: p.text });
  const deck = deckIn(c, v.label, call.tail, colW, { max: 19, min: 14, lines: 5, leading: 1.26 });
  const inColumn = !!deck && top + deck.size * 0.76 + (deck.lines.length - 1) * deck.lineHeight <= audTop - 20;
  if (deck && inColumn) setDeck(c, deck, v.label, col, top + deck.size * 0.76, colW, p.text);
  s.rect(x, top, side, side, p.accent);
  if (fig) {
    const face = c.v.labelB;
    const shape = motifShape(d.motif);
    const b = boundsOf(shape);
    const corner = side * 0.2;
    const k = corner / Math.max(b.x1 - b.x0, b.y1 - b.y0);
    pictogram(s, d, { x: x + side - 16 - b.x1 * k, y: top + 16 - b.y0 * k, w: k, h: k }, onTile, p.accent);
    const g = figureGlyphs(face, fig, side - 32, side - 40 - corner - 30);
    const unit = unitOf(fig);
    artText(s, g.text, x + 16 + (g.x - MARGIN), foot - 18 - (unit ? 22 : 0), face, g.size, onTile, FIGURE_TRACK * g.size);
    if (unit) artText(s, unit, x + 18, foot - 16, face, UNIT.size, onTile, UNIT.track);
  } else {
    cellOf(s, d, x, top, side, p.accent, onTile);
  }
  // over it all: the title from under the top rule at the full measure, the grid's hairlines down to the tile's rule
  const rule = top - 26;
  s.rect(MARGIN, rule, MEASURE, HAIR, p.text);
  const titleTop = TOP_RULE + 34;
  const room = rule - 30 - titleTop;
  const st: Setting = !deck || inColumn
    ? { t: fitTitle(call.head, v.labelB, { width: MEASURE, height: room, max: 112, leading: LEADING, track: TRACK, balance: BALANCE }), deck: null, deckGap: 0 }
    : fitSetting(c, call, room);
  setSetting(c, st, titleTop, p);
  hairlines(s, titleTop + settingHeight(st) + (st.deck ? 0 : 0.22 * st.t.size) + 26, rule, p.tone, p.every);
  // a price sticker lands on the tile, never on the column's text
  return artFor(p, st.t, inks.paper, { u: (x + side * 0.7) / COVER_W, v: (top + side * 0.3) / COVER_H });
}

// ───────────────────────────── plates ─────────────────────────────

/**
 * A plate: the page's grid made visible, a hairline at every unit, one column of the accent, and the pictogram on its
 * construction in its cell where the page wants its figure. On a tone of paper or on ink, by the seed; nothing leaves the
 * rectangle.
 */
function plate(s: Scene, p: PlateSpec): void {
  const { x, y, u, cols, rows, inks, motif, seed, hero, role } = p;
  const w = cols * u;
  const h = rows * u;
  const rnd = decoRng(hashString(`grille|plate|${seed}|${hero?.pick ?? 0}|${role}`));
  const r = Array.from({ length: 5 }, rnd);
  const dark = r[0]! < 0.4;
  const ground = dark ? inks.ink : mix(inks.paper, inks.ink, 0.05);
  const fore = bestOn(ground, [inks.paper, inks.ink]);
  const line = mix(ground, fore, 0.2);
  const accent = accentOn(inks, ground, r[1]!, 2) ?? fore;
  const rect = `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  s.path(rect, ground);
  s.clip(rect, (cl) => {
    for (let k = 1; k < cols; k++) cl.rect(x + k * u - HAIR / 2, y, HAIR, h, line);
    for (let k = 1; k < rows; k++) cl.rect(x, y + k * u - HAIR / 2, w, HAIR, line);
    // where the figure stands: the page's wish, else a square of the plate's height on the side the seed says
    const side = hero ? hero.s : Math.min(rows, 2);
    const at = hero ? { c: hero.c, r: hero.r } : { c: r[2]! < 0.5 ? 0 : cols - side, r: rows - side };
    // one column of the accent, a unit wide and the plate's height, never under the figure
    const free = Array.from({ length: cols }, (_, k) => k).filter((k) => k < at.c - 1 || k > at.c + side);
    const col = free[Math.floor(r[3]! * free.length)];
    if (col !== undefined) cl.rect(x + col * u, y, u, h, accent);
    // the pictogram's cell, a unit in from the plate's foot when it is tall enough to leave one
    const cell = [inks.b, inks.c, inks.a, inks.paper].filter((k) => k !== accent && contrast(k, ground) >= 1.6)[Math.floor(r[4]! * 2)] ?? accent;
    cellOf(cl, { motif }, x + at.c * u, y + at.r * u, side * u, cell, bestOn(cell, [inks.paper, inks.ink]));
  });
}

export const grille: ArtStyleDef = {
  id: 'grille',
  compositions: [{ id: 'chiffre', label: 'Chiffre' }, { id: 'bandeau', label: 'Bandeau' }, { id: 'fiche', label: 'Fiche' }],
  defaultComposition: (d) => hashString(`grille|composition|${d.seed}`) % 3,
  cover: (c, call) => {
    const p = planOf(c.inks, call.seed, call.composition);
    return call.composition === 1 ? band(c, call, p) : call.composition === 2 ? tile(c, call, p) : numeral(c, call, p);
  },
  plate,
  candidate: (_d, inks, seed, composition) => artOf(planOf(inks, seed, composition)),
};
