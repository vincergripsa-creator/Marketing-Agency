import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contrast, mix } from '../src/deliverables/color.js';
import { normalizeDesign, PALETTES } from '../src/deliverables/design.js';
import type { DesignSpec, VideoBeat, VideoCut, WorldState } from '../src/shared.js';
import { detectCaps, findFfmpeg } from '../src/video/caps.js';
import { buildRenderSpec, renderKey, type RenderSpec } from '../src/video/spec.js';
import { estimatedWords, type SpokenLine } from '../src/video/speech.js';
import { insideSafe, safeColumn, stageFor, zoneAt, type Stage, type VideoRatio } from '../src/video/stage.js';
import { BEAT_GAP, buildTimeline, captionGroups, plannedCuts, priceAt, settledFrames, TEMPO_BPM, type Timeline } from '../src/video/timeline.js';
import type { Compositor } from '../src/video/compose.js';

const hasCanvas = await import('@napi-rs/canvas').then(() => true, () => false);
const hasPdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').then(() => true, () => false);
const compose = hasCanvas ? await import('../src/video/compose.js') : null;
const hook = hasCanvas ? await import('../src/video/scenes/hook.js') : null;
const proofScene = hasCanvas ? await import('../src/video/scenes/proof.js') : null;

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
  cta: 'Télécharge le guide (lien en bio)', cut: cutOf(), voice: null, brand: 'Pixel Agency', title: 'Le balcon en 8 étapes', design: DESIGN, pdf: 'guide.pdf', cover: null, price: null, reviews: {},
};

const tmp = mkdtempSync(join(tmpdir(), 'video-frames-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Five pages, the needle wrapped on two lines of the third. `width` and `size` set its column: a real guide's is 340 pt wide, at 11 pt. */
function writeGuide(path: string, width = 300, size = 30, lead = 'Un mot sur la terre.'): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', autoFirstPage: true, compress: false });
    const out = createWriteStream(path);
    out.on('finish', () => resolve());
    out.on('error', reject);
    doc.pipe(out);
    doc.font('Helvetica-Bold').fontSize(32).fillColor('#2f6b46').text('Le balcon en 8 étapes');
    for (const body of ['Avant de commencer, regardez votre balcon.', `${lead} ${NEEDLE}, et il faut le nourrir.`, 'Le calendrier.', 'Fin du guide.']) {
      doc.addPage();
      doc.font('Helvetica').fontSize(size).fillColor('#222222').text(body, { width });
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

  it.each(['9:16', '4:5', '1:1', '2:3'] as VideoRatio[])('%s: a caption sits low in its zone, not under the title', (ratio) => {
    const s = stageFor(ratio);
    const zone = zoneAt(s, s.captionY);
    expect(zone.y1 - s.captionY).toBeLessThan(60);
    expect(s.captionY).toBeGreaterThan(s.heroBox.y + s.heroBox.h);
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

  it('gives a weak editor their 6-word line and no pill: it changes the picture', () => {
    const weak = timelineOf(cutOf({ captionWords: 6 }));
    expect(weak.pill).toBe(false);
    expect(Math.max(...weak.beats[2]!.groups.map((g) => g.length))).toBeGreaterThan(3);
    const good = timelineOf();
    expect(good.pill).toBe(true);
    expect(Math.max(...good.beats[2]!.groups.map((g) => g.length))).toBeLessThanOrEqual(3);
  });

  it('the spoken word sits on its pill up to 3 words a caption, the band every kinetic cut lives in', () => {
    expect(timelineOf(cutOf({ captionWords: 3 })).pill).toBe(true);
    expect(timelineOf(cutOf({ captionWords: 2 })).pill).toBe(true);
    expect(timelineOf(cutOf({ captionWords: 4 })).pill).toBe(false);
  });

  it('brings the guide up early only when the cut planned it, whatever the voice does; a kinetic hook lands on it, a plain one has none', () => {
    expect(timelineOf().bookSec).toBeCloseTo(0.45, 6);
    expect(timelineOf(cutOf({ productSec: 7 })).bookSec).toBeCloseTo(1.2, 6);
    expect(timelineOf(cutOf({ productSec: null })).bookSec).toBeCloseTo(1.2, 6);
    expect(timelineOf(cutOf({ productSec: 7, captionWords: 6 })).bookSec).toBeNull();
    expect(timelineOf(cutOf({ productSec: null, captionWords: 6 })).bookSec).toBeNull();
    expect(timelineOf(cutOf({ productSec: 7 }, [{ ...BEATS[1]!, estSec: 1.5 }, BEATS[6]!])).bookSec).toBeCloseTo(0.9, 6); // a short hook: on its last words
    expect(timelineOf(cutOf({ productSec: 7 }, [{ ...BEATS[4]!, kind: 'slide' }, BEATS[6]!])).bookSec).toBeNull(); // a slide has no guide to raise
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

  it('counts each screen of a hook as the cut it is: QA holds the file to what the film really does', () => {
    const screens = 'Un chiot perdu, un balcon nu, un plan vide, une nuit blanche.';
    const tl = timelineOf({ ...cutOf({ captionWords: 6 }, [{ ...BEATS[1]!, shots: 1, spoken: screens, screen: '' }, BEATS[6]!]) });
    const hook = tl.beats[0]!;
    expect(hook.groups).toHaveLength(4);
    expect(plannedCuts(tl)).toBe(4 + tl.beats[1]!.shotAt.length); // a plain hook: nothing hits, the screens are its cuts
    const plain = timelineOf(cutOf({}, [BEATS[4]!, BEATS[6]!]));
    expect(plannedCuts(plain)).toBe(plain.beats.reduce((n, b) => n + b.shotAt.length, 0));
  });

  it('counts a word that hits as the cut QA sees, past a plain editor: a long screen is no still', () => {
    const line = 'Cinq erreurs tuent ton balcon avant la fin de la saison';
    const tl = timelineOf(cutOf({}, [{ ...BEATS[1]!, shots: 1, spoken: `${line}.`, screen: line }, BEATS[6]!]));
    expect(tl.beats[0]!.groups).toHaveLength(1);
    expect(plannedCuts(tl)).toBe(line.split(' ').length + tl.beats[1]!.shotAt.length); // 0,32 s apart: each one reads
  });

  it('plain is the lowest band, whatever the sound: a cut at x ≥ 0,3 is kinetic, a slide reads its own rule', () => {
    expect(timelineOf(cutOf({ captionWords: 3 }, BEATS)).plain).toBe(false);
    expect(timelineOf({ ...cutOf({ captionWords: 3 }), sfx: false }).plain).toBe(false);
    expect(timelineOf({ ...cutOf({ captionWords: 6 }), sfx: true }).plain).toBe(true);
    const slide: VideoBeat = { kind: 'slide', scene: 0, spoken: '', screen: 'Une slide', estSec: 2, shots: 1 };
    expect(timelineOf({ ...cutOf({ captionWords: 6 }, [slide]), sfx: true }).plain).toBe(false);
    expect(timelineOf({ ...cutOf({ captionWords: 2 }, [slide]), sfx: false }).plain).toBe(true);
  });

  /** The screens of a hook on words as speech gives them: a closing mark stays on its word, and « Avant : » is one. */
  const groupsOf = (line: string, screen: string) => {
    const cut = cutOf({}, [{ ...BEATS[1]!, spoken: line, screen }, BEATS[6]!]);
    const lines = cut.beats.map((b): SpokenLine => { const words = estimatedWords(b.spoken); return { text: b.spoken, voice: null, wav: null, speechSec: words.at(-1)?.end ?? 0, words }; });
    return buildTimeline(cut, lines, TEMPO_BPM.standard).beats[0]!.groups;
  };
  const screens = (line: string, screen: string) => groupsOf(line, screen).map((g) => g.map((w) => w.text).join(' '));

  const hookLine = (screen: string, line: string) => {
    const tl = timelineOf(cutOf({}, [{ ...BEATS[1]!, spoken: line, screen }, BEATS[6]!]));
    return tl.beats[0]!.groups.map((g) => g.map((w) => w.text).join(' '));
  };

  it('opens the hook on the line written to stand alone, then cuts the voice at its clauses', () => {
    expect(hookLine('6 erreurs à éviter', '6 erreurs à éviter, 7 étapes à suivre, 14 nuits de plan.')).toEqual(['6 erreurs à éviter', '7 étapes à suivre,', '14 nuits de plan.']);
    expect(hookLine('POV : tu arrêtes de gronder le chiot après coup.', 'POV : tu arrêtes enfin de gronder le chiot après coup.')).toEqual(['POV\u00a0: tu arrêtes de gronder le chiot après coup.']);
  });

  it('keeps the screen\'s own words when the voice says them another way: muted, the line is the ad', () => {
    expect(hookLine('L’erreur : mettre le nez du chiot dans son pipi', 'Au début, tout le monde fait la même erreur : mettre le nez du chiot dans son pipi.')).toEqual(['L’erreur\u00a0: mettre le nez du chiot dans son pipi']);
    expect(hookLine('Stop : gronder le chiot après coup', 'Si tu fais ça, arrête tout de suite : gronder le chiot après coup.')).toEqual(['Stop\u00a0: gronder le chiot après coup']);
    const line = 'Au début, tout le monde fait la même erreur : mettre le nez du chiot dans son pipi.';
    const [first] = timelineOf(cutOf({}, [{ ...BEATS[1]!, spoken: line, screen: 'L’erreur : mettre le nez du chiot dans son pipi' }, BEATS[6]!])).beats[0]!.groups;
    expect(first![0]!.at).toBeGreaterThan(1.5); // each word lights when the voice reaches it
    expect(first!.map((w) => w.at)).toEqual([...first!.map((w) => w.at)].sort((a, b) => a - b));
  });

  it('never opens on a line that drops the figure the voice opens on: the screen says what the voice says', () => {
    const [first] = hookLine('La méthode simple', '14 jours, 7 étapes, zéro prise de tête : la méthode simple.');
    expect(first).toContain('14');
    expect(first).toContain('7');
    expect(hookLine('POV : et tu coches la dernière case', 'POV : la nuit 14 du plan, et tu coches la dernière case.').join(' ')).toContain('14');
    expect(hookLine('Un meuble relooké qui a l’air neuf', '8 étapes, 3 jours : un meuble relooké qui a l’air neuf.')[0]).toContain('8');
    expect(hookLine('14 nuits de plan', 'En 14 nuits, 14 nuits de plan.'), 'a figure the line holds costs it nothing').toEqual(['14 nuits de plan']);
  });

  it('gives a voice that tells before and after one screen a side, whatever the line written for the ad holds', () => {
    expect(screens('Avant : gronder le chiot après coup. Après : nettoyer sans commentaire.', 'Après : nettoyer sans commentaire')).toEqual(['Avant\u00a0: gronder le chiot après coup.', 'Après\u00a0: nettoyer sans commentaire.']);
    const short = screens('Avant : l’épuisement. Après 14 nuits de plan : arrêter de culpabiliser.', 'Après 14 nuits : arrêter de culpabiliser');
    expect(short[0], 'a short side stands alone too').toBe('Avant\u00a0: l’épuisement.');
    expect(short[1]).toMatch(/^Après 14 nuits/);
    expect(screens('Avant : le stress.', 'Après 3 jours : une peinture qui tient des années'), 'an editor cut the second side: the written one joins its screen').toEqual(['Avant\u00a0: le stress. Après 3 jours\u00a0: une peinture qui tient des années']);
    expect(screens('Avant : le stress.', 'Le stress'), 'no written Après: the screen follows the voice').toEqual(['Avant\u00a0: le stress.']);
    expect(screens('Avant de commencer, regarde ton balcon.', 'Regarde ton balcon'), 'a line that merely opens on the word keeps its screen').toEqual(['Regarde ton balcon']);
  });

  it('lights the written Après on the last word said: the whole story stands from the first frame, and the voice leads it', () => {
    const [group, ...rest] = groupsOf('Avant : gronder le chiot après coup.', 'Après : nettoyer sans commentaire');
    expect(rest).toHaveLength(0);
    const after = group!.findIndex((w) => /^Après/.test(w.text));
    expect(new Set(group!.slice(after - 1).map((w) => w.at)).size).toBe(1);
  });

  it('gives a quoted line its own screen behind the figure the voice opens on, both marks on it', () => {
    const line = '5 erreurs qui entretiennent « bébé se réveille plusieurs fois par nuit ».';
    expect(screens(line, '« bébé se réveille plusieurs fois par nuit »')).toEqual(['5 erreurs qui entretiennent', '«\u00a0bébé se réveille plusieurs fois par nuit\u00a0».']);
    expect(screens(line, '« bébé ne dort pas »'), 'a line the voice does not say gives way to the voice').toHaveLength(1);
    expect(screens('5 erreurs à éviter ce soir.', '« autre chose »'), 'a line the voice does not say opens nothing').toEqual(['5 erreurs à éviter ce soir.']);
    expect(hook!.typeOf([{ text: '«\u00a0bébé', at: 0, end: 1 }, { text: 'dort\u00a0».', at: 1, end: 2 }])).toEqual(['«\u00a0BÉBÉ', 'DORT\u00a0»']);
  });

  it('leaves no word alone at the end of a clause too long for one screen', () => {
    expect(hookLine('7 étapes', '7 étapes, et le tableau de suivi du chiffre d’affaires à imprimer.')).toEqual(['7 étapes', 'et le tableau de suivi du chiffre d’affaires à imprimer.']);
  });

  it('a screen that is not what the voice says gives way to the voice, whole clauses', () => {
    expect(hookLine('Autre chose', 'Au début, tout le monde se trompe, et on arrose trop.')).toEqual(['Au début, tout le monde se trompe,', 'et on arrose trop.']);
  });

  it('counts what a beat does past its shots: QA sees the camera leave for the line and the bubbles land', () => {
    const page = timelineOf(cutOf({}, [BEATS[3]!, BEATS[6]!]));
    expect(plannedCuts(page)).toBe(page.beats.reduce((n, b) => n + b.shotAt.length, 0) + 1);
    const held = timelineOf(cutOf({ captionWords: 6 }, [BEATS[3]!, BEATS[6]!]));
    expect(plannedCuts(held)).toBe(held.beats.reduce((n, b) => n + b.shotAt.length, 0)); // a plain editor holds the page
    const pain = timelineOf(cutOf({}, [BEATS[2]!, BEATS[6]!]));
    expect(plannedCuts(pain)).toBe(pain.beats.reduce((n, b) => n + b.shotAt.length, 0) + 2);
  });

  it('does not count a quick card as a cut: the film holds its first screen across it', () => {
    const tl = timelineOf();
    const bare = timelineOf(cutOf({}, BEATS.slice(1)));
    expect(tl.beats[0]!.kind).toBe('title_card');
    expect(plannedCuts(tl)).toBe(plannedCuts(bare));
    const long = timelineOf(cutOf({}, [{ ...BEATS[0]!, estSec: 0.8 }, ...BEATS.slice(1)]));
    expect(plannedCuts(long)).toBe(plannedCuts(bare) + 1);
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
    market: { niches: [{ id: 'n', demand: 0.91 }] },
    talentTruth: { secret: true },
  } as unknown as WorldState;

  it('copies what the worker needs, and nothing hidden', () => {
    const spec = buildRenderSpec(world, 'cre_1', '4:5');
    expect(spec).toMatchObject({ runId: 'r1', creativeId: 'cre_1', ratio: '4:5', brand: 'Pixel Agency', pdf: 'files/p/guide.pdf', cover: 'files/p/cover.svg', voice: null });
    expect(JSON.stringify(spec)).not.toMatch(/demand|talentTruth|secret/);
  });

  it('finds the buyer back on the product, and a pseudo or a lost review names nobody', () => {
    const fact: VideoBeat = { kind: 'fact_card', scene: 0, spoken: 'x', screen: 'Avis vérifié : 5/5', estSec: 3, shots: 1 };
    const creative = { id: 'cre_r', productId: 'prd_1', format: 'faceless_voiceover', hook: 'h', cut: cutOf({}, [fact]), scenes: [{ voiceover: 'Un acheteur a écrit sur le guide : « très clair, je recommande ».' }] };
    const reviewed = (reviews: unknown[], customers: unknown[]) => buildRenderSpec({
      runId: 'r', company: { name: 'Pixel Agency', creatives: [creative], products: [{ id: 'prd_1', title: 'T', price: 19, design: DESIGN, files: { pdf: null, cover: null }, stats: { reviews } }] }, market: { customers },
    } as unknown as WorldState, 'cre_r', '9:16');
    const review = { id: 'rev_1', day: 3, customerId: 'cus_7', rating: 4, text: 'Très clair, je recommande.' };
    const spec = reviewed([review], [{ id: 'cus_7', name: 'Sophie Martin' }]);
    expect(spec.reviews).toEqual({ 0: { quote: 'très clair, je recommande', rating: 4, name: 'Sophie' } });
    expect(spec.price).toBe(19);
    expect(JSON.stringify(spec)).not.toMatch(/cus_7|Martin/);
    expect(reviewed([review], [{ id: 'cus_7', name: '@lea_du_34' }]).reviews[0]).toMatchObject({ rating: 4, name: null });
    expect(reviewed([review], []).reviews[0]).toMatchObject({ rating: 4, name: null });
    expect(reviewed([], []).reviews[0]).toEqual({ quote: 'très clair, je recommande', rating: null, name: null });
  });

  it('finds a buyer by the words the voice reads: an ad quotes the basis of a review, the shop prints another line (D93)', () => {
    const fact: VideoBeat = { kind: 'fact_card', scene: 0, spoken: 'x', screen: 'Avis vérifié : 5/5', estSec: 3, shots: 1 };
    const creative = { id: 'cre_r', productId: 'prd_1', format: 'faceless_voiceover', hook: 'h', cut: cutOf({}, [fact]), scenes: [{ voiceover: 'Un acheteur a écrit sur le guide : « très clair, je recommande ».' }] };
    const review = { id: 'rev_1', day: 3, customerId: 'cus_7', rating: 4, text: 'Bonne surprise, lu en une soirée.', basis: 'Très clair, je recommande.' };
    const spec = buildRenderSpec({
      runId: 'r', company: { name: 'Pixel Agency', creatives: [creative], products: [{ id: 'prd_1', title: 'T', design: DESIGN, files: { pdf: null, cover: null }, stats: { reviews: [review] } }] }, market: { customers: [{ id: 'cus_7', name: 'Sophie Martin' }] },
    } as unknown as WorldState, 'cre_r', '9:16');
    expect(spec.reviews[0]).toEqual({ quote: 'très clair, je recommande', rating: 4, name: 'Sophie' });
  });

  it('keeps the words and leaves the name to the first who signed a sentence: a viewer of both ads would read a fake', () => {
    const fact: VideoBeat = { kind: 'fact_card', scene: 0, spoken: 'x', screen: 'Avis vérifié : 5/5', estSec: 3, shots: 1 };
    const creative = { id: 'cre_r', productId: 'prd_1', format: 'faceless_voiceover', hook: 'h', cut: cutOf({}, [fact]), scenes: [{ voiceover: 'Un acheteur a écrit sur le guide : « très clair, je recommande ».' }] };
    const text = 'Très clair, je recommande.';
    const card = (other: { customerId: string; text: string; day?: number; id?: string }, id = 'rev_1') => buildRenderSpec({
      runId: 'r',
      company: {
        name: 'Pixel Agency', creatives: [creative],
        products: [
          { id: 'prd_1', title: 'T', design: DESIGN, files: { pdf: null, cover: null }, stats: { reviews: [{ id, day: 3, customerId: 'cus_7', rating: 4, text: 'Une ligne de la boutique.', basis: text }] } },
          { id: 'prd_2', title: 'U', design: DESIGN, files: { pdf: null, cover: null }, stats: { reviews: [{ id: other.id ?? 'rev_2', day: other.day ?? 1, rating: 5, text: 'Une autre ligne de la boutique.', customerId: other.customerId, basis: other.text }] } },
        ],
      },
      market: { customers: [{ id: 'cus_7', name: 'Sophie Martin' }, { id: 'cus_8', name: 'Anaïs Petit' }] },
    } as unknown as WorldState, 'cre_r', '9:16').reviews[0];
    expect(card({ customerId: 'cus_8', text: 'TRÈS clair,  je recommande.' })).toEqual({ quote: 'très clair, je recommande', rating: 4, name: null });
    expect(card({ customerId: 'cus_8', text, day: 5 }), 'the first who wrote it keeps it, whoever wrote it after').toMatchObject({ rating: 4, name: 'Sophie' });
    expect(card({ customerId: 'cus_8', text, day: 3, id: 'rev_12' }, 'rev_9'), 'the same day goes by the numbers of the ids, not by a string').toMatchObject({ name: 'Sophie' });
    expect(card({ customerId: 'cus_8', text, day: 3, id: 'rev_9' }, 'rev_12')).toMatchObject({ name: null });
    expect(card({ customerId: 'cus_7', text }), 'the same buyer on two guides is one buyer').toMatchObject({ name: 'Sophie' });
    expect(card({ customerId: 'cus_8', text: 'Autre chose.' }), 'another sentence takes nothing').toMatchObject({ name: 'Sophie' });
  });

  it('refuses a creative it cannot render', () => {
    expect(() => buildRenderSpec(world, 'cre_9', '9:16')).toThrow('no creative');
    expect(() => buildRenderSpec(world, 'cre_2', '9:16')).toThrow('no cut');
  });

  it('keys on the cut, the ratio, the voice, the design and the words a card reads, and on nothing else', () => {
    const base = buildRenderSpec(world, 'cre_1', '9:16');
    expect(renderKey(base)).toBe(renderKey(buildRenderSpec(world, 'cre_1', '9:16')));
    expect(renderKey(base)).toMatch(/^[0-9a-f]{40}$/);
    expect(renderKey({ ...base, ratio: '4:5' })).not.toBe(renderKey(base));
    expect(renderKey({ ...base, voice: 'Hortense' })).not.toBe(renderKey(base));
    expect(renderKey({ ...base, cut: { ...base.cut, tempo: 'fast' } })).not.toBe(renderKey(base));
    expect(renderKey({ ...base, design: { ...base.design, seed: 8 } })).not.toBe(renderKey(base));
    expect(renderKey({ ...base, version: base.version + 1 })).not.toBe(renderKey(base));
    expect(renderKey({ ...base, reviews: { 3: { quote: 'très clair', rating: 5, name: 'Sophie' } } })).not.toBe(renderKey(base));
    expect(renderKey({ ...base, price: 29 })).toBe(renderKey({ ...base, price: 24 })); // a price test flips it every day: a new key would delete the film each time
    expect(renderKey({ ...base, hook: 'autre' })).toBe(renderKey(base));
  });

  it('a film keeps its key when compaction takes the review or the buyer it quotes: a ready master is not rendered again, poorer', () => {
    const fact: VideoBeat = { kind: 'fact_card', scene: 0, spoken: 'x', screen: 'Avis vérifié : 5/5', estSec: 3, shots: 1 };
    const creative = { id: 'cre_r', productId: 'prd_1', format: 'faceless_voiceover', hook: 'h', cut: cutOf({}, [fact]), scenes: [{ voiceover: 'Un acheteur a écrit sur le guide : « très clair, je recommande ».' }] };
    const specOf = (reviews: unknown[], customers: unknown[]) => buildRenderSpec({
      runId: 'r', company: { name: 'Pixel Agency', creatives: [creative], products: [{ id: 'prd_1', title: 'T', price: 19, design: DESIGN, files: { pdf: null, cover: null }, stats: { reviews } }] }, market: { customers },
    } as unknown as WorldState, 'cre_r', '9:16');
    const review = { id: 'rev_1', day: 3, customerId: 'cus_7', rating: 4, text: 'Très clair, je recommande.' };
    const whole = specOf([review], [{ id: 'cus_7', name: 'Sophie Martin' }]);
    expect(whole.reviews[0]).toMatchObject({ rating: 4, name: 'Sophie' });
    const noBuyer = specOf([review], []);
    const noReview = specOf([], []);
    expect(noBuyer.reviews[0]).toMatchObject({ rating: 4, name: null });
    expect(noReview.reviews[0]).toMatchObject({ rating: null, name: null });
    expect(renderKey(noBuyer)).toBe(renderKey(whole));
    expect(renderKey(noReview)).toBe(renderKey(whole));
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

  it('a line printed twice lands on the page with the most on it, and says where that page\'s text stops', async () => {
    const twice = join(tmp, 'twice.pdf');
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', compress: false });
      const out = createWriteStream(twice);
      out.on('finish', () => resolve());
      out.on('error', reject);
      doc.pipe(out);
      doc.font('Helvetica').fontSize(14).text('Noter les heures de repas chaque jour');
      doc.addPage();
      doc.text('Noter les heures de repas chaque jour');
      for (let i = 0; i < 18; i++) doc.text(`Une ligne de plus sur cette page, la numéro ${i}.`);
      doc.text('42', 280, 800, { lineBreak: false }); // the folio
      doc.end();
    });
    const guide = await (await import('../src/video/pdfPages.js')).openGuide(twice);
    const hit = guide.findNeedle('Noter les heures de repas chaque jour')!;
    expect(hit.page).toBe(2);
    expect(hit.inkEnd).toBeGreaterThan(hit.boxes[0]!.y + 100);
    expect(hit.inkEnd).toBeLessThan(760);
    await guide.close();
  });

  const opener = join(tmp, 'opener.pdf');
  const writeOpener = () => new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', compress: false });
    const out = createWriteStream(opener);
    out.on('finish', () => resolve());
    out.on('error', reject);
    doc.pipe(out);
    doc.font('Helvetica').fontSize(120).text('06', 56, 90, { lineBreak: false });
    doc.fontSize(12).text('Voici le plan concret sur 14 nuits, pensé pour le quotidien.', 56, 260);
    doc.addPage();
    doc.fontSize(12).text('Une page de texte courant, sans rien de grand au-dessus.', 56, 260);
    doc.end();
  });

  it('knows the giant numeral over a line, and only that', async () => {
    await writeOpener();
    const guide = await (await import('../src/video/pdfPages.js')).openGuide(opener);
    const hit = guide.findNeedle('Voici le plan concret sur 14 nuits')!;
    expect(hit.headTop).not.toBeNull();
    expect(hit.headTop!).toBeGreaterThan(50);
    expect(hit.headTop!).toBeLessThan(120);
    expect(guide.findNeedle('Une page de texte courant')!.headTop).toBeNull();
    await guide.close();
  });

  it('takes a drop cap for what it is: no numeral, and no part of the marked line', async () => {
    const path = join(tmp, 'drop.pdf');
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', compress: false });
      const out = createWriteStream(path);
      out.on('finish', () => resolve());
      out.on('error', reject);
      doc.pipe(out);
      doc.font('Helvetica').fontSize(53).text('T', 56, 55, { lineBreak: false });
      doc.fontSize(12).text('ous les soirs, la même routine en cinq gestes.', 92, 70, { lineBreak: false });
      doc.text('Une ligne plus bas sur la même page de texte.', 56, 300, { lineBreak: false });
      doc.addPage();
      doc.fontSize(120).text('+', 56, 90, { lineBreak: false }); // the bonus chapter's numeral: one mark, no letter
      doc.fontSize(12).text('Le bonus se lit en dernier, une fois la méthode en place.', 56, 260);
      doc.end();
    });
    const guide = await (await import('../src/video/pdfPages.js')).openGuide(path);
    const under = guide.findNeedle('Une ligne plus bas sur la même page')!;
    expect(under.headTop, 'a body page keeps its close-up').toBeNull();
    const opening = guide.findNeedle('Tous les soirs, la même routine en cinq gestes')!;
    expect(opening.headTop).toBeNull();
    expect(opening.boxes).toHaveLength(1);
    expect(opening.boxes[0]!.h, 'the marker keeps to the line').toBeLessThan(20);
    expect(guide.findNeedle('Le bonus se lit en dernier')!.headTop, 'a real numeral stays one').not.toBeNull();
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

  it('keeps a figure with its unit: « 1000 / € » is no line of a plate', async () => {
    const words = 'on a mis presque tout notre budget de la semaine dans ce projet et il reste encore'.split(' ');
    for (let n = 2; n <= words.length; n++) {
      const screen = `${words.slice(0, n).join(' ')} 1000 € de travaux`;
      const tl = timelineOf(cutOf({}, [BEATS[1]!, { ...BEATS[4]!, spoken: screen, screen }, BEATS[6]!]));
      const { comp } = await make(tl, { pages: false });
      expect(comp.drawFrame(frameOf(tl, 'fact_card')).filter((b) => b.text.startsWith('€')), screen).toEqual([]);
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

  it('the guide rises in the hook for a good editor and stays away for a plain one', async () => {
    const good = timelineOf();
    const weak = timelineOf(cutOf({ productSec: 8, captionWords: 6 }));
    const a = await make(good);
    const b = await make(weak);
    const f = frameOf(good, 'hook', 0.9);
    a.comp.drawFrame(f);
    const hook = Uint8Array.from(a.comp.canvas.data());
    b.comp.drawFrame(f);
    expect(share(hook, b.comp.canvas.data())).toBeGreaterThan(0.03);
  });

  /** Pixels that are not the art: the white of the guide's cover, in that band of its slot, shares of its height. */
  const coverWhite = (comp: { canvas: { data(): Uint8Array } }, stage: { w: number; h: number; bookSlot: { x: number; y: number; w: number; h: number } }, from = 0.45, to = 0.55): number => {
    const { x, y, w, h } = stage.bookSlot;
    const px = comp.canvas.data();
    let white = 0; let all = 0;
    for (let row = Math.round(y + h * from); row < Math.min(stage.h, Math.round(y + h * to)); row++) {
      for (let col = Math.round(x + w * 0.3); col < Math.round(x + w * 0.7); col++) {
        const i = (row * stage.w + col) * 4;
        all++;
        if (px[i]! > 170 && px[i + 1]! > 170 && px[i + 2]! > 170) white++;
      }
    }
    return white / all;
  };

  it.each(['9:16', '4:5', '1:1'] as VideoRatio[])('%s: the hook and the guide stand on frame 1 together, and it only rises', async (ratio) => {
    const line = 'Quatre mots sur un écran';
    const tl = timelineOf(cutOf({}, [{ ...BEATS[1]!, spoken: `${line}, puis la suite.`, screen: line }, BEATS[6]!]));
    const { comp, stage } = await make(tl, { ratio, spec: { ratio } });
    for (const frame of [0, 3, 8, 13, 20]) {
      comp.drawFrame(frame);
      expect(coverWhite(comp, stage), `frame ${frame}`).toBeGreaterThan(0.6);
    }
    expect(tl.bookSec).toBeCloseTo(0.45, 6); // the plan is the same: the guide ends its rise there
    comp.drawFrame(0);
    expect(coverWhite(comp, stage, 0.08, 0.14), 'it peeks on frame 1').toBeLessThan(0.1);
    comp.drawFrame(20);
    expect(coverWhite(comp, stage, 0.08, 0.14), 'it has risen by then').toBeGreaterThan(0.6);
  });

  it('keeps the guide on the frame through a quick card: it never vanishes between the card and the hook', async () => {
    const tl = timelineOf();
    const { comp, stage } = await make(tl);
    expect(tl.beats[0]!.kind).toBe('title_card');
    for (const frame of [0, 4, 7, 8, 9, 12, 16, 20, 30]) {
      comp.drawFrame(frame);
      expect(coverWhite(comp, stage), `frame ${frame}`).toBeGreaterThan(0.6);
    }
  });

  it('draws no title on a quick card: frame 1 is the hook, no flash at its join, and the plan is the same', async () => {
    const tl = timelineOf();
    const { comp } = await make(tl);
    const texts = comp.drawFrame(6).map((b) => b.text).join(' ');
    expect(texts).toContain('8');
    expect(texts).toContain('ÉTAPES');
    expect(texts).not.toContain('LE BALCON');
    const hookBeat = tl.beats[1]!;
    expect(hookBeat.t0).toBeGreaterThan(0.2); // the voice waits for its beat: `hookWordSec` holds
    comp.drawFrame(Math.round(hookBeat.t0 * 30) - 1);
    const before = Uint8Array.from(comp.canvas.data());
    comp.drawFrame(Math.round(hookBeat.t0 * 30) + 1);
    expect(share(before, comp.canvas.data())).toBeLessThan(0.15);
    const long = longCard();
    expect((await make(long)).comp.drawFrame(6).map((b) => b.text).join(' ')).toContain('LE BALCON');
  });

  it('lands no punch on frame 1: the first screen is at rest, inside its zone, from the first settled frame', async () => {
    const line = 'Quatre mots sur un écran';
    const tl = timelineOf(cutOf({}, [{ ...BEATS[1]!, spoken: `${line}, puis la suite.`, screen: line }, BEATS[6]!]));
    const { comp, stage } = await make(tl, { pages: false });
    const boxes = comp.drawFrame(6);
    expect(boxes.length).toBe(5);
    for (const b of boxes) expect(insideSafe(stage, b), b.text).toBe(true);
  });

  it('9:16: a hook that carries the guide reads as big as one that does not', async () => {
    const line = 'L’erreur : changer de méthode tous les deux jours';
    const hookOf = (over: Partial<VideoCut['metrics']>) => timelineOf(cutOf(over, [{ ...BEATS[1]!, spoken: `${line}.`, screen: line }, BEATS[6]!]));
    const big = async (tl: Timeline) => {
      const { comp } = await make(tl, { pages: false, width: 1080 });
      const boxes = comp.drawFrame(24).filter((b) => b.text.length > 3);
      expect(boxes.length).toBeGreaterThan(2);
      const heights = boxes.map((b) => b.h).sort((a, b) => a - b);
      return { cap: heights[Math.floor(heights.length / 2)]!, block: Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)) };
    };
    const withBook = await big(hookOf({}));
    const without = await big(hookOf({ productSec: 7 }));
    expect(withBook.cap).toBeGreaterThanOrEqual(without.cap * 0.8);
    expect(withBook.block).toBeGreaterThan(1920 * 0.3);
  });

  it('runs a line past the box above the rail, never under it', async () => {
    const line = 'Anticonstitutionnellement tout';
    const tl = timelineOf(cutOf({}, [{ ...BEATS[1]!, spoken: `${line}.`, screen: line }, BEATS[6]!]));
    const { comp, stage } = await make(tl, { pages: false, width: 1080 });
    const boxes = comp.drawFrame(24);
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    expect(right).toBeGreaterThan(stage.heroBox.x + stage.heroBox.w); // past 880
    for (const b of boxes) expect(insideSafe(stage, b), b.text).toBe(true);
  });

  it('enters as one block: on frame 1 a word does not eat the gap to the next', async () => {
    const line = 'Un mot puis un autre mot encore';
    const tl = timelineOf(cutOf({}, [{ ...BEATS[1]!, spoken: 'Cinq secondes de voix avant de dire: un mot puis un autre mot encore', screen: line, shots: 1 }, BEATS[6]!]));
    const { comp, stage } = await make(tl, { pages: false, width: 1080 });
    const gaps = (frame: number) => {
      comp.drawFrame(frame);
      const px = comp.canvas.data();
      const rows: number[] = [];
      for (let y = stage.heroBox.y; y < stage.heroBox.y + stage.heroBox.h; y += 2) {
        let lit = 0;
        for (let x = 80; x < 1000; x += 2) if (px[(y * stage.w + x) * 4]! > 170) lit++;
        rows.push(lit);
      }
      // The row of the type that holds the most ink, then its blank runs between words.
      const busiest = stage.heroBox.y + rows.indexOf(Math.max(...rows)) * 2;
      const lit = [...Array(1000).keys()].map((x) => px[(busiest * stage.w + x) * 4]! > 170);
      const first = lit.indexOf(true); const last = lit.lastIndexOf(true);
      let widest = 0; let run = 0;
      for (let x = first; x <= last; x++) { run = lit[x] ? 0 : run + 1; widest = Math.max(widest, run); }
      return widest;
    };
    expect(gaps(0)).toBeGreaterThanOrEqual(gaps(14));
  });

  it('stands the whole first screen on its first frames: a hook reads with the sound off', async () => {
    const tl = timelineOf(cutOf({}, [{ ...BEATS[1]!, spoken: 'Quatre mots sur un écran, puis la suite.', screen: 'Quatre mots sur un écran' }, BEATS[6]!]));
    const { comp } = await make(tl, { pages: false });
    expect(comp.drawFrame(6).map((b) => b.text)).toEqual(['QUATRE', 'MOTS', 'SUR', 'UN', 'ÉCRAN']);
  });

  it('sets its colon inside a line and its question mark, and leaves no mark at the end of a screen', async () => {
    const spokenLine = 'POV : tu veux savoir quoi planter ?';
    const tl = timelineOf(cutOf({}, [{ ...BEATS[1]!, spoken: spokenLine, screen: spokenLine }, BEATS[6]!]));
    const { comp } = await make(tl, { pages: false });
    expect(comp.drawFrame(6).map((b) => b.text)).toEqual(['POV\u00a0:', 'TU', 'VEUX', 'SAVOIR', 'QUOI', 'PLANTER\u00a0?']);
    const tail = timelineOf(cutOf({}, [{ ...BEATS[1]!, spoken: 'Tout est dans le plan.', screen: 'Tout est dans le plan.' }, BEATS[6]!]));
    expect((await make(tail, { pages: false })).comp.drawFrame(6).map((b) => b.text).at(-1)).toBe('PLAN');
  });

  it('breaks a word at its hyphen rather than set the whole line small', async () => {
    const line = 'Presque tous les micro-entrepreneurs';
    const tl = timelineOf(cutOf({ captionWords: 6 }, [{ ...BEATS[1]!, spoken: line, screen: line }, BEATS[6]!]));
    const { comp, stage } = await make(tl, { pages: false, width: 1080 });
    const boxes = comp.drawFrame(12);
    expect(boxes.map((b) => b.text)).toEqual(['PRESQUE', 'TOUS', 'LES', 'MICRO-', 'ENTREPRENEURS']);
    expect(Math.max(...boxes.map((b) => b.h))).toBeGreaterThan(120);
    for (const b of boxes) expect(insideSafe(stage, b), b.text).toBe(true);
  });

  it('leaves no short word alone on a line of the hook', async () => {
    const line = '5 choses à arrêter dès ce soir';
    const tl = timelineOf(cutOf({ captionWords: 6 }, [{ ...BEATS[1]!, spoken: line, screen: line }, BEATS[6]!]));
    const { comp } = await make(tl, { pages: false, width: 1080, spec: { design: { ...DESIGN, titleFont: 'Times-Bold' } } });
    const boxes = comp.drawFrame(12);
    const rows = new Map<number, string[]>();
    for (const b of boxes) { const row = Math.round((b.y + b.h) / 40); rows.set(row, [...(rows.get(row) ?? []), b.text]); }
    const lone = [...rows.values()].filter((r) => r.length === 1 && r[0]!.length < 4);
    expect(lone, JSON.stringify([...rows.values()])).toEqual([]);
  });

  it('gives one word the colour: a figure, else the word the line leans on', () => {
    const { accentWord } = hook!;
    expect(accentWord(['8', 'MOIS', 'DE', 'PLAN'])).toBe(0);
    expect(accentWord(['POV', 'LE', 'MOIS', '8'])).toBe(3);
    expect(accentWord(['SI', 'TU', 'FAIS', 'ÇA'])).toBe(2);
    expect(accentWord(['DANS', 'TOUTE', 'CETTE', 'MAISON'])).toBe(3);
    expect(accentWord(['ET', 'LE'])).toBe(-1);
  });

  it('wears the guide it sells: same palette, another motif and art, another film', async () => {
    const a = await make();
    const b = await make(timelineOf(), { spec: { design: { ...DESIGN, motif: 'coin', artSeed: 91 } } });
    expect(a.assets.art).not.toBeNull();
    for (const kind of ['hook', 'pain_bubble', 'bonus_stack', 'end_card']) {
      a.comp.drawFrame(frameOf(a.comp.timeline, kind));
      const one = Uint8Array.from(a.comp.canvas.data());
      b.comp.drawFrame(frameOf(b.comp.timeline, kind));
      expect(share(one, b.comp.canvas.data()), kind).toBeGreaterThan(0.08);
    }
  });

  it('fills the foot of the frame: the art runs under the platform, nothing there is empty', async () => {
    const { comp } = await make(timelineOf(), { width: 270 });
    for (const kind of ['title_card', 'hook', 'pain_bubble', 'fact_card', 'bonus_stack', 'end_card']) {
      comp.drawFrame(frameOf(comp.timeline, kind));
      const px = comp.canvas.data();
      const foot = luma(px.subarray(270 * 4 * Math.round(480 * 0.72)));
      const mean = foot.reduce((a, b) => a + b, 0) / foot.length;
      const spread = Math.sqrt(foot.reduce((a, b) => a + (b - mean) ** 2, 0) / foot.length);
      expect(spread, kind).toBeGreaterThan(18);
    }
  });

  it.each(['9:16', '4:5', '1:1', '2:3'] as VideoRatio[])('%s: the accent of a long title stays in the zone', async (ratio) => {
    const tl = longCard();
    const { comp, stage } = await make(tl, { ratio, spec: { title: 'Bébé se réveille à l’étage, été comme hiver, et Éléonore ne dort plus de la nuit' } });
    expect(comp.drawFrame(6).filter((b) => !insideSafe(stage, b))).toEqual([]);
  });

  it('a plain editor sets their caption on one line, a good one on two big ones', async () => {
    const text = 'Un mot de plus ici';
    const beats: VideoBeat[] = [BEATS[1]!, { ...BEATS[4]!, spoken: text }, BEATS[6]!];
    const rows = async (captionWords: number) => {
      const tl = timelineOf(cutOf({ captionWords }, beats));
      const { comp } = await make(tl, { pages: false });
      const ys = comp.drawFrame(frameOf(tl, 'fact_card', 0.5)).filter((b) => b.text === b.text.toLocaleUpperCase('fr-FR') && b.text.length > 1 && b.text !== 'REPÈRE' && b.text !== 'ÉTAPE 1');
      return new Set(ys.map((b) => Math.round(b.y / 12))).size;
    };
    expect(await rows(6)).toBe(1);
    expect(await rows(5)).toBe(2);
  });

  it('a plain caption comes up, it does not pop: nothing hits, and two big lines never swap as one cut', async () => {
    const line = 'Une ligne de caption posée dans le plan du montage, et une autre juste après elle';
    const beats: VideoBeat[] = [BEATS[1]!, { ...BEATS[4]!, spoken: line, screen: 'Plan' }, BEATS[6]!];
    const shown = async (captionWords: number) => {
      const tl = timelineOf(cutOf({ captionWords }, beats));
      const { comp } = await make(tl, { pages: false, width: 1080 });
      const b = tl.beats.find((x) => x.kind === 'fact_card')!;
      const at = b.groups[1]![0]!.at;
      const white = (sec: number) => {
        comp.drawFrame(Math.round((b.t0 + sec) * 30));
        const px = comp.canvas.data();
        let n = 0;
        for (let i = (1100 * 1080) * 4; i < (1240 * 1080) * 4; i += 4) if (px[i]! > 235 && px[i + 1]! > 235 && px[i + 2]! > 235) n++;
        return n;
      };
      return { landing: white(at), settled: white(at + 0.25) };
    };
    const plain = await shown(6);
    expect(plain.landing).toBeLessThan(plain.settled * 0.5);
    expect(plain.settled).toBeGreaterThan(5000);
  });

  it('a plain caption never reads under 56 px: past that it takes two lines, centred, and still no pill', async () => {
    const text = 'Prestation bic ou prestation bnc avec la déclaration dans son espace personnel avant la fin du trimestre civil, sans attendre le dernier mois de ton année comptable';
    const tl = timelineOf(cutOf({ captionWords: 6 }, [BEATS[1]!, { ...BEATS[4]!, spoken: text, screen: 'Plan' }, BEATS[6]!]));
    expect(tl.plain).toBe(true);
    const { comp, stage } = await make(tl, { pages: false, width: 1080 });
    const b = tl.beats.find((x) => x.kind === 'fact_card')!;
    const capital = 0.69; // of Montserrat's size, on a word with no accent and no descender
    let two = 0;
    for (const g of b.groups) {
      const said = new Set(g.map((w) => w.text.replace(/[.,]$/, '').toLocaleUpperCase('fr-FR')));
      const boxes = comp.drawFrame(Math.round((b.t0 + g[0]!.at + 0.25) * 30)).filter((x) => said.has(x.text));
      expect(boxes.length, g.map((w) => w.text).join(' ')).toBe(g.length);
      for (const x of boxes) {
        expect(x.h, x.text).toBeGreaterThanOrEqual(56 * capital - 1);
        expect(insideSafe(stage, x), x.text).toBe(true);
      }
      const rows = new Set(boxes.map((x) => Math.round((x.y + x.h) / 30)));
      if (rows.size === 2) {
        two++;
        const middles = [...rows].map((row) => { const line = boxes.filter((x) => Math.round((x.y + x.h) / 30) === row); return (Math.min(...line.map((x) => x.x)) + Math.max(...line.map((x) => x.x + x.w))) / 2; });
        expect(Math.abs(middles[0]! - middles[1]!)).toBeLessThan(12);
      }
    }
    expect(two).toBeGreaterThan(0);
    expect(tl.pill).toBe(false);
  });

  it('frame 1 of a title card is the guide: its art over the whole frame and its book under the title, on every ratio', async () => {
    for (const ratio of ['9:16', '4:5', '1:1'] as const) {
      const a = await make(longCard(), { ratio, spec: { ratio } });
      const b = await make(longCard(), { ratio, spec: { ratio, design: { ...DESIGN, motif: 'moon', seed: 99 } } });
      a.comp.drawFrame(0);
      const first = Uint8Array.from(a.comp.canvas.data());
      b.comp.drawFrame(0);
      expect(share(first, b.comp.canvas.data()), ratio).toBeGreaterThan(0.05); // two guides do not open on one gradient
      const stage = a.stage;
      const k = stage.w / stageFor(ratio).w;
      const slot = stage.bookSlot;
      const x = Math.round(slot.x + slot.w * 0.5);
      const y = Math.min(stage.h - 2, Math.round(slot.y + slot.h * 0.5));
      expect(k).toBeGreaterThan(0);
      const px = (i: number) => first[(y * stage.w + x) * 4 + i]!;
      expect(Math.max(px(0), px(1), px(2)), `${ratio}: the book covers its slot`).toBeGreaterThan(100);
    }
  });

  const longCard = () => timelineOf(cutOf({}, [{ ...BEATS[0]!, estSec: 0.8 }, ...BEATS.slice(1)]));

  it('a plain editor opens on the guide\'s title, on its art: no agency name, no broken frame', async () => {
    const { comp } = await make(longCard());
    comp.drawFrame(0);
    expect(luma(comp.canvas.data()).filter((v) => v > 225).length, 'the title stands on frame 1').toBeGreaterThan(400);
    const texts = comp.drawFrame(6).map((b) => b.text).join(' ');
    expect(texts).toContain('LE BALCON');
    expect(texts).not.toMatch(/PIXEL|AGENCY/i);
    const l = luma(comp.canvas.data());
    expect(l.reduce((a, b) => Math.max(a, b)) - l.reduce((a, b) => Math.min(a, b))).toBeGreaterThan(120);
  });

  it('sets a plain cut apart in the file: the art goes dark behind the type, nothing hits', async () => {
    const strong = timelineOf();
    const plain = timelineOf(cutOf({ captionWords: 6, productSec: null }));
    expect([strong.plain, plain.plain]).toEqual([false, true]);
    const a = await make(strong);
    const b = await make(plain);
    const f = frameOf(strong, 'hook', 0.9);
    a.comp.drawFrame(f);
    const lit = Uint8Array.from(a.comp.canvas.data());
    b.comp.drawFrame(f);
    expect(share(lit, b.comp.canvas.data())).toBeGreaterThan(0.2);
  });

  it('a plain hook wears the guide too, on every ratio, and pushes in: no frame of it is dead', async () => {
    const line = 'Une ligne posée au milieu';
    const cut = cutOf({ captionWords: 6, productSec: null }, [{ ...BEATS[1]!, spoken: line, screen: line }, BEATS[6]!]);
    for (const ratio of ['9:16', '4:5', '1:1'] as const) {
      const a = await make(timelineOf(cut), { ratio, spec: { ratio } });
      const b = await make(timelineOf(cut), { ratio, spec: { ratio, design: { ...DESIGN, motif: 'moon', seed: 99 } } });
      a.comp.drawFrame(20);
      const left = Uint8Array.from(a.comp.canvas.data());
      b.comp.drawFrame(20);
      expect(share(left, b.comp.canvas.data()), `${ratio}: two guides, two hooks`).toBeGreaterThan(0.03);
      const box = (frame: number) => a.comp.drawFrame(frame)[0]!;
      expect(box(36).w, `${ratio}: the type grows`).toBeGreaterThan(box(6).w);
    }
  });

  it('a shot inside a screen moves the type too: the cut reads over a long line, and the type stays in the zone', async () => {
    const line = 'Cinq erreurs tuent ton balcon avant la fin de la saison';
    const tl = timelineOf(cutOf({}, [{ ...BEATS[1]!, spoken: line, screen: line, shots: 2 }, BEATS[6]!]));
    const { comp, stage } = await make(tl, { pages: false });
    const b = tl.beats[0]!;
    const cinq = (from: number, to: number) => {
      for (let f = Math.round(from * 30); f < to * 30; f++) {
        const boxes = comp.drawFrame(f);
        const word = boxes.find((x) => x.text === 'CINQ');
        if (word) return { word, boxes };
      }
      throw new Error('no settled frame');
    };
    const first = cinq(b.shotAt[1]! - 0.6, b.shotAt[1]!);
    const second = cinq(b.shotAt[1]! + 0.05, b.shotAt[1]! + 0.6);
    expect(second.word.w).toBeGreaterThan(first.word.w * 1.03);
    for (const x of second.boxes) expect(insideSafe(stage, x), x.text).toBe(true);
  });

  it('runs the page full bleed: no plate shows, and the marker waits for the punch-in', async () => {
    const tl = timelineOf();
    const { comp, assets } = await make(tl);
    const b = tl.beats.find((x) => x.kind === 'page_proof')!;
    const yellow = () => { const px = comp.canvas.data(); let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i]! > 215 && px[i + 1]! > 180 && px[i + 2]! < 150) n++; return n; };
    comp.drawFrame(Math.round((b.t0 + b.shotAt[1]! - 0.1) * 30));
    const before = yellow(); // the progress bar is in that range too
    const wide = Uint8Array.from(comp.canvas.data());
    comp.drawFrame(Math.round((b.t0 + b.dur - 0.05) * 30));
    expect(yellow()).toBeGreaterThan(before + 40);
    expect(share(wide, comp.canvas.data())).toBeGreaterThan(0.02);
    const at = (x: number, y: number) => comp.canvas.data()[(y * comp.canvas.width + x) * 4]!;
    for (const [x, y] of [[2, 2], [267, 2], [2, 300], [267, 300]] as const) expect(at(x, y), `${x},${y}`).toBeGreaterThan(200);
    expect(assets.proofs.get(3)!.paper).toMatch(/^rgb\(/);
    expect(comp.drawFrame(Math.round((b.t0 + b.dur - 0.05) * 30)).map((x) => x.text)).toContain('PAGE 3');
  });

  const pageTimeline = (spokenLine: string, over: Partial<VideoCut['metrics']> = {}) => timelineOf(cutOf(over, [BEATS[1]!, { ...BEATS[3]!, spoken: spokenLine, shots: 3 }, BEATS[6]!]));
  const WORDS = 'Vous savez déjà ce que tout le monde vous dira un jour sur ce point. Le terreau d’un pot s’épuise vite, il n’a pas la réserve d’un sol de jardin.';

  it('stands a plain hook on a flat ground: the art stays at the edges of the frame, and the accent reads on what is left of it', async () => {
    const beats = [{ ...BEATS[1]!, spoken: 'Un plan simple pour ce soir.', screen: 'Un plan simple pour ce soir' }, BEATS[6]!];
    const tl = timelineOf(cutOf({ captionWords: 6, productSec: null }, beats));
    expect(tl.plain).toBe(true);
    expect(tl.bookSec).toBeNull();
    const { comp, stage } = await make(tl, { pages: false, width: 540 });
    const other = await make(tl, { pages: false, width: 540, spec: { design: { ...DESIGN, motif: 'moon', seed: 99 } } });
    const f = frameOf(tl, 'hook', 0.5);
    const boxes = comp.drawFrame(f);
    const one = Uint8Array.from(comp.canvas.data());
    other.comp.drawFrame(f);
    const two = other.comp.canvas.data();
    const moved = (y0: number, y1: number, x0: number, x1: number) => {
      let n = 0; let all = 0;
      for (let y = Math.round(y0); y < Math.round(y1); y++) {
        for (let x = Math.round(x0); x < Math.round(x1); x++) { all++; const i = (y * stage.w + x) * 4; if (Math.abs(one[i]! - two[i]!) > 30) n++; }
      }
      return n / all;
    };
    const top = Math.min(...boxes.map((b) => b.y));
    const bottom = Math.max(...boxes.map((b) => b.y + b.h));
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    expect(moved(top, bottom, left, right), 'one guide or another: the same ground under the type').toBeLessThan(0.04);
    expect(moved(0, Math.min(top, 130), 0, stage.w), 'the art still stands above it').toBeGreaterThan(0.1);
    for (const { name, palette, inks } of PALETTES) {
      const C = compose!.inksOf(normalizeDesign({ ...DESIGN, palette, inks }));
      expect(contrast(hook!.veiledAccent(C), mix(C.dark, C.light, 0.1)), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('stops the paper where it stops on every beat: the art takes the foot of a tall frame', async () => {
    const tl = pageTimeline(WORDS);
    const { comp, stage } = await make(tl);
    const a = await make(tl, { spec: { design: { ...DESIGN, motif: 'moon', seed: 99 } } });
    const f = frameOf(tl, 'page_proof', 0.9);
    comp.drawFrame(f);
    const one = Uint8Array.from(comp.canvas.data());
    a.comp.drawFrame(f);
    const two = a.comp.canvas.data();
    const foot = (px: Uint8Array) => px.subarray(Math.round(stage.band! + 12) * stage.w * 4);
    expect(share(foot(one), foot(two)), 'a guide\'s own art under the paper').toBeGreaterThan(0.1);
    const row = Math.round(stage.band! - 40);
    expect(share(one.subarray(row * stage.w * 4, (row + 4) * stage.w * 4), two.subarray(row * stage.w * 4, (row + 4) * stage.w * 4)), 'paper above it').toBeLessThan(0.05);
  });

  it('lands the marker on the word the voice reaches, and runs it with the voice', async () => {
    const tl = pageTimeline(WORDS);
    const { comp } = await make(tl);
    const b = tl.beats.find((x) => x.kind === 'page_proof')!;
    const at = b.words.find((w) => /^terreau/i.test(w.text))!.at;
    const yellow = () => { const px = comp.canvas.data(); let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i]! > 215 && px[i + 1]! > 200 && px[i + 2]! < 140) n++; return n; };
    comp.drawFrame(Math.round((b.t0 + at - 0.3) * 30));
    const before = yellow();
    comp.drawFrame(Math.round((b.t0 + at + 1.2) * 30));
    const during = yellow();
    comp.drawFrame(Math.round((b.t0 + at + 3) * 30));
    expect(during).toBeGreaterThan(before + 20);
    expect(yellow()).toBeGreaterThan(during);
  });

  it('keeps the marker\'s tip on the frame across a wrap: the camera reads the line the marker is on', () => {
    const { aimAt, markerTip } = proofScene!;
    const W = 1080;
    const k = 3.6;
    const needles = [
      [{ x: 56, y: 100, w: 480, h: 14 }, { x: 56, y: 118, w: 300, h: 14 }], // a long line, too long for the frame
      [{ x: 380, y: 100, w: 150, h: 14 }, { x: 60, y: 118, w: 160, h: 14 }], // short lines, far apart
      [{ x: 56, y: 100, w: 480, h: 14 }, { x: 56, y: 118, w: 480, h: 14 }, { x: 56, y: 136, w: 80, h: 14 }],
    ];
    for (const boxes of needles) {
      let last = aimAt(boxes, k, W, 0);
      let waits = 0;
      for (let i = 0; i <= 1000; i++) {
        const sweep = i / 1000;
        const aim = aimAt(boxes, k, W, sweep);
        const tip = markerTip(boxes, sweep);
        if (tip === null) waits++;
        else {
          const x = W / 2 + (tip - aim.x) * k;
          expect(x, `sweep ${sweep}`).toBeGreaterThanOrEqual(0);
          expect(x, `sweep ${sweep}`).toBeLessThanOrEqual(W);
        }
        expect(Math.abs(aim.x - last.x) * k, `no jump at ${sweep}`).toBeLessThan(100); // the camera eases back, it never cuts
        last = aim;
      }
      expect(waits).toBeGreaterThan(0);
      expect(waits).toBeLessThan(250);
    }
  });

  it('rests with the whole mark in the frame once the line is swept, its first line included', () => {
    const { aimAt, wholeMark } = proofScene!;
    const W = 1080;
    const floor = 2.69;
    const boxes = [{ x: 54, y: 100, w: 328, h: 13.4 }, { x: 54, y: 118, w: 120, h: 13.4 }];
    const k = wholeMark(boxes, 3.6 * 1.16, floor, W); // the push of a long hold
    const aim = aimAt(boxes, k, W, 1, 1);
    for (const b of boxes) {
      expect(W / 2 + (b.x - aim.x) * k).toBeGreaterThanOrEqual(40);
      expect(W / 2 + (b.x + b.w - aim.x) * k).toBeLessThanOrEqual(W - 40);
    }
    expect(aimAt(boxes, 3.6, W, 1, 1).x, 'on the way there, the middle of the whole mark').toBeCloseTo(218, 6);
    expect(aimAt(boxes, 3.6, W, 1, 0).x, 'not yet: the line the marker ended on').toBeCloseTo(114, 6);
    expect(wholeMark(boxes, 2, floor, W), 'a punch-in stays one').toBe(floor);
    expect(wholeMark([boxes[1]!], 3, floor, W), 'a short mark keeps the camera where it is').toBe(3);
  });

  /** The marked boxes a frame draws, where they land on it: the canvas's own transform says. */
  function marksOn(comp: Awaited<ReturnType<typeof make>>['comp'], frame: number): { x0: number; x1: number }[] {
    const proto = Object.getPrototypeOf(comp.canvas.getContext('2d')) as { roundRect: (...a: number[]) => void };
    const round = proto.roundRect;
    const marks: { x0: number; x1: number }[] = [];
    proto.roundRect = function (this: { globalCompositeOperation: string; getTransform(): { a: number; c: number; e: number } }, ...a: number[]) {
      if (this.globalCompositeOperation === 'multiply') {
        const m = this.getTransform();
        const [x, y, w] = a as [number, number, number];
        marks.push({ x0: m.a * x + m.c * y + m.e, x1: m.a * (x + w) + m.c * y + m.e });
      }
      round.apply(this, a);
    };
    try {
      comp.drawFrame(frame);
    } finally {
      proto.roundRect = round;
    }
    return marks;
  }

  const plainPage = (spokenLine: string) => timelineOf(cutOf({ captionWords: 6 }, [BEATS[1]!, { ...BEATS[3]!, spoken: spokenLine, shots: 1 }, BEATS[6]!])); // a plain editor's one shot: the push runs on

  const expectWhole = (marks: { x0: number; x1: number }[]) => {
    expect(marks.length).toBeGreaterThan(1);
    for (const m of marks) {
      expect(m.x0, 'its start').toBeGreaterThanOrEqual(0);
      expect(m.x1, 'its end').toBeLessThanOrEqual(1080);
    }
  };

  it('holds every marked box inside the frame to the last frame of a long beat, on the real page', async () => {
    const tail = Array.from({ length: 90 }, (_, i) => `mot${i}`).join(' ');
    const tl = plainPage(`${NEEDLE}, ${tail}.`);
    const { comp, assets } = await make(tl, { width: 1080 });
    expect(assets.proofs.size).toBe(1);
    const b = tl.beats.find((x) => x.kind === 'page_proof')!;
    expect(b.dur).toBeGreaterThan(30);
    expectWhole(marksOn(comp, Math.round((b.t0 + b.dur) * 30) - 1));
  });

  // the end of one line, the start of the next: side by side the two halves are as wide as the column, and neither alone needs the camera back
  const wideMark = async (tl: Timeline) => {
    await writeGuide(join(tmp, 'wide-guide.pdf'), 360, 11, 'Un mot sur la terre de votre balcon.');
    return make(tl, { width: 1080, spec: { pdf: 'wide-guide.pdf' } });
  };

  it('steps back before the cut when the voice ends on the line: no time left after the sweep, the mark still stands whole', async () => {
    const tl = plainPage(`${NEEDLE}.`);
    const { comp, assets } = await wideMark(tl);
    expect(assets.proofs.get(1)!.boxes).toHaveLength(2);
    const b = tl.beats.find((x) => x.kind === 'page_proof')!;
    expect(b.dur - b.words.at(-1)!.end, 'less than the step back takes').toBeLessThan(0.4);
    expectWhole(marksOn(comp, Math.round((b.t0 + b.dur) * 30) - 1));
  });

  it('keeps the page moving at rest: a long hold never freezes, the type never shrinks and the mark stays whole', async () => {
    const { restPush } = proofScene!;
    const box = [{ x: 54, y: 100, w: 335, h: 13.4 }];
    expect(restPush(box, 3, 1080, -1), 'not yet').toBe(3);
    expect(restPush(box, 3, 1080, 1)).toBeCloseTo(3 * 1.0075, 6);
    expect(restPush(box, 3, 1080, 60), 'to the edge of the margin, no further').toBeCloseTo((1080 - 40) / 335, 6);
    expect(restPush(box, 3.3, 1080, 4), 'a mark already past that margin is not pulled back').toBe(3.3);

    const tail = Array.from({ length: 22 }, (_, i) => `mot${i}`).join(' ');
    const tl = plainPage(`${NEEDLE}, ${tail}.`);
    const { comp } = await wideMark(tl);
    const b = tl.beats.find((x) => x.kind === 'page_proof')!;
    expect(b.dur).toBeGreaterThan(12);
    const end = Math.round((b.t0 + b.dur) * 30) - 1;
    const [later, earlier] = [marksOn(comp, end - 15), marksOn(comp, end - 45)];
    const span = (ms: { x0: number; x1: number }[]) => Math.max(...ms.map((m) => m.x1)) - Math.min(...ms.map((m) => m.x0));
    expect(span(later), 'one second on, the page has moved').toBeGreaterThan(span(earlier) + 2);
    expectWhole(later);
  });

  it('never leaves a marked line behind while a two-line needle is swept, on the real page', async () => {
    const tl = pageTimeline(WORDS);
    const { comp, assets } = await make(tl, { width: 1080 });
    const proof = assets.proofs.get(1)!;
    expect(proof.boxes.length).toBeGreaterThan(1);
    const b = tl.beats.find((x) => x.kind === 'page_proof')!;
    comp.drawFrame(Math.round((b.t0 + b.dur - 0.05) * 30)); // no throw at the end of a sweep, with its returns
    expect(comp.canvas.data().length).toBe(1080 * 1920 * 4);
  });

  it('lays the bar and the chips on paper, side by side: no line of the page runs under them', async () => {
    const tl = pageTimeline(WORDS);
    const { comp, stage } = await make(tl, { width: 1080 });
    const boxes = comp.drawFrame(frameOf(tl, 'page_proof', 0.9));
    const chip = boxes.find((x) => x.text.startsWith('ÉTAPE') || x.text === 'REPÈRE')!;
    const page = boxes.find((x) => x.text === 'PAGE 3')!;
    expect(page.x).toBeGreaterThan(chip.x + chip.w);
    expect(page.y).toBeLessThan(chip.y + chip.h);
    const top = stage.zones[0]!.y0;
    const px = comp.canvas.data();
    const dark = (y: number) => { let n = 0; for (let x = 700; x < 1000; x++) if (px[(y * stage.w + x) * 4]! < 120) n++; return n; };
    for (let y = 8; y < top + 40; y += 8) expect(dark(y), `row ${y}`).toBe(0);
  });

  it('paints the folio out of the page: up close it is a word cut in two', async () => {
    const proofTl = pageTimeline(WORDS);
    const { assets } = await make(proofTl);
    const proof = assets.proofs.get(1)!;
    const img = proof.picture.img as import('@napi-rs/canvas').Canvas;
    const from = Math.ceil(proof.bodyEnd * img.height / proof.picture.h);
    const foot = img.getContext('2d').getImageData(0, from, img.width, img.height - from).data;
    expect(new Set(foot).size).toBeLessThanOrEqual(4); // one colour, alpha included
  });

  it('a plate says what the voice says: « Plan de 14 jours » never stands under another fact', async () => {
    const { plateText } = await import('../src/video/scenes/fact.js');
    const fact = 'Un repère à garder en tête : punir un chiot après un accident ne lui apprend pas la propreté.';
    expect(plateText('Plan de 14 jours', fact)).toBe('Punir un chiot après un accident ne lui apprend pas la propreté');
    expect(plateText('La propreté en 14 jours', fact)).toBe('La propreté en 14 jours'); // it shares a word: the screen stands
    expect(plateText('Plan de 14 jours', 'Le plan tient en 14 jours, avec une checklist à chaque chapitre.')).toBe('Plan de 14 jours');
    expect(plateText('', fact)).toBe(fact);
    expect(plateText('Plan de 14 jours', '')).toBe('Plan de 14 jours');
  });

  it('strokes the end card\'s arrow so that it reads on any tile: white on a dark outline', async () => {
    const tl = timelineOf();
    const { comp, stage } = await make(tl, { width: 1080, pages: false });
    const b = tl.beats.find((x) => x.kind === 'end_card')!;
    comp.drawFrame(Math.round((b.t0 + b.dur - 0.1) * 30));
    const px = comp.canvas.data();
    let white = 0;
    for (let y = stage.band! - 12; y < stage.band! + 90; y++) {
      for (let x = 400; x < 620; x++) {
        const i = (y * stage.w + x) * 4;
        if (px[i]! > 235 && px[i + 1]! > 235 && px[i + 2]! > 235) white++;
      }
    }
    expect(white).toBeGreaterThan(200);
  });

  it('asks the guide\'s price on the end card, in French, and nothing without one', async () => {
    const { priceLabel } = await import('../src/video/scenes/end.js');
    expect([priceLabel(19), priceLabel(9.9), priceLabel(14.5)]).toEqual(['19 €', '9,90 €', '14,50 €']);
    const tl = timelineOf();
    const { comp } = await make(tl, { spec: { price: 19 } });
    expect(comp.drawFrame(frameOf(tl, 'end_card', 0.9)).map((b) => b.text)).toContain('19 €');
  });

  it('lays the sticker where the cover has its art: low on `minimal`, high over the title of the others', async () => {
    const tl = timelineOf();
    const y = async (coverLayout: DesignSpec['coverLayout']) => {
      const { comp } = await make(tl, { pages: false, width: 1080, spec: { price: 19, design: { ...DESIGN, coverLayout } } });
      return comp.drawFrame(frameOf(tl, 'end_card', 0.9)).find((b) => b.text === '19 €')!.y;
    };
    expect(await y('minimal')).toBeGreaterThan(await y('split') + 300);
    expect(await y('centered')).toBe(await y('split'));
  });

  it('gives the end card a second state: the price lands 40 % into the beat, the card is not one held picture', async () => {
    const tl = timelineOf();
    const { comp } = await make(tl, { spec: { price: 19 }, width: 540 });
    const b = tl.beats.find((x) => x.kind === 'end_card')!;
    const at = priceAt(b.dur);
    expect(at).toBeCloseTo(Math.max(0.42, b.dur * 0.4), 6);
    const frame = (sec: number) => Math.round((b.t0 + sec) * 30);
    expect(comp.drawFrame(frame(at - 0.15)).map((x) => x.text)).not.toContain('19 €');
    const before = Uint8Array.from(comp.canvas.data());
    comp.drawFrame(frame(at + 0.05));
    expect(share(before, comp.canvas.data())).toBeGreaterThan(0.02);
    expect(comp.drawFrame(frame(at + 0.4)).map((x) => x.text)).toContain('19 €');
  });

  it('sets a sticker on the cover\'s art, never on its title, on both covers', async () => {
    const { coverScene, COVER_W, COVER_H } = await import('../src/deliverables/cover.js');
    const { stickerSpot } = await import('../src/video/scenes/end.js');
    const reach = 160; // the wider sticker, in the cover's own units
    for (const coverLayout of ['split', 'minimal', 'centered', 'badge'] as const) {
      for (const title of ['Bébé se réveille', 'Les plantations ne donnent presque rien sur le balcon : comment s’en sortir en 8 mois']) {
        const design = { ...DESIGN, coverLayout };
        const { meta } = coverScene({ title, subtitle: 'Un sous-titre', audience: 'Les parents épuisés', design, brand: 'Pixel Agency' });
        const spot = stickerSpot(design);
        const [x, y] = [spot.u * COVER_W, spot.v * COVER_H];
        for (const line of meta.lines) {
          const left = line.anchor === 'end' ? line.x - line.width : line.x;
          const near = x + reach > left && x - reach < left + line.width && y + reach > line.y - line.size && y - reach < line.y + line.size * 0.3;
          expect(near, `${coverLayout}: ${line.s}`).toBe(false);
        }
      }
    }
  });

  it('keeps the arrow of the end card inside a frame with no foot', async () => {
    const tl = timelineOf();
    const { comp, stage } = await make(tl, { ratio: '4:5', width: 1080, spec: { ratio: '4:5' } });
    const b = tl.beats.find((x) => x.kind === 'end_card')!;
    for (let f = Math.round(b.t0 * 30) + 24; f < Math.round((b.t0 + b.dur) * 30); f += 3) {
      comp.drawFrame(f);
      const px = comp.canvas.data();
      let white = 0;
      for (let y = stage.h - 8; y < stage.h; y++) for (let x = 440; x < 640; x++) { const i = (y * stage.w + x) * 4; if (px[i]! > 150 && px[i + 1]! > 150 && px[i + 2]! > 150) white++; } // under the vignette
      expect(white, `frame ${f}`).toBe(0);
    }
  });

  it('draws no empty button: a cut with no CTA keeps the way to the link', async () => {
    const tl = timelineOf();
    const pink = { ...DESIGN, palette: { ...DESIGN.palette, accent: '#ff00aa' }, inks: undefined };
    const none = await make(tl, { pages: false, width: 1080, spec: { cta: '', design: pink } });
    const some = await make(tl, { pages: false, width: 1080, spec: { design: pink } });
    const f = frameOf(tl, 'end_card', 0.9);
    const button = (m: typeof none) => {
      const boxes = m.comp.drawFrame(f);
      const pop = compose!.inksOf(normalizeDesign(pink)).pop;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(pop.slice(i, i + 2), 16)) as [number, number, number];
      const px = m.comp.canvas.data();
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i]! - r) < 20 && Math.abs(px[i + 1]! - g) < 20 && Math.abs(px[i + 2]! - b) < 20) n++;
      return { n, texts: boxes.map((x) => x.text) };
    };
    const without = button(none);
    expect(without.texts).toEqual(['Lien en bio']);
    expect(button(some).n).toBeGreaterThan(without.n + 5000);
  });

  it('prints a customer\'s words as what they are: REPÈRE is for the facts of the guide', async () => {
    const beatsOf = (screen: string, voice: string): VideoBeat[] => [BEATS[1]!, { ...BEATS[4]!, screen, spoken: voice }, BEATS[6]!];
    const chips = async (screen: string, voice: string) => {
      const tl = timelineOf(cutOf({}, beatsOf(screen, voice)));
      const { comp } = await make(tl, { pages: false });
      return comp.drawFrame(frameOf(tl, 'fact_card', 0.9)).map((b) => b.text).join(' ');
    };
    const quoted = await chips('« versement libératoire oui ou non »', 'Si toi aussi tu te dis « versement libératoire oui ou non », reste deux secondes.');
    expect(quoted).not.toContain('REPÈRE');
    expect(quoted).toContain('LU DANS LES COMMENTAIRES');
    const filler = await chips('Tu te reconnais ?', 'Si toi aussi tu en as assez, reste deux secondes.');
    expect(filler).not.toContain('REPÈRE');
    expect(filler).not.toContain('COMMENTAIRES');
    expect(await chips('Plan de 14 jours', 'Le plan tient en 14 jours, avec une checklist à chaque chapitre.')).toContain('REPÈRE');
  });

  it('keeps the narrator\'s face clear of a caption of two lines', async () => {
    const line = 'Tenir un journal de sommeil pendant cinq longues nuits de suite, avec une heure de lever stable chaque matin';
    const beats: VideoBeat[] = [BEATS[1]!, { ...BEATS[3]!, kind: 'narrator', spoken: line, screen: 'Tenir un journal' }, BEATS[6]!]; // its page beside it: the head comes down to the caption
    const tl = timelineOf(cutOf({}, beats));
    const { comp, stage, assets } = await make(tl, { width: 1080 });
    expect(assets.proofs.size).toBe(1);
    const b = tl.beats.find((x) => x.kind === 'narrator')!;
    const twoLines = b.groups.find((g) => g.map((w) => w.text).join(' ').length > 15)!;
    comp.drawFrame(Math.round((b.t0 + twoLines[0]!.at + 0.25) * 30));
    const px = comp.canvas.data();
    const SKIN = ['#f2d0b8', '#e8b796', '#c68e6a', '#8d5b3e'].map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number]);
    const top = stage.captionY - 84 * 1.16 - 84 * 0.75; // the ink of a two-line caption
    let skin = 0;
    for (let y = Math.round(top); y < stage.captionY; y += 2) {
      for (let x = 100; x < 860; x += 2) {
        const i = (y * stage.w + x) * 4;
        if (SKIN.some(([r, g, bl]) => Math.abs(px[i]! - r) < 6 && Math.abs(px[i + 1]! - g) < 6 && Math.abs(px[i + 2]! - bl) < 6)) skin++;
      }
    }
    expect(skin).toBeLessThan(20); // no face behind it: the neck is a darker skin, on purpose
  });

  it('reads a buyer on a card: stars, the words the voice says, the first name, and no caption over them', async () => {
    const quote = 'Une vraie méthode, enfin claire';
    const beats: VideoBeat[] = [BEATS[1]!, { ...BEATS[4]!, spoken: `Un acheteur a écrit sur le guide : « ${quote} ».`, screen: 'Avis vérifié : 5/5' }, BEATS[6]!];
    const tl = timelineOf(cutOf({}, beats));
    const card = await make(tl, { pages: false, spec: { reviews: { 3: { quote, rating: 5, name: 'Sophie' } } } });
    const texts = card.comp.drawFrame(frameOf(tl, 'fact_card', 0.9)).map((b) => b.text).join(' ');
    expect(texts).toContain('— Sophie');
    expect(texts).toContain('méthode,');
    expect(texts).not.toContain('Avis vérifié');
    expect(texts).not.toMatch(/\b[A-ZÉ]{4,}\b(?<!ACHETEUR)(?<!AVIS)/); // captions are in capitals
    const stars = Uint8Array.from(card.comp.canvas.data());
    const anonymous = await make(tl, { pages: false, spec: { reviews: { 3: { quote, rating: null, name: null } } } });
    const unsigned = anonymous.comp.drawFrame(frameOf(tl, 'fact_card', 0.9)).map((b) => b.text).join(' ');
    expect(unsigned).toContain('Un acheteur du guide');
    expect(share(stars, anonymous.comp.canvas.data())).toBeGreaterThan(0.01);
    const boxes = card.comp.drawFrame(frameOf(tl, 'fact_card', 0.9));
    expect(boxes.filter((b) => !insideSafe(card.stage, b))).toEqual([]);
  });

  const reviewTimeline = (quote: string) => timelineOf(cutOf({}, [BEATS[1]!, { ...BEATS[4]!, spoken: `Un acheteur a écrit sur le guide : « ${quote} ».`, screen: 'Avis vérifié : 5/5' }, BEATS[6]!]));
  /** Text the camera takes out of the zone, on the settled frames of the card: at its widest the shot pushes a line onto the edge. */
  const outOfReview = (comp: Compositor, stage: Stage, tl: Timeline, step: number): string[] => {
    const beat = tl.beats[1]!;
    const left: string[] = [];
    for (let f = Math.ceil((beat.t0 + 0.3) * tl.fps); f < (beat.t0 + beat.dur) * tl.fps; f += step) left.push(...comp.drawFrame(f).filter((b) => !insideSafe(stage, b)).map((b) => b.text));
    return left;
  };

  it.each(['9:16', '4:5', '1:1'] as VideoRatio[])('%s: a review shrinks to a word that cannot break, it does not run off the zone', async (ratio) => {
    for (const quote of ['Parfait pour les micro-entrepreneurs débutants', 'Incompréhensiblement absent ailleurs']) {
      const tl = reviewTimeline(quote);
      for (const card of [{ quote, rating: 5, name: 'Sophie' }, { quote, rating: null, name: null }]) {
        const { comp, stage } = await make(tl, { pages: false, ratio, spec: { ratio, reviews: { 3: card } } });
        expect(outOfReview(comp, stage, tl, 3), quote).toEqual([]);
      }
    }
  });

  it('a line of a review opening on a « j » stays in the zone: its ink reaches further left than a capital', async () => {
    const quote = 'Malheureusement je ne connaissais pas';
    const read = `Un acheteur a écrit sur le guide : « ${quote} », et il l’a dit sans détour à tous ceux qui hésitaient encore sur la boutique en ligne.`; // long enough for the push to reach its end
    const tl = timelineOf(cutOf({}, [BEATS[1]!, { ...BEATS[4]!, spoken: read, screen: 'Avis vérifié : 5/5' }, BEATS[6]!]));
    const { comp, stage } = await make(tl, { pages: false, width: 540, spec: { reviews: { 3: { quote, rating: null, name: null } } } }); // a small render forgives 2 px of the master
    expect(outOfReview(comp, stage, tl, 3)).toEqual([]);
  });

  it('a quick title draws one frame whatever was drawn before: the camera leaves no ring of old pixels', async () => {
    const beats: VideoBeat[] = [
      { kind: 'title_card', scene: 0, spoken: '', screen: '', estSec: 0.25, shots: 1 },
      { kind: 'slide', scene: 0, spoken: '', screen: 'Le balcon en 8 étapes', estSec: 3, shots: 1 },
      { kind: 'slide', scene: 1, spoken: '', screen: 'Mesurer le soleil, heure par heure', estSec: 3, shots: 1 },
      BEATS[6]!,
    ];
    const cut: VideoCut = { ...cutOf({ captionWords: 9 }, beats), sfx: false };
    const tl = buildTimeline(cut, beats.map(() => spoken('')), TEMPO_BPM.standard);
    const { comp } = await make(tl, { pages: false, spec: { format: 'text_slideshow', cut } });
    for (const frame of [0, 3, 7]) {
      comp.drawFrame(frame);
      const first = sha(Uint8Array.from(comp.canvas.data()));
      comp.drawFrame(150);
      comp.drawFrame(frame);
      expect(sha(Uint8Array.from(comp.canvas.data())), `frame ${frame}`).toBe(first);
    }
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
