/**
 * What a buyer writes, as the public reads it: one line is one entry of each slot, in order, so a pool holds thousands of them.
 * Each slot stands alone: any opening reads with any body. Nothing here claims what the world may not hold (a bonus, a refund).
 * An empty entry leaves its slot out, which is why short reviews exist.
 */
export type ReviewPool = 'good' | 'mid' | 'bad' | 'support_bad' | 'support_good' | 'troll';

export const REVIEW_BANK: Readonly<Record<ReviewPool, readonly (readonly string[])[]>> = {
  good: [
    [
      '', 'Acheté un soir de ras-le-bol.', "J'hésitais depuis des semaines.", "Une amie me l'avait conseillé.", 'Pris après avoir vu la pub, sans trop y croire.',
      "J'avais déjà lu pas mal de choses sur le sujet.", "Je ne laisse presque jamais d'avis.", 'Bonne surprise.', 'Je partais sceptique.',
      'Deuxième lecture ce week-end.', 'Reçu tout de suite après le paiement.', "On l'a lu à deux.", 'Franchement, je ne regrette pas.', 'Petit prix, vraie aide.',
    ],
    [
      "Le chapitre « {chapitre} » m'a servi dès le premier soir.", 'Le chapitre « {chapitre} » vaut à lui seul le prix.', "J'ai relu plusieurs fois « {chapitre} ».",
      'On se reconnaît dans les exemples, surtout « {phrase} ».', "« {phrase} » : c'est exactement chez nous.", 'Les étapes sont claires, on sait par quoi commencer.',
      'Tout est concret : on lit, on applique, ça avance.', 'Pas de blabla, on va droit à ce qui compte.', 'La méthode tient la route, étape par étape.',
      'Enfin quelque chose qui parle de notre vrai problème : {pain}.', 'Il répond précisément à ce qui nous bloquait : {pain}.',
      "Ça change des conseils vagues qu'on trouve partout.", "Le ton est honnête, sans promesse en l'air.", 'Lu en une soirée, appliqué le lendemain.',
      'Les conseils sont simples à tenir au quotidien.', "C'est écrit pour des gens normaux, avec peu de temps.",
    ],
    [
      '', 'Je recommande.', 'Merci pour ce guide.', 'Ça vaut largement son prix.', 'Je le garde sous la main.', 'Je vais le passer à ma sœur.',
      'On continue avec la suite du plan.', 'Bon achat.', 'Rien à redire.', 'On voit déjà la différence chez nous.', 'À lire sans attendre.', 'Je referai confiance à cette boutique.',
    ],
  ],
  mid: [
    ['', 'Avis partagé.', 'Correct sans plus.', 'Pas mal pour débuter.', "Je m'attendais à un peu plus.", 'Lecture rapide.', 'Bien pour le prix.', 'Mitigé.', 'Pas mauvais.', 'Un peu court à mon goût.'],
    [
      'Quelques bonnes idées dans « {chapitre} », mais il manque des exemples concrets.', 'Le chapitre « {chapitre} » est utile, le reste plus général.',
      'Certaines parties restent assez générales.', 'Le contenu est bon, la mise en page un peu chargée sur téléphone.', 'Une partie des conseils se trouve gratuitement ailleurs.',
      'Bien structuré, mais il manque des réponses pour notre cas précis : {pain}.', 'Ça aide à s’organiser, moins à traiter le fond : {pain}.',
      "La première moitié est solide, la fin s'essouffle.", 'Les étapes sont claires, mais un peu rapides.', 'Trop de théorie à mon goût avant de passer aux gestes.',
      'Utile pour démarrer, léger pour aller plus loin.', "On sent le sérieux, mais c'est inégal selon les chapitres.",
    ],
    ['', 'Trois étoiles, pas plus.', 'À revoir dans une prochaine version.', 'Ça dépanne.', 'Je ne regrette pas, sans plus.', 'Peut mieux faire.', 'Je le garde quand même.', "À compléter avec d'autres sources."],
  ],
  bad: [
    [
      '', 'Déception.', 'Je ne recommande pas.', 'Argent mal dépensé.', "J'y croyais, à tort.", 'Bof.', 'Vraiment pas à la hauteur.', "Je m'attendais à autre chose.",
      'Pas du tout ce que la pub laissait entendre.', 'Lu en vingt minutes, et après ?', 'Dommage.', 'Très moyen pour ce prix.',
    ],
    [
      'Beaucoup de généralités, on dirait un texte écrit par une IA.', 'La page de vente promettait beaucoup plus que ce que contient le guide.', 'Trop court pour le prix, et aucun exemple concret.',
      "Rien qu'on ne trouve pas gratuitement en dix minutes de recherche.", 'Des répétitions partout et des conseils vagues.', 'Le guide ne parle presque pas de notre vrai problème : {pain}.',
      'Mise en page bâclée et conseils contradictoires.', 'Le chapitre « {chapitre} » tourne en rond.', "Rien de nouveau par rapport à ce qu'on savait déjà.",
      'Des promesses, mais aucune méthode à appliquer.', 'On a essayé, rien ne change chez nous.', 'Ça sonne faux, on sent le copier-coller.', 'Impossible de savoir par où commencer.',
      'Les conseils ne tiennent pas dans une vraie journée.',
    ],
    ['', 'À éviter.', 'Je passe.', 'Je ne rachèterai pas ici.', 'Passez votre chemin.', 'Dommage pour le prix.', 'Une étoile de trop.', 'Grosse déception.'],
  ],
  support_bad: [
    [
      'Aucune réponse du support depuis plusieurs jours.', 'Service client inexistant.', "J'ai écrit trois fois, zéro réponse.", 'Message ignoré, problème jamais réglé.',
      'Réponse hautaine du support, aucune solution proposée.', 'Une semaine sans nouvelles après mon message.', 'Le support répond à côté de la question.', 'Réponse automatique, puis plus rien.',
      'On me renvoie vers une page qui ne règle rien.', "Impossible de joindre quelqu'un.", 'Mon problème de téléchargement traîne toujours.', 'Le support promet un retour qui ne vient jamais.',
    ],
    ['Je déconseille fortement.', 'Boutique à fuir.', '1 étoile, et encore.', 'Très mauvaise expérience.', 'Inadmissible pour un achat en ligne.', "Je n'achèterai plus ici.", 'Aucun sérieux.', 'Ça gâche tout.', 'Soyez prévenus.', 'Quelle déception.'],
  ],
  support_good: [
    [
      'Petit souci au téléchargement, réglé en quelques heures.', 'Service client au top.', "J'ai eu un problème de lien, réponse le jour même.",
      "Une question avant d'appliquer la méthode, réponse claire et rapide.", 'Mon message était un peu sec, le support est resté très pro.', 'Erreur sur ma commande, corrigée sans discuter.',
      'Réponse rapide, humaine et efficace.', 'Support réactif, une vraie personne au bout.', 'Fichier introuvable dans mes mails, renvoyé tout de suite.',
      'Le support a pris le temps de bien comprendre mon souci.', "Demande traitée en moins d'une journée.", 'Un souci de paiement réglé très vite.',
    ],
    ['Merci !', 'Respect.', 'Adorable.', 'Ça fait plaisir.', 'Rare de nos jours.', "Bravo à toute l'équipe.", 'Je recommande cette boutique.', 'Service impeccable.', 'On se sent écouté.', 'Rien à dire.'],
  ],
  troll: [
    [
      'Arnaque.', 'Encore un PDF ChatGPT vendu une fortune.', 'Vendeurs de vent.', 'Du vent.', 'Nul.', 'Zéro intérêt.', 'Escroquerie pure et simple.', 'Un PDF de plus pour plumer les gens.',
      'Qui achète encore ce genre de truc ?', "Du copier-coller vendu à prix d'or.", 'Mdr ce guide.', 'Pigeons, bienvenue.', 'Ça sent la vente forcée.', 'Aucun intérêt, comme la pub.',
    ],
    [
      '', 'Fuyez.', "1 étoile parce que 0 n'est pas possible.", 'Passez votre chemin.', 'Ne tombez pas dans le panneau.', 'Honteux.', 'Lamentable.', 'Signalé.',
      'Je préviens tout le monde.', 'Allez voir ailleurs.', 'Sans moi.', 'Bonne chance aux acheteurs.', 'À fuir.', 'Pathétique.',
    ],
  ],
};
