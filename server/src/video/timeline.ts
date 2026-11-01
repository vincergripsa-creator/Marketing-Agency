/**
 * The cut and its spoken lines, in seconds: when each beat starts, what is on screen, where the camera jumps
 * (video §4.3). Pure. Real durations replace the estimates here and nowhere else: they never reach the world.
 */
import type { VideoBeat, VideoCut, VideoTempo } from '../shared.js';
import { norm } from '../sim/text.js';
import type { SpokenLine, SpokenWord } from './speech.js';

export const FPS = 30;
export const BEAT_GAP = 0.16;
export const TEMPO_BPM: Record<VideoTempo, number> = { calm: 88, standard: 112, fast: 128 };
export const PUNCH_SEC = 0.16;  // a cut falls back to rest over this
export const SETTLE_SEC = 0.2;  // QA reads a caption group this long after its first word

const CAPTION_CHARS = 16;       // at 3 words a group
const HOOK_WORDS = 9;           // a screen is a clause: past this it is a sentence, and the type would shrink to hold it
const HOOK_MIN = 3;             // « Au début, » says nothing alone
const HOOK_SHARE = 0.6;         // of the screen's words, said in order: under that the screen is another line than the voice's
const MIN_SHOT_SEC = 0.3;
const HIT_GAP = 0.25;           // QA's own gap between two cuts
const PLAIN_CAPTION = 6;        // words a caption: the decision only the lowest band of editors takes (video §3.3)
const PILL_CAPTION = 3;         // words a caption: over that a pill no longer finds its word
const QUICK_TITLE = 0.5;        // a card this short cannot be read: the film opens on its first screen, and the card only holds the voice back
const BAR = 8;                  // 8th notes
const BOOK_LATE_SEC = 1.2;      // a kinetic hook lands on its guide this far in
const BOOK_LATE_SHARE = 0.6;    // of the hook, on a short one

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
export const eOut = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
export const eIO = (x: number): number => { const v = clamp01(x); return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; };
export const eBack = (x: number, s = 2.2): number => { const v = clamp01(x) - 1; return v * v * ((s + 1) * v + s) + 1; };

export interface TimelineBeat extends VideoBeat {
  index: number;
  t0: number;
  dur: number;
  speech: number;              // seconds of voice, 0 on a silent beat
  words: SpokenWord[];         // seconds inside the beat
  groups: SpokenWord[][];      // what is on screen together: a caption, or a screen of the hook
  shotAt: number[];            // starts of its shots, the first is 0
}

export interface Timeline {
  fps: number;
  bpm: number;
  tempo: VideoTempo;
  total: number;
  frames: number;
  beats: TimelineBeat[];
  pill: boolean;               // the spoken word sits on a pill: a line of 6 words has no word to light
  plain: boolean;              // the lowest band of editors: nothing hits, the type stands centred, the page holds on its line
  bookSec: number | null;      // seconds into the hook where the guide rises. Null: it enters from the bonus on
  sfx: boolean;
}

/** The end card's second state: its price lands here, however long the voice holds the card. */
export const priceAt = (dur: number): number => Math.max(0.42, dur * 0.4);

export const quickTitle = (b: Pick<VideoBeat, 'kind' | 'estSec'>): boolean => b.kind === 'title_card' && b.estSec < QUICK_TITLE;

/** Seconds the opening screen stood before its own beat: the quick card in front of it. */
export function leadIn(tl: Pick<Timeline, 'beats'>, b: Pick<TimelineBeat, 'index'>): number {
  const before = tl.beats[b.index - 1];
  return before && quickTitle(before) ? before.dur : 0;
}

/** Cut after punctuation, at `maxWords`, or when the next word overflows the line. */
export function captionGroups(words: readonly SpokenWord[], maxWords = 3): SpokenWord[][] {
  const maxChars = CAPTION_CHARS * Math.max(1, maxWords / 3);
  const groups: SpokenWord[][] = [];
  let cur: SpokenWord[] = [];
  const size = (g: SpokenWord[]): number => g.reduce((sum, w) => sum + w.text.length + 1, 0);
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (/[.,:;!?»]+$/.test(w.text) || cur.length >= maxWords || (next && size(cur) + next.text.length > maxChars)) {
      groups.push(cur);
      cur = [];
    }
  });
  if (cur.length) groups.push(cur);
  return groups;
}

/** One screen per clause. */
function clauses(words: readonly SpokenWord[]): SpokenWord[][] {
  const screens: SpokenWord[][] = [];
  let cur: SpokenWord[] = [];
  for (const w of words) {
    cur.push(w);
    if ((/[,.:;!?…»]$/.test(w.text) && cur.length >= HOOK_MIN) || cur.length >= HOOK_WORDS) { screens.push(cur); cur = []; }
  }
  const last = screens.at(-1);
  if (last && cur.length && cur.length < HOOK_MIN && !/[.!?…]$/.test(last.at(-1)!.text)) last.push(...cur); // « IMPRIMER » alone says nothing either
  else if (cur.length) screens.push(cur);
  return screens;
}

/** A word for comparison: « L’erreur » and « erreur », « dernière. » and « Dernière » are one word. */
const bareWord = (w: string): string => norm(w).replace(/^[a-z]'/, '').replace(/[^a-z0-9]/g, '');

/** A screen as it is written, marks on their words. */
function screenWords(screen: string): string[] {
  const words: string[] = [];
  let open = '';
  for (const raw of screen.trim().split(/\s+/).filter(Boolean)) {
    if (/[\p{L}\p{N}]/u.test(raw)) { words.push(open + raw); open = ''; }
    else if (raw === '«') open = '«\u00a0';
    else if (words.length) words[words.length - 1] += `\u00a0${raw}`;
  }
  return words;
}

/**
 * The line written to stand alone, on the first screen of the hook: with the sound off it is the ad. The voice times it:
 * each word lights when it is said, one the voice does not say rises with the next one it does. Null: the voice says another line.
 */
function standingLine(screen: string, words: readonly SpokenWord[]): { line: SpokenWord[]; rest: readonly SpokenWord[] } | null {
  const tokens = screenWords(screen);
  let from = 0;
  const hits = tokens.map((token) => {
    const bare = bareWord(token);
    const at = words.findIndex((w, i) => i >= from && bareWord(w.text) === bare);
    if (at >= 0) from = at + 1;
    return at;
  });
  if (!from || hits.filter((h) => h >= 0).length < tokens.length * HOOK_SHARE) return null;
  const line = tokens.map((text, i) => {
    const said = words[hits[i]! >= 0 ? hits[i]! : hits.slice(i).find((h) => h >= 0) ?? from - 1]!;
    return { text, at: said.at, end: said.end };
  });
  return { line, rest: words.slice(from) };
}

/** The hook's screens: the line that stands alone when the script has one, then the rest of the voice, clause by clause. */
function hookScreens(words: readonly SpokenWord[], screen: string): SpokenWord[][] {
  const standing = standingLine(screen, words);
  return standing ? [standing.line, ...clauses(standing.rest)] : clauses(words);
}

/** Even shots, each moved to the nearest change of text when one is close: a jump on a new word reads as an edit. */
function shotTimes(shots: number, dur: number, groups: readonly SpokenWord[][]): number[] {
  const starts = groups.map((g) => g[0]!.at).filter((at) => at > 0);
  const span = dur / Math.max(1, shots);
  const out = [0];
  for (let k = 1; k < shots; k++) {
    const ideal = k * span;
    const near = starts.reduce<number | null>((best, at) => (best === null || Math.abs(at - ideal) < Math.abs(best - ideal) ? at : best), null);
    const at = near !== null && Math.abs(near - ideal) < span / 2 ? near : ideal;
    if (at >= out[out.length - 1]! + MIN_SHOT_SEC && at <= dur - MIN_SHOT_SEC) out.push(at);
  }
  return out;
}

/**
 * A plan of estimates: real speech must not bring a weak editor's guide up inside a hook that merely ran long. A kinetic hook
 * still lands on its guide, on its last words: that rise is the film's, the market pays for the early guide of `productSec` alone (D130).
 */
function bookInHook(cut: VideoCut, plain: boolean): number | null {
  const { productSec, hookWordSec } = cut.metrics;
  const hook = cut.beats.find((b) => b.kind === 'hook');
  if (!hook) return null;
  if (productSec !== null && productSec < hookWordSec + hook.estSec) return Math.max(0, productSec - hookWordSec);
  return plain ? null : Math.min(BOOK_LATE_SEC, hook.estSec * BOOK_LATE_SHARE);
}

/** `speech` holds one line per beat, same order: `synthesize` gives it, an estimate when the machine has no voice. */
export function buildTimeline(cut: VideoCut, speech: readonly SpokenLine[], bpm: number): Timeline {
  const eighth = 30 / bpm;
  let t0 = 0;
  const beats = cut.beats.map((beat, index): TimelineBeat => {
    const line = speech[index];
    const words = line?.words ?? [];
    const voice = words.length ? line!.speechSec : 0;
    const grid = beat.kind === 'slide' ? eighth * BAR : eighth; // a slide has no voice to follow: hard cuts on the bar
    const dur = beat.kind === 'end_card'
      ? (voice ? voice + cut.metrics.endHoldSec : beat.estSec)
      : Math.ceil((t0 + (voice ? voice + BEAT_GAP : beat.estSec)) / grid - 1e-9) * grid - t0; // the cut lands on the music
    const groups = beat.kind === 'hook' ? hookScreens(words, beat.screen) : captionGroups(words, Math.max(3, cut.metrics.captionWords));
    const row = { ...beat, index, t0, dur, speech: voice, words, groups, shotAt: shotTimes(beat.shots, dur, groups) };
    t0 += dur;
    return row;
  });
  const plain = cut.beats.some((b) => b.kind === 'slide') ? !cut.sfx : cut.metrics.captionWords >= PLAIN_CAPTION; // on a slide `captionWords` counts its text
  return {
    fps: FPS,
    bpm,
    tempo: cut.tempo,
    total: t0,
    frames: Math.round(t0 * FPS),
    beats,
    pill: cut.metrics.captionWords <= PILL_CAPTION,
    plain,
    bookSec: bookInHook(cut, plain),
    sfx: cut.sfx && !cut.beats.some((b) => b.kind === 'slide'), // a slideshow has the music at full level, nothing over it
  };
}

export function beatAtFrame(tl: Timeline, frame: number): TimelineBeat {
  const t = frame / tl.fps;
  return tl.beats.findLast((b) => t >= b.t0) ?? tl.beats[0]!;
}

/** The words that hit on a hook, as an eye counts them: two hits closer than this are one. */
function hookHits(b: TimelineBeat): number {
  let hits = 0;
  let last = -Infinity;
  for (const w of b.groups.flat()) if (w.at - last > HIT_GAP) { hits++; last = w.at; }
  return hits;
}

/** What a beat does past its shots, as QA's filter sees it: the camera that leaves for the marked line, the bubbles that land after the typing. */
function ownMoves(b: TimelineBeat, plain: boolean): number {
  if (b.kind === 'page_proof') return plain ? 0 : 1;
  return b.kind === 'pain_bubble' ? 1 + Math.min(1, b.items?.length ?? 0) : 0;
}

/** The cuts a viewer sees: the shots of the plan, what a beat does past them, and on a hook each new screen of type and, past a plain editor, each word that hits. */
export function plannedCuts(tl: Pick<Timeline, 'beats' | 'plain'>): number {
  return tl.beats.reduce((n, b) => n + (quickTitle(b) ? 0 : b.kind === 'hook' ? Math.max(b.shotAt.length, b.groups.length, tl.plain ? 0 : hookHits(b)) : b.shotAt.length + ownMoves(b, tl.plain)), 0);
}

/** The frames QA reads: one settled frame per group of text, one on each silent beat. */
export function settledFrames(tl: Timeline): number[] {
  const at = (sec: number): number => Math.min(tl.frames - 1, Math.round(sec * tl.fps));
  const frames = tl.beats.flatMap((b) => (b.groups.length
    ? b.groups.map((g) => at(b.t0 + g[0]!.at + SETTLE_SEC))
    : [at(b.t0 + Math.min(b.dur * 0.7, b.dur - 1 / tl.fps))]));
  return [...new Set(frames)];
}
