// Department panel: Aperçu (KPIs, tools, competences, team) | Tâches | Calendrier.
import { useMemo, useState } from 'react';
import type { DeptId, Task, TaskKind } from '../../../shared/types';
import { Avatar, Bar, ChiefBadge, cx, Empty, Pill, SectionTitle, Segmented } from './common';
import { useApp } from './context';
import { fmtDec, fmtInt } from './format';
import { Icon } from './icons';
import {
  AGENT_STATUS_LABEL, BUSY_STATUSES, deptColor, deptName, TASK_KIND_LABEL, TASK_STATUS_LABEL, TASK_STATUS_TONE,
  toolGroupsOf, TOOL_LABEL,
} from './labels';
import { SidePanel } from './SidePanel';

type DeptTab = 'apercu' | 'taches' | 'calendrier';

const STATUS_ORDER: Record<Task['status'], number> = { awaiting_founder: 0, in_progress: 1, review: 2, pending: 3, failed: 4, done: 5, cancelled: 6 };

export function DeptPanel({ deptId, onClose }: { deptId: DeptId; onClose(): void }) {
  const { snapshot, lookups, centerDept } = useApp();
  const [tab, setTab] = useState<DeptTab>('apercu');
  const dept = lookups.depts.get(deptId);
  const color = deptColor(lookups, deptId);
  const name = deptName(lookups, deptId);
  const members = (snapshot?.company?.agents ?? []).filter((a) => a.dept === deptId);
  const chief = (dept && lookups.agents.get(dept.chiefId)) || members.find((a) => a.isChief);
  const tasks = useMemo(() => (snapshot?.company?.tasks ?? []).filter((t) => t.dept === deptId), [snapshot, deptId]);

  return (
    <SidePanel label={`Équipe ${name}`} eyebrow="ÉQUIPE" eyebrowColor={color} onCenter={() => centerDept(deptId)} onClose={onClose}>
      <div className="agent-head">
        <span className="dept-icon" style={{ background: color }}><Icon name="building" size={20} /></span>
        <div className="agent-titles">
          <div className="agent-name">{name}</div>
          <div className="agent-role">{fmtInt(members.length)} agent{members.length > 1 ? 's' : ''} · chef : {chief?.name ?? '—'}</div>
        </div>
      </div>
      {dept?.description ? <div className="dept-desc">{dept.description}</div> : null}
      <div className="side-tabs">
        <Segmented<DeptTab> value={tab} onChange={setTab} options={[
          { id: 'apercu', label: 'Aperçu' },
          { id: 'taches', label: 'Tâches', count: tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length },
          { id: 'calendrier', label: 'Calendrier' },
        ]} />
      </div>
      <div className="side-body">
        {tab === 'apercu' ? <Overview deptId={deptId} tasks={tasks} /> : null}
        {tab === 'taches' ? <DeptTasks tasks={tasks} /> : null}
        {tab === 'calendrier' ? <DeptCalendar tasks={tasks} /> : null}
      </div>
    </SidePanel>
  );
}

function Overview({ deptId, tasks }: { deptId: DeptId; tasks: Task[] }) {
  const { snapshot, lookups, openAgent } = useApp();
  const day = snapshot?.day ?? 1;
  const color = deptColor(lookups, deptId);
  const members = (snapshot?.company?.agents ?? []).filter((a) => a.dept === deptId).sort((a, b) => Number(b.isChief) - Number(a.isChief) || a.name.localeCompare(b.name));
  const today = tasks.filter((t) => t.dayCreated === day || t.dayDone === day).length;
  const running = tasks.filter((t) => t.status === 'in_progress' || t.status === 'review').length;
  const done = tasks.filter((t) => t.status === 'done' && t.dayDone !== null);
  const avgDelay = done.length ? done.reduce((s, t) => s + ((t.dayDone ?? t.dayCreated) - t.dayCreated), 0) / done.length : null;

  const tools = toolGroupsOf(members.flatMap((a) => a.tools ?? []));
  const kinds = [...new Set(members.flatMap((a) => a.taskKinds ?? []))];
  const since = Math.max(1, day - 6);
  const kindCount = new Map<TaskKind, number>();
  for (const t of tasks) if ((t.dayDone ?? t.dayCreated) >= since) kindCount.set(t.kind, (kindCount.get(t.kind) ?? 0) + 1);
  const maxKind = Math.max(1, ...kindCount.values());

  return (
    <>
      <div className="stat-cards">
        <div className="stat-card" style={{ borderBottomColor: '#ef4444' }}><span>Tâches aujourd’hui</span><strong>{fmtInt(today)}</strong></div>
        <div className="stat-card" style={{ borderBottomColor: '#22c55e' }}><span>En cours</span><strong>{fmtInt(running)}</strong></div>
        <div className="stat-card" style={{ borderBottomColor: '#3b82f6' }}><span>Délai moyen</span><strong>{avgDelay === null ? '—' : avgDelay < 0.5 ? '< 1 j' : `${fmtDec(avgDelay)} j`}</strong></div>
      </div>

      <SectionTitle right={<span className="pill tone-green">{tools.length} actifs</span>}>Outils connectés</SectionTitle>
      <div className="tool-grid">
        {tools.length === 0 ? <span className="muted small">Aucun outil.</span> : null}
        {tools.map((g) => (
          <div key={g.id} className="tool-tile" title={g.owned.map((t) => TOOL_LABEL[t] ?? t).join(' · ')}>
            <span className="tool-tile-icon" style={{ color }}><Icon name={g.icon} size={14} /></span>
            <span className="tool-tile-text"><strong>{g.label}</strong><span><span className="connected-dot" /> Connecté</span></span>
          </div>
        ))}
      </div>

      <SectionTitle right={<span className="muted small">7 derniers jours</span>}>Compétences</SectionTitle>
      <div className="skills">
        {kinds.length === 0 ? <span className="muted small">Aucune compétence déclarée.</span> : null}
        {kinds.map((k) => {
          const n = kindCount.get(k) ?? 0;
          return (
            <div key={k} className="skill-row">
              <span className="skill-name mono">{TASK_KIND_LABEL[k] ?? k}</span>
              <Bar value={n / maxKind} color={color} />
              <span className={cx('skill-val', n === 0 && 'muted')}>{n === 0 ? 'inactif' : fmtInt(n)}</span>
            </div>
          );
        })}
      </div>

      <SectionTitle>Agents</SectionTitle>
      <div className="member-list">
        {members.length === 0 ? <Empty compact>Pas encore d’agent dans ce département.</Empty> : null}
        {members.map((a) => {
          const busy = BUSY_STATUSES.has(a.status);
          return (
            <button key={a.id} type="button" className="member" onClick={() => openAgent(a.id, deptId)}>
              <Avatar name={a.name} color={color} size={30} chief={a.isChief} />
              <span className="member-main">
                <span className="member-name">{a.name}{a.isChief ? <ChiefBadge /> : null}</span>
                <span className="member-role">{a.role}</span>
              </span>
              <span className={cx('member-status', busy ? 'is-busy' : a.status === 'coffee' ? 'is-coffee' : 'is-free')}>
                {busy ? 'au travail' : a.status === 'coffee' ? 'pause café' : (AGENT_STATUS_LABEL[a.status] ?? a.status).toLowerCase()}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function DeptTasks({ tasks }: { tasks: Task[] }) {
  const { lookups, openAgent } = useApp();
  const sorted = [...tasks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.dayCreated - a.dayCreated).slice(0, 60);
  if (sorted.length === 0) return <Empty icon="list">Aucune tâche pour ce département pour l’instant.</Empty>;
  return (
    <div className="mini-tasks">
      {sorted.map((t) => {
        const who = t.assignee ? lookups.agents.get(t.assignee) : undefined;
        return (
          <div key={t.id} className="mini-task">
            <div className="task-line-top">
              <span className="task-line-title">{t.title}</span>
              <Pill tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Pill>
            </div>
            <div className="mini-task-meta">
              {who ? <button type="button" className="link-btn" onClick={() => openAgent(who.id, t.dept)}>{who.name}</button> : <span className="muted">non assignée</span>}
              <span className="muted"> · J{t.dayCreated}{t.attempts > 1 ? ` · tentative ${t.attempts}` : ''}</span>
            </div>
            {t.status === 'in_progress' || t.status === 'review' ? <Bar value={t.progress} height={4} color={deptColor(lookups, t.dept)} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function DeptCalendar({ tasks }: { tasks: Task[] }) {
  const { snapshot } = useApp();
  const day = snapshot?.day ?? 1;
  const days: { d: number; done: Task[]; created: Task[] }[] = [];
  for (let d = day; d >= Math.max(1, day - 13); d--) {
    days.push({ d, done: tasks.filter((t) => t.dayDone === d && t.status === 'done'), created: tasks.filter((t) => t.dayCreated === d) });
  }
  if (tasks.length === 0) return <Empty icon="calendar">Le calendrier se remplira dès que l’équipe recevra ses premières tâches.</Empty>;
  return (
    <div className="dept-cal">
      {days.map(({ d, done, created }) => (
        <div key={d} className={cx('dept-cal-day', d === day && 'is-today')}>
          <div className="dept-cal-head">
            <strong>Jour {d}</strong>
            <span className="muted small">{fmtInt(done.length)} terminée{done.length > 1 ? 's' : ''} · {fmtInt(created.length)} créée{created.length > 1 ? 's' : ''}</span>
          </div>
          {done.length === 0 && created.length === 0 ? <div className="muted small">Journée calme.</div> : null}
          {done.map((t) => <div key={t.id} className="dept-cal-item"><Icon name="check" size={12} className="txt-good" /> {t.title}</div>)}
          {created.filter((t) => t.status !== 'done').map((t) => <div key={t.id} className="dept-cal-item muted"><Icon name="plus" size={12} /> {t.title} <span className="small">({TASK_STATUS_LABEL[t.status].toLowerCase()})</span></div>)}
        </div>
      ))}
    </div>
  );
}

