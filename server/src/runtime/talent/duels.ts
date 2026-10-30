/** Duels (talent §6.3). Stub until P3.6. */
import type { AdCreative, Duel } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';

export function scheduleDuel(_ctx: RuntimeCtx): Duel | null {
  return null;
}

export function onDuelCreative(_ctx: RuntimeCtx, _creative: AdCreative): void {
  /* P3.6 */
}

export function settleDuels(_ctx: RuntimeCtx): void {
  /* P3.6 */
}
