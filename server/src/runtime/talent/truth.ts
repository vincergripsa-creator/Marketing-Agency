/**
 * Hidden talent (talent §3, §4.10). It sits in `world.talentTruth`, next to `market`: nothing here reaches `company`, a
 * snapshot or a brain note. The league reads observed numbers only.
 */
import type { AgentId, AgentState, AgentTruth, LeagueEntry, LeagueState, Skill, TalentMode, TalentTruth, WorldState } from '../../shared.js';
import { clamp, streamRng } from '../../core/index.js';
import { hashString } from '../../core/ids.js';
import { STREAM } from '../streams.js';
import { TALENT } from './constants.js';
import { KIND_SKILL, leagueSeats, primaryOf, roleSkills, SKILLS, skillsUsed } from './skills.js';

/** An absent `scenario.talent` is an older save (§2.8). */
export function talentMode(w: WorldState): TalentMode {
  return w.scenario.talent ?? 'off';
}

/** The skills a control arm forces, on everyone, hires included: a lever test compares two values, never two draws. */
function forcedSkills(w: WorldState): Partial<Record<Skill, number>> {
  const c = w.scenario.control;
  const out: Partial<Record<Skill, number>> = {};
  if (c?.videoSkill !== undefined) out.video = c.videoSkill;
  if (c?.designTalent !== undefined) out.design = c.designTalent;
  for (const { skills, value } of [c?.talentOverride ?? []].flat()) for (const s of skills) out[s] = value;
  return out;
}

/**
 * One person's talent. Each draw has its key, on the person's id alone: paired arms share their founders, and who else
 * was hired moves nothing. `lineage` is a clone: its teacher's talent, a little worse on average (§7.4).
 * Pure: `scoreCandidates` tests a candidate who is not in `talentTruth`.
 */
export function drawPerson(w: WorldState, a: Pick<AgentState, 'id' | 'roleId' | 'founder'> & Partial<Pick<AgentState, 'level'>>, lineage: AgentId | null = null): AgentTruth {
  const person = hashString(a.id);
  const rngOf = (key: number) => streamRng(w.scenario.seed, STREAM.seedTalent, person, key);
  const g = rngOf(SKILLS.length).normal(0, TALENT.personSd);
  const onRole = new Set(roleSkills(a.roleId));
  const floor = a.founder ? TALENT.founderFloor : TALENT.marketFloor;
  const teacher = lineage ? w.talentTruth?.agents[lineage] : undefined;
  const forced = forcedSkills(w);
  const talent: AgentTruth['talent'] = {};
  const ceiling: AgentTruth['ceiling'] = {};
  SKILLS.forEach((skill, i) => {
    const mean = !onRole.has(skill) ? TALENT.offRoleMean : a.founder ? TALENT.founderMean : TALENT.marketMean;
    const rng = rngOf(i);
    const taught = teacher?.talent[skill];
    const drawn = taught !== undefined ? taught + rng.normal(TALENT.challenge.cloneMean, TALENT.challenge.cloneSd) : mean + g + rng.normal(0, TALENT.skillSd);
    const t = forced[skill] ?? clamp(drawn, floor, TALENT.cap);
    talent[skill] = t;
    ceiling[skill] = forced[skill] ?? Math.min(TALENT.ceilingCap, t + TALENT.ceilingGain);
  });
  return { agentId: a.id, talent, start: { ...talent }, ceiling, practicedLevel: a.level ?? 1, lineage };
}

export function seedTruth(w: WorldState): TalentTruth {
  const agents: TalentTruth['agents'] = {};
  for (const a of w.company.agents) agents[a.id] = drawPerson(w, a);
  return { agents, samples: [], swaps: [] };
}

/**
 * The truth of a living agent. Keyed on the id alone, so that a first read here or there, before or after a reload, is
 * the same person. Undefined while the world has no truth: talent is off, or the pillar never mounted.
 */
export function truthOf(w: WorldState, a: AgentState): AgentTruth | undefined {
  const truth = w.talentTruth;
  if (!truth) return undefined;
  return (truth.agents[a.id] ??= drawPerson(w, a));
}

/** Observed numbers only. `hireAgent` calls it for a hire, the evidence pass for anyone a hat brought in. `lineage` is public: « élève de Sarah ». */
export function leagueEntry(w: WorldState, a: AgentState, lineage: AgentId | null = w.talentTruth?.agents[a.id]?.lineage ?? null): LeagueEntry {
  return {
    agentId: a.id, name: a.name, role: a.role, avatar: { ...a.avatar },
    hiredDay: a.hiredDay, leftDay: null, status: 'active',
    ratings: {}, primary: primaryOf(a.roleId), lineage, trophies: [], leftBecause: null,
  };
}

export function emptyLeague(w: WorldState): LeagueState {
  const entries: LeagueState['entries'] = {};
  for (const a of leagueSeats(w)) entries[a.id] = leagueEntry(w, a);
  return {
    season: 1, seasonStartDay: w.day, closedSeasons: 0, lastEvidenceDay: 0,
    entries, plans: [], duels: [], hires: [], seasons: [], perks: [], events: [], parStats: {},
  };
}

/** A level earned by delivered work turns into real skill, on what the person works on, less each time (§4.10). Runs in `flat` too. */
export function practice(w: WorldState): void {
  if (!w.talentTruth) return;
  for (const a of w.company.agents) {
    const truth = truthOf(w, a)!;
    while (a.level > truth.practicedLevel) {
      for (const skill of skillsUsed(a)) {
        const t = truth.talent[skill];
        const top = truth.ceiling[skill];
        if (t !== undefined && top !== undefined && t < top) truth.talent[skill] = t + TALENT.practiceRate * (top - t);
      }
      truth.practicedLevel += 1;
    }
  }
}

/** A seat a close can train: its primary skill below the top of the scale, and not forced by a control arm. */
export function trainable(w: WorldState, a: AgentState): boolean {
  const skill = primaryOf(a.roleId);
  const t = skill ? truthOf(w, a)?.talent[skill] : undefined;
  return skill !== null && t !== undefined && t < TALENT.ceilingCap && forcedSkills(w)[skill] === undefined;
}

/** One funded seat: the same step towards the top of the scale for everyone, and the ceiling goes along, so practice can follow. Draws nothing. */
export function trainSeat(w: WorldState, a: AgentState): void {
  const skill = primaryOf(a.roleId);
  const truth = truthOf(w, a);
  const t = skill ? truth?.talent[skill] : undefined;
  if (!skill || !truth || t === undefined) return;
  const gain = TALENT.training.rate * (TALENT.ceilingCap - t);
  truth.talent[skill] = t + gain;
  truth.ceiling[skill] = Math.min(TALENT.ceilingCap, Math.max(t + gain, (truth.ceiling[skill] ?? t) + gain));
}

/** Open plans, `league` only: the coach pays each morning, and each week a coach who really is better pulls the pupil up (§4.10). */
export function coachTick(w: WorldState): void {
  const league = w.company.league;
  if (talentMode(w) !== 'league' || !league || !w.talentTruth) return;
  const { gain, overCeiling, energy, everyDays } = TALENT.coach;
  for (const plan of league.plans) {
    if (plan.outcome !== 'open' || !plan.coachId) continue;
    const coach = w.company.agents.find((a) => a.id === plan.coachId);
    const pupil = w.company.agents.find((a) => a.id === plan.agentId);
    if (!coach || !pupil) continue;
    coach.energy = Math.max(0, coach.energy - energy);
    if (w.day % everyDays !== 0) continue;
    const truth = truthOf(w, pupil)!;
    const t = truth.talent[plan.skill];
    const better = truthOf(w, coach)!.talent[plan.skill];
    if (t === undefined || better === undefined || better <= t) continue;
    const top = (truth.ceiling[plan.skill] ?? t) + overCeiling;
    if (t < top) truth.talent[plan.skill] = Math.min(top, t + gain);
  }
}

/** Mean true talent on their own skill of the people the league can judge, proof only. 0 without any. */
export function meanLeagueTalent(w: WorldState): number {
  const seats = leagueSeats(w);
  const values = seats.flatMap((a) => truthOf(w, a)?.talent[primaryOf(a.roleId)!] ?? []);
  return values.length ? values.reduce((sum, t) => sum + t, 0) / values.length : 0;
}

/**
 * One line per evening, proof only: M1 reads who is there, M2 who really did the work. A day without skilled work has no
 * work to weigh: it repeats the mean of who is there.
 */
export function sampleTalent(w: WorldState): void {
  const truth = w.talentTruth;
  if (!truth) return;
  const meanLeague = meanLeagueTalent(w);
  const worked: number[] = [];
  for (const task of w.company.tasks) {
    const skill = KIND_SKILL[task.kind];
    if (task.dayDone !== w.day || task.status !== 'done' || !skill || !task.assignee) continue;
    const t = truth.agents[task.assignee]?.talent[skill];
    if (t !== undefined) worked.push(t);
  }
  const workWeighted = worked.length ? worked.reduce((sum, t) => sum + t, 0) / worked.length : meanLeague;
  truth.samples.push({ day: w.day, meanLeague, workWeighted });
}
