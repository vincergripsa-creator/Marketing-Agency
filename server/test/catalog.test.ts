/**
 * The catalog of the agency and what the sweep hung on it: roles, hats, offices, who reviews what, the two teams a world can
 * start with. The golden test proves the legacy company did not move; this one proves the tables say what the plan decided.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentState, Alumnus, Office, RoleId, ScenarioConfig, Task, TaskKind, WorldState } from '../src/shared.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { nameOf } from '../src/runtime/ctx.js';
import { buildTeam, CANDIDATES, KIND_HATS, LEGACY_OFFICES, OFFICES, REVIEW_OFFICE, ROLES } from '../src/runtime/org/catalog.js';
import { isLegacyOrg, LEAN_ORG, LEGACY_ORG, ORG } from '../src/runtime/org/constants.js';
import { officerId, reviewerFor, roleHolders } from '../src/runtime/org/officers.js';
import { payOf } from '../src/runtime/org/payroll.js';
import { DEPARTMENTS, SEED_PLAYBOOKS } from '../src/runtime/roster.js';
import { ALL_KINDS, createTask, fixSelfReview, KIND_META, selfWord } from '../src/runtime/tasks.js';
import { LEGACY } from './legacy.js';

const V1_KINDS: TaskKind[] = [
  'headcount_review', 'recruit', 'league_review', 'open_channel', 'adapt_creative', 'write_search_ads', 'reconcile_channels', 'allocate_channels',
  'write_lead_magnet', 'write_email_sequence', 'send_broadcast', 'design_bump', 'portfolio_review',
];
const ROLE_IDS = Object.keys(ROLES) as RoleId[];
const OFFICE_IDS = Object.keys(OFFICES) as Office[];
const FOUNDERS = ['camille', 'nadia', 'elise', 'zoe', 'leo', 'clara', 'gabriel', 'nora'];
const LEGACY_IDS = [
  'camille', 'hugo', 'nadia', 'malo', 'yasmine', 'elise', 'theo', 'lina', 'samuel', 'zoe', 'kenji', 'maelle', 'leo', 'sarah', 'adam', 'chloe', 'tom',
  'clara', 'mehdi', 'paul', 'ines', 'lucas', 'fatou', 'raphael', 'emma', 'gabriel', 'alice', 'nora', 'axel', 'rayan', 'louise',
];

const kindsOf = (role: RoleId): TaskKind[] => [...ROLES[role].core, ...ROLES[role].assist];
const founderRoles = (): RoleId[] => buildTeam(LEAN_ORG).map((a) => a.roleId);
/** What a lean founder wears: no founding role holds the kind in core or assist. */
const hats = (): TaskKind[] => ALL_KINDS.filter((k) => !founderRoles().some((r) => kindsOf(r).includes(k)));

function legacyWorld(over: Partial<ScenarioConfig> = {}): WorldState {
  return createWorld(defaultScenario({ ...LEGACY, seed: 7, mindMode: 'heuristic', maxComputeEur: 0, ...over }), 'test-catalog');
}
function leanWorld(): WorldState {
  return legacyWorld({ org: LEAN_ORG });
}
const agent = (w: WorldState, id: string): AgentState => w.company.agents.find((a) => a.id === id)!;

function bareTask(over: Partial<Task>): Task {
  return { id: 'tsk_0', kind: 'write_pdf', dept: 'studio', assignee: null, reviewer: null, ...over } as Task;
}

describe('role catalog', () => {
  it('holds the 35 roles of the contract, each with a title, a department and known kinds', () => {
    expect(ROLE_IDS).toHaveLength(35);
    const departments = new Set(DEPARTMENTS.map((d) => d.id));
    for (const id of ROLE_IDS) {
      const r = ROLES[id];
      expect(r.title, id).toBeTruthy();
      expect(departments.has(r.dept), id).toBe(true);
      expect(r.seats, id).toBeGreaterThan(0);
      expect(r.core.length, `${id} needs a core: a role with none can never be hired`).toBeGreaterThan(0);
      for (const k of kindsOf(id)) expect(KIND_META[k], `${id}: ${k}`).toBeDefined();
      expect(new Set(kindsOf(id)).size, id).toBe(kindsOf(id).length);
    }
  });

  it('applies D3 and D4 where org §4 predates them', () => {
    expect(ROLES).not.toHaveProperty('media_buyer_youtube');
    expect(ROLES.media_buyer_google.channel).toBe('google');
    expect(ROLES.media_buyer_pinterest.channel).toBe('pinterest');
    expect(ROLES.media_buyer_meta.channel).toBe('meta');
    expect(ROLES.media_buyer_tiktok.channel).toBe('tiktok');
    expect(ROLES.motion_designer).toMatchObject({ core: ['adapt_creative'], assist: ['produce_ad'] });
    expect(ROLES.video_editor.assist).toEqual(['adapt_creative']);
    expect(ROLES.email_marketer.core).toEqual(['write_email_sequence', 'send_broadcast', 'write_lead_magnet']);
    expect(ROLES.pricing_manager.core).toContain('design_bump');
    expect(ROLES.hook_writer.core).toContain('write_search_ads');
    expect(ROLES.data_analyst.core).toContain('reconcile_channels');
    expect(ROLES.ceo.core).toContain('portfolio_review');
    expect(ROLES.growth_lead.core).toContain('open_channel');
    expect(ROLES.cfo.core).toContain('allocate_channels');
    expect(ROLES.hr_lead.core).toContain('league_review');
  });

  it('marks as lead the eight founding roles plus support and partnerships', () => {
    expect(ROLE_IDS.filter((r) => ROLES[r].lead).sort()).toEqual([...founderRoles(), 'support_lead', 'partnerships_lead'].sort());
  });

  it('keeps every kind in a home: each of the 47 has a role, and video and crm have kinds of their own (D5)', () => {
    expect(ALL_KINDS).toHaveLength(47);
    for (const k of ALL_KINDS) expect(ROLE_IDS.some((r) => kindsOf(r).includes(k)), k).toBe(true);
    expect(ROLE_IDS.filter((r) => ROLES[r].dept === 'video').flatMap((r) => ROLES[r].core)).toContain('adapt_creative');
    expect(ROLE_IDS.filter((r) => ROLES[r].dept === 'crm').flatMap((r) => ROLES[r].core)).toEqual(expect.arrayContaining(['post_organic', 'send_broadcast']));
  });
});

describe('hats', () => {
  it('lists every TaskKind, in KIND_META order or not, and names a founding role first', () => {
    expect(Object.keys(KIND_HATS).sort()).toEqual([...ALL_KINDS].sort());
    for (const k of ALL_KINDS) {
      expect(KIND_HATS[k].length, k).toBeGreaterThan(0);
      expect(founderRoles(), k).toContain(KIND_HATS[k][0]);
      for (const r of KIND_HATS[k]) expect(ROLES[r], `${k}: ${r}`).toBeDefined();
    }
  });

  it('leaves the founders wearing 24 of the 47 kinds (D2)', () => {
    expect(hats()).toHaveLength(24);
    expect(hats().sort()).toEqual([
      'adapt_creative', 'daily_report', 'design_bump', 'design_upsell', 'fact_check', 'find_creators', 'follow_missions', 'handle_refund',
      'humanize_pdf', 'negotiate_deal', 'post_organic', 'produce_ad', 'reconcile_channels', 'reconcile_ledger', 'red_team', 'reply_inbox', 'run_experiment',
      'scan_competitors', 'send_broadcast', 'set_price', 'weekly_pnl', 'write_email_sequence', 'write_lead_magnet', 'write_search_ads',
    ]);
  });

  it('gives each founder the hats of the founding team table, plus D4', () => {
    const wornBy = (role: RoleId) => hats().filter((k) => KIND_HATS[k][0] === role).sort();
    expect(wornBy('ceo')).toEqual(['follow_missions']);
    expect(wornBy('research_lead')).toEqual(['find_creators', 'negotiate_deal', 'scan_competitors']);
    expect(wornBy('editor_in_chief')).toEqual(['humanize_pdf', 'write_lead_magnet']);
    expect(wornBy('art_director')).toEqual(['adapt_creative', 'produce_ad']);
    expect(wornBy('growth_lead')).toEqual(['post_organic', 'write_search_ads']);
    expect(wornBy('shop_lead')).toEqual(['design_bump', 'design_upsell', 'handle_refund', 'reply_inbox', 'send_broadcast', 'set_price', 'write_email_sequence']);
    expect(wornBy('cfo')).toEqual(['daily_report', 'reconcile_channels', 'reconcile_ledger', 'run_experiment', 'weekly_pnl']);
    expect(wornBy('hr_lead')).toEqual(['fact_check', 'red_team']);
  });

  it('lists a kind a founder holds in core under that founder: the other six of D4', () => {
    expect(KIND_HATS.headcount_review).toEqual(['hr_lead']);
    expect(KIND_HATS.recruit).toEqual(['hr_lead']);
    expect(KIND_HATS.league_review).toEqual(['hr_lead']);
    expect(KIND_HATS.open_channel).toEqual(['growth_lead']);
    expect(KIND_HATS.allocate_channels).toEqual(['cfo']);
    expect(KIND_HATS.portfolio_review).toEqual(['ceo']);
  });
});

describe('founding team', () => {
  it('is the eight founders, in the order of the 31, and costs 7,60 € a day', () => {
    const team = buildTeam(LEAN_ORG);
    expect(team.map((a) => a.id)).toEqual(FOUNDERS);
    const pay = team.reduce((sum, a) => sum + payOf({ ...a, level: 1 } as AgentState), 0);
    expect(Math.round(pay * 100) / 100).toBe(7.6);
    const byRole = team.reduce((sum, a) => sum + ORG.payPerDay[ROLES[a.roleId].tier], 0);
    expect(Math.round(byRole * 100) / 100).toBe(7.6);
  });

  it('gives founders the kinds of their role, V1 kinds included, each in the only seat of that role', () => {
    for (const a of buildTeam(LEAN_ORG)) {
      expect(a.taskKinds, a.id).toEqual(kindsOf(a.roleId));
      expect(a.founder).toBe(true);
      expect(a.isChief).toBe(true);
      expect(a.dept).toBe(ROLES[a.roleId].dept);
      expect(ROLES[a.roleId].seats).toBe(1);
    }
  });

  it('opens 8 departments, leaves 5 closed and seeds each founder with the rules of their department', () => {
    const w = leanWorld();
    expect(w.company.agents.map((a) => a.id)).toEqual(FOUNDERS);
    expect(w.company.departments.map((d) => d.id)).toEqual(['direction', 'recherche', 'studio', 'creation', 'growth', 'boutique', 'finance', 'rh']);
    expect(w.company.org!.closedDepts.map((d) => d.id).sort()).toEqual(['analyse', 'crm', 'partenariats', 'support', 'video']);
    for (const d of w.company.departments) expect(agent(w, d.chiefId).dept, d.id).toBe(d.id);
    for (const a of w.company.agents) expect(w.company.playbooks[a.id]).toEqual(expect.arrayContaining(SEED_PLAYBOOKS[a.dept]));
  });
});

describe('legacy team', () => {
  it('keeps its 31 people, in their order, and each on the department they always had', () => {
    const team = buildTeam(LEGACY_ORG);
    expect(team.map((a) => a.id)).toEqual(LEGACY_IDS);
    expect(team.find((a) => a.id === 'chloe')!.dept).toBe('growth');
    expect(team.find((a) => a.id === 'tom')!.dept).toBe('growth');
    expect(new Set(team.map((a) => a.dept)).size).toBe(11);
    for (const a of team) expect(a).not.toHaveProperty('legacyDept');
  });

  it('stands Chloé and Tom in their new departments in the catalog, with their old shirts', () => {
    expect(CANDIDATES.chloe).toMatchObject({ dept: 'video', legacyDept: 'growth', roleId: 'video_editor' });
    expect(CANDIDATES.tom).toMatchObject({ dept: 'crm', legacyDept: 'growth', roleId: 'community_manager' });
    expect(CANDIDATES.tom!.avatar.shirt).toBe(DEPARTMENTS.find((d) => d.id === 'growth')!.color);
    expect(Object.values(CANDIDATES).filter((c) => c.legacyDept).map((c) => c.id)).toEqual(['chloe', 'tom']);
  });

  it('finds every candidate in the department and at the tier of their role', () => {
    for (const c of Object.values(CANDIDATES)) {
      expect(ROLES[c.roleId].dept, c.id).toBe(c.dept);
      expect(ROLES[c.roleId].tier, c.id).toBe(c.tier);
    }
  });

  it('reads the kinds of its roles in today\'s order, V1 kinds aside, so ties in routing do not move', () => {
    for (const a of buildTeam(LEGACY_ORG)) expect(kindsOf(a.roleId).filter((k) => !V1_KINDS.includes(k)), a.id).toEqual(a.taskKinds);
    for (const a of buildTeam(LEGACY_ORG)) for (const k of V1_KINDS) expect(a.taskKinds, a.id).not.toContain(k);
  });

  it('gets a copy: a world cannot write into the catalog', () => {
    const team = buildTeam(LEGACY_ORG);
    team[0]!.name = 'Personne';
    team.pop();
    expect(CANDIDATES[team[0]!.id]!.name).toBe('Camille');
    expect(buildTeam(LEGACY_ORG)).toHaveLength(31);
  });
});

describe('departments', () => {
  it('counts 13 in the catalog, video and crm on their cells of ui §2.4 (D36), and no two share a cell or a colour', () => {
    expect(DEPARTMENTS).toHaveLength(13);
    expect(DEPARTMENTS.find((d) => d.id === 'video')).toMatchObject({ name: 'Studio Vidéo', grid: { col: 0, row: -2 } });
    expect(DEPARTMENTS.find((d) => d.id === 'crm')).toMatchObject({ name: 'Communauté & Email', grid: { col: 2, row: 0 } });
    expect(new Set(DEPARTMENTS.map((d) => `${d.grid.col},${d.grid.row}`)).size).toBe(13);
    expect(new Set(DEPARTMENTS.map((d) => d.color)).size).toBe(13);
  });

  it('names a candidate of the department as chief of each', () => {
    for (const d of DEPARTMENTS) expect(CANDIDATES[d.chiefId]!.dept, d.id).toBe(d.id);
  });
});

describe('createWorld', () => {
  it('fills company.org: legacy offices, video and crm closed, 11 departments open', () => {
    const w = legacyWorld();
    expect(w.company.agents.map((a) => a.id)).toEqual(LEGACY_IDS);
    expect(w.company.departments).toHaveLength(11);
    expect(w.company.departments.map((d) => d.id)).not.toContain('video');
    expect(w.company.org).toMatchObject({ offices: LEGACY_OFFICES, deptHost: {}, positions: [], alumni: [] });
    expect(w.company.org!.closedDepts.map((d) => d.id)).toEqual(['video', 'crm']);
  });

  it('reads an absent scenario.org as the legacy team (§2.8)', () => {
    const w = legacyWorld();
    expect(isLegacyOrg(w)).toBe(true);
    delete w.scenario.org;
    expect(isLegacyOrg(w)).toBe(true);
    expect(isLegacyOrg(leanWorld())).toBe(false);
  });

  it('does not share a world with the next one', () => {
    const a = legacyWorld();
    a.company.org!.closedDepts[0]!.grid.col = 99;
    a.company.departments[0]!.grid.col = 99;
    agent(a, 'camille').taskKinds.push('retro');
    const b = legacyWorld();
    expect(b.company.org!.closedDepts[0]!.grid.col).toBe(0);
    expect(b.company.departments[0]!.grid.col).toBe(0);
    expect(agent(b, 'camille').taskKinds).not.toContain('retro');
  });
});

describe('offices', () => {
  it('have one role and one kind that exist, and the legacy holders hold them', () => {
    expect(OFFICE_IDS).toHaveLength(16);
    expect(Object.keys(LEGACY_OFFICES).sort()).toEqual([...OFFICE_IDS].sort());
    const w = legacyWorld();
    for (const o of OFFICE_IDS) {
      const { roles, kind } = OFFICES[o];
      expect(KIND_META[kind], o).toBeDefined();
      expect(roles.some((r) => roleHolders(w, r).some((a) => a.id === LEGACY_OFFICES[o])), o).toBe(true);
      expect(roleHolders(w, roles[0]!).map((a) => a.id), o).toContain(LEGACY_OFFICES[o]);
    }
  });
});

describe('review routing', () => {
  it('sends each kind to the desk that always read it', () => {
    const w = legacyWorld();
    const today: [TaskKind, string][] = [
      ['write_pdf', 'samuel'], ['render_pdf', 'samuel'], ['fact_check', 'elise'], ['design_cover', 'zoe'], ['red_team', 'camille'],
      ['produce_ad', 'leo'], ['write_sales_page', 'clara'], ['publish_product', 'camille'], ['weekly_pnl', 'gabriel'],
    ];
    for (const [kind, reviewer] of today) expect(reviewerFor(w, kind), kind).toBe(reviewer);
    expect(reviewerFor(w, 'retro')).toBeNull();
    expect(createTask(w, { kind: 'write_pdf' }).reviewer).toBe('samuel');
    expect(createTask(w, { kind: 'write_pdf', reviewer: null }).reviewer).toBeNull();
  });

  it('adds the channel creatives to the growth review (channels §7.5)', () => {
    expect(REVIEW_OFFICE.adapt_creative).toBe('growth');
    expect(REVIEW_OFFICE.write_search_ads).toBe('growth');
  });

  it('takes the least loaded holder of the first role, ties by id', () => {
    const w = legacyWorld();
    const twin: AgentState = { ...agent(w, 'samuel'), id: 'aline', name: 'Aline' };
    w.company.agents.push(twin);
    expect(reviewerFor(w, 'write_pdf')).toBe('aline');
    createTask(w, { kind: 'humanize_pdf', assignee: 'aline' });
    expect(reviewerFor(w, 'write_pdf')).toBe('samuel');
    createTask(w, { kind: 'humanize_pdf', assignee: 'samuel' });
    expect(reviewerFor(w, 'write_pdf')).toBe('aline');
  });

  it('falls back on the office holder when nobody holds the role: a lean team has no fact-checker', () => {
    const w = leanWorld();
    w.company.org!.offices.fact_checker = 'nora';
    expect(roleHolders(w, 'fact_checker')).toHaveLength(0);
    expect(reviewerFor(w, 'write_pdf')).toBe('nora');
  });

  it('follows the office, not the name', () => {
    const w = legacyWorld();
    agent(w, 'camille').roleId = 'chief_of_staff';
    agent(w, 'hugo').roleId = 'ceo';
    w.company.org!.offices.ceo = 'hugo';
    expect(reviewerFor(w, 'publish_product')).toBe('hugo');
  });
});

describe('fixSelfReview', () => {
  const selfReviewed = (w: WorldState, assignee: string, dept: Task['dept']): string | null => {
    const task = bareTask({ assignee, reviewer: assignee, dept });
    fixSelfReview(w, task);
    return task.reviewer;
  };

  it('walks chief, CEO, chief of staff, as it always did on the legacy team', () => {
    const w = legacyWorld();
    expect(selfReviewed(w, 'samuel', 'studio')).toBe('elise');
    expect(selfReviewed(w, 'elise', 'studio')).toBe('camille');
    expect(selfReviewed(w, 'camille', 'direction')).toBe('hugo');
  });

  it('never leaves a task reviewed by its author on a lean team, where the chief of staff is the CEO', () => {
    const w = leanWorld();
    w.company.org!.offices.chief_of_staff = 'camille';
    expect(selfReviewed(w, 'camille', 'direction')).toBe('nora');
    w.company.org!.offices.hr = 'camille';
    expect(selfReviewed(w, 'camille', 'direction')).toBe('gabriel');
  });

  it('leaves a reviewer who is someone else alone', () => {
    const task = bareTask({ assignee: 'theo', reviewer: 'samuel' });
    fixSelfReview(legacyWorld(), task);
    expect(task.reviewer).toBe('samuel');
  });
});

describe('the words follow the person', () => {
  it('reads gender from the agent, not from a list of first names', () => {
    const w = legacyWorld();
    expect(selfWord(agent(w, 'camille'))).toBe('elle-même');
    expect(selfWord(agent(w, 'leo'))).toBe('lui-même');
    expect(selfWord({ ...agent(w, 'leo'), id: 'yanis', gender: 'f' })).toBe('elle-même');
    expect(selfWord({ ...agent(w, 'camille'), id: 'camille', gender: 'm' })).toBe('lui-même');
  });

  it('keeps the name of someone who left in nameOf (org §10)', () => {
    const w = legacyWorld();
    const ctx = { world: w } as unknown as RuntimeCtx;
    expect(nameOf(ctx, 'parti')).toBe('Quelqu’un');
    w.company.org!.alumni.push({ id: 'parti', name: 'Yanis' } as Alumnus);
    expect(nameOf(ctx, 'parti')).toBe('Yanis');
    expect(nameOf(ctx, 'camille')).toBe('Camille');
  });

  it('speaks through the office in the stand-up of a world whose CEO is someone else', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-catalog-'));
    try {
      const w = legacyWorld();
      agent(w, 'camille').name = 'Margaux';
      const paths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
      const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 });
      const brain = createBrainVault(paths);
      await brain.init();
      const company = new Company(w, { paths, engine, brain });
      await company.step();
      const standUp = w.activity.find((a) => a.kind === 'meeting' && a.text.startsWith('Stand-up'))!;
      expect(standUp.text).toContain('autour de Margaux');
      expect(w.activity.map((a) => a.text).join('\n')).not.toContain('Camille');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('the constructor loop (D56)', () => {
  function mount(w: WorldState, root: string): Company {
    const paths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    return new Company(w, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 }), brain: createBrainVault(paths) });
  }

  it('still teaches a legacy save the kinds added since', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-catalog-'));
    try {
      const w = legacyWorld();
      agent(w, 'hugo').taskKinds = ['follow_missions'];
      mount(w, root);
      expect(agent(w, 'hugo').taskKinds).toEqual(CANDIDATES.hugo!.taskKinds);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves a lean team\'s kinds where they are: it neither gives one back nor reorders them at a reload', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-catalog-'));
    try {
      const w = leanWorld();
      const before = kindsOf('ceo');
      mount(w, root);
      expect(agent(w, 'camille').taskKinds.slice(0, before.length)).toEqual(before);
      expect(CANDIDATES.camille!.taskKinds).toEqual(['plan_day', 'pick_opportunity']); // the order the loop would have put back
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('officers on a hand-built world', () => {
  it('routes a review through the legacy holders when there is no company.org', () => {
    const w = legacyWorld();
    delete w.company.org;
    expect(officerId(w, 'fact_checker')).toBe('samuel');
    expect(createTask(w, { kind: 'write_pdf' }).reviewer).toBe('samuel');
    const task = bareTask({ assignee: 'camille', reviewer: 'camille', dept: 'direction' });
    fixSelfReview(w, task);
    expect(task.reviewer).toBe('hugo');
  });
});
