/**
 * The real A4 guide: what its pages say, true for the catalogue of the day, and the file. Layout lives in `layout/`
 * (blocks, then `paginate`), drawing in `pages/render.ts`. A render reads no clock and no RNG: same guide, same bytes.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import PDFDocument from 'pdfkit';
import type { PdfAudit } from '../contracts.js';
import type { ChapterContent, DesignEffort, DesignSpec, PdfContent, Product } from '../shared.js';
import { coverScene } from './cover.js';
import { familyOfText, normalizeDesign, professionalFor } from './design.js';
import { effortFor } from './effort.js';
import { loadVoice, registerVoice } from './fonts.js';
import { arr } from './layout/blocks.js';
import { layoutGuide, previewsOf, type ChapterSpec, type Guide, type GuideSpec } from './pages/render.js';
import { themeFor } from './pdfVisuals.js';
import { toPdf } from './scene.js';
import { normalizeKey, sanitizePdfText } from './text.js';
import type { Voice } from './voices.js';

export { MIN_PAGE_FILL } from './layout/grid.js';

const NO_MARGINS = { top: 0, bottom: 0, left: 0, right: 0 };
/** Fixed: same content gives the same bytes, which `pages` and `bytes` in the world rest on. */
const CREATED = new Date(Date.UTC(2026, 0, 1));
const DEFAULT_TALENT = 0.3;

const S = sanitizePdfText;

/** The callout says what the text is: the writers announce a made-up case (« Exemple type : ») and it is never called real. */
function exampleParts(text: string | null | undefined): { label: string; text: string } {
  const s = S(text ?? '');
  const m = /^(exemple type|mise en situation)\s*:\s*/iu.exec(s);
  if (!m) return { label: 'Exemple type', text: s };
  const rest = s.slice(m[0].length);
  return { label: m[1]!, text: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

/** Lowercase, accent-free, straight apostrophes — to compare texts (« Le chiot… » vs « le chiot… »). */
function keyOf(s: string): string {
  return normalizeKey(S(s)).replace(/[’`´]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface FinalWording {
  heading: string; subtitle: string; paragraphs: string[];
  cta: string | null;   // null: no button (nothing to link to)
  dest: string | null;  // inside the guide, when there is no shop page to link to
  under: string;
}

/** A sentence about a guide that does not exist yet: it was true when the text was written, not any more once one is linked. */
const FUTURE_GUIDE = /si un guide|prochain guide|guide suivant|en préparation|vous serez prévenu|vous en serez informé/iu;
/** A sentence selling a next guide: without one in the shop, it promises something the reader cannot get. */
const SELLS_GUIDE = /prochain guide|guide suivant|en préparation|vous serez prévenu|sur notre boutique|disponible sur|déjà disponible/iu;

const sentencesOf = (text: string): string[] => S(text).split(/\n+/).flatMap((p) => p.split(/(?<=[.!?…])\s+(?=[«\p{Lu}])/u)).map((s) => s.trim()).filter(Boolean);

/**
 * The last page, true for the catalogue of the day whatever the stored text says: that text is written with the
 * guide, and a follow-up may have been linked (or killed) since. Guillemets of a title become “ ” inside the button's.
 */
export function finalWording(content: Pick<PdfContent, 'nextStep'>, upsell: { title: string; url: string } | null | undefined, plan: { dest: string; label: string } | null): FinalWording {
  const next = content.nextStep ?? { title: '', text: '', upsellProductId: null };
  const title = S(upsell?.title ?? '').replace(/^la\s+suite\s+est\s+ici\s*(?:[:—–-]\s*)?/i, '').trim();
  const stored = S(next.text);
  if (!title) {
    const kept = sentencesOf(stored).filter((s) => !SELLS_GUIDE.test(s));
    return {
      heading: 'Votre prochaine étape', subtitle: '',
      paragraphs: kept.length ? [kept.join(' ')] : ['Il reste une chose à faire : ouvrir le plan à la première ligne, et noter ce qui change.'],
      cta: plan?.label ?? null, dest: plan?.dest ?? null, under: '',
    };
  }
  // absolute store URL, or a run-relative one ("/runs/<id>/files/…/sales-page.html") resolved by the viewer
  const rawUrl = String(upsell?.url ?? '').trim();
  const url = /^https?:\/\//i.test(rawUrl) || /^\.{0,2}\/(?!\/)/.test(rawUrl) ? rawUrl : null;
  const plain = title.replace(/«\s*/g, '“').replace(/\s*»/g, '”');
  const named = keyOf(stored).includes(keyOf(title));
  const body = named ? stored.split(/\n+/).map((s) => s.trim()).filter(Boolean) : [[
    ...sentencesOf(stored).filter((s) => !FUTURE_GUIDE.test(s)),
    'Si vous voulez aller plus loin, ce guide traite un autre point, à part, dans le même format.',
  ].join(' ')];
  return {
    heading: 'La suite est ici', subtitle: title, paragraphs: body,
    cta: url ? `Découvrir « ${plain} »` : null, dest: null,
    under: url ? (/^https?:/i.test(url) ? url.replace(/^https?:\/\//i, '') : 'Disponible sur notre boutique') : '',
  };
}

/** The plan to go back to when no follow-up guide exists: the last chapter that holds a sheet. */
function planTarget(content: PdfContent): { dest: string; label: string } | null {
  const chapters = arr(content.chapters);
  if (!chapters.length) return null;
  const at = chapters.map((c) => c.visual?.type === 'grid').lastIndexOf(true);
  return at >= 0 ? { dest: `chapitre-${at + 1}`, label: 'Je reviens à mon plan' } : { dest: 'chapitre-1', label: 'Je reviens au premier chapitre' };
}

const BONUS_PREFIX = /^bonus\s*(?:offert\s*)?[:—–-]\s*/i;

function chapterSpec(ch: ChapterContent, n: number | null): ChapterSpec {
  const title = S(ch?.title) || (n === null ? 'Bonus' : `Chapitre ${n}`);
  const example = exampleParts(ch?.example);
  const rest = title.replace(BONUS_PREFIX, '');
  return {
    content: ch, title,
    head: n === null ? `Bonus · ${rest}` : title,
    listed: n === null ? (rest.charAt(0).toUpperCase() + rest.slice(1) || title) : title, // the contents page prints the label « Bonus » above it
    example: example.text ? example : null,
  };
}

/** The pull-quote of the problem, unless the text already says it or it IS the promise / the title (upsell guides). */
function introQuote(problem: string, paragraphs: string[], promise: string, title: string): string | null {
  const pk = keyOf(problem);
  const shown = !!problem && pk.length > 0
    && !paragraphs.some((p) => keyOf(p).includes(pk))
    && !keyOf(promise).includes(pk) && !pk.includes(keyOf(promise) || '\u0000')
    && !keyOf(title).includes(pk);
  return shown ? problem : null;
}

/** What every page says, decided once: the renderer does not read the product. */
function guideSpec(product: Product, content: PdfContent, design: DesignSpec, brand: string, upsell: { title: string; url: string } | null | undefined): GuideSpec {
  const title = S(content.title || product.title);
  const audience = S(content.audience || product.audience);
  const intro = arr(content.introduction).map(S).filter(Boolean);
  const paragraphs = intro.length ? intro : [S(product.problem)].filter(Boolean);
  const promise = S(content.promise);
  const say = finalWording(content, upsell, planTarget(content));
  const family = design.family ?? familyOfText(`${product.title} ${product.audience} ${product.problem}`);
  return {
    design,
    cover: coverScene({ title, subtitle: S(content.subtitle || product.subtitle), audience, design, brand: S(brand) }).scene,
    audience, brand,
    promise: promise || S(product.subtitle),
    // the box says what the introduction says: a project is read whole before buying, a habit one chapter at a time
    howTo: content.howTo?.length === 3 ? content.howTo.map(([head, text]) => [S(head), S(text)] as const) : [
      ['Suivez l’ordre du guide', 'Chaque chapitre prépare le suivant.'],
      ['Appliquez au fur et à mesure', 'Les étapes sont faites pour être utilisées, pas seulement lues.'],
      ['Cochez la checklist', 'Elle vous dit où vous en êtes.'],
    ],
    intro: { paragraphs, quote: introQuote(S(product.problem), paragraphs, promise, content.title), box: promise || null },
    chapters: arr(content.chapters).map((ch, k) => chapterSpec(ch, k + 1)),
    bonus: content.bonus && (content.bonus.title || arr(content.bonus.paragraphs).length) ? chapterSpec(content.bonus, null) : null,
    final: {
      heading: say.heading, subtitle: say.subtitle, paragraphs: say.paragraphs,
      cta: say.cta ? { label: say.cta, dest: say.dest, url: say.dest ? null : String(upsell?.url ?? '').trim(), under: say.under } : null,
      thanks: `Merci de votre confiance. Si ce guide vous a aidé, dites-le-nous : chaque retour nous aide à l’améliorer pour la prochaine version. — L’équipe ${S(brand)}`,
      disclaimer: `Ce guide est fourni à titre informatif et pédagogique. Il ne remplace pas l’avis ${professionalFor(family)}, adapté à votre situation. Version ${Math.max(1, Math.trunc(product.version || 1))}.`,
    },
  };
}

function writePages(doc: PDFKit.PDFDocument, guide: Guide): void {
  for (const page of guide.pages) {
    doc.addPage({ size: 'A4', margins: NO_MARGINS });
    toPdf(doc, page.scene, 0, 0, page.scale);
    if (page.dest) {
      doc.addNamedDestination(page.dest);
      doc.outline.addItem(page.outline ?? page.dest);
    }
    for (const l of page.links) {
      if (l.dest) doc.goTo(l.x, l.y, l.w, l.h, l.dest);
      else if (l.url) doc.link(l.x, l.y, l.w, l.h, l.url);
    }
  }
}

export interface PdfInput { product: Product; content: PdfContent; design: DesignSpec; brand: string; upsell?: { title: string; url: string } | null; effort?: DesignEffort }

/** Every page of the guide, drawn, and nothing written: what a render will print. */
export function layoutPdf(input: PdfInput): Guide & { degraded: boolean; voice: Voice } {
  const { product } = input;
  const content: PdfContent = input.content ?? (product.content as PdfContent);
  if (!content) throw new Error('renderPdf : contenu du guide manquant');
  const design = normalizeDesign(input.design ?? product.design);
  const { voice, degraded } = loadVoice(design.voice!);
  const spec = guideSpec(product, content, design, (input.brand || 'Pixel Agency').trim(), input.upsell);
  return { ...layoutGuide(spec, themeFor(design, voice), input.effort ?? effortFor(DEFAULT_TALENT)), degraded, voice };
}

/** Renders the full guide to `outFile` (parent folders created). Resolves with its page count, size, audit and previews. */
export async function renderPdf(input: PdfInput & { outFile: string }): Promise<{ pages: number; bytes: number; audit: PdfAudit; previews: { label: string; svg: string }[] }> {
  const { product, outFile } = input;
  const guide = layoutPdf(input);
  const content: PdfContent = input.content ?? (product.content as PdfContent);
  const brand = (input.brand || 'Pixel Agency').trim();
  const title = S(content.title || product.title) || 'Guide pratique';

  await mkdir(dirname(outFile), { recursive: true });
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: 'A4',
    margins: NO_MARGINS,
    compress: true,
    lang: 'fr-FR',
    displayTitle: true,
    info: {
      Title: title,
      Author: brand,
      Subject: S(content.subtitle || product.subtitle),
      Keywords: [S(product.audience), S(product.problem)].filter(Boolean).join(' · '),
      Creator: `${brand} — Studio PDF`,
      CreationDate: CREATED,
    },
  });
  const stream = createWriteStream(outFile);
  const done = new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
    doc.on('error', reject);
  });
  doc.pipe(stream);
  registerVoice(doc, guide.voice);
  try {
    writePages(doc, guide);
  } catch (err) {
    doc.end();
    await done.catch(() => undefined);
    throw err;
  }
  doc.end();
  await done;
  const { size } = await stat(outFile);
  return { pages: guide.pages.length, bytes: size, audit: { ...guide.audit, bytes: size, degraded: guide.degraded }, previews: previewsOf(guide) };
}
