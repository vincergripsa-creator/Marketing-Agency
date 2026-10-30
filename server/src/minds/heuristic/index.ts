/**
 * Heuristic ContentEngine: offline, free, deterministic (engine seed + hash of the inputs).
 * Used for tests, demos, and as the per-call fallback of the Claude engine.
 */
import type {
  AdFormat, Broadcast, CompetitorProduct, CreatorProfile, DailyKpi, EmailStep, Experiment, FinanceSnapshot, HookStyle, InboxMessage, Lesson, MindMode,
  NicheBrief, Order, PdfContent, Product, QualityReport, SalesPage, SupportReplyInput, Task, TaskKind, TrendSignal, VoiceOfCustomer,
} from '../../shared.js';
import type {
  AdDraft, ContentEngine, DayPlan, DayPlanItem, GuideGaps, LessonDraft, MindContext, OpportunityRanking, Outline, RedTeamFacts, RedTeamVerdict, SearchAdDraft, UpsellContext,
} from '../../contracts.js';
import { parsePlaybook, scrubDeep, type PlaybookRules } from '../playbook.js';
import { deepClone, seededRng, type LocalRng } from '../util.js';
import { heuristicAd, heuristicHooks, heuristicOutreach } from './ads.js';
import { heuristicRedTeam, heuristicSalesPage } from './commerce.js';
import { heuristicChat, heuristicMemo, heuristicMission } from './direction.js';
import { heuristicFactCheck, heuristicHumanize } from './editing.js';
import { heuristicRanking } from './research.js';
import { heuristicOutline, heuristicPdfContent, heuristicTitles } from './studio.js';
import { heuristicSupportReply } from './support.js';

export interface HeuristicOptions { seed: number; brand?: string }

export type Usage = ReturnType<ContentEngine['usage']>;

export const DEFAULT_BRAND = 'Pixel Agency';

/** Brand: the scenario's company name (ctx.brand), else the engine option, else the bold name of the "Identité" brain note, else the default. */
export function resolveBrand(explicit: string | undefined, ctx: MindContext | undefined): string {
  if (ctx?.brand && ctx.brand.trim()) return ctx.brand.trim();
  if (explicit && explicit.trim()) return explicit.trim();
  for (const n of ctx?.brainNotes ?? []) {
    if (/identit/i.test(`${n.title} ${n.path}`)) {
      const m = /\*\*([^*\n]{2,40})\*\*/.exec(n.excerpt ?? '');
      if (m) return m[1]!.trim();
    }
  }
  return DEFAULT_BRAND;
}

export function nicheSubjects(n: Partial<NicheBrief> | null | undefined): string[] {
  return [n?.nicheId, n?.name, n?.problem, n?.audience].filter((x): x is string => typeof x === 'string' && x.length > 0);
}

export function productSubjects(p: Partial<Product> | null | undefined): string[] {
  return [p?.nicheId, p?.title, p?.problem, p?.audience].filter((x): x is string => typeof x === 'string' && x.length > 0);
}

export class HeuristicEngine implements ContentEngine {
  readonly mode: MindMode = 'heuristic';
  private readonly counters: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 };

  constructor(private readonly opts: HeuristicOptions) {}

/**
 * Texts naming the niche of a call, so that niche-scoped playbook rules (« … sur « Niche » ») only apply there.
 * Keys name what a text is about (title, customer's words), never a generated id: one more sale shifts every id
 * after it, and a product id in the key would rewrite the page and the ads of every later product.
 */
  private begin(method: string, ctx: MindContext | undefined, subjects: readonly (string | null | undefined)[], ...keys: (string | number | null | undefined)[]): { rng: LocalRng; rules: PlaybookRules } {
    this.counters.calls += 1;
    return {
      rng: seededRng(this.opts.seed, method, ctx?.agent?.id ?? '', ctx?.day ?? 0, ...keys),
      rules: parsePlaybook(ctx?.playbook, subjects),
    };
  }

  brand(ctx?: MindContext): string {
    return resolveBrand(this.opts.brand, ctx);
  }

  async rankOpportunities(input: { signals: TrendSignal[]; competitors: Record<string, CompetitorProduct[]>; voc: Record<string, VoiceOfCustomer>; excludeNicheIds: string[] }, ctx: MindContext): Promise<OpportunityRanking> {
    const { rules } = this.begin('rankOpportunities', ctx, []);
    const priceFor = (s: TrendSignal) => parsePlaybook(ctx?.playbook, [s.nicheId, s.name, s.audience]).targetPrice;
    return scrubDeep(heuristicRanking(input, priceFor), rules.banned);
  }

  async writeTitles(input: { niche: NicheBrief; voc: VoiceOfCustomer; count: number; upsellOf?: UpsellContext | null }, ctx: MindContext): Promise<string[]> {
    const { rng, rules } = this.begin('writeTitles', ctx, nicheSubjects(input.niche), input.niche?.nicheId, input.count);
    return scrubDeep(heuristicTitles(input.niche, input.voc, input.count, rng, input.upsellOf ?? null), rules.banned);
  }

  async writeOutline(input: { title: string; niche: NicheBrief; voc: VoiceOfCustomer; upsellOf?: UpsellContext | null; revision?: number }, ctx: MindContext): Promise<Outline> {
    const { rng, rules } = this.begin('writeOutline', ctx, nicheSubjects(input.niche), input.title, input.niche?.nicheId, ...(input.revision ? [input.revision] : []));
    return scrubDeep(heuristicOutline(input.title, input.niche, input.voc, rng, input.upsellOf ?? null), rules.banned);
  }

  async writePdfContent(input: { title: string; outline: Outline; niche: NicheBrief; voc: VoiceOfCustomer; upsellTitle: string | null; upsellOf?: UpsellContext | null; revision?: number }, ctx: MindContext): Promise<PdfContent> {
    const { rng, rules } = this.begin('writePdfContent', ctx, nicheSubjects(input.niche), input.title, input.niche?.nicheId, (input.outline?.chapters ?? []).map((c) => c.title).join('|'), ...(input.revision ? [input.revision] : []));
    return heuristicPdfContent(input, rng, { banned: rules.banned });
  }

  async humanize(input: { content: PdfContent; flagged: string[]; voc: VoiceOfCustomer; gaps?: GuideGaps | null }, ctx: MindContext): Promise<PdfContent> {
    const { rng, rules } = this.begin('humanize', ctx, [input.content?.title, input.voc?.nicheId], input.content?.title, (input.flagged ?? []).join('|'));
    return scrubDeep(heuristicHumanize(input.content, input.flagged ?? [], input.voc, rng, input.gaps ?? null), rules.banned);
  }

  async factCheck(input: { content: PdfContent; voc: VoiceOfCustomer }, ctx: MindContext): Promise<{ issues: string[]; content: PdfContent; claims?: string[] }> {
    const { rules } = this.begin('factCheck', ctx, [input.content?.title, input.voc?.nicheId]);
    const r = heuristicFactCheck(input.content, input.voc);
    return { issues: r.issues, content: scrubDeep(r.content, rules.banned), claims: r.claims };
  }

  async redTeam(input: { subject: 'idea' | 'pdf' | 'sales_page' | 'ad'; summary: string; quality: QualityReport | null; facts?: RedTeamFacts | null }, ctx: MindContext): Promise<RedTeamVerdict> {
    const { rules } = this.begin('redTeam', ctx, []);
    return scrubDeep(heuristicRedTeam(input), rules.banned);
  }

  async writeSalesPage(input: { product: Product; content: PdfContent; voc: VoiceOfCustomer; hype: number; upsellOf?: UpsellContext | null }, ctx: MindContext): Promise<SalesPage> {
    const { rng, rules } = this.begin('writeSalesPage', ctx, productSubjects(input.product), input.product?.title, input.hype);
    return scrubDeep(heuristicSalesPage(input, rng, { maxHype: rules.maxHype, banned: rules.banned, brand: this.brand(ctx) }), rules.banned);
  }

  async writeAdHooks(input: { product: Product; voc: VoiceOfCustomer; styles: HookStyle[]; upsellOf?: UpsellContext | null; usedHooks?: string[] }, ctx: MindContext): Promise<{ hookStyle: HookStyle; hook: string }[]> {
    const { rng, rules } = this.begin('writeAdHooks', ctx, productSubjects(input.product), input.product?.title, (input.styles ?? []).join(','));
    return scrubDeep(heuristicHooks(input, rng, rules.preferredHooks), rules.banned);
  }

  async writeAd(input: { product: Product; voc: VoiceOfCustomer; hook: string; hookStyle: HookStyle; format: AdFormat; bannedClaims: string[]; upsellOf?: UpsellContext | null }, ctx: MindContext): Promise<AdDraft> {
    const { rng, rules } = this.begin('writeAd', ctx, productSubjects(input.product), input.product?.title, input.hook, input.hookStyle, input.format);
    const draft = heuristicAd(input, rng, { banned: rules.banned, preferredFormats: rules.preferredFormats });
    return scrubDeep(draft, [...rules.banned, ...(input.bannedClaims ?? [])]);
  }

  async writeSupportReply(input: { message: InboxMessage; product: Product | null; order: Order | null; policy: string[]; customer?: { name: string; archetype: string } | null }, ctx: MindContext): Promise<SupportReplyInput> {
    const { rng, rules } = this.begin('writeSupportReply', ctx, productSubjects(input.product), input.message?.body);
    const r = heuristicSupportReply(input, rng, {
      tone: rules.supportTone ?? 'chaleureux',
      agent: ctx?.agent?.name || 'L’équipe',
      brand: this.brand(ctx),
      playbook: ctx?.playbook ?? [],
    });
    return scrubDeep(r, rules.banned);
  }

  async writeOutreach(input: { creator: CreatorProfile; product: Product; offer: { upfront: number; commission: number } }, ctx: MindContext): Promise<string> {
    const { rng, rules } = this.begin('writeOutreach', ctx, productSubjects(input.product), input.creator?.id, input.product?.title);
    return scrubDeep(heuristicOutreach(input, rng, { name: ctx?.agent?.name || 'L’équipe' }, this.brand(ctx)), rules.banned);
  }

  async planDay(input: { day: number; finance: FinanceSnapshot; kpis: DailyKpi[]; products: Product[]; openTasks: Task[]; lessons: Lesson[]; founderMissions: string[]; heuristicPlan: DayPlan }, ctx: MindContext): Promise<DayPlan> {
    this.begin('planDay', ctx, []);
    return input.heuristicPlan;
  }

  async interpretMission(input: { text: string; allowedKinds: TaskKind[] }, ctx: MindContext): Promise<DayPlanItem[]> {
    this.begin('interpretMission', ctx, []);
    return heuristicMission(input);
  }

  async chat(input: { history: { from: string; text: string }[]; text: string; situation: string }, ctx: MindContext): Promise<string> {
    const { rng, rules } = this.begin('chat', ctx, [], input.text);
    return scrubDeep(heuristicChat(input, ctx?.agent, rng, this.brand(ctx)), rules.banned);
  }

  async extractLessons(input: { kpis: DailyKpi[]; experiments: Experiment[]; incidents: string[]; heuristicLessons: LessonDraft[] }, ctx: MindContext): Promise<LessonDraft[]> {
    this.begin('extractLessons', ctx, []);
    return deepClone(input.heuristicLessons ?? []);
  }

  async dailyMemo(input: { day: number; kpi: DailyKpi; notes: string[] }, ctx: MindContext): Promise<string> {
    const { rules } = this.begin('dailyMemo', ctx, []);
    return scrubDeep(heuristicMemo(input), rules.banned);
  }

  // Land with P4.2 (writeSearchAd) and P11.2 (the other three). Nothing calls them before.

  async writeSearchAd(_input: { product: Product; voc: VoiceOfCustomer; bannedClaims: string[] }, _ctx: MindContext): Promise<SearchAdDraft> {
    throw new Error('not landed');
  }

  async writeLeadMagnet(_input: { product: Product; content: PdfContent; voc: VoiceOfCustomer }, _ctx: MindContext): Promise<PdfContent> {
    throw new Error('not landed');
  }

  async writeEmailSequence(_input: { product: Product; voc: VoiceOfCustomer; bannedClaims: string[] }, _ctx: MindContext): Promise<Omit<EmailStep, 'score'>[]> {
    throw new Error('not landed');
  }

  async writeBroadcast(_input: { product: Product; voc: VoiceOfCustomer; angle: string; audience: Broadcast['audience']; bannedClaims: string[] }, _ctx: MindContext): Promise<{ subject: string; body: string; hasUnsubscribe: boolean }> {
    throw new Error('not landed');
  }

  usage(): Usage {
    return { ...this.counters };
  }
}
