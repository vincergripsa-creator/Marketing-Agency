# Pillar spec: self-scaling and always-on autonomy

Status: decisions final, nothing to ask the founder. Everything stays virtual: no real spend, no real send, no paid service.
Measured on the working tree of 2026-10-30 with one 120-day heuristic run (seed 7, normal, 500 €) and one closed-form ceiling computed from the real catalog. Next to this file: `measure120.mts`, `ceiling.mts`, raw data `measure120.json`.

---

## 0. What the measures say

### 0.1 The agency does not scale today, and the market is not the first reason

Weekly numbers, seed 7, normal:

| Week starting | Revenue | Ad spend | Profit | Live products | Live niches | Cash end | CFO envelope /day | Committed /day |
|---|---|---|---|---|---|---|---|---|
| D1 | 96 | 64 | -50 | 1 | 1 | 450 | 66 | 0 |
| D15 | 621 | 339 | 220 | 3 | 2 | 802 | 114 | 31 |
| D36 | 519 | 159 | 186 | 6 | 5 | 1 117 | 159 | 64 |
| D50 | 1 115 | 620 | 393 | 9 | 7 | 1 582 | 229 | 120 |
| D57 | 1 335 | 741 | 266 | 10 | 9 | 1 848 | 254 | 111 |
| D71 | 932 | 519 | 289 | 11 | 9 | 2 238 | 336 | 75 |
| D85 | 1 220 | 811 | 249 | 9 | 8 | 2 952 | 440 | 89 |
| D99 | 1 246 | 693 | 364 | 7 | 5 | 3 652 | 531 | 64 |
| D113 | 902 | 463 | 245 | 7 | 5 | 3 824 | 610 | 75 |

Revenue is flat at about 1 100 €/week from week 8 to week 17. Three ceilings, in the order they bite:

1. **Capital is not deployed.** On D113 the CFO allows 610 €/day and only 75 €/day (12 %) is committed; 3 824 € sit idle. The envelope never binds. New campaigns are clamped to 40 €/day (`launchBudget`), scaling needs ROAS ≥ 1,8 (`optimize_ads`), and only 2 of 16 niches still carry paid ads.
2. **The portfolio eats itself.** 15 of 16 niches hold a killed product and `excludedNiches` bans a killed niche forever, so the last new main was created on D69. Of the 15 kills, 4 are Red Team kills of trap ideas, which is right, 6 follow a paid loss, and 5 happened with **0 € of paid ads in the window** (`ROAS — pour 0 € de pub`), including the gem `mariage-moins-10k`. Gems `urssaf-micro`, `oral-aide-soignante` and `proprete-chiot` are gone too. A live product costs nothing to keep, and it is killed anyway.
3. **Thin margin, no second sale.** Ads alone give ROAS 1,36. Repeat revenue is the upsell only: 59 of 639 buyers (9 %), 1 121 € of 13 742 €. No list, no bump, nothing lowers acquisition cost.

### 0.2 Does the market cap growth? Yes, at about ×3 on one channel, without owned audience

`ceiling.mts` solves each niche at its optimal daily volume with the real formulas (`pool × (1 − e^(−V/pool))`, real CPM, WTP, competition, creative at 90/100 and mid-life fatigue, rating ≥ 4,5, 8 % refunds, best price tier):

| Case | Paid profit €/day, all niches | €/week | Niches that pay |
|---|---|---|---|
| Average angle, nothing learned | 0 | 0 | 0 |
| Best hook × format learned | 141 | 987 | 10 |
| + revenue per buyer × 1,3 (LTV) | 364 | 2 548 | 12 |
| + pool × 1,5 | 545 | 3 815 | 12 |

The run earns about 300 €/week. Reading: the hard paid ceiling on one channel is near 1 000 €/week, and **LTV is the strongest lever in the model: × 1,3 on revenue per buyer gives × 2,6 on the ceiling**, because margin per sale is thin and every extra euro per buyer buys a higher allowed CAC further up the saturation curve. With LTV, the steady state spends 758 €/day for 958 €/day of first-order revenue. Capacity comes after that, and multiplies: the channels pillar adds pools.

**Decision:** keep `poolBase`/`poolDemand` frozen, multiply the pool by a bounded, earned factor (§6.3), put the slope on LTV and portfolio, and let channels add capacity. No plateau is expected before about D240; a plateau at about × 8 of today is an acceptable V1 end state, and it is stated as such.

### 0.3 Long-run physics

| Day | world.json | tasks | orders | customers | ledger | missions | deliverables | run folder | live snapshot | GET /api/state |
|---|---|---|---|---|---|---|---|---|---|---|
| 15 | 0,92 MB | 250 | 13 | 35 | 67 | 82 | 68 | 1,8 MB | 234 kB | 522 kB |
| 30 | 1,58 MB | 584 | 62 | 105 | 176 | 180 | 170 | 4,2 MB | 358 kB | 528 kB |
| 60 | 3,07 MB | 1 292 | 234 | 296 | 422 | 405 | 442 | 11,3 MB | 505 kB | 505 kB (fell back to LIVE) |
| 90 | 4,33 MB | 1 923 | 449 | 542 | 706 | 614 | 639 | 17,7 MB | 593 kB | 593 kB |
| 120 | 5,24 MB | 2 455 | 698 | 810 | 965 | 811 | 804 | 22,1 MB | 618 kB | 618 kB |

- 120 days took 32,5 s: morning 3,0, work 17,1, market 6,8, evening 5,5 (machine shared with other workflows). Mean 270 ms/day; weekly means 87-470 ms, driven by live products, with no super-linear trend yet.
- RSS flat at 528 MB after D85, heap 100-290 MB. JSON.stringify 23 ms, parse 12 ms, atomic save 33 ms. Memory and save time are not the problem at D120.
- Share of world.json at D120: tasks 44 % (2,28 MB), products 8 %, creatives 8 %, research 4 %, niches 5 %, inbox 4 %, adStats 4 %, deliverables 4 %, orders 3 %, missions 3 %, ledger 3 %.
- Rates: 20 tasks/day, 6,8 missions/day, 6,7 deliverables/day, 12 files/day (1 486 files at D120: 930 SVG, 181 HTML, 23 PDF, 350 brain notes), 180 kB of disk/day, journal 1,1 MB of a 1,46 MB brain.
- Unbounded today: tasks, missions, deliverables, creatives, campaigns, customers, orders, ledger, experiments, `product.stats.reviews`, `priceHistory`. Bounded: activity 600, inbox 60 days, adStats 90 days, organic 300, playbooks 12 rules, lessons by dedup, events 200.
- `adStats` is pruned at 90 days while `productHealth` reads orders from day 1, so ROAS of an old v1 is already inflated after D90: orders are counted whole, spend for 90 days only. Fixed in §7.2.
- **Pacing bug in the concept:** at ×1 a simulated day lasts 24 s, so a week away is 25 200 simulated days, 69 years. Open-ended without a pace is meaningless. See D2.

---

## 1. Decisions

| # | Decision |
|---|---|
| D1 | New runs started by the app are **open-ended** (`scenario.openEnded = true`). Fixed horizons stay for CLI, bench and tests. |
| D2 | **Away pace:** with no SSE viewer for 5 minutes the agency slows to one simulated year per real week (one tick every 138 s). A viewer brings the chosen speed back at once. `AGENCY_AWAY_DAYS_PER_WEEK` overrides it. |
| D3 | **No wall-clock catch-up.** A stopped machine stops the world. The digest says how long it was off. |
| D4 | **The agency never stops on an error.** Backoff, then skip the tick after 8 failures on the same tick. Today 3 errors pause it forever. |
| D5 | Every evening save keeps `world.prev.json`; weekly gz checkpoints; loading falls back in order. |
| D6 | **One honest digest**, built from the ledger and a decision log, including losses and mistakes. |
| D7 | Four **stages** with measured gates. A stage is a policy table, not a label. |
| D8 | **CFO reinvestment** every Monday: scale ads, test budget for new lines, payroll cap, reserve. Break-even ROAS comes from measured LTV. Guardrails unchanged. |
| D9 | **Harvest replaces most kills.** No product is killed before a real paid test. A product losing on ads stops ads and stays on sale. |
| D10 | **Niches reopen** after a cooldown that depends on why they closed; two market failures close one for 180 days. |
| D11 | **Email list as cohorts, never individual rows.** Capture, 5-step welcome sequence, weekly broadcasts, real unsubscribes, a real tool cost. |
| D12 | **Order bump** at checkout: a printable kit product. Bundles rejected. |
| D13 | **Rivals** copy winners; pressure decays and a new version halves it. Replaces the permanent `competition + 0,1` of `competitorClone`. |
| D14 | **Brand** raises a niche's pool by at most 50 %, earned by buyers. |
| D15 | **Compaction every 7 days, part of the deterministic world.** World stays bounded; cold rows go to append-only NDJSON. |
| D16 | Target: **365 simulated days in ≤ 150 s headless, world.json ≤ 12 MB, live snapshot ≤ 400 kB**, then flat. |
| D17 | Scaling is proved by a **paired control per seed** (`scenario.scaling = false`), revenue per week over 180 days, 30 seeds. |

Build order: D15 and D1-D5 first, because they make long benchmarks cheap and safe; then D9, D10, D8, D7, then D12, D11, then D13, D14; digest and UI last.

---

## 2. Always-on

### 2.1 `shared/types.ts`

```ts
export interface ScenarioConfig {
  // existing fields…
  openEnded?: boolean;   // no end: horizonDays only frames the goal
  scaling?: boolean;     // default true; false = the no-scaling control of the growth bench
}

export interface SessionInfo {
  // existing fields…
  pace?: 'live' | 'away';
  watchers?: number;
  backoffMs?: number | null;   // set while the loop waits after incidents
}
```

`ScenarioConfig.scaling` gates **company decisions only** (`growthOn(world)`). Market mechanics (§6) run in both arms, so a paired seed is the same market.

### 2.2 `runtime/company.ts`

```ts
private advance(): void {
  // …
  if (!w.scenario.openEnded && w.day > w.scenario.horizonDays) { /* finished, unchanged */ }
}

/** Last resort of the session loop: the clock moves on, the digest says so. */
skipTick(reason: string): void
```

`skipTick` calls `logDecision(world, { kind: 'incident', … })`, emits a feed line, then `advance()`. Added to `CompanyApi` in `contracts.ts`.

`defaultScenario()` keeps `openEnded` false so tests and bench stay as they are. `AgencySession.newRun()` passes `openEnded: true` unless the body says otherwise; `sanitizeScenario` accepts the boolean. New `POST /api/run/extend`: sets `openEnded`, turns a `finished` status back into `paused`, plays.

`runs/current.json` names the run the app last played, and `session.start()` resumes that one first. Today it takes the most recent unfinished folder, so any CLI run saved as `paused` hijacks the agency at the next boot. If the current run has finished, it opens with the end banner, which offers « Continuer sans fin ». That keeps a founder's history in one run. Only without a current run does the old scan apply.

### 2.3 `api/session.ts`: pace, recovery

```ts
const AWAY_AFTER_MS = 300_000;
const AWAY_TICK_MS = Math.round(604_800_000 / (awayDaysPerWeek() * TICKS_PER_DAY));  // 365 → 138 082 ms
const BACKOFF_MS = [30_000, 300_000];   // from 3 and from 6 consecutive errors
const SKIP_AFTER = 8;                   // same (day, tick)

setWatchers(n: number): void   // wired from SseHub.onClients(cb)
```

- `loopTick`: interval is `BASE_INTERVAL_MS / speed`, or `AWAY_TICK_MS` when `pace === 'away'`.
- `stepUnlocked` on error: never `_playing = false`. `errors ≥ 3` waits `BACKOFF_MS[0]`, `≥ 6` waits `BACKOFF_MS[1]`, `sameTick ≥ SKIP_AFTER` calls `company.skipTick(msg)` and resets. Only `pause()` by the founder stops the loop.
- `runs/<id>/session.log.json` (outside the world, so replay stays pure): `{ startAt, stopAt, clean, day }[]`. A record without `stopAt` at boot means a crash. Digest and `/api/digest` merge it.
- `installCrashGuards` already exists: keep it and add a save on `uncaughtException`.

### 2.4 `api/persist.ts`: saves that survive

```ts
export async function loadWorldSafe(runId, opts): Promise<{ world: WorldState; from: 'world' | 'prev' | 'checkpoint'; lostTicks?: number } | null>
export function saveCheckpoint(world, dir): Promise<void>   // checkpoints/day-0007.json.gz via async zlib
export function migrateWorld(w: WorldState): WorldState     // fills new fields for older saves
```

- Save order: write tmp, rename `world.json` to `world.prev.json`, rename tmp to `world.json`.
- Checkpoints on `day % 7 === 0`: keep the last 4 weekly and one per 30 days, 12 files at most.
- Valid = parses, `looksLikeWorld`, Σ ledger finite.
- `session.start()` uses `loadWorldSafe` before it ever creates a new run. Today a corrupted world.json is skipped and a new run starts: the agency would silently lose its life.

### 2.5 Process

- `npm run agency` (repo root): builds `web/dist` if missing, then runs `scripts/forever.mjs`, which respawns `server/src/api/server.ts` with backoff from 2 s to 60 s, stops on exit code 0, logs to `runs/agency.log`. No dependency.
- README documents how the founder can add it to Windows startup by hand. The app never changes system settings.
- CLI: `--days` up to 3 650, new `--open`, new `--no-scaling`.

---

## 3. Digest

### 3.1 Types

```ts
export interface DecisionRecord {
  id: string; day: number;
  kind: 'stage' | 'budget' | 'launch' | 'double_down' | 'rework' | 'harvest' | 'kill' | 'reopen' | 'list' | 'hire' | 'fire' | 'incident';
  who: AgentId | 'system';
  text: string;            // French
  why: string;             // French, with the numbers behind it
  productId?: string;
  impactEur?: number;      // money it moved or lost, when known
}

export interface WeekRollup {
  week: number; fromDay: number; toDay: number;
  revenue: number; refunds: number; adSpend: number; fees: number; creators: number; other: number; profit: number; cashEnd: number;
  sales: number; bySource: Partial<Record<Order['source'], { n: number; revenue: number }>>;
  roas: number | null; ctr: number | null;
  mains: number; niches: number; listSize: number; ltvFactor: number; stage: StageId; agents: number; tasksDone: number;
}

export interface FounderDigest {
  fromDay: number; toDay: number;
  headline: string;        // French, states a loss as a loss
  money: { revenue: number; refunds: number; adSpend: number; costs: number; profit: number; cashStart: number; cashEnd: number; previousProfit: number | null };
  stage: { from: StageId; to: StageId; changes: { day: number; to: StageId }[] };
  products: { launched: string[]; stopped: { title: string; why: string }[]; reworked: string[]; best: { title: string; profit: number } | null; worst: { title: string; profit: number } | null };
  audience: { size: number; added: number; unsubscribed: number; revenue: number };
  team: { hired: string[]; fired: string[] };   // org pillar fills this through DecisionRecord
  decisions: DecisionRecord[];   // top 12 by |impactEur|, then newest
  mistakes: string[];            // money lost on tests without a keeper, chargebacks, idle cash, stop-losses that fired late
  incidents: string[];           // outages, skipped ticks, crash recoveries, machine off
  waiting: string[];             // what needs the founder, approval tasks first
  next: string[];                // this week's allocation and open bets
}
```

### 3.2 `runtime/digest.ts`

```ts
export function weekRollup(world: WorldState, fromDay: number, toDay: number): WeekRollup   // from the ledger
export function logDecision(world: WorldState, d: Omit<DecisionRecord, 'id' | 'day'>): DecisionRecord
export function buildDigest(world: WorldState, fromDay: number, toDay: number, session?: SessionRecord[]): FounderDigest
```

- `weekRollup` runs in `evening()` on `day % 7 === 0`, before compaction. `growth.weeks` is kept forever: about 15 kB/year. A digest over a year therefore reads no raw ledger.
- Honesty rule, enforced by a test: `Σ money.profit` equals the ledger's profit over the window, and every `skipTick`, crash and machine-off period appears in `incidents`.
- Every Sunday `brain/journal/semaine-NNN.md` is written from the same object, so agents read it too.
- `growth.founder = { lastSeenDay, lastSeenAt }`. `GET /api/digest` defaults to `since = lastSeenDay`. `POST /api/digest/seen` moves it.

---

## 4. Stages and the CFO

### 4.1 Types

```ts
export type StageId = 'survie' | 'adequation' | 'acceleration' | 'portefeuille';   // « Survie », « Adéquation », « Accélération », « Portefeuille »

export interface StagePolicy {
  maxMains: number;
  paidTestEur: number;       // paid euros a main gets before it can be judged
  testDailyEur: number;      // daily budget of a paid test (replaces the 40 € clamp of launchBudget)
  creativesPerCampaign: number;
  split: { scale: number; test: number; payroll: number; reserve: number };   // share of weekly profit, sums to 1
  reserveDays: number;
  bumpMinSales: number | null;      // main sales before it gets a kit, null = none
  magnetMinSales: number | null;    // main sales before it gets a lead magnet, null = none
}

export interface GateCheck { label: string; value: number; target: number; ok: boolean }    // French label
export interface GateProgress { next: StageId | null; checks: GateCheck[]; weeksHeld: number; weeksNeeded: number }

export interface Allocation {
  week: number; day: number;
  profit7: number; profit28: number; spend7: number; roas14: number | null; net: number; ltv: number;
  beRoas: number; scaleRoas: number; trimRoas: number;
  reserve: number; free: number; leak: boolean;
  adTarget: number;          // €/day, soft target under the CFO cap
  testWeek: number;          // € of paid tests for new lines this week
  payrollCap: number;        // €/day, read by the org pillar
  note: string;              // French
}

export interface GrowthState {
  stage: StageId; stageSinceDay: number; gateWeeks: number; floorWeeks: number; gate: GateProgress | null;
  allocation: Allocation | null;
  portfolio: PortfolioReview | null;
  niches: Record<string, NicheRecord>;
  weeks: WeekRollup[];
  decisions: DecisionRecord[];
  ltvFactor: number;
  founder: { lastSeenDay: number; lastSeenAt: string | null };
}
```

`CompanyState.growth?: GrowthState`.

### 4.2 `runtime/stages.ts`

| | survie | adequation | acceleration | portefeuille |
|---|---|---|---|---|
| `maxMains` | 2 | 4 | 8 | 12 |
| `paidTestEur` | 100 | 150 | 150 | 200 |
| `testDailyEur` | 20 | 25 | 40 | 60 |
| `creativesPerCampaign` | 3 | 3 | 5 | 6 |
| split scale / test / payroll / reserve | 0,7 / 0,3 / 0 / 0 | 0,55 / 0,3 / 0,05 / 0,1 | 0,5 / 0,2 / 0,1 / 0,2 | 0,45 / 0,2 / 0,15 / 0,2 |
| `reserveDays` | 7 | 10 | 14 | 21 |
| `bumpMinSales` | null | 40 | 20 | 20 |
| `magnetMinSales` | null | 30 | 15 | 15 |

Gates, checked every Monday stand-up (`day % 7 === 1`) on closed days, from the ledger and ad stats:

| To | Gate | Held for |
|---|---|---|
| adequation | profit 14 d > 0; one main with ≥ 15 sales in 14 d and ROAS 14 d ≥ 1,2 on ≥ 80 € of ads | 1 check |
| acceleration | profit 14 d ≥ 150 €; ≥ 2 mains with positive 14 d contribution; cash ≥ 1,5 × start | 2 checks |
| portefeuille | profit 28 d ≥ 800 €; ≥ 4 mains with positive 28 d contribution in ≥ 3 niches; top main ≤ 60 % of contribution; owned revenue (email + upsell + bump) ≥ 10 % of revenue over 28 d | 2 checks |

Down: back to `survie` at once on `budget.survival` or bankruptcy; one stage down after 3 consecutive checks with profit 28 d < 0. Every change writes a `DecisionRecord` and a French feed line from Camille.

```ts
export function policyOf(world: WorldState): StagePolicy      // LEGACY_POLICY when growthOn(world) is false
export function evaluateStage(ctx: RuntimeCtx): GateProgress
export function advanceStage(ctx: RuntimeCtx): void
```

`LEGACY_POLICY` carries today's constants, so the control arm is today's company.

Gate numbers are checked once in the final bounded calibration, not tuned earlier.

### 4.3 `runtime/cfo.ts`

Runs in `morning()` after `budget_review`, on `day % 7 === 1`. Everything is observable: ledger, ad stats, orders.

```
net      = 1 − refundRate28 − feeRate28                     // ledger, ≈ 0,88
ltv      = clamp(1 + followOn56 / firstOrder56, 1, 1,8)     // followOn = sources upsell + email + bump; needs firstOrder56 ≥ 300 €, else 1
beRoas   = 1 / (net × ltv)                                  // ROAS at which ads pay for themselves
scaleRoas = max(1,25, 1,3 × beRoas)
trimRoas  = max(0,9, 1,05 × beRoas)
reserve  = max(0,3 × startingCash, reserveDays × (fixedDaily + payrollDaily + 0,5 × spend7))
free     = max(0, cash − reserve)
leak     = spend14 ≥ 100 and roas14 < beRoas
scaleAdd = leak ? 0 : split.scale × max(0, P7) / 7
testAdd  = split.test × max(0, P7) / 7
idle     = max(0, free − 14 × (spend7 + scaleAdd + testAdd))
scaleAdd += leak ? 0 : idle / 14                            // sleeping cash goes to work
adTarget = min(spend7 + scaleAdd + testAdd, rate × cash, free / 7)
if leak: adTarget = min(adTarget, 0,8 × spend7 + testAdd)
testWeek = 7 × (testAdd + (leak ? 0,2 × spend7 : 0))        // a leaking bucket funds exploration, not more of itself
payrollCap = split.payroll × max(0, P28) / 28
```

Example, week with P7 = 420 €, spend7 = 80 €/day, cash 3 800 €, `acceleration`, LTV 1,2, net 0,88: beRoas 0,95, scaleRoas 1,25. Reserve 580 €, free 3 220 €, scaleAdd 30 + idle 108 = 138 €/day, testAdd 12 €/day, adTarget 230 €/day. That is 2,9 × today, inside the 570 €/day cap. `adTarget` is room, not an order: a campaign only grows if it passes `scaleRoas`, at +30 %/day at most.

What changes in existing code, gated by `growthOn`:

| Where | Now | With growth |
|---|---|---|
| `computeBudget` | `adCap = rate × cash` | `min(rate × cash, cash − reserve)`: stricter, never looser |
| `launchBudget` | `clamp(cash × 0,04, 5, 40)` | `clamp(cash × 0,04, 5, policy.testDailyEur)` |
| `scalingRoom` | envelope × 0,75 when a product waits | `adTarget` minus what is committed, minus a share for tests |
| `optimize_ads` scale | recent ROAS ≥ 1,8 and yesterday ≥ 1,4 | recent ≥ `scaleRoas` and yesterday ≥ `0,78 × scaleRoas` |
| `optimize_ads` trim | recent < 1,3 | recent < `trimRoas` |
| `launch_campaign` | `ready.slice(0, 3)` | `ready.slice(0, policy.creativesPerCampaign)`: less fatigue per creative |
| `strategy.ts` capacity | `floor(adCap / 30)`, max 8 | `policy.maxMains` |

Unchanged guardrails: 15 % / 8 % cap, stop-loss, +30 %/day, survival mode, founder approval and holds, compliance, ledger as the only money.

Why average ROAS and not a marginal estimate: profit is flat near the optimum, so the average rule overshoots at little cost. At ROAS₀ = 2 and break-even 0,91 it stops at V/pool ≈ 0,95 against an optimum of 0,79.

Rules in the brain: new seed note `brain/business/Croissance.md` holds the stage table, gates and formulas in French; `Budget et garde-fous.md` gains rules 10 to 12 (reserve, reinvestment, harvest before kill); `Playbook Finance.md` gets a « Chaque lundi » section. A test parses the note and fails if it disagrees with `STAGE_POLICY`.

---

## 5. Portfolio

### 5.1 Types

```ts
export type PortfolioVerdict = 'test' | 'double_down' | 'keep' | 'rework' | 'harvest' | 'kill';

export interface PortfolioLine {
  productId: string; nicheId: string; title: string;
  verdict: PortfolioVerdict; reason: string;       // French, with numbers
  contribution28: number;   // product + its follow-up and kit, ledger
  roas14: number | null; paidTested: number; share: number;
}

export interface PortfolioReview {
  day: number; week: number; lines: PortfolioLine[];
  slots: { used: number; max: number }; notes: string[];
}

export type NicheCloseReason = 'no_test' | 'quality' | 'market' | 'redteam';

export interface NicheRecord {
  nicheId: string; attempts: number; paidEur: number; strikes: number;
  lastEndDay: number | null; lastReason: NicheCloseReason | null; reopenDay: number | null;
  bestRoas14: number | null; bestPrice: number | null;
}
```

### 5.2 `runtime/portfolio.ts`

`reviewPortfolio(ctx)` runs on Monday through a new ritual `portfolio_review` (`runImmediate`, Direction), after the CFO. For each live main:

```
if productHealth.severe                                 → existing pause/rework path, unchanged
paid = ad spend on the current version
if paid < policy.paidTestEur                            → 'test'   never killed, queued for a paid test
elif roas14 ≥ scaleRoas and contribution28 > 0          → 'double_down'
elif contribution28 > 0                                 → 'keep'
elif version < 3 and (buyersUnhappy or cvrDrop ≥ 30 %)  → 'rework'
elif rating ≥ 3,2 and refundRate28 ≤ 0,2                → 'harvest'
else                                                    → 'kill'
```

- `cvrDrop`: paid conversion over the last 14 days against the best 14-day window of this version, at least 200 views each. This is how rival pressure is seen without reading it.
- `double_down`: first in the budget queue, and the plan creates what is missing: creative refresh, follow-up, kit, lead magnet, sequence.
- `harvest`: no paid ads and no ad creatives, one organic slot a week, stays on the list. It frees a main slot but keeps its niche occupied.
- A harvested product may get one new paid test 45 days later, once, if its price or version changed.
- `ceoDecisions`, third loop, under `growthOn`: `failing` needs `paidTested ≥ paidTestEur`, and `recentLoss` stops ads instead of killing. The five 0 € kills of the measured run disappear.

### 5.3 Niches reopen

`excludedNiches` becomes `closedNiches(ctx, opts)`, reading `growth.niches`:

| Closed because | `lastReason` | Reopens after |
|---|---|---|
| Stopped without a paid test | `no_test` | 14 days |
| Buyers disliked it | `quality` | 30 days |
| Paid test lost money | `market` | 60 days, +1 strike |
| Red Team killed the idea | `redteam` | 90 days, +1 strike |
| 2 strikes | | 180 days, last attempt |

A reopened niche keeps its research, its per-niche bandits and `bestPrice`, so the second attempt starts from what was learned. Trap niches with `redteam` kills cost almost nothing to re-examine, since the Red Team kills them before production. A `reopen` decision is logged.

---

## 6. Market mechanics (constants in `sim/growth.ts`, `sim/balance.ts` untouched)

```ts
export const GROWTH = {
  email: {
    optin: { ads: 0.035, organic: 0.02, creator: 0.05 },   // × min(1,2, page quality / 85)
    buyerOptin: 0.85,
    open: { lead: 0.30, buyer: 0.40, welcome: 0.50, ageDays: 180, floor: 0.08 },
    click: { lead: 0.05, buyer: 0.07, welcome: 0.10 },
    cvrMult: { lead: 4, buyer: 5 },                         // on baseCvr: about 10-12 %
    crossCategory: 0.5,                                     // same category, other niche
    fatiguePerSend: 0.08, fatigueDecayDaily: 0.02,
    unsub: { base: 0.004, fatigue: 0.02, noLinkFactor: 3 },
    costPer1000Daily: 0.2, freeSubscribers: 500,            // tool_subscription, ref email:<day>
    maxSendsPerWeek: 2, bucketMonths: 6,
  },
  bump: { rate: 0.22, priceShare: 0.3, minPrice: 5, maxPrice: 9 },
  rivals: { baseDaily: 0.02, refSalesPerDay: 4, pressureMin: 0.06, pressureMax: 0.10, halfLifeDays: 60, maxTotal: 0.3, refreshCut: 0.5, maxListed: 12 },
  brand: { scale: 1500, maxPool: 0.5, decayDaily: 1 / 365 },
};
```

These are starting values. They move once, in the final bounded calibration.

### 6.1 Streams: nothing shifts

`DAY_PHASES.forEach((run, i) => streamRng(dayKey, i))` becomes an explicit table. Existing phases keep their numbers, events keep stream 11, new phases take 100 and up:

| Order | Phase | Stream |
|---|---|---|
| 1-4 | housekeeping, runAds, runOrganic, runCreators | 0-3 |
| 5 | **runEmail** | 100 |
| 6 | runSales | 4 |
| 7 | **runCapture** | 102 |
| 8 | **runBumps** | 103 |
| 9-14 | runUpsells, runRefunds, runReviews, runFriendlyFraud, runInbox, runEscalations | 5-10 |
| 15 | rollEvents | 11 |
| 16 | **runRivals** | 101 |
| 17 | **updateBrand** (no draw) | none |

`runEmail` pushes `Traffic` rows after every other source, so each product's stream sees the same draws for its earlier rows. `runBumps` runs before `runUpsells` because fees are booked at the end of it. `runSales` keeps its per-product streams.

### 6.2 The owned audience (`sim/audience.ts`)

```ts
export interface ListBucket { nicheId: string; kind: 'lead' | 'buyer'; month: number; size: number; fatigue: number }

export interface EmailStep { day: 0 | 2 | 4 | 7 | 10; kind: 'value' | 'pitch'; subject: string; body: string; score: number }
export interface EmailSequence { id: string; nicheId: string; productId: string; steps: EmailStep[]; status: 'active' | 'off'; day: number; createdBy: AgentId }

export interface Broadcast {
  id: string; day: number; nicheId: string; productId: string; audience: 'niche' | 'launch';
  subject: string; body: string; angle: string; score: number; hasUnsubscribe: boolean;
  status: 'queued' | 'sent'; delivered: number; opens: number; clicks: number; sales: number; revenue: number; unsubscribed: number;
}

export interface AudienceState {
  buckets: ListBucket[];
  welcome: Record<string, number[]>;     // nicheId → leads by day of the sequence, index 0..10
  sequences: EmailSequence[];
  queue: Broadcast[]; sent: Broadcast[]; // sent: last 120
  totals: { leads: number; buyers: number; unsubscribed: number; delivered: number; opens: number; clicks: number; sales: number; revenue: number };
}

export interface AudienceView {          // what the UI and agents read
  size: number; leads: number; buyers: number; byNiche: { nicheId: string; size: number; openRate: number | null }[];
  unsubscribed: number; dailyCost: number; recent: Omit<Broadcast, 'body'>[]; sequences: { nicheId: string; productId: string; status: string }[];
}
```

Why cohorts: a list of 20 000 as `Customer` rows is 3 MB and an O(n) scan per send, and nothing in the market needs identity. State stays O(niches × months): buckets older than `bucketMonths` merge into one cold bucket per (niche, kind), so at most 224 rows (16 × 2 × 7). Unsubscribes are real: they decrement the bucket and nobody is mailed past `size`, which is what the invariant test checks.

Daily mechanics:

- **Capture** (`runCapture`): for each product with a lead magnet, non-buying visitors of the day from `d.traffic` (paid, organic, creators) × `optin` × page factor enter `welcome[niche][0]`. Saturated visitors count too: the list recovers part of what saturation wastes. Buyers × `buyerOptin` enter this month's buyer bucket.
- **Welcome** (`runEmail`): the pipe shifts one day; at each step offset, the people there are sent that step. `pitch` steps create `Traffic` with `source: 'email'`, `cvrMult: cvrMult.lead`. After day 10 they join the lead bucket.
- **Broadcast**: for each queued broadcast, for each target bucket: `opens = binomial(size, openRate)`, `clicks = binomial(opens, clickRate)`, then one `Traffic` row per bucket. `openRate = open[kind] × (score/70 clamped 0,7..1,2) × (1 − fatigue) × max(floor/open, e^(−age/ageDays))`. `audience: 'launch'` also reaches buyers of the same category at `crossCategory`.
- **Sales**: email traffic skips niche saturation (`nicheViews` ignores it) and goes through `runSales`, so orders, ledger, fees, refunds, reviews and support all work as usual and price and quality matter. `traffic.repeat = true` picks an existing buyer of the niche from hot orders, else a new customer.
- **Unsubscribes**: `delivered × (unsub.base + unsub.fatigue × bucket.fatigue)`, × `noLinkFactor` if the unsubscribe line is missing.
- **Cost**: `max(0, size − freeSubscribers) / 1000 × costPer1000Daily`, booked daily.

Expected value per 100 paid views (about 58 € first-order): bump +6,6 %, upsell +8 %, leads +5,9 %, buyers +6,2 %, so LTV ≈ 1,27 over 180 days, deferred. At 6 niches with 2 000 subscribers each, broadcasts bring about 440 €/week for 17 €/week of tool cost. Near-free margin is what lifts `ltv`, lowers `beRoas`, and pays for more ads: the flywheel, in the code.

Company side:

- New kinds: `write_lead_magnet`, `write_email_sequence`, `send_broadcast`, `design_bump`, `portfolio_review`.
- `runtime/handlers/lifecycle.ts`, `runtime/audience.ts` with `planAudience(ctx, items, notes)`.
- New engine methods: `writeLeadMagnet`, `writeEmailSequence`, `writeBroadcast`, heuristic ones built on VoC and the guide's own bonus sheets.
- `sim/quality.ts`: `scoreEmail(subject, body, voc, bannedClaims)`, same generic-phrase and banned-claim checks as ads.
- `MarketTools`: `listStats(): AudienceView`, `activateSequence(input): ToolResult`, `sendBroadcast(input): ToolResult`. A real adapter later is Brevo or Klaviyo, and the company code does not change.
- One broadcast per niche per week when its list ≥ 200, on a live product of the niche not pitched in the last 3 weeks. New bandit `email_angle:<nicheId>`, rewarded by open rate.
- `publish_product.onDone` queues a `launch` broadcast. New guides get their first buyers and reviews from the list, which moves `trustFactor` from 0,8 toward 1,2 sooner.
- Guardrails: `findBannedClaims` on every email; no broadcast for a product under a founder hold; approval mode gates activation and each broadcast through `awaitFounder`. Holds need a new kind `emails`.

### 6.3 Order bump, rivals, brand

**Kit** (`Product.kind = 'kit'`, `parent.bumpProductId`): a real printable PDF made from the parent's sheets, checklists and bonus grids, its count and its plan leaving out what its sheets already hold (D156). It uses `createUpsellPipeline` with `input.kit = true`, without sales page length. `isUpsellProduct` includes kits, so they get no cold ads and are not judged alone.
`runBumps`: for each non-upsell order of the day, chance `GROWTH.bump.rate × priceFactor`, `newOrder(d, kit, 'bump', …)`. Price `clamp(round(0,3 × parent.price), 5, 9)`. A kit as its own product means `order.price` stays the guide's price, so pricing evidence, `overprice` and refunds keep their meaning. `runUpsells` and `runInbox` skip `bump` orders in their base, as they skip `upsell`.

**Rivals** (`sim/rivals.ts`):

```ts
export interface Rival { id: string; nicheId: string; day: number; pressure: number; price: number }
```

Daily chance per niche `baseDaily × clamp(sales14PerDay / refSalesPerDay, 0, 2)`. Pressure decays with `halfLifeDays`. `rivalFactor(niche) = 1 − min(maxTotal, Σ pressure)` multiplies `baseCvr`. A rival also appears in `niche.competitors`, so `listCompetitors` shows it. Publishing a new version multiplies that niche's pressures by `refreshCut`. A niche selling 4/day draws a rival every 50 days and settles near −14 % conversion: a winner must be reinvented every few months, which is what `cvrDrop` detects. `competitorClone` calls `addRival` with pressure 0,1 and no longer raises `competition`, which over a year ratchets a niche toward 0,95 for good.

**Brand** (`sim/capacity.ts`): `market.brand[niche]` is a stock: `s = s × (1 − decayDaily) + buyers today`.

```ts
export function nichePool(world: WorldState, n: NicheTruth, channel?: string): number {
  const awareness = 1 - Math.exp(-(world.market.brand?.[n.id] ?? 0) / GROWTH.brand.scale);
  return (CONVERSION.poolBase + CONVERSION.poolDemand * n.demand) * (1 + GROWTH.brand.maxPool * awareness);
}
```

A niche selling 3/day holds +26 % capacity. `runSales` calls `nichePool`; the channels pillar owns the `channel` argument.

---

## 7. Long runs

### 7.1 Targets

| Measure | Target at D365 | Stress at D1095 |
|---|---|---|
| Headless time, seed 7 normal | ≤ 150 s | ≤ 450 s, roughly linear |
| p95 day | ≤ 800 ms | ≤ 800 ms |
| world.json | ≤ 12 MB | ≤ 1,2 × D365 |
| Heap peak | ≤ 500 MB | ≤ 500 MB |
| Live snapshot | ≤ 400 kB | same |
| `GET /api/state` | ≤ 700 kB in bytes with DEFAULT or TIGHT limits, session and 30 films in (D155), never LIVE | same |
| Run folder without video | ≤ 150 MB | ≤ 400 MB |

### 7.2 Compaction

`runtime/compaction.ts`, called at the end of `evening()` when `day % 7 === 0`, after `weekRollup`:

```ts
export const COMPACT = {
  taskDays: 21, missionDays: 14, orderDays: 120, customerDays: 120, ledgerDays: 150, commentsDays: 14, creativeDays: 45,
  campaignDays: 100, experimentDays: 90, partnershipDays: 90, killedProductDays: 30, reviewsPerProduct: 60, deliverables: 300, retiredLessons: 40, journalDays: 60,
};
export interface ArchiveBatch { day: number; rows: Partial<Record<ArchiveCollection, unknown[]>>; dropFiles: string[] }
export function compactWorld(world: WorldState): ArchiveBatch   // pure on the world: no rng, no ids, no clock
```

`CompanyOptions.archive?: (batch: ArchiveBatch) => Promise<void>`. `mountWorld` wires `api/archive.ts`; bench passes a no-op. Rows append to `runs/<id>/archive/<collection>.ndjson` **before** the world save. A crash between the two recompacts the same rows, and readers dedupe by id. The sim never reads the archive, so replay and reload stay pure.

| Collection | Stays in the world | Reader that needed the old rows, and what replaces it |
|---|---|---|
| tasks | open; finished < 21 d; referenced by an open task or open mission; latest done per (kind, product) for titles, outline, pdf, red_team, design_upsell, pick_opportunity, budget_review | `versionSince` → `product.versionDay`; `detectedComplaints`, `customerFeedback` → `product.feedback[]` (cap 30); `hookPool` → `product.hooks[]` (cap 60); `lastScan`, `lastScout`, `lastPage` → `company.lastDone[kind:product]`; `cashOnly` creators → `company.cashOnlyCreators`; `taskStatsOf` → `company.taskTotals` plus live rows |
| missions | founder's; open; closed < 14 d | none |
| orders | < 120 d | `productMetrics` clamps `sinceDay` to D−119; `all.sales` → `p.stats.sales`; `productHealth` window `HEALTH_WINDOW_DAYS = 90`, which also fixes the ROAS bug of §0.3; `lastChange` clamped to D−60 |
| customers | in hot orders or open messages | `customersCount` adds `archive.customers`; `hostileBuyer` reads hot orders in both modes |
| ledger | days < 150 d old; `capital`; the `setup` line; open holds; plus one rollup per (month, type) | `summarizeLedger` unchanged, since Σ is preserved |
| adStats | 90 d as today; `comments` dropped after 14 d | `trimAdStats` already bounds UI reads |
| creatives | in a campaign, < 45 d, or last 10 of a live product | `creativeImpressions` pruned; hooks kept on `product.hooks` |
| campaigns | active, or stopped < 100 d | `adHistory`: past 90 d they have no stats and already break the streak; `launch_campaign` numbering → `product.campaignCount` |
| products | all, as stubs: killed for 30+ d lose `content` and `salesPage` to the archive | niche memory, parent links |
| reviews | last 60 per product | `stats.ratingSum`, `stats.ratingCount` keep `rating` and `storeRating` exact |
| deliverables | last 300 + those of live products | Gallery pages through `GET /api/deliverables` |
| experiments | running; concluded < 90 d; latest per (dimension, niche, variants) | `alreadyAnswered`, `priceMove` |
| brain | daily journals < 60 d; older ones merge into `journal/mois-NN.md` | search stays O(recent notes) |

Three traps a build must not miss:

1. **`setup` ref.** `tickMarket` books launch costs when no entry has `ref === SETUP_REF`. A rollup that swallows it books 60 € again. Rollups skip `capital`, `setup` and every open hold; a test pins it.
2. **Rollup ids** are `led_roll_<yyyy>_<type>`, never from `nextId`: `idCounter` must not move, or activity ids and every later id diverge.
3. **Holds.** Rollup keeps the `hold:` prefix so `isHold` still excludes them from profit, and uses a `hold:rollup:` ref for released pairs only.

`runtime/world.ts` and `api/persist.ts`: `world.version` becomes 2, `migrateWorld` fills `versionDay` from tasks, sums from reviews, and so on. Older saves stay loadable.

Files on disk: when a creative is archived, `dropFiles` removes its frames except `frame-1.svg` and the preview. Video pillar limits are in §10. `learning/vault.ts`: `CACHE_TTL_MS` goes from 5 s to 60 s, since every write through the API already updates the index and a rebuild reads every note, which is costly on Windows at 1 000 notes.

Snapshot: `LIVE_LIMITS` gets `doneTasks: 40`; live products exclude killed ones past the last 12. Hidden truth stays out by whitelist; audience goes through `AudienceView`, rivals never leave the server.

---

## 8. Reaching the UI (needs from the ui pillar)

Snapshot gains, under 40 kB together:

```ts
company.growth: Pick<GrowthState, 'stage' | 'stageSinceDay' | 'gate' | 'allocation' | 'portfolio' | 'ltvFactor'> & { weeks: WeekRollup[]; decisions: DecisionRecord[] }  // last 52 weeks, last 30 decisions
market.audience: AudienceView
archive: ArchiveCounters
session.pace, session.watchers, session.backoffMs
```

Endpoints: `GET /api/digest`, `POST /api/digest/seen`, `GET /api/growth` (all weeks and kept decisions), `POST /api/run/extend`, `GET /api/product/:id` (full guide text, since the live snapshot has none), `GET /api/deliverables?page=`.

Screens:

- New tab **Croissance**: stage track with `GateCheck` rows; weekly revenue and profit bars; this week's allocation; `PortfolioLine` table with verdict and reason; decision timeline.
- **Liste e-mail** inside it: funnel (visitors → leads → buyers), unsubscribes, recent broadcasts, cost.
- **DigestModal**: opens when `day − lastSeenDay ≥ 7`, headline first, losses shown as plainly as gains.
- Hud: `∞` instead of the horizon, a discreet « au ralenti : personne ne regarde » when `pace === 'away'`, the stage name. CalendarTab must not assume a horizon. EndBanner: « Continuer sans fin ». ScenarioModal: toggle « Sans fin », default on.

---

## 9. Proving it

### 9.1 Growth bench: `server/scripts/growth.ts`

```
npx tsx scripts/growth.ts --days 180 --seeds 1-30 --difficulty normal --jobs 8 --json growth.json [--perturb 0.0001]
```

Each seed runs twice on the same market, `scaling: true` and `scaling: false`, heuristic mind. Reads `growth.weeks`, written in both arms. About 60 × 55 s / 8 = 7 minutes.

Pass, judged only on 30 seeds and only paired:

| # | Criterion | Target |
|---|---|---|
| A1 | Net revenue weeks 21-26, scale / control, median of per-seed ratios | ≥ 2,0, and > 1 in ≥ 24/30 seeds |
| A2 | Cumulative profit D180, scale / control, median of per-seed ratios | ≥ 1,5 |
| A3 | Theil–Sen slope of weekly net revenue, weeks 9-26 | > 0 in ≥ 24/30 seeds; median week 26 / week 9 ≥ 2,0 |
| A4 | Early stages unhurt: profit D60 scale / control, median | ≥ 0,8 |
| A5 | Bankruptcies | ≤ control + 1 |
| A6 | Invariants on every day | committed ads ≤ CFO cap; KPI = ledger; no email past `size`; no NaN |

The curve that proves scaling is **net revenue per week, seed by seed, against its own control**, slope and end level. `A3` on the control arm is expected to be flat, near the 1 100 €/week plateau of §0.1. Rules from past mistakes apply: first measure the 180-day noise floor with `--perturb`, then at most one calibration pass, at most 4 candidates, 30 seeds each, then stop. If a criterion fails after that pass, report the measured number instead of tuning further.

### 9.2 Long-run check: `server/scripts/longrun.ts`

`--days 365` (and 1095 once): logs world size, section sizes, ms/day, heap, live snapshot bytes every 30 days, and fails on any target of §7.1. Not in `npm test`; a `test:long` script. 365-day survival is also checked on 10 seeds: no crash, Σ ledger = cash.

### 9.3 Tests that fail without the feature

`server/test/growth.test.ts`, `longrun.test.ts`, additions to `api.test.ts` and `runtime.test.ts`:

| # | Test | Fails today because |
|---|---|---|
| 1 | Open-ended run passes its horizon by 3 days, status not `finished` | `advance()` finishes it |
| 2 | `session.start()` on a saved run plays at once, same runId, no call | guards the existing behaviour against the new load path |
| 3 | Corrupt `world.json`, valid `world.prev.json`: same run resumes, incident recorded | a new run starts |
| 4 | Engine throws on every step: after 8 tries the day advances, loop still playing | pauses after 3 errors |
| 5 | Fake timers: no watcher for 5 min gives away pace, one watcher gives speed back | no pace |
| 6 | Digest profit equals ledger profit; a skipped tick and a killed product both appear | no digest |
| 7 | Stage: gate held once does not promote to `acceleration`, twice does; `budget.survival` demotes at once | no stages |
| 8 | Synthetic ledgers: `adTarget` ≤ `rate × cash`, cash after a day of `adTarget` ≥ reserve; `leak` adds nothing to scale | no CFO |
| 9 | Higher follow-on revenue lowers `beRoas`, and `optimize_ads` scales a campaign it refused before | fixed 1,8 |
| 10 | A main with 0 € of ads and few sales for 14 days is not killed | killed today, as in §0.1 |
| 11 | Paid loser with happy buyers is `harvest`, stays on sale, no ads; rating 2,5 is `kill` | killed |
| 12 | Killed niche with `no_test` is pickable after 14 days; 2 strikes: not before 180 | banned forever |
| 13 | Email: Σ delivered per send ≤ bucket size; with capture off, list size never rises; 400 days keep ≤ 224 buckets | no list |
| 14 | Day with email and kit orders: `reconcileDay` gaps = 0, `Σ ledger = cash` | no such orders |
| 15 | Refund of a kit order leaves the guide's order alone; `priceTiers` of the guide unchanged by bumps | no kit |
| 16 | Stream isolation: forcing a rival on D10 leaves ad stats of D1-10 identical; `scaling` false and true share D1 market draws | no explicit streams |
| 17 | Rival lowers CVR, decays, `publish` of a new version halves it; ceiling ≤ 0,3 | no rivals |
| 18 | `nichePool` ≤ 1,5 × base at any stock | no brand |
| 19 | **Compaction changes no decision:** same seed, 150 days, `compactWorld` on and off: daily KPI series identical byte for byte (`test:long`) | no compaction |
| 20 | Reload on every tick of a day containing a compaction ends identical to a straight run | extends the existing reload test |
| 21 | Synthetic 400-day ledger: `summarizeLedger` equal before and after; the setup fee is not rebooked; holds intact; `idCounter` unmoved | no rollup |
| 22 | Synthetic D365 world: live snapshot ≤ 400 kB, no `NicheTruth`, no `Rival` in it | 618 kB at D120 |
| 23 | Archive written twice: reader returns each id once | no archive |
| 24 | `brain/business/Croissance.md` states the same numbers as `STAGE_POLICY` | no note |

---

## 10. What I need from the other pillars

| Pillar | Need |
|---|---|
| **org** | `roleHolder(world, role)` instead of hard-coded `gabriel`, `camille`, `nora`. Owners for the 5 new task kinds, a lifecycle or email role among them. A `salary` ledger type and `payrollDaily(world)`; it reads `Allocation.payrollCap` as the hiring limit. Support capacity that grows with volume: `strategy.ts` caps replies at 24 a day (`i < 24`), and past 100 sales/day that cap turns into chargebacks. Hires and fires call `logDecision`. |
| **talent** | Skill multipliers act on quality, so they raise ROAS and `ltv` here with no coupling. `agents` count in `WeekRollup`. |
| **channels** | `nichePool(world, n, channel)`: pool per (niche, channel), so capacity adds up. Extend `Order['source']` next to my `email` and `bump`. Keep the `Traffic` shape and ledger refs. ROAS by channel feeds `roas14` as one number. Email is mine: it must not be rebuilt as a channel. |
| **video** | No render during bench or in heuristic-only headless runs unless asked. Video only for creatives past 1 000 impressions, `maxVideoDiskMb` per run, and a `retireCreativeFiles` hook for `dropFiles`. At 2 MB per ad, 480 creatives a year is 1 GB. |
| **pdf** | Templates `renderLeadMagnet` (3-5 pages) and `renderKit` (grids, checklists), from a `PdfContent`. Size per guide stays under 2 MB. |
| **ui** | §8. |

---

## 11. World additions and files

Every new field lives in the world, so a reload at any tick goes on as if it never stopped. All are optional on the type and filled by `migrateWorld`; `version` becomes 2.

```ts
CompanyState  += growth?: GrowthState; lastDone?: Record<string, number>; taskTotals?: TaskTotals; archive?: ArchiveCounters; cashOnlyCreators?: string[];
Product       += kind?: 'guide' | 'kit'; bumpProductId?: string | null; leadMagnet?: { title: string; file: string; day: number } | null;
                 versionDay?: number; feedback?: { day: number; text: string; quality: boolean }[]; hooks?: { hook: string; hookStyle: HookStyle }[]; campaignCount?: number;
ProductStats  += ratingSum?: number; ratingCount?: number;
MarketState   += audience?: AudienceState; rivals?: Rival[]; brand?: Record<string, number>;
Order.source  += 'email' | 'bump';
TaskKind      += 'write_lead_magnet' | 'write_email_sequence' | 'send_broadcast' | 'design_bump' | 'portfolio_review';
FounderHold.kind += 'emails';
Deliverable.kind += 'lead_magnet' | 'email_sequence';

export interface ArchiveCounters { throughDay: number; tasks: number; missions: number; orders: number; customers: number; ledger: number; creatives: number; deliverables: number }
export interface TaskTotals { days: DayTaskCounts[]; depts: Partial<Record<DeptId, { done: number; delaySum: number }>> }
```

No new `LedgerType` here: email cost is `tool_subscription`, kits and email sales are `revenue`, tests are `ad_spend`. The org pillar adds `salary`.

New: `runtime/stages.ts`, `runtime/cfo.ts`, `runtime/portfolio.ts`, `runtime/audience.ts`, `runtime/digest.ts`, `runtime/compaction.ts`, `runtime/handlers/lifecycle.ts`, `sim/growth.ts`, `sim/audience.ts`, `sim/rivals.ts`, `sim/capacity.ts`, `api/archive.ts`, `minds/heuristic/lifecycle.ts`, `scripts/growth.ts`, `scripts/longrun.ts`, root `scripts/forever.mjs`, `brain/business/Croissance.md`, tests above.

Changed: `shared/types.ts`, `contracts.ts`, `sim/tick.ts`, `sim/events.ts`, `sim/tools.ts`, `sim/quality.ts`, `sim/feedback.ts` (rating sums), `runtime/company.ts`, `runtime/strategy.ts`, `runtime/acquisition.ts`, `runtime/metrics.ts`, `runtime/pipeline.ts`, `runtime/tasks.ts` (`KIND_META`), `runtime/handlers/growth.ts`, `handlers/boutique.ts`, `handlers/research.ts`, `handlers/support.ts` (`product.feedback`), `handlers/ops.ts`, `learning/kpi.ts`, `learning/vault.ts`, `api/session.ts`, `api/persist.ts`, `api/trim.ts`, `api/sse.ts`, `api/server.ts`, `api/http.ts`, `cli.ts`, `brain/politiques/Budget et garde-fous.md`, `brain/playbooks/Playbook Finance.md`, `brain/00 - Accueil.md`, `docs/ARCHITECTURE.md`, `docs/BALANCE.md`, `docs/ROADMAP.md`, `README.md`.

---

## 12. Rejected

| Idea | Why not |
|---|---|
| Bundles | Same buyers as the upsell, so they cannibalise it, and they need a merged-PDF pipeline. The kit gives the AOV lift with a new deliverable. |
| Annual seasonality | Noise on the curve, no effect on the slope, harder benchmark. `seasonal_boost` stays. |
| Subscriptions or memberships | Best real-world slope, but they need fresh monthly content the engine cannot honestly produce. |
| A production cost per guide or creative | Only a tax: 20 € a guide and 2 € a creative is 756 € on the measured run, 20 % of profit, with no decision behind it. The real cost of a new line is its paid test. |
| Individual subscriber rows | Unbounded memory, O(n) sends, and nothing in the market needs identity. |
| Doubling the catalog to 32 niches now | Each niche is about 250 lines of researched French, and guide quality rests on it. First thing to do once the ceiling is reached; not needed before D240. |
| Marginal ROAS estimator | Too noisy on 3-7 days, and the average rule loses little near the optimum. |
| Wall-clock catch-up | Fast-forwarding a week at boot blocks the app for minutes and helps nobody; the digest states the gap. |
| SQLite or event sourcing | Breaks "one serialisable object" and the reload test, adds a dependency; bounded JSON plus NDJSON is enough. |
| Weekly per-product buckets for exact old windows | More state to get approximate answers; clamping lookbacks is simpler and makes decisions saner. |
| Founder dividends | Nothing to decide yet; the digest shows the cash. |
| Installing an OS service | That changes system settings; `forever.mjs` plus a README note leaves the choice to the founder. |
| Discount campaigns to the list | Teaches the list to wait, and the sim would need price memory per bucket. |
| Automatic approvals when the founder is away | Founder approval is a guardrail; the digest lists what is waiting. Open-ended autonomy runs with approval off, the default. |

---

## 13. Risks

1. **Email constants are estimates.** LTV 1,27 is a calculation, not a measure; A1 depends on it. The final calibration holds it to the bound of §9.1.
2. **Pricing drift limits everything.** The best product of the measured run ended at 14 €, the paid floor, with a sweet price of 19-20 €. At 14 € a sale barely pays its CAC, and no reinvestment fixes that. `priceMove` deserves a look during the build: if A1 misses, check there first.
3. **Compaction is only as safe as the reader audit.** New readers from other pillars can look past a horizon. Test 19 catches it, at 150 days, and it must run after every pillar lands.
4. **The control arm must stay today's company** while other pillars change the tree. It gates company decisions only, so their gains land in both arms; the bench measures this pillar alone, which is the point.
5. **Reinvestment raises drawdown.** Reserve and `leak` guard it, A5 measures it.
6. **Support saturates first at scale** (`i < 24`). If org does not lift it, chargebacks will cap growth before the market does.
7. **Concurrent edits.** Another workflow is changing `strategy.ts`, `company.ts`, `holds.ts`, `missions.ts` now. This spec names functions, and line-level changes must be rebased on the result.
8. **Away pace is a choice.** A sleeping laptop means no progress at all: D3 says so plainly in the digest.
