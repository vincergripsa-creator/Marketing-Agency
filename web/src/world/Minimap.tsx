// "Plan du bureau": mini map of the islands (same effective grid as the world), plaza in the middle,
// working agents as dots, active department outlined, "Vue d'ensemble" button.
import { useMemo, type JSX } from 'react';
import type { CompanySnapshot, DeptDef, DeptId } from '../../../shared/types';
import { effectiveGrid } from './layout';
import { deptColor, shade } from './palette';

export interface MinimapProps {
  snapshot: CompanySnapshot | null;
  selectedDept: DeptId | null;
  onPick(dept: DeptId): void;
  onOverview(): void;
}

const STYLE_ID = 'pa-minimap-style';
const CSS = `
.pa-minimap{box-sizing:border-box;display:inline-flex;flex-direction:column;gap:8px;padding:10px 12px 12px;
  background:rgba(255,255,255,0.85);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
  border-radius:14px;box-shadow:0 8px 28px rgba(44,34,90,0.16),0 1px 0 rgba(255,255,255,0.9) inset;
  border:1px solid rgba(255,255,255,0.7);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#2a2540;
  user-select:none;min-width:190px}
.pa-minimap__head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.pa-minimap__title{font-size:10px;font-weight:700;letter-spacing:.09em;color:#7a7394;text-transform:uppercase}
.pa-minimap__btn{display:inline-flex;align-items:center;gap:5px;border:0;cursor:pointer;font:600 11px Inter,system-ui,sans-serif;
  color:#3b3358;background:rgba(124,108,240,0.1);padding:4px 9px;border-radius:999px;transition:background .15s,transform .15s}
.pa-minimap__btn:hover{background:rgba(124,108,240,0.2)}
.pa-minimap__btn:active{transform:scale(.97)}
.pa-minimap__btn:focus-visible,.pa-minimap__cell:focus-visible,.pa-minimap__plaza:focus-visible{outline:2px solid #7c6cf0;outline-offset:2px}
.pa-minimap__map{position:relative;margin:2px auto 0;border-radius:10px;
  background:radial-gradient(ellipse at 50% 45%,rgba(191,227,255,0.55),rgba(191,227,255,0.12) 70%)}
.pa-minimap__cell{position:absolute;border:0;padding:0;cursor:pointer;border-radius:7px;
  box-shadow:0 2px 0 rgba(0,0,0,0.12),inset 0 1px 0 rgba(255,255,255,0.45);transition:transform .15s,box-shadow .15s}
.pa-minimap__cell:hover{transform:translateY(-1px) scale(1.07);z-index:2}
.pa-minimap__cell[data-active="true"]{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--c),0 4px 12px rgba(0,0,0,0.18);z-index:3}
.pa-minimap__dots{position:absolute;left:0;right:0;bottom:4px;display:flex;justify-content:center;gap:2px}
.pa-minimap__dot{width:3px;height:3px;border-radius:1px;background:#fff;box-shadow:0 0 0 0.5px rgba(0,0,0,0.15)}
.pa-minimap__more{position:absolute;top:2px;right:3px;font:700 7px Inter,system-ui,sans-serif;color:rgba(255,255,255,0.95)}
.pa-minimap__plaza{position:absolute;border:0;padding:0;cursor:pointer;border-radius:50%;
  background:radial-gradient(circle at 38% 35%,#ffe1f8 0,#f08ad8 32%,#8b5cf6 70%,#5b3fb8 100%);
  box-shadow:0 0 0 3px rgba(255,255,255,0.85),0 0 14px rgba(240,138,216,0.75);animation:pa-minimap-pulse 2.4s ease-in-out infinite}
.pa-minimap__plaza[data-active="true"]{box-shadow:0 0 0 2px #fff,0 0 0 4px #7c6cf0,0 0 18px rgba(240,138,216,0.9)}
@keyframes pa-minimap-pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}
@media (prefers-reduced-motion: reduce){.pa-minimap__plaza{animation:none}.pa-minimap__cell{transition:none}}
`;

function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

const BUSY = new Set(['working', 'reviewing', 'meeting', 'thinking']);
const U = 26; // horizontal unit (px) of the iso-like layout
const V = 13; // vertical unit
const CELL = 22;
const PLAZA = 26;

export function Minimap(props: MinimapProps): JSX.Element {
  ensureStyle();
  const { snapshot, selectedDept, onPick, onOverview } = props;
  const departments: DeptDef[] = snapshot?.company.departments ?? [];
  const agents = snapshot?.company.agents ?? [];

  const layout = useMemo(() => {
    const grid = effectiveGrid(departments);
    const items = departments
      .filter((d) => d.id !== 'direction' && grid.has(d.id))
      .map((d) => {
        const g = grid.get(d.id)!;
        return { def: d, x: (g.col - g.row) * U, y: (g.col + g.row) * V };
      });
    let minX = -PLAZA / 2;
    let maxX = PLAZA / 2;
    let minY = -PLAZA / 2;
    let maxY = PLAZA / 2;
    for (const it of items) {
      minX = Math.min(minX, it.x - CELL / 2);
      maxX = Math.max(maxX, it.x + CELL / 2);
      minY = Math.min(minY, it.y - CELL / 2);
      maxY = Math.max(maxY, it.y + CELL / 2);
    }
    return { items, minX, minY, w: Math.ceil(maxX - minX) + 8, h: Math.ceil(maxY - minY) + 8 };
    // departments identity is enough: grid positions only change with the roster
  }, [JSON.stringify(departments.map((d) => [d.id, d.grid?.col, d.grid?.row]))]);

  const stats = useMemo(() => {
    const m = new Map<string, { n: number; busy: number }>();
    const known = new Set(departments.map((d) => d.id as string));
    for (const a of agents) {
      const k = known.has(a.dept) ? a.dept : 'direction';
      const s = m.get(k) ?? { n: 0, busy: 0 };
      s.n++;
      if (BUSY.has(a.status)) s.busy++;
      m.set(k, s);
    }
    return m;
  }, [agents, departments]);

  const dir = departments.find((d) => d.id === 'direction');
  const dirStats = stats.get('direction') ?? { n: 0, busy: 0 };
  const ox = -layout.minX + 4;
  const oy = -layout.minY + 4;

  return (
    <div className="pa-minimap" role="navigation" aria-label="Plan du bureau">
      <div className="pa-minimap__head">
        <span className="pa-minimap__title">Plan du bureau</span>
        <button type="button" className="pa-minimap__btn" onClick={onOverview} title="Revenir à la vue d’ensemble">
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="1" y="1" width="4" height="4" rx="1" fill="currentColor" />
            <rect x="7" y="1" width="4" height="4" rx="1" fill="currentColor" opacity=".6" />
            <rect x="1" y="7" width="4" height="4" rx="1" fill="currentColor" opacity=".6" />
            <rect x="7" y="7" width="4" height="4" rx="1" fill="currentColor" />
          </svg>
          Vue d’ensemble
        </button>
      </div>
      <div className="pa-minimap__map" style={{ width: layout.w, height: layout.h }}>
        {layout.items.map(({ def, x, y }) => {
          const color = deptColor(def.id, def.color);
          const s = stats.get(def.id) ?? { n: 0, busy: 0 };
          const active = selectedDept === def.id;
          const dots = Math.min(4, s.busy);
          return (
            <button
              key={def.id}
              type="button"
              className="pa-minimap__cell"
              data-active={active}
              onClick={() => onPick(def.id)}
              title={`${def.name} — ${s.n} agent${s.n > 1 ? 's' : ''}, ${s.busy} en cours`}
              aria-label={`${def.name} : ${s.n} agent${s.n > 1 ? 's' : ''}, ${s.busy} en cours`}
              aria-pressed={active}
              style={{
                left: ox + x - CELL / 2,
                top: oy + y - CELL / 2,
                width: CELL,
                height: CELL,
                background: `linear-gradient(180deg, ${shade(color, 0.22)} 0%, ${color} 60%, ${shade(color, -0.12)} 100%)`,
                ['--c' as string]: color,
              }}
            >
              {dots > 0 && (
                <span className="pa-minimap__dots">
                  {Array.from({ length: dots }, (_, i) => (
                    <span key={i} className="pa-minimap__dot" />
                  ))}
                </span>
              )}
              {s.busy > 4 && <span className="pa-minimap__more">+{s.busy - 4}</span>}
            </button>
          );
        })}
        <button
          type="button"
          className="pa-minimap__plaza"
          data-active={selectedDept === 'direction'}
          onClick={() => onPick('direction')}
          title={`${dir?.name ?? 'Direction'} · Cerveau · Café — ${dirStats.busy} en cours`}
          aria-label={`Place centrale : ${dir?.name ?? 'Direction'}, Cerveau et café`}
          style={{ left: ox - PLAZA / 2, top: oy - PLAZA / 2, width: PLAZA, height: PLAZA }}
        />
      </div>
    </div>
  );
}
