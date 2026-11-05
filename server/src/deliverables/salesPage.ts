/**
 * Self-contained storefront page (pdf §11): the guide's inks and type, its cover as a real book, its real pages as previews,
 * a fake checkout. Nothing leaves the file: the fonts are inlined and no URL is ever fetched.
 *
 * This is the V1 page, drawn as it always was but for the law's words (design plan D208): its guarantee says it is commercial,
 * its reviews say how they are verified. A page that names a template (design plan D202) is drawn by `sales/` instead.
 */
import type { DesignSpec, Product, Review, SalesPage } from '../shared.js';
import { ensureContrast, mix, rgba } from './color.js';
import { COVER_H, COVER_W, splitTitle } from './cover.js';
import { cssFontStack, normalizeDesign } from './design.js';
import { loadVoice } from './fonts.js';
import { kitBoxes, kitSheets } from './kit.js';
import { guidedActions } from './pages/render.js';
import { atPriceOfTheDay, CAPTIONS, CHECKOUT_ALERT, figureSvgFor, fontFace, h, safeSvg, shortTitle } from './sales/common.js';
import { renderTemplatePage, type SalesPageInput } from './sales/index.js';
import { GUARANTEE_TITLE, REVIEWS_VERIFIED } from './sales/law.js';
import { escapeHtml as esc, formatPrice, slugify, truncate, wholeClause } from './text.js';
import type { Voice } from './voices.js';

export { figureSvgFor };

const MIN_LEAVES = 4;         // pages in « Feuilletez-le » (pdf §11.1): the cover joins them only to reach this
const MAX_LEAVES = 6;

/**
 * The stage, in % of its width. A device may overlap the cover by 15 % of its width at most, and on its art only, so the
 * book's title stays readable (pdf §11.2). The art is on top of the `split` cover, in the bottom right corner of `minimal`.
 */
export const STAGE = {
  book: { left: 4, top: 12, width: 62, turn: 24 },
  art: { tablet: { left: 58, top: 2, width: 34 }, phone: { left: 70, top: 46, width: 16 } },
  foot: { tablet: { left: 66, top: 4, width: 32 }, phone: { left: 57, top: 70, width: 16 } },
} as const;

function starsHtml(rating: number, size = 18): string {
  const r = Math.max(0, Math.min(5, Number.isFinite(rating) ? rating : 0));
  const star = (fill: string) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="${fill}"/></svg>`;
  const row = (fill: string) => Array.from({ length: 5 }, () => star(fill)).join('');
  return `<span class="stars" role="img" aria-label="${h(`${r.toFixed(1).replace('.', ',')} sur 5`)}"><span class="stars-bg">${row('var(--line)')}</span><span class="stars-fg" style="width:${(r / 5) * 100}%">${row('var(--warm)')}</span></span>`;
}

const ICON = {
  gift: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v9H4zM3 7.5h18V11H3zM12 7.5V20M12 7.5C10.5 4 7 4 7 6s3 1.5 5 1.5zM12 7.5C13.5 4 17 4 17 6s-3 1.5-5 1.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 12l2.2 2.2L15.2 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** A review carries no date: a buyer has no use for the day of a game. */
function reviewCard(r: Review): string {
  return `<article class="review"><div class="review-head"><div><strong>Acheteur vérifié</strong></div>${starsHtml(r.rating, 15)}</div><p>${h(r.text)}</p></article>`;
}

/** A position on the stage as CSS: the numbers `STAGE` states and a test reads. */
const placed = (at: { left: number; top: number; width: number }): string => `left:${at.left}%;top:${at.top}%;width:${at.width}%`;

function css(d: DesignSpec, voice: Voice): string {
  const inks = d.inks!;
  const accent = ensureContrast(inks.a, inks.paper, 4.5);
  const warm = ensureContrast(inks.b, inks.paper, 4.5);
  const display = `'Guide Display', ${cssFontStack(d.titleFont)}`;
  const text = `'Guide Text', ${cssFontStack(d.bodyFont)}`;
  const label = `system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
  const { book } = STAGE;
  return `${fontFace('Guide Display', voice.display)}${fontFace('Guide Text', voice.text)}
:root{--paper:${inks.paper};--ink:${inks.ink};--a:${accent};--warm:${warm};--tint:${mix(inks.paper, inks.c, 0.22)};--page:${mix(inks.paper, '#ffffff', 0.7)};
--line:${rgba(inks.ink, 0.16)};--muted:${mix(inks.ink, inks.paper, 0.28)};--on-ink:${ensureContrast(inks.c, inks.ink, 4.5)};
--display:${display};--text:${text};--label:${label}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.6 var(--text);-webkit-font-smoothing:antialiased;overflow-wrap:break-word}
svg{display:block;max-width:100%;height:auto}
main{overflow-x:clip}
h1,h2,h3{font-family:var(--display);font-weight:700;margin:0}
h1{font-size:clamp(34px,5vw,54px);line-height:1.04;letter-spacing:-.02em;margin:14px 0 16px}
h2{font-size:clamp(27px,3.6vw,38px);line-height:1.08;letter-spacing:-.015em;margin:12px 0 14px}
h3{font-size:19px;line-height:1.2;margin-bottom:4px}
p{margin:0 0 1em}strong{font-family:var(--label);font-weight:700;font-size:.92em}
.wrap{width:100%;max-width:1120px;margin:0 auto;padding:0 20px}.narrow{max-width:760px}
section{padding:68px 0;scroll-margin-top:60px}
.eyebrow,.kicker{display:block;font:700 12px/1.35 var(--label);letter-spacing:.16em;text-transform:uppercase;color:var(--warm)}
.demo-banner{background:var(--ink);color:var(--paper);text-align:center;font:500 13px/1.35 var(--label);padding:7px 12px}
/* header */
.top{position:sticky;top:0;z-index:20;background:var(--paper);border-bottom:1px solid var(--line)}
.top-in{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:58px}
.brand{font:600 12px/1.2 var(--label);letter-spacing:.14em;text-transform:uppercase;color:var(--ink);text-decoration:none}
.top nav{display:none;gap:24px;font:500 14px/1 var(--label)}.top nav a{color:var(--muted);text-decoration:none}.top nav a:hover{color:var(--ink)}
/* buttons */
.buy{appearance:none;border:0;cursor:pointer;display:inline-flex;align-items:baseline;justify-content:center;flex-wrap:wrap;gap:4px 14px;background:var(--ink);color:var(--paper);font:700 17px/1.2 var(--label);padding:18px 28px;transition:transform .15s ease}
.buy em{font:700 22px/1 var(--display);font-style:normal;color:var(--on-ink)}
.buy:hover{transform:translateY(-2px)}.buy:active{transform:none}
.buy:focus-visible{outline:3px solid var(--warm);outline-offset:3px}
.buy.small{padding:11px 14px;font-size:13px;flex:none}
/* hero */
.hero{padding:40px 0 64px}
.hero-grid{display:grid;gap:44px;align-items:center;grid-template-columns:minmax(0,1fr)}
.deck{font-size:21px;line-height:1.35;color:var(--a);margin:0 0 14px}
.hook{font-size:18px;line-height:1.5;margin:0 0 20px}
.rating-line{display:flex;align-items:center;gap:10px;font:500 14px/1.3 var(--label);margin:0 0 18px}
.strip{list-style:none;display:flex;flex-wrap:wrap;gap:12px 24px;margin:0 0 26px;padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font:500 14px/1.3 var(--label)}
.strip b{display:block;font:700 26px/1 var(--display);margin-bottom:4px}
.note{font:400 13px/1.4 var(--label);color:var(--muted);margin:12px 0 0}
.gone{display:inline-block;border-left:3px solid var(--warm);padding:8px 14px;margin:0;font:700 17px/1.35 var(--label)}
/* stage: a book in CSS 3D, its spine shaded, its pages stacked; two devices showing real pages */
.stage{position:relative;width:100%;max-width:560px;margin:0 auto;aspect-ratio:1/1.04;perspective:1600px}
.stage.alone{max-width:440px;aspect-ratio:1/1.3}
.book{position:absolute;${placed(book)};aspect-ratio:${COVER_W}/${COVER_H};transform:rotateY(-${book.turn}deg);transform-style:preserve-3d;box-shadow:30px 40px 60px ${rgba(inks.ink, 0.34)}}
.stage.alone .book{left:14%;width:72%;top:4%}
.front{position:relative;overflow:hidden;background:var(--paper)}
.front svg{width:100%}
.front:after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,rgba(0,0,0,.26) 0,rgba(0,0,0,.05) 3%,rgba(255,255,255,.1) 5%,rgba(255,255,255,0) 14%)}
.edge{position:absolute;top:1.5%;right:-3%;width:3%;height:97%;background:repeating-linear-gradient(180deg,#fff 0 1px,${mix(inks.paper, inks.ink, 0.12)} 1px 2px);transform:rotateY(90deg);transform-origin:left}
.device{position:absolute;padding:1.6%;background:var(--ink);box-shadow:16px 22px 40px ${rgba(inks.ink, 0.38)}}
.device .s{overflow:hidden;background:var(--page)}
.device svg{width:100%}
.tablet{border-radius:14px;transform:rotate(3deg)}.tablet .s{border-radius:5px}
.phone{border-radius:16px;transform:rotate(-4deg)}.phone .s{border-radius:11px;aspect-ratio:9/16}.phone svg{width:175%;max-width:none}
.stage .tablet{${placed(STAGE.art.tablet)}}.stage .phone{${placed(STAGE.art.phone)}}
.stage.foot .tablet{${placed(STAGE.foot.tablet)}}.stage.foot .phone{${placed(STAGE.foot.phone)}}
/* pains: the customers' words, hairlines, no cards */
.pain-list{list-style:none;padding:0;margin:26px 0 0;border-top:1px solid var(--line)}
.pain-list li{padding:14px 0;border-bottom:1px solid var(--line)}
.pain-list q{quotes:"« " " »"}
.pains-close{font-family:var(--display);font-weight:700;font-size:21px;line-height:1.25;margin:26px 0 0}
.solution{padding-top:0}.solution p{margin-top:10px}
.for-who{color:var(--muted)}
/* the pages */
.band{background:var(--ink);color:var(--paper)}
.band .kicker{color:var(--on-ink)}
.band .lead{max-width:680px;margin:0 0 34px;opacity:.88}
.leaves{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}
.leaf{margin:0}
.leaf .p{background:var(--page);box-shadow:0 14px 34px rgba(0,0,0,.45);transition:transform .25s ease}
.leaf:hover .p{transform:translateY(-6px)}
.leaf svg{width:100%}
.leaf figcaption{font:500 13px/1.35 var(--label);margin-top:12px;opacity:.88}
.figure .fig{margin-top:26px}.figure .fig svg{width:100%}
/* chapters */
.chapters{list-style:none;padding:0;margin:26px 0 0;display:grid;gap:0 44px;grid-template-columns:minmax(0,1fr)}
.chapters li{display:grid;grid-template-columns:54px minmax(0,1fr);gap:12px;padding:18px 0;border-top:1px solid var(--line)}
.num{font:700 30px/1 var(--display);color:var(--a)}
.chapters p{margin:0;color:var(--muted);font-size:16px}
.part{font-size:21px;margin-top:34px}.part+.chapters{margin-top:14px}
/* bonus */
.bonus{padding-top:0}
.bonus-card{display:flex;gap:18px;align-items:flex-start;background:var(--tint);padding:26px 24px}
.gift{flex:none;width:30px;color:var(--a)}
.tag{display:block;font:700 12px/1 var(--label);letter-spacing:.16em;color:var(--warm);margin-bottom:10px}
.bonus-card p{margin:6px 0 0}
/* reviews */
.stars{position:relative;display:inline-block;line-height:0;white-space:nowrap;vertical-align:middle}
.stars svg{display:inline-block}
.stars-fg{position:absolute;left:0;top:0;overflow:hidden;white-space:nowrap}
.rating-big{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 22px;font:500 15px/1.3 var(--label)}
.rating-big strong{font:700 30px/1 var(--display)}
.review-grid{display:grid;gap:0 36px;grid-template-columns:minmax(0,1fr)}
.review{padding:18px 0;border-top:1px solid var(--line)}
.review-head{display:flex;align-items:center;gap:12px;margin-bottom:10px;font:500 14px/1.3 var(--label)}
.review-head div{flex:1}
.review p{margin:0}
.no-review{color:var(--muted)}
.verified{margin:-10px 0 18px;max-width:680px;font:400 14px/1.45 var(--label);color:var(--muted)}
/* faq */
.faq details{border-top:1px solid var(--line)}.faq details:last-child{border-bottom:1px solid var(--line)}
.faq summary{cursor:pointer;list-style:none;padding:16px 36px 16px 0;font:700 16px/1.35 var(--label);position:relative}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";position:absolute;right:4px;top:13px;font:400 22px/1 var(--label);color:var(--warm)}
.faq details[open] summary::after{content:"–"}
.faq details p{margin:0 0 18px;color:var(--muted)}
/* guarantee */
.guarantee{padding-top:0}
.guarantee-card{display:flex;gap:18px;align-items:flex-start;border-top:3px solid var(--ink);padding-top:22px}
.shield{flex:none;width:34px;color:var(--a)}
.guarantee-card h2{font-size:24px;margin-top:0}
.guarantee-card p{margin:0}
/* final */
.final{background:var(--ink);color:var(--paper);text-align:center}
.final .price{display:block;font:700 44px/1 var(--display);color:var(--on-ink);margin:8px 0 22px}
.final .buy{background:var(--paper);color:var(--ink);max-width:100%}
.final .buy em{color:var(--a)}
.final .note{color:inherit;opacity:.8}
footer{padding:26px 0 104px;font:400 13px/1.45 var(--label);color:var(--muted);text-align:center}
footer p{margin:4px 0}
.sticky-buy{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:var(--paper);border-top:1px solid var(--line)}
.sticky-buy .mini{display:flex;flex-direction:column;line-height:1.2;min-width:0}.sticky-buy .mini span{font:400 13px/1.2 var(--label);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sticky-buy strong{font:700 20px/1.1 var(--display)}
.sticky-buy .buy{padding:12px 16px;font-size:15px;flex:none}
@media (min-width:760px){
  .leaves{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
  .chapters,.review-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (min-width:980px){
  .top nav{display:flex}
  .hero{padding:44px 0 72px}
  .hero-grid{grid-template-columns:minmax(0,1.04fr) minmax(0,1fr);gap:64px}
  .review-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .sticky-buy{display:none}
  footer{padding-bottom:36px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}html{scroll-behavior:auto}}
`;
}

interface Leaf { id: string; kind: string; caption: string; box: string; svg: string }

/** The real pages the page shows: the cover is already on stage, it only joins them to reach `MIN_LEAVES`. Each gets an id the devices reuse, so a page travels once. */
function leavesOf(previews: { label: string; svg: string }[] | undefined): Leaf[] {
  const pages = (previews ?? []).map((p) => ({ kind: slugify(String(p?.label ?? '')), caption: String(p?.label ?? ''), svg: safeSvg(p?.svg) })).filter((p) => p.svg.startsWith('<svg'));
  const inner = pages.filter((p) => p.kind !== 'couverture');
  return (inner.length >= MIN_LEAVES ? inner : pages).slice(0, MAX_LEAVES).map((p, k) => {
    const id = `page-${k + 1}`;
    return { ...p, id, caption: CAPTIONS[p.kind] ?? p.caption, box: /viewBox="([^"]+)"/.exec(p.svg)?.[1] ?? '0 0 595.28 841.89', svg: p.svg.replace('<svg', `<svg id="${id}"`) };
  });
}

const device = (kind: 'tablet' | 'phone', page: Leaf | undefined): string =>
  page ? `<div class="device ${kind}"><div class="s"><svg viewBox="${page.box}" aria-hidden="true"><use href="#${page.id}"/></svg></div></div>` : '';

const figureOf = (k: number, one: string, many: string): string => (k > 0 ? `<li><b>${k}</b>${k > 1 ? many : one}</li>` : '');

interface Inside { title: string; blurb?: string }

const insideList = (rows: readonly Inside[]): string => `<ol class="chapters">${rows.map((c, k) => `<li><span class="num">${String(k + 1).padStart(2, '0')}</span><div><h3>${h(c.title)}</h3>${c.blurb ? `<p>${h(c.blurb)}</p>` : ''}</div></li>`).join('')}</ol>`;

/**
 * Self-contained HTML store page for one product. `figureSvg` left out: the guide's own plan or loop, `null`: none. `offSale`: stopped from outside, the kit of a guide that left the shop.
 * A copy that names a template is drawn by that template (D202); without one, this is the V1 page.
 */
export function renderSalesPageHtml(input: SalesPageInput): string {
  if ((input.salesPage ?? input.product?.salesPage)?.template) return renderTemplatePage(input);
  return renderV1Page(input);
}

function renderV1Page(input: { product: Product; salesPage: SalesPage; coverSvg: string; design: DesignSpec; brand: string; previews?: { label: string; svg: string }[]; figureSvg?: string | null; offSale?: boolean }): string {
  const { product } = input;
  const isKit = product.kind === 'kit';
  const noun = isKit ? 'kit' : 'guide';
  const onSale = !input.offSale && product.status !== 'killed' && product.status !== 'paused'; // a page stays where it is: what it cannot do any more is sell
  const sp = atPriceOfTheDay(input.salesPage ?? (product.salesPage as SalesPage), product.price);
  const d = normalizeDesign(input.design ?? product.design);
  const { voice } = loadVoice(d.voice!);
  const brand = (input.brand || 'Pixel Agency').trim();
  const price = formatPrice(product.price);
  const content = product.content;
  const chapterCount = content?.chapters?.length ?? sp?.chapterBlurbs?.length ?? 0;
  const headline = sp?.headline || product.title;
  const sub = sp?.subheadline || product.subtitle;
  const { head, tail } = splitTitle(product.title || headline);
  const hook = headline === (product.title || headline) ? sub : headline; // the title is on the cover and in the h1: the written hook sells under it
  // the button is written once, the price moves: it always shows the price of the day
  const cta = (sp?.cta || 'Je télécharge le guide').replace(/\d+(?:[.,]\d+)?\s*€/g, price);
  const ctaHtml = cta.includes(price) ? h(cta) : `${h(cta)} <em>${esc(price)}</em>`;
  const pains = (sp?.painBullets ?? []).filter(Boolean);
  const blurbs = (sp?.chapterBlurbs ?? []).filter((b) => b && (b.title || b.blurb));
  const chapterList = blurbs.length ? blurbs : (content?.chapters ?? []).map((c) => ({ title: c.title, blurb: c.intro }));
  // the card already says « BONUS OFFERT »: the heading is the gift itself
  const bonusTitle = String(content?.bonus?.title ?? '').replace(/^bonus\s*(?:offert\s*)?[:—–-]\s*/i, '').replace(/^./, (ch) => ch.toUpperCase());
  const reviews = [...(product.stats?.reviews ?? [])].filter((r) => r && r.text).sort((a, b) => b.day - a.day || b.rating - a.rating);
  const avg = (product.stats?.rating ?? 0) > 0 ? product.stats.rating : reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const reviewTotal = Math.max(product.stats?.ratingCount ?? 0, reviews.length); // the list keeps the latest ones, the stars and this line read them all
  const objections = (sp?.objections ?? []).filter((o) => o && o.q);
  const practical = [
    { q: `Comment je reçois le ${noun} ?`, a: 'Tout de suite après le paiement : un lien de téléchargement s’affiche et vous est aussi envoyé par e-mail. Le PDF se lit sur téléphone, tablette et ordinateur.' },
    { q: 'Est-ce un abonnement ?', a: `Non. Vous payez ${price} une seule fois et le ${noun} est à vous, y compris ses mises à jour.` },
  ].filter((f) => !objections.some((o) => o.q.toLowerCase().includes(f.q.slice(0, 12).toLowerCase())));
  const faq = onSale ? [...objections, ...practical] : [];
  const audience = product.audience || content?.audience || '';
  const cover = safeSvg(input.coverSvg);
  // the plan drawn or the loop are the guide's: a kit prints neither
  const figure = isKit ? '' : safeSvg((input.figureSvg === undefined ? figureSvgFor(content, d) : input.figureSvg) ?? '');
  const leaves = leavesOf(input.previews);
  const inner = leaves.filter((l) => l.kind !== 'couverture');
  const tablet = inner.find((l) => l.kind === 'ouverture-de-chapitre') ?? inner[0];
  const phone = inner.find((l) => l.kind === 'page-du-guide' && l !== tablet) ?? inner.find((l) => l !== tablet);

  const sheets = figureOf(product.pdfFacts?.sheets ?? 0, 'fiche à imprimer', 'fiches à imprimer');
  // measured, or not shown: a figure the guide does not hold is never printed
  const strip = (isKit ? [
    sheets,
    figureOf(content ? kitBoxes(content) : 0, 'case à cocher', 'cases à cocher'),
    figureOf(product.pdfFacts?.pages ?? 0, 'page à imprimer', 'pages à imprimer'),
  ] : [
    figureOf(chapterCount, 'chapitre', 'chapitres'),
    figureOf(guidedActions(content?.chapters), 'action guidée', 'actions guidées'),
    sheets,
    figureOf(product.pdfFacts?.pages ?? 0, 'page illustrée', 'pages illustrées'),
  ]).join('');
  const printed = isKit && content ? kitSheets(content) : [];

  const ratingLine = reviews.length && avg > 0
    ? `<div class="rating-line">${starsHtml(avg)}<span><strong>${h(avg.toFixed(1).replace('.', ','))}</strong> · ${h(reviewTotal)} avis</span></div>`
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(product.title || headline)} — ${h(brand)}</title>
<meta name="description" content="${h(truncate(sub, 155))}">
<meta property="og:title" content="${h(headline)}">
<meta property="og:description" content="${h(truncate(sub, 155))}">
<style>${css(d, voice)}</style>
</head>
<body>
<div class="demo-banner">Boutique virtuelle Pixel Agency — environnement de test, aucun paiement réel</div>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="#top">${h(brand)}</a>
    <nav aria-label="Sections">${leaves.length ? '<a href="#apercu">Aperçu</a>' : ''}<a href="#dedans">Le contenu</a>${reviews.length ? '<a href="#avis">Avis</a>' : ''}${faq.length ? '<a href="#faq">Questions</a>' : ''}</nav>
    ${onSale ? `<button type="button" class="buy small" data-buy>Obtenir le ${noun} · ${esc(price)}</button>` : ''}
  </div>
</header>
<main id="top">
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <span class="eyebrow">${audience ? `Pour : ${h(wholeClause(audience.replace(/\s*\([^)]*\)/g, ''), (s) => s.length <= 56))}` : isKit ? 'Kit à imprimer' : 'Guide pratique'}</span>
      <h1>${h(head)}</h1>
      ${tail ? `<p class="deck">${h(tail)}</p>` : ''}
      ${hook ? `<p class="hook">${h(hook)}</p>` : ''}
      ${ratingLine}
      ${strip ? `<ul class="strip">${strip}</ul>` : ''}
      ${onSale ? `<button type="button" class="buy cta" data-buy>${ctaHtml}</button>
      <p class="note">Téléchargement immédiat · Paiement unique${sp?.guarantee ? ` · ${GUARANTEE_TITLE}` : ''}</p>` : `<p class="gone">Ce ${noun} n’est plus en vente.</p>`}
    </div>
    <div class="stage${d.coverLayout === 'minimal' ? ' foot' : ''}${tablet ? '' : ' alone'}">
      <div class="book"><div class="front">${cover}</div><div class="edge"></div></div>
      ${device('tablet', tablet)}${device('phone', phone)}
    </div>
  </div>
</section>
${pains.length ? `<section class="pains">
  <div class="wrap narrow">
    <span class="kicker">On en parle ?</span>
    <h2>Vous vous reconnaissez ?</h2>
    <ul class="pain-list">${pains.map((pb) => `<li><q>${h(pb)}</q></li>`).join('')}</ul>
    <p class="pains-close">Vous n’êtes pas seul·e. Et non, ce n’est pas une fatalité.</p>
  </div>
</section>` : ''}
${sp?.solution ? `<section class="solution">
  <div class="wrap narrow">
    <span class="kicker">La solution</span>
    <h2>${h(product.title || headline)}</h2>
    <p>${h(sp.solution)}</p>
    ${audience ? `<p class="for-who"><strong>Pensé pour :</strong> ${h(audience)}</p>` : ''}
  </div>
</section>` : ''}
${leaves.length ? `<section class="band" id="apercu">
  <div class="wrap">
    <span class="kicker">${onSale ? 'Avant d’acheter' : 'Aperçu'}</span>
    <h2>${onSale ? 'Feuilletez-le avant de décider' : `Quelques pages du ${noun}`}</h2>
    <p class="lead">Ces pages viennent ${isKit ? 'du kit' : 'du guide'}, pas d’une maquette${onSale ? ' : ce que vous voyez est ce que vous téléchargez' : ''}. Seul le texte courant est masqué dans l’aperçu.</p>
    <div class="leaves">${leaves.map((l) => `<figure class="leaf"><div class="p">${l.svg}</div><figcaption>${h(l.caption)}</figcaption></figure>`).join('')}</div>
  </div>
</section>` : ''}
${figure ? `<section class="figure">
  <div class="wrap narrow">
    <span class="kicker">La méthode</span>
    <h2>Ce que vous aurez sous les yeux</h2>
    <div class="fig">${figure}</div>
  </div>
</section>` : ''}
${chapterList.length ? `<section class="inside" id="dedans">
  <div class="wrap">
    <span class="kicker">${isKit ? 'Fiche par fiche, étape par étape' : 'Chapitre par chapitre'}</span>
    <h2>Ce qu’il y a dedans</h2>
    ${isKit ? `${printed.length ? `<h3 class="part">Les fiches à remplir</h3>${insideList(printed.map((v) => ({ title: v.title })))}` : ''}<h3 class="part">Le plan à cocher, étape par étape</h3>` : ''}${insideList(chapterList)}
  </div>
</section>` : ''}
${sp?.bonusBlurb || bonusTitle ? `<section class="bonus">
  <div class="wrap narrow">
    <div class="bonus-card"><span class="gift">${ICON.gift}</span><div><span class="tag">BONUS OFFERT</span>${bonusTitle ? `<h3>${h(bonusTitle)}</h3>` : ''}${sp?.bonusBlurb ? `<p>${h(sp.bonusBlurb)}</p>` : ''}</div></div>
  </div>
</section>` : ''}
${reviews.length || onSale ? `<section class="reviews" id="avis">
  <div class="wrap">
    <span class="kicker">Avis des ${isKit ? 'acheteurs' : 'lecteurs'}</span>
    <h2>${reviews.length ? `Ce qu’en disent les ${isKit ? 'acheteurs' : 'lecteurs'}` : 'Les premiers avis arrivent'}</h2>
    ${reviews.length
      ? `<div class="rating-big"><strong>${h(avg.toFixed(1).replace('.', ','))}</strong>${starsHtml(avg, 22)}<span>${h(reviewTotal)} avis vérifiés</span></div><p class="verified">${h(REVIEWS_VERIFIED)}</p><div class="review-grid">${reviews.slice(0, 6).map(reviewCard).join('')}</div>`
      : `<p class="no-review">Ce ${noun} vient de sortir : aucun avis pour l’instant. Nous n’affichons jamais de faux témoignages.</p>`}
  </div>
</section>` : ''}
${faq.length ? `<section class="faq" id="faq">
  <div class="wrap narrow">
    <span class="kicker">Vos questions</span>
    <h2>Avant de vous décider</h2>
    ${faq.map((o, k) => `<details${k === 0 ? ' open' : ''}><summary>${h(o.q)}</summary><p>${h(o.a)}</p></details>`).join('')}
  </div>
</section>` : ''}
${sp?.guarantee && onSale ? `<section class="guarantee">
  <div class="wrap narrow">
    <div class="guarantee-card"><span class="shield">${ICON.shield}</span><div><h2>Notre garantie commerciale</h2><p>${h(sp.guarantee)}</p></div></div>
  </div>
</section>` : ''}
${onSale ? `<section class="final">
  <div class="wrap narrow">
    <h2>${h(headline)}</h2>
    ${sub ? `<p>${h(sub)}</p>` : ''}
    <span class="price">${esc(price)}</span>
    <button type="button" class="buy cta" data-buy>${ctaHtml}</button>
    <p class="note">PDF disponible immédiatement · Sans risque</p>
  </div>
</section>` : ''}
</main>
<footer>
  <div class="wrap">
    <p>© ${h(brand)} · ${h(product.title)}</p>
    <p>Boutique virtuelle — environnement de test Pixel Agency. Aucune donnée bancaire n’est collectée.</p>
  </div>
</footer>
${onSale ? `<div class="sticky-buy"><div class="mini"><span>${h(shortTitle(product.title || headline))}</span><strong>${esc(price)}</strong></div><button type="button" class="buy" data-buy>Obtenir le ${noun}</button></div>
<script>
(function () {
  var msg = ${JSON.stringify(CHECKOUT_ALERT)};
  var buttons = document.querySelectorAll('[data-buy]');
  for (var i = 0; i < buttons.length; i++) buttons[i].addEventListener('click', function () { alert(msg); });
})();
</script>` : ''}
</body>
</html>
`;
}
