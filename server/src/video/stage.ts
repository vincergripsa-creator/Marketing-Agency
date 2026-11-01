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
  heroBox: Rect;               // the hook's text, with the guide under it
  bookSlot: Rect;              // the guide during the hook. A picture: it may bleed out of the zones
  captionY: number;            // baseline of the caption's last line: low in the safe zone, over nothing that reads
  band: number | null;         // pictures only from here down: the platform writes over it, so the guide's art fills it
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
    heroBox: { x: 65, y: 300, w: 815, h: 800 }, // past the rail: a line that stays above it runs on to zone A's edge
    bookSlot: { x: 300, y: 1170, w: 640, h: 905 }, // it may leave the frame: under its tilt and the shot's jump it stays off the type
    captionY: 1214,
    band: 1290,
  },
  '4:5': {
    ratio: '4:5', w: 1080, h: 1350, zones: [insetZone('meta_feed')],
    heroBox: { x: 54, y: 96, w: 972, h: 700 },
    bookSlot: { x: 530, y: 850, w: 470, h: 665 },
    captionY: 1262,
    band: null,
  },
  // The book of the hook would cover the text here: it moves to the right third (sheet5.png).
  '1:1': {
    ratio: '1:1', w: 1080, h: 1080, zones: [insetZone('square')],
    heroBox: { x: 54, y: 70, w: 610, h: 910 },
    bookSlot: { x: 690, y: 250, w: 360, h: 509 },
    captionY: 992,
    band: null,
  },
  '2:3': {
    ratio: '2:3', w: 1080, h: 1620, zones: [insetZone('pinterest')],
    heroBox: { x: 54, y: 100, w: 972, h: 610 },
    bookSlot: { x: 460, y: 730, w: 500, h: 707 },
    captionY: 1346,
    band: 1400,
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
    band: base.band === null ? null : base.band * k,
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
