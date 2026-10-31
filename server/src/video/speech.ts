// The voice: the offline engine through tts.ps1, word times from its events, the speech model when there is none.
// Only the render reads this. Real durations never reach the world: the score keeps `estimateSpeechSec`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateSpeechSec } from '../deliverables/speech.js';
import { findFfmpeg } from './caps.js';
import { SR, readWavMono, writeWavMono } from './mix.js';

/** A SpeakProgress event: the engine's normalised token, its offset in the line, the audio position. */
export interface TtsEvent { t: string; c: number; ms: number }
export interface SpokenWord { text: string; at: number; end: number } // seconds, 0 = the first audible sample
export interface SpokenLine {
  text: string;
  voice: string | null;        // the voice that spoke, null: no audio, times from the speech model
  wav: string | null;          // 44.1 kHz mono, trimmed, after the chain
  speechSec: number;
  words: SpokenWord[];
}
export interface SynthesisOptions {
  cacheDir?: string;           // runs/<id>/video/_voice: every ratio and rework reuses it
  ffmpeg?: string;             // caps' binary, else `findFfmpeg`
  rate?: number;
}

export const VOICE_RATE = 1;   // the rate of the speech model's measures
const SILENCE = 0.01;          // −40 dB: the engine leaves 0.62 to 0.77 s of tail
const CHARS_PER_SEC = 20.5;    // the speech model's pace, for a word no event timed
// No soxr: it is not in every build.
const VOICE_CHAIN = 'highpass=f=90,equalizer=f=220:t=q:w=1:g=2,equalizer=f=3200:t=q:w=1.2:g=4,'
  + 'aexciter=level_in=1:level_out=1:amount=1:drive=4.5:blend=0:freq=3000:ceil=9999,'
  + 'acompressor=threshold=-20dB:ratio=3.5:attack=6:release=90:makeup=4dB,aresample=44100,alimiter=limit=0.9';
const TTS_SCRIPT = fileURLToPath(new URL('./tts.ps1', import.meta.url));

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TTS_SCRIPT];

interface Token { raw: string; start: number; end: number; at: number | null }

function tokensOf(text: string): Token[] {
  return [...text.matchAll(/\S+/g)].map((m) => ({ raw: m[0], start: m.index, end: m.index + m[0].length, at: null }));
}

/** « 33 % » and « 39 € » are spoken and shown: a caption without them says something else. A guillemet or a lone colon is not a word. */
const isWord = (raw: string): boolean => /[\p{L}\p{N}\p{Sc}\p{Sm}%]/u.test(raw);

/**
 * The source text decides the words, the events only give times. They are normalised tokens: « 8 étapes » fires
 * twice at one offset and punctuation fires nothing, so a repeat times the next word of its span, and a word
 * no event reached is interpolated on the characters between its neighbours.
 */
export function alignWords(text: string, events: TtsEvent[]): SpokenWord[] {
  const toks = tokensOf(text);
  const sorted = [...events].sort((a, b) => a.c - b.c || a.ms - b.ms);
  sorted.forEach((e, i) => {
    let repeat = 0;
    while (repeat < i && sorted[i - repeat - 1].c === e.c) repeat++;
    const first = toks.findIndex((k) => e.c >= k.start && e.c < k.end);
    const tok = first < 0 ? undefined : toks[first + repeat];
    if (tok && tok.at === null && tok.start < e.c + e.t.length) tok.at = e.ms / 1000;
  });
  toks.forEach((tok, i) => {
    if (tok.at !== null) return;
    const before = toks.slice(0, i).findLast((k) => k.at !== null);
    const after = toks.slice(i + 1).find((k) => k.at !== null);
    const ta = before?.at ?? 0;
    const ca = before?.start ?? 0;
    const cb = after?.start ?? text.length;
    const tb = after?.at ?? ta + (cb - ca) / CHARS_PER_SEC;
    tok.at = ta + (tb - ta) * ((tok.start - ca) / Math.max(1, cb - ca));
  });
  const words = toks.filter((k) => isWord(k.raw));
  let last = 0;
  const times = words.map((k) => (last = Math.max(last, k.at ?? 0)));
  return words.map((k, i) => ({ text: k.raw, at: times[i], end: times[i + 1] ?? times[i] + k.raw.length / CHARS_PER_SEC }));
}

/** No voice: the same words, timed by the speech model, pauses included. Ends on `estimateSpeechSec(text)`. */
export function estimatedWords(text: string): SpokenWord[] {
  const total = estimateSpeechSec(text);
  const origin = estimateSpeechSec('x');
  const words = tokensOf(text).filter((k) => isWord(k.raw));
  const times = words.map((k) => Math.min(total, estimateSpeechSec(text.slice(0, k.start) + 'x') - origin));
  return words.map((k, i) => ({ text: k.raw, at: times[i], end: times[i + 1] ?? total }));
}

function estimatedLine(text: string): SpokenLine {
  const words = estimatedWords(text);
  return { text, voice: null, wav: null, speechSec: words.length ? estimateSpeechSec(text) : 0, words };
}

/** First and last audible sample. The engine's tail is not speech, and the budget of a beat is. */
export function audibleSpan(s: Float32Array): { start: number; end: number } {
  let end = s.length - 1;
  while (end > 0 && Math.abs(s[end]) < SILENCE) end--;
  let start = 0;
  while (start < end && Math.abs(s[start]) < SILENCE) start++;
  return { start, end: Math.max(start, end) };
}

/** The French voice of this machine, Hortense first. Null: not Windows, no fr-FR voice, or the engine does not answer. */
export function findVoice(): string | null {
  if (process.platform !== 'win32') return null;
  const run = spawnSync('powershell.exe', [...POWERSHELL, '-List'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  if (run.status !== 0) return null;
  try {
    const voices = JSON.parse(run.stdout) as { name: string; culture: string }[];
    const french = voices.filter((v) => v.culture === 'fr-FR');
    return (french.find((v) => /hortense/i.test(v.name)) ?? french[0])?.name ?? null;
  } catch {
    return null;
  }
}

interface Spoken { text: string; wav: string; words: TtsEvent[] }

/** One PowerShell for all the lines of a job: 1.6 s for six. */
function speak(texts: string[], voice: string, rate: number, work: string): { voice: string; lines: Spoken[] } {
  const inJson = join(work, 'lines.json');
  writeFileSync(inJson, JSON.stringify(texts));
  const run = spawnSync('powershell.exe', [...POWERSHELL, '-InJson', inJson, '-OutDir', work, '-Voice', voice, '-Rate', String(rate)],
    { encoding: 'utf8', timeout: 20_000 + 4_000 * texts.length, windowsHide: true });
  if (run.status !== 0) throw new Error(run.stderr || run.error?.message || `tts exit ${run.status}`);
  return JSON.parse(readFileSync(join(work, 'timings.json'), 'utf8')) as { voice: string; lines: Spoken[] };
}

/** The chain runs on the whole take, so its filters settle in the tail and the lead, then the cut keeps the speech. */
function clean(raw: string, out: string, ffmpeg: string): Float32Array {
  const run = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af', VOICE_CHAIN, '-ar', '44100', '-ac', '1', out],
    { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  if (run.status !== 0) throw new Error(run.stderr || run.error?.message || `ffmpeg exit ${run.status}`);
  return readWavMono(out).s;
}

function bake(line: Spoken, voice: string, base: string, ffmpeg: string): void {
  const raw = readWavMono(line.wav);
  const { start, end } = audibleSpan(raw.s);
  const speechSec = (end - start) / raw.rate;
  if (speechSec <= 0) throw new Error(`silent take: ${line.text}`);
  const lead = start / raw.rate;
  const pcm = clean(line.wav, `${line.wav}.clean.wav`, ffmpeg);
  const from = Math.round(lead * SR);
  writeWavMono(`${base}.tmp`, pcm.subarray(from, from + Math.round(speechSec * SR)));
  renameSync(`${base}.tmp`, `${base}.wav`);
  const words = alignWords(line.text, line.words).map((w) => ({
    text: w.text,
    at: Math.min(speechSec, Math.max(0, w.at - lead)),
    end: Math.min(speechSec, Math.max(0, w.end - lead)),
  }));
  if (words.length) words[words.length - 1].end = speechSec;
  writeFileSync(`${base}.json`, JSON.stringify({ text: line.text, voice, speechSec, words })); // last: this file says the take is whole
}

function fromCache(base: string): SpokenLine | null {
  if (!existsSync(`${base}.json`) || !existsSync(`${base}.wav`)) return null;
  try {
    const { text, voice, speechSec, words } = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as SpokenLine;
    return { text, voice, speechSec, words, wav: `${base}.wav` };
  } catch {
    return null;
  }
}

/**
 * Lines in, spoken lines out, same order. `voice: null` gives the estimate, and so does any failure, for every line:
 * half a voice-over is worse than none, and no machine crashes on this. Synchronous on purpose: it runs in the worker.
 * Each line is cached as `<cacheDir>/<sha1(text|voice|rate)>`, `.wav` + `.json`.
 */
export function synthesize(lines: string[], voice: string | null, opts: SynthesisOptions = {}): SpokenLine[] {
  if (voice === null || process.platform !== 'win32') return lines.map(estimatedLine);
  const rate = opts.rate ?? VOICE_RATE;
  const dir = opts.cacheDir ?? join(tmpdir(), 'agency-voice');
  const baseOf = (text: string): string => join(dir, createHash('sha1').update(`${text}|${voice}|${rate}`).digest('hex'));
  let work: string | null = null;
  try {
    mkdirSync(dir, { recursive: true });
    const missing = [...new Set(lines)].filter((t) => t.trim() && !fromCache(baseOf(t)));
    if (missing.length) {
      const ffmpeg = opts.ffmpeg ?? findFfmpeg();
      if (!ffmpeg) throw new Error('ffmpeg introuvable');
      work = mkdtempSync(join(dir, 'take-'));
      const take = speak(missing, voice, rate, work);
      if (take.lines.length !== missing.length) throw new Error(`${take.lines.length} takes for ${missing.length} lines`);
      take.lines.forEach((line, i) => bake({ ...line, text: missing[i] }, take.voice, baseOf(missing[i]), ffmpeg));
    }
    return lines.map((text) => {
      if (!text.trim()) return estimatedLine(text);
      const spoken = fromCache(baseOf(text));
      if (!spoken) throw new Error(`no take for: ${text}`);
      return spoken;
    });
  } catch (err) {
    console.warn(`[video] pas de voix, durées estimées : ${(err as Error).message}`);
    return lines.map(estimatedLine);
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}
