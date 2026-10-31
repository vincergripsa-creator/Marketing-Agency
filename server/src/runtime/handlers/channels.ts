/** The channels' desk: an account to open, a creative for another format, Search ads, and what each platform really sold (channels §5.2, §7). */
import type { AdCreative, AdRatio, AttributionRow, ChannelId, DailyAdStats, Task } from '../../shared.js';
import { CHANNELS, CHANNEL_IDS } from '../../shared.js';
import { nextId } from '../../core/index.js';
import { RECON, reconcile } from '../../learning/attribution.js';
import { CHANNEL_ROLE, submitToChannel } from '../channels.js';
import type { RuntimeCtx } from '../ctx.js';
import { addDeliverable, nameOf, productOf, say, vocOf, writeNote, writeRunFile } from '../ctx.js';
import { adsHold } from '../holds.js';
import { deliverables, sim } from '../modules.js';
import { requestRole } from '../org/hiring.js';
import { officerId, roleHolders } from '../org/officers.js';
import { directivesOf, HOOK_STYLES } from '../playbook.js';
import { taskChannel } from '../tasks.js';
import { upsellContextOf } from '../upsell.js';
import { dec, eur, round2, short, str, uniq } from '../util.js';
import type { HandlerMap } from './common.js';
import { mindWith, NO_PRODUCT, requireProduct, reworkNotes } from './common.js';
import { ensureDesign } from './creation.js';
import { reworkCraft } from './growth.js';
import { COMPLIANCE_WORDS } from './phrases.js';

const NOTHING = { skipReview: true, output: { skipped: true, dropped: true } };

/** What the channel's writers may not say, the growth lead's own list included. */
function bannedFor(ctx: RuntimeCtx, nicheId: string, agentId: string): string[] {
  const w = ctx.world;
  return uniq([...vocOf(ctx, nicheId).bannedClaims, ...directivesOf(w, agentId).banned, ...directivesOf(w, officerId(w, 'growth')).banned, ...COMPLIANCE_WORDS]);
}

/** Notes of the review, read by the writer on a rework. */
const reviewNotes = (ctx: RuntimeCtx, task: Task): string[] => reworkNotes(task).map((n) => `Correction demandée par ${nameOf(ctx, officerId(ctx.world, 'growth'))} : ${n}`);

/** The creative a task already wrote: a rework overwrites it instead of spending a new id. */
const ownCreative = (ctx: RuntimeCtx, task: Task): AdCreative | undefined => ctx.world.company.creatives.find((c) => c.id === task.output?.creativeId);

/** A new creative for a channel. `review` stays TikTok's and never moves: this one only lives in `channelReviews`. */
function newCreative(ctx: RuntimeCtx, agentId: string, ch: ChannelId, body: Pick<AdCreative, 'productId' | 'hook' | 'hookStyle' | 'format' | 'scenes' | 'caption' | 'hashtags' | 'cta'>): AdCreative {
  const w = ctx.world;
  const creative: AdCreative = {
    id: nextId(w, 'cre'), ...body, files: { storyboard: [], preview: null }, quality: null, review: { status: 'pending', reason: null, day: null },
    createdDay: w.day, createdBy: agentId, channelReviews: { [ch]: { status: 'pending', reason: null, day: null } },
  };
  w.company.creatives.push(creative);
  return creative;
}

/** The creative goes to its channel once its reviewer signed. */
async function submitDone(ctx: RuntimeCtx, task: Task): Promise<void> {
  const creative = ownCreative(ctx, task);
  const product = productOf(ctx, task.input.productId);
  if (!creative || !product || product.status === 'killed' || task.output?.dropped === true) return;
  const ch = taskChannel(task);
  if (submitToChannel(ctx, creative, product, ch).status !== 'approved') return;
  const attach = ctx.world.company.campaigns.find((c) => c.id === task.input.attachTo && c.status === 'active');
  if (!attach || attach.creativeIds.includes(creative.id)) return;
  const ids = [...attach.creativeIds, creative.id];
  if (ctx.tools.updateCampaign(attach.id, { creativeIds: ids }).ok) attach.creativeIds = ids;
}

// ───────────────────────────── attribution ─────────────────────────────

type Row = Pick<DailyAdStats, 'channel' | 'spend' | 'revenue' | 'claimedRevenue'> & { campaignId: string };

/** What each ad manager claims, next to what the shop's own orders say of the same campaign. */
function campaignRows(ctx: RuntimeCtx, fromDay: number): Row[] {
  const shop = new Map<string, number>();
  for (const r of ctx.tools.getShopAttribution(fromDay)) if (r.campaignId) shop.set(r.campaignId, (shop.get(r.campaignId) ?? 0) + r.revenue);
  const rows = new Map<string, Row>();
  for (const channel of CHANNEL_IDS) {
    for (const r of ctx.tools.getPlatformReport(channel, fromDay)) {
      const row = rows.get(r.campaignId) ?? { campaignId: r.campaignId, channel, spend: 0, revenue: round2(shop.get(r.campaignId) ?? 0), claimedRevenue: 0 };
      row.spend = round2(row.spend + r.spend);
      row.claimedRevenue = round2((row.claimedRevenue ?? 0) + r.claimedRevenue);
      rows.set(r.campaignId, row);
    }
  }
  return [...rows.values()];
}

/** Credit per (niche, channel), only where the shop saw enough to read one. */
function nicheCredits(ctx: RuntimeCtx, rows: readonly Row[]): Record<string, Partial<Record<ChannelId, number>>> {
  const w = ctx.world;
  const byNiche = new Map<string, Row[]>();
  for (const row of rows) {
    const productId = w.company.campaigns.find((c) => c.id === row.campaignId)?.productId;
    const nicheId = productOf(ctx, productId)?.nicheId;
    if (nicheId) byNiche.set(nicheId, [...(byNiche.get(nicheId) ?? []), row]);
  }
  const niches: Record<string, Partial<Record<ChannelId, number>>> = {};
  for (const [nicheId, list] of byNiche) {
    const credits = reconcile(list).filter((a) => a.shopRevenue >= RECON.minNicheRevenue);
    if (credits.length) niches[nicheId] = Object.fromEntries(credits.map((a) => [a.channel, a.credit]));
  }
  return niches;
}

const attributionLine = (r: AttributionRow): string => `- ${CHANNELS[r.channel].label} : ${eur(r.spend)} dépensés, ${eur(r.claimedRevenue)} annoncés, ${eur(r.shopRevenue)} vus par la boutique, ${eur(r.reconciledRevenue)} réconciliés.`;

export const channelHandlers: HandlerMap = {
  open_channel: {
    async run(ctx, task, agent) {
      const w = ctx.world;
      const book = w.company.channels;
      const ch = taskChannel(task);
      const { label } = CHANNELS[ch];
      if (!book || book.open.includes(ch) || book.requested[ch] !== undefined) return { summary: `${label} n'a rien à ouvrir.`, skipReview: true, output: { skipped: true } };
      const role = CHANNEL_ROLE[ch];
      if (!roleHolders(w, role).length) {
        const asked = requestRole(ctx, role, task.createdBy === 'founder' ? 'founder' : 'channel', `${label} n'a pas encore son acheteur.`);
        return { summary: asked ? `Pas d'acheteur pour ${label} : le poste est ouvert.` : `Pas d'acheteur pour ${label}, pas de canal.`, skipReview: true, output: { skipped: true, reason: 'role' } };
      }
      if (w.scenario.founderApproval && task.input.founderApproved !== true) return { summary: `Compte ${label} prêt : en attente du fondateur.`, awaitFounder: `Ouvrir le canal ${label}` };
      const res = ctx.tools.requestChannel(ch);
      if (!res.ok) return { fail: res.message, summary: res.message };
      book.requested[ch] = w.day;
      say(ctx, agent.id, `${agent.name} : ${res.message}`, 'ad');
      return { summary: res.message, skipReview: true, output: { channel: ch } };
    },
  },

  adapt_creative: {
    async run(ctx, task, agent, mind) {
      const w = ctx.world;
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const ch = taskChannel(task);
      const held = adsHold(w, product.id, ch);
      if (held) return { summary: `Pas de créa : ${held.reason}.`, ...NOTHING };
      const master = w.company.creatives.find((c) => c.id === task.input.masterId && c.productId === product.id);
      if (!master) return { summary: 'La créa de départ n’existe plus : rien à adapter.', ...NOTHING };
      const voc = vocOf(ctx, product.nicheId);
      const ratio = str(task.input.ratio) as Exclude<AdRatio, 'text'>;
      // Pinterest has no script to cut: one image, drawn over the guide's cover. Anywhere else the script stays the master's.
      const script: Pick<AdCreative, 'hook' | 'hookStyle' | 'format' | 'scenes' | 'caption' | 'hashtags' | 'cta'> = { hook: master.hook, hookStyle: master.hookStyle, format: master.format, scenes: master.scenes, caption: master.caption, hashtags: master.hashtags, cta: master.cta };
      if (ratio === '2:3') {
        const bannedClaims = bannedFor(ctx, product.nicheId, agent.id);
        const ad = await ctx.engine.writeAd({ product, voc, hook: master.hook, hookStyle: master.hookStyle, format: 'static_image', bannedClaims, upsellOf: upsellContextOf(w, product) }, reworkCraft(task, mindWith(mind, reviewNotes(ctx, task))));
        Object.assign(script, { hook: ad.hook || master.hook, format: 'static_image', scenes: Array.isArray(ad.scenes) ? ad.scenes : [], caption: ad.caption ?? '', hashtags: Array.isArray(ad.hashtags) ? ad.hashtags : [], cta: ad.cta ?? '' });
      }
      const creative = ownCreative(ctx, task) ?? newCreative(ctx, agent.id, ch, { productId: product.id, ...script });
      Object.assign(creative, script, { ratio, masterId: master.id, createdBy: agent.id });
      const board = deliverables.renderAdCut({ creative, product, design: ensureDesign(ctx, product), brand: w.company.name, ratio });
      const frames: string[] = [];
      for (let i = 0; i < board.frames.length; i++) {
        const rel = `files/${product.id}/ads/${creative.id}/frame-${i + 1}.svg`;
        await writeRunFile(ctx, rel, board.frames[i]!);
        frames.push(rel);
      }
      creative.files = { storyboard: frames, preview: null };
      creative.quality = sim.scoreCreative(creative, product, voc);
      if (frames[0]) addDeliverable(ctx, { kind: 'ad_storyboard', title: `Créa ${ratio} « ${short(creative.hook, 50)} »`, productId: product.id, creativeId: creative.id, path: frames[0], createdBy: agent.id, quality: creative.quality.overall }, task);
      return { summary: `Créa ${ratio} pour ${CHANNELS[ch].label} : qualité ${creative.quality.overall}/100.`, output: { creativeId: creative.id, channel: ch, score: creative.quality.overall } };
    },
    onDone: submitDone,
  },

  write_search_ads: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const ch = taskChannel(task);
      const held = adsHold(ctx.world, product.id, ch);
      if (held) return { summary: `Pas d'annonces : ${held.reason}.`, ...NOTHING };
      const voc = vocOf(ctx, product.nicheId);
      const draft = await ctx.engine.writeSearchAd({ product, voc, bannedClaims: bannedFor(ctx, product.nicheId, agent.id) }, reworkCraft(task, mindWith(mind, reviewNotes(ctx, task))));
      const text = { hook: draft.headlines[0] ?? product.title, caption: draft.descriptions[0] ?? '', hashtags: draft.keywords };
      const creative = ownCreative(ctx, task) ?? newCreative(ctx, agent.id, ch, { productId: product.id, ...text, hookStyle: HOOK_STYLES[0]!, format: 'search_text', scenes: [], cta: '' });
      Object.assign(creative, text, { ratio: 'text', search: { headlines: draft.headlines, descriptions: draft.descriptions, keywords: draft.keywords }, createdBy: agent.id });
      creative.quality = sim.scoreCreative(creative, product, voc);
      return { summary: `${draft.headlines.length} titres et ${draft.keywords.length} mots-clés : qualité ${creative.quality.overall}/100.`, output: { creativeId: creative.id, channel: ch, score: creative.quality.overall } };
    },
    onDone: submitDone,
  },

  reconcile_channels: {
    async run(ctx, task, agent) {
      const w = ctx.world;
      const book = w.company.channels;
      if (!book) return { summary: 'Un seul canal : rien à rapprocher.', skipReview: true, output: { skipped: true } };
      const toDay = sim.lastClosedDay(w);
      const fromDay = Math.max(1, toDay - RECON.windowDays + 1);
      const rows = campaignRows(ctx, fromDay);
      const report = reconcile(rows);
      book.attribution = { day: w.day, fromDay, toDay, by: agent.id, rows: report, niches: nicheCredits(ctx, rows) };
      const worst = [...report].filter((r) => r.shopRevenue > 0).sort((a, b) => b.inflation - a.inflation || a.channel.localeCompare(b.channel))[0];
      const line = worst ? `${CHANNELS[worst.channel].label} s'attribue ${dec(worst.inflation, 1)} fois ce que la boutique voit` : 'La boutique n’a encore vu aucune vente payante';
      await writeNote(ctx, agent.id, { path: 'rapports/attribution-canaux.md', title: 'Attribution des canaux', tags: ['attribution', 'canaux'], body: [`# Attribution des canaux, jours ${fromDay} à ${toDay}`, '', `${line}.`, '', ...report.map(attributionLine), '', 'Liens : [[Budget et garde-fous]] · [[Conformité pub par canal]]'].join('\n') });
      say(ctx, agent.id, `${agent.name} : ${line}`, 'finance');
      return { summary: `${line}.`, skipReview: true, output: { channels: report.length } };
    },
  },
};
