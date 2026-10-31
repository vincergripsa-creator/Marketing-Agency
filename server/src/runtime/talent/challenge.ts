/**
 * The real test and the challenge (D16, D17, talent §7.4). Whoever wants a job writes a real deliverable through the
 * run's engine, with their own craft, and the company's own scorer marks it: no score here is drawn, and a test writes
 * nothing to the world. A replacement is one tick: everyone tested, one decision, the hire in, the leaver out.
 */
import type { AdCreative, AdFormat, AgentId, AgentState, Candidate, ChallengeEntry, HireReport, HookStyle, InboxMessage, Order, PdfContent, ProbationPlan, Product, RoleId, Skill, Task, TaskKind, VoiceOfCustomer, WorldState } from '../../shared.js';
import type { MindContext } from '../../contracts.js';
import { streamRng } from '../../core/index.js';
import { hashString } from '../../core/ids.js';
import { coverScore } from '../../deliverables/art/evaluate.js';
import { effortFor } from '../../deliverables/effort.js';
import { EDIT_BASELINE, planCut } from '../../deliverables/videoCut.js';
import type { RuntimeCtx } from '../ctx.js';
import { emptyVoc, nameOf, productBrief, speak } from '../ctx.js';
import { genericPhrases } from '../handlers/common.js';
import { COMPLIANCE_WORDS, SUPPORT_POLICY } from '../handlers/phrases.js';
import { flaggedSentences } from '../handlers/studio.js';
import { addHold, firingHold, pinHold } from '../holds.js';
import { computeBudget } from '../metrics.js';
import { deliverables, sim } from '../modules.js';
import { ROLES } from '../org/catalog.js';
import { STREAM } from '../streams.js';
import { ORG } from '../org/constants.js';
import { agentFrom, drawCandidates, hireAgent, openPosition, rankCandidates } from '../org/hiring.js';
import { officerId } from '../org/officers.js';
import { payOf } from '../org/payroll.js';
import { productPnls } from '../accounting.js';
import { createTask, openTasks } from '../tasks.js';
import { upsellContextOf } from '../upsell.js';
import { clamp, dec, eur, idNum, mean, round2, short, sum, uniq } from '../util.js';
import { MIN_SEASON_N, TALENT } from './constants.js';
import { bestDraft, craftFor, craftOf, effectiveT, pruneRead } from './craft.js';
import { familyOf, primaryOf } from './skills.js';
import { drawPerson, leagueEntry, talentMode } from './truth.js';

/** What a role without a skill scores, and a role with one while there is nothing to be tested on (D16). */
const NO_TEST = 50;
const CANDIDATES_PER_CHALLENGE = 3;
const REVENUE_DAYS = 14;
/** The ad test: two formats, on hooks of two styles, the same for everyone. */
const TEST_STYLES: readonly HookStyle[] = ['question', 'mistake'];
const TEST_FORMATS: readonly AdFormat[] = ['text_slideshow', 'faceless_voiceover'];
/** A guide test rewrites the guide: its own revisions, so no test reads like the text the team really wrote. */
const TEST_REVISION = 900;
/** The editing test works on a draft nobody can claim: the same one for all, written at this talent. */
const TEST_DRAFT_T = 0.4;
const TEST_MESSAGES = 12;
/** A designer with no truth to read: what `renderPdf` assumes of a guide with no effort given (pdf §13.1). */
const DESIGN_BASELINE = 0.3;
const MIN_NICHES = 3;
const BUYING_SCALE = 1000;

const round1 = (n: number): number => Math.round(n * 10) / 10;

// ───────────────────────────── The test ─────────────────────────────

/** The same table for everyone who sits: nothing here tells a candidate from the incumbent. */
export interface Bench {
  ctx: RuntimeCtx;
  skill: Skill;
  product: Product | null;     // the product with the most revenue: null while nothing is live
  voc: VoiceOfCustomer;
  playbook: string[];          // the role's rules: the hire inherits them, so they measure nobody
  draft?: PdfContent;          // the shared draft of the editing test
}

export interface TestResult {
  score: number;
  deliverable: string;         // French, short: what the report shows
  work: unknown[];             // what was really written, for whoever wants to check the score
}

export interface SkillTest {
  par(): number;               // the score of a hire who starts at 1500
  sit(b: Bench, sitter: AgentState, i: number): Promise<TestResult | null>; // null: nothing to be tested on today
}

function mindOf(b: Bench, sitter: AgentState, kind: TaskKind): MindContext {
  const w = b.ctx.world;
  const craft = craftFor(w, sitter, kind);
  return { agent: sitter, playbook: b.playbook, brainNotes: [], lessons: [], day: w.day, brand: w.scenario.companyName || w.company.name, ...(craft ? { craft } : {}) };
}

function scratchCreative(w: WorldState, product: Product, sitter: AgentState, d: Pick<AdCreative, 'hook' | 'hookStyle' | 'format' | 'scenes' | 'caption' | 'hashtags' | 'cta'>): AdCreative {
  return {
    id: 'test', productId: product.id, hook: d.hook, hookStyle: d.hookStyle, format: d.format, scenes: d.scenes, caption: d.caption, hashtags: d.hashtags, cta: d.cta,
    files: { storyboard: [], preview: null }, quality: null, review: { status: 'pending', reason: null, day: null }, createdDay: w.day, createdBy: sitter.id,
  };
}

async function copyTest(b: Bench, sitter: AgentState): Promise<TestResult | null> {
  const { ctx, product, voc } = b;
  if (!product) return null;
  const w = ctx.world;
  const upsellOf = upsellContextOf(w, product);
  const score = (c: AdCreative): number => sim.scoreCreative(c, product, voc).overall;
  const hooks = (await ctx.engine.writeAdHooks({ product, voc, styles: [...TEST_STYLES], upsellOf, usedHooks: [] }, mindOf(b, sitter, 'write_ad_hooks'))).filter((h) => h?.hook);
  if (!hooks.length) return null;
  const bannedClaims = uniq([...voc.bannedClaims, ...COMPLIANCE_WORDS]);
  const mind = mindOf(b, sitter, 'produce_ad');
  const work: AdCreative[] = [];
  for (const [i, format] of TEST_FORMATS.entries()) {
    const hook = hooks[i % hooks.length]!;
    const write = async (m: MindContext): Promise<AdCreative> => scratchCreative(w, product, sitter, await ctx.engine.writeAd({ product, voc, hook: hook.hook, hookStyle: hook.hookStyle, format, bannedClaims, upsellOf }, m));
    work.push((await bestDraft(ctx, sitter, mind, `test:ad:${i}`, write, score)).draft);
  }
  return { score: round1(mean(work.map(score))), deliverable: `Deux pubs : ${work.map((c) => `« ${short(c.hook, 40)} »`).join(' et ')}`, work };
}

/** The bench product's best script with film in it: a card for Pinterest or a search ad has nothing to edit. */
function bestScript(w: WorldState, product: Product): AdCreative | null {
  const filmed = w.company.creatives.filter((c) => c.productId === product.id && c.scenes.length > 1);
  return [...filmed].sort((a, b) => (b.quality?.overall ?? 0) - (a.quality?.overall ?? 0) || idNum(a.id) - idNum(b.id))[0] ?? null;
}

/** The same script, tempo and day's luck for everyone: only the editor differs (D16). */
async function videoTest(b: Bench, sitter: AgentState): Promise<TestResult | null> {
  const { ctx, product, voc } = b;
  const w = ctx.world;
  const creative = product && bestScript(w, product);
  if (!product || !creative) return null;
  const rng = streamRng(w.scenario.seed, STREAM.videoCut, hashString(`test|${creative.id}`));
  const cut = planCut({ creative, product, voc, skill: effectiveT(w, sitter, 'video') ?? EDIT_BASELINE, tempo: 'standard', rng });
  const { craft } = sim.scoreCut(cut);
  return { score: craft, deliverable: `Montage de « ${short(creative.hook, 40)} » : ${cut.beats.length} séquences, ${dec(cut.metrics.estSec, 0)} s`, work: [{ ...cut, craft }] };
}

const pdfScore = (b: Bench, product: Product, content: PdfContent): number =>
  sim.scorePdf(content, { audience: product.audience, problem: product.problem, voc: b.voc, design: product.design }).overall;

async function writeGuide(b: Bench, product: Product, mind: MindContext, revision: number): Promise<PdfContent> {
  const { ctx, voc } = b;
  const niche = productBrief(ctx, product);
  const outline = await ctx.engine.writeOutline({ title: product.title, niche, voc, revision }, mind);
  return ctx.engine.writePdfContent({ title: product.title, outline, niche, voc, upsellTitle: null, revision }, mind);
}

async function longformTest(b: Bench, sitter: AgentState, i: number): Promise<TestResult | null> {
  const { ctx, product } = b;
  if (!product) return null;
  const revision = TEST_REVISION + i;
  const { draft, realScore } = await bestDraft(ctx, sitter, mindOf(b, sitter, 'write_pdf'), 'test:guide', (m) => writeGuide(b, product, m, revision), (c) => pdfScore(b, product, c));
  return { score: round1(realScore), deliverable: `Guide en ${draft.chapters.length} chapitres : « ${short(draft.title, 50)} »`, work: [draft] };
}

/** One draft, whoever edits it: a weak writer's text, written once a bench. Its author is nobody: the head of HR's key. */
async function sharedDraft(b: Bench, product: Product): Promise<PdfContent> {
  const w = b.ctx.world;
  const author = w.company.agents.find((a) => a.id === officerId(w, 'hr'))!;
  b.draft ??= await writeGuide(b, product, { ...mindOf(b, author, 'write_pdf'), craft: craftOf('longform', TEST_DRAFT_T, 'haiku') }, TEST_REVISION);
  return b.draft;
}

async function polishTest(b: Bench, sitter: AgentState): Promise<TestResult | null> {
  const { ctx, product, voc } = b;
  if (!product) return null;
  const draft = await sharedDraft(b, product);
  const flagged = flaggedSentences(draft, genericPhrases());
  const mind = mindOf(b, sitter, 'humanize_pdf');
  let content = draft;
  let score = pdfScore(b, product, draft);
  for (let pass = 0; pass < (mind.craft?.passes ?? 1); pass++) {
    const next = await ctx.engine.humanize({ content, flagged, voc }, mind);
    const s = pdfScore(b, product, next);
    if (s < score) continue; // the rule of humanize_pdf: a pass that loses is not kept
    content = next;
    score = s;
  }
  return { score: round1(score), deliverable: `Relecture d'un guide : ${flagged.length} phrases signalées`, work: [content] };
}

/** The bench product's cover, all over again: the art this eye would keep, then what the cover is worth with it (D16). */
async function designTest(b: Bench, sitter: AgentState): Promise<TestResult | null> {
  const { ctx, product } = b;
  if (!product?.design) return null;
  const w = ctx.world;
  const art = deliverables.pickArt(product.design, effortFor(effectiveT(w, sitter, 'design') ?? DESIGN_BASELINE));
  const audit = deliverables.coverAudit({ title: product.title, subtitle: product.content?.subtitle || product.subtitle || '', audience: product.audience, design: { ...product.design, artSeed: art.seed }, brand: w.company.name });
  // `explored` stays out of the text: it is `effortFor(t).covers`, so printing it would read the hidden talent out.
  return { score: coverScore(audit), deliverable: `Couverture de « ${short(product.title, 40)} » : art ${Math.round(audit.art)}/100`, work: [{ ...audit, seed: art.seed, explored: art.explored }] };
}

async function pageTest(b: Bench, sitter: AgentState): Promise<TestResult | null> {
  const { ctx, product, voc } = b;
  if (!product?.content) return null;
  const { content } = product;
  const hype = product.salesPage?.hypeLevel ?? 0.4;
  const upsellOf = upsellContextOf(ctx.world, product);
  const { draft, realScore } = await bestDraft(ctx, sitter, mindOf(b, sitter, 'write_sales_page'), 'test:page', async (m) => {
    const sp = await ctx.engine.writeSalesPage({ product, content, voc, hype, upsellOf }, m);
    return { ...sp, hypeLevel: hype, priceWritten: product.price };
  }, (sp) => sim.scoreSalesPage(sp, product, voc).overall);
  return { score: round1(realScore), deliverable: `Page de vente : « ${short(draft.headline, 60)} »`, work: [draft] };
}

/** What this buyer would have kept of the last 14 days of real rows: the same rows for all, only the reading differs. */
async function buyingTest(b: Bench, sitter: AgentState): Promise<TestResult | null> {
  const { ctx } = b;
  const w = ctx.world;
  const t = effectiveT(w, sitter, 'buying') ?? 0;
  const rows = ctx.tools.getAdStats(Math.max(1, w.day - REVENUE_DAYS + 1));
  const kept = uniq(rows.map((r) => r.campaignId)).flatMap((campaign) => {
    const own = rows.filter((r) => r.campaignId === campaign);
    const dropped = new Set(pruneRead(own, uniq(own.map((r) => r.creativeId)), t));
    return own.filter((r) => !dropped.has(r.creativeId));
  });
  const impressions = sum(kept.map((r) => r.impressions));
  if (!impressions) return null;
  const ctr = sum(kept.map((r) => r.clicks)) / impressions;
  return { score: round1(ctr * BUYING_SCALE), deliverable: `Lecture de ${rows.length} lignes de campagne : CTR gardé ${dec(ctr * 100, 2)} %`, work: kept };
}

async function supportTest(b: Bench, sitter: AgentState): Promise<TestResult | null> {
  const { ctx } = b;
  const w = ctx.world;
  const closed: InboxMessage[] = ctx.tools.listInbox('all').filter((m) => m.status !== 'open').slice(-TEST_MESSAGES);
  if (!closed.length) return null;
  const mind = mindOf(b, sitter, 'reply_inbox');
  const policy = [...SUPPORT_POLICY, ...mind.playbook.filter((r) => !/^Ne jamais écrire/.test(r))];
  const scores: number[] = [];
  const work: unknown[] = [];
  for (const message of closed) {
    const product = w.company.products.find((p) => p.id === message.productId) ?? null;
    const order: Order | null = message.orderId ? w.market.orders.find((o) => o.id === message.orderId) ?? null : null;
    const reply = await ctx.engine.writeSupportReply({ message, product, order, policy, customer: message.customerName ? { name: message.customerName, archetype: 'normal' } : null }, mind);
    scores.push(sim.scoreSupportReply(message, reply).score);
    work.push(reply);
  }
  return { score: round1(mean(scores)), deliverable: `${closed.length} réponses à de vrais messages clients`, work };
}

/** Average ranks, ties shared. */
function ranksOf(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length).fill(0);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]!.v === order[start]!.v) end++;
    for (let k = start; k <= end; k++) ranks[order[k]!.i] = (start + end) / 2;
    start = end + 1;
  }
  return ranks;
}

/** -1..1. 0 when one side does not vary: a ranking that says nothing scores nothing. */
export function spearman(a: readonly number[], b: readonly number[]): number {
  const ra = ranksOf(a), rb = ranksOf(b);
  const ma = mean(ra), mb = mean(rb);
  const cov = sum(ra.map((x, i) => (x - ma) * (rb[i]! - mb)));
  const var2 = sum(ra.map((x) => (x - ma) ** 2)) * sum(rb.map((x) => (x - mb) ** 2));
  return var2 > 0 ? cov / Math.sqrt(var2) : 0;
}

/** Rank the company's own research, then compare with what each niche really earned. Under 3 niches there is nothing to compare with. */
async function researchTest(b: Bench, sitter: AgentState): Promise<TestResult | null> {
  const { ctx } = b;
  const w = ctx.world;
  const earned = new Map<string, number>();
  for (const row of productPnls(w, 1, w.day).products) {
    const niche = w.company.products.find((p) => p.id === row.productId)?.nicheId;
    if (niche) earned.set(niche, (earned.get(niche) ?? 0) + row.profit);
  }
  const { research } = w.company;
  if (earned.size < MIN_NICHES) return null;
  const ranking = await ctx.engine.rankOpportunities({ signals: research.trends, competitors: research.competitors, voc: research.voc, excludeNicheIds: [] }, mindOf(b, sitter, 'pick_opportunity'));
  const known = (ranking.ranked ?? []).filter((r) => earned.has(r.nicheId));
  if (known.length < MIN_NICHES) return null;
  const rho = spearman(known.map((_, i) => -i), known.map((r) => earned.get(r.nicheId)!));
  return { score: round1(NO_TEST + NO_TEST * rho), deliverable: `Classement de ${known.length} niches contre leur profit réel`, work: known };
}

const parOf = (key: string) => (): number => TALENT.par[key]!;

/** One row per skill. */
export const TEST_BY_SKILL: Partial<Record<Skill, SkillTest>> = {
  copy: { par: parOf('copy:qa'), sit: copyTest },
  video: { par: parOf('video:cut'), sit: videoTest },
  longform: { par: parOf('longform:qa'), sit: longformTest },
  polish: { par: parOf('longform:qa'), sit: polishTest },
  page: { par: parOf('page:qa'), sit: pageTest },
  design: { par: parOf('design:visual'), sit: designTest },
  buying: { par: () => 20, sit: buyingTest },
  support: { par: parOf('support:reply'), sit: supportTest },
  research: { par: () => NO_TEST, sit: researchTest },
};

/** The product that earned the most these 14 days, live and written: the one the company would least like to see done badly. */
function benchProduct(w: WorldState): Product | null {
  const earned = new Map<string, number>();
  for (const o of w.market.orders) if (o.day > w.day - REVENUE_DAYS) earned.set(o.productId, (earned.get(o.productId) ?? 0) + o.price);
  const live = w.company.products.filter((p) => p.status === 'live' && p.content);
  return [...live].sort((a, b) => (earned.get(b.id) ?? 0) - (earned.get(a.id) ?? 0) || idNum(a.id) - idNum(b.id))[0] ?? null;
}

export function benchFor(ctx: RuntimeCtx, skill: Skill, seat?: AgentState): Bench {
  const w = ctx.world;
  const product = benchProduct(w);
  const voc = (product && w.company.research.voc[product.nicheId]) || emptyVoc(product?.nicheId ?? '');
  return { ctx, skill, product, voc, playbook: seat ? [...(w.company.playbooks[seat.id] ?? [])] : [] };
}

/** The test of `b.skill`, through the run's engine, with `sitter`'s craft. Writes nothing to the world. */
export async function testDeliverable(b: Bench, sitter: AgentState, i: number): Promise<TestResult | null> {
  return (await TEST_BY_SKILL[b.skill]?.sit(b, sitter, i)) ?? null;
}

/** A copy that has nothing to learn yet: a test measures the person, not their first week. Everyone sits on the cheapest tier (talent §4.9). */
function sitterOf(w: WorldState, c: Candidate): AgentState {
  return { ...agentFrom(w, c), tier: 'haiku', hiredDay: 0, rampUntilDay: 0 };
}

/** A candidate holds no truth until hired: theirs is lent for the length of the test, then gone. */
async function sit(b: Bench, c: Candidate, i: number): Promise<TestResult | null> {
  const w = b.ctx.world;
  const agents = w.talentTruth?.agents;
  if (!agents) return null;
  const sitter = sitterOf(w, c);
  const known = agents[c.id];
  agents[c.id] = known ?? drawPerson(w, sitter, c.lineage);
  try {
    return await testDeliverable(b, sitter, i);
  } finally {
    if (!known) delete agents[c.id];
  }
}

/** D16: every hire sits the real test. A role without a skill, or no live product yet: 50, the named candidate first. */
export async function scoreCandidates(ctx: RuntimeCtx, role: RoleId, candidates: Candidate[]): Promise<void> {
  const skill = talentMode(ctx.world) === 'off' ? null : primaryOf(role);
  const bench = skill ? benchFor(ctx, skill) : null;
  for (const [i, c] of candidates.entries()) {
    const result = bench ? await sit(bench, c, i) : null;
    c.interview = result?.score ?? NO_TEST;
    c.deliverable = result?.deliverable ?? null;
  }
}

/** What the real test says becomes the first rating of a hire: a test is evidence, a weak one (rd 150). */
function firstRating(c: Candidate, skill: Skill): number {
  const { par, hirePerPoint, hireSpread } = TALENT.rating;
  const test = TEST_BY_SKILL[skill];
  if (!test || c.deliverable === null) return par;
  return round1(par + clamp((c.interview - test.par()) * hirePerPoint, -hireSpread, hireSpread));
}

/** A hire arrives with a truth, a clone's taken from their teacher, and an entry in the league. */
export function seedHire(w: WorldState, agent: AgentState, c: Candidate): void {
  const truth = w.talentTruth;
  const league = w.company.league;
  if (talentMode(w) === 'off' || !truth || !league) return;
  truth.agents[agent.id] ??= drawPerson(w, agent, c.lineage);
  const skill = primaryOf(agent.roleId);
  if (!skill) return;
  const entry = (league.entries[agent.id] ??= leagueEntry(w, agent, c.lineage));
  const rating = firstRating(c, skill);
  entry.ratings[skill] = { skill, rating, rd: TALENT.rating.hireRd, n: 0, seasonN: 0, metric: null, history: [{ day: w.day, rating }] };
}

// ───────────────────────────── The readable number of a plan ─────────────────────────────

/** How a role's number reads: what `SkillRating.metric` holds for that skill. `sd` puts a plan's target half a usual gap away (§7.2). */
export interface Metric { label: string; par(): number; sd(): number; text(x: number): string }

const outOf100 = (x: number): string => `${Math.round(x)}/100`;
const scored = (label: string, key: string, text = outOf100): Metric => ({ label, par: () => TALENT.par[key]!, sd: () => TALENT.sd[key]!, text });

export const METRICS: Record<Skill, Metric> = {
  copy: scored('qualité moyenne des pubs', 'copy:qa'),
  video: scored('qualité moyenne des montages', 'video:cut'),
  longform: scored('qualité moyenne des guides', 'longform:qa'),
  polish: scored('gain moyen de relecture', 'polish:qa', (x) => `${dec(x, 1)} points`),
  page: scored('qualité moyenne des pages', 'page:qa'),
  design: scored('qualité visuelle moyenne', 'design:visual'),
  buying: { label: 'ROAS moyen', par: () => 1.5, sd: () => TALENT.sd['buying:market']!, text: (x) => dec(x, 2) },
  research: { label: 'rang moyen des niches choisies', par: () => 50, sd: () => 25, text: outOf100 },
  support: scored('qualité moyenne des réponses', 'support:reply'),
};

export const ratingText = (r: number): string => String(Math.round(r)).replace(/\B(?=(\d{3})+$)/g, ' ');

/** A test score as it reads: « 91,5/100 ». */
const testText = (score: number): string => `${String(score).replace('.', ',')}/100`;

// ───────────────────────────── The challenge ─────────────────────────────

/** What a replacement costs on the day: the hire's week of pay, and the leaver's. */
function swapCost(w: WorldState, leaver: AgentState): number {
  if (!w.scenario.org?.payroll) return 0;
  return round2(ORG.recruitingDays * ORG.payPerDay[ROLES[leaver.roleId].tier] + ORG.severanceDays * payOf(leaver));
}

/** The CFO's word (talent §7.5). `checkGates` lets a replacement through (D17): this is the league's own, and the plan waits for the next close. */
export function hireBudgetOk(w: WorldState, leaver: AgentState): boolean {
  const b = computeBudget(w);
  return !b.bankrupt && !b.survival && b.cash >= 4 * swapCost(w, leaver);
}

/** The strongest colleague a clone can be taught by: well above par, on a real sample. */
function teacherFor(w: WorldState, skill: Skill, leaver: AgentId): AgentState | undefined {
  const league = w.company.league!;
  const rating = (a: AgentState) => league.entries[a.id]?.ratings[skill];
  return familyOf(w, skill)
    .filter((a) => a.id !== leaver && (rating(a)?.rating ?? 0) >= TALENT.challenge.cloneRating && (rating(a)?.seasonN ?? 0) >= MIN_SEASON_N[skill])
    .sort((a, b) => rating(b)!.rating - rating(a)!.rating || a.id.localeCompare(b.id))[0];
}

/** Two from the market and a clone of the best colleague, or three from the market. Its own key on the hire stream: nobody meets the same three twice. */
function challengers(ctx: RuntimeCtx, plan: ProbationPlan, leaver: AgentState): Candidate[] {
  const drawn = drawCandidates(ctx, leaver.roleId, hashString(`${plan.agentId}:${plan.openedSeason}`), CANDIDATES_PER_CHALLENGE);
  const teacher = teacherFor(ctx.world, plan.skill, leaver.id);
  const clone = drawn[drawn.length - 1];
  if (teacher && clone) {
    clone.lineage = teacher.id;
    clone.persona = `${clone.persona} Élève de ${teacher.name}.`;
  }
  return drawn;
}

/** Why nobody sits today: the founder's word comes before any test. */
function blocked(w: WorldState, id: AgentId): string | null {
  const hold = firingHold(w) ?? pinHold(w, id);
  return hold ? `Pas de remplacement : ${hold.reason}` : null;
}

/** The incumbent stayed: the plan ends there, and the person is out of plans for one season. */
function keep(ctx: RuntimeCtx, plan: ProbationPlan, report: HireReport): HireReport {
  const league = ctx.world.company.league!;
  plan.outcome = 'kept_no_better';
  const entry = league.entries[plan.agentId];
  if (entry && entry.status === 'probation') entry.status = 'active';
  league.hires.push(report);
  speak(ctx, 'hr', report.reason, 'meeting');
  return report;
}

/** Why someone left, as read in the feed and in `leftBecause`: their numbers, then who takes over. */
function leaveReason(ctx: RuntimeCtx, plan: ProbationPlan, winner: Candidate): string {
  const R = ctx.world.company.league!.entries[plan.agentId]?.ratings[plan.skill];
  const m = METRICS[plan.skill];
  const metric = R?.metric ?? plan.baseline;
  const coach = plan.coachId ? `, coach ${nameOf(ctx, plan.coachId)} pendant ${TALENT.plan.days} jours` : '';
  return `${m.label} ${m.text(metric)} pour un objectif de ${m.text(plan.target)}, classement ${ratingText(R?.rating ?? TALENT.rating.par)}${coach}. ${winner.name} (${testText(winner.interview)} au test) reprend le poste.`;
}

/** D17, the only way out of the league: notice, position, hire, and `hireAgent` completes the departure. Same tick, one path. */
async function swap(ctx: RuntimeCtx, plan: ProbationPlan, report: HireReport, winner: Candidate, candidates: Candidate[]): Promise<AgentState | null> {
  const w = ctx.world;
  const leaver = w.company.agents.find((a) => a.id === plan.agentId);
  if (!leaver) return null;
  const reason = leaveReason(ctx, plan, winner);
  leaver.notice = { day: w.day, reason, by: officerId(w, 'hr'), kind: 'fired' };
  const position = openPosition(ctx, leaver.roleId, 'replacement', `Remplacer ${leaver.name} : ${reason}`, leaver.id, { noTask: true });
  if (!position) {
    leaver.notice = null;
    return null;
  }
  position.candidates = candidates;
  const truth = w.talentTruth!;
  const family = familyOf(w, plan.skill).flatMap((a) => truth.agents[a.id]?.talent[plan.skill] ?? []);
  const familyMean = mean(family);
  const tReplaced = truth.agents[leaver.id]?.talent[plan.skill] ?? 0;
  const hire = await hireAgent(ctx, position, winner);
  truth.swaps.push({ day: w.day, skill: plan.skill, replaced: leaver.id, hired: hire.id, tReplaced, tHired: truth.agents[hire.id]?.talent[plan.skill] ?? 0, familyMean });
  w.company.league!.hires.push(report);
  return hire;
}

/** Approval mode stops here, before any money (D17, D48): a normal task of its kind, which waits for him and carries what was decided. */
function askFounder(ctx: RuntimeCtx, plan: ProbationPlan, report: HireReport, winner: Candidate, candidates: Candidate[]): void {
  const w = ctx.world;
  const hr = officerId(w, 'hr');
  const title = `Remplacer ${nameOf(ctx, plan.agentId)} par ${winner.name}`;
  createTask(w, { kind: 'league_review', title, input: { swap: { plan: plan.agentId, season: plan.openedSeason, report, winner, candidates } }, assignee: hr, createdBy: hr, reviewer: null, workLeft: 0, priority: 1 });
}

/**
 * Everyone sits the same test, the incumbent first, and the best candidate takes the job only by beating them by
 * `margin`: the market may be worse than the person in the seat. A hold of the founder stops it before anyone sits.
 */
export async function runChallenge(ctx: RuntimeCtx, plan: ProbationPlan): Promise<HireReport> {
  const w = ctx.world;
  const leaver = w.company.agents.find((a) => a.id === plan.agentId);
  const base = { day: w.day, incumbent: plan.agentId, skill: plan.skill };
  const stop = leaver ? blocked(w, plan.agentId) : `${nameOf(ctx, plan.agentId)} a déjà quitté l'agence.`;
  if (!leaver || stop) return { ...base, hired: null, candidates: [], reason: stop ?? '' };

  const bench = benchFor(ctx, plan.skill, leaver);
  const own = await testDeliverable(bench, { ...leaver, tier: 'haiku' }, 0);
  if (!own) return keep(ctx, plan, { ...base, hired: null, candidates: [], reason: `Pas de test possible aujourd'hui, ${leaver.name} reste.` });
  const candidates = challengers(ctx, plan, leaver);
  const entries: ChallengeEntry[] = [{ id: leaver.id, name: leaver.name, isIncumbent: true, lineage: null, score: own.score, deliverable: own.deliverable }];
  for (const [i, c] of candidates.entries()) {
    const result = await sit(bench, c, i + 1);
    c.interview = result?.score ?? NO_TEST;
    c.deliverable = result?.deliverable ?? null;
    entries.push({ id: c.id, name: c.name, isIncumbent: false, lineage: c.lineage, score: c.interview, deliverable: c.deliverable ?? 'Rien à rendre' });
  }

  const winner = rankCandidates(candidates)[0];
  if (!winner || winner.interview < own.score + TALENT.challenge.margin) {
    return keep(ctx, plan, { ...base, hired: null, candidates: entries, reason: `Personne de mieux sur le marché, ${leaver.name} reste (${testText(own.score)} au test${winner ? `, ${winner.name} ${testText(winner.interview)}` : ''}).` });
  }
  const report: HireReport = { ...base, hired: winner.id, candidates: entries, reason: `${winner.name} (${testText(winner.interview)} au test) bat ${leaver.name} (${testText(own.score)}) de ${dec(winner.interview - own.score, 1)} points.` };
  if (w.scenario.founderApproval) {
    askFounder(ctx, plan, report, winner, candidates);
    return report;
  }
  if (!(await swap(ctx, plan, report, winner, candidates))) return keep(ctx, plan, { ...report, hired: null, reason: `Le poste n'a pas pu s'ouvrir, ${leaver.name} reste.` });
  return report;
}

// ───────────────────────────── What the founder signs (D48, D49) ─────────────────────────────

/** What a `league_review` task carries once a challenge is decided. Observed numbers only: it sits in `company`. */
export interface DecidedSwap { plan: AgentId; season: number; report: HireReport; winner: Candidate; candidates: Candidate[] }

export function decidedSwap(task: Task): DecidedSwap | null {
  return (task.input.swap as DecidedSwap | undefined) ?? null;
}

export function pendingSwap(w: WorldState, id: AgentId): boolean {
  return openTasks(w, (t) => t.kind === 'league_review' && decidedSwap(t)?.plan === id).length > 0;
}

const planOf = (w: WorldState, d: DecidedSwap): ProbationPlan | undefined =>
  w.company.league?.plans.find((p) => p.agentId === d.plan && p.openedSeason === d.season);

/** The sentence he signs, with what it costs. Nothing is booked before his yes. */
export function swapAsk(ctx: RuntimeCtx, d: DecidedSwap): string {
  const w = ctx.world;
  const leaver = w.company.agents.find((a) => a.id === d.plan);
  const own = d.report.candidates.find((c) => c.isIncumbent)?.score ?? 0;
  return `Remplacer ${nameOf(ctx, d.plan)} par ${d.winner.name} (${testText(d.winner.interview)} contre ${testText(own)} au test) : ${eur(leaver ? swapCost(w, leaver) : 0)}`;
}

/** His yes, days later maybe: the person may have left, the name may have gone to someone else, the cash may be gone. Null: nothing happened. */
export async function confirmSwap(ctx: RuntimeCtx, d: DecidedSwap): Promise<AgentState | null> {
  const w = ctx.world;
  const plan = planOf(w, d);
  const leaver = w.company.agents.find((a) => a.id === d.plan);
  const taken = w.company.agents.some((a) => a.name === d.winner.name) || w.company.org?.alumni.some((a) => a.name === d.winner.name);
  if (!plan || !leaver || taken || !hireBudgetOk(w, leaver)) return null;
  return swap(ctx, plan, { ...d.report, day: w.day }, d.winner, d.candidates);
}

/** His no: the person is protected for 14 days and stays, no money moved, and the plan ends here (D49). No draw. */
export function swapRefused(ctx: RuntimeCtx, task: Task): void {
  const d = decidedSwap(task);
  const w = ctx.world;
  const plan = d && planOf(w, d);
  if (!d || !plan) return;
  const name = nameOf(ctx, d.plan);
  const until = w.day + TALENT.challenge.refusalPinDays;
  addHold(w, { kind: 'pin', productId: null, agentId: d.plan, until, reason: `le fondateur a refusé de remplacer ${name} le jour ${w.day} (nouvelle demande après le jour ${until})` });
  keep(ctx, plan, { ...d.report, day: w.day, hired: null, reason: `Le fondateur garde ${name} : pas de remplacement avant le jour ${until + 1}.` });
}

/** Everyone who leaves goes through here, a firing as much as a layoff: the record stays, with why, and a leaver plays no more. */
export function closeEntry(w: WorldState, id: AgentId, why: string): void {
  const league = w.company.league;
  if (!league) return;
  const entry = league.entries[id];
  if (entry) Object.assign(entry, { status: 'gone', leftDay: w.day, leftBecause: why });
  for (const plan of league.plans) if (plan.agentId === id && plan.outcome === 'open') plan.outcome = 'failed';
}
