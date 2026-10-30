// Live agency state: initial GET /api/state, then SSE updates; demo fallback when the server is down.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, CompanySnapshot } from '../../shared/types';
import { api, openStream, type Speed } from './api';
import { mockSnapshot } from './world/mockSnapshot';

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'demo';

export interface Agency {
  snapshot: CompanySnapshot | null;
  /** Snapshot activity merged with streamed batches, oldest first. */
  activity: Activity[];
  connection: Connection;
  demo: boolean;
  lastError: string | null;
  godMode: boolean;
  setGodMode(on: boolean): void;
  speed: Speed;
  setSpeed(s: Speed): void;
  /** Forget the failure count and try the server again. */
  retry(): void;
  /** Re-fetch /api/state now. */
  refresh(): Promise<void>;
  /** Replace the snapshot (after POST /api/scenario or /api/load). */
  replaceSnapshot(s: CompanySnapshot): void;
}

const MAX_ACTIVITY = 400;
const FAILURES_BEFORE_DEMO = 2;
const RETRY_DELAY_MS = 1200;
const DEMO_PROBE_MS = 8000;
const GOD_REFRESH_MS = 8000;
const SPEED_KEY = 'pixel-agency.speed';

function idNum(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

export function mergeActivity(prev: Activity[], incoming: readonly Activity[] | undefined): Activity[] {
  if (!incoming || incoming.length === 0) return prev;
  const seen = new Set(prev.map((a) => a.id));
  const out = prev.slice();
  let added = false;
  for (const a of incoming) {
    if (!a || typeof a.id !== 'string' || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
    added = true;
  }
  if (!added) return prev;
  out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || idNum(a.id) - idNum(b.id));
  return out.length > MAX_ACTIVITY ? out.slice(out.length - MAX_ACTIVITY) : out;
}

function readSpeed(): Speed {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return v === 2 || v === 4 || v === 8 ? v : 1;
  } catch {
    return 1;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Serveur injoignable';
}

export function useAgency(): Agency {
  const [snapshot, setSnapshot] = useState<CompanySnapshot | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);
  const [godMode, setGodModeState] = useState(false);
  const [godData, setGodData] = useState<CompanySnapshot['godMode'] | null>(null);
  const [speed, setSpeedState] = useState<Speed>(readSpeed);
  const [session, setSession] = useState(0); // bump = reconnect from scratch

  const runIdRef = useRef<string | null>(null);
  const godRef = useRef(false);
  const connRef = useRef<Connection>('connecting');
  connRef.current = connection;

  const applySnapshot = useCallback((s: CompanySnapshot) => {
    const sameRun = runIdRef.current === s.runId;
    runIdRef.current = s.runId;
    setSnapshot(s);
    setActivity((prev) => mergeActivity(sameRun ? prev : [], s.activity ?? []));
    if (s.godMode) setGodData(s.godMode);
  }, []);

  // Connection lifecycle: GET state (2 tries) → SSE; else demo mode with a background probe.
  useEffect(() => {
    let cancelled = false;
    let closeStream: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let probe: ReturnType<typeof setInterval> | undefined;
    let failures = 0;
    setConnection('connecting');

    const startStream = () => {
      closeStream = openStream({
        onSnapshot: (s) => { if (!cancelled) applySnapshot(s); },
        onActivity: (batch) => { if (!cancelled) setActivity((prev) => mergeActivity(prev, batch)); },
        onTick: (t) => {
          if (cancelled) return;
          setSnapshot((prev) => (prev ? { ...prev, day: t.day, tick: t.tick, phase: t.phase ?? prev.phase, finance: t.finance ?? prev.finance } : prev));
        },
        onStatus: (status, reconnected) => {
          if (cancelled) return;
          if (status === 'open') {
            setConnection('live');
            setLastError(null);
            // After an outage, resync the full state (the SSE only pushes deltas between snapshots).
            if (reconnected) api.state(godRef.current).then((s) => { if (!cancelled) applySnapshot(s); }).catch(() => undefined);
          } else {
            setConnection('reconnecting');
          }
        },
      });
    };

    const enterDemo = () => {
      try {
        applySnapshot(mockSnapshot());
      } catch {
        /* the world module may still be under construction: keep the null snapshot */
      }
      setConnection('demo');
      probe = setInterval(() => {
        api.state().then(() => { if (!cancelled) setSession((n) => n + 1); }).catch(() => undefined);
      }, DEMO_PROBE_MS);
    };

    const attempt = async () => {
      try {
        const s = await api.state(godRef.current);
        if (cancelled) return;
        applySnapshot(s);
        setConnection('live');
        setLastError(null);
        startStream();
      } catch (err) {
        if (cancelled) return;
        failures += 1;
        setLastError(errorText(err));
        if (failures >= FAILURES_BEFORE_DEMO) enterDemo();
        else timer = setTimeout(attempt, RETRY_DELAY_MS);
      }
    };

    void attempt();
    return () => {
      cancelled = true;
      closeStream?.();
      if (timer) clearTimeout(timer);
      if (probe) clearInterval(probe);
    };
  }, [session, applySnapshot]);

  // God mode: the SSE snapshots never carry the hidden truth, so poll /api/state?god=1 while it is on.
  useEffect(() => {
    godRef.current = godMode;
    if (!godMode) return;
    let cancelled = false;
    const pull = () => {
      if (connRef.current !== 'live') return;
      api.state(true).then((s) => {
        if (cancelled) return;
        applySnapshot(s);
        setGodData(s.godMode ?? null);
      }).catch(() => undefined);
    };
    pull();
    const id = setInterval(pull, GOD_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [godMode, applySnapshot]);

  const setGodMode = useCallback((on: boolean) => setGodModeState(on), []);

  const setSpeed = useCallback((s: Speed) => {
    setSpeedState(s);
    try { localStorage.setItem(SPEED_KEY, String(s)); } catch { /* private mode */ }
  }, []);

  const retry = useCallback(() => setSession((n) => n + 1), []);

  const refresh = useCallback(async () => {
    if (connRef.current === 'demo') return;
    const s = await api.state(godRef.current);
    applySnapshot(s);
  }, [applySnapshot]);

  const replaceSnapshot = useCallback((s: CompanySnapshot) => {
    runIdRef.current = null; // new run → fresh activity feed
    applySnapshot(s);
  }, [applySnapshot]);

  const visible = useMemo<CompanySnapshot | null>(() => {
    if (!snapshot) return null;
    if (godMode) {
      const g = godData ?? snapshot.godMode;
      return g ? { ...snapshot, godMode: g } : snapshot;
    }
    if (snapshot.godMode) {
      const { godMode: _hidden, ...rest } = snapshot;
      return rest;
    }
    return snapshot;
  }, [snapshot, godMode, godData]);

  return {
    snapshot: visible,
    activity,
    connection,
    demo: connection === 'demo',
    lastError,
    godMode,
    setGodMode,
    speed,
    setSpeed,
    retry,
    refresh,
    replaceSnapshot,
  };
}
