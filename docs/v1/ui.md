# Pillar: pixel office and interface

Spec for the part of v1 that shows the living company. Everything here is read-only over the simulation: no new random draw, no ledger line, no world mutation except the append-only chronicle that other pillars feed.

Measured for this spec, not guessed:

| Fact | Value | How |
|---|---|---|
| Live snapshot today, day 61, `legacy31` team | **530 655 bytes, already over the 0,5 MB target** | `serializeLiveSnapshot` logic on `runs/cfx-full-112/world.json` |
| Biggest live fields | creatives 76 KB, tasks 60, products 57, inbox 44, playbooks 38, deliverables 31, lessons 30, adStats 26, agents 24 | same |
| One agent in JSON | 793 bytes | same |
| Effective grid today (declared grid is NOT what is drawn) | recherche (-1,0), studio (-1,-1), creation (0,-1), partenariats (1,-1), growth (2,-1), boutique (1,0), support (1,1), finance (-1,1), rh (-2,1), analyse (-2,2) | `effectiveGrid(DEPARTMENTS)` |
| Plaza's `y+` side | free: cell (0,1) is empty | same |
| Island sizes today | 8 or 9 tiles | `islandSizeFor` with the real roster |
| Desks by island size with all 4 gates reserved | 8:2, 9:6, 10:12, 11:15, 12:21, 13:26, 14:31 | `deskSlots` probe |
| `/runs/...` file route | no `Range` support, no `.mp4` MIME type (falls to `octet-stream` + `nosniff`) | `server/src/api/http.ts`, `server.ts` |

Aligned with `org.md`, `talent.md`, `channels.md` and `scale.md`, read once they came out. Taken as is: the lean team and vacant plots, `talentTruth`, the field mapping of talent.md §9.0, `ChannelId` and the attribution rows, `FounderDigest`, `/api/digest`, `/api/growth`, `/api/deliverables`, the four stages. Where two siblings clash, section 7 says so. Scale also measured the live snapshot at 618 kB on D120, which raises the stakes on size.

Four defects in the current code that this pillar has to fix or the rest cannot work:

1. `layoutKeyOf` hashes every agent id, so **one hire rebuilds the whole world and teleports all agents**.
2. `buildDeptIsland` gives desks by position in the team, so **firing one agent moves everyone behind them to another desk**.
3. `AgentSim.sync` deletes an agent the moment it leaves the snapshot, so **a fired agent cannot walk out**, and spawns new ones in the middle of the fountain.
4. `lookups.agents` only knows current agents, so **every old task signed by a fired agent prints a raw id**.

---

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | `chronicleOf(world)` merges the logs the other pillars already keep into one derived list. World, toasts and tabs read it | No fourth log to write. Replay-safe by a stable `key`. Survives reconnect |
| D2 | **No new SSE event type.** The world reads `snapshot.scene`, idempotent by `key` | A missed SSE frame cannot lose a firing. Reconnect needs no special case |
| D3 | Live snapshot carries `scene` (about 20 KB). Everything a tab shows in detail comes from a GET fetched on tab open and on day change | The stream is replaced every second, so it must stay small |
| D4 | Live snapshot is cut by about 150 KB first, with a hard budget of 500 000 bytes and a tighter fallback | It is already over budget before adding anything |
| D5 | `AgentState.desk` is a persisted integer set by `syncDesks`. The client derives a desk from team order only on a save that has none | Stable across reloads, browsers, hires, fires |
| D6 | Layout key no longer contains agents. A hire or a fire rebuilds nothing. All desks of the tier are baked, hidden until used | Rebuild is a hitch; hires must be free |
| D7 | Islands grow by tier (9, 10, 12, 14 tiles) and never shrink (`DeptDef.deskHigh` is monotonic). A tier change reflows the map with a 350 ms canvas dissolve | Fixed pitch was the alternative, it makes the map 32 % wider (60 to 79 tiles) |
| D8 | All 13 departments have a fixed, connected cell. A closed one is a vacant plot until it opens | Today's greedy repair moves other islands when one is added. Org asks the same |
| D9 | A new non-department island, **l'Accueil**, sits on the free cell (0,1): arrivals dock, departures dock, candidates' bench, interview room | The only place that gives a one-way road in and out of the map |
| D10 | Podium and trophy wall in the bottom corner of the plaza, league board and duel table in the left corner, channel totems on the two front edges, stage arch on the path to the Accueil | Those two corners are the only free space, nothing walks through them |
| D11 | League board and totems are screen-facing billboards, like `signProp`, not skewed iso faces | A skewed 2,4-tile face fits 6 characters of the 5×7 font. A billboard fits 13 |
| D12 | Fourteen tabs (Croissance is asked by scale, Canaux and Effectif by the founder) do not fit: ten primary, four behind « Plus ». Letters for the four, `d` for the digest | The bar already scrolls below 1 600 px |
| D13 | PDF flip uses `pdfjs-dist@4.10.38` lazy-loaded in the browser. Nothing on the server | No native dependency, no poppler, works on a new machine, not in the main bundle |
| D14 | Video player is a native `<video>` with custom controls. Falls back to the existing HTML preview when no video file exists | The no-ffmpeg machine still shows something real |
| D15 | Hidden talent never sits on `AgentState` nor in `company`. `trimCompany` copies `agents` raw, so anything on an agent leaks | Same rule as `NicheTruth` |
| D16 | Fake mastery bars in the agent card are removed, replaced by `SkillRating` where it exists | They are `level + hash`, a label with no meaning |
| D17 | Digest data is scale's. This pillar draws it, adds the people and channel lines from the chronicle, and keeps « last seen » moving while he watches | His stated use case: he leaves for hours. Two digests would disagree |

---

## 2. Shared types

All in `shared/types.ts`. All new snapshot fields are optional: old saves, the mock and the demo mode keep working.

### 2.1 Stored state

This pillar stores almost nothing. Two fields, written by one pure function:

```ts
// AgentState: addition. Named desk because talent.md already uses « seat » for AgentId.
desk?: number;        // stable desk index inside the department, 0 = chief

// DeptDef: addition
deskHigh?: number;    // highest desk index + 1 ever used, never goes down

// Deliverable['kind']: one addition
| 'ad_video'
```

`ActivityKind` gains nothing here: org adds `org`, talent reuses existing kinds, and the feed filter « Équipe » reads those.

`server/src/runtime/desks.ts`, called at the end of `Company.step()`. No random draw, no ledger line, idempotent:

```ts
export function syncDesks(world: WorldState): void {
  // for each department, in company.agents order:
  // 1. an agent whose desk is taken by a colleague, or who changed department, loses it
  // 2. the chief gets desk 0; whoever held it takes the chief's old desk
  // 3. an agent without a desk takes the lowest free index
  // 4. deskHigh = max(deskHigh ?? 0, highest desk + 1)
}
```

It covers both ways a person leaves: org removes the id (the desk frees up), talent keeps the id and changes the person (the desk stays). It also migrates old saves on their first tick.

### 2.1 bis The chronicle is derived, not stored

The other pillars each already log what happened: `org.decisions`, `league.hires`, `league.duels`, `league.seasons`, `growth.decisions`, `channels`. A fourth log would have to be written by three pillars and could disagree with them. So it is a pure read.

```ts
export interface PersonCard { id: AgentId; name: string; role: string; dept: DeptId; avatar: AvatarSpec }

export type ChronicleKind =
  | 'hire' | 'fire' | 'resign' | 'promote' | 'probation'
  | 'duel_open' | 'duel_end' | 'season_end'
  | 'channel_open' | 'channel_close'
  | 'dept_open' | 'dept_close'
  | 'stage_up' | 'stage_down'
  | 'req_open' | 'req_filled';

export interface ChronicleEntry {
  key: string;              // stable: 'org:<decision id>', 'hire:<day>:<seat>', 'duel:<id>:end', 'season:<n>', 'stage:<day>'…
  day: number;
  kind: ChronicleKind;
  text: string;             // French, one line
  why?: string;             // French, with the numbers
  agentId?: AgentId | null; // the seat
  otherId?: AgentId | null; // duel opponent
  person?: PersonCard;      // who left, or who arrived
  dept?: DeptId | null;
  channel?: string | null;
  numbers?: Record<string, number>; // ratingDeltaA, ratingDeltaB, season, stage
}
```

`server/src/api/chronicle.ts`:

```ts
/** Merges the pillars' logs, oldest first. Pure. */
export function chronicleOf(world: WorldState, fromDay = 0): ChronicleEntry[];
```

| Kind | Read from |
|---|---|
| `hire` | `org.decisions` kind `hire`; `league.hires` with `hired` not null |
| `fire`, `resign` | `org.decisions` kinds `leave`, `layoff` with `org.alumni`; `league.hires` with `league.people[left]` |
| `promote` | `org.decisions` kind `chief`; `SeasonReport.promotions` |
| `probation` | `league.plans` with outcome `open` |
| `duel_open`, `duel_end` | `league.duels`, status `running`, `settled` |
| `season_end` | `league.seasons` |
| `channel_open`, `channel_close` | `channels.open`, `market.channelAccounts` (`openDay`, `banned`) |
| `dept_open`, `dept_close` | `org.decisions` |
| `stage_up`, `stage_down` | `growth.decisions` kind `stage` |
| `req_open`, `req_filled` | `org.positions` |

Missing sources yield nothing, so this works before any pillar lands.

### 2.2 The live scene

```ts
export interface PersonChip {
  rating: number;           // observed, par 1500. Seats outside the league have no entry
  rank: number; of: number; // inside the role league
  delta7d: number;
  contract: 'trial' | 'active' | 'probation' | 'notice';
  badge: 'champion' | 'podium' | 'new' | 'probation' | null;
}
export interface BoardRow { agentId: AgentId; name: string; rating: number; delta7d: number }
export interface PodiumView {
  season: number;
  places: { place: 1 | 2 | 3; person: PersonCard; score: number; gone: boolean }[];
  cups: { season: number; name: string }[]; // last 8 champions, oldest first
}
export interface DuelChip { id: string; a: AgentId; b: AgentId; label: string; endDay: number }
export interface CandidateChip {
  id: string; name: string; role: string; dept: DeptId; avatar: AvatarSpec;
  stage: 'waiting' | 'interview'; interviewerId: AgentId | null;
}
export type ChannelState = 'closed' | 'verifying' | 'open' | 'banned';   // ChannelStatus.state of channels.md
export interface ChannelChip { id: ChannelId; name: string; glyph: string; color: string; state: ChannelState; share: number }
/** company.growth seen from the world: level 0..3 for survie, adequation, acceleration, portefeuille. */
export interface StageView {
  level: number; total: 4; id: StageId; name: string; sinceDay: number; headcount: number;
  gate: GateProgress | null;  // scale.md §4.1
}

/** What the pixel world stages. Everything in it is already public. About 20 KB at 60 agents. */
export interface SceneView {
  people: Record<AgentId, PersonChip>;
  board: BoardRow[];                  // top 5 across roles, for the plaza board
  podium: PodiumView | null;
  duels: DuelChip[];                  // open, at most 6
  candidates: CandidateChip[];        // at most 6
  recent: ChronicleEntry[];           // last 24
  channels: ChannelChip[];            // verifying, open, banned; never closed
  stage: StageView;
  team: { headcount: number; payroll30d: number; revenuePerHead30d: number };
  openSeats: Partial<Record<DeptId, number>>;
  names: Record<AgentId, string>;     // people who left, at most 200, so old tasks print a name
}

// CompanySnapshot: additions
scene?: SceneView;
godMode?: { /* existing */ talent?: Record<AgentId, TalentTruthView> };

export interface TalentTruthView { truth: number; note: string } // talent.md §9.0
```

### 2.3 Detail views, one GET each

```ts
export interface HeadRow {
  agentId: AgentId; name: string; role: string; avatar: AvatarSpec; isChief: boolean; tier: ModelTier;
  contract: PersonChip['contract']; hiredDay: number; desk: number; rating: number | null; hats: TaskKind[];
  cost30d: number;                 // ledger, refs 'salary:<id>' and compute, last 30 closed days
  output30d: number;               // validated tasks
  costPerOutput: number | null;
}
export interface OrgDept {
  id: DeptId; name: string; color: string; chiefId: AgentId | null;
  headcount: number; cost30d: number; load: number; openReqs: number; heads: HeadRow[];
}
export interface HiringReqView {
  id: string; dept: DeptId; role: string;
  why: string;                     // French, with the number that triggered it
  status: 'open' | 'interviews' | 'trial' | 'filled' | 'frozen';
  openedDay: number; budget30d: number; blockedBy: string | null;
  candidates: { name: string; score: number; source: string }[];
}
export interface OrgDetail {
  stage: StageView;
  headcount: number; cost30d: number; costPerHead30d: number; revenuePerHead30d: number; profitPerHead30d: number;
  depts: OrgDept[]; closed: { id: DeptId; name: string; hostedBy: DeptId | null }[];
  reqs: HiringReqView[]; pressure: RolePressure[]; lastRefusal: ChronicleEntry | null;
  decisions: ChronicleEntry[];     // hire, fire, req_open, dept_open, last 30
  history: { day: number; headcount: number; cost7d: number }[];
}

export interface LeagueRow {
  agentId: AgentId; name: string; role: string; dept: DeptId; avatar: AvatarSpec;
  rank: number; rankDelta: number; rating: number; delta7d: number; spark: number[];
  form: ('V' | 'N' | 'D')[];       // last 5 duels or weeks
  points: number; sample: number; confidence: 'faible' | 'moyenne' | 'forte';
  contract: PersonChip['contract'];
}
export interface DuelSide { agentId: AgentId; name: string; score: number | null; ratingDelta: number | null }
export interface DuelView {
  id: string; label: string; metric: string; a: DuelSide; b: DuelSide;
  startedDay: number; endDay: number; winnerId: AgentId | null; status: 'open' | 'done' | 'void';
}
export interface AlumnusView {
  person: PersonCard; hiredDay: number; leftDay: number;
  kind: 'fired' | 'resigned' | 'merged'; why: string;
  bestRating: number; titles: number; tasksDone: number; cost: number;
  replacedBy: { id: AgentId; name: string } | null;
}
export interface LeagueDetail {
  season: { no: number; fromDay: number; toDay: number; daysLeft: number; rules: string[] };
  roles: { key: Skill; label: string; rows: LeagueRow[]; cutLine: number | null }[]; // cutLine: rank under which a contract is at risk
  plans: ProbationPlan[];
  lastHire: HireReport | null;
  duels: DuelView[];
  transfers: ChronicleEntry[];     // hire, fire, resign, promote, demote, transfer, last 100
  hallOfFame: { season: number; champion: PersonCard; score: number; still: boolean; second: PersonCard | null; third: PersonCard | null }[];
  alumni: AlumnusView[];
  god?: Record<AgentId, TalentTruthView>; // only with ?god=1
}

export interface ChannelRow extends ChannelChip {
  spend7d: number; spend30d: number; budget: number;
  claimedRevenue7d: number; shopRevenue7d: number; reconciledRevenue7d: number;
  claimedRoas7d: number | null; shopRoas7d: number | null; reconciledRoas7d: number | null; marginalRoas: number | null;
  inflation: number | null;        // claimed / shop
  budgetCap: number; cpm: number; ctr: number; cvr: number; impressions7d: number;
  creatives: number; fatigue: number; strikes: number;
  unlock: { label: string; value: number; target: number; unit: string; met: boolean }[];
  why: string;                     // French: why it is in this status
  daily: { day: number; spend: number; claimed: number; reconciled: number }[]; // last 30
}
export interface ChannelsDetail {
  rows: ChannelRow[];
  totals: { spend7d: number; reconciledRevenue7d: number; reconciledRoas7d: number | null };
  plan: ChannelPlan | null;
  matrix: ChannelNicheState[];
}

```

`FounderDigest` is scale.md §3.1, unchanged. Three additions asked of it, all read-only:

```ts
// FounderDigest: additions, filled by digestPeopleOf(world, fromDay, toDay) in api/views.ts
people: { hires: number; fires: number; resigns: number; promotions: number; headFrom: number; headTo: number };
channels: { opened: string[]; closed: string[]; best: { id: string; name: string; reconciledRoas: number } | null };
highlights: ChronicleEntry[];   // at most 12, ranked as in section 3.2
// company.growth in the snapshot: also 'founder', so the client can test digestDue
```

### 2.4 Pure world helpers, `shared/worldgrid.ts`

The department catalog is closed: 13 departments, 8 open on day 1 (org.md D2). So every department gets a fixed cell from the start, open or not, as org.md asks.

```ts
export const PIER_CELL = { col: 0, row: 1 } as const;

export const ISLAND_TIERS = [
  { size: 9, seats: 6 }, { size: 10, seats: 12 }, { size: 12, seats: 21 }, { size: 14, seats: 31 },
] as const;

export function tierFor(seatsNeeded: number): (typeof ISLAND_TIERS)[number] {
  return ISLAND_TIERS.find((t) => t.seats >= seatsNeeded) ?? ISLAND_TIERS[ISLAND_TIERS.length - 1]!;
}
```

`roster.ts` `DEPARTMENTS[].grid`, replaced so that the grid is connected and `effectiveGrid` becomes a no-op:

| Dept | Cell | Dept | Cell |
|---|---|---|---|
| recherche | (-1,0) | support | (1,1) |
| studio | (-1,-1) | finance | (-1,1) |
| creation | (0,-1) | rh | (-2,1) |
| partenariats | (1,-1) | analyse | (-2,2) |
| growth | (2,-1) | **video** | (0,-2) |
| boutique | (1,0) | **crm** | (2,0) |

The first eleven are today's drawn cells, so the map stays recognisable. This replaces the (-3,-3) and (3,3) suggested in org.md §13: those two touch nothing, so `effectiveGrid` would move them.

`layout.ts` runs `effectiveGrid` on `[...company.departments, ...company.org.closedDepts]`. A closed department is a vacant plot: same cell, tier 1, no desks, sign `À LOUER`, lights off. It goes back to a plot if the department closes. Cell (0,2) stays empty: the balloon flies through it.

---

## 3. What travels where

| Channel | Carries | Size target | Cadence |
|---|---|---|---|
| SSE `tick` | unchanged: clock, finance, `LiveAgent[]` | 7 KB at 60 agents | every tick |
| SSE `activity` | unchanged, plus kind `equipe` | small | 250 ms batches |
| SSE `snapshot` (LIVE) | company trimmed, `scene` | **≤ 500 000 bytes, enforced** | at most 1 per second, at once on a new day |
| `GET /api/state` | DEFAULT limits, `scene`, the 30 films the stream carries (D155) | ≤ 700 000 | on demand |
| `GET /api/org` | `OrgDetail` | 40 KB | tab open, then each new day |
| `GET /api/league` (`?god=1`) | `LeagueDetail` | 80 KB | same |
| `GET /api/channels` | `ChannelsDetail` | 20 KB | same |
| `GET /api/deliverables?page=&kinds=` | scale's endpoint, plus a `kinds` filter so the gallery asks `pdf,cover,ad_video,ad_preview,sales_page`, no notes | 60 KB | same |
| `GET /api/growth` | scale's: all weeks and kept decisions | 20 KB | Croissance tab |
| `GET /api/digest`, `POST /api/digest/seen` | scale's | 10 KB | on return or `d` |
| `GET /api/playbook?agentId=` | `string[]` | 3 KB | agent panel, Playbook tab |

Decision on the SSE `tick`: nothing added. A new chronicle entry could force an immediate snapshot, but at ×1 a snapshot already follows within a second, and at ×8 forcing one per entry is what the throttle exists to stop.

Not in the live stream, whatever their specs suggest: `company.org`, `company.league`, `company.channels`. `trimCompany` is an allow-list, so leaving them out is the default. `/api/state` does not carry them either: each has its route.

### 3.1 Live cuts in `server/src/api/trim.ts`

```ts
export const LIVE_LIMITS: SnapshotLimits = {
  ...TIGHT_LIMITS, activity: 60, reviewsPerProduct: 5, live: true,
  creatives: 30, doneTasks: 40, deliverables: 60, lessons: 30, inbox: 30, commentsPerStat: 1,
};
export const LIVE_TIGHT_LIMITS: SnapshotLimits = {
  ...LIVE_LIMITS, creatives: 15, doneTasks: 20, deliverables: 30, lessons: 15, inbox: 20, adStatsDays: 3, kpis: 60, activity: 40,
};
export const LIVE_BUDGET_BYTES = 500_000;

export function serializeLiveSnapshot(world, finance, god = false, extra = {}) {
  let json = '';
  for (const limits of [LIVE_LIMITS, LIVE_TIGHT_LIMITS]) {
    json = JSON.stringify({ ...buildSnapshot(world, finance, god, limits), ...extra });
    if (json.length <= LIVE_BUDGET_BYTES) break;
  }
  return json;
}
```

Changes under `limits.live` in `trimCompany`:

| Field | Live behaviour | Saved (measured base 530 KB) |
|---|---|---|
| `playbooks` | `{}`, the panel fetches `/api/playbook` | 38 KB |
| `products` | every `live` product plus the 12 latest others (scale.md §7); `paused` and `killed` reduced by `stubProduct()` to id, title, status, nicheId, price, stats without reviews, decision; `priceHistory` last 14 | 25 KB today, and it removes the unbounded growth (3 KB per product) |
| `creatives` | 30 + those of running campaigns | 40 KB |
| tasks, deliverables, lessons, inbox, comments | see limits | 55 KB |

Estimate at D60: 530 − 158 + 20 (scene) + 40 (`company.growth`, scale.md §8) + 24 (30 more agents) ≈ **456 KB**. Past that, the growing parts are bounded or fall to `LIVE_TIGHT_LIMITS`. Scale's 400 kB is its target for D365 after compaction; the 500 000 here is the hard wall, tested.

`AgentPanel` is the only reader of `company.playbooks` (checked), so that cut touches one component.

Watch out: the working tree's new `trimDeliverables` cuts only ad frames, so non-ad deliverables are now unbounded in the live view. Live also needs a cap on them: 120, newest first. The gallery does not depend on it, it reads `/api/deliverables`.

Trimmed lists must not read as totals, so the snapshot gains server counts, built like `taskStats`:

```ts
counts?: { creatives: number; deliverables: number; lessons: number; messages: number; products: number };
```

AdsTab, GalleryTab and LearningTab print `counts` in their titles, so a trimmed list never reads as the real total.

### 3.2 Server files

`server/src/api/views.ts` (new, this pillar). Pure reads of `world`. Each tolerates a pillar that has not landed yet: empty arrays, and a stage of level 0 when `company.growth` is absent, so the UI can ship first.

```ts
export function sceneOf(world: WorldState): SceneView;
export function orgDetail(world: WorldState): OrgDetail;
export function leagueDetail(world: WorldState, god: boolean): LeagueDetail;
export function channelsDetail(world: WorldState): ChannelsDetail;
export function digestPeopleOf(world: WorldState, fromDay: number, toDay: number): Pick<FounderDigest, 'people' | 'channels' | 'highlights'>;
```

`buildSnapshot` adds `scene: sceneOf(world)` and `counts`. `godModeOf` adds `talent`. `SessionLike` gains `view(name, query)`; `unavailableSession` fails on it like the rest.

`highlights` ranking by kind weight: `stage_up` 100, `season_end` 90, `dept_open` 80, `channel_open` 70, `fire` 60, `hire` 50, `channel_close` 50, `promote` 40, `duel_end` 10. Then newest first, 12 kept, and no more than 3 of a kind.

### 3.3 File serving

`server/src/api/http.ts`, `MIME` additions: `.mp4 video/mp4`, `.webm video/webm`, `.vtt text/vtt; charset=utf-8`, `.m4a audio/mp4`, `.mp3 audio/mpeg`, `.wav audio/wav`.

`serveFile` in `server.ts` gains ranges, or `<video>` cannot seek:

```ts
headers['Accept-Ranges'] = 'bytes';
const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
if (m && (m[1] || m[2])) {
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return true; }
  res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  return true;
}
```

Warning for the talent pillar: the `/runs/<id>/` route serves everything except `world.json`. Truth stored in any other file of the run folder is public.

### 3.4 Hidden talent

- Truth lives in `world.talentTruth` (talent.md), outside `company`, outside `AgentState`.
- Candidates carry no truth, only what an interview revealed.
- `sceneOf` and `leagueDetail(world, false)` read observed fields only.
- `leagueDetail(world, true)` and `godModeOf` are the only readers of truth, behind `?god=1`.
- The world never reads `godMode`. In god mode only the Compétition tab changes: one column « Vrai talent » and a scatter observed against true.

---

## 4. The pixel world

### 4.1 Layout: `web/src/world/layout.ts`, `islands.ts`, `model.ts`

```ts
// model.ts
export interface Sprite { img: HTMLCanvasElement; x: number; y: number; depth: number; hidden?: boolean }
export interface Seat { /* existing */ sprites: Sprite[] }   // desk + chair, hidden while unused
export type IslandKind = 'dept' | 'plaza' | 'pier';
export type HotspotId = 'quai' | 'ligue' | 'podium' | 'duel' | `canal:${string}`;
export interface Hotspot { id: HotspotId; poly: P2[]; title: string }
export interface WorldLayout { /* existing minus seatOf */ pier: IslandModel; hotspots: Hotspot[] }
```

New key, no agents in it:

```ts
export function layoutKeyOf(s: CompanySnapshot | null): string {
  const depts = s?.company.departments ?? [];
  const closed = s?.company.org?.closedDepts ?? [];
  const agents = s?.company.agents ?? [];
  return JSON.stringify(depts.map((d): unknown[] => {
    const team = agents.filter((a) => a.dept === d.id).length;
    const size = d.id === 'direction' ? 0 : tierFor(Math.max(d.deskHigh ?? 0, team)).size; // the plaza never resizes
    return [d.id, d.name, d.color, d.icon, d.grid?.col, d.grid?.row, size];
  }).concat(closed.map((d) => [d.id, d.grid?.col, d.grid?.row, 'plot'])));
}
```

Rules:

- `effectiveGrid` occupies `PIER_CELL` and (0,2) before any department, so a legacy save holding either is moved.
- Island size is `tierFor(...)`. A column's width stays `max(size)`, as today.
- `buildDeptIsland` always marks all 4 gate corridors in the occupancy grid, fence gates open only where a bridge exists. A new neighbour therefore cannot move a desk.
- It bakes `tier.seats` desks, in `deskSlots` order, each with `hidden` set by the sim.
- `Seat.chief` is slot 0, the wide desk.
- Plaza office: 4 desks, constant. Beyond that, Direction agents stand at the meeting table (the `visitor` path already exists).
- Bridges: the pier only bridges to the plaza. `sidesOf` of finance and support ignore it.
- Vacant plot: `buildDeptIsland` with `closed: true`, `room: null`, no desks, boxes, a `À LOUER` sign, lights off. Bridges stay, since agents cross plots: in the lean start, Growth is only reachable through the Partenariats plot. Clicking it opens the `DeptPanel`: « Ce département n'a pas d'équipe : Clara s'en occupe ».

Seat resolution moves to the sim, recomputed on each `sync`:

```ts
/** `desk` when set. Otherwise (old saves before their first tick, mock): chief first, then roster order, skipping taken desks. */
export function deskIndexes(agents: readonly AgentState[], chiefOf: (dept: string) => string | undefined): Map<AgentId, number>;

/** Shows the desks below max(deskHigh, highest used + 1). Called from sync, O(desks). */
export function applyDeskVisibility(L: WorldLayout, desks: Map<AgentId, number>, agents: readonly AgentState[], depts: readonly DeptDef[]): void;
```

Stability guarantee, stated exactly: **the desk index never changes for an agent unless promoted to chief, and its position relative to its island changes only on a tier change of that island.** A neighbour's tier change moves whole islands, not desks inside them.

Reflow in `WorldEngine.setSnapshot`, when the key changes and a frame was already drawn:

```ts
const copy = makeCanvas(this.canvas.width, this.canvas.height);
copy.g.drawImage(this.canvas, 0, 0);
this.dissolve = { img: copy.c, t0: now, dur: reducedMotion ? 0 : 0.35 };
```

End of `render`, in screen space: `globalAlpha = 1 - t`, draw the copy. Camera stays where it is. If the user has not moved it and the focus is the overview, `flyTo(overview)`.

### 4.2 Plaza stage, `plaza.ts` (local tiles)

| Item | Position | Change to existing decor |
|---|---|---|
| Trophy wall, along x | x 11,4 to 13,9, y 10,85 | removes `benchProp('y')` at (12,4 ; 10,2) |
| Podium | x 11,3 to 13,5, y 11,6 to 12,8. Tops: 14 px centre, 10 px at x 11,65, 6 px at x 13,15 | `treeProp` at (14,3 ; 14,3) becomes `bushProp(1)`: it would hide the podium |
| Champion's spot | (12,4 ; 13,3) | |
| League board, billboard | base (2,0 ; 12,0) | lamp at (1,1 ; 9,1) moves to (1,6 ; 8,1), it stood behind the board |
| Duel table | centre (4,2 ; 11,0), spots (3,5 ; 11,0) and (4,9 ; 11,0) | wander spots closer than 1,1 are dropped |
| Channel slots | y 14,45 at x 8,7 / 10,0 / 11,3 / 12,6, then x 14,45 at y 10,0 / 11,3 / 13,0 / 8,7 | none |
| Stage arch | across the `y+` path, centre (7,5 ; 14,6) | none |

```ts
// IslandModel, plaza extras
stage?: {
  podium: { centre: Pt; tops: { place: 1 | 2 | 3; at: Pt; z: number }[]; champion: Pt };
  wall: Pt; board: Pt;
  duel: { centre: Pt; spots: [Pt, Pt]; facing: [Facing, Facing] };
  channelSlots: Pt[]; arch: Pt;
};
```

Nothing on a walking line: `route()` runs from bridge centres and the fountain ring, and these zones lie outside every straight line between them. Covered by a test.

### 4.3 L'Accueil: `web/src/world/pier.ts` (new)

`buildPier(inp): IslandModel`, `id: 'quai'`, `kind: 'pier'`, `deptId: null`, `name: 'Accueil'`, size 9, cell `PIER_CELL`, bridge on `y-`.

| Zone (local tiles) | Content |
|---|---|
| Room x 0,7–4,1, y 1,2–4,6, gate `x+` | Interview room: glass fence, table at (2,4 ; 2,9), interviewer (1,7 ; 2,9), candidate (3,1 ; 2,9). Field `room`, so `localNav` already routes around it |
| Bench x 5,2–7,8, y 1,0 | 4 `waitSpots` |
| Dock x 3,9–5,1, y 6,9–9,0 | Planks off the island edge, `dockSpot` (4,5 ; 8,3) |
| Balloon | Moored at (6,8 ; 7,4) |
| Decor | Sign `ACCUEIL`, lamp, two flower beds, mat at the bridge end |

```ts
// IslandModel, pier extras
pier?: { waitSpots: Pt[]; interview: { staff: Pt; guest: Pt; centre: Pt }; dock: Pt; balloon: Pt };
```

Label: `Accueil`, sub `${candidates} candidats · ${openSeats} postes ouverts`.

### 4.4 Sim: `web/src/world/agents.ts`

```ts
export interface AgentVis {
  /* existing */
  carry: 'box' | 'bag' | null;
  role: 'staff' | 'leaving' | 'arriving' | 'candidate';
  pose?: 'cheer' | 'slump' | 'shake' | null;
  poseUntil?: number;
}
type SpotKind = /* existing */ | 'dock' | 'bench' | 'interview_staff' | 'interview_guest' | 'duel' | 'cheer';
interface Override { kind: /* existing */ | 'exit' | 'arrive' | 'duel' | 'interview' | 'cheer'; /* existing */ spot?: Pt; facing?: Facing }
```

Methods added:

```ts
spawnLeaver(key: string, seat: AgentId | null, person: PersonCard | undefined, now: number): void;
expectArrival(id: AgentId): void;                     // next sync starts it at the dock with a bag
syncCandidates(c: CandidateChip[], now: number): void;
callToDuel(a: AgentId, b: AgentId, now: number): void;
callToPodium(id: AgentId, now: number): void;
```

**A leaver is always a new sprite, `leaver:<key>`.** It clones sheet, position and name of the seat's sprite while that sprite still shows the person, because beats run before `sync`. Without such a sprite it uses `person.avatar` at the island centre. This handles both pillars the same way:

| Case | Agent id after the event | What the world does |
|---|---|---|
| Org departure or layoff | Removed | Leaver walks out, `sync` deletes the old sprite, desk empty |
| Talent replacement | Kept, new `personId`, name, avatar | Leaver walks out, the `hire` beat sends the seat's sprite to the dock with the new look |

Rules:

- `sync` deletes an unseen id only if `role === 'staff'`. Leavers and candidates have their own life cycle.
- `hire` beat, agent known: `expectArrival` moves it to the dock. New id: spawned there. No beat (first snapshot, reload): placed on its desk.
- `pick()` skips leavers, and returns `{ place: 'quai' }` for a candidate, so `AgentPanel` never opens on a non-agent.
- A selected agent who left: `AgentPanel` shows the alumni card if the name is in `scene.names`, otherwise `App` clears the panel.
- `leaving` and `arriving` walk at `speed × 1,6`.
- Boarding: a leaver reaching the dock joins the balloon's riders, then its sprite is deleted.
- Arrival: on entering its department island, the chief gets the existing `visit` override towards it. On reaching the desk: `pose: 'shake'` 1,5 s, `carry = null`, dust.
- New chief: desk changes to 0, the agent walks there like any target change.
- Caps: 6 `leaving`, 6 `arriving`. Over the cap the sprite is skipped; toast and feed still tell it.

### 4.5 Drama: `web/src/world/drama.ts` (new)

Pure core, unit-tested without canvas:

```ts
export interface DramaState { seen: Set<string>; started: boolean }
export const MAX_BEATS = 12;
export const MAX_AGE_DAYS = 2;

/** First snapshot of a run plays nothing. Afterwards each key plays once, the newest 12, none older than 2 days. */
export function takeBeats(st: DramaState, scene: SceneView | undefined, day: number): ChronicleEntry[] {
  if (!scene) return [];
  const fresh = scene.recent.filter((e) => !st.seen.has(e.key));
  for (const e of fresh) st.seen.add(e.key);
  if (!st.started) { st.started = true; return []; }
  return fresh.filter((e) => e.day >= day - MAX_AGE_DAYS).slice(-MAX_BEATS);
}
```

`seen` is pruned to the keys of `scene.recent` past 500 entries, as `pruneSeen` does. Called in `setSnapshot` after any layout rebuild and **before** `sim.sync`. Reset on a new run.

| Kind | World reaction |
|---|---|
| `hire` | `expectArrival`, balloon lands if away |
| `fire`, `resign` | `spawnLeaver`, bubble « Je pars » with `why` cut at 60 chars via `bubbles.say()`. On an org departure the desk stays visible and empty |
| `promote` | Sparkle on the agent, floater `CHEF` if seat 0 |
| `probation` | Icon appears, no movement |
| `duel_open` | Queue (1 slot). `callToDuel`, spark for 8 s, then back to work. At most one duel per 30 s; a queue over 3 drops the oldest |
| `duel_end` | Floaters `+18` and `-12` above both, `pose: 'cheer'` and `'slump'` 2 s |
| `season_end` | Confetti above the podium 4 s, `callToPodium(champion)` if still employed, statues and cups rebaked |
| `channel_open` | Totem appears with dust, floater with the channel name |
| `channel_close` | Totem gets the red cross, it stays while the channel stays in `scene.channels` |
| `dept_open` | Plot becomes an office: reflow + dissolve, then dust ring and `scaffoldProp` 3 s. Same effect, without a beat, when a key change shows a bigger tier |
| `stage_up` | Arch rebaked, fireworks 5 s above the plaza |
| `req_open` | `vacancyTagProp` on the next free seat of the department (driven by `scene.openSeats`) |

The camera is never moved by a beat. Each toast offers « Voir ».

Balloon state machine, `drama.balloon`:

```
moored → (rider boards, 1,5 s wait for others) → lifting (3 s up, fade) → away (2 s) → landing (3 s) → moored
hire while away: the landing brings the hire, who steps off at the dock
```

### 4.6 Dynamic props: `web/src/world/stage.ts` (new)

```ts
export interface DynProp { img: HTMLCanvasElement; x: number; y: number; depth: number }
export class StageLayer {
  sync(scene: SceneView | undefined, L: WorldLayout): void; // rebakes by fingerprint only
  items(): readonly DynProp[];
}
```

`render()` pushes these into the existing `dyn` list as `{ kind: 'prop' }`, merged by depth with agents and static sprites, so day and night tint and occlusion just work. Hotspots for board, podium, duel table and totems are filled here (`L.hotspots`).

`pick()` order: label rects, agents, hotspots, islands. `EngineCallbacks.onSelectPlace(id: HotspotId)`. `App.tsx`:

| Hotspot | Opens |
|---|---|
| `quai` | Effectif |
| `ligue`, `podium`, `duel` | Compétition |
| `canal:*` | Canaux |

When hovered: `drawPlaceTag` at any zoom. At zoom ≥ 1,25 always: `Ligue` / `Saison 3 · J12 sur 30`, `Podium` / `Élise, championne`, like Cerveau and Café.

### 4.7 Agent markers, `engine.ts`

`drawIcon` keeps status icons (blocked, thinking…). A second slot, 7 px left of the head, shows `scene.people[id].badge`:

| Badge | Icon | Visibility |
|---|---|---|
| `champion` | Crown | always |
| `podium` | Small medal | zoom ≥ 1,25 |
| `new` | Star | zoom ≥ 1,25 |
| `probation` | Red card | zoom ≥ 1,25, or hovered or selected |

`drawNameTag` subtitle becomes `rôle · 1 284`, when `people[id]` exists.

---

## 5. Sprites and animations to draw

All procedural, in the existing style: `bake`, `bakeIso`, `box`, `flat`, `tones`, `drawPixelText`, `addOutline`. Outline colour stays `[42, 31, 61, 235]`.

### 5.1 Character frames, `sprites.ts`

```ts
export const FRAME = {
  /* existing 0..16 */
  carryFront: 17, // 17..20
  carryBack: 21,  // 21..24
  cheer: 25,      // 25, 26
  slump: 27,
  shake: 28,
} as const;
const FRAME_COUNT = 29; // sheet 464 × 48
```

| Frames | Painted as |
|---|---|
| carry | `paintFigure` with pose `'carry'`: legs as walk 0..3, both forearms bent at chest (`r(4,12+by,1,2)`, hand `p(5,13+by)`, mirrored), no swing |
| cheer | Both arms up: `r(4,8,1,3)` and `r(11,8,1,3)`, hands one pixel above; frame 26 raises the body 1 px |
| slump | Head down 1 px, eyes as blink frame, arms straight |
| shake | Right arm out: `r(12,12,2,1)`, hand `p(14,12)` |

`frameFor` selects carry frames when `v.carry` is set and moving, and honours `v.pose` until `poseUntil`.

### 5.2 Carried items, `sprites.ts`

```ts
export function carrySprite(kind: 'box' | 'bag', front: boolean): Baked;
```

| Item | Size | Palette | Draw order |
|---|---|---|---|
| Box | 10 × 8 | Faces `#cf9a5b` / `#a8743f`, flap `#e9c27f`, a green pixel `#4ade80` (plant) and a white one (frame) sticking out | Front view: after the body. Back view: before |
| Bag | 7 × 8 | Dept colour, strap `#2e2433` | Back view: after the body. Front view: before |

Anchor: 5 px left of the feet point, 15 px above it.

### 5.3 Statues, `sprites.ts`

```ts
export function statueFrame(avatar: AvatarSpec, tone: 'gold' | 'silver' | 'bronze'): HTMLCanvasElement;
```

Reads frame `idleFront`, maps luminance to a 4-step ramp, re-outlines.

| Tone | Ramp |
|---|---|
| gold | `#7a5210 #c9932a #f4c542 #fff1a8` |
| silver | `#5a6172 #8e96a8 #c3cad6 #f1f4f8` |
| bronze | `#5e3518 #96582b #c98a52 #eec49a` |

### 5.4 Icons, `statusIcon` (13 × 13)

`IconKind` gains `crown`, `medal`, `star`, `card`, `vs`. `card` is a red rectangle 6 × 8 tilted by a 1 px step. `vs` is white pixel text on `#ef4444`.

### 5.5 Props, `props.ts`

| Function | Footprint or size | Static or dynamic | Notes |
|---|---|---|---|
| `podiumProp()` | 2,2 × 1,2 tiles, 14 px | static | Three `box` steps, gold, silver, bronze trim, digits 1 2 3 via `drawPixelText` on the front faces |
| `trophyWallProp(cups)` | 2,5 × 0,25, 22 px | dynamic | Stone wall, up to 8 cups on its `+ty` face, the last one gold, the others bronze |
| `leagueBoardProp(rows, season)` | 86 × 82 px screen-facing | dynamic | Dark frame `PAL.outline`, cream face, header `SAISON 3`, 5 rows `1 ELISE 1584` at 10 px pitch, green or red 1 px arrow for `delta7d`, two poles |
| `duelTableProp()` | 1,1 × 0,7, 9 px | static | Round table + two `stoolProp`, red and blue pennant |
| `channelTotemProp(chip)` | 16 × 36 px screen-facing | dynamic | Pole, panel in `chip.color`, `glyph` in the 5×7 font, lamp pixel green when open, amber when verifying, 10 px share bar under the glyph. A banned channel gets a 2 px red cross |
| `archProp(stageName, level)` | 66 × 46 px screen-facing | dynamic | Two posts, wooden lintel with the name, `level` small flags on top |
| `dockProp()` | 1,2 × 2,1 | static | `paintBridge`-style planks with posts |
| `balloonProp(color)` | 44 × 66 px | static | `ellipse` envelope with 4 stripes, ropes, basket; moored with two ropes |
| `interviewTableProp()` | 0,9 × 0,6, 8 px | static | Table, folder, cup |
| `glassFenceProp(axis, len)` | as `fenceProp` | static | Pale blue panes for the interview room |
| `scaffoldProp()` | 1,6 × 1,6, 40 px | transient | Poles and two planks, 3 s |
| `vacancyTagProp()` | 28 × 12 px | dynamic | Yellow tag `POSTE` on a stick, on the next free desk |
| `lotProp(seed)` | as `signProp`, plus `boxesProp` | static | `signProp('À LOUER', '#94a3b8')`, pegs and a string around the plot |

### 5.6 Effects: `web/src/world/effects.ts` (new)

```ts
export class Effects {
  dust(x: number, y: number): void;              // 10 particles, 0,6 s
  confetti(x: number, y: number, n: number): void; // 2,2 s, gravity, 6 colours as the plaza's confetti
  spark(x: number, y: number, seconds: number): void; // 6 rays, #ffffff #ffe08a #ff9d3c, loop 0,7 s
  floater(x: number, y: number, text: string, color: string): void; // pixel text up 14 px, 1,6 s
  fireworks(x: number, y: number): void;         // 3 bursts over 5 s, additive pass
  update(dt: number): void;
  draw(g: CanvasRenderingContext2D): void;
}
```

- Capped at 240 particles.
- `prefers-reduced-motion`: particle counts divided by 4, floaters kept, dissolve 0.
- Drawn after the tint pass, with the status icons.

### 5.7 How to test them

**Headless canvas.** `web/src/world/testCanvas.ts`, about 200 lines: a fake `document.createElement('canvas')` whose 2D context implements `fillRect`, `clearRect`, `getImageData`, `putImageData`, `drawImage`, `translate`, `scale`, `save`, `restore`, `createRadialGradient` and `createLinearGradient` (stubs), `arc` and `fill` (stubs) over a `Uint8ClampedArray`. It lets `getSheet`, every `bake`, and **the whole `buildLayout`**, run in vitest under Node, which today is impossible.

**Sprite assertions** (`web/src/world/sprites.test.ts`):

- Every new frame has at least 40 opaque pixels and none outside its 16 × 24 cell.
- Feet rows of carry frames 17..20 equal those of walk frames 0..3.
- Mirrored row equals the flipped first row.
- `carrySprite('box', true)` contains `#cf9a5b`.
- `statueFrame(a, 'gold')` holds only ramp colours and the outline.
- Each new `IconKind` is non-empty.

**Visual check.** `world-preview.html` gets a « Scènes » panel with buttons: Embaucher, Renvoyer, Duel, Fin de saison, Ouvrir un canal, Agrandir l'île, Palier suivant. Each appends to `scene.recent` in the mock, so the same code path runs without a server. Final check: open it in the browser pane, one screenshot per button at zoom 2, in both a day and a night tick.

---

## 6. Interface

### 6.1 Navigation

`web/src/ui/labels.ts`:

```ts
export type TabId = 'bureau' | 'taches' | 'calendrier' | 'produits' | 'pub' | 'canaux' | 'croissance' | 'effectif' | 'competition'
  | 'mail' | 'finance' | 'cerveau' | 'apprentissage' | 'galerie';

export const TABS: { id: TabId; label: string; icon: IconName; key: string; more?: true }[] = [
  { id: 'bureau', label: 'Bureau', icon: 'building', key: '1' },
  { id: 'taches', label: 'Tâches', icon: 'list', key: '2' },
  { id: 'produits', label: 'Produits', icon: 'package', key: '3' },
  { id: 'pub', label: 'Acquisition', icon: 'megaphone', key: '4' },
  { id: 'canaux', label: 'Canaux', icon: 'globe', key: '5' },
  { id: 'croissance', label: 'Croissance', icon: 'trendUp', key: '6' },
  { id: 'effectif', label: 'Effectif', icon: 'users', key: '7' },
  { id: 'competition', label: 'Compétition', icon: 'trophy', key: '8' },
  { id: 'finance', label: 'Finance', icon: 'wallet', key: '9' },
  { id: 'galerie', label: 'Galerie', icon: 'image', key: '0' },
  { id: 'mail', label: 'Boîte mail', icon: 'inbox', key: 'm', more: true },
  { id: 'calendrier', label: 'Calendrier', icon: 'calendar', key: 'c', more: true },
  { id: 'cerveau', label: 'Cerveau', icon: 'brain', key: 'b', more: true },
  { id: 'apprentissage', label: 'Apprentissage', icon: 'grad', key: 'a', more: true },
];
```

`TopBar`: `more` tabs render in a `Plus` menu button (`aria-haspopup="menu"`, arrows, Esc). The button shows the mail badge, since the agency answers its mail alone and he only needs the count. On the phone layout (≤ 760 px) the grid shows all 14. New icon `trophy` in `icons.tsx`. `d` opens the digest. README's « touches 1 à 0 » is updated.

`DEPT_ORDER` is no longer the source of truth: `deptOrder(departments)` returns known ids in that order, then any other by `openedDay`. `DeptStrip` and `TasksTab` use it, otherwise a new department sorts first (`indexOf` gives -1) or vanishes from the filter.

### 6.2 Data hook

`web/src/ui/useDetail.ts`:

```ts
export function useDetail<T>(path: string | null, day: number): { data: T | null; error: string | null; loading: boolean; reload(): void };
```

Fetches on mount and when `day` changes, keeps the last good data on error, ignores stale responses. Demo mode: `mockDetail(path)`. Each tab splits into `XTab` (hook) and `XBody({ data })`, so `renderToStaticMarkup` tests render the body directly.

### 6.3 Effectif: `web/src/ui/tabs/EffectifTab.tsx`

| Block | Content | Source |
|---|---|---|
| Stats row | Agents, Masse salariale 30 j, Coût par tête, CA par tête, Profit par tête, Postes ouverts | `OrgDetail` |
| Palier | `StageMeter` | `stage` |
| Organigramme | Camille on top, one column per open department: chief, then members. Each head: `PixelAvatar`, name, role, tier, note, contract pill, hat badges, cost 30 d. Click: `openAgent` | `depts[].heads` |
| Pression par rôle | Bars: relief against 12, utilisation against 70 %, as org.md §13 | `pressure` |
| Plan de recrutement | Table: Poste, Équipe, Pourquoi, Statut, Depuis, Budget 30 j, Candidats. « Pourquoi » prints `Position.detail` in full. The last refusal, with its numbers, under the table | `reqs`, `lastRefusal` |
| Décisions RH | Last 30 entries with `why` | `decisions` |
| Courbe | Headcount and payroll | `history` |

The HUD also shows `effectif · masse salariale/mois · revenu par tête`, as org.md asks: one compact chip, in `scene.stage`.

### 6.4 Compétition: `web/src/ui/tabs/CompetitionTab.tsx`

| Block | Content |
|---|---|
| Saison | `Saison 3 · J12 → J41 · 18 jours restants`, rules as a list, not a tooltip |
| Classement | `Segmented` by skill. Table: rang, évolution, agent, note, 7 j, sparkline, forme (5 pastilles), points, métrique lisible, échantillon. Row under `cutLine` gets a dashed separator « Sous cette ligne, le contrat est menacé ». `confidence: 'faible'` prints « peu de données ». Seats without a lever print a footnote: « Hors ligue : poste sans effet mesurable sur un résultat » |
| Plans d'amélioration | `ProbationPlan.text`, objective, deadline, coach, outcome |
| Duels | Running, then settled: both names, metric, scores, rating deltas, winner |
| Dernier recrutement | `HireReport`: the four test scores and what each produced, who stayed or came in, cost |
| Transferts | Chronological list with `why` |
| Panthéon | One card per season: champion's `PixelAvatar`, score, « toujours là » or « parti J42 » |
| Anciens | Table: agent, arrivé, parti, motif, `why` in full, meilleure note, titres, coût total, remplacé par |
| Mode dieu only | Column « Vrai talent », scatter observed against true, one line stating how far the ranking is from the truth (Spearman) |

### 6.5 Canaux: `web/src/ui/tabs/CanauxTab.tsx`

The channel board of channels.md §10, in its own tab. `pub` becomes « Acquisition » and keeps campaigns, creatives, comments and accounts.

| Block | Content |
|---|---|
| Cartes | Five cards: name, state (« Fermé · ouvre quand 15 ventes », « Vérification, jour 12 », « Ouvert », « Suspendu jusqu'au jour 40 »), budget du jour, avertissements |
| Table 7 jours | Budget/j, Dépense, ROAS plateforme, **ROAS boutique**, ROAS marginal, Part du budget. Claimed over shop shows as « gonflé ×1,8 » in amber. The shop is the bold one and sets the tones (D149). ROAS marginal is a reading, never the reason. Column titles explain the two readings of the ROAS |
| Matrice canal × niche | À tester, en test (J3/5), rentable (ROAS), coupé (reason in the cell on focus), bloqué (rule) |
| Décision du CFO | Today's moves, each with the number the money followed. λ prints only when it exists, under the control `marginal_roas`, as does « 38 € non dépensés : aucun canal ne rapporte son euro suivant »; the average rule spends all it may (D149) |
| Répartition | Stacked area, spend share per channel per day |
| Conditions d'ouverture | Each condition with a `Bar`: `Ventes 9 / 15` |

The platform's ROAS is never shown alone. Tones (good, bad) use the reconciled one only.

`AdsTab`: channel filter, channel pill per campaign, `.phone` takes the creative's ratio, `AccountHealth` one row per account. Those are channels.md §10.

### 6.6 Gallery and viewers: `web/src/ui/viewers/`

`GalleryTab` reads `/api/deliverables`, pages of 60, « Charger la suite » at the bottom. Tiles for `pdf` and `ad_video` become `<button data-viewer>`. Everything else stays a new-tab link, so existing tests still pass. Tile media: cover for a PDF, poster for a video.

`Lightbox.tsx`: full-screen layer, focus trap, `.lightbox` z-index 90. Listens on `window` in capture phase and calls `stopPropagation` on every key except Tab, like `TopBar` does, otherwise digits switch tabs behind it. Always offers « Ouvrir dans un onglet ».

**`VideoPlayer.tsx`**

```ts
export interface VideoFile { ratio: '9:16' | '1:1' | '4:5' | '16:9'; path: string; durationSec: number; bytes: number }
export function VideoPlayer(p: { videos: VideoFile[]; poster?: string | null; captions?: string | null; fallbackHtml?: string | null; title: string }): JSX.Element;
```

| Feature | Behaviour |
|---|---|
| Frame | Phone frame sized by ratio, ratio switch if several files |
| Controls | Play, scrub, time, mute, captions, safe-zone overlay, speed 1× and 1,5× |
| Safe zones | Toggle draws the area hidden by the platform's interface, from one table per ratio |
| Keys | Space play, ← → 5 s, M mute, C captions, Esc close |
| No file (`videos` empty) | The `sandbox="allow-scripts"` iframe of today, with the caption « Pas encore de vidéo pour cette pub », and « Aperçu animé : vidéo non générée sur cette machine » only at `storyboard_only`, where the button is disabled and says why (D151) |
| Playback error | Same fallback |

**`PdfFlip.tsx`**, loaded by `React.lazy`, so `pdfjs-dist` stays out of the main chunk.

```ts
const pdfjs = await import('pdfjs-dist');
pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
const doc = await pdfjs.getDocument({ url, disableRange: true, disableStream: true, isEvalSupported: false }).promise;
```

```ts
/** Cover alone on the right, then facing pages. Pure, unit-tested. */
export function flipSpread(pages: number, spread: number): { left: number | null; right: number | null };
export function spreadCount(pages: number): number;
```

| Feature | Behaviour |
|---|---|
| Rendering | Current and next spread only, at `min(panelW / 2, 520) × min(dpr, 2)`, LRU of 8 pages |
| Flip | Two-faced leaf, `rotateY` 0 to -180°, 420 ms, `backface-visibility: hidden`, soft moving shadow |
| Reduced motion | Direct swap |
| Keys | ← → PageUp PageDown Home End Esc. Click on a page edge turns it |
| UI | `Pages 4–5 / 24`, slider, « Télécharger » |
| Failure of pdf.js | `<iframe src={url}>`, the browser's viewer |

`ProductsTab` adds « Feuilleter » next to « Ouvrir le PDF ». `AdsTab` opens the player from the phone poster. `web/package.json`: `"pdfjs-dist": "4.10.38"`, pinned.

### 6.7 Founder digest: `web/src/ui/FounderDigest.tsx`

Data from scale.md §3: `GET /api/digest`, default `since = growth.founder.lastSeenDay`.

```ts
// web/src/ui/derive.ts
export const DIGEST_MIN_DAYS = 7;   // scale.md §8
export function digestDue(lastSeenDay: number | null, day: number): boolean {
  return lastSeenDay !== null && day - lastSeenDay >= DIGEST_MIN_DAYS;
}
```

- While the tab is visible, the client posts `POST /api/digest/seen`, at most every 30 s. So `lastSeenDay` follows him as he watches, and a run at ×8 does not trigger a digest in his face. Hidden tab, closed tab: nothing is posted, and the gap builds up. A tab or a stream just back posts nothing until a new day has shown: the page may hold an old snapshot, and the server writes down today.
- Checked on the first snapshot of a run, on return to visible, and on every snapshot he has in front of him, from the last day the page showed him: a return on an old snapshot decides nothing, the first fresh one does.
- Not in demo mode.
- Modal, not a toast: he must read it. Close with Esc or « Reprendre », which posts `seen`.

```
Pendant ton absence · J12 → J47
Headline, losses as plain as gains
[ Trésorerie +2 340 € ] [ Profit +1 980 € ] [ Effectif 14 → 22 ] [ Palier Adéquation → Accélération ]

Ce qui a compté        highlights, each line clickable
Décisions              decisions, with why and impact
Erreurs                mistakes
Incidents              incidents, machine off included
Produits               launched, stopped with reason, best, worst
Canaux                 opened, closed, best by reconciled ROAS
À décider              waiting, link to Tâches
La suite               next
```

HUD button « Résumé » reopens it, for the last 7 days.

### 6.8 Growth stage

`CompanyBadge` replaces the red pill `AGENCE PDF` by `<StageBadge />`: `Palier 2/4 · Adéquation`, four pips, and a popover with `GateCheck` rows, `weeksHeld / weeksNeeded`. `StageMeter` is shared with Effectif and Croissance. Keyboard reachable, `aria-label="Palier 2 sur 4 : Adéquation. Prochain palier : Accélération."`.

`CroissanceTab.tsx`, as scale.md §8: stage track with `GateCheck` rows, weekly revenue and profit bars, this week's allocation, `PortfolioLine` table with verdict and reason, decision timeline, and the « Liste e-mail » block (funnel, unsubscribes, broadcasts, cost). Reads `/api/growth` and `market.audience`.

### 6.9 Smaller changes

| File | Change |
|---|---|
| `Hud.tsx` | `∞` instead of the horizon, « au ralenti : personne ne regarde » when `pace === 'away'`, chip `effectif · masse salariale · revenu par tête` |
| `CalendarTab`, `EndBanner`, `ScenarioModal` | No assumed horizon, « Continuer sans fin », toggle « Sans fin » default on (scale.md §8). Select « Compétition : ligue, sans conséquence, désactivée » on `scenario.talent` (talent.md §9.1) |
| `labels.ts` | `Lookups.names`, from `scene.names`. `agentName` prints it for a fired agent, `agentColor` falls back on grey |
| `AgentPanel.tsx` | Skill bars (`level + hash`) removed: plain chips, or observed values if the talent pillar provides them. New block « Carrière »: note, rang, statut, plan, coach, trophées, « formé par », qui occupait ce poste avant, coût 30 j. Agent gone: the card reads from `/api/league` alumni instead of « n'existe pas ». Playbook through `/api/playbook` |
| `ActivityFeed.tsx` | New filter « Équipe »: kind `org`, plus lines whose text matches a `scene.recent` key |
| `useEventToasts.ts` | New `useChronicleToasts(scene, push)`: one toast per `hire`, `fire`, `season_end`, `channel_open`, `dept_open`, `stage_up`. Same idempotence as `takeBeats`. Over 3 in a batch: one summary toast |
| `DeptPanel.tsx` | `Postes : 5 occupés / 6`, open reqs, and the hosted message for a closed department |
| `App.tsx` | `<div role="status" aria-live="polite" className="sr-only">` announces the last `hire`, `fire`, `season_end`. The canvas drama therefore has a text equivalent |
| `Minimap.tsx` | Accueil cell, click opens Effectif |
| `mockSnapshot.ts` | Follows org §11 (P13.3), gains a full `scene` and `mockDetail` |
| `styles.css` | `.league-table`, `.org-grid`, `.channel-card`, `.lightbox`, `.flip`, `.digest`, `.sr-only`, using existing tokens only |

---

## 7. What this pillar needs from the others

Read against `org.md`, `talent.md`, `channels.md`, `scale.md`. `video.md` and `pdf.md` were not out yet.

| Pillar | Need | If absent |
|---|---|---|
| **org** | `syncDesks` called at the end of `Company.step()`. `closedDepts` keeps every catalog department with the cells of section 2.4, `video` on (0,-2), `crm` on (2,0), not (-3,-3) and (3,3). `OrgDecision.numbers` and `Position.detail` stay in French with their numbers. `company.org` stays out of the live snapshot: `trimOrg` serves `/api/org`, not the stream | Client fallback `deskIndexes`; a plot jumps cells |
| **org** | A candidate with `avatar`, and the interviewer's id on `Position` | Empty bench |
| **talent** | `PersonRecord.avatar` and `role`, so a departed champion keeps a statue, a card and a Panthéon entry. Everything in its field-mapping table is taken as is, `SkillRating` included | Grey silhouette |
| **talent** | `trimLeague` dropped: `company.league` stays out of every snapshot and `/api/league` is the only route. `scene.people` replaces its live `people`, 48 bytes against about 300 per person | Live budget fails |
| **talent** | One decision between org and talent on who owns a firing, since the league seat keeps its id while `org` removes ids. This pillar handles both, see 4.4 | None for the UI |
| **channels** | `ChannelsDetail` is built on the server from `company.channels`, `kpis[].channels`, `market.channelAccounts`, so `company.channels` leaves the live snapshot. `channelRows` moves from `derive.ts` to `views.ts` | Live budget fails. Canaux shows one TikTok row from `adStats` |
| **channels** | `ChannelPublic.glyph` and `color`, for the totems | Two first letters, grey |
| **video** | `AdCreative.files.videos?: VideoFile[]`, `poster?`, `captions?` (WebVTT), `Deliverable.kind 'ad_video'`. `lightCreative` keeps them. No path when the file does not exist | Today's HTML preview |
| **pdf** | Each PDF `Deliverable` keeps `path`. `pages` count welcome | Counted by pdf.js on open |
| **scale** | `company.growth.founder` in the snapshot. `FounderDigest` gains `people`, `channels`, `highlights`, filled by `digestPeopleOf`. `/api/deliverables` takes `kinds` | Digest prints only its own fields |
| **scale** | `LIVE_LIMITS` here supersede the two lines of scale.md §7. Its 40 kB for `company.growth` is counted in section 3.1 | |

---

## 8. Tests that fail without the feature

### `web/src/world/layout.test.ts` (with `testCanvas`)

| Test | Fails today because |
|---|---|
| Hire into a department with a free desk leaves `layoutKeyOf` unchanged | Key contains all agent ids |
| Departure leaves every other agent's desk position unchanged, the desk visible | Desks follow team order |
| `JSON.parse(JSON.stringify(snapshot))` rebuilds identical desk positions | Same |
| Chief replaced: the promoted agent gets desk 0, the others do not move | Same |
| Crossing 6 → 7 desks changes the island size to 10, desk indexes unchanged, key changes | No tiers |
| `deskHigh` keeps the size after falling back to 3 | Size follows headcount |
| For all 8 192 open subsets of 13 departments, `effectiveGrid` returns the declared cells | Declared grid is disconnected |
| Opening a department leaves every other island's cell unchanged | Greedy repair moves them |
| A closed department draws a plot: no desk, `closed` true | No plots |
| Legacy dept on (0,1) moved away, no crash | No pier |
| Bridge plaza ↔ quai exists, none between quai and finance or support | No pier |
| A new neighbour does not change an island's desk positions | Gates cut corridors |
| From every desk, `route` to the dock ends on the pier and crosses no stage rectangle | No dock |
| Save without `desk`: chief 0, others in roster order | Regression guard |

### `server/test/desks.test.ts`

| Test |
|---|
| `syncDesks` twice in a row changes nothing |
| Lean team of 8, then 12 hires, 3 departures: no two agents of a department share a desk, freed desks are reused lowest first |
| Same agent id with a new person keeps the desk |
| Chief change swaps desks and moves nobody else |
| No draw on any stream: replay of a 25-day run stays byte-identical with `syncDesks` called twice per step |

### `web/src/world/drama.test.ts`

| Test |
|---|
| First snapshot of a run plays nothing, a reload plays nothing |
| A new key plays exactly once across two snapshots |
| 24 entries after a sleep: 12 played, entries older than 2 days none |
| Org departure: agent gone from the snapshot, a `leaver:` sprite with `carry: 'box'` reaches the dock, is deleted after boarding |
| Talent replacement: same agent id, a leaver with the old sheet walks out, the seat's sprite restarts at the dock with `carry: 'bag'` and the new sheet |
| Hire of a new id spawns at the dock, ends seated with `carry: null` |
| A leaver cannot be picked, a candidate picks the Accueil |
| Second `duel_open` while one plays waits; a queue of 4 drops the oldest |

### `web/src/world/sprites.test.ts`

As in section 5.7.

### `server/test/views.test.ts`

| Test |
|---|
| World with 60 agents, 100 products, 400 deliverables, day 200: `serializeLiveSnapshot(...).length ≤ 500_000` (fails today: 530 KB at day 61) |
| `JSON.stringify(sceneOf(world)).length ≤ 25_000` |
| Sentinel truth value 0.7391 in `talentTruth`: absent from `/api/state`, SSE frames, `/api/league`, `/api/org`, `/api/digest`; present with `?god=1` only |
| `sceneOf`, `chronicleOf` and every detail builder leave `JSON.stringify(world)` unchanged |
| `chronicleOf` on a world with no pillar state returns `[]`, and `sceneOf` still returns a valid scene |
| `chronicleOf` keys are unique, and identical between a run and the same run reloaded mid-way |
| `digestPeopleOf`: 0 hires on a window without one, `highlights` at most 12, at most 3 of a kind |
| `stubProduct` keeps stats and decision, drops content |
| `company.org`, `company.league`, `company.channels` absent from the live JSON |

### `server/test/api.test.ts`

| Test |
|---|
| `Range: bytes=0-99` on an mp4 returns 206, `Content-Range`, 100 bytes |
| `Range: bytes=999999-` returns 416 |
| No `Range`: 200 with `Accept-Ranges: bytes` |
| `mimeFor('a.mp4') === 'video/mp4'`, `.vtt` → `text/vtt; charset=utf-8` |
| `/runs/<id>/world.json` still refused |

### `web/src/ui/derive.test.ts`

| Test |
|---|
| `flipSpread(24, 0)` is `{ left: null, right: 0 }`, spread 1 is pages 1 and 2, last spread of an even count has `right: null` |
| `digestDue`: false under 7 days, false without a value, true at 7 |
| `budgetShares` sums to 1, handles all zeros |
| `deptOrder` keeps a new id after the known ones |

### `web/src/ui/ui.test.tsx`

| Test |
|---|
| CompetitionBody prints the rating and never « Vrai talent » without god mode, prints it with god mode |
| CompetitionBody prints an alumnus' `why` in full, and the four scores of the last challenge |
| EffectifBody prints a position's detail and the cost per head |
| CanauxBody prints platform, shop and reconciled ROAS together, « gonflé ×1,8 », tone follows the reconciled one |
| A task signed by a departed agent prints the name from `scene.names`, not the id |
| GalleryTab: a video tile is a `<button data-viewer>`, a sales page stays a new-tab link |
| VideoPlayer without `videos` renders the sandboxed iframe and the caption |
| TopBar: 10 buttons plus « Plus », all 14 `key`s unique |
| `GalleryTab.tsx` source does not import `pdfjs-dist` |
| AgentPanel Fiche no longer renders `skill-val` from a hash |
| FounderDigest prints the headline and a loss as a negative number |

### `web/src/ui/styles.test.ts`

`.lightbox` z-index above `.modal-backdrop`, opens in ≤ 150 ms without an opacity fade, as the other panels.

---

## 9. Build order

Each step ships working on its own, because every view tolerates a missing pillar. Scale puts « digest and UI last »; steps 1 and 2 still go first, since `syncDesks` and the live cuts protect everyone else.

1. `shared` types, `worldgrid.ts`, `desks.ts`, `chronicle.ts`, `views.ts` with empty defaults, live cuts, ranges and MIME, `/api/*` routes. Live size test green.
2. `testCanvas.ts`, desks, tiers, new key, `sim.sync` fix. Layout tests green with no visible change other than islands at 9 tiles and the plots.
3. Pier, plaza stage, `stage.ts`, sprites, effects. Preview panel « Scènes ».
4. `drama.ts`, leavers, arrivals, balloon, duels.
5. `useDetail`, Effectif, Compétition, Canaux, Croissance, top bar.
6. Viewers, gallery.
7. Digest, stage badge, chronicle toasts, a11y line.
8. Screenshots in the browser pane, then wire the real pillars into `views.ts`.

---

## 10. Rejected

| Option | Why not |
|---|---|
| New SSE event `drama` | Lost on a dropped frame; `scene.recent` is idempotent and needs no resync logic |
| Fixed grid pitch | Stops all reflow, but widens the map 32 % (60 to 79 tiles), and agents in the overview shrink by about a quarter |
| `recordChronicle`, a stored fourth log | Three pillars would have to call it, and it could disagree with their own logs. `chronicleOf` reads them |
| `nextDeptCell`, an allocator of cells | The catalog is closed at 13: a table is simpler, and it cannot produce two maps from two opening orders |
| « Last seen » in `localStorage` | Scale already keeps it on the server, which also works from a second device |
| `company.org`, `company.league`, `company.channels` in the live stream, as their specs propose | Together they would push the stream past 500 KB. `scene` carries what the world needs, tabs fetch the rest |
| Tab named « Ligue » | The founder said competition |
| Annex islands when a department is full | Second geometry for one department, for a case no team reaches under the cap |
| Building desks one by one with a layout rebuild | A rebuild per hire is the bug being fixed |
| Keeping fired agents in `company.agents` with a `gone` status | Every loop over agents in the runtime would need a filter |
| Client-derived seats only | Two browsers could disagree, and a shrink would move people |
| Skewed iso whiteboard | 6 characters wide, unreadable at any zoom |
| Server-side PDF page images | Needs a native rasteriser on every machine, a reason for this project to fail on a new one |
| `<iframe>` only for PDF | Works as a fallback, gives no page flip, and looks different in each browser |
| Video.js or Plyr | A 60 KB dependency for what `<video>` and 150 lines do |
| Founder firing or protecting agents from the tab | Not requested, the founder asked for autonomy. A mission can still do it |
| Showing a confidence interval on talent to the UI | It would let him infer the truth; `confidence` is derived from sample size only |
| Moving the camera to a firing | Steals the view from the person working in it. The toast offers « Voir » |
| Hiding `level` | Stays while the talent pillar makes it real; if it does not, the chip goes too |
| Persisting the digest as a brain note | Nobody reads it there, and it would add a file write to a read path |
