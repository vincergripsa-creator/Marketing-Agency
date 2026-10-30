/** Money/state moves shared by the tools (agent actions) and the daily tick (market). */
import { emit, nextId } from '../core/index.js';
import type { Rng } from '../contracts.js';
import type { AdCreative, Campaign, Customer, NicheTruth, Order, Product, WorldEvent, WorldEventKind, WorldState } from '../shared.js';
import { EVENTS, FEES } from './balance.js';
import { customerById } from './customers.js';
import { addReview, type ReviewKind } from './feedback.js';
import { recordLedger } from './finance.js';
import { findNiche } from './market.js';
import { fmtEur, short } from './text.js';

export function productById(world: WorldState, id: string | null | undefined): Product | undefined {
  return id ? world.company.products.find((p) => p.id === id) : undefined;
}

export function creativeById(world: WorldState, id: string): AdCreative | undefined {
  return world.company.creatives.find((c) => c.id === id);
}

export function campaignById(world: WorldState, id: string): Campaign | undefined {
  return world.company.campaigns.find((c) => c.id === id);
}

export function orderById(world: WorldState, id: string | null | undefined): Order | undefined {
  if (!id) return undefined;
  const orders = world.market.orders;
  for (let i = orders.length - 1; i >= 0; i--) if (orders[i]!.id === id) return orders[i];
  return undefined;
}

/** Neutral truth used when a product points to an unknown niche (never crash the market). */
export const FALLBACK_NICHE: NicheTruth = {
  id: '_inconnue', name: 'Niche inconnue', audience: 'Grand public', problem: 'Problème non précisé', category: 'Divers', keywords: [],
  demand: 0.35, wtp: { min: 7, sweet: 15, max: 25 }, competition: 0.6, tiktokAffinity: 0.5, cpmBase: 7,
  hookAffinity: {}, formatAffinity: {}, refundSensitivity: 0.5, complianceRisk: 0.3, seasonality: [1, 1, 1, 1, 1, 1, 1],
  voc: { nicheId: '_inconnue', depth: 'deep', pains: [], phrases: [], objections: [], desiredOutcomes: [], knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors: [], bannedClaims: [] },
  competitors: [],
};

export function nicheOf(world: WorldState, product: Product | undefined | null): NicheTruth {
  return (product && findNiche(world, product.nicheId)) || FALLBACK_NICHE;
}

function bumpRefundStats(world: WorldState, order: Order): void {
  const p = productById(world, order.productId);
  if (p) {
    p.stats.refunds += 1;
    p.stats.refundAmount = Math.round((p.stats.refundAmount + order.price) * 100) / 100;
  }
  const c = customerById(world, order.customerId);
  if (c) c.satisfaction = Math.max(-1, c.satisfaction - 0.3);
}

/** Full refund of an order. Returns the amount refunded (0 when already refunded / disputed). */
export function refundOrder(world: WorldState, order: Order, memo: string): number {
  if (order.refunded || order.chargeback) return 0;
  order.refunded = true;
  order.refundedDay = world.day;
  recordLedger(world, { type: 'refund', amount: -order.price, memo, ref: order.id });
  bumpRefundStats(world, order);
  return order.price;
}

/** Bank dispute: the sale is reversed AND a fixed fee is charged. Returns the total cost. */
export function chargebackOrder(world: WorldState, order: Order): number {
  if (order.refunded || order.chargeback) return 0;
  order.chargeback = true;
  order.refunded = true;
  order.refundedDay = world.day;
  const cost = order.price + FEES.chargebackFee;
  recordLedger(world, { type: 'chargeback', amount: -cost, memo: `Litige bancaire (chargeback) : ${fmtEur(order.price)} + ${fmtEur(FEES.chargebackFee)} de frais`, ref: order.id });
  bumpRefundStats(world, order);
  return cost;
}

/** Partial goodwill refund (booked as 'discount'). */
export function partialRefund(world: WorldState, order: Order | undefined, share: number, memo: string): number {
  if (!order || order.refunded || order.chargeback) return 0;
  const amount = Math.round(order.price * share * 100) / 100;
  if (amount <= 0) return 0;
  recordLedger(world, { type: 'discount', amount: -amount, memo, ref: order.id });
  return amount;
}

export function reviewProduct(world: WorldState, rng: Rng, product: Product | undefined, customer: Customer | undefined, rating: number, kind: ReviewKind): boolean {
  if (!product) return false;
  addReview(world, rng, product, customer?.id ?? 'anonyme', rating, nicheOf(world, product), kind);
  return true;
}

/** Ids an event is about (product, niche, creative, creator); undefined / null values are dropped. */
export type EventRefs = { [K in keyof NonNullable<WorldEvent['refs']>]?: string | null };

function cleanRefs(refs: EventRefs | undefined): WorldEvent['refs'] | undefined {
  if (!refs) return undefined;
  const out: NonNullable<WorldEvent['refs']> = {};
  for (const k of ['productId', 'nicheId', 'creativeId', 'creatorId'] as const) {
    const v = refs[k];
    if (typeof v === 'string' && v && v !== FALLBACK_NICHE.id) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Records a world event and mirrors it in the activity feed. */
export function pushEvent(world: WorldState, kind: WorldEventKind, title: string, description: string, severity: WorldEvent['severity'], refs?: EventRefs): WorldEvent {
  const ev: WorldEvent = { id: nextId(world, 'evt'), day: world.day, kind, title, description, severity };
  const r = cleanRefs(refs);
  if (r) ev.refs = r;
  world.market.events.push(ev);
  if (world.market.events.length > EVENTS.keepEvents) world.market.events.splice(0, world.market.events.length - EVENTS.keepEvents);
  emit(world, {
    agentId: null, kind: 'event', text: `${title} — ${short(description, 90)}`,
    ...(r?.productId || r?.creativeId ? { refs: { ...(r.productId ? { productId: r.productId } : {}), ...(r.creativeId ? { creativeId: r.creativeId } : {}) } } : {}),
  });
  return ev;
}
