/** Boutique: sales page (hype bandit capped by playbook, template and hero: design plan D203), price (start low, bandit, target), publish, upsell. */
import type { AgentState, PageHero, PageTemplate, Product, Task } from '../../shared.js';
import type { MindContext } from '../../contracts.js';
import { nextId } from '../../core/index.js';
import { priceDropPrint } from '../../deliverables/sales/index.js';
import { chooseLook, eligibleLooks, logLook, lookIn, lookLabel, looksOn, runningPageTest, shelfOf, variantOn, type LookChoice } from '../../learning/looks.js';
import type { RuntimeCtx } from '../ctx.js';
import { addDeliverable, incident, latestOutput, nicheName, productOf, readRunFile, runFileExists, say, speak, versionDir, vocOf, writeRunFile } from '../ctx.js';
import { deliverables, learning, sim } from '../modules.js';
import { directivesOf, HYPE_ARMS, PRICE_ARMS } from '../playbook.js';
import { createUpsellPipeline, killProduct } from '../pipeline.js';
import { redTeamGate, reopenGate } from '../redteam.js';
import { productNote } from '../notes.js';
import { officerId } from '../org/officers.js';
import { followUpLimit, parentOf, priceCeiling } from '../metrics.js';
import { armSharp, bestDraft } from '../talent/craft.js';
import { linkUpsell, nicheCollision, pickUpsellSubject, upsellContextOf } from '../upsell.js';
import { endLine, eur, median, numOf, round2, short, str } from '../util.js';
import type { HandlerMap } from './common.js';
import { NO_PRODUCT, requireProduct, studioMind } from './common.js';
import { coverSvgFor, designRng, ensureCoverFile, ensureDesign, founderWords, lookSharp } from './creation.js';
import { reworkCraft } from './growth.js';

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

const stopped = (p: Product): boolean => p.status === 'killed' || p.status === 'paused';

/** A kit sells at its guide's checkout and nowhere else: once the guide stops, its page has nothing left to sell, whatever the kit's own status says. */
function offSale(ctx: RuntimeCtx, product: Product): boolean {
  const guide = product.kind === 'kit' ? ctx.world.company.products.find((p) => p.bumpProductId === product.id) : undefined;
  return stopped(product) || (!!guide && stopped(guide));
}

/** The kit the checkout really offers beside a guide, drawn by the `bundle` hero: a kit not on sale is never shown. */
function kitOf(ctx: RuntimeCtx, product: Product): Product | undefined {
  const kit = product.kind === 'kit' ? undefined : productOf(ctx, product.bumpProductId);
  return kit?.status === 'live' && kit.design ? kit : undefined;
}

/**
 * What the page prints of the live shop: when this changes, the file on disk is out of date. A stopped guide loses its buttons this way,
 * and its kit with it. Its look too: a page test switches the template by day, a refresh the cover (D204). A V1 page has no look, and
 * prints neither a reduction nor a kit: a templated one shows a reduction for 30 days (D208) and the kit the checkout offers.
 */
function pagePrintOf(ctx: RuntimeCtx, product: Product): string {
  const { reviews, rating } = product.stats;
  const look = [product.design?.style, product.salesPage?.template, product.salesPage?.hero];
  const shop = product.salesPage?.template ? [`baisse:${priceDropPrint(product.priceHistory, product.price, ctx.world.day)}`, `kit:${kitOf(ctx, product)?.id ?? ''}`] : [];
  return [product.price, reviews.length, rating, reviews[reviews.length - 1]?.id ?? '', ...(offSale(ctx, product) ? ['hors vente'] : []), ...(look.some(Boolean) ? [`look:${look.map((x) => x ?? '').join('/')}`] : []), ...shop].join('|');
}

interface PageLook { template: PageTemplate; hero: PageHero; why: string }

/**
 * The template and hero of a page (D203), null while looks are off. A rework, or a new draft of the same version's page, keeps the look
 * it had while its needs hold: only the copy changes. A running page test sets the template of the day. Otherwise each is chosen like a
 * cover's style, among the looks whose needs hold today; a refresh leaves the template the evidence found lagging.
 */
function pageLook(ctx: RuntimeCtx, task: Task, agent: AgentState, mind: MindContext, product: Product): PageLook | null {
  const w = ctx.world;
  if (!looksOn(w)) return null;
  const sp = product.salesPage;
  const templates = eligibleLooks(product, 'template');
  const heroes = eligibleLooks(product, 'hero');
  const sameVersion = !!sp && product.files.salesPage === `${versionDir(product)}/sales-page.html`;
  const keep = (task.attempts > 0 || (sameVersion && task.input.refresh !== true)) && !!sp?.template && !!sp.hero && templates.includes(sp.template) && heroes.includes(sp.hero);
  if (keep) return { template: sp!.template!, hero: sp!.hero!, why: 'même look, seule la copie change' };
  const test = runningPageTest(w, product.id);
  const shelf = shelfOf(w, product, product.nicheId);
  const rules = directivesOf(w, agent.id, nicheName(ctx, product.nicheId));
  const words = founderWords(task);
  const ask = (kind: 'template' | 'hero', eligible: string[], rule: string | null, testKey: string | null, exclude: string[]): LookChoice | null => chooseLook(w, {
    kind, nicheId: product.nicheId, shelf, eligible, founder: lookIn(kind, words), rule, test: testKey, exclude,
    rng: designRng(ctx, agent.id, kind), sharp: lookSharp(ctx, agent, mind, kind),
  });
  const template = ask('template', templates, rules.pageTemplate, test ? variantOn(test, w.day) ?? null : null, task.input.excludeTemplate === true && sp?.template ? [sp.template] : []);
  const hero = ask('hero', heroes, rules.pageHero, null, []);
  if (!template || !hero) return null;
  const why = template.why === hero.why ? template.why : `${template.why} ; visuel : ${hero.why}`;
  return { template: template.key as PageTemplate, hero: hero.key as PageHero, why };
}

/** The real pages `render_pdf` left next to the guide, named after their kind. An old save has none: its page skips the section. */
async function previewsOf(ctx: RuntimeCtx, product: Product): Promise<{ label: string; svg: string }[]> {
  const out: { label: string; svg: string }[] = [];
  for (const rel of product.files.previews ?? []) {
    const svg = await readRunFile(ctx, rel);
    if (svg) out.push({ label: /\d+-([^/]+)\.svg$/.exec(rel)?.[1] ?? '', svg });
  }
  return out;
}

async function renderSalesPage(ctx: RuntimeCtx, product: Product, rel: string, coverSvg: string): Promise<void> {
  const kit = kitOf(ctx, product);
  const html = deliverables.renderSalesPageHtml({
    product, salesPage: product.salesPage!, coverSvg, design: ensureDesign(ctx, product), brand: ctx.world.company.name, previews: await previewsOf(ctx, product), offSale: offSale(ctx, product),
    kit: kit ? { title: kit.title, coverSvg: coverSvgFor(ctx, kit) } : null, day: ctx.world.day,
  });
  await writeRunFile(ctx, rel, html);
  product.files.salesPage = rel;
  product.pagePrint = pagePrintOf(ctx, product);
}

/** Puts the page back in line with the price and the reviews of the moment (in place: a v2 in progress has its own). */
export async function refreshSalesPage(ctx: RuntimeCtx, product: Product): Promise<void> {
  if (!product.salesPage || !product.files.salesPage || product.pagePrint === pagePrintOf(ctx, product)) return;
  await renderSalesPage(ctx, product, product.files.salesPage, coverSvgFor(ctx, product));
}

/** Prices move on set_price, reviews at any tick (market close, support, events): every page follows, at the end of the tick. */
export async function syncSalesPages(ctx: RuntimeCtx): Promise<void> {
  for (const product of ctx.world.company.products) {
    try {
      await refreshSalesPage(ctx, product);
    } catch (e) {
      incident(ctx, `Page de vente de « ${short(product.title, 40)} » non mise à jour : ${short(String(e), 80)}`);
    }
  }
}

export const boutiqueHandlers: HandlerMap = {
  write_sales_page: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const content = product.content;
      if (!content) return { fail: 'Impossible d’écrire la page : le guide n’existe pas encore.', summary: 'Pas de contenu.' };
      const voc = vocOf(ctx, product.nicheId);
      const cap = directivesOf(ctx.world, agent.id, nicheName(ctx, product.nicheId)).maxHype;
      const look = pageLook(ctx, task, agent, mind, product);
      let hype: number;
      let source: string;
      const previous = product.salesPage?.hypeLevel;
      if (task.attempts > 0 && typeof previous === 'number') {
        hype = stepArm(HYPES, previous, -1); source = 'reprise : promesse plus sobre';
      } else if (task.input.refresh === true && typeof previous === 'number') {
        hype = previous; source = 'refonte visuelle : même promesse';
      } else if (typeof numOf(task.input.hypeDelta) === 'number' && typeof previous === 'number') {
        hype = stepArm(HYPES, previous, Math.round(numOf(task.input.hypeDelta)!)); source = `v${product.version} : promesse revue à la baisse`;
      } else {
        const exp = runningExperiment(ctx, 'sales_hype');
        const arm = exp && exp.variants.length
          ? exp.variants[ctx.world.company.products.filter((p) => p.salesPage).length % exp.variants.length]!
          : learning.chooseArm(ctx.world, 'hype', HYPE_ARMS, ctx.rng, armSharp(ctx, agent, mind, 'hype'));
        hype = Number(arm); source = exp ? 'expérience en cours' : 'bandit';
      }
      if (!Number.isFinite(hype)) hype = 0.4;
      if (cap !== null && hype > cap) { hype = floorArm(HYPES, cap); source += ` (plafonné à ${cap})`; }
      const before = task.input.reason === 'lesson' && product.salesPage ? { page: product.salesPage, quality: sim.scoreSalesPage(product.salesPage, product, voc) } : null;
      const upsellOf = upsellContextOf(ctx.world, product);
      const { draft: sp } = await bestDraft(ctx, agent, reworkCraft(task, studioMind(ctx, task, mind)), 'page',
        (m) => ctx.engine.writeSalesPage({ product, content, voc, hype, upsellOf }, m),
        (d) => sim.scoreSalesPage({ ...d, hypeLevel: hype }, product, voc).overall);
      sp.hypeLevel = hype;
      sp.priceWritten = product.price;
      if (look) Object.assign(sp, { template: look.template, hero: look.hero });
      product.salesPage = sp;
      let sq = sim.scoreSalesPage(sp, product, voc);
      // A rewrite that reads worse than the page it replaces does not go online.
      if (before && sq.overall < before.quality.overall) { product.salesPage = before.page; sq = before.quality; }
      product.salesQuality = sq;
      const rel = `${versionDir(product)}/sales-page.html`;
      await renderSalesPage(ctx, product, rel, await ensureCoverFile(ctx, product));
      addDeliverable(ctx, { kind: 'sales_page', title: `Page de vente « ${short(product.title, 50)} » (v${product.version})`, productId: product.id, creativeId: null, path: rel, createdBy: agent.id, quality: sq.overall }, task);
      const { template, hero } = product.salesPage;
      if (look) logLook(product, ctx.world.day, `${lookLabel('template', template ?? look.template)} et ${lookLabel('hero', hero ?? look.hero)} : ${look.why}`);
      const copy = `accroche « ${short(product.salesPage.headline, 70)} » — promesse ${product.salesPage.hypeLevel} (${source})`;
      // one line either way: the feed spends ids, and a control arm without looks must keep the same ones
      say(ctx, agent.id, look && template && hero
        ? `${agent.name} choisit le gabarit « ${lookLabel('template', template)} » et le visuel « ${lookLabel('hero', hero)} » : ${look.why} ; ${copy}`
        : `${agent.name} : ${copy}`, 'thought', { productId: product.id });
      return {
        summary: `Page de vente écrite (promesse ${hype}${template ? `, gabarit « ${lookLabel('template', template)} »` : ''}, qualité ${sq.overall}/100).`,
        output: { path: rel, hype, hypeSource: source, score: sq.overall, ...(template ? { template } : {}), ...(hero ? { hero } : {}) },
      };
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
      } else if ((reason === 'winner' || reason === 'controle' || reason === 'baisse' || reason === 'fondateur' || reason === 'memoire') && (numOf(task.input.price) ?? 0) > 0) {
        // Measured decisions of the CEO (strategy.priceMove), the founder's and what a reopened niche measured before: they beat the playbook's older target price.
        price = numOf(task.input.price)!;
        why = reason === 'fondateur' ? 'décision du fondateur'
          : reason === 'winner' ? 'gagnant du test A/B de prix (revenu par visiteur)'
            : reason === 'controle' ? 'test de prix sans gagnant : retour au prix de contrôle'
              : reason === 'memoire' ? 'meilleur prix mesuré sur cette niche au dernier essai'
                : 'la hausse faisait baisser le revenu par visiteur : retour au prix précédent';
      } else if (target !== null) {
        price = nearestArm(PRICES, target); why = `prix cible du playbook (${target} €)`;
      } else if (reason === 'initial' || !product.launchedDay) {
        if (parent) {
          price = parent.price || 14; why = `upsell : aligné sur le premier guide (${eur(parent.price)})`;
        } else {
          const sweet = suggested ?? median(anchors) ?? 19;
          price = Math.max(9, floorArm(PRICES, Math.min(sweet, median(anchors) ?? sweet))); why = `on commence bas (suggestion ${eur(sweet)}${anchors.length ? `, ancres clients ${eur(Math.min(...anchors))}–${eur(Math.max(...anchors))}` : ''})`;
        }
      } else if (reason === 'hausse') {
        // The ceiling is what buyers have shown they pay (priceCeiling), not the highest anchor anyone quoted.
        const { ceiling, why: limit } = priceCeiling(ctx.world, product);
        const up = stepArm(PRICES, previous, +1);
        price = up <= ceiling ? up : previous; why = up <= ceiling ? 'les avis sont bons : on monte d’un palier' : `plafond atteint (${limit}), on garde le prix`;
      } else {
        const lo = anchors.length ? Math.min(...anchors) * 0.5 : 0;
        const hi = anchors.length ? Math.max(...anchors) * 1.5 : 99;
        const arms = PRICE_ARMS.filter((a) => Number(a) >= lo && Number(a) <= hi);
        price = Number(learning.chooseArm(ctx.world, `price:${product.nicheId}`, arms.length ? arms : PRICE_ARMS, ctx.rng)); why = 'bandit de prix';
      }
      if (!Number.isFinite(price) || price <= 0) price = 14;
      // only the founder may sell a follow-up above what the guide it follows justifies
      const limit = reason === 'fondateur' ? null : followUpLimit(ctx.world, product);
      if (limit !== null && price > limit) { price = floorArm(PRICES, limit); why = `${why} ; suite plus légère que le premier guide (${eur(parent?.price ?? limit)}) : ${eur(price)}`; }
      price = round2(price);
      if (product.launchedDay) {
        const res = ctx.tools.setPrice(product.id, price);
        if (!res.ok) return { fail: `La boutique refuse le prix : ${res.message}`, summary: res.message };
      }
      product.price = price;
      const last = product.priceHistory[product.priceHistory.length - 1];
      if (!last || last.day !== ctx.world.day || last.price !== price) product.priceHistory.push({ day: ctx.world.day, price });
      if (product.status === 'qa' && product.salesPage) product.status = 'ready';
      await refreshSalesPage(ctx, product);
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
      // Never the same guide twice in a niche: a double is stopped here, whatever got it this far.
      const clash = nicheCollision(ctx.world, product);
      if (clash) {
        const reason = `Mise en ligne refusée : ${clash}`;
        if (product.status !== 'live') await killProduct(ctx, product, reason, task.assignee ?? officerId(ctx.world, 'shop'));
        return { fail: reason, summary: reason };
      }
      // The Red Team's verdict is a gate: no « go » (or signed waiver) on this version, no publication.
      const gate = redTeamGate(ctx.world, product);
      if (gate.state !== 'clear') {
        const waitFor = gate.state === 'waiting' ? gate.taskId : reopenGate(ctx, product, gate, task.missionId)?.id ?? null;
        return { summary: `Mise en ligne bloquée : ${gate.reason}.`, retryLater: gate.reason ?? 'revue de la Red Team', dependsOn: waitFor ? [waitFor] : [] };
      }
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
        speak(ctx, 'shop', `la boutique refuse la mise en ligne (${short(res.message, 80)})`, 'task_failed', { productId: product.id, taskId: task.id });
        return;
      }
      product.status = 'live';
      if (product.launchedDay === null) product.launchedDay = ctx.world.day;
      const shop = officerId(ctx.world, 'shop');
      say(ctx, shop, wasLive || republish
        ? `La v${product.version} de « ${short(product.title, 50)} » remplace l'ancienne en boutique`
        : `« ${short(product.title, 50)} » est en ligne à ${eur(product.price)} !`, 'deliverable', { productId: product.id, taskId: task.id });
      await productNote(ctx, product, shop, wasLive || republish ? `Version ${product.version} en ligne` : 'Mise en ligne', [
        `- Prix : ${eur(product.price)} · qualité PDF ${product.quality?.overall ?? '—'}/100 · page ${product.salesQuality?.overall ?? '—'}/100`,
        `- Fichiers : \`${product.files.pdf}\` · \`${product.files.salesPage}\``,
      ].join('\n'));
      // An upsell going live: the parent guide's last page now points to it.
      const parent = parentOf(ctx.world, product.id);
      if (parent && parent.status !== 'killed' && !wasLive) linkUpsell(ctx, parent, product, task.missionId);
    },
  },

  design_upsell: {
    async run(ctx, task, agent) {
      const parent = requireProduct(ctx, task);
      if (!parent) return NO_PRODUCT;
      const existing = productOf(ctx, parent.upsellProductId);
      if (existing && existing.status !== 'killed') return { summary: `L'upsell « ${short(existing.title, 50)} » existe déjà.`, skipReview: true, output: { upsellProductId: existing.id, existing: true } };
      const subject = pickUpsellSubject(ctx.world, parent, vocOf(ctx, parent.nicheId));
      if (!subject) {
        const why = `aucun sous-problème de la recherche n'est distinct de ce que la niche vend déjà`;
        await productNote(ctx, parent, agent.id, 'Upsell', `- Pas d'upsell : ${why}.`);
        return { summary: `Pas d'upsell pour « ${short(parent.title, 50)} » : ${why}.`, skipReview: true, output: { noSubject: true } };
      }
      const { problem, title } = subject;
      const upsell: Product = {
        id: nextId(ctx.world, 'prd'), nicheId: parent.nicheId,
        title, subtitle: `Pour aller plus loin après « ${short(parent.title, 60)} »`,
        audience: parent.audience, problem, price: 0, status: 'writing', version: 1,
        content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null },
        quality: null, salesQuality: null, upsellProductId: null, createdDay: ctx.world.day, launchedDay: null,
        stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
      };
      ctx.world.company.products.push(upsell);
      parent.upsellProductId = upsell.id;
      await productNote(ctx, parent, agent.id, 'Upsell', `- PDF suivant pour le même public : **${upsell.title}** — problème : ${problem}`);
      say(ctx, agent.id, `${agent.name} : les acheteurs de « ${short(parent.title, 40)} » veulent la suite → « ${short(problem, 60)} »`, 'thought', { productId: parent.id });
      return { summary: endLine(`Upsell conçu : ${short(problem, 80)}`), output: { upsellProductId: upsell.id, problem } };
    },
    async onDone(ctx, task) {
      if (task.output?.existing === true || task.output?.noSubject === true) return;
      const upsell = productOf(ctx, task.output?.upsellProductId);
      if (upsell && upsell.status !== 'killed') createUpsellPipeline(ctx, upsell, { createdBy: officerId(ctx.world, 'shop'), missionId: task.missionId, priority: 2 });
    },
  },
};
