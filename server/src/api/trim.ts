/**
 * Pure snapshot builder (no runtime dependency, unit-tested).
 * Turns the full WorldState into the UI-safe, size-bounded CompanySnapshot.
 */
import { summarizeLedger } from '../core/index.js';
import type {
  AdCreative, AdTotals, AgentId, ArchiveCounters, Campaign, ChapterContent, CompanySnapshot, CompanyState, CreativeAdTotals, DailyAdStats, DailyKpi, DayTaskCounts, Deliverable, DeptId, DeptTaskCounts, DesignSpec, FinanceSnapshot,
  InboxMessage, MessageIntent, Mission, PdfContent, Product, PublicInboxMessage, QualityReport, TalentTruthView, Task, TaskKind, TaskStats, TaskTotals, VisualReport, WorldState,
} from '../shared.js';
import { addAdTotals } from '../sim/adTotals.js';
import { announcedOutageDays } from '../sim/outage.js';

export interface SnapshotLimits {
  doneTasks: number;          // finished tasks kept (most recent)
  openTasks: number;          // safety cap on unfinished tasks
  taskLog: number;
  deliverables: number;
  lessons: number;
  chatsPerAgent: number;
  missions: number;
  creatives: number;
  campaigns: number;          // besides the running ones
  pnl: number;                // weekly reports, latest first read
  experiments: number;
  kpis: number;
  reviewsPerProduct: number;
  inbox: number;
  threadPerMessage: number;
  adStatsDays: number;
  commentsPerStat: number;
  organicPosts: number;
  creators: number;
  partnerships: number;
  events: number;
  orders: number;
  ledger: number;
  activity: number;
  stringMax: number;          // max length of free strings inside task input/output
  light: boolean;             // products and ads without what only their files show, daily figures without their channels, no VoC or competitors
  live: boolean;              // live view: finished tasks without their payload, no playbooks
}

export const DEFAULT_LIMITS: SnapshotLimits = {
  doneTasks: 200, openTasks: 400, taskLog: 10, deliverables: 250, lessons: 150, chatsPerAgent: 30, missions: 80,
  creatives: 120, campaigns: 400, pnl: 8, experiments: 60, kpis: 400, reviewsPerProduct: 25, inbox: 80, threadPerMessage: 12, adStatsDays: 14,
  commentsPerStat: 6, organicPosts: 30, creators: 80, partnerships: 120, events: 40, orders: 100, ledger: 150, activity: 200,
  stringMax: 400, light: false, live: false,
};

/** Fallback when the default snapshot would exceed the size budget. */
export const TIGHT_LIMITS: SnapshotLimits = {
  doneTasks: 60, openTasks: 150, taskLog: 4, deliverables: 120, lessons: 60, chatsPerAgent: 12, missions: 30,
  creatives: 40, campaigns: 40, pnl: 2, experiments: 25, kpis: 120, reviewsPerProduct: 8, inbox: 40, threadPerMessage: 6, adStatsDays: 5,
  commentsPerStat: 2, organicPosts: 20, creators: 40, partnerships: 50, events: 25, orders: 60, ledger: 100, activity: 120,
  stringMax: 200, light: true, live: false,
};

/**
 * What the SSE stream carries during play, about once per second: the UI's panels read neither the text of a guide
 * or an ad nor the payload of a finished task (GET /api/state keeps the payloads, and the texts while DEFAULT_LIMITS fit).
 */
export const LIVE_LIMITS: SnapshotLimits = {
  ...TIGHT_LIMITS, activity: 60, reviewsPerProduct: 5, live: true,
  creatives: 30, campaigns: 20, pnl: 1, doneTasks: 40, deliverables: 60, lessons: 30, inbox: 30, commentsPerStat: 1, adStatsDays: 3, kpis: 60,
};
export const LIVE_TIGHT_LIMITS: SnapshotLimits = {
  ...LIVE_LIMITS, creatives: 15, campaigns: 10, doneTasks: 20, deliverables: 30, lessons: 15, inbox: 20, activity: 40,
};

export const SNAPSHOT_BUDGET_BYTES = 700_000;
/** Scale D16. ui §3.1's wall of 500 000 bytes stands behind it. */
export const LIVE_BUDGET_BYTES = 400_000;

const FINISHED: ReadonlySet<Task['status']> = new Set(['done', 'failed', 'cancelled']);

const arr = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
const lastN = <T>(v: T[] | null | undefined, n: number): T[] => {
  const a = arr(v);
  return n <= 0 ? [] : a.length > n ? a.slice(a.length - n) : a.slice();
};
const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/** Bounds arbitrary JSON-ish values (task input/output): long strings, long arrays, deep nesting. */
export function shrinkValue(value: unknown, stringMax: number, depth = 0): unknown {
  if (typeof value === 'string') return value.length > stringMax ? `${value.slice(0, stringMax)}…` : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 4) return Array.isArray(value) ? `[${value.length} éléments]` : '{…}';
  if (Array.isArray(value)) {
    const max = 20;
    const out = value.slice(0, max).map((v) => shrinkValue(v, stringMax, depth + 1));
    if (value.length > max) out.push(`… ${value.length - max} de plus`);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = shrinkValue(v, stringMax, depth + 1);
  return out;
}

/** Scalars of a task's input or output: they say what it was about, without its payload. */
function scalarsOf(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 60)) out[k] = v;
  }
  return out;
}

/** Keeps every unfinished task (capped) + the most recent finished ones, in original order. */
export function trimTasks(tasks: Task[], limits: SnapshotLimits = DEFAULT_LIMITS): Task[] {
  const all = arr(tasks);
  const openIdx: number[] = [];
  const doneIdx: number[] = [];
  all.forEach((t, i) => (FINISHED.has(t.status) ? doneIdx : openIdx).push(i));
  // Most recent finished = latest dayDone, then latest position in the array.
  doneIdx.sort((a, b) => (all[b]!.dayDone ?? all[b]!.dayCreated ?? 0) - (all[a]!.dayDone ?? all[a]!.dayCreated ?? 0) || b - a);
  const keep = new Set<number>([...openIdx.slice(-limits.openTasks), ...doneIdx.slice(0, limits.doneTasks)]);
  const out: Task[] = [];
  all.forEach((t, i) => {
    if (!keep.has(i)) return;
    const light = limits.live && FINISHED.has(t.status);
    out.push({
      ...t,
      log: lastN(t.log, limits.taskLog),
      reviews: lastN(t.reviews, light ? 1 : 6),
      input: light ? scalarsOf(t.input ?? {}) : (shrinkValue(t.input ?? {}, limits.stringMax) ?? {}) as Record<string, unknown>,
      output: t.output == null ? null : light ? scalarsOf(t.output) : (shrinkValue(t.output, limits.stringMax) as Record<string, unknown>),
    });
  });
  return out;
}

function trimChapter(ch: ChapterContent | null | undefined, full: boolean): ChapterContent {
  const c = ch ?? ({} as Partial<ChapterContent>);
  return {
    title: c.title ?? '',
    intro: c.intro ?? '',
    paragraphs: full ? arr(c.paragraphs) : [],
    steps: full ? arr(c.steps) : [],
    example: full ? c.example ?? null : null,
    checklist: full ? arr(c.checklist) : [],
    visual: c.visual ?? null,
  };
}

/** Content light enough for the UI: titles + intros, full text only for the first chapter (light limits: only what the card reads, its next step). */
export function trimContent(content: PdfContent | null | undefined, light = false): PdfContent | null {
  if (!content) return null;
  return {
    title: light ? '' : content.title ?? '',
    subtitle: light ? '' : content.subtitle ?? '',
    audience: light ? '' : content.audience ?? '',
    promise: light ? '' : content.promise ?? '',
    introduction: light ? [] : arr(content.introduction).slice(0, 3),
    chapters: light ? [] : arr(content.chapters).map((ch, i) => trimChapter(ch, i === 0)),
    bonus: trimChapter(light ? null : content.bonus, false),
    nextStep: content.nextStep ?? { title: '', text: '', upsellProductId: null },
    wordCount: content.wordCount ?? 0,
  };
}

/** The public report: `effort` is the designer's talent read out and `explored` counts it (A21). Only the scores leave. */
function publicVisual(visual: VisualReport): VisualReport {
  const { effort: _effort, explored: _explored, ...shown } = visual;
  return shown as VisualReport;
}

/** A stopped guide under light limits: what the catalogue shows of it. Its text and scores weigh more than a live guide's figures. */
function stubProduct({ brief: _brief, pagePrint: _pagePrint, visual: _visual, ...p }: Product): Product {
  return {
    ...p, subtitle: '', audience: '', problem: '', content: null, design: null, salesPage: null, quality: null, salesQuality: null, priceHistory: [],
    files: { pdf: p.files?.pdf ?? null, cover: p.files?.cover ?? null, salesPage: p.files?.salesPage ?? null }, stats: { ...p.stats, reviews: [] },
  };
}

/** A guide on sale under light limits: what its card reads. A guide now stays on sale for months, and with 33 of them these fields weighed 140 KB. */
function cardProduct({ brief: _brief, pagePrint: _pagePrint, ...p }: Product): Product {
  return {
    ...p, salesQuality: null,
    design: p.design && ({ palette: p.design.palette } as DesignSpec),
    quality: p.quality && ({ overall: p.quality.overall, issues: p.quality.issues, ...(p.quality.blocking ? { blocking: p.quality.blocking } : {}) } as QualityReport),
  };
}

export function trimProduct(p: Product, limits: SnapshotLimits = DEFAULT_LIMITS): Product {
  const stats = p.stats ?? { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 };
  // What compaction leaves the company to read (scale §7.2): no panel reads it, and at its caps it weighs 9 KB a product.
  const { hooks: _hooks, feedback: _feedback, artExplored: _artExplored, paidRead: _paidRead, ...kept } = p;
  const trimmed: Product = {
    ...kept,
    ...(p.visual ? { visual: publicVisual(p.visual) } : {}),
    content: trimContent(p.content, limits.light),
    salesPage: limits.light ? null : p.salesPage,
    stats: { ...stats, reviews: lastN(stats.reviews, limits.reviewsPerProduct) },
    priceHistory: lastN(p.priceHistory, limits.live ? 14 : 60),
  };
  if (!limits.light) return trimmed;
  return p.status === 'paused' || p.status === 'killed' ? stubProduct(trimmed) : cardProduct(trimmed);
}

/** Killed guides that light limits still show. */
const SHOWN_KILLED = 12;

/** Light limits drop the killed guides past the latest ones (scale §7.2): the catalogue only grows. */
function shownProducts(products: Product[], limits: SnapshotLimits): Product[] {
  const all = arr(products);
  if (!limits.light) return all;
  const killed = all.filter((p) => p.status === 'killed');
  const shown = new Set(killed.slice(-SHOWN_KILLED));
  return all.filter((p) => p.status !== 'killed' || shown.has(p));
}

/** A light ad: its figures, its preview and what its cut measured (video §13), without the script, the beats or the detail of its score. */
function lightCreative({ search: _search, ...c }: AdCreative): AdCreative {
  return {
    ...c, caption: '', hashtags: [], ...(c.cut ? { cut: { ...c.cut, beats: [] } } : {}),
    quality: c.quality ? { overall: c.quality.overall } as AdCreative['quality'] : c.quality,
    scenes: arr(c.scenes).map((s) => ({ visual: '', onScreenText: '', voiceover: '', durationSec: s.durationSec })),
    files: { storyboard: (c.files?.storyboard ?? []).slice(0, 1), preview: c.files?.preview ?? null },
  };
}

function trimCreatives(creatives: AdCreative[], keepIds: Set<string>, limits: SnapshotLimits): AdCreative[] {
  const all = arr(creatives);
  const start = Math.max(0, all.length - limits.creatives);
  const kept = all.filter((c, i) => i >= start || keepIds.has(c.id));
  return limits.light ? kept.map(lightCreative) : kept;
}

/** The running campaigns and the latest others: paused ones pile up for ever. */
function trimCampaigns(campaigns: Campaign[], limit: number): Campaign[] {
  const start = Math.max(0, campaigns.length - limit);
  return campaigns.filter((k, i) => i >= start || k.status === 'active');
}

/** The latest missions, the open ones and every mission of the founder; their progress is counted on the whole task list. */
function trimMissions(missions: Mission[], tasks: Task[], limit: number): Mission[] {
  const all = arr(missions);
  const start = Math.max(0, all.length - limit);
  const done = new Set(arr(tasks).filter((t) => t.status === 'done').map((t) => t.id));
  return all
    .filter((m, i) => i >= start || m.status === 'open' || m.from === 'founder')
    .map((m) => ({ ...m, doneTasks: (m.gone?.done ?? 0) + arr(m.taskIds).filter((id) => done.has(id)).length, totalTasks: (m.gone?.tasks ?? 0) + arr(m.taskIds).length }));
}

const isAdFrame = (d: Deliverable) => d.kind === 'ad_storyboard' || d.kind === 'ad_preview';

/** Light views stop here too: the gallery reads the whole run elsewhere, and guides, covers and reports only grow. */
const LIGHT_WORKS = 120;
/** The live view counts everything together: ui §3.1. */
const LIVE_DELIVERABLES = 120;

/** Ad frames, by far the most numerous, are cut to the latest ones. They never push out guides, covers, pages or reports, which have their own bound in a light view. */
function trimDeliverables(deliverables: Deliverable[], limits: SnapshotLimits): Deliverable[] {
  const all = arr(deliverables);
  const frames = all.filter(isAdFrame).length;
  const firstAd = Math.max(0, frames - limits.deliverables);
  const firstWork = limits.light ? Math.max(0, all.length - frames - LIGHT_WORKS) : 0;
  let ads = 0;
  let works = 0;
  const kept = all.filter((d) => (isAdFrame(d) ? ads++ >= firstAd : works++ >= firstWork));
  return limits.live ? kept.slice(-LIVE_DELIVERABLES) : kept;
}

/** Light rows: the channels of a day are read on the server (ui §3.2), and they are three quarters of a row. */
function trimKpis(kpis: DailyKpi[], limits: SnapshotLimits): DailyKpi[] {
  const rows = lastN(kpis, limits.kpis);
  return limits.light ? rows.map(({ channels: _channels, ...k }) => k) : rows;
}

export function trimCompany(c: CompanyState, limits: SnapshotLimits = DEFAULT_LIMITS): CompanyState {
  const campaigns = arr(c.campaigns);
  const liveCreativeIds = new Set(campaigns.filter((k) => (limits.light ? k.status === 'active' : k.status !== 'ended')).flatMap((k) => arr(k.creativeIds)));
  const chats: CompanyState['chats'] = {};
  for (const [agentId, msgs] of Object.entries(c.chats ?? {})) chats[agentId] = lastN(msgs, limits.chatsPerAgent);
  const experiments = arr(c.experiments);
  const expStart = Math.max(0, experiments.length - limits.experiments);
  const research = c.research ?? { trends: [], voc: {}, competitors: {}, shortlist: [] };
  return {
    name: c.name,
    agents: arr(c.agents),
    departments: arr(c.departments),
    tasks: trimTasks(c.tasks, limits),
    missions: trimMissions(c.missions, c.tasks, limits.missions),
    products: shownProducts(c.products, limits).map((p) => trimProduct(p, limits)),
    creatives: trimCreatives(c.creatives, liveCreativeIds, limits),
    campaigns: trimCampaigns(campaigns, limits.campaigns),
    deliverables: trimDeliverables(c.deliverables, limits),
    research: { trends: arr(research.trends), voc: limits.light ? {} : research.voc ?? {}, competitors: limits.light ? {} : research.competitors ?? {}, shortlist: arr(research.shortlist) },
    lessons: lastN(c.lessons, limits.lessons),
    experiments: experiments.filter((e, i) => i >= expStart || e.status === 'running'),
    bandits: c.bandits ?? {},
    playbooks: limits.live ? {} : c.playbooks ?? {}, // ui §3.1: the 15 agents' 24 rules, 49 KB a second to one closed panel
    kpis: trimKpis(c.kpis, limits),
    chats,
    pendingApprovals: arr(c.pendingApprovals),
    budget: c.budget ?? null,
    pnl: lastN(c.pnl, limits.pnl),
  };
}

/** Most recent `limit` messages, but unanswered ones are never dropped in favour of closed ones. */
function keptMessages(inbox: InboxMessage[], limits: SnapshotLimits): InboxMessage[] {
  const all = arr(inbox);
  const keep = new Set<number>();
  for (let i = all.length - 1; i >= 0 && keep.size < limits.inbox; i--) {
    const s = all[i]!.status;
    if (s === 'open' || s === 'escalated') keep.add(i);
  }
  for (let i = all.length - 1; i >= 0 && keep.size < limits.inbox; i--) keep.add(i);
  return all.filter((_, i) => keep.has(i));
}

/** What the company can see of its inbox: the true intent of a message is never part of it. */
export function trimInbox(inbox: InboxMessage[], limits: SnapshotLimits = DEFAULT_LIMITS): PublicInboxMessage[] {
  return keptMessages(inbox, limits).map(({ intent: _truth, ...m }) => ({ ...m, thread: lastN(m.thread, limits.threadPerMessage) }));
}

export function trimAdStats(stats: DailyAdStats[], day: number, limits: SnapshotLimits = DEFAULT_LIMITS): DailyAdStats[] {
  const minDay = day - limits.adStatsDays + 1;
  return arr(stats)
    .filter((s) => s.day >= minDay)
    .map((s) => ({ ...s, comments: arr(s.comments).slice(0, limits.commentsPerStat) }));
}

/** Figures of the whole run: what the market retired plus the rows it holds, for the creatives a snapshot keeps. */
export function adTotalsOf(market: WorldState['market'] | undefined, creatives: AdCreative[]): AdTotals {
  const wanted = new Set(creatives.map((c) => c.id));
  const totals: Record<string, CreativeAdTotals> = {};
  for (const id of wanted) {
    const retired = market?.retiredAdTotals?.[id];
    if (retired) totals[id] = { ...retired };
  }
  const days = new Map<number, AdTotals['days'][number]>();
  for (const s of arr(market?.adStats)) {
    let row = days.get(s.day);
    if (!row) days.set(s.day, row = { day: s.day, spend: 0, revenue: 0 });
    row.spend = r2(row.spend + s.spend);
    row.revenue = r2(row.revenue + s.revenue);
    if (wanted.has(s.creativeId)) addAdTotals(totals, s);
  }
  return { days: [...days.values()].sort((a, b) => a.day - b.day), creatives: totals };
}

/** The whole run: what the world still holds plus what compaction counted on its way out. */
function deliverableCountsOf(deliverables: Deliverable[], archived: ArchiveCounters['deliverableKinds']): CompanySnapshot['deliverableCounts'] {
  const counts: NonNullable<CompanySnapshot['deliverableCounts']> = { ...archived };
  for (const d of arr(deliverables)) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
  return counts;
}

/** Finance from the ledger only, used when the sim's financeSnapshot is unavailable or throws: the same summary. */
export function estimateFinance(world: WorldState): FinanceSnapshot {
  const { capital: _capital, ...finance } = summarizeLedger(arr(world.ledger), world.day ?? 0, announcedOutageDays(world));
  return finance;
}

const fr2 = (n: number) => n.toFixed(2).replace('.', ',');

/** True talent of everyone who ever held a skill: « plafond 0,71, élève de Sarah ». Only `godModeOf` reads this field. */
function talentViews(world: WorldState): Record<AgentId, TalentTruthView> {
  const entries = world.company?.league?.entries ?? {};
  const out: Record<AgentId, TalentTruthView> = {};
  for (const [id, a] of Object.entries(world.talentTruth?.agents ?? {})) {
    const skill = entries[id]?.primary;
    const truth = skill ? a.talent[skill] : undefined;
    if (!skill || truth === undefined) continue;
    const teacher = a.lineage ? entries[a.lineage]?.name ?? a.lineage : null;
    out[id] = { truth, note: [`plafond ${fr2(a.ceiling[skill] ?? truth)}`, ...(teacher ? [`élève de ${teacher}`] : [])].join(', ') };
  }
  return out;
}

/** Hidden truth served to god mode only. `intents` covers the messages of the same snapshot. */
export function godModeOf(world: WorldState, limits: SnapshotLimits = DEFAULT_LIMITS): NonNullable<CompanySnapshot['godMode']> {
  const intents: Record<string, MessageIntent> = {};
  for (const m of keptMessages(world.market?.inbox ?? [], limits)) intents[m.id] = m.intent;
  return {
    ...(world.talentTruth ? { talent: talentViews(world) } : {}),
    niches: arr(world.market?.niches).map((n) => ({
      id: n.id, name: n.name, demand: n.demand, wtp: n.wtp, competition: n.competition,
      tiktokAffinity: n.tiktokAffinity, hookAffinity: n.hookAffinity,
    })),
    intents,
  };
}

const DEPT_HISTORY_DAYS = 14;
const KIND_WINDOW_DAYS = 7;

function dayRow(rows: Map<number, DayTaskCounts>, day: number): DayTaskCounts {
  let row = rows.get(day);
  if (!row) rows.set(day, row = { day, created: 0, done: 0, failed: 0, cancelled: 0 });
  return row;
}

const oldestFirst = (rows: Map<number, DayTaskCounts>): DayTaskCounts[] => [...rows.values()].sort((a, b) => a.day - b.day);

/** Counts of the WHOLE task list: the task list of a snapshot is trimmed, these numbers never are. `totals` holds the rows compaction took away. */
export function taskStatsOf(tasks: Task[] | null | undefined, day: number, totals?: TaskTotals): TaskStats {
  const days = new Map<number, DayTaskCounts>();
  const depts = new Map<DeptId, { rows: Map<number, DayTaskCounts>; kinds7d: Partial<Record<TaskKind, number>>; done: number; failed: number; delay: number }>();
  const recent = day - DEPT_HISTORY_DAYS;
  const kindsFrom = day - KIND_WINDOW_DAYS;
  for (const t of arr(tasks)) {
    let d = depts.get(t.dept);
    if (!d) depts.set(t.dept, d = { rows: new Map(), kinds7d: {}, done: 0, failed: 0, delay: 0 });
    dayRow(days, t.dayCreated).created += 1;
    if (t.dayCreated > recent) dayRow(d.rows, t.dayCreated).created += 1;
    if ((t.dayDone ?? t.dayCreated) > kindsFrom) d.kinds7d[t.kind] = (d.kinds7d[t.kind] ?? 0) + 1;
    if (t.dayDone === null || t.dayDone === undefined) continue;
    if (t.status === 'done') { d.done += 1; d.delay += t.dayDone - t.dayCreated; }
    if (t.status === 'failed' || t.status === 'cancelled') d.failed += 1;
    if (t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled') continue;
    dayRow(days, t.dayDone)[t.status] += 1;
    if (t.dayDone > recent) dayRow(d.rows, t.dayDone)[t.status] += 1;
  }
  for (const row of totals?.days ?? []) {
    const merged = dayRow(days, row.day);
    merged.created += row.created; merged.done += row.done; merged.failed += row.failed; merged.cancelled += row.cancelled;
  }
  for (const [id, gone] of Object.entries(totals?.depts ?? {}) as [DeptId, NonNullable<TaskTotals['depts'][DeptId]>][]) {
    let d = depts.get(id);
    if (!d) depts.set(id, d = { rows: new Map(), kinds7d: {}, done: 0, failed: 0, delay: 0 });
    d.done += gone.done; d.delay += gone.delaySum; d.failed += gone.failed ?? 0;
  }
  const out: Partial<Record<DeptId, DeptTaskCounts>> = {};
  for (const [id, d] of depts) out[id] = { days: oldestFirst(d.rows), kinds7d: d.kinds7d, done: d.done, failed: d.failed, avgDelayDays: d.done ? r2(d.delay / d.done) : null };
  return { days: oldestFirst(days), depts: out };
}

/** Builds the UI-safe snapshot. `market.niches` (hidden truth) never leaves the server unless `god`. */
export function buildSnapshot(world: WorldState, finance: FinanceSnapshot, god = false, limits: SnapshotLimits = DEFAULT_LIMITS): CompanySnapshot {
  const m = world.market;
  const company = trimCompany(world.company, limits);
  const snap: CompanySnapshot = {
    runId: world.runId,
    scenario: world.scenario,
    day: world.day,
    tick: world.tick,
    phase: world.phase,
    status: world.status,
    mind: world.mind,
    company,
    market: {
      // still typed InboxMessage for the UI code that reads it: the field itself is gone from the payload
      inbox: trimInbox(m?.inbox ?? [], limits) as InboxMessage[],
      adStats: trimAdStats(m?.adStats ?? [], world.day, limits),
      organicPosts: lastN(m?.organicPosts, limits.organicPosts),
      creators: lastN(m?.creators, limits.creators),
      partnerships: lastN(m?.partnerships, limits.partnerships),
      events: lastN(m?.events, limits.events),
      orders: lastN(m?.orders, limits.orders),
      adAccount: m?.adAccount ?? { strikes: 0, banned: false, bannedUntilDay: 0 },
      customersCount: arr(m?.customers).length + (world.company?.archive?.customers ?? 0),
    },
    finance,
    ledger: lastN(world.ledger, limits.ledger),
    activity: lastN(world.activity, limits.activity),
    taskStats: taskStatsOf(world.company?.tasks, world.day, world.company?.taskTotals),
    adTotals: adTotalsOf(m, company.creatives),
    deliverableCounts: deliverableCountsOf(world.company?.deliverables, world.company?.archive?.deliverableKinds),
    goalReachedDay: world.company?.goalReachedDay ?? arr(m?.events).find((e) => e.kind === 'goal_reached')?.day ?? null,
    ...(world.company?.archive ? { archive: world.company.archive } : {}),
  };
  if (god) snap.godMode = godModeOf(world, limits);
  return snap;
}

/**
 * Serialises the snapshot (+ optional extra top-level fields), retrying with tighter limits
 * when it would exceed the size budget.
 */
export function serializeSnapshot(
  world: WorldState, finance: FinanceSnapshot, god = false, extra: Record<string, unknown> = {}, budget = SNAPSHOT_BUDGET_BYTES,
): string {
  let json = '';
  for (const limits of [DEFAULT_LIMITS, TIGHT_LIMITS, LIVE_LIMITS]) {
    json = JSON.stringify({ ...buildSnapshot(world, finance, god, limits), ...extra });
    if (json.length <= budget) break;
  }
  return json;
}

/** The light snapshot of the live stream, tighter when a big company would not fit. */
export function serializeLiveSnapshot(world: WorldState, finance: FinanceSnapshot, god = false, extra: Record<string, unknown> = {}): string {
  let json = '';
  for (const limits of [LIVE_LIMITS, LIVE_TIGHT_LIMITS]) {
    json = JSON.stringify({ ...buildSnapshot(world, finance, god, limits), ...extra });
    if (json.length <= LIVE_BUDGET_BYTES) break;
  }
  return json;
}
