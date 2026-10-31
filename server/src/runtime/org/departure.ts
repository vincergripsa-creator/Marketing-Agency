/**
 * Leaving (org §10). A departure is an agent moved to `org.alumni`, never a status: every loop of the company keeps
 * reading `company.agents`. A role that must not stay empty keeps its holder on notice until the replacement arrives.
 */
import type { AgentId, AgentState, Alumnus, OrgState, TaskKind, WorldState } from '../../shared.js';
import { agentNotePath, handOverRules } from '../../learning/playbooks.js';
import type { RuntimeCtx } from '../ctx.js';
import { speak } from '../ctx.js';
import { activeHolds } from '../holds.js';
import { sim } from '../modules.js';
import { closeEntry } from '../talent/challenge.js';
import { eur, pct, round2, sum } from '../util.js';
import { CANDIDATES, ROLES } from './catalog.js';
import { isLegacyOrg, ORG } from './constants.js';
import { logOrgDecision, moneyRead, openPosition } from './hiring.js';
import { writeDepartureNotes, writeMissingNotes, writeWeekNote } from './notes.js';
import { officerId, ownersOfAny, roleHolders } from './officers.js';
import { payOf } from './payroll.js';
import { legacyOrgState, reconcileOrg } from './reconcile.js';

const FOUNDING_ROLES = new Set(Object.values(CANDIDATES).filter((c) => c.founder).map((c) => c.roleId));

/** Share of the working ticks of the last `days` days an agent spent working or reviewing, counted from their arrival. */
function utilisation(w: WorldState, org: OrgState, a: AgentState, days: number): number {
  const rows = org.load.filter((d) => d.day > w.day - days && d.day >= a.hiredDay);
  return sum(rows.map((d) => d.busy[a.id] ?? 0)) / (Math.max(1, rows.length) * ORG.workTicksPerDay);
}

/** False for the CEO and for the last holder of a founding role, whose kinds no hat table could take back. */
export function canLeave(w: WorldState, id: AgentId): { ok: boolean; blockers: TaskKind[] } {
  const agent = w.company.agents.find((a) => a.id === id);
  if (!agent) return { ok: false, blockers: [] };
  const last = FOUNDING_ROLES.has(agent.roleId) && !roleHolders(w, agent.roleId).some((a) => a.id !== id && !a.notice);
  return agent.roleId === 'ceo' || last ? { ok: false, blockers: [...ROLES[agent.roleId].core] } : { ok: true, blockers: [] };
}

/** 'left' at once, 'notice' until a replacement arrives (hireAgent completes it), 'refused' when nobody can take the role. */
export async function requestDeparture(ctx: RuntimeCtx, id: AgentId, reason: string, by: AgentId, kind: Alumnus['kind']): Promise<'left' | 'notice' | 'refused'> {
  const w = ctx.world;
  const agent = w.company.agents.find((a) => a.id === id);
  if (!agent || agent.roleId === 'ceo') return 'refused';
  if (agent.notice) return 'notice';
  const leaves = canLeave(w, id).ok;
  agent.notice = { day: w.day, reason, by, kind };
  if (leaves) {
    await completeDeparture(ctx, id);
    return 'left';
  }
  if (!openPosition(ctx, agent.roleId, 'replacement', `Remplacer ${agent.name} : ${reason}`, id)) {
    agent.notice = null;
    return 'refused';
  }
  speak(ctx, 'hr', `${agent.name} reste à son poste jusqu'à l'arrivée de sa relève : ${reason}`, 'org');
  return 'notice';
}

/** Reason, author and kind come from `agent.notice`. A leaver who already left is a no-op: they are paid out once. */
export async function completeDeparture(ctx: RuntimeCtx, id: AgentId): Promise<void> {
  const w = ctx.world;
  const agent = w.company.agents.find((a) => a.id === id);
  if (!agent) return;
  const org = (w.company.org ??= legacyOrgState(w));
  const notice = agent.notice ?? { day: w.day, reason: 'départ', by: officerId(w, 'hr'), kind: 'fired' as const };
  const notePath = agentNotePath(w, agent);

  org.alumni.push({
    id, name: agent.name, gender: agent.gender, roleId: agent.roleId, dept: agent.dept, founder: agent.founder,
    hiredDay: agent.hiredDay, leftDay: w.day, reason: notice.reason, level: agent.level, kind: notice.kind,
    replacedBy: org.positions.find((p) => p.replaces === id && p.hiredId)?.hiredId ?? null,
    perf: agent.perf, avatar: agent.avatar,
  });
  w.company.agents = w.company.agents.filter((a) => a.id !== id);
  closeEntry(w, id, notice.reason);
  if (w.memory) {
    delete w.memory.idleTicks[id];
    delete w.memory.recalled[id];
  }
  reconcileOrg(w);
  // After reconcileOrg, not before: on a lean team the remaining owner of a kind is often the hat that just came back.
  const heirs = ownersOfAny(w, ROLES[agent.roleId].core).map((a) => a.id);
  const received = handOverRules(w, id, heirs);

  const severance = round2(ORG.severanceDays * payOf(agent));
  if (w.scenario.org?.payroll) {
    sim.recordLedger(w, { type: 'recruiting', amount: -severance, memo: `Départ de ${agent.name} (${ORG.severanceDays} jours de salaire)`, ref: `leave:${id}` });
  }
  org.stats.departures += 1;
  if (notice.kind === 'layoff') {
    org.stats.layoffs += 1;
    org.lastLayoffDay = w.day;
  }
  const text = `${agent.name} quitte l'agence : ${notice.reason}`;
  const { cash, margin, payroll, headcount } = moneyRead(w, agent.roleId);
  logOrgDecision(w, { kind: notice.kind === 'layoff' ? 'layoff' : 'leave', roleId: agent.roleId, agentId: id, text, numbers: { severance, pay: payOf(agent), level: agent.level, cash, margin, payroll, headcount } });
  await writeDepartureNotes(ctx, agent, notePath, `A quitté l'agence le jour ${w.day} : ${notice.reason}`, received);
  speak(ctx, 'hr', text, 'org');
}

/** A notice stands only while its replacement is on the way: a cancelled position sends the agent back to work, not to limbo. */
function settleNotices(ctx: RuntimeCtx, org: OrgState): void {
  for (const a of ctx.world.company.agents) {
    if (!a.notice || org.positions.some((p) => p.replaces === a.id && p.status === 'open')) continue;
    a.notice = null;
    speak(ctx, 'hr', `${a.name} reste finalement : sa relève n'est pas venue.`, 'org');
  }
}

/** Lowest utilisation first, then the highest pay, then the id. */
function byLayoffOrder(w: WorldState, org: OrgState, days: number): (a: AgentState, b: AgentState) => number {
  return (a, b) => utilisation(w, org, a, days) - utilisation(w, org, b, days) || payOf(b) - payOf(a) || a.id.localeCompare(b.id);
}

/** L2: a role with at least two holders carries someone it has not needed for two weeks. */
function idleDuplicate(w: WorldState, org: OrgState, free: readonly AgentState[]): AgentState | undefined {
  const { idleDays, idleUtil } = ORG.layoff;
  if (org.load.filter((d) => d.day > w.day - idleDays).length < idleDays) return undefined;
  return free
    .filter((a) => w.day - a.hiredDay >= idleDays && roleHolders(w, a.roleId).length >= 2 && utilisation(w, org, a, idleDays) < idleUtil)
    .sort(byLayoffOrder(w, org, idleDays))[0];
}

/** L1 and L2, founders outside both, at most one per cooldown. Nora signs, Gabriel gives the numbers. */
async function layoffs(ctx: RuntimeCtx, org: OrgState): Promise<void> {
  const w = ctx.world;
  const { cashDays, cooldownDays, idleDays, lossDays } = ORG.layoff;
  const { cash, margin, payroll, fixed } = moneyRead(w, 'ceo');
  const costs = round2(payroll + fixed);
  org.lossDays = cash < cashDays * costs && margin < costs ? org.lossDays + 1 : 0;
  if (w.day - org.lastLayoffDay < cooldownDays) return;

  const holds = activeHolds(w);
  if (holds.some((h) => h.kind === 'firing')) return;
  const free = w.company.agents.filter((a) => !a.founder && !a.notice && canLeave(w, a.id).ok && !holds.some((h) => h.kind === 'pin' && h.agentId === a.id));
  const hr = officerId(w, 'hr');
  if (org.lossDays >= lossDays) {
    const target = [...free].sort(byLayoffOrder(w, org, idleDays))[0];
    if (!target) return;
    speak(ctx, 'cfo', `${eur(cash)} en caisse, moins de ${cashDays} jours de frais, et ${eur(margin)} de marge par jour pour ${eur(costs)} de frais, ${org.lossDays} soirs de suite.`, 'org');
    await requestDeparture(ctx, target.id, `licenciement, ${eur(cash)} en caisse et ${eur(margin)} de marge par jour pour ${eur(costs)} de frais`, hr, 'layoff');
    org.lossDays = 0;
    return;
  }
  const idle = idleDuplicate(w, org, free);
  if (!idle) return;
  const util = pct(utilisation(w, org, idle, idleDays), 0);
  speak(ctx, 'cfo', `${eur(payOf(idle) * 30)} de salaire par mois pour ${idle.role}, ${util} d'occupation sur ${idleDays} jours.`, 'org');
  await requestDeparture(ctx, idle.id, `licenciement, ${util} d'occupation sur ${idleDays} jours sur un rôle tenu à plusieurs`, hr, 'layoff');
}

/** Runs each evening, after the hire logic. Lean teams only: the legacy team stays as it is, notes included. */
export async function layoffsEvening(ctx: RuntimeCtx): Promise<void> {
  const w = ctx.world;
  const org = w.company.org;
  if (!org || isLegacyOrg(w)) return;
  if (w.day === 1) await writeMissingNotes(ctx);
  settleNotices(ctx, org);
  if (w.scenario.org?.autoHire) await layoffs(ctx, org);
  if (w.day % 7 === 0) await writeWeekNote(ctx);
}
