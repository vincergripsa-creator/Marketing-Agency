import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdCreative, ChapterContent, PdfContent, Product, SalesPage, VisualSpec } from '../src/shared.js';
import { designFor, renderAdStoryboard, renderCoverSvg, renderPdf, renderSalesPageHtml } from '../src/deliverables/index.js';
import { sanitizePdfText } from '../src/deliverables/text.js';

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
