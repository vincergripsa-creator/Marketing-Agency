// Croissance: which stage the agency is at and what the next one asks, week by week, where the money goes, what each guide earned, the list.
import type {
  Allocation, AudienceView, CompanySnapshot, DecisionRecord, GrowthState, PortfolioReview, PortfolioVerdict, StageId, StageView, WeekRollup,
} from '../../../../shared/types';
import { BarChart, SERIES } from '../charts';
import { Bar, cx, Empty, Overlay, Pill, SectionTitle, Stat } from '../common';
import { useApp } from '../context';
import { fmtDec, fmtEur, fmtEurShort, fmtEurSigned, fmtInt, fmtPct, fmtRoas, safeDiv, sum } from '../format';
import { Icon } from '../icons';
import { agentName, nicheName, type Tone } from '../labels';
import { useDetail } from '../useDetail';
import { DetailNotice, StageMeter } from './EffectifTab';
import './market.css';

/** GET /api/growth, or company.growth of the snapshot, which keeps the last 52 weeks and 30 decisions (scale §8). */
export type GrowthDetail = Pick<GrowthState, 'stage' | 'stageSinceDay' | 'gate' | 'allocation' | 'portfolio' | 'ltvFactor' | 'weeks' | 'decisions'>;

const STAGES: { id: StageId; label: string }[] = [
  { id: 'survie', label: 'Survie' }, { id: 'adequation', label: 'Adéquation' }, { id: 'acceleration', label: 'Accélération' }, { id: 'portefeuille', label: 'Portefeuille' },
];
const stageLabel = (id: StageId | null): string => STAGES.find((s) => s.id === id)?.label ?? '';

const VERDICT: Record<PortfolioVerdict, { label: string; tone: Tone }> = {
  test: { label: 'En test', tone: 'blue' },
  double_down: { label: 'On double', tone: 'green' },
  keep: { label: 'On garde', tone: 'neutral' },
  rework: { label: 'À retravailler', tone: 'amber' },
  harvest: { label: 'À récolter', tone: 'violet' },
  kill: { label: 'À arrêter', tone: 'red' },
};

const DECISION: Record<DecisionRecord['kind'], { label: string; tone: Tone }> = {
  stage: { label: 'Palier', tone: 'violet' },
  budget: { label: 'Budget', tone: 'green' },
  launch: { label: 'Lancement', tone: 'blue' },
  double_down: { label: 'On double', tone: 'green' },
  rework: { label: 'Reprise', tone: 'amber' },
  harvest: { label: 'Récolte', tone: 'violet' },
  kill: { label: 'Arrêt', tone: 'red' },
  reopen: { label: 'Réouverture', tone: 'cyan' },
  list: { label: 'Liste', tone: 'pink' },
  channel: { label: 'Canal', tone: 'orange' },
  incident: { label: 'Incident', tone: 'red' },
};

export function CroissanceTab({ onClose }: { onClose(): void }) {
  const { snapshot } = useApp();
  const detail = useDetail<GrowthDetail>('/api/growth', snapshot?.day ?? 1);
  const shown = detail.data ?? snapshot?.company?.growth ?? null;
  return (
    <Overlay title="Croissance" subtitle="Le palier, ce que le suivant demande, et ce que chaque semaine a rapporté" icon="trendUp" onClose={onClose}>
      {detail.error || !shown ? <DetailNotice detail={detail} empty="Ce run ne suit pas encore sa croissance." /> : null}
      {shown ? <CroissanceBody data={shown} /> : null}
    </Overlay>
  );
}

export function CroissanceBody({ data }: { data: GrowthDetail }) {
  const { snapshot } = useApp();
  const weeks = data.weeks ?? [];
  const last = weeks.at(-1);
  return (
    <>
      <div className="stats-row">
        <Stat label="Palier" value={stageLabel(data.stage)} sub={`depuis le jour ${fmtInt(data.stageSinceDay)}`} icon="flag" />
        <Stat label="Profit dernière semaine" value={last ? fmtEurSigned(last.profit) : '—'} tone={last ? (last.profit >= 0 ? 'good' : 'bad') : null} icon="trendUp" />
        <Stat label="Chiffre d’affaires" value={last ? fmtEur(last.revenue) : '—'} sub={last ? `${fmtInt(last.sales)} ventes` : undefined} icon="cart" />
        <Stat label="Guides en vente" value={last ? fmtInt(last.mains) : '—'} sub={last ? `${fmtInt(last.niches)} niches` : undefined} icon="package" />
        <Stat label="Valeur d’un client" value={`×${fmtDec(data.ltvFactor ?? 1, 2)}`} sub="premier achat + suite, e-mails, kits" icon="users" />
      </div>

      <div className="card">
        <StageTrack data={data} headcount={snapshot?.company?.agents?.length ?? 0} />
      </div>

      <div className="two-col">
        <div className="card">
          <SectionTitle>Chiffre d’affaires par semaine</SectionTitle>
          <BarChart ariaLabel="Chiffre d’affaires par semaine" labels={weeks.map((w) => `S${w.week}`)} values={weeks.map((w) => w.revenue)} pos={SERIES.blue}
            format={fmtEurShort} seriesLabel="chiffre d’affaires" emptyText="La première semaine se clôt au jour 7." />
        </div>
        <div className="card">
          <SectionTitle>Profit par semaine</SectionTitle>
          <BarChart ariaLabel="Profit par semaine" labels={weeks.map((w) => `S${w.week}`)} values={weeks.map((w) => w.profit)}
            format={fmtEurShort} seriesLabel="profit" emptyText="La première semaine se clôt au jour 7." />
        </div>
      </div>

      <AllocationCard allocation={data.allocation} />
      <PortfolioTable review={data.portfolio} />
      <EmailList audience={snapshot?.market?.audience} visitors={visitorsOf(snapshot)} />
      <Decisions decisions={data.decisions ?? []} weeks={weeks} />
    </>
  );
}

/** The four stages by name, then StageMeter: what the next one asks. */
function StageTrack({ data, headcount }: { data: GrowthDetail; headcount: number }) {
  const level = Math.max(0, STAGES.findIndex((s) => s.id === data.stage));
  const view: StageView = { level, total: 4, id: data.stage, name: stageLabel(data.stage), sinceDay: data.stageSinceDay, headcount, gate: data.gate };
  return (
    <>
      <ol className="stage-track" aria-label="Les quatre paliers">
        {STAGES.map((s, i) => (
          <li key={s.id} className={cx('stage-step', i < level && 'is-done', i === level && 'is-now')} aria-current={i === level ? 'step' : undefined}>
            <span className="stage-num">{i < level ? <Icon name="check" size={12} /> : i + 1}</span>{s.label}
          </li>
        ))}
      </ol>
      <StageMeter stage={view} />
    </>
  );
}

function AllocationCard({ allocation: a }: { allocation: Allocation | null }) {
  return (
    <div className="card">
      <SectionTitle right={a ? <span className="muted small">semaine {fmtInt(a.week)} · jour {fmtInt(a.day)}</span> : null}>L’argent de la semaine</SectionTitle>
      {!a ? <div className="muted small">Le CFO fait ses comptes chaque lundi.</div> : (
        <>
          {a.leak ? <div className="banner-inline banner-warn"><Icon name="alert" size={14} /> Le ROAS est sous le seuil de rentabilité : rien ne monte sur ce qui tourne.</div> : null}
          <div className="kpi-mini">
            <div><span>Pub dépensée / jour</span><strong>{fmtEur(a.spend7, 0)}</strong></div>
            <div title="Là où la pub peut monter cette semaine, seulement sur ce qui dépasse le seuil"><span>Plafond / jour</span><strong>{fmtEur(a.adTarget, 0)}</strong></div>
            <div><span>Réserve</span><strong>{fmtEur(a.reserve, 0)}</strong></div>
            <div><span>Disponible</span><strong>{fmtEur(a.free, 0)}</strong></div>
            <div><span>Profit 7 j</span><strong className={a.profit7 >= 0 ? 'txt-good' : 'txt-bad'}>{fmtEurSigned(a.profit7, 0)}</strong></div>
            <div><span>ROAS 14 j</span><strong>{fmtRoas(a.roas14)}</strong></div>
            <div title="ROAS auquel la pub se paie toute seule"><span>Point mort</span><strong>{fmtRoas(a.beRoas)}</strong></div>
            <div><span>On monte dès</span><strong>{fmtRoas(a.scaleRoas)}</strong></div>
            <div><span>On réduit sous</span><strong>{fmtRoas(a.trimRoas)}</strong></div>
          </div>
          {a.note ? <div className="budget-note small"><Icon name="chat" size={12} /> {a.note}</div> : null}
        </>
      )}
    </div>
  );
}

function PortfolioTable({ review }: { review: PortfolioReview | null }) {
  const { openProduct } = useApp();
  return (
    <>
      <SectionTitle right={review ? <span className="muted small">{fmtInt(review.slots.used)} / {fmtInt(review.slots.max)} places · revue du jour {fmtInt(review.day)}</span> : null}>Portefeuille</SectionTitle>
      {!review || review.lines.length === 0 ? <Empty compact icon="package">La direction passe les guides en revue chaque lundi, dès qu’il y en a un en vente.</Empty> : (
        <div className="table-wrap">
          <table className="table growth-table">
            <thead><tr><th>Guide</th><th>Verdict</th><th>Pourquoi</th><th className="num">Marge 28 j</th><th className="num">ROAS 14 j</th><th className="num">Testé en pub</th><th className="num">Part</th></tr></thead>
            <tbody>
              {review.lines.map((l) => (
                <tr key={l.productId}>
                  <td><button type="button" className="link-btn" onClick={() => openProduct(l.productId)} title="Voir le produit">{l.title}</button></td>
                  <td><Pill tone={VERDICT[l.verdict].tone}>{VERDICT[l.verdict].label}</Pill></td>
                  <td className="small">{l.reason}</td>
                  <td className={cx('num', l.contribution28 >= 0 ? 'txt-good' : 'txt-bad')}>{fmtEurSigned(l.contribution28)}</td>
                  <td className="num">{fmtRoas(l.roas14)}</td>
                  <td className="num">{fmtEur(l.paidTested, 0)}</td>
                  <td className="num">{fmtPct(l.share, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {review?.notes?.length ? <ul className="bullets small">{review.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
    </>
  );
}

/** Visits of the days the snapshot still holds: kpis are trimmed, so the funnel says how many days it covers. */
function visitorsOf(s: CompanySnapshot | null): { n: number; days: number } {
  const kpis = s?.company?.kpis ?? [];
  return { n: sum(kpis, (k) => k.clicks), days: kpis.length };
}

function EmailList({ audience, visitors }: { audience: AudienceView | undefined; visitors: { n: number; days: number } }) {
  const { lookups } = useApp();
  const empty = !audience || (audience.size === 0 && audience.recent.length === 0);
  return (
    <>
      <SectionTitle right={!empty ? <span className="muted small">{fmtEur(audience.dailyCost)} / jour d’outil</span> : null}>Liste e-mail</SectionTitle>
      {empty ? <Empty compact icon="mail">Pas encore de liste : elle démarre avec le premier aimant à prospects.</Empty> : (
        <div className="two-col">
          <div className="card">
            <div className="funnel" aria-label="Du visiteur à l’acheteur">
              {[
                { label: 'Visiteurs', value: visitors.n, title: `Clics des ${fmtInt(visitors.days)} derniers jours` },
                { label: 'Prospects', value: audience.leads, title: 'Sur la liste, sans avoir acheté' },
                { label: 'Acheteurs', value: audience.buyers, title: 'Sur la liste, ont acheté' },
              ].map((r) => (
                <div key={r.label} className="funnel-row" title={r.title}>
                  <span>{r.label}</span>
                  <Bar value={safeDiv(r.value, Math.max(visitors.n, audience.size, 1))} color="#2a78d6" height={10} />
                  <strong>{fmtInt(r.value)}</strong>
                </div>
              ))}
            </div>
            <div className="kpi-mini">
              <div><span>Sur la liste</span><strong>{fmtInt(audience.size)}</strong></div>
              <div><span>Désabonnés</span><strong>{fmtInt(audience.unsubscribed)}</strong></div>
              <div><span>Séquences actives</span><strong>{fmtInt(audience.sequences.filter((q) => q.status === 'active').length)}</strong></div>
            </div>
            {audience.byNiche.length ? (
              <ul className="bullets small">
                {[...audience.byNiche].sort((a, b) => b.size - a.size).slice(0, 6).map((n) => (
                  <li key={n.nicheId}>{nicheName(lookups, n.nicheId)} : <strong>{fmtInt(n.size)}</strong>{n.openRate !== null ? ` · ${fmtPct(n.openRate, 0)} d’ouverture` : ''}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="card">
            <SectionTitle>Derniers envois</SectionTitle>
            {audience.recent.length === 0 ? <div className="muted small">Rien d’envoyé pour l’instant.</div> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Jour</th><th>Objet</th><th className="num">Reçus</th><th className="num">Ouverts</th><th className="num">Ventes</th><th className="num">Désab.</th></tr></thead>
                  <tbody>
                    {[...audience.recent].sort((a, b) => b.day - a.day).slice(0, 8).map((b) => (
                      <tr key={b.id}>
                        <td className="small">J{b.day}</td>
                        <td className="small">{b.subject}{b.status === 'queued' ? <> <Pill tone="blue">en file</Pill></> : null}</td>
                        <td className="num">{fmtInt(b.delivered)}</td>
                        <td className="num">{fmtInt(b.opens)}</td>
                        <td className="num">{fmtInt(b.sales)}</td>
                        <td className="num">{fmtInt(b.unsubscribed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const DECISIONS_SHOWN = 30;

function Decisions({ decisions, weeks }: { decisions: DecisionRecord[]; weeks: WeekRollup[] }) {
  const { lookups, openProduct } = useApp();
  const list = [...decisions].sort((a, b) => b.day - a.day).slice(0, DECISIONS_SHOWN);
  return (
    <>
      <SectionTitle right={weeks.length ? <span className="muted small">{fmtInt(decisions.length)} décisions gardées</span> : null}>Décisions</SectionTitle>
      {list.length === 0 ? <Empty compact icon="flag">Aucune décision de croissance pour l’instant.</Empty> : (
        <ol className="timeline">
          {list.map((d) => (
            <li key={d.id} className="tl-item">
              <span className="tl-day">J{d.day}</span>
              <div className="tl-body">
                <div className="tl-top">
                  <Pill tone={DECISION[d.kind].tone}>{DECISION[d.kind].label}</Pill>
                  <span className="muted small">par {d.who === 'system' ? 'l’agence' : agentName(lookups, d.who)}</span>
                  {typeof d.impactEur === 'number' && d.kind !== 'budget' ? <span className={cx('small', d.impactEur >= 0 ? 'txt-good' : 'txt-bad')}>{fmtEurSigned(d.impactEur, 0)}</span> : null}
                </div>
                <div className="tl-insight growth-decision">
                  {d.productId ? <button type="button" className="link-btn" onClick={() => openProduct(d.productId!)}>{d.text}</button> : d.text}
                </div>
                {d.why ? <div className="tl-evidence">{d.why}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
