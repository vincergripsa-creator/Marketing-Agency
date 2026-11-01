/**
 * A16, the PDFs as images (PLAN §5): one guide per voice, seven of its real pages on one PNG, to be read by eye for real type,
 * no overflow, no half-empty page, right accents, intentional art.
 *
 *   cd server && npx tsx scripts/pdfSheet.ts --run <id> [--out <dir>] [--width 620]
 *
 * The pages come from the file a buyer gets, through pdfjs and canvas, and only their choice reads the layout. Both are optional
 * (`VIDEO_FORCE_LEVEL=no_pages` walks that step here too): without them the tool names the pages it would have drawn, and says
 * which package is missing. It leaves with 1 then, and when a voice has no guide in the run: A16 is not read.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isEntryPoint } from '../src/api/entry.js';
import { loadWorld, runsDir } from '../src/api/persist.js';
import { normalizeDesign } from '../src/deliverables/design.js';
import type { PagePlan } from '../src/deliverables/layout/paginate.js';
import { layoutPdf } from '../src/deliverables/pdf.js';
import type { Product, TypeVoice, WorldState } from '../src/shared.js';
import { detectCaps } from '../src/video/caps.js';

export const SLOTS = ['cover', 'promise', 'opener', 'body', 'diagram', 'sheet', 'final'] as const;
export type Slot = typeof SLOTS[number];
export type PagePicks = Record<Slot, number | null>;

const LABELS: Record<Slot, string> = { cover: 'Couverture', promise: 'Promesse', opener: 'Ouverture de chapitre', body: 'Corps de chapitre', diagram: 'Schéma', sheet: 'Fiche', final: 'Dernière page' };
const VOICES: readonly TypeVoice[] = ['conte', 'dossier', 'atelier', 'signal'];
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const COLS = 4;                // and two rows: the seven pages, then the guide's card
const BAR = 38;                // the label over a page
const GAP = 14;
const GROUND = '#26262b';
const INK = '#f4f1ea';

interface Args { run: string; out: string | null; width: number }

class ArgError extends Error {}

function parseArgs(argv: readonly string[]): Args {
  const opt = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const run = opt('run');
  if (!run) throw new ArgError('Utilisation : npx tsx scripts/pdfSheet.ts --run <id> [--out <dossier>] [--width 620]');
  const width = Number(opt('width') ?? 620);
  if (!Number.isInteger(width) || width < 200 || width > 1600) throw new ArgError('--width doit être un entier entre 200 et 1600.');
  const out = opt('out');
  return { run, out: out ? resolve(out) : null, width };
}

/** The heights of a page's figures. A decision tree is a table of sentences, the text pages show that already: it counts when nothing else is drawn. */
function figureHeights(p: PagePlan, trees: boolean): number[] {
  return p.items.flatMap((i) => (i.t === 'block' && i.block.t === 'figure' && (trees || i.block.kind !== 'decision_tree') ? [i.block.h] : []));
}

/**
 * The page numbers to draw, by what each page is. `plans` start on page 2: the cover has none. The diagram is the tallest
 * one, and the body the emptiest page of text in a chapter: a sheet that shows the fullest proves nothing about half-empty pages.
 */
export function pickPages(plans: readonly PagePlan[]): PagePicks {
  const numbered = plans.map((plan, k) => ({ plan, page: k + 2 }));
  const first = (kind: PagePlan['kind']): number | null => numbered.find((p) => p.plan.kind === kind)?.page ?? null;
  const tallest = (trees: boolean): number | null => numbered.filter((p) => figureHeights(p.plan, trees).length)
    .sort((a, b) => Math.max(...figureHeights(b.plan, trees)) - Math.max(...figureHeights(a.plan, trees)) || a.page - b.page)[0]?.page ?? null;
  const diagram = tallest(false) ?? tallest(true);
  const text = numbered.filter((p) => p.plan.kind === 'text' && p.page !== diagram);
  const inChapter = text.filter((p) => p.plan.chapter !== null);
  const body = (inChapter.length ? inChapter : text).sort((a, b) => a.plan.fill - b.plan.fill || a.page - b.page)[0]?.page ?? null;
  return { cover: 1, promise: first('promise'), opener: first('opener'), body, diagram, sheet: first('sheet'), final: first('final') };
}

const printable = (p: Product, root: string): boolean => !!p.files.pdf && !!p.content?.chapters.length && !!p.design && existsSync(join(root, ...p.files.pdf.split('/')));

/** What a buyer is most likely to hold: on sale first, then the best seller, then the oldest id so that a read never moves. */
export function guideOfVoice(products: readonly Product[], voice: TypeVoice, root: string): Product | null {
  const live = (p: Product): number => (p.status === 'live' ? 0 : 1);
  return products.filter((p) => printable(p, root) && normalizeDesign(p.design).voice === voice)
    .sort((a, b) => live(a) - live(b) || b.stats.sales - a.stats.sales || a.id.localeCompare(b.id))[0] ?? null;
}

interface GuideRead { product: Product; picks: PagePicks; pages: number; voice: TypeVoice; note: string | null }

/** `layoutPdf` draws the guide as its render did, with the same effort: the follow-up link changes the words of the last page, never the count. */
function readGuide(world: WorldState, product: Product): GuideRead {
  const design = normalizeDesign(product.design);
  const guide = layoutPdf({ product, content: product.content!, design, brand: world.company.name, ...(product.visual?.effort ? { effort: product.visual.effort } : {}) });
  const printed = product.pdfFacts?.pages ?? guide.pages.length;
  const note = printed === guide.pages.length ? null : `la mise en page recalculée fait ${guide.pages.length} pages pour ${printed} imprimées : le choix des pages est à vérifier à l'œil`;
  return { product, picks: pickPages(guide.plans), pages: printed, voice: design.voice!, note };
}

const pickLine = (r: GuideRead): string => SLOTS.map((s) => `${LABELS[s].toLowerCase()} ${r.picks[s] === null ? 'absente' : `p. ${r.picks[s]}`}`).join(', ');

function wrap(text: string, max: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > max) { lines.push(line); line = word; } else line = next;
  }
  return line ? [...lines, line] : lines;
}

/** Draws one sheet. A page that does not exist in this guide keeps its cell, and says so: the gap is what the reader must see. */
async function drawSheet(r: GuideRead, pdf: string, width: number, file: string): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const { openGuide } = await import('../src/video/pdfPages.js');
  const { FACE, registerFonts } = await import('../src/video/fonts.js');
  registerFonts();
  const pageH = Math.round((width * PAGE_H) / PAGE_W);
  const cellH = BAR + pageH;
  const rows = Math.ceil((SLOTS.length + 1) / COLS);
  const canvas = createCanvas(COLS * width + (COLS + 1) * GAP, rows * cellH + (rows + 1) * GAP);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cellAt = (k: number) => ({ x: GAP + (k % COLS) * (width + GAP), y: GAP + Math.floor(k / COLS) * (cellH + GAP) });
  const guide = await openGuide(pdf);
  try {
    for (const [k, slot] of SLOTS.entries()) {
      const { x, y } = cellAt(k);
      const page = r.picks[slot];
      ctx.fillStyle = INK;
      ctx.font = `600 22px ${FACE.semi}`;
      ctx.fillText(page === null ? `${LABELS[slot]} : absente de ce guide` : `${LABELS[slot]} · p. ${page}`, x, y + 26);
      if (page === null) continue;
      const { img } = await guide.pageImage(page, width / PAGE_W);
      ctx.drawImage(img, x, y + BAR, width, pageH);
    }
  } finally {
    await guide.close();
  }
  const { x, y } = cellAt(SLOTS.length);
  ctx.fillStyle = INK;
  ctx.font = `800 34px ${FACE.bold}`;
  const titled = wrap(`« ${r.product.title} »`, width - 20, (s) => ctx.measureText(s).width);
  titled.forEach((line, k) => ctx.fillText(line, x, y + BAR + 44 * k + 30));
  ctx.font = `600 24px ${FACE.semi}`;
  const facts = [`${r.product.id}, v${r.product.version}`, `Voix ${r.voice}, ${r.pages} pages`, `${r.product.stats.sales} ventes, ${r.product.status}`, ...(r.note ? [r.note] : [])];
  let line = titled.length;
  for (const fact of facts) {
    for (const part of wrap(fact, width - 20, (s) => ctx.measureText(s).width)) ctx.fillText(part, x, y + BAR + 44 * line++ + 30);
  }
  await writeFile(file, await canvas.encode('png'));
}

async function main(argv: readonly string[]): Promise<number> {
  const a = parseArgs(argv);
  const world = await loadWorld(a.run);
  if (!world) {
    console.error(`Run introuvable : ${a.run} (attendu dans ${runsDir()}, avec son world.json).`);
    return 1;
  }
  const root = join(runsDir(), a.run);
  const guides: GuideRead[] = [];
  for (const voice of VOICES) {
    const product = guideOfVoice(world.company.products, voice, root);
    if (!product) { console.log(`Voix ${voice} : aucun guide imprimé dans ce run.`); continue; }
    const read = readGuide(world, product);
    guides.push(read);
    console.log(`Voix ${voice} : ${product.id} « ${product.title} », ${read.pages} pages : ${pickLine(read)}.${read.note ? ` Attention : ${read.note}.` : ''}`);
  }
  const caps = await detectCaps();
  if (!caps.canvas || !caps.pages) {
    console.error(`Aucune image : ${caps.canvas ? 'pdfjs-dist' : '@napi-rs/canvas'} est absent de cette machine (dépendance optionnelle du serveur). Les pages à lire sont listées ci-dessus.`);
    return 1;
  }
  const dir = a.out ?? root;
  await mkdir(dir, { recursive: true });
  for (const r of guides) {
    const file = join(dir, `pdf-sheet-${r.voice}-${r.product.id}.png`);
    await drawSheet(r, join(root, ...r.product.files.pdf!.split('/')), a.width, file);
    console.log(file);
  }
  if (guides.length < VOICES.length) console.error(`A16 non lu : ${guides.length}/${VOICES.length} voix dans ce run.`);
  return guides.length === VOICES.length ? 0 : 1;
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
