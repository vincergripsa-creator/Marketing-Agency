/**
 * Everything a templated page prints (design plan D202), read once from the product: the copy at the price of the day,
 * the counts the guide really holds, its real pages as symbols inlined once, the reviews as they are, the law's lines.
 * No draw and no clock: the same product gives the same model.
 */
import type { ArtStyle, DesignSpec, PageHero, PageTemplate, Product, Review, SalesPage } from '../../shared.js';
import { ART_STYLES, HERO_NEEDS, PAGE_HEROES, PAGE_TEMPLATES } from '../../shared.js';
import { splitTitle } from '../cover.js';
import { normalizeDesign } from '../design.js';
import { kitBoxes, kitSheets } from '../kit.js';
import { guidedActions } from '../pages/render.js';
import { layoutPdf } from '../pdf.js';
import { formatPrice, hashString, normalizeKey, slugify, wholeClause } from '../text.js';
import { atPriceOfTheDay, CAPTIONS, figureSvgFor, safeSvg } from './common.js';
import { guaranteeDays, noFalseUrgency, priceDrop, withdrawalFaq, type PriceDrop } from './law.js';

/** The renderer's input: the contract's, and what the shop may add (the kit at checkout, the day for the 30-day rule). */
export interface SalesPageInput {
  product: Product; salesPage: SalesPage; coverSvg: string; design: DesignSpec; brand: string;
  previews?: { label: string; svg: string }[]; figureSvg?: string | null; offSale?: boolean;
  kit?: { title: string; coverSvg: string } | null;
  day?: number;
}

/** A real page of the guide, inlined once as a symbol and shown by reference wherever a template needs it. */
export interface Leaf { id: string; kind: string; caption: string; box: string; symbol: string; bytes: number }

export interface Row { title: string; blurb?: string }
export interface TocRow { title: string; page: number }

export interface PageModel {
  product: Product;
  sp: SalesPage;
  design: DesignSpec;
  style: ArtStyle;
  template: PageTemplate;
  hero: PageHero;
  seed: number;
  isKit: boolean;
  noun: 'guide' | 'kit';
  onSale: boolean;
  brand: string;
  price: string;
  priceValue: number;
  title: string;
  headline: string;
  head: string;
  tail: string;
  hook: string;
  sub: string;
  eyebrow: string;
  audience: string;
  cta: string;
  pains: string[];
  benefits: string[];
  forWho: string[];
  notFor: string[];
  story: string;
  comparison: { label: string; guide: string; other: string }[];
  chapters: Row[];
  printed: string[];
  bonusTitle: string;
  bonusBlurb: string;
  reviews: Review[];
  avg: number;
  total: number;
  breakdown: { stars: number; count: number }[];
  faq: { q: string; a: string }[];
  guarantee: string;
  guaranteeDays: number | null;
  cover: { symbol: string; box: string };
  kit: { title: string; symbol: string; box: string } | null;
  leaves: Leaf[];
  figure: string;
  facts: { chapters: number; actions: number; sheets: number; pages: number; boxes: number; readMinutes: number; checklists: boolean };
  drop: PriceDrop | null;
  perDay: { amount: string; unit: string; n: number } | null;
  toc: TocRow[] | null;
  intro: string[];
}

export const MAX_PAGES = 6;

const isOne = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** The art direction of the guide: absent means Bauhaus, the V1 look (D200). Read before `normalizeDesign`, which keeps the V1 fields. */
export function styleOf(design: Partial<DesignSpec> | null | undefined): ArtStyle {
  return isOne(ART_STYLES, design?.style) ? design!.style! : 'bauhaus';
}

/** `<svg …>inner</svg>` as a symbol: its viewBox and its drawing, its title and description left to the page that shows it. */
export function toSymbol(svg: string, id: string, fallbackBox: string): { symbol: string; box: string } | null {
  const clean = safeSvg(svg);
  const m = /^<svg\b([^>]*)>([\s\S]*)<\/svg>$/i.exec(clean);
  if (!m) return null;
  const box = /\bviewBox="([^"]+)"/.exec(m[1]!)?.[1] ?? fallbackBox;
  const inner = m[2]!.replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<desc>[\s\S]*?<\/desc>/i, '');
  return { symbol: `<symbol id="${id}" viewBox="${box}">${inner}</symbol>`, box };
}

/** The real pages: the cover has its own symbol, it joins them only when the guide has nothing else to show. */
function leavesOf(previews: SalesPageInput['previews']): Leaf[] {
  const pages = (previews ?? []).map((p) => ({ kind: slugify(String(p?.label ?? '')), label: String(p?.label ?? ''), svg: String(p?.svg ?? '') }))
    .filter((p) => safeSvg(p.svg).startsWith('<svg'));
  const inner = pages.filter((p) => p.kind !== 'couverture');
  return (inner.length ? inner : pages).slice(0, MAX_PAGES).flatMap((p, k) => {
    const s = toSymbol(p.svg, `pg-${k + 1}`, '0 0 595.28 841.89');
    return s ? [{ id: `pg-${k + 1}`, kind: p.kind, caption: CAPTIONS[p.kind] ?? p.label, box: s.box, symbol: s.symbol, bytes: Buffer.byteLength(s.symbol) }] : [];
  });
}

const TOC_CACHE = new Map<number, TocRow[] | null>();
const TOC_CAP = 64;

/**
 * The guide's table of contents with its real page numbers, laid out as its render laid it out. Null when the layout
 * disagrees with the pages the guide printed: a page number nobody can check is not printed.
 */
function tocOf(product: Product, design: DesignSpec, brand: string): TocRow[] | null {
  const content = product.content;
  if (!content?.chapters?.length || product.kind === 'kit') return null;
  const effort = product.visual?.effort;
  const k = hashString(JSON.stringify([content, design, effort ?? null, product.title, brand, product.pdfFacts?.pages ?? null]));
  if (TOC_CACHE.has(k)) return TOC_CACHE.get(k)!;
  let rows: TocRow[] | null = null;
  try {
    const guide = layoutPdf({ product, content, design, brand, ...(effort ? { effort } : {}) });
    const printed = product.pdfFacts?.pages;
    if (!printed || printed === guide.pages.length) {
      const marks = guide.pages.flatMap((p, i) => (p.outline ? [{ key: normalizeKey(p.outline).replace(/[^a-z0-9]+/g, ''), page: i + 1 }] : []));
      const used = new Set<number>();
      const found = content.chapters.map((ch) => {
        const want = normalizeKey(ch.title).replace(/[^a-z0-9]+/g, '').slice(0, 24);
        const hit = marks.findIndex((mk, i) => !used.has(i) && want.length >= 4 && (mk.key.startsWith(want) || want.startsWith(mk.key.slice(0, 24))));
        if (hit < 0) return null;
        used.add(hit);
        return { title: ch.title, page: marks[hit]!.page };
      });
      if (found.every((r): r is TocRow => r !== null)) rows = found;
    }
  } catch {
    rows = null;
  }
  if (TOC_CACHE.size >= TOC_CAP) TOC_CACHE.delete(TOC_CACHE.keys().next().value!);
  TOC_CACHE.set(k, rows);
  return rows;
}

const PLAN_RE = /\b(\d{1,3})\s*(nuits|jours|soirs|matins|semaines)\b/i;
const UNIT_ONE: Record<string, string> = { nuits: 'nuit', jours: 'jour', soirs: 'soir', matins: 'matin', semaines: 'semaine' };

/** The length of the guide's plan, from its drawn plan first, else from its own promise: the per-day line divides by it. */
function planOf(p: Product): { n: number; unit: string } | null {
  const plan = (p.content?.chapters ?? []).flatMap((c) => [c.visual, c.figure]).find((v) => v?.type === 'plan_path' && (v.plan?.days ?? 0) > 0)?.plan;
  if (plan) {
    const one = normalizeKey(plan.unit || 'jour');
    const unit = Object.keys(UNIT_ONE).find((u) => UNIT_ONE[u] === one || u === one) ?? 'jours';
    return { n: plan.days, unit };
  }
  for (const t of [p.content?.promise, p.title, p.content?.subtitle]) {
    const m = PLAN_RE.exec(String(t ?? ''));
    if (m) return { n: Number(m[1]), unit: m[2]!.toLowerCase() };
  }
  return null;
}

const priceText = (v: number): string => (Number.isInteger(Math.round(v * 100) / 100) ? formatPrice(v) : `${(Math.round(v * 100) / 100).toFixed(2).replace('.', ',')} €`);

/** The page the template draws and its hero (`PAGE_HEROES`); a hero whose needs fail stands back to the book alone. */
export function heroOf(sp: SalesPage, template: PageTemplate, leaves: Leaf[], bundle: boolean): PageHero {
  const can = (hero: PageHero): boolean => {
    const need = HERO_NEEDS[hero];
    return !need || ((!need.previews || leaves.length >= 2) && (!need.bundle || bundle));
  };
  if (isOne(PAGE_HEROES, sp.hero) && can(sp.hero)) return sp.hero;
  const preferred: Record<PageTemplate, PageHero[]> = {
    express: ['devices', 'book'], editorial: ['book'], inside: ['spread', 'book'], creator: ['desk', 'book'], proof: ['book'], value: ['bundle', 'book'],
  };
  return preferred[template].find(can) ?? 'book';
}

const cleanList = (xs: readonly (string | null | undefined)[] | undefined): string[] => (xs ?? []).map((x) => noFalseUrgency(String(x ?? '').trim())).filter((x) => x.length > 1);

/** Every sentence the copy holds, without false urgency or scarcity (D208): whatever wrote it, the page never prints them. */
function lawful<T>(v: T): T {
  if (typeof v === 'string') return noFalseUrgency(v) as T;
  if (Array.isArray(v)) return v.map(lawful) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lawful(x)])) as T;
  return v;
}

export function buildModel(input: SalesPageInput): PageModel {
  const { product } = input;
  const raw = input.salesPage ?? (product.salesPage as SalesPage);
  const template: PageTemplate = isOne(PAGE_TEMPLATES, raw?.template) ? raw!.template! : 'express';
  const isKit = product.kind === 'kit';
  const noun = isKit ? 'kit' : 'guide';
  const onSale = !input.offSale && product.status !== 'killed' && product.status !== 'paused';
  const sp = lawful(atPriceOfTheDay(raw, product.price));
  const rawDesign = input.design ?? product.design;
  const design = normalizeDesign(rawDesign);
  const style = styleOf(rawDesign) ?? styleOf(product.design);
  const brand = (input.brand || 'Pixel Agency').trim();
  const price = formatPrice(product.price);
  const content = product.content;
  const title = product.title || sp?.headline || '';
  const { head, tail } = splitTitle(title);
  const headline = noFalseUrgency(sp?.headline) || title;
  const sub = noFalseUrgency(sp?.subheadline || product.subtitle);
  const hook = headline === title ? sub : headline; // the title is on the cover and in the h1: the written hook sells under it
  const audience = product.audience || content?.audience || '';
  const eyebrow = audience ? wholeClause(audience.replace(/\s*\([^)]*\)/g, ''), (s) => s.length <= 56) : isKit ? 'Kit à imprimer' : 'Guide pratique';
  const cta = (noFalseUrgency(sp?.cta) || (isKit ? 'Ajouter le kit à ma commande' : 'Je télécharge le guide')).replace(/\s*[—–-]?\s*\d+(?:[.,]\d+)?\s*€/g, '').trim();

  const blurbs = (sp?.chapterBlurbs ?? []).filter((b) => b && (b.title || b.blurb));
  const chapters: Row[] = (blurbs.length ? blurbs : (content?.chapters ?? []).map((c) => ({ title: c.title, blurb: c.intro }))).map((b) => ({ title: String(b.title ?? ''), blurb: noFalseUrgency(b.blurb) }));
  const printed = isKit && content ? kitSheets(content).map((v) => v.title) : [];
  const bonusTitle = String(content?.bonus?.title ?? '').replace(/^bonus\s*(?:offert\s*)?[:—–-]\s*/i, '').replace(/^./, (ch) => ch.toUpperCase());

  const reviews = [...(product.stats?.reviews ?? [])].filter((r) => r && r.text).sort((a, b) => b.day - a.day || b.rating - a.rating);
  const avg = (product.stats?.rating ?? 0) > 0 ? product.stats.rating : reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const total = Math.max(product.stats?.ratingCount ?? 0, reviews.length);
  const breakdown = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: reviews.filter((r) => r.rating === stars).length }));

  const guarantee = noFalseUrgency(sp?.guarantee);
  const objections = (sp?.objections ?? []).filter((o) => o && o.q).map((o) => ({ q: o.q, a: noFalseUrgency(o.a) })).filter((o) => o.a);
  const practical = [
    { q: `Comment je reçois le ${noun} ?`, a: 'Tout de suite après le paiement : un lien de téléchargement s’affiche et vous est aussi envoyé par e-mail. Le PDF se lit sur téléphone, tablette et ordinateur.' },
    { q: 'Est-ce un abonnement ?', a: `Non. Vous payez ${price} une seule fois et le ${noun} est à vous, y compris ses mises à jour.` },
  ].filter((f) => !objections.some((o) => o.q.toLowerCase().includes(f.q.slice(0, 12).toLowerCase())));
  const faq = onSale ? [...objections, ...practical, withdrawalFaq(noun, !!guarantee)] : [];

  const coverSym = toSymbol(input.coverSvg, 'cover-art', '0 0 600 848') ?? { symbol: '<symbol id="cover-art" viewBox="0 0 600 848"></symbol>', box: '0 0 600 848' };
  const kitSym = input.kit?.coverSvg ? toSymbol(input.kit.coverSvg, 'kit-art', '0 0 600 848') : null;
  const leaves = leavesOf(input.previews);
  const figure = isKit ? '' : safeSvg((input.figureSvg === undefined ? figureSvgFor(content, design) : input.figureSvg) ?? '');

  const sheets = product.pdfFacts?.sheets ?? 0;
  const words = content?.wordCount ?? 0;
  const facts = {
    chapters: content?.chapters?.length ?? sp?.chapterBlurbs?.length ?? 0,
    actions: isKit ? 0 : guidedActions(content?.chapters),
    sheets,
    pages: product.pdfFacts?.pages ?? 0,
    boxes: isKit && content ? kitBoxes(content) : 0,
    readMinutes: words > 600 ? Math.max(5, Math.round(words / 220 / 5) * 5) : 0,
    checklists: !!content?.chapters?.length && content.chapters.every((c) => (c.checklist?.length ?? 0) > 0),
  };
  const bundle = !!kitSym || leaves.some((l) => /fiche|plan|kit/.test(l.kind)) || (!!bonusTitle && leaves.length > 0);
  const hero = heroOf(raw ?? ({} as SalesPage), template, leaves, bundle);
  const plan = planOf(product);
  const perUnit = plan && plan.n >= 5 ? product.price / plan.n : 0;
  const perDay = plan && perUnit >= 0.1 ? { amount: priceText(perUnit), unit: UNIT_ONE[plan.unit] ?? 'jour', n: plan.n } : null;

  return {
    product, sp, design, style, template, hero,
    seed: hashString(`${product.title}|${style}|${template}`),
    isKit, noun, onSale, brand, price, priceValue: product.price,
    title, headline, head, tail, hook, sub, eyebrow, audience, cta,
    pains: cleanList(sp?.painBullets),
    benefits: cleanList(sp?.benefits),
    forWho: cleanList(sp?.forWho),
    notFor: cleanList(sp?.notFor),
    story: noFalseUrgency(sp?.story),
    comparison: (sp?.comparison ?? []).filter((r) => r && r.label && r.guide && r.other).map((r) => ({ label: r.label, guide: noFalseUrgency(r.guide), other: noFalseUrgency(r.other) })).filter((r) => r.guide && r.other),
    chapters, printed, bonusTitle, bonusBlurb: noFalseUrgency(sp?.bonusBlurb),
    reviews, avg, total, breakdown,
    faq, guarantee, guaranteeDays: guaranteeDays(guarantee),
    cover: coverSym,
    kit: kitSym && input.kit ? { title: input.kit.title, ...kitSym } : null,
    leaves, figure, facts,
    drop: onSale ? priceDrop(product.priceHistory, product.price, input.day) : null,
    perDay,
    toc: template === 'editorial' ? tocOf(product, design, brand) : null,
    intro: (content?.introduction ?? []).map((p) => String(p ?? '').trim()).filter(Boolean),
  };
}
