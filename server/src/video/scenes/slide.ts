/**
 * Text on a plate: a slide of `text_slideshow`, a card of `carousel`, the one image of `static_image` (video §3.4).
 * Words appear at reading speed, and a card is the same slide at its end state, so the film and the still cannot disagree.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contrast, mix, rgba } from '../../deliverables/color.js';
import type { Compositor, SceneApi, TextBox } from '../compose.js';
import { FACE } from '../fonts.js';
import { insideSafe, type Rect } from '../stage.js';
import { eOut, type TimelineBeat } from '../timeline.js';
import { ctaLabel } from './end.js';
import { chipLabel, QUOTE_LABEL } from './fact.js';
import { accentWord, ORPHAN } from './hook.js';
import { drawReview, leadOf } from './review.js';

const WORDS_PER_SEC = 2.6;     // what `max(1.8, words / 2.6 + 0.5)` gives a slide to be read in
const FADE_SEC = 0.08;
const MAX_SIZE = 150;
const MIN_SIZE = 40;
const SIZE_STEP = 4;
const LINE = 1.28;             // a French capital carries its accent into the line above
const LABEL_H = 110;
const BACKDROP = 0.45;         // the cover behind the one image
const BACKDROP_BLUR = 26;
const CTA_MAX = 58;
const CTA_H = 112;
const CTA_FLOOR = 24;          // over the bottom of the zone, the camera's push included
const PILL_GAP = 30;           // between the guide and its button
const UNSAID = 0.9;            // a word of the opening slide yet to be read: it reads, and it is not lit
const DECK_FOOT = 110;         // of the column, on a deck: its place and its arrow
const ARROW_CONTRAST = 3;
const SWAY = 7;                // a held slide breathes: all its words out, nothing else would move and QA would call it frozen
const SWAY_SPEED = 1.4;

interface Plate { top: string; bottom: string; text: string; digit: string }
interface Fit { size: number; lines: string[]; y0: number }

/** Dark, light, dark: a hard cut has to read. A quote stays on the light plate of the comments, past frame 1: the film opens dark. */
function plateOf(s: SceneApi, b: TimelineBeat, quote: boolean): Plate {
  const { C } = s;
  const dark = { top: C.dark, bottom: C.dark2, text: '#ffffff', digit: C.gold };
  const light = { top: C.light, bottom: mix(C.light, C.secondary, 0.7), text: C.ink, digit: C.primary };
  const deep = { top: C.dark2, bottom: mix(C.primary, C.dark, 0.45), text: '#ffffff', digit: C.gold };
  return quote && b.scene !== 0 ? light : ([dark, deep, light] as const)[b.scene % 3]!;
}

/** Largest size that fits the box, measured on the ink: Anton's accented capitals rise above any line height, a « j » past its origin. */
function fit(s: SceneApi, text: string, family: string, box: Rect): Fit {
  const { ctx } = s;
  for (let size = MAX_SIZE; ; size -= SIZE_STEP) {
    const lines = s.wrap(text, size, family, box.w);
    const widest = Math.max(...lines.map((l) => {
      const m = ctx.measureText(l);
      return leadOf(s, l) + Math.max(m.width, m.actualBoundingBoxRight);
    }));
    const ascent = ctx.measureText(lines[0]!).actualBoundingBoxAscent;
    const descent = ctx.measureText(lines.at(-1)!).actualBoundingBoxDescent;
    const ink = ascent + (lines.length - 1) * size * LINE + descent;
    const orphan = lines.length > 1 && lines.some((l) => !l.includes(' ') && l.replace(/[^\p{L}\p{N}]/gu, '').length < ORPHAN);
    if (size <= MIN_SIZE || (widest <= box.w && ink <= box.h && !orphan)) return { size, lines, y0: box.y + (box.h - ink) / 2 + ascent };
  }
}

/**
 * Word by word, at reading speed. The first one is there on the cut: the frame is never empty. `whole`: every word is there
 * at once, and they light at that speed: an opening slide says all of its line on its first frame, one word in the colour.
 */
function words(s: SceneApi, f: Fit, family: string, plate: Plate, box: Rect, center: boolean, t: number, whole = false): void {
  const { ctx } = s;
  s.font(f.size, family);
  const accent = whole ? accentWord(f.lines.flatMap((line) => line.split(' '))) : -1;
  let index = 0;
  f.lines.forEach((line, row) => {
    let x = center ? box.x + (box.w - ctx.measureText(line).width) / 2 : box.x + leadOf(s, line);
    const y = f.y0 + row * f.size * LINE;
    for (const word of line.split(' ')) {
      const age = t - index / WORDS_PER_SEC;
      if (whole || age >= 0) {
        ctx.globalAlpha = !index ? 1 : whole ? UNSAID + (1 - UNSAID) * eOut(age / FADE_SEC) : eOut(age / FADE_SEC);
        ctx.fillStyle = (whole ? index === accent : /\d/.test(word)) ? plate.digit : plate.text;
        s.drawText(word, x, y, { moving: !whole && index > 0 && age < FADE_SEC });
      }
      x += ctx.measureText(`${word} `).width;
      index++;
    }
  });
  ctx.globalAlpha = 1;
}

/** The cards of a deck: a title card is a beat of a film, and the deck opens on its hook, as `cardCountScore` counts it. */
const deckOf = <T extends Pick<TimelineBeat, 'kind'>>(beats: readonly T[]): T[] => beats.filter((b) => b.kind !== 'title_card');

/** One card of a deck has somewhere to go: where it stands, and an arrow until the last one. */
function deckMarks(s: SceneApi, b: TimelineBeat, plate: Plate): void {
  const { ctx, C, column: box } = s;
  const cards = deckOf(s.timeline.beats);
  const x = box.x + box.w - 56;
  const y = box.y + box.h - 40;
  s.font(40, FACE.semi);
  ctx.fillStyle = rgba(plate.text, 0.75);
  s.drawText(`${cards.indexOf(b) + 1}/${cards.length}`, box.x, y + 14);
  ctx.strokeStyle = contrast(C.pop, plate.top) >= ARROW_CONTRAST ? C.pop : plate.text; // a navy button on a navy plate is no arrow
  ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x - 70, y); ctx.lineTo(x, y); ctx.moveTo(x - 30, y - 34); ctx.lineTo(x, y); ctx.lineTo(x - 30, y + 34); ctx.stroke();
}

/** One image: the hook over the guide's own cover, the guide, the button. */
function drawStatic(s: SceneApi, b: TimelineBeat, t: number): void {
  const { ctx, C, column: box, hero, stage } = s;
  s.background(C.dark, C.dark2, 0.5);
  const a = s.assets.cover;
  const k = Math.max(stage.w / a.w, stage.h / a.h);
  ctx.globalAlpha = BACKDROP;
  ctx.filter = `blur(${BACKDROP_BLUR}px)`; // its colours, not its words: text under the hook would read as a mistake
  ctx.drawImage(a.img, (stage.w - a.w * k) / 2, (stage.h - a.h * k) / 2, a.w * k, a.h * k);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  const label = ctaLabel(s.assets.spec.cta);
  const y = stage.zones.at(-1)!.y1 - CTA_H / 2 - CTA_FLOOR;
  const slot = stage.bookSlot;
  const fits = label ? Math.min(1, (y - CTA_H / 2 - PILL_GAP - slot.y) / slot.h) : 1; // the button never lies on the guide's title
  s.book(slot.x + slot.w / 2, slot.y + slot.h * fits / 2, slot.w * fits, 0.14, t);
  const text = b.screen.toLocaleUpperCase('fr-FR');
  const f = s.memo(b, () => fit(s, text, s.display, hero));
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowOffsetY = 9;
  words(s, f, s.display, { top: C.dark, bottom: C.dark2, text: '#ffffff', digit: C.gold }, hero, true, Infinity);
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetY = 0;

  if (!label) return;
  s.font(CTA_MAX, FACE.bold);
  const room = box.w - 90;
  const size = Math.min(CTA_MAX, Math.floor(CTA_MAX * room / ctx.measureText(label).width));
  s.font(size, FACE.bold);
  const pill = ctx.measureText(label).width + 90;
  const cx = box.x + box.w / 2;
  ctx.fillStyle = C.pop;
  ctx.shadowColor = rgba(C.pop, 0.6); ctx.shadowBlur = 44;
  s.roundBox(cx - pill / 2, y - CTA_H / 2, pill, CTA_H, CTA_H / 2); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  s.drawText(label, cx, y + size * 0.36);
  ctx.textAlign = 'left';
}

export function drawSlide(s: SceneApi, b: TimelineBeat, t: number): void {
  const { spec } = s.assets;
  if (spec.format === 'static_image') { drawStatic(s, b, t); return; }
  const { ctx, column: box } = s;
  const deck = spec.format === 'carousel';
  const review = spec.reviews?.[b.scene];
  if (review) {
    drawReview(s, b, t, review, deck ? box.y + box.h - DECK_FOOT : null);
    if (deck) deckMarks(s, b, plateOf(s, b, true));
    return;
  }
  const opening = b.scene === 0;
  const quote = /^\s*«/.test(b.screen);
  const plate = plateOf(s, b, quote);
  s.background(plate.top, plate.bottom, opening ? 0.5 : 0.2);
  s.art(b.t0 + t, 0.1);
  s.floaters(t, rgba(plate.text, 0.07), 7, 5 + b.scene * 3);
  s.band(b.t0 + t);
  if (!b.screen.trim()) return;

  const step = !opening && !quote && chipLabel(b) !== 'REPÈRE';
  const top = (quote || step ? LABEL_H : 0) + SWAY;
  const room = { x: box.x, y: box.y + top, w: box.w, h: box.h - top - SWAY - (deck ? DECK_FOOT : 0) };
  const family = opening ? s.display : FACE.bold;
  const text = opening ? b.screen.toLocaleUpperCase('fr-FR').replace(/[\s.,:;…]+$/, '') : b.screen; // no end mark on a screen, as on the hook
  const f = s.memo(b, () => fit(s, text, family, room));
  if (quote) {
    s.font(38, FACE.bold, 3);
    ctx.fillStyle = opening ? s.C.gold : s.C.primary;
    ctx.textAlign = 'center';
    s.drawText(QUOTE_LABEL, box.x + box.w / 2, box.y + 44);
    ctx.textAlign = 'left';
  }
  if (step) s.chip(chipLabel(b), box.x, box.y + 56, t);
  ctx.save();
  ctx.translate(0, Math.sin(t * SWAY_SPEED) * SWAY);
  words(s, f, family, plate, room, opening && s.timeline.plain, t, opening);
  ctx.restore();
  if (deck) deckMarks(s, b, plate);
}

export interface CardFile { file: string; boxes: readonly TextBox[]; outside: number }

/** Carousel and static image: one PNG per card, at its end state. `outside` counts the text a platform would cover. */
export async function renderCards(comp: Compositor, dir: string): Promise<CardFile[]> {
  const cards: CardFile[] = [];
  for (const [i, b] of deckOf(comp.timeline.beats).entries()) {
    const boxes = [...comp.drawFrame(Math.round((b.t0 + b.dur) * comp.timeline.fps) - 1)];
    const file = `card-${i + 1}.png`;
    await writeFile(join(dir, file), await comp.canvas.encode('png'));
    cards.push({ file, boxes, outside: boxes.filter((box) => !insideSafe(comp.stage, box)).length });
  }
  return cards;
}
