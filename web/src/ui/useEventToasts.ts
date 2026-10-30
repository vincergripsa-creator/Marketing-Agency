// Turns snapshot changes into toasts: world events, sale bursts, run status changes.
import { useEffect, useRef } from 'react';
import type { CompanySnapshot, WorldEvent, WorldEventKind } from '../../../shared/types';
import { goalLate, goalTitle } from './derive';
import { fmtEur } from './format';
import type { IconName } from './icons';
import type { ToastInput, ToastTone } from './Toasts';

const EVENT_ICON: Record<WorldEventKind, IconName> = {
  ad_rejected: 'ban', ad_account_warning: 'shield', ad_account_banned: 'ban', viral_organic: 'zap', competitor_clone: 'users',
  payment_hold: 'wallet', bad_review_wave: 'star', scam_attempt: 'alert', creator_offer: 'users', platform_outage: 'alert',
  seasonal_boost: 'trendUp', goal_reached: 'sparkle', bankrupt: 'alert', cpm_spike: 'trendUp', cpm_drop: 'trendDown', trend_shift: 'trendUp',
};
const SEVERITY_TONE: Record<string, ToastTone> = { info: 'info', warn: 'warn', danger: 'bad', good: 'good' };
const SALE_BURST = 2;

/** onOpenProduct: events with refs.productId (and rejected creatives) get a « Voir le produit » link. */
export function useEventToasts(snapshot: CompanySnapshot | null, push: (t: ToastInput) => void, enabled: boolean, onOpenProduct?: (productId: string) => void) {
  const state = useRef<{ runId: string | null; events: Set<string>; orders: Set<string>; rejected: Set<string>; status: string | null }>({ runId: null, events: new Set(), orders: new Set(), rejected: new Set(), status: null });

  useEffect(() => {
    if (!snapshot) return;
    const s = state.current;
    const events = snapshot.market?.events ?? [];
    const orders = snapshot.market?.orders ?? [];
    const rejected = (snapshot.company?.creatives ?? []).filter((c) => c.review?.status === 'rejected');
    // New run (or first snapshot): remember everything, toast nothing.
    if (s.runId !== snapshot.runId) {
      state.current = { runId: snapshot.runId, events: new Set(events.map((e) => e.id)), orders: new Set(orders.map((o) => o.id)), rejected: new Set(rejected.map((c) => c.id)), status: snapshot.status };
      return;
    }
    if (!enabled) return;

    const products = new Set((snapshot.company?.products ?? []).map((p) => p.id));
    const productAction = (id: string | null | undefined): ToastInput['action'] =>
      id && onOpenProduct && products.has(id) ? { label: 'Voir le produit', run: () => onOpenProduct(id) } : undefined;
    const fresh = events.filter((e) => !s.events.has(e.id));
    for (const e of fresh.slice(-3)) {
      push(eventToast(e, productAction(e.refs?.productId)));
    }
    for (const e of events) s.events.add(e.id);

    // Ad rejections also surface through the creative's review (in case no world event was raised).
    const newlyRejected = rejected.filter((c) => !s.rejected.has(c.id));
    if (newlyRejected.length && !fresh.some((e) => e.kind === 'ad_rejected')) {
      const c = newlyRejected[newlyRejected.length - 1]!;
      push({ tone: 'bad', icon: 'ban', title: 'Pub refusée par la plateforme', text: `« ${c.hook} »${c.review?.reason ? ` — ${c.review.reason}` : ''}`, ttl: 7000, action: productAction(c.productId) });
    }
    for (const c of rejected) s.rejected.add(c.id);

    const newOrders = orders.filter((o) => !s.orders.has(o.id));
    if (newOrders.length >= SALE_BURST) {
      const total = newOrders.reduce((a, o) => a + (o.price || 0), 0);
      const upsells = newOrders.filter((o) => o.source === 'upsell').length;
      push({ tone: 'good', icon: 'cart', title: `Rafale de ventes : ${newOrders.length} commandes`, text: `+${fmtEur(total)}${upsells ? ` dont ${upsells} upsell${upsells > 1 ? 's' : ''} « La suite est ici »` : ''}` });
    }
    for (const o of orders) s.orders.add(o.id);

    if (s.status !== snapshot.status) {
      const hadEvent = fresh.some((e) => e.kind === 'goal_reached' || e.kind === 'bankrupt');
      if (!hadEvent && snapshot.status === 'goal_reached') push({ tone: goalLate(snapshot) ? 'info' : 'good', icon: 'sparkle', title: goalTitle(snapshot), text: `Profit cumulé ${fmtEur(snapshot.finance?.profit)}`, ttl: 9000 });
      if (!hadEvent && snapshot.status === 'bankrupt') push({ tone: 'bad', icon: 'alert', title: 'Faillite', text: 'La trésorerie est négative : l’agence continue en mode survie.', ttl: 9000 });
      if (snapshot.status === 'finished') push({ tone: 'info', icon: 'flag', title: 'Fin de la simulation', text: `Horizon atteint au jour ${snapshot.day}.` });
      s.status = snapshot.status;
    }
  }, [snapshot, push, enabled, onOpenProduct]);
}

/** Toast of a world event; action = link to the product the event is about (refs.productId). */
export function eventToast(e: WorldEvent, action?: ToastInput['action']): ToastInput {
  return { tone: SEVERITY_TONE[e.severity] ?? 'info', icon: EVENT_ICON[e.kind], title: e.title, text: e.description, ttl: e.severity === 'danger' ? 8000 : action ? 7000 : 5500, action };
}
