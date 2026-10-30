// Calendar of simulated days: tasks done, sales and profit per day; click a day → detail + journal.
import { useEffect, useMemo, useState } from 'react';
import type { DailyKpi } from '../../../../shared/types';
import { api, type BrainNote } from '../../api';
import { cx, Empty, Overlay, Pill, SectionTitle } from '../common';
import { useApp } from '../context';
import { fmtEur, fmtEurSigned, fmtInt, fmtPct, fmtRoas, pad3 } from '../format';
import { Icon } from '../icons';
import { Markdown } from '../markdown';
import { ACTIVITY_META, deptColor, EVENT_TONE } from '../labels';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function tint(profit: number, maxAbs: number): string {
  if (!maxAbs || !profit) return 'transparent';
  const a = Math.min(0.32, 0.06 + (Math.abs(profit) / maxAbs) * 0.26);
  return profit > 0 ? `rgba(12,163,12,${a})` : `rgba(208,59,59,${a})`;
}

export function CalendarTab({ onClose }: { onClose(): void }) {
  const { snapshot } = useApp();
  const today = snapshot?.day ?? 1;
  const [selected, setSelected] = useState<number>(Math.max(1, today - (snapshot?.phase === 'morning' ? 1 : 0)));
  const horizon = Math.max(snapshot?.scenario?.horizonDays ?? 30, today);
  const goalDay = snapshot?.scenario?.goal?.byDay ?? null;
  const kpiByDay = useMemo(() => new Map((snapshot?.company?.kpis ?? []).map((k) => [k.day, k] as const)), [snapshot]);
  const doneByDay = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of snapshot?.company?.tasks ?? []) if (t.status === 'done' && t.dayDone) m.set(t.dayDone, (m.get(t.dayDone) ?? 0) + 1);
    return m;
  }, [snapshot]);
  const eventsByDay = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of snapshot?.market?.events ?? []) m.set(e.day, (m.get(e.day) ?? 0) + 1);
    return m;
  }, [snapshot]);
  const maxAbs = Math.max(1, ...[...kpiByDay.values()].map((k) => Math.abs(k.profit)));
  const cells = Math.ceil(horizon / 7) * 7;

  return (
    <Overlay title="Calendrier" subtitle={`Jour ${today} sur ${horizon} · une case = une journée simulée`} icon="calendar" onClose={onClose}>
      <div className="cal-layout">
        <div className="cal-grid-wrap">
          <div className="cal-weekdays">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="cal-grid">
            {Array.from({ length: cells }, (_, i) => i + 1).map((d) => {
              const k = kpiByDay.get(d);
              const future = d > today;
              const beyond = d > horizon;
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
                      <span><Icon name="cart" size={10} /> {fmtInt(k?.sales ?? 0)}</span>
                      {k ? <span className={k.profit >= 0 ? 'txt-good' : 'txt-bad'}>{fmtEurSigned(k.profit, 0)}</span> : <span className="muted">en cours</span>}
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
        <DayDetail day={selected} kpi={kpiByDay.get(selected)} />
      </div>
    </Overlay>
  );
}

function DayDetail({ day, kpi }: { day: number; kpi: DailyKpi | undefined }) {
  const { snapshot, lookups, activity, demo, openAgent, openBrainNote, openProduct } = useApp();
  const [note, setNote] = useState<BrainNote | null>(null);
  const [noteState, setNoteState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const tasksDone = (snapshot?.company?.tasks ?? []).filter((t) => t.status === 'done' && t.dayDone === day);
  const events = (snapshot?.market?.events ?? []).filter((e) => e.day === day);
  const dayActs = activity.filter((a) => a.day === day && (a.kind === 'lesson' || a.kind === 'event' || a.kind === 'deliverable' || a.kind === 'finance')).slice(-8);
  const journalPath = `journal/jour-${pad3(day)}.md`;

  useEffect(() => {
    let cancelled = false;
    setNote(null);
    if (demo) { setNoteState('missing'); return; }
    setNoteState('loading');
    api.brainNote(journalPath)
      .then((n) => { if (!cancelled) { setNote(n); setNoteState('idle'); } })
      .catch(() => { if (!cancelled) setNoteState('missing'); });
    return () => { cancelled = true; };
  }, [journalPath, demo, snapshot?.runId]);

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
      ) : <div className="muted small">Les chiffres de la journée tombent à la clôture du marché.</div>}

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

      <SectionTitle>Tâches terminées · {tasksDone.length}</SectionTitle>
      {tasksDone.length === 0 ? <div className="muted small">Aucune tâche terminée ce jour-là.</div> : (
        <ul className="day-tasks">
          {tasksDone.slice(0, 30).map((t) => (
            <li key={t.id}>
              <span className="eyebrow-dot" style={{ background: deptColor(lookups, t.dept) }} />
              <span>{t.title}</span>
              {t.assignee ? <button type="button" className="link-btn small" onClick={() => openAgent(t.assignee!)}>{lookups.agents.get(t.assignee)?.name ?? ''}</button> : null}
            </li>
          ))}
        </ul>
      )}

      <SectionTitle right={note ? <button type="button" className="link-btn small" onClick={() => openBrainNote(note.path)}>Ouvrir dans le cerveau</button> : null}>Journal du jour</SectionTitle>
      {noteState === 'loading' ? <div className="muted small"><span className="spinner" /> Lecture du cerveau…</div> : null}
      {note ? <div className="journal-note"><Markdown text={note.body} onWikiLink={() => openBrainNote(journalPath)} /></div> : null}
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
