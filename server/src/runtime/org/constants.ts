/** The org pillar's numbers (org §5). sim/balance.ts stays frozen: each pillar keeps its own. */
import type { ModelTier, OrgConfig, WorldState } from '../../shared.js';
import { round2 } from '../../core/index.js';

export const LEGACY_ORG: OrgConfig = { team: 'legacy31', autoHire: false, payroll: false };
export const LEAN_ORG: OrgConfig = { team: 'lean', autoHire: true, payroll: true };

/** An absent `scenario.org` is an older save, which is the legacy team (§2.8). */
export function isLegacyOrg(w: WorldState): boolean {
  return (w.scenario.org ?? LEGACY_ORG).team === 'legacy31';
}

export const ORG = {
  workTicksPerDay: 9, maxHeadcount: 60,
  payPerDay: { haiku: 0.375, sonnet: 0.6, opus: 0.9 } as Record<ModelTier, number>,
  levelRaise: 0.03, recruitingDays: 7, severanceDays: 7, survivalPayCut: 0.5,
  hatSpeed: 0.67, rampDays: 3, rampSpeed: 0.6,
  windowDays: 7, reliefPerDay: 12, ownerUtil: 0.7, pressureDays: 3, hireCooldownDays: 3,
  reserveDays: 30, marginCover: 1.15, cashRouteDays: 120, revPerHeadPayMultiple: 3, adReserveDays: 7,
  layoff: { cashDays: 21, lossDays: 5, idleUtil: 0.2, idleDays: 14, cooldownDays: 3 },
} as const;

/** A contract at level 1, to the cent: what the ledger books, and so what anyone quotes. */
export const payOfTier = (tier: ModelTier): number => round2(ORG.payPerDay[tier]);
