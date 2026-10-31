import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import type { DesignSpec, VideoCut } from '../src/shared.js';
import { findFfmpeg } from '../src/video/caps.js';
import { encodeArgs, encodeMp4, pumpFrames, VIDEO_COMMENT } from '../src/video/encode.js';
import { mixDown, writeWav } from '../src/video/mix.js';
import { makeMusic, musicFor } from '../src/video/music.js';
import { checkFile, moovFirst, parseProbe, probeFile, QA_CHECKS, qaSummary, spansOf, type QaExpect, type QaText } from '../src/video/qa.js';
import { sfxCues } from '../src/video/sfx.js';
import type { RenderSpec } from '../src/video/spec.js';
import { estimatedWords, type SpokenLine } from '../src/video/speech.js';
import { stageFor } from '../src/video/stage.js';
import { buildTimeline, TEMPO_BPM } from '../src/video/timeline.js';

const ffmpeg = findFfmpeg() ?? '';
const hasCanvas = await import('@napi-rs/canvas').then(() => true, () => false);
const compose = hasCanvas ? await import('../src/video/compose.js') : null;

const W = 270;
const H = 480;
const FPS = 30;
const tmp = mkdtempSync(join(tmpdir(), 'video-render-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const file = (name: string) => join(tmp, name);

const SHOTS: [number, number, number][] = [[250, 220, 60], [20, 50, 150], [250, 140, 170], [10, 80, 40]];

/** One frame of a stand-in cut: a new shot every second, one thing always moving. */
function frameAt(i: number, w = W, h = H): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  const shot = SHOTS[Math.floor(i / FPS) % SHOTS.length]!;
  const left = (i * 5) % w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const moving = y > h * 0.8 && x >= left && x < left + 40;
      const c = moving || y < h * 0.3 ? [245, 245, 245] : y < h * 0.6 ? shot : [14, 14, 22];
      px.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4);
    }
  }
  return px;
}

function* clip(frames: number, draw: (i: number) => Uint8Array = frameAt): Generator<Uint8Array> {
  for (let i = 0; i < frames; i++) yield draw(i);
}

const blackFrame = (w = W, h = H) => { const px = new Uint8Array(w * h * 4); for (let i = 3; i < px.length; i += 4) px[i] = 255; return px; };

function lavfi(name: string, ...args: string[]): string {
  const out = file(name);
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, out], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
}

const tone = (name: string, sec: number) => lavfi(name, '-f', 'lavfi', '-i', `sine=frequency=330:beep_factor=4:duration=${sec}`, '-ar', '44100', '-ac', '2');

/** The ledger of the stand-in cut: one caption group every 15 frames. */
function ledger(frames: number, over: Partial<QaText> = {}): QaText {
  const settled = Array.from({ length: Math.floor(frames / 15) }, (_, k) => ({ frame: 6 + k * 15, boxes: [{ x: 30, y: 200, w: 200, h: 50 }] }));
  return { frames: settled, inside: (b) => b.x >= 16 && b.y >= 72 && b.x + b.w <= 254 && b.y + b.h <= 312, redraw: frameAt, ...over };
}

const expectMini = (over: Partial<QaExpect> = {}): QaExpect => ({ ffmpeg, w: W, h: H, durationSec: 3, audio: true, shots: 3, minSec: 1, text: ledger(90), ...over });

describe('reading ffmpeg', () => {
  it('parses the stream lines of 8.1 and of 6.1.1, parentheses and SAR included', () => {
    const v81 = "  Duration: 00:00:26.13, start: 0.000000, bitrate: 1448 kb/s\n"
      + "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709/unknown/unknown, progressive), 1080x1920, 1269 kb/s, 30 fps, 30 tbr, 15360 tbn (default)\n"
      + "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 169 kb/s (default)\n";
    const v611 = "  Duration: 00:01:04.00, start: 0.000000, bitrate: 19 kb/s\n"
      + "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 270x480 [SAR 1:1 DAR 9:16], 5 kb/s, 25 fps, 25 tbr, 15360 tbn (default)\n";
    expect(parseProbe(v81, 7)).toEqual({ bytes: 7, durationSec: 26.13, video: { codec: 'h264', pixFmt: 'yuv420p', w: 1080, h: 1920, fps: 30 }, audio: { codec: 'aac', hz: 44100 } });
    expect(parseProbe(v611, 7)).toEqual({ bytes: 7, durationSec: 64, video: { codec: 'h264', pixFmt: 'yuv420p', w: 270, h: 480, fps: 25 }, audio: null });
  });

  it('gives nothing on a log with no stream', () => {
    expect(parseProbe('Invalid data found when processing input', 7)).toEqual({ bytes: 7, durationSec: null, video: null, audio: null });
  });

  it('counts a freeze that runs to the last frame: freezedetect logs no duration for it', () => {
    expect(spansOf('[freezedetect @ 0] lavfi.freezedetect.freeze_start: 1.5', 'freeze', 8)).toEqual([6.5]);
    const closed = 'freeze_start: 1\nfreeze_duration: 2\nfreeze_end: 3\nfreeze_start: 5\nfreeze_duration: 1.5\nfreeze_end: 6.5';
    expect(spansOf(closed, 'freeze', 8)).toEqual([2, 1.5]);
    expect(spansOf('silence_start: 0\nsilence_end: 4.01 | silence_duration: 4.01', 'silence', 4)).toEqual([4.01]);
  });

  it('walks MP4 boxes from the head of the file', () => {
    const box = (type: string, size: number) => { const b = Buffer.alloc(size); b.writeUInt32BE(size, 0); b.write(type, 4, 'latin1'); return b; };
    const large = (type: string, size: number) => { const b = Buffer.alloc(size); b.writeUInt32BE(1, 0); b.write(type, 4, 'latin1'); b.writeBigUInt64BE(BigInt(size), 8); return b; };
    const write = (name: string, ...boxes: Buffer[]) => { writeFileSync(file(name), Buffer.concat(boxes)); return file(name); };
    expect(moovFirst(write('head.mp4', box('ftyp', 24), box('free', 8), box('moov', 40), box('mdat', 64)))).toBe(true);
    expect(moovFirst(write('tail.mp4', box('ftyp', 24), box('mdat', 64), box('moov', 40)))).toBe(false);
    expect(moovFirst(write('wide.mp4', box('ftyp', 24), large('free', 32), box('moov', 40)))).toBe(true);
    expect(moovFirst(write('junk.mp4', Buffer.from('not an mp4 at all, really')))).toBe(false);
    expect(moovFirst(file('missing.mp4'))).toBe(false);
  });
});

describe('the frame pipe', () => {
  const FRAME = 1024;
  const gone = new Promise<void>(() => { /* a reader that stays */ });

  it('waits for drain: no more than one frame ever sits in the pipe', async () => {
    let peak = 0;
    const sink = new Writable({
      highWaterMark: 1,
      write(_chunk, _enc, done) { peak = Math.max(peak, sink.writableLength); setImmediate(done); },
    });
    const written = await pumpFrames(clip(40, () => new Uint8Array(FRAME)), sink, FRAME, gone);
    expect(written).toBe(40);
    expect(peak).toBeLessThanOrEqual(FRAME);
  });

  it('does not hang when the reader dies in front of a full pipe', async () => {
    const sink = new Writable({ highWaterMark: 1, write() { /* never drains */ } });
    const dead = new Promise<void>((resolve) => setTimeout(resolve, 20));
    await expect(pumpFrames(clip(1000, () => new Uint8Array(FRAME)), sink, FRAME, dead)).resolves.toBeLessThan(1000);
  });

  it('refuses a frame of the wrong size: it would shear every frame after it', async () => {
    const sink = new Writable({ write(_c, _e, done) { done(); } });
    await expect(pumpFrames(clip(3, (i) => new Uint8Array(i === 1 ? FRAME - 4 : FRAME)), sink, FRAME, gone)).rejects.toThrow('frame 1');
  });

  it('copies each frame: the canvas reuses its pixels for the next one', async () => {
    const pixels = new Uint8Array(FRAME);
    const held: Uint8Array[] = [];
    const sink = new Writable({ write(chunk, _enc, done) { held.push(chunk); done(); } });
    await pumpFrames(clip(3, (i) => { pixels[0] = i + 1; return pixels; }), sink, FRAME, gone);
    expect(held.map((c) => c[0])).toEqual([1, 2, 3]);
  });

  it('holds the §4.1 command line', () => {
    const args = encodeArgs('mix.wav', 'out.mp4', { ffmpeg, w: 1080, h: 1920 }).join(' ');
    expect(args).toContain('-f rawvideo -pix_fmt rgba -s 1080x1920 -r 30 -i pipe:0 -i mix.wav');
    expect(args).toContain('-c:v libx264 -preset veryfast -crf 26 -profile:v high -level 4.1 -threads 2');
    expect(args).toContain('-colorspace bt709 -color_primaries bt709 -color_trc bt709');
    expect(args).toContain('-c:a aac -b:a 160k -ar 44100 -af loudnorm=I=-14:TP=-1.5:LRA=11');
    expect(args).toContain('-movflags +faststart');
    expect(encodeArgs(null, 'out.mp4', { ffmpeg, w: 8, h: 8 })).not.toContain('-c:a');
  });
});

describe.skipIf(!ffmpeg)('encode and QA on real files', { timeout: 60_000 }, () => {
  const encoded = (name: string, frames: Iterable<Uint8Array>, wav: string | null, w = W, h = H) => encodeMp4(frames, wav, file(name), { ffmpeg, w, h });
  let shared: string | null = null;
  const good = async () => {
    shared ??= (await encoded('good.mp4', clip(90), tone('good.wav', 3))).path;
    return shared;
  };

  it('a 3 s mini-cut through the pipeline passes the 13 checks', async () => {
    const path = await good();
    const report = checkFile(path, expectMini());
    expect(report.failed).toEqual([]);
    expect(report.ok).toBe(true);
    expect(QA_CHECKS).toHaveLength(13);
    expect(Object.keys(report.checks)).toEqual([...QA_CHECKS]);
    expect(report.cuts).toBe(2);
    expect(report.avgShotSec).toBe(1);
    expect(report.lufs).not.toBeNull();
    expect(report.ssim).toBeGreaterThanOrEqual(0.88);
    expect(qaSummary(report)).toEqual({ ok: true, failed: [], lufs: report.lufs, cuts: 2, avgShotSec: 1, mb: report.mb });
  });

  it('writes the file §4.1 asks for: 30 fps, bt709, faststart, marked as simulated', async () => {
    const path = await good();
    const probe = probeFile(path, ffmpeg);
    expect(probe.video).toEqual({ codec: 'h264', pixFmt: 'yuv420p', w: W, h: H, fps: 30 });
    expect(probe.audio).toEqual({ codec: 'aac', hz: 44100 });
    expect(moovFirst(path)).toBe(true);
    const header = spawnSync(ffmpeg, ['-hide_banner', '-i', path], { encoding: 'utf8', windowsHide: true }).stderr;
    expect(header).toContain(VIDEO_COMMENT);
    expect(header).toContain('bt709');
    expect(readdirSync(tmp).filter((f) => f.endsWith('.part'))).toEqual([]);
  });

  it('a black file fails', async () => {
    const { path } = await encoded('black.mp4', clip(90, () => blackFrame()), tone('black.wav', 3));
    const { ok, failed } = checkFile(path, expectMini());
    expect(ok).toBe(false);
    expect(failed).toEqual(expect.arrayContaining(['blank', 'frozen', 'firstFrame', 'cadence']));
    expect(failed).not.toContain('loudness');
  });

  it('a black 8 s file fails 6 of the 13 checks', async () => {
    const { path } = await encoded('black8.mp4', clip(240, () => blackFrame()), tone('black8.wav', 8));
    const report = checkFile(path, { ffmpeg, w: W, h: H, durationSec: 8, audio: true, shots: 6, text: ledger(90) });
    expect(report.failed).toEqual(['duration', 'blank', 'frozen', 'firstFrame', 'cadence', 'safeText']);
  });

  it('a mute file fails, with no audio stream and with a silent one', async () => {
    const { path: noStream } = await encoded('nostream.mp4', clip(90), null);
    expect(checkFile(noStream, expectMini()).failed).toEqual(['audio', 'loudness', 'silence']);
    const silent = lavfi('silent.mp4', '-i', noStream, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart');
    expect(checkFile(silent, expectMini()).failed).toEqual(['loudness', 'silence']);
    expect(checkFile(noStream, expectMini({ audio: false })).ok).toBe(true);
  });

  it('a file of the wrong size fails', async () => {
    const { path } = await encoded('wide.mp4', clip(90, (i) => frameAt(i, 480, 270)), tone('wide.wav', 3), 480, 270);
    const { failed, w, h } = checkFile(path, expectMini());
    expect([w, h]).toEqual([480, 270]);
    expect(failed).toContain('size');
    expect(failed).toContain('safeText');
    expect(failed).not.toContain('codec');
  });

  it('a clip frozen to its last frame fails, even though ffmpeg never closes the freeze', async () => {
    const still = frameAt(0);
    const { path } = await encoded('frozen.mp4', clip(120, (i) => (i < 12 ? frameAt(i) : still)), tone('frozen.wav', 4));
    const report = checkFile(path, expectMini({ durationSec: 4, shots: 1, text: null }));
    expect(report.failed).toContain('frozen');
    expect(report.freezes[0]).toBeGreaterThan(3);
    expect(report.failed).not.toContain('blank');
  });

  it('a master without faststart fails', async () => {
    const remux = lavfi('tail-moov.mp4', '-i', await good(), '-c', 'copy');
    expect(checkFile(remux, expectMini()).failed).toEqual(['faststart']);
  });

  it('another frame rate or pixel format fails', async () => {
    const reencoded = lavfi('p25.mp4', '-i', await good(), '-r', '25', '-c:a', 'copy', '-movflags', '+faststart');
    expect(checkFile(reencoded, expectMini()).failed).toContain('codec');
    const yuv444 = lavfi('p444.mp4', '-i', await good(), '-pix_fmt', 'yuv444p', '-c:a', 'copy', '-movflags', '+faststart');
    expect(checkFile(yuv444, expectMini()).failed).toContain('codec');
  });

  it('holds duration to the timeline and to its 9 s floor', async () => {
    const path = await good();
    expect(checkFile(path, expectMini({ durationSec: 3.8 })).failed).toEqual(['duration']);
    expect(checkFile(path, expectMini({ minSec: undefined })).failed).toEqual(['duration']);
  });

  it('passes the 49 s of a weak editor, and fails only what is past the ceiling (video D9)', () => {
    const long = lavfi('long.mp4', '-f', 'lavfi', '-i', `color=c=gray:s=${W}x${H}:r=${FPS}:d=49`, '-f', 'lavfi', '-i', 'sine=frequency=330:duration=49', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart');
    const expected = expectMini({ durationSec: 49, minSec: undefined, text: null });
    expect(checkFile(long, expected).checks.duration).toBe(true);
    expect(checkFile(long, { ...expected, maxSec: 48 }).checks.duration).toBe(false);
  }, 30_000);

  it('holds cadence to the planned shots, ±35 %', async () => {
    const path = await good();
    expect(checkFile(path, expectMini({ shots: 4 })).failed).toEqual([]);
    expect(checkFile(path, expectMini({ shots: 8 })).failed).toEqual(['cadence']);
    expect(checkFile(path, expectMini({ shots: 2 })).failed).toEqual(['cadence']);
  });

  it('counts a cut and its white flash as one', async () => {
    const flashed = (i: number) => {
      const px = frameAt(i);
      if (i >= FPS && i % FPS < 2) for (let k = 0; k < px.length; k++) if (k % 4 !== 3) px[k] = Math.round(px[k]! * 0.68 + 81);
      return px;
    };
    const { path } = await encoded('flash.mp4', clip(90, flashed), tone('flash.wav', 3));
    expect(checkFile(path, expectMini({ text: ledger(90, { redraw: flashed }) })).cuts).toBe(2);
  });

  it('holds weight under 12 MB', async () => {
    const heavy = file('heavy.mp4');
    writeFileSync(heavy, Buffer.concat([readFileSync(await good()), Buffer.alloc(12_500_000)]));
    const report = checkFile(heavy, expectMini());
    expect(report.failed).toEqual(['weight']);
    expect(report.mb).toBeGreaterThanOrEqual(12);
  });

  it('text outside the zone fails, and so does a ledger that describes another file', async () => {
    const path = await good();
    const escaped = ledger(90);
    escaped.frames[2]!.boxes = [{ x: 200, y: 200, w: 200, h: 50 }];
    const out = checkFile(path, expectMini({ text: escaped }));
    expect(out.failed).toEqual(['safeText']);
    expect(out.outside).toBe(1);

    const elsewhere = checkFile(path, expectMini({ text: ledger(90, { redraw: () => blackFrame() }) }));
    expect(elsewhere.failed).toEqual(['safeText']);
    expect(elsewhere.outside).toBe(0);
    expect(elsewhere.ssim).toBeLessThan(0.88);
  });

  it('fails on one wrong frame among the six', async () => {
    const report = checkFile(await good(), expectMini({ text: ledger(90, { redraw: (f) => (f === 36 ? frameAt(f + 30) : frameAt(f)) }) }));
    expect(report.failed).toEqual(['safeText']);
  });

  it('compares at most 6 frames, spread over the clip', async () => {
    const asked: number[] = [];
    const frames = Array.from({ length: 14 }, (_, k) => ({ frame: 6 + k * 6, boxes: [{ x: 30, y: 200, w: 200, h: 50 }] }));
    const report = checkFile(await good(), expectMini({ text: ledger(90, { frames, redraw: (f) => { asked.push(f); return frameAt(f); } }) }));
    expect(report.failed).toEqual([]);
    expect(asked).toHaveLength(6);
    expect(asked[0]).toBe(6);
    expect(asked.at(-1)).toBe(84);
    expect(asked).toEqual([...asked].sort((a, b) => a - b));
  });

  it('proves nothing without a ledger: no text recorded, a frame past the end, a redraw of the wrong size', async () => {
    const path = await good();
    expect(checkFile(path, expectMini({ text: null })).failed).toEqual(['safeText']);
    expect(checkFile(path, expectMini({ text: ledger(90, { frames: [{ frame: 6, boxes: [] }] }) })).failed).toEqual(['safeText']);
    const pastEnd = [6, 500].map((frame) => ({ frame, boxes: [{ x: 30, y: 200, w: 200, h: 50 }] }));
    expect(checkFile(path, expectMini({ text: ledger(90, { frames: pastEnd }) })).failed).toEqual(['safeText']);
    expect(checkFile(path, expectMini({ text: ledger(90, { redraw: () => new Uint8Array(16) }) })).failed).toEqual(['safeText']);
  });

  it('warns when the real duration leaves the speech model by over 12 %, and only warns', async () => {
    const path = await good();
    const near = checkFile(path, expectMini({ estSec: 2.9 }));
    expect(near.warnings).toEqual([]);
    const far = checkFile(path, expectMini({ estSec: 2.2 }));
    expect(far.estGap).toBeGreaterThan(0.12);
    expect(far.warnings).toHaveLength(1);
    expect(far.ok).toBe(true);
  });

  it('reports a file it cannot read instead of throwing', () => {
    writeFileSync(file('garbage.mp4'), 'not a video');
    const garbage = checkFile(file('garbage.mp4'), expectMini());
    expect(garbage.ok).toBe(false);
    expect(garbage.durationSec).toBeNull();
    const missing = checkFile(file('missing.mp4'), expectMini());
    expect(missing.failed).toEqual([...QA_CHECKS]);
    expect(checkFile(file('garbage.mp4'), expectMini({ ffmpeg: file('no-such-ffmpeg') })).ok).toBe(false);
  });

  it('leaves nothing under the final name when a render dies', async () => {
    const out = file('dead.mp4');
    const opts = { ffmpeg, w: W, h: H };
    await expect(encodeMp4(clip(30), file('no-such.wav'), out, opts)).rejects.toThrow(/ffmpeg|no-such/);
    await expect(encodeMp4(clip(0), null, out, opts)).rejects.toThrow('no frame');
    await expect(encodeMp4(clip(30, (i) => { if (i === 12) throw new Error('canvas lost'); return frameAt(i); }), null, out, opts)).rejects.toThrow('canvas lost');
    await expect(encodeMp4(clip(5), null, out, { ...opts, ffmpeg: file('no-such-ffmpeg') })).rejects.toThrow();
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(tmp).filter((f) => f.startsWith('dead'))).toEqual([]);
  });

  it('replaces an older file only once the new one is complete', async () => {
    const out = file('rerender.mp4');
    const first = await encodeMp4(clip(30), null, out, { ffmpeg, w: W, h: H });
    const before = readFileSync(out);
    await expect(encodeMp4(clip(30, (i) => { if (i === 5) throw new Error('canvas lost'); return frameAt(i); }), null, out, { ffmpeg, w: W, h: H })).rejects.toThrow('canvas lost');
    expect(readFileSync(out).equals(before)).toBe(true);
    expect(first.frames).toBe(30);
    expect(first.bytes).toBe(before.length);
  });
});

describe.skipIf(!ffmpeg || !compose)('the real pipeline', { timeout: 120_000 }, () => {
  const DESIGN: DesignSpec = {
    palette: { bg: '#f4efe2', primary: '#2f6b46', secondary: '#a9c8a2', accent: '#e0683a', ink: '#23302a', soft: '#e7ecd9' },
    motif: 'leaf', coverLayout: 'split', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 7,
  };
  // Beats of several kinds, as in a master: a hook alone is all word slams, and each slam reads as a scene change.
  const CUT: VideoCut = {
    v: 1, tempo: 'standard', sfx: true, craft: 90,
    beats: [
      { kind: 'hook', scene: 0, spoken: 'Cinq erreurs.', screen: 'Cinq erreurs', estSec: 0.7, shots: 1 },
      { kind: 'fact_card', scene: 1, spoken: 'Le bon geste.', screen: 'Le bon geste', estSec: 0.9, shots: 2 },
      { kind: 'end_card', scene: 2, spoken: 'Lien en bio.', screen: 'Guide PDF', estSec: 0.8, shots: 1 },
    ],
    metrics: { estSec: 2.9, hookWordSec: 0, productSec: null, avgShotSec: 0.8, kinds: 3, captionWords: 3, endHoldSec: 0.3 },
  };
  const SPEC: RenderSpec = {
    version: 1, runId: 'p64', creativeId: 'cre_mini', ratio: '9:16', format: 'faceless_voiceover', hook: 'Cinq erreurs.', hookStyle: 'listicle',
    cta: 'Télécharge le guide (lien en bio)', cut: CUT, voice: null, brand: 'Pixel Agency', title: 'Le balcon en 8 étapes', design: DESIGN, pdf: null, cover: null,
  };
  const spoken = (text: string): SpokenLine => {
    const words = estimatedWords(text);
    return { text, voice: null, wav: null, speechSec: words.at(-1)?.end ?? 0, words };
  };

  it('a 3 s mini-cut at 270×480 goes from timeline to a file that passes QA', async () => {
    const timeline = buildTimeline(CUT, CUT.beats.map((b) => spoken(b.spoken)), TEMPO_BPM[CUT.tempo]);
    const stage = stageFor('9:16', 270);
    const assets = await compose!.loadAssets(SPEC, timeline, stage, tmp, { pages: false });
    const comp = compose!.createCompositor(timeline, stage, assets);
    const dir = file('mini');
    mkdirSync(dir);
    const wav = join(dir, 'mix.wav');
    const music = makeMusic(timeline.total, musicFor(SPEC.hook, 'maison', CUT.tempo));
    writeWav(wav, mixDown({ totalSec: timeline.total, music, voices: [], sfx: sfxCues(timeline.beats, 7) }));
    const { path, frames } = await encodeMp4(comp.rgbaFrames(), wav, join(dir, 'master.mp4'), { ffmpeg, w: stage.w, h: stage.h });
    expect(frames).toBe(timeline.frames);
    expect(existsSync(path)).toBe(true);
    expect(timeline.total).toBeGreaterThan(2.5);
    expect(timeline.total).toBeLessThan(3.5);

    const shots = timeline.beats.reduce((n, b) => n + b.shotAt.length, 0);
    const report = checkFile(path, { ffmpeg, w: stage.w, h: stage.h, durationSec: timeline.total, audio: true, shots, text: compose!.textProof(comp), estSec: CUT.metrics.estSec, minSec: 1 });
    expect(report.failed).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.ssim).toBeGreaterThanOrEqual(0.88);

    // The real zones, not a stand-in: a box on the platform's top bar fails the file.
    const planted = compose!.textProof(comp);
    planted.frames[0]!.boxes = [{ x: 30, y: 8, w: 200, h: 30 }];
    const safeText = checkFile(path, { ffmpeg, w: stage.w, h: stage.h, durationSec: timeline.total, audio: true, shots, text: planted, minSec: 1 });
    expect(safeText.failed).toEqual(['safeText']);
    expect(safeText.outside).toBe(1);
  });
});
