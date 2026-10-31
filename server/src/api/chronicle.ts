/**
 * The chronicle (ui §2.1 bis): what the company went through, merged from the logs each pillar already keeps. It is a pure read,
 * so there is no fourth log to keep in step, and every fact has one stable `key`: a replay, a reload or a dropped frame stages
 * nothing twice. A pillar that has no state yields nothing.
 */
import type { AgentId, AvatarSpec, ChannelId, ChronicleEntry, ChronicleKind, Duel, OrgDecision, PersonCard, WorldState } from '../shared.js';
import { CHANNEL_IDS, CHANNELS } from '../shared.js';
import { ROLES } from '../runtime/org/catalog.js';
import { DEPARTMENTS } from '../runtime/roster.js';
import { STAGE_LABELS, STAGES } from '../runtime/stages.js';
import { TALENT } from '../runtime/talent/constants.js';
import { pct, uniq } from '../runtime/util.js';

const NOBODY: AvatarSpec = { skin: '#b8b8b8', hair: '#8a8a8a', shirt: '#9a9a9a', pants: '#6a6a6a', hairStyle: 4, accessory: 'none' };

export type PeopleIndex = Map<AgentId, PersonCard>;

/** Everyone the company ever paid, those who left included: an old line never prints a raw id. */
export function peopleIndex(w: WorldState): PeopleIndex {
  const out: PeopleIndex = new Map();
  for (const a of w.company.org?.alumni ?? []) out.set(a.id, { id: a.id, name: a.name, role: ROLES[a.roleId]?.title ?? '', dept: a.dept, avatar: a.avatar });
  for (const a of w.company.agents ?? []) out.set(a.id, { id: a.id, name: a.name, role: a.role, dept: a.dept, avatar: a.avatar });
  return out;
}

export function cardOf(people: PeopleIndex, id: AgentId): PersonCard {
  return people.get(id) ?? { id, name: id, role: '', dept: 'direction', avatar: NOBODY };
}

const nameIn = (people: PeopleIndex, id: AgentId): string => cardOf(people, id).name;

/** Who won a settled duel, null on a draw: the same band as the line the growth lead reads out. */
export function duelWinner(d: Duel): AgentId | null {
  const s = d.result?.s;
  if (s === undefined) return null;
  const { drawAbove, drawBelow } = TALENT.duel;
  return s > drawAbove && s < drawBelow ? null : s >= 0.5 ? d.agents[0] : d.agents[1];
}

const ORG_KINDS: Partial<Record<OrgDecision['kind'], ChronicleKind>> = { hire: 'hire', leave: 'fire', layoff: 'layoff', chief: 'promote', dept_open: 'dept_open', dept_close: 'dept_close' };

function orgEntries(w: WorldState, people: PeopleIndex): ChronicleEntry[] {
  const org = w.company.org;
  const league = w.company.league;
  const whyOf = (d: OrgDecision): string | undefined => {
    if (d.kind === 'hire') return league?.hires.find((h) => h.hired === d.agentId)?.reason ?? org?.positions.find((p) => p.hiredId === d.agentId)?.detail;
    if (d.kind === 'leave' || d.kind === 'layoff') return (d.agentId ? league?.entries[d.agentId]?.leftBecause : null) ?? org?.alumni.find((a) => a.id === d.agentId)?.reason;
    return undefined;
  };
  return (org?.decisions ?? []).flatMap((d): ChronicleEntry[] => {
    const kind = ORG_KINDS[d.kind];
    if (!kind) return [];
    const why = whyOf(d);
    const person = d.agentId ? people.get(d.agentId) : undefined;
    return [{ key: `org:${d.id}`, day: d.day, kind, text: d.text, ...(why ? { why } : {}), agentId: d.agentId, ...(person ? { person, dept: person.dept } : {}), numbers: d.numbers }];
  });
}

function positionEntries(w: WorldState, people: PeopleIndex): ChronicleEntry[] {
  return (w.company.org?.positions ?? []).flatMap((p): ChronicleEntry[] => {
    const { title, dept } = ROLES[p.roleId];
    const opened: ChronicleEntry = { key: `req:${p.id}:open`, day: p.openedDay, kind: 'req_open', text: `Poste ouvert : ${title}`, why: p.detail, agentId: p.replaces, dept };
    if (p.status !== 'filled' || !p.hiredId) return [opened];
    return [opened, { key: `req:${p.id}:filled`, day: p.closedDay ?? p.openedDay, kind: 'req_filled', text: `Poste pourvu : ${title}, ${nameIn(people, p.hiredId)}`, agentId: p.hiredId, dept }];
  });
}

/** Nobody logs a department: it opens with its first member and closes with its last, and those two dates outlive every log. */
function deptEntries(w: WorldState): ChronicleEntry[] {
  const org = w.company.org;
  if (!org) return [];
  const stays = [
    ...w.company.agents.map((a) => ({ dept: a.dept, from: a.hiredDay, to: Number.POSITIVE_INFINITY })),
    ...org.alumni.map((a) => ({ dept: a.dept, from: a.hiredDay, to: a.leftDay })),
  ];
  return DEPARTMENTS.filter((d) => d.id !== 'direction').flatMap((d) => {
    const own = stays.filter((s) => s.dept === d.id);
    const sizeAt = (day: number): number => own.filter((s) => s.from <= day && s.to > day).length;
    const days = uniq(own.flatMap((s) => [s.from, s.to])).filter((day) => day > 0 && Number.isFinite(day)).sort((a, b) => a - b);
    let size = sizeAt(0);
    return days.flatMap((day): ChronicleEntry[] => {
      const before = size;
      size = sizeAt(day);
      if ((before > 0) === (size > 0)) return [];
      const opens = size > 0;
      return [{ key: `dept:${d.id}:${opens ? 'open' : 'close'}:${day}`, day, kind: opens ? 'dept_open' : 'dept_close', text: `${d.name} ${opens ? 'ouvre' : 'ferme'}`, dept: d.id }];
    });
  });
}

/** A probation lives in `league.plans`, opened at the close of its season. */
function planEntries(w: WorldState, people: PeopleIndex): ChronicleEntry[] {
  const league = w.company.league;
  return (league?.plans ?? []).filter((p) => p.outcome === 'open').map((p) => {
    const day = league!.seasons.find((s) => s.season === p.openedSeason)?.toDay ?? p.deadlineDay - TALENT.plan.days;
    return { key: `plan:${p.agentId}:${p.openedSeason}`, day, kind: 'probation', text: `${nameIn(people, p.agentId)} entre en plan d'amélioration`, why: p.text, agentId: p.agentId, dept: people.get(p.agentId)?.dept ?? null };
  });
}

/** Formal duels only: the natural ones are read off the ads every day, and they would drown everything else. */
function duelEntries(w: WorldState, people: PeopleIndex): ChronicleEntry[] {
  return (w.company.league?.duels ?? []).filter((d) => d.kind === 'formal' && (d.status === 'running' || d.status === 'settled')).flatMap((d): ChronicleEntry[] => {
    const [a, b] = d.agents;
    const label = `${nameIn(people, a)} contre ${nameIn(people, b)}`;
    const opened: ChronicleEntry = { key: `duel:${d.id}:open`, day: d.startDay, kind: 'duel_open', text: `Duel : ${label}`, agentId: a, otherId: b };
    if (d.status !== 'settled' || !d.result) return [opened];
    const winner = duelWinner(d);
    const { ctr, delta } = d.result;
    return [opened, {
      key: `duel:${d.id}:end`, day: d.endDay ?? d.startDay, kind: 'duel_end', agentId: a, otherId: b,
      text: winner ? `${nameIn(people, winner)} gagne son duel (${label})` : `Match nul : ${label}`,
      why: `CTR ${pct(ctr[0])} contre ${pct(ctr[1])}`, numbers: { ratingDeltaA: delta, ratingDeltaB: -delta },
    }];
  });
}

function seasonEntries(w: WorldState): ChronicleEntry[] {
  return (w.company.league?.seasons ?? []).map((s) => ({
    key: `season:${s.season}`, day: s.toDay, kind: 'season_end', text: `Fin de la saison ${s.season}`, agentId: s.employee?.agentId ?? null,
    why: `${s.employee ? `${s.employee.name} finit en tête, ` : ''}${s.probations.length} plan(s) ouvert(s), ${s.hires.length} remplacement(s)`, numbers: { season: s.season },
  }));
}

/** A shared account stops two channels and names both: the line is one fact, filed under the first. */
const channelIn = (text: string): ChannelId | undefined => CHANNEL_IDS.find((ch) => text.includes(CHANNELS[ch].label));

/** The decision log says what moved, in the words the digest reads too. Each stage move ends on the label it reaches. */
function growthEntries(w: WorldState): ChronicleEntry[] {
  return (w.company.growth?.decisions ?? []).flatMap((d): ChronicleEntry[] => {
    if (d.kind === 'channel') {
      const channel = channelIn(d.text) ?? null;
      return [{ key: `channel:${d.id}`, day: d.day, kind: d.text.endsWith(' ouvert') ? 'channel_open' : 'channel_close', text: d.text, why: d.why, channel }];
    }
    if (d.kind !== 'stage') return [];
    const to = STAGES.findIndex((s) => d.text.endsWith(STAGE_LABELS[s]));
    const from = STAGES.findIndex((s) => d.text.includes(`étape ${STAGE_LABELS[s]} pour`));
    return [{ key: `stage:${d.id}`, day: d.day, kind: to >= from ? 'stage_up' : 'stage_down', text: d.text, why: d.why, numbers: { stage: to } }];
  });
}

/** TikTok's account predates the others: it has its own event, and its title names no channel. */
function banEntries(w: WorldState): ChronicleEntry[] {
  return (w.market?.events ?? []).flatMap((e): ChronicleEntry[] => {
    const tiktok = e.kind === 'ad_account_banned';
    if (!tiktok && e.kind !== 'channel_account_banned') return [];
    return [{ key: `ban:${e.id}`, day: e.day, kind: 'channel_close', text: tiktok ? `Compte ${CHANNELS.tiktok.label} suspendu` : e.title, why: e.description, channel: tiktok ? 'tiktok' : channelIn(e.title) ?? null }];
  });
}

/** Merges the pillars' logs, oldest first. Pure. */
export function chronicleOf(world: WorldState, fromDay = 0): ChronicleEntry[] {
  const people = peopleIndex(world);
  const all = [
    ...orgEntries(world, people), ...positionEntries(world, people), ...deptEntries(world), ...planEntries(world, people),
    ...duelEntries(world, people), ...seasonEntries(world), ...growthEntries(world), ...banEntries(world),
  ];
  return all.filter((e) => e.day >= fromDay).sort((a, b) => a.day - b.day);
}
