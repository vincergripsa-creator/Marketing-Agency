/**
 * Quality gates before anything ships. Reviewers use the sim's heuristic scorers (the same ones the market
 * uses to convert) plus the playbooks: Samuel relit tout, Élise signe le fact-check, Zoé la couverture,
 * Léo les pubs, Clara les pages de vente, Camille les verdicts de la Red Team et la mise en ligne.
 */
import type { AgentState, ReviewNote, Task } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { productOf, runFileExists, vocOf } from './ctx.js';
import { sim } from './modules.js';
import { bannedHits, directivesOf } from './playbook.js';
import { excludedNiches } from './pipeline.js';
import { short, strArr, uniq } from './util.js';
import { creativeText } from './handlers/growth.js';
import { scoreContent } from './handlers/studio.js';

export const PDF_THRESHOLD = 68;
export const MAX_ATTEMPTS = 3;

export interface ReviewResult { verdict: ReviewNote['verdict']; notes: string[]; score: number | null }

const approve = (notes: string[] = [], score: number | null = null): ReviewResult => ({ verdict: 'approve', notes, score });
const changes = (notes: string[], score: number | null = null): ReviewResult => ({ verdict: 'changes', notes: notes.length ? notes : ['À retravailler.'], score });

export async function reviewTask(ctx: RuntimeCtx, task: Task, reviewer: AgentState): Promise<ReviewResult> {
  const product = productOf(ctx, task.input.productId);
  if (!product || product.status === 'killed') return approve(['Produit arrêté : rien à relire.']);
  switch (task.kind) {
    case 'write_pdf':
    case 'humanize_pdf': {
      if (!product.content) return changes(['Le texte du guide est vide.']);
      const q = scoreContent(ctx, product, product.content);
      product.quality = q;
      return q.overall >= PDF_THRESHOLD ? approve([`Qualité ${q.overall}/100 : bon pour la suite.`], q.overall) : changes(q.issues.slice(0, 4), q.overall);
    }
    case 'render_pdf': {
      if (!runFileExists(ctx, product.files.pdf) || !product.content) return changes(['Le fichier PDF est introuvable : relancer la mise en page.']);
      const q = sim.scorePdf(product.content, { audience: product.audience, problem: product.problem, voc: vocOf(ctx, product.nicheId), design: product.design });
      product.quality = q;
      return q.overall >= PDF_THRESHOLD ? approve([`Relecture finale : ${q.overall}/100.`], q.overall) : changes(q.issues.slice(0, 4), q.overall);
    }
    case 'fact_check': {
      if (!product.content) return changes(['Le guide est vide.']);
      const q = scoreContent(ctx, product, product.content);
      product.quality = q;
      if (q.compliance < 60) return changes([`Conformité trop faible (${q.compliance}/100) : retirer les promesses risquées.`, ...q.issues.slice(0, 2)], q.overall);
      return q.overall >= 62 ? approve([`Faits vérifiés, qualité ${q.overall}/100.`], q.overall) : changes(q.issues.slice(0, 3), q.overall);
    }
    case 'design_cover': {
      const notes: string[] = [];
      if (!runFileExists(ctx, product.files.cover)) return changes(['Le fichier de couverture est introuvable.']);
      if (product.title.length > 80) notes.push(`Titre long (${product.title.length} caractères) : vérifier la lisibilité en miniature.`);
      if (product.content) {
        const d = scoreContent(ctx, product, product.content).design;
        if (d < 50) return changes([`Design trop faible (${d}/100) : plus d'air, titre plus gros.`], d);
        return approve(notes, d);
      }
      return approve(notes.length ? notes : ['Couverture lisible, palette sobre.']);
    }
    case 'write_sales_page': {
      if (!product.salesPage) return changes(['La page de vente est vide.']);
      const q = sim.scoreSalesPage(product.salesPage, product);
      product.salesQuality = q;
      const banned = directivesOf(ctx.world, reviewer.id).banned;
      const text = [product.salesPage.headline, product.salesPage.subheadline, product.salesPage.solution, product.salesPage.guarantee, product.salesPage.cta, ...product.salesPage.painBullets].join(' ');
      const hits = bannedHits(text, banned);
      if (hits.length) return changes([`Expressions interdites : ${hits.join(', ')}.`], q.overall);
      if (q.compliance < 60) return changes([`Promesse risquée (conformité ${q.compliance}/100) : baisser le niveau de promesse.`, ...q.issues.slice(0, 2)], q.overall);
      if (q.promiseMatch < 55) return changes([`La page promet plus que le guide (adéquation ${q.promiseMatch}/100).`, ...q.issues.slice(0, 2)], q.overall);
      return q.overall >= 65 ? approve([`Page de vente ${q.overall}/100.`], q.overall) : changes(q.issues.slice(0, 4), q.overall);
    }
    case 'produce_ad': {
      const creative = ctx.world.company.creatives.find((c) => c.id === task.output?.creativeId);
      if (!creative) return changes(['Créa introuvable.']);
      const voc = vocOf(ctx, product.nicheId);
      const q = sim.scoreCreative(creative, product, voc);
      creative.quality = q;
      const banned = uniq([...directivesOf(ctx.world, reviewer.id).banned, ...voc.bannedClaims]);
      const hits = bannedHits(creativeText(creative), banned);
      if (hits.length) return changes([`Mots interdits par TikTok ou par notre playbook : ${hits.join(', ')}.`], q.overall);
      if (q.compliance < 65) return changes([`Risque de refus TikTok (conformité ${q.compliance}/100).`, ...q.issues.slice(0, 2)], q.overall);
      return q.overall >= 60 ? approve([`Pub ${q.overall}/100, prête pour TikTok.`], q.overall) : changes(q.issues.slice(0, 3), q.overall);
    }
    case 'red_team': {
      const out = task.output ?? {};
      const verdict = out.verdict;
      if (out.subject === 'idea' && verdict === 'kill') {
        const excluded = new Set([...excludedNiches(ctx, { includeActive: true }), product.nicheId]);
        const alternatives = ctx.world.company.research.shortlist.filter((id) => !excluded.has(id));
        if (!alternatives.length) {
          task.output = { ...out, finalVerdict: 'fix' };
          return approve(["Pas d'alternative solide dans la shortlist : on corrige l'angle plutôt que de tuer l'idée."]);
        }
        return approve([`Verdict « tuer » validé : ${short(strArr(out.reasons)[0] ?? 'risque trop élevé', 80)}.`]);
      }
      if (out.subject !== 'idea' && verdict !== 'go') {
        const q = product.quality?.overall ?? 0;
        if (q >= 72 && verdict === 'fix') {
          task.output = { ...out, finalVerdict: 'go' };
          return approve([`Le guide est à ${q}/100 : les remarques iront dans la v2, on ne bloque pas la sortie.`]);
        }
        task.output = { ...out, finalVerdict: 'fix' };
        return approve(['Correctifs de la Red Team validés avant la mise en ligne.']);
      }
      return approve([`Verdict « ${verdict === 'fix' ? 'corriger' : 'go'} » validé.`]);
    }
    case 'publish_product': {
      const notes: string[] = [];
      if (!runFileExists(ctx, product.files.pdf) || !runFileExists(ctx, product.files.salesPage)) return changes(['Fichiers manquants pour la mise en ligne.']);
      const pdf = product.quality?.overall ?? 0;
      const page = product.salesQuality?.overall ?? 0;
      if (pdf < 55 && task.attempts < MAX_ATTEMPTS - 1) return changes([`Guide trop faible pour sortir (${pdf}/100) : une passe de plus.`], pdf);
      notes.push(`Validé par ${reviewer.name} : PDF ${pdf}/100, page ${page}/100, prix ${product.price} €.`);
      return approve(notes, pdf);
    }
    default:
      return approve();
  }
}
