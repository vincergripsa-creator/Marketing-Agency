/**
 * The cut and its spoken lines, in seconds: when each beat starts, what is on screen, where the camera jumps
 * (video §4.3). Pure. Real durations replace the estimates here and nowhere else: they never reach the world.
 */
import type { VideoBeat, VideoCut, VideoTempo } from '../shared.js';
import type { SpokenLine, SpokenWord } from './speech.js';

export const FPS = 30;
export const BEAT_GAP = 0.16;
export const TEMPO_BPM: Record<VideoTempo, number> = { calm: 88, standard: 112, fast: 128 };
export const PUNCH_SEC = 0.16;  // a cut falls back to rest over this
export const SETTLE_SEC = 0.2;  // QA reads a caption group this long after its first word

const CAPTION_CHARS = 16;       // at 3 words a group
const HOOK_WORDS = 5;           // one screen per clause, 5 words at most
const MIN_SHOT_SEC = 0.3;

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
  pill: boolean;               // the spoken word sits on a pill: only the best editors do it
  bookSec: number | null;      // seconds into the hook where the guide rises. Null: it enters from the bonus on
  sfx: boolean;
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

function hookScreens(words: readonly SpokenWord[]): SpokenWord[][] {
  const screens: SpokenWord[][] = [];
  let cur: SpokenWord[] = [];
  for (const w of words) {
    cur.push(w);
    if (/[,.:;!?]$/.test(w.text) || cur.length >= HOOK_WORDS) { screens.push(cur); cur = []; }
  }
  if (cur.length) screens.push(cur);
  return screens;
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

/** A plan of estimates: real speech must not bring a weak editor's guide up inside a hook that merely ran long. */
function bookInHook(cut: VideoCut): number | null {
  const { productSec, hookWordSec } = cut.metrics;
  const hook = cut.beats.find((b) => b.kind === 'hook');
  return hook && productSec !== null && productSec < hookWordSec + hook.estSec ? Math.max(0, productSec - hookWordSec) : null;
}

/** `speech` holds one line per beat, same order: `synthesize` gives it, an estimate when the machine has no voice. */
export function buildTimeline(cut: VideoCut, speech: readonly SpokenLine[], bpm: number): Timeline {
  const eighth = 30 / bpm;
  let t0 = 0;
  const beats = cut.beats.map((beat, index): TimelineBeat => {
    const line = speech[index];
    const words = line?.words ?? [];
    const voice = words.length ? line!.speechSec : 0;
    const dur = beat.kind === 'end_card'
      ? (voice ? voice + cut.metrics.endHoldSec : beat.estSec)
      : Math.ceil((t0 + (voice ? voice + BEAT_GAP : beat.estSec)) / eighth - 1e-9) * eighth - t0; // the cut lands on the music
    const groups = beat.kind === 'hook' ? hookScreens(words) : captionGroups(words, Math.max(3, cut.metrics.captionWords));
    const row = { ...beat, index, t0, dur, speech: voice, words, groups, shotAt: shotTimes(beat.shots, dur, groups) };
    t0 += dur;
    return row;
  });
  return {
    fps: FPS,
    bpm,
    tempo: cut.tempo,
    total: t0,
    frames: Math.round(t0 * FPS),
    beats,
    pill: cut.metrics.captionWords <= 2,
    bookSec: bookInHook(cut),
    sfx: cut.sfx,
  };
}

export function beatAtFrame(tl: Timeline, frame: number): TimelineBeat {
  const t = frame / tl.fps;
  return tl.beats.findLast((b) => t >= b.t0) ?? tl.beats[0]!;
}

/** The frames QA reads: one settled frame per group of text, one on each silent beat. */
export function settledFrames(tl: Timeline): number[] {
  const at = (sec: number): number => Math.min(tl.frames - 1, Math.round(sec * tl.fps));
  const frames = tl.beats.flatMap((b) => (b.groups.length
    ? b.groups.map((g) => at(b.t0 + g[0]!.at + SETTLE_SEC))
    : [at(b.t0 + Math.min(b.dur * 0.7, b.dur - 1 / tl.fps))]));
  return [...new Set(frames)];
}
