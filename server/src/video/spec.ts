/**
 * What one render needs, copied out of the world. The worker reads this file and never sees the world,
 * so a render cannot touch the simulation and no hidden truth can reach it (video D2, §9).
 */
import { createHash } from 'node:crypto';
import { normalizeDesign } from '../deliverables/design.js';
import { reviewQuote } from '../deliverables/videoCut.js';
import type { AdCreative, AdFormat, DesignSpec, HookStyle, Product, VideoCut, WorldState } from '../shared.js';
import { countWords, norm } from '../sim/text.js';
import type { VideoRatio } from './stage.js';

/** Bump it when the same spec should draw another file: every cached video renders again. */
export const RENDER_VERSION = 5;

/** A buyer's real words as the voice reads them. `name` and `rating` come from the shop's own orders: no order, no name. */
export interface ReviewCard { quote: string; rating: number | null; name: string | null }

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
  price: number | null;        // what the end card asks
  reviews: Record<number, ReviewCard>; // by scene
  design: DesignSpec;
  pdf: string | null;          // run-relative
  cover: string | null;        // run-relative
}

/** These two give PNG cards, not a film (video §3.4). */
export const stillFormat = (format: AdFormat): boolean => format === 'carousel' || format === 'static_image';

/** A pin is read in a glance: past this it says its first clause, the one a whole scene's text opens on. */
const PIN_WORDS = 14;
const pinLine = (screen: string): string => (countWords(screen) <= PIN_WORDS ? screen : /^[^,;:—–.]+/.exec(screen.replace(/^\s*\d+\s*[.)]\s*/, ''))?.[0].trim() ?? screen);

/** A pin has no editor and no cut: `adapt_creative` keeps it null, so the world stays as it is. One slide is what the renderer reads. */
function stillCut(c: AdCreative): VideoCut {
  const screen = pinLine(c.scenes[0]?.onScreenText || c.hook);
  return {
    v: 1, tempo: 'standard', sfx: false, craft: 0,
    beats: [{ kind: 'slide', scene: 0, spoken: '', screen, estSec: 1.8, shots: 1 }],
    metrics: { estSec: 1.8, hookWordSec: 0, productSec: 0, avgShotSec: 0, kinds: 1, captionWords: 0, endHoldSec: 0 },
  };
}

const buyerName = (world: Readonly<WorldState>, id: string): string | null => {
  const first = world.market?.customers?.find((c) => c.id === id)?.name.split(' ')[0];
  return first && /^\p{Lu}/u.test(first) ? first : null; // a pseudo is not a first name
};

/** The reviews the voice reads in this cut, found back on the product: the plan holds decisions, never a customer. */
function reviewsOf(world: Readonly<WorldState>, creative: AdCreative, product: Product, cut: VideoCut): Record<number, ReviewCard> {
  const cards: Record<number, ReviewCard> = {};
  for (const beat of cut.beats) {
    const quote = reviewQuote(creative.scenes?.[beat.scene]?.voiceover ?? '');
    if (!quote || (beat.kind !== 'fact_card' && beat.kind !== 'slide')) continue; // a silent format has no voice, its script still holds the words
    const said = norm(quote);
    const review = product.stats?.reviews?.find((r) => norm(r.text).includes(said) || said.includes(norm(r.text)));
    cards[beat.scene] = { quote, rating: review?.rating ?? null, name: review ? buyerName(world, review.customerId) : null };
  }
  return cards;
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
    price: product.price ?? null,
    reviews: reviewsOf(world, creative, product, cut),
    design: normalizeDesign(product.design),
    pdf: product.files.pdf,
    cover: product.files.cover,
  };
}

/**
 * A rework gets a new key. Same key, ready file: no render, and a new key deletes the file. So the key holds what makes
 * another ad, not what moves under a made film: a price test changes the price every day, and compaction lets the old
 * customers and reviews go. A card counts by its quote. A film keeps the price it was made with (D131).
 */
export function renderKey(spec: RenderSpec): string {
  const quotes = Object.values(spec.reviews ?? {}).map((r) => r.quote);
  const key = [JSON.stringify(spec.cut), spec.ratio, spec.version, spec.voice ?? '', JSON.stringify(spec.design), JSON.stringify(quotes)].join('|');
  return createHash('sha1').update(key).digest('hex');
}
