/**
 * Raw RGBA frames into a faststart H.264 master, through an ffmpeg pipe (video §4.1).
 * The file lands under its name only once complete: a dead render leaves nothing to serve.
 */
import { spawn } from 'node:child_process';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Writable } from 'node:stream';

/** video D14: nothing is burned in the picture, the metadata says it. */
export const VIDEO_COMMENT = 'Pub simulée — Pixel Agency';

export type FrameSource = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;

export interface EncodeOpts {
  ffmpeg: string;
  w: number;
  h: number;
  fps?: number;     // 30
  crf?: number;     // 26
  preset?: string;  // veryfast
  threads?: number; // 2
}

export interface EncodeResult { path: string; bytes: number; frames: number }

export function encodeArgs(wav: string | null, out: string, o: EncodeOpts): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.w}x${o.h}`, '-r', String(o.fps ?? 30), '-i', 'pipe:0',
    ...(wav ? ['-i', wav] : []),
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', o.preset ?? 'veryfast', '-crf', String(o.crf ?? 26), '-profile:v', 'high', '-level', '4.1', '-threads', String(o.threads ?? 2),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    ...(wav ? ['-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-shortest'] : []),
    '-metadata', `comment=${VIDEO_COMMENT}`,
    '-movflags', '+faststart', '-f', 'mp4', out,
  ];
}

/**
 * Writes the frames and waits for `drain`, or memory grows by 8 MB a frame. `gone` settles when
 * the reader is dead: a `drain` that will never come must not hang the render.
 */
export async function pumpFrames(frames: FrameSource, sink: Writable, frameBytes: number, gone: Promise<unknown>): Promise<number> {
  let dead = false;
  void gone.then(() => { dead = true; });
  let written = 0;
  for await (const frame of frames) {
    if (dead) break;
    if (frame.byteLength !== frameBytes) throw new Error(`frame ${written}: ${frame.byteLength} bytes, ${frameBytes} expected`);
    // A copy: `canvas.data()` can be a view of the pixels the next drawFrame overwrites.
    if (!sink.write(Buffer.from(frame))) await Promise.race([new Promise((r) => sink.once('drain', r)), gone]);
    written++;
  }
  return written;
}

/** `wav` null encodes a silent file, which QA fails on any cut that has audio. */
export async function encodeMp4(frames: FrameSource, wav: string | null, out: string, opts: EncodeOpts): Promise<EncodeResult> {
  await mkdir(dirname(out), { recursive: true });
  const part = `${out}.part`;
  const child = spawn(opts.ffmpeg, encodeArgs(wav, part, opts), { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let log = '';
  child.stderr.on('data', (d: Buffer) => { log = (log + d.toString()).slice(-2000); });
  child.stdin.on('error', () => { /* EPIPE: ffmpeg died, its exit code and log tell why */ });
  const exit = new Promise<number>((resolve) => {
    child.once('error', (e) => { log = e.message; resolve(-1); });
    child.once('close', (code) => resolve(code ?? -1));
  });
  try {
    const written = await pumpFrames(frames, child.stdin, opts.w * opts.h * 4, exit);
    if (written === 0) throw new Error(log.trim() || 'no frame to encode');
    child.stdin.end();
    const code = await exit;
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${log.trim()}`);
    await rename(part, out);
    return { path: out, bytes: (await stat(out)).size, frames: written };
  } catch (err) {
    child.kill();
    await exit;
    await rm(part, { force: true });
    throw err;
  }
}
