// Canaux, Croissance, Publicité: bodies rendered from a fake detail, no server (ui §6.5, §6.8, channels §10, scale §8).
// Run: cd server && npx vitest run --root ../web/src
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../shared/channels';
import type { AdCreative, AudienceView, ChannelNicheState, ChannelPlan, ChannelRow, ChannelsDetail, CompanySnapshot } from '../../../shared/types';
import { mockSnapshot } from '../world/mockSnapshot';
import { AppContext, type AppCtx } from './context';
import { buildLookups } from './labels';
import { accountRows, AdsTab, reviewsOf } from './tabs/AdsTab';
import { budgetShares, CanauxBody, channelStateText, roasTone, shareBands, tiktokDetail } from './tabs/CanauxTab';
import { CroissanceBody, type GrowthDetail } from './tabs/CroissanceTab';
import { FinanceTab } from './tabs/FinanceTab';
import { LearningTab } from './tabs/LearningTab';

const noop = () => undefined;

function render(s: CompanySnapshot | null, el: ReactElement, godMode = false): string {
  const ctx: AppCtx = {
    snapshot: s, lookups: buildLookups(s), activity: s?.activity ?? [], demo: false, godMode, runId: s?.runId ?? 'run',
    toast: noop, openAgent: noop, openDept: noop, openProduct: noop, centerAgent: noop, centerDept: noop, setTab: noop, openBrainNote: noop, refresh: noop,
  };
  return renderToStaticMarkup(<AppContext.Provider value={ctx}>{el}</AppContext.Provider>);
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

function channelRow(id: ChannelRow['id'], o: Partial<ChannelRow> = {}): ChannelRow {
  const { label: name, glyph, color } = CHANNELS[id];
  return {
    id, name, glyph, color, state: 'open', share: 0.5, spend7d: 100, spend30d: 300, budget: 20, budgetCap: 30,
    claimedRevenue7d: 240, shopRevenue7d: 130, reconciledRevenue7d: 160, claimedRoas7d: 2.4, shopRoas7d: 1.3, reconciledRoas7d: 1.6, marginalRoas: 1.2, inflation: 1.8,
    cpm: 6, ctr: 0.02, cvr: 0.015, impressions7d: 16_000, creatives: 3, fatigue: 1.4, strikes: 0, unlock: [], why: '', daily: [],
    ...o,
  };
}

const detail = (rows: ChannelRow[], o: Partial<ChannelsDetail> = {}): ChannelsDetail => ({
  rows, totals: { spend7d: 200, reconciledRevenue7d: 320, reconciledRoas7d: 1.6 }, plan: null, matrix: [], ...o,
});

const rowOf = (html: string, id: string) => html.slice(html.indexOf(`data-channel="${id}"`)).split('</tr>')[0]!;

describe('Canaux: three readings of one ROAS', () => {
  const html = render(null, <CanauxBody data={detail([channelRow('meta')])} />);

  it('prints platform, shop and reconciled together, and marks what the platform inflates', () => {
    const row = rowOf(html, 'meta');
    expect(row).toContain('2,40×');
    expect(row).toContain('1,30×');
    expect(row).toContain('1,60×');
    expect(row).toContain('1,20×'); // the next euro
    expect(row).toContain('gonflé ×1,8');
    expect(html).toMatch(/class="roas-inflated"/);
  });
  it('the reconciled figure is the bold one, and every column says what it reads', () => {
    expect(html).toMatch(/<th class="num roas-key"[^>]*>ROAS réconcilié/);
    expect(html).toMatch(/<th class="num" title="[^"]*tableau de bord[^"]*">ROAS plateforme/);
    expect(html).toMatch(/<th class="num" title="[^"]*dernier clic[^"]*">ROAS boutique/);
  });
  it('a platform that looks great does not make a channel good: the tone follows the reconciled one', () => {
    const row = rowOf(render(null, <CanauxBody data={detail([channelRow('meta', { claimedRoas7d: 4, reconciledRoas7d: 0.9 })])} />), 'meta');
    expect(row).toContain('txt-bad');
    expect(row).not.toContain('txt-good');
    expect(row.slice(row.indexOf('roas-key'))).toContain('0,90×');
  });
  it('a modest platform figure does not sink a channel the reconciliation finds good', () => {
    const row = rowOf(render(null, <CanauxBody data={detail([channelRow('google', { claimedRoas7d: 0.9, shopRoas7d: 0.9, reconciledRoas7d: 1.5, inflation: 1 })])} />), 'google');
    expect(row).toContain('txt-good');
    expect(row).not.toContain('txt-bad');
    expect(row).not.toContain('gonflé');
  });
  it('roasTone reads the reconciled number alone, and nothing yet is no verdict', () => {
    expect(roasTone(1.15)).toBe('txt-good');
    expect(roasTone(1.14)).toBe('txt-bad');
    expect(roasTone(null)).toBe('muted');
  });
  it('no platform number sits alone outside the table', () => {
    const before = html.slice(0, html.indexOf('<table'));
    expect(before).not.toContain('2,40×');
  });
});

describe('Canaux: the five cards', () => {
  const account = (o: object) => ({ strikes: 0, banned: false, bannedUntilDay: 0, openDay: null, ...o });
  const closed = { state: 'closed' as const, unlock: [{ label: 'Ventes', value: 9, target: 15, unit: 'ventes', met: false }, { label: 'ROAS 14 jours', value: 1.2, target: 1, unit: '×', met: true }] };

  it('says what a channel waits for, in words', () => {
    expect(channelStateText(closed, undefined)).toBe('Fermé · ouvre quand 15 ventes');
    expect(channelStateText({ state: 'closed', unlock: [{ label: 'Trésorerie', value: 100, target: 300, unit: '€', met: false }] }, undefined)).toBe('Fermé · ouvre quand trésorerie 300 €');
    expect(channelStateText({ state: 'closed', unlock: [{ label: 'ROAS 14 jours', value: 0.8, target: 1, unit: '×', met: false }] }, undefined)).toBe('Fermé · ouvre quand ROAS 14 jours 1×');
    expect(channelStateText({ state: 'verifying', unlock: [] }, account({ openDay: 12 }))).toBe('Vérification, jour 12');
    expect(channelStateText({ state: 'open', unlock: [] }, undefined)).toBe('Ouvert');
    expect(channelStateText({ state: 'banned', unlock: [] }, account({ banned: true, bannedUntilDay: 40 }))).toBe('Suspendu jusqu’au jour 40');
  });
  it('reads verification and suspension on the account, Google\'s shared by Search and YouTube', () => {
    const base = mockSnapshot();
    const s: CompanySnapshot = { ...base, market: { ...base.market, channelAccounts: { meta: account({ openDay: 12 }), google: account({ banned: true, bannedUntilDay: 40, openDay: 3 }) } } };
    const html = render(s, <CanauxBody data={detail([
      channelRow('tiktok'), channelRow('meta', { state: 'verifying' }), channelRow('youtube', { state: 'banned' }), channelRow('google', { state: 'banned' }), channelRow('pinterest', closed),
    ])} />);
    expect(count(html, 'class="channel-card"')).toBe(5);
    expect(html).toContain('Vérification, jour 12');
    expect(count(html, 'Suspendu jusqu’au jour 40')).toBe(2);
    expect(html).toContain('Fermé · ouvre quand 15 ventes');
    expect(html).toContain('Facebook &amp; Instagram');
  });
  it('prints the budget of the day, the warnings and why', () => {
    const html = render(null, <CanauxBody data={detail([channelRow('meta', { budget: 42, strikes: 2, why: 'Coupé 14 jours : ROAS réconcilié 0,62.' })])} />);
    expect(html).toMatch(/Budget du jour<\/span><strong>42\s€/);
    expect(html).toMatch(/Avertissements<\/span><strong[^>]*>2</);
    expect(html).toContain('Coupé 14 jours : ROAS réconcilié 0,62.');
  });
  it('each condition of a closed channel has its bar, met or not', () => {
    const html = render(null, <CanauxBody data={detail([channelRow('meta', closed)])} />);
    expect(html).toContain('Conditions d’ouverture');
    expect(html).toContain('Ventes 9 / 15');
    expect(html).toContain('ROAS 14 jours 1,20 / 1×');
    expect(count(html.slice(html.indexOf('unlock-grid')), 'bar-fill')).toBe(2);
  });
  it('an open channel has no conditions to print', () => {
    expect(render(null, <CanauxBody data={detail([channelRow('tiktok', { unlock: [] })])} />)).not.toContain('Conditions d’ouverture');
  });
});

describe('Canaux: channel × niche', () => {
  const line = (channel: ChannelNicheState['channel'], o: Partial<ChannelNicheState>): ChannelNicheState => ({ channel, nicheId: 'sommeil-bebe', status: 'untested', since: 1, spend: 0, revenue: 0, reason: null, retestDay: null, ...o });
  const base = mockSnapshot();
  const s: CompanySnapshot = { ...base, day: 8 };
  const html = render(s, <CanauxBody data={detail([channelRow('meta')], { matrix: [
    line('meta', { status: 'testing', since: 5 }),
    line('google', { status: 'proven', spend: 100, revenue: 160 }),
    line('pinterest', { status: 'killed', reason: 'ROAS réconcilié 0,62 pour 90 €', retestDay: 22 }),
    line('youtube', { status: 'blocked', reason: 'Image du corps : refusée deux fois' }),
    line('tiktok', { status: 'untested' }),
  ] })} />);

  it('every status reads in words, with its numbers', () => {
    expect(html).toContain('En test (J3/5)');
    expect(html).toContain('Rentable (1,60×)');
    expect(html).toContain('À tester');
  });
  it('a cut line and a blocked one keep their reason in a cell that takes the focus', () => {
    const cut = html.slice(html.lastIndexOf('<td', html.indexOf('Coupé')));
    expect(cut.slice(0, cut.indexOf('</td>'))).toMatch(/tabindex="0"/);
    expect(cut.slice(0, cut.indexOf('</td>'))).toContain('ROAS réconcilié 0,62 pour 90 € · nouveau test J22');
    expect(html).toContain('Image du corps : refusée deux fois');
    expect(readFileSync(new URL('./tabs/market.css', import.meta.url), 'utf8')).toMatch(/\.matrix-cell:focus \.matrix-why/);
  });
  it('no test yet says so', () => {
    expect(render(null, <CanauxBody data={detail([channelRow('tiktok')])} />)).toContain('Pas encore de test');
  });
});

describe('Canaux: the CFO and the money', () => {
  const plan = (o: Partial<ChannelPlan> = {}): ChannelPlan => ({
    day: 31, envelope: 150, testEnvelope: 30, lambda: 1.35, unspent: 0,
    lines: [{ channel: 'meta', productId: 'prd_1', campaignIds: ['cmp_1'], budget: 40, target: 52, average: 1.9, marginal: 1.62, elasticity: 0.8, days: 8, note: 'Meta sommeil : 40 € → 52 €/jour' }],
    ...o,
  });

  it('prints the moves and λ', () => {
    const html = render(mockSnapshot(), <CanauxBody data={detail([channelRow('meta')], { plan: plan() })} />);
    expect(html).toContain('Meta sommeil : 40 € → 52 €/jour');
    expect(html).toContain('1,35×');
    expect(html).not.toContain('non dépensés');
    const bare = plan();
    bare.lines = bare.lines.map((l) => ({ ...l, note: '' }));
    expect(render(mockSnapshot(), <CanauxBody data={detail([channelRow('meta')], { plan: bare })} />)).toMatch(/Dodo serein : 40\s€ → 52\s€\/jour/);
  });
  it('money nobody earned is said as such', () => {
    const html = render(null, <CanauxBody data={detail([channelRow('meta')], { plan: plan({ unspent: 38 }) })} />);
    expect(html).toMatch(/38\s€ non dépensés : aucun canal ne rapporte son euro suivant/);
  });
  it('budgetShares sums to 1 and survives a day with nothing spent', () => {
    expect(budgetShares([30, 10]).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(budgetShares([30, 10])).toEqual([0.75, 0.25]);
    expect(budgetShares([0, 0, 0])).toEqual([0, 0, 0]);
    expect(budgetShares([Number.NaN, -3, 5])).toEqual([0, 0, 1]);
  });
  it('the bands stack to the whole of each day', () => {
    const rows = [
      channelRow('tiktok', { daily: [{ day: 1, spend: 30, claimed: 0, reconciled: 0 }, { day: 2, spend: 10, claimed: 0, reconciled: 0 }] }),
      channelRow('meta', { daily: [{ day: 2, spend: 30, claimed: 0, reconciled: 0 }] }),
    ];
    const { days, bands } = shareBands(rows);
    expect(days).toEqual([1, 2]);
    expect(bands).toHaveLength(2);
    // day 1: TikTok fills it, Meta has no height. Its top edge is its bottom edge
    const meta = bands[1]!.points.split(' ');
    expect(meta[0]).toBe(meta[meta.length - 1]);
    const html = render(null, <CanauxBody data={detail(rows)} />);
    expect(count(html, '<polygon')).toBe(2);
    expect(html).toContain('Part de la dépense par canal');
  });
  it('one day of spend is no curve', () => {
    expect(render(null, <CanauxBody data={detail([channelRow('tiktok', { daily: [{ day: 1, spend: 30, claimed: 0, reconciled: 0 }] })])} />)).toContain('après deux jours de dépense');
  });
  it('a demo has one TikTok row, its three readings the same number', () => {
    const d = tiktokDetail(mockSnapshot());
    expect(d.rows.map((r) => r.id)).toEqual(['tiktok']);
    const [r] = d.rows;
    expect(r!.reconciledRoas7d).toBe(r!.shopRoas7d);
    expect(r!.claimedRoas7d).toBe(r!.shopRoas7d);
    expect(r!.spend7d).toBeGreaterThan(0);
    expect(render(mockSnapshot(), <CanauxBody data={d} />)).toContain('TikTok');
  });
});

const growth: GrowthDetail = {
  stage: 'adequation', stageSinceDay: 15, ltvFactor: 1.2,
  gate: { next: 'acceleration', weeksHeld: 1, weeksNeeded: 2, checks: [{ label: 'Profit 14 jours', value: 90, target: 150, ok: false }, { label: 'Guides rentables', value: 2, target: 2, ok: true }] },
  allocation: {
    week: 5, day: 29, profit7: -42, profit28: 300, spend7: 80, roas14: 1.4, net: 0.88, ltv: 1.2, beRoas: 0.95, scaleRoas: 1.25, trimRoas: 0.99,
    reserve: 580, free: 3220, leak: false, adTarget: 230, testWeek: 84, note: 'On réinvestit le profit de la semaine.',
  },
  portfolio: {
    day: 29, week: 5, slots: { used: 3, max: 4 }, notes: ['Un guide attend son test payant.'],
    lines: [
      { productId: 'prd_1', nicheId: 'n1', title: 'Dodo serein', verdict: 'double_down', reason: 'ROAS 14 j 1,80 et marge 240 €', contribution28: 240, roas14: 1.8, paidTested: 320, share: 0.7 },
      { productId: 'prd_2', nicheId: 'n2', title: 'Siestes faciles', verdict: 'harvest', reason: 'Perd 12 € en pub, clients contents', contribution28: -12, roas14: 0.8, paidTested: 150, share: 0.1 },
    ],
  },
  weeks: [
    { week: 4, fromDay: 22, toDay: 28, revenue: 500, refunds: 20, adSpend: 200, fees: 40, creators: 0, payroll: 53, other: 10, profit: 177, cashEnd: 900, sales: 25, bySource: {}, roas: 1.5, ctr: 0.02, mains: 2, niches: 2, listSize: 40, ltvFactor: 1.1, stage: 'adequation', agents: 9, tasksDone: 80 },
    { week: 5, fromDay: 29, toDay: 35, revenue: 300, refunds: 60, adSpend: 220, fees: 30, creators: 0, payroll: 53, other: 10, profit: -73, cashEnd: 827, sales: 15, bySource: {}, roas: 1.1, ctr: 0.02, mains: 3, niches: 2, listSize: 60, ltvFactor: 1.2, stage: 'adequation', agents: 10, tasksDone: 70 },
  ],
  decisions: [
    { id: 'dec_1', day: 15, kind: 'stage', who: 'system', text: 'Passage en Adéquation', why: 'Profit 14 jours 210 €, un guide à 18 ventes.' },
    { id: 'dec_2', day: 29, kind: 'kill', who: 'mia', text: 'Arrêt de « Siestes »', why: 'ROAS 0,6 pour 180 €.', productId: 'prd_2', impactEur: -180 },
  ],
};

const audience: AudienceView = {
  size: 1200, leads: 900, buyers: 300, unsubscribed: 45, dailyCost: 0.42,
  byNiche: [{ nicheId: 'sommeil-bebe', size: 700, openRate: 0.31 }],
  recent: [{ id: 'brd_1', day: 28, nicheId: 'sommeil-bebe', productId: 'prd_1', audience: 'niche', subject: 'La nuit où tout a changé', angle: 'histoire', score: 74, hasUnsubscribe: true, status: 'sent', delivered: 680, opens: 210, clicks: 30, sales: 7, revenue: 133, unsubscribed: 4 }],
  sequences: [{ nicheId: 'sommeil-bebe', productId: 'prd_1', status: 'active' }],
};

describe('Croissance', () => {
  const base = mockSnapshot();
  const s: CompanySnapshot = { ...base, market: { ...base.market, audience } };
  const html = render(s, <CroissanceBody data={growth} />);

  it('the track says where the agency stands and what the next stage asks', () => {
    expect(html).toMatch(/aria-label="Palier 2 sur 4 : Adéquation"/);
    expect(html).toMatch(/<li class="stage-step is-now" aria-current="step">/);
    expect(count(html, 'class="stage-step')).toBe(4);
    for (const stage of ['Survie', 'Adéquation', 'Accélération', 'Portefeuille']) expect(html).toContain(stage);
    expect(html).toContain('Tenu 1 / 2 semaines');
    expect(html).toContain('Profit 14 jours');
    expect(html).toContain('90 / 150');
    expect(html).toContain('depuis le jour 15');
  });
  it('the last stage asks for nothing more', () => {
    expect(render(null, <CroissanceBody data={{ ...growth, stage: 'portefeuille', gate: { next: null, checks: [], weeksHeld: 0, weeksNeeded: 0 } }} />)).toContain('Dernier palier');
  });
  it('no check yet is not the last stage', () => {
    const page = render(null, <CroissanceBody data={{ ...growth, stage: 'survie', gate: null }} />);
    expect(page).toContain('Le premier contrôle du palier a lieu lundi.');
    expect(page).not.toContain('Dernier palier');
  });
  it('a week of losses is printed as a loss', () => {
    expect(html).toMatch(/Profit dernière semaine.*?txt-bad[^>]*>−73,00/s);
    expect(html).toContain('Profit par semaine');
    expect(html).toContain('Chiffre d’affaires par semaine');
  });
  it('the allocation of the week comes with its thresholds and its note', () => {
    expect(html).toMatch(/Pub visée \/ jour<\/span><strong>230\s€/);
    expect(html).toMatch(/Tests \/ semaine<\/span><strong>84\s€/);
    expect(html).toContain('0,95×');
    expect(html).toContain('1,25×');
    expect(html).toContain('On réinvestit le profit de la semaine.');
    expect(html).not.toContain('sous le seuil de rentabilité');
    expect(render(null, <CroissanceBody data={{ ...growth, allocation: { ...growth.allocation!, leak: true } }} />)).toContain('sous le seuil de rentabilité');
  });
  it('each guide of the portfolio has its verdict and its reason', () => {
    expect(html).toContain('On double');
    expect(html).toContain('À récolter');
    expect(html).toContain('ROAS 14 j 1,80 et marge 240 €');
    expect(html).toContain('Perd 12 € en pub, clients contents');
    expect(html).toContain('3 / 4 places');
    expect(html).toContain('Un guide attend son test payant.');
  });
  it('decisions read newest first, each with its why and the money it moved', () => {
    expect(html.indexOf('Arrêt de « Siestes »')).toBeLessThan(html.indexOf('Passage en Adéquation'));
    expect(html).toContain('ROAS 0,6 pour 180 €.');
    expect(html).toMatch(/txt-bad[^>]*>−180\s€/);
    expect(html).toContain('par l’agence');
  });
  it('the list: funnel, unsubscribes, broadcasts, cost', () => {
    const block = html.slice(html.indexOf('Liste e-mail'));
    expect(block).toMatch(/0,42\s€ \/ jour d’outil/);
    for (const label of ['Visiteurs', 'Prospects', 'Acheteurs']) expect(block).toContain(label);
    expect(block).toMatch(/Prospects.*?900/s);
    expect(block).toMatch(/Acheteurs.*?300/s);
    expect(block).toMatch(/Désabonnés<\/span><strong>45</);
    expect(block).toContain('La nuit où tout a changé');
    expect(block).toMatch(/31\s% d’ouverture/);
  });
  it('a run with no list and no week yet says so instead of breaking', () => {
    const blank = render(null, <CroissanceBody data={{ ...growth, weeks: [], decisions: [], allocation: null, portfolio: null, gate: null }} />);
    expect(blank).toContain('Pas encore de liste');
    expect(blank).toContain('La première semaine se clôt au jour 7.');
    expect(blank).toContain('Le CFO fait ses comptes chaque lundi.');
    expect(blank).toContain('Aucune décision de croissance');
  });
});

describe('Publicité: one tab, every channel', () => {
  const base = mockSnapshot();
  const master = base.company.creatives[0]!;
  const cut: AdCreative = {
    ...master, id: 'crt_cut', hook: 'Le même hook en 4:5', masterId: master.id, ratio: '4:5', files: { storyboard: [], preview: null },
    review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'rejected', reason: 'Image du corps', day: 20 } }, quality: null,
  };
  const pin: AdCreative = { ...cut, id: 'crt_pin', hook: 'Une épingle', masterId: null, format: 'static_image', ratio: '2:3', channelReviews: { pinterest: { status: 'approved', reason: null, day: 21 } } };
  const search: AdCreative = { ...cut, id: 'crt_search', hook: 'Faire ses nuits', masterId: null, format: 'search_text', ratio: 'text', scenes: [], channelReviews: { google: { status: 'pending', reason: null, day: null } } };
  const master2: AdCreative = { ...master, channelReviews: { youtube: { status: 'approved', reason: null, day: 19 } } };
  const campaign = base.company.campaigns[0]!;
  const s: CompanySnapshot = {
    ...base,
    market: { ...base.market, channelAccounts: { meta: { strikes: 2, banned: false, bannedUntilDay: 0, openDay: 12 }, google: { strikes: 0, banned: true, bannedUntilDay: 40, openDay: 14 }, pinterest: { strikes: 0, banned: false, bannedUntilDay: 0, openDay: null } } },
    company: { ...base.company, creatives: [master2, cut, pin, search], campaigns: [campaign, { ...campaign, id: 'cmp_meta', name: 'Dodo Meta', channel: 'meta', test: true }] },
  };
  const html = render(s, <AdsTab onClose={noop} />);
  const cardOf = (page: string, hook: string) => page.slice(page.lastIndexOf('<article', page.indexOf(`« ${hook} »`))).split('</article>')[0]!;
  const card = (hook: string) => cardOf(html, hook);

  it('every campaign says its channel, and TikTok has no privilege in the title', () => {
    expect(html).toContain('<h2>Publicité</h2>');
    expect(html).not.toContain('Pub TikTok');
    const row = html.slice(html.indexOf('Dodo Meta')).split('</tr>')[0]!;
    expect(row).toContain('Facebook &amp; Instagram');
    expect(row).toContain('Test');
  });
  it('filters by channel once there is more than one', () => {
    expect(html).toContain('Tous les canaux');
    expect(render(base, <AdsTab onClose={noop} />)).not.toContain('Tous les canaux');
  });
  it('the phone takes the ratio of the creative, 9:16 by default', () => {
    expect(html).toContain('class="phone" data-ratio="9:16"');
    expect(html).toContain('class="phone" data-ratio="4:5"');
    expect(html).toContain('class="phone" data-ratio="2:3"');
    expect(html).toContain('class="phone" data-ratio="text"');
    const css = readFileSync(new URL('./tabs/market.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.phone\[data-ratio='4:5'\] \{ aspect-ratio: 4 \/ 5; \}/);
    expect(css).toMatch(/\.phone\[data-ratio='2:3'\] \{ aspect-ratio: 2 \/ 3; \}/);
  });
  it('one verdict per channel, and a cut never waits on TikTok', () => {
    expect(card(master.hook)).toContain('TikTok : Approuvée');
    expect(card(master.hook)).toContain('YouTube Shorts : Approuvée');
    expect(card('Le même hook en 4:5')).toContain('Facebook &amp; Instagram : Refusée');
    expect(card('Le même hook en 4:5')).toContain('Image du corps');
    expect(card('Le même hook en 4:5')).not.toContain('TikTok');
    expect(card('Faire ses nuits')).toContain('Google Search : En validation');
    expect(reviewsOf({ ...cut, ratio: '9:16' }).map((r) => r.channel)).toEqual(['meta']); // a cut TikTok could carry still never went there
    expect(reviewsOf(pin).map((r) => r.channel)).toEqual(['pinterest']);
    expect(reviewsOf(master2).map((r) => r.channel)).toEqual(['tiktok', 'youtube']);
  });
  it('a draft our own review dropped reads as withdrawn, no platform saw it', () => {
    const dropped: AdCreative = { ...cut, channelReviews: { meta: { status: 'rejected', reason: 'Retirée avant soumission : promesse trop forte', day: 20 } } };
    const page = render({ ...s, company: { ...s.company, creatives: [dropped] } }, <AdsTab onClose={noop} />);
    expect(page).toContain('Facebook &amp; Instagram : Retirée');
    expect(page).toContain('— promesse trop forte');
    expect(page).not.toContain('Retirée avant soumission');
    expect(page).not.toContain(': Refusée');
  });
  it('one health row per account, the shared Google one named for both channels', () => {
    expect(count(html, 'class="health ')).toBe(3); // Pinterest was never asked for
    expect(html).toContain('Compte TikTok : ');
    expect(html).toContain('Compte Facebook &amp; Instagram : en danger');
    expect(html).toContain('Compte YouTube Shorts et Google Search : suspendu');
    expect(html).toContain('jusqu’au jour 40');
    expect(accountRows(undefined).map((r) => r.id)).toEqual(['tiktok']);
  });
  it('a poster opens the player when there is something to play', () => {
    expect(card(master.hook)).toContain('Regarder la pub');
    expect(card('Le même hook en 4:5')).toContain('Aperçu indisponible');
    const video = { status: 'ready' as const, videos: [{ ratio: '4:5' as const, path: 'video/crt_cut.mp4', durationSec: 22, bytes: 9000 }], poster: 'video/crt_cut.jpg', captions: null, cards: [], voice: null, qa: null };
    const page = render({ ...s, videos: { crt_cut: video } }, <AdsTab onClose={noop} />);
    expect(page).toContain('video/crt_cut.jpg');
    expect(cardOf(page, 'Le même hook en 4:5')).toContain('Regarder la pub');
  });
  it('a trimmed list of creatives says it is one', () => {
    expect(render({ ...s, counts: { creatives: 126, deliverables: 0, lessons: 0, messages: 0, products: 0 } }, <AdsTab onClose={noop} />)).toContain('Créas · 4 sur 126');
    expect(html).toContain('Créas · 4');
    expect(html).not.toContain('Créas · 4 sur');
  });
});

describe('Finance: the same word everywhere', () => {
  const s = mockSnapshot();

  it('ad spend is Publicité, in the P&L and in the ledger', () => {
    const html = render(s, <FinanceTab onClose={noop} />);
    expect(s.ledger.some((e) => e.type === 'ad_spend')).toBe(true);
    expect(html).not.toContain('Pub TikTok');
    expect(html).toMatch(/<span>Publicité<\/span>/);
    expect(html).toMatch(/lt-out">Publicité</);
  });
  it('the P&L adds up once payroll exists', () => {
    const html = render({ ...s, finance: { ...s.finance, payroll: 53.2 } }, <FinanceTab onClose={noop} />);
    expect(html).toMatch(/Salaires et recrutement<\/span>.*?−53,20/s);
    expect(render(s, <FinanceTab onClose={noop} />)).not.toContain('Salaires et recrutement');
  });
});

describe('Apprentissage: the channels bandits', () => {
  const base = mockSnapshot();
  const arms = [{ key: 'tiktok', alpha: 3, beta: 2, pulls: 4, reward: 2 }, { key: 'meta', alpha: 6, beta: 2, pulls: 5, reward: 3 }];
  const niche = base.company.research.trends[0]!;
  const s: CompanySnapshot = { ...base, company: { ...base.company, bandits: { [`channel:${niche.nicheId}`]: arms, 'channel_cat:parentalité': arms } } };

  it('a channel dimension and its arms read in words', () => {
    const html = render(s, <LearningTab onClose={noop} />);
    expect(html).toContain(`Canal · ${niche.name}`);
    expect(html).toContain('Canal · catégorie parentalité');
    expect(html).toContain('<span class="arm-label">Facebook &amp; Instagram</span>');
    expect(html).toContain('<span class="arm-label">TikTok</span>');
  });
  it('the video and e-mail bandits print no raw id either', () => {
    const tempo = { key: 'fast', alpha: 2, beta: 2, pulls: 3, reward: 1 };
    const angle = { key: 'erreur', alpha: 2, beta: 2, pulls: 3, reward: 1 };
    const html = render({ ...s, company: { ...s.company, bandits: { [`video_tempo:${niche.nicheId}`]: [tempo], [`email_angle:${niche.nicheId}`]: [angle] } } }, <LearningTab onClose={noop} />);
    expect(html).toContain(`Rythme des vidéos · ${niche.name}`);
    expect(html).toContain(`Angle des e-mails · ${niche.name}`);
    expect(html).toContain('<span class="arm-label">Rapide</span>');
    expect(html).toContain('<span class="arm-label">Erreur</span>');
    expect(html).not.toContain('video_tempo');
  });
  it('god mode adds the hidden fit of each channel, a run without it prints a dash', () => {
    const truth = { id: 'n1', name: 'Niche', demand: 0.5, wtp: { min: 9, sweet: 19, max: 29 }, competition: 0.3, tiktokAffinity: 0.6, hookAffinity: {}, channels: { meta: { fit: 0.83, cpmMult: 1, intent: 1, poolShare: 0.5 } } };
    const html = render({ ...s, godMode: { niches: [truth], intents: {} } }, <LearningTab onClose={noop} />, true);
    const table = html.slice(html.indexOf('Vérité cachée du marché'));
    expect(table).toContain('Google Search');
    expect(table).toMatch(/60\s%/);
    expect(table).toMatch(/83\s%/);
    expect(table).toContain('>—<');
  });
  it('without god mode no fit reaches the page', () => {
    expect(render(s, <LearningTab onClose={noop} />)).not.toContain('Vérité cachée');
  });
  it('the title says when the stream only holds part of the lessons', () => {
    const shown = base.company.lessons.length;
    expect(render({ ...s, counts: { creatives: 0, deliverables: 0, lessons: 900, messages: 0, products: 0 } }, <LearningTab onClose={noop} />)).toContain(`Leçons · ${shown} sur 900`);
  });
});

describe('every « TikTok » of these tabs is a channel label or « Publicité »', () => {
  for (const file of ['AdsTab', 'CanauxTab', 'CroissanceTab', 'FinanceTab', 'LearningTab']) {
    it(`${file} prints it only through CHANNELS`, () => {
      const source = readFileSync(new URL(`./tabs/${file}.tsx`, import.meta.url), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, ''); // what a comment says is printed nowhere
      expect(code).not.toContain('TikTok');
    });
  }
});
