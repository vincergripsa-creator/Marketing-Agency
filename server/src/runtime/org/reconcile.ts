/**
 * The organisation derives itself from who is alive (org §7, §8): hats, open departments, chiefs, offices, where open work
 * sits. Nothing here is a decision kept for later, so a hire, a departure and a reload all run the same code and nothing
 * can drift. No draw, no id.
 */
import type { AgentId, AgentState, DeptDef, DeptId, Office, OrgState, TaskKind, WorldState } from '../../shared.js';
import { round2 } from '../../core/index.js';
import { activeCampaigns } from '../metrics.js';
import { DEPARTMENTS } from '../roster.js';
import { ALL_KINDS, chiefOf, fixSelfReview, KIND_META, openTasks } from '../tasks.js';
import { uniq } from '../util.js';
import { KIND_HATS, OFFICES, ROLES } from './catalog.js';
import { isLegacyOrg, ORG } from './constants.js';
import { LEGACY_OFFICES, reviewerFor, roleHolders } from './officers.js';

const OFFICE_IDS = Object.keys(OFFICES) as Office[];

/** The rules of the lean company. A hand-built test world has no org to read, and stands for the legacy team. */
export function isLean(w: WorldState): boolean {
  return !!w.company.org && !isLegacyOrg(w);
}

/** Who steps up when a post falls vacant: a lead role, then the record, then seniority. The id settles it. */
function byStanding(a: AgentState, b: AgentState): number {
  return Number(ROLES[b.roleId].lead) - Number(ROLES[a.roleId].lead) || b.perf.score - a.perf.score || b.level - a.level || a.hiredDay - b.hiredDay || a.id.localeCompare(b.id);
}

/** Who carries a closed department: whoever now holds its first kind. No kind homed there: the Direction. */
function hostOf(w: WorldState, dept: DeptId): DeptId {
  const first = ALL_KINDS.find((k) => KIND_META[k].dept === dept);
  return w.company.agents.find((a) => first && a.taskKinds.includes(first))?.dept ?? 'direction';
}

/** The current holder stays for as long as they own the kind: a reload must not move an office because scores moved. */
function officeHolder(w: WorldState, o: Office, current: AgentId): AgentId | undefined {
  const { roles, kind } = OFFICES[o];
  const holder = roles.flatMap((r) => roleHolders(w, r))[0];
  if (holder) return holder.id;
  const owners = w.company.agents.filter((a) => a.taskKinds.includes(kind));
  return (owners.find((a) => a.id === current) ?? [...owners].sort(byStanding)[0])?.id;
}

/** Every step reads only what the steps before it wrote, so a second pass finds nothing to do (org test 3). */
export function reconcileOrg(w: WorldState): void {
  const org = (w.company.org ??= legacyOrgState(w));
  const { agents } = w.company;
  if (!agents.length) return;

  // Kinds, then hats: a kind nobody holds goes to the first living role of its table, else to the CEO.
  for (const a of agents) {
    a.taskKinds = [...ROLES[a.roleId].core, ...ROLES[a.roleId].assist];
    a.hatKinds = [];
  }
  const lastResort = roleHolders(w, 'ceo')[0] ?? agents[0]!;
  for (const kind of ALL_KINDS) {
    if (agents.some((a) => a.taskKinds.includes(kind))) continue;
    const wearer = KIND_HATS[kind].flatMap((r) => roleHolders(w, r))[0] ?? lastResort;
    wearer.taskKinds.push(kind);
    wearer.hatKinds.push(kind);
  }
  // Other departments only: the agent's own is already theirs wherever hatDepts is read.
  for (const a of agents) a.hatDepts = uniq(a.hatKinds.map((k) => KIND_META[k].dept)).filter((d) => d !== a.dept);
  org.stats.lastResortHats = Math.max(org.stats.lastResortHats, lastResortHats(w).length);

  // Departments open and close with their members. They keep their DeptDef, `deskHigh` included, in both lists.
  const known = new Map([...org.closedDepts, ...w.company.departments].map((d) => [d.id, d]));
  const open = new Set<DeptId>(['direction', ...agents.map((a) => a.dept)]);
  const defOf = (d: DeptDef): DeptDef => known.get(d.id) ?? { ...d, grid: { ...d.grid } };
  w.company.departments = DEPARTMENTS.filter((d) => open.has(d.id)).map(defOf);
  org.closedDepts = DEPARTMENTS.filter((d) => !open.has(d.id)).map(defOf);
  org.deptHost = {};
  for (const d of org.closedDepts) org.deptHost[d.id] = hostOf(w, d.id);

  // Chiefs stay while they are there.
  for (const d of w.company.departments) {
    const members = agents.filter((a) => a.dept === d.id);
    if (members.some((a) => a.id === d.chiefId)) continue;
    const best = [...members].sort(byStanding)[0];
    if (best) d.chiefId = best.id;
  }
  for (const a of agents) a.isChief = w.company.departments.some((d) => d.chiefId === a.id);

  for (const o of OFFICE_IDS) org.offices[o] = officeHolder(w, o, org.offices[o]) ?? lastResort.id;

  // Open work follows: unfinished work goes back to the pool, a task in review or before the founder is finished and stays there.
  const alive = new Set(agents.map((a) => a.id));
  for (const t of openTasks(w)) {
    t.dept = deptFor(w, t.kind);
    if (t.assignee && !alive.has(t.assignee)) {
      t.assignee = null;
      if (t.status === 'in_progress') t.status = 'pending';
    }
    if (t.reviewer && !alive.has(t.reviewer)) t.reviewer = reviewerFor(w, t.kind);
    fixSelfReview(w, t);
  }
  for (const m of w.company.missions) {
    if (m.status !== 'open' || alive.has(m.ownerId)) continue;
    const dept = org.alumni.find((a) => a.id === m.ownerId)?.dept;
    m.ownerId = (dept ? chiefOf(w, dept)?.id : undefined) ?? org.offices.ceo;
  }
}

/** Kinds worn by someone their hat table does not name: the CEO's last resort, an incident while it lasts. */
export function lastResortHats(w: WorldState): TaskKind[] {
  return w.company.agents.flatMap((a) => a.hatKinds.filter((k) => !KIND_HATS[k].includes(a.roleId)));
}

/** The invariants of org §7, in French for the incident list. I6 is read at the close (`salaryBroken`): by the evening a level or a layoff has moved the sum. I8's brain note is not in the world. */
export function auditOrg(w: WorldState): string[] {
  const org = w.company.org;
  if (!org || !isLean(w)) return [];
  const { agents, departments } = w.company;
  const broken: string[] = [];
  const alive = new Set(agents.map((a) => a.id));
  const open = new Set(departments.map((d) => d.id));

  for (const k of ALL_KINDS) if (!agents.some((a) => a.taskKinds.includes(k))) broken.push(`Organisation : personne ne sait faire « ${KIND_META[k].label} »`);
  for (const o of OFFICE_IDS) if (!alive.has(org.offices[o])) broken.push(`Organisation : le titulaire de « ${KIND_META[OFFICES[o].kind].label} » est absent (${org.offices[o]})`);
  for (const d of departments) {
    const members = agents.filter((a) => a.dept === d.id);
    const chiefs = members.filter((a) => a.isChief);
    if (!members.length) broken.push(`Organisation : ${d.name} est ouvert sans personne dedans`);
    else if (chiefs.length !== 1 || chiefs[0]!.id !== d.chiefId) broken.push(`Organisation : ${d.name} compte ${chiefs.length} chef(s), sa fiche nomme ${d.chiefId}`);
  }
  for (const a of agents) if (!open.has(a.dept)) broken.push(`Organisation : ${a.name} travaille dans un département fermé (${a.dept})`);
  for (const t of openTasks(w)) {
    if (t.assignee && !alive.has(t.assignee)) broken.push(`Organisation : « ${t.title} » est confiée à quelqu'un d'absent (${t.assignee})`);
    if (t.reviewer && !alive.has(t.reviewer)) broken.push(`Organisation : « ${t.title} » attend un relecteur absent (${t.reviewer})`);
    if (t.assignee && t.assignee === t.reviewer) broken.push(`Organisation : ${t.assignee} relit sa propre tâche « ${t.title} »`);
  }
  if (agents.length > ORG.maxHeadcount) broken.push(`Organisation : ${agents.length} personnes, le plafond est ${ORG.maxHeadcount}`);
  for (const r of uniq(agents.map((a) => a.roleId))) {
    const held = roleHolders(w, r).length;
    if (held > ROLES[r].seats) broken.push(`Organisation : ${held} personnes sur ${ROLES[r].seats} place(s) de ${ROLES[r].title}`);
  }
  for (const a of agents) if (!w.company.playbooks[a.id]) broken.push(`Organisation : ${a.name} n'a pas de playbook`);
  const names = [...agents, ...org.alumni].map((a) => a.name);
  for (const name of uniq(names.filter((n, i) => names.indexOf(n) !== i))) broken.push(`Organisation : deux personnes s'appellent ${name}`);
  return broken;
}

/** I6: what the close booked against what it owed. Null when they agree, or when this team is not paid. */
export function salaryBroken(w: WorldState, due: number): string | null {
  if (!w.scenario.org?.payroll) return null;
  const ref = `payroll:${w.day}`;
  const booked = round2(w.ledger.reduce((sum, e) => (e.ref === ref ? sum + e.amount : sum), 0));
  return booked === -round2(due) ? null : `Organisation : salaires du jour ${w.day} à ${booked} € au grand livre pour ${due} € dus`;
}

/** What a new world starts from, and what a save from before the org pillar stands for: the legacy offices, nothing open, nothing owed. */
export function legacyOrgState(w: WorldState): OrgState {
  return {
    offices: { ...LEGACY_OFFICES }, deptHost: {},
    closedDepts: DEPARTMENTS.filter((d) => !w.company.departments.some((x) => x.id === d.id)).map((d) => ({ ...d, grid: { ...d.grid } })),
    load: [], pressure: [], positions: [], decisions: [], alumni: [],
    lastHireDay: 0, lastLayoffDay: 0, lossDays: 0,
    stats: { hires: 0, departures: 0, layoffs: 0, lastResortHats: 0, violations: 0 },
  };
}

export function fitOf(a: AgentState, kind: TaskKind): 'core' | 'assist' | 'hat' {
  if (a.hatKinds.includes(kind)) return 'hat';
  return ROLES[a.roleId].assist.includes(kind) ? 'assist' : 'core';
}

/** Work a tick buys: a hat is slower, a hire finds their feet. 1 on the legacy team, which wears nothing and hires nobody. */
export function speedFor(w: WorldState, a: AgentState, kind: TaskKind): number {
  const hat = a.hatKinds.includes(kind) ? ORG.hatSpeed : 1;
  const ramp = w.day <= a.rampUntilDay ? ORG.rampSpeed : 1;
  return hat * ramp;
}

/** The back office grows with the business, or a 40-person company would have the books of an 8-person one (org §8). */
export function workFor(w: WorldState, kind: TaskKind): number {
  if (!isLean(w)) return KIND_META[kind].work;
  switch (kind) {
    case 'optimize_ads': return 1 + Math.floor(activeCampaigns(w).length / 4);
    case 'daily_report': return 1 + Math.floor(w.company.products.filter((p) => p.status === 'live').length / 6);
    case 'reconcile_ledger': return 1 + Math.floor(w.market.orders.filter((o) => o.day === w.day - 1).length / 40);
    default: return KIND_META[kind].work;
  }
}

/** A task's home, or the department carrying it while its own is closed. */
export function deptFor(w: WorldState, kind: TaskKind): DeptId {
  const home = KIND_META[kind].dept;
  return w.company.org?.deptHost[home] ?? home;
}
