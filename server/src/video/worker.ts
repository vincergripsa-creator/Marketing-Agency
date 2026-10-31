/**
 * The render worker: a child process, one job in, one result out (video §9, D11). The native draw calls are synchronous and
 * would stall the tick loop in the server. It reads the job's `spec.json` and never sees the world. A file lands here only
 * if QA passed: a failed QA is a failed job, its file is deleted and never served.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isEntryPoint } from '../api/entry.js';
import { hashString } from '../core/ids.js';
import type { QaSummary, VideoFile } from '../shared.js';
import { createCompositor, loadAssets, textProof, type Compositor } from './compose.js';
import { encodeMp4 } from './encode.js';
import { mixDown, readWavMono, writeWav } from './mix.js';
import { makeMusic, musicFor } from './music.js';
import { checkFile, qaSummary } from './qa.js';
import { renderCards } from './scenes/slide.js';
import { sfxCues } from './sfx.js';
import { stillFormat, type RenderSpec } from './spec.js';
import { synthesize, type SpokenLine } from './speech.js';
import { stageFor, type Stage } from './stage.js';
import { buildTimeline, settledFrames, TEMPO_BPM, type Timeline } from './timeline.js';

// Spelled here, not imported: the director loads with the server, this file only in the child process.
const SPEC_FILE = 'spec.json';
const RESULT_FILE = 'result.json';
const POSTER_QUALITY = 86;

export interface RenderJob {
  dir: string;                 // the job's folder: spec.json in, everything else out
  root: string;                // the run's folder: paths of the spec and of the result are relative to it
  ffmpeg: string;
  pages: boolean;              // false is the `no_pages` level
  width?: number;              // stage width, the tests render small
}

export interface RenderResult {
  ok: boolean;
  retry: boolean;              // a crash may pass on a second try, a failed QA never does
  reason: string | null;       // French, for the founder
  video: VideoFile | null;
  bytes: number;               // master and cards
  poster: string | null;
  captions: string | null;
  cards: string[];
  voice: string | null;
  qa: QaSummary | null;
}

const clock = (sec: number): string => {
  const ms = Math.round(sec * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};

/** The captions of the file: the groups on screen, or the slide's text where nothing is spoken. */
export function webVtt(tl: Pick<Timeline, 'beats' | 'total'>): string {
  const cues = tl.beats.flatMap((b) => {
    if (!b.groups.length) return b.screen.trim() ? [{ from: b.t0, to: b.t0 + b.dur, text: b.screen.trim() }] : [];
    return b.groups.map((g) => ({ from: b.t0 + g[0]!.at, to: b.t0 + g[g.length - 1]!.end, text: g.map((w) => w.text).join(' ') }));
  });
  const escaped = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return ['WEBVTT', '', ...cues.flatMap((c) => [`${clock(c.from)} --> ${clock(Math.min(tl.total, Math.max(c.to, c.from + 0.05)))}`, escaped(c.text), ''])].join('\n');
}

/** Voice over ducked music, SFX on the cuts, on one WAV. Silent formats get the music at full level. */
function mixTo(wav: string, spec: RenderSpec, tl: Timeline, speech: SpokenLine[]): void {
  const voices = tl.beats.flatMap((b, i) => {
    const line = speech[i];
    return line?.wav ? [{ at: b.t0, dur: b.speech, pcm: readWavMono(line.wav).s }] : [];
  });
  const music = makeMusic(tl.total, musicFor(spec.hook, spec.design.family, spec.cut.tempo));
  writeWav(wav, mixDown({ totalSec: tl.total, music, voices, sfx: tl.sfx ? sfxCues(tl.beats, hashString(spec.hook)) : [] }));
}

async function renderMaster(job: RenderJob, spec: RenderSpec, tl: Timeline, stage: Stage, comp: Compositor, speech: SpokenLine[], base: RenderResult, rel: (name: string) => string): Promise<RenderResult> {
  const wav = join(job.dir, 'mix.wav');
  const out = join(job.dir, 'master.mp4');
  mixTo(wav, spec, tl, speech);
  const encoded = await encodeMp4(comp.rgbaFrames(), wav, out, { ffmpeg: job.ffmpeg, w: stage.w, h: stage.h });
  await rm(wav, { force: true });
  const shots = tl.beats.reduce((n, b) => n + b.shotAt.length, 0);
  const report = checkFile(out, { ffmpeg: job.ffmpeg, w: stage.w, h: stage.h, durationSec: tl.total, audio: true, shots, text: textProof(comp), estSec: spec.cut.metrics.estSec });
  const qa = qaSummary(report);
  if (!report.ok) {
    await rm(out, { force: true });
    return { ...base, retry: false, reason: `Échec du contrôle : ${report.failed.join(', ')}`, qa };
  }
  comp.drawFrame(settledFrames(tl)[0] ?? 0);
  await writeFile(join(job.dir, 'poster.jpg'), await comp.canvas.encode('jpeg', POSTER_QUALITY));
  await writeFile(join(job.dir, 'captions.vtt'), webVtt(tl));
  return {
    ...base, ok: true, retry: false,
    video: { ratio: spec.ratio, path: rel('master.mp4'), durationSec: report.durationSec ?? tl.total, bytes: encoded.bytes },
    bytes: encoded.bytes, poster: rel('poster.jpg'), captions: rel('captions.vtt'), qa,
  };
}

/** PNG cards have no file to probe: the ledger is their QA, and the first one is the tile's picture. */
async function renderStills(job: RenderJob, comp: Compositor, base: RenderResult, rel: (name: string) => string): Promise<RenderResult> {
  const cards = await renderCards(comp, job.dir);
  const outside = cards.reduce((n, c) => n + c.outside, 0);
  if (!cards.length || outside) {
    await Promise.all(cards.map((c) => rm(join(job.dir, c.file), { force: true })));
    return { ...base, retry: false, reason: `Échec du contrôle : ${outside} textes hors zone` };
  }
  const sizes = await Promise.all(cards.map((c) => stat(join(job.dir, c.file))));
  return { ...base, ok: true, retry: false, cards: cards.map((c) => rel(c.file)), bytes: sizes.reduce((n, s) => n + s.size, 0), poster: rel(cards[0]!.file) };
}

export async function renderJob(job: RenderJob): Promise<RenderResult> {
  const spec = JSON.parse(await readFile(join(job.dir, SPEC_FILE), 'utf8')) as RenderSpec;
  const prefix = relative(job.root, job.dir).replace(/\\/g, '/');
  const rel = (name: string): string => `${prefix}/${name}`;
  await mkdir(job.dir, { recursive: true });
  const speech = synthesize(spec.cut.beats.map((b) => b.spoken), spec.voice, { cacheDir: join(job.root, 'video', '_voice'), ffmpeg: job.ffmpeg });
  const tl = buildTimeline(spec.cut, speech, TEMPO_BPM[spec.cut.tempo]);
  const stage = stageFor(spec.ratio, job.width);
  const comp = createCompositor(tl, stage, await loadAssets(spec, tl, stage, job.root, { pages: job.pages }));
  const base: RenderResult = { ok: false, retry: true, reason: null, video: null, bytes: 0, poster: null, captions: null, cards: [], voice: speech.find((s) => s.voice)?.voice ?? null, qa: null };
  const result = stillFormat(spec.format) ? await renderStills(job, comp, base, rel) : await renderMaster(job, spec, tl, stage, comp, speech, base, rel);
  if (result.ok) await writeFile(join(job.dir, RESULT_FILE), JSON.stringify(result));
  return result;
}

if (isEntryPoint(import.meta.url)) {
  process.once('disconnect', () => process.exit(1)); // the server is gone: nobody reads this result
  process.once('message', (job: RenderJob) => {
    renderJob(job)
      .catch((err: Error): RenderResult => {
        console.error(err.stack ?? err.message);
        return { ok: false, retry: true, reason: "Le rendu s'est arrêté avant la fin", video: null, bytes: 0, poster: null, captions: null, cards: [], voice: null, qa: null };
      })
      .then((result) => { process.send!(result, () => process.exit(0)); });
  });
}
