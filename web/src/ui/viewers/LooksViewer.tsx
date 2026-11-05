// A guide's design, in one layer (design plan D207): what it wears today, every look it wore version by version with the agent's
// reason, its page tests, and its sales page at phone and desktop size. The whole log comes from GET /api/product, the stream keeps the last.
import { useState } from 'react';
import type { DesignLogEntry, Experiment, Product } from '../../../../shared/types';
import { fileUrl } from '../../api';
import { cx, Pill } from '../common';
import { useApp } from '../context';
import { coverPathOf, isRefresh, lookBlurb, lookLabel, lookOf, pageTestsOf, readableLine, V1_STYLE_NOTE, versionsOf, type LookVersion } from '../design';
import { Icon } from '../icons';
import { LookChips, PageTestRow } from '../Looks';
import { useDetail } from '../useDetail';
import { Lightbox } from './Lightbox';
import { SalesPageViewer } from './SalesPageViewer';

export type LooksTab = 'looks' | 'page';

/** The whole log of the product view, and what the stream learned since it came. Pure, unit-tested. */
export function mergedLog(full: readonly DesignLogEntry[] | undefined, live: readonly DesignLogEntry[] | undefined): DesignLogEntry[] {
  const base = [...(full ?? [])];
  const last = base.at(-1);
  const newer = (live ?? []).filter((e) => !last || e.day > last.day || (e.day === last.day && e.version > last.version));
  return [...base, ...newer];
}

/** The product the layer draws: the server's whole guide when it came, the stream's card for what moves (price, page of the day). */
export function productForLooks(card: Product | undefined, full: Product | null | undefined): Product | null {
  if (!card) return full ?? null;
  if (!full || full.id !== card.id) return card;
  return { ...full, ...card, designLog: mergedLog(full.designLog, card.designLog), salesPage: card.salesPage ?? full.salesPage, design: card.design ?? full.design };
}

export function LooksLightbox({ productId, initial = 'looks', onClose }: { productId: string; initial?: LooksTab; onClose(): void }) {
  const { lookups, snapshot, runId, demo } = useApp();
  const [opened] = useState(snapshot?.day ?? 1); // one fetch per opening: the stream moves the card meanwhile
  const detail = useDetail<Product>(demo ? null : `/api/product/${encodeURIComponent(productId)}`, opened);
  const product = productForLooks(lookups.products.get(productId), detail.data);
  const [tab, setTab] = useState<LooksTab>(initial);
  if (!product) {
    return (
      <Lightbox title="Design du guide" onClose={onClose}>
        <div className="lightbox-wait">{detail.loading ? 'Ouverture du guide…' : 'Ce guide n’est plus dans le catalogue de l’agence.'}</div>
      </Lightbox>
    );
  }
  const page = product.files?.salesPage ? fileUrl(runId, product.files.salesPage) : null;
  const cover = product.files?.cover ? fileUrl(runId, product.files.cover) : null;
  const shown: LooksTab = tab === 'page' && page ? 'page' : 'looks';
  return (
    <Lightbox title={`Design de « ${product.title} »`} href={shown === 'page' ? page : cover} onClose={onClose}>
      <div className="looks-tabs" role="tablist" aria-label="Design du guide">
        <button type="button" role="tab" aria-selected={shown === 'looks'} className={cx('vp-btn', shown === 'looks' && 'vp-on')} data-tab="looks" onClick={() => setTab('looks')}>
          <Icon name="palette" size={13} /> Les looks, version par version
        </button>
        <button type="button" role="tab" aria-selected={shown === 'page'} className={cx('vp-btn', shown === 'page' && 'vp-on')} data-tab="page" disabled={!page} onClick={() => setTab('page')} title={page ? undefined : 'La page de vente n’est pas encore écrite'}>
          <Icon name="store" size={13} /> La page de vente
        </button>
      </div>
      {shown === 'page' && page ? <SalesPageViewer url={page} title={`Page de vente de « ${product.title} »`} /> : (
        <DesignStory product={product} experiments={snapshot?.company?.experiments ?? []} day={snapshot?.day ?? 1} loading={detail.loading && !detail.data} />
      )}
    </Lightbox>
  );
}

function CoverOf({ product, version }: { product: Product; version: number }) {
  const { runId } = useApp();
  const [broken, setBroken] = useState(false);
  const path = version === product.version && product.files?.cover ? product.files.cover : coverPathOf(product, version);
  if (broken) return <span className="look-cover-missing"><Icon name="image" size={22} strokeWidth={1.5} /><span>Couverture v{version} absente</span></span>;
  return <img src={fileUrl(runId, path)} alt={`Couverture v${version} de « ${product.title} »`} onError={() => setBroken(true)} />;
}

function VersionCard({ product, v, now }: { product: Product; v: LookVersion; now: boolean }) {
  return (
    <li className={cx('look-card', now && 'is-now', v.refresh && 'is-refresh')} data-version={v.version}>
      <div className="look-cover"><CoverOf product={product} version={v.version} /></div>
      <div className="look-card-head">
        <strong>v{v.version}</strong>
        {v.day !== null ? <span className="look-day">J{v.day}</span> : null}
        {v.refresh ? <Pill tone="violet" icon="refresh">Refonte</Pill> : null}
        {now ? <Pill tone="green">Aujourd’hui</Pill> : null}
      </div>
      <LookChips look={{ style: v.style, template: v.template, hero: v.hero, page: !!(v.template || v.hero) }} />
      {v.entries.length ? (
        <ul className="look-whys">
          {v.entries.map((e, i) => <li key={`${e.day}-${i}`}><span className="look-day">J{e.day}</span> {readableLine(e.why)}</li>)}
        </ul>
      ) : <p className="look-whys-none">Même look que la version d’avant, ou un guide d’avant les looks.</p>}
    </li>
  );
}

export function DesignStory({ product, experiments, day, loading = false }: { product: Product; experiments: readonly Experiment[]; day: number; loading?: boolean }) {
  const look = lookOf(product);
  const versions = versionsOf(product);
  const tests = pageTestsOf(experiments, product.id).sort((a, b) => b.day - a.day);
  const last = product.designLog?.at(-1);
  return (
    <div className="looks-story">
      <section className="looks-now">
        <div className="looks-now-head">
          <span className="looks-eyebrow">Aujourd’hui · v{product.version}</span>
          <LookChips look={look} />
          {last && isRefresh(last) ? <Pill tone="violet" icon="refresh">Refonte J{last.day}</Pill> : null}
        </div>
        <ul className="looks-blurbs">
          {look.style ? <li><strong>{lookLabel('style', look.style)}</strong> {lookBlurb('style', look.style)}</li> : null}
          {look.page ? <li><strong>Page {lookLabel('template', look.template)}</strong> {lookBlurb('template', look.template)}</li> : null}
          {look.page && look.hero ? <li><strong>{lookLabel('hero', look.hero)}</strong> {lookBlurb('hero', look.hero)}</li> : null}
        </ul>
        {!product.designLog?.length ? <p className="looks-note">{V1_STYLE_NOTE}</p> : null}
      </section>
      <section>
        <h3 className="looks-h">Ses looks, version par version{loading ? <span className="looks-loading"> · historique complet en route…</span> : null}</h3>
        <ol className="looks-strip">
          {versions.map((v, i) => <VersionCard key={v.version} product={product} v={v} now={i === versions.length - 1 && v.version >= product.version} />)}
        </ol>
      </section>
      {tests.length ? (
        <section>
          <h3 className="looks-h">Tests de page</h3>
          <div className="looks-tests">{tests.map((e) => <PageTestRow key={e.id} e={e} day={day} />)}</div>
        </section>
      ) : null}
    </div>
  );
}
