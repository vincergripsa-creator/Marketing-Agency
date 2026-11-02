/**
 * Product pipelines as dependency graphs of tasks (the whole chain is visible on the task board):
 *   full    red_team(idea) → titles → outline → pdf → humanize → fact_check ┐
 *           titles → cover ─────────────────────────────────────────────────┴→ render → red_team(pdf) ┐
 *           titles → price ; render + price → sales page ───────────────────────────────────────────┴→ publish
 *           sales page → hooks → produce_ad ×3 ; publish + ads → launch_campaign
 *   upsell  same without idea red team and ads (sold through « La suite est ici »)
 *   v2      pdf (with feedback) → humanize → fact_check → render → sales page (lower hype) → publish
 *   Red Team on the guide (see redteam.ts): a « fix » adds humanize → render → red_team before the publish, a « kill »
 *   adds outline → pdf → humanize → fact_check → render → sales page + red_team.
 */
import type { AgentId, Campaign, ChannelId, NicheCloseReason, NicheRecord, Product, Task, TaskKind, WorldState } from '../shared.js';
import { channelOf } from '../shared.js';
import { productHealth } from './acquisition.js';
import { creditOf } from './channels.js';
import type { RuntimeCtx } from './ctx.js';
import { incident, latestOutput, nameOf, nicheName, runFileExists, say } from './ctx.js';
import type { GuideGaps } from '../contracts.js';
import { logDecision } from './digest.js';
import { addHold } from './holds.js';
import { officerId } from './org/officers.js';
import { createTask, isOpen, KIND_META, logTask, openTasks, taskChannel, type TaskSpec } from './tasks.js';
import { activeCampaigns, closedWindow, parentOf, PRICE_EVIDENCE_VIEWS, priceTiers, productMetrics } from './metrics.js';
import { sim } from './modules.js';
import { productNote, writePostMortem } from './notes.js';
import { growthOn, policyOf } from './stages.js';
import { unlinkUpsell } from './upsell.js';
import { eur, round2, short, sum } from './util.js';

export interface PipelineOpts { createdBy: Task['createdBy']; missionId: string | null; priority?: 1 | 2 | 3 }

export function productTitleFor(kind: TaskKind, product: Product, extra = ''): string {
  return `${KIND_META[kind].label}${extra} — « ${short(product.title, 42)} »`;
}

function maker(ctx: RuntimeCtx, product: Product, opts: PipelineOpts) {
  return (kind: TaskKind, deps: Task[], input: Record<string, unknown> = {}, spec: Partial<TaskSpec> = {}): Task =>
    createTask(ctx.world, {
      kind,
      title: spec.title ?? productTitleFor(kind, product),
      input: { productId: product.id, nicheId: product.nicheId, ...input },
      dependsOn: deps.map((d) => d.id),
      createdBy: opts.createdBy,
      missionId: opts.missionId,
      priority: opts.priority ?? 2,
      ...spec,
    });
}

export function openTasksForProduct(ctx: RuntimeCtx, productId: string, kinds?: TaskKind[]): Task[] {
  return ctx.world.company.tasks.filter((t) => isOpen(t) && t.input.productId === productId && (!kinds || kinds.includes(t.kind)));
}

export function createProductPipeline(ctx: RuntimeCtx, product: Product, opts: PipelineOpts): Task[] {
  const T = maker(ctx, product, opts);
  const best = reopenNiche(ctx, product);
  const pre: Task[] = [];
  const voc = ctx.world.company.research.voc[product.nicheId];
  if (!voc || voc.depth !== 'deep') pre.push(T('mine_pains', [], { depth: 'deep' }, { title: `Écouter la voix du client (approfondi) — ${short(product.audience, 40)}` }));
  const red = T('red_team', pre, { subject: 'idea' }, { title: `Red Team : essayer de tuer l'idée « ${short(product.title, 40)} »` });
  const titles = T('write_titles', [red]);
  const outline = T('write_outline', [titles]);
  const pdf = T('write_pdf', [outline]);
  const human = T('humanize_pdf', [pdf]);
  const fact = T('fact_check', [human]);
  const cover = T('design_cover', [titles]);
  const price = T('set_price', [titles], best ? { reason: 'memoire', price: best } : { reason: 'initial' });
  const render = T('render_pdf', [fact, cover]);
  const redPdf = T('red_team', [render], { subject: 'pdf', version: product.version, cycle: 0 }, { title: `Red Team : attaquer le guide « ${short(product.title, 40)} »` });
  const sales = T('write_sales_page', [render, price]);
  const publish = T('publish_product', [sales, redPdf]);
  const hooks = T('write_ad_hooks', [sales]);
  const ads = [0, 1, 2].map((variant) => T('produce_ad', [hooks], { variant }, { title: productTitleFor('produce_ad', product, ` n° ${variant + 1}`) }));
  const launch = T('launch_campaign', [publish, ...ads]);
  const all = [...pre, red, titles, outline, pdf, human, fact, cover, price, render, redPdf, sales, publish, hooks, ...ads, launch];
  const ceo = officerId(ctx.world, 'ceo');
  say(ctx, ceo, `${nameOf(ctx, ceo)} lance la chaîne de production de « ${short(product.title, 50)} » (${all.length} tâches)`, 'thought', { productId: product.id });
  return all;
}

export function createUpsellPipeline(ctx: RuntimeCtx, product: Product, opts: PipelineOpts): Task[] {
  const T = maker(ctx, product, opts);
  const titles = T('write_titles', []);
  const outline = T('write_outline', [titles]);
  const pdf = T('write_pdf', [outline]);
  const human = T('humanize_pdf', [pdf]);
  const fact = T('fact_check', [human]);
  const cover = T('design_cover', [titles]);
  const price = T('set_price', [titles], { reason: 'initial' });
  const render = T('render_pdf', [fact, cover]);
  const sales = T('write_sales_page', [render, price]);
  const publish = T('publish_product', [sales]);
  return [titles, outline, pdf, human, fact, cover, price, render, sales, publish];
}

export interface RedTeamRework {
  structural?: boolean;           // rebuild from the plan (a « kill », or a correction that changed nothing)
  review?: boolean;               // no rework left to do: the Red Team only reads the file again
  fixes?: string[];
  gaps?: GuideGaps | null;
  cycle: number;
  previousPrint: string;
  previousVerdict: string;
  missionId: string | null;
  title?: string;
}

/** The rework ordered by the Red Team, ending with its new review; the publish waits for that review. */
export function reworkRedTeam(ctx: RuntimeCtx, product: Product, r: RedTeamRework): Task {
  const T = maker(ctx, product, { createdBy: officerId(ctx.world, 'red_team'), missionId: r.missionId, priority: 1 });
  const fixes = r.fixes ?? [];
  const tag = ` (reprise ${r.cycle})`;
  let last: Task[] = [];
  const extra: Task[] = [];
  if (r.structural) {
    const outline = T('write_outline', [], { rework: true, fixes, revision: r.cycle }, { title: productTitleFor('write_outline', product, tag) });
    const pdf = T('write_pdf', [outline], { rework: true, fixes, revision: r.cycle }, { title: productTitleFor('write_pdf', product, tag) });
    const human = T('humanize_pdf', [pdf], { fixes, ...(r.gaps ? { gaps: r.gaps } : {}) }, { title: productTitleFor('humanize_pdf', product, tag) });
    const fact = T('fact_check', [human], {}, { title: productTitleFor('fact_check', product, tag) });
    const render = T('render_pdf', [fact], {}, { title: productTitleFor('render_pdf', product, tag) });
    extra.push(T('write_sales_page', [render], {}, { title: productTitleFor('write_sales_page', product, tag) }));
    last = [render];
  } else if (!r.review) {
    const human = T('humanize_pdf', [], { fixes, ...(r.gaps ? { gaps: r.gaps } : {}) }, { title: `Corriger le guide après la Red Team${tag} — « ${short(product.title, 40)} »` });
    last = [T('render_pdf', [human], {}, { title: `Remettre en page après corrections${tag} — « ${short(product.title, 40)} »` })];
  }
  const again = T('red_team', last, { subject: 'pdf', version: product.version, cycle: r.cycle, previousPrint: r.previousPrint, previousVerdict: r.previousVerdict }, { title: r.title ?? `Red Team : relire le guide${tag} — « ${short(product.title, 40)} »` });
  for (const t of ctx.world.company.tasks) {
    if (t.kind !== 'publish_product' || t.input.productId !== product.id || t.status !== 'pending') continue;
    t.dependsOn.push(again.id, ...extra.map((e) => e.id));
    logTask(t, `Jour ${ctx.world.day} : attend la nouvelle revue de la Red Team.`);
  }
  return again;
}

/** Rework after customer feedback: version++, rewrite with the feedback, lower the promise, re-publish. */
export function createV2Pipeline(ctx: RuntimeCtx, product: Product, feedback: string[], opts: PipelineOpts): Task[] {
  product.version += 1;
  const v = ` (v${product.version})`;
  const T = maker(ctx, product, opts);
  const pdf = T('write_pdf', [], { rework: true, feedback }, { title: productTitleFor('write_pdf', product, v) });
  const human = T('humanize_pdf', [pdf], {}, { title: productTitleFor('humanize_pdf', product, v) });
  const fact = T('fact_check', [human], {}, { title: productTitleFor('fact_check', product, v) });
  const render = T('render_pdf', [fact], {}, { title: productTitleFor('render_pdf', product, v) });
  const sales = T('write_sales_page', [render], { hypeDelta: -1 }, { title: productTitleFor('write_sales_page', product, v) });
  const publish = T('publish_product', [sales], { republish: true }, { title: `Remettre en ligne${v} — « ${short(product.title, 42)} »` });
  const editor = officerId(ctx.world, 'editor');
  say(ctx, editor, `${nameOf(ctx, editor)} lance la v${product.version} de « ${short(product.title, 50)} » : ${feedback.slice(0, 2).join(' ; ') || 'retours clients'}`, 'thought', { productId: product.id });
  return [pdf, human, fact, render, sales, publish];
}

/** Watchdog: rebuilds the missing stages of a product that is stuck with no open task. */
export function resumePipeline(ctx: RuntimeCtx, product: Product, opts: PipelineOpts): Task[] {
  if (openTasksForProduct(ctx, product.id).length) return [];
  const T = maker(ctx, product, opts);
  const created: Task[] = [];
  const add = (t: Task): Task => { created.push(t); return t; };
  if ((product.status === 'idea' || product.status === 'research') && !latestOutput(ctx.world, 'red_team', product.id)) {
    return createProductPipeline(ctx, product, opts);
  }
  let contentDeps: Task[] = [];
  if (!product.content) {
    const hasTitles = !!latestOutput(ctx.world, 'write_titles', product.id);
    const titles = hasTitles ? null : add(T('write_titles', []));
    const outline = latestOutput(ctx.world, 'write_outline', product.id) ? null : add(T('write_outline', titles ? [titles] : []));
    const pdf = add(T('write_pdf', [outline ?? titles].filter((x): x is Task => !!x)));
    const human = add(T('humanize_pdf', [pdf]));
    contentDeps = [add(T('fact_check', [human]))];
  }
  const coverDeps: Task[] = [];
  if (!product.design || !runFileExists(ctx, product.files.cover)) coverDeps.push(add(T('design_cover', [])));
  let renderDeps: Task[] = [];
  if (!runFileExists(ctx, product.files.pdf) || contentDeps.length) renderDeps = [add(T('render_pdf', [...contentDeps, ...coverDeps]))];
  else renderDeps = coverDeps;
  const priceDeps: Task[] = product.price > 0 ? [] : [add(T('set_price', [], { reason: 'initial' }))];
  let salesDeps: Task[] = [];
  if (!product.salesPage || !runFileExists(ctx, product.files.salesPage) || renderDeps.length) salesDeps = [add(T('write_sales_page', [...renderDeps, ...priceDeps]))];
  else salesDeps = priceDeps;
  if (product.status !== 'live') add(T('publish_product', salesDeps));
  const chief = officerId(ctx.world, 'chief_of_staff');
  if (created.length) say(ctx, chief, `${nameOf(ctx, chief)} relance la chaîne bloquée de « ${short(product.title, 50)} » (${created.length} tâches)`, 'thought', { productId: product.id });
  return created;
}

/** Cancels one open task: nobody works on it, nobody is asked about it. */
export function dropTask(ctx: RuntimeCtx, t: Task, reason: string): void {
  t.status = 'cancelled';
  t.dayDone = ctx.world.day;
  logTask(t, `Jour ${ctx.world.day} : annulée — ${reason}`);
  const pa = ctx.world.company.pendingApprovals.indexOf(t.id);
  if (pa >= 0) ctx.world.company.pendingApprovals.splice(pa, 1);
  const agent = ctx.world.company.agents.find((a) => a.currentTaskId === t.id);
  if (agent) { agent.currentTaskId = null; agent.status = 'idle'; agent.bubble = null; }
}

/** Cancels every open task of a product (cascade-safe). */
export function cancelProductTasks(ctx: RuntimeCtx, productId: string, reason: string, kinds?: TaskKind[]): number {
  const open = openTasksForProduct(ctx, productId, kinds);
  for (const t of open) dropTask(ctx, t, reason);
  return open.length;
}

/** Task kinds that promote a product: cancelled when it is paused for quality. */
const PROMOTION_TASKS: TaskKind[] = ['post_organic', 'write_ad_hooks', 'produce_ad', 'launch_campaign', 'find_creators', 'negotiate_deal'];
/** Task kinds that lead to paid ads: cancelled when the founder stops them. */
export const PAID_AD_TASKS: TaskKind[] = ['write_ad_hooks', 'produce_ad', 'launch_campaign', 'adapt_creative', 'write_search_ads', 'open_channel'];

/**
 * The founder stops paid ads, on one product or on all of them, on one channel or on all of them: running campaigns pause
 * until the founder lifts it (a campaign off for an outage stays off), and the work leading to a launch stops. Organic posts go on.
 */
export function stopPaidAds(ctx: RuntimeCtx, productId: string | null, reason: string, channel: ChannelId | null = null, spared: readonly Campaign[] = []): { paused: number; cancelled: number } {
  const w = ctx.world;
  let paused = 0;
  for (const c of w.company.campaigns) {
    if ((productId && c.productId !== productId) || (channel && channelOf(c) !== channel) || spared.some((s) => s.id === c.id)) continue;
    if (c.status === 'active') {
      try { ctx.tools.updateCampaign(c.id, { status: 'paused' }); } catch { /* ignore */ }
      c.status = 'paused';
      c.pausedFor = 'founder';
      paused++;
    } else if (c.pausedFor === 'outage') c.pausedFor = 'founder';
  }
  const tasks = openTasks(w, (t) => PAID_AD_TASKS.includes(t.kind) && (!productId || t.input.productId === productId) && (!channel || taskChannel(t) === channel));
  for (const t of tasks) dropTask(ctx, t, reason);
  return { paused, cancelled: tasks.length };
}

/**
 * The founder takes a product off the shelf: off sale, out of production, nobody reworks it until the founder says so.
 * The missions that were waiting for it end here: it will not ship by itself.
 */
export function shelveProduct(ctx: RuntimeCtx, product: Product, reason: string, by: AgentId = officerId(ctx.world, 'ceo')): number {
  const w = ctx.world;
  if (product.status === 'killed') return 0;
  if (product.status === 'live') {
    try { ctx.tools.setProductStatus(product.id, 'paused'); } catch { /* the runtime status below is authoritative */ }
  }
  product.status = 'paused';
  product.decision = { day: w.day, status: 'paused', reason };
  stopPaidAds(ctx, product.id, reason);
  const cancelled = cancelProductTasks(ctx, product.id, reason);
  addHold(w, { kind: 'product', productId: product.id, until: null, reason });
  closeProductMissions(ctx, product, reason);
  say(ctx, by, `${nameOf(ctx, by)} met « ${short(product.title, 50)} » de côté : ${reason}${cancelled ? ` (${cancelled} tâche(s) annulée(s))` : ''}`, 'thought', { productId: product.id });
  incident(ctx, `Produit « ${product.title} » mis de côté : ${reason}`);
  return cancelled;
}

/** The founder missions still waiting for this product fail: it was stopped, not delivered. */
export function closeProductMissions(ctx: RuntimeCtx, product: Product, reason: string): void {
  for (const m of ctx.world.company.missions) {
    if (m.from !== 'founder' || m.status !== 'open' || !m.wantsProduct || !(m.productId === product.id || m.nicheId === product.nicheId)) continue;
    m.status = 'failed';
    m.outcome = `« ${product.title} » ne sortira pas : ${reason}.`;
  }
}

/**
 * CEO decision: take a product off sale until its next version is ready (bad rating / refunds).
 * The store stops selling it, its campaigns are paused and the tasks that promote it are cancelled.
 */
export async function pauseProduct(ctx: RuntimeCtx, product: Product, reason: string, by: AgentId = officerId(ctx.world, 'ceo')): Promise<void> {
  if (product.status !== 'live') return;
  try { ctx.tools.setProductStatus(product.id, 'paused'); } catch { /* the runtime status below is authoritative */ }
  product.status = 'paused';
  for (const c of activeCampaigns(ctx.world, product.id)) {
    try { ctx.tools.updateCampaign(c.id, { status: 'paused' }); } catch { /* ignore */ }
    c.status = 'paused';
  }
  product.decision = { day: ctx.world.day, status: 'paused', reason };
  const promotion = openTasksForProduct(ctx, product.id, PROMOTION_TASKS);
  for (const t of promotion) dropTask(ctx, t, `produit mis en pause (${reason})`);
  const cancelled = promotion.length;
  say(ctx, by, `${nameOf(ctx, by)} retire « ${short(product.title, 50)} » de la vente : ${reason} — on ne le pousse plus avant la v${product.version + 1}${cancelled ? ` (${cancelled} tâche(s) de promotion annulée(s))` : ''}`, 'thought', { productId: product.id });
  incident(ctx, `Produit « ${product.title} » mis en pause pour qualité : ${reason}`);
  try {
    await productNote(ctx, product, by, 'Mise en pause qualité', `- ${reason}\n- Plus de pub ni de post tant que la v${product.version + 1} n'est pas en ligne.`);
  } catch { /* the brain is best-effort */ }
}

/** Ads off, for as long as it takes. A campaign the founder forced stays: their word beats the plan. */
export function stopAds(ctx: RuntimeCtx, product: Product): number {
  const running = activeCampaigns(ctx.world, product.id).filter((c) => !c.founderForced);
  for (const c of running) {
    try { ctx.tools.updateCampaign(c.id, { status: 'paused' }); } catch { /* ignore */ }
    c.status = 'paused';
  }
  return running.length;
}

/**
 * CEO decision: a paid loser its buyers like stops costing and goes on selling. No ads, no creatives, one organic slot a week: it
 * frees a main's slot and keeps its niche. Its price and version are noted: its one paid test waits for either to move (scale §5.2).
 */
export function harvestProduct(ctx: RuntimeCtx, product: Product, why: string, by: AgentId = officerId(ctx.world, 'ceo')): void {
  stopAds(ctx, product);
  const cancelled = cancelProductTasks(ctx, product.id, 'produit en récolte', PAID_AD_TASKS);
  const retest = product.harvest?.retest ?? null;
  product.harvest = { day: ctx.world.day, price: product.price, version: product.version, retest: retest && { ...retest, open: false } };
  say(ctx, by, `${nameOf(ctx, by)} passe « ${short(product.title, 50)} » en récolte : ${why}${cancelled ? ` (${cancelled} tâche(s) pub annulée(s))` : ''}`, 'thought', { productId: product.id });
}

/** CEO decision: stop a product, pause its ads, write the post-mortem. */
export async function killProduct(ctx: RuntimeCtx, product: Product, reason: string, by: AgentId = officerId(ctx.world, 'ceo'), impactEur?: number): Promise<void> {
  if (product.status === 'killed') return;
  const wasPublished = product.launchedDay !== null;
  closeNiche(ctx.world, product);
  product.status = 'killed';
  product.decision = { day: ctx.world.day, status: 'killed', reason };
  if (wasPublished) {
    try { ctx.tools.setProductStatus(product.id, 'killed'); } catch { /* store may already have removed it */ }
  }
  for (const c of activeCampaigns(ctx.world, product.id)) {
    try { ctx.tools.updateCampaign(c.id, { status: 'paused' }); } catch { /* ignore */ }
    c.status = 'paused';
  }
  const cancelled = cancelProductTasks(ctx, product.id, 'produit arrêté');
  if (wasPublished) unlinkUpsell(ctx, product);
  say(ctx, by, `${nameOf(ctx, by)} arrête « ${short(product.title, 50)} » : ${reason}${cancelled ? ` (${cancelled} tâches annulées)` : ''}`, 'thought', { productId: product.id });
  incident(ctx, `Produit « ${product.title} » arrêté : ${reason}`);
  if (growthOn(ctx.world)) logDecision(ctx.world, { kind: 'kill', who: by, text: `« ${short(product.title, 60)} » arrêté`, why: reason, productId: product.id, ...(impactEur === undefined ? {} : { impactEur }) });
  await writePostMortem(ctx, product, reason, by);
}

// ───────────────────────────── what the portfolio reads of a guide ─────────────────────────────

/** Buyers like a guide at this rating and under this refund rate: over the line a paid loser is harvested, under it it stops. */
const HAPPY_RATING = 3.2;
const HAPPY_REFUNDS = 0.2;
/** Reviews it takes before a low rating is the buyers' verdict. */
const DISLIKED_REVIEWS = 3;

/** Ad euros a product took from `from` on. The rows reach back 90 days: a guide off the ads for longer reads 0 here, what a test paid stays in `Product.paidRead`. */
export function paidOn(w: WorldState, productId: string, from: number): number {
  return round2(sum(w.market.adStats.filter((s) => s.productId === productId && s.day >= from).map((s) => s.spend)));
}

/** Reconciled ROAS of a product over the last `days` closed days, each row at its channel's credit, announced outages out. Null without spend. */
export function roasOver(w: WorldState, p: Product, days: number): number | null {
  const { fromDay, toDay } = closedWindow(w, days);
  const outage = sim.announcedOutageDays(w);
  let spend = 0, revenue = 0;
  for (const s of w.market.adStats) {
    if (s.productId !== p.id || s.day < fromDay || s.day > toDay || outage.includes(s.day)) continue;
    spend += s.spend;
    revenue += s.revenue * creditOf(w, channelOf(s), p.nicheId);
  }
  return spend > 0 ? revenue / spend : null;
}

/** What buyers say of the current version: the store's rating until it has reviews of its own, refunds over 28 days. */
export function buyersRead(w: WorldState, p: Product): { rating: number; reviews: number; refundRate: number } {
  const h = productHealth(w, p);
  return { rating: h.rating || p.stats.rating, reviews: h.reviews.length, refundRate: productMetrics(w, p.id, closedWindow(w, 28).fromDay).refundRate };
}

/** Rule 12 of the guardrails: a guide its buyers like loses its ads, not its place on sale. */
export const buyersLike = (read: { rating: number; refundRate: number }): boolean => read.rating >= HAPPY_RATING && read.refundRate <= HAPPY_REFUNDS;

// ───────────────────────────── niches: closed for a while, not for ever ─────────────────────────────

/** Days a niche stays closed, by what ended the attempt (scale §5.3). A market or Red Team end also counts a strike. */
export const NICHE_REOPEN_DAYS: Record<NicheCloseReason, number> = { no_test: 14, quality: 30, market: 60, redteam: 90 };
const STRIKES: readonly NicheCloseReason[] = ['market', 'redteam'];
/** At this many strikes a niche waits this long for its last attempt. After that one it stays closed. */
export const NICHE_LAST_STRIKES = 2;
export const NICHE_LAST_DAYS = 180;

const CLOSE_LABELS: Record<NicheCloseReason, string> = { no_test: 'arrêt sans test payant', quality: 'acheteurs déçus', market: 'test payant perdu', redteam: 'refus de la Red Team' };

/** What a niche keeps of a guide: its best fortnight, and the price that earned most per paid visitor. */
export function learnNiche(w: WorldState, p: Product): NicheRecord | null {
  const niches = w.company.growth?.niches;
  if (!niches) return null;
  const rec = (niches[p.nicheId] ??= { nicheId: p.nicheId, attempts: 0, paidEur: 0, strikes: 0, lastEndDay: null, lastReason: null, reopenDay: null, bestRoas14: null, bestPrice: null });
  const roas = roasOver(w, p, 14);
  if (roas !== null) rec.bestRoas14 = round2(Math.max(rec.bestRoas14 ?? 0, roas));
  const measured = priceTiers(w, p).filter((t) => t.views >= PRICE_EVIDENCE_VIEWS);
  if (measured.length) rec.bestPrice = measured.reduce((a, b) => (b.rpv > a.rpv ? b : a)).price;
  return rec;
}

/** All a guide took in ads: the rows that are left, or what a Monday read before they went. */
const paidEver = (w: WorldState, p: Product): number => Math.max(paidOn(w, p.id, 1), p.paidRead?.eur ?? 0);

/** What ended the attempt: the Red Team's word first, then the buyers', then the money. */
function closeReason(w: WorldState, p: Product): NicheCloseReason {
  if (latestOutput(w, 'red_team', p.id)?.finalVerdict === 'kill') return 'redteam';
  const { rating, reviews, refundRate } = buyersRead(w, p);
  if (productHealth(w, p).severe || (reviews >= DISLIKED_REVIEWS && rating > 0 && rating < HAPPY_RATING) || refundRate > HAPPY_REFUNDS) return 'quality';
  return paidEver(w, p) >= policyOf(w).paidTestEur ? 'market' : 'no_test';
}

/** A guide stops, its niche waits. A follow-up or a kit ends nothing: the niche is its parent's to close. */
function closeNiche(w: WorldState, p: Product): void {
  if (!growthOn(w) || p.kind === 'kit' || parentOf(w, p.id)) return;
  const rec = learnNiche(w, p);
  if (!rec) return;
  const reason = closeReason(w, p);
  const lastAttempt = rec.strikes >= NICHE_LAST_STRIKES;
  if (STRIKES.includes(reason)) rec.strikes += 1;
  rec.attempts += 1;
  rec.paidEur = round2(rec.paidEur + paidEver(w, p));
  rec.lastEndDay = w.day;
  rec.lastReason = reason;
  rec.reopenDay = lastAttempt ? null : w.day + (rec.strikes >= NICHE_LAST_STRIKES ? NICHE_LAST_DAYS : NICHE_REOPEN_DAYS[reason]);
}

/** A new guide in a niche that closed once: the log says so, and the best price it measured comes along. Its research and bandits never left. */
function reopenNiche(ctx: RuntimeCtx, product: Product): number | null {
  const w = ctx.world;
  const growth = growthOn(w) ? w.company.growth : undefined;
  const rec = growth?.niches[product.nicheId];
  if (!growth || !rec || rec.lastEndDay === null) return null;
  if (!growth.decisions.some((d) => d.kind === 'reopen' && d.productId === product.id)) {
    logDecision(w, {
      kind: 'reopen', who: officerId(w, 'ceo'), text: `La niche « ${short(nicheName(ctx, product.nicheId), 60)} » rouvre`, productId: product.id,
      why: `fermée le jour ${rec.lastEndDay} (${CLOSE_LABELS[rec.lastReason!]}), ${rec.attempts} essai(s), ${eur(rec.paidEur)} de pub, ${rec.strikes} avertissement(s)${rec.bestPrice ? `, meilleur prix mesuré ${eur(rec.bestPrice)}` : ''}`,
    });
  }
  return rec.bestPrice;
}

const nicheClosed = (rec: NicheRecord, day: number): boolean => rec.lastEndDay !== null && (rec.reopenDay === null || day < rec.reopenDay);

/**
 * Niches the team may not pick today: what it already works on, and what closed and has not reopened. Under growth a stop is a wait,
 * by what ended the attempt. In the control a kill is for ever, and so is a kill that left no record.
 */
export function closedNiches(ctx: RuntimeCtx, opts: { includeActive: boolean }): string[] {
  const w = ctx.world;
  const records = growthOn(w) ? w.company.growth?.niches : undefined;
  const out = new Set<string>();
  for (const p of w.company.products) {
    if (p.status === 'killed' ? !records?.[p.nicheId] : opts.includeActive) out.add(p.nicheId);
  }
  for (const rec of Object.values(records ?? {})) if (nicheClosed(rec, w.day)) out.add(rec.nicheId);
  return [...out];
}

/** The name its readers know it by. */
export { closedNiches as excludedNiches };
