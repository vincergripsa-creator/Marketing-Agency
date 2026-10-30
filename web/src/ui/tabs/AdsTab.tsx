// Pub TikTok: KPIs, campaigns, creatives (phone previews), spend vs revenue, comments, account health.
import { useMemo, useState } from 'react';
import type { AdComment, AdCreative, DailyAdStats } from '../../../../shared/types';
import { fileUrl } from '../../api';
import { LineChart, SERIES } from '../charts';
import { cx, Empty, FileLink, Overlay, Pill, SectionTitle, Segmented, Stat } from '../common';
import { useApp } from '../context';
import { fmtCompact, fmtEur, fmtEurShort, fmtInt, fmtPct, fmtRoas, safeDiv, sum } from '../format';
import { Icon } from '../icons';
import { agentName, FORMAT_LABEL, HOOK_LABEL } from '../labels';

interface Agg { spend: number; impressions: number; clicks: number; purchases: number; revenue: number; landingViews: number; frequency: number }

function aggregate(rows: DailyAdStats[]): Agg {
  return {
    spend: sum(rows, (r) => r.spend),
    impressions: sum(rows, (r) => r.impressions),
    clicks: sum(rows, (r) => r.clicks),
    purchases: sum(rows, (r) => r.purchases),
    revenue: sum(rows, (r) => r.revenue),
    landingViews: sum(rows, (r) => r.landingViews),
    frequency: rows.length ? Math.max(...rows.map((r) => r.frequency || 0)) : 0,
  };
}

const TONE_LABEL: Record<AdComment['tone'], string> = { positive: 'positif', negative: 'négatif', troll: 'troll', question: 'question' };
const TONE_PILL: Record<AdComment['tone'], 'green' | 'red' | 'violet' | 'blue'> = { positive: 'green', negative: 'red', troll: 'violet', question: 'blue' };

type CreativeFilter = 'all' | 'approved' | 'rejected' | 'pending';

export function AdsTab({ onClose }: { onClose(): void }) {
  const { snapshot, lookups } = useApp();
  const [cf, setCf] = useState<CreativeFilter>('all');
  const day = snapshot?.day ?? 1;
  const stats = snapshot?.market?.adStats ?? [];
  const campaigns = snapshot?.company?.campaigns ?? [];
  const creatives = snapshot?.company?.creatives ?? [];
  const account = snapshot?.market?.adAccount ?? { strikes: 0, banned: false, bannedUntilDay: 0 };
  const organic = snapshot?.market?.organicPosts ?? [];

  const last7 = useMemo(() => aggregate(stats.filter((s) => s.day > day - 7)), [stats, day]);
  const byDay = useMemo(() => {
    const days = [...new Set(stats.map((s) => s.day))].sort((a, b) => a - b);
    return days.map((d) => ({ d, ...aggregate(stats.filter((s) => s.day === d)) }));
  }, [stats]);
  const byCreative = useMemo(() => {
    const m = new Map<string, DailyAdStats[]>();
    for (const s of stats) m.set(s.creativeId, [...(m.get(s.creativeId) ?? []), s]);
    return new Map([...m].map(([k, v]) => [k, aggregate(v)] as const));
  }, [stats]);
  const comments = useMemo(() => {
    const out: (AdComment & { day: number; creativeId: string })[] = [];
    for (const s of [...stats].sort((a, b) => b.day - a.day)) {
      for (const c of s.comments ?? []) { out.push({ ...c, day: s.day, creativeId: s.creativeId }); if (out.length >= 14) return out; }
    }
    return out;
  }, [stats]);

  const shownCreatives = [...creatives]
    .filter((c) => cf === 'all' || c.review?.status === cf)
    .sort((a, b) => b.createdDay - a.createdDay);

  return (
    <Overlay title="Pub TikTok" subtitle="Plateforme publicitaire virtuelle · validation, diffusion, fatigue des créas" icon="music" onClose={onClose}>
      <div className="stats-row">
        <Stat label="Dépense 7 j" value={fmtEur(last7.spend)} sub={`total ${fmtEur(snapshot?.finance?.adSpend, 0)}`} icon="euro" />
        <Stat label="Impressions 7 j" value={fmtCompact(last7.impressions)} sub={`${fmtInt(last7.clicks)} clics`} icon="eye" />
        <Stat label="CTR" value={last7.impressions ? fmtPct(safeDiv(last7.clicks, last7.impressions), 2) : '—'} sub="objectif ≥ 1,5 %" icon="target" tone={last7.impressions ? (safeDiv(last7.clicks, last7.impressions) >= 0.015 ? 'good' : 'warn') : null} />
        <Stat label="CPC" value={last7.clicks ? fmtEur(safeDiv(last7.spend, last7.clicks)) : '—'} sub={`${fmtInt(last7.purchases)} achats`} icon="cart" />
        <Stat label="ROAS 7 j" value={last7.spend ? fmtRoas(safeDiv(last7.revenue, last7.spend)) : '—'} sub="rentable ≥ 1,5×" icon="trendUp" tone={last7.spend ? (safeDiv(last7.revenue, last7.spend) >= 1.5 ? 'good' : 'bad') : null} />
      </div>

      <AccountHealth strikes={account.strikes} banned={account.banned} until={account.bannedUntilDay} day={day} />

      <div className="two-col">
        <div className="card">
          <SectionTitle>Dépense vs revenu pub, par jour</SectionTitle>
          <LineChart
            ariaLabel="Dépense publicitaire et revenu attribué par jour"
            labels={byDay.map((r) => `J${r.d}`)}
            series={[
              { id: 'spend', label: 'Dépense', color: SERIES.orange, values: byDay.map((r) => r.spend) },
              { id: 'rev', label: 'Revenu attribué', color: SERIES.blue, values: byDay.map((r) => r.revenue), area: true },
            ]}
            format={fmtEurShort}
            emptyText="Aucune campagne n’a encore tourné."
          />
        </div>
        <div className="card">
          <SectionTitle>Commentaires récents</SectionTitle>
          {comments.length === 0 ? <Empty compact icon="chat">Pas encore de commentaire sous les pubs.</Empty> : (
            <div className="comments">
              {comments.map((c, i) => (
                <div key={i} className={cx('comment', `comment-${c.tone}`)}>
                  <span className="comment-author">@{c.author}</span>
                  <span className="comment-text">{c.text}</span>
                  <Pill tone={TONE_PILL[c.tone]}>{TONE_LABEL[c.tone]}</Pill>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <SectionTitle>Campagnes · {campaigns.length}</SectionTitle>
      {campaigns.length === 0 ? <Empty compact icon="megaphone">Aucune campagne lancée. Le Growth attend un produit en vente et des créas validées.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Campagne</th><th>Produit</th><th>Statut</th><th className="num">Budget/j</th><th className="num">Créas</th><th className="num">Dépense 7 j</th><th className="num">ROAS 7 j</th><th>Lancée</th></tr></thead>
            <tbody>
              {campaigns.map((c) => {
                const a = aggregate(stats.filter((s) => s.campaignId === c.id && s.day > day - 7));
                const roas = safeDiv(a.revenue, a.spend);
                return (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong><div className="muted small">par {agentName(lookups, c.createdBy)}</div></td>
                    <td className="small">{lookups.products.get(c.productId)?.title ?? c.productId}</td>
                    <td><Pill tone={c.status === 'active' ? 'green' : c.status === 'rejected' ? 'red' : 'neutral'}>{{ active: 'Active', paused: 'En pause', rejected: 'Refusée', ended: 'Terminée' }[c.status]}</Pill></td>
                    <td className="num">{fmtEur(c.dailyBudget, 0)}</td>
                    <td className="num">{c.creativeIds.length}</td>
                    <td className="num">{fmtEur(a.spend)}</td>
                    <td className={cx('num', a.spend ? (roas >= 1.5 ? 'txt-good' : 'txt-bad') : 'muted')}>{a.spend ? fmtRoas(roas) : '—'}</td>
                    <td className="small">J{c.startDay}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="filters-row">
        <SectionTitle>Créas · {creatives.length}</SectionTitle>
        <Segmented<CreativeFilter> size="sm" value={cf} onChange={setCf} options={[
          { id: 'all', label: 'Toutes', count: creatives.length },
          { id: 'approved', label: 'Approuvées', count: creatives.filter((c) => c.review?.status === 'approved').length },
          { id: 'rejected', label: 'Refusées', count: creatives.filter((c) => c.review?.status === 'rejected').length },
          { id: 'pending', label: 'En validation', count: creatives.filter((c) => c.review?.status === 'pending').length },
        ]} />
      </div>
      {shownCreatives.length === 0 ? <Empty compact icon="film">Aucune créa dans cette catégorie.</Empty> : (
        <div className="creative-grid">
          {shownCreatives.map((c) => <CreativeCard key={c.id} c={c} agg={byCreative.get(c.id)} />)}
        </div>
      )}

      <SectionTitle>Posts organiques · {organic.length}</SectionTitle>
      {organic.length === 0 ? <Empty compact icon="music">Pas encore de post organique.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Jour</th><th>Hook</th><th>Style</th><th className="num">Vues</th><th className="num">J’aime</th><th className="num">Clics</th><th className="num">Ventes</th></tr></thead>
            <tbody>
              {[...organic].sort((a, b) => b.day - a.day).slice(0, 15).map((p) => (
                <tr key={p.id}>
                  <td className="small">J{p.day}</td>
                  <td>{p.hook}{p.viral ? <> <Pill tone="pink" icon="zap">viral</Pill></> : null}</td>
                  <td className="small">{HOOK_LABEL[p.hookStyle] ?? p.hookStyle} · {FORMAT_LABEL[p.format] ?? p.format}</td>
                  <td className="num">{fmtCompact(p.views)}</td>
                  <td className="num">{fmtCompact(p.likes)}</td>
                  <td className="num">{fmtInt(p.clicks)}</td>
                  <td className="num">{fmtInt(p.sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Overlay>
  );
}

function AccountHealth({ strikes, banned, until, day }: { strikes: number; banned: boolean; until: number; day: number }) {
  const level = banned ? 'bad' : strikes >= 2 ? 'warn' : 'good';
  return (
    <div className={cx('health', `health-${level}`)}>
      <Icon name="shield" size={18} />
      <div>
        <strong>Santé du compte publicitaire : {banned ? 'suspendu' : strikes === 0 ? 'excellente' : strikes === 1 ? 'un avertissement' : 'en danger'}</strong>
        <span className="small">
          {banned
            ? `Compte banni${until > day ? ` jusqu’au jour ${until}` : ''} : plus aucune pub ne tourne. Cap sur l’organique et les créateurs.`
            : `${strikes} avertissement${strikes > 1 ? 's' : ''} de conformité. Chaque promesse excessive refusée rapproche d’une suspension.`}
        </span>
      </div>
      <div className="strikes" aria-label={`${strikes} avertissements`}>
        {[0, 1, 2].map((i) => <span key={i} className={cx('strike', i < strikes && 'strike-on')} />)}
      </div>
    </div>
  );
}

function CreativeCard({ c, agg }: { c: AdCreative; agg: Agg | undefined }) {
  const { runId, demo, lookups } = useApp();
  const [load, setLoad] = useState(false);
  const preview = c.files?.preview ? fileUrl(runId, c.files.preview) : '';
  const frame = c.files?.storyboard?.[0] ? fileUrl(runId, c.files.storyboard[0]) : '';
  const st = c.review?.status ?? 'pending';
  const ctr = agg ? safeDiv(agg.clicks, agg.impressions) : 0;
  const roas = agg ? safeDiv(agg.revenue, agg.spend) : 0;
  return (
    <article className="creative">
      <div className="phone">
        {load && preview && !demo ? (
          <iframe src={preview} title={`Aperçu : ${c.hook}`} sandbox="allow-scripts" loading="lazy" />
        ) : (
          <button type="button" className="phone-poster" onClick={() => setLoad(true)} disabled={!preview || demo} title={preview && !demo ? 'Charger l’aperçu animé' : 'Aperçu indisponible'}>
            {frame && !demo ? <img src={frame} alt="" loading="lazy" /> : <span className="phone-hook">{c.hook}</span>}
            {preview && !demo ? <span className="phone-play"><Icon name="play" size={18} /></span> : null}
          </button>
        )}
      </div>
      <div className="creative-body">
        <div className="creative-hook">« {c.hook} »</div>
        <div className="chip-row">
          <span className="chip chip-sm">{HOOK_LABEL[c.hookStyle] ?? c.hookStyle}</span>
          <span className="chip chip-sm">{FORMAT_LABEL[c.format] ?? c.format}</span>
          {c.quality ? <span className="chip chip-sm">Qualité {Math.round(c.quality.overall)}</span> : null}
        </div>
        <div className={cx('review-status', `rs-${st}`)}>
          <Icon name={st === 'approved' ? 'check' : st === 'rejected' ? 'ban' : 'clock'} size={12} />
          {st === 'approved' ? 'Approuvée' : st === 'rejected' ? 'Refusée' : 'En validation'}
          {st === 'rejected' && c.review?.reason ? <span> — {c.review.reason}</span> : null}
        </div>
        {agg && agg.impressions > 0 ? (
          <div className="creative-stats small">
            <span><strong>{fmtCompact(agg.impressions)}</strong> impr.</span>
            <span><strong>{fmtPct(ctr, 2)}</strong> CTR</span>
            <span><strong>{fmtInt(agg.purchases)}</strong> achats</span>
            <span className={roas >= 1.5 ? 'txt-good' : 'txt-bad'}><strong>{fmtRoas(roas)}</strong> ROAS</span>
            {agg.frequency > 2.5 ? <span className="txt-warn" title="Fréquence élevée : l’audience se lasse">fatigue ×{agg.frequency.toFixed(1).replace('.', ',')}</span> : null}
          </div>
        ) : <div className="muted small">Pas encore diffusée.</div>}
        <div className="muted small">J{c.createdDay} · {agentName(lookups, c.createdBy)} · {c.scenes?.length ?? 0} scènes</div>
        {c.files?.preview || c.files?.storyboard?.length ? (
          <div className="product-actions">
            <FileLink runId={runId} path={c.files.preview} demo={demo} icon="external" title="Ouvrir l’aperçu animé 9:16 dans un nouvel onglet">Aperçu de la pub</FileLink>
            <FileLink runId={runId} path={c.files.storyboard?.[0]} demo={demo} icon="film" title="Ouvrir le storyboard dans un nouvel onglet">Storyboard</FileLink>
          </div>
        ) : null}
      </div>
    </article>
  );
}
