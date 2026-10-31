// Bottom-left live journal: what every agent and the market are doing right now.
import { useMemo, useState } from 'react';
import type { Activity, ActivityKind, ChronicleEntry } from '../../../shared/types';
import { cx, Dot, Segmented } from './common';
import { useApp } from './context';
import { activityProductId } from './derive';
import { Icon } from './icons';
import { ACTIVITY_META, agentColor, agentName, firstName, type Lookups } from './labels';

type Filter = 'all' | 'work' | 'brain' | 'market' | 'team';

const FILTER_KINDS: Record<Exclude<Filter, 'all' | 'team'>, ReadonlySet<ActivityKind>> = {
  work: new Set<ActivityKind>(['task_start', 'task_done', 'task_failed', 'review', 'deliverable', 'delegate', 'thought', 'meeting', 'founder', 'chat']),
  brain: new Set<ActivityKind>(['brain_read', 'brain_write', 'lesson']),
  market: new Set<ActivityKind>(['sale', 'refund', 'ad', 'message', 'event', 'finance']),
};

const QUIET: ReadonlySet<ActivityKind> = new Set<ActivityKind>(['walk']);

/** A line about the team: kind `org`, or what the chronicle holds told at a meeting. The league speaks in `meeting` and `review` lines (talent §9.1). */
export function teamLine(a: Activity, recent: readonly ChronicleEntry[], l: Lookups): boolean {
  if (a.kind === 'org') return true;
  return recent.some((e) => {
    if (e.kind === 'season_end') return a.text.includes(`saison ${e.numbers?.season} close`);
    if (e.otherId) return a.text.includes(agentName(l, e.agentId)) && a.text.includes(agentName(l, e.otherId));
    return a.text.includes(e.text) || (!!e.why && a.text.includes(e.why));
  });
}

export function ActivityFeed() {
  const { activity, lookups, openAgent, openProduct, snapshot } = useApp();
  const events = snapshot?.market?.events;
  const recent = snapshot?.scene?.recent;
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  const items = useMemo(() => {
    const shown = (a: Activity): boolean => {
      if (filter === 'all') return !QUIET.has(a.kind);
      return filter === 'team' ? teamLine(a, recent ?? [], lookups) : FILTER_KINDS[filter].has(a.kind);
    };
    const out: Activity[] = [];
    for (let i = activity.length - 1; i >= 0 && out.length < 80; i--) {
      const a = activity[i]!;
      if (shown(a)) out.push(a);
    }
    return out;
  }, [activity, filter, recent, lookups]);

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
              { id: 'team', label: 'Équipe' },
            ]} />
          </div>
          <ol className="feed-list">
            {items.length === 0 ? <li className="feed-empty">Rien à signaler pour l’instant.</li> : null}
            {items.map((a) => {
              const meta = ACTIVITY_META[a.kind] ?? ACTIVITY_META.thought;
              const color = agentColor(lookups, a.agentId);
              // someone who left keeps a card: AgentPanel reads the alumni
              const agentOk = !!a.agentId && (lookups.agents.has(a.agentId) || lookups.names.has(a.agentId));
              // market lines (events, ad reviews…) about a product open the Produits tab on that product
              const pid = a.kind === 'event' || !agentOk ? activityProductId(a, events) : null;
              const product = pid ? lookups.products.get(pid) : undefined;
              const clickable = !!product || agentOk;
              return (
                <li key={a.id}>
                  <button type="button" className={cx('feed-item', `feed-${a.kind}`, product && 'feed-has-product')} disabled={!clickable}
                    onClick={() => (product ? openProduct(product.id) : a.agentId && openAgent(a.agentId))}
                    title={product ? `Voir le produit « ${product.title} »` : agentOk ? `Voir ${agentName(lookups, a.agentId)}` : undefined}>
                    <span className="feed-icon"><Icon name={meta.icon} size={13} /></span>
                    <span className="feed-text">
                      {a.agentId ? (
                        <span className="feed-who"><Dot color={color} size={7} />{firstName(agentName(lookups, a.agentId))}
                          {a.toAgentId ? <> <Icon name="arrowRight" size={10} /> {firstName(agentName(lookups, a.toAgentId))}</> : null}
                        </span>
                      ) : null}
                      <span className="feed-msg">{a.text}</span>
                      {product ? <span className="feed-product"><Icon name="package" size={10} /> Voir le produit</span> : null}
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
