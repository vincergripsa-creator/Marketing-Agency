/**
 * Formal duels (talent §6.3). Once a week two writers get the same product and the same campaign, each writes a creative
 * through the normal gates, and the experiment machinery measures them on one budget. Ratings move by opposite amounts,
 * and a clear loser leaves the campaign: the budget really goes to the winner. No draw here, nothing outside the world.
 */
import type { AdCreative, AgentId, AgentState, Campaign, Duel, Experiment, LeagueState, SkillRating, WorldState } from '../../shared.js';
import { nextId } from '../../core/index.js';
import type { RuntimeCtx } from '../ctx.js';
import { nameOf, productOf, speak } from '../ctx.js';
import { adsHold } from '../holds.js';
import { currentBudget } from '../metrics.js';
import { learning, sim } from '../modules.js';
import { officerId, ownersOfAny } from '../org/officers.js';
import { createTask, taskById } from '../tasks.js';
import { pct, short } from '../util.js';
import { TALENT } from './constants.js';
import { phi, ratingOf } from './evidence.js';
import { talentMode } from './truth.js';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const thousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+$)/g, ' ');

const isLive = (d: Duel): boolean => d.kind === 'formal' && (d.status === 'ordered' || d.status === 'running');

const copyOf = (league: LeagueState, id: AgentId): SkillRating | undefined => league.entries[id]?.ratings.copy;

function entrants(w: WorldState): AgentState[] {
  return ownersOfAny(w, ['produce_ad']).filter((a) => a.roleId !== 'ceo' && !a.notice && w.day - a.hiredDay >= TALENT.duel.tenureDays);
}

/** The entrant the company knows least, and whoever stands closest to them: that game says the most. */
function pickPair(w: WorldState, league: LeagueState): [AgentState, AgentState] | null {
  const { par, rd } = TALENT.rating;
  const rdOf = (a: AgentState) => copyOf(league, a.id)?.rd ?? rd;
  const ratingAt = (a: AgentState) => copyOf(league, a.id)?.rating ?? par;
  const [first, ...rest] = [...entrants(w)].sort((a, b) => rdOf(b) - rdOf(a) || a.id.localeCompare(b.id));
  if (!first || !rest.length) return null;
  const gap = (a: AgentState) => Math.abs(ratingAt(a) - ratingAt(first));
  return [first, rest.sort((a, b) => gap(a) - gap(b) || a.id.localeCompare(b.id))[0]!];
}

/** The biggest budget that can carry a duel. `produce_ad` makes TikTok creatives: the other channels are out (D25). */
function pickCampaign(ctx: RuntimeCtx): Campaign | undefined {
  const w = ctx.world;
  const { minBudget, maxCreatives } = TALENT.duel;
  return w.company.campaigns
    .filter((c) => c.status === 'active' && (c.channel ?? 'tiktok') === 'tiktok' && c.dailyBudget >= minBudget && c.creativeIds.length <= maxCreatives
      && productOf(ctx, c.productId)?.status === 'live' && !adsHold(w, c.productId))
    .sort((a, b) => b.dailyBudget - a.dailyBudget)[0];
}

export function scheduleDuel(ctx: RuntimeCtx): Duel | null {
  const w = ctx.world;
  const league = w.company.league;
  if (talentMode(w) !== 'league' || !league || w.day % TALENT.duel.everyDays !== TALENT.duel.day || league.duels.some(isLive)) return null;
  const budget = currentBudget(w);
  if (budget.survival || budget.bankrupt || sim.isAnnouncedOutage(w, w.day) || sim.isAnnouncedOutage(w, w.day + 1)) return null;
  const pair = pickPair(w, league);
  const campaign = pickCampaign(ctx);
  const product = productOf(ctx, campaign?.productId);
  if (!pair || !campaign || !product) return null;
  const [a, b] = pair;
  const duel: Duel = {
    id: nextId(w, 'duel'), season: league.season, skill: 'copy', kind: 'formal', agents: [a.id, b.id], productId: product.id, campaignId: campaign.id,
    creativeIds: [], taskIds: [], experimentId: null, status: 'ordered', startDay: w.day, endDay: null, result: null,
  };
  const used = w.company.creatives.filter((c) => c.productId === product.id).length;
  duel.taskIds = pair.map((x, i) => createTask(w, {
    kind: 'produce_ad', title: `Duel : ${a.name} contre ${b.name} — « ${short(product.title, 40)} »`, assignee: x.id, createdBy: officerId(w, 'growth'), priority: 1,
    input: { productId: product.id, nicheId: product.nicheId, variant: used + i, attachTo: campaign.id, duelId: duel.id },
  }).id);
  league.duels.push(duel);
  speak(ctx, 'growth', `duel de la semaine, ${a.name} contre ${b.name} sur « ${short(campaign.name, 50)} ». Chacun choisit son angle, le budget reste le même.`, 'review', { productId: product.id });
  return duel;
}

function cancelDuel(ctx: RuntimeCtx, duel: Duel, why: string): void {
  const w = ctx.world;
  duel.status = 'cancelled';
  duel.endDay = w.day;
  const e = w.company.experiments.find((x) => x.id === duel.experimentId);
  if (e?.status === 'running') {
    e.status = 'cancelled';
    e.endDay = w.day;
    e.winner = null;
  }
  speak(ctx, 'growth', `duel annulé entre ${nameOf(ctx, duel.agents[0])} et ${nameOf(ctx, duel.agents[1])} : ${why}. Aucun point ne bouge.`, 'review', { productId: duel.productId });
}

/** Three share one budget (§6.3): two writers join, so a campaign of two keeps only its newest creative. */
function makeRoom(ctx: RuntimeCtx, duel: Duel, campaign: Campaign): void {
  const others = campaign.creativeIds.filter((id) => !duel.creativeIds.includes(id));
  const room = TALENT.duel.maxCreatives - 1;
  if (others.length <= room) return;
  const ids = [...others.slice(others.length - room), ...duel.creativeIds];
  if (ctx.tools.updateCampaign(campaign.id, { creativeIds: ids }).ok) campaign.creativeIds = ids;
}

function startDuel(ctx: RuntimeCtx, duel: Duel, campaign: Campaign): void {
  const w = ctx.world;
  const product = productOf(ctx, duel.productId);
  makeRoom(ctx, duel, campaign);
  const e = learning.startExperiment(w, {
    day: w.day, owner: officerId(w, 'analyst'), dimension: 'agent_duel', variants: [...duel.agents], metric: 'ctr', productId: duel.productId, nicheId: product?.nicheId ?? null,
    hypothesis: `Duel : ${nameOf(ctx, duel.agents[0])} contre ${nameOf(ctx, duel.agents[1])} sur « ${short(product?.title ?? campaign.name, 50)} »`,
  });
  duel.experimentId = e.id;
  duel.status = 'running';
}

/** A duel waits for its two creatives: both written by the right person, past the review and TikTok, in the campaign. */
function followOrdered(ctx: RuntimeCtx, duel: Duel): void {
  const w = ctx.world;
  const gone = duel.agents.find((id) => !w.company.agents.some((a) => a.id === id));
  if (gone) return cancelDuel(ctx, duel, `${nameOf(ctx, gone)} a quitté l'agence`);
  const tasks = duel.taskIds.map((id) => taskById(w, id));
  if (tasks.some((t) => !t || t.status === 'failed' || t.status === 'cancelled' || t.output?.dropped === true)) return cancelDuel(ctx, duel, 'une des deux pubs a été abandonnée');
  const campaign = w.company.campaigns.find((c) => c.id === duel.campaignId);
  if (campaign?.status !== 'active') return cancelDuel(ctx, duel, 'la campagne ne tourne plus');
  const creatives = tasks.map((t) => w.company.creatives.find((c) => c.id === t?.output?.creativeId));
  for (const c of creatives) if (c) c.duelId = duel.id;
  if (creatives.some((c) => c?.review.status === 'rejected')) return cancelDuel(ctx, duel, 'une des deux pubs est refusée');
  if (tasks.some((t) => t?.status !== 'done')) {
    if (w.day - duel.startDay > TALENT.duel.everyDays) cancelDuel(ctx, duel, 'une des deux pubs traîne depuis une semaine');
    return;
  }
  duel.creativeIds = creatives.flatMap((c) => (c ? [c.id] : []));
  if (creatives.some((c, i) => c?.createdBy !== duel.agents[i])) return cancelDuel(ctx, duel, 'une des deux pubs a changé de main');
  if (creatives.some((c) => c?.review.status !== 'approved' || !campaign.creativeIds.includes(c.id))) return cancelDuel(ctx, duel, 'une des deux pubs n’est pas en campagne');
  startDuel(ctx, duel, campaign);
}

/** `produce_ad` reports here once a creative has passed TikTok. The evening follows up anyway, so a call is never owed. */
export function onDuelCreative(ctx: RuntimeCtx, creative: AdCreative): void {
  const w = ctx.world;
  const duel = w.company.league?.duels.find((d) => d.status === 'ordered' && d.taskIds.some((id) => taskById(w, id)?.output?.creativeId === creative.id));
  if (duel) followOrdered(ctx, duel);
}

/** Φ(z) of one CTR against the other, noise of a day included (§6.3): a noisy gap settles near .5 and moves almost nothing. */
function scoreOf(pA: number, nA: number, pB: number, nB: number, days: number): { z: number; s: number } {
  const noise = TALENT.prune.dayNoise ** 2 / days;
  const se = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB + noise * (pA ** 2 + pB ** 2));
  const z = se > 0 ? (pA - pB) / se : 0;
  return { z, s: phi(z) };
}

/** One game, both sides: `recordEvidence` would weigh each one on its own `rd`, a duel moves them by the same amount (§6.3). */
function bookResult(league: LeagueState, day: number, r: SkillRating, id: AgentId, delta: number, s: number, label: string): void {
  const weight = TALENT.weight['copy:duel']!;
  r.rating = round1(r.rating + delta);
  r.rd = Math.max(TALENT.rating.rdMin, r.rd - TALENT.rating.rdPerEvidence * weight);
  r.n += 1;
  r.seasonN += weight;
  league.events.push({ day, agentId: id, skill: 'copy', source: 'duel', s: round4(s), w: weight, label });
  if (league.events.length > TALENT.evidence.eventsMax) league.events.splice(0, league.events.length - TALENT.evidence.eventsMax);
}

/** Out of the campaign, so that the budget it took goes to the others (the market splits it evenly). */
function dropCreative(ctx: RuntimeCtx, campaign: Campaign | undefined, creativeId: string | undefined): boolean {
  if (!campaign || !creativeId || !campaign.creativeIds.includes(creativeId)) return false;
  const keep = campaign.creativeIds.filter((id) => id !== creativeId);
  if (!keep.length || !ctx.tools.updateCampaign(campaign.id, { creativeIds: keep }).ok) return false;
  campaign.creativeIds = keep;
  return true;
}

function settleDuel(ctx: RuntimeCtx, duel: Duel, e: Experiment): void {
  const w = ctx.world;
  const [a, b] = duel.agents;
  const ra = e.results[a];
  const rb = e.results[b];
  if (!ra?.n || !rb?.n) return cancelDuel(ctx, duel, 'une des deux pubs n’a reçu aucun trafic');
  const league = w.company.league;
  const ratingA = ratingOf(w, a, 'copy');
  const ratingB = ratingOf(w, b, 'copy');
  if (!league || !ratingA || !ratingB) return cancelDuel(ctx, duel, 'un des deux a quitté l’agence');
  const { k, dropAbove, drawAbove, drawBelow } = TALENT.duel;
  const { z, s } = scoreOf(ra.value, ra.n, rb.value, rb.n, Math.max(1, (e.endDay ?? w.day) - e.day + 1));
  const delta = round1(k * (s - 1 / (1 + 10 ** ((ratingB.rating - ratingA.rating) / 400))));
  const label = `Duel ${nameOf(ctx, a)} contre ${nameOf(ctx, b)}`;
  bookResult(league, w.day, ratingA, a, delta, s, label);
  bookResult(league, w.day, ratingB, b, -delta, 1 - s, label);
  duel.status = 'settled';
  duel.endDay = w.day;
  duel.result = { ctr: [ra.value, rb.value], n: [ra.n, rb.n], z: round4(z), s: round4(s), delta };

  const [winner, loser, top, low] = s >= 0.5 ? [a, b, ra, rb] : [b, a, rb, ra];
  const campaign = w.company.campaigns.find((c) => c.id === duel.campaignId);
  const out = (s > dropAbove || s < 1 - dropAbove) && dropCreative(ctx, campaign, duel.creativeIds[loser === a ? 0 : 1]);
  const score = `CTR ${pct(top.value)} contre ${pct(low.value)} sur ${thousands(ra.n + rb.n)} impressions`;
  const line = s > drawAbove && s < drawBelow ? `match nul entre ${nameOf(ctx, a)} et ${nameOf(ctx, b)}, l'écart est dans le bruit (${score}).`
    : `${nameOf(ctx, winner)} bat ${nameOf(ctx, loser)} : ${score}.${out ? ` La pub de ${nameOf(ctx, loser)} sort de la campagne, son budget va à ${nameOf(ctx, winner)}.` : ''}`;
  speak(ctx, 'growth', line, 'review', { productId: duel.productId });
}

function followRunning(ctx: RuntimeCtx, duel: Duel): void {
  const w = ctx.world;
  const e = w.company.experiments.find((x) => x.id === duel.experimentId);
  if (!e || e.status === 'cancelled') return cancelDuel(ctx, duel, 'une des deux pubs n’a reçu aucun trafic');
  if (e.status === 'concluded') return settleDuel(ctx, duel, e);
  const campaign = w.company.campaigns.find((c) => c.id === duel.campaignId);
  if (duel.creativeIds.some((id) => !campaign?.creativeIds.includes(id))) cancelDuel(ctx, duel, 'une des deux pubs a quitté la campagne');
}

/** Evening, after the retro: the experiments of the day are up to date. */
export function settleDuels(ctx: RuntimeCtx): void {
  for (const duel of ctx.world.company.league?.duels ?? []) {
    if (duel.kind !== 'formal') continue;
    if (duel.status === 'running') followRunning(ctx, duel);
    else if (duel.status === 'ordered') followOrdered(ctx, duel);
  }
}
