/** The org pillar: the hooks of §2.5, wired once. Each body lands in its own file. */
import type { RuntimeCtx } from '../ctx.js';
import { incident, nameOf, say } from '../ctx.js';
import type { Pillar } from '../pillars.js';
import { KIND_META } from '../tasks.js';
import { layoffRefused, layoffsEvening } from './departure.js';
import { headcountEvening, recruitRefused } from './hiring.js';
import { recordLoad } from './load.js';
import { officerId } from './officers.js';
import { bookPayroll, payrollToday } from './payroll.js';
import { auditOrg, lastResortHats, legacyOrgState, reconcileOrg, salaryBroken } from './reconcile.js';

/** The evening hook runs after the retro and the morning wipes the list: only the feed reaches a human. */
function alert(ctx: RuntimeCtx, line: string): void {
  incident(ctx, line);
  say(ctx, officerId(ctx.world, 'hr'), line, 'org');
}

function report(ctx: RuntimeCtx, broken: string[]): void {
  if (ctx.world.company.org) ctx.world.company.org.stats.violations += broken.length;
  for (const line of broken) alert(ctx, line);
}

export const orgPillar: Pillar = {
  mount(w) {
    w.company.org ??= legacyOrgState(w);
    if (w.scenario.org?.team === 'lean') reconcileOrg(w);
  },
  worked: recordLoad,
  marketClosed(ctx) {
    const due = payrollToday(ctx.world);
    bookPayroll(ctx);
    const broken = salaryBroken(ctx.world, due);
    if (broken) report(ctx, [broken]);
  },
  async evening(ctx) {
    await headcountEvening(ctx);
    await layoffsEvening(ctx);
    report(ctx, auditOrg(ctx.world));
    for (const k of lastResortHats(ctx.world)) alert(ctx, `${nameOf(ctx, officerId(ctx.world, 'ceo'))} porte « ${KIND_META[k].label} » en dernier recours : plus personne pour le faire`);
  },
  refused(ctx, task) {
    if (task.kind === 'recruit') recruitRefused(ctx, task);
    if (task.kind === 'league_review') layoffRefused(ctx, task);
  },
};
