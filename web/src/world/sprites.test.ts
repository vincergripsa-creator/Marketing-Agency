// The stage's art under Node, on the headless canvas: character frames, carried items, icons, props, the stage layer,
// the pier and the mock's « Scènes ». Run: cd server && npx vitest run --root ../web/src world/sprites
import './testCanvas';
import { describe, expect, it } from 'vitest';
import type { AvatarSpec, BoardRow, ChannelChip, CompanySnapshot, SceneView } from '../../../shared/types';
import { Effects, MAX_PARTICLES } from './effects';
import { isoX, isoY } from './iso';
import { buildLayout } from './layout';
import { SCENE_ACTIONS, mockSnapshot } from './mockSnapshot';
import type { Rect, WorldLayout } from './model';
import { PAL } from './palette';
import { buildPier, DOCK, PIER_SIZE } from './pier';
import { STAGE_ZONES } from './plaza';
import {
  channelTotemProp, dockProp, duelTableProp, lampProp, leagueBoardProp, podiumProp, trophyWallProp, vacancyTagProp,
} from './props';
import { CELL_H, CELL_W, FRAME, carryBehind, carrySprite, drawCarrying, getSheet, statusIcon, type IconKind } from './sprites';
import { StageLayer } from './stage';
import { opaquePixels } from './testCanvas';

const AVATAR: AvatarSpec = { skin: '#f1c7a5', hair: '#3b2a20', shirt: '#4f7cff', pants: '#3a3f5c', hairStyle: 3, accessory: 'none' };
const OUTLINE = [42, 31, 61];

type Cell = { x: number; y: number; r: number; g: number; b: number; a: number };

function pixelsOf(c: HTMLCanvasElement, x0 = 0, y0 = 0, w = c.width, h = c.height): Cell[] {
  const d = c.getContext('2d')!.getImageData(x0, y0, w, h).data;
  const out: Cell[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out.push({ x, y, r: d[i]!, g: d[i + 1]!, b: d[i + 2]!, a: d[i + 3]! });
    }
  }
  return out;
}

const frameCell = (sheet: HTMLCanvasElement, f: number, row = 0) => pixelsOf(sheet, f * CELL_W, row * CELL_H, CELL_W, CELL_H);
const hex = (p: Cell) => `#${[p.r, p.g, p.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const opaque = (cells: Cell[]) => cells.filter((p) => p.a > 40);
const body = (cells: Cell[]) => opaque(cells).filter((p) => !(p.r === OUTLINE[0] && p.g === OUTLINE[1] && p.b === OUTLINE[2]));
const sameCells = (a: Cell[], b: Cell[]) => a.every((p, i) => p.r === b[i]!.r && p.g === b[i]!.g && p.b === b[i]!.b && p.a === b[i]!.a);

const NEW_FRAMES = [
  FRAME.carryFront, FRAME.carryFront + 1, FRAME.carryFront + 2, FRAME.carryFront + 3,
  FRAME.carryBack, FRAME.carryBack + 1, FRAME.carryBack + 2, FRAME.carryBack + 3,
  FRAME.cheer, FRAME.cheer + 1, FRAME.slump, FRAME.shake,
];

describe('character frames', () => {
  const sheet = getSheet(AVATAR);

  it('the sheet holds the 29 frames on two rows', () => {
    expect([sheet.width, sheet.height]).toEqual([464, 48]);
  });

  it('every new frame has at least 40 opaque pixels, and its outline stays inside the 16 × 24 cell', () => {
    for (const f of NEW_FRAMES) {
      const cells = frameCell(sheet, f);
      expect(opaque(cells).length, `frame ${f}`).toBeGreaterThanOrEqual(40);
      // a figure pixel on the cell's border would have lost its outline to the clip
      for (const p of body(cells)) {
        expect(p.x, `frame ${f}`).toBeGreaterThan(0);
        expect(p.x, `frame ${f}`).toBeLessThan(CELL_W - 1);
        expect(p.y, `frame ${f}`).toBeGreaterThan(0);
        expect(p.y, `frame ${f}`).toBeLessThan(CELL_H - 1);
      }
    }
  });

  it('each new frame is its own drawing, except steps 0 and 2, identical as in the walk', () => {
    expect(sameCells(frameCell(sheet, FRAME.walkFront), frameCell(sheet, FRAME.walkFront + 2))).toBe(true);
    expect(sameCells(frameCell(sheet, FRAME.carryFront), frameCell(sheet, FRAME.carryFront + 2))).toBe(true);
    const distinct = NEW_FRAMES.filter((f) => f !== FRAME.carryFront + 2 && f !== FRAME.carryBack + 2);
    expect(new Set(distinct.map((f) => JSON.stringify(frameCell(sheet, f)))).size).toBe(distinct.length);
    for (const f of NEW_FRAMES) expect(sameCells(frameCell(sheet, f), frameCell(sheet, FRAME.idleFront))).toBe(false);
  });

  it('carry frames keep the feet of the walk', () => {
    const feet = (f: number) => frameCell(sheet, f).filter((p) => p.y >= 17);
    for (let i = 0; i < 4; i++) {
      expect(sameCells(feet(FRAME.carryFront + i), feet(FRAME.walkFront + i)), `front ${i}`).toBe(true);
      expect(sameCells(feet(FRAME.carryBack + i), feet(FRAME.walkBack + i)), `back ${i}`).toBe(true);
    }
  });

  it('carrying bends the arms: no swing between two steps', () => {
    const arms = (f: number) => frameCell(sheet, f).filter((p) => p.x === 4 || p.x === 11).filter((p) => p.y >= 12 && p.y <= 16);
    expect(sameCells(arms(FRAME.carryFront), arms(FRAME.walkFront))).toBe(false);
    const hands = (f: number) => frameCell(sheet, f).filter((p) => p.x === 5 && p.y === 13 + 1);
    expect(hex(hands(FRAME.carryFront)[0]!)).toBe(AVATAR.skin);
  });

  it('the raised frame of the cheer sits 1 px higher than the first', () => {
    const top = (f: number) => Math.min(...body(frameCell(sheet, f)).map((p) => p.y));
    expect(top(FRAME.cheer + 1)).toBe(top(FRAME.cheer) - 1);
  });

  it('cheering arms rise beside the head, not over it', () => {
    const bald = getSheet({ ...AVATAR, hairStyle: 4 });
    const at = (x: number) => frameCell(bald, FRAME.cheer).filter((p) => p.x === x && p.y >= 7 && p.y <= 11);
    for (const x of [3, 12]) expect(at(x).every((p) => p.a > 200 && hex(p) !== '#2a1f3d'), `column ${x}`).toBe(true);
    expect(hex(frameCell(bald, FRAME.cheer).find((p) => p.x === 3 && p.y === 6)!)).toBe(AVATAR.skin);
  });

  it('the handshake reaches past the body', () => {
    const reach = (f: number) => Math.max(...body(frameCell(sheet, f)).map((p) => p.x));
    expect(reach(FRAME.shake)).toBeGreaterThan(reach(FRAME.idleFront));
    expect(hex(frameCell(sheet, FRAME.shake).find((p) => p.x === 14 && p.y === 13)!)).toBe(AVATAR.skin);
  });

  it('the slump drops the head and shuts the eyes', () => {
    const eyes = (f: number) => body(frameCell(sheet, f)).filter((p) => hex(p) === '#251a2e');
    const blink = FRAME.idleFront + 1;
    expect(eyes(FRAME.slump).length).toBe(eyes(blink).length);
    // against the blink, whose eyes are shut too: only a dropped head can move them
    expect(Math.min(...eyes(FRAME.slump).map((p) => p.y))).toBe(Math.min(...eyes(blink).map((p) => p.y)) + 1);
  });

  it('the mirrored row is the first row flipped', () => {
    for (const f of NEW_FRAMES) {
      const a = frameCell(sheet, f, 0);
      const b = frameCell(sheet, f, 1);
      for (const p of a) {
        const q = b[p.y * CELL_W + (CELL_W - 1 - p.x)]!;
        expect([q.r, q.g, q.b, q.a], `frame ${f}`).toEqual([p.r, p.g, p.b, p.a]);
      }
    }
  });
});

describe('carried items', () => {
  const colours = (c: HTMLCanvasElement) => new Set(opaque(pixelsOf(c)).map(hex));

  it('the box has its faces, its flap, the plant and the frame sticking out', () => {
    const cols = colours(carrySprite('box', true).c);
    for (const c of ['#cf9a5b', '#a8743f', '#e9c27f', '#4ade80', '#ffffff']) expect(cols.has(c), c).toBe(true);
  });

  it('the bag takes the department colour and its strap', () => {
    const cols = colours(carrySprite('bag', false, '#ec4899').c);
    expect(cols.has('#ec4899')).toBe(true);
    expect(cols.has('#2e2433')).toBe(true);
    expect(colours(carrySprite('bag', false, '#14b8a6').c).has('#ec4899')).toBe(false);
  });

  it('sizes and anchor: 10 × 8 and 7 × 8, centred on the feet, 12 px above them', () => {
    const box = carrySprite('box', true);
    const xs = body(pixelsOf(box.c)).map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs) + 1).toBe(10);
    expect(Math.min(...xs) - box.ox).toBe(-5);
    const ys = body(pixelsOf(box.c)).map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys) + 1).toBe(8);
    expect(Math.min(...ys) - box.oy).toBe(-12);
    const bag = carrySprite('bag', true);
    const bx = body(pixelsOf(bag.c)).map((p) => p.x);
    expect(Math.max(...bx) - Math.min(...bx) + 1).toBe(7);
    expect(Math.min(...bx) - bag.ox).toBe(-4);
  });

  it('the box leaves the face in view, for every avatar\'s eyes', () => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    drawCarrying(c.getContext('2d')!, getSheet(AVATAR), FRAME.carryFront, false, 16, 28, 'box', true);
    // feet at (16, 28): the cell starts at (8, 6), and the eyes are rows 7 and 8 of the figure, one lower in the cell
    const eyes = pixelsOf(c).filter((p) => p.y >= 14 && p.y <= 15 && (p.x === 14 || p.x === 17));
    expect(eyes.every((p) => hex(p) === '#251a2e')).toBe(true);
  });

  it('a box is held in front, a bag hangs on the back', () => {
    expect(carryBehind('box', true)).toBe(false);
    expect(carryBehind('box', false)).toBe(true);
    expect(carryBehind('bag', false)).toBe(false);
    expect(carryBehind('bag', true)).toBe(true);
  });

  it('drawCarrying really covers the body with the box, and hides the bag behind it', () => {
    const paint = (kind: 'box' | 'bag', front: boolean) => {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      drawCarrying(c.getContext('2d')!, getSheet(AVATAR), front ? FRAME.carryFront : FRAME.carryBack, false, 16, 28, kind, front);
      return new Set(opaque(pixelsOf(c)).map(hex));
    };
    const shirt = AVATAR.shirt;
    expect(paint('box', true).has('#cf9a5b')).toBe(true);
    expect(paint('box', false).has(shirt)).toBe(true);
    expect(paint('bag', false).has('#2e2433')).toBe(true);
  });
});

describe('icons', () => {
  it('each new kind is painted, and differs from the others', () => {
    const kinds: IconKind[] = ['crown', 'medal', 'star', 'card', 'vs'];
    const prints = kinds.map((k) => {
      const c = statusIcon(k, 0);
      expect(opaquePixels(c), k).toBeGreaterThan(20);
      return JSON.stringify(pixelsOf(c));
    });
    expect(new Set(prints).size).toBe(kinds.length);
  });

  it('the card is red and the duel icon white on red', () => {
    const cols = (k: IconKind) => new Set(opaque(pixelsOf(statusIcon(k, 0))).map(hex));
    expect(cols('card').has('#ef4444')).toBe(true);
    expect(cols('vs').has('#ef4444')).toBe(true);
    expect(cols('vs').has('#ffffff')).toBe(true);
  });
});

const ROWS: BoardRow[] = [
  { agentId: 'elise', name: 'Élise', rating: 1584, delta7d: 22 },
  { agentId: 'leo', name: 'Léo', rating: 1561, delta7d: -8 },
];
const CHIP: ChannelChip = { id: 'tiktok', name: 'TikTok', glyph: 'TK', color: '#ff0050', state: 'open', share: 0.5 };

describe('props', () => {
  const colours = (c: HTMLCanvasElement) => new Set(opaque(pixelsOf(c)).map(hex));

  it('static props are painted', () => {
    for (const b of [podiumProp(), duelTableProp(), dockProp(), vacancyTagProp()]) expect(opaquePixels(b.c)).toBeGreaterThan(40);
  });

  it('the podium has its three trims, gold in the middle and highest', () => {
    const cells = opaque(pixelsOf(podiumProp().c));
    const top = (c: string) => Math.min(...cells.filter((p) => hex(p) === c).map((p) => p.y));
    for (const c of ['#f4c542', '#c3cad6', '#c98a52']) expect(cells.some((p) => hex(p) === c), c).toBe(true);
    const mid = (c: string) => {
      const xs = cells.filter((p) => hex(p) === c).map((p) => p.x);
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    };
    expect(mid('#c3cad6')).toBeLessThan(mid('#f4c542'));
    expect(mid('#f4c542')).toBeLessThan(mid('#c98a52'));
    expect(top('#f4c542')).toBeLessThan(top('#c98a52'));
  });

  it('the trophy wall shows one gold cup per champion at most, the last one', () => {
    const none = opaque(pixelsOf(trophyWallProp([]).c)).filter((p) => hex(p) === '#f4c542').length;
    const one = opaque(pixelsOf(trophyWallProp([{ season: 1, name: 'A' }]).c)).filter((p) => hex(p) === '#f4c542').length;
    const three = opaque(pixelsOf(trophyWallProp([{ season: 1, name: 'A' }, { season: 2, name: 'B' }, { season: 3, name: 'C' }]).c)).filter((p) => hex(p) === '#f4c542').length;
    expect(none).toBe(0);
    expect(one).toBeGreaterThan(0);
    expect(three).toBe(one);
    expect(colours(trophyWallProp([{ season: 1, name: 'A' }, { season: 2, name: 'B' }]).c).has('#c98a52')).toBe(true);
  });

  it('the league board is 86 × 82, its arrows follow the week', () => {
    const up = leagueBoardProp([ROWS[0]!], 3);
    expect([up.c.width, up.c.height]).toEqual([86, 82]);
    expect(colours(up.c).has('#22a35a')).toBe(true);
    expect(colours(up.c).has('#ef4444')).toBe(false);
    expect(colours(leagueBoardProp([ROWS[1]!], 3).c).has('#ef4444')).toBe(true);
  });

  it('the board drops accents: the one of ZOÉ would turn the O of the row above into a Q', () => {
    const paint = (name: string) => JSON.stringify(pixelsOf(leagueBoardProp([{ ...ROWS[0]!, name }], 3).c));
    expect(paint('Zoé')).toBe(paint('Zoe'));
    expect(paint('Raphaël le magnifique')).toBe(paint('RAPHAEL'));
  });

  it('the totem is 16 × 36, its lamp tells open from verifying, a ban crosses it out', () => {
    const open = channelTotemProp(CHIP);
    expect([open.c.width, open.c.height]).toEqual([16, 36]);
    expect(colours(open.c).has('#4ade80')).toBe(true);
    expect(colours(channelTotemProp({ ...CHIP, state: 'verifying' }).c).has('#fbbf24')).toBe(true);
    expect(colours(channelTotemProp({ ...CHIP, state: 'banned' }).c).has('#ef4444')).toBe(true);
    expect(colours(open.c).has('#ef4444')).toBe(false);
  });

  it('the totem\'s bar reads the share of the budget', () => {
    const lit = (share: number) => opaque(pixelsOf(channelTotemProp({ ...CHIP, share }).c)).filter((p) => p.y >= 15 && p.y <= 16 && hex(p) === '#ffffff').length;
    expect(lit(0)).toBe(0);
    expect(lit(0.5)).toBe(10);
    expect(lit(1)).toBe(20);
  });
});

describe('effects', () => {
  const bright = (c: HTMLCanvasElement) => opaquePixels(c);
  const canvas = () => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 120;
    return c;
  };

  it('each effect paints, then dies', () => {
    const fx = new Effects(false);
    fx.dust(60, 60);
    fx.confetti(60, 30, 40);
    fx.spark(30, 30, 1);
    fx.floater(60, 90, '+18', '#4ade80');
    const c = canvas();
    fx.draw(c.getContext('2d')!);
    expect(bright(c)).toBeGreaterThan(40);
    for (let i = 0; i < 40; i++) fx.update(0.1);
    expect(fx.particleCount).toBe(0);
    const after = canvas();
    fx.draw(after.getContext('2d')!);
    expect(bright(after)).toBe(0);
  });

  it('a duel\'s rating gain prints its plus sign, not the font\'s unknown glyph', () => {
    const paint = (text: string) => {
      const fx = new Effects(false);
      fx.floater(60, 60, text, '#4ade80');
      const c = canvas();
      fx.draw(c.getContext('2d')!);
      return JSON.stringify(pixelsOf(c));
    };
    expect(paint('+18')).not.toBe(paint('?18'));
  });

  it('dust is 10 particles, and dies in 0,6 s', () => {
    const fx = new Effects(false);
    fx.dust(0, 0);
    expect(fx.particleCount).toBe(10);
    fx.update(0.55);
    expect(fx.particleCount).toBe(10);
    fx.update(0.1);
    expect(fx.particleCount).toBe(0);
  });

  it('never holds more than 240 particles', () => {
    const fx = new Effects(false);
    for (let i = 0; i < 40; i++) fx.confetti(0, 0, 40);
    expect(fx.particleCount).toBe(MAX_PARTICLES);
  });

  it('reduced motion divides particles by 4 and keeps floaters', () => {
    const fx = new Effects(true);
    fx.confetti(0, 0, 40);
    expect(fx.particleCount).toBe(10);
    fx.floater(60, 60, 'CHEF', '#ffffff');
    const c = canvas();
    fx.update(0.01);
    fx.draw(c.getContext('2d')!);
    expect(bright(c)).toBeGreaterThan(10);
  });

  it('the draw leaves the context as it found it', () => {
    const fx = new Effects(false);
    fx.floater(10, 10, 'X', '#ffffff'); // fading by now
    fx.update(1.5);
    const g = canvas().getContext('2d')!;
    fx.draw(g);
    expect(g.globalAlpha).toBe(1);
  });
});

describe('the pier', () => {
  const pier = buildPier({ center: { tx: 0, ty: 20 } });

  it('is an island of its own, with no department and no desk', () => {
    expect([pier.id, pier.kind, pier.deptId, pier.size]).toEqual(['quai', 'pier', null, PIER_SIZE]);
    expect(pier.seats).toEqual([]);
    expect(pier.room).toBeNull();
    expect(Object.keys(pier.edges)).toEqual(['y-']);
  });

  it('the dock spot lies on the planks', () => {
    const d = pier.pier!.dock;
    expect(d.tx - pier.x0).toBeGreaterThan(DOCK.x0);
    expect(d.tx - pier.x0).toBeLessThan(DOCK.x1);
    expect(d.ty - pier.y0).toBeGreaterThan(DOCK.y0);
    expect(d.ty - pier.y0).toBeLessThan(DOCK.y1);
  });

  it('the planks are painted in the ground, so a walker at the back of the dock stays on top of them', () => {
    const planks = new Set([PAL.wood, PAL.woodLight, PAL.woodDeep, PAL.woodDark, '#c48a52']);
    const groundAt = (lx: number, ly: number) => {
      const x = Math.round(isoX(lx + pier.x0, ly + pier.y0) - pier.ground.x);
      const y = Math.round(isoY(lx + pier.x0, ly + pier.y0) - pier.ground.y);
      return hex(pixelsOf(pier.ground.img, x, y, 1, 1)[0]!);
    };
    for (const [lx, ly] of [[4.5, 7.1], [4.5, 8.3], [4.1, 8.8], [4.9, 7.0]] as const) expect(planks.has(groundAt(lx, ly)), `${lx},${ly}`).toBe(true);
    expect(planks.has(groundAt(2, 8))).toBe(false);
  });
});

describe('the plaza stage', () => {
  const snapshot = mockSnapshot();
  const L = buildLayout(snapshot);
  const stage = L.plaza.stage!;
  const local = (p: { tx: number; ty: number }) => ({ tx: p.tx - L.plaza.x0, ty: p.ty - L.plaza.y0 });
  const inside = (p: { tx: number; ty: number }, r: Rect, pad = 0) => p.tx > r.x0 - pad && p.tx < r.x1 + pad && p.ty > r.y0 - pad && p.ty < r.y1 + pad;

  it('holds what ui §4.2 places', () => {
    expect(local(stage.board)).toEqual({ tx: 2, ty: 12 });
    expect(local(stage.duel.centre)).toEqual({ tx: 4.2, ty: 11 });
    expect(stage.duel.spots.map(local)).toEqual([{ tx: 3.5, ty: 11 }, { tx: 4.9, ty: 11 }]);
    expect(local(stage.podium.champion)).toEqual({ tx: 12.4, ty: 13.3 });
    expect(stage.podium.tops.map((t) => [t.place, t.z])).toEqual([[1, 14], [2, 10], [3, 6]]);
    expect(stage.channelSlots).toHaveLength(8);
  });

  it('duellists face each other', () => {
    expect(new Set(stage.duel.facing).size).toBe(2);
  });

  it('wander spots keep out of the stage and 1,1 tile away from the duel', () => {
    for (const p of L.plaza.wanderSpots.map(local)) {
      for (const z of STAGE_ZONES) expect(inside(p, z), `${p.tx},${p.ty}`).toBe(false);
      expect(Math.hypot(p.tx - 4.2, p.ty - 11)).toBeGreaterThanOrEqual(1.1);
    }
  });

  it('moves the decor that stood in the way: the bench, the tree by the podium, the lamp behind the board', () => {
    const at = (tx: number, ty: number) => L.plaza.sprites.filter((s) => s.depth === tx + L.plaza.x0 + ty + L.plaza.y0);
    const lamp = lampProp();
    const lampAt = (tx: number, ty: number) => at(tx, ty).filter((s) => s.img.width === lamp.c.width && s.img.height === lamp.c.height);
    const nearDepth = (tx: number, ty: number) => L.plaza.sprites.filter((s) => Math.abs(s.depth - (tx + ty + L.plaza.x0 + L.plaza.y0)) < 1e-6);
    expect(at(14.3, 14.3)).toHaveLength(1);
    expect(at(14.3, 14.3)[0]!.img.height).toBeLessThan(40); // a bush, not a tree
    expect(lampAt(1.1, 9.1)).toHaveLength(0);
    expect(lampAt(1.6, 8.1)).toHaveLength(1);
    expect(nearDepth(12.6, 10.75)).toHaveLength(0); // the bench's footprint, where the wall stands now
  });
});

describe('StageLayer', () => {
  const layout = (): { L: WorldLayout; scene: SceneView } => {
    const s = mockSnapshot();
    return { L: buildLayout(s), scene: s.scene! };
  };

  it('stages the wall, the board and one totem per channel, depth-sorted on the plaza', () => {
    const { L, scene } = layout();
    const stage = new StageLayer();
    stage.sync(scene, L);
    expect(stage.items()).toHaveLength(2 + scene.channels.length);
    for (const p of stage.items()) expect(Number.isFinite(p.depth)).toBe(true);
    const ids = L.hotspots.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['quai', 'ligue', 'podium', 'duel', 'canal:tiktok', 'canal:meta', 'canal:youtube', 'canal:pinterest']));
  });

  it('without a scene: no prop, and only the pier stays clickable', () => {
    const { L } = layout();
    const stage = new StageLayer();
    stage.sync(undefined, L);
    expect(stage.items()).toEqual([]);
    expect(L.hotspots.map((h) => h.id)).toEqual(['quai']);
  });

  it('no league yet: no board, the wall stays', () => {
    const { L, scene } = layout();
    const stage = new StageLayer();
    stage.sync({ ...scene, board: [], podium: null, channels: [] }, L);
    expect(stage.items()).toHaveLength(1);
    expect(L.hotspots.map((h) => h.id)).not.toContain('ligue');
  });

  it('rebakes by fingerprint only: same data, same canvas', () => {
    const { L, scene } = layout();
    const stage = new StageLayer();
    stage.sync(scene, L);
    const before = stage.items().map((p) => p.img);
    stage.sync(JSON.parse(JSON.stringify(scene)) as SceneView, L);
    expect(stage.items().map((p) => p.img)).toEqual(before);
  });

  it('a rating that moves rebakes the board and nothing else', () => {
    const { L, scene } = layout();
    const stage = new StageLayer();
    stage.sync(scene, L);
    const before = stage.items().map((p) => p.img);
    stage.sync({ ...scene, board: scene.board.map((r, i) => (i ? r : { ...r, rating: r.rating + 1 })) }, L);
    const after = stage.items().map((p) => p.img);
    expect(after.filter((img, i) => img !== before[i])).toHaveLength(1);
  });

  it('a channel keeps its slot whatever opens or closes around it', () => {
    const { L, scene } = layout();
    const stage = new StageLayer();
    const of = (s: SceneView, id: string) => {
      stage.sync(s, L);
      return L.hotspots.find((h) => h.id === id)!.poly;
    };
    const full = of(scene, 'canal:pinterest');
    expect(of({ ...scene, channels: scene.channels.filter((c) => c.id === 'pinterest') }, 'canal:pinterest')).toEqual(full);
  });

  it('the board reads the season under way, the podium the last one closed', () => {
    const { L, scene } = layout();
    const stage = new StageLayer();
    stage.sync(scene, L);
    const sub = (id: string) => stage.tags().find((t) => t.id === id)!.sub;
    expect(sub('ligue')).toBe('Saison 3');
    expect(sub('podium')).toBe('Saison 2 : Élise');
    expect(sub('quai')).toBe('2 postes ouverts');
  });

  it('only the league\'s places keep their tag on from zoom 1,25, the others wait for a hover', () => {
    const { L, scene } = layout();
    const stage = new StageLayer();
    stage.sync(scene, L);
    expect(stage.tags().filter((t) => t.league).map((t) => t.id).sort()).toEqual(['ligue', 'podium']);
  });
});

describe('the « Scènes » of the preview', () => {
  const run = (s: CompanySnapshot, id: string) => SCENE_ACTIONS.find((a) => a.id === id)!.apply(s);

  it('has the seven buttons of ui §5.7', () => {
    expect(SCENE_ACTIONS.map((a) => a.label)).toEqual(['Embaucher', 'Renvoyer', 'Duel', 'Fin de saison', 'Ouvrir un canal', 'Agrandir l’île', 'Palier suivant']);
  });

  it('each one appends one line to scene.recent, of the kind the drama reads', () => {
    const expected: Record<string, string> = { hire: 'hire', fire: 'fire', duel: 'duel_open', season: 'season_end', channel: 'channel_open', island: 'dept_open', stage: 'stage_up' };
    for (const a of SCENE_ACTIONS) {
      const before = mockSnapshot();
      const after = a.apply(before);
      expect(after.scene!.recent, a.id).toHaveLength(before.scene!.recent.length + 1);
      expect(after.scene!.recent.at(-1)!.kind, a.id).toBe(expected[a.id]);
    }
  });

  it('every key stays unique across a long session', () => {
    let s = mockSnapshot();
    const seen = new Set(s.scene!.recent.map((e) => e.key));
    for (let i = 0; i < 40; i++) {
      const next = SCENE_ACTIONS[i % SCENE_ACTIONS.length]!.apply(s);
      if (next === s) continue; // nothing left to do: last stage, no one left to fire
      s = next;
      const k = s.scene!.recent.at(-1)!.key;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
    expect(s.scene!.recent.length).toBeLessThanOrEqual(24);
  });

  it('a hire adds a person, a firing removes one and keeps the name for old tasks', () => {
    const base = mockSnapshot();
    const hired = run(base, 'hire');
    expect(hired.company.agents).toHaveLength(base.company.agents.length + 1);
    const fired = run(hired, 'fire');
    expect(fired.company.agents).toHaveLength(base.company.agents.length);
    const gone = fired.scene!.recent.at(-1)!;
    expect(gone.person?.name).toBeTruthy();
    expect(fired.scene!.names[gone.agentId!]).toBe(gone.person!.name);
  });

  it('the firing does not take the person who just walked in', () => {
    const hired = run(mockSnapshot(), 'hire');
    const newcomer = hired.company.agents.at(-1)!.id;
    expect(run(hired, 'fire').company.agents.some((a) => a.id === newcomer)).toBe(true);
  });

  it('a founder or a chief is never the one fired', () => {
    let s = mockSnapshot();
    for (let i = 0; i < 40; i++) s = run(s, 'fire');
    expect(s.company.agents.filter((a) => a.isChief).length).toBe(mockSnapshot().company.agents.filter((a) => a.isChief).length);
    expect(s.company.agents.some((a) => !a.isChief && !a.founder)).toBe(false);
  });

  it('the duel button opens one, then closes it', () => {
    const open = run(mockSnapshot(), 'duel');
    expect(open.scene!.duels).toHaveLength(1);
    const closed = run(open, 'duel');
    expect(closed.scene!.duels).toHaveLength(0);
    expect(closed.scene!.recent.at(-1)!.kind).toBe('duel_end');
  });

  it('the end of a season adds a cup and moves the podium', () => {
    const base = mockSnapshot();
    const next = run(base, 'season');
    expect(next.scene!.podium!.season).toBe(base.scene!.podium!.season + 1);
    expect(next.scene!.podium!.cups).toHaveLength(base.scene!.podium!.cups.length + 1);
  });

  it('a channel opens in two steps, verification then open, and stops at the catalog', () => {
    let s = mockSnapshot();
    const state = (id: string) => s.scene!.channels.find((c) => c.id === id)?.state;
    expect(state('google')).toBeUndefined();
    s = run(s, 'channel');
    expect(state('google')).toBe('verifying');
    for (let i = 0; i < 10; i++) s = run(s, 'channel');
    expect(state('google')).toBe('open');
    expect(state('youtube')).toBe('open');
    expect(s.scene!.channels).toHaveLength(5);
  });

  it('the bigger island crosses a tier: the layout key changes', () => {
    const base = mockSnapshot();
    const grown = run(base, 'island');
    expect(buildLayout(grown).key).not.toBe(buildLayout(base).key);
  });

  it('the stage stops at the last level', () => {
    let s = mockSnapshot();
    for (let i = 0; i < 6; i++) s = run(s, 'stage');
    expect(s.scene!.stage.level).toBe(3);
    expect(s.scene!.stage.id).toBe('portefeuille');
  });

  it('the mock carries a whole scene: plots, board, channels, and no talent truth', () => {
    const s = mockSnapshot();
    expect(s.scene!.closedDepts.map((d) => d.id)).toEqual(['video', 'crm']);
    expect(s.scene!.board).toHaveLength(5);
    expect(JSON.stringify(s.scene)).not.toMatch(/truth/i);
  });
});
