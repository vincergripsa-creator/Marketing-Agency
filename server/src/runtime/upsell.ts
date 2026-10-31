/**
 * A follow-up guide is another product: another sub-problem, another title, another promise. This module picks
 * that sub-problem, refuses doubles inside a niche, and keeps the parent's last page true for the catalogue.
 */
import type { UpsellContext } from '../contracts.js';
import { bare, firstPerson, nextStepFor, norm, upsellTopics, withArticle } from '../minds/index.js';
import type { Product, Task, VoiceOfCustomer, WorldState } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { parentOf } from './metrics.js';
import { officerId } from './org/officers.js';
import { createTask } from './tasks.js';
import { capitalize, short } from './util.js';

/** Case, accents, quotes and punctuation out: two texts with the same key say the same thing. */
const keyOf = (text: string): string => norm(bare(text)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** What a promise leads to: « Un plan de 14 jours pour arriver à ceci : un chiot propre » → « un chiot propre ». */
const promiseKey = (promise: string): string => keyOf(promise.slice(promise.lastIndexOf(':') + 1));

/** A text repeats another when one is the other, or holds all of it (a promise holds the outcome it was built from). */
const MIN_REPEAT_CHARS = 12;
function repeats(text: string, other: string): boolean {
  const a = keyOf(text);
  const b = keyOf(other);
  if (!a || !b) return false;
  if (a === b) return true;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  return small.length >= MIN_REPEAT_CHARS && big.includes(small);
}

/** Guides, so never a kit: it repeats its guide on purpose, and it says nothing a follow-up should avoid. */
const nicheProducts = (world: WorldState, nicheId: string): Product[] => world.company.products.filter((p) => p.nicheId === nicheId && p.kind !== 'kit');

/** Products on sale or on their way in the niche of `product`. */
const rivals = (world: WorldState, product: Product): Product[] => nicheProducts(world, product.nicheId).filter((p) => p.id !== product.id && p.status !== 'killed');

export function titleTaken(world: WorldState, product: Product, title: string): Product | undefined {
  return rivals(world, product).find((p) => keyOf(p.title) === keyOf(title));
}

export function promiseTaken(world: WorldState, product: Product, promise: string): Product | undefined {
  const key = promiseKey(promise);
  return key ? rivals(world, product).find((p) => p.content && promiseKey(p.content.promise) === key) : undefined;
}

/** Why `product` cannot go on sale next to the other products of its niche (French), or null. */
export function nicheCollision(world: WorldState, product: Product): string | null {
  if (product.kind === 'kit') return null;
  const title = titleTaken(world, product, product.title);
  if (title) return `le titre existe déjà dans cette niche (« ${short(title.title, 60)} »)`;
  const promise = product.content ? promiseTaken(world, product, product.content.promise) : undefined;
  return promise ? `la promesse est déjà celle de « ${short(promise.title, 60)} »` : null;
}

export interface UpsellSubject { problem: string; title: string }

/**
 * The sub-problem of a follow-up guide: a prepared one, else a customer pain, and never what a product of the
 * niche already says, killed ones included (a subject that did not sell is not sold again). null when nothing is left.
 */
export function pickUpsellSubject(world: WorldState, parent: Product, voc: VoiceOfCustomer): UpsellSubject | null {
  const said = nicheProducts(world, parent.nicheId).flatMap((p) => [p.title, p.problem, p.content?.promise ?? '']);
  const fresh = (text: string): boolean => !said.some((s) => repeats(text, s));
  const topic = upsellTopics(parent.nicheId).find((t) => fresh(t.pain) && fresh(t.goal) && fresh(t.title));
  if (topic) return { problem: topic.pain, title: topic.title };
  const pain = voc.pains.find((p) => !firstPerson(p) && fresh(p));
  return pain ? { problem: bare(pain), title: capitalize(bare(pain)) } : null;
}

/** What the writers must not repeat, when `product` follows another guide. */
export function upsellContextOf(world: WorldState, product: Product): UpsellContext | null {
  const parent = parentOf(world, product.id);
  if (!parent) return null;
  const topic = upsellTopics(product.nicheId).find((t) => keyOf(t.pain) === keyOf(product.problem));
  return {
    parentTitle: parent.title,
    parentPromise: parent.content?.promise ?? '',
    parentChapterTitles: (parent.content?.chapters ?? []).map((c) => c.title),
    topicId: topic?.id ?? null,
  };
}

function reprintParent(ctx: RuntimeCtx, parent: Product, title: string, missionId: Task['missionId']): void {
  createTask(ctx.world, { kind: 'render_pdf', title, input: { productId: parent.id, nicheId: parent.nicheId, reason: 'upsell_link' }, createdBy: officerId(ctx.world, 'pricing'), missionId, priority: 2 });
}

/** The upsell is on sale: the parent's last page says so, in words that name it. */
export function linkUpsell(ctx: RuntimeCtx, parent: Product, upsell: Product, missionId: Task['missionId']): void {
  if (!parent.content) return;
  const next = nextStepFor({ audience: withArticle(parent.audience), upsell: { title: upsell.title, productId: upsell.id } });
  const stored = parent.content.nextStep;
  if (stored?.title === next.title && stored?.text === next.text) return;
  parent.content.nextStep = next;
  reprintParent(ctx, parent, `Ajouter « La suite est ici » au guide « ${short(parent.title, 40)} »`, missionId);
}

/** A kit sells at its guide's checkout and nowhere else: it leaves the shop with it. */
function retireKit(ctx: RuntimeCtx, guide: Product): void {
  const kit = ctx.world.company.products.find((p) => p.id === guide.bumpProductId);
  if (!kit || kit.status === 'killed') return;
  if (kit.launchedDay !== null) ctx.tools.setProductStatus(kit.id, 'killed');
  kit.status = 'killed';
  kit.decision = { day: ctx.world.day, status: 'killed', reason: `son guide « ${short(guide.title, 60)} » est arrêté` };
}

/** The upsell is gone: the parent's last page stops selling it, and its kit goes with it. */
export function unlinkUpsell(ctx: RuntimeCtx, upsell: Product): void {
  retireKit(ctx, upsell);
  const parent = parentOf(ctx.world, upsell.id);
  if (!parent?.content || parent.status === 'killed' || parent.content.nextStep?.upsellProductId !== upsell.id) return;
  parent.content.nextStep = nextStepFor({ audience: withArticle(parent.audience), upsell: null });
  reprintParent(ctx, parent, `Retirer la suite du guide « ${short(parent.title, 40)} »`, null);
}
