// Bottom-left live journal: what every agent and the market are doing right now.
import { useMemo, useState } from 'react';
import type { Activity, ActivityKind } from '../../../shared/types';
import { cx, Dot, Segmented } from './common';
import { useApp } from './context';
import { Icon } from './icons';
import { ACTIVITY_META, agentColor, agentName, firstName } from './labels';

type Filter = 'all' | 'work' | 'brain' | 'market';

const FILTER_KINDS: Record<Exclude<Filter, 'all'>, ReadonlySet<ActivityKind>> = {
  work: new Set<ActivityKind>(['task_start', 'task_done', 'task_failed', 'review', 'deliverable', 'delegate', 'thought', 'meeting', 'founder', 'chat']),
  brain: new Set<ActivityKind>(['brain_read', 'brain_write', 'lesson']),
  market: new Set<ActivityKind>(['sale', 'refund', 'ad', 'message', 'event', 'finance']),
};

const QUIET: ReadonlySet<ActivityKind> = new Set<ActivityKind>(['walk']);

export function ActivityFeed() {
  const { activity, lookups, openAgent } = useApp();
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  const items = useMemo(() => {
    const out: Activity[] = [];
    for (let i = activity.length - 1; i >= 0 && out.length < 80; i--) {
      const a = activity[i]!;
      if (filter === 'all' ? QUIET.has(a.kind) : !FILTER_KINDS[filter].has(a.kind)) continue;
      out.push(a);
    }
    return out;
  }, [activity, filter]);

  const last = activity[activity.length - 1];

  return (
    <aside className={cx('feed glass', !open && 'feed-closed')}>
      <button type="button" className="feed-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="live-dot" />
        <strong>Journal</strong>
        <span className="muted small feed-last">{!open && last ? last.text : `${activity.length} événements`}</span>
        <Icon name={open ? 'chevronDown' : 'chevronUp'} size={14} />
      </button>
      {open ? (
        <>
          <div className="feed-filters">
            <Segmented<Filter> size="sm" value={filter} onChange={setFilter} options={[
              { id: 'all', label: 'Tout' },
              { id: 'work', label: 'Travail' },
              { id: 'brain', label: 'Cerveau' },
              { id: 'market', label: 'Marché' },
            ]} />
          </div>
          <ol className="feed-list">
            {items.length === 0 ? <li className="feed-empty">Rien à signaler pour l’instant.</li> : null}
            {items.map((a) => {
              const meta = ACTIVITY_META[a.kind] ?? ACTIVITY_META.thought;
              const color = agentColor(lookups, a.agentId);
              const clickable = !!a.agentId && lookups.agents.has(a.agentId);
              return (
                <li key={a.id}>
                  <button type="button" className={cx('feed-item', `feed-${a.kind}`)} disabled={!clickable}
                    onClick={() => a.agentId && openAgent(a.agentId)} title={clickable ? `Voir ${agentName(lookups, a.agentId)}` : undefined}>
                    <span className="feed-icon"><Icon name={meta.icon} size={13} /></span>
                    <span className="feed-text">
                      {a.agentId ? (
                        <span className="feed-who"><Dot color={color} size={7} />{firstName(agentName(lookups, a.agentId))}
                          {a.toAgentId ? <> <Icon name="arrowRight" size={10} /> {firstName(agentName(lookups, a.toAgentId))}</> : null}
                        </span>
                      ) : null}
                      <span className="feed-msg">{a.text}</span>
                    </span>
                    <span className="feed-time">J{a.day}·{a.tick}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </aside>
  );
}
