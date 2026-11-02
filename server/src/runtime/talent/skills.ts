/** Who has talent in what (talent §3, D11, D12, D14). A kind with no skill has no talent behind it: its work reads as today. */
import type { AgentId, AgentState, RoleId, Skill, TaskKind, WorldState } from '../../shared.js';
import { ROLES } from '../org/catalog.js';

/** This order keys the talent stream: a skill added later goes last. */
export const SKILLS: readonly Skill[] = ['copy', 'video', 'longform', 'polish', 'page', 'design', 'buying', 'research', 'support'];

/** `produce_ad` stays `copy`: the video skill of a `produce_ad` is read by `planCut` itself, through `effectiveT` (D12). */
export const KIND_SKILL: Partial<Record<TaskKind, Skill>> = {
  write_ad_hooks: 'copy', produce_ad: 'copy', post_organic: 'copy', write_search_ads: 'copy',
  adapt_creative: 'video',
  write_titles: 'longform', write_outline: 'longform', write_pdf: 'longform',
  humanize_pdf: 'polish',
  write_sales_page: 'page',
  design_cover: 'design', render_pdf: 'design',
  launch_campaign: 'buying', optimize_ads: 'buying',
  scan_trends: 'research', pick_opportunity: 'research',
  reply_inbox: 'support', handle_refund: 'support',
};

export function skillOf(kind: TaskKind): Skill | null {
  return KIND_SKILL[kind] ?? null;
}

const skillsIn = (kinds: readonly TaskKind[]): Skill[] => [...new Set(kinds.flatMap((k) => KIND_SKILL[k] ?? []))];

/** The skills a role was hired for, core and assist. Every other skill draws at `offRoleMean`: that is what a hat costs (D15). */
export function roleSkills(role: RoleId): Skill[] {
  const { core, assist } = ROLES[role];
  return skillsIn([...core, ...assist]);
}

/** The kinds whose work reaches a skill's rating (§5.2). A hook has `copy` for a skill, and no row of evidence reads it: the ad does. */
const EVIDENCE_KINDS: Record<Skill, readonly TaskKind[]> = {
  copy: ['produce_ad'], video: ['produce_ad'], longform: ['write_pdf'], polish: ['humanize_pdf'], page: ['write_sales_page'],
  design: ['render_pdf'], buying: ['launch_campaign'], research: ['pick_opportunity'], support: ['reply_inbox'],
};

/**
 * The skill of the first core kind with an evidence route in this role, core or assist: the hook writer's ads are read, the
 * Head of Growth, who writes no ad, is read on their campaigns. A role no route reaches keeps its first skill, unrated, and
 * still sits that test when hired (D16). Never a hat: Zoé wearing `produce_ad` is not judged on `copy` (D14).
 */
export function primaryOf(role: RoleId): Skill | null {
  const { core, assist } = ROLES[role];
  const own = new Set<TaskKind>([...core, ...assist]);
  const skills = skillsIn(core);
  return skills.find((skill) => EVIDENCE_KINDS[skill].some((k) => own.has(k))) ?? skills[0] ?? null;
}

export function primarySkill(w: WorldState, id: AgentId): Skill | null {
  const a = w.company.agents.find((x) => x.id === id);
  return a ? primaryOf(a.roleId) : null;
}

/** What someone really works on, hats included: practice moves these (§4.10). */
export function skillsUsed(a: AgentState): Skill[] {
  return skillsIn(a.taskKinds);
}

/** Who a league can judge. No core kind has a skill for the CEO, so the CEO is out by construction (D13), like HR or finance. */
export function leagueSeats(w: WorldState): AgentState[] {
  return w.company.agents.filter((a) => primaryOf(a.roleId) !== null);
}

/** The people judged on one skill. */
export function familyOf(w: WorldState, skill: Skill): AgentState[] {
  return w.company.agents.filter((a) => primaryOf(a.roleId) === skill);
}
