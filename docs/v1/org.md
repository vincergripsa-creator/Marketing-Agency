# Pillar: org. Headcount on demand, not a fixed team

Status: design, nothing implemented. Other pillars: talent, channels, video, pdf, scale, ui.
Read section 13 for what this pillar needs from them.

## 0. Verdict in ten lines

1. The company starts with **8 founders in 8 departments**, 228 €/month of payroll, and wears 17 of its 36 task kinds as hats.
2. **Why 8 is a measured knee, not a taste.** On the same hat table, 8 costs 0.4 day of lead time against 31, 7 costs 0.6 day more, 6 and 5 degrade further (section 1).
3. **Why not the fixed team.** At the pay scale of section 5, the `legacy31` team costs 1 422 € over 60 days: the whole of today's median profit (1 408 €).
4. **Payroll is real.** One `salary` line per day in the ledger, plus one-off `recruiting` lines. Runway, CFO cap and KPI all see it.
5. **Hats are real.** A kind worn as a hat runs at 0.67 speed. A hire removes the hat. Talent adds the quality penalty.
6. **A hire needs a measured bottleneck AND money.** Wait above 12 task-ticks/day on a role, its owners above 70 % busy, 3 evenings in a row, then margin, cash and revenue-per-head gates.
7. **Every task kind always has an owner**, by construction: `reconcileOrg()` derives hats from who is alive, and `KIND_HATS: Record<TaskKind, ...>` makes a kind without an owner a compile error.
8. **Departments open and close** with their first and last member. Closed ones stay on the map as vacant plots.
9. **No hard-coded people.** 141 literal agent ids on 119 lines of `server/src` become `officer(world, office)` lookups.
10. **`team: 'legacy31'` reproduces today byte for byte.** It is the migration proof, it keeps the 203 test references valid, and it gives the benchmark its control.

Measured evidence is labelled **[measured]**. Everything else is a design number, validated by the single calibration of section 11.

## 1. The evidence

Source: one 25-day CLI run, seed 7, normal, 464 tasks (`--run-id dsg-org`, deleted). Replay scripts: `scratchpad/v1/tmp/replay.cjs`, `replay2.cjs`.
The replay re-runs the real task stream tick by tick with `dependsOn`, one task per agent per tick, the energy model and reviewer slots.

**Limits of this evidence.** One seed, 25 days, and the plan does not react to delays in the replay. The replay also routes by lowest load only, so its per-agent shares differ from the real run. Good enough to size a team, not to promise a profit.

**[measured] The `legacy31` team is about 7 % utilised.** 19.5 ticks of real work per day against 279 available. The run counts 22.6, but `plan_day`, `budget_review`, `retro` and `performance_review` run in zero ticks. In 25 days Tom finished 66 tasks while 12 agents finished fewer than 6.

Load by function, ticks/day: growth 6.9, studio 2.5, research 1.8, analyse 1.8, boutique 1.4, creation 1.2, finance 1.1, direction 1.0, support 0.8, partnerships 0.5, RH 0.5.

**[measured] Team size, real volume (×1), like for like**

These rows share one generous hat table: each founder holds more kinds in core than the final catalog gives, so all of them flatter small teams.

| Team | Wait (task-ticks/day) | Publish lead time | Busiest agent |
|---|---|---|---|
| 31 fixed | 7 | 1.97 d | Tom 31 % |
| 8 | 26 | 2.39 d | Léo 57 % |
| 7 | 40 | 3.00 d | Léo 61 % |
| 6 | 67 | 3.25 d | Camille 69 % |
| 5 | 78 | 3.61 d | Camille 75 %, Clara 73 % |

Going from 31 to 8 adds 0.42 day in total. Going from 8 to 7 adds 0.61 day on its own. That is the knee.

**[measured] The final catalog, with its stricter hats:** 8 founders at 53 wait/day, 2.53 d lead time, Léo 72 %, Gabriel 64 %. That is the number to read for the product. Léo is the first bottleneck by design: post_organic alone is 2.5 ticks/day, worn at 0.67 speed.

**[measured] Double volume is where 8 breaks, and two hires fix most of it**

Greedy search over 19 candidate roles, volume ×2 (each task replayed twice):

| Headcount | Added role | Wait/day | Note |
|---|---|---|---|
| 8 | none | 595 | Léo 85 %, Gabriel 88 %, 168 tasks left open |
| 9 | community manager | 277 | |
| 10 | data analyst | 87 | **85 % of the wait is gone** |
| 11 | VOC analyst | 73 | |
| 12 | partner manager | 68 | |
| 13 | video editor | 63 | |
| 14 | media buyer | 58 | |
| 15 | chief of staff | 54 | |

At ×1, the first hire takes wait from 53 to 21, the second to 16, and the rest are worth almost nothing. 31 at ×3 still copes (131/day): 31 is the size of a company three times bigger than this one.

**Consequence for the design.** Headcount value collapses after the first few hires, so the hire rule must be strict and its threshold must sit between these curves. A relief of 12/day does that on the marginal numbers above: one hire at ×1, about three at ×2. The rule reads a role's total wait, which is at least its marginal relief, so it may hire slightly more. **Prediction, unverified: 9 to 12 agents at day 60 on the normal median.**

**[measured] The handlers are already bounded, with one exception.** `reply_inbox` handles 6 messages per task and the plan creates one task per 6 messages. `optimize_ads` handles every campaign in one tick, `daily_report` and `reconcile_ledger` are flat. Section 8 fixes that, otherwise size adds no back-office work.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | 8 founders: Camille, Nadia, Élise, Zoé, Léo, Clara, Gabriel, Nora. The 23 others become the named candidate pool of their role. |
| D2 | 13 departments in the catalog, 2 new: `video` (Studio Vidéo) and `crm` (Communauté & Email). 8 open on day 1. |
| D3 | 34 roles. Role = title, dept, tier, `core` kinds, `assist` kinds, `seats`, `lead`. |
| D4 | Pay: haiku 0.50, sonnet 0.80, opus 1.20 €/day (15 / 24 / 36 €/month). +3 % per level. Booked daily at the market close. |
| D5 | Speed: core and assist 1.0, hat 0.67, first 3 days of a hire × 0.6. |
| D6 | A hire lands 3 days after the first pressured evening at best: pressure must hold 3 evenings, the position opens on the third, the `recruit` task runs the next day, then the 3-day ramp. The 7-day window adds its own lag before that. |
| D7 | Decision is deterministic code, never the content engine. Nora proposes, Gabriel checks the money, Camille signs. |
| D8 | Founders are never laid off by the cost rule and can only leave once their replacement has arrived. The CEO cannot be dismissed by the company. |
| D9 | Departed agents leave `company.agents` for `org.alumni`. No status filter on every loop. |
| D10 | Stop-loss and refunds preempt everything, whatever the queue. |
| D11 | Agent ids stay first names (`slugify(name)`), never `nextId`, so the brain stays readable and `idCounter` stays independent of hires. |
| D12 | Random draws for candidates use `STREAM.org = 5`, keyed `(seed, 5, day, positionIndex)`. |

## 3. Types (`shared/types.ts`)

```ts
export type DeptId = /* existing 11 */ | 'video' | 'crm';

export type TaskKind = /* existing 34 */
  | 'headcount_review'   // RH: bottlenecks, money, decision of the week or the day
  | 'recruit';           // RH: draw candidates, pick, sign

export type RoleId =
  | 'ceo' | 'chief_of_staff'
  | 'research_lead' | 'competitor_analyst' | 'voc_analyst'
  | 'editor_in_chief' | 'ghostwriter' | 'humanizer' | 'fact_checker'
  | 'art_director' | 'cover_designer' | 'layout_designer'
  | 'video_editor' | 'motion_designer'
  | 'growth_lead' | 'hook_writer' | 'media_buyer_tiktok' | 'media_buyer_meta' | 'media_buyer_youtube'
  | 'community_manager' | 'email_marketer'
  | 'shop_lead' | 'sales_copywriter' | 'pricing_manager'
  | 'support_lead' | 'support_agent'
  | 'data_analyst' | 'experiment_analyst'
  | 'cfo' | 'accountant'
  | 'hr_lead' | 'red_teamer'
  | 'partnerships_lead' | 'partner_manager';

export type Office =
  | 'ceo' | 'chief_of_staff' | 'cfo' | 'accountant' | 'hr' | 'analyst' | 'research' | 'editor'
  | 'fact_checker' | 'art' | 'growth' | 'shop' | 'pricing' | 'support' | 'partners' | 'red_team';

/** Who is there on day 1, and what the organisation may do. Absent on a save from before the org: behaves as LEGACY_ORG. */
export interface OrgConfig {
  team: 'lean' | 'legacy31';
  autoHire: boolean;           // false: the team stays as it is (paired control)
  payroll: boolean;            // false: agents are free (control, old tests)
}
// ScenarioConfig gains: org?: OrgConfig

// AgentDef gains:
//   roleId: RoleId; gender: 'f' | 'm'; founder: boolean;
// AgentState gains:
//   hatKinds: TaskKind[];       kinds worn outside the role, at ORG.hatSpeed
//   hatDepts: DeptId[];         departments of those kinds (lesson routing, chat facts)
//   hiredDay: number;           0 = founding team
//   rampUntilDay: number;       last day at ORG.rampSpeed
//   notice: { day: number; reason: string; by: AgentId } | null;   // decided, waits for the replacement

export type LedgerType = /* existing */ | 'salary' | 'recruiting';
export type ActivityKind = /* existing */ | 'org';
// FounderHold.kind gains 'hiring'
// FinanceSnapshot gains: payroll: number;   cumulative 'salary' + 'recruiting', no longer inside otherCosts

export interface KindLoadDay {
  day: number;
  wait: Partial<Record<TaskKind, number>>;       // task-ticks a ready task waited, unstarted
  reviewWait: Partial<Record<TaskKind, number>>; // task-ticks a finished task waited for its reviewer
  work: Partial<Record<TaskKind, number>>;       // ticks actually worked
  busy: Record<AgentId, number>;                 // ticks worked or reviewed, 0..9
  headcount: number;
  payroll: number;                               // booked at the close
}

export interface RolePressure { roleId: RoleId; relief: number; ownerUtil: number; days: number }

export interface Candidate {
  id: AgentId; name: string; gender: 'f' | 'm'; roleId: RoleId; tier: ModelTier;
  persona: string; skills: string[]; avatar: AvatarSpec;
  interview: number;   // 0..100, the only signal the company sees. Talent pillar defines it.
}

export type PositionReason = 'bottleneck' | 'channel' | 'replacement' | 'founder';

export interface Position {
  id: string;               // `pos_<n>`, n = index in org.positions + 1
  roleId: RoleId;
  reason: PositionReason;
  detail: string;           // French, read in the feed
  openedDay: number; closedDay: number | null;
  status: 'open' | 'filled' | 'cancelled';
  candidates: Candidate[];
  hiredId: AgentId | null;
  replaces: AgentId | null;
  taskId: string | null;
}

export interface OrgDecision {
  id: string; day: number;
  kind: 'position' | 'refused' | 'hire' | 'leave' | 'layoff' | 'dept_open' | 'dept_close' | 'chief' | 'pay_cut';
  roleId: RoleId | null; agentId: AgentId | null;
  text: string;             // French, shown in the feed and the Team tab
  numbers: Record<string, number>;   // what the decision read: margin, payroll, cash, relief, ownerUtil...
}

export interface Alumnus {
  id: AgentId; name: string; gender: 'f' | 'm'; roleId: RoleId; dept: DeptId; founder: boolean;
  hiredDay: number; leftDay: number; reason: string; level: number;
  perf: AgentState['perf']; avatar: AvatarSpec;
}

export interface OrgState {
  offices: Record<Office, AgentId>;       // resolved by reconcileOrg, always a living agent
  deptHost: Partial<Record<DeptId, DeptId>>; // closed department -> open department carrying its kinds
  closedDepts: DeptDef[];                 // catalog minus open: drawn as vacant plots
  load: KindLoadDay[];                    // last 14 days, the open day last
  pressure: RolePressure[];
  positions: Position[];
  decisions: OrgDecision[];               // last 60
  alumni: Alumnus[];
  lastHireDay: number; lastLayoffDay: number; lossDays: number;
  stats: { hires: number; departures: number; layoffs: number; lastResortHats: number; violations: number };
}
// CompanyState gains: org?: OrgState   (absent on older saves until the Company mounts)
```

## 4. Catalog (`server/src/runtime/org/catalog.ts`, pure data, imports types only)

`core`/`assist` preserve today's `taskKinds` order exactly, so `legacy31` keeps its behaviour. `seats` caps holders. Bold = founding role. A role with an empty `core` cannot be hired until the owning pillar lands its kinds.

| Dept | Role | Title (FR) | Tier | Core | Assist | Seats | Named candidate |
|---|---|---|---|---|---|---|---|
| direction | **ceo** | CEO & orchestratrice | opus | plan_day | pick_opportunity | 1 | Camille |
| direction | chief_of_staff | Chef de cabinet | sonnet | follow_missions | plan_day, pick_opportunity, daily_report | 1 | Hugo |
| recherche | **research_lead** | Cheffe Recherche | sonnet | scan_trends, pick_opportunity, mine_pains | | 1 | Nadia |
| recherche | competitor_analyst | Veille concurrents | haiku | scan_competitors | scan_trends | 2 | Malo |
| recherche | voc_analyst | Voix du client | sonnet | mine_pains | scan_competitors | 3 | Yasmine |
| studio | **editor_in_chief** | Rédactrice en chef | opus | write_titles, write_outline, write_pdf | | 1 | Élise |
| studio | ghostwriter | Plume | sonnet | write_pdf | write_titles | 6 | Théo |
| studio | humanizer | Éditrice-humanisatrice | sonnet | humanize_pdf | write_pdf | 3 | Lina |
| studio | fact_checker | Fact-checker | sonnet | fact_check | humanize_pdf | 3 | Samuel |
| creation | **art_director** | Directrice artistique | sonnet | design_cover, render_pdf | | 1 | Zoé |
| creation | cover_designer | Designer de couvertures | haiku | design_cover | | 3 | Kenji |
| creation | layout_designer | Maquettiste | sonnet | render_pdf | design_cover | 3 | Maëlle |
| video | video_editor | Monteuse vidéo | sonnet | produce_ad | | 6 | Chloé |
| video | motion_designer | Motion designer | sonnet | *video pillar kind* | produce_ad | 3 | new |
| growth | **growth_lead** | Head of growth | opus | write_ad_hooks, launch_campaign, optimize_ads | | 1 | Léo |
| growth | hook_writer | Scénariste de hooks | sonnet | write_ad_hooks | produce_ad | 4 | Sarah |
| growth | media_buyer_tiktok | Media buyer TikTok | sonnet | launch_campaign, optimize_ads | | 3 | Adam |
| growth | media_buyer_meta | Media buyer Meta | sonnet | same, `channel: 'meta'` | | 3 | new |
| growth | media_buyer_youtube | Media buyer YouTube | sonnet | same, `channel: 'youtube'` | | 3 | new |
| crm | community_manager | Community manager | haiku | post_organic | produce_ad | 4 | Tom |
| crm | email_marketer | Email marketer | sonnet | *channels pillar kind* | | 2 | new |
| boutique | **shop_lead** | Cheffe boutique | sonnet | publish_product, write_sales_page | | 1 | Clara |
| boutique | sales_copywriter | Copywriter page de vente | sonnet | write_sales_page | | 3 | Mehdi |
| boutique | pricing_manager | Pricing & upsell | haiku | set_price, design_upsell | | 1 | Paul |
| support | support_lead | Cheffe support | sonnet | reply_inbox, handle_refund | | 1 | Inès |
| support | support_agent | Agent support | haiku | reply_inbox, handle_refund | | 8 | Lucas, Fatou |
| analyse | data_analyst | Data analyst | sonnet | daily_report | run_experiment | 2 | Raphaël |
| analyse | experiment_analyst | Expériences A/B | haiku | run_experiment | daily_report | 2 | Emma |
| finance | **cfo** | CFO | sonnet | budget_review | | 1 | Gabriel |
| finance | accountant | Comptable | haiku | reconcile_ledger, weekly_pnl | budget_review | 2 | Alice |
| rh | **hr_lead** | DRH & coach | sonnet | retro, performance_review, headcount_review, recruit | | 1 | Nora |
| rh | red_teamer | Red Team | opus | red_team | | 2 | Axel |
| partenariats | partnerships_lead | Chef partenariats | sonnet | find_creators, negotiate_deal | | 1 | Rayan |
| partenariats | partner_manager | Négociation & anti-fraude | haiku | negotiate_deal | find_creators | 4 | Louise |

`lead: true` on the eight founding roles plus `support_lead`, `partnerships_lead`: preferred when a chief is chosen.

Catalog total: 34 roles, 86 seats, capped by `ORG.maxHeadcount = 60`.

Fatou shares `support_agent`: her "anti-fraud" job has no distinct kind, so a separate role would be a label. Same reason there is no recruiter: 0.2 tick/day.

**`legacyDept`.** `CANDIDATES.chloe` and `CANDIDATES.tom` carry `legacyDept: 'growth'`, used only by `team: 'legacy31'`, so that team stays on 11 departments.

### The hat table, the heart of the routing

```ts
/** Who wears a kind nobody holds in core or assist: first living role wins, the CEO is the last resort.
 *  A Record on purpose: a pillar that adds a TaskKind without an owner does not compile. */
export const KIND_HATS: Record<TaskKind, readonly RoleId[]> = {
  follow_missions: ['ceo'],
  scan_competitors: ['research_lead'],
  find_creators: ['research_lead'], negotiate_deal: ['research_lead'],
  humanize_pdf: ['editor_in_chief'],
  fact_check: ['hr_lead'], red_team: ['hr_lead'],
  produce_ad: ['art_director', 'growth_lead'],
  post_organic: ['growth_lead'],
  set_price: ['shop_lead'], design_upsell: ['shop_lead'],
  reply_inbox: ['shop_lead'], handle_refund: ['shop_lead'],
  reconcile_ledger: ['cfo'], weekly_pnl: ['cfo'],
  daily_report: ['cfo'], run_experiment: ['cfo'],
  // core kinds of a founding role: always held, listed for exhaustiveness
  plan_day: ['ceo'], pick_opportunity: ['research_lead'], scan_trends: ['research_lead'], mine_pains: ['research_lead'],
  write_titles: ['editor_in_chief'], write_outline: ['editor_in_chief'], write_pdf: ['editor_in_chief'],
  design_cover: ['art_director'], render_pdf: ['art_director'],
  write_ad_hooks: ['growth_lead'], launch_campaign: ['growth_lead'], optimize_ads: ['growth_lead'],
  publish_product: ['shop_lead'], write_sales_page: ['shop_lead'],
  budget_review: ['cfo'], retro: ['hr_lead'], performance_review: ['hr_lead'], headcount_review: ['hr_lead'], recruit: ['hr_lead'],
};

export const OFFICES: Record<Office, { roles: readonly RoleId[]; kind: TaskKind }> = {
  ceo: { roles: ['ceo'], kind: 'plan_day' },
  chief_of_staff: { roles: ['chief_of_staff'], kind: 'follow_missions' },
  cfo: { roles: ['cfo'], kind: 'budget_review' },
  accountant: { roles: ['accountant'], kind: 'reconcile_ledger' },
  hr: { roles: ['hr_lead'], kind: 'retro' },
  analyst: { roles: ['data_analyst', 'experiment_analyst'], kind: 'daily_report' },
  research: { roles: ['research_lead'], kind: 'scan_trends' },
  editor: { roles: ['editor_in_chief'], kind: 'write_outline' },
  fact_checker: { roles: ['fact_checker'], kind: 'fact_check' },
  art: { roles: ['art_director'], kind: 'design_cover' },
  growth: { roles: ['growth_lead'], kind: 'optimize_ads' },
  shop: { roles: ['shop_lead'], kind: 'publish_product' },
  pricing: { roles: ['pricing_manager'], kind: 'set_price' },
  support: { roles: ['support_lead', 'support_agent'], kind: 'reply_inbox' },
  partners: { roles: ['partnerships_lead', 'partner_manager'], kind: 'find_creators' },
  red_team: { roles: ['red_teamer'], kind: 'red_team' },
};

export const REVIEW_OFFICE: Partial<Record<TaskKind, Office>> = {
  write_pdf: 'fact_checker', render_pdf: 'fact_checker', fact_check: 'editor', design_cover: 'art',
  red_team: 'ceo', produce_ad: 'growth', write_sales_page: 'shop', publish_product: 'ceo', weekly_pnl: 'cfo',
};
```

**The founding team, as the table above derives it**

| Agent | Role | Hats | Dept open |
|---|---|---|---|
| Camille | CEO | suivi des missions | direction |
| Nadia | Recherche | concurrents, créateurs, négociation | recherche |
| Élise | Rédactrice en chef | humanisation | studio |
| Zoé | DA | production des pubs | creation |
| Léo | Growth | posts organiques | growth |
| Clara | Boutique | prix, upsell, inbox, remboursements | boutique |
| Gabriel | CFO | compta, P&L, rapport, A/B | finance |
| Nora | DRH | fact-check, Red Team | rh |

Separation of duties survives: the writer (Élise) is reviewed by the fact-checker office (Nora), the fact-check by the editor (Élise), the Red Team by the CEO, publication by the CEO. Closed on day 1: analyse, support, partenariats, video, crm.

**Below 8 those pairs get thin.** In the 6-agent team tested, one person writes the guide, makes the cover and writes the sales page.

## 5. Money (`server/src/runtime/org/payroll.ts`)

```ts
export const ORG = {
  workTicksPerDay: 9, maxHeadcount: 60,
  payPerDay: { haiku: 0.5, sonnet: 0.8, opus: 1.2 } as Record<ModelTier, number>,
  levelRaise: 0.03, recruitingDays: 7, severanceDays: 7, survivalPayCut: 0.5,
  hatSpeed: 0.67, rampDays: 3, rampSpeed: 0.6,
  windowDays: 7, reliefPerDay: 12, ownerUtil: 0.7, pressureDays: 3, hireCooldownDays: 3,
  reserveDays: 30, marginCover: 1.15, cashRouteDays: 120, revPerHeadPayMultiple: 3, adReserveDays: 7,
  layoff: { cashDays: 21, lossDays: 5, idleUtil: 0.2, idleDays: 14, cooldownDays: 3 },
} as const;

export function payOf(a: AgentState): number {
  return round2(ORG.payPerDay[a.tier] * (1 + ORG.levelRaise * (a.level - 1)));
}
```

`ORG` lives in `runtime/org/constants.ts`. `sim/balance.ts` stays frozen.

**Booking.** `bookPayroll(ctx)` runs in `Company.marketClose()` right after `sim.tickMarket`. One line per day:

```ts
sim.recordLedger(w, { type: 'salary', amount: -payrollToday(w), memo: `Salaires du jour (${n} agents)`, ref: `payroll:${w.day}` });
```

- Same daily accrual as `FEES.boutiqueDaily`.
- Guarded by `ledger.some((e) => e.ref === ref)`.
- `lastClosedLedgerDay` matches `^fixed:` only, so it is unaffected.
- With `org.payroll === false`, nothing is booked.

**One-offs.** Type `recruiting`, ref `hire:<id>` (7 days of pay) and `leave:<id>` (7 days of pay). `summarizeLedger` treats them as one-offs like `SETUP_REF`, so they do not inflate `burn7d`.

**Survival.** While `cash < 0.3 × startingCash`, founders take `survivalPayCut`. While `status === 'bankrupt'`, founders take 0. An `OrgDecision { kind: 'pay_cut' }` fires on the transition only.

**Ledger consumers to update**

| File | Change |
|---|---|
| `core/ledger.ts` | new `payroll` total, `case 'salary': case 'recruiting'`; `oneOff7d` covers refs `hire:` and `leave:` |
| `runtime/accounting.ts:36` | `fixed` adds both types |
| `runtime/situation.ts:36` | costs list adds both types |
| `runtime/metrics.ts` `computeBudget` | `adCap = round2(max(0, cash - ORG.adReserveDays * payrollToday(w)) * rate)` |
| `api/http.ts:210-214`, `api/session.ts:171`, `cli.ts:28` | use `minRunCash()` from `org/payroll.ts` |

`minRunCash() = ceil((setupCost + 30 × (fixed + foundersPay)) / 10) × 10 = 330 €`. `api.test.ts:382-384` asserts 110 today and moves with it. With `payroll: false` the old floor of 110 € stays.

**Payroll by size**

| Headcount | €/day | €/month | Over 60 days | Operating margin needed (×1.15, fixed costs included) |
|---|---|---|---|---|
| 8 founders | 7.60 | 228 | 456 € | 10.3 €/day |
| 12 typical | 10.50 | 315 | 630 € | 13.7 €/day |
| 31 legacy | 23.70 | 711 | **1 422 €** | 28.8 €/day |
| 40 (5 opus, 23 sonnet, 12 haiku) | 30.40 | 912 | 1 824 € | **36.5 €/day** |

**[measured]** Seed 7, days 1 to 25: operating margin 16.2 €/day (revenue 1 188, ads 636, fees 30, creators 30, refunds 87). So 8 survives comfortably, and 40 needs 2.25 times what the company earns today.

**Zero-revenue proof at 500 €, no ads.** 440 € after setup, 8.97 €/day, survival threshold reached on day 33, then 5.17 €/day, 7 € left on day 60. A lean team outlives a market that never buys, by a thin margin. Unit test in section 12. 31 at the same pay would be bankrupt before day 20.

## 6. Routing (`runtime/tasks.ts`, `runtime/org/officers.ts`)

**Owners.** Any agent with `kind` in `taskKinds`, which is `core ∪ assist ∪ hatKinds`.

**`fitOf(agent, kind): 'core' | 'assist' | 'hat'`** is the exported contract for talent.

```ts
export function speedFor(w: WorldState, a: AgentState, kind: TaskKind): number {
  const hat = a.hatKinds.includes(kind) ? ORG.hatSpeed : 1;
  const ramp = w.day <= a.rampUntilDay ? ORG.rampSpeed : 1;
  return hat * ramp * talentSpeed(a, kind);   // talentSpeed defaults to 1, talent pillar owns it
}
```

**`capableAgents(world, kind, dept)`** keeps its role, new rule: core owners anywhere, plus anyone in the task's department; falls back to all owners. It reproduces today's `inDept ? inDept : able` on `legacy31` and never strands a specialist whose department differs from `KIND_META[kind].dept` (Chloé in `video`, `produce_ad` homed in `growth`).

If `task.input.channel` is set and a role with that `channel` has a holder, the candidates narrow to those holders.

**`assignReady`.** The comparator's first key becomes `(agentLoad + work) / speedFor`, the rest stands. Two agents sharing a role balance through it and through the existing `farBehind`. All speeds are 1 on `legacy31`, so the order is unchanged.

**Guard kinds.** `GUARD_KINDS = ['optimize_ads', 'handle_refund']`. They skip the `energy > 20` gate in `assignReady`, and `pickTask` returns a ready guard task before the agent's current in-progress task. The stop-loss therefore runs on the morning it is due, whatever Léo's backlog.

**`workTick`** spends `speedFor` per tick:

```ts
task.workLeft = Math.max(0, round2(task.workLeft - speedFor(w, agent, task.kind)));
```

**Departments of a task.** `createTask` sets `dept: deptFor(world, kind)`: `KIND_META[kind].dept` when open, else `org.deptHost[...]`. `chiefOf` follows `deptHost` too, so it never returns undefined.

**Reviewers.** `reviewerFor(world, kind)`: for the office's first role, the least loaded holder (ties by id), else the office holder.

`fixSelfReview` walks: dept chief, `ceo`, `chief_of_staff`, `hr`, `cfo`, and takes the first who is not the assignee. In lean, `chief_of_staff` resolves to Camille, so this list is what prevents a self-review of her work.

**Rebalancing on hire.** Tasks of the hire's core kinds with `status === 'pending'` and `progress === 0`, assigned to a hat wearer, go back to `assignee: null`.

## 7. `reconcileOrg`: one idempotent function (`runtime/org/reconcile.ts`)

Called after every hire, departure, and on mount. Pure over the world, no RNG, no id.

```
1. kinds     for each agent: taskKinds = core + assist; hatKinds = []
2. hats      for each kind in ALL_KINDS order: if no owner, the first living role of KIND_HATS[kind]
             wears it; if none, the CEO wears it and stats.lastResortHats++ (+ incident)
3. hatDepts  from KIND_META[kind].dept of each hat
4. depts     open = departments of living agents, plus 'direction'. Catalog order.
             closed go to org.closedDepts, org.deptHost[closed] = dept of the hat wearer of its first
             kind, or 'direction' when no KIND_META entry is homed there (video, crm)
5. chiefs    each open dept keeps a living chief; else best member: lead role, perf.score, level,
             lowest hiredDay, id. isChief and DeptDef.chiefId follow.
6. offices   first living holder of OFFICES[o].roles, else best owner of OFFICES[o].kind
7. tasks     open tasks: dept = deptFor(kind); gone assignee -> null, pending, progress kept;
             gone reviewer -> reviewerFor(kind)
8. missions  open missions owned by someone gone -> chief of the same dept, else CEO
```

Hats are derived, never stored as a decision, so nothing can drift: a hire removes a hat, a departure brings it back, by the same code.

**Invariants: `auditOrg(world): string[]`.** Runs every evening in production, adds to `stats.violations`, reports an incident.

| | Invariant |
|---|---|
| I1 | every kind in `ALL_KINDS` has at least one living owner |
| I2 | every office resolves to a living agent |
| I3 | every open department has a member and exactly one chief, who is that member |
| I4 | every agent's department is open; no department without an agent |
| I5 | every open task's assignee and reviewer are alive, and differ |
| I6 | today's `salary` line equals `payrollToday` at the close |
| I7 | `agents.length <= maxHeadcount`; no role over its seats |
| I8 | every agent has a playbook entry and, from day 1 evening, a brain note |
| I9 | names unique across agents, alumni and candidates |

## 8. Work grows with the business

```ts
export function workFor(w: WorldState, kind: TaskKind): number {
  if (isLegacyOrg(w)) return KIND_META[kind].work;
  switch (kind) {
    case 'optimize_ads': return 1 + Math.floor(activeCampaigns(w).length / 4);
    case 'daily_report': return 1 + Math.floor(liveProducts(w) / 6);
    case 'reconcile_ledger': return 1 + Math.floor(ordersOfYesterday(w) / 40);
    default: return KIND_META[kind].work;
  }
}
```

`createTask` uses it when `spec.workLeft` is absent. Without this, a 40-person company has the same back office as a 8-person one, and the bottleneck signal is silent where it should speak.

Real costs of a queue, all already in the market or the plan, none invented here:

- A post not done before tick 10 misses that day's market close.
- An inbox reply after `deadlineDay` escalates to a bad review or a chargeback.
- A late launch loses days of sales.
- A stale creative keeps its fatigue.

## 9. Load, decision, hire (`runtime/org/load.ts`, `hiring.ts`)

### Measuring

`recordLoad(ctx, worked)` at the end of `workTick`: `load.work[kind] += ticks`, `busy[id] += 1` for each worker and reviewer. For each open task: `pending` and `depState === 'ready'` adds 1 to `wait[kind]`; `review` adds 1 to `reviewWait[kind]`. `awaiting_founder` counts nowhere: his latency is not a reason to hire.

Everything is in `world.company.org.load`, so reload is exact.

### Evening, after the HR review

```ts
for each role r with core non-empty and free seats:
  relief(r)   = (Σ wait7d[k in core(r)] + Σ reviewWait7d[k: REVIEW_OFFICE[k] maps to r]) / days
  ownerUtil(r)= mean over owners of core(r) of busy7d / (9 × days)
  days(r)     = relief(r) >= 12 && ownerUtil(r) >= 0.70 ? days(r) + 1 : 0
pick = argmax relief(r) / payPerDay(tier) among days(r) >= 3 (ties: role id)
```

`headcount_review` is a `runImmediate` ritual of the HR office: on every 7th day for the weekly report, and on any evening with a candidate. No task on quiet evenings.

**Why relief per euro.** It reproduces the greedy replay: community manager first (haiku, largest wait), then data analyst. It also sends juniors in before leads, which is what a cash-constrained founder does.

### Gates, all deterministic, all read from the ledger

Let `P` payroll/day, `p` pay of the role, `F = boutiqueDaily + toolsDaily`, `C = cash`, `M` operating margin/day over the last 7 closed days (revenue minus refund, chargeback, ad_spend, payment_fee, creator_payout, scam_loss, discount; holds excluded), `R` revenue of the last 30 closed days scaled to 30.

The right column is a hand estimate for a first hire (haiku), from the seed 7 run of section 1, which had no payroll.

| Gate | Rule | Seed 7, day 18 |
|---|---|---|
| G0 frozen | not `survival`, not bankrupt, no `hiring` hold, `autoHire` true, no open position, `day - lastHireDay >= 3`, `agents < 60` | pass |
| G1 reserve | `C >= 30 × (P + p + F)` | about 600 € with payroll ≥ 284 € |
| G2 margin **or** cash | `M >= 1.15 × (P + p + F)` **or** `C >= 120 × (P + p + F)` | M about 40 €/day ≥ 10.9 |
| G3 revenue per head | margin route only: `R / (n + 1) >= 3 × monthly pay` | 127 €/month ≥ 45 |

Failure emits one `OrgDecision { kind: 'refused' }` per role per 7 days with its numbers, so the founder sees why nothing happens. Otherwise the position opens.

Bypasses:

- `reason: 'founder'`: skips the bottleneck and G3, keeps G0 except `autoHire`, keeps G1.
- `reason: 'channel'` (`requestRole`): skips the bottleneck, keeps every money gate.
- `reason: 'replacement'`: skips the bottleneck and the money gates.

### Who says what (French feed lines, kind `org`)

- Nora: `Nora propose d'embaucher : ${role.title}. ${label} attend ${relief} ticks par jour, ${owner} est occupé${e} à ${util} %.`
- Gabriel, pass: `Gabriel valide : ${M} € de marge par jour pour ${cost} € de frais après embauche, ${cash} en caisse.`
- Gabriel, refused: `Gabriel refuse : la marge couvre ${pct} % des frais fixes après embauche, il faut 115 %.`
- Camille: `Camille signe : ${name} rejoint l'agence comme ${role.title} (${monthly} €/mois).`

### Recruiting

`openPosition(ctx, roleId, reason, detail, replaces?)` creates a `recruit` task for the HR office, 1 tick, priority 2, reviewer null.

The handler draws candidates, `streamRng(seed, STREAM.org, day, positionIndex)`, 3 of them:

1. The role's named legacy candidate first if still unused, with the hand-written persona and avatar.
2. Then generated from `NAME_POOL` (60 French first names, tagged by gender, skipping names in agents, alumni and candidates) with the role's `personaTemplates` and an avatar drawn from the same palette arrays as `roster.ts`.
3. `interview` from the talent pillar, else 50.

It picks the best interview (ties: id), rechecks G0 to G3. On failure the position is cancelled, not the task failed, so Nora's score does not pay for the market.

`founderApproval` mode returns `awaitFounder: Embaucher ${name} (${title}) à ${monthly} €/mois`. `honourRefusal` then cancels the position and adds a `hiring` hold for `REFUSAL_COOLDOWN_DAYS`.

### `hireAgent(ctx, position, candidate)`, in the task's `onDone`

1. Push the `AgentState`: level 1, xp 0, energy 100, `hiredDay: day`, `rampUntilDay: day + 3`, place = dept.
2. `inheritRules`: `SEED_PLAYBOOKS[dept]`, then every rule held by the current owners of its core kinds, through `addRule` (12 rule cap, confidence trim). Lessons whose rule was copied get the id in `appliesTo`. **Without this the learned hook, price and banned words are lost on the first hire.**
3. `recordLedger({ type: 'recruiting', amount: -7 × payOf, ref: 'hire:<id>' })`.
4. `reconcileOrg`: hats drop, department opens, chief set.
5. Rebalance (section 6). If `position.replaces`, complete that departure.
6. `writePlaybookNotes(world, brain, [id], day)`, `writeOrgNote(ctx)`.
7. Emit the `org` activity; `lastHireDay`, `stats.hires`, decision log.

## 10. Leaving (`runtime/org/departure.ts`)

```ts
export function canLeave(w, id): { ok: boolean; blockers: TaskKind[] };
export function requestDeparture(ctx, id, reason, by): 'left' | 'notice' | 'refused';
export function completeDeparture(ctx, id): void;
```

**The rule.** `canLeave` is false for the CEO and for the last holder of a founding role, with `blockers` = its core kinds. Everyone else can leave at once, because `KIND_HATS` names a living founder for each kind: the replacement is in place before the removal, in the same `reconcileOrg`.

- `ceo`: `'refused'`.
- Blocked founder: `agent.notice` set, position `reason: 'replacement'` opened, agent keeps working and being paid. `hireAgent` completes the departure.
- Otherwise: `completeDeparture`.

`completeDeparture`:

1. Handover: machine rules (`hasMachineRule`) of the leaver are `addRule`d to the remaining owners of the leaver's core kinds. A banned word survives.
2. Move the agent to `org.alumni`, remove from `company.agents`. Delete `memory.idleTicks[id]`, `memory.recalled[id]`. Keep `playbooks[id]` and `chats[id]`.
3. `reconcileOrg`.
4. `recruiting` line, 7 days of pay, ref `leave:<id>`.
5. Agent note gets `> A quitté l'agence le jour N : raison`, stays in the vault with tag `alumni`. Links keep working.
6. `writeOrgNote`, activity, decision log.

`nameOf` and `agentById` callers that display history read `org.alumni` as a fallback (`nameOf` in `ctx.ts`, `task.assignee` in the UI).

**Layoffs, checked each evening after the hire logic**

- **L1 cash.** `lossDays` counts evenings with `C < 21 × (P + F)` and `M < P + F`. At 5, lay off the non-founder with the lowest 14-day utilisation (ties: highest pay, id). Reset after a layoff.
- **L2 idle.** A role with at least 2 holders, one of them under 20 % for 14 days and hired 14 days ago or more: lay that one off.

At most one per 3 days. Founders are outside both rules. Nora signs, Gabriel gives the numbers.

## 11. Who else follows, line by line

### The sweep (first commit, no behaviour change, proven by the golden test)

| File | Literal ids | Pattern |
|---|---|---|
| `runtime/company.ts` | 37 | `officerOf(w, 'ceo')`, `runImmediate('budget_review', officerId(w, 'cfo'), ...)` |
| `runtime/strategy.ts` | 13 | `speak(ctx, 'ceo', ...)`, `by = officerId(ctx.world, 'ceo')` |
| `runtime/tasks.ts` | 11 | `DEFAULT_REVIEWER` -> `REVIEW_OFFICE`; `FEMININE` -> `agent.gender` |
| `runtime/handlers/growth.ts` | 10 | `GROWTH_WRITERS` -> `ownersOfAny(w, ['write_ad_hooks', 'produce_ad', 'post_organic'])` |
| `runtime/redteam.ts`, `handlers/research.ts` | 8 + 8 | as above |
| `runtime/pipeline.ts` | 7 | default param `by` computed |
| `runtime/handlers/boutique.ts` | 5 | |
| `runtime/review.ts`, `orders.ts` | 4 + 4 | |
| `learning/data.ts`, `retro.ts`, `review.ts` | 3 + 1 + 1 | `retroAgent` reads `org.offices.hr` first; `learning/` keeps importing no runtime code |
| `handlers/ops.ts`, `studio.ts`, `partners.ts`, `missions.ts`, `upsell.ts`, `world.ts` | 7 | `missions.ts:493` uses the `fixSelfReview` walk |

Counts are matching lines, 119 in total. 33 `say`/`emit` lines also carry a first name inside the French text.

New helper in `ctx.ts`: `speak(ctx, office, text, kind?, refs?)` prefixes `${name} : `. Strings like `Camille lance la chaîne...` become `${nameOf(ctx, ceo)} lance...`.

Other changes:

| File | Change |
|---|---|
| `runtime/roster.ts` | keeps `DEPARTMENTS` (13 entries), `SEED_PLAYBOOKS`, `PLAYBOOK_NOTES`; `AGENTS` moves to `org/catalog.ts` as `CANDIDATES`; comment line 2 |
| `runtime/world.ts` | `buildTeam(sc.org)`; founders' seed rules = own dept + `hatDepts`; comment line 1 |
| `runtime/company.ts` constructor | older save: `world.company.org ??= legacyOrgState(world)`, agents get `roleId` from `CANDIDATES` |
| `runtime/handlers/index.ts` | add `headcount_review`, `recruit` to the `Record<TaskKind, HandlerSpec>` |
| `runtime/tasks.ts:58` | `PLAN_KINDS` excludes both |
| `runtime/situation.ts:111` | `switch` loops over `[agent.dept, ...agent.hatDepts]` |
| `learning/playbooks.ts:11,68` | `TOPIC_DEPTS.ads: ['growth', 'video', 'crm']`; `agentsForLesson` tests `a.dept` or `a.hatDepts` |
| `learning/text.ts:202,216`, `minds/heuristic/direction.ts:9,20,103`, `web/src/ui/labels.ts:27,55`, `web/src/world/palette.ts:50` | new dept and kind entries, the compiler lists them |
| `api/trim.ts:197` | `org: trimOrg(c.org)`: last 14 load days, 20 positions, 60 decisions, last 50 alumni, without any hidden talent field |
| `api/http.ts` `sanitizeScenario` | accepts `org` |
| `cli.ts`, `scripts/balance.ts`, `scripts/balanceLib.ts` | `--team`, `--no-hire`, `--no-payroll`; columns Effectif, Masse salariale, Embauches, Départs, Violations |

### Brain

- One note per agent: on `Company.ready()` write the note of every agent without one, today it only appears once a playbook changes.
- New generated note `entreprise/Organigramme.md`, rewritten at each change: open departments, members, hats, closed departments and their host, payroll, revenue per head.
- New seed notes: `politiques/Recrutement.md` (the rules with the `ORG` numbers), `playbooks/Playbook Vidéo.md`, `playbooks/Playbook Communauté.md`. `00 - Accueil.md` links them.
- `deptRulesSection` of a closed department says who carries it.
- `rh/effectif-semaine-N.md`: weekly table role, owners, wait, utilisation, payroll, decisions.

### Every "31"

| Where | Change |
|---|---|
| `README.md:3,25,90` | "une équipe fondatrice de 8 agents qui recrute quand les chiffres le demandent" |
| `docs/ARCHITECTURE.md:3` | same; add the org block to the diagram |
| `docs/ROADMAP.md:8`, `docs/BALANCE.md:155` | same |
| `server/src/contracts.ts:263`, `roster.ts:2`, `world.ts:1`, `web/src/world/mockSnapshot.ts:1` | comments |
| `server/test/runtime.test.ts:22-23,58,158-159` | move to `team: 'legacy31'` helper, add lean assertions |
| `web/src/world/world.test.ts:62-65` | invariants instead of a count |
| `docs/REFERENCES.md:3` | **keep**: it is the title of the video |
| `README.md:58`, `BALANCE.md:67,118-119`, seeds and dates | **keep**: unrelated 31 |

### Mock snapshot (`web/src/world/mockSnapshot.ts`)

Day-10 company of 12: the 8 founders plus Tom, Lucas, Raphaël, Adam. 11 open departments, `partenariats` and `video` closed. `ROWS` filtered, tasks re-pointed to those 12 and hats filled, plus a full `org` block (10 load days, 1 filled and 1 open position, 3 decisions, 1 alumnus). Tests assert invariants I1 to I4 on it.

## 12. Tests, each fails without its feature (`server/test/org.test.ts`)

| # | Test | Fails without |
|---|---|---|
| 1 | **Coverage, every day of every run**: `auditOrg === []` on every evening, 3 seeds × 3 difficulties, 30 days. The benchmark adds a Violations column that must be 0 on all seeds | hats, reconcile |
| 2 | Chaos: a test driver requests a departure every 3 days from a seeded list, for 40 days, audit stays empty, no task stays unassigned over 2 days | departure, reconcile |
| 3 | `reconcileOrg` is idempotent: twice gives a deep-equal world | derived state |
| 4 | Founding team: 8 agents, 8 open depts, 17 hats, payroll 7.60 €/day, every review pair distinct | catalog |
| 5 | Golden: `legacy31`, no hire, no payroll, seed 7, 25 days gives the exact pre-change ledger hash and task list. Hash recorded once the parallel workflows land | the sweep |
| 6 | One `salary` line per closed day, equal to the sum of `payOf`; cash = ledger sum; a reload between tick 10 and 11 books nothing twice | payroll |
| 7 | Reload: a run with hires, reloaded at a random tick, ends byte-identical (extends the test in `runtime.test.ts`) | persisted org |
| 8 | Same market: auto vs frozen on one seed give identical `market.events` kinds and days | stream isolation |
| 9 | Zero revenue at 500 € with lean and no ads: cash positive on day 60. Same with 31 paid: negative before day 20 | pay scale, survival cut |
| 10 | Gate table: bottleneck without margin, margin without bottleneck, hold, survival, cooldown, founder approval: no hire in each, a hire with all green | gates |
| 11 | A hire removes the hat, opens the department, its first member is chief | reconcile |
| 12 | Last hire of a department leaves: department closes, tasks re-homed, hat back on the founder | closing |
| 13 | Chief leaves: best member promoted, missions re-owned, reviews re-routed | chief change |
| 14 | Founder with no replacement: `'notice'`, stays, still paid; hire arrives: gone; I1 true at every step | last-owner rule |
| 15 | CEO: `'refused'` | D8 |
| 16 | Inherit: new hook writer has the banned words and hook directive of Léo; leaver's banned word reaches the remaining owner | rule inheritance |
| 17 | Guard: Léo with 40 ticks of backlog and low energy, `optimize_ads` still done before tick 10 on every day a campaign is active | preemption |
| 18 | Capacity matters: lean vs lean plus a ghostwriter on two parallel chains: the second publishes sooner | speed, routing |
| 19 | `speedFor`: hat task of 4 work takes 6 ticks; ramp takes longer | hat speed |
| 20 | `workFor`: 8 campaigns cost 3 ticks; `legacy31` stays at 1 | volume work |
| 21 | Layoff L1 on a collapsing margin, L2 on an idle duplicate; founders untouched | layoffs |
| 22 | `Recrutement.md` quotes the `ORG` numbers | policy drift |
| 23 | Web: layout after a hire adds a seat, `effectiveGrid` never moves an island when a department opens; mock passes I1 to I4 | ui contract |

`KIND_HATS` is the compile-time half of test 1.

**Test helper.** `LEGACY_ORG = { team: 'legacy31', autoHire: false, payroll: false }` goes into the scenario helpers of `learning`, `minds`, `orders`, `runtime`, `shop`, `sim`, `strategy`, `balance` tests, so the 203 literal ids stay valid.

## 13. What this pillar needs from the others

| Pillar | Need |
|---|---|
| **talent** | `talentSpeed(a, kind)` multiplier; quality effect of `fitOf` (a hat must also cost quality, otherwise specialists only buy speed); `rollTalent` and `Candidate.interview`; who to fire and when, through `requestDeparture`; any hidden talent field stripped by `trimOrg`. Pay already rises with level. |
| **channels** | `ChannelId` list (final `media_buyer_*` rows); `task.input.channel`; `requestRole(ctx, role, 'channel', detail)` before opening a channel; kinds and owners for email. Rename `growth` from "Pub TikTok" in `DEPARTMENTS`. |
| **video** | Its new kinds, each with a `KIND_HATS` entry, and `motion_designer.core`. Say whether `produce_ad` keeps its work of 2. |
| **pdf** | Same contract for any new kind. A heavier `write_pdf` moves the replay numbers. |
| **scale** | `MAX_AWAITED_PUBLISHES` becomes `chainSlots(w) = clamp(writers + 1, 2, 6)`, `writers` = owners of `write_pdf` without hats. Otherwise a second writer has nothing to write. It also owns the final calibration, including `ORG.payPerDay`. |
| **ui** | Team tab; vacant plots (below). |

**A new TaskKind contract, for all pillars.** Add to `KIND_META` and `KIND_HATS`, give it a role, add its labels. The compiler enforces the second.

### How it reaches the UI

- Data: `CompanySnapshot.company.org`, already through SSE. No new endpoint: the founder acts through missions.
- Founder orders, for the orders work once it lands: `gèle les embauches`, `reprends les embauches`, `embauche un monteur vidéo` (position `founder`), `vire X` (`requestDeparture`).
- HUD: effectif, masse salariale/mois, revenu par tête.
- Team tab: chart by open department with hat badges, pressure bars per role (relief against 12, utilisation against 70 %), last refusal with numbers, positions and candidates, alumni, payroll chart.
- DeptPanel of a closed department: `Ce département n'a pas d'équipe : Clara s'en occupe`.
- **World: must-fix.** `effectiveGrid` moves any island not 4-adjacent to the group, so opening a department would shuffle the map. It must run on `[...departments, ...org.closedDepts]`, closed ones drawn as vacant plots, so a hire builds on its reserved plot and nothing moves. Two ring cells are free: `video (-3,-3)`, `crm (3,3)`.
- World: `AgentsSystem.sync` already adds and removes by id, `layoutKeyOf` already rebuilds on `[a.id, a.dept, chief]`, `mergeLive` ignores unknown ids, `islandSizeFor` caps at 16 and overflow falls back to the `visitor` spot. Left to do: an arrival walk, a selected agent who left must clear the panel, history shows alumni names.

## 14. Build order and decision rule

| Step | Content | Proof |
|---|---|---|
| 1 | Types, catalog, offices, sweep, `legacy31` | golden test, all existing tests green |
| 2 | Lean team, hats, routing, reconcile, audit, guard | tests 1 to 4, 11 to 13, 17 to 19 |
| 3 | Payroll, ledger, CFO reserve, min cash | tests 6, 9 |
| 4 | Load, review, positions, recruit, hire, inherit | tests 7, 8, 10, 16, 18 |
| 5 | Departures, layoffs, alumni, notes | tests 14, 15, 21, 22 |
| 6 | Docs, mock, UI data | test 23 |
| 7 | Benchmark control | section below |

**Pre-registered rule, per the bounded tuning note.** Run once, 30 seeds, `normal` and `cauchemar`, paired by seed. Noise floor is about ±600 € on 15 seeds, so judge the median of the paired difference.

| Run | Purpose |
|---|---|
| A: lean, auto hire, payroll | the product |
| B: lean, no hire, payroll | does hiring pay? |
| C: `legacy31`, no hire, payroll | what 31 would have cost |

Accept if: A minus B median at or above 0, A minus C median above 0, bankruptcies of A at or below those of B, Violations 0 everywhere.

If A loses to B: try `reliefPerDay` in {8, 18} once each on the same seeds, keep the best, then stop and report. Three candidates, one pass.

Expect the absolute median to fall by around the 456 € of founders' payroll: 1 408 € is no longer the reference, and the final calibration decides where it lands.

## 15. Rejected

- **Keeping 31 and only adding salaries:** 1 422 € over 60 days, the whole median profit, for about 7 % utilisation.
- **A team of 6 or 7:** saves 0.8 to 1.6 €/day, costs 0.6 to 0.9 day of lead time per launch, and thins the review pairs.
- **Asking the content engine to decide hires:** not deterministic, and `claude` mode is never live.
- **Hiring on a calendar or on revenue alone:** hires with no bottleneck, so payroll without output.
- **Hats at full speed:** a hire would then buy nothing at real volume.
- **Hats stored as decisions:** they would drift. They are derived on every change.
- **Paying monthly on day 30 and 60:** a cash cliff that crosses thresholds. Daily accrual, like `FEES`.
- **One ledger line per agent:** 40 lines a day for no reader. Per-agent pay is `payOf`.
- **`status: 'fired'` on agents in `company.agents`:** every loop would need a filter. Moved to `alumni`.
- **Letting agents take several tasks per tick:** it removes the scarcity the whole pillar rests on.
- **A recruiter role, an anti-fraud role:** no distinct load, labels only.
- **Departmental budgets and P&L:** no decision reads them.
- **Freelancers for peaks:** real idea, but peaks last 2 days and need a second cost model. Later.
- **Junior and senior versions of each role:** that is talent's job, one role plus a talent value.
- **Deleting closed departments from the map:** the islands would shuffle. Vacant plots.
- **Renaming ids to role names:** the brain's links and 203 tests read better with first names.
