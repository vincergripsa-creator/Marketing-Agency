/** Studio PDF: 10 titles → outline that sells → full draft → humanize → fact-check. */
import type { ChapterContent, PdfContent, Product, QualityReport, VoiceOfCustomer } from '../../shared.js';
import type { Outline } from '../../contracts.js';
import type { RuntimeCtx } from '../ctx.js';
import { latestOutput, productBrief, productOf, say, vocOf } from '../ctx.js';
import { sim } from '../modules.js';
import { productNote } from '../notes.js';
import { directivesOf } from '../playbook.js';
import { capitalize, includesCI, keywords, short, splitSentences, uniq } from '../util.js';
import type { HandlerMap } from './common.js';
import { genericPhrases, NO_PRODUCT, requireProduct, reworkNotes, studioMind } from './common.js';

export function scoreContent(ctx: RuntimeCtx, product: Product, content: PdfContent): QualityReport {
  return sim.scorePdf(content, { audience: product.audience, problem: product.problem, voc: ctx.world.company.research.voc[product.nicheId], design: product.design });
}

function chapterTexts(c: ChapterContent): string[] {
  return [c.title, c.intro, ...c.paragraphs, ...c.steps, ...(c.example ? [c.example] : []), ...c.checklist];
}

export function contentTexts(content: PdfContent): string[] {
  return [
    content.title, content.subtitle, content.promise, ...content.introduction,
    ...content.chapters.flatMap(chapterTexts), ...chapterTexts(content.bonus), content.nextStep.title, content.nextStep.text,
  ].filter((t): t is string => typeof t === 'string' && t.length > 0);
}

/** Sentences containing a generic "AI" phrase or a banned expression from the playbook. */
export function flaggedSentences(content: PdfContent, phrases: readonly string[]): string[] {
  const out: string[] = [];
  for (const text of contentTexts(content)) {
    for (const s of splitSentences(text)) {
      if (phrases.some((p) => includesCI(s, p))) out.push(s);
    }
  }
  return uniq(out).slice(0, 40);
}

function scoreTitle(title: string, product: Product, voc: VoiceOfCustomer, banned: readonly string[]): number {
  const t = title.toLocaleLowerCase('fr');
  let s = 0;
  s += Math.min(6, keywords(product.audience).filter((w) => t.includes(w)).length * 2);
  s += Math.min(6, keywords(product.problem).filter((w) => t.includes(w)).length * 2);
  s += Math.min(4, keywords(voc.phrases.join(' ')).filter((w) => t.includes(w)).length);
  if (title.length >= 35 && title.length <= 90) s += 3;
  if (title.length > 110) s -= 3;
  if (genericPhrases().some((p) => includesCI(title, p))) s -= 5;
  if (banned.some((b) => includesCI(title, b))) s -= 10;
  return s;
}

function keepUpsellLink(product: Product, content: PdfContent): PdfContent {
  if (product.upsellProductId && content.nextStep) content.nextStep = { ...content.nextStep, upsellProductId: product.upsellProductId };
  return content;
}

export const studioHandlers: HandlerMap = {
  write_titles: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const voc = vocOf(ctx, product.nicheId);
      const brief = productBrief(ctx, product);
      let titles = (await ctx.engine.writeTitles({ niche: brief, voc, count: 10 }, studioMind(ctx, task, mind))).filter((t) => typeof t === 'string' && t.trim());
      if (!titles.length) titles = [`${capitalize(product.problem || brief.name)} : le guide pas à pas pour ${product.audience}`];
      const banned = directivesOf(ctx.world, agent.id).banned;
      const ranked = [...titles].sort((a, b) => scoreTitle(b, product, voc, banned) - scoreTitle(a, product, voc, banned));
      const chosen = ranked[0]!.trim();
      product.title = chosen;
      if (product.status === 'research' || product.status === 'idea') product.status = 'writing';
      await productNote(ctx, product, agent.id, '10 titres', titles.map((t) => (t === ranked[0] ? `- **${t}** ← retenu` : `- ${t}`)).join('\n'));
      say(ctx, agent.id, `${agent.name} choisit le titre « ${short(chosen, 80)} »`, 'thought', { productId: product.id });
      return { summary: `${titles.length} titres écrits, retenu : « ${short(chosen, 70)} »`, output: { titles, chosen } };
    },
  },

  write_outline: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const voc = vocOf(ctx, product.nicheId);
      const outline = await ctx.engine.writeOutline({ title: product.title, niche: productBrief(ctx, product), voc }, studioMind(ctx, task, mind));
      const body = [
        ...outline.chapters.map((c, i) => `${i + 1}. **${c.title}**${c.points.length ? ` — ${c.points.slice(0, 3).join(' · ')}` : ''}`),
        `- Bonus : ${outline.bonusTitle}`,
        `- Dernière page : ${outline.nextStepTitle}`,
      ].join('\n');
      await productNote(ctx, product, agent.id, 'Plan qui vend', body);
      return { summary: `Plan en ${outline.chapters.length} chapitres + bonus « ${short(outline.bonusTitle, 40)} »`, output: { outline } };
    },
  },

  write_pdf: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const voc = vocOf(ctx, product.nicheId);
      const m = studioMind(ctx, task, mind);
      const banned = directivesOf(ctx.world, agent.id).banned;
      let content: PdfContent;
      let mode: string;
      if (task.attempts > 0 && product.content) {
        // Rework after review: targeted pass on the flagged sentences and the reviewer's notes.
        const flagged = uniq([...flaggedSentences(product.content, [...genericPhrases(), ...banned]), ...reworkNotes(task)]);
        content = await ctx.engine.humanize({ content: product.content, flagged, voc }, m);
        mode = 'reprise';
      } else {
        const stored = latestOutput(ctx.world, 'write_outline', product.id)?.outline as Outline | undefined;
        const outline = stored && Array.isArray(stored.chapters) && stored.chapters.length
          ? stored
          : await ctx.engine.writeOutline({ title: product.title, niche: productBrief(ctx, product), voc }, m);
        const upsell = productOf(ctx, product.upsellProductId);
        content = await ctx.engine.writePdfContent({ title: product.title, outline, niche: productBrief(ctx, product), voc, upsellTitle: upsell?.title ?? null }, m);
        mode = task.input.rework === true ? `réécriture v${product.version}` : 'premier jet';
      }
      content = keepUpsellLink(product, content);
      product.content = content;
      if (content.subtitle) product.subtitle = content.subtitle;
      const q = scoreContent(ctx, product, content);
      product.quality = q;
      return {
        summary: `${capitalize(mode)} : ${content.chapters.length} chapitres, ${content.wordCount} mots — qualité ${q.overall}/100.`,
        output: { wordCount: content.wordCount, chapters: content.chapters.length, score: q.overall, mode },
      };
    },
  },

  humanize_pdf: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      if (!product.content) return { fail: 'Pas encore de texte à humaniser.', summary: 'Pas de contenu.' };
      const voc = vocOf(ctx, product.nicheId);
      const banned = directivesOf(ctx.world, agent.id).banned;
      const before = scoreContent(ctx, product, product.content);
      const flagged = uniq([...flaggedSentences(product.content, [...genericPhrases(), ...banned]), ...before.issues.filter((i) => /générique|IA|cliché|plat/i.test(i))]);
      const improved = keepUpsellLink(product, await ctx.engine.humanize({ content: product.content, flagged, voc }, studioMind(ctx, task, mind)));
      const after = scoreContent(ctx, product, improved);
      let kept = true;
      if (after.overall >= before.overall - 1) {
        product.content = improved;
        product.quality = after;
      } else {
        kept = false;
        product.quality = before;
      }
      say(ctx, agent.id, kept
        ? `${agent.name} a réécrit ${flagged.length} phrase(s) génériques (ton humain ${before.humanTone} → ${after.humanTone})`
        : `${agent.name} : la passe d'humanisation dégradait le texte, version précédente conservée`, 'thought', { productId: product.id });
      return {
        summary: `${flagged.length} phrase(s) signalée(s) ; qualité ${before.overall} → ${kept ? after.overall : before.overall}/100.`,
        output: { flagged: flagged.length, before: before.overall, after: kept ? after.overall : before.overall, kept },
      };
    },
  },

  fact_check: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      if (!product.content) return { fail: 'Rien à vérifier : le guide n’est pas écrit.', summary: 'Pas de contenu.' };
      const voc = vocOf(ctx, product.nicheId);
      const res = await ctx.engine.factCheck({ content: product.content, voc }, studioMind(ctx, task, mind));
      product.content = keepUpsellLink(product, res.content ?? product.content);
      const q = scoreContent(ctx, product, product.content);
      product.quality = q;
      say(ctx, agent.id, res.issues.length
        ? `${agent.name} corrige ${res.issues.length} point(s) : ${short(res.issues[0]!, 70)}`
        : `${agent.name} : aucune affirmation douteuse, tout est sourcé.`, 'thought', { productId: product.id });
      return { summary: `${res.issues.length} point(s) corrigé(s) — qualité ${q.overall}/100, conformité ${q.compliance}/100.`, output: { issues: res.issues, score: q.overall } };
    },
  },
};
