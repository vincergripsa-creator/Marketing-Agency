/**
 * The ads in the guide's own art language (design plan D206, D208): every text inside the platform's safe zones on every
 * format and ratio, the real cover in the first frame, the real page under the marker, the four looks of a single image
 * picked from the hook, the labels the law asks for, and the same bytes for the same ad.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coverScene } from '../src/deliverables/cover.js';
import { designFor } from '../src/deliverables/design.js';
import { compactPaths } from '../src/deliverables/pathData.js';
import {
  AD_LABEL, adTextBoxes, coverSticker, cutFrame, DRAWN_LABEL, insideZones, keyWords, masterFrame, quotableReview, renderAdCut, renderAdFiles, renderAdStoryboard,
  staticLookOf, VOICE_LABEL, type AdFrame,
} from '../src/deliverables/storyboard.js';
import type { AdCreative, AdFormat, AdScene, ArtStyle, ChapterContent, HookStyle, PdfContent, Product, Review } from '../src/shared.js';

const STEPS = ['Noter chaque sortie pendant trois jours dans un carnet', 'Sortir le chiot cinq minutes après chaque réveil', 'Récompenser dans les deux secondes, sur place'];

function chapter(k: number): ChapterContent {
  return {
    title: `Chapitre ${k + 1} : le rythme du chiot en appartement`,
    intro: 'Ce chapitre règle un point précis : ce qui se passe entre le réveil et la première sortie.',
    paragraphs: [
      'Un chiot de 8 à 12 semaines tient environ une heure par mois d’âge, plus une. Au-delà, l’accident n’est pas de la désobéissance.',
      'Les maîtres qui réussissent sortent le chiot avant qu’il ait envie, pas après l’accident : anticiper change tout.',
    ],
    steps: k === 0 ? STEPS : ['Garder le même endroit pour chaque sortie', 'Dire le mot-signal une seule fois, puis attendre'],
    example: null,
    checklist: ['Le carnet de sorties est ouvert', 'Les friandises sont dans la poche'],
    visual: { type: 'checklist_card', title: 'Le kit du premier mois', labels: ['Alèses lavables', 'Produit enzymatique', 'Friandises minuscules'], values: [] },
  };
}

const content: PdfContent = {
  title: 'Chiot propre en 21 jours : la méthode « zéro pipi » pour l’appartement',
  subtitle: 'Le plan heure par heure pour les nouveaux maîtres',
  audience: 'Nouveaux maîtres d’un chiot de 2 à 4 mois en appartement',
  promise: 'Votre chiot fait ses besoins dehors au bon endroit.',
  introduction: ['Il est 6 h 40, la flaque est sur le tapis du salon, encore.', 'Ce guide repart de zéro avec un plan précis.'],
  chapters: [0, 1, 2].map(chapter),
  bonus: { ...chapter(1), title: 'Bonus : le carnet de suivi de 21 jours' },
  nextStep: { title: 'Et maintenant : la marche en laisse', text: 'Place à la balade détendue.', upsellProductId: null },
  wordCount: 1800,
};

const REVIEWS: Review[] = [
  { id: 'rev_1', day: 4, customerId: 'cus_1', rating: 5, text: 'Enfin un plan clair : mon chiot est propre depuis dix jours.' },
  { id: 'rev_2', day: 5, customerId: 'cus_2', rating: 5, text: 'J’ai eu un problème de lien, réponse le jour même. Merci !' },
  { id: 'rev_3', day: 6, customerId: 'cus_3', rating: 3, text: 'Utile mais un peu long à lire le soir.' },
];

const productOf = (style: ArtStyle, reviews: Review[] = REVIEWS): Product => ({
  id: 'prd_sb', nicheId: 'proprete-chiot', title: content.title, subtitle: content.subtitle, audience: content.audience,
  problem: 'Le chiot fait ses besoins dans l’appartement.', price: 19, status: 'live', version: 1,
  content, design: { ...designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed: 11 }), style },
  salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 2,
  stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: reviews.length ? 4.3 : 0, reviews, upsellSales: 0 },
  priceHistory: [], pdfFacts: { pages: 18, sheets: 2 },
}) as unknown as Product;

const LONG = '1. Noter pendant 3 jours les heures de repas, de siestes et d’accidents, puis établir un planning de sorties toutes les 2 heures, une étape à la fois, sans sauter la suivante';

const SCENES: AdScene[] = [
  { visual: 'x', onScreenText: 'POV : tu arrêtes de gronder le chiot après coup', voiceover: 'POV : tu arrêtes enfin de gronder le chiot après coup.', durationSec: 3 },
  { visual: 'x', onScreenText: '« il le refait juste après la sortie »', voiceover: 'Si toi aussi tu te dis « il le refait juste après la sortie », reste deux secondes.', durationSec: 3 },
  { visual: 'x', onScreenText: `1. ${STEPS[0]}`, voiceover: `La méthode commence par un geste tout simple : ${STEPS[0].toLowerCase()}.`, durationSec: 5 },
  { visual: 'x', onScreenText: '« Enfin un plan clair »', voiceover: 'Un acheteur a écrit sur le guide : « Enfin un plan clair ».', durationSec: 4 },
  { visual: 'x', onScreenText: 'Bonus : le carnet de suivi', voiceover: 'Dans le guide : le plan et, en cadeau, le carnet de suivi.', durationSec: 3 },
  { visual: 'x', onScreenText: 'Guide PDF — lien en bio', voiceover: 'Le guide complet est en lien dans ma bio.', durationSec: 3 },
];

const creativeOf = (format: AdFormat, over: Partial<AdCreative> = {}): AdCreative => ({
  id: `cre_${format}`, productId: 'prd_sb', hook: SCENES[0]!.voiceover, hookStyle: 'pov', format, scenes: SCENES, caption: 'Le plan.', hashtags: ['chiot'],
  cta: 'Télécharge le guide (lien en bio)', files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 },
  createdDay: 1, createdBy: 'zoe', ...over,
});

const pinOf = (hookStyle: HookStyle, hook = 'Ton chiot fait pipi juste après la sortie ?'): AdCreative => creativeOf('static_image', {
  hookStyle, hook, cta: 'Télécharge le guide', scenes: [{ visual: 'x', onScreenText: hook, voiceover: '', durationSec: 5 }],
});

const RATIOS = ['9:16', '4:5', '1:1', '2:3'] as const;
const FORMATS: AdFormat[] = ['faceless_voiceover', 'text_slideshow', 'ugc_avatar', 'carousel'];
const STYLES: ArtStyle[] = ['bauhaus', 'typo'];
const input = (creative: AdCreative, style: ArtStyle = 'bauhaus', reviews?: Review[]) => {
  const product = productOf(style, reviews);
  return { creative, product, design: product.design!, brand: 'Pixel Agency' };
};

/** Every word the ad prints: its glyph groups and pills carry it in `aria-label`. */
const labels = (svg: string): string[] => [...svg.matchAll(/aria-label="([^"]*)"/g)]
  .map((m) => m[1]!.replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/[  ]/g, ' '));

afterEach(() => vi.restoreAllMocks());

describe('the frames of an ad', () => {
  it('keeps every text of every format inside the safe zones, on every ratio, a long screen included', () => {
    for (const style of STYLES) {
      for (const ratio of RATIOS) {
        for (const format of FORMATS) {
          for (const scenes of [SCENES, SCENES.map((s, i) => (i === 2 ? { ...s, onScreenText: LONG } : s))]) {
            const { frame, frames } = adTextBoxes({ ...input(creativeOf(format, { scenes }), style), ratio });
            expect(frames).toHaveLength(SCENES.length);
            for (const [i, boxes] of frames.entries()) {
              expect(boxes.length, `${style} ${ratio} ${format} ${i}`).toBeGreaterThan(1);
              for (const b of boxes) expect(insideZones(frame, b), `${style} ${ratio} ${format} scene ${i}: ${b.text}`).toBe(true);
            }
          }
        }
        for (const hookStyle of ['mistake', 'question', 'story', 'listicle'] as const) {
          const { frame, frames } = adTextBoxes({ ...input(pinOf(hookStyle), style), ratio });
          expect(frames).toHaveLength(1);
          for (const b of frames[0]!) expect(insideZones(frame, b), `${style} ${ratio} pin ${hookStyle}: ${b.text}`).toBe(true);
        }
      }
    }
  });

  it('uses TikTok’s zone on the master, Reels’ and Shorts’ where they are tighter, scaled to 360 × 640', () => {
    const f = masterFrame();
    expect([f.w, f.h]).toEqual([360, 640]);
    expect(f.zones[0]).toEqual({ x0: 40, x1: 320, y0: 96, y1: 280 }); // 120 px sides, 240 top (Shorts 288), the rail from 840
    expect(f.zones[1]!.x1).toBeCloseTo(296, 5); // the rail: 180 px, Shorts' 192
    expect(f.zones[1]!.y1).toBeCloseTo(416, 5); // 660 px at the foot, Reels' 35 % and Shorts' 672
    expect(insideZones(f, { x: 250, y: 300, w: 60, h: 20 })).toBe(false); // under the rail
    expect(insideZones(f, { x: 250, y: 200, w: 60, h: 20 })).toBe(true); // above it
    expect([cutFrame('2:3').w, cutFrame('2:3').h]).toEqual([1000, 1500]); // Pinterest's own pin
  });

  it('says what it is on every frame: « Publicité », the drawn narrator, the synthetic voice where a voice speaks (D208)', () => {
    for (const format of FORMATS) {
      for (const ratio of RATIOS) {
        const frames = ratio === '9:16' ? renderAdStoryboard(input(creativeOf(format))).frames : renderAdCut({ ...input(creativeOf(format)), ratio }).frames;
        for (const svg of frames) {
          const said = labels(svg);
          expect(said, `${format} ${ratio}`).toContain(AD_LABEL);
          expect(said.includes(DRAWN_LABEL), `${format} ${ratio}`).toBe(format === 'ugc_avatar');
          expect(said.includes(VOICE_LABEL), `${format} ${ratio}`).toBe(format === 'ugc_avatar' || format === 'faceless_voiceover');
          expect(svg).not.toContain('Sponsorisé'); // the platform's own word: the preview draws it where TikTok does
          expect(svg).not.toMatch(/#fe2c55/i); // no fake app, no counters
        }
      }
    }
    const [pin] = renderAdCut({ ...input(pinOf('mistake')), ratio: '2:3' }).frames;
    expect(labels(pin!)).toContain(AD_LABEL);
    expect(labels(pin!)).not.toContain(VOICE_LABEL);
  });

  it('shows the real cover from the first frame, and on the last one with the price of the day on its sticker spot', () => {
    for (const style of STYLES) {
      const product = productOf(style);
      const { meta } = coverScene({ title: product.title, subtitle: content.subtitle, audience: content.audience, design: product.design!, brand: 'Pixel Agency' });
      const title = meta.lines.filter((l) => l.size >= 20).map((l) => l.s.replace(/[  ]/g, ' '));
      for (const format of FORMATS) {
        const { frames } = renderAdStoryboard(input(creativeOf(format), style));
        for (const line of title) {
          expect(labels(frames[0]!), `${style} ${format}: ${line}`).toContain(line);
          expect(labels(frames.at(-1)!), `${style} ${format}: ${line}`).toContain(line);
        }
        expect(labels(frames.at(-1)!), `${style} ${format}`).toContain('19 €');
      }
      const spot = coverSticker(meta);
      expect(spot.u).toBeGreaterThan(0);
    }
  });

  it('points at the real page: the step under the marker, in the guide’s own words', () => {
    for (const format of ['faceless_voiceover', 'ugc_avatar', 'text_slideshow'] as const) {
      const { frames } = renderAdStoryboard(input(creativeOf(format)));
      const step = frames[2]!;
      expect(step, format).toContain('#ffe14d'); // the highlighter
      expect(labels(step).some((l) => l.includes(STEPS[0]!.split(' ').slice(0, 4).join(' '))), format).toBe(true);
    }
  });

  it('quotes the buyer the voice reads, says how the shop checks it, and never a « 5/5 » label', () => {
    const { frames } = renderAdStoryboard(input(creativeOf('faceless_voiceover', { scenes: SCENES.map((s, i) => (i === 3 ? { ...s, onScreenText: 'Avis vérifié : 5/5' } : s)) })));
    const said = labels(frames[3]!).join(' ');
    expect(said).toContain('Enfin un plan clair');
    expect(said).toContain('Acheteur vérifié');
    expect(said).not.toContain('5/5');
  });

  it('says where to go on the channel it runs on: the bio on TikTok, the link under a feed post, the pin on Pinterest', () => {
    const last = (ratio: (typeof RATIOS)[number]) => labels((ratio === '9:16' ? renderAdStoryboard(input(creativeOf('faceless_voiceover'))).frames : renderAdCut({ ...input(creativeOf('faceless_voiceover')), ratio }).frames).at(-1)!).join(' ');
    expect(last('9:16')).toMatch(/lien en bio/);
    expect(last('4:5')).not.toMatch(/lien en bio/);
    expect(last('4:5')).toMatch(/lien sous la publication/);
    expect(last('2:3')).toMatch(/lien sur l’épingle/);
    for (const ratio of RATIOS) expect(last(ratio)).toContain('Télécharge le guide');
    const swipe = renderAdCut({ ...input(creativeOf('carousel', { cta: 'Swipe jusqu’au bout et télécharge le guide (lien en bio)' })), ratio: '1:1' }).frames.at(-1)!;
    expect(labels(swipe)).toContain('Télécharge le guide');
    expect(swipe).not.toContain('Swipe');
  });

  it('lights one key word: a figure with its unit first, else the word the sentence leans on', () => {
    expect(keyWords('Plan de 14 jours pour dormir'.split(' '))).toEqual([2, 3]);
    expect(keyWords('POV : tu arrêtes de gronder le chiot'.split(' '))).toEqual([3]);
    expect(keyWords('et le la'.split(' '))).toEqual([]);
  });

  it('draws the same bytes for the same ad, with no world draw and no clock', () => {
    const random = vi.spyOn(Math, 'random');
    const now = vi.spyOn(Date, 'now');
    for (const format of [...FORMATS, 'static_image'] as AdFormat[]) {
      const creative = format === 'static_image' ? pinOf('question') : creativeOf(format);
      expect(renderAdCut({ ...input(creative, 'typo'), ratio: '4:5' })).toEqual(renderAdCut({ ...input(creative, 'typo'), ratio: '4:5' }));
      expect(renderAdStoryboard(input(creative, 'typo'))).toEqual(renderAdStoryboard(input(creative, 'typo')));
    }
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('stays light enough to keep: a frame under 320 kB, a preview under 1,2 MB', () => {
    for (const style of STYLES) {
      for (const format of FORMATS) {
        const { frames, previewHtml } = renderAdStoryboard(input(creativeOf(format), style));
        for (const f of frames) expect(f.length, `${style} ${format}`).toBeLessThan(320_000);
        expect(previewHtml.length, `${style} ${format}`).toBeLessThan(1_200_000);
      }
    }
  });

  it('draws a frame for a guide with no page and no cover to read, never a crash', () => {
    const bare = { ...productOf('bauhaus'), content: undefined, title: '' } as unknown as Product;
    for (const format of FORMATS) {
      const { frames } = renderAdStoryboard({ creative: creativeOf(format), product: bare, design: bare.design!, brand: '' });
      expect(frames).toHaveLength(SCENES.length);
      for (const f of frames) expect(labels(f)).toContain(AD_LABEL);
    }
  });
});

describe('a single image', () => {
  it('wears the look its hook calls for, never at random, and falls back when the look has nothing true to show', () => {
    const p = productOf('bauhaus');
    expect(staticLookOf(pinOf('mistake'), p, true)).toBe('offer');
    expect(staticLookOf(pinOf('stat'), p, true)).toBe('offer');
    expect(staticLookOf(pinOf('question'), p, true)).toBe('text');
    expect(staticLookOf(pinOf('pov'), p, true)).toBe('text');
    expect(staticLookOf(pinOf('story'), p, true)).toBe('review');
    expect(staticLookOf(pinOf('listicle'), p, true)).toBe('inside');
    expect(staticLookOf(pinOf('listicle'), p, false)).toBe('offer'); // no real page, no look inside
    expect(staticLookOf(pinOf('story'), productOf('bauhaus', []), true)).toBe('text'); // no review, no review card
  });

  it('quotes a real review about the guide, never one about the shop, never one made up', () => {
    expect(quotableReview(productOf('bauhaus'))?.id).toBe('rev_1');
    expect(quotableReview(productOf('bauhaus', [REVIEWS[1]!, REVIEWS[2]!]))).toBeNull();
    const [card] = renderAdCut({ ...input(pinOf('story', 'On a lu vos commentaires sur le chiot')), ratio: '2:3' }).frames;
    const said = labels(card!).join(' ');
    expect(said).toContain('Enfin un plan clair');
    expect(said).toContain('Acheteur vérifié');
    expect(said).not.toContain('problème de lien');
  });

  it('offer first: the cover, the price of the day, the rating with its count, the guide’s own promise, the button', () => {
    for (const ratio of RATIOS) {
      const said = labels(renderAdCut({ ...input(pinOf('mistake', 'L’erreur : gronder le chiot après coup')), ratio }).frames[0]!).join(' ');
      expect(said, ratio).toContain('19 €');
      expect(said, ratio).toMatch(/4,3\/5 · 3 avis vérifiés/);
      expect(said, ratio).toContain('La méthode « zéro pipi »');
      expect(said, ratio).toContain('Télécharge le guide');
    }
    const fresh = labels(renderAdCut({ ...input(pinOf('mistake'), 'bauhaus', []), ratio: '2:3' }).frames[0]!).join(' ');
    expect(fresh).toContain('Nouveau'); // no review: no stars, no count
    expect(fresh).not.toMatch(/avis vérifiés/);
  });

  it('what’s inside: real pages in a grid, the counts of the file', () => {
    const said = labels(renderAdCut({ ...input(pinOf('listicle', '3 étapes pour un chiot propre')), ratio: '2:3' }).frames[0]!).join(' ');
    expect(said).toContain('18 pages');
    expect(said).toContain('3 chapitres');
    expect(said).toContain('2 fiches à imprimer');
    expect(said).toContain('1 bonus');
  });

  it('text only: one strong sentence on a note, the guide signing it small', () => {
    const [note] = renderAdCut({ ...input(pinOf('question')), ratio: '4:5' }).frames;
    expect(labels(note!)).toContain('‹ Notes');
    expect(note).toContain('Texte seul');
  });

  it('a pin is one 1000 × 1500 image, its words at the top', () => {
    const [pin, ...rest] = renderAdCut({ ...input(pinOf('mistake', 'L’erreur : gronder le chiot après coup')), ratio: '2:3' }).frames;
    expect(rest).toEqual([]);
    expect(pin!.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1500" width="1000" height="1500"')).toBe(true);
    const { frame, frames } = adTextBoxes({ ...input(pinOf('mistake', 'L’erreur : gronder le chiot après coup')), ratio: '2:3' });
    const hook = frames[0]!.filter((b) => /erreur|gronder/i.test(b.text));
    expect(Math.max(...hook.map((b) => b.y + b.h))).toBeLessThan(frame.h * 0.3); // the overlay at the top, as Pinterest asks
  });

  it('never promises what the law forbids: no guarantee, no countdown, no scarcity', () => {
    for (const hookStyle of ['mistake', 'question', 'story', 'listicle', 'stat'] as const) {
      for (const ratio of RATIOS) {
        const said = labels(renderAdCut({ ...input(pinOf(hookStyle)), ratio }).frames[0]!).join(' ').toLowerCase();
        expect(said).not.toMatch(/garanti|plus que \d|derni[eè]re chance|offre limit|compte à rebours|aujourd’hui seulement/);
      }
    }
  });
});

describe('the phone preview', () => {
  it('plays the frames with the voice in captions, in TikTok’s own layout, and says what the ad is', () => {
    const { previewHtml, frames } = renderAdStoryboard(input(creativeOf('ugc_avatar'), 'typo'));
    expect(previewHtml).toContain('<html lang="fr">');
    expect(previewHtml).toContain('requestAnimationFrame'); // it plays by itself
    expect((previewHtml.match(/class="frame/g) ?? []).length).toBe(frames.length);
    expect(previewHtml).toContain('Sponsorisé'); // where the platform writes it
    for (const label of ['Format', 'Accroche', 'Look', 'Canal', 'Mentions']) expect(previewHtml).toContain(`<b>${label}</b>`);
    expect(previewHtml).toContain('Narrateur animé');
    expect(previewHtml).toContain('Typo XXL');
    expect(previewHtml).toContain('TikTok · 9:16');
    for (const m of [AD_LABEL, DRAWN_LABEL, VOICE_LABEL]) expect(previewHtml).toContain(`<span class="chip">${m}</span>`);
    expect(previewHtml).toContain('il le refait juste'); // the voice-over as captions
    expect(previewHtml).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // nothing loads from outside
  });

  it('names the look of a single image', () => {
    const { previewHtml } = renderAdStoryboard(input(pinOf('story', 'On a lu vos commentaires sur le chiot')));
    expect(previewHtml).toContain('look « Carte d’avis »');
  });
});

/** What lies between two marks of a text, the second one excluded. */
const between = (s: string, from: string, to: string): string => {
  const at = s.indexOf(from);
  return at < 0 ? '' : s.slice(at + from.length, s.indexOf(to, at + from.length));
};

/** Frame `k` (from 1) of a sheet as its own file draws it: its group, the pieces it shares put back, and its box's bar. */
function fromSheet(sheet: string, k: number): string {
  const defs = between(sheet, '<defs>', '</defs><view');
  const pieces = new Map<string, string>();
  for (let j = 0; defs.includes(`<g id="ar${j}">`); j++) pieces.set(`ar${j}`, between(defs, `<g id="ar${j}">`, defs.includes(`<g id="ar${j + 1}">`) ? `<g id="ar${j + 1}">` : '<g id="sc1">').replace(/<\/g>$/, ''));
  const next = defs.includes(`<g id="sc${k + 1}">`) ? `<g id="sc${k + 1}">` : '\u0000';
  const body = (next === '\u0000' ? defs.slice(defs.indexOf(`<g id="sc${k}">`) + `<g id="sc${k}">`.length) : between(defs, `<g id="sc${k}">`, next)).replace(/<\/g>$/, '');
  const bar = between(sheet, `<use href="#sc${k}"/>`, '</svg>');
  return body.replace(/<use href="#(ar\d+)"\/>/g, (_, id: string) => pieces.get(id)!) + bar;
}

/** The body of a frame's own file, path data compacted as the sheet's is. */
const bodyOf = (frame: string): string => {
  const c = compactPaths(frame);
  return c.slice(c.indexOf('</defs>') + '</defs>'.length, -'</svg>'.length);
};

/** The name a frame's own file gives itself, as written. */
const nameOf = (frame: string): string => /aria-label="([^"]*)"/.exec(frame)![1]!;

/** Every letter a drawing uses is defined in `defs` as in the frame's own file. */
function lettersHeld(drawing: string, frame: string, sheet: string): void {
  for (const [, id] of drawing.matchAll(/<use href="#(g[0-9a-z]+_[0-9a-z]+)"/g)) {
    const def = new RegExp(`<path id="${id}" d="[^"]*"/>`);
    expect(sheet.match(def)?.[0], id).toBe(compactPaths(frame).match(def)?.[0]);
  }
}

describe('the files of an ad', () => {
  it('keeps every frame once in the first file, its letters and its cover once; the others and the preview show it through its views', () => {
    for (const style of STYLES) {
      for (const format of FORMATS) {
        const inp = input(creativeOf(format), style);
        const board = renderAdStoryboard(inp);
        const files = renderAdFiles(inp, 'frame-1.svg');
        expect(files.frames, `${style} ${format}`).toHaveLength(board.frames.length);
        const sheet = files.frames[0]!;
        // shown alone, as the gallery shows it: the first frame, nothing loaded from outside
        expect(sheet).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 360 640" width="360" height="640" overflow="hidden" role="img"/);
        expect(sheet).not.toMatch(/<image\b|href="(?!#)/);
        expect(labels(sheet)[0]).toBe(labels(board.frames[0]!)[0]);
        board.frames.forEach((frame, i) => {
          const drawn = fromSheet(sheet, i + 1);
          expect(drawn, `${style} ${format} frame ${i + 1}`).toBe(bodyOf(frame));
          lettersHeld(drawn, frame, sheet);
          expect(sheet).toContain(`<view id="v${i + 1}" viewBox="${i * 360} 0 360 640"/>`);
        });
        files.frames.slice(1).forEach((f, i) => {
          expect(f).toContain(`<image href="frame-1.svg#v${i + 2}" width="360" height="640"/>`);
          expect(labels(f)[0]).toBe(labels(board.frames[i + 1]!)[0]);
        });
        // the preview plays the bare frames, the bar of the scenes is its own
        const bare = format !== 'carousel';
        expect(files.previewHtml).not.toContain('<svg xmlns');
        expect(files.previewHtml).toBe(board.previewHtml.replace(/(<div class="frame[^"]*" data-k="(\d+)" style="[^"]*">)<svg[\s\S]*?<\/svg>(<\/div>)/g,
          (_, open: string, k: string, close: string) => `${open}<img src="frame-1.svg#${bare ? 'p' : 'v'}${Number(k) + 1}" alt="${nameOf(board.frames[Number(k)]!)}">${close}`));
        if (bare) board.frames.forEach((_, i) => expect(sheet).toContain(`<view id="p${i + 1}" viewBox="${i * 360} 640 360 640"/>`));
        // a cover drawn in several frames is kept once
        const covers = (sheet.match(/<g clip-path="url\(#bkclip\)">/g) ?? []).length;
        expect(sheet.match(/<g clip-path="url\(#bkclip\)"><use href="#ar\d+"\/>/g)?.length ?? 0, `${style} ${format}`).toBe(covers > 1 ? covers : 0);
        const before = board.frames.reduce((n, f) => n + f.length, 0) + board.previewHtml.length;
        const after = files.frames.reduce((n, f) => n + f.length, 0) + files.previewHtml!.length;
        expect(after, `${style} ${format}`).toBeLessThan(before * 0.5);
      }
    }
  });

  it('a cut: the same frames in one file and its views, no preview; one image stands alone', () => {
    for (const format of [...FORMATS, 'static_image'] as AdFormat[]) {
      const creative = format === 'static_image' ? pinOf('listicle', '3 étapes pour un chiot propre') : creativeOf(format);
      for (const ratio of ['4:5', '2:3'] as const) {
        const cut = renderAdCut({ ...input(creative), ratio });
        const files = renderAdFiles({ ...input(creative), ratio }, 'frame-1.svg');
        expect(files.previewHtml).toBeNull();
        expect(files.frames).toHaveLength(cut.frames.length);
        if (cut.frames.length === 1) { expect(files.frames[0]).toBe(compactPaths(cut.frames[0]!)); continue; }
        cut.frames.forEach((frame, i) => expect(fromSheet(files.frames[0]!, i + 1), `${format} ${ratio} ${i + 1}`).toBe(bodyOf(frame)));
      }
    }
    expect(renderAdFiles({ ...input(creativeOf('carousel', { format: 'search_text' })), ratio: '4:5' }, 'frame-1.svg')).toEqual({ frames: [], previewHtml: null });
  });

  it('a single image of the master is one file, and its preview shows that file', () => {
    const files = renderAdFiles(input(pinOf('question')), 'frame-1.svg');
    expect(files.frames).toHaveLength(1);
    expect(files.frames[0]).toBe(compactPaths(renderAdStoryboard(input(pinOf('question'))).frames[0]!));
    expect(files.previewHtml).toContain('<img src="frame-1.svg" alt="Scène 1 : ');
  });
});

describe('frames of every size', () => {
  it.each(RATIOS)('%s: zones scaled from the platform’s own, inside the frame', (ratio) => {
    const f: AdFrame = cutFrame(ratio);
    for (const z of f.zones) {
      expect(z.x0).toBeGreaterThan(0);
      expect(z.x1).toBeLessThan(f.w);
      expect(z.y0).toBeGreaterThan(0);
      expect(z.y1).toBeLessThan(f.h);
    }
  });
});
