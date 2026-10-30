// Server-side render checks of the panels fixed after the review (no DOM needed).
// Run: cd server && npx vitest run --root ../web/src
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CompanySnapshot, Deliverable, Product, SessionInfo, Task, WeeklyPnl } from '../../../shared/types';
import { mockSnapshot } from '../world/mockSnapshot';
import { DeliverableLink, FileLink } from './common';
import { AppContext, type AppCtx } from './context';
import { DeptPanel } from './DeptPanel';
import { sessionView } from './derive';
import { EndBanner } from './EndBanner';
import { SimHud } from './Hud';
import { buildLookups } from './labels';
import { MissionBar } from './MissionBar';
import { ScenarioModal } from './ScenarioModal';
import { AdsTab } from './tabs/AdsTab';
import { CalendarTab } from './tabs/CalendarTab';
import { FinanceTab } from './tabs/FinanceTab';
import { GalleryTab } from './tabs/GalleryTab';
import { InboxTab } from './tabs/InboxTab';
import { LearningTab } from './tabs/LearningTab';
import { ProductsTab } from './tabs/ProductsTab';
import { TasksTab } from './tabs/TasksTab';
import { addToast, Toasts, type Toast } from './Toasts';

const noop = () => undefined;

function render(s: CompanySnapshot, el: ReactElement, demo = false, godMode = false): string {
  const ctx: AppCtx = {
    snapshot: s, lookups: buildLookups(s), activity: s.activity, demo, godMode, runId: s.runId,
    toast: noop, openAgent: noop, openDept: noop, openProduct: noop, centerAgent: noop, centerDept: noop, setTab: noop, openBrainNote: noop, refresh: noop,
  };
  return renderToStaticMarkup(<AppContext.Provider value={ctx}>{el}</AppContext.Provider>);
}

function withProduct(s: CompanySnapshot, patch: (p: Product) => Product): CompanySnapshot {
  return { ...s, company: { ...s.company, products: s.company.products.map((p, i) => (i === 0 ? patch(p) : p)) } };
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('generated files open in a new tab', () => {
  it('FileLink: target=_blank + rel noopener', () => {
    const html = renderToStaticMarkup(<FileLink runId="run-1" path="files/p/guide.pdf">Ouvrir le PDF</FileLink>);
    expect(html).toContain('href="/runs/run-1/files/p/guide.pdf"');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="[^"]*noopener[^"]*"/);
  });

  it('product card PDF / sales page and ad previews are new-tab links', () => {
    const s = mockSnapshot();
    const products = render(s, <ProductsTab onClose={noop} />);
    for (const label of ['Ouvrir le PDF', 'Page de vente']) {
      const a = products.match(new RegExp(`<a [^>]*>(?:(?!</a>).)*${label}`))?.[0] ?? '';
      expect(a, label).toContain('target="_blank"');
      expect(a, label).toMatch(/rel="[^"]*noopener/);
    }
    const ads = render(s, <AdsTab onClose={noop} />);
    const preview = ads.match(/<a [^>]*href="[^"]*preview\.html"[^>]*>/)?.[0] ?? '';
    expect(preview).toContain('target="_blank"');
    expect(preview).toMatch(/rel="[^"]*noopener/);
  });
});

describe('product card « La suite est ici »', () => {
  it('prints the prefix once when nextStep.title already contains it', () => {
    const s = withProduct(mockSnapshot(), (p) => ({ ...p, upsellProductId: null, content: p.content && { ...p.content, nextStep: { title: 'La suite est ici : aller plus loin', text: '', upsellProductId: null } } }));
    const html = render(s, <ProductsTab onClose={noop} />);
    const upsell = html.match(/<div class="upsell small"[^>]*>.*?<\/div>/)?.[0] ?? '';
    expect(upsell).toContain('aller plus loin');
    expect(count(upsell, 'La suite est ici')).toBe(1);
  });

  it('a bare default title does not render « La suite est ici : La suite est ici »', () => {
    const s = withProduct(mockSnapshot(), (p) => ({ ...p, upsellProductId: null, content: p.content && { ...p.content, nextStep: { title: 'La suite est ici', text: 'Bientôt', upsellProductId: null } } }));
    const html = render(s, <ProductsTab onClose={noop} />);
    const upsell = html.match(/<div class="upsell small"[^>]*>.*?<\/div>/)?.[0] ?? '';
    expect(count(upsell, 'La suite est ici')).toBe(1);
    expect(upsell).toContain('guide suivant en préparation');
  });

  it('marks the focused product (links from toasts / journal)', () => {
    const s = mockSnapshot();
    const id = s.company.products[0]!.id;
    const html = render(s, <ProductsTab onClose={noop} focusId={id} focusSeq={1} />);
    expect(html).toContain(`data-product-id="${id}"`);
  });
});

describe('inbox shows customer names', () => {
  it('uses customerName instead of « Client <id> »', () => {
    const s = mockSnapshot();
    const m = s.market.inbox[0]!;
    const html = render({ ...s, market: { ...s.market, inbox: [{ ...m, customerName: 'Héloïse T.' }] } }, <InboxTab onClose={noop} />);
    expect(html).toContain('Héloïse T.');
    expect(html).not.toContain(`>Client ${m.customerId}<`);
  });
});

describe('inbox: the true intent comes from god mode only', () => {
  const NOTE = 'Vraie intention';
  // a snapshot as the server sends it: no `intent` on the messages
  const publicMessages = (s: CompanySnapshot) => s.market.inbox.map(({ intent: _truth, ...m }) => m) as CompanySnapshot['market']['inbox'];
  const inbox = (godMode: boolean, intents?: NonNullable<CompanySnapshot['godMode']>['intents']) => {
    const s = mockSnapshot();
    const { godMode: _hidden, ...rest } = s;
    const snapshot: CompanySnapshot = { ...rest, market: { ...s.market, inbox: publicMessages(s) }, ...(intents ? { godMode: { niches: [], intents } } : {}) };
    return { html: render(snapshot, <InboxTab onClose={noop} />, false, godMode), first: s.market.inbox.slice().sort((a, b) => b.day - a.day || b.id.localeCompare(a.id))[0]! };
  };

  it('reads godMode.intents, keyed by message', () => {
    const { first } = inbox(false);
    const { html } = inbox(true, { [first.id]: 'arnaque' });
    expect(html).toContain(NOTE);
    expect(html).toContain('Arnaque');
  });
  it('shows nothing without god mode, even when the snapshot still holds intents', () => {
    const { first } = inbox(false);
    expect(inbox(false, { [first.id]: 'arnaque' }).html).not.toContain(NOTE);
  });
  it('a message newer than the last god poll shows no empty pill', () => {
    expect(inbox(true, {}).html).not.toContain(NOTE);
  });
});

describe('founder approval card', () => {
  const pending = (s: CompanySnapshot, input: Task['input']): CompanySnapshot => {
    const t: Task = { ...s.company.tasks[0]!, id: 'tsk_ask', kind: 'launch_campaign', title: 'Lancer une campagne', status: 'awaiting_founder', input };
    return { ...s, company: { ...s.company, tasks: [...s.company.tasks, t], pendingApprovals: ['tsk_ask'] } };
  };
  it('prints the request with its amount, never the raw input keys', () => {
    const s = pending(mockSnapshot(), { productId: 'prd_91', nicheId: 'batch-cooking-budget', founderPhase: 'before', founderAsk: 'Lancer une campagne TikTok à 40,00 €/jour pour « Chiot »' });
    const card = render(s, <TasksTab onClose={noop} />).match(/<div class="approval-card">.*?<div class="approval-actions">/)?.[0] ?? '';
    expect(card).toContain('Lancer une campagne TikTok à 40,00 €/jour pour « Chiot »');
    for (const raw of ['productId', 'nicheId', 'founderPhase', 'founderAsk', 'prd_91']) expect(card, raw).not.toContain(raw);
  });
});

describe('task counts on the panels', () => {
  const trimmed = (): CompanySnapshot => {
    const s = mockSnapshot();
    const done = s.company.tasks.filter((t) => t.status === 'done').slice(0, 1).map((t) => ({ ...t, dept: 'finance' as const, dayCreated: s.day, dayDone: s.day }));
    return { ...s, company: { ...s.company, tasks: done, kpis: [] } };
  };
  const stats = (s: CompanySnapshot): CompanySnapshot => ({
    ...s,
    taskStats: {
      days: [{ day: s.day, created: 18, done: 18, failed: 0, cancelled: 0 }],
      depts: { finance: { days: [{ day: s.day, created: 7, done: 7, failed: 0, cancelled: 0 }], kinds7d: { budget_review: 5 }, done: 90, failed: 7, avgDelayDays: 2.5 } },
    },
  });

  it('calendar: the real count, and the honest label for the detail it lost', () => {
    const html = render(stats(trimmed()), <CalendarTab onClose={noop} />);
    expect(html).toContain('Tâches terminées · 18');
    expect(html).toContain('Détail indisponible pour 17 tâches');
  });
  it('team panel: skills and delay come from the server counts', () => {
    const html = render(stats(trimmed()), <DeptPanel deptId="finance" onClose={noop} />);
    expect(html).toContain('2,5 j');
    expect(html).toMatch(/<span class="skill-val">5<\/span>/);
  });
  it('task list: the count of the run, and what the list shows of it', () => {
    const s = stats(trimmed());
    const html = render({ ...s, taskStats: { ...s.taskStats!, days: [{ day: 3, created: 300, done: 300, failed: 0, cancelled: 0 }] } }, <TasksTab onClose={noop} />);
    expect(html).toContain('1 terminées les plus récentes affichées sur 300');
  });
  it('task list: failed and cancelled tasks are the run\'s too, and « Tout » counts them', () => {
    const s = stats(trimmed());
    const days = [{ day: 3, created: 66, done: 2, failed: 20, cancelled: 44 }];
    const html = render({ ...s, taskStats: { ...s.taskStats!, days } }, <TasksTab onClose={noop} />);
    expect(html).toMatch(/Échouées<span class="seg-count">64</);
    expect(html).toContain('0 échouées ou annulées les plus récentes affichées sur 64');
    expect(html).toMatch(/Tout<span class="seg-count">66</);
    expect(html).toContain('Toutes les tâches · 66');
  });
});

describe('the founder\'s missions', () => {
  const base = mockSnapshot();
  const dept = (i: number) => ({ ...base.company.missions[0]!, id: `mis_${i}`, day: 30, from: 'camille', text: `Studio : mission ${i}`, taskIds: [], status: 'open' as const });
  const mine = { ...dept(0), id: 'mis_me', day: 3, from: 'founder' as const, text: 'Lance un guide sur le sommeil du bébé', taskIds: ['tsk_gone1', 'tsk_gone2', 'tsk_gone3'], doneTasks: 2, status: 'done' as const, outcome: 'En ligne depuis le jour 9.' };
  const html = render({ ...base, company: { ...base.company, missions: [dept(1), dept(2), dept(3), dept(4), dept(5), mine] } }, <TasksTab onClose={noop} />);

  it('his own mission is in the first four, even closed, behind a wall of department missions', () => {
    expect(html).toContain('Lance un guide sur le sommeil du bébé');
    expect(html).toContain('En ligne depuis le jour 9.');
    expect(html).not.toContain('Studio : mission 5');
  });
  it('its progress is counted on all its tasks, not on those left in the snapshot', () => {
    expect(html).toContain('2/3 tâches');
  });
});

describe('Pub TikTok: a creative tells its whole life', () => {
  const base = mockSnapshot();
  const c = base.company.creatives[0]!;
  const adTotals = {
    days: [{ day: 3, spend: 12, revenue: 30 }, { day: 4, spend: 14, revenue: 21 }],
    creatives: { [c.id]: { spend: 100, impressions: 20_000, clicks: 400, purchases: 9, revenue: 171, lastDay: 12 } },
  };
  const html = render({ ...base, market: { ...base.market, adStats: [] }, adTotals }, <AdsTab onClose={noop} />);

  it('an ad that ran keeps its figures when its rows leave the window', () => {
    const card = html.slice(html.indexOf(`« ${c.hook} »`));
    expect(card.slice(0, card.indexOf('</article>'))).toContain('dernière diffusion J12');
    expect(card.slice(0, card.indexOf('</article>'))).not.toContain('Pas encore diffusée');
    expect(count(html, 'Pas encore diffusée')).toBe(base.company.creatives.length - 1);
  });
  it('the chart reads the same days whichever snapshot carried it', () => {
    expect(html).not.toContain('Aucune campagne n’a encore tourné.');
  });
});

describe('Galerie: the total of the run', () => {
  const base = mockSnapshot();
  const shown = base.company.deliverables.length;
  it('says how much of it the page holds, and counts each kind on the run', () => {
    const html = render({ ...base, deliverableCounts: { pdf: 32, cover: 12, sales_page: 12, report: 40, research: 87, ad_preview: 133, ad_storyboard: 133 } }, <GalleryTab onClose={noop} />);
    expect(html).toContain(`${shown} sur 449 livrables`);
    expect(html).toMatch(/seg-count">449</);
    expect(html).toMatch(/seg-count">32</);
  });
  it('a complete list claims nothing more', () => {
    const counts: NonNullable<CompanySnapshot['deliverableCounts']> = {};
    for (const d of base.company.deliverables) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
    const html = render({ ...base, deliverableCounts: counts }, <GalleryTab onClose={noop} />);
    expect(html).toContain(`${shown} livrables réels`);
    expect(html).not.toContain(' sur ');
  });
});

describe('Apprentissage: what an A/B test measures', () => {
  const base = mockSnapshot();
  const experiment = (o: Partial<CompanySnapshot['company']['experiments'][number]>) => ({
    ...base.company.experiments[0]!, status: 'concluded' as const, variants: ['29', '24'], winner: '29',
    results: { 29: { value: 0.4622, n: 502 }, 24: { value: 0.3641, n: 725 } }, ...o,
  });
  const learning = (e: ReturnType<typeof experiment>) => render({ ...base, company: { ...base.company, experiments: [e] } }, <LearningTab onClose={noop} />);

  it('a price test is read in euros per visitor, not as a losing ROAS', () => {
    const html = learning(experiment({ dimension: 'price', metric: 'roas' }));
    expect(html).toContain('Profit par visiteur');
    expect(html).toMatch(/0,46\s€/);
    expect(html).not.toContain('0,46×');
  });
  it('a price test on refunds stays a rate, an ad test stays a ROAS', () => {
    expect(learning(experiment({ dimension: 'price', metric: 'refund_rate' }))).toMatch(/46,2\s%/);
    const ad = learning(experiment({ dimension: 'hook_style', metric: 'roas' }));
    expect(ad).toContain('0,46×');
    expect(ad).not.toContain('Profit par visiteur');
  });
});

describe('a finished run', () => {
  it('takes no more missions', () => {
    const html = render({ ...mockSnapshot(), status: 'finished' }, <MissionBar />);
    expect(html).toContain('Simulation terminée');
    expect(html).toMatch(/<input[^>]*disabled=""/);
  });
  it('a run in progress still does', () => {
    const html = render({ ...mockSnapshot(), status: 'goal_reached' }, <MissionBar />);
    expect(html).not.toContain('Simulation terminée');
    expect(html).not.toMatch(/<input[^>]*disabled=""/);
  });
});

describe('Finance: payment reserves and ledger counts', () => {
  const ledgerOf = (s: CompanySnapshot, extra: CompanySnapshot['ledger']) => ({ ...s, ledger: [...s.ledger, ...extra] });
  const hold = { id: 'led_h', day: 9, type: 'platform_fee' as const, amount: -1374.3, memo: 'Réserve de sécurité', ref: 'hold:evt_1' };
  const release = { id: 'led_r', day: 16, type: 'platform_fee' as const, amount: 1374.3, memo: 'Libération de la réserve', ref: 'hold:release:16' };
  const pnlBlock = (html: string) => html.slice(html.indexOf('Par type d’écriture'), html.indexOf('Compute (Claude)'));

  const fee = { id: 'led_f', day: 9, type: 'platform_fee' as const, amount: -12.61, memo: 'Frais', ref: 'fixed:9' };
  const AMOUNT = /1\s374,30/;

  it('an active reserve has its own line, and platform fees do not move', () => {
    const block = pnlBlock(render(ledgerOf(mockSnapshot(), [fee, hold]), <FinanceTab onClose={noop} />));
    expect(block).toContain('Réserve de paiement (temporaire)');
    expect(block).toMatch(AMOUNT);
    expect(block).not.toMatch(/−1\s374,30/); // not a cost
    expect(block).toMatch(/Frais plateforme<\/span>.*?−12,61/);
  });
  it('a release alone is no income', () => {
    const block = pnlBlock(render(ledgerOf(mockSnapshot(), [fee, release]), <FinanceTab onClose={noop} />));
    expect(block).not.toMatch(AMOUNT);
    expect(block).not.toContain('Réserve de paiement');
    expect(block).toMatch(/Frais plateforme<\/span>.*?−12,61/);
  });
  it('the ledger table names the reserve instead of a fee', () => {
    const html = render(ledgerOf(mockSnapshot(), [hold]), <FinanceTab onClose={noop} />);
    expect(html).toMatch(/lt-hold">Réserve de paiement \(temporaire\)</);
  });
  it('a whole ledger says so, a trimmed one says how many entries it holds', () => {
    const s = mockSnapshot();
    expect(render(s, <FinanceTab onClose={noop} />)).toContain(`Grand livre · ${s.ledger.length} écritures`);
    const html = render({ ...s, ledger: s.ledger.slice(1) }, <FinanceTab onClose={noop} />);
    expect(html).toContain(`Grand livre · ${s.ledger.length - 1} dernières écritures`);
    expect(html).not.toContain('150 dernières');
  });
  it('no-burn runway is not called profitable', () => {
    const s = mockSnapshot();
    const html = render({ ...s, finance: { ...s.finance, runwayDays: null, profit7d: -5 } }, <FinanceTab onClose={noop} />);
    expect(html).toContain('illimitée');
    expect(html).toContain('dernière semaine sans perte');
    expect(html).not.toContain('>rentable<');
  });
  it('prints the latest weekly P&L per product', () => {
    const s = mockSnapshot();
    const report: WeeklyPnl = { week: 2, fromDay: 8, toDay: 14, unallocated: -35, total: 120.5, products: [{ productId: s.company.products[0]!.id, title: 'Guide du chiot', sales: 12, revenue: 240, refunds: 24, adSpend: 40, fees: 8, creators: 0, profit: 168, roas: 5.4 }] };
    const html = render({ ...s, company: { ...s.company, pnl: [{ ...report, week: 1, products: [] }, report] } }, <FinanceTab onClose={noop} />);
    expect(html).toContain('Résultat par produit · semaine 2');
    expect(html).toContain('Guide du chiot');
    expect(html).toContain('+168,00');
  });
});

describe('deliverables that are brain notes', () => {
  const note: Deliverable = { id: 'dlv_n', kind: 'report', title: 'Rapport du jour 29', productId: null, creativeId: null, path: 'brain/journal/jour-029.md', createdBy: 'raphael', day: 29, quality: null };
  const withDeliverables = (list: Deliverable[]) => { const s = mockSnapshot(); return { ...s, company: { ...s.company, deliverables: list } }; };

  it('open in the Cerveau reader, not as a raw file', () => {
    const html = render(withDeliverables([note]), <GalleryTab onClose={noop} />);
    expect(html).toContain('<button type="button" class="tile"');
    expect(html).not.toContain('href="/runs/');
    const link = render(mockSnapshot(), <DeliverableLink path={note.path}>Rapport</DeliverableLink>);
    expect(link).toContain('<button');
    expect(link).not.toContain('jour-029.md"');
  });
  it('other files stay new-tab links', () => {
    const pdf = render(mockSnapshot(), <DeliverableLink path="files/prd_1/v1/guide.pdf">PDF</DeliverableLink>);
    expect(pdf).toContain('href="/runs/');
    expect(pdf).toContain('target="_blank"');
  });
  it('stay disabled in demo mode', () => {
    expect(render(withDeliverables([note]), <GalleryTab onClose={noop} />, true)).toContain('tile is-disabled');
  });
});

describe('labels of the new statuses', () => {
  it('a cancelled experiment is not « Conclue »', () => {
    const s = mockSnapshot();
    const e = { ...s.company.experiments[0]!, id: 'exp_c', status: 'cancelled' as const, winner: null };
    const html = render({ ...s, company: { ...s.company, experiments: [e] } }, <LearningTab onClose={noop} />);
    expect(html).toContain('Annulée');
    expect(html).not.toContain('>Conclue<');
  });
  it('a campaign paused for an outage says so', () => {
    const s = mockSnapshot();
    const c = { ...s.company.campaigns[0]!, status: 'paused' as const, pausedFor: 'outage' as const };
    expect(render({ ...s, company: { ...s.company, campaigns: [c] } }, <AdsTab onClose={noop} />)).toContain('Pause panne');
  });
  it('blocking quality issues are shown without opening the remarks', () => {
    const s = withProduct(mockSnapshot(), (p) => ({ ...p, quality: p.quality && { ...p.quality, blocking: [{ dimension: 'compliance', text: 'Promesse de résultat garanti' }] } }));
    const html = render(s, <ProductsTab onClose={noop} />);
    expect(html).toContain('Points bloquants');
    expect(html).toContain('Promesse de résultat garanti');
  });
  it('a founder mission prints where it stands', () => {
    const s = mockSnapshot();
    const m = { ...s.company.missions[0]!, id: 'mis_o', status: 'failed' as const, outcome: 'Aucune niche ne correspond à ta demande.' };
    expect(render({ ...s, company: { ...s.company, missions: [m] } }, <TasksTab onClose={noop} />)).toContain('Aucune niche ne correspond à ta demande.');
  });
});

describe('scenario form', () => {
  it('shows the minimum budget the server states', () => {
    const s = mockSnapshot();
    const html = render({ ...s, session: { ...s.session!, minStartingCash: 140 } }, <ScenarioModal onClose={noop} onLoaded={noop} />);
    expect(html).toMatch(/Minimum 140\s€/);
  });
  it('number fields hold free text: no min, max or step for the browser to fight with', () => {
    const html = render(mockSnapshot(), <ScenarioModal onClose={noop} onLoaded={noop} />);
    expect(html).not.toContain('type="number"');
    expect(html).toContain('inputMode="decimal"');
  });
});

describe('Finance shows the CFO envelope', () => {
  it('ad cap, survival badge and note from company.budget', () => {
    const s = mockSnapshot();
    const html = render({ ...s, company: { ...s.company, budget: { day: s.day, adCap: 12.5, survival: true, note: 'Trésorerie sous 150 € : pub minimale.' } } }, <FinanceTab onClose={noop} />);
    expect(html).toContain('Enveloppe du CFO');
    expect(html).toContain('Mode survie');
    expect(html).toContain('12,50');
    expect(html).toContain('Trésorerie sous 150 € : pub minimale.');
  });
  it('no card without budget', () => {
    const s = mockSnapshot();
    expect(render({ ...s, company: { ...s.company, budget: null } }, <FinanceTab onClose={noop} />)).not.toContain('Enveloppe du CFO');
  });
});

describe('HUD follows snapshot.session', () => {
  const sess = (o: Partial<SessionInfo>): SessionInfo => ({ runId: 'demo-pixel-agency', playing: true, speed: 4, busy: false, mindMode: 'heuristic', lastError: null, ...o });
  it('pause button + active speed from the session, error chip from lastError', () => {
    const s: CompanySnapshot = { ...mockSnapshot(), status: 'paused', session: sess({ playing: true, speed: 4, lastError: 'ENOSPC: disque plein' }) };
    const html = render(s, <SimHud sim={sessionView(s, 1)} onControl={noop} busy={false} />);
    expect(html).toContain('title="Pause"');
    expect(html).toMatch(/class="speed-btn speed-on"[^>]*>×4</);
    expect(html).toContain('Incident');
    expect(html).toContain('ENOSPC: disque plein');
  });
  it('paused loop shows the play button', () => {
    const s: CompanySnapshot = { ...mockSnapshot(), status: 'running', session: sess({ playing: false, speed: 2 }) };
    const html = render(s, <SimHud sim={sessionView(s, 8)} onControl={noop} busy={false} />);
    expect(html).toContain('title="Lecture"');
    expect(html).toMatch(/class="speed-btn speed-on"[^>]*>×2</);
    expect(html).not.toContain('Incident');
  });
  it('the founder keeps every control after the goal or a bankruptcy, none once the run is finished', () => {
    const controls = (status: CompanySnapshot['status']) => {
      const s: CompanySnapshot = { ...mockSnapshot(), status, session: sess({ playing: true, speed: 4 }) };
      const html = render(s, <SimHud sim={sessionView(s, 1)} onControl={noop} busy={false} />);
      const group = html.slice(html.indexOf('class="speed"'));
      return { pause: html.includes('title="Pause"'), disabled: group.split('disabled=""').length - 1 };
    };
    expect(controls('goal_reached')).toEqual({ pause: true, disabled: 0 });
    expect(controls('bankrupt')).toEqual({ pause: true, disabled: 0 });
    expect(controls('finished')).toEqual({ pause: false, disabled: 7 });
  });
});

describe('run milestone banner', () => {
  const banner = (status: CompanySnapshot['status']) => render({ ...mockSnapshot(), status }, <EndBanner onNewScenario={noop} onDismiss={noop} onFinance={noop} />);
  it('a bankrupt agency continues in survival mode', () => {
    const html = banner('bankrupt');
    expect(html).toContain('Faillite');
    expect(html).toContain('continue en mode survie');
    expect(html).not.toContain('relance un scénario');
  });
  it('a reached goal keeps the agency running', () => {
    expect(banner('goal_reached')).toContain('continue de tourner');
  });
  it('a goal reached after the deadline says so, on the banner and on the Finance bar', () => {
    const s = mockSnapshot();
    const late: CompanySnapshot = { ...s, status: 'goal_reached', scenario: { ...s.scenario, goal: { targetProfit: 1000, byDay: 20 } }, goalReachedDay: 31 };
    const html = render(late, <EndBanner onNewScenario={noop} onDismiss={noop} onFinance={noop} />);
    expect(html).toContain('Objectif atteint après l’échéance');
    expect(html).toContain('atteints au jour 31, l’échéance était le jour 20');
    expect(html).not.toContain('Objectif atteint !');
    expect(render(late, <FinanceTab onClose={noop} />)).toContain('Atteint au jour 31, après l’échéance');
    const inTime = render({ ...late, goalReachedDay: 18 }, <FinanceTab onClose={noop} />);
    expect(inTime).not.toContain('après l’échéance');
  });
  it('nothing while the run is ordinary', () => {
    expect(banner('running')).toBe('');
  });
});

describe('toasts', () => {
  const toast = (id: number, o: Partial<Toast> = {}): Toast => ({ id, tone: 'warn', title: 'Pub refusée', text: 'promesse', ttl: 5000, ...o });
  it('render the « Voir le produit » action of event toasts', () => {
    const html = renderToStaticMarkup(<Toasts toasts={[toast(1, { action: { label: 'Voir le produit', run: noop } })]} onDismiss={noop} />);
    expect(html).toContain('Voir le produit');
    expect(html).toContain('toast-action');
  });
  it('do not stack an identical visible toast', () => {
    const list = addToast([], toast(1));
    expect(addToast(list, toast(2))).toBe(list);
    expect(addToast(list, toast(3, { title: 'Autre' }))).toHaveLength(2);
  });
});
