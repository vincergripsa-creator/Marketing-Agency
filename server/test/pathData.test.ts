/**
 * Path data written shorter for the files of a run: every point where it was, read here by a parser of its own, on random
 * paths and on the real drawings; what it does not read stays as it came.
 */
import { describe, expect, it } from 'vitest';
import { compactPathData, compactPaths } from '../src/deliverables/pathData.js';
import { renderCoverSvg } from '../src/deliverables/cover.js';
import { designFor } from '../src/deliverables/design.js';

/** The absolute points of every segment, H and V as lines: what a renderer draws, whatever the letters. */
function points(d: string): string[] {
  const tokens = d.match(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const arity: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, z: 0 };
  const out: string[] = [];
  let x = 0, y = 0, x0 = 0, y0 = 0, cmd = '';
  const r = (v: number): string => (Math.round(v * 1e4) / 1e4).toFixed(4);
  for (let i = 0; i < tokens.length;) {
    if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    const lower = cmd.toLowerCase();
    const rel = cmd === lower;
    if (lower === 'z') { out.push('Z'); x = x0; y = y0; continue; }
    const a = tokens.slice(i, i + arity[lower]!).map(Number);
    i += arity[lower]!;
    if (lower === 'h') { x = rel ? x + a[0]! : a[0]!; out.push(`L${r(x)},${r(y)}`); continue; }
    if (lower === 'v') { y = rel ? y + a[0]! : a[0]!; out.push(`L${r(x)},${r(y)}`); continue; }
    const p: number[] = a.map((v, k) => (rel ? v + (k % 2 ? y : x) : v));
    out.push(`${lower === 'm' ? 'M' : lower === 'l' ? 'L' : lower.toUpperCase()}${p.map(r).join(',')}`);
    x = p[p.length - 2]!; y = p[p.length - 1]!;
    if (lower === 'm') { x0 = x; y0 = y; }
  }
  return out;
}

/** A seeded path of every command, absolute and relative, with repeats, closes and dots; whole numbers or two decimals. */
function randomPath(seed: number, decimals: 0 | 2): string {
  let s = seed;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const n = (): string => String(Math.round((rnd() * 1200 - 600) * 10 ** decimals) / 10 ** decimals);
  let d = `M${n()} ${n()}`;
  for (let k = 0; k < 60; k++) {
    const c = 'MLHVCSQTZmlhvcsqtz'[Math.floor(rnd() * 18)]!;
    const args = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, z: 0 }[c.toLowerCase() as 'm']!;
    if (!args) { d += c; d += `M${n()} ${n()}`; continue; }
    d += c + Array.from({ length: args * (1 + Math.floor(rnd() * 2)) }, n).join(rnd() < 0.5 ? ' ' : ',');
    if (rnd() < 0.1) d += decimals ? 'h0.01' : 'h1';
  }
  return d;
}

describe('compactPathData', () => {
  it('keeps every point of 400 random paths, never longer, and reads its own output the same', () => {
    for (const decimals of [0, 2] as const) {
      for (let seed = 1; seed <= 200; seed++) {
        const d = randomPath(seed, decimals);
        const out = compactPathData(d);
        expect(points(out), `seed ${seed}`).toEqual(points(d));
        expect(out.length).toBeLessThanOrEqual(d.length);
        expect(compactPathData(out)).toBe(out);
      }
    }
  });

  it('writes the short forms: relative steps, H and V, implicit letters, no needless separator', () => {
    expect(compactPathData('M10 10L20 10L20 20L10 20Z')).toBe('M10 10H20V20H10z');
    expect(compactPathData('M0 0L1 2L3 4')).toBe('M0 0 1 2 3 4');
    expect(compactPathData('M500 500c1 1 2 2 3 3c1 1 2 2 3 3')).toBe('M500 500c1 1 2 2 3 3 1 1 2 2 3 3');
    expect(compactPathData('M100.5 100.5L100.75 100.25')).toBe('M100.5 100.5l.25-.25');
    expect(compactPathData('M0.5 -0.25l0.1 0.2')).toBe('M.5-.25l.1.2');
    expect(compactPathData('M11 11h0.01M33 11h0.01')).toBe('M11 11h.01M33 11h.01');
  });

  it('leaves what it does not read as it came: arcs, exponents, broken data', () => {
    for (const d of ['M0 0A5 5 0 0 1 10 10', 'M1e-7 0L1 1', 'M0 0L1', 'L1 1', '1 2 3', 'M0 0L1.123456 2', 'M0 0Z 1 1']) expect(compactPathData(d)).toBe(d);
  });

  it('shortens a real cover by a quarter at least and changes nothing but path data', () => {
    const svg = renderCoverSvg({ title: 'Chiot propre en 21 jours : la méthode', subtitle: 'Le plan heure par heure', audience: 'Nouveaux maîtres', design: designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed: 11 }), brand: 'Pixel Agency' });
    const out = compactPaths(svg);
    expect(out.length).toBeLessThan(svg.length * 0.75);
    const strip = (s: string): string => s.replace(/(<path\b[^>]*?\sd=")[^"]*"/g, '$1"');
    expect(strip(out)).toBe(strip(svg));
    const ds = (s: string): string[] => [...s.matchAll(/<path\b[^>]*?\sd="([^"]*)"/g)].map((m) => m[1]!);
    const before = ds(svg);
    const after = ds(out);
    expect(after).toHaveLength(before.length);
    before.forEach((d, i) => expect(points(after[i]!)).toEqual(points(d)));
  });
});
