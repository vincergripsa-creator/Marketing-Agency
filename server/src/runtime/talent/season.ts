/**
 * Seasons, plans and what comes of them (talent §6.1, §7). The close reads observed numbers only, and `closedSeasons`
 * makes it happen once, like `lastRetroDay`. `flat` stores the tables and pays for training: a paired control has no other
 * consequence. Routing landed with the ratings it reads, in evidence.ts.
 *
 * « Sous la barre pendant un certain temps » is a chain, each link stated in the texts: two closes under the bar on a real
 * sample, day 42 at the earliest, a plan of 14 days, with a coach when the seat has a colleague or a chief, a plan failed, a
 * challenge the market wins by more than its noise. The first replacement can come on day 56, never before.
 */
import type { AgentId, AgentState, LeagueEntry, ProbationPlan, SeasonReport, SeasonRow, Skill, SkillRating, WorldState } from '../../shared.js';
import { ADS } from '../../sim/balance.js';
import type { RuntimeCtx } from '../ctx.js';
import { nameOf, speak, writeNote } from '../ctx.js';
import { activeHolds, advancesHold, firingHold, pinHold } from '../holds.js';
import { sim } from '../modules.js';
import { isLegacyOrg } from '../org/constants.js';
import { officerId } from '../org/officers.js';
import { chiefOf } from '../tasks.js';
import { closedWindow, computeBudget, ledgerWindow } from '../metrics.js';
import { growthOn } from '../stages.js';
import { dec, eur, median } from '../util.js';
import { hireBudgetOk, keepNoTest, METRICS, pendingSwap, ratingText, runChallenge, testSeesTalent } from './challenge.js';
import { MIN_SEASON_N, TALENT } from './constants.js';
import { familyOf, leagueSeats, SKILLS } from './skills.js';
import { talentMode, trainable, trainSeat } from './truth.js';

export { routeBonus } from './evidence.js';

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The calendar never moves: an announced outage only pushes one close to the next evening. */
export function dueSeasonClose(w: WorldState): boolean {
  const league = w.company.league;
  if (talentMode(w) === 'off' || !league) return false;
  return w.day >= (league.closedSeasons + 1) * TALENT.seasonDays && !sim.isAnnouncedOutage(w, w.day);
}

/** The last days of a run, in which a new face cannot pay back. An open-ended run has none (D20). */
function nearHorizon(w: WorldState): boolean {
  return !w.scenario.openEnded && w.day > w.scenario.horizonDays - TALENT.challenge.horizonGuard;
}

/** Days of the season on which the market said nothing about anyone: an announced outage, or the ad account banned. */
function disruptedDays(w: WorldState, fromDay: number, toDay: number): number {
  const outages = new Set(sim.announcedOutageDays(w));
  const bans = w.market.events.filter((e) => e.kind === 'ad_account_banned').map((e) => e.day);
  let days = 0;
  for (let d = fromDay; d <= toDay; d++) if (outages.has(d) || bans.some((b) => d >= b && d < b + ADS.banDays)) days += 1;
  return days;
}

/** `metric` keeps an older season's number until this season gives a first one. */
function seasonMetric(r: SkillRating, season: number): number | null {
  return r.metricBase?.season === season ? r.metric : null;
}

function ratedOf(entry: LeagueEntry): { skill: Skill; rating: SkillRating } | null {
  const rating = entry.primary ? entry.ratings[entry.primary] : undefined;
  return entry.primary && rating ? { skill: entry.primary, rating } : null;
}

function seasonTables(w: WorldState, report: SeasonReport): SeasonReport['tables'] {
  const league = w.company.league!;
  const last = league.seasons.at(-1);
  const tables: SeasonReport['tables'] = {};
  for (const skill of SKILLS) {
    const rows = Object.values(league.entries).flatMap((e): SeasonRow[] => {
      const r = e.ratings[skill];
      if (!r || (e.status === 'gone' && (e.leftDay ?? 0) < report.fromDay)) return [];
      const before = last?.tables[skill]?.find((row) => row.agentId === e.agentId)?.rating ?? r.history[0]?.rating ?? TALENT.rating.par;
      return [{ agentId: e.agentId, name: e.name, rating: r.rating, delta: round1(r.rating - before), metric: seasonMetric(r, report.season), n: r.seasonN, status: e.status }];
    });
    if (rows.length) tables[skill] = rows.sort((a, b) => b.rating - a.rating || a.agentId.localeCompare(b.agentId));
  }
  return tables;
}

// ───────────────────────────── Plans ─────────────────────────────

/** Opened at a close and pushed once: past one plan length after that close, it already had its extra season. */
function extended(w: WorldState, plan: ProbationPlan): boolean {
  const opened = w.company.league!.seasons.find((s) => s.season === plan.openedSeason)?.toDay;
  return opened !== undefined && plan.deadlineDay > opened + TALENT.plan.days + 1;
}

/** Met on the season's number, or back near the bar. A sample too small can fail nobody: one more season, then the plan closes on its own (§5.3, §7.2). */
export function reviewPlans(ctx: RuntimeCtx, report: SeasonReport): void {
  const w = ctx.world;
  const league = w.company.league!;
  for (const plan of league.plans) {
    if (plan.outcome !== 'open' || plan.deadlineDay > w.day) continue;
    const entry = league.entries[plan.agentId];
    const r = entry?.ratings[plan.skill];
    if (!entry || !r) continue;
    const metric = seasonMetric(r, report.season);
    const m = METRICS[plan.skill];
    const read = `${m.label} ${metric === null ? 'non mesurée' : m.text(metric)}, objectif ${m.text(plan.target)}, classement ${ratingText(r.rating)}`;
    const closeWith = (note: string): void => {
      plan.outcome = 'met';
      entry.status = 'active';
      report.notes.push(note);
    };
    if ((metric !== null && metric >= plan.target) || r.rating >= (league.bar ?? TALENT.rating.par) - TALENT.plan.metUnderBar) {
      closeWith(`${entry.name} tient son plan : ${read}.`);
    } else if (r.seasonN >= MIN_SEASON_N[plan.skill]) {
      plan.outcome = 'failed';
      report.notes.push(`${entry.name} ne tient pas son plan : ${read}.`);
    } else if (extended(w, plan)) {
      closeWith(`Plan de ${entry.name} clos : échantillon insuffisant deux saisons de suite, personne n'est jugé là-dessus.`);
    } else {
      plan.deadlineDay += TALENT.plan.days;
      report.notes.push(`Plan de ${entry.name} prolongé d'une saison : échantillon insuffisant (${dec(r.seasonN, 1)} pour ${MIN_SEASON_N[plan.skill]}).`);
    }
  }
}

/** The best colleague on the skill, else the chief: someone who is not the person on the plan. */
function coachFor(w: WorldState, agent: AgentState, skill: Skill): AgentId | null {
  const league = w.company.league!;
  const rating = (a: AgentState): number => league.entries[a.id]?.ratings[skill]?.rating ?? -Infinity;
  const peers = familyOf(w, skill).filter((a) => a.id !== agent.id && rating(a) > -Infinity).sort((a, b) => rating(b) - rating(a) || a.id.localeCompare(b.id));
  const chief = chiefOf(w, agent.dept);
  return peers[0]?.id ?? (chief && chief.id !== agent.id ? chief.id : null);
}

function coachLine(ctx: RuntimeCtx, coachId: AgentId | null, skill: Skill, season: number): string {
  if (!coachId) return '';
  const r = ctx.world.company.league!.entries[coachId]?.ratings[skill];
  const metric = r ? seasonMetric(r, season) : null;
  return ` Coach : ${nameOf(ctx, coachId)}${metric === null ? '' : ` (${METRICS[skill].text(metric)})`}.`;
}

/** Someone a challenge just kept is left alone for one season. */
function keptLately(w: WorldState, id: AgentId): boolean {
  return w.company.league!.hires.some((h) => h.incumbent === id && !h.hired && w.day - h.day <= TALENT.seasonDays + 1);
}

const gate = (r: SkillRating): number => r.rating + TALENT.plan.underRd * r.rd;

/** Par, or the team's median once the team stands above it: a seat is judged against the people around it. */
function seasonBar(w: WorldState): number {
  const seats = Object.values(w.company.league!.entries).flatMap((e) => {
    const rating = e.status === 'active' ? ratedOf(e)?.rating : undefined;
    return rating && rating.n > 0 ? [rating.rating] : [];
  });
  return Math.max(TALENT.rating.par, median(seats) ?? TALENT.rating.par);
}

/** One more close under the bar, on a real sample. A thin sample proves nothing either way, and whoever stands above it starts over. */
function countUnderBar(w: WorldState, bar: number): void {
  for (const entry of Object.values(w.company.league!.entries)) {
    const rated = entry.status === 'gone' ? null : ratedOf(entry);
    if (!rated) continue;
    if (gate(rated.rating) >= bar) entry.underBar = 0;
    else if (rated.rating.seasonN >= MIN_SEASON_N[rated.skill]) entry.underBar = (entry.underBar ?? 0) + 1;
  }
}

/** Who may enter a plan tonight, the furthest under the bar first: two closes under it, and every other condition of §7.2. */
function underBar(ctx: RuntimeCtx, report: SeasonReport): { agent: AgentState; entry: LeagueEntry; skill: Skill; rating: SkillRating }[] {
  const w = ctx.world;
  const league = w.company.league!;
  const { underCloses, firstDay, tenureDays } = TALENT.plan;
  if (w.day < firstDay) return [];
  return leagueSeats(w).flatMap((agent) => {
    const entry = league.entries[agent.id];
    const rated = entry && ratedOf(entry);
    if (!entry || !rated || entry.status !== 'active' || agent.notice || (entry.underBar ?? 0) < underCloses) return [];
    if (w.day - entry.hiredDay < tenureDays || pinHold(w, agent.id) || keptLately(w, agent.id)) return [];
    if (rated.rating.seasonN < MIN_SEASON_N[rated.skill]) {
      report.notes.push(`${entry.name} : échantillon insuffisant (${dec(rated.rating.seasonN, 1)} pour ${MIN_SEASON_N[rated.skill]}), pas de plan.`);
      return [];
    }
    const family = familyOf(w, rated.skill).flatMap((a) => league.entries[a.id]?.ratings[rated.skill] ?? []).filter((r) => r.n > 0);
    if (family.length >= 2 && family.some((r) => r.rating < rated.rating.rating)) return [];
    return [{ agent, entry, ...rated }];
  }).sort((a, b) => gate(a.rating) - gate(b.rating) || a.agent.id.localeCompare(b.agent.id));
}

/** At most one per family, three per season (§7.2). The deadline is the next close of the calendar: a plan always gets its 14 days of work. */
export function openPlans(ctx: RuntimeCtx, report: SeasonReport): void {
  const w = ctx.world;
  const league = w.company.league!;
  if (nearHorizon(w) || firingHold(w)) return;
  const { days, targetSd, perFamily, perSeason } = TALENT.plan;
  const opened: Skill[] = [];
  for (const { agent, entry, skill, rating } of underBar(ctx, report)) {
    if (opened.length >= perSeason) break;
    if (opened.filter((s) => s === skill).length >= perFamily) continue;
    const m = METRICS[skill];
    const baseline = seasonMetric(rating, report.season) ?? rating.metric ?? m.par();
    const target = Math.round((baseline + targetSd * m.sd()) * 100) / 100;
    const coachId = coachFor(w, agent, skill);
    const under = `sous la barre de ${ratingText(league.bar ?? TALENT.rating.par)} depuis ${entry.underBar} clôtures`;
    const text = `Plan d'amélioration de ${agent.name}, ${under} : ${m.label} ${m.text(baseline)}, objectif ${m.text(target)} en ${days} jours.${coachLine(ctx, coachId, skill, report.season)}`;
    league.plans.push({ agentId: agent.id, skill, openedSeason: report.season, deadlineDay: (league.closedSeasons + 1) * TALENT.seasonDays, metricLabel: m.label, baseline, target, coachId, text, outcome: 'open' });
    entry.status = 'probation';
    opened.push(skill);
    report.probations.push(text);
    speak(ctx, 'hr', text, 'meeting');
  }
}

// ───────────────────────────── Replacements ─────────────────────────────

function replacedLately(w: WorldState, role: AgentState['roleId']): boolean {
  return (w.company.org?.positions ?? []).some((p) => p.reason === 'replacement' && p.status === 'filled' && p.roleId === role && w.day - (p.closedDay ?? 0) < TALENT.challenge.sameRoleDays);
}

/**
 * The failed go through the challenge, within the rules of §7.6. A rule that says « not now » leaves the plan failed: the
 * next close looks again. A test that cannot see talent has nothing to wait for: the seat is kept on the spot.
 */
async function replaceFailed(ctx: RuntimeCtx, report: SeasonReport): Promise<void> {
  const w = ctx.world;
  const league = w.company.league!;
  const closed = league.plans.filter((p) => p.outcome === 'failed' && w.company.agents.some((a) => a.id === p.agentId));
  for (const plan of closed) if (!testSeesTalent(plan.skill)) report.notes.push(keepNoTest(ctx, plan).reason);
  const failed = closed.filter((p) => p.outcome === 'failed');
  if (!failed.length) return;
  const { disruptedDays: tooMany, replacementsPerSeason, replacementsPerFamily } = TALENT.challenge;
  const hold = firingHold(w);
  if (report.disruptedDays > tooMany || nearHorizon(w) || hold) {
    report.notes.push(hold ? `Aucun remplacement : ${hold.reason}.` : report.disruptedDays > tooMany ? `Aucun remplacement : ${report.disruptedDays} jours perturbés cette saison.` : 'Aucun remplacement : trop près de la fin.');
    return;
  }
  const done: Skill[] = [];
  for (const plan of failed) {
    if (done.length >= replacementsPerSeason) break;
    if (done.filter((s) => s === plan.skill).length >= replacementsPerFamily) continue;
    const leaver = w.company.agents.find((a) => a.id === plan.agentId)!;
    if (pendingSwap(w, leaver.id) || replacedLately(w, leaver.roleId)) continue;
    if (!hireBudgetOk(w, leaver)) {
      report.notes.push(`Remplacement de ${leaver.name} reporté : le CFO n'a pas la trésorerie.`);
      continue;
    }
    const outcome = await runChallenge(ctx, plan);
    if (!outcome.hired) {
      report.notes.push(outcome.reason);
      continue;
    }
    done.push(plan.skill);
    const leftBecause = league.entries[leaver.id]?.leftBecause;
    if (leftBecause) {
      report.dismissals.push(`${leaver.name} quitte l'agence : ${leftBecause}`);
      report.hires.push(outcome.reason);
    } else {
      report.notes.push(`${outcome.reason} En attente du fondateur.`);
    }
  }
}

// ───────────────────────────── Employee of the season ─────────────────────────────

/** Highest `(rating - par) / rd` on a real sample: above par and sure of it. The perk runs next season (D19). */
export function pickEmployee(w: WorldState, season: number): SeasonReport['employee'] {
  const league = w.company.league!;
  const { par } = TALENT.rating;
  const score = (r: SkillRating): number => (r.rating - par) / r.rd;
  const ranked = Object.values(league.entries).flatMap((entry) => {
    const rated = ratedOf(entry);
    return rated && entry.status === 'active' && rated.rating.seasonN >= MIN_SEASON_N[rated.skill] ? [{ entry, ...rated }] : [];
  }).sort((a, b) => score(b.rating) - score(a.rating) || a.entry.agentId.localeCompare(b.entry.agentId));
  const best = ranked[0];
  if (!best) return null;
  const { entry, skill } = best;
  const person = w.company.agents.find((a) => a.id === entry.agentId);
  entry.trophies.push({ season, title: person?.gender === 'f' ? 'Employée de la saison' : 'Employé de la saison' });
  league.perks.push({ agentId: entry.agentId, season: season + 1 });
  return { agentId: entry.agentId, name: entry.name, skill, perk: 'un brouillon de plus, priorité sur les tâches' };
}

// ───────────────────────────── Formation continue ─────────────────────────────

/** What the founder said that training cannot pass: his stop on spending or on every ad, and approval mode, where nothing paid goes out without his yes. */
function trainingStopped(w: WorldState): string | null {
  const stop = advancesHold(w) ?? activeHolds(w).find((h) => h.kind === 'ads' && h.productId === null && !h.channel);
  return stop?.reason ?? (w.scenario.founderApproval ? 'en mode validation, rien de payant ne part sans ton accord' : null);
}

/**
 * Paid at a close once the company can afford it, lowest rating first, so that nobody stops improving with their level:
 * `flat` pays it too, or the league would be measured against a company that trains nobody. The fixed team of legacy31
 * pays nothing: a control arm stays what it was. A line of the ledger like a hire, so the KPI identity holds. The text
 * gives seats and euros, never who gained what.
 */
function fundTraining(ctx: RuntimeCtx, report: SeasonReport): void {
  const w = ctx.world;
  const { seatEur, revenueShare, revenueDays, minCashTimes } = TALENT.training;
  const budget = computeBudget(w);
  if (!growthOn(w) || isLegacyOrg(w) || budget.survival || budget.bankrupt || budget.cash < minCashTimes * w.scenario.startingCash) return;
  const stopped = trainingStopped(w);
  if (stopped) {
    report.notes.push(`Formation continue non versée : ${stopped}.`);
    return;
  }
  const { fromDay, toDay } = closedWindow(w, revenueDays);
  const seats = leagueSeats(w);
  const payable = Math.min(seatEur * seats.length, revenueShare * ledgerWindow(w, fromDay, toDay).revenue);
  const league = w.company.league!;
  const ratingAt = (a: AgentState): number => (league.entries[a.id] && ratedOf(league.entries[a.id]!)?.rating.rating) ?? TALENT.rating.par;
  const funded = seats.filter((a) => !a.notice && trainable(w, a)).sort((a, b) => ratingAt(a) - ratingAt(b) || a.id.localeCompare(b.id)).slice(0, Math.floor(payable / seatEur));
  if (!funded.length) return;
  for (const a of funded) trainSeat(w, a);
  const paid = funded.length * seatEur;
  sim.recordLedger(w, { type: 'recruiting', amount: -paid, memo: `Formation continue : ${funded.length} poste(s), saison ${report.season}`, ref: `training:${report.season}` });
  report.training = { seats: funded.length, eur: paid };
  speak(ctx, 'hr', `formation continue : ${funded.length} poste(s) financé(s) ce soir, ${eur(paid)}.`, 'meeting');
}

// ───────────────────────────── The close ─────────────────────────────

/** Observed numbers only: `/runs/<id>/` serves this note (talent §9.0). */
function seasonNote(report: SeasonReport): string {
  const list = (title: string, lines: string[]): string[] => (lines.length ? [`## ${title}`, ...lines.map((l) => `- ${l}`), ''] : []);
  const tables = SKILLS.flatMap((skill) => {
    const rows = report.tables[skill];
    if (!rows) return [];
    return [`## ${METRICS[skill].label}`, '| Nom | Classement | Saison | Mesure | Échantillon | Statut |', '|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.name} | ${ratingText(r.rating)} | ${r.delta >= 0 ? '+' : ''}${dec(r.delta, 1)} | ${r.metric === null ? '—' : METRICS[skill].text(r.metric)} | ${dec(r.n, 1)} | ${r.status} |`), ''];
  });
  return [
    `> Jours ${report.fromDay} à ${report.toDay}, ${report.disruptedDays} jour(s) perturbé(s).`, '',
    ...(report.bar === undefined ? [] : [`Barre de la saison : ${ratingText(report.bar)}.`, '']),
    ...(report.training ? [`Formation continue : ${report.training.seats} poste(s), ${eur(report.training.eur)}.`, ''] : []),
    ...(report.employee ? [`Employé(e) de la saison : ${report.employee.name} (${report.employee.perk}).`, ''] : []),
    ...tables,
    ...list('Plans ouverts', report.probations), ...list('Départs', report.dismissals), ...list('Embauches', report.hires), ...list('Notes', report.notes),
    'Liens : [[Recrutement]]',
  ].join('\n');
}

/**
 * The ritual, in the order of §6.1. The season turns first: an error further down must not close it again tomorrow.
 * `seasonN` is kept to the end, the rules of the close read it, then every sample starts over. `rd` is a standard error:
 * it grows back only on a rating nobody played this season.
 */
export async function closeSeason(ctx: RuntimeCtx): Promise<SeasonReport> {
  const w = ctx.world;
  const league = w.company.league!;
  const report: SeasonReport = {
    season: league.season, fromDay: Math.max(1, league.seasonStartDay), toDay: w.day, tables: {}, employee: null,
    probations: [], dismissals: [], hires: [], notes: [], disruptedDays: disruptedDays(w, league.seasonStartDay, w.day),
  };
  league.season += 1;
  league.closedSeasons += 1;
  league.seasonStartDay = w.day + 1;
  const ratings = Object.values(league.entries).filter((e) => e.status !== 'gone').flatMap((e) => Object.values(e.ratings));
  for (const r of ratings) if (r.seasonN === 0) r.rd = Math.min(TALENT.rating.rd, r.rd * TALENT.rating.rdSeasonGrowth);

  if (talentMode(w) === 'league') {
    report.bar = league.bar = seasonBar(w);
    countUnderBar(w, league.bar);
    reviewPlans(ctx, report);
    openPlans(ctx, report);
    await replaceFailed(ctx, report);
    report.employee = pickEmployee(w, report.season);
  }
  fundTraining(ctx, report);
  report.tables = seasonTables(w, report);
  for (const r of ratings) r.seasonN = 0;
  league.seasons.push(report);

  const hr = officerId(w, 'hr');
  await writeNote(ctx, hr, { path: `rh/saison-${report.season}.md`, title: `Saison ${report.season}`, tags: ['rh', 'saison'], body: seasonNote(report) });
  speak(ctx, 'hr', `saison ${report.season} close${report.employee ? `, ${report.employee.name} en tête` : ''} : ${report.probations.length} plan(s) ouvert(s), ${report.hires.length} remplacement(s).`, 'meeting');
  return report;
}
