/**
 * Six page templates (design plan D202, `TEMPLATE_INFO`), different in structure and not only in colour: section order,
 * section kinds, density, typography and layout. Each is a list of sections from the library and a layer of CSS.
 */
import type { PageTemplate } from '../../shared.js';
import { h } from './common.js';
import { BP, icon } from './css.js';
import type { Leaf, PageModel } from './model.js';
import {
  benefitsSection, bentoSection, bonusSection, breakdownBlock, buyRow, chaptersSection, comparisonSection, coverMini, eyebrow,
  faqSection, figureSection, finalSection, forWhoSection, guaranteeSection, heroSection, introStorySection, kicker, letterSection, newBlock,
  pageFig, painsSection, priceSection, reviewsSection, solutionSection, stars, stripSection, tocSection, verifiedLine,
} from './sections.js';
import type { Faces, Tokens } from './theme.js';

export interface Template {
  faces: Faces;
  /** The real pages the template shows, best first: the budget drops the last ones first. */
  pages: string[];
  maxPages: number;
  nav: (m: PageModel) => [string, string][];
  body: (m: PageModel, t: Tokens) => string;
  css: (m: PageModel) => string;
}

const KIND_ORDER = ['ouverture-de-chapitre', 'page-du-guide', 'fiche-a-imprimer', 'votre-plan', 'schema', 'le-plan-a-cocher', 'le-contenu-du-kit', 'couverture'];

/** The leaves a template wants, in its own order of preference, at most `max`. */
export function pagesFor(tpl: Template, leaves: Leaf[], max = tpl.maxPages): Leaf[] {
  const rank = (l: Leaf): number => {
    const k = tpl.pages.indexOf(l.kind);
    return k >= 0 ? k : tpl.pages.length + Math.max(0, KIND_ORDER.indexOf(l.kind));
  };
  return [...leaves].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id)).slice(0, max);
}

const navOf = (m: PageModel, extra: [string, string][] = []): [string, string][] => [
  ...(m.leaves.length ? [['apercu', 'Aperçu'] as [string, string]] : []),
  ...extra,
  ['dedans', 'Le contenu'],
  ...(m.reviews.length ? [['avis', 'Avis'] as [string, string]] : []),
  ...(m.faq.length ? [['faq', 'Questions'] as [string, string]] : []),
];

/** The headline sizes by length: a long title steps down so that the first screen still holds the button. */
const titleClass = (m: PageModel): string => (m.head.length > 88 ? 'xlong' : m.head.length > 56 ? 'long' : '');

/** The mechanics of every first screen: one column on a phone in the order of acceptance E7, two columns from a laptop. */
const HERO_BASE = `.hero{padding:16px 0 40px;--col:1}
.hero-grid{display:flex;flex-direction:column;gap:12px}
.h-copy{display:contents}
.eyebrow{order:1;margin:0;font:700 12px/1.35 var(--label);letter-spacing:.14em;text-transform:uppercase;color:var(--a-text)}
.hero h1{--fit:calc((100vw - 40px) * var(--col) / (var(--w,10) * .64));order:2;font-size:min(clamp(31px,8.4vw,60px),var(--fit));line-height:1.02;letter-spacing:-.025em}
.hero h1.long{font-size:min(clamp(27px,7vw,50px),var(--fit))}.hero h1.xlong{font-size:min(clamp(24px,6vw,42px),var(--fit))}
.deck{order:3;margin:0;font:400 19px/1.35 var(--italic);color:var(--a-text)}
.h-scene{order:4;width:100%}
.h-scene .scene{width:min(100%,calc(36svh * var(--ar,1)))}
.h-buy{order:5;display:flex;flex-direction:column;gap:12px}
.hook{order:6;margin:0;color:var(--muted);font-size:17px}
.h-extra{order:7}
.buy-top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px 16px}
.price-box{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 10px}
.price-box .price-meta{flex-basis:100%}
.h-buy .buy{width:100%}
.h-buy .note{margin:0}
.scene-book{--ar:1}.scene-devices{--ar:1.11}.scene-spread{--ar:1.29}.scene-bundle{--ar:1.09}.scene-desk{--ar:1.22}
@media (min-width:${BP.md}px){.hero h1{--fit:calc((100vw - 64px) * var(--col) / (var(--w,10) * .64))}.h-buy .buy{width:auto;align-self:flex-start}.h-scene .scene{width:min(100%,calc(52svh * var(--ar,1)))}.buy-top{justify-content:flex-start;gap:10px 28px}}
@media (min-width:${BP.lg}px){
  .hero{padding:44px 0 76px;--col:.5}
  .hero-grid{display:grid;grid-template-columns:minmax(0,1.04fr) minmax(0,1fr);gap:56px;align-items:center}
  .h-copy{display:flex;flex-direction:column;gap:16px}
  .hero .h-copy>*,.hero .h-scene{order:0}
  .h-scene .scene{width:100%}
  .hero h1{--fit:calc((min(100vw,1160px) - 120px) * var(--col) / (var(--w,10) * .64));font-size:min(clamp(44px,4.6vw,64px),var(--fit))}.hero h1.long{font-size:min(clamp(38px,3.8vw,52px),var(--fit))}.hero h1.xlong{font-size:min(clamp(32px,3.2vw,44px),var(--fit))}
}`;

const hero = (m: PageModel, t: Tokens, o: { top?: string; extra?: string; drop?: boolean; hook?: boolean; cls?: string } = {}): string =>
  heroSection(m, t, { ...o, h1Class: titleClass(m) });

// ───────────────────────────── express ─────────────────────────────

const express: Template = {
  faces: { label: true, italic: false },
  pages: ['ouverture-de-chapitre', 'page-du-guide', 'fiche-a-imprimer', 'votre-plan', 'schema'],
  maxPages: 4,
  nav: (m) => navOf(m),
  body: (m, t) => [
    hero(m, t, { cls: 'x-hero' }),
    benefitsSection(m, { cls: 'x-benefits', title: 'En trois points' }),
    stripSection(m, { cls: 'alt x-pages', max: 4 }),
    m.reviews.length ? reviewsSection(m, { variant: 'cards', max: 3, cls: 'x-reviews' }) : (m.onSale ? `<section class="x-new" id="avis"><div class="wrap narrow">${newBlock(m)}</div></section>` : ''),
    m.onSale ? `<section class="x-offer" id="dedans"><div class="wrap narrow"><div class="offer card"><div class="offer-in">${coverMini(m, 'offer-cover')}<div><p class="offer-title">${h(m.title)}</p><ul class="ticks">${[
      m.facts.chapters ? `${m.facts.chapters} chapitres courts` : '',
      m.facts.actions ? `${m.facts.actions} actions guidées` : '',
      m.facts.sheets ? `${m.facts.sheets} ${m.facts.sheets > 1 ? 'fiches' : 'fiche'} à imprimer` : '',
      m.bonusTitle ? `Offert : ${m.bonusTitle}` : '',
    ].filter(Boolean).map((x) => `<li>${icon('check')}<span>${h(x)}</span></li>`).join('')}</ul></div></div>${buyRow(m)}</div></div></section>` : chaptersSection(m, { variant: 'list' }),
    faqSection(m, { cls: 'x-faq' }),
    guaranteeSection(m),
  ].join('\n'),
  css: () => `${HERO_BASE}
.x-hero .h-copy .hook{font-size:18px;color:var(--ink)}
.benefit-list{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.benefit-list li{display:flex;gap:14px;align-items:flex-start;padding:18px}
.benefit-list p{margin:0;font:600 17px/1.4 var(--label)}
.b-ico{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:var(--r-btn);background:var(--tint);color:var(--a-text)}
.x-benefits{padding-top:28px}
@media (min-width:${BP.md}px){.t-express section:not(.hero){padding:56px 0}}
.review-grid{display:grid;gap:16px}
.x-new{padding-top:0}.new-card{padding:22px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}.new-card p{margin:0}
.offer{padding:24px;display:flex;flex-direction:column;gap:16px}
.offer-in{display:flex;gap:18px;align-items:flex-start}
.offer-cover{width:92px;flex:none;box-shadow:0 14px 28px -14px var(--shadow-ink)}
.offer-title{font:700 20px/1.2 var(--display);margin:0 0 12px}
.offer .buy-row{display:flex;flex-direction:column;align-items:stretch;gap:14px}
.offer .buy{width:100%}
.rating-big{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 18px;font:600 15px/1.3 var(--label)}
.rating-big b{font:700 34px/1 var(--display)}
@media (min-width:${BP.md}px){.benefit-list{grid-template-columns:repeat(3,minmax(0,1fr))}.benefit-list li{flex-direction:column}.review-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}`,
};

// ───────────────────────────── editorial ─────────────────────────────

const editorial: Template = {
  faces: { label: true, italic: true },
  pages: ['ouverture-de-chapitre', 'page-du-guide', 'schema', 'fiche-a-imprimer'],
  maxPages: 2,
  nav: (m) => navOf(m),
  body: (m, t) => {
    const mast = `<p class="mast"><span>${h(m.isKit ? 'Le kit' : 'Le guide')}</span><span>${h(m.brand)}</span>${m.facts.pages ? `<span>${m.facts.chapters} chapitres · ${m.facts.pages} pages</span>` : ''}</p>`;
    const byline = `<p class="byline">Un ${m.noun} de l’équipe ${h(m.brand)}${m.facts.readMinutes ? ` · ${m.facts.readMinutes} minutes de lecture` : ''}</p>`;
    const spread = m.leaves.length >= 2 ? `<section class="e-spread band-sec" id="apercu"><div class="wrap">${kicker(m.onSale ? 'Avant d’acheter' : 'Aperçu')}<h2 class="h2">Deux pages, telles quelles</h2><div class="e-pages">${m.leaves.slice(0, 2).map((l) => pageFig(l)).join('')}</div><p class="lead">Ces pages viennent du ${m.noun}, pas d’une maquette${m.onSale ? ' : ce que vous voyez est ce que vous téléchargez' : ''}. Seul le texte courant est masqué dans l’aperçu.</p></div></section>` : '';
    return [
      hero(m, t, { top: `${mast}${eyebrow(m)}`, extra: byline, cls: 'e-hero' }),
      introStorySection(m, { cls: 'e-story' }),
      painsSection(m, { variant: 'quotes', cls: 'e-pains' }),
      solutionSection(m, { cls: 'e-solution' }),
      tocSection(m, { cls: 'e-toc' }),
      figureSection(m, { cls: 'e-figure' }),
      spread,
      reviewsSection(m, { variant: 'quotes', max: 4, cls: 'e-reviews', title: 'Ce qu’en disent les lecteurs' }),
      bonusSection(m),
      faqSection(m),
      guaranteeSection(m),
      finalSection(m, { cls: 'e-final' }),
    ].join('\n');
  },
  css: () => `${HERO_BASE}
body{font-size:18px;line-height:1.7}
.mast{order:0;display:flex;flex-wrap:wrap;gap:4px 18px;margin:0 0 4px;padding:0 0 10px;border-bottom:1px solid var(--ink);font:700 11px/1.3 var(--label);letter-spacing:.18em;text-transform:uppercase;color:var(--ink)}
@media (max-width:${BP.md - 1}px){.mast{letter-spacing:.12em;font-size:10px}.mast span:nth-child(3){display:none}.e-hero .h-scene .scene{width:min(100%,calc(30svh * var(--ar,1)))}.e-hero .deck{font-size:19px}}
.e-hero h1{font-weight:700;letter-spacing:-.035em}
.e-hero .deck{font-size:22px;line-height:1.3}
.byline{order:3;margin:0;font:600 13px/1.4 var(--label);color:var(--muted);letter-spacing:.02em}
.e-hero .hook{font:400 19px/1.55 var(--text);color:var(--ink)}
@media (min-width:${BP.lg}px){.e-hero{--col:1}.e-hero .hero-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:28px;row-gap:14px;align-items:start}.e-hero .h-copy{display:contents}.e-hero .mast,.e-hero .eyebrow,.e-hero h1{grid-column:1/-1}.e-hero h1{font-size:min(clamp(52px,5.2vw,76px),var(--fit));line-height:.98;margin-bottom:10px}.e-hero h1.long{font-size:min(clamp(44px,4.4vw,62px),var(--fit))}.e-hero h1.xlong{font-size:min(clamp(36px,3.4vw,48px),var(--fit))}.e-hero .deck{grid-column:1/6;grid-row:4}.e-hero .hook{grid-column:1/6;grid-row:5}.e-hero .h-extra{grid-column:1/6;grid-row:6}.e-hero .h-scene{grid-column:6/10;grid-row:4/8}.e-hero .h-scene .scene{width:min(100%,calc(46svh * var(--ar,1)))}.e-hero .h-buy{grid-column:10/13;grid-row:4/8;padding-top:16px;border-top:3px solid var(--ink)}.e-hero .buy-top{flex-direction:column;align-items:flex-start;gap:12px}.e-hero .h-buy .buy{width:100%;padding:14px 16px;font-size:16px}}
.story-grid{display:grid;gap:34px}
.story-text p{font-size:19px;line-height:1.75;max-width:640px}
.dropcap::first-letter{float:left;font:700 4.6em/.82 var(--display);margin:.06em .1em 0 0;color:var(--a-text)}
.pull{margin:0;padding:0}
.pull p{font:400 clamp(22px,3vw,30px)/1.3 var(--italic);color:var(--ink);margin:0}
.pull.big p{font-size:clamp(26px,3.6vw,40px);line-height:1.2}
.story-aside{border-top:3px solid var(--ink);padding-top:18px}
.source{font:600 12px/1.4 var(--label);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:14px 0 0}
.pull-grid{display:grid;gap:22px 40px;margin-top:10px}
.pull-grid .pull{border-left:3px solid var(--a);padding-left:18px}
.pains-close{font:700 21px/1.3 var(--display);margin:28px 0 0}
.solution-text{font-size:21px;line-height:1.65}
.solution-text::first-line{font-weight:700}
.for-who{color:var(--muted);font-size:16px}
.toc-grid{display:grid;gap:22px}
.toc-list{list-style:none;margin:0;padding:0;border-top:2px solid var(--ink)}
.toc-list li{display:flex;align-items:baseline;gap:14px;padding:14px 0;border-bottom:1px solid var(--line)}
.toc-list .num{font:700 15px/1 var(--label);color:var(--a-text);min-width:26px}
.toc-list .t{font:700 19px/1.3 var(--display)}
.toc-list .dots{flex:1;border-bottom:2px dotted var(--line-strong);transform:translateY(-4px);min-width:18px}
.toc-list .pnum{font:600 15px/1 var(--label);white-space:nowrap}
.toc-notes{display:grid;gap:12px 40px;margin-top:30px;color:var(--muted);font-size:16px}
.toc-notes b{color:var(--ink)}
.fig{padding:18px}.fig svg{width:100%}
.band-sec{background:var(--band);color:var(--on-band)}
.band-sec .kicker{color:var(--on-band-accent)}
.band-sec .lead{color:var(--on-band-muted);margin-top:22px}
.e-pages{display:grid;grid-template-columns:1fr 1fr;gap:6px;max-width:820px;margin:0 auto;filter:drop-shadow(0 24px 30px rgba(0,0,0,.35))}
.e-pages .cap{color:var(--on-band-muted)}
.quote-cols{columns:1;column-gap:44px}
.rquote{break-inside:avoid;margin:0 0 30px;padding:0 0 0 18px;border-left:2px solid var(--a)}
.rquote p{font:400 21px/1.45 var(--italic);margin:0 0 10px}
.rquote footer{display:flex;align-items:center;gap:10px;padding:0;text-align:left;font:700 12px/1 var(--label);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.rating-big{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 18px;font:600 15px/1.3 var(--label)}
.rating-big b{font:700 40px/1 var(--display)}
.bonus-card{display:flex;gap:18px;padding:26px}.bonus-card .gift .ico{width:30px;height:30px;color:var(--a-text)}.tag{font:700 12px/1 var(--label);letter-spacing:.14em;text-transform:uppercase;color:var(--b-text);margin:0 0 8px}.bonus-card h3{font-size:22px}.bonus-card p{margin:6px 0 0}
.new-card{padding:22px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}.new-card p{margin:0}
@media (min-width:${BP.md}px){.story-grid{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);align-items:start}.pull-grid{grid-template-columns:1fr 1fr}.quote-cols{columns:2}.toc-notes{grid-template-columns:repeat(3,1fr)}}
@media (min-width:${BP.lg}px){.toc-grid{grid-template-columns:minmax(0,.8fr) minmax(0,1.4fr);gap:60px}}`,
};

// ───────────────────────────── inside ─────────────────────────────

const inside: Template = {
  faces: { label: true, italic: false },
  pages: ['ouverture-de-chapitre', 'page-du-guide', 'fiche-a-imprimer', 'votre-plan', 'schema', 'le-plan-a-cocher', 'le-contenu-du-kit'],
  maxPages: 6,
  nav: (m) => navOf(m),
  body: (m, t) => {
    const gallery = m.leaves.length ? `<section class="i-gallery band-sec" id="apercu"><div class="wrap">${kicker(m.onSale ? 'Feuilletez avant d’acheter' : 'Aperçu')}<h2 class="h2">${h(m.onSale ? 'Toutes les pages que montre l’aperçu' : `Quelques pages du ${m.noun}`)}</h2><p class="lead">Ces pages viennent du ${m.noun}, pas d’une maquette${m.onSale ? ' : ce que vous voyez est ce que vous téléchargez' : ''}. Seul le texte courant est masqué dans l’aperçu.</p><div class="i-rail">${m.leaves.map((l, k) => pageFig(l, { cls: k === 0 ? 'first' : '' })).join('')}</div></div></section>` : '';
    const sheets = m.leaves.filter((l) => /fiche|plan|kit/.test(l.kind));
    const fill = m.facts.sheets || m.facts.checklists || sheets.length ? `<section class="i-fill"><div class="wrap"><div class="fill-grid"><div>${kicker('À imprimer, à remplir')}<h2 class="h2">Ce que vous allez remplir</h2><ul class="ticks">${[
      m.facts.sheets ? `${m.facts.sheets} ${m.facts.sheets > 1 ? 'fiches' : 'fiche'} à imprimer, à remplir à la main` : '',
      m.facts.boxes ? `${m.facts.boxes} cases à cocher, étape par étape` : '',
      m.facts.checklists ? 'Une checklist à la fin de chaque chapitre' : '',
      m.facts.actions ? `${m.facts.actions} actions guidées, chacune avec son but` : '',
      m.perDay ? `Un plan de ${m.perDay.n} ${m.perDay.n > 1 ? `${m.perDay.unit}s` : m.perDay.unit}, à suivre dans l’ordre` : '',
    ].filter(Boolean).map((x) => `<li>${icon('pen')}<span>${h(x)}</span></li>`).join('')}</ul></div><div class="fill-pages">${(sheets.length ? sheets : m.leaves).slice(0, 2).map((l) => pageFig(l)).join('')}</div></div></div></section>` : '';
    return [
      hero(m, t, { cls: 'i-hero', hook: true }),
      gallery,
      fill,
      painsSection(m, { variant: 'list', cls: 'i-pains alt' }),
      solutionSection(m, { cls: 'i-solution alt' }),
      chaptersSection(m, { variant: 'bento', cls: 'i-chapters' }),
      reviewsSection(m, { variant: 'cards', max: 6, cls: 'i-reviews alt' }),
      bonusSection(m),
      faqSection(m),
      guaranteeSection(m),
      finalSection(m),
    ].join('\n');
  },
  css: () => `${HERO_BASE}
.i-hero .h-scene{order:0}
.i-hero h1{font-size:min(clamp(28px,7.4vw,52px),var(--fit))}
@media (min-width:${BP.lg}px){.i-hero{--col:.42}.i-hero .hero-grid{grid-template-columns:minmax(0,1.25fr) minmax(0,.9fr)}.i-hero .h-scene{order:-1}}
.band-sec{background:var(--band);color:var(--on-band)}
.band-sec .kicker{color:var(--on-band-accent)}
.band-sec .lead{color:var(--on-band-muted)}
.band-sec .cap{color:var(--on-band-muted)}
.i-rail{display:flex;gap:18px;overflow-x:auto;scroll-snap-type:x mandatory;margin:0 -20px;padding:4px 20px 18px}
.i-rail figure{flex:0 0 78%;max-width:420px;margin:0;scroll-snap-align:center}
.i-rail .pg{box-shadow:0 26px 40px -20px rgba(0,0,0,.7)}
.fill-grid{display:grid;gap:30px;align-items:center}
.fill-pages{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.fill-pages figure{margin:0}
.fill-pages figure:nth-child(2){transform:translateY(24px)}
.pain-list{list-style:none;padding:0;margin:20px 0 0;border-top:1px solid var(--line)}
.pain-list li{padding:14px 0;border-bottom:1px solid var(--line)}
.pain-list q{quotes:"« " " »"}
.pains-close{font:700 20px/1.3 var(--display);margin:24px 0 0}
.i-solution{padding-top:0}
.for-who{color:var(--muted)}
.chapters{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.chapters .ch{display:grid;grid-template-columns:50px minmax(0,1fr);gap:12px;padding:20px}
.chapters .num{font:700 30px/1 var(--display);color:var(--a-text)}
.chapters h3{font-size:19px;line-height:1.25;margin-bottom:6px}
.chapters p{margin:0;color:var(--muted);font-size:15px}
.part{font-size:20px;margin:26px 0 14px}
.review-grid{display:grid;gap:16px}
.rating-big{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 18px;font:600 15px/1.3 var(--label)}
.rating-big b{font:700 34px/1 var(--display)}
.bonus-card{display:flex;gap:18px;padding:26px}.bonus-card .gift .ico{width:30px;height:30px;color:var(--a-text)}.tag{font:700 12px/1 var(--label);letter-spacing:.14em;text-transform:uppercase;color:var(--b-text);margin:0 0 8px}.bonus-card h3{font-size:22px}.bonus-card p{margin:6px 0 0}
.new-card{padding:22px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}.new-card p{margin:0}
@media (min-width:${BP.md}px){.i-rail{margin:0 -32px;padding:4px 32px 18px}.i-rail figure{flex-basis:42%}.chapters.bento{grid-template-columns:repeat(2,minmax(0,1fr))}.chapters.bento .wide{grid-column:span 2}.review-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:${BP.lg}px){.i-rail{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));overflow:visible;margin:0;padding:0;gap:28px}.i-rail figure{max-width:none}.fill-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:60px}.chapters.bento{grid-template-columns:repeat(3,minmax(0,1fr))}.review-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}`,
};

// ───────────────────────────── creator ─────────────────────────────

const creator: Template = {
  faces: { label: true, italic: true },
  pages: ['page-du-guide', 'fiche-a-imprimer', 'ouverture-de-chapitre', 'votre-plan'],
  maxPages: 3,
  nav: (m) => navOf(m, [['pourquoi', 'Pourquoi ce guide']]),
  body: (m, t) => {
    const first = (m.story.split(/(?<=[.!?…])\s+/)[0] ?? '').trim();
    const top = `<p class="eyebrow">Un mot de l’équipe ${h(m.brand)}</p>`;
    const pinned = m.leaves.length ? `<section class="c-pages" id="apercu"><div class="wrap">${kicker(m.onSale ? 'Avant d’acheter' : 'Aperçu')}<h2 class="h2">Voici à quoi il ressemble</h2><div class="c-pinned">${m.leaves.slice(0, 3).map((l) => pageFig(l)).join('')}</div><p class="lead">De vraies pages du ${m.noun}, pas une maquette. Seul le texte courant est masqué dans l’aperçu.</p></div></section>` : '';
    return [
      hero(m, t, { top, extra: first ? `<p class="c-quote">« ${h(first)} »</p>` : '', hook: false, cls: 'c-hero' }),
      letterSection(m, { cls: 'c-letter' }),
      forWhoSection(m, { cls: 'c-for alt' }),
      chaptersSection(m, { variant: 'steps', title: 'Ce que vous allez faire, étape par étape', cls: 'c-steps' }),
      pinned,
      reviewsSection(m, { variant: 'cards', max: 4, cls: 'c-reviews alt' }),
      bonusSection(m),
      faqSection(m),
      guaranteeSection(m),
      finalSection(m, { cls: 'c-final', ps: m.guarantee ? `P.-S. Ce ${m.noun} est couvert par notre garantie commerciale : s’il ne vous apporte rien de concret, un e-mail suffit.` : undefined }),
    ].join('\n');
  },
  css: () => `${HERO_BASE}
.c-hero .eyebrow{font:400 20px/1.3 var(--italic);letter-spacing:0;text-transform:none;color:var(--a-text)}
.c-quote{order:7;margin:0;font:400 19px/1.5 var(--italic);color:var(--muted);border-left:3px solid var(--b);padding-left:14px}
.c-hero .h-extra{order:7}
.letter-body{padding:28px 24px;font-size:19px;line-height:1.75}
.letter-body p{margin:0 0 1.1em}
.signature{margin:26px 0 0!important;font:400 30px/1.1 var(--italic);color:var(--a-text)}
.signature span{display:inline-block;padding-bottom:6px;border-bottom:2px solid var(--b)}
.for-grid{display:grid;gap:18px}
.for-grid .card{padding:24px}
.for-grid h3{font-size:22px;margin-bottom:16px}
.for-no h3{color:var(--muted)}
.chapters.steps{list-style:none;margin:0;padding:0 0 0 2px;position:relative;display:grid;gap:0}
.chapters.steps::before{content:"";position:absolute;left:21px;top:10px;bottom:10px;width:2px;background:var(--line-strong)}
.chapters.steps .ch{display:grid;grid-template-columns:44px minmax(0,1fr);gap:16px;padding:12px 0 20px;position:relative}
.chapters.steps .num{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:var(--card);border:2px solid var(--a);font:700 14px/1 var(--label);color:var(--a-text);position:relative}
.chapters.steps h3{font-size:20px;line-height:1.25;margin:8px 0 6px}
.chapters.steps p{margin:0;color:var(--muted);font-size:16px}
.part{font-size:20px;margin:26px 0 14px}
.c-pinned{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:10px 0 24px}
.c-pinned figure{margin:0}
.c-pinned figure:nth-child(1){transform:rotate(-3deg)}.c-pinned figure:nth-child(2){transform:translateY(-10px) rotate(1.5deg)}.c-pinned figure:nth-child(3){transform:rotate(3deg)}
.c-pinned .cap{display:none}
.review-grid{display:grid;gap:16px}
.rating-big{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 18px;font:600 15px/1.3 var(--label)}
.rating-big b{font:700 34px/1 var(--display)}
.bonus-card{display:flex;gap:18px;padding:26px}.bonus-card .gift .ico{width:30px;height:30px;color:var(--a-text)}.tag{font:700 12px/1 var(--label);letter-spacing:.14em;text-transform:uppercase;color:var(--b-text);margin:0 0 8px}.bonus-card h3{font-size:22px}.bonus-card p{margin:6px 0 0}
.new-card{padding:22px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}.new-card p{margin:0}
.ps{font:400 18px/1.5 var(--italic);color:var(--on-band-muted);margin:22px auto 0;max-width:560px}
@media (min-width:${BP.md}px){.for-grid{grid-template-columns:1fr 1fr}.review-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.letter-body{padding:44px 52px}.c-pinned{gap:28px}}`,
};

// ───────────────────────────── proof ─────────────────────────────

const proof: Template = {
  faces: { label: true, italic: false },
  pages: ['ouverture-de-chapitre', 'page-du-guide', 'fiche-a-imprimer', 'schema'],
  maxPages: 3,
  nav: (m) => navOf(m),
  body: (m, t) => {
    const latest = m.reviews.find((r) => r.rating >= 4 && r.text.length <= 170) ?? m.reviews[0];
    const score = m.reviews.length && m.avg > 0
      ? `<div class="p-score"><b>${h(m.avg.toFixed(1).replace('.', ','))}</b><div>${stars(m.avg, 20)}<span>${h(`sur 5 · ${m.total} avis vérifiés`)}</span></div></div>`
      : '';
    const quote = latest ? `<blockquote class="p-latest"><p>« ${h(latest.text)} »</p><footer>${icon('check')}Acheteur vérifié · le plus récent</footer></blockquote>` : '';
    const wall = m.reviews.length ? `<section class="p-wall alt" id="avis"><div class="wrap"><div class="p-verify card"><div>${kicker('Comment nous vérifions les avis')}<h2 class="h2">${h(m.total > 1 ? `${m.total} acheteurs ont donné leur avis` : 'Un acheteur a donné son avis')}</h2>${verifiedLine()}</div>${breakdownBlock(m)}</div><div class="review-wall cards">${m.reviews.slice(0, 12).map((r) => `<article class="review card"><div class="review-head"><span class="who">${icon('check')}Acheteur vérifié</span>${stars(r.rating, 15)}</div><p>${h(r.text)}</p></article>`).join('')}</div></div></section>`
      : (m.onSale ? `<section class="p-wall alt" id="avis"><div class="wrap narrow">${kicker('Avis des lecteurs')}<h2 class="h2">Nouveau : les premiers avis arrivent</h2>${verifiedLine()}${newBlock(m)}</div></section>` : '');
    return [
      hero(m, t, { top: `${score}${eyebrow(m)}`, extra: quote, hook: false, cls: 'p-hero' }),
      wall,
      chaptersSection(m, { variant: 'list', title: 'Ce qu’ils ont acheté', cls: 'p-chapters' }),
      stripSection(m, { max: 3, cls: 'p-pages' }),
      bonusSection(m),
      faqSection(m),
      guaranteeSection(m),
      finalSection(m),
    ].join('\n');
  },
  css: () => `${HERO_BASE}
.p-score{order:0;display:flex;align-items:center;gap:14px}
.p-score b{font:700 clamp(54px,14vw,92px)/.85 var(--display);letter-spacing:-.04em;color:var(--ink)}
.p-score div{display:flex;flex-direction:column;gap:6px;font:600 14px/1.3 var(--label);color:var(--muted)}
.p-hero .h-extra{order:7}
.p-latest{order:7;margin:0;padding:16px 18px;background:var(--card);border-radius:var(--r);border:var(--bw) solid var(--bc)}
.p-latest p{margin:0 0 8px;font-size:16px;line-height:1.5}
.p-latest footer{display:flex;align-items:center;gap:6px;padding:0;text-align:left;font:700 12px/1.3 var(--label);color:var(--a-text)}
.p-latest footer .ico{width:15px;height:15px;stroke-width:2.4}
.p-hero .p-score~.h-buy .rating{display:none}
.p-verify{display:grid;gap:22px;padding:26px;margin-bottom:28px}
.p-verify .verified{margin:0}
.breakdown{display:grid;gap:8px;align-content:center}
.bd-title{font:700 12px/1.3 var(--label);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 4px}
.bd-row{display:grid;grid-template-columns:44px minmax(0,1fr) 36px;align-items:center;gap:10px;font:600 14px/1 var(--label)}
.bd-row span:first-child{display:flex;align-items:center;gap:4px}
.star-ico{width:14px;height:14px;fill:var(--star);stroke:none}
.bar{height:10px;background:var(--star-off);border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:var(--star);border-radius:99px}
.cnt{text-align:right;color:var(--muted)}
.review-wall{columns:1;column-gap:18px}
.review-wall .review{break-inside:avoid;margin:0 0 18px;display:block}
.chapters{list-style:none;margin:0;padding:0;display:grid;gap:0 40px}
.chapters .ch{display:grid;grid-template-columns:44px minmax(0,1fr);gap:12px;padding:16px 0;border-top:1px solid var(--line)}
.chapters .num{font:700 24px/1 var(--display);color:var(--a-text)}
.chapters h3{font-size:18px;line-height:1.3;margin-bottom:4px}
.chapters p{margin:0;color:var(--muted);font-size:15px}
.part{font-size:20px;margin:26px 0 14px}
.bonus-card{display:flex;gap:18px;padding:26px}.bonus-card .gift .ico{width:30px;height:30px;color:var(--a-text)}.tag{font:700 12px/1 var(--label);letter-spacing:.14em;text-transform:uppercase;color:var(--b-text);margin:0 0 8px}.bonus-card h3{font-size:22px}.bonus-card p{margin:6px 0 0}
.new-card{padding:22px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}.new-card p{margin:0}
@media (min-width:${BP.md}px){.review-wall{columns:2}.p-verify{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:40px;padding:34px}.chapters{grid-template-columns:1fr 1fr}}
@media (min-width:${BP.lg}px){.review-wall{columns:3}}`,
};

// ───────────────────────────── value ─────────────────────────────

const value: Template = {
  faces: { label: true, italic: false },
  pages: ['fiche-a-imprimer', 'votre-plan', 'schema', 'le-plan-a-cocher', 'page-du-guide', 'ouverture-de-chapitre'],
  maxPages: 4,
  nav: (m) => navOf(m, [['prix', 'Le prix']]),
  body: (m, t) => {
    const top = `<p class="eyebrow">Ce que vous obtenez pour ${h(m.price)}</p>`;
    const counts = [
      m.facts.chapters ? [String(m.facts.chapters), 'chapitres'] : null,
      m.facts.actions ? [String(m.facts.actions), 'actions guidées'] : null,
      m.facts.sheets ? [String(m.facts.sheets), m.facts.sheets > 1 ? 'fiches à imprimer' : 'fiche à imprimer'] : m.facts.pages ? [String(m.facts.pages), 'pages'] : null,
    ].filter((x): x is string[] => !!x);
    const extra = counts.length ? `<ul class="v-counts">${counts.map(([n, l]) => `<li><b>${h(n)}</b><span>${h(l!)}</span></li>`).join('')}</ul>` : '';
    return [
      hero(m, t, { top, extra, drop: true, hook: false, cls: 'v-hero' }),
      bentoSection(m, { cls: 'v-bento' }),
      comparisonSection(m, { cls: 'v-compare alt' }),
      priceSection(m, { cls: 'v-price' }),
      stripSection(m, { max: 4, cls: 'alt', title: m.onSale ? 'Les fiches et les pages, avant de payer' : undefined }),
      reviewsSection(m, { variant: 'cards', max: 3, cls: 'v-reviews' }),
      faqSection(m),
      guaranteeSection(m),
      finalSection(m),
    ].join('\n');
  },
  css: () => `${HERO_BASE}
.v-hero .eyebrow{color:var(--ink)}
.v-counts{order:7;list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.v-counts li{display:flex;flex-direction:column;gap:4px;padding:12px;background:var(--card);border:var(--bw) solid var(--bc);border-radius:var(--r)}
.v-counts b{font:700 28px/1 var(--display)}
.v-counts span{font:600 12px/1.25 var(--label);color:var(--muted)}
.bento{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.tile{display:flex;flex-direction:column;gap:8px;padding:18px;min-height:150px}
.tile .ico{width:26px;height:26px;color:var(--a-text)}
.tile b{font:700 40px/1 var(--display);letter-spacing:-.02em;margin-top:auto}
.tile span{font:600 14px/1.35 var(--label);color:var(--ink)}
.tile.wide{grid-column:span 2}
.cmp{padding:6px 0;overflow:hidden}
.cmp-row{display:grid;grid-template-columns:1fr;gap:6px;padding:16px 20px;border-top:1px solid var(--line)}
.cmp-row:first-child{border-top:0}
.cmp-head{display:none}
.cmp-l{font:700 12px/1.3 var(--label);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.cmp-g{display:flex;gap:10px;align-items:flex-start;font:600 16px/1.4 var(--label)}
.cmp-g .ico{color:var(--a-text);margin-top:1px}
.cmp-o{color:var(--muted);font-size:15px;padding-left:32px}
.offer{padding:26px;display:flex;flex-direction:column;gap:18px}
.offer-in{display:flex;gap:20px;align-items:flex-start}
.offer-cover{width:96px;flex:none;box-shadow:0 14px 28px -14px var(--shadow-ink)}
.offer .price-box{margin-bottom:8px}
.per-day{font:600 15px/1.45 var(--label);color:var(--a-text);margin:6px 0 14px}
.review-grid{display:grid;gap:16px}
.rating-big{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 18px;font:600 15px/1.3 var(--label)}
.rating-big b{font:700 34px/1 var(--display)}
.new-card{padding:22px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}.new-card p{margin:0}
@media (max-width:${BP.md - 1}px){.v-hero .v-counts{display:none}}
@media (min-width:${BP.md}px){.bento{grid-template-columns:repeat(4,minmax(0,1fr))}.cmp-head{display:grid}.cmp-row{grid-template-columns:minmax(0,.7fr) minmax(0,1.2fr) minmax(0,1fr);gap:24px;align-items:center}.cmp-head span{font:700 13px/1.2 var(--label);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}.cmp-o{padding-left:0}.review-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}`,
};

export const TEMPLATES: Record<PageTemplate, Template> = { express, editorial, inside, creator, proof, value };

