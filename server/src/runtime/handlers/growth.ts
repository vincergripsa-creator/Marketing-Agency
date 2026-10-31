/** Pub TikTok: hooks (bandit + exploration), 9:16 creatives, compliance submission, campaigns, stop-loss/scale, organic. */
import { CHANNELS, acceptance, channelOf } from '../../shared.js';
import type { AdCreative, AdFormat, AgentState, Campaign, ChannelId, HookStyle, Product, Task, TaskKind, VideoCut, VideoTempo, VoiceOfCustomer } from '../../shared.js';
import { nextId, streamRng } from '../../core/index.js';
import { hashString } from '../../core/ids.js';
import type { AdDraft, MindContext } from '../../contracts.js';
import { EDIT_BASELINE, planCut, TEMPOS } from '../../deliverables/videoCut.js';
import type { RuntimeCtx } from '../ctx.js';
import { addDeliverable, incident, nameOf, nicheBriefOf, nicheName, productOf, say, vocOf, writeRunFile } from '../ctx.js';
import { deliverables, learning, sim } from '../modules.js';
import { addPlaybookRule, AD_FORMATS, bannedHits, directivesOf, HOOK_STYLES } from '../playbook.js';
import { activeCampaigns, campaignMetrics, committedAdBudget, currentBudget, type CampaignMetrics } from '../metrics.js';
import { adHistory, companyPaidBlock, cooldownDays, launchableCreatives, MIN_CAMPAIGN_BUDGET, NO_TRACTION_ROAS, productHealth, productPaidBlock, promotionBlock, scalingRoom, STOP_LOSS_DAYS, STOP_LOSS_ROAS, TEST_CAMPAIGN_BUDGET, versionSince } from '../acquisition.js';
import { planNote, planTarget } from '../allocator.js';
import { adjusted, creditOf } from '../channels.js';
import { COMPACT } from '../compaction.js';
import { adsHold, REFUSAL_COOLDOWN_DAYS } from '../holds.js';
import { officerId, ownersOfAny, roleHolders } from '../org/officers.js';
import { dropTask } from '../pipeline.js';
import { budgetQueue } from '../portfolio.js';
import { growthOn, policyOf } from '../stages.js';
import { STREAM } from '../streams.js';
import { armSharp, bestDraft, effectiveT, pruneRead, shrunkRoas } from '../talent/craft.js';
import { onStrike } from '../talent/evidence.js';
import { createTask, isOpen, openTasks, taskChannel } from '../tasks.js';
import { upsellContextOf } from '../upsell.js';
import { clamp, dec, eur, idNum, keywords, numOf, pct, round2, short, str, sum, uniq } from '../util.js';
import type { HandlerMap, HandlerOutcome } from './common.js';
import { NO_PRODUCT, requireProduct, reworkNotes, mindWith } from './common.js';
import { COMPLIANCE_WORDS, FORMAT_LABELS, HOOK_LABELS } from './phrases.js';
import { ensureDesign } from './creation.js';

interface HookItem { hookStyle: HookStyle; hook: string }

const GROWTH_WRITER_KINDS: readonly TaskKind[] = ['write_ad_hooks', 'produce_ad', 'post_organic'];

/** The test running on this dimension for this niche: a test on one guide says nothing about another's creatives. */
function runningExperiment(ctx: RuntimeCtx, dimension: string, nicheId: string) {
  return ctx.world.company.experiments.find((e) => e.status === 'running' && e.dimension === dimension && (e.nicheId ?? nicheId) === nicheId) ?? null;
}

function isHookStyle(v: unknown): v is HookStyle {
  return typeof v === 'string' && (HOOK_STYLES as readonly string[]).includes(v);
}
function isFormat(v: unknown): v is AdFormat {
  return typeof v === 'string' && (AD_FORMATS as readonly string[]).includes(v);
}

/** A rework halves the flaws: the reviewer's notes help (talent §4.2). */
export function reworkCraft(task: Task, mind: MindContext): MindContext {
  return task.attempts > 0 && mind.craft ? { ...mind, craft: { ...mind.craft, flaw: mind.craft.flaw / 2 } } : mind;
}

/** The tempo of a cut is an editorial choice the market answers: a bandit per niche, on a stream of its own (video §3.6). */
function pickTempo(ctx: RuntimeCtx, agent: AgentState, mind: MindContext, nicheId: string, variant: number): VideoTempo {
  const w = ctx.world;
  const rng = streamRng(w.scenario.seed, STREAM.videoTempo, w.day, w.tick, variant);
  return learning.chooseArm(w, `video_tempo:${nicheId}`, TEMPOS, rng, armSharp(ctx, agent, mind, 'tempo')) as VideoTempo;
}

/** Keyed on the text, never on a generated id: paired runs keep the same cut for the same script, and `draw` tells a draft from the next (video §3.1). */
function cutOf(ctx: RuntimeCtx, task: Task, agent: AgentState, input: { creative: AdCreative; product: Product; voc: VoiceOfCustomer; tempo: VideoTempo; draw: number }): VideoCut {
  const w = ctx.world;
  const { creative, draw } = input;
  const skill = w.scenario.control?.videoSkill ?? effectiveT(w, agent, 'video') ?? EDIT_BASELINE;
  const key = hashString(`${creative.hook}|${creative.format}|${task.attempts}|${draw}`);
  const cut = planCut({ ...input, skill, rng: streamRng(w.scenario.seed, STREAM.videoCut, key) });
  return { ...cut, craft: sim.scoreCut(cut).craft };
}

/** The hooks a product remembers. */
const HOOKS_KEPT = 60;

function hooksIn(output: Record<string, unknown> | null): HookItem[] {
  const hooks = Array.isArray(output?.hooks) ? (output.hooks as Partial<HookItem>[]) : [];
  return hooks.flatMap((r) => (r && typeof r.hook === 'string' && isHookStyle(r.hookStyle) ? [{ hook: r.hook, hookStyle: r.hookStyle }] : []));
}

/**
 * The hooks written for a product, newest first: kept on it, or read off the tasks of a world that has none yet. Next to what
 * is kept, only tasks every world still holds are read, or a hook past the cap would come back once its row is compacted away.
 */
export function hookPool(ctx: RuntimeCtx, productId: string): HookItem[] {
  const w = ctx.world;
  const kept = productOf(ctx, productId)?.hooks;
  const rows = w.company.tasks.filter((t) => t.kind === 'write_ad_hooks' && t.status === 'done' && t.input.productId === productId && (!kept || w.day - (t.dayDone ?? 0) < COMPACT.taskDays));
  const written = rows.reverse().flatMap((t) => hooksIn(t.output));
  if (!kept) return written;
  const known = new Set(kept.map((h) => h.hook));
  return [...kept, ...written.filter((h) => !known.has(h.hook))];
}

function bannedFor(ctx: RuntimeCtx, product: Product, agentId: string): string[] {
  const voc = vocOf(ctx, product.nicheId);
  return uniq([...voc.bannedClaims, ...directivesOf(ctx.world, agentId).banned, ...directivesOf(ctx.world, officerId(ctx.world, 'growth')).banned]);
}

export function creativeText(c: AdCreative): string {
  return [c.hook, c.caption, c.cta, ...c.scenes.flatMap((s) => [s.onScreenText, s.voiceover])].join(' \n ');
}

/** Words from our compliance lists found in a rejected creative → they become "Ne jamais écrire" rules. */
function learnFromRejection(ctx: RuntimeCtx, c: AdCreative, product: Product): string[] {
  const voc = vocOf(ctx, product.nicheId);
  const hits = uniq([...bannedHits(creativeText(c), voc.bannedClaims), ...bannedHits(creativeText(c), COMPLIANCE_WORDS)]).slice(0, 3);
  for (const h of hits) for (const writer of ownersOfAny(ctx.world, GROWTH_WRITER_KINDS)) addPlaybookRule(ctx.world, writer.id, `Ne jamais écrire « ${h} »`);
  return hits;
}

function targetingFor(ctx: RuntimeCtx, product: Product): Campaign['targeting'] {
  const brief = nicheBriefOf(ctx, product.nicheId);
  const m = /(\d{2})\s*(?:-|à)\s*(\d{2})\s*ans/.exec(product.audience);
  let ageMin = 25, ageMax = 45;
  if (m) { ageMin = Math.max(18, Number(m[1])); ageMax = Math.max(ageMin + 5, Number(m[2])); }
  else if (/étudiant|lycéen|jeune/i.test(product.audience)) { ageMin = 18; ageMax = 26; }
  else if (/retraité|senior|après 50|plus de 50/i.test(product.audience)) { ageMin = 50; ageMax = 70; }
  else if (/parent|maman|papa|bébé|enfant/i.test(product.audience)) { ageMin = 24; ageMax = 42; }
  const interests = uniq([...brief.keywords, brief.category, brief.name]).filter(Boolean).slice(0, 5);
  return { interests, ageMin, ageMax };
}

/** Daily budget a new campaign may get inside the CFO's envelope (smaller after a losing streak). */
function launchBudget(ctx: RuntimeCtx, losers = 0): { budget: number; remaining: number; cap: number } {
  const b = currentBudget(ctx.world);
  const remaining = round2(Math.max(0, b.adCap - committedAdBudget(ctx.world)));
  const base = clamp(b.cash * 0.04 * (losers >= 2 ? 0.7 : 1), MIN_CAMPAIGN_BUDGET, policyOf(ctx.world).testDailyEur);
  return { budget: Math.floor(Math.min(remaining, base)), remaining, cap: b.adCap };
}

/** Flags of a planned launch that must follow it through write_ad_hooks → produce_ad → launch_campaign. */
function launchFlags(input: Record<string, unknown>): Record<string, true> {
  const out: Record<string, true> = {};
  for (const k of ['force', 'test', 'cautious'] as const) if (input[k] === true) out[k] = true;
  return out;
}

/** Normalised hook text (dedup of organic posts: case, spaces, quotes and punctuation do not count). */
export function hookKey(hook: string): string {
  return (hook ?? '').toLocaleLowerCase('fr').replace(/[«»“”"'’.,;:!?…()\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Organic posts per product and per day, and the window during which a text is never reposted. */
export const ORGANIC_MAX_PER_PRODUCT_DAY = 2;
export const ORGANIC_REPEAT_WINDOW_DAYS = 7;
const ORGANIC_FORMATS: AdFormat[] = ['text_slideshow', 'faceless_voiceover', 'carousel'];

/**
 * The stop-loss of Budget et garde-fous: ROAS < 0,8 after the channel's stop-loss spend (25 € on TikTok) over at least 2
 * days (whole life, or the last 3 days: a winner can turn into a loser) → pause; no traction at all (ROAS < 0,4 after that
 * spend) → pause at once. Each channel's spend outlasts what its learning phase costs at its minimum budget, so no campaign
 * is judged on the phase alone. The caller hands credit-adjusted metrics, never shrunk ones (D26): this protects the money.
 */
export function stopLossReason(life: CampaignMetrics, recent: CampaignMetrics, ch: ChannelId = 'tiktok'): string | null {
  const days = (m: CampaignMetrics) => new Set(m.rows.filter((r) => r.spend > 0).map((r) => r.day)).size;
  const spend = CHANNELS[ch].stopLossSpend;
  if (life.spend >= spend && life.roas < NO_TRACTION_ROAS) return `stop-loss, ROAS ${dec(life.roas)} après ${eur(life.spend)} (aucune traction)`;
  if (days(life) >= STOP_LOSS_DAYS && life.spend >= spend && life.roas < STOP_LOSS_ROAS) return `stop-loss, ROAS ${dec(life.roas)} après ${eur(life.spend)} sur ${days(life)} jours`;
  if (days(recent) >= STOP_LOSS_DAYS && recent.spend >= spend && recent.roas < STOP_LOSS_ROAS) return `stop-loss sur 3 jours, ROAS ${dec(recent.roas)} pour ${eur(recent.spend)}`;
  return null;
}

/** What this product already said in an ad or a post: the writer tries something else first. */
function usedHooksOf(ctx: RuntimeCtx, product: Product): string[] {
  const w = ctx.world;
  return [...w.company.creatives.filter((c) => c.productId === product.id).map((c) => c.hook), ...w.market.organicPosts.filter((p) => p.productId === product.id).map((p) => p.hook)];
}

/**
 * Organic hook for a product: styles rotate (never the same style twice a day for a product, the least recently
 * used first, the bandit's favourite first when it was not used in the last two posts), fresh hooks from
 * writeAdHooks and the creatives, and never a text already posted (any product) in the last 7 days.
 */
async function pickOrganicHook(ctx: RuntimeCtx, product: Product, agent: AgentState, mind: MindContext): Promise<HookItem | null> {
  const w = ctx.world;
  const posts = w.market.organicPosts;
  const mine = posts.filter((p) => p.productId === product.id).sort((a, b) => b.day - a.day || idNum(b.id) - idNum(a.id));
  const usedToday = new Set(mine.filter((p) => p.day === w.day).map((p) => p.hookStyle));
  const lastUsed = (s: HookStyle) => mine.find((p) => p.hookStyle === s)?.day ?? Number.NEGATIVE_INFINITY;
  let order = HOOK_STYLES.filter((s) => !usedToday.has(s)).sort((a, b) => lastUsed(a) - lastUsed(b) || HOOK_STYLES.indexOf(a) - HOOK_STYLES.indexOf(b));
  const favourite = learning.chooseArm(w, `hook_style:${product.nicheId}`, HOOK_STYLES, ctx.rng, armSharp(ctx, agent, mind, 'hook'));
  const lastTwo = mine.slice(0, 2).map((p) => p.hookStyle);
  if (isHookStyle(favourite) && order.includes(favourite) && !lastTwo.includes(favourite)) order = [favourite, ...order.filter((s) => s !== favourite)];
  if (!order.length) return null;
  const recent = new Set(posts.filter((p) => p.day > w.day - ORGANIC_REPEAT_WINDOW_DAYS).map((p) => hookKey(p.hook)));
  const everMine = new Set(mine.map((p) => hookKey(p.hook)));
  const banned = bannedFor(ctx, product, agent.id);
  const usable = (h: HookItem) => !!h.hook.trim() && !recent.has(hookKey(h.hook)) && !bannedHits(h.hook, banned).length;
  const choose = (pool: HookItem[]): HookItem | null => {
    for (const s of order) {
      const cands = pool.filter((h) => h.hookStyle === s);
      const pick = cands.find((h) => !everMine.has(hookKey(h.hook))) ?? cands[0];
      if (pick) return pick;
    }
    return null;
  };
  const known = [
    ...hookPool(ctx, product.id),
    ...w.company.creatives.filter((c) => c.productId === product.id && c.review.status === 'approved').map((c) => ({ hook: c.hook, hookStyle: c.hookStyle })),
  ].filter(usable);
  const fromKnown = choose(known);
  if (fromKnown) return fromKnown;
  // Nothing fresh in stock: the poster asks for new hooks in the next styles of the rotation (two attempts at most).
  const voc = vocOf(ctx, product.nicheId);
  const bannedMind = mindWith(mind, banned.map((b) => `Ne jamais écrire « ${b} »`));
  for (const styles of [order, [...order].reverse()]) {
    if (!styles.length) break;
    let fresh: { hookStyle: HookStyle; hook: string }[] = [];
    try { fresh = await ctx.engine.writeAdHooks({ product, voc, styles, upsellOf: upsellContextOf(w, product), usedHooks: usedHooksOf(ctx, product) }, bannedMind); } catch { fresh = []; }
    const pick = choose((Array.isArray(fresh) ? fresh : []).filter((h): h is HookItem => !!h && typeof h.hook === 'string' && isHookStyle(h.hookStyle)).filter(usable));
    if (pick) return pick;
  }
  return null;
}

/** Approval mode: a raise above what the founder agreed to is a request of its own, once at a time. The campaign keeps its budget meanwhile. */
function askRaise(ctx: RuntimeCtx, task: Task, c: Campaign, raiseTo: number, roas: number): void {
  const w = ctx.world;
  if (openTasks(w, (t) => t.kind === 'optimize_ads' && t.input.raiseTo !== undefined && t.input.campaignId === c.id).length) return;
  if (c.raiseRefusedDay !== undefined && w.day <= c.raiseRefusedDay + REFUSAL_COOLDOWN_DAYS) return;
  createTask(w, { kind: 'optimize_ads', title: `Hausse de budget — ${short(c.name, 50)}`, input: { campaignId: c.id, productId: c.productId, raiseTo, roas }, createdBy: task.assignee ?? officerId(w, 'growth'), missionId: task.missionId, priority: 2 });
}

/** The founder's answer to a raise: nothing moves before his yes, and the amount he agreed to becomes the campaign's limit. */
function runRaise(ctx: RuntimeCtx, task: Task): HandlerOutcome {
  const c = ctx.world.company.campaigns.find((x) => x.id === task.input.campaignId && x.status === 'active');
  const product = productOf(ctx, c?.productId);
  // His yes does not widen the CFO's envelope: it may have shrunk since the question.
  const room = c && product ? Math.max(0, scalingRoom(ctx.world, product, currentBudget(ctx.world).adCap) - committedAdBudget(ctx.world, c.id)) : 0;
  const raiseTo = round2(Math.min(numOf(task.input.raiseTo) ?? 0, room));
  if (!c || raiseTo <= c.dailyBudget) return { summary: 'Hausse sans objet : la campagne ou l’enveloppe a changé entre-temps.', skipReview: true, output: { skipped: true } };
  if (task.input.founderApproved !== true) {
    return { summary: `Hausse prête (${eur(raiseTo)}/jour) : en attente du fondateur.`, awaitFounder: `Monter « ${short(c.name, 60)} » de ${eur(c.dailyBudget)} à ${eur(raiseTo)}/jour (ROAS récent ${dec(numOf(task.input.roas) ?? 0)})` };
  }
  const before = c.dailyBudget;
  if (ctx.tools.updateCampaign(c.id, { dailyBudget: raiseTo }).ok) { c.dailyBudget = raiseTo; c.founderCap = raiseTo; }
  return { summary: `${c.name} : ${eur(before)} → ${eur(c.dailyBudget)}/jour, accord du fondateur.`, output: { actions: [`${c.name} : ${eur(before)} → ${eur(c.dailyBudget)}/jour`] } };
}

function requestCreatives(ctx: RuntimeCtx, product: Product, task: Task, opts: { produce: number; attachTo?: string; launch?: boolean; flags?: Record<string, unknown>; why: string }): boolean {
  const open = ctx.world.company.tasks.some((t) => isOpen(t) && t.input.productId === product.id && (t.kind === 'write_ad_hooks' || t.kind === 'produce_ad'));
  const mine = ctx.world.company.creatives.filter((c) => c.productId === product.id && acceptance('tiktok', c) !== null); // a cut for another channel is no TikTok creative
  const inUse = new Set(activeCampaigns(ctx.world).flatMap((c) => c.creativeIds));
  // Fresh = pending review, running, or approved but never shown: no point stacking more of those.
  const fresh = mine.filter((c) => c.review.status === 'pending' || inUse.has(c.id) || (c.review.status === 'approved' && !(ctx.world.market.creativeImpressions[c.id] > 0)));
  if (open || fresh.length >= 6 || mine.length >= 80) return false;
  const by = task.assignee ?? officerId(ctx.world, 'growth');
  createTask(ctx.world, {
    kind: 'write_ad_hooks', title: `Nouveaux hooks — « ${short(product.title, 42)} »`,
    input: { productId: product.id, nicheId: product.nicheId, produce: opts.produce, ...(opts.attachTo ? { attachTo: opts.attachTo } : {}), ...(opts.launch ? { launch: true, ...(opts.flags ?? {}) } : {}) },
    createdBy: by, missionId: task.missionId, priority: 2,
  });
  say(ctx, by, `${nameOf(ctx, by)} demande ${opts.produce} nouvelle(s) créa(s) : ${opts.why}`, 'thought', { productId: product.id });
  return true;
}

export const growthHandlers: HandlerMap = {
  write_ad_hooks: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const held = adsHold(ctx.world, product.id);
      if (held) return { summary: `Pas de hooks : ${held.reason}.`, skipReview: true, output: { skipped: true, reason: 'founder' } };
      const voc = vocOf(ctx, product.nicheId);
      const dim = `hook_style:${product.nicheId}`;
      const d = directivesOf(ctx.world, agent.id, nicheName(ctx, product.nicheId));
      const styles: HookStyle[] = [];
      if (d.hook) styles.push(d.hook);
      const exp = runningExperiment(ctx, 'hook_style', product.nicheId);
      if (exp) for (const v of exp.variants) if (isHookStyle(v)) styles.push(v);
      const sharp = armSharp(ctx, agent, mind, 'hook');
      for (let i = 0; i < 8 && uniq(styles).length < 4; i++) {
        const s = learning.chooseArm(ctx.world, dim, HOOK_STYLES, ctx.rng, sharp);
        if (isHookStyle(s)) styles.push(s);
      }
      const pulled = new Set(learning.armStats(ctx.world, dim).filter((s) => s.pulls > 0).map((s) => s.key));
      const untried = HOOK_STYLES.filter((s) => !pulled.has(s) && !styles.includes(s));
      if (untried.length) styles.push(ctx.rng.pick(untried)); // exploration
      const chosen = uniq(styles).slice(0, 5);
      const banned = bannedFor(ctx, product, agent.id);
      const raw = await ctx.engine.writeAdHooks({ product, voc, styles: chosen, upsellOf: upsellContextOf(ctx.world, product), usedHooks: usedHooksOf(ctx, product) }, mindWith(mind, banned.map((b) => `Ne jamais écrire « ${b} »`)));
      const hooks = raw.filter((h) => h && typeof h.hook === 'string' && h.hook.trim() && isHookStyle(h.hookStyle) && !bannedHits(h.hook, banned).length);
      const final = hooks.length ? hooks : raw.filter((h) => h && typeof h.hook === 'string' && isHookStyle(h.hookStyle));
      if (!final.length) return { fail: 'Aucun hook exploitable.', summary: 'Aucun hook.' };
      say(ctx, agent.id, `${agent.name} : « ${short(final[0]!.hook, 80)} » (${HOOK_LABELS[final[0]!.hookStyle] ?? final[0]!.hookStyle})`, 'thought', { productId: product.id });
      return {
        summary: `${final.length} hooks écrits (${uniq(final.map((h) => HOOK_LABELS[h.hookStyle] ?? h.hookStyle)).join(', ')}).`,
        output: { hooks: final.map((h) => ({ hook: h.hook, hookStyle: h.hookStyle })), styles: chosen },
      };
    },
    async onDone(ctx, task) {
      const n = Math.max(0, Math.min(3, Math.round(numOf(task.input.produce) ?? 0)));
      const product = productOf(ctx, task.input.productId);
      if (product) product.hooks = (product.hooks ? [...hooksIn(task.output), ...product.hooks] : hookPool(ctx, product.id)).slice(0, HOOKS_KEPT);
      if (!n || !product || product.status === 'killed' || task.output?.skipped === true) return;
      const used = ctx.world.company.creatives.filter((c) => c.productId === product.id).length;
      const forced = Array.isArray(task.input.experimentVariants) ? (task.input.experimentVariants as string[]) : [];
      const by = task.assignee ?? officerId(ctx.world, 'growth');
      const ads = Array.from({ length: n }, (_, i) => createTask(ctx.world, {
        kind: 'produce_ad', title: `Produire une pub TikTok n° ${used + i + 1} — « ${short(product.title, 40)} »`,
        input: { productId: product.id, nicheId: product.nicheId, variant: used + i, ...(forced[i] ? { experimentVariant: forced[i] } : {}), ...(str(task.input.attachTo) ? { attachTo: str(task.input.attachTo) } : {}) },
        dependsOn: [], createdBy: by, missionId: task.missionId, priority: task.priority,
      }));
      if (task.input.launch === true) {
        createTask(ctx.world, { kind: 'launch_campaign', title: `Relancer une campagne — « ${short(product.title, 42)} »`, input: { productId: product.id, nicheId: product.nicheId, ...launchFlags(task.input) }, dependsOn: ads.map((a) => a.id), createdBy: task.createdBy === 'founder' ? 'founder' : by, missionId: task.missionId, priority: task.priority });
      }
    },
  },

  produce_ad: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const held = adsHold(ctx.world, product.id);
      if (held) return { summary: `Pas de pub : ${held.reason}.`, skipReview: true, output: { skipped: true, dropped: true } };
      const voc = vocOf(ctx, product.nicheId);
      const variant = Math.max(0, Math.round(numOf(task.input.variant) ?? 0));
      const existingId = str(task.output?.creativeId);
      const existing = existingId ? ctx.world.company.creatives.find((c) => c.id === existingId) : undefined;
      // Hook: newest unused hook (experiment style first), the rework takes another one.
      let pool = hookPool(ctx, product.id);
      if (!pool.length) {
        const fresh = await ctx.engine.writeAdHooks({ product, voc, styles: [ctx.rng.pick(HOOK_STYLES)], upsellOf: upsellContextOf(ctx.world, product), usedHooks: usedHooksOf(ctx, product) }, mind);
        pool = fresh.filter((h) => h && typeof h.hook === 'string' && isHookStyle(h.hookStyle));
      }
      if (!pool.length) return { fail: 'Pas de hook disponible pour produire la pub.', summary: 'Pas de hook.' };
      const used = new Set(ctx.world.company.creatives.filter((c) => c.productId === product.id && c.id !== existingId).map((c) => c.hook));
      if (existing && task.attempts > 0) used.add(existing.hook);
      const hookExp = runningExperiment(ctx, 'hook_style', product.nicheId);
      const forced = str(task.input.experimentVariant);
      const wanted = hookExp && hookExp.variants.length ? (forced && hookExp.variants.includes(forced) ? forced : hookExp.variants[variant % hookExp.variants.length]) : null;
      const unused = pool.filter((h) => !used.has(h.hook));
      // Once the head of growth sent a hook back on this guide, the team only keeps those that talk about the problem or the audience.
      const subject = keywords(`${product.title} ${product.problem} ${product.audience}`);
      const onTopic = (h: HookItem) => keywords(h.hook).some((w) => subject.includes(w));
      const sentBack = task.attempts > 0 || ctx.world.company.tasks.some((t) => t.kind === 'produce_ad' && t.input.productId === product.id && t.reviews.some((r) => r.verdict === 'changes'));
      const preferred = sentBack ? unused.filter(onTopic) : [];
      const candidates = preferred.length ? preferred : unused.length ? unused : pool;
      // A rework never takes back the hook it is replacing; otherwise a proven hook may get a new execution.
      // A hook that got a creative refused by TikTok is never reused.
      const refused = new Set(ctx.world.company.creatives.filter((c) => c.productId === product.id && c.review.status === 'rejected').map((c) => c.hook));
      const reusable = pool.filter((h) => !refused.has(h.hook) && !(existing && task.attempts > 0 && h.hook === existing.hook));
      // Exploit what the bandit learned: outside an A/B slot, the hook's style is a Thompson draw among the styles
      // of the pool; a fresh hook of that style first, else a new execution (format, visuals) of a hook already used
      // — a new creative, so no fatigue. Before, the n-th creative took the n-th unused hook, and the heuristic writer
      // only has 2-4 texts per style: the best-known style of a niche ran out after 2-3 creatives and was used no
      // more often than a random one (best-style share 15 % → 21 % between days 1-30 and 31-60).
      let hook = wanted ? candidates.find((h) => h.hookStyle === wanted) ?? reusable.find((h) => h.hookStyle === wanted) : undefined;
      if (!hook) {
        const stylesInPool = uniq(reusable.map((h) => h.hookStyle));
        const pick = stylesInPool.length > 1 ? learning.chooseArm(ctx.world, `hook_style:${product.nicheId}`, stylesInPool, ctx.rng, armSharp(ctx, agent, mind, 'hook')) : stylesInPool[0];
        hook = candidates.find((h) => h.hookStyle === pick) ?? reusable.find((h) => h.hookStyle === pick) ?? candidates[variant % candidates.length]!;
      }
      const angle = hook;
      // Format: playbook preference for the first ad, experiment variants, else the bandit.
      const d = directivesOf(ctx.world, agent.id, nicheName(ctx, product.nicheId));
      const fmtExp = runningExperiment(ctx, 'ad_format', product.nicheId);
      let format: AdFormat;
      if (fmtExp && forced && isFormat(forced) && fmtExp.variants.includes(forced)) format = forced;
      else if (fmtExp && fmtExp.variants.length && isFormat(fmtExp.variants[variant % fmtExp.variants.length])) format = fmtExp.variants[variant % fmtExp.variants.length] as AdFormat;
      else if (d.format && variant === 0) format = d.format;
      else { const f = learning.chooseArm(ctx.world, `ad_format:${product.nicheId}`, AD_FORMATS, ctx.rng, armSharp(ctx, agent, mind, 'format')); format = isFormat(f) ? f : 'text_slideshow'; }
      const bannedClaims = uniq([...bannedFor(ctx, product, agent.id), ...COMPLIANCE_WORDS]);
      const notes = reworkNotes(task).map((n) => `Correction demandée par ${nameOf(ctx, officerId(ctx.world, 'growth'))} : ${n}`);
      const upsellOf = upsellContextOf(ctx.world, product);
      const shell = (id: string): AdCreative => ({
        id, productId: product.id, hook: '', hookStyle: angle.hookStyle, format, scenes: [], caption: '', hashtags: [], cta: '',
        files: { storyboard: [], preview: null }, quality: null, review: { status: 'pending', reason: null, day: null }, createdDay: ctx.world.day, createdBy: agent.id,
      });
      const written = (ad: AdDraft) => ({
        hook: ad.hook || angle.hook, hookStyle: isHookStyle(ad.hookStyle) ? ad.hookStyle : angle.hookStyle,
        format: isFormat(ad.format) ? ad.format : format, scenes: Array.isArray(ad.scenes) ? ad.scenes : [],
        caption: ad.caption ?? '', hashtags: Array.isArray(ad.hashtags) ? ad.hashtags : [], cta: ad.cta ?? '',
      });
      const video = ctx.world.scenario.videoModel === 'on';
      const tempo = video ? ctx.world.scenario.control?.videoTempo ?? pickTempo(ctx, agent, mind, product.nicheId, variant) : 'standard';
      // Each draft is read as a creative with the company's own VoC, with its cut (D31): no id is spent on the ones left in the drawer.
      const { draft } = await bestDraft(ctx, agent, reworkCraft(task, mindWith(mind, notes)), 'ad',
        async (m) => {
          const ad = written(await ctx.engine.writeAd({ product, voc, hook: angle.hook, hookStyle: angle.hookStyle, format, bannedClaims, upsellOf }, m));
          return video ? { ...ad, cut: cutOf(ctx, task, agent, { creative: { ...shell('draft'), ...ad }, product, voc, tempo, draw: m.draw ?? 0 }) } : ad;
        },
        (d) => sim.scoreCreative({ ...shell('draft'), ...d }, product, voc).overall);
      const creative: AdCreative = existing ?? shell(nextId(ctx.world, 'cre'));
      Object.assign(creative, { ...draft, review: { status: 'pending', reason: null, day: null }, createdBy: agent.id });
      if (!existing) ctx.world.company.creatives.push(creative);
      const design = ensureDesign(ctx, product);
      const board = deliverables.renderAdStoryboard({ creative, product, design, brand: ctx.world.company.name });
      const dir = `files/${product.id}/ads/${creative.id}`;
      const frames: string[] = [];
      for (let i = 0; i < board.frames.length; i++) {
        const rel = `${dir}/frame-${i + 1}.svg`;
        await writeRunFile(ctx, rel, board.frames[i]!);
        frames.push(rel);
      }
      await writeRunFile(ctx, `${dir}/preview.html`, board.previewHtml);
      creative.files = { storyboard: frames, preview: `${dir}/preview.html` };
      creative.quality = sim.scoreCreative(creative, product, voc);
      const label = `${HOOK_LABELS[creative.hookStyle] ?? creative.hookStyle}, ${FORMAT_LABELS[creative.format] ?? creative.format}`;
      if (frames[0]) addDeliverable(ctx, { kind: 'ad_storyboard', title: `Storyboard « ${short(creative.hook, 50)} » (${label})`, productId: product.id, creativeId: creative.id, path: frames[0], createdBy: agent.id, quality: creative.quality.overall }, task);
      addDeliverable(ctx, { kind: 'ad_preview', title: `Aperçu TikTok « ${short(creative.hook, 50)} »`, productId: product.id, creativeId: creative.id, path: creative.files.preview!, createdBy: agent.id, quality: creative.quality.overall }, task);
      return {
        summary: `Pub ${label} : ${creative.scenes.length} scènes — qualité ${creative.quality.overall}/100.`,
        output: { creativeId: creative.id, hookStyle: creative.hookStyle, format: creative.format, score: creative.quality.overall },
      };
    },
    async onDone(ctx, task) {
      const creative = ctx.world.company.creatives.find((c) => c.id === task.output?.creativeId);
      const product = productOf(ctx, task.input.productId);
      if (!creative || !product || product.status === 'killed' || task.output?.dropped === true) return;
      const res = ctx.tools.submitCreative(creative.id);
      creative.review = { status: res.status, reason: res.reason, day: ctx.world.day };
      const growth = officerId(ctx.world, 'growth');
      if (res.status === 'approved') {
        say(ctx, growth, `TikTok valide la pub « ${short(creative.hook, 60)} »`, 'ad', { creativeId: creative.id, productId: product.id });
        const attach = ctx.world.company.campaigns.find((c) => c.id === task.input.attachTo && c.status === 'active');
        if (attach && !attach.creativeIds.includes(creative.id)) {
          const ids = [...attach.creativeIds, creative.id];
          const up = ctx.tools.updateCampaign(attach.id, { creativeIds: ids });
          if (up.ok) attach.creativeIds = ids;
        }
      } else {
        const hits = learnFromRejection(ctx, creative, product);
        const reason = res.reason ?? 'non conforme';
        if (res.strike) onStrike(ctx.world, creative);
        incident(ctx, `Pub refusée par TikTok (« ${short(creative.hook, 50)} ») : ${reason}${hits.length ? ` — mots en cause : ${hits.join(', ')}` : ''}`);
        say(ctx, growth, `TikTok refuse la pub « ${short(creative.hook, 50)} » : ${short(reason, 70)}${res.strike ? ' — avertissement sur le compte !' : ''}`, 'ad', { creativeId: creative.id, productId: product.id });
        if (hits.length) say(ctx, officerId(ctx.world, 'hr'), `Leçon immédiate : l'équipe pub n'écrira plus jamais « ${hits.join(' », « ')} »`, 'lesson');
      }
    },
  },

  launch_campaign: {
    async run(ctx, task, agent) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      if (product.status !== 'live') {
        const publish = ctx.world.company.tasks.find((t) => isOpen(t) && t.kind === 'publish_product' && t.input.productId === product.id);
        if (publish) return { summary: 'Le produit n’est pas encore en ligne : on attend la mise en ligne.', retryLater: 'produit pas encore en ligne', dependsOn: [publish.id] };
        return { fail: 'Produit pas en ligne : campagne impossible.', summary: 'Produit hors ligne.' };
      }
      // Every non-launch is said out loud with its real reason (the founder must never wonder why nothing runs).
      const skip = (reason: string, code: string, extra: Record<string, unknown> = {}) => {
        say(ctx, agent.id, `${agent.name} ne lance pas de campagne pour « ${short(product.title, 40)} » : ${reason}`, 'ad', { productId: product.id });
        return { summary: `Pas de campagne : ${reason}.`, skipReview: true, output: { skipped: true, reason: code, why: reason, ...extra } };
      };
      const ch = taskChannel(task);
      const label = CHANNELS[ch].label;
      const minBudget = CHANNELS[ch].minDailyBudget;
      const severe = productHealth(ctx.world, product).severe;
      if (severe) return skip(`${severe} — on ne pousse pas un guide que les acheteurs n'aiment pas`, 'quality');
      const blocked = companyPaidBlock(ctx.world, ch);
      if (blocked) return skip(blocked, 'company');
      // The founder's stop beats everything, a launch he asked for earlier included: only his word lifts it.
      const held = adsHold(ctx.world, product.id, ch);
      if (held) return skip(held.reason, 'founder');
      // Cooldown / "ads-dead" are the team's own rules: a founder request or the CEO's watchdog overrides them.
      // A product that loses money or a « couper les pubs » lesson only yield to the founder.
      const productBlock = productPaidBlock(ctx.world, product, ch);
      const overrides = task.createdBy === 'founder' || (task.input.force === true && !productBlock?.final);
      if (productBlock && !overrides) return skip(productBlock.reason, productBlock.hard ? 'blocked' : 'cooldown');
      const ready = launchableCreatives(ctx.world, product.id, ch);
      if (!ready.length && ch !== 'tiktok') return skip(`aucune créa validée par ${label} (les adaptations passent par le plan du jour)`, 'no_creative');
      if (!ready.length) {
        const writer = roleHolders(ctx.world, 'hook_writer')[0]?.id ?? officerId(ctx.world, 'growth');
        const asked = requestCreatives(ctx, product, task, { produce: 2, launch: true, flags: { ...launchFlags(task.input), ...(overrides ? { force: true } : {}) }, why: 'aucune créa fraîche validée par TikTok' });
        return skip(asked ? `aucune créa fraîche validée — ${nameOf(ctx, writer)} écrit de nouveaux hooks, la campagne suivra` : 'aucune créa fraîche validée (des créas sont déjà en production)', 'no_creative');
      }
      const losers = adHistory(ctx.world, product.id, versionSince(ctx.world, product), ch).losers;
      const envelope = launchBudget(ctx, losers);
      const remaining = envelope.remaining;
      // The CEO's watchdog test on an "ads-dead" version runs at the minimum budget.
      // When paid ads lose money overall, new campaigns start smaller (the CEO's cautious mode).
      const planned = task.input.test === true ? Math.min(envelope.budget, Math.max(TEST_CAMPAIGN_BUDGET, minBudget))
        : task.input.cautious === true ? Math.min(envelope.budget, Math.max(minBudget, Math.floor(envelope.budget * 0.6))) : envelope.budget;
      // The founder agreed to an amount: the envelope may have grown since, his yes has not.
      const daily = Math.min(planned, numOf(task.input.askedBudget) ?? planned);
      if (daily < minBudget) return skip(`enveloppe du CFO insuffisante (${eur(remaining)} restants)`, 'budget', { remaining });
      if (ctx.world.scenario.founderApproval && task.input.founderApproved !== true) {
        task.input.askedBudget = daily;
        return { summary: `Campagne prête (${eur(daily)}/jour, ${ready.length} créas) : en attente du fondateur.`, awaitFounder: `Lancer une campagne ${label} à ${eur(daily)}/jour pour « ${product.title} »` };
      }
      const creatives = ready.slice(0, policyOf(ctx.world).creativesPerCampaign);
      const n = (product.campaignCount ?? 0) + ctx.world.company.campaigns.filter((c) => c.productId === product.id).length + 1;
      // Only a channel's own test counts as one: the CEO's watchdog test stays a plain TikTok campaign.
      const placement = ch === 'tiktok' ? {} : { channel: ch, ...(task.input.test === true ? { test: true } : {}) };
      const input = { productId: product.id, name: `${short(product.title, 40)} — ${ch === 'tiktok' ? '' : `${label}, `}campagne ${n}`, creativeIds: creatives.map((c) => c.id), dailyBudget: daily, targeting: targetingFor(ctx, product), createdBy: agent.id, ...placement };
      const res = ctx.tools.createCampaign(input);
      if (!res.ok) {
        incident(ctx, `Campagne refusée pour « ${product.title} » : ${res.message}`);
        return { fail: `La plateforme refuse la campagne : ${res.message}`, summary: res.message };
      }
      const id = res.id ?? nextId(ctx.world, 'cmp');
      if (!ctx.world.company.campaigns.some((c) => c.id === id)) {
        ctx.world.company.campaigns.push({ id, productId: input.productId, name: input.name, creativeIds: input.creativeIds, dailyBudget: input.dailyBudget, status: 'active', targeting: input.targeting, startDay: ctx.world.day, createdBy: agent.id, ...placement });
      }
      // The founder overrode the numbers: only he, or the stop-loss, ends this campaign.
      const launched = ctx.world.company.campaigns.find((c) => c.id === id);
      if (launched && productBlock?.final && task.createdBy === 'founder') launched.founderForced = true;
      if (launched && ctx.world.scenario.founderApproval) launched.founderCap = daily;
      say(ctx, agent.id, `${agent.name} lance « ${input.name} » : ${eur(daily)}/jour, ${creatives.length} créas, ${input.targeting.ageMin}-${input.targeting.ageMax} ans`, 'ad', { productId: product.id });
      return { summary: `Campagne lancée à ${eur(daily)}/jour avec ${creatives.length} créas.`, output: { campaignId: id, dailyBudget: daily, creativeIds: input.creativeIds } };
    },
  },

  optimize_ads: {
    async run(ctx, task, agent, mind) {
      if (task.input.raiseTo !== undefined) return runRaise(ctx, task);
      for (const t of openTasks(ctx.world, (x) => x.kind === 'optimize_ads' && x.input.raiseTo !== undefined && x.status === 'awaiting_founder')) {
        if (!activeCampaigns(ctx.world).some((c) => c.id === t.input.campaignId)) dropTask(ctx, t, 'la campagne ne tourne plus');
      }
      const budget = currentBudget(ctx.world);
      // A task that names a channel is that channel's buyer's. Without one it reads them all: no campaign goes without its stop-loss.
      const only = task.input.channel === undefined ? null : taskChannel(task);
      const campaigns = budgetQueue(ctx.world, activeCampaigns(ctx.world).filter((c) => !only || channelOf(c) === only), (c) => c.productId);
      if (!campaigns.length) return { summary: 'Aucune campagne active.', skipReview: true, output: { actions: [] } };
      const channels = uniq(campaigns.map(channelOf));
      const stats = channels.flatMap((ch) => ctx.tools.getAdStats(Math.max(1, ctx.world.day - 7), ch));
      const all = channels.flatMap((ch) => ctx.tools.getAdStats(1, ch));
      const allocation = growthOn(ctx.world) ? ctx.world.company.growth?.allocation : null;
      const t = mind.craft?.t;
      const actions: string[] = [];
      const pause = (c: Campaign, why: string) => {
        const r = ctx.tools.updateCampaign(c.id, { status: 'paused' });
        if (r.ok) c.status = 'paused';
        actions.push(`${c.name} en pause : ${why}`);
        incident(ctx, `Campagne « ${c.name} » mise en pause : ${why}`);
      };
      for (const c of campaigns) {
        const ch = channelOf(c);
        const minBudget = CHANNELS[ch].minDailyBudget;
        const product = productOf(ctx, c.productId);
        if (!product || product.status === 'killed' || product.status === 'paused') { pause(c, 'produit arrêté'); continue; }
        if (budget.bankrupt) { pause(c, 'trésorerie négative'); continue; }
        const barred = c.founderForced ? null : productPaidBlock(ctx.world, product, ch);
        if (barred?.final) { pause(c, barred.reason); continue; }
        const credit = creditOf(ctx.world, ch, product.nicheId);
        const life = adjusted(campaignMetrics(all, c.id, c.startDay), credit);
        const recent = adjusted(campaignMetrics(stats, c.id, Math.max(c.startDay, ctx.world.day - 3)), credit);
        const yesterday = adjusted(campaignMetrics(stats, c.id, Math.max(c.startDay, ctx.world.day - 1)), credit);
        // 1. Stop-loss on a sample (Budget et garde-fous): one bad day is noise, except when nothing sells at all.
        //    Under the rule the campaign stops; it is never shrunk to 5 €/day while the sample takes days to arrive.
        const stop = stopLossReason(life, recent, ch);
        if (stop) {
          pause(c, stop);
          const losers = adHistory(ctx.world, product.id, versionSince(ctx.world, product), ch).losers;
          const wait = cooldownDays(losers);
          // Outside TikTok the line's verdict decides what comes next, and the plan orders the cuts (channels §7.2, §7.5).
          if (ch === 'tiktok' && !productPaidBlock(ctx.world, product)?.hard) {
            requestCreatives(ctx, product, task, wait === 0
              ? { produce: 2, launch: true, why: `${stop} : il faut un nouvel angle` }
              : { produce: 2, why: `${losers} campagnes perdantes d'affilée : créas prêtes pour une relance dans ${wait} jour(s)` });
          }
          continue;
        }
        // 2. Survival mode: only clearly profitable campaigns keep running.
        if (budget.survival && recent.spend >= 10 && recent.roas < 1.2) { pause(c, `mode survie, ROAS ${dec(recent.roas)}`); continue; }
        // 3. The losing creatives this buyer can read in the last 4 days go (talent §4.5): a reduction, so free in approval
        //    mode, and each stays approved for another campaign. Then fatigue / weak creatives (the last one stays until its
        //    replacement is approved).
        const losing = t === undefined ? [] : pruneRead(life.rows, c.creativeIds, t);
        if (losing.length) {
          const kept = c.creativeIds.filter((id) => !losing.includes(id));
          if (ctx.tools.updateCampaign(c.id, { creativeIds: kept }).ok) {
            c.creativeIds = kept;
            actions.push(`${losing.length} créa(s) perdante(s) retirée(s) de ${c.name}`);
          }
        }
        const keep: string[] = [];
        const dropped: string[] = [];
        let tired = 0;
        for (const cid of c.creativeIds) {
          const rows = life.rows.filter((r) => r.creativeId === cid).sort((a, b) => a.day - b.day);
          const last = rows[rows.length - 1];
          const peak = Math.max(0, ...rows.map((r) => r.ctr));
          const impressions = rows.reduce((s, r) => s + r.impressions, 0);
          const fatigued = !!last && (last.frequency >= 3.2 || (rows.length >= 3 && peak > 0 && last.ctr < peak * 0.55));
          const weak = impressions >= 1500 && rows.length >= 2 && peak < 0.006;
          if (fatigued || weak) tired++;
          if ((fatigued || weak) && c.creativeIds.length - dropped.length > 1) dropped.push(cid); else keep.push(cid);
        }
        if (dropped.length) {
          const r = ctx.tools.updateCampaign(c.id, { creativeIds: keep });
          if (r.ok) c.creativeIds = keep;
          actions.push(`${dropped.length} créa(s) fatiguée(s) retirée(s) de ${c.name}`);
        }
        if (ch === 'tiktok' && (tired > 0 || (recent.impressions >= 2000 && recent.ctr < 0.008))) {
          requestCreatives(ctx, product, task, { produce: Math.max(1, Math.min(2, tired)), attachTo: c.id, why: tired ? `${tired} créa(s) fatiguée(s)` : `CTR en baisse (${pct(recent.ctr, 2)})` });
        }
        // 4. The budget. A line of the CFO's plan goes where the plan says, it read the money already; test campaigns wait
        //    for their verdict at the budget they started with. Everything else: scale winners (+30 % max) while the last day
        //    still holds, trim the lukewarm ones, inside the CFO envelope. A buyer with talent discounts a thin sample before
        //    reading it (talent §4.5); what protects the money reads the raw number.
        const target = planTarget(ctx.world, c);
        if (target === 0 && !c.founderForced) { pause(c, planNote(ctx.world, c) ?? 'arrêtée par le plan du CFO'); c.planStopped = ctx.world.day; continue; }
        const read = t === undefined ? recent.roas : shrunkRoas(recent.revenue, recent.spend, t);
        // What the others will spend once the same pass moved them: a raise does not wait for a cut further down the list.
        const committed = sum(activeCampaigns(ctx.world).filter((o) => o.id !== c.id).map((o) => planTarget(ctx.world, o) ?? o.dailyBudget));
        const room = Math.max(0, scalingRoom(ctx.world, product, budget.adCap) - round2(committed));
        const scaleRoas = allocation?.scaleRoas ?? 1.8;
        let next = c.dailyBudget;
        if (target !== null) next = target;
        else if (c.test) next = c.dailyBudget;
        else if (recent.spend >= 10 && read >= scaleRoas && (yesterday.spend < 5 || yesterday.roas >= (allocation ? 0.78 * scaleRoas : 1.4))) next = round2(c.dailyBudget * 1.3);
        // Brake: a big budget that collapsed yesterday (CPM spike, saturated audience) is halved at once.
        else if (yesterday.spend >= 30 && yesterday.roas < 0.5) next = round2(c.dailyBudget * 0.5);
        // Trim the lukewarm only: under the stop-loss, tomorrow's sample decides, a smaller budget would only delay it.
        else if (recent.spend >= 20 && read < (allocation?.trimRoas ?? 1.3) && recent.roas >= STOP_LOSS_ROAS) next = round2(c.dailyBudget * 0.7);
        next = round2(Math.max(minBudget, Math.min(next, room)));
        if (room < minBudget) { pause(c, `enveloppe CFO épuisée (${eur(budget.adCap)})`); continue; }
        // Approval mode: reductions and pauses stay free, more than the founder agreed to waits for his yes.
        const agreed = ctx.world.scenario.founderApproval ? c.founderCap ?? c.dailyBudget : Number.POSITIVE_INFINITY;
        if (next > agreed) { askRaise(ctx, task, c, next, recent.roas); next = agreed; }
        const before = c.dailyBudget;
        if (Math.abs(next - before) >= 0.5) {
          const r = ctx.tools.updateCampaign(c.id, { dailyBudget: next });
          if (r.ok) {
            actions.push((target !== null ? planNote(ctx.world, c) : null) ?? `${c.name} : ${eur(before)} → ${eur(next)}/jour (ROAS récent ${dec(recent.roas)})`);
            c.dailyBudget = next;
          }
        }
      }
      for (const a of actions.slice(0, 4)) say(ctx, agent.id, `${agent.name} : ${a}`, 'ad');
      return { summary: actions.length ? actions.join(' · ') : 'Campagnes stables, aucun changement.', output: { actions } };
    },
  },

  post_organic: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      if (product.status !== 'live') return { summary: 'Produit pas encore en ligne : post reporté.', skipReview: true, output: { skipped: true } };
      const quality = promotionBlock(ctx.world, product);
      if (quality) {
        say(ctx, agent.id, `${agent.name} ne poste pas sur « ${short(product.title, 40)} » : ${quality}`, 'thought', { productId: product.id });
        return { summary: `Pas de post : ${quality}.`, skipReview: true, output: { skipped: true, reason: 'quality' } };
      }
      const w = ctx.world;
      const posts = w.market.organicPosts;
      const mine = posts.filter((p) => p.productId === product.id).sort((a, b) => b.day - a.day || idNum(b.id) - idNum(a.id));
      const today = mine.filter((p) => p.day === w.day);
      if (today.length >= ORGANIC_MAX_PER_PRODUCT_DAY) {
        return { summary: `Déjà ${today.length} posts aujourd'hui sur ce produit : on n'en rajoute pas.`, skipReview: true, output: { skipped: true, reason: 'quota' } };
      }
      const pick = await pickOrganicHook(ctx, product, agent, mind);
      if (!pick) {
        say(ctx, agent.id, `${agent.name} n'a pas de hook neuf pour « ${short(product.title, 40)} » : pas de post plutôt qu'une redite`, 'thought', { productId: product.id });
        return { summary: 'Pas de hook neuf : aucun post plutôt qu’un doublon.', skipReview: true, output: { skipped: true, reason: 'no_fresh_hook' } };
      }
      // Format: the one this product has not used for the longest time.
      const lastFormat = (f: AdFormat) => mine.findIndex((p) => p.format === f);
      const format = [...ORGANIC_FORMATS].sort((a, b) => {
        const ia = lastFormat(a), ib = lastFormat(b);
        return (ia < 0 ? -1e6 : -ia) - (ib < 0 ? -1e6 : -ib) || ORGANIC_FORMATS.indexOf(a) - ORGANIC_FORMATS.indexOf(b);
      })[0]!;
      const res = ctx.tools.postOrganic({ productId: product.id, hook: pick.hook, hookStyle: pick.hookStyle, format });
      if (!res.ok) {
        // A throttled/limited post is not a failure of the poster's work: it is postponed.
        if (/aujourd|limite|portée|quota|trop de posts/i.test(res.message)) {
          say(ctx, agent.id, `${agent.name} garde son post pour demain : ${short(res.message, 70)}`, 'thought', { productId: product.id });
          return { summary: `Post reporté : ${res.message}`, skipReview: true, output: { skipped: true, reason: res.message } };
        }
        return { fail: `Publication refusée : ${res.message}`, summary: res.message };
      }
      say(ctx, agent.id, `${agent.name} poste un TikTok : « ${short(pick.hook, 70)} »`, 'ad', { productId: product.id });
      return { summary: `TikTok organique publié (${HOOK_LABELS[pick.hookStyle] ?? pick.hookStyle}, ${FORMAT_LABELS[format]}).`, output: { postId: res.id ?? null, hook: pick.hook, hookStyle: pick.hookStyle, format } };
    },
  },
};
