/**
 * The golden run and the contract around it: the legacy company still does, to the cent and to the task, what it did
 * before V1 touched the tree. Re-recording is D43's alone: a mismatch anywhere else is a bug, not a new reference.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { WorldState } from '../src/shared.js';
import { acceptance, CHANNEL_IDS, CHANNELS, channelOf, PIER_CELL, SAFE_ZONES, tierFor } from '../src/shared.js';
import { buildTeam } from '../src/runtime/org/catalog.js';
import { LEGACY_ORG } from '../src/runtime/org/constants.js';
import { FIXTURE_FILE, GOLDEN, goldenRecord, goldenRun, recordedGolden } from '../scripts/golden.js';

const AGENTS = buildTeam(LEGACY_ORG);

describe('golden run', () => {
  let world: WorldState;
  const twin = (): WorldState => JSON.parse(JSON.stringify(world)) as WorldState;

  beforeAll(async () => {
    world = await goldenRun();
  }, 120_000);

  it('hashes to the recorded value: ledger, KPIs, tasks and events have not moved', () => {
    expect(goldenRecord(world)).toEqual(recordedGolden());
  });

  it('sees one cent, one task and one event, and neither a clock nor a word', () => {
    const base = goldenRecord(world);
    const cent = twin();
    cent.ledger[cent.ledger.length - 1]!.amount += 0.01;
    expect(goldenRecord(cent).parts.ledger).not.toBe(base.parts.ledger);
    const task = twin();
    task.company.tasks[0]!.assignee = 'personne';
    expect(goldenRecord(task).parts.tasks).not.toBe(base.parts.tasks);
    const event = twin();
    event.market.events[0]!.day += 1;
    expect(goldenRecord(event).parts.events).not.toBe(base.parts.events);
    const words = twin();
    words.createdAt = '2000-01-01T00:00:00.000Z';
    words.ledger[0]!.memo = 'autre libellé';
    words.company.tasks[0]!.title = 'autre titre';
    words.market.events[0]!.description = 'autre texte';
    expect(goldenRecord(words)).toEqual(base);
  });
});

describe('old-save fixture', () => {
  it('is a version 1 world of the legacy company, closed on day 20, from before the contract', () => {
    const w = JSON.parse(gunzipSync(readFileSync(FIXTURE_FILE)).toString('utf8')) as WorldState;
    expect(w.version).toBe(1);
    expect([w.day, w.tick]).toEqual([GOLDEN.fixtureDay + 1, 0]);
    expect(w.company.agents).toHaveLength(31);
    expect(w.company.agents[0]).not.toHaveProperty('roleId');
    expect(w.company.kpis.at(-1)!.day).toBe(GOLDEN.fixtureDay);
  });
});

describe('shared contract', () => {
  it('fills every required agent member from the roster: 8 founders, each with a role', () => {
    expect(AGENTS.filter((a) => a.founder).map((a) => a.id)).toEqual(['camille', 'nadia', 'elise', 'zoe', 'leo', 'clara', 'gabriel', 'nora']);
    expect(AGENTS.filter((a) => a.gender === 'f')).toHaveLength(16);
    for (const a of AGENTS) expect(a.roleId, a.id).toBeTruthy();
    expect(new Set(AGENTS.map((a) => a.roleId)).size).toBe(30); // Lucas and Fatou share support_agent
  });

  it('channels follow channels §2.1, with the founder\'s word for Meta (D59)', () => {
    expect(CHANNEL_IDS).toEqual(Object.keys(CHANNELS));
    expect(CHANNELS.meta.label).toBe('Facebook & Instagram');
    expect(CHANNEL_IDS.map((c) => CHANNELS[c].minDailyBudget)).toEqual([5, 12, 8, 6, 6]);
    expect(CHANNEL_IDS.map((c) => CHANNELS[c].stopLossSpend)).toEqual([25, 45, 30, 30, 25]);
    expect(CHANNEL_IDS.map((c) => CHANNELS[c].testDays)).toEqual([3, 5, 3, 4, 3]);
    expect(CHANNEL_IDS.map((c) => CHANNELS[c].verificationDays)).toEqual([0, 3, 1, 1, 2]);
    expect(CHANNEL_IDS.map((c) => CHANNELS[c].learning?.events ?? 0)).toEqual([0, 12, 0, 6, 8]);
    expect(CHANNELS.youtube.account).toBe(CHANNELS.google.account);
    expect(channelOf({})).toBe('tiktok');
  });

  it('acceptance reads the table: an absent ratio is 9:16, a refusal is null', () => {
    expect(acceptance('tiktok', { format: 'carousel' })).toBe(1);
    expect(acceptance('tiktok', { format: 'static_image', ratio: '4:5' })).toBeNull();
    expect(acceptance('meta', { format: 'static_image', ratio: '1:1' })).toBe(0.95);
    expect(acceptance('meta', { format: 'ugc_avatar' })).toBe(0.85);
    expect(acceptance('youtube', { format: 'carousel' })).toBeNull();
    expect(acceptance('pinterest', { format: 'carousel', ratio: '2:3' })).toBe(0.9);
    expect(acceptance('pinterest', { format: 'faceless_voiceover' })).toBe(0.7);
    expect(acceptance('google', { format: 'search_text', ratio: 'text' })).toBe(1);
    expect(acceptance('google', { format: 'faceless_voiceover' })).toBeNull();
  });

  it('world grid and safe zones are the specs\' numbers', () => {
    expect(PIER_CELL).toEqual({ col: 0, row: 1 });
    expect([tierFor(6).size, tierFor(7).size, tierFor(21).size, tierFor(40).size]).toEqual([9, 10, 12, 14]);
    expect(SAFE_ZONES.shorts.insets).toEqual({ top: 288, right: 192, bottom: 672, left: 60 });
  });
});
