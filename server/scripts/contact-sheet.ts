/**
 * The art, to be read by eye (pdf §6.2): motifs × ink sets, as real covers, through the PDF and back to PNG like a page of
 * a guide. No hero merges until its sheet looks intentional.
 *
 *   npx tsx scripts/contact-sheet.ts [--out <dir>] [--inks 0,2,4,9|all] [--motifs heroes|all] [--layout split|minimal] [--seed 7] [--title "…"] [--width 220]
 *
 * One PNG per ink set in pages of `--per-sheet`, each row a set, each column a motif. Needs the optional canvas and pdfjs.
 */
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { createCanvas } from '@napi-rs/canvas';
import PDFDocument from 'pdfkit';
import { isEntryPoint } from '../src/api/entry.js';
import { coverScene } from '../src/deliverables/cover.js';
import { MOTIFS, PALETTES, designFor } from '../src/deliverables/design.js';
import { registerVoice } from '../src/deliverables/fonts.js';
import { toPdf } from '../src/deliverables/scene.js';
import type { DesignSpec, InkSet } from '../src/shared.js';
import { openGuide } from '../src/video/pdfPages.js';

const HEROES: DesignSpec['motif'][] = ['moon', 'sun', 'paw', 'heart', 'leaf', 'coin', 'chart', 'home'];
const DEFAULT_INKS = [0, 2, 4, 9]; // the four sets of the prototype
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const DEFAULT_TITLE = 'Le chiot fait ses besoins partout : 6 étapes concrètes';

interface Args { out: string; inks: number[]; motifs: DesignSpec['motif'][]; layout: DesignSpec['coverLayout']; seed: number; title: string; width: number; perSheet: number }

function parseArgs(argv: readonly string[]): Args {
  const opt = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const inks = opt('inks');
  return {
    out: resolve(opt('out') ?? 'contact-sheet'),
    inks: inks === 'all' ? PALETTES.map((_, i) => i) : inks ? inks.split(',').map(Number) : DEFAULT_INKS,
    motifs: opt('motifs') === 'all' ? [...MOTIFS] : HEROES,
    layout: (opt('layout') ?? 'split') as DesignSpec['coverLayout'],
    seed: Number(opt('seed') ?? 7),
    title: opt('title') ?? DEFAULT_TITLE,
    width: Number(opt('width') ?? 220),
    perSheet: Number(opt('per-sheet') ?? 5),
  };
}

const designOf = (a: Args, inks: InkSet, motif: DesignSpec['motif'], voice: DesignSpec['voice']): DesignSpec =>
  ({ ...designFor({ nicheName: 'Guide', category: '', seed: a.seed + HEROES.indexOf(motif) }), motif, coverLayout: a.layout, inks, voice });

async function main(argv: readonly string[]): Promise<void> {
  const a = parseArgs(argv);
  mkdirSync(a.out, { recursive: true });
  const pdf = join(a.out, 'covers.pdf');
  const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
  const stream = createWriteStream(pdf);
  doc.pipe(stream);
  const voices: DesignSpec['voice'][] = ['conte', 'dossier', 'atelier', 'signal'];
  a.inks.forEach((set, row) => a.motifs.forEach((motif) => {
    const { scene, meta } = coverScene({ title: a.title, subtitle: '', audience: 'Nouveaux propriétaires d’un chiot en appartement', design: designOf(a, PALETTES[set]!.inks, motif, voices[row % voices.length]), brand: 'Pixel Agency' });
    registerVoice(doc, meta.voice);
    doc.addPage();
    toPdf(doc, scene, 0, 0, PAGE_W / scene.w);
  }));
  doc.end();
  await finished(stream);

  const guide = await openGuide(pdf);
  const h = Math.round((a.width * PAGE_H) / PAGE_W);
  const sheets = Math.ceil(a.inks.length / a.perSheet);
  for (let sheet = 0; sheet < sheets; sheet++) {
    const rows = a.inks.slice(sheet * a.perSheet, (sheet + 1) * a.perSheet);
    const canvas = createCanvas(a.width * a.motifs.length, h * rows.length);
    const ctx = canvas.getContext('2d');
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < a.motifs.length; c++) {
        const page = (sheet * a.perSheet + r) * a.motifs.length + c + 1;
        const { img } = await guide.pageImage(page, (a.width / PAGE_W) * 2);
        ctx.drawImage(img, c * a.width, r * h, a.width, h);
      }
    }
    const file = join(a.out, `sheet-${a.layout}-${sheet + 1}.png`);
    writeFileSync(file, await canvas.encode('png'));
    console.log(file);
  }
  await guide.close();
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  });
}
