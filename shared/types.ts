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

import type { ChannelId, AdAccountId } from './channels.js';
export type { ChannelId, AdAccountId };

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
  org?: OrgConfig;             // absent = LEGACY_ORG (older saves); defaultScenario fills LEAN_ORG
  talent?: TalentMode;         // absent = 'off'; defaultScenario fills 'league'
  channelControl?: ChannelControl; // absent = 'tiktok_only'; defaultScenario fills 'none'
  videoModel?: 'on' | 'off';   // absent = 'off'; defaultScenario fills 'on'
  visualModel?: 'on' | 'off';  // absent = 'off'; defaultScenario fills 'on'
  scaling?: boolean;           // absent = false; defaultScenario fills true. Gates company decisions only
  openEnded?: boolean;         // no end: horizonDays only frames the goal. newRun() passes true
  control?: ScenarioControls;
}

// ───────────────────────────── Organisation ─────────────────────────────

export type DeptId =
  | 'direction' | 'recherche' | 'studio' | 'creation' | 'growth' | 'boutique'
  | 'support' | 'analyse' | 'finance' | 'rh' | 'partenariats' | 'video' | 'crm';

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
  deskHigh?: number; // highest desk index + 1 ever used, never goes down
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
  | 'web.page' | 'team.delegate' | 'team.review' | 'ads.channels' | 'ads.report';

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
  roleId: RoleId;
  gender: 'f' | 'm';
  founder: boolean;
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
  hatKinds: TaskKind[];        // kinds worn outside the role, at ORG.hatSpeed
  hatDepts: DeptId[];          // departments of those kinds (lesson routing, chat facts)
  hiredDay: number;            // 0 = founding team
  rampUntilDay: number;        // last day at ORG.rampSpeed
  notice: { day: number; reason: string; by: AgentId; kind: Alumnus['kind'] } | null; // decided, waits for the replacement
  desk?: number;               // stable desk index inside the department, 0 = chief
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
  | 'performance_review'  // RH: weekly agent reviews
  | 'headcount_review' | 'recruit' | 'league_review'
  | 'open_channel' | 'adapt_creative' | 'write_search_ads' | 'reconcile_channels' | 'allocate_channels'
  | 'write_lead_magnet' | 'write_email_sequence' | 'send_broadcast' | 'design_bump' | 'portfolio_review';

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
  figure?: VisualSpec | null;  // a second visual: `visual` stays the chapter's tool (often a sheet)
  margin?: { note: string | null; quote: string | null };
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
  type: 'timeline' | 'bar_chart' | 'checklist_card' | 'quote' | 'steps_diagram' | 'icon_grid' | 'do_dont' | 'grid' | 'cycle' | 'plan_path' | 'decision_tree' | 'before_after' | 'matrix' | 'gauge' | 'step_path';
  title: string;
  labels: string[];
  values: number[];           // for charts (0..100); empty otherwise
  grid?: GridSpec;            // required when type === 'grid'
  cycle?: { nodes: string[]; breakAt: number; center: string };
  plan?: { days: number; unit: string; tracks: { from: number; to: number; label: string }[] };
  tree?: { question: string; cases: { when: string; then: string }[] };
  pairs?: { before: string; after: string }[];
  matrix?: { heads: [string, string, string, string]; cells: [string[], string[], string[], string[]] };
  gauge?: { rows: string[]; low: string; high: string };
  path?: { stations: { label: string; when: string | null; duration: string | null }[] };
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
  voice?: TypeVoice;
  inks?: InkSet;
  artSeed?: number;            // the art candidate kept by the designer; absent = design.seed
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
  ratingSum?: number; ratingCount?: number; // exact rating after reviews are capped
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
  files: { pdf: string | null; cover: string | null; salesPage: string | null; previews?: string[] }; // run-relative paths
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
  visual?: VisualReport | null;
  kind?: 'guide' | 'kit';      // absent = 'guide'
  bumpProductId?: string | null;
  leadMagnet?: { title: string; file: string; day: number } | null;
  versionDay?: number;         // compaction: replaces versionSince on tasks
  feedback?: { day: number; text: string; quality: boolean }[]; // cap 30
  hooks?: { hook: string; hookStyle: HookStyle }[];             // cap 60
  campaignCount?: number;
}

// ───────────────────────────── TikTok ads (virtual platform) ─────────────────────────────

export type HookStyle = 'question' | 'contrarian' | 'story' | 'stat' | 'pov' | 'mistake' | 'before_after' | 'listicle';
export type AdFormat = 'faceless_voiceover' | 'text_slideshow' | 'ugc_avatar' | 'carousel' | 'static_image' | 'search_text';

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
  ratio?: AdRatio;             // absent = '9:16'
  masterId?: string | null;    // the creative this one is a cut of: same script, another ratio. Fatigue is shared by the family
  channelReviews?: Partial<Record<ChannelId, ChannelReview>>; // every channel but TikTok
  search?: { headlines: string[]; descriptions: string[]; keywords: string[] }; // format 'search_text' only
  duelId?: string;
  cut?: VideoCut | null;       // absent on old saves: the old formulas apply
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
  channel?: ChannelId;         // absent = 'tiktok'
  learning?: { events: number; exitedDay: number | null; days?: number }; // channels with a learning phase. days: delivered since it (re)started
  test?: boolean;              // paid by the test envelope, left alone by the allocator until its verdict
  seq?: number;                // D50: stable stream key, survives compaction. Absent = array index
}

export interface CampaignInputShape {
  productId: string; name: string; creativeIds: string[]; dailyBudget: number;
  targeting: Campaign['targeting']; createdBy: AgentId;
  channel?: ChannelId; test?: boolean;
}

export interface AdComment { author: string; text: string; tone: 'positive' | 'negative' | 'troll' | 'question' }

export interface DailyAdStats {
  day: number; campaignId: string; creativeId: string; productId: string;
  spend: number; impressions: number; clicks: number; ctr: number; cpc: number; cpm: number;
  landingViews: number; purchases: number; revenue: number; roas: number;
  frequency: number;          // creative fatigue indicator
  comments: AdComment[];
  channel?: ChannelId;
  claimedPurchases?: number;   // what the platform's dashboard says it sold; absent = same as purchases
  claimedRevenue?: number;
  tail?: true;                 // free clicks of a paid pin: no spend that day
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
  source: 'ads' | 'organic' | 'creator' | 'upsell' | 'email' | 'bump';
  campaignId: string | null; creatorId: string | null;
  refunded: boolean; chargeback: boolean;
  refundedDay?: number | null;  // day of the refund / chargeback, for exact daily attribution
  refundedAmount?: number;      // EUR already given back (goodwill gesture, refund, chargeback), never above price
  charges?: number;             // card debits in the payment log (2 = a real double charge)
  downloads?: number;           // PDF downloads in the delivery log (0 = the buyer never got the file)
  channel?: ChannelId; // last click, observable
}

export type MessageIntent =
  | 'question' | 'non_recu' | 'remboursement' | 'plainte_qualite' | 'sur_mesure' | 'partenariat'
  | 'arnaque' | 'compliment' | 'troll' | 'menace_chargeback' | 'bug_paiement';

export interface InboxMessage {
  id: string;
  day: number;
  customerId: string;
  channel: 'email' | 'commentaire_tiktok' | 'commentaire_pub' | 'avis' | 'dm';
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
  | 'tool_subscription' | 'compute' | 'creator_payout' | 'scam_loss' | 'discount' | 'salary' | 'recruiting';

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
  channels?: { channel: ChannelId; spend: number; reconciledRevenue: number; roas: number | null }[]; // absent = TikTok alone
}

export interface FinanceSnapshot {
  cash: number;
  revenue: number; refunds: number; adSpend: number; fees: number; compute: number; otherCosts: number;
  payroll?: number;           // cumulative 'salary' + 'recruiting', no longer inside otherCosts
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
  bestChannelBuzz?: number; // best noisy audience over open channels, once 2 are open
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
  dimension: 'hook_style' | 'ad_format' | 'price' | 'sales_hype' | 'support_tone' | 'niche' | 'agent_duel';
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
  channels?: Partial<Record<ChannelId, ChannelDayKpi>>; // absent = every row of the day is TikTok's
}

// ───────────────────────────── World events & activity ─────────────────────────────

export type WorldEventKind =
  | 'cpm_spike' | 'cpm_drop' | 'ad_rejected' | 'ad_account_warning' | 'ad_account_banned' | 'viral_organic'
  | 'competitor_clone' | 'payment_hold' | 'trend_shift' | 'bad_review_wave' | 'scam_attempt' | 'creator_offer'
  | 'platform_outage' | 'seasonal_boost' | 'goal_reached' | 'bankrupt' | 'channel_opened' | 'channel_account_banned';

export interface WorldEvent {
  id: string; day: number; kind: WorldEventKind; title: string; description: string; severity: 'info' | 'warn' | 'danger' | 'good';
  refs?: { productId?: string; nicheId?: string; creativeId?: string; creatorId?: string; day?: number }; // day: the announced day (platform_outage)
}

export type ActivityKind =
  | 'thought' | 'brain_read' | 'brain_write' | 'delegate' | 'task_start' | 'task_done' | 'task_failed'
  | 'review' | 'deliverable' | 'sale' | 'refund' | 'ad' | 'message' | 'event' | 'finance' | 'lesson'
  | 'walk' | 'coffee' | 'meeting' | 'founder' | 'chat' | 'org';

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
  kind: 'pdf' | 'cover' | 'sales_page' | 'ad_storyboard' | 'ad_preview' | 'report' | 'research' | 'note' | 'page_preview' | 'lead_magnet' | 'email_sequence';
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
  channels?: Partial<Record<Exclude<ChannelId, 'tiktok'>, ChannelCell>>; // TikTok keeps tiktokAffinity and cpmBase
  videoTempo?: VideoTempo;     // hidden, learnable
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
  channels?: ChannelMarketState;
  audience?: AudienceState;
  rivals?: Rival[];
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
  org?: OrgState;
  league?: LeagueState;
  channels?: ChannelBook;
  growth?: GrowthState;
  lastDone?: Record<string, number>; // `${kind}:${productId}` → day: compaction keeps lastScan, lastScout, lastPage
  taskTotals?: TaskTotals;
  archive?: ArchiveCounters;
  cashOnlyCreators?: string[];
}

/**
 * A standing decision of the founder: the plan and the handlers respect it until it ends, whatever their own rules
 * say. An order lasts until he lifts it; a refusal lasts for a cooldown.
 */
export interface FounderHold {
  id: string;
  kind: 'ads' | 'advances' | 'launches' | 'product' | 'hiring' | 'firing' | 'pin' | 'emails'; // paid ads (all, or one product's), creators' advances, new products, one product off sale
  productId: string | null;
  day: number;
  until: number | null;     // last day it holds, null until lifted
  reason: string;           // French, read in the feed
  liftedDay?: number;
  channel?: ChannelId | null;  // « coupe Meta »
  agentId?: AgentId;           // kind 'pin'
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
  version: 1 | 2;
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
  talentTruth?: TalentTruth;
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
    channelAccounts?: Partial<Record<AdAccountId, ChannelAccountState>>;
    audience?: AudienceView;
  };
  finance: FinanceSnapshot;
  ledger: LedgerEntry[];            // last 150
  activity: Activity[];             // last 200
  godMode?: {
    talent?: Record<AgentId, TalentTruthView>;
    niches: Pick<NicheTruth, 'id' | 'name' | 'demand' | 'wtp' | 'competition' | 'tiktokAffinity' | 'hookAffinity' | 'channels'>[];
    intents: Record<string, MessageIntent>;   // message id → ground truth, for the messages of this snapshot
  };
  taskStats?: TaskStats;            // counted on every task, whatever company.tasks keeps
  adTotals?: AdTotals;              // counted on every ad row, whatever market.adStats keeps
  deliverableCounts?: Partial<Record<Deliverable['kind'], number>>; // the whole run, whatever company.deliverables keeps
  goalReachedDay?: number | null;   // the day the goal was reached, whatever market.events keeps
  session?: SessionInfo;            // live server loop state (play/pause, speed)
  scene?: SceneView;
  counts?: { creatives: number; deliverables: number; lessons: number; messages: number; products: number };
  videos?: Record<string, CreativeVideo>; // filled by the API layer, never from the world
  archive?: ArchiveCounters;
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
  pace?: 'live' | 'away';
  watchers?: number;
  backoffMs?: number | null;   // set while the loop waits after incidents
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
  | { type: 'video'; creativeId: string; video: CreativeVideo }
  | { type: 'tick'; day: number; tick: number; phase: DayPhase; finance: FinanceSnapshot; agents?: LiveAgent[] };

// ───────────────────────────── Scenario: the V1 switches ─────────────────────────────

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

// ───────────────────────────── Organisation: roles, hires, departures ─────────────────────────────

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

// ───────────────────────────── Talent ─────────────────────────────
// Truth sits next to `market`, never under `company`.

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

export interface SkillRating {
  skill: Skill;
  rating: number;              // Elo-like, par = 1500
  rd: number;                  // uncertainty, 200 → 70
  n: number;                   // evidence events, all time
  seasonN: number;             // this season (weighted sum)
  metric: number | null;       // the role's readable number: mean QA score, reply score…
  metricBase?: { season: number; sum: number; w: number }; // what `metric` is the mean of: it restarts with each season (P3.4)
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

// ───────────────────────────── Channels ─────────────────────────────
// ChannelId and AdAccountId come from shared/channels.ts.

export type AdRatio = '9:16' | '4:5' | '1:1' | '2:3' | 'text';
export interface ChannelReview { status: 'pending' | 'approved' | 'rejected'; reason: string | null; day: number | null; rule?: string }

export interface ChannelDayKpi {
  spend: number;               // Σ ledger ad_spend of the channel's campaigns; Σ over channels = DailyKpi.adSpend to the cent
  impressions: number; clicks: number; landingViews: number;
  shopSales: number; shopRevenue: number;
  claimedSales: number; claimedRevenue: number;
  reconciledRevenue: number;   // Σ over channels = Σ shopRevenue
  roas: number;                // reconciledRevenue / spend
}

/** Hidden market truth for one (niche, channel). Never in a snapshot, except god mode. */
export interface ChannelCell {
  fit: number;                 // 0..1 audience fit, role of tiktokAffinity
  cpmMult: number;             // × n.cpmBase
  intent: number;              // CVR multiplier of a landing view
  poolShare: number;           // this channel's daily buyer pool / the niche's pool
  searchClicksPerDemand?: number; // google: full-coverage clicks a day at demand 1
  cpcBase?: number;            // google
}
export interface ChannelAccountState { strikes: number; banned: boolean; bannedUntilDay: number; openDay: number | null } // null = never requested
export interface ChannelMarketState {
  accounts: Record<'meta' | 'google' | 'pinterest', ChannelAccountState>; // market.adAccount stays TikTok's
  impressions: Partial<Record<Exclude<ChannelId, 'tiktok'>, Record<string, number>>>; // by creative family; TikTok keeps creativeImpressions
  warm: Record<string, number>; // nicheId → stock of paid exposures
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

// ───────────────────────────── Video ─────────────────────────────

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

// ───────────────────────────── PDF ─────────────────────────────

export type TypeVoice = 'conte' | 'dossier' | 'atelier' | 'signal';
export interface InkSet { paper: string; ink: string; a: string; b: string; c: string }
export interface DesignEffort { covers: number; layouts: number; taste: number; finish: 0 | 1 | 2 }
export interface VisualReport {
  version: 1;
  cover: number; interior: number; overall: number; // 0..100; overall = 0.55 cover + 0.45 interior
  effort: DesignEffort;
  explored: number;            // real count of candidates
  issues: string[];            // French, actionable
}

// ───────────────────────────── Scale ─────────────────────────────

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

// ───────────────────────────── What the interface reads ─────────────────────────────

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
