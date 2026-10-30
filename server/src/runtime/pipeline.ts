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
import type { AgentId, Product, Task, TaskKind } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { incident, latestOutput, nameOf, runFileExists, say } from './ctx.js';
import type { GuideGaps } from '../contracts.js';
import { createTask, isOpen, KIND_META, logTask, type TaskSpec } from './tasks.js';
import { activeCampaigns } from './metrics.js';
import { productNote, writePostMortem } from './notes.js';
import { unlinkUpsell } from './upsell.js';
import { short } from './util.js';

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
  const price = T('set_price', [titles], { reason: 'initial' });
  const render = T('render_pdf', [fact, cover]);
  const redPdf = T('red_team', [render], { subject: 'pdf', version: product.version, cycle: 0 }, { title: `Red Team : attaquer le guide « ${short(product.title, 40)} »` });
  const sales = T('write_sales_page', [render, price]);
  const publish = T('publish_product', [sales, redPdf]);
  const hooks = T('write_ad_hooks', [sales]);
  const ads = [0, 1, 2].map((variant) => T('produce_ad', [hooks], { variant }, { title: productTitleFor('produce_ad', product, ` n° ${variant + 1}`) }));
  const launch = T('launch_campaign', [publish, ...ads]);
  const all = [...pre, red, titles, outline, pdf, human, fact, cover, price, render, redPdf, sales, publish, hooks, ...ads, launch];
  say(ctx, 'camille', `Camille lance la chaîne de production de « ${short(product.title, 50)} » (${all.length} tâches)`, 'thought', { productId: product.id });
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
  const T = maker(ctx, product, { createdBy: 'axel', missionId: r.missionId, priority: 1 });
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
  say(ctx, 'elise', `Élise lance la v${product.version} de « ${short(product.title, 50)} » : ${feedback.slice(0, 2).join(' ; ') || 'retours clients'}`, 'thought', { productId: product.id });
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
  if (created.length) say(ctx, 'hugo', `Hugo relance la chaîne bloquée de « ${short(product.title, 50)} » (${created.length} tâches)`, 'thought', { productId: product.id });
  return created;
}

/** Cancels every open task of a product (cascade-safe). */
export function cancelProductTasks(ctx: RuntimeCtx, productId: string, reason: string): number {
  let n = 0;
  for (const t of ctx.world.company.tasks) {
    if (!isOpen(t) || t.input.productId !== productId) continue;
    t.status = 'cancelled';
    t.dayDone = ctx.world.day;
    logTask(t, `Jour ${ctx.world.day} : annulée — ${reason}`);
    const pa = ctx.world.company.pendingApprovals.indexOf(t.id);
    if (pa >= 0) ctx.world.company.pendingApprovals.splice(pa, 1);
    const agent = ctx.world.company.agents.find((a) => a.currentTaskId === t.id);
    if (agent) { agent.currentTaskId = null; agent.status = 'idle'; agent.bubble = null; }
    n++;
  }
  return n;
}

/** Task kinds that promote a product: cancelled when it is paused for quality. */
const PROMOTION_TASKS: TaskKind[] = ['post_organic', 'write_ad_hooks', 'produce_ad', 'launch_campaign', 'find_creators', 'negotiate_deal'];

/**
 * CEO decision: take a product off sale until its next version is ready (bad rating / refunds).
 * The store stops selling it, its campaigns are paused and the tasks that promote it are cancelled.
 */
export async function pauseProduct(ctx: RuntimeCtx, product: Product, reason: string, by: AgentId = 'camille'): Promise<void> {
  if (product.status !== 'live') return;
  try { ctx.tools.setProductStatus(product.id, 'paused'); } catch { /* the runtime status below is authoritative */ }
  product.status = 'paused';
  for (const c of activeCampaigns(ctx.world, product.id)) {
    try { ctx.tools.updateCampaign(c.id, { status: 'paused' }); } catch { /* ignore */ }
    c.status = 'paused';
  }
  let cancelled = 0;
  for (const t of ctx.world.company.tasks) {
    if (!isOpen(t) || t.input.productId !== product.id || !PROMOTION_TASKS.includes(t.kind)) continue;
    t.status = 'cancelled';
    t.dayDone = ctx.world.day;
    logTask(t, `Jour ${ctx.world.day} : annulée — produit mis en pause (${reason})`);
    const pa = ctx.world.company.pendingApprovals.indexOf(t.id);
    if (pa >= 0) ctx.world.company.pendingApprovals.splice(pa, 1);
    const agent = ctx.world.company.agents.find((a) => a.currentTaskId === t.id);
    if (agent) { agent.currentTaskId = null; agent.status = 'idle'; agent.bubble = null; }
    cancelled++;
  }
  say(ctx, by, `${nameOf(ctx, by)} retire « ${short(product.title, 50)} » de la vente : ${reason} — on ne le pousse plus avant la v${product.version + 1}${cancelled ? ` (${cancelled} tâche(s) de promotion annulée(s))` : ''}`, 'thought', { productId: product.id });
  incident(ctx, `Produit « ${product.title} » mis en pause pour qualité : ${reason}`);
  try {
    await productNote(ctx, product, by, 'Mise en pause qualité', `- ${reason}\n- Plus de pub ni de post tant que la v${product.version + 1} n'est pas en ligne.`);
  } catch { /* the brain is best-effort */ }
}

/** CEO decision: stop a product, pause its ads, write the post-mortem. */
export async function killProduct(ctx: RuntimeCtx, product: Product, reason: string, by: AgentId = 'camille'): Promise<void> {
  if (product.status === 'killed') return;
  const wasPublished = product.launchedDay !== null;
  product.status = 'killed';
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
  await writePostMortem(ctx, product, reason, by);
}

/** Niches we must not pick again (killed products) or already work on. */
export function excludedNiches(ctx: RuntimeCtx, opts: { includeActive: boolean }): string[] {
  const out = new Set<string>();
  for (const p of ctx.world.company.products) {
    if (p.status === 'killed') out.add(p.nicheId);
    else if (opts.includeActive) out.add(p.nicheId);
  }
  return [...out];
}
