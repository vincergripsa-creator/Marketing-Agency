/**
 * Who waited, who worked (org §9). Everything sits in `company.org.load`, last 14 days, so a reload reads what a straight
 * run read. The founder's latency counts nowhere: he is not a reason to hire.
 */
import type { AgentId, ChannelId, KindLoadDay, RoleId, RolePressure, TaskKind, WorldState } from '../../shared.js';
import { sameAccount } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';
import { openChannels } from '../channels.js';
import type { Worked } from '../pillars.js';
import { depState } from '../tasks.js';
import { round2 } from '../util.js';
import { OFFICES, REVIEW_OFFICE, ROLES } from './catalog.js';
import { isLegacyOrg, ORG } from './constants.js';
import { ownersOfAny, roleHolders } from './officers.js';

const KEPT_DAYS = 14;

const add = (row: Partial<Record<TaskKind, number>>, kind: TaskKind, n = 1): void => {
  row[kind] = (row[kind] ?? 0) + n;
};

/** Today's row, opened on the first tick that has something to say. */
export function loadToday(w: WorldState): KindLoadDay {
  const load = w.company.org!.load;
  const last = load[load.length - 1];
  if (last?.day === w.day) return last;
  const row: KindLoadDay = { day: w.day, wait: {}, reviewWait: {}, work: {}, busy: {}, headcount: w.company.agents.length, payroll: 0 };
  load.push(row);
  if (load.length > KEPT_DAYS) load.splice(0, load.length - KEPT_DAYS);
  return row;
}

export function recordLoad(ctx: RuntimeCtx, worked: Worked[]): void {
  const w = ctx.world;
  if (isLegacyOrg(w) || !w.company.org) return;
  const row = loadToday(w);
  row.headcount = w.company.agents.length;
  const busy = new Set<AgentId>(); // a reviewer can read three tasks in a tick: one tick all the same
  for (const { agentId, kind, review } of worked) {
    busy.add(agentId);
    if (!review) add(row.work, kind);
  }
  for (const id of busy) row.busy[id] = (row.busy[id] ?? 0) + 1;
  for (const t of w.company.tasks) {
    if (t.status === 'review') add(row.reviewWait, t.kind);
    else if (t.status === 'pending' && depState(w, t) === 'ready') add(row.wait, t.kind);
  }
}

/** The kinds a role's hire would relieve, each with the task-ticks it waited over the window. */
function roleWaits(role: RoleId, rows: readonly KindLoadDay[]): { kind: TaskKind; ticks: number }[] {
  const ticks = (read: (r: KindLoadDay) => number): number => rows.reduce((s, r) => s + read(r), 0);
  const core = ROLES[role].core.map((kind) => ({ kind, ticks: ticks((r) => r.wait[kind] ?? 0) }));
  const reviewed = (Object.keys(REVIEW_OFFICE) as TaskKind[])
    .filter((kind) => OFFICES[REVIEW_OFFICE[kind]!].roles.includes(role))
    .map((kind) => ({ kind, ticks: ticks((r) => r.reviewWait[kind] ?? 0) }));
  return [...core, ...reviewed];
}

/** A role the agency could fill today: it has kinds, a free seat and, for a media buyer, a channel to buy on. */
function fillable(w: WorldState, role: RoleId, channels: readonly ChannelId[]): boolean {
  const def = ROLES[role];
  return def.core.length > 0 && roleHolders(w, role).length < def.seats && (!def.channel || channels.some((ch) => sameAccount(ch, def.channel!)));
}

/** Each evening: what a hire would relieve, per role, how busy the owners are, and for how many evenings in a row both hold. */
export function refreshPressure(w: WorldState): RolePressure[] {
  const org = w.company.org!;
  const rows = org.load.slice(-ORG.windowDays);
  const days = Math.max(1, rows.length);
  const held = new Map(org.pressure.map((p) => [p.roleId, p.days]));
  const channels = openChannels(w);
  const pressure: RolePressure[] = [];
  for (const role of Object.keys(ROLES) as RoleId[]) {
    if (!fillable(w, role, channels)) continue;
    const relief = roleWaits(role, rows).reduce((s, k) => s + k.ticks, 0) / days;
    const owners = ownersOfAny(w, ROLES[role].core);
    const worked = owners.reduce((s, a) => s + rows.reduce((t, r) => t + (r.busy[a.id] ?? 0), 0), 0);
    const ownerUtil = owners.length ? worked / owners.length / (ORG.workTicksPerDay * days) : 0;
    const on = relief >= ORG.reliefPerDay && ownerUtil >= ORG.ownerUtil;
    if (relief > 0 || on) pressure.push({ roleId: role, relief: round2(relief), ownerUtil: round2(ownerUtil), days: on ? (held.get(role) ?? 0) + 1 : 0 });
  }
  org.pressure = pressure;
  return pressure;
}

/** Relief per euro, among the roles that held for 3 evenings. It sends juniors in before leads, as a founder short of cash would. Ties: role id. */
export function pickRole(w: WorldState): RolePressure | null {
  const worth = (p: RolePressure): number => p.relief / ORG.payPerDay[ROLES[p.roleId].tier];
  const ready = (w.company.org?.pressure ?? []).filter((p) => p.days >= ORG.pressureDays);
  return [...ready].sort((a, b) => worth(b) - worth(a) || a.roleId.localeCompare(b.roleId))[0] ?? null;
}

/** What Nora quotes: the kind that waited most, and the busiest of its owners. */
export function whoIsWaiting(w: WorldState, role: RoleId): { kind: TaskKind; owner: AgentId | null } {
  const rows = w.company.org!.load.slice(-ORG.windowDays);
  const worked = (id: AgentId): number => rows.reduce((s, r) => s + (r.busy[id] ?? 0), 0);
  const [top] = roleWaits(role, rows).sort((a, b) => b.ticks - a.ticks);
  const [owner] = ownersOfAny(w, ROLES[role].core).sort((a, b) => worked(b.id) - worked(a.id) || a.id.localeCompare(b.id));
  return { kind: top!.kind, owner: owner?.id ?? null };
}
