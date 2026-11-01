// The real server shapes the snapshot, the real tabs read it: a company old enough for the tightest live limits, the normal state
// from about day 85. Every figure here is one a tab used to add up from the trimmed lists.
// Run: cd server && npx vitest run --root ../web/src
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompanySnapshot } from '../../../shared/types';
import { AppContext, type AppCtx } from './context';
import { buildLookups } from './labels';
import { AdsTab } from './tabs/AdsTab';
import { FinanceTab } from './tabs/FinanceTab';
import { LearningTab } from './tabs/LearningTab';
import { ProductsTab } from './tabs/ProductsTab';

const noop = () => undefined;

// The path is computed: the web's tsc has no Node types and trim.ts needs them, so it must not follow this import.
const server = (path: string) => import(/* @vite-ignore */ new URL(`../../../server/src/${path}`, import.meta.url).href);

const DAYS = 200;
/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a world built by hand, on the server's side of the line */
type World = any;

function fill(w: World): void {
  w.day = DAYS + 1;
  w.tick = 0;
  w.ledger.push({ id: 'led_close', day: DAYS, type: 'platform_fee', amount: -1, memo: 'Jour clos', ref: `fixed:${DAYS}` });
  const k = { cash: 500, revenue: 0, cumulativeProfit: 0, sales: 2, refunds: 0, openTickets: 0, avgReplyScore: 0, cac: 0, cvr: 0, liveProducts: 1, tasksDone: 1, lessonsLearned: 0, impressions: 1000, clicks: 10, ctr: 0.01 };
  // ROAS 1× at the start, 2× by the last weeks, with a small fall inside them: the run improved, the stream's window alone says otherwise
  w.company.kpis = Array.from({ length: DAYS }, (_, i) => ({ ...k, day: i + 1, adSpend: 50, profit: 10, roas: i < 7 ? 1 : i < DAYS - 7 ? 2.2 : 2 }));
  const row = (day: number, channel: string | undefined, spend: number) => ({
    day, campaignId: 'cmp_1', creativeId: 'cre_1', productId: 'prd_1', channel, spend, impressions: 1000, clicks: 20, ctr: 0.02, cpc: 0.5, cpm: 10,
    landingViews: 15, purchases: 2, revenue: spend * 2, roas: 2, frequency: 1.5, comments: [{ author: 'lea', text: 'Enfin un guide clair', tone: 'positive' }],
  });
  w.market.adStats = Array.from({ length: 30 }, (_, i) => DAYS - i).flatMap((day) => [row(day, undefined, 30), row(day, 'meta', 20)]);
  w.company.campaigns = [{ id: 'cmp_1', name: 'Test du guide', productId: 'prd_1', creativeIds: ['cre_1'], dailyBudget: 50, status: 'active', startDay: 100, createdBy: 'leo' }];
  const stats = { views: 0, sales: 10, revenue: 100, refunds: 1, refundAmount: 0, rating: 4, reviews: [], upsellSales: 0 };
  const guide = { nicheId: 'n', title: 'Guide', subtitle: '', audience: '', problem: '', createdDay: 1, createdBy: 'zoe', files: { pdf: null, cover: null, salesPage: null }, price: 19, priceHistory: [], stats };
  w.company.products = Array.from({ length: 30 }, (_, i) => ({ ...guide, id: `prd_${i}`, status: i < 25 ? 'killed' : 'live' }));
}

let snapshot: CompanySnapshot;

function render(el: ReactElement): string {
  const ctx: AppCtx = {
    snapshot, lookups: buildLookups(snapshot), activity: [], demo: false, godMode: false, runId: snapshot.runId,
    toast: noop, openAgent: noop, openDept: noop, openProduct: noop, centerAgent: noop, centerDept: noop, setTab: noop, openBrainNote: noop, refresh: noop,
  };
  return renderToStaticMarkup(<AppContext.Provider value={ctx}>{el}</AppContext.Provider>);
}

/** A stat tile: its label and everything up to the next tile, French spaces read as spaces. */
const tile = (html: string, label: string) => html.slice(html.indexOf(`>${label}<`)).split(/class="stat[ "]/)[0]!.replace(/[  ]/g, ' ');

beforeAll(async () => {
  const { createWorld, defaultScenario } = await server('runtime/index.ts');
  const { buildSnapshot, estimateFinance, LIVE_TIGHT_LIMITS } = await server('api/trim.ts');
  const w = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90 }), 'tight');
  fill(w);
  snapshot = buildSnapshot(w, estimateFinance(w), false, LIVE_TIGHT_LIMITS);
}, 60_000);

describe('the snapshot is what the tightest stream carries', () => {
  it('keeps at most two days of ad rows, the last closed one at least, and the last days of the KPIs', () => {
    const days = new Set(snapshot.market.adStats.map((s) => s.day));
    expect(days.size).toBeLessThanOrEqual(2);
    expect(days.has(DAYS)).toBe(true);
    expect(snapshot.company.kpis[0]!.day).toBeGreaterThan(60);
  });
});

describe('Apprentissage: « L’agence s’améliore-t-elle ? »', () => {
  it('compares with the start of the run, not with the start of the stream', () => {
    const html = render(<LearningTab onClose={noop} />);
    const roas = html.slice(html.indexOf('>ROAS<')).split('trend card')[0]!;
    expect(roas).toContain('vs début (1,00×)');
    expect(roas).toContain('txt-good');
    expect(roas).not.toContain('txt-bad');
  });
});

describe('Publicité: every « 7 j »', () => {
  it('the tiles add up seven closed days, every channel, not the rows the stream kept', () => {
    const html = render(<AdsTab onClose={noop} />);
    expect(tile(html, 'Dépense 7 j')).toContain('350,00');
    expect(tile(html, 'ROAS 7 j')).toContain('2,00×');
    expect(tile(html, 'Impressions 7 j')).toContain('280 clics');
    expect(tile(html, 'CPC')).toContain('28 achats');
  });
  it('the campaign table reads the same week', () => {
    const html = render(<AdsTab onClose={noop} />);
    const row = html.slice(html.indexOf('Test du guide')).split('</tr>')[0]!;
    expect(row).toContain('350,00');
  });
  it('the comments are still there', () => {
    const html = render(<AdsTab onClose={noop} />);
    expect(html).toContain('Enfin un guide clair');
    expect(html).not.toContain('Pas encore de commentaire');
  });
});

describe('Produits: the whole catalogue', () => {
  it('the tiles count the guides the stream no longer lists', () => {
    const html = render(<ProductsTab onClose={noop} />);
    expect(snapshot.company.products.length).toBeLessThan(30);
    expect(tile(html, 'Chiffre d’affaires')).toContain('3 000');
    expect(tile(html, 'Chiffre d’affaires')).toContain('300 ventes');
    expect(html).toContain('12 derniers guides arrêtés affichés sur 25');
  });
});

describe('Finance: a window says so', () => {
  it('a best day past the stream’s window reads as the best of those days', () => {
    expect(render(<FinanceTab onClose={noop} />)).toContain('Meilleure journée (60 derniers jours)');
  });
});
