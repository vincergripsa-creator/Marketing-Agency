import type { Activity, WorldState } from '../shared.js';

const MAX_ACTIVITY = 600;
const listeners = new Set<(a: Activity) => void>();

/** Push an activity into the world's feed (ring buffer) and notify live subscribers (SSE). */
export function emit(world: WorldState, a: Omit<Activity, 'id' | 'day' | 'tick' | 'at'>): Activity {
  world.idCounter += 1;
  const activity: Activity = { id: `act_${world.idCounter}`, day: world.day, tick: world.tick, at: Date.now(), ...a };
  world.activity.push(activity);
  if (world.activity.length > MAX_ACTIVITY) world.activity.splice(0, world.activity.length - MAX_ACTIVITY);
  for (const cb of listeners) {
    try { cb(activity); } catch { /* a broken subscriber must never stop the company */ }
  }
  return activity;
}

export function onActivity(cb: (a: Activity) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
