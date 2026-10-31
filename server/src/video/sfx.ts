// The SFX and where they fall on a timeline. Procedural: no sample, no licence.
import { createRng } from '../core/rng.js';
import type { BeatKind } from '../shared.js';
import { SR, type SfxCue } from './mix.js';

export function whoosh(rnd: () => number, dur = 0.26): Float32Array {
  const n = Math.floor(dur * SR);
  const s = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const w = rnd() * 2 - 1;
    const c = 0.04 + 0.5 * Math.sin(Math.PI * x) ** 2;
    lp += c * (w - lp);
    s[i] = lp * Math.sin(Math.PI * x) ** 1.5;
  }
  return s;
}

export function pop(): Float32Array {
  const n = Math.floor(0.09 * SR);
  const s = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * (920 * Math.exp(-t * 30) + 240) / SR;
    s[i] = Math.sin(ph) * Math.exp(-t * 42);
  }
  return s;
}

export function ding(): Float32Array {
  const n = Math.floor(0.7 * SR);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    s[i] = Math.exp(-t * 6) * (Math.sin(2 * Math.PI * 1318.5 * t) + 0.5 * Math.sin(2 * Math.PI * 1975.5 * t) + 0.25 * Math.sin(2 * Math.PI * 2637 * t)) * 0.6;
  }
  return s;
}

export function impact(): Float32Array {
  const n = Math.floor(0.42 * SR);
  const s = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * (38 + 90 * Math.exp(-t * 24)) / SR;
    s[i] = Math.tanh(2 * Math.sin(ph)) * Math.exp(-t * 7);
  }
  return s;
}

/** What `sfxCues` reads of a timeline beat. `t0` from the start of the file, word times from the start of the beat. */
export interface CueBeat {
  kind: BeatKind;
  t0: number;
  dur: number;
  words?: { text: string; at: number }[];
}

/** A whoosh on each beat change, an impact on the first frame and the end card, a pop on what appears, a ding on the gift. `seed` is `hashString(hook)`. */
export function sfxCues(beats: CueBeat[], seed: number): SfxCue[] {
  const rnd = createRng(seed).next;
  const cues: SfxCue[] = [];
  if (beats.length) cues.push({ at: 0, sig: impact(), gain: 0.5 });
  beats.forEach((b, i) => {
    if (i > 0) cues.push({ at: b.t0 - 0.13, sig: whoosh(rnd), gain: 0.24, pan: i % 2 ? 0.3 : -0.3 });
    if (b.kind === 'pain_bubble') cues.push({ at: b.t0 + 0.55, sig: pop(), gain: 0.34 });
    if (b.kind === 'page_proof') cues.push({ at: b.t0 + b.dur * 0.2, sig: pop(), gain: 0.22 }); // the marker's sweep
    if (b.kind === 'bonus_stack') {
      const gift = b.words?.find((w) => /cadeau/i.test(w.text));
      cues.push({ at: b.t0 + (gift?.at ?? 2), sig: ding(), gain: 0.24 });
    }
    if (b.kind === 'end_card') {
      cues.push({ at: b.t0 + 0.05, sig: impact(), gain: 0.34 });
      cues.push({ at: b.t0 + 0.25, sig: pop(), gain: 0.34 });
    }
  });
  return cues;
}
