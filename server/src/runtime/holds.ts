/**
 * The founder's standing decisions: an order (« coupe toutes les pubs ») holds until the founder lifts it, a refusal holds for
 * a cooldown. They stay on record once ended: a week without ads because the founder said so proves nothing about a guide.
 */
import type { AgentId, ChannelId, FounderHold, WorldState } from '../shared.js';
import { nextId } from '../core/index.js';

/** Days a refused campaign or budget raise is not asked for again. */
export const REFUSAL_COOLDOWN_DAYS = 7;

const holding = (h: FounderHold, day: number): boolean => h.liftedDay === undefined && (h.until === null || day <= h.until);

function holdsOf(world: WorldState, kind: FounderHold['kind']): FounderHold[] {
  return (world.company.holds ?? []).filter((h) => h.kind === kind);
}

/** « Coupe Meta » stops Meta alone: a hold without a channel stops all of them. */
const onChannel = (h: FounderHold, channel: ChannelId): boolean => !h.channel || h.channel === channel;

/**
 * The hold that stops paid ads on this channel: on everything, or on this product. Without a product, only a hold on
 * every product. Without a channel, TikTok's: whatever predates the channels runs there.
 */
export function adsHold(world: WorldState, productId: string | null = null, channel: ChannelId = 'tiktok'): FounderHold | null {
  return holdsOf(world, 'ads').find((h) => holding(h, world.day) && (h.productId === null || h.productId === productId) && onChannel(h, channel)) ?? null;
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

/** Nobody new joins while it stands: a refused hire, or the founder's freeze. */
export function hiringHold(world: WorldState): FounderHold | null {
  return holdsOf(world, 'hiring').find((h) => holding(h, world.day)) ?? null;
}

/** Nobody is dismissed while it stands: plans, challenges and layoffs read it. */
export function firingHold(world: WorldState): FounderHold | null {
  return holdsOf(world, 'firing').find((h) => holding(h, world.day)) ?? null;
}

/** This person stays out of plans and challenges: « garde Sarah », or a replacement the founder refused. */
export function pinHold(world: WorldState, agentId: AgentId): FounderHold | null {
  return holdsOf(world, 'pin').find((h) => holding(h, world.day) && h.agentId === agentId) ?? null;
}

/** Holds in force, newest first: what the company tells whoever asks. */
export function activeHolds(world: WorldState): FounderHold[] {
  return (world.company.holds ?? []).filter((h) => holding(h, world.day)).reverse();
}

/** Did a hold stop this product's ads on a day from `from` on? Those days say nothing about its traction. */
export function adsHeldSince(world: WorldState, productId: string, from: number, channel: ChannelId = 'tiktok'): boolean {
  return holdsOf(world, 'ads').some((h) => (h.productId === null || h.productId === productId) && onChannel(h, channel) && (h.liftedDay ?? h.until ?? world.day) >= from);
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
