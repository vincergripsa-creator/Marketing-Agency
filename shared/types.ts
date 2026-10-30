/**
 * Shared data model of the Pixel Agency.
 *
 * ONE serialisable object — `WorldState` — holds the whole company AND the virtual market.
 * Server modules are plain functions that read/mutate it; the web UI only ever receives a
 * `CompanySnapshot` (WorldState minus the market's hidden truth).
 *
 * Money is always EUR, as a number with cents (e.g. 19.9). Days start at 1.
 * All user-facing text (agent names, content, activity feed) is in French.
 */

// ───────────────────────────── Scenario ─────────────────────────────

export type Difficulty = 'facile' | 'normal' | 'cauchemar';
export type MindMode = 'heuristic' | 'claude';

export interface ScenarioConfig {
  name: string;
  companyName: string;
  seed: number;
  startingCash: number;          // EUR, default 500
  horizonDays: number;           // default 60
  difficulty: Difficulty;
  mindMode: 'auto' | MindMode;   // auto = claude when ANTHROPIC_API_KEY is set
  founderApproval: boolean;      // true = launches/ads/refunds > 50€ wait for the founder in the UI
  chargeCompute: boolean;        // true = real Claude token cost is booked in the ledger as 'compute'
  maxComputeEur: number;         // hard cap on real Claude spend for this run
  goal: { targetProfit: number; byDay: number };
}

// ───────────────────────────── Organisation ─────────────────────────────

export type DeptId =
  | 'direction' | 'recherche' | 'studio' | 'creation' | 'growth' | 'boutique'
  | 'support' | 'analyse' | 'finance' | 'rh' | 'partenariats';

export type Place = DeptId | 'cafe' | 'cerveau';
export type ModelTier = 'opus' | 'sonnet' | 'haiku';
export type AgentId = string;

export interface DeptDef {
  id: DeptId;
  name: string;          // "Recherche", "Studio PDF"...
  color: string;         // hex, used for island roof/sign/minimap
  icon: string;          // short label for the sign, e.g. "RECHERCHE"
  description: string;
  chiefId: AgentId;
  grid: { col: number; row: number }; // island position on the isometric map (plaza = 0,0)
}

export interface AvatarSpec {
  skin: string; hair: string; shirt: string; pants: string;
  hairStyle: 0 | 1 | 2 | 3 | 4 | 5;   // short / long / bun / curly / bald / ponytail
  accessory: 'none' | 'glasses' | 'cap' | 'headphones' | 'beard' | 'tie';
}

export type ToolName =
  | 'brain.read' | 'brain.write'
  | 'market.trends' | 'market.competitors' | 'market.pains'
  | 'store.publish' | 'store.price' | 'store.stats'
  | 'ads.review' | 'ads.campaign' | 'ads.stats'
  | 'organic.post' | 'creators.search' | 'creators.deal'
  | 'inbox.read' | 'inbox.reply' | 'inbox.refund'
  | 'finance.ledger' | 'pdf.render' | 'design.cover' | 'design.storyboard'
  | 'web.page' | 'team.delegate' | 'team.review';

export interface AgentDef {
  id: AgentId;
  name: string;          // French first name, e.g. "Margaux"
  role: string;          // "Rédactrice en chef"
  dept: DeptId;
  isChief: boolean;
  tier: ModelTier;
  persona: string;       // 1-2 sentences: personality + how they work
  skills: string[];      // competences shown on the agent card
  tools: ToolName[];
  taskKinds: TaskKind[]; // what this agent can execute
  avatar: AvatarSpec;
}

export type AgentStatus = 'idle' | 'walking' | 'working' | 'meeting' | 'reviewing' | 'coffee' | 'thinking' | 'blocked';

export interface AgentState extends AgentDef {
  status: AgentStatus;
  place: Place;          // where the agent physically is (UI walks them there)
  currentTaskId: string | null;
  energy: number;        // 0..100, drops while working, coffee restores
  level: number;         // 1.. grows with xp
  xp: number;
  perf: { done: number; approved: number; rejected: number; failed: number; score: number; promotedWeek?: number; approvedAtPromotion?: number }; // score 0..100
  bubble: string | null; // short speech bubble shown above the sprite
}

// ───────────────────────────── Tasks & missions ─────────────────────────────

export type TaskKind =
  | 'plan_day'            // CEO: daily standup → missions
  | 'scan_trends'         // Recherche: list niche opportunities
  | 'mine_pains'          // Recherche: voice-of-customer (comments, reviews, phrases)
  | 'scan_competitors'    // Recherche: Gumroad-like competitor listing
  | 'pick_opportunity'    // Direction + Recherche: choose niche/product (rule of one)
  | 'red_team'            // RH/Direction: try to kill an idea / deliverable before it ships
  | 'write_titles'        // Studio
  | 'write_outline'       // Studio
  | 'write_pdf'           // Studio
  | 'humanize_pdf'        // Studio: remove generic "AI" sentences, add market examples
  | 'fact_check'          // Studio
  | 'design_cover'        // Création
  | 'render_pdf'          // Création: final PDF with visuals
  | 'write_sales_page'    // Boutique
  | 'set_price'           // Boutique
  | 'publish_product'     // Boutique
  | 'design_upsell'       // Boutique: "La suite est ici" → next PDF
  | 'write_ad_hooks'      // Growth
  | 'produce_ad'          // Growth/Création: script + storyboard
  | 'launch_campaign'     // Growth: media buying
  | 'optimize_ads'        // Growth: kill/scale creatives, budgets
  | 'post_organic'        // Growth: free TikTok posts
  | 'reply_inbox'         // Support
  | 'handle_refund'       // Support
  | 'find_creators'       // Partenariats
  | 'negotiate_deal'      // Partenariats
  | 'daily_report'        // Analyse
  | 'run_experiment'      // Analyse
  | 'budget_review'       // Finance
  | 'reconcile_ledger'    // Finance: daily ledger reconciliation (orders, ad platform, refunds)
  | 'weekly_pnl'          // Finance: weekly profit and loss per product
  | 'follow_missions'     // Direction: founder missions follow-up, stale tasks unblocked
  | 'retro'               // RH: lessons of the day → brain + playbooks
  | 'performance_review'; // RH: weekly agent reviews

export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'done' | 'failed' | 'cancelled' | 'awaiting_founder';

export interface ReviewNote { by: AgentId; day: number; verdict: 'approve' | 'changes' | 'reject'; notes: string[] }

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;            // French, shown in UI
  dept: DeptId;
  assignee: AgentId | null;
  createdBy: AgentId | 'founder' | 'system';
  missionId: string | null;
  dependsOn: string[];      // task ids that must be 'done' first
  status: TaskStatus;
  priority: 1 | 2 | 3;      // 1 = urgent
  dayCreated: number;
  dayDone: number | null;
  progress: number;         // 0..1, for UI progress bars
  workLeft: number;         // ticks of work left (heuristic pacing)
  attempts: number;
  reviewer: AgentId | null; // who must approve before 'done' (null = no review)
  reviews: ReviewNote[];
  input: Record<string, unknown>;   // e.g. { productId, nicheId, creativeId, messageId }
  output: Record<string, unknown> | null;
  deliverableIds: string[];
  log: string[];            // short French lines, newest last
}

export interface Mission {
  id: string;
  day: number;
  from: AgentId | 'founder';
  text: string;             // "Lancer un 2e PDF sur la niche X"
  ownerId: AgentId;         // chief in charge
  taskIds: string[];
  status: 'open' | 'done' | 'failed';
  nicheId?: string | null;  // founder mission: the niche the company understood it to be about
  wantsProduct?: boolean;   // the founder asked for a product: closes only once one is live in nicheId
  productId?: string | null; // the resulting product
  outcome?: string | null;  // French, where it stands, written for the founder
  relaunches?: number;      // chains restarted by the chief of staff after a dead end
  doneTasks?: number;       // snapshot only: its done tasks, counted on the whole task list
}

export interface ChatMessage { id: string; day: number; from: 'founder' | AgentId; text: string; at: number }

// ───────────────────────────── Product (the PDF) ─────────────────────────────

export type ProductStatus = 'idea' | 'research' | 'writing' | 'design' | 'qa' | 'ready' | 'live' | 'paused' | 'killed';

export interface ChapterContent {
  title: string;
  intro: string;
  paragraphs: string[];
  steps: string[];            // numbered actionable steps
  example: string | null;     // concrete example (ideally from voice-of-customer)
  checklist: string[];
  visual: VisualSpec | null;
}

export interface PdfContent {
  title: string;
  subtitle: string;
  audience: string;
  promise: string;            // what the reader will have at the end
  introduction: string[];     // restates the problem
  chapters: ChapterContent[];
  bonus: ChapterContent;      // "free gift inside" chapter
  nextStep: { title: string; text: string; upsellProductId: string | null }; // "La suite est ici"
  wordCount: number;
  howTo?: [string, string][]; // « Comment utiliser ce guide » box: [head, text], three of them; a neutral box without it
}

/**
 * Label conventions (shared by minds/ which writes them and deliverables/ which draws them):
 * - do_dont: every label is prefixed « À faire : … » or « À éviter : … » (order free).
 * - quote: labels[0] = the quote, labels[1] = attribution (optional).
 * - timeline: labels are « Phase : action » (e.g. « Nuits 1-3 : … »).
 * - bar_chart: values 0..100 aligned with labels, measured values only (never an invented index).
 * - grid: labels and values stay empty, everything is in `grid` (a renderer without grid support skips it).
 */
export interface VisualSpec {
  type: 'timeline' | 'bar_chart' | 'checklist_card' | 'quote' | 'steps_diagram' | 'icon_grid' | 'do_dont' | 'grid';
  title: string;
  labels: string[];
  values: number[];           // for charts (0..100); empty otherwise
  grid?: GridSpec;            // required when type === 'grid'
}

/**
 * Printable table the reader fills in by hand (tracker, log, budget, planning sheet).
 * The table has rows.length lines and columns.length columns; the first column holds the row labels.
 * cells[r][c] pre-fills a cell, c counting the columns AFTER the first one; null or missing = empty box
 * to write in. cells may be shorter than rows, and may be absent for a fully blank table.
 */
export interface GridSpec {
  columns: string[];          // header labels, the first one heads the row labels (at least 2 columns)
  rows: string[];             // row labels, '' for a blank line
  cells?: (string | null)[][];
}

/** Kind of guide a niche calls for: drives chapter kinds, plan logic and bonus types of the writer. */
export type GuideArchetype = 'habitude' | 'projet' | 'demarche' | 'examen' | 'evenement' | 'systeme' | 'paliers';

export interface DesignSpec {
  palette: { bg: string; primary: string; secondary: string; accent: string; ink: string; soft: string };
  motif: 'moon' | 'sun' | 'leaf' | 'coin' | 'heart' | 'bolt' | 'book' | 'chart' | 'home' | 'paw' | 'dumbbell' | 'sparkle' | 'brush' | 'pot';
  coverLayout: 'centered' | 'split' | 'badge' | 'minimal';
  titleFont: 'Helvetica-Bold' | 'Times-Bold' | 'Courier-Bold';
  bodyFont: 'Helvetica' | 'Times-Roman';
  seed: number;
  family?: string;            // niche family (deliverables/design.ts): it names the right professional on the last page
}

export interface SalesPage {
  headline: string;
  subheadline: string;
  painBullets: string[];      // uses customer's exact words
  solution: string;
  chapterBlurbs: { title: string; blurb: string }[];
  bonusBlurb: string;
  objections: { q: string; a: string }[];
  guarantee: string;
  cta: string;
  hypeLevel: number;          // 0..1 — overpromising raises conversion but also refunds & ad rejections
  priceWritten?: number;      // price of the product when this copy was written: the page prints the price of the day instead
}

export interface QualityReport {
  overall: number;            // 0..100
  specificity: number;        // rule of one: one problem, one audience
  structure: number;          // intro / numbered steps / examples / bonus / next step
  actionability: number;
  humanTone: number;          // penalises generic AI phrases
  design: number;
  promiseMatch: number;       // sales page promise vs actual content
  compliance: number;         // risky claims (health, money, guarantees)
  issues: string[];           // French, actionable
  blocking?: { dimension: 'specificity' | 'structure' | 'actionability' | 'humanTone' | 'design' | 'promiseMatch' | 'compliance'; text: string }[]; // what a reviewer cannot let through, whatever the global score
  evaluator: 'heuristic' | 'claude' | 'hybrid';
}

export interface Review { id: string; day: number; customerId: string; rating: 1 | 2 | 3 | 4 | 5; text: string }

export interface ProductStats {
  views: number; sales: number; revenue: number; refunds: number; refundAmount: number;
  rating: number;             // 0 when no review
  reviews: Review[];
  upsellSales: number;
}

export interface Product {
  id: string;
  nicheId: string;
  title: string;
  subtitle: string;
  audience: string;
  problem: string;
  price: number;
  status: ProductStatus;
  version: number;            // bumps when the PDF is reworked after feedback
  content: PdfContent | null;
  design: DesignSpec | null;
  salesPage: SalesPage | null;
  files: { pdf: string | null; cover: string | null; salesPage: string | null }; // run-relative paths
  quality: QualityReport | null;
  salesQuality: QualityReport | null;
  upsellProductId: string | null;
  createdDay: number;
  launchedDay: number | null;
  stats: ProductStats;
  priceHistory: { day: number; price: number }[];
  brief?: { angle: string };  // internal positioning note, never customer-facing
  pagePrint?: string;         // what sales-page.html shows of the live product (price, reviews…): when it changes, the page is re-rendered
  decision?: { day: number; status: 'paused' | 'killed'; reason: string }; // why it was last stopped (French), for the founder's questions
}

// ───────────────────────────── TikTok ads (virtual platform) ─────────────────────────────

export type HookStyle = 'question' | 'contrarian' | 'story' | 'stat' | 'pov' | 'mistake' | 'before_after' | 'listicle';
export type AdFormat = 'faceless_voiceover' | 'text_slideshow' | 'ugc_avatar' | 'carousel';

export interface AdScene { visual: string; onScreenText: string; voiceover: string; durationSec: number }

export interface AdCreative {
  id: string;
  productId: string;
  hook: string;
  hookStyle: HookStyle;
  format: AdFormat;
  scenes: AdScene[];
  caption: string;
  hashtags: string[];
  cta: string;
  files: { storyboard: string[]; preview: string | null }; // svg frames + html preview (run-relative)
  quality: QualityReport | null;
  review: { status: 'pending' | 'approved' | 'rejected'; reason: string | null; day: number | null };
  createdDay: number;
  createdBy: AgentId;
}

export interface Campaign {
  id: string;
  productId: string;
  name: string;
  creativeIds: string[];
  dailyBudget: number;
  status: 'active' | 'paused' | 'rejected' | 'ended';
  targeting: { interests: string[]; ageMin: number; ageMax: number };
  startDay: number;
  createdBy: AgentId;
  pausedFor?: 'outage' | 'founder'; // outage: resumed the next morning; founder: resumed when he lifts his order
  founderForced?: boolean;  // launched by the founder against the company's own stop rules: only he (or the stop-loss) ends it
  founderCap?: number;      // approval mode: the daily budget the founder agreed to
  raiseRefusedDay?: number; // approval mode: the day he last refused a raise
}

export interface CampaignInputShape {
  productId: string; name: string; creativeIds: string[]; dailyBudget: number;
  targeting: Campaign['targeting']; createdBy: AgentId;
}

export interface AdComment { author: string; text: string; tone: 'positive' | 'negative' | 'troll' | 'question' }

export interface DailyAdStats {
  day: number; campaignId: string; creativeId: string; productId: string;
  spend: number; impressions: number; clicks: number; ctr: number; cpc: number; cpm: number;
  landingViews: number; purchases: number; revenue: number; roas: number;
  frequency: number;          // creative fatigue indicator
  comments: AdComment[];
}

/** A creative's ad figures, every day added up. */
export interface CreativeAdTotals { spend: number; impressions: number; clicks: number; purchases: number; revenue: number; lastDay: number }

export interface OrganicPost {
  id: string; day: number; productId: string | null; hook: string; hookStyle: HookStyle;
  format: AdFormat; views: number; likes: number; clicks: number; sales: number; viral: boolean;
}

// ───────────────────────────── Customers & inbox ─────────────────────────────

export type CustomerArchetype =
  | 'normal' | 'impatient' | 'sceptique' | 'chasseur_de_remboursement' | 'troll' | 'karen'
  | 'perdu' | 'superfan' | 'arnaqueur' | 'menace_chargeback' | 'demande_sur_mesure';

export interface Customer {
  id: string; name: string; email: string; archetype: CustomerArchetype;
  patience: number;           // 0..1
  orders: string[];
  satisfaction: number;       // -1..1
}

export interface Order {
  id: string; day: number; customerId: string; productId: string; price: number;
  source: 'ads' | 'organic' | 'creator' | 'upsell';
  campaignId: string | null; creatorId: string | null;
  refunded: boolean; chargeback: boolean;
  refundedDay?: number | null;  // day of the refund / chargeback, for exact daily attribution
  refundedAmount?: number;      // EUR already given back (goodwill gesture, refund, chargeback), never above price
  charges?: number;             // card debits in the payment log (2 = a real double charge)
  downloads?: number;           // PDF downloads in the delivery log (0 = the buyer never got the file)
}

export type MessageIntent =
  | 'question' | 'non_recu' | 'remboursement' | 'plainte_qualite' | 'sur_mesure' | 'partenariat'
  | 'arnaque' | 'compliment' | 'troll' | 'menace_chargeback' | 'bug_paiement';

export interface InboxMessage {
  id: string;
  day: number;
  customerId: string;
  channel: 'email' | 'commentaire_tiktok' | 'avis' | 'dm';
  subject: string;
  body: string;
  intent: MessageIntent;      // ground truth (the support agent must infer it from the text)
  productId: string | null;
  orderId: string | null;
  mood: number;               // -1 furious .. 1 delighted
  status: 'open' | 'replied' | 'resolved' | 'escalated';
  deadlineDay: number;        // unanswered past this day → escalation (bad review / chargeback)
  thread: { from: 'customer' | AgentId; text: string; day: number }[];
  resolution: string | null;
  customerName?: string;      // display name (first name + initial), safe for the UI
  replyScore?: number | null; // 0..100 score of the last support reply (set by replyToMessage)
  repliedDay?: number | null;
}

/** A message as the UI receives it: the ground truth stays on the server (god mode: CompanySnapshot.godMode.intents). */
export type PublicInboxMessage = Omit<InboxMessage, 'intent'>;

export interface SupportReplyInput {
  text: string;
  action: 'none' | 'refund' | 'resend_link' | 'discount_code' | 'escalate' | 'ignore' | 'block';
  detectedIntent: MessageIntent;
}

export interface ReplyOutcome {
  messageId: string;
  score: number;              // 0..100 reply quality
  customerReaction: string;   // French
  newMood: number;
  resolved: boolean;
  consequence: 'none' | 'refund' | 'bad_review' | 'good_review' | 'chargeback' | 'scam_loss' | 'escalation';
  cost: number;               // EUR booked (refund, scam loss...)
}

// ───────────────────────────── Creators / partnerships ─────────────────────────────

export interface CreatorProfile {
  id: string; handle: string; nicheId: string; followers: number; avgViews: number;
  engagement: number;         // public
  askUpfront: number;         // EUR asked upfront (0 = commission only)
  askCommission: number;      // 0..1
  redFlags: string[];         // visible clues (bought followers, generic DMs…)
}

export interface Partnership {
  id: string; creatorId: string; productId: string; day: number;
  upfront: number; commission: number;
  status: 'proposed' | 'accepted' | 'refused' | 'delivered' | 'scam';
  sales: number; revenue: number;
}

// ───────────────────────────── Finance ─────────────────────────────

export type LedgerType =
  | 'capital' | 'revenue' | 'refund' | 'chargeback' | 'ad_spend' | 'payment_fee' | 'platform_fee'
  | 'tool_subscription' | 'compute' | 'creator_payout' | 'scam_loss' | 'discount';

export interface LedgerEntry { id: string; day: number; type: LedgerType; amount: number; memo: string; ref: string | null }

/** Profit and loss of one product over a window, from the ledger. */
export interface ProductPnl {
  productId: string; title: string; sales: number;
  revenue: number; refunds: number; adSpend: number; fees: number; creators: number;
  profit: number;             // revenue - refunds - adSpend - fees - creators
  roas: number | null;        // revenue net of refunds / ad spend, null without ad spend
}

/** The accountant's weekly report, kept for the kill and budget decisions. */
export interface WeeklyPnl {
  week: number; fromDay: number; toDay: number;
  products: ProductPnl[];     // best first
  unallocated: number;        // fixed costs and compute, shared by the whole company (negative)
  total: number;              // sum of the products + unallocated: the profit of the window
}

export interface FinanceSnapshot {
  cash: number;
  revenue: number; refunds: number; adSpend: number; fees: number; compute: number; otherCosts: number;
  profit: number;             // cumulative, excluding starting capital
  profit7d: number;
  burn7d: number;             // average daily net outflow over 7 days (positive = burning)
  runwayDays: number | null;  // null when not burning cash, 0 when cash ≤ 0
  roas7d: number;
  bankrupt: boolean;
}

// ───────────────────────────── Market research (what agents can SEE) ─────────────────────────────

export interface TrendSignal {
  nicheId: string; name: string; audience: string; category: string;
  searchInterest: number;     // 0..100 noisy
  tiktokBuzz: number;         // 0..100 noisy
  competitionHint: 'faible' | 'moyenne' | 'forte';
  sampleTitles: string[];
}

export interface CompetitorProduct {
  id: string; nicheId: string; title: string; price: number; reviews: number; rating: number;
  ageDays: number; platform: 'gumroad' | 'etsy' | 'stan' | 'amazon_kdp';
  weaknesses: string[];       // what buyers complain about in its reviews
}

export interface VoiceOfCustomer {
  nicheId: string;
  depth: 'quick' | 'deep';
  pains: string[];            // problems in their words
  phrases: string[];          // verbatim customer phrases ("il se réveille toutes les 2h")
  objections: string[];       // why they hesitate to buy
  desiredOutcomes: string[];
  /**
   * Raw material to write the PDF. The research samples each array item by item, so every item stands
   * on its own and carries its structure in plain French:
   * - mistakes: « Erreur. Pourquoi. → Correction. » (the fix stays with its mistake);
   * - steps: « Action. Détail. (étape 3 ; quand ; durée) », rank restores the order, « diagnostic » marks the observation step;
   * - tips: « Si situation : réponse. » is a troubleshooting case, anything else a plain tip;
   * - any item may start with « [sujet] »: it belongs to a follow-up guide on that sub-problem, never to the main guide.
   */
  knowledge: { tips: string[]; steps: string[]; mistakes: string[]; examples: string[]; facts: string[]; archetype?: GuideArchetype };
  priceAnchors: number[];     // prices people mention / pay
  bannedClaims: string[];     // claims the ad platform refuses in this niche
}

export interface NicheBrief {
  nicheId: string; name: string; audience: string; problem: string; category: string; keywords: string[];
}

// ───────────────────────────── Learning ─────────────────────────────

export interface Lesson {
  key?: string;               // stable dedup key (topic + subject)
  id: string; day: number; topic: 'ads' | 'pricing' | 'product' | 'support' | 'niche' | 'finance' | 'process' | 'partnership';
  changedDay?: number;        // last retro that rewrote it (`day` stays the day it was first learned)
  insight: string;            // French one-liner, actionable
  evidence: string;           // numbers backing it
  confidence: number;         // 0..1
  source: AgentId;
  appliesTo: AgentId[];       // playbooks that received it
  notePath: string;           // brain-relative path of the markdown note
  supersededBy?: string;      // set on a retired lesson (CompanyState.retiredLessons): id of the lesson that replaced it
  retiredDay?: number;
}

export interface BanditArm { key: string; alpha: number; beta: number; pulls: number; reward: number }

export interface Experiment {
  nicheId?: string | null;    // scope (null = global)
  id: string; day: number; owner: AgentId; hypothesis: string;
  dimension: 'hook_style' | 'ad_format' | 'price' | 'sales_hype' | 'support_tone' | 'niche';
  variants: string[]; metric: 'ctr' | 'cvr' | 'roas' | 'refund_rate' | 'resolution';
  productId?: string | null;  // the product whose traffic carries the test
  status: 'running' | 'concluded' | 'cancelled'; // cancelled = a variant never got traffic: nothing was learned
  results: Record<string, { n: number; value: number }>;
  winner: string | null; endDay: number | null;
}

export interface DailyKpi {
  day: number; cash: number; revenue: number; adSpend: number; profit: number; cumulativeProfit: number;
  sales: number; refunds: number; impressions: number; clicks: number; ctr: number; cvr: number; roas: number;
  cac: number; openTickets: number; avgReplyScore: number; liveProducts: number; tasksDone: number; lessonsLearned: number;
}

// ───────────────────────────── World events & activity ─────────────────────────────

export type WorldEventKind =
  | 'cpm_spike' | 'cpm_drop' | 'ad_rejected' | 'ad_account_warning' | 'ad_account_banned' | 'viral_organic'
  | 'competitor_clone' | 'payment_hold' | 'trend_shift' | 'bad_review_wave' | 'scam_attempt' | 'creator_offer'
  | 'platform_outage' | 'seasonal_boost' | 'goal_reached' | 'bankrupt';

export interface WorldEvent {
  id: string; day: number; kind: WorldEventKind; title: string; description: string; severity: 'info' | 'warn' | 'danger' | 'good';
  refs?: { productId?: string; nicheId?: string; creativeId?: string; creatorId?: string; day?: number }; // day: the announced day (platform_outage)
}

export type ActivityKind =
  | 'thought' | 'brain_read' | 'brain_write' | 'delegate' | 'task_start' | 'task_done' | 'task_failed'
  | 'review' | 'deliverable' | 'sale' | 'refund' | 'ad' | 'message' | 'event' | 'finance' | 'lesson'
  | 'walk' | 'coffee' | 'meeting' | 'founder' | 'chat';

export interface Activity {
  id: string; day: number; tick: number; at: number; // at = Date.now() when emitted
  agentId: AgentId | null;
  kind: ActivityKind;
  text: string;               // French, short, shown in feed and as speech bubble
  toAgentId?: AgentId;        // for delegate/review: animate a line/walk between agents
  place?: Place;              // for walk: destination
  refs?: { taskId?: string; productId?: string; deliverableId?: string; creativeId?: string; messageId?: string };
}

export interface Deliverable {
  id: string;
  kind: 'pdf' | 'cover' | 'sales_page' | 'ad_storyboard' | 'ad_preview' | 'report' | 'research' | 'note';
  title: string;
  productId: string | null;
  creativeId: string | null;
  path: string;               // run-relative path (served at /runs/<runId>/<path>)
  createdBy: AgentId;
  day: number;
  quality: number | null;     // 0..100
}

// ───────────────────────────── The world ─────────────────────────────

export type DayPhase = 'morning' | 'work' | 'market' | 'evening';
export const TICKS_PER_DAY = 12; // tick 0 = morning standup, 1..9 = work, 10 = market close, 11 = evening retro

/** Hidden market truth. NEVER sent to the UI (except in explicit "god mode") nor to agents. */
export interface NicheTruth {
  id: string; name: string; audience: string; problem: string; category: string; keywords: string[];
  demand: number;             // 0..1 daily buyer pool size factor
  wtp: { min: number; sweet: number; max: number }; // willingness to pay (EUR)
  competition: number;        // 0..1
  tiktokAffinity: number;     // 0..1 how well the audience responds on TikTok
  cpmBase: number;            // EUR per 1000 impressions
  hookAffinity: Partial<Record<HookStyle, number>>; // multipliers 0.5..1.8 (unknown to agents, learnable)
  formatAffinity: Partial<Record<AdFormat, number>>;
  refundSensitivity: number;  // 0..1
  complianceRisk: number;     // 0..1 (health / money claims)
  seasonality: number[];      // 7 values, day-of-week multipliers
  voc: VoiceOfCustomer;       // full deep VoC (research reveals subsets)
  competitors: CompetitorProduct[];
  scamCreatorIds?: string[];  // creators of this niche who take an advance and vanish, explicit red flag or not
}

export interface MarketState {
  niches: NicheTruth[];
  customers: Customer[];
  orders: Order[];
  inbox: InboxMessage[];
  adStats: DailyAdStats[];
  organicPosts: OrganicPost[];
  creators: CreatorProfile[];
  partnerships: Partnership[];
  events: WorldEvent[];
  modifiers: { cpmMultiplier: number; cpmUntilDay: number; paymentHoldUntilDay: number; outageDay: number };
  adAccount: { strikes: number; banned: boolean; bannedUntilDay: number };
  creativeImpressions: Record<string, number>; // cumulative, for fatigue
  retiredAdTotals?: Record<string, CreativeAdTotals>; // adStats rows past their retention, added up by creative
}

export interface CompanyState {
  name: string;
  agents: AgentState[];
  departments: DeptDef[];
  tasks: Task[];
  missions: Mission[];
  products: Product[];
  creatives: AdCreative[];
  campaigns: Campaign[];
  deliverables: Deliverable[];
  research: { trends: TrendSignal[]; voc: Record<string, VoiceOfCustomer>; competitors: Record<string, CompetitorProduct[]>; shortlist: string[] };
  lessons: Lesson[];                        // active lessons only: a replaced lesson moves to retiredLessons
  retiredLessons?: Lesson[];                // superseded lessons (history), never applied
  experiments: Experiment[];
  bandits: Record<string, BanditArm[]>;     // key = dimension (+ optional ":nicheId")
  playbooks: Record<AgentId, string[]>;     // learned rules injected into each agent's work
  kpis: DailyKpi[];
  chats: Record<AgentId, ChatMessage[]>;
  pendingApprovals: string[];               // task ids awaiting founder (founderApproval mode)
  budget?: { day: number; adCap: number; survival: boolean; note: string } | null; // CFO envelope of the day
  lastRetroDay?: number;                    // idempotence of the evening retro (survives save/reload)
  pnl?: WeeklyPnl[];                        // weekly P&L per product, oldest first
  holds?: FounderHold[];                    // the founder's standing decisions, ended ones included
}

/**
 * A standing decision of the founder: the plan and the handlers respect it until it ends, whatever their own rules
 * say. An order lasts until he lifts it; a refusal lasts for a cooldown.
 */
export interface FounderHold {
  id: string;
  kind: 'ads' | 'advances' | 'launches' | 'product'; // paid ads (all, or one product's), creators' advances, new products, one product off sale
  productId: string | null;
  day: number;
  until: number | null;     // last day it holds, null until lifted
  reason: string;           // French, read in the feed
  liftedDay?: number;
}

/** What an agent read in the brain before starting a task. Lessons by id: the retro keeps rewriting them. */
export interface TaskMind { brainNotes: { path: string; title: string; excerpt: string }[]; lessonIds: string[] }

/**
 * What the company carries from one tick to the next beyond its records. It is saved with the world, so a run reloaded
 * at any tick goes on exactly as if it had never stopped.
 */
export interface CompanyMemory {
  idleTicks: Record<AgentId, number>;   // ticks spent idle in a row
  recalled: Record<AgentId, string[]>;  // lessons the agent last quoted, oldest first
  minds: Record<string, TaskMind>;      // open tasks whose agent already read the brain
  incidents: string[];                  // today's notable events, for the evening retro
  lastMarketNotes: string[];            // notes of the last market close
}

export interface WorldState {
  version: 1;
  runId: string;
  createdAt: string;          // ISO
  scenario: ScenarioConfig;
  day: number;
  tick: number;               // 0..TICKS_PER_DAY-1
  phase: DayPhase;
  rngState: number;
  idCounter: number;
  mind: { mode: MindMode; calls: number; inputTokens: number; outputTokens: number; costEur: number; fallbacks: number };
  status: 'running' | 'paused' | 'bankrupt' | 'goal_reached' | 'finished';
  company: CompanyState;
  market: MarketState;
  ledger: LedgerEntry[];
  activity: Activity[];       // ring buffer (last ~600)
  memory?: CompanyMemory;     // absent from older saves and until the company is mounted
}

// ───────────────────────────── What the UI receives ─────────────────────────────

/** Public, UI-safe view. `market` keeps only observable data (no NicheTruth). */
export interface CompanySnapshot {
  runId: string;
  scenario: ScenarioConfig;
  day: number; tick: number; phase: DayPhase; status: WorldState['status'];
  mind: WorldState['mind'];
  company: CompanyState;
  market: {
    inbox: InboxMessage[];          // most recent 80, the `intent` field left out (PublicInboxMessage; god mode: godMode.intents)
    adStats: DailyAdStats[];        // last 14 days
    organicPosts: OrganicPost[];    // last 30
    creators: CreatorProfile[];
    partnerships: Partnership[];
    events: WorldEvent[];           // last 40
    orders: Order[];                // last 100
    adAccount: MarketState['adAccount'];
    customersCount: number;
  };
  finance: FinanceSnapshot;
  ledger: LedgerEntry[];            // last 150
  activity: Activity[];             // last 200
  godMode?: {
    niches: Pick<NicheTruth, 'id' | 'name' | 'demand' | 'wtp' | 'competition' | 'tiktokAffinity' | 'hookAffinity'>[];
    intents: Record<string, MessageIntent>;   // message id → ground truth, for the messages of this snapshot
  };
  taskStats?: TaskStats;            // counted on every task, whatever company.tasks keeps
  adTotals?: AdTotals;              // counted on every ad row, whatever market.adStats keeps
  deliverableCounts?: Partial<Record<Deliverable['kind'], number>>; // the whole run, whatever company.deliverables keeps
  goalReachedDay?: number | null;   // the day the goal was reached, whatever market.events keeps
  session?: SessionInfo;            // live server loop state (play/pause, speed)
}

/** Tasks of one day: created counts on dayCreated; done, failed and cancelled on dayDone. */
export interface DayTaskCounts { day: number; created: number; done: number; failed: number; cancelled: number }

export interface DeptTaskCounts {
  days: DayTaskCounts[];            // last 14 days, oldest first, days without any task left out
  kinds7d: Partial<Record<TaskKind, number>>; // last 7 days (dayDone, else dayCreated), by kind
  done: number;                     // done tasks of the whole run
  failed: number;                   // failed or cancelled tasks of the whole run
  avgDelayDays: number | null;      // their average dayDone - dayCreated
}

export interface TaskStats {
  days: DayTaskCounts[];            // every day of the run with a task, oldest first
  depts: Partial<Record<DeptId, DeptTaskCounts>>;
}

export interface AdTotals {
  days: { day: number; spend: number; revenue: number }[]; // every day the market still holds, oldest first
  creatives: Record<string, CreativeAdTotals>;             // the whole life of the creatives of this snapshot
}

/** What moves on every tick: the light 'tick' event carries it between two full snapshots. */
export type LiveAgent = Pick<AgentState, 'id' | 'status' | 'place' | 'currentTaskId' | 'energy' | 'bubble'>;

// ───────────────────────────── HTTP API shapes (api/ ↔ web/) ─────────────────────────────

export type Speed = 1 | 2 | 4 | 8;

export interface SessionInfo {
  runId: string;
  playing: boolean;
  speed: Speed;
  intervalMs?: number;
  busy?: boolean;
  mindMode: MindMode;
  status?: WorldState['status'] | null;
  day?: number;
  tick?: number;
  lastError?: string | null;
  minStartingCash?: number;         // lowest budget POST /api/scenario accepts (EUR)
}

export interface RunInfo {
  runId: string; companyName: string; scenarioName: string; difficulty: string;
  day: number; status: WorldState['status']; cash: number; profit: number;
  createdAt: string; mtime: string;
  name?: string; updatedAt?: string; current?: boolean;
}

export interface ControlResponse { ok: boolean; status: WorldState['status']; speed: Speed; playing: boolean; message: string; session?: SessionInfo }
export interface MissionResponse { ok: boolean; missionId: string; status?: Mission['status']; message?: string }
export interface ChatResponse { reply: string }
export interface ApproveResponse { ok: boolean; message: string }

/** Server-sent events on GET /api/stream */
export type StreamEvent =
  | { type: 'snapshot'; snapshot: CompanySnapshot }
  | { type: 'activity'; activity: Activity[] }
  | { type: 'tick'; day: number; tick: number; phase: DayPhase; finance: FinanceSnapshot; agents?: LiveAgent[] };
