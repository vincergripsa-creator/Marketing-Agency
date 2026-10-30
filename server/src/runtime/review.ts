/**
 * Quality gates before anything ships. Reviewers use the sim's heuristic scorers (the same ones the market
 * uses to convert) plus the playbooks: Samuel relit tout, Élise signe le fact-check, Zoé la couverture,
 * Léo les pubs, Clara les pages de vente, Camille les verdicts de la Red Team et la mise en ligne.
 */
import type { AgentState, QualityReport, ReviewNote, Task } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { incident, productOf, runFileExists, say, vocOf } from './ctx.js';
import { sim } from './modules.js';
import { productNote } from './notes.js';
import { bannedHits, directivesOf } from './playbook.js';
import { excludedNiches, killProduct, pauseProduct } from './pipeline.js';
import { productPnls } from './accounting.js';
import { eur, short, strArr, sum, uniq } from './util.js';
import { creativeText } from './handlers/growth.js';
import { scoreContent } from './handlers/studio.js';

export const PDF_THRESHOLD = 68;
/** First try + 2 rework cycles; then closeLoop decides. */
export const MAX_ATTEMPTS = 3;

export interface ReviewResult {
  verdict: ReviewNote['verdict']; notes: string[]; score: number | null;
  /** The claim problem cannot ship on a waiver: at the end of the loop the deliverable is dropped. */
  noWaiver?: boolean;
}

const approve = (notes: string[] = [], score: number | null = null): ReviewResult => ({ verdict: 'approve', notes, score });
const changes = (notes: string[], score: number | null = null): ReviewResult => ({ verdict: 'changes', notes: notes.length ? notes : ['À retravailler.'], score });

type Dimension = NonNullable<QualityReport['blocking']>[number]['dimension'];
/** What a first draft is judged on: the wording and the claims are the job of the two passes that follow it. */
const DRAFT_DIMENSIONS: readonly Dimension[] = ['specificity', 'structure', 'actionability'];

/** What the scorer says cannot ship, whatever the global score. */
function blockers(q: QualityReport, dimensions?: readonly Dimension[]): string[] {
  return (q.blocking ?? []).filter((b) => !dimensions || dimensions.includes(b.dimension)).map((b) => b.text);
}

/**
 * End of a rework loop: never a silent approval. An ad that still breaks the rules is dropped before TikTok sees it,
 * a guide or a page that still does ends with the product; anything else ships on a logged waiver.
 */
export async function closeLoop(ctx: RuntimeCtx, task: Task, res: ReviewResult): Promise<ReviewResult> {
  const product = productOf(ctx, task.input.productId);
  const first = res.notes[0] ?? 'à retravailler';
  if (res.noWaiver && task.kind === 'produce_ad') {
    const creative = ctx.world.company.creatives.find((c) => c.id === task.output?.creativeId);
    if (creative) creative.review = { status: 'rejected', reason: `Retirée avant soumission : ${first}`, day: ctx.world.day };
    task.output = { ...(task.output ?? {}), dropped: true };
    incident(ctx, `Créa abandonnée après ${MAX_ATTEMPTS} tentatives (${first}) : elle n'ira pas chez TikTok`);
    return { verdict: 'approve', notes: [...res.notes, 'Créa abandonnée, le compte pub ne prend pas ce risque.'], score: res.score };
  }
  if (res.noWaiver && product && product.status !== 'live' && product.status !== 'killed') {
    await killProduct(ctx, product, `impossible de le rendre conforme en ${MAX_ATTEMPTS} tentatives (${first})`, 'camille');
    return { verdict: 'approve', notes: [...res.notes, 'Produit arrêté : il ne peut pas sortir en l’état.'], score: res.score };
  }
  // Already on sale with a page that breaks the rules: it leaves the store until the CEO's rework gives it a clean one.
  if (res.noWaiver && product?.status === 'live' && task.kind === 'write_sales_page') {
    await pauseProduct(ctx, product, `page de vente non conforme après ${MAX_ATTEMPTS} tentatives (${first})`, 'camille');
    return { verdict: 'approve', notes: [...res.notes, 'Produit retiré de la vente : la page ne peut pas rester en l’état.'], score: res.score };
  }
  task.output = { ...(task.output ?? {}), waiver: { day: ctx.world.day, by: task.reviewer, notes: res.notes.slice(0, 3) } };
  incident(ctx, `Dérogation : « ${task.title} » validé après ${MAX_ATTEMPTS} tentatives sans atteindre le niveau attendu${res.score !== null ? ` (${res.score}/100)` : ''} : ${first}`);
  if (product) await productNote(ctx, product, task.reviewer ?? 'camille', 'Dérogation de relecture', `- ${task.title} (jour ${ctx.world.day}) : ${res.notes.slice(0, 3).join(' ; ')}`);
  return { verdict: 'approve', notes: [...res.notes, `Dérogation après ${MAX_ATTEMPTS} tentatives : les défauts restants iront dans la prochaine version.`], score: res.score };
}

/** The CFO's check of the weekly P&L: the products plus the common costs must give the profit of the books. */
function reviewPnl(ctx: RuntimeCtx, task: Task): ReviewResult {
  const report = ctx.world.company.pnl?.find((r) => r.week === task.output?.week);
  if (!report) return changes(['Le P&L de la semaine est introuvable.']);
  const books = productPnls(ctx.world, report.fromDay, report.toDay).total;
  const sums = sum(report.products.map((p) => p.profit)) + report.unallocated;
  if (Math.abs(books - report.total) > 0.02 || Math.abs(sums - report.total) > 0.02) return changes([`Le P&L ne colle pas au grand livre : ${eur(report.total)} contre ${eur(books)}.`]);
  return approve([`P&L de la semaine ${report.week} relu : ${eur(report.total)}, conforme au grand livre.`]);
}

export async function reviewTask(ctx: RuntimeCtx, task: Task, reviewer: AgentState): Promise<ReviewResult> {
  if (task.kind === 'weekly_pnl') return reviewPnl(ctx, task);
  const product = productOf(ctx, task.input.productId);
  if (!product || product.status === 'killed') return approve(['Produit arrêté : rien à relire.']);
  switch (task.kind) {
    case 'write_pdf':
    case 'humanize_pdf': {
      if (!product.content) return changes(['Le texte du guide est vide.']);
      const q = scoreContent(ctx, product, product.content);
      product.quality = q;
      const blocked = blockers(q, DRAFT_DIMENSIONS);
      if (blocked.length) return changes(blocked.slice(0, 4), q.overall);
      return q.overall >= PDF_THRESHOLD ? approve([`Qualité ${q.overall}/100 : bon pour la suite.`], q.overall) : changes(q.issues.slice(0, 4), q.overall);
    }
    case 'render_pdf': {
      if (!runFileExists(ctx, product.files.pdf) || !product.content) return changes(['Le fichier PDF est introuvable : relancer la mise en page.']);
      const q = sim.scorePdf(product.content, { audience: product.audience, problem: product.problem, voc: vocOf(ctx, product.nicheId), design: product.design });
      product.quality = q;
      const blocked = blockers(q);
      if (blocked.length) return { ...changes(blocked.slice(0, 4), q.overall), noWaiver: q.compliance < 60 };
      return q.overall >= PDF_THRESHOLD ? approve([`Relecture finale : ${q.overall}/100.`], q.overall) : changes(q.issues.slice(0, 4), q.overall);
    }
    case 'fact_check': {
      if (!product.content) return changes(['Le guide est vide.']);
      const q = scoreContent(ctx, product, product.content);
      product.quality = q;
      if (q.compliance < 60) return { ...changes([`Conformité trop faible (${q.compliance}/100) : retirer les promesses risquées.`, ...q.issues.slice(0, 2)], q.overall), noWaiver: true };
      const claims = blockers(q, ['compliance']);
      if (claims.length) return changes(claims.slice(0, 3), q.overall);
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
      const q = sim.scoreSalesPage(product.salesPage, product, vocOf(ctx, product.nicheId));
      product.salesQuality = q;
      const banned = directivesOf(ctx.world, reviewer.id).banned;
      const text = [product.salesPage.headline, product.salesPage.subheadline, product.salesPage.solution, product.salesPage.guarantee, product.salesPage.cta, ...product.salesPage.painBullets].join(' ');
      const hits = bannedHits(text, banned);
      if (hits.length) return { ...changes([`Expressions interdites : ${hits.join(', ')}.`], q.overall), noWaiver: true };
      if (q.compliance < 60) return { ...changes([`Promesse risquée (conformité ${q.compliance}/100) : baisser le niveau de promesse.`, ...q.issues.slice(0, 2)], q.overall), noWaiver: true };
      const claims = blockers(q, ['compliance']);
      if (claims.length) return { ...changes(claims.slice(0, 4), q.overall), noWaiver: true };
      if (q.promiseMatch < 55) return changes([`La page promet plus que le guide (adéquation ${q.promiseMatch}/100).`, ...q.issues.slice(0, 2)], q.overall);
      const blocked = blockers(q);
      if (blocked.length) return changes(blocked.slice(0, 4), q.overall);
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
      if (hits.length) return { ...changes([`Mots interdits par TikTok ou par notre playbook : ${hits.join(', ')}.`], q.overall), noWaiver: true };
      if (q.compliance < 65) return { ...changes([`Risque de refus TikTok (conformité ${q.compliance}/100).`, ...q.issues.slice(0, 2)], q.overall), noWaiver: true };
      const blocked = blockers(q);
      if (blocked.length) return { ...changes(blocked.slice(0, 3), q.overall), noWaiver: true };
      return q.overall >= 60 ? approve([`Pub ${q.overall}/100, prête pour TikTok.`], q.overall) : changes(q.issues.slice(0, 3), q.overall);
    }
    case 'red_team': {
      const out = task.output ?? {};
      const verdict = out.verdict;
      if (out.subject === 'idea' && verdict === 'kill') {
        // The founder asked for this niche by name: the risk is the founder's to take, and nobody swaps the subject.
        const mission = ctx.world.company.missions.find((m) => m.id === task.missionId);
        if (mission?.wantsProduct && mission.nicheId === product.nicheId) {
          task.output = { ...out, finalVerdict: 'fix' };
          say(ctx, 'camille', `Camille au fondateur : la Red Team déconseille « ${short(product.title, 50)} » (${short(strArr(out.reasons)[0] ?? 'risque élevé', 90)}). C'est ta demande : on corrige l'angle au lieu de changer de sujet.`, 'founder', { productId: product.id, taskId: task.id });
          return approve(['Niche demandée par le fondateur : on corrige l’angle, le risque lui est signalé.']);
        }
        const excluded = new Set([...excludedNiches(ctx, { includeActive: true }), product.nicheId]);
        const alternatives = ctx.world.company.research.shortlist.filter((id) => !excluded.has(id));
        if (!alternatives.length) {
          task.output = { ...out, finalVerdict: 'fix' };
          return approve(["Pas d'alternative solide dans la shortlist : on corrige l'angle plutôt que de tuer l'idée."]);
        }
        return approve([`Verdict « tuer » validé : ${short(strArr(out.reasons)[0] ?? 'risque trop élevé', 80)}.`]);
      }
      // Camille confirms the Red Team, she never softens it: its verdict on a guide is what the gate reads.
      if (out.subject !== 'idea' && verdict === 'kill') return approve(['Verdict « tuer » validé : on repart du plan avant toute mise en ligne.']);
      if (out.subject !== 'idea' && verdict === 'fix') return approve(['Correctifs de la Red Team validés : nouvelle revue après correction.']);
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
