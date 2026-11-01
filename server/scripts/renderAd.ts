/**
 * Draws one creative of a finished run, to look at it: PNG frames and a contact sheet, no world touched.
 *
 *   npm run video -- --run <id> [--creative <id>] [--ratio 9:16] [--times 0.3,6.9,18] [--width 1080] [--out <dir>]
 *
 * Without --creative it takes the best approved voice-over. Timings come from the speech model: frames need no voice.
 * VIDEO_FORCE_LEVEL=no_pages shows the fallback of a machine without pdfjs-dist.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { isEntryPoint } from '../src/api/entry.js';
import { runPaths } from '../src/core/index.js';
import type { AdCreative, AdRatio, WorldState } from '../src/shared.js';
import { detectCaps } from '../src/video/caps.js';
import { createCompositor, loadAssets, textProof } from '../src/video/compose.js';
import { buildRenderSpec, renderKey } from '../src/video/spec.js';
import { synthesize } from '../src/video/speech.js';
import { insideSafe, stageFor, type VideoRatio } from '../src/video/stage.js';
import { buildTimeline, FPS, TEMPO_BPM } from '../src/video/timeline.js';

const SHEET_COLS = 8;
const SHEET_W = 216;
const RATIOS: readonly AdRatio[] = ['9:16', '4:5', '1:1', '2:3'];

interface Args { run: string; creative?: string; ratio: VideoRatio; times?: number[]; width?: number; out?: string }

function parseArgs(argv: readonly string[]): Args {
  const opt = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const run = opt('run');
  if (!run) throw new Error('--run <id> is required');
  const ratio = (opt('ratio') ?? '9:16') as AdRatio;
  if (ratio === 'text' || !RATIOS.includes(ratio)) throw new Error(`no such ratio: ${ratio}`);
  const times = opt('times')?.split(',').map(Number);
  const width = opt('width');
  return { run, creative: opt('creative'), ratio, times, width: width ? Number(width) : undefined, out: opt('out') };
}

function bestCreative(world: WorldState): AdCreative | undefined {
  const score = (c: AdCreative): number => c.quality?.overall ?? 0;
  return world.company.creatives
    .filter((c) => c.cut && c.format === 'faceless_voiceover' && c.review.status === 'approved')
    .sort((a, b) => score(b) - score(a))[0];
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  const paths = runPaths(args.run);
  const world = JSON.parse(readFileSync(join(paths.root, 'world.json'), 'utf8')) as WorldState;
  const creativeId = args.creative ?? bestCreative(world)?.id;
  if (!creativeId) throw new Error(`no approved voice-over with a cut in ${args.run}`);
  const spec = buildRenderSpec(world, creativeId, args.ratio);
  const speech = synthesize(spec.cut.beats.map((b) => b.spoken), null);
  const timeline = buildTimeline(spec.cut, speech, TEMPO_BPM[spec.cut.tempo]);
  const stage = stageFor(args.ratio, args.width);
  const caps = await detectCaps();
  const assets = await loadAssets(spec, timeline, stage, paths.root, { pages: caps.pages });
  const comp = createCompositor(timeline, stage, assets);

  const out = args.out ?? join(paths.root, 'video', creativeId, renderKey(spec).slice(0, 8), 'frames');
  mkdirSync(out, { recursive: true });
  const times = args.times ?? timeline.beats.flatMap((b) => b.shotAt.map((at, i) => b.t0 + at + Math.min(0.9, ((b.shotAt[i + 1] ?? b.dur) - at) * 0.7)));
  const sheetH = Math.round(SHEET_W * stage.h / stage.w);
  const sheet = createCanvas(SHEET_W * SHEET_COLS, sheetH * Math.ceil(times.length / SHEET_COLS));
  const sheetCtx = sheet.getContext('2d');
  let outside = 0;
  for (const [i, sec] of times.entries()) {
    const boxes = comp.drawFrame(Math.round(sec * FPS));
    outside += boxes.filter((b) => !insideSafe(stage, b)).length;
    writeFileSync(join(out, `frame-${sec.toFixed(2).padStart(6, '0')}.png`), await comp.canvas.encode('png'));
    sheetCtx.drawImage(comp.canvas, (i % SHEET_COLS) * SHEET_W, Math.floor(i / SHEET_COLS) * sheetH, SHEET_W, sheetH);
  }
  writeFileSync(join(out, 'sheet.png'), await sheet.encode('png'));
  const proof = textProof(comp); // what the worker's QA reads, not the frames asked for here
  const refused = proof.frames.flatMap((f) => f.boxes.filter((b) => !proof.inside(b)).map((b) => `${f.frame} « ${(b as { text?: string }).text ?? ''} »`));
  console.log(`${creativeId} « ${spec.hook} »`);
  console.log(timeline.beats.map((b) => `${b.kind}@${b.t0.toFixed(2)} (${b.shotAt.length})`).join(' '));
  console.log(`${timeline.total.toFixed(2)} s, ${times.length} frames, ${assets.proofs.size} real proof pages, ${outside} text boxes outside the zones, ${refused.length} on the frames QA reads${refused.length ? `: ${refused.slice(0, 4).join(', ')}` : ''}`);
  console.log(out);
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  });
}
