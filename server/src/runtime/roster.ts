/**
 * Every department the agency can open (floating islands) and the rules each one starts with. People live in org/catalog.ts.
 * Pure data — no imports from other modules so it can be used anywhere (tests, UI seeds).
 */
import type { DeptDef, DeptId } from '../shared.js';

// ───────────────────────────── Departments ─────────────────────────────
// Island grid around the central plaza (0,0 = Direction + Cerveau + café). The ten first islands
// sit on the radius-3 ring, two cells apart, which projects to a clean ellipse in isometric view.
// Video and CRM take their cells of ui §2.4 (D36). chiefId is the named candidate, reconcileOrg keeps it true.

export const DEPARTMENTS: DeptDef[] = [
  {
    id: 'direction', name: 'Direction', color: '#f4c542', icon: 'DIRECTION', chiefId: 'camille',
    description: "La place centrale : le CEO fixe le cap chaque matin, valide les livrables avant leur sortie et arbitre go / kill sur chaque produit.",
    grid: { col: 0, row: 0 },
  },
  {
    id: 'recherche', name: 'Recherche', color: '#3a86ff', icon: 'RECHERCHE', chiefId: 'nadia',
    description: "Chasse les niches où les gens sont prêts à payer : tendances TikTok, concurrents Gumroad/Etsy et mots exacts des clients.",
    grid: { col: -3, row: -1 },
  },
  {
    id: 'studio', name: 'Studio PDF', color: '#e76f51', icon: 'STUDIO PDF', chiefId: 'elise',
    description: "Écrit les guides : 10 titres, plan qui vend, rédaction complète, humanisation et fact-check avant toute sortie.",
    grid: { col: -1, row: -3 },
  },
  {
    id: 'creation', name: 'Création', color: '#9d4edd', icon: 'CRÉATION', chiefId: 'zoe',
    description: "Couvertures lisibles en miniature, mise en page du PDF final et infographies par chapitre.",
    grid: { col: 1, row: -3 },
  },
  {
    id: 'growth', name: 'Pub TikTok', color: '#ff006e', icon: 'PUB TIKTOK', chiefId: 'leo',
    description: "Hooks, créas 9:16, campagnes payantes et contenu organique. Coupe vite ce qui ne marche pas, scale progressivement ce qui marche.",
    grid: { col: 3, row: -3 },
  },
  {
    id: 'partenariats', name: 'Partenariats', color: '#c08552', icon: 'PARTENARIATS', chiefId: 'rayan',
    description: "Recrute de petits créateurs de la niche, à la commission de préférence, et filtre les faux profils.",
    grid: { col: 3, row: -1 },
  },
  {
    id: 'boutique', name: 'Boutique', color: '#06d6a0', icon: 'BOUTIQUE', chiefId: 'clara',
    description: "Notre propre boutique : pages de vente avec les mots des clients, prix testés, mise en ligne et upsell « La suite est ici ».",
    grid: { col: 3, row: 1 },
  },
  {
    id: 'support', name: 'Service client', color: '#fb8500', icon: 'SUPPORT', chiefId: 'ines',
    description: "La boîte mail : répond sous 24 h, rembourse de bonne foi, bloque les arnaques et remonte les plaintes qualité au Studio.",
    grid: { col: 1, row: 3 },
  },
  {
    id: 'finance', name: 'Finance', color: '#80b918', icon: 'FINANCE', chiefId: 'gabriel',
    description: "Grand livre, trésorerie et runway. Fixe chaque matin l'enveloppe pub du jour et déclenche le mode survie si besoin.",
    grid: { col: -1, row: 3 },
  },
  {
    id: 'analyse', name: 'Analyse', color: '#00b4d8', icon: 'ANALYSE', chiefId: 'raphael',
    description: "Rapport quotidien, attribution des ventes et expériences A/B : une variable à la fois, une conclusion seulement avec assez de données.",
    grid: { col: -3, row: 3 },
  },
  {
    id: 'rh', name: 'RH & Apprentissage', color: '#b56576', icon: 'RH', chiefId: 'nora',
    description: "Rétro du soir, leçons chiffrées dans le cerveau, revues de performance hebdomadaires — et la Red Team qui essaie de tout tuer.",
    grid: { col: -3, row: 1 },
  },
  {
    id: 'video', name: 'Studio Vidéo', color: '#dc2626', icon: 'VIDÉO', chiefId: 'chloe',
    description: "Monte les pubs : hook lisible dès la première seconde, rythme, sous-titres et recadrage pour chaque canal.",
    grid: { col: 0, row: -2 },
  },
  {
    id: 'crm', name: 'Communauté & Email', color: '#10b981', icon: 'COMMUNAUTÉ', chiefId: 'tom',
    description: "Anime la communauté au quotidien et écrit à la liste e-mail : contenu organique, séquences et lettres utiles.",
    grid: { col: 2, row: 0 },
  },
];

// ───────────────────────────── Seed playbooks ─────────────────────────────
// Rules every member of a department starts with (from the seed brain). Machine-readable patterns
// (« Ne jamais écrire », « Niveau de promesse max »…) are honoured by the content engine and the runtime.

export const SEED_PLAYBOOKS: Record<DeptId, string[]> = {
  direction: [
    'Un seul problème pour un seul type de personne : refuser tout sujet trop large.',
    'Rien ne sort sans revue : fact-check, Red Team, puis validation du CEO.',
    'Juger la version en cours sur 14 jours : moins de 3 ventes et un ROAS < 0,7, ou de l’argent perdu sur 2 campagnes, et on arrête.',
    "Lancer un 2e PDF pour le même public dès qu'un produit est rentable (ROAS ≥ 1,5 et 10 ventes).",
  ],
  recherche: [
    "Chercher ce que les gens sont prêts à payer, pas ce qu'on sait.",
    'Noter les mots exacts des clients : ce sont eux qui vendent.',
    "Le nombre d'avis d'un concurrent estime ses ventes ; ses avis négatifs donnent notre angle.",
  ],
  studio: [
    'Ne jamais écrire « il est important de noter »',
    "Ne jamais écrire « n'hésitez pas à »",
    'Ne jamais écrire « soyez patient »',
    'Chaque chapitre : étapes numérotées, un exemple réel tiré de la recherche, une checklist.',
  ],
  creation: [
    "Titre gros et lisible en miniature, 2 ou 3 couleurs, beaucoup d'air.",
    'Le visuel montre le résultat désiré, pas le problème.',
    'Une infographie par chapitre quand elle aide : frise, étapes, à faire / à éviter.',
  ],
  growth: [
    'Ne jamais écrire « garanti »',
    'Ne jamais écrire « sans effort »',
    'Le hook tient dans les 2 premières secondes : la douleur avec les mots du client.',
    'Stop-loss : ROAS < 0,8 après 25 € dépensés sur au moins 2 jours → pause (ROAS < 0,4 : pause sans attendre le 2e jour) ; +30 % de budget par jour au maximum.',
  ],
  boutique: [
    'Niveau de promesse max « 0.6 »',
    'Utiliser les mots exacts des clients et traiter les objections avant qu’on les pose.',
    'Commencer bas (9 à 19 €) pour obtenir les premiers avis, puis monter le prix.',
  ],
  support: [
    "Répondre sous 24 h et identifier l'intention réelle avant d'écrire.",
    'Non reçu : renvoyer le lien tout de suite ; remboursement de bonne foi : rembourser sans discuter.',
    'Arnaque : ne jamais payer, ne jamais cliquer, bloquer. Troll : réponse courte ou ignorer.',
    'Remonter chaque plainte qualité au Studio pour la v2 du PDF.',
  ],
  analyse: [
    'Comparer le profit par visiteur, pas seulement le taux de conversion.',
    'Pas de conclusion sous 300 impressions ou 20 visites : on attend la donnée.',
    'Une seule variable par expérience A/B.',
  ],
  finance: [
    'Budget pub du jour ≤ 15 % de la trésorerie (≤ 8 % si le runway passe sous 14 jours).',
    'Aucune dépense ne doit faire passer la trésorerie sous 0.',
    'Mode survie sous 30 % du budget de départ : organique et créateurs à la commission uniquement.',
  ],
  rh: [
    "Essayer de tuer chaque idée avant qu'elle coûte de l'argent.",
    'Chaque erreur devient une leçon chiffrée dans le cerveau.',
    "Coacher d'abord : on juge sur les résultats, pas sur l'effort.",
  ],
  partenariats: [
    'Commission seule par défaut ; avance ≤ 10 % de la trésorerie et jamais à un profil suspect.',
    'Signaux d’alerte : faux abonnés, engagement anormal, avance énorme demandée.',
    "Petits créateurs de la niche d'abord : ils cherchent à monétiser leur audience.",
  ],
  video: [
    "Le hook se lit à l'écran dès la première seconde, avec les mots du client.",
    "Un plan par idée : on coupe dès que l'image n'apporte plus rien.",
    "Le texte et l'appel à l'action restent dans les zones sûres de chaque plateforme.",
  ],
  crm: [
    "Écrire à la liste seulement quand on a quelque chose d'utile à lui dire.",
    'Chaque e-mail porte un lien de désinscription qui marche.',
    'Répondre aux commentaires avec les mots des clients, sans jamais promettre plus que le guide.',
  ],
};

/** Brain note (file basename) of each department's playbook — linked from "00 - Accueil". `video` and `crm` join with their notes (P2.4). */
export const PLAYBOOK_NOTES: Partial<Record<DeptId, string>> = {
  direction: 'Playbook Direction',
  recherche: 'Playbook Recherche',
  studio: 'Playbook Studio',
  creation: 'Playbook Création',
  growth: 'Playbook Growth',
  boutique: 'Playbook Boutique',
  support: 'Playbook Support',
  analyse: 'Playbook Analyse',
  finance: 'Playbook Finance',
  rh: 'Playbook RH',
  partenariats: 'Playbook Partenariats',
};

export function deptOf(id: DeptId): DeptDef {
  return DEPARTMENTS.find((d) => d.id === id)!;
}
