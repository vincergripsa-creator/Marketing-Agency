/**
 * Where text may sit, per ratio (video §2, §4.2). One timeline is re-laid out on each stage, never cropped.
 * Pure: QA and the storyboard read the same numbers as the compositor.
 */
import { SAFE_ZONES, type AdRatio } from '../shared.js';

export type VideoRatio = Exclude<AdRatio, 'text'>;
export interface Rect { x: number; y: number; w: number; h: number }
export interface Zone { x0: number; x1: number; y0: number; y1: number }

export interface Stage {
  ratio: VideoRatio; w: number; h: number;
  zones: Zone[];               // the 9:16 master has two: the right rail starts around y 840
  heroBox: Rect;               // the hook's text
  bookSlot: Rect;              // the guide during the hook. A picture: it may bleed out of the zones
  captionY: number;            // caption baseline
}

const insetZone = (key: keyof typeof SAFE_ZONES): Zone => {
  const { w, h, insets } = SAFE_ZONES[key];
  return { x0: insets.left, x1: w - insets.right, y0: insets.top, y1: h - insets.bottom };
};

/** Obeys TikTok, Reels and Shorts at once: the tightest inset of the three on each side. */
const VERTICAL: Zone[] = [
  { x0: 65, x1: 1015, y0: 288, y1: 840 },
  { x0: 65, x1: 880, y0: 840, y1: 1248 },
];

const STAGES: Record<VideoRatio, Stage> = {
  '9:16': {
    ratio: '9:16', w: 1080, h: 1920, zones: VERTICAL,
    heroBox: { x: 65, y: 288, w: 950, h: 552 },
    bookSlot: { x: 621, y: 1307, w: 400, h: 566 },
    captionY: 1050,
  },
  '4:5': {
    ratio: '4:5', w: 1080, h: 1350, zones: [insetZone('meta_feed')],
    heroBox: { x: 54, y: 120, w: 972, h: 640 },
    bookSlot: { x: 650, y: 790, w: 340, h: 481 },
    captionY: 1110,
  },
  // The book of the hook would cover the text here: it moves to the right third (sheet5.png).
  '1:1': {
    ratio: '1:1', w: 1080, h: 1080, zones: [insetZone('square')],
    heroBox: { x: 54, y: 120, w: 650, h: 700 },
    bookSlot: { x: 720, y: 290, w: 300, h: 424 },
    captionY: 910,
  },
  '2:3': {
    ratio: '2:3', w: 1080, h: 1620, zones: [insetZone('pinterest')],
    heroBox: { x: 54, y: 140, w: 972, h: 720 },
    bookSlot: { x: 650, y: 930, w: 340, h: 481 },
    captionY: 1230,
  },
};

const even = (v: number): number => Math.round(v / 2) * 2; // yuv420p needs even sides

/** `width` draws the same stage smaller, every number scaled: the tests render at 270×480. */
export function stageFor(ratio: VideoRatio, width?: number): Stage {
  const base = STAGES[ratio];
  if (!width || width === base.w) return base;
  const k = width / base.w;
  const rect = (r: Rect): Rect => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
  return {
    ...base,
    w: even(base.w * k),
    h: even(base.h * k),
    zones: base.zones.map((z) => ({ x0: z.x0 * k, x1: z.x1 * k, y0: z.y0 * k, y1: z.y1 * k })),
    heroBox: rect(base.heroBox),
    bookSlot: rect(base.bookSlot),
    captionY: base.captionY * k,
  };
}

/** A device-space box is safe when every line of it sits in a zone. A box across two zones must fit both. */
export function insideSafe(stage: Pick<Stage, 'zones'>, box: Rect): boolean {
  const EPS = 0.5;
  const bottom = box.y + box.h;
  let at = box.y;
  for (const z of [...stage.zones].sort((a, b) => a.y0 - b.y0)) {
    if (z.y1 <= at || z.y0 > at + EPS) continue;
    if (box.x < z.x0 - EPS || box.x + box.w > z.x1 + EPS) return false;
    at = z.y1;
    if (at >= bottom - EPS) return true;
  }
  return false;
}

/** The zone holding this height, or the nearest one. */
export function zoneAt(stage: Pick<Stage, 'zones'>, y: number): Zone {
  return stage.zones.find((z) => y >= z.y0 && y < z.y1) ?? stage.zones.reduce((a, b) => (Math.abs(b.y0 - y) < Math.abs(a.y0 - y) ? b : a));
}

/** The column safe at every height: what a block of unknown height may fill. */
export function safeColumn(stage: Pick<Stage, 'zones'>): Rect {
  const x = Math.max(...stage.zones.map((z) => z.x0));
  const x1 = Math.min(...stage.zones.map((z) => z.x1));
  const y = Math.min(...stage.zones.map((z) => z.y0));
  const y1 = Math.max(...stage.zones.map((z) => z.y1));
  return { x, y, w: x1 - x, h: y1 - y };
}
