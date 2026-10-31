/**
 * Ratings from evidence (talent §5) and the routing they drive (§6.4). Every result is a game against par, worth what it
 * really says once luck is out: `s = Φ((x - par) / sd)`, so a solitary role can be judged and a noisy result moves almost
 * nothing. `flat` and `league` both record, only `league` routes. Nothing here reads the truth and nothing draws: the
 * hooks run inside the tick they belong to, the daily pass is guarded by `lastEvidenceDay`, so a reload replays the same
 * evidence.
 */
import type { AdCreative, AgentId, AgentState, DailyAdStats, Duel, EvidenceEvent, EvidenceSource, LeagueState, Product, Skill, SkillRating, Task, TaskKind, WorldState } from '../../shared.js';
import { channelOf } from '../../shared.js';
import { adRows } from '../../learning/data.js';
import { productPnls } from '../accounting.js';
import { versionSince } from '../acquisition.js';
import { creditOf } from '../channels.js';
import type { RuntimeCtx } from '../ctx.js';
import { learning, sim } from '../modules.js';
import { clamp, dec, mean, pct, round2, short, sum } from '../util.js';
import { TALENT } from './constants.js';
import { familyOf, KIND_SKILL } from './skills.js';
import { leagueEntry, talentMode } from './truth.js';

/** `buying / market` plays ROAS 1,5. A zero ROAS is a bad week, not an infinite one. */
const ROAS_PAR = 1.5;
const ROAS_FLOOR = 0.05;
/** A pair of creatives is read on the last two weeks: « same days » means nothing past that, and a duel evicted by the cap cannot settle its rows twice. */
const NATURAL_WINDOW_DAYS = 14;
/** What stays flagged after a polish costs the editor this many points (§5.2). */
const LEFT_COST = 2;

/** The kinds a first review scores: the rest of the chain is read by what it did to the text. */
const QA_SKILL: Partial<Record<TaskKind, Skill>> = { produce_ad: 'copy', write_pdf: 'longform', write_sales_page: 'page' };

/** The source of the role's readable number, and how its x reads out loud (`SkillRating.metric`). */
const METRIC: Record<Skill, { source: EvidenceSource; read?: (x: number) => number }> = {
  copy: { source: 'qa' }, video: { source: 'cut' }, longform: { source: 'qa' }, polish: { source: 'qa' }, page: { source: 'qa' }, design: { source: 'visual' },
  buying: { source: 'market', read: (x) => ROAS_PAR * Math.exp(x) },
  research: { source: 'pick', read: (x) => 100 * x },
  support: { source: 'reply' },
};

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Φ, the normal cdf (Abramowitz & Stegun 26.2.17). */
export function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const tail = 0.3989423 * Math.exp((-z * z) / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - tail : tail;
}

const parRating = (w: WorldState, skill: Skill): SkillRating => ({ skill, rating: TALENT.rating.par, rd: TALENT.rating.rd, n: 0, seasonN: 0, metric: null, history: [{ day: w.day, rating: TALENT.rating.par }] });

/**
 * The rating of a person on a skill, opened at par by the first read: a hat brings a colleague in (D14: it moves the
 * rating, `primary` stays the role's). Someone the league cannot hold reads par, on a copy nobody keeps.
 */
export function ratingOf(w: WorldState, agentId: AgentId, skill: Skill): SkillRating {
  const league = w.company.league;
  const agent = w.company.agents.find((a) => a.id === agentId);
  const entry = league && (league.entries[agentId] ?? (agent ? (league.entries[agentId] = leagueEntry(w, agent)) : undefined));
  return entry ? (entry.ratings[skill] ??= parRating(w, skill)) : parRating(w, skill);
}

/** The ring of `league.events`. */
function pushEvent(w: WorldState, event: EvidenceEvent): void {
  const events = w.company.league?.events;
  if (!events) return;
  events.push(event);
  if (events.length > TALENT.evidence.eventsMax) events.splice(0, events.length - TALENT.evidence.eventsMax);
}

/** The season's weighted mean. It restarts on its own with the first number of a new season: a plan is judged on its season alone (§7.2). */
function addMetric(r: SkillRating, season: number, x: number, weight: number): void {
  if (r.metricBase?.season !== season) r.metricBase = { season, sum: 0, w: 0 };
  r.metricBase.sum += x * weight;
  r.metricBase.w += weight;
  r.metric = round2(r.metricBase.sum / r.metricBase.w);
}

/**
 * One game. `s` is the result in 0..1, `x` the raw number behind it when there is one: `parStats` sums it in `flat` too,
 * since S14 sets the pars from it and `events` only keeps `s` (D58). A world without a league records nothing, and a
 * leaver plays no more: their work still measures the par.
 */
export function recordEvidence(w: WorldState, agentId: AgentId, skill: Skill, source: EvidenceSource, s: number, weight: number, label: string, opponent: number = TALENT.rating.par, x?: number): void {
  const league = w.company.league;
  if (!league || !Number.isFinite(s)) return;
  if (x !== undefined) {
    const stat = (league.parStats[`${skill}:${source}`] ??= { n: 0, sum: 0, sq: 0 });
    stat.n += 1;
    stat.sum += x;
    stat.sq += x * x;
  }
  if (!w.company.agents.some((a) => a.id === agentId)) return;
  const r = ratingOf(w, agentId, skill);
  const { kOverRd, kMin, kMax, rdPerEvidence, rdMin } = TALENT.rating;
  const expected = 1 / (1 + 10 ** ((opponent - r.rating) / 400));
  const k = clamp(r.rd / kOverRd, kMin, kMax);
  r.rating = round1(r.rating + k * weight * (s - expected));
  r.rd = Math.max(rdMin, r.rd - rdPerEvidence * weight);
  r.n += 1;
  r.seasonN += weight;
  const metric = METRIC[skill];
  if (x !== undefined && metric.source === source) addMetric(r, league.season, metric.read?.(x) ?? x, weight);
  pushEvent(w, { day: w.day, agentId, skill, source, s: round4(s), w: weight, label });
}

/** A readable number against its par, from the table of `TALENT` (§5.2): the writer of a `cut` or a `visual` row needs nothing else. */
export function recordScore(w: WorldState, agentId: AgentId, skill: Skill, source: EvidenceSource, x: number, label: string, weight?: number): void {
  const key = `${skill}:${source}`;
  recordEvidence(w, agentId, skill, source, phi((x - TALENT.par[key]!) / TALENT.sd[key]!), weight ?? TALENT.weight[key]!, label, undefined, x);
}

/** First review only: a rework says nothing more about the author, whose first shot is the one the scorer judged. */
export function onReviewed(ctx: RuntimeCtx, task: Task, res: { verdict: string; score: number | null }): void {
  const skill = QA_SKILL[task.kind];
  if (!skill || task.attempts !== 0 || res.score === null || !task.assignee) return;
  recordScore(ctx.world, task.assignee, skill, 'qa', res.score, `« ${short(task.title, 50)} » : ${Math.round(res.score)}/100 en relecture`);
}

/** A refusal with a strike is the author's. A false positive has no strike: it says nothing about them. */
export function onStrike(w: WorldState, creative: AdCreative): void {
  recordEvidence(w, creative.createdBy, 'copy', 'rejected', 0, TALENT.weight['copy:rejected']!, `« ${short(creative.hook, 50)} » : refusée, avertissement sur le compte pub`);
}

/** A polish is the points it gained, less what it left: `output.left` is the share of the flagged text still there, 0 as long as one pass fixes all it sees. */
export function onDone(ctx: RuntimeCtx, task: Task): void {
  if (task.kind !== 'humanize_pdf' || !task.assignee) return;
  const { flagged, before, after, kept, left } = (task.output ?? {}) as { flagged?: number; before?: number; after?: number; kept?: boolean; left?: number };
  if (!flagged || before === undefined || after === undefined) return; // nothing to fix says nothing about the editor
  recordScore(ctx.world, task.assignee, 'polish', 'qa', after - before - LEFT_COST * (kept === false ? 1 : left ?? 0), `« ${short(task.title, 50)} » : qualité ${before} → ${after}`);
}

/**
 * Once a day, after the market. An announced outage day measures nothing, so the pass waits for the next day, which picks
 * up what was due: `adRows` leaves the day's rows out for good, and every row below reads « what crossed since the last
 * pass », with no list of what was already counted.
 */
export function applyDailyEvidence(w: WorldState, day: number): void {
  const league = w.company.league;
  if (!league || league.lastEvidenceDay >= day || sim.isAnnouncedOutage(w, day)) return;
  const since = league.lastEvidenceDay;
  league.lastEvidenceDay = day;
  const rows = adRows(w, 1, day);
  settleNaturalDuels(w, day);
  reviewEvidence(w, since);
  pageEvidence(w, rows, since);
  pickEvidence(w, since, day);
  const { buyingEveryDays } = TALENT.evidence;
  if (Math.floor(day / buyingEveryDays) > Math.floor(since / buyingEveryDays)) {
    buyingEvidence(w, rows, day);
    weekPoint(league, day);
  }
}

/** Who wrote the current state of a product: the last one to finish the kind on it. */
function authorOf(w: WorldState, kind: TaskKind, productId: string): AgentId | null {
  return w.company.tasks.filter((t) => t.kind === kind && t.status === 'done' && t.input.productId === productId).at(-1)?.assignee ?? null;
}

/** Reviews say something once there are enough of them, and once per version: the day the version crosses the bar. */
function reviewEvidence(w: WorldState, since: number): void {
  const { reviewsMin } = TALENT.evidence;
  for (const p of w.company.products) {
    if (p.launchedDay === null) continue;
    const from = versionSince(w, p);
    const reviews = p.stats.reviews.filter((r) => r.day >= from);
    if (reviews.length < reviewsMin || reviews.filter((r) => r.day <= since).length >= reviewsMin) continue;
    const rating = mean(reviews.map((r) => r.rating));
    const label = `« ${short(p.title, 40)} » : ${dec(rating, 1)}/5 sur ${reviews.length} avis`;
    const writer = authorOf(w, 'write_pdf', p.id);
    if (writer) recordScore(w, writer, 'longform', 'market', rating, label);
    const editor = authorOf(w, 'humanize_pdf', p.id);
    if (editor) recordScore(w, editor, 'polish', 'market', rating, label);
  }
}

/** Conversion with half a sale in hand: 150 views without a sale is a bad page, not an infinitely bad one. */
function cvrOf(rows: DailyAdStats[]): number {
  return (sum(rows.map((r) => r.purchases)) + 0.5) / (sum(rows.map((r) => r.landingViews)) + 1);
}

/** Paid landing views, the only ones dated by day. Against the company's other products on the same days, so a good week is nobody's merit. */
function pageEvidence(w: WorldState, rows: DailyAdStats[], since: number): void {
  const { pageViewsMin } = TALENT.evidence;
  for (const p of w.company.products) {
    if (p.launchedDay === null) continue;
    const from = versionSince(w, p);
    const period = rows.filter((r) => r.day >= from);
    const own = period.filter((r) => r.productId === p.id);
    if (sum(own.map((r) => r.landingViews)) < pageViewsMin || sum(own.filter((r) => r.day <= since).map((r) => r.landingViews)) >= pageViewsMin) continue;
    const others = period.filter((r) => r.productId !== p.id);
    const author = authorOf(w, 'write_sales_page', p.id);
    if (!author || !others.some((r) => r.landingViews > 0)) continue;
    recordScore(w, author, 'page', 'market', Math.log(cvrOf(own) / cvrOf(others)), `« ${short(p.title, 40)} » : conversion ${pct(cvrOf(own))} contre ${pct(cvrOf(others))} sur le reste`);
  }
}

/** A pick is a rank, not euros: where the product stands among all products on the same 14 days. A niche the founder named is his, and alone it ranks nothing. */
function pickEvidence(w: WorldState, since: number, day: number): void {
  const { pickDays } = TALENT.evidence;
  for (const p of w.company.products) {
    const due = p.launchedDay === null ? null : p.launchedDay + pickDays;
    if (due === null || due <= since || due > day) continue;
    const pick = w.company.tasks.find((t) => t.kind === 'pick_opportunity' && t.status === 'done' && t.output?.productId === p.id);
    if (!pick?.assignee || pick.input.nicheId) continue;
    const pnl = productPnls(w, day - pickDays + 1, day, sim.announcedOutageDays(w)).products;
    const others = pnl.filter((r) => r.productId !== p.id);
    if (!others.length) continue;
    const profit = pnl.find((r) => r.productId === p.id)?.profit ?? 0;
    const percentile = (others.filter((r) => r.profit < profit).length + 0.5 * (1 + others.filter((r) => r.profit === profit).length)) / (others.length + 1);
    recordEvidence(w, pick.assignee, 'research', 'pick', percentile, TALENT.weight['research:pick']!, `« ${short(p.title, 40)} » : ${Math.round(100 * percentile)}e centile du catalogue après ${pickDays} jours`, undefined, percentile);
  }
}

/** The buyer's week, per campaign that really ran: a campaign stopped midway counts, or only the survivors would be read. */
function buyingEvidence(w: WorldState, rows: DailyAdStats[], day: number): void {
  const { buyingEveryDays, buyingMinDays, spendFull, spendFloor } = TALENT.evidence;
  const week = rows.filter((r) => r.day > day - buyingEveryDays);
  for (const c of w.company.campaigns) {
    const own = week.filter((r) => r.campaignId === c.id);
    const paid = own.filter((r) => r.spend > 0);
    if (new Set(paid.map((r) => r.day)).size < buyingMinDays) continue;
    const spend = sum(paid.map((r) => r.spend));
    const nicheId = w.company.products.find((p) => p.id === c.productId)?.nicheId ?? '';
    const roas = (sum(own.map((r) => r.revenue)) * creditOf(w, channelOf(c), nicheId)) / spend; // D21: the credit's ROAS, not the platform's
    recordScore(w, c.createdBy, 'buying', 'market', Math.log(Math.max(roas, ROAS_FLOOR) / ROAS_PAR), `« ${short(c.name, 40)} » : ROAS ${dec(roas, 2)} sur 7 jours`, clamp(spend / spendFull, spendFloor, 1));
    const creatives = [...new Set(paid.map((r) => r.creativeId))].map((id) => {
      const rowsOf = own.filter((r) => r.creativeId === id);
      const impressions = sum(rowsOf.map((r) => r.impressions));
      return { spend: sum(rowsOf.map((r) => r.spend)), ctr: impressions > 0 ? sum(rowsOf.map((r) => r.clicks)) / impressions : 0 };
    });
    if (creatives.length < 2) continue; // one creative leaves no choice to read
    const best = creatives.reduce((a, b) => (b.ctr > a.ctr ? b : a));
    const share = best.spend / spend;
    recordScore(w, c.createdBy, 'buying', 'focus', share, `« ${short(c.name, 40)} » : ${pct(share, 0)} du budget sur la meilleure créa`);
  }
}

/** One point per week, the UI's sparkline. */
function weekPoint(league: LeagueState, day: number): void {
  for (const entry of Object.values(league.entries)) {
    if (entry.status === 'gone') continue;
    for (const r of Object.values(entry.ratings)) {
      r.history.push({ day, rating: r.rating });
      if (r.history.length > TALENT.rating.historyMax) r.history.splice(0, r.history.length - TALENT.rating.historyMax);
    }
  }
}

// ───────────────────────────── natural duels (§6.2) ─────────────────────────────

export interface AdRead { impressions: number; clicks: number }

/**
 * Two creatives of one campaign on the same days. Half the angle is credit, half the bandit's: `armRatio` is
 * `meanArm(A) / meanArm(B)`. The result is a number the noise can eat: a pair the clicks cannot tell apart gives s ≈ .5.
 */
export function naturalResult(a: AdRead, b: AdRead, armRatio: number, days: number): { s: number; z: number } {
  const clicksA = Math.max(1, a.clicks), clicksB = Math.max(1, b.clicks);
  const residual = Math.log((clicksA / a.impressions) / (clicksB / b.impressions)) - 0.5 * Math.log(armRatio);
  const se = Math.sqrt(1 / clicksA + 1 / clicksB + (2 * TALENT.prune.dayNoise ** 2) / days);
  const z = residual / se;
  return { s: phi(z), z };
}

/** Posterior means of the creative's hook and format in that niche. An arm with too few pulls has no opinion yet. */
function meanArm(w: WorldState, c: AdCreative, nicheId: string): number {
  const arm = (dimension: string, key: string): number => {
    const stat = learning.armStats(w, dimension).find((s) => s.key === key);
    return stat && stat.pulls >= TALENT.natural.armMinPulls ? stat.mean : 1;
  };
  return arm(`hook_style:${nicheId}`, c.hookStyle) * arm(`ad_format:${nicheId}`, c.format);
}

function lastSettled(league: LeagueState, campaignId: string, a: string, b: string): number {
  return Math.max(0, ...league.duels.filter((d) => d.kind === 'natural' && d.campaignId === campaignId && d.creativeIds.includes(a) && d.creativeIds.includes(b)).map((d) => d.endDay ?? 0));
}

function settlePair(w: WorldState, day: number, campaignId: string, rows: DailyAdStats[], a: AdCreative, b: AdCreative, product: Product): void {
  const league = w.company.league!;
  const { minImp, kept } = TALENT.natural;
  const settled = lastSettled(league, campaignId, a.id, b.id);
  const fresh = rows.filter((r) => r.day > settled);
  const daysOf = (id: string) => new Set(fresh.filter((r) => r.creativeId === id).map((r) => r.day));
  const daysB = daysOf(b.id);
  const shared = new Set([...daysOf(a.id)].filter((d) => daysB.has(d)));
  const read = (id: string): AdRead => {
    const own = fresh.filter((r) => r.creativeId === id && shared.has(r.day));
    return { impressions: sum(own.map((r) => r.impressions)), clicks: sum(own.map((r) => r.clicks)) };
  };
  const readA = read(a.id), readB = read(b.id);
  if (readA.impressions < minImp || readB.impressions < minImp) return;
  const ratingA = ratingOf(w, a.createdBy, 'copy'), ratingB = ratingOf(w, b.createdBy, 'copy');
  const { s, z } = naturalResult(readA, readB, meanArm(w, a, product.nicheId) / meanArm(w, b, product.nicheId), shared.size);
  const before = ratingA.rating, opponent = ratingB.rating; // each plays the other as they stood before this game
  const ctrA = readA.clicks / readA.impressions, ctrB = readB.clicks / readB.impressions;
  const label = `« ${short(product.title, 30)} » : CTR ${pct(ctrA, 2)} contre ${pct(ctrB, 2)} sur les mêmes jours`;
  const weight = TALENT.weight['copy:natural']!;
  recordEvidence(w, a.createdBy, 'copy', 'natural', s, weight, label, opponent);
  recordEvidence(w, b.createdBy, 'copy', 'natural', 1 - s, weight, label, before);
  const duel: Duel = {
    id: `duel-n${day}-${a.id}-${b.id}`, season: league.season, skill: 'copy', kind: 'natural', agents: [a.createdBy, b.createdBy],
    productId: product.id, campaignId, creativeIds: [a.id, b.id], taskIds: [], experimentId: null, status: 'settled',
    startDay: Math.min(...shared), endDay: day,
    result: { ctr: [round4(ctrA), round4(ctrB)], n: [readA.impressions, readB.impressions], z: round4(z), s: round4(s), delta: round1(ratingA.rating - before) },
  };
  league.duels.push(duel);
  const natural = league.duels.filter((d) => d.kind === 'natural');
  if (natural.length > kept) league.duels.splice(league.duels.indexOf(natural[0]!), 1);
}

/** Each pair of creatives by two people, on rows no earlier duel of theirs settled. The first creative's author is `agents[0]`. */
export function settleNaturalDuels(w: WorldState, day: number): void {
  if (!w.company.league) return;
  const byCampaign = new Map<string, DailyAdStats[]>();
  for (const r of adRows(w, day - NATURAL_WINDOW_DAYS + 1, day)) {
    if (r.impressions <= 0) continue;
    const rows = byCampaign.get(r.campaignId);
    if (rows) rows.push(r);
    else byCampaign.set(r.campaignId, [r]);
  }
  const working = new Set(w.company.agents.map((a) => a.id));
  for (const [campaignId, rows] of byCampaign) {
    const product = w.company.products.find((p) => p.id === rows[0]!.productId);
    const ids = new Set(rows.map((r) => r.creativeId));
    const creatives = w.company.creatives.filter((c) => ids.has(c.id) && working.has(c.createdBy));
    if (!product) continue;
    creatives.forEach((a, i) => {
      for (const b of creatives.slice(i + 1)) if (a.createdBy !== b.createdBy) settlePair(w, day, campaignId, rows, a, b, product);
    });
  }
}

// ───────────────────────────── routing (§6.4) ─────────────────────────────

/**
 * What the observed rating takes off a load in `assignReady`, `league` only. Never the truth, nothing else in the sort
 * moves, and a kind without a skill has no rating to read. The season's employee is ahead by one more.
 */
export function routeBonus(w: WorldState, a: AgentState, kind: TaskKind): number {
  const league = w.company.league;
  const skill = KIND_SKILL[kind];
  if (talentMode(w) !== 'league' || !league || !skill) return 0;
  const rated = (id: AgentId): number => league.entries[id]?.ratings[skill]?.rating ?? TALENT.rating.par;
  const family = familyOf(w, skill).map((x) => rated(x.id));
  const familyMean = family.length ? mean(family) : TALENT.rating.par;
  const perk = league.perks.some((p) => p.agentId === a.id && p.season === league.season) ? TALENT.perkRouting : 0;
  return clamp((rated(a.id) - familyMean) / TALENT.routePerPoint, -1, 1) + perk;
}
