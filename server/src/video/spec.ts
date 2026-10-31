/**
 * What one render needs, copied out of the world. The worker reads this file and never sees the world,
 * so a render cannot touch the simulation and no hidden truth can reach it (video D2, §9).
 */
import { createHash } from 'node:crypto';
import { normalizeDesign } from '../deliverables/design.js';
import type { AdCreative, AdFormat, DesignSpec, HookStyle, VideoCut, WorldState } from '../shared.js';
import type { VideoRatio } from './stage.js';

/** Bump it when the same spec should draw another file: every cached video renders again. */
export const RENDER_VERSION = 1;

export interface RenderSpec {
  version: number;
  runId: string;
  creativeId: string;
  ratio: VideoRatio;
  format: AdFormat;
  hook: string;
  hookStyle: HookStyle;
  cta: string;
  cut: VideoCut;
  voice: string | null;        // null = captions and music only
  brand: string;
  title: string;
  design: DesignSpec;
  pdf: string | null;          // run-relative
  cover: string | null;        // run-relative
}

/** These two give PNG cards, not a film (video §3.4). */
export const stillFormat = (format: AdFormat): boolean => format === 'carousel' || format === 'static_image';

/** A pin has no editor and no cut: `adapt_creative` keeps it null, so the world stays as it is. One slide is what the renderer reads. */
function stillCut(c: AdCreative): VideoCut {
  const screen = c.scenes[0]?.onScreenText || c.hook;
  return {
    v: 1, tempo: 'standard', sfx: false, craft: 0,
    beats: [{ kind: 'slide', scene: 0, spoken: '', screen, estSec: 1.8, shots: 1 }],
    metrics: { estSec: 1.8, hookWordSec: 0, productSec: 0, avgShotSec: 0, kinds: 1, captionWords: 0, endHoldSec: 0 },
  };
}

export function buildRenderSpec(world: Readonly<WorldState>, creativeId: string, ratio: VideoRatio, voice: string | null = null): RenderSpec {
  const creative = world.company.creatives.find((c) => c.id === creativeId);
  if (!creative) throw new Error(`no creative ${creativeId}`);
  const cut = creative.cut ?? (creative.format === 'static_image' ? stillCut(creative) : null);
  if (!cut) throw new Error(`creative ${creativeId} has no cut`);
  const product = world.company.products.find((p) => p.id === creative.productId);
  if (!product) throw new Error(`creative ${creativeId}: no product ${creative.productId}`);
  return {
    version: RENDER_VERSION,
    runId: world.runId,
    creativeId,
    ratio,
    format: creative.format,
    hook: creative.hook,
    hookStyle: creative.hookStyle,
    cta: creative.cta,
    cut,
    voice,
    brand: world.company.name,
    title: product.title,
    design: normalizeDesign(product.design),
    pdf: product.files.pdf,
    cover: product.files.cover,
  };
}

/** A rework gets a new key. Same key, ready file: no render. */
export function renderKey(spec: RenderSpec): string {
  const key = [JSON.stringify(spec.cut), spec.ratio, spec.version, spec.voice ?? '', JSON.stringify(spec.design)].join('|');
  return createHash('sha1').update(key).digest('hex');
}
