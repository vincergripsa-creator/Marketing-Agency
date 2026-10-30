// Flow mode: animated glowing dashed lines agent → Cerveau (brain_read / brain_write) and
// agent → agent (delegate / review), with travelling pixel particles, fading out.
import type { Activity, ActivityKind } from '../../../shared/types';

export const FLOW_LIFE = 7;

export interface FlowItem { from: string; to: string | null; kind: ActivityKind; born: number }

const COLORS: Partial<Record<ActivityKind, string>> = {
  brain_read: '#7dd3fc',
  brain_write: '#f0abfc',
  delegate: '#fbbf24',
  review: '#4ade80',
};

export class Flows {
  items: FlowItem[] = [];

  reset(): void {
    this.items = [];
  }

  push(a: Activity, born: number): void {
    if (!a.agentId) return;
    if (a.kind === 'brain_read' || a.kind === 'brain_write') this.items.push({ from: a.agentId, to: null, kind: a.kind, born });
    else if ((a.kind === 'delegate' || a.kind === 'review') && a.toAgentId && a.toAgentId !== a.agentId) this.items.push({ from: a.agentId, to: a.toAgentId, kind: a.kind, born });
    if (this.items.length > 80) this.items.splice(0, this.items.length - 80);
  }

  prune(now: number): void {
    if (this.items.length && now - this.items[0].born > FLOW_LIFE) this.items = this.items.filter((f) => now - f.born <= FLOW_LIFE);
  }

  /** Number of brain reads/writes in the last few seconds (drives the fountain beam). */
  brainActivity(now: number, window = 6): number {
    let n = 0;
    for (const f of this.items) if (!f.to && now - f.born < window) n++;
    return n;
  }

  /** Draws in world space (caller set the camera transform). */
  draw(g: CanvasRenderingContext2D, posOf: (id: string) => { x: number; y: number } | null, brain: { x: number; y: number }, zoom: number, now: number): void {
    const lw = 1 / Math.max(0.2, zoom);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const f of this.items) {
      const age = now - f.born;
      if (age > FLOW_LIFE || age < 0) continue;
      const a = posOf(f.from);
      const b = f.to ? posOf(f.to) : brain;
      if (!a || !b) continue;
      const alpha = Math.min(1, age / 0.3) * Math.min(1, (FLOW_LIFE - age) / 1.5);
      const color = COLORS[f.kind] ?? '#ffffff';
      // read: brain → agent, write / delegate / review: agent → target
      const [p0, p1] = f.kind === 'brain_read' ? [b, a] : [a, b];
      const mx = (p0.x + p1.x) / 2;
      const my = (p0.y + p1.y) / 2 - Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.22 - 10;
      const curve = () => {
        g.beginPath();
        g.moveTo(p0.x, p0.y);
        g.quadraticCurveTo(mx, my, p1.x, p1.y);
      };
      g.globalAlpha = alpha * 0.35;
      g.strokeStyle = color;
      g.lineWidth = 6 * lw;
      g.setLineDash([]);
      curve();
      g.stroke();
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = alpha * 0.95;
      g.lineWidth = 2 * lw;
      g.setLineDash([7 * lw, 6 * lw]);
      g.lineDashOffset = -now * 40 * lw;
      curve();
      g.stroke();
      // particles
      g.setLineDash([]);
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) {
        const t = (now * 0.55 + i / 3) % 1;
        const u = 1 - t;
        const x = u * u * p0.x + 2 * u * t * mx + t * t * p1.x;
        const y = u * u * p0.y + 2 * u * t * my + t * t * p1.y;
        const s = 2.2 * lw;
        g.globalAlpha = alpha;
        g.fillRect(x - s, y - s, s * 2, s * 2);
      }
      g.globalCompositeOperation = 'lighter';
    }
    g.restore();
  }
}
