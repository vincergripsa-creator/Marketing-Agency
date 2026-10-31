/**
 * What one render needs, copied out of the world. The worker reads this file and never sees the world,
 * so a render cannot touch the simulation and no hidden truth can reach it (video D2, §9).
 */
import { createHash } from 'node:crypto';
import { normalizeDesign } from '../deliverables/design.js';
import type { AdFormat, DesignSpec, HookStyle, VideoCut, WorldState } from '../shared.js';
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

export function buildRenderSpec(world: Readonly<WorldState>, creativeId: string, ratio: VideoRatio, voice: string | null = null): RenderSpec {
  const creative = world.company.creatives.find((c) => c.id === creativeId);
  if (!creative) throw new Error(`no creative ${creativeId}`);
  if (!creative.cut) throw new Error(`creative ${creativeId} has no cut`);
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
    cut: creative.cut,
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
