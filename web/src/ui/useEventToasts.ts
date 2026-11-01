// Turns snapshot changes into toasts: world events, sale bursts, run status changes, and what the chronicle records.
import { useEffect, useRef } from 'react';
import type { ChronicleEntry, ChronicleKind, CompanySnapshot, DeptId, SceneView, WorldEvent, WorldEventKind } from '../../../shared/types';
import { endedBankrupt, goalLate, goalTitle } from './derive';
import { fmtEur } from './format';
import type { IconName } from './icons';
import type { TabId } from './labels';
import type { ToastInput, ToastTone } from './Toasts';

const EVENT_ICON: Record<WorldEventKind, IconName> = {
  ad_rejected: 'ban', ad_account_warning: 'shield', ad_account_banned: 'ban', viral_organic: 'zap', competitor_clone: 'users',
  payment_hold: 'wallet', bad_review_wave: 'star', scam_attempt: 'alert', creator_offer: 'users', platform_outage: 'alert',
  seasonal_boost: 'trendUp', goal_reached: 'sparkle', bankrupt: 'alert', cpm_spike: 'trendUp', cpm_drop: 'trendDown', trend_shift: 'trendUp',
  channel_opened: 'megaphone', channel_account_banned: 'ban',
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
      // A bankruptcy speaks through its event, once per episode: the status flickers with cash around zero, the toast does not.
      const hadEvent = fresh.some((e) => e.kind === 'goal_reached');
      if (!hadEvent && snapshot.status === 'goal_reached') push({ tone: goalLate(snapshot) ? 'info' : 'good', icon: 'sparkle', title: goalTitle(snapshot), text: `Profit cumulé ${fmtEur(snapshot.finance?.profit)}`, ttl: 9000 });
      if (snapshot.status === 'finished') push(endedBankrupt(snapshot)
        ? { tone: 'bad', icon: 'alert', title: 'Faillite', text: `La simulation s’arrête au jour ${snapshot.day} sur une trésorerie négative.`, ttl: 9000 }
        : { tone: 'info', icon: 'flag', title: 'Fin de la simulation', text: `Horizon atteint au jour ${snapshot.day}.` });
      s.status = snapshot.status;
    }
  }, [snapshot, push, enabled, onOpenProduct]);
}

/** Toast of a world event; action = link to the product the event is about (refs.productId). */
export function eventToast(e: WorldEvent, action?: ToastInput['action']): ToastInput {
  return { tone: SEVERITY_TONE[e.severity] ?? 'info', icon: EVENT_ICON[e.kind], title: e.title, text: e.description, ttl: e.severity === 'danger' ? 8000 : action ? 7000 : 5500, action };
}

// ───────────────────────────── The chronicle ─────────────────────────────

/** A layoff is a departure like a firing: `resign` of ui §6.9 became it (D46). */
const CHRONICLE_TOAST: Partial<Record<ChronicleKind, { tone: ToastTone; icon: IconName; label: [string, string] }>> = {
  hire: { tone: 'good', icon: 'users', label: ['arrivée', 'arrivées'] },
  fire: { tone: 'warn', icon: 'users', label: ['départ', 'départs'] },
  layoff: { tone: 'warn', icon: 'users', label: ['réduction d’effectif', 'réductions d’effectif'] },
  season_end: { tone: 'info', icon: 'trophy', label: ['fin de saison', 'fins de saison'] },
  channel_open: { tone: 'good', icon: 'megaphone', label: ['canal ouvert', 'canaux ouverts'] },
  dept_open: { tone: 'good', icon: 'building', label: ['équipe ouverte', 'équipes ouvertes'] },
  stage_up: { tone: 'good', icon: 'trendUp', label: ['palier franchi', 'paliers franchis'] },
};
const TOAST_BATCH = 3;

export type EntryTarget = { tab: TabId } | { agent: string } | { dept: DeptId };

/** Where a line of the chronicle leads: the world never moves the camera by itself, a toast or the digest offers this instead. */
export function entryTarget(e: ChronicleEntry): EntryTarget {
  if (e.kind === 'channel_open' || e.kind === 'channel_close') return { tab: 'canaux' };
  if (e.kind === 'stage_up' || e.kind === 'stage_down') return { tab: 'croissance' };
  if (e.kind === 'season_end' || e.kind === 'duel_open' || e.kind === 'duel_end') return { tab: 'competition' };
  if (e.kind === 'req_open' || e.kind === 'req_filled') return { tab: 'effectif' };
  if (e.agentId) return { agent: e.agentId };
  return e.dept ? { dept: e.dept } : { tab: 'effectif' };
}

export interface ChronicleSeen { runId: string | null; keys: Set<string> }

const MAX_SEEN = 500;

/**
 * Same idempotence as `takeBeats`: the first snapshot of a run toasts nothing, then each key once. Keys outlive `recent`: that window
 * can shrink, an old line then slides back into it, and it is still not news. The newest 500 are far more than the window holds.
 */
export function takeToasts(st: ChronicleSeen, runId: string, recent: readonly ChronicleEntry[]): ChronicleEntry[] {
  const sameRun = st.runId === runId;
  const fresh = sameRun ? recent.filter((e) => !st.keys.has(e.key) && CHRONICLE_TOAST[e.kind]) : [];
  if (!sameRun) st.keys = new Set();
  st.runId = runId;
  for (const e of recent) st.keys.add(e.key);
  if (st.keys.size > MAX_SEEN) st.keys = new Set([...st.keys].slice(-MAX_SEEN));
  return fresh;
}

/** One toast per entry; a batch over 3, after a sleep or at ×8, is one summary. */
export function chronicleToasts(entries: readonly ChronicleEntry[], onOpen?: (e: ChronicleEntry) => void): ToastInput[] {
  if (entries.length > TOAST_BATCH) {
    const counts = new Map<ChronicleKind, number>();
    for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    const text = [...counts].map(([kind, n]) => `${n} ${CHRONICLE_TOAST[kind]?.label[n > 1 ? 1 : 0] ?? kind}`).join(', ');
    return [{ tone: 'info', icon: 'users', title: `${entries.length} événements dans l’agence`, text, ttl: 7000 }];
  }
  return entries.map((e) => {
    const look = CHRONICLE_TOAST[e.kind];
    return { tone: look?.tone ?? 'info', icon: look?.icon, title: e.text, text: e.why, ttl: 7000, action: onOpen ? { label: 'Voir', run: () => onOpen(e) } : undefined };
  });
}

/** A toast per hire, departure, end of season, channel, team and stage. `enabled`: as useEventToasts, not while the stream is down. */
export function useChronicleToasts(scene: SceneView | undefined, push: (t: ToastInput) => void, opts: { runId: string | undefined; enabled: boolean; onOpen?: (e: ChronicleEntry) => void }) {
  const { runId, enabled, onOpen } = opts;
  const seen = useRef<ChronicleSeen>({ runId: null, keys: new Set() });

  useEffect(() => {
    if (!scene || !runId || !enabled) return;
    for (const t of chronicleToasts(takeToasts(seen.current, runId, scene.recent), onOpen)) push(t);
  }, [scene, runId, enabled, push, onOpen]);
}

/** The line the live region reads out: the canvas drama needs a text equivalent. */
export function lastAnnounced(recent: readonly ChronicleEntry[] | undefined): string {
  for (let i = (recent?.length ?? 0) - 1; i >= 0; i--) {
    const e = recent![i]!;
    if (e.kind === 'hire' || e.kind === 'fire' || e.kind === 'layoff' || e.kind === 'season_end') return e.text;
  }
  return '';
}
