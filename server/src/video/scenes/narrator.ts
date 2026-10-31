/**
 * The narrator of `ugc_avatar`: a flat cartoon in a card, and it looks like one (video §8). Never photoreal, never a
 * claimed customer: a talking head that passes for real would be a fake person with a fake testimony.
 * The mouth follows the word times, it blinks every 3,1 s, the head sways, the brows rise on a loud word.
 * With a proof on this beat, the real page of the guide sits next to it, the real line under the marker.
 */
import { mix, rgba } from '../../deliverables/color.js';
import { hashString } from '../../deliverables/text.js';
import type { Picture, Proof, SceneApi } from '../compose.js';
import { FACE } from '../fonts.js';
import type { SpokenWord } from '../speech.js';
import type { Rect } from '../stage.js';
import { eIO, eOut, type TimelineBeat } from '../timeline.js';

const BLINK_EVERY = 3.1;
const BLINK_SEC = 0.12;
const CLOSED_MOUTH = 0.12;
const SKINS = [['#f2d0b8', '#dcb093'], ['#e8b796', '#d39c78'], ['#c68e6a', '#ad7652'], ['#8d5b3e', '#784a30']] as const;
const LOUD = /\d|!|\p{L}{7,}/u; // what a voice leans on
const BELOW_CAPTION = 70;      // the card ends under the caption
const CAPTION_H = 90;          // ink above the caption's baseline
const HEAD_PAD = 24;           // above the hair, in the card
const BUBBLE_MAX = 60;
const BUBBLE_MIN = 36;
const BUBBLE_ROOM = 0.3;       // of the height, before the text gives up on size
const BUBBLE_LINE = 1.24;
const BUBBLE_PAD = 34;
const BUBBLE_GAP = 26;
const HEAD_RISE = 240;         // hair above the grid's origin
const HEAD_DROP = 146;         // chin below it
const FIGURE_W = 0.72;         // of the card, on the 400 grid
const INSET_SCALE = 0.72;      // with a page beside it
const PAGE = 0.56;             // of the card's width
const PAGE_H = 0.92;           // of its height
const PAGE_TILT = 0.045;
const MIN_FACE = 200;          // a beat's long text may shrink the card, never to nothing
const MARKER_AT = 0.3;         // of the beat
const MARKER_SEC = 0.5;

/** 0 is the smile, 1 wide open. Three openings a word, the shape of a voice, read from the same times as the captions. */
export function mouthOpen(words: readonly SpokenWord[], t: number): number {
  const w = words.find((x) => t >= x.at && t < x.end);
  if (!w) return 0;
  const x = (t - w.at) / Math.max(0.05, w.end - w.at);
  return 0.35 + 0.65 * Math.abs(Math.sin(x * Math.PI * 2.5));
}

/** 1 is open. `at` is the time of the whole film: a short beat blinks too. */
export const eyeOpen = (at: number): number => ((at % BLINK_EVERY) < BLINK_SEC ? 0.08 : 1);

interface Layout { card: Rect; bubble: Rect | null; size: number; lines: string[] }

/** The beat's own text on top, the card under it down to the caption, whatever the ratio. */
function layout(s: SceneApi, b: TimelineBeat): Layout {
  const box = s.column;
  const bottom = Math.min(s.stage.captionY + BELOW_CAPTION, box.y + box.h);
  const height = bottom - box.y;
  const text = b.screen.replace(/^[«"\s]+|[»"\s]+$/g, '');
  if (!text) return { card: { x: box.x, y: box.y, w: box.w, h: height }, bubble: null, size: 0, lines: [] };
  for (let size = BUBBLE_MAX; ; size -= 4) {
    const lines = s.wrap(text, size, FACE.bold, box.w - BUBBLE_PAD * 2);
    const h = lines.length * size * BUBBLE_LINE + BUBBLE_PAD * 1.4;
    if (h <= height * BUBBLE_ROOM || size <= BUBBLE_MIN) {
      const y = box.y + h + BUBBLE_GAP;
      return { card: { x: box.x, y, w: box.w, h: bottom - y }, bubble: { x: box.x, y: box.y, w: box.w, h }, size, lines };
    }
  }
}

function drawBubble(s: SceneApi, l: Layout, t: number): void {
  const { ctx, C } = s;
  const r = l.bubble!;
  ctx.save();
  ctx.shadowColor = 'rgba(30,40,30,0.25)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
  ctx.fillStyle = '#fff';
  s.roundBox(r.x, r.y, r.w, r.h, 36); ctx.fill();
  ctx.restore();
  ctx.fillStyle = C.ink;
  s.font(l.size, FACE.bold, -1);
  l.lines.forEach((line, i) => s.drawText(line, r.x + BUBBLE_PAD, r.y + BUBBLE_PAD * 0.7 + l.size * 0.98 + i * l.size * BUBBLE_LINE, { moving: t < 0.2 }));
}

/** The real page, tilted, its line swept by the marker. It fits the card's height: it never reaches the beat's own text. */
function drawInset(s: SceneApi, proof: Proof, card: Rect, b: TimelineBeat, t: number): void {
  const { ctx, C } = s;
  const a: Picture = proof.picture;
  const w = Math.min(card.w * PAGE, card.h * PAGE_H * a.w / a.h);
  const k = w / a.w;
  const px = card.x + card.w * 0.7;
  const py = card.y + card.h / 2;
  s.page(a, px, py, w, PAGE_TILT, 0, 0.35);
  const sweep = eIO((t - b.dur * MARKER_AT) / MARKER_SEC);
  if (sweep <= 0) return;
  ctx.save();
  ctx.translate(px, py); ctx.rotate(PAGE_TILT);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = C.gold;
  for (const h of proof.boxes) {
    s.roundBox((h.x - a.w / 2) * k - 3, (h.y - a.h / 2) * k - 2, (h.w * k + 6) * sweep, h.h * k + 4, 3);
    ctx.fill();
  }
  ctx.restore();
}

/** Drawn on a 400-wide grid, the shoulders below the frame. */
function figure(s: SceneApi, cx: number, cy: number, size: number, at: number, open: number, look: number, loud: boolean): void {
  const { ctx, C } = s;
  const [skin, skinDark] = SKINS[hashString(s.assets.spec.hook) % SKINS.length]!;
  const hair = mix(C.ink, '#1a0f0a', 0.6);
  const blink = eyeOpen(at);
  ctx.save();
  ctx.translate(cx, cy + Math.sin(at * 2.3) * size * 0.012);
  ctx.scale(size / 400, size / 400);
  ctx.fillStyle = C.primary;
  ctx.beginPath(); ctx.moveTo(-300, 420); ctx.quadraticCurveTo(-290, 170, -90, 150); ctx.lineTo(90, 150); ctx.quadraticCurveTo(290, 170, 300, 420); ctx.closePath(); ctx.fill();
  ctx.fillStyle = mix(C.primary, '#000000', 0.2);
  ctx.beginPath(); ctx.moveTo(-70, 150); ctx.quadraticCurveTo(0, 240, 70, 150); ctx.closePath(); ctx.fill();
  ctx.fillStyle = skinDark;
  s.roundBox(-56, 70, 112, 130, 40); ctx.fill();

  ctx.save();
  ctx.rotate(Math.sin(at * 1.3) * 0.035 + look * 0.05);
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.ellipse(0, -30, 150, 176, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-150, -20, 26, 40, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(150, -20, 26, 40, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.moveTo(-158, -30); ctx.bezierCurveTo(-190, -240, 170, -270, 158, -40); ctx.bezierCurveTo(120, -120, 40, -150, -30, -128); ctx.bezierCurveTo(-90, -110, -140, -90, -158, -30); ctx.fill();
  ctx.strokeStyle = hair; ctx.lineWidth = 15; ctx.lineCap = 'round';
  const raise = loud ? 12 : 0;
  ctx.beginPath(); ctx.moveTo(-96, -66 - raise); ctx.quadraticCurveTo(-66, -82 - raise, -38, -66 - raise); ctx.moveTo(38, -66 - raise); ctx.quadraticCurveTo(66, -82 - raise, 96, -66 - raise); ctx.stroke();
  ctx.fillStyle = '#23201f';
  ctx.beginPath(); ctx.ellipse(-66 + look * 6, -22, 19, 24 * blink, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(66 + look * 6, -22, 19, 24 * blink, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-60 + look * 6, -30, 6 * blink, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(72 + look * 6, -30, 6 * blink, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(224,110,90,0.25)';
  ctx.beginPath(); ctx.arc(-98, 30, 34, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(98, 30, 34, 0, Math.PI * 2); ctx.fill();
  if (open < CLOSED_MOUTH) {
    ctx.strokeStyle = '#8a3f35'; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(-46, 62); ctx.quadraticCurveTo(0, 92, 46, 62); ctx.stroke();
  } else {
    const h = 16 + 46 * open;
    const w = 58 - 12 * open;
    ctx.fillStyle = '#5c211f';
    ctx.beginPath(); ctx.ellipse(0, 70, w, h, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, 70, w, h, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-w, 70 - h, w * 2, h * 0.42);
    ctx.restore();
  }
  ctx.restore();
  ctx.restore();
}

export function drawNarrator(s: SceneApi, b: TimelineBeat, t: number): void {
  const { ctx, C } = s;
  s.background(C.light, mix(C.light, C.secondary, 0.8), 0.2);
  s.floaters(t, rgba(C.primary, 0.08), 6, 5);
  const l = s.memo(b, () => layout(s, b));
  const { card } = l;
  if (l.bubble) drawBubble(s, l, t);
  const proof = s.assets.proofs.get(b.index);

  const rise = eOut(t / 0.2);
  ctx.save();
  ctx.translate(0, (1 - rise) * 40);
  ctx.save();
  ctx.shadowColor = 'rgba(20,30,20,0.28)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 26;
  ctx.fillStyle = mix(C.secondary, '#ffffff', 0.35);
  s.roundBox(card.x, card.y, card.w, card.h, 54); ctx.fill();
  ctx.shadowColor = 'transparent';
  s.roundBox(card.x, card.y, card.w, card.h, 54); ctx.clip();
  const shelfY = card.y + card.h * 0.36;
  ctx.fillStyle = mix(C.secondary, C.primary, 0.3);
  ctx.fillRect(card.x, shelfY, card.w, 16);
  if (!proof) { // the guide on the shelf: the room is about it
    const a = s.assets.cover;
    const w = card.w * 0.2;
    const h = w * a.h / a.w;
    ctx.save();
    ctx.translate(card.x + card.w * 0.84, shelfY - h / 2 + 4);
    ctx.rotate(0.05);
    ctx.drawImage(a.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  // The face stays above the caption, the caption sits on the shirt.
  const above = Math.max(MIN_FACE, s.stage.captionY - CAPTION_H - card.y - HEAD_PAD);
  const fitted = Math.min(above / (HEAD_RISE + HEAD_DROP), card.w * FIGURE_W / 400);
  const k = fitted * (proof ? INSET_SCALE : 1);
  const headTop = card.y + HEAD_PAD + (proof ? above - (HEAD_RISE + HEAD_DROP) * k : 0); // smaller, it keeps its chin on the caption
  const talking = b.words.find((w) => t >= w.at && t < w.end);
  const cx = card.x + card.w * (proof ? 0.26 : 0.5);
  figure(s, cx, headTop + HEAD_RISE * k, 400 * k, b.t0 + t, mouthOpen(b.words, t), Math.sin((b.t0 + t) * 0.7), !!talking && LOUD.test(talking.text));
  ctx.restore();
  if (proof) drawInset(s, proof, card, b, t);
  ctx.restore();
}
