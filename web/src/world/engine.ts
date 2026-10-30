// The world renderer: owns the canvas, camera, layout, agent simulation, effects and input.
// Runs its own requestAnimationFrame loop (60 fps) independently from server ticks.
import type { AgentState, CompanySnapshot, DeptId } from '../../../shared/types';
import { AgentSim, type AgentVis } from './agents';
import { Bubbles } from './bubbles';
import { Camera } from './camera';
import { Flows } from './flow';
import { isoX, isoY, pointInPoly } from './iso';
import { drawIslandLabel, drawNameTag, drawPlaceTag, type LabelRect } from './labels';
import { buildLayout, layoutKeyOf } from './layout';
import type { IslandModel, Sprite, WorldLayout } from './model';
import { rgba, shade } from './palette';
import { fillPoly } from './pixel';
import { Scenery } from './scenery';
import { CELL_H, FRAME, drawFrame, statusIcon, type IconKind } from './sprites';
import { FONT_UI } from './text';

export type WorldFocus = { kind: 'dept'; id: DeptId } | { kind: 'agent'; id: string } | { kind: 'overview' } | null;

export interface EngineCallbacks {
  onSelectAgent(id: string): void;
  onSelectDept(id: DeptId): void;
}

const BUSY = new Set(['working', 'reviewing', 'meeting', 'thinking']);
const AT_DESK = new Set(['working', 'reviewing', 'thinking', 'blocked']);
const SCREEN_COLOR: Record<string, string> = { working: '#9be9ff', reviewing: '#ffe08a', thinking: '#d3c6ff', blocked: '#ffb4b4' };

interface DynItem { depth: number; kind: 'agent' | 'screen'; v?: AgentVis; poly?: [number, number][]; color?: string; flicker?: number }

function makeGlow(color: [number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},1)`);
  grad.addColorStop(0.35, `rgba(${color[0]},${color[1]},${color[2]},0.45)`);
  grad.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export class WorldEngine {
  readonly camera = new Camera();
  private g: CanvasRenderingContext2D;
  private dpr = 1;
  private scenery = new Scenery();
  private sim = new AgentSim();
  private bubbles = new Bubbles();
  private flows = new Flows();
  private layout: WorldLayout | null = null;
  private snapshot: CompanySnapshot | null = null;
  private byId = new Map<string, AgentState>();
  private selectedAgent: string | null = null;
  private selectedDept: DeptId | null = null;
  private flowMode = false;
  private focusKey = '';
  private pendingFocus: WorldFocus = null;
  private seen = new Map<string, number>();
  private firstSnapshot = true;
  private runId: string | null = null;
  private fitted = false;
  /** True once the user panned/zoomed: resizes then keep the current framing. */
  private userMoved = false;
  private hoverAgent: string | null = null;
  private hoverDept: string | null = null;
  private pointer: { x: number; y: number } | null = null;
  private labelRects: LabelRect[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; moved: number; t: number } | null = null;
  private pinch: { d: number; mx: number; my: number } | null = null;
  private lastFrame = 0;
  private time = 0;
  private beam = 0;
  private cursor = '';
  private glowWarm = makeGlow([255, 205, 130]);
  private glowCool = makeGlow([150, 220, 255]);
  private glowPink = makeGlow([255, 150, 230]);
  private persistentBubbles = new Map<string, string>();

  constructor(private canvas: HTMLCanvasElement, private cb: EngineCallbacks) {
    this.g = canvas.getContext('2d', { alpha: true })!;
    this.time = performance.now() / 1000;
  }

  // ───────────── inputs from React ─────────────

  setCallbacks(cb: EngineCallbacks): void {
    this.cb = cb;
  }

  setSnapshot(s: CompanySnapshot | null): void {
    const now = performance.now() / 1000;
    if (s && s.runId !== this.runId) {
      if (this.runId !== null) {
        this.seen.clear();
        this.bubbles.reset();
        this.flows.reset();
        this.firstSnapshot = true;
      }
      this.runId = s.runId;
    }
    this.snapshot = s;
    this.byId = new Map((s?.company.agents ?? []).map((a) => [a.id, a]));
    this.persistentBubbles = new Map((s?.company.agents ?? []).filter((a) => a.bubble).map((a) => [a.id, a.bubble as string]));
    const key = layoutKeyOf(s);
    if (!this.layout || this.layout.key !== key) {
      this.layout = buildLayout(s);
      this.sim.setLayout(this.layout);
      this.camera.setBounds(this.layout.bounds);
      if (!this.fitted && this.camera.w > 1) this.fitOverview();
      if (this.pendingFocus) {
        const f = this.pendingFocus;
        this.pendingFocus = null;
        this.applyFocus(f);
      }
    }
    this.scenery.setClock(s?.tick ?? 4);
    // fresh activities
    const acts = s?.activity ?? [];
    const wall = Date.now();
    const fresh = [];
    for (const a of acts) {
      if (!a || this.seen.has(a.id)) continue;
      const age = this.firstSnapshot ? Math.max(0, (wall - (a.at || 0)) / 1000) : 0;
      this.seen.set(a.id, now - age);
      if (age < 8) fresh.push({ a, born: now - age });
    }
    if (this.seen.size > 3000) {
      const keep = new Set(acts.map((a) => a.id));
      for (const id of this.seen.keys()) if (!keep.has(id)) this.seen.delete(id);
    }
    this.sim.sync(s, now);
    for (const { a, born } of fresh) {
      this.sim.onActivity(a, now);
      this.bubbles.push(a, born, this.byId);
      this.flows.push(a, born);
    }
    this.bubbles.syncAgentBubbles(s?.company.agents ?? [], now, this.firstSnapshot);
    if (s) this.firstSnapshot = false;
  }

  setSelection(agentId: string | null, dept: DeptId | null): void {
    this.selectedAgent = agentId;
    this.selectedDept = dept;
  }

  setFlowMode(on: boolean): void {
    this.flowMode = on;
  }

  /**
   * Fly the camera when the focus changes. The same focus passed again (a new object with the same
   * value, e.g. clicking « Vue d’ensemble » twice) re-centres only if the user moved the camera since.
   */
  setFocus(f: WorldFocus): void {
    const key = f ? `${f.kind}:${'id' in f ? f.id : ''}` : '';
    if (key === this.focusKey && (!f || !this.userMoved)) return;
    this.userMoved = false;
    this.focusKey = key;
    if (!f) return;
    if (!this.layout || this.camera.w <= 1) {
      this.pendingFocus = f;
      return;
    }
    this.applyFocus(f);
  }

  private applyFocus(f: WorldFocus): void {
    const L = this.layout;
    if (!L || !f) return;
    if (f.kind === 'overview') {
      this.userMoved = false;
      const o = this.camera.overview();
      this.camera.flyTo(o.x, o.y, o.zoom);
    } else if (f.kind === 'dept') {
      const isl = L.deptIsland.get(f.id);
      if (!isl) return;
      // the plaza is framed between the Direction office and the fountain
      const c = isl.kind === 'plaza' && isl.room ? { tx: (isl.center.tx + (isl.room.x0 + isl.room.x1) / 2) / 2, ty: (isl.center.ty + (isl.room.y0 + isl.room.y1) / 2) / 2 } : isl.center;
      const cx = isoX(c.tx, c.ty);
      const cy = isoY(c.tx, c.ty) - 6;
      const zw = (this.camera.w * 0.6) / (isl.size * 32);
      const zh = (this.camera.h * 0.6) / (isl.size * 16 + 80);
      this.camera.flyTo(cx, cy, Math.max(1.4, Math.min(3.4, zw, zh)));
    } else {
      const id = f.id;
      this.camera.followTarget(() => {
        const v = this.sim.agents.get(id);
        return v ? { x: isoX(v.pos.tx, v.pos.ty), y: isoY(v.pos.tx, v.pos.ty) - 12 } : null;
      }, Math.max(2.8, Math.min(3.6, this.camera.zoom)));
    }
  }

  private fitOverview(): void {
    const o = this.camera.overview();
    this.camera.snapTo(o.x, o.y, o.zoom);
    this.fitted = true;
  }

  resize(w: number, h: number, dpr: number): void {
    this.dpr = Math.max(1, Math.min(3, dpr || 1));
    const W = Math.max(1, Math.round(w * this.dpr));
    const H = Math.max(1, Math.round(h * this.dpr));
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    this.camera.setViewport(w, h);
    if (this.layout && (!this.fitted || (!this.userMoved && !this.camera.busy && (this.focusKey === '' || this.focusKey.startsWith('overview'))))) this.fitOverview();
    if (this.pendingFocus && this.layout) {
      const f = this.pendingFocus;
      this.pendingFocus = null;
      this.applyFocus(f);
    }
  }

  // ───────────── frame ─────────────

  frame(ms: number): void {
    const now = ms / 1000;
    const dt = Math.max(0, Math.min(0.1, now - (this.lastFrame || now)));
    this.lastFrame = now;
    this.time = now;
    if (!this.layout) {
      this.layout = buildLayout(this.snapshot);
      this.sim.setLayout(this.layout);
      this.camera.setBounds(this.layout.bounds);
      if (this.camera.w > 1) this.fitOverview();
    }
    this.camera.update(dt);
    this.scenery.update(dt);
    this.sim.update(dt, now);
    this.flows.prune(now);
    const readers = this.flows.brainActivity(now) + [...this.sim.agents.values()].filter((v) => v.spot?.kind === 'fountain' && !v.moving).length;
    const bt = Math.min(1, readers / 4);
    this.beam += (bt - this.beam) * (1 - Math.exp(-dt * 2.5));
    this.updateHover();
    this.render(now, readers);
  }

  private agentFoot(v: AgentVis): { x: number; y: number } {
    return { x: isoX(v.pos.tx, v.pos.ty), y: isoY(v.pos.tx, v.pos.ty) };
  }

  private seated(v: AgentVis): boolean {
    return !v.moving && v.spot?.pose === 'sit' && AT_DESK.has(v.state.status) && !!v.spot.seat;
  }

  private render(now: number, readers: number): void {
    const g = this.g;
    const L = this.layout!;
    const cam = this.camera;
    const dpr = this.dpr;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const z = cam.zoom * dpr;
    const ox = Math.round(W / 2 - cam.x * z);
    const oy = Math.round(H / 2 - cam.y * z);
    const sky = this.scenery.colors;
    const night = sky.night;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;

    // ── world (pixel art)
    g.setTransform(z, 0, 0, z, ox, oy);
    g.drawImage(L.ground.img, L.ground.x, L.ground.y);
    const vx0 = -ox / z;
    const vy0 = -oy / z;
    const vx1 = (W - ox) / z;
    const vy1 = (H - oy) / z;

    // island highlights on the ground
    for (const isl of L.islands) {
      const sel = this.selectedDept && isl.deptId === this.selectedDept;
      const hov = this.hoverDept && isl.deptId === this.hoverDept && !this.hoverAgent;
      if (!sel && !hov) continue;
      g.save();
      g.lineJoin = 'round';
      g.strokeStyle = sel ? rgba(shade(isl.color, 0.35), 0.55 + 0.25 * Math.sin(now * 3)) : 'rgba(255,255,255,0.55)';
      g.lineWidth = (sel ? 3 : 2) / cam.zoom;
      g.beginPath();
      isl.topPoly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.stroke();
      if (sel) {
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 1 / cam.zoom;
        g.stroke();
      }
      g.restore();
    }

    // agents + lit screens (dynamic, merged with static sprites by depth)
    const dyn: DynItem[] = [];
    for (const v of this.sim.agents.values()) {
      dyn.push({ depth: v.pos.tx + v.pos.ty, kind: 'agent', v });
      if (this.seated(v)) {
        const seat = v.spot!.seat!;
        const flick = 0.85 + 0.15 * Math.sin(now * 9 + v.phase * 3);
        dyn.push({ depth: seat.deskDepth + 0.0005, kind: 'screen', poly: seat.screen, color: SCREEN_COLOR[v.state.status] ?? '#9be9ff', flicker: flick });
      }
    }
    dyn.sort((a, b) => a.depth - b.depth);
    // selection ring under the agent
    const selV = this.selectedAgent ? this.sim.agents.get(this.selectedAgent) : undefined;
    if (selV) this.drawRing(g, selV, now, true);
    const hovV = this.hoverAgent && this.hoverAgent !== this.selectedAgent ? this.sim.agents.get(this.hoverAgent) : undefined;
    if (hovV) this.drawRing(g, hovV, now, false);

    const S = L.sprites;
    let si = 0;
    const drawSprite = (s: Sprite) => {
      if (s.x > vx1 || s.y > vy1 || s.x + s.img.width < vx0 || s.y + s.img.height < vy0) return;
      g.drawImage(s.img, s.x, s.y);
    };
    for (const d of dyn) {
      while (si < S.length && S[si].depth <= d.depth) drawSprite(S[si++]);
      if (d.kind === 'agent') this.drawAgent(g, d.v!, now, vx0, vy0, vx1, vy1);
      else if (d.poly) {
        g.globalAlpha = d.flicker ?? 1;
        fillPoly(g, d.poly, d.color ?? '#9be9ff');
        g.globalAlpha = 1;
        // a few "lines of text" scrolling on the screen
        const [p0, p1, , p3] = d.poly;
        const hx = p1[0] - p0[0];
        const hy = p1[1] - p0[1];
        const vx = p0[0] - p3[0];
        const vy = p0[1] - p3[1];
        const scroll = Math.floor(now * 2 + (d.flicker ?? 0) * 10) % 3;
        for (let i = 0; i < 3; i++) {
          const h = 0.2 + i * 0.27;
          const len = [0.62, 0.42, 0.7][(i + scroll) % 3];
          const sx = p3[0] + vx * h + hx * 0.12;
          const sy = p3[1] + vy * h + hy * 0.12;
          fillPoly(g, [[sx, sy], [sx + hx * len, sy + hy * len], [sx + hx * len, sy + hy * len + 1], [sx, sy + 1]], 'rgba(40,60,110,0.55)');
        }
      }
    }
    while (si < S.length) drawSprite(S[si++]);

    // ── time-of-day tint (only on world pixels)
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (sky.tintA > 0.004) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = rgba(sky.tint, sky.tintA);
      g.fillRect(0, 0, W, H);
    }
    if (this.flowMode) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(20,16,50,0.22)';
      g.fillRect(0, 0, W, H);
    }
    g.globalCompositeOperation = 'source-over';

    // ── lights, glows, brain beam, flow lines
    g.setTransform(z, 0, 0, z, ox, oy);
    g.imageSmoothingEnabled = true;
    g.globalCompositeOperation = 'lighter';
    const lightK = Math.min(1, night * 1.25 + sky.sunset * 0.25);
    if (lightK > 0.02) {
      for (const l of L.lights) {
        if (l.x + l.r < vx0 || l.x - l.r > vx1 || l.y + l.r < vy0 || l.y - l.r > vy1) continue;
        const img = this.glowWarm;
        const a = l.kind === 'room' ? 0.2 : 0.55;
        g.globalAlpha = a * lightK;
        if (l.kind === 'room') g.drawImage(img, l.x - l.r, l.y - l.r * 0.55, l.r * 2, l.r * 1.1);
        else {
          g.drawImage(img, l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
          g.globalAlpha = lightK;
          g.drawImage(img, l.x - 4, l.y - 4, 8, 8);
        }
      }
      for (const d of dyn) {
        if (d.kind !== 'screen' || !d.poly) continue;
        const p = d.poly;
        const cx = (p[0][0] + p[2][0]) / 2;
        const cy = (p[0][1] + p[2][1]) / 2;
        g.globalAlpha = 0.5 * lightK;
        g.drawImage(this.glowCool, cx - 16, cy - 12, 32, 24);
      }
    }
    // café steam (always)
    const cafe = L.plaza.cafe;
    if (cafe) {
      g.globalCompositeOperation = 'source-over';
      g.imageSmoothingEnabled = false;
      for (let i = 0; i < 4; i++) {
        const t = (now * 0.5 + i * 0.25) % 1;
        g.globalAlpha = (1 - t) * 0.7;
        g.fillStyle = '#ffffff';
        g.fillRect(Math.round(cafe.machine.x + Math.sin(t * 6 + i) * 2), Math.round(cafe.machine.y - t * 12), 1, 2);
      }
      g.globalCompositeOperation = 'lighter';
      g.imageSmoothingEnabled = true;
    }
    // brain crystal glow + beam + rays
    const f = L.plaza.fountain;
    if (f) {
      const cx = f.crystal.x;
      const cy = f.crystal.y;
      const pulse = 0.5 + 0.5 * Math.sin(now * 2.2);
      const r = 20 + pulse * 4 + this.beam * 8;
      g.globalAlpha = 0.22 + 0.14 * pulse + this.beam * 0.2;
      g.drawImage(this.glowPink, cx - r, cy - r, r * 2, r * 2);
      if (this.beam > 0.02) {
        const bw = 7 + this.beam * 8 + pulse * 2;
        const top = cy - 1400;
        const grad = g.createLinearGradient(0, cy, 0, top);
        grad.addColorStop(0, `rgba(255,190,245,${(0.7 * this.beam).toFixed(3)})`);
        grad.addColorStop(0.25, `rgba(220,170,255,${(0.4 * this.beam).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(200,160,255,0)');
        g.globalAlpha = 1;
        g.fillStyle = grad;
        g.fillRect(cx - bw / 2, top, bw, cy - top);
        g.fillStyle = `rgba(255,255,255,${(0.55 * this.beam).toFixed(3)})`;
        g.fillRect(cx - 1, top + 400, 2, cy - top - 400);
        if (readers >= 3) {
          g.globalAlpha = 0.055 * this.beam;
          g.fillStyle = '#ffd6f6';
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + now * 0.35;
            const len = 70 + 20 * Math.sin(now + i);
            g.beginPath();
            g.moveTo(cx, cy);
            g.lineTo(cx + Math.cos(a - 0.08) * len, cy + Math.sin(a - 0.08) * len * 0.55);
            g.lineTo(cx + Math.cos(a + 0.08) * len, cy + Math.sin(a + 0.08) * len * 0.55);
            g.closePath();
            g.fill();
          }
        }
      }
      // sparkles rising from the crystal
      g.imageSmoothingEnabled = false;
      for (let i = 0; i < 10; i++) {
        const t = (now * (0.25 + (i % 3) * 0.08) + i * 0.137) % 1;
        const x = cx + Math.sin(i * 12.9 + now * 0.8) * (6 + i * 1.4);
        const y = cy - t * (40 + this.beam * 60);
        g.globalAlpha = (1 - t) * (0.6 + this.beam * 0.4);
        g.fillStyle = i % 2 ? '#ffffff' : '#ffc6f1';
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    if (this.flowMode) {
      this.drawPaths(g, now);
      this.flows.draw(
        g,
        (id) => {
          const v = this.sim.agents.get(id);
          if (!v) return null;
          const p = this.agentFoot(v);
          return { x: p.x, y: p.y - (this.seated(v) ? 14 : 16) };
        },
        f ? { x: f.crystal.x, y: f.crystal.y } : { x: 0, y: 0 },
        cam.zoom,
        now,
      );
    }
    // status icons (not tinted)
    g.imageSmoothingEnabled = false;
    for (const v of this.sim.agents.values()) this.drawIcon(g, v, now, vx0, vy0, vx1, vy1);

    // ── background behind everything already drawn
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'destination-over';
    const view = { w: cam.w, h: cam.h, camX: cam.x, camY: cam.y, zoom: cam.zoom, cx0: (L.bounds.minX + L.bounds.maxX) / 2, cy0: (L.bounds.minY + L.bounds.maxY) / 2 };
    this.scenery.drawBackground(g, view, now, dpr);
    g.globalCompositeOperation = 'source-over';
    this.scenery.drawFront(g, view, now, dpr);

    // ── screen-space UI
    g.imageSmoothingEnabled = true;
    this.drawUi(g, now);
  }

  private drawRing(g: CanvasRenderingContext2D, v: AgentVis, now: number, selected: boolean): void {
    const p = this.agentFoot(v);
    const color = this.layout?.deptIsland.get(v.state.dept)?.color ?? '#8b5cf6';
    const pulse = (now * 1.3) % 1;
    g.save();
    g.lineWidth = 1.5 / this.camera.zoom;
    if (selected) {
      g.strokeStyle = rgba(shade(color, 0.3), 1 - pulse);
      g.beginPath();
      g.ellipse(p.x, p.y, 8 + pulse * 10, (8 + pulse * 10) / 2, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = rgba(color, 0.35);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.2 / this.camera.zoom;
      g.beginPath();
      g.ellipse(p.x, p.y, 9, 4.5, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    } else {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.ellipse(p.x, p.y, 8, 4, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  private frameFor(v: AgentVis, now: number): { frame: number; mirror: boolean; lift: number } {
    const f = v.facing;
    const front = f === 'se' || f === 'sw';
    const mirror = f === 'sw' || f === 'nw';
    if (v.moving) return { frame: (front ? FRAME.walkFront : FRAME.walkBack) + (Math.floor(v.walkT * 8) % 4), mirror, lift: 0 };
    if (this.seated(v)) {
      const st = v.state.status;
      const typing = (st === 'working' || st === 'reviewing') && Math.sin(now * 0.9 + v.phase) > -0.35;
      const frame = typing ? FRAME.sit + (Math.floor(now * 6 + v.phase) % 2) : FRAME.sitStill;
      return { frame, mirror: v.facing === 'nw', lift: 2 };
    }
    if (v.spot?.pose === 'coffee') {
      // chatting at the café: always shown front-facing so the cup is visible
      const sip = (now + v.phase) % 4.2 < 0.9;
      return { frame: sip ? FRAME.coffee + 1 : FRAME.coffee, mirror, lift: 0 };
    }
    const blink = (now + v.phase) % 3.7 < 0.14;
    return { frame: front ? FRAME.idleFront + (blink ? 1 : 0) : FRAME.idleBack, mirror, lift: 0 };
  }

  private drawAgent(g: CanvasRenderingContext2D, v: AgentVis, now: number, vx0: number, vy0: number, vx1: number, vy1: number): void {
    const p = this.agentFoot(v);
    if (p.x < vx0 - 20 || p.x > vx1 + 20 || p.y < vy0 - 10 || p.y > vy1 + 40) return;
    const { frame, mirror, lift } = this.frameFor(v, now);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (!lift) {
      g.fillStyle = 'rgba(30,20,50,0.24)';
      g.fillRect(x - 4, y - 1, 9, 2);
      g.fillRect(x - 6, y, 13, 1);
      g.fillRect(x - 3, y + 1, 7, 1);
    }
    // idle breathing (1 px), livelier nodding while in a meeting
    const bob = v.moving || lift ? 0 : v.state.status === 'meeting' ? (Math.sin(now * 5 + v.phase) > 0.3 ? 1 : 0) : Math.sin(now * 2.1 + v.phase) > 0.75 ? 1 : 0;
    drawFrame(g, v.sheet, frame, mirror, x, y - lift - bob);
  }

  private drawIcon(g: CanvasRenderingContext2D, v: AgentVis, now: number, vx0: number, vy0: number, vx1: number, vy1: number): void {
    const st = v.state.status;
    let kind: IconKind | null = null;
    if (st === 'blocked') kind = 'blocked';
    else if (st === 'thinking') kind = 'thinking';
    else if (st === 'reviewing' && !v.moving) kind = 'review';
    else if (st === 'coffee' && !v.moving && v.spot?.kind === 'cafe') kind = 'coffee';
    if (!kind) return;
    const p = this.agentFoot(v);
    if (p.x < vx0 - 20 || p.x > vx1 + 20 || p.y < vy0 - 10 || p.y > vy1 + 40) return;
    const img = statusIcon(kind, Math.floor(now * 2.5 + v.phase));
    const lift = this.seated(v) ? 2 : 0;
    const bob = Math.round(Math.sin(now * 3 + v.phase) * 1);
    g.drawImage(img, Math.round(p.x - 6), Math.round(p.y - CELL_H - lift - 9 + bob));
  }

  /** Flow mode: dotted remaining path of walking agents. */
  private drawPaths(g: CanvasRenderingContext2D, now: number): void {
    g.save();
    g.lineWidth = 1.2 / this.camera.zoom;
    g.setLineDash([2 / this.camera.zoom, 4 / this.camera.zoom]);
    g.lineDashOffset = -now * 12 / this.camera.zoom;
    for (const v of this.sim.agents.values()) {
      if (!v.path.length) continue;
      const color = this.layout?.deptIsland.get(v.state.dept)?.color ?? '#ffffff';
      g.strokeStyle = rgba(shade(color, 0.4), 0.85);
      g.beginPath();
      const p = this.agentFoot(v);
      g.moveTo(p.x, p.y);
      for (const w of v.path) g.lineTo(isoX(w.tx, w.ty), isoY(w.tx, w.ty));
      g.stroke();
    }
    g.restore();
  }

  private drawUi(g: CanvasRenderingContext2D, now: number): void {
    const L = this.layout!;
    const cam = this.camera;
    const agents = this.snapshot?.company.agents ?? [];
    this.labelRects = [];
    const counts = new Map<string, { n: number; busy: number; coffee: number }>();
    for (const a of agents) {
      const isl = L.deptIsland.get(a.dept) ?? L.plaza;
      const c = counts.get(isl.id) ?? { n: 0, busy: 0, coffee: 0 };
      c.n++;
      if (BUSY.has(a.status)) c.busy++;
      counts.set(isl.id, c);
    }
    const coffee = agents.filter((a) => a.status === 'coffee').length;
    const labelScale = cam.zoom < 0.75 ? 0.9 : 1;
    g.save();
    g.scale(labelScale, labelScale);
    const sortedIslands = [...L.islands].sort((a, b) => a.depth - b.depth);
    for (const isl of sortedIslands) {
      const [sx, sy] = cam.worldToScreen(isl.labelAnchor.x, isl.labelAnchor.y);
      if (sx < -150 || sx > cam.w + 150 || sy < -60 || sy > cam.h + 80) continue;
      const c = counts.get(isl.id) ?? { n: 0, busy: 0, coffee: 0 };
      const sub = `${c.n} agent${c.n > 1 ? 's' : ''} · ${c.busy} en cours`;
      const state = this.selectedDept && isl.deptId === this.selectedDept ? 'selected' : this.hoverDept && isl.deptId === this.hoverDept ? 'hover' : 'normal';
      const glyph = (isl.name || '?').trim().charAt(0).toLocaleUpperCase('fr-FR');
      const r = drawIslandLabel(g, isl.deptId ?? isl.id, sx / labelScale, (sy - 6) / labelScale, isl.name, sub, isl.color, glyph, state, c.busy);
      this.labelRects.push({ id: r.id, x: r.x * labelScale, y: r.y * labelScale, w: r.w * labelScale, h: r.h * labelScale });
    }
    g.restore();
    // plaza places when zoomed in enough
    const f = L.plaza.fountain;
    if (f && cam.zoom >= 1.25) {
      const [sx, sy] = cam.worldToScreen(f.crystal.x, f.crystal.y - 18);
      const nReaders = [...this.sim.agents.values()].filter((v) => v.spot?.kind === 'fountain').length;
      drawPlaceTag(g, sx, sy, 'Cerveau', nReaders ? `${nReaders} en lecture` : 'mémoire partagée', '#d946ef');
    }
    const cafe = L.plaza.cafe;
    if (cafe && cam.zoom >= 1.25) {
      const [sx, sy] = cam.worldToScreen(cafe.anchor.x, cafe.anchor.y);
      drawPlaceTag(g, sx, sy, 'Café', coffee ? `${coffee} en pause` : 'calme', '#e5484d');
    }
    // name tags
    const tagFor = (id: string | null, strong: boolean) => {
      if (!id) return;
      const v = this.sim.agents.get(id);
      if (!v) return;
      const p = this.agentFoot(v);
      const [sx, sy] = cam.worldToScreen(p.x, p.y);
      const color = L.deptIsland.get(v.state.dept)?.color ?? '#8b5cf6';
      drawNameTag(g, sx, sy + 4 + 4 * Math.min(1, cam.zoom / 3), v.state.name, v.state.role, color, strong);
    };
    if (this.hoverAgent !== this.selectedAgent) tagFor(this.hoverAgent, false);
    tagFor(this.selectedAgent, true);
    // bubbles
    this.bubbles.draw(
      g,
      {
        headOf: (id) => {
          const v = this.sim.agents.get(id);
          if (!v) return null;
          const p = this.agentFoot(v);
          const [sx, sy] = cam.worldToScreen(p.x, p.y - (this.seated(v) ? 18 : 22));
          if (sx < -40 || sx > cam.w + 40 || sy < -20 || sy > cam.h + 60) return null;
          return [sx, sy - 4];
        },
        colorOf: (id) => {
          const a = this.byId.get(id);
          return (a && L.deptIsland.get(a.dept)?.color) || '#7c3aed';
        },
        selectedId: this.selectedAgent,
        hoverId: this.hoverAgent,
      },
      now,
      cam.w,
      cam.h,
      this.persistentBubbles,
      cam.zoom < 0.8 ? 2 : cam.zoom < 1.2 ? 4 : 6,
    );
    if (!this.snapshot) {
      const t = 'Connexion à l’agence…';
      g.font = `600 13px ${FONT_UI}`;
      const w = g.measureText(t).width + 28;
      const x = cam.w / 2 - w / 2;
      const y = cam.h / 2 - 16;
      g.fillStyle = 'rgba(255,255,255,0.88)';
      g.beginPath();
      g.roundRect?.(x, y, w, 32, 16);
      g.fill();
      g.fillStyle = '#3b3358';
      g.textBaseline = 'middle';
      g.fillText(t, x + 14, y + 16.5 + Math.sin(now * 3) * 0.5);
      g.textBaseline = 'alphabetic';
    }
  }

  // ───────────── hit testing & input ─────────────

  private pick(sx: number, sy: number): { agent?: string; dept?: DeptId } {
    const L = this.layout;
    if (!L) return {};
    for (let i = this.labelRects.length - 1; i >= 0; i--) {
      const r = this.labelRects[i];
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return { dept: r.id as DeptId };
    }
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    const pad = Math.max(0, 5 / this.camera.zoom - 2);
    const agents = [...this.sim.agents.values()].sort((a, b) => b.pos.tx + b.pos.ty - (a.pos.tx + a.pos.ty));
    for (const v of agents) {
      const p = this.agentFoot(v);
      const lift = this.seated(v) ? 2 : 0;
      if (wx >= p.x - 6 - pad && wx <= p.x + 6 + pad && wy >= p.y - 20 - lift - pad && wy <= p.y + 1 + pad) return { agent: v.id };
    }
    const islands = [...L.islands].sort((a, b) => b.depth - a.depth);
    for (const isl of islands) {
      if (pointInPoly(wx, wy, isl.hitPoly)) return isl.deptId ? { dept: isl.deptId } : {};
    }
    return {};
  }

  private updateHover(): void {
    if (!this.pointer || this.down?.moved && this.down.moved > 5 || this.pointers.size > 1) {
      if (!this.pointer) {
        this.hoverAgent = null;
        this.hoverDept = null;
      }
      this.setCursor(this.down && this.down.moved > 5 ? 'grabbing' : 'default');
      return;
    }
    const hit = this.pick(this.pointer.x, this.pointer.y);
    this.hoverAgent = hit.agent ?? null;
    this.hoverDept = hit.agent ? null : hit.dept ?? null;
    this.setCursor(hit.agent || hit.dept ? 'pointer' : 'default');
  }

  private setCursor(c: string): void {
    if (c !== this.cursor) {
      this.cursor = c;
      this.canvas.style.cursor = c;
    }
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  attachInput(): () => void {
    const c = this.canvas;
    const onDown = (e: PointerEvent) => {
      const p = this.local(e);
      this.pointers.set(e.pointerId, p);
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best effort */
      }
      if (this.pointers.size === 1) this.down = { x: p.x, y: p.y, moved: 0, t: performance.now() };
      else {
        this.down = this.down ? { ...this.down, moved: 99 } : null;
        this.pinch = this.pinchState();
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = this.local(e);
      this.pointer = p;
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size >= 2) {
        const ps = this.pinchState();
        if (ps && this.pinch) {
          this.userMoved = true;
          this.camera.release();
          this.camera.zoomAt(ps.d / Math.max(1, this.pinch.d), ps.mx, ps.my);
          this.camera.panBy(ps.mx - this.pinch.mx, ps.my - this.pinch.my);
        }
        this.pinch = ps;
        return;
      }
      if (this.down) {
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        this.down.moved += Math.abs(dx) + Math.abs(dy);
        if (this.down.moved > 5) {
          this.userMoved = true;
          this.camera.release();
          this.camera.panBy(dx, dy);
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      const p = this.local(e);
      const wasDown = this.down;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) {
        this.down = null;
        if (wasDown && wasDown.moved <= 5 && e.type === 'pointerup') {
          const hit = this.pick(p.x, p.y);
          if (hit.agent) this.cb.onSelectAgent(hit.agent);
          else if (hit.dept) this.cb.onSelectDept(hit.dept);
        }
      }
    };
    const onLeave = () => {
      if (this.pointers.size === 0) this.pointer = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = this.local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const k = e.ctrlKey ? 0.01 : 0.0016;
      this.userMoved = true;
      this.camera.release();
      this.camera.zoomAt(Math.exp(-e.deltaY * unit * k), p.x, p.y);
    };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointercancel', onUp);
      c.removeEventListener('pointerleave', onLeave);
      c.removeEventListener('wheel', onWheel);
    };
  }

  private pinchState(): { d: number; mx: number; my: number } | null {
    const ps = [...this.pointers.values()];
    if (ps.length < 2) return null;
    const [a, b] = ps;
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  /** Islands, for tests/debug. */
  get islands(): IslandModel[] {
    return this.layout?.islands ?? [];
  }
}
