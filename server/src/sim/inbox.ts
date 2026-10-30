/** French customer messages: templates per intent, archetype tone, follow-ups and reactions. */
import { nextId } from '../core/index.js';
import type { Rng } from '../contracts.js';
import type { Customer, CustomerArchetype, InboxMessage, MessageIntent, NicheTruth, Order, Product, WorldState } from '../shared.js';
import { displayName } from './customers.js';
import { fill, fmtEur, norm } from './text.js';

interface Tpl { subject: string; body: string }

const T: Record<MessageIntent, Tpl[]> = {
  question: [
    { subject: 'Question avant achat', body: "Bonjour, chez nous c'est « {phrase} ». Est-ce que votre guide « {produit} » peut vraiment aider dans ce cas ? Merci !" },
    { subject: 'Combien de pages ?', body: 'Bonjour, le PDF fait combien de pages à peu près ? Et il se lit bien sur téléphone ?' },
    { subject: 'Guide imprimable ?', body: "Hello, est-ce que le guide est imprimable ? Je préfère le papier pour cocher les checklists." },
    { subject: 'Est-ce que le guide en parle ?', body: "Bonsoir, je voulais savoir si le guide parle aussi de ce problème : {pain}. C'est notre plus gros souci en ce moment." },
    { subject: 'Téléchargement', body: "Bonjour, une fois acheté, je peux le télécharger plusieurs fois ? J'ai changé de téléphone récemment." },
    { subject: 'Par quoi commencer ?', body: "Bonjour, j'ai commencé le chapitre « {chapitre} », mais je ne sais pas par quelle étape commencer dans notre cas : {pain}. Vous pouvez m'éclairer ?" },
    { subject: 'Mises à jour', body: 'Si vous sortez une nouvelle version du guide, est-ce que je la reçois gratuitement ?' },
    { subject: 'Paiement en 2 fois ?', body: "Bonjour, c'est possible de payer en 2 fois ? Fin de mois un peu difficile…" },
    { subject: 'Pour offrir', body: "Coucou, je voudrais l'offrir à ma sœur, comment je fais pour qu'elle le reçoive directement ?" },
  ],
  non_recu: [
    { subject: 'PDF non reçu', body: "Bonjour, j'ai payé {prix} ce matin pour « {produit} » et je n'ai rien reçu. Pouvez-vous me renvoyer le lien ?" },
    { subject: 'Commande sans lien', body: 'Bonjour, je ne trouve pas le mail avec le guide, ni dans les spams. Le paiement est pourtant bien passé sur mon compte.' },
    { subject: 'Lien expiré', body: "Le lien de téléchargement me dit « expiré ». J'ai acheté hier soir. Merci de m'aider." },
    { subject: 'Toujours rien', body: "Bonjour, ça fait plusieurs heures et toujours pas de PDF. C'est normal ?" },
    { subject: 'Erreur dans mon adresse', body: "Bonjour, je crois que j'ai fait une faute dans mon adresse mail en payant… Vous pouvez renvoyer le guide sur celle-ci ?" },
    { subject: 'Fichier illisible', body: "Le fichier téléchargé ne s'ouvre pas sur mon téléphone, il affiche une erreur. Vous pouvez me le renvoyer ?" },
    { subject: 'Où est mon guide ?', body: "Coucou, j'ai bien reçu la confirmation de paiement mais pas le guide « {produit} ». Merci de regarder !" },
    { subject: 'Téléchargement impossible', body: "Bonjour, quand je clique sur le bouton de téléchargement il ne se passe rien. J'ai essayé sur ordinateur et sur téléphone." },
  ],
  remboursement: [
    { subject: 'Demande de remboursement', body: "Bonjour, j'ai acheté « {produit} » mais il ne correspond pas à ce que je cherchais. Je souhaiterais être remboursé(e), s'il vous plaît." },
    { subject: 'Remboursement', body: "Bonjour, en lisant le guide je me rends compte que je connaissais déjà la plupart des conseils. Est-il possible d'être remboursé ?" },
    { subject: 'Achat sans autorisation', body: 'Mon fils a acheté le guide avec ma carte sans me demander. Pouvez-vous annuler et rembourser ?' },
    { subject: 'Pas adapté à notre cas', body: 'Bonjour, le guide est bien fait mais pas adapté à notre situation. Je préfère être remboursée, merci de votre compréhension.' },
    { subject: 'Satisfait ou remboursé', body: 'Bonjour, comme indiqué sur votre page (satisfait ou remboursé), je demande le remboursement de ma commande de {prix}.' },
    { subject: 'Déçue', body: "Je m'attendais à beaucoup plus pour {prix}. Je souhaite être remboursée." },
    { subject: 'Annulation', body: "Bonjour, je voudrais annuler mon achat d'hier, je n'ai même pas encore ouvert le fichier." },
    { subject: "Ça n'a pas marché", body: "Bonjour, j'ai appliqué les étapes pendant une semaine et rien n'a changé : {phrase}. Je voudrais un remboursement." },
  ],
  plainte_qualite: [
    { subject: 'Déçu du contenu', body: "Bonjour, j'ai lu « {produit} » en entier et franchement c'est très général. Rien de concret pour notre situation. Dommage." },
    { subject: 'Répétitions', body: "Il y a des répétitions partout et des phrases qui ne veulent rien dire. On sent que c'est écrit vite." },
    { subject: 'Trop court', body: 'Le guide se lit en 15 minutes. Pour {prix}, je m\'attendais à plus de contenu et à de vrais exemples.' },
    { subject: 'Conseils contradictoires', body: "Le chapitre « {chapitre} » contredit ce qui est dit au début. Je ne sais plus quoi appliquer." },
    { subject: 'Pas ce qui était promis', body: "La page de vente promettait des résultats rapides, le guide dit l'inverse. C'est un peu trompeur." },
    { subject: 'Mise en page', body: 'Les visuels sont flous sur mon téléphone et le texte est minuscule.' },
    { subject: 'Rien de nouveau', body: 'Tout ce qui est dans le guide se trouve gratuitement sur internet. Je suis déçu(e).' },
    { subject: 'Le problème principal oublié', body: "Le guide ne parle presque pas de ça : {pain}. C'est pourtant le problème numéro 1 !" },
  ],
  sur_mesure: [
    { subject: 'Programme personnalisé ?', body: "Bonjour, pourriez-vous me faire un programme personnalisé ? Chez nous c'est « {phrase} ». Je suis prête à payer." },
    { subject: 'Une version pour mon cas', body: "Vous auriez une version du guide pour une situation un peu différente ? En gros : {pain}." },
    { subject: 'Consultation en visio', body: "Bonjour, vous proposez des consultations en visio ? J'aurais besoin qu'on regarde ma situation ensemble." },
    { subject: 'English version?', body: "Hello, do you have this guide in English? Mon conjoint ne parle pas français." },
    { subject: 'Version papier', body: 'Bonjour, est-il possible de commander une version imprimée et reliée du guide ?' },
    { subject: 'Pour mon association', body: 'Bonjour, je gère une petite association : pourriez-vous adapter le guide pour nos ateliers ?' },
    { subject: 'Et la suite ?', body: "J'ai adoré le guide, vous en préparez un sur la suite ? Je serais preneuse d'un guide pour : {desired}." },
    { subject: 'Coaching', body: "Bonjour, vous faites du coaching individuel ? J'aimerais un suivi sur 4 semaines." },
  ],
  partenariat: [
    { subject: 'Collaboration SEO', body: 'Bonjour, nous sommes une agence SEO. Nous pouvons placer votre boutique en première page de Google en 30 jours. Tarif de lancement : 390 €.' },
    { subject: 'Créatrice UGC dispo', body: 'Coucou ! Je suis créatrice UGC, mes tarifs : 250 € la vidéo, 600 € les trois. Dispo cette semaine !' },
    { subject: 'Backlinks DA 90+', body: 'Hello, I sell high quality backlinks DA 90+, 50 links for 99$. Interested?' },
    { subject: 'Nouvelle marketplace', body: 'Bonjour, nous lançons une marketplace de guides PDF. Nous prenons 60 % de commission mais offrons une visibilité énorme.' },
    { subject: 'Rachat de boutique', body: 'Bonjour, nous rachetons des boutiques de produits numériques. Seriez-vous vendeur ? Faites-nous une offre.' },
    { subject: 'Podcast sponsorisé', body: "Bonjour, j'anime un podcast (800 écoutes par épisode). Un passage sponsorisé coûte 180 €." },
    { subject: 'Traduction express', body: "Bonjour, nous traduisons vos guides en 12 langues avec l'IA, 49 € par langue." },
    { subject: 'Échange de visibilité', body: 'Salut ! On fait un échange de visibilité ? Je partage ta boutique, tu partages la mienne (bougies parfumées).' },
    { subject: 'Ambassadrice', body: "Bonjour, j'ai 1 200 abonnés et j'aimerais devenir ambassadrice de votre marque. Vous m'envoyez le guide gratuitement ?" },
  ],
  arnaque: [
    { subject: 'URGENT : vérification de votre compte publicitaire', body: 'Bonjour, suite à plusieurs signalements, votre compte publicitaire sera suspendu sous 24 h. Pour éviter la suspension, confirmez vos informations de paiement ici : hxxp://tiktok-ads-verification[.]com/compte — Équipe TikTok for Business' },
    { subject: '1 million de vues', body: 'Salut ! Je gère un réseau de 40 pages TikTok. Je te garantis 1 million de vues sur ta vidéo pour seulement 149 €. Paiement PayPal « entre proches » uniquement.' },
    { subject: 'Remboursement non reçu', body: "Bonjour, j'ai acheté votre guide mais je n'ai jamais rien reçu. Remboursez-moi 49 € sur ce compte : FR76 3000 •••• •••• 2231. Merci de faire vite." },
    { subject: 'Votre produit a été sélectionné', body: "Félicitations ! « {produit} » a été sélectionné pour notre programme d'influenceurs. Frais d'inscription : 89 €, à régler sous 24 h pour garder votre place." },
    { subject: 'Facture impayée', body: 'Votre abonnement boutique est impayé. Réglez 59,90 € avant ce soir pour éviter la fermeture : hxxp://boutique-paiement-securise[.]net' },
    { subject: 'Commande groupée pour mon école', body: 'Bonjour, je dirige une école et je veux 50 licences de votre guide. Je vous envoie 1 200 € par virement, vous me rembourserez simplement la différence de 300 €.' },
    { subject: 'Badge vérifié', body: 'Obtenez le badge bleu certifié sur votre compte TikTok pour 120 €. Places limitées, répondez vite.' },
    { subject: "Atteinte aux droits d'auteur", body: "Votre guide utilise une image protégée. Payez 250 € de régularisation sous 48 h ou nous engageons des poursuites : hxxp://copyright-claims-office[.]org" },
    { subject: 'Support boutique : code de sécurité', body: "Bonjour, je suis du support de la boutique. Pour débloquer vos paiements, envoyez-moi le code à 6 chiffres que vous allez recevoir par SMS." },
  ],
  compliment: [
    { subject: 'Merci !', body: "Je voulais juste vous dire merci. On a appliqué le chapitre « {chapitre} » et ça change déjà tout chez nous." },
    { subject: 'Bravo pour le guide', body: 'Enfin un guide qui parle vraiment de notre situation. Objectif « {desired} » : on y est presque !' },
    { subject: 'Super guide', body: "Clair, concret, bien illustré. Je l'ai déjà conseillé à deux amies." },
    { subject: 'Ça marche !', body: "Je n'y croyais plus, mais les étapes du guide ont marché. Merci du fond du cœur." },
    { subject: 'Coup de cœur', body: "La checklist à la fin de chaque chapitre est géniale, je l'ai imprimée et collée sur le frigo." },
    { subject: 'Merci pour les exemples', body: "Les exemples concrets m'ont beaucoup parlé, on se reconnaît vraiment dedans." },
    { subject: 'Je recommande', body: "Acheté hier, lu d'une traite. Vous faites d'autres guides ? Je prends !" },
    { subject: 'Petit mot', body: "Juste un petit mot pour dire que votre guide m'a redonné confiance. Merci à toute l'équipe." },
  ],
  troll: [
    { subject: 'lol', body: 'Qui achète encore des PDF en 2026 mdr' },
    { subject: 'ARNAQUE', body: "ARNAQUE. Tout ça c'est du ChatGPT recraché, signalé." },
    { subject: 'Sérieux ?', body: '{prix} pour des conseils que ma grand-mère donne gratuitement, vous êtes sérieux ?' },
    { subject: '…', body: "ratio + t'as pas de vrai métier" },
    { subject: 'Avis', body: "J'ai pas acheté mais ça a l'air nul. 1 étoile." },
    { subject: 'Vendeurs de vent', body: "Le business des PDF c'est une pyramide pour les nuls." },
    { subject: 'mdr', body: 'Les gens qui achètent ça sont les mêmes qui achetaient des NFT' },
    { subject: 'Bonne blague', body: 'Votre pub m\'a fait rire, merci pour le moment de comédie.' },
    { subject: 'Des bots ?', body: "C'est des bots qui commentent vos pubs ou quoi ?" },
  ],
  menace_chargeback: [
    { subject: 'Opposition bancaire', body: 'Bonjour, si je ne suis pas remboursé(e) sous 48 h, je fais opposition auprès de ma banque pour ce paiement de {prix}.' },
    { subject: 'Litige ouvert', body: "J'ai déjà ouvert un litige avec ma banque. Remboursez-moi tout de suite et je l'annule." },
    { subject: 'Dernier avertissement', body: 'Dernier message avant de contester le paiement auprès de ma banque. Le guide ne correspond pas du tout à la description.' },
    { subject: 'Paiement non reconnu', body: 'Je ne reconnais pas ce paiement de {prix} sur mon relevé. Remboursez-moi ou je le signale comme fraude.' },
    { subject: 'Je veux mon argent', body: "Je veux mon argent. Sinon ma banque s'en chargera, et c'est vous qui paierez les frais." },
    { subject: 'Contestation', body: "Mon conseiller bancaire m'a dit que je pouvais contester le paiement. Je vous laisse une chance de rembourser avant." },
    { subject: 'Avant de passer par ma banque', body: 'Bonjour, avant de passer par ma banque, je préfère vous demander directement le remboursement de ma commande.' },
    { subject: 'Site douteux ?', body: 'Votre site ressemble à une arnaque. Remboursement sous 24 h ou opposition.' },
  ],
  bug_paiement: [
    { subject: 'Débité deux fois', body: "Bonjour, j'ai été débité deux fois de {prix} pour la même commande. Pouvez-vous rembourser le doublon ?" },
    { subject: 'Paiement refusé', body: 'Le paiement est refusé à chaque fois alors que ma carte fonctionne partout ailleurs. Vous avez une autre solution ?' },
    { subject: 'Bouton « Payer » bloqué', body: 'Le bouton « Payer » tourne dans le vide sur mon téléphone. J\'ai réessayé trois fois.' },
    { subject: 'Double prélèvement', body: "Ma banque affiche deux prélèvements identiques pour « {produit} ». Je n'ai acheté qu'une fois." },
    { subject: 'Erreur après paiement', body: "Le paiement est passé (je vois le débit) mais la page affiche « erreur ». J'ai le guide ou pas ?" },
    { subject: 'Code promo invalide', body: 'Le code promo ne fonctionne pas au moment du paiement, il affiche « invalide ».' },
    { subject: 'PayPal ?', body: 'Est-ce que vous acceptez PayPal ? Ma carte ne passe pas sur votre page.' },
    { subject: 'Validation bancaire', body: 'Je ne reçois jamais le SMS de validation de ma banque au moment de payer.' },
  ],
};

const IMPATIENT_TAILS = ['???', 'Toujours rien ???', "Je l'ai payé, je veux une réponse MAINTENANT.", 'Ça fait 2 heures ???', 'Vous répondez quand ???'];
const KAREN_TAILS = [
  "Si ce n'est pas réglé AUJOURD'HUI, je laisse un avis 1 étoile partout.",
  'Je vais prévenir tout mon groupe Facebook de 12 000 membres.',
  'JE VEUX PARLER À UN RESPONSABLE.',
  'Je connais mes droits, je vais signaler votre boutique à la répression des fraudes.',
  "C'est INADMISSIBLE pour une entreprise sérieuse.",
];
const SCEPTIC_TAILS = [
  "Franchement, c'est encore un PDF ChatGPT ?",
  "Vous l'avez écrit vous-même ou c'est de l'IA ?",
  "J'ai l'impression d'avoir déjà lu tout ça gratuitement sur un forum.",
  'Vous avez des sources, au moins ?',
];
const LOST_HEADS = ['bonjour excusez moi je suis pas doué avec internet, ', 'bonjour, je comprend rien à ces trucs, ', 'rebonjour, c\'est encore moi, '];
const CHARGEBACK_TAILS = ['Sans remboursement sous 48 h, je fais opposition auprès de ma banque.', 'Sinon je conteste le paiement, je vous préviens.'];
const SUPERFAN_TAILS = ['Merci encore, vous êtes au top !', 'Hâte de lire votre prochain guide !'];

function shoutSome(rng: Rng, text: string): string {
  const words = text.split(' ');
  const idx = words.map((w, i) => (w.replace(/[^\p{L}]/gu, '').length >= 5 ? i : -1)).filter((i) => i >= 0);
  for (const i of rng.shuffle(idx).slice(0, Math.min(3, idx.length))) words[i] = words[i]!.toUpperCase();
  return words.join(' ');
}

/** Applies the archetype's voice to a template body. */
export function applyTone(rng: Rng, archetype: CustomerArchetype, body: string): string {
  switch (archetype) {
    case 'impatient': {
      const first = body.split(/(?<=[.!?])\s+/)[0] ?? body;
      const tail = rng.pick(IMPATIENT_TAILS);
      return tail === '???' ? `${first.replace(/[\s?!.…]+$/, '')} ???` : `${first} ${tail}`;
    }
    case 'karen': return `${shoutSome(rng, body)} ${rng.pick(KAREN_TAILS)}`;
    case 'sceptique': return `${body} ${rng.pick(SCEPTIC_TAILS)}`;
    case 'perdu': {
      const rest = body.replace(/^(bonjour|bonsoir|coucou|hello)\s*,?\s*/i, '');
      return `${rng.pick(LOST_HEADS)}${rest.charAt(0).toLowerCase()}${rest.slice(1)} merci d'avance`;
    }
    case 'menace_chargeback': return /banque|opposition|contest/i.test(body) ? body : `${body} ${rng.pick(CHARGEBACK_TAILS)}`;
    case 'superfan': return `${body} ${rng.pick(SUPERFAN_TAILS)}`;
    default: return body;
  }
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

export function messageVars(rng: Rng, product: Product | null, niche: NicheTruth | undefined, price?: number): Record<string, string> {
  const voc = niche?.voc;
  const chapters = product?.content?.chapters ?? [];
  return {
    produit: product?.title ?? 'votre guide',
    prix: fmtEur(price ?? product?.price ?? 19),
    phrase: voc && voc.phrases.length ? rng.pick(voc.phrases) : 'on est un peu perdus',
    pain: voc && voc.pains.length ? lowerFirst(rng.pick(voc.pains)) : 'notre situation',
    desired: voc && voc.desiredOutcomes.length ? lowerFirst(rng.pick(voc.desiredOutcomes)) : 'aller plus loin',
    chapitre: chapters.length ? rng.pick(chapters).title : 'le premier chapitre',
    audience: lowerFirst(product?.audience ?? niche?.audience ?? 'notre cas'),
  };
}

const URGENT: ReadonlySet<CustomerArchetype> = new Set<CustomerArchetype>(['impatient', 'karen', 'menace_chargeback']);

const BASE_MOOD: Record<MessageIntent, number> = {
  question: 0, non_recu: -0.3, remboursement: -0.4, plainte_qualite: -0.5, sur_mesure: 0.1, partenariat: 0.2, arnaque: 0,
  compliment: 0.8, troll: -0.6, menace_chargeback: -0.8, bug_paiement: -0.3,
};

const MOOD_SHIFT: Partial<Record<CustomerArchetype, number>> = { karen: -0.3, impatient: -0.2, superfan: 0.3, sceptique: -0.1, troll: -0.2 };

function defaultChannel(rng: Rng, intent: MessageIntent): InboxMessage['channel'] {
  switch (intent) {
    case 'arnaque': return rng.chance(0.5) ? 'dm' : 'email';
    case 'partenariat': return rng.chance(0.6) ? 'dm' : 'email';
    case 'troll': return rng.chance(0.6) ? 'commentaire_tiktok' : rng.chance(0.5) ? 'avis' : 'dm';
    case 'compliment': return rng.chance(0.3) ? 'commentaire_tiktok' : 'email';
    default: return 'email';
  }
}

/** Creates (and stores) an inbox message in the customer's voice. */
export function createMessage(world: WorldState, rng: Rng, input: {
  intent: MessageIntent; customer: Customer; product: Product | null; order: Order | null; niche?: NicheTruth;
  channel?: InboxMessage['channel']; templateIndex?: number;
}): InboxMessage {
  const { intent, customer, product, order, niche } = input;
  const list = T[intent] ?? T.question;
  const tpl = input.templateIndex !== undefined ? list[input.templateIndex % list.length]! : rng.pick(list);
  const vars = messageVars(rng, product, niche, order?.price);
  const raw = fill(tpl.body, vars);
  const body = intent === 'arnaque' || intent === 'partenariat' || intent === 'troll' ? raw : applyTone(rng, customer.archetype, raw);
  const subject = customer.archetype === 'karen' ? fill(tpl.subject, vars).toUpperCase() : fill(tpl.subject, vars);
  const day = world.day;
  const mood = Math.max(-1, Math.min(1, BASE_MOOD[intent] + (MOOD_SHIFT[customer.archetype] ?? 0)));
  const msg: InboxMessage = {
    id: nextId(world, 'msg'),
    day,
    customerId: customer.id,
    channel: input.channel ?? defaultChannel(rng, intent),
    subject,
    body,
    intent,
    productId: product?.id ?? null,
    orderId: order?.id ?? null,
    mood: Math.round(mood * 100) / 100,
    status: 'open',
    deadlineDay: day + (URGENT.has(customer.archetype) ? 1 : 2),
    thread: [{ from: 'customer', text: body, day }],
    resolution: null,
    customerName: displayName(customer),
    replyScore: null,
    repliedDay: null,
  };
  world.market.inbox.push(msg);
  return msg;
}

/** Amount a scam message asks for (used to book the loss when the agency pays). */
export function scamAmount(msg: InboxMessage, fallback: number): number {
  const m = norm(msg.body).match(/(\d[\d ]*(?:,\d{1,2})?)\s*(?:€|eur)/g);
  if (!m || m.length === 0) return fallback;
  // the "difference to give back" scam: the last amount is what you'd actually send
  const last = m[m.length - 1]!;
  const n = Number(last.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const FOLLOW_UPS: Partial<Record<MessageIntent, string[]>> = {
  non_recu: ["Toujours pas de lien. Je commence à m'inquiéter.", "Vous m'avez répondu mais je n'ai toujours RIEN reçu.", 'Le lien ne marche toujours pas chez moi.'],
  remboursement: ["Je n'ai toujours pas vu le remboursement sur mon compte.", 'Je vous ai demandé un remboursement, pas un discours.', 'Alors, ce remboursement ?'],
  plainte_qualite: ['Votre réponse ne règle pas le problème du contenu.', "Merci, mais ça ne change rien à la qualité du guide.", 'Vous comptez améliorer le guide ou pas ?'],
  menace_chargeback: ['Je ne plaisante pas : sans remboursement, je contacte ma banque demain.', 'Dernier délai avant opposition.'],
  bug_paiement: ['Le problème de paiement est toujours là.', "J'ai réessayé, même erreur."],
  question: ["Vous n'avez pas vraiment répondu à ma question.", 'Je relance : pouvez-vous me répondre clairement ?'],
  sur_mesure: ['Du coup, c\'est possible ou pas ?', 'Je relance pour ma demande personnalisée.'],
};
const GENERIC_FOLLOW_UPS = ['Je relance : pouvez-vous me répondre clairement ?', "Toujours en attente d'une vraie solution.", "Vous n'avez pas vraiment répondu."];

export function followUpText(rng: Rng, msg: InboxMessage, archetype: CustomerArchetype): string {
  const base = rng.pick(FOLLOW_UPS[msg.intent] ?? GENERIC_FOLLOW_UPS);
  return archetype === 'karen' ? `${shoutSome(rng, base)} ${rng.pick(KAREN_TAILS)}` : archetype === 'impatient' ? `${base} ???` : base;
}

export type ReactionKey =
  | 'link_ok' | 'refund_ok' | 'discount_ok' | 'answer_ok' | 'custom_ok' | 'compliment_ok' | 'unresolved' | 'angry'
  | 'karen_rage' | 'scam_blocked' | 'scam_paid' | 'scam_link' | 'troll_quiet' | 'troll_fed' | 'partner_declined' | 'chargeback_avoided'
  | 'refund_refused' | 'already_done';

const REACTIONS: Record<ReactionKey, string[]> = {
  link_ok: ["Super, j'ai bien reçu le lien, merci pour la rapidité !", "C'est bon, le fichier s'ouvre. Merci beaucoup.", 'Reçu ! Désolée pour le dérangement, et merci.'],
  refund_ok: ['Merci pour le remboursement rapide, c\'est honnête de votre part.', 'Bien reçu le remboursement, merci.', "Ok, merci d'avoir réglé ça sans discuter."],
  discount_ok: ["Merci pour le geste, j'apprécie.", "D'accord, merci pour la réduction. Je vous laisse une chance.", 'Merci, ça compense un peu.'],
  answer_ok: ["Merci, c'est beaucoup plus clair !", 'Parfait, merci pour cette réponse détaillée.', 'Top, je commande ce soir alors.'],
  custom_ok: ["Merci pour la réponse, je garde l'idée en tête.", "D'accord, merci de m'avoir répondu aussi gentiment.", 'Merci, tenez-moi au courant si ça sort un jour !'],
  compliment_ok: ['Avec plaisir, merci à vous !', "C'est moi qui vous remercie !", 'Belle journée à vous aussi !'],
  unresolved: ['Ça ne répond pas du tout à ma question.', "Merci, mais ça ne règle pas mon problème.", "J'attendais une vraie solution, pas une réponse toute faite."],
  angry: ['Votre réponse est franchement décevante.', "C'est tout ? Je suis vraiment déçu(e).", 'Je ne recommanderai pas votre boutique.'],
  karen_rage: ["INADMISSIBLE. Mon avis 1 étoile est en ligne.", "JE N'EN RESTERAI PAS LÀ. Avis publié partout.", "Vous allez entendre parler de moi. Avis 1 étoile."],
  scam_blocked: ['(Le compte suspect a été bloqué, aucune suite.)', '(Message signalé et expéditeur bloqué.)', '(Le faux support disparaît après le blocage.)'],
  scam_paid: ["Merci ! (le compte disparaît aussitôt avec l'argent)", '(Paiement encaissé, puis plus aucune nouvelle.)', '(Le profil est supprimé dans l\'heure : l\'argent est perdu.)'],
  scam_link: ['(Le guide a été envoyé gratuitement à un compte frauduleux.)', '(Le fichier circule maintenant sur un canal de piratage.)'],
  troll_quiet: ['(Le troll n\'a plus rien trouvé à dire.)', '(Aucune réponse : le troll passe à autre chose.)', 'ok.'],
  troll_fed: ["Le troll fait des captures d'écran de votre réponse et les partage en se moquant.", "MDR vous répondez vraiment ? Encore une preuve que c'est une arnaque.", '(Le fil de commentaires s\'enflamme sous votre pub.)'],
  partner_declined: ["Pas de souci, bonne continuation.", "D'accord, merci pour la réponse.", '(Pas de réponse.)'],
  chargeback_avoided: ["Merci, j'annule ma démarche auprès de la banque.", "Ok, remboursement bien reçu, je retire le litige.", 'Bien, merci de ne pas avoir attendu.'],
  refund_refused: ["Donc vous refusez de me rembourser ? Très bien, j'en parlerai autour de moi.", "Je trouve ça malhonnête, votre page dit « satisfait ou remboursé ».", 'Je vais voir avec ma banque alors.'],
  already_done: ['Ce message est déjà traité.'],
};

export function reaction(rng: Rng, key: ReactionKey): string {
  return rng.pick(REACTIONS[key]);
}

export const MESSAGE_TEMPLATES = T;
