import { createHash } from 'node:crypto';
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { performance } from 'node:perf_hooks';
import PDFDocument from 'pdfkit';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtStyle, DesignEffort, DesignSpec } from '../src/shared.js';
import { ART_STYLES } from '../src/shared.js';
import { artScore, coverScore, pickArt, pickComposition } from '../src/deliverables/art/evaluate.js';
import { field } from '../src/deliverables/art/field.js';
import { boundsOf, drawShape, motifShape, ORNAMENTS, ornament, pathD, placer, samples } from '../src/deliverables/art/shapes.js';
import { BAUHAUS_ART, capHeight, posterBreak } from '../src/deliverables/art/styles/common.js';
import { BUILT_STYLES, compositionOf, drawPlate, isBuilt, styleDef, type PlateRole } from '../src/deliverables/art/styles/index.js';
import { THUMB_CAP_MIN } from '../src/deliverables/art/styles/types.js';
import { contrast } from '../src/deliverables/color.js';
import { coverAudit, coverScene, renderCoverSvg, type CoverInput } from '../src/deliverables/cover.js';
import { designFor, MOTIFS, normalizeDesign, PALETTES } from '../src/deliverables/design.js';
import { advance } from '../src/deliverables/fonts.js';
import { linear, radial, Scene, stopsOf, toPdf, toSvg, type Op } from '../src/deliverables/scene.js';
import { voiceFor } from '../src/deliverables/voices.js';
import { sampleDesign, SAMPLE_TITLES } from '../scripts/styleSheet.js';

const sha = (s: string | Buffer): string => createHash('sha1').update(s).digest('hex');
const base = { title: 'Chiot propre en 21 jours', subtitle: 'Le plan heure par heure', audience: 'Nouveaux maîtres d’un chiot', brand: 'Pixel Agency' };
const chiot = (over: Partial<DesignSpec> = {}): DesignSpec => ({ ...designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed: 3 }), ...over });
const cover = (d: DesignSpec, input: Partial<CoverInput> = {}): CoverInput => ({ ...base, design: d, ...input });
const effort = (covers: number, taste = 1): DesignEffort => ({ covers, taste, layouts: 2, finish: 1 });
const UNBUILT = ART_STYLES.filter((s) => !BUILT_STYLES.includes(s));

/** Every line a reader gets from the SVG: what is really drawn. */
const shownWords = (svg: string): string => [...svg.matchAll(/<path aria-label="([^"]*)"/g)].map((m) => m[1]!).join(' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const flatPaths = (ops: Op[]): Extract<Op, { k: 'path' }>[] => ops.flatMap((o) => (o.k === 'clip' ? flatPaths(o.ops) : o.k === 'path' ? [o] : []));

/** Points of an absolute M L H V C Z path, curves sampled. */
function points(d: string): [number, number][] {
  const out: [number, number][] = [];
  let at: [number, number] = [0, 0];
  for (const m of d.matchAll(/([MLCHVhvZ])([^MLCHVhvZ]*)/g)) {
    const v = (m[2]!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (m[1] === 'M' || m[1] === 'L') for (let i = 0; i < v.length; i += 2) out.push((at = [v[i]!, v[i + 1]!]));
    else if (m[1] === 'h') out.push((at = [at[0] + v[0]!, at[1]]));
    else if (m[1] === 'v') out.push((at = [at[0], at[1] + v[0]!]));
    else if (m[1] === 'H') out.push((at = [v[0]!, at[1]]));
    else if (m[1] === 'V') out.push((at = [at[0], v[0]!]));
    else if (m[1] === 'C') for (let i = 0; i < v.length; i += 6) out.push([v[i]!, v[i + 1]!], [v[i + 2]!, v[i + 3]!], (at = [v[i + 4]!, v[i + 5]!]));
  }
  return out;
}

describe('gradients (D200)', () => {
  const g = linear(20, 0, 380, 0, [{ offset: 0.25, color: '#ff0000' }, { offset: 0.75, color: '#0000ff', opacity: 0.5 }]);

  it('existing ops write the bytes they always wrote: paths, strokes, dashes, opacity, clips, groups, and a V1 field', () => {
    const s = new Scene(120, 80);
    s.rect(0, 0, 120, 80, '#f4ecdf');
    s.circle(30, 30, 12, '#27357a', { stroke: '#131a3b', sw: 1.5 });
    s.line(5, 70, 115, 70, '#ee7a5b', 2, { dash: [4, 3], cap: 'round' });
    s.path('M0 0L10 0L10 10Z', '#f5c971', { op: 0.5 });
    s.clip('M60 0h60v80h-60Z', (c) => c.circle(90, 40, 30, '#131a3b'));
    s.place(new Scene(40, 40).rect(0, 0, 20, 20, '#27357a'), 70, 10);
    expect(sha(toSvg(s))).toBe('bc034b7feae69878c587926032a939e8b34e5570');
    const p = new Scene(600, 400);
    field(p, { x: 0, y: 0, u: 100, cols: 6, rows: 4, inks: PALETTES[3]!.inks, motif: 'leaf', seed: 99, hero: { c: 2, r: 0, s: 4 } });
    expect(sha(toSvg(p))).toBe('ce98ebc5383150293062f671bf902b72340352be');
  });

  it('stops are sorted, clamped and pinned to both ends, so pdfkit and SVG hold the end colours alike', () => {
    expect(stopsOf(g).map((s) => s.offset)).toEqual([0, 0.25, 0.75, 1]);
    expect(stopsOf(linear(0, 0, 1, 0, [{ offset: 1.4, color: '#000000' }, { offset: -1, color: '#ffffff' }])).map((s) => [s.offset, s.color])).toEqual([[0, '#ffffff'], [1, '#000000']]);
    expect(stopsOf(linear(0, 0, 1, 0, []))).toEqual([]);
  });

  it('SVG: one definition in <defs>, named after its content, user space, the fill pointing at it', () => {
    const svg = toSvg(new Scene(400, 300).rect(20, 20, 360, 100, g).circle(200, 200, 50, radial(200, 200, 50, [{ offset: 0, color: '#00aa00' }, { offset: 1, color: '#00aa00', opacity: 0 }], { fx: 180, fy: 190 })));
    const ids = [...svg.matchAll(/<(linear|radial)Gradient id="(g[0-9a-z]+)" gradientUnits="userSpaceOnUse"/g)].map((m) => m[2]!);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(svg).toContain(`fill="url(#${id})"`);
    expect(svg).toContain('x1="20" y1="0" x2="380" y2="0"');
    expect(svg).toContain('fx="180" fy="190"');
    expect(svg).toContain('stop-opacity="0.5"');
    expect(svg.indexOf('<defs>')).toBeLessThan(svg.indexOf('<path'));
  });

  it('two scenes inlined in one page never clash: the same gradient keeps its id, another gets its own', () => {
    const idOf = (svg: string) => /Gradient id="([^"]+)"/.exec(svg)![1]!;
    const a = toSvg(new Scene(10, 10).rect(0, 0, 10, 10, g));
    const b = toSvg(new Scene(20, 20).rect(5, 5, 10, 10, g));
    const c = toSvg(new Scene(10, 10).rect(0, 0, 10, 10, linear(20, 0, 380, 0, [{ offset: 0.25, color: '#ff0000' }, { offset: 0.75, color: '#0000fe' }])));
    expect(idOf(a)).toBe(idOf(b));
    expect(idOf(a)).not.toBe(idOf(c));
    expect(toSvg(new Scene(10, 10).rect(0, 0, 10, 10, linear(0, 0, 1, 0, [])))).not.toContain('Gradient');
  });

  it('PDF: an axial and a radial shading, the opacity as a soft mask, and the graphics state left as found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grad-'));
    try {
      const file = join(dir, 'g.pdf');
      const doc = new PDFDocument({ autoFirstPage: false, size: [400, 300], margin: 0, compress: false });
      const out = createWriteStream(file);
      doc.pipe(out);
      doc.addPage();
      const s = new Scene(400, 300).rect(20, 20, 360, 100, g);
      s.place(new Scene(100, 100).circle(50, 50, 40, radial(50, 50, 40, [{ offset: 0, color: '#00aa00' }, { offset: 1, color: '#005500' }])), 100, 150);
      toPdf(doc, s);
      doc.end();
      await finished(out);
      const pdf = readFileSync(file, 'latin1');
      expect(pdf).toMatch(/\/ShadingType 2/);
      expect(pdf).toMatch(/\/ShadingType 3/);
      expect(pdf).toMatch(/\/SMask/);
      expect(pdf).toMatch(/\/Pattern cs/);
      expect((pdf.match(/\bq\b/g) ?? []).length).toBe((pdf.match(/\bQ\b/g) ?? []).length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('survives the films’ path: toSvg, then Skia’s loadImage, paints the ramp', async () => {
    const canvas = await import('@napi-rs/canvas').catch(() => null);
    if (!canvas) return;
    const img = await canvas.loadImage(Buffer.from(toSvg(new Scene(400, 120).rect(20, 10, 360, 100, linear(20, 0, 380, 0, [{ offset: 0.25, color: '#ff0000' }, { offset: 0.75, color: '#0000ff' }])))));
    const c = canvas.createCanvas(400, 120);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = (x: number) => Array.from(ctx.getImageData(x, 60, 1, 1).data);
    expect(px(30)).toEqual([255, 0, 0, 255]);
    expect(px(370)).toEqual([0, 0, 255, 255]);
    const mid = px(200);
    expect(mid[0]).toBeGreaterThan(100);
    expect(mid[2]).toBeGreaterThan(100);
  });
});

describe('silhouettes', () => {
  const all = [...MOTIFS.map((m) => [m, motifShape(m)] as const), ...ORNAMENTS.map((o) => [o, ornament(o, 7)] as const)];

  it('every motif has a body of its own, and every ornament something to draw', () => {
    for (const m of MOTIFS) expect(motifShape(m).body.length, m).toBeGreaterThan(4);
    expect(new Set(MOTIFS.map((m) => JSON.stringify(motifShape(m).body))).size).toBe(MOTIFS.length);
    for (const o of ORNAMENTS) expect(ornament(o).body.length + ornament(o).marks.length, o).toBeGreaterThan(0);
    expect(JSON.stringify(ornament('blob', 1))).not.toBe(JSON.stringify(ornament('blob', 2)));
  });

  it('stays inside its unit box, strokes counted, and fills most of it', () => {
    for (const [name, shape] of all) {
      const b = boundsOf(shape);
      expect(b.x0, name).toBeGreaterThanOrEqual(-0.01);
      expect(b.y0, name).toBeGreaterThanOrEqual(-0.01);
      expect(b.x1, name).toBeLessThanOrEqual(1.01);
      expect(b.y1, name).toBeLessThanOrEqual(1.01);
      expect(Math.max(b.x1 - b.x0, b.y1 - b.y0), name).toBeGreaterThan(0.6);
    }
  });

  it('lands whole inside any box it is placed in, fitted and centred, mirrored or not', () => {
    const box = { x: 37, y: 112, w: 80, h: 140 };
    for (const [name, shape] of all) {
      for (const flip of [false, true]) {
        const at = placer(box, { flip });
        for (const [x, y] of [...samples(shape.body), ...samples(shape.holes), ...samples(shape.marks)].map(([u, v]) => at(u, v))) {
          expect(x, name).toBeGreaterThanOrEqual(box.x - 1);
          expect(x, name).toBeLessThanOrEqual(box.x + box.w + 1);
          expect(y, name).toBeGreaterThanOrEqual(box.y + (box.h - box.w) / 2 - 1);
          expect(y, name).toBeLessThanOrEqual(box.y + (box.h + box.w) / 2 + 1);
        }
      }
      expect(pathD(shape.body, box).startsWith(shape.body.length ? 'M' : ''), name).toBe(true);
    }
  });

  it('draws body, holes, lines and marks in the inks asked, and nothing it was not given', () => {
    const s = new Scene(100, 100);
    drawShape(s, motifShape('pot'), { x: 0, y: 0, w: 100, h: 100 }, { body: '#111111', holes: '#222222', lines: '#333333' });
    const fills = flatPaths(s.ops).map((o) => o.fill ?? o.stroke);
    expect(fills).toEqual(['#111111', '#222222', '#111111']); // the steam is a mark, in the body's ink
    const line = new Scene(100, 100);
    drawShape(line, motifShape('leaf'), { x: 0, y: 0, w: 100, h: 100 }, { outline: '#000000', sw: 2 });
    expect(flatPaths(line.ops).every((o) => !o.fill && o.stroke === '#000000')).toBe(true);
  });
});

describe('the style registry', () => {
  it('knows the eight ids, builds Bauhaus and typo, and draws the others as Bauhaus', () => {
    expect(BUILT_STYLES.slice(0, 2)).toEqual(['bauhaus', 'typo']);
    for (const id of BUILT_STYLES) expect(ART_STYLES).toContain(id);
    for (const id of ART_STYLES) expect(styleDef(id).compositions.length, id).toBeGreaterThanOrEqual(2);
    expect(isBuilt('typo')).toBe(true);
    expect(isBuilt('gothique')).toBe(false);
    for (const id of UNBUILT) expect(isBuilt(id)).toBe(false);
    expect(styleDef(undefined).id).toBe('bauhaus');
    for (const id of UNBUILT) expect(styleDef(id).id).toBe('bauhaus');
  });

  it('a design without style is V1 to the byte, and so is « bauhaus » named', () => {
    const pins = [[3, 'split', 'paw', 'd3b47f356d7b968090a2132d2dc3a8fd69ecc7ce'], [11, 'minimal', 'moon', 'bae3fe12acc1d5d54655834fee5011eacd310511'], [27, 'centered', 'pot', 'c283bb4b3ba35fa5faba5cdfa936ad53282c7ed4']] as const;
    for (const [seed, coverLayout, motif, hash] of pins) {
      const d = { ...designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed }), coverLayout, motif };
      expect(sha(renderCoverSvg(cover(d))), `${seed}`).toBe(hash);
      expect(renderCoverSvg(cover({ ...d, style: 'bauhaus' }))).toBe(renderCoverSvg(cover(d)));
    }
  });

  it('a style not built yet falls back to Bauhaus: the same cover, audit, plate and pick', () => {
    const d = chiot({ coverLayout: 'minimal' });
    for (const style of UNBUILT) {
      expect(renderCoverSvg(cover({ ...d, style }))).toBe(renderCoverSvg(cover(d)));
      expect(coverAudit(cover({ ...d, style }))).toEqual(coverAudit(cover(d)));
      expect(pickArt({ ...d, style }, effort(6))).toEqual(pickArt(d, effort(6)));
      const a = new Scene(600, 200);
      const b = new Scene(600, 200);
      const spec = { x: 0, y: 0, u: 100, cols: 6, rows: 2, inks: d.inks!, motif: d.motif, seed: 5, hero: null, role: 'band' as const };
      drawPlate({ style }, a, spec);
      drawPlate({}, b, spec);
      expect(toSvg(a)).toBe(toSvg(b));
    }
  });

  it('a composition names one of the style’s, wraps round past the count, and without one follows V1’s layout', () => {
    expect(compositionOf(chiot({ coverLayout: 'minimal' }))).toBe(1);
    expect(compositionOf(chiot({ coverLayout: 'badge' }))).toBe(0);
    expect(compositionOf(chiot({ coverLayout: 'split', composition: 1 }))).toBe(1);
    expect(compositionOf(chiot({ style: 'pop', composition: styleDef('pop').compositions.length }))).toBe(0);
    expect(compositionOf(chiot({ style: 'typo', composition: 2 }))).toBe(2);
    expect(compositionOf(chiot({ style: 'typo', composition: -1 }))).toBe(compositionOf(chiot({ style: 'typo' })));
  });
});

describe('designFor and normalizeDesign', () => {
  it('without a look, designFor gives exactly what it gave; with one it keeps it, valid only', () => {
    const input = { nicheName: 'Budget du freelance', category: 'business/argent', seed: 9 };
    const plain = designFor(input);
    expect(plain).not.toHaveProperty('style');
    expect(plain).not.toHaveProperty('composition');
    expect(designFor({ ...input, style: 'typo', composition: 2 })).toEqual({ ...plain, style: 'typo', composition: 2 });
    expect(designFor({ ...input, style: 'gothique' as ArtStyle, composition: 1.5 })).toEqual(plain);
  });

  it('normalizeDesign keeps a valid style and composition, and drops an unknown one', () => {
    const d = chiot();
    expect(normalizeDesign(d)).not.toHaveProperty('style');
    expect(normalizeDesign({ ...d, style: 'riso', composition: 3 })).toMatchObject({ style: 'riso', composition: 3 });
    const bad = normalizeDesign({ ...d, style: 'inconnu' as ArtStyle, composition: -2 });
    expect(bad).not.toHaveProperty('style');
    expect(bad).not.toHaveProperty('composition');
  });
});

describe('typo, « Typo XXL »', () => {
  const typo = styleDef('typo');
  const covers: { input: CoverInput; k: number }[] = [];
  beforeAll(() => {
    PALETTES.forEach((p, pi) => MOTIFS.forEach((motif, mi) => {
      const k = (pi + mi) % typo.compositions.length;
      const d = { ...designFor({ nicheName: 'Guide', category: '', seed: 1 + pi * 37 + mi * 11 }), palette: { ...p.palette }, inks: { ...p.inks }, voice: voiceFor(p.family), motif, style: 'typo' as const, composition: k };
      covers.push({ input: { ...SAMPLE_TITLES[(pi * 3 + mi) % SAMPLE_TITLES.length]!, design: d, brand: 'Pixel Agency' }, k });
    }));
  });

  it('has three compositions, poster, editorial and figure, each its own drawing', () => {
    expect(typo.compositions.map((c) => c.id)).toEqual(['affiche', 'editorial', 'chiffre']);
    const d = chiot({ style: 'typo' });
    expect(new Set([0, 1, 2].map((composition) => renderCoverSvg(cover({ ...d, composition })))).size).toBe(3);
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
      for (const l of meta.lines.filter((x) => x.font === meta.titleFace)) expect(contrast(l.fill, meta.titleGround!), `${where}: ${l.s}`).toBeGreaterThanOrEqual(4.5);
      expect(Buffer.byteLength(svg), where).toBeLessThanOrEqual(150 * 1024);
      expect(ms, where).toBeLessThan(200);
    }
  });

  it('every word of the title is drawn, no line wider than its box, and nothing outside the cover', () => {
    for (const { input } of covers) {
      const { scene, meta } = coverScene(input);
      for (const l of meta.lines) {
        const w = advance(l.font, l.s, l.size, l.track);
        const left = l.anchor === 'end' ? l.x - w : l.x;
        expect(w, l.s).toBeLessThanOrEqual(l.width + 0.01);
        expect(left, l.s).toBeGreaterThanOrEqual(40 - 0.01);
        expect(left + w, l.s).toBeLessThanOrEqual(560 + 0.5);
      }
      const shown = shownWords(renderCoverSvg(input)).replace(/- /g, '-');
      for (const word of input.title.replace(/\s[:—–]\s/g, ' ').split(/\s+/).filter((x) => /\p{L}/u.test(x))) expect(shown.toLowerCase(), word).toContain(word.toLowerCase().replace(/'/g, '’'));
      expect(scene.ops.filter((o) => o.k === 'text').length).toBe(meta.lines.length);
    }
  });

  it('a title is broken for a poster: no hanging article, no number cut from its noun, a compound cut after its hyphen', () => {
    const face = 'fraunces-900-normal';
    const fit = (t: string) => posterBreak(t, face, { width: 520, height: 600, min: 41, max: 168, maxLines: 7, leading: 0.92, cap: 0.7, descent: 0.22, track: -0.012 });
    expect(fit('Chat qui griffe le canapé').lines.some((l) => / le$/.test(l))).toBe(false);
    expect(fit('Freelances : trouver ses 3 premiers clients sur LinkedIn en 30 jours').lines.some((l) => / 3$/.test(l))).toBe(false);
    expect(fit('Micro-entrepreneur').lines).toEqual(['Micro-', 'entrepreneur']);
    expect(fit('Micro-entrepreneur').size).toBeGreaterThan(fit('Microentrepreneur').size);
  });

  it('scores its art on Bauhaus’s scale: the same mean within a point, a close spread, and the cover score neutral too', () => {
    const typoArt: number[] = [];
    const bauhausArt: number[] = [];
    const typoCover: number[] = [];
    const bauhausCover: number[] = [];
    for (let i = 0; i < 300; i++) {
      const d = sampleDesign(i);
      const t = SAMPLE_TITLES[(i * 7) % SAMPLE_TITLES.length]!;
      const b = coverAudit({ ...t, design: d, brand: 'Pixel Agency' });
      bauhausArt.push(b.art);
      bauhausCover.push(coverScore(b));
      const y = coverAudit({ ...t, design: { ...d, style: 'typo', composition: i % 3 }, brand: 'Pixel Agency' });
      typoArt.push(y.art);
      typoCover.push(coverScore(y));
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));
    expect(Math.abs(mean(typoArt) - BAUHAUS_ART.mean)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(mean(typoArt) - mean(bauhausArt))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(sd(typoArt) - sd(bauhausArt))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(mean(typoCover) - mean(bauhausCover))).toBeLessThanOrEqual(1.5);
  });

  it('the designer’s search works on typo as on Bauhaus: candidate 0 is the seed, eight beat one, no world draw', () => {
    const random = Math.random;
    Math.random = () => { throw new Error('no Math.random'); };
    try {
      const first: number[] = [];
      const best: number[] = [];
      for (let seed = 0; seed < 60; seed++) {
        const d = chiot({ seed: seed * 97 + 5, style: 'typo', composition: seed % 3, inks: PALETTES[seed % 15]!.inks });
        expect(pickArt(d, effort(1)).seed).toBe(d.seed);
        first.push(pickArt(d, effort(1)).score);
        best.push(pickArt(d, effort(8)).score);
      }
      expect(best.reduce((a, b) => a + b) / 60).toBeGreaterThanOrEqual(first.reduce((a, b) => a + b) / 60 + 3);
      expect(pickArt(chiot(), effort(3))).toEqual(pickArt(chiot(), effort(3)));
      expect(pickArt(chiot(), effort(3)).score).toBeGreaterThan(0);
      expect(artScore(chiot(), chiot().inks!, 3)).toBe(pickArt(chiot(), effort(1)).score);
    } finally {
      Math.random = random;
    }
  });

  it('the kept art and composition reach the cover: the eye sees more compositions with taste', () => {
    const input = cover(chiot({ style: 'typo' }));
    expect(pickComposition(input, effort(1, 0.4)).explored).toBe(1);
    expect(pickComposition(input, effort(1, 1)).explored).toBe(3);
    const pick = pickComposition(input, effort(1, 1));
    expect(pick.score).toBe(coverScore(coverAudit(cover({ ...input.design, composition: pick.composition }))));
    expect(pickComposition(cover(chiot()), effort(1, 1)).explored).toBe(2);
  });

  it('the same design gives the same bytes, and another art seed another cover', () => {
    const d = chiot({ style: 'typo', composition: 2 });
    expect(renderCoverSvg(cover(d))).toBe(renderCoverSvg(cover({ ...d })));
    expect(renderCoverSvg(cover({ ...d, artSeed: 77 }))).not.toBe(renderCoverSvg(cover(d)));
  });

  it('prints its real text in a PDF, title first, without fonts it still draws every word', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'typo-pdf-'));
    try {
      const { registerVoice } = await import('../src/deliverables/fonts.js');
      const { pdfPagesText } = await import('./pdfText.js');
      const file = join(dir, 'c.pdf');
      const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
      const out = createWriteStream(file);
      doc.pipe(out);
      const { scene, meta } = coverScene(cover(chiot({ style: 'typo', composition: 2 }), { title: 'Stress du bac : 21 jours pour réviser' }));
      registerVoice(doc, meta.voice);
      doc.addPage();
      toPdf(doc, scene, 0, 0, 595.28 / 600);
      doc.end();
      await finished(out);
      const [text] = pdfPagesText(file);
      expect(text).toContain('Stress');
      expect(text!.indexOf('Stress')).toBeLessThan(text!.indexOf('Pour'));
      // the giant figure is art: no stray « 21 » before the title
      expect(text!.indexOf('21')).toBeGreaterThan(text!.indexOf('Stress'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('plates', () => {
  const ROLES: { role: PlateRole; cols: number; rows: number; hero: boolean }[] = [
    { role: 'opener', cols: 6, rows: 4, hero: true }, { role: 'band', cols: 6, rows: 2, hero: false }, { role: 'close', cols: 4, rows: 2, hero: true },
    { role: 'kit', cols: 6, rows: 2, hero: false }, { role: 'film', cols: 6, rows: 11, hero: true },
  ];
  it('every built style draws inside its rectangle, on every role, motif and a few ink sets', () => {
    for (const style of BUILT_STYLES) {
      for (const [pi, motif] of [[0, 'moon'], [4, 'coin'], [9, 'brush'], [13, 'bolt'], [14, 'pot']] as const) {
        const inks = PALETTES[pi]!.inks;
        for (const r of ROLES) {
          const [x, y, u] = [33, 71, 47];
          const s = new Scene(800, 800);
          drawPlate({ style }, s, { x, y, u, cols: r.cols, rows: r.rows, inks, motif, seed: 12 + pi, hero: r.hero ? { c: 1, r: Math.max(0, r.rows - 2), s: 2, pick: 3 } : null, role: r.role });
          const [x1, y1] = [x + r.cols * u, y + r.rows * u];
          const outside = (ops: Op[]): [number, number][] => ops.flatMap((o) => (o.k === 'clip' ? points(o.d) : o.k === 'path' ? points(o.d) : []));
          for (const [px, py] of outside(s.ops)) {
            expect(px, `${style}/${r.role}/${motif}`).toBeGreaterThanOrEqual(x - 1);
            expect(px, `${style}/${r.role}/${motif}`).toBeLessThanOrEqual(x1 + 1);
            expect(py, `${style}/${r.role}/${motif}`).toBeGreaterThanOrEqual(y - 1);
            expect(py, `${style}/${r.role}/${motif}`).toBeLessThanOrEqual(y1 + 1);
          }
        }
      }
    }
  });

  it('typo’s plate is its own: one ground, the motif twice, the same bytes for the same page', () => {
    const spec = { x: 0, y: 0, u: 100, cols: 6, rows: 3, inks: PALETTES[2]!.inks, motif: 'paw' as const, seed: 4, hero: { c: 2, r: 0, s: 3, pick: 2 }, role: 'opener' as const };
    const a = new Scene(600, 300);
    const b = new Scene(600, 300);
    drawPlate({ style: 'typo' }, a, spec);
    drawPlate({ style: 'typo' }, b, spec);
    expect(toSvg(a)).toBe(toSvg(b));
    const c = new Scene(600, 300);
    drawPlate({}, c, spec);
    expect(toSvg(a)).not.toBe(toSvg(c));
    const d = new Scene(600, 300);
    drawPlate({ style: 'typo' }, d, { ...spec, hero: { ...spec.hero, pick: 3 } });
    expect(toSvg(d)).not.toBe(toSvg(a)); // two chapters, two pictures
  });
});
