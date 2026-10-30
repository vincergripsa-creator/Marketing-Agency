/** French reference lists taken from the seed brain (used as guards, never as content). */

/** Fallback generic "AI" phrases (the sim's GENERIC_PHRASES is the source of truth). */
export const GENERIC_FALLBACK: readonly string[] = [
  'chaque bébé est différent', 'soyez patient', 'il est important de noter', "n'hésitez pas à", 'en conclusion',
  'dans le monde d’aujourd’hui', 'il est essentiel de', 'en fin de compte', 'force est de constater', 'chaque personne est unique',
];

/** Risky ad / sales claims from « Conformité pub TikTok ». */
export const COMPLIANCE_WORDS: readonly string[] = [
  'garanti', '100 %', '100%', 'en 3 jours seulement', 'à coup sûr', 'guérir', 'soigner', 'remplace votre médecin',
  'devenir riche', 'revenu passif garanti', 'sans effort', 'plus que 2 exemplaires', 'miracle',
];

/** Support policy handed to the support writer (from « Support client »). */
export const SUPPORT_POLICY: readonly string[] = [
  'Répondre sous 24 h, avec empathie, une solution concrète, un ton humain et une signature.',
  "Identifier l'intention réelle avant de répondre (non reçu, remboursement, arnaque, plainte…).",
  'Non reçu : renvoyer le lien de téléchargement immédiatement, avec des excuses.',
  'Demande de remboursement de bonne foi : rembourser (un chargeback coûte le montant + 15 € de frais).',
  'Troll : ne pas argumenter, réponse courte et polie ou ignorer.',
  'Arnaque (paiement pour des vues, faux support TikTok, lien suspect) : ne jamais payer, ne jamais cliquer, bloquer.',
  'Plainte qualité : remercier, proposer une solution concrète, remonter le retour au Studio.',
  'Demande sur mesure : expliquer gentiment ce que nous proposons et noter l’idée.',
];

export const INTENT_LABELS: Record<string, string> = {
  question: 'question', non_recu: 'PDF non reçu', remboursement: 'remboursement', plainte_qualite: 'plainte qualité',
  sur_mesure: 'demande sur mesure', partenariat: 'partenariat', arnaque: 'arnaque', compliment: 'compliment', troll: 'troll',
  menace_chargeback: 'menace de chargeback', bug_paiement: 'bug de paiement',
};

export const HOOK_LABELS: Record<string, string> = {
  question: 'question', contrarian: 'contre-intuitif', story: 'histoire', stat: 'chiffre choc', pov: 'POV',
  mistake: 'erreur à éviter', before_after: 'avant / après', listicle: 'liste',
};

export const FORMAT_LABELS: Record<string, string> = {
  faceless_voiceover: 'voix off sans visage', text_slideshow: 'diaporama texte', ugc_avatar: 'avatar UGC', carousel: 'carrousel',
};
