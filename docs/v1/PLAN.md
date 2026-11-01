# Pixel Agency V1: the plan

The single plan engineers follow while the founder is away. Decisions are final, nobody asks him anything.

**Precedence:** this plan, then the pillar spec (`org.md`, `talent.md`, `channels.md`, `video.md`, `pdf.md`, `scale.md`, `ui.md`, all next to this file), then code comments. A spec section stays normative unless a decision below overrides it. Spec section references are written `org §7`.

**Preconditions, before S0:** the other workflow (founder orders, approvals, follow-up guides) has landed and its tests are green. Nothing below starts on a moving tree. At this critique it had not stopped: `server/src/learning/playbooks.ts` and `server/test/learning.test.ts` were still changing on top of `be75c2c`.

**This file is the master.** `contract/PLAN.src.md` and `contract/types-additions.ts` predate the critique (§7). Do not rebuild it with `contract/build-plan.mjs`: P0.1 pastes §2 from here.

**Paths** are relative to `server/src/` unless they start with `server/`, `web/`, `shared/`, `brain/`, `docs/` or `scripts/` (repo root).

**Stage gate, for every stage:** `npm run typecheck`, `npm test`, `cd server && npx tsx scripts/golden.ts --check` (unless the stage names a re-record), and one smoke run `cd server && npx tsx src/cli.ts --days 25 --budget 500 --difficulty normal --seed 7 --run-id gate-<stage> --quiet`, then delete that run folder. From S10 on, also `npm run test:long -w server`. Never kill a process you did not start.

**Integrity sweep,** end of S3, S5, S8, S11 and S13: `cd server && npx tsx scripts/balance.ts --days 60 --seeds 1,2,3,7,42 --difficulties normal --jobs 5`. Read for crashes, NaN, Σ ledger = cash, `Violations`, and all five seeds bankrupt. Seed 7 alone cannot show a crash on a firing it never had. No profit number is read and nothing is tuned on it: tuning starts at S14.

**Checkpoints:** the founder's standing note (`memory/v1-vision.md`) asks for a commit and push to main at each stage end. The orchestrator does that, engineers do not commit.

**Checked for this plan (not taken from the specs):**

- The full contract of §2 compiles. Its additions were pasted on copies of today's `shared/types.ts` and `server/src/contracts.ts`, then `tsc` ran with `strict` and `noUncheckedIndexedAccess`: exit 0, and a planted error fails it. Files: `contract/check.mjs`, `contract/types-additions.ts`, `contract/contracts-additions.ts`.
- Those two files alone prove little. Pasted on a copy of the whole tree (`server`, `web`, tests), `tsc` reports the breakage P0.1 now lists: required `AgentDef` and `AgentState` members, exhaustive records over `AdFormat`, `Order['source']`, `DeptId`, `TaskKind`, `WorldEventKind`, `Required<SessionInfo>`, `CompanyApi.skipTick`.
- Literal agent ids in `server/src`: 119 lines, as `org.md` says.
- `trimCompany` is an allow-list: new company fields stay out of snapshots unless added.
- `HANDLERS` is a cast, not an exhaustive record: a kind with no handler fails at runtime, never at compile time. `P0.2` adds the missing test.
- Skia loads `.woff` directly (`GlobalFonts.register`), French capitals and `Œ` included. Anton and Montserrat exist as `@fontsource/*` 5.3.0 WOFF. So one font folder serves PDF and video, with no TTF.
- `ffprobe` is on PATH here. `ffmpeg-static` has none, so `qa.ts` stays ffmpeg-only and acceptance uses ffprobe on top.
- `pdfjs-dist` 6.4.299 ships `build/pdf.worker.min.mjs` and `legacy/build/pdf.mjs`: both the server and the browser can use one version.
- Machine: 20 threads, 32 GB. `balance.ts` allows `--jobs 16`.

## 1. Decisions

Where specs disagree, or where a spec is wrong against the code, one line each. The spec it overrides is named.

### People, roles, money

| # | Decision | Overrides |
|---|---|---|
| D1 | **An agent is a person. There are no seats.** One `AgentState.id` = one person, `slugify(name)`, for life. A firing is `completeDeparture` plus a new agent. Reason: the org sweep removes the 119 literal ids that seats existed to protect. | talent §0.2, §7.5: `personId`, `PersonId`, `seat`, `seatPerson`, `renames`, `feminine`, `onboardingUntil`, `personAt` are dropped. Use `agent.gender`. The engine keeps keying on `ctx.agent.id`. « Seat » in talent.md reads « agent », or « role » in its churn rules |
| D2 | **8 founders, 13 departments, 35 roles, 47 task kinds, cap 60.** Founders wear 24 of 47 kinds as hats, payroll 7,60 €/day. | org §0 and test 4 say 17 of 36 and 34 roles: those predate the 13 new kinds |
| D3 | Roles: `media_buyer_youtube` is replaced by `media_buyer_google` (YouTube and Search, one account), `media_buyer_pinterest` is added. `motion_designer` core `adapt_creative`, assist `produce_ad`. `video_editor` assist `adapt_creative`. `email_marketer` core `write_email_sequence, send_broadcast, write_lead_magnet`. `pricing_manager` core gains `design_bump`. `hook_writer` core gains `write_search_ads`. `data_analyst` core gains `reconcile_channels`. | org §4, channels §13, video (it added no kind) |
| D4 | New founder core kinds: `ceo` + `portfolio_review`; `growth_lead` + `open_channel`; `cfo` + `allocate_channels`; `hr_lead` + `league_review`. New `KIND_HATS`: `adapt_creative: ['art_director','growth_lead']`, `write_search_ads: ['growth_lead']`, `reconcile_channels: ['cfo']`, `write_lead_magnet: ['editor_in_chief']`, `write_email_sequence: ['shop_lead']`, `send_broadcast: ['shop_lead']`, `design_bump: ['shop_lead']`. The other six list their founder core owner, for exhaustiveness. | org §4 |
| D5 | `KIND_META.dept`: `adapt_creative` video; `write_lead_magnet`, `write_email_sequence`, `send_broadcast` crm; `open_channel`, `write_search_ads` growth; `reconcile_channels` analyse; `allocate_channels` finance; `design_bump` boutique; `portfolio_review` direction; `headcount_review`, `recruit`, `league_review` rh. | org §7 step 4: `video` and `crm` now have homed kinds |
| D6 | Pay as `org §5`. `recruiting` = 7 days of pay at hire, 7 at departure. `HIRE_COST = 25` is dropped. | talent §7.5 |
| D7 | **`Allocation.payrollCap` is cut.** Hires read the `org §9` gates only. A cap of 5 to 15 % of a profit already net of payroll sits under the founders' own 7,60 €/day: it would freeze hiring for ever. | scale §4 |
| D8 | `split` becomes scale / test / reserve: survie .7/.3/0, adequation .6/.3/.1, acceleration .55/.25/.2, portefeuille .5/.25/.25. | scale §4.2 |
| D9 | `adCap = min(rate × max(0, cash − 7 × payrollToday), max(0, cash − reserve))`, second term only under `growthOn`. | org §5, scale §4.3 |
| D10 | Hire ramp: speed 3 days (`org §6`), quality 7 days (`rampOf`, talent §4). « Does nothing on day 1 » is dropped. | talent §7.5 |

### Talent and competition

| # | Decision | Overrides |
|---|---|---|
| D11 | `Skill` has 9 values: `copy, video, longform, polish, page, design, buying, research, support`. `polish` is talent's `editing`, renamed so it cannot be read as video editing. `video` is video's `edit`. `design` is pdf's. `direction` is cut. | talent §2.1, video §14, pdf §19 |
| D12 | `KIND_SKILL`: as talent §3, plus `adapt_creative: 'video'`, `write_search_ads: 'copy'`, `design_cover: 'design'`, `render_pdf: 'design'`. `produce_ad` stays `copy`; `planCut` reads `effectiveT(w, a, 'video')`, and `cut.craft` is `video` evidence, par 80, sd 12, w 1. `visual.overall` is `design` evidence, par 75, sd 10, w 1. `MIN_SEASON_N` gains `video: 4, design: 2`. | talent §3, §5, video §14 |
| D13 | **The CEO is out of the league.** `canLeave` is false for her, her only lever is signing a pick, and `board` evidence is the noisiest of the table. | talent §7.7 |
| D14 | **`primary` = the skill of the first core kind that has one. Never a hat.** Otherwise Zoé, wearing `produce_ad` as a hat, would be judged and fired on `copy`. Hat evidence moves the rating, it never opens a plan. | talent §5.3 (a bug on the lean team) |
| D15 | **A hat costs quality through talent, not a formula.** Skills of a person's core and assist kinds draw at `FOUNDER_MEAN` or `MARKET_MEAN`, every other skill at `OFF_ROLE_MEAN = 0.30`. `talentSpeed` is cut. | org §6, §13 |
| D16 | **Every hire sits the real test.** `Candidate.interview` = `testDeliverable` score. A role with no skill: 50, named candidate first. Added to talent §7.4's table: `video`: `planCut` on the best creative, `scoreCut().craft`; `design`: `pickArt` then `coverAudit` on the best product, `cover` score. `planCut` lands in S6 and `pickArt` in S7, so P3.5 leaves those two at 50 and P6.1, P7.3 fill them. No live product yet: 50. | org §9, talent §7.4 |
| D17 | **A replacement is atomic, in `league_review`:** `runChallenge`, then `openPosition(…, replaces, { noTask: true })`, then `hireAgent`, same tick. `hireAgent` step 5 is the only `completeDeparture` of this path: `requestDeparture` is not called, or the leaver would leave twice and be paid out twice. `agent.notice` is set first, so `completeDeparture` knows reason, author and kind. `reason: 'replacement'` bypasses the money gates. No recruit task. Approval mode stops before `openPosition`, see D48. | org §9, §10, talent §7.4 |
| D18 | Founders other than the CEO can be fired through the challenge. `org` D8 protects them from the cost rules only. | org D8 with talent §0.6 |
| D19 | Promotion to chief is cut. Chiefs come from `reconcileOrg`. Perk: `extraDraw` and `routing: 1`, no `budgetPct`. | talent §6.4 |
| D20 | `Horizon guard` and the channel horizon rule apply only when `openEnded` is false. | talent §7.1 |
| D21 | `buying / market` evidence reads credit-adjusted `roas7`. `buyerScore` and `talentEdge` are not built. | channels §13, talent §9.0 |

### Channels, video, PDF

| # | Decision | Overrides |
|---|---|---|
| D22 | Five channels stay. Retargeting, non-TikTok organic and `channel_cpm_spike` are cut (§6). The silent drift stays: 10 lines, and it is why testing never ends. | channels §4.2, §7.6, §3.7 |
| D23 | Channel unlock reads its own conditions and needs a holder of its role. No stage gate on top. Blocked by the money gates = no channel, cleanly. | channels §7.1 |
| D24 | D4 of channels reads: until the first `requestRole(…, 'channel', …)`, a full run equals a `tiktok_only` run. | channels D4 (a recruit task comes before `open_channel`) |
| D25 | `capableAgents`: a role with `channel` serves only tasks of that channel; no `input.channel` means `tiktok`. | org §6 |
| D26 | `optimize_ads` order: stop-loss (credit-adjusted, never shrunk) → `pruneRead` → fatigue → budget: `planTarget` when a plan line exists, else scale and trim on `shrunkRoas` of credit-adjusted data with `scaleRoas`/`trimRoas` under `growthOn`. | talent §4.5, channels §7.4, scale §4.3 |
| D27 | Video files never enter the world: `CompanySnapshot.videos`, `runs/<id>/video/manifest.json`. `ad_video` is not a `Deliverable.kind`; `/api/deliverables` merges tiles from the manifest. `VideoFile.ratio` has no `16:9`. | ui §7, §6.6, §2.1 |
| D28 | **All fonts are unmodified `.woff`** in `server/assets/fonts/`, Anton 400 and Montserrat 600 and 800 added from `@fontsource`. Caveat is cut. Video registers the WOFF directly. | video §6 |
| D29 | `pdfjs-dist` 6.4.299, pinned, on server (optional) and web. | ui D13 (4.10.38) |
| D30 | `thumbFactor` is not called anywhere: a label until a feed really shows the cover. | pdf §12.4, §19 |
| D31 | `produce_ad` order: `writeAd` with flaws → `planCut` → `scoreCreative`. `bestDraft` wraps the three, so drafts are ranked with their cut. | talent §4.1, video §3.1 |
| D32 | `Product.visual` is computed only when `visualModel === 'on'`. Pdf's `designTalentOverride` becomes `control.designTalent`. | pdf §13.1 |

### Scale, snapshot, process

| # | Decision | Overrides |
|---|---|---|
| D33 | **`tick.ts` gets one explicit phase table** (§2.6). Scale's numbered table and channels' « plain calls » are merged. `DAY_PHASES.length` no longer exists; events keep stream 11. | channels D5, scale §6.1 |
| D34 | `company.org`, `company.league`, `company.channels` are in no snapshot. `company.growth` is, trimmed. Tabs use GET routes. | org §13, talent §9.1, channels §10 |
| D35 | `closedDepts` travels in `scene.closedDepts`: `ui §4.1` reads `company.org`, which D34 removes from the stream. | ui §4.1 |
| D36 | `DEPARTMENTS` grid cells follow ui §2.4: `video (0,-2)`, `crm (2,0)`. | org §13 |
| D37 | Team moves are logged in `org.decisions` only. The digest reads that. `DecisionRecord.kind` loses `hire`, `fire`, gains `channel`. | scale §3, talent §9.0 |
| D38 | `FounderDigest.team` merges into `people`. | scale §3.1, ui §2.3 |
| D39 | Live limits are ui §3.1's. | scale §7 |
| D40 | Under `growthOn` only, or the legacy arm moves: `chainSlots(w) = clamp(writers + 1, 2, 6)` replaces `MAX_AWAITED_PUBLISHES`, `replyCap(w) = max(24, 12 × owners('reply_inbox'))` replaces `i < 24`. Both in P10.1. | org §13, scale §10 |
| D41 | Every calibration, lever test and market proof of the specs moves to S14 under one rule. No spec runs its own. | all |
| D42 | Absent scenario fields mean the old behaviour (§2.8). `defaultScenario` fills the V1 values, from P2.1 on. Tests pass `LEGACY`. | all |
| D43 | `golden` is re-recorded by P8.1 (guide text), by P10.2 (rivals replace the permanent clone penalty), and by P14.1 if the winner changes `balance.ts` (B, C and E move `CONVERSION.base`, which the legacy run reads). Each time with the old and new hash in `docs/BALANCE.md`. Any other mismatch is a bug. | org test 5 |
| D44 | Video renders: `auto` in the API server, `off` in CLI and bench. | video §9 |
| D45 | `HeadRow.pay30d` is computed from `payOf`: the ledger has one `salary` line a day, no per-agent ref. | ui §2.3 |
| D46 | `PersonChip.contract`: hired under 7 days ago `trial`, open plan `probation`, `notice` set `notice`, else `active`. `ChronicleKind` has `layoff`, no `resign`: nobody resigns. | ui §2.1, talent §9.0 |

### Added by the critique

| # | Decision | Overrides |
|---|---|---|
| D47 | **A stub answers like today, it never throws on a path a default run reaches.** P2.1 flips `defaultScenario`, so every smoke run from S2 on goes through the pillars. `talentMode` `'off'`, `effectiveT` and `craftFor` `undefined`, `routeBonus` 0, `openChannels` `['tiktok']`, `multiChannel` false, `creditOf` 1, `planTarget` null, `growthOn` false, `logDecision` returns its record unsaved, `renderAdCut` `{ frames: [] }`. A flag stays dormant until the package that reads it lands. | §2.7 |
| D48 | **A ritual never waits for the founder.** `runImmediate` reads `fail`, `output` and `summary` and drops `awaitFounder`: the task would close as done with nothing waiting, and approving it would close the season twice. A ritual that needs his yes creates a normal task of its kind, `reviewer: null`, `workLeft: 0`, `input` carrying what was decided, and the handler branches on that input. `ctx.ritual` also returns quietly when `HANDLERS[kind]` is missing, for the days between P10.1 and P11.1. | talent §7.6 |
| D49 | **Refusals reach pillars through `Pillar.refused`.** `honourRefusal` is private to `company.ts`, which no pillar touches after S2. `approve(id, false)` calls the hook after it, synchronously, no draw. | org §9, talent §7.6, channels §7.1, scale §6.2 |
| D50 | **A fourth compaction trap: `Campaign.seq`.** `runAds` keys each campaign's stream on its array index (`d.focus(key, index)`) and compaction removes campaigns, so every later campaign would draw another market. `compactWorld` stamps `seq ??= index` on all rows before removing any, `createCampaign` sets `seq = company.archive.campaigns + campaigns.length` once `archive` exists, `runAds` reads `camp.seq ?? index`. Absent on an uncompacted run, so golden does not move. `runSales` keys on `products.indexOf`, safe: products stay as stubs. | scale §7.2 |
| D51 | **`/runs/<id>/` refuses every file holding truth.** Today's guard is `/^world\.json/i`, which serves `world.prev.json`, `checkpoints/*.json.gz` (whole worlds) and `archive/*.ndjson` (customers with their archetype). New guard: `/^(world[^/]*\.json\|checkpoints\/\|archive\/)/i`. | scale §2.4, §7.2, A21 |
| D52 | `videos` goes through `extra`, which nothing trims: up to 240 masters, about 150 KB on a 456 KB base. Live stream: only creatives kept by `LIVE_LIMITS`, 30 at most. `GET /api/state` and `GET /api/videos` keep all of it. | video §9, ui §3.1 |
| D53 | Names are unique across agents and alumni, not rejected candidates, who go back in the pool. Each position burned 3 names, so 60 names plus the 31 legacy ones ran out after about 30 positions, inside a 365-day run with 14-day seasons. Pool empty: `pickName` adds an initial (`Léa B.`), it never loops. | org I9, §9, talent §7.5 |
| D54 | `company.growth` exists in every version 2 world. `growthOn` alone gates decisions, `weekRollup` writes in both arms: scale A1 to A3 read `growth.weeks` of the control. | §2.8 |
| D55 | `hireAgent`, `requestDeparture`, `completeDeparture` and `layoffsEvening` return promises and are awaited. They write brain notes, and a note landing behind the next `brain.search` would make a reload differ from a straight run. | org §9, §10 |
| D56 | The `Company` constructor's « agents learn the kinds added since » loop runs for `team: 'legacy31'` only. In a lean world it gives back kinds `reconcileOrg` removed and reorders `taskKinds` at each reload. Lean worlds run `reconcileOrg` in the org `mount` instead. | org §7, §11 |
| D57 | `PLAN_KINDS` stays today's exact list: P0.1 adds the 13 new kinds to its exclusion. `heuristicMission` and `normalizeItem` read it, so missions would route differently from P0.1 on. A package opens a kind when it needs to. | org §11 |
| D58 | Proof data lives in the world. `recordEvidence` takes the raw `x` and sums it in `league.parStats`: `EvidenceEvent` stores `s` only, and support replies flood its 300-row ring, so S14 had nothing to set pars from. `talentTruth.swaps` keeps talent at each swap with the family mean, which M4 and M5 cannot rebuild afterwards. | talent §5.2, §10 |
| D59 | The public label of `meta` is `Facebook & Instagram`, the founder's word. The id stays `meta`. | channels §2.1 |
| D60 | `VIDEO_FORCE_LEVEL=no_voice\|no_pages\|storyboard_only` in `detectCaps`. Emptying `FFMPEG_PATH` and `PATH` still finds `ffmpeg-static`, third in the search order, so A19 could never reach `storyboard_only`. | video §7 |
| D61 | A6 time limit 240 s, not 150 s: §4 budgets 30 s per 60 days, which is 183 s for 365 days at best. Nothing depends on it, the away pace is one tick per 138 s. `p95 day ≤ 800 ms` stays. | scale §7.1 |
| D62 | A10 is judged on 180 days. On 60 days only five founders are in the league, and by the evidence table a weak `longform` founder crosses the plan gate around D28 at best: a replacement by D60 on the median seed is a coin flip, not a defect. | §5 |

## 2. Shared contract

P0.1 pastes this. Nobody else writes `shared/types.ts` or `server/src/contracts.ts`, except a package that a stage gate proves needs a field: it adds it, optional, and says so in its report.

### 2.1 In-place edits of `shared/types.ts`

First lines of the file:

```ts
import type { ChannelId, AdAccountId } from './channels.js';
export type { ChannelId, AdAccountId };
```

Then these exact replacements (each left text exists today, `check.mjs` asserts it):

| Replace | With |
|---|---|
| `\| 'support' \| 'analyse' \| 'finance' \| 'rh' \| 'partenariats';` | `\| 'support' \| 'analyse' \| 'finance' \| 'rh' \| 'partenariats' \| 'video' \| 'crm';` |
| `\| 'web.page' \| 'team.delegate' \| 'team.review';` | `\| 'web.page' \| 'team.delegate' \| 'team.review' \| 'ads.channels' \| 'ads.report';` |
| `\| 'performance_review'; // RH: weekly agent reviews` | `\| 'performance_review'  // RH: weekly agent reviews ⏎ \| 'headcount_review' \| 'recruit' \| 'league_review' ⏎ \| 'open_channel' \| 'adapt_creative' \| 'write_search_ads' \| 'reconcile_channels' \| 'allocate_channels' ⏎ \| 'write_lead_magnet' \| 'write_email_sequence' \| 'send_broadcast' \| 'design_bump' \| 'portfolio_review';` |
| `export type AdFormat = 'faceless_voiceover' \| 'text_slideshow' \| 'ugc_avatar' \| 'carousel';` | `export type AdFormat = 'faceless_voiceover' \| 'text_slideshow' \| 'ugc_avatar' \| 'carousel' \| 'static_image' \| 'search_text';` |
| `\| 'tool_subscription' \| 'compute' \| 'creator_payout' \| 'scam_loss' \| 'discount';` | `\| 'tool_subscription' \| 'compute' \| 'creator_payout' \| 'scam_loss' \| 'discount' \| 'salary' \| 'recruiting';` |
| `\| 'walk' \| 'coffee' \| 'meeting' \| 'founder' \| 'chat';` | `\| 'walk' \| 'coffee' \| 'meeting' \| 'founder' \| 'chat' \| 'org';` |
| `\| 'platform_outage' \| 'seasonal_boost' \| 'goal_reached' \| 'bankrupt';` | `\| 'platform_outage' \| 'seasonal_boost' \| 'goal_reached' \| 'bankrupt' \| 'channel_opened' \| 'channel_account_banned';` |
| `kind: 'pdf' \| 'cover' \| 'sales_page' \| 'ad_storyboard' \| 'ad_preview' \| 'report' \| 'research' \| 'note';` | `kind: 'pdf' \| 'cover' \| 'sales_page' \| 'ad_storyboard' \| 'ad_preview' \| 'report' \| 'research' \| 'note' \| 'page_preview' \| 'lead_magnet' \| 'email_sequence';` |
| `source: 'ads' \| 'organic' \| 'creator' \| 'upsell';` | `source: 'ads' \| 'organic' \| 'creator' \| 'upsell' \| 'email' \| 'bump';` |
| `channel: 'email' \| 'commentaire_tiktok' \| 'avis' \| 'dm';` | `channel: 'email' \| 'commentaire_tiktok' \| 'commentaire_pub' \| 'avis' \| 'dm';` |
| `kind: 'ads' \| 'advances' \| 'launches' \| 'product'; //` | `kind: 'ads' \| 'advances' \| 'launches' \| 'product' \| 'hiring' \| 'firing' \| 'pin' \| 'emails'; //` |
| `dimension: 'hook_style' \| 'ad_format' \| 'price' \| 'sales_hype' \| 'support_tone' \| 'niche';` | `dimension: 'hook_style' \| 'ad_format' \| 'price' \| 'sales_hype' \| 'support_tone' \| 'niche' \| 'agent_duel';` |
| `type: 'timeline' \| 'bar_chart' \| 'checklist_card' \| 'quote' \| 'steps_diagram' \| 'icon_grid' \| 'do_dont' \| 'grid';` | `type: 'timeline' \| 'bar_chart' \| 'checklist_card' \| 'quote' \| 'steps_diagram' \| 'icon_grid' \| 'do_dont' \| 'grid' \| 'cycle' \| 'plan_path' \| 'decision_tree' \| 'before_after' \| 'matrix' \| 'gauge' \| 'step_path';` |
| `files: { pdf: string \| null; cover: string \| null; salesPage: string \| null }; // run-relative paths` | `files: { pdf: string \| null; cover: string \| null; salesPage: string \| null; previews?: string[] }; // run-relative paths` |
| `  version: 1; ⏎ runId: string;` | `  version: 1 \| 2; ⏎ runId: string;` |
| `    adAccount: MarketState['adAccount']; ⏎ customersCount: number;` | `    adAccount: MarketState['adAccount']; ⏎ customersCount: number; ⏎ channelAccounts?: Partial<Record<AdAccountId, ChannelAccountState>>; ⏎ audience?: AudienceView;` |
| `  godMode?: { ⏎ niches: Pick<NicheTruth, 'id' \| 'name' \| 'demand' \| 'wtp' \| 'competition' \| 'tiktokAffinity' \| 'hookAffinity'>[];` | `  godMode?: { ⏎ talent?: Record<AgentId, TalentTruthView>; ⏎ niches: Pick<NicheTruth, 'id' \| 'name' \| 'demand' \| 'wtp' \| 'competition' \| 'tiktokAffinity' \| 'hookAffinity' \| 'channels'>[];` |
| `  \| { type: 'tick'; day: number;` | `  \| { type: 'video'; creativeId: string; video: CreativeVideo } ⏎ \| { type: 'tick'; day: number;` |

### 2.2 Additions to `shared/types.ts`

Interfaces below extend the existing ones of the same name. Paste each member into its interface; they compile as written through declaration merging, so nothing is lost if one stays apart.

```ts
// ═════════ Scenario ═════════
export type TalentMode = 'off' | 'flat' | 'league';
export type ChannelControl = 'none' | 'tiktok_only' | 'average_roas' | 'last_click';
export interface OrgConfig {
  team: 'lean' | 'legacy31';
  autoHire: boolean;           // false: the team stays as it is (paired control)
  payroll: boolean;            // false: agents are free (control, old tests)
}
/** Benchmark arms. Never accepted by POST /api/scenario, never offered in the UI. */
export interface ScenarioControls {
  noLearning?: boolean;        // chooseArm picks at random; addRule, replaceRuleEverywhere, syncDirective do nothing
  designTalent?: number;       // forces design talent, 0..1
  videoSkill?: number;         // forces the editor's skill, 0..1
  videoTempo?: VideoTempo;     // forces the tempo, no bandit
  talentOverride?: { skills: Skill[]; value: number }; // lever test: every agent's t on these skills
}
export interface ScenarioConfig {
  org?: OrgConfig;             // absent = LEGACY_ORG (older saves); defaultScenario fills LEAN_ORG
  talent?: TalentMode;         // absent = 'off'; defaultScenario fills 'league'
  channelControl?: ChannelControl; // absent = 'tiktok_only'; defaultScenario fills 'none'
  videoModel?: 'on' | 'off';   // absent = 'off'; defaultScenario fills 'on'
  visualModel?: 'on' | 'off';  // absent = 'off'; defaultScenario fills 'on'
  scaling?: boolean;           // absent = false; defaultScenario fills true. Gates company decisions only
  openEnded?: boolean;         // no end: horizonDays only frames the goal. newRun() passes true
  control?: ScenarioControls;
}

// ═════════ Organisation ═════════
export type RoleId =
  | 'ceo' | 'chief_of_staff'
  | 'research_lead' | 'competitor_analyst' | 'voc_analyst'
  | 'editor_in_chief' | 'ghostwriter' | 'humanizer' | 'fact_checker'
  | 'art_director' | 'cover_designer' | 'layout_designer'
  | 'video_editor' | 'motion_designer'
  | 'growth_lead' | 'hook_writer' | 'media_buyer_tiktok' | 'media_buyer_meta' | 'media_buyer_google' | 'media_buyer_pinterest'
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

export interface DeptDef { deskHigh?: number }  // highest desk index + 1 ever used, never goes down

export interface AgentDef {
  roleId: RoleId;
  gender: 'f' | 'm';
  founder: boolean;
}
export interface AgentState {
  hatKinds: TaskKind[];        // kinds worn outside the role, at ORG.hatSpeed
  hatDepts: DeptId[];          // departments of those kinds (lesson routing, chat facts)
  hiredDay: number;            // 0 = founding team
  rampUntilDay: number;        // last day at ORG.rampSpeed
  notice: { day: number; reason: string; by: AgentId; kind: Alumnus['kind'] } | null; // decided, waits for the replacement
  desk?: number;               // stable desk index inside the department, 0 = chief
}

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
  interview: number;           // 0..100: score of the real test. 50 for a role without a skill
  deliverable: string | null;  // what the test produced, French, short
  lineage: AgentId | null;     // « élève de Sarah »
}
export type PositionReason = 'bottleneck' | 'channel' | 'replacement' | 'founder';
export interface Position {
  id: string;                  // `pos_<n>`, n = index in org.positions + 1
  roleId: RoleId;
  reason: PositionReason;
  detail: string;              // French, read in the feed
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
  text: string;                // French, shown in the feed and the Effectif tab
  numbers: Record<string, number>; // what the decision read: margin, payroll, cash, relief, ownerUtil...
}
export interface Alumnus {
  id: AgentId; name: string; gender: 'f' | 'm'; roleId: RoleId; dept: DeptId; founder: boolean;
  hiredDay: number; leftDay: number; reason: string; level: number;
  kind: 'fired' | 'layoff' | 'founder_order';
  replacedBy: AgentId | null;
  perf: AgentState['perf']; avatar: AvatarSpec;
}
export interface OrgState {
  offices: Record<Office, AgentId>;        // resolved by reconcileOrg, always a living agent
  deptHost: Partial<Record<DeptId, DeptId>>; // closed department -> open department carrying its kinds
  closedDepts: DeptDef[];                  // catalog minus open: drawn as vacant plots
  load: KindLoadDay[];                     // last 14 days, the open day last
  pressure: RolePressure[];
  positions: Position[];
  decisions: OrgDecision[];                // last 200
  alumni: Alumnus[];
  lastHireDay: number; lastLayoffDay: number; lossDays: number;
  stats: { hires: number; departures: number; layoffs: number; lastResortHats: number; violations: number };
}

// ═════════ Talent. Truth sits next to `market`, never under `company` ═════════
export type Skill = 'copy' | 'video' | 'longform' | 'polish' | 'page' | 'design' | 'buying' | 'research' | 'support';

export interface AgentTruth {
  agentId: AgentId;
  talent: Partial<Record<Skill, number>>;   // current true talent, 0..1
  start: Partial<Record<Skill, number>>;    // at hire, for the proof
  ceiling: Partial<Record<Skill, number>>;  // what practice alone can reach
  practicedLevel: number;                   // last AgentState.level turned into practice
  lineage: AgentId | null;                  // clone of whom
}
export interface TalentTruth {
  agents: Record<AgentId, AgentTruth>;      // leavers stay: the proof reads them
  samples: { day: number; meanLeague: number; workWeighted: number }[]; // one per evening, proof only
  swaps: { day: number; skill: Skill; replaced: AgentId; hired: AgentId; tReplaced: number; tHired: number; familyMean: number }[]; // D58, proof only
}
export interface WorldState { talentTruth?: TalentTruth }

export interface SkillRating {
  skill: Skill;
  rating: number;              // Elo-like, par = 1500
  rd: number;                  // uncertainty, 200 → 70
  n: number;                   // evidence events, all time
  seasonN: number;             // this season (weighted sum)
  metric: number | null;       // the role's readable number: mean QA score, reply score…
  history: { day: number; rating: number }[]; // one point per week plus the hire, max 40
}
export type LeagueStatus = 'active' | 'probation' | 'gone';
/** One per agent who ever held a skill, leavers included. Observed numbers only. */
export interface LeagueEntry {
  agentId: AgentId; name: string; role: string; avatar: AvatarSpec;
  hiredDay: number; leftDay: number | null; status: LeagueStatus;
  ratings: Partial<Record<Skill, SkillRating>>;
  primary: Skill | null;       // first core kind with a skill. Never a hat
  lineage: AgentId | null;
  trophies: { season: number; title: string }[];
  leftBecause: string | null;  // French, with numbers
}
export interface ProbationPlan {
  agentId: AgentId; skill: Skill; openedSeason: number; deadlineDay: number;
  metricLabel: string; baseline: number; target: number; coachId: AgentId | null;
  text: string;                // French, read out by the HR office
  outcome: 'open' | 'met' | 'failed' | 'kept_no_better';
}
export interface Duel {
  id: string; season: number; skill: 'copy'; kind: 'formal' | 'natural';
  agents: [AgentId, AgentId];
  productId: string; campaignId: string; creativeIds: string[];
  taskIds: string[]; experimentId: string | null;
  status: 'ordered' | 'running' | 'settled' | 'cancelled';
  startDay: number; endDay: number | null;
  result: { ctr: [number, number]; n: [number, number]; z: number; s: number; delta: number } | null;
}
export interface ChallengeEntry {
  id: AgentId; name: string; isIncumbent: boolean; lineage: AgentId | null;
  score: number; deliverable: string; // what they produced, French, short
}
export interface HireReport {
  day: number; incumbent: AgentId; skill: Skill; hired: AgentId | null; // null: incumbent kept
  candidates: ChallengeEntry[]; reason: string;
}
export interface SeasonRow { agentId: AgentId; name: string; rating: number; delta: number; metric: number | null; n: number; status: LeagueStatus }
export interface SeasonReport {
  season: number; fromDay: number; toDay: number;
  tables: Partial<Record<Skill, SeasonRow[]>>;
  employee: { agentId: AgentId; name: string; skill: Skill; perk: string } | null;
  probations: string[]; dismissals: string[]; hires: string[]; notes: string[];
  disruptedDays: number;       // outage or ad ban: over 3, no dismissal this season
}
export type EvidenceSource = 'qa' | 'rejected' | 'duel' | 'natural' | 'market' | 'reply' | 'chargeback' | 'focus' | 'pick' | 'cut' | 'visual';
export interface EvidenceEvent { day: number; agentId: AgentId; skill: Skill; source: EvidenceSource; s: number; w: number; label: string }
export interface Perk { agentId: AgentId; season: number }     // next season: one more draft, routing +1
export interface LeagueState {
  season: number; seasonStartDay: number; closedSeasons: number; // idempotence, like lastRetroDay
  lastEvidenceDay: number;
  entries: Record<AgentId, LeagueEntry>;
  plans: ProbationPlan[];
  duels: Duel[];               // natural ones capped at 200
  hires: HireReport[];
  seasons: SeasonReport[];
  perks: Perk[];
  events: EvidenceEvent[];     // ring buffer, 300
  parStats: Record<string, { n: number; sum: number; sq: number }>; // `${skill}:${source}`, raw x, all time (D58)
}

// ═════════ Channels (ChannelId, AdAccountId come from shared/channels.ts) ═════════
export type AdRatio = '9:16' | '4:5' | '1:1' | '2:3' | 'text';
export interface ChannelReview { status: 'pending' | 'approved' | 'rejected'; reason: string | null; day: number | null; rule?: string }

export interface AdCreative {
  ratio?: AdRatio;             // absent = '9:16'
  masterId?: string | null;    // the creative this one is a cut of: same script, another ratio. Fatigue is shared by the family
  channelReviews?: Partial<Record<ChannelId, ChannelReview>>; // every channel but TikTok
  search?: { headlines: string[]; descriptions: string[]; keywords: string[] }; // format 'search_text' only
  duelId?: string;
  cut?: VideoCut | null;       // absent on old saves: the old formulas apply
}
export interface Campaign {
  channel?: ChannelId;         // absent = 'tiktok'
  learning?: { events: number; exitedDay: number | null }; // channels with a learning phase
  test?: boolean;              // paid by the test envelope, left alone by the allocator until its verdict
  seq?: number;                // D50: stable stream key, survives compaction. Absent = array index
}
export interface CampaignInputShape { channel?: ChannelId; test?: boolean }
export interface DailyAdStats {
  channel?: ChannelId;
  claimedPurchases?: number;   // what the platform's dashboard says it sold; absent = same as purchases
  claimedRevenue?: number;
  tail?: true;                 // free clicks of a paid pin: no spend that day
}
export interface Order { channel?: ChannelId }                  // last click, observable
export interface ChannelDayKpi {
  spend: number;               // Σ ledger ad_spend of the channel's campaigns; Σ over channels = DailyKpi.adSpend to the cent
  impressions: number; clicks: number; landingViews: number;
  shopSales: number; shopRevenue: number;
  claimedSales: number; claimedRevenue: number;
  reconciledRevenue: number;   // Σ over channels = Σ shopRevenue
  roas: number;                // reconciledRevenue / spend
}
export interface DailyKpi { channels?: Partial<Record<ChannelId, ChannelDayKpi>> } // only on a day with rows on 2 channels or more

/** Hidden market truth for one (niche, channel). Never in a snapshot, except god mode. */
export interface ChannelCell {
  fit: number;                 // 0..1 audience fit, role of tiktokAffinity
  cpmMult: number;             // × n.cpmBase
  intent: number;              // CVR multiplier of a landing view
  poolShare: number;           // this channel's daily buyer pool / the niche's pool
  searchClicksPerDemand?: number; // google: full-coverage clicks a day at demand 1
  cpcBase?: number;            // google
}
export interface NicheTruth {
  channels?: Partial<Record<Exclude<ChannelId, 'tiktok'>, ChannelCell>>; // TikTok keeps tiktokAffinity and cpmBase
  videoTempo?: VideoTempo;     // hidden, learnable
}
export interface ChannelAccountState { strikes: number; banned: boolean; bannedUntilDay: number; openDay: number | null } // null = never requested
export interface ChannelMarketState {
  accounts: Record<'meta' | 'google' | 'pinterest', ChannelAccountState>; // market.adAccount stays TikTok's
  impressions: Partial<Record<Exclude<ChannelId, 'tiktok'>, Record<string, number>>>; // by creative family; TikTok keeps creativeImpressions
  warm: Record<string, number>; // nicheId → stock of paid exposures
}
export interface MarketState {
  channels?: ChannelMarketState;
  audience?: AudienceState;
  rivals?: Rival[];
}
export type ChannelLineStatus = 'untested' | 'testing' | 'proven' | 'killed' | 'blocked';
export interface ChannelNicheState {
  channel: ChannelId; nicheId: string; status: ChannelLineStatus; since: number;
  spend: number; revenue: number; // reconciled, since `since`
  reason: string | null;       // French, why killed or blocked
  retestDay: number | null;
}
export interface ChannelPlanLine {
  channel: ChannelId; productId: string; campaignIds: string[];
  budget: number; target: number;
  average: number | null; marginal: number | null; elasticity: number | null; days: number;
  note: string;                // French, read in the feed and the UI
}
export interface ChannelPlan {
  day: number; envelope: number; testEnvelope: number;
  lambda: number | null;       // the marginal ROAS every optimised line is brought to
  unspent: number;             // envelope nobody earned
  lines: ChannelPlanLine[];
}
export interface AttributionRow {
  channel: ChannelId; spend: number; shopRevenue: number; claimedRevenue: number; reconciledRevenue: number;
  credit: number; inflation: number; // reconciled / shop, claimed / shop
}
export interface AttributionReport {
  day: number; fromDay: number; toDay: number; by: AgentId;
  rows: AttributionRow[];
  niches: Record<string, Partial<Record<ChannelId, number>>>; // credit per (niche, channel) where the sample is enough
}
export interface ChannelBook {
  open: ChannelId[];           // ['tiktok'] at the start, in opening order
  requested: Partial<Record<ChannelId, number>>; // day of the request
  lines: ChannelNicheState[];
  plan: ChannelPlan | null;
  attribution: AttributionReport | null;
}
export interface TrendSignal { bestChannelBuzz?: number }       // best noisy audience over open channels, once 2 are open
export interface FounderHold {
  channel?: ChannelId | null;  // « coupe Meta »
  agentId?: AgentId;           // kind 'pin'
}

// ═════════ Video ═════════
export type VideoTempo = 'calm' | 'standard' | 'fast';
export type BeatKind =
  | 'title_card' | 'hook' | 'pain_bubble' | 'page_proof' | 'fact_card'
  | 'bonus_stack' | 'narrator' | 'slide' | 'end_card';
export interface VideoBeat {
  kind: BeatKind;
  scene: number;               // index in AdCreative.scenes
  spoken: string;              // '' on a slide. Always a cut of scenes[scene].voiceover, never new words
  screen: string;              // text this beat owns on screen
  estSec: number;              // speech model + gap, or reading time on a slide
  shots: number;               // camera cuts inside this beat, 1 at least
  proof?: { chapter: number; needle: string } | null; // chapter index, and a sentence that exists in that chapter
  items?: string[];            // pain_bubble: extra real VoC phrases
}
export interface CutMetrics {
  estSec: number; hookWordSec: number; productSec: number | null; avgShotSec: number;
  kinds: number; captionWords: number; endHoldSec: number;
}
export interface VideoCut {
  v: 1; tempo: VideoTempo; beats: VideoBeat[]; metrics: CutMetrics; sfx: boolean;
  craft: number;               // 0..100, display only: scoreCreative recomputes pace and look from metrics
}
export interface VideoFile { ratio: Exclude<AdRatio, 'text'>; path: string; durationSec: number; bytes: number }
export type VideoStatus = 'queued' | 'rendering' | 'ready' | 'failed' | 'evicted' | 'unavailable';
export interface QaSummary { ok: boolean; failed: string[]; lufs: number | null; cuts: number; avgShotSec: number; mb: number }
export interface CreativeVideo {
  status: VideoStatus;
  reason?: string | null;      // French, for the founder
  videos: VideoFile[];
  poster: string | null;
  captions: string | null;     // WebVTT
  cards: string[];             // carousel and static_image PNGs
  voice: string | null;        // voice id, null = captions and music only
  qa: QaSummary | null;
}
export type VideoLevel = 'full' | 'no_voice' | 'no_pages' | 'storyboard_only';
export interface VideoIndex { level: VideoLevel; reason: string | null; items: Record<string, CreativeVideo> }

// ═════════ PDF ═════════
export type TypeVoice = 'conte' | 'dossier' | 'atelier' | 'signal';
export interface InkSet { paper: string; ink: string; a: string; b: string; c: string }
export interface DesignSpec {
  voice?: TypeVoice;
  inks?: InkSet;
  artSeed?: number;            // the art candidate kept by the designer; absent = design.seed
}
export interface VisualSpec {
  cycle?: { nodes: string[]; breakAt: number; center: string };
  plan?: { days: number; unit: string; tracks: { from: number; to: number; label: string }[] };
  tree?: { question: string; cases: { when: string; then: string }[] };
  pairs?: { before: string; after: string }[];
  matrix?: { heads: [string, string, string, string]; cells: [string[], string[], string[], string[]] };
  gauge?: { rows: string[]; low: string; high: string };
  path?: { stations: { label: string; when: string | null; duration: string | null }[] };
}
export interface ChapterContent {
  figure?: VisualSpec | null;  // a second visual: `visual` stays the chapter's tool (often a sheet)
  margin?: { note: string | null; quote: string | null };
}
export interface DesignEffort { covers: number; layouts: number; taste: number; finish: 0 | 1 | 2 }
export interface VisualReport {
  version: 1;
  cover: number; interior: number; overall: number; // 0..100; overall = 0.55 cover + 0.45 interior
  effort: DesignEffort;
  explored: number;            // real count of candidates
  issues: string[];            // French, actionable
}
export interface Product {
  visual?: VisualReport | null;
  kind?: 'guide' | 'kit';      // absent = 'guide'
  bumpProductId?: string | null;
  leadMagnet?: { title: string; file: string; day: number } | null;
  versionDay?: number;         // compaction: replaces versionSince on tasks
  feedback?: { day: number; text: string; quality: boolean }[]; // cap 30
  hooks?: { hook: string; hookStyle: HookStyle }[];             // cap 60
  campaignCount?: number;
}
export interface ProductStats { ratingSum?: number; ratingCount?: number } // exact rating after reviews are capped

// ═════════ Scale ═════════
export type StageId = 'survie' | 'adequation' | 'acceleration' | 'portefeuille';
export interface DecisionRecord {
  id: string; day: number;
  kind: 'stage' | 'budget' | 'launch' | 'double_down' | 'rework' | 'harvest' | 'kill' | 'reopen' | 'list' | 'channel' | 'incident';
  who: AgentId | 'system';
  text: string;                // French
  why: string;                 // French, with the numbers behind it
  productId?: string;
  impactEur?: number;          // money it moved or lost, when known
}
export interface WeekRollup {
  week: number; fromDay: number; toDay: number;
  revenue: number; refunds: number; adSpend: number; fees: number; creators: number; payroll: number; other: number; profit: number; cashEnd: number;
  sales: number; bySource: Partial<Record<Order['source'], { n: number; revenue: number }>>;
  roas: number | null; ctr: number | null;
  mains: number; niches: number; listSize: number; ltvFactor: number; stage: StageId; agents: number; tasksDone: number;
}
export interface FounderDigest {
  fromDay: number; toDay: number;
  headline: string;            // French, states a loss as a loss
  money: { revenue: number; refunds: number; adSpend: number; costs: number; profit: number; cashStart: number; cashEnd: number; previousProfit: number | null };
  stage: { from: StageId; to: StageId; changes: { day: number; to: StageId }[] };
  products: { launched: string[]; stopped: { title: string; why: string }[]; reworked: string[]; best: { title: string; profit: number } | null; worst: { title: string; profit: number } | null };
  audience: { size: number; added: number; unsubscribed: number; revenue: number };
  people: { hired: string[]; left: string[]; headFrom: number; headTo: number };
  channels: { opened: string[]; closed: string[]; best: { id: string; name: string; reconciledRoas: number } | null };
  highlights: ChronicleEntry[]; // at most 12
  decisions: DecisionRecord[]; // top 12 by |impactEur|, then newest
  mistakes: string[];          // money lost on tests without a keeper, chargebacks, idle cash, stop-losses that fired late
  incidents: string[];         // outages, skipped ticks, crash recoveries, machine off
  waiting: string[];           // what needs the founder, approval tasks first
  next: string[];              // this week's allocation and open bets
}
export interface StagePolicy {
  maxMains: number;
  paidTestEur: number;         // paid euros a main gets before it can be judged
  testDailyEur: number;        // daily budget of a paid test (replaces the 40 € clamp of launchBudget)
  creativesPerCampaign: number;
  split: { scale: number; test: number; reserve: number }; // share of weekly profit, sums to 1
  reserveDays: number;
  bumpMinSales: number | null;
  magnetMinSales: number | null;
}
export interface GateCheck { label: string; value: number; target: number; ok: boolean }
export interface GateProgress { next: StageId | null; checks: GateCheck[]; weeksHeld: number; weeksNeeded: number }
export interface Allocation {
  week: number; day: number;
  profit7: number; profit28: number; spend7: number; roas14: number | null; net: number; ltv: number;
  beRoas: number; scaleRoas: number; trimRoas: number;
  reserve: number; free: number; leak: boolean;
  adTarget: number;            // €/day, soft target under the CFO cap
  testWeek: number;            // € of paid tests for new lines this week
  note: string;                // French
}
export type PortfolioVerdict = 'test' | 'double_down' | 'keep' | 'rework' | 'harvest' | 'kill';
export interface PortfolioLine {
  productId: string; nicheId: string; title: string;
  verdict: PortfolioVerdict; reason: string; // French, with numbers
  contribution28: number; roas14: number | null; paidTested: number; share: number;
}
export interface PortfolioReview { day: number; week: number; lines: PortfolioLine[]; slots: { used: number; max: number }; notes: string[] }
export type NicheCloseReason = 'no_test' | 'quality' | 'market' | 'redteam';
export interface NicheRecord {
  nicheId: string; attempts: number; paidEur: number; strikes: number;
  lastEndDay: number | null; lastReason: NicheCloseReason | null; reopenDay: number | null;
  bestRoas14: number | null; bestPrice: number | null;
}
export interface GrowthState {
  stage: StageId; stageSinceDay: number; gateWeeks: number; floorWeeks: number; gate: GateProgress | null;
  allocation: Allocation | null;
  portfolio: PortfolioReview | null;
  niches: Record<string, NicheRecord>;
  weeks: WeekRollup[];
  decisions: DecisionRecord[]; // last 500
  ltvFactor: number;
  founder: { lastSeenDay: number; lastSeenAt: string | null };
}
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
  welcome: Record<string, number[]>; // nicheId → leads by day of the sequence, index 0..10
  sequences: EmailSequence[];
  queue: Broadcast[]; sent: Broadcast[]; // sent: last 120
  totals: { leads: number; buyers: number; unsubscribed: number; delivered: number; opens: number; clicks: number; sales: number; revenue: number };
}
export interface AudienceView {
  size: number; leads: number; buyers: number; byNiche: { nicheId: string; size: number; openRate: number | null }[];
  unsubscribed: number; dailyCost: number; recent: Omit<Broadcast, 'body'>[]; sequences: { nicheId: string; productId: string; status: string }[];
}
export interface Rival { id: string; nicheId: string; day: number; pressure: number; price: number }
export interface ArchiveCounters { throughDay: number; tasks: number; missions: number; orders: number; customers: number; ledger: number; creatives: number; campaigns: number; deliverables: number }
export interface TaskTotals { days: DayTaskCounts[]; depts: Partial<Record<DeptId, { done: number; delaySum: number }>> }

export interface CompanyState {
  org?: OrgState;
  league?: LeagueState;
  channels?: ChannelBook;
  growth?: GrowthState;
  lastDone?: Record<string, number>; // `${kind}:${productId}` → day: compaction keeps lastScan, lastScout, lastPage
  taskTotals?: TaskTotals;
  archive?: ArchiveCounters;
  cashOnlyCreators?: string[];
}
export interface SessionInfo {
  pace?: 'live' | 'away';
  watchers?: number;
  backoffMs?: number | null;   // set while the loop waits after incidents
}

// ═════════ What the interface reads ═════════
export interface PersonCard { id: AgentId; name: string; role: string; dept: DeptId; avatar: AvatarSpec }
export type ChronicleKind =
  | 'hire' | 'fire' | 'layoff' | 'promote' | 'probation'
  | 'duel_open' | 'duel_end' | 'season_end'
  | 'channel_open' | 'channel_close'
  | 'dept_open' | 'dept_close'
  | 'stage_up' | 'stage_down'
  | 'req_open' | 'req_filled';
export interface ChronicleEntry {
  key: string;                 // stable: 'org:<decision id>', 'duel:<id>:end', 'season:<n>', 'stage:<day>'…
  day: number;
  kind: ChronicleKind;
  text: string;                // French, one line
  why?: string;                // French, with the numbers
  agentId?: AgentId | null;
  otherId?: AgentId | null;    // duel opponent
  person?: PersonCard;         // who left, or who arrived
  dept?: DeptId | null;
  channel?: string | null;
  numbers?: Record<string, number>;
}
export interface PersonChip {
  rating: number;              // observed, par 1500. Agents outside the league have no entry
  rank: number; of: number;    // inside the skill family
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
export type ChannelState = 'closed' | 'verifying' | 'open' | 'banned';
export interface ChannelChip { id: ChannelId; name: string; glyph: string; color: string; state: ChannelState; share: number }
export interface StageView {
  level: number; total: 4; id: StageId; name: string; sinceDay: number; headcount: number;
  gate: GateProgress | null;
}
/** What the pixel world stages. Everything in it is already public. About 20 KB at 60 agents. */
export interface SceneView {
  people: Record<AgentId, PersonChip>;
  board: BoardRow[];           // top 5 across skills, for the plaza board
  podium: PodiumView | null;
  duels: DuelChip[];           // open, at most 6
  recent: ChronicleEntry[];    // last 24
  channels: ChannelChip[];     // verifying, open, banned; never closed
  stage: StageView;
  team: { headcount: number; payroll30d: number; revenuePerHead30d: number };
  openSeats: Partial<Record<DeptId, number>>;
  closedDepts: DeptDef[];      // vacant plots: company.org never reaches the stream
  names: Record<AgentId, string>; // people who left, at most 200, so old tasks print a name
}
export interface TalentTruthView { truth: number; note: string }

export interface HeadRow {
  agentId: AgentId; name: string; role: string; avatar: AvatarSpec; isChief: boolean; tier: ModelTier;
  contract: PersonChip['contract']; hiredDay: number; desk: number; rating: number | null; hats: TaskKind[];
  pay30d: number;              // payOf × days present in the last 30, plus any recruiting line of that agent
  output30d: number;           // validated tasks
  costPerOutput: number | null;
}
export interface OrgDept {
  id: DeptId; name: string; color: string; chiefId: AgentId | null;
  headcount: number; cost30d: number; load: number; openReqs: number; heads: HeadRow[];
}
export interface HiringReqView {
  id: string; dept: DeptId; role: string;
  why: string;                 // French, with the number that triggered it
  status: 'open' | 'filled' | 'cancelled';
  openedDay: number; budget30d: number; blockedBy: string | null;
  candidates: { name: string; score: number; source: string }[];
}
export interface OrgDetail {
  stage: StageView;
  headcount: number; cost30d: number; costPerHead30d: number; revenuePerHead30d: number; profitPerHead30d: number;
  depts: OrgDept[]; closed: { id: DeptId; name: string; hostedBy: DeptId | null }[];
  reqs: HiringReqView[]; pressure: RolePressure[]; lastRefusal: ChronicleEntry | null;
  decisions: ChronicleEntry[]; // hire, fire, req_open, dept_open, last 30
  history: { day: number; headcount: number; cost7d: number }[];
}
export interface LeagueRow {
  agentId: AgentId; name: string; role: string; dept: DeptId; avatar: AvatarSpec;
  rank: number; rankDelta: number; rating: number; delta7d: number; spark: number[];
  form: ('V' | 'N' | 'D')[];   // last 5 duels or weeks
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
  kind: Alumnus['kind']; why: string;
  bestRating: number | null; titles: number; tasksDone: number; cost: number;
  replacedBy: { id: AgentId; name: string } | null;
}
export interface LeagueDetail {
  season: { no: number; fromDay: number; toDay: number; daysLeft: number; rules: string[] };
  roles: { key: Skill; label: string; rows: LeagueRow[]; cutLine: number | null }[];
  plans: ProbationPlan[];
  lastHire: HireReport | null;
  duels: DuelView[];
  transfers: ChronicleEntry[]; // last 100
  hallOfFame: { season: number; champion: PersonCard; score: number; still: boolean; second: PersonCard | null; third: PersonCard | null }[];
  alumni: AlumnusView[];
  god?: Record<AgentId, TalentTruthView>; // only with ?god=1
}
export interface ChannelRow extends ChannelChip {
  spend7d: number; spend30d: number; budget: number;
  claimedRevenue7d: number; shopRevenue7d: number; reconciledRevenue7d: number;
  claimedRoas7d: number | null; shopRoas7d: number | null; reconciledRoas7d: number | null; marginalRoas: number | null;
  inflation: number | null;    // claimed / shop
  budgetCap: number; cpm: number; ctr: number; cvr: number; impressions7d: number;
  creatives: number; fatigue: number; strikes: number;
  unlock: { label: string; value: number; target: number; unit: string; met: boolean }[];
  why: string;                 // French: why it is in this status
  daily: { day: number; spend: number; claimed: number; reconciled: number }[]; // last 30
}
export interface ChannelsDetail {
  rows: ChannelRow[];
  totals: { spend7d: number; reconciledRevenue7d: number; reconciledRoas7d: number | null };
  plan: ChannelPlan | null;
  matrix: ChannelNicheState[];
}
export interface CompanySnapshot {
  scene?: SceneView;
  counts?: { creatives: number; deliverables: number; lessons: number; messages: number; products: number };
  videos?: Record<string, CreativeVideo>; // filled by the API layer, never from the world
  archive?: ArchiveCounters;
}
```

### 2.3 `server/src/contracts.ts`

In-place replacements:

| Replace | With |
|---|---|
| `submitCreative(creativeId: string): AdReviewResult;` | `submitCreative(creativeId: string, channel?: ChannelId): AdReviewResult;` |
| `getAdStats(sinceDay?: number): DailyAdStats[];` | `getAdStats(sinceDay?: number, channel?: ChannelId): DailyAdStats[];` |
| `scorePdf(content: PdfContent, ctx: { audience: string; problem: string; voc?: VoiceOfCustomer; design?: DesignSpec \| null }): QualityReport;` | `scorePdf(content: PdfContent, ctx: { audience: string; problem: string; voc?: VoiceOfCustomer; design?: DesignSpec \| null; visual?: VisualReport \| null }): QualityReport;` |
| `upsell?: { title: string; url: string } \| null }): Promise<{ pages: number; bytes: number }>;` | `upsell?: { title: string; url: string } \| null; effort?: DesignEffort }): Promise<{ pages: number; bytes: number; audit: PdfAudit; previews: { label: string; svg: string }[] }>;` |
| `renderSalesPageHtml(input: { product: Product; salesPage: SalesPage; coverSvg: string; design: DesignSpec; brand: string }): string;` | `renderSalesPageHtml(input: { product: Product; salesPage: SalesPage; coverSvg: string; design: DesignSpec; brand: string; previews?: { label: string; svg: string }[]; figureSvg?: string \| null }): string;` |
| `chooseArm(world: WorldState, dimension: string, arms: readonly string[], rng: Rng): string;` | `chooseArm(world: WorldState, dimension: string, arms: readonly string[], rng: Rng, sharp?: { samples: number; rng: Rng }): string;` |
| `  ModelTier, MindMode, NicheTruth, Order, ⏎ } from './shared.js';` | `  ModelTier, MindMode, NicheTruth, Order, ⏎ AdRatio, AudienceView, Broadcast, ChannelId, DesignEffort, EmailSequence, EmailStep, Skill, VideoCut, VisualReport, ⏎ } from './shared.js';` |

Additions, same rule as §2.2:

```ts
// ═════════ sim/ ═════════
export interface AdReviewResult { rule?: string; channel?: ChannelId }
export interface ChannelSignal {
  channel: ChannelId;
  audience: number;            // 0..100, noisy: what Pinterest Trends or an audience planner would say
  costHint: 'bas' | 'moyen' | 'élevé';
  searchClicks?: number; cpc?: number; // google: Keyword Planner, ±30 %
}
export interface PlatformReportRow { day: number; channel: ChannelId; campaignId: string; spend: number; claimedPurchases: number; claimedRevenue: number }
export interface ShopAttributionRow { day: number; channel: ChannelId; campaignId: string | null; sales: number; revenue: number }
export interface ChannelAccountStatus { id: ChannelId; state: 'closed' | 'verifying' | 'open' | 'banned'; openDay: number | null; strikes: number; bannedUntilDay: number }
export interface MarketTools {
  channelStatus(): ChannelAccountStatus[];
  requestChannel(channel: ChannelId): ToolResult;  // starts verificationDays
  channelSignals(nicheId: string): ChannelSignal[];
  getPlatformReport(channel: ChannelId, sinceDay?: number): PlatformReportRow[]; // the ad manager
  getShopAttribution(sinceDay?: number): ShopAttributionRow[];                   // the shop's own orders
  listStats(): AudienceView;
  activateSequence(input: Omit<EmailSequence, 'id' | 'status' | 'day'>): ToolResult;
  sendBroadcast(input: Pick<Broadcast, 'nicheId' | 'productId' | 'audience' | 'subject' | 'body' | 'angle' | 'hasUnsubscribe'>): ToolResult;
}
/** Phase 3: one adapter per platform. V1: five virtualAdapter(id), server/src/sim/adapters.ts. */
export interface ChannelAdapter {
  readonly id: ChannelId;
  review(creativeId: string): AdReviewResult;
  createCampaign(input: CampaignInputShape): ToolResult;
  updateCampaign(campaignId: string, patch: { dailyBudget?: number; status?: 'active' | 'paused'; creativeIds?: string[] }): ToolResult;
  report(sinceDay?: number): PlatformReportRow[];
}
export interface SimModule {
  scoreCut(cut: VideoCut): { pace: number; look: number; craft: number; notes: string[] };
  scoreEmail(subject: string, body: string, voc: VoiceOfCustomer | undefined, bannedClaims: readonly string[]): { score: number; issues: string[] };
}

// ═════════ deliverables/ ═════════
export interface PdfAudit {
  pages: number; bytes: number; degraded: boolean;
  textPages: number; shortPages: number;     // text pages with fill < 0.45
  fillMean: number;                          // notes count at half weight
  widows: number; strandedHeadings: number;  // both must be 0: paginate guarantees it, the audit proves it
  railShare: number;                         // share of text pages with a rail element
  figureKinds: number; figuresPerChapter: number; sheets: number;
  overflow: number;                          // text ops wider than their box
}
export interface CoverAudit { art: number; thumbPx: number; lineBalance: number; contrast: number; titleLines: number }
export interface DeliverablesModule {
  pickArt(design: DesignSpec, effort: DesignEffort): { seed: number; score: number; explored: number };
  coverAudit(input: { title: string; subtitle: string; audience: string; design: DesignSpec; brand: string }): CoverAudit;
  visualReport(pdf: PdfAudit, cover: CoverAudit, effort: DesignEffort, explored: number): VisualReport;
  /** 3 to 5 pages, the same type and art. */
  renderLeadMagnet(input: { product: Product; content: PdfContent; design: DesignSpec; brand: string; outFile: string }): Promise<{ pages: number; bytes: number }>;
  /** The guide's sheets, checklists and grids, as a printable kit. */
  renderKit(input: { product: Product; content: PdfContent; design: DesignSpec; brand: string; outFile: string }): Promise<{ pages: number; bytes: number }>;
  /** Still frames for a non-9:16 cut: 432×540, 540×540, 400×600. No canvas, no ffmpeg: works on every machine. */
  renderAdCut(input: { creative: AdCreative; product: Product; design: DesignSpec; brand: string; ratio: Exclude<AdRatio, 'text'> }): { frames: string[] };
}

// ═════════ minds/ ═════════
export interface Craft {
  skill: Skill;
  t: number;                   // effective talent, ramp applied
  flaw: number;                // chance per flaw site
  draws: number;               // drafts written
  eye: number;                 // sd, in score points, of the agent's reading of its own drafts
  sharp: number;               // Thompson samples averaged, 1 = today
  passes: number;              // editing passes
  reach: number;               // share of the flagged text one pass really fixes
  tier?: ModelTier;            // claude mode only
  effort?: 'low' | 'medium' | 'high'; // claude mode only
}
export interface MindContext {
  craft?: Craft;               // undefined when talent is off or the kind has no skill
  draw?: number;               // added to the engine's key only when > 0: draw 0 is the text of today
}
export interface SearchAdDraft { headlines: string[]; descriptions: string[]; keywords: string[] } // 3-5 titles ≤ 30 chars, 2 descriptions ≤ 90
export interface ContentEngine {
  writeSearchAd(input: { product: Product; voc: VoiceOfCustomer; bannedClaims: string[] }, ctx: MindContext): Promise<SearchAdDraft>;
  writeLeadMagnet(input: { product: Product; content: PdfContent; voc: VoiceOfCustomer }, ctx: MindContext): Promise<PdfContent>;
  writeEmailSequence(input: { product: Product; voc: VoiceOfCustomer; bannedClaims: string[] }, ctx: MindContext): Promise<Omit<EmailStep, 'score'>[]>;
  writeBroadcast(input: { product: Product; voc: VoiceOfCustomer; angle: string; audience: Broadcast['audience']; bannedClaims: string[] }, ctx: MindContext): Promise<{ subject: string; body: string; hasUnsubscribe: boolean }>;
}

// ═════════ runtime/ ═════════
export type ArchiveCollection = 'tasks' | 'missions' | 'orders' | 'customers' | 'ledger' | 'creatives' | 'campaigns' | 'products' | 'deliverables' | 'experiments';
export interface ArchiveBatch { day: number; rows: Partial<Record<ArchiveCollection, unknown[]>>; dropFiles: string[] }
export interface CompanyOptions { archive?: (batch: ArchiveBatch) => Promise<void> } // bench passes nothing: rows are dropped
export interface CompanyApi {
  /** Last resort of the session loop: the clock moves on, the digest says so. */
  skipTick(reason: string): void;
}
```

Also in `contracts.ts`: `RuntimeModule` comment line `~30 agents in 11 departments` becomes `the founding team`.

### 2.4 New shared files

`shared/channels.ts`, complete:

```ts
/** shared/channels.ts (new). Public facts: the UI and the agents may read them. */
import type { AdFormat, AdRatio } from './types.js';

export type ChannelId = 'tiktok' | 'meta' | 'youtube' | 'pinterest' | 'google';
export const CHANNEL_IDS: readonly ChannelId[] = ['tiktok', 'meta', 'youtube', 'pinterest', 'google'];

/** YouTube and Search share Google's account: a Google ban stops both. */
export type AdAccountId = 'tiktok' | 'meta' | 'google' | 'pinterest';

export interface ChannelPublic {
  id: ChannelId;
  label: string;            // 'TikTok', 'Facebook & Instagram', 'YouTube Shorts', 'Pinterest', 'Google Search'
  glyph: string;            // 2 letters for the totem: 'TK', 'FB', 'YT', 'PI', 'GO'
  color: string;            // hex
  account: AdAccountId;
  buying: 'cpm' | 'cpc';
  minDailyBudget: number;
  accepts: { format: AdFormat; ratio: AdRatio; fit: number }[]; // fit: public best-practice CTR factor of that ratio
  learning: { events: number; days: number } | null;
  stopLossSpend: number;
  testDays: number;
  verificationDays: number; // account review before the first campaign
}
export declare const CHANNELS: Record<ChannelId, ChannelPublic>; // table of channels.md §2.1, plus glyph and color
export const channelOf = (x: { channel?: ChannelId }): ChannelId => x.channel ?? 'tiktok';
export declare function acceptance(ch: ChannelId, c: { format: AdFormat; ratio?: AdRatio }): number | null; // ratio factor, null = refused
```

`shared/safeZones.ts`: `video §2`, verbatim. `shared/worldgrid.ts`: `ui §2.4` (`PIER_CELL`, `ISLAND_TIERS`, `tierFor`), verbatim.

### 2.5 The pillar seam, `runtime/pillars.ts`

`company.ts` is the hottest file of the repo. After S2 no pillar touches it again. It calls fixed hooks, in the fixed order `[org, growth, channels, talent, desks]`:

```ts
export interface Pillar {
  mount?(world: WorldState): void;                                    // end of the Company constructor. No draw. Migrations, ensure*
  morning?(ctx: RuntimeCtx): Promise<void>;                           // after budget_review and reactToOutage, before buildHeuristicPlan
  worked?(ctx: RuntimeCtx, worked: { agentId: AgentId; taskId: string; kind: TaskKind; review?: boolean }[]): void; // end of workTick. Reviewers too: ownerUtil counts them
  marketClosed?(ctx: RuntimeCtx): void;                               // right after sim.tickMarket
  evening?(ctx: RuntimeCtx): Promise<void>;                           // after performance_review, before closeMissions
  eveningEnd?(ctx: RuntimeCtx): Promise<void>;                        // last line of evening()
  reviewed?(ctx: RuntimeCtx, task: Task, res: { verdict: string; score: number | null }): void; // after reviewTask, before the verdict is applied
  taskDone?(ctx: RuntimeCtx, task: Task): void;                       // in finishTask, before spec.onDone
  refused?(ctx: RuntimeCtx, task: Task): void;                        // approve(id, false), after honourRefusal. No draw
  mind?(ctx: RuntimeCtx, task: Task, agent: AgentState): Partial<MindContext>; // merged in runHandler, both branches
  stepEnd?(world: WorldState): void;                                  // end of stepNow
}
export const PILLARS: readonly Pillar[]; // imports orgPillar, growthPillar, channelsPillar, talentPillar, desksPillar
```

| Pillar | Hook | Does |
|---|---|---|
| org (`runtime/org/index.ts`) | `mount` | `legacyOrgState` on old saves, `reconcileOrg` on lean worlds (D56) |
| | `worked` | `recordLoad` |
| | `marketClosed` | `bookPayroll` |
| | `evening` | `headcountEvening`, `layoffsEvening`, `auditOrg` |
| | `refused` | `recruit`: cancels the position, `hiring` hold |
| growth (`runtime/growthPillar.ts`) | `morning` | on `day % 7 === 1`: `cfoMonday`, `advanceStage`, ritual `portfolio_review` |
| | `eveningEnd` | on `day % 7 === 0`: `weekRollup`, `compactWorld`, weekly digest note |
| channels (`runtime/channels.ts`) | `mount` | `ensureChannelBook` |
| | `morning` | ritual `allocate_channels` once 2 channels have active campaigns |
| talent (`runtime/talent/index.ts`) | `mount` | `seedTruth`, `emptyLeague` |
| | `morning` | `scheduleDuel`, `coachTick` |
| | `reviewed`, `taskDone` | evidence |
| | `mind` | `craftFor` |
| | `evening` | `applyDailyEvidence`, `practice`, `sampleTalent`, `settleDuels`, ritual `league_review` when `dueSeasonClose` |
| desks (`runtime/desks.ts`) | `stepEnd` | `syncDesks` |

Talent (`league_review`: `pin` for 14 days), channels (`open_channel`) and growth (`send_broadcast`, `write_email_sequence`) answer `refused` the same way.

`RuntimeCtx` gains `ritual(kind: TaskKind, agentId: AgentId, title: string): Promise<void>` (wraps `runImmediate`, D48), `channelRng: Rng`, rebuilt in `drawTick`, and `archive?: CompanyOptions['archive']`, which the growth pillar calls with what `compactWorld` returns. `server/test/balance.test.ts:40` builds a `RuntimeCtx` by hand: P0.2 updates it. Modules stay in `runtime/`, `learning/` keeps importing no runtime code.

### 2.6 Random streams

`runtime/streams.ts`, moved out of `company.ts`, resolves the collision of three specs on `5`:

```ts
export const STREAM = { company: 1, tools: 2, market: 3, idleBreak: 4, org: 5, talent: 6, hire: 7, seedTalent: 8, channels: 9, videoCut: 10, videoTempo: 11 } as const;
```

| Draw | Stream |
|---|---|
| Candidates, names, avatars | `streamRng(seed, STREAM.hire, positionIndex, candidateIndex, field)`. `STREAM.org` is reserved for org-only draws, none today |
| Founders' and hires' talent | `streamRng(seed, STREAM.seedTalent, hashString(agent.id), skillIndex)`: paired arms share the founders' talent |
| Eye noise, extra Thompson samples | `streamRng(seed, STREAM.talent, day, tick, hashString(agent.id), purpose, hashString(task.title))` |
| Flaws | engine-local `seededRng(seed, 'flaw', method, agentId, day, ...keys, draw)` |
| Channel decisions | `ctx.channelRng`: `streamRng(seed, STREAM.channels, day, tick)` |
| Video cut, tempo | video §3.1 |
| Market, on `dayKey` | `CHANNEL_STREAM` 1001-1008 and the table below |
| Public line of a review (D92) | `REVIEW_TEXT_STREAM` 1009 in `sim/feedback.ts`. It sets a text, no market number |
| Market truth at creation | `streamRng(seed, 0xc4a701, nicheIndex)` for cells, `0xc4a702` for tempo |

`hashString` moves from `deliverables/text.ts`, which imports pdfkit, to `core/ids.ts`. `text.ts` re-exports it.

`tickMarket` (`d.rng = streamRng(dayKey, stream)` before each, `Day.dayKey` kept):

| Order | Phase | Stream |
|---|---|---|
| 1-4 | housekeeping, runAds (ends with `runPaidTails`, 1003), runOrganic, runCreators | 0-3 |
| 5 | runEmail | 100 |
| 6 | runSales | 4 |
| 7 | runCapture | 102 |
| 8 | runBumps | 103 |
| 9-14 | runUpsells, runRefunds, runReviews, runFriendlyFraud, runInbox, runEscalations | 5-10 |
| 15 | runClaims | 1004 |
| 16 | updateWarmth, no draw | none |
| 17 | rollEvents | 11 |
| 18 | rollChannelEvents (drift only) | 1005 |
| 19 | runRivals | 101 |

### 2.7 Internal signatures between packages

P0.2 writes each as a stub, so packages of one stage compile apart: a no-op, the legacy answer of D47 where a default run can reach it, or `throw new Error('not landed')` only where nothing reaches it before its package. Inside a pillar, the export tables of video §4 and pdf §4, §8, §9 are frozen the same way.

```ts
// runtime/org/officers.ts
export function officerId(w: WorldState, o: Office): AgentId;
export function officerOf(w: WorldState, o: Office): AgentState;
export function reviewerFor(w: WorldState, kind: TaskKind): AgentId | null;
export function ownersOfAny(w: WorldState, kinds: readonly TaskKind[]): AgentState[];
export function roleHolders(w: WorldState, role: RoleId): AgentState[];
// runtime/ctx.ts
export function speak(ctx: RuntimeCtx, office: Office, text: string, kind?: ActivityKind, refs?: Activity['refs']): Activity;
// runtime/org/catalog.ts
export const CANDIDATES: Record<AgentId, AgentDef & { legacyDept?: DeptId }>;
export const ROLES: Record<RoleId, { title: string; dept: DeptId; tier: ModelTier; core: TaskKind[]; assist: TaskKind[]; seats: number; lead: boolean; channel?: ChannelId }>;
export const KIND_HATS: Record<TaskKind, readonly RoleId[]>;
export const OFFICES: Record<Office, { roles: readonly RoleId[]; kind: TaskKind }>;
export const REVIEW_OFFICE: Partial<Record<TaskKind, Office>>;
export function buildTeam(cfg: OrgConfig): AgentDef[];
// runtime/org/constants.ts
export const LEGACY_ORG: OrgConfig; export const LEAN_ORG: OrgConfig; export const ORG: { /* org §5 */ };
// runtime/org/reconcile.ts
export function reconcileOrg(w: WorldState): void;
export function auditOrg(w: WorldState): string[];
export function legacyOrgState(w: WorldState): OrgState;
export function fitOf(a: AgentState, kind: TaskKind): 'core' | 'assist' | 'hat';
export function speedFor(w: WorldState, a: AgentState, kind: TaskKind): number;
export function workFor(w: WorldState, kind: TaskKind): number;
export function deptFor(w: WorldState, kind: TaskKind): DeptId;
// runtime/org/payroll.ts
export function payOf(a: AgentState): number;
export function payrollToday(w: WorldState): number;
export function bookPayroll(ctx: RuntimeCtx): void;
export function minRunCash(s: Pick<ScenarioConfig, 'org'>): number;
// runtime/org/load.ts
export function recordLoad(ctx: RuntimeCtx, worked: { agentId: AgentId; taskId: string; kind: TaskKind }[]): void;
// runtime/org/hiring.ts
export function requestRole(ctx: RuntimeCtx, role: RoleId, reason: PositionReason, detail: string): Position | null;
export function openPosition(ctx: RuntimeCtx, role: RoleId, reason: PositionReason, detail: string, replaces?: AgentId, opts?: { noTask?: boolean }): Position | null;
export function drawCandidates(ctx: RuntimeCtx, role: RoleId, positionIndex: number, n: number): Candidate[];
export function hireAgent(ctx: RuntimeCtx, position: Position, c: Candidate): Promise<AgentState>;
export function headcountEvening(ctx: RuntimeCtx): Promise<void>;
// runtime/org/departure.ts
export function canLeave(w: WorldState, id: AgentId): { ok: boolean; blockers: TaskKind[] };
export function requestDeparture(ctx: RuntimeCtx, id: AgentId, reason: string, by: AgentId, kind: Alumnus['kind']): Promise<'left' | 'notice' | 'refused'>;
export function completeDeparture(ctx: RuntimeCtx, id: AgentId): Promise<void>; // reason and kind come from agent.notice
export function layoffsEvening(ctx: RuntimeCtx): Promise<void>;
// runtime/talent/*
export function talentMode(w: WorldState): TalentMode;
export function effectiveT(w: WorldState, a: AgentState, skill: Skill): number | undefined; // undefined when mode is 'off'
export function craftFor(w: WorldState, a: AgentState, kind: TaskKind): Craft | undefined;
export function bestDraft<T>(ctx: RuntimeCtx, a: AgentState, mind: MindContext, purpose: string, write: (m: MindContext) => Promise<T>, score: (d: T) => number): Promise<{ draft: T; drawn: number; realScore: number }>;
export function armSharp(ctx: RuntimeCtx, a: AgentState, mind: MindContext, purpose: string): { samples: number; rng: Rng } | undefined;
export function pruneRead(rows: DailyAdStats[], creativeIds: string[], t: number): string[];
export function shrunkRoas(revenue: number, spend: number, t: number): number;
export function recordEvidence(w: WorldState, agentId: AgentId, skill: Skill, source: EvidenceSource, s: number, weight: number, label: string, opponent?: number, x?: number): void;
export function scoreCandidates(ctx: RuntimeCtx, role: RoleId, candidates: Candidate[]): Promise<void>; // fills interview, deliverable
export function routeBonus(w: WorldState, a: AgentState, kind: TaskKind): number;
export function onDuelCreative(ctx: RuntimeCtx, creative: AdCreative): void;
// runtime/channels.ts, runtime/allocator.ts
export function openChannels(w: WorldState): ChannelId[];
export function multiChannel(w: WorldState): boolean;
export function creditOf(w: WorldState, ch: ChannelId, nicheId: string): number;
export function planTarget(w: WorldState, c: Campaign): number | null;
// runtime/growth helpers
export function growthOn(w: WorldState): boolean;          // runtime/stages.ts
export function policyOf(w: WorldState): StagePolicy;      // runtime/stages.ts
export function logDecision(w: WorldState, d: Omit<DecisionRecord, 'id' | 'day'>): DecisionRecord; // runtime/digest.ts
export function nichePool(w: WorldState, n: NicheTruth, channel?: ChannelId): number; // sim/capacity.ts
// deliverables
export function planCut(input: { creative: AdCreative; product: Product; voc: VoiceOfCustomer; skill: number; tempo: VideoTempo; rng: Rng }): VideoCut; // deliverables/videoCut.ts
export function effortFor(talent: number, attempt?: number): DesignEffort;  // deliverables/effort.ts
```

### 2.8 World additions and old saves

`world.version` becomes 2 for new worlds. `migrateWorld(w)` (`api/persist.ts`) and the `mount` hooks fill the table. A version 1 save behaves as today: every absent scenario field means « off ».

| Field | Absent means | Filled at mount |
|---|---|---|
| `scenario.org` | `LEGACY_ORG` | same |
| `scenario.talent` | `'off'` | same |
| `scenario.channelControl` | `'tiktok_only'` | same |
| `scenario.videoModel`, `visualModel` | `'off'` | same |
| `scenario.scaling`, `openEnded` | `false` | same |
| `AgentState.roleId`, `gender`, `founder` | | from `CANDIDATES` |
| `AgentState.hatKinds`, `hatDepts` | | `[]` |
| `AgentState.hiredDay`, `rampUntilDay`, `notice` | | `0`, `0`, `null` |
| `AgentState.desk`, `DeptDef.deskHigh` | client derives it | `syncDesks`, first tick |
| `company.org` | `officerId` falls back on `LEGACY_OFFICES` | `legacyOrgState(world)`, from P1.1 on, `createWorld` included |
| `company.league`, `world.talentTruth` | no league | only when `talent !== 'off'` |
| `company.channels`, `market.channels` | TikTok alone | only when `channelControl !== 'tiktok_only'`, deterministic from the seed |
| `company.growth` | no rollup | every version 2 world, `scaling` or not (D54) |
| `market.audience`, `market.rivals` | empty | lazily, first use, no draw |
| `Product.versionDay`, `stats.ratingSum`, `ratingCount`, `hooks`, `feedback` | | from tasks and reviews, once, by `migrateWorld` |
| `AdCreative.cut`, `ratio`, `Campaign.channel`, every other optional | old formula, TikTok, 9:16 | never |

`defaultScenario` from P2.1: `org: LEAN_ORG, talent: 'league', channelControl: 'none', videoModel: 'on', visualModel: 'on', scaling: true, openEnded: false`. `AgencySession.newRun` passes `openEnded: true`. `sanitizeScenario` accepts `org`, `talent`, `openEnded` and drops `control`.

```ts
// server/test/legacy.ts
export const LEGACY: Partial<ScenarioConfig> = {
  org: { team: 'legacy31', autoHire: false, payroll: false },
  talent: 'off', channelControl: 'tiktok_only', videoModel: 'off', visualModel: 'off', scaling: false,
};
```

### 2.9 Constants

`sim/balance.ts` stays frozen until S14. Each pillar keeps its numbers in its own object, and `applyOverrides` reaches all of them from P14.0.

| Object | File | Hidden from UI |
|---|---|---|
| `ORG` | `runtime/org/constants.ts` | no |
| `TALENT` | `runtime/talent/constants.ts` | `FOUNDER_MEAN`, `MARKET_MEAN` yes |
| `CHANNEL_SIM`, `SEARCH`, `ASSIST`, `CLAIMS`, `CHANNEL_EVENTS` | `sim/channelBalance.ts` | yes |
| `CHANNEL_POLICY`, `RECON` | `runtime/channelPolicy.ts`, `learning/attribution.ts` | no |
| `VIDEO_MARKET` | `sim/videoCraft.ts` | yes |
| `VISUAL` | `sim/visual.ts` | yes |
| `GROWTH` | `sim/growth.ts` | yes |
| `STAGE_POLICY`, `COMPACT` | `runtime/stages.ts`, `runtime/compaction.ts` | no |
| `CFO`, `STAGE_GATES` | `runtime/cfo.ts`, `runtime/stages.ts` | no |

## 3. Build order

Sixteen stages, 49 packages plus S14 and S15, one after the other. Inside a stage packages run in parallel, against the frozen signatures of §2.7, and no two write one file (checked by script on this document). Every package reports what it did not finish. A package that needs a sibling's body before its stage ends tests against a fake.

**Rule for rework:** a stage gate that fails is fixed before the next stage starts. Same failure twice: the package is cut per §6 and the report says so. A package on the « never cut » list gets one more try by a fresh engineer with both failure logs. Still red on a guardrail (ledger, reload, hidden truth, approval): the run stops there, reports, and the last green stage stays pushed. Still red elsewhere: the failing test is named in the report and the run goes on.

**Wall clock:** 49 packages, 42,5 engineer-hours. With stages in parallel, the slowest package of each stage adds up to about 9 h 45 at the end of S8, 12 h 45 at S11, 14 h 45 at S13, 17 h 30 with S14 and S15. If S8 ends past hour 11, or S11 past hour 14, apply the cut ladder of §6.

### S0. Contract and seams (serial: P0.1 then P0.2)

#### P0.1 Golden and contract (55 min)
Writes: `server/scripts/golden.ts`, `server/test/golden.json`, `server/test/golden.test.ts`, `server/test/fixtures/world-v1.json.gz`, `shared/types.ts`, `shared/channels.ts`, `shared/safeZones.ts`, `shared/worldgrid.ts`, `contracts.ts`, `shared.ts`, `runtime/tasks.ts`, `minds/heuristic/index.ts`, `minds/claude/engine.ts`, `sim/tools.ts`, `sim/index.ts`, `deliverables/index.ts`, `learning/text.ts`, `minds/heuristic/direction.ts`, `web/src/ui/labels.ts`, `web/src/world/palette.ts`, `runtime/roster.ts`, `runtime/world.ts`, `runtime/company.ts`, `api/session.ts`, `sim/catalog/define.ts`, `sim/tick.ts`, `deliverables/storyboard.ts`, `learning/heuristics.ts`, `learning/retro.ts`, `minds/heuristic/ads.ts`, `server/test/api.test.ts`, `server/test/learning.test.ts`, `server/test/minds.test.ts`, `server/test/runtime.test.ts`, `web/src/ui/useEventToasts.ts`, `web/src/world/mockSnapshot.ts`
Do: **first, on the untouched tree,** run a legacy 25-day run, seed 7, and save the hash: sha1 of `{ ledger: [day, type, amount, ref], kpis, tasks: [kind, status, assignee, dayDone], events: [day, kind] }`, and a day-20 `world.json` as the old-save fixture. Then paste §2.1 to §2.4. Add `KIND_META` entries per D5, tool and `HeuristicEngine` stubs, labels the compiler asks for. `ClaudeEngine`'s four new methods delegate to its `heuristic` for good: V1 writes no prompt for them. Required members: `roleId`, `gender`, `founder` from a table in `roster.ts`, which P1.1 moves to the catalog; `hatKinds: []`, `hatDepts: []`, `hiredDay: 0`, `rampUntilDay: 0`, `notice: null` in `createWorld`, `placeholderAgent`, the three test fixtures and the mock. `define.ts`: `formatAffinity` becomes `Partial`, no niche gets a new key. `company.skipTick` throws `not landed`, `session.info()` gains `pace: 'live', watchers: 0, backoffMs: null`. The `renderAdCut` stub goes in `storyboard.ts` and `index.ts` re-exports it. D57. `runtime.test.ts:47,161` read the 34 legacy kinds until P2.1.
Tests: `golden.test.ts`: the hash matches.
Done: typecheck green, all tests green, hash unchanged.

#### P0.2 Seams and stubs (70 min)
Writes: `runtime/pillars.ts`, `runtime/streams.ts`, `runtime/ctx.ts`, `runtime/company.ts`, `sim/tick.ts`, `api/persist.ts`, `runtime/handlers/index.ts`, `runtime/org/*`, `runtime/talent/*`, `runtime/channels.ts`, `runtime/allocator.ts`, `runtime/growthPillar.ts`, `runtime/desks.ts`, `core/ids.ts`, `deliverables/text.ts`, `server/scripts/golden.ts`, `server/scripts/balanceLib.ts`, `server/test/legacy.ts`, `server/test/pillars.test.ts`, `server/test/*.test.ts`
Do: §2.5 calls in `company.ts`, the `refused` hook included, §2.6 explicit table in `tick.ts` with empty new phases, every §2.7 stub per D47, `migrateWorld` with §2.8. `...LEGACY` in `golden.ts` and in the 23 direct `defaultScenario` calls of 8 test files, by script. `RunSpec.scenario?: Partial<ScenarioConfig>` lands here, not in P14.0: `balance.test.ts:140-160` wants a guide live in 5 days, which only the legacy team does.
Tests: `pillars.test.ts`: a recording pillar sees each hook once, in order, in one day; `ALL_KINDS.filter((k) => !HANDLERS[k])` equals an allow-list that packages shrink, empty at the end; the v1 fixture loads and runs 2 days.
Done: gate green, golden unchanged. Nothing behaves differently.

### S1. The sweep (no behaviour change)

#### P1.1 Catalog and core files (50 min)
Writes: `runtime/org/catalog.ts`, `runtime/org/constants.ts`, `runtime/org/officers.ts`, `runtime/org/reconcile.ts`, `runtime/roster.ts`, `runtime/world.ts`, `runtime/company.ts`, `runtime/tasks.ts`, `runtime/ctx.ts`, `server/test/catalog.test.ts`
Spec: org §3, §4, §6 (`REVIEW_OFFICE`, `fixSelfReview`), §11 sweep for these files. D2 to D5. `legacy31` keeps its exact agents and order, `CANDIDATES.chloe` and `.tom` carry `legacyDept: 'growth'`. `legacyOrgState` lands here, not in P2.1: `officerId` reads `org.offices` from the first swept line, so `createWorld` fills `company.org` from now on. Hand-built test worlds have no `org`: `officerId` falls back on a static `LEGACY_OFFICES`. The constructor loop gets its guard (D56).
Tests: every `TaskKind` in `KIND_HATS`, every role's kinds in `KIND_META`, 8 founders, 35 roles, 24 hats, payroll 7,60 €/day.
Done: gate green, golden unchanged.

#### P1.2 The rest of the sweep (50 min)
Writes: `runtime/strategy.ts`, `runtime/redteam.ts`, `runtime/pipeline.ts`, `runtime/review.ts`, `runtime/orders.ts`, `runtime/missions.ts`, `runtime/upsell.ts`, `runtime/handlers/growth.ts`, `runtime/handlers/research.ts`, `runtime/handlers/boutique.ts`, `runtime/handlers/ops.ts`, `runtime/handlers/studio.ts`, `runtime/handlers/partners.ts`, `runtime/handlers/support.ts`, `learning/data.ts`, `learning/retro.ts`, `learning/review.ts`
Spec: org §11. Literal ids become `officerId`, first names in French text become `${nameOf(...)}`.
Writes also: `server/test/noLiterals.test.ts`
Tests: `noLiterals.test.ts` greps: no quoted agent id (`'camille'`) in `server/src`, and no capitalised first name in strings of `runtime/` and `learning/`, outside `org/catalog.ts` and `roster.ts`. `sim/catalog/knowledge/` stays out of the grep: its case studies are full of a Camille, a Tom and a Sarah who are customers, and they are the guides' content.
Done: gate green, golden unchanged, grep test green.

### S2. The lean company

#### P2.1 Lean team, reconcile, routing (60 min)
Writes: `runtime/org/reconcile.ts`, `runtime/org/index.ts`, `runtime/tasks.ts`, `runtime/company.ts`, `runtime/world.ts`, `server/test/org-core.test.ts`
Spec: org §6, §7, §8. D47, D56. `defaultScenario` flips here (§2.8). Guard kinds, `workFor`, `speedFor`.
Tests: org tests 1, 3, 4, 11, 12, 13, 17, 18, 19, 20, plus 5 as the golden.
Done: a lean run of 25 days, seed 7, publishes a guide; `auditOrg` empty every evening on 3 seeds × 3 difficulties.

#### P2.2 Payroll and money (45 min)
Writes: `runtime/org/payroll.ts`, `core/ledger.ts`, `runtime/accounting.ts`, `runtime/situation.ts`, `runtime/metrics.ts`, `api/http.ts`, `api/session.ts`, `cli.ts`, `server/scripts/balanceLib.ts`, `server/scripts/balance.ts`, `server/test/payroll.test.ts`, `server/test/api.test.ts`
Spec: org §5, D6, D9 (first term). CLI `--team`, `--no-hire`, `--no-payroll`; bench columns Effectif, Masse salariale, Embauches, Départs, Violations.
Tests: org 6, 9.
Done: one `salary` line per closed day, Σ ledger = cash, reload books nothing twice.

#### P2.3 Load, decision, hire (60 min)
Writes: `runtime/org/load.ts`, `runtime/org/hiring.ts`, `runtime/org/names.ts`, `runtime/handlers/org.ts`, `runtime/handlers/index.ts`, `runtime/holds.ts`, `server/test/hiring.test.ts`
Spec: org §9. D16 with `scoreCandidates` stub returning 50. D49, D53, D55. `headcount_review`, `recruit`.
Tests: org 7, 8, 10, 16; 200 positions drawn in a row all get a name.
Done: a 60-day lean run hires at least once on seed 7; each refusal has its numbers in `org.decisions`.

#### P2.4 Leaving, notes, brain (45 min)
Writes: `runtime/org/departure.ts`, `runtime/org/notes.ts`, `learning/playbooks.ts`, `brain/politiques/Recrutement.md`, `brain/playbooks/Playbook Vidéo.md`, `brain/playbooks/Playbook Communauté.md`, `brain/00 - Accueil.md`, `server/test/leaving.test.ts`
Spec: org §10, §11 Brain. D17, D55. `TOPIC_DEPTS`, `agentsForLesson` with `hatDepts`. `Company.ready()` stays untouched: `layoffsEvening` writes the missing agent notes on its first evening.
Tests: org 2, 14, 15, 21, 22.
Done: chaos test green: a departure every 3 days for 40 days, audit empty, no task unassigned over 2 days.

### S3. Talent and the league

#### P3.1 Truth and craft (50 min)
Writes: `runtime/talent/constants.ts`, `runtime/talent/skills.ts`, `runtime/talent/truth.ts`, `runtime/talent/craft.ts`, `runtime/talent/index.ts`, `learning/bandits.ts`, `learning/playbooks.ts`, `minds/heuristic/index.ts`, `minds/claude/engine.ts`, `server/test/talent-craft.test.ts`
Spec: talent §2 to §4.1, §4.8, §4.9, §4.10. D1, D11, D12, D15. `control.talentOverride` applied in `seedTruth`. `control.noLearning`: `chooseArm` picks at random, `addRule`, `replaceRuleEverywhere`, `syncDirective` return at once.
Tests: talent 1, 2, 3, 5, 11, 12, 21.
Done: `off` is byte-identical to golden; sentinel truth absent from the snapshot.

#### P3.2 Copy, page and buying levers (60 min)
Writes: `minds/heuristic/ads.ts`, `minds/heuristic/commerce.ts`, `runtime/handlers/growth.ts`, `runtime/handlers/boutique.ts`, `server/test/talent-levers.test.ts`
Spec: talent §4.2, §4.3, §4.5. D26 steps pruneRead and shrunkRoas.
Tests: talent 6, 7, 9, 10.
Done: mean `scoreCreative` t=.8 at least 4 above t=.2, page at least 6, over 40 draws.

#### P3.3 Research and support levers (40 min)
Writes: `minds/heuristic/research.ts`, `minds/heuristic/support.ts`, `runtime/handlers/research.ts`, `runtime/handlers/support.ts`, `server/test/talent-levers2.test.ts`
Spec: talent §4.6, §4.7. Calls `recordEvidence` for `reply`, `chargeback`.
Tests: valueWeight picks the niche with the better known price; t=.8 clears a bigger batch than t=.2.
Done: both tests green, `off` unchanged.

#### P3.4 Evidence, rating, routing (50 min)
Writes: `runtime/talent/evidence.ts`, `runtime/tasks.ts`, `server/test/talent-evidence.test.ts`
Spec: talent §5, §6.2, §6.4 routing. D14, D21, D58: `parStats` fills in `flat` too.
Tests: talent 13, 20.
Done: rating moves on evidence, routing shows in `flat` as today and differs in `league`.

#### P3.5 Seasons, plans, challenge (60 min)
Writes: `runtime/talent/season.ts`, `runtime/talent/challenge.ts`, `runtime/handlers/league.ts`, `runtime/handlers/index.ts`, `runtime/org/hiring.ts`, `server/test/talent-league.test.ts`
Spec: talent §6.1, §7.1 to §7.4, §7.6. D13, D16, D17, D18, D19, D20, D48, D49, D58. Replaces the `scoreCandidates` stub with a `TEST_BY_SKILL` table that P6.1 and P7.3 extend. `hireAgent` seeds `talentTruth.agents[id]` and the league entry.
Tests: talent 4, 15, 16, 17 (rewritten for D1: the old agent is in `org.alumni`, the new one holds the role), 18.
Done: forced low talent on seed 7: plan, failed plan, challenge, hire and departure in one tick, reload equal.

#### P3.6 Duels and founder orders (50 min)
Writes: `runtime/talent/duels.ts`, `learning/experiments.ts`, `learning/heuristics.ts`, `runtime/holds.ts`, `runtime/missions.ts`, `runtime/orders.ts`, `api/trim.ts`, `server/test/talent-duels.test.ts`
Spec: talent §6.3, §7.6 orders, `godModeOf`. `vire X`, `gèle les embauches` from org §13.
Tests: talent 14, 19; `ne vire personne` blocks a forced challenge.
Done: a formal duel settles and moves budget to the winner.

### S4. Channels: the market

#### P4.1 Delivery, pools, Search (60 min)
Writes: `sim/channelBalance.ts`, `sim/channels.ts`, `sim/capacity.ts`, `sim/market.ts`, `sim/tick.ts`, `sim/adapters.ts`, `server/test/channels.test.ts`
Spec: channels §3, §4.1. D22, D33. `nichePool` with `channel`, no brand.
Tests: channels §11 sim rows on identity, pools, learning, Search, tail, assist.
Done: `tiktok_only` byte-identical to golden.

#### P4.2 Tools, compliance, formats (45 min)
Writes: `sim/tools.ts`, `sim/compliance.ts`, `sim/quality.ts`, `minds/heuristic/ads.ts`, `minds/heuristic/index.ts`, `minds/claude/prompts.ts`, `brain/politiques/Conformité pub par canal.md`, `server/test/channelTools.test.ts`
Spec: channels §2.3, §6, §7.5 scorers, `writeSearchAd`, static scene. `AD_FORMATS` stays the four bandit arms: `writeAd` tests `static_image` before it, or `ads.ts:384` turns a pin into a TikTok format.
Tests: channels §11 rows on formats, compliance, Google strikes.
Done: each tool of §2.3 answers, per-account strikes work.

#### P4.3 Claims and attribution (40 min)
Writes: `sim/claims.ts`, `learning/attribution.ts`, `learning/kpi.ts`, `runtime/accounting.ts`, `server/test/attribution.test.ts`
Spec: channels §5, §8.
Tests: Σ reconciled = Σ shop to the cent, credit 1 with one channel, KPI spend = ledger.
Done: `reconcileDay` shows one invoice per channel, no gap.

### S5. Channels: the company

#### P5.1 Unlock and discovery (60 min)
Writes: `runtime/channelPolicy.ts`, `runtime/channels.ts`, `runtime/handlers/channels.ts`, `runtime/handlers/index.ts`, `runtime/strategy.ts`, `runtime/acquisition.ts`, `server/test/channelPolicy.test.ts`
Spec: channels §7.1, §7.2, §7.3, §7.5. D23, D24, D25, D49. `adapt_creative` keeps a creative with no files while `renderAdCut` answers no frames: the market reads the script, the files come with P7.2.
Tests: channels §11 runtime rows on unlock, approval, stop-loss, bans, category prior.
Done: on seed 7, 60 days, normal, Meta opens or its refusal is logged with numbers.

#### P5.2 Allocator (50 min)
Writes: `runtime/allocator.ts`, `runtime/handlers/growth.ts`, `runtime/handlers/ops.ts`, `runtime/metrics.ts`, `server/test/allocator.test.ts`
Spec: channels §7.4, D9, D26.
Tests: « marginal, not average », « unspent », Σ ≤ adCap, +30 %, silent drift loses budget in 7 days, worked example of §7.4.
Done: all green; reload at every tick with 3 channels open ends equal.

#### P5.3 Lessons, holds, review routing (40 min)
Writes: `learning/heuristics.ts`, `learning/retro.ts`, `learning/experiments.ts`, `learning/data.ts`, `runtime/playbook.ts`, `runtime/holds.ts`, `runtime/missions.ts`, `runtime/review.ts`, `minds/heuristic/research.ts`, `server/test/channelLearning.test.ts`
Spec: channels §5.3, §6 end, §7.7, `bestChannelBuzz`.
Tests: `coupe Meta` holds Meta only; hook bandit reads TikTok rows only; a lesson `Privilégier le canal`.
Done: all green.

### S6. Output: video core and PDF foundations

#### P6.1 The cut and its score (50 min)
Writes: `deliverables/videoCut.ts`, `deliverables/speech.ts`, `sim/videoCraft.ts`, `sim/quality.ts`, `sim/tick.ts`, `sim/market.ts`, `sim/index.ts`, `runtime/handlers/growth.ts`, `runtime/talent/challenge.ts`, `learning/retro.ts`, `minds/heuristic/ads.ts`, `runtime/talent/evidence.ts`, `server/test/videoCut.test.ts`, `server/test/videoScore.test.ts`, `server/test/speech.test.ts`
Spec: video §3. D12, D16, D31. Beat kinds of §2.2 only. `cut` evidence at the first review of `produce_ad`. `scoreCut` wired in `sim/index.ts`, `video` row of `TEST_BY_SKILL`.
Tests: video §12 for these files.
Done: skill .2 vs .9 differs in craft by ≥ 40; a better cut raises CTR through `adQ`; `videoModel: 'off'` equals golden.

#### P6.2 Compositor (60 min)
Writes: `video/caps.ts`, `video/spec.ts`, `video/stage.ts`, `video/fonts.ts`, `video/pdfPages.ts`, `video/timeline.ts`, `video/compose.ts`, `video/scenes/title.ts`, `video/scenes/hook.ts`, `video/scenes/pain.ts`, `video/scenes/proof.ts`, `video/scenes/fact.ts`, `video/scenes/bonus.ts`, `video/scenes/end.ts`, `server/scripts/renderAd.ts`, `server/package.json`, `package-lock.json`, `server/assets/fonts/anton-latin-400-normal.woff`, `server/assets/fonts/montserrat-latin-600-normal.woff`, `server/assets/fonts/montserrat-latin-800-normal.woff`
Spec: video §4, §6. Port `video-proto/proto.mjs`. D28, D29, D60. `optionalDependencies`: `@napi-rs/canvas`, `pdfjs-dist`, `ffmpeg-static`. Also adds `fontkit` as a direct dependency, for P6.5.
Tests: `server/test/videoFrames.test.ts`, also written here: frame 0 and a mid frame non-blank at 270×480, text outside a zone fails `insideSafe`.
Writes also: `server/test/videoFrames.test.ts`
Done: `renderAd.ts` writes PNG frames of one real creative; read them, they look like `sheet3.png`.

#### P6.3 Audio (45 min)
Writes: `video/speech.ts`, `video/tts.ps1`, `video/music.ts`, `video/sfx.ts`, `video/mix.ts`, `server/test/videoAudio.test.ts`
Spec: video §5. Port `audio.mjs`, `tts.ps1`.
Tests: video §12 audio rows, `alignWords` on recorded events.
Done: a real Hortense line and word timings on this machine; no voice gives a clean estimate.

#### P6.4 Encode and QA (40 min)
Writes: `video/encode.ts`, `video/qa.ts`, `server/test/videoRender.test.ts`
Spec: video §4.1, §10. Port `qa.mjs`.
Tests: video §12 render rows: 3 s mini-cut passes, black, mute, wrong-size files fail.
Done: `master.mp4` of a real creative passes all 13 checks and ffprobe.

#### P6.5 Fonts and Scene (50 min)
Writes: `server/assets/fonts/fraunces-900-normal.woff`, `server/assets/fonts/OFL`, `server/assets/fonts/README.md`, `deliverables/fonts.ts`, `deliverables/voices.ts`, `deliverables/scene.ts`, `deliverables/design.ts`, `server/test/pdfText.ts`, `server/test/deliverables.test.ts`
Spec: pdf §3, §4, §5. All 28 faces of pdf §3.1 (one path named above for the checker, the 27 others too). Port `pdf-proto/src/scene.mts`, `woff2ttf.mjs`, `pdftext.mts`. Replace the existing `pdfPagesText` helper first. Read each family's licence at commit (Source Serif 4, Anton, Montserrat).
Tests: first four rows of pdf §16 `design.test.ts`, contrast of every ink set.
Done: a test page in each voice embeds its fonts, ligatures extract intact, empty font dir degrades cleanly.

### S7. Output: video delivery and PDF look

#### P7.1 Director and API (50 min)
Writes: `video/director.ts`, `video/worker.ts`, `video/index.ts`, `api/session.ts`, `api/server.ts`, `server/test/videoDirector.test.ts`, `server/test/videoWorld.test.ts`
Spec: video §9. D27, D44, D52. `/api/videos`, `/api/videos/render`, SSE `video`. Range and MIME stay in P12.1. `off` under vitest: `api.test.ts` mounts a real `AgencySession`, and `auto` would fork render workers inside the tests.
Tests: video §12 director and world rows: `world.json` byte-identical with a fake director.
Done: a real run with `auto` renders a campaign's creative in the background, the tick loop never blocks.

#### P7.2 Other formats (50 min)
Writes: `video/scenes/slide.ts`, `video/scenes/narrator.ts`, `deliverables/storyboard.ts`, `server/test/videoFormats.test.ts`
Spec: video §3.4, §8, §4.2 ratios. `renderAdCut`. Carousel and `static_image` PNG cards. 4:5 and 1:1 re-layouts. D28.
Tests: each format yields its output; 4:5 keeps every text box inside its stage.
Done: real MP4 for `text_slideshow`, `ugc_avatar` and a 4:5 cut, all pass QA.

#### P7.3 Art and covers (60 min)
Writes: `deliverables/art/tiles.ts`, `deliverables/art/heroes.ts`, `deliverables/art/field.ts`, `deliverables/art/evaluate.ts`, `deliverables/cover.ts`, `deliverables/index.ts`, `runtime/talent/challenge.ts`, `server/scripts/contact-sheet.ts`, `server/test/art.test.ts`
Spec: pdf §6, §7. D16: `design` row of `TEST_BY_SKILL`. `pickArt`, `coverAudit` wired in `deliverables/index.ts`. **8 heroes:** moon, sun, paw, heart, leaf, coin, chart, home. Aliases: sparkle→sun, pot→leaf, bolt→chart, book→chart, dumbbell→coin, brush→home. **2 layouts:** `split`, `minimal`; `centered` and `badge` map to `split`.
Tests: pdf §16 tile, best-of-8, overflow, cover SVG rows.
Done: contact sheet read by eye, 8 heroes × 4 ink sets, none looks like a mistake.

#### P7.4 Layout engine and pages (60 min)
Writes: `deliverables/layout/grid.ts`, `deliverables/layout/blocks.ts`, `deliverables/layout/paginate.ts`, `deliverables/pages/render.ts`, `deliverables/pdf.ts`, `deliverables/pdfVisuals.ts`, `server/test/layout.test.ts`
Spec: pdf §8. `paginate` is pure. Bench against 300 ms. Stop rule on `layouts` measured here (pdf §18).
Tests: pdf §16 `layout.test.ts`, bookmarks, identical bytes on two renders.
Done: the four fixture guides render with no widow, no stranded heading, no page under `MIN_PAGE_FILL`; `svg-to-pdfkit` no longer imported.

#### P7.5 Diagrams (45 min)
Writes: `deliverables/diagrams.ts`, `server/test/diagrams.test.ts`
Spec: pdf §9.1, §9.3.
Tests: pdf §16 `diagrams.test.ts`.
Done: each new `VisualSpec` type renders on the fixture, every digit of a figure exists in the guide.

### S8. Output: content, visual score, sales page

#### P8.1 Guides worth 39 € (50 min)
Writes: `minds/heuristic/studio.ts`, `minds/heuristic/archetypes.ts`, `minds/heuristic/plan.ts`, `minds/heuristic/editing.ts`, `runtime/handlers/studio.ts`, `server/test/content.test.ts`, `server/test/golden.json`, `docs/BALANCE.md`
Spec: pdf §9.2, §10; talent §4.4 (`longform`, `polish`, `bestDraft`, `passes`, `reach`).
Tests: pdf §16 `content.test.ts`, talent 8.
Done: every topic of every niche ≥ 2 300 words, `freshWords` ≥ 0,8 × parent, 6 chapters, no duplicate adjacent plan row. Golden re-recorded, per D43.

#### P8.2 Visual score reaches the market (50 min)
Writes: `deliverables/effort.ts`, `deliverables/visualReport.ts`, `deliverables/index.ts`, `sim/visual.ts`, `sim/tick.ts`, `sim/quality.ts`, `runtime/handlers/creation.ts`, `runtime/review.ts`, `runtime/talent/evidence.ts`, `server/test/visual.test.ts`
Spec: pdf §12, §13. D32. `visual` evidence: `visual.overall` at `render_pdf`, par 75, sd 10, w 1. `visualReport` wired in `deliverables/index.ts`.
Tests: pdf §16 `visual.test.ts`.
Done: `interior` and `cover` rise with talent on the fixture, `visualCvr(null) === 1`, finish levels written in a code comment.

#### P8.3 Sales page (40 min)
Writes: `deliverables/salesPage.ts`, `runtime/handlers/boutique.ts`, `server/test/sales.test.ts`
Spec: pdf §11.
Tests: pdf §16 `sales.test.ts`.
Done: no external URL, test banner intact, ≥ 3 previews, ≤ 700 KB per preview; screenshot read by eye.

### S9. Scale: always-on and bounded memory

#### P9.1 Always-on (50 min)
Writes: `runtime/company.ts`, `api/session.ts`, `api/persist.ts`, `api/sse.ts`, `api/server.ts`, `api/http.ts`, `cli.ts`, `scripts/forever.mjs`, `package.json`, `server/test/alwaysOn.test.ts`, `server/test/api.test.ts`
Spec: scale §2. `skipTick`, away pace, backoff, `world.prev.json`, checkpoints, `runs/current.json`, `POST /api/run/extend`, `npm run agency`. Wires `CompanyOptions.archive` through `ctx.archive` to `api/archive.ts`, whose body is P9.2's. The growth pillar's `eveningEnd` already calls `weekRollup` then `compactWorld` (P0.2). D51 ships in the same commit as `world.prev.json`. `api.test.ts:1194-1240` pins what this package changes (« pauses after three in a row », « skips the finished run »): rewritten here.
Tests: scale 1, 2, 3, 4, 5; `/runs/<id>/` answers 403 on `world.prev.json`, a checkpoint and an archive file.
Done: an open-ended run passes its horizon; a corrupt `world.json` resumes from prev.

#### P9.2 Compaction and its readers (60 min)
Writes: `runtime/compaction.ts`, `api/archive.ts`, `runtime/metrics.ts`, `runtime/acquisition.ts`, `runtime/strategy.ts`, `runtime/notes.ts`, `runtime/redteam.ts`, `runtime/pipeline.ts`, `runtime/situation.ts`, `runtime/handlers/growth.ts`, `runtime/handlers/ops.ts`, `runtime/handlers/partners.ts`, `runtime/handlers/research.ts`, `runtime/handlers/common.ts`, `learning/kpi.ts`, `learning/vault.ts`, `sim/feedback.ts`, `sim/tick.ts`, `sim/tools.ts`, `server/scripts/longrun.ts`, `server/test/compaction.test.ts`, `server/test/longrun.test.ts`, `server/package.json`
Spec: scale §7. Adds the `test:long` script. Three traps of §7.2, plus D50. D61 for the time target. Reader table is mandatory: every `company.tasks` reader of the 14 files named here gets checked.
Tests: scale 19, 20, 21, 22, 23.
Done: `compactWorld` on and off give byte-identical KPI series over 150 days.

### S10. Scale: the CFO, the market, the digest

#### P10.1 Stages and CFO (60 min)
Writes: `runtime/stages.ts`, `runtime/cfo.ts`, `runtime/growthPillar.ts`, `runtime/metrics.ts`, `runtime/strategy.ts`, `runtime/handlers/growth.ts`, `runtime/acquisition.ts`, `brain/business/Croissance.md`, `brain/politiques/Budget et garde-fous.md`, `brain/playbooks/Playbook Finance.md`, `server/test/growth-cfo.test.ts`
Spec: scale §4, D7, D8, D9 (second term), D40, D54.
Tests: scale 7, 8, 9, 24.
Done: `scaling: false` equals golden; `adTarget` ≤ cap on synthetic ledgers.

#### P10.2 Audience, kit and rival mechanics (60 min)
Writes: `sim/growth.ts`, `sim/audience.ts`, `sim/rivals.ts`, `sim/tick.ts`, `sim/events.ts`, `sim/tools.ts`, `sim/quality.ts`, `sim/index.ts`, `server/test/audience.test.ts`, `server/test/golden.json`, `docs/BALANCE.md`
Spec: scale §6.1, §6.2 market side, §6.3 kit and rivals. No brand. `scoreEmail`. `traffic.repeat` picks among orders of the last 120 days in both modes, or compaction changes the draw.
Tests: scale 13, 14, 15, 16, 17.
Done: Σ delivered ≤ bucket size, 400 days keep ≤ 224 buckets, golden re-recorded per D43.

#### P10.3 Digest and decisions (45 min)
Writes: `runtime/digest.ts`, `server/test/digest.test.ts`
Spec: scale §3, D37, D38. `weekRollup`, `buildDigest`, weekly note. Routes land in P12.1.
Tests: scale 6: digest profit = ledger profit, a skipped tick and a killed product both appear.
Done: a digest over 60 days names its losses in French.

### S11. Scale: portfolio and lifecycle

#### P11.1 Portfolio, harvest, niches (50 min)
Writes: `runtime/portfolio.ts`, `runtime/strategy.ts`, `runtime/pipeline.ts`, `runtime/handlers/ops.ts`, `server/test/portfolio.test.ts`
Spec: scale §5.
Tests: scale 10, 11, 12.
Done: a main with 0 € of ads is not killed; a paid loser with happy buyers is harvested.

#### P11.2 Lifecycle company side (60 min)
Writes: `runtime/audience.ts`, `runtime/growthPillar.ts`, `runtime/handlers/lifecycle.ts`, `runtime/handlers/index.ts`, `runtime/upsell.ts`, `minds/heuristic/lifecycle.ts`, `minds/heuristic/index.ts`, `deliverables/kit.ts`, `deliverables/index.ts`, `server/test/lifecycle.test.ts`
Spec: scale §6.2 company side, §6.3 kit, D3. Handler allow-list of `pillars.test.ts` ends empty here.
Tests: magnet, sequence, broadcast and kit each produce their file or state; approval gates them; `findBannedClaims` on every email.
Done: on seed 7, 60 days, a list exists and `email` or `bump` orders appear in the ledger.

### S12. Interface: data, world, tabs

#### P12.1 Views and serving (50 min)
Writes: `api/views.ts`, `api/chronicle.ts`, `runtime/desks.ts`, `api/trim.ts`, `api/snapshot.ts`, `api/server.ts`, `api/http.ts`, `server/test/views.test.ts`, `server/test/desks.test.ts`, `server/test/api.test.ts`
Spec: ui §2.1, §3, D34, D35, D39, D52. Routes `/api/org`, `/api/league`, `/api/channels`, `/api/digest`, `/api/digest/seen`, `/api/growth`, `/api/deliverables`, `/api/playbook`, `/api/product/:id`. Range and MIME.
Tests: ui §8 `views.test.ts`, `desks.test.ts`, `api.test.ts` range rows.
Done: 60 agents, 100 products, 240 videos, day 200: live JSON ≤ 500 000 bytes; sentinel truth only with `?god=1`.

#### P12.2 World layout (60 min)
Writes: `web/src/world/testCanvas.ts`, `web/src/world/layout.ts`, `web/src/world/islands.ts`, `web/src/world/model.ts`, `web/src/world/agents.ts`, `web/src/world/layout.test.ts`, `runtime/roster.ts`
Spec: ui §4.1, §4.4 sync rules. D35, D36. Fixes the four defects at the top of ui.md.
Tests: ui §8 `layout.test.ts`.
Done: a hire rebuilds nothing, a departure moves nobody, 8 192 open subsets keep their cells.

#### P12.3 World stage (60 min)
Writes: `web/src/world/pier.ts`, `web/src/world/plaza.ts`, `web/src/world/stage.ts`, `web/src/world/props.ts`, `web/src/world/sprites.ts`, `web/src/world/effects.ts`, `web/src/world/sprites.test.ts`, `web/src/world/mockSnapshot.ts`, `web/src/world/preview.tsx`, `web/world-preview.html`
Spec: ui §4.2, §4.3, §4.6, §5, minus §6 cuts: no balloon, no interview room, no statues, no scaffold, no fireworks, no arch. The mock gains its `scene` block and the preview its « Scènes » panel here: this Done and P13.1's read them, and P13.3 comes too late.
Tests: ui §5.7 sprite assertions.
Done: pier, podium, league board, duel table, channel totems, carry frames visible in the preview at zoom 2.

#### P12.4 Effectif and Compétition (60 min)
Writes: `web/src/ui/useDetail.ts`, `web/src/ui/tabs/EffectifTab.tsx`, `web/src/ui/tabs/CompetitionTab.tsx`, `web/src/ui/tabs/team.css`, `web/src/ui/TopBar.tsx`, `web/src/ui/icons.tsx`, `web/src/ui/labels.ts`, `web/src/App.tsx`, `web/src/ui/teamTabs.test.tsx`
Spec: ui §6.1 to §6.4. Registers the four new tabs, lazily.
Tests: ui §8 rows for these bodies, TopBar keys.
Done: both bodies render from a `mockDetail`, no talent truth without god mode.

#### P12.5 Canaux, Croissance, Publicité (50 min)
Writes: `web/src/ui/tabs/CanauxTab.tsx`, `web/src/ui/tabs/CroissanceTab.tsx`, `web/src/ui/tabs/AdsTab.tsx`, `web/src/ui/tabs/FinanceTab.tsx`, `web/src/ui/tabs/LearningTab.tsx`, `web/src/ui/tabs/market.css`, `web/src/ui/marketTabs.test.tsx`
Spec: ui §6.5, §6.8, channels §10, scale §8.
Tests: Canaux prints the three ROAS together, tones follow reconciled.
Done: every « TikTok » of these tabs is a channel label or « Publicité ».

#### P12.6 Viewers (50 min)
Writes: `web/src/ui/viewers/Lightbox.tsx`, `web/src/ui/viewers/VideoPlayer.tsx`, `web/src/ui/viewers/PdfFlip.tsx`, `web/src/ui/viewers/viewers.css`, `web/src/ui/tabs/GalleryTab.tsx`, `web/src/ui/tabs/ProductsTab.tsx`, `web/package.json`, `package-lock.json`, `web/src/ui/viewers.test.tsx`
Spec: ui §6.6, D27, D29. `snapshot.videos`.
Tests: gallery tile is a button, no `<video>` file falls back to the iframe, `flipSpread`, GalleryTab does not import pdfjs.
Done: a real guide flips and a real MP4 plays with sound in the browser pane.

### S13. Interface: life, shell, docs

#### P13.1 Drama (50 min)
Writes: `web/src/world/drama.ts`, `web/src/world/engine.ts`, `web/src/world/agents.ts`, `web/src/world/drama.test.ts`
Spec: ui §4.4 lifecycle, §4.5, §4.7. D1 leaves one path: every leaver's id is gone from the snapshot. Dock arrival and departure without a balloon: walk, fade.
Tests: ui §8 `drama.test.ts`, minus the talent-replacement row.
Done: Scènes panel: hire, fire, duel, end of season all play.

#### P13.2 Shell (50 min)
Writes: `web/src/ui/FounderDigest.tsx`, `web/src/ui/StageBadge.tsx`, `web/src/ui/Hud.tsx`, `web/src/ui/EndBanner.tsx`, `web/src/ui/ScenarioModal.tsx`, `web/src/ui/tabs/CalendarTab.tsx`, `web/src/ui/useEventToasts.ts`, `web/src/ui/AgentPanel.tsx`, `web/src/ui/ActivityFeed.tsx`, `web/src/ui/DeptPanel.tsx`, `web/src/App.tsx`, `web/src/world/Minimap.tsx`, `web/src/ui/shell.test.tsx`
Spec: ui §6.7, §6.8, §6.9.
Tests: digest prints a loss as negative; AgentPanel no longer renders hash skills; alumni name from `scene.names`.
Done: digest opens after 7 unseen days, reopens on `d`.

#### P13.3 Mock, docs, every « 31 » (45 min)
Writes: `web/src/world/mockSnapshot.ts`, `web/src/world/preview.tsx`, `web/src/world/world.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/BALANCE.md`, `package.json`, `runtime/world.ts`, `runtime/roster.ts`
Spec: org §11 « Every 31 ». Mock: 12 agents per org §11, overriding ui §6.9, on top of what P12.3 gave it. `world.test.ts` asserts invariants, no count.
Tests: mock passes I1 to I4.
Done: A15 of §5 passes.

### S14. Calibration

One package, §4. **P14.0** writes `server/scripts/calibrate.ts`, `server/scripts/calibrateLib.ts` and extends `server/scripts/balanceLib.ts`, `server/scripts/balance.ts`; **P14.1** runs it once, writes the winner, and re-records golden per D43.

### S15. Acceptance

One package: every row of §5, in order, fixing only what fails. It writes the tools §5 names: `server/scripts/autonomy.ts`, `server/scripts/pdfSheet.ts`, `server/test/replay.test.ts`. A fix that touches `sim/` or a constant re-runs the single control it affects, never a new calibration. A row gets at most two fixes. Still failing: its number goes in `docs/BALANCE.md` as failed and S15 moves on. A guardrail row (A4, A5, A21, A22, A23) gets a third, then the feature that breaks it is switched off by its scenario default, and the report says so.

### Hot files: order of edits

Stages are sequential, so a later stage rebases on the earlier one, never the reverse.

| File | Stages, in order |
|---|---|
| `runtime/company.ts` | P0.1, P0.2, P1.1, P2.1, P9.1 |
| `runtime/tasks.ts` | P0.1, P1.1, P2.1, P3.4 |
| `sim/tick.ts` | P0.1, P0.2, P4.1, P6.1, P8.2, P9.2, P10.2 |
| `sim/quality.ts` | P4.2, P6.1, P8.2, P10.2 |
| `sim/tools.ts` | P0.1, P4.2, P9.2, P10.2 |
| `runtime/handlers/growth.ts` | P1.2, P3.2, P5.2, P6.1, P9.2, P10.1 |
| `runtime/strategy.ts` | P1.2, P5.1, P9.2, P10.1, P11.1 |
| `runtime/metrics.ts` | P2.2, P5.2, P9.2, P10.1 |
| `minds/heuristic/ads.ts` | P0.1, P3.2, P4.2, P6.1 |
| `deliverables/index.ts` | P0.1, P7.3, P8.2, P11.2 |
| `runtime/talent/challenge.ts` | P3.5, P6.1, P7.3 |
| `api/session.ts` | P0.1, P2.2, P7.1, P9.1 |
| `api/server.ts` | P7.1, P9.1, P12.1 |
| `runtime/holds.ts`, `runtime/missions.ts` | P1.2 (missions), P2.3 (holds), P3.6, P5.3 |
| `runtime/review.ts` | P1.2, P5.3, P8.2 |

## 4. Calibration

One pass, at the very end, on the finished company. `server/src/sim/balance.ts` may change only here, and only by the winner's values. All numbers below are fixed now, before any result exists.

**Tooling (P14.0, 45 min).** `RunResult` gains `league.parStats`, `talentTruth.samples`, `talentTruth.swaps`, `growth.weeks`, what M1 to M7 read (`work`, `ratings`) and `cashOn`. ROAS and CTR halves, sales and refunds read the daily rows, which hold the whole run; next to them the fresh-creative CTR (TikTok rows under `FRESH_CREATIVE_IMPRESSIONS`) and the angle fit (hook × format of what ran over the niche's best pair, by impression), because falling ROAS at rising spend is saturation. A bankruptcy reads as in the health sweep and `RunResult.bankrupt`: at least one negative close up to that day, recovered or not; « dead » is cash below 0 on the last day. A run to D182 closes week 26. `applyOverrides` reaches the objects of §2.9, `LEARNING`, `PAID_TAIL`, `TIKTOK_OVERLAP`, `FAMILY_FATIGUE`, `COST_HINT` and `PORTFOLIO`, and an unknown path throws. `control.talentOverride` takes a list, so that one group at ,25 or ,8 leaves the others at ,56 (talent §10.1). `calibrate.ts` runs the steps below one at a time (`--step N`) at `--jobs 14`, writes per-seed JSON to `runs/calibration/step<N>/<arm>/<difficulty>-<seed>.json`, never re-runs a finished seed, so a killed step resumes by the same command, and refuses any second candidate list. Every arm is `openEnded`, as the product is (D125). A saved seed carries the stamp of the code that made it, another code stops the step, and `--winner-written` is checked against the code (D127). A `step<N>` path at the top of any run folder is server-only (D128).

**Budget.** About 980 runs of 60 days at about 30 s each, 300 of 182 days at about 3 minutes, 90 of 270 days at about 6 minutes: about 2 h 30 at 14 jobs. Hard stop at 4 hours (D123): a step past it launches no new seed and reports what finished.

**Step 1. Noise floor.** Candidate A, `normal`, seeds 1-30, twice: as is, and with the placebo `ADS.baseCtr × 1.01`, the one of every noise arm below. `N` = median absolute paired difference over the seeds the placebo touched. A seed whose daily rows match to the byte measured nothing: it is printed and leaves `N`, and past 3 such seeds there is no `N` and the next steps refuse (D124). Every threshold written `420 €` below means `max(420, N)`.

**Step 2. Pars and levers.** `talent: 'flat'`, 12 seeds, `normal`.

| Run | Purpose | Rule |
|---|---|---|
| `talentOverride` all skills .56 | measures the evidence pars of talent §5.2, from `league.parStats` | writes `TALENT.par`, `TALENT.sd` once (`--write`, a marker refuses a second) |
| `copy`, `page`, `longform + polish`, `buying` at .25 and .8 | paired median of `profit(.8) − profit(.25)` per group | ≥ 100 €: keep. Between 0 and 100 €: keep, report. Negative: that group's flaws go to 0, report. No re-run |

**Step 3. Candidates.** It refuses to start before Step 2 has written the pars (D127). Seven, 30 seeds (1-30), 3 difficulties, 500 €, heuristic: `facile` and `cauchemar` to D60, `normal` to D182 for K3, K7, K8 (D116, D121): 630 runs. Two directions because the sign is unknown: payroll alone is -456 € and talent predicts -8 to -15 % of ROAS, channels and email push it up. E is there for reach: B moves revenue about +8 %, some +240 € over a 60-day run, which cannot close a gap of 800 €. F is there because seats reach t about ,70 by D84 and ,76 by D182 while the best of 6 candidates reads ,715: a league cannot select from a market worse than its seats (of 30 challenges, 5 replacements), raising `founderMean` as D does widens that gap, and pay alone already removes the deaths (10 of 10 never negative). G is there because the pool binds: revenue is flat from D85 and pool × 3 gave a median × 1,94 on D121-270. Scale §0.2 froze the pool, the founder's first demand is a company that scales, so the frozen pool gets one chance to earn its change, against pre-registered checks. It changes nothing unless it wins by the rule (D120).

| Candidate | Change |
|---|---|
| A | As designed |
| B | `CONVERSION.base` 0,018 → 0,0195 |
| C | `CONVERSION.base` 0,018 → 0,0165 |
| D | `ORG.payPerDay` × 0,75 and `TALENT.founderMean` 0,56 → 0,62 |
| E | B and D together |
| F | `ORG.payPerDay` × 0,75 and `TALENT.marketMean` 0,52 → 0,60 |
| G | F, and `CONVERSION.poolBase` and `CONVERSION.poolDemand` both × 2 |

**Checks** (a real challenge but fair, from `docs/BALANCE.md`):

| # | Check |
|---|---|
| K1 | `normal`: goal (1 000 € by D60) reached on 15 to 27 of 30 seeds |
| K2 | `normal`: median profit between 1 000 € and 4 000 €, read at D60 on the same runs that continue to D182 |
| K3 | `normal`: at most 2 bankruptcies of 30 at D60, and at most 2 of 30 at D180 (D116) |
| K4 | `facile`: goal on at least 24 of 30, no bankruptcy |
| K5 | `cauchemar`: at most 8 bankruptcies of 30, median final cash ≥ 250 € |
| K6 | All runs of Step 3: `stats.violations` 0, Σ ledger = cash, no NaN |
| K7 | `normal`: median of at least 1 replacement per seed by D182 |
| K8 | `normal`: scale A3 on the candidate's own arm, Theil-Sen slope of weekly net revenue over weeks 9-26 above 0 on at least 24 of 30 seeds, and median week 26 / week 9 at least 2,0 |

**Decision rule.** Keep the candidates that pass all eight. Among them, the closest to a `normal` median of 1 800 €. None passes: the fewest failed checks, then the closest. A tie, or a gap under `max(420, N)` (D124): the first in the order A, D, F, B, G, E, C. Write the winner's values, re-record golden per D43, run `npm test`, then stop. If K3 at D180 or K5 fails under the winner, the insurance held back by D117 is built, then `--step 3 --insurance` re-runs that candidate's `normal` and `cauchemar` arms once, the winner staying the winner (D123, D127). A failed check is reported with its number, never tuned. There is no step 3 bis.

**Step 4. Paired controls on the winner.** `normal`, seeds 1-30, 60 days unless stated, paired per seed, the winner's values as overrides until they are written (`--winner-written`). A ratio between two arms keeps their order whatever the sign (D126). Each mechanic has its rule, and the rule is applied without discussion.

| Control | Arm | Pass | On failure |
|---|---|---|---|
| **No learning** | `control.noLearning` | paired median ≥ +420 €, positive on ≥ 19/30 | Report: this is a defect, S15 looks at it |
| **No league** | `talent: 'flat'` | talent M1, M2 (selection works), M3 (it pays), M7 on the 60-day arms, M7 pooling the persons of every seed per skill, since a lean team rarely holds 3 on one skill at D42; M4, M5, M6 on the full arm of the scaling control, since the first replacement cannot come before D56 (D79); the count of replacements by D60 and by D180 printed | M1, M2 pass and M3 fails: keep, report the effect. M4 < 50 %: firing off, routing stays. K7 holds the place of the old fallback on the plan gate, which has read `0,5 rd` since D79 (D123) |
| **No scaling** | `scaling: false`, **182 days** so that week 26 closes (A2 reads D180), its own noise run alongside | scale A1 to A5 | Report the measured numbers. If A1 misses, check `priceMove` first (scale §13.2), once |
| No hire | `org.autoHire: false` | paired median ≥ 0, bankruptcies ≤ control | Report |
| Legacy 31 paid | `team: 'legacy31'`, payroll on | paired median > 0 | Report |
| TikTok only | `channelControl: 'tiktok_only'` | median gain ≥ +25 % and ≤ ×2,5, bankruptcies ≤ control | Report |
| Average ROAS | `channelControl: 'average_roas'` | full wins on ≥ 19/30 and by > 420 € | The allocator falls back to the average rule |
| Last click | `channelControl: 'last_click'` | same | `claimWeight` 0: reconciliation off, UI shows two readings |
| Video skill | `control.videoSkill` .2 and .9 | CTR ratio ≥ 1,12 on ≥ 24/30, profit gain > 0 | Report |
| Tempo | `control.videoTempo: 'standard'` | learned CTR D31-60 above fixed on ≥ 18/30 | `tempoFit` = 1, tempo stays cosmetic and leaves the bandit |
| Design talent | `control.designTalent` .25 and 1 | median gain > 0, ≥ 19/30 positive | One retry only: `VISUAL.cvr.slope` 0,25. Then keep the look, record « non prouvé » |
| Retest rule (D122) | The winner, fresh seeds 31-60, 270 days, three arms paired per seed: winner, `PORTFOLIO.retestAny` 1 (arm R of D106), placebo `ADS.baseCtr` × 1,01. Revenue of weeks 27-38 from daily rows | median ratio R/winner ≥ 1,15, R above the winner on ≥ 19/30, median ratio above the placebo's, bankruptcies do not rise | Dropped for good, the flag leaves the code. This is the one and only second look |

**Step 5. Final report.** If a « on failure » switch fired, one last run of the winner, 90 runs, by `scripts/balance.ts --open-ended`. No decision follows it. `calibrate.ts --step 5` only assembles the numbers into a block; `docs/BALANCE.md` gets all of it: candidates, winner, every control with its number, what was switched off. The memory note on seeds gets the new reference median (1 408 € is no longer one).

## 5. Acceptance: « works 100 % »

Run in order in S15. Each row is pass or fail.

| # | Check | Command or test | Pass |
|---|---|---|---|
| A1 | Types | `npm run typecheck` | exit 0 |
| A2 | Tests | `npm test` | all green, handler allow-list empty |
| A3 | Build | `npm run build` | exit 0, no chunk holds pdfjs but the lazy one |
| A4 | Same seed, same run | `server/test/replay.test.ts`: 2 full-feature runs of 45 days | identical under the `decisions()` filter of `runtime.test.ts` (`at`, `createdAt`, `bytes` aside) |
| A5 | Reload = uninterrupted | `server/test/replay.test.ts`, `play(seed, ticks, 7)` from `runtime.test.ts`, all pillars on, a seed with a hire, a firing, a compaction, 3 channels | identical under the same filter, in `flat` and `league` |
| A6 | 365-day run | `cd server && npx tsx scripts/longrun.ts --days 365 --seed 7` | ≤ 240 s (D61), `world.json` ≤ 12 MB, live ≤ 400 kB, heap ≤ 500 MB, Σ ledger = cash, violations 0 |
| A7 | 365 days, 10 seeds | same, seeds 1-10 | no crash, no NaN |
| A8 | Runs alone | `server/scripts/autonomy.ts`, 30 seeds, 90 days, no founder action | a guide live by D15 on ≥ 28/30, no task open over 10 days without a logged reason, hires happen without a call |
| A9 | Right team size | same output | day-60 headcount differs across seeds; no constant 31; median between 9 and 25; payroll in the ledger |
| A10 | Competition is real | full arm of the scaling control, 180 days (D62), and the forced-low run of P3.5 | median of at least 1 replacement by D180, the count by D60 printed; every `leftBecause` has its numbers; each hire's `HireReport` score beats the incumbent's by the margin of its `HireReport` |
| A11 | Agents improve | talent test 12, `talent-levers.test.ts`, `talentTruth.samples` of the `flat` arm | t changes the text and the score; `meanLeague` D60 above D1 on ≥ 24/30 seeds |
| A12 | Scales alone | scaling control of §4 | scale A1 to A5 as reported; the weekly revenue curve printed |
| A13 | Real MP4 | `cd server && npx tsx scripts/renderAd.ts` on a real run: one `faceless_voiceover`, one `text_slideshow`, one `ugc_avatar`, one 4:5 cut. Then `ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate:format=duration,size -of json <file>` | h264, yuv420p, 30/1, 1080×1920 or 1080×1350, aac, 9 to 34 s, ≤ 12 MB, `qa.ok`, moov before mdat |
| A14 | The video is looked at | `ffmpeg` tile of 12 frames per file, read as an image | hook readable on frame 1, real guide page visible, text inside safe zones, no blank frame |
| A15 | Every « 31 » gone | `git grep -nE "\b31\b.{0,12}(agents?|personnes|employ)|(agents?|équipe).{0,12}\b31\b" -- . ':!docs/REFERENCES.md'` | only `team: 'legacy31'` code and its test |
| A16 | PDFs as images | `cd server && npx tsx scripts/pdfSheet.ts --run <id>`: rasterise via pdfjs and canvas one guide per voice (4), cover, promise, opener, body, diagram, sheet, final | read each sheet: type real, no overflow, no half-empty page, accents right, art intentional |
| A17 | PDF structure | `design.test.ts`, `layout.test.ts` | ≥ 3 `/FontFile2`, no Helvetica, `/Outlines`, ligatures extract, identical bytes on re-render |
| A18 | Sales page | open one in the browser pane | book, real pages, price of the day, test banner, no external request |
| A19 | Clean fallbacks | `VIDEO_FORCE_LEVEL=storyboard_only`, `no_voice`, `no_pages` (D60), then once for real: `npm ci --omit=optional` in the clean copy of A26 | each level: the run finishes, its UI text shows, nothing crashes |
| A20 | Fonts missing | `fonts.ts` on an empty dir | `degraded`, `interior` ≤ 60, no crash |
| A21 | Hidden truth | sentinel tests of `views.test.ts`, talent test 3, route test of P9.1 | no truth outside `?god=1`; `world*.json`, `checkpoints/` and `archive/` answer 403 on `/runs/<id>/`; no other file of the run folder holds the sentinel |
| A22 | Guardrails | compliance, approval, stop-loss, CFO cap tests, with 3 channels | a 60-day approval run: every channel, hire, firing and broadcast waits for him |
| A23 | Ledger | invariant on all calibration runs | Σ ledger = cash, KPI = ledger, per channel |
| A24 | Old save | `server/test/fixtures/world-v1.json.gz` loads, plays 5 days | no crash, behaves as legacy |
| A25 | Nothing real | `git grep -nE "api\.tiktok|graph\.facebook|googleads|fetch\(" server/src` and the bench run with no key | no real endpoint in the agency; `claude` mode never called |
| A26 | From scratch, browser | Copy the repo to a clean folder without `node_modules`, `runs`, `web/dist`. `npm ci`, `npm run build`, `npm run agency`. In the browser pane: new run « Sans fin », ×8 to day 15 | agents work, a guide goes live, `read_console_messages` shows no error; open Effectif, Compétition, Canaux, Croissance, Galerie; flip a PDF; play a video with sound; hide the tab for 7 simulated days, the digest opens; reload the page, same state |
| A27 | Overnight | `npm run agency`, stop the process abruptly, start it | same run resumes, the digest names the gap |
| A28 | Docs | README, ARCHITECTURE, BALANCE | match what shipped, the cuts of §6 listed |

## 6. Cuts

Dropped so that this ships. Each is a decision, not a to-do.

| Cut | Why |
|---|---|
| Stable seats, `personId`, renames | D1: they solved a problem the sweep removes |
| CEO in the league, `direction` skill, `board` evidence | One lever, noisiest evidence, she cannot leave |
| Promotion to chief | Real effects are few on a lean team, the swap logic is large |
| `budgetPct` perk, `talentSpeed`, onboarding freeze, `HIRE_COST` | Second-order, each one more rule to prove |
| `payrollCap` | Wrong by construction, D7 |
| Retargeting | Second « trap » next to Search, needs visitors state, the channel most specific to Meta at scale |
| Non-TikTok organic | Four slots a day, thin numbers, a long tail to bound |
| `channel_cpm_spike` | The existing TikTok spike teaches the same |
| `platform_claims` and `no_bandit` controls | Two arms that prove little beyond `last_click` and `tiktok_only` |
| `buyerScore`, `talentEdge`, `thumbFactor` | D21, D30 |
| Brand (`market.brand`) | Channels already add capacity; two capacity mechanics cannot be told apart |
| Stage gate on channels or hires | Their own money gates decide, one rule per decision |
| `before_after`, `step_list` beats, 2:3 video | Designed, never rendered; two more scenes of the same grammar |
| Caveat, `@expo-google-fonts` | D28 |
| 6 of 14 heroes, 2 of 4 cover layouts | Each hero takes several passes by eye; aliases keep every motif valid |
| Balloon, interview room, candidates' bench, statues, scaffold, fireworks, stage arch | Staging with no result. The walk to the dock carries the firing |
| `CandidateChip`, `scene.candidates` | Challenges take one tick, nothing to stage |
| Separate calibration in each spec | D41: seven loops on noise is how a run gets stuck |

**Cut ladder if the clock runs out** (§3). In this order, from the top, only as far as needed. Never cut: payroll, reconcile, the league's challenge, QA, the world test, fallbacks, compaction, the digest, S14, S15.

1. P12.3 reduced to pier and league board.
2. P3.6 formal duels: natural duels stay.
3. P7.2 `ugc_avatar` narrator: renders as `faceless_voiceover`.
4. P4.3 claims and attribution, with `creditOf` = 1. `last_click` control dropped.
5. Rivals in P10.2, keeping a decay on `competitorClone`.
6. Pinterest and its tail: 4 channels.
7. P8.3 previews: sales page keeps the new look without real pages.

**Open risks, stated now.**

- Audio cannot be judged here: LUFS and silence pass, nobody listens. Hortense is the weakest link and stays so offline. The founder should listen once.
- Safe-zone numbers come partly from third-party tools (video §2), to check in-app before anything real.
- Lean team, small families: most roles have one person, so ratings run against par and M1 may be thin on 60 days. The 180-day arm is where it should show.
- Email constants are estimates (scale §13.1). Scale A1 depends on them.
- Compaction is only as safe as its reader audit. New readers landing after S9 are caught by scale test 19, run at each later stage gate through `test:long`.
- Payroll and hires change the niche choice path, so the old 1 408 € median is not a reference for anything.
- Candidate E widens S14's reach, it does not guarantee it. If S13 lands more than about 800 € under the target, K1 and K2 fail and are reported as failed, per the decision rule.

## 7. Critique applied

Attack on this plan against the real code, working tree of `be75c2c`. Each line was checked by reading the code or by compiling, not taken from a spec.

1. P0.1 could not reach « typecheck green »: the contract was compiled on two files only. Pasted on a copy of the tree, it broke 10 more server files, 3 tests and 2 web files. P0.1 now lists them, with how each is filled. The 16 catalog errors collapse into `sim/catalog/define.ts`.
2. P0.1 would also have failed `runtime.test.ts:47,161` (every kind has an owner) and moved mission routing through `PLAN_KINDS`: both handled, D57.
3. Stubs that throw would have crashed every smoke run from P2.1 on, since `defaultScenario` flips there. Stubs now answer like today, D47.
4. `officerId` needs `org.offices` during S1, but `legacyOrgState` landed in S2: moved to P1.1, with a fallback for hand-built test worlds.
5. D16 needed `planCut` and `pickArt` in S3, three stages early: 50 until P6.1 and P7.3 fill `TEST_BY_SKILL`.
6. `scoreCut`, `pickArt`, `coverAudit`, `visualReport` and `writeSearchAd` were stubbed but no package replaced them: wiring files added to P4.2, P6.1, P7.3, P8.2. `ClaudeEngine` delegates to its heuristic for good.
7. `RunSpec.scenario` moved from P14.0 to P0.2: `balance.test.ts` needs `LEGACY` as soon as the default flips. The `...LEGACY` job is 23 direct calls in 8 test files, not a few helpers.
8. `golden` must be re-recorded by P14.1 if the winner touches `CONVERSION.base`: D43 said twice only, which made candidates B and C self-defeating.
9. D17 called `requestDeparture` after `hireAgent`, whose step 5 already completes the departure: double exit and double `leave:` line. One path now, with `notice.kind` and `openPosition(…, { noTask })`.
10. `runImmediate` drops `awaitFounder`: a `league_review` ritual in approval mode would have closed as done and swapped nobody, or closed the season twice. D48.
11. `honourRefusal` is private and `company.ts` is closed to pillars: refusals of hires, swaps, channels and broadcasts had no path. New hook `refused`, D49.
12. Reload risk in `Company`'s constructor: its `taskKinds` loop would give back kinds `reconcileOrg` removed. D56, and `reconcileOrg` added to the org `mount`.
13. Reload risk in unawaited brain notes: `hireAgent` and friends were typed sync though they write notes. D55.
14. Compaction breaks determinism: `runAds` keys streams on the campaign's array index. `Campaign.seq` and `ArchiveCounters.campaigns`, D50, `sim/tick.ts` and `sim/tools.ts` added to P9.2. `traffic.repeat` clamped the same way in P10.2.
15. Hidden-truth leak: the route guard `/^world\.json/i` would have served `world.prev.json`, checkpoints and archives to anyone. D51, test in P9.1, A21 rewritten, since its old text was false.
16. Snapshot limit: `videos` travels in `extra`, untrimmed, up to 150 KB on a base of 456 KB. D52, and P12.1's size test now carries 240 videos.
17. Name pool ran out after about 30 positions, inside a 365-day run. D53, with a test.
18. `company.growth` existed only under `scaling`, so the control arm of scale A1 to A3 had no `growth.weeks` to read. D54.
19. S14 could not set pars: `EvidenceEvent` keeps `s`, not `x`, and its ring is flooded by support replies. M4 and M5 could not be rebuilt after the fact. `parStats`, `swaps`, D58.
20. `noLiterals.test.ts` as written would fail on `sim/catalog/knowledge/`, where customers are named Camille and Tom. Scope fixed.
21. `AD_FORMATS.includes` at `ads.ts:384` would have turned every Pinterest `static_image` into a TikTok format. P4.2 tests it first, arms stay four.
22. P9.1 changes behaviour pinned by `api.test.ts:1194-1240` without being allowed to touch that file. Added. `ctx.archive` added too: the growth pillar had no way to reach `CompanyOptions.archive`.
23. `auto` video mode would fork render workers inside `api.test.ts`. Off under vitest, P7.1.
24. A19 could not reach `storyboard_only`: `ffmpeg-static` survives an emptied `PATH`. `VIDEO_FORCE_LEVEL`, D60, plus one real `npm ci --omit=optional`.
25. P12.3's Done and P13.1's read a preview that P13.3 was to write later: mock `scene` and the « Scènes » panel moved to P12.3.
26. A6's 150 s contradicted §4's own 30 s per 60 days. 240 s, D61.
27. A10 was a coin flip on 60 days with five founders in the league: judged on 180 days, D62, with one bounded fallback in §4.
28. Calibration reach: B alone cannot close a gap of 800 €. Candidate E added, still one pass, 90 more runs.
29. Unbounded loops: S15 had no stop rule, and a never-cut package failing twice had nowhere to go. Both now stop.
30. No multi-seed check existed before hour 15: integrity sweep at S3, S5, S8, S11, S13, nothing tuned on it. `test:long` joined the gate from S10, as §6 already assumed.
31. Founder's asks: « agents improve » had no acceptance row, A11 now reads `samples`. « Facebook » was only `meta` in the UI, D59. A4 and A5 now state the filter `runtime.test.ts` really uses: `at`, `createdAt`, `bytes`.

Checked and left alone: stream numbers against `DAY_PHASES`, 119 literal lines, 47 kinds, 35 roles, 7,60 €/day, S0 to S13 write overlaps (none after these edits), `summarizeLedger` with `salary`, `lastClosedLedgerDay` after the payroll line, `scorePdf` reading `design` as a truthy flag only, bounded replacements (2 per season, 28 days on a role).

## 8. Decisions taken during the build

Taken by the orchestrator after reading each stage gate. They rank with §1.

- D63. `QA.maxSec` is 60, not the 34 of video §10: most real voice-overs run past 34 s and were lost to QA at S6.
- D64. `Product.visual.explored` is never shown: it reads the designer's hidden talent out. The line of pdf §17 is dropped, the hidden-truth guardrail wins.
- D65. The cut ladder of §6 stays unused unless a real limit appears. Its clock was an estimate, the founder set no deadline.
- D66. A polish stage runs after S13 and before S14, judged by eye on real frames and pages: the composition of 9:16 frames, real guide pages in most voiced ads, the review card, half-empty guide pages. It lands before S14 because how often a cut shows a page moves the video score.
- D67. The reserve term of D9 applies only outside survival: its floor is the survival line, so under it `adCap` read 0 for good. Survival keeps the control's envelope and its own rules. This replaces the `min(rate × cash, cash − reserve)` row of scale §4.3 under survival.
- D68. A founder's kill is final: the niche it closed gets `reopenDay: null`. A kit or follow-up the founder stops leaves the niche alone. Reopening would need its own order.
- D69. `Product.paidRead` keeps what a paid test cost once the raw ad rows pass 90 days, so a finished test is not read as untested.
- D70. The live snapshot limit is 400 000 bytes, as A6 and `longrun.test.ts` say, not the 500 000 of D39 and P12.1's Done. The stricter number passes, so it holds.
- D71. Compaction keeps a row wherever a reader needs it, past the table of scale §7.2: creatives of a non-killed product stay whole, killed products keep `content.promise`, and open missions no longer pin rows because `Mission.gone` folds them.
- D72. `kpi.channels` leaves the TIGHT and LIVE views, against channels.md:792: nothing reads it there, the UI reads the world.
- D73. `isServerOnlyFile` also tests the real path of the file: Windows short names such as `WORLD~1.JSO` pass the regex of D51.
- D74. A `test` guide has no bounded wait yet: 23 lines stay after S11, 11 idle for 30 days or more. S14 reads them and decides.
- D75. One existing test was loosened at S10 for a stated reason: « a competent policy that never learns » in `sim.test.ts` reads `cash > -50` instead of `bankrupt === false`, because a clone now takes 10 % of conversion at once. S14 re-reads it after calibration.
- D76. `primaryOf` takes the first core skill with an evidence route in the role, read per role through `EVIDENCE_KINDS`, core or assist kinds: `growth_lead` is `buying`, no longer `copy`. A role no route reaches keeps its first skill, unrated, so `cover_designer` stays `design` (D16). Mount refreshes an older save.
- D77. `TALENT.par` and `TALENT.sd` hold values measured before S14, the one exception to « no tuning before S14 »: a league read against pars of the design selects nobody. S14 overwrites them once.
- D78. `rd` is a standard error: it falls with evidence to `rdMin` 35, stops at `rdGame` 200, and grows back only on a rating nobody played this season. K is unchanged.
- D79. « Sous la barre pendant un certain temps » is a chain. The bar is par or the median of the rated seats of status `active`, whichever is higher, stored at each close. Two closes in a row under it on a real sample, day 42 at the earliest, then the plan of 14 days, met at the bar minus 10. The first replacement cannot come before D56. This overrides talent §5.1, §5.3, §7 and §10 where they read a fixed par.
- D80. A seat not under the bar restarts at 0 whatever its sample; a seat under it on a thin sample keeps its count. The strict « only the lowest of the family » stays, so an unsure lower colleague still blocks a plan. No cooldown after a met plan: 11 of 80 plans opened on the close that met the last one.
- D81. A challenge is 6 candidates and 8 sits each, 3 when Claude writes. The sit key is the index `k` through `mind.day + 1000 × k`, not `mind.draw`, which would change the heuristic text; sit 0 is the single-sit test, so hire tests do not move. The margin is `marginSe` standard errors pooled over the seven who sat, floor 1, stored in `HireReport.margin`. It replaces `CHALLENGE_MARGIN`.
- D82. `marginSe` is 1,5, by the fixed rule of the health stage (median 0 replacements, 4 of 4 truly better at 2). Seeds 31-42 at 182 days: 5 replacements, 4 truly better, median 0, so A10 is missed; the noise arm gives 5 false replacements on 25 challenges, 3 of them founders. At 2: 4 replacements, 4 truly better, 3 false. Left to the orchestrator: going back is one constant and two test lines.
- D83. `design`, `support`, `buying` and `research` have no test that sees talent. A failed plan there ends `kept_no_test` on the spot, before the gates of talent §7.6, with a `HireReport` without candidates so that `keptLately` reads it. `video` and `polish` keep their challenge.
- D84. A layoff takes the lowest rating among the idle, occupation then pay as ties, in the league only. On the cash-loss path idle means under `idleUtil`, and if nobody is the old order applies. A seat with no rating reads par.
- D85. Formation continue: at a close, growth on, cash at least 3 times the start, 15 € a seat within 5 % of 14 days of revenue, lowest rating first, after replacements. It moves `t` and its ceiling (cap 0,97), draws nothing, skips forced talent and seats on notice, and books `recruiting` with ref `training:<season>`. `flat` pays it too.
- D86. Training stops at his word: nothing is paid under his stop on spending or on every ad, and the report says why. A stop on one channel or one guide does not count. In approval mode it is skipped with the same note rather than opening a task at every close: A22 reads « waits for him », and a skipped line waits.
- D87. `team: 'legacy31'` pays no training, whatever its talent and scaling: a control keeps its spending. L1 to L8 themselves do run on a plain legacy31 run, whose talent defaults to `league`. Golden uses `LEGACY`, talent off, and does not move; the « Legacy 31 paid » row of S14 reads that arm with the new league rules.
- D88. A family of one reads the mean of all rated seats of that day in `swaps.familyMean`, the only field any reader uses.
- D89. `LeagueDetail` gains `season.bar`, `season.cut`, `season.cutBlind`, `season.training`, `roles[].blindTest`, `outside[]` and `LeagueRow.underBar`. The cut line of a blind family ends at the plan. The rules give both counts of sits, because the view has no engine.
- D90. The digest no longer prints `testWeek`: it prints what channel tests spent, and the CFO note reads real spend first, then the ceiling, then the envelope. `Allocation.testWeek` stays in the world because `scalingRoom` reads it, only the claim goes. « Tests de canaux » counts campaigns flagged `test`; a guide's first paid test is not flagged.
- D91. The fiche shows seniority and league instead of the level. The level law is untouched, and the brain line « Promotion : » and the playbook's `**Niveau**` stay: tests pin the first and it reflects a real gate.
- D92. A review's public line comes from `sim/reviewBank.ts` on stream 1009 (§2.6). `Review.basis` keeps the old sentence for the sim's readers and is stripped from snapshots and GET product, so market draws do not move.
- D93. So an ad's proof scene quotes the basis, which no public review holds: 60 quotes, 0 in a public review, on seed 36 at D81. Kept, it is what buys the neutrality of D92. S14 may show the public text of the same review while scoring keeps the basis.
- D94. `unsaid()`: a line left unsaid still burns its id. `idCounter` keys some streams, so suppressing a line would move the market.
- D95. A quiet day (no sale, refund or ad) drops the feed's claims of progress, in words only: the retro still raises confidence as its windows slide. Stopping that would change later decisions on dying seeds, so S14 decides.
- D96. One bankruptcy event per episode: a dip within `SOLVENT_DAYS` 7 of a negative close is the same one. The status law, the ad pause and payroll do not change. `world.status` stays `finished` at the end, « ended bankrupt » is read from `finance.bankrupt`.
- D97. A campaign's number is `(seq ?? index) + 1`, kept by `trimCampaigns` and compaction. Stopping one adds no hold: the plan gave the same guide a new campaign within 4 days in 9 of 10 stops, so the answer says so and gives the sentence that stops it for good. A refused resume keeps `pausedFor`, or the campaign would read as ended.
- D98. `trim_ads` is an executed order only beside a request, alone it stays a plain task. An order reads only its own clauses, so the subject of a request cannot become its target.
- D99. A sentence ending in « ? » orders nothing, except a polite ask that stops spending (« tu peux couper les pubs ? »): a stop must not be lost to a question mark, a lift waits for a plain word, and `kill_product` is never polite. A verb after an auxiliary is a report. A refusal needs a real shape: « pas », « plus » and « jamais » refuse only right before an infinitive, or after « ne ».
- D100. What an order leaves alone is read apart from what it acts on: « sauf », « hors », « excepté », « à part », « mais pas » and « sans » plus an order verb. A number there is spared, not targeted, and a guide named there spares its campaigns. The hold stands, and what is spared is `founderForced`: the buyer and the plan leave it, the stop-loss still reads it. A number nobody carries refuses. « Coupe tout » alone is still no order, only with a limit.
- D101. A name after a bare comma is someone he speaks to: a list needs its « et ». The mission's target is never taken from a list. The test « a list goes on past two names » changed for this.
- D102. Left as read: a question or a report can start the routine `optimize_ads` on the word « coupe », with no stop and no hold; « arrête la campagne 2 et reprends la campagne 3 » runs the resume rule on both numbers and answers the refusal.
- D103. `HeadRow.output30d` adds compaction's folds, `taskTotals.agents[id].days`, pruned past 31 days. An old save undercounts until it fills.
- D104. `LIVE_TIGHT_LIMITS` also takes `reviewsPerProduct` 1 and `deliverables` 20, to hold the 400 000 bytes of D70 with the larger world the league leaves.
- D105. Server texts also say « narrateur animé », beyond the UI label: the digest printed the old name through experiment text. Lesson and playbook text move, no action does.
- D106. The bounded test of what ends a winner adopted nothing: base, J, R, A and two placebos, seeds 31-38, 270 days, 48 runs. R reads 1,26 of base on 6 of 8 seeds, between the placebos at 1,33 and 0,95, whose seeds run from ×0,17 to ×4,14. `judge()`, `retestDue`, `waterFill` and Search stay. The fall past D180 is read to D270 only: median 0,84 of base, falling on 7 of 8. Nothing answers past D270.
- D107. `RunResult` gains `replacements`, the seats a challenge gave to the market, read by the health sweep: A10 had no count outside the world.
- D108. `LIVE_TIGHT_LIMITS` moved at S12: kpis 60, chats 12, adComments 14, doneTasks 15, inbox 15, adStatsDays 2.
- D109. New contract fields at S12 and S13: `kpiBaseline`, `AdTotals.week`, `counts.catalogue`, `GateCheck.lower`.
- D110. New file `shared/trends.ts`, outside the list of §2.4.
- D111. `pay30d` is derived: the `salary:<id>` ref of ui §2.2 does not exist.
- D112. The Growth department is named Acquisition.
- D113. P12.3: the carry anchor is 12 px, the cheer arms stand at x 3 and 12.
- D114. `SessionLike.digestSeen` and `sessionViews(live)` are added to what the API reads of a session.
- D115. `/api/deliverables` returns `{items,page,pages,pageSize,total}`.
- D116. S14 is amended, K3 reads bankruptcies at D60 and at D180, at most 2 of 30 at each, and `normal` candidates run to D182. The founder is away, this is the orchestrator's decision: 7 of the 8 deaths on 48 seeds come after D60, so a read at D60 alone passes a company that dies later.
- D117. The survival insurance (founders at 0, one test under the line) is held back. It is built only if K3 at D180 fails under the winner.
- D118. The cliff and growth-floor changes are dropped.
- D119. `TALENT.challenge.marginSe` goes back to 2, which closes what D82 left to the orchestrator: the fallback to 1,5 fired by its rule and bought one replacement, a wrong one, while false replacements among equals went from 12 % to 20 % of challenges (expected 10,2 % against 24,3 %).
- D120. Step 3 gains F (`ORG.payPerDay` × 0,75, `TALENT.marketMean` 0,52 → 0,60) and G (F, with `CONVERSION.poolBase` and `poolDemand` × 2), before any result: a league cannot select from a market worse than its seats, and the pool binds. The frozen pool of scale §0.2 gets this one chance, it changes nothing unless it wins by the rule, and §4 keeps the numbers behind both.
- D121. K7 and K8 join the checks, numbers fixed now: a median of 1 replacement per seed by D182, and scale A3 on the candidate's own arm. The rule reads all eight, then the closest to 1 800 €; none passes, the fewest failed then the closest; a tie or a gap under N, the first in A, D, F, B, G, E, C. K2 is read at D60 on the runs that go on to D182, K6 covers all 630 runs.
- D122. The retest rule gets one confirmatory test, last row of Step 4: `PORTFOLIO.retestAny`, default 0 and golden unchanged, on the winner, seeds 31-60, 270 days, against a placebo. D106 said « not shown » on 8 seeds, this says yes or no on 30 fresh ones, and a no takes the flag out of the code.
- D123. The hard stop of §4 goes from 90 minutes to 4 hours, at `--jobs 14`, because `normal` candidates run to D182. K7 replaces the moot fallback of the No league row, and if K3 at D180 or K5 fails under the winner, the insurance of D117 is built and that candidate's `normal` and `cauchemar` arms re-run once, in the run stage.
- D124. The placebo goes from `ADS.baseCtr` × 1,0001 to × 1,01, in Step 1, the scaling noise run and the retest placebo, before any result. A CTR only feeds `rng.binomial`, so × 1,0001 moves one click in 10 000: seeds 2 and 3 stayed byte-identical to D40, N would have read the smallest gaps, and « a gap under N » would almost never fire. × 1,01 diverged by D14 on seeds 1, 2 and 3. A seed left untouched is printed and leaves N, past 3 of 30 there is no N, and the decision rule reads a gap under `max(420, N)`, the noise of every paired threshold, because an N under the project's own floor would hand the winner to whichever 30-seed median landed nearest by chance.
- D125. Every arm of the calibration runs `openEnded`, as the product does. With an end, a 60-day arm opens no plan past D50 while the first replacement comes on D56 (D79), so M1 and M3 could not see one, and a 182-day arm closes D182 blocked, so K7 and M6 would have read D168. This only removes that guard, and a 60-day arm no longer stops the league where its 182-day twin goes on. `scripts/balance.ts --open-ended` gives Step 5's last run the same company.
- D126. A ratio between two arms keeps their order when the base is at or under 0: the arm ahead reads above 1, the arm behind under, equal results read 1, losing 500 € against 100 € reads ,2 and the reverse 5. It used to read 0 whatever happened, on the third of the seeds at or under 0 at D60 that A4 and the TikTok row start from. A run's own end over its start, K8 and A3, keeps Infinity and 0: there a dead seed counts against.
- D127. A saved seed carries the stamp of the code that made it, a hash of the content of `server/src`, `shared`, `server/assets` and `balanceLib.ts`, read by the process that runs it, so a commit moves nothing and a constant does, even mid-step. Another code stops the step. The one escape is `--step 3 --insurance` (D123): the winner's `normal` and `cauchemar` seeds run again, the others stay, the winner stays, and a second use is refused. Step 3 refuses until the pars are written, `--step 2 --write` until Step 1 is complete, Step 4 a Step 3 of another code, and `--winner-written` is read against the constants instead of trusted.
- D128. A `step<N>` path at the top of a run folder is server-only, whatever `--out` named the folder: per-seed files hold true talent, and a check on the name `calibration` left every other folder served.
- D129. `endHoldSec` leaves the `lerp` of video §3.3. A stored `lerp(.6, 2, x)` read the editor's day back exactly, from `world.json`, `spec.json` and the default snapshot: the class of leak D64 removed. It now takes four values, on bands the title card and the guide already show (x < .3, < .5, < .75). `shots` still narrows x to a band, about .2 wide on the median cut of seed 7 and narrower on a few: that is what a decision in a file costs, and it is recorded for S14, not fixed here.
- D130. The late rise of the book stays in the film and leaves the score: only x ≥ .75 enters `productSec`, as video §3.3 always said. Counting it paid the early guide to every middling editor. Voiced craft by editor on seed 7, HEAD, then with the late rise scored, then this rule: x .45 71,3, 91,6, 84,0; x .7 89,7, 96,9, 89,1; x .9 98,3, 98,2, 98,2. Any kinetic hook lands on its guide, `Timeline.plain` alone goes without: render only, derived from the plan.
- D131. `renderKey` holds neither the price nor a card's stars and name, and a new key deletes the file. A price test flips the price daily (9 changes on one guide in 45 days of seed 7), and compaction lets reviews and customers go: both would delete the master of a running ad and render it again. A card counts by its quote. A film keeps the price it was made with until something else renders it again.
- D132. The whole-cycle road of `talent-league.test.ts` moves from seed 7 to seed 8, assertions unchanged. It pins a road through a real firing, and what a cut holds moves that road: seed 7 now lays the agent off on an idle role before any plan fails. Seven of 16 other seeds fire on the same rules, so the firing itself is alive.
- D133. Guide pages, pdf §6.1, §6.3, §8.2: no body page ends under 0.6, past a close on tiles or notes that counts at half weight, sheets included. Openers draw eight poses of one drawing. A drawn `step_path` replaces the step list only when every step stands whole on a station. The `brush` hero of pdf §6.2 is drawn, a ninth `DrawnMotif`, so a painting guide is no longer illustrated by houses.
- D134. The light views of the stream drop `Product.files.previews` from a card: no tab reads them, the shop and GET /api/product do. It pays for the larger creatives of a polished company, so `LIVE_TIGHT_LIMITS` keep their 15 messages and 2 days of ad rows: a window of one day holds nothing until the market closes at tick 10.
- D135. The page proof keeps moving at rest. The step back of the last list (V2-B) stopped the camera dead once the push passed the fit: still for 2 s or more on 32 of 76 proofs, 6 s or more on 10, frozen 1,97 s on the MP4 of cre_3202 at 1:1. Past the step back the page pushes on at 0,75 % a second to +6 %, into the margin down to 20 px: type never shrinks, the mark stays whole. The same film holds no freeze of 0,8 s now, against 4. The step back starts at `min(sweep end, beat end − 0,4 s)`, because 15 of 76 beats leave under 0,4 s after the sweep; a guide with a real column's width tests it. Measured rest: median 31,1 px, minimum 29,2 px, 9 of 76 under 30 px, read from the page's own draw width. The 35,3 px of the first census counted a tilted box's height and is wrong.
- D136. A hook's screen says what its voice says, on two more cases than the list named. A quoted line behind a figure opens its own screen with both marks: `wordsOf` keeps a closing mark on its word and never an opening one, so « 5 ERREURS QUI ENTRETIENNENT BÉBÉ SE RÉVEILLE… » read as broken French on 4 of 125 hooks. A voice cut at « Avant » keeps the written Après on its one screen, lit on the last word said: tightening keeps a scene's first sentence, so 6 of 8 before/after hooks, all craft 82 to 91, told the problem half alone. That screen runs 10 to 14 words, past the 9 of video §4.2, on purpose: the whole story, whole on frame 1, and it stays render only. A one-letter drop cap is no chapter numeral (V2-A): the filter keys on one letter alone, not on `length >= 2`, since the bonus chapter's numeral is « + ».
- D137. A card's name goes to the first buyer who wrote the sentence, by day then by the number of the id, never by a string's order. Dropping the name of every sentence two buyers signed (Q-3 as listed) left 0 of 58 cards named at D90 on seed 42. First signer, D90: seed 42 27/58 for all ads rebuilt, 29/58 as each ad was made; seed 11 4/39 rebuilt, 13/38 as made; D45 on seeds 3, 7, 11, 13, 42: 50 of 58. No sentence carries two names. It needs `reviewsOf` to match on `reviewBasis`: since D93 ads quote the basis, and 878f021 named 0 of 31 cards. A later buyer takes no name back from a made film, so the two ratios of one ad agree until compaction lets the first signer go, the risk D131 accepts. The real cure is a larger pool in `sim/feedback.ts`: held back, it changes the world and the golden may not move here.
- D138. D3 stays, and it enters the score: `coverAudit` measures the title the cover really prints, so no honest fix keeps the market still. « La peur que bébé… » reads 76 to 81,5 on seed 7, 70,2 to 75,8 on seed 42. Golden unchanged does not mean world unchanged: it is a legacy company of 25 days. Numbers in BALANCE.md, S14 calibrates on this market. `fitDisplay` tries wider measures before it gives a size up, or « Enfants difficiles à table » would fall from 62 to 41 pt on one line, under the 13 px of pdf §12. A wider measure that only sends a word alone to the last line is no answer. Over 936 real cases: 0 stranded, worst drop 8 sizes.
- D139. What a frame cuts. An arch's two doors never wear the page's ink: D6's swap only moved the mark to the rim, on 16 arches with a line of ground across both legs. Rim and door are the two strongest inks left: door on ground 2,93:1 or more, rim on ground 1,85:1 or more, on 15 palettes. 0 of 62 arches on seeds 3, 7, 13, 42, 0 of 57 on seed 12. A star clears the frame by 1,5 pt, every draw kept. `FOCUS.sun` is [0.445, 0.33], a rising sun cut by the foot and the right edge, with no hill: the list's [0.5, 0.41] left ray lines at both edges, the builder's [0.465, 0.4] parked the disc 0,37 pt from the frame, the check's [0.48, 0.385] shows ray slivers of 5 pt. The test now reads both sides of an edge: a big shape clears a frame or leaves it by 2 pt, the sun's disc by a tenth of a unit. Chart, coin, home and paw close-ups sit between 2 and 10 pt: seen clean by eye, left alone.
- D140. Sheets. `gridWidths` measures a row label in the face that prints it: the signal voice's sheet broke « Mercre/di » on a paying reader's page. It widens that first column on every sheet, and no world moved through D60 on seeds 7, 11, 42. A plan to tick reaches 45 % of the body (N2), and its boxes stay at the natural height of a row, beside the words they tick.
- D141. `Activity.at`, `ChatMessage.at`, `createdAt` and `bytes` stay wall clock: replays are byte-identical under the `decisions()` filter of A4 and A5, not in the raw file. Two replays of seed 3 differ in 602 fields of `world.json`: `runId`, `createdAt`, 600 `activity[].at`. No code in `runtime`, `sim`, `minds` or `learning` reads them. The web needs them: `takeFresh` measures an age against the wall clock so that a reloaded page does not replay old bubbles. A stamp of the simulated time would break that, and old saves with it, for no decision. The vault's cache clock changes when an index rebuilds, not what it holds.
- D142. Acceptance tools. A5 flat has no single road for its row: over seeds 1-16, 75 days, forced low, only failing companies lay off, and they never put money on 3 channels. So flat takes two roads: seed 12, 35 days, 3 channels that spend, and seed 11, 50 days, a layoff on 2. `expectFullCompany` counts channels with spend, not open accounts. `autonomy.ts` reads « logged reason » as any log line other than « confiée à », « hires without a call » as hires above 0 and no task awaiting the founder, « no constant 31 » as no seed at 31 on D60. The 30-seed verdicts stay with S15, on the calibrated company. Seeds 3, 5, 10, 13 end 85 days with 0 hires, 1 channel, at most 192 €: for S14, not a code bug.
- D143. The rest of the last list, as it shipped. Slides reveal at 6 words a second with their own constant, `readingSec` and `estSec` unmoved; the test that pinned 2,6 words a second changed on purpose. An opening slide caps at 240 px. A light primary (luminance .22 or more: Pêche tendre, Corail vitalité, Coucher de soleil) takes `dark` and `dark2` from `inks.ink`; the plate's digit walks toward that ink, since `ensureContrast` against the foot lost it at the top. Dark primaries keep their pill under 3:1 on the plate, Nuit douce 1,53:1: polish, the label reads. `items` of a pain bubble changes in the world (Q-1) and feeds no score. A figure stays with its unit on a plate. A pin's hook stops above its button: on 1:1 its last line lay under the pill, and QA reads text boxes, not what covers them. `bare()` keeps a mark answered inside the text and strips only the spare ones. `RENDER_VERSION` 6 renders every cached film again. Masters reach 8,7 MB, under QA's 12 and over the 5 of §14, which video.md now says. The golden did not move on any of this, and the 20 mutations of the gate's own fixes are caught by their tests.
