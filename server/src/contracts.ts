/**
 * Module contracts of the agency server. Each folder under server/src implements one block
 * and exports EXACTLY the names declared here (from its index.ts):
 *
 *   core/          ids, rng, activity bus, paths            → see core section
 *   sim/           the virtual market (hidden truth + tools) → createMarketState, createMarketTools, tickMarket, finance, quality
 *   deliverables/  real files: PDF with visuals, SVG cover, sales page, TikTok storyboard
 *   minds/         ContentEngine: heuristic (offline) or Claude
 *   runtime/       the company: roster, task system, delegation, CEO strategy, daily loop
 *   learning/      brain vault (markdown), bandits, experiments, lessons, retro, playbooks
 *   api/           HTTP + SSE server, persistence, CLI
 *
 * The REAL world later plugs in by implementing `MarketTools` with real adapters
 * (TikTok Ads API, Stripe/Shopify, Gmail…) — the company code does not change.
 */
import type {
  AdCreative, AdFormat, AdScene, AgentState, CampaignInputShape, ChapterContent, CompetitorProduct, CreatorProfile, DailyAdStats,
  DesignSpec, Difficulty, FinanceSnapshot, HookStyle, InboxMessage, LedgerEntry, LedgerType, Lesson, MarketState,
  MessageIntent, NicheBrief, PdfContent, Product, QualityReport, ReplyOutcome, SalesPage, ScenarioConfig,
  SupportReplyInput, TrendSignal, VoiceOfCustomer, WorldState, Activity, DailyKpi, Experiment, Task, TaskKind, AgentId,
  ModelTier, MindMode, NicheTruth, Order,
} from './shared.js';

export type { CampaignInputShape };

// ───────────────────────────── core/ ─────────────────────────────

export interface Rng {
  next(): number;                          // [0,1)
  int(min: number, max: number): number;   // inclusive
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  normal(mean: number, sd: number): number;
  poisson(lambda: number): number;
  binomial(n: number, p: number): number;
  shuffle<T>(arr: T[]): T[];
  state(): number;                         // to persist in WorldState.rngState
}
// core/rng.ts       export function createRng(seedOrState: number): Rng   (mulberry32-style, deterministic)
// core/ids.ts       export function nextId(world: WorldState, prefix: string): string   (uses world.idCounter → "prd_12")
// core/activity.ts  export function emit(world: WorldState, a: Omit<Activity, 'id' | 'day' | 'tick' | 'at'>): Activity
//                   (pushes into world.activity ring buffer (max 600) AND notifies subscribers)
//                   export function onActivity(cb: (a: Activity) => void): () => void
// core/paths.ts     export interface RunPaths { root: string; brain: string; files: string }   (absolute)
//                   export function runPaths(runId: string): RunPaths   (→ <repo>/runs/<runId>/...)
//                   export function repoRoot(): string
export interface RunPaths { root: string; brain: string; files: string }

// ───────────────────────────── sim/ (virtual market) ─────────────────────────────

export interface ToolResult { ok: boolean; message: string; id?: string }

export interface AdReviewResult { status: 'approved' | 'rejected'; reason: string | null; strike: boolean }

export interface MarketTools {
  // research — noisy, partial views of the hidden truth
  searchTrends(query?: string): TrendSignal[];
  listCompetitors(nicheId: string): CompetitorProduct[];
  minePains(nicheId: string, depth: 'quick' | 'deep'): VoiceOfCustomer;
  nicheBrief(nicheId: string): NicheBrief | null;
  // store (the product objects live in world.company.products)
  publishProduct(productId: string): ToolResult;       // needs files.pdf, salesPage, price > 0
  setPrice(productId: string, price: number): ToolResult;
  setProductStatus(productId: string, status: 'paused' | 'killed' | 'live'): ToolResult;
  // TikTok ads
  submitCreative(creativeId: string): AdReviewResult;  // compliance review; may add a strike / ban
  createCampaign(input: CampaignInputShape): ToolResult;
  updateCampaign(campaignId: string, patch: { dailyBudget?: number; status?: 'active' | 'paused'; creativeIds?: string[] }): ToolResult;
  getAdStats(sinceDay?: number): DailyAdStats[];
  // organic + creators
  postOrganic(input: { productId: string | null; hook: string; hookStyle: HookStyle; format: AdFormat }): ToolResult;
  listCreators(nicheId: string): CreatorProfile[];
  proposePartnership(input: { creatorId: string; productId: string; upfront: number; commission: number }): ToolResult;
  // support
  listInbox(status?: 'open' | 'all'): InboxMessage[];
  replyToMessage(messageId: string, reply: SupportReplyInput, agentId: AgentId): ReplyOutcome; // evaluated immediately
  issueRefund(orderId: string, reason: string): ToolResult;
}

export interface MarketDayResult {
  day: number;
  sales: number; revenue: number;
  refunds: number;                         // COUNT of refunds + chargebacks closed by the market today
  refundAmount?: number;                   // EUR of those refunds/chargebacks
  adSpend: number;
  newMessages: number; events: string[];   // event ids created this day
  notes: string[];                         // French one-liners for the daily report
}

// sim/index.ts must export:
export interface SimModule {
  createMarketState(scenario: ScenarioConfig, rng: Rng): MarketState;
  createMarketTools(world: WorldState, rng: Rng): MarketTools;
  /** Simulates world.day: ads → traffic → sales → upsells → refunds → reviews → inbox → events → fixed costs → escalations. */
  tickMarket(world: WorldState, rng: Rng): MarketDayResult;
  /** Signs are normalised by type (capital/revenue +, everything else −) and STORED signed, so
   *  Σ amount = cash. Exceptions keep the caller's sign: refs 'hold:<id>' (payment reserve, cash-only,
   *  excluded from profit) and 'reversal:<id>'. Consumers must sum stored amounts, never re-sign them. */
  recordLedger(world: WorldState, e: { type: LedgerType; amount: number; memo: string; ref?: string | null }): LedgerEntry;
  /** profit7d, burn7d, roas7d and runway cover the last 7 CLOSED days; burn7d leaves out the one-off launch costs. */
  financeSnapshot(world: WorldState): FinanceSnapshot;
  /** Last day whose market close is booked (world.day stays open until then). */
  lastClosedDay(world: WorldState): number;
  /** What can still be given back on an order (a goodwill gesture lowers it). */
  repayableLeft(order: Order): number;
  /** Is this public red flag a scam tell (a text classifier on what the profile shows)? */
  isScamFlag(flag: string): boolean;
  /** Announced payment outages, from the public event log only (safe for the company to read). */
  announcedOutageDays(world: WorldState): number[];
  isAnnouncedOutage(world: WorldState, day: number): boolean;
  // heuristic quality scorers (used by QA agents AND by the market's conversion model)
  scorePdf(content: PdfContent, ctx: { audience: string; problem: string; voc?: VoiceOfCustomer; design?: DesignSpec | null }): QualityReport;
  scoreSalesPage(sp: SalesPage, product: Product, voc?: VoiceOfCustomer): QualityReport;
  scoreCreative(c: AdCreative, product: Product, voc?: VoiceOfCustomer): QualityReport;
  scoreSupportReply(msg: InboxMessage, reply: SupportReplyInput): { score: number; issues: string[] };
  /** What a guide really contains: words the reader has not met earlier in it, not its length. */
  guideSubstance(content: PdfContent): { freshWords: number };
  /** Generic phrases that make a PDF sound "AI" (used by scorePdf and the humanizer). */
  GENERIC_PHRASES: readonly string[];
  /** Hidden truth lookup (runtime uses it ONLY for god-mode; agents must use MarketTools). */
  findNiche(world: WorldState, nicheId: string): NicheTruth | undefined;
  difficultyProfile(d: Difficulty): DifficultyProfile;
}

export interface DifficultyProfile {
  cpmMultiplier: number;
  annoyingShare: number;       // share of difficult archetypes among customers
  scamRate: number;            // creator/DM scams per day
  eventRate: number;           // random world events per day
  refundBase: number;          // base refund probability
  inboxPerSale: number;        // messages generated per sale
}

// ───────────────────────────── deliverables/ ─────────────────────────────

// deliverables/index.ts must export:
export interface DeliverablesModule {
  designFor(input: { nicheName: string; category: string; seed: number; hint?: string; keywords?: string[] }): DesignSpec;
  renderCoverSvg(input: { title: string; subtitle: string; audience: string; design: DesignSpec; brand: string }): string; // 600x848 viewBox (A4 ratio)
  /** Writes a real A4 PDF: cover (vector art), contents, intro, chapters with numbered step boxes,
   *  example callouts, checklists, VisualSpec infographics, bonus, "La suite est ici" CTA page, page numbers. */
  renderPdf(input: { product: Product; content: PdfContent; design: DesignSpec; brand: string; outFile: string; upsell?: { title: string; url: string } | null }): Promise<{ pages: number; bytes: number }>;
  /** Self-contained HTML storefront page (inline CSS, inline cover SVG, fake checkout button). */
  renderSalesPageHtml(input: { product: Product; salesPage: SalesPage; coverSvg: string; design: DesignSpec; brand: string }): string;
  /** 9:16 storyboard frames (SVG strings, 360x640 viewBox) + a self-contained HTML "TikTok" preview that plays the scenes. */
  renderAdStoryboard(input: { creative: AdCreative; product: Product; design: DesignSpec; brand: string }): { frames: string[]; previewHtml: string };
}

// ───────────────────────────── minds/ (ContentEngine) ─────────────────────────────

export interface MindContext {
  agent: AgentState;
  playbook: string[];          // learned rules for this agent
  brainNotes: { path: string; title: string; excerpt: string }[]; // retrieved from the brain before acting
  lessons: Lesson[];           // relevant lessons
  day: number;
  brand?: string;              // scenario.companyName (signatures, sales pages)
}

export interface Outline { title: string; chapters: { title: string; points: string[]; kind?: string }[]; bonusTitle: string; nextStepTitle: string }
/** The guide an upsell follows: given to the writer, it produces a different guide on a distinct sub-problem. */
export interface UpsellContext {
  parentTitle: string; parentPromise: string; parentChapterTitles: string[];
  topicId?: string | null;    // prepared sub-problem chosen for this guide, null = a customer pain (the brief's problem); absent = the writer picks
}
export interface OpportunityRanking { ranked: { nicheId: string; score: number; why: string; angle: string; audience: string; problem: string; suggestedPrice: number }[] }
export interface AdDraft { hook: string; hookStyle: HookStyle; format: AdFormat; scenes: AdScene[]; caption: string; hashtags: string[]; cta: string }
export interface RedTeamVerdict { verdict: 'go' | 'fix' | 'kill'; reasons: string[]; fixes: string[] }
/** What the guide leaves out: what a fix pass must add. */
export interface GuideGaps { pains: string[]; chapters: string[] }
/** What the Red Team can check on the actual product (the company's own research and the guide itself). */
export interface RedTeamFacts {
  title: string; audience: string; problem: string; price: number | null;
  signal?: { searchInterest: number; tiktokBuzz: number; competition: 'faible' | 'moyenne' | 'forte' } | null;
  competitors?: { count: number; medianPrice: number | null; avgRating: number | null; reviews: number } | null;
  voc?: { pains: number; medianAnchor: number | null; sensitiveClaims: number } | null;
  guide?: { promise: string; wordCount: number; painsKnown: number; uncoveredPains: string[]; chaptersWithoutExample: string[]; chapters: number } | null;
}
export interface LessonDraft { topic: Lesson['topic']; insight: string; evidence: string; confidence: number; appliesToRoles: string[] }
export interface DayPlanItem { kind: TaskKind; title: string; dept: Task['dept']; priority: 1 | 2 | 3; input: Record<string, unknown>; why: string }
export interface DayPlan { focus: string; items: DayPlanItem[]; memo: string }
export interface UsageEvent { tier: ModelTier; model: string; inputTokens: number; outputTokens: number; costEur: number; purpose: string }

export interface ContentEngine {
  readonly mode: MindMode;
  rankOpportunities(input: { signals: TrendSignal[]; competitors: Record<string, CompetitorProduct[]>; voc: Record<string, VoiceOfCustomer>; excludeNicheIds: string[] }, ctx: MindContext): Promise<OpportunityRanking>;
  writeTitles(input: { niche: NicheBrief; voc: VoiceOfCustomer; count: number; upsellOf?: UpsellContext | null }, ctx: MindContext): Promise<string[]>;
  writeOutline(input: { title: string; niche: NicheBrief; voc: VoiceOfCustomer; upsellOf?: UpsellContext | null; revision?: number }, ctx: MindContext): Promise<Outline>;
  writePdfContent(input: { title: string; outline: Outline; niche: NicheBrief; voc: VoiceOfCustomer; upsellTitle: string | null; upsellOf?: UpsellContext | null; revision?: number }, ctx: MindContext): Promise<PdfContent>;
  humanize(input: { content: PdfContent; flagged: string[]; voc: VoiceOfCustomer; gaps?: GuideGaps | null }, ctx: MindContext): Promise<PdfContent>;
  factCheck(input: { content: PdfContent; voc: VoiceOfCustomer }, ctx: MindContext): Promise<{ issues: string[]; content: PdfContent; claims?: string[] }>;
  redTeam(input: { subject: 'idea' | 'pdf' | 'sales_page' | 'ad'; summary: string; quality: QualityReport | null; facts?: RedTeamFacts | null }, ctx: MindContext): Promise<RedTeamVerdict>;
  writeSalesPage(input: { product: Product; content: PdfContent; voc: VoiceOfCustomer; hype: number; upsellOf?: UpsellContext | null }, ctx: MindContext): Promise<SalesPage>;
  writeAdHooks(input: { product: Product; voc: VoiceOfCustomer; styles: HookStyle[]; upsellOf?: UpsellContext | null; usedHooks?: string[] }, ctx: MindContext): Promise<{ hookStyle: HookStyle; hook: string }[]>;
  writeAd(input: { product: Product; voc: VoiceOfCustomer; hook: string; hookStyle: HookStyle; format: AdFormat; bannedClaims: string[]; upsellOf?: UpsellContext | null }, ctx: MindContext): Promise<AdDraft>;
  writeSupportReply(input: { message: InboxMessage; product: Product | null; order: Order | null; policy: string[]; customer?: { name: string; archetype: string } | null }, ctx: MindContext): Promise<SupportReplyInput>;
  writeOutreach(input: { creator: CreatorProfile; product: Product; offer: { upfront: number; commission: number } }, ctx: MindContext): Promise<string>;
  planDay(input: { day: number; finance: FinanceSnapshot; kpis: DailyKpi[]; products: Product[]; openTasks: Task[]; lessons: Lesson[]; founderMissions: string[]; heuristicPlan: DayPlan }, ctx: MindContext): Promise<DayPlan>;
  interpretMission(input: { text: string; allowedKinds: TaskKind[] }, ctx: MindContext): Promise<DayPlanItem[]>;
  chat(input: { history: { from: string; text: string }[]; text: string; situation: string }, ctx: MindContext): Promise<string>;
  extractLessons(input: { kpis: DailyKpi[]; experiments: Experiment[]; incidents: string[]; heuristicLessons: LessonDraft[] }, ctx: MindContext): Promise<LessonDraft[]>;
  dailyMemo(input: { day: number; kpi: DailyKpi; notes: string[] }, ctx: MindContext): Promise<string>;
  usage(): { calls: number; inputTokens: number; outputTokens: number; costEur: number; fallbacks: number };
}

// minds/index.ts must export:
export interface MindsModule {
  /** mode 'auto' → claude when apiKey present. Claude errors / budget exhaustion fall back to heuristic per call. */
  createContentEngine(opts: { mode: 'auto' | MindMode; apiKey?: string; maxComputeEur: number; models?: Partial<Record<ModelTier, string>>; seed: number; onUsage?: (u: UsageEvent) => void }): ContentEngine;
}

// ───────────────────────────── learning/ ─────────────────────────────

export interface BrainNote { path: string; title: string; tags: string[]; body: string; links: string[]; updatedDay: number }

export interface BrainVault {
  /** Copies the seed vault (<repo>/brain) into the run folder on first use. */
  init(): Promise<void>;
  list(): Promise<BrainNote[]>;
  read(path: string): Promise<BrainNote | null>;
  /** Keyword retrieval (title/tags/body), returns best matches with short excerpts. */
  search(query: string, limit?: number): Promise<{ path: string; title: string; excerpt: string; score: number }[]>;
  /** Create or overwrite a note. Frontmatter (tags, day) + [[wikilinks]] are preserved. */
  write(note: { path: string; title: string; tags: string[]; body: string; day: number }): Promise<void>;
  append(path: string, text: string, day: number): Promise<void>;
  /** Nodes/edges for the "Cerveau" graph view. */
  graph(): Promise<{ nodes: { id: string; title: string; group: string }[]; edges: { from: string; to: string }[] }>;
}

// learning/index.ts must export:
export interface LearningModule {
  createBrainVault(paths: RunPaths): BrainVault;
  /** Thompson sampling over arms stored in world.company.bandits[dimension]. */
  chooseArm(world: WorldState, dimension: string, arms: readonly string[], rng: Rng): string;
  rewardArm(world: WorldState, dimension: string, arm: string, reward: number, weight?: number): void;
  armStats(world: WorldState, dimension: string): { key: string; mean: number; pulls: number }[];
  startExperiment(world: WorldState, e: Omit<Experiment, 'id' | 'status' | 'results' | 'winner' | 'endDay'>): Experiment;
  updateExperiments(world: WorldState): Experiment[];  // returns newly concluded ones (a test without traffic is cancelled, not concluded)
  /** Results of an experiment's variants from its `day` to today, recomputed from the market data. */
  computeExperimentResults(world: WorldState, e: Experiment): Record<string, { n: number; value: number }>;
  /** Evening retro: KPIs of the day + bandit stats + incidents → lessons (dedup), brain notes, playbook rules. */
  runRetro(world: WorldState, engine: ContentEngine, brain: BrainVault, incidents: string[]): Promise<Lesson[]>;
  /** Weekly HR review: agent scores → coaching rules / level ups. Returns French summary lines. */
  performanceReview(world: WorldState, brain: BrainVault): Promise<string[]>;
  computeDailyKpi(world: WorldState, day: number): DailyKpi;
  /** The single level scale of the agents: level reached with this XP, MAX_LEVEL at most. */
  levelForXp(xp: number): number;
  MAX_LEVEL: number;
  /** Keys of the lessons the company turns into decisions. */
  LESSON_KEYS: { page(productId: string): string; quality(productId: string): string; niche(nicheId: string): string; advance: string };
  /** Days of ads behind the numbers of a niche lesson. */
  NICHE_WINDOW_DAYS: number;
}

// ───────────────────────────── runtime/ ─────────────────────────────

export interface CompanyOptions { paths: RunPaths; engine: ContentEngine; brain: BrainVault }

export interface StepResult { day: number; tick: number; phase: WorldState['phase']; status: WorldState['status']; activities: number }

// runtime/index.ts must export:
export interface RuntimeModule {
  /** Fresh world: market, roster (~30 agents in 11 departments), starting capital in the ledger, seed playbooks. */
  createWorld(scenario: ScenarioConfig, runId: string): WorldState;
  /** The autonomous company. Pure orchestration over the other modules. */
  Company: new (world: WorldState, opts: CompanyOptions) => CompanyApi;
  defaultScenario(overrides?: Partial<ScenarioConfig>): ScenarioConfig;
}

export interface CompanyApi {
  readonly world: WorldState;
  /** Advance one tick (morning standup / work slot / market close / evening retro). */
  step(): Promise<StepResult>;
  runDays(days: number, onDay?: (kpi: DailyKpi) => void): Promise<void>;
  /** Founder gives a mission (routed by the CEO, or to a specific agent). */
  giveMission(text: string, agentId?: AgentId): Promise<string>;  // returns mission id
  chat(agentId: AgentId, text: string): Promise<string>;           // agent's answer (French)
  approve(taskId: string, approved: boolean): void;                // founderApproval mode
}

// ───────────────────────────── api/ ─────────────────────────────
// api/server.ts — node:http, port from env PORT (default 4317):
//   GET  /api/state                → CompanySnapshot (query ?god=1 adds godMode)
//   GET  /api/stream               → SSE: StreamEvent ('snapshot' every tick, 'activity' batches)
//   POST /api/control              { action: 'play' | 'pause' | 'step' | 'day', speed?: 1 | 2 | 4 | 8 }
//   POST /api/scenario             Partial<ScenarioConfig> → starts a new run, returns snapshot
//   POST /api/mission              { text, agentId? } → { ok, missionId, status, message? } (message: the company's answer)
//   POST /api/chat                 { agentId, text } → { reply }
//   POST /api/approve              { taskId, approved }
//   GET  /api/brain                → BrainNote[] (without body) ; GET /api/brain/note?path=… → BrainNote ; GET /api/brain/graph
//   GET  /api/runs                 → saved runs ; POST /api/load { runId }
//   GET  /runs/<runId>/<path>      → generated files (pdf, svg, html)
//   GET  /*                        → web/dist (built UI) when present
// api/persist.ts — saveWorld(world) → runs/<runId>/world.json (debounced) ; loadWorld(runId)
// api/snapshot.ts — toSnapshot(world, god?: boolean): CompanySnapshot
// cli.ts — `npm run sim -- --days 30 --budget 500 --difficulty cauchemar --seed 42 --mind heuristic`
//          runs headless as fast as possible, prints a daily KPI table and a final verdict.

export type { Activity, AgentState, ChapterContent, DailyKpi, Experiment, InboxMessage, Lesson, MessageIntent, Product, Task };
