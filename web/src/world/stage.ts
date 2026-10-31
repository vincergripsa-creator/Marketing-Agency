// What the plaza shows of the league and the channels: props that change with the data, depth-sorted
// with the agents, and the clickable places of the map. Each prop is rebaked only when its data changes.
import { CHANNEL_IDS } from '../../../shared/channels';
import type { ChannelChip, SceneView } from '../../../shared/types';
import { isoX, isoY, type Pt } from './iso';
import type { Hotspot, HotspotId, WorldLayout } from './model';
import { place } from './model';
import type { Baked, P2 } from './pixel';
import { TROPHY_WALL_W, channelTotemProp, leagueBoardProp, trophyWallProp } from './props';

export interface DynProp { img: HTMLCanvasElement; x: number; y: number; depth: number }
/** The place's tag, in world px. `league`: shown from zoom 1,25 on, the others on hover only. */
export interface PlaceTag { id: HotspotId; x: number; y: number; title: string; sub: string; color: string; league: boolean }

const WALL_D = 0.25;
const BOARD_W = 86;
const BOARD_H = 82;
const TOTEM_W = 16;
const TOTEM_H = 36;
const PLACE_COLOR = '#7c6cf0';

const CHANNEL_SUB: Record<ChannelChip['state'], string> = { closed: 'fermé', verifying: 'compte en vérification', open: 'ouvert', banned: 'compte banni' };

/** Upright rectangle standing on a base point, in world px. */
function standing(base: Pt, w: number, h: number): P2[] {
  const x = isoX(base.tx, base.ty);
  const y = isoY(base.tx, base.ty);
  return [[x - w / 2, y - h], [x + w / 2, y - h], [x + w / 2, y + 2], [x - w / 2, y + 2]];
}

/** Outline of a tile footprint rising to z px. */
function raised(tx0: number, ty0: number, tx1: number, ty1: number, z: number): P2[] {
  return [
    [isoX(tx0, ty0), isoY(tx0, ty0, z)], [isoX(tx1, ty0), isoY(tx1, ty0, z)], [isoX(tx1, ty0), isoY(tx1, ty0)],
    [isoX(tx1, ty1), isoY(tx1, ty1)], [isoX(tx0, ty1), isoY(tx0, ty1)], [isoX(tx0, ty1), isoY(tx0, ty1, z)],
  ];
}

export class StageLayer {
  private baked = new Map<string, { print: string; b: Baked }>();
  private list: DynProp[] = [];
  private places: PlaceTag[] = [];

  /** `podium.season` is the last season closed, so the board shows the next one. */
  private seasonOf(scene: SceneView): number {
    return (scene.podium?.season ?? 0) + 1;
  }

  private rebake(id: string, print: string, paint: () => Baked): Baked {
    const hit = this.baked.get(id);
    if (hit?.print === print) return hit.b;
    const b = paint();
    this.baked.set(id, { print, b });
    return b;
  }

  private add(b: Baked, at: Pt, depth: number): void {
    const s = place(b, at.tx, at.ty, depth);
    this.list.push({ img: s.img, x: s.x, y: s.y, depth: s.depth });
  }

  sync(scene: SceneView | undefined, L: WorldLayout): void {
    this.list = [];
    this.places = [];
    const hotspots: Hotspot[] = [];
    const tag = (h: Hotspot, at: { x: number; y: number }, sub: string, color: string, league: boolean) => {
      hotspots.push(h);
      this.places.push({ id: h.id, x: at.x, y: at.y, title: h.title, sub, color, league });
    };
    const open = Object.values(scene?.openSeats ?? {}).reduce<number>((n, v) => n + (v ?? 0), 0);
    tag({ id: 'quai', poly: L.pier.hitPoly, title: L.pier.name }, L.pier.labelAnchor, `${open} poste${open > 1 ? 's' : ''} ouvert${open > 1 ? 's' : ''}`, L.pier.color, false);
    const stage = L.plaza.stage;
    if (stage && scene) {
      const podium = scene.podium;
      const cups = podium?.cups ?? [];
      this.add(this.rebake('wall', JSON.stringify(cups), () => trophyWallProp(cups)), stage.wall, stage.wall.tx + TROPHY_WALL_W / 2 + stage.wall.ty + WALL_D / 2);

      const season = this.seasonOf(scene);
      const rows = scene.board.slice(0, 5);
      if (rows.length) {
        this.add(this.rebake('board', JSON.stringify([rows, season]), () => leagueBoardProp(rows, season)), stage.board, stage.board.tx + stage.board.ty);
        const top = { x: isoX(stage.board.tx, stage.board.ty), y: isoY(stage.board.tx, stage.board.ty, BOARD_H - 2) };
        tag({ id: 'ligue', poly: standing(stage.board, BOARD_W, BOARD_H), title: 'Ligue' }, top, `Saison ${season}`, PLACE_COLOR, true);
      }

      const pc = stage.podium.centre;
      const champion = podium?.places.find((p) => p.place === 1);
      const podiumPoly = raised(pc.tx - 1.1, pc.ty - 0.6, pc.tx + 1.1, pc.ty + 0.6, 14);
      // over the wall's far end: the Cerveau plaque stands right behind the steps
      const w = { tx: stage.wall.tx + TROPHY_WALL_W, ty: stage.wall.ty };
      tag({ id: 'podium', poly: podiumPoly, title: 'Podium' }, { x: isoX(w.tx, w.ty), y: isoY(w.tx, w.ty, 26) }, champion ? `Saison ${podium?.season} : ${champion.person.name}` : 'pas encore de saison', '#f4c542', true);

      const dc = stage.duel.centre;
      const n = scene.duels.length;
      tag({ id: 'duel', poly: raised(dc.tx - 0.62, dc.ty - 0.4, dc.tx + 0.62, dc.ty + 0.4, 18), title: 'Duels' }, { x: isoX(dc.tx, dc.ty), y: isoY(dc.tx, dc.ty, 24) }, n ? `${n} en cours` : 'aucun en cours', '#ef4444', false);

      // a channel keeps its slot for life, whatever opens around it
      for (const chip of scene.channels) {
        const slot = stage.channelSlots[CHANNEL_IDS.indexOf(chip.id)];
        if (!slot) continue;
        const print = JSON.stringify([chip.glyph, chip.color, chip.state, Math.round(chip.share * 10)]);
        this.add(this.rebake(`canal:${chip.id}`, print, () => channelTotemProp(chip)), slot, slot.tx + slot.ty);
        const top = { x: isoX(slot.tx, slot.ty), y: isoY(slot.tx, slot.ty, TOTEM_H) };
        const sub = chip.state === 'open' ? `${Math.round(chip.share * 100)} % du budget` : CHANNEL_SUB[chip.state];
        tag({ id: `canal:${chip.id}`, poly: standing(slot, TOTEM_W, TOTEM_H), title: chip.name }, top, sub, chip.color, false);
      }
    }
    L.hotspots = hotspots;
  }

  items(): readonly DynProp[] {
    return this.list;
  }

  tags(): readonly PlaceTag[] {
    return this.places;
  }
}
