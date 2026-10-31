// Effectif, Compétition, the top bar and the data hook behind them (ui §6.1 to §6.4, §8).
// Run: cd server && npx vitest run --root ../web/src
import { readFileSync } from 'node:fs';
import { createRef, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AvatarSpec, CompanySnapshot, HireReport, LeagueDetail, OrgDetail } from '../../../shared/types';
import { mockSnapshot } from '../world/mockSnapshot';
import { AppContext, type AppCtx } from './context';
import { avatarRects, PixelAvatar } from './icons';
import { agentName, buildLookups, DEFAULT_DEPTS, DEPT_ORDER, deptOrder, placeTab, ROLE_LABEL, TABS, type TabId } from './labels';
import { CompetitionBody, CompetitionTab, spearman } from './tabs/CompetitionTab';
import { EffectifBody, EffectifTab, gateFill, StageMeter } from './tabs/EffectifTab';
import { menuTarget, TopBar } from './TopBar';
import { detailLoader, mockDetail, type DetailState } from './useDetail';

const noop = () => undefined;

function render(el: ReactElement, opts: { god?: boolean; demo?: boolean; snapshot?: CompanySnapshot } = {}): string {
  const s = opts.snapshot ?? mockSnapshot();
  const ctx: AppCtx = {
    snapshot: s, lookups: buildLookups(s), activity: [], demo: opts.demo ?? false, godMode: opts.god ?? false, runId: s.runId,
    toast: noop, openAgent: noop, openDept: noop, openProduct: noop, centerAgent: noop, centerDept: noop, setTab: noop, openBrainNote: noop, refresh: noop,
  };
  return renderToStaticMarkup(<AppContext.Provider value={ctx}>{el}</AppContext.Provider>);
}

const org = (): OrgDetail => mockDetail('/api/org') as OrgDetail;
const league = (god = false): LeagueDetail => mockDetail(god ? '/api/league?god=1' : '/api/league') as LeagueDetail;
const count = (html: string, needle: string) => html.split(needle).length - 1;

/** Text as a reader gets it: the markup escapes apostrophes and splits nothing else. */
const unescape = (html: string) => html.replace(/&#x27;/g, '\'').replace(/&amp;/g, '&');

describe('top bar', () => {
  const bar = (tab: TabId = 'bureau', snapshot?: CompanySnapshot) => render(
    <TopBar tab={tab} onTab={noop} flowMode={false} onFlow={noop} godMode={false} onGod={noop} onNewScenario={noop} searchRef={createRef()} />, { snapshot },
  );

  it('has ten tabs plus « Plus », and the four others for the phone grid only', () => {
    const html = bar();
    const tabs = html.match(/<button[^>]*class="tab[ "][^>]*>/g) ?? [];
    const phone = tabs.filter((b) => b.includes('tab-phone'));
    const more = tabs.filter((b) => b.includes('more-btn'));
    expect(more).toHaveLength(1);
    expect(more[0]).toContain('aria-haspopup="menu"');
    expect(phone).toHaveLength(4);
    expect(tabs.length - phone.length - more.length).toBe(10);
  });

  it('all 14 keys are unique, and no tab takes the digest key', () => {
    expect(TABS).toHaveLength(14);
    expect(new Set(TABS.map((t) => t.key)).size).toBe(14);
    expect(TABS.map((t) => t.key)).not.toContain('d');
    expect(TABS.filter((t) => t.more).map((t) => t.id)).toEqual(['mail', 'calendrier', 'cerveau', 'apprentissage']);
  });

  it('« Plus » carries the mail count and lights up on a tab it holds', () => {
    const s = mockSnapshot();
    const open = s.market.inbox.filter((m) => m.status === 'open' || m.status === 'escalated').length;
    expect(open).toBeGreaterThan(0);
    const more = (html: string) => html.match(/<button[^>]*more-btn.*?<\/button>/)?.[0] ?? '';
    expect(more(bar('bureau', s))).toContain(`>${open}</span>`);
    expect(more(bar('bureau', s))).not.toContain('tab-active');
    expect(more(bar('mail', s))).toContain('tab-active');
  });

  it('arrow keys wrap inside the menu, other keys do not move it', () => {
    expect(menuTarget('ArrowDown', 3, 4)).toBe(0);
    expect(menuTarget('ArrowUp', 0, 4)).toBe(3);
    expect(menuTarget('Home', 2, 4)).toBe(0);
    expect(menuTarget('End', 0, 4)).toBe(3);
    expect(menuTarget('x', 0, 4)).toBeNull();
  });

  it('App gives every tab a body, and loads the four new ones lazily', () => {
    const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    for (const t of TABS.filter((x) => x.id !== 'bureau')) expect(source, t.id).toContain(`tab === '${t.id}' ?`);
    for (const name of ['CanauxTab', 'CroissanceTab', 'EffectifTab', 'CompetitionTab']) {
      expect(source).toContain(`lazy(() => import('./ui/tabs/${name}')`);
      expect(source).not.toMatch(new RegExp(`^import .*${name}`, 'm'));
    }
  });
});

describe('Effectif', () => {
  it('prints a position’s detail in full and the cost per head', () => {
    const data = org();
    const why = 'Montage : 14 ticks d’attente par jour, la seule monteuse est occupée à 82 % depuis trois jours, et le lancement de jeudi attend ses pubs.';
    data.reqs[0]!.why = why;
    data.costPerHead30d = 17.25;
    const html = render(<EffectifBody data={data} />);
    expect(html).toContain(why);
    expect(html).toContain('Coût par tête');
    expect(html).toContain('17,25');
  });

  it('puts the direction on top and gives every other open department one column', () => {
    const data = org();
    const html = render(<EffectifBody data={data} />);
    const top = html.slice(html.indexOf('class="org-top"'), html.indexOf('class="org-grid"'));
    const ceo = data.depts.find((d) => d.id === 'direction')!.heads.find((h) => h.isChief)!;
    expect(top).toContain(ceo.name);
    expect(count(html, 'class="org-col"')).toBe(data.depts.length - 1);
    const columns = html.match(/class="org-col-head".*?<strong>(.*?)<\/strong>/g) ?? [];
    expect(columns).toHaveLength(data.depts.length - 1);
  });

  it('a head shows its contract, its note, its pay and its hats', () => {
    const data = org();
    const head = data.depts.find((d) => d.heads.length > 1)!.heads[1]!;
    Object.assign(head, { contract: 'probation', rating: 1432, pay30d: 39, hats: ['write_ad_hooks', 'set_price', 'retro', 'fact_check', 'reply_inbox'] });
    const html = render(<EffectifBody data={data} />);
    const card = html.slice(html.indexOf(`Ouvrir la fiche de ${head.name}`)).split('</button>')[0]!;
    expect(card).toContain('Plan d’amélioration');
    expect(card).toContain('note 1');
    expect(card).toContain('39');
    expect(card).toContain('Hooks publicitaires');
    expect(card).toContain('+2');
  });

  it('reads pressure against 12 and 70 %, and the last refusal with its numbers', () => {
    const data = org();
    data.pressure = [{ roleId: 'support_agent', relief: 8.5, ownerUtil: 0.5, days: 1 }];
    const html = render(<EffectifBody data={data} />);
    expect(html).toContain(ROLE_LABEL.support_agent);
    expect(html).toContain('8,5 / 12');
    expect(html).toContain('/ 70');
    const refusal = html.slice(html.indexOf('Dernier refus'));
    expect(refusal).toContain(data.lastRefusal!.text);
    expect(refusal).toContain(data.lastRefusal!.why);
    expect(refusal).toContain('412');
  });

  it('keeps the eight roles that wait the most, and says how many it left out', () => {
    const data = org();
    const roles = ['ceo', 'cfo', 'accountant', 'hr_lead', 'red_teamer', 'data_analyst', 'ghostwriter', 'humanizer', 'fact_checker'] as const;
    data.pressure = roles.map((roleId, i) => ({ roleId, relief: i, ownerUtil: 0.2, days: 0 }));
    const html = render(<EffectifBody data={data} />);
    expect(count(html, 'class="pressure-row"')).toBe(8);
    expect(html).toContain(ROLE_LABEL.fact_checker); // relief 8, the highest
    expect(html).not.toContain(`<strong>${ROLE_LABEL.ceo}</strong>`); // relief 0, the lowest
    expect(html).toContain('1 autre rôle moins pressé');
  });

  it('StageMeter prints the next gate, then says when nothing is left', () => {
    const { stage } = org();
    expect(render(<StageMeter stage={stage} />)).toContain('Palier 2/4 · Adéquation');
    expect(render(<StageMeter stage={stage} />)).toContain(stage.gate!.checks[0]!.label);
    const last = { ...stage, level: stage.total - 1, gate: { next: null, checks: [], weeksHeld: 0, weeksNeeded: 0 } };
    expect(render(<StageMeter stage={last} />)).toContain('Dernier palier');
  });

  it('no gate yet is not the last stage: a Monday away, or a run that follows none', () => {
    const { stage } = org();
    const before = { ...stage, level: 0, gate: null };
    const waiting = renderToStaticMarkup(<StageMeter stage={before} />);
    expect(waiting).toContain('Le premier contrôle du palier a lieu lundi.');
    expect(waiting).not.toContain('Dernier palier');
    const base = mockSnapshot();
    const off = render(<StageMeter stage={before} />, { snapshot: { ...base, scenario: { ...base.scenario, scaling: false } } });
    expect(off).toContain('Cette partie ne suit pas de palier.');
    expect(off).not.toContain('lundi');
  });

  it('a ceiling reads the other way round: full under it, shorter the further past it', () => {
    const ceiling = { label: 'Part du meilleur guide', target: 0.6, lower: true };
    expect(gateFill({ ...ceiling, value: 1, ok: false })).toBeCloseTo(0.6, 6);
    expect(gateFill({ ...ceiling, value: 0.8, ok: false })).toBeCloseTo(0.75, 6);
    expect(gateFill({ ...ceiling, value: 0.3, ok: true })).toBe(1);
    expect(gateFill({ label: 'Profit', value: 30, target: 60, ok: false })).toBeCloseTo(0.5, 6);
    expect(gateFill({ label: 'Profit sur 14 jours', value: 0, target: 0, ok: false })).toBe(0);
    const { stage } = org();
    const page = render(<StageMeter stage={{ ...stage, gate: { next: 'portefeuille', weeksHeld: 0, weeksNeeded: 3, checks: [{ ...ceiling, value: 0.8, ok: false }] } }} />);
    expect(page).toContain('0,8 / max 0,6');
  });
});

describe('the world opens its tabs (ui §4.6)', () => {
  it('each place goes to the tab that tells its story', () => {
    expect(placeTab('quai')).toBe('effectif');
    for (const place of ['ligue', 'podium', 'duel']) expect(placeTab(place)).toBe('competition');
    expect(placeTab('canal:tiktok')).toBe('canaux');
    expect(placeTab('canal:pinterest')).toBe('canaux');
    expect(placeTab('ailleurs')).toBeNull();
  });
  it('App hands the world a way to open them', () => {
    const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/onSelectPlace=\{openPlace\}/);
    expect(source).toMatch(/const target = placeTab\(place\);\s+if \(target\) setTab\(target\);/);
  });
});

describe('Compétition', () => {
  const SENTINEL = 0.7391;
  const withSentinel = () => {
    const data = league(true);
    data.god = Object.fromEntries(Object.keys(data.god!).map((id) => [id, { truth: SENTINEL, note: 'plafond 0,9391' }]));
    return data;
  };

  it('prints the rating and never « Vrai talent » without god mode', () => {
    const data = league();
    const row = data.roles[0]!.rows[0]!;
    row.rating = 1643;
    const html = render(<CompetitionBody data={data} />);
    expect(html).toContain('643');
    expect(html).not.toContain('Vrai talent');
  });

  it('prints « Vrai talent » with god mode, and how far the ranking is from it', () => {
    const data = league(true);
    const html = render(<CompetitionBody data={data} />, { god: true });
    expect(html).toContain('Vrai talent');
    expect(html).toContain('Spearman');
    expect(html).toContain('truth-scatter');
  });

  it('a payload that kept the truth shows nothing once god mode is off', () => {
    const html = render(<CompetitionBody data={withSentinel()} />, { god: false });
    expect(html).not.toContain('Vrai talent');
    expect(html).not.toContain('0,74');
    expect(html).not.toContain('9391');
    expect(html).not.toContain('Spearman');
  });

  it('god mode on a payload without truth adds no column', () => {
    expect(render(<CompetitionBody data={league()} />, { god: true })).not.toContain('Vrai talent');
  });

  it('prints an alumnus’ why in full and the four scores of the last challenge', () => {
    const data = league();
    const why = 'Qualité moyenne 68/100 pour un objectif de 74/100, classement 1 412, coach pendant 14 jours, et deux pubs refusées en deux semaines.';
    data.alumni[0]!.why = why;
    const report: HireReport = {
      day: 7, incumbent: 'x', skill: 'copy', hired: 'b', reason: 'B bat A de 16,0 points.',
      candidates: [
        { id: 'x', name: 'Alpha', isIncumbent: true, lineage: null, score: 72.5, deliverable: 'Ce qu’Alpha a rendu' },
        { id: 'b', name: 'Bravo', isIncumbent: false, lineage: null, score: 88.5, deliverable: 'Ce que Bravo a rendu' },
        { id: 'c', name: 'Charlie', isIncumbent: false, lineage: null, score: 69.5, deliverable: 'Ce que Charlie a rendu' },
        { id: 'd', name: 'Delta', isIncumbent: false, lineage: null, score: 81.5, deliverable: 'Ce que Delta a rendu' },
      ],
    };
    data.lastHire = report;
    data.transfers = [
      { key: 'a', day: 7, kind: 'fire', text: 'Alpha part.', agentId: 'x', numbers: { severance: 5.6 } },
      { key: 'b', day: 7, kind: 'hire', text: 'Bravo arrive.', agentId: 'b', numbers: { recruiting: 3.5 } },
      { key: 'c', day: 7, kind: 'hire', text: 'Quelqu’un d’autre arrive le même jour.', agentId: 'z', numbers: { recruiting: 99 } },
    ];
    const html = render(<CompetitionBody data={data} />);
    expect(html).toContain(why);
    for (const c of report.candidates) {
      expect(html).toContain(`${String(c.score).replace('.', ',')}/100`);
      expect(html).toContain(c.deliverable);
    }
    expect(html).toContain('Bravo prend le poste de Alpha');
    expect(html).toContain('Coût du remplacement');
    expect(html).toContain('9,10');
  });

  it('a challenge the incumbent kept says so, with no cost', () => {
    const data = league();
    data.lastHire = { ...data.lastHire!, hired: null, reason: 'Personne de mieux sur le marché.' };
    const html = render(<CompetitionBody data={data} />);
    expect(html).toContain('reste en poste');
    expect(html).not.toContain('Coût du remplacement');
  });

  it('draws the cut line above the first threatened rank, and flags thin samples', () => {
    const data = league();
    const role = data.roles[0]!;
    const rows = role.rows;
    expect(rows.length).toBeGreaterThan(1);
    role.cutLine = rows[1]!.rank;
    rows[1]!.confidence = 'faible';
    const html = render(<CompetitionBody data={data} />);
    expect(count(html, 'Sous cette ligne, le contrat est menacé')).toBe(1);
    const line = html.indexOf('Sous cette ligne');
    expect(html.indexOf(`Ouvrir la fiche de ${rows[0]!.name}`)).toBeLessThan(line);
    expect(html.indexOf(`Ouvrir la fiche de ${rows[1]!.name}`)).toBeGreaterThan(line);
    expect(html).toContain('peu de données');
    role.cutLine = null;
    expect(render(<CompetitionBody data={data} />)).not.toContain('Sous cette ligne');
  });

  it('names who sits outside the league', () => {
    const data = league();
    const s = mockSnapshot();
    const ranked = new Set(data.roles.flatMap((r) => r.rows.map((x) => x.agentId)));
    const outside = s.company.agents.find((a) => !ranked.has(a.id))!;
    const html = unescape(render(<CompetitionBody data={data} />, { snapshot: s }));
    expect(html).toContain('Hors ligue : poste sans effet mesurable sur un résultat');
    expect(html).toContain(outside.name);
  });

  it('season, rules, form, plan, running duel before the settled one', () => {
    const data = league();
    data.season = { no: 3, fromDay: 12, toDay: 41, daysLeft: 18, rules: ['Une règle lisible.'] };
    const html = render(<CompetitionBody data={data} />);
    expect(html).toContain('Saison 3 · J12 → J41 · 18 jours restants');
    expect(html).toContain('<li>Une règle lisible.</li>');
    expect(count(html, 'form-dot form-')).toBe(data.roles[0]!.rows.reduce((n, r) => n + r.form.length, 0));
    expect(html).toContain(data.plans[0]!.text);
    const [settled, running] = [...data.duels].reverse();
    expect(html.indexOf(running!.label)).toBeLessThan(html.indexOf(settled!.label));
    expect(html).toContain('3,10 %');
  });

  it('settled duels start with the latest, whatever order they came in', () => {
    const data = league();
    const done = data.duels[1]!;
    data.duels = [{ ...done, id: 'old', label: 'Le plus ancien' }, { ...done, id: 'new', label: 'Le plus récent' }];
    const html = render(<CompetitionBody data={data} />);
    expect(html.indexOf('Le plus récent')).toBeLessThan(html.indexOf('Le plus ancien'));
  });

  it('the hall of fame says who is still here and when the others left', () => {
    const data = league();
    const gone = data.alumni[0]!;
    gone.leftDay = 42;
    data.hallOfFame = [
      { season: 1, champion: gone.person, score: 1.2, still: false, second: null, third: null },
      { season: 2, champion: { ...gone.person, id: 'autre', name: 'Autre' }, score: 1.1, still: true, second: gone.person, third: null },
    ];
    const html = render(<CompetitionBody data={data} />);
    expect(html).toContain('parti J42');
    expect(html).toContain('toujours là');
  });

  it('tells an empty league from a broken page', () => {
    const data = league();
    data.roles = [];
    const html = render(<CompetitionBody data={data} />);
    expect(html).toContain('Personne n’est encore classé');
  });
});

describe('spearman', () => {
  it('reads an identical order as 1 and a reversed one as -1', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 9);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 9);
  });
  it('shares ranks on ties and ignores the scale', () => {
    expect(spearman([1, 2, 2, 3], [1, 100, 100, 1000])).toBeCloseTo(1, 9);
    expect(spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBeCloseTo(0.8, 9);
  });
  it('has nothing to say under three points or on a flat series', () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe('demo mode', () => {
  it('both bodies render from mockDetail', () => {
    expect(render(<EffectifBody data={org()} />)).toContain('Organigramme');
    expect(render(<CompetitionBody data={league()} />)).toContain('Classement');
  });

  it('the tabs read mockDetail through the hook, with no server', () => {
    expect(render(<EffectifTab onClose={noop} />, { demo: true })).toContain('Masse salariale 30 j');
    expect(render(<CompetitionTab onClose={noop} />, { demo: true })).toContain('Saison 2');
  });

  it('the league carries no truth without ?god=1', () => {
    const json = JSON.stringify(mockDetail('/api/league'));
    expect(json).not.toContain('"god"');
    expect(json).not.toContain('"truth"');
    expect(Object.keys(league(true).god!).length).toBeGreaterThan(0);
    expect(render(<CompetitionTab onClose={noop} />, { demo: true })).not.toContain('Vrai talent');
    expect(render(<CompetitionTab onClose={noop} />, { demo: true, god: true })).toContain('Vrai talent');
  });

  it('the org view carries no truth at all', () => {
    expect(JSON.stringify(org())).not.toContain('truth');
  });

  it('every agent of the mock shows up, and the numbers add up', () => {
    const data = org();
    const ids = data.depts.flatMap((d) => d.heads.map((h) => h.agentId));
    expect(new Set(ids)).toEqual(new Set(mockSnapshot().company.agents.map((a) => a.id)));
    expect(data.headcount).toBe(ids.length);
  });

  it('an unknown route answers null: the tab says it has nothing', () => {
    expect(mockDetail('/api/nowhere')).toBeNull();
  });

  it('same page every time', () => {
    expect(JSON.stringify(mockDetail('/api/league?god=1'))).toBe(JSON.stringify(mockDetail('/api/league?god=1')));
  });
});

describe('detailLoader', () => {
  /** A fetch answered by hand, in any order. */
  function deferred() {
    const calls: { path: string; resolve(v: string): void; reject(e: Error): void }[] = [];
    const fetcher = (path: string) => new Promise<string>((resolve, reject) => { calls.push({ path, resolve, reject }); });
    let state: DetailState<string> = { data: null, error: null, loading: false };
    const loader = detailLoader<string>(fetcher, (next) => { state = next(state); });
    return { calls, loader, state: () => state };
  }

  it('publishes what the fetch answered', async () => {
    const d = deferred();
    const done = d.loader.load('/a');
    expect(d.state().loading).toBe(true);
    d.calls[0]!.resolve('A');
    await done;
    expect(d.state()).toEqual({ data: 'A', error: null, loading: false });
  });

  it('ignores a stale response arriving after a newer one', async () => {
    const d = deferred();
    const first = d.loader.load('/a');
    const second = d.loader.load('/b');
    d.calls[1]!.resolve('B');
    await second;
    d.calls[0]!.resolve('A');
    await first;
    expect(d.state().data).toBe('B');
  });

  it('ignores a stale error too', async () => {
    const d = deferred();
    const first = d.loader.load('/a');
    const second = d.loader.load('/b');
    d.calls[1]!.resolve('B');
    await second;
    d.calls[0]!.reject(new Error('trop tard'));
    await first;
    expect(d.state()).toEqual({ data: 'B', error: null, loading: false });
  });

  it('keeps the last good data on error, and the next success clears the error', async () => {
    const d = deferred();
    const a = d.loader.load('/a');
    d.calls[0]!.resolve('A');
    await a;
    const b = d.loader.load('/a');
    d.calls[1]!.reject(new Error('Erreur serveur (500)'));
    await b;
    expect(d.state()).toEqual({ data: 'A', error: 'Erreur serveur (500)', loading: false });
    const c = d.loader.load('/a');
    d.calls[2]!.resolve('A2');
    await c;
    expect(d.state()).toEqual({ data: 'A2', error: null, loading: false });
  });

  it('after a cancel nothing is published', async () => {
    const d = deferred();
    const a = d.loader.load('/a');
    d.loader.cancel();
    d.calls[0]!.resolve('A');
    await a;
    expect(d.state().data).toBeNull();
  });
});

describe('people who left', () => {
  it('agentName prints the name kept in scene.names, a raw id only when nothing knows it', () => {
    const s = mockSnapshot();
    const scene = { ...s.scene, names: { ...s.scene?.names, 'parti-1': 'Noa' } } as NonNullable<CompanySnapshot['scene']>;
    const lookups = buildLookups({ ...s, scene });
    expect(agentName(lookups, 'parti-1')).toBe('Noa');
    expect(agentName(lookups, 'inconnu')).toBe('inconnu');
    expect(agentName(lookups, s.company.agents[0]!.id)).toBe(s.company.agents[0]!.name);
  });
});

describe('deptOrder', () => {
  it('keeps a new id after the known ones', () => {
    const ids = deptOrder([{ id: 'nouveau' as never }, { id: 'crm' }, { id: 'direction' }, { id: 'video' }, { id: 'autre' as never }]).map((d) => d.id);
    expect(ids).toEqual(['direction', 'video', 'crm', 'nouveau', 'autre']);
  });
  it('knows all thirteen departments, a new one included', () => {
    expect([...DEPT_ORDER].sort()).toEqual(Object.keys(DEFAULT_DEPTS).sort());
    expect(DEPT_ORDER).toHaveLength(13);
  });
});

describe('PixelAvatar', () => {
  const base: AvatarSpec = { skin: '#111111', hair: '#222222', shirt: '#333333', pants: '#444444', hairStyle: 0, accessory: 'none' };

  it('draws the person’s own colours', () => {
    const html = renderToStaticMarkup(<PixelAvatar avatar={base} />);
    for (const c of [base.skin, base.hair, base.shirt]) expect(html).toContain(c);
  });

  it('tells every hair style and accessory apart', () => {
    const styles = ([0, 1, 2, 3, 4, 5] as const).map((hairStyle) => JSON.stringify(avatarRects({ ...base, hairStyle })));
    expect(new Set(styles).size).toBe(6);
    const looks = (['none', 'glasses', 'cap', 'headphones', 'beard', 'tie'] as const).map((accessory) => JSON.stringify(avatarRects({ ...base, accessory })));
    expect(new Set(looks).size).toBe(6);
  });

  it('a bald head has no hair at all', () => {
    expect(JSON.stringify(avatarRects({ ...base, hairStyle: 4 }))).not.toContain(base.hair);
  });

  it('stays inside its 12 × 12 grid', () => {
    for (const hairStyle of [0, 1, 2, 3, 4, 5] as const) {
      for (const accessory of ['none', 'glasses', 'cap', 'headphones', 'beard', 'tie'] as const) {
        for (const [x, y, w, h] of avatarRects({ ...base, hairStyle, accessory })) {
          expect(x >= 0 && y >= 0 && x + w <= 12 && y + h <= 12).toBe(true);
        }
      }
    }
  });

  it('survives an old save without an avatar', () => {
    expect(renderToStaticMarkup(<PixelAvatar avatar={undefined} />)).toContain('<rect');
  });
});
