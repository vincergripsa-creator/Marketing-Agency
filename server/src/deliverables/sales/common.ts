/**
 * What the V1 page and the page templates (design plan D202) share: escaping, the inlined fonts, the copy at the price of
 * the day, the guide's figure, the captions of its real pages. The V1 page reads these exactly as it did when they lived in
 * `salesPage.ts`: its bytes do not move.
 */
import type { DesignSpec, PdfContent, SalesPage, VisualSpec } from '../../shared.js';
import { normalizeDesign } from '../design.js';
import { diagramFor } from '../diagrams.js';
import { isStdFont, loadVoice, woffOf, type FaceName } from '../fonts.js';
import { toSvg } from '../scene.js';
import { escapeHtml as esc, formatPrice, frenchNbsp, truncate } from '../text.js';

/** Escaped prose with French no-break spaces ("6 h", "mot :") so lines never break badly. */
export const h = (v: unknown): string => esc(frenchNbsp(String(v ?? '')));

export const CHECKOUT_ALERT = 'Boutique virtuelle : paiement simulé — environnement de test Pixel Agency';

const FIGURE_W = 480;         // a diagram's labels are set for this width: readable at full size, and still on a phone
const FIGURE_TYPES: VisualSpec['type'][] = ['plan_path', 'cycle', 'steps_diagram']; // the plan proves the most; a `steps_diagram` titled « boucle » is an old save's cycle

/** What a reader gets from each kind of page: a shop window says it in its own words. */
export const CAPTIONS: Record<string, string> = {
  couverture: 'La couverture',
  'ouverture-de-chapitre': 'Chaque chapitre annonce ce que vous allez faire',
  'page-du-guide': 'Une lecture posée, l’essentiel mis en avant',
  schema: 'Le schéma qui résume ce qu’il faut retenir',
  'fiche-a-imprimer': 'Les fiches à imprimer et à remplir',
  'le-contenu-du-kit': 'Tout ce que contient le kit',
  'le-plan-a-cocher': 'Le plan à cocher, étape par étape',
  'votre-plan': 'Votre plan, sur une seule page',
};

/** Drops anything executable from an SVG string before inlining it in HTML. */
export function safeSvg(svg: string): string {
  return String(svg ?? '')
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#')
    .trim();
}

const inlined = new Map<FaceName, string>();

/** The committed WOFF as a data URI, never its unpacked form. Read once: a page is rendered again at each price and each review. */
export function fontFace(family: string, face: FaceName): string {
  if (isStdFont(face)) return ''; // the rescue voice has no file: the fallback stack takes over
  let data = inlined.get(face);
  if (!data) {
    data = woffOf(face).toString('base64');
    inlined.set(face, data);
  }
  return `@font-face{font-family:'${family}';font-weight:100 900;font-display:swap;src:url(data:font/woff;base64,${data}) format('woff')}`;
}

/**
 * The copy is written once and the price moves: what it says of the price follows, in everything but the customers'
 * own words. Only the amount the copy was written at changes (« moins de 10 000 € » stays).
 */
export function atPriceOfTheDay(sp: SalesPage, price: number): SalesPage {
  const was = sp?.priceWritten;
  if (!was || was === price) return sp;
  const amount = Number.isInteger(was) ? `${was}(?:[.,]0+)?` : `${String(was).replace('.', '[.,]')}0*`;
  const stale = new RegExp(`(?<![\\d.,]|\\d[\\s\\u00a0\\u202f])${amount}[\\s\\u00a0\\u202f]*€`, 'g');
  const fix = (text: string): string => String(text ?? '').replace(stale, formatPrice(price));
  return {
    ...sp, headline: fix(sp.headline), subheadline: fix(sp.subheadline), solution: fix(sp.solution), bonusBlurb: fix(sp.bonusBlurb),
    guarantee: fix(sp.guarantee), cta: fix(sp.cta),
    chapterBlurbs: (sp.chapterBlurbs ?? []).map((b) => ({ ...b, blurb: fix(b.blurb) })),
    objections: (sp.objections ?? []).map((o) => ({ q: fix(o.q), a: fix(o.a) })),
    // the sections of the templates (D202): only the V1 fields above ever reach the V1 page
    ...(sp.benefits ? { benefits: sp.benefits.map(fix) } : {}),
    ...(sp.story ? { story: fix(sp.story) } : {}),
    ...(sp.comparison ? { comparison: sp.comparison.map((r) => ({ label: fix(r.label), guide: fix(r.guide), other: fix(r.other) })) } : {}),
  };
}

/** The figure the page shows at full size (pdf §11.1): the plan or the loop of the guide, its labels readable. Null when the guide has neither. */
export function figureSvgFor(content: PdfContent | null | undefined, design: Partial<DesignSpec> | null | undefined): string | null {
  const d = normalizeDesign(design);
  const { voice } = loadVoice(d.voice!);
  const visuals = (content?.chapters ?? []).flatMap((c) => [c.figure, c.visual]);
  for (const type of FIGURE_TYPES) {
    for (const v of visuals) {
      const drawn = v?.type === type ? diagramFor(v, FIGURE_W, { voice, inks: d.inks! }) : null;
      if (drawn) return toSvg(drawn.scene, { precision: 1 });
    }
  }
  return null;
}

const SHORT_TITLE = 40;

/** A title for the buy bar: it stops before a quotation it could not close, and closes one it opens on. */
export function shortTitle(title: string): string {
  const cut = truncate(title, SHORT_TITLE);
  const open = cut.lastIndexOf('«');
  if (open < 0 || cut.includes('»', open)) return cut;
  return open > 0 ? `${cut.slice(0, open).trimEnd()}…` : `${cut} »`;
}
