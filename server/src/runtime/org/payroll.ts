/** Salaries (org §5): one ledger line a day at the close. When cash runs out the founders give up their pay first. */
import type { AgentState, ScenarioConfig, WorldState } from '../../shared.js';
import { round2 } from '../../core/index.js';
import { FEES, MIN_BUDGET_DAYS, minStartingCash } from '../../sim/balance.js';
import { speak, type RuntimeCtx } from '../ctx.js';
import { sim } from '../modules.js';
import { eur, sum } from '../util.js';
import { buildTeam } from './catalog.js';
import { LEGACY_ORG, ORG } from './constants.js';
import { logOrgDecision } from './hiring.js';
import { officerId } from './officers.js';

/** Share of the starting cash under which the company is in survival: the CFO's budget and the founders' pay read this one line. */
export const SURVIVAL_CASH = 0.3;

export function payOf(a: AgentState): number {
  return round2(ORG.payPerDay[a.tier] * (1 + ORG.levelRaise * (a.level - 1)));
}

function payrollOn(w: WorldState): boolean {
  return (w.scenario.org ?? LEGACY_ORG).payroll;
}

/** What the founders take of their pay today: half in survival, nothing while bankrupt. Hires keep their contract. */
function founderShare(w: WorldState): number {
  if (w.status === 'bankrupt') return 0;
  return sim.financeSnapshot(w).cash < SURVIVAL_CASH * Math.max(1, w.scenario.startingCash) ? ORG.survivalPayCut : 1;
}

function payrollAt(w: WorldState, share: number): number {
  return round2(sum(w.company.agents.map((a) => payOf(a) * (a.founder ? share : 1))));
}

export function payrollToday(w: WorldState): number {
  return payrollOn(w) ? payrollAt(w, founderShare(w)) : 0;
}

/** The founders' share moved since the last close: one decision, one line, never one a day. */
function notePayCut(ctx: RuntimeCtx, share: number, payroll: number): void {
  const w = ctx.world;
  const org = w.company.org;
  if (!org) return;
  const last = org.decisions.findLast((d) => d.kind === 'pay_cut')?.numbers.share ?? 1;
  if (share === last) return;
  const cash = sim.financeSnapshot(w).cash;
  const floor = round2(SURVIVAL_CASH * Math.max(1, w.scenario.startingCash));
  const text = share === 0 ? 'faillite, les fondateurs ne se versent plus de salaire'
    : share === 1 ? `trésorerie revenue à ${eur(cash)}, les fondateurs reprennent leur plein salaire`
    : `trésorerie à ${eur(cash)}, sous le seuil de ${eur(floor)} : les fondateurs passent à ${Math.round(share * 100)} % de leur salaire`;
  logOrgDecision(w, { kind: 'pay_cut', roleId: null, agentId: officerId(w, 'cfo'), text, numbers: { share, cash, floor, payroll } });
  speak(ctx, 'cfo', text, 'org');
}

/** Same daily accrual as FEES.boutiqueDaily. The ref guards the line: a close replayed after a reload books nothing. */
export function bookPayroll(ctx: RuntimeCtx): void {
  const w = ctx.world;
  if (!payrollOn(w)) return;
  const ref = `payroll:${w.day}`;
  if (w.ledger.some((e) => e.ref === ref)) return;
  const share = founderShare(w);
  const payroll = payrollAt(w, share);
  notePayCut(ctx, share, payroll);
  sim.recordLedger(w, { type: 'salary', amount: -payroll, memo: `Salaires du jour (${w.company.agents.length} agents)`, ref });
  const load = w.company.org?.load.at(-1);
  if (load?.day === w.day) load.payroll = payroll;
}

/** Launch costs plus MIN_BUDGET_DAYS of fixed costs and founders' pay, rounded up to the next 10 €. Unpaid agents keep the old floor. */
export function minRunCash(s: Pick<ScenarioConfig, 'org'>): number {
  const org = s.org ?? LEGACY_ORG;
  if (!org.payroll) return minStartingCash();
  const foundersPay = sum(buildTeam(org).filter((a) => a.founder).map((a) => ORG.payPerDay[a.tier]));
  return Math.ceil((FEES.setupCost + MIN_BUDGET_DAYS * (FEES.boutiqueDaily + FEES.toolsDaily + foundersPay)) / 10) * 10;
}
