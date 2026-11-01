// "État des tâches": founder approvals, missions, filterable task cards.
import { useMemo, useState } from 'react';
import type { DeptId, Mission, Task, TaskStatus } from '../../../../shared/types';
import { api } from '../../api';
import { Avatar, Bar, cx, DeliverableLink, Empty, Overlay, Pill, SectionTitle, Segmented } from '../common';
import { useApp } from '../context';
import { approvalAsk, doneTasksTotal, failedTasksTotal, hasWaiver, redTeamView } from '../derive';
import { fmtInt } from '../format';
import { Icon } from '../icons';
import {
  agentName, DELIVERABLE_ICON, DELIVERABLE_LABEL, deptColor, deptName, DEPT_ORDER, deptOrder, TASK_KIND_LABEL, TASK_STATUS_LABEL, TASK_STATUS_TONE,
} from '../labels';

type Filter = 'all' | 'running' | 'review' | 'waiting' | 'done' | 'failed';

const FILTER_STATUSES: Record<Exclude<Filter, 'all'>, TaskStatus[]> = {
  running: ['in_progress'],
  review: ['review'],
  waiting: ['pending', 'awaiting_founder'],
  done: ['done'],
  failed: ['failed', 'cancelled'],
};

const ORDER: Record<TaskStatus, number> = { awaiting_founder: 0, in_progress: 1, review: 2, pending: 3, failed: 4, done: 5, cancelled: 6 };
const PAGE = 60;

export function TasksTab({ onClose }: { onClose(): void }) {
  const { snapshot, lookups } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [dept, setDept] = useState<DeptId | 'all'>('all');
  const [limit, setLimit] = useState(PAGE);
  const tasks = snapshot?.company?.tasks ?? [];
  const missions = snapshot?.company?.missions ?? [];
  const approvals = snapshot?.company?.pendingApprovals ?? [];

  const scoped = useMemo(() => (dept === 'all' ? tasks : tasks.filter((t) => t.dept === dept)), [tasks, dept]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: scoped.length, running: 0, review: 0, waiting: 0, done: 0, failed: 0 };
    for (const t of scoped) {
      for (const [f, sts] of Object.entries(FILTER_STATUSES) as [Exclude<Filter, 'all'>, TaskStatus[]][]) if (sts.includes(t.status)) c[f]++;
    }
    return c;
  }, [scoped]);
  const visible = useMemo(() => {
    const list = filter === 'all' ? scoped : scoped.filter((t) => FILTER_STATUSES[filter].includes(t.status));
    return [...list].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.priority - b.priority || (b.dayDone ?? b.dayCreated) - (a.dayDone ?? a.dayCreated));
  }, [scoped, filter]);

  const deptIds = lookups.depts.size === 0 ? DEPT_ORDER : deptOrder([...lookups.depts.values()]).map((d) => d.id);
  // the snapshot keeps the latest finished tasks only: the counts are the run's, the list says what it shows
  const doneTotal = Math.max(doneTasksTotal(snapshot, dept) ?? 0, counts.done);
  const failedTotal = Math.max(failedTasksTotal(snapshot, dept) ?? 0, counts.failed);
  const allTotal = counts.all + doneTotal - counts.done + failedTotal - counts.failed;
  const listNotes = [
    doneTotal > counts.done && (filter === 'all' || filter === 'done') ? `${fmtInt(counts.done)} terminées les plus récentes affichées sur ${fmtInt(doneTotal)}` : null,
    failedTotal > counts.failed && (filter === 'all' || filter === 'failed') ? `${fmtInt(counts.failed)} échouées ou annulées les plus récentes affichées sur ${fmtInt(failedTotal)}` : null,
  ].filter(Boolean);
  const sectionCount = filter === 'all' ? allTotal : filter === 'done' ? doneTotal : filter === 'failed' ? failedTotal : visible.length;

  return (
    <Overlay title="État des tâches" subtitle={`Toute l’entreprise · jour ${snapshot?.day ?? 1}`} icon="list" onClose={onClose} size="md">
      {approvals.length > 0 ? <Approvals ids={approvals} /> : null}
      <MissionsList missions={missions} />

      <div className="filters-row">
        <Segmented<Filter> size="sm" value={filter} onChange={(f) => { setFilter(f); setLimit(PAGE); }} options={[
          { id: 'all', label: 'Tout', count: allTotal },
          { id: 'running', label: 'En cours', count: counts.running },
          { id: 'review', label: 'En revue', count: counts.review },
          { id: 'waiting', label: 'En attente', count: counts.waiting },
          { id: 'done', label: 'Terminées', count: doneTotal },
          { id: 'failed', label: 'Échouées', count: failedTotal },
        ]} />
        <select className="select" value={dept} onChange={(e) => { setDept(e.target.value as DeptId | 'all'); setLimit(PAGE); }} aria-label="Département">
          <option value="all">Toutes les équipes</option>
          {deptIds.map((d) => <option key={d} value={d}>{deptName(lookups, d)}</option>)}
        </select>
      </div>

      <SectionTitle right={listNotes.length ? <span className="muted small">{listNotes.join(' · ')}</span> : null}>
        {TASK_SECTION[filter]} · {fmtInt(sectionCount)}
      </SectionTitle>
      {visible.length === 0 ?<Empty icon="list">{filter === 'running' ? 'Personne ne travaille en ce moment.' : 'Aucune tâche dans cette catégorie.'}</Empty> : null}
      <div className="task-cards">
        {visible.slice(0, limit).map((t) => <TaskCard key={t.id} task={t} />)}
      </div>
      {visible.length > limit ? (
        <button type="button" className="btn btn-sm more-btn" onClick={() => setLimit((l) => l + PAGE)}>Afficher {Math.min(PAGE, visible.length - limit)} tâches de plus</button>
      ) : null}
    </Overlay>
  );
}

const TASK_SECTION: Record<Filter, string> = {
  all: 'Toutes les tâches', running: 'En cours', review: 'En revue', waiting: 'En attente', done: 'Terminées', failed: 'Échouées',
};

function Approvals({ ids }: { ids: string[] }) {
  const { lookups, activity, demo, toast, refresh } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (taskId: string, approved: boolean) => {
    if (demo) { toast({ tone: 'warn', title: 'Mode démo', text: 'La validation fondateur nécessite le serveur.' }); return; }
    setBusy(taskId);
    try {
      const r = await api.approve(taskId, approved);
      if (!r.ok) throw new Error(r.message ?? 'Refus du serveur');
      toast({ tone: approved ? 'good' : 'info', icon: approved ? 'check' : 'ban', title: approved ? 'Approuvé' : 'Refusé', text: approvalAsk(lookups.tasks.get(taskId), activity) ?? undefined });
      refresh();
    } catch (e) {
      toast({ tone: 'bad', title: 'Décision non enregistrée', text: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="approvals">
      <SectionTitle right={<span className="pill tone-amber">{ids.length} en attente</span>}>Validation du fondateur</SectionTitle>
      {ids.map((id) => {
        const t = lookups.tasks.get(id);
        const ask = approvalAsk(t, activity);
        return (
          <div key={id} className="approval-card">
            <div className="approval-main">
              <strong>{ask ?? id}</strong>
              {t && t.title !== ask ? <span className="small">{t.title}</span> : null}
              <span className="muted small">
                {t ? `${t.input?.layoff || t.input?.swap ? 'Décision RH' : TASK_KIND_LABEL[t.kind] ?? t.kind} · ${deptName(lookups, t.dept)} · demandé par ${agentName(lookups, t.assignee ?? t.createdBy)}` : 'Tâche inconnue'}
              </span>
            </div>
            <div className="approval-actions">
              <button type="button" className="btn btn-sm btn-good" disabled={busy === id} onClick={() => void decide(id, true)}><Icon name="check" size={13} /> Approuver</button>
              <button type="button" className="btn btn-sm btn-bad" disabled={busy === id} onClick={() => void decide(id, false)}><Icon name="x" size={13} /> Refuser</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MissionsList({ missions }: { missions: Mission[] }) {
  const { lookups, openAgent, openProduct } = useApp();
  const [all, setAll] = useState(false);
  if (missions.length === 0) return null;
  // the founder's own missions first: the departments open about seven a day
  const rank = (m: Mission) => (m.from === 'founder' ? 0 : 2) + (m.status === 'open' ? 0 : 1);
  const sorted = [...missions].sort((a, b) => rank(a) - rank(b) || b.day - a.day);
  const shown = all ? sorted : sorted.slice(0, 4);
  return (
    <div className="missions">
      <SectionTitle right={missions.length > 4 ? <button type="button" className="link-btn" onClick={() => setAll((v) => !v)}>{all ? 'Réduire' : `Tout voir (${missions.length})`}</button> : null}>
        Missions
      </SectionTitle>
      {shown.map((m) => {
        const ts = m.taskIds.map((id) => lookups.tasks.get(id)).filter((t): t is Task => !!t);
        // the server counts on every task: the snapshot only holds the latest ones
        const done = m.doneTasks ?? ts.filter((t) => t.status === 'done').length;
        const total = m.totalTasks ?? (m.doneTasks === undefined ? ts.length : m.taskIds.length);
        const owner = lookups.agents.get(m.ownerId);
        const product = m.productId ? lookups.products.get(m.productId) : undefined;
        return (
          <div key={m.id} className={cx('mission-card', `mission-${m.status}`)}>
            <div className="mission-card-top">
              <Icon name={m.from === 'founder' ? 'crown' : 'flag'} size={13} />
              <span className="mission-text">{m.text}</span>
              <Pill tone={m.status === 'done' ? 'green' : m.status === 'failed' ? 'red' : 'blue'}>{m.status === 'done' ? 'Accomplie' : m.status === 'failed' ? 'Échouée' : 'Ouverte'}</Pill>
            </div>
            <div className="mission-card-meta muted small">
              J{m.day} · {m.from === 'founder' ? 'du fondateur' : `de ${agentName(lookups, m.from)}`} · pilote :{' '}
              {owner ? <button type="button" className="link-btn" onClick={() => openAgent(owner.id)}>{owner.name}</button> : '—'} · {done}/{total} tâches
            </div>
            {m.outcome ? <div className="mission-outcome small">{m.outcome}</div> : null}
            {product ? <button type="button" className="link-btn small" onClick={() => openProduct(product.id)} title="Voir le produit"><Icon name="package" size={11} /> {product.title}</button> : null}
            {total ? <Bar value={done / total} height={4} color={m.status === 'failed' ? '#dc2626' : '#16a34a'} /> : null}
          </div>
        );
      })}
    </div>
  );
}

export function TaskCard({ task }: { task: Task }) {
  const { lookups, openAgent } = useApp();
  const [expanded, setExpanded] = useState(false);
  const color = deptColor(lookups, task.dept);
  const who = task.assignee ? lookups.agents.get(task.assignee) : undefined;
  const reviewer = task.reviewer ? lookups.agents.get(task.reviewer) : undefined;
  const lastReview = task.reviews?.[task.reviews.length - 1];
  const deliverables = (task.deliverableIds ?? []).map((id) => lookups.deliverables.get(id)).filter((d) => !!d);
  const redTeam = redTeamView(task);
  return (
    <article className="task-card" style={{ borderLeftColor: color }}>
      <div className="task-card-top">
        <span className="task-dept" style={{ color }}><span className="eyebrow-dot" style={{ background: color }} />{deptName(lookups, task.dept)}</span>
        <span className="muted small">{TASK_KIND_LABEL[task.kind] ?? task.kind}</span>
        {task.priority === 1 ? <Pill tone="red">Urgent</Pill> : null}
        {redTeam?.verdict ? <Pill tone={redTeam.verdict === 'Go' ? 'green' : 'amber'}>{redTeam.verdict}</Pill> : null}
        {redTeam?.cycle ? <Pill tone="violet" title="Passage de la Red Team sur une version retravaillée">Reprise {redTeam.cycle}</Pill> : null}
        {hasWaiver(task) ? <Pill tone="amber" icon="alert" title="Validée après les reprises prévues : la réserve est notée pour la prochaine version">Dérogation</Pill> : null}
        <span className="flex1" />
        <Pill tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Pill>
      </div>
      <div className="task-card-title">{task.title}</div>
      <div className="task-card-row">
        {who ? (
          <button type="button" className="assignee" onClick={() => openAgent(who.id)}>
            <Avatar name={who.name} color={color} size={20} />{who.name}
          </button>
        ) : <span className="muted small">Non assignée</span>}
        {reviewer ? <span className="muted small">· revue : {reviewer.name}</span> : null}
        <span className="flex1" />
        <span className="muted small">J{task.dayCreated}{task.dayDone ? ` → J${task.dayDone}` : ''}{task.attempts > 1 ? ` · tentative ${task.attempts}` : ''}</span>
      </div>
      {task.status !== 'done' && task.status !== 'cancelled' ? <Bar value={task.progress} height={5} color={color} /> : null}
      {lastReview ? (
        <div className={cx('review-note', `review-${lastReview.verdict}`)}>
          <strong>{lastReview.verdict === 'approve' ? 'Approuvé' : lastReview.verdict === 'changes' ? 'À corriger' : 'Rejeté'}</strong> par {agentName(lookups, lastReview.by)} (J{lastReview.day})
          {lastReview.notes?.length ? <ul>{lastReview.notes.slice(0, 3).map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
        </div>
      ) : null}
      {deliverables.length ? (
        <div className="chip-row">
          {deliverables.map((d) => (
            <DeliverableLink key={d!.id} path={d!.path} icon={DELIVERABLE_ICON[d!.kind] ?? 'file'}>{DELIVERABLE_LABEL[d!.kind] ?? d!.kind}</DeliverableLink>
          ))}
        </div>
      ) : null}
      {task.log?.length ? (
        <>
          <button type="button" className="link-btn small" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Masquer le journal' : `Journal (${task.log.length})`}
          </button>
          {expanded ? <ol className="task-log">{task.log.slice(-8).map((l, i) => <li key={i}>{l}</li>)}</ol> : null}
        </>
      ) : null}
    </article>
  );
}
