/**
 * The founder's standing decisions: an order (« coupe toutes les pubs ») holds until he lifts it, a refusal holds for
 * a cooldown. They stay on record once ended: a week without ads because he said so proves nothing about a guide.
 */
import type { FounderHold, WorldState } from '../shared.js';
import { nextId } from '../core/index.js';

/** Days a refused campaign or budget raise is not asked for again. */
export const REFUSAL_COOLDOWN_DAYS = 7;

const holding = (h: FounderHold, day: number): boolean => h.liftedDay === undefined && (h.until === null || day <= h.until);

function holdsOf(world: WorldState, kind: FounderHold['kind']): FounderHold[] {
  return (world.company.holds ?? []).filter((h) => h.kind === kind);
}

/** The hold that stops paid ads: on everything, or on this product. Without a product, only a hold on everything. */
export function adsHold(world: WorldState, productId: string | null = null): FounderHold | null {
  return holdsOf(world, 'ads').find((h) => holding(h, world.day) && (h.productId === null || h.productId === productId)) ?? null;
}

export function advancesHold(world: WorldState): FounderHold | null {
  return holdsOf(world, 'advances').find((h) => holding(h, world.day)) ?? null;
}

export function launchHold(world: WorldState): FounderHold | null {
  return holdsOf(world, 'launches').find((h) => holding(h, world.day)) ?? null;
}

export function productHold(world: WorldState, productId: string): FounderHold | null {
  return holdsOf(world, 'product').find((h) => holding(h, world.day) && h.productId === productId) ?? null;
}

/** Holds in force, newest first: what the company tells whoever asks. */
export function activeHolds(world: WorldState): FounderHold[] {
  return (world.company.holds ?? []).filter((h) => holding(h, world.day)).reverse();
}

/** Did a hold stop this product's ads on a day from `from` on? Those days say nothing about its traction. */
export function adsHeldSince(world: WorldState, productId: string, from: number): boolean {
  return holdsOf(world, 'ads').some((h) => (h.productId === null || h.productId === productId) && (h.liftedDay ?? h.until ?? world.day) >= from);
}

export function addHold(world: WorldState, spec: Omit<FounderHold, 'id' | 'day'>): FounderHold {
  const hold: FounderHold = { id: nextId(world, 'hld'), day: world.day, ...spec };
  (world.company.holds ??= []).push(hold);
  return hold;
}

/** Ends the holds in force that match: what the founder's new word lifts. */
export function liftHolds(world: WorldState, pred: (h: FounderHold) => boolean): FounderHold[] {
  const lifted = activeHolds(world).filter(pred);
  for (const h of lifted) h.liftedDay = world.day;
  return lifted;
}
