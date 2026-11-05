/**
 * What an art direction is (design plan D200): its compositions, its cover art, its plate for any rectangle and the score of
 * what it drew. Types and the cover's geometry only, so that a style never imports the cover that calls it.
 */
import type { ArtStyle, DesignSpec, InkSet } from '../../../shared.js';
import type { FaceName } from '../../fonts.js';
import type { Scene } from '../../scene.js';
import type { Voice } from '../../voices.js';
import type { HeroPlace } from '../field.js';

export const COVER_W = 600;
export const COVER_H = 848;
/** The tile of a cover field, and the step a style may lay its own grid on. */
export const UNIT = COVER_W / 6;
export const MARGIN = 40;
export const MEASURE = COVER_W - 2 * MARGIN;
/** A title reads on a 150 px wide thumbnail when its capitals stand this tall there (acceptance E6). */
export const THUMB_W = 150;
export const THUMB_CAP_MIN = 7;

export interface TextBlock { lines: string[]; size: number; lineHeight: number; height: number }

/** Where a line of labels goes and in which ink. Absent: the margins and `inks.ink`. */
export interface LabelPlace { ink?: string; left?: number; right?: number }
/** Where a block of small text goes and in which ink. Absent: the left margin and `inks.ink`. */
export interface TextPlace { x?: number; ink?: string }
/** How big the deck may go, and on how many lines. */
export interface DeckFit { max?: number; min?: number; lines?: number }
/** How the title is set. Absent: the voice's display face, `inks.ink`, the deck in `inks.a` made to read on paper. */
export interface HeadlineStyle {
  x?: number;
  ink?: string;
  deckInk?: string;
  face?: FaceName;
  leading?: number;
  min?: number;
  maxLines?: number;
}

/**
 * What a cover's layout gives a style: the scene, and the text set where the style says. Every line goes through `put`, so
 * that none escapes the box it was fitted to; lines are inked last, over the art, top-down.
 */
export interface CoverKit {
  readonly s: Scene;
  readonly d: DesignSpec;
  readonly v: Voice;
  readonly inks: InkSet;
  readonly words: { title: string; subtitle: string; audience: string; brand: string };
  put(s: string, x: number, y: number, width: number, font: FaceName, size: number, fill: string, o?: { anchor?: 'start' | 'end'; track?: number }): void;
  /** What the book is, left, the brand right, on the baseline `y`. */
  labels(y: number, o?: LabelPlace): void;
  /** The audience once, its last line on `bottom`. Returns the top of its first line. */
  audience(bottom: number, width: number, maxLines: number, o?: TextPlace): number;
  /** The tail of the title, or else the subtitle as a whole clause, fitted to `width`. Absent sizes: 25 to 17, two lines. */
  deck(tail: string, width: number, fit?: DeckFit): TextBlock | null;
  /** Title then deck, top-down, inside `top..bottom`. */
  headline(head: string, tail: string, top: number, bottom: number, width: number, max: number, o?: HeadlineStyle): TextBlock;
}

/** What a style is asked to draw: the title cut in two, the seed of its art, the composition kept. */
export interface CoverCall { head: string; tail: string; seed: number; composition: number }

/** What the cover tells its audit. Absent fields read as Bauhaus's: the display face, ink on paper. */
export interface CoverArt {
  rows: number;                // of a tile field: 0 for a cover with none
  art: number;                 // the style's own score of what it drew, on Bauhaus's scale
  titleSize: number;
  titleLines: string[];
  titleWidths?: number[];      // each line as drawn, a sign that closes it counted: what the audit reads for balance
  titleFace?: FaceName;
  titleInk?: string;
  titleGround?: string;        // the ink the whole title stands on
  sticker?: { u: number; v: number }; // where a sticker may land, in shares of the cover: on art, never on the title
}

/** A composition of a cover, named for the founder. */
export interface Composition { id: string; label: string }

/** What a plate is for: a style may draw a band thinner than a film's background. */
export type PlateRole = 'opener' | 'band' | 'close' | 'kit' | 'film';

/**
 * A plate: the art of a guide in a rectangle of `cols` × `rows` units of `u`, from (x, y). `hero` is where the page wants
 * its main figure, in units, and its pose; a style may read it as a wish. Nothing is drawn outside the rectangle.
 */
export interface PlateSpec {
  x: number; y: number; u: number;
  cols: number; rows: number;
  inks: InkSet;
  motif: DesignSpec['motif'];
  seed: number;
  hero: HeroPlace | null;
  role: PlateRole;
}

export interface ArtStyleDef {
  id: ArtStyle;
  /** At least two. A design's `composition` indexes them. */
  compositions: readonly Composition[];
  /** The composition of a design that names none. */
  defaultComposition(d: DesignSpec): number;
  /** Draws the art of the cover and sets its text through the kit. */
  cover(c: CoverKit, call: CoverCall): CoverArt;
  /** The art of the guide in a rectangle: chapter openers, page bands, section closes, kit pages, a film's background. */
  plate(s: Scene, p: PlateSpec): void;
  /** What an art candidate is worth before the title is known, on Bauhaus's scale: `pickArt` compares these. */
  candidate(d: DesignSpec, inks: InkSet, seed: number, composition: number): number;
}
