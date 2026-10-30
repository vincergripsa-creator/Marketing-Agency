// Standalone preview (served by Vite at /world-preview.html): the world + minimap on mock data,
// with fake motion every 2 s (statuses, places, activity) so the art can be checked without the server.
import { StrictMode, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import type { Activity, ActivityKind, AgentState, AgentStatus, CompanySnapshot, DayPhase, DeptId, Place } from '../../../shared/types';
import { Minimap } from './Minimap';
import { WorldCanvas, type WorldCanvasProps } from './WorldCanvas';
import { mockSnapshot } from './mockSnapshot';

const PHASE: (t: number) => DayPhase = (t) => (t === 0 ? 'morning' : t <= 9 ? 'work' : t === 10 ? 'market' : 'evening');
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

const TEXTS: Partial<Record<ActivityKind, string[]>> = {
  brain_read: ['Lit « Règle du un » avant d’agir.', 'Consulte les leçons sur les hooks.', 'Relit la fiche produit « Dodo serein ».', 'Vérifie « Conformité pub TikTok ».', 'Parcourt le journal du jour 9.'],
  brain_write: ['Ajoute une leçon : les hooks « question » gagnent.', 'Met à jour la fiche niche sommeil bébé.', 'Écrit le compte rendu de la tâche.', 'Note un verbatim client précieux.'],
  deliverable: ['Livrable prêt : storyboard « POV première nuit ».', 'Nouvelle version du chapitre 4 livrée.', 'Rapport de campagne envoyé à Léo.', 'Page de vente v3 en ligne.'],
  review: ['Relecture : 2 corrections demandées.', 'Validé, on peut livrer.', 'À reprendre : la promesse est trop forte.'],
  thought: ['Je compare les CTR à impressions égales.', 'Il manque un exemple concret ici.', 'Le prix de 19 € tient bien.', 'Cette phrase sonne trop « IA », je la réécris.'],
  task_done: ['Tâche terminée, je passe à la suivante.', 'C’est livré et relu.'],
};

function nextStatus(s: AgentStatus): AgentStatus {
  const r = Math.random();
  switch (s) {
    case 'working': return r < 0.6 ? 'working' : r < 0.75 ? 'coffee' : r < 0.85 ? 'thinking' : r < 0.92 ? 'reviewing' : r < 0.96 ? 'blocked' : 'idle';
    case 'coffee': return r < 0.7 ? 'working' : 'idle';
    case 'idle': return r < 0.6 ? 'working' : r < 0.8 ? 'coffee' : 'idle';
    case 'meeting': return r < 0.6 ? 'working' : 'meeting';
    default: return r < 0.75 ? 'working' : s;
  }
}

function mutate(prev: CompanySnapshot, cycle: number): CompanySnapshot {
  const now = Date.now();
  const agents: AgentState[] = prev.company.agents.map((a) => ({ ...a }));
  const byDept = new Map<string, AgentState[]>();
  for (const a of agents) byDept.set(a.dept, [...(byDept.get(a.dept) ?? []), a]);
  const acts: Activity[] = [];
  let n = 0;
  const emit = (agent: AgentState | null, kind: ActivityKind, text: string, extra?: Partial<Activity>) =>
    acts.push({ id: `act_live_${cycle}_${n++}`, day: prev.day, tick: prev.tick, at: now + n * 120, agentId: agent?.id ?? null, kind, text, ...extra });

  // a few agents change what they do
  for (let i = 0; i < 4; i++) {
    const a = pick(agents);
    const s = nextStatus(a.status);
    a.status = s;
    if (s === 'coffee') {
      a.place = 'cafe';
      a.energy = Math.min(100, a.energy + 20);
      emit(a, 'coffee', 'Petite pause café, je recharge les batteries.', { place: 'cafe' });
    } else if (s === 'meeting' || (s === 'working' && Math.random() < 0.08 && a.isChief)) {
      a.status = 'meeting';
      a.place = 'direction';
      emit(a, 'meeting', 'Point rapide avec Camille à la Direction.', { place: 'direction' });
    } else {
      a.place = a.dept as Place;
      if (s === 'blocked') a.bubble = 'Bloqué : j’attends une validation.';
      else if (a.bubble && Math.random() < 0.5) a.bubble = null;
    }
  }
  // chiefs delegate, everyone reads / writes the brain
  const chief = pick(agents.filter((a) => a.isChief));
  const team = (byDept.get(chief.dept) ?? []).filter((a) => a.id !== chief.id);
  const task = pick(prev.company.tasks);
  if (team.length) {
    const to = pick(team);
    to.status = 'working';
    to.place = to.dept as Place;
    emit(chief, 'delegate', pick([`Peux-tu reprendre « ${task.title} » ?`, `Viens à ton bureau, on fait le point sur « ${task.title} ».`, `Priorité du jour : « ${task.title} ».`]), { toAgentId: to.id });
  }
  for (const kind of ['brain_read', 'brain_read', 'brain_write', pick(['deliverable', 'review', 'thought', 'task_done'] as ActivityKind[])] as ActivityKind[]) {
    const a = pick(agents.filter((x) => x.status !== 'coffee'));
    const extra: Partial<Activity> = {};
    if (kind === 'review') extra.toAgentId = pick(agents.filter((x) => x.dept === a.dept && x.id !== a.id).concat(agents.filter((x) => x.isChief))).id;
    emit(a, kind, pick(TEXTS[kind] ?? ['…']), extra);
  }
  // time passes: one tick every 3 cycles
  let { day, tick } = prev;
  if (cycle % 3 === 0) {
    tick += 1;
    if (tick >= 12) {
      tick = 0;
      day += 1;
    }
  }
  const activity = [...prev.activity, ...acts].slice(-200);
  return { ...prev, day, tick, phase: PHASE(tick), company: { ...prev.company, agents }, activity };
}

const panel: CSSProperties = {
  background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderRadius: 14,
  boxShadow: '0 8px 28px rgba(44,34,90,0.16)', border: '1px solid rgba(255,255,255,0.7)', padding: '10px 12px',
  fontFamily: 'Inter, system-ui, sans-serif', color: '#2a2540', fontSize: 12,
};
const btn = (on = false): CSSProperties => ({
  border: 0, borderRadius: 999, padding: '6px 11px', cursor: 'pointer', font: '600 12px Inter, system-ui, sans-serif',
  background: on ? '#7c6cf0' : 'rgba(124,108,240,0.12)', color: on ? '#fff' : '#3b3358',
});

const PHASE_LABEL: Record<DayPhase, string> = { morning: 'Stand-up du matin', work: 'Travail', market: 'Clôture du marché', evening: 'Rétro du soir' };

function Preview() {
  const [snapshot, setSnapshot] = useState<CompanySnapshot>(() => mockSnapshot());
  const [selectedAgentId, setAgent] = useState<string | null>(null);
  const [selectedDept, setDept] = useState<DeptId | null>(null);
  const [focus, setFocus] = useState<WorldCanvasProps['focus']>({ kind: 'overview' });
  const [flowMode, setFlow] = useState(false);
  const [running, setRunning] = useState(true);
  const cycle = useRef(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      cycle.current += 1;
      setSnapshot((s) => mutate(s, cycle.current));
    }, 2000);
    return () => window.clearInterval(id);
  }, [running]);

  const onSelectAgent = useCallback((id: string) => {
    setAgent(id);
    setDept(null);
    setFocus({ kind: 'agent', id });
  }, []);
  const onSelectDept = useCallback((id: DeptId) => {
    setDept(id);
    setAgent(null);
    setFocus({ kind: 'dept', id });
  }, []);
  const overview = () => {
    setAgent(null);
    setDept(null);
    setFocus(null);
    requestAnimationFrame(() => setFocus({ kind: 'overview' }));
  };
  const skipTime = () => setSnapshot((s) => {
    const tick = (s.tick + 1) % 12;
    return { ...s, tick, day: tick === 0 ? s.day + 1 : s.day, phase: PHASE(tick) };
  });

  const agent = snapshot.company.agents.find((a) => a.id === selectedAgentId);
  const dept = snapshot.company.departments.find((d) => d.id === selectedDept);
  const working = snapshot.company.agents.filter((a) => a.status === 'working' || a.status === 'reviewing').length;

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <WorldCanvas
        snapshot={snapshot}
        selectedAgentId={selectedAgentId}
        selectedDept={selectedDept}
        focus={focus}
        flowMode={flowMode}
        onSelectAgent={onSelectAgent}
        onSelectDept={onSelectDept}
      />
      <div style={{ ...panel, position: 'absolute', top: 14, left: 14, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: '#ef4444', color: '#fff', font: '700 9px Inter, sans-serif', letterSpacing: '.08em', padding: '3px 7px', borderRadius: 6 }}>APERÇU DU MONDE</span>
          <strong style={{ fontSize: 14 }}>{snapshot.company.name}</strong>
        </div>
        <div style={{ color: '#6f6888' }}>
          Jour {snapshot.day} · tick {snapshot.tick} · {PHASE_LABEL[snapshot.phase]} · {snapshot.company.agents.length} agents · {working} en cours
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" style={btn(flowMode)} onClick={() => setFlow((f) => !f)}>Mode flux</button>
          <button type="button" style={btn()} onClick={overview}>Vue d’ensemble</button>
          <button type="button" style={btn()} onClick={skipTime}>Avancer l’heure</button>
          <button type="button" style={btn(!running)} onClick={() => setRunning((r) => !r)}>{running ? 'Figer' : 'Reprendre'}</button>
        </div>
        {(agent || dept) && (
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 8 }}>
            {agent ? (
              <>
                <strong>{agent.name}</strong> — {agent.role}
                <div style={{ color: '#6f6888' }}>Statut : {agent.status} · lieu : {agent.place} · énergie {agent.energy}</div>
              </>
            ) : dept ? (
              <>
                <strong>{dept.name}</strong>
                <div style={{ color: '#6f6888' }}>{dept.description}</div>
              </>
            ) : null}
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', right: 14, bottom: 14 }}>
        <Minimap snapshot={snapshot} selectedDept={selectedDept} onPick={onSelectDept} onOverview={overview} />
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}
