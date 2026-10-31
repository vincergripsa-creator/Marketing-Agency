/**
 * The compositor: one frame, as a pure function of its index (video §4). Skia draws, `canvas.data()` goes to ffmpeg.
 * Every text call goes through `drawText`, which keeps a ledger of boxes in device space: QA proves the safe zones
 * with it. Loaded by the render worker only, never by the simulation: `@napi-rs/canvas` is optional.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { mix } from '../deliverables/color.js';
import type { Motif } from '../deliverables/design.js';
import { decoRng } from '../deliverables/text.js';
import type { BeatKind } from '../shared.js';
import { displayFontFor, FACE, registerFonts } from './fonts.js';
import type { Guide, NeedleHit } from './pdfPages.js';
import type { QaText } from './qa.js';
import { drawBonus } from './scenes/bonus.js';
import { drawEnd } from './scenes/end.js';
import { drawFact } from './scenes/fact.js';
import { drawHook } from './scenes/hook.js';
import { drawNarrator } from './scenes/narrator.js';
import { drawPain } from './scenes/pain.js';
import { drawProof } from './scenes/proof.js';
import { drawSlide } from './scenes/slide.js';
import { drawTitle } from './scenes/title.js';
import { stillFormat, type RenderSpec } from './spec.js';
import { insideSafe, safeColumn, stageFor, zoneAt, type Rect, type Stage } from './stage.js';
import { beatAtFrame, eBack, eOut, PUNCH_SEC, settledFrames, type Timeline, type TimelineBeat } from './timeline.js';

/** The tallest the camera gets at rest: a jump of 8 %, then a slow push. Text laid out inside `column` survives it. */
const CAM_MAX = 1.1;
const JUMP = 0.08;
const PUSH = 0.006;
const PUSH_MAX_SEC = 3;
const PUNCH = 0.07;
const FLASH_SEC = 0.07;
const FLASH = 0.32;
const VIGNETTE = 0.34;
const GRAIN_ALPHA = 13;        // out of 255. One static image: per-frame grain costs 4,6× the bytes
const PROOF_SCALE = 3.4;       // 2 024 px wide: the punch-ins stay sharp
const COVER_SCALE = 2;
const CAPTION_SIZE = 76;
const LOW_CAPTION = 135;       // below the bubbles
const NBSP = String.fromCharCode(0xa0);

export interface Picture { img: Image | Canvas; w: number; h: number }
export interface Proof extends NeedleHit { picture: Picture }
export interface Inks { dark: string; dark2: string; light: string; ink: string; pop: string; gold: string; primary: string; secondary: string; accent: string }

export interface Assets {
  spec: RenderSpec;
  cover: Picture;
  proofs: Map<number, Proof>;  // by beat index. Absent: that beat falls back on a fact card (`no_pages`)
  fan: Picture[];              // pages behind the book in the bonus
}

export interface TextBox extends Rect { text: string }
export interface TextOpts {
  stroke?: boolean;
  moving?: boolean;            // a word mid-slam: the ledger reads text at rest, QA reads settled frames
}

export type SceneDraw = (s: SceneApi, b: TimelineBeat, t: number) => void;

/** What a scene may use. Scenes import no value from this file, so the table below stays a plain import. */
export interface SceneApi {
  ctx: SKRSContext2D;
  stage: Stage;                // always the 1080-wide one: scenes draw in these units
  timeline: Timeline;
  assets: Assets;
  C: Inks;
  display: string;             // face of the hook
  column: Rect;                // safe at every height, under the camera
  hero: Rect;                  // the hook's box, under the camera
  captionTop: number;          // nothing of the scene reads below this on a low-caption beat
  shot: number;                // index of the current shot in this beat
  since: number;               // seconds since it started
  jump: number;                // camera factor of this shot: end card uses it on its pictures only
  font(size: number, family: string, spacing?: number): void;
  wrap(text: string, size: number, family: string, maxW: number): string[];
  drawText(text: string, x: number, y: number, opts?: TextOpts): void;
  roundBox(x: number, y: number, w: number, h: number, r: number): void;
  background(top: string, bottom: string, shift?: number): void;
  floaters(t: number, color: string, n?: number, seed?: number): void;
  page(a: Picture, x: number, y: number, w: number, rot?: number, shear?: number, shadow?: number): void;
  book(x: number, y: number, w: number, rot: number, t: number): void;
  chip(text: string, x: number, y: number, t: number, color?: string): void;
  memo<T>(key: object, make: () => T): T;
}

interface SceneDef {
  draw: SceneDraw;
  camera?: boolean;            // jumps between shots. `page_proof` and `end_card` move their own pictures
  caption?: boolean;
  low?: boolean;               // caption below the bubbles
  noProgress?: boolean;
  hardCut?: boolean;           // no flash and no punch: a slideshow cuts on the music, video §3.4
}

const SCENES: Record<BeatKind, SceneDef> = {
  title_card: { draw: drawTitle, camera: true },
  hook: { draw: drawHook, camera: true },
  pain_bubble: { draw: drawPain, camera: true, caption: true, low: true },
  page_proof: { draw: drawProof, caption: true },
  fact_card: { draw: drawFact, camera: true, caption: true },
  bonus_stack: { draw: drawBonus, camera: true, caption: true },
  narrator: { draw: drawNarrator, camera: true, caption: true },
  slide: { draw: drawSlide, camera: true, hardCut: true },
  end_card: { draw: drawEnd, noProgress: true },
};

// ── pieces ──

const SHAPES = {
  leaf(c: SKRSContext2D, s: number) { c.moveTo(0, -s); c.quadraticCurveTo(s * 0.8, -s * 0.2, 0, s); c.quadraticCurveTo(-s * 0.8, -s * 0.2, 0, -s); },
  disc(c: SKRSContext2D, s: number) { c.arc(0, 0, s * 0.6, 0, Math.PI * 2); },
  heart(c: SKRSContext2D, s: number) { c.moveTo(0, s * 0.8); c.bezierCurveTo(-s * 1.2, -s * 0.1, -s * 0.5, -s, 0, -s * 0.3); c.bezierCurveTo(s * 0.5, -s, s * 1.2, -s * 0.1, 0, s * 0.8); },
  star(c: SKRSContext2D, s: number) { c.moveTo(0, -s); c.quadraticCurveTo(0, 0, s, 0); c.quadraticCurveTo(0, 0, 0, s); c.quadraticCurveTo(0, 0, -s, 0); c.quadraticCurveTo(0, 0, 0, -s); },
};
const SHAPE_OF: Partial<Record<Motif, keyof typeof SHAPES>> = { leaf: 'leaf', pot: 'leaf', moon: 'disc', sun: 'disc', coin: 'disc', heart: 'heart', paw: 'heart' };

function saturate(c: string, amount: number): string {
  const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const m = (v[0]! + v[1]! + v[2]!) / 3;
  const hex = v.map((x) => Math.round(Math.max(0, Math.min(255, m + (x - m) * amount))).toString(16).padStart(2, '0'));
  return `#${hex.join('')}`;
}

function inksOf(p: RenderSpec['design']['palette']): Inks {
  return {
    dark: mix(p.primary, '#050807', 0.68),
    dark2: mix(p.primary, '#050807', 0.42),
    light: mix(p.bg, '#ffffff', 0.25),
    ink: mix(p.ink, '#000000', 0.25),
    pop: saturate(mix(p.accent, '#ff8a3c', 0.35), 1.25),
    gold: '#ffd84d',
    primary: p.primary,
    secondary: p.secondary,
    accent: p.accent,
  };
}

function makeGrain(w: number, h: number): Canvas {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);
  const random = decoRng(1234);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = random() * 255;
    image.data[i] = v; image.data[i + 1] = v; image.data[i + 2] = v; image.data[i + 3] = GRAIN_ALPHA;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** No PDF and no cover.svg: a plain card with the title, so the book of the ad still reads as a book. */
function plainCover(spec: RenderSpec): Picture {
  const w = 600; const h = 848;
  const img = createCanvas(w, h);
  const ctx = img.getContext('2d');
  const inks = inksOf(spec.design.palette);
  ctx.fillStyle = inks.primary;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.font = `46px ${FACE.bold}`;
  const lines: string[] = [];
  for (const word of spec.title.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= w - 100) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  lines.slice(0, 8).forEach((line, i) => ctx.fillText(line, 50, 170 + i * 60));
  return { img, w, h };
}

async function coverFromSvg(path: string): Promise<Picture | null> {
  try {
    const img = await loadImage(await readFile(path));
    return img.width > 0 ? { img, w: img.width, h: img.height } : null;
  } catch {
    return null;
  }
}

/** Three pages behind the book, the proof pages first: the viewer already met them. */
function fanPages(count: number, proofs: number[]): number[] {
  const inner = Array.from({ length: Math.max(0, count - 2) }, (_, i) => i + 2); // neither the cover nor the back page
  const spread = [0.75, 0.5, 0.3].map((f) => inner[Math.floor(f * inner.length)]).filter((n): n is number => n !== undefined);
  return [...new Set([...spread, ...proofs])].slice(0, 3);
}

/** `pages: false` is the `no_pages` level. A guide that does not open lands there too, for this render only. */
export async function loadAssets(spec: RenderSpec, timeline: Timeline, stage: Stage, root: string, opts: { pages?: boolean } = {}): Promise<Assets> {
  registerFonts();
  const k = stage.w / stageFor(stage.ratio).w;
  const proofs = new Map<number, Proof>();
  const fan: Picture[] = [];
  let cover: Picture | null = null;
  let guide: Guide | null = null;
  if (opts.pages !== false && spec.pdf) {
    try {
      guide = await (await import('./pdfPages.js')).openGuide(join(root, spec.pdf));
    } catch (err) {
      console.warn(`[video] ${spec.creativeId}: guide unreadable: ${(err as Error).message}`);
    }
  }
  if (guide) {
    try {
      for (const beat of timeline.beats) {
        const hit = (beat.kind === 'page_proof' || beat.kind === 'narrator') && beat.proof ? guide.findNeedle(beat.proof.needle) : null;
        if (hit) proofs.set(beat.index, { ...hit, picture: await guide.pageImage(hit.page, Math.max(1, PROOF_SCALE * k)) });
      }
      if (timeline.beats.some((b) => b.kind === 'bonus_stack')) {
        for (const n of fanPages(guide.pages, [...proofs.values()].map((p) => p.page))) fan.push(await guide.pageImage(n, Math.max(1, COVER_SCALE * k)));
      }
      cover = await guide.pageImage(1, Math.max(1, COVER_SCALE * k));
    } catch (err) {
      console.warn(`[video] ${spec.creativeId}: pages unavailable: ${(err as Error).message}`);
    } finally {
      await guide.close();
    }
  }
  cover ??= (spec.cover ? await coverFromSvg(join(root, spec.cover)) : null) ?? plainCover(spec);
  return { spec, cover, proofs, fan };
}

// ── the compositor ──

export interface Compositor {
  canvas: Canvas;
  stage: Stage;                // as asked: device pixels
  timeline: Timeline;
  /** Draws frame `i` on the canvas, and returns the text at rest on it, in device space. */
  drawFrame(i: number): readonly TextBox[];
  /** The ledgered text call, for a test that plants a box. In logical units, on the frame last drawn. */
  drawText(text: string, x: number, y: number, opts?: TextOpts): void;
  /** Raw RGBA for `encodeMp4`, one view of the canvas per frame. */
  rgbaFrames(): Generator<Uint8Array>;
}

export function createCompositor(timeline: Timeline, stage: Stage, assets: Assets): Compositor {
  registerFonts();
  const logical = stageFor(stage.ratio);
  const { w: W, h: H } = logical;
  const kx = stage.w / W;
  const ky = stage.h / H;
  const canvas = createCanvas(stage.w, stage.h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const grain = makeGrain(stage.w, stage.h);
  const safe = safeColumn(logical);
  const camX = safe.x + safe.w / 2;
  const camY = safe.y + safe.h / 2;
  const underCamera = (r: Rect): Rect => ({ x: camX + (r.x - camX) / CAM_MAX, y: camY + (r.y - camY) / CAM_MAX, w: r.w / CAM_MAX, h: r.h / CAM_MAX });
  const lowest = logical.zones[logical.zones.length - 1]!;
  const lowCaptionY = Math.min(logical.captionY + LOW_CAPTION, lowest.y1 - 40);
  const shape = SHAPES[SHAPE_OF[assets.spec.design.motif] ?? 'star'];
  const memos = new Map<object, unknown>();
  const still = stillFormat(assets.spec.format); // a card is a picture: no time passes on it
  let ledger: TextBox[] = [];
  let settling = false;

  function font(size: number, family: string, spacing = 0): void {
    ctx.font = `${size}px ${family}`;
    ctx.letterSpacing = `${spacing}px`;
  }

  function record(text: string, x: number, y: number): void {
    const m = ctx.measureText(text);
    const left = x - m.actualBoundingBoxLeft;
    const right = x + m.actualBoundingBoxRight;
    const top = y - m.actualBoundingBoxAscent;
    const bottom = y + m.actualBoundingBoxDescent;
    const { a, b, c, d, e, f } = ctx.getTransform();
    const xs = [left, right, left, right].map((px, i) => a * px + c * (i < 2 ? top : bottom) + e);
    const ys = [left, right, left, right].map((px, i) => b * px + d * (i < 2 ? top : bottom) + f);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    ledger.push({ text, x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 });
  }

  function drawText(text: string, x: number, y: number, opts: TextOpts = {}): void {
    if (opts.stroke) ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    if (!opts.moving && !settling) record(text, x, y);
  }

  function roundBox(x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function background(top: string, bottom: string, shift = 0): void {
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * (0.3 + 0.4 * shift), H * 0.34, 10, W * 0.5, H * 0.4, H * 0.62);
    glow.addColorStop(0, 'rgba(255,255,255,0.13)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  }

  function vignette(): void {
    const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.28, W / 2, H * 0.45, H * 0.74);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${VIGNETTE})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  /** Drifting shapes of the guide's motif: depth without footage. */
  function floaters(t: number, color: string, n = 7, seed = 3): void {
    const random = decoRng(seed);
    ctx.save();
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x0 = random() * W; const y0 = random() * H; const size = 30 + random() * 120; const speed = 10 + random() * 22; const rot = random() * 6;
      const y = ((y0 - t * speed) % (H + 200) + H + 200) % (H + 200) - 100;
      ctx.save();
      ctx.translate(x0 + Math.sin(t * 0.7 + i) * 24, y);
      ctx.rotate(rot + t * 0.25);
      ctx.beginPath();
      shape(ctx, size);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function page(a: Picture, x: number, y: number, w: number, rot = 0, shear = 0, shadow = 0.45): void {
    const h = w * a.h / a.w;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.transform(1, shear, 0, 1, 0, 0);
    ctx.shadowColor = `rgba(0,0,0,${shadow})`; ctx.shadowBlur = 60; ctx.shadowOffsetY = 34;
    ctx.fillStyle = '#fff';
    roundBox(-w / 2, -h / 2, w, h, 12); ctx.fill();
    ctx.shadowColor = 'transparent';
    roundBox(-w / 2, -h / 2, w, h, 12); ctx.clip();
    ctx.drawImage(a.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /** The cover over a stack of page edges, with a moving sheen. */
  function book(x: number, y: number, w: number, rot: number, t: number): void {
    const a = assets.cover;
    const h = w * a.h / a.w;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 70; ctx.shadowOffsetY = 40;
    for (let k = 6; k >= 1; k--) {
      ctx.fillStyle = k % 2 ? '#f4f1e8' : '#e4e0d4';
      roundBox(-w / 2 + k * 4, -h / 2 + k * 3, w, h, 10); ctx.fill();
      ctx.shadowColor = 'transparent';
    }
    roundBox(-w / 2, -h / 2, w, h, 10); ctx.clip();
    ctx.drawImage(a.img, -w / 2, -h / 2, w, h);
    const sx = -w + (((t * 0.35) % 1) * w * 3);
    const g = ctx.createLinearGradient(sx, -h / 2, sx + w * 0.5, h / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function chip(text: string, x: number, y: number, t: number, color = C.pop): void {
    const grow = eBack(t / 0.18);
    font(46, FACE.bold, 2);
    const w = ctx.measureText(text).width + 56;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(-0.035); ctx.scale(grow, grow);
    ctx.fillStyle = color;
    roundBox(0, -56, w, 78, 16); ctx.fill();
    ctx.fillStyle = '#fff';
    drawText(text, 28, 2, { moving: t < 0.18 });
    ctx.restore();
  }

  function wrap(text: string, size: number, family: string, maxW: number): string[] {
    font(size, family);
    const lines: string[] = [];
    let cur = '';
    // A French line opens neither on a closing mark nor on ? ! : ;, and does not end on an opening one.
    const glued = text.replace(/« /g, `«${NBSP}`).replace(/ ([»?!:;])/g, `${NBSP}$1`);
    for (const word of glued.split(/[ \t\n]+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = word; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function memo<T>(key: object, make: () => T): T {
    if (!memos.has(key)) memos.set(key, make());
    return memos.get(key) as T;
  }

  const C = inksOf(assets.spec.design.palette);
  const api: SceneApi = {
    ctx, stage: logical, timeline, assets, C,
    display: displayFontFor(assets.spec.design),
    column: underCamera(safe),
    hero: underCamera(logical.heroBox),
    captionTop: lowCaptionY - CAPTION_SIZE - 16,
    shot: 0, since: 0, jump: 1,
    font, wrap, drawText, roundBox, background, floaters, page, book, chip, memo,
  };

  /** The group pops in, the spoken word sits on a pill. One group at a time: a caption never stacks. */
  function caption(b: TimelineBeat, t: number, y: number): void {
    let group: TimelineBeat['groups'][number] | null = null;
    for (const g of b.groups) if (t >= g[0]!.at - 0.03) group = g;
    if (!group || t > b.speech + 0.1) return;
    const zone = zoneAt(logical, y);
    font(CAPTION_SIZE, FACE.bold, -1);
    const texts = group.map((w) => w.text.replace(/^[«»"(]+|[«»",.:;!?)]+$/g, '').toLocaleUpperCase('fr-FR'));
    const gap = CAPTION_SIZE * 0.3;
    const widths = texts.map((s) => ctx.measureText(s).width);
    const full = widths.reduce((a, c) => a + c, 0) + gap * (widths.length - 1);
    const fit = Math.min(1, (zone.x1 - zone.x0 - 48) / full);
    const popped = (t - group[0]!.at) / 0.13;
    const pop = (0.86 + 0.14 * eBack(popped)) * fit;
    ctx.save();
    ctx.translate((zone.x0 + zone.x1) / 2, y);
    ctx.scale(pop, pop);
    ctx.translate(-full / 2, 0);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 15;
    ctx.strokeStyle = 'rgba(0,0,0,0.92)';
    let x = 0;
    group.forEach((w, i) => {
      const width = widths[i]!;
      const on = timeline.pill && t >= w.at - 0.02 && t < w.end;
      const grow = on ? 1 + 0.07 * (1 - eOut((t - w.at) / 0.1)) : 1;
      ctx.save();
      ctx.translate(x + width / 2, 0);
      ctx.scale(grow, grow);
      if (on) {
        ctx.fillStyle = C.pop;
        roundBox(-width / 2 - 16, -CAPTION_SIZE * 0.92, width + 32, CAPTION_SIZE * 1.2, 18); ctx.fill();
      }
      ctx.fillStyle = '#fff';
      drawText(texts[i]!, 0, 0, { stroke: !on, moving: popped < 1 || grow > 1.001 });
      ctx.restore();
      x += width + gap;
    });
    ctx.restore();
    ctx.textAlign = 'left';
  }

  function progressBar(at: number): void {
    const zone = logical.zones[0]!;
    const w = zone.x1 - zone.x0;
    const y = zone.y0 - 26;
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    roundBox(zone.x0, y, w, 10, 5); ctx.fill();
    ctx.fillStyle = C.gold;
    roundBox(zone.x0, y, Math.max(10, w * at / timeline.total), 10, 5); ctx.fill();
  }

  function drawFrame(i: number): readonly TextBox[] {
    const frame = Math.max(0, Math.min(timeline.frames - 1, i));
    const at = frame / timeline.fps;
    const b = beatAtFrame(timeline, frame);
    const t = at - b.t0;
    const scene = SCENES[b.kind];
    const shot = b.shotAt.findLastIndex((s) => t >= s);
    const since = t - (b.shotAt[shot] ?? 0);
    const punch = scene.hardCut ? 1 : 1 + PUNCH * (1 - eOut(since / PUNCH_SEC));
    const jump = (1 + JUMP * (shot % 2)) * (1 + PUSH * Math.min(since, PUSH_MAX_SEC));
    const camera = (scene.camera ? jump : 1) * punch;
    api.shot = shot; api.since = since; api.jump = jump;
    ledger = [];
    settling = !scene.hardCut && since < PUNCH_SEC;
    ctx.setTransform(kx, 0, 0, ky, 0, 0);
    ctx.save();
    ctx.translate(camX, camY);
    ctx.scale(camera, camera);
    ctx.translate(-camX, -camY);
    scene.draw(api, b, t);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    settling = false;
    vignette();
    if (scene.caption) caption(b, t, scene.low ? lowCaptionY : logical.captionY);
    if (!scene.noProgress && !still) progressBar(at);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(grain, 0, 0);
    if (t < FLASH_SEC && b.index > 0 && !scene.hardCut) {
      ctx.fillStyle = `rgba(255,255,255,${FLASH * (1 - t / FLASH_SEC)})`;
      ctx.fillRect(0, 0, stage.w, stage.h);
    }
    ctx.setTransform(kx, 0, 0, ky, 0, 0);
    return ledger;
  }

  return {
    canvas, stage, timeline, drawFrame, drawText,
    *rgbaFrames() {
      for (let i = 0; i < timeline.frames; i++) { drawFrame(i); yield canvas.data(); }
    },
  };
}

/** What QA needs of the ledger: settled frames with their boxes, the zones, and a way to redraw a frame. */
export function textProof(c: Compositor): QaText {
  return {
    frames: settledFrames(c.timeline).map((frame) => ({ frame, boxes: [...c.drawFrame(frame)] })),
    inside: (box) => insideSafe(c.stage, box),
    redraw(frame) {
      c.drawFrame(frame);
      return c.canvas.data();
    },
  };
}
