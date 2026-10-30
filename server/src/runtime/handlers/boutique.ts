/** Boutique: sales page (hype bandit capped by playbook), price (start low, bandit, target), publish, upsell. */
import type { Product } from '../../shared.js';
import { nextId } from '../../core/index.js';
import type { RuntimeCtx } from '../ctx.js';
import { addDeliverable, incident, latestOutput, nicheName, productOf, runFileExists, say, versionDir, vocOf, writeRunFile } from '../ctx.js';
import { deliverables, learning, sim } from '../modules.js';
import { directivesOf, HYPE_ARMS, PRICE_ARMS } from '../playbook.js';
import { createUpsellPipeline } from '../pipeline.js';
import { productNote } from '../notes.js';
import { parentOf } from '../metrics.js';
import { createTask } from '../tasks.js';
import { eur, median, numOf, round2, short, str } from '../util.js';
import type { HandlerMap } from './common.js';
import { NO_PRODUCT, requireProduct, studioMind } from './common.js';
import { ensureCoverFile, ensureDesign } from './creation.js';

const HYPES = HYPE_ARMS.map(Number).sort((a, b) => a - b);
const PRICES = PRICE_ARMS.map(Number).sort((a, b) => a - b);

/** Largest arm ≤ value (or the lowest arm). */
function floorArm(arms: readonly number[], value: number): number {
  let best = arms[0]!;
  for (const a of arms) if (a <= value + 1e-9) best = a;
  return best;
}
function nearestArm(arms: readonly number[], value: number): number {
  return arms.reduce((b, a) => (Math.abs(a - value) < Math.abs(b - value) ? a : b), arms[0]!);
}
function stepArm(arms: readonly number[], value: number, delta: number): number {
  const i = arms.indexOf(floorArm(arms, value));
  return arms[Math.max(0, Math.min(arms.length - 1, i + delta))]!;
}

function runningExperiment(ctx: RuntimeCtx, dimension: string) {
  return ctx.world.company.experiments.find((e) => e.status === 'running' && e.dimension === dimension) ?? null;
}

export const boutiqueHandlers: HandlerMap = {
  write_sales_page: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      if (!product.content) return { fail: 'Impossible d’écrire la page : le guide n’existe pas encore.', summary: 'Pas de contenu.' };
      const voc = vocOf(ctx, product.nicheId);
      const cap = directivesOf(ctx.world, agent.id, nicheName(ctx, product.nicheId)).maxHype;
      let hype: number;
      let source: string;
      const previous = product.salesPage?.hypeLevel;
      if (task.attempts > 0 && typeof previous === 'number') {
        hype = stepArm(HYPES, previous, -1); source = 'reprise : promesse plus sobre';
      } else if (typeof numOf(task.input.hypeDelta) === 'number' && typeof previous === 'number') {
        hype = stepArm(HYPES, previous, Math.round(numOf(task.input.hypeDelta)!)); source = `v${product.version} : promesse revue à la baisse`;
      } else {
        const exp = runningExperiment(ctx, 'sales_hype');
        const arm = exp && exp.variants.length
          ? exp.variants[ctx.world.company.products.filter((p) => p.salesPage).length % exp.variants.length]!
          : learning.chooseArm(ctx.world, 'hype', HYPE_ARMS, ctx.rng);
        hype = Number(arm); source = exp ? 'expérience en cours' : 'bandit';
      }
      if (!Number.isFinite(hype)) hype = 0.4;
      if (cap !== null && hype > cap) { hype = floorArm(HYPES, cap); source += ` (plafonné à ${cap})`; }
      const sp = await ctx.engine.writeSalesPage({ product, content: product.content, voc, hype }, studioMind(ctx, task, mind));
      sp.hypeLevel = hype;
      product.salesPage = sp;
      const sq = sim.scoreSalesPage(sp, product, voc);
      product.salesQuality = sq;
      const design = ensureDesign(ctx, product);
      const coverSvg = await ensureCoverFile(ctx, product);
      const html = deliverables.renderSalesPageHtml({ product, salesPage: sp, coverSvg, design, brand: ctx.world.company.name });
      const rel = `${versionDir(product)}/sales-page.html`;
      await writeRunFile(ctx, rel, html);
      product.files.salesPage = rel;
      addDeliverable(ctx, { kind: 'sales_page', title: `Page de vente « ${short(product.title, 50)} » (v${product.version})`, productId: product.id, creativeId: null, path: rel, createdBy: agent.id, quality: sq.overall }, task);
      say(ctx, agent.id, `${agent.name} : accroche « ${short(sp.headline, 70)} » — promesse ${hype} (${source})`, 'thought', { productId: product.id });
      return { summary: `Page de vente écrite (promesse ${hype}, qualité ${sq.overall}/100).`, output: { path: rel, hype, hypeSource: source, score: sq.overall } };
    },
  },

  set_price: {
    async run(ctx, task, agent) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const voc = vocOf(ctx, product.nicheId);
      const reason = str(task.input.reason) ?? (product.launchedDay ? 'bandit' : 'initial');
      const target = directivesOf(ctx.world, agent.id, nicheName(ctx, product.nicheId)).targetPrice;
      const anchors = voc.priceAnchors.filter((p) => p > 0);
      const pick = latestOutput(ctx.world, 'pick_opportunity', product.id) ?? ctx.world.company.tasks.find((t) => t.kind === 'pick_opportunity' && t.output?.productId === product.id)?.output ?? null;
      const suggested = numOf(pick?.suggestedPrice) ?? (product.price > 0 ? product.price : undefined);
      const parent = parentOf(ctx.world, product.id);
      const exp = runningExperiment(ctx, 'price');
      const previous = product.price;
      let price: number;
      let why: string;
      if (reason === 'experiment' && exp && exp.variants.length) {
        price = Number(exp.variants[ctx.world.day % exp.variants.length]); why = `test A/B en cours (${exp.variants.join(' € vs ')} €)`;
      } else if ((reason === 'winner' || reason === 'baisse') && (numOf(task.input.price) ?? 0) > 0) {
        // Measured decisions of the CEO (strategy.priceMove): they beat the playbook's older target price.
        price = numOf(task.input.price)!;
        why = reason === 'winner' ? 'gagnant du test A/B de prix (revenu par visiteur)' : 'la hausse faisait baisser le revenu par visiteur : retour au prix précédent';
      } else if (target !== null) {
        price = nearestArm(PRICES, target); why = `prix cible du playbook (${target} €)`;
      } else if (reason === 'initial' || !product.launchedDay) {
        if (parent) {
          price = stepArm(PRICES, parent.price || 14, +1); why = `upsell : un palier au-dessus du premier guide (${eur(parent.price)})`;
        } else {
          const sweet = suggested ?? median(anchors) ?? 19;
          price = Math.max(9, floorArm(PRICES, Math.min(sweet, median(anchors) ?? sweet))); why = `on commence bas (suggestion ${eur(sweet)}${anchors.length ? `, ancres clients ${eur(Math.min(...anchors))}–${eur(Math.max(...anchors))}` : ''})`;
        }
      } else if (reason === 'hausse') {
        const ceiling = anchors.length ? Math.max(...anchors) * 1.4 : 49;
        const up = stepArm(PRICES, previous, +1);
        price = up <= ceiling ? up : previous; why = up <= ceiling ? 'les avis sont bons : on monte d’un palier' : 'plafond des ancres clients atteint, on garde le prix';
      } else {
        const lo = anchors.length ? Math.min(...anchors) * 0.5 : 0;
        const hi = anchors.length ? Math.max(...anchors) * 1.5 : 99;
        const arms = PRICE_ARMS.filter((a) => Number(a) >= lo && Number(a) <= hi);
        price = Number(learning.chooseArm(ctx.world, `price:${product.nicheId}`, arms.length ? arms : PRICE_ARMS, ctx.rng)); why = 'bandit de prix';
      }
      if (!Number.isFinite(price) || price <= 0) price = 14;
      price = round2(price);
      if (product.launchedDay) {
        const res = ctx.tools.setPrice(product.id, price);
        if (!res.ok) return { fail: `La boutique refuse le prix : ${res.message}`, summary: res.message };
      }
      product.price = price;
      const last = product.priceHistory[product.priceHistory.length - 1];
      if (!last || last.day !== ctx.world.day || last.price !== price) product.priceHistory.push({ day: ctx.world.day, price });
      if (product.status === 'qa' && product.salesPage) product.status = 'ready';
      if (price !== previous && product.launchedDay) await productNote(ctx, product, agent.id, 'Prix', `- ${eur(previous)} → **${eur(price)}** : ${why}`);
      say(ctx, agent.id, `${agent.name} fixe « ${short(product.title, 40)} » à ${eur(price)} : ${why}`, 'thought', { productId: product.id });
      return { summary: `Prix : ${eur(price)} (${why}).`, output: { price, previous, reason, why } };
    },
  },

  publish_product: {
    async run(ctx, task) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const missing: string[] = [];
      if (!product.content) missing.push('texte du guide');
      if (!runFileExists(ctx, product.files.pdf)) missing.push('PDF final');
      if (!product.salesPage || !runFileExists(ctx, product.files.salesPage)) missing.push('page de vente');
      if (!(product.price > 0)) missing.push('prix');
      if (missing.length) return { fail: `Mise en ligne impossible, il manque : ${missing.join(', ')}.`, summary: `Il manque : ${missing.join(', ')}` };
      if (product.status !== 'live') product.status = 'ready';
      return {
        summary: `Dossier complet : PDF ${product.quality?.overall ?? '—'}/100, page ${product.salesQuality?.overall ?? '—'}/100, prix ${eur(product.price)}.`,
        output: { checks: { pdf: product.files.pdf, salesPage: product.files.salesPage, price: product.price }, republish: task.input.republish === true },
      };
    },
    async onDone(ctx, task) {
      const product = productOf(ctx, task.input.productId);
      if (!product || product.status === 'killed') return;
      const wasLive = product.status === 'live';
      const republish = task.input.republish === true;
      const res = ctx.tools.publishProduct(product.id);
      if (!res.ok && !wasLive) {
        product.status = 'ready';
        incident(ctx, `La boutique a refusé la mise en ligne de « ${product.title} » : ${res.message}`);
        say(ctx, 'clara', `Clara : la boutique refuse la mise en ligne (${short(res.message, 80)})`, 'task_failed', { productId: product.id, taskId: task.id });
        return;
      }
      product.status = 'live';
      if (product.launchedDay === null) product.launchedDay = ctx.world.day;
      say(ctx, 'clara', wasLive || republish
        ? `La v${product.version} de « ${short(product.title, 50)} » remplace l'ancienne en boutique`
        : `« ${short(product.title, 50)} » est en ligne à ${eur(product.price)} !`, 'deliverable', { productId: product.id, taskId: task.id });
      await productNote(ctx, product, 'clara', wasLive || republish ? `Version ${product.version} en ligne` : 'Mise en ligne', [
        `- Prix : ${eur(product.price)} · qualité PDF ${product.quality?.overall ?? '—'}/100 · page ${product.salesQuality?.overall ?? '—'}/100`,
        `- Fichiers : \`${product.files.pdf}\` · \`${product.files.salesPage}\``,
      ].join('\n'));
      // An upsell going live: the parent guide's last page now points to it.
      const parent = parentOf(ctx.world, product.id);
      if (parent && parent.status !== 'killed' && !wasLive && !republish) {
        if (parent.content?.nextStep) parent.content.nextStep = { ...parent.content.nextStep, title: parent.content.nextStep.title || 'La suite est ici', upsellProductId: product.id };
        createTask(ctx.world, { kind: 'render_pdf', title: `Ajouter « La suite est ici » au guide « ${short(parent.title, 40)} »`, input: { productId: parent.id, nicheId: parent.nicheId, reason: 'upsell_link' }, createdBy: 'paul', missionId: task.missionId, priority: 2 });
      }
    },
  },

  design_upsell: {
    async run(ctx, task, agent) {
      const parent = requireProduct(ctx, task);
      if (!parent) return NO_PRODUCT;
      const existing = productOf(ctx, parent.upsellProductId);
      if (existing && existing.status !== 'killed') return { summary: `L'upsell « ${short(existing.title, 50)} » existe déjà.`, skipReview: true, output: { upsellProductId: existing.id, existing: true } };
      const voc = vocOf(ctx, parent.nicheId);
      const candidates = [...voc.desiredOutcomes, ...voc.pains].filter((p) => p && p.toLowerCase() !== parent.problem.toLowerCase());
      const problem = candidates[0] ?? `aller plus loin après « ${parent.title} »`;
      const upsell: Product = {
        id: nextId(ctx.world, 'prd'), nicheId: parent.nicheId,
        title: `${nicheName(ctx, parent.nicheId)} — la suite`, subtitle: `Pour aller plus loin après « ${short(parent.title, 60)} »`,
        audience: parent.audience, problem, price: 0, status: 'writing', version: 1,
        content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null },
        quality: null, salesQuality: null, upsellProductId: null, createdDay: ctx.world.day, launchedDay: null,
        stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
      };
      ctx.world.company.products.push(upsell);
      parent.upsellProductId = upsell.id;
      if (parent.content?.nextStep) parent.content.nextStep = { ...parent.content.nextStep, upsellProductId: upsell.id };
      await productNote(ctx, parent, agent.id, 'Upsell', `- PDF suivant pour le même public : **${upsell.title}** — problème : ${problem}`);
      say(ctx, agent.id, `${agent.name} : les acheteurs de « ${short(parent.title, 40)} » veulent la suite → « ${short(problem, 60)} »`, 'thought', { productId: parent.id });
      return { summary: `Upsell conçu : ${short(problem, 80)}.`, output: { upsellProductId: upsell.id, problem } };
    },
    async onDone(ctx, task) {
      if (task.output?.existing === true) return;
      const upsell = productOf(ctx, task.output?.upsellProductId);
      if (upsell && upsell.status !== 'killed') createUpsellPipeline(ctx, upsell, { createdBy: 'clara', missionId: task.missionId, priority: 2 });
    },
  },
};
