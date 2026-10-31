/**
 * The sweep's guard: the code names offices, never people. A person can leave, an office stays filled, so a literal id
 * or a first name in a French line outlives the agent it meant. People are defined in the catalog and the roster, nowhere
 * else. `sim/catalog/knowledge/` stays out: its case studies are full of customers called Camille, Tom or Sarah.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DayPlan } from '../src/contracts.js';
import type { AgentId, Office, Product, WorldState } from '../src/shared.js';
import { retroAgent } from '../src/learning/data.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { createWorld, defaultScenario } from '../src/runtime/index.js';
import { unblockStaleTasks } from '../src/runtime/missions.js';
import { CANDIDATES } from '../src/runtime/org/catalog.js';
import { officerId } from '../src/runtime/org/officers.js';
import { legacyOrgState } from '../src/runtime/org/reconcile.js';
import { shelveProduct } from '../src/runtime/pipeline.js';
import { describePlan } from '../src/runtime/strategy.js';
import { chiefOf, createTask } from '../src/runtime/tasks.js';
import { LEGACY } from './legacy.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const WHERE_PEOPLE_ARE_DEFINED = ['runtime/org/catalog.ts', 'runtime/roster.ts'];

const unaccented = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '');
const ids = Object.keys(CANDIDATES);
const names = [...new Set(Object.values(CANDIDATES).flatMap((a) => [a.name, unaccented(a.name)]))];
const QUOTED_ID = new RegExp(`['"\`](?:${ids.join('|')})['"\`]`);
const FIRST_NAME = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names.join('|')})(?![\\p{L}\\p{N}_])`, 'u');

/** Comments out, strings kept: a `//` behind a colon is a URL, behind a quote or a backslash a string or a regex. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:'"`\\])\/\/.*$/gm, '');
}

function sources(): { path: string; code: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((f) => f.split(sep).join('/'))
    .filter((f) => f.endsWith('.ts') && !f.startsWith('sim/catalog/knowledge/') && !WHERE_PEOPLE_ARE_DEFINED.includes(f))
    .map((path) => ({ path, code: withoutComments(readFileSync(`${SRC}${path}`, 'utf8')) }));
}

/** `path: the line`, one per match, so a failure reads like the grep it is. */
function grep(files: { path: string; code: string }[], rx: RegExp): string[] {
  return files.flatMap(({ path, code }) => code.split('\n').filter((l) => rx.test(l)).map((l) => `${path}: ${l.trim().slice(0, 120)}`));
}

const planted = (code: string): { path: string; code: string }[] => [{ path: 'x.ts', code: withoutComments(code) }];

describe('no literal people in the code', () => {
  it('sees what it hunts: a planted id, a planted name, and no comment, word or URL host', () => {
    expect(ids).toContain('camille');
    expect(names).toEqual(expect.arrayContaining(['Élise', 'Elise', 'Léo', 'Leo']));
    expect(grep(planted(`say(ctx, 'camille', 'x');`), QUOTED_ID)).toHaveLength(1);
    expect(grep(planted('emit(w, { agentId: "leo" });'), QUOTED_ID)).toHaveLength(1);
    expect(grep(planted('const a = `Élise lance la v${n}`;'), FIRST_NAME)).toHaveLength(1);
    expect(grep(planted(`const b = "Chloé produit";`), FIRST_NAME)).toHaveLength(1);
    const comments = `// Camille, 'camille'\n/** Nora and 'nora'\n * Tom */\nconst c = 1; // Léo`;
    expect(grep(planted(comments), QUOTED_ID)).toEqual([]);
    expect(grep(planted(comments), FIRST_NAME)).toEqual([]);
    expect(grep(planted(`const d = 'Tomate, Adamant, tom-tom, https://exemple.fr';`), FIRST_NAME)).toEqual([]);
    expect(grep(planted(`const e = 'https://exemple.fr/Paul';`), FIRST_NAME)).toHaveLength(1);
  });

  it('reads the tree, not an empty list', () => {
    const files = sources().map((f) => f.path);
    expect(files.length).toBeGreaterThan(80);
    expect(files).toEqual(expect.arrayContaining(['runtime/strategy.ts', 'learning/data.ts', 'sim/tick.ts', 'api/session.ts']));
    expect(files.filter((f) => WHERE_PEOPLE_ARE_DEFINED.includes(f) || f.includes('/knowledge/'))).toEqual([]);
  });

  it('quotes no agent id in server/src, outside the catalog and the roster', () => {
    expect(grep(sources(), QUOTED_ID)).toEqual([]);
  });

  it('writes no first name in a string of runtime/ or learning/, outside the catalog and the roster', () => {
    expect(grep(sources().filter((f) => /^(runtime|learning)\//.test(f.path)), FIRST_NAME)).toEqual([]);
  });
});

describe('a swept line follows the office, not the person', () => {
  const legacyWorld = (): WorldState => createWorld(defaultScenario({ ...LEGACY, seed: 1 }), 'noliterals');
  const held = (office: Office, id: AgentId): WorldState => {
    const world = legacyWorld();
    const org = legacyOrgState(world);
    world.company.org = { ...org, offices: { ...org.offices, [office]: id } };
    return world;
  };
  const ctxOf = (world: WorldState): RuntimeCtx => ({ world, incidents: [] }) as unknown as RuntimeCtx;

  it('signs the retro with the holder of the HR office, then the RH chief', () => {
    const world = held('hr', 'hugo');
    expect(retroAgent(world)?.id).toBe('hugo');
    delete world.company.org;
    expect(retroAgent(world)?.id).toBe('nora');
  });

  it('opens the day and stops a product in the name of today\'s CEO', () => {
    const ctx = ctxOf(held('ceo', 'hugo'));
    expect(describePlan(ctx, { focus: 'Le cap' } as DayPlan)).toBe('Hugo : Le cap');
    const product = { id: 'prd_1', nicheId: 'niche', title: 'Guide', status: 'writing' } as Product;
    ctx.world.company.products.push(product);
    shelveProduct(ctx, product, 'test');
    const said = ctx.world.activity[ctx.world.activity.length - 1]!;
    expect(said.agentId).toBe('hugo');
    expect(said.text).toMatch(/^Hugo met « Guide » de côté/);
  });

  it('hands an orphan review to the next of the walk, never back to its author', () => {
    const world = legacyWorld();
    world.day = 30;
    const author = chiefOf(world, 'direction')!;
    const t = createTask(world, { kind: 'plan_day', assignee: author.id, reviewer: 'parti' });
    t.status = 'review';
    t.dayCreated = 1;
    const lines = unblockStaleTasks(ctxOf(world), world.company.agents.find((a) => a.id !== author.id)!);
    expect(t.reviewer).toBe(officerId(world, 'chief_of_staff'));
    expect(lines.join(' ')).toContain('Hugo s\'en charge');
  });
});
