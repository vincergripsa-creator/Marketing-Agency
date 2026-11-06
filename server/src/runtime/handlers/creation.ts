/** Création: SVG cover and final A4 PDF with visuals (real files on disk), the look of a guide and its refresh (design plan D203, D204). */
import type { AgentState, ArtStyle, DesignEffort, DesignSpec, Product, Task } from '../../shared.js';
import type { MindContext, Rng } from '../../contracts.js';
import { hashString, streamRng } from '../../core/index.js';
import { coverScore } from '../../deliverables/art/evaluate.js';
import { compositionOf, styleDef } from '../../deliverables/art/styles/index.js';
import { effortFor } from '../../deliverables/effort.js';
import { chooseLook, LOOK_ARMS, logLook, lookIn, lookLabel, looksOn, REFRESH_WORD, shelfOf, type LookChoice } from '../../learning/looks.js';
import type { RuntimeCtx } from '../ctx.js';
import { absPath, addDeliverable, nicheName, productBrief, productOf, readRunFile, say, versionDir, vocOf, writeRunFile } from '../ctx.js';
import { deliverables, learning, sim } from '../modules.js';
import { directivesOf } from '../playbook.js';
import { STREAM } from '../streams.js';
import { effectiveT } from '../talent/craft.js';
import { short, slugify, strArr } from '../util.js';
import type { HandlerMap } from './common.js';
import { NO_PRODUCT, requireProduct, reworkNotes, studioMind } from './common.js';
import { scoreContent } from './studio.js';
import { mkdir, rm } from 'node:fs/promises';
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
  return effortFor(designTalent(ctx, agent), task.attempts);
}

function designTalent(ctx: RuntimeCtx, agent: AgentState): number {
  const w = ctx.world;
  return w.scenario.control?.designTalent ?? effectiveT(w, agent, 'design') ?? (agent.level - 1) / (learning.MAX_LEVEL - 1);
}

// ───────────────────────────── looks (D203) ─────────────────────────────

/**
 * The design stream of one decision. An agent runs one handler a tick, so (day, tick, agent) already is the task, `purpose` names
 * the draw. Never the company's stream: a control arm without looks keeps every other draw of the default arm.
 */
export function designRng(ctx: RuntimeCtx, agentId: string, purpose: string, use = 0): Rng {
  const w = ctx.world;
  return streamRng(w.scenario.seed, STREAM.design, w.day, w.tick, hashString(agentId), use, hashString(purpose));
}

/** Talent reads the design bandits as it reads the hooks (talent §4.8), on the design stream: the craft of the task's own skill. */
export function lookSharp(ctx: RuntimeCtx, agent: AgentState, mind: MindContext, purpose: string): { samples: number; rng: Rng } | undefined {
  return mind.craft ? { samples: mind.craft.sharp, rng: designRng(ctx, agent.id, `sharp:${purpose}`, 2) } : undefined;
}

/** What a founder's words name in a task: its hint, or the text of their mission. */
export function founderWords(task: Task): string {
  return `${str0(task.input.hint)} ${str0(task.input.missionText)}`;
}

/**
 * The composition the designer keeps (D203): the foundation's own choice among the style's real compositions (`pickComposition`),
 * as many examined as their eye allows, judged on the real cover. `avoid` is the one a refresh that keeps its style leaves.
 */
function compositionFor(ctx: RuntimeCtx, task: Task, agent: AgentState, product: Product, style: ArtStyle, avoid?: number): number {
  const { composition: _worn, ...design } = product.design!; // another style's index means nothing to this one
  const input = { ...coverInput(ctx, product), design: { ...design, style } };
  return deliverables.pickComposition(input, effortFor(designTalent(ctx, agent), task.attempts), avoid === undefined ? {} : { avoid }).composition;
}

interface CoverLook { style: ArtStyle; composition: number; why: string; source: LookChoice['source'] }

/**
 * The style and composition of a cover (D203), null while looks are off (visual model off, `designV1`). In order: the founder's
 * hint, a playbook rule for the niche, a Thompson draw on `cover_style:<niche>`, now and then the least-tried style. A rework keeps
 * its style: the reviewer asked for legibility, not another look. `exclude` is what the evidence says to leave, `worn` the look a
 * refresh replaces: kept, its style gets another of its compositions.
 */
function coverLook(ctx: RuntimeCtx, task: Task, agent: AgentState, mind: MindContext, product: Product, exclude: readonly string[] = [], worn?: { style: ArtStyle; composition: number }): CoverLook | null {
  const w = ctx.world;
  if (!looksOn(w) || !product.design) return null;
  const kept = task.attempts > 0 ? str0(task.output?.style) : '';
  const choice: LookChoice | null = LOOK_ARMS.style.includes(kept)
    ? { key: kept, source: 'keep', why: 'même style, la reprise ne porte que sur la lisibilité' }
    : chooseLook(w, {
      kind: 'style', nicheId: product.nicheId, shelf: shelfOf(w, product, product.nicheId), eligible: LOOK_ARMS.style,
      founder: lookIn('style', founderWords(task)), rule: directivesOf(w, agent.id, nicheName(ctx, product.nicheId)).coverStyle, exclude,
      rng: designRng(ctx, agent.id, 'style'), sharp: lookSharp(ctx, agent, mind, 'style'),
    });
  if (!choice) return null;
  const style = choice.key as ArtStyle;
  return { style, composition: compositionFor(ctx, task, agent, product, style, worn?.style === style ? worn.composition : undefined), why: choice.why, source: choice.source };
}

/** Under this a refreshed cover is drawn again with more candidates, as the art director's review would send it back (pdf §13). */
const REFRESH_COVER_MIN = 60;

/**
 * The pages the shop window shows, cut from the render and never mocked (pdf §11.5), next to the guide. The ones they replace
 * go: a page reads only the guide's current ones, and the page of an older version holds its own inlined.
 */
export async function writePreviews(ctx: RuntimeCtx, product: Product, previews: { label: string; svg: string }[]): Promise<string[]> {
  const paths: string[] = [];
  for (const [i, preview] of previews.entries()) {
    const rel = `${versionDir(product)}/previews/${String(i + 1).padStart(2, '0')}-${slugify(preview.label)}.svg`;
    await writeRunFile(ctx, rel, deliverables.compactPaths(preview.svg));
    paths.push(rel);
  }
  for (const rel of product.files.previews ?? []) if (!paths.includes(rel)) await rm(absPath(ctx, rel), { force: true });
  return paths;
}

/** Cover of the current version: the title and the subtitle arrive after the first drawing, so it always follows them. */
export async function ensureCoverFile(ctx: RuntimeCtx, product: Product): Promise<string> {
  const rel = `${versionDir(product)}/cover.svg`;
  const svg = coverSvgFor(ctx, product);
  const file = deliverables.compactPaths(svg);
  if (product.files.cover !== rel || (await readRunFile(ctx, rel)) !== file) await writeRunFile(ctx, rel, file);
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
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const brief = productBrief(ctx, product);
      const notes = reworkNotes(task);
      const hint = [str0(task.input.hint), task.attempts > 0 ? 'variante plus épurée, titre plus gros' : '', notes[0] ?? ''].filter(Boolean).join(' ; ');
      product.design = deliverables.designFor({ nicheName: brief.name, category: brief.category, keywords: brief.keywords, seed: ctx.rng.int(1, 999_999), ...(hint ? { hint } : {}) });
      const look = coverLook(ctx, task, agent, mind, product);
      if (look) Object.assign(product.design, { style: look.style, composition: look.composition });
      const effort = effortOf(ctx, task, agent);
      if (effort) {
        const art = deliverables.pickArt(product.design, effort);
        product.design.artSeed = art.seed;
        product.artExplored = art.explored;
      }
      const svg = coverSvgFor(ctx, product);
      const rel = `${versionDir(product)}/cover.svg`;
      await writeRunFile(ctx, rel, deliverables.compactPaths(svg));
      product.files.cover = rel;
      if (product.status === 'writing' || product.status === 'research') product.status = 'design';
      const cover = effort ? coverScore(deliverables.coverAudit(coverInput(ctx, product))) : null;
      const designScore = cover ?? (product.content ? scoreContent(ctx, product, product.content).design : null);
      addDeliverable(ctx, { kind: 'cover', title: `Couverture « ${short(product.title, 50)} » (v${product.version})`, productId: product.id, creativeId: null, path: rel, createdBy: agent.id, quality: designScore }, task);
      const drawn = `couverture ${product.design.coverLayout}, motif ${product.design.motif}, palette ${product.design.palette.primary}${cover === null ? '' : `, ${Math.round(cover)}/100`}`;
      if (look) logLook(product, ctx.world.day, `${lookLabel('style', look.style)} : ${look.why}`);
      // one line either way: the feed spends ids, and a control arm without looks must keep the same ones
      say(ctx, agent.id, look ? `${agent.name} choisit le style « ${lookLabel('style', look.style)} » : ${look.why} (${drawn})` : `${agent.name} : ${drawn}`, 'thought', { productId: product.id });
      return {
        summary: look ? `Couverture dessinée en style « ${lookLabel('style', look.style)} » (${product.design.coverLayout}, motif ${product.design.motif}).` : `Couverture dessinée (${product.design.coverLayout}, motif ${product.design.motif}).`,
        output: { path: rel, layout: product.design.coverLayout, motif: product.design.motif, ...(cover === null ? {} : { cover }), ...(look ? { style: look.style, composition: look.composition, styleSource: look.source } : {}) },
      };
    },
  },

  refresh_design: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      if (!looksOn(ctx.world) || !product.design) return { summary: 'Pas de refonte : ce guide garde le look de la V1.', skipReview: true, output: { skipped: true } };
      const before = product.design.style ?? 'bauhaus';
      const worn = { style: before, composition: compositionOf(product.design, styleDef(before)) };
      const look = coverLook(ctx, task, agent, mind, product, task.input.excludeStyle === true ? [before] : [], worn);
      if (!look) return { summary: 'Pas de refonte : aucun style possible.', skipReview: true, output: { skipped: true } };
      // same palette, motif and seed: the guide changes its art direction, not its identity
      product.design = { ...product.design, style: look.style, composition: look.composition };
      const effort = effortOf(ctx, task, agent);
      let cover: number | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (effort) {
          const art = deliverables.pickArt(product.design, attempt ? effortFor(designTalent(ctx, agent), task.attempts + attempt) : effort);
          product.design.artSeed = art.seed;
          product.artExplored = art.explored;
        }
        cover = effort ? coverScore(deliverables.coverAudit(coverInput(ctx, product))) : null;
        if (cover === null || cover >= REFRESH_COVER_MIN) break;
      }
      const rel = `${versionDir(product)}/cover.svg`;
      await writeRunFile(ctx, rel, deliverables.compactPaths(coverSvgFor(ctx, product)));
      product.files.cover = rel;
      const [now, was] = [lookLabel('style', look.style), lookLabel('style', before)];
      const drawn = styleDef(look.style).compositions[look.composition]?.label;
      const change = look.style === before ? `style « ${now} » gardé, nouvelle composition${drawn ? ` « ${drawn} »` : ''}` : `style « ${now} » au lieu de « ${was} »`;
      logLook(product, ctx.world.day, `${REFRESH_WORD} v${product.version} : ${change} — ${look.why}`, true);
      addDeliverable(ctx, { kind: 'cover', title: `Couverture « ${short(product.title, 50)} » (v${product.version}, refonte)`, productId: product.id, creativeId: null, path: rel, createdBy: agent.id, quality: cover }, task);
      say(ctx, agent.id, `${agent.name} refait le look de « ${short(product.title, 50)} » : ${change}, ${look.why}${cover === null ? '' : ` (${Math.round(cover)}/100)`}`, 'thought', { productId: product.id });
      return {
        summary: `Refonte visuelle v${product.version} : ${change}.`,
        output: { path: rel, style: look.style, composition: look.composition, previous: before, styleSource: look.source, ...(cover === null ? {} : { cover }) },
      };
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
