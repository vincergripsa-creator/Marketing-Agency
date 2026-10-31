// Agent movement simulation (UI only): each agent gets a target spot from its snapshot status/place
// and recent activities, then walks there along island ↔ bridge waypoints at ~40 px/s.
import type { Activity, AgentState, CompanySnapshot, Place } from '../../../shared/types';
import { facingFrom, screenDist, type Facing, type Pt } from './iso';
import { faceTowards } from './islands';
import { applyDeskVisibility, deskIndexes, homeDept } from './layout';
import type { IslandModel, Rect, Seat, WorldLayout } from './model';
import { inRect } from './model';
import { hashStr } from './pixel';
import { getSheet } from './sprites';

export type Pose = 'sit' | 'stand' | 'coffee';
type SpotKind = 'seat' | 'cafe' | 'fountain' | 'meeting' | 'visitor' | 'wander' | 'visit' | 'dock';

export interface Waypoint extends Pt { island: string; cross?: boolean }

export interface Spot {
  key: string;
  kind: SpotKind;
  island: IslandModel;
  pos: Pt;
  approach?: Pt;
  pose: Pose;
  facing: Facing;
  seat?: Seat;
}

interface Override {
  kind: 'fountain' | 'visit' | 'place';
  until: number;
  holdUntil?: number;
  place?: Place;
  target?: string;
}

export interface AgentVis {
  id: string;
  state: AgentState;
  /** Only a sprite of the team follows the snapshot: one on its way out or in has its own life cycle. */
  role: 'staff' | 'leaving' | 'arriving';
  carry: 'box' | 'bag' | null;
  /** A short gesture, held until `poseUntil`. */
  pose?: 'cheer' | 'slump' | 'shake' | null;
  poseUntil?: number;
  sheet: HTMLCanvasElement;
  pos: Pt;
  island: string;
  path: Waypoint[];
  spot: Spot | null;
  facing: Facing;
  moving: boolean;
  walkT: number;
  speed: number;
  phase: number;
  override: Override | null;
  wanderAt: number;
  wanderIdx: number;
  lastVisit: number;
  arrived: boolean;
}

const BASE_SPEED = 40; // world px per second
const FOUNTAIN_HOLD = 2.6;
const VISIT_HOLD = 2.4;

function d2(a: Pt, b: Pt): number {
  return Math.hypot(a.tx - b.tx, a.ty - b.ty);
}

function segDistToPoint(a: Pt, b: Pt, c: Pt): number {
  const vx = b.tx - a.tx;
  const vy = b.ty - a.ty;
  const L = vx * vx + vy * vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((c.tx - a.tx) * vx + (c.ty - a.ty) * vy) / L));
  return Math.hypot(a.tx + vx * t - c.tx, a.ty + vy * t - c.ty);
}

function segHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  // Liang–Barsky clip
  let t0 = 0;
  let t1 = 1;
  const dx = b.tx - a.tx;
  const dy = b.ty - a.ty;
  const p = [-dx, dx, -dy, dy];
  const q = [a.tx - r.x0, r.x1 - a.tx, a.ty - r.y0, r.y1 - a.ty];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function expand(r: Rect, m: number): Rect {
  return { x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m };
}

/**
 * The plaza's two front corners hold the stage, and a straight walk from a side bridge to the `y+` path crosses them.
 * So whoever takes that path joins it at the foot of the fountain ring, on the path itself.
 */
function frontPathGate(isl: IslandModel, a: Pt, b: Pt): Pt | null {
  const f = isl.fountain;
  const mouth = isl.edges['y+'];
  if (!f || !mouth) return null;
  const gate = { tx: mouth.tx, ty: f.center.ty + f.ring };
  const onPath = (p: Pt) => p.ty > gate.ty && Math.abs(p.tx - mouth.tx) < 0.8;
  return onPath(a) === onPath(b) ? null : gate;
}

/** Shortest walk around a rectangle obstacle via its (expanded) corners. */
function aroundRect(a: Pt, b: Pt, r: Rect, m: number): Pt[] {
  const hit = expand(r, m * 0.55);
  if (!segHitsRect(a, b, hit)) return [];
  const e = expand(r, m);
  const corners: Pt[] = [{ tx: e.x0, ty: e.y0 }, { tx: e.x1, ty: e.y0 }, { tx: e.x1, ty: e.y1 }, { tx: e.x0, ty: e.y1 }];
  let best: Pt[] = [];
  let bestLen = Infinity;
  for (let i = 0; i < 4; i++) {
    if (segHitsRect(a, corners[i], hit)) continue;
    for (const dir of [1, -1]) {
      const seq: Pt[] = [corners[i]];
      let j = i;
      for (let k = 0; k < 4; k++) {
        if (!segHitsRect(seq[seq.length - 1], b, hit)) break;
        j = (j + dir + 4) % 4;
        seq.push(corners[j]);
      }
      if (segHitsRect(seq[seq.length - 1], b, hit)) continue;
      let len = d2(a, seq[0]) + d2(seq[seq.length - 1], b);
      for (let k = 1; k < seq.length; k++) len += d2(seq[k - 1], seq[k]);
      if (len < bestLen) {
        bestLen = len;
        best = seq;
      }
    }
  }
  return best;
}

export class AgentSim {
  layout: WorldLayout | null = null;
  readonly agents = new Map<string, AgentVis>();
  private groups = new Map<string, Map<string, number>>();
  /** Desk of each agent inside its department, recomputed on each sync: the layout knows no one. */
  private desks = new Map<string, number>();
  private started = false;

  setLayout(layout: WorldLayout): void {
    const changed = this.layout && this.layout.key !== layout.key;
    this.layout = layout;
    if (changed) {
      // the world was rebuilt: put everybody straight back on their spot
      for (const v of this.agents.values()) {
        v.spot = null;
        v.path = [];
      }
      this.started = false;
    }
  }

  sync(snapshot: CompanySnapshot | null, now: number): void {
    const L = this.layout;
    if (!L) return;
    const states = snapshot?.company.agents ?? [];
    const departments = snapshot?.company.departments ?? [];
    const chiefs = new Map<string, string>(departments.map((d) => [d.id, d.chiefId]));
    this.desks = deskIndexes(states, (dept) => chiefs.get(dept));
    applyDeskVisibility(L, this.desks, states, departments);
    const seen = new Set<string>();
    for (const st of states) {
      seen.add(st.id);
      let v = this.agents.get(st.id);
      if (!v) {
        const h = hashStr(st.id);
        v = {
          id: st.id, state: st, role: 'staff', carry: null, sheet: getSheet(st.avatar), pos: { ...L.pier.center }, island: L.pier.id, path: [], spot: null,
          facing: 'se', moving: false, walkT: 0, speed: BASE_SPEED * (0.9 + ((h % 100) / 100) * 0.25), phase: (h % 1000) / 160,
          override: null, wanderAt: now + 3 + (h % 7), wanderIdx: h % 97, lastVisit: -999, arrived: true,
        };
        this.agents.set(st.id, v);
      } else {
        if (v.state.avatar !== st.avatar) v.sheet = getSheet(st.avatar);
        v.state = st;
      }
    }
    for (const [id, v] of this.agents) if (!seen.has(id) && v.role === 'staff') this.agents.delete(id);
    this.retargetAll(now, !this.started);
    this.started = true;
  }

  /** The walk from a point to the dock, the only way off the map. */
  routeToDock(from: Pt, island: string): Waypoint[] {
    const pier = this.layout!.pier;
    return this.route(from, island, { key: 'dock', kind: 'dock', island: pier, pos: pier.pier?.dock ?? pier.center, pose: 'stand', facing: 'se' });
  }

  /** React to a fresh activity (brain visits, delegation calls, walks). */
  onActivity(a: Activity, now: number): void {
    const L = this.layout;
    if (!L || !a.agentId) return;
    const v = this.agents.get(a.agentId);
    if (!v) return;
    if (a.kind === 'brain_read' || a.kind === 'brain_write') {
      const busyAtFountain = [...this.agents.values()].filter((x) => x.override?.kind === 'fountain').length;
      if (v.state.status !== 'coffee' && now - v.lastVisit > 45 && busyAtFountain < 4 && !v.override) {
        v.override = { kind: 'fountain', until: now + 40 };
        v.lastVisit = now;
        this.retarget(v, now, false);
      }
    } else if (a.kind === 'delegate' && a.toAgentId) {
      const t = this.agents.get(a.toAgentId);
      if (t && !t.override && t.state.status !== 'coffee' && t.island === v.island && d2(t.pos, v.pos) < 9 && t.id !== v.id) {
        t.override = { kind: 'visit', until: now + 25, target: v.id };
        this.retarget(t, now, false);
      }
    } else if (a.kind === 'walk' && a.place) {
      v.override = { kind: 'place', until: now + 20, place: a.place };
      this.retarget(v, now, false);
    } else if (a.kind === 'coffee' && v.override?.kind !== 'fountain') {
      v.override = { kind: 'place', until: now + 20, place: 'cafe' };
      this.retarget(v, now, false);
    }
  }

  update(dt: number, now: number): void {
    for (const v of this.agents.values()) {
      if (v.path.length) {
        let step = v.speed * dt * (v.spot?.kind === 'wander' ? 0.7 : 1) * (v.path.length > 6 ? 1.2 : 1);
        while (step > 0 && v.path.length) {
          const wp = v.path[0];
          const dist = screenDist(v.pos, wp);
          if (dist > 0.01) v.facing = facingFrom(wp.tx - v.pos.tx, wp.ty - v.pos.ty);
          if (dist <= step) {
            v.pos = { tx: wp.tx, ty: wp.ty };
            v.island = wp.island;
            v.path.shift();
            step -= dist;
          } else {
            const k = step / dist;
            v.pos = { tx: v.pos.tx + (wp.tx - v.pos.tx) * k, ty: v.pos.ty + (wp.ty - v.pos.ty) * k };
            step = 0;
          }
        }
        v.moving = true;
        v.walkT += dt;
        v.arrived = false;
      } else {
        v.moving = false;
        if (v.spot) v.facing = v.spot.facing;
        if (!v.arrived) {
          v.arrived = true;
          if (v.override?.kind === 'fountain') v.override.holdUntil = now + FOUNTAIN_HOLD;
          if (v.override?.kind === 'visit') v.override.holdUntil = now + VISIT_HOLD;
        }
      }
      const o = v.override;
      if (o && (now > o.until || (o.holdUntil !== undefined && now > o.holdUntil) || (o.kind === 'place' && o.place === v.state.place))) {
        v.override = null;
        this.retarget(v, now, false);
      } else if (!v.moving && v.spot?.kind === 'wander' && now > v.wanderAt) {
        v.wanderIdx = Math.floor(Math.random() * 1000);
        v.wanderAt = now + 6 + Math.random() * 9;
        this.retarget(v, now, false);
      }
    }
  }

  // ───────────── targets ─────────────

  private homeIsland(st: AgentState): IslandModel {
    const L = this.layout!;
    const depts = new Set(L.deptIsland.keys());
    return L.deptIsland.get(homeDept(st, depts)) ?? L.plaza;
  }

  /** This agent's desk on its island. None past the island's last desk: a Direction agent the office cannot seat stands. */
  seatOf(st: AgentState): { island: IslandModel; seat: Seat; desk: number } | null {
    const island = this.homeIsland(st);
    const desk = this.desks.get(st.id);
    const seat = desk === undefined ? undefined : island.seats[desk];
    return seat ? { island, seat, desk: desk! } : null;
  }

  private desired(v: AgentVis, now: number): { kind: SpotKind; island: IslandModel } {
    const L = this.layout!;
    const st = v.state;
    const o = v.override;
    if (o && now <= o.until) {
      if (o.kind === 'fountain') return { kind: 'fountain', island: L.plaza };
      if (o.kind === 'visit' && o.target) {
        const t = this.agents.get(o.target);
        if (t) return { kind: 'visit', island: L.byId.get(t.island) ?? L.plaza };
      }
      if (o.kind === 'place' && o.place) return this.forPlace(o.place, st);
    }
    if (st.status === 'coffee') return { kind: 'cafe', island: L.plaza };
    return this.forPlace(st.place, st);
  }

  private forPlace(place: Place | undefined, st: AgentState): { kind: SpotKind; island: IslandModel } {
    const L = this.layout!;
    if (place === 'cafe') return { kind: 'cafe', island: L.plaza };
    if (place === 'cerveau') return { kind: 'fountain', island: L.plaza };
    const home = this.homeIsland(st);
    const isl = (place && L.deptIsland.get(place)) || home;
    if (isl !== home) return { kind: st.status === 'meeting' ? 'meeting' : 'visitor', island: isl };
    switch (st.status) {
      case 'meeting':
        return { kind: 'meeting', island: isl };
      case 'idle':
        return { kind: 'wander', island: isl };
      default:
        return { kind: this.seatOf(st) ? 'seat' : 'visitor', island: isl };
    }
  }

  private retargetAll(now: number, snap: boolean): void {
    const want = new Map<string, { kind: SpotKind; island: IslandModel }>();
    for (const v of this.agents.values()) want.set(v.id, this.desired(v, now));
    // stable spot indices inside each shared group
    const live = new Set<string>();
    const ordered = [...this.agents.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const v of ordered) {
      const w = want.get(v.id)!;
      if (w.kind === 'seat' || w.kind === 'wander' || w.kind === 'visit') continue;
      const gk = `${w.kind}:${w.island.id}`;
      live.add(gk);
      let g = this.groups.get(gk);
      if (!g) this.groups.set(gk, (g = new Map()));
    }
    for (const [gk, g] of this.groups) {
      for (const id of [...g.keys()]) {
        const w = want.get(id);
        if (!w || `${w.kind}:${w.island.id}` !== gk) g.delete(id);
      }
      if (!live.has(gk) && g.size === 0) this.groups.delete(gk);
    }
    for (const v of ordered) {
      const w = want.get(v.id)!;
      const gk = `${w.kind}:${w.island.id}`;
      const g = this.groups.get(gk);
      if (g && !g.has(v.id)) {
        const used = new Set(g.values());
        let i = 0;
        while (used.has(i)) i++;
        g.set(v.id, i);
      }
    }
    for (const v of this.agents.values()) {
      const w = want.get(v.id)!;
      const spot = this.resolve(v, w.kind, w.island);
      if (snap || !v.spot) this.placeAt(v, spot, now);
      else if (spot.key !== v.spot.key) this.walkTo(v, spot);
    }
  }

  private retarget(v: AgentVis, now: number, snap: boolean): void {
    const w = this.desired(v, now);
    const gk = `${w.kind}:${w.island.id}`;
    // leave previous groups
    for (const [k, g] of this.groups) if (k !== gk) g.delete(v.id);
    if (w.kind !== 'seat' && w.kind !== 'wander' && w.kind !== 'visit') {
      let g = this.groups.get(gk);
      if (!g) this.groups.set(gk, (g = new Map()));
      if (!g.has(v.id)) {
        const used = new Set(g.values());
        let i = Math.abs(hashStr(v.id)) % 3;
        while (used.has(i)) i++;
        g.set(v.id, i);
      }
    }
    const spot = this.resolve(v, w.kind, w.island);
    if (snap || !v.spot) this.placeAt(v, spot, now);
    else if (spot.key !== v.spot.key) this.walkTo(v, spot);
  }

  private resolve(v: AgentVis, kind: SpotKind, isl: IslandModel): Spot {
    const L = this.layout!;
    const idx = this.groups.get(`${kind}:${isl.id}`)?.get(v.id) ?? 0;
    const plaza = L.plaza;
    if (kind === 'seat') {
      const s = this.seatOf(v.state);
      // the key names the desk: a new chief walks to desk 0 like any target change
      if (s) return { key: `seat:${v.id}:${s.desk}`, kind, island: s.island, pos: s.seat.pos, approach: s.seat.aisle, pose: 'sit', facing: s.seat.facing, seat: s.seat };
      kind = 'visitor';
    }
    if (kind === 'cafe' && plaza.cafe) {
      const spots = plaza.cafe.spots;
      const i = idx % spots.length;
      const lap = Math.floor(idx / spots.length);
      const p = spots[i];
      const pos = lap ? { tx: p.tx + 0.32 * lap, ty: p.ty + 0.28 * lap } : p;
      return { key: `cafe:${idx}`, kind, island: plaza, pos, pose: v.state.status === 'coffee' ? 'coffee' : 'stand', facing: plaza.cafe.facing[i] };
    }
    if (kind === 'fountain' && plaza.fountain) {
      const f = plaza.fountain;
      const n = f.spots.length;
      const lap = Math.floor(idx / n);
      let pos = f.spots[idx % n];
      if (lap) {
        const a = ((idx % n) / n) * Math.PI * 2 + 0.52;
        pos = { tx: f.center.tx + Math.cos(a) * (2.3 + 0.55 * lap), ty: f.center.ty + Math.sin(a) * (2.3 + 0.55 * lap) };
      }
      return { key: `fountain:${idx}`, kind, island: plaza, pos, pose: 'stand', facing: faceTowards(pos, f.center) };
    }
    if (kind === 'visit') {
      const t = v.override?.target ? this.agents.get(v.override.target) : undefined;
      if (t) {
        const dir = { tx: v.pos.tx - t.pos.tx, ty: v.pos.ty - t.pos.ty };
        const len = Math.hypot(dir.tx, dir.ty) || 1;
        const pos = { tx: t.pos.tx + (dir.tx / len) * 0.7, ty: t.pos.ty + (dir.ty / len) * 0.7 };
        return { key: `visit:${t.id}`, kind, island: L.byId.get(t.island) ?? isl, pos, pose: 'stand', facing: faceTowards(pos, t.pos) };
      }
      kind = 'visitor';
    }
    if (kind === 'meeting') {
      const spots = isl.meetingSpots.length ? isl.meetingSpots : isl.wanderSpots;
      const p = spots[idx % Math.max(1, spots.length)] ?? isl.center;
      return { key: `meeting:${isl.id}:${idx}`, kind, island: isl, pos: p, pose: 'stand', facing: faceTowards(p, isl.meetingCenter) };
    }
    if (kind === 'wander') {
      const spots = isl.wanderSpots.length ? isl.wanderSpots : isl.meetingSpots;
      const i = v.wanderIdx % Math.max(1, spots.length);
      const p = spots[i] ?? isl.center;
      return { key: `wander:${isl.id}:${i}`, kind, island: isl, pos: p, pose: 'stand', facing: v.wanderIdx % 2 ? 'se' : 'sw' };
    }
    // visitor
    const spots = isl.visitorSpots.length ? isl.visitorSpots : isl.wanderSpots;
    const p = spots[idx % Math.max(1, spots.length)] ?? isl.center;
    const look = isl.seats[0]?.pos ?? isl.meetingCenter;
    return { key: `visitor:${isl.id}:${idx}`, kind: 'visitor', island: isl, pos: p, pose: 'stand', facing: faceTowards(p, look) };
  }

  private placeAt(v: AgentVis, spot: Spot, now: number): void {
    v.spot = spot;
    v.pos = { ...spot.pos };
    v.island = spot.island.id;
    v.path = [];
    v.facing = spot.facing;
    v.arrived = true;
    if (v.override?.kind === 'fountain' || v.override?.kind === 'visit') v.override.holdUntil = now + FOUNTAIN_HOLD;
  }

  private walkTo(v: AgentVis, spot: Spot): void {
    v.spot = spot;
    let start: Pt = v.pos;
    let island = v.island;
    const keep: Waypoint[] = [];
    if (v.path.length && v.path[0].cross) {
      keep.push(v.path[0]);
      start = v.path[0];
      island = v.path[0].island;
    }
    v.path = keep.concat(this.route(start, island, spot));
    v.arrived = false;
  }

  // ───────────── routing ─────────────

  private route(from: Pt, fromIsland: string, spot: Spot): Waypoint[] {
    const L = this.layout!;
    let cur = L.byId.get(fromIsland) ?? L.plaza;
    let at: Pt = from;
    const out: Waypoint[] = [];
    const push = (pts: Pt[], island: string) => pts.forEach((p) => out.push({ tx: p.tx, ty: p.ty, island }));
    if (cur.id !== spot.island.id) {
      const hops = this.bfs(cur.id, spot.island.id);
      if (!hops) {
        // unreachable (should not happen): walk straight
        out.push({ ...spot.pos, island: spot.island.id });
        return out;
      }
      for (const h of hops) {
        const exit = h.bridge.a === cur.id ? h.bridge.pa : h.bridge.pb;
        const enter = h.bridge.a === cur.id ? h.bridge.pb : h.bridge.pa;
        push(this.localNav(cur, at, exit), cur.id);
        out.push({ tx: enter.tx, ty: enter.ty, island: h.to, cross: true });
        at = enter;
        cur = L.byId.get(h.to)!;
      }
    }
    if (spot.approach && d2(spot.approach, spot.pos) > 0.05) {
      push(this.localNav(cur, at, spot.approach), cur.id);
      out.push({ ...spot.pos, island: cur.id });
    } else push(this.localNav(cur, at, spot.pos), cur.id);
    return out;
  }

  private bfs(from: string, to: string): { to: string; bridge: WorldLayout['bridges'][number] }[] | null {
    const L = this.layout!;
    const prev = new Map<string, { from: string; bridge: WorldLayout['bridges'][number] }>();
    const q = [from];
    const seen = new Set([from]);
    while (q.length) {
      const id = q.shift()!;
      if (id === to) break;
      for (const n of L.adjacency.get(id) ?? []) {
        if (seen.has(n.to)) continue;
        seen.add(n.to);
        prev.set(n.to, { from: id, bridge: n.bridge });
        q.push(n.to);
      }
    }
    if (!seen.has(to)) return null;
    const hops: { to: string; bridge: WorldLayout['bridges'][number] }[] = [];
    let c = to;
    while (c !== from) {
      const p = prev.get(c)!;
      hops.unshift({ to: c, bridge: p.bridge });
      c = p.from;
    }
    return hops;
  }

  /** Waypoints (excluding `a`) to walk from a to b on one island, using office gates and detours. */
  private localNav(isl: IslandModel, a: Pt, b: Pt): Pt[] {
    const room = isl.room;
    const aIn = inRect(room, a, 0.02);
    const bIn = inRect(room, b, 0.02);
    if (aIn && bIn) return [b];
    if (aIn || bIn) {
      let best = isl.gates[0];
      let bestLen = Infinity;
      for (const g of isl.gates) {
        const len = aIn ? d2(a, g.inner) + d2(g.outer, b) : d2(a, g.outer) + d2(g.inner, b);
        if (len < bestLen) {
          bestLen = len;
          best = g;
        }
      }
      if (!best) return [b];
      if (aIn) return [best.inner, best.outer, ...this.outside(isl, best.outer, b)];
      return [...this.outside(isl, a, best.outer), best.inner, b];
    }
    return this.outside(isl, a, b);
  }

  private outside(isl: IslandModel, a: Pt, b: Pt): Pt[] {
    const gate = frontPathGate(isl, a, b);
    return gate ? [...this.leg(isl, a, gate), ...this.leg(isl, gate, b)] : this.leg(isl, a, b);
  }

  private leg(isl: IslandModel, a: Pt, b: Pt): Pt[] {
    const pts: Pt[] = [];
    const f = isl.fountain;
    if (f && segDistToPoint(a, b, f.center) < f.radius + 0.55) {
      const a0 = Math.atan2(a.ty - f.center.ty, a.tx - f.center.tx);
      let a1 = Math.atan2(b.ty - f.center.ty, b.tx - f.center.tx);
      let da = a1 - a0;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      a1 = a0 + da;
      const steps = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 4)));
      for (let i = 0; i <= steps; i++) {
        const t = a0 + (da * i) / steps;
        pts.push({ tx: f.center.tx + Math.cos(t) * f.ring, ty: f.center.ty + Math.sin(t) * f.ring });
      }
    }
    // detour around the office on each leg
    const chain = [a, ...pts, b];
    const out: Pt[] = [];
    for (let i = 1; i < chain.length; i++) {
      if (isl.room) out.push(...aroundRect(chain[i - 1], chain[i], isl.room, 0.45));
      out.push(chain[i]);
    }
    return out;
  }
}
