/** The org pillar: the hooks of §2.5, wired once. Each body lands in its own file. */
import { incident } from '../ctx.js';
import type { Pillar } from '../pillars.js';
import { layoffsEvening } from './departure.js';
import { headcountEvening, recruitRefused } from './hiring.js';
import { recordLoad } from './load.js';
import { bookPayroll } from './payroll.js';
import { auditOrg, legacyOrgState, reconcileOrg } from './reconcile.js';

export const orgPillar: Pillar = {
  mount(w) {
    w.company.org ??= legacyOrgState(w);
    if (w.scenario.org?.team === 'lean') reconcileOrg(w);
  },
  worked: recordLoad,
  marketClosed: bookPayroll,
  async evening(ctx) {
    await headcountEvening(ctx);
    await layoffsEvening(ctx);
    const broken = auditOrg(ctx.world);
    if (ctx.world.company.org) ctx.world.company.org.stats.violations += broken.length;
    for (const line of broken) incident(ctx, line);
  },
  refused(ctx, task) {
    if (task.kind === 'recruit') recruitRefused(ctx, task);
  },
};
