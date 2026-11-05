/**
 * The colours and the type of a templated page, from the guide's five inks and its voice: light paper by default, every
 * text colour pushed to 4.5:1 at least on every ground it sits on (the pairs are listed, a test reads them all).
 */
import type { ArtStyle, DesignSpec } from '../../shared.js';
import { contrast, darken, ensureContrast, luminance, mix, rgba } from '../color.js';
import { cssFontStack } from '../design.js';
import type { Voice } from '../voices.js';
import { fontFace } from './common.js';

export interface Tokens {
  paper: string; ink: string; muted: string;
  a: string; aText: string; b: string; bText: string; c: string;
  card: string; tint: string; tintA: string; tintB: string; line: string; lineStrong: string;
  band: string; onBand: string; onBandMuted: string; onBandAccent: string;
  btn: string; btnInk: string; btn2: string; btn2Ink: string;
  star: string; starOff: string; mark: string;
  sticker: string; stickerInk: string;
  glass: string; glassAlpha: number; halo: [string, string, string];
}

export interface Pair { fg: string; bg: string; what: string }

export interface Faces { label: boolean; italic: boolean }

const WHITE = '#ffffff';
const MIN = 4.6; // a hair above 4.5: rounding in a browser never takes a text under the line

/** A ground and the text that reads on it: the ink, white or the paper, whichever reads best, the ground darkened until one does. */
function solid(bg: string, ink: string, paper: string): { bg: string; fg: string } {
  let g = bg;
  for (let i = 0; i < 14; i++) {
    const fg = [ink, WHITE, paper].sort((x, y) => contrast(y, g) - contrast(x, g))[0]!;
    if (contrast(fg, g) >= MIN) return { bg: g, fg };
    g = darken(g, 0.08);
  }
  return { bg: g, fg: WHITE };
}

/** The darkest of the light grounds: a colour that reads on it reads on all of them. */
const darkestOf = (...grounds: string[]): string => grounds.sort((x, y) => luminance(x) - luminance(y))[0]!;

export function tokensOf(design: DesignSpec, style: ArtStyle): Tokens {
  const inks = design.inks!;
  const paper = inks.paper;
  const card = mix(paper, WHITE, 0.6);
  const tint = mix(paper, inks.c, 0.2);
  const tintA = mix(paper, inks.a, 0.08);
  const tintB = mix(paper, inks.b, 0.12);
  const ground = darkestOf(paper, card, tint, tintA, tintB);
  const ink = ensureContrast(inks.ink, ground, 7);
  // the highlighter behind a few words: only the ink sits on it
  let mark = mix(paper, inks.c, 0.5);
  for (let i = 0; i < 8 && contrast(ink, mark) < 7; i++) mark = mix(mark, paper, 0.25);
  const muted = ensureContrast(mix(ink, paper, 0.32), ground, MIN);
  const aText = ensureContrast(inks.a, ground, MIN);
  const bText = ensureContrast(inks.b, ground, MIN);
  const band = ensureContrast(inks.ink, WHITE, 9);
  const onBand = ensureContrast(mix(paper, WHITE, 0.4), band, 9);
  const onBandMuted = ensureContrast(mix(onBand, band, 0.24), band, MIN);
  const onBandAccent = ensureContrast(inks.c, band, MIN);
  const primary = style === 'pop' ? inks.c : style === 'trait' || style === 'riso' ? inks.a : style === 'typo' ? inks.a : inks.ink;
  const btn = solid(primary, ink, paper);
  const btn2 = solid(style === 'pop' ? inks.b : card, ink, paper);
  const sticker = solid(style === 'pop' ? inks.b : inks.c, ink, paper);
  const halo: [string, string, string] = [inks.a, inks.b, inks.c];
  // the glass card of `aura` floats on halos: it is opaque enough that its text reads over the strongest ink beneath
  let glassAlpha = 0.72;
  while (glassAlpha < 0.96 && halo.some((x) => contrast(muted, mix(x, card, glassAlpha)) < MIN || contrast(ink, mix(x, card, glassAlpha)) < MIN)) glassAlpha += 0.04;
  return {
    paper, ink, muted, a: inks.a, aText, b: inks.b, bText, c: inks.c,
    card, tint, tintA, tintB, line: rgba(ink, 0.14), lineStrong: rgba(ink, 0.32),
    band, onBand, onBandMuted, onBandAccent,
    btn: btn.bg, btnInk: btn.fg, btn2: btn2.bg, btn2Ink: btn2.fg,
    star: ensureContrast(inks.b, paper, 3), starOff: rgba(ink, 0.18), mark,
    sticker: sticker.bg, stickerInk: sticker.fg,
    glass: rgba(card, Math.round(glassAlpha * 100) / 100), glassAlpha: Math.round(glassAlpha * 100) / 100, halo,
  };
}

/** Every text colour on every ground it is set on. */
export function pairsOf(t: Tokens): Pair[] {
  const light = { paper: t.paper, card: t.card, tint: t.tint, tintA: t.tintA, tintB: t.tintB };
  const out: Pair[] = [];
  for (const [g, bg] of Object.entries(light)) {
    out.push({ fg: t.ink, bg, what: `texte sur ${g}` }, { fg: t.muted, bg, what: `texte discret sur ${g}` }, { fg: t.aText, bg, what: `accent sur ${g}` }, { fg: t.bText, bg, what: `second accent sur ${g}` });
  }
  out.push(
    { fg: t.ink, bg: t.mark, what: 'texte surligné' },
    { fg: t.onBand, bg: t.band, what: 'texte sur bandeau' }, { fg: t.onBandMuted, bg: t.band, what: 'texte discret sur bandeau' }, { fg: t.onBandAccent, bg: t.band, what: 'accent sur bandeau' },
    { fg: t.btnInk, bg: t.btn, what: 'bouton' }, { fg: t.btn2Ink, bg: t.btn2, what: 'bouton secondaire' }, { fg: t.stickerInk, bg: t.sticker, what: 'pastille' },
    { fg: t.paper, bg: t.band, what: 'bandeau de test' },
  );
  for (const x of t.halo) {
    const g = mix(x, t.card, t.glassAlpha);
    out.push({ fg: t.ink, bg: g, what: 'texte sur verre' }, { fg: t.muted, bg: g, what: 'texte discret sur verre' });
  }
  return out;
}

export interface Type { display: string; text: string; label: string; italic: string; fonts: string }

/** The voice's faces, inlined once each: display and text always, the label and the italic when the page sets them. */
export function typeOf(design: DesignSpec, voice: Voice, faces: Faces): Type {
  const sys = `system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
  const fonts = [
    fontFace('Guide Display', voice.display),
    fontFace('Guide Text', voice.text),
    faces.label ? fontFace('Guide Label', voice.labelB) : '',
    faces.italic ? fontFace('Guide Italic', voice.displayIt) : '',
  ].join('');
  return {
    display: `'Guide Display', ${cssFontStack(design.titleFont)}`,
    text: `'Guide Text', ${cssFontStack(design.bodyFont)}`,
    label: faces.label ? `'Guide Label', ${sys}` : sys,
    italic: faces.italic ? `'Guide Italic', 'Guide Display', ${cssFontStack(design.titleFont)}` : `'Guide Display', ${cssFontStack(design.titleFont)}`,
    fonts,
  };
}

export function rootCss(t: Tokens, ty: Type): string {
  return `:root{--paper:${t.paper};--ink:${t.ink};--muted:${t.muted};--a:${t.a};--a-text:${t.aText};--b:${t.b};--b-text:${t.bText};--c:${t.c};
--card:${t.card};--tint:${t.tint};--tint-a:${t.tintA};--tint-b:${t.tintB};--line:${t.line};--line-strong:${t.lineStrong};
--band:${t.band};--on-band:${t.onBand};--on-band-muted:${t.onBandMuted};--on-band-accent:${t.onBandAccent};
--btn:${t.btn};--btn-ink:${t.btnInk};--btn2:${t.btn2};--btn2-ink:${t.btn2Ink};--star:${t.star};--star-off:${t.starOff};--mark:${t.mark};
--sticker:${t.sticker};--sticker-ink:${t.stickerInk};--glass:${t.glass};
--shadow-ink:${rgba(t.ink, 0.22)};--shadow-soft:${rgba(t.ink, 0.12)};
--display:${ty.display};--text:${ty.text};--label:${ty.label};--italic:${ty.italic}}`;
}
