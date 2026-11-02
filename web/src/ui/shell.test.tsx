// The shell around the world: digest, stage badge, HUD, end of run, scenario form, calendar, toasts, agent card (ui §6.7 to §6.9, §8).
// Run: cd server && npx vitest run --root ../web/src
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Activity, AgentState, AlumnusView, ChronicleEntry, CompanySnapshot, FounderDigest, HeadRow, LeagueDetail, OrgDetail, PersonChip, SessionInfo, StageView, Task } from '../../../shared/types';
import { PIER_CELL } from '../../../shared/worldgrid';
import { Minimap } from '../world/Minimap';
import { mockSnapshot } from '../world/mockSnapshot';
import { ActivityFeed, teamLine } from './ActivityFeed';
import { AgentPanel, AlumnusCard, CareerBody, FicheTab } from './AgentPanel';
import { AppContext, type AppCtx } from './context';
import { DeptPanel, DeptTasks, seatsLine } from './DeptPanel';
import { sessionView } from './derive';
import { EndBanner } from './EndBanner';
import { digestDue, digestWatch, FounderDigestBody, FounderDigestModal, type DigestClock } from './FounderDigest';
import { CompanyBadge, SimHud } from './Hud';
import { agentName, buildLookups } from './labels';
import { ScenarioModal } from './ScenarioModal';
import { StageBadge, stageAria } from './StageBadge';
import { calendarSpan, CalendarTab, journalWritten } from './tabs/CalendarTab';
import { mockDetail } from './useDetail';
import { chronicleToasts, entryTarget, lastAnnounced, takeToasts, type ChronicleSeen } from './useEventToasts';

const noop = () => undefined;

function render(el: ReactElement, opts: { snapshot?: CompanySnapshot; demo?: boolean; activity?: Activity[] } = {}): string {
  const s = opts.snapshot ?? mockSnapshot();
  const ctx: AppCtx = {
    snapshot: s, lookups: buildLookups(s), activity: opts.activity ?? [], demo: opts.demo ?? false, godMode: false, runId: s.runId,
    toast: noop, openAgent: noop, openDept: noop, openProduct: noop, centerAgent: noop, centerDept: noop, setTab: noop, openBrainNote: noop, refresh: noop,
  };
  return renderToStaticMarkup(<AppContext.Provider value={ctx}>{el}</AppContext.Provider>);
}

/** Text as a reader gets it. */
const text = (html: string) => html.replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/[  ]/g, ' ');
const withScenario = (patch: Partial<CompanySnapshot['scenario']>, s = mockSnapshot()): CompanySnapshot => ({ ...s, scenario: { ...s.scenario, ...patch } });
const sess = (o: Partial<SessionInfo> = {}): SessionInfo => ({ runId: 'r', playing: true, speed: 1, busy: false, mindMode: 'heuristic', lastError: null, ...o });

const entry = (key: string, kind: ChronicleEntry['kind'], o: Partial<ChronicleEntry> = {}): ChronicleEntry => ({ key, day: 12, kind, text: `Ligne ${key}`, ...o });

function digestOf(o: Partial<FounderDigest> = {}): FounderDigest {
  return {
    fromDay: 12, toDay: 47,
    headline: 'Perte de 123,45 € en 36 jours, contre 40,00 € la période d’avant : 900,00 € de ventes.',
    money: { revenue: 900, refunds: 25, adSpend: 700, costs: 298.45, profit: -123.45, cashStart: 640, cashEnd: 516.55, previousProfit: 40 },
    stage: { from: 'survie', to: 'adequation', changes: [{ day: 30, to: 'adequation' }] },
    products: {
      launched: ['Dodo serein'], stopped: [{ title: 'Siestes faciles', why: 'ROAS 0,6 sur 40 € de test' }], reworked: ['Le guide du soir'],
      best: { title: 'Dodo serein', profit: 210 }, worst: { title: 'Siestes faciles', profit: -88.5 },
    },
    audience: { size: 430, added: 120, unsubscribed: 8, revenue: 56 },
    people: { hired: ['Yanis (Motion designer)'], left: ['Tom (Rédacteur) : qualité 68/100'], headFrom: 9, headTo: 10 },
    channels: { opened: ['Facebook & Instagram'], closed: ['Pinterest'], best: { id: 'meta', name: 'Facebook & Instagram', reconciledRoas: 2.31 } },
    highlights: [entry('org:1', 'fire', { text: 'Tom quitte l’agence', why: 'Qualité 68/100 pour un objectif de 74/100', agentId: 'tom' })],
    decisions: [{ id: 'dec_1', day: 20, kind: 'kill', who: 'system', text: 'Arrêt de Siestes faciles', why: 'ROAS 0,6', impactEur: -88.5 }],
    mistakes: ['2 semaine(s) en perte sur 5'], incidents: ['Jour 31 : machine éteinte 6 h'], waiting: ['À valider : remboursement'], next: ['Cette semaine : 20 € de pub par jour au plus'],
    ...o,
  };
}

describe('the journal of a day', () => {
  it('today has none yet', () => {
    expect([journalWritten(46, 47), journalWritten(47, 47)]).toEqual([true, false]);
  });
});

describe('founder digest', () => {
  const body = (d = digestOf()) => text(render(<FounderDigestBody data={d} onEntry={noop} onTasks={noop} />));

  it('digestDue: under 7 days no, without a value no, at 7 yes', () => {
    expect(digestDue(10, 16)).toBe(false);
    expect(digestDue(null, 400)).toBe(false);
    expect(digestDue(10, 17)).toBe(true);
  });

  it('prints the headline, and a loss as a negative number in the bad tone', () => {
    const html = body();
    expect(html).toContain('Perte de 123,45 €');
    expect(html).toMatch(/Profit<\/div><div class="stat-value txt-bad">−123,45 €/);
    expect(html).toMatch(/Trésorerie<\/div><div class="stat-value txt-bad">−123,45 €/);
    expect(html).toContain('Pire : Siestes faciles : −88,50 €');
    expect(html).toMatch(/txt-bad">−88,50 €<\/strong>/);
  });

  it('a guide in harvest stays on sale: it has its own word, not « Arrêté »', () => {
    const d = digestOf();
    const html = body({ ...d, products: { ...d.products, stopped: [{ title: 'Dodo serein', why: 'plus de pub', harvest: true }] } });
    expect(html).toContain('En récolte : Dodo serein. plus de pub');
    expect(html).not.toContain('Arrêté : Dodo serein');
  });

  it('a gain is printed the same way', () => {
    const d = digestOf();
    const html = body({ ...d, money: { ...d.money, profit: 1980, cashEnd: 2980 } });
    expect(html).toMatch(/Profit<\/div><div class="stat-value txt-good">\+1 980,00 €/);
    expect(html).toMatch(/Trésorerie<\/div><div class="stat-value txt-good">\+2 340,00 €/);
  });

  it('prints the four tiles and every section of ui §6.7', () => {
    const html = body();
    expect(html).toContain('9 → 10');
    expect(html).toContain('Survie → Adéquation');
    for (const title of ['Ce qui a compté', 'Décisions', 'Erreurs', 'Incidents', 'Équipe', 'Produits', 'Canaux', 'À décider', 'La suite']) expect(html).toContain(`<h3>${title}</h3>`);
    expect(html).toContain('Jour 31 : machine éteinte 6 h');
    expect(html).toContain('Arrêté : Siestes faciles. ROAS 0,6 sur 40 € de test');
    expect(html).toContain('Meilleur ROAS boutique : Facebook & Instagram, 2,31×');
    expect(html).toContain('Départ : Tom (Rédacteur) : qualité 68/100');
    expect(html).toContain('Ouvrir les tâches');
  });

  it('a highlight is a button, an empty section is not printed', () => {
    const html = body(digestOf({ mistakes: [], incidents: [], waiting: [] }));
    expect(html).toMatch(/<button[^>]*class="digest-entry"/);
    expect(html).not.toContain('<h3>Erreurs</h3>');
    expect(html).not.toContain('<h3>Incidents</h3>');
    expect(html).not.toContain('À décider');
  });

  it('the modal is a modal: Esc or « Reprendre », no click on the backdrop', () => {
    const html = render(<FounderDigestModal since={null} onClose={noop} />);
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Pendant ton absence');
    expect(html).toContain('Reprendre');
    expect(render(<FounderDigestModal since={40} onClose={noop} />)).toContain('Les 7 derniers jours');
    expect(readFileSync(new URL('./FounderDigest.tsx', import.meta.url), 'utf8')).not.toContain('onMouseDown');
  });
});

describe('when the digest opens', () => {
  const clock = (day: number, lastSeenDay: number | null = 10, runId = 'r1'): DigestClock => ({ runId, day, lastSeenDay });
  const watcher = () => {
    const posts: number[] = [];
    let now = 0;
    const w = digestWatch(() => posts.push(now));
    return { w, posts, at: (ms: number) => (now = ms) };
  };

  it('opens on the first snapshot of a run after 7 unseen days, and only then', () => {
    const { w, posts } = watcher();
    expect(w.snapshot(clock(17), true, 0)).toBe(true);
    expect(posts).toEqual([]); // the founder has not read it: « seen » waits for them to close it
    expect(watcher().w.snapshot(clock(16), true, 0)).toBe(false);
  });

  it('a run he watches never opens it, however fast, and « seen » goes out at most every 30 s', () => {
    const { w, posts, at } = watcher();
    let opened = false;
    let lastSeen = 40;
    for (let t = 0; t <= 120_000; t += 1000) {
      at(t);
      const day = 40 + Math.floor(t / 1000);
      opened = w.snapshot(clock(day, lastSeen), true, t) || opened;
      if (posts.at(-1) === t) lastSeen = day;
    }
    expect(opened).toBe(false);
    expect(posts).toEqual([1000, 31000, 61000, 91000]);
  });

  it('nothing is posted while the tab is hidden, and the return opens it past 7 days', () => {
    const { w, posts, at } = watcher();
    expect(w.snapshot(clock(12, 10), true, 0)).toBe(false);
    expect(posts).toEqual([0]);
    at(100_000);
    w.visibility(clock(12, 12), false);
    expect(w.snapshot(clock(30, 12), false, 100_000)).toBe(false);
    expect(posts).toEqual([0]);
    expect(w.visibility(clock(30, 12), true)).toBe(true);
  });

  it('a tab hidden for a moment owes nothing, however old the last post is', () => {
    const { w } = watcher();
    w.snapshot(clock(50, 50), true, 0);
    w.visibility(clock(58, 50), false); // ×8: eight days since the last post, and the founder was there
    expect(w.visibility(clock(60, 50), true)).toBe(false);
  });

  it('a tab opened in the background waits for him', () => {
    const { w, posts } = watcher();
    expect(w.snapshot(clock(30, 10), false, 0)).toBe(false);
    expect(posts).toEqual([]);
    expect(w.visibility(clock(31, 10), true)).toBe(true);
  });

  it('while he reads, nothing moves his « last seen »; closing it does', () => {
    const { w, posts, at } = watcher();
    expect(w.snapshot(clock(30, 10), true, 0)).toBe(true);
    at(90_000);
    expect(w.snapshot(clock(31, 10), true, 90_000)).toBe(false);
    expect(posts).toEqual([]);
    w.close(90_000);
    expect(posts).toEqual([90_000]);
    expect(w.visibility(clock(31, 10), false)).toBe(false);
    expect(w.visibility(clock(31, 10), true)).toBe(false); // already read, the post only has not come back yet
  });

  it('leaving the page counts what he watched, but never reads a digest for him', () => {
    const { w } = watcher();
    expect(w.leaving()).toBe(false); // nothing seen yet
    w.snapshot(clock(40, 40), true, 0);
    expect(w.leaving()).toBe(true);
    w.open();
    expect(w.leaving()).toBe(false);
    const unread = watcher();
    expect(unread.w.snapshot(clock(30, 10), true, 0)).toBe(true);
    expect(unread.w.leaving()).toBe(false);
  });

  it('reopened by hand, it waits for him the same way', () => {
    const { w, posts, at } = watcher();
    w.snapshot(clock(30, 30), true, 0);
    w.open();
    at(60_000);
    w.snapshot(clock(31, 30), true, 60_000);
    expect(posts).toEqual([]);
    w.close(61_000);
    expect(posts).toEqual([60_000]);
  });

  it('a new run starts over, and a save with no growth owes nothing', () => {
    const { w } = watcher();
    expect(w.snapshot(clock(30, 10), true, 0)).toBe(true);
    expect(w.snapshot(clock(40, 20, 'r2'), true, 0)).toBe(true);
    const legacy = watcher();
    expect(legacy.w.snapshot(clock(300, null), true, 0)).toBe(false);
    expect(legacy.posts).toEqual([]);
  });

  it('a return on an old snapshot spends nothing: the first fresh one opens it, and « seen » waits for that one', () => {
    const { w, posts } = watcher();
    w.snapshot(clock(10), true, 0);
    w.visibility(clock(10), false);
    expect(w.visibility(clock(10), true)).toBe(false); // the tab got nothing while hidden: it still reads day 10
    expect(w.snapshot(clock(40), true, 100_000)).toBe(true);
    expect(posts).toEqual([]);
  });

  it('the old snapshot read again after a return posts nothing either', () => {
    const { w, posts } = watcher();
    w.snapshot(clock(11, 10), true, 0);
    posts.length = 0;
    w.visibility(clock(11, 10), false);
    w.visibility(clock(11, 10), true);
    expect(w.snapshot(clock(11, 10), true, 100_000)).toBe(false);
    expect(posts).toEqual([]);
    expect(w.snapshot(clock(40, 10), true, 100_000)).toBe(true);
    expect(posts).toEqual([]);
  });

  it('a stream that died under a visible tab builds the gap the same way', () => {
    const { w, posts } = watcher();
    w.snapshot(clock(11, 10), true, 0);
    posts.length = 0;
    expect(w.snapshot(clock(11, 10), true, 1000, false)).toBe(false);  // the stream drops
    expect(w.snapshot(clock(11, 10), true, 3_600_000)).toBe(false);    // back up: the page reads its old snapshot once more
    expect(posts).toEqual([]);
    expect(w.leaving()).toBe(false);
    expect(w.snapshot(clock(40, 10), true, 3_600_500)).toBe(true);
    expect(posts).toEqual([]);
  });

  it('nothing opens and nothing is posted while the stream is down', () => {
    const { w, posts } = watcher();
    w.snapshot(clock(11, 10), true, 0);
    posts.length = 0;
    expect(w.snapshot(clock(40, 10), true, 100_000, false)).toBe(false);
    expect(posts).toEqual([]);
  });

  it('a stream that drops and comes back with no day lost: « seen » follows him again on the next day', () => {
    const { w, posts, at } = watcher();
    w.snapshot(clock(11, 10), true, 0);
    posts.length = 0;
    w.snapshot(clock(11, 10), true, 1000, false);
    at(100_000);
    expect(w.snapshot(clock(12, 10), true, 100_000)).toBe(false);
    expect(posts).toEqual([100_000]);
    expect(w.leaving()).toBe(true);
  });

  it('after a return, leaving the page reads nothing for him until a fresh day has shown', () => {
    const { w, posts, at } = watcher();
    w.snapshot(clock(10), true, 0);
    w.visibility(clock(10), false);
    w.visibility(clock(10), true);
    expect(w.leaving()).toBe(false);
    at(100_000);
    expect(w.snapshot(clock(11), true, 100_000)).toBe(false);
    expect(w.leaving()).toBe(true);
    expect(posts).toEqual([100_000]); // the day moved: the founder is back, and « seen » follows them again
  });
});

describe('stage badge', () => {
  const stage = (): StageView => mockSnapshot().scene!.stage;

  it('says the stage and the next one to a screen reader', () => {
    expect(stageAria(stage())).toBe('Palier 2 sur 4 : Adéquation. Prochain palier : Accélération.');
    expect(stageAria({ ...stage(), gate: null })).toBe('Palier 2 sur 4 : Adéquation. Prochain palier : Accélération.');
    expect(stageAria({ ...stage(), level: 3, id: 'portefeuille', name: 'Portefeuille', gate: null })).toBe('Palier 4 sur 4 : Portefeuille. Dernier palier.');
  });

  it('replaces the red pill: four pips, a keyboard button, and its popover on demand', () => {
    const html = render(<CompanyBadge connection="live" lastError={null} onRetry={noop} />);
    expect(html).not.toContain('AGENCE PDF');
    expect(html).toContain('Palier 2/4 · Adéquation');
    expect(html.match(/class="stage-pip[ "]/g)).toHaveLength(4);
    expect(html.match(/class="stage-pip is-on"/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*aria-label="Palier 2 sur 4 : Adéquation\. Prochain palier : Accélération\."/);
    expect(html).toContain('aria-expanded="false"');
  });

  it('StageBadge does not pull the Effectif chunk into the main one', () => {
    expect(readFileSync(new URL('./StageBadge.tsx', import.meta.url), 'utf8')).not.toMatch(/^import [^(]*EffectifTab/m);
    expect(render(<StageBadge />, { snapshot: { ...mockSnapshot(), scene: undefined } })).toBe('');
  });
});

describe('HUD', () => {
  const badge = (s: CompanySnapshot) => text(render(<CompanyBadge connection="live" lastError={null} onRetry={noop} />, { snapshot: s }));
  const hud = (s: CompanySnapshot, onDigest?: () => void) => text(render(<SimHud sim={sessionView(s, 1)} onControl={noop} busy={false} onDigest={onDigest} />, { snapshot: s }));

  it('∞ instead of the horizon on a run without an end', () => {
    expect(badge(withScenario({ openEnded: true }))).toContain('· ∞');
    expect(badge(withScenario({ openEnded: true }))).not.toContain('60 j');
    expect(badge(withScenario({ openEnded: false }))).toContain('· 60 j');
  });

  it('« au ralenti » only when nobody watches', () => {
    expect(hud({ ...mockSnapshot(), session: sess({ pace: 'away' }) })).toContain('au ralenti : personne ne regarde');
    expect(hud({ ...mockSnapshot(), session: sess({ pace: 'live' }) })).not.toContain('au ralenti');
  });

  it('one chip for headcount, payroll and revenue per head', () => {
    const s = mockSnapshot();
    expect(hud({ ...s, scene: { ...s.scene!, team: { headcount: 12, payroll30d: 168.4, revenuePerHead30d: 23.2 } } })).toContain('12 agents · 168 €/mois · 23 €/tête');
    expect(hud({ ...s, scene: undefined })).not.toContain('/tête');
  });

  it('« Résumé » reopens the digest, and takes nothing from the speed group', () => {
    expect(hud(mockSnapshot(), noop)).toContain('Résumé');
    expect(hud(mockSnapshot())).not.toContain('Résumé');
  });
});

describe('the card reads what the world holds (T3, T4)', () => {
  const card = (patch: Partial<AgentState>) => {
    const s = mockSnapshot();
    const a = { ...s.company.agents[1]!, level: 10, xp: 12000, hiredDay: 12, ...patch };
    return text(render(<FicheTab agent={a} />, { snapshot: { ...s, day: 60, company: { ...s.company, agents: s.company.agents.map((x) => (x.id === a.id ? a : x)) } }, demo: true }));
  };
  const prior = { done: 9, approved: 0, rejected: 0, failed: 0, score: 70 };

  it('seniority and the league, never an xp counter read as merit', () => {
    const page = card({ perf: prior });
    expect(page).toContain('Ancienneté 48 jours');
    expect(page).not.toMatch(/Niveau \d|\bxp\b/);
    expect(page).toMatch(/Ligue : \d+\/\d+, note|Pas classé en ligue/);
  });

  it('a score that is only its prior is not a score', () => {
    const page = card({ perf: prior });
    expect(page).toContain('pas encore noté');
    expect(page).not.toContain('score /100');
    expect(page).not.toContain('<strong>70</strong>');
    for (const perf of [{ ...prior, approved: 2, score: 84 }, { ...prior, rejected: 1, score: 40 }, { ...prior, failed: 1, score: 63 }]) {
      const noted = card({ perf });
      expect(noted).toContain('score /100');
      expect(noted).not.toContain('pas encore noté');
    }
  });
});

describe('end of a run', () => {
  const banner = (s: CompanySnapshot, onExtend?: () => void) => text(render(<EndBanner onNewScenario={noop} onDismiss={noop} onFinance={noop} onExtend={onExtend} />, { snapshot: s }));

  it('a finished run offers to go on', () => {
    expect(banner({ ...mockSnapshot(), status: 'finished' }, noop)).toContain('Continuer sans fin');
    expect(banner({ ...mockSnapshot(), status: 'finished' })).not.toContain('Continuer sans fin');
    expect(banner({ ...mockSnapshot(), status: 'bankrupt' }, noop)).not.toContain('Continuer sans fin');
  });

  it('a run that ends below zero says bankruptcy, not end of simulation, and may still go on', () => {
    const base = mockSnapshot();
    const page = banner({ ...base, status: 'finished', finance: { ...base.finance!, bankrupt: true } }, noop);
    expect(page).toContain('Faillite');
    expect(page).toContain('sur une trésorerie négative');
    expect(page).not.toContain('Fin de la simulation');
    expect(page).toContain('Continuer sans fin');
    expect(banner({ ...base, status: 'finished', finance: { ...base.finance!, bankrupt: false } })).toContain('Fin de la simulation');
  });

  it('a goal reached on a run without an end assumes no end', () => {
    const open = banner({ ...withScenario({ openEnded: true }), status: 'goal_reached' });
    expect(open).toContain('continue de tourner, sans fin');
    expect(open).not.toContain('fin de la simulation');
  });
});

describe('scenario form', () => {
  const html = (s = mockSnapshot()) => text(render(<ScenarioModal onClose={noop} onLoaded={noop} />, { snapshot: s }));

  it('« Sans fin » is on by default, whatever the run on screen did', () => {
    const page = html(withScenario({ openEnded: false }));
    expect(page).toMatch(/<input type="checkbox" checked=""\/><span class="toggle-ui"><\/span><span><strong>Sans fin/);
    expect(page).toContain('l’horizon ne sert qu’à situer l’objectif');
  });

  it('a select on scenario.talent: ligue, sans conséquence, désactivée', () => {
    const page = html();
    expect(page).toContain('Compétition');
    expect(page).toMatch(/<option value="league" selected="">Ligue<\/option>/);
    expect(page).toContain('<option value="flat">Sans conséquence</option>');
    expect(page).toContain('<option value="off">Désactivée</option>');
    expect(html(withScenario({ talent: 'flat' }))).toMatch(/<option value="flat" selected="">/);
  });
});

describe('calendar', () => {
  it('a run without an end has no assumed horizon', () => {
    const page = text(render(<CalendarTab onClose={noop} />, { snapshot: withScenario({ openEnded: true }) }));
    expect(page).not.toMatch(/Jour \d+ sur \d+/);
    expect(text(render(<CalendarTab onClose={noop} />, { snapshot: withScenario({ openEnded: false }) }))).toMatch(/Jour \d+ sur 60/);
  });

  it('it always shows the coming week, then whole weeks from a Monday, six months at most', () => {
    const open = { horizonDays: 60, openEnded: true, goal: { targetProfit: 1000, byDay: 1 } };
    expect(calendarSpan(3, open)).toEqual({ from: 1, to: 14, end: null });
    expect(calendarSpan(3, { ...open, goal: { targetProfit: 1000, byDay: 60 } }).to).toBe(63);
    const late = calendarSpan(400, open);
    expect(late.to).toBeGreaterThanOrEqual(407);
    expect((late.from - 1) % 7).toBe(0);
    expect(late.to - late.from + 1).toBeLessThanOrEqual(28 * 7);
    expect(late.from).toBeLessThanOrEqual(400);
  });

  it('a run with an end keeps its grid', () => {
    const goal = { targetProfit: 1000, byDay: 60 };
    expect(calendarSpan(9, { horizonDays: 60, goal })).toEqual({ from: 1, to: 63, end: 60 });
    expect(calendarSpan(70, { horizonDays: 60, goal })).toEqual({ from: 1, to: 70, end: 70 });
  });
});

describe('chronicle toasts', () => {
  const fresh = (): ChronicleSeen => ({ runId: null, keys: new Set() });

  it('the first snapshot of a run toasts nothing, a reload neither', () => {
    const st = fresh();
    expect(takeToasts(st, 'r1', [entry('a', 'hire')])).toEqual([]);
    expect(takeToasts(st, 'r1', [entry('a', 'hire')])).toEqual([]);
  });

  it('a new key toasts exactly once, across two snapshots', () => {
    const st = fresh();
    takeToasts(st, 'r1', []);
    const hire = entry('a', 'hire');
    expect(takeToasts(st, 'r1', [hire])).toEqual([hire]);
    expect(takeToasts(st, 'r1', [hire])).toEqual([]);
  });

  it('a run loaded later starts over: its past is not news', () => {
    const st = fresh();
    takeToasts(st, 'r1', []);
    expect(takeToasts(st, 'r2', [entry('b', 'fire')])).toEqual([]);
  });

  it('an old line that comes back into the window is not news', () => {
    const st = fresh();
    const old = entry('old', 'hire');
    const others = Array.from({ length: 23 }, (_, i) => entry(`k${i}`, 'hire'));
    takeToasts(st, 'r1', [old, ...others]);
    takeToasts(st, 'r1', [...others, entry('plan', 'probation')]); // a plan opens: the oldest line slides out
    expect(takeToasts(st, 'r1', [old, ...others])).toEqual([]);    // it closes, the chronicle shrinks: that line is back
  });

  it('what it remembers is bounded, the newest kept, and a run loaded later drops it', () => {
    const st = fresh();
    const old = entry('old', 'hire');
    takeToasts(st, 'r1', [old]);
    takeToasts(st, 'r1', Array.from({ length: 499 }, (_, i) => entry(`k${i}`, 'hire')));
    expect(takeToasts(st, 'r1', [old])).toEqual([]); // 500 keys: still known
    takeToasts(st, 'r1', [entry('past-the-cap', 'hire')]);
    expect(st.keys.size).toBe(500);
    expect(st.keys.has('old')).toBe(false);
    expect(st.keys.has('past-the-cap')).toBe(true);
    takeToasts(st, 'r2', [entry('other-run', 'fire')]);
    expect(st.keys).toEqual(new Set(['other-run']));
  });

  it('only the six kinds that matter to him', () => {
    const st = fresh();
    takeToasts(st, 'r1', []);
    const worthy = (['hire', 'fire', 'layoff', 'season_end', 'channel_open', 'dept_open', 'stage_up'] as const).map((k) => entry(k, k));
    const quiet = (['req_open', 'duel_open', 'probation', 'stage_down', 'promote'] as const).map((k) => entry(k, k));
    expect(takeToasts(st, 'r1', [...quiet, ...worthy]).map((e) => e.kind)).toEqual(worthy.map((e) => e.kind));
  });

  it('one toast per entry with « Voir », over 3 a single summary', () => {
    const three = chronicleToasts([entry('a', 'hire'), entry('b', 'fire', { why: 'Qualité 68/100' }), entry('c', 'season_end')], noop);
    expect(three.map((t) => t.title)).toEqual(['Ligne a', 'Ligne b', 'Ligne c']);
    expect(three[1]).toMatchObject({ tone: 'warn', text: 'Qualité 68/100', action: { label: 'Voir' } });
    const four = chronicleToasts([entry('a', 'hire'), entry('b', 'hire'), entry('c', 'fire'), entry('d', 'channel_open')], noop);
    expect(four).toHaveLength(1);
    expect(four[0]!.title).toBe('4 événements dans l’agence');
    expect(four[0]!.text).toBe('2 arrivées, 1 départ, 1 canal ouvert');
  });

  it('« Voir » leads where the story is told, a leaver to the card', () => {
    expect(entryTarget(entry('a', 'fire', { agentId: 'tom' }))).toEqual({ agent: 'tom' });
    expect(entryTarget(entry('b', 'channel_open', { channel: 'meta' }))).toEqual({ tab: 'canaux' });
    expect(entryTarget(entry('c', 'stage_up'))).toEqual({ tab: 'croissance' });
    expect(entryTarget(entry('d', 'season_end', { agentId: 'tom' }))).toEqual({ tab: 'competition' });
    expect(entryTarget(entry('e', 'dept_open', { dept: 'video' }))).toEqual({ dept: 'video' });
    expect(entryTarget(entry('f', 'req_open', { agentId: 'tom' }))).toEqual({ tab: 'effectif' });
  });

  it('the live region reads the last hire, departure or end of season', () => {
    expect(lastAnnounced([entry('a', 'hire'), entry('b', 'fire'), entry('c', 'req_open')])).toBe('Ligne b');
    expect(lastAnnounced([entry('c', 'req_open')])).toBe('');
    expect(lastAnnounced(undefined)).toBe('');
  });

  it('the canvas has its text equivalent', () => {
    expect(readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')).toMatch(/role="status" aria-live="polite" className="sr-only"/);
    expect(readFileSync(new URL('./shell.css', import.meta.url), 'utf8')).toMatch(/\.sr-only \{/);
  });
});

describe('agent card', () => {
  const agentOf = (s: CompanySnapshot): AgentState => s.company.agents[0]!;
  const chip: PersonChip = { rating: 1612, rank: 2, of: 5, delta7d: 14, contract: 'probation', badge: 'probation' };
  const league = (): LeagueDetail => mockDetail('/api/league') as LeagueDetail;

  it('no hash skills: plain chips, no mastery bar', () => {
    const s = mockSnapshot();
    const a = agentOf(s);
    const page = text(render(<FicheTab agent={a} />, { snapshot: s, demo: true }));
    expect(page).not.toContain('skill-val');
    expect(page).not.toContain('skill-row');
    for (const skill of a.skills) expect(page).toContain(`<span class="chip">${skill}</span>`);
    expect(readFileSync(new URL('./AgentPanel.tsx', import.meta.url), 'utf8')).not.toMatch(/\bhash\(/);
  });

  it('Carrière prints what the league observed: note, rank, status, plan, coach, titles', () => {
    const s = mockSnapshot();
    const a = agentOf(s);
    const coach = s.company.agents[1]!;
    const base = league();
    const data: LeagueDetail = {
      ...base,
      plans: [{ agentId: a.id, skill: 'copy', openedSeason: 2, deadlineDay: 22, metricLabel: 'Qualité', baseline: 71, target: 74, coachId: coach.id, text: 'Plan d’amélioration en 14 jours.', outcome: 'open' }],
      hallOfFame: [{ season: 1, champion: { id: a.id, name: a.name, role: a.role, dept: a.dept, avatar: a.avatar }, score: 88, still: true, second: null, third: null }],
      alumni: [{ ...base.alumni[0]!, replacedBy: { id: a.id, name: a.name } }],
      lastHire: { ...base.lastHire!, candidates: [{ id: a.id, name: a.name, isIncumbent: false, lineage: coach.id, score: 80, deliverable: 'x' }] },
    };
    const head = { agentId: a.id, pay30d: 36 } as HeadRow;
    const page = text(render(<CareerBody agent={a} chip={chip} league={data} head={head} />, { snapshot: s }));
    expect(page).toContain('1 612');
    expect(page).toContain('+14 en 7 j');
    expect(page).toContain('2/5');
    expect(page).toContain('Plan d’amélioration en 14 jours.');
    expect(page).toContain(`Coach : ${coach.name}`);
    expect(page).toContain('Titres : saison 1');
    expect(page).toContain(`Élève de ${coach.name}`);
    expect(page).toContain(`Avant, à ce poste : `);
    expect(page).toContain(base.alumni[0]!.person.name);
    expect(page).toContain('36 €');
  });

  it('someone outside the league is told so, and nothing is invented', () => {
    const s = mockSnapshot();
    const page = text(render(<CareerBody agent={agentOf(s)} chip={null} league={null} head={null} />, { snapshot: s }));
    expect(page).toContain('Hors ligue');
    expect(page).not.toMatch(/Coach|Élève de|Titres/);
    const told = { ...(mockDetail('/api/league') as LeagueDetail), roles: [], outside: [{ agentId: agentOf(s).id, name: agentOf(s).name, why: 'Pas encore noté : aucun résultat à lire en guides' }] };
    const unrated = text(render(<CareerBody agent={agentOf(s)} chip={null} league={told} head={null} />, { snapshot: s }));
    expect(unrated).toContain('Pas encore noté : aucun résultat à lire en guides.');
    expect(unrated).not.toContain('Hors ligue');
  });

  it('never prints a true talent: the card reads the league without god mode', () => {
    const src = readFileSync(new URL('./AgentPanel.tsx', import.meta.url), 'utf8');
    expect(src).not.toContain('god=1');
    expect(src).not.toMatch(/\.god\b|TalentTruthView/);
  });

  it('an agent who left reads from the alumni instead of « n’existe pas »', () => {
    const s = mockSnapshot();
    const who = league().alumni[0]!;
    const page = text(render(<AgentPanel agentId={who.person.id} backDept={null} onBack={noop} onClose={noop} />, { snapshot: s, demo: true }));
    expect(page).toContain(who.why);
    expect(page).toContain(who.person.name);
    expect(page).not.toContain('n’existe pas');
  });

  it('the card of someone who left says why, what they cost, and who took over', () => {
    const who: AlumnusView = { ...league().alumni[0]!, why: 'Qualité 68/100 pour 74/100.', bestRating: 1488, titles: 1, tasksDone: 14, cost: 48.2, replacedBy: { id: 'yanis', name: 'Yanis' } };
    const page = text(render(<AlumnusCard who={who} />));
    expect(page).toContain('Qualité 68/100 pour 74/100.');
    expect(page).toContain('1 488');
    expect(page).toContain('48 €');
    expect(page).toContain('Yanis');
  });

  it('a name nothing knows still says so', () => {
    const page = text(render(<AgentPanel agentId="personne" backDept={null} onBack={noop} onClose={noop} />, { demo: true }));
    expect(page).toContain('n’existe pas');
  });

  it('the playbook comes from its route: the stream does not carry it', () => {
    expect(readFileSync(new URL('./AgentPanel.tsx', import.meta.url), 'utf8')).toContain('/api/playbook?agentId=');
  });
});

describe('a task signed by someone who left', () => {
  const signed = (): CompanySnapshot => {
    const s = mockSnapshot();
    const t = { ...s.company.tasks[0]!, status: 'done', dept: 'finance', assignee: 'parti-1', dayCreated: 3, dayDone: 3, attempts: 1 } as Task;
    return { ...s, day: 3, phase: 'work', company: { ...s.company, tasks: [t] }, scene: { ...s.scene!, names: { 'parti-1': 'Noa' } } };
  };

  it('agentName reads scene.names', () => {
    expect(agentName(buildLookups(signed()), 'parti-1')).toBe('Noa');
  });

  it('the calendar prints the name, not the id', () => {
    const page = render(<CalendarTab onClose={noop} />, { snapshot: signed() });
    expect(page).toContain('>Noa</button>');
    expect(page).not.toContain('parti-1');
  });

  it('the team panel prints the name, not « non assignée »', () => {
    const s = signed();
    const page = render(<DeptTasks tasks={s.company.tasks} />, { snapshot: s });
    expect(page).toContain('>Noa</button>');
    expect(page).not.toContain('non assignée');
  });

  it('the journal prints the name, and the line opens the card', () => {
    const s = signed();
    const line = { ...s.activity[0]!, id: 'a1', kind: 'task_done', agentId: 'parti-1', text: 'Rapport rendu' } as Activity;
    const page = render(<ActivityFeed />, { snapshot: s, activity: [line] });
    expect(page).toContain('Noa');
    expect(page).toContain('title="Voir Noa"');
  });
});

describe('journal: Équipe', () => {
  const s = mockSnapshot();
  const l = buildLookups(s);
  const line = (text: string, kind: Activity['kind'] = 'meeting'): Activity => ({ ...s.activity[0]!, id: 'x', kind, text });
  const [a, b] = s.company.agents;

  it('is a filter of the journal', () => {
    expect(render(<ActivityFeed />)).toContain('Équipe');
  });

  it('keeps kind org, and what the chronicle holds told at a meeting', () => {
    expect(teamLine(line('Nora valide le recrutement.', 'org'), [], l)).toBe(true);
    const plan = entry('plan:x:1', 'probation', { text: 'Tom entre en plan d’amélioration', why: 'Plan d’amélioration de Tom : qualité 71/100.' });
    expect(teamLine(line('Nora : Plan d’amélioration de Tom : qualité 71/100.'), [plan], l)).toBe(true);
    expect(teamLine(line('Nora : saison 3 close, Tom en tête : 1 plan(s) ouvert(s).'), [entry('season:3', 'season_end', { numbers: { season: 3 } })], l)).toBe(true);
    const duel = entry('duel:1:open', 'duel_open', { agentId: a!.id, otherId: b!.id });
    expect(teamLine(line(`Léo : ${a!.name} bat ${b!.name} : CTR 3 % contre 2 %.`, 'review'), [duel], l)).toBe(true);
  });

  it('leaves the rest of the meetings out', () => {
    expect(teamLine(line('Nora : point du matin, rien à signaler.'), [entry('season:3', 'season_end', { numbers: { season: 3 } })], l)).toBe(false);
    expect(teamLine(line(`Léo : ${a!.name} lance la campagne.`, 'review'), [entry('duel:1:open', 'duel_open', { agentId: a!.id, otherId: b!.id })], l)).toBe(false);
  });
});

describe('team panel', () => {
  it('`Postes : 5 occupés / 6`', () => {
    expect(seatsLine(5, 1)).toBe('Postes : 5 occupés / 6 · 1 poste ouvert');
    expect(seatsLine(1, 0)).toBe('Postes : 1 occupé / 1');
    expect(seatsLine(2, 3)).toBe('Postes : 2 occupés / 5 · 3 postes ouverts');
  });

  it('reads the open seats of the scene', () => {
    const s = mockSnapshot();
    const held = s.company.agents.filter((a) => a.dept === 'growth').length;
    const page = render(<DeptPanel deptId="growth" onClose={noop} />, { snapshot: { ...s, scene: { ...s.scene!, openSeats: { growth: 2 } } } });
    expect(page).toContain(`Postes : ${held} occupé${held > 1 ? 's' : ''} / ${held + 2}`);
  });

  it('a closed department says who carries its work', () => {
    const s = mockSnapshot();
    const closed = s.scene!.closedDepts[0]!;
    const page = text(render(<DeptPanel deptId={closed.id} onClose={noop} />, { snapshot: s, demo: true }));
    const hosted = (mockDetail('/api/org') as OrgDetail).closed.find((c) => c.id === closed.id);
    expect(page).toContain('ÉQUIPE FERMÉE');
    if (hosted?.hostedBy) expect(page).toContain('porte son travail');
    else expect(page).toContain('elle ouvrira avec sa première embauche');
  });
});

describe('minimap', () => {
  it('has a cell for l’Accueil, away from every island', () => {
    const page = text(render(<Minimap snapshot={mockSnapshot()} selectedDept={null} onPick={noop} onOverview={noop} onAccueil={noop} />));
    expect(page).toContain('aria-label="L’Accueil : ouvrir l’Effectif"');
    const s = mockSnapshot();
    expect(s.company.departments.some((d) => d.grid?.col === PIER_CELL.col && d.grid?.row === PIER_CELL.row)).toBe(false);
  });
});
