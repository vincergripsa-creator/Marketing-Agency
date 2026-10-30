/** Announced payment outages, read ONLY from the public event log (never from market.modifiers). */
import type { WorldEvent, WorldState } from '../shared.js';

/** Day an outage event announces; events saved before refs.day announced the following day. */
function outageDayOf(e: WorldEvent): number {
  return e.refs?.day ?? e.day + 1;
}

/** Days the store provider announced as outages, oldest first (the event log keeps the last 200 events). */
export function announcedOutageDays(world: WorldState): number[] {
  const days = new Set<number>();
  for (const e of world.market?.events ?? []) if (e.kind === 'platform_outage') days.add(outageDayOf(e));
  return [...days].sort((a, b) => a - b);
}

export function isAnnouncedOutage(world: WorldState, day: number): boolean {
  return (world.market?.events ?? []).some((e) => e.kind === 'platform_outage' && outageDayOf(e) === day);
}
