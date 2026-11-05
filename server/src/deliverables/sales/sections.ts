/**
 * The section library every template is built from (design plan D202): one grammar of sections, each with a few layouts,
 * so that six pages of one shop differ in structure and still read as one shop. Every figure printed is counted from
 * the guide, every review is a buyer's, and the law's lines are the same everywhere.
 */
import { escapeHtml as esc, formatPrice } from '../text.js';
import { CHECKOUT_ALERT, h, shortTitle } from './common.js';
import { icon } from './css.js';
import { heroScene } from './heroes.js';
import { BANNER, DROP_NOTE, GUARANTEE_TITLE, guaranteeNote, NO_BANK_DATA, NO_FAKE_REVIEWS, REVIEWS_VERIFIED } from './law.js';
import type { Leaf, PageModel } from './model.js';
import type { Tokens } from './theme.js';

export const cap1 = (s: string): string => s.replace(/^\s*([a-zà-ÿ])/u, (c) => c.toUpperCase());
const rating1 = (v: number): string => v.toFixed(1).replace('.', ',');
const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

export function stars(avg: number, size = 18): string {
  const r = Math.max(0, Math.min(5, Number.isFinite(avg) ? avg : 0));
  const row = Array.from({ length: 5 }, () => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-star"/></svg>').join('');
  return `<span class="stars" role="img" aria-label="${h(`${rating1(r)} sur 5`)}" style="--star-size:${size}px"><span class="row bg">${row}</span><span class="row fg" style="width:${Math.round((r / 5) * 1000) / 10}%">${row}</span></span>`;
}

/** The rating as it is, or « Nouveau » while nobody has given one. A stopped page invites nobody: no « nouveau » there. */
export function ratingLine(m: PageModel, size = 18): string {
  if (m.reviews.length && m.avg > 0) return `<div class="rating">${stars(m.avg, size)}<b>${h(rating1(m.avg))}</b><span class="muted">· ${h(plural(m.total, 'avis vérifié', 'avis vérifiés'))}</span></div>`;
  return m.onSale ? `<div class="rating"><span class="badge-new">${icon('sparkle')}Nouveau</span><span class="muted">Les premiers avis arrivent</span></div>` : '';
}

const noteLine = (m: PageModel): string => `<p class="note"><span>Téléchargement immédiat</span> · <span>Paiement unique</span>${m.guarantee ? ` · <span>${GUARANTEE_TITLE}${m.guaranteeDays ? ` ${m.guaranteeDays} jours` : ''}</span>` : ''}</p>`;

/** The price of the day; crossed out beside it only the reference the 30-day rule allows (D208), with what it is. */
export function priceBox(m: PageModel, o: { drop?: boolean } = {}): string {
  const drop = o.drop && m.drop ? `<span class="price-was" aria-label="${h(`Prix de référence : ${formatPrice(m.drop.was)}`)}">${esc(formatPrice(m.drop.was))}</span><span class="price-cut">−${m.drop.pct} %</span>` : '';
  return `<div class="price-box"><span class="price">${esc(m.price)}</span>${drop}<span class="price-meta">TTC · paiement unique</span></div>`;
}

export function buyButton(m: PageModel, o: { hero?: boolean; wide?: boolean; label?: string } = {}): string {
  return `<button type="button" class="buy${o.wide ? ' wide' : ''}" data-buy${o.hero ? ' data-hero-buy' : ''}>${h(o.label ?? m.cta)}${icon('arrow')}</button>`;
}

export function buyRow(m: PageModel, o: { drop?: boolean; hero?: boolean } = {}): string {
  if (!m.onSale) return `<p class="gone">Ce ${m.noun} n’est plus en vente.</p>`;
  return `<div class="buy-row">${priceBox(m, o)}${buyButton(m, { hero: o.hero })}</div>${noteLine(m)}${o.drop && m.drop ? `<p class="note">${h(DROP_NOTE)}</p>` : ''}`;
}

export const eyebrow = (m: PageModel): string => `<p class="eyebrow">${m.audience ? `Pour : ${h(m.eyebrow)}` : h(m.eyebrow)}</p>`;

/**
 * The first screen: title, picture, price, rating or « nouveau », and the button (acceptance E7). `top` and `extra` are the
 * template's own lines; the price and the rating share one line so that a phone holds it all.
 */
export function heroSection(m: PageModel, t: Tokens, o: { top?: string; extra?: string; drop?: boolean; hook?: boolean; cls?: string; h1Class?: string } = {}): string {
  const rating = ratingLine(m);
  const buy = m.onSale
    ? `<div class="buy-top">${priceBox(m, { drop: o.drop })}${rating}</div>${buyButton(m, { hero: true })}${noteLine(m)}${o.drop && m.drop ? `<p class="note">${h(DROP_NOTE)}</p>` : ''}`
    : `<p class="gone">Ce ${m.noun} n’est plus en vente.</p>${rating ? `<div class="buy-top">${rating}</div>` : ''}`;
  // the longest word sets a ceiling on the size: a title never breaks inside a word, whatever its art direction asks
  const longest = Math.max(6, ...m.head.split(/\s+/).map((w) => [...w].length));
  return `<section class="hero${o.cls ? ` ${o.cls}` : ''}">
  <div class="wrap hero-grid">
    <div class="h-copy">
      ${o.top ?? eyebrow(m)}
      <h1${o.h1Class ? ` class="${o.h1Class}"` : ''} style="--w:${longest}">${h(m.head)}</h1>
      ${m.tail ? `<p class="deck">${h(m.tail)}</p>` : ''}
      ${o.hook !== false && m.hook ? `<p class="hook">${h(m.hook)}</p>` : ''}
      ${o.extra ? `<div class="h-extra">${o.extra}</div>` : ''}
      <div class="h-buy">${buy}</div>
    </div>
    <div class="h-scene">${heroScene(m, t)}</div>
  </div>
</section>`;
}

export const kicker = (text: string): string => `<p class="kicker">${h(text)}</p>`;

/** A real page, by reference. */
export const pageFig = (l: Leaf, o: { caption?: boolean; cls?: string } = {}): string =>
  `<figure class="leaf${o.cls ? ` ${o.cls}` : ''}"><div class="pg"><svg viewBox="${l.box}" role="img" aria-label="${h(`Aperçu du guide : ${l.caption}`)}" focusable="false"><use href="#${l.id}"/></svg></div>${o.caption === false ? '' : `<figcaption class="cap">${h(l.caption)}</figcaption>`}</figure>`;

export const coverMini = (m: PageModel, cls = 'mini-cover'): string => `<svg class="${cls}" viewBox="${m.cover.box}" role="img" aria-label="${h(`Couverture : ${m.title}`)}" focusable="false"><use href="#cover-art"/></svg>`;

const PAGES_TRUE = 'Ces pages viennent du guide, pas d’une maquette : ce que vous voyez est ce que vous téléchargez. Seul le texte courant est masqué dans l’aperçu.';
const pagesLead = (m: PageModel): string => (m.onSale ? PAGES_TRUE : `Ces pages viennent du ${m.noun}, pas d’une maquette. Seul le texte courant est masqué dans l’aperçu.`).replace('du guide', `du ${m.noun}`);

/** A strip of real pages that scrolls sideways on a phone. */
export function stripSection(m: PageModel, o: { title?: string; cls?: string; max?: number } = {}): string {
  const leaves = m.leaves.slice(0, o.max ?? 4);
  if (!leaves.length) return '';
  return `<section class="pages ${o.cls ?? ''}" id="apercu">
  <div class="wrap">
    ${kicker(m.onSale ? 'Avant d’acheter' : 'Aperçu')}
    <h2 class="h2">${h(o.title ?? (m.onSale ? 'Les vraies pages, avant de décider' : `Quelques pages du ${m.noun}`))}</h2>
    <p class="lead">${h(pagesLead(m))}</p>
    <div class="strip">${leaves.map((l) => pageFig(l)).join('')}</div>
  </div>
</section>`;
}

// ───────────────────────────── the copy ─────────────────────────────

/** 3 to 5 outcomes: the writer's, else the guide's own chapters, never a promise nobody wrote. */
export function benefitsOf(m: PageModel): string[] {
  if (m.benefits.length >= 3) return m.benefits.slice(0, 5);
  return [...m.benefits, ...m.chapters.map((c) => c.title)].filter(Boolean).slice(0, 3);
}

export function benefitsSection(m: PageModel, o: { title?: string; cls?: string; max?: number } = {}): string {
  const items = benefitsOf(m).slice(0, o.max ?? 3);
  if (!items.length) return '';
  const icons = ['check', 'route', 'sparkle', 'clock', 'heart'];
  return `<section class="benefits ${o.cls ?? ''}">
  <div class="wrap">
    ${kicker('Ce que vous y gagnez')}
    <h2 class="h2">${h(o.title ?? `Ce que ce ${m.noun} change`)}</h2>
    <ul class="benefit-list cards">${items.map((b, k) => `<li class="card"><span class="b-ico">${icon(icons[k % icons.length]!)}</span><p>${h(cap1(b))}</p></li>`).join('')}</ul>
  </div>
</section>`;
}

export function painsSection(m: PageModel, o: { variant?: 'list' | 'quotes'; cls?: string } = {}): string {
  if (!m.pains.length) return '';
  const quotes = o.variant === 'quotes';
  return `<section class="pains ${o.cls ?? ''}">
  <div class="wrap${quotes ? '' : ' narrow'}">
    ${kicker(quotes ? 'Ce qu’on lit partout' : 'On en parle ?')}
    <h2 class="h2">Vous vous reconnaissez ?</h2>
    ${quotes
    ? `<div class="pull-grid">${m.pains.slice(0, 4).map((p) => `<blockquote class="pull"><p>« ${h(p)} »</p></blockquote>`).join('')}</div><p class="source">Mot pour mot, relevé dans les commentaires et les forums.</p>`
    : `<ul class="pain-list">${m.pains.map((p) => `<li><q>${h(p)}</q></li>`).join('')}</ul>`}
    <p class="pains-close">Vous n’êtes pas seul·e. Et non, ce n’est pas une fatalité.</p>
  </div>
</section>`;
}

export function solutionSection(m: PageModel, o: { cls?: string } = {}): string {
  if (!m.sp?.solution) return '';
  return `<section class="solution ${o.cls ?? ''}">
  <div class="wrap narrow">
    ${kicker('La solution')}
    <h2 class="h2">${h(m.title)}</h2>
    <p class="solution-text">${h(m.sp.solution)}</p>
    ${m.audience ? `<p class="for-who"><b>Pensé pour :</b> ${h(m.audience)}</p>` : ''}
  </div>
</section>`;
}

export function chaptersSection(m: PageModel, o: { variant?: 'list' | 'bento' | 'steps'; title?: string; cls?: string } = {}): string {
  if (!m.chapters.length) return '';
  const v = o.variant ?? 'list';
  const num = (k: number): string => String(k + 1).padStart(2, '0');
  const rows = m.chapters.map((c, k) => `<li class="${v === 'bento' ? 'card ' : ''}ch${v === 'bento' && k === 0 ? ' wide' : ''}"><span class="num">${num(k)}</span><div><h3>${h(c.title)}</h3>${c.blurb ? `<p>${h(c.blurb)}</p>` : ''}</div></li>`).join('');
  const printed = m.isKit && m.printed.length ? `<h3 class="part">Les fiches à remplir</h3><ol class="chapters list">${m.printed.map((p, k) => `<li class="ch"><span class="num">${num(k)}</span><div><h3>${h(p)}</h3></div></li>`).join('')}</ol><h3 class="part">Le plan à cocher, étape par étape</h3>` : '';
  return `<section class="inside ${o.cls ?? ''}" id="dedans">
  <div class="wrap">
    ${kicker(m.isKit ? 'Fiche par fiche, étape par étape' : 'Chapitre par chapitre')}
    <h2 class="h2">${h(o.title ?? 'Ce qu’il y a dedans')}</h2>
    ${printed}<ol class="chapters ${v}${v === 'bento' ? ' cards' : ''}">${rows}</ol>
  </div>
</section>`;
}

/** The table of contents with its real page numbers, or its chapters alone when nobody could count them. */
export function tocSection(m: PageModel, o: { cls?: string } = {}): string {
  if (!m.chapters.length) return '';
  const toc = m.toc;
  const rows = toc
    ? toc.map((r, k) => `<li><span class="num">${String(k + 1).padStart(2, '0')}</span><span class="t">${h(r.title)}</span><span class="dots" aria-hidden="true"></span><span class="pnum">p. ${r.page}</span></li>`)
    : m.chapters.map((c, k) => `<li><span class="num">${String(k + 1).padStart(2, '0')}</span><span class="t">${h(c.title)}</span></li>`);
  const blurbs = m.chapters.filter((c) => c.blurb).slice(0, 3);
  return `<section class="toc ${o.cls ?? ''}" id="dedans">
  <div class="wrap">
    <div class="toc-grid">
      <div>
        ${kicker('Sommaire')}
        <h2 class="h2">Au sommaire</h2>
        ${m.facts.pages ? `<p class="lead">${h(`${plural(m.facts.chapters, 'chapitre', 'chapitres')} sur ${m.facts.pages} pages${m.facts.sheets ? `, dont ${plural(m.facts.sheets, 'fiche à imprimer', 'fiches à imprimer')}` : ''}.`)}</p>` : ''}
      </div>
      <ol class="toc-list">${rows.join('')}</ol>
    </div>
    ${blurbs.length ? `<div class="toc-notes">${blurbs.map((c) => `<p><b>${h(c.title)}.</b> ${h(c.blurb!)}</p>`).join('')}</div>` : ''}
  </div>
</section>`;
}

export function figureSection(m: PageModel, o: { cls?: string } = {}): string {
  if (!m.figure) return '';
  return `<section class="figure ${o.cls ?? ''}">
  <div class="wrap narrow">
    ${kicker('La méthode')}
    <h2 class="h2">Ce que vous aurez sous les yeux</h2>
    <div class="fig card">${m.figure}</div>
  </div>
</section>`;
}

/** The opening of the guide's own introduction, a drop cap on its first letter: the problem told as the guide tells it. */
export function introStorySection(m: PageModel, o: { cls?: string } = {}): string {
  const paras = m.intro.slice(0, 2);
  if (!paras.length) return '';
  const pull = m.pains[0];
  return `<section class="story ${o.cls ?? ''}">
  <div class="wrap">
    <div class="story-grid">
      <div class="story-text">
        ${kicker('Extrait de l’introduction')}
        ${paras.map((p, k) => `<p${k === 0 ? ' class="dropcap"' : ''}>${h(p)}</p>`).join('')}
      </div>
      ${pull ? `<aside class="story-aside"><blockquote class="pull big"><p>« ${h(pull)} »</p></blockquote><p class="source">Mot pour mot, relevé dans les commentaires.</p></aside>` : ''}
    </div>
  </div>
</section>`;
}

const storyFallback = (m: PageModel): string => `Nous avons écrit ce ${m.noun} pour ${m.audience ? m.audience.charAt(0).toLowerCase() + m.audience.slice(1) : 'celles et ceux qui cherchent une méthode claire'}, à partir de leurs questions et de leurs mots. Chaque étape a été relue avant publication.`;

/** Why the brand wrote it, in its own voice: the writer's words, no invented biography, the brand's name as the signature. */
export function letterSection(m: PageModel, o: { cls?: string } = {}): string {
  const story = m.story || storyFallback(m);
  const sentences = story.split(/(?<=[.!?…])\s+(?=[«\p{Lu}])/u);
  const paras: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) paras.push(sentences.slice(i, i + 2).join(' '));
  return `<section class="letter ${o.cls ?? ''}" id="pourquoi">
  <div class="wrap narrow">
    ${kicker('Pourquoi ce guide')}
    <h2 class="h2">Pourquoi nous l’avons écrit</h2>
    <div class="letter-body card">
      ${paras.map((p) => `<p>${h(p)}</p>`).join('')}
      <p class="signature"><span>L’équipe ${h(m.brand)}</span></p>
    </div>
  </div>
</section>`;
}

const FOR_FALLBACK = (m: PageModel): string[] => (m.audience ? [m.audience] : []);
const NOT_FALLBACK = ['vous cherchez un résultat du jour au lendemain : la méthode demande de la régularité', 'votre situation demande un suivi individuel : ce guide ne remplace pas un avis professionnel'];

export function forWhoSection(m: PageModel, o: { cls?: string } = {}): string {
  const yes = m.forWho.length ? m.forWho : FOR_FALLBACK(m);
  const no = m.notFor.length ? m.notFor : NOT_FALLBACK;
  if (!yes.length) return '';
  return `<section class="for ${o.cls ?? ''}">
  <div class="wrap">
    ${kicker('Pour qui')}
    <h2 class="h2">Pour qui, et pour qui ce n’est pas</h2>
    <div class="for-grid cards">
      <div class="card for-yes"><h3>C’est pour vous si…</h3><ul class="ticks">${yes.map((x) => `<li>${icon('check')}<span>${h(cap1(x))}</span></li>`).join('')}</ul></div>
      <div class="card for-no"><h3>Ce n’est pas pour vous si…</h3><ul class="ticks no">${no.map((x) => `<li>${icon('cross')}<span>${h(cap1(x))}</span></li>`).join('')}</ul></div>
    </div>
  </div>
</section>`;
}

export function bonusSection(m: PageModel, o: { cls?: string } = {}): string {
  if (!m.bonusBlurb && !m.bonusTitle) return '';
  return `<section class="bonus ${o.cls ?? ''}">
  <div class="wrap narrow">
    <div class="bonus-card card"><span class="gift">${icon('gift')}</span><div><p class="tag">Offert avec le ${m.noun}</p>${m.bonusTitle ? `<h3>${h(m.bonusTitle)}</h3>` : ''}${m.bonusBlurb ? `<p>${h(m.bonusBlurb)}</p>` : ''}</div></div>
  </div>
</section>`;
}

// ───────────────────────────── proof ─────────────────────────────

const reviewCard = (r: PageModel['reviews'][number], cls = 'card'): string =>
  `<article class="review ${cls}"><div class="review-head"><span class="who">${icon('check')}Acheteur vérifié</span>${stars(r.rating, 15)}</div><p>${h(r.text)}</p></article>`;

export const verifiedLine = (): string => `<p class="verified">${icon('shield')}<span><b>Avis vérifiés.</b> ${h(REVIEWS_VERIFIED)}</span></p>`;

/** Reviews as they are: the latest first, each a buyer's, how they are verified said above them. None: said so, never invented. */
export function reviewsSection(m: PageModel, o: { variant?: 'cards' | 'quotes' | 'wall'; max?: number; cls?: string; title?: string } = {}): string {
  const v = o.variant ?? 'cards';
  const who = m.isKit ? 'acheteurs' : 'lecteurs';
  if (!m.reviews.length) {
    if (!m.onSale) return '';
    return `<section class="reviews none ${o.cls ?? ''}" id="avis">
  <div class="wrap narrow">
    ${kicker(`Avis des ${who}`)}
    <h2 class="h2">Nouveau : les premiers avis arrivent</h2>
    <div class="card new-card"><span class="badge-new">${icon('sparkle')}Nouveau</span><p>Ce ${m.noun} vient de sortir : aucun avis pour l’instant. Seuls ses acheteurs pourront en laisser un. ${h(NO_FAKE_REVIEWS)}</p></div>
  </div>
</section>`;
  }
  const list = m.reviews.slice(0, o.max ?? 6);
  const body = v === 'quotes'
    ? `<div class="quote-cols">${list.map((r) => `<blockquote class="rquote"><p>« ${h(r.text)} »</p><footer>${stars(r.rating, 13)}<span>Acheteur vérifié</span></footer></blockquote>`).join('')}</div>`
    : `<div class="review-${v === 'wall' ? 'wall' : 'grid'} cards">${list.map((r) => reviewCard(r)).join('')}</div>`;
  return `<section class="reviews ${o.cls ?? ''}" id="avis">
  <div class="wrap">
    ${kicker(`Avis des ${who}`)}
    <h2 class="h2">${h(o.title ?? `Ce qu’en disent les ${who}`)}</h2>
    <div class="rating-big"><b>${h(rating1(m.avg))}</b>${stars(m.avg, 22)}<span>${h(plural(m.total, 'avis vérifié', 'avis vérifiés'))}</span></div>
    ${verifiedLine()}
    ${body}
  </div>
</section>`;
}

/** How many buyers gave each mark, among the reviews the shop keeps. */
export function breakdownBlock(m: PageModel): string {
  const n = m.reviews.length;
  if (!n) return '';
  const max = Math.max(1, ...m.breakdown.map((b) => b.count));
  return `<div class="breakdown"><p class="bd-title">${h(n < m.total ? `Sur les ${n} derniers avis` : `Sur ${plural(n, 'avis', 'avis')}`)}</p>${m.breakdown.map((b) => `<div class="bd-row"><span>${b.stars} ${icon('star', 'ico star-ico')}</span><span class="bar"><i style="width:${Math.round((b.count / max) * 100)}%"></i></span><span class="cnt">${b.count}</span></div>`).join('')}</div>`;
}

export function newBlock(m: PageModel): string {
  return m.onSale ? `<div class="card new-card"><span class="badge-new">${icon('sparkle')}Nouveau</span><p>Ce ${m.noun} vient de sortir : aucun avis pour l’instant. Seuls ses acheteurs pourront en laisser un. ${h(NO_FAKE_REVIEWS)}</p></div>` : '';
}

// ───────────────────────────── value ─────────────────────────────

interface Tile { icon: string; big: string; label: string; wide?: boolean }

/** What the buyer gets, item by item, each one counted in the guide: nothing is padded, nothing is priced up. */
export function tilesOf(m: PageModel): Tile[] {
  const f = m.facts;
  const out: Tile[] = [];
  if (f.chapters) out.push({ icon: 'list', big: String(f.chapters), label: f.chapters > 1 ? 'chapitres courts, chacun avec son but' : 'chapitre court', wide: true });
  if (f.actions) out.push({ icon: 'check', big: String(f.actions), label: f.actions > 1 ? 'actions guidées, dans l’ordre' : 'action guidée' });
  if (f.sheets) out.push({ icon: 'pen', big: String(f.sheets), label: f.sheets > 1 ? 'fiches à imprimer et à remplir' : 'fiche à imprimer et à remplir' });
  if (f.boxes) out.push({ icon: 'grid', big: String(f.boxes), label: 'cases à cocher' });
  if (f.pages) out.push({ icon: 'page', big: String(f.pages), label: m.isKit ? 'pages à imprimer' : 'pages illustrées' });
  if (m.perDay) out.push({ icon: 'route', big: `${m.perDay.n}`, label: `${m.perDay.n > 1 ? `${m.perDay.unit}s` : m.perDay.unit} de plan, étape par étape` });
  if (f.checklists) out.push({ icon: 'check', big: String(f.chapters), label: f.chapters > 1 ? 'checklists, une à la fin de chaque chapitre' : 'checklist à la fin du chapitre' });
  if (m.figure) out.push({ icon: 'sparkle', big: '1', label: 'schéma qui résume la méthode' });
  if (m.bonusTitle) out.push({ icon: 'gift', big: '1', label: `bonus offert : ${m.bonusTitle}`, wide: true });
  out.push({ icon: 'refresh', big: '0 €', label: 'de plus pour les mises à jour, sans abonnement' });
  return out;
}

export function bentoSection(m: PageModel, o: { cls?: string } = {}): string {
  const tiles = tilesOf(m);
  return `<section class="bento-sec ${o.cls ?? ''}" id="dedans">
  <div class="wrap">
    ${kicker('Tout ce qui est inclus')}
    <h2 class="h2">Ce que vous obtenez, poste par poste</h2>
    <ul class="bento cards">${tiles.map((x) => `<li class="card tile${x.wide ? ' wide' : ''}">${icon(x.icon)}<b>${h(x.big)}</b><span>${h(cap1(x.label))}</span></li>`).join('')}</ul>
  </div>
</section>`;
}

const COMPARISON_FALLBACK = (m: PageModel): PageModel['comparison'] => [
  { label: 'Le temps', guide: m.facts.readMinutes ? `${m.facts.readMinutes} minutes de lecture, puis une étape à la fois` : 'Une lecture courte, puis une étape à la fois', other: 'Des heures à chercher et à trier des conseils éparpillés' },
  { label: 'La méthode', guide: 'Les étapes dans l’ordre, du début à la fin', other: 'Des astuces isolées, sans ordre ni suivi' },
  { label: 'Le prix', guide: `${m.price}, une seule fois, mises à jour comprises`, other: 'Un accompagnement individuel, facturé à la séance' },
];

export function comparisonSection(m: PageModel, o: { cls?: string } = {}): string {
  const rows = m.comparison.length >= 2 ? m.comparison : COMPARISON_FALLBACK(m);
  return `<section class="compare ${o.cls ?? ''}">
  <div class="wrap">
    ${kicker('Faire autrement ?')}
    <h2 class="h2">Le ${m.noun}, ou faire autrement</h2>
    <div class="cmp card" role="table" aria-label="${h(`Le ${m.noun} comparé aux autres façons de faire`)}">
      <div class="cmp-row cmp-head" role="row"><span role="columnheader"></span><span role="columnheader">Avec le ${m.noun}</span><span role="columnheader">Autrement</span></div>
      ${rows.map((r) => `<div class="cmp-row" role="row"><span class="cmp-l" role="rowheader">${h(r.label)}</span><span class="cmp-g" role="cell">${icon('check')}${h(cap1(r.guide))}</span><span class="cmp-o" role="cell">${h(cap1(r.other))}</span></div>`).join('')}
    </div>
  </div>
</section>`;
}

/** The price, everything it includes, an honest per-day line, and the crossed-out reference only when the price really dropped. */
export function priceSection(m: PageModel, o: { cls?: string } = {}): string {
  if (!m.onSale) return '';
  const perDay = m.perDay ? `<p class="per-day">${h(`Sur les ${m.perDay.n} ${m.perDay.n > 1 ? `${m.perDay.unit}s` : m.perDay.unit} du plan, cela revient à ${m.perDay.amount} par ${m.perDay.unit}.`)}</p>` : '';
  return `<section class="offer-sec ${o.cls ?? ''}" id="prix">
  <div class="wrap narrow">
    <div class="offer card">
      ${kicker('Le prix, tout compris')}
      <div class="offer-in">${coverMini(m, 'offer-cover')}<div>${priceBox(m, { drop: true })}${perDay}</div></div>
      <ul class="ticks">${['Paiement unique, sans abonnement', 'Téléchargement immédiat, sur tous vos écrans', ...(m.guarantee ? [`${GUARANTEE_TITLE}${m.guaranteeDays ? ` de ${m.guaranteeDays} jours` : ''}`] : [])].map((x) => `<li>${icon('check')}<span>${h(x)}</span></li>`).join('')}</ul>
      ${buyButton(m, { wide: true })}
      ${m.drop ? `<p class="note">${h(DROP_NOTE)}</p>` : ''}
    </div>
  </div>
</section>`;
}

// ───────────────────────────── the end of every page ─────────────────────────────

export function faqSection(m: PageModel, o: { cls?: string } = {}): string {
  if (!m.faq.length) return '';
  return `<section class="faq ${o.cls ?? ''}" id="faq">
  <div class="wrap narrow">
    ${kicker('Vos questions')}
    <h2 class="h2">Avant de vous décider</h2>
    ${m.faq.map((f, k) => `<details${k === 0 ? ' open' : ''}><summary>${h(f.q)}</summary><p>${h(f.a)}</p></details>`).join('')}
  </div>
</section>`;
}

/** The refund promise is the shop's own commercial guarantee, said as such (L121-4 10°). */
export function guaranteeSection(m: PageModel, o: { cls?: string } = {}): string {
  if (!m.guarantee || !m.onSale) return '';
  return `<section class="guarantee ${o.cls ?? ''}">
  <div class="wrap narrow">
    <div class="guarantee-card card">${icon('shield')}<div><h2>${GUARANTEE_TITLE}</h2><p>${h(m.guarantee)}</p><p class="fine">${h(guaranteeNote(m.brand))}</p></div></div>
  </div>
</section>`;
}

export function finalSection(m: PageModel, o: { cls?: string; ps?: string } = {}): string {
  if (!m.onSale) return '';
  return `<section class="final ${o.cls ?? ''}">
  <div class="wrap narrow">
    ${coverMini(m)}
    <h2>${h(m.headline)}</h2>
    ${m.sub ? `<p>${h(m.sub)}</p>` : ''}
    <span class="price">${esc(m.price)}</span>
    ${buyButton(m)}
    <p class="note">PDF disponible immédiatement · Paiement unique${m.guarantee ? ` · ${GUARANTEE_TITLE}` : ''}</p>
    ${o.ps ? `<p class="ps">${h(o.ps)}</p>` : ''}
  </div>
</section>`;
}

export function headerBar(m: PageModel, nav: [string, string][]): string {
  return `${BANNER}
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="#top">${h(m.brand)}</a>
    <nav aria-label="Sections">${nav.map(([href, label]) => `<a href="#${href}">${h(label)}</a>`).join('')}</nav>
    ${m.onSale ? `<button type="button" class="buy small" data-buy>Obtenir le ${m.noun} · ${esc(m.price)}</button>` : ''}
  </div>
</header>`;
}

export function footerBar(m: PageModel): string {
  return `<footer>
  <div class="wrap">
    <p>© ${h(m.brand)} · ${h(m.product.title)}</p>
    <p>Boutique virtuelle — environnement de test Pixel Agency. ${NO_BANK_DATA}</p>
  </div>
</footer>`;
}

/** The buy bar of a phone, shown once the first button has left the screen, and the fake checkout. */
export function stickyAndScript(m: PageModel): string {
  if (!m.onSale) return '';
  return `<div class="sticky-buy" data-sticky>${coverMini(m)}<div class="mini"><span>${h(shortTitle(m.title))}</span><strong>${esc(m.price)}</strong></div><button type="button" class="buy" data-buy>Obtenir le ${m.noun}</button></div>
<script>
(function () {
  var msg = ${JSON.stringify(CHECKOUT_ALERT)};
  var buttons = document.querySelectorAll('[data-buy]');
  for (var i = 0; i < buttons.length; i++) buttons[i].addEventListener('click', function () { alert(msg); });
  var bar = document.querySelector('[data-sticky]'), first = document.querySelector('[data-hero-buy]');
  if (bar && first && 'IntersectionObserver' in window) {
    document.documentElement.className += ' js-sticky';
    new IntersectionObserver(function (e) { bar.classList.toggle('on', !e[0].isIntersecting && e[0].boundingClientRect.top < 0); }).observe(first);
  }
})();
</script>`;
}
