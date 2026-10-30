/**
 * Heuristic quality scorers (0..100) with French, actionable issues. Used by QA agents AND by the
 * market itself (the conversion model trusts these, not the company's self-assessment).
 */
import { clamp } from '../core/index.js';
import type {
  AdCreative, ChapterContent, DesignSpec, InboxMessage, MessageIntent, PdfContent, Product, QualityReport, SalesPage,
  SupportReplyInput, VoiceOfCustomer,
} from '../shared.js';
import { countHype, findBannedClaims } from './compliance.js';
import { countPhrase, countWords, hasPhrase, keyTokens, norm, overlap, stemSet } from './text.js';

/** French AI clichés: each occurrence costs human tone. */
export const GENERIC_PHRASES: readonly string[] = [
  'chaque bébé est différent', 'chaque enfant est différent', 'chaque situation est unique', 'chaque parcours est unique',
  'soyez patient', 'soyez patiente', 'soyez patients', 'il est important de noter', 'il est important de souligner',
  "n'hésitez pas à", 'en conclusion', "dans le monde d'aujourd'hui", 'dans le monde actuel', 'il est essentiel de',
  'plongeons dans', 'plongeons ensemble', 'en fin de compte', 'il convient de souligner', 'il convient de noter',
  'force est de constater', 'à l\'ère du numérique', 'il va sans dire', 'que vous soyez débutant ou expert',
  'libérez votre potentiel', 'votre plein potentiel', 'le secret réside dans', 'la clé du succès', 'la patience est la clé',
  'faites-vous confiance', 'écoutez votre corps', 'prenez soin de vous', 'rappelez-vous que', "gardez à l'esprit que",
  "il n'y a pas de solution miracle", 'sans plus attendre', 'un véritable atout', 'un outil puissant', 'pour résumer',
  'en somme', 'dans ce guide complet', 'au cœur de', 'faire toute la différence', 'chaque petit pas compte',
];

type Parts = Pick<QualityReport, 'specificity' | 'structure' | 'actionability' | 'humanTone' | 'design' | 'promiseMatch' | 'compliance'>;
type Weights = Record<keyof Parts, number>;

/** Issues grouped by dimension, so the final list covers every weak spot instead of the first one only. */
class IssueList {
  private groups = new Map<keyof Parts, string[]>();
  private current: keyof Parts = 'structure';
  section(k: keyof Parts): void { this.current = k; }
  push(msg: string): void {
    const g = this.groups.get(this.current) ?? [];
    g.push(msg);
    this.groups.set(this.current, g);
  }
  /** Round-robin: compliance first, then the weakest dimensions first. */
  merge(parts: Parts, max = 12): string[] {
    const keys = [...this.groups.keys()].sort((a, b) => (a === 'compliance' ? -1 : b === 'compliance' ? 1 : parts[a] - parts[b]));
    const out: string[] = [];
    for (let i = 0; out.length < max; i++) {
      let added = false;
      for (const k of keys) {
        const g = this.groups.get(k)!;
        if (i < g.length && out.length < max) { out.push(g[i]!); added = true; }
      }
      if (!added) break;
    }
    return out;
  }
}

function report(parts: Parts, weights: Weights, issues: IssueList, cap?: number): QualityReport {
  const p = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(clamp(v, 0, 100))])) as Parts;
  let overall = 0;
  for (const k of Object.keys(weights) as (keyof Parts)[]) overall += p[k] * weights[k];
  if (cap !== undefined) overall = Math.min(overall, cap);
  return { overall: Math.round(clamp(overall, 0, 100)), ...p, issues: issues.merge(p), evaluator: 'heuristic' };
}

function quote(xs: string[], n = 3): string {
  return xs.slice(0, n).map((x) => `« ${x} »`).join(', ');
}

/** Generic phrases present in a normalised text (with total occurrence count). */
export function genericPhraseHits(normText: string): { total: number; found: string[] } {
  let total = 0;
  const found: string[] = [];
  for (const g of GENERIC_PHRASES) {
    const c = countPhrase(normText, g);
    if (c > 0) { total += c; found.push(g); }
  }
  return { total, found };
}

/** How many customer phrases / pains are reused (4-word windows) in the text. */
export function vocPhraseHits(normText: string, voc?: VoiceOfCustomer): number {
  if (!voc) return 0;
  let hits = 0;
  for (const phrase of [...voc.phrases, ...voc.pains]) {
    const words = norm(phrase).split(/[^a-z0-9']+/).filter(Boolean);
    if (words.length === 0) continue;
    const size = Math.min(4, words.length);
    for (let i = 0; i + size <= words.length; i++) {
      const win = words.slice(i, i + size).join(' ');
      if (win.length >= 12 && normText.includes(win)) { hits++; break; }
    }
  }
  return hits;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => countWords(s) >= 3);
}

/** Share of sentences starting with the most frequent first word (0 when < 12 sentences). */
function repetitiveStarts(text: string): { share: number; word: string } {
  const ss = sentences(text);
  if (ss.length < 12) return { share: 0, word: '' };
  const counts = new Map<string, number>();
  for (const s of ss) {
    const w = norm(s).split(/[^a-z0-9']+/).find(Boolean) ?? '';
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let best = ''; let n = 0;
  for (const [w, c] of counts) if (c > n) { best = w; n = c; }
  return { share: n / ss.length, word: best };
}

function capsShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 20) return 0;
  const upper = letters.filter((l) => l === l.toUpperCase() && l !== l.toLowerCase()).length;
  return upper / letters.length;
}

function chapterText(c: ChapterContent): string {
  return [c.title, c.intro, ...(c.paragraphs ?? []), ...(c.steps ?? []), c.example ?? '', ...(c.checklist ?? [])].join('\n');
}

export function pdfText(content: PdfContent): string {
  return [
    content.title, content.subtitle, content.promise, ...(content.introduction ?? []),
    ...(content.chapters ?? []).map(chapterText), content.bonus ? chapterText(content.bonus) : '',
    content.nextStep?.title ?? '', content.nextStep?.text ?? '',
  ].join('\n');
}

const CONCRETE_RE = /\d|\bmin\b|minutes?|heures?|\bh\b|jours?|semaines?|fois|€|%/i;

// ───────────────────────────── PDF ─────────────────────────────

export function scorePdf(content: PdfContent, ctx: { audience: string; problem: string; voc?: VoiceOfCustomer; design?: DesignSpec | null }): QualityReport {
  const issues = new IssueList();
  const chapters = content?.chapters ?? [];
  const nCh = chapters.length;
  const full = pdfText(content);
  const normFull = norm(full);
  const words = countWords(full);
  const audTok = keyTokens(`${ctx.audience} ${content?.audience ?? ''}`);
  const probTok = keyTokens(ctx.problem);
  const titleStems = stemSet(`${content?.title ?? ''} ${content?.subtitle ?? ''}`);

  // specificity — rule of one: one problem, one audience, concrete markers
  issues.section('specificity');
  let spec = 0;
  if (/\d/.test(`${content?.title ?? ''} ${content?.subtitle ?? ''}`)) spec += 15;
  else issues.push('Le titre ne contient aucun repère précis (âge, durée, nombre) : ajoutez-en un, par ex. « de 6 à 12 mois » ou « en 30 jours ».');
  const audInTitle = overlap(audTok, titleStems);
  spec += 20 * Math.min(1, audInTitle * 2.5);
  if (audInTitle === 0) issues.push(`Le titre ne dit pas pour qui est le guide : nommez l'audience (« ${ctx.audience} »).`);
  const probInTitle = overlap(probTok, titleStems);
  spec += 20 * Math.min(1, probInTitle * 2.5);
  if (probInTitle === 0) issues.push('Le titre ne nomme pas le problème avec les mots des clients.');
  const aud = content?.audience ?? '';
  if (aud.length >= 15 && (/\d/.test(aud) || keyTokens(aud).length >= 3)) spec += 10;
  else issues.push('Audience trop vague : précisez âge, situation ou métier (règle du un).');
  if (nCh > 0) {
    const audShare = chapters.filter((c) => overlap(audTok, stemSet(chapterText(c))) > 0).length / nCh;
    spec += 20 * audShare;
    if (audShare < 0.5) issues.push("L'audience disparaît au fil des chapitres : parlez-lui directement dans chaque chapitre.");
    const probShare = chapters.filter((c) => overlap(probTok, stemSet(chapterText(c))) > 0).length / nCh;
    spec += 15 * probShare;
    if (probShare < 0.5) issues.push('Plusieurs chapitres s\'éloignent du problème central : un guide = un seul problème.');
    if (nCh > 12) { spec -= 10; issues.push(`${nCh} chapitres : le guide se disperse, regroupez en 5 à 9 chapitres.`); }
  }

  // structure — intro, ≥5 chapters, numbered steps, examples, bonus, next step
  issues.section('structure');
  let struct = 0;
  const intro = content?.introduction ?? [];
  struct += intro.length >= 2 ? 15 : intro.length === 1 ? 8 : 0;
  if (intro.length === 0) issues.push("Pas d'introduction : reformulez le problème et dites ce que le lecteur aura à la fin.");
  struct += nCh >= 5 ? 25 : nCh === 4 ? 16 : nCh === 3 ? 10 : nCh * 3;
  if (nCh < 5) issues.push(`Seulement ${nCh} chapitre(s) : visez au moins 5 chapitres en étapes.`);
  if (nCh > 0) {
    const stepShare = chapters.filter((c) => (c.steps?.length ?? 0) >= 3).length / nCh;
    struct += 15 * stepShare;
    if (stepShare < 0.6) issues.push('Trop de chapitres sans étapes numérotées (au moins 3 par chapitre).');
    const exShare = chapters.filter((c) => (c.example ?? '').length > 40).length / nCh;
    struct += 15 * exShare;
    if (exShare === 0) issues.push('Aucun exemple concret : ajoutez des cas réels (prénom, âge, situation, ce qui a marché).');
    else if (exShare < 0.4) issues.push('Peu d\'exemples concrets : un exemple par chapitre rend le guide crédible.');
  }
  const bonus = content?.bonus;
  if (bonus && bonus.title && ((bonus.paragraphs?.length ?? 0) + (bonus.steps?.length ?? 0) + (bonus.checklist?.length ?? 0)) > 0) struct += 15;
  else issues.push('Pas de chapitre bonus : il permet d\'annoncer un « cadeau inclus » sur la page de vente.');
  if (content?.nextStep?.title && (content.nextStep.text ?? '').length > 30) struct += 15;
  else issues.push('Pas de page finale « La suite est ici » vers le guide suivant (upsell).');

  // actionability — density and concreteness of steps / checklists
  issues.section('actionability');
  const allSteps = chapters.flatMap((c) => c.steps ?? []);
  const items = allSteps.length + chapters.reduce((s, c) => s + (c.checklist?.length ?? 0), 0);
  const perChapter = items / Math.max(1, nCh);
  let action = Math.min(70, perChapter * 10);
  if (allSteps.length > 0) {
    action += 15 * (allSteps.filter((s) => countWords(s) >= 6).length / allSteps.length);
    action += 15 * Math.min(1, (allSteps.filter((s) => CONCRETE_RE.test(s)).length / allSteps.length) * 1.6);
  }
  if (perChapter < 5) issues.push('Pas assez d\'actions concrètes : ajoutez étapes et checklists (au moins 5 par chapitre).');
  if (words < 1500) { action *= 0.6; issues.push(`Guide trop mince (${words} mots) : un acheteur attend au moins 3 000 mots utiles.`); }
  else if (words < 3000) { action *= 0.85; issues.push(`Contenu un peu court (${words} mots) : développez les étapes et les exemples.`); }

  // human tone — generic AI clichés, repetitive sentence starts, customer words reused
  issues.section('humanTone');
  const generic = genericPhraseHits(normFull);
  let human = 82 - Math.min(60, generic.total * 7);
  if (generic.total > 0) issues.push(`${generic.total} phrase(s) générique(s) « IA » détectée(s) (${quote(generic.found)}) : remplacez-les par des détails tirés des avis clients.`);
  const rep = repetitiveStarts(full);
  if (rep.share > 0.2) {
    human -= Math.min(20, (rep.share - 0.2) * 100);
    issues.push(`Trop de phrases commencent par « ${rep.word} » : variez les débuts de phrase.`);
  }
  const voc = vocPhraseHits(normFull, ctx.voc);
  human += Math.min(18, voc * 5);
  if (ctx.voc && voc === 0) issues.push('Aucune phrase de client reprise : citez leurs mots exacts (« il se réveille toutes les 2 h »…).');

  // design — visuals per chapter, design spec, variety
  issues.section('design');
  let design = 0;
  if (nCh > 0) {
    const visuals = chapters.filter((c) => !!c.visual);
    design += 55 * (visuals.length / nCh);
    const kinds = new Set(visuals.map((c) => c.visual!.type)).size;
    design += kinds >= 3 ? 20 : kinds === 2 ? 10 : 0;
    if (visuals.length / nCh < 0.5) issues.push('Moins d\'un chapitre sur deux a un visuel : ajoutez frises, checklists ou schémas d\'étapes.');
  }
  if (ctx.design) design += 25;
  else issues.push('Aucune charte graphique (DesignSpec) : la mise en page sera générique.');

  // compliance — risky claims (health, money, guarantees)
  issues.section('compliance');
  const banned = findBannedClaims([full], ctx.voc?.bannedClaims ?? []);
  const compliance = 100 - banned.length * 18;
  if (banned.length) issues.push(`Allégations risquées à retirer : ${quote(banned, 4)}.`);

  return report(
    { specificity: spec, structure: struct, actionability: action, humanTone: human, design, promiseMatch: 100, compliance },
    { specificity: 0.2, structure: 0.15, actionability: 0.2, humanTone: 0.17, design: 0.1, promiseMatch: 0.03, compliance: 0.15 },
    issues,
    compliance < 60 ? 40 + compliance / 2 : undefined,
  );
}

// ───────────────────────────── Sales page ─────────────────────────────

const INFORMAL_RE = /\b(je|j'|mon|ma|mes|il se|elle se|on |tu )|«|"/i;
const CTA_VERBS = /^(je |j'|télécharg|telecharg|obten|recev|commenc|accéd|acced|découvr|decouvr|profit|prends|récupèr|recuper|lire|essayer|ajouter)/i;

/** Promise gap measured on hype + exaggeration words vs. the PDF's real quality (0 = matched). */
export function promiseGap(hypeLevel: number, hypeWords: number, pdfOverall: number): number {
  const promise = clamp(hypeLevel, 0, 1) + 0.05 * hypeWords;
  const allowed = pdfOverall / 100 - 0.15;
  return Math.max(0, promise - allowed);
}

export function scoreSalesPage(sp: SalesPage, product: Product, voc?: VoiceOfCustomer): QualityReport {
  const issues = new IssueList();
  const audTok = keyTokens(product.audience);
  const probTok = keyTokens(product.problem);
  const headline = sp?.headline ?? '';
  const hStems = stemSet(`${headline} ${sp?.subheadline ?? ''}`);
  const pains = sp?.painBullets ?? [];
  const blurbs = sp?.chapterBlurbs ?? [];
  const objections = sp?.objections ?? [];

  issues.section('specificity');
  let spec = 0;
  if (/\d/.test(headline)) spec += 20; else issues.push('Le titre de la page ne contient aucun repère chiffré (âge, durée, résultat).');
  const aud = overlap(audTok, hStems); spec += 25 * Math.min(1, aud * 2.5);
  if (aud === 0) issues.push("Le titre de la page ne dit pas à qui s'adresse le guide.");
  const prob = overlap(probTok, hStems); spec += 25 * Math.min(1, prob * 2.5);
  if (prob === 0) issues.push('Le titre de la page ne nomme pas la douleur principale.');
  if (headline.length >= 25 && headline.length <= 110) spec += 15; else issues.push('Titre de page trop court ou trop long (25 à 110 caractères).');
  if ((sp?.subheadline ?? '').length >= 20) spec += 15; else issues.push('Ajoutez un sous-titre qui précise la promesse.');

  issues.section('structure');
  let struct = 0;
  struct += pains.length >= 4 ? 20 : pains.length >= 2 ? 10 : 0;
  if (pains.length < 4) issues.push('Moins de 4 puces de douleur : appuyez sur le problème avec les mots des clients.');
  const chCount = product.content?.chapters?.length ?? 5;
  struct += blurbs.length >= Math.min(5, chCount) ? 20 : blurbs.length > 0 ? 10 : 0;
  if (blurbs.length === 0) issues.push('Le contenu n\'est pas détaillé chapitre par chapitre.');
  if ((sp?.bonusBlurb ?? '').length > 15) struct += 15; else issues.push('Le bonus offert n\'est pas mis en avant.');
  struct += objections.length >= 3 ? 20 : objections.length > 0 ? 10 : 0;
  if (objections.length < 3) issues.push('Traitez au moins 3 objections (« encore un PDF ChatGPT ? », « j\'ai déjà tout essayé »…).');
  if ((sp?.guarantee ?? '').length > 15) struct += 15; else issues.push('Aucune garantie claire (ex. « satisfait ou remboursé 14 jours »).');
  if ((sp?.cta ?? '').length > 3) struct += 10; else issues.push('Pas d\'appel à l\'action.');

  issues.section('actionability');
  let action = 0;
  const cta = (sp?.cta ?? '').trim();
  if (cta && CTA_VERBS.test(cta) && cta.length <= 45) action += 50;
  else if (cta) { action += 25; issues.push('Appel à l\'action peu clair : commencez par un verbe (« Je télécharge le guide »).'); }
  const sol = sp?.solution ?? '';
  if (sol.length >= 80 && sol.length <= 700) action += 30; else issues.push('La section solution doit expliquer la méthode en 2 à 5 phrases.');
  if (blurbs.length) action += 20 * (blurbs.filter((b) => countWords(b.blurb ?? '') >= 8).length / blurbs.length);

  const allText = [headline, sp?.subheadline, ...pains, sol, ...blurbs.map((b) => `${b.title} ${b.blurb}`), sp?.bonusBlurb, ...objections.map((o) => `${o.q} ${o.a}`), cta].join('\n');
  const normAll = norm(allText);
  issues.section('humanTone');
  const generic = genericPhraseHits(normAll);
  let human = 70 - Math.min(50, generic.total * 8);
  if (generic.total) issues.push(`Phrases génériques sur la page : ${quote(generic.found)}.`);
  if (pains.length) {
    const vocHit = voc ? pains.filter((p) => vocPhraseHits(norm(p), voc) > 0).length : 0;
    const informal = pains.filter((p) => INFORMAL_RE.test(p)).length;
    human += 30 * Math.min(1, (Math.max(vocHit * 1.5, informal) / pains.length));
    if (vocHit === 0 && informal === 0) issues.push('Les puces de douleur ne reprennent pas les mots des clients (formulations vécues, à la première personne).');
  }

  let design = 40 + (product.design ? 30 : 0);
  if (blurbs.length) design += 30 * (blurbs.filter((b) => (b.title ?? '').length > 3).length / blurbs.length);
  if (objections.length) design = Math.min(100, design) * (0.85 + 0.15 * (objections.filter((o) => (o.a ?? '').length >= 20).length / objections.length));

  issues.section('promiseMatch');
  const hype = countHype([headline, sp?.subheadline, sol, cta]);
  const pdfQ = product.quality?.overall ?? 60;
  const gap = promiseGap(sp?.hypeLevel ?? 0.5, hype, pdfQ);
  const promiseMatch = 100 - gap * 150;
  if (gap > 0.15) issues.push(`La page promet plus que le guide ne livre (niveau de promesse ${Math.round((sp?.hypeLevel ?? 0) * 100)} % pour un PDF à ${Math.round(pdfQ)}/100) : risque de remboursements.`);

  issues.section('compliance');
  const nonGuarantee = [headline, sp?.subheadline, ...pains, sol, ...blurbs.map((b) => `${b.title} ${b.blurb}`), sp?.bonusBlurb, ...objections.map((o) => `${o.q} ${o.a}`), cta];
  const banned = [...findBannedClaims(nonGuarantee, voc?.bannedClaims ?? [])];
  for (const b of findBannedClaims([sp?.guarantee], voc?.bannedClaims ?? [])) if (!banned.includes(b)) banned.push(b);
  const compliance = 100 - banned.length * 20;
  if (banned.length) issues.push(`Allégations interdites sur la page : ${quote(banned, 4)}.`);

  return report(
    { specificity: spec, structure: struct, actionability: action, humanTone: human, design, promiseMatch, compliance },
    { specificity: 0.2, structure: 0.2, actionability: 0.1, humanTone: 0.15, design: 0.05, promiseMatch: 0.15, compliance: 0.15 },
    issues,
    compliance < 60 ? 40 + compliance / 2 : undefined,
  );
}

// ───────────────────────────── Ad creative ─────────────────────────────

const SOLUTION_RE = /guide|methode|pdf|etapes?|plan|routine|programme|checklist|fiches?|astuces?|technique/;
const CTA_RE = /lien|bio|telecharg|clique|decouvr|recupere|commande|profil|guide/;

export function scoreCreative(c: AdCreative, product: Product, voc?: VoiceOfCustomer): QualityReport {
  const issues = new IssueList();
  const scenes = c?.scenes ?? [];
  const hook = (c?.hook ?? '').trim();
  const normHook = norm(hook);
  const audTok = keyTokens(product.audience);
  const probTok = [...keyTokens(product.problem), ...keyTokens(product.title)];
  const sceneText = scenes.map((s) => `${s.onScreenText} ${s.voiceover}`).join('\n');
  const allText = [hook, sceneText, c?.caption, c?.cta, (c?.hashtags ?? []).join(' ')].join('\n');
  const normAll = norm(allText);

  issues.section('specificity');
  let spec = 0;
  const hookStems = stemSet(`${hook} ${scenes[0]?.onScreenText ?? ''} ${scenes[0]?.voiceover ?? ''}`);
  const hookRel = Math.max(overlap(audTok, hookStems), overlap(probTok, hookStems));
  spec += 30 * Math.min(1, hookRel * 3);
  if (hookRel === 0) issues.push('Le hook ne parle ni du problème ni de la cible : on doit se reconnaître en 2 secondes.');
  if (/\d/.test(hook)) spec += 15;
  const vocHits = vocPhraseHits(normAll, voc);
  spec += voc ? Math.min(30, vocHits * 15) : 15;
  if (voc && vocHits === 0) issues.push('Aucun mot de client repris dans la pub : citez une phrase vraie (« dès que je le pose il hurle »).');
  const tags = c?.hashtags?.length ?? 0;
  spec += tags >= 3 && tags <= 8 ? 10 : tags > 0 ? 5 : 0;
  const genericHook = genericPhraseHits(normHook).total;
  spec += genericHook ? 0 : 15;

  issues.section('structure');
  let struct = 0;
  const first = norm(`${scenes[0]?.onScreenText ?? ''} ${scenes[0]?.voiceover ?? ''}`);
  const hookTokens = keyTokens(hook);
  const hookInFirst = hookTokens.length > 0 && overlap(hookTokens, stemSet(first)) >= 0.5;
  if (hookInFirst) struct += 20; else issues.push('Le hook doit apparaître dans la première scène (2 premières secondes).');
  if (hook.length >= 25 && hook.length <= 90) struct += 15;
  else if (hook.length > 0 && hook.length <= 120) { struct += 7; issues.push('Hook trop court ou trop long : visez 25 à 90 caractères.'); }
  else issues.push('Hook absent ou beaucoup trop long.');
  const restStems = stemSet(scenes.slice(0, Math.max(1, scenes.length - 1)).map((s) => `${s.onScreenText} ${s.voiceover}`).join(' '));
  const painOk = overlap(probTok, restStems) > 0 || (voc ? vocPhraseHits(norm(sceneText), voc) > 0 : false);
  if (painOk) struct += 15; else issues.push('La douleur n\'est pas montrée avant la solution.');
  const solOk = SOLUTION_RE.test(norm(sceneText));
  if (solOk) struct += 15; else issues.push('La solution (le guide, la méthode) n\'apparaît pas clairement.');
  const last = norm(`${scenes[scenes.length - 1]?.onScreenText ?? ''} ${scenes[scenes.length - 1]?.voiceover ?? ''} ${c?.cta ?? ''}`);
  const ctaOk = CTA_RE.test(last);
  if (ctaOk) struct += 15; else issues.push('Pas d\'appel à l\'action à la fin (« lien en bio », « télécharge le guide »).');
  struct += scenes.length >= 3 && scenes.length <= 7 ? 20 : scenes.length === 2 || scenes.length === 8 || scenes.length === 9 ? 8 : 0;
  if (scenes.length < 3 || scenes.length > 7) issues.push(`${scenes.length} scène(s) : visez 3 à 7 scènes.`);

  issues.section('actionability');
  let action = 0;
  if ((c?.cta ?? '').length > 3 && CTA_RE.test(norm(c.cta))) action += 60; else if ((c?.cta ?? '').length > 3) action += 30;
  const duration = scenes.reduce((s, x) => s + (Number.isFinite(x.durationSec) ? x.durationSec : 0), 0);
  if (duration >= 12 && duration <= 30) action += 40;
  else if (duration >= 9 && duration <= 40) { action += 20; issues.push(`Durée ${Math.round(duration)} s : le format idéal est 12 à 30 secondes.`); }
  else issues.push(`Durée ${Math.round(duration)} s hors format (12 à 30 secondes).`);

  issues.section('humanTone');
  let human = 80 - Math.min(40, genericPhraseHits(normAll).total * 10);
  if (voc) human += Math.min(20, vocHits * 8);
  const hype = countHype([hook, sceneText, c?.caption]);
  human -= Math.min(20, hype * 6);

  issues.section('design');
  let design = 0;
  if (scenes.length) {
    const shortText = scenes.filter((s) => (s.onScreenText ?? '').length > 0 && (s.onScreenText ?? '').length <= 70 && countWords(s.onScreenText) <= 12).length / scenes.length;
    design += 50 * shortText;
    if (shortText < 0.7) issues.push('Textes à l\'écran trop longs : 12 mots maximum par scène.');
    design += 30 * (scenes.filter((s) => (s.visual ?? '').length >= 10).length / scenes.length);
    const fmtOk = c.format === 'text_slideshow' ? scenes.every((s) => (s.onScreenText ?? '').length > 0)
      : c.format === 'carousel' ? scenes.length >= 4
        : scenes.every((s) => (s.voiceover ?? '').length > 0);
    design += fmtOk ? 20 : 0;
    if (!fmtOk) issues.push(`Les scènes ne respectent pas le format « ${c.format} » (voix off / texte / nombre de slides).`);
  }

  issues.section('promiseMatch');
  const promiseMatch = 100 - hype * 15;
  if (hype >= 2) issues.push('Trop de superlatifs (« incroyable », « secret »…) : ça sonne arnaque et augmente les refus.');

  issues.section('compliance');
  const banned = findBannedClaims([allText], voc?.bannedClaims ?? []);
  const compliance = 100 - banned.length * 30;
  if (banned.length) issues.push(`Refus probable par TikTok : ${quote(banned, 4)}.`);

  return report(
    { specificity: spec, structure: struct, actionability: action, humanTone: human, design, promiseMatch, compliance },
    { specificity: 0.22, structure: 0.25, actionability: 0.1, humanTone: 0.13, design: 0.1, promiseMatch: 0.05, compliance: 0.15 },
    issues,
    compliance < 60 ? 35 + compliance / 2 : undefined,
  );
}

// ───────────────────────────── Support reply ─────────────────────────────

type Action = SupportReplyInput['action'];
interface ActionRule { right: Action[]; ok: Action[]; danger: Action[] }

const DOUBLE_CHARGE_RE = /deux fois|2 fois|double|debite deux|preleve deux/;

export function actionRule(msg: Pick<InboxMessage, 'intent' | 'body'>): ActionRule {
  switch (msg.intent) {
    case 'question': return { right: ['none', 'resend_link'], ok: ['discount_code', 'escalate'], danger: [] };
    case 'non_recu': return { right: ['resend_link'], ok: ['refund'], danger: ['block'] };
    case 'remboursement': return { right: ['refund'], ok: ['discount_code', 'escalate'], danger: ['block'] };
    case 'plainte_qualite': return { right: ['refund', 'discount_code'], ok: ['none', 'escalate'], danger: ['block'] };
    case 'sur_mesure': return { right: ['none', 'escalate'], ok: ['discount_code'], danger: ['block'] };
    case 'partenariat': return { right: ['none', 'ignore', 'block'], ok: ['escalate'], danger: ['refund', 'discount_code'] };
    case 'arnaque': return { right: ['block', 'ignore'], ok: ['none'], danger: ['refund', 'discount_code', 'resend_link'] };
    case 'compliment': return { right: ['none'], ok: ['discount_code'], danger: ['block'] };
    case 'troll': return { right: ['ignore', 'none'], ok: ['block'], danger: ['refund', 'discount_code'] };
    case 'menace_chargeback': return { right: ['refund'], ok: ['escalate'], danger: ['block', 'ignore'] };
    case 'bug_paiement':
      return DOUBLE_CHARGE_RE.test(norm(msg.body ?? ''))
        ? { right: ['refund'], ok: ['resend_link', 'escalate'], danger: ['block'] }
        : { right: ['resend_link', 'none'], ok: ['escalate', 'refund'], danger: ['block'] };
    default: return { right: ['none'], ok: ['escalate'], danger: [] };
  }
}

const RELATED: [MessageIntent, MessageIntent][] = [
  ['remboursement', 'menace_chargeback'], ['remboursement', 'plainte_qualite'], ['non_recu', 'bug_paiement'],
  ['question', 'sur_mesure'], ['question', 'non_recu'], ['troll', 'arnaque'], ['partenariat', 'arnaque'], ['plainte_qualite', 'troll'],
];

function related(a: MessageIntent, b: MessageIntent): boolean {
  return RELATED.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

const EMPATHY = ['desole', 'navre', 'je comprends', 'nous comprenons', 'merci', 'toutes nos excuses', 'excusez', 'pardon pour', 'je suis vraiment', 'avec plaisir', 'ravi', 'ravie'];
const SIGN_OFF = ['cordialement', 'bien a vous', 'belle journee', 'bonne journee', 'bonne soiree', 'a bientot', "l'equipe", 'service client', 'au plaisir', 'chaleureusement'];
const RUDE = ['ridicule', "n'importe quoi", 'pas notre probleme', 'debrouillez', 'vous avez tort', 'menteur', 'mensonge', 'arretez de', 'lisez mieux', 'aucun effort', 'pathetique'];
const CONCRETE: Record<Action, RegExp> = {
  resend_link: /lien|telecharg|renvoy|nouvel envoi|spam|courrier indesirable/,
  refund: /rembours/,
  discount_code: /code|reduction|remise|geste/,
  none: /chapitre|page|etape|guide|pdf|methode|delai|heure|jours?|exemple/,
  escalate: /transmis|transmets|equipe|reviens|revenons|responsable|studio/,
  ignore: /./,
  block: /./,
};
const SILENT_OK: ReadonlySet<MessageIntent> = new Set<MessageIntent>(['arnaque', 'troll', 'partenariat']);

export function scoreSupportReply(msg: InboxMessage, reply: SupportReplyInput): { score: number; issues: string[] } {
  const issues: string[] = [];
  const text = (reply?.text ?? '').trim();
  const t = norm(text);
  const action = reply?.action ?? 'none';
  const rule = actionRule(msg);
  const silent = SILENT_OK.has(msg.intent) && (action === 'ignore' || action === 'block');
  let score = 0;

  if (reply?.detectedIntent === msg.intent) score += 20;
  else if (reply?.detectedIntent && related(reply.detectedIntent, msg.intent)) { score += 10; issues.push('Intention à moitié identifiée : relisez le message, la vraie demande est ailleurs.'); }
  else issues.push('Intention du client mal identifiée.');

  let danger = false;
  if (rule.right.includes(action)) score += 35;
  else if (rule.ok.includes(action)) { score += 18; issues.push(`Action acceptable mais pas idéale (« ${action} »).`); }
  else {
    danger = rule.danger.includes(action);
    issues.push(danger ? `Action dangereuse pour ce type de message (« ${action} »).` : `Action inadaptée (« ${action} ») pour ce message.`);
  }

  if (silent) {
    score += 15 + 10 + 10 + 10;
  } else {
    const empathy = EMPATHY.filter((e) => t.includes(e)).length;
    if (SILENT_OK.has(msg.intent)) score += text.length <= 220 ? 15 : 8;
    else { score += empathy >= 2 ? 15 : empathy === 1 ? 9 : 0; if (empathy === 0) issues.push('Aucune marque d\'empathie (excuses, remerciements, « je comprends »).'); }

    const len = text.length;
    if (msg.intent === 'troll') {
      score += len <= 220 ? 10 : len <= 400 ? 4 : 0;
      if (len > 300) { score -= 20; issues.push('On ne débat pas avec un troll : une phrase courte et polie suffit, ou ignorer.'); }
    } else if (len >= 120 && len <= 900) score += 10;
    else if ((len >= 60 && len < 120) || (len > 900 && len <= 1400)) { score += 5; issues.push(len < 120 ? 'Réponse un peu sèche : ajoutez une phrase de contexte.' : 'Réponse trop longue : allez à l\'essentiel.'); }
    else issues.push(len < 60 ? 'Réponse beaucoup trop courte.' : 'Réponse beaucoup trop longue.');

    const signed = SIGN_OFF.some((s) => t.includes(s)) || /\n\s*[—–-]\s*\S+\s*$/.test(text);
    if (signed) score += 10; else issues.push('Pas de signature ni de formule de politesse.');

    if ((CONCRETE[action] ?? /./).test(t)) score += 10; else issues.push('La réponse n\'annonce pas de solution concrète (lien, délai, remboursement…).');
  }

  const rude = RUDE.filter((r) => t.includes(r));
  if (rude.length) { score -= Math.min(40, rude.length * 25); issues.push(`Ton agressif à proscrire : ${quote(rude)}.`); }
  if (capsShare(text) > 0.4) { score -= 15; issues.push('Réponse en majuscules : ça se lit comme un cri.'); }
  if (msg.intent === 'arnaque' && /paie|paye|virement|carte bancaire|coordonnees|rib|iban|cliqu/.test(t) && !/jamais|ne .*pas|aucun|refus/.test(t)) {
    score -= 15; issues.push('Ne jamais accepter de payer, de cliquer ni de transmettre des coordonnées à un arnaqueur.');
  }
  if (hasPhrase(t, 'garanti') && !t.includes('satisfait ou rembourse')) { score -= 10; issues.push('Évitez de promettre un résultat « garanti ».'); }

  if (danger) score = Math.min(score, 15);
  return { score: Math.round(clamp(score, 0, 100)), issues: issues.slice(0, 8) };
}
