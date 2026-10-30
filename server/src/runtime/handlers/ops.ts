/** Analyse, Finance, RH and Direction rituals: daily report, A/B experiments, CFO budget, retro, HR review. */
import type { Experiment } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';
import { addDeliverable, incident, nameOf, say, writeNote } from '../ctx.js';
import { learning } from '../modules.js';
import { computeBudget, productMetrics } from '../metrics.js';
import { PRICE_ARMS } from '../playbook.js';
import { dec, eur, numOf, pad3, pct } from '../util.js';
import type { HandlerMap } from './common.js';
import { HOOK_LABELS, FORMAT_LABELS } from './phrases.js';

function running(ctx: RuntimeCtx, dimension: Experiment['dimension']): Experiment | undefined {
  return ctx.world.company.experiments.find((e) => e.status === 'running' && e.dimension === dimension);
}

/** A price test needs this many sales of the product first; a product is re-tested at most every PRICE_RETEST_DAYS days. */
export const PRICE_TEST_MIN_SALES = 10;
export const PRICE_RETEST_DAYS = 12;
/** Paid conversion (purchases / landing views, 7 days) under which the next price test goes one tier down. */
export const PRICE_TEST_LOW_CVR = 0.015;

/** Same dimension and same variants tested recently (running, or concluded less than 10 days ago). */
function recentlyTested(ctx: RuntimeCtx, dimension: Experiment['dimension'], variants: string[]): boolean {
  const key = [...variants].sort().join('|');
  return ctx.world.company.experiments.some((e) => e.dimension === dimension && [...e.variants].sort().join('|') === key
    && (e.status === 'running' || (e.endDay ?? e.day) >= ctx.world.day - 10));
}

/** Which experiment is worth starting now (one variable at a time, enough arms in play, not re-testing a fresh answer). */
export function experimentCandidate(ctx: RuntimeCtx): Omit<Experiment, 'id' | 'status' | 'results' | 'winner' | 'endDay' | 'owner' | 'day'> | null {
  const live = ctx.world.company.products.filter((p) => p.status === 'live');
  for (const p of live) {
    const name = p.title.length > 50 ? `${p.title.slice(0, 49)}…` : p.title;
    if (!running(ctx, 'hook_style')) {
      const arms = learning.armStats(ctx.world, `hook_style:${p.nicheId}`).filter((a) => a.pulls > 0);
      const v = arms.slice(0, 2).map((a) => a.key);
      if (arms.length >= 2 && !recentlyTested(ctx, 'hook_style', v)) {
        return { hypothesis: `Sur « ${name} », le hook ${HOOK_LABELS[v[0]!] ?? v[0]} bat le hook ${HOOK_LABELS[v[1]!] ?? v[1]} en CTR`, dimension: 'hook_style', variants: v, metric: 'ctr' };
      }
    }
    if (!running(ctx, 'ad_format')) {
      const arms = learning.armStats(ctx.world, `ad_format:${p.nicheId}`).filter((a) => a.pulls > 0);
      const v = arms.slice(0, 2).map((a) => a.key);
      if (arms.length >= 2 && !recentlyTested(ctx, 'ad_format', v)) {
        return { hypothesis: `Sur « ${name} », le format ${FORMAT_LABELS[v[0]!] ?? v[0]} bat ${FORMAT_LABELS[v[1]!] ?? v[1]} en CTR`, dimension: 'ad_format', variants: v, metric: 'ctr' };
      }
    }
    const lastPriceTest = Math.max(0, ...ctx.world.company.experiments.filter((e) => e.dimension === 'price' && e.hypothesis.includes(name)).map((e) => e.endDay ?? ctx.world.day));
    if (!running(ctx, 'price') && p.stats.sales >= PRICE_TEST_MIN_SALES && (lastPriceTest === 0 || ctx.world.day - lastPriceTest >= PRICE_RETEST_DAYS)) {
      const cur = PRICE_ARMS.find((a) => Number(a) >= p.price) ?? PRICE_ARMS[PRICE_ARMS.length - 1]!;
      const i = PRICE_ARMS.indexOf(cur);
      // Direction from what buyers do: a paid conversion below PRICE_TEST_LOW_CVR says "too expensive" → test one
      // tier lower; otherwise test one tier higher. (Before, only raises were ever tested, so a guide launched
      // above what its buyers pay could never learn to come down.)
      const m7 = productMetrics(ctx.world, p.id, Math.max(1, ctx.world.day - 6));
      const cvr = m7.landingViews > 0 ? m7.adPurchases / m7.landingViews : null;
      const down = cvr !== null && m7.landingViews >= 120 && cvr < PRICE_TEST_LOW_CVR;
      const other = PRICE_ARMS[down ? Math.max(0, i - 1) : Math.min(PRICE_ARMS.length - 1, i + 1)]!;
      if (other !== cur && !recentlyTested(ctx, 'price', [cur, other])) {
        return { hypothesis: `« ${name} » rapporte plus par visiteur à ${other} € qu'à ${cur} €`, dimension: 'price', variants: [cur, other], metric: 'roas' };
      }
    }
  }
  if (!running(ctx, 'support_tone')) {
    const arms = learning.armStats(ctx.world, 'support_tone').filter((a) => a.pulls > 0);
    const v = arms.slice(0, 2).map((a) => a.key);
    if (arms.length >= 2 && arms.reduce((s, a) => s + a.pulls, 0) >= 6 && !recentlyTested(ctx, 'support_tone', v)) {
      return { hypothesis: `Un ton ${v[0]} résout mieux les tickets qu'un ton ${v[1]}`, dimension: 'support_tone', variants: v, metric: 'resolution' };
    }
  }
  return null;
}

export const opsHandlers: HandlerMap = {
  daily_report: {
    async run(ctx, task, agent, mind) {
      const day = Math.max(1, Math.round(numOf(task.input.day) ?? ctx.world.day - 1));
      const kpi = ctx.world.company.kpis.find((k) => k.day === day) ?? learning.computeDailyKpi(ctx.world, day);
      const notes = [...ctx.lastMarketNotes];
      const live = ctx.world.company.products.filter((p) => p.status === 'live');
      for (const p of live) {
        const m = productMetrics(ctx.world, p.id, Math.max(1, day - 6));
        notes.push(`« ${p.title} » sur 7 jours : ${m.sales} ventes, ${eur(m.revenue)}, pub ${eur(m.spend)}, ROAS ${Number.isFinite(m.roas) ? dec(m.roas) : '∞'}, remboursements ${pct(m.refundRate)}`);
      }
      let memo = '';
      try { memo = (await ctx.engine.dailyMemo({ day, kpi, notes }, mind)).trim(); } catch { memo = ''; }
      if (!memo) memo = `Jour ${day} : ${kpi.sales} ventes, ${eur(kpi.revenue)} de chiffre d'affaires pour ${eur(kpi.adSpend)} de pub (ROAS ${dec(kpi.roas)}), trésorerie ${eur(kpi.cash)}.`;
      const path = `journal/jour-${pad3(day)}.md`;
      const body = [
        `## Rapport d'analyse (${agent.name}, matin du jour ${ctx.world.day})`,
        '',
        memo,
        '',
        '| Indicateur | Valeur |', '|---|---|',
        `| Ventes | ${kpi.sales} |`, `| Chiffre d'affaires | ${eur(kpi.revenue)} |`, `| Dépense pub | ${eur(kpi.adSpend)} |`,
        `| ROAS | ${dec(kpi.roas)} |`, `| CTR | ${pct(kpi.ctr, 2)} |`, `| Conversion page | ${pct(kpi.cvr, 2)} |`, `| CAC | ${eur(kpi.cac)} |`,
        `| Profit cumulé | ${eur(kpi.cumulativeProfit)} |`, `| Trésorerie | ${eur(kpi.cash)} |`, `| Tickets ouverts | ${kpi.openTickets} |`,
        '',
        ...(notes.length ? ['### Notes du marché', ...notes.slice(0, 10).map((n) => `- ${n}`), ''] : []),
        'Liens : [[Objectifs]] · [[Playbook Analyse]]',
      ].join('\n');
      let exists = false;
      try { exists = !!(await ctx.brain.read(path)); } catch { exists = false; }
      if (exists) {
        try {
          await ctx.brain.append(path, `\n${body}\n`, ctx.world.day);
          say(ctx, agent.id, `${agent.name} ajoute son rapport au journal du jour ${day}`, 'brain_write');
        } catch { await writeNote(ctx, agent.id, { path: `journal/rapport-${pad3(day)}.md`, title: `Rapport du jour ${day}`, tags: ['journal', 'rapport'], body }); }
      } else {
        await writeNote(ctx, agent.id, { path, title: `Journal — jour ${day}`, tags: ['journal', 'rapport'], body });
      }
      addDeliverable(ctx, { kind: 'report', title: `Rapport du jour ${day}`, productId: null, creativeId: null, path: `brain/${path}`, createdBy: agent.id, quality: null }, task);
      say(ctx, agent.id, `${agent.name} : ${memo.length > 140 ? `${memo.slice(0, 139)}…` : memo}`);
      return { summary: `Rapport du jour ${day} : ${kpi.sales} ventes, ROAS ${dec(kpi.roas)}.`, output: { day, memo } };
    },
  },

  run_experiment: {
    async run(ctx, task, agent) {
      const lines: string[] = [];
      for (const e of ctx.world.company.experiments.filter((x) => x.status === 'running')) {
        const res = Object.entries(e.results).map(([k, r]) => `${k} n=${r.n}`).join(', ');
        lines.push(`En cours : « ${e.hypothesis} » (${res || 'pas encore de données'})`);
      }
      const cand = ctx.world.company.experiments.filter((e) => e.status === 'running').length < 2 ? experimentCandidate(ctx) : null;
      let started: Experiment | null = null;
      if (cand) {
        started = learning.startExperiment(ctx.world, { ...cand, day: ctx.world.day, owner: agent.id });
        say(ctx, agent.id, `${agent.name} lance un test A/B : « ${started.hypothesis} »`, 'thought');
        lines.push(`Nouvelle expérience : ${started.hypothesis}`);
      }
      if (!lines.length) return { summary: 'Pas encore assez de données pour un test A/B propre.', skipReview: true, output: { started: null } };
      return { summary: lines.join(' · '), output: { started: started?.id ?? null, running: ctx.world.company.experiments.filter((e) => e.status === 'running').length } };
    },
  },

  budget_review: {
    async run(ctx, task, agent) {
      const prev = [...ctx.world.company.tasks].reverse().find((t) => t.kind === 'budget_review' && t.status === 'done' && t.id !== task.id)?.output ?? null;
      const b = computeBudget(ctx.world);
      const runway = b.runwayDays === null ? 'rentable sur 7 jours' : `${b.runwayDays} jours de runway`;
      say(ctx, agent.id, `${agent.name} fixe l'enveloppe pub du jour : ${eur(b.adCap)} (${Math.round(b.rate * 100)} % de ${eur(b.cash)}, ${runway})`, 'finance');
      if (b.survival && prev?.survival !== true) {
        incident(ctx, `Mode survie déclenché : trésorerie ${eur(b.cash)} < 30 % du budget de départ`);
        say(ctx, agent.id, `${agent.name} déclenche le MODE SURVIE : pubs non rentables coupées, organique et commission uniquement`, 'finance');
      } else if (!b.survival && prev?.survival === true) {
        say(ctx, agent.id, `${agent.name} lève le mode survie : la trésorerie est remontée à ${eur(b.cash)}`, 'finance');
      }
      if (b.rate < 0.15 && !b.survival) incident(ctx, `Runway sous 14 jours : enveloppe pub réduite à 8 % de la trésorerie`);
      // The CFO's envelope of the day, shown by the UI (Finance tab).
      const note = b.bankrupt
        ? `Trésorerie négative (${eur(b.cash)}) : aucune dépense pub.`
        : b.survival
          ? `Mode survie : trésorerie ${eur(b.cash)} sous 30 % du départ, pubs non rentables coupées.`
          : `${Math.round(b.rate * 100)} % de ${eur(b.cash)} — ${runway}.`;
      ctx.world.company.budget = { day: ctx.world.day, adCap: b.adCap, survival: b.survival, note };
      return {
        summary: `Enveloppe pub ${eur(b.adCap)}${b.survival ? ' — mode survie' : ''} ; trésorerie ${eur(b.cash)}, ${runway}.`,
        output: { adCap: b.adCap, survival: b.survival, cash: b.cash, runwayDays: b.runwayDays, rate: b.rate, bankrupt: b.bankrupt },
      };
    },
  },

  retro: {
    async run(ctx, task, agent) {
      const lessons = await learning.runRetro(ctx.world, ctx.engine, ctx.brain, [...ctx.incidents]);
      return { summary: `Rétro : ${lessons.length} nouvelle(s) leçon(s).`, output: { lessons: lessons.map((l) => l.id) } };
    },
  },

  performance_review: {
    async run(ctx, task, agent) {
      const lines = await learning.performanceReview(ctx.world, ctx.brain);
      for (const l of lines.slice(0, 4)) say(ctx, agent.id, l, 'thought');
      return { summary: lines[0] ?? 'Revue RH effectuée.', output: { lines } };
    },
  },

  plan_day: {
    async run(ctx, task, agent) {
      const open = ctx.world.company.tasks.filter((t) => ['pending', 'in_progress', 'review'].includes(t.status)).length;
      return { summary: `${nameOf(ctx, agent.id)} fait le point : ${open} tâche(s) ouvertes.`, output: { open } };
    },
  },
};
