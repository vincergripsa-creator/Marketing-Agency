// The mix: music × a duck envelope + voice + SFX, and the WAV files around it. Pure JS on Float32Array.
import { readFileSync, writeFileSync } from 'node:fs';

export const SR = 44100;

export interface Stereo { L: Float32Array; R: Float32Array }
export interface VoiceClip { at: number; dur: number; pcm: Float32Array } // mono, at SR
export interface SfxCue { at: number; sig: Float32Array; gain?: number; pan?: number }
export interface MixInput {
  totalSec: number;
  music: Stereo;
  voices: VoiceClip[];         // empty: music at full level, no ducking
  sfx: SfxCue[];
  duckDb?: number;
}

const DUCK_DB = -11;
const LOOK_AHEAD_MS = 80;
const RELEASE_MS = 220;
const PEAK = 0.92;
const VOICE_GAIN = 0.95;

export function stereo(samples: number): Stereo {
  return { L: new Float32Array(samples), R: new Float32Array(samples) };
}

/** Equal-power placement of a mono signal. Whatever falls outside the buffer is dropped. */
export function add(buf: Stereo, at: number, sig: Float32Array, gain = 1, pan = 0): void {
  const l = Math.cos((pan + 1) * Math.PI / 4) * gain;
  const r = Math.sin((pan + 1) * Math.PI / 4) * gain;
  const i0 = Math.round(at * SR);
  for (let i = 0; i < sig.length; i++) {
    const k = i0 + i;
    if (k < 0 || k >= buf.L.length) continue;
    buf.L[k] += sig[i] * l;
    buf.R[k] += sig[i] * r;
  }
}

/** The word times are known, so no sidechain: voice presence per ms, smoothed ahead of the voice and after it. */
function duckEnvelope(totalSec: number, voices: VoiceClip[]): Float32Array {
  const ms = Math.ceil(totalSec * 1000);
  const on = new Float32Array(ms);
  for (const v of voices) {
    const end = Math.min(ms, (v.at + v.dur) * 1000);
    for (let i = Math.max(0, Math.floor(v.at * 1000)); i < end; i++) on[i] = 1;
  }
  const env = new Float32Array(ms);
  let e = 0;
  for (let i = ms - 1; i >= 0; i--) { e = on[i] ? 1 : e * Math.exp(-1 / LOOK_AHEAD_MS); env[i] = e; }
  e = 0;
  for (let i = 0; i < ms; i++) { e = Math.max(env[i], e * Math.exp(-1 / RELEASE_MS)); env[i] = e; }
  return env;
}

/** Soft clip then peak 0.92. Loudness is the encoder's job (`loudnorm`), so this file never measures it. */
export function mixDown({ totalSec, music, voices, sfx, duckDb = DUCK_DB }: MixInput): Stereo {
  const n = Math.ceil(totalSec * SR);
  const out = stereo(n);
  const ms = Math.ceil(totalSec * 1000);
  const env = duckEnvelope(totalSec, voices);
  const low = Math.pow(10, duckDb / 20);
  const musicEnd = Math.min(n, music.L.length);
  for (let i = 0; i < musicEnd; i++) {
    const g = 1 + (low - 1) * env[Math.min(ms - 1, Math.floor(i / SR * 1000))];
    const fade = Math.min(1, (totalSec - i / SR) / 0.5);
    const intro = Math.min(1, i / SR / 0.02);
    out.L[i] = music.L[i] * g * fade * intro;
    out.R[i] = music.R[i] * g * fade * intro;
  }
  for (const v of voices) add(out, v.at, v.pcm, VOICE_GAIN, 0);
  for (const f of sfx) add(out, f.at, f.sig, f.gain ?? 0.3, f.pan ?? 0);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    out.L[i] = Math.tanh(out.L[i] * 1.05);
    out.R[i] = Math.tanh(out.R[i] * 1.05);
    peak = Math.max(peak, Math.abs(out.L[i]), Math.abs(out.R[i]));
  }
  const norm = PEAK / (peak || 1);
  for (let i = 0; i < n; i++) { out.L[i] *= norm; out.R[i] *= norm; }
  return out;
}

/** 16-bit PCM of any rate; a stereo file gives its left channel. Walks the chunks: ffmpeg writes a LIST before `data`. */
export function readWavMono(path: string): { rate: number; s: Float32Array } {
  const b = readFileSync(path);
  let p = 12;
  let fmt: { rate: number; ch: number } | null = null;
  let data: Buffer | null = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { rate: b.readUInt32LE(p + 12), ch: b.readUInt16LE(p + 10) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`not a WAV file: ${path}`);
  const n = Math.floor(data.length / 2 / fmt.ch);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768;
  return { rate: fmt.rate, s };
}

function wavBytes(channels: Float32Array[], rate: number): Buffer {
  const ch = channels.length;
  const n = channels[0].length;
  const out = Buffer.alloc(44 + n * 2 * ch);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 2 * ch, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(ch, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2 * ch, 28); out.writeUInt16LE(2 * ch, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(n * 2 * ch, 40);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(channels[c][i] * 32767))), 44 + (i * ch + c) * 2);
  }
  return out;
}

export function writeWav(path: string, buf: Stereo): void {
  writeFileSync(path, wavBytes([buf.L, buf.R], SR));
}

export function writeWavMono(path: string, pcm: Float32Array, rate = SR): void {
  writeFileSync(path, wavBytes([pcm], rate));
}
