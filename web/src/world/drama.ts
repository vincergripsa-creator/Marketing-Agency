// What the world stages of the company's life: `scene.recent`, read once per key, so a dropped frame or a reload plays nothing
// twice. The camera never moves for a beat. `takeBeats`, the duel line and the markers are pure, tested without a canvas.
import { CHANNEL_IDS } from '../../../shared/channels';
import type { ChronicleEntry, CompanySnapshot, PersonChip, SceneView } from '../../../shared/types';
import type { AgentSim } from './agents';
import type { Bubbles } from './bubbles';
import type { Effects } from './effects';
import { isoX, isoY, type Pt } from './iso';
import type { IslandModel, WorldLayout } from './model';
import { place } from './model';
import { vacancyTagProp } from './props';
import type { IconKind } from './sprites';
import type { DynProp } from './stage';
import { upperFr } from './text';

export interface DramaState { seen: Set<string>; started: boolean }
export const MAX_BEATS = 12;
export const MAX_AGE_DAYS = 2;
const MAX_SEEN = 500;

export const DUEL_GAP = 30;
export const MAX_DUELS_WAITING = 3;
export const WHY_CHARS = 60;
export const BADGE_ZOOM = 1.25;

const HEAD = 24;              // world px above the feet
const TOTEM_TOP = 38;
const PODIUM_TOP = 46;
const SPARK_LIFT = 12;        // over the duel table
const SPARKLE_SECONDS = 1.4;
const SCORE_SECONDS = 2;
const CONFETTI_BURSTS = 4;
const CONFETTI_GAP = 0.6;     // with their 2,2 s of life, 4 s in the air
const CONFETTI_N = 40;
const DUST_RING = 10;
const REFLOW_SECONDS = 0.35;  // the dust settles once the dissolve is over
const TAG_Z = 8;              // the stick clears the desk

export function dramaState(): DramaState {
  return { seen: new Set(), started: false };
}

/** First snapshot of a run plays nothing. Afterwards each key plays once, the newest 12, none older than 2 days. */
export function takeBeats(st: DramaState, scene: SceneView | undefined, day: number): ChronicleEntry[] {
  if (!scene) return [];
  const fresh = scene.recent.filter((e) => !st.seen.has(e.key));
  for (const e of fresh) st.seen.add(e.key);
  if (st.seen.size > MAX_SEEN) st.seen = new Set(scene.recent.map((e) => e.key));
  if (!st.started) {
    st.started = true;
    return [];
  }
  return fresh.filter((e) => e.day >= day - MAX_AGE_DAYS).slice(-MAX_BEATS);
}

/** One table, one duel: the others wait in line, and the line drops its oldest past 3. */
export class DuelQueue {
  private waiting: ChronicleEntry[] = [];
  private nextAt = -Infinity;

  get size(): number {
    return this.waiting.length;
  }

  push(e: ChronicleEntry): void {
    this.waiting.push(e);
    if (this.waiting.length > MAX_DUELS_WAITING) this.waiting.shift();
  }

  /** Starts the oldest duel that can still play. `start` is false when someone left: the next one takes the slot. */
  pump(now: number, busy: boolean, start: (e: ChronicleEntry) => boolean): void {
    if (busy || now < this.nextAt) return;
    for (let e = this.waiting.shift(); e; e = this.waiting.shift()) {
      if (!start(e)) continue;
      this.nextAt = now + DUEL_GAP;
      return;
    }
  }
}

const BADGE_ICON: Record<NonNullable<PersonChip['badge']>, IconKind> = { champion: 'crown', podium: 'medal', new: 'star', probation: 'card' };

/** The champion's crown shows at any zoom, the others up close, and a red card on whoever is hovered or selected. */
export function badgeIcon(badge: PersonChip['badge'] | undefined, zoom: number, focused: boolean): IconKind | null {
  if (!badge) return null;
  return badge === 'champion' || zoom >= BADGE_ZOOM || (badge === 'probation' && focused) ? BADGE_ICON[badge] : null;
}

/** `rôle · 1 284`: the name tag of whoever has a rating. */
export function nameTagRole(role: string, chip: PersonChip | undefined): string {
  return chip ? `${role} · ${Math.round(chip.rating).toLocaleString('fr-FR')}` : role;
}

export function leaveLine(why: string | null | undefined): string {
  const w = (why ?? '').trim();
  if (!w) return 'Je pars.';
  return `Je pars : ${w.length > WHY_CHARS ? `${w.slice(0, WHY_CHARS - 1).trimEnd()}…` : w}`;
}

/** A plot that became an office, or an island that went up a tier. A leaving neighbour shrinks nothing: tiers only grow. */
export function grownIslands(before: WorldLayout, after: WorldLayout): IslandModel[] {
  return after.islands.filter((isl) => {
    const was = before.byId.get(isl.id);
    return !isl.closed && (!was || !!was.closed || isl.size > was.size);
  });
}

export class Drama {
  private st = dramaState();
  private duels = new DuelQueue();
  private later: { at: number; run(): void }[] = [];
  private tags: DynProp[] = [];

  constructor(private sim: AgentSim, private effects: Effects, private bubbles: Bubbles) {}

  /** A new run: none of the old one's lines, walkers or duels carry over. */
  reset(): void {
    this.st = dramaState();
    this.duels = new DuelQueue();
    this.later = [];
    this.sim.clearWalkers();
  }

  /** After any layout rebuild, before `sim.sync`: a leaver clones the sprite that still shows the person. */
  play(s: CompanySnapshot | null, L: WorldLayout, now: number): void {
    if (!s) return;
    for (const e of takeBeats(this.st, s.scene, s.day)) this.react(e, s, L, now);
  }

  /** The vacancy tags, after `sim.sync`: that is when the desks are known. */
  placeTags(scene: SceneView | undefined): void {
    this.tags = [];
    for (const [dept, open] of Object.entries(scene?.openSeats ?? {})) {
      const seat = open ? this.sim.nextFreeSeat(dept) : null;
      if (seat) this.tags.push(place(vacancyTagProp(), seat.pos.tx, seat.pos.ty, seat.deskDepth + 0.002, TAG_Z));
    }
  }

  items(): readonly DynProp[] {
    return this.tags;
  }

  /** Dust over what a key change made bigger. A `dept_open` always changes the key: this is that beat too. */
  grown(before: WorldLayout, after: WorldLayout, now: number): void {
    for (const isl of grownIslands(before, after)) this.after(now + REFLOW_SECONDS, () => this.dustRing(isl));
  }

  update(now: number): void {
    for (const c of this.sim.cues) {
      const [x, y] = [isoX(c.at.tx, c.at.ty), isoY(c.at.tx, c.at.ty)];
      if (c.kind === 'dust') this.effects.dust(x, y);
      else this.effects.spark(x, y - SPARK_LIFT, c.seconds);
    }
    this.sim.cues.length = 0;
    this.duels.pump(now, this.sim.inDuel, (e) => !!e.agentId && !!e.otherId && this.sim.callToDuel(e.agentId, e.otherId, now));
    if (!this.later.length) return;
    const due = this.later.filter((l) => l.at <= now);
    this.later = this.later.filter((l) => l.at > now);
    for (const l of due) l.run();
  }

  private after(at: number, run: () => void): void {
    this.later.push({ at, run });
  }

  private head(id: string | null | undefined): { x: number; y: number } | null {
    const v = id ? this.sim.agents.get(id) : undefined;
    return v ? { x: isoX(v.pos.tx, v.pos.ty), y: isoY(v.pos.tx, v.pos.ty) - HEAD } : null;
  }

  private dustRing(isl: IslandModel): void {
    const r = isl.size / 2 - 0.4;
    for (let i = 0; i < DUST_RING; i++) {
      const a = (i / DUST_RING) * Math.PI * 2;
      const p: Pt = { tx: isl.center.tx + Math.cos(a) * r, ty: isl.center.ty + Math.sin(a) * r };
      this.effects.dust(isoX(p.tx, p.ty), isoY(p.tx, p.ty));
    }
  }

  private score(id: string | null | undefined, delta: number | undefined, now: number): void {
    const points = Math.round(delta ?? 0);
    const at = this.head(id);
    if (!id || !at || !points) return;
    this.effects.floater(at.x, at.y, `${points > 0 ? '+' : ''}${points}`, points > 0 ? '#4ade80' : '#f87171');
    this.sim.gesture(id, points > 0 ? 'cheer' : 'slump', now + SCORE_SECONDS);
  }

  /** `stage_up`, `probation`, `channel_close`, closures and `req_filled` show on their own: the badge, the totem, the data. */
  private react(e: ChronicleEntry, s: CompanySnapshot, L: WorldLayout, now: number): void {
    const stage = L.plaza.stage;
    switch (e.kind) {
      case 'hire':
        if (e.agentId) this.sim.expectArrival(e.agentId);
        break;
      case 'fire':
      case 'layoff': {
        const id = this.sim.spawnLeaver(e.key, e.agentId ?? null, e.person, now);
        const v = id ? this.sim.agents.get(id) : undefined;
        if (v) this.bubbles.say(v.id, upperFr(v.state.name), leaveLine(e.why), now);
        break;
      }
      case 'promote': {
        const at = this.head(e.agentId);
        const a = s.company.agents.find((x) => x.id === e.agentId);
        if (!at) break;
        this.effects.spark(at.x, at.y, SPARKLE_SECONDS);
        if (a?.desk === 0 || a?.isChief) this.effects.floater(at.x, at.y - 6, 'CHEF', '#ffd166');
        break;
      }
      case 'duel_open':
        this.duels.push(e);
        break;
      case 'duel_end':
        this.score(e.agentId, e.numbers?.ratingDeltaA, now);
        this.score(e.otherId, e.numbers?.ratingDeltaB, now);
        break;
      case 'season_end': {
        if (stage) {
          const c = stage.podium.centre;
          const [x, y] = [isoX(c.tx, c.ty), isoY(c.tx, c.ty, PODIUM_TOP)];
          for (let i = 0; i < CONFETTI_BURSTS; i++) this.after(now + i * CONFETTI_GAP, () => this.effects.confetti(x, y, CONFETTI_N));
        }
        if (e.agentId && s.company.agents.some((a) => a.id === e.agentId)) this.sim.callToPodium(e.agentId, now);
        break;
      }
      case 'channel_open': {
        const slot = stage?.channelSlots[CHANNEL_IDS.findIndex((id) => id === e.channel)];
        const chip = s.scene?.channels.find((c) => c.id === e.channel);
        if (!slot) break;
        const [x, y] = [isoX(slot.tx, slot.ty), isoY(slot.tx, slot.ty)];
        this.effects.dust(x, y);
        this.effects.floater(x, y - TOTEM_TOP, chip?.name ?? e.channel ?? '', chip?.color ?? '#ffffff');
        break;
      }
      default:
        break;
    }
  }
}
