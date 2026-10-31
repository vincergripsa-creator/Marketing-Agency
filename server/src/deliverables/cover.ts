/**
 * Store and PDF cover (pdf §7): one `Scene`, drawn by pdfkit with real text and written as a self-contained 600×848 SVG
 * of paths that needs no font. Laid out bottom-up: the audience, the deck, and the title gets what is left.
 */
import type { CoverAudit } from '../contracts.js';
import type { DesignSpec, InkSet } from '../shared.js';
import { artScore, coverHero, fieldArt } from './art/evaluate.js';
import { field } from './art/field.js';
import { placeHero } from './art/heroes.js';
import { contrast, ensureContrast } from './color.js';
import { normalizeDesign } from './design.js';
import { advance, fitDisplay, loadVoice, sanitizeFor, wrapFace, type FaceName } from './fonts.js';
import { Scene, toSvg } from './scene.js';
import { escapeXml, stripEmoji, wholeClause } from './text.js';
import type { Voice } from './voices.js';

export const COVER_W = 600;
export const COVER_H = 848;

/** Beyond this length a cover title is cut (at a word boundary); below it the FULL title is always shown. */
export const COVER_TITLE_MAX_CHARS = 140;

const UNIT = COVER_W / 6;
const MARGIN = 40;
const MEASURE = COVER_W - 2 * MARGIN;
const TITLE_MAX = 62;
const TITLE_MAX_TYPO = 76; // the `minimal` cover has nothing else to show: its title goes past the scale's 62
const TITLE_MIN = 30;
const TITLE_LEADING = 1.02;
const TITLE_LINES = 6;
const DECK_MAX = 25;
const DECK_MIN = 17;
const DECK_LEADING = 1.16;
const DECK_LINES = 2;
const LABEL = { size: 9.5, track: 2.2 };
const AUDIENCE = { size: 10.5, leading: 14 };
/** A title longer than this leaves a row of art to the text (pdf §6.3). */
const LONG_HEAD = 40;
/** The thumbnail of a feed. */
const THUMB_W = 150;

/** Word-boundary cut with an ellipsis, only for titles longer than COVER_TITLE_MAX_CHARS. */
const CUT_DANGLING = /\s+(?:de|d['’]|du|des|la|le|les|l['’]|en|à|au|aux|pour|par|sur|et|ou|un|une|avec|sans|dans)$/i;

function capTitle(title: string): string {
  if (title.length <= COVER_TITLE_MAX_CHARS) return title;
  const cut = title.slice(0, COVER_TITLE_MAX_CHARS - 1);
  const sp = cut.lastIndexOf(' ');
  let head = (sp > 80 ? cut.slice(0, sp) : cut).replace(/[\s,;:.…–—-]+$/, '');
  // never end on « … vivant en » nor double an ellipsis already present in the title
  for (let k = 0; k < 4 && CUT_DANGLING.test(head); k++) head = head.replace(CUT_DANGLING, '').replace(/[\s,;:.…–—-]+$/, '');
  return `${head}…`;
}

/** Every word stays: the head goes big, what follows « : » or « — » goes to the deck. */
export function splitTitle(t: string): { head: string; tail: string } {
  const m = /^(.{12,}?)\s(?::|—|–)\s(.+)$/su.exec(t);
  return m ? { head: m[1]!, tail: m[2]!.charAt(0).toUpperCase() + m[2]!.slice(1) } : { head: t, tail: '' };
}

interface TextBlock { lines: string[]; size: number; lineHeight: number; height: number }

const blockOf = (fit: { size: number; lines: string[] }, leading: number): TextBlock => {
  const lineHeight = fit.size * leading;
  return { lines: fit.lines, size: fit.size, lineHeight, height: lineHeight * fit.lines.length };
};

/** The biggest size that fits: a word is never cut in two, a line is never left with one short word (`fitDisplay`). */
export function titleBlock(c: { title: string; face: FaceName }, width: number, max: number, min = TITLE_MIN, maxHeight?: number): TextBlock {
  const text = capTitle(c.title || 'Guide pratique');
  return blockOf(fitDisplay(text, c.face, { width, max, min, maxLines: TITLE_LINES, leading: TITLE_LEADING, ...(maxHeight === undefined ? {} : { maxHeight }) }), TITLE_LEADING);
}

export interface CoverInput { title: string; subtitle: string; audience: string; design: DesignSpec; brand: string }

/** One line of text and the box it was set in. */
export interface CoverLine { s: string; x: number; y: number; width: number; font: FaceName; size: number; fill: string; track: number; anchor: 'start' | 'end' }

export interface CoverMeta {
  voice: Voice;           // a PDF registers it before `toPdf`
  head: string; tail: string;
  rows: number;           // of art: 0 for a cover with no field
  art: number;
  titleSize: number;
  titleLines: string[];
  lines: CoverLine[];     // every line of text of the cover, top-down
}

interface Words { title: string; subtitle: string; audience: string; brand: string }

const clean = (v: string): string => stripEmoji(v ?? '').replace(/\s+/g, ' ').trim();

/** A cover under construction: every line goes through here, so that none escapes the box it was fitted to. */
class Layout {
  readonly s = new Scene(COVER_W, COVER_H);
  readonly lines: CoverLine[] = [];
  readonly words: Words;

  constructor(input: CoverInput, readonly d: DesignSpec, readonly v: Voice, readonly inks: InkSet) {
    this.words = { title: clean(input.title), subtitle: clean(input.subtitle), audience: clean(input.audience), brand: clean(input.brand) || 'Pixel Agency' };
    this.s.rect(0, 0, COVER_W, COVER_H, inks.paper);
  }

  put(s: string, x: number, y: number, width: number, font: FaceName, size: number, fill: string, o: { anchor?: 'start' | 'end'; track?: number } = {}): void {
    this.lines.push({ s, x, y, width, font, size, fill, track: o.track ?? 0, anchor: o.anchor ?? 'start' });
  }

  /** Measured bottom-up, written top-down: a PDF reader and a screen reader meet the title first, the audience last. */
  ink(): CoverLine[] {
    const lines = [...this.lines].sort((a, b) => a.y - b.y);
    for (const l of lines) this.s.text(l.s, l.x, l.y, l.font, l.size, l.fill, { anchor: l.anchor, track: l.track });
    return lines;
  }

  /** « GUIDE PRATIQUE » left, the brand right. A brand too long for the line loses whole words from its end. */
  labels(y: number): void {
    const { v, inks } = this;
    const face = v.labelB;
    const line = (s: string) => advance(face, s, LABEL.size, LABEL.track);
    const label = sanitizeFor(face, 'GUIDE PRATIQUE');
    this.put(label, MARGIN, y, line(label), face, LABEL.size, inks.ink, { track: LABEL.track });
    const room = MEASURE - line(label) - UNIT / 2;
    const brand = wholeClause(sanitizeFor(face, this.words.brand.toUpperCase()), (s) => line(s) <= room);
    if (line(brand) <= room) this.put(brand, COVER_W - MARGIN, y, room, face, LABEL.size, inks.ink, { anchor: 'end', track: LABEL.track });
  }

  /** The audience once, as a whole clause, its last line sitting on `bottom`. Returns the top of the first line. */
  audience(bottom: number, width: number, maxLines: number): number {
    const { v, inks } = this;
    const { audience } = this.words;
    if (!audience) return bottom;
    const wrap = (s: string) => wrapFace(s, v.label, AUDIENCE.size, width);
    const text = sanitizeFor(v.label, `Pour : ${audience}`);
    const lines = wrap(wholeClause(text, (s) => wrap(s).length <= maxLines));
    const top = bottom - (lines.length - 1) * AUDIENCE.leading;
    lines.forEach((l, k) => this.put(l, MARGIN, top + k * AUDIENCE.leading, width, v.label, AUDIENCE.size, inks.ink));
    return top - AUDIENCE.size;
  }

  /** The tail of the title with all its words, or else the subtitle as a whole clause. */
  deck(tail: string, width: number): TextBlock | null {
    const face = this.v.displayIt;
    if (tail) return blockOf(fitDisplay(sanitizeFor(face, tail), face, { width, max: DECK_MAX, min: DECK_MIN, maxLines: DECK_LINES }), DECK_LEADING);
    const subtitle = sanitizeFor(face, this.words.subtitle);
    const fits = (s: string) => wrapFace(s, face, DECK_MIN, width).length <= DECK_LINES;
    const text = wholeClause(subtitle, fits);
    if (!text || !fits(text)) return null;
    return blockOf(fitDisplay(text, face, { width, max: DECK_MAX, min: DECK_MIN, maxLines: DECK_LINES }), DECK_LEADING);
  }

  /** Title then deck, top-down, inside `top..bottom`. */
  headline(head: string, tail: string, top: number, bottom: number, width: number, max: number): TextBlock {
    const { v, inks } = this;
    const deck = this.deck(tail, width);
    const gap = deck ? deck.size * 0.7 : 0;
    const title = titleBlock({ title: sanitizeFor(v.display, head), face: v.display }, width, max, TITLE_MIN, bottom - top - (deck?.height ?? 0) - gap);
    let y = top + title.size * 0.86;
    for (const l of title.lines) {
      this.put(l, MARGIN, y, width, v.display, title.size, inks.ink);
      y += title.lineHeight;
    }
    if (deck) {
      const fill = ensureContrast(inks.a, inks.paper, 4.5);
      y += gap - title.lineHeight + title.size * 0.14 + deck.size * 0.9;
      for (const l of deck.lines) {
        this.put(l, MARGIN, y, width, v.displayIt, deck.size, fill);
        y += deck.lineHeight;
      }
    }
    return title;
  }
}

/** « Affiche »: art on top, 4 or 5 rows by the length of the head, title on paper. */
function split(c: Layout, head: string, tail: string, seed: number): Pick<CoverMeta, 'rows' | 'art' | 'titleSize' | 'titleLines'> {
  const { d, inks } = c;
  const rows = head.length > LONG_HEAD ? 4 : 5;
  const artH = rows * UNIT;
  field(c.s, { x: 0, y: 0, u: UNIT, cols: 6, rows, inks, motif: d.motif, seed, hero: coverHero(rows) });
  c.labels(artH + 32);
  const foot = c.audience(COVER_H - 26, MEASURE, 2);
  const title = c.headline(head, tail, artH + 50, foot - 16, MEASURE, TITLE_MAX);
  return { rows, art: fieldArt(d, inks, seed, rows), titleSize: title.size, titleLines: title.lines };
}

/** « Typo »: paper, the title alone, one hero in the corner. No field: `art` reads the one this seed gives the openers. */
function minimal(c: Layout, head: string, tail: string, seed: number): Pick<CoverMeta, 'rows' | 'art' | 'titleSize' | 'titleLines'> {
  const { d, inks } = c;
  const size = 3 * UNIT;
  const heroY = COVER_H - size;
  placeHero(c.s, d.motif, { x: COVER_W - size, y: heroY, size }, inks, seed);
  c.labels(MARGIN + 18);
  c.audience(COVER_H - 26, COVER_W - size - MARGIN - UNIT / 4, 4);
  const title = c.headline(head, tail, MARGIN + 52, heroY - 24, MEASURE, TITLE_MAX_TYPO);
  return { rows: 0, art: artScore(d, inks, seed), titleSize: title.size, titleLines: title.lines };
}

/** Two layouts are drawn: `centered` and `badge` wear `split`. */
const LAYOUTS: Record<DesignSpec['coverLayout'], typeof split> = { split, centered: split, badge: split, minimal };

/** The cover as a drawing. The art comes from `artSeed`, the candidate the designer kept. */
export function coverScene(input: CoverInput): { scene: Scene; meta: CoverMeta } {
  const d = normalizeDesign(input?.design);
  const inks = d.inks!;
  const { voice } = loadVoice(d.voice!);
  const c = new Layout(input, d, voice, inks);
  const { head, tail } = splitTitle(capTitle(c.words.title || 'Guide pratique'));
  const drawn = LAYOUTS[d.coverLayout](c, head, tail, d.artSeed ?? d.seed);
  return { scene: c.s, meta: { voice, head, tail, ...drawn, lines: c.ink() } };
}

/** 600×848 self-contained SVG cover: no font, no image, no gradient. */
export function renderCoverSvg(input: CoverInput): string {
  const { scene } = coverScene(input);
  const title = clean(input?.title);
  const subtitle = clean(input?.subtitle);
  return toSvg(scene).replace('>', () => ` role="img" aria-label="${escapeXml(title)}"><title>${escapeXml(title)}</title><desc>${escapeXml(subtitle)}</desc>`);
}

/** What the cover scores on, from the real layout. */
export function coverAudit(input: CoverInput): CoverAudit {
  const { meta } = coverScene(input);
  const inks = normalizeDesign(input?.design).inks!;
  const widths = meta.titleLines.map((l) => advance(meta.voice.display, l, meta.titleSize));
  return {
    art: meta.art,
    thumbPx: (meta.titleSize * THUMB_W) / COVER_W,
    lineBalance: 100 * (Math.min(...widths) / Math.max(1, ...widths)),
    contrast: contrast(inks.ink, inks.paper),
    titleLines: meta.titleLines.length,
  };
}
