import { createHash } from 'node:crypto';
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { performance } from 'node:perf_hooks';
import PDFDocument from 'pdfkit';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtStyle, DesignEffort, DesignSpec } from '../src/shared.js';
import { coverScore, pickArt, pickComposition } from '../src/deliverables/art/evaluate.js';
import { BAUHAUS_ART, capHeight } from '../src/deliverables/art/styles/common.js';
import { hotWords, keyFigure } from '../src/deliverables/art/styles/craft.js';
import { BUILT_STYLES, compositionOf, drawPlate, styleDef, type PlateRole } from '../src/deliverables/art/styles/index.js';
import { THUMB_CAP_MIN } from '../src/deliverables/art/styles/types.js';
import { contrast } from '../src/deliverables/color.js';
import { coverAudit, coverScene, renderCoverSvg, type CoverInput } from '../src/deliverables/cover.js';
import { designFor, MOTIFS, PALETTES } from '../src/deliverables/design.js';
import { advance, registerVoice, setFontDir } from '../src/deliverables/fonts.js';
import { Scene, toPdf, toSvg, type Op } from '../src/deliverables/scene.js';
import { voiceFor } from '../src/deliverables/voices.js';
import { sampleDesign, SAMPLE_TITLES } from '../scripts/styleSheet.js';

const base = { title: 'Chiot propre en 21 jours', subtitle: 'Le plan heure par heure', audience: 'Nouveaux maîtres d’un chiot', brand: 'Pixel Agency' };
const chiot = (over: Partial<DesignSpec> = {}): DesignSpec => ({ ...designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed: 3 }), ...over });
const cover = (d: DesignSpec, input: Partial<CoverInput> = {}): CoverInput => ({ ...base, design: d, ...input });
const effort = (covers: number, taste = 1): DesignEffort => ({ covers, taste, layouts: 2, finish: 1 });

/** Every line a reader gets from the SVG: what is really drawn. */
const shownWords = (svg: string): string => [...svg.matchAll(/<path aria-label="([^"]*)"/g)].map((m) => m[1]!).join(' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const STYLES: { id: ArtStyle; compositions: string[] }[] = [
  { id: 'grille', compositions: ['chiffre', 'bandeau', 'fiche'] },
  { id: 'pop', compositions: ['autocollant', 'vague', 'mascotte'] },
  { id: 'trait', compositions: ['vignette', 'fenetre', 'carnet'] },
];

describe('the key figure of a title', () => {
  it('is the first number of the head with its unit, else one of the tail that counts something', () => {
    expect(keyFigure('Stress du bac', '21 jours pour réviser sans paniquer')).toEqual({ figure: '21', unit: 'jours', sign: false });
    expect(keyFigure('TOEIC 800+ en 30 jours')).toEqual({ figure: '800+', unit: '', sign: true });
    expect(keyFigure('Organiser son mariage à moins de 10 000 €', 'Le budget ligne par ligne')).toEqual({ figure: '10 000', unit: '€', sign: true });
    expect(keyFigure('Potager sur balcon', 'Récolter dès le premier été, même sur 3 m²')).toEqual({ figure: '3', unit: 'm²', sign: false });
    // a number of the tail that counts nothing is not the guide's figure
    expect(keyFigure('Un chiot propre en quelques semaines', 'La méthode simple pour un chiot de 2 à 6 mois')).toBeNull();
    expect(keyFigure('Chat qui griffe le canapé')).toBeNull();
    expect([...hotWords(['TOEIC', '800+', 'en', '30 jours'])]).toEqual([1]);
  });
});

describe('the registry builds styles A', () => {
  it('registers grille, pop and trait after Bauhaus and typo, each with its own compositions', () => {
    for (const s of STYLES) {
      expect(BUILT_STYLES).toContain(s.id);
      expect(styleDef(s.id).id).toBe(s.id);
      expect(styleDef(s.id).compositions.map((c) => c.id)).toEqual(s.compositions);
    }
    expect(BUILT_STYLES.slice(0, 2)).toEqual(['bauhaus', 'typo']);
    expect(compositionOf(chiot({ style: 'pop', composition: 4 }))).toBe(1);
    expect(compositionOf(chiot({ style: 'trait' }))).toBe(compositionOf(chiot({ style: 'trait', composition: -1 })));
  });
});

for (const { id, compositions } of STYLES) {
  describe(`${id}, « ${styleDef(id).compositions.map((c) => c.label).join(' », « ')} »`, () => {
    const def = styleDef(id);
    const covers: { input: CoverInput; k: number }[] = [];
    beforeAll(() => {
      // every motif on every ink set, every composition in turn, every title of the sample
      PALETTES.forEach((p, pi) => MOTIFS.forEach((motif, mi) => {
        const k = (pi + mi) % compositions.length;
        const d = { ...designFor({ nicheName: 'Guide', category: '', seed: 1 + pi * 37 + mi * 11 }), palette: { ...p.palette }, inks: { ...p.inks }, voice: voiceFor(p.family), motif, style: id, composition: k };
        covers.push({ input: { ...SAMPLE_TITLES[(pi * 3 + mi) % SAMPLE_TITLES.length]!, design: d, brand: 'Pixel Agency' }, k });
      }));
    });

    it('draws each composition as its own picture', () => {
      const d = chiot({ style: id });
      expect(new Set(compositions.map((_, composition) => renderCoverSvg(cover({ ...d, composition })))).size).toBe(compositions.length);
      expect(renderCoverSvg(cover(d))).not.toBe(renderCoverSvg(cover(chiot())));
    });

    it('E6: on all 14 motifs and 15 ink sets, capitals at least 7 px at 150 px, title at least 4.5:1 on its ground, SVG at most 150 kB, under 200 ms', () => {
      for (const { input, k } of covers) {
        const where = `${input.design.motif}/${input.design.inks!.paper}/${k}`;
        const t0 = performance.now();
        const svg = renderCoverSvg(input);
        const ms = performance.now() - t0;
        const { meta } = coverScene(input);
        const audit = coverAudit(input);
        expect((meta.titleSize * capHeight(meta.titleFace!) * 150) / 600, where).toBeGreaterThanOrEqual(THUMB_CAP_MIN);
        expect(audit.contrast, where).toBeGreaterThanOrEqual(4.5);
        // every run of the title, its figure in a second ink too
        const title = meta.lines.filter((l) => l.font === meta.titleFace && l.size === meta.titleSize);
        expect(title.length, where).toBeGreaterThanOrEqual(meta.titleLines.length);
        for (const l of title) expect(contrast(l.fill, meta.titleGround!), `${where}: ${l.s}`).toBeGreaterThanOrEqual(4.5);
        expect(Buffer.byteLength(svg), where).toBeLessThanOrEqual(150 * 1024);
        expect(ms, where).toBeLessThan(200);
        expect(svg, where).not.toMatch(/<text|<filter|<image|<use|font-family|url\((?!#)|href=|<script/);
      }
    });

    it('every word of the title, the label, the brand and the audience is drawn, no line wider than its box, nothing outside the margins', () => {
      for (const { input } of covers) {
        const { scene, meta } = coverScene(input);
        for (const l of meta.lines) {
          const w = advance(l.font, l.s, l.size, l.track);
          const left = l.anchor === 'end' ? l.x - w : l.x;
          expect(w, l.s).toBeLessThanOrEqual(l.width + 0.01);
          expect(left, l.s).toBeGreaterThanOrEqual(40 - 0.01);
          expect(left + w, l.s).toBeLessThanOrEqual(560 + 0.5);
          expect(l.y, l.s).toBeLessThanOrEqual(848 - 30);
        }
        const svg = renderCoverSvg(input);
        const shown = shownWords(svg).replace(/- /g, '-');
        for (const word of input.title.replace(/\s[:—–]\s/g, ' ').split(/\s+/).filter((x) => /\p{L}/u.test(x))) expect(shown.toLowerCase(), word).toContain(word.toLowerCase().replace(/'/g, '’'));
        expect(shown).toContain('GUIDE PRATIQUE');
        expect(shown).toContain('PIXEL AGENCY');
        expect(shown).toContain('Pour :');
        expect(scene.ops.filter((o) => o.k === 'text').length).toBe(meta.lines.length);
      }
    });

    it('the same design gives the same bytes without a world draw, and another art seed another cover', () => {
      const random = Math.random;
      Math.random = () => { throw new Error('no Math.random'); };
      try {
        for (let composition = 0; composition < compositions.length; composition++) {
          const d = chiot({ style: id, composition });
          expect(renderCoverSvg(cover(d))).toBe(renderCoverSvg(cover({ ...d })));
          expect(renderCoverSvg(cover({ ...d, artSeed: 77 }))).not.toBe(renderCoverSvg(cover(d)));
        }
      } finally {
        Math.random = random;
      }
    });

    it('scores its art on Bauhaus’s scale: the same mean within a point and a half, a close spread, and the cover score neutral too', () => {
      const art: number[] = [];
      const bauhausArt: number[] = [];
      const coverS: number[] = [];
      const bauhausCover: number[] = [];
      for (let i = 0; i < 300; i++) {
        const d = sampleDesign(i);
        const t = SAMPLE_TITLES[(i * 7) % SAMPLE_TITLES.length]!;
        const b = coverAudit({ ...t, design: d, brand: 'Pixel Agency' });
        bauhausArt.push(b.art);
        bauhausCover.push(coverScore(b));
        const y = coverAudit({ ...t, design: { ...d, style: id, composition: i % compositions.length }, brand: 'Pixel Agency' });
        art.push(y.art);
        coverS.push(coverScore(y));
      }
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));
      expect(Math.abs(mean(art) - BAUHAUS_ART.mean)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(mean(art) - mean(bauhausArt))).toBeLessThanOrEqual(1.5);
      expect(Math.abs(sd(art) - sd(bauhausArt))).toBeLessThanOrEqual(1.5);
      expect(Math.abs(mean(coverS) - mean(bauhausCover))).toBeLessThanOrEqual(1.5);
    });

    it('the designer’s search works on it as on Bauhaus: candidate 0 is the seed, eight beat one, and the eye sees more compositions with taste', () => {
      const first: number[] = [];
      const best: number[] = [];
      for (let seed = 0; seed < 60; seed++) {
        const d = chiot({ seed: seed * 97 + 5, style: id, composition: seed % compositions.length, inks: PALETTES[seed % 15]!.inks });
        expect(pickArt(d, effort(1)).seed).toBe(d.seed);
        first.push(pickArt(d, effort(1)).score);
        best.push(pickArt(d, effort(8)).score);
        expect(pickArt(d, effort(1)).score).toBe(def.candidate(d, d.inks!, d.seed, compositionOf(d)));
      }
      expect(best.reduce((a, b) => a + b) / 60).toBeGreaterThanOrEqual(first.reduce((a, b) => a + b) / 60 + 3);
      const input = cover(chiot({ style: id }));
      expect(pickComposition(input, effort(1, 0.4)).explored).toBe(1);
      expect(pickComposition(input, effort(1, 1)).explored).toBe(compositions.length);
      const pick = pickComposition(input, effort(1, 1));
      expect(pick.score).toBe(coverScore(coverAudit(cover({ ...input.design, composition: pick.composition }))));
    });

    it('prints its real text in a PDF, title first, the figures that are art never in the text', async () => {
      const dir = mkdtempSync(join(tmpdir(), `${id}-pdf-`));
      try {
        const { pdfPagesText } = await import('./pdfText.js');
        for (let composition = 0; composition < compositions.length; composition++) {
          const file = join(dir, `c${composition}.pdf`);
          const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
          const out = createWriteStream(file);
          doc.pipe(out);
          const { scene, meta } = coverScene(cover(chiot({ style: id, composition }), { title: 'Stress du bac : 21 jours pour réviser' }));
          registerVoice(doc, meta.voice);
          doc.addPage();
          toPdf(doc, scene, 0, 0, 595.28 / 600);
          doc.end();
          await finished(out);
          const [text] = pdfPagesText(file);
          expect(text).toContain('Stress');
          expect(text).toContain('Pour');
          // the giant figure, the starburst's, the tile's are art: no stray « 21 » before the title
          expect(text!.indexOf('21')).toBeGreaterThan(text!.indexOf('Stress'));
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('without fonts it still draws every word, in the standard set, and its figures fall away', () => {
      const empty = mkdtempSync(join(tmpdir(), 'no-fonts-'));
      try {
        setFontDir(empty);
        for (let composition = 0; composition < compositions.length; composition++) {
          const input = cover(chiot({ style: id, composition }), { title: 'Stress du bac : 21 jours pour réviser' });
          const svg = renderCoverSvg(input);
          expect(svg).toContain('font-family="Helvetica, Arial, sans-serif"');
          for (const word of ['Stress', 'bac', 'jours', 'GUIDE PRATIQUE']) expect(svg, word).toContain(word);
          expect(coverAudit(input).titleLines).toBeGreaterThan(0);
        }
      } finally {
        setFontDir();
        rmSync(empty, { recursive: true, force: true });
      }
    });

    it('draws its plate inside its rectangle on every role, its own picture, the same bytes for the same page', () => {
      const ROLES: { role: PlateRole; cols: number; rows: number; hero: boolean }[] = [
        { role: 'opener', cols: 6, rows: 4, hero: true }, { role: 'band', cols: 6, rows: 2, hero: false }, { role: 'close', cols: 4, rows: 2, hero: true },
        { role: 'kit', cols: 6, rows: 2, hero: false }, { role: 'film', cols: 6, rows: 11, hero: true },
      ];
      const inside = (ops: Op[], x0: number, y0: number, x1: number, y1: number): boolean => ops.every((o) => {
        if (o.k !== 'path' && o.k !== 'clip') return true;
        const nums = (o.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
        for (let i = 0; i + 1 < nums.length; i += 2) if (nums[i]! < x0 - 1 || nums[i]! > x1 + 1 || nums[i + 1]! < y0 - 1 || nums[i + 1]! > y1 + 1) return false;
        return true;
      });
      for (const [pi, motif] of [[0, 'moon'], [4, 'coin'], [9, 'brush'], [13, 'bolt'], [14, 'pot']] as const) {
        for (const r of ROLES) {
          const [x, y, u] = [33, 71, 47];
          const s = new Scene(800, 800);
          const spec = { x, y, u, cols: r.cols, rows: r.rows, inks: PALETTES[pi]!.inks, motif, seed: 12 + pi, hero: r.hero ? { c: 1, r: Math.max(0, r.rows - 2), s: 2, pick: 3 } : null, role: r.role };
          drawPlate({ style: id }, s, spec);
          // what is drawn outside the clip is the ground, the rectangle itself
          expect(inside(s.ops, x, y, x + r.cols * u, y + r.rows * u), `${r.role}/${motif}`).toBe(true);
          expect(s.ops.some((o) => o.k === 'clip'), `${r.role}/${motif}`).toBe(true);
          const again = new Scene(800, 800);
          drawPlate({ style: id }, again, spec);
          expect(toSvg(again)).toBe(toSvg(s));
          const bauhaus = new Scene(800, 800);
          drawPlate({}, bauhaus, spec);
          expect(toSvg(bauhaus)).not.toBe(toSvg(s));
        }
      }
      const spec = { x: 0, y: 0, u: 100, cols: 6, rows: 3, inks: PALETTES[2]!.inks, motif: 'paw' as const, seed: 4, hero: { c: 2, r: 0, s: 3, pick: 2 }, role: 'opener' as const };
      const a = new Scene(600, 300);
      const b = new Scene(600, 300);
      drawPlate({ style: id }, a, spec);
      drawPlate({ style: id }, b, { ...spec, hero: { ...spec.hero, pick: 3 } });
      expect(toSvg(b)).not.toBe(toSvg(a)); // two chapters, two pictures
    });
  });
}

describe('styles A leave the others as they were', () => {
  it('a design without style, Bauhaus named and typo draw what main drew', () => {
    const pins = [[3, 'split', 'paw', 'd3b47f356d7b968090a2132d2dc3a8fd69ecc7ce'], [11, 'minimal', 'moon', 'bae3fe12acc1d5d54655834fee5011eacd310511'], [27, 'centered', 'pot', 'c283bb4b3ba35fa5faba5cdfa936ad53282c7ed4']] as const;
    for (const [seed, coverLayout, motif, hash] of pins) {
      const d = { ...designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed }), coverLayout, motif };
      const svg = renderCoverSvg(cover(d));
      expect(createHash('sha1').update(svg).digest('hex'), `${seed}`).toBe(hash);
      expect(renderCoverSvg(cover({ ...d, style: 'bauhaus' }))).toBe(svg);
    }
  });
});
