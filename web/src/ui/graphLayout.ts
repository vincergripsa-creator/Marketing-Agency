// Fruchterman–Reingold style force layout, computed once per graph (deterministic start).
import { hash } from './format';

export interface LayoutNode { id: string; title: string; group: string; x: number; y: number; degree: number }
export interface LayoutEdge { from: string; to: string }

export function forceLayout(
  nodes: { id: string; title: string; group: string }[],
  edges: LayoutEdge[],
  size = { w: 1000, h: 700 },
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const n = nodes.length;
  if (n === 0) return { nodes: [], edges: [] };
  const index = new Map(nodes.map((nd, i) => [nd.id, i] as const));
  const valid = edges.filter((e) => index.has(e.from) && index.has(e.to) && e.from !== e.to);
  const degree = new Array<number>(n).fill(0);
  for (const e of valid) { degree[index.get(e.from)!]++; degree[index.get(e.to)!]++; }

  // Seed: groups on a ring, members jittered around their group anchor.
  const groups = [...new Set(nodes.map((nd) => nd.group))];
  const gAngle = new Map(groups.map((g, i) => [g, (i / Math.max(1, groups.length)) * Math.PI * 2] as const));
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const R = Math.min(size.w, size.h) * 0.3;
  nodes.forEach((nd, i) => {
    const a = gAngle.get(nd.group) ?? 0;
    const h = hash(nd.id);
    const jr = 30 + (h % 90);
    const ja = ((h >>> 8) % 360) * (Math.PI / 180);
    px[i] = size.w / 2 + Math.cos(a) * R + Math.cos(ja) * jr;
    py[i] = size.h / 2 + Math.sin(a) * R + Math.sin(ja) * jr;
  });

  const area = size.w * size.h;
  const k = Math.sqrt(area / n) * 0.75;
  const iterations = n > 250 ? 140 : n > 120 ? 220 : 320;
  let temp = size.w / 8;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);

  for (let it = 0; it < iterations; it++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ddx = px[i] - px[j];
        let ddy = py[i] - py[j];
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 < 0.01) { ddx = 0.1 * ((i % 3) - 1); ddy = 0.1; d2 = 0.02; }
        const f = (k * k) / d2;
        dx[i] += ddx * f; dy[i] += ddy * f;
        dx[j] -= ddx * f; dy[j] -= ddy * f;
      }
    }
    for (const e of valid) {
      const a = index.get(e.from)!;
      const b = index.get(e.to)!;
      const ddx = px[a] - px[b];
      const ddy = py[a] - py[b];
      const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      const f = d / k;
      dx[a] -= ddx * f; dy[a] -= ddy * f;
      dx[b] += ddx * f; dy[b] += ddy * f;
    }
    for (let i = 0; i < n; i++) {
      // gentle gravity keeps isolated notes on screen
      dx[i] += (size.w / 2 - px[i]) * 0.02 * k / 10;
      dy[i] += (size.h / 2 - py[i]) * 0.02 * k / 10;
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const step = Math.min(d, temp);
      px[i] = px[i] + (dx[i] / d) * step;
      py[i] = py[i] + (dy[i] / d) * step;
    }
    temp = Math.max(1, temp * 0.97);
  }

  // Normalise into the frame with a margin.
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]);
    minY = Math.min(minY, py[i]); maxY = Math.max(maxY, py[i]);
  }
  const m = 60;
  const sx = (size.w - 2 * m) / (maxX - minX || 1);
  const sy = (size.h - 2 * m) / (maxY - minY || 1);
  const s = Math.min(sx, sy);
  const ox = (size.w - (maxX - minX) * s) / 2;
  const oy = (size.h - (maxY - minY) * s) / 2;
  return {
    nodes: nodes.map((nd, i) => ({ ...nd, x: ox + (px[i] - minX) * s, y: oy + (py[i] - minY) * s, degree: degree[i] })),
    edges: valid,
  };
}
