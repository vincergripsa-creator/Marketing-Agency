/**
 * MarketTools over the virtual market. This is the seam where the real world plugs in later:
 * the company only ever talks to these functions.
 */
import { clamp, emit, nextId, round2, streamRng } from '../core/index.js';
import type { AdReviewResult, ChannelAccountStatus, MarketTools, PlatformReportRow, Rng, ShopAttributionRow, ToolResult } from '../contracts.js';
import type {
  AdCreative, AdFormat, AudienceView, Campaign, CampaignInputShape, ChannelAccountState, ChannelId, ChannelMarketState, CompetitorProduct, CreatorProfile, HookStyle, InboxMessage, NicheBrief, Partnership,
  ReplyOutcome, SupportReplyInput, TrendSignal, VoiceOfCustomer, WorldState,
} from '../shared.js';
import { CHANNELS, CHANNEL_IDS, acceptance, channelOf } from '../shared.js';
import { ADS, ORGANIC, RESEARCH, SCAM } from './balance.js';
import { CHANNEL_SIM, CHANNEL_STREAM, type PaidChannel } from './channelBalance.js';
import { accountBanned, accountOf, approvedOn, channelSignals, learningAfterUpdate } from './channels.js';
import { channelViolationWord, findBannedClaims, findChannelViolation } from './compliance.js';
import { customerById, displayName } from './customers.js';
import { cashOf, recordLedger } from './finance.js';
import { reaction, scamAmount, type ReactionKey } from './inbox.js';
import { findNiche, isScammer } from './market.js';
import {
  campaignById, chargebackOrder, creativeById, nicheOf, orderById, partialRefund, productById, pushEvent, refundOrder, reviewProduct,
} from './ops.js';
import { actionRule, scorePdf, scoreSupportReply } from './quality.js';
import { fmtEur, fmtPct, keyTokens, norm, short, subset, uniform } from './text.js';

const fail = (message: string, id?: string): ToolResult => ({ ok: false, message, ...(id ? { id } : {}) });
const ok = (message: string, id?: string): ToolResult => ({ ok: true, message, ...(id ? { id } : {}) });

/** Share of the price given back by a goodwill gesture. */
const GOODWILL_SHARE = 0.4;

/** What a channel takes, for the message that refuses a creative. */
function wantedBy(ch: ChannelId): string {
  const ratio = CHANNELS[ch].accepts[0]!.ratio;
  return ratio === 'text' ? 'du texte' : `du ${ratio}`;
}

/** The creative's number, a key of its moderation stream. */
const idNum = (c: AdCreative): number => Number(c.id.replace(/\D/g, '')) || 0;

export function createMarketTools(world: WorldState, rng: Rng): MarketTools {
  const m = () => world.market;

  // ───────────── research ─────────────

  function searchTrends(query?: string): TrendSignal[] {
    const q = keyTokens(query ?? '');
    const niches = m().niches.filter((n) => {
      if (q.length === 0) return true;
      const hay = norm([n.name, n.audience, n.problem, n.category, ...n.keywords].join(' '));
      return q.some((t) => hay.includes(t));
    });
    return niches.map((n) => {
      const comp = n.competition + uniform(rng, -0.15, 0.15);
      const titles = rng.shuffle(n.competitors.map((c) => c.title)).slice(0, 3);
      return {
        nicheId: n.id, name: n.name, audience: n.audience, category: n.category,
        searchInterest: Math.round(clamp(n.demand * 100 + rng.int(-20, 20), 0, 100)),
        tiktokBuzz: Math.round(clamp(n.tiktokAffinity * 100 + rng.int(-20, 20), 0, 100)),
        competitionHint: comp < 0.35 ? 'faible' : comp < 0.65 ? 'moyenne' : 'forte',
        sampleTitles: titles,
      };
    });
  }

  function listCompetitors(nicheId: string): CompetitorProduct[] {
    const n = findNiche(world, nicheId);
    return n ? n.competitors.map((c) => ({ ...c, weaknesses: [...c.weaknesses] })) : [];
  }

  function minePains(nicheId: string, depth: 'quick' | 'deep'): VoiceOfCustomer {
    const n = findNiche(world, nicheId);
    const empty: VoiceOfCustomer = {
      nicheId, depth, pains: [], phrases: [], objections: [], desiredOutcomes: [],
      knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors: [], bannedClaims: [],
    };
    if (!n) return empty;
    const r = RESEARCH[depth];
    const v = n.voc;
    return {
      nicheId, depth,
      pains: subset(rng, v.pains, r), phrases: subset(rng, v.phrases, r), objections: subset(rng, v.objections, r),
      desiredOutcomes: subset(rng, v.desiredOutcomes, r),
      knowledge: {
        tips: subset(rng, v.knowledge.tips, r), steps: subset(rng, v.knowledge.steps, r), mistakes: subset(rng, v.knowledge.mistakes, r),
        examples: subset(rng, v.knowledge.examples, r), facts: subset(rng, v.knowledge.facts, r),
      },
      priceAnchors: subset(rng, v.priceAnchors, r), bannedClaims: subset(rng, v.bannedClaims, r),
    };
  }

  function nicheBrief(nicheId: string): NicheBrief | null {
    const n = findNiche(world, nicheId);
    return n ? { nicheId: n.id, name: n.name, audience: n.audience, problem: n.problem, category: n.category, keywords: [...n.keywords] } : null;
  }

  // ───────────── store ─────────────

  function publishProduct(productId: string): ToolResult {
    const p = productById(world, productId);
    if (!p) return fail('Produit introuvable.');
    if (p.status === 'killed') return fail(`« ${short(p.title)} » a été abandonné : impossible de le remettre en vente.`, p.id);
    if (!p.files?.pdf) return fail(`Publication refusée : le PDF de « ${short(p.title)} » n'a pas encore été généré.`, p.id);
    if (!p.salesPage) return fail(`Publication refusée : « ${short(p.title)} » n'a pas de page de vente.`, p.id);
    if (!(p.price > 0)) return fail(`Publication refusée : fixez d'abord un prix pour « ${short(p.title)} ».`, p.id);
    if (p.status === 'live') return ok(`« ${short(p.title)} » est déjà en ligne.`, p.id);
    p.status = 'live';
    p.launchedDay = p.launchedDay ?? world.day;
    const last = p.priceHistory[p.priceHistory.length - 1];
    if (!last || last.price !== p.price) p.priceHistory.push({ day: world.day, price: p.price });
    return ok(`« ${short(p.title)} » est en ligne sur la boutique à ${fmtEur(p.price)}.`, p.id);
  }

  function setPrice(productId: string, price: number): ToolResult {
    const p = productById(world, productId);
    if (!p) return fail('Produit introuvable.');
    if (!Number.isFinite(price) || price < 1 || price > 199) return fail('Prix invalide : choisissez un prix entre 1 € et 199 €.', p.id);
    const v = round2(price);
    if (v === p.price) return ok(`Le prix de « ${short(p.title)} » est déjà de ${fmtEur(v)}.`, p.id);
    const before = p.price;
    p.price = v;
    p.priceHistory.push({ day: world.day, price: v });
    return ok(`Prix de « ${short(p.title)} » : ${fmtEur(before)} → ${fmtEur(v)}.`, p.id);
  }

  function setProductStatus(productId: string, status: 'paused' | 'killed' | 'live'): ToolResult {
    const p = productById(world, productId);
    if (!p) return fail('Produit introuvable.');
    if (status === 'live') return publishProduct(productId);
    if (status === 'killed') {
      p.status = 'killed';
      for (const c of world.company.campaigns) if (c.productId === p.id && c.status === 'active') c.status = 'ended';
      return ok(`« ${short(p.title)} » est retiré de la vente définitivement (campagnes arrêtées).`, p.id);
    }
    if (p.status !== 'live') return fail(`« ${short(p.title)} » n'est pas en ligne : rien à mettre en pause.`, p.id);
    p.status = 'paused';
    return ok(`« ${short(p.title)} » est en pause (plus de ventes ni de diffusion pub).`, p.id);
  }

  // ───────────── ads ─────────────

  function banActive(): boolean {
    return accountBanned(m(), 'tiktok', world.day);
  }

  /** A channel's own account. TikTok's is `adAccount`, open since day one. Undefined on a TikTok-only world. */
  function ownAccount(ch: PaidChannel): ChannelAccountState | undefined {
    return m().channels?.accounts[CHANNELS[ch].account as keyof ChannelMarketState['accounts']];
  }

  function accountState(ch: ChannelId): ChannelAccountStatus['state'] {
    if (accountBanned(m(), ch, world.day)) return 'banned';
    if (ch === 'tiktok') return 'open';
    const openDay = ownAccount(ch)?.openDay ?? null;
    return openDay === null ? 'closed' : world.day < openDay ? 'verifying' : 'open';
  }

  /** Why a channel's account cannot act today, null when it can. */
  function accountBlock(ch: PaidChannel): string | null {
    const { label } = CHANNELS[ch];
    const acc = ownAccount(ch);
    switch (accountState(ch)) {
      case 'open': return null;
      case 'banned': return `Compte ${label} suspendu jusqu'au jour ${acc!.bannedUntilDay}.`;
      case 'verifying': return `Compte ${label} en vérification, ouverture au jour ${acc!.openDay}.`;
      case 'closed': return `${label} n'est pas ouvert à l'agence.`;
    }
  }

  /** One strike on the channel's account: every channel of that account pays for it, and no other. */
  function strikeAccount(ch: PaidChannel, refs: { creativeId: string; productId: string; nicheId: string | null }): string {
    const acc = ownAccount(ch)!;
    const { strikes, banDays } = CHANNEL_SIM[ch];
    if (acc.banned) Object.assign(acc, { banned: false, strikes: 0 }); // a ban that ran its term: the account starts over
    acc.strikes += 1;
    if (acc.strikes >= strikes) {
      acc.banned = true;
      acc.bannedUntilDay = world.day + banDays;
      const stopped = CHANNEL_IDS.filter((id) => CHANNELS[id].account === CHANNELS[ch].account).map((id) => CHANNELS[id].label).join(' et ');
      pushEvent(world, 'channel_account_banned', `Compte ${stopped} suspendu`,
        `${strikes} refus pour règles enfreintes : plus aucune campagne ${stopped} d'ici le jour ${acc.bannedUntilDay}.`, 'danger', refs);
    }
    return ` Avertissement ${Math.min(acc.strikes, strikes)}/${strikes}.`;
  }

  /** Every channel but TikTok, in the order of channels §6: account, format, banned claims, the channel's rules, false positive. */
  function submitToChannel(c: AdCreative, ch: PaidChannel): AdReviewResult {
    const { label } = CHANNELS[ch];
    const reject = (reason: string, strike: boolean, rule?: string): AdReviewResult => {
      (c.channelReviews ??= {})[ch] = { status: 'rejected', reason, day: world.day, ...(rule ? { rule } : {}) };
      return { status: 'rejected', reason, strike, channel: ch, ...(rule ? { rule } : {}) };
    };
    const blocked = accountBlock(ch);
    if (blocked) return reject(`${blocked} Aucune soumission possible.`, false);
    if (acceptance(ch, c) === null) return reject(`${label} refuse ce format : il faut ${wantedBy(ch)}.`, false);
    const p = productById(world, c.productId);
    const niche = p ? findNiche(world, p.nicheId) : undefined;
    const refs = { creativeId: c.id, productId: c.productId, nicheId: p?.nicheId ?? null };
    // keywords bid and never show: they are not the ad's text
    const texts = c.search ? [...c.search.headlines, ...c.search.descriptions]
      : [c.hook, ...(c.scenes ?? []).flatMap((s) => [s.onScreenText, s.voiceover]), c.caption, c.cta, ...(c.hashtags ?? [])];
    const banned = findBannedClaims(texts, niche?.voc.bannedClaims ?? []);
    if (banned.length) {
      pushEvent(world, 'ad_rejected', `Pub refusée par ${label}`, `« ${short(c.hook, 60)} » : allégation « ${banned[0]} » interdite.`, 'warn', refs);
      return reject(`Refusée par ${label} : l'allégation « ${banned[0]} » est interdite.${strikeAccount(ch, refs)}`, true);
    }
    const rule = p ? findChannelViolation(c, ch, p) : null;
    if (rule) {
      const word = channelViolationWord(c, rule, p!);
      pushEvent(world, 'ad_rejected', `Pub refusée par ${label}`, `« ${short(c.hook, 60)} » : ${rule.label} (« ${word} »).`, 'warn', refs);
      return reject(`Refusée par ${label} : ${rule.label} (« ${word} »).${rule.strike ? strikeAccount(ch, refs) : ''}`, rule.strike, rule.id);
    }
    // as on TikTok, an approved creative is never re-rolled
    if (c.channelReviews?.[ch]?.status === 'approved') return { status: 'approved', reason: null, strike: false, channel: ch };
    const review = streamRng(world.scenario.seed, CHANNEL_STREAM.reviews, world.day, idNum(c));
    if (niche && review.chance(CHANNEL_SIM[ch].falsePositive * niche.complianceRisk)) {
      emit(world, { agentId: null, kind: 'ad', text: `Pub « ${short(c.hook, 50)} » bloquée par la modération automatique de ${label} (sans avertissement).`, refs: { creativeId: c.id, productId: c.productId } });
      return reject(`Refusée par la modération automatique de ${label} : reformulez plus prudemment puis soumettez à nouveau (sans avertissement).`, false);
    }
    (c.channelReviews ??= {})[ch] = { status: 'approved', reason: null, day: world.day };
    emit(world, { agentId: null, kind: 'ad', text: `Pub « ${short(c.hook, 50)} » approuvée par ${label}.`, refs: { creativeId: c.id, productId: c.productId } });
    return { status: 'approved', reason: null, strike: false, channel: ch };
  }

  function submitCreative(creativeId: string, channel: ChannelId = 'tiktok'): AdReviewResult {
    const c = creativeById(world, creativeId);
    if (!c) return { status: 'rejected', reason: 'Créatif introuvable.', strike: false };
    if (channel !== 'tiktok') return submitToChannel(c, channel);
    const acc = m().adAccount;
    if (banActive()) {
      const reason = `Compte publicitaire suspendu jusqu'au jour ${acc.bannedUntilDay} : aucune soumission possible.`;
      c.review = { status: 'rejected', reason, day: world.day };
      return { status: 'rejected', reason, strike: false };
    }
    const p = productById(world, c.productId);
    const niche = p ? findNiche(world, p.nicheId) : undefined;
    const texts = [c.hook, ...(c.scenes ?? []).flatMap((s) => [s.onScreenText, s.voiceover]), c.caption, c.cta, ...(c.hashtags ?? [])];
    const banned = findBannedClaims(texts, niche?.voc.bannedClaims ?? []);
    const alreadyApproved = c.review.status === 'approved';
    if (banned.length) {
      acc.strikes += 1;
      const more = banned.length > 1 ? ` (et ${banned.length - 1} autre${banned.length > 2 ? 's' : ''} : ${banned.slice(1, 3).map((b) => `« ${b} »`).join(', ')})` : '';
      const reason = `Refusée : l'allégation « ${banned[0]} » enfreint les règles publicitaires de TikTok${more}. Avertissement ${Math.min(acc.strikes, ADS.strikesBeforeBan)}/${ADS.strikesBeforeBan}.`;
      c.review = { status: 'rejected', reason, day: world.day };
      const refs = { creativeId: c.id, productId: c.productId, nicheId: p?.nicheId ?? null };
      pushEvent(world, 'ad_rejected', 'Pub refusée par TikTok', `« ${short(c.hook, 60)} » : allégation « ${banned[0]} » interdite.`, 'warn', refs);
      if (acc.strikes >= ADS.strikesBeforeBan) {
        acc.banned = true;
        acc.bannedUntilDay = world.day + ADS.banDays;
        pushEvent(world, 'ad_account_banned', 'Compte publicitaire suspendu',
          `Trois refus pour allégations interdites : TikTok suspend le compte pub jusqu'au jour ${acc.bannedUntilDay}. Aucune campagne ne sera diffusée d'ici là.`, 'danger', refs);
      } else if (acc.strikes === ADS.strikesBeforeBan - 1) {
        pushEvent(world, 'ad_account_warning', 'Avertissement du compte pub',
          'Deuxième refus pour allégation interdite. Au prochain, le compte publicitaire sera suspendu 7 jours.', 'danger', refs);
      }
      return { status: 'rejected', reason, strike: true };
    }
    // an approved creative is only re-checked for banned claims, never re-rolled by the automatic moderation
    if (!alreadyApproved && niche && rng.chance(ADS.falsePositiveRate * niche.complianceRisk)) {
      const reason = 'Refusée par la modération automatique : allégation santé ou financière potentiellement trompeuse. Reformulez plus prudemment puis soumettez à nouveau (sans avertissement).';
      c.review = { status: 'rejected', reason, day: world.day };
      emit(world, { agentId: null, kind: 'ad', text: `Pub « ${short(c.hook, 50)} » bloquée par la modération automatique (sans avertissement).`, refs: { creativeId: c.id, productId: c.productId } });
      return { status: 'rejected', reason, strike: false };
    }
    if (alreadyApproved) return { status: 'approved', reason: null, strike: false };
    c.review = { status: 'approved', reason: null, day: world.day };
    emit(world, { agentId: null, kind: 'ad', text: `Pub « ${short(c.hook, 50)} » approuvée par TikTok.`, refs: { creativeId: c.id, productId: c.productId } });
    return { status: 'approved', reason: null, strike: false };
  }

  function approvedFor(productId: string, ids: readonly string[], ch: ChannelId): string[] {
    const out: string[] = [];
    for (const id of ids ?? []) {
      const c = creativeById(world, id);
      if (c && c.productId === productId && acceptance(ch, c) !== null && approvedOn(c, ch) && !out.includes(id)) out.push(id);
    }
    return out;
  }

  function createCampaign(input: CampaignInputShape): ToolResult {
    const ch = channelOf(input ?? {});
    if (ch === 'tiktok' && banActive()) return fail(`Compte publicitaire suspendu jusqu'au jour ${m().adAccount.bannedUntilDay} : impossible de créer une campagne.`);
    const blocked = ch === 'tiktok' ? null : accountBlock(ch);
    if (blocked) return fail(`${blocked} Impossible de créer une campagne.`);
    const p = productById(world, input?.productId);
    if (!p) return fail('Produit introuvable.');
    if (p.status !== 'live') return fail(`« ${short(p.title)} » n'est pas en ligne : publiez-le avant de lancer des pubs.`, p.id);
    const asked = (input.creativeIds ?? []).map((id) => creativeById(world, id)).filter((c): c is AdCreative => c?.productId === p.id);
    if (asked.length && asked.every((c) => acceptance(ch, c) === null)) return fail(`Aucune créa acceptée par ${CHANNELS[ch].label} : il faut ${wantedBy(ch)}.`, p.id);
    const creativeIds = approvedFor(p.id, input.creativeIds, ch);
    if (!creativeIds.length) return fail("Aucun créatif approuvé pour ce produit : soumettez d'abord les pubs à la modération.", p.id);
    const budget = round2(Number(input.dailyBudget));
    const minBudget = ch === 'tiktok' ? ADS.minDailyBudget : CHANNELS[ch].minDailyBudget;
    if (!Number.isFinite(budget) || budget < minBudget) return fail(`Budget quotidien minimum : ${fmtEur(minBudget)}.`, p.id);
    if (budget > ADS.maxDailyBudget) return fail(`Budget quotidien maximum : ${fmtEur(ADS.maxDailyBudget)}.`, p.id);
    const cash = cashOf(world);
    if (cash < budget) return fail(`Trésorerie insuffisante (${fmtEur(cash)}) pour un budget de ${fmtEur(budget)} par jour.`, p.id);
    const t = input.targeting ?? { interests: [], ageMin: 18, ageMax: 55 };
    const ageMin = Math.round(clamp(t.ageMin ?? 18, 13, 65));
    const campaign: Campaign = {
      id: nextId(world, 'cpg'),
      productId: p.id,
      name: (input.name ?? '').trim() || `Campagne ${short(p.title, 30)}`,
      creativeIds,
      dailyBudget: budget,
      status: 'active',
      targeting: { interests: [...(t.interests ?? [])], ageMin, ageMax: Math.round(clamp(t.ageMax ?? 55, ageMin, 65)) },
      startDay: world.day,
      createdBy: input.createdBy,
      ...(ch === 'tiktok' ? {} : { channel: ch }),
      ...(CHANNELS[ch].learning ? { learning: { events: 0, exitedDay: null } } : {}),
      ...(input.test ? { test: true } : {}),
      ...(world.company.archive ? { seq: world.company.archive.campaigns + world.company.campaigns.length } : {}), // D50: its index, had nothing left
    };
    world.company.campaigns.push(campaign);
    const dropped = (input.creativeIds?.length ?? 0) - creativeIds.length;
    return ok(`Campagne « ${campaign.name} » lancée : ${fmtEur(budget)}/jour, ${creativeIds.length} créatif(s)${dropped > 0 ? ` (${dropped} ignoré(s) car non approuvé(s))` : ''}.`, campaign.id);
  }

  function updateCampaign(campaignId: string, patch: { dailyBudget?: number; status?: 'active' | 'paused'; creativeIds?: string[] }): ToolResult {
    const c = campaignById(world, campaignId);
    if (!c) return fail('Campagne introuvable.');
    if (c.status === 'ended' || c.status === 'rejected') return fail(`La campagne « ${c.name} » est terminée.`, c.id);
    const ch = channelOf(c);
    const minBudget = ch === 'tiktok' ? ADS.minDailyBudget : CHANNELS[ch].minDailyBudget;
    // every field is checked before any is written: a refused patch changes nothing, not even its budget
    const before = { dailyBudget: c.dailyBudget, creativeIds: c.creativeIds };
    const next = { dailyBudget: c.dailyBudget, creativeIds: c.creativeIds, status: c.status };
    const changes: string[] = [];
    if (patch.dailyBudget !== undefined) {
      const b = round2(Number(patch.dailyBudget));
      if (!Number.isFinite(b) || b < minBudget || b > ADS.maxDailyBudget) return fail(`Budget invalide (entre ${fmtEur(minBudget)} et ${fmtEur(ADS.maxDailyBudget)}).`, c.id);
      if (b !== c.dailyBudget) changes.push(`budget ${fmtEur(c.dailyBudget)} → ${fmtEur(b)}`);
      next.dailyBudget = b;
    }
    if (patch.creativeIds) {
      const ids = approvedFor(c.productId, patch.creativeIds, ch);
      if (!ids.length) return fail('Aucun des créatifs proposés n\'est approuvé.', c.id);
      next.creativeIds = ids;
      changes.push(`${ids.length} créatif(s)`);
    }
    if (patch.status === 'active' && c.status !== 'active') {
      const p = productById(world, c.productId);
      if (!p || p.status !== 'live') return fail('Impossible de réactiver : le produit n\'est pas en ligne.', c.id);
      if (ch === 'tiktok' && banActive()) return fail(`Compte publicitaire suspendu jusqu'au jour ${m().adAccount.bannedUntilDay}.`, c.id);
      const blocked = ch === 'tiktok' ? null : accountBlock(ch);
      if (blocked) return fail(blocked, c.id);
      next.status = 'active';
      changes.push('réactivée');
    } else if (patch.status === 'paused' && c.status !== 'paused') {
      next.status = 'paused';
      changes.push('mise en pause');
    }
    Object.assign(c, next);
    learningAfterUpdate(c, before);
    return ok(changes.length ? `Campagne « ${c.name} » : ${changes.join(', ')}.` : `Campagne « ${c.name} » inchangée.`, c.id);
  }

  /** One channel's rows, TikTok's by default: a CTR only compares with the CTRs of its own channel. */
  function getAdStats(sinceDay?: number, channel: ChannelId = 'tiktok') {
    const since = sinceDay ?? 0;
    return m().adStats.filter((s) => s.day >= since && channelOf(s) === channel);
  }

  // ───────────── organic + creators ─────────────

  function postOrganic(input: { productId: string | null; hook: string; hookStyle: HookStyle; format: AdFormat }): ToolResult {
    const hook = (input?.hook ?? '').trim();
    if (!hook) return fail('Un post organique a besoin d\'un hook.');
    if (input.productId && !productById(world, input.productId)) return fail('Produit introuvable.');
    const today = m().organicPosts.filter((p) => p.day === world.day).length;
    if (today >= ORGANIC.maxPostsPerDay) return fail(`Déjà ${today} posts aujourd'hui : au-delà, TikTok limite fortement la portée.`);
    const id = nextId(world, 'org');
    m().organicPosts.push({ id, day: world.day, productId: input.productId ?? null, hook, hookStyle: input.hookStyle, format: input.format, views: 0, likes: 0, clicks: 0, sales: 0, viral: false });
    return ok(`Post TikTok publié : « ${short(hook, 60)} » (résultats à la clôture du jour).`, id);
  }

  function listCreators(nicheId: string): CreatorProfile[] {
    return m().creators.filter((c) => c.nicheId === nicheId).map((c) => ({ ...c, redFlags: [...c.redFlags] }));
  }

  function proposePartnership(input: { creatorId: string; productId: string; upfront: number; commission: number }): ToolResult {
    const creator = m().creators.find((c) => c.id === input?.creatorId);
    if (!creator) return fail('Créateur introuvable.');
    const p = productById(world, input.productId);
    if (!p) return fail('Produit introuvable.');
    if (p.status !== 'live') return fail(`« ${short(p.title)} » doit être en ligne avant de démarcher des créateurs.`, p.id);
    const upfront = round2(Math.max(0, Number(input.upfront) || 0));
    const commission = round2(clamp(Number(input.commission) || 0, 0, 0.9));
    const busy = m().partnerships.find((x) => x.creatorId === creator.id && x.productId === p.id && (x.status === 'accepted' || x.status === 'proposed' || (x.status === 'delivered' && world.day - x.day < 14)));
    if (busy) return fail(`Une collaboration est déjà en cours avec @${creator.handle} pour ce produit.`, busy.id);
    if (upfront > cashOf(world)) return fail(`Trésorerie insuffisante pour verser ${fmtEur(upfront)} d'avance.`);
    const pt: Partnership = { id: nextId(world, 'prt'), creatorId: creator.id, productId: p.id, day: world.day, upfront, commission, status: 'proposed', sales: 0, revenue: 0 };
    m().partnerships.push(pt);
    const pay = () => {
      if (upfront > 0) recordLedger(world, { type: 'creator_payout', amount: -upfront, memo: `Avance versée à @${creator.handle}`, ref: pt.id });
    };

    if (isScammer(world, creator)) {
      if (upfront >= 50) {
        pt.status = 'accepted';
        pay();
        return ok(`@${creator.handle} accepte avec enthousiasme et réclame le paiement immédiat : ${fmtEur(upfront)} versés. Vidéo annoncée pour demain.`, pt.id);
      }
      pt.status = 'refused';
      return fail(`@${creator.handle} refuse : il exige ${fmtEur(creator.askUpfront)} d'avance, rien à la commission.`, pt.id);
    }

    const niche = nicheOf(world, p);
    const pdfQ = p.content ? scorePdf(p.content, { audience: p.audience, problem: p.problem, voc: niche.voc, design: p.design, visual: p.visual }).overall : 40;
    const upRatio = creator.askUpfront > 0 ? Math.min(1, upfront / creator.askUpfront) : 1;
    let score = 0.35 + 1.5 * (commission - creator.askCommission) + 0.45 * (upRatio - 1);
    if (p.stats.rating >= 4) score += 0.1;
    if (p.stats.sales >= 10) score += 0.1;
    if (pdfQ >= 70) score += 0.1;
    score += creator.nicheId === p.nicheId ? 0.1 : -0.25;
    const chance = clamp(score, 0.03, 0.97);
    if (rng.chance(chance)) {
      pt.status = 'accepted';
      pay();
      const deal = `${upfront > 0 ? `${fmtEur(upfront)} d'avance + ` : ''}${fmtPct(commission, 0)} des ventes`;
      return ok(`@${creator.handle} accepte (${deal}). Sa vidéo sera publiée demain.`, pt.id);
    }
    pt.status = 'refused';
    const reasons: string[] = [];
    if (commission < creator.askCommission) reasons.push(`commission trop basse (demande ${fmtPct(creator.askCommission, 0)})`);
    if (creator.askUpfront > 0 && upfront < creator.askUpfront) reasons.push(`demande ${fmtEur(creator.askUpfront)} d'avance`);
    if (creator.nicheId !== p.nicheId) reasons.push('produit hors de sa thématique');
    if (p.stats.reviews.length === 0) reasons.push("pas encore d'avis clients sur le guide");
    return fail(`@${creator.handle} décline${reasons.length ? ` : ${reasons.join(', ')}` : ' poliment, pas le bon moment'}.`, pt.id);
  }

  // ───────────── support ─────────────

  function listInbox(status: 'open' | 'all' = 'open'): InboxMessage[] {
    return status === 'all' ? m().inbox.slice() : m().inbox.filter((x) => x.status === 'open');
  }

  function replyToMessage(messageId: string, reply: SupportReplyInput, agentId: string): ReplyOutcome {
    const msg = m().inbox.find((x) => x.id === messageId);
    if (!msg) return { messageId, score: 0, customerReaction: 'Message introuvable.', newMood: 0, resolved: false, consequence: 'none', cost: 0 };
    if (msg.status === 'resolved' || msg.status === 'escalated') {
      return { messageId, score: 0, customerReaction: reaction(rng, 'already_done'), newMood: msg.mood, resolved: msg.status === 'resolved', consequence: 'none', cost: 0 };
    }
    const r: SupportReplyInput = { text: reply?.text ?? '', action: reply?.action ?? 'none', detectedIntent: reply?.detectedIntent ?? 'question' };
    const { score, issues } = scoreSupportReply(msg, r);
    const customer = customerById(world, msg.customerId);
    const order = orderById(world, msg.orderId);
    const product = productById(world, msg.productId ?? order?.productId);
    const arch = customer?.archetype ?? 'normal';
    const rule = actionRule(msg);
    const right = rule.right.includes(r.action);
    let consequence: ReplyOutcome['consequence'] = 'none';
    let cost = 0;
    let resolved = false;
    let key: ReactionKey = 'unresolved';
    const refund = (memo: string): boolean => {
      if (!order) return false;
      const amount = refundOrder(world, order, memo);
      if (amount > 0) { consequence = 'refund'; cost += amount; return true; }
      return false;
    };
    const tryChargeback = (p: number): void => {
      if (order && rng.chance(p)) {
        const c = chargebackOrder(world, order);
        if (c > 0) { consequence = 'chargeback'; cost += c; }
      }
    };

    switch (msg.intent) {
      case 'arnaque': {
        resolved = true;
        if (order) {
          // friendly fraud: a real buyer, a real payment. Paying costs real money; a refusal backed by the order's
          // logs is cheap, and the better the reply the less likely the dispute at his bank.
          if (r.action === 'refund' || r.action === 'discount_code') {
            const memo = `Fausse réclamation payée : ${short(msg.subject, 50)}`;
            const paid = r.action === 'refund' ? refundOrder(world, order, memo, 'scam_loss') : partialRefund(world, order, GOODWILL_SHARE, memo, 'scam_loss');
            if (paid > 0) { consequence = 'scam_loss'; cost += paid; }
            key = paid > 0 ? 'fraud_paid' : 'fraud_refused';
          } else {
            key = 'fraud_refused';
            tryChargeback(SCAM.friendlyDisputeRefused * (1 - score / 100));
          }
          break;
        }
        if (r.action === 'refund' || r.action === 'discount_code') {
          const loss = r.action === 'refund' ? scamAmount(msg, SCAM.defaultAmount) : round2((product?.price ?? 19) * SCAM.discountLossMultiplier);
          recordLedger(world, { type: 'scam_loss', amount: -loss, memo: `Arnaque au support : ${short(msg.subject, 50)}`, ref: msg.id });
          consequence = 'scam_loss'; cost += loss; key = 'scam_paid';
        } else key = r.action === 'resend_link' ? 'scam_link' : 'scam_blocked';
        break;
      }
      case 'troll': {
        resolved = true;
        const quiet = r.action === 'ignore' || r.action === 'block' || (r.action === 'none' && r.text.length <= 220 && score >= 50);
        if (quiet) key = 'troll_quiet';
        else {
          key = 'troll_fed';
          if (r.action === 'refund') refund('Remboursement accordé à un troll');
          // Only verified buyers can rate the guide in the store: a fed troll who never bought it cannot
          // leave a store review, he comes back for more instead (the thread stays open, more support noise).
          if (consequence === 'none' && reviewProduct(world, rng, product, customer, 1, 'troll')) consequence = 'bad_review';
          else if (!order) resolved = false;
        }
        break;
      }
      case 'partenariat': resolved = true; key = 'partner_declined'; break;
      case 'compliment': {
        resolved = true; key = 'compliment_ok';
        if (score >= 70 && rng.chance(0.35) && reviewProduct(world, rng, product, customer, 5, 'product')) consequence = 'good_review';
        break;
      }
      case 'non_recu': {
        if (r.action === 'refund') { refund('Remboursement : PDF non reçu'); resolved = true; key = 'refund_ok'; }
        else if (r.action === 'resend_link') {
          resolved = score >= 45;
          key = resolved ? 'link_ok' : 'unresolved';
          if (resolved && order) order.downloads = (order.downloads ?? 0) + 1;
        }
        else key = arch === 'karen' ? 'karen_rage' : 'unresolved';
        break;
      }
      case 'remboursement': {
        if (r.action === 'refund') { refund('Remboursement accordé par le support'); resolved = true; key = 'refund_ok'; }
        else if (r.action === 'discount_code') {
          const accept = rng.chance(arch === 'chasseur_de_remboursement' ? 0.1 : arch === 'karen' ? 0.2 : 0.5);
          const gesture = accept ? partialRefund(world, order, GOODWILL_SHARE, 'Geste commercial (remboursement partiel)') : 0; // one per order
          if (gesture > 0) { cost += gesture; resolved = true; key = 'discount_ok'; }
          else { key = 'refund_refused'; tryChargeback(arch === 'menace_chargeback' || arch === 'chasseur_de_remboursement' ? 0.35 : 0.1); }
        } else {
          key = arch === 'karen' ? 'karen_rage' : 'refund_refused';
          tryChargeback(arch === 'menace_chargeback' || arch === 'chasseur_de_remboursement' ? 0.35 : 0.1);
        }
        break;
      }
      case 'menace_chargeback': {
        if (r.action === 'refund') { refund('Remboursement (menace de litige bancaire)'); resolved = true; key = 'chargeback_avoided'; }
        else { key = 'refund_refused'; tryChargeback(0.7); }
        break;
      }
      case 'plainte_qualite': {
        if (r.action === 'refund') { refund('Remboursement suite à une plainte qualité'); resolved = true; key = 'refund_ok'; }
        else if (r.action === 'discount_code') {
          const c = partialRefund(world, order, GOODWILL_SHARE, 'Geste commercial suite à une plainte qualité'); cost += c;
          resolved = (c > 0 || !order) && score >= 55; key = resolved ? 'discount_ok' : 'unresolved'; // no second gesture on an order
        } else { resolved = r.action === 'none' && score >= 70; key = resolved ? 'answer_ok' : arch === 'karen' ? 'karen_rage' : 'angry'; }
        break;
      }
      case 'bug_paiement': {
        if (r.action === 'refund' && right) { resolved = true; key = 'refund_ok'; }
        else if (r.action === 'refund') { refund('Remboursement (problème de paiement)'); resolved = true; key = 'refund_ok'; }
        else { resolved = (r.action === 'resend_link' || r.action === 'none') && score >= 50 && right; key = resolved ? 'link_ok' : 'unresolved'; }
        break;
      }
      case 'question': case 'sur_mesure': default: {
        resolved = score >= 55 && r.action !== 'block' && r.action !== 'ignore';
        key = resolved ? (msg.intent === 'sur_mesure' ? 'custom_ok' : 'answer_ok') : 'unresolved';
        break;
      }
    }

    if (consequence === 'none' && arch === 'karen' && score < 50 && reviewProduct(world, rng, product, customer, rng.chance(0.7) ? 1 : 2, 'support_bad')) {
      consequence = 'bad_review';
      key = 'karen_rage';
    }
    if (resolved && score >= 80 && msg.mood < -0.3 && rng.chance(0.25) && reviewProduct(world, rng, product, customer, rng.chance(0.6) ? 5 : 4, 'support_good') && consequence === 'none') {
      consequence = 'good_review';
    }

    const final = consequence as ReplyOutcome['consequence']; // also set inside refund()/tryChargeback()
    const newMood = round2(clamp(msg.mood + (score - 50) / 60 + (resolved ? 0.3 : -0.1), -1, 1));
    const customerReaction = reaction(rng, key);
    msg.thread.push({ from: agentId, text: r.text || (r.action === 'ignore' ? '(ignoré)' : r.action === 'block' ? '(expéditeur bloqué)' : '(sans texte)'), day: world.day });
    msg.thread.push({ from: 'customer', text: customerReaction, day: world.day });
    msg.mood = newMood;
    msg.replyScore = score;
    msg.repliedDay = world.day;
    if (!msg.customerName) msg.customerName = displayName(customer);
    msg.status = final === 'chargeback' ? 'escalated' : resolved ? 'resolved' : 'replied';
    msg.resolution = final === 'chargeback' ? 'Litige bancaire ouvert par le client.'
      : resolved ? `Résolu (${r.action}, note ${score}/100).` : issues[0] ?? null;
    if (customer) customer.satisfaction = round2(clamp(customer.satisfaction + (resolved ? 0.2 : -0.2) + (score - 50) / 200, -1, 1));
    return { messageId, score, customerReaction, newMood, resolved, consequence: final, cost: round2(cost) };
  }

  function issueRefund(orderId: string, reason: string): ToolResult {
    const order = orderById(world, orderId);
    if (!order) return fail('Commande introuvable.');
    if (order.chargeback) return fail('Cette commande fait déjà l\'objet d\'un litige bancaire.', order.id);
    if (order.refunded) return fail('Commande déjà remboursée.', order.id);
    const falseClaim = m().inbox.some((x) => x.orderId === order.id && x.intent === 'arnaque');
    const amount = refundOrder(world, order, `Remboursement : ${short(reason || 'demande client', 60)}`, falseClaim ? 'scam_loss' : 'refund');
    for (const msg of m().inbox) {
      if (msg.orderId === order.id && (msg.status === 'open' || msg.status === 'replied') && ['remboursement', 'menace_chargeback', 'plainte_qualite', 'non_recu', 'bug_paiement', 'arnaque'].includes(msg.intent)) {
        msg.status = 'resolved';
        msg.resolution = `Remboursement effectué (${fmtEur(amount)}).`;
      }
    }
    return ok(`Commande ${order.id} remboursée (${fmtEur(amount)}).`, order.id);
  }

  // ───────────── channels ─────────────

  function channelStatus(): ChannelAccountStatus[] {
    return CHANNEL_IDS.map((id) => {
      const acc = accountOf(m(), id);
      return { id, state: accountState(id), openDay: id === 'tiktok' ? 1 : ownAccount(id)?.openDay ?? null, strikes: acc?.strikes ?? 0, bannedUntilDay: acc?.bannedUntilDay ?? 0 };
    });
  }

  /** Starts the account's review. YouTube and Search are one account: the second one finds it verified. */
  function requestChannel(channel: ChannelId): ToolResult {
    const { label, verificationDays } = CHANNELS[channel];
    if (channel === 'tiktok') return ok(`${label} est déjà ouvert.`);
    const acc = ownAccount(channel);
    if (!acc) return fail(`${label} n'est pas ouvert à l'agence.`);
    const state = accountState(channel);
    if (state === 'banned') return fail(`Compte ${label} suspendu jusqu'au jour ${acc.bannedUntilDay}.`);
    if (state === 'open') return ok(`${label} est déjà ouvert.`);
    if (state === 'closed') acc.openDay = world.day + verificationDays;
    return ok(`Compte ${label} en vérification, ouverture au jour ${acc.openDay}.`);
  }

  /** The ad manager: what the platform says it did, day by day and campaign by campaign. */
  function getPlatformReport(channel: ChannelId, sinceDay?: number): PlatformReportRow[] {
    const rows = new Map<string, PlatformReportRow>();
    for (const s of getAdStats(sinceDay, channel)) {
      const key = `${s.day}:${s.campaignId}`;
      const row = rows.get(key) ?? { day: s.day, channel, campaignId: s.campaignId, spend: 0, claimedPurchases: 0, claimedRevenue: 0 };
      row.spend = round2(row.spend + s.spend);
      row.claimedPurchases += s.claimedPurchases ?? s.purchases;
      row.claimedRevenue = round2(row.claimedRevenue + (s.claimedRevenue ?? s.revenue));
      rows.set(key, row);
    }
    return [...rows.values()];
  }

  /** The shop's own orders, by last click. An order that came straight from an ad names its campaign, any other one reads null. */
  function getShopAttribution(sinceDay?: number): ShopAttributionRow[] {
    const since = sinceDay ?? 0;
    const rows = new Map<string, ShopAttributionRow>();
    for (const o of m().orders) {
      if (o.day < since) continue;
      const channel = channelOf(o);
      const campaignId = o.source === 'ads' ? o.campaignId : null;
      const key = `${o.day}:${channel}:${campaignId}`;
      const row = rows.get(key) ?? { day: o.day, channel, campaignId, sales: 0, revenue: 0 };
      row.sales += 1;
      row.revenue = round2(row.revenue + o.price);
      rows.set(key, row);
    }
    return [...rows.values()];
  }

  // ───────────── audience: no list until P10.2 ─────────────

  function listStats(): AudienceView {
    return { size: 0, leads: 0, buyers: 0, byNiche: [], unsubscribed: 0, dailyCost: 0, recent: [], sequences: [] };
  }

  return {
    searchTrends, listCompetitors, minePains, nicheBrief,
    publishProduct, setPrice, setProductStatus,
    submitCreative, createCampaign, updateCampaign, getAdStats,
    postOrganic, listCreators, proposePartnership,
    listInbox, replyToMessage, issueRefund,
    channelStatus, requestChannel, channelSignals: (nicheId) => channelSignals(world, nicheId), getPlatformReport, getShopAttribution,
    listStats, activateSequence: () => fail('Aucune liste e-mail pour le moment.'), sendBroadcast: () => fail('Aucune liste e-mail pour le moment.'),
  };
}
