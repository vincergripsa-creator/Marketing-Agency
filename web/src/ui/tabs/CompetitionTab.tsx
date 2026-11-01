// Compétition: the season, the league per skill, plans, duels, the last challenge, transfers, hall of fame, alumni.
// GET /api/league serves observed numbers only. The truth comes with ?god=1 and shows only while god mode is on (ui §3.4).
import { useState } from 'react';
import type { ChronicleEntry, DuelView, HireReport, LeagueDetail, LeagueRow, ProbationPlan, Skill, TalentTruthView } from '../../../../shared/types';
import { SERIES, Sparkline } from '../charts';
import { Bar, cx, Empty, Overlay, Pill, SectionTitle, Segmented } from '../common';
import { useApp } from '../context';
import { fmtDec, fmtEur, fmtInt, fmtPct, plural } from '../format';
import { Icon, PixelAvatar } from '../icons';
import {
  agentName, ALUMNUS_KIND_LABEL, CONTRACT_LABEL, CONTRACT_TONE, DUEL_STATUS_LABEL, DUEL_STATUS_TONE, PLAN_OUTCOME_LABEL, PLAN_OUTCOME_TONE, SKILL_LABEL,
} from '../labels';
import { useDetail } from '../useDetail';
import { ChronicleList, DetailNotice } from './EffectifTab';

const BLIND_TEST = 'Ce métier n’a pas de test fiable : sous la barre, le plan reste, avec un coach s’il y en a un, mais le poste n’est jamais remis au marché.';
const FORM_LABEL: Record<LeagueRow['form'][number], string> = { V: 'Victoire', N: 'Nul', D: 'Défaite' };

export function CompetitionTab({ onClose }: { onClose(): void }) {
  const { snapshot, godMode } = useApp();
  const detail = useDetail<LeagueDetail>(godMode ? '/api/league?god=1' : '/api/league', snapshot?.day ?? 0);
  return (
    <Overlay title="Compétition" subtitle="Des notes observées, un plan avant la porte, un test réel avant tout remplacement" icon="trophy" onClose={onClose} className="team-tab">
      <DetailNotice detail={detail} empty="La ligue n’est pas active sur cette run." />
      {detail.data ? <CompetitionBody data={detail.data} /> : null}
    </Overlay>
  );
}

export function CompetitionBody({ data }: { data: LeagueDetail }) {
  const { godMode } = useApp();
  // the flag decides, not the payload: the last good data can outlive the toggle
  const god = godMode ? data.god : undefined;
  return (
    <>
      <Season season={data.season} />
      <SectionTitle>Classement</SectionTitle>
      <Standings data={data} god={god} />
      {god ? <TruthPanel roles={data.roles} god={god} /> : null}

      <div className="two-col">
        <div className="card">
          <SectionTitle>Plans d’amélioration</SectionTitle>
          <Plans plans={data.plans} />
        </div>
        <div className="card">
          <SectionTitle>Duels</SectionTitle>
          <Duels duels={data.duels} />
        </div>
      </div>

      <div className="card">
        <SectionTitle>Dernier recrutement</SectionTitle>
        {data.lastHire ? <LastHire report={data.lastHire} transfers={data.transfers} /> : <Empty compact>Aucun poste remis en jeu pour l’instant.</Empty>}
      </div>

      <div className="card">
        <SectionTitle>Transferts</SectionTitle>
        <div className="team-scroll"><ChronicleList entries={data.transfers} empty="Aucun mouvement pour l’instant." /></div>
      </div>

      <SectionTitle>Panthéon</SectionTitle>
      <HallOfFame data={data} />

      <SectionTitle>Anciens</SectionTitle>
      <Alumni data={data} />
    </>
  );
}

function Season({ season }: { season: LeagueDetail['season'] }) {
  return (
    <div className="card">
      <strong>Saison {season.no} · J{fmtInt(season.fromDay)} → J{fmtInt(season.toDay)} · {plural(season.daysLeft, 'jour restant', 'jours restants')}</strong>
      {season.rules.length ? <ul className="bullets small">{season.rules.map((r) => <li key={r}>{r}</li>)}</ul> : null}
      {season.training ? <div className="small">Formation continue : {plural(season.training.seats, 'poste', 'postes')} à la dernière clôture, {fmtEur(season.training.eur, 0)}. Depuis le début : {fmtEur(season.training.totalEur, 0)}.</div> : null}
    </div>
  );
}

// ───────────────────────────── Classement ─────────────────────────────

function Standings({ data, god }: { data: LeagueDetail; god: Record<string, TalentTruthView> | undefined }) {
  const [picked, setPicked] = useState<Skill | null>(null);
  const roles = data.roles.filter((r) => r.rows.length > 0);
  const role = roles.find((r) => r.key === picked) ?? roles[0];
  if (!role) return <Empty compact>Personne n’est encore classé : les notes viennent avec les premiers résultats.</Empty>;

  const reasons = [...new Set(data.outside.map((o) => o.why))];
  const columns = god ? 11 : 10;
  return (
    <>
      <Segmented<Skill> size="sm" value={role.key} onChange={setPicked} options={roles.map((r) => ({ id: r.key, label: r.label, count: r.rows.length }))} />
      <div className="table-wrap">
        <table className="table league-table">
          <thead>
            <tr>
              <th className="num">Rang</th><th>Évol.</th><th>Agent</th><th className="num">Note</th><th className="num">7 j</th><th>Courbe</th>
              <th>Forme</th><th className="num">Points</th><th className="num">Métrique</th><th className="num">Échantillon</th>
              {god ? <th className="num god-col" title="Mode dieu : vrai talent, invisible des agents">Vrai talent</th> : null}
            </tr>
          </thead>
          <tbody>
            {role.rows.map((row, i) => (
              <LeagueLine key={row.agentId} row={row} cut={role.cutLine !== null && row.rank >= role.cutLine && (i === 0 || role.rows[i - 1]!.rank < role.cutLine) ? (role.blindTest ? data.season.cutBlind : data.season.cut) : null} columns={columns} god={god} />
            ))}
          </tbody>
        </table>
      </div>
      {role.blindTest ? <div className="muted small">{BLIND_TEST}</div> : null}
      {reasons.map((why) => <div key={why} className="muted small">{why} ({data.outside.filter((o) => o.why === why).map((o) => o.name).join(', ')}).</div>)}
    </>
  );
}

function LeagueLine({ row, cut, columns, god }: { row: LeagueRow; cut: string | null; columns: number; god: Record<string, TalentTruthView> | undefined }) {
  const { openAgent } = useApp();
  const truth = god?.[row.agentId];
  return (
    <>
      {cut ? <tr className="cut-line"><td colSpan={columns}>{cut}</td></tr> : null}
      <tr>
        <td className="num"><strong>{row.rank}</strong></td>
        <td className={cx('rank-delta', row.rankDelta > 0 && 'txt-good', row.rankDelta < 0 && 'txt-bad')}>{row.rankDelta > 0 ? `▲${row.rankDelta}` : row.rankDelta < 0 ? `▼${-row.rankDelta}` : '='}</td>
        <td>
          <button type="button" className="league-agent" onClick={() => openAgent(row.agentId)} title={`Ouvrir la fiche de ${row.name}`}>
            <PixelAvatar avatar={row.avatar} size={24} />
            <span className="league-name">
              <strong>{row.name}</strong>
              <span className="muted small">{row.role}</span>
            </span>
          </button>
          {row.contract !== 'active' ? <Pill tone={CONTRACT_TONE[row.contract]}>{CONTRACT_LABEL[row.contract]}</Pill> : null}
          {row.underBar > 0 ? <span className="muted small"> {plural(row.underBar, 'clôture', 'clôtures')} sous la barre</span> : null}
        </td>
        <td className="num"><strong>{fmtInt(row.rating)}</strong></td>
        <td className={cx('num', row.delta7d > 0 && 'txt-good', row.delta7d < 0 && 'txt-bad')}>{signed(row.delta7d)}</td>
        <td><Sparkline values={row.spark} width={72} height={24} color={SERIES.blue} /></td>
        <td><span className="form-dots">{row.form.map((f, i) => <span key={i} className={`form-dot form-${f}`} title={FORM_LABEL[f]}>{f}</span>)}</span></td>
        <td className="num">{signed(row.points)}</td>
        <td className="num">{row.metric ?? '—'}</td>
        <td className="num">{fmtDec(row.sample, 1)}{row.confidence === 'faible' ? <div className="muted small">peu de données</div> : null}</td>
        {god ? <td className="num god-col" title={truth?.note}>{truth ? fmtDec(truth.truth, 2) : '—'}</td> : null}
      </tr>
    </>
  );
}

function signed(n: number): string {
  const v = Math.round(n);
  return v > 0 ? `+${fmtInt(v)}` : v < 0 ? `−${fmtInt(-v)}` : '0';
}

// ───────────────────────────── Mode dieu ─────────────────────────────

/** Ranks with ties shared, as Spearman needs them. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length).fill(0);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j += 1;
    for (let k = i; k <= j; k += 1) out[order[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

/** Rank correlation, from -1 to 1. Null under three points or on a flat series: there is nothing to compare. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const a = ranks(xs.slice(0, n));
  const b = ranks(ys.slice(0, n));
  const mean = (n + 1) / 2;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (a[i]! - mean) * (b[i]! - mean);
    va += (a[i]! - mean) ** 2;
    vb += (b[i]! - mean) ** 2;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : null;
}

function TruthPanel({ roles, god }: { roles: LeagueDetail['roles']; god: Record<string, TalentTruthView> }) {
  const points = roles.flatMap((r) => r.rows.flatMap((row) => {
    const truth = god[row.agentId];
    return truth ? [{ id: row.agentId, name: row.name, rating: row.rating, truth: truth.truth }] : [];
  }));
  if (points.length === 0) return null;
  const rho = spearman(points.map((p) => p.rating), points.map((p) => p.truth));
  return (
    <div className="card god-card">
      <SectionTitle>Vrai talent contre note observée</SectionTitle>
      <div className="small">
        {rho === null
          ? 'Trop peu d’agents pour comparer le classement à la vérité.'
          : `Corrélation de rang entre la note et la vérité : ${fmtDec(rho, 2)} (Spearman sur ${plural(points.length, 'agent', 'agents')} : 1 = même ordre, 0 = aucun lien).`}
      </div>
      <TruthScatter points={points} />
    </div>
  );
}

function TruthScatter({ points }: { points: { id: string; name: string; rating: number; truth: number }[] }) {
  const W = 420;
  const H = 180;
  const PAD = { l: 44, r: 12, t: 10, b: 26 };
  const ratings = points.map((p) => p.rating);
  const lo = Math.min(...ratings) - 10;
  const hi = Math.max(...ratings) + 10;
  const x = (t: number) => PAD.l + Math.max(0, Math.min(1, t)) * (W - PAD.l - PAD.r);
  const y = (r: number) => H - PAD.b - ((r - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg truth-scatter" role="img" aria-label="Note observée en fonction du vrai talent, un point par agent">
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="axis-base" />
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} className="axis-base" />
      <text x={W - PAD.r} y={H - 8} className="tick" textAnchor="end">Vrai talent →</text>
      <text x={PAD.l - 6} y={PAD.t + 8} className="tick" textAnchor="end">{fmtInt(hi)}</text>
      <text x={PAD.l - 6} y={H - PAD.b} className="tick" textAnchor="end">{fmtInt(lo)}</text>
      {points.map((p) => (
        <circle key={p.id} cx={x(p.truth)} cy={y(p.rating)} r={4.5} fill={SERIES.violet} opacity={0.8}>
          <title>{`${p.name} : note ${fmtInt(p.rating)}, talent ${fmtDec(p.truth, 2)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ───────────────────────────── Plans, duels, recrutement ─────────────────────────────

function Plans({ plans }: { plans: ProbationPlan[] }) {
  const { lookups } = useApp();
  if (plans.length === 0) return <Empty compact>Aucun plan en cours.</Empty>;
  return (
    <div className="team-stack">
      {plans.map((p) => (
        <div key={`${p.agentId}-${p.openedSeason}`} className="team-item">
          <div className="team-item-top">
            <strong>{agentName(lookups, p.agentId)}</strong>
            <span className="muted small">{SKILL_LABEL[p.skill] ?? p.skill}</span>
            <span className="flex1" />
            <Pill tone={PLAN_OUTCOME_TONE[p.outcome]}>{PLAN_OUTCOME_LABEL[p.outcome]}</Pill>
          </div>
          <div>{p.text}</div>
          <div className="muted small">
            {p.metricLabel} : {fmtDec(p.baseline, 1)} → {fmtDec(p.target, 1)} · échéance J{fmtInt(p.deadlineDay)} · coach {p.coachId ? agentName(lookups, p.coachId) : 'aucun'}
          </div>
        </div>
      ))}
    </div>
  );
}

const duelScore = (s: number | null) => (s === null ? '—' : s <= 1 ? fmtPct(s, 2) : fmtDec(s, 1));
const duelDelta = (d: number | null) => (d === null ? '' : ` (${signed(d)})`);

function Duels({ duels }: { duels: DuelView[] }) {
  if (duels.length === 0) return <Empty compact>Aucun duel pour l’instant.</Empty>;
  const running = duels.filter((d) => d.status === 'open');
  const settled = duels.filter((d) => d.status !== 'open').reverse();
  return (
    <div className="team-stack team-scroll">
      {[...running, ...settled].map((d) => (
        <div key={d.id} className="team-item">
          <div className="team-item-top">
            <strong>{d.label}</strong>
            <span className="flex1" />
            <Pill tone={DUEL_STATUS_TONE[d.status]}>{DUEL_STATUS_LABEL[d.status]}</Pill>
          </div>
          <div className="duel-line">
            <span className={cx(d.winnerId === d.a.agentId && 'duel-win')}>{d.a.name} {duelScore(d.a.score)}{duelDelta(d.a.ratingDelta)}</span>
            <span className="muted">contre</span>
            <span className={cx(d.winnerId === d.b.agentId && 'duel-win')}>{d.b.name} {duelScore(d.b.score)}{duelDelta(d.b.ratingDelta)}</span>
          </div>
          <div className="muted small">
            {d.metric} · J{fmtInt(d.startedDay)} → J{fmtInt(d.endDay)}
            {d.winnerId ? ` · gagnant : ${d.winnerId === d.a.agentId ? d.a.name : d.b.name}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

/** What the swap cost, as the ledger booked it: the hire's week of pay, the leaver's. By person: someone else can join the same day. */
function hireCost(report: HireReport, transfers: readonly ChronicleEntry[]): number | null {
  if (!report.hired) return null;
  const recruiting = transfers.find((t) => t.kind === 'hire' && t.agentId === report.hired)?.numbers?.recruiting ?? 0;
  const severance = transfers.find((t) => t.kind === 'fire' && t.agentId === report.incumbent)?.numbers?.severance ?? 0;
  return recruiting + severance > 0 ? recruiting + severance : null;
}

function LastHire({ report, transfers }: { report: HireReport; transfers: ChronicleEntry[] }) {
  const { lookups } = useApp();
  const incumbent = report.candidates.find((c) => c.isIncumbent)?.name ?? agentName(lookups, report.incumbent);
  const hired = report.candidates.find((c) => c.id === report.hired)?.name ?? (report.hired ? agentName(lookups, report.hired) : null);
  const cost = hireCost(report, transfers);
  return (
    <div className="team-stack">
      <div>
        <strong>{hired ? `${hired} prend le poste de ${incumbent}` : `${incumbent} reste en poste`}</strong>
        <span className="muted small"> · J{fmtInt(report.day)} · {SKILL_LABEL[report.skill] ?? report.skill}</span>
      </div>
      <div className="muted small">{report.reason}</div>
      {report.candidates.length ? (
        <div className="test-rows">
          {report.candidates.map((c) => (
            <div key={c.id} className={cx('test-row', c.id === report.hired && 'is-winner')}>
              <span className="test-name">
                <strong>{c.name}</strong>
                <span className="muted small">{c.isIncumbent ? 'En poste' : c.lineage ? `Élève de ${agentName(lookups, c.lineage)}` : 'Marché'}</span>
              </span>
              <Bar value={c.score / 100} color={c.id === report.hired ? '#16a34a' : '#94a3b8'} />
              <span className="test-score">{fmtDec(c.score, 1)}/100</span>
              <span className="test-made small">{c.deliverable}</span>
            </div>
          ))}
        </div>
      ) : null}
      {cost !== null ? <div className="small">Coût du remplacement : <strong>{fmtEur(cost)}</strong></div> : null}
    </div>
  );
}

// ───────────────────────────── Mémoire ─────────────────────────────

function HallOfFame({ data }: { data: LeagueDetail }) {
  if (data.hallOfFame.length === 0) return <Empty compact>Pas encore de saison terminée.</Empty>;
  return (
    <div className="hall-grid">
      {data.hallOfFame.map((h) => {
        const left = data.alumni.find((a) => a.person.id === h.champion.id)?.leftDay;
        return (
          <div key={h.season} className="card hall-card">
            <PixelAvatar avatar={h.champion.avatar} size={44} />
            <div className="hall-main">
              <div className="muted small"><Icon name="trophy" size={12} /> Saison {h.season}</div>
              <strong>{h.champion.name}</strong>
              <div className="muted small">{h.champion.role} · {signed(h.score)} points</div>
              <div className={cx('small', h.still ? 'txt-good' : 'muted')}>{h.still ? 'toujours là' : left === undefined ? 'parti' : `parti J${fmtInt(left)}`}</div>
              {h.second || h.third ? <div className="muted small">Podium : {[h.second, h.third].flatMap((p) => (p ? [p.name] : [])).join(', ')}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Alumni({ data }: { data: LeagueDetail }) {
  if (data.alumni.length === 0) return <Empty compact>Personne n’a quitté l’agence.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Agent</th><th className="num">Arrivé</th><th className="num">Parti</th><th>Motif</th><th>Pourquoi</th>
            <th className="num">Meilleure note</th><th className="num">Titres</th><th className="num">Coût total</th><th>Remplacé par</th>
          </tr>
        </thead>
        <tbody>
          {data.alumni.map((a) => (
            <tr key={`${a.person.id}-${a.leftDay}`}>
              <td>
                <span className="league-person">
                  <PixelAvatar avatar={a.person.avatar} size={24} />
                  <span className="league-name"><strong>{a.person.name}</strong><span className="muted small">{a.person.role}</span></span>
                </span>
              </td>
              <td className="num">J{fmtInt(a.hiredDay)}</td>
              <td className="num">J{fmtInt(a.leftDay)}</td>
              <td>{ALUMNUS_KIND_LABEL[a.kind] ?? a.kind}</td>
              <td className="alumni-why">{a.why}</td>
              <td className="num">{a.bestRating === null ? '—' : fmtInt(a.bestRating)}</td>
              <td className="num">{fmtInt(a.titles)}</td>
              <td className="num">{fmtEur(a.cost)}</td>
              <td>{a.replacedBy?.name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
