/** Money/state moves shared by the tools (agent actions) and the daily tick (market). */
import { emit, nextId, round2 } from '../core/index.js';
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

/** What can still be repaid on an order: its price minus everything already given back. */
export function repayableLeft(order: Order): number {
  return round2(Math.max(0, order.price - (order.refundedAmount ?? 0)));
}

function addRefundAmount(world: WorldState, order: Order, amount: number): void {
  const p = productById(world, order.productId);
  if (p) p.stats.refundAmount = round2(p.stats.refundAmount + amount);
}

function bumpRefundStats(world: WorldState, order: Order, amount: number): void {
  addRefundAmount(world, order, amount);
  const p = productById(world, order.productId);
  if (p) p.stats.refunds += 1;
  const c = customerById(world, order.customerId);
  if (c) c.satisfaction = Math.max(-1, c.satisfaction - 0.3);
}

/**
 * Full refund: reverses what is left of the order after any goodwill gesture. Returns the amount given back
 * (0 when already refunded / disputed). `scam_loss` books a refund obtained through a false claim.
 */
export function refundOrder(world: WorldState, order: Order, memo: string, type: 'refund' | 'scam_loss' = 'refund'): number {
  if (order.refunded || order.chargeback) return 0;
  const amount = repayableLeft(order);
  order.refunded = true;
  order.refundedDay = world.day;
  order.refundedAmount = order.price;
  if (amount > 0) recordLedger(world, { type, amount: -amount, memo, ref: order.id });
  bumpRefundStats(world, order, amount);
  return amount;
}

/** Bank dispute: what is left of the sale is reversed AND a fixed fee is charged. Returns the total cost. */
export function chargebackOrder(world: WorldState, order: Order): number {
  if (order.refunded || order.chargeback) return 0;
  const left = repayableLeft(order);
  order.chargeback = true;
  order.refunded = true;
  order.refundedDay = world.day;
  order.refundedAmount = order.price;
  const cost = round2(left + FEES.chargebackFee);
  recordLedger(world, { type: 'chargeback', amount: -cost, memo: `Litige bancaire (chargeback) : ${fmtEur(left)} + ${fmtEur(FEES.chargebackFee)} de frais`, ref: order.id });
  bumpRefundStats(world, order, left);
  return cost;
}

/** Partial goodwill refund, at most one per order (booked as 'discount' unless it pays a false claim). */
export function partialRefund(world: WorldState, order: Order | undefined, share: number, memo: string, type: 'discount' | 'scam_loss' = 'discount'): number {
  if (!order || order.refunded || order.chargeback || (order.refundedAmount ?? 0) > 0) return 0;
  const amount = Math.min(repayableLeft(order), round2(order.price * share));
  if (amount <= 0) return 0;
  order.refundedAmount = amount;
  recordLedger(world, { type, amount: -amount, memo, ref: order.id });
  addRefundAmount(world, order, amount);
  return amount;
}

/** True when this customer really bought this product (refunded or not): the only people who can rate it. */
export function isVerifiedBuyer(world: WorldState, customer: Customer | undefined, product: Product): boolean {
  return !!customer && world.market.orders.some((o) => o.customerId === customer.id && o.productId === product.id);
}

/** Every store review goes through here: only a verified buyer of the product can leave one. */
export function reviewProduct(world: WorldState, rng: Rng, product: Product | undefined, customer: Customer | undefined, rating: number, kind: ReviewKind): boolean {
  if (!product || !isVerifiedBuyer(world, customer, product)) return false;
  addReview(world, rng, product, customer!.id, rating, nicheOf(world, product), kind);
  return true;
}

/** Ids an event is about (product, niche, creative, creator) and the day it announces; empty values are dropped. */
export type EventRefs = { [K in Exclude<keyof NonNullable<WorldEvent['refs']>, 'day'>]?: string | null } & { day?: number | null };

function cleanRefs(refs: EventRefs | undefined): WorldEvent['refs'] | undefined {
  if (!refs) return undefined;
  const out: NonNullable<WorldEvent['refs']> = {};
  for (const k of ['productId', 'nicheId', 'creativeId', 'creatorId'] as const) {
    const v = refs[k];
    if (typeof v === 'string' && v && v !== FALLBACK_NICHE.id) out[k] = v;
  }
  if (typeof refs.day === 'number' && Number.isFinite(refs.day)) out.day = refs.day;
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
