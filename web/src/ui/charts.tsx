// Inline SVG charts: one y-axis, 2px lines, rounded bar ends, hairline grid, crosshair tooltip.
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ok } from './format';

export const SERIES = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', violet: '#6250d6', magenta: '#e87ba4' } as const;
export const STATUS = { good: '#0ca30c', critical: '#d03b3b', warning: '#fab219' } as const;

export interface Series { id: string; label: string; color: string; values: (number | null)[]; area?: boolean }

const W = 640;
const PAD = { l: 52, r: 14, t: 14, b: 24 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!ok(min) || !ok(max)) return [0, 1];
  if (min === max) {
    const d = Math.abs(min) || 1;
    min -= d * 0.5;
    max += d * 0.5;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return out;
}

function tipStyle(pct: number) {
  return { left: `${pct}%`, transform: pct < 18 ? 'translateX(-12%)' : pct > 82 ? 'translateX(-88%)' : 'translateX(-50%)' };
}

function useHover() {
  const ref = useRef<SVGSVGElement>(null);
  const [x, setX] = useState<number | null>(null);
  const onMove = (e: ReactPointerEvent<SVGElement>) => {
    const svg = ref.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (r.width === 0) return;
    setX(((e.clientX - r.left) / r.width) * W);
  };
  return { ref, x, onMove, onLeave: () => setX(null) };
}

export function LineChart({ labels, series, height = 200, format = (n) => String(Math.round(n)), zero = true, ariaLabel, emptyText = 'Pas encore de données.' }: {
  labels: string[]; series: Series[]; height?: number; format?(n: number): string; zero?: boolean; ariaLabel: string; emptyText?: string;
}) {
  const H = height;
  const n = labels.length;
  const hover = useHover();
  const geo = useMemo(() => {
    const vals = series.flatMap((s) => s.values.filter(ok));
    if (vals.length === 0 || n === 0) return null;
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (zero) { min = Math.min(0, min); max = Math.max(0, max); }
    const ticks = niceTicks(min, max);
    const lo = ticks[0]!;
    const hi = ticks[ticks.length - 1]!;
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const xAt = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const yAt = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
    const paths = series.map((s) => {
      let d = '';
      let started = false;
      s.values.forEach((v, i) => {
        if (!ok(v)) { started = false; return; }
        d += `${started ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
        started = true;
      });
      const firstIdx = s.values.findIndex(ok);
      const lastIdx = s.values.length - 1 - [...s.values].reverse().findIndex(ok);
      const base = yAt(Math.max(lo, Math.min(hi, 0)));
      const area = s.area && firstIdx >= 0 ? `${d}L${xAt(lastIdx).toFixed(1)},${base.toFixed(1)}L${xAt(firstIdx).toFixed(1)},${base.toFixed(1)}Z` : null;
      return { d, area, lastIdx };
    });
    return { ticks, xAt, yAt, paths, iw, ih, lo, hi };
  }, [series, n, H, zero]);

  if (!geo) return <div className="chart-empty" style={{ height }}>{emptyText}</div>;

  const hi = hover.x === null ? null : Math.max(0, Math.min(n - 1, Math.round(((hover.x - PAD.l) / (geo.iw || 1)) * (n - 1))));
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="chart">
      {series.length >= 2 ? (
        <div className="legend">
          {series.map((s) => <span key={s.id} className="legend-item"><span className="legend-line" style={{ background: s.color }} />{s.label}</span>)}
        </div>
      ) : null}
      <div className="chart-frame">
        <svg ref={hover.ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={ariaLabel}
          onPointerMove={hover.onMove} onPointerLeave={hover.onLeave}>
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={geo.yAt(t)} y2={geo.yAt(t)} className={t === 0 ? 'axis-base' : 'grid'} />
              <text x={PAD.l - 8} y={geo.yAt(t) + 4} className="tick" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % labelEvery === 0 || i === n - 1 ? (
            <text key={`${l}-${i}`} x={geo.xAt(i)} y={H - 6} className="tick" textAnchor="middle">{l}</text>
          ) : null))}
          {series.map((s, si) => {
            const p = geo.paths[si]!;
            const lastV = s.values[p.lastIdx];
            return (
              <g key={s.id}>
                {p.area ? <path d={p.area} fill={s.color} opacity={0.1} /> : null}
                <path d={p.d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {ok(lastV) ? <circle cx={geo.xAt(p.lastIdx)} cy={geo.yAt(lastV)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} /> : null}
              </g>
            );
          })}
          {hi !== null ? (
            <g>
              <line x1={geo.xAt(hi)} x2={geo.xAt(hi)} y1={PAD.t} y2={H - PAD.b} className="crosshair" />
              {series.map((s) => {
                const v = s.values[hi];
                return ok(v) ? <circle key={s.id} cx={geo.xAt(hi)} cy={geo.yAt(v)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} /> : null;
              })}
            </g>
          ) : null}
          <rect x={PAD.l} y={PAD.t} width={geo.iw} height={geo.ih} fill="transparent" />
        </svg>
        {hi !== null ? (
          <div className="chart-tip" style={tipStyle((geo.xAt(hi) / W) * 100)}>
            <div className="tip-title">{labels[hi]}</div>
            {series.map((s) => (
              <div key={s.id} className="tip-row">
                <span className="legend-line" style={{ background: s.color }} />
                <strong>{ok(s.values[hi]) ? format(s.values[hi] as number) : '—'}</strong>
                <span className="muted">{s.label}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Signed column chart (positive = good colour, negative = critical colour). */
export function BarChart({ labels, values, height = 180, format = (n) => String(Math.round(n)), ariaLabel, pos = STATUS.good, neg = STATUS.critical, seriesLabel, emptyText = 'Pas encore de données.' }: {
  labels: string[]; values: number[]; height?: number; format?(n: number): string; ariaLabel: string; pos?: string; neg?: string; seriesLabel: string; emptyText?: string;
}) {
  const H = height;
  const n = values.length;
  const hover = useHover();
  const geo = useMemo(() => {
    const vals = values.filter(ok);
    if (vals.length === 0) return null;
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
    const lo = ticks[0]!;
    const hiV = ticks[ticks.length - 1]!;
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const band = iw / Math.max(1, n);
    const bw = Math.max(2, Math.min(22, band - 2));
    const yAt = (v: number) => PAD.t + ih - ((v - lo) / (hiV - lo || 1)) * ih;
    return { ticks, band, bw, yAt, iw, ih };
  }, [values, n, H]);

  if (!geo) return <div className="chart-empty" style={{ height }}>{emptyText}</div>;
  const hi = hover.x === null ? null : Math.max(0, Math.min(n - 1, Math.floor((hover.x - PAD.l) / geo.band)));
  const y0 = geo.yAt(0);
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  const barPath = (x: number, w: number, v: number) => {
    const y = geo.yAt(v);
    const h = Math.abs(y - y0);
    const r = Math.min(4, w / 2, h);
    if (h < 0.5) return `M${x},${y0}h${w}`;
    if (v >= 0) return `M${x},${y0}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y0}Z`;
    return `M${x},${y0}V${y - r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y - r}V${y0}Z`;
  };

  return (
    <div className="chart">
      <div className="chart-frame">
        <svg ref={hover.ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={ariaLabel}
          onPointerMove={hover.onMove} onPointerLeave={hover.onLeave}>
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={geo.yAt(t)} y2={geo.yAt(t)} className={t === 0 ? 'axis-base' : 'grid'} />
              <text x={PAD.l - 8} y={geo.yAt(t) + 4} className="tick" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {values.map((v, i) => {
            const x = PAD.l + i * geo.band + (geo.band - geo.bw) / 2;
            return ok(v) ? (
              <path key={i} d={barPath(x, geo.bw, v)} fill={v >= 0 ? pos : neg} opacity={hi === null || hi === i ? 1 : 0.55} />
            ) : null;
          })}
          {labels.map((l, i) => (i % labelEvery === 0 || i === n - 1 ? (
            <text key={`${l}-${i}`} x={PAD.l + i * geo.band + geo.band / 2} y={H - 6} className="tick" textAnchor="middle">{l}</text>
          ) : null))}
          <rect x={PAD.l} y={PAD.t} width={geo.iw} height={geo.ih} fill="transparent" />
        </svg>
        {hi !== null && ok(values[hi]) ? (
          <div className="chart-tip" style={tipStyle(((PAD.l + hi * geo.band + geo.band / 2) / W) * 100)}>
            <div className="tip-title">{labels[hi]}</div>
            <div className="tip-row">
              <span className="legend-swatch" style={{ background: (values[hi] ?? 0) >= 0 ? pos : neg }} />
              <strong>{format(values[hi]!)}</strong>
              <span className="muted">{seriesLabel}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Tiny trend line (de-emphasised), last point accented. */
export function Sparkline({ values, color = SERIES.blue, width = 120, height = 34 }: { values: (number | null)[]; color?: string; width?: number; height?: number }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => ok(p[1]));
  if (pts.length < 2) return <svg width={width} height={height} className="spark" aria-hidden="true"><line x1={0} x2={width} y1={height / 2} y2={height / 2} className="grid" /></svg>;
  const min = Math.min(...pts.map((p) => p[1]));
  const max = Math.max(...pts.map((p) => p[1]));
  const n = values.length;
  const x = (i: number) => 3 + (i / Math.max(1, n - 1)) * (width - 6);
  const y = (v: number) => height - 4 - ((v - min) / (max - min || 1)) * (height - 8);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} className="spark" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <circle cx={x(last[0])} cy={y(last[1])} r={3.5} fill={color} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}
