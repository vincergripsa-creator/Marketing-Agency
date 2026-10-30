/**
 * Boutique + Red Team: the sales page (customer words, curiosity, objections, honest guarantee,
 * promise level driven by `hype`) and the "try to kill it" review before anything ships.
 */
import type { NicheBrief, PdfContent, Product, QualityReport, SalesPage, VoiceOfCustomer } from '../../shared.js';
import type { RedTeamFacts, RedTeamVerdict, UpsellContext } from '../../contracts.js';
import { RISK_RULES } from '../lexicon.js';
import { conflictsWith } from '../playbook.js';
import { ensurePdf } from '../shapes.js';
import { bare, bestLabel, cap, clean, fit, fmtEur, lf, lowerFirst, norm, ofAud, plainTitle, q, splitSentences, uniqStrings, type LocalRng } from '../util.js';
import { buildNicheCtx, FALLBACK } from './niche.js';
import { inferKind, inline, promiseOutcome } from './studio.js';

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

/** A chapter sells itself with its own opening, never with a sentence shared by every guide. */
function blurbOf(intro: string, title: string): string {
  return fit(splitSentences(intro)[0] ?? intro, 170) || title;
}

interface AnswerCtx { audArt: string; chapters: number; price: number; dur: string; brand: string }

/** Objection → honest answer. Specific patterns first (a « périmé » objection is not a « temps » one). */
const ANSWERS: { re: RegExp; a: (c: AnswerCtx) => string }[] = [
  { re: /chatgpt|\bia\b|intelligence artificielle|robot|generique|copier|copie/, a: (c) => `Non. Chaque chapitre part de vraies phrases ${ofAud(c.audArt)}, récoltées dans les commentaires et les avis, et chaque étape a été relue par notre équipe avant publication. Vous y retrouverez vos propres mots, pas des généralités.` },
  { re: /perime|change(nt)? tout le temps|evolu|a jour|obsolete|plus valable/, a: () => 'Le guide indique, pour chaque repère, où vérifier l’information à jour, et chaque version corrigée vous est envoyée gratuitement. Vous apprenez surtout une méthode, qui ne se périme pas.' },
  { re: /gratuit|site (officiel|de l)|internet|youtube|forum|en ligne/, a: () => 'Les informations existent, mais elles sont éparpillées et rarement dans le bon ordre. Le guide les rassemble en un plan clair, avec ce qu’il faut faire en premier et les erreurs à éviter.' },
  { re: /pdf|livre|lecture|ebook/, a: (c) => `Ce n’est pas un livre à lire puis à ranger : ${c.chapters} chapitres courts, des étapes numérotées et une checklist à cocher, pensés pour être appliqués le jour même.` },
  { re: /comptable|expert|educateur|veterinaire|medecin|pediatre|professionnel|coach|consultant|avocat|cours|formation/, a: (c) => `Un professionnel reste précieux pour les cas particuliers. Ce guide vous donne la méthode de base pour avancer dès ce soir, pour ${fmtEur(c.price)}, et vous arriverez mieux préparé si vous consultez ensuite.` },
  { re: /confiance|fiable|serieux|croire|vrai/, a: () => 'Chaque repère du guide vient de la recherche, sans chiffre inventé ni promesse miracle. Et si le contenu ne vous convient pas, vous êtes remboursé sans justification.' },
  { re: /conseil|eleveur|deja (lu|eu|recu)|on m'a (dit|donne)/, a: (c) => `Le guide ne remplace pas ces conseils : il les met dans l’ordre, avec un plan de ${c.dur} et une checklist par chapitre pour savoir où vous en êtes.` },
  { re: /tout seul|finira|attendre|passera|avec le temps/, a: () => 'Peut-être, mais chaque semaine d’attente installe un peu plus l’habitude. Le plan ne demande que quelques minutes par jour, et vous voyez vite si la situation bouge.' },
  { re: /tout essaye|rien ne marche|rien n'a marche|deja essaye/, a: () => 'C’est justement pour vous qu’il a été écrit. Un chapitre entier explique pourquoi les méthodes précédentes n’ont pas tenu, et le plan n’ajoute qu’une seule nouveauté à la fois.' },
  { re: /pleur|forcer|strict|brutal|punition|crier/, a: () => 'Aucune étape ne vous demande de forcer. Chaque changement est progressif, expliqué, et vous gardez la main sur le rythme du début à la fin.' },
  { re: /pas le temps|temps de|pages|trop long|lire|occupe|deborde|complique/, a: (c) => `${c.chapters} chapitres courts, une checklist par chapitre : on avance par petites étapes, sans tout lire d’un coup, et chaque étape dit ce qu’il faut faire ensuite.` },
  { re: /prix|cher|argent|euros|payer|arnaque/, a: (c) => `${fmtEur(c.price)}, c’est moins qu’une seule consultation. Et vous avez 14 jours pour être remboursé si le guide ne vous apporte rien de concret.` },
  { re: /mon cas|pour moi|different|particulier|specifique|marchera|trop (age|vieux|jeune|tard)|\bage\b/, a: (c) => `Le guide est écrit pour un seul profil : ${c.audArt}. Si vous vous reconnaissez dans les phrases ci-dessus, il a été fait pour vous.` },
];

const GENERIC_ANSWERS: ((c: AnswerCtx) => string)[] = [
  (c) => `Le guide y répond concrètement, chapitre par chapitre, avec des étapes numérotées et un plan de ${c.dur}.`,
  (c) => `C’est une question que beaucoup se posent : le guide la traite pas à pas, et vous avez 14 jours pour être remboursé s’il ne vous aide pas (un simple e-mail à l’équipe ${c.brand} suffit).`,
  () => 'Le plus simple est d’essayer le premier chapitre ce soir : il suffit pour savoir si la méthode vous convient.',
];

function answerFor(objection: string, ctx: AnswerCtx, used: Set<string>): string {
  const n = norm(objection);
  for (const r of ANSWERS) {
    if (!r.re.test(n)) continue;
    const a = r.a(ctx);
    if (!used.has(a)) { used.add(a); return a; }
  }
  for (const g of GENERIC_ANSWERS) {
    const a = g(ctx);
    if (!used.has(a)) { used.add(a); return a; }
  }
  return GENERIC_ANSWERS[0]!(ctx);
}

const DEFAULT_OBJECTIONS = ['C’est encore un PDF écrit par ChatGPT ?', 'Je n’ai pas le temps de lire un long guide', 'J’ai déjà tout essayé'];

export function heuristicSalesPage(
  input: { product: Product; content: PdfContent; voc: VoiceOfCustomer; hype: number; upsellOf?: UpsellContext | null },
  rng: LocalRng,
  rules: { maxHype: number | null; banned: string[]; brand?: string },
): SalesPage {
  const product = input.product;
  const content = ensurePdf(input.content ?? product?.content);
  // a follow-up guide is sold on its own promise, plan and pains, never on the parent's
  const c = buildNicheCtx(nicheFromProduct(product, input.voc), input.voc, input.upsellOf ?? null);
  let hype = Number.isFinite(input.hype) ? Math.min(1, Math.max(0, input.hype)) : 0.4;
  if (rules.maxHype !== null) hype = Math.min(hype, rules.maxHype);
  const price = product?.price && product.price > 0 ? product.price : 19;
  const title = plainTitle(clean(content.title) || clean(product?.title) || 'le guide');
  const desired = lowerFirst(bestLabel([promiseOutcome(c), ...(c.upsellOf ? [] : c.outcomes)], 70, 10) ?? (c.upsellOf ? c.pbClause : FALLBACK.outcomes[0]));
  const brand = clean(rules.brand) || 'notre équipe';
  const durTxt = `${c.dur.n} ${c.dur.unit}`;
  const phrase = c.phrases.slice().sort((a, b) => a.length - b.length).find((p) => p.length <= 60) ?? c.phrases[0];
  const nCh = content.chapters.length || 5;
  const canRisk = (w: string) => !conflictsWith(w, rules.banned);

  // « un chiot propre en quelques semaines » already says how long: no second, contradictory duration
  const enDur = /\b(\d+|quelques|deux|trois)\s+(jours?|nuits?|semaines?|mois|minutes?|heures?)\b/i.test(desired) ? '' : ` en ${durTxt}`;
  const headline = hype >= 0.7
    ? canRisk('garanti') ? `${cap(desired)}${enDur} : résultat garanti` : `${cap(desired)}${enDur}, avec un plan précis`
    : hype >= 0.35
      ? `Enfin : ${desired}${enDur ? ` — un plan de ${durTxt}` : ''}, sans tout bouleverser`
      : phrase ? `${cap(q(phrase))} ? Voici un plan clair, pas à pas` : `${cap(desired)} : le plan clair, pas à pas`;
  const subheadline = `Le guide PDF pour ${c.audArt} : ${nCh} chapitres courts, des étapes numérotées, des exemples types et un bonus offert.${hype >= 0.7 ? ` La méthode la plus complète du marché pour en finir avec le problème.` : ''}`;

  const painBullets = uniqStrings([...c.phrases, ...(c.upsellOf ? c.ownPains : c.pains)]).slice(0, Math.max(3, Math.min(6, c.phrases.length || 4)));
  const methodCh = content.chapters.find((ch, i) => inferKind(ch.title, i, content.chapters.length) === 'methode');
  const firstStep = (methodCh ?? content.chapters[0])?.steps[0];
  const solution = `« ${title} » rassemble, en ${nCh} chapitres, ce qui fonctionne vraiment pour ${c.audArt}. Pas de théorie interminable : on commence par ${firstStep ? inline(bare(firstStep)) : 'faire le point pendant trois jours'}, puis on suit un plan de ${durTxt} vers un seul objectif : ${desired}. Chaque chapitre se termine par une checklist, pour savoir exactement où vous en êtes.${hype >= 0.7 && canRisk('100 %') ? ' Une méthode efficace à 100 %, même si vous avez déjà tout essayé.' : ''}`;

  const chapterBlurbs = content.chapters.map((ch) => ({ title: ch.title, blurb: blurbOf(ch.intro, ch.title) }));
  const bonusName = bare(content.bonus.title.replace(/^bonus\s*:\s*/i, '')) || 'la fiche SOS';
  const bonusBlurb = `Cadeau inclus : ${lf(bonusName)}. ${fit(clean(content.bonus.intro), 160) || 'Un outil prêt à imprimer pour les moments difficiles.'}`;

  const usedAnswers = new Set<string>();
  const objections = (c.objections.length ? c.objections : DEFAULT_OBJECTIONS).slice(0, 4).map((o) => ({
    q: /[?]$/.test(clean(o)) ? clean(o) : q(o),
    a: answerFor(o, { audArt: c.audArt, chapters: nCh, price, dur: durTxt, brand }, usedAnswers),
  }));

  const guarantee = hype >= 0.7 && canRisk('garanti')
    ? `Résultats garantis ou remboursé : si vous ne voyez aucun changement en ${durTxt}, on vous rembourse.`
    : `Satisfait ou remboursé pendant 14 jours : si le guide ne vous apporte rien de concret, un simple e-mail à ${brand} suffit, sans justification.`;
  const cta = fit(hype >= 0.7 ? `Oui, je commence le plan — ${fmtEur(price)}` : hype >= 0.35 ? `Je commence ce soir — ${fmtEur(price)}` : `Je télécharge le guide — ${fmtEur(price)}`, 70);

  return { headline: fit(headline, 120), subheadline, painBullets, solution, chapterBlurbs, bonusBlurb, objections, guarantee, cta, hypeLevel: Math.round(hype * 100) / 100 };
}

// ───────────────────────────── Red Team ─────────────────────────────

const SUBJECT: Record<'idea' | 'pdf' | 'sales_page' | 'ad', string> = { idea: 'l’idée', pdf: 'le PDF', sales_page: 'la page de vente', ad: 'la pub' };
const BROAD = /tout le monde|pour tous|tous les (ages|niveaux|profils)|debutants? (et|ou) (experts?|confirmes)|de 7 a 77 ans|tous ages|toute la famille|n'importe qui|grand public/;

/** A TikTok ad costs several euros per sale: under this price the market cannot pay it back. */
const LOW_MARKET_PRICE = 12;
const THIN_MARKET_PRICE = 15;
const WEAK_DEMAND = 35;
/** Share of the known pains a guide may leave out before it has to be rebuilt from its plan. */
const MISSED_PAINS_KILL = 0.6;

interface Finding { reason: string; fix: string; severe?: boolean }

/** Is the idea worth a guide? Only what the company's own research can show (signals, competitors, anchors). */
function ideaFindings(f: RedTeamFacts): Finding[] {
  const out: Finding[] = [];
  const t = `« ${f.title} »`;
  const demand = f.signal ? (f.signal.searchInterest + f.signal.tiktokBuzz) / 2 : null;
  const anchor = f.voc?.medianAnchor ?? null;
  const rivals = f.competitors?.medianPrice ?? null;
  const market = anchor !== null || rivals !== null ? Math.max(anchor ?? 0, rivals ?? 0) : null;
  const paid = [anchor !== null ? `les clients citent ${fmtEur(anchor)}` : '', rivals !== null ? `les concurrents vendent ${fmtEur(rivals)}` : ''].filter(Boolean).join(', ');
  if (market !== null && market < LOW_MARKET_PRICE) {
    out.push({ reason: `Marché trop bon marché pour ${t} : ${paid}. Une vente ne rembourse pas une pub TikTok.`, fix: 'Choisir une niche où les acheteurs paient au moins 14 €.', severe: true });
  } else if (market !== null && market < THIN_MARKET_PRICE) {
    out.push({ reason: `Marge fine sur ${t} : ${paid}.`, fix: 'Prévoir un angle plus précis qui justifie un palier de prix au-dessus, sinon rester en organique.' });
  }
  if (demand !== null && demand < WEAK_DEMAND) {
    out.push({ reason: `Demande faible pour ${t} : recherche ${Math.round(f.signal!.searchInterest)}/100, buzz TikTok ${Math.round(f.signal!.tiktokBuzz)}/100.`, fix: 'Vérifier un angle plus large dans la même douleur ou passer à la niche suivante.', severe: market !== null && market < THIN_MARKET_PRICE });
  }
  if (f.signal?.competition === 'forte' && f.competitors && f.competitors.count > 0 && (f.competitors.avgRating ?? 0) >= 4.3 && f.competitors.reviews >= 300) {
    out.push({ reason: `Terrain occupé : ${f.competitors.count} concurrents notés ${fmtRating(f.competitors.avgRating!)}/5 avec ${f.competitors.reviews} avis.`, fix: 'Attaquer un sous-problème précis que leurs guides laissent de côté.' });
  }
  if (f.voc && f.voc.pains < 3) out.push({ reason: `Voix du client trop mince : ${f.voc.pains} douleur(s) documentée(s) pour ${t}.`, fix: 'Reprendre la recherche avant d’écrire : commentaires, avis, forums.' });
  if (f.voc && f.voc.sensitiveClaims >= 5) out.push({ reason: `Sujet sensible pour ${t} : ${f.voc.sensitiveClaims} allégations interdites par la plateforme sur cette niche.`, fix: 'Écrire chaque promesse en résultat observable, jamais en résultat garanti.' });
  return out;
}

function fmtRating(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace('.', ',');
}

/** Does the guide answer what its buyers actually say? Read from the guide itself. */
function guideFindings(f: RedTeamFacts): Finding[] {
  const g = f.guide;
  if (!g) return [];
  const out: Finding[] = [];
  const named = (xs: string[], n = 2) => xs.slice(0, n).map((x) => `« ${fit(bare(x), 60)} »`).join(', ');
  if (g.uncoveredPains.length) {
    const most = g.painsKnown > 0 && g.uncoveredPains.length >= 3 && g.uncoveredPains.length / g.painsKnown >= MISSED_PAINS_KILL;
    if (most || g.uncoveredPains.length >= 2) {
      out.push({
        reason: `${g.uncoveredPains.length} douleur(s) sur ${g.painsKnown} absentes de « ${f.title} » : ${named(g.uncoveredPains)}.`,
        fix: `Traiter ces douleurs avec une réponse concrète : ${named(g.uncoveredPains, 3)}.`, severe: most,
      });
    }
  }
  if (g.chapters > 0 && g.chaptersWithoutExample.length * 2 > g.chapters) {
    out.push({ reason: `${g.chaptersWithoutExample.length} chapitres sur ${g.chapters} sans exemple, dont ${named(g.chaptersWithoutExample, 1)}.`, fix: 'Un exemple tiré de la recherche par chapitre.' });
  }
  return out;
}

export function heuristicRedTeam(input: { subject: 'idea' | 'pdf' | 'sales_page' | 'ad'; summary: string; quality: QualityReport | null; facts?: RedTeamFacts | null }): RedTeamVerdict {
  const subj = SUBJECT[input.subject] ?? 'le livrable';
  const feminine = input.subject !== 'pdf';
  const f = input.facts ?? null;
  const summary = clean(input.summary);
  // With the facts, only what WE say is judged: the research quoted in a summary (the claims the platform bans, what
  // customers write) is not our promise. That list alone used to return the same « fix » for every idea.
  const ours = f ? clean([f.title, f.audience, f.problem, f.guide?.promise ?? ''].join(' — ')) : summary;
  const n = norm(ours);
  const qr = input.quality;
  const reasons: string[] = [];
  const fixes: string[] = [];
  const broad = BROAD.test(n);
  const risky = RISK_RULES.filter((r) => r.re.test(ours)).map((r) => r.label.toLowerCase());

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
  const findings = f ? (input.subject === 'idea' ? ideaFindings(f) : guideFindings(f)) : [];
  for (const x of findings) { reasons.push(x.reason); fixes.push(x.fix); }

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
  const severe = findings.find((x) => x.severe);
  let verdict: RedTeamVerdict['verdict'];
  if ((qr && qr.compliance < 35) || ruleOfOneBroken || (qr && qr.overall < 35) || severe) verdict = 'kill';
  else if ((qr && qr.overall < 70) || findings.length || (!qr && (risky.length > 0 || summary.length < 30))) verdict = 'fix';
  else verdict = 'go';

  const who = f ? `« ${fit(f.title, 60)} »` : subj;
  if (verdict === 'kill') {
    reasons.unshift(`Je tue ${who} en l’état : ${qr && qr.compliance < 35 ? 'risque de conformité trop élevé' : ruleOfOneBroken ? 'la règle du un n’est pas respectée' : severe ? fit(severe.reason, 150) : 'la qualité est trop loin du seuil'}.`.replace(/\.\.$/, '.'));
    fixes.push(input.subject === 'idea' ? 'Repartir de la recherche : une niche plus étroite, des douleurs plus précises.' : 'Reprendre depuis le plan, pas seulement la forme.');
  } else if (verdict === 'go') {
    if (qr) {
      const treated = f?.guide ? `, ${f.guide.painsKnown - f.guide.uncoveredPains.length} douleurs clients sur ${f.guide.painsKnown} traitées` : '';
      reasons.unshift(`${cap(who)} tient : note ${Math.round(qr.overall)}/100${treated}, rien de bloquant.`);
      const weakest = (['specificity', 'structure', 'actionability', 'humanTone', 'design', 'promiseMatch', 'compliance'] as const)
        .map((k) => ({ k, v: qr[k] })).sort((a, b) => a.v - b.v)[0]!;
      const label: Record<string, string> = { specificity: 'la spécificité', structure: 'la structure', actionability: 'le côté actionnable', humanTone: 'le ton humain', design: 'le design', promiseMatch: 'l’adéquation promesse/contenu', compliance: 'la conformité' };
      if (weakest.v < 85) fixes.push(`Amélioration possible plus tard : ${label[weakest.k]} (${Math.round(weakest.v)}/100).`);
    } else if (f?.signal) {
      reasons.unshift(`${cap(who)} tient : recherche ${Math.round(f.signal.searchInterest)}/100, buzz ${Math.round(f.signal.tiktokBuzz)}/100, concurrence ${f.signal.competition}${f.competitors?.medianPrice ? `, prix médian ${fmtEur(f.competitors.medianPrice)}` : ''}.`);
    } else reasons.unshift(`Rien de bloquant trouvé dans ${who} : audience précise, pas d’allégation à risque.`);
  } else {
    // Findings speak for themselves: the first reason is what is wrong with this product, not a verdict line.
    if (qr && qr.overall < 70) reasons.unshift(`Note globale ${Math.round(qr.overall)}/100 pour ${who} : sous le seuil de 70, à corriger avant de livrer.`);
    else if (!findings.length) reasons.unshift(`${cap(who)} doit être corrigé${!f && feminine ? 'e' : ''} avant de passer.`);
  }
  return { verdict, reasons: uniqStrings(reasons).slice(0, 8), fixes: uniqStrings(fixes).slice(0, 6) };
}
