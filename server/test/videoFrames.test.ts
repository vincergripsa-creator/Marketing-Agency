import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DesignSpec, VideoBeat, VideoCut, WorldState } from '../src/shared.js';
import { detectCaps, findFfmpeg } from '../src/video/caps.js';
import { buildRenderSpec, renderKey, type RenderSpec } from '../src/video/spec.js';
import type { SpokenLine } from '../src/video/speech.js';
import { insideSafe, safeColumn, stageFor, zoneAt, type VideoRatio } from '../src/video/stage.js';
import { BEAT_GAP, buildTimeline, captionGroups, settledFrames, TEMPO_BPM, type Timeline } from '../src/video/timeline.js';

const hasCanvas = await import('@napi-rs/canvas').then(() => true, () => false);
const hasPdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').then(() => true, () => false);
const compose = hasCanvas ? await import('../src/video/compose.js') : null;

const DESIGN: DesignSpec = {
  palette: { bg: '#f4efe2', primary: '#2f6b46', secondary: '#a9c8a2', accent: '#e0683a', ink: '#23302a', soft: '#e7ecd9' },
  motif: 'leaf', coverLayout: 'split', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 7,
};

const NEEDLE = 'Le terreau d’un pot s’épuise vite, il n’a pas la réserve d’un sol de jardin';

const BEATS: VideoBeat[] = [
  { kind: 'title_card', scene: 0, spoken: '', screen: '', estSec: 0.25, shots: 1 },
  { kind: 'hook', scene: 0, spoken: '8 étapes, 8 mois de plan, et le calendrier du balcon.', screen: '8 étapes', estSec: 3.1, shots: 2 },
  { kind: 'pain_bubble', scene: 1, spoken: 'Si toi aussi tu te dis ça, reste deux secondes.', screen: '« balcon plein nord, ça vaut le coup ou pas »', estSec: 2.9, shots: 3, items: ['mon balcon est à l’ombre toute la journée'] },
  { kind: 'page_proof', scene: 2, spoken: 'Un repère à garder en tête : le terreau s’épuise vite.', screen: 'Le terreau', estSec: 3.1, shots: 3, proof: { chapter: 0, needle: NEEDLE } },
  { kind: 'fact_card', scene: 3, spoken: 'La méthode commence par un geste tout simple.', screen: '1. Mesurer le soleil, heure par heure', estSec: 2.8, shots: 2 },
  { kind: 'bonus_stack', scene: 4, spoken: 'Dans le guide : le plan et, en cadeau, le calendrier.', screen: 'Bonus', estSec: 3, shots: 2 },
  { kind: 'end_card', scene: 5, spoken: 'Le guide complet est en lien dans ma bio.', screen: 'Guide PDF', estSec: 3.6, shots: 2 },
];

function cutOf(over: Partial<VideoCut['metrics']> = {}, beats = BEATS): VideoCut {
  return {
    v: 1, tempo: 'standard', beats, sfx: true, craft: 90,
    metrics: { estSec: 18.2, hookWordSec: 0.25, productSec: 0.7, avgShotSec: 1.4, kinds: 6, captionWords: 2, endHoldSec: 1.6, ...over },
  };
}

/** What `synthesize` gives: words 0,32 s apart. */
function spoken(text: string): SpokenLine {
  const words = text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).map((w, i) => ({ text: w, at: i * 0.32, end: (i + 1) * 0.32 })) : [];
  return { text, voice: null, wav: null, speechSec: words.length * 0.32, words };
}

const timelineOf = (cut = cutOf()): Timeline => buildTimeline(cut, cut.beats.map((b) => spoken(b.spoken)), TEMPO_BPM.standard);

const SPEC: RenderSpec = {
  version: 1, runId: 'p62', creativeId: 'cre_1', ratio: '9:16', format: 'faceless_voiceover', hook: '8 étapes', hookStyle: 'listicle',
  cta: 'Télécharge le guide (lien en bio)', cut: cutOf(), voice: null, brand: 'Pixel Agency', title: 'Le balcon en 8 étapes', design: DESIGN, pdf: 'guide.pdf', cover: null,
};

const tmp = mkdtempSync(join(tmpdir(), 'video-frames-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Five pages, the needle wrapped on two lines of the third. */
function writeGuide(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', autoFirstPage: true, compress: false });
    const out = createWriteStream(path);
    out.on('finish', () => resolve());
    out.on('error', reject);
    doc.pipe(out);
    doc.font('Helvetica-Bold').fontSize(32).fillColor('#2f6b46').text('Le balcon en 8 étapes');
    for (const body of ['Avant de commencer, regardez votre balcon.', `Un mot sur la terre. ${NEEDLE}, et il faut le nourrir.`, 'Le calendrier.', 'Fin du guide.']) {
      doc.addPage();
      doc.font('Helvetica').fontSize(30).fillColor('#222222').text(body, { width: 300 });
    }
    doc.end();
  });
}

describe('the stage', () => {
  const master = stageFor('9:16');

  it('holds the two zones of the master: the right rail starts at y 840', () => {
    expect(insideSafe(master, { x: 100, y: 300, w: 900, h: 100 })).toBe(true);
    expect(insideSafe(master, { x: 100, y: 900, w: 700, h: 100 })).toBe(true);
    expect(insideSafe(master, { x: 100, y: 900, w: 900, h: 100 })).toBe(false); // under the rail
    expect(insideSafe(master, { x: 100, y: 700, w: 900, h: 300 })).toBe(false); // fits zone A only
    expect(insideSafe(master, { x: 100, y: 700, w: 700, h: 300 })).toBe(true);
    expect(insideSafe(master, { x: 100, y: 200, w: 100, h: 50 })).toBe(false);  // the platform's top bar
    expect(insideSafe(master, { x: 100, y: 1240, w: 100, h: 50 })).toBe(false); // its caption
    expect(insideSafe(master, { x: 20, y: 300, w: 100, h: 50 })).toBe(false);
  });

  it('scales to a small render, zones included', () => {
    const small = stageFor('9:16', 270);
    expect([small.w, small.h]).toEqual([270, 480]);
    expect(small.zones[1]).toEqual({ x0: 16.25, x1: 220, y0: 210, y1: 312 });
    expect(insideSafe(small, { x: 20, y: 80, w: 200, h: 20 })).toBe(true);
    expect(insideSafe(small, { x: 20, y: 220, w: 230, h: 20 })).toBe(false);
  });

  it.each(['9:16', '4:5', '1:1', '2:3'] as VideoRatio[])('%s: hero box and caption line sit in its zones', (ratio) => {
    const s = stageFor(ratio);
    expect(insideSafe(s, s.heroBox)).toBe(true);
    const zone = zoneAt(s, s.captionY);
    expect(s.captionY).toBeGreaterThan(zone.y0);
    expect(s.captionY).toBeLessThan(zone.y1);
    expect(insideSafe(s, safeColumn(s))).toBe(true);
  });

  it('moves the book out of the text on the square', () => {
    const s = stageFor('1:1');
    expect(s.bookSlot.x).toBeGreaterThanOrEqual(s.heroBox.x + s.heroBox.w);
  });
});

describe('the timeline', () => {
  const eighth = 30 / TEMPO_BPM.standard;

  it('puts every cut on an 8th note of the music, at most one 8th late', () => {
    const tl = timelineOf();
    tl.beats.slice(0, -1).forEach((b) => {
      const end = b.t0 + b.dur;
      expect(Math.abs(end / eighth - Math.round(end / eighth))).toBeLessThan(1e-6);
      if (b.speech) {
        expect(b.dur).toBeGreaterThanOrEqual(b.speech + BEAT_GAP - 1e-9);
        expect(b.dur).toBeLessThan(b.speech + BEAT_GAP + eighth + 1e-9);
      }
    });
  });

  it('holds the end card for the editor’s hold, not for the gap', () => {
    const tl = timelineOf(cutOf({ endHoldSec: 0.6 }));
    const end = tl.beats.at(-1)!;
    expect(end.dur).toBeCloseTo(end.speech + 0.6, 6);
    expect(tl.total).toBeCloseTo(end.t0 + end.dur, 6);
    expect(tl.frames).toBe(Math.round(tl.total * 30));
  });

  it('gives a silent beat its planned length', () => {
    expect(timelineOf().beats[0]!.dur).toBeGreaterThanOrEqual(0.25);
    expect(timelineOf().beats[0]!.dur).toBeLessThan(0.25 + eighth);
    expect(timelineOf().beats[1]!.t0).toBe(timelineOf().beats[0]!.dur);
  });

  it('cuts captions after punctuation, at 3 words, or at 16 characters', () => {
    const groups = (text: string) => captionGroups(spoken(text).words).map((g) => g.map((w) => w.text).join(' '));
    expect(groups('un deux, trois quatre cinq six sept')).toEqual(['un deux,', 'trois quatre', 'cinq six sept']);
    expect(groups('anticonstitutionnellement est long')).toEqual(['anticonstitutionnellement', 'est long']);
  });

  it('gives a weak editor his 6-word line and no pill: it changes the picture', () => {
    const weak = timelineOf(cutOf({ captionWords: 6 }));
    expect(weak.pill).toBe(false);
    expect(Math.max(...weak.beats[2]!.groups.map((g) => g.length))).toBeGreaterThan(3);
    const good = timelineOf();
    expect(good.pill).toBe(true);
    expect(Math.max(...good.beats[2]!.groups.map((g) => g.length))).toBeLessThanOrEqual(3);
  });

  it('brings the guide up in the hook only when the cut planned it, whatever the voice does', () => {
    expect(timelineOf().bookSec).toBeCloseTo(0.45, 6);
    expect(timelineOf(cutOf({ productSec: 7 })).bookSec).toBeNull();
    expect(timelineOf(cutOf({ productSec: null })).bookSec).toBeNull();
  });

  it('plays the shots of the cut, each after the last, the first at 0', () => {
    timelineOf().beats.forEach((b) => {
      expect(b.shotAt[0]).toBe(0);
      expect(b.shotAt.length).toBeLessThanOrEqual(b.shots);
      expect(b.shotAt.length).toBeGreaterThanOrEqual(Math.min(b.shots, 2));
      expect([...b.shotAt].sort((x, y) => x - y)).toEqual(b.shotAt);
      expect(b.shotAt.at(-1)!).toBeLessThan(b.dur);
    });
  });

  it('keeps a settled frame for every group of text, inside the clip', () => {
    const tl = timelineOf();
    const frames = settledFrames(tl);
    expect(frames.length).toBeGreaterThanOrEqual(tl.beats.reduce((n, b) => n + Math.max(1, b.groups.length), 0) - 2);
    expect(Math.max(...frames)).toBeLessThan(tl.frames);
  });
});

describe('the render spec', () => {
  const world = {
    runId: 'r1',
    company: {
      name: 'Pixel Agency',
      creatives: [
        { id: 'cre_1', productId: 'prd_1', hook: '8 étapes', hookStyle: 'listicle', format: 'faceless_voiceover', cta: 'Lien', cut: cutOf() },
        { id: 'cre_2', productId: 'prd_1', hook: 'Sans cut', hookStyle: 'stat', format: 'carousel', cta: 'Lien' },
      ],
      products: [{ id: 'prd_1', title: 'Le balcon', design: DESIGN, files: { pdf: 'files/p/guide.pdf', cover: 'files/p/cover.svg', salesPage: null } }],
    },
    market: { niches: [{ id: 'n', videoTempo: 'fast' }] },
    talentTruth: { secret: true },
  } as unknown as WorldState;

  it('copies what the worker needs, and nothing hidden', () => {
    const spec = buildRenderSpec(world, 'cre_1', '4:5');
    expect(spec).toMatchObject({ runId: 'r1', creativeId: 'cre_1', ratio: '4:5', brand: 'Pixel Agency', pdf: 'files/p/guide.pdf', cover: 'files/p/cover.svg', voice: null });
    expect(JSON.stringify(spec)).not.toMatch(/videoTempo|talentTruth|secret/);
  });

  it('refuses a creative it cannot render', () => {
    expect(() => buildRenderSpec(world, 'cre_9', '9:16')).toThrow('no creative');
    expect(() => buildRenderSpec(world, 'cre_2', '9:16')).toThrow('no cut');
  });

  it('keys on the cut, the ratio, the voice and the design, and on nothing else', () => {
    const base = buildRenderSpec(world, 'cre_1', '9:16');
    expect(renderKey(base)).toBe(renderKey(buildRenderSpec(world, 'cre_1', '9:16')));
    expect(renderKey(base)).toMatch(/^[0-9a-f]{40}$/);
    expect(renderKey({ ...base, ratio: '4:5' })).not.toBe(renderKey(base));
    expect(renderKey({ ...base, voice: 'Hortense' })).not.toBe(renderKey(base));
    expect(renderKey({ ...base, cut: { ...base.cut, tempo: 'fast' } })).not.toBe(renderKey(base));
    expect(renderKey({ ...base, design: { ...base.design, seed: 8 } })).not.toBe(renderKey(base));
    expect(renderKey({ ...base, version: base.version + 1 })).not.toBe(renderKey(base));
    expect(renderKey({ ...base, hook: 'autre' })).toBe(renderKey(base));
  });
});

describe('the ladder', () => {
  const saved = { ...process.env };
  afterAll(() => { process.env = saved; });
  const clean = () => { process.env = { ...saved }; delete process.env.FFMPEG_PATH; delete process.env.VIDEO_FORCE_LEVEL; };

  it('finds no ffmpeg with an empty PATH and no static binary, and says so', () => {
    clean();
    process.env.PATH = '';
    process.env.Path = '';
    expect(findFfmpeg({ bundled: null })).toBeNull();
  });

  it('refuses a binary that does not run', () => {
    clean();
    process.env.PATH = '';
    process.env.Path = '';
    process.env.FFMPEG_PATH = join(tmp, 'no-such-ffmpeg');
    expect(findFfmpeg({ bundled: null })).toBeNull();
  });

  it.each([['no_voice', 'Sans voix sur cette machine'], ['no_pages', 'Sans pages du guide'], ['storyboard_only', 'Indisponible : ffmpeg introuvable']])('VIDEO_FORCE_LEVEL=%s lands on that step', async (level, reason) => {
    clean();
    process.env.VIDEO_FORCE_LEVEL = level;
    const caps = await detectCaps();
    if (!caps.ffmpeg && level !== 'storyboard_only') return; // a machine with nothing
    expect(caps.level).toBe(level);
    expect(caps.reason).toBe(reason);
  });

  it('ignores a level that is not on the ladder', async () => {
    clean();
    process.env.VIDEO_FORCE_LEVEL = 'nonsense';
    expect((await detectCaps()).level).not.toBe('nonsense');
  });
});

describe.skipIf(!hasPdfjs || !hasCanvas)('real pages of the guide', () => {
  const pdf = join(tmp, 'guide.pdf');
  beforeAll(() => writeGuide(pdf));
  const open = async () => (await import('../src/video/pdfPages.js')).openGuide(pdf);

  it('finds a sentence on its real page, across a line wrap, whatever the apostrophes', async () => {
    const guide = await open();
    expect(guide.pages).toBe(5);
    const hit = guide.findNeedle(NEEDLE)!;
    expect(hit.page).toBe(3);
    expect(hit.boxes.length).toBeGreaterThan(1); // one box a line
    for (const box of hit.boxes) {
      expect(box.w).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThan(420);
      expect(box.y).toBeGreaterThan(0);
    }
    expect(hit.boxes[1]!.y).toBeGreaterThan(hit.boxes[0]!.y); // from the top of the page
    expect(guide.findNeedle('le terreau d\'un POT')?.page).toBe(3);
    await guide.close();
  });

  it('points pdf.js at its fonts with a path Node can read: a file:// URL fails in silence', async () => {
    const dir = (await import('../src/video/pdfPages.js')).standardFontDir()!;
    expect(dir.endsWith('/')).toBe(true);
    expect(existsSync(`${dir}LiberationSans-Regular.ttf`)).toBe(true);
  });

  it('says no for a sentence that is not in the guide', async () => {
    const guide = await open();
    expect(guide.findNeedle('Cette phrase n’existe nulle part')).toBeNull();
    expect(guide.findNeedle('   ')).toBeNull();
    await guide.close();
  });

  it('draws a real page, its boxes in points whatever the scale', async () => {
    const guide = await open();
    const page = await guide.pageImage(3, 1.5);
    expect(page.img.width).toBe(Math.round(page.w * 1.5));
    expect([Math.round(page.w), Math.round(page.h)]).toEqual([595, 842]);
    const pixels = page.img.getContext('2d').getImageData(0, 0, page.img.width, page.img.height).data;
    let inked = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 100) inked++;
    expect(inked).toBeGreaterThan(1000);
    await guide.close();
  });
});

describe.skipIf(!compose)('the frames', { timeout: 30_000 }, () => {
  const STAGE_W = 270;
  const pdf = join(tmp, 'frames-guide.pdf');
  beforeAll(() => writeGuide(pdf));

  const make = async (tl = timelineOf(), opts: { pages?: boolean; spec?: Partial<RenderSpec>; ratio?: VideoRatio; width?: number } = {}) => {
    const stage = stageFor(opts.ratio ?? '9:16', opts.width ?? STAGE_W);
    const spec = { ...SPEC, pdf: 'frames-guide.pdf', ...opts.spec };
    const assets = await compose!.loadAssets(spec, tl, stage, tmp, opts);
    return { comp: compose!.createCompositor(tl, stage, assets), assets, stage };
  };

  const luma = (px: Uint8Array) => {
    const values: number[] = [];
    for (let i = 0; i < px.length; i += 4) values.push(0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!);
    return values;
  };
  const sha = (px: Uint8Array) => createHash('sha1').update(px).digest('hex');
  const share = (a: Uint8Array, b: Uint8Array) => {
    let moved = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) > 12) moved++;
    return moved / (a.length / 4);
  };
  const frameOf = (tl: Timeline, kind: string, at = 0.6) => {
    const b = tl.beats.find((x) => x.kind === kind)!;
    return Math.round((b.t0 + b.dur * at) * tl.fps);
  };

  it('draws frame 0 and a mid frame at 270×480, neither of them blank', async () => {
    const { comp } = await make();
    expect([comp.canvas.width, comp.canvas.height]).toEqual([270, 480]);
    comp.drawFrame(0);
    const first = Uint8Array.from(comp.canvas.data());
    expect(first.length).toBe(270 * 480 * 4);
    comp.drawFrame(Math.floor(comp.timeline.frames / 2));
    const mid = Uint8Array.from(comp.canvas.data());
    for (const px of [first, mid]) {
      const l = luma(px);
      expect(l.reduce((a, b) => Math.max(a, b)) - l.reduce((a, b) => Math.min(a, b))).toBeGreaterThan(60);
      expect(new Set(l.map(Math.round)).size).toBeGreaterThan(12);
      expect(px.filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true); // ffmpeg reads opaque pixels
    }
    expect(share(first, mid)).toBeGreaterThan(0.2);
  });

  it('text outside a zone fails insideSafe, text inside passes', async () => {
    const { comp, stage } = await make();
    comp.drawFrame(10);
    const held = comp.drawFrame(frameOf(comp.timeline, 'fact_card'));
    const count = held.length;
    comp.drawText('DANS LA ZONE', 100, 700);
    comp.drawText('SOUS LE RAIL', 950, 1000);
    comp.drawText('EN HAUT', 100, 100);
    const [good, rail, top] = held.slice(count) as [typeof held[number], typeof held[number], typeof held[number]];
    expect(insideSafe(stage, good)).toBe(true);
    expect(insideSafe(stage, rail)).toBe(false);
    expect(insideSafe(stage, top)).toBe(false);
    expect(good.x).toBeGreaterThan(24); // device space: logical 100 at a quarter of the size, plus the glyph's bearing
    expect(good.x).toBeLessThan(29);
  });

  it.each(['9:16', '4:5', '1:1', '2:3'] as VideoRatio[])('%s: at rest, every text of every beat sits in the zones', async (ratio) => {
    const { comp, stage } = await make(timelineOf(), { ratio });
    const proof = compose!.textProof(comp);
    const boxes = proof.frames.flatMap((f) => [...f.boxes]);
    expect(boxes.length).toBeGreaterThan(proof.frames.length); // no frame hides behind an empty ledger
    expect(boxes.filter((b) => !insideSafe(stage, b))).toEqual([]);
    expect(proof.inside(boxes[0]!)).toBe(true);
    expect(proof.redraw(proof.frames[0]!.frame).length).toBe(stage.w * stage.h * 4);
  });

  // A real hook failed QA here: Anton's accented capitals rise far above their line, the more so the bigger they are.
  it.each(['9:16', '4:5', '1:1', '2:3'] as VideoRatio[])('%s: the accent of a big hook stays in the zone', async (ratio) => {
    const hooks = ['5 erreurs à éviter, 6 étapes à suivre, 14 jours de plan.', 'Étapes.', 'Évitez ça.', 'À éviter à Évreux, Île, Âge, Être.'];
    for (const line of hooks) {
      const tl = timelineOf(cutOf({}, [{ ...BEATS[1]!, spoken: line }, BEATS[6]!]));
      const { comp, stage } = await make(tl, { ratio, pages: false });
      const hook = tl.beats[0]!;
      for (let f = 0; f < Math.round(hook.dur * tl.fps); f++) { // every frame: a word lands after the group's sampled one
        expect(comp.drawFrame(f).filter((b) => !insideSafe(stage, b)), `${line} frame ${f}`).toEqual([]);
      }
    }
  });

  it('keeps a French closing mark on its line, and a plate clear of its caption', async () => {
    // One length or another fills a line exactly: that is when a lone » would open the next one.
    const words = 'on est au cinquième sans ascenseur je fais comment pour la sortie du matin avec lui'.split(' ');
    for (let n = 2; n <= words.length; n++) {
      const screen = `« ${words.slice(0, n).join(' ')} »`;
      const tl = timelineOf(cutOf({}, [BEATS[1]!, { ...BEATS[4]!, screen }, BEATS[6]!]));
      const { comp, stage } = await make(tl, { pages: false });
      const boxes = comp.drawFrame(frameOf(tl, 'fact_card'));
      expect(boxes.filter((b) => /^[»?!:;]/.test(b.text)), screen).toEqual([]);
      const plate = boxes.filter((b) => b.text !== b.text.toLocaleUpperCase('fr-FR'));
      expect(Math.max(...plate.map((b) => b.y + b.h)), screen).toBeLessThan(stage.captionY - 20);
    }
  });

  it('a long phrase shrinks to stay in the zones, a long word too', async () => {
    const huge = [{
      ...BEATS[1]!, spoken: 'Anticonstitutionnellement, hexakosioihexekontahexaphobie et autres mots interminables du dimanche.',
    }, {
      ...BEATS[2]!, screen: `« ${'mon balcon est à l’ombre toute la journée '.repeat(3)}»`, items: ['et encore plus long que cela, avec un second avis qui ne finit jamais vraiment'],
    }, BEATS[6]!];
    const tl = timelineOf(cutOf({}, huge));
    const { comp, stage } = await make(tl, { spec: { cta: 'Télécharge le guide complet tout de suite maintenant (lien en bio)' } });
    const proof = compose!.textProof(comp);
    expect(proof.frames.flatMap((f) => [...f.boxes]).filter((b) => !insideSafe(stage, b))).toEqual([]);
  });

  it('one frame is one picture: drawn twice, in any order, the same bytes', async () => {
    const { comp } = await make();
    const f = frameOf(comp.timeline, 'bonus_stack');
    comp.drawFrame(f);
    const once = sha(comp.canvas.data());
    comp.drawFrame(3);
    comp.drawFrame(f);
    expect(sha(comp.canvas.data())).toBe(once);
  });

  it('a page proof draws the real page, and falls back on a plate without it', async () => {
    const tl = timelineOf();
    const real = await make(tl);
    expect([...real.assets.proofs.keys()]).toEqual([3]);
    expect(real.assets.proofs.get(3)!.page).toBe(3);
    expect(real.assets.fan.length).toBeGreaterThan(0);
    const none = await make(tl, { pages: false });
    expect(none.assets.proofs.size).toBe(0);
    const f = frameOf(tl, 'page_proof');
    real.comp.drawFrame(f);
    const page = Uint8Array.from(real.comp.canvas.data());
    const boxes = none.comp.drawFrame(f);
    expect(share(page, none.comp.canvas.data())).toBeGreaterThan(0.15);
    expect(boxes.map((b) => b.text)).toContain('REPÈRE');
    const unread = await make(tl, { spec: { pdf: 'no-such-guide.pdf' } });
    expect(unread.assets.proofs.size).toBe(0);
    unread.comp.drawFrame(f);
  });

  it('the guide rises in the hook for a good editor and stays away for a weak one', async () => {
    const good = timelineOf();
    const weak = timelineOf(cutOf({ productSec: 8 }));
    const a = await make(good);
    const b = await make(weak);
    const f = frameOf(good, 'hook', 0.9);
    a.comp.drawFrame(f);
    const hook = Uint8Array.from(a.comp.canvas.data());
    b.comp.drawFrame(f);
    expect(share(hook, b.comp.canvas.data())).toBeGreaterThan(0.03);
  });

  it('a shot change is a real jump of the camera, inside a beat', async () => {
    const { comp } = await make();
    const b = comp.timeline.beats.find((x) => x.kind === 'bonus_stack')!;
    const cut = Math.round((b.t0 + b.shotAt[1]!) * 30);
    comp.drawFrame(cut - 3);
    const before = Uint8Array.from(comp.canvas.data());
    comp.drawFrame(cut + 7);
    expect(share(before, comp.canvas.data())).toBeGreaterThan(0.1);
  });

  it('the end card shows no progress bar and no caption, the other beats do', async () => {
    const tl = timelineOf();
    const { comp } = await make(tl);
    const texts = comp.drawFrame(frameOf(tl, 'end_card', 0.9)).map((b) => b.text);
    expect(texts).toEqual(['TÉLÉCHARGE LE GUIDE', 'Lien en bio']);
    const fact = tl.beats.find((b) => b.kind === 'fact_card')!;
    const word = fact.groups[1]![0]!;
    expect(comp.drawFrame(Math.round((fact.t0 + word.at + 0.25) * 30)).map((b) => b.text)).toContain(word.text.toLocaleUpperCase('fr-FR'));
  });

  it('renders every frame source for the encoder, at the right size', async () => {
    const tl = timelineOf(cutOf({}, [BEATS[1]!, BEATS[6]!]));
    const { comp, stage } = await make(tl);
    let n = 0;
    for (const frame of comp.rgbaFrames()) {
      expect(frame.byteLength).toBe(stage.w * stage.h * 4);
      n++;
    }
    expect(n).toBe(tl.frames);
  });

  it('a missing cover is a plain card, never a crash', async () => {
    const dir = join(tmp, 'bare');
    await mkdir(dir, { recursive: true });
    const assets = await compose!.loadAssets({ ...SPEC, pdf: null, cover: null }, timelineOf(), stageFor('9:16', STAGE_W), dir);
    expect(assets.cover.w).toBe(600);
    writeFileSync(join(dir, 'cover.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="424"><rect width="300" height="424" fill="#2f6b46"/></svg>');
    const svg = await compose!.loadAssets({ ...SPEC, pdf: null, cover: 'cover.svg' }, timelineOf(), stageFor('9:16', STAGE_W), dir);
    expect(svg.cover.w).toBe(300);
    expect(existsSync(join(dir, 'cover.svg'))).toBe(true);
  });

  // Anton's latin subset has no Ÿ. No hook of ours needs it: Skia falls back on another face for that one glyph.
  it('draws French capitals, Œ included, in all three faces', async () => {
    const { FONT_DIR } = await import('../src/video/fonts.js');
    const fontkit = await import('fontkit');
    for (const file of ['anton-latin-400-normal.woff', 'montserrat-latin-800-normal.woff', 'montserrat-latin-600-normal.woff']) {
      const face = fontkit.create(readFileSync(join(FONT_DIR, file)));
      const missing = [...'ÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŒàâäçéèêëîïôöùûüÿœ«»’0123456789'].filter((c) => !face.hasGlyphForCodePoint(c.codePointAt(0)!));
      expect(missing, file).toEqual([]);
    }
  });
});
