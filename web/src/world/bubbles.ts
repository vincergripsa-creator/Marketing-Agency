// Speech bubbles: latest fresh activity per agent (or agent.bubble), at most 6 on screen,
// selected agent and delegate/deliverable lines first, stacked to avoid overlaps.
import type { Activity, ActivityKind, AgentState } from '../../../shared/types';
import { FONT_PIXEL, FONT_UI, measure, roundRect, upperFr, wrap } from './text';

export const BUBBLE_LIFE = 6.5;
const MAX_BUBBLES = 6;
const MAX_W = 184;

interface Item { agentId: string; header: string; text: string; kind: ActivityKind | 'bubble'; born: number; accent: string; life: number }

const KIND_PRIO: Partial<Record<ActivityKind | 'bubble', number>> = {
  delegate: 50, deliverable: 50, review: 34, task_done: 30, task_failed: 32, lesson: 30, brain_write: 26,
  brain_read: 22, task_start: 20, message: 20, ad: 20, sale: 24, refund: 22, chat: 18, thought: 14, meeting: 12,
  founder: 30, bubble: 10, walk: 4, coffee: 6, event: 16, finance: 16,
};

const KIND_COLOR: Partial<Record<ActivityKind | 'bubble', string>> = {
  delegate: '#d97706', review: '#059669', deliverable: '#7c3aed', brain_read: '#0284c7', brain_write: '#c026d3',
  task_done: '#16a34a', task_failed: '#dc2626', lesson: '#ca8a04', sale: '#16a34a', refund: '#dc2626', coffee: '#92400e',
};

function headerFor(a: Activity, name: string, toName: string | null): string {
  const N = upperFr(name);
  switch (a.kind) {
    case 'delegate': return toName ? `${N} → ${upperFr(toName)}` : `${N} · DÉLÈGUE`;
    case 'review': return toName ? `${N} · REVUE ${upperFr(toName)}` : `${N} · REVUE`;
    case 'deliverable': return `${N} · LIVRABLE`;
    case 'brain_read': return `${N} · LIT LE CERVEAU`;
    case 'brain_write': return `${N} · ÉCRIT AU CERVEAU`;
    case 'task_done': return `${N} · TERMINÉ`;
    case 'task_failed': return `${N} · ÉCHEC`;
    case 'task_start': return `${N} · AU TRAVAIL`;
    case 'lesson': return `${N} · LEÇON`;
    case 'meeting': return `${N} · RÉUNION`;
    case 'coffee': return `${N} · PAUSE CAFÉ`;
    default: return N;
  }
}

export interface BubbleCtx {
  /** Screen position (css px) of the agent's head, or null when unknown/offscreen. */
  headOf(id: string): [number, number] | null;
  colorOf(id: string): string;
  selectedId: string | null;
  hoverId: string | null;
}

export class Bubbles {
  private items = new Map<string, Item>();
  private lastBubble = new Map<string, string>();

  reset(): void {
    this.items.clear();
    this.lastBubble.clear();
  }

  push(a: Activity, born: number, byId: Map<string, AgentState>): void {
    if (!a.agentId || !a.text) return;
    const ag = byId.get(a.agentId);
    if (!ag) return;
    const to = a.toAgentId ? byId.get(a.toAgentId)?.name ?? null : null;
    const prev = this.items.get(a.agentId);
    const prio = KIND_PRIO[a.kind] ?? 10;
    // keep an important line visible a bit longer than a following trivial one
    if (prev && prev.born > born - 1.2 && (KIND_PRIO[prev.kind] ?? 0) > prio + 15) return;
    this.items.set(a.agentId, { agentId: a.agentId, header: headerFor(a, ag.name, to), text: a.text, kind: a.kind, born, accent: KIND_COLOR[a.kind] ?? '', life: BUBBLE_LIFE });
  }

  /** agent.bubble from the server: shown for a while each time it changes. */
  syncAgentBubbles(agents: readonly AgentState[], now: number, initial: boolean): void {
    for (const a of agents) {
      const b = a.bubble?.trim() || '';
      const before = this.lastBubble.get(a.id);
      if (b === before) continue;
      this.lastBubble.set(a.id, b);
      if (!b || initial) continue;
      const cur = this.items.get(a.id);
      if (cur && now - cur.born < 2 && cur.kind !== 'bubble') continue;
      this.items.set(a.id, { agentId: a.id, header: upperFr(a.name), text: b, kind: 'bubble', born: now, accent: '', life: BUBBLE_LIFE + 1.5 });
    }
  }

  draw(g: CanvasRenderingContext2D, ctx: BubbleCtx, now: number, viewW: number, viewH: number, persistent: Map<string, string>, max = MAX_BUBBLES): void {
    const cands: { it: Item; score: number; x: number; y: number; alpha: number }[] = [];
    for (const [id, it] of this.items) {
      const age = now - it.born;
      const pinned = id === ctx.selectedId || id === ctx.hoverId;
      if (age > it.life && !(pinned && age < it.life * 3)) {
        if (age > it.life * 3) this.items.delete(id);
        continue;
      }
      const head = ctx.headOf(id);
      if (!head) continue;
      const fadeIn = Math.min(1, age / 0.25);
      const fadeOut = pinned ? 1 : Math.min(1, (it.life - age) / 0.7);
      const score = (KIND_PRIO[it.kind] ?? 10) + (1 - age / it.life) * 12 + (id === ctx.selectedId ? 200 : 0) + (id === ctx.hoverId ? 120 : 0);
      cands.push({ it, score, x: head[0], y: head[1], alpha: Math.max(0, fadeIn * fadeOut) });
    }
    // persistent bubble for the selected agent when nothing fresh (agent.bubble)
    for (const id of [ctx.selectedId, ctx.hoverId]) {
      if (!id || this.items.has(id)) continue;
      const text = persistent.get(id);
      const head = ctx.headOf(id);
      if (!text || !head) continue;
      cands.push({ it: { agentId: id, header: '', text, kind: 'bubble', born: now, accent: '', life: 99 }, score: 150, x: head[0], y: head[1], alpha: 1 });
    }
    cands.sort((a, b) => b.score - a.score);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const bodyFont = `500 11px ${FONT_UI}`;
    const headFont = `8px ${FONT_PIXEL}`;
    for (const c of cands.slice(0, Math.max(1, Math.min(MAX_BUBBLES, max)))) {
      if (c.alpha <= 0.01) continue;
      const lines = wrap(g, bodyFont, c.it.text, MAX_W, 3);
      const header = c.it.header;
      let w = 0;
      for (const l of lines) w = Math.max(w, measure(g, bodyFont, l));
      if (header) w = Math.max(w, measure(g, headFont, header));
      w = Math.ceil(Math.min(MAX_W, w) + 18);
      const h = (header ? 14 : 0) + lines.length * 14 + 12;
      let x = Math.round(c.x - w / 2);
      let y = Math.round(c.y - h - 10);
      x = Math.max(6, Math.min(viewW - w - 6, x));
      for (let k = 0; k < 6; k++) {
        const hit = placed.find((p) => x < p.x + p.w + 4 && x + w + 4 > p.x && y < p.y + p.h + 4 && y + h + 4 > p.y);
        if (!hit) break;
        y = hit.y - h - 6;
      }
      if (y < 4 || y > viewH) continue;
      placed.push({ x, y, w, h });
      const accent = c.it.accent || ctx.colorOf(c.it.agentId);
      g.globalAlpha = c.alpha;
      g.save();
      g.shadowColor = 'rgba(40,30,70,0.22)';
      g.shadowBlur = 10;
      g.shadowOffsetY = 3;
      g.fillStyle = 'rgba(255,255,255,0.96)';
      roundRect(g, x, y, w, h, 9);
      g.fill();
      g.restore();
      // tail
      const tx = Math.max(x + 12, Math.min(x + w - 12, c.x));
      g.fillStyle = 'rgba(255,255,255,0.96)';
      g.beginPath();
      g.moveTo(tx - 6, y + h - 1);
      g.lineTo(tx + 6, y + h - 1);
      g.lineTo(c.x, Math.min(c.y - 2, y + h + 8));
      g.closePath();
      g.fill();
      g.fillStyle = accent;
      roundRect(g, x, y + 7, 3, h - 14, 1.5);
      g.fill();
      let ty = y + 8;
      if (header) {
        g.font = headFont;
        g.fillStyle = accent;
        g.textBaseline = 'top';
        g.fillText(header, x + 10, ty + 1);
        ty += 14;
      }
      g.font = bodyFont;
      g.fillStyle = '#2a2540';
      g.textBaseline = 'top';
      for (const l of lines) {
        g.fillText(l, x + 10, ty);
        ty += 14;
      }
      g.globalAlpha = 1;
    }
  }
}
