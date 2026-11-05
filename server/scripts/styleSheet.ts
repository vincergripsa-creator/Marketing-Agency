/**
 * A style, to be read by eye and by number (design plan D200, acceptance E6): its covers over seeds, motifs, the 15 ink sets
 * and its compositions as PNG contact sheets, and its art score against Bauhaus's on the same designs.
 *
 *   cd server && npx tsx scripts/styleSheet.ts --style typo [--out <dir>] [--width 300] [--sample 420] [--sheets all|none|palettes,motifs,thumbs,plates]
 *
 * Covers go through `@napi-rs/canvas` (`loadImage` of the SVG, then `encode('png')`), the way the films read them. The numbers:
 * mean, sd, min and max of `art` and of the cover score, then E6 (capitals at 150 px, title contrast, SVG size, render time).
 * A style is calibrated when its art mean sits within 1 point of Bauhaus's and its sd close to it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { isEntryPoint } from '../src/api/entry.js';
import { coverScore } from '../src/deliverables/art/evaluate.js';
import { BAUHAUS_ART, capHeight } from '../src/deliverables/art/styles/common.js';
import { BUILT_STYLES, styleDef } from '../src/deliverables/art/styles/index.js';
import type { PlateRole } from '../src/deliverables/art/styles/types.js';
import { coverAudit, coverScene, renderCoverSvg, type CoverInput } from '../src/deliverables/cover.js';
import { designFor, MOTIFS, PALETTES } from '../src/deliverables/design.js';
import { Scene, toSvg } from '../src/deliverables/scene.js';
import { hashString } from '../src/deliverables/text.js';
import { voiceFor } from '../src/deliverables/voices.js';
import type { ArtStyle, DesignSpec } from '../src/shared.js';

/** Titles as the studio writes them, short to past the cut, with their audience. */
export const SAMPLE_TITLES: readonly { title: string; subtitle: string; audience: string }[] = [
  { title: 'Chat qui griffe le canapé', subtitle: 'Le plan en 10 jours pour sauver vos meubles sans punir votre chat', audience: 'Propriétaires d’un chat d’intérieur en appartement' },
  { title: 'TOEIC 800+ en 30 jours', subtitle: 'La méthode jour par jour pour gagner 150 points', audience: 'Étudiants et salariés qui visent 800 au TOEIC' },
  { title: 'Chiot seul à la maison : le plan de 14 jours pour partir travailler sereinement', subtitle: '', audience: 'Nouveaux propriétaires d’un chiot de 2 à 6 mois vivant en appartement' },
  { title: 'Bébé se réveille plusieurs fois par nuit : la méthode douce en 14 nuits (6-12 mois)', subtitle: '', audience: 'Parents épuisés d’un bébé de 6 à 12 mois' },
  { title: 'Perdre du ventre après 40 ans : le plan de 8 semaines sans régime', subtitle: '', audience: 'Femmes et hommes de plus de 40 ans qui reprennent une activité' },
  { title: 'Organiser son mariage à moins de 10 000 € : le budget ligne par ligne', subtitle: '', audience: 'Couples qui se marient dans l’année avec un budget serré' },
  { title: 'Revendre sur Vinted pour arrondir ses fins de mois', subtitle: 'Photos, prix et envois : la routine qui fait vendre', audience: 'Particuliers qui veulent vider leurs placards et gagner 200 € par mois' },
  { title: 'Japon petit budget : 2 semaines de voyage pour moins de 2 000 €', subtitle: '', audience: 'Voyageurs qui partent pour la première fois au Japon' },
  { title: 'Déclarer son chiffre d’affaires à l’URSSAF sans erreur : le guide pas à pas', subtitle: '', audience: 'Micro-entrepreneurs qui déclarent seuls leur chiffre d’affaires' },
  { title: 'Freelances : trouver ses 3 premiers clients sur LinkedIn en 30 jours', subtitle: '', audience: 'Freelances qui se lancent sans réseau' },
  { title: 'Potager sur balcon : récolter dès le premier été, même sur 3 m²', subtitle: '', audience: 'Citadins qui ont un balcon et zéro expérience' },
  { title: 'Relooker un meuble ancien sans le rater', subtitle: 'Poncer, peindre, vernir : la méthode en un week-end', audience: 'Bricoleurs débutants qui chinent leurs meubles' },
  { title: 'Le chiot fait ses besoins partout dans l’appartement : 6 étapes concrètes (2-6 mois)', subtitle: '', audience: 'Nouveaux propriétaires d’un chiot de 2 à 6 mois vivant en appartement' },
  { title: 'Batch cooking en famille : 2 heures le dimanche pour 5 soirs de repas', subtitle: '', audience: 'Familles à budget serré qui manquent de temps le soir' },
  { title: 'Stress du bac : 21 jours pour réviser sans paniquer', subtitle: '', audience: 'Lycéens de terminale et leurs parents' },
  { title: 'Micro-entrepreneur — déclarer sans se tromper', subtitle: '', audience: 'Micro-entrepreneurs qui débutent' },
  { title: 'Un chiot propre en quelques semaines, même en appartement : la méthode simple pour les propriétaires d’un chiot de 2 à 6 mois', subtitle: '', audience: 'Nouveaux propriétaires d’un chiot' },
  { title: 'Entretien IFAS : préparer l’oral d’entrée en formation aide-soignante', subtitle: '', audience: 'Candidats à l’entrée en IFAS' },
];

const SHEETS = ['palettes', 'motifs', 'thumbs', 'plates'] as const;
type Sheet = typeof SHEETS[number];

interface Args { style: ArtStyle; out: string; width: number; sample: number; sheets: Sheet[] }

class ArgError extends Error {}

function parseArgs(argv: readonly string[]): Args {
  const opt = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const style = (opt('style') ?? 'typo') as ArtStyle;
  if (!BUILT_STYLES.includes(style)) throw new ArgError(`--style : un style construit parmi ${BUILT_STYLES.join(', ')}.`);
  const width = Number(opt('width') ?? 300);
  const sample = Number(opt('sample') ?? 420);
  if (!Number.isInteger(width) || width < 100 || width > 600) throw new ArgError('--width : un entier entre 100 et 600.');
  if (!Number.isInteger(sample) || sample < 30) throw new ArgError('--sample : un entier, 30 au moins.');
  const asked = opt('sheets') ?? 'all';
  const sheets = asked === 'all' ? [...SHEETS] : asked === 'none' ? [] : asked.split(',').filter((s): s is Sheet => (SHEETS as readonly string[]).includes(s));
  // outside the repository unless asked: sheets are to be looked at, not committed
  return { style, out: resolve(opt('out') ?? join(tmpdir(), 'style-sheets', style)), width, sample, sheets };
}

/** Design `i` of the sample, before its style: an ink set, a motif and a seed as the studio would draw them, the voice of the ink set's family. */
export function sampleDesign(i: number): DesignSpec {
  const p = PALETTES[i % PALETTES.length]!;
  const seed = 1 + (hashString(`sheet|${i}`) % 999_999);
  const base = designFor({ nicheName: 'Guide', category: '', seed });
  return { ...base, palette: { ...p.palette }, inks: { ...p.inks }, family: p.family, voice: voiceFor(p.family), motif: MOTIFS[(i * 5 + Math.floor(i / PALETTES.length)) % MOTIFS.length]! };
}

const coverOf = (d: DesignSpec, i: number): CoverInput => {
  const t = SAMPLE_TITLES[(i * 7) % SAMPLE_TITLES.length]!;
  return { ...t, design: d, brand: 'Pixel Agency' };
};

interface Row { art: number; cover: number; thumb: number; balance: number; cap: number; contrast: number; kb: number; ms: number }

function measure(input: CoverInput): Row {
  const t0 = performance.now();
  const svg = renderCoverSvg(input);
  const ms = performance.now() - t0;
  const audit = coverAudit(input);
  const { meta } = coverScene(input);
  const cap = (meta.titleSize * capHeight(meta.titleFace ?? meta.voice.display) * 150) / 600;
  const thumb = 100 * Math.min(1, Math.max(0, (audit.thumbPx - 7) / 6));
  return { art: audit.art, cover: coverScore(audit), thumb, balance: audit.lineBalance, cap, contrast: audit.contrast, kb: Buffer.byteLength(svg) / 1024, ms };
}

const stats = (xs: number[]) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1));
  return { mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
};

const fmt = (s: ReturnType<typeof stats>) => `moyenne ${s.mean.toFixed(1)}  écart-type ${s.sd.toFixed(1)}  min ${s.min.toFixed(1)}  max ${s.max.toFixed(1)}`;

function report(label: string, rows: Row[]): void {
  const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]!;
  console.log(`  ${label.padEnd(24)} art    ${fmt(stats(rows.map((r) => r.art)))}`);
  console.log(`  ${''.padEnd(24)} cover  ${fmt(stats(rows.map((r) => r.cover)))}  (miniature ${stats(rows.map((r) => r.thumb)).mean.toFixed(1)}, équilibre ${stats(rows.map((r) => r.balance)).mean.toFixed(1)})`);
  console.log(`  ${''.padEnd(24)} E6     capitales à 150 px min ${Math.min(...rows.map((r) => r.cap)).toFixed(1)} px (médiane ${pct(rows.map((r) => r.cap), 0.5).toFixed(1)}), contraste min ${Math.min(...rows.map((r) => r.contrast)).toFixed(2)}, SVG max ${Math.max(...rows.map((r) => r.kb)).toFixed(0)} ko, rendu moyen ${stats(rows.map((r) => r.ms)).mean.toFixed(1)} ms, p99 ${pct(rows.map((r) => r.ms), 0.99).toFixed(1)} ms`);
}

/** Cells of `w` × `h`, each drawing fitted whole inside its own, its proportions kept. */
async function grid(file: string, cells: { svg: string; label: string }[], cols: number, w: number, h: number): Promise<void> {
  const bar = 16;
  const rows = Math.ceil(cells.length / cols);
  const canvas = createCanvas(cols * w, rows * (h + bar));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2a2a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [k, cell] of cells.entries()) {
    const img = await loadImage(Buffer.from(cell.svg));
    const x = (k % cols) * w;
    const y = Math.floor(k / cols) * (h + bar);
    const scale = Math.min(w / img.width, h / img.height);
    ctx.drawImage(img, x + (w - img.width * scale) / 2, y + (h - img.height * scale) / 2, img.width * scale, img.height * scale);
    caption(ctx, cell.label, x + 4, y + h + 12);
  }
  writeFileSync(file, await canvas.encode('png'));
  console.log(file);
}

function caption(ctx: SKRSContext2D, text: string, x: number, y: number): void {
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#e8e6e1';
  ctx.fillText(text, x, y);
}

const PLATES: readonly { role: PlateRole; cols: number; rows: number }[] = [
  { role: 'opener', cols: 6, rows: 4 }, { role: 'band', cols: 6, rows: 2 }, { role: 'close', cols: 4, rows: 2 }, { role: 'kit', cols: 6, rows: 2 }, { role: 'film', cols: 6, rows: 11 },
];

async function sheets(a: Args): Promise<void> {
  mkdirSync(a.out, { recursive: true });
  const def = styleDef(a.style);
  const h = Math.round((a.width * 848) / 600);
  const look = (d: DesignSpec, k: number): DesignSpec => ({ ...d, style: a.style, composition: k });
  for (const [k, comp] of def.compositions.entries()) {
    if (a.sheets.includes('palettes')) {
      for (let page = 0; page < 3; page++) {
        const cells = [];
        for (let p = page * 5; p < page * 5 + 5; p++) {
          for (let c = 0; c < 4; c++) {
            const i = p + PALETTES.length * (c * 3 + k);
            const d = { ...sampleDesign(i), palette: { ...PALETTES[p]!.palette }, inks: { ...PALETTES[p]!.inks }, voice: voiceFor(PALETTES[p]!.family) };
            const input = coverOf(look(d, k), c * 5 + p);
            cells.push({ svg: renderCoverSvg(input), label: `${PALETTES[p]!.name} · ${d.motif} · ${d.voice}` });
          }
        }
        await grid(join(a.out, `${a.style}-${k}-${comp.id}-palettes-${page + 1}.png`), cells, 4, a.width, h);
      }
    }
    if (a.sheets.includes('motifs')) {
      const cells = MOTIFS.map((motif, m) => {
        const d = { ...sampleDesign(m * 3 + k), motif };
        return { svg: renderCoverSvg(coverOf(look(d, k), m + k)), label: `${motif} · ${PALETTES[(m * 3 + k) % 15]!.name}` };
      });
      await grid(join(a.out, `${a.style}-${k}-${comp.id}-motifs.png`), cells, 7, a.width, h);
    }
    if (a.sheets.includes('thumbs')) {
      const cells = PALETTES.flatMap((_, p) => [0, 1].map((c) => {
        const i = p + 15 * c;
        const d = { ...sampleDesign(i), palette: { ...PALETTES[p]!.palette }, inks: { ...PALETTES[p]!.inks }, voice: voiceFor(PALETTES[p]!.family) };
        return { svg: renderCoverSvg(coverOf(look(d, k), p * 2 + c)), label: '' };
      }));
      await grid(join(a.out, `${a.style}-${k}-${comp.id}-thumbs-150.png`), cells, 10, 150, 212);
    }
  }
  if (a.sheets.includes('plates')) {
    const cells = [];
    for (const p of [0, 4, 9, 13]) {
      const d = { ...sampleDesign(p), palette: { ...PALETTES[p]!.palette }, inks: { ...PALETTES[p]!.inks }, style: a.style };
      for (const plate of PLATES) {
        const u = 60;
        const s = new Scene(plate.cols * u, plate.rows * u);
        s.rect(0, 0, s.w, s.h, '#ff00ff');
        def.plate(s, { x: 0, y: 0, u, cols: plate.cols, rows: plate.rows, inks: d.inks!, motif: d.motif, seed: d.seed, hero: plate.role === 'opener' ? { c: 2, r: 1, s: 3, pick: 1 } : plate.role === 'film' ? { c: 1, r: 7, s: 4 } : null, role: plate.role });
        cells.push({ svg: toSvg(s), label: `${plate.role} · ${PALETTES[p]!.name} · ${d.motif}` });
      }
    }
    await grid(join(a.out, `${a.style}-plates.png`), cells, 5, 360, 360);
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const a = parseArgs(argv);
  const def = styleDef(a.style);
  const bauhaus: Row[] = [];
  const style: Row[][] = def.compositions.map(() => []);
  for (let i = 0; i < a.sample; i++) {
    const d = sampleDesign(i);
    bauhaus.push(measure(coverOf(d, i)));
    def.compositions.forEach((_, k) => style[k]!.push(measure(coverOf({ ...d, style: a.style, composition: k }, i))));
  }
  console.log(`Style « ${a.style} » contre Bauhaus, ${a.sample} couvertures chacun (graines, motifs, 15 jeux d’encres, ${SAMPLE_TITLES.length} titres)`);
  report('bauhaus (V1)', bauhaus);
  report(`${a.style}, toutes`, style.flat());
  def.compositions.forEach((c, k) => report(`${a.style} ${k} « ${c.label} »`, style[k]!));
  const sign = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  const gaps = (key: 'art' | 'cover') => [stats(style.flat().map((r) => r[key])), stats(bauhaus.map((r) => r[key]))] as const;
  const [art, artB] = gaps('art');
  const [cover, coverB] = gaps('cover');
  const ok = Math.abs(art.mean - artB.mean) <= 1 && Math.abs(art.sd - artB.sd) <= 1.5 && Math.abs(cover.mean - coverB.mean) <= 1;
  console.log(`  écart à Bauhaus : art ${sign(art.mean - artB.mean)} (écart-type ${sign(art.sd - artB.sd)}), couverture ${sign(cover.mean - coverB.mean)} (écart-type ${sign(cover.sd - coverB.sd)}) → ${ok ? 'calibré' : 'à recalibrer'}`);
  // the raw mean and spread each composition must declare to land on Bauhaus's scale, from what was just measured
  def.compositions.forEach((c, k) => {
    const s = stats(style[k]!.map((r) => r.art));
    console.log(`  « ${c.label} » : art ${s.mean.toFixed(2)} ± ${s.sd.toFixed(2)} sur l’échelle de Bauhaus ${BAUHAUS_ART.mean} ± ${BAUHAUS_ART.sd}`);
  });
  if (a.sheets.length) await sheets(a);
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof ArgError ? err.message : (err as Error).stack);
    process.exitCode = 1;
  });
}
