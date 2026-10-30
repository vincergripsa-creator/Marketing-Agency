// Left vertical strip of department colours (click → fly to the island and open its panel).
import type { DeptId } from '../../../shared/types';
import { cx } from './common';
import { useApp } from './context';
import { Icon } from './icons';
import { BUSY_STATUSES, DEFAULT_DEPTS, DEPT_ORDER } from './labels';

export function DeptStrip({ selected, onPick, onOverview }: { selected: DeptId | null; onPick(id: DeptId): void; onOverview(): void }) {
  const { snapshot } = useApp();
  const depts = snapshot?.company?.departments?.length
    ? [...snapshot.company.departments].sort((a, b) => DEPT_ORDER.indexOf(a.id) - DEPT_ORDER.indexOf(b.id))
    : DEPT_ORDER.map((id) => ({ id, ...DEFAULT_DEPTS[id] }));
  const agents = snapshot?.company?.agents ?? [];

  return (
    <nav className="dept-strip glass" aria-label="Départements">
      <button type="button" className="strip-top" onClick={onOverview} title="Vue d’ensemble">
        <Icon name="globe" size={15} />
      </button>
      {depts.map((d) => {
        const members = agents.filter((a) => a.dept === d.id);
        const busy = members.filter((a) => BUSY_STATUSES.has(a.status)).length;
        return (
          <button
            key={d.id}
            type="button"
            className={cx('strip-dot', selected === d.id && 'strip-dot-on')}
            style={{ background: d.color, color: d.color }}
            onClick={() => onPick(d.id)}
            title={`${d.name} · ${members.length} agent${members.length > 1 ? 's' : ''}${busy ? ` · ${busy} au travail` : ''}`}
            aria-label={d.name}
          >
            {busy > 0 ? <span className="strip-busy" /> : null}
          </button>
        );
      })}
    </nav>
  );
}
