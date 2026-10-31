// One GET per detail tab (ui §6.2): fetched on open and on each new day, the live stream never carries these views.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentState, ChronicleEntry, DeptId, LeagueDetail, LeagueRow, ModelTier, OrgDept, OrgDetail, Skill, TalentTruthView } from '../../../shared/types';
import { mockSnapshot } from '../world/mockSnapshot';
import { useApp } from './context';
import { hash } from './format';
import { ROLE_LABEL } from './labels';

export interface DetailState<T> { data: T | null; error: string | null; loading: boolean }
export interface Detail<T> extends DetailState<T> { reload(): void }

const TIMEOUT_MS = 10_000;

async function getJson<T>(path: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, { signal: ctrl.signal, headers: { Accept: 'application/json' } }).catch(() => null);
    if (!res) throw new Error('Serveur injoignable');
    if (!res.ok) throw new Error(`Erreur serveur (${res.status})`);
    // Vite answers an unknown route with index.html: that is no detail view either
    return await res.json().catch(() => { throw new Error('Réponse illisible du serveur'); }) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Only the newest request may publish, and an error keeps the last good data. Outside React so a test can drive it. */
export function detailLoader<T>(fetcher: (path: string) => Promise<T>, publish: (next: (prev: DetailState<T>) => DetailState<T>) => void) {
  let latest = 0;
  return {
    async load(path: string): Promise<void> {
      const seq = ++latest;
      publish((prev) => ({ ...prev, loading: true }));
      try {
        const data = await fetcher(path);
        if (seq === latest) publish(() => ({ data, error: null, loading: false }));
      } catch (e) {
        if (seq === latest) publish((prev) => ({ ...prev, error: e instanceof Error ? e.message : 'Serveur injoignable', loading: false }));
      }
    },
    /** Whatever is still on its way no longer counts. */
    cancel(): void { latest += 1; },
  };
}

const IDLE = { data: null, error: null, loading: false };

export function useDetail<T>(path: string | null, day: number): Detail<T> {
  const { demo, runId } = useApp();
  const [state, setState] = useState<DetailState<T>>(() => {
    if (path === null) return IDLE;
    return demo ? { data: mockDetail(path) as T | null, error: null, loading: false } : { ...IDLE, loading: true };
  });
  const [nonce, setNonce] = useState(0);
  const loader = useMemo(() => detailLoader<T>(getJson, setState), []);
  const seenRun = useRef(runId);

  useEffect(() => {
    // a new run may start on the same day number, and owes nothing to the last one
    if (seenRun.current !== runId) {
      seenRun.current = runId;
      setState(IDLE);
    }
    if (path === null || demo) {
      loader.cancel();
      setState(path === null ? IDLE : { data: mockDetail(path) as T | null, error: null, loading: false });
      return undefined;
    }
    void loader.load(path);
    return () => loader.cancel();
  }, [path, day, demo, runId, nonce, loader]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return useMemo(() => ({ ...state, reload }), [state, reload]);
}

// ───────────────────────────── Demo mode ─────────────────────────────
// Built on the mock's own agents, so a click in a tab opens a real card. Everything derives from the id: same page every time.

const MOCK_PAY: Record<ModelTier, number> = { opus: 1.2, sonnet: 0.8, haiku: 0.5 };
const MOCK_FAMILIES: { key: Skill; label: string; depts: DeptId[] }[] = [
  { key: 'copy', label: 'Pubs', depts: ['growth', 'creation'] },
  { key: 'longform', label: 'Guides', depts: ['studio'] },
  { key: 'page', label: 'Pages de vente', depts: ['boutique'] },
  { key: 'support', label: 'Support', depts: ['support'] },
];
const FORM: LeagueRow['form'] = ['V', 'N', 'D', 'V', 'V'];

const ratingOf = (a: AgentState) => 1500 + (hash(a.id) % 240) - 120;

function mockHeads(agents: AgentState[], id: DeptId): OrgDept['heads'] {
  return agents.filter((a) => a.dept === id).map((a, i) => {
    const pay30d = MOCK_PAY[a.tier] * 30;
    const output30d = a.perf.approved;
    return {
      agentId: a.id, name: a.name, role: a.role, avatar: a.avatar, isChief: a.isChief, tier: a.tier,
      contract: a.hiredDay > 3 ? 'trial' : 'active', hiredDay: a.hiredDay, desk: a.desk ?? i, rating: a.isChief ? null : ratingOf(a), hats: a.hatKinds,
      pay30d, output30d, costPerOutput: output30d ? pay30d / output30d : null,
    };
  });
}

function mockOrg(): OrgDetail {
  const s = mockSnapshot();
  const { agents, departments } = s.company;
  const depts = departments.filter((d) => agents.some((a) => a.dept === d.id)).map((d): OrgDept => {
    const heads = mockHeads(agents, d.id);
    const cost30d = heads.reduce((n, h) => n + h.pay30d, 0);
    return { id: d.id, name: d.name, color: d.color, chiefId: d.chiefId, headcount: heads.length, cost30d, load: 0.4 + (hash(d.id) % 50) / 100, openReqs: d.id === 'creation' ? 1 : 0, heads };
  });
  const cost30d = depts.reduce((n, d) => n + d.cost30d, 0);
  const headcount = agents.length;
  const lead = agents[0]?.name ?? 'La CEO';
  const refusal: ChronicleEntry = {
    key: 'org:dec_3', day: 7, kind: 'req_open', text: 'Le CFO refuse le poste de Community manager.',
    why: 'Marge 18,40 €/j pour un coût de 24,20 €/j : l’agence ne paie pas encore ce salaire.',
    numbers: { cash: 412, margin: 18.4, payroll: 24.2, pay: 0.5, relief: 7.5, ownerUtil: 0.55, headcount },
  };
  return {
    stage: {
      level: 1, total: 4, id: 'adequation', name: 'Adéquation', sinceDay: 6, headcount,
      gate: {
        next: 'acceleration', weeksHeld: 1, weeksNeeded: 2,
        checks: [{ label: 'Profit sur 28 jours', value: 163, target: 300, ok: false }, { label: 'ROAS sur 14 jours', value: 2.4, target: 1.8, ok: true }],
      },
    },
    headcount, cost30d, costPerHead30d: cost30d / headcount, revenuePerHead30d: 22.4, profitPerHead30d: -2.6,
    depts,
    closed: [{ id: 'partenariats', name: 'Partenariats', hostedBy: 'recherche' }, { id: 'video', name: 'Studio Vidéo', hostedBy: 'creation' }],
    reqs: [
      {
        id: 'pos_2', dept: 'creation', role: ROLE_LABEL.motion_designer, status: 'open', openedDay: 8, budget30d: 24, blockedBy: null,
        why: `Adaptation de créa : 14 ticks d’attente par jour, ${lead} occupée à 82 %.`,
        candidates: [{ name: 'Yanis', score: 78, source: 'marché' }, { name: 'Sacha', score: 71, source: 'marché' }, { name: 'Maya', score: 66, source: 'élève' }],
      },
      { id: 'pos_1', dept: 'support', role: ROLE_LABEL.support_agent, status: 'filled', openedDay: 3, budget30d: 15, blockedBy: null, why: 'Réponses clients : 13 ticks d’attente par jour.', candidates: [] },
    ],
    pressure: [
      { roleId: 'motion_designer', relief: 14.2, ownerUtil: 0.82, days: 3 },
      { roleId: 'community_manager', relief: 7.5, ownerUtil: 0.55, days: 0 },
    ],
    lastRefusal: refusal,
    decisions: [
      { key: 'org:dec_1', day: 3, kind: 'req_open', text: 'Poste ouvert : Agent support.', why: 'Réponses clients : 13 ticks d’attente par jour.' },
      { key: 'org:dec_2', day: 5, kind: 'hire', text: 'Un agent support rejoint l’agence.', why: 'Meilleur test : 74/100.', numbers: { recruiting: 3.5 } },
      refusal,
    ],
    history: Array.from({ length: 10 }, (_, i) => ({ day: i + 1, headcount: Math.max(1, headcount - (i < 5 ? 1 : 0)), cost7d: Math.round(cost30d * (7 / 30) * (0.9 + i / 90)) })),
  };
}

function mockRows(agents: AgentState[]): LeagueRow[] {
  return [...agents].sort((a, b) => ratingOf(b) - ratingOf(a) || a.id.localeCompare(b.id)).map((a, i) => {
    const h = hash(a.id);
    const rating = ratingOf(a);
    const sample = 2 + (h % 12);
    return {
      agentId: a.id, name: a.name, role: a.role, dept: a.dept, avatar: a.avatar,
      rank: i + 1, rankDelta: (h % 3) - 1, rating, delta7d: (h % 41) - 20,
      spark: [3, 2, 1, 0].map((w) => rating - w * ((h % 17) - 8)),
      form: [...FORM.slice(h % 5), ...FORM.slice(0, h % 5)],
      points: Math.round(rating - 1500), sample, confidence: sample < 4 ? 'faible' : sample < 9 ? 'moyenne' : 'forte',
      contract: 'active', metric: `${60 + (h % 35)}/100`,
    };
  });
}

function mockLeague(god: boolean): LeagueDetail {
  const s = mockSnapshot();
  const { agents } = s.company;
  const roles = MOCK_FAMILIES
    .map((f) => ({ key: f.key, label: f.label, rows: mockRows(agents.filter((a) => f.depts.includes(a.dept) && a.dept !== 'direction')), cutLine: null as number | null }))
    .filter((f) => f.rows.length > 0);
  const family = roles[0];
  const last = family?.rows[family.rows.length - 1];
  if (family && last && family.rows.length > 1) {
    last.contract = 'probation';
    family.cutLine = last.rank;
  }
  const best = family?.rows[0];
  const second = family?.rows[1] ?? best;
  const gone = { id: 'noa', name: 'Noa', role: ROLE_LABEL.hook_writer, dept: 'growth' as const, avatar: agents[0]!.avatar };
  const champion = { id: best?.agentId ?? gone.id, name: best?.name ?? gone.name, role: best?.role ?? gone.role, dept: best?.dept ?? gone.dept, avatar: best?.avatar ?? gone.avatar };
  const truth: Record<string, TalentTruthView> = {};
  for (const r of roles.flatMap((f) => f.rows)) truth[r.agentId] = { truth: 0.5 + ((r.rating - 1500) / 400) + ((hash(r.agentId) % 20) - 10) / 100, note: 'plafond 0,71' };
  return {
    season: {
      no: 2, fromDay: 8, toDay: 21, daysLeft: 11,
      rules: [
        'Une saison dure 14 jours. Tout le monde part de 1 500.',
        'La note ne lit que des résultats observés : qualité, ventes, réponses.',
        'Sous la barre avec assez de preuves : un plan de 14 jours et un coach.',
        'Plan raté : test réel contre trois candidats, le poste change de main seulement si l’un bat le titulaire de 3 points.',
      ],
    },
    roles,
    plans: last ? [{
      agentId: last.agentId, skill: family?.key ?? 'copy', openedSeason: 2, deadlineDay: 22, metricLabel: 'Qualité moyenne des pubs', baseline: 71, target: 74, coachId: best?.agentId ?? null,
      text: `Plan d’amélioration de ${last.name} : qualité moyenne des pubs 71/100, objectif 74/100 en 14 jours. Coach : ${best?.name ?? 'personne'}.`, outcome: 'open',
    }] : [],
    lastHire: {
      day: 7, incumbent: gone.id, skill: 'copy', hired: best?.agentId ?? null, reason: `${champion.name} (88/100 au test) bat Noa (72/100) de 16,0 points.`,
      candidates: [
        { id: gone.id, name: gone.name, isIncumbent: true, lineage: null, score: 72, deliverable: 'Deux pubs, hook « Erreur à éviter »' },
        { id: champion.id, name: champion.name, isIncumbent: false, lineage: null, score: 88, deliverable: 'Deux pubs, hook « Avant / après »' },
        { id: 'sacha', name: 'Sacha', isIncumbent: false, lineage: null, score: 69, deliverable: 'Deux pubs, hook « Question »' },
        { id: 'maya', name: 'Maya', isIncumbent: false, lineage: best?.agentId ?? null, score: 81, deliverable: 'Deux pubs, hook « Chiffre choc »' },
      ],
    },
    duels: best && second ? [
      { id: 'duel_2', label: 'Hooks du guide en vente', metric: 'CTR', a: { agentId: best.agentId, name: best.name, score: null, ratingDelta: null }, b: { agentId: second.agentId, name: second.name, score: null, ratingDelta: null }, startedDay: 8, endDay: 12, winnerId: null, status: 'open' },
      { id: 'duel_1', label: 'Hooks du lancement', metric: 'CTR', a: { agentId: best.agentId, name: best.name, score: 0.031, ratingDelta: 14 }, b: { agentId: second.agentId, name: second.name, score: 0.024, ratingDelta: -14 }, startedDay: 4, endDay: 7, winnerId: best.agentId, status: 'done' },
    ] : [],
    transfers: [
      { key: 'org:dec_5', day: 7, kind: 'fire', text: 'Noa quitte l’agence.', why: 'Qualité moyenne 68/100 pour un objectif de 74/100, coach pendant 14 jours.', agentId: gone.id, numbers: { severance: 5.6 } },
      { key: 'org:dec_6', day: 7, kind: 'hire', text: `${champion.name} reprend le poste.`, why: '88/100 au test.', agentId: champion.id, numbers: { recruiting: 5.6 } },
    ],
    hallOfFame: [{ season: 1, champion, score: 88, still: true, second: gone, third: null }],
    alumni: [{
      person: gone, hiredDay: 0, leftDay: 7, kind: 'fired', why: 'Qualité moyenne 68/100 pour un objectif de 74/100, classement 1 412, coach pendant 14 jours. Le meilleur candidat reprend le poste.',
      bestRating: 1488, titles: 1, tasksDone: 14, cost: 48.2, replacedBy: { id: champion.id, name: champion.name },
    }],
    ...(god ? { god: truth } : {}),
  };
}

/** What a tab reads in demo mode. Other routes answer null: their tab says it has nothing to show. */
export function mockDetail(path: string): unknown {
  const [route, query = ''] = path.split('?');
  if (route === '/api/org') return mockOrg();
  if (route === '/api/league') return mockLeague(new URLSearchParams(query).get('god') === '1');
  return null;
}
