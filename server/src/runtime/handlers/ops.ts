/** Analyse, Finance, RH and Direction rituals: daily report, A/B experiments, CFO budget, the books, retro, HR review, follow-up. */
import type { Experiment, Product } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';
import { addDeliverable, incident, nameOf, say, writeNote } from '../ctx.js';
import { learning, sim } from '../modules.js';
import { reconcileDay, recordPnl, weeklyPnl } from '../accounting.js';
import { versionSince } from '../acquisition.js';
import { activeCampaigns, computeBudget, priceCeiling, productMetrics } from '../metrics.js';
import { createTask, isOpen } from '../tasks.js';
import { followFounderMissions, unblockStaleTasks } from '../missions.js';
import { officerId } from '../org/officers.js';
import { PRICE_ARMS } from '../playbook.js';
import { dec, eur, numOf, pad3, pct, short } from '../util.js';
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

/** A measured value this far below what the test concluded means the answer has gone stale. */
export const EXPERIMENT_DRIFT_RATIO = 0.6;
/** The last days of a settled test's variants, read again to see if the answer still holds. */
const DRIFT_WINDOW_DAYS = 7;
/** A test cancelled for lack of traffic may run again after this many days. */
const CANCELLED_RETRY_DAYS = 7;

/** Is the answer of a finished test still good? Only a new version of the guide or a strong drift reopens it. */
function stillSettled(ctx: RuntimeCtx, e: Experiment, product: Product | undefined): boolean {
  const w = ctx.world;
  const end = e.endDay ?? e.day;
  if (e.status === 'cancelled') return w.day - end < CANCELLED_RETRY_DAYS;
  if (product && versionSince(w, product) > end) return false;
  const ranked = Object.entries(e.results).sort((a, b) => b[1].value - a[1].value);
  const best = e.winner ?? ranked[0]?.[0];
  const concluded = best ? e.results[best] : undefined;
  if (!best || !concluded || concluded.value <= 0 || w.day - end < DRIFT_WINDOW_DAYS) return true;
  const now = learning.computeExperimentResults(w, { ...e, day: w.day - DRIFT_WINDOW_DAYS })[best];
  return !now || now.n < concluded.n * 0.5 || now.value >= concluded.value * EXPERIMENT_DRIFT_RATIO;
}

/** Same dimension, same variants, same niche: running, or already answered and still valid. */
function alreadyAnswered(ctx: RuntimeCtx, dimension: Experiment['dimension'], variants: string[], nicheId: string | null, product?: Product): boolean {
  const key = [...variants].sort().join('|');
  return ctx.world.company.experiments.some((e) => e.dimension === dimension && [...e.variants].sort().join('|') === key
    && (e.nicheId ?? null) === nicheId && (e.status === 'running' || stillSettled(ctx, e, product)));
}

/** Which experiment is worth starting now (one variable at a time, enough arms in play, never a settled question). */
export function experimentCandidate(ctx: RuntimeCtx): Omit<Experiment, 'id' | 'status' | 'results' | 'winner' | 'endDay' | 'owner' | 'day'> | null {
  const live = ctx.world.company.products.filter((p) => p.status === 'live');
  for (const p of live) {
    const name = p.title.length > 50 ? `${p.title.slice(0, 49)}…` : p.title;
    const scope = { nicheId: p.nicheId, productId: p.id };
    // Ads, formats and prices are measured on paid traffic: without a campaign, nothing would be learned.
    if (!activeCampaigns(ctx.world, p.id).length) continue;
    if (!running(ctx, 'hook_style')) {
      const arms = learning.armStats(ctx.world, `hook_style:${p.nicheId}`).filter((a) => a.pulls > 0);
      const v = arms.slice(0, 2).map((a) => a.key);
      if (arms.length >= 2 && !alreadyAnswered(ctx, 'hook_style', v, p.nicheId, p)) {
        return { ...scope, hypothesis: `Sur « ${name} », le hook ${HOOK_LABELS[v[0]!] ?? v[0]} bat le hook ${HOOK_LABELS[v[1]!] ?? v[1]} en CTR`, dimension: 'hook_style', variants: v, metric: 'ctr' };
      }
    }
    if (!running(ctx, 'ad_format')) {
      const arms = learning.armStats(ctx.world, `ad_format:${p.nicheId}`).filter((a) => a.pulls > 0);
      const v = arms.slice(0, 2).map((a) => a.key);
      if (arms.length >= 2 && !alreadyAnswered(ctx, 'ad_format', v, p.nicheId, p)) {
        return { ...scope, hypothesis: `Sur « ${name} », le format ${FORMAT_LABELS[v[0]!] ?? v[0]} bat ${FORMAT_LABELS[v[1]!] ?? v[1]} en CTR`, dimension: 'ad_format', variants: v, metric: 'ctr' };
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
      if (other !== cur && (down || Number(other) <= priceCeiling(ctx.world, p).ceiling) && !alreadyAnswered(ctx, 'price', [cur, other], p.nicheId, p)) {
        return { ...scope, hypothesis: `« ${name} » rapporte plus par visiteur à ${other} € qu'à ${cur} €`, dimension: 'price', variants: [cur, other], metric: 'roas' };
      }
    }
  }
  if (!running(ctx, 'support_tone')) {
    const arms = learning.armStats(ctx.world, 'support_tone').filter((a) => a.pulls > 0);
    const v = arms.slice(0, 2).map((a) => a.key);
    if (arms.length >= 2 && arms.reduce((s, a) => s + a.pulls, 0) >= 6 && !alreadyAnswered(ctx, 'support_tone', v, null)) {
      return { nicheId: null, hypothesis: `Un ton ${v[0]} résout mieux les tickets qu'un ton ${v[1]}`, dimension: 'support_tone', variants: v, metric: 'resolution' };
    }
  }
  return null;
}

/**
 * A test only measures variants that run. When it starts, a variant without a live creative gets one: new hooks,
 * the creatives of the missing variants, added to the running campaign. (Before, a test only observed the ads that
 * happened to exist: two tests out of three ended with n = 0 on an arm.)
 */
export function orderVariantCreatives(ctx: RuntimeCtx, e: Experiment): number {
  if ((e.dimension !== 'hook_style' && e.dimension !== 'ad_format') || !e.productId) return 0;
  const w = ctx.world;
  const product = w.company.products.find((p) => p.id === e.productId);
  if (!product) return 0;
  const running = activeCampaigns(w, product.id);
  const liveIds = new Set(running.flatMap((c) => c.creativeIds));
  const live = w.company.creatives.filter((c) => liveIds.has(c.id));
  const covered = new Set(live.map((c) => (e.dimension === 'hook_style' ? c.hookStyle : c.format)));
  const missing = e.variants.filter((v) => !covered.has(v as never));
  if (!missing.length || w.company.tasks.some((t) => isOpen(t) && t.kind === 'write_ad_hooks' && t.input.experimentId === e.id)) return 0;
  createTask(w, {
    kind: 'write_ad_hooks', title: `Créas du test A/B (${missing.join(', ')}) — « ${product.title.slice(0, 40)} »`,
    input: { productId: product.id, nicheId: product.nicheId, produce: missing.length, experimentId: e.id, experimentVariants: missing, ...(running[0] ? { attachTo: running[0].id } : { launch: true }) },
    createdBy: e.owner, priority: 2,
  });
  return missing.length;
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
      // An outage day says nothing about the ads: facts only, no reading of the day's numbers.
      let memo = sim.isAnnouncedOutage(ctx.world, day)
        ? `Jour ${day} : panne de paiement annoncée, aucune vente possible. ${kpi.adSpend > 0 ? `${eur(kpi.adSpend)} de pub dépensés pendant la panne` : 'Pubs en pause, aucune dépense pub'}, trésorerie ${eur(kpi.cash)}. Ce jour ne dit rien de nos pubs, de nos prix ni de nos guides.`
        : '';
      if (!memo) try { memo = (await ctx.engine.dailyMemo({ day, kpi, notes }, mind)).trim(); } catch { memo = ''; }
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
        const ordered = orderVariantCreatives(ctx, started);
        say(ctx, agent.id, `${agent.name} lance un test A/B : « ${started.hypothesis} »${ordered ? ` (${ordered} créa(s) à produire pour les variantes sans pub)` : ''}`, 'thought');
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
      const runway = b.runwayDays === null ? 'dernière semaine sans perte' : `${b.runwayDays} jours de runway`;
      say(ctx, agent.id, b.outage
        ? `${agent.name} met l'enveloppe pub du jour à ${eur(0)} : panne de paiement annoncée, aucune vente possible (trésorerie ${eur(b.cash)})`
        : `${agent.name} fixe l'enveloppe pub du jour : ${eur(b.adCap)} (${Math.round(b.rate * 100)} % de ${eur(b.cash)}, ${runway})`, 'finance');
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
        : b.outage ? `Panne de paiement annoncée aujourd'hui : enveloppe à 0, campagnes en pause jusqu'à demain.`
        : b.survival
          ? `Mode survie : trésorerie ${eur(b.cash)} sous 30 % du départ, pubs non rentables coupées.`
          : `${Math.round(b.rate * 100)} % de ${eur(b.cash)} — ${runway}.`;
      ctx.world.company.budget = { day: ctx.world.day, adCap: b.adCap, survival: b.survival, note };
      return {
        summary: `Enveloppe pub ${eur(b.adCap)}${b.survival ? ' — mode survie' : ''} ; trésorerie ${eur(b.cash)}, ${runway}.`,
        output: { adCap: b.adCap, survival: b.survival, cash: b.cash, runwayDays: b.runwayDays, rate: b.rate, bankrupt: b.bankrupt, outage: b.outage },
      };
    },
  },

  reconcile_ledger: {
    async run(ctx, task, agent) {
      const day = Math.min(sim.lastClosedDay(ctx.world), Math.max(1, Math.round(numOf(task.input.day) ?? sim.lastClosedDay(ctx.world))));
      const r = reconcileDay(ctx.world, day);
      for (const gap of r.gaps.slice(0, 3)) incident(ctx, `Écart comptable du jour ${day} : ${gap}`);
      if (r.gaps.length) say(ctx, agent.id, `${agent.name} signale ${r.gaps.length} écart(s) au grand livre du jour ${day} : ${short(r.gaps[0]!, 90)}`, 'finance', undefined, { toAgentId: officerId(ctx.world, 'cfo') });
      else say(ctx, agent.id, `${agent.name} rapproche le jour ${day} : ${r.entries} écritures, ${r.checks} contrôles, aucun écart (résultat ${eur(r.net)})`, 'finance');
      return {
        summary: `Jour ${day} : ${eur(r.revenue)} de ventes, ${eur(r.refunds)} remboursés, ${eur(r.adSpend)} de pub, ${eur(r.fees + r.fixed + r.creators)} de frais, résultat ${eur(r.net)}${r.gaps.length ? ` — ${r.gaps.length} écart(s)` : ', aucun écart'}.`,
        output: { ...r },
      };
    },
  },

  weekly_pnl: {
    async run(ctx, task, agent) {
      const toDay = sim.lastClosedDay(ctx.world);
      const fromDay = Math.max(1, toDay - 6);
      const report = weeklyPnl(ctx.world, fromDay, toDay);
      recordPnl(ctx.world, report);
      const losers = report.products.filter((p) => p.profit < 0);
      const roas = (v: number | null) => (v === null ? '—' : dec(v));
      const path = `finance/pnl-semaine-${pad3(report.week)}.md`;
      await writeNote(ctx, agent.id, {
        path, title: `P&L — semaine ${report.week}`, tags: ['finance', 'pnl'],
        body: [
          `> Jours ${fromDay} à ${toDay} : résultat ${eur(report.total)}, dont ${eur(report.unallocated)} de coûts communs (boutique, outils, calcul).`,
          '',
          '| Produit | Ventes | CA | Remboursé | Pub | Frais | Créateurs | Profit | ROAS |',
          '|---|---|---|---|---|---|---|---|---|',
          ...report.products.map((p) => `| ${p.title} | ${p.sales} | ${eur(p.revenue)} | ${eur(p.refunds)} | ${eur(p.adSpend)} | ${eur(p.fees)} | ${eur(p.creators)} | ${eur(p.profit)} | ${roas(p.roas)} |`),
          '',
          ...(losers.length ? ['## À arbitrer', ...losers.map((p) => `- « ${p.title} » perd ${eur(-p.profit)} sur la période.`), ''] : []),
          'Liens : [[Playbook Finance]] · [[Objectifs]]',
        ].join('\n'),
      });
      addDeliverable(ctx, { kind: 'report', title: `P&L de la semaine ${report.week}`, productId: null, creativeId: null, path: `brain/${path}`, createdBy: agent.id, quality: null }, task);
      const best = report.products[0];
      say(ctx, agent.id, `${agent.name} boucle le P&L de la semaine ${report.week} : résultat ${eur(report.total)}${best ? `, meilleur produit « ${short(best.title, 40)} » (${eur(best.profit)})` : ''}${losers.length ? `, ${losers.length} en perte` : ''}`, 'finance', undefined, { toAgentId: officerId(ctx.world, 'cfo') });
      for (const p of losers.slice(0, 3)) incident(ctx, `P&L semaine ${report.week} : « ${p.title} » perd ${eur(-p.profit)} (ROAS ${roas(p.roas)})`);
      return {
        summary: `P&L semaine ${report.week} : résultat ${eur(report.total)}, ${report.products.length} produit(s), ${losers.length} en perte.`,
        output: { week: report.week, fromDay, toDay, total: report.total, losers: losers.map((p) => p.productId), path: `brain/${path}` },
      };
    },
  },

  follow_missions: {
    async run(ctx, task, agent) {
      const missions = followFounderMissions(ctx, agent);
      const unblocked = unblockStaleTasks(ctx, agent);
      for (const l of unblocked.slice(0, 3)) say(ctx, agent.id, l, 'thought');
      for (const l of missions.slice(0, 2)) say(ctx, agent.id, `${agent.name} suit : ${short(l, 150)}`, 'thought');
      return {
        summary: missions.length || unblocked.length ? `${missions.length} mission(s) du fondateur suivie(s), ${unblocked.length} tâche(s) relancée(s).` : 'Aucune mission du fondateur ouverte, aucune tâche en retard.',
        skipReview: true,
        output: { missions, unblocked },
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
