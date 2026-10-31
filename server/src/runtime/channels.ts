/**
 * Which channels the company buys on (channels §7): what unlocks one, the small tests that find where a niche sells, what
 * a (channel, niche) line has proved so far, and when a channel is cut. No `company.channels` is TikTok alone. Every draw
 * sits on ctx.channelRng and everything waits for the first `requestRole(…, 'channel', …)`: until then a full run is a
 * `tiktok_only` run, byte for byte (D24).
 */
import type { AdReviewResult, DayPlanItem } from '../contracts.js';
import type { AdCreative, AdRatio, Campaign, ChannelBook, ChannelId, ChannelNicheState, ChannelRow, Product, Task, TaskKind, WorldEvent, WorldState } from '../shared.js';
import { CHANNELS, CHANNEL_IDS, acceptance, channelOf, droppedBeforeSubmission } from '../shared.js';
import { emit, nextId } from '../core/index.js';
import { RECON } from '../learning/attribution.js';
import { acquisitionCandidates, channelPaused, companyPaidBlock, creativeStats, launchableCreatives, productPaidBlock, TEST_CAMPAIGN_BUDGET, TIRED_FREQUENCY, versionSince } from './acquisition.js';
import { allocationMorning } from './allocator.js';
import { CHANNEL_POLICY, CHANNEL_ROLE } from './channelPolicy.js';
import type { RuntimeCtx } from './ctx.js';
import { incident, nicheBriefOf, nicheName, say, speak } from './ctx.js';
import { logDecision } from './digest.js';
import { addHold, adsHold, REFUSAL_COOLDOWN_DAYS } from './holds.js';
import { activeCampaigns, campaignMetrics, committedAdBudget, currentBudget, reviewCount, type CampaignMetrics } from './metrics.js';
import { learning, sim } from './modules.js';
import { requestRole } from './org/hiring.js';
import { officerId, ownersOfAny, roleHolders } from './org/officers.js';
import type { Pillar } from './pillars.js';
import { addPlaybookRule, directivesOf } from './playbook.js';
import { budgetQueue } from './portfolio.js';
import { growthOn } from './stages.js';
import { onStrike } from './talent/evidence.js';
import { KIND_META, openTasks, taskChannel } from './tasks.js';
import { clamp, dec, eur, round2, short, sum } from './util.js';

export { CHANNEL_ROLE, channelPaused };

const WRITERS: readonly TaskKind[] = ['write_ad_hooks', 'produce_ad', 'write_search_ads'];
/** Kinds that bring a test closer: while one is open for a (product, channel), that test is on its way. */
const TEST_KINDS: readonly TaskKind[] = ['launch_campaign', 'adapt_creative', 'write_search_ads'];
/** The ratio a channel's cut takes. YouTube and Search have none: the first reuses the master, the second writes text. */
const CUT_RATIO: Partial<Record<ChannelId, Exclude<AdRatio, 'text'>>> = { meta: '4:5', pinterest: '2:3' };

export function ensureChannelBook(w: WorldState): void {
  if ((w.scenario.channelControl ?? 'tiktok_only') === 'tiktok_only') return;
  w.company.channels ??= { open: ['tiktok'], requested: {}, lines: [], plan: null, attribution: null };
}

export function openChannels(w: WorldState): ChannelId[] {
  return [...(w.company.channels?.open ?? ['tiktok'])];
}

export function multiChannel(w: WorldState): boolean {
  return (w.company.channels?.open.length ?? 1) > 1;
}

/**
 * Reconciled credit of a (channel, niche): the niche's where the sample was enough, else the channel's. A report older than
 * RECON.staleDays counts as 1: with no analyst the company reads last click, and pays for it.
 */
export function creditOf(w: WorldState, ch: ChannelId, nicheId: string): number {
  const report = w.company.channels?.attribution;
  if (!report || w.scenario.channelControl === 'last_click' || w.day - report.day > RECON.staleDays) return 1;
  return report.niches[nicheId]?.[ch] ?? report.rows.find((r) => r.channel === ch)?.credit ?? 1;
}

/** Metrics read with a credit: decisions on money see this, the books stay with the shop (channels §5.3). */
export function adjusted<T extends Pick<CampaignMetrics, 'revenue' | 'roas'>>(m: T, credit: number): T {
  return credit === 1 ? m : { ...m, revenue: round2(m.revenue * credit), roas: m.roas * credit };
}

/** The line of a (channel, niche), opened as `untested` the first time someone asks. */
export function lineOf(w: WorldState, ch: ChannelId, nicheId: string): ChannelNicheState {
  const { lines } = w.company.channels!;
  let line = lines.find((l) => l.channel === ch && l.nicheId === nicheId);
  if (!line) {
    line = { channel: ch, nicheId, status: 'untested', since: w.day, spend: 0, revenue: 0, reason: null, retestDay: null };
    lines.push(line);
  }
  return line;
}

// ───────────────────────────── unlock ─────────────────────────────

type UnlockStep = ChannelRow['unlock'][number];

const step = (label: string, value: number, target: number, unit: string): UnlockStep => ({ label, value: round2(value), target, unit, met: value >= target });

/** ROAS of the last closed days, outage days out: nothing could sell on those. */
function recentRoas(w: WorldState, days: number): number {
  const to = sim.lastClosedDay(w);
  const outage = sim.announcedOutageDays(w);
  const rows = w.market.adStats.filter((s) => s.day > to - days && s.day <= to && !outage.includes(s.day));
  const spend = sum(rows.map((s) => s.spend));
  return spend > 0 ? sum(rows.map((s) => s.revenue)) / spend : 0;
}

/** An approved TikTok creative that is not itself a cut: what every other channel starts from. */
function isMaster(c: AdCreative): boolean {
  return c.review.status === 'approved' && !c.masterId && acceptance('tiktok', c) !== null;
}

/** The live guide closest to what Search asks of a landing page: enough reviews first, then their rating, then the page. */
function bestLanding(w: WorldState): Product | undefined {
  const { google } = CHANNEL_POLICY.unlock;
  const page = (p: Product) => p.salesQuality?.overall ?? 0;
  const reviews = reviewCount;
  const score = (p: Product) => Number(reviews(p) >= google.reviews) + Number(p.stats.rating >= google.rating) + Number(page(p) >= google.pageQuality);
  return [...w.company.products.filter((p) => p.status === 'live')].sort((a, b) => score(b) - score(a) || reviews(b) - reviews(a) || a.id.localeCompare(b.id))[0];
}

function unlockSteps(w: WorldState, ch: ChannelId): UnlockStep[] {
  const { unlock } = CHANNEL_POLICY;
  const { cash, runwayDays } = currentBudget(w);
  switch (ch) {
    case 'tiktok': return [];
    case 'meta': return [step('Ventes', sum(w.company.products.map((p) => p.stats.sales)), unlock.meta.sales, 'ventes'), step('ROAS 14 jours', recentRoas(w, 14), unlock.meta.roas14d, '×')];
    case 'youtube': {
      const best = Math.max(0, ...w.company.creatives.filter((c) => isMaster(c) && acceptance('youtube', c) !== null).map((c) => c.quality?.overall ?? 0));
      return [step('Trésorerie', cash, unlock.youtube.cash, '€'), step('Meilleure créa 9:16 validée', best, unlock.youtube.masterQuality, '/100')];
    }
    case 'pinterest': return [step('Trésorerie', cash, unlock.pinterest.cash, '€'), step('Autonomie', runwayDays ?? unlock.pinterest.minRunwayDays, unlock.pinterest.minRunwayDays, 'jours')];
    case 'google': {
      const p = bestLanding(w);
      return [step('Avis', p ? reviewCount(p) : 0, unlock.google.reviews, 'avis'), step('Note', p?.stats.rating ?? 0, unlock.google.rating, '/5'), step('Page de vente', p?.salesQuality?.overall ?? 0, unlock.google.pageQuality, '/100')];
    }
  }
}

/** What the company reads to open a channel, observable data only. The reason in French, or null while one condition fails. */
export function unlockReason(w: WorldState, ch: ChannelId): string | null {
  const steps = unlockSteps(w, ch);
  if (!steps.length || steps.some((s) => !s.met)) return null;
  return steps.map((s) => `${s.label} ${dec(s.value, Number.isInteger(s.value) ? 0 : 2)} ${s.unit} (seuil ${dec(s.target, Number.isInteger(s.target) ? 0 : 2)})`).join(', ');
}

/** The conditions of §7.1 plus the buyer, for the screen. */
export function unlockProgress(w: WorldState, ch: ChannelId): UnlockStep[] {
  return [...unlockSteps(w, ch), step('Media buyer', roleHolders(w, CHANNEL_ROLE[ch]).length, 1, 'poste')];
}

function planItem(kind: TaskKind, input: Record<string, unknown>, why: string, title: string, priority: 1 | 2 | 3 = 2): DayPlanItem {
  return { kind, title, dept: KIND_META[kind].dept, priority, input, why };
}

/** Each closed channel whose conditions hold: a buyer first, through the org's money gates, then its account. No hire, no channel (D23). */
function planUnlocks(ctx: RuntimeCtx, items: DayPlanItem[], notes: string[]): void {
  const w = ctx.world;
  const book = w.company.channels!;
  if (!w.company.products.some((p) => p.status === 'live')) return; // nothing on sale: a buyer would have nothing to buy for
  for (const ch of CHANNEL_IDS) {
    if (book.open.includes(ch) || book.requested[ch] !== undefined || adsHold(w, null, ch)) continue;
    const why = unlockReason(w, ch);
    if (!why) continue;
    const { label } = CHANNELS[ch];
    const role = CHANNEL_ROLE[ch];
    if (!roleHolders(w, role).length) {
      requestRole(ctx, role, 'channel', `${label} : ${why}.`);
      continue;
    }
    items.push(planItem('open_channel', { channel: ch }, `${label} : ${why}.`, `Ouvrir le canal ${label}`, 1));
    notes.push(`${label} remplit ses conditions : on ouvre le compte.`);
  }
}

// ───────────────────────────── discovery ─────────────────────────────

/**
 * A niche's arms, created once. What the category taught on a channel carries over, weighted by how much it saw, and the
 * planners' noisy audience reading does the rest: the second home guide starts leaning to Pinterest.
 */
export function ensureChannelArms(ctx: RuntimeCtx, nicheId: string): void {
  const w = ctx.world;
  const arms = (w.company.bandits[`channel:${nicheId}`] ??= []);
  const missing = openChannels(w).filter((ch) => !arms.some((a) => a.key === ch));
  if (!missing.length) return;
  const category = learning.armStats(w, `channel_cat:${nicheBriefOf(ctx, nicheId).category}`);
  const signals = ctx.tools.channelSignals(nicheId);
  for (const ch of missing) {
    const seen = category.find((a) => a.key === ch);
    const k = Math.min(CHANNEL_POLICY.categoryPriorMax, (seen?.pulls ?? 0) / 2);
    const mean = seen?.mean ?? 0;
    const audience = (signals.find((s) => s.channel === ch)?.audience ?? 50) / 100;
    arms.push({ key: ch, alpha: round2(1 + k * mean + audience), beta: round2(1 + k * (1 - mean) + (1 - audience)), pulls: 0, reward: 0 });
  }
}

/** The bandit's pick for a niche. A `Privilégier le canal` lesson weighs one alpha while it stands, and writes nothing to the arm. */
function pickChannel(ctx: RuntimeCtx, nicheId: string, arms: readonly ChannelId[]): ChannelId {
  const w = ctx.world;
  const dimension = `channel:${nicheId}`;
  ensureChannelArms(ctx, nicheId);
  const favourite = directivesOf(w, officerId(w, 'growth'), nicheName(ctx, nicheId)).channel;
  const arm = w.company.bandits[dimension]!.find((a) => a.key === favourite);
  const alpha = arm?.alpha ?? 0;
  if (arm) arm.alpha = alpha + 1;
  const pick = learning.chooseArm(w, dimension, arms, ctx.channelRng) as ChannelId;
  if (arm) arm.alpha = alpha;
  return pick;
}

const dailyTest = (ch: ChannelId): number => Math.max(CHANNELS[ch].minDailyBudget, TEST_CAMPAIGN_BUDGET);

/** Campaigns of a (channel, niche), whatever their status. */
function campaignsOn(w: WorldState, ch: ChannelId, nicheId: string): Campaign[] {
  const inNiche = new Set(w.company.products.filter((p) => p.nicheId === nicheId).map((p) => p.id));
  return w.company.campaigns.filter((c) => channelOf(c) === ch && inNiche.has(c.productId));
}

function testInFlight(w: WorldState, p: Product, ch: ChannelId): boolean {
  return openTasks(w, (t) => TEST_KINDS.includes(t.kind) && t.input.productId === p.id && t.input.channel === ch).length > 0;
}

const running = (w: WorldState, p: Product, ch: ChannelId): boolean => activeCampaigns(w, p.id).some((c) => channelOf(c) === ch);

/** Is a killed line back in play? Its retest day, a new version of the guide, or a category that does well there. */
function lineReopened(ctx: RuntimeCtx, line: ChannelNicheState, p: Product): boolean {
  const w = ctx.world;
  if (line.retestDay === null || w.day >= line.retestDay || versionSince(w, p) > line.since) return true;
  const category = learning.armStats(w, `channel_cat:${nicheBriefOf(ctx, p.nicheId).category}`);
  return (category.find((a) => a.key === line.channel)?.mean ?? 0) > CHANNEL_POLICY.retestCategoryMean;
}

/** Open channels a guide may be tested on today. TikTok is not one of them: it is the arm a test has to beat. */
function eligibleChannels(ctx: RuntimeCtx, p: Product): ChannelId[] {
  const w = ctx.world;
  return openChannels(w).filter((ch) => {
    if (ch === 'tiktok' || companyPaidBlock(w, ch) || productPaidBlock(w, p, ch)?.hard) return false;
    const line = w.company.channels!.lines.find((l) => l.channel === ch && l.nicheId === p.nicheId);
    if (!line) return true;
    if (line.status === 'proven' || line.status === 'blocked') return false;
    return line.status !== 'killed' || lineReopened(ctx, line, p);
  });
}

/** Masters of a guide this channel has not seen yet, best first. */
function freeMasters(w: WorldState, p: Product, ch: ChannelId): AdCreative[] {
  const cut = (c: AdCreative) => w.company.creatives.some((x) => x.masterId === c.id && !!x.channelReviews?.[ch]);
  return w.company.creatives
    .filter((c) => c.productId === p.id && isMaster(c) && !c.channelReviews?.[ch] && !cut(c) && (ch !== 'youtube' || acceptance(ch, c) !== null))
    .sort((a, b) => (b.quality?.overall ?? 0) - (a.quality?.overall ?? 0) || a.id.localeCompare(b.id));
}

/**
 * Our own review dropped the last drafts of this (channel, niche). A drop names no rule, so no platform blocks the line: the
 * writers get `retestDays` before the next order, or the plan would buy the same drop every morning.
 */
function draftsKeepFailing(w: WorldState, ch: ChannelId, nicheId: string): boolean {
  const inNiche = new Set(w.company.products.filter((p) => p.nicheId === nicheId).map((p) => p.id));
  const verdicts = w.company.creatives.flatMap((c) => (inNiche.has(c.productId) && c.channelReviews?.[ch]?.day != null ? [c.channelReviews[ch]!] : []));
  const passed = Math.max(0, ...verdicts.filter((r) => !droppedBeforeSubmission(r)).map((r) => r.day!));
  const drops = verdicts.filter((r) => droppedBeforeSubmission(r) && r.day! >= passed).map((r) => r.day!);
  return drops.length >= CHANNEL_POLICY.rejections && w.day - Math.max(...drops) < CHANNEL_POLICY.retestDays;
}

/** Plans what a channel needs before a launch: two cuts, a Search ad, or a master simply submitted to YouTube. */
function askCreatives(ctx: RuntimeCtx, items: DayPlanItem[], p: Product, ch: ChannelId, masters: AdCreative[], attachTo?: string): void {
  if (draftsKeepFailing(ctx.world, ch, p.nicheId)) return;
  const { label } = CHANNELS[ch];
  if (ch === 'google') {
    items.push(planItem('write_search_ads', { productId: p.id, channel: ch }, `Il faut des annonces pour tester ${label}.`, `Écrire des annonces Search — « ${short(p.title, 42)} »`));
    return;
  }
  const ratio = CUT_RATIO[ch];
  masters.forEach((master, slot) => {
    if (!ratio) { submitToChannel(ctx, master, p, ch); return; }
    items.push(planItem('adapt_creative', { productId: p.id, channel: ch, masterId: master.id, ratio, slot, ...(attachTo ? { attachTo } : {}) }, `Une créa au format de ${label}, à partir de celle qui marche.`, `Adapter une créa pour ${label} — « ${short(p.title, 40)} »`));
  });
}

/**
 * The small tests of the day (channels §7.2): best guides first, the bandit picks a channel or stays on TikTok, and what is
 * picked gets its creatives then a launch at the smallest useful budget, inside the test envelope. Under growth the Monday
 * queue goes first, so a guide waiting for its paid test comes before one that only keeps, and a guide TikTok has closed has
 * no arm to stay on: this is the only way its test can run.
 */
function planTests(ctx: RuntimeCtx, items: DayPlanItem[], notes: string[]): void {
  const w = ctx.world;
  const { maxTests, testShare } = CHANNEL_POLICY;
  const budget = currentBudget(w);
  const envelope = budget.adCap * testShare;
  const tests = activeCampaigns(w).filter((c) => c.test);
  let count = tests.length;
  let spent = sum(tests.map((c) => c.dailyBudget));
  let room = budget.adCap - committedAdBudget(w);
  for (const { product: p, block } of budgetQueue(w, acquisitionCandidates(w), (c) => c.product.id)) {
    if (count >= maxTests) break;
    const eligible = eligibleChannels(ctx, p);
    if (!eligible.length) continue;
    const pick = pickChannel(ctx, p.nicheId, growthOn(w) && block?.hard ? eligible : [...eligible, 'tiktok']);
    if (pick === 'tiktok' || running(w, p, pick)) continue;
    const cost = dailyTest(pick);
    if (spent + cost > envelope || cost > room) break;
    const { label } = CHANNELS[pick];
    count++;
    spent += cost;
    room -= cost;
    if (testInFlight(w, p, pick)) continue;
    if (!launchableCreatives(w, p.id, pick).length) askCreatives(ctx, items, p, pick, freeMasters(w, p, pick).slice(0, 2));
    // Cuts come back through a review, on a later day. YouTube has no task to wait for: what it just approved goes out today.
    if (!launchableCreatives(w, p.id, pick).length) continue;
    items.push(planItem('launch_campaign', { productId: p.id, channel: pick, test: true }, `Test à ${eur(cost)}/jour : ${label} marche-t-il pour ce guide ?`, `Tester ${label} — « ${short(p.title, 42)} »`));
    notes.push(`Test ${label} sur « ${short(p.title, 40)} ».`);
  }
}

/** A proven line with nothing running on a guide: no bandit and no envelope, the allocator sizes what comes back. */
function planProven(ctx: RuntimeCtx, items: DayPlanItem[]): void {
  const w = ctx.world;
  const proven = w.company.channels!.lines.filter((l) => l.status === 'proven');
  if (!proven.length) return;
  for (const { product: p } of acquisitionCandidates(w)) {
    for (const line of proven) {
      const ch = line.channel;
      if (line.nicheId !== p.nicheId || running(w, p, ch) || testInFlight(w, p, ch) || companyPaidBlock(w, ch) || productPaidBlock(w, p, ch)) continue;
      const { label } = CHANNELS[ch];
      if (launchableCreatives(w, p.id, ch).length) items.push(planItem('launch_campaign', { productId: p.id, channel: ch }, `${label} a fait ses preuves sur cette niche.`, `Relancer ${label} — « ${short(p.title, 42)} »`));
      else askCreatives(ctx, items, p, ch, freeMasters(w, p, ch).slice(0, 2));
    }
  }
}

/** A tired campaign outside TikTok asks a cut of the newest master, and takes it when it lands (channels §7.5). Search has no fatigue. */
function planRefresh(ctx: RuntimeCtx, items: DayPlanItem[]): void {
  const w = ctx.world;
  for (const c of activeCampaigns(w)) {
    const ch = channelOf(c);
    const p = w.company.products.find((x) => x.id === c.productId);
    if (ch === 'tiktok' || ch === 'google' || !p || testInFlight(w, p, ch)) continue;
    if (!c.creativeIds.some((id) => creativeStats(w, id, ch).lastFrequency >= TIRED_FREQUENCY) || launchableCreatives(w, p.id, ch).length) continue;
    const newest = [...freeMasters(w, p, ch)].sort((a, b) => b.createdDay - a.createdDay)[0];
    if (newest) askCreatives(ctx, items, p, ch, [newest], c.id);
  }
}

/** A week of spend on 2 channels or more: there is something to reconcile. */
function reconcileDue(w: WorldState): boolean {
  const from = w.day - 7;
  const spent = new Set<ChannelId>();
  for (let i = w.market.adStats.length - 1; i >= 0 && w.market.adStats[i]!.day >= from; i--) {
    const s = w.market.adStats[i]!;
    if (s.spend > 0) spent.add(channelOf(s));
  }
  return spent.size >= 2;
}

/** Léo's morning, in the CEO's plan (channels §7.1, §7.2). Everything past the unlock waits for a second channel. */
export function planChannels(ctx: RuntimeCtx, items: DayPlanItem[], notes: string[]): void {
  if (!ctx.world.company.channels) return;
  planUnlocks(ctx, items, notes);
  if (!multiChannel(ctx.world)) return;
  planTests(ctx, items, notes);
  planProven(ctx, items);
  planRefresh(ctx, items);
  if (reconcileDue(ctx.world)) items.push(planItem('reconcile_channels', {}, 'Chaque plateforme s’attribue plus que ce que la boutique voit : on recale avant de décider.', 'Rapprocher les canaux'));
}

/** A channel's verdict on a creative, and what the company does with it. After 2 rule rejections the line stops submitting. */
export function submitToChannel(ctx: RuntimeCtx, creative: AdCreative, product: Product, ch: ChannelId): AdReviewResult {
  const w = ctx.world;
  const { label } = CHANNELS[ch];
  const res = ctx.tools.submitCreative(creative.id, ch);
  const growth = officerId(w, 'growth');
  const refs = { creativeId: creative.id, productId: product.id };
  if (res.status === 'approved') {
    say(ctx, growth, `${label} valide la pub « ${short(creative.hook, 60)} »`, 'ad', refs);
    return res;
  }
  const reason = res.reason ?? 'non conforme';
  if (res.strike) onStrike(w, creative);
  incident(ctx, `Pub refusée par ${label} (« ${short(creative.hook, 50)} ») : ${reason}`);
  say(ctx, growth, `${label} refuse la pub « ${short(creative.hook, 50)} » : ${short(reason, 70)}${res.strike ? ' — avertissement sur le compte !' : ''}`, 'ad', refs);
  if (!res.rule) return res;
  const word = /«\s*([^»]+?)\s*»\s*\)\.?/.exec(reason)?.[1];
  if (word) for (const writer of ownersOfAny(w, WRITERS)) addPlaybookRule(w, writer.id, `Sur ${label}, ne jamais écrire « ${word} »`);
  const rejected = w.company.creatives.filter((c) => c.channelReviews?.[ch]?.status === 'rejected' && !!c.channelReviews[ch]!.rule && w.company.products.find((x) => x.id === c.productId)?.nicheId === product.nicheId);
  if (rejected.length >= CHANNEL_POLICY.rejections) {
    const line = lineOf(w, ch, product.nicheId);
    if (line.status !== 'blocked') speak(ctx, 'growth', `${label} refuse cette niche : on n'y soumet plus rien.`, 'ad', { productId: product.id });
    Object.assign(line, { status: 'blocked', reason, retestDay: null });
  }
  return res;
}

// ───────────────────────────── verdicts ─────────────────────────────

/** A test that went out opens its line's count. One that lands on a line already proven is a campaign like the others. */
function startTests(w: WorldState): void {
  for (const c of activeCampaigns(w)) {
    const nicheId = w.company.products.find((p) => p.id === c.productId)?.nicheId;
    if (!c.test || !nicheId) continue;
    const line = lineOf(w, channelOf(c), nicheId);
    if (line.status === 'proven') delete c.test;
    else if (line.status === 'untested' || line.status === 'killed') Object.assign(line, { status: 'testing', since: c.startDay, reason: null, retestDay: null });
  }
}

/** Spend and reconciled revenue of every line since its `since`, in one pass. */
function readLines(w: WorldState, book: ChannelBook): void {
  const nicheOf = new Map(w.company.products.map((p) => [p.id, p.nicheId]));
  const lines = new Map(book.lines.map((l) => [`${l.channel}:${l.nicheId}`, l]));
  for (const line of book.lines) { line.spend = 0; line.revenue = 0; }
  for (const s of w.market.adStats) {
    const line = lines.get(`${channelOf(s)}:${nicheOf.get(s.productId)}`);
    if (line && s.day >= line.since) { line.spend += s.spend; line.revenue += s.revenue; }
  }
  for (const line of book.lines) {
    line.spend = round2(line.spend);
    line.revenue = round2(line.revenue * creditOf(w, line.channel, line.nicheId));
  }
}

/** A kill is for good: a campaign that was only off for the day (an outage, a founder's stop) no longer has anything to come back to. */
function pauseAll(ctx: RuntimeCtx, campaigns: Campaign[]): number {
  let paused = 0;
  for (const c of campaigns) {
    delete c.pausedFor;
    if (c.status !== 'active' || !ctx.tools.updateCampaign(c.id, { status: 'paused' }).ok) continue;
    c.status = 'paused';
    paused++;
  }
  return paused;
}

function killLine(ctx: RuntimeCtx, line: ChannelNicheState, reason: string): void {
  const w = ctx.world;
  Object.assign(line, { status: 'killed', reason, retestDay: w.day + CHANNEL_POLICY.retestDays });
  pauseAll(ctx, campaignsOn(w, line.channel, line.nicheId));
  speak(ctx, 'growth', `${CHANNELS[line.channel].label} coupé sur ${nicheBriefOf(ctx, line.nicheId).name} : ${reason}. Nouveau test au jour ${line.retestDay}.`, 'ad');
}

/** A line that paid enters the allocator: its campaigns stop being tests. */
function proveLine(ctx: RuntimeCtx, line: ChannelNicheState, roas: number): void {
  Object.assign(line, { status: 'proven', reason: null, retestDay: null });
  for (const c of campaignsOn(ctx.world, line.channel, line.nicheId)) delete c.test;
  speak(ctx, 'growth', `${CHANNELS[line.channel].label} fait ses preuves sur ${nicheBriefOf(ctx, line.nicheId).name} : ROAS réconcilié ${dec(roas)} pour ${eur(line.spend)}.`, 'ad');
}

function judgeTest(ctx: RuntimeCtx, line: ChannelNicheState): void {
  const { prove } = CHANNEL_POLICY;
  const { testDays, stopLossSpend } = CHANNELS[line.channel];
  const days = ctx.world.day - line.since;
  const sample = prove.spendTimes * stopLossSpend;
  if (days < testDays || line.spend < sample) return;
  const roas = line.revenue / line.spend;
  const read = `ROAS réconcilié ${dec(roas)} pour ${eur(line.spend)}`;
  if (roas >= prove.roas) proveLine(ctx, line, roas);
  else if (roas < prove.kill) killLine(ctx, line, read);
  else if (!prove.extendOnce || (days >= 2 * testDays && line.spend >= 2 * sample)) { // the one extension is over
    if (roas >= prove.keep) proveLine(ctx, line, roas);
    else killLine(ctx, line, read);
  }
}

/** 2 stopped campaigns under ROAS 1 on a real sample: the line dies, whatever it did before. */
function judgeStopped(ctx: RuntimeCtx, line: ChannelNicheState): void {
  const w = ctx.world;
  const { lineKill } = CHANNEL_POLICY;
  const credit = creditOf(w, line.channel, line.nicheId);
  const losers = campaignsOn(w, line.channel, line.nicheId)
    .filter((c) => c.status !== 'active' && !c.pausedFor && c.startDay >= line.since)
    .map((c) => adjusted(campaignMetrics(w.market.adStats, c.id), credit))
    .filter((m) => m.spend > 0 && m.roas < 1);
  if (losers.length < lineKill.losers) return;
  const spend = sum(losers.map((m) => m.spend));
  const roas = sum(losers.map((m) => m.revenue)) / Math.max(spend, 1e-9);
  if (spend >= lineKill.spendTimes * CHANNELS[line.channel].stopLossSpend && roas < lineKill.roas) killLine(ctx, line, `${losers.length} campagnes arrêtées, ROAS réconcilié ${dec(roas)} pour ${eur(spend)}`);
}

/** Each morning, on credit-adjusted numbers: tests get their verdict, lines that keep losing are cut. */
export function settleLines(ctx: RuntimeCtx): void {
  const w = ctx.world;
  const book = w.company.channels;
  if (!book) return;
  startTests(w);
  readLines(w, book);
  for (const line of book.lines) {
    if (line.status === 'testing') judgeTest(ctx, line);
    if (line.status === 'testing' || line.status === 'proven') judgeStopped(ctx, line);
  }
}

/** A channel that loses money company-wide stops: campaigns paused, no test for `reopenDays`, its buyer free. TikTok has its own brakes. */
function settleKills(ctx: RuntimeCtx): void {
  const w = ctx.world;
  const book = w.company.channels!;
  const { days, spend: minSpend, roas: minRoas, reopenDays } = CHANNEL_POLICY.channelKill;
  const to = sim.lastClosedDay(w);
  for (const ch of book.open.filter((c) => c !== 'tiktok')) {
    const rows = w.market.adStats.filter((s) => s.day > to - days && s.day <= to && channelOf(s) === ch);
    const spend = sum(rows.map((s) => s.spend));
    if (spend < minSpend) continue;
    const nicheOf = new Map(w.company.products.map((p) => [p.id, p.nicheId]));
    const revenue = sum(rows.map((s) => s.revenue * creditOf(w, ch, nicheOf.get(s.productId) ?? '')));
    const roas = revenue / spend;
    if (roas >= minRoas) continue;
    const { label } = CHANNELS[ch];
    const paused = pauseAll(ctx, w.company.campaigns.filter((c) => channelOf(c) === ch));
    book.open = book.open.filter((c) => c !== ch);
    book.requested[ch] = w.day + reopenDays;
    const why = `ROAS réconcilié ${dec(roas)} pour ${eur(spend)} en ${days} jours`;
    speak(ctx, 'growth', `${label} en pause, ${paused} campagne(s) arrêtée(s) : ${why}. Pas de test avant le jour ${book.requested[ch]}.`, 'ad');
    incident(ctx, `${label} mis en pause : ${why}`);
    logDecision(w, { kind: 'channel', who: officerId(w, 'growth'), text: `${label} mis en pause`, why });
  }
}

/** A requested account that finished its review joins the book, and so does a channel whose pause ran out. */
function settleOpenings(ctx: RuntimeCtx): void {
  const w = ctx.world;
  const book = w.company.channels!;
  const waiting = CHANNEL_IDS.filter((ch) => !book.open.includes(ch) && (book.requested[ch] ?? Number.POSITIVE_INFINITY) <= w.day);
  if (!waiting.length) return;
  const status = new Map(ctx.tools.channelStatus().map((s) => [s.id, s.state]));
  for (const ch of waiting) {
    if (status.get(ch) !== 'open') continue;
    const { label } = CHANNELS[ch];
    book.open.push(ch);
    const buyer = roleHolders(w, CHANNEL_ROLE[ch])[0];
    const event: WorldEvent = { id: nextId(w, 'evt'), day: w.day, kind: 'channel_opened', title: `${label} ouvert`, description: `Le compte ${label} est validé : ${buyer ? `${buyer.name} peut y lancer` : 'on peut y lancer'} les premiers tests.`, severity: 'good' };
    w.market.events.push(event);
    emit(w, { agentId: null, kind: 'event', text: `${event.title} — ${short(event.description, 140)}` });
    logDecision(w, { kind: 'channel', who: officerId(w, 'growth'), text: `${label} ouvert`, why: event.description });
  }
}

/** Reward of the day, once 2 channels are open: `learning/` reads no runtime, so the credit comes in here, after the retro. */
function rewardChannels(ctx: RuntimeCtx): void {
  const w = ctx.world;
  if (!multiChannel(w)) return;
  const { reward } = CHANNEL_POLICY;
  const nicheOf = new Map(w.company.products.map((p) => [p.id, p.nicheId]));
  const day = new Map<string, { ch: ChannelId; nicheId: string; spend: number; revenue: number }>();
  for (let i = w.market.adStats.length - 1; i >= 0 && w.market.adStats[i]!.day === w.day; i--) {
    const s = w.market.adStats[i]!;
    const nicheId = nicheOf.get(s.productId);
    if (!nicheId) continue;
    const key = `${channelOf(s)}:${nicheId}`;
    const row = day.get(key) ?? { ch: channelOf(s), nicheId, spend: 0, revenue: 0 };
    row.spend += s.spend;
    row.revenue += s.revenue;
    day.set(key, row);
  }
  for (const { ch, nicheId, spend, revenue } of day.values()) {
    if (spend < reward.minSpend) continue;
    ensureChannelArms(ctx, nicheId);
    const r = clamp((revenue / spend) * creditOf(w, ch, nicheId) / reward.roasScale);
    const weight = clamp(spend / reward.weightSpend, reward.weightMin, reward.weightMax);
    learning.rewardArm(w, `channel:${nicheId}`, ch, r, weight);
    learning.rewardArm(w, `channel_cat:${nicheBriefOf(ctx, nicheId).category}`, ch, r, weight * reward.categoryShare);
  }
}

async function channelsMorning(ctx: RuntimeCtx): Promise<void> {
  if (ctx.world.company.channels) {
    settleOpenings(ctx);
    settleLines(ctx);
    settleKills(ctx);
  }
  await allocationMorning(ctx);
}

/** The founder said no to a channel: nobody asks again for a week (D49). */
function channelRefused(ctx: RuntimeCtx, task: Task): void {
  if (task.kind !== 'open_channel') return;
  const w = ctx.world;
  const ch = taskChannel(task);
  const { label } = CHANNELS[ch];
  const until = w.day + REFUSAL_COOLDOWN_DAYS;
  addHold(w, { kind: 'ads', productId: null, channel: ch, until, reason: `le fondateur a refusé d'ouvrir ${label} le jour ${w.day} (nouvelle demande après le jour ${until})` });
  speak(ctx, 'growth', `compris, ${label} reste fermé jusqu'au jour ${until}.`, 'founder');
}

export const channelsPillar: Pillar = {
  mount: ensureChannelBook,
  morning: channelsMorning,
  async evening(ctx) { rewardChannels(ctx); },
  refused: channelRefused,
};

