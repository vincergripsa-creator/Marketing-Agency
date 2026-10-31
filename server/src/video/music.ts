// The procedural bed: pure JS, one hook is one track, no sample, no licence.
import { createRng } from '../core/rng.js';
import { hashString } from '../core/ids.js';
import type { VideoTempo } from '../shared.js';
import { SR, add, stereo, type Stereo } from './mix.js';
import { TEMPO_BPM } from './timeline.js';

export type MusicMode = 'major' | 'minor';
export interface MusicOptions { bpm: number; root: number; seed: number; mode: MusicMode }

const MINOR_FAMILIES = new Set(['mental', 'argent', 'tech']);
const ROOT_LOW = 52;
const ROOT_HIGH = 60;

/** One hook is one track, in the mood of its family. The tempo is heard as well as seen: shot length, BPM, caption speed. */
export function musicFor(hook: string, family: string | undefined, tempo: VideoTempo): MusicOptions {
  const seed = hashString(hook);
  return {
    bpm: TEMPO_BPM[tempo],
    root: ROOT_LOW + seed % (ROOT_HIGH - ROOT_LOW + 1),
    seed,
    mode: family && MINOR_FAMILIES.has(family) ? 'minor' : 'major',
  };
}

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

function kick(): Float32Array {
  const n = Math.floor(0.22 * SR);
  const s = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 48 + 120 * Math.exp(-t * 38);
    ph += 2 * Math.PI * f / SR;
    s[i] = Math.tanh(1.6 * Math.sin(ph)) * Math.exp(-t * 13);
  }
  return s;
}

function hat(rnd: () => number, open: boolean): Float32Array {
  const n = Math.floor((open ? 0.16 : 0.05) * SR);
  const s = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const w = rnd() * 2 - 1;
    const hp = w - prev;
    prev = w;
    s[i] = hp * Math.exp(-t * (open ? 22 : 75));
  }
  return s;
}

function clap(rnd: () => number): Float32Array {
  const n = Math.floor(0.18 * SR);
  const s = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const w = rnd() * 2 - 1;
    lp += 0.35 * (w - lp);
    const env = (t < 0.012 ? 0.7 : 0) + (t > 0.018 && t < 0.03 ? 0.7 : 0) + (t > 0.034 ? Math.exp(-(t - 0.034) * 26) : 0);
    s[i] = (w - lp) * env;
  }
  return s;
}

/** Soft electric-piano pluck: FM on the fundamental, a detuned sine and a third partial, fast decay. */
function pluck(freq: number, dur: number): Float32Array {
  const n = Math.floor(dur * SR);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 5.5);
    const fm = Math.sin(2 * Math.PI * freq * 2 * t) * 1.1 * Math.exp(-t * 16);
    s[i] = env * (Math.sin(2 * Math.PI * freq * t + fm) + 0.4 * Math.sin(2 * Math.PI * freq * 1.003 * t) + 0.12 * Math.sin(2 * Math.PI * freq * 3 * t));
  }
  return s;
}

function pad(freqs: number[], dur: number): Float32Array {
  const n = Math.floor(dur * SR);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.25) * Math.min(1, (dur - t) / 0.3);
    let v = 0;
    for (const f of freqs) v += Math.sin(2 * Math.PI * f * t + 0.6 * Math.sin(2 * Math.PI * 0.3 * t)) + 0.5 * Math.sin(2 * Math.PI * f * 2.002 * t);
    s[i] = env * v / freqs.length;
  }
  return s;
}

function sub(freq: number, dur: number): Float32Array {
  const n = Math.floor(dur * SR);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.01) * Math.min(1, (dur - t) / 0.03);
    s[i] = env * Math.tanh(1.4 * Math.sin(2 * Math.PI * freq * t));
  }
  return s;
}

const PROGRESSIONS: Record<MusicMode, number[][]> = {
  major: [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, -1, 2, 5]],
  minor: [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -3, 0, 5], [-2, 2, 5, 8]],
};
const ARPEGGIO = [0, 2, 1, 3, 2, 1, 3, 2];
const NOTE_ODDS = 0.72;         // 28 % rests

/** A 4-chord bed, one second longer than asked: kick on 1 and 3, clap on 2 and 4 from bar 2, 8th hats, sub on the root, pluck arpeggio, soft pad. Peak about 0.45. */
export function makeMusic(totalSec: number, { bpm, root, seed, mode }: MusicOptions): Stereo {
  const rnd = createRng(seed).next;
  const buf = stereo(Math.ceil((totalSec + 1) * SR));
  const beat = 60 / bpm;
  const progression = PROGRESSIONS[mode];
  const K = kick();
  const CL = clap(rnd);
  const bars = Math.ceil(totalSec / (beat * 4)) + 1;
  for (let b = 0; b < bars; b++) {
    const t0 = b * 4 * beat;
    const ch = progression[b % progression.length];
    add(buf, t0, pad(ch.map((x) => midi(root + x)), beat * 4 + 0.2), 0.05, 0);
    add(buf, t0, sub(midi(root - 24 + ch[0]), beat * 1.8), 0.20, 0);
    add(buf, t0 + 2 * beat, sub(midi(root - 24 + ch[0]), beat * 1.4), 0.18, 0);
    add(buf, t0 + 3.5 * beat, sub(midi(root - 24 + ch[2] - 12), beat * 0.45), 0.14, 0);
    for (let s = 0; s < 8; s++) {
      const at = t0 + s * beat / 2 + (s % 2 ? 0.012 : 0);
      add(buf, at, hat(rnd, s % 4 === 3), s % 2 ? 0.05 : 0.028, s % 2 ? 0.25 : -0.25);
      if (rnd() < NOTE_ODDS) {
        const tone = ch[ARPEGGIO[s]] + (s === 7 ? 12 : 0) + 12;
        add(buf, at, pluck(midi(root + tone), 0.6), 0.085, Math.sin(s) * 0.4);
      }
    }
    add(buf, t0, K, 0.34);
    add(buf, t0 + 2 * beat, K, 0.30);
    if (b >= 1) {
      add(buf, t0 + beat, CL, 0.12, 0.05);
      add(buf, t0 + 3 * beat, CL, 0.12, -0.05);
    }
  }
  return buf;
}
