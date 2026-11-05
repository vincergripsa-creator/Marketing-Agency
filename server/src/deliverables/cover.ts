/**
 * Store and PDF cover (pdf §7): one `Scene`, drawn by pdfkit with real text and written as a self-contained 600×848 SVG
 * of paths that needs no font. The design's style draws the art and says where the text goes (D200); the text is set
 * here, so that no style can let a line escape its box. Bauhaus lays out bottom-up: the audience, the deck, and the title
 * gets what is left.
 */
import type { CoverAudit } from '../contracts.js';
import type { DesignSpec, InkSet } from '../shared.js';
import { compositionOf, styleOf } from './art/styles/index.js';
import { COVER_H, COVER_W, MARGIN, THUMB_W, UNIT, type CoverArt, type CoverKit, type DeckFit, type HeadlineStyle, type LabelPlace, type TextBlock, type TextPlace } from './art/styles/types.js';
import { contrast, ensureContrast } from './color.js';
import { normalizeDesign } from './design.js';
import { advance, fitDisplay, loadVoice, sanitizeFor, wrapFace, type FaceName } from './fonts.js';
import { Scene, toSvg } from './scene.js';
import { escapeXml, stripEmoji, wholeClause } from './text.js';
import type { Voice } from './voices.js';

export { COVER_H, COVER_W } from './art/styles/types.js';

/** Beyond this length a cover title is cut (at a word boundary); below it the FULL title is always shown. */
export const COVER_TITLE_MAX_CHARS = 140;

/** How the title of a kit starts: its cover says what it holds, not « GUIDE PRATIQUE ». */
export const KIT_TITLE = 'Le kit à imprimer';

const TITLE_MIN = 30;
const TITLE_LEADING = 1.02;
const TITLE_LINES = 6;
const DECK_MAX = 25;
const DECK_MIN = 17;
const DECK_LEADING = 1.16;
const DECK_LINES = 2;
const LABEL = { size: 9.5, track: 2.2 };
const AUDIENCE = { size: 10.5, leading: 14 };

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

const blockOf = (fit: { size: number; lines: string[] }, leading: number): TextBlock => {
  const lineHeight = fit.size * leading;
  return { lines: fit.lines, size: fit.size, lineHeight, height: lineHeight * fit.lines.length };
};

/** The biggest size that fits: a word is never cut in two, a line is never left with one short word (`fitDisplay`). */
export function titleBlock(c: { title: string; face: FaceName }, width: number, max: number, min = TITLE_MIN, maxHeight?: number, o: { leading?: number; maxLines?: number } = {}): TextBlock {
  const text = capTitle(c.title || 'Guide pratique');
  const leading = o.leading ?? TITLE_LEADING;
  return blockOf(fitDisplay(text, c.face, { width, max, min, maxLines: o.maxLines ?? TITLE_LINES, leading, ...(maxHeight === undefined ? {} : { maxHeight }) }), leading);
}

export interface CoverInput { title: string; subtitle: string; audience: string; design: DesignSpec; brand: string }

/** One line of text and the box it was set in. */
export interface CoverLine { s: string; x: number; y: number; width: number; font: FaceName; size: number; fill: string; track: number; anchor: 'start' | 'end' }

export interface CoverMeta extends CoverArt {
  voice: Voice;           // a PDF registers it before `toPdf`
  head: string; tail: string;
  lines: CoverLine[];     // every line of text of the cover, top-down
}

interface Words { title: string; subtitle: string; audience: string; brand: string }

const clean = (v: string): string => stripEmoji(v ?? '').replace(/\s+/g, ' ').trim();

/** A cover under construction: every line goes through here, so that none escapes the box it was fitted to. */
class Layout implements CoverKit {
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

  /** What the book is, left, the brand right. A brand too long for the line loses whole words from its end. */
  labels(y: number, o: LabelPlace = {}): void {
    const { v, inks } = this;
    const face = v.labelB;
    const left = o.left ?? MARGIN;
    const right = o.right ?? COVER_W - MARGIN;
    const ink = o.ink ?? inks.ink;
    const line = (s: string) => advance(face, s, LABEL.size, LABEL.track);
    const label = sanitizeFor(face, this.words.title.startsWith(KIT_TITLE) ? 'KIT À IMPRIMER' : 'GUIDE PRATIQUE');
    this.put(label, left, y, line(label), face, LABEL.size, ink, { track: LABEL.track });
    const room = right - left - line(label) - UNIT / 2;
    const brand = wholeClause(sanitizeFor(face, this.words.brand.toUpperCase()), (s) => line(s) <= room);
    if (line(brand) <= room) this.put(brand, right, y, room, face, LABEL.size, ink, { anchor: 'end', track: LABEL.track });
  }

  /** The audience once, as a whole clause, its last line sitting on `bottom`. Returns the top of the first line. */
  audience(bottom: number, width: number, maxLines: number, o: TextPlace = {}): number {
    const { v, inks } = this;
    const { audience } = this.words;
    if (!audience) return bottom;
    const x = o.x ?? MARGIN;
    const ink = o.ink ?? inks.ink;
    const wrap = (s: string) => wrapFace(s, v.label, AUDIENCE.size, width);
    const text = sanitizeFor(v.label, `Pour : ${audience}`);
    const lines = wrap(wholeClause(text, (s) => wrap(s).length <= maxLines));
    const top = bottom - (lines.length - 1) * AUDIENCE.leading;
    lines.forEach((l, k) => this.put(l, x, top + k * AUDIENCE.leading, width, v.label, AUDIENCE.size, ink));
    return top - AUDIENCE.size;
  }

  /** The tail of the title with all its words, or else the subtitle as a whole clause. */
  deck(tail: string, width: number, o: DeckFit = {}): TextBlock | null {
    const face = this.v.displayIt;
    const [max, min, lines] = [o.max ?? DECK_MAX, o.min ?? DECK_MIN, o.lines ?? DECK_LINES];
    if (tail) return blockOf(fitDisplay(sanitizeFor(face, tail), face, { width, max, min, maxLines: lines }), DECK_LEADING);
    const subtitle = sanitizeFor(face, this.words.subtitle);
    const fits = (s: string) => wrapFace(s, face, min, width).length <= lines;
    const text = wholeClause(subtitle, fits);
    if (!text || !fits(text)) return null;
    return blockOf(fitDisplay(text, face, { width, max, min, maxLines: lines }), DECK_LEADING);
  }

  /** Title then deck, top-down, inside `top..bottom`. */
  headline(head: string, tail: string, top: number, bottom: number, width: number, max: number, o: HeadlineStyle = {}): TextBlock {
    const { v, inks } = this;
    const x = o.x ?? MARGIN;
    const face = o.face ?? v.display;
    const deck = this.deck(tail, width);
    const gap = deck ? deck.size * 0.7 : 0;
    const title = titleBlock({ title: sanitizeFor(face, head), face }, width, max, o.min ?? TITLE_MIN, bottom - top - (deck?.height ?? 0) - gap, { ...(o.leading ? { leading: o.leading } : {}), ...(o.maxLines ? { maxLines: o.maxLines } : {}) });
    let y = top + title.size * 0.86;
    for (const l of title.lines) {
      this.put(l, x, y, width, face, title.size, o.ink ?? inks.ink);
      y += title.lineHeight;
    }
    if (deck) {
      const fill = o.deckInk ?? ensureContrast(inks.a, inks.paper, 4.5);
      y += gap - title.lineHeight + title.size * 0.14 + deck.size * 0.9;
      for (const l of deck.lines) {
        this.put(l, x, y, width, v.displayIt, deck.size, fill);
        y += deck.lineHeight;
      }
    }
    return title;
  }
}

/** The cover as a drawing, in the design's style and composition. The art comes from `artSeed`, the candidate the designer kept. */
export function coverScene(input: CoverInput): { scene: Scene; meta: CoverMeta } {
  const d = normalizeDesign(input?.design);
  const inks = d.inks!;
  const { voice } = loadVoice(d.voice!);
  const c = new Layout(input, d, voice, inks);
  const { head, tail } = splitTitle(capTitle(c.words.title || 'Guide pratique'));
  const style = styleOf(d);
  const drawn = style.cover(c, { head, tail, seed: d.artSeed ?? d.seed, composition: compositionOf(d, style) });
  return { scene: c.s, meta: { voice, head, tail, ...drawn, lines: c.ink() } };
}

/** 600×848 self-contained SVG cover: no font, no image, gradients in its own `<defs>`. */
export function renderCoverSvg(input: CoverInput): string {
  const { scene } = coverScene(input);
  const title = clean(input?.title);
  const subtitle = clean(input?.subtitle);
  return toSvg(scene).replace('>', () => ` role="img" aria-label="${escapeXml(title)}"><title>${escapeXml(title)}</title><desc>${escapeXml(subtitle)}</desc>`);
}

/** What the cover scores on, from the real layout: the title in the face it was set in, on the ink it stands on. */
export function coverAudit(input: CoverInput): CoverAudit {
  const { meta } = coverScene(input);
  const inks = normalizeDesign(input?.design).inks!;
  const face = meta.titleFace ?? meta.voice.display;
  const widths = meta.titleWidths ?? meta.titleLines.map((l) => advance(face, l, meta.titleSize));
  return {
    art: meta.art,
    thumbPx: (meta.titleSize * THUMB_W) / COVER_W,
    lineBalance: 100 * (Math.min(...widths) / Math.max(1, ...widths)),
    contrast: contrast(meta.titleInk ?? inks.ink, meta.titleGround ?? inks.paper),
    titleLines: meta.titleLines.length,
  };
}
