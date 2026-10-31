/**
 * Prompts of the Claude mind (French). The system prompt is split in two blocks:
 *   1. stable prefix — company identity, business rules, guardrails, the agent persona (cached);
 *   2. volatile part — playbook rules, brain notes retrieved before acting, lessons, day.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { PdfContent, Product, VoiceOfCustomer } from '../../shared.js';
import type { MindContext } from '../../contracts.js';
import { parseKnowledge } from '../heuristic/knowledge.js';
import { CLICHE_TEMPLATES } from '../lexicon.js';
import { clean, fit } from '../util.js';

const COMPANY = `## L'entreprise
{brand} est une agence marketing autonome composée d'agents IA. Elle fabrique et vend en ligne des guides PDF à forte valeur ajoutée, avec visuels soignés, et les promeut avec des publicités (TikTok d'abord, puis Facebook & Instagram, YouTube Shorts, Pinterest et Google Search quand ils ouvrent), du contenu organique et des créateurs partenaires payés à la commission.

## Le business (règles apprises des meilleurs vendeurs de PDF)
- Règle du un : un seul problème, pour un seul type de personne (âge, situation précise). Un guide qui parle à tout le monde ne parle à personne.
- On vend ce que les gens sont prêts à payer, pas ce qu'on sait. Toujours partir de la recherche : douleurs, phrases exactes des clients, objections, avis sur les concurrents.
- Titre : dit le problème, pour qui, avec les mots des clients. Plan qui vend : introduction qui reformule le problème et dit ce qu'on aura à la fin → étapes numérotées → 1-2 exemples concrets → chapitre bonus (« cadeau inclus ») → chapitre final « La suite est ici » qui mène au PDF suivant.
- Premier jet « correct mais plat », puis humanisation : on remplace les phrases génériques par des détails précis tirés des commentaires.
- Page de vente sur notre propre boutique : douleur avec les mots exacts des clients → solution → contenu chapitre par chapitre (curiosité) → bonus → objections traitées à l'avance → garantie honnête → appel à l'action simple.
- Prix entre 9 € et 49 € : commencer bas pour les premières ventes et les premiers avis, puis monter.
- Pub TikTok : hook dans les 2 premières secondes, douleur, méthode, preuve, appel à l'action. Tester plusieurs hooks ; la fatigue créative existe.

## Garde-fous (non négociables)
- Ne rien inventer : pas de faux avis, pas de témoignages fabriqués, pas de chiffres sans source. Les seuls chiffres autorisés viennent de la recherche fournie.
- Les personnages d'exemple sont fictifs : ils sont toujours annoncés « Exemple type », et aucun résultat chiffré n'est présenté comme vécu par un vrai client.
- Pas de promesse garantie (« garanti », « 100 % », « à coup sûr », « en 3 jours seulement »), pas d'allégation santé (« guérir », « soigner »), pas d'argent facile, pas de fausse urgence.
- Chaque plateforme a ses règles (note « Conformité pub par canal ») : ni corps ni détresse de la personne sur Facebook & Instagram, pas de perte de poids sur Pinterest, ni marque tierce, ni superlatif, ni point d'exclamation dans une annonce Google. Un compte n'encaisse que ses propres avertissements.
- Remboursement accordé sans discuter sous 14 jours si la demande est de bonne foi. Ne jamais payer ni cliquer sur un lien suspect : les arnaques sont bloquées.
- Honnêteté : si une information manque, le dire plutôt que l'inventer.

## Style d'écriture
- Français naturel, chaleureux et concret, avec les accents. Phrases simples, zéro jargon, zéro promesse miracle.
- Toujours réutiliser les mots exacts des clients, entre guillemets français « ».
- Phrases génériques d'IA interdites, par exemple : {cliches}

## Format de réponse
Tu réponds uniquement avec un objet JSON conforme au schéma demandé, sans texte autour, sans Markdown.`;

export function systemBlocks(ctx: MindContext, brand: string): Anthropic.TextBlockParam[] {
  const a = ctx.agent;
  const persona = [
    `Tu es ${a.name}, ${a.role} chez ${brand} (département ${a.dept}${a.isChief ? ', chef de département' : ''}).`,
    a.persona ? `Personnalité et façon de travailler : ${clean(a.persona)}` : '',
    a.skills?.length ? `Compétences : ${a.skills.join(', ')}.` : '',
    a.tools?.length ? `Outils connectés : ${a.tools.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
  const stable = `${COMPANY.replace('{brand}', brand).replace('{cliches}', CLICHE_TEMPLATES.slice(0, 8).map((c) => `« ${c.replace('{sujet}', 'bébé').replace('{diff}', 'différent')} »`).join(', '))}\n\n## Ton rôle\n${persona}`;

  const parts: string[] = [];
  if (ctx.playbook?.length) parts.push(`## Ton playbook (règles apprises, à respecter strictement)\n${ctx.playbook.map((r) => `- ${clean(r)}`).join('\n')}`);
  if (ctx.brainNotes?.length) {
    parts.push(`## Notes du cerveau consultées avant d'agir\n${ctx.brainNotes.slice(0, 6).map((n) => `### ${clean(n.title)} (${n.path})\n${fit(clean(n.excerpt), 700)}`).join('\n\n')}`);
  }
  if (ctx.lessons?.length) {
    parts.push(`## Leçons récentes de l'agence\n${ctx.lessons.slice(0, 8).map((l) => `- ${clean(l.insight)} (${clean(l.evidence)}, confiance ${Math.round((l.confidence ?? 0) * 100)} %)`).join('\n')}`);
  }
  parts.push(`Nous sommes au jour ${ctx.day} de la simulation.`);
  return [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: parts.join('\n\n') },
  ];
}

export function json(v: unknown): string {
  return JSON.stringify(v, null, 1);
}

/**
 * The research as Claude reads it: the items' structure (fix of each mistake, rank and moment of each
 * step, troubleshooting cases) is made explicit, and only the material of the guide being written is shown.
 */
export function vocBrief(v: VoiceOfCustomer | null | undefined, topicId: string | null = null): unknown {
  if (!v) return null;
  const { core, topics } = parseKnowledge(v.knowledge ?? { tips: [], steps: [], mistakes: [], examples: [], facts: [] });
  const m = topicId ? topics[topicId] ?? core : core;
  return {
    profondeur: v.depth, douleurs: v.pains, phrasesClients: v.phrases, objections: v.objections, resultatsVoulus: v.desiredOutcomes,
    conseils: m.tips, etapes: m.steps.map((s) => ({ rang: s.rank, action: s.text, detail: s.detail, moment: s.when, duree: s.duration, diagnostic: s.diagnostic })),
    erreurs: m.pairs.map((p) => ({ erreur: p.mistake, pourquoi: p.why, correction: p.fix })),
    situations: m.situations.map((s) => ({ si: s.when, reponse: s.what })),
    aObserver: m.observe, pourTenir: m.keep, modeles: m.models,
    exemplesTypesFictifs: m.examples, faits: m.facts, prixCites: v.priceAnchors, allegationsInterdites: v.bannedClaims,
  };
}

export function productBrief(p: Product | null | undefined): unknown {
  if (!p) return null;
  return { id: p.id, titre: p.title, sousTitre: p.subtitle, audience: p.audience, probleme: p.problem, prix: p.price, statut: p.status, version: p.version };
}

export function contentOutline(c: PdfContent | null | undefined): unknown {
  if (!c) return null;
  return {
    titre: c.title, promesse: c.promise, audience: c.audience, mots: c.wordCount,
    chapitres: c.chapters.map((ch) => ({ titre: ch.title, intro: ch.intro, etapes: ch.steps.slice(0, 4), exemple: ch.example })),
    bonus: c.bonus.title, suite: c.nextStep.title,
  };
}

/** Text fields only (visual numbers stripped) for the editing passes. */
export function contentTexts(c: PdfContent): unknown {
  const ch = (x: PdfContent['bonus']) => ({ titre: x.title, intro: x.intro, paragraphes: x.paragraphs, etapes: x.steps, exemple: x.example, checklist: x.checklist });
  return { titre: c.title, sousTitre: c.subtitle, promesse: c.promise, introduction: c.introduction, chapitres: c.chapters.map(ch), bonus: ch(c.bonus), suite: c.nextStep };
}
