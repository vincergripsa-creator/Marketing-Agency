# Pillar: multi-channel acquisition

Spec for the V1 of the agency. Read-only design, nothing in the repo was touched. English for the spec, French for every string a viewer or agent reads.

## 0. Decisions in one page

| # | Decision | Why |
|---|---|---|
| D1 | **Five channels**: `tiktok`, `meta`, `youtube` (Shorts), `pinterest`, `google` (Search). Facebook and Instagram are one channel, Meta: the placement comes from the ratio (4:5 and 1:1 = feed, 9:16 = Reels). | One ad account, one auction, one budget in real life. Two channels would double the code for no decision. |
| D2 | **Google Search earns its place.** | It is the only channel that captures demand instead of creating it: billed per click, capped by query volume, no fatigue, no video. It is the channel where average and marginal ROAS diverge most (see §3.4, 2,07 average at half coverage, 1,06 on the next euros), so it is what makes the CFO's marginal logic a real decision. It turns the "bad on TikTok" niches (URSSAF, oral aide-soignante, TOEIC) into good ones, and it works with no video at all, which is a clean fallback for a machine without ffmpeg. |
| D3 | **"Absent means TikTok" everywhere.** Every new field is optional, written only for a non-TikTok row. | A TikTok-only run produces the same bytes in every existing field. Stronger than "close to today". |
| D4 | **Until the first `open_channel` task, a full run is byte-identical to a TikTok-only run.** No id, no draw, no task before that day. | It is a property one test can check, and it is what makes "TikTok stays comparable" true by construction. |
| D5 | **Every new draw has its own stream**, and `DAY_PHASES` is not touched. | `rollEvents` draws from `streamRng(dayKey, DAY_PHASES.length)`: one more phase in that array silently reshuffles every event of every run. New phases run outside the array on `CHANNEL_STREAM` keys. |
| D6 | **Over-claiming is emergent, not a constant.** A platform claims a sale when its ad touched the buyer, whichever channel got the click. One channel open: claims equal the shop, to the cent. | No fudge factor, and TikTok-only needs no special case. |
| D7 | **Attribution has two readings** since Step 4 (D149): platform claims (too high) and shop last click (right total, wrong split, favours Search and retargeting). Decisions read the shop. The third, reconciled (split recomputed, total forced to the shop), won 10/30 with a median of 0 € against last click: `claimWeight` 0, every credit is 1. | Last click and claims each cause a real, measurable wrong decision, because the cross-channel effect is real in the market (§4). |
| D8 | **The CFO splits the envelope by average ROAS** since Step 4 (D149). Water-filling on fitted marginal ROAS, floor 1,15, won 5/30 with a median of -484 € against it, and stays as the control `marginal_roas`, to try again on real data. | Guardrails stay: adCap is a ceiling, ±30 % a day per line, stop-loss per channel. |
| D9 | **A mechanic that cannot beat its paired control on 30 seeds is removed, not tuned.** | Nothing cosmetic. Six controls exist for that (§12). |
| D10 | New constants live in `server/src/sim/channelBalance.ts` (market, hidden) and `server/src/runtime/channelPolicy.ts` (company rules). `balance.ts` is not touched. | The final calibration reaches them through `applyOverrides`. |

Status of the numbers: the channel economics below come from arithmetic on the real catalog and on four real 60-day runs, not from a simulation of the new code. They are a starting point for the one bounded calibration of §12.

## 1. What I measured

**TikTok today** (4 full `normal` runs, seeds 111-114, 60 days, read from their `world.json`):

| | Seed 111 | 112 | 113 | 114 |
|---|---|---|---|---|
| Ad spend | 3 744 € | 5 637 € | 4 263 € | 1 707 € |
| ROAS | 1,25 | 1,38 | 1,54 | 0,83 |
| CPM | 6,12 € | 5,92 € | 4,75 € | 5,66 € |
| CTR | 2,40 % | 2,43 % | 2,47 % | 2,49 % |
| CPC | 0,26 € | 0,24 € | 0,19 € | 0,23 € |
| Conversion of a landing view | 1,54 % | 1,88 % | 1,53 % | 1,26 % |
| Campaigns / creatives | 34 / 126 | 19 / 100 | 24 / 123 | 31 / 82 |

Daily spend climbs from 15 € to 100-300 €. At that level one niche already saturates: pool = 120 + 450 × demand ≈ 480 landing views a day at demand 0,8, and 850 views a day in one niche sells like 400. **That cap is why channels scale the agency**: they add room, not better prices. On a same-size budget the best channel is only 7 % better than TikTok on average (arithmetic below). The gain is in the second 200 € of the day.

**Channel economics at day-60-like creative quality** (fit table of §3.2, ROAS at sweet price, no variation):

| Niche | TikTok | Meta | YouTube | Pinterest | Search (50 % coverage) | Search € at 50 % / 100 % |
|---|---|---|---|---|---|---|
| sommeil-bebe | 1,15 | **1,26** | 0,68 | 0,66 | 2,07 | 13 / 47 |
| dme-diversification | 0,96 | **1,03** | 0,59 | 0,85 | 1,90 | 4 / 14 |
| proprete-chiot | **1,36** | 1,21 | 1,02 | 0,64 | 2,21 | 7 / 25 |
| chat-griffe-canape | **0,73** | 0,54 | 0,42 | 0,35 | 1,07 | 3 / 10 |
| oral-aide-soignante | 1,51 | **1,59** | 1,18 | 0,71 | 3,16 | 4 / 13 |
| urssaf-micro | **1,21** | 1,13 | 0,94 | 0,52 | 1,81 | 22 / 79 |
| freelance-linkedin | **0,63** | 0,55 | 0,49 | 0,32 | 0,75 | 11 / 39 |
| potager-balcon | 0,99 | 1,01 | 0,86 | **1,12** | 1,99 | 3 / 9 |
| ventre-apres-40 | **0,69** | 0,65 | 0,39 | 0,50 | 0,82 | 18 / 63 |
| toeic-800 | 0,81 | 0,59 | **0,90** | 0,43 | 1,53 | 8 / 30 |
| batch-cooking-budget | 0,54 | 0,41 | 0,35 | **0,55** | 1,12 | 3 / 10 |
| mariage-moins-10k | 1,23 | 1,19 | 0,77 | **1,48** | 2,04 | 4 / 14 |
| revendre-vinted | **0,59** | 0,42 | 0,40 | 0,27 | 0,88 | 4 / 14 |
| japon-petit-budget | **0,80** | 0,68 | 0,78 | 0,77 | 1,49 | 4 / 13 |
| stress-bac | **0,71** | 0,34 | 0,47 | 0,29 | 0,86 | 2 / 8 |
| relooker-meuble | 1,36 | 1,21 | 1,09 | **1,50** | 2,42 | 2 / 7 |

Bold = best scaling channel. With ±25 % seeded variation on fit (1 000 draws per niche), the best scaling channel is TikTok 53 %, Meta 22 %, Pinterest 19 %, YouTube 7 %. It is not TikTok in 47 % of (niche, seed) pairs, and it flips inside a niche (japon: TikTok 38, YouTube 31, Pinterest 28). The traps stay traps on every scaling channel (vinted, chat-griffe, stress-bac). No static table can win: the agency has to discover it.

**Compliance rules tried on real heuristic ad text** (8 hooks per niche through the real `writeAdHooks` and `writeAd`, hook and scenes, without the caption). My first draft of the Meta rule fired on nothing: the writer never says « tu es en surpoids ». Rewritten against the real text:

| Rule | Fires on |
|---|---|
| `meta.image_du_corps` | ventre-apres-40 8/8, stress-bac 1/8 |
| `meta.detresse` | sommeil-bebe 4/8 |
| `pinterest.perte_de_poids` | ventre-apres-40 8/8, stress-bac 1/8 |
| `google.marque` (on full text, headlines will be narrower) | urssaf-micro 16/16, toeic-800 16/16 |
| `google.superlatif` | 2/16 in 6 niches (« L'erreur n°1 ») |
| income regex | 0: a safety net, not a mechanic |

The other niches pass. So rejections land where the catalog says the minefields are, and sommeil-bebe gets real friction that can be learned.

## 2. Exact type changes

### 2.1 `shared/channels.ts` (new, public facts the UI and agents may read)

```ts
import type { AdFormat, AdRatio } from './types.js';

export type ChannelId = 'tiktok' | 'meta' | 'youtube' | 'pinterest' | 'google';
export const CHANNEL_IDS: readonly ChannelId[] = ['tiktok', 'meta', 'youtube', 'pinterest', 'google'];

/** Ad accounts: YouTube and Search share Google's, as in real life. A Google ban stops both. */
export type AdAccountId = 'tiktok' | 'meta' | 'google' | 'pinterest';

export interface ChannelPublic {
  id: ChannelId;
  label: string;                  // 'TikTok', 'Meta', 'YouTube Shorts', 'Pinterest', 'Google Search'
  account: AdAccountId;
  buying: 'cpm' | 'cpc';
  minDailyBudget: number;
  accepts: { format: AdFormat; ratio: AdRatio; fit: number }[]; // fit: public best-practice CTR factor of that ratio
  organic: boolean;
  learning: { events: number; days: number } | null;
  stopLossSpend: number;
  testDays: number;
  verificationDays: number;       // account review before the first campaign
}
export const CHANNELS: Record<ChannelId, ChannelPublic>;
export const channelOf = (x: { channel?: ChannelId }): ChannelId => x.channel ?? 'tiktok';
export function acceptance(ch: ChannelId, c: { format: AdFormat; ratio?: AdRatio }): number | null; // ratio factor, null = refused
```

| | tiktok | meta | youtube | pinterest | google |
|---|---|---|---|---|---|
| buying | cpm | cpm | cpm | cpm | cpc |
| minDailyBudget | 5 € | 12 € | 8 € | 6 € | 6 € |
| Accepted | 9:16 video, carousel | 4:5 (1), 1:1 (0,95), 9:16 (0,85): video, carousel, static | 9:16 video only | 2:3 static (1), 2:3 carousel (0,9), 9:16 video (0,7) | `search_text` |
| Organic | yes, as today | Reels, weak | Shorts, long tail | pins, compounding | no |
| Learning phase | none | 12 sales or 7 days | none | 6 sales or 5 days | 8 sales or 5 days |
| stopLossSpend | 25 € | 45 € | 30 € | 30 € | 25 € |
| testDays | 3 | 5 | 3 | 4 | 3 |
| verificationDays | 0 | 3 | 1 | 1 | 2 |

### 2.2 `shared/types.ts` diffs

```ts
// AdFormat: two added, the four TikTok ones keep their meaning. AD_FORMATS (bandit arms) stays the four.
export type AdFormat = 'faceless_voiceover' | 'text_slideshow' | 'ugc_avatar' | 'carousel' | 'static_image' | 'search_text';
export type AdRatio = '9:16' | '4:5' | '1:1' | '2:3' | 'text';

export interface ChannelReview { status: 'pending' | 'approved' | 'rejected'; reason: string | null; day: number | null; rule?: string }

export interface AdCreative {
  // …unchanged, `review` stays the TikTok moderation of a master…
  ratio?: AdRatio;                 // absent = '9:16'
  masterId?: string | null;        // the creative this one is a cut of: same script, another ratio. Fatigue is shared by the family.
  channelReviews?: Partial<Record<ChannelId, ChannelReview>>; // every channel but TikTok
  search?: { headlines: string[]; descriptions: string[]; keywords: string[] }; // format 'search_text' only
}

export interface Campaign {
  // …unchanged…
  channel?: ChannelId;             // absent = 'tiktok'
  audience?: 'cold' | 'retarget';  // absent = 'cold'. Retarget: Meta only in V1
  learning?: { events: number; exitedDay: number | null }; // channels with a learning phase
  test?: boolean;                  // paid by the test envelope, left alone by the allocator until its verdict
}

export interface CampaignInputShape { /* … */ channel?: ChannelId; audience?: 'cold' | 'retarget'; test?: boolean }

export interface DailyAdStats {
  // `purchases`, `revenue`, `roas` keep their meaning: what the SHOP attributes to this campaign (last click).
  channel?: ChannelId;
  audience?: 'retarget';
  claimedPurchases?: number;       // what the platform's dashboard says it sold; absent = same as purchases
  claimedRevenue?: number;
  tail?: true;                     // free clicks of a paid pin: no spend that day
}

export interface OrganicPost { /* … */ channel?: ChannelId; tailViews?: number; tailDone?: boolean }
export interface Order { /* … */ channel?: ChannelId }   // last click, observable, never hidden truth
export interface InboxMessage { channel: 'email' | 'commentaire_tiktok' | 'commentaire_pub' | 'avis' | 'dm'; /* … */ }

export type WorldEventKind = /* … */ | 'channel_opened' | 'channel_cpm_spike' | 'channel_account_banned';

export interface ChannelDayKpi {
  spend: number;                   // Σ ledger ad_spend of the channel's campaigns; Σ over channels = DailyKpi.adSpend to the cent
  impressions: number; clicks: number; landingViews: number;
  shopSales: number; shopRevenue: number;       // Σ over channels = the day's ad orders
  claimedSales: number; claimedRevenue: number; // Σ ≥ shop, what the dashboards add up to
  reconciledRevenue: number;       // Σ over channels = Σ shopRevenue
  roas: number;                    // reconciledRevenue / spend
}
export interface DailyKpi { /* …unchanged, roas stays shop revenue / spend… */ channels?: Partial<Record<ChannelId, ChannelDayKpi>> }
//   written only on a day with rows on 2 channels or more

/** Hidden market truth for one (niche, channel). Never in a snapshot, except god mode. */
export interface ChannelCell {
  fit: number;                     // 0..1 audience fit, role of tiktokAffinity
  cpmMult: number;                 // × n.cpmBase
  intent: number;                  // CVR multiplier of a landing view
  poolShare: number;               // this channel's daily buyer pool / the niche's pool
  searchClicksPerDemand?: number;  // google: full-coverage clicks a day at demand 1
  cpcBase?: number;                // google
}
export interface NicheTruth { /* … */ channels?: Partial<Record<Exclude<ChannelId, 'tiktok'>, ChannelCell>> } // TikTok keeps tiktokAffinity and cpmBase

export interface ChannelAccountState { strikes: number; banned: boolean; bannedUntilDay: number; openDay: number | null } // null = never requested

export interface ChannelMarketState {
  accounts: Record<'meta' | 'google' | 'pinterest', ChannelAccountState>;  // adAccount stays TikTok's
  impressions: Partial<Record<Exclude<ChannelId, 'tiktok'>, Record<string, number>>>; // by creative family; TikTok keeps creativeImpressions
  warm: Record<string, number>;          // nicheId → stock of paid exposures (§4.1)
  visitors: Record<string, number[]>;    // productId → non-buyers per day, newest first, 14 days (§4.2)
  cpm: Partial<Record<ChannelId, { multiplier: number; untilDay: number }>>;
}
export interface MarketState { /* … */ channels?: ChannelMarketState }

export type ChannelLineStatus = 'untested' | 'testing' | 'proven' | 'killed' | 'blocked';
export interface ChannelNicheState {
  channel: ChannelId; nicheId: string; status: ChannelLineStatus; since: number;
  spend: number; revenue: number;  // reconciled, since `since`
  reason: string | null;           // French, why killed or blocked
  retestDay: number | null;
}
export interface ChannelPlanLine {
  channel: ChannelId; productId: string; audience: 'cold' | 'retarget'; campaignIds: string[];
  budget: number; target: number;
  average: number | null; marginal: number | null; elasticity: number | null; days: number;
  note: string;                    // French, read in the feed and the UI
}
export interface ChannelPlan {
  day: number; envelope: number; testEnvelope: number;
  lambda: number | null;           // null under the average rule; `marginal_roas`: the marginal ROAS every optimised line is brought to
  unspent: number;                 // envelope nobody earned: the signal for the scale pillar
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
  open: ChannelId[];               // ['tiktok'] at the start, in opening order
  requested: Partial<Record<ChannelId, number>>; // day of the request
  lines: ChannelNicheState[];
  plan: ChannelPlan | null;
  attribution: AttributionReport | null;
}
export interface CompanyState { /* … */ channels?: ChannelBook }

export type ChannelControl = 'none' | 'tiktok_only' | 'marginal_roas' | 'last_click';
export interface ScenarioConfig { /* … */ channelControl?: ChannelControl } // benchmark arm, not offered in the UI

export type TaskKind = /* … */ | 'open_channel' | 'adapt_creative' | 'write_search_ads' | 'reconcile_channels' | 'allocate_channels';
export type ToolName = /* … */ | 'ads.channels' | 'ads.report';

export interface FounderHold { /* … */ channel?: ChannelId | null } // « coupe Meta »

export interface CompanySnapshot { market: { /* … */ channelAccounts?: Record<AdAccountId, ChannelAccountState> } }
// godMode.niches gains `channels`. CompanyState.channels goes to the UI as is: it is the company's own knowledge.
```

Old saves: `ensureChannelMarket(world)` and `ensureChannelBook(world)`, called in the `Company` constructor next to `world.memory ??=`, deterministic from the seed.

### 2.3 `server/src/contracts.ts` diffs

```ts
export interface AdReviewResult { status: 'approved' | 'rejected'; reason: string | null; strike: boolean; rule?: string; channel?: ChannelId }

export interface ChannelSignal {
  channel: ChannelId;
  audience: number;               // 0..100, noisy: what Pinterest Trends or an audience planner would say
  costHint: 'bas' | 'moyen' | 'élevé';
  searchClicks?: number; cpc?: number; // google: Keyword Planner, ±30 %
}
export interface PlatformReportRow { day: number; channel: ChannelId; campaignId: string; spend: number; claimedPurchases: number; claimedRevenue: number }
export interface ShopAttributionRow { day: number; channel: ChannelId; campaignId: string | null; sales: number; revenue: number }
export interface ChannelAccountStatus { id: ChannelId; state: 'closed' | 'verifying' | 'open' | 'banned'; openDay: number | null; strikes: number; bannedUntilDay: number }

export interface MarketTools {
  // …unchanged names, optional `channel` defaulting to TikTok, so every existing call keeps working…
  submitCreative(creativeId: string, channel?: ChannelId): AdReviewResult;
  getAdStats(sinceDay?: number, channel?: ChannelId): DailyAdStats[];
  postOrganic(input: { productId: string | null; hook: string; hookStyle: HookStyle; format: AdFormat; channel?: ChannelId }): ToolResult;
  // new
  channelStatus(): ChannelAccountStatus[];
  requestChannel(channel: ChannelId): ToolResult;   // starts verificationDays
  channelSignals(nicheId: string): ChannelSignal[];
  getPlatformReport(channel: ChannelId, sinceDay?: number): PlatformReportRow[]; // the ad manager
  getShopAttribution(sinceDay?: number): ShopAttributionRow[];                   // the shop's own orders
}

/** Phase 3: one adapter per platform. V1: five virtualAdapter(id). */
export interface ChannelAdapter {
  readonly id: ChannelId;
  review(creativeId: string): AdReviewResult;
  createCampaign(input: CampaignInputShape): ToolResult;
  updateCampaign(campaignId: string, patch: { dailyBudget?: number; status?: 'active' | 'paused'; creativeIds?: string[] }): ToolResult;
  report(sinceDay?: number): PlatformReportRow[];
  post?(input: { productId: string | null; hook: string; hookStyle: HookStyle; format: AdFormat }): ToolResult;
}

export interface SearchAdDraft { headlines: string[]; descriptions: string[]; keywords: string[] } // 3-5 titles ≤ 30 chars, 2 descriptions ≤ 90
// ContentEngine: writeSearchAd(input: { product: Product; voc: VoiceOfCustomer; bannedClaims: string[] }, ctx: MindContext): Promise<SearchAdDraft>;
// writeAd accepts format 'static_image' and answers one scene.
```

Real-world mapping of `ChannelAdapter`: TikTok Marketing API, Meta Marketing API, Google Ads API (one adapter class, two ids), Pinterest Ads API; `getShopAttribution` = UTM on the shop's orders; `getPlatformReport` = each API's reporting endpoint; `channelSignals` = Keyword Planner, Pinterest Trends, audience estimates. `founderApproval: true` and the two `verificationDays` map to real account reviews. Nothing in V1 touches them.

## 3. The market model

### 3.1 New streams

```ts
// channelBalance.ts
export const CHANNEL_STREAM = { truth: 0xc4a701, ads: 1001, organic: 1002, tails: 1003, claims: 1004, events: 1005, comments: 1006, signals: 1007, reviews: 1008 } as const;
```

`Day` gains `dayKey` (the value `tickMarket` already draws). `DAY_PHASES` keeps its 11 entries. The new steps are plain calls, each on `streamRng(d.dayKey, CHANNEL_STREAM.x)`:
- `runPaidTails` at the end of `runAds`, and `runChannelOrganic` at the end of `runOrganic`: their traffic must reach `runSales` the same day;
- `runClaims`, `updateWarmth`, `recordVisitors` and `rollChannelEvents` after `DAY_PHASES.forEach`, before `rollEvents`.

None of them assigns `d.rng`. Search reads yesterday's `warm`, so the order inside `runAds` does not matter.

Where each draw goes:

| Draw | Stream |
|---|---|
| Cells at creation or reload | `streamRng(seed, truth, nicheIndex)`, never the `createMarketState` rng |
| A non-TikTok campaign's delivery | `d.focus(key, index)`, unique by campaign, as today |
| Learning and retarget extras | `streamRng(key, index, 7)` |
| A non-TikTok ad's comments turned into messages (`runInbox` c) | `streamRng(d.dayKey, comments, rowIndex)`, so follow-ups in (d) do not shift |
| Moderation of a non-TikTok creative | `streamRng(seed, reviews, day, idNum(creative))` inside `submitCreative` |
| Channel signals | `streamRng(seed, signals, day, nicheIndex)` |
| Company decisions | `RuntimeCtx.channelRng`, `STREAM.channels: 5` in `company.ts`, rebuilt in `drawTick` |

### 3.2 Hidden truth

`channelBalance.ts` holds the authored table; `ensureChannelMarket` draws the cells.

```ts
export const CHANNEL_VARIATION = { fit: 0.25, cost: 0.15, intent: 0.15 };

export const CHANNEL_SIM = {
  meta:      { cpmMult: 1.40, ctrScale: 0.62, intent: 2.10, landingRate: 0.80, fatigue: 110_000, pool: 1.3, overlap: 0.35, affinityExp: 1.6, falsePositive: 0.20, strikes: 3, banDays: 14 },
  youtube:   { cpmMult: 0.62, ctrScale: 0.50, intent: 1.15, landingRate: 0.72, fatigue:  90_000, pool: 0.7, overlap: 0.30, affinityExp: 2.0, falsePositive: 0.06, strikes: 2, banDays: 7 },
  pinterest: { cpmMult: 0.70, ctrScale: 0.45, intent: 1.20, landingRate: 0.90, fatigue: 240_000, pool: 0.8, overlap: 0.15, affinityExp: 0.8, falsePositive: 0.08, strikes: 3, banDays: 10 },
};
export const FORMAT_FIT = {
  meta: { carousel: 1.15, ugc_avatar: 1.1, static_image: 1, faceless_voiceover: 0.95, text_slideshow: 0.9 },
  youtube: { faceless_voiceover: 1.15, ugc_avatar: 1, text_slideshow: 0.8 },
  pinterest: { static_image: 1, carousel: 0.9, faceless_voiceover: 0.7, text_slideshow: 0.7 },
};
```

Cell from the table:

```
fit       = clamp(CHANNEL_FIT[n.id][ch] × vary(0.25), 0.05, 1)
cpmMult   = spec.cpmMult × vary(0.15)
intent    = spec.intent × (0.7 + 0.6 × fit) × vary(0.15)      // a fitting audience also buys better
poolShare = spec.pool × (0.5 + fit)
```

Authored fit (`[meta, youtube, pinterest, google]`), plus Search volume at demand 1 and CPC:

| Niche | Meta | YouTube | Pinterest | Google | clicks | CPC € |
|---|---|---|---|---|---|---|
| sommeil-bebe | .85 | .45 | .40 | .80 | 70 | .55 |
| dme-diversification | .80 | .45 | .70 | .60 | 35 | .45 |
| proprete-chiot | .70 | .65 | .30 | .75 | 55 | .50 |
| chat-griffe-canape | .60 | .50 | .35 | .55 | 35 | .40 |
| oral-aide-soignante | .70 | .55 | .20 | .85 | 45 | .45 |
| urssaf-micro | .60 | .55 | .15 | .95 | 90 | .90 |
| freelance-linkedin | .50 | .50 | .20 | .50 | 35 | 1.40 |
| potager-balcon | .75 | .70 | .90 | .55 | 35 | .35 |
| ventre-apres-40 | .75 | .45 | .60 | .60 | 45 | 1.10 |
| toeic-800 | .40 | .80 | .25 | .85 | 50 | .70 |
| batch-cooking-budget | .60 | .55 | .90 | .45 | 30 | .35 |
| mariage-moins-10k | .70 | .45 | .95 | .65 | 40 | .60 |
| revendre-vinted | .55 | .60 | .30 | .45 | 25 | .50 |
| japon-petit-budget | .60 | .80 | .75 | .65 | 35 | .55 |
| stress-bac | .30 | .60 | .25 | .40 | 25 | .40 |
| relooker-meuble | .70 | .70 | .95 | .45 | 30 | .35 |

`CHANNEL_FIT_DEFAULT = [.5, .5, .4, .5]`, 35 clicks, .6 € for a niche added later.

### 3.3 `runAds`: one loop, no fork

`runAds` keeps its `key`, its loop and its draw order. What changes:

```ts
const ch = channelOf(camp);
const spec = deliverySpec(n, ch);          // for TikTok returns exactly the ADS values and n.cpmBase / n.tiktokAffinity
if (accountBanned(m, ch, d.day)) { blocked++; continue; }
...
if (CHANNELS[ch].buying === 'cpc') { deliverSearch(d, camp, c, n, spendTotal, rng); continue; }
if (camp.audience === 'retarget') wanted = Math.min(wanted, retargetCap(d, camp, n));
const cpm = Math.max(ADS.minCpm, spec.cpmBase * diff.cpmMultiplier * eventCpm(ch) * dowCpm * narrow * spec.learningCpm * d.noise(ADS.cpmNoiseSd));
const prior = familyPrior(m, c, ch);       // own channel + 0.25 × the family's impressions elsewhere
const fatigue = 1 / (1 + prior / spec.fatigue);
const ctrRaw = ADS.baseCtr * Math.pow(Math.max(1, q.overall) / ADS.qualityRef, ADS.qualityExp)
  * Math.pow((n.hookAffinity[c.hookStyle] ?? 1) * spec.formatFit(c), spec.affinityExp) * (0.6 + 0.8 * spec.fit)
  * spec.ctrScale * spec.ratioFit(c) * spec.learningCtr * fatigue * d.noise(ADS.ctrNoiseSd);
```

For TikTok: `spec.formatFit(c) = n.formatAffinity[c.format] ?? 1`, `ctrScale`, `ratioFit`, `learningCtr`, `learningCpm` are 1, so the expression is today's, in the same draw order. On other channels `formatFit` is `(n.formatAffinity[c.format] ?? 1) × FORMAT_FIT[ch][c.format]`. `eventCpm('tiktok')` stays `modifiers.cpmMultiplier`.

Frequency: `1 + (prior + impressions) / (reach × poolShare)`. Same thresholds in `optimize_ads`.

Ledger: `TikTok Ads — …` keeps its memo; others use `${label} Ads — …` with the same `ref: camp.id`. One line per campaign per day, so the ledger stays the only source of money, and the channel of a line is the channel of its campaign.

**Learning phase.** While `camp.learning.exitedDay === null` on a channel with a learning phase: CTR × 0,85, CPM × 1,10 (about -23 % ROAS). Exit at `learning.events` sales or `learning.days` days. `updateCampaign` resets it on a budget raise over 30 % or a change of creatives. Consequence: small split budgets stay in learning longer, and the allocator's +30 % cap is the real platform rule as well as a guardrail.

**Refusals in `createCampaign`:** `acceptance(ch, creative) === null` drops the creative; with none left the tool answers « Aucune créa acceptée par ${label} : il faut du ${ratio} ». Budget under `minDailyBudget` is refused. A closed or verifying channel is refused with its opening day.

### 3.4 Search: `deliverSearch`

```ts
export const SEARCH = { baseCtr: 0.05, cpc: { min: 0.55, span: 1.1, exp: 1.5 }, qualityCpcExp: 0.5, fitReach: { min: 0.6, span: 0.4 }, minRelevance: 0.5, maxRelevance: 1.3 };
```

```
V(day)   = cell.searchClicksPerDemand × n.demand × dow × (0.6 + 0.4 × fit) × (1 + ASSIST.maxLift × warmth(n)) / activeSearchCampaigns(niche)
CPC(s)   = cell.cpcBase × (0.55 + 1.1 × s^1.5) × (70 / q)^0.5 × eventCpm × noise(0.12)
s        = largest share in (0, 1] with V × s × CPC(s) ≤ budget     // bisection, 20 steps, no rng
relevance= clamp(q / 70, 0.5, 1.3)
impressions = round(V × s / (0.05 × relevance))
clicks   = binomial(impressions, 0.05 × relevance × noise(ADS.ctrNoiseSd))
spend    = min(budget, clicks × CPC(s))        // budget may stay unspent: the row shows it
```

No fatigue, `landingRate 0,92`, `intent = 2,8 × (0,7 + 0,6 × fit) × vary(0,15)`, `falsePositive 0,06`, shared Google account (strikes 2, ban 7 days). Arithmetic on the catalog: at half coverage ROAS 0,75-3,16, median 1,7; the next euros return about half that. **Search's cost ceiling is 7-79 € a day per niche**, the best small money of the day, never a scale channel. Spend cap and falling marginal are what the allocator has to discover.

### 3.5 Pools: `runSales`

Today the niche has one pool. New, computed in `runSales` after the existing loop on `d.traffic`:

```
pool(ch)  = nichePool(world, n, ch)     // scale's function; I own its `channel` argument: × (ch === 'tiktok' ? 1 : cell.poolShare)
eff(ch)   = views(ch) + overlap(ch) × Σ_{o ≠ ch} views(o)     // overlap(tiktok) = 0,3
sat(ch)   = pool(ch) × (1 − exp(−eff/pool(ch))) / eff
```

Other views at 0 give today's value exactly. TikTok organic and creator traffic stay in TikTok's pool, as today. Search and retarget traffic are excluded: Search is capped by queries, retarget by its own visitors. `const eff = Math.round(t.landingViews * satOf(t))` then the same binomial, with `t.cvrMult = cell.intent` (retarget: `× RETARGET.intent`), TikTok 1.

`Traffic` gains `channel: ChannelId`. `bySource` is keyed by `source + channel`, one ledger revenue line per pair. `SOURCE_LABEL` reads `pubs ${label}`. With TikTok alone the map, the order of the lines and the memos are today's.

Room gained at demand 0,8 and fit 0,85: TikTok 480 views, Meta 842, and each Meta view is worth 2,5 TikTok views. That is the scale.

### 3.6 Paid tail and organic

`runPaidTails(d)` (`CHANNEL_STREAM.tails`): a paid pin keeps earning. For each creative with Pinterest clicks on day t−k, free clicks = `clicks × [0.25, 0.12, 0.06][k-1] × noise(0.3)`, a row `{ spend: 0, tail: true }` and traffic on its campaign, even if paused, unless the product is off sale. No ledger line. Stop-loss adds the tail because it reads the rows.

`runChannelOrganic(d)` (`CHANNEL_STREAM.organic`). `runOrganic` skips non-TikTok posts, and its `rank` counts TikTok posts only.

```ts
export const CHANNEL_ORGANIC = {
  meta:      { medianViews: 120, sigma: 0.8, viral: 0.005, tail: [0.3, 0.1], clickRate: { min: 0.003, max: 0.008 } },
  youtube:   { medianViews: 180, sigma: 0.9, viral: 0.008, tail: [0.6, 0.4, 0.3, 0.2, 0.2, 0.15, 0.1], clickRate: { min: 0.005, max: 0.012 } },
  pinterest: { medianViews: 60,  sigma: 0.7, viral: 0,     tail: Array.from({ length: 30 }, (_, k) => 0.9 ** (k + 1)), clickRate: { min: 0.015, max: 0.03 } },
};
```

A pin is worth little on day 1 and about ten times that over a month: posting 30 days before the end is worthless, and early pins compound. That is a real decision for Tom's four daily slots. `OrganicPost.tailViews` accumulates; `views` stays day 1, so `post.views > 0` still means resolved.

### 3.7 Events

`rollChannelEvents` runs on its own stream and never touches `ROLLS`.

```ts
export const CHANNEL_EVENTS = { cpmSpike: { chance: 0.06, multiplier: 1.4, days: 3 }, drift: { chance: 0.03, down: 0.75, up: 1.25 } };
```

| Event | Chance a day | Effect |
|---|---|---|
| `channel_cpm_spike` | 0,06 × eventRate / 0,2, on one open non-TikTok channel | CPM × 1,4 for 3 days. Public. The existing `cpm_spike` stays TikTok's. |
| silent drift | 0,03 | One (open channel, niche with spend): `fit × 0,75` or `× 1,25`, for good. **No event**: the agency only sees the numbers move. |

The silent drift is why testing never ends.

## 4. Cross-channel, without faking

### 4.1 Warm audience

```ts
export const ASSIST = { decay: 0.8, weights: { tiktok: 1, meta: 1, youtube: 0.7, pinterest: 0.5 }, halfStock: 0.5, maxLift: 0.6 };
```

```
warm[n]_t = warm[n]_{t-1} × 0.8 + Σ_ch impressions_t(n, ch) × weight(ch)
warmth(n) = warm / (warm + 0.5 × reach(n))          // reach = ADS.reachBase + ADS.reachDemand × demand
```

Only Search reads it: V × (1 + 0,6 × warmth). At 50 € a day of TikTok in a niche (8 300 impressions), stock 41 500, warmth 0,38, Search volume +23 %. Cut the TikTok line and Search shrinks within a week. So part of Search's last-click revenue was caused elsewhere, and no order carries a hidden label: incrementality is the shape of the market. Nothing reads `warm` in a TikTok-only run.

### 4.2 Retargeting

```ts
export const RETARGET = { minVisitors: 300, decay: 0.9, windowDays: 14, frequencyCap: 2, cpmMult: 1.5, ctrMult: 1.8, intent: 1.8, fatigueMult: 0.25 };
```

`visitors[p]` records each day's `landingViews − purchases`, real observed people.

```
R              = Σ_k visitors[p][k] × 0.9^k
maxImpressions = R × 2
retargetCap    = maxImpressions × cpm / 1000
```

Landing views of a retarget row are subtracted from the newest days of `visitors[p]`: a person is not retargeted forever. Meta only in V1. It runs out by construction, its last-click ROAS is high, and it depends on prospecting traffic: cut the cold line and it starves. Same trap as Search, on purpose.

## 5. Attribution

### 5.1 Claims: `runClaims` (`CHANNEL_STREAM.claims`)

```ts
export const CLAIMS = { touchShare: 0.02, noiseSd: 0.25, greed: { tiktok: 0.35, meta: 0.60, youtube: 0.45, pinterest: 0.55, google: 0.10 } };
```

`greed` stands for the attribution window of each platform: Meta and Pinterest count views and long click windows, Search counts almost only its own clicks. Per niche with 2 channels or more spending today:

```
touched(ch)  = min(1, impressions(ch, niche) / (0.02 × reach(n)))
extra(ch)    = Σ_{o ≠ ch} shopRevenue(o, niche) × greed(ch) × touched(ch) × lognormal(1, 0.25)
```

`extra` is spread over that channel's rows by spend: `claimedRevenue = revenue + extra`, `claimedPurchases = purchases + round(extra / price)`. A channel with zero shop sales can still claim. With one channel open no field is written.

### 5.2 Reconciliation: `learning/attribution.ts`

Switched off by Step 4 (D149): `claimWeight` is 0, so reconciled revenue is the shop's and every credit is exactly 1. The machinery stays, it writes what the platforms claim, and the UI shows two readings.

```ts
export const RECON = { claimWeight: 0, windowDays: 14, minNicheRevenue: 30, staleDays: 4, creditMin: 0.4, creditMax: 2.5 };

export function reconcile(rows: DailyAdStats[]): AttributionRow[] {
  // S[ch] shop, C[ch] claimed, T = Σ S
  // blended[ch] = S[ch] + claimWeight × max(0, C[ch] − S[ch])
  // reconciled[ch] = T × blended[ch] / Σ blended
  // credit[ch] = (reconciled[ch] + 1) / (S[ch] + 1), clamped to [0.4, 2.5]
}
```

Σ reconciled = shop total, always. One channel: credit 1, exactly. `reconcile_channels` (Raphaël, Analyse) runs each morning once 2 channels have spent in the last 7 days. It reads only `tools.getPlatformReport` and `tools.getShopAttribution`, writes `company.channels.attribution`, the niche credits where shop revenue ≥ 30 €, and a brain note: « Meta s'attribue 1,8 fois ce que la boutique voit ».

`creditOf(world, channel, nicheId)` returns niche credit, else channel credit, else 1. **A report older than 4 days counts as 1.** `ChannelControl` override: `last_click` = 1.

The KPI side is pure: `channelDayKpi(world, day)` in `computeDailyKpi` runs the same `reconcile` on one day, so the UI always has numbers.

### 5.3 Who reads what

| Reader | Reads |
|---|---|
| `stopLossReason`, `optimize_ads` budget branch | Credit-adjusted: `adjusted(m, creditOf(…))` multiplies `revenue` and `roas` |
| Allocator, bandit, line verdicts | Credit-adjusted |
| `DailyKpi.roas`, `productMetrics.adRevenue`, P&L | Shop, unchanged (P&L stays ledger-based) |
| Hook and format bandits, experiments, `lowCtr`, `bestOf` in `heuristics.ts` | **TikTok rows only**: CTR levels differ by channel, mixing them would reward the channel, not the hook |
| `priceTiers`, `revenuePerVisitor`, price and hype rewards | Rows of the product's reference channel (most landing views in 14 days): a mix shift would otherwise look like a price effect. TikTok-only: all rows, as today |

## 6. Compliance

`compliance.ts` gains, without touching `findBannedClaims`:

```ts
export interface ChannelRule {
  id: string; label: string;       // label is public (brain note), the regex is not
  scope: 'copy' | 'headlines' | 'landing'; // copy = hook + scenes; landing also reads the product's title and problem
  strike: boolean;
  test: RegExp;                    // on norm(text); google.ponctuation runs on raw text
}
export const CHANNEL_RULES: Record<ChannelId, readonly ChannelRule[]>;
export function findChannelViolation(c: AdCreative, ch: ChannelId, product: Product): ChannelRule | null;
```

| Rule | Scope | Strike | Pattern | Real-world basis |
|---|---|---|---|---|
| `meta.image_du_corps` | copy | yes | `ventre, tour de taille, silhouette, bourrelets, kilos, poids, ménopause, cellulite` | Personal health and appearance |
| `meta.detresse` | copy | no | `je craque, zombie, j'en peux plus, burn-out, dépression, déprimée, épuisée` | Personal attributes |
| `meta.revenu`, `pinterest.revenu` | copy | yes | `\d+ € par mois/jour/semaine` | Income claims |
| `pinterest.perte_de_poids` | landing | no | `maigrir, perdre du poids, ventre, minceur, régime, kilos, silhouette, tour de taille, brûle-graisse` | Weight-loss ads are banned outright |
| `google.marque` | headlines | no | `urssaf, toeic, caf, france travail, pôle emploi, impôts` | Implied affiliation, trademark |
| `google.superlatif` | headlines + descriptions | no | `le meilleur, n°1, le seul` | Unproven superlatives |
| `google.ponctuation` | headlines | no | `!`, 6 capitals in a row | Editorial rules |
| `google.sante` | copy | yes | `guérir, soigner, traitement, thérapie, maigrir` | Health claims |

`submitCreative(id, ch)`, in this order: account check, `findBannedClaims` (same generic list, strike), `findChannelViolation`, false positive `spec.falsePositive × complianceRisk` on the `reviews` stream. A rejection fills `channelReviews[ch]` with the rule id and a French reason naming the platform, and pushes `ad_rejected`. TikTok's branch is the existing code, unchanged.

Strikes count on the account: 3 Meta strikes, 14 days. 2 Google strikes stop Search **and** YouTube.

What the company does:
- `learnFromRejection` also reads `res.rule`, adds `Sur Meta, ne jamais écrire « ventre »` to the growth writers' playbooks. A rule that names a platform binds the ads only: it reads as `platformBanned`, never as `banned`, so a guide, a kit or a lead magnet keeps the word (D156).
- After 2 rule rejections in a (channel, niche), the line goes to `blocked` with the reason, and no further creative is submitted there: ventre-apres-40 on Pinterest costs two submissions and no euro.
- `google.marque` has a real price: headlines without « URSSAF » score lower, CPC × (70/q)^0,5 rises. The writer gets the word as banned after the first rejection.
- New note `brain/politiques/Conformité pub par canal.md` carries the labels. `Budget et garde-fous.md` rule 3 gets the per-channel spend table.

Review gate in `review.ts`: `adapt_creative` and `write_search_ads` go through the same Léo review as `produce_ad`, with the French messages naming the channel.

## 7. The company

### 7.1 Unlock: a channel opens when a condition holds

`server/src/runtime/channelPolicy.ts`:

```ts
export const CHANNEL_POLICY = {
  unlock: {
    meta: { sales: 15, roas14d: 1.0 },              // TikTok proved the offer sells
    youtube: { cash: 300, masterQuality: 70 },      // an approved 9:16 worth reusing
    pinterest: { cash: 200, minRunwayDays: 21 },    // pays late
    google: { reviews: 5, rating: 4.0, pageQuality: 75 }, // landing quality
  },
  testShare: 0.2,          // of adCap
  maxTests: 3,
  retestDays: 14,
  prove: { roas: 1.1, kill: 0.8, extendOnce: true },
  lineKill: { losers: 2, spendTimes: 3, roas: 0.8 },
  channelKill: { days: 14, spend: 150, roas: 0.7, reopenDays: 14 },
  alloc: { windowDays: 10, minDays: 4, minSpendDay: 3, kappa: 1, floorRoas: 1.15, maxStep: 0.3, maxLineShare: 0.6, priorElasticity: { cpm: 0.75, cpc: 0.4, retarget: 0.35 }, trimDays: 3 },
  categoryPriorMax: 4,
} as const;
```

`unlockReason(world, ch): string | null` reads observable data only. Léo evaluates it each morning in `planChannels`. All true → a task `open_channel` (Léo): `tools.requestChannel(ch)`, `verificationDays` later the account opens, event `channel_opened`. Founder approval mode: `awaitFounder` « Ouvrir le canal Meta ».

**A channel needs its buyer.** Decision on the final `media_buyer_*` rows of `org.md`:

```ts
export const CHANNEL_ROLE: Record<ChannelId, RoleId> = {
  tiktok: 'media_buyer_tiktok',       // Adam
  meta: 'media_buyer_meta',
  youtube: 'media_buyer_google',      // replaces org's media_buyer_youtube: one buyer, one Google account
  google: 'media_buyer_google',
  pinterest: 'media_buyer_pinterest', // new row
};
```

The condition holds and `roleHolder(world, CHANNEL_ROLE[ch])` is empty: `requestRole(ctx, role, 'channel', detail)`, which keeps every money gate of `org.md`. No hire, no channel. Since the salary is a real ledger line, opening a channel has a real daily cost, which is what makes the decision worth taking. Until the org pillar lands, `roleHolder` falls back to Adam for TikTok plus one channel, and the agency stops at 2 channels, cleanly.

One `optimize_ads` task per open channel, with `input.channel`, so `org.md`'s routing gives each buyer his own campaigns and `buyerScore` means something. `itemKey` gains `input.channel`. TikTok-only: no `channel` key, today's single task.

`scenario.channelControl === 'tiktok_only'` returns before anything. **Everything below is gated by `open.length > 1`**, which is what makes D4 true.

### 7.2 Discovery: contextual bandit, small tests

Dimension `channel:${nicheId}`, arms the channels. Reused as is: `chooseArm`, `rewardArm`, `armStats`, on `ctx.channelRng`.

Context is the niche's category, so learning carries over. When a niche's arms are created:

```
catMean, catPulls = armStats(`channel_cat:${category}`)
k = min(4, catPulls / 2)
alpha = 1 + k × catMean + signal.audience / 100
beta  = 1 + k × (1 − catMean) + (1 − signal.audience / 100)
```

So the second Maison & jardin guide starts leaning to Pinterest. Rewards in `applyDailyRewards`, only when 2 channels or more are open:

```ts
for each (channel, niche) with spend ≥ 3:
  const r = clamp(roas × creditOf(…) / 3), w = clamp(spend / 20, 0.5, 3);
  rewardArm(world, `channel:${nicheId}`, channel, r, w);
  rewardArm(world, `channel_cat:${category}`, channel, r, w * 0.5);
```

`planChannels(ctx, items, notes)`, called in `buildHeuristicPlan` right after `planPaidAcquisition`:

```
for each candidate (acquisitionCandidates, no hard block), best first:
  eligible = open channels minus lines proven, killed before retestDay, blocked, or with an account ban
  if none, next
  pick = chooseArm(world, `channel:${nicheId}`, eligible ∪ {tiktok}, ctx.channelRng)
  if pick is tiktok or already tested, next
  stop at maxTests or when Σ test budgets would pass testEnvelope
  creatives missing → adapt_creative ×2 (meta, pinterest) / write_search_ads (google) / none (youtube reuses the master)
  then launch_campaign { channel, test: true } at minDailyBudget, min 8 €
```

Line verdict after `testDays` and `3 × stopLossSpend` spent, on credit-adjusted ROAS:
- ≥ 1,1 → `proven`, enters the allocator.
- < 0,8 → `killed`, `retestDay = day + 14`.
- Between → one extension, then `killed` if < 1,0.

A killed line waits for `retestDay`, unless a new version of the product or a category mean above 0,45 clears it.

The niche choice also moves: when 2 channels are open, `TrendSignal.bestChannelBuzz?: number` = best noisy `audience` over open channels, and `heuristic/research.ts` reads `s.bestChannelBuzz ?? s.tiktokBuzz`. A niche bad on TikTok and great on Pinterest gets picked once Pinterest is open.

### 7.3 Stop-loss and kill

`stopLossReason(life, recent, ch = 'tiktok')`: same three rules, same ROAS thresholds, `STOP_LOSS_SPEND` replaced by `CHANNELS[ch].stopLossSpend`, on credit-adjusted metrics. The `NO_TRACTION` branch waits for the learning phase to end on Meta, or 45 €.

- **Line kill:** 2 stopped campaigns under ROAS 1 in a (channel, niche), spend ≥ 3 × stopLossSpend, ROAS < 0,8 → `killed`.
- **Channel kill:** company-wide 14 days, spend ≥ 150 €, reconciled ROAS < 0,7 → all its campaigns paused, Léo says why, no test for 14 days. The buyer's capacity comes back.
- Bans are per account: `adBanActive(world, ch = 'tiktok')`, `companyPaidBlock(world, ch?)`. Without `ch` it blocks only if every open account is banned, so TikTok-only keeps today's text.
- `productPaidBlock(world, p, ch = 'tiktok')`: cooldowns and "ads-dead" read `adHistory(world, p.id, since, ch)`, so a guide dead on TikTok can still get its Meta test. Holds, quality gates and `recentLoss` stay product-wide. `cutLesson` applies to the channels whose rows are in its window.

### 7.4 The CFO splits by average ROAS

Step 4 fired the rule of its row: full won 5/30, median -484 €, so the allocator fell back to the average rule (D149). What follows keeps steps 1, 2, 4 and 5 as they run. Step 3 is the average split. The water-fill below it is the control `marginal_roas`, which production never reaches: `allocateChannels` runs it only when the scenario names it, so that the marginal allocator can be tried again on real data. The curve stays: `fitInto` still reads a line's next euro when the minimums do not fit, and the marginal ROAS is shown as a reading, never as the reason.

`allocate_channels` runs at the stand-up right after `budget_review` (`runImmediate`, Gabriel), once 2 channels have active campaigns. `allocateChannels(ctx): ChannelPlan` in `runtime/channels.ts`.

**1. Lines.** One line = (channel, product, audience). Window: last 10 closed days, outage days out, days with spend ≥ 3 €.
Per line: points (sₜ, rₜ), rₜ = credit × (shop revenue + tail revenue of that day).

**2. Fit R = a·s^b with shrinkage.**

```ts
function elasticity(points: { s: number; r: number }[], prior: number): { a: number; b: number } {
  const x = points.map((p) => Math.log(p.s)), y = points.map((p) => Math.log(Math.max(p.r, 0.5)));
  const mx = mean(x), my = mean(y);
  const sxy = sum(x.map((v, i) => (v - mx) * (y[i]! - my)));
  const sxx = sum(x.map((v) => (v - mx) ** 2));
  const b = clamp((sxy + 1 * prior) / (sxx + 1), 0.15, 0.95);            // kappa = 1
  const a = sum(points.map((p) => p.r)) / Math.max(1e-6, sum(points.map((p) => p.s ** b)));
  return { a, b };
}
```

The ratio estimator for `a` survives days with zero sales, where a log regression would not. Budgets that never moved give `b = prior`, which is honest. Prior: 0,75 cpm, 0,4 Search, 0,35 retarget. Average = Σr/Σs; marginal at spend s = a·b·s^(b−1). Fewer than 4 days: the line stays as it is.

**3. The average split.** `B = adCap − Σ test budgets`. A measured line's share is `B × averageᵢ / Σ average`, capped at 60 % of B, whatever its next euro earns: the money is spent and `plan.lambda` is null.

**The control `marginal_roas`, water-fill.** Bisection on λ ≥ 1,15:

```
sᵢ(λ) = (aᵢ bᵢ / λ)^(1 / (1 − bᵢ))
```

If Σ sᵢ(1,15) < B, λ = 1,15 and the rest is `unspent`. Floor 1,15 = payment fees + refunds on a 20 € guide: under it a marginal euro loses money. A line whose average still looks fine can be cut.

**4. Guardrails, in this order.** No line above 60 % of the room. Clamp each target to [0,7 × budget, 1,3 × budget]. Above `minDailyBudget` or trimmed: under it for 3 days in a row, the line is paused. Scale down pro rata if Σ > adCap. `founderCap` keeps its path through `askRaise`. `survival` and `outage` keep their rules above all this.

**5. Execution.** In `optimize_ads`, step 4 reads `planTarget(world, c)`; a campaign in no plan line keeps today's code. Stop-loss and fatigue steps run first, unchanged. Adam says one line per move: « Meta sommeil : 40 € → 52 €/jour, ROAS moyen 1,62 contre 1,18 sur TikTok ». Under the control the note reads « ROAS marginal ».

Worked example of the fill, computed before Step 4, B = 150 €: TikTok a=3,7 b=.75; Meta a=4,4 b=.8; Pinterest a=3,4 b=.7; Search a=9,9 b=.4 (its 2,07 at 13 € from §1).

| Allocation | TikTok | Meta | Pinterest | Search | Revenue |
|---|---|---|---|---|---|
| Water-filling, λ = 1,35 | 18 € | 120 € | 7 € | 6 € | 267 € |
| Proportional to average ROAS | 38 € | 50 € | 31 € | 31 € | 234 € |
| Equal split | 37,5 € | 37,5 € | 37,5 € | 37,5 € | 221 € |

On known curves the fill earns +14 % over the average rule: Search has the best average (3,38) and gets the least. The market disagreed: curves fitted on 10 noisy days cost more than the average rule loses.

The same example shows why: a small gap in b (.8 against .75) sends 80 % of the money to Meta, and b̂ is noisy. Under the control three brakes hold it: the shrinkage κ, the ±30 % a day, and `maxLineShare: 0.6` (the excess goes back into the fill). The share cap also limits what one account ban can stop, under either rule.

### 7.5 Creatives

`adapt_creative` (Chloé, 1 tick): input `{ masterId, channel, ratio }`.
- Meta: a 4:5 cut, same script, `masterId` set, new id, new files.
- Pinterest: `static_image` 2:3: `engine.writeAd({ format: 'static_image' })` gives one scene, drawn over the guide's cover.
- YouTube: no task, `submitCreative(masterId, 'youtube')`.

`write_search_ads` (Sarah, 1 tick): `engine.writeSearchAd`, stored as a creative with `format: 'search_text'`, `ratio: 'text'`, `hook = headlines[0]`, `caption = descriptions[0]`, `hashtags = keywords`, `scenes: []`.

`scoreCreative` gains two branches, new formats only: `scoreStaticAd` (hook under 60 chars, problem word, CTA, legible) and `scoreSearchAd` (keyword in title, length limits, CTA). `onDone` of both tasks calls `submitCreative(id, channel)`. `launchableCreatives(world, productId, channel = 'tiktok')` filters on `acceptance` and on the channel's review. Its "tired" test reads frequency alone on non-TikTok channels: frequency is public, the 40 000 impressions rule is TikTok's.

`requestCreatives` for a fatigued non-TikTok campaign asks a cut of the newest approved master.

### 7.6 Organic

`post_organic` input gains `channel`. In `buildHeuristicPlan`, with 2 organic channels open, slots: TikTok keeps 2 of Tom's 4; the others go by `chooseArm(world, 'organic:' + nicheId, openOrganic, ctx.channelRng)`, reward = `clamp(clicks / 30)` for each post once it is 7 days old. A horizon rule: no pin in the last 10 days of the scenario. Pinterest needs a `static_image`, YouTube and Meta reuse a master.

### 7.7 Lessons

`heuristics.ts` gains `channelLessons(inp)`:
- `Privilégier le canal « meta » sur « Niche » : ROAS boutique 1,62 contre 1,14 sur TikTok` → `PlaybookDirectives.channel`, `RX.channel`, added to `SINGLETONS`. It gives +1 alpha in the bandit, and `directiveSlot` settles contradictions as for hooks.
- `Couper « pinterest » sur « Niche » …`, on a line kill.
- `Meta s'attribue 1,8 fois ce que la boutique lui donne`, topic `ads`, for Raphaël.

`Lesson.topic` keeps `ads`. Tags `tiktok` become the channel.

## 8. Accounting and KPI

- `computeDailyKpi` gains `channels` through `channelDayKpi`. Spend comes from **ledger** `ad_spend` entries mapped by `campaigns.get(ref).channel`, not from the rows.
- `reconcileDay`: `compare('facture TikTok', …)` becomes one comparison per channel with spend, « facture Meta », so a gap names its platform. TikTok-only: same single line.
- `productPnls` needs no change: `ad_spend` already follows `ref → campaign → product`.
- New `channelPnls(world, from, to)`, `WeeklyPnl.channels?: { channel; spend; reconciledRevenue; roas }[]`, for the weekly note.
- `daily_report` adds a per-channel table with the three ROAS, only when `kpi.channels` exists.

## 9. Files and functions

**New**

| File | Holds |
|---|---|
| `shared/channels.ts` | `ChannelId`, `CHANNELS`, `channelOf`, `acceptance`, labels |
| `server/src/sim/channelBalance.ts` | `CHANNEL_STREAM`, `CHANNEL_VARIATION`, `CHANNEL_SIM`, `CHANNEL_FIT`, `FORMAT_FIT`, `SEARCH`, `ASSIST`, `RETARGET`, `CLAIMS`, `CHANNEL_ORGANIC`, `CHANNEL_EVENTS` |
| `server/src/sim/channels.ts` | `ensureChannelMarket`, `cellOf`, `deliverySpec`, `familyPrior`, `deliverSearch`, `retargetCap`, `updateWarmth`, `recordVisitors`, `runPaidTails`, `runChannelOrganic`, `runClaims`, `rollChannelEvents`, `channelSignals` |
| `server/src/sim/adapters.ts` | `virtualAdapter(id, world)` |
| `server/src/runtime/channelPolicy.ts` | `CHANNEL_POLICY` |
| `server/src/runtime/channels.ts` | `ensureChannelBook`, `openChannels`, `multiChannel`, `unlockReason`, `unlockProgress`, `CHANNEL_ROLE`, `planChannels`, `creditOf`, `adjusted`, `lineOf`, `settleLines`, `elasticity`, `waterFill`, `allocateChannels`, `planTarget` |
| `server/src/runtime/handlers/channels.ts` | `open_channel`, `adapt_creative`, `write_search_ads`, `reconcile_channels`, `allocate_channels` |
| `server/src/learning/attribution.ts` | `RECON`, `reconcile`, `channelDayKpi` |
| `server/test/channels.test.ts`, `server/test/channelPolicy.test.ts` | §11 |
| `brain/politiques/Conformité pub par canal.md` | Public rule labels |

**Changed**

| File | Change |
|---|---|
| `shared/types.ts`, `server/src/contracts.ts` | §2 |
| `server/src/sim/tick.ts` | `Day.dayKey`, `runAds` (§3.3), `runSales` (§3.5), `SOURCE_LABEL`, `runInbox` c), new phases called after `DAY_PHASES`, summary per channel, TikTok line unchanged when alone |
| `server/src/sim/tools.ts` | `submitCreative`, `createCampaign`, `updateCampaign` (learning reset), `postOrganic`, new tools; dispatch through adapters |
| `server/src/sim/compliance.ts` | `CHANNEL_RULES`, `findChannelViolation` |
| `server/src/sim/quality.ts` | `scoreStaticAd`, `scoreSearchAd` |
| `server/src/sim/market.ts` | Calls `ensureChannelMarket` at the end of `createMarketState`, without touching `rng` |
| `server/src/runtime/company.ts` | `STREAM.channels`, `ctx.channelRng`, `ensure*`, `runImmediate('allocate_channels', …)` |
| `server/src/runtime/ctx.ts` | `channelRng` |
| `server/src/runtime/acquisition.ts` | `channel` param on `adBanActive`, `companyPaidBlock`, `launchableCreatives`, `adHistory` |
| `server/src/runtime/metrics.ts` | Rows filter helpers, `referenceChannel` |
| `server/src/runtime/strategy.ts` | `planChannels` call, organic slots, `MISSION_RULES` for « Meta, Facebook, Instagram, Pinterest, YouTube, Google » |
| `server/src/runtime/handlers/growth.ts` | `launch_campaign`, `produce_ad.onDone`, `optimize_ads`, `learnFromRejection`, `post_organic` |
| `server/src/runtime/handlers/ops.ts` | `daily_report`, experiments on TikTok rows |
| `server/src/runtime/review.ts`, `tasks.ts`, `roster.ts`, `playbook.ts`, `holds.ts`, `missions.ts` | New kinds, review routing, French labels, `RX.channel`, channel holds |
| `server/src/runtime/accounting.ts` | Per-channel invoices, `channelPnls` |
| `server/src/learning/kpi.ts`, `retro.ts`, `heuristics.ts`, `experiments.ts`, `data.ts` | §5.3, §7.2, §7.7 |
| `server/src/minds/heuristic/ads.ts`, `research.ts`, `claude/engine.ts`, `claude/prompts.ts` | `writeSearchAd`, static scene, `bestChannelBuzz` |
| `server/src/deliverables/storyboard.ts` | See the video pillar, §13 |
| `server/src/api/trim.ts` | `channelAccounts`, god mode cells, `kpi.channels` kept only on the last 30 days in `LIVE_LIMITS` |
| `server/scripts/balanceLib.ts`, `balance.ts` | `channelControl` in `RunSpec`, `--control`, `applyOverrides` reaches `channelBalance`, per-seed paired output |

## 10. How it reaches the UI

**Snapshot.** `company.channels` (book, plan, attribution) goes through as is. `market.channelAccounts`, `adStats[].channel`, `kpis[].channels`. `market.niches` still never leaves the server. `toSnapshot` already whitelists fields, and a test pins it.

**Screen.** The UI pillar owns it: `CanauxTab.tsx`, `channelsDetail(world)`, `GET /api/channels` (`ui.md` §6.5). This pillar feeds `ChannelRow` and asks for three additions.

| `ChannelRow` field | Source here |
|---|---|
| `status` | `locked` closed, `test` only test lines running, `open`, `paused` channel kill, `banned` account |
| `glyph`, `color`, `name` | `CHANNELS` |
| `share`, `budgetCap` | `ChannelPlan`: share of today's budgets, Σ targets of the channel |
| `reportedRevenue7d`, `reportedRoas7d` | Σ `claimedRevenue ?? revenue`, the platform's number |
| `reconciledRevenue7d`, `reconciledRoas7d`, `daily` | `kpis[].channels`, §5.2 |
| `unlock` | `unlockProgress(world, ch)`: `{ label, value, target, unit, met }[]`, the §7.1 conditions plus « Media buyer » |
| `why` | Line note, kill reason, or ban text, in French |

Additions asked of `ui.md`:

1. `ChannelRow.shopRevenue7d` and `marginalRoas`. Two readings since D149, and the next euro as a reading: « Meta annonce 2,4×, la boutique dit 1,3×, l'euro suivant rapporte 1,2 ». `reconciled*` fields keep their names and carry the shop's numbers.
2. `ChannelsDetail.lines`: `company.channels.lines` as a matrix channel × niche: à tester, en test, rentable, coupé (reason on hover), bloqué (rule). This is where a viewer sees the agency discovering.
3. `ChannelsDetail.plan`: today's moves, with the rule « chaque ligne reçoit sa part selon son ROAS moyen ». λ prints only under the control, with « chaque euro va là où le suivant rapporte le plus », and when `unspent > 0`: « 38 € non dépensés : aucun canal ne rapporte son euro suivant ».

Chronicle: `logDecision(world, { kind: 'channel_open' | 'channel_close', channel, … })` on open, channel kill and ban. `channel_close` is what the totem reads.

**`AdsTab`, renamed Publicité** (`ui.md`): campaign table gets a channel pill and keeps its columns. `CreativeCard`: `.phone` takes the creative's ratio, a filter by channel, one pill per channel review. `AccountHealth` becomes one row per account. Organic table gets a channel column. Every « TikTok » in that tab, in `labels.ts` and in `FinanceTab` becomes « Publicité » or the channel's label. `LearningTab`: `channel:*` dims with labelled arms, god mode column for fit.

`mockSnapshot.ts` gets data for the demo. Feed texts name the channel, `ActivityKind` is unchanged.

## 11. Tests that fail without the feature

`server/test/channels.test.ts`, sim level (no company):

| Test | Fails if |
|---|---|
| `old save and tiktok_only give the same bytes`: tickMarket 30 days with a fixed campaign, `market.channels` deleted vs present | A field, a draw or an order moved for TikTok |
| `a Meta campaign moves neither the events nor another product` | A new draw leaked into a shared stream, or `DAY_PHASES` grew |
| `same seed, same cells; ±25 % on fit; hidden from toSnapshot` | Truth uses the wrong rng or leaks |
| `two channels sell more than one past saturation, overlap below the sum` | Pools are shared or fully separate |
| `a static pin is refused on YouTube, a 9:16 accepted at 0,7 on Pinterest, a video refused on Google` | Formats are labels |
| `Meta rejects the ventre guide, strike on Meta, TikTok account untouched` | Compliance is shared |
| `2 Google strikes stop Search and YouTube` | Accounts are per channel |
| `Pinterest rejects the ventre niche even with a clean hook, no spend` | Rule does not read the landing |
| `learning: lower CTR before exit; +50 % budget resets, +20 % does not` | Learning is a label |
| `Search spends under budget in a small niche; ×2 budget gives < ×1,5 clicks` | Search is a CPM channel with a name |
| `paused pin: clicks keep coming, spend 0, no ledger line` | The tail costs money or does not exist |
| `Search clicks with TikTok running beat Search alone, same seed` | Assist is not in the market |
| `retarget: 0 visitors no delivery; delivery falls as visitors are consumed` | Retargeting is free volume |
| `one channel: claimed fields absent; two: Σ claimed ≥ Σ shop` | Over-claim is a constant |
| `Σ reconciled = Σ shop to the cent, credit 1 with one channel` | Attribution invents money |
| `KPI: Σ channel spend = adSpend = ledger` | KPI drifts from the ledger |

`server/test/channelPolicy.test.ts`, runtime level:

| Test | Fails if |
|---|---|
| `until the first open_channel task, full and tiktok_only are the same run day by day` | D4 is broken: an id or a draw before the unlock |
| `no holder of the channel's role, no channel, and requestRole was called` | Unlock ignores the org |
| `founderApproval: opening a channel waits for him` | Guardrail bypassed |
| `the rule is the average`: line A avg 2,0 b .3 vs line B avg 1,4 b .9, each gets its share, λ null, the note gives the average | It follows the next euro |
| `the marginal_roas control follows the next euro`, same lines, budget flows to B | The control is lost |
| `the marginal_roas control keeps money unspent when no line earns 1,15` | The control always spends the cap |
| `Σ budgets ≤ adCap, no line moves above +30 %, founderCap respected` | A guardrail leaks |
| `stop-loss: Meta at 45 €, TikTok at 25 €, credit applied` | One threshold for all |
| `a stale attribution counts as 1` | The analyst's task has no effect |
| `a ban on Meta blocks no TikTok launch` | Global block |
| `coupe Meta: hold on Meta only, TikTok runs` | Founder order not honoured per channel |
| `second niche of a category starts with the first one's best arm ahead` | Bandit has no context |
| `silent fit ×0,6: the line loses budget within 7 days` | The allocator does not read drift |
| `reload at every tick with 3 channels open ends like an uninterrupted run` | State outside the world |
| `no fit, no cell in the snapshot JSON` | Truth leaks |

## 12. Proof and the one calibration

**Controls** (paired per seed, `normal`, 60 days, 500 €, 30 seeds; 20 s a run):

| Arm | `channelControl` | Mechanic it proves |
|---|---|---|
| Full | `none` | |
| TikTok only | `tiktok_only` | Channels themselves, and comparability |
| No bandit | `no_bandit` (round-robin, no prior) | Discovery |
| Marginal | `marginal_roas` (water-fill), since D149 | The average rule |
| Last click | `last_click` | Reconciliation, off since D149 |

Acceptance, fixed now:

| Check | Target |
|---|---|
| TikTok-only median against the pre-channel baseline, same 30 seeds | Within ±420 € (the ±600 € on 15 seeds, scaled by √2) |
| Full against TikTok-only, paired median | ≥ +25 %, and ≤ ×2,5 (above that the market is too soft) |
| Bankruptcies | No more than TikTok-only |
| Non-TikTok share of spend, days 31-60 | Median 35-75 %; one channel above 70 % in fewer than 60 % of seeds |
| Each of the 4 mechanic controls | Full beats it on ≥ 19 of 30 seeds, and by more than 420 € on the paired median |

**Rule.** The calibration comes last, after the other pillars, only on `CHANNEL_SIM.*.intent`, `SEARCH.cpc` and `CHANNEL_SIM.*.ctrScale`. At most 3 passes, one candidate each, 30 seeds. Same failure twice: report it and stop. A mechanic control that still fails after that is **removed**, in the cut order below, not retuned. Running all arms costs 30 × 6 × 20 s = 1 h of CPU, so full and TikTok-only first, the four others only once those pass.

**Build and cut order.** Each step ships with its tests.

1. Types, `channels.ts`, truth, `runAds`, pools, TikTok identity tests.
2. Meta only: compliance, cuts, unlock, test, stop-loss, KPI, board.
3. Claims, attribution, allocator.
4. YouTube (cheap: reuses masters).
5. Google Search, assist.
6. Pinterest static, paid tail.
7. Retargeting.
8. Organic on the other channels, events.

If time runs short, cut from the bottom: organic on Meta first, then retargeting, then the paid tail. Steps 1-3 and Search are the pillar.

## 13. What I need from the other pillars

| Pillar | Need |
|---|---|
| **org** | `requestRole`, `roleHolder`, the `salary` ledger line: all in `org.md`, accepted. Final rows: `media_buyer_tiktok`, `media_buyer_meta`, `media_buyer_google` (replaces `media_buyer_youtube`), `media_buyer_pinterest` (new). Rename `growth` « Pub TikTok ». Kinds: `open_channel` growth lead, `adapt_creative` video editor, `write_search_ads` hook writer, `reconcile_channels` data analyst, `allocate_channels` CFO. **Email is not mine**: `scale.md` keeps it, so `email_marketer`'s kind is scale's, not this pillar's as `org.md` line 220 says. |
| **talent** | `talent.md` refused a talent multiplier at `ctrRaw`, rightly: it would move the market with no decision behind it. Dropped. A buyer's talent reaches results through `pruneRead` on `updateCampaign`, and one campaign stays on one channel, so natural duels stay valid. I give `buyerScore(world, agentId, fromDay, toDay)`: reconciled profit on his lines. `KIND_SKILL`: `adapt_creative`, `write_search_ads` → `copy`. `RECON.claimWeight` stays a constant. |
| **video** | `renderAdCut({ creative, ratio, design })` for 4:5, 1:1 and static 2:3, frames at 432×540, 540×540, 400×600, plus `AdCreative.files` by ratio. MP4 per ratio if ffmpeg exists. The static output must work without ffmpeg: Pinterest and Search need no video at all. |
| **pdf** | Cover usable as a raster for the 2:3 pin. Nothing else. |
| **scale** | `nichePool(world, n, channel)`: I own the argument. `source` stays `'ads'`, the channel is a separate field, so it lives next to `email` and `bump`. `reconciledRoas(world, from, to)` feeds `roas14` as one number. Read `ChannelPlan.unspent`: 3 days above 0 means more budget buys nothing, a new niche or product is the next lever. `logDecision` is used for §10. |
| **ui** | §10: three additions to `ChannelRow` and `ChannelsDetail`. Ratio-aware phone frame. |

Another workflow is fixing `orders.ts`, `holds.ts` and approvals now: I only add `FounderHold.channel` and an optional `channel` param, so the merge is small.

## 14. Rejected

| Idea | Why not |
|---|---|
| Instagram and Facebook as two channels | One account, one auction. Ratio gives the placement. |
| LinkedIn, Snapchat, X, Reddit ads | LinkedIn's clicks cost several euros, a 20-30 € guide cannot pay them back; the others add a row, not a decision. |
| Display and YouTube in-stream | Same account, no new behaviour. |
| A constant over-claim factor per platform | Would need a TikTok-only exception, and hides why claims inflate. |
| Rewriting `DailyAdStats.revenue` to platform claims | Every reader would need rerouting, with a high regression risk; adding two columns keeps today's meaning. |
| Hidden causal label on each order | Unneeded: `warm` makes incrementality emergent, and a label would tempt some reader to use it. |
| UTM loss (orders with no channel) | Adds noise, no decision. |
| Holdout incrementality tests | At 10 sales a day, a 3-day holdout has about 30 % standard error: fake precision for a real cost in sales. A later version with more volume can have them. |
| Multi-touch models (Shapley, Markov) | No per-user paths in the sim, and they would hide the logic from the viewer. |
| Fatigue and hook bandit per channel | CTR levels differ, samples are thin. TikTok rows teach hooks, channels are judged on ROAS. |
| Per-channel refund rates | Refunds lag 14 days and volumes are low: the window would read noise. |
| Per-channel customer archetypes | Adds support load, no acquisition decision. |
| Automated bidding strategies (tCPA, value rules) | The allocator is the bidding strategy. |
| SEO and organic search | Months of lag on a 60-day horizon. |
| LP A/B per channel | Sales page stays one; the pdf and page pillars own it. |
| Decay of the channel bandit posteriors | The allocator reads a 10-day window and retests reopen killed lines. Two forgetting mechanisms for one problem. |
| A UI toggle for `channelControl` | A benchmark arm, not a product choice. |
