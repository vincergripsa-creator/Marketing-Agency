/** Création: SVG cover and final A4 PDF with visuals (real files on disk). */
import type { AgentState, DesignEffort, DesignSpec, Product, Task } from '../../shared.js';
import { coverScore } from '../../deliverables/art/evaluate.js';
import { effortFor } from '../../deliverables/effort.js';
import type { RuntimeCtx } from '../ctx.js';
import { absPath, addDeliverable, productBrief, productOf, readRunFile, say, versionDir, vocOf, writeRunFile } from '../ctx.js';
import { deliverables, learning, sim } from '../modules.js';
import { effectiveT } from '../talent/craft.js';
import { short, slugify, strArr } from '../util.js';
import type { HandlerMap } from './common.js';
import { NO_PRODUCT, requireProduct, reworkNotes, studioMind } from './common.js';
import { scoreContent } from './studio.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function ensureDesign(ctx: RuntimeCtx, product: Product, hint?: string): DesignSpec {
  if (product.design) return product.design;
  const brief = productBrief(ctx, product);
  product.design = deliverables.designFor({ nicheName: brief.name, category: brief.category, keywords: brief.keywords, seed: ctx.rng.int(1, 999_999), ...(hint ? { hint } : {}) });
  return product.design;
}

function coverInput(ctx: RuntimeCtx, product: Product) {
  return {
    title: product.title, subtitle: product.content?.subtitle || product.subtitle || '', audience: product.audience,
    design: ensureDesign(ctx, product), brand: ctx.world.company.name,
  };
}

export function coverSvgFor(ctx: RuntimeCtx, product: Product): string {
  return deliverables.renderCoverSvg(coverInput(ctx, product));
}

/**
 * What this designer brings to this task (pdf §13), null while the visual model is off (D32). `attempts` is the rework
 * that buys more candidates. Without a talent module, the level says it. The result stays here: it is the talent read
 * out, so only what they drew leaves this file, in `output` and in the feed.
 */
function effortOf(ctx: RuntimeCtx, task: Task, agent: AgentState): DesignEffort | null {
  const w = ctx.world;
  if (w.scenario.visualModel !== 'on') return null;
  return effortFor(w.scenario.control?.designTalent ?? effectiveT(w, agent, 'design') ?? (agent.level - 1) / (learning.MAX_LEVEL - 1), task.attempts);
}

/** The pages the shop window shows, cut from the render and never mocked (pdf §11.5), next to the guide. */
async function writePreviews(ctx: RuntimeCtx, product: Product, previews: { label: string; svg: string }[]): Promise<string[]> {
  const paths: string[] = [];
  for (const [i, preview] of previews.entries()) {
    const rel = `${versionDir(product)}/previews/${String(i + 1).padStart(2, '0')}-${slugify(preview.label)}.svg`;
    await writeRunFile(ctx, rel, preview.svg);
    paths.push(rel);
  }
  return paths;
}

/** Cover of the current version: the title and the subtitle arrive after the first drawing, so it always follows them. */
export async function ensureCoverFile(ctx: RuntimeCtx, product: Product): Promise<string> {
  const rel = `${versionDir(product)}/cover.svg`;
  const svg = coverSvgFor(ctx, product);
  if (product.files.cover !== rel || (await readRunFile(ctx, rel)) !== svg) await writeRunFile(ctx, rel, svg);
  product.files.cover = rel;
  return svg;
}

export function upsellLink(ctx: RuntimeCtx, product: Product): { title: string; url: string } | null {
  const next = productOf(ctx, product.upsellProductId);
  // only what can be bought today: the last page is printed for the catalogue of the day
  if (next?.status !== 'live') return null;
  const page = next.files.salesPage ?? `${versionDir(next)}/sales-page.html`;
  return { title: next.title, url: `/runs/${ctx.world.runId}/${page}` };
}

export const creationHandlers: HandlerMap = {
  design_cover: {
    async run(ctx, task, agent) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const brief = productBrief(ctx, product);
      const notes = reworkNotes(task);
      const hint = [str0(task.input.hint), task.attempts > 0 ? 'variante plus épurée, titre plus gros' : '', notes[0] ?? ''].filter(Boolean).join(' ; ');
      product.design = deliverables.designFor({ nicheName: brief.name, category: brief.category, keywords: brief.keywords, seed: ctx.rng.int(1, 999_999), ...(hint ? { hint } : {}) });
      const effort = effortOf(ctx, task, agent);
      if (effort) {
        const art = deliverables.pickArt(product.design, effort);
        product.design.artSeed = art.seed;
        product.artExplored = art.explored;
      }
      const svg = coverSvgFor(ctx, product);
      const rel = `${versionDir(product)}/cover.svg`;
      await writeRunFile(ctx, rel, svg);
      product.files.cover = rel;
      if (product.status === 'writing' || product.status === 'research') product.status = 'design';
      const cover = effort ? coverScore(deliverables.coverAudit(coverInput(ctx, product))) : null;
      const designScore = cover ?? (product.content ? scoreContent(ctx, product, product.content).design : null);
      addDeliverable(ctx, { kind: 'cover', title: `Couverture « ${short(product.title, 50)} » (v${product.version})`, productId: product.id, creativeId: null, path: rel, createdBy: agent.id, quality: designScore }, task);
      say(ctx, agent.id, `${agent.name} : couverture ${product.design.coverLayout}, motif ${product.design.motif}, palette ${product.design.palette.primary}${cover === null ? '' : `, ${Math.round(cover)}/100`}`, 'thought', { productId: product.id });
      return { summary: `Couverture dessinée (${product.design.coverLayout}, motif ${product.design.motif}).`, output: { path: rel, layout: product.design.coverLayout, motif: product.design.motif, ...(cover === null ? {} : { cover }) } };
    },
  },

  render_pdf: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      if (!product.content) return { fail: 'Impossible de mettre en page : le texte du guide manque.', summary: 'Pas de contenu.' };
      const voc = vocOf(ctx, product.nicheId);
      // A rework asked by the reviewer: one more humanization pass before re-rendering.
      if (task.attempts > 0 || strArr(task.input.fixes).length) {
        const before = scoreContent(ctx, product, product.content);
        const improved = await ctx.engine.humanize({ content: product.content, flagged: [...reworkNotes(task), ...before.issues].slice(0, 12), voc }, studioMind(ctx, task, mind));
        if (scoreContent(ctx, product, improved).overall >= before.overall) product.content = improved;
      }
      if (product.upsellProductId && product.content.nextStep) product.content.nextStep.upsellProductId = product.upsellProductId;
      const design = ensureDesign(ctx, product);
      await ensureCoverFile(ctx, product);
      const rel = `${versionDir(product)}/guide.pdf`;
      const outFile = absPath(ctx, rel);
      await mkdir(dirname(outFile), { recursive: true });
      const effort = effortOf(ctx, task, agent);
      const res = await deliverables.renderPdf({ product, content: product.content, design, brand: ctx.world.company.name, outFile, upsell: upsellLink(ctx, product), ...(effort ? { effort } : {}) });
      product.files.pdf = rel;
      product.pdfFacts = { pages: res.pages, sheets: res.audit.sheets };
      delete product.pagePrint; // the page shows this render: it follows at the end of the tick
      if (effort) {
        product.visual = deliverables.visualReport(res.audit, deliverables.coverAudit(coverInput(ctx, product)), effort, product.artExplored ?? 1);
        product.files.previews = await writePreviews(ctx, product, res.previews);
      }
      const q = sim.scorePdf(product.content, { audience: product.audience, problem: product.problem, voc, design, visual: product.visual });
      product.quality = q;
      if (product.status !== 'live' && product.status !== 'paused') product.status = 'qa';
      const reason = task.input.reason === 'upsell_link' ? ' — lien « La suite est ici » ajouté' : '';
      addDeliverable(ctx, { kind: 'pdf', title: `Guide « ${short(product.title, 50)} » (v${product.version}, ${res.pages} pages)${reason}`, productId: product.id, creativeId: null, path: rel, createdBy: agent.id, quality: q.overall }, task);
      return {
        summary: `PDF de ${res.pages} pages (${Math.round(res.bytes / 1024)} Ko) — qualité ${q.overall}/100${reason}.`,
        output: { path: rel, pages: res.pages, bytes: res.bytes, score: q.overall, ...(effort ? { visual: product.visual!.overall } : {}) },
      };
    },
  },
};

function str0(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
