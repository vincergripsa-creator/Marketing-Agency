/** Random world events rolled at market close (they shape the following days). */
import { clamp, round2 } from '../core/index.js';
import type { DifficultyProfile, Rng } from '../contracts.js';
import type { Customer, Product, WorldEvent, WorldEventKind, WorldState } from '../shared.js';
import { CONVERSION, EVENTS, FEES } from './balance.js';
import { createCustomer, senderArchetype } from './customers.js';
import { HOLD_REF, cashOf, heldAmount, recordLedger, revenueSince } from './finance.js';
import { createMessage } from './inbox.js';
import { difficultyProfile, markScammer, rollCreator } from './market.js';
import { nicheOf, pushEvent, reviewProduct } from './ops.js';
import { fmtEur, fmtPct, pickWeighted, short } from './text.js';

export { announcedOutageDays, isAnnouncedOutage } from './outage.js';

function liveProducts(world: WorldState): Product[] {
  return world.company.products.filter((p) => p.status === 'live');
}

/** True while a seasonal boost (last N days) is running. */
export function seasonalBoostActive(world: WorldState): boolean {
  const since = world.day - CONVERSION.seasonalBoostDays;
  return world.market.events.some((e) => e.kind === 'seasonal_boost' && e.day >= since && e.day < world.day);
}

type Roll = (world: WorldState, rng: Rng, diff: DifficultyProfile) => WorldEvent | null;

const cpmSpike: Roll = (world) => {
  const m = world.market.modifiers;
  if (m.cpmUntilDay >= world.day + 1) return null;
  m.cpmMultiplier = EVENTS.cpmSpike.multiplier;
  m.cpmUntilDay = world.day + EVENTS.cpmSpike.days;
  return pushEvent(world, 'cpm_spike', 'Flambée des CPM sur TikTok',
    `Les grandes marques achètent massivement l'inventaire publicitaire : les CPM augmentent d'environ 40 % jusqu'au jour ${m.cpmUntilDay}.`, 'warn');
};

const cpmDrop: Roll = (world) => {
  const m = world.market.modifiers;
  if (m.cpmUntilDay >= world.day + 1) return null;
  m.cpmMultiplier = EVENTS.cpmDrop.multiplier;
  m.cpmUntilDay = world.day + EVENTS.cpmDrop.days;
  return pushEvent(world, 'cpm_drop', 'CPM en baisse',
    `Peu d'annonceurs en ce moment : les impressions coûtent environ 25 % de moins jusqu'au jour ${m.cpmUntilDay}. Bon moment pour tester.`, 'good');
};

const competitorClone: Roll = (world, rng) => {
  const live = liveProducts(world);
  if (!live.length) return null;
  const p = rng.pick(live);
  const niche = nicheOf(world, p);
  if (niche.id === '_inconnue') return null;
  niche.competition = round2(clamp(niche.competition + EVENTS.cloneCompetition, 0, 0.95));
  const platform = rng.pick(['etsy', 'gumroad', 'stan'] as const);
  niche.competitors.push({
    id: `cmp_${niche.id}_clone_${world.day}`, nicheId: niche.id,
    title: `${short(p.title, 40)} (édition express)`,
    price: Math.max(5, Math.round(p.price * 0.6)), reviews: rng.int(3, 25), rating: 4.7, ageDays: 1, platform,
    weaknesses: ["Copie quasi conforme d'un guide existant", 'Avis suspects publiés le même jour'],
  });
  return pushEvent(world, 'competitor_clone', 'Un concurrent copie notre guide',
    `Un vendeur ${platform} a publié une copie de « ${short(p.title, 50)} » à ${fmtEur(Math.max(5, Math.round(p.price * 0.6)))}. La concurrence monte dans la niche « ${niche.name} ».`, 'warn',
    { productId: p.id, nicheId: niche.id });
};

const paymentHold: Roll = (world) => {
  const m = world.market.modifiers;
  if (m.paymentHoldUntilDay > world.day || heldAmount(world) < 0) return null;
  const rev7 = revenueSince(world, 7);
  if (rev7 < 30) return null;
  // a reserve freezes part of the cash (never the checkout, never all of the cash: the agency keeps operating)
  const share = round2(rev7 * FEES.paymentHoldShare);
  const cap = round2(Math.max(0, cashOf(world)) * FEES.paymentHoldMaxCashShare);
  const amount = Math.min(share, cap);
  if (amount < 5) return null;
  m.paymentHoldUntilDay = world.day + FEES.paymentHoldDays;
  const basis = amount < share ? 'la moitié de la trésorerie disponible' : `${fmtPct(FEES.paymentHoldShare, 0)} des ventes de la semaine`;
  const ev = pushEvent(world, 'payment_hold', 'Paiements mis en réserve',
    `Le prestataire de paiement bloque ${fmtEur(amount)} (${basis}) par sécurité. Les ventes continuent normalement ; libération prévue le jour ${m.paymentHoldUntilDay}.`, 'warn');
  recordLedger(world, { type: 'platform_fee', amount: -amount, memo: `Réserve de sécurité du prestataire de paiement (libérée le jour ${m.paymentHoldUntilDay})`, ref: `${HOLD_REF}${ev.id}` });
  return ev;
};

const trendShift: Roll = (world, rng) => {
  const live = liveProducts(world);
  const niches = world.market.niches;
  if (!niches.length) return null;
  const picked = live.length > 0 && rng.chance(0.5) ? rng.pick(live) : null;
  const niche = picked ? nicheOf(world, picked) : rng.pick(niches);
  if (niche.id === '_inconnue') return null;
  const affected = live.find((p) => p.nicheId === niche.id) ?? null;
  const up = rng.chance(0.5);
  const before = niche.demand;
  niche.demand = round2(clamp(niche.demand * (up ? EVENTS.trendShift.up : EVENTS.trendShift.down), 0.05, 1));
  const delta = niche.demand / Math.max(0.01, before) - 1;
  return pushEvent(world, 'trend_shift', up ? `Tendance en hausse : ${niche.name}` : `Tendance en baisse : ${niche.name}`,
    up ? `Le sujet circule beaucoup sur TikTok cette semaine : la demande progresse d'environ ${fmtPct(delta, 0)}.`
      : `L'intérêt retombe : la demande recule d'environ ${fmtPct(-delta, 0)} dans cette niche.`, up ? 'good' : 'warn',
    { nicheId: niche.id, productId: (picked ?? affected)?.id ?? null });
};

/** Most recent buyer of the product with a hostile profile who has not rated it yet. */
function hostileBuyer(world: WorldState, p: Product): Customer | undefined {
  const reviewed = new Set(p.stats.reviews.map((r) => r.customerId));
  const hostile = new Map(world.market.customers.filter((c) => c.archetype === 'troll' || c.archetype === 'karen').map((c) => [c.id, c]));
  const orders = world.market.orders;
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i]!;
    if (o.productId === p.id && !reviewed.has(o.customerId) && hostile.has(o.customerId)) return hostile.get(o.customerId);
  }
  return undefined;
}

const badReviewWave: Roll = (world, rng) => {
  const live = liveProducts(world);
  if (!live.length) return null;
  const p = rng.pick(live);
  const niche = nicheOf(world, p);
  const n = rng.int(3, 6);
  for (let i = 0; i < n; i++) {
    const troll = createCustomer(world, rng, 'troll');
    createMessage(world, rng, { intent: 'troll', customer: troll, product: p, order: null, niche, channel: rng.chance(0.5) ? 'avis' : 'commentaire_tiktok' });
  }
  // only a verified buyer can rate the store: the wave reaches the page through a hostile buyer, if there is one
  const reviewed = reviewProduct(world, rng, p, hostileBuyer(world, p), 1, 'troll');
  return pushEvent(world, 'bad_review_wave', 'Vague de trolls',
    `Une vidéo moqueuse sur les « vendeurs de PDF » a fait le tour : ${n} messages hostiles${reviewed ? ' et un avis 1 étoile' : ''} sur « ${short(p.title, 50)} ». Ne pas nourrir les trolls.`, 'danger',
    { productId: p.id, nicheId: niche.id });
};

const scamAttempt: Roll = (world, rng) => {
  const n = rng.int(1, 3);
  const live = liveProducts(world);
  let target: Product | null = null;
  for (let i = 0; i < n; i++) {
    const c = createCustomer(world, rng, senderArchetype(rng, 'arnaque'));
    const p = live.length ? rng.pick(live) : null;
    target ??= p;
    createMessage(world, rng, { intent: 'arnaque', customer: c, product: p, order: null, niche: p ? nicheOf(world, p) : undefined });
  }
  return pushEvent(world, 'scam_attempt', "Tentatives d'arnaque",
    `${n} message(s) suspect(s) viennent d'arriver (faux support, fausses promotions, liens douteux). Vigilance au support.`, 'danger',
    target ? { productId: target.id, nicheId: target.nicheId } : undefined);
};

const creatorOffer: Roll = (world, rng) => {
  const live = liveProducts(world);
  if (!live.length) return null;
  const p = rng.pick(live);
  const niche = nicheOf(world, p);
  if (niche.id === '_inconnue') return null;
  const used = new Set(world.market.creators.map((c) => c.handle));
  const index = world.market.creators.filter((c) => c.nicheId === niche.id).length + 1;
  const { creator, scam } = rollCreator(rng, niche, index, world.scenario?.difficulty ?? 'normal', used);
  creator.id = `crt_${niche.id}_${index}_j${world.day}`;
  if (scam) markScammer(niche, creator.id);
  world.market.creators.push(creator);
  const sender = createCustomer(world, rng, 'normal');
  sender.name = `@${creator.handle}`;
  const msg = createMessage(world, rng, { intent: 'partenariat', customer: sender, product: p, order: null, niche, channel: 'dm' });
  msg.subject = 'Proposition de collaboration';
  msg.body = creator.askUpfront > 0
    ? `Hello ! Je suis @${creator.handle} (${Math.round(creator.followers / 1000)} k abonnés). J'adorerais parler de « ${p.title} » à ma communauté. Mon tarif : ${creator.askUpfront} € + ${Math.round(creator.askCommission * 100)} % des ventes. On en parle ?`
    : `Coucou, ici @${creator.handle} (${Math.round(creator.followers / 1000)} k abonnés). Ton guide « ${p.title} » colle parfaitement à mon audience. Je peux en parler à la commission (${Math.round(creator.askCommission * 100)} %), sans avance.`;
  msg.thread = [{ from: 'customer', text: msg.body, day: world.day }];
  return pushEvent(world, 'creator_offer', 'Un créateur nous contacte',
    `@${creator.handle} propose une collaboration pour « ${short(p.title, 50)} ». À vérifier avant de payer quoi que ce soit.`, 'info',
    { productId: p.id, nicheId: niche.id, creatorId: creator.id });
};

const platformOutage: Roll = (world) => {
  const m = world.market.modifiers;
  if (m.outageDay > world.day) return null;
  m.outageDay = world.day + 1;
  return pushEvent(world, 'platform_outage', 'Panne de la boutique annoncée',
    `Le prestataire de la boutique prévient d'une panne du paiement le jour ${m.outageDay} : aucune vente ne pourra aboutir ce jour-là. Pensez à mettre les pubs en pause.`, 'danger',
    { day: m.outageDay });
};

const seasonalBoost: Roll = (world) => {
  if (seasonalBoostActive(world) || world.market.events.some((e) => e.kind === 'seasonal_boost' && e.day === world.day)) return null;
  return pushEvent(world, 'seasonal_boost', 'Pic saisonnier',
    `Période favorable (paie, rentrée, bonnes résolutions) : les visiteurs achètent environ 20 % plus volontiers pendant ${CONVERSION.seasonalBoostDays} jours.`, 'good');
};

const ROLLS: [WorldEventKind, Roll, number][] = [
  ['cpm_spike', cpmSpike, 1.2], ['cpm_drop', cpmDrop, 0.8], ['competitor_clone', competitorClone, 1], ['payment_hold', paymentHold, 0.45],
  ['trend_shift', trendShift, 1], ['bad_review_wave', badReviewWave, 0.6], ['scam_attempt', scamAttempt, 0.9], ['creator_offer', creatorOffer, 0.7],
  ['platform_outage', platformOutage, 0.5], ['seasonal_boost', seasonalBoost, 0.6],
];

function rollOne(world: WorldState, rng: Rng, diff: DifficultyProfile): WorldEvent | null {
  const weighted = ROLLS.map(([kind, fn, w]) => [[kind, fn] as const, kind === 'scam_attempt' ? w + diff.scamRate * 2 : w] as const);
  for (let attempt = 0; attempt < 4; attempt++) {
    const [, fn] = pickWeighted(rng, weighted);
    const ev = fn(world, rng, diff);
    if (ev) return ev;
  }
  return null;
}

/** Rolls one specific event now (tests, scripted scenarios). Returns null when its conditions are not met. */
export function forceEvent(world: WorldState, rng: Rng, kind: WorldEventKind): WorldEvent | null {
  const roll = ROLLS.find(([k]) => k === kind)?.[1];
  return roll ? roll(world, rng, difficultyProfile(world.scenario?.difficulty ?? 'normal')) : null;
}

/** 0, 1 or (rarely) 2 events per day, at the difficulty's rate. */
export function rollEvents(world: WorldState, rng: Rng, diff: DifficultyProfile): WorldEvent[] {
  const out: WorldEvent[] = [];
  if (rng.chance(diff.eventRate)) {
    const ev = rollOne(world, rng, diff);
    if (ev) out.push(ev);
    if (rng.chance(diff.eventRate * EVENTS.secondEventShare)) {
      const ev2 = rollOne(world, rng, diff);
      if (ev2) out.push(ev2);
    }
  }
  return out;
}

/** Releases matured payment reserves (cash only, never profit). */
export function releaseHolds(world: WorldState): number {
  const m = world.market.modifiers;
  if (m.paymentHoldUntilDay <= 0 || world.day < m.paymentHoldUntilDay) return 0;
  m.paymentHoldUntilDay = 0;
  const held = heldAmount(world);
  if (held >= 0) return 0;
  recordLedger(world, { type: 'platform_fee', amount: -held, memo: 'Libération de la réserve du prestataire de paiement', ref: `${HOLD_REF}release:${world.day}` });
  return -held;
}
