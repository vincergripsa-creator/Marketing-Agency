// Data structures of the built world (static layout, computed once per department layout).
import type { DeptDef, DeptId } from '../../../shared/types';
import type { Facing, Pt } from './iso';
import { isoX, isoY } from './iso';
import type { Baked, P2 } from './pixel';

export type Side = 'x-' | 'x+' | 'y-' | 'y+';
export const SIDES: Side[] = ['x-', 'x+', 'y-', 'y+'];
export const OPPOSITE: Record<Side, Side> = { 'x-': 'x+', 'x+': 'x-', 'y-': 'y+', 'y+': 'y-' };

/** A depth-sorted image in world px. */
export interface Sprite {
  img: HTMLCanvasElement;
  x: number;
  y: number;
  depth: number;
}

export interface Light {
  x: number; y: number; // world px
  r: number;
  color: string;
  kind: 'lamp' | 'room' | 'screen';
}

export interface Seat {
  pos: Pt;
  facing: Facing;
  /** Point in the aisle next to the seat (agents walk through it). */
  aisle: Pt;
  /** Monitor screen polygon in world px (lit while the agent works). */
  screen: P2[];
  /** Depth of the desk sprite (the lit screen is drawn right after it). */
  deskDepth: number;
  chief: boolean;
}

export interface Gate { side: Side; inner: Pt; outer: Pt }

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface IslandModel {
  id: string;                 // dept id, 'plaza' for the central plaza
  kind: 'dept' | 'plaza';
  deptId: DeptId | null;      // plaza hosts 'direction'
  def: DeptDef | null;
  name: string;
  color: string;
  col: number; row: number;   // effective grid cell
  size: number;               // tiles per side
  x0: number; y0: number;     // world tile min corner
  center: Pt;
  room: Rect | null;          // fenced office (world tiles)
  gates: Gate[];
  edges: Partial<Record<Side, Pt>>;
  seats: Seat[];
  visitorSpots: Pt[];
  wanderSpots: Pt[];
  meetingSpots: Pt[];
  meetingCenter: Pt;
  labelAnchor: { x: number; y: number }; // world px (top of the sign)
  ground: { img: HTMLCanvasElement; x: number; y: number };
  sprites: Sprite[];
  lights: Light[];
  topPoly: P2[];              // top face (world px) for outline/selection
  hitPoly: P2[];              // top + sides (world px)
  depth: number;
  // plaza extras
  fountain?: { center: Pt; radius: number; crystal: { x: number; y: number }; spots: Pt[]; ring: number };
  cafe?: { spots: Pt[]; facing: Facing[]; machine: { x: number; y: number }; area: Rect; anchor: { x: number; y: number } };
}

export interface Bridge {
  a: string; b: string;       // island ids
  sideA: Side; sideB: Side;
  pa: Pt; pb: Pt;             // walk points at each island edge (world tiles)
}

export interface WorldLayout {
  key: string;
  islands: IslandModel[];
  byId: Map<string, IslandModel>;
  deptIsland: Map<string, IslandModel>; // dept id → island (direction → plaza)
  bridges: Bridge[];
  adjacency: Map<string, { to: string; bridge: Bridge; side: Side }[]>;
  ground: { img: HTMLCanvasElement; x: number; y: number };
  sprites: Sprite[];          // all static props, sorted by depth
  lights: Light[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  plaza: IslandModel;
  /** Effective grid (after collision / connectivity fixes), shared with the minimap. */
  grid: Map<string, { col: number; row: number }>;
  seatOf: Map<string, { island: IslandModel; seat: Seat }>;
}

export function place(b: Baked, tx: number, ty: number, depth: number, z = 0): Sprite {
  return { img: b.c, x: Math.round(isoX(tx, ty) - b.ox), y: Math.round(isoY(tx, ty, z) - b.oy), depth };
}

export function inRect(r: Rect | null, p: Pt, pad = 0): boolean {
  return !!r && p.tx > r.x0 + pad && p.tx < r.x1 - pad && p.ty > r.y0 + pad && p.ty < r.y1 - pad;
}
