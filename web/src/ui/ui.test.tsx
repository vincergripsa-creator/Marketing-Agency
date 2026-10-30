// Server-side render checks of the panels fixed after the review (no DOM needed).
// Run: cd server && npx vitest run --root ../web/src
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CompanySnapshot, Product, SessionInfo } from '../../../shared/types';
import { mockSnapshot } from '../world/mockSnapshot';
import { FileLink } from './common';
import { AppContext, type AppCtx } from './context';
import { sessionView } from './derive';
import { SimHud } from './Hud';
import { buildLookups } from './labels';
import { AdsTab } from './tabs/AdsTab';
import { FinanceTab } from './tabs/FinanceTab';
import { InboxTab } from './tabs/InboxTab';
import { ProductsTab } from './tabs/ProductsTab';
import { addToast, Toasts, type Toast } from './Toasts';

const noop = () => undefined;

function render(s: CompanySnapshot, el: ReactElement, demo = false): string {
  const ctx: AppCtx = {
    snapshot: s, lookups: buildLookups(s), activity: s.activity, demo, godMode: false, runId: s.runId,
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
