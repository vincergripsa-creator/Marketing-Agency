// Procedural pixel characters built from an AvatarSpec, cached as one sprite sheet per avatar,
// plus what they carry (carton, sac) and small pixel status icons (!, …, ☕, loupe, couronne…).
import type { AvatarSpec } from '../../../shared/types';
import { drawPixelText } from './font';
import { addOutline, makeCanvas, type Baked, type Ctx } from './pixel';
import { mix, shade } from './palette';

export const CELL_W = 16;
export const CELL_H = 24;
/** Feet anchor inside a cell (world point where the agent stands). */
export const ANCHOR_X = 8;
export const ANCHOR_Y = 22;

export const FRAME = {
  walkFront: 0, // 0..3
  walkBack: 4, // 4..7
  idleFront: 8, // 8 (eyes open), 9 (blink)
  idleBack: 10, // 10, 11
  sit: 12, // 12, 13 typing
  sitStill: 14,
  coffee: 15, // 15 hold, 16 sip
  carryFront: 17, // 17..20
  carryBack: 21, // 21..24
  cheer: 25, // 25, 26 (body 1 px higher)
  slump: 27,
  shake: 28,
} as const;
const FRAME_COUNT = 29;

type View = 'front' | 'back';
type Pose = 'walk' | 'idle' | 'sit' | 'coffee' | 'carry' | 'cheer' | 'slump' | 'shake';

interface Colors {
  skin: string; skinShade: string; blush: string;
  hair: string; hairLight: string; hairShade: string;
  shirt: string; shirtShade: string; shirtLight: string;
  pants: string; pantsShade: string;
  shoe: string; eye: string; accent: string;
}

function colorsFor(a: AvatarSpec): Colors {
  const skin = a.skin || '#f1c7a5';
  const hair = a.hair || '#3b2a20';
  const shirt = a.shirt || '#4f7cff';
  const pants = a.pants || '#3a3f5c';
  return {
    skin, skinShade: shade(skin, -0.16), blush: mix(skin, '#ff6f8a', 0.35),
    hair, hairLight: shade(hair, 0.28), hairShade: shade(hair, -0.22),
    shirt, shirtShade: shade(shirt, -0.2), shirtLight: shade(shirt, 0.22),
    pants, pantsShade: shade(pants, -0.22),
    shoe: '#2e2433', eye: '#251a2e', accent: mix(shirt, '#ffcf4a', 0.5),
  };
}

const OY = 1; // one free row on top for the outline of buns / curls

function painter(g: Ctx) {
  const p = (x: number, y: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y + OY, 1, 1);
  };
  const r = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y + OY, w, h);
  };
  return { p, r };
}

function paintFigure(g: Ctx, a: AvatarSpec, c: Colors, view: View, pose: Pose, frame: number): void {
  const { p, r } = painter(g);
  const sit = pose === 'sit';
  const walking = pose === 'walk' || pose === 'carry';
  // body offset: walking bob on passing frames, seated figures sit lower
  const by = sit ? 2 : (walking && (frame === 1 || frame === 3)) || frame === 26 ? -1 : 0;
  const hs = a.hairStyle;
  const acc = a.accessory;
  const capColor = mix(c.shirt, '#e5484d', 0.55);
  const phoneColor = mix(c.shirt, '#ff5d8f', 0.6);

  // ── legs (hidden when seated)
  if (!sit) {
    const leftUp = walking && frame === 3;
    const rightUp = walking && frame === 1;
    r(5, 16, 6, 1, c.pants);
    r(5, 17, 2, leftUp ? 2 : 3, c.pants);
    r(9, 17, 2, rightUp ? 2 : 3, c.pants);
    p(10, 17, c.pantsShade);
    p(6, 17, c.pantsShade);
    r(5, leftUp ? 19 : 20, 2, 1, c.shoe);
    r(9, rightUp ? 19 : 20, 2, 1, c.shoe);
  }

  // ── ponytail behind the head (front view)
  if (hs === 5 && view === 'front') r(12, 4 + by, 2, 6, c.hairShade);

  // ── torso
  r(5, 11 + by, 6, 5, c.shirt);
  r(10, 11 + by, 1, 5, c.shirtShade);
  r(5, 15 + by, 6, 1, c.shirtShade);
  if (view === 'front') {
    if (acc === 'tie') {
      p(6, 11 + by, '#f7f4ee');
      p(9, 11 + by, '#f7f4ee');
      r(7, 11 + by, 2, 1, '#b83232');
      r(7, 12 + by, 2, 3, '#d64545');
      p(8, 14 + by, '#b83232');
    } else {
      r(7, 11 + by, 2, 1, c.skinShade);
      p(6, 12 + by, c.shirtLight);
    }
  } else {
    r(6, 11 + by, 4, 1, c.shirtShade);
  }

  // ── arms
  if (sit) {
    const t = frame === 13 ? 1 : 0;
    r(4, 12 + by - t, 1, 2, c.shirtShade);
    r(11, 12 + by - (1 - t), 1, 2, c.shirtShade);
    if (frame === 14) {
      r(4, 12 + by, 1, 2, c.shirtShade);
      r(11, 12 + by, 1, 2, c.shirtShade);
    }
  } else if (pose === 'coffee') {
    r(11, 11 + by, 1, 2, c.shirt);
    p(11, 13 + by, c.skin);
    if (frame === 16) {
      r(4, 10, 1, 2, c.shirt);
      p(5, 11, c.skin);
    } else {
      r(4, 11, 1, 2, c.shirt);
      p(4, 13, c.skin);
    }
  } else if (pose === 'carry') {
    // forearms bent at the chest, no swing: both hands hold what is carried
    r(4, 12 + by, 1, 2, c.shirt);
    p(5, 13 + by, c.skin);
    r(11, 12 + by, 1, 2, c.shirtShade);
    p(10, 13 + by, c.skinShade);
  } else if (pose === 'shake') {
    r(4, 11 + by, 1, 2, c.shirt);
    p(4, 13 + by, c.skin);
    r(11, 11 + by, 1, 2, c.shirtShade);
    r(12, 12, 2, 1, c.shirt);
    p(14, 12, c.skin);
  } else if (pose !== 'cheer') {
    const sw = pose === 'walk' ? (frame === 1 ? 1 : frame === 3 ? -1 : 0) : 0;
    r(4, 11 + by + sw, 1, 2, c.shirt);
    p(4, 13 + by + sw, c.skin);
    r(11, 11 + by - sw, 1, 2, c.shirtShade);
    p(11, 13 + by - sw, c.skinShade);
  }

  // ── head
  const hy = by + (pose === 'slump' ? 1 : 0);
  r(5, 4 + hy, 6, 1, c.skin);
  r(4, 5 + hy, 8, 5, c.skin);
  r(5, 10 + hy, 6, 1, c.skinShade);
  r(11, 5 + hy, 1, 5, c.skinShade);
  if (view === 'front') {
    const blink = frame === 9 || frame === 16 || pose === 'slump';
    if (blink) {
      p(6, 8 + hy, c.eye);
      p(9, 8 + hy, c.eye);
    } else {
      r(6, 7 + hy, 1, 2, c.eye);
      r(9, 7 + hy, 1, 2, c.eye);
    }
    p(5, 9 + hy, c.blush);
    p(10, 9 + hy, c.blush);
  } else {
    // back of the head: neck + ears, hair painted below
    r(6, 10 + hy, 4, 1, c.skinShade);
  }

  // ── hair
  const H = c.hair;
  const HL = c.hairLight;
  const HS = c.hairShade;
  const capOn = acc === 'cap';
  if (hs !== 4 && !capOn) {
    if (view === 'front') {
      if (hs === 3) {
        r(5, 1 + hy, 6, 1, H);
        r(4, 2 + hy, 8, 1, H);
        r(3, 3 + hy, 10, 3, H);
        r(3, 6 + hy, 2, 3, H);
        r(11, 6 + hy, 2, 3, HS);
        for (const [x, y] of [[5, 2], [8, 3], [4, 4], [10, 4], [6, 5], [11, 3], [3, 7]] as const) p(x, y + hy, HL);
        for (const [x, y] of [[7, 1], [12, 5], [9, 5], [4, 8]] as const) p(x, y + hy, HS);
      } else {
        r(6, 2 + hy, 4, 1, H);
        r(5, 3 + hy, 6, 1, H);
        r(4, 4 + hy, 8, 1, H);
        r(4, 5 + hy, 3, 1, H);
        r(10, 5 + hy, 2, 1, H);
        p(4, 6 + hy, H);
        p(11, 6 + hy, HS);
        p(6, 3 + hy, HL);
        p(7, 3 + hy, HL);
        if (hs === 1) {
          r(3, 5 + hy, 2, 8, H);
          r(11, 5 + hy, 2, 8, HS);
          p(3, 12 + hy, HS);
          r(5, 5 + hy, 3, 1, H);
        }
        if (hs === 2) {
          r(7, 0 + hy, 2, 1, H);
          r(6, 1 + hy, 4, 1, H);
          p(7, 0 + hy, HL);
        }
        if (hs === 5) p(12, 4 + hy, c.accent);
      }
    } else {
      if (hs === 3) {
        r(5, 1 + hy, 6, 1, H);
        r(4, 2 + hy, 8, 1, H);
        r(3, 3 + hy, 10, 8, H);
        for (const [x, y] of [[5, 2], [8, 4], [4, 6], [10, 7], [6, 9], [11, 4]] as const) p(x, y + hy, HL);
        for (const [x, y] of [[7, 5], [9, 8], [5, 10], [12, 9]] as const) p(x, y + hy, HS);
      } else {
        r(6, 2 + hy, 4, 1, H);
        r(5, 3 + hy, 6, 1, H);
        r(4, 4 + hy, 8, 6, H);
        r(4, 9 + hy, 8, 1, HS);
        p(6, 3 + hy, HL);
        p(5, 4 + hy, HL);
        p(4, 7 + hy, c.skin);
        p(11, 7 + hy, c.skinShade);
        if (hs === 1) {
          r(4, 9 + hy, 8, 5, H);
          r(3, 5 + hy, 1, 8, H);
          r(12, 5 + hy, 1, 8, HS);
          r(4, 13 + hy, 8, 1, HS);
        }
        if (hs === 2) {
          r(7, 0 + hy, 2, 1, H);
          r(6, 1 + hy, 4, 1, H);
          p(7, 0 + hy, HL);
        }
        if (hs === 5) {
          r(7, 10 + hy, 2, 5, H);
          p(8, 13 + hy, HS);
          r(7, 10 + hy, 2, 1, c.accent);
        }
      }
    }
  } else if (hs === 4) {
    p(6, 5 + hy, shade(c.skin, 0.35));
    p(7, 5 + hy, shade(c.skin, 0.2));
    if (view === 'back') {
      r(4, 8 + hy, 8, 1, HS);
      p(4, 7 + hy, HS);
      p(11, 7 + hy, HS);
    } else {
      p(4, 6 + hy, HS);
      p(11, 6 + hy, HS);
    }
  }

  // ── accessories
  if (capOn) {
    const cs = shade(capColor, -0.3);
    r(5, 2 + hy, 6, 1, capColor);
    r(4, 3 + hy, 8, 2, capColor);
    p(6, 3 + hy, shade(capColor, 0.35));
    if (view === 'front') {
      r(3, 5 + hy, 10, 1, cs);
      if (hs === 1 || hs === 5 || hs === 3) {
        r(3, 6 + hy, 1, 4, H);
        r(12, 6 + hy, 1, 4, HS);
      }
    } else {
      r(4, 5 + hy, 8, 4, hs === 4 ? c.skinShade : H);
      r(6, 5 + hy, 4, 1, cs);
      p(4, 7 + hy, c.skin);
      p(11, 7 + hy, c.skinShade);
      if (hs === 5 || hs === 1) r(7, 9 + hy, 2, 4, H);
    }
  }
  if (acc === 'glasses') {
    if (view === 'front') {
      r(5, 7 + hy, 6, 1, '#2c2438');
      p(6, 7 + hy, '#bfe6ff');
      p(9, 7 + hy, '#bfe6ff');
    } else {
      p(4, 7 + hy, '#2c2438');
      p(11, 7 + hy, '#2c2438');
    }
  }
  if (acc === 'headphones') {
    const band = '#3a3f4e';
    r(5, 1 + hy, 6, 1, band);
    p(4, 2 + hy, band);
    p(11, 2 + hy, band);
    r(3, 3 + hy, 1, 3, band);
    r(12, 3 + hy, 1, 3, band);
    r(3, 6 + hy, 2, 3, phoneColor);
    r(11, 6 + hy, 2, 3, shade(phoneColor, -0.25));
  }
  if (acc === 'beard') {
    if (view === 'front') {
      p(4, 9 + hy, H);
      p(11, 9 + hy, HS);
      r(5, 10 + hy, 6, 1, H);
      r(6, 11 + hy, 4, 1, HS);
    } else {
      p(4, 9 + hy, H);
      p(11, 9 + hy, HS);
    }
  }

  // ── coffee cup
  if (pose === 'coffee') {
    if (frame === 16) {
      r(5, 9, 2, 3, '#fbfbf8');
      p(6, 11, '#d9d4cc');
    } else {
      r(2, 12, 2, 3, '#fbfbf8');
      r(2, 12, 2, 1, '#6b3f22');
      p(1, 13, '#fbfbf8');
      p(3, 14, '#d9d4cc');
    }
  }

  // ── raised arms, painted last and beside the head: over it they read as hands on the cheeks
  if (pose === 'cheer') {
    r(3, 6 + by, 1, 6, c.shirt);
    r(12, 6 + by, 1, 6, c.shirtShade);
    p(3, 5 + by, c.skin);
    p(12, 5 + by, c.skinShade);
  }
}

const sheetCache = new Map<string, HTMLCanvasElement>();

function avatarKey(a: AvatarSpec): string {
  return `${a.skin}|${a.hair}|${a.shirt}|${a.pants}|${a.hairStyle}|${a.accessory}`;
}

const FRAME_DEFS: [View, Pose, number][] = [
  ['front', 'walk', 0], ['front', 'walk', 1], ['front', 'walk', 2], ['front', 'walk', 3],
  ['back', 'walk', 0], ['back', 'walk', 1], ['back', 'walk', 2], ['back', 'walk', 3],
  ['front', 'idle', 8], ['front', 'idle', 9],
  ['back', 'idle', 10], ['back', 'idle', 11],
  ['back', 'sit', 12], ['back', 'sit', 13], ['back', 'sit', 14],
  ['front', 'coffee', 15], ['front', 'coffee', 16],
  ['front', 'carry', 0], ['front', 'carry', 1], ['front', 'carry', 2], ['front', 'carry', 3],
  ['back', 'carry', 0], ['back', 'carry', 1], ['back', 'carry', 2], ['back', 'carry', 3],
  ['front', 'cheer', 25], ['front', 'cheer', 26],
  ['front', 'slump', 27],
  ['front', 'shake', 28],
];

/** Sheet: row 0 = frames facing right, row 1 = mirrored (facing left). */
export function getSheet(avatar: AvatarSpec | undefined): HTMLCanvasElement {
  const a: AvatarSpec = avatar ?? { skin: '#f1c7a5', hair: '#3b2a20', shirt: '#4f7cff', pants: '#3a3f5c', hairStyle: 0, accessory: 'none' };
  const key = avatarKey(a);
  const hit = sheetCache.get(key);
  if (hit) return hit;
  const colors = colorsFor(a);
  const { c: sheet, g: sg } = makeCanvas(CELL_W * FRAME_COUNT, CELL_H * 2);
  const { c: cell, g: cg } = makeCanvas(CELL_W, CELL_H, true);
  FRAME_DEFS.forEach(([view, pose, frame], i) => {
    cg.clearRect(0, 0, CELL_W, CELL_H);
    paintFigure(cg, a, colors, view, pose, frame);
    addOutline(cell, [42, 31, 61, 235]);
    sg.drawImage(cell, i * CELL_W, 0);
    sg.save();
    sg.translate(i * CELL_W + CELL_W, CELL_H);
    sg.scale(-1, 1);
    sg.drawImage(cell, 0, 0);
    sg.restore();
  });
  sheetCache.set(key, sheet);
  return sheet;
}

/** Draws one frame with its feet anchor at world (x, y). */
export function drawFrame(ctx: CanvasRenderingContext2D, sheet: HTMLCanvasElement, frame: number, mirrored: boolean, x: number, y: number): void {
  ctx.drawImage(sheet, frame * CELL_W, mirrored ? CELL_H : 0, CELL_W, CELL_H, Math.round(x) - ANCHOR_X, Math.round(y) - ANCHOR_Y, CELL_W, CELL_H);
}

// ───────────── carried items ─────────────

export type CarryKind = 'box' | 'bag';
const carryCache = new Map<string, Baked>();

/** What a leaver (box) or a new hire (bag) carries, at the chest: 12 px above the feet, any higher and the box hides the face. */
export function carrySprite(kind: CarryKind, front: boolean, color = '#7c6cf0'): Baked {
  const key = `${kind}:${front}:${kind === 'bag' ? color : ''}`;
  const hit = carryCache.get(key);
  if (hit) return hit;
  // one transparent pixel around the item, for the outline
  const { c, g } = makeCanvas((kind === 'box' ? 10 : 7) + 2, 8 + 2, true);
  const r = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x + 1, y + 1, w, h);
  };
  if (kind === 'box') {
    r(0, 2, 10, 6, '#cf9a5b');
    r(0, 6, 10, 2, '#a8743f');
    r(7, 2, 3, 6, '#a8743f');
    r(0, 2, 10, 1, '#e9c27f');
    r(4, 2, 2, 1, front ? '#a8743f' : '#e9c27f');
    r(1, 0, 1, 2, '#4ade80'); // the plant
    r(2, 1, 1, 1, '#4ade80');
    r(7, 0, 2, 2, '#ffffff'); // the picture frame
  } else {
    r(0, 2, 7, 6, color);
    r(0, 6, 7, 2, shade(color, -0.25));
    r(1, 2, 5, 1, shade(color, 0.25));
    r(2, 0, 3, 1, '#2e2433'); // strap
    r(1, 1, 1, 1, '#2e2433');
    r(5, 1, 1, 1, '#2e2433');
    r(3, 4, 1, 1, '#ffd166');
  }
  addOutline(c, [42, 31, 61, 235]);
  const baked: Baked = { c, ox: kind === 'box' ? 6 : 5, oy: 13 }; // one more for the transparent pixel
  carryCache.set(key, baked);
  return baked;
}

/** Depth of the item against the body: a box is held in front, a bag hangs on the back. */
export function carryBehind(kind: CarryKind, frontView: boolean): boolean {
  return kind === 'box' ? !frontView : frontView;
}

/** One frame with its carried item, in the right order. */
export function drawCarrying(ctx: CanvasRenderingContext2D, sheet: HTMLCanvasElement, frame: number, mirrored: boolean, x: number, y: number, kind: CarryKind, frontView: boolean, color?: string): void {
  const item = carrySprite(kind, frontView, color);
  const paint = () => ctx.drawImage(item.c, Math.round(x) - item.ox, Math.round(y) - item.oy);
  if (carryBehind(kind, frontView)) paint();
  drawFrame(ctx, sheet, frame, mirrored, x, y);
  if (!carryBehind(kind, frontView)) paint();
}

// ───────────── status icons ─────────────

export type IconKind = 'blocked' | 'thinking' | 'coffee' | 'review' | 'crown' | 'medal' | 'star' | 'card' | 'vs';
const iconCache = new Map<string, HTMLCanvasElement>();

/** 13x13 pixel icon; `frame` animates dots / steam (0..3). */
export function statusIcon(kind: IconKind, frame: number): HTMLCanvasElement {
  const f = kind === 'thinking' || kind === 'coffee' ? frame % 4 : 0;
  const key = `${kind}:${f}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const { c, g } = makeCanvas(13, 13, true);
  const r = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  if (kind === 'blocked') {
    r(2, 1, 9, 9, '#ef4444');
    r(1, 2, 11, 7, '#ef4444');
    r(2, 1, 9, 1, '#f87171');
    r(6, 3, 1, 4, '#ffffff');
    r(6, 8, 1, 1, '#ffffff');
    r(5, 10, 3, 1, '#ef4444');
    r(6, 11, 1, 1, '#ef4444');
  } else if (kind === 'thinking') {
    r(2, 2, 9, 7, '#ffffff');
    r(1, 3, 11, 5, '#ffffff');
    r(3, 9, 2, 1, '#ffffff');
    r(2, 10, 1, 1, '#ffffff');
    const dots = f === 0 ? 1 : f === 1 ? 2 : 3;
    for (let i = 0; i < dots; i++) r(3 + i * 3, 5, 1, 1, '#6b6480');
  } else if (kind === 'coffee') {
    // bubble with a red mug and rising steam
    r(2, 1, 9, 9, '#fff7ec');
    r(1, 2, 11, 7, '#fff7ec');
    r(3, 10, 2, 1, '#fff7ec');
    r(2, 11, 1, 1, '#fff7ec');
    r(3, 5, 5, 4, '#e5484d');
    r(3, 5, 5, 1, '#7a4a2b');
    r(8, 6, 1, 2, '#e5484d');
    r(9, 6, 1, 2, '#b83232');
    r(4, 6, 1, 2, '#ff8a8e');
    r(3, 9, 5, 1, '#b83232');
    const off = f % 2;
    r(4 + off, 2, 1, 2, '#c9b8a6');
    r(6 - off, 2, 1, 2, '#c9b8a6');
  } else if (kind === 'crown') {
    r(2, 5, 9, 5, '#f4c542');
    r(2, 3, 1, 2, '#f4c542');
    r(6, 2, 1, 3, '#f4c542');
    r(10, 3, 1, 2, '#f4c542');
    r(4, 4, 1, 1, '#f4c542');
    r(8, 4, 1, 1, '#f4c542');
    r(2, 9, 9, 1, '#c9932a');
    r(4, 7, 1, 1, '#ef4444');
    r(6, 7, 1, 1, '#3b82f6');
    r(8, 7, 1, 1, '#ef4444');
  } else if (kind === 'medal') {
    r(4, 1, 2, 4, '#3b82f6');
    r(7, 1, 2, 4, '#ef4444');
    r(5, 5, 3, 7, '#f4c542');
    r(4, 6, 5, 5, '#f4c542');
    r(5, 7, 1, 2, '#fff1a8');
    r(7, 9, 1, 1, '#c9932a');
  } else if (kind === 'star') {
    r(6, 1, 1, 3, '#ffd166');
    r(5, 3, 3, 2, '#ffd166');
    r(1, 5, 11, 1, '#ffd166');
    r(2, 6, 9, 1, '#ffd166');
    r(3, 7, 7, 2, '#ffd166');
    r(3, 9, 3, 1, '#ffd166');
    r(7, 9, 3, 1, '#ffd166');
    r(2, 10, 2, 1, '#ffd166');
    r(9, 10, 2, 1, '#ffd166');
    r(6, 2, 1, 2, '#fff3b0');
    r(5, 6, 2, 1, '#fff3b0');
  } else if (kind === 'card') {
    // a red card, 6 × 8, tilted by a 1 px step
    r(3, 3, 3, 8, '#ef4444');
    r(6, 2, 3, 8, '#ef4444');
    r(3, 3, 3, 1, '#f87171');
    r(6, 2, 3, 1, '#f87171');
    r(8, 3, 1, 7, '#c92f2f');
  } else if (kind === 'vs') {
    r(0, 2, 13, 9, '#ef4444');
    r(0, 2, 13, 1, '#f87171');
    drawPixelText(g, 'VS', 1, 3, '#ffffff');
  } else {
    // review: magnifying glass
    r(3, 1, 4, 1, '#2f2a45');
    r(2, 2, 1, 4, '#2f2a45');
    r(7, 2, 1, 4, '#2f2a45');
    r(3, 6, 4, 1, '#2f2a45');
    r(3, 2, 4, 4, '#9ee7ff');
    r(3, 2, 2, 1, '#e6fbff');
    r(7, 7, 2, 2, '#c9893f');
    r(9, 9, 2, 2, '#a86a2c');
  }
  addOutline(c, [42, 31, 61, 220]);
  iconCache.set(key, c);
  return c;
}
