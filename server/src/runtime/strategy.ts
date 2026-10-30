/**
 * The CEO's heuristic daily plan: a state machine over the company situation
 *   no product → find a niche · building → unblock the chain · live → acquisition (ads, organic, creators)
 *   failing → kill + post-mortem + next niche · profitable → scale + upsell · low cash → survival mode.
 * Then the ContentEngine (Claude mode) may adjust it; the runtime materializes the plan into tasks.
 */
import type { DayPlanItem, DayPlan } from '../contracts.js';
import type { Product, Task, TaskKind } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { nameOf, productOf } from './ctx.js';
import { sim } from './modules.js';
import { activeCampaigns, claimedMessageIds, committedAdBudget, currentBudget, detectedComplaints, isUpsellProduct, productMetrics } from './metrics.js';
import { createProductPipeline, createUpsellPipeline, createV2Pipeline, excludedNiches, killProduct, openTasksForProduct, resumePipeline } from './pipeline.js';
import { createTask, isOpen, KIND_META, openTasks, PLAN_KINDS, PRODUCT_KINDS } from './tasks.js';
import { openMessages, urgency } from './handlers/support.js';
import { experimentCandidate } from './handlers/ops.js';
import { dec, eur, includesCI, pct, short, str, strArr, uniq } from './util.js';

/** Organic TikTok posts per day across all products (the platform throttles reach above 5). */
export const ORGANIC_POSTS_PER_DAY = 4;

function planItem(kind: TaskKind, input: Record<string, unknown>, why: string, priority: 1 | 2 | 3 = 2, title?: string): DayPlanItem {
  return { kind, title: title ?? KIND_META[kind].label, dept: KIND_META[kind].dept, priority, input, why };
}

function titled(kind: TaskKind, p: Product, extra = ''): string {
  return `${KIND_META[kind].label}${extra} — « ${short(p.title, 42)} »`;
}

/** Day the current version of a product went (back) online. */
function versionSince(ctx: RuntimeCtx, p: Product): number {
  let since = p.launchedDay ?? ctx.world.day;
  for (const t of ctx.world.company.tasks) {
    if (t.kind === 'publish_product' && t.status === 'done' && t.input.productId === p.id && t.input.republish === true && t.dayDone) since = Math.max(since, t.dayDone);
  }
  return since;
}

function customerFeedback(ctx: RuntimeCtx, p: Product, since: number): string[] {
  const out: string[] = [];
  for (const t of ctx.world.company.tasks) {
    if (t.kind !== 'reply_inbox' || t.status !== 'done' || (t.dayDone ?? 0) < since) continue;
    const replies = Array.isArray(t.output?.replies) ? (t.output!.replies as Record<string, unknown>[]) : [];
    for (const r of replies) if (r.productId === p.id && typeof r.complaint === 'string') out.push(r.complaint);
  }
  for (const r of p.stats.reviews) if (r.day >= since && r.rating <= 2) out.push(`Avis ${r.rating}/5 : ${r.text}`);
  return uniq(out).slice(0, 6);
}

/** CEO decisions taken at the stand-up (they change the world before the plan is written). */
async function ceoDecisions(ctx: RuntimeCtx, notes: string[]): Promise<void> {
  const w = ctx.world;
  for (const p of w.company.products.filter((x) => x.status === 'live')) {
    if (!p.launchedDay || w.day - p.launchedDay < 7) continue;
    const m = productMetrics(w, p.id);
    // Upsells live off their parent's buyers: they are not judged on their own acquisition.
    const failing = !isUpsellProduct(w, p.id) && m.sales < 3 && (m.spend > 0 ? m.roas < 0.7 : true);
    // Quality dead-end: even the v3 is rated badly by buyers → stop selling it, it hurts the brand.
    const since = versionSince(ctx, p);
    const hopeless = p.version >= 3 && w.day - since >= 5 && p.stats.reviews.length >= 5 && p.stats.rating > 0 && p.stats.rating < 3.2;
    if (!failing && !hopeless) continue;
    const roas = Number.isFinite(m.roas) ? dec(m.roas) : '—';
    const reason = hopeless
      ? `même la v${p.version} reste notée ${dec(p.stats.rating, 1)}/5 par les acheteurs (${p.stats.reviews.length} avis)`
      : `en ligne depuis ${w.day - p.launchedDay} jours : ${m.sales} vente(s), ROAS ${roas} pour ${eur(m.spend)} de pub`;
    await killProduct(ctx, p, reason, 'camille');
    notes.push(`« ${p.title} » arrêté (${hopeless ? 'qualité perçue trop basse' : `${m.sales} ventes en ${w.day - p.launchedDay} jours`}).`);
  }
}

export async function buildHeuristicPlan(ctx: RuntimeCtx): Promise<DayPlan> {
  const w = ctx.world;
  const day = w.day;
  const items: DayPlanItem[] = [];
  const notes: string[] = [];
  await ceoDecisions(ctx, notes);

  const budget = currentBudget(w);
  const products = w.company.products;
  const live = products.filter((p) => p.status === 'live');
  const building = products.filter((p) => !['live', 'killed', 'paused'].includes(p.status));
  const open = (kind: TaskKind, pid?: string) => openTasks(w, (t) => t.kind === kind && (!pid || t.input.productId === pid)).length > 0;
  const paidOk = !budget.survival && !budget.bankrupt && w.status !== 'bankrupt' && !w.market.adAccount.banned;

  // 1. Nothing to sell and nothing in the oven → find the next niche.
  if (!live.length && !building.length && !open('scan_trends') && !open('pick_opportunity') && !open('mine_pains')) {
    const excluded = excludedNiches(ctx, { includeActive: true });
    const shortlist = w.company.research.shortlist.filter((id) => !excluded.includes(id));
    if (w.company.research.trends.length && shortlist.length) items.push(planItem('pick_opportunity', {}, 'La shortlist a encore des niches non testées : on choisit la suivante.', 1));
    else items.push(planItem('scan_trends', { chain: 'opportunity' }, day === 1 ? 'Jour 1 : trouver un problème précis pour lequel les gens paient déjà.' : 'Plus aucune piste exploitable : nouveau scan du marché.', 1));
  }

  // 1b. Diversify: the portfolio has an upsell or is plateauing → open a new niche (one product in production at a time).
  if (live.length && !building.length && live.length < 4 && !open('scan_trends') && !open('pick_opportunity') && !budget.survival && w.status !== 'bankrupt') {
    const lastCreated = Math.max(0, ...products.map((p) => p.createdDay));
    const mains = live.filter((p) => !isUpsellProduct(w, p.id));
    const settled = mains.every((p) => {
      const m7 = productMetrics(w, p.id, Math.max(1, day - 6));
      const mature = (p.launchedDay ?? day) <= day - 7;
      return p.upsellProductId !== null || (mature && (m7.spend > 0 ? m7.roas < 1.2 : m7.sales < 5));
    });
    if (day - lastCreated >= 8 && settled) {
      const excluded = excludedNiches(ctx, { includeActive: true });
      const shortlist = w.company.research.shortlist.filter((id) => !excluded.includes(id));
      const why = 'Le portefeuille plafonne : on ouvre une nouvelle niche pour ne pas dépendre d’un seul produit.';
      if (shortlist.length) items.push(planItem('pick_opportunity', {}, why, 2, 'Choisir une nouvelle niche (diversification)'));
      else items.push(planItem('scan_trends', { chain: 'opportunity' }, why, 2, 'Scanner les tendances (diversification)'));
      notes.push('Diversification : nouvelle niche à l’étude.');
    }
  }

  // 2. Production chains stuck without any open task → resume them.
  for (const p of building) {
    if (!openTasksForProduct(ctx, p.id).length) items.push(planItem('write_pdf', { productId: p.id, pipeline: 'resume' }, `La chaîne de « ${short(p.title, 40)} » est bloquée : on relance les étapes manquantes.`, 1, `Relancer la production — « ${short(p.title, 42)} »`));
  }

  // 3. Live products: acquisition, quality loop, pricing, upsell.
  // Organic first: TikTok throttles reach beyond ~5 posts a day, so Tom gets 4 slots shared by priority
  // (products without paid ads first, then the best sellers of the week).
  const postOrder = [...live].sort((a, b) => {
    const ca = activeCampaigns(w, a.id).length ? 1 : 0, cb = activeCampaigns(w, b.id).length ? 1 : 0;
    return ca - cb || productMetrics(w, b.id, Math.max(1, day - 6)).sales - productMetrics(w, a.id, Math.max(1, day - 6)).sales;
  });
  let postSlots = ORGANIC_POSTS_PER_DAY;
  for (const round of [0, 1]) {
    for (const p of postOrder) {
      if (postSlots <= 0) break;
      const upsell = isUpsellProduct(w, p.id);
      const wants = upsell ? 1 : budget.survival || !activeCampaigns(w, p.id).length ? 2 : 1;
      if (round >= wants) continue;
      items.push(planItem('post_organic', { productId: p.id, slot: round }, upsell ? 'Faire connaître la suite au même public.' : 'Parler du point de douleur gratuitement, tous les jours.', 3, titled('post_organic', p)));
      postSlots--;
    }
  }

  for (const p of live) {
    const pid = p.id;
    const upsell = isUpsellProduct(w, pid);
    const all = productMetrics(w, pid);
    const m7 = productMetrics(w, pid, Math.max(1, day - 6));
    const camps = activeCampaigns(w, pid);

    if (!upsell && !camps.length && paidOk && budget.adCap - committedAdBudget(w) >= 5) {
      const busy = open('launch_campaign', pid) || open('write_ad_hooks', pid) || open('produce_ad', pid);
      const total = w.company.campaigns.filter((c) => c.productId === pid).length;
      if (!busy && total < 5) {
        const inUse = new Set(activeCampaigns(w).flatMap((c) => c.creativeIds));
        const ready = w.company.creatives.some((c) => c.productId === pid && c.review.status === 'approved' && !inUse.has(c.id));
        if (ready) items.push(planItem('launch_campaign', { productId: pid }, 'Des créas validées attendent : on relance une campagne dans l’enveloppe du CFO.', 2, titled('launch_campaign', p)));
        else items.push(planItem('write_ad_hooks', { productId: pid, produce: 2, launch: true }, 'Plus de créa active : nouveaux angles avant de relancer la pub.', 2, titled('write_ad_hooks', p)));
      }
    }

    const lastScout = Math.max(0, ...w.company.tasks.filter((t) => t.kind === 'find_creators' && t.input.productId === pid).map((t) => t.dayCreated));
    const deals = w.market.partnerships.filter((x) => x.productId === pid).length;
    if (p.stats.sales >= 3 && !open('find_creators', pid) && !open('negotiate_deal', pid) && (lastScout === 0 || day - lastScout >= 7) && deals < 6) {
      items.push(planItem('find_creators', { productId: pid }, `${p.stats.sales} ventes : assez de preuve sociale pour recruter des créateurs à la commission.`, 3, titled('find_creators', p)));
    }

    const since = versionSince(ctx, p);
    const v = productMetrics(w, pid, since);
    const complaints = detectedComplaints(w, pid, since);
    const ratingBad = p.stats.reviews.length >= 5 && p.stats.rating > 0 && p.stats.rating < 3.8;
    const refundBad = v.sales >= 8 && v.refundRate > 0.1;
    const reworking = openTasksForProduct(ctx, pid, ['write_pdf', 'humanize_pdf', 'fact_check', 'render_pdf', 'write_sales_page', 'publish_product']).length > 0;
    if ((complaints >= 3 || ratingBad || refundBad) && p.version < 3 && !reworking && day - since >= 2) {
      const why = complaints >= 3 ? `${complaints} plaintes qualité remontées par le support` : ratingBad ? `note moyenne ${dec(p.stats.rating, 1)}/5` : `taux de remboursement ${pct(v.refundRate)}`;
      items.push(planItem('write_pdf', { productId: pid, pipeline: 'v2', feedback: customerFeedback(ctx, p, since) }, `Boucle qualité : ${why} → v${p.version + 1}.`, 1, `Réécrire le guide (v${p.version + 1}) — « ${short(p.title, 40)} »`));
    }

    const priceExp = w.company.experiments.find((e) => e.status === 'running' && e.dimension === 'price' && e.hypothesis.includes(p.title.slice(0, 30)));
    if (priceExp && !open('set_price', pid)) {
      items.push(planItem('set_price', { productId: pid, reason: 'experiment' }, `Test de prix en cours (${priceExp.variants.join(' € vs ')} €) : on alterne.`, 2, titled('set_price', p)));
    } else if (!open('set_price', pid) && p.price < 49) {
      const lastChange = p.priceHistory.length ? p.priceHistory[p.priceHistory.length - 1]!.day : (p.launchedDay ?? day);
      const sinceChange = productMetrics(w, pid, lastChange);
      const goodRating = p.stats.reviews.length < 3 || p.stats.rating >= 4.2;
      if (sinceChange.sales >= 10 && goodRating && sinceChange.refundRate < 0.08 && day - lastChange >= 5) {
        items.push(planItem('set_price', { productId: pid, reason: 'hausse' }, `${sinceChange.sales} ventes depuis le dernier prix, avis bons : on monte d'un palier.`, 2, titled('set_price', p)));
      }
    }

    const liked = p.stats.reviews.length < 3 || p.stats.rating >= 3.8;
    const profitable = all.sales >= 10 && liked && (m7.spend > 0 ? m7.roas >= 1.5 : m7.sales >= 5);
    if (!upsell && !p.upsellProductId && profitable && !open('design_upsell', pid)) {
      items.push(planItem('design_upsell', { productId: pid }, `Produit rentable (ROAS 7 j ${Number.isFinite(m7.roas) ? dec(m7.roas) : '∞'}, ${all.sales} ventes) : la suite pour le même public.`, 2, titled('design_upsell', p)));
    }
  }

  // 4. Media buying.
  if (activeCampaigns(w).length) items.push(planItem('optimize_ads', {}, budget.survival ? 'Mode survie : on coupe tout ce qui ne rapporte pas.' : 'Stop-loss, scale progressif et créas fatiguées.', 1));

  // 5. Inbox: batches of 6, most urgent first.
  const claimed = claimedMessageIds(w);
  const inbox = openMessages(ctx).filter((m) => !claimed.has(m.id)).sort((a, b) => urgency(b, day) - urgency(a, day) || a.day - b.day);
  for (let i = 0; i < inbox.length && i < 24; i += 6) {
    const batch = inbox.slice(i, i + 6);
    items.push(planItem('reply_inbox', { messageIds: batch.map((m) => m.id) }, `${batch.length} message(s) en attente, réponse sous 24 h.`, batch.some((m) => urgency(m, day) >= 5) ? 1 : 2, `Répondre à ${batch.length} client(s)`));
  }
  // Escalated refund/chargeback threats: refund before it becomes a chargeback (amount + 15 € fees).
  let refunds = 0;
  for (const m of w.market.inbox) {
    if (refunds >= 3 || m.status !== 'escalated' || !m.orderId || claimed.has(m.id)) continue;
    const order = w.market.orders.find((o) => o.id === m.orderId);
    if (!order || order.refunded || order.chargeback) continue;
    if (!['rembours', 'chargeback', 'banque', 'litige'].some((k) => includesCI(`${m.subject} ${m.body}`, k))) continue;
    if (openTasks(w, (t) => t.kind === 'handle_refund' && t.input.orderId === order.id).length) continue;
    items.push(planItem('handle_refund', { orderId: order.id, messageId: m.id, productId: order.productId, reason: 'Client escaladé : on rembourse avant le chargeback' }, 'Un chargeback coûte le montant + 15 € : on rembourse de bonne foi.', 1, `Rembourser ${eur(order.price)} avant chargeback`));
    refunds++;
  }

  // 6. Analysis.
  if (day >= 2) items.push(planItem('daily_report', { day: day - 1 }, 'Raconter la veille en chiffres.', 3, `Rapport du jour ${day - 1}`));
  if (day >= 3 && !open('run_experiment') && (experimentCandidate(ctx) || w.company.experiments.some((e) => e.status === 'running'))) {
    items.push(planItem('run_experiment', {}, 'Transformer les intuitions en tests A/B mesurés.', 3));
  }

  // Focus + memo.
  const fin = sim.financeSnapshot(w);
  const lead = live[0] ?? building[0];
  let focus: string;
  if (w.status === 'bankrupt') focus = 'Trésorerie négative : zéro dépense, support et organique uniquement';
  else if (budget.survival) focus = 'Mode survie : organique, créateurs à la commission, aucune pub non rentable';
  else if (!live.length && !building.length) focus = 'Trouver une niche rentable (règle du un)';
  else if (!live.length && lead) focus = `Sortir « ${short(lead.title, 50)} » : la chaîne de production tourne`;
  else if (live.some((p) => activeCampaigns(w, p.id).length)) focus = fin.roas7d >= 1.5 ? 'Scaler ce qui marche et préparer la suite' : 'Rendre les pubs rentables : couper, tester, itérer';
  else focus = `Lancer l'acquisition de « ${short(live[0]!.title, 50)} »`;
  const memo = [
    `Jour ${day} — trésorerie ${eur(fin.cash)}, profit cumulé ${eur(fin.profit)}, ROAS 7 j ${dec(fin.roas7d)}${fin.runwayDays !== null ? `, runway ${fin.runwayDays} j` : ''}.`,
    `Enveloppe pub ${eur(budget.adCap)}. ${live.length} produit(s) en ligne, ${building.length} en production.`,
    ...notes,
  ].join(' ');
  return { focus, items, memo };
}

// ───────────────────────────── Plan merge & materialization ─────────────────────────────

function itemKey(kind: TaskKind, input: Record<string, unknown>): string {
  return [kind, input.productId, input.nicheId, input.campaignId, input.creatorId, input.orderId, strArr(input.messageIds).join(','), input.slot, input.reason, input.pipeline]
    .map((x) => (x === undefined || x === null ? '' : String(x))).join('|');
}

/** Validates an item coming from the engine (Claude may invent kinds or forget inputs). */
export function normalizeItem(ctx: RuntimeCtx, item: Partial<DayPlanItem> | null | undefined): DayPlanItem | null {
  if (!item || typeof item.kind !== 'string' || !PLAN_KINDS.includes(item.kind as TaskKind)) return null;
  const kind = item.kind as TaskKind;
  const input: Record<string, unknown> = item.input && typeof item.input === 'object' ? { ...item.input } : {};
  if (PRODUCT_KINDS.includes(kind)) {
    const p = productOf(ctx, input.productId);
    if (!p || p.status === 'killed') {
      const focus = focusProduct(ctx);
      if (!focus) return null;
      input.productId = focus.id;
    }
  }
  const priority = item.priority === 1 || item.priority === 2 || item.priority === 3 ? item.priority : 2;
  return { kind, title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : KIND_META[kind].label, dept: KIND_META[kind].dept, priority, input, why: typeof item.why === 'string' ? item.why : '' };
}

/** The product a vague instruction is about: newest live one, else newest in production. */
export function focusProduct(ctx: RuntimeCtx): Product | undefined {
  const ps = ctx.world.company.products;
  return [...ps].reverse().find((p) => p.status === 'live') ?? [...ps].reverse().find((p) => p.status !== 'killed');
}

/** The engine may add or re-prioritize items; heuristic items it omitted are kept (safety: support, stop-loss…). */
export function mergePlans(ctx: RuntimeCtx, heuristic: DayPlan, engine: DayPlan | null): DayPlanItem[] {
  const out = new Map<string, DayPlanItem>();
  for (const raw of engine?.items ?? []) {
    const it = normalizeItem(ctx, raw);
    if (it) out.set(itemKey(it.kind, it.input), it);
  }
  for (const it of heuristic.items) {
    const key = itemKey(it.kind, it.input);
    if (!out.has(key)) out.set(key, it);
  }
  return [...out.values()];
}

export interface MaterializeOpts { createdBy: Task['createdBy']; missionId: string | null; priority?: 1 | 2 | 3; assignee?: string | null }

/** Turns plan items into tasks (dedup against open tasks; pipeline items expand into task graphs). */
export function materialize(ctx: RuntimeCtx, items: DayPlanItem[], opts: MaterializeOpts): Task[] {
  const w = ctx.world;
  const created: Task[] = [];
  for (const it of items) {
    const input = { ...it.input };
    const priority = opts.priority ?? it.priority;
    const product = productOf(ctx, input.productId);
    const pOpts = { createdBy: opts.createdBy, missionId: opts.missionId, priority };
    const pipeline = str(input.pipeline);
    if (pipeline && product && product.status !== 'killed') {
      if (pipeline === 'v2') created.push(...createV2Pipeline(ctx, product, strArr(input.feedback), pOpts));
      else if (pipeline === 'resume') created.push(...resumePipeline(ctx, product, pOpts));
      else if (pipeline === 'full' && !openTasksForProduct(ctx, product.id).length) created.push(...createProductPipeline(ctx, product, pOpts));
      else if (pipeline === 'upsell' && !openTasksForProduct(ctx, product.id).length) created.push(...createUpsellPipeline(ctx, product, pOpts));
      continue;
    }
    const key = itemKey(it.kind, input);
    if (w.company.tasks.some((t) => isOpen(t) && itemKey(t.kind, t.input) === key)) continue;
    if (product) input.nicheId ??= product.nicheId;
    const task = createTask(w, { kind: it.kind, title: it.title, input: { ...input, why: it.why }, priority, createdBy: opts.createdBy, missionId: opts.missionId, assignee: opts.assignee ?? null });
    created.push(task);
    // A requested rewrite of a published guide must reach the files and the store.
    if (it.kind === 'humanize_pdf' && product?.files.pdf) {
      const render = createTask(w, { kind: 'render_pdf', title: titled('render_pdf', product), input: { productId: product.id, nicheId: product.nicheId }, dependsOn: [task.id], priority, createdBy: opts.createdBy, missionId: opts.missionId });
      created.push(render);
      if (product.status === 'live') {
        created.push(createTask(w, { kind: 'publish_product', title: `Remettre en ligne — « ${short(product.title, 42)} »`, input: { productId: product.id, nicheId: product.nicheId, republish: true }, dependsOn: [render.id], priority, createdBy: opts.createdBy, missionId: opts.missionId }));
      }
    }
  }
  return created;
}

// ───────────────────────────── Founder missions ─────────────────────────────

const MISSION_RULES: [RegExp, TaskKind][] = [
  [/nouveau (pdf|guide|produit)|second (pdf|guide|produit)|2e (pdf|guide|produit)|autre niche|nouvelle niche/i, 'pick_opportunity'],
  [/niche|tendance|march[ée]|opportunit/i, 'scan_trends'],
  [/concurren/i, 'scan_competitors'],
  [/douleur|commentaire|voix du client|forum/i, 'mine_pains'],
  [/upsell|la suite/i, 'design_upsell'],
  [/hook|cr[ée]a|pub tiktok|nouvelle pub|vid[ée]o/i, 'write_ad_hooks'],
  [/campagne|budget pub|scale|stop-loss|roas/i, 'optimize_ads'],
  [/organique|poster|post /i, 'post_organic'],
  [/prix|tarif/i, 'set_price'],
  [/page de vente|copywriting/i, 'write_sales_page'],
  [/couverture/i, 'design_cover'],
  [/r[ée][ée]cri|am[ée]liore|qualit[ée]|humanis|v2/i, 'humanize_pdf'],
  [/rembours/i, 'reply_inbox'],
  [/mail|support|message|client/i, 'reply_inbox'],
  [/cr[ée]ateur|influenc|partenari|affili/i, 'find_creators'],
  [/rapport|kpi|chiffres|bilan/i, 'daily_report'],
  [/test|exp[ée]rience|a\/b/i, 'run_experiment'],
  [/red team|critique|tuer|risque/i, 'red_team'],
];

/** Keyword routing when the engine could not interpret a founder mission. */
export function keywordMission(ctx: RuntimeCtx, text: string): DayPlanItem[] {
  const kinds = uniq(MISSION_RULES.filter(([rx]) => rx.test(text)).map(([, k]) => k)).slice(0, 3);
  if (!kinds.length) kinds.push('daily_report');
  const out: DayPlanItem[] = [];
  for (const kind of kinds) {
    const input: Record<string, unknown> = {};
    if (kind === 'scan_trends') input.chain = 'opportunity';
    if (kind === 'write_ad_hooks') { input.produce = 2; input.launch = !activeCampaigns(ctx.world).length; }
    if (kind === 'red_team') input.subject = 'pdf';
    if (kind === 'daily_report') input.day = Math.max(1, ctx.world.day - 1);
    const it = normalizeItem(ctx, { kind, title: `${KIND_META[kind].label} (mission du fondateur)`, dept: KIND_META[kind].dept, priority: 1, input, why: `Mission du fondateur : ${short(text, 80)}` });
    if (it) out.push(it);
  }
  return out;
}

/** Fills the inputs a founder item needs (e.g. a launch needs creatives, a scan feeds a pick). */
export function prepareFounderItem(ctx: RuntimeCtx, it: DayPlanItem): DayPlanItem {
  const input = { ...it.input };
  if (it.kind === 'scan_trends' && input.chain === undefined) input.chain = 'opportunity';
  if (it.kind === 'write_ad_hooks' && input.produce === undefined) input.produce = 2;
  if (it.kind === 'red_team' && input.subject === undefined) input.subject = productOf(ctx, input.productId)?.content ? 'pdf' : 'idea';
  return { ...it, input, priority: 1, title: it.title.includes('fondateur') ? it.title : `${it.title} (mission du fondateur)` };
}

export function describePlan(ctx: RuntimeCtx, plan: DayPlan): string {
  return `${nameOf(ctx, 'camille')} : ${plan.focus}`;
}
