// Products: the PDF guides — cover, pipeline, quality, sales, reviews, files.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Product } from '../../../../shared/types';
import { fileUrl } from '../../api';
import { cx, Empty, FileLink, Overlay, Pill, QualityBars, qualityColor, SectionTitle, Segmented, Stat } from '../common';
import { useApp } from '../context';
import { nextStepTitle } from '../derive';
import { fmtEur, fmtInt, fmtPct, safeDiv, stars, sum } from '../format';
import { Icon } from '../icons';
import { nicheName, PIPELINE, PRODUCT_STATUS_LABEL, PRODUCT_STATUS_TONE } from '../labels';

type Filter = 'all' | 'live' | 'prod' | 'stopped';

/** focusId/focusSeq: product to scroll to and highlight (links from toasts, the journal, the calendar…). */
export function ProductsTab({ onClose, focusId = null, focusSeq = 0 }: { onClose(): void; focusId?: string | null; focusSeq?: number }) {
  const { snapshot } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const products = snapshot?.company?.products ?? [];
  const [highlight, setHighlight] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const known = !!focusId && products.some((p) => p.id === focusId);

  useEffect(() => {
    if (!focusId || !known) return;
    setFilter('all');
    setHighlight(focusId);
    const raf = requestAnimationFrame(() => {
      const el = gridRef.current?.querySelector<HTMLElement>(`[data-product-id="${CSS.escape(focusId)}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const t = setTimeout(() => setHighlight(null), 2600);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [focusId, focusSeq, known]);

  const groups = useMemo(() => ({
    live: products.filter((p) => p.status === 'live'),
    prod: products.filter((p) => ['idea', 'research', 'writing', 'design', 'qa', 'ready'].includes(p.status)),
    stopped: products.filter((p) => p.status === 'paused' || p.status === 'killed'),
  }), [products]);
  const list = filter === 'all' ? [...products].sort((a, b) => rank(a) - rank(b) || b.createdDay - a.createdDay) : groups[filter];

  const revenue = sum(products, (p) => p.stats?.revenue ?? 0);
  const sales = sum(products, (p) => p.stats?.sales ?? 0);
  const refunds = sum(products, (p) => p.stats?.refunds ?? 0);
  const rated = products.filter((p) => (p.stats?.rating ?? 0) > 0);
  const avgRating = rated.length ? sum(rated, (p) => p.stats.rating) / rated.length : 0;

  return (
    <Overlay title="Produits" subtitle="Les guides PDF de l’agence, de l’idée à la vente" icon="package" onClose={onClose}>
      <div className="stats-row">
        <Stat label="En vente" value={fmtInt(groups.live.length)} sub={`${groups.prod.length} en production`} icon="store" />
        <Stat label="Chiffre d’affaires" value={fmtEur(revenue)} sub={`${fmtInt(sales)} ventes`} icon="euro" />
        <Stat label="Taux de remboursement" value={sales ? fmtPct(safeDiv(refunds, sales)) : '—'} sub={`${fmtInt(refunds)} remboursements`} icon="refund" tone={sales && refunds / sales > 0.08 ? 'bad' : null} />
        <Stat label="Note moyenne" value={avgRating ? `${avgRating.toFixed(1).replace('.', ',')} / 5` : '—'} sub={avgRating ? stars(avgRating) : 'pas encore d’avis'} icon="star" tone={avgRating && avgRating < 4.2 ? 'warn' : null} />
      </div>
      <div className="filters-row">
        <Segmented<Filter> size="sm" value={filter} onChange={setFilter} options={[
          { id: 'all', label: 'Tous', count: products.length },
          { id: 'live', label: 'En vente', count: groups.live.length },
          { id: 'prod', label: 'En production', count: groups.prod.length },
          { id: 'stopped', label: 'En pause / abandonnés', count: groups.stopped.length },
        ]} />
      </div>
      {list.length === 0 ? (
        <Empty icon="package">{products.length === 0 ? 'Aucun guide pour l’instant : la Recherche cherche encore la bonne niche (règle du un : un problème, une personne).' : 'Aucun produit dans cette catégorie.'}</Empty>
      ) : (
        <div className="product-grid" ref={gridRef}>
          {list.map((p) => <ProductCard key={p.id} p={p} focused={highlight === p.id} />)}
        </div>
      )}
    </Overlay>
  );
}

function rank(p: Product): number {
  return p.status === 'live' ? 0 : p.status === 'ready' || p.status === 'qa' || p.status === 'design' || p.status === 'writing' ? 1 : p.status === 'paused' ? 3 : p.status === 'killed' ? 4 : 2;
}

function Cover({ p }: { p: Product }) {
  const { runId, demo } = useApp();
  const [broken, setBroken] = useState(false);
  const src = p.files?.cover ? fileUrl(runId, p.files.cover) : '';
  if (src && !broken && !demo) return <img className="cover-img" src={src} alt={`Couverture : ${p.title}`} loading="lazy" onError={() => setBroken(true)} />;
  const pal = p.design?.palette;
  return (
    <div className="cover-fallback" style={{ background: pal?.bg ?? '#1e293b', color: pal?.ink ?? '#fff', borderColor: pal?.primary ?? '#64748b' }}>
      <span className="cover-band" style={{ background: pal?.primary ?? '#f472b6' }} />
      <strong>{p.title}</strong>
      <span>{p.subtitle}</span>
      <span className="cover-brand" style={{ color: pal?.accent ?? '#fde047' }}>Pixel Agency</span>
    </div>
  );
}

function ProductCard({ p, focused = false }: { p: Product; focused?: boolean }) {
  const { lookups, runId, demo } = useApp();
  const [showIssues, setShowIssues] = useState(false);
  const st = p.stats ?? { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 };
  const upsellId = p.upsellProductId ?? p.content?.nextStep?.upsellProductId ?? null;
  const upsell = upsellId && upsellId !== p.id ? lookups.products.get(upsellId) : undefined;
  const stageIdx = PIPELINE.indexOf(p.status);
  const inProd = stageIdx >= 0 && p.status !== 'live';
  const history = (p.priceHistory ?? []).slice(-6);
  const cvr = safeDiv(st.sales, st.views);
  const q = p.quality;
  const nextTitle = nextStepTitle(p.content?.nextStep?.title);
  const nextText = (p.content?.nextStep?.text ?? '').trim();

  return (
    <article className={cx('product-card', focused && 'is-focus')} data-product-id={p.id}>
      <div className="product-cover"><Cover p={p} /></div>
      <div className="product-body">
        <div className="product-top">
          <Pill tone={PRODUCT_STATUS_TONE[p.status]}>{PRODUCT_STATUS_LABEL[p.status]}</Pill>
          <span className="chip chip-sm">v{p.version}</span>
          {q ? <span className="chip chip-sm" style={{ color: qualityColor(q.overall) }} title="Note qualité globale">Qualité {Math.round(q.overall)}</span> : null}
          <span className="flex1" />
          <span className="price">{fmtEur(p.price)}</span>
        </div>
        <h3 className="product-title">{p.title}</h3>
        {p.subtitle ? <div className="product-sub">{p.subtitle}</div> : null}
        <div className="product-meta small">
          <span><Icon name="users" size={11} /> {p.audience || '—'}</span>
          {p.problem ? <span><Icon name="target" size={11} /> {p.problem}</span> : null}
          <span className="muted">Niche : {nicheName(lookups, p.nicheId)}</span>
        </div>

        {inProd || p.status === 'live' ? (
          <div className="pipeline" aria-label="Avancement">
            {PIPELINE.map((s, i) => (
              <span key={s} className={cx('pipe-step', i < stageIdx && 'is-done', i === stageIdx && 'is-current')} title={PRODUCT_STATUS_LABEL[s]}>
                <span className="pipe-dot" />
                <span className="pipe-label">{PRODUCT_STATUS_LABEL[s]}</span>
              </span>
            ))}
          </div>
        ) : null}

        {history.length > 1 ? (
          <div className="price-history small">
            <Icon name="trendUp" size={11} /> Prix :
            {history.map((h, i) => <span key={`${h.day}-${i}`} className="price-step">{i ? '→' : ''} {fmtEur(h.price, 0)} <span className="muted">J{h.day}</span></span>)}
          </div>
        ) : null}

        <div className="product-stats">
          <div><strong>{fmtInt(st.views)}</strong><span>visites</span></div>
          <div><strong>{fmtInt(st.sales)}</strong><span>ventes</span></div>
          <div><strong>{st.views ? fmtPct(cvr) : '—'}</strong><span>conversion</span></div>
          <div><strong>{fmtEur(st.revenue, 0)}</strong><span>CA</span></div>
          <div><strong className={st.refunds ? 'txt-bad' : undefined}>{fmtInt(st.refunds)}</strong><span>rembours.</span></div>
          <div><strong>{st.rating ? st.rating.toFixed(1).replace('.', ',') : '—'}</strong><span>{st.rating ? stars(st.rating) : 'note'}</span></div>
        </div>

        <SectionTitle right={q?.issues?.length ? <button type="button" className="link-btn small" onClick={() => setShowIssues((v) => !v)}>{showIssues ? 'Masquer' : `${q.issues.length} remarque${q.issues.length > 1 ? 's' : ''}`}</button> : null}>
          Qualité du guide
        </SectionTitle>
        <QualityBars q={q} />
        {q?.blocking?.length ? (
          <div className="blocking">
            <strong className="small">Points bloquants</strong>
            <ul className="issues">{q.blocking.map((b, i) => <li key={i}>{b.text}</li>)}</ul>
          </div>
        ) : null}
        {showIssues && q?.issues?.length ?<ul className="issues">{q.issues.map((s, i) => <li key={i}>{s}</li>)}</ul> : null}

        {st.reviews?.length ? (
          <>
            <SectionTitle>Derniers avis</SectionTitle>
            <div className="reviews">
              {st.reviews.slice(-3).reverse().map((r) => (
                <div key={r.id} className="review">
                  <span className={cx('review-stars', r.rating <= 2 && 'txt-bad')}>{stars(r.rating)}</span>
                  <span className="review-text">« {r.text} »</span>
                  <span className="muted small">J{r.day}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <div className="product-actions">
          <FileLink runId={runId} path={p.files?.pdf} demo={demo} icon="file">Ouvrir le PDF</FileLink>
          <FileLink runId={runId} path={p.files?.salesPage} demo={demo} icon="store">Page de vente</FileLink>
          {!p.files?.pdf && !p.files?.salesPage ? <span className="muted small">Fichiers en cours de fabrication…</span> : null}
        </div>
        {upsell || nextTitle || nextText ? (
          <div className="upsell small" title={!upsell && nextText ? nextText : undefined}>
            <Icon name="arrowRight" size={12} /> <strong>La suite est ici :</strong>{' '}
            {upsell ? <>{upsell.title} <span className="muted">({PRODUCT_STATUS_LABEL[upsell.status].toLowerCase()}, {fmtEur(upsell.price, 0)})</span></> : nextTitle || <span className="muted">guide suivant en préparation</span>}
            {st.upsellSales ? <span className="txt-good"> · {fmtInt(st.upsellSales)} upsells</span> : null}
            {upsell?.files?.salesPage ? <> <FileLink runId={runId} path={upsell.files.salesPage} demo={demo} icon="external" className="upsell-link">Voir la page</FileLink></> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
