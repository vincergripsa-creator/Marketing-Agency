/**
 * What the market reads of an edit (video §3.5, §3.6). `scoreCut` is pure: the score recomputes pace and look from the
 * metrics, never from a file, so rendering cannot move the simulation. `tempoFit` is the one market fact: what a niche
 * likes to watch, hidden, and learnable because it shows in the numbers.
 */
import { streamRng } from '../core/index.js';
import { wrapText } from '../deliverables/text.js';
import { TEMPOS } from '../deliverables/videoCut.js';
import type { AdCreative, NicheTruth, VideoCut, VideoTempo } from '../shared.js';
import { fmtNum } from './text.js';

export const VIDEO_MARKET = { tempoMatch: 1.08, tempoOpposite: 0.92 };
/** Market truth at creation (§2.6), next to `CHANNEL_STREAM.truth`. */
const VIDEO_TASTE_STREAM = 0xc4a702;

/** The narrowest box of the master (zone B of video §2), at the smallest size a phone reads there. Montserrat stands behind Helvetica's metrics. */
const SCREEN_BOX = { width: 815, lines: 3, minSize: 56 } as const;

type Knots = readonly (readonly [number, number])[];

/** Linear between the knots, flat past both ends. */
function along(x: number, knots: Knots): number {
  const [firstX, firstY] = knots[0]!;
  if (x <= firstX) return firstY;
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1]!;
    const [x1, y1] = knots[i]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return knots[knots.length - 1]![1];
}

const SHOT: Knots = [[0.8, 0.6], [1.2, 1], [1.8, 1], [2.2, 0.8], [3.6, 0.2]];
const DURATION: Knots = [[12, 0.8], [15, 1], [28, 1], [34, 0.5], [45, 0.1]];
const END_HOLD: Knots = [[0.8, 0.3], [1.2, 0.7], [1.8, 1]];

const hookScore = (sec: number): number => (sec <= 0.1 ? 1 : sec <= 0.3 ? 0.85 : sec <= 0.6 ? 0.5 : 0.15);
const varietyScore = (kinds: number): number => (kinds >= 5 ? 1 : kinds === 4 ? 0.8 : kinds === 3 ? 0.5 : 0.2);
const captionScore = (words: number): number => (words <= 3 ? 1 : words === 4 ? 0.7 : 0.3);
const slideWordsScore = (words: number): number => (words <= 12 ? 1 : words <= 16 ? 0.7 : 0.3);
const cardCountScore = (cards: number): number => (cards >= 4 && cards <= 8 ? 1 : cards === 3 || cards === 9 ? 0.6 : 0.2);

const fitsScreen = (text: string): boolean => wrapText(text, SCREEN_BOX.width, 'Helvetica-Bold', SCREEN_BOX.minSize).length <= SCREEN_BOX.lines;

/** Pure stand-in for the text check of the real file, which can never reach the market (video §10). */
export function scoreCut(cut: VideoCut): { pace: number; look: number; craft: number; notes: string[] } {
  const m = cut.metrics;
  const slides = cut.beats.some((b) => b.kind === 'slide');
  const cards = slides && m.avgShotSec === 0;
  const hookP = hookScore(m.hookWordSec);
  const shotP = cards ? 1 : along(m.avgShotSec, SHOT);
  const durP = cards ? cardCountScore(cut.beats.filter((b) => b.kind !== 'title_card').length) : along(m.estSec, DURATION);
  const pace = 0.4 * hookP + 0.35 * shotP + 0.25 * durP;

  const realPage = cut.beats.some((b) => b.proof);
  const earlyGuide = m.productSec !== null && m.productSec <= 0.2 * m.estSec;
  const proofP = (earlyGuide ? 0.5 : 0) + (realPage ? 0.5 : 0);
  const varP = varietyScore(m.kinds);
  const capP = slides ? slideWordsScore(m.captionWords) : captionScore(m.captionWords);
  const endP = along(m.endHoldSec, END_HOLD);
  const fitting = cut.beats.filter((b) => fitsScreen(b.screen)).length;
  const textP = cut.beats.length ? fitting / cut.beats.length : 0;
  const look = 0.3 * proofP + 0.25 * varP + 0.2 * capP + 0.15 * endP + 0.1 * textP;

  const notes: string[] = [];
  if (hookP < 0.85) notes.push(`Le texte arrive à ${fmtNum(m.hookWordSec)} s : le hook doit être là dès la première image.`);
  if (!cards && m.avgShotSec > 2.2) notes.push(`Plans trop longs (${fmtNum(m.avgShotSec)} s en moyenne).`);
  if (proofP === 0) notes.push('Le vrai guide n’apparaît qu’à la fin.');
  if (capP < 1) notes.push(`Trop de mots à lire d’un coup (${m.captionWords}).`);
  if (endP < 0.7) notes.push(`L’appel à l’action reste trop peu à l’écran (${fmtNum(m.endHoldSec)} s).`);
  if (textP < 1) notes.push('Textes à l’écran trop longs pour tenir dans la zone sûre.');
  return { pace, look, craft: Math.round(50 * pace + 50 * look), notes };
}

/** A niche's hidden taste: its own stream, so the market's own draws do not move. */
export function nicheTempo(seed: number, nicheIndex: number): VideoTempo {
  return TEMPOS[streamRng(seed, VIDEO_TASTE_STREAM, nicheIndex).int(0, 2)]!;
}

/** CTR factor of a cut's tempo in its niche: 1 without a cut or a truth, and it draws nothing. */
export function tempoFit(n: NicheTruth, c: AdCreative): number {
  const taste = n.videoTempo;
  const tempo = c.cut?.tempo;
  if (!taste || !tempo) return 1;
  if (taste === tempo) return VIDEO_MARKET.tempoMatch;
  return taste !== 'standard' && tempo !== 'standard' ? VIDEO_MARKET.tempoOpposite : 1;
}
