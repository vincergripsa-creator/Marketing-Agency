/** The role catalog (org §3, §4). Stub until P1.1: the 31 of the roster are the only candidates, no table is filled. */
import type { AgentDef, AgentId, ChannelId, DeptId, ModelTier, Office, OrgConfig, RoleId, TaskKind } from '../../shared.js';
import { AGENTS } from '../roster.js';

export interface RoleDef { title: string; dept: DeptId; tier: ModelTier; core: TaskKind[]; assist: TaskKind[]; seats: number; lead: boolean; channel?: ChannelId }

export const CANDIDATES: Record<AgentId, AgentDef & { legacyDept?: DeptId }> = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
export const ROLES = {} as Record<RoleId, RoleDef>;
export const KIND_HATS = {} as Record<TaskKind, readonly RoleId[]>;
export const OFFICES = {} as Record<Office, { roles: readonly RoleId[]; kind: TaskKind }>;
export const REVIEW_OFFICE: Partial<Record<TaskKind, Office>> = {};

export function buildTeam(_cfg: OrgConfig): AgentDef[] {
  return AGENTS;
}
