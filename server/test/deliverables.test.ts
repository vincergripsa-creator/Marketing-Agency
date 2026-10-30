import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdCreative, ChapterContent, DesignSpec, PdfContent, Product, SalesPage, VisualSpec } from '../src/shared.js';
import { designFor, renderAdStoryboard, renderCoverSvg, renderPdf, renderSalesPageHtml } from '../src/deliverables/index.js';
import { sanitizePdfText, wholeClause } from '../src/deliverables/text.js';
import { titleBlock } from '../src/deliverables/cover.js';
import { finalWording, MIN_PAGE_FILL, planIntro } from '../src/deliverables/pdf.js';
import { gridWidths, splitDoDont, type PdfTheme } from '../src/deliverables/pdfVisuals.js';

// ───────────────────────────── fixture ─────────────────────────────

const VISUALS: VisualSpec[] = [
  { type: 'timeline', title: 'La journée type d’un chiot de 3 mois', labels: ['7 h — sortie au réveil', '9 h 30 — sortie après le jeu', '12 h — sortie après le repas', '17 h — balade « reniflage »', '22 h — dernière sortie'], values: [] },
  { type: 'bar_chart', title: 'Moments où les accidents arrivent (sur 100 témoignages)', labels: ['Après la sieste', 'Après le repas', 'Pendant le jeu', 'La nuit'], values: [68, 52, 37, 21] },
  { type: 'steps_diagram', title: 'La sortie parfaite en 4 temps', labels: ['Laisse courte', 'Même endroit', 'Mot-signal « pipi »', 'Récompense dans les 2 s'], values: [] },
  { type: 'do_dont', title: 'Quand il y a un accident', labels: ['À faire : nettoyer avec un produit enzymatique', 'À faire : noter l’heure dans le carnet', 'À éviter : le gronder après coup', 'Ne pas : lui mettre le nez dedans'], values: [] },
  { type: 'checklist_card', title: 'Le kit du premier mois', labels: ['Alèses lavables (12 € les deux)', 'Produit enzymatique', 'Friandises minuscules', 'Laisse de 1,50 m', 'Carnet de sorties', 'Minuteur sur le téléphone'], values: [] },
  { type: 'icon_grid', title: 'Les 6 signaux qui annoncent un pipi', labels: ['Il renifle le sol', 'Il tourne en rond', 'Il quitte le jeu', 'Il gémit à la porte', 'Il se réveille de la sieste', 'Il vient de boire'], values: [] },
];

function chapter(k: number): ChapterContent {
  return {
    title: `Chapitre ${k + 1} : l’étape « ${['observer', 'rythmer', 'récompenser', 'nettoyer', 'équiper', 'anticiper'][k]} » pour un chiot propre`,
    intro: `Ce chapitre règle un point précis : ce qui se passe entre 7 h et 22 h quand votre chiot de 3 mois n’a pas encore compris où faire ses besoins.`,
    paragraphs: [
      'Un chiot de 8 à 12 semaines tient environ une heure par mois d’âge, plus une. Au-delà, l’accident n’est pas de la désobéissance : c’est de la physiologie.',
      'Les maîtres qui réussissent en 21 jours ont tous un point commun : ils sortent le chiot AVANT qu’il ait envie, pas après l’accident. C’est la différence entre réagir et anticiper.',
      'Prévoyez un budget modeste : une alèse lavable à 12 €, un spray enzymatique à 9 € et des friandises suffisent. Inutile d’acheter le tapis « intelligent » à 89 €. 🐶',
      'Un détail qui change tout : le même endroit, la même laisse, le même mot. Le chiot associe très vite l’odeur et le rituel au soulagement.',
    ],
    steps: [
      '1. Notez chaque pipi et chaque accident pendant 2 jours dans un carnet.',
      'Sortez-le dans les 5 minutes après chaque réveil, repas ou séance de jeu.',
      'Dites le mot-signal une seule fois, puis attendez sans parler.',
      'Récompensez dans les 2 secondes, sur place, avec une friandise minuscule.',
    ],
    example: 'Inès, maîtresse de Pépito (11 semaines) : « Je le sortais après les accidents. En le sortant toutes les 2 heures, réveil compris, on est passés de 6 accidents par jour à 1 en une semaine. »',
    checklist: ['Le carnet de sorties est ouvert', 'L’endroit des besoins est choisi', 'Le mot-signal est le même pour toute la famille', 'Les friandises sont dans ma poche'],
    visual: VISUALS[k],
  };
}

const content: PdfContent = {
  title: 'Chiot propre en 21 jours : la méthode « zéro pipi » pour l’appartement',
  subtitle: 'Le plan heure par heure pour les nouveaux maîtres — sans punition 🐾',
  audience: 'Nouveaux maîtres d’un chiot de 2 à 4 mois en appartement',
  promise: 'En 21 jours, votre chiot fait ses besoins dehors au bon endroit et vous savez anticiper chaque envie.',
  introduction: [
    'Il est 6 h 40, la flaque est sur le tapis du salon, encore. Vous avez acheté les tapis éducateurs, lu trois forums, et rien ne change.',
    'Ce guide repart de zéro avec un plan précis, heure par heure, pensé pour la vie en appartement.',
  ],
  chapters: Array.from({ length: 6 }, (_, k) => chapter(k)),
  bonus: {
    title: 'Bonus : la semaine de vacances sans régression',
    intro: 'Partir avec un chiot de 4 mois sans perdre trois semaines de travail : c’est possible.',
    paragraphs: ['Gardez les horaires de sortie, même en voiture : une pause toutes les 2 heures, au même type de sol.'],
    steps: ['Emportez son alèse : son odeur rassure.', 'Repérez le coin herbe dès l’arrivée.'],
    example: null,
    checklist: ['Alèse dans le sac', 'Horaires notés dans le téléphone'],
    visual: { type: 'quote', title: 'À retenir', labels: ['Un accident en vacances n’efface pas 21 jours de progrès.', 'L’équipe Studio'], values: [] },
  },
  nextStep: { title: 'Et maintenant : la marche en laisse sans tirer', text: 'Votre chiot est propre ? Place à la balade détendue.\nLe guide suivant vous donne le plan en 10 sorties.', upsellProductId: 'prd_laisse' },
  wordCount: 2600,
};

const design = designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed: 3 });

const product: Product = {
  id: 'prd_test', nicheId: 'niche_chiot', title: content.title, subtitle: content.subtitle, audience: content.audience,
  problem: 'Votre chiot fait ses besoins dans l’appartement malgré les sorties.', price: 19, status: 'ready', version: 2,
  content, design, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null,
  upsellProductId: 'prd_laisse', createdDay: 1, launchedDay: null,
  stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 },
  priceHistory: [],
};

const salesPage: SalesPage = {
  headline: 'Votre chiot fait pipi partout ? Il sera propre en 21 jours',
  subheadline: 'Le plan heure par heure, sans punition, pensé pour l’appartement.',
  painBullets: ['il fait pipi juste après la sortie', 'je nettoie le tapis trois fois par jour'],
  solution: 'Un plan précis pour chaque journée : horaires de sortie, mot-signal, récompense et nettoyage.',
  chapterBlurbs: content.chapters.map((c) => ({ title: c.title, blurb: c.intro })),
  bonusBlurb: 'La semaine de vacances sans régression.',
  objections: [{ q: 'Mon chiot est têtu, ça marchera ?', a: 'La méthode ne demande pas d’obéissance : elle s’appuie sur le rythme naturel du chiot.' }],
  guarantee: '14 jours pour tester, remboursé sans justification.',
  cta: 'Je veux un chiot propre',
  hypeLevel: 0.3,
};

const creative: AdCreative = {
  id: 'crv_test', productId: 'prd_test', hook: 'Votre chiot fait pipi juste après la sortie ?', hookStyle: 'question', format: 'text_slideshow',
  scenes: [
    { visual: 'Flaque sur un tapis clair', onScreenText: 'Votre chiot fait pipi juste après la sortie ?', voiceover: 'Votre chiot fait pipi juste après être rentré ?', durationSec: 3 },
    { visual: 'Carnet avec des heures', onScreenText: 'Ce n’est pas de la provocation', voiceover: 'Ce n’est pas de la provocation, c’est un problème d’horaires.', durationSec: 4 },
    { visual: 'Chiot qui renifle l’herbe', onScreenText: 'Sortez-le 5 min après chaque réveil', voiceover: 'Sortez-le dans les cinq minutes après chaque réveil.', durationSec: 4 },
    { visual: 'Couverture du guide', onScreenText: 'Le plan complet en 21 jours → lien en bio', voiceover: 'Le plan complet est dans le guide.', durationSec: 3 },
  ],
  caption: 'Le plan heure par heure pour un chiot propre en appartement.', hashtags: ['chiot', 'educationcanine'], cta: 'Télécharger le guide',
  files: { storyboard: [], preview: null }, quality: null, review: { status: 'pending', reason: null, day: null }, createdDay: 2, createdBy: 'ag_test',
};

// ───────────────────────────── helpers ─────────────────────────────

const escapeExpected = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Minimal well-formedness check: balanced tags and no raw ampersands. */
function assertBalancedXml(xml: string): void {
  const body = xml.replace(/<!--[\s\S]*?-->/g, '');
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  let tags = 0;
  while ((m = re.exec(body))) {
    tags++;
    const [, closing, name, , selfClosing] = m;
    if (selfClosing) continue;
    if (closing) expect(stack.pop(), `fermeture inattendue </${name}>`).toBe(name);
    else stack.push(name);
  }
  expect(stack).toEqual([]);
  expect(tags).toBeGreaterThan(10);
  // every "<" must start a tag we recognised
  expect(body.replace(re, '').includes('<')).toBe(false);
  expect(/&(?!amp;|lt;|gt;|quot;|#39;|#\d+;|#x[0-9a-f]+;)/i.test(body)).toBe(false);
}

let dir = '';
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'deliverables-')); });
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

// ───────────────────────────── tests ─────────────────────────────

describe('designFor', () => {
  it('is deterministic and maps categories to fitting motifs', () => {
    expect(designFor({ nicheName: 'Sommeil de bébé', category: 'parentalité', seed: 1 })).toEqual(designFor({ nicheName: 'Sommeil de bébé', category: 'parentalité', seed: 1 }));
    expect(designFor({ nicheName: 'Sommeil de bébé', category: 'parentalité', seed: 1 }).motif).toBe('moon');
    expect(design.motif).toBe('paw');
    expect(designFor({ nicheName: 'Budget du freelance', category: 'business/argent', seed: 2 }).motif).toBe('coin');
    expect(designFor({ nicheName: 'Potager de balcon', category: 'maison/jardin', seed: 2 }).motif).toBe('leaf');
    const d = designFor({ nicheName: 'X', category: 'inconnue', seed: 9, hint: 'couverture minimaliste' });
    expect(d.coverLayout).toBe('minimal');
    for (const c of Object.values(d.palette)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('offers many distinct palettes across seeds and categories', () => {
    const cats = ['parentalité', 'animaux', 'business/argent', 'santé/forme', 'études', 'maison/jardin', 'voyage', 'mariage', 'stress', 'productivité tech', 'cuisine'];
    const seen = new Set<string>();
    for (const category of cats) for (let seed = 0; seed < 6; seed++) seen.add(designFor({ nicheName: `niche ${seed}`, category, seed }).palette.primary);
    expect(seen.size).toBeGreaterThanOrEqual(12);
  });
});

describe('sanitizePdfText', () => {
  it('keeps French typography and €, strips emoji', () => {
    const s = sanitizePdfText('Bébé « dort » l’été… 12 € – œuf — Noël 🐶🎉 ça va !');
    expect(s).toContain('Bébé');
    expect(s).toContain('«');
    expect(s).toContain('»');
    expect(s).toContain('l’été…');
    expect(s).toContain('€');
    expect(s).toContain('œuf');
    expect(s).toContain('–');
    expect(s).toContain('—');
    expect(s).not.toMatch(/[\u{1F000}-\u{1FAFF}]/u);
    expect(s).toMatch(/Noël\s*ça va/);
  });
});

describe('renderCoverSvg', () => {
  it('produces a 600×848 self-contained, well-formed SVG with the escaped title', () => {
    const title = 'Chiot propre & heureux : la méthode « zéro pipi » <21 jours>';
    const svg = renderCoverSvg({ title, subtitle: content.subtitle, audience: content.audience, design, brand: 'Pixel Agency' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 600 848"');
    expect(svg).toContain(escapeExpected(title));
    expect(svg).not.toMatch(/<image|href="http|@import|<script/);
    assertBalancedXml(svg);
  });

  it('renders four genuinely different layouts', () => {
    const layouts = ['centered', 'split', 'badge', 'minimal'] as const;
    const svgs = layouts.map((coverLayout) => renderCoverSvg({ title: content.title, subtitle: content.subtitle, audience: content.audience, design: { ...design, coverLayout }, brand: 'Pixel Agency' }));
    expect(new Set(svgs).size).toBe(4);
    svgs.forEach(assertBalancedXml);
  });

  it('survives empty strings and broken design values', () => {
    const svg = renderCoverSvg({ title: '', subtitle: '', audience: '', design: { ...design, palette: { ...design.palette, primary: 'pas-une-couleur' }, motif: 'inconnu' as never }, brand: '' });
    assertBalancedXml(svg);
  });
});

describe('renderPdf', () => {
  it('writes a real multi-page A4 guide quickly', async () => {
    const outFile = join(dir, 'files', 'prd_test', 'v2', 'guide.pdf');
    const t0 = performance.now();
    const res = await renderPdf({ product, content, design, brand: 'Pixel Agency', outFile, upsell: { title: 'La marche en laisse sans tirer', url: 'https://boutique.pixel-agency.test/laisse' } });
    const ms = performance.now() - t0;
    const buf = await readFile(outFile);
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(res.bytes).toBe(buf.length);
    expect(res.pages).toBeGreaterThanOrEqual(content.chapters.length + 4);
    expect(ms).toBeLessThan(2000);
    const raw = buf.toString('latin1');
    expect(raw).toContain('https://boutique.pixel-agency.test/laisse'); // CTA link annotation
    expect(raw).toContain('/Dests'); // clickable table of contents
    expect((raw.match(/\/Type \/Page\b/g) ?? []).length).toBe(res.pages);
  });

  it('copes with minimal content (no chapters, no visuals, no upsell)', async () => {
    const bare: PdfContent = { ...content, chapters: [], introduction: [], bonus: { ...content.bonus, visual: null, steps: [], checklist: [] }, nextStep: { title: '', text: '', upsellProductId: null }, wordCount: 0 };
    const res = await renderPdf({ product, content: bare, design, brand: '', outFile: join(dir, 'bare.pdf'), upsell: null });
    expect(res.pages).toBeGreaterThanOrEqual(5);
  });

  it('links run-relative upsell pages and ignores unsafe URLs', async () => {
    const rel = '/runs/run_1/files/prd_2/v1/sales-page.html';
    const a = await renderPdf({ product, content, design, brand: 'Pixel Agency', outFile: join(dir, 'rel.pdf'), upsell: { title: 'La suite', url: rel } });
    expect((await readFile(join(dir, 'rel.pdf'))).toString('latin1')).toContain(rel);
    const b = await renderPdf({ product, content, design, brand: 'Pixel Agency', outFile: join(dir, 'js.pdf'), upsell: { title: 'La suite', url: 'javascript:alert(1)' } });
    expect((await readFile(join(dir, 'js.pdf'))).toString('latin1')).not.toContain('javascript:');
    expect(a.pages).toBe(b.pages);
  });

  it('handles very long chapters that flow across pages', async () => {
    const long = { ...chapter(0), paragraphs: Array.from({ length: 40 }, (_, k) => `Paragraphe ${k + 1}. ${chapter(0).paragraphs.join(' ')}`) };
    const res = await renderPdf({ product, content: { ...content, chapters: [long] }, design, brand: 'Pixel Agency', outFile: join(dir, 'long.pdf') });
    expect(res.pages).toBeGreaterThan(8);
  });
});

describe('renderSalesPageHtml', () => {
  it('escapes user content, shows the price and fakes the checkout', () => {
    const cover = renderCoverSvg({ title: product.title, subtitle: product.subtitle, audience: product.audience, design, brand: 'Pixel Agency' });
    const evil = { ...product, title: '<script>alert(1)</script> Guide chiot' };
    const html = renderSalesPageHtml({ product: evil, salesPage: { ...salesPage, headline: '<script>alert("x")</script> Chiot propre' }, coverSvg: cover, design, brand: 'Pixel Agency' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('19 €');
    expect(html).toContain('Boutique virtuelle : paiement simulé — environnement de test Pixel Agency');
    expect(html).toContain('<details');
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/<link[^>]+href="(?!https:\/\/fonts\.)/);
  });

  it('formats cents and lists real reviews only', () => {
    const reviewed: Product = { ...product, price: 14.9, stats: { ...product.stats, rating: 4.5, reviews: [{ id: 'r1', day: 4, customerId: 'cus_1', rating: 5, text: 'Propre en 12 jours, merci !' }] } };
    const html = renderSalesPageHtml({ product: reviewed, salesPage, coverSvg: '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script></svg>', design, brand: 'Pixel Agency' });
    expect(html).toContain('14,90 €');
    expect(html).toMatch(/Propre en 12.jours, merci/);
    expect(html).not.toContain('onload=');
    expect(html).not.toContain('alert(2)');
  });
});

describe('renderAdStoryboard', () => {
  it('returns one 9:16 frame per scene and a preview with every on-screen text', () => {
    const { frames, previewHtml } = renderAdStoryboard({ creative, product, design, brand: 'Pixel Agency' });
    expect(frames.length).toBe(creative.scenes.length);
    for (const f of frames) {
      expect(f).toContain('viewBox="0 0 360 640"');
      assertBalancedXml(f);
    }
    for (const s of creative.scenes) expect(previewHtml).toContain(escapeExpected(s.onScreenText));
    expect(previewHtml).toContain('Aperçu — pub simulée');
    expect(previewHtml).toContain(JSON.stringify(creative.scenes.map((s) => s.durationSec)));
    expect(frames[frames.length - 1]).toContain('Télécharger le guide');
  });

  it('handles every format and an empty storyboard', () => {
    for (const format of ['faceless_voiceover', 'text_slideshow', 'ugc_avatar', 'carousel'] as const) {
      const { frames } = renderAdStoryboard({ creative: { ...creative, format }, product, design, brand: 'Pixel Agency' });
      frames.forEach(assertBalancedXml);
    }
    const empty = renderAdStoryboard({ creative: { ...creative, scenes: [] }, product, design, brand: 'Pixel Agency' });
    expect(empty.frames).toEqual([]);
    expect(empty.previewHtml).toContain('Aucune scène');
  });
});

// ───────────────────────────── founder review regressions ─────────────────────────────

/** Every <text> of an SVG, unescaped, joined with spaces (what a reader sees on the cover). */
function svgText(svg: string): string {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!)
    .join(' ').replace(/ /g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

describe('cover title is shown in full', () => {
  // the 130-char title the lead saw cut as « …pour les propriétaires d'un chiot de 2 à… »
  const LONG = "Un chiot propre en quelques semaines, même en appartement : la méthode simple pour les propriétaires d'un chiot de 2 à 6 mois";

  it('a 125-140 char title keeps every word on all four layouts (smaller font, up to 6 lines, no ellipsis)', () => {
    expect(LONG.length).toBeGreaterThan(120);
    for (const coverLayout of ['centered', 'split', 'badge', 'minimal'] as const) {
      for (const titleFont of ['Helvetica-Bold', 'Times-Bold', 'Courier-Bold'] as const) {
        const svg = renderCoverSvg({ title: LONG, subtitle: content.subtitle, audience: content.audience, design: { ...design, coverLayout, titleFont }, brand: 'Pixel Agency' });
        assertBalancedXml(svg);
        const shown = svgText(svg).replace(/\s+/g, ' ');
        expect(shown, `${coverLayout}/${titleFont}`).toContain(LONG);
        expect(shown, `${coverLayout}/${titleFont}`).not.toMatch(/…/);
      }
    }
  });

  it('the title block grows to 6 lines before cutting; only titles beyond ~140 chars get an ellipsis', () => {
    const font = { titleFont: 'Helvetica-Bold' as const, titleScale: 1.05 };
    const short = titleBlock({ ...font, title: 'Chiot propre en 21 jours' }, 512, 60);
    expect(short.size).toBeGreaterThanOrEqual(40);
    const long = titleBlock({ ...font, title: LONG }, 512, 60);
    expect(long.lines.join(' ').replace(/ /g, ' ')).toBe(LONG);
    expect(long.lines.length).toBeLessThanOrEqual(6);
    const huge = titleBlock({ ...font, title: `${LONG} vivant en appartement, avec un planning compatible avec le travail` }, 512, 60);
    expect(huge.lines.join(' ')).toMatch(/…$/);
    expect(huge.lines.join(' ')).not.toMatch(/……|\s(?:en|de|la|le|les|pour)…$/);
  });
});

describe('PDF layout regressions', () => {
  const pageH = 700;
  it('never leaves the « À la fin de ce guide » box alone on a near-empty page', () => {
    // fits → untouched
    expect(planIntro({ parts: [100, 100, 100], quote: 60, box: 80 }, 400, 500, pageH)).toEqual({ compact: false, quote: true, breakBefore: -1 });
    // the box alone would spill (the lead's page 5): compact spacing, no decorative quote
    expect(planIntro({ parts: [120, 110, 110, 100], quote: 70, box: 90 }, 520, 540, pageH)).toEqual({ compact: true, quote: false, breakBefore: -1 });
    // compaction is not enough: the next page starts earlier and carries ≥ 25 % of content
    const plan = planIntro({ parts: [150, 140, 130, 90], quote: 0, box: 80 }, 560, 540, pageH);
    expect(plan.compact).toBe(false);
    expect(plan.breakBefore).toBeGreaterThan(0);
    const moved = [150, 140, 130, 90].slice(plan.breakBefore).reduce((a, b) => a + b, 0) + 80;
    expect(moved).toBeGreaterThanOrEqual(pageH * MIN_PAGE_FILL);
    // a big spill is a normal flow (the next page is full anyway)
    expect(planIntro({ parts: [300, 300, 300], quote: 0, box: 80 }, 900, 540, pageH).breakBefore).toBe(-1);
  });

  it('do / don’t visuals follow the shared label convention, unprefixed lists read « à éviter » first', () => {
    expect(splitDoDont(['À éviter : crier', 'À faire : récompenser', 'À éviter : le nez dans le pipi'])).toEqual({ dos: ['Récompenser'], donts: ['Crier', 'Le nez dans le pipi'] });
    expect(splitDoDont(['Gronder après coup', 'Crier', 'Récompenser dehors', 'Sortir après la sieste'])).toEqual({ donts: ['Gronder après coup', 'Crier'], dos: ['Récompenser dehors', 'Sortir après la sieste'] });
  });
});

// ───────────────────────────── page-level checks on the real PDF bytes ─────────────────────────────

const WIN_ANSI: Record<number, string> = { 0x80: '€', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—', 0x9c: 'œ', 0x8c: 'Œ', 0xa0: ' ' };

/** Text of each page, in drawing order (pdfkit: one deflated content stream per page, hex TJ strings). */
async function pdfPagesText(file: string): Promise<string[]> {
  const buf = await readFile(file);
  const s = buf.toString('latin1');
  const pages: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    let txt = '';
    try { txt = inflateSync(buf.subarray(start, end)).toString('latin1'); } catch { continue; }
    if (!/\bBT\b/.test(txt)) continue;
    const parts: string[] = [];
    for (const t of txt.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
      const hexes = t[1] !== undefined ? [...t[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => h[1]!) : [t[2]!];
      parts.push(hexes.map((h) => h.match(/../g)!.map((b) => WIN_ANSI[parseInt(b, 16)] ?? String.fromCharCode(parseInt(b, 16))).join('')).join(''));
    }
    pages.push(parts.join(' ').replace(/\s+/g, ' '));
  }
  return pages;
}

/** Body of a page: what comes before the running footer (« PIXEL AGENCY · title · n »). */
const bodyOf = (page: string) => page.slice(0, Math.max(0, page.lastIndexOf('PIXEL AGENCY'))).trim();

describe('PDF pages read like the founder reads them', () => {
  const para = 'Il est six heures quarante, la flaque est sur le tapis du salon, encore une fois, et le voisin du dessous commence à se plaindre de l’odeur. ';

  it('no page ends on a lone heading (« Étape par étape », « Votre checklist », « Exemple concret »)', async () => {
    for (let n = 1; n <= 7; n++) {
      const chapters = content.chapters.map((c, k) => ({ ...c, paragraphs: [...c.paragraphs, ...Array.from({ length: (n + k) % 4 }, () => para.repeat(1 + ((n + k) % 3)))] }));
      const file = join(dir, `headings-${n}.pdf`);
      await renderPdf({ product, content: { ...content, chapters }, design, brand: 'Pixel Agency', outFile: file });
      for (const [i, page] of (await pdfPagesText(file)).entries()) {
        expect(bodyOf(page), `variante ${n}, page ${i + 1}`).not.toMatch(/(Étape par étape|Votre checklist|EXEMPLE TYPE)$/);
        // a chapter's checklist never sits alone on an otherwise empty page
        expect(bodyOf(page).startsWith('Votre checklist') && bodyOf(page).length < 400, `variante ${n}, page ${i + 1} : checklist seule`).toBe(false);
      }
    }
  });

  it('the « À la fin de ce guide » box always shares its page with the introduction text', async () => {
    for (let n = 2; n <= 9; n++) {
      const introduction = [para.repeat(2), ...Array.from({ length: n }, (_, k) => para.repeat(1 + (k % 3)))];
      const file = join(dir, `intro-${n}.pdf`);
      await renderPdf({ product, content: { ...content, introduction }, design, brand: 'Pixel Agency', outFile: file });
      const pages = await pdfPagesText(file);
      const page = pages.find((p) => p.includes('À la fin de ce guide'))!;
      expect(page, `n=${n}`).toBeTruthy();
      const before = bodyOf(page).split('À la fin de ce guide')[0]!.replace(/^Introduction · Le point de départ/, '').trim();
      expect(before.length, `n=${n} : l'encadré est seul sur sa page`).toBeGreaterThan(250); // ≥ 3 lines of text with it (≥ 25 % of the page with the box)
    }
  });

  it('the last page and the running heads never double their labels', async () => {
    const file = join(dir, 'labels.pdf');
    await renderPdf({ product, content, design, brand: 'Pixel Agency', outFile: file, upsell: { title: 'La suite est ici : la marche en laisse sans tirer', url: '/runs/r/files/prd_2/v1/sales-page.html' } });
    const all = (await pdfPagesText(file)).join(' ');
    expect(all).toContain('la marche en laisse sans tirer');
    expect(all).not.toMatch(/La suite est ici\s*:?\s*La suite est ici/);
    expect(all).not.toMatch(/La suite est ici : la marche/);
    expect(all).not.toMatch(/Bonus · Bonus|Bonus offert : Bonus/);
    // bar values are a 0..100 index, not percentages
    expect(all).not.toMatch(/\b68 %/);
  });
});

// ───────────────────────────── printable sheets, last page, niche fit ─────────────────────────────

/** Inflated page streams: what is really drawn, for what the text alone cannot show. */
async function pageStreams(file: string): Promise<string[]> {
  const buf = await readFile(file);
  const s = buf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    try {
      const txt = inflateSync(buf.subarray(start, end)).toString('latin1');
      if (/\bBT\b/.test(txt)) out.push(txt);
    } catch { /* not a deflated stream */ }
  }
  return out;
}

const sheet = (grid: NonNullable<VisualSpec['grid']>, title = 'Votre carnet de 14 jours'): VisualSpec => ({ type: 'grid', title, labels: [], values: [], grid });
const withSheet = (visual: VisualSpec): PdfContent => ({ ...content, chapters: [{ ...chapter(0), visual }] });
const days = (n: number) => Array.from({ length: n }, (_, i) => `Jour ${i + 1}`);

describe('fillable grid', () => {
  it('is drawn although its labels are empty, as a table with readable headers and blank cells', async () => {
    const file = join(dir, 'grid.pdf');
    const columns = ['Jour', 'Sorties', 'Pipis dehors', 'Accidents', 'Heure à risque'];
    await renderPdf({ product, content: withSheet(sheet({ columns, rows: days(14) })), design, brand: 'Pixel Agency', outFile: file });
    const pages = await pdfPagesText(file);
    const page = pages.find((p) => p.includes('Votre carnet de 14 jours'));
    expect(page).toBeTruthy();
    for (const c of columns) expect(page).toContain(c);
    for (const d of days(14)) expect(page).toContain(d);
    expect(page).toContain('À imprimer et à remplir à la main.');
    // the table stays on one page: no row spilled to another one
    expect(pages.filter((p) => p.includes('Jour 14')).length).toBe(1);
  });

  it('a ticking column is a box to tick, never ticked in advance', async () => {
    const file = join(dir, 'grid-tick.pdf');
    const rows = days(7);
    await renderPdf({ product, content: withSheet(sheet({ columns: ['Jour', 'Au programme', 'Fait'], rows, cells: rows.map((d) => [`Priorité : sortir le chiot, ${d}`, null]) }, 'Votre plan à cocher')), design, brand: 'Pixel Agency', outFile: file });
    const pages = await pdfPagesText(file);
    const at = pages.findIndex((p) => p.includes('Votre plan à cocher'));
    expect(pages[at]).toContain('Cochez chaque ligne une fois faite.');
    expect(pages[at]).toContain('Fait');
    expect(pages[at]).toContain('Priorité : sortir le chiot, Jour 7');
    // drawCheckbox strokes its tick at 1.8 pt: the page has boxes, and no tick
    expect((await pageStreams(file))[at]).not.toMatch(/\b1\.8 w\b/);
  });

  it('holds 21 rows, 7 columns and a 250-character plan cell, every word printed', async () => {
    const file = join(dir, 'grid-big.pdf');
    const long = Array.from({ length: 6 }, (_, k) => `action numéro ${k + 1} du premier jour, avec sa durée (10 min)`).join(' ; ');
    expect(long.length).toBeGreaterThan(250);
    const columns = ['Jour', 'Démarrer', 'Coucher', 'Réveils', 'Plus longue plage', 'Ce qui a aidé', 'Fait'];
    const rows = days(21);
    await renderPdf({ product, content: withSheet(sheet({ columns, rows, cells: rows.map((_, i) => [i === 0 ? long : null, null, null, null, null, null]) })), design, brand: 'Pixel Agency', outFile: file });
    const all = (await pdfPagesText(file)).join(' ');
    for (const c of columns) expect(all).toContain(c);
    for (let k = 1; k <= 6; k++) expect(all).toContain(`numéro ${k}`);
    expect(all).toContain('Jour 21');
    expect(all).not.toContain('…  ');
  });

  it('a sheet longer than a page repeats its header and loses no row', async () => {
    const file = join(dir, 'grid-long.pdf');
    await renderPdf({ product, content: withSheet(sheet({ columns: ['Séance', 'Date', 'Note'], rows: Array.from({ length: 60 }, (_, i) => `Séance ${i + 1}`) })), design, brand: 'Pixel Agency', outFile: file });
    const pages = await pdfPagesText(file);
    for (let i = 1; i <= 60; i++) expect(pages.filter((p) => new RegExp(`Séance ${i}( |$)`).test(p)).length, `ligne ${i}`).toBe(1);
    const spread = pages.filter((p) => /Séance \d/.test(p));
    expect(spread.length).toBeGreaterThanOrEqual(2);
    for (const p of spread) expect(p).toContain('Date Note');
  });

  it('takes the whole width, however few or many columns it has', () => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const theme: PdfTheme = { p: design.palette, title: 'Helvetica-Bold', body: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', ink: '#111111', muted: '#666666', primaryInk: '#223344', accentInk: '#884400', line: '#cccccc', card: '#f5f5f5' };
    for (const columns of [['Jour', 'Fait'], ['Jour', 'Note', 'Fait'], ['', 'Prévu', 'Payé'], Array.from({ length: 12 }, (_, k) => `Colonne${k + 1}`)]) {
      const widths = gridWidths(doc, columns, days(3), columns.map((c) => c === 'Fait'), columns.map(() => false), 475, theme);
      expect(widths.reduce((a, b) => a + b, 0), columns.join()).toBeCloseTo(475, 3);
      expect(Math.min(...widths), columns.join()).toBeGreaterThan(0);
    }
  });

  it('a malformed grid is skipped, the guide still renders', async () => {
    const res = await renderPdf({ product, content: withSheet({ type: 'grid', title: 'x', labels: [], values: [] }), design, brand: 'Pixel Agency', outFile: join(dir, 'grid-none.pdf') });
    expect(res.pages).toBeGreaterThan(3);
  });
});

describe('the last page says what is true today', () => {
  const plan = { dest: 'chapitre-5', label: 'Je reviens à mon plan' };
  const stale = {
    title: 'Votre prochaine étape', upsellProductId: 'prd_2',
    text: 'Vous avez toutes les cartes en main. Il reste une chose à faire : ouvrir le plan. Si un guide complémentaire paraît pour les maîtres, vous en serez informé à l’adresse utilisée pour votre achat.',
  };
  const NESTED = 'Objectif « Un chiot propre en quelques semaines » : le guide complet pour les nouveaux propriétaires pressés';

  it('a text written before the upsell existed stops announcing it, and the button names it whole, without nested guillemets', () => {
    const say = finalWording({ nextStep: stale }, { title: NESTED, url: '/runs/r/files/prd_2/v1/sales-page.html' }, plan);
    expect(say.heading).toBe('La suite est ici');
    expect(say.subtitle).toBe(NESTED.replace(/ ([:»])/g, ' $1').replace('« ', '« '));
    expect(say.paragraphs.join(' ')).not.toMatch(/en serez informé|complémentaire paraît/);
    expect(say.paragraphs.join(' ')).toContain('ouvrir le plan');
    expect(say.cta).toContain('“Un chiot propre en quelques semaines”');
    expect((say.cta!.match(/«/g) ?? []).length).toBe(1);
    expect((say.cta!.match(/»/g) ?? []).length).toBe(1);
    expect(say.cta).not.toMatch(/…/);
    expect(say.under).toBe('Disponible sur notre boutique');
  });

  it('a text that already names the follow-up guide is kept as written', () => {
    const text = 'Votre chiot est propre. « La marche en laisse » prend le relais.';
    const say = finalWording({ nextStep: { ...stale, text } }, { title: 'La marche en laisse', url: 'https://boutique.test/laisse' }, plan);
    expect(say.paragraphs).toEqual([sanitizePdfText(text)]);
    expect(say.under).toBe('boutique.test/laisse');
  });

  it('without an upsell nothing is sold: no shop, no next guide, a button back to the plan', () => {
    const say = finalWording({ nextStep: { title: 'En finir avec les aboiements', text: 'Notre prochain guide sur ce sujet est en préparation. Vous serez prévenu en priorité.', upsellProductId: null } }, null, plan);
    expect(say.heading).toBe('Votre prochaine étape');
    expect(say.subtitle).toBe('');
    expect(say.paragraphs.join(' ')).not.toMatch(/prochain guide|prévenu/);
    expect(say.paragraphs.join(' ').length).toBeGreaterThan(20);
    expect(say).toMatchObject({ cta: plan.label, dest: plan.dest, under: '' });
  });

  it('prints « Disponible sur notre boutique » only when a page exists', async () => {
    const rich = withSheet(sheet({ columns: ['Jour', 'Fait'], rows: days(3) }));
    const none = join(dir, 'final-none.pdf');
    await renderPdf({ product, content: rich, design, brand: 'Pixel Agency', outFile: none, upsell: null });
    const noneText = (await pdfPagesText(none)).join(' ');
    expect(noneText).not.toContain('Disponible sur notre boutique');
    expect(noneText).not.toContain('La suite est ici');
    expect(noneText).toContain('Je reviens à mon plan');

    const bad = join(dir, 'final-bad.pdf');
    await renderPdf({ product, content: rich, design, brand: 'Pixel Agency', outFile: bad, upsell: { title: 'La marche en laisse', url: 'javascript:alert(1)' } });
    expect((await pdfPagesText(bad)).join(' ')).not.toContain('Disponible sur notre boutique');

    const good = join(dir, 'final-good.pdf');
    await renderPdf({ product, content: rich, design, brand: 'Pixel Agency', outFile: good, upsell: { title: 'La marche en laisse', url: '/runs/r/files/prd_2/v1/sales-page.html' } });
    expect((await pdfPagesText(good)).join(' ')).toContain('Disponible sur notre boutique');
  });

  it('the button holds a title of any length: every word printed, the page does not overflow', async () => {
    const short = await renderPdf({ product, content, design, brand: 'Pixel Agency', outFile: join(dir, 'cta-short.pdf'), upsell: { title: 'La suite', url: 'https://boutique.test/x' } });
    const file = join(dir, 'cta-long.pdf');
    const res = await renderPdf({ product, content, design, brand: 'Pixel Agency', outFile: file, upsell: { title: `${NESTED} et tous ceux qui vivent en appartement sans jardin ni cour`, url: 'https://boutique.test/x' } });
    expect(res.pages).toBe(short.pages);
    const last = (await pdfPagesText(file)).at(-1)!;
    expect(last).toContain('Découvrir « Objectif “Un chiot propre');
    expect(last).toContain('sans jardin ni cour »');
  });
});

describe('design fits the niche', () => {
  it('scores what the niche is about before its shelf', () => {
    const table: [string, string, DesignSpec['motif']][] = [
      ['Relooker un meuble ancien sans le rater', 'Maison & jardin', 'brush'],
      ['Potager sur balcon en appartement', 'Maison & jardin', 'leaf'],
      ['Batch cooking pour familles à budget serré', 'Cuisine & budget', 'pot'],
      ['Diversification alimentaire et DME pour bébé de 6 mois', 'Parentalité', 'pot'],
      ['Sommeil de bébé (6-12 mois) qui se réveille la nuit', 'Parentalité', 'moon'],
      ['Chat qui griffe le canapé', 'Animaux', 'paw'],
      ['Revendre sur Vinted pour arrondir ses fins de mois', 'Argent & entrepreneuriat', 'coin'],
      ['Japon petit budget : 2 semaines de voyage', 'Voyage', 'sun'],
      ['Organiser son mariage à moins de 10 000 €', 'Vie & événements', 'heart'],
      ['Freelances : trouver ses 3 premiers clients sur LinkedIn', 'Argent & entrepreneuriat', 'chart'],
    ];
    for (const [nicheName, category, motif] of table) expect(designFor({ nicheName, category, seed: 1 }).motif, nicheName).toBe(motif);
  });

  it('matches words, not fragments of words, and reads the keywords', () => {
    expect(designFor({ nicheName: 'Réussir ses achats', category: 'Vie pratique', seed: 1 }).motif).not.toBe('paw');
    expect(designFor({ nicheName: 'Un projet du week-end', category: 'Maison & jardin', seed: 1, keywords: ['ponçage', 'peinture'] }).motif).toBe('brush');
    expect(designFor({ nicheName: 'Un projet du week-end', category: 'Maison & jardin', seed: 1 }).motif).not.toBe('brush');
  });

  it('draws the new motifs as valid SVG on every layout', () => {
    for (const motif of ['brush', 'pot'] as const) {
      for (const coverLayout of ['centered', 'split', 'badge', 'minimal'] as const) {
        assertBalancedXml(renderCoverSvg({ title: 'Relooker un meuble', subtitle: 'Pas à pas', audience: 'Débutants', design: { ...design, motif, coverLayout }, brand: 'Pixel Agency' }));
      }
    }
  });

  it('the disclaimer names the professional of the niche, from the design or, for an old save, from the product', async () => {
    const last = async (name: string, d: DesignSpec, p: Product = product) => {
      const file = join(dir, `${name}.pdf`);
      await renderPdf({ product: p, content, design: d, brand: 'Pixel Agency', outFile: file });
      return (await pdfPagesText(file)).at(-1)!;
    };
    const chiot = await last('pro-chiot', design);
    expect(chiot).toContain('vétérinaire');
    expect(chiot).not.toContain('conseiller financier');
    const meuble = await last('pro-meuble', designFor({ nicheName: 'Relooker un meuble ancien sans le rater', category: 'Maison & jardin', seed: 1 }));
    expect(meuble).toContain('artisan');
    expect(meuble).not.toMatch(/vétérinaire|médecin/);
    const budget = await last('pro-urssaf', designFor({ nicheName: 'Déclarer son chiffre d’affaires à l’URSSAF', category: 'Argent & entrepreneuriat', seed: 1 }));
    expect(budget).toContain('expert-comptable');
    const { family: _family, ...old } = design;
    expect(await last('pro-old', old)).toContain('vétérinaire');
  });
});

describe('an audience is a whole clause', () => {
  const LONG = "Nouveaux propriétaires d'un chiot de 2 à 6 mois vivant en appartement avec un petit balcon, un budget serré et deux enfants qui rentrent de l'école à 16 h 30 chaque jour de la semaine";

  it('is cut where a phrase ends', () => {
    expect(wholeClause("Nouveaux propriétaires d'un chiot de 2 à 6 mois vivant en appartement", (s) => s.length <= 60)).toBe("Nouveaux propriétaires d'un chiot de 2 à 6 mois");
    expect(wholeClause('Couples fiancés qui veulent un beau mariage', (s) => s.length <= 20)).toBe('Couples fiancés');
    expect(wholeClause('Parents de 2 ou 3 enfants', (s) => s.length <= 40)).toBe('Parents de 2 ou 3 enfants');
  });

  it('never ends on an ellipsis on any cover layout', () => {
    for (const coverLayout of ['centered', 'split', 'badge', 'minimal'] as const) {
      const shown = svgText(renderCoverSvg({ title: 'Un chiot propre', subtitle: '', audience: LONG, design: { ...design, coverLayout }, brand: 'Pixel Agency' })).replace(/\s+/g, ' ');
      expect(shown, coverLayout).toContain('Pour : Nouveaux propriétaires');
      expect(shown, coverLayout).not.toMatch(/…/);
      expect(shown, coverLayout).not.toMatch(/\b(?:vivant|en|de|avec|et)\s+PIXEL/);
    }
  });

  it('and on the sales page too', () => {
    const html = renderSalesPageHtml({ product: { ...product, audience: LONG }, salesPage, coverSvg: '<svg viewBox="0 0 10 10"></svg>', design, brand: 'Pixel Agency' });
    const eyebrow = /class="eyebrow">(.*?)<\/span>/s.exec(html)![1]!;
    expect(eyebrow).toContain('Nouveaux propriétaires');
    expect(eyebrow).not.toMatch(/…/);
  });
});

describe('sales page wording', () => {
  it('the button shows the price of the day, whatever price it was written with', () => {
    const html = renderSalesPageHtml({ product: { ...product, price: 29 }, salesPage: { ...salesPage, cta: 'Je commence ce soir — 24 €' }, coverSvg: '<svg viewBox="0 0 10 10"></svg>', design, brand: 'Pixel Agency' });
    expect(html).toMatch(/Je commence ce soir — 29.€/);
    expect(html).not.toMatch(/ce soir — 24/);
  });

  it('the cover never promises real examples', () => {
    const svg = renderCoverSvg({ title: 'Un guide', subtitle: 'Sous-titre', audience: 'Débutants', design: { ...design, coverLayout: 'split' }, brand: 'Pixel Agency' });
    expect(svg).toContain('Exemples types');
    expect(svg).not.toMatch(/Exemples concrets|exemples réels/i);
  });
});

describe('PDF example callouts', () => {
  it('are labelled by what the writer announced, never as real', async () => {
    const file = join(dir, 'examples.pdf');
    const chapters = [{ ...chapter(0), example: 'Exemple type : Manon vit au 4e étage et programme une sortie après chaque sieste.' }, { ...chapter(1), example: 'Mise en situation : un soir, vous vous surprenez à douter.' }];
    await renderPdf({ product, content: { ...content, chapters }, design, brand: 'Pixel Agency', outFile: file });
    const all = (await pdfPagesText(file)).join(' ');
    expect(all).toContain('EXEMPLE TYPE Manon vit au 4e étage');
    expect(all).toContain('MISE EN SITUATION Un soir, vous vous surprenez');
    expect(all).not.toContain('EXEMPLE CONCRET');
  });
});
