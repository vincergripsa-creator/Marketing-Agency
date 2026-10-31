/**
 * Text on a plate: a slide of `text_slideshow`, a card of `carousel`, the one image of `static_image` (video §3.4).
 * Words appear at reading speed, and a card is the same slide at its end state, so the film and the still cannot disagree.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mix, rgba } from '../../deliverables/color.js';
import type { Compositor, SceneApi, TextBox } from '../compose.js';
import { FACE } from '../fonts.js';
import { insideSafe, type Rect } from '../stage.js';
import { eOut, type TimelineBeat } from '../timeline.js';
import { ctaLabel } from './end.js';
import { chipLabel } from './fact.js';

const WORDS_PER_SEC = 2.6;     // what `max(1.8, words / 2.6 + 0.5)` gives a slide to be read in
const FADE_SEC = 0.08;
const MAX_SIZE = 150;
const MIN_SIZE = 40;
const SIZE_STEP = 4;
const LINE = 1.28;             // a French capital carries its accent into the line above
const LABEL_H = 110;
const QUOTE_LABEL = 'LU DANS LES COMMENTAIRES';
const BACKDROP = 0.45;         // the cover behind the one image
const BACKDROP_BLUR = 26;
const CTA_MAX = 58;
const CTA_H = 112;
const CTA_FLOOR = 24;          // over the bottom of the zone, the camera's push included
const BEARING = 8;             // a « j » reaches left of its origin, and a left edge sits on the zone's
const SWAY = 7;                // a held slide breathes: all its words out, nothing else would move and QA would call it frozen
const SWAY_SPEED = 1.4;

interface Plate { top: string; bottom: string; text: string; digit: string }
interface Fit { size: number; lines: string[]; y0: number }

/** Dark, light, dark: a hard cut has to read, and a quote stays on the light plate of the comments. */
function plateOf(s: SceneApi, b: TimelineBeat, quote: boolean): Plate {
  const { C } = s;
  const dark = { top: C.dark, bottom: C.dark2, text: '#ffffff', digit: C.gold };
  const light = { top: C.light, bottom: mix(C.light, C.secondary, 0.7), text: C.ink, digit: C.primary };
  const deep = { top: C.dark2, bottom: mix(C.primary, C.dark, 0.45), text: '#ffffff', digit: C.gold };
  return quote ? light : ([dark, deep, light] as const)[b.scene % 3]!;
}

/** Largest size that fits the box, measured on the ink: Anton's accented capitals rise above any line height. */
function fit(s: SceneApi, text: string, family: string, box: Rect): Fit {
  const { ctx } = s;
  for (let size = MAX_SIZE; ; size -= SIZE_STEP) {
    const lines = s.wrap(text, size, family, box.w);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const ascent = ctx.measureText(lines[0]!).actualBoundingBoxAscent;
    const descent = ctx.measureText(lines.at(-1)!).actualBoundingBoxDescent;
    const ink = ascent + (lines.length - 1) * size * LINE + descent;
    if (size <= MIN_SIZE || (widest <= box.w && ink <= box.h)) return { size, lines, y0: box.y + (box.h - ink) / 2 + ascent };
  }
}

/** Word by word, at reading speed. The first one is there on the cut: the frame is never empty. */
function words(s: SceneApi, f: Fit, family: string, plate: Plate, box: Rect, center: boolean, t: number): void {
  const { ctx } = s;
  s.font(f.size, family);
  let index = 0;
  f.lines.forEach((line, row) => {
    let x = center ? box.x + (box.w - ctx.measureText(line).width) / 2 : box.x;
    const y = f.y0 + row * f.size * LINE;
    for (const word of line.split(' ')) {
      const age = t - index / WORDS_PER_SEC;
      if (age >= 0) {
        ctx.globalAlpha = index ? eOut(age / FADE_SEC) : 1;
        ctx.fillStyle = /\d/.test(word) ? plate.digit : plate.text;
        s.drawText(word, x, y, { moving: index > 0 && age < FADE_SEC });
      }
      x += ctx.measureText(`${word} `).width;
      index++;
    }
  });
  ctx.globalAlpha = 1;
}

/** One card of a deck has somewhere to go: where it stands, and an arrow until the last one. */
function deckMarks(s: SceneApi, b: TimelineBeat, plate: Plate): void {
  const { ctx, C, column: box } = s;
  const cards = s.timeline.beats.length;
  s.font(40, FACE.semi);
  ctx.fillStyle = rgba(plate.text, 0.75);
  ctx.textAlign = 'right';
  s.drawText(`${b.index + 1}/${cards}`, box.x + box.w, box.y + 40);
  ctx.textAlign = 'left';
  const x = box.x + box.w - 56;
  const y = box.y + box.h - 40;
  ctx.strokeStyle = C.pop; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
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
  const slot = stage.bookSlot;
  s.book(slot.x + slot.w / 2, slot.y + slot.h / 2, slot.w, 0.14, t);
  const text = b.screen.toLocaleUpperCase('fr-FR');
  const f = s.memo(b, () => fit(s, text, s.display, hero));
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowOffsetY = 9;
  words(s, f, s.display, { top: C.dark, bottom: C.dark2, text: '#ffffff', digit: C.gold }, hero, true, Infinity);
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetY = 0;

  const label = ctaLabel(s.assets.spec.cta);
  if (!label) return;
  s.font(CTA_MAX, FACE.bold);
  const room = box.w - 90;
  const size = Math.min(CTA_MAX, Math.floor(CTA_MAX * room / ctx.measureText(label).width));
  s.font(size, FACE.bold);
  const pill = ctx.measureText(label).width + 90;
  const cx = box.x + box.w / 2;
  const y = stage.zones.at(-1)!.y1 - CTA_H / 2 - CTA_FLOOR;
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
  const opening = b.scene === 0;
  const quote = /^\s*«/.test(b.screen);
  const plate = plateOf(s, b, quote);
  s.background(plate.top, plate.bottom, opening ? 0.5 : 0.2);
  s.floaters(t, rgba(plate.text, 0.07), 7, 5 + b.scene * 3);
  if (!b.screen.trim()) return;

  const step = !opening && !quote && chipLabel(b) !== 'REPÈRE';
  const top = (quote || step ? LABEL_H : 0) + SWAY;
  const room = { x: box.x + BEARING, y: box.y + top, w: box.w - BEARING * 2, h: box.h - top - SWAY };
  const family = opening ? s.display : FACE.bold;
  const text = opening ? b.screen.toLocaleUpperCase('fr-FR') : b.screen;
  const f = s.memo(b, () => fit(s, text, family, room));
  if (quote) {
    s.font(38, FACE.bold, 3);
    ctx.fillStyle = s.C.primary;
    ctx.textAlign = 'center';
    s.drawText(QUOTE_LABEL, box.x + box.w / 2, box.y + 44);
    ctx.textAlign = 'left';
  }
  if (step) s.chip(chipLabel(b), box.x, box.y + 56, t);
  ctx.save();
  ctx.translate(0, Math.sin(t * SWAY_SPEED) * SWAY);
  words(s, f, family, plate, room, opening, t);
  ctx.restore();
  if (spec.format === 'carousel') deckMarks(s, b, plate);
}

export interface CardFile { file: string; boxes: readonly TextBox[]; outside: number }

/** Carousel and static image: one PNG per beat, at its end state. `outside` counts the text a platform would cover. */
export async function renderCards(comp: Compositor, dir: string): Promise<CardFile[]> {
  const cards: CardFile[] = [];
  for (const b of comp.timeline.beats) {
    const boxes = [...comp.drawFrame(Math.round((b.t0 + b.dur) * comp.timeline.fps) - 1)];
    const file = `card-${b.index + 1}.png`;
    await writeFile(join(dir, file), await comp.canvas.encode('png'));
    cards.push({ file, boxes, outside: boxes.filter((box) => !insideSafe(comp.stage, box)).length });
  }
  return cards;
}
