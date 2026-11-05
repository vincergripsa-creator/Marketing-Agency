/**
 * The sales page in every template (design plan D202, acceptance E7), to be read by eye: one guide of a run, or the demo
 * guide, in the 6 templates × the heroes it can show × several art directions, one HTML file each, and an index.
 *
 *   cd server && npx tsx scripts/pageSheet.ts --run <id or folder> --product <id> [--out <dir>] [--all-styles]
 *   cd server && npx tsx scripts/pageSheet.ts [--out <dir>]        the demo guide, with eight buyers' reviews and a real price drop
 *
 * The pages are the guide's own: its cover and its previews from the run's files, its copy as written. A run older than the
 * templates has no copy for their sections: the heuristic writer drafts those from the run's research, the rest stays as it was.
 * Without --all-styles each template wears a few styles in turn, every style appears at least once.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { isEntryPoint } from '../src/api/entry.js';
import { loadWorld, runsDir } from '../src/api/persist.js';
import { renderCoverSvg } from '../src/deliverables/cover.js';
import { normalizeDesign } from '../src/deliverables/design.js';
import { demoContent, demoProduct, demoSalesPage } from '../src/deliverables/fixture.js';
import { previewsOf } from '../src/deliverables/pages/render.js';
import { layoutPdf } from '../src/deliverables/pdf.js';
import { renderSalesPageHtml } from '../src/deliverables/salesPage.js';
import { MAX_PAGE_BYTES } from '../src/deliverables/sales/index.js';
import { createContentEngine } from '../src/minds/index.js';
import type { MindContext } from '../src/contracts.js';
import { ART_STYLES, HERO_NEEDS, PAGE_HEROES, PAGE_TEMPLATES, TEMPLATE_NEEDS, type ArtStyle, type PageHero, type PageTemplate, type Product, type SalesPage, type VoiceOfCustomer } from '../src/shared.js';

interface Args { run: string | null; product: string | null; out: string | null; allStyles: boolean }

class ArgError extends Error {}

function parseArgs(argv: readonly string[]): Args {
  const opt = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const run = opt('run') ?? null;
  const product = opt('product') ?? null;
  if (!!run !== !!product) throw new ArgError('Utilisation : npx tsx scripts/pageSheet.ts [--run <id ou dossier> --product <id>] [--out <dossier>] [--all-styles]');
  const out = opt('out');
  return { run, product, out: out ? resolve(out) : null, allStyles: argv.includes('--all-styles') };
}

interface Guide { product: Product; sp: SalesPage; cover: string; previews: { label: string; svg: string }[]; kit: { title: string; coverSvg: string } | null; brand: string; voc: VoiceOfCustomer | null; day?: number }

const MIND: MindContext = { agent: null as never, playbook: [], brainNotes: [], lessons: [], day: 0, brand: 'Pixel Agency' };

/** The sections of the templates for a copy written before them: a fresh draft from the same research, only those fields kept. */
async function withSections(p: Product, sp: SalesPage, voc: VoiceOfCustomer | null, brand: string): Promise<SalesPage> {
  if (sp.benefits?.length && sp.story) return sp;
  const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 });
  const draft = await engine.writeSalesPage({ product: p, content: p.content!, voc: voc ?? ({ nicheId: p.nicheId } as VoiceOfCustomer), hype: sp.hypeLevel ?? 0.4 }, { ...MIND, brand });
  return { ...sp, benefits: draft.benefits, forWho: draft.forWho, notFor: draft.notFor, story: draft.story, comparison: draft.comparison };
}

/** A run folder or a run id: the folder holds world.json, its parent is the runs root. */
function runPlace(run: string): { dir: string; id: string } {
  const asPath = resolve(run);
  if (existsSync(join(asPath, 'world.json'))) return { dir: dirname(asPath), id: basename(asPath) };
  return { dir: runsDir(), id: run };
}

async function fromRun(run: string, productId: string): Promise<Guide> {
  const { dir, id } = runPlace(run);
  const world = await loadWorld(id, { dir });
  if (!world) throw new ArgError(`Run introuvable : ${id} (attendu dans ${dir}, avec son world.json).`);
  const product = world.company.products.find((p) => p.id === productId);
  if (!product?.content || !product.salesPage) throw new ArgError(`Produit ${productId} introuvable dans ${id}, ou sans texte et sans page de vente.`);
  const root = join(dir, id);
  const read = async (rel: string | null | undefined): Promise<string> => (rel && existsSync(join(root, ...rel.split('/'))) ? readFile(join(root, ...rel.split('/')), 'utf8') : '');
  const previews: Guide['previews'] = [];
  for (const rel of product.files.previews ?? []) {
    const svg = await read(rel);
    if (svg) previews.push({ label: /\d+-([^/]+)\.svg$/.exec(rel)?.[1] ?? '', svg });
  }
  const kitProduct = world.company.products.find((p) => p.id === product.bumpProductId);
  const kitCover = await read(kitProduct?.files.cover);
  const brand = world.company.name;
  const voc = world.company.research.voc[product.nicheId] ?? null;
  return {
    product, sp: await withSections(product, product.salesPage, voc, brand), cover: await read(product.files.cover), previews,
    kit: kitProduct && kitCover ? { title: kitProduct.title, coverSvg: kitCover } : null, brand, voc, day: world.day,
  };
}

/** The demo guide, as a shop would hold it: real cover and pages, eight reviews, a price that really dropped 40 days ago. */
async function demo(): Promise<Guide> {
  const design = normalizeDesign(demoProduct.design);
  const reviews: Product['stats']['reviews'] = [
    ...demoProduct.stats.reviews,
    { id: 'rev_5', day: 18, customerId: 'cus_51', rating: 5, text: 'Le rituel en 20 minutes a suffi à calmer les couchers. Les réveils de nuit ont pris une semaine de plus.' },
    { id: 'rev_6', day: 21, customerId: 'cus_57', rating: 3, text: 'Utile mais j’aurais voulu plus de cas pour les bébés allaités. Le carnet de réveils est la meilleure partie.' },
    { id: 'rev_7', day: 25, customerId: 'cus_63', rating: 5, text: 'Simple, sans culpabiliser. On a enfin un plan commun avec mon conjoint.' },
    { id: 'rev_8', day: 30, customerId: 'cus_70', rating: 4, text: 'La règle des 2 minutes a tout changé chez nous. Le chapitre sur les rechutes m’a rassurée.' },
  ];
  const product: Product = {
    ...demoProduct, design, content: demoContent, price: 19,
    stats: { ...demoProduct.stats, reviews, rating: 4.4, ratingCount: 8 },
    priceHistory: [{ day: 6, price: 24 }, { day: 46, price: 19 }],
    pdfFacts: { pages: 24, sheets: 0 },
  };
  const brand = 'Pixel Agency';
  const guide = layoutPdf({ product, content: demoContent, design, brand });
  const cover = renderCoverSvg({ title: product.title, subtitle: demoContent.subtitle, audience: product.audience, design, brand });
  const voc: VoiceOfCustomer = {
    nicheId: product.nicheId, depth: 'deep', pains: demoSalesPage.painBullets, phrases: demoSalesPage.painBullets,
    objections: demoSalesPage.objections.map((o) => o.q), desiredOutcomes: ['des nuits de 6 heures', 'un coucher sans pleurs', 'savoir quoi faire à 3 h du matin'],
    knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors: [19], bannedClaims: [],
  };
  return { product, sp: await withSections(product, { ...demoSalesPage, priceWritten: 19 }, voc, brand), cover, previews: previewsOf(guide), kit: null, brand, voc, day: 50 };
}

const heroesFor = (g: Guide): PageHero[] => PAGE_HEROES.filter((hero) => {
  const need = HERO_NEEDS[hero];
  const sheets = g.previews.some((p) => /fiche|plan|kit/.test(p.label));
  return !need || ((!need.previews || g.previews.length >= 3) && (!need.bundle || !!g.kit || sheets));
});

const templateOk = (t: PageTemplate, g: Guide): boolean => {
  const need = TEMPLATE_NEEDS[t];
  return !need || ((need.minReviews ?? 0) <= (g.product.stats.reviews?.length ?? 0) && (!need.previews || g.previews.length > 1));
};

interface Sheet { file: string; template: PageTemplate; hero: PageHero; style: ArtStyle; bytes: number }

async function main(argv: readonly string[]): Promise<number> {
  const a = parseArgs(argv);
  const g = a.run && a.product ? await fromRun(a.run, a.product) : await demo();
  const out = a.out ?? (a.run ? join(runPlace(a.run).dir, runPlace(a.run).id, 'page-sheet', g.product.id) : join(tmpdir(), 'pixel-page-sheet', g.product.id));
  await mkdir(out, { recursive: true });
  const sheets: Sheet[] = [];
  let turn = 0;
  for (const template of PAGE_TEMPLATES) {
    if (!templateOk(template, g)) console.log(`${template} : conditions non remplies pour ce guide (TEMPLATE_NEEDS), dessiné quand même pour la revue.`);
    const combos: [PageHero, ArtStyle][] = [];
    for (const hero of heroesFor(g)) combos.push([hero, ART_STYLES[turn++ % ART_STYLES.length]!]);
    if (a.allStyles) for (const style of ART_STYLES) if (!combos.some(([, s]) => s === style)) combos.push([combos[0]![0], style]);
    for (const [hero, style] of combos) {
      const html = renderSalesPageHtml({
        product: g.product, salesPage: { ...g.sp, template, hero }, coverSvg: g.cover, design: { ...normalizeDesign(g.product.design), style },
        brand: g.brand, previews: g.previews, kit: g.kit, ...(g.day !== undefined ? { day: g.day } : {}),
      });
      const file = `${template}-${hero}-${style}.html`;
      await writeFile(join(out, file), html);
      sheets.push({ file, template, hero, style, bytes: Buffer.byteLength(html) });
    }
  }
  const index = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pages de vente — ${g.product.id}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#1b1b24;background:#f6f4ef}table{border-collapse:collapse}td,th{padding:6px 12px;border-bottom:1px solid #ddd;text-align:left}a{color:#2a4dd0}.over{color:#b3261e;font-weight:700}</style></head>
<body><h1>« ${g.product.title.replace(/</g, '&lt;')} »</h1><p>${sheets.length} pages, ${g.previews.length} vraies pages, ${g.product.stats.reviews.length} avis${g.kit ? ', un kit' : ''}. Budget : ${MAX_PAGE_BYTES / 1000} kB.</p>
<table><tr><th>Gabarit</th><th>Héros</th><th>Style</th><th>Poids</th></tr>${sheets.map((s) => `<tr><td><a href="${s.file}">${s.template}</a></td><td>${s.hero}</td><td>${s.style}</td><td class="${s.bytes > MAX_PAGE_BYTES ? 'over' : ''}">${Math.round(s.bytes / 1000)} kB</td></tr>`).join('')}</table></body></html>`;
  await writeFile(join(out, 'index.html'), index);
  for (const s of sheets) console.log(`${s.file.padEnd(34)} ${String(Math.round(s.bytes / 1000)).padStart(4)} kB${s.bytes > MAX_PAGE_BYTES ? '  AU-DESSUS DU BUDGET' : ''}`);
  console.log(join(out, 'index.html'));
  return sheets.every((s) => s.bytes <= MAX_PAGE_BYTES) ? 0 : 1;
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err: unknown) => {
      console.error(err instanceof ArgError ? err.message : err);
      process.exitCode = 1;
    },
  );
}
