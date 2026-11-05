/**
 * Templated sales pages (design plan D202): six layouts from one section library, five first-screen scenes, a skin per
 * art direction, the law of D208 in every one of them. Self-contained like the V1 page: the fonts and every picture are
 * inlined, nothing is ever fetched, and the page stays under 900 kB by showing fewer real pages when it must.
 */
import { loadVoice } from '../fonts.js';
import { truncate } from '../text.js';
import { h } from './common.js';
import { BASE_CSS, iconDefs } from './css.js';
import { deskOf, heroCss } from './heroes.js';
import { buildModel, heroOf, type PageModel, type SalesPageInput } from './model.js';
import { footerBar, headerBar, stickyAndScript } from './sections.js';
import { skinCss } from './skins.js';
import { pagesFor, TEMPLATES } from './templates.js';
import { rootCss, tokensOf, typeOf, type Faces } from './theme.js';

export type { SalesPageInput } from './model.js';
export { priceDrop, priceDropPrint, noFalseUrgency, isFalseUrgency, REFERENCE_DAYS } from './law.js';
export { pairsOf, tokensOf } from './theme.js';

/** Acceptance E7: a page weighs at most this, in bytes. */
export const MAX_PAGE_BYTES = 900_000;

function assemble(m: PageModel, faces: Faces): string {
  const tpl = TEMPLATES[m.template];
  const { voice } = loadVoice(m.design.voice!);
  const t = tokensOf(m.design, m.style);
  const ty = typeOf(m.design, voice, faces);
  const desk = m.hero === 'desk' ? `:root{--desk:${deskOf(m.style, t)}}` : '';
  const css = `${ty.fonts}\n${rootCss(t, ty)}\n${BASE_CSS}\n${tpl.css(m)}\n${heroCss(m.hero, m.style, t)}${desk}\n${skinCss(m.style, t)}`;
  const defs = `<svg class="defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${iconDefs()}${m.cover.symbol}${m.kit?.symbol ?? ''}${m.leaves.map((l) => l.symbol).join('')}</defs></svg>`;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(m.title)} — ${h(m.brand)}</title>
<meta name="description" content="${h(truncate(m.sub, 155))}">
<meta property="og:title" content="${h(m.headline)}">
<meta property="og:description" content="${h(truncate(m.sub, 155))}">
<style>${css}</style>
</head>
<body class="t-${m.template} s-${m.style} h-${m.hero}">
${defs}
${headerBar(m, tpl.nav(m))}
<main id="top">
${tpl.body(m, t)}
</main>
${footerBar(m)}
${stickyAndScript(m)}
</body>
</html>
`;
}

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

/** What a real page costs beyond its symbol: the few places that show it by reference. */
const PER_PAGE = 1_500;

/**
 * The page a copy that names a template gets. Same product, same bytes: no draw, no clock. Under 900 kB whatever the
 * guide weighs: the template's pages are taken in its order while they fit, a lighter one in place of a heavy one; when
 * even that cannot fit, the figure goes, then the faces a fallback can stand in for.
 */
export function renderTemplatePage(input: SalesPageInput): string {
  const full = buildModel(input);
  const tpl = TEMPLATES[full.template];
  const copy = input.salesPage ?? input.product.salesPage!;
  const select = (leaves: PageModel['leaves'], figure: string): PageModel => {
    const bundle = !!full.kit || leaves.some((l) => /fiche|plan|kit/.test(l.kind)) || (!!full.bonusTitle && leaves.length > 0);
    return { ...full, leaves, figure, hero: heroOf(copy, full.template, leaves, bundle) };
  };
  const wanted = pagesFor(tpl, full.leaves, full.leaves.length);
  const steps: { figure: string; faces: Faces }[] = [
    { figure: full.figure, faces: { ...tpl.faces } },
    { figure: '', faces: { ...tpl.faces } },
    { figure: '', faces: { ...tpl.faces, italic: false } },
    { figure: '', faces: { label: false, italic: false } },
  ];
  let html = '';
  for (const step of steps) {
    const bare = bytes(assemble(select([], step.figure), step.faces));
    let room = MAX_PAGE_BYTES - bare;
    const chosen: PageModel['leaves'] = [];
    for (const l of wanted) {
      if (chosen.length >= tpl.maxPages) break;
      if (l.bytes + PER_PAGE <= room) { chosen.push(l); room -= l.bytes + PER_PAGE; }
    }
    while (true) {
      html = assemble(select(chosen, step.figure), step.faces);
      if (bytes(html) <= MAX_PAGE_BYTES || !chosen.length) break;
      chosen.pop();
    }
    if (bytes(html) <= MAX_PAGE_BYTES) return html;
  }
  return html;
}

