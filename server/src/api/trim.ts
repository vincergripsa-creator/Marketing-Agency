/**
 * Pure snapshot builder (no sim/runtime dependency, unit-tested).
 * Turns the full WorldState into the UI-safe, size-bounded CompanySnapshot.
 */
import type {
  AdCreative, ChapterContent, CompanySnapshot, CompanyState, DailyAdStats, FinanceSnapshot, InboxMessage, LedgerType,
  Mission, PdfContent, Product, Task, WorldState,
} from '../shared.js';
import { estimateCashProfit } from './persist.js';

export interface SnapshotLimits {
  doneTasks: number;          // finished tasks kept (most recent)
  openTasks: number;          // safety cap on unfinished tasks
  taskLog: number;
  deliverables: number;
  lessons: number;
  chatsPerAgent: number;
  missions: number;
  creatives: number;
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
  vocKnowledge: boolean;      // keep the raw VoC knowledge arrays
  stringMax: number;          // max length of free strings inside task input/output
}

export const DEFAULT_LIMITS: SnapshotLimits = {
  doneTasks: 200, openTasks: 400, taskLog: 10, deliverables: 250, lessons: 150, chatsPerAgent: 30, missions: 80,
  creatives: 120, experiments: 60, kpis: 400, reviewsPerProduct: 25, inbox: 80, threadPerMessage: 12, adStatsDays: 14,
  commentsPerStat: 6, organicPosts: 30, creators: 80, partnerships: 120, events: 40, orders: 100, ledger: 150, activity: 200,
  vocKnowledge: true, stringMax: 400,
};

/** Fallback when the default snapshot would exceed the size budget. */
export const TIGHT_LIMITS: SnapshotLimits = {
  doneTasks: 80, openTasks: 150, taskLog: 4, deliverables: 120, lessons: 60, chatsPerAgent: 12, missions: 30,
  creatives: 60, experiments: 25, kpis: 120, reviewsPerProduct: 8, inbox: 50, threadPerMessage: 6, adStatsDays: 7,
  commentsPerStat: 2, organicPosts: 20, creators: 40, partnerships: 50, events: 25, orders: 60, ledger: 100, activity: 120,
  vocKnowledge: false, stringMax: 200,
};

export const SNAPSHOT_BUDGET_BYTES = 700_000;

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
    out.push({
      ...t,
      log: lastN(t.log, limits.taskLog),
      reviews: lastN(t.reviews, 6),
      input: (shrinkValue(t.input ?? {}, limits.stringMax) ?? {}) as Record<string, unknown>,
      output: t.output == null ? null : (shrinkValue(t.output, limits.stringMax) as Record<string, unknown>),
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

/** Content light enough for the UI: titles + intros, full text only for the first chapter. */
export function trimContent(content: PdfContent | null | undefined): PdfContent | null {
  if (!content) return null;
  return {
    title: content.title ?? '',
    subtitle: content.subtitle ?? '',
    audience: content.audience ?? '',
    promise: content.promise ?? '',
    introduction: arr(content.introduction).slice(0, 3),
    chapters: arr(content.chapters).map((ch, i) => trimChapter(ch, i === 0)),
    bonus: trimChapter(content.bonus, false),
    nextStep: content.nextStep ?? { title: '', text: '', upsellProductId: null },
    wordCount: content.wordCount ?? 0,
  };
}

export function trimProduct(p: Product, limits: SnapshotLimits = DEFAULT_LIMITS): Product {
  const stats = p.stats ?? { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 };
  return {
    ...p,
    content: trimContent(p.content),
    stats: { ...stats, reviews: lastN(stats.reviews, limits.reviewsPerProduct) },
    priceHistory: lastN(p.priceHistory, 60),
  };
}

function trimCreatives(creatives: AdCreative[], keepIds: Set<string>, limit: number): AdCreative[] {
  const all = arr(creatives);
  const start = Math.max(0, all.length - limit);
  return all.filter((c, i) => i >= start || keepIds.has(c.id));
}

function trimMissions(missions: Mission[], limit: number): Mission[] {
  const all = arr(missions);
  const start = Math.max(0, all.length - limit);
  return all.filter((m, i) => i >= start || m.status === 'open');
}

export function trimCompany(c: CompanyState, limits: SnapshotLimits = DEFAULT_LIMITS): CompanyState {
  const campaigns = arr(c.campaigns);
  const liveCreativeIds = new Set(campaigns.filter((k) => k.status !== 'ended').flatMap((k) => arr(k.creativeIds)));
  const chats: CompanyState['chats'] = {};
  for (const [agentId, msgs] of Object.entries(c.chats ?? {})) chats[agentId] = lastN(msgs, limits.chatsPerAgent);
  const experiments = arr(c.experiments);
  const expStart = Math.max(0, experiments.length - limits.experiments);
  const research = c.research ?? { trends: [], voc: {}, competitors: {}, shortlist: [] };
  const voc: CompanyState['research']['voc'] = {};
  for (const [nicheId, v] of Object.entries(research.voc ?? {})) {
    voc[nicheId] = limits.vocKnowledge || !v ? v : { ...v, knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] } };
  }
  return {
    name: c.name,
    agents: arr(c.agents),
    departments: arr(c.departments),
    tasks: trimTasks(c.tasks, limits),
    missions: trimMissions(c.missions, limits.missions),
    products: arr(c.products).map((p) => trimProduct(p, limits)),
    creatives: trimCreatives(c.creatives, liveCreativeIds, limits.creatives),
    campaigns,
    deliverables: lastN(c.deliverables, limits.deliverables),
    research: { trends: arr(research.trends), voc, competitors: research.competitors ?? {}, shortlist: arr(research.shortlist) },
    lessons: lastN(c.lessons, limits.lessons),
    experiments: experiments.filter((e, i) => i >= expStart || e.status === 'running'),
    bandits: c.bandits ?? {},
    playbooks: c.playbooks ?? {},
    kpis: lastN(c.kpis, limits.kpis),
    chats,
    pendingApprovals: arr(c.pendingApprovals),
  };
}

/** Most recent `limit` messages, but unanswered ones are never dropped in favour of closed ones. */
export function trimInbox(inbox: InboxMessage[], limits: SnapshotLimits = DEFAULT_LIMITS): InboxMessage[] {
  const all = arr(inbox);
  const keep = new Set<number>();
  for (let i = all.length - 1; i >= 0 && keep.size < limits.inbox; i--) {
    const s = all[i]!.status;
    if (s === 'open' || s === 'escalated') keep.add(i);
  }
  for (let i = all.length - 1; i >= 0 && keep.size < limits.inbox; i--) keep.add(i);
  return all
    .filter((_, i) => keep.has(i))
    .map((m) => ({ ...m, thread: lastN(m.thread, limits.threadPerMessage) }));
}

export function trimAdStats(stats: DailyAdStats[], day: number, limits: SnapshotLimits = DEFAULT_LIMITS): DailyAdStats[] {
  const minDay = day - limits.adStatsDays + 1;
  return arr(stats)
    .filter((s) => s.day >= minDay)
    .map((s) => ({ ...s, comments: arr(s.comments).slice(0, limits.commentsPerStat) }));
}

const OTHER_COSTS: ReadonlySet<LedgerType> = new Set<LedgerType>(['tool_subscription', 'creator_payout', 'scam_loss', 'discount']);

/** Finance computed from the ledger only — used when the sim's financeSnapshot is unavailable or throws. */
export function estimateFinance(world: WorldState): FinanceSnapshot {
  const ledger = arr(world.ledger);
  const { cash, profit } = estimateCashProfit(world);
  const sum = (types: LedgerType[]) => r2(ledger.filter((e) => types.includes(e.type)).reduce((s, e) => s + Math.abs(e.amount || 0), 0));
  const kpis = lastN(world.company?.kpis, 7);
  const profit7d = r2(kpis.reduce((s, k) => s + (k.profit || 0), 0));
  const burn7d = kpis.length ? r2(Math.max(0, -profit7d / kpis.length)) : 0;
  const ads7 = arr(world.market?.adStats).filter((s) => s.day > world.day - 7);
  const spend7 = ads7.reduce((s, a) => s + (a.spend || 0), 0);
  const rev7 = ads7.reduce((s, a) => s + (a.revenue || 0), 0);
  return {
    cash,
    revenue: sum(['revenue']),
    refunds: sum(['refund', 'chargeback']),
    adSpend: sum(['ad_spend']),
    fees: sum(['payment_fee', 'platform_fee']),
    compute: sum(['compute']),
    otherCosts: r2(ledger.filter((e) => OTHER_COSTS.has(e.type)).reduce((s, e) => s + Math.abs(e.amount || 0), 0)),
    profit,
    profit7d,
    burn7d,
    runwayDays: burn7d > 0 ? Math.max(0, Math.floor(cash / burn7d)) : null,
    roas7d: spend7 > 0 ? r2(rev7 / spend7) : 0,
    bankrupt: world.status === 'bankrupt' || cash < 0,
  };
}

export function godModeOf(world: WorldState): NonNullable<CompanySnapshot['godMode']> {
  return {
    niches: arr(world.market?.niches).map((n) => ({
      id: n.id, name: n.name, demand: n.demand, wtp: n.wtp, competition: n.competition,
      tiktokAffinity: n.tiktokAffinity, hookAffinity: n.hookAffinity,
    })),
  };
}

/** Builds the UI-safe snapshot. `market.niches` (hidden truth) never leaves the server unless `god`. */
export function buildSnapshot(world: WorldState, finance: FinanceSnapshot, god = false, limits: SnapshotLimits = DEFAULT_LIMITS): CompanySnapshot {
  const m = world.market;
  const snap: CompanySnapshot = {
    runId: world.runId,
    scenario: world.scenario,
    day: world.day,
    tick: world.tick,
    phase: world.phase,
    status: world.status,
    mind: world.mind,
    company: trimCompany(world.company, limits),
    market: {
      inbox: trimInbox(m?.inbox ?? [], limits),
      adStats: trimAdStats(m?.adStats ?? [], world.day, limits),
      organicPosts: lastN(m?.organicPosts, limits.organicPosts),
      creators: lastN(m?.creators, limits.creators),
      partnerships: lastN(m?.partnerships, limits.partnerships),
      events: lastN(m?.events, limits.events),
      orders: lastN(m?.orders, limits.orders),
      adAccount: m?.adAccount ?? { strikes: 0, banned: false, bannedUntilDay: 0 },
      customersCount: arr(m?.customers).length,
    },
    finance,
    ledger: lastN(world.ledger, limits.ledger),
    activity: lastN(world.activity, limits.activity),
  };
  if (god) snap.godMode = godModeOf(world);
  return snap;
}

/**
 * Serialises the snapshot (+ optional extra top-level fields), retrying with tighter limits
 * when it would exceed the size budget.
 */
export function serializeSnapshot(
  world: WorldState, finance: FinanceSnapshot, god = false, extra: Record<string, unknown> = {}, budget = SNAPSHOT_BUDGET_BYTES,
): string {
  const json = JSON.stringify({ ...buildSnapshot(world, finance, god, DEFAULT_LIMITS), ...extra });
  if (json.length <= budget) return json;
  return JSON.stringify({ ...buildSnapshot(world, finance, god, TIGHT_LIMITS), ...extra });
}
