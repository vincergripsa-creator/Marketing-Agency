/**
 * What the pixel world and the tabs read (ui §2, §3.2). Pure reads of the world: nothing here draws, books or writes, and every
 * view stands on a world where a pillar never mounted. `sceneOf` travels with each snapshot, the others on one GET each:
 * `company.org`, `company.league` and `company.channels` stay out of every snapshot (D34). Truth sits behind `god` (ui §3.4):
 * `talentViews` is its only reader, and only god mode calls it.
 */
import { isHold } from '../core/index.js';
import { lastClosedDay } from '../sim/finance.js';
import { accountBanned, accountOf } from '../sim/channels.js';
import { buildDigest } from '../runtime/digest.js';
import { unlockProgress } from '../runtime/channels.js';
import { ROLES } from '../runtime/org/catalog.js';
import { ORG, payOfTier } from '../runtime/org/constants.js';
import { payOf } from '../runtime/org/payroll.js';
import { STAGE_LABELS, STAGES } from '../runtime/stages.js';
import { METRICS, ratingText, testSeesTalent } from '../runtime/talent/challenge.js';
import { TALENT } from '../runtime/talent/constants.js';
import { primaryOf, SKILLS } from '../runtime/talent/skills.js';
import { dec, round2, short, sum } from '../runtime/util.js';
import type {
  AdCreative, AgentId, AgentState, Alumnus, AlumnusView, BoardRow, ChannelChip, ChannelDayKpi, ChannelId, ChannelRow, ChannelsDetail, ChannelState, ChronicleEntry, ChronicleKind,
  CreativeVideo, DailyAdStats, DailyKpi, Deliverable, Duel, DuelChip, DuelSide, DuelView, FounderDigest, HeadRow, HiringReqView, LeagueDetail, LeagueEntry, LeagueRow,
  OrgDept, OrgDetail, PersonChip, Position, PodiumView, SceneView, SeasonReport, SeasonRow, Skill, SkillRating, StageView, TalentTruthView, WorldState,
} from '../shared.js';
import { CHANNEL_IDS, CHANNELS, channelOf, filmOf } from '../shared.js';
import { cardOf, chronicleOf, duelWinner, peopleIndex, type PeopleIndex } from './chronicle.js';

/** Under 7 days a hire is on trial, and the board shows them as new. */
const NEW_DAYS = 7;
const WINDOW_DAYS = 30;
const SCENE_RECENT = 24;
const SCENE_DUELS = 6;
const SCENE_BOARD = 5;
const SCENE_NAMES = 200;
const SCENE_CUPS = 8;
/** The scene goes out every second: a long reason is read on its tab. */
const SCENE_WHY = 140;
const LOAD_DAYS = 7;
const SPARK_POINTS = 12;
const FORM_POINTS = 5;
const WEEK_FORM_DELTA = 10;
const VIEW_PLANS = 30;
const VIEW_DUELS = 30;
const VIEW_REQS = 30;
const VIEW_DECISIONS = 30;
const VIEW_TRANSFERS = 100;
const VIEW_ALUMNI = 100;
const DAILY_DAYS = 30;
const CHANNEL_WEEK = 7;
const MAX_HIGHLIGHTS = 12;
const HIGHLIGHTS_PER_KIND = 3;
const GALLERY_PAGE = 60;

/** ui §3.2. `layoff` and `stage_down` are not in its table: a loss weighs what the matching gain weighs. */
const HIGHLIGHT_WEIGHT: Partial<Record<ChronicleKind, number>> = {
  stage_up: 100, stage_down: 100, season_end: 90, dept_open: 80, channel_open: 70, fire: 60, layoff: 60, hire: 50, channel_close: 50, promote: 40, duel_end: 10,
};

const SKILL_LABELS: Record<Skill, string> = {
  copy: 'Textes de pub', video: 'Montage vidéo', longform: 'Guides', polish: 'Relecture', page: 'Pages de vente', design: 'Design', buying: 'Achat média', research: 'Recherche', support: 'Support',
};

const STAGED_NUMBERS: ReadonlySet<ChronicleKind> = new Set<ChronicleKind>(['duel_end', 'season_end', 'stage_up', 'stage_down']);
const TRANSFERS: ReadonlySet<ChronicleKind> = new Set<ChronicleKind>(['hire', 'fire', 'layoff', 'promote']);
const TEAM_MOVES: ReadonlySet<ChronicleKind> = new Set<ChronicleKind>(['hire', 'fire', 'layoff', 'promote', 'req_open', 'dept_open', 'dept_close']);

const ratio = (a: number, b: number): number | null => (b > 0 ? round2(a / b) : null);
const rate = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 1e4) / 1e4 : 0);
const perHead =(n: number, heads: number): number => round2(n / Math.max(1, heads));

// ───────────────────────────── the last 30 closed days ─────────────────────────────

interface Books { fromDay: number; toDay: number; revenue: number; payroll: number; recruiting: number; profit: number; oneOff: Map<string, number>; oneOff30: Map<string, number> }

/**
 * Money from the ledger alone, holds and capital out. `oneOff` keeps each recruiting line by its ref, `hire:<id>`, `leave:<id>`, as far
 * as compaction left it: a life's cost, for those who left. `oneOff30` holds the same lines inside the window, which compaction never reaches.
 */
function books30(w: WorldState): Books {
  const toDay = lastClosedDay(w);
  const fromDay = Math.max(1, toDay - WINDOW_DAYS + 1);
  const out: Books = { fromDay, toDay, revenue: 0, payroll: 0, recruiting: 0, profit: 0, oneOff: new Map(), oneOff30: new Map() };
  for (const e of w.ledger ?? []) {
    if (e.type === 'recruiting' && e.ref) out.oneOff.set(e.ref, (out.oneOff.get(e.ref) ?? 0) - e.amount);
    if (e.day < fromDay || e.day > toDay || e.type === 'capital' || isHold(e)) continue;
    out.profit += e.amount;
    if (e.type === 'revenue') out.revenue += e.amount;
    if (e.type === 'salary') out.payroll -= e.amount;
    if (e.type === 'recruiting' && !e.ref?.startsWith('training:')) { // formation continue is nobody's pay: Compétition shows it, season by season
      out.recruiting -= e.amount;
      if (e.ref) out.oneOff30.set(e.ref, (out.oneOff30.get(e.ref) ?? 0) - e.amount);
    }
  }
  return { ...out, revenue: round2(out.revenue), payroll: round2(out.payroll), recruiting: round2(out.recruiting), profit: round2(out.profit) };
}

const daysIn = (books: Books, from: number, to = books.toDay): number => Math.max(0, Math.min(to, books.toDay) - Math.max(books.fromDay, from) + 1);

/**
 * The ledger books one salary line a day, so a person's share is read back. Hires keep their contract (org §5): what the window paid
 * past theirs and past those who left went to the founders, who take less in survival and nothing while bankrupt.
 */
function founderShareOf(w: WorldState, books: Books): number {
  const agents = w.company.agents ?? [];
  const contract = (group: readonly AgentState[]): number => sum(group.map((a) => payOf(a) * daysIn(books, a.hiredDay)));
  const leavers = (w.company.org?.alumni ?? []).filter((a) => !a.founder).map((a) => payOf({ tier: ROLES[a.roleId].tier, level: a.level } as AgentState) * daysIn(books, a.hiredDay, a.leftDay - 1));
  const founders = contract(agents.filter((a) => a.founder));
  return founders > 0 ? Math.min(1, Math.max(0, (books.payroll - contract(agents.filter((a) => !a.founder)) - sum(leavers)) / founders)) : 1;
}

function stageView(w: WorldState): StageView {
  const g = w.company.growth;
  const id = g?.stage ?? 'survie';
  return { level: STAGES.indexOf(id), total: 4, id, name: STAGE_LABELS[id], sinceDay: g?.stageSinceDay ?? 0, headcount: w.company.agents?.length ?? 0, gate: g?.gate ?? null };
}

/** D46. A founder never was on trial. */
function contractOf(w: WorldState, a: AgentState): PersonChip['contract'] {
  if (a.notice) return 'notice';
  if (w.company.league?.plans.some((p) => p.agentId === a.id && p.outcome === 'open')) return 'probation';
  return !a.founder && w.day - a.hiredDay < NEW_DAYS ? 'trial' : 'active';
}

// ───────────────────────────── the league, as observed ─────────────────────────────

interface Rated { entry: LeagueEntry; skill: Skill; rating: SkillRating }

const byRating = (a: Rated, b: Rated): number => b.rating.rating - a.rating.rating || a.entry.agentId.localeCompare(b.entry.agentId);

/** Whoever still works here and carries a rating on their primary skill, best first. The rest is « hors ligue ». */
function ratedPeople(w: WorldState): Rated[] {
  return Object.values(w.company.league?.entries ?? {}).flatMap((entry): Rated[] => {
    const rating = entry.primary ? entry.ratings[entry.primary] : undefined;
    return entry.primary && rating && entry.status !== 'gone' ? [{ entry, skill: entry.primary, rating }] : [];
  }).sort(byRating);
}

function delta7dOf(w: WorldState, r: SkillRating): number {
  const past = r.history.findLast((p) => p.day <= w.day - NEW_DAYS) ?? r.history[0];
  return past ? Math.round(r.rating - past.rating) : 0;
}

/** Top 3 of a close, its employee first, each person once. A row keeps no `rd`, so the rest follows the rating: a closed season cannot reorder later. */
function seasonTop(report: SeasonReport): SeasonRow[] {
  const first = report.employee?.agentId;
  const rows = (Object.values(report.tables) as SeasonRow[][]).flat().filter((r) => r.status !== 'gone' || r.agentId === first);
  const ranked = rows.sort((a, b) => Number(b.agentId === first) - Number(a.agentId === first) || b.rating - a.rating || a.agentId.localeCompare(b.agentId));
  return ranked.filter((r, i) => ranked.findIndex((x) => x.agentId === r.agentId) === i).slice(0, 3);
}

function podiumOf(w: WorldState, people: PeopleIndex): PodiumView | null {
  const seasons = w.company.league?.seasons ?? [];
  const last = seasons.at(-1);
  if (!last) return null;
  const here = new Set(w.company.agents.map((a) => a.id));
  return {
    season: last.season,
    places: seasonTop(last).map((r, i) => ({ place: (i + 1) as 1 | 2 | 3, person: cardOf(people, r.agentId), score: Math.round(r.rating - TALENT.rating.par), gone: !here.has(r.agentId) })),
    cups: seasons.flatMap((s) => (s.employee ? [{ season: s.season, name: s.employee.name }] : [])).slice(-SCENE_CUPS),
  };
}

function peopleChips(w: WorldState, rated: readonly Rated[]): Record<AgentId, PersonChip> {
  const last = w.company.league?.seasons.at(-1);
  const top = new Set(last ? seasonTop(last).map((r) => r.agentId) : []);
  const badgeOf = (id: AgentId, contract: PersonChip['contract']): PersonChip['badge'] =>
    contract === 'probation' ? 'probation' : last?.employee?.agentId === id ? 'champion' : top.has(id) ? 'podium' : contract === 'trial' ? 'new' : null;
  const out: Record<AgentId, PersonChip> = {};
  for (const a of w.company.agents ?? []) {
    const own = rated.find((r) => r.entry.agentId === a.id);
    if (!own) continue;
    const family = rated.filter((r) => r.skill === own.skill);
    const contract = contractOf(w, a);
    out[a.id] = { rating: Math.round(own.rating.rating), rank: family.indexOf(own) + 1, of: family.length, delta7d: delta7dOf(w, own.rating), contract, badge: badgeOf(a.id, contract) };
  }
  return out;
}

function duelChip(d: Duel, people: PeopleIndex): DuelChip {
  const [a, b] = d.agents;
  return { id: d.id, a, b, label: `${cardOf(people, a).name} contre ${cardOf(people, b).name}`, endDay: d.endDay ?? d.startDay + TALENT.duel.everyDays };
}

// ───────────────────────────── channels ─────────────────────────────

/** What the company can buy on today. Account open is not enough: YouTube and Search share Google's, and a channel in pause keeps it. */
function channelState(w: WorldState, ch: ChannelId): ChannelState {
  if (w.market && accountBanned(w.market, ch, w.day)) return 'banned';
  const book = w.company.channels;
  if (!book) return ch === 'tiktok' ? 'open' : 'closed';
  if (book.open.includes(ch)) return 'open';
  return (book.requested[ch] ?? Number.POSITIVE_INFINITY) <= w.day ? 'verifying' : 'closed';
}

function budgetsOf(w: WorldState): Map<ChannelId, number> {
  const out = new Map<ChannelId, number>();
  for (const c of w.company.campaigns ?? []) if (c.status === 'active') out.set(channelOf(c), (out.get(channelOf(c)) ?? 0) + c.dailyBudget);
  return out;
}

function chipOf(w: WorldState, ch: ChannelId, budgets: ReadonlyMap<ChannelId, number>): ChannelChip {
  const { label, glyph, color } = CHANNELS[ch];
  const total = sum([...budgets.values()]);
  return { id: ch, name: label, glyph, color, state: channelState(w, ch), share: total > 0 ? round2((budgets.get(ch) ?? 0) / total) : 0 };
}

// ───────────────────────────── the scene ─────────────────────────────

/** The world stages a line, it does not audit it: the long reason and the books of a hire stay on the tabs. */
function sceneEntry({ numbers, ...e }: ChronicleEntry): ChronicleEntry {
  return { ...e, ...(e.why ? { why: short(e.why, SCENE_WHY) } : {}), ...(numbers && STAGED_NUMBERS.has(e.kind) ? { numbers } : {}) };
}

export function sceneOf(world: WorldState): SceneView {
  const { org, league, agents = [] } = world.company;
  const people = peopleIndex(world);
  const rated = ratedPeople(world);
  const books = books30(world);
  const budgets = budgetsOf(world);
  const openSeats: SceneView['openSeats'] = {};
  for (const p of org?.positions ?? []) {
    if (p.status !== 'open') continue;
    const { dept } = ROLES[p.roleId];
    openSeats[dept] = (openSeats[dept] ?? 0) + 1;
  }
  return {
    people: peopleChips(world, rated),
    board: rated.slice(0, SCENE_BOARD).map((r): BoardRow => ({ agentId: r.entry.agentId, name: r.entry.name, rating: Math.round(r.rating.rating), delta7d: delta7dOf(world, r.rating) })),
    podium: podiumOf(world, people),
    duels: (league?.duels ?? []).filter((d) => d.status === 'running' || d.status === 'ordered').slice(-SCENE_DUELS).map((d) => duelChip(d, people)),
    recent: chronicleOf(world).slice(-SCENE_RECENT).map(sceneEntry),
    channels: CHANNEL_IDS.map((ch) => chipOf(world, ch, budgets)).filter((c) => c.state !== 'closed'),
    stage: stageView(world),
    team: { headcount: agents.length, payroll30d: books.payroll, revenuePerHead30d: perHead(books.revenue, agents.length) },
    openSeats,
    closedDepts: org?.closedDepts ?? [],
    names: Object.fromEntries((org?.alumni ?? []).slice(-SCENE_NAMES).map((a) => [a.id, a.name])),
  };
}

// ───────────────────────────── Effectif ─────────────────────────────

function headRow(w: WorldState, a: AgentState, books: Books, founderShare: number): HeadRow {
  const pay = w.scenario.org?.payroll ? payOf(a) * daysIn(books, a.hiredDay) * (a.founder ? founderShare : 1) : 0;
  const pay30d = round2(pay + (books.oneOff30.get(`hire:${a.id}`) ?? 0));
  // Compaction keeps 21 days of finished tasks: the 30 are what the world holds and what it folded by day.
  const held = (w.company.tasks ?? []).filter((t) => t.assignee === a.id && t.status === 'done' && (t.dayDone ?? 0) >= books.fromDay).length;
  const folded = Object.entries(w.company.taskTotals?.agents?.[a.id]?.days ?? {}).filter(([day]) => Number(day) >= books.fromDay);
  const output30d = held + sum(folded.map(([, n]) => n));
  const entry = w.company.league?.entries[a.id];
  const rating = entry?.primary ? entry.ratings[entry.primary]?.rating : undefined;
  return {
    agentId: a.id, name: a.name, role: a.role, avatar: a.avatar, isChief: a.isChief, tier: a.tier, contract: contractOf(w, a), hiredDay: a.hiredDay, desk: a.desk ?? 0,
    rating: rating === undefined ? null : Math.round(rating), hats: a.hatKinds ?? [], pay30d, output30d, costPerOutput: ratio(pay30d, output30d),
  };
}

function reqView(w: WorldState, p: Position, people: PeopleIndex): HiringReqView {
  const role = ROLES[p.roleId];
  const refused = p.status === 'open' ? w.company.org?.decisions.findLast((d) => d.kind === 'refused' && d.roleId === p.roleId && d.day >= p.openedDay) : undefined;
  return {
    id: p.id, dept: role.dept, role: role.title, why: p.detail, status: p.status, openedDay: p.openedDay, budget30d: round2(payOfTier(role.tier) * WINDOW_DAYS), blockedBy: refused?.text ?? null,
    candidates: p.candidates.map((c) => ({ name: c.name, score: c.interview, source: c.lineage ? `élève de ${cardOf(people, c.lineage).name}` : 'marché' })),
  };
}

function deptLoad(w: WorldState, team: readonly AgentState[]): number {
  const days = (w.company.org?.load ?? []).filter((d) => d.day > w.day - LOAD_DAYS);
  const worked = sum(days.flatMap((d) => team.map((a) => d.busy[a.id] ?? 0)));
  return ratio(worked, days.length * team.length * ORG.workTicksPerDay) ?? 0;
}

function lastRefusal(w: WorldState): ChronicleEntry | null {
  const d = w.company.org?.decisions.findLast((x) => x.kind === 'refused');
  return d ? { key: `org:${d.id}`, day: d.day, kind: 'req_open', text: d.text, dept: d.roleId ? ROLES[d.roleId].dept : null, numbers: d.numbers } : null;
}

export function orgDetail(world: WorldState): OrgDetail {
  const { org, agents = [], departments = [] } = world.company;
  const books = books30(world);
  const people = peopleIndex(world);
  const cost30d = round2(books.payroll + books.recruiting);
  const positions = org?.positions ?? [];
  const founderShare = founderShareOf(world, books);
  const depts = departments.map((d): OrgDept => {
    const team = agents.filter((a) => a.dept === d.id);
    const heads = team.map((a) => headRow(world, a, books, founderShare)).sort((a, b) => Number(b.isChief) - Number(a.isChief) || a.desk - b.desk);
    return {
      id: d.id, name: d.name, color: d.color, chiefId: d.chiefId ?? null, headcount: team.length, cost30d: round2(sum(heads.map((h) => h.pay30d))), load: deptLoad(world, team),
      openReqs: positions.filter((p) => p.status === 'open' && ROLES[p.roleId].dept === d.id).length, heads,
    };
  });
  return {
    stage: stageView(world),
    headcount: agents.length, cost30d, costPerHead30d: perHead(cost30d, agents.length), revenuePerHead30d: perHead(books.revenue, agents.length), profitPerHead30d: perHead(books.profit, agents.length),
    depts,
    closed: (org?.closedDepts ?? []).map((d) => ({ id: d.id, name: d.name, hostedBy: org?.deptHost[d.id] ?? null })),
    reqs: [...positions.filter((p) => p.status === 'open'), ...positions.filter((p) => p.status !== 'open').slice(-VIEW_REQS)].map((p) => reqView(world, p, people)),
    pressure: org?.pressure ?? [],
    lastRefusal: lastRefusal(world),
    decisions: chronicleOf(world).filter((e) => TEAM_MOVES.has(e.kind)).slice(-VIEW_DECISIONS),
    history: (world.company.growth?.weeks ?? []).map((r) => ({ day: r.toDay, headcount: r.agents, cost7d: r.payroll })),
  };
}

// ───────────────────────────── Compétition ─────────────────────────────

function seasonRules(): string[] {
  const { seasonDays, plan, challenge, rating } = TALENT;
  return [
    `Une saison dure ${seasonDays} jours : chacun est noté sur ce qu'il a produit et sur ce que le marché en a fait.`,
    `Sous la barre ${plan.underCloses} clôtures de suite, avec assez de preuves et ${plan.tenureDays} jours de maison : plan d'amélioration de ${plan.days} jours, avec un coach si un collègue ou un chef peut l'être, jamais avant le jour ${plan.firstDay}. La barre est ${rating.par}, ou la médiane de l'équipe si elle est plus haute.`,
    `Plan raté : le titulaire repasse ${challenge.sits} fois (${challenge.claudeSits} fois quand Claude écrit) le même test que ${challenge.candidates} candidats, le meilleur prend le poste s'il dépasse l'écart exigé, ce que le test sait séparer du bruit. Si le test du métier ne sépare pas les talents, le poste est conservé.`,
    `Au plus ${challenge.replacementsPerSeason} remplacements par saison, et ${challenge.sameRoleDays} jours entre deux sur un même poste.`,
    'La CEO et les postes sans effet mesurable restent hors ligue.',
  ];
}

/** What happens under the line, in the rules' own numbers. A family whose test sees no talent ends at the plan. */
function cutText(bar: number, blind: boolean): string {
  const { underCloses, days } = TALENT.plan;
  const plan = `Sous la barre de ${ratingText(bar)} : après ${underCloses} clôtures de suite, un plan d'amélioration de ${days} jours`;
  return blind ? `${plan}. Ce métier n'a pas de test fiable : le poste est conservé.` : `${plan}, puis, si le plan échoue, le poste passe au marché.`;
}

/** Who holds no rating: a post no result reads, or a seat with nothing to read yet. Nobody here is called unmeasurable because of a thin week. */
function outsideLeague(w: WorldState, rated: readonly Rated[]): LeagueDetail['outside'] {
  const ranked = new Set(rated.map((r) => r.entry.agentId));
  return w.company.agents.filter((a) => !ranked.has(a.id)).map((a) => {
    const skill = primaryOf(a.roleId);
    const why = !skill ? 'Hors ligue : poste sans effet mesurable sur un résultat'
      : testSeesTalent(skill) ? `Pas encore noté : aucun résultat à lire en ${SKILL_LABELS[skill].toLowerCase()}`
        : `Pas encore noté, et le test de ce métier (${SKILL_LABELS[skill].toLowerCase()}) ne sépare pas les talents`;
    return { agentId: a.id, name: a.name, why };
  });
}

/** Seats and euros of the last close that paid for training, and of all of them. */
function trainingOf(reports: readonly SeasonReport[]): LeagueDetail['season']['training'] {
  const paid = reports.flatMap((r) => (r.training ? [r.training] : []));
  const last = paid.at(-1);
  return last ? { ...last, totalEur: round2(sum(paid.map((t) => t.eur))) } : null;
}

/** The person's last 5 duels, else their last 5 weeks (talent §9.0). */
function formOf(w: WorldState, id: AgentId, r: SkillRating): LeagueRow['form'] {
  const duels = (w.company.league?.duels ?? []).filter((d) => d.status === 'settled' && d.agents.includes(id)).slice(-FORM_POINTS);
  if (duels.length) return duels.map((d) => { const winner = duelWinner(d); return winner === null ? 'N' : winner === id ? 'V' : 'D'; });
  const weeks = r.history.slice(-FORM_POINTS - 1).map((p) => p.rating);
  return weeks.slice(1).map((rating, i) => { const delta = rating - weeks[i]!; return delta > WEEK_FORM_DELTA ? 'V' : delta < -WEEK_FORM_DELTA ? 'D' : 'N'; });
}

function leagueRow(w: WorldState, r: Rated, rank: number, before: readonly SeasonRow[] | undefined): LeagueRow {
  const { entry, rating } = r;
  const agent = w.company.agents.find((a) => a.id === entry.agentId);
  const previous = before ? before.findIndex((x) => x.agentId === entry.agentId) : -1;
  return {
    agentId: entry.agentId, name: entry.name, role: entry.role, dept: agent?.dept ?? 'direction', avatar: entry.avatar,
    rank, rankDelta: previous < 0 ? 0 : previous + 1 - rank, rating: Math.round(rating.rating), delta7d: delta7dOf(w, rating), spark: rating.history.slice(-SPARK_POINTS).map((p) => Math.round(p.rating)),
    form: formOf(w, entry.agentId, rating), points: Math.round(rating.rating - TALENT.rating.par), sample: Math.round(rating.seasonN * 10) / 10,
    confidence: rating.rd < 100 ? 'forte' : rating.rd < 150 ? 'moyenne' : 'faible', contract: agent ? contractOf(w, agent) : 'active',
    metric: rating.metric === null ? null : METRICS[r.skill].text(rating.metric), underBar: entry.underBar ?? 0,
  };
}

function duelView(d: Duel, people: PeopleIndex): DuelView {
  const side = (i: 0 | 1): DuelSide => ({
    agentId: d.agents[i], name: cardOf(people, d.agents[i]).name, score: d.result?.ctr[i] ?? null, ratingDelta: d.result ? d.result.delta * (i === 0 ? 1 : -1) : null,
  });
  return {
    ...duelChip(d, people), metric: 'CTR', a: side(0), b: side(1), startedDay: d.startDay, winnerId: duelWinner(d),
    status: d.status === 'settled' ? 'done' : d.status === 'cancelled' ? 'void' : 'open',
  };
}

function alumnusView(w: WorldState, a: Alumnus, people: PeopleIndex, books: Books): AlumnusView {
  const entry = w.company.league?.entries[a.id];
  const seen = Object.values(entry?.ratings ?? {}).flatMap((r) => [r.rating, ...r.history.map((p) => p.rating)]);
  const paid = w.scenario.org?.payroll ? payOf({ tier: ROLES[a.roleId].tier, level: a.level } as AgentState) * Math.max(1, a.leftDay - Math.max(1, a.hiredDay) + 1) : 0;
  return {
    person: cardOf(people, a.id), hiredDay: a.hiredDay, leftDay: a.leftDay, kind: a.kind, why: entry?.leftBecause ?? a.reason,
    bestRating: seen.length ? Math.round(Math.max(...seen)) : null, titles: entry?.trophies.length ?? 0, tasksDone: a.perf.done,
    cost: round2(paid + (books.oneOff.get(`hire:${a.id}`) ?? 0) + (books.oneOff.get(`leave:${a.id}`) ?? 0)),
    replacedBy: a.replacedBy ? { id: a.replacedBy, name: cardOf(people, a.replacedBy).name } : null,
  };
}

const fr2 = (n: number): string => n.toFixed(2).replace('.', ',');

/** True talent of everyone who ever held a skill: « plafond 0,71, élève de Sarah ». God mode only. */
export function talentViews(world: WorldState): Record<AgentId, TalentTruthView> {
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

export function leagueDetail(world: WorldState, god: boolean): LeagueDetail {
  const league = world.company.league;
  const people = peopleIndex(world);
  const rated = ratedPeople(world);
  const last = league?.seasons.at(-1);
  const seasonEnd = ((league?.closedSeasons ?? 0) + 1) * TALENT.seasonDays;
  const bar = league?.bar ?? TALENT.rating.par;
  const roles = SKILLS.flatMap((skill): LeagueDetail['roles'] => {
    const family = rated.filter((r) => r.skill === skill);
    if (!family.length) return [];
    const before = last?.tables[skill];
    const at = family.findIndex((r) => r.rating.rating + TALENT.plan.underRd * r.rating.rd < bar);
    return [{ key: skill, label: SKILL_LABELS[skill], rows: family.map((r, i) => leagueRow(world, r, i + 1, before)), cutLine: at < 0 ? null : at + 1, blindTest: !testSeesTalent(skill) }];
  });
  const duels = league?.duels ?? [];
  const open = duels.filter((d) => d.status === 'ordered' || d.status === 'running');
  const hallOfFame = (league?.seasons ?? []).flatMap((s): LeagueDetail['hallOfFame'] => {
    if (!s.employee) return [];
    const [first, second, third] = seasonTop(s);
    return first ? [{
      season: s.season, champion: cardOf(people, first.agentId), score: Math.round(first.rating - TALENT.rating.par), still: world.company.agents.some((a) => a.id === first.agentId),
      second: second ? cardOf(people, second.agentId) : null, third: third ? cardOf(people, third.agentId) : null,
    }] : [];
  });
  const books = books30(world);
  return {
    season: {
      no: league?.season ?? 1, fromDay: Math.max(1, league?.seasonStartDay ?? 1), toDay: seasonEnd, daysLeft: Math.max(0, seasonEnd - world.day), rules: seasonRules(),
      bar: Math.round(bar), cut: cutText(bar, false), cutBlind: cutText(bar, true), training: trainingOf(league?.seasons ?? []),
    },
    roles,
    outside: outsideLeague(world, rated),
    plans: (league?.plans ?? []).slice(-VIEW_PLANS),
    lastHire: league?.hires.at(-1) ?? null,
    duels: [...open, ...duels.filter((d) => !open.includes(d)).slice(-VIEW_DUELS)].map((d) => duelView(d, people)),
    transfers: chronicleOf(world).filter((e) => TRANSFERS.has(e.kind)).slice(-VIEW_TRANSFERS),
    hallOfFame,
    alumni: (world.company.org?.alumni ?? []).slice(-VIEW_ALUMNI).map((a) => alumnusView(world, a, people, books)),
    ...(god ? { god: talentViews(world) } : {}),
  };
}

// ───────────────────────────── Canaux ─────────────────────────────

/** A day of a channel. `kpi.channels` is absent on a day whose rows are all TikTok's, so those are read back from the rows. */
function dayKpi(k: DailyKpi, ch: ChannelId, rows: readonly DailyAdStats[]): ChannelDayKpi | null {
  if (k.channels) return k.channels[ch] ?? null;
  if (ch !== 'tiktok') return null;
  const of = (read: (r: DailyAdStats) => number): number => sum(rows.map(read));
  const revenue = round2(of((r) => r.revenue));
  const sales = of((r) => r.purchases);
  return {
    spend: k.adSpend, impressions: of((r) => r.impressions), clicks: of((r) => r.clicks), landingViews: of((r) => r.landingViews), shopSales: sales, shopRevenue: revenue,
    claimedSales: sales, claimedRevenue: revenue, reconciledRevenue: revenue, roas: ratio(revenue, k.adSpend) ?? 0,
  };
}

function channelWhy(w: WorldState, ch: ChannelId, state: ChannelState, unlock: ChannelRow['unlock']): string {
  const book = w.company.channels;
  switch (state) {
    case 'banned': return `Compte suspendu jusqu'au jour ${accountOf(w.market, ch)?.bannedUntilDay ?? w.day}.`;
    case 'verifying': return `Compte en vérification depuis le jour ${book?.requested[ch] ?? w.day}.`;
    case 'open': return book?.plan?.lines.find((l) => l.channel === ch)?.note ?? 'Ouvert.';
    case 'closed': {
      const back = book?.requested[ch];
      if (back !== undefined && back > w.day) return `En pause : pas de test avant le jour ${back}.`;
      const missing = unlock.filter((s) => !s.met).map((s) => `${s.label} ${dec(s.value, Number.isInteger(s.value) ? 0 : 2)} / ${dec(s.target, Number.isInteger(s.target) ? 0 : 2)}`);
      return missing.length ? `Fermé : ${missing.join(', ')}.` : 'Fermé : les conditions sont réunies, la demande part au prochain plan.';
    }
  }
}

function channelRow(w: WorldState, ch: ChannelId, days: readonly { k: DailyKpi; rows: readonly DailyAdStats[] }[], budgets: ReadonlyMap<ChannelId, number>): ChannelRow {
  const seen = days.flatMap(({ k, rows }) => {
    const row = dayKpi(k, ch, rows);
    return row ? [{ day: k.day, row, own: rows.filter((r) => channelOf(r) === ch) }] : [];
  });
  const lastDay = days.at(-1)?.k.day ?? w.day;
  const week = seen.filter((d) => d.day > lastDay - CHANNEL_WEEK);
  const total = (read: (r: ChannelDayKpi) => number): number => round2(sum(week.map((d) => read(d.row))));
  const spend7d = total((r) => r.spend);
  const impressions7d = total((r) => r.impressions);
  const claimed = total((r) => r.claimedRevenue);
  const shop = total((r) => r.shopRevenue);
  const reconciled = total((r) => r.reconciledRevenue);
  const chip = chipOf(w, ch, budgets);
  const lines = w.company.channels?.plan?.lines.filter((l) => l.channel === ch) ?? [];
  const weighted = lines.filter((l) => l.marginal !== null);
  const budget = round2(budgets.get(ch) ?? 0);
  const running = new Set((w.company.campaigns ?? []).filter((c) => c.status === 'active' && channelOf(c) === ch).flatMap((c) => c.creativeIds));
  const unlock = unlockProgress(w, ch);
  const rows7d = week.flatMap((d) => d.own);
  return {
    ...chip, spend7d, spend30d: round2(sum(seen.map((d) => d.row.spend))), budget,
    claimedRevenue7d: claimed, shopRevenue7d: shop, reconciledRevenue7d: reconciled,
    claimedRoas7d: ratio(claimed, spend7d), shopRoas7d: ratio(shop, spend7d), reconciledRoas7d: ratio(reconciled, spend7d),
    marginalRoas: weighted.length ? ratio(sum(weighted.map((l) => l.marginal! * l.budget)), sum(weighted.map((l) => l.budget))) : null,
    inflation: ratio(claimed, shop),
    budgetCap: lines.length ? round2(sum(lines.map((l) => l.target))) : budget,
    cpm: ratio(spend7d * 1000, impressions7d) ?? 0, ctr: rate(total((r) => r.clicks), impressions7d), cvr: rate(total((r) => r.shopSales), total((r) => r.landingViews)),
    impressions7d, creatives: running.size, fatigue: rows7d.length ? round2(sum(rows7d.map((r) => r.frequency)) / rows7d.length) : 0, strikes: accountOf(w.market, ch)?.strikes ?? 0,
    unlock, why: channelWhy(w, ch, chip.state, unlock),
    daily: seen.map(({ day, row }) => ({ day, spend: row.spend, claimed: row.claimedRevenue, reconciled: row.reconciledRevenue })),
  };
}

export function channelsDetail(world: WorldState): ChannelsDetail {
  const budgets = budgetsOf(world);
  const stats = new Map<number, DailyAdStats[]>();
  for (const s of world.market.adStats ?? []) {
    const rows = stats.get(s.day);
    if (rows) rows.push(s);
    else stats.set(s.day, [s]);
  }
  const days = (world.company.kpis ?? []).slice(-DAILY_DAYS).map((k) => ({ k, rows: stats.get(k.day) ?? [] }));
  const rows = CHANNEL_IDS.map((ch) => channelRow(world, ch, days, budgets));
  const spend7d = round2(sum(rows.map((r) => r.spend7d)));
  const reconciledRevenue7d = round2(sum(rows.map((r) => r.reconciledRevenue7d)));
  const book = world.company.channels;
  return { rows, totals: { spend7d, reconciledRevenue7d, reconciledRoas7d: ratio(reconciledRevenue7d, spend7d) }, plan: book?.plan ?? null, matrix: book?.lines ?? [] };
}

// ───────────────────────────── the digest ─────────────────────────────

function highlightsOf(entries: readonly ChronicleEntry[]): ChronicleEntry[] {
  const weight = (e: ChronicleEntry): number => HIGHLIGHT_WEIGHT[e.kind] ?? 0;
  const ranked = entries.filter((e) => weight(e) > 0).map((e, i) => ({ e, i })).sort((a, b) => weight(b.e) - weight(a.e) || b.e.day - a.e.day || b.i - a.i);
  const seen = new Map<ChronicleKind, number>();
  const out: ChronicleEntry[] = [];
  for (const { e } of ranked) {
    const n = seen.get(e.kind) ?? 0;
    if (n >= HIGHLIGHTS_PER_KIND) continue;
    seen.set(e.kind, n + 1);
    out.push(e);
    if (out.length >= MAX_HIGHLIGHTS) break;
  }
  return out;
}

/** The digest's people and channels are scale's own (P10.3), read from the people themselves. The chronicle adds what stood out, and what it says is not said twice. */
export function digestPeopleOf(world: WorldState, fromDay: number, toDay: number): Pick<FounderDigest, 'people' | 'channels' | 'highlights' | 'decisions'> {
  const { people, channels, decisions } = buildDigest(world, fromDay, toDay);
  const highlights = highlightsOf(chronicleOf(world, fromDay).filter((e) => e.day <= toDay));
  const told = new Set(highlights.map((e) => e.text));
  return { people, channels, highlights, decisions: decisions.filter((d) => !told.has(d.text)) };
}

// ───────────────────────────── the gallery ─────────────────────────────

/** A tile of the gallery. `ad_video` never is a `Deliverable` (D27): its tiles come from the manifest, through the session. */
export type DeliverableTile = Omit<Deliverable, 'kind'> & { kind: Deliverable['kind'] | 'ad_video'; poster?: string | null };
export interface DeliverablePage { items: DeliverableTile[]; page: number; pages: number; pageSize: number; total: number }

/** An evicted video keeps its poster, and its tile: the player asks for a new render. */
function videoTile(id: string, v: CreativeVideo, creative: AdCreative | undefined): DeliverableTile[] {
  const path = v.videos[0]?.path ?? v.poster;
  if (!path) return [];
  return [{
    id: `vid_${id}`, kind: 'ad_video', title: creative?.hook ?? 'Vidéo de pub', productId: creative?.productId ?? null, creativeId: id, path,
    createdBy: creative?.createdBy ?? 'system', day: creative?.createdDay ?? 0, quality: creative?.quality?.overall ?? null, poster: v.poster,
  }];
}

/** The whole run, newest first: `archived` is what compaction took out of the world. Pages start at 1. */
export function deliverablesPage(world: WorldState, query: { page?: number; kinds?: readonly string[] }, videos: Readonly<Record<string, CreativeVideo>> = {}, archived: readonly Deliverable[] = []): DeliverablePage {
  const creatives = new Map((world.company.creatives ?? []).map((c) => [c.id, c]));
  const covers = new Map((world.company.products ?? []).map((p) => [p.id, p.files?.cover ?? null]));
  const held = new Set((world.company.deliverables ?? []).map((d) => d.id));
  const works: DeliverableTile[] = [...archived.filter((d) => !held.has(d.id)), ...(world.company.deliverables ?? [])].map((d) => (d.kind === 'pdf' && d.productId ? { ...d, poster: covers.get(d.productId) ?? null } : d));
  const films = new Set<string>(); // two ads with the same spec are one film: it shows once
  const tiles = [...works, ...Object.entries(videos).flatMap(([id, v]) => videoTile(id, v, creatives.get(id)).filter((t) => !films.has(filmOf(t.path)) && films.add(filmOf(t.path))))];
  const wanted = query.kinds?.length ? new Set<string>(query.kinds) : null;
  const shown = tiles.map((tile, i) => ({ tile, i })).filter(({ tile }) => !wanted || wanted.has(tile.kind)).sort((a, b) => b.tile.day - a.tile.day || b.i - a.i).map(({ tile }) => tile);
  const pages = Math.max(1, Math.ceil(shown.length / GALLERY_PAGE));
  const page = Math.min(pages, Math.max(1, query.page ?? 1));
  return { items: shown.slice((page - 1) * GALLERY_PAGE, page * GALLERY_PAGE), page, pages, pageSize: GALLERY_PAGE, total: shown.length };
}
