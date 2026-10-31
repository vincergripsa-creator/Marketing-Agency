import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import PDFDocument from 'pdfkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DesignEffort, DesignSpec, InkSet, PdfContent, Product, WorldState } from '../src/shared.js';
import type { RunPaths } from '../src/contracts.js';
import { artCandidate, artScore, coverHero, coverScore, fieldArt, pickArt, scoreField } from '../src/deliverables/art/evaluate.js';
import { field, GROUNDS, groundsOf, HERO_CELL, shapeInk, type HeroPlace } from '../src/deliverables/art/field.js';
import { HEROES, placeHero } from '../src/deliverables/art/heroes.js';
import { DRAWN_AS, heartD } from '../src/deliverables/art/tiles.js';
import { COVER_TITLE_MAX_CHARS, coverAudit, coverScene, renderCoverSvg, splitTitle, titleBlock, type CoverInput } from '../src/deliverables/cover.js';
import { contrast } from '../src/deliverables/color.js';
import { designFor, MOTIFS, normalizeDesign, PALETTES } from '../src/deliverables/design.js';
import { advance, faceOf, registerVoice, setFontDir } from '../src/deliverables/fonts.js';
import { coverAudit as moduleAudit, pickArt as modulePick } from '../src/deliverables/index.js';
import { Scene, toPdf, type Op } from '../src/deliverables/scene.js';
import { VOICES } from '../src/deliverables/voices.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { benchFor, scoreCandidates, TEST_BY_SKILL, testDeliverable } from '../src/runtime/talent/challenge.js';
import { TALENT } from '../src/runtime/talent/constants.js';
import { drawCandidates } from '../src/runtime/org/hiring.js';
import { roleHolders } from '../src/runtime/org/officers.js';
import { mean } from '../src/runtime/util.js';
import { pdfPagesText } from './pdfText.js';

const INKS = PALETTES.map((p) => p.inks);
const INK_SET = INKS[0]!;
const DRAWN = ['moon', 'sun', 'paw', 'heart', 'leaf', 'coin', 'chart', 'home'] as const;
const LAYOUTS = ['centered', 'split', 'badge', 'minimal'] as const;
const VOICE_IDS = ['conte', 'dossier', 'atelier', 'signal'] as const;
const LONG_TITLE = 'Un chiot propre en quelques semaines, même en appartement : la méthode simple pour les propriétaires d’un chiot de 2 à 6 mois';
const LONG_PLAIN = 'Un chiot propre en quelques semaines même en appartement avec la méthode simple pour les propriétaires pressés d’un chiot de 2 à 6 mois';

const design = (over: Partial<DesignSpec> = {}): DesignSpec => ({ ...designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed: 3 }), ...over });
const cover = (over: Partial<DesignSpec> = {}, input: Partial<CoverInput> = {}): CoverInput =>
  ({ title: 'Chiot propre en 21 jours', subtitle: 'Le plan heure par heure', audience: 'Nouveaux maîtres d’un chiot', design: design(over), brand: 'Pixel Agency', ...input });
const effort = (covers: number, taste = 1): DesignEffort => ({ covers, taste, layouts: 2, finish: 1 });

function colorsOf(ops: Op[], out = new Set<string>(), flat = { ok: true }): { colors: Set<string>; flat: boolean } {
  for (const o of ops) {
    if (o.k === 'clip') colorsOf(o.ops, out, flat);
    else if (o.k === 'path') {
      if (o.fill) out.add(o.fill);
      if (o.stroke) out.add(o.stroke);
      if (o.op !== undefined) flat.ok = false;
    }
  }
  return { colors: out, flat: flat.ok };
}

const textOps = (s: Scene) => s.ops.filter((o): o is Extract<Op, { k: 'text' }> => o.k === 'text');

/** Every line a reader gets from the SVG, the root's whole title left out: what is really drawn. */
const shownWords = (svg: string): string => [...svg.matchAll(/<path aria-label="([^"]*)"/g)].map((m) => m[1]!).join(' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** The cells next to the hero, by row and column. */
const heroEdge = (g: number[][]) => g.flatMap((row, r) => row.flatMap((v, c) => (v !== HERO_CELL && [g[r]![c + 1], g[r]![c - 1], g[r + 1]?.[c], g[r - 1]?.[c]].includes(HERO_CELL) ? [v] : [])));

describe('the field', () => {
  const shapes: { cols: number; rows: number; hero: HeroPlace | null }[] = [
    { cols: 6, rows: 5, hero: coverHero(5) }, { cols: 6, rows: 4, hero: coverHero(4) },
    { cols: 6, rows: 4, hero: { c: 0, r: 0, s: 3 } }, { cols: 6, rows: 2, hero: null },
  ];

  it('no two neighbouring tiles share a ground, across 200 seeds', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const shape of shapes) {
        const s = new Scene(600, 500);
        field(s, { x: 0, y: 0, u: 100, ...shape, inks: INK_SET, motif: DRAWN[seed % DRAWN.length]!, seed });
        const g = s.meta!.grounds;
        g.forEach((row, r) => row.forEach((v, c) => {
          if (v === HERO_CELL) return;
          expect(v, `graine ${seed}, ${r}:${c}`).not.toBe(row[c + 1]);
          expect(v, `graine ${seed}, ${r}:${c}`).not.toBe(g[r + 1]?.[c]);
        }));
      }
    }
  });

  it('no tile shares the ground of the hero it touches, so the hero never bleeds out of its box', () => {
    for (const motif of DRAWN) {
      const banned = GROUNDS.indexOf(HEROES[motif].ground);
      for (let seed = 0; seed < 100; seed++) {
        const edge = heroEdge(groundsOf({ cols: 6, rows: 5, seed, hero: coverHero(5) }, HEROES[motif].ground));
        expect(edge.length).toBeGreaterThan(0);
        expect(edge).not.toContain(banned);
      }
    }
  });

  it('five inks only and flat: no opacity, on every hero and every ink set', () => {
    for (const inks of INKS) {
      for (const motif of DRAWN) {
        const s = new Scene(600, 500);
        field(s, { x: 0, y: 0, u: 100, cols: 6, rows: 5, inks, motif, seed: 11, hero: coverHero(5) });
        const { colors, flat } = colorsOf(s.ops);
        expect(flat, motif).toBe(true);
        expect([...colors].filter((c) => !Object.values(inks).includes(c)), motif).toEqual([]);
      }
    }
  });

  it('a shape reads on its tile: on every ink set, whatever ground and whatever draw', () => {
    for (const inks of INKS) {
      for (const ground of GROUNDS) {
        const best = Math.max(...GROUNDS.filter((k) => k !== ground).map((k) => contrast(inks[k], inks[ground])));
        for (let draw = 0; draw < 1; draw += 0.05) {
          const ink = shapeInk(inks, ground, draw);
          expect(ink).not.toBe(inks[ground]);
          expect(contrast(ink, inks[ground]), `${inks.paper} ${ground}`).toBeGreaterThanOrEqual(Math.min(1.5, best));
        }
      }
    }
  });

  it('is a pure function of its seed, and two seeds give two fields', () => {
    const art = (seed: number) => {
      const s = new Scene(600, 500);
      field(s, { x: 0, y: 0, u: 100, cols: 6, rows: 5, inks: INK_SET, motif: 'paw', seed, hero: coverHero(5) });
      return JSON.stringify(s.ops);
    };
    expect(art(5)).toBe(art(5));
    expect(art(5)).not.toBe(art(6));
  });

  it('the 4-row and the 5-row field of a seed are one field: what `pickArt` sees is what the title gets', () => {
    const agree = Array.from({ length: 200 }, (_, seed) => {
      const five = groundsOf({ cols: 6, rows: 5, seed, hero: null }, 'ink');
      const four = groundsOf({ cols: 6, rows: 4, seed, hero: null }, 'ink');
      return JSON.stringify(five.slice(0, 4)) === JSON.stringify(four);
    });
    expect(agree.every(Boolean)).toBe(true);
  });

  it('tiles speak the hero: each family draws from its own bag, weighted', () => {
    const kinds = (motif: DesignSpec['motif']) => {
      const seen = new Map<number, number>();
      for (let seed = 0; seed < 300; seed++) {
        const s = new Scene(600, 500);
        field(s, { x: 0, y: 0, u: 100, cols: 6, rows: 5, inks: INK_SET, motif, seed, hero: coverHero(5) });
        for (const k of s.meta!.kinds) seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      const total = [...seen.values()].reduce((a, b) => a + b, 0);
      return [...seen].sort((a, b) => a[0] - b[0]).map(([, v]) => v / total);
    };
    const leaf = kinds('leaf'); // vesica .50, quarter .22, arcs .16, dots .12
    expect(leaf).toHaveLength(4);
    expect(leaf[0]).toBeCloseTo(0.5, 1);
    expect(kinds('coin')).toHaveLength(4);
    expect(kinds('moon')).toHaveLength(5);
    expect(kinds('paw')[0]).toBeCloseTo(0.36, 1);
  });
});

describe('the heroes', () => {
  it('eight drawings carry the 14 motifs, by the aliases of the plan', () => {
    expect(Object.keys(HEROES).sort()).toEqual([...MOTIFS].sort());
    expect(new Set(Object.values(HEROES).map((h) => h.draw)).size).toBe(8);
    const aliases = { sparkle: 'sun', pot: 'leaf', bolt: 'chart', book: 'chart', dumbbell: 'coin', brush: 'home' } as const;
    for (const [motif, drawn] of Object.entries(aliases)) {
      expect(DRAWN_AS[motif as DesignSpec['motif']]).toBe(drawn);
      expect(HEROES[motif as DesignSpec['motif']]).toBe(HEROES[drawn]);
    }
  });

  it('is the same drawing at every scale, and two heroes never draw alike', () => {
    const shape = (motif: DesignSpec['motif'], size: number) => {
      const s = new Scene(size, size);
      placeHero(s, motif, { x: 0, y: 0, size }, INK_SET, 7);
      return s.ops;
    };
    for (const motif of DRAWN) expect(shape(motif, 200).length, motif).toBe(shape(motif, 400).length);
    expect(new Set(DRAWN.map((m) => JSON.stringify(shape(m, 300)))).size).toBe(8);
  });

  it('stays on its ground, cropped by its box', () => {
    for (const motif of DRAWN) {
      const s = new Scene(600, 600);
      placeHero(s, motif, { x: 100, y: 50, size: 300 }, INK_SET, 7);
      expect(s.ops[0]).toMatchObject({ k: 'path', fill: INK_SET[HEROES[motif].ground] });
      expect(s.ops[1]).toMatchObject({ k: 'clip', d: 'M100 50h300v300h-300Z' });
    }
  });

  it('another ground swaps two inks: still five, and nothing the drawing cut out of its ground is lost', () => {
    const s = new Scene(300, 300);
    placeHero(s, 'leaf', { x: 0, y: 0, size: 300 }, INK_SET, 7, 'b'); // the leaf wears `a` and draws leaves in `b`
    const { colors } = colorsOf(s.ops);
    expect(s.ops[0]).toMatchObject({ fill: INK_SET.b });
    expect(colors).toContain(INK_SET.a);
    expect([...colors].filter((c) => !Object.values(INK_SET).includes(c))).toEqual([]);
    const f = new Scene(600, 400);
    field(f, { x: 0, y: 0, u: 100, cols: 6, rows: 4, inks: INK_SET, motif: 'moon', seed: 3, hero: { c: 2, r: 0, s: 4, ground: 'b' } });
    expect(heroEdge(f.meta!.grounds)).not.toContain(GROUNDS.indexOf('b'));
  });

  it('the constructed heart has two lobes over one point, centred, as wide as asked', () => {
    const d = heartD(100, 100, 80);
    const xs = [...d.matchAll(/[MLC]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeCloseTo(60, 0);
    expect(Math.max(...xs)).toBeCloseTo(140, 0);
    expect(d.match(/M/g)).toHaveLength(3);
  });
});

describe('what art is worth', () => {
  it('reads the formula: balance, rhythm and focus from the grounds alone', () => {
    const inks: InkSet = { paper: '#ffffff', ink: '#000000', a: '#000000', b: '#ffffff', c: '#000000' };
    // a, ink, b, c, paper as targeted, every neighbour black on white where it can be: nothing weak on the row
    const row = [0, 2, 1, 3, 4];
    expect(scoreField([row], inks, 'ink')).toBeCloseTo(0.4 * 100 * (1 - (0.04 + 0.04 + 0 + 0 + 0.08) / 0.9) + 0.3 * 100 * (1 - 1 / 4) + 0.3 * 100, 5);
    const blackWhite: number[][] = [[HERO_CELL, 2], [0, 4]];
    const allNear = 100 * ((1 + 1 + 1 / 7) / 3); // white on black is full focus, black on black the floor: a contrast of 1
    const balance = 100 * Math.max(0, 1 - (Math.abs(1 / 3 - 0.24) + 0.24 + Math.abs(1 / 3 - 0.2) + 0.2 + Math.abs(1 / 3 - 0.12)) / 0.9);
    const rhythm = 100 * (1 - 1 / 2); // a under the hero, b above paper: one of two pairs is flat
    expect(scoreField(blackWhite, inks, 'ink')).toBeCloseTo(0.4 * balance + 0.3 * rhythm + 0.3 * allNear, 5);
  });

  it('the mean of the best of 8 beats a first idea by 5 points or more, on 100 seeds', () => {
    const first: number[] = [];
    const best: number[] = [];
    for (let seed = 0; seed < 100; seed++) {
      const d = design({ seed: seed * 97 + 5, motif: DRAWN[seed % DRAWN.length]!, inks: INKS[seed % INKS.length]! });
      first.push(pickArt(d, effort(1)).score);
      best.push(pickArt(d, effort(8)).score);
    }
    expect(mean(best)).toBeGreaterThanOrEqual(mean(first) + 5);
  });

  it('pays on both shapes of cover, not on their mean alone', () => {
    const gain = (rows: number) => mean(Array.from({ length: 100 }, (_, seed) => {
      const d = normalizeDesign(design({ seed: seed * 89 + 1 }));
      return fieldArt(d, d.inks!, pickArt(d, effort(8)).seed, rows) - fieldArt(d, d.inks!, pickArt(d, effort(1)).seed, rows);
    }));
    expect(gain(4)).toBeGreaterThan(8); // a seed judged on the 5-row shape alone gives 6 here
    expect(gain(5)).toBeGreaterThan(5);
  });

  it('a full eye keeps the true best, a weak one sometimes keeps a worse candidate', () => {
    let missed = 0;
    for (let seed = 0; seed < 100; seed++) {
      const d = normalizeDesign(design({ seed }));
      const truth = Array.from({ length: 8 }, (_, i) => artScore(d, d.inks!, artCandidate(seed, i)));
      expect(pickArt(d, effort(8, 1)).score).toBe(Math.max(...truth));
      if (pickArt(d, effort(8, 0.4)).score < Math.max(...truth)) missed += 1;
    }
    expect(missed).toBeGreaterThan(10);
    expect(missed).toBeLessThan(100);
  });

  it('a rework digs further: it keeps the same ideas, and sees more of them', () => {
    const d = design({ seed: 42 });
    expect(pickArt(d, effort(3)).explored).toBe(3);
    expect(pickArt(d, effort(0)).explored).toBe(1);
    for (let seed = 0; seed < 50; seed++) {
      const x = design({ seed });
      expect(pickArt(x, effort(5)).score).toBeGreaterThanOrEqual(pickArt(x, effort(3)).score);
    }
  });

  it('candidate 0 is the design’s own seed: a first idea is the art of a design with no `artSeed`, and asks for no draw', () => {
    const d = normalizeDesign(design({ seed: 1234 }));
    expect(pickArt(d, effort(1)).seed).toBe(1234);
    expect(pickArt(d, effort(6))).toEqual(pickArt({ ...d }, effort(6)));
    const random = Math.random;
    Math.random = () => { throw new Error('no Math.random'); };
    try {
      pickArt(d, effort(6));
      coverAudit(cover());
    } finally {
      Math.random = random;
    }
  });

  it('cover = 0.5 art + 0.35 thumb + 0.15 balance, thumbnail full marks from 13 px', () => {
    const a = { art: 80, thumbPx: 15, lineBalance: 60, contrast: 12, titleLines: 3 };
    expect(coverScore(a)).toBeCloseTo(40 + 35 + 9, 5);
    expect(coverScore({ ...a, thumbPx: 13 })).toBe(coverScore(a));
    expect(coverScore({ ...a, thumbPx: 10 })).toBeCloseTo(40 + 17.5 + 9, 5);
    expect(coverScore({ ...a, thumbPx: 6 })).toBeCloseTo(40 + 9, 5);
  });

  it('a long SEO title has a measured cost, on the real layout', () => {
    const short = coverAudit(cover({ coverLayout: 'split' }, { title: 'Chiot propre' }));
    const long = coverAudit(cover({ coverLayout: 'split' }, { title: LONG_PLAIN }));
    expect(long.thumbPx).toBeLessThan(short.thumbPx);
    expect(short.thumbPx).toBe((62 * 150) / 600);
    expect(long.titleLines).toBeGreaterThan(short.titleLines);
    expect(coverScore({ ...long, art: short.art })).toBeLessThan(coverScore(short));
    expect(short.contrast).toBeGreaterThanOrEqual(9);
  });

  it('the kept art really reaches the audit, on a cover with a field and on one without', () => {
    for (const coverLayout of ['split', 'minimal'] as const) {
      const scores = new Set(Array.from({ length: 8 }, (_, artSeed) => coverAudit(cover({ coverLayout, artSeed })).art));
      expect(scores.size, coverLayout).toBeGreaterThan(1);
    }
  });

  it('the audit agrees with `fieldArt`, for the row count the title earned', () => {
    const d = normalizeDesign(design({ coverLayout: 'split', seed: 9 }));
    expect(coverAudit(cover({ coverLayout: 'split', seed: 9 }, { title: 'Chiot propre' })).art).toBe(fieldArt(d, d.inks!, 9, 5));
    expect(coverAudit(cover({ coverLayout: 'split', seed: 9 }, { title: LONG_PLAIN })).art).toBe(fieldArt(d, d.inks!, 9, 4));
  });

  it('is wired behind the module', () => {
    expect(modulePick).toBe(pickArt);
    expect(moduleAudit).toBe(coverAudit);
  });
});

describe('the title', () => {
  it('every word stays: the head goes big, what follows « : » or « — » goes to the deck', () => {
    expect(splitTitle('Reprendre la course après 40 ans : 12 semaines sans se blesser')).toEqual({ head: 'Reprendre la course après 40 ans', tail: '12 semaines sans se blesser' });
    expect(splitTitle('Micro-entrepreneur — déclarer sans se tromper')).toEqual({ head: 'Micro-entrepreneur', tail: 'Déclarer sans se tromper' });
    expect(splitTitle('Le chiot propre')).toEqual({ head: 'Le chiot propre', tail: '' });
    expect(splitTitle('Bébé : la nuit').tail).toBe(''); // a head of 4 letters is not a title: nothing to split
  });

  it('an empty title reads « Guide pratique », a title past 140 characters is cut on a whole word', () => {
    expect(coverScene(cover({}, { title: '' })).meta.titleLines.join(' ').replace(/\s/g, ' ')).toBe('Guide pratique');
    const huge = `${LONG_PLAIN} vivant en appartement, avec un planning compatible avec le travail`;
    expect(huge.length).toBeGreaterThan(COVER_TITLE_MAX_CHARS);
    const block = titleBlock({ title: huge, face: VOICES.conte.display }, 520, 62);
    expect(block.lines.join(' ')).toMatch(/…$/);
    expect(block.lines.join(' ')).not.toMatch(/……|\s(?:en|de|la|le|les|pour)…$/);
  });

  it('« Micro-entrepreneur » is never cut in two, in any voice, on either layout', () => {
    for (const voice of VOICE_IDS) {
      for (const coverLayout of ['split', 'minimal'] as const) {
        const { meta } = coverScene(cover({ voice, coverLayout }, { title: 'Micro-entrepreneur' }));
        expect(meta.titleLines, `${voice}/${coverLayout}`).toEqual(['Micro-entrepreneur']);
      }
    }
  });
});

describe('the cover', () => {
  const lines = (input: CoverInput) => coverScene(input).meta.lines;

  it('renders every layout, voice and title with all its words, and no line wider than its box', () => {
    for (const coverLayout of LAYOUTS) {
      for (const voice of VOICE_IDS) {
        for (const title of [LONG_TITLE, LONG_PLAIN, 'Micro-entrepreneur', 'Chiot propre en 21 jours']) {
          const input = cover({ coverLayout, voice }, { title });
          const where = `${coverLayout}/${voice}/${title.slice(0, 20)}`;
          const { scene, meta } = coverScene(input);
          expect(textOps(scene), where).toHaveLength(meta.lines.length);
          for (const l of meta.lines) {
            const w = advance(l.font, l.s, l.size, l.track);
            const left = l.anchor === 'end' ? l.x - w : l.x;
            expect(w, `${where}: ${l.s}`).toBeLessThanOrEqual(l.width + 0.01);
            expect(left, `${where}: ${l.s}`).toBeGreaterThanOrEqual(40 - 0.01);
            expect(left + w, `${where}: ${l.s}`).toBeLessThanOrEqual(560 + 0.01);
          }
          const shown = shownWords(renderCoverSvg(input));
          for (const word of title.split(' ').filter((t) => t !== ':')) expect(shown, `${where}: ${word}`.toLowerCase()).toMatch(new RegExp(`(^| )${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
        }
      }
    }
  });

  it('stays clear of its art: the title stops above the audience, the audience beside the hero', () => {
    const audience = 'Nouveaux propriétaires d’un chiot de 2 à 6 mois vivant en appartement avec un petit balcon et un budget très serré, sans jardin, sans cour et sans voisin arrangeant';
    // five rows of art and a deck of two lines: here the height binds, not the line count
    const tall = 'Reprendre la course à pied après 40 ans : le plan de douze semaines pour courir sans se blesser ni se décourager en chemin';
    for (const title of [LONG_TITLE, LONG_PLAIN, tall]) {
      for (const voice of VOICE_IDS) {
        const split = coverScene(cover({ coverLayout: 'split', voice }, { title, audience }));
        const art = split.meta.rows * 100;
        for (const l of split.meta.lines) expect(l.y - l.size, l.s).toBeGreaterThanOrEqual(art);
        const foot = split.meta.lines.find((l) => l.s.startsWith('Pour'))!;
        const above = split.meta.lines.filter((l) => l.y < foot.y);
        expect(Math.max(...above.map((l) => l.y + l.size * 0.2)), `${voice}: le titre descend sur le public`).toBeLessThanOrEqual(foot.y - foot.size);

        const typo = coverScene(cover({ coverLayout: 'minimal', voice }, { title }));
        const hero = 848 - 300;
        for (const l of typo.meta.lines) {
          const right = l.anchor === 'end' ? l.x : l.x + advance(l.font, l.s, l.size, l.track);
          if (l.y > hero) expect(right, l.s).toBeLessThanOrEqual(300);
          else expect(l.y, l.s).toBeLessThanOrEqual(hero - 6);
        }
      }
    }
  });

  it('holds any brand and any audience on the line given to them', () => {
    const brand = 'La Très Grande Agence Internationale de Conseil en Marketing Numérique et en Stratégie de Marque';
    const audience = 'Nouveaux propriétaires d’un chiot de 2 à 6 mois vivant en appartement avec un petit balcon, un budget serré et deux enfants qui rentrent de l’école à 16 h 30 chaque jour de la semaine, sans jardin ni cour ni voisin pour le garder pendant les vacances scolaires';
    for (const [coverLayout, maxLines] of [['split', 2], ['minimal', 4]] as const) {
      const all = lines(cover({ coverLayout }, { brand, audience }));
      for (const l of all) expect(advance(l.font, l.s, l.size, l.track), l.s).toBeLessThanOrEqual(l.width + 0.01);
      const start = all.findIndex((x) => x.s.startsWith('Pour'));
      const foot = all.slice(start).map((l) => l.s);
      expect(foot.length, coverLayout).toBeLessThanOrEqual(maxLines);
      expect(foot.join(' '), coverLayout).not.toMatch(/…|\s(?:de|en|et|avec|vivant|à)$/u);
      expect(foot.join(' '), coverLayout).not.toContain('vacances scolaires');
    }
  });

  it('says « GUIDE PRATIQUE », the audience once, and nothing a template would say', () => {
    const svg = renderCoverSvg(cover({ coverLayout: 'split' }));
    const shown = shownWords(svg);
    expect(shown).toContain('GUIDE PRATIQUE');
    expect(shown).not.toContain('GUIDE PDF');
    expect(shown.match(/Nouveaux maîtres/g)).toHaveLength(1);
    expect(shown).not.toMatch(/Méthode pas à pas|Checklists|Exemples/);
    expect(shown).toContain('PIXEL AGENCY');
  });

  it('the subtitle is the deck of a title with no tail, as a whole clause, never a third line', () => {
    const subtitle = 'Le plan heure par heure pour les nouveaux maîtres, sans punition, sans cris, sans tapis intelligent, et avec un carnet que toute la famille peut remplir chaque soir de la semaine';
    const deck = lines(cover({ coverLayout: 'split' }, { title: 'Chiot propre', subtitle })).filter((l) => l.font === VOICES.conte.displayIt);
    expect(deck.length).toBeGreaterThan(0);
    expect(deck.length).toBeLessThanOrEqual(2);
    expect(deck.map((l) => l.s).join(' ')).not.toMatch(/…/);
    const tailWins = lines(cover({ coverLayout: 'split' }, { title: 'Chiot propre en 21 jours : sans punition', subtitle })).filter((l) => l.font === VOICES.conte.displayIt);
    expect(tailWins.map((l) => l.s).join(' ').replace(/\s/g, ' ')).toBe('Sans punition');
  });

  it('a long head leaves a row of art to the text, a short one does not', () => {
    expect(coverScene(cover({ coverLayout: 'split' }, { title: 'Chiot propre en 21 jours' })).meta.rows).toBe(5);
    expect(coverScene(cover({ coverLayout: 'split' }, { title: LONG_PLAIN })).meta.rows).toBe(4);
  });

  it('`split` is the only field: `centered` and `badge` wear it, `minimal` has none', () => {
    const svg = (coverLayout: DesignSpec['coverLayout']) => renderCoverSvg(cover({ coverLayout }));
    expect(svg('centered')).toBe(svg('split'));
    expect(svg('badge')).toBe(svg('split'));
    expect(svg('minimal')).not.toBe(svg('split'));
    expect(coverScene(cover({ coverLayout: 'split' })).scene.meta).not.toBeNull();
    expect(coverScene(cover({ coverLayout: 'minimal' })).scene.meta).toBeNull();
  });

  it('wears the art the designer kept, whatever its first seed', () => {
    const base = cover({ coverLayout: 'split', seed: 5 });
    expect(renderCoverSvg(base)).toBe(renderCoverSvg(cover({ coverLayout: 'split', seed: 5, artSeed: 5 })));
    expect(renderCoverSvg(cover({ coverLayout: 'split', seed: 5, artSeed: 77 }))).not.toBe(renderCoverSvg(base));
    expect(shownWords(renderCoverSvg(cover({ coverLayout: 'split', seed: 5, artSeed: 77 })))).toBe(shownWords(renderCoverSvg(base)));
    expect(renderCoverSvg(cover({ coverLayout: 'split', seed: 6, artSeed: 77 }))).toBe(renderCoverSvg(cover({ coverLayout: 'split', seed: 5, artSeed: 77 })));
  });

  it('old saves render: no voice, no inks, an unknown motif', () => {
    const { voice: _voice, inks: _inks, ...old } = design();
    const svg = renderCoverSvg(cover({}, { design: { ...old, motif: 'inconnu' as never } }));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(shownWords(svg)).toContain('Chiot propre');
  });

  it('is self-contained: no <text>, no gradient, no font, no image, no external reference', () => {
    for (const motif of MOTIFS) {
      for (const coverLayout of ['split', 'minimal'] as const) {
        const svg = renderCoverSvg(cover({ motif, coverLayout }, { title: LONG_TITLE }));
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 848" width="600" height="848" role="img"'), motif).toBe(true);
        expect(svg, motif).not.toMatch(/<text|Gradient|<filter|<image|<use|font-family|url\((?!#)|href=|@import|<script/);
        expect(svg, motif).toContain(' aria-label="Un chiot propre en quelques semaines');
      }
    }
  });

  it('without fonts it still draws, in the standard set, every word as text', () => {
    const empty = mkdtempSync(join(tmpdir(), 'no-fonts-'));
    try {
      setFontDir(empty);
      const svg = renderCoverSvg(cover({ coverLayout: 'split' }));
      expect(svg).toContain('font-family="Times, serif"');
      expect(svg).toContain('Chiot propre');
      expect(coverAudit(cover()).titleLines).toBeGreaterThan(0);
    } finally {
      setFontDir();
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('the same scene prints real text in a PDF, title first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cover-pdf-'));
    try {
      for (const voice of VOICE_IDS) {
        const file = join(dir, `${voice}.pdf`);
        const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
        const out = createWriteStream(file);
        doc.pipe(out);
        const { scene, meta } = coverScene(cover({ voice }, { title: 'Efficace et propre : une œuvre' }));
        registerVoice(doc, meta.voice);
        doc.addPage();
        toPdf(doc, scene, 0, 0, 595.28 / 600);
        doc.end();
        await finished(out);
        const [text] = pdfPagesText(file);
        expect(text, voice).toContain('Efficace et propre');
        expect(text, voice).toContain('Une œuvre');
        expect(text!.indexOf('Efficace'), voice).toBeLessThan(text!.indexOf('Pour'));
        expect(faceOf(meta.voice.display).font).toBeTruthy();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the design test (D16)', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });

  async function lab(): Promise<{ world: WorldState; ctx: RuntimeCtx }> {
    const world = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90 }), 'test-art');
    const root = mkdtempSync(join(tmpdir(), 'pixel-art-'));
    roots.push(root);
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const brain = createBrainVault(paths);
    await brain.init();
    const company = new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain });
    return { world, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx };
  }

  function live(w: WorldState, seed: number, d: DesignSpec | null = designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed })): Product {
    const product: Product = {
      id: `prd_${w.company.products.length + 1}`, nicheId: w.market.niches[0]!.id, title: 'Le chiot fait ses besoins partout : 6 étapes concrètes', subtitle: '', audience: 'Nouveaux maîtres', problem: '', price: 19,
      status: 'live', version: 1, content: { title: 't' } as PdfContent, design: d, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null,
      createdDay: 1, launchedDay: 1, stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
    };
    w.company.products.push(product);
    return product;
  }

  it('has its row: par 75, and a real sitter gets the real cover score, the world untouched', async () => {
    const { world: w, ctx } = await lab();
    expect(TEST_BY_SKILL.design?.par()).toBe(TALENT.par['design:visual']);
    const product = live(w, 3);
    const sitter = roleHolders(w, 'art_director')[0]!;
    const before = JSON.stringify(w);
    const result = (await testDeliverable(benchFor(ctx, 'design'), sitter, 0))!;
    expect(JSON.stringify(w)).toBe(before);
    const seen = result.work[0] as { seed: number; explored: number; art: number };
    const audit = coverAudit({ title: product.title, subtitle: '', audience: product.audience, design: { ...product.design!, artSeed: seen.seed }, brand: w.company.name });
    expect(result.score).toBe(coverScore(audit));
    expect(result.deliverable).toContain(`art ${Math.round(audit.art)}/100`);
    expect(seen.art).toBe(audit.art);
  });

  it('reports the cover, never how far the eye searched: that count is the hidden talent read out (A21)', async () => {
    const { world: w, ctx } = await lab();
    const product = live(w, 3);
    const sitter = roleHolders(w, 'art_director')[0]!;
    const truth = w.talentTruth!.agents[sitter.id]!;
    const sits: { t: number; explored: number; seed: number; text: string }[] = [];
    for (const t of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
      truth.talent.design = t;
      const result = (await testDeliverable({ ...benchFor(ctx, 'design'), product }, sitter, 0))!;
      const seen = result.work[0] as { seed: number; explored: number };
      sits.push({ t, explored: seen.explored, seed: seen.seed, text: result.deliverable });
    }
    expect(new Set(sits.map((s) => s.explored)).size).toBe(sits.length);
    const sameArt = sits.filter((s, i) => sits.some((o, j) => i !== j && o.seed === s.seed));
    expect(sameArt.length).toBeGreaterThan(1);
    for (const s of sameArt) expect(s.text, `t ${s.t}`).toBe(sits.find((o) => o.seed === s.seed)!.text);
    for (const s of sits) expect(s.text).not.toMatch(/piste/);
  });

  it('a stronger eye scores higher, on the same products', async () => {
    const { world: w, ctx } = await lab();
    const sitter = roleHolders(w, 'art_director')[0]!;
    const truth = w.talentTruth!.agents[sitter.id]!;
    const atTalent = async (t: number): Promise<number> => {
      truth.talent.design = t;
      const scores: number[] = [];
      for (const p of w.company.products) {
        const bench = { ...benchFor(ctx, 'design'), product: p };
        scores.push((await testDeliverable(bench, sitter, 0))!.score);
      }
      return mean(scores);
    };
    for (let seed = 0; seed < 40; seed++) live(w, seed * 31 + 2);
    expect(await atTalent(0.9)).toBeGreaterThan((await atTalent(0.1)) + 2);
  });

  it('a candidate for a designer’s job sits it, and gets a number and what they drew', async () => {
    const { world: w, ctx } = await lab();
    live(w, 3);
    const candidates = drawCandidates(ctx, 'cover_designer', 0, 3);
    const before = JSON.stringify(w);
    await scoreCandidates(ctx, 'cover_designer', candidates);
    expect(JSON.stringify(w)).toBe(before);
    for (const c of candidates) {
      expect(c.deliverable).toMatch(/^Couverture de « .+ » : art \d+\/100$/);
      expect(c.interview).toBeGreaterThan(0);
      expect(c.interview).toBeLessThanOrEqual(100);
    }
  });

  it('nothing to redraw, no test: 50, per D16', async () => {
    const { world: w, ctx } = await lab();
    live(w, 3, null);
    const candidates = drawCandidates(ctx, 'cover_designer', 0, 2);
    await scoreCandidates(ctx, 'cover_designer', candidates);
    expect(candidates.map((c) => [c.interview, c.deliverable])).toEqual([[50, null], [50, null]]);
  });
});
