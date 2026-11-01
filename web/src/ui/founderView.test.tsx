// What a skeptic saw in the app that no test could see: most of these tests read what the real server shapes, not a full mock.
// Run: cd server && npx vitest run --root ../web/src
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { DROPPED_REASON } from '../../../shared/channels';
import type { AdCreative, CompanySnapshot, CreativeVideo, DailyKpi, GrowthState } from '../../../shared/types';
import { mockSnapshot } from '../world/mockSnapshot';
import { AppContext, type AppCtx } from './context';
import { breakEvenRoas, roasTone } from './derive';
import { buildLookups } from './labels';
import { ScenarioModal } from './ScenarioModal';
import { AdsTab } from './tabs/AdsTab';
import { CalendarTab } from './tabs/CalendarTab';
import { FinanceTab } from './tabs/FinanceTab';
import { LearningTab } from './tabs/LearningTab';
import { videoTiles } from './tabs/GalleryTab';
import { heldOrder, ProductsTab } from './tabs/ProductsTab';
import { rejectedToast } from './useEventToasts';
import { PdfFailed, pdfName } from './viewers/PdfFlip';

const noop = () => undefined;

// The path is computed: the web's tsc has no Node types and the server needs them, so it must not follow this import.
const server = (path: string) => import(/* @vite-ignore */ new URL(`../../../server/src/${path}`, import.meta.url).href);

function render(s: CompanySnapshot, el: ReactElement): string {
  const ctx: AppCtx = {
    snapshot: s, lookups: buildLookups(s), activity: [], demo: false, godMode: false, runId: s.runId,
    toast: noop, openAgent: noop, openDept: noop, openProduct: noop, centerAgent: noop, centerDept: noop, setTab: noop, openBrainNote: noop, refresh: noop,
  };
  return renderToStaticMarkup(<AppContext.Provider value={ctx}>{el}</AppContext.Provider>);
}

/** A stat tile: its label and everything up to the next tile, French spaces read as spaces. */
const tile = (html: string, label: string) => html.slice(html.indexOf(`>${label}<`)).split(/class="stat[ "]/)[0]!.replace(/[  ]/g, ' ');

describe('Produits: the six bars of a real card', () => {
  let snapshot: CompanySnapshot;
  beforeAll(async () => {
    const { createWorld, defaultScenario } = await server('runtime/index.ts');
    const { buildSnapshot, estimateFinance, LIVE_LIMITS } = await server('api/trim.ts');
    const w = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90 }), 'card');
    const quality = { overall: 84, specificity: 91, structure: 82, actionability: 73, humanTone: 64, design: 55, compliance: 46, promiseMatch: 80, issues: [], evaluator: 'heuristic' };
    const stats = { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 };
    w.company.products = [{ id: 'prd_1', nicheId: 'n', title: 'Guide', subtitle: '', audience: '', problem: '', createdDay: 1, createdBy: 'zoe', status: 'live', version: 1, price: 19, priceHistory: [], stats, quality, salesQuality: quality, files: { pdf: null, cover: null, salesPage: null } }];
    snapshot = buildSnapshot(w, estimateFinance(w), false, LIVE_LIMITS);
  }, 60_000);

  it('prints the scores the guide earned, none at 0', () => {
    const html = render(snapshot, <ProductsTab onClose={noop} />);
    const shown = [...html.matchAll(/quality-label">([^<]+)<.*?quality-val">(\d+)</g)].map((m) => [m[1], Number(m[2])]);
    expect(shown).toEqual([['Spécificité', 91], ['Structure', 82], ['Actionnable', 73], ['Ton humain', 64], ['Design', 55], ['Conformité', 46]]);
  });
});

describe('a card under the pointer keeps its place', () => {
  const rows = (...ids: string[]) => ids.map((id) => ({ id }));
  it('the order drawn last wins over a new sort, and a new guide comes after', () => {
    expect(heldOrder(rows('b', 'a', 'new', 'c'), ['a', 'b', 'c']).map((r) => r.id)).toEqual(['a', 'b', 'c', 'new']);
  });
  it('nothing drawn yet: the sort stands', () => {
    expect(heldOrder(rows('b', 'a'), []).map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('a rejected ad', () => {
  const ad = (reason: string): AdCreative => ({ hook: 'Le hook', review: { status: 'rejected', reason, day: 3 } }) as AdCreative;
  it('one our own review dropped is no alarm, and does not say its title twice', () => {
    const t = rejectedToast(ad(`${DROPPED_REASON} : promesse trop forte`));
    expect(t).toMatchObject({ tone: 'info', title: 'Pub retirée avant soumission', text: '« Le hook » — promesse trop forte' });
  });
  it('a platform that refuses still rings', () => {
    expect(rejectedToast(ad('allégation interdite'))).toMatchObject({ tone: 'bad', title: 'Pub refusée par la plateforme', text: '« Le hook » — allégation interdite' });
  });
});

describe('the scenario form says what the app does', () => {
  it('the league text reads the constants', async () => {
    const { TALENT } = await server('runtime/talent/constants.ts');
    const html = render({ ...mockSnapshot(), scenario: { ...mockSnapshot().scenario, talent: 'league' } }, <ScenarioModal onClose={noop} onLoaded={noop} />);
    expect(html).toContain(`repasse ${TALENT.challenge.sits} fois le même test que ${TALENT.challenge.candidates} candidats`);
    expect(html).not.toContain('trois candidats');
  });
  it('« Validation fondateur » lists what waits and what silence costs', () => {
    const html = render(mockSnapshot(), <ScenarioModal onClose={noop} onLoaded={noop} />).replace(/&gt;/g, '>');
    for (const word of ['Lancements', 'hausses de budget', 'canaux', 'embauches', 'remplacements', 'licenciements', 'e-mails à la liste', 'avances aux créateurs', 'remboursements > 50 €', 'les frais fixes continuent de courir']) expect(html).toContain(word);
  });
  const claude = (claudeReady: boolean): CompanySnapshot => {
    const s = mockSnapshot();
    return { ...s, scenario: { ...s.scenario, mindMode: 'claude' }, session: { runId: 'r', playing: true, speed: 1, mindMode: 'heuristic', claudeReady } };
  };
  it('Claude with no key on the server is said before the run starts', () => {
    expect(render(claude(false), <ScenarioModal onClose={noop} onLoaded={noop} />)).toContain('Aucune clé ANTHROPIC_API_KEY sur ce serveur');
    expect(render(claude(true), <ScenarioModal onClose={noop} onLoaded={noop} />)).not.toContain('Aucune clé ANTHROPIC_API_KEY sur ce serveur');
  });
});

describe('Calendrier: a closed day is not « en cours »', () => {
  const at = (s: CompanySnapshot, day: number): CompanySnapshot => ({ ...s, day, company: { ...s.company, kpis: Array.from({ length: 60 }, (_, i) => ({ ...s.company.kpis[0]!, day: day - 60 + i, sales: 3 }) as DailyKpi) } });
  it('only today is, and a day past the window shows no 0 sale', () => {
    const s = at(mockSnapshot(), 77);
    const html = render({ ...s, scenario: { ...s.scenario, openEnded: true } }, <CalendarTab onClose={noop} />);
    const cell = (d: number) => html.slice(html.indexOf(`>Jour ${d}<`)).split('</button>')[0]!;
    expect(cell(77)).toContain('en cours');
    expect(html.split('en cours').length - 1).toBe(1);
    expect(cell(16)).not.toContain('en cours');
    expect(cell(16)).toContain('—');
    expect(cell(17)).toContain('</svg> 3');
  });
});

describe('Apprentissage reads a healthy company as one', () => {
  const day = (i: number, profit: number, adSpend: number): DailyKpi => ({ ...mockSnapshot().company.kpis[0]!, day: i + 1, profit, adSpend, roas: 1.5, impressions: 1000, clicks: 20, ctr: 0.02, cvr: 0.02, sales: 2, refunds: 0, avgReplyScore: 80 });
  const run = (first: number, last: number, adFirst: number, adLast: number): CompanySnapshot => {
    const s = mockSnapshot();
    const kpis = Array.from({ length: 30 }, (_, i) => (i < 15 ? day(i, first, adFirst) : day(i, last, adLast)));
    return { ...s, kpiBaseline: undefined, company: { ...s.company, kpis } };
  };
  const trend = (html: string, label: string) => html.slice(html.indexOf(`>${label}<`)).split('trend card')[0]!.split('two-col')[0]!.replace(/[  ]/g, ' ');
  it('a gain from a loss reads in euros, not as +7 711 %', () => {
    const profit = trend(render(run(-3, 231, 50, 60), <LearningTab onClose={noop} />), 'Profit quotidien');
    expect(profit).toMatch(/\+234 € vs début \([-−]3 €\)/);
    expect(profit).not.toContain('%');
    expect(profit).toContain('txt-good');
  });
  it('a positive base keeps its percentage', () => {
    expect(trend(render(run(100, 150, 50, 60), <LearningTab onClose={noop} />), 'Profit quotidien')).toMatch(/\+50\s?% vs début \(100 €\)/);
  });
  it('says when the spend explains the falling trends, and only then', () => {
    expect(render(run(10, 200, 20, 300), <LearningTab onClose={noop} />).replace(/[  ]/g, ' ')).toContain('La pub est passée de 20 € à 300 € par jour');
    expect(render(run(10, 200, 20, 25), <LearningTab onClose={noop} />)).not.toContain('La pub est passée');
  });
});

describe('one break-even on screen: the CFO’s', () => {
  const growth = (beRoas: number): GrowthState => ({ allocation: { beRoas } } as GrowthState);
  const withBreakEven = (beRoas: number | null): CompanySnapshot => {
    const s = mockSnapshot();
    const company = { ...s.company, ...(beRoas === null ? {} : { growth: growth(beRoas) }) };
    return { ...s, company, finance: { ...s.finance, roas7d: 1.3 } };
  };
  it('a ROAS of 1,3× is green over a point mort of 0,92×', () => {
    const s = withBreakEven(0.92);
    const ads = tile(render({ ...s, adTotals: undefined, market: { ...s.market, adStats: s.market.adStats.map((r) => ({ ...r, day: s.day, revenue: 1.3 * r.spend })) } }, <AdsTab onClose={noop} />), 'ROAS 7 j');
    expect(ads).toContain('point mort 0,92×');
    expect(ads).toContain('txt-good');
  });
  it('Finance reads all the revenue, so it names that and no break-even judges it', () => {
    const html = render(withBreakEven(1.4), <FinanceTab onClose={noop} />);
    expect(html).not.toContain('ROAS 7 j');
    const finance = tile(html, 'CA / pub 7 j');
    expect(finance).toContain('tout le CA');
    expect(finance).not.toContain('point mort');
    expect(finance.split('stat-sub')[0]).not.toMatch(/txt-(good|bad)/);
  });
  it('before the first Monday nothing judges it, and no number of ours stands in', () => {
    const s = withBreakEven(null);
    expect(breakEvenRoas(s)).toBeNull();
    const ads = render(s, <AdsTab onClose={noop} />);
    expect(tile(ads, 'ROAS 7 j')).toContain('point mort calculé chaque lundi');
    expect(tile(ads, 'ROAS 7 j').split('stat-sub')[0]).not.toMatch(/txt-(good|bad)/);
    expect(ads).not.toContain('≥ 1,5×');
  });
  it('two ceilings, two words: the day\'s envelope in Finance, the week\'s target in Croissance', () => {
    const s = mockSnapshot();
    const company = { ...s.company, budget: { day: s.day, adCap: 26, reserve: 0, survival: false, stage: 'survie' } };
    const html = render({ ...s, company } as unknown as CompanySnapshot, <FinanceTab onClose={noop} />);
    expect(html).not.toContain('Plafond pub du jour');
  });
  it('the tone is a plain comparison', () => {
    expect([roasTone(1, 1), roasTone(0.99, 1), roasTone(3, null)]).toEqual(['good', 'bad', null]);
  });
});

describe('a PDF that will not open', () => {
  it('speaks our words and keeps the download', () => {
    const html = renderToStaticMarkup(<PdfFailed url="/runs/r/guide.pdf" title="Le guide" />);
    expect(html).toContain('Ce guide ne s’ouvre pas ici');
    expect(html).toMatch(/<a [^>]*href="\/runs\/r\/guide\.pdf"[^>]*download="Le guide\.pdf"/);
    expect(html).not.toContain('<iframe');
  });
  it('a download carries the guide’s title, in a name Windows takes', () => {
    expect(pdfName('Peur de se tromper : la méthode')).toBe('Peur de se tromper la méthode.pdf');
    expect(pdfName('Quoi ? <Rien> / tout...')).toBe('Quoi Rien tout.pdf');
    expect(pdfName('  ?? ')).toBe('guide.pdf');
  });
});

describe('Galerie: one film once', () => {
  it('two ads with the same render key are one tile', () => {
    const film = (id: string, key: string): CreativeVideo => ({ status: 'ready', videos: [{ ratio: '9:16', path: `video/${id}/${key}/master.mp4`, durationSec: 30, bytes: 4_465_838 }], poster: `video/${id}/${key}/poster.png`, captions: null, cards: [], voice: null, qa: null });
    const s = { ...mockSnapshot(), videos: { cre_567: film('cre_567', '76cd17a8'), cre_471: film('cre_471', '76cd17a8'), cre_9: film('cre_9', 'aaaa1111') } };
    expect(videoTiles(s).map((t) => t.creativeId)).toEqual(['cre_567', 'cre_9']);
  });
});
