// App shell: the pixel world fills the screen; floating glass panels on top (like the reference video).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanySnapshot, DeptId } from '../../shared/types';
import { api, type ControlAction, type Speed } from './api';
import { useAgency } from './store';
import { ActivityFeed } from './ui/ActivityFeed';
import { AgentPanel } from './ui/AgentPanel';
import { cx } from './ui/common';
import { sessionView } from './ui/derive';
import { AppContext, type AppCtx } from './ui/context';
import { DeptPanel } from './ui/DeptPanel';
import { DeptStrip } from './ui/DeptStrip';
import { EndBanner } from './ui/EndBanner';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { CompanyBadge, SimHud } from './ui/Hud';
import { PixelLogo } from './ui/icons';
import { buildLookups, placeTab, TABS, type TabId } from './ui/labels';
import { MissionBar } from './ui/MissionBar';
import { ScenarioModal } from './ui/ScenarioModal';
import { AdsTab } from './ui/tabs/AdsTab';
import { BrainTab } from './ui/tabs/BrainTab';
import { CalendarTab } from './ui/tabs/CalendarTab';
import { FinanceTab } from './ui/tabs/FinanceTab';
import { GalleryTab } from './ui/tabs/GalleryTab';
import { InboxTab } from './ui/tabs/InboxTab';
import { LearningTab } from './ui/tabs/LearningTab';
import { ProductsTab } from './ui/tabs/ProductsTab';
import { TasksTab } from './ui/tabs/TasksTab';
import { Toasts, useToasts } from './ui/Toasts';
import { TopBar } from './ui/TopBar';
import { useEventToasts } from './ui/useEventToasts';
import { Minimap } from './world/Minimap';
import { WorldCanvas } from './world/WorldCanvas';

// Tabs read from a GET and fetch their chunk on first open: the main bundle stays what the world needs.
const CanauxTab = lazy(() => import('./ui/tabs/CanauxTab').then((m) => ({ default: m.CanauxTab })));
const CroissanceTab = lazy(() => import('./ui/tabs/CroissanceTab').then((m) => ({ default: m.CroissanceTab })));
const EffectifTab = lazy(() => import('./ui/tabs/EffectifTab').then((m) => ({ default: m.EffectifTab })));
const CompetitionTab = lazy(() => import('./ui/tabs/CompetitionTab').then((m) => ({ default: m.CompetitionTab })));

export type Focus = { kind: 'dept'; id: DeptId } | { kind: 'agent'; id: string } | { kind: 'overview' } | null;

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

export default function App() {
  const agency = useAgency();
  const { snapshot, activity, connection, demo, godMode, speed: localSpeed, setSpeed, setGodMode, replaceSnapshot, applySession } = agency;
  const agencyRefresh = agency.refresh;
  const lookups = useMemo(() => buildLookups(snapshot), [snapshot]);
  const { toasts, push, dismiss } = useToasts();

  const [tab, setTab] = useState<TabId>('bureau');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [panelDept, setPanelDept] = useState<DeptId | null>(null);
  const [backDept, setBackDept] = useState<DeptId | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [flowMode, setFlowMode] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [brainPath, setBrainPath] = useState<string | null>(null);
  const [endDismissed, setEndDismissed] = useState<string | null>(null);
  const [ctrlBusy, setCtrlBusy] = useState(false);
  const [productFocus, setProductFocus] = useState<{ id: string; seq: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // snapshot.session (server loop) is the source of truth for play/pause and speed; local state is the fallback
  const sim = useMemo(() => sessionView(snapshot, localSpeed), [snapshot, localSpeed]);
  const speed = sim.speed;
  useEffect(() => {
    // remember the server speed locally (fallback for the next load); demo data must not overwrite it
    if (sim.fromServer && !demo && sim.speed !== localSpeed) setSpeed(sim.speed);
  }, [sim.fromServer, sim.speed, localSpeed, setSpeed, demo]);

  const openProduct = useCallback((id: string) => {
    setProductFocus((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
    setTab('produits');
  }, []);

  // A note of the previous run means nothing in this one, however the run changed (form, load, another window).
  const currentRun = snapshot?.runId;
  useEffect(() => { setBrainPath(null); }, [currentRun]);

  useEventToasts(snapshot, push, connection === 'live' || connection === 'reconnecting', openProduct);

  // Connection transitions → one toast each.
  const prevConn = useRef(connection);
  useEffect(() => {
    const prev = prevConn.current;
    prevConn.current = connection;
    if (connection === 'demo' && prev !== 'demo') push({ tone: 'warn', title: 'Mode démo', text: 'Serveur non connecté : données d’exemple. Lance « npm run dev » puis clique sur Réessayer.', ttl: 7000 });
    if (connection === 'live' && (prev === 'demo' || prev === 'reconnecting')) push({ tone: 'good', icon: 'zap', title: 'Connecté à l’agence', text: 'Les données sont maintenant en direct.' });
  }, [connection, push]);

  // ── Navigation ─────────────────────────────────────────────
  const openAgent = useCallback((id: string, fromDept?: DeptId | null) => {
    setAgentId(id);
    setBackDept(fromDept ?? null);
    setPanelDept(null);
    setFocus({ kind: 'agent', id });
  }, []);
  const selectAgentInWorld = useCallback((id: string) => {
    setAgentId(id);
    setBackDept(null);
    setPanelDept(null);
  }, []);
  const openDept = useCallback((id: DeptId) => {
    setPanelDept(id);
    setAgentId(null);
    setBackDept(null);
    setFocus({ kind: 'dept', id });
  }, []);
  const closePanel = useCallback(() => { setAgentId(null); setPanelDept(null); setBackDept(null); }, []);
  const backToDept = useCallback(() => { setAgentId(null); setPanelDept(backDept); setBackDept(null); }, [backDept]);
  const overview = useCallback(() => setFocus({ kind: 'overview' }), []);
  const openPlace = useCallback((place: string) => {
    const target = placeTab(place);
    if (target) setTab(target);
  }, []);
  const openBrainNote = useCallback((path: string) => { setBrainPath(path); setTab('cerveau'); }, []);
  const refresh = useCallback(() => { void agencyRefresh().catch(() => undefined); }, [agencyRefresh]);

  // ── Simulation controls ────────────────────────────────────
  const control = useCallback(async (action: ControlAction, newSpeed?: Speed) => {
    if (demo) {
      push({ tone: 'warn', title: 'Mode démo', text: 'Les commandes de simulation nécessitent le serveur (npm run dev).' });
      return;
    }
    if (newSpeed) setSpeed(newSpeed);
    const slow = action === 'step' || action === 'day';
    if (slow) setCtrlBusy(true);
    try {
      const r = await api.control(action === 'play' ? { action, speed: newSpeed ?? speed } : { action });
      if (!r.ok) throw new Error(r.message ?? 'Commande refusée');
      if (r.session) applySession(r.session);
      if (r.speed) setSpeed(r.speed);
      await agencyRefresh().catch(() => undefined);
    } catch (e) {
      push({ tone: 'bad', title: 'Commande non exécutée', text: e instanceof Error ? e.message : undefined });
    } finally {
      if (slow) setCtrlBusy(false);
    }
  }, [demo, push, setSpeed, speed, agencyRefresh, applySession]);

  const toggleGod = useCallback((on: boolean) => {
    setGodMode(on);
    if (on) push({ tone: 'info', icon: 'eye', title: 'Mode dieu activé', text: demo ? 'Mode démo : vérité cachée simulée.' : 'Vraies intentions des clients, vérité des niches et vrai talent visibles (Boîte mail, Apprentissage, Compétition).' });
  }, [setGodMode, push, demo]);

  const onLoaded = useCallback((s: CompanySnapshot) => {
    replaceSnapshot(s);
    closePanel();
    setTab('bureau');
    setEndDismissed(null);
    setFocus({ kind: 'overview' });
  }, [replaceSnapshot, closePanel]);

  // ── Keyboard: Esc closes, 1-9/0 and the letters of « Plus » switch tabs, / focuses search ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && scenarioOpen) { setScenarioOpen(false); return; }
      if (isTyping(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === 'Escape') {
        if (agentId || panelDept) closePanel();
        else if (tab !== 'bureau') setTab('bureau');
        return;
      }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (scenarioOpen) return;
      const t = TABS.find((x) => x.key === e.key);
      if (t) { e.preventDefault(); setTab(t.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scenarioOpen, agentId, panelDept, tab, closePanel]);

  const ctx: AppCtx = useMemo(() => ({
    snapshot,
    lookups,
    activity,
    demo,
    godMode,
    runId: snapshot?.runId ?? '',
    toast: push,
    openAgent,
    openDept,
    openProduct,
    centerAgent: (id: string) => setFocus({ kind: 'agent', id }),
    centerDept: (id: DeptId) => setFocus({ kind: 'dept', id }),
    setTab,
    openBrainNote,
    refresh,
  }), [snapshot, lookups, activity, demo, godMode, push, openAgent, openDept, openProduct, openBrainNote, refresh]);

  const sideOpen = !!agentId || !!panelDept;
  const closeTab = () => setTab('bureau');
  const status = snapshot?.status;
  const endKey = snapshot ? `${snapshot.runId}:${status}` : null;
  const showEnd = (status === 'bankrupt' || status === 'goal_reached' || status === 'finished') && endDismissed !== endKey;
  const selectedDept = panelDept ?? backDept ?? (agentId ? lookups.agents.get(agentId)?.dept ?? null : null);

  return (
    <AppContext.Provider value={ctx}>
      <div className={cx('app', sideOpen && 'has-side', tab !== 'bureau' && 'has-overlay', flowMode && 'is-flow', godMode && 'is-god')}>
        <div className="world-layer">
          <ErrorBoundary label="Le monde" resetKey={snapshot?.runId}>
            <WorldCanvas
              snapshot={snapshot}
              activity={activity}
              lowPower={tab !== 'bureau' && tab !== 'taches' /* the md overlay leaves half the world visible */}
              selectedAgentId={agentId}
              selectedDept={selectedDept}
              focus={focus}
              flowMode={flowMode}
              onSelectAgent={selectAgentInWorld}
              onSelectDept={openDept}
              onSelectPlace={openPlace}
            />
          </ErrorBoundary>
        </div>

        <div className="ui-layer">
          <TopBar
            tab={tab}
            onTab={setTab}
            flowMode={flowMode}
            onFlow={setFlowMode}
            godMode={godMode}
            onGod={toggleGod}
            onNewScenario={() => setScenarioOpen(true)}
            searchRef={searchRef}
          />
          <div className="hud-row">
            <CompanyBadge connection={connection} lastError={agency.lastError} onRetry={agency.retry} />
            <SimHud sim={sim} onControl={(a, s) => void control(a, s)} busy={ctrlBusy} />
          </div>

          <DeptStrip selected={selectedDept} onPick={openDept} onOverview={overview} />

          <ErrorBoundary label="L’onglet" resetKey={`${tab}:${snapshot?.runId}`}>
            {tab === 'taches' ? <TasksTab onClose={closeTab} /> : null}
            {tab === 'calendrier' ? <CalendarTab onClose={closeTab} /> : null}
            {tab === 'produits' ? <ProductsTab onClose={closeTab} focusId={productFocus?.id ?? null} focusSeq={productFocus?.seq ?? 0} /> : null}
            {tab === 'pub' ? <AdsTab onClose={closeTab} /> : null}
            <Suspense fallback={null}>
              {tab === 'canaux' ? <CanauxTab onClose={closeTab} /> : null}
              {tab === 'croissance' ? <CroissanceTab onClose={closeTab} /> : null}
              {tab === 'effectif' ? <EffectifTab onClose={closeTab} /> : null}
              {tab === 'competition' ? <CompetitionTab onClose={closeTab} /> : null}
            </Suspense>
            {tab === 'mail' ? <InboxTab onClose={closeTab} /> : null}
            {tab === 'finance' ? <FinanceTab onClose={closeTab} /> : null}
            {tab === 'cerveau' ? <BrainTab key={currentRun} onClose={closeTab} initialPath={brainPath} /> : null}
            {tab === 'apprentissage' ? <LearningTab onClose={closeTab} /> : null}
            {tab === 'galerie' ? <GalleryTab onClose={closeTab} /> : null}
          </ErrorBoundary>

          <ErrorBoundary label="Le panneau" resetKey={`${agentId}:${panelDept}`}>
            {agentId ? <AgentPanel agentId={agentId} backDept={backDept} onBack={backToDept} onClose={closePanel} /> : null}
            {!agentId && panelDept ? <DeptPanel deptId={panelDept} onClose={closePanel} /> : null}
          </ErrorBoundary>

          <ErrorBoundary label="Le journal" quiet>
            <ActivityFeed />
          </ErrorBoundary>
          <MissionBar />
          <div className="minimap-wrap">
            <ErrorBoundary label="La carte" quiet resetKey={snapshot?.runId}>
              <Minimap snapshot={snapshot} selectedDept={selectedDept} onPick={openDept} onOverview={overview} />
            </ErrorBoundary>
          </div>

          {showEnd ? <EndBanner onNewScenario={() => setScenarioOpen(true)} onDismiss={() => setEndDismissed(endKey)} onFinance={() => setTab('finance')} /> : null}
          <Toasts toasts={toasts} onDismiss={dismiss} />
          {scenarioOpen ? <ScenarioModal onClose={() => setScenarioOpen(false)} onLoaded={onLoaded} /> : null}
          {!snapshot ? <Splash connection={connection} onRetry={agency.retry} /> : null}
        </div>
      </div>
    </AppContext.Provider>
  );
}

function Splash({ connection, onRetry }: { connection: string; onRetry(): void }) {
  return (
    <div className="splash glass">
      <PixelLogo size={40} />
      <strong className="pixel-font">Pixel Agency</strong>
      {connection === 'demo' ? (
        <>
          <span>Serveur non connecté et données de démonstration indisponibles.</span>
          <button type="button" className="btn btn-dark btn-sm" onClick={onRetry}>Réessayer</button>
        </>
      ) : (
        <span><span className="spinner" /> Connexion à l’agence…</span>
      )}
    </div>
  );
}
