// React wrapper of the pixel world: full-size canvas, devicePixelRatio aware, its own 60 fps loop.
import { useEffect, useRef, type JSX } from 'react';
import type { Activity, CompanySnapshot, DeptId } from '../../../shared/types';
import { WorldEngine } from './engine';

const LOW_POWER_FRAME_MS = 48;

export interface WorldCanvasProps {
  snapshot: CompanySnapshot | null;
  /**
   * Live activity (snapshot activity merged with the SSE batches received since the last snapshot):
   * bubbles and flow lines update between snapshots. Optional: without it only snapshot.activity is used.
   */
  activity?: readonly Activity[];
  selectedAgentId: string | null;
  selectedDept: DeptId | null;
  focus: { kind: 'dept'; id: DeptId } | { kind: 'agent'; id: string } | { kind: 'overview' } | null;
  flowMode: boolean;
  /**
   * The world is mostly hidden (a full-size tab overlay is open): draw at ~20 fps instead of 60, so the
   * panels' backdrop blur is not recomputed every frame and opening/scrolling them stays fluid.
   */
  lowPower?: boolean;
  onSelectAgent(id: string): void;
  onSelectDept(id: DeptId): void;
}

export function WorldCanvas(props: WorldCanvasProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const engine = new WorldEngine(canvas, {
      onSelectAgent: (id) => propsRef.current.onSelectAgent(id),
      onSelectDept: (id) => propsRef.current.onSelectDept(id),
    });
    engineRef.current = engine;
    // handle for debugging from the devtools console: document.querySelector('canvas').__pixelWorld
    (canvas as HTMLCanvasElement & { __pixelWorld?: WorldEngine }).__pixelWorld = engine;
    const p = propsRef.current;
    engine.setSelection(p.selectedAgentId, p.selectedDept);
    engine.setFlowMode(p.flowMode);
    engine.setSnapshot(p.snapshot);
    engine.setActivity(p.activity);

    const measure = () => {
      const r = host.getBoundingClientRect();
      engine.resize(r.width, r.height, window.devicePixelRatio || 1);
    };
    measure();
    engine.setFocus(p.focus);
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    // devicePixelRatio changes (moving the window to another screen, browser zoom)
    let mq: MediaQueryList | null = null;
    const onDpr = () => {
      measure();
      mq?.removeEventListener('change', onDpr);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener('change', onDpr);
    };
    onDpr();
    const detach = engine.attachInput();
    let raf = 0;
    let lastDraw = -Infinity;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (propsRef.current.lowPower && t - lastDraw < LOW_POWER_FRAME_MS) return;
      lastDraw = t;
      try {
        engine.frame(t);
      } catch (err) {
        // never let a drawing glitch kill the loop
        console.error('[world] frame error', err);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq?.removeEventListener('change', onDpr);
      detach();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setSnapshot(props.snapshot);
  }, [props.snapshot]);

  // after the snapshot effect: a new run is mounted before its live lines are ingested
  useEffect(() => {
    engineRef.current?.setActivity(props.activity);
  }, [props.activity]);

  useEffect(() => {
    engineRef.current?.setSelection(props.selectedAgentId, props.selectedDept);
  }, [props.selectedAgentId, props.selectedDept]);

  useEffect(() => {
    engineRef.current?.setFlowMode(props.flowMode);
  }, [props.flowMode]);

  // keyed on identity: keep `focus` in state so that a new object means a new request (see WorldEngine.setFocus)
  useEffect(() => {
    engineRef.current?.setFocus(props.focus);
  }, [props.focus]);

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#bfe3ff' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Monde de l’agence : îles des départements, place centrale avec le Cerveau et le café"
        style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none', userSelect: 'none', imageRendering: 'pixelated' }}
      />
    </div>
  );
}
