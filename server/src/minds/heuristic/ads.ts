/**
 * Growth: TikTok hooks (one per style, ≤ 90 chars), full ad scripts (4-6 scenes, 12-30 s) and
 * creator outreach DMs. Without a learned rule, hype-ish styles sometimes slip a risky word —
 * that is how the agency gets ads rejected, and learns.
 */
import type { AdFormat, AdScene, CreatorProfile, HookStyle, Product, VoiceOfCustomer } from '../../shared.js';
import type { AdDraft } from '../../contracts.js';
import { RISKY_AD_PHRASES } from '../lexicon.js';
import { AD_FORMATS, conflictsWith, HOOK_STYLES } from '../playbook.js';
import { bare, cap, clean, firstFit, fit, fmtEur, fmtNum, fmtPct, lf, lowerFirst, norm, q, shortLabel, theUnit, uniqStrings, withArticle, type LocalRng } from '../util.js';
import { nicheFromProduct } from './commerce.js';
import { buildNicheCtx, de, FALLBACK, isInfinitive, type NicheCtx } from './niche.js';

const HOOK_MAX = 90;
const SCREEN_MAX = 50;

function shortPhrases(c: NicheCtx, max = 40): string[] {
  const p = c.phrases.map(bare).filter((x) => x.length >= 6 && x.length <= max);
  return p.length ? p : c.phrases.map((x) => fit(bare(x), max));
}

function audWord(c: NicheCtx): string {
  const w = lf(c.niche.audience).split(/\s+/)[0] ?? 'gens';
  return /[sx]$/.test(w) ? w : 'gens';
}

function hookCandidates(style: HookStyle, c: NicheCtx, rng: LocalRng): string[] {
  const ph = rng.shuffle(shortPhrases(c));
  const p0 = ph[0];
  const desired = lf(c.outcomes[0] ?? FALLBACK.outcomes[0]);
  const mistake = (c.mistakes.find(isInfinitive) ?? c.mistakes[0] ?? FALLBACK.mistakes[0]);
  const pb = fit(c.pbClause, 55);
  const pbQ = c.pbShort && c.pbShort.length <= 48 ? q(c.pbShort) : null;
  const cl = c.pbIsClause; // "bébé se réveille…" can follow « pourquoi / quand / si »
  const { n, unit } = c.dur;
  const k = Math.min(5, Math.max(3, c.mistakes.length || 3));
  const fact = c.facts.find((f) => /\d/.test(f) && f.length <= 80);
  switch (style) {
    case 'question': return [
      p0 ? `Tu te dis ${q(p0)} ? Regarde ça avant ce soir.` : '',
      cl ? `Pourquoi ${pb} ? La vraie raison va te surprendre.` : pbQ ? `${cap(pbQ)} ? La vraie raison va te surprendre.` : '',
      p0 ? `${cap(q(p0))} ? Voilà ce que personne ne te dit.` : '',
    ];
    case 'contrarian': return [
      `Arrête ${de(shortLabel(mistake, 48))}. C’est ça qui entretient tout.`,
      'Le conseil qu’on te répète partout ? C’est lui qui aggrave tout.',
      cl ? `Non, ce n’est pas « normal » que ${fit(c.pbClause, 50)}.` : pbQ ? `${cap(pbQ)} n’est pas une fatalité. Vraiment pas.` : '',
    ];
    case 'story': return [
      p0 ? `Un commentaire nous a marqués : ${q(p0)}. Voilà ce qu’on a répondu.` : '',
      p0 ? `Ce message, on le reçoit chaque semaine : ${q(p0)}. Écoute la suite.` : '',
      'On a épluché les commentaires sur ce sujet. Une phrase revient tout le temps.',
    ];
    case 'stat': return [
      fact ? `${cap(bare(fact))}. Et personne ne te le dit.` : '',
      `${n} ${unit}, ${c.stepCount} étapes, zéro prise de tête : la méthode ${c.adj}.`,
      `1 erreur, ${n} ${unit}, 1 plan : voilà comment on s’en sort.`,
    ];
    case 'pov': return [
      p0 ? `POV : tu tapes ${q(p0)} sur Google pour la 10e fois.` : '',
      isInfinitive(desired) ? `POV : tu as enfin réussi à ${fit(desired, 55)}.` : `POV : ${fit(desired, 60)}, et tu n’y croyais plus.`,
      cl ? `POV : tu découvres enfin pourquoi ${fit(c.pbClause, 50)}.` : 'POV : tu comprends enfin pourquoi ça bloque.',
    ];
    case 'mistake': return [
      `L’erreur que font presque tous les ${audWord(c)} : ${lowerFirst(shortLabel(mistake, 50))}.`,
      cl ? `L’erreur n°1 quand ${fit(c.pbClause, 45)} (et comment l’éviter).` : pbQ ? `L’erreur n°1 derrière ${pbQ} (et comment l’éviter).` : '',
      `Si tu fais ça, arrête tout de suite : ${lowerFirst(shortLabel(mistake, 48))}.`,
    ];
    case 'before_after': return [
      p0 ? `Avant : ${q(fit(p0, 32))}. Après ${n} ${unit} : ${fit(desired, 36)}.` : '',
      `Avant : l’épuisement. Après ${n} ${unit} de plan : ${fit(desired, 40)}.`,
      `Ce qui a changé entre ${theUnit(c.dur.unitOne)} 1 et ${theUnit(c.dur.unitOne)} ${n}.`,
    ];
    case 'listicle': return [
      cl ? `${k} choses à arrêter si ${fit(c.pbClause, 55)}.` : pbQ ? `${cap(pbQ)} ? ${k} choses à arrêter dès ce soir.` : '',
      `${k} gestes simples qui changent tout (surtout le 2e).`,
      cl ? `${k} erreurs qui font que ${fit(c.pbClause, 50)}.` : pbQ ? `${k} erreurs qui entretiennent ${pbQ}.` : '',
    ];
  }
}

/** Words of the problem / audience a viewer must recognise in the first 2 seconds. */
function relevance(hook: string, c: NicheCtx): number {
  const key = new Set(norm(`${c.niche.problem} ${c.niche.audience} ${c.pbClause}`).split(/[^a-z0-9]+/).filter((w) => w.length >= 5));
  return norm(hook).split(/[^a-z0-9]+/).filter((w) => key.has(w)).length;
}

export function makeHook(style: HookStyle, c: NicheCtx, rng: LocalRng): string {
  const cands = hookCandidates(style, c, rng).filter(Boolean);
  const fitting = rng.shuffle(cands.filter((x) => x.length <= HOOK_MAX));
  // most of the time the writer picks the hook that names the problem or the audience
  if (fitting.length && rng.chance(0.7)) fitting.sort((a, b) => relevance(b, c) - relevance(a, c));
  return firstFit(fitting.concat(cands), HOOK_MAX);
}

export function heuristicHooks(
  input: { product: Product; voc: VoiceOfCustomer; styles: HookStyle[] },
  rng: LocalRng,
  preferred: HookStyle[],
): { hookStyle: HookStyle; hook: string }[] {
  const c = buildNicheCtx(nicheFromProduct(input.product, input.voc), input.voc);
  const asked = (input.styles ?? []).filter((s) => HOOK_STYLES.includes(s));
  const styles = uniqStrings([...preferred, ...(asked.length ? asked : ['question', 'mistake', 'pov'])]) as HookStyle[];
  return styles.map((s) => ({ hookStyle: s, hook: makeHook(s, c, rng) }));
}

const VISUALS: Record<AdFormat, string[]> = {
  faceless_voiceover: [
    'Plan serré, lumière tamisée, texte blanc en gros au centre',
    'B-roll du quotidien du problème, filmé en plongée, sans visage',
    'Mains qui écrivent dans un carnet, texte animé par-dessus',
    'Capture du guide PDF qui défile, une page à la fois',
    'Gros plan sur la checklist du guide, cochée au feutre',
    'Couverture du guide en plein écran, flèche vers la bio',
  ],
  text_slideshow: [
    'Fond uni à la couleur de la marque, texte noir très gros',
    'Slide 2 : la phrase client entre guillemets, fond clair',
    'Slide 3 : étape 1 en grand, numéro en couleur',
    'Slide 4 : repère ou exemple concret, une seule ligne',
    'Slide 5 : aperçu du bonus offert',
    'Slide finale : couverture du guide + « lien en bio »',
  ],
  ugc_avatar: [
    'Avatar face caméra, cadrage poitrine, regard direct, lumière naturelle',
    'Avatar qui soupire puis sourit, sous-titres dynamiques',
    'Avatar montre le guide ouvert sur son téléphone',
    'Avatar en voix off sur une capture du chapitre concerné',
    'Avatar qui coche une checklist à l’écran',
    'Avatar pointe vers le bas : « lien en bio »',
  ],
  carousel: [
    'Carte 1 : accroche en gros sur fond clair',
    'Carte 2 : la phrase qu’on lit partout, en citation',
    'Carte 3 : étape 1 illustrée par une icône',
    'Carte 4 : exemple concret en deux lignes',
    'Carte 5 : le bonus offert',
    'Carte finale : couverture du guide + appel à l’action',
  ],
};

/** On-screen text ≤ 50 chars: first clause, then TikTok-style compaction, then a clean cut. */
function screenText(s: string): string {
  const t = clean(s);
  if (t.length <= SCREEN_MAX) return t;
  const head = t.split(/(?<=[?:.!])\s+/)[0] ?? t;
  const base = head.length >= 12 ? head : t;
  const compact = base
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\bheures?\b/g, 'h')
    .replace(/\bminutes?\b/g, 'min')
    .replace(/\bkilos?\b/g, 'kg')
    .replace(/\s+(vraiment|simplement|enfin|toujours)\b/g, '')
    .replace(/\s{2,}/g, ' ');
  if (compact.length <= SCREEN_MAX) return compact;
  const noTail = compact.replace(/\s+(la nuit|le soir|le matin|au quotidien|tous les jours)(\s*[?!.])?$/i, '$2');
  return fit(noTail.length <= SCREEN_MAX ? noTail : compact, SCREEN_MAX);
}

function hashtagify(s: string): string {
  return `#${norm(s).replace(/[^a-z0-9]/g, '')}`;
}

function hashtags(c: NicheCtx, rng: LocalRng): string[] {
  const k = norm([c.niche.name, c.niche.audience, c.niche.problem, ...c.niche.keywords].join(' '));
  const themed: string[] = [];
  if (/bebe|nourrisson/.test(k)) themed.push('#bebe', '#parentalite', '#mamanfatiguee');
  if (/sommeil|dormir|nuit/.test(k)) themed.push('#sommeil');
  if (/chien|chiot/.test(k)) themed.push('#chien', '#educationcanine');
  if (/argent|budget|epargne/.test(k)) themed.push('#budget', '#financesperso');
  if (/sport|ventre|poids|muscu/.test(k)) themed.push('#fitness', '#motivation');
  const kw = c.niche.keywords.slice(0, 3).map(hashtagify).filter((h) => h.length > 3 && h.length <= 26);
  const base = ['#astuce', '#conseil', '#pourtoi', '#guidepdf'];
  const tags = uniqStrings([...kw, ...themed, ...rng.shuffle(base)]).slice(0, 6);
  return tags.length >= 4 ? tags : uniqStrings([...tags, ...base]).slice(0, 4);
}

function riskyLine(phrase: string, c: NicheCtx): { vo: string; screen: string } {
  const { n, unit } = c.dur;
  switch (phrase) {
    case 'garanti': return { vo: `Résultat garanti en ${n} ${unit}, même si tu as tout essayé.`, screen: `Résultat garanti en ${n} ${unit}` };
    case '100 %': return { vo: 'Une méthode efficace à 100 %, testée et approuvée.', screen: 'Efficace à 100 %' };
    case 'à coup sûr': return { vo: 'Suis le plan et ça marche à coup sûr.', screen: 'Ça marche à coup sûr' };
    default: return { vo: 'Des résultats visibles en 3 jours seulement.', screen: 'Résultats en 3 jours seulement' };
  }
}

export function heuristicAd(
  input: { product: Product; voc: VoiceOfCustomer; hook: string; hookStyle: HookStyle; format: AdFormat; bannedClaims: string[] },
  rng: LocalRng,
  rules: { banned: string[]; preferredFormats: AdFormat[] },
): AdDraft {
  const c = buildNicheCtx(nicheFromProduct(input.product, input.voc), input.voc);
  const style: HookStyle = HOOK_STYLES.includes(input.hookStyle) ? input.hookStyle : 'question';
  const format: AdFormat = AD_FORMATS.includes(input.format) ? input.format : (rules.preferredFormats[0] ?? 'faceless_voiceover');
  const hook = fit(clean(input.hook) || makeHook(style, c, rng), HOOK_MAX);
  const vis = VISUALS[format];
  const title = clean(input.product?.title) || 'le guide';
  const phrase = rng.pick(shortPhrases(c, 44).concat(c.phrases.length ? [] : ['']));
  const pain = c.pains[0] ? lf(c.pains[0]) : c.pbClause;
  const step = c.steps[0] ?? FALLBACK.steps[0];
  const step2 = c.steps[1] ?? FALLBACK.steps[1];
  const example = c.examples.find((e) => e.length <= 170);
  const fact = c.facts.find((f) => f.length <= 120);
  const { n, unit } = c.dur;
  const price = input.product?.price && input.product.price > 0 ? input.product.price : null;

  const scenes: AdScene[] = [];
  scenes.push({ visual: vis[0]!, onScreenText: screenText(hook), voiceover: hook, durationSec: rng.int(2, 3) });
  scenes.push({
    visual: vis[1]!,
    onScreenText: screenText(phrase ? q(phrase) : cap(fit(pain, 46))),
    voiceover: phrase ? `Si toi aussi tu te dis ${q(phrase)}, reste deux secondes.` : `${cap(pain)}… et l’impression d’avoir tout essayé.`,
    durationSec: rng.int(3, 4),
  });
  scenes.push({
    visual: vis[2]!,
    onScreenText: screenText(`1. ${shortLabel(step, 46)}`),
    voiceover: `La méthode commence par un geste tout simple : ${lf(step)}. Ensuite : ${lf(step2)}. Une étape à la fois.`,
    durationSec: rng.int(4, 6),
  });
  const proofVo = example ? sentence(example) : fact ? `Un repère que peu de gens connaissent : ${lf(fact)}.` : `Le plan tient en ${n} ${unit}, avec une checklist chaque soir.`;
  scenes.push({
    visual: vis[3]!,
    onScreenText: screenText(example ? 'Ce qu’on nous raconte :' : fact ? shortLabel(fact, 46) : `Plan de ${n} ${unit}`),
    voiceover: proofVo,
    durationSec: rng.int(4, 5),
  });
  if (rng.chance(0.6)) {
    scenes.push({
      visual: vis[4]!,
      onScreenText: screenText(`Plan ${n} ${unit} + bonus offert`),
      voiceover: `Dans le guide : le plan de ${n} ${unit}, ${unit === 'nuits' ? 'nuit' : 'jour'} par ${unit === 'nuits' ? 'nuit' : 'jour'}, et une fiche SOS en cadeau.`,
      durationSec: rng.int(3, 4),
    });
  }
  scenes.push({
    visual: vis[5]!,
    onScreenText: screenText(price ? `Guide PDF ${fmtEur(price)} — lien en bio` : 'Guide PDF — lien en bio'),
    voiceover: `Le guide complet, « ${fit(title, 70)} », est en lien dans ma bio.`,
    durationSec: 3,
  });

  // hype-ish styles occasionally slip a risky claim, unless the agency learned to avoid it
  const banned = [...(input.bannedClaims ?? []), ...rules.banned].map(clean).filter(Boolean);
  if ((style === 'before_after' || style === 'stat') && rng.chance(0.25)) {
    const allowed = RISKY_AD_PHRASES.filter((p) => !conflictsWith(p, banned));
    if (allowed.length) {
      const r = riskyLine(rng.pick(allowed), c);
      const proof = scenes[3]!;
      proof.voiceover = `${proof.voiceover} ${r.vo}`;
      if (rng.chance(0.5)) proof.onScreenText = screenText(r.screen);
    }
  }

  // total 12-30 s
  let total = scenes.reduce((s, x) => s + x.durationSec, 0);
  while (total > 30) { const longest = scenes.reduce((a, b) => (b.durationSec > a.durationSec ? b : a)); longest.durationSec -= 1; total -= 1; }
  while (total < 12) { scenes[2]!.durationSec += 1; total += 1; }

  const caption = fit(`${hook} Le guide « ${fit(title, 90)} » est en lien dans la bio. Sauvegarde pour ce soir.`, 260);
  return {
    hook,
    hookStyle: style,
    format,
    scenes,
    caption,
    hashtags: hashtags(c, rng),
    cta: format === 'carousel' ? 'Swipe jusqu’au bout et télécharge le guide (lien en bio)' : 'Télécharge le guide (lien en bio)',
  };
}

function sentence(s: string): string {
  const t = clean(s);
  return /[.!?…]$/.test(t) ? cap(t) : `${cap(t)}.`;
}

export function heuristicOutreach(
  input: { creator: CreatorProfile; product: Product; offer: { upfront: number; commission: number } },
  rng: LocalRng,
  agent: { name: string },
  brand: string,
): string {
  const cr = input.creator;
  const handle = clean(cr?.handle).replace(/^@?/, '@') || '@toi';
  const title = clean(input.product?.title) || 'notre guide';
  const aud = clean(input.product?.audience) ? withArticle(input.product.audience) : 'ta communauté';
  const up = Number.isFinite(input.offer?.upfront) ? Math.max(0, input.offer.upfront) : 0;
  const com = Number.isFinite(input.offer?.commission) ? Math.min(1, Math.max(0, input.offer.commission)) : 0.3;
  const comTxt = fmtPct(com, 0);
  const avg = cr?.avgViews && cr.avgViews > 0 ? cr.avgViews : 0;
  const views = avg > 0 ? `${avg >= 1000 ? `${fmtNum(avg / 1000, avg >= 10000 ? 0 : 1)} k` : fmtNum(avg)} vues en moyenne` : null;
  const opener = rng.pick([
    `Salut ${handle} ! Je suis ${agent.name}, chez ${brand}.`,
    `Hello ${handle}, ${agent.name} de ${brand} ici.`,
  ]);
  const compliment = rng.pick([
    `On suit tes vidéos${views ? ` (${views}, bravo)` : ''} : ta façon de parler à ${aud} sonne juste.`,
    `Ta communauté ressemble exactement aux lecteurs de notre guide${views ? `, et tes ${views} le prouvent` : ''}.`,
  ]);
  const offer = up > 0
    ? `Notre proposition : ${fmtEur(up)} pour une vidéo, plus ${comTxt} de commission sur chaque vente faite avec ton lien.`
    : `Notre proposition : ${comTxt} de commission sur chaque vente faite avec ton lien, sans rien à avancer de ton côté.`;
  return [
    opener,
    compliment,
    `On a créé « ${fit(title, 90)} », un guide PDF pour ${aud}.`,
    offer,
    'On t’envoie le guide gratuitement pour que tu juges par toi-même, sans engagement. Ça te dit qu’on en parle ?',
  ].join(' ');
}
