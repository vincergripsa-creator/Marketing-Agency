// Agent panel: Discussion (chat + live work trace) | Fiche (card) | Playbook (learned rules).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, AgentState, ChatMessage, DeptId, Task } from '../../../shared/types';
import { api } from '../api';
import { Avatar, Bar, ChiefBadge, cx, DeliverableLink, Empty, Pill, SectionTitle, Segmented } from './common';
import { useApp } from './context';
import { clamp01, fmtClock, fmtInt, fmtPct, hash, safeDiv } from './format';
import { Icon } from './icons';
import {
  ACTIVITY_META, AGENT_STATUS_LABEL, AGENT_STATUS_TONE, DELIVERABLE_ICON, DELIVERABLE_LABEL, deptColor, deptName, firstName,
  lessonForRule, LESSON_TOPIC_LABEL, LESSON_TOPIC_TONE, parseRule, RESEARCH_KINDS, TASK_KIND_LABEL, TASK_STATUS_LABEL,
  TASK_STATUS_TONE, TIER_LABEL, toolGroupsOf, TOOL_LABEL, type Lookups, type RuleKind, type Tone,
} from './labels';
import { SidePanel } from './SidePanel';

type AgentTab = 'chat' | 'fiche' | 'playbook';

interface LocalMsg { id: string; from: string; text: string; at: number; error?: boolean }

const SUGGESTIONS = ['Qu’est-ce que tu fais en ce moment ?', 'Un point rapide sur tes résultats ?', 'Qu’as-tu appris récemment ?'];

export function AgentPanel({ agentId, backDept, onBack, onClose }: { agentId: string; backDept: DeptId | null; onBack(): void; onClose(): void }) {
  const { snapshot, lookups, centerAgent } = useApp();
  const [tab, setTab] = useState<AgentTab>('chat');
  const agent = lookups.agents.get(agentId);

  if (!agent || !snapshot) {
    return (
      <SidePanel eyebrow="AGENT" eyebrowColor="#94a3b8" onCenter={() => centerAgent(agentId)} onClose={onClose} label="Agent">
        <div className="side-body"><Empty>Cet agent n’existe pas (ou plus) dans cette run.</Empty></div>
      </SidePanel>
    );
  }

  const color = deptColor(lookups, agent.dept);
  const rules = snapshot.company?.playbooks?.[agent.id] ?? [];

  return (
    <SidePanel
      label={`Agent ${agent.name}`}
      eyebrow={<>{deptName(lookups, agent.dept).toUpperCase()}{agent.isChief ? ' · CHEF D’ÉQUIPE' : ''}</>}
      eyebrowColor={color}
      onBack={backDept ? onBack : undefined}
      onCenter={() => centerAgent(agent.id)}
      onClose={onClose}
    >
      <div className="agent-head">
        <Avatar name={agent.name} color={color} size={44} chief={agent.isChief} />
        <div className="agent-titles">
          <div className="agent-name">{agent.name}{agent.isChief ? <ChiefBadge /> : null}</div>
          <div className="agent-role">{agent.role}</div>
        </div>
        <Pill tone={AGENT_STATUS_TONE[agent.status] ?? 'neutral'}><span className="status-dot" />{AGENT_STATUS_LABEL[agent.status] ?? agent.status}</Pill>
      </div>
      {agent.bubble ? <div className="agent-bubble">« {agent.bubble} »</div> : null}
      <div className="side-tabs">
        <Segmented<AgentTab> value={tab} onChange={setTab} options={[
          { id: 'chat', label: 'Discussion' },
          { id: 'fiche', label: 'Fiche' },
          { id: 'playbook', label: 'Playbook', count: rules.length },
        ]} />
      </div>
      {tab === 'chat' ? <ChatTab key={agent.id} agent={agent} /> : null}
      {tab === 'fiche' ? <div className="side-body"><FicheTab agent={agent} /></div> : null}
      {tab === 'playbook' ? <div className="side-body"><PlaybookTab agent={agent} rules={rules} /></div> : null}
    </SidePanel>
  );
}

// ───────────────────────────── Discussion ─────────────────────────────

function toolChips(acts: Activity[], tasks: Lookups['tasks']): string[] {
  return acts.map((a) => {
    const t = a.refs?.taskId ? tasks.get(a.refs.taskId) : undefined;
    if (t && RESEARCH_KINDS.has(t.kind) && (a.kind === 'task_start' || a.kind === 'thought' || a.kind === 'task_done')) return 'RECHERCHE';
    return ACTIVITY_META[a.kind]?.chip ?? 'ACTION';
  });
}

function ChatTab({ agent }: { agent: AgentState }) {
  const { snapshot, lookups, activity, demo } = useApp();
  const [draft, setDraft] = useState('');
  const [local, setLocal] = useState<LocalMsg[]>([]);
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prenom = firstName(agent.name);
  const color = deptColor(lookups, agent.dept);

  const server: ChatMessage[] = snapshot?.company?.chats?.[agent.id] ?? [];
  const messages = useMemo(() => {
    const seen = new Set(server.map((m) => `${m.from === 'founder' ? 'f' : 'a'}|${m.text.trim()}`));
    const extra = local.filter((m) => m.error || !seen.has(`${m.from === 'founder' ? 'f' : 'a'}|${m.text.trim()}`));
    return [...server.map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at, error: false })), ...extra].sort((a, b) => a.at - b.at);
  }, [server, local]);

  const recent = useMemo(() => {
    const out: Activity[] = [];
    for (let i = activity.length - 1; i >= 0 && out.length < 6; i--) {
      const a = activity[i]!;
      if (a.agentId === agent.id && a.kind !== 'walk' && a.kind !== 'chat') out.push(a);
    }
    return out.reverse();
  }, [activity, agent.id]);
  const chips = useMemo(() => toolChips(recent, lookups.tasks).slice(-8), [recent, lookups.tasks]);
  const currentTask = agent.currentTaskId ? lookups.tasks.get(agent.currentTaskId) : undefined;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, typing, recent.length]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || typing) return;
    const now = Date.now();
    setLocal((l) => [...l, { id: `local-${now}`, from: 'founder', text, at: now }]);
    setDraft('');
    setTyping(true);
    try {
      const reply = demo
        ? await new Promise<string>((r) => setTimeout(() => r(`Je tourne en mode démo, sans serveur : je ne peux pas encore travailler pour de vrai. Lance « npm run dev » et repose-moi la question — je répondrai avec le contexte de l’agence (jour ${snapshot?.day ?? 1}, mes tâches et le cerveau).`), 700))
        : await api.chat(agent.id, text);
      setLocal((l) => [...l, { id: `local-r-${Date.now()}`, from: agent.id, text: reply, at: Date.now() }]);
    } catch (e) {
      setLocal((l) => [...l, { id: `local-e-${Date.now()}`, from: agent.id, text: `Message non délivré : ${e instanceof Error ? e.message : 'erreur inconnue'}.`, at: Date.now(), error: true }]);
    } finally {
      setTyping(false);
    }
  };

  return (
    <>
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-intro">
            <Avatar name={agent.name} color={color} size={36} />
            <p><strong>{prenom}</strong> — {agent.persona}</p>
            <div className="chat-suggest">
              {SUGGESTIONS.map((s) => <button key={s} type="button" className="chip-btn" onClick={() => void send(s)}>{s}</button>)}
            </div>
          </div>
        ) : null}
        {messages.map((m, i) => {
          const mine = m.from === 'founder';
          const prev = messages[i - 1];
          const showDay = !prev || Math.abs(m.at - prev.at) > 30 * 60 * 1000;
          return (
            <div key={m.id}>
              {showDay ? <div className="chat-sep">{fmtClock(m.at)}</div> : null}
              <div className={cx('msg', mine ? 'msg-me' : 'msg-agent', m.error && 'msg-error')}>
                {!mine ? <div className="msg-who">{prenom}</div> : null}
                <div className="msg-text">{m.text}</div>
              </div>
            </div>
          );
        })}
        {typing ? (
          <div className="msg msg-agent msg-typing" aria-live="polite">
            <div className="msg-who">{prenom} écrit</div>
            <span className="typing"><i /><i /><i /></span>
          </div>
        ) : null}
        {recent.length > 0 ? (
          <div className="work-trace">
            <div className="work-head">{prenom.toUpperCase()} {agent.status === 'working' || agent.status === 'thinking' || agent.status === 'reviewing' ? 'TRAVAILLE…' : '· ACTIVITÉ RÉCENTE'}</div>
            {currentTask ? <div className="work-task"><Icon name="play" size={11} /> {currentTask.title}</div> : null}
            <div className="work-lines">
              {recent.slice(-4).map((a) => <div key={a.id} className="work-line">{a.text}</div>)}
            </div>
            <div className="tool-chips">
              {chips.map((c, i) => <span key={`${c}-${i}`} className="tool-chip">{c}</span>)}
            </div>
          </div>
        ) : null}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Écris à ${prenom}…`} maxLength={800} aria-label={`Message à ${prenom}`} />
        <button type="submit" className={cx('send-btn', draft.trim() && 'send-ready')} disabled={!draft.trim() || typing} aria-label="Envoyer"><Icon name="send" size={15} /></button>
      </form>
      <div className="chat-foot muted small">Entrée pour envoyer · {prenom} lit le cerveau avant de répondre</div>
    </>
  );
}

// ───────────────────────────── Fiche ─────────────────────────────

function recentTasks(tasks: Task[], agentId: string): Task[] {
  return tasks
    .filter((t) => t.assignee === agentId)
    .sort((a, b) => (b.dayDone ?? b.dayCreated) - (a.dayDone ?? a.dayCreated) || b.id.localeCompare(a.id))
    .slice(0, 5);
}

function FicheTab({ agent }: { agent: AgentState }) {
  const { snapshot, lookups } = useApp();
  const color = deptColor(lookups, agent.dept);
  const tasks = recentTasks(snapshot?.company?.tasks ?? [], agent.id);
  const deliverables = (snapshot?.company?.deliverables ?? []).filter((d) => d.createdBy === agent.id).slice(-8).reverse();
  const current = agent.currentTaskId ? lookups.tasks.get(agent.currentTaskId) : undefined;
  const groups = toolGroupsOf(agent.tools);
  const perf = agent.perf ?? { done: 0, approved: 0, rejected: 0, failed: 0, score: 0 };
  const reviewed = perf.approved + perf.rejected;

  return (
    <div className="fiche">
      <div className="chip-row">
        <span className="chip" style={{ borderColor: color }}><span className="eyebrow-dot" style={{ background: color }} />{deptName(lookups, agent.dept)}</span>
        <span className={cx('chip', `tier-${agent.tier}`)}><Icon name="sparkle" size={11} /> {TIER_LABEL[agent.tier] ?? agent.tier}</span>
        <span className="chip">Niveau {agent.level} · {fmtInt(agent.xp)} xp</span>
      </div>
      <p className="persona">{agent.persona}</p>

      <SectionTitle>Outils connectés <span className="muted">· {groups.length}</span></SectionTitle>
      <div className="chip-row">
        {groups.length === 0 ? <span className="muted small">Aucun outil.</span> : null}
        {groups.map((g) => (
          <span key={g.id} className="chip chip-tool" title={g.owned.map((t) => TOOL_LABEL[t] ?? t).join(' · ')}>
            <Icon name={g.icon} size={12} />{g.label}<span className="connected">connecté</span>
          </span>
        ))}
      </div>

      <SectionTitle>Compétences</SectionTitle>
      <div className="skills">
        {(agent.skills ?? []).length === 0 ? <span className="muted small">Pas de compétence déclarée.</span> : null}
        {(agent.skills ?? []).map((s) => {
          // Mastery estimate: level and performance, with a stable per-skill offset (display only).
          const v = clamp01((35 + agent.level * 7 + (perf.score || 50) * 0.25 + (hash(agent.id + s) % 18)) / 100);
          return (
            <div key={s} className="skill-row">
              <span className="skill-name">{s}</span>
              <Bar value={v} color={color} />
              <span className="skill-val">{Math.round(v * 100)}</span>
            </div>
          );
        })}
      </div>

      <SectionTitle>Performance</SectionTitle>
      <div className="perf-grid">
        <div><strong>{Math.round(perf.score)}</strong><span>score /100</span></div>
        <div><strong>{fmtInt(perf.done)}</strong><span>tâches faites</span></div>
        <div><strong>{reviewed ? fmtPct(safeDiv(perf.approved, reviewed), 0) : '—'}</strong><span>approuvées</span></div>
        <div><strong className={perf.failed ? 'txt-bad' : undefined}>{fmtInt(perf.failed)}</strong><span>échecs</span></div>
      </div>
      <div className="energy-row">
        <span className="small muted">Énergie</span>
        <Bar value={(agent.energy ?? 0) / 100} color={(agent.energy ?? 0) < 30 ? '#d97706' : '#16a34a'} />
        <span className="small">{Math.round(agent.energy ?? 0)}</span>
      </div>

      <SectionTitle>Tâche en cours</SectionTitle>
      {current ? <TaskLine task={current} /> : <div className="muted small">Aucune tâche en cours{agent.status === 'coffee' ? ' — pause café.' : '.'}</div>}

      <SectionTitle>Tâches récentes</SectionTitle>
      {tasks.length === 0 ? <div className="muted small center-text">Pas encore de tâche pour {firstName(agent.name)}.</div> : tasks.map((t) => <TaskLine key={t.id} task={t} />)}

      <SectionTitle>Livrables</SectionTitle>
      {deliverables.length === 0 ? <div className="muted small center-text">Aucun livrable pour l’instant.</div> : (
        <div className="deliv-list">
          {deliverables.map((d) => (
            <DeliverableLink key={d.id} path={d.path} icon={DELIVERABLE_ICON[d.kind] ?? 'file'} className="deliv-link" title={`${DELIVERABLE_LABEL[d.kind] ?? d.kind} · jour ${d.day}`}>
              <span className="deliv-title">{d.title}</span>
              <span className="muted small">J{d.day}</span>
            </DeliverableLink>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskLine({ task }: { task: Task }) {
  return (
    <div className="task-line">
      <div className="task-line-top">
        <span className="task-line-title">{task.title}</span>
        <Pill tone={TASK_STATUS_TONE[task.status] ?? 'neutral'}>{TASK_STATUS_LABEL[task.status] ?? task.status}</Pill>
      </div>
      <div className="task-line-meta muted small">
        {TASK_KIND_LABEL[task.kind] ?? task.kind} · J{task.dayCreated}{task.dayDone ? ` → J${task.dayDone}` : ''}{task.attempts > 1 ? ` · tentative ${task.attempts}` : ''}
      </div>
      {task.status === 'in_progress' || task.status === 'review' ? <Bar value={task.progress} height={4} /> : null}
    </div>
  );
}

// ───────────────────────────── Playbook ─────────────────────────────

const RULE_TONE: Record<RuleKind, Tone> = { banned: 'red', hook: 'pink', format: 'violet', price: 'amber', hype: 'orange', tone: 'cyan', free: 'neutral' };

function PlaybookTab({ agent, rules }: { agent: AgentState; rules: string[] }) {
  const { snapshot, openBrainNote } = useApp();
  const lessons = snapshot?.company?.lessons ?? [];
  if (rules.length === 0) {
    return <Empty icon="grad">{firstName(agent.name)} n’a pas encore de règle apprise. Les rétros du soir transforment les leçons chiffrées en règles de playbook.</Empty>;
  }
  return (
    <div className="playbook">
      <div className="muted small">{rules.length} / 12 règles · injectées dans chaque tâche de {firstName(agent.name)}</div>
      {rules.map((r, i) => {
        const parsed = parseRule(r);
        const lesson = lessonForRule(r, lessons, agent.id);
        return (
          <div key={`${i}-${r}`} className="rule">
            <div className="rule-top">
              <span className="rule-num">{i + 1}</span>
              <Pill tone={RULE_TONE[parsed.kind]}>{parsed.label}{parsed.value ? ` : ${parsed.value}` : ''}</Pill>
            </div>
            <div className="rule-text">{r}</div>
            {lesson ? (
              <button type="button" className="rule-lesson" onClick={() => lesson.notePath && openBrainNote(lesson.notePath)} title={lesson.notePath ? 'Ouvrir la note dans le cerveau' : undefined}>
                <Pill tone={LESSON_TOPIC_TONE[lesson.topic] ?? 'neutral'}>{LESSON_TOPIC_LABEL[lesson.topic] ?? lesson.topic}</Pill>
                <span>Leçon du jour {lesson.day} : {lesson.insight}</span>
                <span className="muted">{lesson.evidence} · confiance {fmtPct(lesson.confidence, 0)}</span>
              </button>
            ) : <div className="muted small">Règle de départ (seed) ou issue d’une revue RH.</div>}
          </div>
        );
      })}
    </div>
  );
}
