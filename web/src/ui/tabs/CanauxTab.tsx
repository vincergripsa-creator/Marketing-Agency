// Canaux: what each channel is, what it brought read two ways, what it proved per niche, and why the CFO moved the money.
import { useMemo } from 'react';
import { CHANNELS, CHANNEL_IDS, channelOf, type ChannelId } from '../../../../shared/channels';
import type {
  ChannelAccountState, ChannelNicheState, ChannelPlan, ChannelRow, ChannelsDetail, CompanySnapshot,
} from '../../../../shared/types';
import { Bar, cx, Empty, Overlay, Pill, SectionTitle, Stat } from '../common';
import { useApp } from '../context';
import { clamp01, fmtCompact, fmtDec, fmtEur, fmtInt, fmtPct, fmtRoas, safeDiv, sum } from '../format';
import { nicheName, type Lookups, type Tone } from '../labels';
import { useDetail } from '../useDetail';
import { DetailNotice } from './EffectifTab';
import './market.css';

/** Under it, once fees and refunds are paid, a euro of ads loses money (CHANNEL_POLICY.alloc.floorRoas on the server). */
const FLOOR_ROAS = 1.15;
/** Under this, what a platform claims is rounding, not inflation. */
const INFLATED_FROM = 1.05;

/** Tones read the shop's ROAS and nothing else: a platform's own number never turns a line green (ui §6.5). */
export function roasTone(shop: number | null): string {
  if (shop === null) return 'muted';
  return shop >= FLOOR_ROAS ? 'txt-good' : 'txt-bad';
}

/** Shares of a day's budget, summing to 1. A day with nothing spent gives zeros, not NaN. */
export function budgetShares(values: readonly number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  return total > 0 ? clean.map((v) => v / total) : clean.map(() => 0);
}

const numberOf = (n: number) => (Number.isInteger(n) ? fmtInt(n) : fmtDec(n, 2));
type UnlockStep = ChannelRow['unlock'][number];

/** The unit a condition prints: none when the label already says it (« Ventes 9 / 15 ») or when it is a scale (« /100 »). */
function unitOf(u: UnlockStep): string {
  if (u.unit.startsWith('/') || u.unit === u.label.toLowerCase()) return '';
  return u.unit === '×' ? u.unit : ` ${u.unit}`;
}

/** « 15 ventes », « trésorerie 300 € », « ROAS 14 jours 1× ». */
function wanted(u: UnlockStep): string {
  if (u.unit === u.label.toLowerCase()) return `${numberOf(u.target)} ${u.unit}`;
  const label = /^.[a-zà-ÿ]/.test(u.label) ? u.label.charAt(0).toLowerCase() + u.label.slice(1) : u.label;
  return `${label} ${numberOf(u.target)}${unitOf(u)}`;
}

/** What a channel is doing right now, in one line. */
export function channelStateText(row: Pick<ChannelRow, 'state' | 'unlock'>, account: ChannelAccountState | undefined): string {
  switch (row.state) {
    case 'open': return 'Ouvert';
    case 'verifying': return account?.openDay ? `Vérification, jour ${account.openDay}` : 'Vérification';
    case 'banned': return account?.bannedUntilDay ? `Suspendu jusqu’au jour ${account.bannedUntilDay}` : 'Suspendu';
    case 'closed': {
      const next = row.unlock.find((u) => !u.met);
      return next ? `Fermé · ouvre quand ${wanted(next)}` : 'Fermé';
    }
  }
}

const STATE_TONE: Record<ChannelRow['state'], Tone> = { open: 'green', verifying: 'blue', banned: 'red', closed: 'neutral' };

function accountOf(s: CompanySnapshot | null, id: ChannelId): ChannelAccountState | undefined {
  const account = CHANNELS[id].account;
  if (account !== 'tiktok') return s?.market?.channelAccounts?.[account];
  return s?.market?.adAccount ? { ...s.market.adAccount, openDay: 1 } : undefined;
}

/** A demo has no server: TikTok alone, from the ad rows the snapshot keeps (ui §7). */
export function tiktokDetail(s: CompanySnapshot | null): ChannelsDetail {
  const day = s?.day ?? 1;
  const rows = (s?.market?.adStats ?? []).filter((r) => channelOf(r) === 'tiktok');
  const week = rows.filter((r) => r.day > day - 7);
  const spend7d = sum(week, (r) => r.spend);
  const revenue7d = sum(week, (r) => r.revenue);
  const impressions7d = sum(week, (r) => r.impressions);
  const clicks = sum(week, (r) => r.clicks);
  const roas = spend7d ? revenue7d / spend7d : null;
  const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => a - b).slice(-30);
  const { id, label: name, glyph, color } = CHANNELS.tiktok;
  const budget = sum((s?.company?.campaigns ?? []).filter((c) => channelOf(c) === 'tiktok' && c.status === 'active'), (c) => c.dailyBudget);
  const row: ChannelRow = {
    id, name, glyph, color, state: 'open', share: 1, spend7d, spend30d: sum(rows.filter((r) => r.day > day - 30), (r) => r.spend), budget,
    claimedRevenue7d: revenue7d, shopRevenue7d: revenue7d, reconciledRevenue7d: revenue7d,
    claimedRoas7d: roas, shopRoas7d: roas, reconciledRoas7d: roas, marginalRoas: null, inflation: null,
    budgetCap: budget, cpm: impressions7d ? (spend7d / impressions7d) * 1000 : 0, ctr: safeDiv(clicks, impressions7d),
    cvr: safeDiv(sum(week, (r) => r.purchases), sum(week, (r) => r.landingViews)), impressions7d,
    creatives: new Set(week.map((r) => r.creativeId)).size, fatigue: Math.max(0, ...week.map((r) => r.frequency)), strikes: s?.market?.adAccount?.strikes ?? 0,
    unlock: [], why: 'Le premier canal de l’agence.',
    daily: days.map((d) => {
      const today = rows.filter((r) => r.day === d);
      return { day: d, spend: sum(today, (r) => r.spend), claimed: sum(today, (r) => r.revenue), reconciled: sum(today, (r) => r.revenue) };
    }),
  };
  return { rows: [row], totals: { spend7d, reconciledRevenue7d: revenue7d, reconciledRoas7d: roas }, plan: null, matrix: [] };
}

export function CanauxTab({ onClose }: { onClose(): void }) {
  const { snapshot, demo } = useApp();
  const detail = useDetail<ChannelsDetail>('/api/channels', snapshot?.day ?? 1);
  const shown = detail.data ?? (demo ? tiktokDetail(snapshot) : null);
  return (
    <Overlay title="Canaux" subtitle="Où part chaque euro · deux lectures du ROAS, la boutique décide" icon="globe" onClose={onClose}>
      {demo ? null : <DetailNotice detail={detail} empty="Aucune donnée de canal pour ce run." />}
      {shown ? <CanauxBody data={shown} /> : null}
    </Overlay>
  );
}

export function CanauxBody({ data }: { data: ChannelsDetail }) {
  const { snapshot, lookups } = useApp();
  const day = snapshot?.day ?? data.plan?.day ?? 1;
  const { rows, totals } = data;
  const live = rows.filter((r) => r.state !== 'closed' || r.spend7d > 0);
  const waiting = rows.filter((r) => (r.state === 'closed' || r.state === 'verifying') && r.unlock.length > 0);
  return (
    <>
      <div className="stats-row">
        <Stat label="Dépense 7 j" value={fmtEur(totals.spend7d)} icon="euro" />
        <Stat label="Revenu boutique 7 j" value={fmtEur(totals.reconciledRevenue7d)} icon="target" />
        <Stat label="ROAS boutique 7 j" value={fmtRoas(totals.reconciledRoas7d)} sub="celui qui décide" tone={totals.reconciledRoas7d === null ? null : totals.reconciledRoas7d >= FLOOR_ROAS ? 'good' : 'bad'} icon="trendUp" />
        <Stat label="Canaux ouverts" value={`${fmtInt(rows.filter((r) => r.state === 'open').length)} / ${fmtInt(CHANNEL_IDS.length)}`} icon="globe" />
      </div>

      <div className="channel-grid">
        {rows.map((r) => <ChannelCard key={r.id} row={r} account={accountOf(snapshot, r.id)} />)}
      </div>

      <SectionTitle right={<span className="muted small">7 derniers jours</span>}>Ce que chaque canal rapporte</SectionTitle>
      {live.length === 0 ? <Empty compact icon="globe">Aucun canal n’a encore tourné.</Empty> : <RoasTable rows={live} totals={totals} />}

      <SectionTitle right={<span className="muted small">où l’agence découvre ce qui marche</span>}>Canal × niche</SectionTitle>
      <ChannelMatrix lines={data.matrix} day={day} lookups={lookups} />

      <div className="two-col">
        <div className="card">
          <SectionTitle>Décision du CFO</SectionTitle>
          <PlanCard plan={data.plan} lookups={lookups} />
        </div>
        <div className="card">
          <SectionTitle>Répartition de la dépense</SectionTitle>
          <ShareArea rows={rows} />
        </div>
      </div>

      {waiting.length ? (
        <>
          <SectionTitle>Conditions d’ouverture</SectionTitle>
          <div className="unlock-grid">
            {waiting.map((r) => (
              <div key={r.id} className="card">
                <strong className="small">{r.name}</strong>
                <div className="unlock-rows">
                  {r.unlock.map((u) => (
                    <div key={u.label} className="unlock-row">
                      <span className={u.met ? 'txt-good' : undefined}>{u.label} {numberOf(u.value)} / {numberOf(u.target)}{unitOf(u)}</span>
                      <Bar value={u.target > 0 ? clamp01(u.value / u.target) : 0} color={u.met ? '#16a34a' : '#2a78d6'} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function ChannelCard({ row, account }: { row: ChannelRow; account: ChannelAccountState | undefined }) {
  return (
    <article className="channel-card" data-state={row.state}>
      <div className="channel-head">
        <span className="channel-glyph" style={{ background: row.color }} aria-hidden="true">{row.glyph}</span>
        <div className="channel-titles">
          <strong>{row.name}</strong>
          <span><Pill tone={STATE_TONE[row.state]}>{channelStateText(row, account)}</Pill></span>
        </div>
      </div>
      <div className="kpi-mini">
        <div><span>Budget du jour</span><strong>{fmtEur(row.budget, 0)}</strong></div>
        <div><span>Avertissements</span><strong className={row.strikes >= 2 ? 'txt-warn' : undefined}>{fmtInt(row.strikes)}</strong></div>
      </div>
      {row.why && row.why !== 'Ouvert.' ? <div className="channel-why">{row.why}</div> : null}
    </article>
  );
}

const READINGS = {
  platform: 'Ce que le tableau de bord de la plateforme s’attribue : une vente qu’il a seulement vue passer compte pour lui.',
  shop: 'Ce que la boutique attribue au dernier clic : le bon total, une répartition qui favorise le dernier canal touché. C’est la lecture sur laquelle l’agence décide.',
  marginal: 'Ce que rapporterait le prochain euro, d’après la courbe de la ligne : une lecture, le budget suit le ROAS moyen.',
} as const;

function RoasTable({ rows, totals }: { rows: ChannelRow[]; totals: ChannelsDetail['totals'] }) {
  const inflated = (r: ChannelRow) => r.inflation !== null && r.inflation >= INFLATED_FROM;
  return (
    <>
      <div className="table-wrap">
        <table className="table roas-table">
          <thead>
            <tr>
              <th>Canal</th><th className="num">Budget/j</th><th className="num">Dépense</th>
              <th className="num" title={READINGS.platform}>ROAS plateforme</th>
              <th className="num roas-key" title={READINGS.shop}>ROAS boutique</th>
              <th className="num" title={READINGS.marginal}>ROAS marginal</th>
              <th className="num">Part du budget</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-channel={r.id}>
                <td><strong>{r.name}</strong></td>
                <td className="num">{fmtEur(r.budget, 0)}</td>
                <td className="num">{fmtEur(r.spend7d)}</td>
                <td className="num">
                  {fmtRoas(r.claimedRoas7d)}
                  {inflated(r) ? <span className="roas-inflated">gonflé ×{fmtDec(r.inflation, 1)}</span> : null}
                </td>
                <td className={cx('num roas-key', roasTone(r.shopRoas7d))}>{fmtRoas(r.shopRoas7d)}</td>
                <td className="num">{fmtRoas(r.marginalRoas)}</td>
                <td className="num">{fmtPct(r.share, 0)}</td>
              </tr>
            ))}
            <tr className="roas-total">
              <td>Total</td><td /><td className="num">{fmtEur(totals.spend7d)}</td><td />
              <td className={cx('num roas-key', roasTone(totals.reconciledRoas7d))}>{fmtRoas(totals.reconciledRoas7d)}</td>
              <td /><td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="roas-help"><strong>Plateforme :</strong> {READINGS.platform} <strong>Boutique :</strong> {READINGS.shop}</div>
    </>
  );
}

const LINE_TONE: Record<ChannelNicheState['status'], Tone> = { untested: 'neutral', testing: 'blue', proven: 'green', killed: 'red', blocked: 'amber' };

function lineLabel(l: ChannelNicheState, day: number): string {
  switch (l.status) {
    case 'untested': return 'À tester';
    case 'testing': return `En test (J${Math.max(0, day - l.since)}/${CHANNELS[l.channel].testDays})`;
    case 'proven': return l.spend > 0 ? `Rentable (${fmtRoas(l.revenue / l.spend)})` : 'Rentable';
    case 'killed': return 'Coupé';
    case 'blocked': return 'Bloqué';
  }
}

/** Channel × niche. Why a line is cut or blocked sits in its cell, shown on focus and on hover. */
function ChannelMatrix({ lines, day, lookups }: { lines: ChannelNicheState[]; day: number; lookups: Lookups }) {
  if (lines.length === 0) return <Empty compact icon="dice">Pas encore de test : le premier arrive avec un deuxième canal ouvert.</Empty>;
  const channels = CHANNEL_IDS.filter((ch) => lines.some((l) => l.channel === ch));
  const niches = [...new Set(lines.map((l) => l.nicheId))];
  const cell = new Map(lines.map((l) => [`${l.channel}:${l.nicheId}`, l]));
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Niche</th>{channels.map((ch) => <th key={ch}>{CHANNELS[ch].label}</th>)}</tr></thead>
        <tbody>
          {niches.map((nicheId) => (
            <tr key={nicheId}>
              <td><strong>{nicheName(lookups, nicheId)}</strong></td>
              {channels.map((ch) => {
                const l = cell.get(`${ch}:${nicheId}`);
                if (!l) return <td key={ch} className="muted">—</td>;
                const why = l.reason ? `${l.reason}${l.retestDay ? ` · nouveau test J${l.retestDay}` : ''}` : null;
                return (
                  <td key={ch} className="matrix-cell" tabIndex={why ? 0 : undefined}>
                    <Pill tone={LINE_TONE[l.status]}>{lineLabel(l, day)}</Pill>
                    {why ? <span className="matrix-why">{why}</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanCard({ plan, lookups }: { plan: ChannelPlan | null; lookups: Lookups }) {
  if (!plan) return <Empty compact icon="wallet">Pas encore de répartition : le CFO arbitre dès que deux canaux ont des campagnes actives.</Empty>;
  return (
    <>
      <div className="muted small">Jour {plan.day} · {plan.lambda === null ? 'chaque ligne reçoit sa part selon son ROAS moyen' : 'chaque euro va là où le suivant rapporte le plus'}.</div>
      <div className="kpi-mini">
        <div><span>Enveloppe</span><strong>{fmtEur(plan.envelope, 0)}</strong></div>
        <div><span>Dont tests</span><strong>{fmtEur(plan.testEnvelope, 0)}</strong></div>
        {plan.lambda === null ? null : <div title="Le ROAS marginal auquel toutes les lignes optimisées sont amenées"><span>λ, euro suivant</span><strong>{fmtRoas(plan.lambda)}</strong></div>}
      </div>
      {plan.unspent > 0 ? <div className="banner-inline banner-warn">{fmtEur(plan.unspent, 0)} non dépensés : aucun canal ne rapporte son euro suivant</div> : null}
      {plan.lines.length === 0 ? <div className="muted small">Aucune ligne à arbitrer aujourd’hui.</div> : (
        <ul className="bullets small">
          {plan.lines.map((l) => (
            <li key={`${l.channel}:${l.productId}`}>
              {l.note || <><strong>{CHANNELS[l.channel].label}</strong> · {lookups.products.get(l.productId)?.title ?? l.productId} : {fmtEur(l.budget, 0)} → {fmtEur(l.target, 0)}/jour</>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const W = 640;
const H = 200;
const PAD = { l: 40, r: 10, t: 8, b: 22 };

/** One polygon per channel per stacked band, days on x, shares of the day on y. */
export function shareBands(rows: Pick<ChannelRow, 'id' | 'color' | 'name' | 'daily'>[]): { days: number[]; bands: { id: ChannelId; name: string; color: string; points: string }[] } {
  const days = [...new Set(rows.flatMap((r) => r.daily.map((d) => d.day)))].sort((a, b) => a - b);
  const spend = rows.map((r) => new Map(r.daily.map((d) => [d.day, d.spend])));
  const shares = days.map((d) => budgetShares(spend.map((m) => m.get(d) ?? 0)));
  const x = (i: number) => PAD.l + (days.length > 1 ? (i / (days.length - 1)) * (W - PAD.l - PAD.r) : 0);
  const y = (v: number) => H - PAD.b - v * (H - PAD.t - PAD.b);
  const floor = days.map(() => 0);
  const bands = rows.map((r, ri) => {
    const bottom = [...floor];
    days.forEach((_, i) => { floor[i] = floor[i]! + shares[i]![ri]!; });
    const top = floor.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const back = bottom.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse();
    return { id: r.id, name: r.name, color: r.color, points: [...top, ...back].join(' ') };
  });
  return { days, bands };
}

/** Stacked area of the spend share. Share of the day, so a quiet day weighs as much as a busy one. */
function ShareArea({ rows }: { rows: ChannelRow[] }) {
  const spent = useMemo(() => rows.filter((r) => r.daily.some((d) => d.spend > 0)), [rows]);
  const { days, bands } = useMemo(() => shareBands(spent), [spent]);
  if (days.length < 2) return <div className="chart-empty">La répartition apparaît après deux jours de dépense.</div>;
  const every = Math.max(1, Math.ceil(days.length / 6));
  const xAt = (i: number) => PAD.l + (i / (days.length - 1)) * (W - PAD.l - PAD.r);
  return (
    <div className="chart">
      <div className="legend">
        {bands.map((b) => <span key={b.id} className="legend-item"><span className="legend-swatch" style={{ background: b.color }} />{b.name}</span>)}
      </div>
      <div className="chart-frame">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg share-area" role="img" aria-label="Part de la dépense par canal, jour par jour">
          {[0, 0.5, 1].map((t) => {
            const y = H - PAD.b - t * (H - PAD.t - PAD.b);
            return (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className={t === 0 ? 'axis-base' : 'grid'} />
                <text x={PAD.l - 6} y={y + 4} className="tick" textAnchor="end">{fmtCompact(t * 100)} %</text>
              </g>
            );
          })}
          {bands.map((b) => <polygon key={b.id} points={b.points} fill={b.color} stroke="#fff" strokeWidth={1} />)}
          {days.map((d, i) => (i % every === 0 || i === days.length - 1 ? <text key={d} x={xAt(i)} y={H - 6} className="tick" textAnchor="middle">J{d}</text> : null))}
        </svg>
      </div>
    </div>
  );
}
