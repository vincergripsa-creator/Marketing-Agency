/**
 * The lean company (org §6, §7, §8): the eight founders and their hats, the org that derives itself from who is alive,
 * routing, the guard kinds, what work costs. Numbers are org §12's. Hires and departures here are fakes on the frozen
 * shape of the world: `hireAgent` and `completeDeparture` are P2.3's and P2.4's, and end in the same reconcileOrg.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentId, AgentState, Campaign, Difficulty, Mission, Order, Product, RoleId, ScenarioConfig, Task, TaskKind, WorldState } from '../src/shared.js';
import type { RunPaths } from '../src/contracts.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { activeCampaigns } from '../src/runtime/metrics.js';
import { KIND_HATS, REVIEW_OFFICE, ROLES } from '../src/runtime/org/catalog.js';
import { LEAN_ORG, ORG } from '../src/runtime/org/constants.js';
import { officerId } from '../src/runtime/org/officers.js';
import { payOf } from '../src/runtime/org/payroll.js';
import { auditOrg, deptFor, fitOf, lastResortHats, reconcileOrg, salaryBroken, speedFor, workFor } from '../src/runtime/org/reconcile.js';
import { ALL_KINDS, assignReady, capableAgents, chiefOf, createTask, isGuardKind, KIND_META, taskChannel } from '../src/runtime/tasks.js';
import { LEGACY } from './legacy.js';

const FOUNDERS = ['camille', 'nadia', 'elise', 'zoe', 'leo', 'clara', 'gabriel', 'nora'];
const FOUNDING_HATS: Record<AgentId, TaskKind[]> = {
  camille: ['follow_missions'],
  nadia: ['scan_competitors', 'find_creators', 'negotiate_deal'],
  elise: ['humanize_pdf', 'write_lead_magnet'],
  zoe: ['produce_ad', 'adapt_creative'],
  leo: ['post_organic', 'write_search_ads'],
  clara: ['set_price', 'design_upsell', 'reply_inbox', 'handle_refund', 'write_email_sequence', 'send_broadcast', 'design_bump'],
  gabriel: ['daily_report', 'run_experiment', 'reconcile_ledger', 'weekly_pnl', 'reconcile_channels'],
  nora: ['red_team', 'fact_check'],
};

const roots: string[] = [];

function mount(world: WorldState): Company {
  const root = mkdtempSync(join(tmpdir(), 'pixel-org-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  return new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain: createBrainVault(paths) });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

/** The team and nothing else moving: no hires, nobody paid. */
function leanWorld(seed = 7, over: Partial<ScenarioConfig> = {}): WorldState {
  return createWorld(defaultScenario({ seed, mindMode: 'heuristic', maxComputeEur: 0, org: { team: 'lean', autoHire: false, payroll: false }, ...over }), `test-org-${seed}`);
}
const legacyWorld = (): WorldState => createWorld(defaultScenario({ ...LEGACY, seed: 7, mindMode: 'heuristic', maxComputeEur: 0 }), 'test-org-legacy');

const agent = (w: WorldState, id: AgentId): AgentState => w.company.agents.find((a) => a.id === id)!;
const openIds = (w: WorldState): string[] => w.company.departments.map((d) => d.id);

/** A fake hire: the member enters the world, reconcileOrg does the rest. */
function hire(w: WorldState, id: AgentId, role: RoleId, over: Partial<AgentState> = {}): AgentState {
  const r = ROLES[role];
  const a: AgentState = {
    ...structuredClone(w.company.agents[0]!), id, name: id[0]!.toUpperCase() + id.slice(1), role: r.title, roleId: role, dept: r.dept, tier: r.tier, founder: false, isChief: false,
    place: r.dept, status: 'idle', currentTaskId: null, energy: 100, level: 1, xp: 0, hatKinds: [], hatDepts: [], taskKinds: [], hiredDay: w.day, rampUntilDay: 0, notice: null,
    perf: { done: 0, approved: 0, rejected: 0, failed: 0, score: 50 }, ...over,
  };
  w.company.agents.push(a);
  w.company.playbooks[id] = [];
  reconcileOrg(w);
  return agent(w, id);
}

/** A fake departure: the leaver goes to the alumni, reconcileOrg does the rest. */
function leave(w: WorldState, id: AgentId): void {
  const a = agent(w, id);
  w.company.agents.splice(w.company.agents.indexOf(a), 1);
  w.company.org!.alumni.push({
    id, name: a.name, gender: a.gender, roleId: a.roleId, dept: a.dept, founder: a.founder, hiredDay: a.hiredDay, leftDay: w.day, reason: 'test', level: a.level, kind: 'fired', replacedBy: null, perf: a.perf, avatar: a.avatar,
  });
  reconcileOrg(w);
}

function mission(w: WorldState, ownerId: AgentId): Mission {
  const m: Mission = { id: `mis_${ownerId}`, day: w.day, from: 'founder', text: 'Une mission', ownerId, taskIds: [], status: 'open' };
  w.company.missions.push(m);
  return m;
}

const lean = (s: Partial<ScenarioConfig>): ScenarioConfig => defaultScenario({ mindMode: 'heuristic', maxComputeEur: 0, ...s });

describe('the default company (§2.8)', () => {
  it('is the V1 one, and an explicit field still wins', () => {
    expect(defaultScenario()).toMatchObject({ org: LEAN_ORG, talent: 'league', channelControl: 'none', videoModel: 'on', visualModel: 'on', scaling: true, openEnded: false });
    expect(defaultScenario({ ...LEGACY })).toMatchObject({ org: { team: 'legacy31' }, talent: 'off', channelControl: 'tiktok_only', scaling: false });
    expect(createWorld(defaultScenario(), 'test-default').company.agents.map((a) => a.id)).toEqual(FOUNDERS);
    expect(createWorld(defaultScenario({ ...LEGACY }), 'test-default').company.agents).toHaveLength(31);
  });

  it('gives each world its own org config', () => {
    const a = defaultScenario();
    a.org!.autoHire = false;
    expect(defaultScenario().org!.autoHire).toBe(true);
    expect(LEAN_ORG.autoHire).toBe(true);
  });
});

describe('the founding team (org test 4)', () => {
  it('counts 8 agents, 8 open departments, 24 hats (D2) and costs 5,70 € a day', () => {
    const w = leanWorld();
    expect(w.company.agents.map((a) => a.id)).toEqual(FOUNDERS);
    expect(openIds(w)).toEqual(['direction', 'recherche', 'studio', 'creation', 'growth', 'boutique', 'finance', 'rh']);
    expect(w.company.agents.flatMap((a) => a.hatKinds)).toHaveLength(24);
    for (const a of w.company.agents) expect(a.hatKinds, a.id).toEqual(FOUNDING_HATS[a.id]);
    expect(Math.round(w.company.agents.reduce((sum, a) => sum + payOf(a), 0) * 100) / 100).toBe(5.7);
    expect(w.company.org!.stats.lastResortHats).toBe(0);
  });

  it('gives every kind of the 47 an owner, a hat being a kind on top of the role', () => {
    const w = leanWorld();
    for (const k of ALL_KINDS) expect(w.company.agents.some((a) => a.taskKinds.includes(k)), k).toBe(true);
    for (const a of w.company.agents) expect(a.taskKinds, a.id).toEqual([...ROLES[a.roleId].core, ...ROLES[a.roleId].assist, ...a.hatKinds]);
  });

  it('closes 5 departments, each carried by a founder (D5)', () => {
    const w = leanWorld();
    expect(w.company.org!.closedDepts.map((d) => d.id).sort()).toEqual(['analyse', 'crm', 'partenariats', 'support', 'video']);
    expect(w.company.org!.deptHost).toEqual({ partenariats: 'recherche', support: 'boutique', analyse: 'finance', video: 'creation', crm: 'studio' });
  });

  it('resolves every office to a founder: the wearer of its kind when the role is vacant', () => {
    const { offices } = leanWorld().company.org!;
    expect(offices).toMatchObject({ ceo: 'camille', chief_of_staff: 'camille', cfo: 'gabriel', accountant: 'gabriel', hr: 'nora', analyst: 'gabriel', fact_checker: 'nora', pricing: 'clara', support: 'clara', partners: 'nadia', red_team: 'nora' });
    for (const id of Object.values(offices)) expect(FOUNDERS).toContain(id);
  });

  it('keeps every review pair distinct, the author being the one owner of the kind', () => {
    const w = leanWorld();
    for (const kind of Object.keys(REVIEW_OFFICE) as TaskKind[]) {
      const author = w.company.agents.find((a) => a.taskKinds.includes(kind))!;
      const t = createTask(w, { kind, assignee: author.id });
      expect(t.reviewer, kind).toBeTruthy();
      expect(t.reviewer, kind).not.toBe(author.id);
    }
  });

  it('lists hatDepts without the agent\'s own department: the home of each hat, closed ones included', () => {
    const w = leanWorld();
    expect(agent(w, 'clara').hatDepts).toEqual(['support', 'crm']);
    expect(agent(w, 'camille').hatDepts).toEqual([]);
    expect(agent(w, 'nora').hatDepts).toEqual(['studio']);
  });

  it('seeds each founder with the rules of what they carry', () => {
    const w = leanWorld();
    expect(w.company.playbooks.clara!.length).toBeGreaterThan(w.company.playbooks.nadia!.length);
  });
});

describe('reconcileOrg', () => {
  it('finds nothing to do on a second pass, on a world it had to repair (org test 3)', async () => {
    const w = leanWorld();
    await mount(w).runDays(4);
    hire(w, 'ines', 'support_lead');
    hire(w, 'lucas', 'support_agent');
    w.company.agents.splice(w.company.agents.findIndex((a) => a.id === 'ines'), 1); // the world as a departure leaves it, before the pass
    const before = JSON.stringify(w);
    reconcileOrg(w);
    const once = JSON.stringify(w);
    expect(once).not.toBe(before);
    expect(agent(w, 'lucas').isChief).toBe(true);
    reconcileOrg(w);
    expect(JSON.stringify(w)).toBe(once);
  }, 60_000);

  it('draws nothing and spends no id', () => {
    const w = leanWorld();
    const { idCounter, rngState } = w;
    hire(w, 'tom', 'community_manager');
    expect([w.idCounter, w.rngState]).toEqual([idCounter, rngState]);
  });

  it('a hire removes the hat, opens the department, and its first member is chief (org test 11)', () => {
    const w = leanWorld();
    const task = createTask(w, { kind: 'post_organic' });
    expect(task.dept).toBe('growth');
    const tom = hire(w, 'tom', 'community_manager');
    expect(agent(w, 'leo').hatKinds).not.toContain('post_organic');
    expect(agent(w, 'leo').taskKinds).not.toContain('post_organic');
    expect(openIds(w)).toContain('crm');
    expect(w.company.org!.closedDepts.map((d) => d.id)).not.toContain('crm');
    expect(w.company.org!.deptHost).not.toHaveProperty('crm');
    expect(w.company.departments.find((d) => d.id === 'crm')!.chiefId).toBe('tom');
    expect(tom.isChief).toBe(true);
    expect(openIds(w).indexOf('crm')).toBe(openIds(w).length - 1); // catalog order, not arrival order
    expect(auditOrg(w)).toEqual([]);
  });

  it('a second member of a department leaves the chief in place', () => {
    const w = leanWorld();
    hire(w, 'lucas', 'support_agent');
    const ines = hire(w, 'ines', 'support_lead', { perf: { done: 9, approved: 9, rejected: 0, failed: 0, score: 99 } });
    expect(chiefOf(w, 'support')!.id).toBe('lucas');
    expect(ines.isChief).toBe(false);
  });

  it('the last member leaves: the department closes, its tasks go home, the hat comes back (org test 12)', () => {
    const w = leanWorld();
    const before = createTask(w, { kind: 'reply_inbox' });
    expect(before.dept).toBe('boutique');
    hire(w, 'lucas', 'support_agent');
    expect(before.dept).toBe('support');
    expect(agent(w, 'clara').hatKinds).not.toContain('reply_inbox');
    before.assignee = 'lucas';
    before.status = 'in_progress';
    before.progress = 0.4;
    const review = createTask(w, { kind: 'handle_refund', assignee: 'lucas' });
    review.status = 'review';
    review.reviewer = 'nora';
    const def = w.company.departments.find((d) => d.id === 'support')!;
    def.deskHigh = 3;
    leave(w, 'lucas');
    expect(openIds(w)).not.toContain('support');
    expect(w.company.org!.closedDepts.find((d) => d.id === 'support')!.deskHigh).toBe(3); // a desk is never reused (ui §2.4)
    expect(w.company.org!.deptHost.support).toBe('boutique');
    expect(agent(w, 'clara').hatKinds).toEqual(FOUNDING_HATS.clara);
    expect(before).toMatchObject({ dept: 'boutique', assignee: null, status: 'pending', progress: 0.4 });
    expect(review).toMatchObject({ dept: 'boutique', assignee: null, status: 'review', reviewer: 'nora' }); // finished work is not done twice
    expect(chiefOf(w, 'support')!.id).toBe('clara');
    expect(auditOrg(w)).toEqual([]);
  });

  it('the chief leaves: the best member steps up, missions and reviews follow (org test 13)', () => {
    const w = leanWorld();
    const kenji = hire(w, 'kenji', 'cover_designer', { perf: { done: 1, approved: 1, rejected: 0, failed: 0, score: 60 } });
    const maelle = hire(w, 'maelle', 'layout_designer', { perf: { done: 9, approved: 9, rejected: 0, failed: 0, score: 80 } });
    const m = mission(w, 'zoe');
    const closed = { ...mission(w, 'zoe'), id: 'mis_closed', status: 'done' as const };
    w.company.missions.push(closed);
    const task = createTask(w, { kind: 'design_cover', assignee: 'kenji' });
    expect(task.reviewer).toBe('zoe');
    const hatBefore = agent(w, 'leo').hatKinds.length;
    leave(w, 'zoe');
    expect(chiefOf(w, 'creation')!.id).toBe('maelle');
    expect(maelle.isChief).toBe(true);
    expect(kenji.isChief).toBe(false);
    expect(m.ownerId).toBe('maelle');
    expect(closed.ownerId).toBe('zoe');
    expect(task.reviewer).toBe('maelle');
    expect(w.company.org!.offices.art).toBe('maelle'); // the role is vacant: the best owner of its kind
    expect(agent(w, 'leo').hatKinds.length).toBeGreaterThan(hatBefore); // produce_ad falls to the next role of its table
    expect(agent(w, 'leo').hatKinds).toContain('produce_ad');
    expect(auditOrg(w)).toEqual([]);
  });

  it('a mission of someone from a closed department goes to whoever carries it, a stranger\'s to the CEO', () => {
    const w = leanWorld();
    hire(w, 'lucas', 'support_agent');
    const carried = mission(w, 'lucas');
    const stranger = mission(w, 'personne');
    leave(w, 'lucas');
    expect(carried.ownerId).toBe('clara');
    expect(stranger.ownerId).toBe('camille');
  });

  it('a reviewer who cannot read their own work is replaced', () => {
    const w = leanWorld();
    const samuel = hire(w, 'samuel', 'fact_checker');
    const pdf = createTask(w, { kind: 'write_pdf', assignee: 'elise' });
    expect(pdf.reviewer).toBe(samuel.id);
    leave(w, 'samuel');
    expect(pdf.reviewer).toBe('nora');
    pdf.assignee = 'nora';
    reconcileOrg(w);
    expect(pdf.reviewer).toBe('elise');
  });

  it('leaves office and chief alone at a reload, whatever the scores did since', () => {
    const w = leanWorld();
    hire(w, 'kenji', 'cover_designer', { perf: { done: 9, approved: 9, rejected: 0, failed: 0, score: 90 } });
    hire(w, 'maelle', 'layout_designer');
    leave(w, 'zoe');
    expect(w.company.org!.offices.art).toBe('kenji');
    agent(w, 'maelle').perf.score = 99;
    reconcileOrg(w);
    expect(w.company.org!.offices.art).toBe('kenji');
    expect(chiefOf(w, 'creation')!.id).toBe('kenji');
  });

  it('falls back on the CEO when no role of the table is alive, and says so', () => {
    const w = leanWorld();
    for (const r of KIND_HATS.humanize_pdf) for (const a of w.company.agents.filter((x) => x.roleId === r)) leave(w, a.id);
    expect(agent(w, 'camille').hatKinds).toContain('humanize_pdf');
    expect(lastResortHats(w)).toContain('humanize_pdf');
    const stats = w.company.org!.stats.lastResortHats;
    expect(stats).toBe(lastResortHats(w).length);
    reconcileOrg(w);
    expect(w.company.org!.stats.lastResortHats).toBe(stats);
    expect(auditOrg(w)).toEqual([]); // the kind has an owner: an incident, not a broken invariant
  });
});

describe('auditOrg', () => {
  const broken = (mutate: (w: WorldState) => void): string[] => {
    const w = leanWorld();
    mutate(w);
    return auditOrg(w);
  };
  const task = (w: WorldState): Task => createTask(w, { kind: 'scan_trends', assignee: 'nadia' });

  it('is empty on a healthy world, and says nothing of the legacy team, which has no owner for the V1 kinds', () => {
    expect(auditOrg(leanWorld())).toEqual([]);
    expect(auditOrg(legacyWorld())).toEqual([]);
  });

  it('I1: a kind without an owner', () => {
    expect(broken((w) => { for (const a of w.company.agents) a.taskKinds = a.taskKinds.filter((k) => k !== 'retro'); })).toEqual([expect.stringContaining(KIND_META.retro.label)]);
  });

  it('I2: an office without a living holder', () => {
    expect(broken((w) => { w.company.org!.offices.cfo = 'personne'; })).toEqual([expect.stringContaining('personne')]);
  });

  it('I3: an open department with no member, no chief or two', () => {
    expect(broken((w) => { agent(w, 'nora').dept = 'finance'; agent(w, 'nora').isChief = false; })).toEqual([expect.stringContaining('sans personne')]);
    expect(broken((w) => { agent(w, 'nora').isChief = false; })).toEqual([expect.stringContaining('0 chef')]);
    expect(broken((w) => { agent(w, 'nadia').dept = 'rh'; })).toEqual(expect.arrayContaining([expect.stringContaining('2 chef')]));
  });

  it('I4: someone working in a closed department', () => {
    expect(broken((w) => { agent(w, 'nora').dept = 'crm'; })).toEqual(expect.arrayContaining([expect.stringContaining('fermé')]));
  });

  it('I5: an open task on someone absent, or reviewed by its author', () => {
    expect(broken((w) => { task(w).assignee = 'personne'; })).toEqual([expect.stringContaining('confiée')]);
    expect(broken((w) => { task(w).reviewer = 'personne'; })).toEqual([expect.stringContaining('relecteur')]);
    expect(broken((w) => { task(w).reviewer = 'nadia'; })).toEqual([expect.stringContaining('propre tâche')]);
    expect(broken((w) => { const t = task(w); t.assignee = 'personne'; t.status = 'done'; })).toEqual([]);
  });

  it('I7: too many people, too many in a role', () => {
    expect(broken((w) => { const a = agent(w, 'nora'); for (let i = 0; i < ORG.maxHeadcount; i++) w.company.agents.push({ ...a, id: `a${i}`, name: `A${i}`, roleId: 'support_agent', dept: 'rh', isChief: false }); w.company.playbooks = new Proxy({}, { get: () => [] }); })).toEqual(expect.arrayContaining([expect.stringContaining('plafond'), expect.stringContaining('place(s)')]));
  });

  it('I8: someone without a playbook', () => {
    expect(broken((w) => { delete w.company.playbooks.nora; })).toEqual([expect.stringContaining('playbook')]);
  });

  it('I9: a name used twice, alumni included (D53)', () => {
    expect(broken((w) => { w.company.org!.alumni.push({ name: 'Nora' } as never); })).toEqual([expect.stringContaining('Nora')]);
  });
});

describe('what the evening finds reaches the feed (org §7)', () => {
  const orgLines = (w: WorldState): string[] => w.activity.filter((a) => a.kind === 'org').map((a) => a.text);

  it('a broken invariant, which the retro has already missed and the morning wipes from the incidents', async () => {
    const w = leanWorld();
    const company = mount(w);
    for (let i = 0; i < 11; i++) await company.step();
    createTask(w, { kind: 'scan_trends', title: 'Tâche fantôme', assignee: null }).assignee = 'personne';
    await company.step();
    expect(w.company.org!.stats.violations).toBe(1);
    expect(orgLines(w)).toEqual(expect.arrayContaining([expect.stringContaining('Tâche fantôme')]));
    expect(w.activity.find((a) => a.text.includes('Tâche fantôme') && a.kind === 'org')!.agentId).toBe(officerId(w, 'hr'));
  }, 60_000);

  it('the CEO left with a hat nobody else can wear', async () => {
    const w = leanWorld();
    const company = mount(w);
    for (const r of KIND_HATS.humanize_pdf) for (const a of w.company.agents.filter((x) => x.roleId === r)) leave(w, a.id);
    for (let i = 0; i < 12; i++) await company.step();
    expect(orgLines(w)).toEqual(expect.arrayContaining([expect.stringContaining(`« ${KIND_META.humanize_pdf.label} » en dernier recours`)]));
  }, 60_000);
});

describe('I6, read at the close', () => {
  const line = (w: WorldState, amount: number): void => { w.ledger.push({ id: 'led_x', day: w.day, type: 'salary', amount, memo: '', ref: `payroll:${w.day}` }); };
  const paid = (): WorldState => leanWorld(7, { org: { team: 'lean', autoHire: false, payroll: true } });

  it('agrees when the line is what was due', () => {
    const w = paid();
    line(w, -7.6);
    expect(salaryBroken(w, 7.6)).toBeNull();
    expect(salaryBroken(paid(), 0)).toBeNull();
  });

  it('sees a missing line, a wrong one, and a second one', () => {
    expect(salaryBroken(paid(), 7.6)).toContain('7.6');
    const w = paid();
    line(w, -7);
    expect(salaryBroken(w, 7.6)).not.toBeNull();
    line(w, -7.6);
    expect(salaryBroken(w, 14.6)).toBeNull();
    expect(salaryBroken(w, 7.6)).not.toBeNull();
  });

  it('has nothing to say of a team nobody pays', () => {
    expect(salaryBroken(leanWorld(), 7.6)).toBeNull();
  });
});

describe('routing', () => {
  it('reads what fits: core, assist, hat', () => {
    const w = leanWorld();
    const sarah = hire(w, 'sarah', 'hook_writer');
    expect(fitOf(sarah, 'write_ad_hooks')).toBe('core');
    expect(fitOf(sarah, 'produce_ad')).toBe('assist');
    expect(fitOf(agent(w, 'zoe'), 'adapt_creative')).toBe('hat');
    expect(fitOf(agent(w, 'camille'), 'pick_opportunity')).toBe('assist');
  });

  it('never strands a specialist outside the home of the kind', () => {
    const w = leanWorld();
    const chloe = hire(w, 'chloe', 'video_editor');
    expect(chloe.dept).toBe('video');
    expect(KIND_META.produce_ad.dept).toBe('growth');
    hire(w, 'sarah', 'hook_writer');
    expect(capableAgents(w, 'produce_ad', 'growth').map((a) => a.id).sort()).toEqual(['chloe', 'sarah']);
  });

  it('leaves out an owner who is neither at home nor in their job, as long as someone is', () => {
    const w = leanWorld();
    hire(w, 'hugo', 'chief_of_staff'); // daily_report in assist, away in the direction
    expect(capableAgents(w, 'daily_report').map((a) => a.id)).toEqual(['hugo']);
    hire(w, 'raphael', 'data_analyst');
    expect(capableAgents(w, 'daily_report').map((a) => a.id)).toEqual(['raphael']);
  });

  it('falls back on all owners: a founder wearing a hat works away from its department', () => {
    const w = leanWorld();
    expect(capableAgents(w, 'produce_ad', 'growth').map((a) => a.id)).toEqual(['zoe']);
  });

  it('keeps a buyer on the channel of the role, no channel being TikTok (D25)', () => {
    const w = leanWorld();
    hire(w, 'adam', 'media_buyer_tiktok');
    hire(w, 'iris', 'media_buyer_meta');
    expect(capableAgents(w, 'launch_campaign').map((a) => a.id)).toEqual(['leo', 'adam']);
    expect(capableAgents(w, 'launch_campaign', 'growth', 'meta').map((a) => a.id)).toEqual(['leo', 'iris']);
    expect(capableAgents(w, 'launch_campaign', 'growth', 'google').map((a) => a.id)).toEqual(['leo']);
    const task = createTask(w, { kind: 'launch_campaign', input: { channel: 'meta' } });
    expect(taskChannel(task)).toBe('meta');
    expect(taskChannel(createTask(w, { kind: 'launch_campaign' }))).toBe('tiktok');
    agent(w, 'leo').energy = 10;
    assignReady(w);
    expect(task.assignee).toBe('iris');
  });

  it('counts the finish, not the load: of two with the same queue, the one up to speed gets it', () => {
    const w = leanWorld();
    hire(w, 'aline', 'ghostwriter', { rampUntilDay: 3 });
    hire(w, 'theo', 'ghostwriter');
    const first = createTask(w, { kind: 'write_pdf', workLeft: 4 });
    assignReady(w);
    expect(first.assignee).toBe('theo');
  });

  it('a closed department answers through its host', () => {
    const w = leanWorld();
    expect(deptFor(w, 'reply_inbox')).toBe('boutique');
    expect(createTask(w, { kind: 'daily_report' }).dept).toBe('finance');
    expect(chiefOf(w, 'analyse')!.id).toBe('gabriel');
    for (const d of w.company.org!.closedDepts) expect(chiefOf(w, d.id), d.id).toBeDefined();
  });

  it('leaves the legacy team where it was: full speed, home departments, no guard', () => {
    const w = legacyWorld();
    expect(deptFor(w, 'reply_inbox')).toBe('support');
    for (const a of w.company.agents) for (const k of a.taskKinds) expect(speedFor(w, a, k)).toBe(1);
    expect(isGuardKind(w, 'optimize_ads')).toBe(false);
    expect(capableAgents(w, 'launch_campaign').map((a) => a.id)).toEqual(['leo', 'adam']);
    expect(capableAgents(w, 'produce_ad').map((a) => a.id)).toEqual(['sarah', 'chloe', 'tom']);
  });
});

describe('guard kinds (org test 17)', () => {
  it('are the stop-loss and the refund, on a lean team', () => {
    const w = leanWorld();
    expect(ALL_KINDS.filter((k) => isGuardKind(w, k))).toEqual(['optimize_ads', 'handle_refund']);
  });

  it('with 40 ticks of backlog and no energy left, Léo still optimises before tick 10 on every day a campaign is active', async () => {
    const w = leanWorld();
    const company = mount(w);
    for (let i = 0; i < 25 * 12 && !(activeCampaigns(w).length && w.tick === 0); i++) await company.step();
    expect(activeCampaigns(w).length).toBeGreaterThan(0);
    const leo = agent(w, 'leo');
    const backlog = createTask(w, { kind: 'write_ad_hooks', title: 'Arriéré', assignee: 'leo', workLeft: 40, priority: 1, reviewer: null });
    backlog.status = 'in_progress';
    let days = 0;
    while (days < 4 && activeCampaigns(w).length) {
      const day = w.day;
      leo.currentTaskId = backlog.id;
      for (let tick = 0; tick < 10; tick++) {
        leo.energy = 5; // a coffee would hide it: Leo never gets above the gate
        await company.step();
      }
      expect(w.tick).toBe(10);
      const guards = w.company.tasks.filter((t) => t.kind === 'optimize_ads' && t.dayCreated === day);
      expect(guards.length, `jour ${day}`).toBeGreaterThan(0);
      for (const t of guards) expect(t.status, `jour ${day}`).toBe('done');
      expect(backlog.workLeft).toBeGreaterThan(0);
      for (let tick = 10; tick < 12; tick++) await company.step();
      days++;
    }
    expect(days).toBeGreaterThanOrEqual(2); // the stop-loss itself ends the campaigns of this seed
    expect(backlog.status).toBe('in_progress'); // it was set aside, not lost
  }, 120_000);

  it('do not preempt on the legacy team', async () => {
    const w = legacyWorld();
    const company = mount(w);
    await company.step();
    const leo = agent(w, 'leo');
    const other = createTask(w, { kind: 'write_ad_hooks', title: 'En cours', assignee: 'leo', workLeft: 40, priority: 1, reviewer: null });
    other.status = 'in_progress';
    leo.currentTaskId = other.id;
    const guard = createTask(w, { kind: 'optimize_ads', assignee: 'leo', priority: 1 });
    await company.step();
    expect(guard.status).toBe('pending');
    expect(other.workLeft).toBe(39);
  }, 60_000);
});

describe('what a tick buys (org test 19)', () => {
  /** Ticks a task takes on a quiet first day, through the real workTick. */
  async function ticksOf(kind: TaskKind, assignee: AgentId, over: (w: WorldState) => void = () => undefined): Promise<number> {
    const w = leanWorld();
    over(w);
    const company = mount(w);
    await company.step();
    const task = createTask(w, { kind, title: 'Mesure', assignee, workLeft: 4, priority: 1, reviewer: null });
    for (const t of w.company.tasks) if (t.assignee === assignee && t !== task) t.priority = 3;
    let ticks = 0;
    while (task.workLeft > 0 && ticks < 12) {
      await company.step();
      ticks++;
    }
    return ticks;
  }

  it('a hat task of 4 work takes 6 ticks, the same in a role 4, and a ramp takes longer', async () => {
    expect(await ticksOf('follow_missions', 'camille')).toBe(6);
    expect(await ticksOf('portfolio_review', 'camille')).toBe(4);
    expect(await ticksOf('portfolio_review', 'camille', (w) => { agent(w, 'camille').rampUntilDay = 5; })).toBe(7);
  }, 60_000);

  it('multiplies hat and ramp, and the ramp ends on its last day', () => {
    const w = leanWorld();
    const zoe = agent(w, 'zoe');
    expect(speedFor(w, zoe, 'produce_ad')).toBe(ORG.hatSpeed);
    expect(speedFor(w, zoe, 'design_cover')).toBe(1);
    zoe.rampUntilDay = 2;
    w.day = 2;
    expect(speedFor(w, zoe, 'produce_ad')).toBeCloseTo(ORG.hatSpeed * ORG.rampSpeed);
    w.day = 3;
    expect(speedFor(w, zoe, 'design_cover')).toBe(1);
  });
});

describe('work grows with the business (org test 20)', () => {
  const campaigns = (n: number, status: Campaign['status'] = 'active'): Campaign[] => Array.from({ length: n }, (_, i) => ({ id: `cmp_${i}`, status } as Campaign));

  it('8 campaigns cost 3 ticks to optimise, and the legacy team stays at 1', () => {
    const w = leanWorld();
    expect(workFor(w, 'optimize_ads')).toBe(1);
    w.company.campaigns = campaigns(8);
    expect(workFor(w, 'optimize_ads')).toBe(3);
    expect(createTask(w, { kind: 'optimize_ads' }).workLeft).toBe(3);
    w.company.campaigns = [...campaigns(3), ...campaigns(5, 'paused')];
    expect(workFor(w, 'optimize_ads')).toBe(1);
    const old = legacyWorld();
    old.company.campaigns = campaigns(8);
    expect(workFor(old, 'optimize_ads')).toBe(1);
    expect(createTask(old, { kind: 'optimize_ads' }).workLeft).toBe(1);
  });

  it('6 live products add a tick to the report, 40 orders of yesterday one to the books', () => {
    const w = leanWorld();
    w.company.products = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, status: i < 6 ? 'live' : 'killed' }) as Product);
    expect(workFor(w, 'daily_report')).toBe(2);
    w.day = 3;
    w.market.orders = [...Array.from({ length: 40 }, () => ({ day: 2 }) as Order), ...Array.from({ length: 40 }, () => ({ day: 3 }) as Order)];
    expect(workFor(w, 'reconcile_ledger')).toBe(2);
  });

  it('leaves every other kind at its catalog work, and an explicit workLeft alone', () => {
    const w = leanWorld();
    w.company.campaigns = campaigns(8);
    for (const k of ALL_KINDS) if (!['optimize_ads', 'daily_report', 'reconcile_ledger'].includes(k)) expect(workFor(w, k), k).toBe(KIND_META[k].work);
    expect(createTask(w, { kind: 'optimize_ads', workLeft: 1 }).workLeft).toBe(1);
  });
});

describe('capacity matters (org test 18)', () => {
  /**
   * Two chains, a guide written then put online, ready on the same tick. Real chains would not show it: the writer changes
   * the text, so a chain's reviews and reworks change with it. The handlers stand still here, what moves is who works when.
   */
  async function secondPublished(team: (w: WorldState) => void): Promise<number> {
    const w = leanWorld();
    team(w);
    const company = mount(w);
    vi.spyOn(HANDLERS.write_pdf!, 'run').mockResolvedValue({ summary: 'Guide écrit', skipReview: true });
    vi.spyOn(HANDLERS.publish_product!, 'run').mockResolvedValue({ summary: 'En ligne', skipReview: true });
    await company.step();
    const publishes: Task[] = [];
    for (const title of ['A', 'B']) {
      const pdf = createTask(w, { kind: 'write_pdf', title: `Guide ${title}`, priority: 1, reviewer: null });
      publishes.push(createTask(w, { kind: 'publish_product', title: `Sortie ${title}`, dependsOn: [pdf.id], priority: 1, reviewer: null }));
    }
    for (let tick = 1; tick < 24; tick++) {
      await company.step();
      if (publishes.every((t) => t.status === 'done')) return tick;
    }
    return Infinity;
  }

  it('lean plus a ghostwriter publishes the second guide sooner', async () => {
    const alone = await secondPublished(() => undefined);
    const two = await secondPublished((w) => { hire(w, 'theo', 'ghostwriter'); });
    expect([alone, two]).toEqual([9, 6]); // 4 + 4 + 1 ticks, then 4 side by side + 2: Clara still puts them online one at a time
  }, 60_000);
});

describe('a lean run', () => {
  it('a lean run of 25 days, seed 7, publishes a guide', async () => {
    const w = createWorld(lean({ seed: 7 }), 'test-org-run');
    expect(w.company.agents).toHaveLength(8);
    await mount(w).runDays(25);
    expect(w.company.products.filter((p) => p.status === 'live').length).toBeGreaterThan(0);
    expect(w.company.tasks.filter((t) => t.log.some((l) => l.includes('erreur technique') || l.includes('aucun savoir-faire')))).toEqual([]);
    const founders = w.company.agents.filter((a) => a.founder);
    expect(founders).toHaveLength(8);
    for (const a of founders) expect(a.perf.done, a.id).toBeGreaterThan(0);
  }, 120_000);

  describe.each<[number, Difficulty]>([
    [1, 'facile'], [1, 'normal'], [1, 'cauchemar'],
    [7, 'facile'], [7, 'normal'], [7, 'cauchemar'],
    [42, 'facile'], [42, 'normal'], [42, 'cauchemar'],
  ])('seed %i, %s', (seed, difficulty) => {
    it('holds every invariant on every evening of 30 days (org test 1)', async () => {
      const w = createWorld(lean({ seed, difficulty }), `test-org-audit-${seed}`);
      const days: number[] = [];
      await mount(w).runDays(30, (kpi) => {
        days.push(kpi.day);
        expect(auditOrg(w), `jour ${kpi.day}`).toEqual([]);
      });
      expect(days).toHaveLength(30);
      expect(w.company.org!.stats.violations).toBe(0);
      expect(w.company.org!.stats.lastResortHats).toBe(0);
    }, 180_000);
  });

  it('goes on exactly like an uninterrupted run, whatever the tick of the reload', async () => {
    const decisions = (world: unknown): string => JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));
    async function play(reloadEvery: number): Promise<string> {
      const root = mkdtempSync(join(tmpdir(), 'pixel-org-reload-'));
      roots.push(root);
      const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
      const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 }), brain: createBrainVault(paths) };
      let world = createWorld(lean({ seed: 7, horizonDays: 90 }), 'test-org-reload');
      let company = new Company(world, opts);
      for (let i = 1; i <= 14 * 12; i++) {
        await company.step();
        if (reloadEvery && i % reloadEvery === 0) {
          world = JSON.parse(JSON.stringify(world)) as WorldState;
          company = new Company(world, opts);
        }
      }
      return decisions(world);
    }
    const straight = await play(0);
    expect(await play(7) === straight).toBe(true);
  }, 180_000);
});

describe('who holds what, by office', () => {
  it('the chief of staff is the CEO until one is hired', () => {
    const w = leanWorld();
    expect(officerId(w, 'chief_of_staff')).toBe('camille');
    const hugo = hire(w, 'hugo', 'chief_of_staff');
    expect(officerId(w, 'chief_of_staff')).toBe(hugo.id);
    expect(agent(w, 'camille').hatKinds).toEqual([]);
    leave(w, 'hugo');
    expect(officerId(w, 'chief_of_staff')).toBe('camille');
  });
});
