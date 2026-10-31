/**
 * The company's side of the list (scale §6.2, §6.3): which guide gets a lead magnet, a kit and a welcome sequence, what goes
 * to the list this week, and what the founder said about it. The list itself is the market's: the company reads it through
 * `listStats`. Under `growthOn` only: the control has no list.
 */
import type { DayPlanItem, Rng } from '../contracts.js';
import { streamRng } from '../core/index.js';
import { hashString } from '../core/ids.js';
import { kitSheets } from '../deliverables/kit.js';
import { kitPrice } from '../sim/growth.js';
import type { AudienceView, FounderHold, Product, Task, TaskKind, WorldState } from '../shared.js';
import { productHealth } from './acquisition.js';
import type { RuntimeCtx } from './ctx.js';
import { nicheBriefOf, productOf, speak } from './ctx.js';
import { activeHolds, addHold, launchHold, productHold, REFUSAL_COOLDOWN_DAYS } from './holds.js';
import { isUpsellProduct } from './metrics.js';
import { learning } from './modules.js';
import { officerId, ownersOfAny } from './org/officers.js';
import { killProduct } from './pipeline.js';
import { growthOn, policyOf } from './stages.js';
import { createTask, KIND_META, openTasks } from './tasks.js';
import { clamp, short, sum } from './util.js';

export const AUDIENCE = {
  minList: 200,        // subscribers before a niche gets its weekly mail
  sendGapDays: 7,      // one mail a week per niche
  pitchGapDays: 21,    // a guide comes back to its list after three weeks
  openRef: 0.5,        // an open rate worth a full reward to the bandit
} as const;

/** What a mail may lead with. The bandit of each niche picks, its open rate answers. */
export const EMAIL_ANGLES: readonly string[] = ['erreur', 'astuce', 'histoire', 'objection'];

/** The angle of a launch: a fixed one, it teaches the bandit nothing. */
export const LAUNCH_ANGLE = 'lancement';

/** Email decisions, on a stream of their own: what the list reads moves no other draw (§2.6). */
const EMAIL_STREAM = 0xe3a11;

const EMAIL_KINDS: readonly TaskKind[] = ['write_lead_magnet', 'write_email_sequence', 'send_broadcast'];

export const angleDimension = (nicheId: string): string => `email_angle:${nicheId}`;

export function angleRng(w: WorldState, nicheId: string): Rng {
  return streamRng(w.scenario.seed, EMAIL_STREAM, w.day, w.tick, hashString(nicheId));
}

/** The founder's word on this guide's mails: on all of them, or on this one. A guide he took off the shelf is not pitched either. */
export function emailsHold(w: WorldState, productId: string): FounderHold | null {
  return activeHolds(w).find((h) => h.kind === 'emails' && (h.productId === null || h.productId === productId)) ?? productHold(w, productId);
}

/** Why no mail may speak of this guide today, or null. */
export function emailBlock(w: WorldState, p: Product): string | null {
  if (p.status !== 'live') return 'le guide n’est pas en vente';
  return emailsHold(w, p.id)?.reason ?? null;
}

/**
 * The last day this guide went out to a list, inside the three weeks that count: past them every guide has rested as much.
 * Compaction keeps at least that many days of tasks, so it cannot change the answer.
 */
function lastPitch(w: WorldState, productId: string): number {
  return Math.max(w.day - AUDIENCE.pitchGapDays, ...w.company.tasks.filter((t) => t.kind === 'send_broadcast' && t.status === 'done' && t.input.productId === productId).map((t) => t.dayDone ?? 0));
}

const dueAt = (p: Product, minSales: number | null): boolean => minSales !== null && p.stats.sales >= minSales;

function planItem(kind: TaskKind, p: Product, input: Record<string, unknown>, why: string, priority: 1 | 2 | 3 = 2): DayPlanItem {
  return { kind, title: `${KIND_META[kind].label} — « ${short(p.title, 42)} »`, dept: KIND_META[kind].dept, priority, input: { productId: p.id, nicheId: p.nicheId, ...input }, why };
}

const sendable = (w: WorldState, p: Product): boolean => !emailBlock(w, p) && !productHealth(w, p).severe;

/** A task nobody on this team can take would wait for ever: the legacy roster owns none of the list's kinds. */
const staffed = (w: WorldState, kind: TaskKind): boolean => ownersOfAny(w, [kind]).length > 0;

/** The niche's welcome sequence follows a guide on sale: one lost goes to the next guide of the niche with a magnet. */
function planSequences(ctx: RuntimeCtx, view: AudienceView, mains: readonly Product[], items: DayPlanItem[]): void {
  const w = ctx.world;
  if (!staffed(w, 'write_email_sequence')) return;
  const covered = new Set(view.sequences.filter((s) => s.status === 'active' && productOf(ctx, s.productId)?.status === 'live').map((s) => s.nicheId));
  for (const p of mains) {
    if (!p.leadMagnet || covered.has(p.nicheId) || !sendable(w, p)) continue;
    covered.add(p.nicheId);
    if (openTasks(w, (t) => t.kind === 'write_email_sequence' && t.input.nicheId === p.nicheId).length) continue;
    items.push(planItem('write_email_sequence', p, {}, 'Un aimant sans séquence, ce sont des adresses qui refroidissent : on accueille les nouveaux inscrits.'));
  }
}

/** One mail a week per niche with a real list, about a guide it has not heard of for three weeks: the one that has rested longest, then the best rated. */
function planBroadcasts(ctx: RuntimeCtx, view: AudienceView, items: DayPlanItem[]): void {
  const w = ctx.world;
  if (!staffed(w, 'send_broadcast')) return;
  for (const { nicheId, size } of view.byNiche) {
    if (size < AUDIENCE.minList || openTasks(w, (t) => t.kind === 'send_broadcast' && t.input.nicheId === nicheId).length) continue;
    const niche = w.company.products.filter((p) => p.nicheId === nicheId && p.kind !== 'kit');
    if (w.day - Math.max(...niche.map((p) => lastPitch(w, p.id))) < AUDIENCE.sendGapDays) continue;
    const rested = niche.filter((p) => sendable(w, p) && w.day - lastPitch(w, p.id) >= AUDIENCE.pitchGapDays);
    const pick = [...rested].sort((a, b) => lastPitch(w, a.id) - lastPitch(w, b.id) || b.stats.rating - a.stats.rating || a.id.localeCompare(b.id))[0];
    if (pick) items.push(planItem('send_broadcast', pick, { audience: 'niche' }, `${size} abonnés sur cette niche : le rendez-vous de la semaine.`, 3));
  }
}

/** Morning plan of the list (scale §6.2). The kinds it asks for stay out of `PLAN_KINDS`: nobody but this plan orders them. */
export function planAudience(ctx: RuntimeCtx, items: DayPlanItem[], notes: string[]): void {
  const w = ctx.world;
  if (!growthOn(w)) return;
  const { magnetMinSales, bumpMinSales } = policyOf(w);
  const open = (kind: TaskKind, productId: string): boolean => openTasks(w, (t) => t.kind === kind && t.input.productId === productId).length > 0;
  const mains = w.company.products.filter((p) => p.status === 'live' && !isUpsellProduct(w, p.id));
  for (const p of mains) {
    if (!p.content || productHold(w, p.id)) continue;
    if (!p.leadMagnet && dueAt(p, magnetMinSales) && sendable(w, p) && staffed(w, 'write_lead_magnet') && !open('write_lead_magnet', p.id)) {
      items.push(planItem('write_lead_magnet', p, {}, `${p.stats.sales} ventes : assez de preuve pour offrir un guide en échange d'une adresse.`));
      notes.push(`Aimant à prospects pour « ${short(p.title, 40)} ».`);
    }
    if (!p.bumpProductId && dueAt(p, bumpMinSales) && !launchHold(w) && kitSheets(p.content).length && staffed(w, 'design_bump') && !open('design_bump', p.id)) {
      items.push(planItem('design_bump', p, {}, `${p.stats.sales} ventes : ses fiches méritent un kit à imprimer à la commande.`));
      notes.push(`Kit à imprimer pour « ${short(p.title, 40)} ».`);
    }
  }
  const view = ctx.tools.listStats();
  planSequences(ctx, view, mains, items);
  planBroadcasts(ctx, view, items);
}

/** A kit follows its guide's price, and buyers who dislike it get no rewrite, whatever became of its guide: `write_pdf` writes guides, so it leaves the shop. */
async function tendKits(ctx: RuntimeCtx): Promise<void> {
  const w = ctx.world;
  for (const kit of w.company.products.filter((p) => p.kind === 'kit' && p.status === 'live')) {
    const severe = productHealth(w, kit).severe;
    const parent = w.company.products.find((p) => p.bumpProductId === kit.id);
    if (severe) await killProduct(ctx, kit, `kit retiré de la vente : ${severe}`, officerId(w, 'shop'));
    else if (parent?.status === 'live' && kit.price !== kitPrice(parent.price)) ctx.tools.setPrice(kit.id, kitPrice(parent.price));
  }
}

/** The list's morning, under the growth pillar: `buildHeuristicPlan` is another package's, and what is asked here is asked of no one else. */
export async function audienceMorning(ctx: RuntimeCtx): Promise<void> {
  const w = ctx.world;
  await tendKits(ctx);
  const items: DayPlanItem[] = [];
  const notes: string[] = [];
  planAudience(ctx, items, notes);
  for (const it of items) createTask(w, { kind: it.kind, title: it.title, input: { ...it.input, why: it.why }, priority: it.priority, createdBy: officerId(w, 'ceo') });
  if (notes.length) speak(ctx, 'ceo', notes.join(' '), 'thought');
}

/** A new guide goes to whoever may want it: its niche's list, and the buyers of its category (`publish_product` closes before it reaches the shop). */
export function queueLaunch(ctx: RuntimeCtx, task: Task): void {
  const w = ctx.world;
  const product = productOf(ctx, task.input.productId);
  if (!growthOn(w) || !product || product.kind === 'kit' || product.launchedDay !== null || task.input.republish === true || emailsHold(w, product.id) || !staffed(w, 'send_broadcast')) return;
  const { category } = nicheBriefOf(ctx, product.nicheId);
  const reached = sum(ctx.tools.listStats().byNiche.filter((n) => n.nicheId === product.nicheId || nicheBriefOf(ctx, n.nicheId).category === category).map((n) => n.size));
  if (reached <= 0) return;
  createTask(w, { kind: 'send_broadcast', title: `Annoncer « ${short(product.title, 42)} » à la liste`, input: { productId: product.id, nicheId: product.nicheId, audience: 'launch' }, createdBy: officerId(w, 'shop'), missionId: task.missionId });
}

/** What today's close says of the angles: open rates as the mailing tool reports them. */
export function rewardAngles(ctx: RuntimeCtx): void {
  const w = ctx.world;
  for (const b of ctx.tools.listStats().recent) {
    if (b.status !== 'sent' || b.day !== w.day || b.delivered <= 0 || !EMAIL_ANGLES.includes(b.angle)) continue;
    learning.rewardArm(w, angleDimension(b.nicheId), b.angle, clamp(b.opens / b.delivered / AUDIENCE.openRef, 0, 1));
  }
}

/** A refusal stays on the guide, like the others: nobody asks the same thing tomorrow (D49). */
export function refuseEmail(ctx: RuntimeCtx, task: Task): void {
  if (!EMAIL_KINDS.includes(task.kind)) return;
  const w = ctx.world;
  const product = productOf(ctx, task.input.productId);
  const until = w.day + REFUSAL_COOLDOWN_DAYS;
  addHold(w, { kind: 'emails', productId: product?.id ?? null, until, reason: `le fondateur a refusé cet e-mail le jour ${w.day} (nouvelle demande après le jour ${until})` });
  speak(ctx, 'shop', `compris, rien à la liste sur ${product ? `« ${short(product.title, 60)} »` : 'ce sujet'} jusqu'au jour ${until}, sauf si tu changes d'avis.`, 'founder', product ? { productId: product.id } : undefined);
}
