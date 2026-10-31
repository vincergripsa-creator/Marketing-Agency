/**
 * The other formats (video §3.4, §8, §4.2): each one yields its output, on every ratio, through the real planner and the
 * real compositor. The SVG cuts need nothing installed, the cards a canvas, the films ffmpeg too.
 */
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterAll, describe, expect, it } from 'vitest';
import { createRng } from '../src/core/index.js';
import { renderAdCut, renderAdStoryboard } from '../src/deliverables/storyboard.js';
import { textWidth } from '../src/deliverables/text.js';
import { planCut } from '../src/deliverables/videoCut.js';
import { SAFE_ZONES } from '../src/shared.js';
import type { AdCreative, AdFormat, AdScene, BeatKind, DesignSpec, PdfContent, Product, VideoCut, VideoTempo, VoiceOfCustomer, WorldState } from '../src/shared.js';
import { findFfmpeg } from '../src/video/caps.js';
import { buildRenderSpec, stillFormat, type RenderSpec } from '../src/video/spec.js';
import { estimatedWords, synthesize, type SpokenLine } from '../src/video/speech.js';
import { insideSafe, stageFor, type Rect, type VideoRatio } from '../src/video/stage.js';
import { buildTimeline, settledFrames, TEMPO_BPM } from '../src/video/timeline.js';

const hasCanvas = await import('@napi-rs/canvas').then(() => true, () => false);
const hasPdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').then(() => true, () => false);
const compose = hasCanvas ? await import('../src/video/compose.js') : null;
const narrator = hasCanvas ? await import('../src/video/scenes/narrator.js') : null;
const slide = hasCanvas ? await import('../src/video/scenes/slide.js') : null;
const worker = hasCanvas ? await import('../src/video/worker.js') : null;
const ffmpeg = findFfmpeg() ?? '';

const DESIGN: DesignSpec = {
  palette: { bg: '#f4efe2', primary: '#2f6b46', secondary: '#a9c8a2', accent: '#e0683a', ink: '#23302a', soft: '#e7ecd9' },
  motif: 'leaf', coverLayout: 'split', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 7,
};

const SCENES: AdScene[] = [
  { visual: '', onScreenText: '5 erreurs sur un balcon', voiceover: 'Cinq erreurs tuent ton balcon, et la première surprend tout le monde.', durationSec: 3 },
  { visual: '', onScreenText: '« rien ne pousse chez moi »', voiceover: 'Si toi aussi tu te dis « rien ne pousse chez moi », reste deux secondes.', durationSec: 3 },
  { visual: '', onScreenText: '1. Mesurer le soleil, heure par heure', voiceover: 'La méthode commence par un geste tout simple : mesurer le soleil de ton balcon.', durationSec: 4 },
  { visual: '', onScreenText: 'Le terreau s’épuise', voiceover: 'Un repère à garder en tête : le terreau d’un pot s’épuise vite.', durationSec: 4 },
  { visual: '', onScreenText: 'Bonus : le calendrier', voiceover: 'Dans le guide : le plan et, en cadeau, le calendrier du balcon.', durationSec: 3 },
  { visual: '', onScreenText: 'Guide PDF — lien en bio', voiceover: 'Le guide complet est en lien dans ma bio.', durationSec: 3 },
];
const LONG_TEXT = '1. Noter pendant 3 jours les heures de repas, de siestes et d’accidents, puis établir un planning de sorties toutes les 2 heures en journée, une étape à la fois, sans sauter la suivante';
const NEEDLES = ['Mesurer le soleil de ton balcon', 'Le terreau d’un pot s’épuise vite'];

const CONTENT = {
  title: 'Le balcon en 8 étapes', subtitle: 'Sans jardin', audience: 'Citadins', promise: '', introduction: [], bonus: null, nextStep: null, wordCount: 0,
  chapters: [{ title: 'Le soleil', intro: `${NEEDLES[0]}.`, paragraphs: [`${NEEDLES[1]}.`], steps: [], example: null, checklist: [], visual: null }],
} as unknown as PdfContent;

const PRODUCT = {
  id: 'prd_1', nicheId: 'balcon', title: 'Le balcon en 8 étapes', subtitle: 'Sans jardin', audience: 'Citadins', problem: '', price: 19, status: 'live', version: 1,
  content: CONTENT, design: DESIGN, salesPage: null, files: { pdf: null, cover: null, salesPage: null },
} as unknown as Product;

const VOC = { phrases: ['mon balcon est à l’ombre toute la journée'], bannedClaims: [] } as unknown as VoiceOfCustomer;

function creativeOf(format: AdFormat, over: Partial<AdCreative> = {}): AdCreative {
  return {
    id: `cre_${format}`, productId: PRODUCT.id, hook: '5 erreurs sur un balcon', hookStyle: 'listicle', format, scenes: SCENES, caption: 'Le guide.', hashtags: ['balcon'],
    cta: 'Télécharge le guide (lien en bio)', files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'zoe', ...over,
  };
}

/** A good editor on the day: the beats of video §3.4 in full. */
function planned(format: AdFormat, over: Partial<AdCreative> = {}, tempo: VideoTempo = 'standard', product = PRODUCT): AdCreative {
  const creative = creativeOf(format, over);
  return { ...creative, cut: planCut({ creative, product, voc: VOC, skill: 0.95, tempo, rng: createRng(7) }) };
}

const worldOf = (creative: AdCreative, product = PRODUCT): WorldState => ({ runId: 'p72', company: { name: 'Pixel Agency', creatives: [creative], products: [product] } }) as unknown as WorldState;
const specOf = (creative: AdCreative, ratio: VideoRatio, product = PRODUCT): RenderSpec => buildRenderSpec(worldOf(creative, product), creative.id, ratio);
const kindsOf = (cut: VideoCut): BeatKind[] => cut.beats.map((b) => b.kind);

const tmp = mkdtempSync(join(tmpdir(), 'video-formats-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function board(creative: AdCreative, ratio: VideoRatio): string[] {
  return renderAdCut({ creative, product: PRODUCT, design: DESIGN, brand: 'Pixel Agency', ratio }).frames;
}

const UNESCAPE: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };

/** Every text of a frame as a box, with the same width estimate the layout uses. The cover nested in a pin is a picture. */
function svgBoxes(svg: string): (Rect & { text: string })[] {
  const own = svg.replace(/<svg x=.*?<\/svg>/s, '');
  return [...own.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => {
    const attr = (name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(m[1]!)?.[1];
    const text = m[2]!.replace(/&[#\w]+;/g, (e) => UNESCAPE[e] ?? e);
    const size = Number(attr('font-size'));
    const w = textWidth(text, 'Helvetica-Bold', size) * 1.06;
    const anchor = attr('text-anchor');
    const x = Number(attr('x')) - (anchor === 'middle' ? w / 2 : anchor === 'end' ? w : 0);
    return { text, x, y: Number(attr('y')) - size * 0.8, w, h: size };
  });
}

function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('renderAdCut: plain SVG, every machine', () => {
  const FRAMES: [VideoRatio, number, number][] = [['4:5', 432, 540], ['1:1', 540, 540], ['2:3', 400, 600]];

  it.each(FRAMES)('%s is one frame per scene, at the size the channels asked', (ratio, w, h) => {
    for (const format of ['faceless_voiceover', 'text_slideshow', 'ugc_avatar', 'carousel'] as const) {
      const frames = board(creativeOf(format), ratio);
      expect(frames).toHaveLength(SCENES.length);
      for (const f of frames) expect(f.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"`)).toBe(true);
    }
  });

  it('re-lays the scene out, it does not crop the master: every text reads at its place on every ratio', () => {
    const long = SCENES.map((s, i) => (i === 2 ? { ...s, onScreenText: LONG_TEXT } : s));
    for (const [ratio] of FRAMES) {
      const { w, h, insets } = { '4:5': SAFE_ZONES.meta_feed, '1:1': SAFE_ZONES.square, '2:3': SAFE_ZONES.pinterest }[ratio as '4:5' | '1:1' | '2:3'];
      const frame = FRAMES.find(([r]) => r === ratio)!;
      const k = frame[1] / w;
      for (const format of ['faceless_voiceover', 'text_slideshow', 'ugc_avatar', 'carousel'] as const) {
        for (const svg of board(creativeOf(format, { scenes: long }), ratio)) {
          const boxes = svgBoxes(svg);
          expect(boxes.length).toBeGreaterThan(0);
          for (const b of boxes) {
            expect(b.x, `${ratio} ${format}: ${b.text}`).toBeGreaterThanOrEqual(insets.left * k - 0.5);
            expect(b.x + b.w, `${ratio} ${format}: ${b.text}`).toBeLessThanOrEqual((w - insets.right) * k + 0.5);
            expect(b.y, `${ratio} ${format}: ${b.text}`).toBeGreaterThanOrEqual(insets.top * k - 0.5);
            expect(b.y + b.h, `${ratio} ${format}: ${b.text}`).toBeLessThanOrEqual((h - insets.bottom) * k + 0.5);
          }
        }
      }
    }
  });

  it('shows the scene’s own words, and the button on the last frame only', () => {
    const frames = board(creativeOf('faceless_voiceover'), '4:5');
    expect(frames[0]).toContain('5 erreurs sur un balcon');
    expect(frames.at(-1)).toContain('Télécharge le guide');
    expect(frames.at(-1)).not.toContain('(lien en bio)');
    expect(frames[1]).not.toContain('Télécharge le guide');
  });

  it('carries nothing of TikTok to a feed: no rail, no fake counters, no « Sponsorisé »', () => {
    const master = renderAdStoryboard({ creative: creativeOf('ugc_avatar'), product: PRODUCT, design: DESIGN, brand: 'Pixel Agency' }).frames.join('');
    expect(master).toContain('son original');
    for (const svg of board(creativeOf('ugc_avatar'), '4:5')) {
      expect(svg).not.toContain('son original');
      expect(svg).not.toContain('Sponsorisé');
      expect(svg).not.toContain('#fe2c55');
    }
  });

  it('a pin is one still: the hook over the guide’s own cover, the button', () => {
    const pin = creativeOf('static_image', { hook: 'Le balcon qui pousse tout seul', scenes: [{ visual: '', onScreenText: '5 erreurs sur un balcon', voiceover: '', durationSec: 5 }] });
    for (const [ratio] of FRAMES) {
      const [frame, ...rest] = board(pin, ratio);
      expect(rest).toEqual([]);
      expect(frame).toContain('viewBox="0 0 600 848"');
      expect(frame).toContain('Le balcon en 8 étapes'); // the cover's title
      expect(svgBoxes(frame!).map((b) => b.text).join(' ')).toMatch(/5 erreurs.*balcon.*Télécharge le guide/);
    }
  });

  it('a last card says where to go, not to swipe', () => {
    const svg = board(creativeOf('carousel', { cta: 'Swipe jusqu’au bout et télécharge le guide (lien en bio)' }), '1:1').at(-1)!;
    expect(svg).toContain('>Télécharge le guide<');
    expect(svg).not.toContain('Swipe');
  });

  it('an ad with no media has no frames, and no scene gives no frame', () => {
    expect(board(creativeOf('search_text', { scenes: [] }), '4:5')).toEqual([]);
    expect(board(creativeOf('search_text'), '4:5')).toEqual([]);
    expect(board(creativeOf('faceless_voiceover', { scenes: [] }), '1:1')).toEqual([]);
    expect(board(creativeOf('static_image', { scenes: [] }), '2:3')).toEqual([]);
  });

  it('9:16 answers the master’s frames, unchanged: the same ad, the same bytes', () => {
    const creative = creativeOf('faceless_voiceover');
    expect(board(creative, '9:16')).toEqual(renderAdStoryboard({ creative, product: PRODUCT, design: DESIGN, brand: 'Pixel Agency' }).frames);
    expect(board(creative, '9:16')[0]).toContain('viewBox="0 0 360 640"');
  });

  it('same creative, same bytes, and no canvas or render module behind it', () => {
    expect(board(creativeOf('carousel'), '2:3')).toEqual(board(creativeOf('carousel'), '2:3'));
    const source = readFileSync(new URL('../src/deliverables/storyboard.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '[^']*(video\/|canvas|ffmpeg)/);
  });

  it('the preview says what it is: « Narrateur animé », never an avatar (video §8)', () => {
    const { previewHtml } = renderAdStoryboard({ creative: creativeOf('ugc_avatar'), product: PRODUCT, design: DESIGN, brand: 'Pixel Agency' });
    expect(previewHtml).toContain('Narrateur animé');
    expect(previewHtml).not.toContain('Avatar UGC');
  });
});

describe('the beats of each format', () => {
  it('a slideshow is slides then the end card, silent, and a slide’s text stays the scene’s', () => {
    const cut = planned('text_slideshow').cut!;
    expect(kindsOf(cut)).toEqual(['slide', 'slide', 'slide', 'slide', 'slide', 'end_card']);
    expect(cut.beats.every((b) => b.spoken === '')).toBe(true);
    expect(cut.beats[0]!.screen).toBe(SCENES[0]!.onScreenText);
  });

  it('the narrator says the pain, and the step with the real page next to it', () => {
    const cut = planned('ugc_avatar').cut!;
    expect(kindsOf(cut)).toEqual(['hook', 'narrator', 'narrator', 'page_proof', 'bonus_stack', 'end_card']);
    expect(cut.beats[2]!.proof?.needle).toBe(NEEDLES[0]);
  });

  it('cards are one shot each, and two formats are stills', () => {
    expect(planned('carousel').cut!.beats.every((b) => b.shots === 1)).toBe(true);
    expect((['carousel', 'static_image'] as AdFormat[]).every(stillFormat)).toBe(true);
    expect((['faceless_voiceover', 'text_slideshow', 'ugc_avatar', 'search_text'] as AdFormat[]).some(stillFormat)).toBe(false);
  });

  it('a pin has no cut in the world: the spec gives the renderer one slide, and the world stays as it is', () => {
    const pin = creativeOf('static_image', { cut: null, scenes: [{ visual: '', onScreenText: 'Le hook du pin', voiceover: '', durationSec: 5 }] });
    const spec = specOf(pin, '2:3');
    expect(kindsOf(spec.cut)).toEqual(['slide']);
    expect(spec.cut.beats[0]).toMatchObject({ screen: 'Le hook du pin', spoken: '', shots: 1 });
    expect(pin.cut).toBeNull();
    expect(() => specOf(creativeOf('carousel'), '2:3')).toThrow('no cut');
  });
});

describe('the timeline of a slideshow', () => {
  const bar = (bpm: number): number => 240 / bpm;

  it('cuts hard, on the bar: every slide ends on one, at each tempo', () => {
    for (const tempo of ['calm', 'standard', 'fast'] as const) {
      const { cut } = planned('text_slideshow', {}, tempo);
      const tl = buildTimeline(cut!, cut!.beats.map(() => ({ text: '', voice: null, wav: null, speechSec: 0, words: [] })), TEMPO_BPM[tempo]);
      for (const b of tl.beats.filter((x) => x.kind === 'slide')) {
        const bars = (b.t0 + b.dur) / bar(TEMPO_BPM[tempo]);
        expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-6);
        expect(b.dur).toBeGreaterThanOrEqual(cut!.beats[b.index]!.estSec - 1e-6);
      }
    }
  });

  it('keeps a title card and a voiced ad on the 8th: the bar is for slides', () => {
    const { cut } = planned('faceless_voiceover');
    const tl = buildTimeline(cut!, cut!.beats.map((b) => synthesize([b.spoken], null)[0]!), TEMPO_BPM.standard);
    const first = tl.beats[0]!;
    const eighths = first.dur / (30 / TEMPO_BPM.standard);
    expect(Math.abs(eighths - Math.round(eighths))).toBeLessThan(1e-6);
    expect(Math.abs((first.dur / bar(TEMPO_BPM.standard)) % 1)).toBeGreaterThan(0);
  });

  it('has the music alone: no whoosh on a slideshow, the editor’s SFX on a voiced ad', () => {
    const cut = (over: Partial<VideoCut>): VideoCut => ({ ...planned('text_slideshow').cut!, sfx: true, ...over });
    expect(buildTimeline(cut({}), [], TEMPO_BPM.standard).sfx).toBe(false);
    expect(buildTimeline({ ...planned('faceless_voiceover').cut!, sfx: true }, [], TEMPO_BPM.standard).sfx).toBe(true);
  });
});

describe('mouth and eyes, from the word times', () => {
  const words = [{ text: 'on', at: 0.2, end: 0.6 }, { text: 'plante', at: 0.8, end: 1.2 }];

  it.skipIf(!narrator)('the mouth is shut between the words and opens and closes inside one', () => {
    const open = narrator!.mouthOpen;
    expect(open(words, 0.1)).toBe(0);
    expect(open(words, 0.7)).toBe(0);
    expect(open(words, 1.3)).toBe(0);
    const inside = [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55].map((t) => open(words, t));
    expect(Math.min(...inside)).toBeGreaterThan(0.12);
    expect(Math.max(...inside) - Math.min(...inside)).toBeGreaterThan(0.3);
  });

  it.skipIf(!narrator)('blinks every 3,1 s, wherever the beat falls in the film', () => {
    const eyes = narrator!.eyeOpen;
    expect(eyes(0.5)).toBe(1);
    expect(eyes(3.1 + 0.05)).toBeLessThan(0.2);
    expect(eyes(6.2 + 0.05)).toBeLessThan(0.2);
    expect(eyes(3.3)).toBe(1);
  });
});

describe.skipIf(!compose)('drawn on a canvas', { timeout: 60_000 }, () => {
  async function stageUp(creative: AdCreative, ratio: VideoRatio, opts: { width?: number; product?: Product; pages?: boolean } = {}) {
    const spec = specOf(creative, ratio, opts.product);
    const speech: SpokenLine[] = spec.cut.beats.map((b) => {
      const words = estimatedWords(b.spoken);
      return { text: b.spoken, voice: null, wav: null, speechSec: words.at(-1)?.end ?? 0, words };
    });
    const timeline = buildTimeline(spec.cut, speech, TEMPO_BPM[spec.cut.tempo]);
    const stage = stageFor(ratio, opts.width);
    const assets = await compose!.loadAssets(spec, timeline, stage, tmp, { pages: opts.pages ?? false });
    return { spec, timeline, stage, assets, comp: compose!.createCompositor(timeline, stage, assets) };
  }

  /** Text of a frame, in reading order. */
  const texts = (boxes: readonly { text: string }[]): string => boxes.map((b) => b.text).join(' ');

  describe('slides', () => {
    it('words appear at reading speed, the first one on the cut, and the frame ends with the whole text', async () => {
      const { timeline, comp } = await stageUp(planned('text_slideshow', { scenes: SCENES.map((s) => ({ ...s, onScreenText: LONG_TEXT })) }), '9:16', { width: 540 });
      const b = timeline.beats[1]!;
      const at = (sec: number) => Math.round((b.t0 + sec) * timeline.fps);
      const seen = (sec: number) => comp.drawFrame(at(sec)).filter((x) => x.text !== 'ÉTAPE 1').length;
      expect(seen(0.4)).toBeLessThanOrEqual(2);
      expect(seen(3)).toBeGreaterThan(5);
      expect(seen(3)).toBeLessThan(10);
      const all = LONG_TEXT.split(/\s+/).length;
      expect(seen(b.dur - 0.05)).toBe(all);
    });

    it('a slide on the first frame is not blank: QA reads it at 0,05 s', async () => {
      const { comp, timeline } = await stageUp(planned('text_slideshow'), '9:16', { width: 270 });
      expect(timeline.beats[0]!.kind).toBe('slide');
      comp.drawFrame(1);
      const px = comp.canvas.data();
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < px.length; i += 4) { lo = Math.min(lo, px[i + 1]!); hi = Math.max(hi, px[i + 1]!); }
      expect(hi - lo).toBeGreaterThan(120);
    });

    it('cuts hard: no flash and no punch on a slide, a voiced beat keeps both', async () => {
      const brightness = (px: Uint8ClampedArray | Uint8Array): number => { let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i + 1]!; return sum / (px.length / 4); };
      const flash = async (creative: AdCreative): Promise<number> => {
        const { comp, timeline } = await stageUp(creative, '9:16', { width: 270 });
        const f = Math.round(timeline.beats[1]!.t0 * timeline.fps);
        comp.drawFrame(f);
        const on = brightness(comp.canvas.data());
        comp.drawFrame(f + 3);
        return on - brightness(comp.canvas.data());
      };
      expect(await flash(planned('text_slideshow'))).toBeLessThan(4);
      expect(await flash(planned('faceless_voiceover'))).toBeGreaterThan(8);
    });

    it('a slide draws its plate: not the fact card it stood in for, and a quote sits on the light one', async () => {
      const { comp, timeline } = await stageUp(planned('text_slideshow'), '4:5', { width: 540 });
      const mean = (beat: number): number => {
        const b = timeline.beats[beat]!;
        comp.drawFrame(Math.round((b.t0 + b.dur * 0.7) * timeline.fps));
        const px = comp.canvas.data();
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) sum += px[i + 1]!;
        return sum / (px.length / 4);
      };
      expect(mean(1)).toBeGreaterThan(mean(0) + 60); // « rien ne pousse chez moi »
      expect(texts(comp.drawFrame(Math.round((timeline.beats[1]!.t0 + timeline.beats[1]!.dur - 0.05) * timeline.fps)))).toContain('LU DANS LES COMMENTAIRES');
    });
  });

  describe('the narrator', () => {
    /** Pixels of the open mouth, whatever the shade the vignette gives them. */
    const mouthPixels = (px: Uint8ClampedArray | Uint8Array): number => {
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i]! > 70 && px[i]! < 110 && px[i + 1]! < 50 && px[i + 2]! < 50) n++;
      return n;
    };

    it('is on screen, talks during the words and smiles after them', async () => {
      const { comp, timeline } = await stageUp(planned('ugc_avatar'), '9:16', { width: 540 });
      const b = timeline.beats[1]!;
      expect(b.kind).toBe('narrator');
      const w = b.words[3]!;
      const frame = (sec: number) => Math.round((b.t0 + sec) * timeline.fps);
      comp.drawFrame(frame(w.at + (w.end - w.at) * 0.2));
      const talking = mouthPixels(comp.canvas.data());
      comp.drawFrame(frame(b.speech + 0.11));
      const quiet = mouthPixels(comp.canvas.data());
      expect(talking).toBeGreaterThan(200);
      expect(quiet).toBeLessThan(talking / 10);
    });

    it('holds the beat’s own text and the caption, in the zones, on every ratio', async () => {
      for (const ratio of ['9:16', '4:5', '1:1'] as const) {
        const { comp, timeline, stage } = await stageUp(planned('ugc_avatar', { scenes: SCENES.map((s, i) => (i === 2 ? { ...s, onScreenText: LONG_TEXT } : s)) }), ratio);
        const b = timeline.beats[1]!;
        const boxes = comp.drawFrame(Math.round((b.t0 + b.groups[1]![0]!.at + 0.25) * timeline.fps));
        expect(texts(boxes)).toContain('rien');
        for (const beat of [timeline.beats[1]!, timeline.beats[2]!]) {
          for (const g of beat.groups) {
            for (const box of comp.drawFrame(Math.round((beat.t0 + g[0]!.at + 0.25) * timeline.fps))) expect(insideSafe(stage, box), `${ratio} ${box.text}`).toBe(true);
          }
        }
      }
    });

    it('a step shows the real page of the guide beside it, from the real PDF, and a machine without pages keeps the narrator', async () => {
      await writeGuide(join(tmp, 'guide.pdf'));
      const product = { ...PRODUCT, files: { ...PRODUCT.files, pdf: 'guide.pdf' } } as Product;
      const creative = planned('ugc_avatar');
      const withPages = await stageUp(creative, '9:16', { width: 540, product, pages: hasPdfjs });
      if (hasPdfjs) expect([...withPages.assets.proofs.keys()]).toEqual(expect.arrayContaining([2, 3]));
      const without = await stageUp(creative, '9:16', { width: 540, product, pages: false });
      const b = withPages.timeline.beats[2]!;
      const frame = Math.round((b.t0 + b.dur - 0.1) * withPages.timeline.fps);
      withPages.comp.drawFrame(frame);
      const a = Buffer.from(withPages.comp.canvas.data());
      without.comp.drawFrame(frame);
      const c = without.comp.canvas.data();
      let differ = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - c[i]!) > 24) differ++;
      if (hasPdfjs) expect(differ / (a.length / 4)).toBeGreaterThan(0.03);
      else expect(differ).toBe(0);
    });
  });

  describe('every ratio', () => {
    const LONG_SCENES = SCENES.map((s, i) => (i === 2 ? { ...s, onScreenText: LONG_TEXT } : s));

    it.each([['4:5'], ['1:1'], ['2:3']] as [VideoRatio][])('%s keeps every text box inside its stage, on each format', async (ratio) => {
      for (const format of ['faceless_voiceover', 'ugc_avatar', 'text_slideshow'] as const) {
        const { comp, timeline, stage } = await stageUp(planned(format, { scenes: LONG_SCENES }), ratio);
        let boxes = 0;
        for (const f of settledFrames(timeline)) {
          for (const box of comp.drawFrame(f)) {
            boxes++;
            expect(insideSafe(stage, box), `${ratio} ${format} frame ${f}: ${box.text} ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}×${Math.round(box.h)}`).toBe(true);
          }
        }
        expect(boxes).toBeGreaterThan(10);
      }
    });

    it('the book of a 4:5 hook leaves its text alone', async () => {
      const { comp, timeline, stage } = await stageUp(planned('faceless_voiceover'), '4:5');
      expect(timeline.bookSec).not.toBeNull();
      const b = timeline.beats[0]!;
      const slot = stage.bookSlot;
      for (const f of [0.6, 0.9, 1.2, b.dur - 0.2]) {
        for (const box of comp.drawFrame(Math.round(f * timeline.fps))) {
          expect(box.y + box.h <= slot.y || box.x + box.w <= slot.x, box.text).toBe(true);
        }
      }
    });

    it('a small render of 4:5 stays inside the scaled zones: tests and files read one layout', async () => {
      const { comp, timeline, stage } = await stageUp(planned('text_slideshow'), '4:5', { width: 270 });
      expect([stage.w, stage.h]).toEqual([270, 338]);
      for (const f of settledFrames(timeline)) for (const box of comp.drawFrame(f)) expect(insideSafe(stage, box), box.text).toBe(true);
    });
  });

  describe('cards', () => {
    const dirOf = (name: string): string => { const d = join(tmp, name); mkdirSync(d, { recursive: true }); return d; };

    it.each([['4:5', 540, 676], ['1:1', 540, 540], ['2:3', 540, 810]] as [VideoRatio, number, number][])('a carousel gives one PNG per beat in %s, each at its end state', async (ratio, w, h) => {
      const { comp, timeline } = await stageUp(planned('carousel'), ratio, { width: 540 });
      const dir = dirOf(`deck-${ratio.replace(':', '-')}`);
      const cards = await slide!.renderCards(comp, dir);
      expect(cards.map((c) => c.file)).toEqual(timeline.beats.map((_, i) => `card-${i + 1}.png`));
      for (const c of cards) {
        expect(pngSize(join(dir, c.file))).toEqual({ w, h });
        expect(c.outside).toBe(0);
      }
      expect(texts(cards[0]!.boxes).toLocaleLowerCase('fr-FR')).toContain('5 erreurs sur un balcon');
      expect(texts(cards[2]!.boxes)).toContain('1. Mesurer le soleil, heure par heure');
    });

    it('the last card of a deck says where to go, not to swipe', async () => {
      const { comp } = await stageUp(planned('carousel', { cta: 'Swipe jusqu’au bout et télécharge le guide (lien en bio)' }), '4:5', { width: 540 });
      const last = (await slide!.renderCards(comp, dirOf('swipe'))).at(-1)!;
      expect(texts(last.boxes)).toContain('TÉLÉCHARGE LE GUIDE');
      expect(texts(last.boxes)).not.toContain('SWIPE');
    });

    it('a card is a picture: no progress bar, a place in the deck, an arrow until the last', async () => {
      const gold = (px: Uint8ClampedArray | Uint8Array): number => { let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i]! > 235 && px[i + 1]! > 195 && px[i + 2]! < 110) n++; return n; };
      const deck = await stageUp(planned('carousel'), '4:5', { width: 540 });
      const film = await stageUp(planned('text_slideshow'), '4:5', { width: 540 });
      const last = (t: typeof deck) => Math.round((t.timeline.beats[2]!.t0 + t.timeline.beats[2]!.dur) * t.timeline.fps) - 1;
      const boxes = deck.comp.drawFrame(last(deck));
      const onCard = gold(deck.comp.canvas.data());
      film.comp.drawFrame(last(film));
      expect(gold(film.comp.canvas.data()) - onCard).toBeGreaterThan(300);
      expect(texts(boxes)).toContain(`3/${deck.timeline.beats.length}`);
      expect(texts(film.comp.drawFrame(last(film)))).not.toContain('3/');
    });

    it('a pin is one PNG: the hook, the button, and all of it in the zone of its ratio', async () => {
      const pin = creativeOf('static_image', { cut: null, scenes: [{ visual: '', onScreenText: '5 choses à arrêter si le balcon grille en été', voiceover: '', durationSec: 5 }] });
      for (const [ratio, w, h] of [['2:3', 540, 810], ['4:5', 540, 676], ['1:1', 540, 540]] as [VideoRatio, number, number][]) {
        const { comp } = await stageUp(pin, ratio, { width: 540 });
        const dir = dirOf(`pin-${ratio.replace(':', '-')}`);
        const cards = await slide!.renderCards(comp, dir);
        expect(cards).toHaveLength(1);
        expect(pngSize(join(dir, 'card-1.png'))).toEqual({ w, h });
        expect(cards[0]!.outside).toBe(0);
        expect(texts(cards[0]!.boxes)).toBe('5 CHOSES À ARRÊTER SI LE BALCON GRILLE EN ÉTÉ TÉLÉCHARGE LE GUIDE');
      }
    });

    it('draws the same card twice: a still does not depend on what was drawn before', async () => {
      const { comp } = await stageUp(planned('carousel'), '1:1', { width: 270 });
      const a = await slide!.renderCards(comp, dirOf('twice-a'));
      const b = await slide!.renderCards(comp, dirOf('twice-b'));
      for (const c of a) expect(readFileSync(join(tmp, 'twice-a', c.file)).equals(readFileSync(join(tmp, 'twice-b', c.file)))).toBe(true);
      expect(b).toHaveLength(a.length);
    });
  });
});

/** The two needles on page 2, a page 3 for the fan. */
function writeGuide(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', autoFirstPage: true, compress: false });
    const out = createWriteStream(path);
    out.on('finish', () => resolve());
    out.on('error', reject);
    doc.pipe(out);
    doc.font('Helvetica-Bold').fontSize(32).fillColor('#2f6b46').text('Le balcon en 8 étapes');
    doc.addPage();
    doc.font('Helvetica').fontSize(30).fillColor('#222222').text(`${NEEDLES[0]}. ${NEEDLES[1]}.`, { width: 400 });
    doc.addPage();
    doc.text('Le calendrier.');
    doc.end();
  });
}

describe.skipIf(!worker || !ffmpeg)('the real files, through the worker', { timeout: 120_000 }, () => {
  const render = async (name: string, spec: RenderSpec) => {
    const root = join(tmp, name);
    const dir = join(root, 'video', spec.creativeId, 'k');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec));
    return { root, result: await worker!.renderJob({ dir, root, ffmpeg, pages: false, width: 270 }) };
  };

  it('text_slideshow: an MP4 with the music alone, every check of QA passed', async () => {
    const { root, result } = await render('slideshow', specOf(planned('text_slideshow'), '9:16'));
    expect(result.reason).toBeNull();
    expect(result.qa?.failed).toEqual([]);
    expect(result).toMatchObject({ ok: true, voice: null, cards: [] });
    expect(result.video?.ratio).toBe('9:16');
    expect(existsSync(join(root, result.video!.path))).toBe(true);
  });

  it('ugc_avatar: an MP4 with its narrator, every check of QA passed', async () => {
    const { root, result } = await render('narrator', specOf(planned('ugc_avatar'), '9:16'));
    expect(result.reason).toBeNull();
    expect(result.qa?.failed).toEqual([]);
    expect(existsSync(join(root, result.video!.path))).toBe(true);
  });

  it('a 4:5 cut: the master re-laid out, every check of QA passed', async () => {
    const { root, result } = await render('cut45', specOf(planned('faceless_voiceover'), '4:5'));
    expect(result.reason).toBeNull();
    expect(result.qa?.failed).toEqual([]);
    expect(result.video?.ratio).toBe('4:5');
    expect(existsSync(join(root, result.video!.path))).toBe(true);
  });

  it('a slide held past its last word still moves: QA calls a still frozen at 2,6 s', async () => {
    // One word in a slide of two bars: without its sway, 4 s of this file do not move and QA fails it.
    const beats = ['Stop', 'Plan de 14 jours', 'Stop'].map((screen, scene) => ({ kind: 'slide' as const, scene, spoken: '', screen, estSec: 2.8, shots: 1 }));
    const cut: VideoCut = { v: 1, tempo: 'calm', sfx: false, craft: 80, beats, metrics: { estSec: 8.4, hookWordSec: 0, productSec: null, avgShotSec: 2.8, kinds: 1, captionWords: 6, endHoldSec: 0 } };
    const { result } = await render('held', { ...specOf(planned('text_slideshow'), '9:16'), cut });
    expect(result.reason).toBeNull();
    expect(result.qa?.failed).toEqual([]);
  });

  it('carousel and pin: PNG cards, no film, nothing that needs a voice', async () => {
    const deck = await render('deck', specOf(planned('carousel'), '1:1'));
    expect(deck.result).toMatchObject({ ok: true, video: null, qa: null });
    expect(deck.result.cards).toHaveLength(SCENES.length);
    for (const c of deck.result.cards) expect(existsSync(join(deck.root, c))).toBe(true);
    const pin = creativeOf('static_image', { cut: null, scenes: [SCENES[0]!] });
    const still = await render('pin', specOf(pin, '2:3'));
    expect(still.result.cards).toHaveLength(1);
    expect(pngSize(join(still.root, still.result.cards[0]!))).toEqual({ w: 270, h: 406 });
  });
});
