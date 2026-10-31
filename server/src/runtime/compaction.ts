/**
 * Bounded memory (scale §7.2): once a week the world lets go of what no decision reads any more. The rule is that a reader
 * answers the same whether a row left or not, so a row stays while someone can still reach it, past what the table of the spec
 * keeps if need be, and what readers need of the rows that leave lands on the product or the company first. Pure on the world:
 * no rng, no ids, no clock. The sim never reads the archive.
 */
import type { AdCreative, ArchiveCounters, Campaign, Deliverable, Experiment, LedgerEntry, Mission, PdfContent, Product, Task, TaskKind, TaskTotals, WorldState } from '../shared.js';
import type { ArchiveBatch, ArchiveCollection } from '../contracts.js';
import { HOLD_REF, SETUP_REF, round2 } from '../core/index.js';
import { REVIEWS } from '../sim/balance.js';
import { REVIEWS_KEPT } from '../sim/feedback.js';
import { isOpen } from './tasks.js';

export const COMPACT = {
  taskDays: 21, missionDays: 14, orderDays: 120, ledgerDays: 150, commentsDays: 14, creativeDays: 45,
  campaignDays: 100, experimentDays: 90, killedProductDays: 30, reviewsPerProduct: REVIEWS_KEPT, deliverables: 300, retiredLessons: 40, journalDays: 60,
} as const;

/** Kinds whose latest done row is read back, however old: titles, plan, authors (talent), the upsell verdict, the pick, yesterday's budget. */
const LATEST_KINDS: readonly TaskKind[] = ['write_titles', 'write_outline', 'write_pdf', 'humanize_pdf', 'write_sales_page', 'red_team', 'design_upsell', 'pick_opportunity', 'budget_review'];

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** A pick names its product in its output: it did not exist yet when the task was written. */
const productKey = (t: Task): string => str(t.input.productId) ?? str(t.output?.productId) ?? '';

/**
 * The finished rows a reader still goes back to. Past the kinds of LATEST_KINDS: the gate reads the last guide run of a version
 * (not the last Red Team, which may be a reread of the live guide), the writers still get the last « fix » after a later « go »,
 * and one send-back of a produce_ad marks a product for good (scale §7.2 names only the first).
 */
function latestRows(tasks: readonly Task[]): Set<string> {
  const last = new Map<string, string>();
  for (const t of tasks) {
    if (t.kind === 'produce_ad' && t.reviews.some((r) => r.verdict === 'changes')) last.set(`sent_back:${productKey(t)}`, t.id);
    if (t.status !== 'done' || !LATEST_KINDS.includes(t.kind)) continue;
    const key = `${t.kind}:${productKey(t)}`;
    last.set(key, t.id);
    if (t.output) last.set(`${key}:output`, t.id);
    if (t.kind !== 'red_team') continue;
    last.set(`${key}:${String(t.input.subject)}:${String(t.input.version)}:${String(t.output?.onLive === true)}`, t.id);
    if (t.output?.finalVerdict === 'fix') last.set(`${key}:fix`, t.id);
  }
  return new Set(last.values());
}

const raise = (map: Record<string, number>, key: string, day: number): void => { map[key] = Math.max(map[key] ?? 0, day); };

/** What the readers of a leaving task keep of it. Each fold is a max or a union: the row and the fold say the same, so a reader takes both. */
function foldTask(w: WorldState, t: Task, totals: TaskTotals): void {
  const c = w.company;
  const lastDone = (c.lastDone ??= {});
  const pid = str(t.input.productId);
  if (t.kind === 'publish_product' && t.status === 'done' && t.input.republish === true && t.dayDone) {
    const p = c.products.find((x) => x.id === pid);
    if (p) p.versionDay = Math.max(p.versionDay ?? 0, t.dayDone);
  }
  if (t.kind === 'scan_trends' && t.status !== 'cancelled' && t.status !== 'failed') raise(lastDone, 'scan_trends:', t.dayDone ?? t.dayCreated);
  if (t.kind === 'find_creators') raise(lastDone, `find_creators:${pid ?? ''}`, t.dayCreated);
  if (t.kind === 'write_sales_page' && t.status === 'done') raise(lastDone, `write_sales_page:${pid ?? ''}`, t.dayDone ?? 0);
  if (t.kind === 'negotiate_deal' && t.output?.cashOnly === true) {
    const creator = str(t.input.creatorId);
    if (creator && !c.cashOnlyCreators?.includes(creator)) (c.cashOnlyCreators ??= []).push(creator);
  }
  const row = (day: number) => {
    let found = totals.days.find((d) => d.day === day);
    if (!found) totals.days.push(found = { day, created: 0, done: 0, failed: 0, cancelled: 0 });
    return found;
  };
  row(t.dayCreated).created += 1;
  if (t.assignee) {
    const who = ((totals.agents ??= {})[t.assignee] ??= { done: 0, approved: 0, rejected: 0, failed: 0 });
    if (t.status === 'done' && t.dayDone != null) who.done += 1;
    if (t.status === 'failed') who.failed += 1;
    for (const r of t.reviews) if (r.verdict === 'approve') who.approved += 1; else if (r.verdict === 'reject') who.rejected += 1;
  }
  const dept = (totals.depts[t.dept] ??= { done: 0, delaySum: 0 });
  if (t.dayDone === null || t.dayDone === undefined) return;
  if (t.status === 'done') { dept.done += 1; dept.delaySum += t.dayDone - t.dayCreated; }
  if (t.status === 'failed' || t.status === 'cancelled') dept.failed = (dept.failed ?? 0) + 1;
  if (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') row(t.dayDone)[t.status] += 1;
}

/**
 * What points at a task from outside the finished ones: its row must answer, or a dependency reads as met. A mission is not on this
 * list: a chain that always has a child open joins the same one for years and would hold every row for good (D15). `foldMissionTasks`
 * gives it what it reads instead.
 */
function pinnedTasks(w: WorldState): Set<string> {
  const c = w.company;
  const pinned = latestRows(c.tasks);
  for (const t of c.tasks) if (isOpen(t)) for (const id of t.dependsOn) pinned.add(id);
  for (const a of c.agents) if (a.currentTaskId) pinned.add(a.currentTaskId);
  for (const d of c.league?.duels ?? []) if (d.status === 'ordered') for (const id of d.taskIds) pinned.add(id);
  return pinned;
}

function compactTasks(w: WorldState): Task[] {
  const c = w.company;
  const pinned = pinnedTasks(w);
  const totals = (c.taskTotals ??= { days: [], depts: {} });
  const leaving: Task[] = [];
  c.tasks = c.tasks.filter((t) => {
    if (isOpen(t) || w.day - (t.dayDone ?? t.dayCreated) < COMPACT.taskDays || pinned.has(t.id)) return true;
    leaving.push(t);
    return false;
  });
  for (const t of leaving) foldTask(w, t, totals);
  totals.days.sort((a, b) => a.day - b.day);
  return leaving;
}

/** The rows that left a mission still count: its readers add `gone` to what they find, so they answer the same, with `taskIds` bounded. */
function foldMissionTasks(w: WorldState, leavingTasks: readonly Task[]): void {
  const leaving = new Map(leavingTasks.map((t) => [t.id, t]));
  for (const m of w.company.missions) {
    const rows = m.taskIds.flatMap((id) => leaving.get(id) ?? []);
    if (!rows.length) continue;
    m.taskIds = m.taskIds.filter((id) => !leaving.has(id));
    const gone = (m.gone ??= { tasks: 0, done: 0 });
    gone.tasks += rows.length;
    gone.done += rows.filter((t) => t.status === 'done').length;
  }
}

/**
 * A closed mission stays while an open task names it: `createTask` reopens it, `rehomeMissions` keeps the task there. Gone, the
 * task would found a mission of the day and every later id would shift.
 */
function compactMissions(w: WorldState, leavingTasks: readonly Task[]): Mission[] {
  const c = w.company;
  const named = new Set(c.tasks.filter(isOpen).map((t) => t.missionId));
  const lastWork = new Map<string, number>();
  for (const t of [...c.tasks, ...leavingTasks]) if (t.missionId) lastWork.set(t.missionId, Math.max(lastWork.get(t.missionId) ?? 0, t.dayDone ?? t.dayCreated));
  const leaving: Mission[] = [];
  c.missions = c.missions.filter((m) => {
    const closed = Math.max(m.day, lastWork.get(m.id) ?? 0);
    if (m.from === 'founder' || m.status === 'open' || named.has(m.id) || w.day - closed < COMPACT.missionDays) return true;
    leaving.push(m);
    return false;
  });
  return leaving;
}

function compactOrders(w: WorldState): { orders: unknown[]; customers: unknown[] } {
  const m = w.market;
  const pinned = new Set<unknown>(m.inbox.map((x) => x.orderId));
  for (const t of w.company.tasks) if (isOpen(t)) pinned.add(t.input.orderId);
  const orders: unknown[] = [];
  m.orders = m.orders.filter((o) => {
    if (w.day - o.day < COMPACT.orderDays || pinned.has(o.id)) return true;
    orders.push(o);
    return false;
  });
  const hot = new Set<string>([...m.orders.map((o) => o.customerId), ...m.inbox.map((x) => x.customerId)]);
  const customers: unknown[] = [];
  m.customers = m.customers.filter((c) => {
    if (hot.has(c.id)) return true;
    customers.push(c);
    return false;
  });
  return { orders, customers };
}

const monthOf = (day: number): string => String(Math.ceil(day / 30)).padStart(4, '0');

/** One line per (month, type). A hold keeps its prefix, so it never reaches profit; its id has no `nextId` in it. */
function rollupOf(e: LedgerEntry, rollups: Map<string, LedgerEntry>): LedgerEntry {
  const month = monthOf(e.day);
  const hold = !!e.ref?.startsWith(HOLD_REF);
  const id = `led_roll_${month}_${e.type}${hold ? '_hold' : ''}`;
  let line = rollups.get(id);
  if (!line) rollups.set(id, line = { id, day: e.day, type: e.type, amount: 0, memo: `Cumul du mois ${Number(month)}`, ref: hold ? `${HOLD_REF}rollup:${month}` : `rollup:${month}` });
  return line;
}

/** Rollups skip capital, the setup line (`tickMarket` would book it again) and every hold not released yet. */
function compactLedger(w: WorldState): LedgerEntry[] {
  const isRollup = (e: LedgerEntry) => e.id.startsWith('led_roll_');
  const rollups = new Map(w.ledger.filter(isRollup).map((e) => [e.id, e]));
  let released = -1;
  w.ledger.forEach((e, i) => { if (e.ref?.startsWith(`${HOLD_REF}release:`)) released = i; });
  const kept: LedgerEntry[] = [];
  const leaving: LedgerEntry[] = [];
  w.ledger.forEach((e, i) => {
    if (isRollup(e)) return;
    const openHold = !!e.ref?.startsWith(HOLD_REF) && i > released;
    (w.day - e.day < COMPACT.ledgerDays || e.type === 'capital' || e.ref === SETUP_REF || openHold ? kept : leaving).push(e);
  });
  for (const e of leaving) {
    const line = rollupOf(e, rollups);
    line.amount = round2(line.amount + e.amount);
    line.day = Math.max(line.day, e.day);
  }
  w.ledger = [...kept, ...rollups.values()].sort((a, b) => a.day - b.day);
  return leaving;
}

/** Only the guide's promise stays: `pickUpsellSubject` never sells a subject that did not sell, killed guides included. */
function promiseOnly(c: PdfContent): PdfContent {
  return { ...c, introduction: [], chapters: [], bonus: { title: '', intro: '', paragraphs: [], steps: [], example: null, checklist: [], visual: null }, howTo: [] };
}

function compactProducts(w: WorldState): Product[] {
  const { products } = w.company;
  const leaving: Product[] = [];
  for (const p of products) {
    const reviews = p.stats.reviews;
    const first = reviews.length - COMPACT.reviewsPerProduct;
    if (first > 0) {
      p.stats.ratingSum ??= reviews.reduce((s, r) => s + r.rating, 0);
      p.stats.ratingCount ??= reviews.length;
      p.stats.reviews = reviews.filter((r, i) => i >= first || w.day - r.day <= REVIEWS.maxAge); // runReviews reads the last maxAge days, whatever their number
    }
    const whole = !!p.salesPage || !!p.content?.chapters.length;
    const dead = p.status === 'killed' && whole && w.day - (p.decision?.day ?? p.createdDay) >= COMPACT.killedProductDays;
    // a follow-up still on sale reads its parent: its price and what it repeats
    const child = p.upsellProductId ? products.find((x) => x.id === p.upsellProductId) : undefined;
    if (!dead || (child && child.status !== 'killed')) continue;
    leaving.push({ ...p });
    p.content = p.content && promiseOnly(p.content);
    p.salesPage = null;
  }
  return leaving;
}

/** The hook, the verdicts and the score stay: what a guide already said and what its niche was refused count for the whole run. */
function stub(c: AdCreative): void {
  c.scenes = [];
  c.caption = '';
  c.hashtags = [];
  c.cta = '';
  c.cut = null;
  delete c.search;
  c.files = { storyboard: c.files.storyboard.slice(0, 1), preview: c.files.preview };
  if (c.quality) c.quality = { ...c.quality, issues: [] };
}

/**
 * The text of a creative leaves with its product. While the product lives every ad can still run, seed a cut or
 * answer `requestCreatives`, and `mine.length >= 80` bounds them. A refusal stays whole: the retro quotes it for the whole run.
 */
function compactCreatives(w: WorldState, campaigns: readonly Campaign[]): { rows: unknown[]; dropFiles: string[] } {
  const { creatives, products } = w.company;
  const inCampaign = new Set(campaigns.flatMap((c) => c.creativeIds));
  const killed = new Set(products.filter((p) => p.status === 'killed').map((p) => p.id));
  const rows: unknown[] = [];
  const dropFiles: string[] = [];
  for (const c of creatives) {
    if (!killed.has(c.productId) || c.scenes.length === 0 || inCampaign.has(c.id) || c.review.status === 'rejected' || w.day - c.createdDay < COMPACT.creativeDays) continue;
    rows.push({ ...c });
    dropFiles.push(...c.files.storyboard.slice(1));
    stub(c);
    delete w.market.creativeImpressions[c.id];
  }
  return { rows, dropFiles };
}

/** D50: every row gets its stream key before any leaves. A stopped campaign leaves once its rows did: `adHistory` reads nothing older. */
function compactCampaigns(w: WorldState): Campaign[] {
  const c = w.company;
  c.campaigns.forEach((camp, index) => { camp.seq ??= index; });
  const lastRun = new Map<string, number>();
  for (const s of w.market.adStats) lastRun.set(s.campaignId, Math.max(lastRun.get(s.campaignId) ?? 0, s.day));
  const leaving: Campaign[] = [];
  c.campaigns = c.campaigns.filter((camp) => {
    const stopped = Math.max(camp.startDay, lastRun.get(camp.id) ?? 0);
    if (camp.status === 'active' || camp.pausedFor || w.day - stopped < COMPACT.campaignDays) return true;
    leaving.push(camp);
    return false;
  });
  for (const camp of leaving) {
    const p = c.products.find((x) => x.id === camp.productId);
    if (p) p.campaignCount = (p.campaignCount ?? 0) + 1;
  }
  return leaving;
}

/** The latest of a question stays for `alreadyAnswered`, and the latest of a guide for `priceMove`, which reads tests by title. */
function compactExperiments(w: WorldState): Experiment[] {
  const c = w.company;
  const latest = new Map<string, string>();
  for (const e of c.experiments) {
    latest.set(`${e.dimension}:${e.nicheId ?? ''}:${[...e.variants].sort().join('|')}`, e.id);
    if (e.productId) latest.set(`${e.dimension}:${e.productId}`, e.id);
  }
  const keep = new Set(latest.values());
  const leaving: Experiment[] = [];
  c.experiments = c.experiments.filter((e) => {
    if (e.status === 'running' || keep.has(e.id) || w.day - (e.endDay ?? e.day) < COMPACT.experimentDays) return true;
    leaving.push(e);
    return false;
  });
  return leaving;
}

function compactDeliverables(w: WorldState): Deliverable[] {
  const c = w.company;
  const live = new Set(c.products.filter((p) => p.status === 'live').map((p) => p.id));
  const first = c.deliverables.length - COMPACT.deliverables;
  const leaving: Deliverable[] = [];
  c.deliverables = c.deliverables.filter((d, i) => {
    if (i >= first || (d.productId && live.has(d.productId))) return true;
    leaving.push(d);
    return false;
  });
  return leaving;
}

export function compactWorld(w: WorldState): ArchiveBatch {
  const c = w.company;
  const tasks = compactTasks(w);
  const missions = compactMissions(w, tasks);
  foldMissionTasks(w, tasks);
  const { orders, customers } = compactOrders(w);
  const ledger = compactLedger(w);
  const campaigns = compactCampaigns(w);
  const creatives = compactCreatives(w, c.campaigns);
  const products = compactProducts(w);
  const experiments = compactExperiments(w);
  const deliverables = compactDeliverables(w);
  for (const s of w.market.adStats) if (w.day - s.day >= COMPACT.commentsDays && s.comments.length) s.comments = [];
  // a task still holds the lessons its agent read before starting, retired since or not
  const read = new Set(Object.values(w.memory?.minds ?? {}).flatMap((m) => m.lessonIds));
  const firstLesson = (c.retiredLessons?.length ?? 0) - COMPACT.retiredLessons;
  if (firstLesson > 0) c.retiredLessons = c.retiredLessons!.filter((l, i) => i >= firstLesson || read.has(l.id));

  const before: ArchiveCounters = c.archive ?? { throughDay: 0, tasks: 0, missions: 0, orders: 0, customers: 0, ledger: 0, creatives: 0, campaigns: 0, deliverables: 0 };
  const deliverableKinds = { ...before.deliverableKinds };
  for (const d of deliverables) deliverableKinds[d.kind] = (deliverableKinds[d.kind] ?? 0) + 1;
  c.archive = {
    throughDay: w.day, tasks: before.tasks + tasks.length, missions: before.missions + missions.length, orders: before.orders + orders.length,
    customers: before.customers + customers.length, ledger: before.ledger + ledger.length, creatives: before.creatives + creatives.rows.length,
    campaigns: before.campaigns + campaigns.length, deliverables: before.deliverables + deliverables.length, deliverableKinds,
  };
  const rows: Partial<Record<ArchiveCollection, unknown[]>> = { tasks, missions, orders, customers, ledger, creatives: creatives.rows, campaigns, products, deliverables, experiments };
  for (const key of Object.keys(rows) as ArchiveCollection[]) if (!rows[key]!.length) delete rows[key];
  return { day: w.day, rows, dropFiles: creatives.dropFiles };
}
