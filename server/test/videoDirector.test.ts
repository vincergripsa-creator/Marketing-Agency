/**
 * The queue around the render (video §9, §12): who gets a video, one job at a time, the cache, the disk cap, the reload, the
 * API. A fake runner stands in for the child process, except in one test that forks the real worker.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { constants as osConstants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdCreative, Campaign, CreativeVideo, Task, VideoCut, VideoIndex, WorldState } from '../src/shared.js';
import type { RunPaths } from '../src/contracts.js';
import { createAgencyServer, type SessionLike } from '../src/api/server.js';
import { liveVideos } from '../src/api/session.js';
import { findFfmpeg } from '../src/video/caps.js';
import type { VideoCaps } from '../src/video/caps.js';
import {
  DEFAULT_MAX_DISK_MB, forkRender, OFF_CAPS, RESULT_FILE, selectWorthy, SPEC_FILE, VideoDirector, videoDiskCapOf, videoModeOf, WORTHY,
  type DirectorOptions, type RenderRunner, type VideoMode,
} from '../src/video/director.js';
import type { RenderJob, RenderResult } from '../src/video/worker.js';

const tmp = mkdtempSync(join(tmpdir(), 'video-director-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const CAPS: VideoCaps = { level: 'no_voice', reason: 'Sans voix sur cette machine', ffmpeg: null, voice: null, canvas: true, pages: false };

const cut = (word = 'erreurs'): VideoCut => ({
  v: 1, tempo: 'standard', sfx: true, craft: 90,
  beats: [{ kind: 'hook', scene: 0, spoken: `Cinq ${word}.`, screen: `Cinq ${word}`, estSec: 1, shots: 1 }],
  metrics: { estSec: 1, hookWordSec: 0, productSec: null, avgShotSec: 1, kinds: 1, captionWords: 3, endHoldSec: 0.5 },
});

const creative = (id: string, over: Partial<AdCreative> = {}): AdCreative => ({
  id, productId: 'prd_1', hook: 'Cinq erreurs.', hookStyle: 'listicle', format: 'faceless_voiceover', scenes: [], caption: '', hashtags: [], cta: 'Lien en bio',
  files: { storyboard: [], preview: null }, quality: { overall: 85 } as AdCreative['quality'], review: { status: 'approved', reason: null, day: 1 },
  createdDay: 1, createdBy: 'zoe', cut: cut(), ...over,
});

const campaign = (id: string, creativeIds: string[], over: Partial<Campaign> = {}): Campaign => ({
  id, productId: 'prd_1', name: id, creativeIds, dailyBudget: 10, status: 'active', targeting: { interests: [], ageMin: 18, ageMax: 65 }, startDay: 1, createdBy: 'zoe', ...over,
});

/** A world with what the director reads. `shown`: impressions by creative, on one row of market.adStats. */
function world(creatives: AdCreative[], shown: Record<string, number> = {}, over: { campaigns?: Campaign[]; tasks?: Partial<Task>[]; retired?: Record<string, number> } = {}): WorldState {
  const tasks = over.tasks ?? [];
  return {
    runId: 'run', day: 5,
    company: {
      name: 'Pixel Agency', creatives, tasks, pendingApprovals: tasks.filter((t) => t.status === 'awaiting_founder').map((t) => t.id),
      campaigns: over.campaigns ?? [campaign('cmp_1', creatives.map((c) => c.id))],
      products: [{ id: 'prd_1', title: 'Le balcon en 8 étapes', design: { family: 'maison' }, files: { pdf: null, cover: null, salesPage: null } }],
    },
    market: {
      adStats: Object.entries(shown).map(([creativeId, impressions]) => ({ day: 4, creativeId, impressions, spend: 1, revenue: 0, clicks: 10, ctr: 0.02, frequency: 1 })),
      retiredAdTotals: Object.fromEntries(Object.entries(over.retired ?? {}).map(([id, impressions]) => [id, { impressions }])),
      creativeImpressions: {},
    },
  } as unknown as WorldState;
}

const launch = (id: string): Partial<Task> => ({ id, kind: 'launch_campaign', status: 'awaiting_founder', input: { productId: 'prd_1' } });

const until = async (cond: () => boolean, ms = 15_000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 2));
  }
};

const relOf = (job: RenderJob): string => job.dir.slice(job.root.length + 1).replace(/\\/g, '/');

/** Stands in for the worker: writes the files it would write. `hold` keeps each job open until `release`. */
function renderer(opts: { hold?: boolean; bytes?: number; answer?: (job: RenderJob, n: number) => Partial<RenderResult> | void } = {}) {
  const jobs: RenderJob[] = [];
  const specs: string[] = [];
  const open: (() => void)[] = [];
  const render: RenderRunner = (job) => {
    const n = jobs.push(job);
    specs.push(JSON.parse(readFileSync(join(job.dir, SPEC_FILE), 'utf8')).creativeId as string);
    let cancel = (): void => undefined;
    const result = new Promise<RenderResult>((resolve) => {
      const finish = () => {
        const bytes = opts.bytes ?? 100;
        const rel = relOf(job);
        mkdirSync(job.dir, { recursive: true }); // the worker holds its folder open: a removal does not stop it
        writeFileSync(join(job.dir, 'master.mp4'), Buffer.alloc(bytes));
        writeFileSync(join(job.dir, 'poster.jpg'), 'poster');
        writeFileSync(join(job.dir, 'captions.vtt'), 'WEBVTT');
        const done: RenderResult = {
          ok: true, retry: false, reason: null, video: { ratio: '9:16', path: `${rel}/master.mp4`, durationSec: 20, bytes }, bytes,
          poster: `${rel}/poster.jpg`, captions: `${rel}/captions.vtt`, cards: [], voice: null, qa: { ok: true, failed: [], lufs: -14, cuts: 9, avgShotSec: 2, mb: 0 },
        };
        const r = { ...done, ...opts.answer?.(job, n) };
        if (r.ok) writeFileSync(join(job.dir, RESULT_FILE), JSON.stringify(r));
        resolve(r);
      };
      cancel = () => resolve({ ok: false, retry: true, reason: 'tué', video: null, bytes: 0, poster: null, captions: null, cards: [], voice: null, qa: null });
      if (opts.hold) open.push(finish);
      else setImmediate(finish);
    });
    return { result, cancel: () => cancel() };
  };
  return { render, jobs, specs, release: () => open.shift()?.(), pending: () => open.length };
}

let paths: RunPaths;
let runCount = 0;
beforeEach(() => {
  const root = join(tmp, `run-${runCount++}`);
  mkdirSync(root, { recursive: true });
  paths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
});

const opened: VideoDirector[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((d) => d.stop())); });

function director(render: RenderRunner, over: Partial<DirectorOptions> & { mode?: VideoMode } = {}) {
  const changes: { id: string; video: CreativeVideo }[] = [];
  const d = new VideoDirector({ paths, mode: 'auto', caps: CAPS, maxDiskMb: DEFAULT_MAX_DISK_MB, render, onChange: (id, video) => { changes.push({ id, video }); }, probe: () => 20, ...over });
  opened.push(d);
  return { d, changes, statuses: (id: string) => changes.filter((c) => c.id === id).map((c) => c.video.status) };
}

const status = (d: VideoDirector, id: string): string | undefined => d.index().items[id]?.status;
const manifest = (): { renders: { creativeId: string; status: string; key: string }[] } => JSON.parse(readFileSync(join(paths.root, 'video', 'manifest.json'), 'utf8'));
/** The manifest is written behind the job: it may not be there yet. */
const manifestSays = (status: string): boolean => {
  try {
    return manifest().renders[0]?.status === status;
  } catch {
    return false;
  }
};

describe('selectWorthy', () => {
  it('leaves everything under 1 000 impressions out, and counts the whole life of a creative', () => {
    expect(WORTHY.minImpressions).toBe(1000);
    expect(selectWorthy(world([creative('a'), creative('b')], { a: 999, b: 0 }))).toEqual([]);
    expect(selectWorthy(world([creative('a')], { a: 1000 }))).toEqual([{ creativeId: 'a', ratio: '9:16' }]);
    expect(selectWorthy(world([creative('a')], { a: 400 }, { retired: { a: 600 } }))).toEqual([{ creativeId: 'a', ratio: '9:16' }]);
  });

  it('puts what waits for the founder first, whatever its impressions', () => {
    const ads = [creative('shown'), creative('fresh')];
    const w = world(ads, { shown: 5000 }, { campaigns: [campaign('cmp_1', ['shown'])], tasks: [launch('tsk_1')] });
    expect(selectWorthy(w).map((o) => o.creativeId)).toEqual(['fresh', 'shown']);
    // Answered, the launch stops counting: the fresh ad is one more unshown ad.
    w.company.pendingApprovals = [];
    expect(selectWorthy(w).map((o) => o.creativeId)).toEqual(['shown']);
  });

  it('never gives more than 3, the best shown first', () => {
    const ads = ['a', 'b', 'c', 'd', 'e'].map((id) => creative(id));
    const worthy = selectWorthy(world(ads, { a: 1000, b: 5000, c: 2000, d: 3000, e: 4000 }));
    expect(worthy.map((o) => o.creativeId)).toEqual(['b', 'e', 'd']);
  });

  it('reaches the fourth once the director has answered the first three', () => {
    const ads = ['a', 'b', 'c', 'd'].map((id) => creative(id));
    const done = new Set(['a', 'b', 'c']);
    expect(selectWorthy(world(ads, { a: 9000, b: 8000, c: 7000, d: 6000 }), (id) => done.has(id)).map((o) => o.creativeId)).toEqual(['d']);
  });

  it('needs an active campaign, an approved ad and quality 70', () => {
    const paused = world([creative('a')], { a: 5000 }, { campaigns: [campaign('cmp_1', ['a'], { status: 'paused' })] });
    expect(selectWorthy(paused)).toEqual([]);
    expect(selectWorthy(world([creative('a', { review: { status: 'pending', reason: null, day: null } })], { a: 5000 }))).toEqual([]);
    expect(selectWorthy(world([creative('a', { quality: { overall: 69 } as AdCreative['quality'] })], { a: 5000 }))).toEqual([]);
    expect(selectWorthy(world([creative('a', { quality: { overall: 70 } as AdCreative['quality'] })], { a: 5000 }))).toHaveLength(1);
    expect(selectWorthy(world([creative('a')], { a: 5000 }, { campaigns: [] }))).toEqual([]);
  });

  it('reads approval on the channel the ad runs on', () => {
    const meta = creative('a', { review: { status: 'pending', reason: null, day: null }, ratio: '4:5', channelReviews: { meta: { status: 'approved' } } as AdCreative['channelReviews'] });
    const w = world([meta], { a: 5000 }, { campaigns: [campaign('cmp_1', ['a'], { channel: 'meta' })] });
    expect(selectWorthy(w)).toEqual([{ creativeId: 'a', ratio: '4:5' }]);
  });

  it('gives nothing to a text ad or an ad without a plan, and a pin needs no cut', () => {
    const search = creative('a', { format: 'search_text', ratio: 'text' });
    const noCut = creative('b', { cut: null });
    const pin = creative('c', { format: 'static_image', ratio: '2:3', cut: null });
    expect(selectWorthy(world([search, noCut, pin], { a: 5000, b: 5000, c: 5000 }))).toEqual([{ creativeId: 'c', ratio: '2:3' }]);
  });

  it('reads the world and writes nothing in it', () => {
    const w = world([creative('a'), creative('b')], { a: 5000 }, { campaigns: [campaign('cmp_1', ['a'])], tasks: [launch('tsk_1')] });
    const before = JSON.stringify(w);
    selectWorthy(w);
    expect(JSON.stringify(w)).toBe(before);
  });
});

describe('the queue', () => {
  it('renders one job at a time, and sync never waits for it', async () => {
    const r = renderer({ hold: true });
    const { d, statuses } = director(r.render);
    const w = world(['a', 'b'].map((id) => creative(id)), { a: 9000, b: 8000 });
    d.sync(w); // returns with the job open: the tick goes on
    await until(() => r.jobs.length === 1);
    expect(status(d, 'a')).toBe('rendering');
    expect(status(d, 'b')).toBe('queued');
    d.sync(w);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.jobs).toHaveLength(1);
    r.release();
    await until(() => r.jobs.length === 2);
    expect(status(d, 'a')).toBe('ready');
    expect(status(d, 'b')).toBe('rendering');
    r.release();
    await until(() => status(d, 'b') === 'ready');
    expect(r.specs).toEqual(['a', 'b']);
    expect(statuses('a')).toEqual(['queued', 'rendering', 'ready']);
  });

  it('holds three at most in the queue, and the rest gets its turn', async () => {
    const r = renderer({ hold: true });
    const { d } = director(r.render);
    const ads = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => creative(id));
    const w = world(ads, { a: 9000, b: 8000, c: 7000, d: 6000, e: 5000, f: 4000 });
    d.sync(w);
    await until(() => r.jobs.length === 1);
    d.sync(w);
    const open = () => Object.values(d.index().items).filter((v) => v.status === 'queued').length;
    expect(open()).toBeLessThanOrEqual(WORTHY.maxQueued);
    while (r.jobs.length < ads.length) {
      r.release();
      await until(() => r.pending() === 1 || r.jobs.length === ads.length);
      d.sync(w);
      expect(open()).toBeLessThanOrEqual(WORTHY.maxQueued);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(r.specs).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('same key, ready file: no second render, across sync, request and a reload', async () => {
    const r = renderer();
    const { d } = director(r.render);
    const w = world([creative('a')], { a: 5000 });
    d.sync(w);
    await until(() => status(d, 'a') === 'ready');
    d.sync(w);
    expect(d.request(w, 'a').status).toBe('ready');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.jobs).toHaveLength(1);
    await d.stop();

    const again = director(r.render);
    expect(status(again.d, 'a')).toBe('ready');
    again.d.sync(w);
    expect(again.d.request(w, 'a').videos).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.jobs).toHaveLength(1);
  });

  it('finds a finished key on disk when the manifest forgot it', async () => {
    const r = renderer();
    const { d } = director(r.render);
    const w = world([creative('a')], { a: 5000 });
    d.sync(w);
    await until(() => status(d, 'a') === 'ready');
    await d.stop();
    rmSync(join(paths.root, 'video', 'manifest.json'));
    const fresh = director(r.render);
    fresh.d.sync(w);
    expect(status(fresh.d, 'a')).toBe('ready');
    expect(r.jobs).toHaveLength(1);
  });

  it('a rework gets a new key, a new render, and the old file goes', async () => {
    const r = renderer();
    const { d } = director(r.render);
    const ad = creative('a');
    const w = world([ad], { a: 5000 });
    d.sync(w);
    await until(() => status(d, 'a') === 'ready');
    const first = r.jobs[0]!.dir;
    ad.cut = cut('pièges');
    d.sync(w);
    await until(() => status(d, 'a') === 'ready' && r.jobs.length === 2);
    expect(r.jobs[1]!.dir).not.toBe(first);
    await until(() => !existsSync(first));
    expect(d.index().items.a!.videos[0]!.path).toContain(relOf(r.jobs[1]!));
    expect(manifest().renders).toHaveLength(1);
  });

  it('drops a render whose ad was reworked while it ran', async () => {
    const r = renderer({ hold: true });
    const { d } = director(r.render);
    const ad = creative('a');
    const w = world([ad], { a: 5000 });
    d.sync(w);
    await until(() => r.jobs.length === 1);
    ad.cut = cut('pièges');
    d.sync(w);
    await until(() => !existsSync(r.jobs[0]!.dir));
    r.release(); // the old render lands after the rework has cleaned up
    await until(() => r.jobs.length === 2);
    r.release();
    await until(() => status(d, 'a') === 'ready');
    expect(d.index().items.a!.videos[0]!.path).toContain(relOf(r.jobs[1]!));
    await until(() => !existsSync(r.jobs[0]!.dir));
  });

  it('copies the spec when the job enters the queue: the world moves on while it waits', async () => {
    const r = renderer({ hold: true });
    const { d } = director(r.render);
    const ad = creative('b', { hook: 'Avant.' });
    const w = world([creative('a'), ad], { a: 9000, b: 8000 });
    d.sync(w);
    await until(() => r.jobs.length === 1);
    ad.hook = 'Après.';
    r.release();
    await until(() => r.jobs.length === 2);
    expect(JSON.parse(readFileSync(join(r.jobs[1]!.dir, SPEC_FILE), 'utf8')).hook).toBe('Avant.');
  });

  it('on-demand goes first', async () => {
    const r = renderer({ hold: true });
    const { d } = director(r.render);
    const ads = ['a', 'b', 'c', 'asked'].map((id) => creative(id));
    const w = world(ads, { a: 9000, b: 8000, c: 7000 });
    d.sync(w);
    await until(() => r.jobs.length === 1);
    expect(d.request(w, 'asked').status).toBe('queued');
    r.release();
    await until(() => r.jobs.length === 2);
    expect(r.specs[1]).toBe('asked');
    r.release();
  });

  it('moves a queued job to the front when the founder asks for it', async () => {
    const r = renderer({ hold: true });
    const { d } = director(r.render);
    const w = world(['a', 'b', 'c'].map((id) => creative(id)), { a: 9000, b: 8000, c: 7000 });
    d.sync(w);
    await until(() => r.jobs.length === 1);
    d.request(w, 'c');
    r.release();
    await until(() => r.jobs.length === 2);
    expect(r.specs[1]).toBe('c');
    r.release();
  });

  it('renders a second ratio of one creative beside the first', async () => {
    const r = renderer();
    const { d } = director(r.render);
    const w = world([creative('a')], { a: 5000 });
    d.request(w, 'a');
    await until(() => status(d, 'a') === 'ready');
    d.request(w, 'a', '4:5');
    await until(() => r.jobs.length === 2 && status(d, 'a') === 'ready');
    expect(d.index().items.a!.videos).toHaveLength(2);
    expect(new Set(r.jobs.map((j) => j.dir)).size).toBe(2);
  });

  it('writes no status it did not reach: the manifest follows each job', async () => {
    const r = renderer();
    const { d } = director(r.render);
    d.sync(world([creative('a')], { a: 5000 }));
    await until(() => status(d, 'a') === 'ready');
    await d.stop();
    expect(manifest().renders).toMatchObject([{ creativeId: 'a', status: 'ready' }]);
    expect(existsSync(join(r.jobs[0]!.dir, SPEC_FILE))).toBe(true);
  });
});

describe('a failed job', () => {
  it('a failed QA is failed at once, its file is gone and never served', async () => {
    const qa = { ok: false, failed: ['cadence'], lufs: -14, cuts: 2, avgShotSec: 9, mb: 1 };
    const r = renderer({ answer: () => ({ ok: false, retry: false, reason: 'Échec du contrôle : cadence', video: null, poster: null, captions: null, qa }) });
    const { d } = director(r.render);
    const w = world([creative('a')], { a: 5000 });
    d.sync(w);
    await until(() => status(d, 'a') === 'failed');
    expect(r.jobs).toHaveLength(1);
    expect(d.index().items.a).toMatchObject({ status: 'failed', reason: 'Échec du contrôle : cadence', videos: [], poster: null, qa });
    expect(existsSync(r.jobs[0]!.dir)).toBe(false);
    // Nobody renders it again unasked: the same plan would fail the same way.
    d.sync(w);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.jobs).toHaveLength(1);
    // The founder may.
    expect(d.request(w, 'a').status).toBe('rendering'); // the queue was empty
    await until(() => r.jobs.length === 2);
  });

  it('a crash gets one retry, then fails with a French reason', async () => {
    const r = renderer({ answer: () => ({ ok: false, retry: true, reason: "Le rendu s'est arrêté avant la fin", video: null, poster: null, captions: null, qa: null }) });
    const { d, statuses } = director(r.render);
    d.sync(world([creative('a')], { a: 5000 }));
    await until(() => status(d, 'a') === 'failed');
    expect(r.jobs).toHaveLength(2);
    expect(statuses('a')).toEqual(['queued', 'rendering', 'queued', 'rendering', 'failed']);
    expect(d.index().items.a!.reason).toBe("Le rendu s'est arrêté avant la fin");
  });

  it('a crash that passes on the retry is a plain success', async () => {
    const r = renderer({ answer: (_job, n) => (n === 1 ? { ok: false, retry: true, reason: 'x', video: null } : undefined) });
    const { d } = director(r.render);
    d.sync(world([creative('a')], { a: 5000 }));
    await until(() => status(d, 'a') === 'ready');
    expect(r.jobs).toHaveLength(2);
  });

  it('a runner that throws is a crash, not a stopped queue', async () => {
    let calls = 0;
    const ok = renderer();
    const render: RenderRunner = (job) => {
      calls += 1;
      if (calls <= 2) throw new Error('fork refused');
      return ok.render(job);
    };
    const { d } = director(render);
    const w = world([creative('a'), creative('b')], { a: 9000, b: 8000 });
    d.sync(w);
    await until(() => status(d, 'a') === 'failed' && status(d, 'b') === 'ready');
    expect(calls).toBe(3);
  });
});

describe('the disk', () => {
  it('over maxDiskMb the lowest-impression video goes, its poster stays, and it can come back', async () => {
    const r = renderer({ bytes: 600_000 });
    const { d } = director(r.render, { maxDiskMb: 1.5 });
    const w = world(['low', 'mid', 'top'].map((id) => creative(id)), { top: 9000, mid: 5000, low: 2000 });
    for (const id of ['top', 'mid']) {
      d.request(w, id);
      await until(() => status(d, id) === 'ready');
    }
    d.sync(w); // now it knows the impressions, and the third file crosses the cap
    await until(() => status(d, 'low') === 'ready' || status(d, 'mid') === 'evicted');
    await until(() => Object.values(d.index().items).filter((v) => v.status === 'evicted').length === 1);
    const { items } = d.index();
    expect(items.top!.status).toBe('ready');
    expect(items.low!.status).toBe('ready'); // the file that just landed stays
    expect(items.mid).toMatchObject({ status: 'evicted', videos: [], captions: null });
    expect(items.mid!.reason).toBeTruthy();
    const dir = r.jobs[1]!.dir;
    expect(existsSync(join(dir, 'poster.jpg'))).toBe(true);
    expect(existsSync(join(dir, 'master.mp4'))).toBe(false);
    expect(existsSync(join(dir, RESULT_FILE))).toBe(false);
    expect(items.mid!.poster).toBe(`${relOf(r.jobs[1]!)}/poster.jpg`);

    // Sync never brings it back: only the founder does.
    d.sync(w);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.jobs).toHaveLength(3);
    expect(d.request(w, 'mid').status).not.toBe('evicted');
    await until(() => r.jobs.length >= 4 && status(d, 'mid') === 'ready');
  });

  it('keeps the first card of an evicted carousel as its poster', async () => {
    const r = renderer({
      bytes: 600_000,
      answer: (job) => {
        const rel = relOf(job);
        writeFileSync(join(job.dir, 'card-1.png'), 'one');
        writeFileSync(join(job.dir, 'card-2.png'), 'two');
        return { video: null, captions: null, cards: [`${rel}/card-1.png`, `${rel}/card-2.png`], poster: `${rel}/card-1.png` };
      },
    });
    const { d } = director(r.render, { maxDiskMb: 1 });
    const ads = ['a', 'b'].map((id) => creative(id, { format: 'carousel' }));
    const w = world(ads, { a: 2000, b: 9000 });
    d.request(w, 'a');
    await until(() => status(d, 'a') === 'ready');
    d.sync(w);
    await until(() => status(d, 'a') === 'evicted');
    expect(d.index().items.a).toMatchObject({ cards: [], poster: `${relOf(r.jobs[0]!)}/card-1.png` });
    expect(existsSync(join(r.jobs[0]!.dir, 'card-1.png'))).toBe(true);
    expect(existsSync(join(r.jobs[0]!.dir, 'card-2.png'))).toBe(false);
  });

  it('stays quiet under the cap', async () => {
    const r = renderer({ bytes: 600_000 });
    const { d } = director(r.render, { maxDiskMb: 10 });
    d.sync(world(['a', 'b', 'c'].map((id) => creative(id)), { a: 9000, b: 8000, c: 7000 }));
    await until(() => r.jobs.length === 3 && Object.values(d.index().items).every((v) => v.status === 'ready'));
  });

  it('retireCreativeFiles leaves nothing of a creative, queued job included', async () => {
    const r = renderer({ hold: true });
    const { d } = director(r.render);
    const w = world(['a', 'b'].map((id) => creative(id)), { a: 9000, b: 8000 });
    d.sync(w);
    await until(() => r.jobs.length === 1);
    r.release();
    await until(() => r.jobs.length === 2);
    await d.retireCreativeFiles('a');
    expect(d.index().items.a).toBeUndefined();
    expect(existsSync(r.jobs[0]!.dir)).toBe(false);
    expect(manifest().renders.map((x) => x.creativeId)).toEqual(['b']);
    r.release();
    await until(() => status(d, 'b') === 'ready');
    await d.retireCreativeFiles('b');
    await d.retireCreativeFiles('never-seen');
    expect(d.index().items).toEqual({});
  });

  it('forgets a job still in the queue when its creative is retired', async () => {
    const r = renderer({ hold: true });
    const { d } = director(r.render);
    const w = world(['a', 'b'].map((id) => creative(id)), { a: 9000, b: 8000 });
    d.sync(w);
    await until(() => r.jobs.length === 1);
    await d.retireCreativeFiles('b');
    r.release();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(r.specs).toEqual(['a']);
  });
});

describe('a reload', () => {
  const FINISHED = (dir: string, bytes: number, durationSec = 20): RenderResult => ({
    ok: true, retry: false, reason: null, video: { ratio: '9:16', path: `${dir}/master.mp4`, durationSec, bytes }, bytes, poster: null, captions: null, cards: [], voice: null, qa: null,
  });

  /** What a server leaves behind when it dies mid-job. */
  async function diedRendering(): Promise<{ w: WorldState; r: ReturnType<typeof renderer>; dir: string; rel: string }> {
    const r = renderer({ hold: true });
    const { d } = director(r.render);
    const w = world([creative('a')], { a: 5000 });
    d.sync(w);
    await until(() => r.jobs.length === 1 && manifestSays('rendering'));
    const job = r.jobs[0]!;
    return { w, r, dir: job.dir, rel: relOf(job) };
  }

  it('puts what was rendering back in the queue, and it renders', async () => {
    const { r } = await diedRendering();
    const next = renderer();
    const { d } = director(next.render);
    expect(status(d, 'a')).toBe('queued');
    d.sync(world([creative('a')], {}));
    await until(() => status(d, 'a') === 'ready');
    expect(next.specs).toEqual(['a']);
    expect(r.jobs).toHaveLength(1);
  });

  it('a key already on disk is ready after a light QA, with no render', async () => {
    const { dir, rel } = await diedRendering();
    writeFileSync(join(dir, 'master.mp4'), Buffer.alloc(500));
    writeFileSync(join(dir, RESULT_FILE), JSON.stringify(FINISHED(rel, 500)));
    const next = renderer();
    const { d } = director(next.render);
    expect(status(d, 'a')).toBe('ready');
    d.sync(world([creative('a')], {}));
    expect(next.jobs).toHaveLength(0);
  });

  it('a master without its result is a render that died: QA never read it', async () => {
    const { dir } = await diedRendering();
    writeFileSync(join(dir, 'master.mp4'), Buffer.alloc(500));
    expect(status(director(renderer().render).d, 'a')).toBe('queued');
  });

  it('the light QA refuses a file of the wrong size or the wrong duration', async () => {
    const { dir, rel } = await diedRendering();
    writeFileSync(join(dir, 'master.mp4'), Buffer.alloc(500));
    writeFileSync(join(dir, RESULT_FILE), JSON.stringify(FINISHED(rel, 501)));
    expect(status(director(renderer().render).d, 'a')).toBe('queued');
    writeFileSync(join(dir, RESULT_FILE), JSON.stringify(FINISHED(rel, 500, 21)));
    expect(status(director(renderer().render).d, 'a')).toBe('queued');
    writeFileSync(join(dir, RESULT_FILE), JSON.stringify(FINISHED(rel, 500)));
    expect(status(director(renderer().render, { probe: () => null }).d, 'a')).toBe('queued');
    expect(status(director(renderer().render).d, 'a')).toBe('ready');
  });

  it('a ready video whose file vanished is evicted, not served', async () => {
    const r = renderer();
    const first = director(r.render);
    first.d.sync(world([creative('a')], { a: 5000 }));
    await until(() => status(first.d, 'a') === 'ready');
    await first.d.stop();
    rmSync(join(r.jobs[0]!.dir, 'master.mp4'));
    const { d } = director(r.render);
    expect(d.index().items.a).toMatchObject({ status: 'evicted', videos: [] });
  });

  it('a stop puts the running job back, and its render is not kept', async () => {
    const r = renderer({ hold: true });
    const { d } = director(r.render);
    const w = world([creative('a'), creative('b')], { a: 9000, b: 8000 });
    d.sync(w);
    await until(() => r.jobs.length === 1);
    await d.stop();
    expect(manifest().renders.map((x) => x.status)).toEqual(['queued', 'queued']);
    d.sync(w);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.jobs).toHaveLength(1);
    // A job that never started left no spec: the next sync asks again from the world, which has moved on anyway.
    const next = director(renderer().render);
    expect(status(next.d, 'a')).toBe('queued');
    expect(status(next.d, 'b')).toBeUndefined();
    next.d.sync(w);
    expect(status(next.d, 'b')).toBe('queued');
  });

  it('survives a manifest it cannot read', () => {
    mkdirSync(join(paths.root, 'video'), { recursive: true });
    writeFileSync(join(paths.root, 'video', 'manifest.json'), '{ not json');
    expect(director(renderer().render).d.index().items).toEqual({});
  });
});

describe('what a machine or a mode refuses', () => {
  it('`storyboard_only`: nothing renders, nothing crashes, the reason is the ladder\'s', async () => {
    const r = renderer();
    const caps: VideoCaps = { ...CAPS, level: 'storyboard_only', reason: 'Indisponible : ffmpeg introuvable' };
    const { d } = director(r.render, { caps });
    const w = world([creative('a')], { a: 5000 });
    d.sync(w);
    expect(d.request(w, 'a')).toMatchObject({ status: 'unavailable', reason: 'Indisponible : ffmpeg introuvable', videos: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.jobs).toHaveLength(0);
    expect(d.index()).toEqual({ level: 'storyboard_only', reason: 'Indisponible : ffmpeg introuvable', items: {} });
  });

  it('`off`: sync does nothing and reads nothing of the world, and files already made stay served', async () => {
    const r = renderer();
    const on = director(r.render);
    const w = world([creative('a'), creative('b')], { a: 9000 }, { campaigns: [campaign('cmp_1', ['a'])] });
    on.d.request(w, 'a');
    await until(() => status(on.d, 'a') === 'ready');
    await on.d.stop();
    const { d } = director(r.render, { mode: 'off', caps: OFF_CAPS });
    d.sync({} as WorldState);
    expect(d.request(w, 'a').status).toBe('ready');
    expect(d.request(w, 'b')).toMatchObject({ status: 'unavailable', reason: OFF_CAPS.reason });
    expect(r.jobs).toHaveLength(1);
  });

  it('`ondemand`: only the founder starts a render', async () => {
    const r = renderer();
    const { d } = director(r.render, { mode: 'ondemand' });
    const w = world([creative('a')], { a: 9000 });
    d.sync(w);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.jobs).toHaveLength(0);
    d.request(w, 'a');
    await until(() => status(d, 'a') === 'ready');
  });

  it('answers a text ad, an ad with no plan and an unknown id, and queues none of them', () => {
    const r = renderer();
    const { d } = director(r.render);
    const w = world([creative('text', { format: 'search_text', ratio: 'text' }), creative('old', { cut: null })]);
    expect(d.request(w, 'text').status).toBe('unavailable');
    expect(d.request(w, 'old').status).toBe('unavailable');
    expect(d.request(w, 'ghost').status).toBe('unavailable');
    expect(d.index().items).toEqual({});
  });

  it('a creative whose product left the world is skipped, not a crash of the tick', () => {
    const r = renderer();
    const { d } = director(r.render);
    const w = world([creative('a')], { a: 5000 });
    w.company.products = [];
    expect(() => d.sync(w)).not.toThrow();
    expect(d.request(w, 'a').status).toBe('unavailable');
  });

  it('copies no talent and no truth into the spec', async () => {
    const r = renderer();
    const { d } = director(r.render);
    const w = world([creative('a')], { a: 5000 });
    (w.market as unknown as { niches: unknown }).niches = [{ id: 'n', demand: 0.91, videoTempo: 'fast' }];
    d.sync(w);
    await until(() => status(d, 'a') === 'ready');
    expect(readFileSync(join(r.jobs[0]!.dir, SPEC_FILE), 'utf8')).not.toMatch(/videoTempo|demand|talent/);
  });
});

describe('modes', () => {
  it('is off under vitest whatever the environment says, or `api.test.ts` would fork render workers', () => {
    expect(videoModeOf()).toBe('off');
    expect(videoModeOf({ VITEST: 'true', VIDEO_MODE: 'auto' })).toBe('off');
  });

  it('is `auto` on a server, and VIDEO_MODE moves it', () => {
    expect(videoModeOf({})).toBe('auto');
    expect(videoModeOf({ VIDEO_MODE: 'off' })).toBe('off');
    expect(videoModeOf({ VIDEO_MODE: ' OnDemand ' })).toBe('ondemand');
    expect(videoModeOf({ VIDEO_MODE: 'bientôt' })).toBe('auto');
  });

  it('caps the disk at 1 200 MB unless told otherwise', () => {
    expect(videoDiskCapOf({})).toBe(1200);
    expect(videoDiskCapOf({ VIDEO_MAX_DISK_MB: '300' })).toBe(300);
    expect(videoDiskCapOf({ VIDEO_MAX_DISK_MB: 'beaucoup' })).toBe(1200);
    expect(videoDiskCapOf({ VIDEO_MAX_DISK_MB: '-1' })).toBe(1200);
  });
});

describe('the API', () => {
  const VIDEO: CreativeVideo = { status: 'queued', reason: null, videos: [], poster: null, captions: null, cards: [], voice: null, qa: null };
  const INDEX: VideoIndex = { level: 'no_voice', reason: 'Sans voix sur cette machine', items: { cre_1: VIDEO } };

  async function served(over: Partial<SessionLike> = {}) {
    const asked: unknown[][] = [];
    const session = {
      info: () => ({ runId: 'r', playing: false, speed: 1, mindMode: 'heuristic' }),
      status: () => 'paused',
      snapshotJson: () => '{}',
      tickJson: () => '{"type":"tick"}',
      videoIndex: () => INDEX,
      requestVideo: async (id: string, ratio?: string) => { asked.push([id, ratio]); return VIDEO; },
      ...over,
    } as unknown as SessionLike;
    const app = createAgencyServer({ session, sse: { heartbeatMs: 60_000 } });
    await new Promise<void>((r) => app.server.listen(0, r));
    const base = `http://localhost:${(app.server.address() as AddressInfo).port}`;
    const post = (body: unknown) => fetch(`${base}/api/videos/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { app, base, asked, post };
  }

  it('GET /api/videos answers the index', async () => {
    const { app, base } = await served();
    const res = await fetch(`${base}/api/videos`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(INDEX);
    expect((await fetch(`${base}/api/videos`, { method: 'POST' })).status).toBe(405);
    await app.close();
  });

  it('GET /api/videos stays an answer on a session that renders nothing', async () => {
    const { app, base } = await served({ videoIndex: undefined, requestVideo: undefined });
    expect(await (await fetch(`${base}/api/videos`)).json()).toEqual({ level: 'storyboard_only', reason: null, items: {} });
    await app.close();
  });

  it('POST /api/videos/render gives the creative\'s state and passes the ratio on', async () => {
    const { app, asked, post } = await served();
    const res = await post({ creativeId: 'cre_1', ratio: '4:5' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VIDEO);
    await post({ creativeId: 'cre_2' });
    expect(asked).toEqual([['cre_1', '4:5'], ['cre_2', undefined]]);
    await app.close();
  });

  it('POST /api/videos/render refuses a bad body with a French message', async () => {
    const { app, asked, post } = await served();
    expect((await post({})).status).toBe(400);
    for (const ratio of ['text', '16:9', 9]) {
      const res = await post({ creativeId: 'cre_1', ratio });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain('ratio');
    }
    expect(asked).toEqual([]);
    await app.close();
  });

  it('the stream sends one `video` event on a status change', async () => {
    const { app, base } = await served();
    const res = await fetch(`${base}/api/stream`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const read = async () => { const { value } = await reader.read(); text += decoder.decode(value); };
    while (!text.includes('"snapshot"')) await read();
    app.hub.video('cre_1', { ...VIDEO, status: 'ready' });
    while (!text.includes('"video"')) await read();
    const frame = text.split('\n\n').find((f) => f.includes('"type":"video"'))!;
    expect(JSON.parse(frame.slice('data: '.length))).toEqual({ type: 'video', creativeId: 'cre_1', video: { ...VIDEO, status: 'ready' } });
    await reader.cancel();
    await app.close();
  });
});

describe('videos in the snapshots (D52)', () => {
  const VIDEO: CreativeVideo = { status: 'ready', reason: null, videos: [], poster: null, captions: null, cards: [], voice: null, qa: null };

  it('the stream keeps 30 at most, running campaigns first', () => {
    const ads = Array.from({ length: 50 }, (_, i) => creative(`c${i}`));
    const items = Object.fromEntries(ads.map((c) => [c.id, VIDEO]));
    const live = liveVideos(world(ads, {}, { campaigns: [campaign('cmp_1', ['c2', 'c3'])] }), items);
    expect(Object.keys(live)).toHaveLength(30);
    expect(live.c2).toBeDefined();
    expect(live.c3).toBeDefined();
    expect(live.c49).toBeDefined();
    expect(live.c10).toBeUndefined();
  });

  it('leaves out a creative the live snapshot drops: old, and in no running campaign', () => {
    const ads = Array.from({ length: 70 }, (_, i) => creative(`c${i}`));
    const live = liveVideos(world(ads, {}, { campaigns: [campaign('cmp_1', ['c1'], { status: 'ended' })] }), { c1: VIDEO, c69: VIDEO });
    expect(Object.keys(live)).toEqual(['c69']);
  });
});

describe.skipIf(!findFfmpeg() || !(await import('@napi-rs/canvas').then(() => true, () => false)))('the real worker', { timeout: 120_000 }, () => {
  const DESIGN = {
    palette: { bg: '#f4efe2', primary: '#2f6b46', secondary: '#a9c8a2', accent: '#e0683a', ink: '#23302a', soft: '#e7ecd9' },
    motif: 'leaf', coverLayout: 'split', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 7, family: 'maison',
  };
  // At normal priority: the suite fills every core, and a below-normal worker would starve behind it.
  const TEST_FORK = (timeoutMs?: number) => forkRender(['--import', 'tsx'], timeoutMs, osConstants.priority.PRIORITY_NORMAL);
  const beat = (kind: VideoCut['beats'][number]['kind'], scene: number, spoken: string, shots: number) => ({ kind, scene, spoken, screen: spoken, estSec: spoken.length / 20 + 0.2, shots });
  const CUT: VideoCut = {
    v: 1, tempo: 'standard', sfx: true, craft: 90,
    beats: [
      beat('hook', 0, 'Cinq erreurs tuent ton balcon avant la fin de la saison.', 2),
      beat('fact_card', 1, 'Le terreau d’un pot s’épuise vite, et personne ne le dit quand on débute.', 3),
      beat('fact_card', 2, 'Un arrosage du matin vaut trois arrosages du soir sur un balcon plein sud.', 3),
      beat('end_card', 3, 'Le guide complet est en lien dans ma bio.', 1),
    ],
    metrics: { estSec: 13, hookWordSec: 0, productSec: null, avgShotSec: 1.5, kinds: 3, captionWords: 3, endHoldSec: 1.2 },
  };

  it('forks, renders a file that passes QA, and the next mount reuses it', async () => {
    const ad = creative('a', { cut: CUT });
    const w = world([ad], { a: 5000 });
    (w.company.products[0] as unknown as { design: unknown }).design = DESIGN;
    const caps: VideoCaps = { ...CAPS, ffmpeg: findFfmpeg() };
    const { d, statuses } = director(TEST_FORK(), { caps, probe: undefined, width: 270 });
    d.sync(w);
    await until(() => ['ready', 'failed'].includes(status(d, 'a') ?? ''), 100_000);
    const video = d.index().items.a!;
    expect(video.reason).toBeNull();
    expect(statuses('a')).toEqual(['queued', 'rendering', 'ready']);
    expect(video.qa).toMatchObject({ ok: true, failed: [] });
    const master = video.videos[0]!;
    expect(master).toMatchObject({ ratio: '9:16' });
    expect(master.durationSec).toBeGreaterThan(9);
    expect(readFileSync(join(paths.root, master.path)).length).toBe(master.bytes);
    expect(readFileSync(join(paths.root, video.captions!), 'utf8').startsWith('WEBVTT\n')).toBe(true);
    expect(existsSync(join(paths.root, video.poster!))).toBe(true);
    expect(existsSync(join(paths.root, master.path.replace('master.mp4', 'mix.wav')))).toBe(false);
    await d.stop();

    rmSync(join(paths.root, 'video', 'manifest.json'));
    const next = director(() => { throw new Error('no render expected'); }, { caps, probe: undefined });
    next.d.sync(w);
    expect(status(next.d, 'a')).toBe('ready');
  });

  it('deletes what fails QA: a real 3 s cut under the 9 s floor leaves nothing to serve', async () => {
    const short: VideoCut = { ...CUT, beats: [CUT.beats[0]!, CUT.beats[3]!], metrics: { ...CUT.metrics, estSec: 5 } };
    const w = world([creative('a', { cut: short })], { a: 5000 });
    (w.company.products[0] as unknown as { design: unknown }).design = DESIGN;
    const real = TEST_FORK();
    let left: string[] = [];
    const render: RenderRunner = (job) => {
      const handle = real(job);
      return { ...handle, result: handle.result.then((answer) => { left = readdirSync(job.dir); return answer; }) };
    };
    const { d, changes } = director(render, { caps: { ...CAPS, ffmpeg: findFfmpeg() }, probe: undefined, width: 270 });
    d.sync(w);
    await until(() => ['ready', 'failed'].includes(status(d, 'a') ?? ''), 100_000);
    const video = d.index().items.a!;
    expect(video).toMatchObject({ status: 'failed', videos: [], poster: null, captions: null });
    expect(video.reason).toContain('duration');
    expect(video.qa?.failed).toContain('duration');
    expect(left).not.toContain('master.mp4'); // the worker deleted it: it never reached the director
    expect(left).not.toContain(RESULT_FILE);
    expect(changes.filter((c) => c.video.status === 'rendering')).toHaveLength(1); // a failed QA is not retried
    expect(existsSync(join(paths.root, 'video', 'a'))).toBe(true);
    expect(readdirSync(join(paths.root, 'video', 'a'))).toEqual([]);
  });

  it('captions are WebVTT: a cue per group, the text of a silent beat, nothing that breaks a cue', async () => {
    const { webVtt } = await import('../src/video/worker.js');
    const vtt = webVtt({
      total: 5,
      beats: [
        { t0: 0, dur: 2, screen: 'ignoré', groups: [[{ text: 'Cinq', at: 0, end: 0.4 }, { text: 'erreurs.', at: 0.4, end: 1 }], [{ text: 'a<b', at: 1, end: 1.5 }]] },
        { t0: 2, dur: 3, screen: ' Une carte ', groups: [] },
        { t0: 5, dur: 1, screen: '', groups: [] },
      ],
    } as never);
    expect(vtt).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nCinq erreurs.\n\n00:00:01.000 --> 00:00:01.500\na&lt;b\n\n00:00:02.000 --> 00:00:05.000\nUne carte\n');
  });

  it('a killed worker is a crash, not a hang', async () => {
    const dir = join(paths.root, 'job');
    mkdirSync(dir);
    writeFileSync(join(dir, SPEC_FILE), '{ not a spec');
    const render = TEST_FORK();
    const broken = await render({ dir, root: paths.root, ffmpeg: 'ffmpeg', pages: false }).result;
    expect(broken).toMatchObject({ ok: false, retry: true });
    expect(broken.reason).toContain('rendu');
    const handle = render({ dir, root: paths.root, ffmpeg: 'ffmpeg', pages: false });
    handle.cancel();
    expect(await handle.result).toMatchObject({ ok: false, retry: true });
    const late = await TEST_FORK(1)({ dir, root: paths.root, ffmpeg: 'ffmpeg', pages: false }).result;
    expect(late).toMatchObject({ ok: false, retry: true, reason: 'Rendu trop long : arrêté' });
  });
});
