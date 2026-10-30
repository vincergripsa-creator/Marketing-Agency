/**
 * Self-contained storefront page (Stan / Gumroad style): inline CSS, inline cover SVG, fake checkout.
 * Only optional external resource: Google Fonts, with system fallbacks.
 */
import type { DesignSpec, Product, Review, SalesPage } from '../shared.js';
import { darken, ensureContrast, isDark, lighten, mix, readableOn, rgba } from './color.js';
import { cssFontStack, normalizeDesign } from './design.js';
import { escapeHtml as esc, formatPrice, frenchNbsp, hashString, truncate, wholeClause } from './text.js';

/** Escaped prose with French no-break spaces ("6 h", "mot :") so lines never break badly. */
const h = (v: unknown): string => esc(frenchNbsp(String(v ?? '')));

const CHECKOUT_ALERT = 'Boutique virtuelle : paiement simulé — environnement de test Pixel Agency';

/** Drops anything executable from an SVG string before inlining it in HTML. */
function safeSvg(svg: string): string {
  return String(svg ?? '')
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#')
    .trim();
}

function starsHtml(rating: number, size = 18): string {
  const r = Math.max(0, Math.min(5, Number.isFinite(rating) ? rating : 0));
  const star = (fill: string) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="${fill}"/></svg>`;
  const row = (fill: string) => Array.from({ length: 5 }, () => star(fill)).join('');
  return `<span class="stars" role="img" aria-label="${h(`${r.toFixed(1).replace('.', ',')} sur 5`)}"><span class="stars-bg">${row('var(--star-off)')}</span><span class="stars-fg" style="width:${(r / 5) * 100}%">${row('var(--star)')}</span></span>`;
}

const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sigh: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 15.5c1-1 2.2-1.4 3.5-1.4s2.5.4 3.5 1.4M9 9.5h.01M15 9.5h.01" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  gift: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v9H4zM3 7.5h18V11H3zM12 7.5V20M12 7.5C10.5 4 7 4 7 6s3 1.5 5 1.5zM12 7.5C13.5 4 17 4 17 6s-3 1.5-5 1.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 12l2.2 2.2L15.2 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2.5L5.5 13H11l-1 8.5L18.5 10H13z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10.5V8a4 4 0 018 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c2.5-1 5.5-1 8 1 2.5-2 5.5-2 8-1V19c-2.5-1-5.5-1-8 1-2.5-2-5.5-2-8-1z M12 6.5V20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function reviewCard(r: Review): string {
  const hue = hashString(r.customerId || r.id) % 360;
  const initial = (r.customerId || 'C').replace(/[^a-z0-9]/gi, '').slice(-2).toUpperCase() || 'C';
  return `<article class="review"><div class="review-head"><span class="avatar" style="background:hsl(${hue} 55% 88%);color:hsl(${hue} 45% 30%)">${h(initial)}</span>`
    + `<div><strong>Acheteur vérifié</strong><small>Jour ${h(r.day)}</small></div>${starsHtml(r.rating, 15)}</div><p>${h(r.text)}</p></article>`;
}

function css(d: DesignSpec): string {
  const p = d.palette;
  const heroBg = p.bg;
  const heroDark = isDark(heroBg);
  const heroFg = readableOn(heroBg, p.ink);
  const ink = ensureContrast(p.ink, '#ffffff', 12);
  const primaryInk = ensureContrast(p.primary, '#ffffff', 4.8);
  const accentFg = readableOn(p.accent, ink);
  const pageBg = mix(p.soft, '#ffffff', 0.55);
  const titleStack = d.titleFont.startsWith('Times') ? `'Fraunces', ${cssFontStack(d.titleFont)}` : d.titleFont.startsWith('Courier') ? cssFontStack(d.titleFont) : `'Inter', ${cssFontStack('Helvetica')}`;
  const bodyStack = d.bodyFont === 'Times-Roman' ? `'Source Serif 4', ${cssFontStack('Times-Roman')}` : `'Inter', ${cssFontStack('Helvetica')}`;
  return `
:root{--ink:${ink};--muted:${mix(ink, '#ffffff', 0.38)};--bg:${pageBg};--card:#ffffff;--soft:${p.soft};--primary:${p.primary};--primary-ink:${primaryInk};
--primary-soft:${mix('#ffffff', p.primary, 0.1)};--secondary:${p.secondary};--accent:${p.accent};--accent-fg:${accentFg};--accent-dark:${darken(p.accent, 0.18)};
--hero-bg:${heroBg};--hero-bg2:${heroDark ? mix(heroBg, p.primary, 0.6) : mix(heroBg, p.secondary, 0.3)};--hero-fg:${heroFg};--hero-muted:${heroFg === '#ffffff' ? lighten(p.secondary, 0.55) : mix(ink, heroBg, 0.3)};
--line:${mix(p.primary, '#ffffff', 0.82)};--star:#f5b301;--star-off:${rgba('#9aa0b4', 0.35)};--shadow:0 18px 40px ${rgba(darken(p.primary, 0.4), 0.16)};
--title:${titleStack};--body:${bodyStack};--radius:18px}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased}
img,svg{max-width:100%}
h1,h2,h3{font-family:var(--title);line-height:1.15;margin:0 0 .5em;letter-spacing:-.01em}
h1{font-size:clamp(30px,6.4vw,50px);font-weight:800}
h2{font-size:clamp(25px,4.6vw,36px);font-weight:800;text-align:center}
h3{font-size:19px;font-weight:700}
p{margin:0 0 1em}
.wrap{width:100%;max-width:1080px;margin:0 auto;padding:0 20px}
.narrow{max-width:760px}
section{padding:64px 0}
.eyebrow{display:inline-flex;gap:8px;align-items:center;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:6px 12px;border-radius:999px;background:${rgba(heroFg, 0.12)};color:var(--hero-fg)}
.section-kicker{display:block;text-align:center;font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--primary-ink);margin-bottom:10px}
/* header */
.top{position:sticky;top:0;z-index:20;background:${rgba('#ffffff', 0.9)};backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
.top-in{display:flex;align-items:center;justify-content:space-between;gap:12px;height:62px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;color:var(--ink);text-decoration:none;letter-spacing:.02em}
.brand-mark{display:grid;grid-template-columns:repeat(2,9px);gap:3px}.brand-mark i{width:9px;height:9px;border-radius:2px;background:var(--primary)}.brand-mark i:nth-child(1),.brand-mark i:nth-child(4){background:var(--accent)}
.top nav{display:none;gap:22px;font-size:15px}.top nav a{color:var(--muted);text-decoration:none}.top nav a:hover{color:var(--ink)}
/* buttons */
.buy{appearance:none;border:0;cursor:pointer;font:inherit;font-weight:800;display:inline-flex;align-items:center;justify-content:center;gap:10px;border-radius:999px;background:var(--accent);color:var(--accent-fg);box-shadow:0 10px 24px ${rgba(darken(p.accent, 0.3), 0.35)};transition:transform .15s ease,box-shadow .15s ease}
.buy:hover{transform:translateY(-2px);box-shadow:0 14px 30px ${rgba(darken(p.accent, 0.3), 0.42)}}.buy:active{transform:translateY(0)}
.buy svg{width:20px;height:20px}
.buy.small{padding:10px 16px;font-size:14px;box-shadow:none}
.buy.cta{padding:18px 30px;font-size:19px;width:100%}
.buy:focus-visible{outline:3px solid var(--primary);outline-offset:3px}
/* hero */
.hero{background:radial-gradient(1200px 500px at 15% 0%,var(--hero-bg2),transparent),linear-gradient(180deg,var(--hero-bg),var(--hero-bg2));color:var(--hero-fg);padding:40px 0 64px;overflow:hidden}
.hero-grid{display:grid;gap:36px;align-items:center}
.hero-cover{display:flex;justify-content:center;perspective:1400px}
.book{width:min(78vw,360px);border-radius:6px 14px 14px 6px;overflow:hidden;transform:rotateY(-14deg) rotateX(3deg);box-shadow:-2px 0 0 ${rgba('#000000', 0.12)},24px 34px 60px ${rgba('#000000', 0.38)};transition:transform .5s ease;line-height:0;background:var(--hero-bg)}
.book:hover{transform:rotateY(-4deg)}
.book svg{display:block;width:100%;height:auto}
.hero-copy h1{color:var(--hero-fg);margin-top:16px}
.hero-copy .sub{font-size:19px;color:var(--hero-muted)}
.rating-line{display:flex;align-items:center;gap:10px;font-size:15px;margin:6px 0 14px;color:var(--hero-fg)}
.facts{list-style:none;padding:0;margin:18px 0 22px;display:grid;gap:8px}
.facts li{display:flex;gap:10px;align-items:center;font-size:16px}
.facts svg{flex:none;width:22px;height:22px;padding:3px;border-radius:50%;background:${rgba(heroFg, 0.14)};color:var(--hero-fg)}
.price-row{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.price{font-family:var(--title);font-size:46px;font-weight:800;white-space:nowrap}
.price-note{font-size:14px;color:var(--hero-muted)}
.reassure{display:flex;justify-content:center;flex-wrap:wrap;gap:6px 16px;margin:14px 0 0;font-size:14px;color:var(--hero-muted)}
.reassure span{display:inline-flex;align-items:center;gap:6px}.reassure svg{width:16px;height:16px}
/* pains */
.pain-list{list-style:none;padding:0;margin:28px 0 0;display:grid;gap:14px}
.pain-list li{display:flex;gap:14px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;box-shadow:0 2px 0 ${rgba(p.primary, 0.04)}}
.pain-list svg{flex:none;width:26px;height:26px;color:var(--accent-dark)}
.pain-list q{quotes:"« " " »";font-style:italic}
.pains-close{text-align:center;font-weight:700;margin-top:26px;font-size:19px}
/* solution */
.solution{background:var(--card)}
.solution-card{display:grid;gap:22px;align-items:center}
.solution p{font-size:18px}
.for-who{display:flex;gap:12px;align-items:flex-start;background:var(--primary-soft);border-radius:var(--radius);padding:16px 18px;color:var(--ink)}
.for-who svg{flex:none;width:24px;height:24px;color:var(--primary-ink)}
/* chapters */
.chapters{list-style:none;padding:0;margin:30px 0 0;display:grid;gap:14px;counter-reset:ch}
.chapters li{display:flex;gap:16px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px}
.chapters .num{flex:none;display:grid;place-items:center;width:46px;height:46px;border-radius:14px;background:var(--primary);color:${readableOn(p.primary, ink)};font-weight:800;font-family:var(--title);font-size:18px}
.chapters h3{margin-bottom:4px}.chapters p{margin:0;color:var(--muted)}
/* bonus */
.bonus-card{position:relative;display:flex;gap:18px;align-items:flex-start;border-radius:24px;padding:26px 22px;background:linear-gradient(135deg,${mix('#ffffff', p.accent, 0.28)},${mix('#ffffff', p.accent, 0.1)});border:2px dashed ${rgba(darken(p.accent, 0.2), 0.45)}}
.bonus-card .gift{flex:none;width:56px;height:56px;display:grid;place-items:center;border-radius:16px;background:var(--accent);color:var(--accent-fg)}
.bonus-card .gift svg{width:30px;height:30px}
.tag{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.12em;padding:4px 10px;border-radius:999px;background:var(--ink);color:#fff;margin-bottom:10px}
/* reviews */
.stars{position:relative;display:inline-block;line-height:0;white-space:nowrap;vertical-align:middle}
.stars-fg{position:absolute;left:0;top:0;overflow:hidden;white-space:nowrap}
.rating-big{display:flex;justify-content:center;align-items:center;gap:12px;margin:-4px 0 26px;font-size:17px}
.rating-big strong{font-size:30px;font-family:var(--title)}
.review-grid{display:grid;gap:14px}
.review{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px}
.review-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.review-head div{flex:1;display:flex;flex-direction:column;line-height:1.3}.review-head small{color:var(--muted)}
.avatar{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:14px}
.review p{margin:0}
.no-review{text-align:center;color:var(--muted)}
/* faq */
.faq details{background:var(--card);border:1px solid var(--line);border-radius:14px;margin-bottom:12px;overflow:hidden}
.faq summary{cursor:pointer;list-style:none;padding:18px 54px 18px 20px;font-weight:700;position:relative}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";position:absolute;right:20px;top:50%;transform:translateY(-50%);width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--primary-soft);color:var(--primary-ink);font-size:20px;font-weight:700}
.faq details[open] summary::after{content:"–"}
.faq details p{padding:0 20px 18px;margin:0;color:var(--muted)}
/* guarantee */
.guarantee-card{display:flex;gap:18px;align-items:flex-start;background:var(--card);border-radius:24px;padding:26px 22px;box-shadow:var(--shadow)}
.guarantee-card .shield{flex:none;width:60px;height:60px;border-radius:50%;display:grid;place-items:center;background:var(--primary);color:${readableOn(p.primary, ink)}}
.guarantee-card .shield svg{width:32px;height:32px}
.guarantee-card h2{text-align:left;font-size:24px}
/* final */
.final{background:linear-gradient(180deg,var(--hero-bg),var(--hero-bg2));color:var(--hero-fg);text-align:center}
.final h2{color:var(--hero-fg)}
.final .price{display:block;margin:6px 0 18px}
.final .buy.cta{max-width:460px}
footer{padding:28px 0 110px;font-size:13px;color:var(--muted);text-align:center}
footer p{margin:4px 0}
.sticky-buy{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:${rgba('#ffffff', 0.96)};border-top:1px solid var(--line);box-shadow:0 -10px 30px ${rgba('#000000', 0.08)}}
.sticky-buy .mini{display:flex;flex-direction:column;line-height:1.2;min-width:0}.sticky-buy .mini span{font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sticky-buy strong{font-size:20px;font-family:var(--title)}
.sticky-buy .buy{padding:12px 18px;font-size:15px;flex:none}
.demo-banner{background:var(--ink);color:#fff;text-align:center;font-size:13px;padding:7px 12px}
@media (min-width:760px){
  .review-grid{grid-template-columns:repeat(2,1fr)}
  .chapters{grid-template-columns:repeat(2,1fr)}
}
@media (min-width:900px){
  body{font-size:18px}
  .top nav{display:flex}
  .hero{padding:64px 0 88px}
  .hero-grid{grid-template-columns:minmax(300px,420px) 1fr;gap:64px}
  .buy.cta{width:auto;min-width:340px}
  .reassure{justify-content:flex-start}
  .review-grid{grid-template-columns:repeat(3,1fr)}
  .solution-card{grid-template-columns:1.4fr 1fr}
  .sticky-buy{display:none}
  footer{padding-bottom:36px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}.book{transform:none}}
`;
}

/**
 * The copy is written once and the price moves: what it says of the price follows, in everything but the customers'
 * own words. Only the amount the copy was written at changes (« moins de 10 000 € » stays).
 */
function atPriceOfTheDay(sp: SalesPage, price: number): SalesPage {
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
  };
}

/** Self-contained HTML store page for one product. */
export function renderSalesPageHtml(input: { product: Product; salesPage: SalesPage; coverSvg: string; design: DesignSpec; brand: string }): string {
  const { product } = input;
  const sp = atPriceOfTheDay(input.salesPage ?? (product.salesPage as SalesPage), product.price);
  const d = normalizeDesign(input.design ?? product.design);
  const brand = (input.brand || 'Pixel Agency').trim();
  const price = formatPrice(product.price);
  const content = product.content;
  const chapterCount = content?.chapters?.length ?? sp?.chapterBlurbs?.length ?? 0;
  const words = content?.wordCount ?? 0;
  const minutes = words > 0 ? Math.max(5, Math.round(words / 200)) : null;
  const headline = sp?.headline || product.title;
  const sub = sp?.subheadline || product.subtitle;
  // the button is written once, the price moves: it always shows the price of the day
  const cta = (sp?.cta || 'Je télécharge le guide').replace(/\d+(?:[.,]\d+)?\s*€/g, price);
  const pains = (sp?.painBullets ?? []).filter(Boolean);
  const blurbs = (sp?.chapterBlurbs ?? []).filter((b) => b && (b.title || b.blurb));
  const chapterList = blurbs.length ? blurbs : (content?.chapters ?? []).map((c) => ({ title: c.title, blurb: c.intro }));
  // the card already says « BONUS OFFERT »: the heading is the gift itself
  const bonusTitle = String(content?.bonus?.title ?? '').replace(/^bonus\s*(?:offert\s*)?[:—–-]\s*/i, '').replace(/^./, (ch) => ch.toUpperCase());
  const reviews = [...(product.stats?.reviews ?? [])].filter((r) => r && r.text).sort((a, b) => b.day - a.day || b.rating - a.rating);
  const avg = (product.stats?.rating ?? 0) > 0 ? product.stats.rating : reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const objections = (sp?.objections ?? []).filter((o) => o && o.q);
  const practical = [
    { q: 'Comment je reçois le guide ?', a: 'Tout de suite après le paiement : un lien de téléchargement s’affiche et vous est aussi envoyé par e-mail. Le PDF se lit sur téléphone, tablette et ordinateur.' },
    { q: 'Est-ce un abonnement ?', a: `Non. Vous payez ${price} une seule fois et le guide est à vous, y compris ses mises à jour.` },
  ].filter((f) => !objections.some((o) => o.q.toLowerCase().includes(f.q.slice(0, 12).toLowerCase())));
  const faq = [...objections, ...practical];
  const audience = product.audience || content?.audience || '';
  const cover = safeSvg(input.coverSvg);
  const buyIcon = ICON.arrow;

  const facts = [
    chapterCount ? `${chapterCount} chapitres concrets${bonusTitle ? ' + 1 bonus offert' : ''}` : null,
    'Téléchargement immédiat (PDF)',
    minutes ? `Se lit en ${minutes} min, s’applique dès ce soir` : 'Méthode pas à pas, sans jargon',
  ].filter(Boolean) as string[];

  const fonts = d.titleFont.startsWith('Times')
    ? 'family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Inter:wght@400;600;800'
    : d.bodyFont === 'Times-Roman' ? 'family=Inter:wght@400;600;800&family=Source+Serif+4:wght@400;600' : 'family=Inter:wght@400;600;700;800';

  const ratingLine = reviews.length && avg > 0
    ? `<div class="rating-line">${starsHtml(avg)}<span><strong>${h(avg.toFixed(1).replace('.', ','))}</strong> · ${h(reviews.length)} avis</span></div>`
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">
<style>${css(d)}</style>
</head>
<body>
<div class="demo-banner">Boutique virtuelle Pixel Agency — environnement de test, aucun paiement réel</div>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="#top"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${h(brand)}</a>
    <nav aria-label="Sections"><a href="#dedans">Le contenu</a>${reviews.length ? '<a href="#avis">Avis</a>' : ''}<a href="#faq">Questions</a></nav>
    <button type="button" class="buy small" data-buy>Obtenir le guide · ${esc(price)}</button>
  </div>
</header>
<main id="top">
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-cover"><div class="book">${cover}</div></div>
    <div class="hero-copy">
      <span class="eyebrow">${ICON.book.replace('<svg', '<svg width="16" height="16"')} Guide PDF${audience ? ` · ${h(wholeClause(audience.replace(/\s*\([^)]*\)/g, ''), (s) => s.length <= 48))}` : ''}</span>
      <h1>${h(headline)}</h1>
      ${sub ? `<p class="sub">${h(sub)}</p>` : ''}
      ${ratingLine}
      <ul class="facts">${facts.map((f) => `<li>${ICON.check}<span>${h(f)}</span></li>`).join('')}</ul>
      <div class="price-row"><span class="price">${esc(price)}</span><span class="price-note">paiement unique · le PDF est à vous</span></div>
      <button type="button" class="buy cta" data-buy>${h(cta)} ${buyIcon}</button>
      <p class="reassure"><span>${ICON.bolt} Accès immédiat</span><span>${ICON.shield} Garantie satisfait ou remboursé</span><span>${ICON.lock} Paiement sécurisé</span></p>
    </div>
  </div>
</section>
${pains.length ? `<section class="pains">
  <div class="wrap narrow">
    <span class="section-kicker">On en parle ?</span>
    <h2>Vous vous reconnaissez ?</h2>
    <ul class="pain-list">${pains.map((pb) => `<li>${ICON.sigh}<span><q>${h(pb)}</q></span></li>`).join('')}</ul>
    <p class="pains-close">Vous n’êtes pas seul·e. Et non, ce n’est pas une fatalité.</p>
  </div>
</section>` : ''}
${sp?.solution ? `<section class="solution">
  <div class="wrap narrow">
    <span class="section-kicker">La solution</span>
    <h2>${h(product.title || headline)}</h2>
    <div class="solution-card">
      <p>${h(sp.solution)}</p>
      ${audience ? `<div class="for-who">${ICON.check}<span><strong>Pensé pour :</strong> ${h(audience)}</span></div>` : ''}
    </div>
  </div>
</section>` : ''}
${chapterList.length ? `<section class="inside" id="dedans">
  <div class="wrap">
    <span class="section-kicker">Chapitre par chapitre</span>
    <h2>Ce qu’il y a dedans</h2>
    <ol class="chapters">${chapterList.map((c, k) => `<li><span class="num">${String(k + 1).padStart(2, '0')}</span><div><h3>${h(c.title)}</h3>${c.blurb ? `<p>${h(c.blurb)}</p>` : ''}</div></li>`).join('')}</ol>
  </div>
</section>` : ''}
${sp?.bonusBlurb || bonusTitle ? `<section class="bonus">
  <div class="wrap narrow">
    <div class="bonus-card"><span class="gift">${ICON.gift}</span><div><span class="tag">BONUS OFFERT</span>${bonusTitle ? `<h3>${h(bonusTitle)}</h3>` : ''}${sp?.bonusBlurb ? `<p>${h(sp.bonusBlurb)}</p>` : ''}</div></div>
  </div>
</section>` : ''}
<section class="reviews" id="avis">
  <div class="wrap">
    <span class="section-kicker">Avis des lecteurs</span>
    <h2>${reviews.length ? 'Ce qu’en disent les lecteurs' : 'Les premiers avis arrivent'}</h2>
    ${reviews.length
      ? `<div class="rating-big"><strong>${h(avg.toFixed(1).replace('.', ','))}</strong>${starsHtml(avg, 22)}<span>${h(reviews.length)} avis vérifiés</span></div><div class="review-grid">${reviews.slice(0, 6).map(reviewCard).join('')}</div>`
      : '<p class="no-review">Ce guide vient de sortir : aucun avis pour l’instant. Nous n’affichons jamais de faux témoignages.</p>'}
  </div>
</section>
${faq.length ? `<section class="faq" id="faq">
  <div class="wrap narrow">
    <span class="section-kicker">Vos questions</span>
    <h2>Avant de vous décider</h2>
    ${faq.map((o, k) => `<details${k === 0 ? ' open' : ''}><summary>${h(o.q)}</summary><p>${h(o.a)}</p></details>`).join('')}
  </div>
</section>` : ''}
${sp?.guarantee ? `<section class="guarantee">
  <div class="wrap narrow">
    <div class="guarantee-card"><span class="shield">${ICON.shield}</span><div><h2>Notre garantie</h2><p>${h(sp.guarantee)}</p></div></div>
  </div>
</section>` : ''}
<section class="final">
  <div class="wrap narrow">
    <h2>${h(headline)}</h2>
    ${sub ? `<p>${h(sub)}</p>` : ''}
    <span class="price">${esc(price)}</span>
    <button type="button" class="buy cta" data-buy>${h(cta)} ${buyIcon}</button>
    <p class="reassure" style="justify-content:center"><span>${ICON.bolt} PDF disponible immédiatement</span><span>${ICON.shield} Sans risque</span></p>
  </div>
</section>
</main>
<footer>
  <div class="wrap">
    <p>© ${h(brand)} · ${h(product.title)}</p>
    <p>Boutique virtuelle — environnement de test Pixel Agency. Aucune donnée bancaire n’est collectée.</p>
  </div>
</footer>
<div class="sticky-buy"><div class="mini"><span>${h(truncate(product.title || headline, 40))}</span><strong>${esc(price)}</strong></div><button type="button" class="buy" data-buy>Obtenir le guide</button></div>
<script>
(function () {
  var msg = ${JSON.stringify(CHECKOUT_ALERT)};
  var buttons = document.querySelectorAll('[data-buy]');
  for (var i = 0; i < buttons.length; i++) buttons[i].addEventListener('click', function () { alert(msg); });
})();
</script>
</body>
</html>
`;
}
