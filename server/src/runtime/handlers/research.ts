/** Recherche + Red Team: trends → voice of customer + competitors → opportunity (rule of one) → kill attempt. */
import type { Product, TaskKind, TrendSignal, VoiceOfCustomer } from '../../shared.js';
import { nextId } from '../../core/index.js';
import type { RuntimeCtx } from '../ctx.js';
import { addDeliverable, incident, nameOf, nicheBriefOf, nicheName, productOf, say, vocOf, writeNote } from '../ctx.js';
import { learning } from '../modules.js';
import { createTask, isOpen, logTask } from '../tasks.js';
import { createProductPipeline, excludedNiches, killProduct } from '../pipeline.js';
import { nicheSlug, productNote, writeNicheNote } from '../notes.js';
import { dec, eur, mean, median, round2, short, str, strArr, uniq } from '../util.js';
import type { HandlerMap } from './common.js';
import { NO_PRODUCT, requireProduct } from './common.js';

const COMP_FACTOR: Record<TrendSignal['competitionHint'], number> = { faible: 1.15, moyenne: 1, forte: 0.8 };

export function signalScore(s: TrendSignal): number {
  return (s.searchInterest * 0.5 + s.tiktokBuzz * 0.5) * COMP_FACTOR[s.competitionHint];
}

function mergeVoc(a: VoiceOfCustomer | undefined, b: VoiceOfCustomer): VoiceOfCustomer {
  if (!a) return b;
  const u = (x: string[], y: string[]) => uniq([...x, ...y]);
  return {
    nicheId: b.nicheId,
    depth: a.depth === 'deep' || b.depth === 'deep' ? 'deep' : 'quick',
    pains: u(a.pains, b.pains), phrases: u(a.phrases, b.phrases), objections: u(a.objections, b.objections),
    desiredOutcomes: u(a.desiredOutcomes, b.desiredOutcomes),
    knowledge: {
      tips: u(a.knowledge.tips, b.knowledge.tips), steps: u(a.knowledge.steps, b.knowledge.steps),
      mistakes: u(a.knowledge.mistakes, b.knowledge.mistakes), examples: u(a.knowledge.examples, b.knowledge.examples),
      facts: u(a.knowledge.facts, b.knowledge.facts),
    },
    priceAnchors: [...a.priceAnchors, ...b.priceAnchors].slice(-30),
    bannedClaims: u(a.bannedClaims, b.bannedClaims),
  };
}

function hasOpen(ctx: RuntimeCtx, kind: TaskKind, pred: (input: Record<string, unknown>) => boolean): boolean {
  return ctx.world.company.tasks.some((t) => isOpen(t) && t.kind === kind && pred(t.input));
}

function ideaSummary(ctx: RuntimeCtx, product: Product): string {
  const s = ctx.world.company.research.trends.find((t) => t.nicheId === product.nicheId);
  const comps = ctx.world.company.research.competitors[product.nicheId] ?? [];
  const voc = ctx.world.company.research.voc[product.nicheId];
  const parts = [
    `Niche « ${nicheName(ctx, product.nicheId)} » — public : ${product.audience} — problème : ${product.problem}.`,
    s ? `Intérêt de recherche ${Math.round(s.searchInterest)}/100, buzz TikTok ${Math.round(s.tiktokBuzz)}/100, concurrence ${s.competitionHint}.` : 'Pas de signal de tendance mesuré.',
    comps.length
      ? `${comps.length} concurrents (prix médian ${eur(median(comps.map((c) => c.price)) ?? 0)}, ${comps.reduce((n, c) => n + c.reviews, 0)} avis, note moyenne ${dec(mean(comps.map((c) => c.rating)), 1)}).`
      : 'Aucun concurrent identifié.',
    voc ? `Douleurs : ${voc.pains.slice(0, 3).join(' ; ') || 'non documentées'}. Objections : ${voc.objections.slice(0, 2).join(' ; ') || 'aucune'}.` : 'Voix du client non étudiée.',
    voc && voc.bannedClaims.length ? `Allégations interdites par la plateforme : ${voc.bannedClaims.slice(0, 3).join(', ')}.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

export const researchHandlers: HandlerMap = {
  scan_trends: {
    async run(ctx, task, agent) {
      const query = str(task.input.query);
      const signals = ctx.tools.searchTrends(query);
      const { research } = ctx.world.company;
      for (const s of signals) {
        const i = research.trends.findIndex((t) => t.nicheId === s.nicheId);
        if (i >= 0) research.trends[i] = s; else research.trends.push(s);
      }
      const excluded = new Set(excludedNiches(ctx, { includeActive: true }));
      const ranked = [...signals].sort((a, b) => signalScore(b) - signalScore(a));
      const top = ranked.filter((s) => !excluded.has(s.nicheId)).slice(0, 3);
      const body = [
        `# Tendances — jour ${ctx.world.day}`,
        '',
        `Scan réalisé par ${agent.name}${query ? ` (requête : « ${query} »)` : ''}. Score = intérêt × buzz × facteur concurrence.`,
        '',
        '| Niche | Public | Recherche | Buzz TikTok | Concurrence | Score |',
        '|---|---|---|---|---|---|',
        ...ranked.slice(0, 12).map((s) => `| [[${nicheSlug(ctx, s.nicheId)}]] | ${s.audience} | ${Math.round(s.searchInterest)} | ${Math.round(s.tiktokBuzz)} | ${s.competitionHint} | ${Math.round(signalScore(s))} |`),
        '',
        `Pistes retenues pour la voix du client : ${top.map((s) => s.name).join(', ') || 'aucune'}.`,
        '',
        'Liens : [[Règle du un]] · [[Playbook Recherche]]',
      ].join('\n');
      await writeNote(ctx, agent.id, { path: 'niches/tendances.md', title: 'Tendances', tags: ['niche', 'tendances'], body });
      const d = addDeliverable(ctx, { kind: 'research', title: `Scan des tendances (${signals.length} niches)`, productId: null, creativeId: null, path: 'brain/niches/tendances.md', createdBy: agent.id, quality: null }, task);
      if (top[0]) say(ctx, agent.id, `${agent.name} : « ${top[0].name} » sort du lot (${Math.round(signalScore(top[0]))} pts) — on creuse.`);
      return {
        summary: `${signals.length} niches scannées ; pistes : ${top.map((s) => s.name).join(', ') || 'aucune'}.`,
        output: { count: signals.length, top: top.map((s) => s.nicheId), deliverableId: d.id },
      };
    },
    async onDone(ctx, task) {
      const top = strArr(task.output?.top);
      const { research } = ctx.world.company;
      const deps: string[] = [];
      top.forEach((nicheId, i) => {
        const depth = i === 0 ? 'deep' : 'quick';
        const known = research.voc[nicheId];
        if (known && (known.depth === 'deep' || depth === 'quick')) return;
        if (hasOpen(ctx, 'mine_pains', (inp) => inp.nicheId === nicheId)) return;
        const t = createTask(ctx.world, {
          kind: 'mine_pains', title: `Écouter la voix du client — ${short(nicheName(ctx, nicheId), 40)}${depth === 'deep' ? ' (approfondi)' : ''}`,
          input: { nicheId, depth }, workLeft: depth === 'deep' ? 2 : 1, createdBy: 'nadia', missionId: task.missionId, priority: task.priority,
        });
        deps.push(t.id);
      });
      const missingComps = top.filter((id) => !research.competitors[id]);
      if (missingComps.length) {
        const t = createTask(ctx.world, { kind: 'scan_competitors', input: { nicheIds: missingComps }, createdBy: 'nadia', missionId: task.missionId, priority: task.priority });
        deps.push(t.id);
      }
      if (task.input.chain === 'opportunity' && !hasOpen(ctx, 'pick_opportunity', () => true)) {
        createTask(ctx.world, { kind: 'pick_opportunity', dependsOn: deps, createdBy: 'nadia', missionId: task.missionId, priority: task.priority });
      }
    },
  },

  mine_pains: {
    async run(ctx, task, agent) {
      const nicheId = str(task.input.nicheId) ?? productOf(ctx, task.input.productId)?.nicheId;
      if (!nicheId) return { summary: 'Aucune niche précisée.', skipReview: true, output: { skipped: true } };
      const depth = task.input.depth === 'deep' ? 'deep' : 'quick';
      const voc = ctx.tools.minePains(nicheId, depth);
      const merged = mergeVoc(ctx.world.company.research.voc[nicheId], voc);
      ctx.world.company.research.voc[nicheId] = merged;
      const path = await writeNicheNote(ctx, nicheId, agent.id);
      const d = addDeliverable(ctx, {
        kind: 'research', title: `Voix du client — ${nicheName(ctx, nicheId)} (${depth === 'deep' ? 'approfondie' : 'rapide'})`,
        productId: str(task.input.productId) ?? null, creativeId: null, path: `brain/${path}`, createdBy: agent.id, quality: null,
      }, task);
      const phrase = merged.phrases[0];
      if (phrase) say(ctx, agent.id, `${agent.name} a noté : « ${short(phrase, 70)} »`);
      return {
        summary: `${merged.pains.length} douleurs, ${merged.phrases.length} verbatims, ${merged.objections.length} objections récoltés.`,
        output: { nicheId, depth: merged.depth, pains: merged.pains.length, phrases: merged.phrases.length, deliverableId: d.id },
      };
    },
  },

  scan_competitors: {
    async run(ctx, task, agent) {
      const ids = uniq([...strArr(task.input.nicheIds), ...(str(task.input.nicheId) ? [str(task.input.nicheId)!] : [])]);
      const pid = productOf(ctx, task.input.productId)?.nicheId;
      if (pid && !ids.includes(pid)) ids.push(pid);
      if (!ids.length) return { summary: 'Aucune niche à analyser.', skipReview: true, output: { skipped: true } };
      let total = 0;
      const weak: string[] = [];
      for (const nicheId of ids) {
        const list = ctx.tools.listCompetitors(nicheId);
        ctx.world.company.research.competitors[nicheId] = list;
        total += list.length;
        for (const c of list) weak.push(...c.weaknesses.slice(0, 1));
        await writeNicheNote(ctx, nicheId, agent.id);
      }
      if (weak[0]) say(ctx, agent.id, `${agent.name} : les acheteurs reprochent « ${short(weak[0], 60)} » — notre angle est là.`);
      return { summary: `${total} produits concurrents analysés sur ${ids.length} niche(s).`, output: { nicheIds: ids, competitors: total, weaknesses: uniq(weak).slice(0, 6) } };
    },
  },

  pick_opportunity: {
    async run(ctx, task, agent, mind) {
      const { research } = ctx.world.company;
      const excluded = uniq([...excludedNiches(ctx, { includeActive: true }), ...strArr(task.input.excludeNicheIds)]);
      if (!research.trends.length) return { summary: 'Aucune tendance connue : il faut d’abord scanner le marché.', skipReview: true, output: { rescan: true } };
      const ranking = await ctx.engine.rankOpportunities({ signals: research.trends, competitors: research.competitors, voc: research.voc, excludeNicheIds: excluded }, mind);
      const ranked = (ranking.ranked ?? []).filter((r) => r && r.nicheId && !excluded.includes(r.nicheId));
      if (!ranked.length) {
        say(ctx, agent.id, `${agent.name} : toutes les niches connues sont prises ou écartées, on relance un scan.`);
        return { summary: 'Aucune opportunité restante : nouveau scan demandé.', skipReview: true, output: { rescan: true } };
      }
      research.shortlist = ranked.map((r) => r.nicheId);
      const top = ranked.slice(0, 3);
      const stats = learning.armStats(ctx.world, 'niche');
      const tried = top.some((r) => stats.some((s) => s.key === r.nicheId && s.pulls > 0));
      const forced = str(task.input.nicheId);
      const chosenId = forced && ranked.some((r) => r.nicheId === forced)
        ? forced
        : tried ? learning.chooseArm(ctx.world, 'niche', top.map((r) => r.nicheId), ctx.rng) : top[0]!.nicheId;
      const pick = ranked.find((r) => r.nicheId === chosenId) ?? top[0]!;
      const brief = nicheBriefOf(ctx, pick.nicheId);
      const product: Product = {
        id: nextId(ctx.world, 'prd'), nicheId: pick.nicheId,
        title: `${brief.name}`, subtitle: pick.angle || '',
        audience: pick.audience || brief.audience, problem: pick.problem || brief.problem,
        price: Math.max(0, round2(pick.suggestedPrice || 0)),
        status: 'research', version: 1, content: null, design: null, salesPage: null,
        files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null,
        createdDay: ctx.world.day, launchedDay: null,
        stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 },
        priceHistory: [],
      };
      ctx.world.company.products.push(product);
      vocOf(ctx, product.nicheId);
      const others = ranked.filter((r) => r.nicheId !== pick.nicheId).slice(0, 3).map((r) => `${nicheName(ctx, r.nicheId)} (${Math.round(r.score)})`);
      await productNote(ctx, product, agent.id, 'Pourquoi cette niche', [
        `- **Score** : ${Math.round(pick.score)} — ${pick.why}`,
        `- **Angle** : ${pick.angle || '—'}`,
        `- **Prix suggéré** : ${eur(pick.suggestedPrice || 0)}`,
        `- **Alternatives** : ${others.join(', ') || 'aucune'}`,
      ].join('\n'));
      say(ctx, agent.id, `${agent.name} retient « ${short(brief.name, 50)} » pour ${short(product.audience, 40)} : ${short(pick.why, 90)}`, 'thought', { productId: product.id });
      return {
        summary: `Niche choisie : ${brief.name} (score ${Math.round(pick.score)}) — ${short(pick.why, 80)}`,
        output: { productId: product.id, nicheId: pick.nicheId, score: pick.score, why: pick.why, angle: pick.angle, suggestedPrice: pick.suggestedPrice, shortlist: research.shortlist.slice(0, 6) },
      };
    },
    async onDone(ctx, task) {
      const out = task.output ?? {};
      if (out.rescan === true) {
        if (!ctx.world.company.tasks.some((t) => isOpen(t) && t.kind === 'scan_trends')) {
          createTask(ctx.world, { kind: 'scan_trends', input: { chain: 'opportunity' }, createdBy: 'nadia', missionId: task.missionId, priority: task.priority });
        }
        return;
      }
      const product = productOf(ctx, out.productId);
      if (product && product.status !== 'killed') createProductPipeline(ctx, product, { createdBy: 'camille', missionId: task.missionId, priority: task.priority });
    },
  },

  red_team: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const subject = task.input.subject === 'pdf' ? 'pdf' : task.input.subject === 'sales_page' ? 'sales_page' : task.input.subject === 'ad' ? 'ad' : 'idea';
      const summary = subject === 'idea'
        ? ideaSummary(ctx, product)
        : `Guide « ${product.title} » (${product.content?.wordCount ?? 0} mots, ${product.content?.chapters.length ?? 0} chapitres) pour ${product.audience}. Promesse : ${product.content?.promise ?? '—'}. Qualité mesurée : ${product.quality?.overall ?? '—'}/100.`;
      const quality = subject === 'idea' ? null : subject === 'sales_page' ? product.salesQuality : product.quality;
      const v = await ctx.engine.redTeam({ subject, summary, quality }, mind);
      const verdictFr = v.verdict === 'go' ? 'GO' : v.verdict === 'fix' ? 'À CORRIGER' : 'À TUER';
      say(ctx, agent.id, `${agent.name} attaque ${subject === 'idea' ? "l'idée" : 'le guide'} « ${short(product.title, 40)} » : ${verdictFr} — ${short(v.reasons[0] ?? 'rien à signaler', 80)}`, 'thought', { productId: product.id, taskId: task.id });
      return {
        summary: `Verdict Red Team : ${verdictFr}. ${v.reasons.slice(0, 2).join(' ; ')}`,
        output: { subject, verdict: v.verdict, reasons: v.reasons, fixes: v.fixes, finalVerdict: v.verdict },
      };
    },
    async onDone(ctx, task) {
      const product = productOf(ctx, task.input.productId);
      if (!product || product.status === 'killed') return;
      const out = task.output ?? {};
      const verdict = out.finalVerdict;
      const subject = out.subject;
      if (subject === 'idea') {
        if (verdict === 'kill') {
          const reasons = strArr(out.reasons).slice(0, 2).join(' ; ') || 'idée jugée trop risquée';
          await killProduct(ctx, product, `tuée par la Red Team avant production (${reasons})`, 'camille');
          createTask(ctx.world, { kind: 'pick_opportunity', input: { excludeNicheIds: [product.nicheId] }, createdBy: 'camille', missionId: task.missionId, priority: task.priority });
          return;
        }
        if (product.status === 'research' || product.status === 'idea') product.status = 'writing';
        if (verdict === 'fix') say(ctx, 'elise', `Élise intègre les correctifs de la Red Team : ${short(strArr(out.fixes).join(' ; ') || 'resserrer la promesse', 90)}`, 'thought', { productId: product.id });
        return;
      }
      if (verdict === 'fix' && product.status !== 'live') {
        // The finished guide needs another pass before it can ship: humanize + re-render, publish waits for it.
        const fixes = strArr(out.fixes).slice(0, 3);
        const human = createTask(ctx.world, { kind: 'humanize_pdf', title: `Corriger le guide après la Red Team — « ${short(product.title, 40)} »`, input: { productId: product.id, nicheId: product.nicheId, fixes }, createdBy: 'axel', missionId: task.missionId, priority: 1 });
        const render = createTask(ctx.world, { kind: 'render_pdf', title: `Remettre en page après corrections — « ${short(product.title, 40)} »`, input: { productId: product.id, nicheId: product.nicheId }, dependsOn: [human.id], createdBy: 'axel', missionId: task.missionId, priority: 1 });
        for (const t of ctx.world.company.tasks) {
          if (t.kind === 'publish_product' && t.input.productId === product.id && t.status === 'pending') {
            t.dependsOn.push(render.id);
            logTask(t, `Jour ${ctx.world.day} : attend les corrections de la Red Team.`);
          }
        }
        incident(ctx, `La Red Team a renvoyé le guide « ${product.title} » en correction : ${fixes.join(' ; ') || 'promesse trop large'}`);
        say(ctx, 'camille', `Camille bloque la mise en ligne de « ${short(product.title, 40)} » le temps des corrections (${nameOf(ctx, 'lina')} s'y colle).`, 'thought', { productId: product.id });
      }
    },
  },
};
