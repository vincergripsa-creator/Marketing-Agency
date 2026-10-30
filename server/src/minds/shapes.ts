/**
 * Shape guards: every value leaving the minds is complete and correctly typed, whatever the
 * source (a Claude JSON reply, a hand-edited outline, a half-filled content object).
 * `fb` is the heuristic value used to fill whatever is missing or invalid.
 */
import type { ChapterContent, PdfContent, VisualSpec } from '../shared.js';
import { clampNum, clean, isStr, strArr } from './util.js';

export const VISUAL_TYPES: readonly VisualSpec['type'][] = ['timeline', 'bar_chart', 'checklist_card', 'quote', 'steps_diagram', 'icon_grid', 'do_dont'];

export function str(v: unknown, fb: string): string {
  return isStr(v) ? clean(v) : fb;
}

export function arr(v: unknown, fb: string[], min = 1, max = 50): string[] {
  const a = strArr(v).slice(0, max);
  return a.length >= min ? a : fb.slice(0, max);
}

export function ensureVisual(v: unknown, fb: VisualSpec | null): VisualSpec | null {
  if (!v || typeof v !== 'object') return fb;
  const o = v as Record<string, unknown>;
  const type = VISUAL_TYPES.includes(o.type as VisualSpec['type']) ? (o.type as VisualSpec['type']) : null;
  if (!type) return fb;
  const labels = strArr(o.labels).slice(0, 8);
  if (labels.length === 0) return fb;
  let values: number[] = [];
  if (type === 'bar_chart') {
    const raw = Array.isArray(o.values) ? o.values : [];
    values = labels.map((_, i) => Math.round(clampNum(raw[i], 0, 100, Math.max(10, 80 - i * 12))));
  }
  return { type, title: str(o.title, fb?.title ?? 'Repères'), labels, values };
}

export function ensureChapter(v: unknown, fb: ChapterContent): ChapterContent {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const steps = arr(o.steps, fb.steps, 3, 6);
  return {
    title: str(o.title, fb.title),
    intro: str(o.intro, fb.intro),
    paragraphs: arr(o.paragraphs, fb.paragraphs, 1, 6),
    steps: steps.length >= 3 ? steps : fb.steps,
    example: o.example === null ? (fb.example ?? null) : str(o.example, fb.example ?? '') || null,
    checklist: arr(o.checklist, fb.checklist, 2, 8),
    visual: ensureVisual(o.visual, fb.visual),
  };
}

const EMPTY_CHAPTER: ChapterContent = { title: 'Chapitre', intro: '', paragraphs: [], steps: [], example: null, checklist: [], visual: null };

/** Make any (possibly partial) content safe to iterate. `fb` fills the gaps when given. */
export function ensurePdf(v: unknown, fb?: PdfContent): PdfContent {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const f: PdfContent = fb ?? {
    title: 'Guide', subtitle: '', audience: '', promise: '', introduction: [], chapters: [], bonus: EMPTY_CHAPTER,
    nextStep: { title: 'La suite est ici', text: '', upsellProductId: null }, wordCount: 0,
  };
  const rawCh = Array.isArray(o.chapters) ? o.chapters : [];
  const chapters = rawCh.length >= (fb ? 5 : 0)
    ? rawCh.slice(0, 7).map((c, i) => ensureChapter(c, f.chapters[i] ?? f.chapters[f.chapters.length - 1] ?? EMPTY_CHAPTER))
    : f.chapters;
  const ns = (o.nextStep && typeof o.nextStep === 'object' ? o.nextStep : {}) as Record<string, unknown>;
  return {
    title: str(o.title, f.title),
    subtitle: str(o.subtitle, f.subtitle),
    audience: str(o.audience, f.audience),
    promise: str(o.promise, f.promise),
    introduction: arr(o.introduction, f.introduction, fb ? 2 : 0, 8),
    chapters,
    bonus: ensureChapter(o.bonus, f.bonus),
    nextStep: {
      title: str(ns.title, f.nextStep.title),
      text: str(ns.text, f.nextStep.text),
      upsellProductId: typeof ns.upsellProductId === 'string' ? ns.upsellProductId : f.nextStep.upsellProductId,
    },
    wordCount: typeof o.wordCount === 'number' ? o.wordCount : f.wordCount,
  };
}

/** Visit every text field of a PdfContent with its French location label. */
export function forEachText(p: PdfContent, fn: (text: string, loc: string) => string): PdfContent {
  const ch = (c: ChapterContent, loc: string): ChapterContent => ({
    ...c,
    title: fn(c.title, loc),
    intro: fn(c.intro, loc),
    paragraphs: c.paragraphs.map((x) => fn(x, loc)).filter((x) => x.trim().length > 0),
    steps: c.steps.map((x) => fn(x, loc)).filter((x) => x.trim().length > 0),
    example: c.example ? fn(c.example, loc) || null : null,
    checklist: c.checklist.map((x) => fn(x, loc)).filter((x) => x.trim().length > 0),
  });
  return {
    ...p,
    title: fn(p.title, 'Titre'),
    subtitle: fn(p.subtitle, 'Sous-titre'),
    promise: fn(p.promise, 'Promesse'),
    introduction: p.introduction.map((x) => fn(x, 'Introduction')).filter((x) => x.trim().length > 0),
    chapters: p.chapters.map((c, i) => ch(c, `Chapitre ${i + 1}`)),
    bonus: ch(p.bonus, 'Bonus'),
    nextStep: { ...p.nextStep, title: fn(p.nextStep.title, 'Page « La suite »'), text: fn(p.nextStep.text, 'Page « La suite »') },
  };
}
