# Talent pillar: real skill, league, firing, evolution

Status: design, ready to implement. Every decision below is final unless a test in section 11 proves it wrong.
Product-facing strings are French, the rest of this file is English.

## 0. The decisions in ten lines

1. **Talent lives in a new hidden top-level field `WorldState.talentTruth`**, next to `market`, never under `company`: the snapshot copies `company` wholesale, so anything under it reaches the UI.
2. **A seat is stable, a person changes.** `AgentState.id` stays (`leo`, `sarah`…), a firing replaces the person sitting there. 100+ hard-coded ids, the reviewer table, the tests and the sprites keep working, and the seat is never empty.
3. **Talent does not touch the market.** It changes the text the engine writes (flaws, drafts kept, passes) and the decisions a handler takes (pruning a creative, reading a bandit). The market reads those outputs through its existing scorers. `sim/` is not modified at all.
4. **Best-of-N alone is not enough, I measured it** (section 1). The levers that move money are: dropping the losing creative of a campaign, flaws in pages and guides that the scorer really sees, and the angle read from the bandit.
5. **Three modes** in `ScenarioConfig.talent`: `off` (no talent at all, today's output), `flat` (talent and practice act, no consequence: this is the paired control), `league` (routing, duels, coaching, firing, hiring). Default `league`. A save without the field is `off`.
6. **Only seats with a lever enter the league.** A seat without a measurable effect on a result (finance, analysis, QA gates, HR, covers) has no talent, no rating, cannot be fired. Immunity comes from function, never from rank: chiefs and the CEO with a lever are judged like everyone.
7. **The rating is an Elo-like number per person and per skill**, updated by luck-adjusted evidence. The scorer is the main evidence (noise-free), market results and duels weigh by how much they really say (`S = Φ(z)`: a noisy result moves almost nothing).
8. **A firing is a challenge, not a verdict.** After a failed improvement plan, the incumbent and three candidates sit the same real test. The swap happens only if a candidate beats him by 3 points, and it is atomic.
9. **Ads get duels, nothing else does.** Every campaign mixing two authors is already a natural duel, and one formal duel per week runs through the existing `Experiment` machinery. Pages get none (numbers in section 12).
10. **Proof is paired**: 30 seeds, `league` against `flat`, same seed, same initial talents. Metrics fixed in section 10, decided before any run, one pass.

## 1. What I measured (seed 7, normal, 25 days, real artifacts, one run)

Probe scripts in the scratchpad (`talent-probe.mts`, `stats.mts`, `prune.mts`). One seed: these numbers size the design, they prove nothing about the agency.

| Question | Measure | Consequence |
|---|---|---|
| Does keeping the best of N creatives move the score? | mean 91,3, sd 2,84; best of 2: 92,8; of 3: 93,4; of 4: 93,8 | `ctr ∝ q^1.3`: best of 4 gives +3,6 % CTR. The scorer is saturated, this lever alone is invisible |
| Is the choice on the company's VoC the same as on the market's? | same values on both | selecting on the company's scorer is legitimate and loses nothing |
| Sales page across 12 draws | **sd 0,00**, 1 distinct score, on all 4 products | `heuristicSalesPage` never uses its rng: best-of-N would do nothing without new variation |
| Guide draft across 10 draws | sd 0,8 to 1,4; best of 3 ≈ +1 | same as ads, too small alone |
| « One more editing pass » | pass 1: 85→90; pass 2: 90,0; pass 3: 90,0 | a second pass is a **no-op** today: one pass fixes everything it sees |
| Averaging several trend scans | pick value 9,37 (1 scan) → 8,23 (6 scans), average niche 10,14, best 17,23 | a sharper read of buzz picks **worse** niches here. Buzz is not value: a researcher must read price, not noise |
| Spread of CTR inside one campaign (same day, same budget) | 0,65 % to 3,45 %; q only 89 to 97 | the angle is the big variable (`affinity^2`), not the copy score |
| Dropping the worst creative of each multi-creative campaign | +11,5 % CTR (impression-weighted, 8 campaigns); up to +32 % on one | the strongest single lever found |
| Who really produces | `produce_ad`: 3 authors. `write_pdf`: Théo only, `write_sales_page`: Mehdi only, `pick_opportunity`: Nadia only | most roles have one active person: a peer-only league compares nobody, so ratings run against a fixed par |
| Traffic | 82 landing views a day, all products together | page duels cannot conclude (section 12) |
| Support | 13 of 44 messages misread by the classifier, 14 ambiguous, reply mean 88,9, sd 12,9 | room for a real lever |

## 2. Modes, state and invariants

### 2.1 New and changed types (`shared/types.ts`)

```ts
export type TalentMode = 'off' | 'flat' | 'league';
// ScenarioConfig gains:  talent?: TalentMode;   // absent = 'off' (older saves)

export type PersonId = string;                   // founders: the seat id; hires: `p${seq}`
export type Skill = 'copy' | 'longform' | 'editing' | 'page' | 'buying' | 'research' | 'support' | 'direction';

// ─── HIDDEN. Next to `market`, never under `company`. ───
export interface PersonTruth {
  personId: PersonId;
  talent: Partial<Record<Skill, number>>;        // current true talent, 0..1
  start: Partial<Record<Skill, number>>;         // at hire, for the proof
  ceiling: Partial<Record<Skill, number>>;       // what practice alone can reach
  practicedLevel: number;                        // last AgentState.level turned into practice
  lineage: PersonId | null;                      // clone of whom
}
export interface TalentTruth {
  people: Record<PersonId, PersonTruth>;         // alumni stay: the proof reads them
  samples: { day: number; meanLeague: number; workWeighted: number }[]; // one per evening, proof only
}
// WorldState gains:  talentTruth?: TalentTruth;

// ─── OBSERVABLE. Under `company`, safe for the UI. ───
export interface SkillRating {
  skill: Skill;
  rating: number;                                // Elo-like, par = 1500
  rd: number;                                    // uncertainty, 200 → 70
  n: number;                                     // evidence events, all time
  seasonN: number;                               // this season (weighted sum, rounded down for the sample rule)
  metric: number | null;                         // the role's readable number: mean QA score, reply score…
  history: { day: number; rating: number }[];    // one point per week + hire, max 40
}
export type PersonStatus = 'active' | 'onboarding' | 'probation' | 'gone';
export interface PersonRecord {
  personId: PersonId; seat: AgentId; name: string; feminine: boolean;
  hiredDay: number; leftDay: number | null; status: PersonStatus;
  ratings: Partial<Record<Skill, SkillRating>>;
  primary: Skill | null;                         // skill with the most evidence, else the seat's first kind
  lineage: PersonId | null;                      // shown: « formé par Sarah »
  trophies: { season: number; title: string }[];
  leftBecause: string | null;                    // French, with numbers
}
export interface ProbationPlan {
  personId: PersonId; seat: AgentId; skill: Skill; openedSeason: number; deadlineDay: number;
  metricLabel: string; baseline: number; target: number; coachSeat: AgentId | null;
  text: string;                                  // French, read out by Nora
  outcome: 'open' | 'met' | 'failed' | 'kept_no_better';
}
export interface Duel {
  id: string; season: number; skill: 'copy'; kind: 'formal' | 'natural';
  seats: [AgentId, AgentId]; persons: [PersonId, PersonId];
  productId: string; campaignId: string; creativeIds: string[];
  taskIds: string[]; experimentId: string | null;
  status: 'ordered' | 'running' | 'settled' | 'cancelled';
  startDay: number; endDay: number | null;
  result: { ctr: [number, number]; n: [number, number]; z: number; s: number; delta: number } | null;
}
export interface CandidateResult {
  personId: PersonId; name: string; isIncumbent: boolean; lineage: PersonId | null;
  score: number; deliverable: string;            // what they produced, French, short
}
export interface HireReport {
  day: number; seat: AgentId; skill: Skill; left: PersonId; hired: PersonId | null; // null: incumbent kept
  candidates: CandidateResult[]; cost: number; reason: string;
}
export interface SeasonRow { personId: PersonId; name: string; seat: AgentId; rating: number; delta: number; metric: number | null; n: number; status: PersonStatus }
export interface SeasonReport {
  season: number; fromDay: number; toDay: number;
  tables: Partial<Record<Skill, SeasonRow[]>>;
  employee: { personId: PersonId; name: string; skill: Skill; perk: string } | null;
  probations: string[]; dismissals: string[]; hires: string[]; promotions: string[]; notes: string[];
  disruptedDays: number;                         // outage or ad ban: over 3, no dismissal this season
}
export interface EvidenceEvent { day: number; personId: PersonId; skill: Skill; source: EvidenceSource; s: number; w: number; label: string }
export type EvidenceSource = 'qa' | 'rejected' | 'duel' | 'natural' | 'market' | 'reply' | 'chargeback' | 'focus' | 'pick' | 'board';
export interface Perk { personId: PersonId; season: number; extraDraw: boolean; routing: number; budgetPct: number }
export interface LeagueState {
  season: number; seasonStartDay: number; closedSeasons: number;  // idempotence, like lastRetroDay
  lastEvidenceDay: number;
  hireSeq: number;
  people: Record<PersonId, PersonRecord>;
  plans: ProbationPlan[];
  duels: Duel[];
  hires: HireReport[];
  seasons: SeasonReport[];
  perks: Perk[];
  events: EvidenceEvent[];                       // ring buffer, 300
  renames: Record<string, string>;               // departed name → name now in the seat
}
// CompanyState gains:  league?: LeagueState;
// AgentState gains:    personId?: PersonId; feminine?: boolean; onboardingUntil?: number;
// AdCreative gains:    duelId?: string;
// Experiment.dimension gains: 'agent_duel'
// FounderHold.kind gains: 'firing' | 'pin';  FounderHold gains: agentId?: AgentId
// LedgerType gains: 'recruiting'
// TaskKind gains: 'league_review'
// CompanySnapshot.godMode gains: talent?: Record<AgentId, Partial<Record<Skill, number>>>
```

`server/src/contracts.ts`:

```ts
export interface Craft {
  skill: Skill;
  t: number;          // effective talent, onboarding ramp applied
  flaw: number;       // chance per flaw site
  draws: number;      // drafts written
  eye: number;        // sd, in score points, of the agent's reading of its own drafts
  sharp: number;      // Thompson samples averaged, 1 = today
  passes: number;     // editing passes
  reach: number;      // share of the flagged text one pass really fixes
  tier?: ModelTier;   // claude mode only
  effort?: 'low' | 'medium' | 'high'; // claude mode only
}
// MindContext gains:  craft?: Craft; draw?: number; personId?: string;
// LearningModule.chooseArm gains an optional 5th parameter: sharp?: { samples: number; rng: Rng }
```

### 2.2 Random streams

`company.ts`: `STREAM = { company: 1, tools: 2, market: 3, idleBreak: 4, talent: 5, hire: 6, seedTalent: 7 }`.

| Draw | Stream |
|---|---|
| Founders' talents | `streamRng(seed, 7, seatIndex, skillIndex)` |
| Eye noise, extra Thompson samples | `streamRng(seed, 5, day, tick, seatIndex, purpose, hashOf(task.title))` |
| Flaws | engine-local `seededRng(seed, 'flaw', method, personKey, day, ...keys, draw)`: no company stream |
| Candidates, mutation, names | `streamRng(seed, 6, hireSeq, candidateIndex, field)` |

`hashOf` reads the title, never a generated id. A second `draw` calls the engine with `ctx.draw = i`, added to the key only when `i > 0`: draw 0 is the text of today, for the same person and the same day.

`HeuristicEngine.begin` keys on `ctx?.personId ?? ctx?.agent?.id`. Founders' person id is their seat id: their texts do not move in `off`.

### 2.3 The reload guarantee

Nothing is kept in `Company` beyond what the world holds. `league_review` and the evidence pass are idempotent through `closedSeasons` and `lastEvidenceDay`, like `lastRetroDay`. Migration in the `Company` constructor: `world.scenario.talent ??= 'off'`, and only when mode is not `off`: `world.talentTruth ??= seedTruth(world)`, `world.company.league ??= emptyLeague(world)`.

### 2.4 Guardrails kept, one line each

- Compliance: flaws can add a risky claim. The reviewer and TikTok stop it as today, the strike falls on the author.
- Founder approval: a replacement waits for him in approval mode (section 7.6).
- Stop-loss: `stopLossReason` is called unchanged. Talent may prune or stop earlier, never later.
- CFO cap: a perk's budget comes inside `launchBudget`, under `Math.min(remaining, …)`. A hire needs the CFO's room (section 7.5).
- Ledger: the only new money is `recruiting`, through `sim.recordLedger`.
- Hidden truth: the UI and the agents read `company.league` only.

## 3. Who has talent

`server/src/runtime/talent/skills.ts`:

```ts
export const KIND_SKILL: Partial<Record<TaskKind, Skill>> = {
  write_ad_hooks: 'copy', produce_ad: 'copy', post_organic: 'copy',
  write_titles: 'longform', write_outline: 'longform', write_pdf: 'longform',
  humanize_pdf: 'editing',
  write_sales_page: 'page',
  launch_campaign: 'buying', optimize_ads: 'buying',
  scan_trends: 'research', pick_opportunity: 'research',
  reply_inbox: 'support', handle_refund: 'support',
};
```

A seat is in the league when one of its `taskKinds` maps to a skill. Camille also has `direction` by a hard rule (`seat === CEO`). On today's roster that is 18 seats out of 31: Sarah, Chloé, Tom, Léo, Adam, Mehdi, Clara, Théo, Élise, Lina, Samuel (editing through `humanize_pdf`), Nadia, Malo, Hugo, Lucas, Fatou, Inès, Camille. Malo and Hugo have a research talent and no pick in the probe: without evidence they are never judged.

No talent, 13 seats: Gabriel, Alice, Raphaël, Emma, Nora, Axel, Yasmine, Paul, Zoé, Kenji, Maëlle, Rayan, Louise. Reasons in section 12.

### Drawing talent

```ts
// truth.ts
export function seedTruth(world): TalentTruth
// per person:   g ~ normal(0, 0.09);  per skill:  e ~ normal(0, 0.12)
// founders:     t = clamp(FOUNDER_MEAN + g + e, 0.15, 0.92);   FOUNDER_MEAN = 0.56   (sd ≈ 0.15)
// market hires: t = clamp(MARKET_MEAN + g + e, 0.10, 0.92);    MARKET_MEAN  = 0.52
// ceiling:      min(0.97, t + 0.10)
```

## 4. How talent changes output, per family

`craftFor(world, agent, kind): Craft | undefined`, in `talent/craft.ts`. `undefined` when the mode is `off` or the kind has no skill: every lever then reads as today.

```ts
const x = clamp(truth.talent[skill] * rampOf(person, day), 0, 1);
flaw   = 0.5 * (1 - x) ** 1.5;           // t .2: .36 · .4: .23 · .56: .15 · .8: .05 · .9: .02
draws  = 1 + Math.floor(x * 3) + (perk.extraDraw ? 1 : 0);   // 1..4
eye    = 8 * (1 - x);
sharp  = 1 + Math.round(x * 4);          // 1..5
reach  = 0.4 + 0.6 * x;
passes = x >= 0.8 ? 3 : x >= 0.5 ? 2 : 1;
rampOf = hired 7+ days ago ? 1 : 0.7 + 0.3 * daysSinceHire / 7;
```

Set in `Company.runHandler`, the single place every handler passes through:

```ts
const mind = { ...base, craft: craftFor(w, agent, task.kind), personId: agent.personId };
```

`runImmediate`, `giveMission`, `chat` carry no craft.

### 4.1 `bestDraft` (`talent/craft.ts`)

```ts
export async function bestDraft<T>(
  ctx: RuntimeCtx, agent: AgentState, mind: MindContext, purpose: string,
  write: (m: MindContext) => Promise<T>, score: (d: T) => number,
): Promise<{ draft: T; drawn: number; realScore: number }> {
  const c = mind.craft;
  const n = ctx.engine.mode === 'claude' ? Math.min(c?.draws ?? 1, 2) : c?.draws ?? 1;
  if (n <= 1) { const draft = await write(mind); return { draft, drawn: 1, realScore: score(draft) }; }
  const rng = talentRng(ctx, agent, EYE, purpose);
  let best: T | null = null, seen = -Infinity, real = 0;
  for (let i = 0; i < n; i++) {
    const draft = await write(i ? { ...mind, draw: i } : mind);
    const s = score(draft);
    const perceived = s + rng.normal(0, c!.eye);
    if (perceived > seen) { seen = perceived; best = draft; real = s; }
  }
  return { draft: best!, drawn: n, realScore: real };
}
```

A weak agent draws one draft or misjudges two, a strong one screens its own flaws out. This is where drafts matter: with flaws in place the sd of a draft is about 5, not 2,84.

### 4.2 `copy`: hooks, ads, organic (P0)

| Lever | Where | Change |
|---|---|---|
| Hook choice | `ads.ts makeHook` | `rng.chance(0.7)` → `rng.chance(0.35 + 0.6 * t)`, same single draw |
| Risky line | `ads.ts heuristicAd` | `rng.chance(0.25)` → `rng.chance(0.45 * (1 - t))` |
| Flaws | new `applyAdFlaws(scenes, draft, flawRng, f, c)` at the end of `heuristicAd`, before duration clamping | five sites below |
| Best draft | `growth.ts produce_ad` wraps `engine.writeAd` in `bestDraft`, score = `sim.scoreCreative` on a scratch creative with the company's VoC | |
| Angle | `growth.ts` hook and format `chooseArm` get `sharp` | section 4.8 |

A rework (`task.attempts > 0`) halves `f`: the reviewer's notes help.

Flaw sites and their real cost in `scoreCreative`, from its weights (spec .22, struct .25, action .10, human .13, design .10):

| Site | Text change | Cost | Chance |
|---|---|---|---|
| A1 customer's words lost | scene 2 uses a generic line | −4,3 (spec −15, human −8) | `f` |
| A2 cliché | a real `GENERIC_PHRASES` entry in a voiceover | −1,3 | `f` |
| A3 long screen text | scene 3 keeps the full step, over 12 words | −1 | `f` |
| A4 hook absent from scene 1 | generic first screen | −5, **blocking**: rework | `f / 2` |
| A5 weak CTA | last scene without link | up to −9,7, **blocking**: rework | `f / 2` |

Predicted creative score (verify in the lever test): t=.2: 85,7 · t=.56: 90,5 · t=.8: 93. CTR ratio .2 against .8: 0,90.

### 4.3 `page`: sales page (P0)

`heuristicSalesPage` has no variation at all (sd 0). Two additions behind parameters:

- `rules.draw > 0`: the local `rng` picks another customer phrase for the headline and reorders the pain bullets. Draw 0 stays today's text.
- `rules.flaw`, with `flawRng`, four sites:

| Site | Text change | Cost in `scoreSalesPage` (spec .35, struct .27, human .15) |
|---|---|---|
| P1 | headline without the customers' words | −5,3 |
| P2 | headline without a number | −3,5 |
| P3 | the guide's tools not named in the page | −12 at worst |
| P4 | one answer replaced by a stock answer (`STOCK_ANSWER` matches it) | −3 per answer, up to −6 |

`boutique.ts write_sales_page` wraps `engine.writeSalesPage` in `bestDraft`, score = `sim.scoreSalesPage`. The hype arm gets `sharp`.

Predicted page score: t=.2: 72 · t=.56: 81 · t=.8: 87. CVR ratio .2 against .8: `(72/87)^1.5` = 0,75. This is the second strongest lever.

### 4.4 `longform` and `editing`: guides (P0)

The pdf pillar owns these generators. The contract I need from it: keep `ctx.craft`, `ctx.draw`, `flawRng`.

- `longform`, in `heuristicPdfContent`, per chapter:
  - with chance `f`, one real cliché appended to a paragraph: `humanTone` −7 per hit, blocks at 3 hits on the final review;
  - with chance `f / 2`, the example dropped: structure and Red Team `chaptersWithoutExample`;
  - with chance `f`, durations stripped from the steps: `actionability`.
- `studio.ts write_pdf` wraps `writePdfContent` in `bestDraft` (a draft is about 100 ms, fine), score = `scoreContent`.
- `editing`, in `heuristicHumanize(content, flagged, voc, rng, gaps, opts?: { reach: number })`: a flat sentence is fixed only if `flawRng.chance(reach)`. `reach` undefined = 1 = today.
- `humanize_pdf` runs `craft.passes` passes, keeping a pass only if the score did not fall (the rule already there).

The passes are real only because of `reach`. What stays flagged after a pass:

| t | reach | passes | left |
|---|---|---|---|
| .3 | .58 | 1 | 42 % |
| .6 | .76 | 2 | 6 % |
| .9 | .94 | 3 | ~0 |

Predicted guide score: t=.2: 74 · t=.56: 85 · t=.8: 90. Below 85 the market adds `lowQualityWeight`: refund chance +3,9 points at 74, against a 4 % base. Rating mean: 4,16 at 74 and 5 at 90.

### 4.5 `buying`: the strongest lever (P0)

New function, called in `optimize_ads` step 3, before the fatigue loop:

```ts
/** talent/craft.ts. Which creatives this buyer drops, on its reading of the last 4 days. Stop-loss is not touched. */
export function pruneRead(rows: DailyAdStats[], creativeIds: string[], t: number): string[] {
  const minImp = 3000 - 2000 * t;          // t .2: 2600 · .8: 1400
  const ratio  = 0.55 + 0.3 * t;           // drop below this share of the best: .61 · .79
  const zNeed  = 2.4 - 1.0 * t;            // 2,2 · 1,6
  // per creative: clicks and impressions over the window. best = highest CTR with imp >= minImp.
  // drop c if imp(c) >= minImp and ctr(c) < best.ctr * ratio and z(best, c) >= zNeed.
  // z on two proportions, with the day noise: se² = p1q1/n1 + p2q2/n2 + 0.16²/days * (p1² + p2²).
  // the campaign always keeps at least its best creative.
}
```

A dropped creative stays approved: it can come back in another campaign. Pruning needs no founder approval, as reductions stay free in approval mode.

- Scale read: `recent.roas` is replaced, for the scale and trim rules only, by `(revenue + k * 1.3) / (spend + k)`, `k = 25 * t`. A strong buyer does not scale on one lucky day. Stop-loss and the survival rule read the raw number.
- Perk: `launchBudget` base +10 % for the buyer of the season, under the same `Math.min(remaining, …)`.

The measured gain is +11,5 % CTR for dropping one creative per campaign. Predicted: t=.2: +2 %, t=.56: +8 %, t=.8: +13 %.

Sign of the shrink is not proven. The lever test decides: wrong sign or no effect, the shrink is removed.

### 4.6 `research`: niche pick (P1)

Sharper noise reading picks worse niches (section 1). So the lever is what the researcher looks at:

- `heuristicRanking(input, target, opts?: { valueWeight: number })`: `score += valueWeight * (medianKnownPrice - 19)`, with `medianKnownPrice` from the company's own anchors, else competitors' prices. `valueWeight = 1.2 * t`. `t` undefined = 0 = today.
- `scan_trends`: VoC and competitors for `3 + round(2 * t)` niches instead of 3: more ranked niches have a known price.
- `pick_opportunity`: `chooseArm('niche', …)` gets the CEO's `sharp`: she signs the pick, whoever prepared it.

### 4.7 `support` (P1)

- Misread on an ambiguous message: `rng.chance(0.1)` → `rng.chance(0.22 * (1 - t))`, same single draw. Equal to today at t=.55.
- Batch: `.slice(0, 6)` → `.slice(0, 4 + round(4 * t))`: a better agent clears more before the deadline, so fewer escalations.

Tone gets `sharp`.

### 4.8 Reading a bandit

```ts
// learning/bandits.ts
export function chooseArm(world, dimension, arms, rng, sharp?: { samples: number; rng: Rng }): string
// each arm: first sample from `rng` exactly as today, then `samples - 1` more from sharp.rng, drawn value = their mean.
// sharp absent or samples <= 1: strictly today's code path and today's draws.
```

Mean of k Beta samples has the posterior's mean and a tighter spread: the weak read explores by accident, the strong one exploits what the company learned. It needs the same data, it knows nothing more.

Helper `armSharp(ctx, agent, mind)` in `talent/craft.ts`, used at `growth.ts` (hook ×3, format ×1), `boutique.ts` (hype), `support.ts` (tone), `research.ts` (niche). Price stays out: Paul has no skill.

### 4.9 Claude mode

Never called live. `Craft.tier` and `Craft.effort`, read in `ClaudeEngine.run`:

```ts
const tier = spec.ctx?.craft?.tier ?? spec.ctx?.agent?.tier ?? 'sonnet';
const effort = spec.ctx?.craft?.effort ?? spec.effort;
```

| t | tier | effort | `bestDraft` drafts |
|---|---|---|---|
| < .34 | one below the seat's (opus→sonnet, sonnet→haiku) | low | 1 |
| .34 to .67 | the seat's | the call's own | 1 |
| ≥ .67 | the seat's | high | 2 |

`flaw`, `reach`, `passes` are ignored except on a fallback to heuristic. `systemBlocks` builds from named fields: it does not read `craft`, and a test keeps it so. `maxComputeEur` stays the ceiling. Candidates sit their test on `haiku`.

### 4.10 Improvement over time

- **Practice, makes `level` real.** Evening, for each league person: while `agent.level > truth.practicedLevel`, `t += 0.25 * (ceiling - t)` on the skills used, `practicedLevel++`. XP comes from delivered work, so this is practice. Capped by the ceiling, diminishing by construction. About 3 to 4 level-ups in 60 days: +.06 to +.07. Runs in `flat` and `league`.
- **Coaching** (`league` only). Each `day % 7 === 0` of an open plan: if the coach's true talent is higher, `t += 0.02`, up to `ceiling + 0.05`. The coach pays 10 energy each morning of the plan.
- **Playbook inheritance.** The seat's playbook stays with the seat, minus `COACHING_PREFIX` rules. The company's lessons survive a firing.

## 5. Measured performance

### 5.1 The rating

```ts
// talent/evidence.ts
const Φ = (z: number) => normal cdf;
export function recordEvidence(world, personId, skill, source, s: number, w: number, label: string, opponent = 1500): void {
  const R = ratingOf(world, personId, skill);
  const e = 1 / (1 + 10 ** ((opponent - R.rating) / 400));
  const K = clamp(R.rd / 4, 12, 50);
  R.rating = round1(R.rating + K * w * (s - e));
  R.rd = Math.max(70, R.rd - 6 * w);
  R.n += 1; R.seasonN += w;
  pushEvent(world, { day, personId, skill, source, s, w, label });
}
```

Starting values: founders `rating 1500, rd 200`. Hires: `rating 1500 + (testScore - par) * 8`, clamped to ±150, `rd 150`. Each season close, `rd = min(200, rd * 1.1)`.

Every result is a game against par (1500), so a solitary role can still be judged. `s = Φ((x - par) / sd)` makes a score worth what it really says. A person whose results sit 0,5 sd above par settles around 1640.

### 5.2 Evidence table

Attribution uses `personAt(seat, day)` on `PersonRecord`: `createdBy` + `createdDay` gives the person, no field is added to products or orders.

| Skill | Source | Moment | x | par, sd | w | Why it is luck-adjusted |
|---|---|---|---|---|---|---|
| copy | `qa` | first review of `produce_ad` (`attempts === 0`) | `res.score` | 88, 5 | 1 | scorer, no market noise |
| copy | `rejected` | `submitCreative` with a **strike** | s = 0 | | 1 | a false positive has no strike: ignored |
| copy | `natural` | evening | section 6.2 | | .4 | same campaign, same days |
| copy | `duel` | settled formal duel | Φ(z) against the opponent | | 1 | same |
| longform | `qa` | first review of `write_pdf` | `res.score` | 80, 6 | 1,5 | scorer |
| longform | `market` | product version with ≥ 6 reviews, once | mean rating | 4,3, .35 | 1 | reviews only |
| editing | `qa` | `humanize_pdf` done | `after - before` plus 2 × chance that remains | 3, 3 | 1 | scorer |
| editing | `market` | same reviews event | mean rating | 4,3, .35 | .5 | |
| page | `qa` | first review of `write_sales_page` | `res.score` | 80, 6 | 1,5 | scorer |
| page | `market` | once per version, ≥ 150 landing views | `ln(cvr / companyCvr)`, company's other products | 0, .35 | .7 | same period |
| buying | `focus` | every 7 days, per campaign active ≥ 3 days | share of spend on its best-CTR creative | .5, .15 | .5 | decision, not the market's mood |
| buying | `market` | same | `ln(roas7 / 1.5)` | 0, .5 | `clamp(spend / 60, .2, 1)` | weighed by spend |
| research | `pick` | product 14 days after launch | percentile of its profit among all products | s = percentile | 1 | rank, not euros |
| direction | `pick` | same, for the CEO | same | | .5 | |
| direction | `board` | season close | `ln(roas14 / 1.4)`, without outage or ban days | 0, .5 | 1 | |
| support | `reply` | each reply | `outcome.score` | 85, 15 | .25 | one reply says little |
| support | `chargeback` | consequence `chargeback` after a reply | s = 0 | | .5 | |

Hooks:

- `Company.processReviews`, after `reviewTask`: `onReviewed(ctx, task, res)`. One choke point for `qa`.
- `Company.finishTask`: `onDone(ctx, task)`.
- `growth.ts produce_ad.onDone`: the strike.
- `support.ts`: `reply`, `chargeback`.
- `applyDailyEvidence(world, day)`: called in `evening` after the retro, guarded by `lastEvidenceDay`, does the market rows (natural duels, `market`, `focus`, `pick`).

`adRows` already leaves out announced outage days: their rows give no evidence. Days of the ad-account ban have no rows.

The pars are constants measured at t=.56 by the lever test, one pass (`constants.ts`). Pars of the table are my estimates until then.

### 5.3 Primary skill and minimum samples

`primary` = skill with the highest `n`, else `KIND_SKILL[taskKinds[0]]`. A person is judged on the primary skill only. A seat with `seasonN` under the minimum is « échantillon insuffisant » and cannot enter or fail probation.

```ts
export const MIN_SEASON_N: Record<Skill, number> = { copy: 4, longform: 2, editing: 2, page: 2, buying: 3, research: 1, support: 4, direction: 1 };
```

Support's 4 is a weighted sum, so 16 replies. Élise wrote no `write_pdf` in the probe: she will simply never be judged on it. Rank protects nobody, the sample does.

## 6. Competition

### 6.1 Seasons

`SEASON_DAYS = 14`. New `TaskKind` `league_review` (dept `rh`, kept out of `PLAN_KINDS`, handler in `handlers/ops.ts`), run in `Company.evening` after the weekly review, by Nora:

```ts
if (w.day % SEASON_DAYS === 0 && mode === 'league') await this.runImmediate('league_review', 'nora', `Clôture de la saison ${season}`);
```

An announced outage day postpones the close by one day (the check becomes `dueSeasonClose(world)`). In `flat`, the close only stores ratings and the report: no consequence.

`closeSeason(ctx)` in `talent/season.ts`, in this order:

1. `rd` decay, `seasonN` kept for the report then reset.
2. Tables per skill, `delta` of the season.
3. Open plans: `met` or `failed`.
4. New plans.
5. Replacements of the failed.
6. Employee of the season, perks for next season.
7. Promotion to chief.
8. `SeasonReport`, brain note `rh/saison-N.md`, feed.

### 6.2 Natural duels

In `applyDailyEvidence`. For each campaign and each pair of its creatives by two different persons with at least 1 500 impressions each on shared days, not yet settled for those rows (`Duel` with `kind: 'natural'`, kept max 200):

```ts
residual = ln(ctrA / ctrB) - 0.5 * ln(meanArm(A) / meanArm(B));  // half the angle is credit, half is the bandit's
se² = 1/clicksA + 1/clicksB + 2 * 0.16² / days;
s = Φ(residual / se);
recordEvidence(world, A, 'copy', 'natural', s, 0.4, label, ratingOf(B));   // and 1 - s for B
```

`meanArm` = product of the posterior means of hook and format for that niche, 1 when an arm has fewer than 3 pulls. Half: the writer chose the angle, and part of that choice was skill. A noisy pair gives `s ≈ .5`: nothing moves.

### 6.3 Formal duels (`talent/duels.ts`)

One per week, `day % 7 === 3`, morning, `league` mode:

```ts
export function scheduleDuel(ctx: RuntimeCtx): Duel | null
```

Conditions, all of them:

- at least two seats with `produce_ad`, tenure ≥ 7 days, none onboarding;
- a campaign `active`, `dailyBudget ≥ 10`, at most 2 creatives, product live, no `adsHold`;
- not survival, no announced outage today or tomorrow, no duel running.

Pair: the entrant with the highest `rd`, and the one closest to it in rating. Two `produce_ad` tasks, `assignee` forced, title « Duel : Sarah contre Chloé — « … » », input `{ productId, nicheId, variant, attachTo, duelId }`, priority 1. They pass the normal review and TikTok gates. Each picks its own hook and format: the angle is part of the duel.

`produce_ad.onDone`: when both creatives are approved and attached, `learning.startExperiment({ dimension: 'agent_duel', variants: seats, metric: 'ctr', productId, nicheId, owner: 'emma', hypothesis: 'Duel : Sarah contre Chloé sur « … »' })`.

- `computeExperimentResults`: `agent_duel` key = `ix.creatives.get(r.creativeId)?.createdBy` when `creative.duelId` belongs to this duel. `experimentThreshold` stays 3 000 impressions per variant.
- `NICHE_SCOPED` gains the dimension. `learning/heuristics.ts` skips it: a duel is not a lesson about the market.
- A creative rejected or dropped: `cancelled`, no Elo. The strike already counted.

Settling, in the evening, when the experiment concludes:

```ts
z = (pA - pB) / sqrt(pA*qA/nA + pB*qB/nB + 0.16²/days * (pA² + pB²));
s = Φ(z);
K = 32;  e = expected(A against B);
ratingA += K * (s - e);  ratingB -= K * (s - e);
if (s > 0.85 || s < 0.15) remove the loser's creative from the campaign;  // real: the budget goes to the winner
```

The duel uses the campaign's existing budget, no extra spend. It adds one creative at most: three share one budget.

Feed: « Sarah bat Chloé : CTR 2,4 % contre 1,6 % sur 3 100 impressions ». If `.3 < s < .7`: « Match nul, l'écart est dans le bruit ».

### 6.4 Leaderboard, routing, perks

**Routing is the fastest channel of selection**: it works from week two, without firing anyone. In `assignReady`, league mode, the load used in the sort becomes:

```ts
routedLoad = agentLoad(world, a.id) - routeBonus(world, a, task.kind);
routeBonus = clamp((rating - familyMean) / 100, -1, 1) + (perk?.routing ?? 0);
```

The candidates and the rest of the sort do not change, nor does `farBehind`: nobody starves. Observed rating, never truth. A skill-less kind gets 0.

**Employee of the season**, one per company: highest `(rating - 1500) / rd` with the season minimum. Title « Employé(e) de la saison », trophy, and a perk for the next season:

- one more draft: `extraDraw`;
- `routing: 1`;
- `budgetPct: 10` for a buyer.

**Promotion to chief.** A non-chief with a rating at least 120 above the chief of his department on the same skill, both `rd < 110`, two closes in a row: the two persons swap seats. The former chief stays, on the member seat. Real effects: the seat's kinds, the review duty, the Claude tier. At most one per season. A promotion moves no talent value, only who sits where, so `craftFor` needs a talent for the new seat's skills: a missing skill is drawn from the `hire` stream.

## 7. Consequences

### 7.1 Timeline of a 60-day run

| Day | What can happen |
|---|---|
| 1 to 14 | ratings form, routing from about day 7. Nobody at risk |
| 14 | season 1 closes: employee, first plans if the sample is there |
| 28 | first plans due: earliest replacement |
| 42 | second wave |
| 50+ | no new replacement: `HORIZON_GUARD = 10` |

### 7.2 Probation

Enters a plan, at a close, a person who meets **all** of:

- `mode === 'league'`, status `active`, tenure ≥ 14 days;
- primary skill sample ≥ `MIN_SEASON_N`;
- `rating + 0.75 * rd < 1500`: confident, about 77 %, that he is under par;
- lowest of his family when it has two rated persons or more;
- no `firing` hold, no `pin`;
- `day <= horizon - HORIZON_GUARD`.

At most one per family, three per season.

```ts
plan = {
  metricLabel: 'Qualité moyenne des pubs', baseline: 81, target: baseline + 0.5 * SD[skill],
  deadlineDay: day + 14, coachSeat: best rated peer of the skill, else chief,
  text: « Plan d'amélioration de Tom : qualité moyenne des pubs 81/100, objectif 84/100 en 14 jours. Coach : Sarah (92/100). »
}
```

`metric` is the readable number of the role. `baseline` = the season's mean. The plan is met if the season's metric reaches the target **or** `rating ≥ 1490`. Sample too small at the deadline: extended one season, once.

### 7.3 Dismissal

Failed plan, then the challenge (7.4). Stated in the feed and in `leftBecause`:

> « Tom quitte l'agence : qualité moyenne 79/100 pour un objectif de 84/100, classement 1 412, coach Sarah pendant 14 jours. Yanis (91/100 au test) reprend le poste. »

### 7.4 Replacement: the challenge (`talent/recruit.ts`)

```ts
export async function runChallenge(ctx: RuntimeCtx, plan: ProbationPlan): Promise<HireReport>
```

Candidates:

- two market hires, `MARKET_MEAN`;
- one clone: « élève de Sarah », `t = t(top) + normal(-0.02, 0.06)`, `lineage` set, when a peer has `rating ≥ 1550` and the sample;
- without a top performer, a third market hire.

Everyone sits the same real test, incumbent included, on the company's product with the most revenue over 14 days. The test writes nothing to the world and uses the candidate's craft through the run's engine, with `ctx.agent` a scratch copy of the seat and `personId` the candidate's:

| Skill | Deliverable | Scorer |
|---|---|---|
| copy | `writeAdHooks` then `writeAd`, 2 formats | `sim.scoreCreative`, mean |
| longform | `writeOutline` + `writePdfContent`, `revision: 900 + i` | `sim.scorePdf` |
| editing | `humanize` on a draft written at fixed t = .4 | `sim.scorePdf` |
| page | `writeSalesPage` on the product's guide | `sim.scoreSalesPage` |
| buying | `pruneRead` replayed on the last 14 days of real rows | blended CTR kept, ×1000 |
| support | `writeSupportReply` on the last 12 closed messages | `sim.scoreSupportReply`, mean |
| research | `rankOpportunities` on the company's research | Spearman against the realised profit per niche, ≥ 3 products, else no test: seat kept |

Decision: the best candidate replaces the incumbent only if `best ≥ incumbent + 3` on the test (`CHALLENGE_MARGIN`). Otherwise `outcome: 'kept_no_better'`: « Personne de mieux sur le marché, Tom reste », no new plan for this person for one season. The market may be worse than the incumbent: selection cannot go downhill by more than the test's error.

In this design no candidate is ever hired without a test, and a test is a real deliverable. `HireReport` keeps all four scores: the UI shows them.

### 7.5 The cost of a firing

- **Money**: `sim.recordLedger(world, { type: 'recruiting', amount: -25, memo: 'Recrutement : test de 3 candidats pour …', ref: 'hire:<id>' })`. `accounting.ts` adds `'recruiting'` to `fixed`, `core/ledger.ts` already books it in `otherCosts`. `HIRE_COST = 25` is in `talent/constants.ts`, `balance.ts` stays frozen.
- **CFO**: refused while `survival`, `bankrupt`, or `cash < 4 * HIRE_COST`: the plan waits for the next close.
- **Time**: the new person does nothing on day 1 (`onboardingUntil`, `pickTask` returns null, `assignReady` skips the seat) and ramps from .7 to full talent in 7 days.
- **Work**: the seat's open tasks go back to `pending`, `assignee = null`, `workLeft` halved up, `progress ≤ .5`; `memory.minds` cleared. Teammates take them, or the new person after day 1.

The seat is never empty: **the last owner of a kind can be replaced, never removed.** `company.agents.length` never changes here.

Swap, in one synchronous function `seatPerson(world, seat, person)`:

- `name`, `persona`, `avatar` (skin, hair, accessory; the shirt stays the department's), `feminine`, `personId`;
- `level = 1`, `xp = 0`, `perf` reset, `energy = 100`;
- `chats[seat] = []`;
- `league.renames[oldName] = newName`.

`DeptDef.chiefId` does not change: the seat is the chief.

**Names.** 46 lines of `server/src` hard-code a first name inside a sentence. Choke point in `core/activity.ts emit`: `text: rename(a.text, world.company.league?.renames)`, whole-word Unicode replacement. Same in `tellFounder` and `logTask`. `isFeminine` and `selfWord` read `agent.feminine ?? FEMININE.has(id)`. Pool of 40 French names with gender and avatar in `talent/names.ts`, a name is never reused in a run.

### 7.6 Protection against noise, against churn, and the founder

| Rule | Value |
|---|---|
| Ramp-up | tenure ≥ 14 days to enter a plan |
| No firing on a bad market | season with > 3 outage or ad-ban days: plans open and fail, no replacement until next close |
| Replacements | at most 2 per season, 1 per family |
| Same seat | at least 28 days between two replacements |
| Horizon | none in the last 10 days |
| CEO | once per run at most |
| Last owner | swap only, atomic |
| Sample | `MIN_SEASON_N` |
| Better candidate required | `CHALLENGE_MARGIN = 3` |

Founder, through `holds.ts`, `missions.ts readOrder`, `orders.ts` (another workflow is editing these: merge after):

- `firingHold(world)` and `pinHold(world, seat)`.
- New order actions `stop_firing`, `allow_firing`, `pin_agent`, `unpin_agent`, from: « ne vire personne », « pas de licenciement », « tu peux virer », « garde Sarah », « protège Sarah », « épingle Sarah ». Unknown name: said so, no action.
- A pin keeps the person out of plans and challenges, and is listed in `activeHolds`.
- Approval mode: `runChallenge` stops before the swap, a task `league_review` with `awaitFounder: « Remplacer Tom par Yanis (91/100 contre 79/100 au test) : 25 € »`. Refusal: `pin` for 14 days, `REFUSAL_COOLDOWN` logic. The 25 € is booked only on his yes.

### 7.7 The CEO and the chiefs

Chiefs with a lever follow the same rules: Léo, Clara, Élise, Inès, Nadia.

The CEO: skill `direction`, evidence `board` and `pick`, one lever (she signs the niche pick). Plans follow the same rule, but her replacement is by promotion only: a chief with `rating ≥ 1550` on his skill and `rd < 120` swaps seats with her, and his old seat goes through a normal challenge. No such chief: she stays. Stated once: a 60-day run will rarely see this, and it should stay rare, because `board` evidence is the noisiest of the table.

## 8. Files and functions

New, `server/src/runtime/talent/`:

| File | Exports |
|---|---|
| `constants.ts` | every number of this spec; `balance.ts` untouched |
| `skills.ts` | `KIND_SKILL`, `skillOf(kind)`, `leagueSeats(world)`, `familyOf(world, skill)`, `primarySkill(world, personId)` |
| `truth.ts` | `seedTruth`, `drawPerson`, `practice(world)`, `coachTick(world)`, `sampleTalent(world)`, `meanLeagueTalent`, `talentMode(world)` |
| `craft.ts` | `craftFor`, `rampOf`, `talentRng`, `bestDraft`, `armSharp`, `pruneRead`, `shrunkRoas` |
| `evidence.ts` | `recordEvidence`, `onReviewed`, `onDone`, `applyDailyEvidence`, `settleNaturalDuels`, `personAt`, `ratingOf` |
| `duels.ts` | `scheduleDuel`, `onDuelCreative`, `settleDuels` |
| `season.ts` | `dueSeasonClose`, `closeSeason`, `openPlans`, `reviewPlans`, `pickEmployee`, `promoteChiefs`, `routeBonus`, `seasonNote` |
| `recruit.ts` | `runChallenge`, `testDeliverable`, `drawCandidates`, `seatPerson`, `handOver`, `hireBudgetOk` |
| `names.ts` | `NAME_POOL`, `pickName`, `personaFor(skill, name, lineage)` |
| `index.ts` | public surface |

Modified:

| File | Change |
|---|---|
| `shared/types.ts`, `server/src/contracts.ts` | section 2 |
| `core/activity.ts` | `emit` applies `renames` |
| `runtime/world.ts` | `defaultScenario` validates `talent`, default `league`; `createWorld` seeds truth and league, sets `personId` |
| `runtime/company.ts` | `STREAM`; constructor migration; `runHandler` craft; `processReviews` → `onReviewed`; `finishTask` → `onDone`; `morning` → `scheduleDuel`, `coachTick`; `evening` → `applyDailyEvidence`, `practice`, `sampleTalent`, `settleDuels`, `league_review`; `pickTask` onboarding |
| `runtime/tasks.ts` | `KIND_META.league_review`, `PLAN_KINDS`, `assignReady` routed load and onboarding, `isFeminine`, `selfWord` |
| `runtime/handlers/growth.ts` | `bestDraft`, `armSharp`, `pruneRead`, `shrunkRoas`, perk budget, `duelId` flow, strike evidence |
| `runtime/handlers/boutique.ts`, `studio.ts`, `support.ts`, `research.ts` | sections 4.3 to 4.7 |
| `runtime/handlers/ops.ts` | `league_review` handler |
| `runtime/holds.ts`, `missions.ts`, `orders.ts` | section 7.6 |
| `runtime/accounting.ts` | `recruiting` in `fixed` |
| `minds/heuristic/index.ts` | `begin` keys: person, draw; `flawRng`; passes options to generators |
| `minds/heuristic/ads.ts`, `commerce.ts`, `studio.ts`, `editing.ts`, `support.ts`, `research.ts` | sections 4.2 to 4.7 |
| `minds/claude/engine.ts` | tier and effort |
| `learning/bandits.ts` | `chooseArm` sharp |
| `learning/experiments.ts` | `agent_duel` |
| `learning/heuristics.ts` | skip `agent_duel` |
| `api/trim.ts`, `api/snapshot.ts` | `trimLeague`, god mode |
| `cli.ts`, `scripts/balanceLib.ts` | `--talent`, `RunSpec.talent` |

Not modified: anything under `server/src/sim/` except the type import. `server/src/sim/balance.ts` stays frozen.

Order of work: types and modes → `craft` with `copy`, `page`, `buying` → lever test → evidence and rating → routing → seasons, plans, challenge → duels → guides (after the pdf pillar) → `research`, `support` → founder orders → UI data.

## 9. Interfaces with the other pillars

| Pillar | I need | If absent |
|---|---|---|
| org | seats stay `AgentState.id`, kinds stay on `taskKinds`. New seats declare a kind in `KIND_SKILL`. A seat removed must first go through `handOver` | league reads `company.agents`, nothing else is assumed |
| channels | `DailyAdStats.platform` or one campaign per platform: `pruneRead` and natural duels stay inside one campaign, so they stay valid. Any new `TaskKind` producing a creative maps to `copy`, a new buying kind to `buying` | Facebook creatives get no evidence |
| video | `quality.overall` stays the one score on a creative. `heuristicAd`'s flaw pass runs on the script, before any render | a video score outside `overall` is invisible to the league |
| pdf | keeps `ctx.craft`, `ctx.draw`, `flawRng` in the rewritten generators. If a design score reaches the market, I open a `design` skill with Zoé, Kenji, Maëlle | designers stay out, as now |
| scale | if salaries exist: severance = 7 days of wage, ledger line. A new seat from scaling is filled by `runChallenge`-style test: I expose `drawCandidates` and `testDeliverable`. Horizon over 60 days: more seasons, nothing else changes | `HIRE_COST` stays the only cost |
| ui | section 9.1 | |
| final calibration | at FOUNDER_MEAN, predicted ROAS is 8 to 15 % under today's: pages and guides lose more to flaws than pruning returns. The last pass must see this (`flat` mode median, on 30 seeds) | |

### 9.0 Reconciled with the sibling specs already written

Read at the end of my work: `channels.md`, `scale.md`, `ui.md`.

- **channels asks for `talentEdge(world, agentId, 'media_buying')` applied at `ctrRaw`. Refused.** That is a talent multiplier inside the market, the one thing the brief forbids, and it would also move the hidden CTR with no text behind it. The hook is not built. A buyer's talent reaches CTR through `pruneRead`, on `updateCampaign`, which goes through the same market. The merge must drop that line from `channels.md`.
- **channels gives `buyerScore(world, agentId, fromDay, toDay)`: accepted.** When it exists it replaces my `buying / market` row, as reconciled profit is a better x than `roas7`: `x = ln(1 + score / spend)`, par 0, sd .5, same weight. `RECON.claimWeight` stays a constant: the analyst has no talent.
- **scale** says « skill multipliers act on quality »: true of pages, guides and creatives, nothing to change. `agents` count in `WeekRollup` is unchanged: replacements keep the count. `runChallenge`, `seatPerson` and a promotion each call `logDecision(world, { kind: 'hire' | 'fire', … })`.
- **org**: `roleHolder(world, role)` and `requestHire(world, role, reason)` are compatible with stable seats: a role resolves to a seat. A hire for a new seat calls my `drawCandidates` and `testDeliverable`. With a `salary` ledger type from org, `recruiting` stays as the one-off cost and severance is added.
- **ui** reads truth only behind `?god=1` and keeps it out of `AgentState` and `company`: same rule. Nothing of the truth is written to any file of the run folder other than `world.json` (`/runs/<id>/` serves everything else): the brain note `rh/saison-N.md` and `CandidateResult` carry observed numbers only.

Field mapping for `ui.md`:

| ui field | Source |
|---|---|
| `PersonChip.contract` | `onboarding` → `trial`, `active` → `active`, `probation` → `probation`, plan `failed` waiting for the founder → `notice` |
| `rank`, `of` | sort of `people` with the same `primary` skill, on `rating` |
| `delta7d`, `spark` | `SkillRating.history`, which holds **one point per week** (`day % 7 === 0`) plus the hire, max 40 |
| `form` | last 5 `Duel`s of the person, else last 5 weeks: V if `delta > 10`, D if `delta < -10`, else N |
| `points` | `round(rating - 1500)` |
| `sample` | `seasonN` |
| `confidence` | `rd < 100` forte, `rd < 150` moyenne, else faible |
| `cutLine` | first rank with `rating + 0.75 * rd < 1500` |
| `DuelView.score` | `Duel.result.ctr`; `status` `cancelled` → `void` |
| `PodiumView`, `hallOfFame` | top 3 of `(rating - 1500) / rd` at each close, `SeasonReport.employee` first |
| `AlumnusView` | `people` with `status: 'gone'`, `kind: 'fired'`, `why = leftBecause` |
| `CandidateChip` | the challenge is one tick of logic; the world stages `HireReport.candidates` on the next day. No truth in it |
| `TalentTruthView` | god mode only: `truth = talent[primary]`, `note = « plafond 0,71, élève de Sarah »` |

### 9.1 How it reaches the UI

Snapshot: `company.league`, through `trimLeague`: `people` whole, `plans`, `seasons`, `hires`, `duels` last 30, `events` last 60, `history` as is. `talentTruth` is never read by `trim.ts`. The live stream (`LIVE_LIMITS`) sends `people` without `history`, nothing else.

The ui pillar builds, from this data only:

- **Tab « Ligue »**: one table per skill (rang, nom, classement, écart de la saison, métrique, statut), duels of the week, saison en cours, plans ouverts, last `HireReport` with the four test scores and what each produced, alumni with `leftBecause`.
- **AgentPanel**: classement, statut, plan text, coach, trophées, « formé par », and who sat there before (from `people` with the same `seat`).
- **World**: badges above sprites from `status`: période d'essai, nouveau, employé(e) de la saison. A departed person walks out on `leftDay`. Sprites already follow snapshot ids; `AgentVis` must refresh `avatar` and name when `personId` changes, as the seat id stays.
- **Feed**: activity kinds exist (`meeting`, `review`, `thought`, `founder`). Season, duel and hire lines use them, no new kind.
- **ScenarioModal**: a select « Compétition : ligue, sans conséquence, désactivée » on `scenario.talent`.

Never shown: `talent`, `ceiling`, `Craft`. The AgentPanel's rating is the observed one.

## 10. Proof

Script `server/scripts/talentProof.ts`, using `balanceLib`, no benchmark before implementation is done. One process, 60 days ≈ 20 s.

### 10.1 Lever test, before anything else

Mode `flat`, all league seats forced at t = .25 then at t = .8 on one skill group at a time, others at .56 (test-only override `RunSpec.talentOverride`, never in the scenario):

- groups: `copy`, `page`, `longform + editing`, `buying`; then `research`, `support`;
- 12 seeds, `normal`: 6 groups × 2 × 12 × 20 s ≈ 48 min. Run the four P0 groups first, 32 min.

Rule set in advance: for each group, paired median of `profit(.8) - profit(.25)`. Under 100 € or negative: the lever is cut or inverted, once, then cut. A second failure of a lever is reported, not tuned. This is the test that replaces trust in section 4's predictions.

### 10.2 Selection test

Paired by seed: seeds 1 to 30, `normal`, 60 days, 500 €, arm `league`, arm `flat`. Same `seedTruth`, same market. 20 minutes.

| # | Metric | Definition | Pass |
|---|---|---|---|
| M1 | Mean true talent | mean of `talent[primary]` over league seats, day 60, `league - flat` per seed | mean ≥ +.03, positive on ≥ 22/30 |
| M2 | Work-weighted talent | per task done on days 31-60, the assignee's true talent on its skill, averaged: **the routing shows here** | mean ≥ +.06, positive on ≥ 24/30 |
| M3 | Profit | `profit(league) - profit(flat)` per seed | positive on ≥ 20/30 (one-sided sign test, p ≈ .05) and median above 0 with a 90 % bootstrap interval excluding 0 |
| M4 | Firing precision | share of replaced persons whose true talent was under the mean of their family that day | ≥ 70 % |
| M5 | Seat gain | true talent of the hire minus the replaced, at the swap | mean ≥ +.10 |
| M6 | Churn | replacements per run | median ≤ 4, max ≤ 6 |
| M7 | Rating validity | Spearman between observed rating and true talent, per skill with ≥ 3 rated persons, day 42, pooled | ≥ .5 |

M1 and M2 say selection works. M3 says it pays. Noise floor reminder: on 15 seeds the normal median moves ±600 €, hence 30 paired seeds and a paired statistic, never two medians side by side.

Stop rule: one pass. If M1 and M2 pass and M3 fails, keep the league and report the effect size as it is. At most one change (`K`, or the 1500 gate), one re-run, then stop. M4 under 50 % means the rating is noise: firing is disabled (`flat` + routing) rather than tuned.

Then `flat` median against the current 1 408 € tells the final calibration what talent cost the baseline.

## 11. Tests that fail without the feature

`server/test/talent.test.ts`, heuristic engine:

1. **`off` is today**: `scenario.talent = 'off'`: no `talentTruth`, no `league`, `mind.craft` undefined on every handler, `chooseArm` without `sharp` gives the same arm from the same rng as before.
2. **Draw 0 unchanged**: `writeAd` with `{ craft: undefined }` and with `{ draw: 0, personId: seat }` return the same text.
3. **Secret**: `JSON.stringify(toSnapshot(world, false))` has no `talentTruth`, no `ceiling`, no `Craft`; a planted marker value in `talent` is absent from the snapshot, from `company`, and from `systemBlocks(ctx)` with a `craft` set.
4. **Reload**: `play(seed, ticks, 7)` from `runtime.test.ts`, mode `league`, 45 days, with one seat forced low so that a challenge happens: `reloaded === straight`.
5. **Own streams**: two `flat` runs, same seed, t forced .25 and .8: identical `market.events`.
6. **Copy lever**: mean `scoreCreative` over 40 draws, t=.8 at least 4 points above t=.2.
7. **Page lever**: sd over draws above 0 at t=.5; mean t=.8 at least 6 above t=.2.
8. **Passes are real**: on a guide with planted clichés, `genericPhraseHits` after `humanize_pdf` is higher at t=.3 than at t=.9. Without `reach`, this test fails.
9. **`pruneRead`**: on rows with CTR 3 % and 1 %, 1 500 impressions each: t=.8 drops the second, t=.2 does not; the best creative is never dropped.
10. **Guardrail**: `stopLossReason` gives the same result for every t; `launchBudget` with a perk never exceeds `remaining`.
11. **`chooseArm` sharp**: over 2 000 draws on arms 30/10 and 10/30, the good arm wins more with `samples: 5` than with 1.
12. **Level is real**: a level-up raises the truth, never above the ceiling, and each gain is smaller than the last.
13. **Evidence**: `qa` recorded once on a task with a rework; no `natural` or `market` event for an announced outage day; `s` within .45-.55 for two creatives at 200 impressions.
14. **Elo**: settled duel moves both ratings by opposite amounts, and a cancelled duel moves nothing.
15. **Protections**: no plan before day 14; no plan under the sample; no replacement with a `firing` hold; pinned seat out; at most 2 replacements per season, even with 5 forced failures; none in the last 10 days; none on a season over 3 disrupted days.
16. **Challenge**: each `CandidateResult.score` equals `sim.scoreCreative` recomputed on the stored deliverable; the incumbent stays when no candidate beats him by 3.
17. **Seat continuity**: after a swap on `leo`, `agentById(w, 'leo')` is the new person, `company.agents.length` unchanged, open tasks of the seat are reassigned, no new activity text contains « Léo », `DEFAULT_REVIEWER` still routes.
18. **Ledger**: `recruiting` booked once, Σ amounts = cash, `reconcileDay` shows no gap, no hire in survival.
19. **Approval**: in approval mode the swap waits; refusal pins for 14 days, nothing booked.
20. **Routing**: same load, higher observed rating gets the task in `league`, and in `flat` the order is the old one.
21. **Claude mapping**: fake client: t=.2 on a `sonnet` seat calls haiku with `effort: 'low'`.

`server/test/runtime.test.ts`: the reload test runs in both `flat` and `league`. `web/src/world/world.test.ts` asserts invariants: `league` never changes them.

## 12. Rejected

- **A talent multiplier on CTR or CVR in the sim**, including the `talentEdge` hook proposed in `channels.md`: that is faking the market.
- **Best-of-N as the main lever**: +3,6 % CTR at best, 0 on pages.
- **« One more pass » on its own**: measured +0,0. Kept only with `reach`.
- **Averaging trend scans**: measured worse picks, the signal is buzz and value is price.
- **Duels on pages**: 82 landing views a day in total; the 120-view threshold is 2,4 sales per arm: `Φ(z) ≈ .5` for days of split traffic.
- **Duels with hook and format imposed**: identical angles leave a 5 % CTR gap under a 15 % standard error: a coin flip.
- **Duels on guides, support, research**: no two of them meet the same traffic.
- **Salaries in this pillar**: no wage exists in the ledger, it belongs to scale.
- **New agent ids at each hire**: 100+ hard-coded ids, reviewer map, tests, playbooks, for no result. Seats do it.
- **Talent for finance, analysis, QA gates, HR**: a guardrail must not depend on a draw.
- **Noisy reviewers**: reviewers read the real scorers; a talent there weakens the gates that protect the founder.
- **`design` skill today**: covers have no effect on the market and `design` weighs 4 % of a guide: firing Kenji would change no number. A label, so out, until the pdf pillar makes it reach the market.
- **`partners` skill**: about 5 deals in 25 days, too few for a sample, and fraud screening is a guardrail.
- **`pricing` skill for Paul**: 7 decisions in 25 days, mostly rules and A/B results; no sample, and the price test already measures the choice.
- **`perf.score` as the rating**: it counts approvals and volume, not results.
- **Peer-only ranking**: most roles have one active person. Par games solve it.
- **Crossover between two top performers**: no data to validate it, mutation of one is enough.
- **Per-niche talent**: the sample does not exist.
- **Extra VoC passes for a better listener**: truth and company scores came out equal in the probe, nothing to win.
