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
import { BUILT_STYLES, drawPlate, styleDef } from '../src/deliverables/art/styles/index.js';
import { Dots, halftone, layered, multiply, sheet, tornPolygon } from '../src/deliverables/art/styles/paper.js';
import { THUMB_CAP_MIN } from '../src/deliverables/art/styles/types.js';
import { contrast } from '../src/deliverables/color.js';
import { coverAudit, coverScene, renderCoverSvg, type CoverInput } from '../src/deliverables/cover.js';
import { designFor, MOTIFS, PALETTES } from '../src/deliverables/design.js';
import { advance } from '../src/deliverables/fonts.js';
import { Scene, toPdf, toSvg } from '../src/deliverables/scene.js';
import { decoRng } from '../src/deliverables/text.js';
import { voiceFor } from '../src/deliverables/voices.js';
import { sampleDesign, SAMPLE_TITLES } from '../scripts/styleSheet.js';

const STYLES = ['collage', 'aura', 'riso'] as const satisfies readonly ArtStyle[];
const COMPOSITIONS: Record<(typeof STYLES)[number], string[]> = { collage: ['atelier', 'bandeau', 'horizon'], aura: ['halo', 'orbe', 'nuit'], riso: ['soleil', 'trame', 'duo'] };
const base = { title: 'Chiot propre en 21 jours', subtitle: 'Le plan heure par heure', audience: 'Nouveaux maîtres d’un chiot', brand: 'Pixel Agency' };
const chiot = (over: Partial<DesignSpec> = {}): DesignSpec => ({ ...designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed: 3 }), ...over });
const cover = (d: DesignSpec, input: Partial<CoverInput> = {}): CoverInput => ({ ...base, design: d, ...input });
const effort = (covers: number, taste = 1): DesignEffort => ({ covers, taste, layouts: 2, finish: 1 });

/** Every line a reader gets from the SVG: what is really drawn. */
const shownWords = (svg: string): string => [...svg.matchAll(/<path aria-label="([^"]*)"/g)].map((m) => m[1]!).join(' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('the paper and the press (D200)', () => {
  it('a halftone covers its cell by its tone, square or at 45°, and a misregistered drum moves every dot alike', () => {
    for (const angle of [0, 45] as const) {
      for (const tone of [0.1, 0.4, 0.7]) {
        const box = { x: 100, y: 100, w: 300, h: 300 };
        const dots = halftone(box, { cell: 10, angle, tone: () => tone }, (x, y) => x >= 100 && x < 400 && y >= 100 && y < 400);
        const inked = dots.reduce((a, q) => a + (Math.PI * q.d * q.d) / 4, 0);
        expect(inked / (300 * 300), `${angle}/${tone}`).toBeCloseTo(tone, 1);
      }
    }
    const a = halftone({ x: 0, y: 0, w: 100, h: 100 }, { cell: 9, angle: 45, tone: () => 0.5 }, () => true);
    const b = halftone({ x: 0, y: 0, w: 100, h: 100 }, { cell: 9, angle: 45, tone: () => 0.5 }, () => true, [3, -2]);
    // the same lattice moved: every dot of the shifted drum is a dot of the other, moved by the shift, but at the border
    const at = new Set(a.map((q) => `${Math.round(q.x * 100)}|${Math.round(q.y * 100)}`));
    const moved = b.filter((q) => q.x - 3 > 5 && q.x - 3 < 95 && q.y + 2 > 5 && q.y + 2 < 95);
    expect(moved.length).toBeGreaterThan(80);
    for (const q of moved) expect(at.has(`${Math.round((q.x - 3) * 100)}|${Math.round((q.y + 2) * 100)}`)).toBe(true);
  });

  it('two inks overprint darker than either, paper leaves an ink as it is', () => {
    expect(multiply('#ffffff', '#27357a')).toBe('#27357a');
    const o = multiply('#ee7a5b', '#27357a');
    expect(contrast(o, '#ffffff')).toBeGreaterThan(contrast('#27357a', '#ffffff'));
  });

  it('a tear wanders, its ends stay on their corners, its fringe lies outside it, and a cut edge stays straight', () => {
    const rnd = decoRng(5);
    const t = tornPolygon([[0, 0], [200, 0], [200, 100], [0, 100]], [true, false, true, false], rnd, { amp: 3, step: 5, white: 4 });
    expect(t.body[0]).toEqual([0, 0]);
    const top = t.body.filter(([, y]) => y < 50);
    expect(Math.max(...top.map(([, y]) => Math.abs(y)))).toBeLessThan(3 * 2.2);
    expect(Math.max(...top.map(([, y]) => Math.abs(y)))).toBeGreaterThan(0.5);
    // the fringe of the top edge stands above the edge, never under it
    t.fringe.forEach(([x, y], k) => { if (y < 50 && x > 0 && x < 200) expect(y).toBeLessThanOrEqual(t.body[k]![1] + 1e-9); });
    expect(t.body.some(([x, y]) => x === 200 && y === 0)).toBe(true);
    const s = sheet({ cx: 50, cy: 50, w: 80, h: 40, rot: 0, torn: [false, false, false, false] }, rnd, { amp: 3, step: 5, white: 4 });
    expect(s.body).toEqual([[10, 30], [90, 30], [90, 70], [10, 70]]);
    expect(layered(decoRng(1), 20, [{ every: 4, amp: 1 }], true).at(-1)).toBeCloseTo(layered(decoRng(1), 20, [{ every: 4, amp: 1 }], true)[0]!, 9);
  });

  it('dots go one path per size, a round cap on a step too short to see', () => {
    const d = new Dots();
    d.add(10, 10, 2.2);
    d.add(20, 10, 2.3);
    d.add(30, 10, 4);
    d.add(40, 10, 0.1);
    const s = new Scene(100, 100);
    d.draw(s, '#123456', 0.5);
    expect(d.size).toBe(3);
    expect(s.ops).toHaveLength(2);
    expect(toSvg(s)).toContain('d="M10 10h.1M20 10h.1" fill="none" stroke="#123456" stroke-width="2.25" stroke-linecap="round" opacity="0.5"');
  });
});

for (const id of STYLES) {
  describe(`${id}, « ${styleDef(id).compositions.map((c) => c.label).join(' », « ')} »`, () => {
    const def = styleDef(id);
    const covers: { input: CoverInput; k: number }[] = [];
    beforeAll(() => {
      PALETTES.forEach((p, pi) => MOTIFS.forEach((motif, mi) => {
        const k = (pi + mi) % def.compositions.length;
        const d = { ...designFor({ nicheName: 'Guide', category: '', seed: 1 + pi * 37 + mi * 11 }), palette: { ...p.palette }, inks: { ...p.inks }, voice: voiceFor(p.family), motif, style: id, composition: k };
        covers.push({ input: { ...SAMPLE_TITLES[(pi * 3 + mi) % SAMPLE_TITLES.length]!, design: d, brand: 'Pixel Agency' }, k });
      }));
    });

    it('is built, with its three compositions, each its own drawing', () => {
      expect(BUILT_STYLES).toContain(id);
      expect(def.id).toBe(id);
      expect(def.compositions.map((c) => c.id)).toEqual(COMPOSITIONS[id]);
      const d = chiot({ style: id });
      expect(new Set([0, 1, 2].map((composition) => renderCoverSvg(cover({ ...d, composition })))).size).toBe(3);
    });

    it('E6 on all 14 motifs and 15 ink sets: capitals of 7 px at 150 px, the title at 4.5:1 on its ground, at most 150 kB, under 200 ms; every word drawn, inside its box and the margins', () => {
      for (const { input, k } of covers) {
        const where = `${input.design.motif}/${input.design.inks!.paper}/${k}`;
        const t0 = performance.now();
        const svg = renderCoverSvg(input);
        const ms = performance.now() - t0;
        const { scene, meta } = coverScene(input);
        const audit = coverAudit(input);
        expect((meta.titleSize * capHeight(meta.titleFace!) * 150) / 600, where).toBeGreaterThanOrEqual(THUMB_CAP_MIN);
        expect(audit.contrast, where).toBeGreaterThanOrEqual(4.5);
        for (const l of meta.lines.filter((x) => x.font === meta.titleFace && meta.titleLines.includes(x.s))) expect(contrast(l.fill, meta.titleGround!), `${where}: ${l.s}`).toBeGreaterThanOrEqual(4.5);
        expect(Buffer.byteLength(svg), where).toBeLessThanOrEqual(150 * 1024);
        expect(ms, where).toBeLessThan(200);
        for (const l of meta.lines) {
          const w = advance(l.font, l.s, l.size, l.track);
          const left = l.anchor === 'end' ? l.x - w : l.x;
          expect(w, l.s).toBeLessThanOrEqual(l.width + 0.01);
          expect(left, l.s).toBeGreaterThanOrEqual(40 - 0.01);
          expect(left + w, l.s).toBeLessThanOrEqual(560 + 0.5);
        }
        const shown = shownWords(svg).replace(/- /g, '-');
        for (const word of input.title.replace(/\s[:—–]\s/g, ' ').split(/\s+/).filter((x) => /\p{L}/u.test(x))) expect(shown.toLowerCase(), `${where}: ${word}`).toContain(word.toLowerCase().replace(/'/g, '’'));
        expect(scene.ops.filter((o) => o.k === 'text').length).toBe(meta.lines.length);
      }
    });

    it('scores its art on Bauhaus’s scale: the same mean within a point, a close spread, and the cover score neutral too', () => {
      const art: number[] = [];
      const bauhausArt: number[] = [];
      const score: number[] = [];
      const bauhausScore: number[] = [];
      for (let i = 0; i < 300; i++) {
        const d = sampleDesign(i);
        const t = SAMPLE_TITLES[(i * 7) % SAMPLE_TITLES.length]!;
        const b = coverAudit({ ...t, design: d, brand: 'Pixel Agency' });
        bauhausArt.push(b.art);
        bauhausScore.push(coverScore(b));
        const y = coverAudit({ ...t, design: { ...d, style: id, composition: i % 3 }, brand: 'Pixel Agency' });
        art.push(y.art);
        score.push(coverScore(y));
      }
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));
      expect(Math.abs(mean(art) - BAUHAUS_ART.mean)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(mean(art) - mean(bauhausArt))).toBeLessThanOrEqual(1.5);
      expect(Math.abs(sd(art) - sd(bauhausArt))).toBeLessThanOrEqual(1.5);
      expect(Math.abs(mean(score) - mean(bauhausScore))).toBeLessThanOrEqual(1.5);
    });

    it('the designer’s search works on it as on Bauhaus: candidate 0 is the seed, eight beat one, the cover scores what the candidate said, no world draw', () => {
      const random = Math.random;
      Math.random = () => { throw new Error('no Math.random'); };
      try {
        const first: number[] = [];
        const best: number[] = [];
        for (let seed = 0; seed < 60; seed++) {
          const d = chiot({ seed: seed * 97 + 5, style: id, composition: seed % 3, inks: PALETTES[seed % 15]!.inks });
          expect(pickArt(d, effort(1)).seed).toBe(d.seed);
          first.push(pickArt(d, effort(1)).score);
          best.push(pickArt(d, effort(8)).score);
          if (seed % 10 === 0) expect(coverAudit(cover(d)).art).toBe(pickArt(d, effort(1)).score);
        }
        expect(best.reduce((a, b) => a + b) / 60).toBeGreaterThanOrEqual(first.reduce((a, b) => a + b) / 60 + 3);
        const d = chiot({ style: id, composition: 1 });
        expect(renderCoverSvg(cover(d))).toBe(renderCoverSvg(cover({ ...d })));
        expect(renderCoverSvg(cover({ ...d, artSeed: 77 }))).not.toBe(renderCoverSvg(cover(d)));
        const s = new Scene(600, 400);
        drawPlate({ style: id }, s, { x: 0, y: 0, u: 100, cols: 6, rows: 4, inks: d.inks!, motif: d.motif, seed: 9, hero: { c: 2, r: 0, s: 4, pick: 1 }, role: 'opener' });
        // its ground, then everything else inside the clip of its rectangle
        expect(s.ops.map((o) => o.k)).toEqual(['path', 'clip']);
        expect(s.ops[1]!.k === 'clip' && s.ops[1]!.ops.length).toBeGreaterThan(3);
      } finally {
        Math.random = random;
      }
    });

    it('the eye sees all three compositions with taste, and the kept one reaches the cover', () => {
      const input = cover(chiot({ style: id }));
      expect(pickComposition(input, effort(1, 0.4)).explored).toBe(1);
      expect(pickComposition(input, effort(1, 1)).explored).toBe(3);
      const pick = pickComposition(input, effort(1, 1));
      expect(pick.score).toBe(coverScore(coverAudit(cover({ ...input.design, composition: pick.composition }))));
    });

    it('prints its real text in a PDF, title first, the art as drawing only', async () => {
      const dir = mkdtempSync(join(tmpdir(), `${id}-pdf-`));
      try {
        const { registerVoice } = await import('../src/deliverables/fonts.js');
        const { pdfPagesText } = await import('./pdfText.js');
        const file = join(dir, 'c.pdf');
        const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
        const out = createWriteStream(file);
        doc.pipe(out);
        for (const composition of [0, 1, 2]) {
          const { scene, meta } = coverScene(cover(chiot({ style: id, composition }), { title: 'Stress du bac : 21 jours pour réviser' }));
          registerVoice(doc, meta.voice);
          doc.addPage();
          toPdf(doc, scene, 0, 0, 595.28 / 600);
        }
        doc.end();
        await finished(out);
        const pages = pdfPagesText(file);
        expect(pages).toHaveLength(3);
        for (const text of pages) {
          expect(text).toContain('Stress');
          expect(text.indexOf('Stress')).toBeLessThan(text.indexOf('Pour'));
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('its plates are its own, the same page gives the same bytes, two chapters two pictures', () => {
      const spec = { x: 0, y: 0, u: 100, cols: 6, rows: 3, inks: PALETTES[2]!.inks, motif: 'paw' as const, seed: 4, hero: { c: 2, r: 0, s: 3, pick: 2 }, role: 'opener' as const };
      const draw = (over: Partial<typeof spec> = {}, style: ArtStyle | null = id) => {
        const s = new Scene(600, 300);
        drawPlate(style ? { style } : {}, s, { ...spec, ...over });
        return toSvg(s);
      };
      expect(draw()).toBe(draw());
      expect(draw()).not.toBe(draw({}, null));
      expect(draw({ hero: { ...spec.hero, pick: 3 } })).not.toBe(draw());
    });

    it('survives the films’ path at frame size: toSvg, then Skia’s loadImage, paints the plate and its figure', async () => {
      const canvas = await import('@napi-rs/canvas').catch(() => null);
      if (!canvas) return;
      for (const pi of [0, 9, 13]) {
        const inks = PALETTES[pi]!.inks;
        const [w, h, u] = [1080, 1920, 180];
        const rows = Math.ceil(h / u);
        const scene = new Scene(w, h);
        drawPlate({ style: id }, scene, { x: 0, y: 0, u, cols: 6, rows, inks, motif: 'heart', seed: 31 + pi, hero: { c: 1, r: rows - 4, s: 4 }, role: 'film' });
        const svg = toSvg(scene, { precision: 1 });
        const img = await canvas.loadImage(Buffer.from(svg));
        const c = canvas.createCanvas(w, h);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const seen = new Set<number>();
        let off = 0;
        const paper = parseInt(inks.paper.slice(1), 16);
        for (let k = 0; k < data.length; k += 4 * 97) {
          const v = (data[k]! << 16) | (data[k + 1]! << 8) | data[k + 2]!;
          seen.add(v >> 3);
          if (Math.abs((v >> 16) - (paper >> 16)) + Math.abs(((v >> 8) & 255) - ((paper >> 8) & 255)) + Math.abs((v & 255) - (paper & 255)) > 30) off += 1;
          expect(data[k + 3], `${id}/${pi}`).toBe(255);
        }
        // a real picture: many tones, and much of the frame away from bare paper
        expect(seen.size, `${id}/${pi}`).toBeGreaterThan(40);
        expect(off / (data.length / (4 * 97)), `${id}/${pi}`).toBeGreaterThan(0.15);
      }
    });
  });
}
