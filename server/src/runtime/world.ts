/** Fresh world: market, the team of the scenario with its open departments, starting capital, seed playbooks. */
import type { AgentState, ScenarioConfig, WorldState } from '../shared.js';
import { createRng, emit } from '../core/index.js';
import { sim } from './modules.js';
import { buildTeam } from './org/catalog.js';
import { LEGACY_ORG } from './org/constants.js';
import { officerOf } from './org/officers.js';
import { legacyOrgState, reconcileOrg } from './org/reconcile.js';
import { DEPARTMENTS, SEED_PLAYBOOKS } from './roster.js';
import { eur, uniq } from './util.js';

export function defaultScenario(overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  const base: ScenarioConfig = {
    name: 'Scénario normal',
    companyName: 'Pixel Agency',
    seed: 42,
    startingCash: 500,
    horizonDays: 60,
    difficulty: 'normal',
    mindMode: 'auto',
    founderApproval: false,
    chargeCompute: true,
    maxComputeEur: 3,
    goal: { targetProfit: 1000, byDay: 60 },
  };
  const o = overrides ?? {};
  const s: ScenarioConfig = { ...base, ...o, goal: { ...base.goal, ...(o.goal ?? {}) } };
  // Keep the run sane whatever the UI / CLI sends.
  s.seed = Number.isFinite(s.seed) ? Math.floor(s.seed) : base.seed;
  s.startingCash = Number.isFinite(s.startingCash) && s.startingCash >= 0 ? s.startingCash : base.startingCash;
  s.horizonDays = Number.isFinite(s.horizonDays) && s.horizonDays >= 1 ? Math.floor(s.horizonDays) : base.horizonDays;
  s.maxComputeEur = Number.isFinite(s.maxComputeEur) && s.maxComputeEur >= 0 ? s.maxComputeEur : base.maxComputeEur;
  if (!['facile', 'normal', 'cauchemar'].includes(s.difficulty)) s.difficulty = base.difficulty;
  if (!['auto', 'heuristic', 'claude'].includes(s.mindMode)) s.mindMode = base.mindMode;
  if (!o.goal?.byDay && o.horizonDays) s.goal.byDay = s.horizonDays;
  if (!Number.isFinite(s.goal.targetProfit)) s.goal.targetProfit = base.goal.targetProfit;
  if (!Number.isFinite(s.goal.byDay) || s.goal.byDay < 1) s.goal.byDay = s.horizonDays;
  s.name = String(s.name || base.name);
  s.companyName = String(s.companyName || base.companyName);
  return s;
}

export function createWorld(scenario: ScenarioConfig, runId: string): WorldState {
  const sc = defaultScenario(scenario);
  const rng = createRng(sc.seed);
  const org = sc.org ?? LEGACY_ORG;
  const agents: AgentState[] = buildTeam(org).map((def) => ({
    ...def,
    skills: [...def.skills],
    tools: [...def.tools],
    taskKinds: [...def.taskKinds],
    avatar: { ...def.avatar },
    status: 'idle',
    place: def.dept,
    currentTaskId: null,
    energy: 100,
    level: 1,
    xp: 0,
    perf: { done: 0, approved: 0, rejected: 0, failed: 0, score: 50 },
    bubble: null,
    hatKinds: [],
    hatDepts: [],
    hiredDay: 0,
    rampUntilDay: 0,
    notice: null,
  }));

  const world: WorldState = {
    version: 2,
    runId,
    createdAt: new Date().toISOString(),
    scenario: sc,
    day: 1,
    tick: 0,
    phase: 'morning',
    rngState: sc.seed >>> 0,
    idCounter: 0,
    mind: { mode: sc.mindMode === 'claude' ? 'claude' : 'heuristic', calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 },
    status: 'running',
    company: {
      name: sc.companyName,
      agents,
      departments: DEPARTMENTS.filter((d) => d.id === 'direction' || agents.some((a) => a.dept === d.id)).map((d) => ({ ...d, grid: { ...d.grid } })),
      tasks: [],
      missions: [],
      products: [],
      creatives: [],
      campaigns: [],
      deliverables: [],
      research: { trends: [], voc: {}, competitors: {}, shortlist: [] },
      lessons: [],
      experiments: [],
      bandits: {},
      playbooks: {},
      kpis: [],
      chats: {},
      pendingApprovals: [],
    },
    market: undefined as unknown as WorldState['market'],
    ledger: [],
    activity: [],
  };
  world.market = sim.createMarketState(sc, rng);
  world.rngState = rng.state();
  world.company.org = legacyOrgState(world);
  if (org.team === 'lean') reconcileOrg(world);
  // Own department, plus the departments of the hats: a founder starts with the rules of what they carry.
  for (const a of world.company.agents) world.company.playbooks[a.id] = uniq([a.dept, ...a.hatDepts]).flatMap((d) => SEED_PLAYBOOKS[d]);
  sim.recordLedger(world, { type: 'capital', amount: sc.startingCash, memo: 'Capital de départ apporté par le fondateur', ref: null });
  emit(world, {
    agentId: officerOf(world, 'ceo').id,
    kind: 'thought',
    text: `Bienvenue chez ${sc.companyName} ! ${agents.length} agents, ${eur(sc.startingCash)} en caisse. Objectif : ${eur(sc.goal.targetProfit)} de profit d'ici le jour ${sc.goal.byDay}. Au travail !`,
  });
  return world;
}
