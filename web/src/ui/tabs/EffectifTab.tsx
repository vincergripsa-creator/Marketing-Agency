// Effectif: who works here, what they cost, who is being hired and why. Everything comes from GET /api/org.
import type { ChronicleEntry, DeptId, GateCheck, HeadRow, HiringReqView, OrgDept, OrgDetail, RolePressure, StageView } from '../../../../shared/types';
import { LineChart, SERIES } from '../charts';
import { Bar, ChiefBadge, cx, Dot, Empty, Overlay, Pill, SectionTitle, Stat } from '../common';
import { useApp } from '../context';
import { fmtDec, fmtEur, fmtEurShort, fmtEurSigned, fmtInt, fmtPct, plural } from '../format';
import { Icon, PixelAvatar } from '../icons';
import {
  CONTRACT_LABEL, CONTRACT_TONE, deptColor, deptName, deptOrder, REQ_STATUS_LABEL, REQ_STATUS_TONE, ROLE_LABEL, TASK_KIND_LABEL, TIER_LABEL,
} from '../labels';
import { useDetail, type DetailState } from '../useDetail';

/** The bars of org §13 read against the hire rule: `ORG.reliefPerDay`, `ORG.ownerUtil`, `ORG.pressureDays`. */
const RELIEF_TARGET = 12;
const UTIL_TARGET = 0.7;
const PRESSURE_DAYS = 3;
const PRESSURE_SHOWN = 8; // a run carries one row per role: the ones that wait the most tell the story
const HATS_SHOWN = 3;

const num = (n: number) => (Number.isInteger(n) ? fmtInt(n) : fmtDec(n, 1));

export function EffectifTab({ onClose }: { onClose(): void }) {
  const { snapshot } = useApp();
  const detail = useDetail<OrgDetail>('/api/org', snapshot?.day ?? 0);
  return (
    <Overlay title="Effectif" subtitle="Qui travaille ici, ce que chacun coûte, qui arrive et pourquoi" icon="users" onClose={onClose} className="team-tab">
      <DetailNotice detail={detail} empty="L’organigramme apparaît avec la première journée." />
      {detail.data ? <EffectifBody data={detail.data} /> : null}
    </Overlay>
  );
}

/** What a tab says instead of its body: still loading, nothing yet, or stale data after a failed fetch. Shared with Compétition. */
export function DetailNotice<T>({ detail, empty }: { detail: DetailState<T> & { reload(): void }; empty: string }) {
  if (detail.error) {
    return (
      <div className="banner-inline banner-warn">
        <Icon name="alert" size={14} /> {detail.data ? 'Données de la dernière réussite' : 'Données indisponibles'} : {detail.error}.
        <button type="button" className="link-btn" onClick={detail.reload}>Réessayer</button>
      </div>
    );
  }
  if (detail.data) return null;
  return detail.loading ? <div className="muted"><span className="spinner" /> Chargement…</div> : <Empty>{empty}</Empty>;
}

export function EffectifBody({ data }: { data: OrgDetail }) {
  const open = data.reqs.filter((r) => r.status === 'open').length;
  return (
    <>
      <div className="stats-row stats-row-6">
        <Stat big label="Agents" value={fmtInt(data.headcount)} sub={plural(data.depts.length, 'équipe ouverte', 'équipes ouvertes')} icon="users" />
        <Stat label="Masse salariale 30 j" value={fmtEur(data.cost30d, 0)} icon="wallet" />
        <Stat label="Coût par tête" value={fmtEur(data.costPerHead30d, 2)} sub="sur 30 jours" icon="euro" />
        <Stat label="CA par tête" value={fmtEur(data.revenuePerHead30d, 2)} sub="sur 30 jours" icon="cart" />
        <Stat label="Profit par tête" value={fmtEurSigned(data.profitPerHead30d, 2)} sub="sur 30 jours" tone={data.profitPerHead30d >= 0 ? 'good' : 'bad'} icon="trendUp" />
        <Stat label="Postes ouverts" value={fmtInt(open)} tone={open > 0 ? 'warn' : null} icon="briefcase" />
      </div>

      <div className="card"><StageMeter stage={data.stage} /></div>

      <SectionTitle>Organigramme</SectionTitle>
      <OrgChart depts={data.depts} closed={data.closed} />

      <div className="two-col">
        <div className="card">
          <SectionTitle>Pression par rôle</SectionTitle>
          <PressureBars rows={data.pressure} />
        </div>
        <div className="card">
          <SectionTitle>Décisions RH</SectionTitle>
          <ChronicleList entries={data.decisions} empty="Aucune décision d’équipe pour l’instant." />
        </div>
      </div>

      <SectionTitle>Plan de recrutement</SectionTitle>
      <HiringPlan reqs={data.reqs} />
      {data.lastRefusal ? <Refusal entry={data.lastRefusal} /> : null}

      <div className="two-col">
        <div className="card">
          <SectionTitle>Effectif par jour</SectionTitle>
          <LineChart ariaLabel="Effectif par jour" labels={data.history.map((h) => `J${h.day}`)} height={170}
            series={[{ id: 'headcount', label: 'Agents', color: SERIES.blue, values: data.history.map((h) => h.headcount), area: true }]}
            emptyText="La courbe apparaît après la première clôture." />
        </div>
        <div className="card">
          <SectionTitle>Masse salariale sur 7 jours</SectionTitle>
          <LineChart ariaLabel="Masse salariale sur 7 jours, par jour" labels={data.history.map((h) => `J${h.day}`)} height={170}
            series={[{ id: 'cost', label: 'Masse salariale 7 j', color: SERIES.orange, values: data.history.map((h) => h.cost7d) }]}
            format={fmtEurShort} emptyText="La courbe apparaît après la première clôture." />
        </div>
      </div>
    </>
  );
}

/** How full a check's bar is. A ceiling fills as the value comes down to it: past it, the bar is the part of the way already done. */
export function gateFill(c: GateCheck): number {
  if (c.lower) return c.ok ? 1 : c.value > 0 ? c.target / c.value : 0;
  return c.target ? c.value / c.target : c.ok ? 1 : 0;
}

/** No gate to show. Only the last stage has nothing left to clear: before it, a gate is read on Mondays, and a run without scaling reads none. */
function noGateText(stage: StageView, scaling: boolean): string {
  if (stage.level >= stage.total - 1) return 'Dernier palier : plus rien à franchir.';
  return scaling ? 'Le premier contrôle du palier a lieu lundi.' : 'Cette partie ne suit pas de palier.';
}

/** Where the company stands, four pips, and what the next stage asks. Shared with the stage badge and Croissance (ui §6.8). */
export function StageMeter({ stage }: { stage: StageView }) {
  const { snapshot } = useApp();
  const gate = stage.gate;
  return (
    <div className="stage-meter" aria-label={`Palier ${stage.level + 1} sur ${stage.total} : ${stage.name}`}>
      <div className="stage-top">
        <span className="stage-pips" aria-hidden="true">
          {Array.from({ length: stage.total }, (_, i) => <span key={i} className={cx('stage-pip', i <= stage.level && 'is-on')} />)}
        </span>
        <strong>Palier {stage.level + 1}/{stage.total} · {stage.name}</strong>
        <span className="muted small">depuis le jour {stage.sinceDay}</span>
      </div>
      {gate?.next ? (
        <div className="stage-gate">
          {gate.checks.map((c) => (
            <div key={c.label} className="gate-row">
              <span className="gate-label"><Icon name={c.ok ? 'check' : 'clock'} size={12} className={c.ok ? 'txt-good' : 'muted'} />{c.label}</span>
              <Bar value={gateFill(c)} color={c.ok ? '#16a34a' : '#2a78d6'} />
              <span className="gate-val">{num(c.value)} / {c.lower ? 'max ' : ''}{num(c.target)}</span>
            </div>
          ))}
          <div className="muted small">Tenu {gate.weeksHeld} / {gate.weeksNeeded} semaines avant le palier suivant.</div>
        </div>
      ) : <div className="muted small">{noGateText(stage, snapshot ? !!snapshot.scenario?.scaling : true)}</div>}
    </div>
  );
}

// ───────────────────────────── Organigramme ─────────────────────────────

const chiefFirst = (heads: readonly HeadRow[]) => [...heads].sort((a, b) => Number(b.isChief) - Number(a.isChief) || a.desk - b.desk);

function OrgChart({ depts, closed }: { depts: OrgDept[]; closed: { id: DeptId; name: string; hostedBy: DeptId | null }[] }) {
  const { lookups } = useApp();
  const top = depts.find((d) => d.id === 'direction');
  const columns = deptOrder(depts.filter((d) => d !== top));
  if (depts.length === 0) return <Empty compact>Aucune équipe ouverte.</Empty>;
  return (
    <>
      {top ? <div className="org-top">{chiefFirst(top.heads).map((h) => <HeadCard key={h.agentId} head={h} />)}</div> : null}
      <div className="org-grid">
        {columns.map((d) => (
          <div key={d.id} className="org-col">
            <div className="org-col-head">
              <Dot color={d.color} />
              <strong>{d.name}</strong>
              <span className="flex1" />
              {d.openReqs ? <Pill tone="amber">{plural(d.openReqs, 'poste', 'postes')}</Pill> : null}
              <span className="muted small" title="Charge de l’équipe sur 7 jours">{fmtPct(d.load, 0)}</span>
            </div>
            <div className="muted small">{fmtEur(d.cost30d, 0)} sur 30 j</div>
            {chiefFirst(d.heads).map((h) => <HeadCard key={h.agentId} head={h} />)}
          </div>
        ))}
      </div>
      {closed.length ? (
        <div className="muted small">
          Pas d’équipe pour l’instant : {closed.map((c) => (c.hostedBy ? `${c.name} (porté par ${deptName(lookups, c.hostedBy)})` : c.name)).join(', ')}.
        </div>
      ) : null}
    </>
  );
}

function HeadCard({ head }: { head: HeadRow }) {
  const { openAgent } = useApp();
  const hats = head.hats.map((k) => TASK_KIND_LABEL[k] ?? k);
  const hidden = hats.slice(HATS_SHOWN);
  return (
    <button type="button" className="head-card" onClick={() => openAgent(head.agentId)} title={`Ouvrir la fiche de ${head.name}`}>
      <PixelAvatar avatar={head.avatar} size={32} />
      <span className="head-main">
        <span className="head-name">{head.name}{head.isChief ? <ChiefBadge /> : null}</span>
        <span className="head-role">{head.role} · {TIER_LABEL[head.tier]}</span>
        <span className="head-meta">
          <Pill tone={CONTRACT_TONE[head.contract]}>{CONTRACT_LABEL[head.contract]}</Pill>
          <span title="Note observée, 1 500 au départ">{head.rating === null ? 'hors ligue' : `note ${fmtInt(head.rating)}`}</span>
          <span title="Salaire sur 30 jours">{fmtEur(head.pay30d, 0)}</span>
        </span>
        {hats.length ? (
          <span className="head-hats" title="Casquettes : tâches portées en dehors du rôle">
            {hats.slice(0, HATS_SHOWN).map((h) => <span key={h} className="hat-badge">{h}</span>)}
            {hidden.length ? <span className="hat-badge" title={hidden.join(', ')}>+{hidden.length}</span> : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// ───────────────────────────── Pression, recrutement, décisions ─────────────────────────────

function PressureBars({ rows }: { rows: RolePressure[] }) {
  if (rows.length === 0) return <Empty compact>Aucun rôle sous pression.</Empty>;
  const sorted = [...rows].sort((a, b) => b.relief - a.relief);
  const calm = sorted.length - PRESSURE_SHOWN;
  return (
    <div className="pressure">
      {sorted.slice(0, PRESSURE_SHOWN).map((p) => {
        const hot = p.relief >= RELIEF_TARGET && p.ownerUtil >= UTIL_TARGET;
        return (
          <div key={p.roleId} className="pressure-row">
            <div className="pressure-title">
              <strong>{ROLE_LABEL[p.roleId] ?? p.roleId}</strong>
              <span className={cx('small', hot ? 'txt-warn' : 'muted')}>{p.days} / {PRESSURE_DAYS} j au-dessus du seuil</span>
            </div>
            <span className="pressure-label">Attente</span>
            <Bar value={p.relief / RELIEF_TARGET} color={p.relief >= RELIEF_TARGET ? '#d97706' : '#2a78d6'} title="Ticks d’attente par jour, le seuil d’embauche est à 12" />
            <span className="pressure-val">{fmtDec(p.relief, 1)} / {RELIEF_TARGET}</span>
            <span className="pressure-label">Utilisation</span>
            <Bar value={p.ownerUtil / UTIL_TARGET} color={p.ownerUtil >= UTIL_TARGET ? '#d97706' : '#2a78d6'} title="Occupation de qui tient le rôle, le seuil d’embauche est à 70 %" />
            <span className="pressure-val">{fmtPct(p.ownerUtil, 0)} / {fmtPct(UTIL_TARGET, 0)}</span>
          </div>
        );
      })}
      {calm > 0 ? <div className="muted small">{plural(calm, 'autre rôle moins pressé', 'autres rôles moins pressés')}.</div> : null}
    </div>
  );
}

function HiringPlan({ reqs }: { reqs: HiringReqView[] }) {
  const { lookups } = useApp();
  if (reqs.length === 0) return <Empty compact>Aucun poste ouvert ni pourvu pour l’instant.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Poste</th><th>Équipe</th><th>Pourquoi</th><th>Statut</th><th className="num">Depuis</th><th className="num">Budget 30 j</th><th>Candidats</th></tr>
        </thead>
        <tbody>
          {reqs.map((r) => (
            <tr key={r.id}>
              <td><strong>{r.role}</strong></td>
              <td><Dot color={deptColor(lookups, r.dept)} /> {deptName(lookups, r.dept)}</td>
              <td className="req-why">{r.why}{r.blockedBy ? <div className="txt-warn small">Bloqué : {r.blockedBy}</div> : null}</td>
              <td><Pill tone={REQ_STATUS_TONE[r.status]}>{REQ_STATUS_LABEL[r.status]}</Pill></td>
              <td className="num">J{fmtInt(r.openedDay)}</td>
              <td className="num">{fmtEur(r.budget30d, 0)}</td>
              <td>
                {r.candidates.length === 0 ? <span className="muted">—</span> : r.candidates.map((c) => (
                  <div key={c.name} className="small">{c.name} · {fmtInt(c.score)}/100 <span className="muted">{c.source}</span></div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const REFUSAL_NUMBERS: { key: string; label: string; format(n: number): string }[] = [
  { key: 'cash', label: 'Trésorerie', format: (n) => fmtEur(n, 0) },
  { key: 'margin', label: 'Marge par jour', format: (n) => fmtEurSigned(n) },
  { key: 'cost', label: 'Coût par jour avec ce poste', format: (n) => fmtEur(n) },
  { key: 'payroll', label: 'Salaires par jour', format: (n) => fmtEur(n) },
  { key: 'pay', label: 'Salaire du poste', format: (n) => fmtEur(n) },
  { key: 'revenue30', label: 'CA 30 j', format: (n) => fmtEur(n, 0) },
  { key: 'headcount', label: 'Effectif', format: fmtInt },
  { key: 'relief', label: 'Attente par jour', format: (n) => fmtDec(n, 1) },
  { key: 'ownerUtil', label: 'Utilisation', format: (n) => fmtPct(n, 0) },
];

function Refusal({ entry }: { entry: ChronicleEntry }) {
  const numbers = REFUSAL_NUMBERS.filter((r) => entry.numbers?.[r.key] !== undefined);
  return (
    <div className="card refusal">
      <SectionTitle right={<span className="muted small">J{fmtInt(entry.day)}</span>}>Dernier refus</SectionTitle>
      <div>{entry.text}</div>
      {entry.why ? <div className="muted small">{entry.why}</div> : null}
      {numbers.length ? (
        <div className="refusal-numbers">
          {numbers.map((r) => <span key={r.key} className="chip">{r.label} : <strong>{r.format(entry.numbers![r.key]!)}</strong></span>)}
        </div>
      ) : null}
    </div>
  );
}

/** A list of team moves, each with its reason. Shared with the transfers of Compétition. */
export function ChronicleList({ entries, empty }: { entries: ChronicleEntry[]; empty: string }) {
  if (entries.length === 0) return <Empty compact>{empty}</Empty>;
  return (
    <ul className="team-list">
      {entries.map((e) => (
        <li key={e.key}>
          <span className="team-day">J{fmtInt(e.day)}</span>
          <span className="team-line">
            <span>{e.text}</span>
            {e.why ? <span className="muted small">{e.why}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
