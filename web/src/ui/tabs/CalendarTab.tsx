// Calendar of simulated days: tasks done, sales and profit per day; click a day → detail + journal.
import { useEffect, useMemo, useState } from 'react';
import type { DailyKpi, ScenarioConfig } from '../../../../shared/types';
import { api, type BrainNote } from '../../api';
import { cx, Empty, Overlay, Pill, SectionTitle } from '../common';
import { useApp } from '../context';
import { doneTasksByDay } from '../derive';
import { fmtEur, fmtEurSigned, fmtInt, fmtPct, fmtRoas, pad3 } from '../format';
import { Icon } from '../icons';
import { Markdown } from '../markdown';
import { ACTIVITY_META, agentName, deptColor, EVENT_TONE } from '../labels';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const WEEK = 7;
const OPEN_WEEKS = 26;

/**
 * The days on the grid, whole weeks: day 1 sits on a Monday. A run with an end shows all of it. A run without one has no last cell
 * to reach for: the coming week, the deadline if it is ahead, and six months back at most, or a long run redraws a year of buttons each tick.
 */
export function calendarSpan(today: number, scenario: Pick<ScenarioConfig, 'horizonDays' | 'openEnded' | 'goal'> | undefined): { from: number; to: number; end: number | null } {
  const roundUp = (d: number) => Math.ceil(d / WEEK) * WEEK;
  if (!scenario?.openEnded) {
    const end = Math.max(scenario?.horizonDays ?? 30, today);
    return { from: 1, to: roundUp(end), end };
  }
  const thisWeek = Math.floor((today - 1) / WEEK);
  return { from: 1 + WEEK * Math.max(0, thisWeek - OPEN_WEEKS + 1), to: roundUp(Math.max(today + WEEK, scenario.goal?.byDay ?? 0)), end: null };
}

function tint(profit: number, maxAbs: number): string {
  if (!maxAbs || !profit) return 'transparent';
  const a = Math.min(0.32, 0.06 + (Math.abs(profit) / maxAbs) * 0.26);
  return profit > 0 ? `rgba(12,163,12,${a})` : `rgba(208,59,59,${a})`;
}

export function CalendarTab({ onClose }: { onClose(): void }) {
  const { snapshot } = useApp();
  const today = snapshot?.day ?? 1;
  const [selected, setSelected] = useState<number>(Math.max(1, today - (snapshot?.phase === 'morning' ? 1 : 0)));
  const { from, to, end } = calendarSpan(today, snapshot?.scenario);
  const goalDay = snapshot?.scenario?.goal?.byDay ?? null;
  const kpiByDay = useMemo(() => new Map((snapshot?.company?.kpis ?? []).map((k) => [k.day, k] as const)), [snapshot]);
  const doneByDay = useMemo(() => doneTasksByDay(snapshot), [snapshot]);
  const eventsByDay = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of snapshot?.market?.events ?? []) m.set(e.day, (m.get(e.day) ?? 0) + 1);
    return m;
  }, [snapshot]);
  const maxAbs = Math.max(1, ...[...kpiByDay.values()].map((k) => Math.abs(k.profit)));

  return (
    <Overlay title="Calendrier" subtitle={`Jour ${today}${end === null ? '' : ` sur ${end}`} · une case = une journée simulée`} icon="calendar" onClose={onClose}>
      <div className="cal-layout">
        <div className="cal-grid-wrap">
          <div className="cal-weekdays">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="cal-grid">
            {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((d) => {
              const k = kpiByDay.get(d);
              const future = d > today;
              const beyond = end !== null && d > end;
              const done = doneByDay.get(d) ?? 0;
              const ev = eventsByDay.get(d) ?? 0;
              return (
                <button
                  key={d}
                  type="button"
                  disabled={future || beyond}
                  className={cx('cal-cell', d === today && 'is-today', d === selected && 'is-selected', future && 'is-future', beyond && 'is-beyond')}
                  style={k ? { background: `linear-gradient(${tint(k.profit, maxAbs)}, ${tint(k.profit, maxAbs)}), #fff` } : undefined}
                  onClick={() => setSelected(d)}
                  title={k ? `Jour ${d} : ${fmtEurSigned(k.profit)} · ${k.sales} ventes` : `Jour ${d}`}
                >
                  <span className="cal-day">Jour {d}</span>
                  {goalDay === d ? <span className="cal-goal" title="Échéance de l’objectif"><Icon name="flag" size={11} /></span> : null}
                  {!future && !beyond ? (
                    <span className="cal-stats">
                      <span><Icon name="check" size={10} /> {fmtInt(done)}</span>
                      <span><Icon name="cart" size={10} /> {k ? fmtInt(k.sales) : '—'}</span>
                      {k ? <span className={k.profit >= 0 ? 'txt-good' : 'txt-bad'}>{fmtEurSigned(k.profit, 0)}</span> : <span className="muted">{d === today ? 'en cours' : '—'}</span>}
                      {ev ? <span className="cal-ev" title={`${ev} événement(s)`}>{ev}</span> : null}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="cal-legend muted small">
            <span><span className="legend-swatch" style={{ background: 'rgba(12,163,12,.3)' }} /> journée rentable</span>
            <span><span className="legend-swatch" style={{ background: 'rgba(208,59,59,.3)' }} /> journée à perte</span>
            <span><Icon name="check" size={10} /> tâches terminées</span>
            <span><Icon name="cart" size={10} /> ventes</span>
          </div>
        </div>
        <DayDetail day={selected} today={today} kpi={kpiByDay.get(selected)} doneCount={doneByDay.get(selected) ?? 0} />
      </div>
    </Overlay>
  );
}

const DAY_TASKS_SHOWN = 30;

/** Today's journal is written tonight: asking for it would only log a 404. */
export const journalWritten = (day: number, today: number): boolean => day < today;

function DayDetail({ day, today, kpi, doneCount }: { day: number; today: number; kpi: DailyKpi | undefined; doneCount: number }) {
  const { snapshot, lookups, activity, demo, openAgent, openBrainNote, openProduct } = useApp();
  const [note, setNote] = useState<BrainNote | null>(null);
  const [noteState, setNoteState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const tasksDone = (snapshot?.company?.tasks ?? []).filter((t) => t.status === 'done' && t.dayDone === day);
  // the snapshot only keeps the latest finished tasks: the count stays the real one, the list says what it lacks
  const total = Math.max(doneCount, tasksDone.length);
  const listed = tasksDone.slice(0, DAY_TASKS_SHOWN);
  const lost = total - tasksDone.length;
  const events =(snapshot?.market?.events ?? []).filter((e) => e.day === day);
  const dayActs = activity.filter((a) => a.day === day && (a.kind === 'lesson' || a.kind === 'event' || a.kind === 'deliverable' || a.kind === 'finance')).slice(-8);
  const journalPath = `journal/jour-${pad3(day)}.md`;

  useEffect(() => {
    let cancelled = false;
    setNote(null);
    if (demo || !journalWritten(day, today)) { setNoteState('missing'); return; }
    setNoteState('loading');
    api.brainNote(journalPath)
      .then((n) => { if (!cancelled) { setNote(n); setNoteState('idle'); } })
      .catch(() => { if (!cancelled) setNoteState('missing'); });
    return () => { cancelled = true; };
  }, [journalPath, day, today, demo, snapshot?.runId]);

  return (
    <div className="day-detail">
      <h3>Jour {day}</h3>
      {kpi ? (
        <div className="kpi-mini">
          <div><span>Profit</span><strong className={kpi.profit >= 0 ? 'txt-good' : 'txt-bad'}>{fmtEurSigned(kpi.profit)}</strong></div>
          <div><span>CA</span><strong>{fmtEur(kpi.revenue)}</strong></div>
          <div><span>Pub</span><strong>{fmtEur(kpi.adSpend)}</strong></div>
          <div><span>Ventes</span><strong>{fmtInt(kpi.sales)}</strong></div>
          <div><span>Rembours.</span><strong>{fmtInt(kpi.refunds)}</strong></div>
          <div><span>CTR</span><strong>{fmtPct(kpi.ctr, 2)}</strong></div>
          <div><span>Conversion</span><strong>{fmtPct(kpi.cvr, 1)}</strong></div>
          <div><span>ROAS</span><strong>{fmtRoas(kpi.roas)}</strong></div>
        </div>
      ) : <div className="muted small">{day === today ? 'Les chiffres de la journée tombent à la clôture du marché.' : 'Journée close : le détail de ses chiffres n’est plus gardé, seuls les derniers jours le sont.'}</div>}

      {events.length ? (
        <>
          <SectionTitle>Événements</SectionTitle>
          {events.map((e) => {
            const product = e.refs?.productId ? lookups.products.get(e.refs.productId) : undefined;
            return (
              <div key={e.id} className="event-line">
                <Pill tone={EVENT_TONE[e.severity]}>{e.title}</Pill>
                <span className="small">{e.description}</span>
                {product ? (
                  <button type="button" className="link-btn small" onClick={() => openProduct(product.id)} title={product.title}>
                    <Icon name="package" size={11} /> Voir le produit
                  </button>
                ) : null}
              </div>
            );
          })}
        </>
      ) : null}

      <SectionTitle>Tâches terminées · {fmtInt(total)}</SectionTitle>
      {total === 0 ? <div className="muted small">Aucune tâche terminée ce jour-là.</div> : null}
      {listed.length ? (
        <ul className="day-tasks">
          {listed.map((t) => (
            <li key={t.id}>
              <span className="eyebrow-dot" style={{ background: deptColor(lookups, t.dept) }} />
              <span>{t.title}</span>
              {t.assignee ? <button type="button" className="link-btn small" onClick={() => openAgent(t.assignee!)}>{agentName(lookups, t.assignee)}</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {tasksDone.length > listed.length ? <div className="muted small">… et {fmtInt(tasksDone.length - listed.length)} autres.</div> : null}
      {lost > 0 ? <div className="muted small">Détail indisponible pour {fmtInt(lost)} tâche{lost > 1 ? 's' : ''} : seules les plus récentes sont conservées.</div> : null}

      <SectionTitle right={note ? <button type="button" className="link-btn small" onClick={() => openBrainNote(note.path)}>Ouvrir dans le cerveau</button> : null}>Journal du jour</SectionTitle>
      {noteState === 'loading' ? <div className="muted small"><span className="spinner" /> Lecture du cerveau…</div> : null}
      {note ? <div className="journal-note"><Markdown text={note.body} onWikiLink={openBrainNote} /></div> : null}
      {noteState === 'missing' ? (
        dayActs.length ? (
          <ul className="day-acts">
            {dayActs.map((a) => <li key={a.id}><span className="feed-icon"><IconFor kind={a.kind} /></span>{a.text}</li>)}
          </ul>
        ) : <Empty compact icon="brain">{demo ? 'Le rapport du jour est écrit dans le cerveau par l’équipe Analyse (serveur requis).' : `Pas de rapport « ${journalPath} » pour ce jour.`}</Empty>
      ) : null}
    </div>
  );
}

function IconFor({ kind }: { kind: keyof typeof ACTIVITY_META }) {
  return <Icon name={ACTIVITY_META[kind]?.icon ?? 'info'} size={12} />;
}
