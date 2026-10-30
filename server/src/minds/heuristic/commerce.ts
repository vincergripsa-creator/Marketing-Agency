/**
 * Boutique + Red Team: the sales page (customer words, curiosity, objections, honest guarantee,
 * promise level driven by `hype`) and the "try to kill it" review before anything ships.
 */
import type { NicheBrief, PdfContent, Product, QualityReport, SalesPage, VoiceOfCustomer } from '../../shared.js';
import type { RedTeamVerdict } from '../../contracts.js';
import { RISK_RULES } from '../lexicon.js';
import { conflictsWith } from '../playbook.js';
import { ensurePdf } from '../shapes.js';
import { bare, cap, clean, fit, fmtEur, lf, norm, ofAud, q, uniqStrings, type LocalRng } from '../util.js';
import { buildNicheCtx, FALLBACK } from './niche.js';
import { inferKind, type Kind } from './studio.js';

export function nicheFromProduct(p: Product | null | undefined, voc?: VoiceOfCustomer | null): NicheBrief {
  return {
    nicheId: p?.nicheId ?? voc?.nicheId ?? 'niche',
    name: clean(p?.title) || 'ce guide',
    audience: clean(p?.audience) || clean(p?.content?.audience) || 'lecteurs qui veulent une méthode claire',
    problem: clean(p?.problem) || clean(p?.subtitle) || clean(p?.title) || 'un problème concret',
    category: '',
    keywords: [],
  };
}

const BLURBS: Record<Kind, string[]> = {
  comprendre: [
    'Le mécanisme qui entretient tout — et pourquoi ce n’est pas de votre faute.',
    'Ce qui se passe vraiment, expliqué simplement : la pièce qui manquait au puzzle.',
  ],
  diagnostic: [
    'La grille d’observation de 3 jours qui révèle le moment précis où tout se joue.',
    'Trois jours d’observation, une page : vous saurez enfin par quoi commencer.',
  ],
  methode: [
    'Les étapes, dans l’ordre exact où les appliquer — la deuxième surprend presque tout le monde.',
    'La méthode pas à pas, pensée pour être tenue même un soir de grande fatigue.',
  ],
  erreurs: [
    'Les erreurs que presque tout le monde fait sans le savoir (la n°1 va vous surprendre).',
    'Ce qu’il faut arrêter dès ce soir, et quoi faire à la place, en un tableau.',
  ],
  situations: [
    'Quoi faire les jours où tout déraille : fatigue, imprévus, entourage qui ne suit pas.',
    'Les réponses toutes prêtes aux situations qui font rechuter tout le monde.',
  ],
  programme: [
    'Le plan jour par jour, avec une seule nouveauté par phase : impossible de se perdre.',
    'Votre calendrier précis, phase par phase, à cocher chaque soir.',
  ],
  durer: [
    'Les réflexes qui gardent les résultats quand la vie reprend ses droits.',
    'Comment ne pas retomber dans les anciennes habitudes, même après une mauvaise semaine.',
  ],
};

function answerFor(objection: string, ctx: { audArt: string; chapters: number; minutes: number; price: number; dur: string }): string {
  const n = norm(objection);
  if (/chatgpt|\bia\b|intelligence artificielle|robot|generique|copier|copie/.test(n)) {
    return `Non. Chaque chapitre part de vraies phrases ${ofAud(ctx.audArt)}, récoltées dans les commentaires et les avis, et chaque étape a été relue par notre équipe avant publication. Vous y retrouverez vos propres mots, pas des généralités.`;
  }
  if (/temps|pages|long|lire|occupe|deborde/.test(n)) {
    return `Le guide se lit en ${ctx.minutes} minutes environ : ${ctx.chapters} chapitres courts, une checklist par chapitre. Le plan demande ensuite quelques minutes par jour, pas plus.`;
  }
  if (/tout essaye|rien ne marche|rien n'a marche|deja essaye|deja lu/.test(n)) {
    return 'C’est justement pour vous qu’il a été écrit. Un chapitre entier explique pourquoi les méthodes précédentes n’ont pas tenu, et le plan n’ajoute qu’une seule nouveauté à la fois.';
  }
  if (/pleur|forcer|dur|strict|brutal|punition|crier/.test(n)) {
    return 'Aucune étape ne vous demande de forcer. Chaque changement est progressif, expliqué, et vous gardez la main sur le rythme du début à la fin.';
  }
  if (/prix|cher|argent|euros|payer|arnaque/.test(n)) {
    return `${fmtEur(ctx.price)}, c’est moins qu’une seule consultation. Et vous avez 14 jours pour être remboursé si le guide ne vous apporte rien de concret.`;
  }
  if (/mon cas|pour moi|different|particulier|specifique|marchera|trop (age|vieux|jeune|tard)|\bage\b/.test(n)) {
    return `Le guide est écrit pour un seul profil : ${ctx.audArt}. Si vous vous reconnaissez dans les phrases ci-dessus, il a été fait pour vous.`;
  }
  return `Le guide y répond concrètement, chapitre par chapitre, avec des étapes numérotées et un plan de ${ctx.dur}.`;
}

const DEFAULT_OBJECTIONS = ['C’est encore un PDF écrit par ChatGPT ?', 'Je n’ai pas le temps de lire un long guide', 'J’ai déjà tout essayé'];

export function heuristicSalesPage(
  input: { product: Product; content: PdfContent; voc: VoiceOfCustomer; hype: number },
  rng: LocalRng,
  rules: { maxHype: number | null; banned: string[] },
): SalesPage {
  const product = input.product;
  const content = ensurePdf(input.content ?? product?.content);
  const c = buildNicheCtx(nicheFromProduct(product, input.voc), input.voc);
  let hype = Number.isFinite(input.hype) ? Math.min(1, Math.max(0, input.hype)) : 0.4;
  if (rules.maxHype !== null) hype = Math.min(hype, rules.maxHype);
  const price = product?.price && product.price > 0 ? product.price : 19;
  const title = clean(content.title) || clean(product?.title) || 'le guide';
  const desired = lf(c.outcomes[0] ?? FALLBACK.outcomes[0]);
  const durTxt = `${c.dur.n} ${c.dur.unit}`;
  const phrase = c.phrases.slice().sort((a, b) => a.length - b.length).find((p) => p.length <= 60) ?? c.phrases[0];
  const nCh = content.chapters.length || 5;
  const minutes = Math.max(10, Math.round((content.wordCount || 3000) / 200 / 5) * 5);
  const canRisk = (w: string) => !conflictsWith(w, rules.banned);

  const headline = hype >= 0.7
    ? canRisk('garanti') ? `${cap(desired)} en ${durTxt} : résultat garanti` : `${cap(desired)} en ${durTxt}, dès la première semaine`
    : hype >= 0.35
      ? `Enfin : ${desired} — en ${durTxt}, sans tout bouleverser`
      : phrase ? `${cap(q(phrase))} ? Voici un plan clair, pas à pas` : `${cap(desired)} : le plan clair, pas à pas`;
  const subheadline = `Le guide PDF pour ${c.audArt} : ${nCh} chapitres courts, des étapes numérotées, des exemples réels et un bonus offert.${hype >= 0.7 ? ` La méthode la plus complète du marché pour en finir avec le problème.` : ''}`;

  const painBullets = uniqStrings([...c.phrases, ...c.pains]).slice(0, Math.max(3, Math.min(6, c.phrases.length || 4)));
  const firstStep = content.chapters.flatMap((ch) => ch.steps)[0];
  const solution = `« ${title} » rassemble, en ${nCh} chapitres, ce qui fonctionne vraiment pour ${c.audArt}. Pas de théorie interminable : on commence par ${firstStep ? lf(firstStep) : 'observer trois jours'}, puis on suit un plan de ${durTxt} vers un seul objectif : ${desired}. Chaque chapitre se termine par une checklist, pour savoir exactement où vous en êtes.${hype >= 0.7 && canRisk('100 %') ? ' Une méthode efficace à 100 %, même si vous avez déjà tout essayé.' : ''}`;

  const chapterBlurbs = content.chapters.map((ch, i) => ({
    title: ch.title,
    blurb: rng.pick(BLURBS[inferKind(ch.title, i, nCh)]),
  }));
  const bonusName = bare(content.bonus.title.replace(/^bonus\s*:\s*/i, '')) || 'la fiche SOS';
  const bonusBlurb = `Cadeau inclus : ${lf(bonusName)}. ${fit(clean(content.bonus.intro), 160) || 'Un outil prêt à imprimer pour les moments difficiles.'}`;

  const objections = (c.objections.length ? c.objections : DEFAULT_OBJECTIONS).slice(0, 4).map((o) => ({
    q: /[?]$/.test(clean(o)) ? clean(o) : q(o),
    a: answerFor(o, { audArt: c.audArt, chapters: nCh, minutes, price, dur: durTxt }),
  }));

  const guarantee = hype >= 0.7 && canRisk('garanti')
    ? `Résultats garantis ou remboursé : si vous ne voyez aucun changement en ${durTxt}, on vous rembourse.`
    : 'Satisfait ou remboursé pendant 14 jours : si le guide ne vous apporte rien de concret, un simple e-mail suffit, sans justification.';
  const cta = fit(hype >= 0.7 ? `Oui, je commence le plan — ${fmtEur(price)}` : hype >= 0.35 ? `Je commence ce soir — ${fmtEur(price)}` : `Je télécharge le guide — ${fmtEur(price)}`, 70);

  return { headline: fit(headline, 120), subheadline, painBullets, solution, chapterBlurbs, bonusBlurb, objections, guarantee, cta, hypeLevel: Math.round(hype * 100) / 100 };
}

// ───────────────────────────── Red Team ─────────────────────────────

const SUBJECT: Record<'idea' | 'pdf' | 'sales_page' | 'ad', string> = { idea: 'l’idée', pdf: 'le PDF', sales_page: 'la page de vente', ad: 'la pub' };
const BROAD = /tout le monde|pour tous|tous les (ages|niveaux|profils)|debutants? (et|ou) (experts?|confirmes)|de 7 a 77 ans|tous ages|toute la famille|n'importe qui|grand public/;

export function heuristicRedTeam(input: { subject: 'idea' | 'pdf' | 'sales_page' | 'ad'; summary: string; quality: QualityReport | null }): RedTeamVerdict {
  const subj = SUBJECT[input.subject] ?? 'le livrable';
  const summary = clean(input.summary);
  const n = norm(summary);
  const qr = input.quality;
  const reasons: string[] = [];
  const fixes: string[] = [];
  const broad = BROAD.test(n);
  const risky = RISK_RULES.filter((r) => r.re.test(summary)).map((r) => r.label.toLowerCase());

  if (broad) {
    reasons.push(`Règle du un violée : ${subj} s’adresse à « tout le monde », donc à personne.`);
    fixes.push('Choisir UNE personne (âge, situation précise) et UN problème formulé avec ses mots.');
  }
  if (risky.length) {
    reasons.push(`Allégations à risque dans ${subj} : ${uniqStrings(risky).join(', ')}.`);
    fixes.push('Retirer « garanti », « 100 % », les promesses de délai et toute allégation santé ; garder des formulations vérifiables.');
  }
  if (summary.length < 30) {
    reasons.push('Résumé trop maigre pour juger sérieusement.');
    fixes.push('Préciser l’audience, le problème, la promesse et la preuve avant de redemander une revue.');
  }

  if (qr) {
    const s = (v: number) => `${Math.round(v)}/100`;
    if (qr.specificity < 60) { reasons.push(`Spécificité faible (${s(qr.specificity)}) : audience ou problème encore trop larges.`); fixes.push('Resserrer le titre et l’intro sur une seule situation, avec les phrases exactes des clients.'); }
    if (qr.structure < 60) { reasons.push(`Structure incomplète (${s(qr.structure)}).`); fixes.push('Vérifier : intro qui reformule le problème, étapes numérotées, exemples, bonus, page « La suite est ici ».'); }
    if (qr.actionability < 60) { reasons.push(`Pas assez actionnable (${s(qr.actionability)}).`); fixes.push('Transformer chaque conseil en étape concrète, datée et vérifiable.'); }
    if (qr.humanTone < 60) { reasons.push(`Ton trop « IA » (${s(qr.humanTone)}) : phrases génériques repérées.`); fixes.push('Repasser l’humanisation : remplacer chaque phrase plate par un détail tiré des commentaires.'); }
    if (qr.design < 55) { reasons.push(`Design faible (${s(qr.design)}).`); fixes.push('Couverture : titre plus gros, 2-3 couleurs, visuel du résultat désiré ; une infographie par chapitre.'); }
    if (qr.promiseMatch < 60) { reasons.push(`La promesse dépasse le contenu (${s(qr.promiseMatch)}) : risque de remboursements.`); fixes.push('Baisser le niveau de promesse ou enrichir le contenu pour tenir ce qui est annoncé.'); }
    if (qr.compliance < 70) { reasons.push(`Conformité insuffisante (${s(qr.compliance)}) : pub refusée ou plainte probable.`); fixes.push('Réécrire les passages à risque avant toute mise en ligne.'); }
    for (const i of qr.issues.slice(0, 3)) reasons.push(clean(i));
  }

  const ruleOfOneBroken = broad || (qr !== null && qr.specificity < 35);
  let verdict: RedTeamVerdict['verdict'];
  if ((qr && qr.compliance < 35) || ruleOfOneBroken || (qr && qr.overall < 35)) verdict = 'kill';
  else if ((qr && qr.overall < 70) || (!qr && (risky.length > 0 || summary.length < 30))) verdict = 'fix';
  else verdict = 'go';

  if (verdict === 'kill') {
    reasons.unshift(`Je tue ${subj} en l’état : ${qr && qr.compliance < 35 ? 'risque de conformité trop élevé' : ruleOfOneBroken ? 'la règle du un n’est pas respectée' : 'la qualité est trop loin du seuil'}.`);
    fixes.push(input.subject === 'idea' ? 'Repartir de la recherche : une niche plus étroite, des douleurs plus précises.' : 'Reprendre depuis le plan, pas seulement la forme.');
  } else if (verdict === 'go') {
    reasons.unshift(qr ? `Note globale ${Math.round(qr.overall)}/100 : au-dessus du seuil de 70, rien de bloquant.` : `Rien de bloquant trouvé dans ${subj} : audience précise, pas d’allégation à risque.`);
    if (qr) {
      const weakest = (['specificity', 'structure', 'actionability', 'humanTone', 'design', 'promiseMatch', 'compliance'] as const)
        .map((k) => ({ k, v: qr[k] })).sort((a, b) => a.v - b.v)[0]!;
      const label: Record<string, string> = { specificity: 'la spécificité', structure: 'la structure', actionability: 'le côté actionnable', humanTone: 'le ton humain', design: 'le design', promiseMatch: 'l’adéquation promesse/contenu', compliance: 'la conformité' };
      if (weakest.v < 85) fixes.push(`Amélioration possible plus tard : ${label[weakest.k]} (${Math.round(weakest.v)}/100).`);
    }
  } else {
    reasons.unshift(qr ? `Note globale ${Math.round(qr.overall)}/100 : sous le seuil de 70, à corriger avant de livrer.` : `${cap(subj)} doit être corrigé${input.subject === 'sales_page' || input.subject === 'ad' ? 'e' : ''} avant de passer.`);
  }
  return { verdict, reasons: uniqStrings(reasons).slice(0, 8), fixes: uniqStrings(fixes).slice(0, 6) };
}


