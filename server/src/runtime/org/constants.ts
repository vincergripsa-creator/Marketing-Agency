/** The org pillar's numbers (org §5). sim/balance.ts stays frozen: each pillar keeps its own. */
import type { ModelTier, OrgConfig } from '../../shared.js';

export const LEGACY_ORG: OrgConfig = { team: 'legacy31', autoHire: false, payroll: false };
export const LEAN_ORG: OrgConfig = { team: 'lean', autoHire: true, payroll: true };

export const ORG = {
  workTicksPerDay: 9, maxHeadcount: 60,
  payPerDay: { haiku: 0.5, sonnet: 0.8, opus: 1.2 } as Record<ModelTier, number>,
  levelRaise: 0.03, recruitingDays: 7, severanceDays: 7, survivalPayCut: 0.5,
  hatSpeed: 0.67, rampDays: 3, rampSpeed: 0.6,
  windowDays: 7, reliefPerDay: 12, ownerUtil: 0.7, pressureDays: 3, hireCooldownDays: 3,
  reserveDays: 30, marginCover: 1.15, cashRouteDays: 120, revPerHeadPayMultiple: 3, adReserveDays: 7,
  layoff: { cashDays: 21, lossDays: 5, idleUtil: 0.2, idleDays: 14, cooldownDays: 3 },
} as const;
