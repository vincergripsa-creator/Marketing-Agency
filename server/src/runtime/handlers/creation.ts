/** Création: SVG cover and final A4 PDF with visuals (real files on disk). */
import type { DesignSpec, Product } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';
import { absPath, addDeliverable, productBrief, productOf, readRunFile, runFileExists, say, versionDir, vocOf, writeRunFile } from '../ctx.js';
import { deliverables, sim } from '../modules.js';
import { short, strArr } from '../util.js';
import type { HandlerMap } from './common.js';
import { NO_PRODUCT, requireProduct, reworkNotes, studioMind } from './common.js';
import { scoreContent } from './studio.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function ensureDesign(ctx: RuntimeCtx, product: Product, hint?: string): DesignSpec {
  if (product.design) return product.design;
  const brief = productBrief(ctx, product);
  product.design = deliverables.designFor({ nicheName: brief.name, category: brief.category, seed: ctx.rng.int(1, 999_999), ...(hint ? { hint } : {}) });
  return product.design;
}

export function coverSvgFor(ctx: RuntimeCtx, product: Product): string {
  return deliverables.renderCoverSvg({
    title: product.title, subtitle: product.subtitle || product.content?.subtitle || '', audience: product.audience,
    design: ensureDesign(ctx, product), brand: ctx.world.company.name,
  });
}

/** Cover of the current version (re-rendered into the version folder when missing). */
export async function ensureCoverFile(ctx: RuntimeCtx, product: Product): Promise<string> {
  const rel = `${versionDir(product)}/cover.svg`;
  if (product.files.cover === rel && runFileExists(ctx, rel)) return (await readRunFile(ctx, rel)) ?? coverSvgFor(ctx, product);
  const svg = coverSvgFor(ctx, product);
  await writeRunFile(ctx, rel, svg);
  product.files.cover = rel;
  return svg;
}

function upsellLink(ctx: RuntimeCtx, product: Product): { title: string; url: string } | null {
  const next = productOf(ctx, product.upsellProductId);
  if (!next || next.status === 'killed') return null;
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
      product.design = deliverables.designFor({ nicheName: brief.name, category: brief.category, seed: ctx.rng.int(1, 999_999), ...(hint ? { hint } : {}) });
      const svg = coverSvgFor(ctx, product);
      const rel = `${versionDir(product)}/cover.svg`;
      await writeRunFile(ctx, rel, svg);
      product.files.cover = rel;
      if (product.status === 'writing' || product.status === 'research') product.status = 'design';
      const designScore = product.content ? scoreContent(ctx, product, product.content).design : null;
      addDeliverable(ctx, { kind: 'cover', title: `Couverture « ${short(product.title, 50)} » (v${product.version})`, productId: product.id, creativeId: null, path: rel, createdBy: agent.id, quality: designScore }, task);
      say(ctx, agent.id, `${agent.name} : couverture ${product.design.coverLayout}, motif ${product.design.motif}, palette ${product.design.palette.primary}`, 'thought', { productId: product.id });
      return { summary: `Couverture dessinée (${product.design.coverLayout}, motif ${product.design.motif}).`, output: { path: rel, layout: product.design.coverLayout, motif: product.design.motif } };
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
      const res = await deliverables.renderPdf({ product, content: product.content, design, brand: ctx.world.company.name, outFile, upsell: upsellLink(ctx, product) });
      product.files.pdf = rel;
      const q = sim.scorePdf(product.content, { audience: product.audience, problem: product.problem, voc, design });
      product.quality = q;
      if (product.status !== 'live' && product.status !== 'paused') product.status = 'qa';
      const reason = task.input.reason === 'upsell_link' ? ' — lien « La suite est ici » ajouté' : '';
      addDeliverable(ctx, { kind: 'pdf', title: `Guide « ${short(product.title, 50)} » (v${product.version}, ${res.pages} pages)${reason}`, productId: product.id, creativeId: null, path: rel, createdBy: agent.id, quality: q.overall }, task);
      return {
        summary: `PDF de ${res.pages} pages (${Math.round(res.bytes / 1024)} Ko) — qualité ${q.overall}/100${reason}.`,
        output: { path: rel, pages: res.pages, bytes: res.bytes, score: q.overall },
      };
    },
  },
};

function str0(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
