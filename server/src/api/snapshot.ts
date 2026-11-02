import { buildDigest } from '../runtime/digest.js';
import { financeSnapshot } from '../sim/index.js';
import type { CompanySnapshot, CreativeVideo, Deliverable, FinanceSnapshot, FounderDigest, WorldState } from '../shared.js';
import type { SessionRecord } from './persist.js';
import { estimateFinance, fullProduct, serializeLiveSnapshot, serializeSnapshot } from './trim.js';
import { channelsDetail, deliverablesPage, digestPeopleOf, leagueDetail, orgDetail } from './views.js';

/** Sim finance, or a ledger-only estimate if the sim throws (the UI must always get a snapshot). */
export function safeFinance(world: WorldState): FinanceSnapshot {
  try {
    return financeSnapshot(world);
  } catch {
    return estimateFinance(world);
  }
}

/** UI-safe view of the world (no hidden market truth unless `god`), bounded to ~700 KB. */
export function toSnapshot(world: WorldState, god = false): CompanySnapshot {
  return JSON.parse(snapshotJson(world, god)) as CompanySnapshot;
}

/** Same as toSnapshot but already serialised (avoids stringifying twice on hot paths like SSE). */
export function snapshotJson(world: WorldState, god = false, extra: Record<string, unknown> = {}): string {
  return serializeSnapshot(world, safeFinance(world), god, extra);
}

/** The light snapshot pushed on the live stream (see LIVE_LIMITS). */
export function liveSnapshotJson(world: WorldState, god = false, extra: Record<string, unknown> = {}): string {
  return serializeLiveSnapshot(world, safeFinance(world), god, extra);
}

/** The GET routes of the tabs (ui §3): fetched on tab open, never pushed. */
export type ViewName = 'org' | 'league' | 'channels' | 'growth' | 'digest' | 'deliverables' | 'playbook' | 'product';

/** What a view reads outside the world: the session gives the disk's side. */
export interface ViewSources { videos?: Readonly<Record<string, CreativeVideo>>; archived?: readonly Deliverable[]; stays?: readonly SessionRecord[] }

const intOf = (v: string | null): number | undefined => (v !== null && /^\d+$/.test(v) ? Number(v) : undefined);

/** `since` defaults to the last day the founder looked (scale §3.2). Its window is the one `buildDigest` really covers. */
function digestView(world: WorldState, query: URLSearchParams, stays: readonly SessionRecord[]): FounderDigest {
  const since = intOf(query.get('since')) ?? world.company.growth?.founder.lastSeenDay ?? 0;
  const digest = buildDigest(world, since, intOf(query.get('to')) ?? world.day, stays);
  return { ...digest, ...digestPeopleOf(world, digest.fromDay, digest.toDay) };
}

/** One view of the world. Null: nothing by that id. Truth only ever comes through `?god=1`, and only on `league`. */
export function viewOf(world: WorldState, name: ViewName, query: URLSearchParams, sources: ViewSources = {}): unknown {
  switch (name) {
    case 'org': return orgDetail(world);
    case 'league': return leagueDetail(world, query.get('god') === '1' || query.get('god') === 'true');
    case 'channels': return channelsDetail(world);
    case 'growth': return world.company.growth ?? null;
    case 'digest': return digestView(world, query, sources.stays ?? []);
    case 'deliverables': {
      const kinds = query.get('kinds')?.split(',').map((k) => k.trim()).filter(Boolean);
      return deliverablesPage(world, { ...(kinds ? { kinds } : {}), page: intOf(query.get('page')) ?? 1 }, sources.videos, sources.archived);
    }
    case 'playbook': return world.company.playbooks[query.get('agentId') ?? ''] ?? [];
    case 'product': {
      const product = world.company.products.find((p) => p.id === query.get('id'));
      return product ? fullProduct(product) : null;
    }
  }
}
