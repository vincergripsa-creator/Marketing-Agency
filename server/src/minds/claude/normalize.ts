/**
 * Claude JSON → contract types. Whatever is missing, malformed or out of range is taken from the
 * heuristic result computed for the same call, so the output is always complete and typed.
 */
import type { AdFormat, AdScene, HookStyle, MessageIntent, PdfContent, Product, SalesPage, SupportReplyInput, TaskKind } from '../../shared.js';
import type { AdDraft, DayPlan, DayPlanItem, LessonDraft, OpportunityRanking, Outline, RedTeamVerdict, UpsellContext } from '../../contracts.js';
import { noPrice, screenText } from '../heuristic/ads.js';
import { KIND_DEPT, KIND_TITLE } from '../heuristic/direction.js';
import { pdfWordCount } from '../heuristic/studio.js';
import { NAMED_CASE } from '../lexicon.js';
import { AD_FORMATS, HOOK_STYLES } from '../playbook.js';
import { arr, ensurePdf, forEachText, str } from '../shapes.js';
import { bare, clampNum, clean, composeTitle, fit, isStr, norm, splitSentences, strArr, uniqStrings } from '../util.js';
import { ACTIONS, INTENTS, LESSON_TOPICS } from './schemas.js';

type O = Record<string, unknown>;
const asObj = (v: unknown): O => (v && typeof v === 'object' && !Array.isArray(v) ? (v as O) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function nRanking(raw: unknown, fb: OpportunityRanking): OpportunityRanking {
  const known = new Map(fb.ranked.map((r) => [r.nicheId, r]));
  const seen = new Set<string>();
  const out: OpportunityRanking['ranked'] = [];
  for (const x of asArr(asObj(raw).ranked)) {
    const o = asObj(x);
    const id = typeof o.nicheId === 'string' ? o.nicheId : '';
    const base = known.get(id);
    if (!base || seen.has(id)) continue;
    seen.add(id);
    out.push({
      nicheId: id,
      score: Math.round(clampNum(o.score, 0, 100, base.score)),
      why: str(o.why, base.why),
      angle: str(o.angle, base.angle),
      audience: str(o.audience, base.audience),
      problem: str(o.problem, base.problem),
      suggestedPrice: Math.round(clampNum(o.suggestedPrice, 9, 49, base.suggestedPrice)),
    });
  }
  if (out.length === 0) return fb;
  for (const r of fb.ranked) if (!seen.has(r.nicheId)) out.push(r);
  out.sort((a, b) => b.score - a.score);
  return { ranked: out };
}

export function nTitles(raw: unknown, fb: string[], count: number, upsellOf: UpsellContext | null = null): string[] {
  const n = count > 0 ? Math.floor(count) : fb.length;
  const parent = norm(upsellOf?.parentTitle ?? '');
  // a title is whole (≤ 95 chars, one « : » at most, no ellipsis): anything else is dropped, not truncated
  const t = uniqStrings([...strArr(asObj(raw).titles).filter((x) => composeTitle([x], 95) !== null && norm(x) !== parent), ...fb]);
  return t.slice(0, n);
}

export function nOutline(raw: unknown, fb: Outline, upsellOf: UpsellContext | null = null): Outline {
  const o = asObj(raw);
  const chapters = asArr(o.chapters).map((c, i) => {
    const co = asObj(c);
    const base = fb.chapters[i] ?? fb.chapters[fb.chapters.length - 1]!;
    return { title: str(co.title, base.title), points: arr(co.points, base.points, 2, 6) };
  }).filter((c) => c.title);
  // a follow-up guide never reuses a section of its parent
  const parent = new Set((upsellOf?.parentChapterTitles ?? []).map(norm));
  const fresh = chapters.every((c) => !parent.has(norm(c.title)));
  return {
    title: str(o.title, fb.title),
    chapters: fresh && chapters.length >= 5 && chapters.length <= 7 ? chapters : fb.chapters,
    bonusTitle: str(o.bonusTitle, fb.bonusTitle),
    nextStepTitle: str(o.nextStepTitle, fb.nextStepTitle),
  };
}

export function nPdf(raw: unknown, fb: PdfContent, upsellOf: UpsellContext | null = null): PdfContent {
  const p = ensurePdf(raw, fb);
  p.nextStep.upsellProductId = fb.nextStep.upsellProductId;
  p.audience = fb.audience || p.audience;
  // the printable the bonus promises must exist, whatever the answer drew
  if (fb.bonus.visual?.type === 'grid' && p.bonus.visual?.type !== 'grid') p.bonus.visual = fb.bonus.visual;
  if (upsellOf) {
    if (norm(p.title) === norm(upsellOf.parentTitle)) p.title = fb.title;
    if (norm(p.promise) === norm(upsellOf.parentPromise)) p.promise = fb.promise;
    const parent = new Set(upsellOf.parentChapterTitles.map(norm));
    if (p.chapters.some((c) => parent.has(norm(c.title)))) p.chapters = fb.chapters;
  }
  p.wordCount = pdfWordCount(p);
  // a much shorter answer than the target is a truncated / lazy one: keep the full heuristic draft
  return p.wordCount < 1200 && fb.wordCount > p.wordCount ? fb : p;
}

/** Apply sentence-level replacements (exact substring first, then normalised sentence match). */
export function applyReplacements(content: PdfContent, raw: unknown): { content: PdfContent; applied: number } {
  const reps = asArr(asObj(raw).replacements)
    .map((r) => ({ original: clean(asObj(r).original as string), replacement: clean(asObj(r).replacement as string) }))
    .filter((r) => r.original.length >= 6);
  let applied = 0;
  const out = forEachText(content, (text) => {
    let t = text;
    for (const r of reps) {
      if (t.includes(r.original)) { t = t.split(r.original).join(r.replacement); applied++; continue; }
      const key = norm(bare(r.original));
      const sents = splitSentences(t);
      let hit = false;
      const next = sents.map((s) => {
        if (norm(bare(s)) === key) { hit = true; return r.replacement; }
        return s;
      });
      if (hit) { t = next.filter(Boolean).join(' '); applied++; }
    }
    return t.replace(/\s{2,}/g, ' ').trim();
  });
  out.wordCount = pdfWordCount(out);
  return { content: out, applied };
}

export function nRedTeam(raw: unknown, fb: RedTeamVerdict, compliance: number | null): RedTeamVerdict {
  const o = asObj(raw);
  let verdict = (['go', 'fix', 'kill'] as const).includes(o.verdict as 'go') ? (o.verdict as RedTeamVerdict['verdict']) : fb.verdict;
  if (verdict === 'go' && compliance !== null && compliance < 35) verdict = 'fix';
  return { verdict, reasons: arr(o.reasons, fb.reasons, 1, 8), fixes: arr(o.fixes, fb.fixes, verdict === 'go' ? 0 : 1, 6) };
}

export function nSalesPage(raw: unknown, fb: SalesPage): SalesPage {
  const o = asObj(raw);
  const blurbs = asArr(o.chapterBlurbs).map((b, i) => {
    const bo = asObj(b);
    const base = fb.chapterBlurbs[i];
    return { title: str(bo.title, base?.title ?? ''), blurb: str(bo.blurb, base?.blurb ?? '') };
  }).filter((b) => b.title && b.blurb);
  const objections = asArr(o.objections).map((x) => ({ q: str(asObj(x).q, ''), a: str(asObj(x).a, '') })).filter((x) => x.q && x.a);
  return {
    headline: fit(str(o.headline, fb.headline), 140),
    subheadline: str(o.subheadline, fb.subheadline),
    painBullets: arr(o.painBullets, fb.painBullets, 3, 6),
    solution: str(o.solution, fb.solution),
    chapterBlurbs: blurbs.length >= Math.min(3, fb.chapterBlurbs.length) ? blurbs : fb.chapterBlurbs,
    bonusBlurb: str(o.bonusBlurb, fb.bonusBlurb),
    objections: objections.length ? objections.slice(0, 6) : fb.objections,
    guarantee: str(o.guarantee, fb.guarantee),
    cta: fit(str(o.cta, fb.cta), 80),
    hypeLevel: fb.hypeLevel,
  };
}

export function nHooks(raw: unknown, fb: { hookStyle: HookStyle; hook: string }[]): { hookStyle: HookStyle; hook: string }[] {
  const got = new Map<HookStyle, string>();
  for (const h of asArr(asObj(raw).hooks)) {
    const o = asObj(h);
    const s = o.hookStyle as HookStyle;
    if (HOOK_STYLES.includes(s) && isStr(o.hook) && !got.has(s)) got.set(s, fit(clean(o.hook), 90));
  }
  return fb.map((f) => ({ hookStyle: f.hookStyle, hook: got.get(f.hookStyle) ?? f.hook }));
}

export function nAd(raw: unknown, fb: AdDraft, input: { hookStyle: HookStyle; format: AdFormat; product?: Product | null }): AdDraft {
  const o = asObj(raw);
  // an ad outlives the price of the day, and a named person with a result is never a proof
  const clear = (s: string): string => noPrice(s, input.product?.price);
  const usable = (s: string): boolean => !NAMED_CASE.test(s);
  let scenes: AdScene[] = asArr(o.scenes).map((s, i) => {
    const so = asObj(s);
    const base = fb.scenes[Math.min(i, fb.scenes.length - 1)]!;
    const onScreen = clear(str(so.onScreenText, base.onScreenText));
    const voiceover = clear(str(so.voiceover, base.voiceover));
    return {
      visual: str(so.visual, base.visual),
      onScreenText: screenText(usable(onScreen) ? onScreen : base.onScreenText),
      voiceover: usable(voiceover) ? voiceover : base.voiceover,
      durationSec: Math.round(clampNum(so.durationSec, 1, 10, base.durationSec)),
    };
  });
  if (scenes.length < 4 || scenes.length > 6) scenes = fb.scenes;
  let total = scenes.reduce((a, s) => a + s.durationSec, 0);
  while (total > 30) { const l = scenes.reduce((a, b) => (b.durationSec > a.durationSec ? b : a)); l.durationSec -= 1; total -= 1; }
  while (total < 12) { scenes[Math.min(2, scenes.length - 1)]!.durationSec += 1; total += 1; }
  const tags = uniqStrings(strArr(o.hashtags).map((h) => `#${norm(h).replace(/[^a-z0-9]/g, '')}`).filter((h) => h.length > 2));
  const hook = clear(str(o.hook, fb.hook));
  const caption = clear(str(o.caption, fb.caption));
  return {
    hook: fit(usable(hook) ? hook : fb.hook, 90),
    hookStyle: HOOK_STYLES.includes(input.hookStyle) ? input.hookStyle : fb.hookStyle,
    format: AD_FORMATS.includes(input.format) ? input.format : fb.format,
    scenes,
    caption: fit(usable(caption) ? caption : fb.caption, 300),
    hashtags: tags.length >= 4 ? tags.slice(0, 6) : fb.hashtags,
    cta: clear(str(o.cta, fb.cta)),
  };
}

export function nSupport(raw: unknown, fb: SupportReplyInput, signature: string): SupportReplyInput {
  const o = asObj(raw);
  const intent = INTENTS.includes(o.detectedIntent as MessageIntent) ? (o.detectedIntent as MessageIntent) : fb.detectedIntent;
  const action = (ACTIONS as readonly string[]).includes(o.action as string) ? (o.action as SupportReplyInput['action']) : fb.action;
  let text = typeof o.text === 'string' ? o.text.trim() : fb.text;
  if (action !== 'ignore' && !text) text = fb.text;
  if (text && action !== 'ignore' && !/service client/i.test(text)) text = `${text}\n\n${signature}`;
  return { detectedIntent: intent, action, text };
}

export function nText(raw: unknown, fb: string, max = 2000): string {
  const t = asObj(raw).text;
  return isStr(t) ? fit(t.trim(), max) : fb;
}

export function nPlan(raw: unknown, fb: DayPlan): DayPlan {
  const o = asObj(raw);
  const order: number[] = [];
  const prio = new Map<number, 1 | 2 | 3>();
  const why = new Map<number, string>();
  for (const x of asArr(o.items)) {
    const xo = asObj(x);
    const i = typeof xo.index === 'number' ? Math.floor(xo.index) : -1;
    if (i < 0 || i >= fb.items.length || order.includes(i)) continue;
    order.push(i);
    prio.set(i, Math.round(clampNum(xo.priority, 1, 3, fb.items[i]!.priority)) as 1 | 2 | 3);
    if (isStr(xo.why)) why.set(i, clean(xo.why));
  }
  for (let i = 0; i < fb.items.length; i++) if (!order.includes(i)) order.push(i); // nothing the runtime planned is dropped
  return {
    focus: str(o.focus, fb.focus),
    memo: str(o.memo, fb.memo),
    items: order.map((i) => ({ ...fb.items[i]!, priority: prio.get(i) ?? fb.items[i]!.priority, why: why.get(i) ?? fb.items[i]!.why })),
  };
}

export function nMission(raw: unknown, fb: DayPlanItem[], allowed: readonly TaskKind[], text: string): DayPlanItem[] {
  const ok = new Set(allowed);
  const items: DayPlanItem[] = [];
  for (const x of asArr(asObj(raw).items)) {
    const o = asObj(x);
    const kind = o.kind as TaskKind;
    if (!ok.has(kind) || items.some((i) => i.kind === kind)) continue;
    const price = typeof o.price === 'number' && Number.isFinite(o.price) && o.price > 0 ? Math.round(o.price * 100) / 100 : null;
    items.push({
      kind,
      title: str(o.title, KIND_TITLE[kind]),
      dept: KIND_DEPT[kind],
      priority: Math.round(clampNum(o.priority, 1, 3, 2)) as 1 | 2 | 3,
      input: { missionText: text, ...(price !== null ? { price } : {}) },
      why: str(o.why, `Le fondateur a demandé : « ${fit(text, 140)} »`),
    });
  }
  return items.length ? items.slice(0, 6) : fb;
}

export function nLessons(raw: unknown, fb: LessonDraft[]): LessonDraft[] {
  const out: LessonDraft[] = [];
  for (const x of asArr(asObj(raw).lessons)) {
    const o = asObj(x);
    const topic = (LESSON_TOPICS as readonly string[]).includes(o.topic as string) ? (o.topic as LessonDraft['topic']) : null;
    if (!topic || !isStr(o.insight)) continue;
    out.push({
      topic,
      insight: fit(clean(o.insight), 220),
      evidence: str(o.evidence, ''),
      confidence: clampNum(o.confidence, 0, 1, 0.5),
      appliesToRoles: strArr(o.appliesToRoles).slice(0, 6),
    });
  }
  return out.length ? out.slice(0, 8) : fb;
}
