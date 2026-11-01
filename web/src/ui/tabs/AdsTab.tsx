// Publicité: KPIs, campaigns, creatives (phone previews), spend vs revenue, comments, account health, channel by channel.
import { useMemo, useState } from 'react';
import { acceptance, channelOf, CHANNELS, CHANNEL_IDS, DROPPED_REASON, droppedBeforeSubmission, type AdAccountId, type ChannelId } from '../../../../shared/channels';
import type { AdComment, AdCreative, AdWeekRow, ChannelAccountState, CompanySnapshot } from '../../../../shared/types';
import { fileUrl } from '../../api';
import { LineChart, SERIES } from '../charts';
import { cx, Empty, FileLink, Overlay, Pill, SectionTitle, Segmented, Stat } from '../common';
import { useApp } from '../context';
import { fmtCompact, fmtEur, fmtEurShort, fmtInt, fmtPct, fmtRoas, safeDiv, sum } from '../format';
import { Icon } from '../icons';
import { agentName, FORMAT_LABEL, HOOK_LABEL } from '../labels';
import { VideoLightbox } from '../viewers/VideoPlayer';
import './market.css';

interface Agg { spend: number; impressions: number; clicks: number; purchases: number; revenue: number; landingViews: number; frequency: number }

type AdRow = Omit<AdWeekRow, 'channel'> & Partial<Pick<AdWeekRow, 'channel'>>;

function aggregate(rows: readonly AdRow[]): Agg {
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
type ChannelFilter = 'all' | ChannelId;

type Review = { channel: ChannelId; status: AdCreative['review']['status']; reason: string | null };

/** A channel's verdict on each creative. `review` is TikTok's and stays pending for good on a cut or a Search ad, so only a master reads it. */
export function reviewsOf(c: AdCreative): Review[] {
  const out: Review[] = !c.masterId && acceptance('tiktok', c) !== null && c.review ? [{ channel: 'tiktok', status: c.review.status, reason: c.review.reason }] : [];
  for (const id of CHANNEL_IDS) {
    const r = c.channelReviews?.[id];
    if (id !== 'tiktok' && r) out.push({ channel: id, status: r.status, reason: r.reason });
  }
  return out;
}

const statusLabel = (r: Review): string => (r.status === 'approved' ? 'Approuvée' : r.status === 'pending' ? 'En validation' : droppedBeforeSubmission(r) ? 'Retirée' : 'Refusée');

/** A draft our own review withdrew: the label already says so, what follows is why. */
const reasonOf = (r: Review): string => (droppedBeforeSubmission(r) ? r.reason!.slice(DROPPED_REASON.length).replace(/^\s*:\s*/, '') : r.reason ?? '');

/** Accounts, not channels: YouTube and Search share Google's, so a Google ban stops both. */
const ACCOUNT_LABEL: Record<AdAccountId, string> = {
  tiktok: CHANNELS.tiktok.label, meta: CHANNELS.meta.label, google: `${CHANNELS.youtube.label} et ${CHANNELS.google.label}`, pinterest: CHANNELS.pinterest.label,
};

/** TikTok's account always exists, the others once someone asked for them. */
export function accountRows(market: Pick<CompanySnapshot['market'], 'adAccount' | 'channelAccounts'> | undefined): { id: AdAccountId; account: Pick<ChannelAccountState, 'strikes' | 'banned' | 'bannedUntilDay'> }[] {
  const others = (['meta', 'google', 'pinterest'] as const).flatMap((id) => {
    const account = market?.channelAccounts?.[id];
    return account && account.openDay !== null ? [{ id, account }] : [];
  });
  return [{ id: 'tiktok', account: market?.adAccount ?? { strikes: 0, banned: false, bannedUntilDay: 0 } }, ...others];
}

/** « 30 sur 126 »: a trimmed list never reads as the real total (ui §3.1). */
function ofTotal(shown: number, total: number | undefined): string {
  return total !== undefined && total > shown ? `${fmtInt(shown)} sur ${fmtInt(total)}` : fmtInt(shown);
}

export function ChannelPill({ id }: { id: ChannelId }) {
  const { label, color } = CHANNELS[id];
  return <span className="channel-pill"><span className="legend-dot" style={{ background: color }} />{label}</span>;
}

export function AdsTab({ onClose }: { onClose(): void }) {
  const { snapshot, lookups } = useApp();
  const [cf, setCf] = useState<CreativeFilter>('all');
  const [picked, setPicked] = useState<ChannelFilter>('all');
  const day = snapshot?.day ?? 1;
  const allStats = snapshot?.market?.adStats ?? [];
  const allCampaigns = snapshot?.company?.campaigns ?? [];
  const allCreatives = snapshot?.company?.creatives ?? [];
  const organic = snapshot?.market?.organicPosts ?? [];
  const adTotals = snapshot?.adTotals;
  // adStats keeps two or three days, fewer on the stream than in GET /api/state: every « 7 j » reads the server's week, whatever the snapshot kept
  const allWeek = useMemo<readonly AdRow[]>(() => adTotals?.week ?? allStats.filter((s) => s.day > day - 7), [adTotals, allStats, day]);

  const used = useMemo(() => {
    const seen = new Set<ChannelId>([...allCampaigns.map(channelOf), ...allWeek.map(channelOf), ...allStats.map(channelOf), ...allCreatives.flatMap((c) => reviewsOf(c).map((r) => r.channel))]);
    return CHANNEL_IDS.filter((id) => seen.has(id));
  }, [allCampaigns, allWeek, allStats, allCreatives]);
  const ch: ChannelFilter = picked !== 'all' && used.includes(picked) ? picked : 'all';
  const stats = useMemo(() => (ch === 'all' ? allStats : allStats.filter((s) => channelOf(s) === ch)), [allStats, ch]);
  const week = useMemo(() => (ch === 'all' ? allWeek : allWeek.filter((s) => channelOf(s) === ch)), [allWeek, ch]);
  const campaigns = ch === 'all' ? allCampaigns : allCampaigns.filter((c) => channelOf(c) === ch);
  const creatives = ch === 'all' ? allCreatives : allCreatives.filter((c) => reviewsOf(c).some((r) => r.channel === ch));
  const reviewFor = (c: AdCreative): Review | undefined => reviewsOf(c).find((r) => ch === 'all' || r.channel === ch);
  const countOf = (status: Review['status']) => creatives.filter((c) => reviewFor(c)?.status === status).length;
  // the server's totals add up every channel: a filter reads the rows the snapshot holds
  const totals = ch === 'all' ? adTotals : undefined;

  const last7 = useMemo(() => aggregate(week), [week]);
  // the chart and the cards read the server's totals, a filter the rows the snapshot holds
  const byDay = useMemo(() => {
    if (totals) return totals.days.map((r) => ({ d: r.day, spend: r.spend, revenue: r.revenue }));
    const days = [...new Set(stats.map((s) => s.day))].sort((a, b) => a - b);
    return days.map((d) => ({ d, ...aggregate(stats.filter((s) => s.day === d)) }));
  }, [stats, totals]);
  const recentByCreative = useMemo(() => {
    const m = new Map<string, AdRow[]>();
    for (const s of week) m.set(s.creativeId, [...(m.get(s.creativeId) ?? []), s]);
    return new Map([...m].map(([k, v]) => [k, aggregate(v)] as const));
  }, [week]);
  const comments = useMemo(() => {
    const out: (AdComment & { day: number; creativeId: string })[] = [];
    for (const s of [...stats].sort((a, b) => b.day - a.day)) {
      for (const c of s.comments ?? []) { out.push({ ...c, day: s.day, creativeId: s.creativeId }); if (out.length >= 14) return out; }
    }
    return out;
  }, [stats]);

  const shownCreatives = [...creatives]
    .filter((c) => cf === 'all' || reviewFor(c)?.status === cf)
    .sort((a, b) => b.createdDay - a.createdDay);

  return (
    <Overlay title="Publicité" subtitle="Plateformes publicitaires virtuelles · validation, diffusion, fatigue des créas" icon="megaphone" onClose={onClose}>
      {used.length > 1 ? (
        <div className="filters-row">
          <Segmented<ChannelFilter> size="sm" value={ch} onChange={setPicked} options={[
            { id: 'all', label: 'Tous les canaux', count: allCampaigns.length },
            ...used.map((id) => ({ id, label: CHANNELS[id].label, count: allCampaigns.filter((c) => channelOf(c) === id).length })),
          ]} />
        </div>
      ) : null}
      <div className="stats-row">
        <Stat label="Dépense 7 j" value={fmtEur(last7.spend)} sub={`total ${fmtEur(snapshot?.finance?.adSpend, 0)}`} icon="euro" />
        <Stat label="Impressions 7 j" value={fmtCompact(last7.impressions)} sub={`${fmtInt(last7.clicks)} clics`} icon="eye" />
        <Stat label="CTR" value={last7.impressions ? fmtPct(safeDiv(last7.clicks, last7.impressions), 2) : '—'} sub="objectif ≥ 1,5 %" icon="target" tone={last7.impressions ? (safeDiv(last7.clicks, last7.impressions) >= 0.015 ? 'good' : 'warn') : null} />
        <Stat label="CPC" value={last7.clicks ? fmtEur(safeDiv(last7.spend, last7.clicks)) : '—'} sub={`${fmtInt(last7.purchases)} achats`} icon="cart" />
        <Stat label="ROAS 7 j" value={last7.spend ? fmtRoas(safeDiv(last7.revenue, last7.spend)) : '—'} sub="rentable ≥ 1,5×" icon="trendUp" tone={last7.spend ? (safeDiv(last7.revenue, last7.spend) >= 1.5 ? 'good' : 'bad') : null} />
      </div>

      <div className="health-list">
        {accountRows(snapshot?.market).map(({ id, account }) => (
          <AccountHealth key={id} label={ACCOUNT_LABEL[id]} strikes={account.strikes} banned={account.banned} until={account.bannedUntilDay} day={day} />
        ))}
      </div>

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
            <thead><tr><th>Campagne</th><th>Canal</th><th>Produit</th><th>Statut</th><th className="num">Budget/j</th><th className="num">Créas</th><th className="num">Dépense 7 j</th><th className="num">ROAS 7 j</th><th>Lancée</th></tr></thead>
            <tbody>
              {campaigns.map((c) => {
                const a = aggregate(week.filter((s) => s.campaignId === c.id));
                const roas = safeDiv(a.revenue, a.spend);
                return (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong><div className="muted small">{c.seq === undefined ? '' : `n° ${c.seq + 1} · `}par {agentName(lookups, c.createdBy)}</div></td>
                    <td><ChannelPill id={channelOf(c)} />{c.test ? <div className="muted small">Test</div> : null}</td>
                    <td className="small">{lookups.products.get(c.productId)?.title ?? c.productId}</td>
                    <td>
                      <Pill tone={c.status === 'active' ? 'green' : c.status === 'rejected' ? 'red' : c.pausedFor === 'outage' ? 'amber' : 'neutral'} title={c.pausedFor === 'outage' ? 'Coupée le temps de la panne annoncée, elle reprend le lendemain matin.' : undefined}>
                        {c.pausedFor === 'outage' ? 'Pause panne' : { active: 'Active', paused: 'En pause', rejected: 'Refusée', ended: 'Terminée' }[c.status]}
                      </Pill>
                      {c.founderForced ? <div className="muted small">Lancée à la demande du fondateur</div> : null}
                    </td>
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
        <SectionTitle>Créas · {ofTotal(allCreatives.length, snapshot?.counts?.creatives)}</SectionTitle>
        <Segmented<CreativeFilter> size="sm" value={cf} onChange={setCf} options={[
          { id: 'all', label: 'Toutes', count: creatives.length },
          { id: 'approved', label: 'Approuvées', count: countOf('approved') },
          { id: 'rejected', label: 'Refusées', count: countOf('rejected') },
          { id: 'pending', label: 'En validation', count: countOf('pending') },
        ]} />
      </div>
      {shownCreatives.length === 0 ? <Empty compact icon="film">Aucune créa dans cette catégorie.</Empty> : (
        <div className="creative-grid">
          {shownCreatives.map((c) => <CreativeCard key={c.id} c={c} agg={totals?.creatives[c.id] ?? recentByCreative.get(c.id)} fatigue={recentByCreative.get(c.id)?.frequency ?? 0} />)}
        </div>
      )}

      <SectionTitle>Posts organiques {CHANNELS.tiktok.label} · {organic.length}</SectionTitle>
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

function AccountHealth({ label, strikes, banned, until, day }: { label: string; strikes: number; banned: boolean; until: number; day: number }) {
  const level = banned ? 'bad' : strikes >= 2 ? 'warn' : 'good';
  return (
    <div className={cx('health', `health-${level}`)}>
      <Icon name="shield" size={18} />
      <div>
        <strong>Compte {label} : {banned ? 'suspendu' : strikes === 0 ? 'excellente' : strikes === 1 ? 'un avertissement' : 'en danger'}</strong>
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

type CreativeFigures = Pick<Agg, 'spend' | 'impressions' | 'clicks' | 'purchases' | 'revenue'> & { lastDay?: number };

function CreativeCard({ c, agg, fatigue }: { c: AdCreative; agg: CreativeFigures | undefined; fatigue: number }) {
  const { runId, demo, lookups, snapshot } = useApp();
  const [playing, setPlaying] = useState(false);
  const video = snapshot?.videos?.[c.id];
  const poster = video?.poster ?? c.files?.storyboard?.[0];
  const frame = poster ? fileUrl(runId, poster) : '';
  const playable = !demo && !!(video?.videos.length || c.files?.preview);
  const ctr = agg ? safeDiv(agg.clicks, agg.impressions) : 0;
  const roas = agg ? safeDiv(agg.revenue, agg.spend) : 0;
  return (
    <article className="creative">
      <div className="phone" data-ratio={c.ratio ?? '9:16'}>
        <button type="button" className="phone-poster" onClick={() => setPlaying(true)} disabled={!playable} title={playable ? 'Regarder la pub' : 'Aperçu indisponible'}>
          {frame && !demo ? <img src={frame} alt="" loading="lazy" /> : <span className="phone-hook">{c.hook}</span>}
          {playable ? <span className="phone-play"><Icon name="play" size={18} /></span> : null}
        </button>
      </div>
      {playing ? <VideoLightbox creativeId={c.id} title={c.hook} fallbackHtml={c.files?.preview} onClose={() => setPlaying(false)} /> : null}
      <div className="creative-body">
        <div className="creative-hook">« {c.hook} »</div>
        <div className="chip-row">
          <span className="chip chip-sm">{HOOK_LABEL[c.hookStyle] ?? c.hookStyle}</span>
          <span className="chip chip-sm">{FORMAT_LABEL[c.format] ?? c.format}</span>
          {c.quality ? <span className="chip chip-sm">Qualité {Math.round(c.quality.overall)}</span> : null}
        </div>
        <div className="review-pills">
          {reviewsOf(c).map((r) => (
            <div key={r.channel} className={cx('review-status', `rs-${r.status}`)}>
              <Icon name={r.status === 'approved' ? 'check' : r.status === 'rejected' ? 'ban' : 'clock'} size={12} />
              {CHANNELS[r.channel].label} : {statusLabel(r)}
              {r.status === 'rejected' && reasonOf(r) ? <span> — {reasonOf(r)}</span> : null}
            </div>
          ))}
        </div>
        {agg && agg.impressions > 0 ? (
          <>
            <div className="creative-stats small">
              <span><strong>{fmtCompact(agg.impressions)}</strong> impr.</span>
              <span><strong>{fmtPct(ctr, 2)}</strong> CTR</span>
              <span><strong>{fmtInt(agg.purchases)}</strong> achats</span>
              <span className={roas >= 1.5 ? 'txt-good' : 'txt-bad'}><strong>{fmtRoas(roas)}</strong> ROAS</span>
              {fatigue > 2.5 ? <span className="txt-warn" title="Fréquence élevée : l’audience se lasse">fatigue ×{fatigue.toFixed(1).replace('.', ',')}</span> : null}
            </div>
            {agg.lastDay ? <div className="muted small">Bilan depuis le lancement · dernière diffusion J{agg.lastDay}</div> : null}
          </>
        ) : <div className="muted small">Pas encore diffusée.</div>}
        <div className="muted small">J{c.createdDay} · {agentName(lookups, c.createdBy)} · {c.scenes?.length ?? 0} scènes</div>
        {c.files?.preview || c.files?.storyboard?.length ? (
          <div className="product-actions">
            <FileLink runId={runId} path={c.files.preview} demo={demo} icon="external" title="Ouvrir l’aperçu animé dans un nouvel onglet">Aperçu de la pub</FileLink>
            <FileLink runId={runId} path={c.files.storyboard?.[0]} demo={demo} icon="film" title="Ouvrir le storyboard dans un nouvel onglet">Storyboard</FileLink>
          </div>
        ) : null}
      </div>
    </article>
  );
}
