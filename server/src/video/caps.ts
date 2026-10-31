/**
 * What this machine can render (video §7). Every piece is optional: a machine missing one lands on a lower step of
 * the ladder and nothing crashes. This module loads without any of them, so it can tell.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type { VideoLevel } from '../shared.js';

export interface VideoCaps {
  level: VideoLevel;
  reason: string | null;       // French, for the founder. Null at `full`
  ffmpeg: string | null;
  voice: string | null;        // voice id
  canvas: boolean;
  pages: boolean;              // pdfjs-dist: real pages of the guide
}

const FORCED = ['no_voice', 'no_pages', 'storyboard_only'] as const;
const REASON = {
  no_voice: 'Sans voix sur cette machine',
  no_pages: 'Sans pages du guide',
  no_ffmpeg: 'Indisponible : ffmpeg introuvable',
  no_canvas: 'Indisponible : moteur de dessin introuvable',
} as const;

/** The binary answers and carries libx264. A build without it cannot make the master. */
function usable(bin: string): boolean {
  const run = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  return run.status === 0 && /\blibx264\b/.test(run.stdout ?? '');
}

function bundledFfmpeg(): string | null {
  try {
    return (createRequire(import.meta.url)('ffmpeg-static') as string | null) ?? null;
  } catch {
    return null;
  }
}

/** FFMPEG_PATH, then PATH, then `ffmpeg-static`. `bundled: null` leaves the last one out. Synchronous: it runs once at start. */
export function findFfmpeg(opts: { bundled?: string | null } = {}): string | null {
  const bundled = opts.bundled === undefined ? bundledFfmpeg() : opts.bundled;
  const order = [process.env.FFMPEG_PATH, 'ffmpeg', bundled].filter((p): p is string => Boolean(p));
  return order.find(usable) ?? null;
}

async function loads(name: () => Promise<unknown>): Promise<boolean> {
  try {
    await name();
    return true;
  } catch {
    return false;
  }
}

async function findVoiceSafe(): Promise<string | null> {
  try {
    return (await import('./speech.js')).findVoice();
  } catch {
    return null;
  }
}

/** Runs once at start. `VIDEO_FORCE_LEVEL` walks the ladder on a machine that has everything (D60). */
export async function detectCaps(): Promise<VideoCaps> {
  const forced = FORCED.find((l) => l === process.env.VIDEO_FORCE_LEVEL);
  const ffmpeg = forced === 'storyboard_only' ? null : findFfmpeg();
  const canvas = forced !== 'storyboard_only' && await loads(() => import('@napi-rs/canvas'));
  const pages = forced !== 'no_pages' && canvas && await loads(() => import('pdfjs-dist/legacy/build/pdf.mjs'));
  const voice = forced === 'no_voice' || !ffmpeg ? null : await findVoiceSafe();
  if (!ffmpeg) return { level: 'storyboard_only', reason: REASON.no_ffmpeg, ffmpeg, voice, canvas, pages };
  if (!canvas) return { level: 'storyboard_only', reason: REASON.no_canvas, ffmpeg, voice, canvas, pages };
  if (!pages) return { level: 'no_pages', reason: REASON.no_pages, ffmpeg, voice, canvas, pages };
  if (!voice) return { level: 'no_voice', reason: REASON.no_voice, ffmpeg, voice, canvas, pages };
  return { level: 'full', reason: null, ffmpeg, voice, canvas, pages };
}
