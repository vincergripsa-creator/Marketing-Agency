/**
 * The founder's digest and the decision log (scale §3): what the company did while the founder was away, a loss stated as a loss. Money
 * comes from the ledger alone, through the weekly rollups: a window of a year reads no raw row, and compaction moves no number.
 * Pure on the world: no rng, no clock. The session log comes from outside the world, which keeps replay pure.
 */
import type { SessionRecord } from '../api/persist.js';
import { isHold, nextId, summarizeLedger } from '../core/index.js';
import { CHANNELS, channelOf } from '../shared.js';
import { listSize } from '../sim/audience.js';
import type { DecisionRecord, FounderDigest, LedgerEntry, Order, ProductPnl, RoleId, Task, WeekRollup, WorldEvent, WorldState } from '../shared.js';
import { channelPnls, productPnls } from './accounting.js';
import { STOP_LOSS_ROAS, versionSince } from './acquisition.js';
import { COMPACT } from './compaction.js';
import type { RuntimeCtx } from './ctx.js';
import { writeNote } from './ctx.js';
import { activeHolds } from './holds.js';
import { closedWindow, isUpsellProduct } from './metrics.js';
import { ROLES } from './org/catalog.js';
import { officerId } from './org/officers.js';
import { growthOn, STAGE_LABELS, STAGES } from './stages.js';
import { clip, dec, eur, idNum, pad3, round2, short, sum, uniq } from './util.js';

const MAX_DECISIONS = 500;
const TOP_DECISIONS = 12;
const MAX_LINES = 8;
const MAX_WHY = 160;
/** A stop-loss came late once a dead campaign burnt this many times the spend that should have stopped it. */
const LATE_STOP = 2;
/** Sleeping cash, as the CFO counts it: past the reserve and this many days of ads. It is a mistake above this share of the cash. */
const IDLE_ADS_DAYS = 14;
const IDLE_SHARE = 0.25;
/** Under this a process restart, not a machine off. */
const OFF_MIN_MS = 60_000;
const INCIDENT_EVENTS: readonly WorldEvent['kind'][] = ['platform_outage', 'ad_account_banned', 'channel_account_banned', 'bankrupt'];

// ───────────────────────────── the decision log ─────────────────────────────

/** A hand-built world has no growth: the record comes back unsaved, and no id is spent on it. */
export function logDecision(w: WorldState, d: Omit<DecisionRecord, 'id' | 'day'>): DecisionRecord {
  const growth = w.company.growth;
  if (!growth) return { id: `dec_${w.day}`, day: w.day, ...d };
  const row: DecisionRecord = { id: nextId(w, 'dec'), day: w.day, ...d };
  growth.decisions.push(row);
  if (growth.decisions.length > MAX_DECISIONS) growth.decisions.splice(0, growth.decisions.length - MAX_DECISIONS);
  return row;
}

// ───────────────────────────── the books ─────────────────────────────

const BOOK_KEYS = ['revenue', 'refunds', 'adSpend', 'fees', 'creators', 'payroll', 'other', 'profit'] as const;
type Books = Pick<WeekRollup, (typeof BOOK_KEYS)[number]>;

/** A stretch of the ledger, in the words of `summarizeLedger`: the digest and the Finance tab cannot disagree. */
function booksOf(rows: readonly LedgerEntry[], day: number): Books {
  const s = summarizeLedger(rows, day);
  const creators = round2(0 - sum(rows.filter((e) => e.type === 'creator_payout' && !isHold(e)).map((e) => e.amount)));
  return { revenue: s.revenue, refunds: s.refunds, adSpend: s.adSpend, fees: s.fees, creators, payroll: s.payroll, other: round2(s.compute + s.otherCosts - creators), profit: s.profit };
}

/** Every row a day has seen. Month lines of compaction sit on days only rollups still read, so past those days this is exact. */
const ledgerCash = (w: WorldState, day: number): number => round2(sum(w.ledger.filter((e) => e.day <= day).map((e) => e.amount)));

const sizeOfList = (w: WorldState): number => (w.market.audience ? listSize(w.market.audience) : 0);

/** One week of the ledger and of the company. In both arms (D54): the bench reads the control's weeks too. */
export function weekRollup(w: WorldState, fromDay: number, toDay: number): WeekRollup {
  const inWeek = ({ day }: { day: number }): boolean => day >= fromDay && day <= toDay;
  const orders = w.market.orders.filter(inWeek);
  const bySource: WeekRollup['bySource'] = {};
  for (const o of orders) {
    const row = (bySource[o.source] ??= { n: 0, revenue: 0 });
    row.n += 1;
    row.revenue = round2(row.revenue + o.price);
  }
  const ads = w.market.adStats.filter(inWeek);
  const impressions = sum(ads.map((s) => s.impressions));
  const books = booksOf(w.ledger.filter(inWeek), toDay);
  const mains = w.company.products.filter((p) => p.status === 'live' && p.kind !== 'kit' && !isUpsellProduct(w, p.id));
  return {
    week: Math.max(1, Math.ceil(toDay / 7)), fromDay, toDay, ...books, cashEnd: ledgerCash(w, toDay),
    sales: orders.length, bySource,
    roas: books.adSpend > 0 ? round2(books.revenue / books.adSpend) : null,
    ctr: impressions > 0 ? Math.round((sum(ads.map((s) => s.clicks)) / impressions) * 1e4) / 1e4 : null,
    mains: mains.length, niches: uniq(mains.map((p) => p.nicheId)).length, listSize: sizeOfList(w),
    ltvFactor: w.company.growth?.ltvFactor ?? 1, stage: w.company.growth?.stage ?? 'survie', agents: w.company.agents.length,
    tasksDone: w.company.tasks.filter((t) => t.status === 'done' && t.dayDone !== null && inWeek({ day: t.dayDone })).length,
  };
}

// ───────────────────────────── the window ─────────────────────────────

/** Oldest first, each week once: a tick replayed after a failure may have rolled its week twice. */
function weeksOf(w: WorldState): WeekRollup[] {
  return [...new Map((w.company.growth?.weeks ?? []).map((r) => [r.week, r])).values()].sort((a, b) => a.toDay - b.toDay);
}

/** First day a table still holds whole: compaction keeps its last `days`. */
const keptFrom = (w: WorldState, days: number): number => Math.max(1, (w.company.archive?.throughDay ?? 0) - days + 1);

/**
 * Past the raw ledger only whole weeks answer. A window that ends there takes all of its week: nothing the founder missed is cut, no
 * number is guessed, and the digest prints the window it really covers.
 */
function windowStart(w: WorldState, from: number): number {
  const raw = keptFrom(w, COMPACT.ledgerDays);
  return from >= raw ? from : weeksOf(w).find((r) => r.toDay >= from)?.fromDay ?? raw;
}

function windowEnd(w: WorldState, to: number): number {
  return to >= keptFrom(w, COMPACT.ledgerDays) ? to : weeksOf(w).find((r) => r.toDay >= to)?.toDay ?? to;
}

/** The whole weeks of a window, and the raw rows of the days around them. A week whose Sunday was skipped reads raw until the next evening rolls it. */
interface Span { weeks: WeekRollup[]; rows: LedgerEntry[]; orders: Order[] }

function spanOf(w: WorldState, from: number, to: number): Span {
  const weeks = weeksOf(w).filter((r) => r.fromDay >= from && r.toDay <= to);
  const rolled = new Set(weeks.flatMap((r) => Array.from({ length: r.toDay - r.fromDay + 1 }, (_, i) => r.fromDay + i)));
  const raw = Math.max(from, keptFrom(w, COMPACT.ledgerDays));
  const loose = ({ day }: { day: number }): boolean => day >= raw && day <= to && !rolled.has(day);
  return { weeks, rows: w.ledger.filter(loose), orders: w.market.orders.filter(loose) };
}

function booksOver(span: Span, to: number): Books {
  const parts = [...span.weeks, booksOf(span.rows, to)];
  return Object.fromEntries(BOOK_KEYS.map((key) => [key, round2(sum(parts.map((p) => p[key])))])) as unknown as Books;
}

const cashAt = (w: WorldState, day: number): number => weeksOf(w).find((r) => r.toDay === day)?.cashEnd ?? ledgerCash(w, day);

function moneyOf(w: WorldState, span: Span, from: number, to: number): FounderDigest['money'] {
  const b = booksOver(span, to);
  const days = to - from + 1;
  const paidIn = sum(w.ledger.filter((e) => e.type === 'capital' && e.day === from).map((e) => e.amount)); // the capital is where a run starts from, not a gain
  return {
    revenue: b.revenue, refunds: b.refunds, adSpend: b.adSpend, costs: round2(b.fees + b.creators + b.payroll + b.other), profit: b.profit,
    cashStart: round2(cashAt(w, from - 1) + paidIn), cashEnd: cashAt(w, to),
    previousProfit: from - days >= 1 ? booksOver(spanOf(w, windowStart(w, from - days), from - 1), from - 1).profit : null,
  };
}

// ───────────────────────────── what happened ─────────────────────────────

/** Each move from its decision, for its exact day: cash running out moves a stage on any morning. The two ends come from what outlives that log. */
function stageOf(w: WorldState, from: number, to: number, logged: readonly DecisionRecord[]): FounderDigest['stage'] {
  const weeks = weeksOf(w);
  const start = weeks.findLast((r) => r.toDay < from)?.stage ?? 'survie';
  const end = to >= w.day ? w.company.growth?.stage : weeks.findLast((r) => r.toDay <= to)?.stage;
  const changes = logged.flatMap((d) => {
    const stage = d.kind === 'stage' ? STAGES.find((s) => d.text.endsWith(STAGE_LABELS[s])) : undefined;
    return stage ? [{ day: d.day, to: stage }] : [];
  });
  return { from: start, to: end ?? changes.at(-1)?.to ?? start, changes };
}

type Stopped = FounderDigest['products']['stopped'][number] & { id: string };

/** Kills and pauses from the products, which outlive every log; a harvest stays on sale and is known by its decision alone. */
function stoppedOf(w: WorldState, from: number, to: number, logged: readonly DecisionRecord[]): Stopped[] {
  const out = new Map<string, Stopped>();
  for (const p of w.company.products) {
    const d = p.decision;
    if (d && d.day >= from && d.day <= to && p.status === d.status) out.set(p.id, { id: p.id, title: p.title, why: clip(d.reason, MAX_WHY) });
  }
  for (const d of logged) {
    const p = w.company.products.find((x) => x.id === d.productId);
    if (p && (d.kind === 'kill' || d.kind === 'harvest')) out.set(p.id, { id: p.id, title: p.title, why: clip(d.why, MAX_WHY), ...(d.kind === 'harvest' ? { harvest: true } : {}) });
  }
  return [...out.values()];
}

function productsOf(w: WorldState, from: number, to: number, logged: readonly DecisionRecord[], stopped: readonly Stopped[], pnl: readonly ProductPnl[]): FounderDigest['products'] {
  const inWindow = (day: number | null | undefined): boolean => day != null && day >= from && day <= to;
  const reworked = new Set(logged.filter((d) => d.kind === 'rework').map((d) => d.productId));
  const moved = pnl.filter((r) => r.sales > 0 || r.adSpend > 0); // sorted by profit
  const money = (r: ProductPnl | undefined) => (r ? { title: r.title, profit: r.profit } : null);
  return {
    launched: w.company.products.filter((p) => inWindow(p.launchedDay)).map((p) => p.title),
    stopped: stopped.map(({ id: _id, ...s }) => s),
    reworked: w.company.products.filter((p) => reworked.has(p.id) || (p.version > 1 && inWindow(versionSince(w, p)))).map((p) => p.title),
    best: money(moved[0]), worst: moved.length > 1 ? money(moved.at(-1)) : null,
  };
}

function audienceOf(w: WorldState, span: Span, from: number, to: number): FounderDigest['audience'] {
  const weeks = weeksOf(w);
  const size = to >= w.day ? sizeOfList(w) : weeks.findLast((r) => r.toDay <= to)?.listSize ?? 0;
  const start = weeks.findLast((r) => r.toDay < from)?.listSize ?? 0;
  const unsubscribed = sum((w.market.audience?.sent ?? []).filter((b) => b.day >= from && b.day <= to).map((b) => b.unsubscribed));
  const revenue = sum(span.weeks.map((r) => r.bySource.email?.revenue ?? 0)) + sum(span.orders.filter((o) => o.source === 'email').map((o) => o.price));
  return { size, added: Math.max(0, size - start + unsubscribed), unsubscribed, revenue: round2(revenue) };
}

/**
 * Hires and departures from the people themselves, not `org.decisions` as D37 says: that log keeps 200 rows shared with refusals,
 * and one real week away is a simulated year (scale D2). The same two events write `hiredDay` and `leftDay`, kept for the whole run.
 */
function peopleOf(w: WorldState, from: number, to: number): FounderDigest['people'] {
  const alumni = w.company.org?.alumni ?? [];
  const label = (a: { name: string; roleId: RoleId }): string => `${a.name} (${ROLES[a.roleId].title})`;
  const headOn = (day: number): number => w.company.agents.filter((a) => a.hiredDay <= day).length + alumni.filter((a) => a.hiredDay <= day && a.leftDay > day).length;
  return {
    hired: [...w.company.agents, ...alumni].filter((a) => !a.founder && a.hiredDay >= from && a.hiredDay <= to).map(label),
    left: alumni.filter((a) => a.leftDay >= from && a.leftDay <= to).map((a) => `${label(a)} : ${a.reason}`),
    headFrom: headOn(Math.max(1, from - 1)), headTo: headOn(to),
  };
}

function channelsOf(w: WorldState, from: number, to: number, logged: readonly DecisionRecord[]): FounderDigest['channels'] {
  const moved = (suffix: string): string[] => logged.filter((d) => d.kind === 'channel' && d.text.endsWith(suffix)).map((d) => d.text.slice(0, -suffix.length));
  const banned = w.market.events.filter((e) => e.kind === 'channel_account_banned' && e.day >= from && e.day <= to).map((e) => e.title);
  const top = channelPnls(w, from, to).flatMap((c) => (c.roas === null ? [] : [{ id: c.channel, roas: c.roas }])).sort((a, b) => b.roas - a.roas)[0];
  return { opened: moved(' ouvert'), closed: [...moved(' mis en pause'), ...banned], best: top ? { id: top.id, name: CHANNELS[top.id].label, reconciledRoas: top.roas } : null };
}

// ───────────────────────────── what went wrong ─────────────────────────────

/** A campaign that stopped in the window, its stop-loss spend long passed. Ad stats keep 90 days, which is as far as this can tell. */
function lateStops(w: WorldState, from: number, to: number): string[] {
  const life = new Map<string, { spend: number; revenue: number; last: number }>();
  for (const s of w.market.adStats) {
    const run = life.get(s.campaignId) ?? { spend: 0, revenue: 0, last: 0 };
    life.set(s.campaignId, { spend: run.spend + s.spend, revenue: run.revenue + s.revenue, last: Math.max(run.last, s.day) });
  }
  return w.company.campaigns.flatMap((c) => {
    const run = life.get(c.id);
    const { stopLossSpend } = CHANNELS[channelOf(c)];
    if (!run || c.status === 'active' || c.pausedFor || run.last < from || run.last > to || run.spend < LATE_STOP * stopLossSpend) return [];
    const roas = run.revenue / run.spend;
    return roas < STOP_LOSS_ROAS ? [`Stop-loss tardif sur « ${short(c.name, 60)} » : ${eur(run.spend)} dépensés pour un seuil à ${eur(stopLossSpend)}, ROAS ${dec(roas)}`] : [];
  });
}

function mistakesOf(w: WorldState, span: Span, from: number, to: number, money: FounderDigest['money'], stopped: readonly Stopped[], pnl: readonly ProductPnl[]): string[] {
  const out: string[] = [];
  const red = span.weeks.filter((r) => r.profit < 0);
  if (span.weeks.length > 1 && red.length) {
    const worst = red.reduce((a, b) => (b.profit < a.profit ? b : a));
    out.push(`${red.length} semaine(s) en perte sur ${span.weeks.length}, la pire à ${eur(worst.profit)} (semaine ${worst.week})`);
  }
  const rows = new Map(pnl.map((r) => [r.productId, r]));
  for (const s of stopped) {
    const lost = rows.get(s.id)?.profit ?? 0;
    if (lost < 0) out.push(`« ${short(s.title, 60)} » ${s.harvest ? 'en récolte' : 'arrêté'} sans gagnant : perte de ${eur(-lost)}`);
  }
  const raw = Math.max(from, keptFrom(w, COMPACT.ledgerDays));
  const chargebacks = w.ledger.filter((e) => e.type === 'chargeback' && e.amount < 0 && e.day >= raw && e.day <= to);
  if (chargebacks.length) out.push(`${chargebacks.length} rétrofacturation(s) : perte de ${eur(-sum(chargebacks.map((e) => e.amount)))}`);
  out.push(...lateStops(w, from, to));
  const allocation = w.company.growth?.allocation;
  const idle = allocation ? allocation.free - IDLE_ADS_DAYS * (money.adSpend / (to - from + 1)) : 0;
  const selling = w.company.products.some((p) => p.status === 'live'); // before the first guide, nothing could have spent it
  if (selling && idle > 0 && idle >= IDLE_SHARE * money.cashEnd) out.push(`Trésorerie qui dort : ${eur(idle)} au-delà de la réserve et de ${IDLE_ADS_DAYS} jours de pub`);
  return out;
}

function lasted(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const parts = [days ? `${days} j` : '', minutes >= 60 && Math.floor(minutes / 60) % 24 ? `${Math.floor(minutes / 60) % 24} h` : '', !days && minutes % 60 ? `${minutes % 60} min` : ''];
  return parts.filter(Boolean).join(' ');
}

/** What the world cannot know: how each stay of the agency ended, and how long nothing ran before the next one. */
function stayIncidents(session: readonly SessionRecord[], from: number, to: number): string[] {
  return session.slice(0, -1).flatMap((stay, i) => {
    const next = session[i + 1]!;
    if (next.day < from || next.day > to) return [];
    const off = Date.parse(next.startAt) - Date.parse(stay.stopAt ?? next.startAt);
    if (!stay.clean) return [`Jour ${next.day} : arrêt brutal de l'agence${off >= OFF_MIN_MS ? `, ${lasted(off)} à l'arrêt` : ''}`];
    return off >= OFF_MIN_MS ? [`Jour ${next.day} : agence à l'arrêt ${lasted(off)}, son temps s'est arrêté avec elle`] : []; // the machine off, or the same machine on another run: the log does not tell them apart
  });
}

function incidentsOf(w: WorldState, from: number, to: number, logged: readonly DecisionRecord[], session: readonly SessionRecord[]): string[] {
  return [
    ...logged.filter((d) => d.kind === 'incident').map((d) => `Jour ${d.day} : ${d.text} (${d.why})`),
    ...w.market.events.filter((e) => INCIDENT_EVENTS.includes(e.kind) && e.day >= from && e.day <= to).map((e) => `Jour ${e.day} : ${e.title}`),
    ...stayIncidents(session, from, to),
  ];
}

// ───────────────────────────── what comes next ─────────────────────────────

/** What the founder's silence costs in approval mode: nothing goes out while an ask waits, the fixed costs do. */
function waitCost(w: WorldState, asks: readonly Task[]): string[] {
  if (!asks.length) return [];
  const since = Math.min(...asks.map((t) => t.dayCreated));
  const lost = round2(cashAt(w, Math.max(1, since - 1)) - ledgerCash(w, w.day)); // day 1 holds the capital: nothing before it to read
  return lost > 0 ? [`${asks.length} demande(s) t'attendent depuis le jour ${since} : la trésorerie a perdu ${eur(lost)} depuis, et rien ne repart sans ta réponse.`] : [];
}

function waitingOf(w: WorldState): string[] {
  const asks = w.company.tasks.filter((t) => t.status === 'awaiting_founder');
  return [
    ...waitCost(w, asks),
    ...[...asks].sort((a, b) => a.priority - b.priority).map((t) => `À valider : ${t.title}`),
    ...w.company.missions.filter((m) => m.from === 'founder' && m.status === 'open').map((m) => `Ta demande du jour ${m.day} : ${short(m.text, 100)}`),
    ...activeHolds(w).filter((h) => h.until === null).map((h) => `Ton ordre du jour ${h.day} tient toujours : ${h.reason}`),
  ];
}

/** What channel tests really cost over the last closed week, from the ad rows of the campaigns paid as tests. */
function testSpend(w: WorldState): number {
  const { fromDay, toDay } = closedWindow(w, 7);
  const tests = new Set(w.company.campaigns.filter((c) => c.test).map((c) => c.id));
  return round2(sum(w.market.adStats.filter((s) => s.day >= fromDay && s.day <= toDay && tests.has(s.campaignId)).map((s) => s.spend)));
}

function nextOf(w: WorldState): string[] {
  const growth = w.company.growth;
  const a = growth?.allocation;
  const tested = testSpend(w);
  return [
    ...(a ? [a.note] : []),
    ...(tested > 0 ? [`Tests de canaux : ${eur(tested)} dépensés sur 7 jours.`] : []),
    ...(growth?.portfolio?.lines ?? []).filter((l) => l.verdict === 'test' || l.verdict === 'double_down').map((l) => `« ${short(l.title, 60)} » : ${l.reason}`),
    ...w.company.experiments.filter((e) => e.status === 'running').map((e) => `Test en cours : ${short(e.hypothesis, 100)}`),
    ...(w.company.org?.positions ?? []).filter((p) => p.status === 'open').map((p) => `Poste ouvert : ${ROLES[p.roleId].title}`),
  ].slice(0, MAX_LINES);
}

function headlineOf(days: number, m: FounderDigest['money']): string {
  const result = m.profit < 0 ? `Perte de ${eur(-m.profit)}` : m.profit > 0 ? `Profit de ${eur(m.profit)}` : 'Ni profit ni perte';
  const versus = m.previousProfit === null ? '' : `, contre ${eur(m.previousProfit)} la période d'avant`;
  return `${result} en ${days} jour${days > 1 ? 's' : ''}${versus} : ${eur(m.revenue)} de ventes, ${eur(m.refunds)} remboursés, ${eur(m.adSpend)} de pub, ${eur(m.costs)} de frais.`;
}

/** A budget line moves money and earns none: it outranks nothing, and no amount beside it reads as a gain. */
const weightOf = (d: DecisionRecord): number => (d.kind === 'budget' ? 0 : Math.abs(d.impactEur ?? 0));

function withoutMoved(d: DecisionRecord): DecisionRecord {
  if (d.kind !== 'budget') return d;
  const { impactEur: _moved, ...line } = d;
  return line;
}

/**
 * `highlights` stays empty here: the chronicle is an api read, and the routes of P12.1 fill it with `digestPeopleOf`.
 * @param session runs/<id>/session.log.json, for what only the outside of the world knows
 */
export function buildDigest(w: WorldState, fromDay: number, toDay: number, session: readonly SessionRecord[] = []): FounderDigest {
  const to = windowEnd(w, Math.min(toDay, w.day));
  const from = windowStart(w, Math.min(Math.max(1, fromDay), to));
  const span = spanOf(w, from, to);
  const money = moneyOf(w, span, from, to);
  const logged = (w.company.growth?.decisions ?? []).filter((d) => d.day >= from && d.day <= to);
  const pnl = productPnls(w, Math.max(from, keptFrom(w, COMPACT.orderDays)), to).products;
  const stopped = stoppedOf(w, from, to, logged);
  return {
    fromDay: from, toDay: to,
    headline: headlineOf(to - from + 1, money),
    money,
    stage: stageOf(w, from, to, logged),
    products: productsOf(w, from, to, logged, stopped, pnl),
    audience: audienceOf(w, span, from, to),
    people: peopleOf(w, from, to),
    channels: channelsOf(w, from, to, logged),
    highlights: [],
    decisions: logged.filter((d) => d.kind !== 'incident')
      .sort((a, b) => weightOf(b) - weightOf(a) || b.day - a.day || idNum(b.id) - idNum(a.id)).slice(0, TOP_DECISIONS).map(withoutMoved),
    mistakes: mistakesOf(w, span, from, to, money, stopped, pnl),
    incidents: incidentsOf(w, from, to, logged, session),
    waiting: waitingOf(w),
    next: nextOf(w),
  };
}

// ───────────────────────────── the weekly note ─────────────────────────────

function noteBody(title: string, week: WeekRollup, d: FounderDigest): string {
  const section = (name: string, lines: readonly string[]): string[] => (lines.length ? [`## ${name}`, ...lines.map((s) => `- ${s}`), ''] : []);
  const { products: p, people, money: m } = d;
  return [
    `# ${title}`, '',
    d.headline, '',
    `Trésorerie ${eur(m.cashStart)} → ${eur(m.cashEnd)} · Palier ${STAGE_LABELS[d.stage.to]} · ${week.sales} vente(s) · ROAS ${week.roas === null ? '—' : dec(week.roas)} · Effectif ${people.headFrom} → ${people.headTo}`, '',
    ...section('Décisions', d.decisions.map((x) => `${x.text} : ${x.why}`)),
    ...section('Erreurs', d.mistakes),
    ...section('Incidents', d.incidents),
    ...section('Produits', [
      ...p.launched.map((t) => `Lancé : ${t}`), ...p.stopped.map((s) => `${s.harvest ? 'En récolte' : 'Arrêté'} : ${s.title}, ${s.why}`), ...p.reworked.map((t) => `Repris : ${t}`),
      ...(p.best ? [`Meilleur : ${p.best.title}, ${eur(p.best.profit)}`] : []), ...(p.worst ? [`Pire : ${p.worst.title}, ${eur(p.worst.profit)}`] : []),
    ]),
    ...section('Équipe', [...people.hired.map((s) => `Arrivée : ${s}`), ...people.left.map((s) => `Départ : ${s}`)]),
    ...section('À décider', d.waiting),
    ...section('La suite', d.next),
    'Liens : [[Croissance]] · [[Playbook Finance]] · [[Budget et garde-fous]]',
  ].join('\n');
}

/** Every Sunday, brain/journal/semaine-NNN.md. Agents read it and it spends ids: the control arm stays the old company. */
export async function weeklyNote(ctx: RuntimeCtx, week: WeekRollup): Promise<void> {
  const w = ctx.world;
  if (!growthOn(w)) return;
  const title = `Semaine ${week.week}, jours ${week.fromDay} à ${week.toDay}`;
  await writeNote(ctx, officerId(w, 'cfo'), { path: `journal/semaine-${pad3(week.week)}.md`, title, tags: ['journal', 'semaine'], body: noteBody(title, week, buildDigest(w, week.fromDay, week.toDay)) });
}
