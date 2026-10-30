/** Pub TikTok: hooks (bandit + exploration), 9:16 creatives, compliance submission, campaigns, stop-loss/scale, organic. */
import type { AdCreative, AdFormat, Campaign, HookStyle, Product, Task } from '../../shared.js';
import { nextId } from '../../core/index.js';
import type { RuntimeCtx } from '../ctx.js';
import { addDeliverable, incident, nameOf, nicheBriefOf, nicheName, productOf, say, vocOf, writeRunFile, doneOutputs } from '../ctx.js';
import { deliverables, learning, sim } from '../modules.js';
import { addPlaybookRule, AD_FORMATS, bannedHits, directivesOf, HOOK_STYLES } from '../playbook.js';
import { activeCampaigns, campaignMetrics, committedAdBudget, currentBudget } from '../metrics.js';
import { createTask, isOpen } from '../tasks.js';
import { clamp, dec, eur, numOf, pct, round2, short, str, uniq } from '../util.js';
import type { HandlerMap } from './common.js';
import { NO_PRODUCT, requireProduct, reworkNotes, mindWith } from './common.js';
import { COMPLIANCE_WORDS, FORMAT_LABELS, HOOK_LABELS } from './phrases.js';
import { ensureDesign } from './creation.js';

interface HookItem { hookStyle: HookStyle; hook: string }

const GROWTH_WRITERS = ['sarah', 'chloe', 'tom', 'leo'];

function runningExperiment(ctx: RuntimeCtx, dimension: string) {
  return ctx.world.company.experiments.find((e) => e.status === 'running' && e.dimension === dimension) ?? null;
}

function isHookStyle(v: unknown): v is HookStyle {
  return typeof v === 'string' && (HOOK_STYLES as readonly string[]).includes(v);
}
function isFormat(v: unknown): v is AdFormat {
  return typeof v === 'string' && (AD_FORMATS as readonly string[]).includes(v);
}

/** Every hook written for a product, newest first. */
export function hookPool(ctx: RuntimeCtx, productId: string): HookItem[] {
  const out: HookItem[] = [];
  for (const o of doneOutputs(ctx.world, 'write_ad_hooks', productId).reverse()) {
    const hooks = Array.isArray(o.hooks) ? (o.hooks as unknown[]) : [];
    for (const h of hooks) {
      const r = h as Partial<HookItem>;
      if (r && typeof r.hook === 'string' && isHookStyle(r.hookStyle)) out.push({ hook: r.hook, hookStyle: r.hookStyle });
    }
  }
  return out;
}

function bannedFor(ctx: RuntimeCtx, product: Product, agentId: string): string[] {
  const voc = vocOf(ctx, product.nicheId);
  return uniq([...voc.bannedClaims, ...directivesOf(ctx.world, agentId).banned, ...directivesOf(ctx.world, 'leo').banned]);
}

export function creativeText(c: AdCreative): string {
  return [c.hook, c.caption, c.cta, ...c.scenes.flatMap((s) => [s.onScreenText, s.voiceover])].join(' \n ');
}

/** Words from our compliance lists found in a rejected creative → they become "Ne jamais écrire" rules. */
function learnFromRejection(ctx: RuntimeCtx, c: AdCreative, product: Product): string[] {
  const voc = vocOf(ctx, product.nicheId);
  const hits = uniq([...bannedHits(creativeText(c), voc.bannedClaims), ...bannedHits(creativeText(c), COMPLIANCE_WORDS)]).slice(0, 3);
  for (const h of hits) for (const id of GROWTH_WRITERS) addPlaybookRule(ctx.world, id, `Ne jamais écrire « ${h} »`);
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

/** Daily budget a new campaign may get inside the CFO's envelope. */
function launchBudget(ctx: RuntimeCtx): { budget: number; remaining: number; cap: number } {
  const b = currentBudget(ctx.world);
  const remaining = round2(Math.max(0, b.adCap - committedAdBudget(ctx.world)));
  const base = clamp(b.cash * 0.04, 5, 40);
  return { budget: Math.floor(Math.min(remaining, base)), remaining, cap: b.adCap };
}

function requestCreatives(ctx: RuntimeCtx, product: Product, task: Task, opts: { produce: number; attachTo?: string; launch?: boolean; why: string }): boolean {
  const open = ctx.world.company.tasks.some((t) => isOpen(t) && t.input.productId === product.id && (t.kind === 'write_ad_hooks' || t.kind === 'produce_ad'));
  const mine = ctx.world.company.creatives.filter((c) => c.productId === product.id);
  const inUse = new Set(activeCampaigns(ctx.world).flatMap((c) => c.creativeIds));
  // Fresh = pending review, running, or approved but never shown: no point stacking more of those.
  const fresh = mine.filter((c) => c.review.status === 'pending' || inUse.has(c.id) || (c.review.status === 'approved' && !(ctx.world.market.creativeImpressions[c.id] > 0)));
  if (open || fresh.length >= 6 || mine.length >= 60) return false;
  createTask(ctx.world, {
    kind: 'write_ad_hooks', title: `Nouveaux hooks — « ${short(product.title, 42)} »`,
    input: { productId: product.id, nicheId: product.nicheId, produce: opts.produce, ...(opts.attachTo ? { attachTo: opts.attachTo } : {}), ...(opts.launch ? { launch: true } : {}) },
    createdBy: task.assignee ?? 'leo', missionId: task.missionId, priority: 2,
  });
  say(ctx, task.assignee ?? 'leo', `${nameOf(ctx, task.assignee ?? 'leo')} demande ${opts.produce} nouvelle(s) créa(s) : ${opts.why}`, 'thought', { productId: product.id });
  return true;
}

export const growthHandlers: HandlerMap = {
  write_ad_hooks: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const voc = vocOf(ctx, product.nicheId);
      const dim = `hook_style:${product.nicheId}`;
      const d = directivesOf(ctx.world, agent.id, nicheName(ctx, product.nicheId));
      const styles: HookStyle[] = [];
      if (d.hook) styles.push(d.hook);
      const exp = runningExperiment(ctx, 'hook_style');
      if (exp) for (const v of exp.variants) if (isHookStyle(v)) styles.push(v);
      for (let i = 0; i < 8 && uniq(styles).length < 4; i++) {
        const s = learning.chooseArm(ctx.world, dim, HOOK_STYLES, ctx.rng);
        if (isHookStyle(s)) styles.push(s);
      }
      const pulled = new Set(learning.armStats(ctx.world, dim).filter((s) => s.pulls > 0).map((s) => s.key));
      const untried = HOOK_STYLES.filter((s) => !pulled.has(s) && !styles.includes(s));
      if (untried.length) styles.push(ctx.rng.pick(untried)); // exploration
      const chosen = uniq(styles).slice(0, 5);
      const banned = bannedFor(ctx, product, agent.id);
      const raw = await ctx.engine.writeAdHooks({ product, voc, styles: chosen }, mindWith(mind, banned.map((b) => `Ne jamais écrire « ${b} »`)));
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
      if (!n || !product || product.status === 'killed') return;
      const used = ctx.world.company.creatives.filter((c) => c.productId === product.id).length;
      const ads = Array.from({ length: n }, (_, i) => createTask(ctx.world, {
        kind: 'produce_ad', title: `Produire une pub TikTok n° ${used + i + 1} — « ${short(product.title, 40)} »`,
        input: { productId: product.id, nicheId: product.nicheId, variant: used + i, ...(str(task.input.attachTo) ? { attachTo: str(task.input.attachTo) } : {}) },
        dependsOn: [], createdBy: task.assignee ?? 'leo', missionId: task.missionId, priority: task.priority,
      }));
      if (task.input.launch === true) {
        createTask(ctx.world, { kind: 'launch_campaign', title: `Relancer une campagne — « ${short(product.title, 42)} »`, input: { productId: product.id, nicheId: product.nicheId }, dependsOn: ads.map((a) => a.id), createdBy: task.assignee ?? 'leo', missionId: task.missionId, priority: task.priority });
      }
    },
  },

  produce_ad: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const voc = vocOf(ctx, product.nicheId);
      const variant = Math.max(0, Math.round(numOf(task.input.variant) ?? 0));
      const existingId = str(task.output?.creativeId);
      const existing = existingId ? ctx.world.company.creatives.find((c) => c.id === existingId) : undefined;
      // Hook: newest unused hook (experiment style first), the rework takes another one.
      let pool = hookPool(ctx, product.id);
      if (!pool.length) {
        const fresh = await ctx.engine.writeAdHooks({ product, voc, styles: [ctx.rng.pick(HOOK_STYLES)] }, mind);
        pool = fresh.filter((h) => h && typeof h.hook === 'string' && isHookStyle(h.hookStyle));
      }
      if (!pool.length) return { fail: 'Pas de hook disponible pour produire la pub.', summary: 'Pas de hook.' };
      const used = new Set(ctx.world.company.creatives.filter((c) => c.productId === product.id && c.id !== existingId).map((c) => c.hook));
      if (existing && task.attempts > 0) used.add(existing.hook);
      const hookExp = runningExperiment(ctx, 'hook_style');
      const wanted = hookExp && hookExp.variants.length ? hookExp.variants[variant % hookExp.variants.length] : null;
      const unused = pool.filter((h) => !used.has(h.hook));
      const hook = (wanted ? unused.find((h) => h.hookStyle === wanted) : undefined) ?? unused[variant % Math.max(1, unused.length)] ?? pool[variant % pool.length]!;
      // Format: playbook preference for the first ad, experiment variants, else the bandit.
      const d = directivesOf(ctx.world, agent.id, nicheName(ctx, product.nicheId));
      const fmtExp = runningExperiment(ctx, 'ad_format');
      let format: AdFormat;
      if (fmtExp && fmtExp.variants.length && isFormat(fmtExp.variants[variant % fmtExp.variants.length])) format = fmtExp.variants[variant % fmtExp.variants.length] as AdFormat;
      else if (d.format && variant === 0) format = d.format;
      else { const f = learning.chooseArm(ctx.world, `ad_format:${product.nicheId}`, AD_FORMATS, ctx.rng); format = isFormat(f) ? f : 'text_slideshow'; }
      const bannedClaims = uniq([...bannedFor(ctx, product, agent.id), ...COMPLIANCE_WORDS]);
      const notes = reworkNotes(task).map((n) => `Correction demandée par Léo : ${n}`);
      const draft = await ctx.engine.writeAd({ product, voc, hook: hook.hook, hookStyle: hook.hookStyle, format, bannedClaims }, mindWith(mind, notes));
      const creative: AdCreative = existing ?? {
        id: nextId(ctx.world, 'cre'), productId: product.id, hook: '', hookStyle: hook.hookStyle, format, scenes: [], caption: '', hashtags: [], cta: '',
        files: { storyboard: [], preview: null }, quality: null, review: { status: 'pending', reason: null, day: null }, createdDay: ctx.world.day, createdBy: agent.id,
      };
      Object.assign(creative, {
        hook: draft.hook || hook.hook, hookStyle: isHookStyle(draft.hookStyle) ? draft.hookStyle : hook.hookStyle,
        format: isFormat(draft.format) ? draft.format : format, scenes: Array.isArray(draft.scenes) ? draft.scenes : [],
        caption: draft.caption ?? '', hashtags: Array.isArray(draft.hashtags) ? draft.hashtags : [], cta: draft.cta ?? '',
        review: { status: 'pending', reason: null, day: null }, createdBy: agent.id,
      });
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
      if (!creative || !product || product.status === 'killed') return;
      const res = ctx.tools.submitCreative(creative.id);
      creative.review = { status: res.status, reason: res.reason, day: ctx.world.day };
      if (res.status === 'approved') {
        say(ctx, 'leo', `TikTok valide la pub « ${short(creative.hook, 60)} »`, 'ad', { creativeId: creative.id, productId: product.id });
        const attach = ctx.world.company.campaigns.find((c) => c.id === task.input.attachTo && c.status === 'active');
        if (attach && !attach.creativeIds.includes(creative.id)) {
          const ids = [...attach.creativeIds, creative.id];
          const up = ctx.tools.updateCampaign(attach.id, { creativeIds: ids });
          if (up.ok) attach.creativeIds = ids;
        }
      } else {
        const hits = learnFromRejection(ctx, creative, product);
        const reason = res.reason ?? 'non conforme';
        incident(ctx, `Pub refusée par TikTok (« ${short(creative.hook, 50)} ») : ${reason}${hits.length ? ` — mots en cause : ${hits.join(', ')}` : ''}`);
        say(ctx, 'leo', `TikTok refuse la pub « ${short(creative.hook, 50)} » : ${short(reason, 70)}${res.strike ? ' — avertissement sur le compte !' : ''}`, 'ad', { creativeId: creative.id, productId: product.id });
        if (hits.length) say(ctx, 'nora', `Leçon immédiate : l'équipe pub n'écrira plus jamais « ${hits.join(' », « ')} »`, 'lesson');
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
      if (ctx.world.market.adAccount.banned) return { fail: 'Compte publicitaire suspendu : aucune campagne possible.', summary: 'Compte suspendu.' };
      const budget = currentBudget(ctx.world);
      if (budget.bankrupt || budget.survival) {
        return { summary: budget.bankrupt ? 'Trésorerie négative : aucune dépense pub.' : 'Mode survie : pas de nouvelle campagne payante.', skipReview: true, output: { skipped: true, reason: budget.bankrupt ? 'bankrupt' : 'survival' } };
      }
      const inUse = new Set(activeCampaigns(ctx.world).flatMap((c) => c.creativeIds));
      const ready = ctx.world.company.creatives.filter((c) => c.productId === product.id && c.review.status === 'approved' && !inUse.has(c.id));
      if (!ready.length) {
        const launches = ctx.world.company.tasks.filter((t) => t.kind === 'launch_campaign' && t.input.productId === product.id).length;
        const asked = launches <= 4 && requestCreatives(ctx, product, task, { produce: 2, launch: true, why: 'aucune créa validée par TikTok' });
        return { summary: asked ? 'Aucune créa validée : Sarah réécrit des hooks.' : 'Aucune créa validée disponible.', skipReview: true, output: { skipped: true, reason: 'no_creative' } };
      }
      const { budget: daily, remaining } = launchBudget(ctx);
      if (daily < 5) return { summary: `Enveloppe CFO insuffisante (${eur(remaining)} restants).`, skipReview: true, output: { skipped: true, reason: 'budget', remaining } };
      if (ctx.world.scenario.founderApproval && task.input.founderApproved !== true) {
        return { summary: `Campagne prête (${eur(daily)}/jour, ${ready.length} créas) : en attente du fondateur.`, awaitFounder: `Lancer une campagne TikTok à ${eur(daily)}/jour pour « ${product.title} »` };
      }
      const creatives = ready.slice(0, 3);
      const n = ctx.world.company.campaigns.filter((c) => c.productId === product.id).length + 1;
      const input = { productId: product.id, name: `${short(product.title, 40)} — campagne ${n}`, creativeIds: creatives.map((c) => c.id), dailyBudget: daily, targeting: targetingFor(ctx, product), createdBy: agent.id };
      const res = ctx.tools.createCampaign(input);
      if (!res.ok) {
        incident(ctx, `Campagne refusée pour « ${product.title} » : ${res.message}`);
        return { fail: `La plateforme refuse la campagne : ${res.message}`, summary: res.message };
      }
      const id = res.id ?? nextId(ctx.world, 'cmp');
      if (!ctx.world.company.campaigns.some((c) => c.id === id)) {
        ctx.world.company.campaigns.push({ id, productId: input.productId, name: input.name, creativeIds: input.creativeIds, dailyBudget: input.dailyBudget, status: 'active', targeting: input.targeting, startDay: ctx.world.day, createdBy: agent.id });
      }
      say(ctx, agent.id, `${agent.name} lance « ${input.name} » : ${eur(daily)}/jour, ${creatives.length} créas, ${input.targeting.ageMin}-${input.targeting.ageMax} ans`, 'ad', { productId: product.id });
      return { summary: `Campagne lancée à ${eur(daily)}/jour avec ${creatives.length} créas.`, output: { campaignId: id, dailyBudget: daily, creativeIds: input.creativeIds } };
    },
  },

  optimize_ads: {
    async run(ctx, task, agent) {
      const budget = currentBudget(ctx.world);
      const campaigns = activeCampaigns(ctx.world);
      if (!campaigns.length) return { summary: 'Aucune campagne active.', skipReview: true, output: { actions: [] } };
      const stats = ctx.tools.getAdStats(Math.max(1, ctx.world.day - 7));
      const all = ctx.tools.getAdStats(1);
      const actions: string[] = [];
      const pause = (c: Campaign, why: string) => {
        const r = ctx.tools.updateCampaign(c.id, { status: 'paused' });
        if (r.ok) c.status = 'paused';
        actions.push(`${c.name} en pause : ${why}`);
        incident(ctx, `Campagne « ${c.name} » mise en pause : ${why}`);
      };
      for (const c of campaigns) {
        const product = productOf(ctx, c.productId);
        if (!product || product.status === 'killed' || product.status === 'paused') { pause(c, 'produit arrêté'); continue; }
        if (budget.bankrupt) { pause(c, 'trésorerie négative'); continue; }
        const life = campaignMetrics(all, c.id, c.startDay);
        const recent = campaignMetrics(stats, c.id, Math.max(c.startDay, ctx.world.day - 3));
        const yesterday = campaignMetrics(stats, c.id, Math.max(c.startDay, ctx.world.day - 1));
        // 1. Stop-loss, on the whole life of the campaign AND on the last 3 days (a winner can turn into a loser).
        if (life.spend >= 25 && life.roas < 0.8) {
          pause(c, `stop-loss, ROAS ${dec(life.roas)} après ${eur(life.spend)}`);
          requestCreatives(ctx, product, task, { produce: 2, launch: true, why: `ROAS ${dec(life.roas)} : il faut un nouvel angle` });
          continue;
        }
        if (recent.spend >= 30 && recent.roas < 0.8) {
          pause(c, `stop-loss sur 3 jours, ROAS ${dec(recent.roas)} pour ${eur(recent.spend)}`);
          requestCreatives(ctx, product, task, { produce: 2, launch: true, why: `la campagne s'est essoufflée (ROAS 3 j ${dec(recent.roas)})` });
          continue;
        }
        // 2. Survival mode: only clearly profitable campaigns keep running.
        if (budget.survival && recent.spend >= 10 && recent.roas < 1.2) { pause(c, `mode survie, ROAS ${dec(recent.roas)}`); continue; }
        // 3. Creative fatigue / weak creatives (the last one stays until its replacement is approved).
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
        if (tired > 0 || (recent.impressions >= 2000 && recent.ctr < 0.008)) {
          requestCreatives(ctx, product, task, { produce: Math.max(1, Math.min(2, tired)), attachTo: c.id, why: tired ? `${tired} créa(s) fatiguée(s)` : `CTR en baisse (${pct(recent.ctr, 2)})` });
        }
        // 4. Scale winners (+30 % max) while the last day still holds, trim the lukewarm ones — inside the CFO envelope.
        const room = Math.max(0, budget.adCap - committedAdBudget(ctx.world, c.id));
        let next = c.dailyBudget;
        if (recent.spend >= 10 && recent.roas >= 1.8 && (yesterday.spend < 5 || yesterday.roas >= 1.4)) next = round2(c.dailyBudget * 1.3);
        else if (recent.spend >= 20 && recent.roas < 1.3) next = round2(c.dailyBudget * 0.7);
        next = round2(Math.max(5, Math.min(next, room)));
        if (room < 5) { pause(c, `enveloppe CFO épuisée (${eur(budget.adCap)})`); continue; }
        const before = c.dailyBudget;
        if (Math.abs(next - before) >= 0.5) {
          const r = ctx.tools.updateCampaign(c.id, { dailyBudget: next });
          if (r.ok) {
            actions.push(`${c.name} : ${eur(before)} → ${eur(next)}/jour (ROAS récent ${dec(recent.roas)})`);
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
      const voc = vocOf(ctx, product.nicheId);
      const style = (() => { const s = learning.chooseArm(ctx.world, `hook_style:${product.nicheId}`, HOOK_STYLES, ctx.rng); return isHookStyle(s) ? s : 'question'; })();
      const banned = bannedFor(ctx, product, agent.id);
      const posted = new Set(ctx.world.market.organicPosts.filter((p) => p.productId === product.id).map((p) => p.hook));
      const pool = [...hookPool(ctx, product.id), ...ctx.world.company.creatives.filter((c) => c.productId === product.id && c.review.status === 'approved').map((c) => ({ hook: c.hook, hookStyle: c.hookStyle }))]
        .filter((h) => !posted.has(h.hook) && !bannedHits(h.hook, banned).length);
      let pick = pool.find((h) => h.hookStyle === style) ?? pool[0];
      if (!pick) {
        const fresh = await ctx.engine.writeAdHooks({ product, voc, styles: [style] }, mind);
        const f = fresh.find((h) => h && typeof h.hook === 'string' && isHookStyle(h.hookStyle));
        if (f) pick = { hook: f.hook, hookStyle: f.hookStyle };
      }
      if (!pick) return { summary: 'Pas de hook pour le post organique.', skipReview: true, output: { skipped: true } };
      const formats: AdFormat[] = ['text_slideshow', 'faceless_voiceover', 'carousel'];
      const format = formats[(ctx.world.day + ctx.world.market.organicPosts.length) % formats.length]!;
      const res = ctx.tools.postOrganic({ productId: product.id, hook: pick.hook, hookStyle: pick.hookStyle, format });
      if (!res.ok) {
        // A throttled/limited post is not a failure of Tom's work: it is postponed.
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
