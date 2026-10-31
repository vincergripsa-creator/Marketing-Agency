/**
 * What an agent can tell the founder in the chat: one fact per line, without sentence breaks inside a line. The
 * heuristic mind picks the lines that answer the question (by their prefix), Claude reads them all. Only observable
 * data: the books, the public events, the market notes of the last close, the company's own tasks.
 */
import type { AgentState, DailyKpi, DeptId } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { learning, sim } from './modules.js';
import { productPnls } from './accounting.js';
import { activeHolds } from './holds.js';
import { activeCampaigns, currentBudget } from './metrics.js';
import { founderMissionLines } from './missions.js';
import { isOpen, openTasks, taskById } from './tasks.js';
import { dec, eur, round2, short, sum, uniq } from './util.js';
import { FORMAT_LABELS, HOOK_LABELS } from './handlers/phrases.js';

function oneLine(text: string): string {
  return text.replace(/[.;!?]+\s+/g, ', ').replace(/\s+/g, ' ').replace(/[.;!?,\s]+$/, '').trim();
}

/** KPIs of the closed days before `day`, outage days left out: the reference a bad day is compared to. */
function usualRoas(ctx: RuntimeCtx, day: number): number | null {
  const w = ctx.world;
  const rows = w.company.kpis.filter((k) => k.day < day && k.day >= day - 7 && !sim.isAnnouncedOutage(w, k.day));
  const spend = sum(rows.map((k) => k.adSpend));
  return spend > 0 ? sum(rows.map((k) => k.revenue)) / spend : null;
}

/** Why the last closed day looks the way it does: the outage first, then events, ads, refunds, costs. */
function causeLines(ctx: RuntimeCtx, kpi: DailyKpi): string[] {
  const w = ctx.world;
  const day = kpi.day;
  const out: string[] = [];
  const entries = w.ledger.filter((e) => e.day === day);
  const refunds = -sum(entries.filter((e) => ['refund', 'chargeback', 'discount', 'scam_loss'].includes(e.type)).map((e) => e.amount));
  const costs = -sum(entries.filter((e) => ['platform_fee', 'tool_subscription', 'compute', 'payment_fee', 'salary', 'recruiting'].includes(e.type) && !(e.ref ?? '').startsWith('hold:')).map((e) => e.amount));
  const outage = sim.isAnnouncedOutage(w, day);
  if (outage) out.push(`Cause d'hier : panne de paiement du jour ${day}, annoncée par le prestataire, aucune vente possible ce jour-là, ${kpi.adSpend > 0 ? `${eur(kpi.adSpend)} de pub perdus` : 'pubs en pause donc aucune dépense pub'}`);
  for (const e of w.market.events) {
    if (e.day !== day || e.kind === 'platform_outage' || (e.severity !== 'warn' && e.severity !== 'danger')) continue;
    out.push(`Cause d'hier : ${oneLine(e.title)}`);
  }
  if (!outage && kpi.adSpend > 0) {
    const usual = usualRoas(ctx, day);
    const versus = usual !== null ? ` contre ${dec(usual)} les 7 jours d'avant` : '';
    if (kpi.roas < 1) out.push(`Cause d'hier : pub non rentable, ${eur(kpi.adSpend)} dépensés pour ${eur(kpi.revenue)} de CA, ROAS ${dec(kpi.roas)}${versus}`);
    else if (usual !== null && kpi.roas < usual * 0.7) out.push(`Cause d'hier : ROAS en baisse, ${dec(kpi.roas)}${versus}`);
  }
  if (refunds > 0) out.push(`Cause d'hier : ${kpi.refunds} remboursement(s) pour ${eur(refunds)}`);
  if (!outage && kpi.adSpend === 0 && kpi.sales === 0) out.push(kpi.liveProducts ? `Cause d'hier : aucune pub active et aucune vente organique` : `Cause d'hier : aucun produit en ligne, rien à vendre`);
  if (entries.some((e) => e.ref === 'setup')) out.push(`Cause d'hier : frais de démarrage de la boutique payés ce jour-là`);
  if (kpi.profit < 0 && !out.length) out.push(`Cause d'hier : ${eur(costs)} de frais fixes pour ${eur(kpi.revenue)} de CA`);
  if (kpi.profit >= 0) return [`Cause d'hier : pas de perte sur la journée, ${eur(kpi.profit)} de résultat avec ${kpi.sales} ventes pour ${eur(kpi.revenue)} de CA${kpi.adSpend > 0 ? `, ROAS ${dec(kpi.roas)}` : ''}`];
  return out.slice(0, 3);
}

/** The product that earned the most over the last 7 closed days, with the numbers that say why. */
function bestProductLine(ctx: RuntimeCtx): string | null {
  const w = ctx.world;
  if (!w.company.kpis.length) return null;
  const to = sim.lastClosedDay(w);
  const { products } = productPnls(w, Math.max(1, to - 6), to);
  const top = products[0];
  if (!top) return null;
  if (top.sales === 0) return `Meilleur produit sur 7 jours : aucun, pas une seule vente sur la période`;
  const product = w.company.products.find((p) => p.id === top.productId);
  const second = products[1];
  const facts = [
    `${top.sales} ventes`, `${eur(top.revenue)} de CA`, `${eur(top.refunds)} remboursés`, `${eur(top.adSpend)} de pub`,
    ...(top.roas !== null ? [`ROAS ${dec(top.roas)}`] : []),
    ...(product?.stats.rating ? [`note ${dec(product.stats.rating, 1)}/5`] : []),
  ];
  return `Meilleur produit sur 7 jours : « ${short(top.title, 60)} » avec ${eur(top.profit)} de profit (${facts.join(', ')})${second ? `, devant « ${short(second.title, 40)} » à ${eur(second.profit)}` : ''}`;
}

const totals = (rows: readonly DailyKpi[]) => ({ sales: sum(rows.map((k) => k.sales)), revenue: sum(rows.map((k) => k.revenue)), adSpend: sum(rows.map((k) => k.adSpend)), profit: sum(rows.map((k) => k.profit)) });

/** The last 7 closed days as one total, and how they compare with the 7 before. */
function weekLines(ctx: RuntimeCtx): string[] {
  const { kpis } = ctx.world.company;
  if (!kpis.length) return [];
  const to = kpis[kpis.length - 1]!.day;
  const week = totals(kpis.filter((k) => k.day > to - 7));
  const before = kpis.filter((k) => k.day > to - 14 && k.day <= to - 7);
  const lines = [`Semaine : sur les 7 derniers jours, ${week.sales} ventes, ${eur(week.revenue)} de CA, ${eur(week.adSpend)} de pub, résultat ${eur(round2(week.profit))}`];
  if (before.length) {
    const prev = totals(before);
    lines.push(`Tendance : CA de ${eur(week.revenue)} sur 7 jours contre ${eur(prev.revenue)} les 7 jours d'avant, ${week.sales} ventes contre ${prev.sales}, pub ${eur(week.adSpend)} contre ${eur(prev.adSpend)}`);
  }
  return lines;
}

/** Each product by name: why it was stopped and on which day, or how it stands. */
function productLines(ctx: RuntimeCtx): string[] {
  const w = ctx.world;
  const lines = w.company.products.flatMap((p) => {
    const niche = w.company.research.trends.find((t) => t.nicheId === p.nicheId)?.name ?? p.nicheId;
    const name = p.title === niche ? `« ${short(p.title, 60)} »` : `« ${short(p.title, 60)} » (${short(niche, 40)})`;
    if (p.decision && p.decision.status === p.status) return [`Décision produit : ${name} ${p.status === 'killed' ? 'arrêté' : 'mis en pause'} le jour ${p.decision.day}, ${short(oneLine(p.decision.reason), 170)}`];
    if (p.status === 'idea' || p.status === 'research') return [];
    return [`Fiche produit : ${name} ${p.status === 'live' ? 'en ligne' : 'en production'}, ${p.stats.sales} ventes, ${p.stats.reviews.length ? `note ${dec(p.stats.rating, 1)}/5 sur ${p.stats.reviews.length} avis` : 'pas encore d’avis'}, prix ${eur(p.price)}`];
  });
  return [...lines, ...activeHolds(w).map((h) => `Ordre du fondateur : ${oneLine(h.reason)}`)];
}

/** Facts someone knows by heart: those of their department, and of each one they cover with a hat. */
function deptFacts(ctx: RuntimeCtx, agent: AgentState): string[] {
  return uniq([agent.dept, ...agent.hatDepts].flatMap((dept) => factsOf(ctx, dept)));
}

function factsOf(ctx: RuntimeCtx, dept: DeptId): string[] {
  const w = ctx.world;
  const live = w.company.products.filter((p) => p.status === 'live');
  const out: string[] = [];
  switch (dept) {
    case 'growth': {
      const camps = activeCampaigns(w);
      out.push(camps.length ? `Pub : ${camps.length} campagne(s) active(s), ${eur(camps.reduce((s, c) => s + c.dailyBudget, 0))} par jour.` : 'Pub : aucune campagne active.');
      for (const p of live.slice(0, 2)) {
        const hook = learning.armStats(w, `hook_style:${p.nicheId}`).find((a) => a.pulls > 0);
        const fmt = learning.armStats(w, `ad_format:${p.nicheId}`).find((a) => a.pulls > 0);
        if (hook) out.push(`Meilleur hook pub sur « ${short(p.title, 40)} » : ${HOOK_LABELS[hook.key] ?? hook.key} (score ${Math.round(hook.mean * 100)}/100, ${hook.pulls} essais)${fmt ? `, meilleur format ${FORMAT_LABELS[fmt.key] ?? fmt.key}` : ''}.`);
      }
      break;
    }
    case 'support': {
      const open = w.market.inbox.filter((m) => m.status === 'open').length;
      const tone = learning.armStats(w, 'support_tone').find((a) => a.pulls > 0);
      out.push(`Support : ${open} message(s) client en attente${tone ? `, le ton « ${tone.key} » marche le mieux (${Math.round(tone.mean * 100)}/100)` : ''}.`);
      break;
    }
    case 'finance': {
      const b = currentBudget(w);
      out.push(`Budget : enveloppe pub du jour ${eur(b.adCap)}${b.outage ? ', panne de paiement annoncée aujourd’hui' : ''}${b.survival ? ', mode survie actif' : ''}.`);
      const pnl = w.company.pnl?.[w.company.pnl.length - 1];
      if (pnl) out.push(`P&L semaine ${pnl.week} : ${eur(pnl.total)} de résultat, ${pnl.products.filter((p) => p.profit < 0).length} produit(s) en perte.`);
      break;
    }
    case 'boutique':
      for (const p of live.slice(0, 3)) out.push(`Produit « ${short(p.title, 40)} » : ${p.stats.sales} ventes, note ${p.stats.rating ? dec(p.stats.rating, 1) : '—'}/5, prix ${eur(p.price)}.`);
      break;
    case 'recherche':
      out.push(`Niche : shortlist actuelle ${w.company.research.shortlist.slice(0, 3).map((id) => w.company.research.trends.find((t) => t.nicheId === id)?.name ?? id).join(', ') || 'vide'}.`);
      break;
    case 'studio':
    case 'creation':
      for (const p of w.company.products.filter((x) => x.status !== 'killed').slice(-2)) out.push(`Guide « ${short(p.title, 40)} » (v${p.version}) : qualité ${p.quality?.overall ?? '—'}/100.`);
      break;
    case 'analyse': {
      const running = w.company.experiments.filter((e) => e.status === 'running');
      out.push(running.length ? `Test A/B en cours : ${running.map((e) => e.hypothesis).join(' ; ')}.` : 'Aucun test A/B en cours.');
      break;
    }
    case 'partenariats':
      out.push(`Partenariats créateurs : ${w.market.partnerships.length} proposition(s), ${w.market.partnerships.filter((p) => p.status === 'accepted' || p.status === 'delivered').length} active(s).`);
      break;
    case 'rh':
      out.push(`Leçons apprises : ${w.company.lessons.length} au total.`);
      break;
    default: {
      const pending = w.company.pendingApprovals.length;
      out.push(`Direction : ${openTasks(w).length} tâche(s) ouvertes${pending ? `, ${pending} décision(s) en attente du fondateur` : ''}.`);
    }
  }
  return out;
}

export function situationFor(ctx: RuntimeCtx, agent: AgentState): string {
  const w = ctx.world;
  const fin = sim.financeSnapshot(w);
  const task = taskById(w, agent.currentTaskId ?? '') ?? [...w.company.tasks].reverse().find((t) => t.assignee === agent.id && isOpen(t));
  const kpi = w.company.kpis[w.company.kpis.length - 1];
  const lessons = w.company.lessons.slice(-2).map((l) => l.insight);
  const liveProducts = w.company.products.filter((p) => p.status === 'live');
  const live = liveProducts.map((p) => `« ${short(p.title, 50)} » à ${eur(p.price)}`);
  const dept = w.company.departments.find((d) => d.id === agent.dept)?.name ?? agent.dept;
  const closed = kpi?.day ?? 0;
  const events = w.market.events.filter((e) => e.day === closed && e.kind !== 'platform_outage').slice(-3).map((e) => `Événement du jour ${e.day} : ${oneLine(e.title)}`);
  const best = bestProductLine(ctx);
  const lines = [
    task ? `Ma tâche en cours : « ${task.title} » (${task.status === 'in_progress' ? 'en cours' : task.status === 'review' ? 'en relecture' : 'à faire'}).` : `Pas de tâche en cours pour moi ce jour ${w.day}.`,
    kpi ? `Hier : ${kpi.sales} ventes, ${eur(kpi.revenue)} de CA, ${eur(kpi.adSpend)} de pub, ROAS ${dec(kpi.roas)}, résultat ${eur(round2(kpi.profit))}.` : 'Pas encore de chiffres de vente.',
    `Trésorerie ${eur(fin.cash)}, profit cumulé ${eur(fin.profit)}${fin.runwayDays !== null ? `, runway ${fin.runwayDays} jours` : ''}.`,
    live.length ? `En boutique : ${live.join(', ')}.` : 'Aucun produit en ligne pour l’instant.',
    ...deptFacts(ctx, agent).map((f) => `Mon poste : ${f}`),
    ...(best ? [`${best}.`] : []),
    ...weekLines(ctx).map((l) => `${l}.`),
    ...productLines(ctx).map((l) => `${l}.`),
    ...(kpi ? causeLines(ctx, kpi).map((c) => `${c}.`) : []),
    ...ctx.lastMarketNotes.slice(0, 4).map((n) => `Marché d'hier : ${oneLine(n)}.`),
    ...events.map((e) => `${e}.`),
    ...founderMissionLines(ctx, 12).map((m) => `${m}.`),
    ...lessons.map((l) => `Leçon récente : ${short(l, 140)}`),
    `Contexte : ${agent.name}, ${agent.role} (${dept}) chez ${w.company.name}, jour ${w.day}.`,
  ];
  return lines.join('\n');
}
