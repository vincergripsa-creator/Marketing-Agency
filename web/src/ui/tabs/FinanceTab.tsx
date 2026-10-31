// Finance: cash, profit, runway, ROAS, cash curve, daily profit, P&L, ledger, compute, goal.
import { useMemo, useState } from 'react';
import type { WeeklyPnl } from '../../../../shared/types';
import { BarChart, LineChart, SERIES } from '../charts';
import { Bar, cx, Empty, Overlay, Pill, SectionTitle, Segmented, Stat } from '../common';
import { useApp } from '../context';
import { budgetView, goalLate, isReserve, ledgerView, type BudgetView } from '../derive';
import { clamp01, fmtEur, fmtEurShort, fmtEurSigned, fmtInt, fmtRoas, safeDiv, sum } from '../format';
import { Icon } from '../icons';
import { agentName, LEDGER_LABEL, RESERVE_LABEL } from '../labels';

type LedgerFilter = 'all' | 'in' | 'out';

const ENTRIES_SHOWN = 150;

export function FinanceTab({ onClose }: { onClose(): void }) {
  const { snapshot, lookups } = useApp();
  const [lf, setLf] = useState<LedgerFilter>('all');
  const budget = budgetView(snapshot);
  const cfoId = lookups.depts.get('finance')?.chiefId ?? null;
  const budgetSpend = budget ? sum((snapshot?.market?.adStats ?? []).filter((r) => r.day === budget.day), (r) => r.spend) : 0;
  const f = snapshot?.finance;
  const kpis = snapshot?.company?.kpis ?? [];
  // a snapshot keeps the latest closed days: past them, a « best day » is only the best of those
  const kpiWindow = (kpis[0]?.day ?? 1) > 1 ? ` (${fmtInt(kpis.length)} derniers jours)` : '';
  const ledger = snapshot?.ledger ?? [];
  const sc = snapshot?.scenario;
  const mind = snapshot?.mind;

  const view = useMemo(() => ledgerView(ledger), [ledger]);
  const { byType, reserve } = view;
  const maxType = Math.max(1, reserve, ...byType.map(([, v]) => Math.abs(v)));
  // snapshot.ledger only keeps the latest entries: every label says how many it really holds
  const scope = view.complete ? 'toutes les écritures' : `${fmtInt(ledger.length)} dernières écritures`;
  const pnlReport = (snapshot?.company?.pnl ?? []).at(-1);

  const pnl = f ? [
    { label: 'Chiffre d’affaires', value: f.revenue, sign: 1 },
    { label: 'Remboursements', value: -Math.abs(f.refunds), sign: -1 },
    { label: 'Publicité', value: -Math.abs(f.adSpend), sign: -1 },
    { label: 'Frais (paiement, plateforme)', value: -Math.abs(f.fees), sign: -1 },
    { label: 'Compute Claude', value: -Math.abs(f.compute), sign: -1 },
    ...(f.payroll ? [{ label: 'Salaires et recrutement', value: -Math.abs(f.payroll), sign: -1 }] : []),
    { label: 'Autres coûts', value: -Math.abs(f.otherCosts), sign: -1 },
  ] : [];
  const pnlMax = Math.max(1, ...pnl.map((r) => Math.abs(r.value)));

  const goal = sc?.goal;
  const goalPct = goal && goal.targetProfit > 0 ? clamp01(safeDiv(f?.profit ?? 0, goal.targetProfit)) : 0;
  const late = goalLate(snapshot);
  const entries = [...ledger].reverse().filter((e) => (lf === 'all' ? true : lf === 'in' ? e.amount > 0 : e.amount < 0)).slice(0, ENTRIES_SHOWN);

  if (!f) return <Overlay title="Finance" icon="wallet" onClose={onClose}><Empty>Pas encore de données financières.</Empty></Overlay>;

  return (
    <Overlay title="Finance" subtitle={`Grand livre de l’agence · budget de départ ${fmtEur(sc?.startingCash ?? 0, 0)}`} icon="wallet" onClose={onClose}>
      {f.bankrupt ? <div className="banner-inline banner-bad"><Icon name="alert" size={14} /> Faillite : la trésorerie est négative. L’agence continue en mode survie, sans aucune dépense payante.</div> : null}
      <div className="stats-row stats-row-6">
        <Stat big label="Trésorerie" value={fmtEur(f.cash)} sub={`départ ${fmtEur(sc?.startingCash ?? 0, 0)}`} tone={sc && f.cash < sc.startingCash * 0.3 ? 'bad' : null} icon="wallet" />
        <Stat label="Profit cumulé" value={fmtEurSigned(f.profit)} tone={f.profit >= 0 ? 'good' : 'bad'} icon="trendUp" />
        <Stat label="Profit 7 j" value={fmtEurSigned(f.profit7d)} tone={f.profit7d >= 0 ? 'good' : 'bad'} icon="calendar" />
        <Stat label="Burn moyen / j" value={f.burn7d > 0 ? fmtEur(f.burn7d) : 'aucun'} sub={f.burn7d > 0 ? 'sortie nette moyenne' : 'l’agence encaisse plus qu’elle ne dépense'} tone={f.burn7d > 0 ? 'warn' : 'good'} icon="trendDown" />
        <Stat label="Runway" value={f.runwayDays === null ? 'illimitée' : `${fmtInt(f.runwayDays)} j`} sub={f.runwayDays === null ? 'dernière semaine sans perte' : f.runwayDays < 14 ? 'sous le seuil de 14 jours' : undefined} tone={f.runwayDays === null ? 'good' : f.runwayDays < 14 ? 'bad' : null} icon="clock" />
        <Stat label="ROAS 7 j" value={fmtRoas(f.roas7d)} sub="seuil de rentabilité ≈ 1,5×" tone={f.roas7d >= 1.5 ? 'good' : f.roas7d > 0 ? 'bad' : null} icon="target" />
      </div>

      {budget ? <BudgetCard b={budget} cfo={cfoId ? agentName(lookups, cfoId) : null} spend={budgetSpend} /> : null}

      {goal ? (
        <div className="goal card">
          <div className="goal-top">
            <Icon name="flag" size={14} />
            <strong>Objectif : {fmtEur(goal.targetProfit, 0)} de profit avant le jour {goal.byDay}</strong>
            <span className="flex1" />
            {late ? <span className="small txt-warn">Atteint au jour {snapshot?.goalReachedDay}, après l’échéance</span> : (
              <span className={cx('small', goalPct >= 1 ? 'txt-good' : 'muted')}>{Math.round(goalPct * 100)} % · jour {snapshot?.day ?? 1} / {goal.byDay}</span>
            )}
          </div>
          <Bar value={goalPct} height={10} color={late ? '#d97706' : goalPct >= 1 ? '#16a34a' : (f.profit ?? 0) < 0 ? '#dc2626' : '#2a78d6'} />
          <div className="goal-time"><span style={{ left: `${clamp01(safeDiv(snapshot?.day ?? 1, goal.byDay)) * 100}%` }} title="Temps écoulé" /></div>
        </div>
      ) : null}

      <div className="two-col">
        <div className="card">
          <SectionTitle>Trésorerie</SectionTitle>
          <LineChart ariaLabel="Courbe de trésorerie par jour" labels={kpis.map((k) => `J${k.day}`)}
            series={[{ id: 'cash', label: 'Trésorerie', color: SERIES.blue, values: kpis.map((k) => k.cash), area: true }]}
            format={fmtEurShort} emptyText="La courbe apparaît après la première clôture du marché." />
        </div>
        <div className="card">
          <SectionTitle>Profit par jour</SectionTitle>
          <BarChart ariaLabel="Profit quotidien" labels={kpis.map((k) => `J${k.day}`)} values={kpis.map((k) => k.profit)}
            format={fmtEurShort} seriesLabel="profit du jour" emptyText="Pas encore de journée clôturée." />
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <SectionTitle>Compte de résultat (cumulé)</SectionTitle>
          <div className="pnl">
            {pnl.map((r) => (
              <div key={r.label} className="pnl-row">
                <span>{r.label}</span>
                <span className="pnl-bar"><span style={{ width: `${(Math.abs(r.value) / pnlMax) * 100}%`, background: r.sign > 0 ? '#0ca30c' : '#d03b3b' }} /></span>
                <strong className={r.value >= 0 ? 'txt-good' : 'txt-bad'}>{fmtEurSigned(r.value)}</strong>
              </div>
            ))}
            <div className="pnl-row pnl-total">
              <span>Résultat</span><span />
              <strong className={f.profit >= 0 ? 'txt-good' : 'txt-bad'}>{fmtEurSigned(f.profit)}</strong>
            </div>
          </div>
          <SectionTitle>Par type d’écriture <span className="muted small">· {scope}</span></SectionTitle>
          {byType.length === 0 && reserve === 0 ? <div className="muted small">Aucune écriture hors capital.</div> : (
            <div className="pnl">
              {byType.map(([t, v]) => (
                <div key={t} className="pnl-row">
                  <span>{LEDGER_LABEL[t] ?? t}</span>
                  <span className="pnl-bar"><span style={{ width: `${(Math.abs(v) / maxType) * 100}%`, background: v >= 0 ? '#0ca30c' : '#d03b3b' }} /></span>
                  <strong className={v >= 0 ? 'txt-good' : 'txt-bad'}>{fmtEurSigned(v)}</strong>
                </div>
              ))}
              {reserve > 0 ? (
                <div className="pnl-row" title="Argent bloqué par le prestataire de paiement, puis rendu : ni un coût, ni un revenu.">
                  <span>{RESERVE_LABEL}</span>
                  <span className="pnl-bar"><span style={{ width: `${(reserve / maxType) * 100}%`, background: '#94a3b8' }} /></span>
                  <strong className="muted">{fmtEur(reserve)}</strong>
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="card">
          <SectionTitle>Compute (Claude)</SectionTitle>
          {mind ? (
            <div className="compute">
              <div className="compute-top">
                <span className={cx('mind-chip', mind.mode === 'claude' ? 'mind-claude' : 'mind-heur')}>
                  <Icon name={mind.mode === 'claude' ? 'sparkle' : 'zap'} size={13} /> {mind.mode === 'claude' ? 'Claude' : 'Heuristique'}
                </span>
                <strong>{fmtEur(mind.costEur)}</strong>
                <span className="muted small">/ plafond {fmtEur(sc?.maxComputeEur ?? 0)}</span>
              </div>
              <Bar value={safeDiv(mind.costEur, sc?.maxComputeEur ?? 0)} height={8} color={safeDiv(mind.costEur, sc?.maxComputeEur ?? 0) > 0.85 ? '#dc2626' : '#6250d6'} />
              <div className="kpi-mini">
                <div><span>Appels</span><strong>{fmtInt(mind.calls)}</strong></div>
                <div><span>Jetons entrée</span><strong>{fmtInt(mind.inputTokens)}</strong></div>
                <div><span>Jetons sortie</span><strong>{fmtInt(mind.outputTokens)}</strong></div>
                <div><span>Replis heuristiques</span><strong>{fmtInt(mind.fallbacks)}</strong></div>
              </div>
              <div className="muted small">{sc?.chargeCompute ? 'Le coût réel des jetons est imputé au grand livre (type « compute »).' : 'Le compute n’est pas facturé à l’agence dans ce scénario.'}</div>
            </div>
          ) : <div className="muted small">—</div>}
          <SectionTitle>Repères</SectionTitle>
          <ul className="bullets small">
            <li>Revenu total : <strong>{fmtEur(f.revenue)}</strong> · pub : <strong>{fmtEur(f.adSpend)}</strong> ({f.revenue ? `${Math.round(safeDiv(f.adSpend, f.revenue) * 100)} % du CA` : '—'})</li>
            <li>Remboursements : <strong>{fmtEur(f.refunds)}</strong> ({f.revenue ? `${Math.round(safeDiv(f.refunds, f.revenue) * 100)} % du CA` : '—'})</li>
            <li>Meilleure journée{kpiWindow} : <strong>{kpis.length ? fmtEurSigned(Math.max(...kpis.map((k) => k.profit))) : '—'}</strong> · pire : <strong>{kpis.length ? fmtEurSigned(Math.min(...kpis.map((k) => k.profit))) : '—'}</strong></li>
            <li>Jours rentables{kpiWindow} : <strong>{fmtInt(kpis.filter((k) => k.profit > 0).length)}</strong> / {fmtInt(kpis.length)}</li>
          </ul>
        </div>
      </div>

      {pnlReport ? <WeeklyPnlCard report={pnlReport} /> : null}

      <div className="filters-row">
        <SectionTitle>Grand livre · {view.complete ? `${fmtInt(ledger.length)} écritures` : scope}</SectionTitle>
        <Segmented<LedgerFilter> size="sm" value={lf} onChange={setLf} options={[
          { id: 'all', label: 'Tout' },
          { id: 'in', label: 'Entrées', count: ledger.filter((e) => e.amount > 0).length },
          { id: 'out', label: 'Sorties', count: ledger.filter((e) => e.amount < 0).length },
        ]} />
      </div>
      {entries.length === 0 ? <Empty compact>Aucune écriture.</Empty> : (
        <div className="table-wrap ledger-wrap">
          <table className="table">
            <thead><tr><th>Jour</th><th>Type</th><th>Libellé</th><th className="num">Montant</th><th>Réf.</th></tr></thead>
            <tbody>
              {entries.map((e) => {
                const held = isReserve(e);
                return (
                  <tr key={e.id}>
                    <td className="small">J{e.day}</td>
                    <td><span className={cx('ledger-type', held ? 'lt-hold' : e.amount >= 0 ? 'lt-in' : 'lt-out')}>{held ? RESERVE_LABEL : LEDGER_LABEL[e.type] ?? e.type}</span></td>
                    <td className="small">{e.memo}</td>
                    <td className={cx('num', held ? 'muted' : e.amount >= 0 ? 'txt-good' : 'txt-bad')}>{fmtEurSigned(e.amount)}</td>
                    <td className="small muted mono">{e.ref ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted small">Total, {scope} hors capital et réserves : {fmtEurSigned(view.total)}</div>
    </Overlay>
  );
}

/** Latest weekly P&L per product (the accountant's report the kill and budget decisions read). */
function WeeklyPnlCard({ report }: { report: WeeklyPnl }) {
  const { openProduct } = useApp();
  return (
    <div className="card">
      <SectionTitle right={<span className="muted small">jours {report.fromDay} à {report.toDay}</span>}>Résultat par produit · semaine {report.week}</SectionTitle>
      {report.products.length === 0 ? <div className="muted small">Aucun produit n’a tourné sur la période.</div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Produit</th><th className="num">Ventes</th><th className="num">CA</th><th className="num">Remboursé</th><th className="num">Pub</th><th className="num">Frais</th><th className="num">Créateurs</th><th className="num">Profit</th><th className="num">ROAS</th></tr></thead>
            <tbody>
              {report.products.map((p) => (
                <tr key={p.productId}>
                  <td><button type="button" className="link-btn" onClick={() => openProduct(p.productId)} title="Voir le produit">{p.title}</button></td>
                  <td className="num">{fmtInt(p.sales)}</td>
                  <td className="num">{fmtEur(p.revenue)}</td>
                  <td className="num">{fmtEur(p.refunds)}</td>
                  <td className="num">{fmtEur(p.adSpend)}</td>
                  <td className="num">{fmtEur(p.fees)}</td>
                  <td className="num">{fmtEur(p.creators)}</td>
                  <td className={cx('num', p.profit >= 0 ? 'txt-good' : 'txt-bad')}>{fmtEurSigned(p.profit)}</td>
                  <td className="num">{p.roas === null ? '—' : fmtRoas(p.roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted small">Résultat de la période : {fmtEurSigned(report.total)}, dont {fmtEurSigned(report.unallocated)} de coûts communs (boutique, outils, calcul).</div>
    </div>
  );
}

/** CFO envelope of the day (company.budget): ad spending cap, survival mode, the CFO's note. */
function BudgetCard({ b, cfo, spend }: { b: BudgetView; cfo: string | null; spend: number }) {
  const used = b.adCap > 0 ? clamp01(safeDiv(spend, b.adCap)) : spend > 0 ? 1 : 0;
  return (
    <div className={cx('card budget', b.survival && 'budget-survival')}>
      <div className="budget-top">
        <span className="budget-icon"><Icon name={b.survival ? 'alert' : 'shield'} size={16} /></span>
        <div className="budget-titles">
          <strong>Enveloppe du CFO · jour {b.day}</strong>
          <span className="muted small">{cfo ? `fixée par ${cfo} au stand-up` : 'fixée au stand-up du matin'}{b.stale ? ' · mise à jour au prochain stand-up' : ''}</span>
        </div>
        <span className="flex1" />
        {b.survival
          ? <Pill tone="red" icon="alert" title="Trésorerie sous le seuil de sécurité : dépenses pub réduites au minimum">Mode survie</Pill>
          : <Pill tone="green" icon="check">Budget normal</Pill>}
      </div>
      <div className="budget-row">
        <div className="budget-cap">
          <span className="hud-label">Plafond pub du jour</span>
          <strong>{fmtEur(b.adCap)}</strong>
        </div>
        <div className="budget-use">
          <Bar value={used} height={8} color={used >= 1 ? '#dc2626' : used > 0.8 ? '#d97706' : '#2a78d6'} title={`${fmtEur(spend)} dépensés sur ${fmtEur(b.adCap)}`} />
          <span className="muted small">{spend > 0 ? `${fmtEur(spend)} dépensés (${Math.round(used * 100)} %)` : 'dépense comptée à la clôture du marché'}</span>
        </div>
      </div>
      {b.note ? <div className="budget-note small"><Icon name="chat" size={12} /> {b.note}</div> : null}
    </div>
  );
}
