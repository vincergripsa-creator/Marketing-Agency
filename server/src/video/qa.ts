/**
 * QA on the real file (video §10). Nothing here reads the render plan except the expected
 * numbers. ffmpeg only, `ffmpeg-static` ships no ffprobe: every measure comes from its log.
 * Synchronous: it runs in the render worker, never on the tick loop.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import type { QaSummary } from '../shared.js';

export const QA = {
  fps: 30,
  // A ceiling for a broken file, not a taste: `scoreCut` already marks a long ad down, and QA kills what it fails. Video §10
  // said 34, where a real weak editor's ad runs 49 s: most approved ads would have had no file at all, against video D9.
  minSec: 9, maxSec: 60, durationTolSec: 0.5,
  lufs: -14, lufsTol: 2.5,
  maxSilenceSec: 1.5,
  maxFreezeSec: 2.6,
  firstFrameSec: 0.05, firstFrameRange: 120,
  minCutGapSec: 0.25, cadenceTol: 0.35,
  maxMb: 12,
  ssimFrames: 6, minSsim: 0.88,
  estGapWarn: 0.12,
} as const;

/** One decode pass carries every video filter, one pass every audio filter. */
const VIDEO_FILTERS = "blackdetect=d=0.15:pix_th=0.06,freezedetect=n=0.002:d=1.4,select='gt(scene,0.06)',showinfo";
const AUDIO_FILTERS = 'silencedetect=noise=-45dB:d=0.8,ebur128=framelog=quiet';

/** The 13 rows of video §10, in its order. */
export const QA_CHECKS = ['size', 'codec', 'faststart', 'duration', 'audio', 'loudness', 'silence', 'blank', 'frozen', 'firstFrame', 'cadence', 'weight', 'safeText'] as const;
export type QaCheck = (typeof QA_CHECKS)[number];

export interface QaBox { x: number; y: number; w: number; h: number }

/** The drawText ledger of the render, and a way to redraw what it describes. */
export interface QaText {
  /** One settled frame per caption group (`at + 0.2 s`), with the boxes drawn on it. */
  frames: { frame: number; boxes: readonly QaBox[] }[];
  /** `insideSafe` bound to the stage. */
  inside(box: QaBox): boolean;
  /** The same frame drawn again, raw RGBA. */
  redraw(frame: number): Uint8Array;
}

export interface QaExpect {
  ffmpeg: string;
  w: number;
  h: number;
  /** The timeline's duration, real speech included. */
  durationSec: number;
  /** The cut has audio: every MP4 format does, a mute file is a broken one. */
  audio: boolean;
  /** Planned shots, Σ beat.shots. */
  shots: number;
  /** Without a ledger nothing proves the text: `safeText` fails. */
  text?: QaText | null;
  /** `cut.metrics.estSec`, to report the gap with the real duration (video §4.3). */
  estSec?: number;
  /** `QA.minSec` to `QA.maxSec` by default. A mini-cut moves them, a real ad never does. */
  minSec?: number;
  maxSec?: number;
}

export interface FileProbe {
  bytes: number;
  durationSec: number | null;
  video: { codec: string; pixFmt: string; w: number; h: number; fps: number } | null;
  audio: { codec: string; hz: number } | null;
}

export interface QaReport extends QaSummary {
  checks: Record<QaCheck, boolean>;
  durationSec: number | null;
  w: number | null;
  h: number | null;
  black: number[];
  freezes: number[];
  silences: number[];
  firstRange: number | null;
  ssim: number | null;
  outside: number;
  /** Real duration against the speech model, for the logs. Never reaches the world. */
  estGap: number | null;
  warnings: string[];
}

function ffmpegLog(ffmpeg: string, args: string[], input?: Uint8Array): { out: string; log: string } {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', ...args], { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60_000, windowsHide: true });
  return { out: r.stdout ?? '', log: r.stderr ?? '' };
}

const numbers = (log: string, re: RegExp): number[] => [...log.matchAll(re)].map((m) => Number(m[1]));

/** Parses what `ffmpeg -i` prints. Same layout on 8.1 and 6.1.1 (`ffmpeg-static`). */
export function parseProbe(log: string, bytes: number): FileProbe {
  const clock = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  const durationSec = clock ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : null;
  // Parentheses hold commas: `yuv420p(tv, bt709, progressive)`, and hex fourccs that look like sizes.
  const stream = (kind: string) => new RegExp(`Stream #\\d+:\\d+.*?: ${kind}: (.*)`).exec(log)?.[1]?.replace(/\([^()]*\)/g, '') ?? null;
  const v = stream('Video');
  const a = stream('Audio');
  const size = v ? /\b(\d{2,5})x(\d{2,5})\b/.exec(v) : null;
  return {
    bytes,
    durationSec,
    video: v && size ? {
      codec: v.trim().split(/[\s,]+/)[0] ?? '',
      pixFmt: v.split(',')[1]?.trim() ?? '',
      w: Number(size[1]),
      h: Number(size[2]),
      fps: Number(/([\d.]+) tbr/.exec(v)?.[1] ?? /([\d.]+) fps/.exec(v)?.[1] ?? 0),
    } : null,
    audio: a ? { codec: a.trim().split(/[\s,]+/)[0] ?? '', hz: Number(/(\d+) Hz/.exec(a)?.[1] ?? 0) } : null,
  };
}

export function probeFile(path: string, ffmpeg: string): FileProbe {
  let bytes = 0;
  try { bytes = statSync(path).size; } catch { return parseProbe('', 0); }
  return parseProbe(ffmpegLog(ffmpeg, ['-i', path]).log, bytes);
}

/** `moov` before `mdat`, walked on box headers from the head of the file. */
export function moovFirst(path: string): boolean {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch { return false; }
  try {
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(16);
    let at = 0;
    while (at + 8 <= size) {
      readSync(fd, head, 0, 16, at);
      const type = head.toString('latin1', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      const short = head.readUInt32BE(0);
      const box = short === 1 ? Number(head.readBigUInt64BE(8)) : short;
      if (box < 8) return false; // 0 runs to the end of the file, the rest is not MP4
      at += box;
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

/**
 * `<name>_start` and `<name>_duration` lines. A span still open at the end of the file may log
 * no duration: freezedetect never does, so a clip frozen to its last frame would look clean.
 */
export function spansOf(log: string, name: string, durationSec: number): number[] {
  const starts = numbers(log, new RegExp(`${name}_start: ?([\\d.]+)`, 'g'));
  const spans = numbers(log, new RegExp(`${name}_duration: ?([\\d.]+)`, 'g'));
  const open = starts.at(-1);
  return starts.length > spans.length && open !== undefined ? [...spans, Math.max(0, durationSec - open)] : spans;
}

/** Scene cuts closer than this are one flash or one punch, not two shots. */
function cutsOf(log: string): number[] {
  const times = numbers(log, /pts_time:([\d.]+)/g);
  return times.filter((t, i) => i === 0 || t - (times[i - 1] ?? 0) > QA.minCutGapSec);
}

function firstFrameRange(path: string, ffmpeg: string): number | null {
  const { log } = ffmpegLog(ffmpeg, ['-ss', String(QA.firstFrameSec), '-i', path, '-frames:v', '1', '-vf', 'signalstats,metadata=print', '-an', '-f', 'null', '-']);
  const min = /YMIN=([\d.]+)/.exec(log)?.[1];
  const max = /YMAX=([\d.]+)/.exec(log)?.[1];
  return min === undefined || max === undefined ? null : Number(max) - Number(min);
}

/** At most `n` frames, spread over the clip, ascending and distinct. */
function spread(frames: readonly number[], n: number): number[] {
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  if (sorted.length <= n) return sorted;
  return Array.from({ length: n }, (_, i) => sorted[Math.round(i * (sorted.length - 1) / (n - 1))] as number);
}

/** Lowest SSIM between frames of the file and the same frames redrawn. One ffmpeg pass. */
function ssimAgainst(path: string, ffmpeg: string, w: number, h: number, frames: readonly number[], redraw: QaText['redraw']): number | null {
  const bytes = w * h * 4;
  const raw = frames.map((f) => Buffer.from(redraw(f)));
  if (!frames.length || raw.some((r) => r.byteLength !== bytes)) return null;
  const pick = frames.map((f) => `eq(n,${f})`).join('+');
  // The reference takes the encoder's own conversion, or the colour matrix would read as damage.
  // `endall`: by default a truncated file repeats its last frame, and the score would read a stale one.
  const graph = `[1:v]select='${pick}',setpts=N/${QA.fps}/TB[file];`
    + `[0:v]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setpts=N/${QA.fps}/TB[ref];`
    + '[file][ref]ssim=stats_file=-:eof_action=endall';
  const { out } = ffmpegLog(ffmpeg, ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(QA.fps), '-i', 'pipe:0', '-i', path, '-lavfi', graph, '-an', '-f', 'null', '-'], Buffer.concat(raw));
  const scores = numbers(out, /All:([\d.]+)/g);
  return scores.length === frames.length ? Math.min(...scores) : null;
}

/** The ledger says every text is safe, and the SSIM proves the ledger describes this file. */
function safeTextOf(path: string, e: QaExpect): { ok: boolean; ssim: number | null; outside: number } {
  const text = e.text;
  if (!text) return { ok: false, ssim: null, outside: 0 };
  const boxes = text.frames.flatMap((f) => [...f.boxes]);
  const outside = boxes.filter((b) => !text.inside(b)).length;
  const ssim = ssimAgainst(path, e.ffmpeg, e.w, e.h, spread(text.frames.map((f) => f.frame), QA.ssimFrames), text.redraw);
  return { ok: boxes.length > 0 && outside === 0 && ssim !== null && ssim >= QA.minSsim, ssim, outside };
}

export function checkFile(path: string, e: QaExpect): QaReport {
  const probe = probeFile(path, e.ffmpeg);
  const { video: v, audio: a, durationSec: dur } = probe;
  const decoded = v ? ffmpegLog(e.ffmpeg, ['-i', path, '-vf', VIDEO_FILTERS, ...(a ? ['-af', AUDIO_FILTERS] : []), '-f', 'null', '-']).log : '';
  const clip = dur ?? 0;
  const black = numbers(decoded, /black_start:([\d.]+)/g);
  const freezes = spansOf(decoded, 'freeze', clip);
  const silences = spansOf(decoded, 'silence', clip);
  const cuts = cutsOf(decoded).length;
  const parsedLufs = /\bI:\s+(-?[\d.]+) LUFS/.exec(decoded)?.[1];
  const lufs = parsedLufs === undefined ? null : Number(parsedLufs);
  const firstRange = v ? firstFrameRange(path, e.ffmpeg) : null;
  const text = safeTextOf(path, e);
  const mb = probe.bytes / 1e6;
  const checks: Record<QaCheck, boolean> = {
    size: v?.w === e.w && v.h === e.h,
    codec: v?.codec === 'h264' && v.pixFmt === 'yuv420p' && v.fps === QA.fps,
    faststart: moovFirst(path),
    duration: dur !== null && Math.abs(dur - e.durationSec) <= QA.durationTolSec && dur >= (e.minSec ?? QA.minSec) && dur <= (e.maxSec ?? QA.maxSec),
    audio: !e.audio || a?.codec === 'aac',
    loudness: !e.audio || (lufs !== null && Math.abs(lufs - QA.lufs) <= QA.lufsTol),
    silence: !e.audio || (a !== null && silences.every((d) => d <= QA.maxSilenceSec)),
    blank: v !== null && black.length === 0,
    frozen: v !== null && freezes.every((d) => d <= QA.maxFreezeSec),
    firstFrame: firstRange !== null && firstRange > QA.firstFrameRange,
    cadence: v !== null && Math.abs(cuts + 1 - e.shots) <= QA.cadenceTol * e.shots,
    weight: probe.bytes > 0 && mb < QA.maxMb,
    safeText: text.ok,
  };
  const failed = QA_CHECKS.filter((c) => !checks[c]);
  const estGap = e.estSec && dur !== null ? Math.abs(dur - e.estSec) / e.estSec : null;
  return {
    ok: failed.length === 0,
    failed,
    lufs,
    cuts,
    avgShotSec: Math.round(clip / (cuts + 1) * 100) / 100,
    mb: Math.round(mb * 10) / 10,
    checks,
    durationSec: dur,
    w: v?.w ?? null,
    h: v?.h ?? null,
    black,
    freezes,
    silences,
    firstRange,
    ssim: text.ssim,
    outside: text.outside,
    estGap,
    warnings: estGap !== null && estGap > QA.estGapWarn ? [`estimated ${e.estSec} s, real ${dur} s`] : [],
  };
}

/** What the manifest keeps of a report. */
export function qaSummary(r: QaReport): QaSummary {
  return { ok: r.ok, failed: r.failed, lufs: r.lufs, cuts: r.cuts, avgShotSec: r.avgShotSec, mb: r.mb };
}
