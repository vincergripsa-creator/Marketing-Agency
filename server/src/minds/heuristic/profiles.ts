/**
 * Editorial decisions per niche: which kind of guide it is, how long its plan runs, which printable
 * sheets it delivers and which sub-problem a follow-up guide covers. Unlike the market truth, none of
 * this is hidden: it is what an editor decides from the public brief, keyed by the niche id. A niche
 * without profile gets one from its brief (see `profileOf`).
 */
import type { GuideArchetype, NicheBrief, VoiceOfCustomer } from '../../shared.js';
import { norm, type Duration } from '../util.js';

export interface SheetSpec { title: string; columns: string[]; rows: string[]; cells?: (string | null)[][] }

export interface BonusSpec {
  title: string;
  lead: string;
  paragraphs: string[];
  steps: string[];
  checklist: string[];
  sheet: SheetSpec;
}

export interface TopicSpec {
  id: string;
  pain: string;        // the sub-problem, in the writer's words
  goal: string;        // what the follow-up guide promises
  title: string;
  dur: Duration;
  quotes: RegExp;      // on normalised text: the customer words about this sub-problem, and no others
  bonus: BonusSpec;
}

export interface GuideProfile {
  pain: string;        // the problem of the main guide, whatever side pain the research surfaced first
  archetype: GuideArchetype;
  dur: Duration;
  loop?: string[];     // behaviour loop shown in the « comprendre » chapter of a habit guide
  sheet: SheetSpec;    // printable sheet of the diagnostic chapter
  bonus: BonusSpec;
  topics: TopicSpec[];
}

const jours = (n: number): Duration => ({ n, unit: 'jours', unitOne: 'jour' });
const nuits = (n: number): Duration => ({ n, unit: 'nuits', unitOne: 'nuit' });
const semaines = (n: number): Duration => ({ n, unit: 'semaines', unitOne: 'semaine' });
const mois = (n: number): Duration => ({ n, unit: 'mois', unitOne: 'mois' });
const seq = (label: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${label} ${i + 1}`);
const blank = (n: number): string[] => Array.from({ length: n }, () => '');
const perDay = (days: number, lines: number): string[] => Array.from({ length: days * lines }, (_, i) => (i % lines === 0 ? `Jour ${i / lines + 1}` : ''));

const PROFILES: Record<string, GuideProfile> = {
  'sommeil-bebe': {
    pain: 'Bébé se réveille plusieurs fois par nuit',
    archetype: 'habitude',
    dur: nuits(14),
    loop: ['Il s’endort au sein ou dans les bras', 'Il remonte à la fin d’un cycle', 'Il réclame la même aide', 'La nuit se hache en morceaux'],
    sheet: { title: 'Votre journal de sommeil (5 nuits)', columns: ['Nuit', 'Coucher', 'Réveils (heures)', 'Ce qui a rendormi bébé', 'Plus longue plage'], rows: seq('Nuit', 5) },
    bonus: {
      title: 'Bonus : le carnet de 14 nuits à imprimer',
      lead: 'Ce carnet transforme vos impressions de 3 h du matin en repères que vous pourrez relire au calme.',
      paragraphs: [
        'Une ligne par nuit, deux minutes le matin. La colonne qui compte le plus est la plus longue plage de sommeil : c’est elle qui bouge en premier, bien avant le nombre de réveils.',
        'Si vous êtes deux, gardez un seul carnet, posé près du lit. Celui qui a géré la nuit le remplit, et l’autre le lit au réveil : vous vous évitez le débat du matin.',
      ],
      steps: ['Imprimer la grille et la poser près du lit', 'Remplir une ligne chaque matin, avant le café', 'Entourer la plus longue plage de sommeil de la semaine', 'Comparer les trois premières et les trois dernières nuits'],
      checklist: ['Carnet imprimé', 'Stylo posé à côté', 'Les deux parents savent comment le remplir'],
      sheet: { title: 'Votre carnet de 14 nuits', columns: ['Nuit', 'Coucher', 'Nombre de réveils', 'Plus longue plage', 'Ce qui a aidé'], rows: seq('Nuit', 14) },
    },
    topics: [{
      id: 'siestes', pain: 'Les siestes de 30 minutes qui cassent toute la journée', goal: 'Des siestes plus longues et une journée qui redevient prévisible',
      title: 'Les siestes de 30 minutes : le plan de 14 jours pour les bébés de 6 à 12 mois', dur: jours(14),
      quotes: /sieste/,
      bonus: {
        title: 'Bonus : la feuille de route des siestes à imprimer',
        lead: 'Une feuille par semaine, pour voir le rythme apparaître au lieu de le deviner.',
        paragraphs: ['Notez l’heure de lever, puis chaque sieste. Au bout de quelques jours, la fenêtre d’éveil de votre bébé se lit directement sur la feuille.'],
        steps: ['Noter l’heure de lever', 'Noter le début et la fin de chaque sieste', 'Calculer le temps d’éveil avant chaque sieste', 'Transmettre la feuille à la crèche si besoin'],
        checklist: ['Feuille imprimée', 'Horaires repères notés'],
        sheet: { title: 'Votre semaine de siestes', columns: ['Jour', 'Lever', 'Sieste 1', 'Sieste 2', 'Sieste 3', 'Total de jour'], rows: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] },
      },
    }],
  },
  'proprete-chiot': {
    pain: 'Le chiot fait ses besoins partout dans l’appartement',
    archetype: 'habitude',
    dur: jours(14),
    loop: ['Il sort, renifle et rentre', 'La vessie est encore pleine', 'L’accident arrive à la maison', 'L’odeur reste et l’attire au même endroit'],
    sheet: { title: 'Votre grille d’observation (3 jours)', columns: ['Jour et heure', 'Juste avant', 'Où', 'Ce que vous avez fait'], rows: perDay(3, 5) },
    bonus: {
      title: 'Bonus : le carnet de suivi de 14 jours à imprimer',
      lead: 'Ce carnet remplace l’impression que « rien ne bouge » par des chiffres que vous notez vous-même.',
      paragraphs: [
        'Comptez les pipis dehors et les accidents, rien de plus. Une simple ligne par jour suffit à voir apparaître les heures à risque, et donc à déplacer vos sorties au bon moment.',
        'Quand tout le monde s’occupe du chiot, gardez le carnet sur le frigo : chacun y note ce qu’il a vu, et plus personne ne se demande s’il est sorti.',
      ],
      steps: ['Imprimer le carnet et l’afficher sur le frigo', 'Noter chaque soir les sorties, les pipis dehors et les accidents', 'Le dimanche, entourer l’heure à laquelle les accidents reviennent', 'Avancer la sortie concernée de 30 minutes'],
      checklist: ['Carnet affiché', 'Toute la maison sait où noter', 'Bilan de la semaine prévu le dimanche'],
      sheet: { title: 'Votre carnet de 14 jours', columns: ['Jour', 'Sorties', 'Pipis dehors', 'Accidents', 'Heure à risque'], rows: seq('Jour', 14) },
    },
    topics: [{
      id: 'solitude', pain: 'Le chiot qui pleure et fait des dégâts dès qu’il reste seul', goal: 'Un chiot qui reste seul au calme pendant que vous travaillez',
      title: 'Chiot seul à la maison : le plan de 14 jours pour partir travailler sereinement', dur: jours(14),
      quotes: /reste seul|seule? a la maison|voisin|quand je pars|je pars/,
      bonus: {
        title: 'Bonus : le planning des absences à imprimer',
        lead: 'Un tableau simple pour allonger les absences sans brûler d’étape.',
        paragraphs: ['Notez la durée de chaque absence et l’état du chiot à votre retour. Si deux absences de suite se passent mal, redescendez d’un cran.'],
        steps: ['Noter la durée prévue', 'Noter ce que vous observez au retour', 'Allonger seulement après deux absences calmes', 'Redescendre d’un cran au moindre signe de stress'],
        checklist: ['Tableau imprimé', 'Caméra ou téléphone prêt pour filmer'],
        sheet: { title: 'Vos absences, jour après jour', columns: ['Jour', 'Durée prévue', 'Durée tenue', 'État au retour'], rows: seq('Jour', 14) },
      },
    }],
  },
  'chat-griffe-canape': {
    pain: 'Le chat griffe le canapé et les meubles',
    archetype: 'habitude',
    dur: jours(21),
    loop: ['Il se réveille ou s’excite', 'Il cherche une surface qui accroche', 'Le canapé est là, il griffe', 'Son odeur et ses marques l’y ramènent'],
    sheet: { title: 'Votre grille d’observation (3 jours)', columns: ['Jour et heure', 'Endroit griffé', 'Juste avant', 'Griffoir utilisé ?'], rows: perDay(3, 4) },
    bonus: {
      title: 'Bonus : le carnet de suivi de 21 jours à imprimer',
      lead: 'Trois semaines tiennent sur une page, et c’est cette page qui vous dira quand retirer les protections.',
      paragraphs: [
        'Notez chaque jour si le chat a utilisé le griffoir et s’il a touché au canapé. Un chat qui griffe une zone protégée vous dit que le griffoir voisin ne convient pas : c’est une information, pas un échec.',
        'Le carnet sert aussi à éviter les retours en arrière : la protection d’une zone ne se retire qu’après une semaine entière sans griffade à cet endroit.',
      ],
      steps: ['Imprimer le carnet et le poser près du griffoir principal', 'Cocher griffoir et canapé chaque soir', 'Noter la zone qui revient le plus', 'Retirer une protection après 7 jours propres sur cette zone'],
      checklist: ['Carnet imprimé', 'Zones numérotées', 'Date de retrait des protections notée'],
      sheet: { title: 'Votre carnet de 21 jours', columns: ['Jour', 'Griffoir utilisé', 'Griffades canapé', 'Session de jeu', 'Zone à surveiller'], rows: seq('Jour', 21) },
    },
    topics: [{
      id: 'nuits', pain: 'Le chat qui griffe la porte et réveille toute la maison à 3 h', goal: 'Des nuits sans griffes sur la porte ni réveils à l’aube',
      title: 'Chat qui griffe la nuit : le plan de 14 nuits pour dormir à nouveau', dur: nuits(14),
      quotes: /la nuit|3 ?h|griffe aussi les portes|nous reveille|a l'aube|5 ?h/,
      bonus: {
        title: 'Bonus : le journal des nuits à imprimer',
        lead: 'Un journal de deux semaines pour distinguer les nuits calmes des vraies habitudes.',
        paragraphs: ['Notez l’heure de chaque sollicitation et ce qui s’est passé dans la soirée. Après une semaine, le lien avec l’heure du jeu et du repas se lit tout seul.'],
        steps: ['Noter l’heure du jeu et du repas', 'Noter chaque réveil', 'Ne pas répondre, même une fois', 'Faire le bilan à la nuit 14'],
        checklist: ['Journal imprimé', 'Heure de jeu fixée'],
        sheet: { title: 'Votre journal de 14 nuits', columns: ['Nuit', 'Heure du jeu', 'Heure du repas', 'Réveils', 'Réponse donnée ?'], rows: seq('Nuit', 14) },
      },
    }],
  },
  'ventre-apres-40': {
    pain: 'Le ventre s’installe malgré les efforts',
    archetype: 'habitude',
    dur: semaines(8),
    loop: ['La journée se fait sans vraie pause', 'Le soir, la fatigue pousse à grignoter', 'Le sommeil se dégrade', 'Le lendemain, tout recommence'],
    sheet: { title: 'Votre semaine d’observation', columns: ['Jour', 'Repas et grignotages', 'Sommeil', 'Marche', 'Énergie du soir'], rows: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] },
    bonus: {
      title: 'Bonus : le carnet de 8 semaines à imprimer',
      lead: 'Une ligne par semaine, pour suivre ce qui compte sans vous peser tous les matins.',
      paragraphs: [
        'Le tour de taille se note une fois par semaine, le même jour et à la même heure. À côté, deux cases disent si vos habitudes ont tenu : c’est ce qu’il faut regarder si le chiffre ne bouge pas.',
        'Ce carnet n’est pas un examen. Une semaine moins bonne y a sa place, et elle vous aidera à comprendre ce qui se passe lors des périodes chargées.',
      ],
      steps: ['Imprimer le carnet et le ranger avec le mètre ruban', 'Choisir le jour de mesure', 'Noter chaque semaine le tour de taille et les habitudes tenues', 'Faire le point à la semaine 4 puis à la semaine 8'],
      checklist: ['Carnet imprimé', 'Mètre ruban rangé au même endroit', 'Jour de mesure choisi'],
      sheet: { title: 'Votre carnet de 8 semaines', columns: ['Semaine', 'Tour de taille', 'Jours de marche', 'Séances de renfort', 'Soirs sans grignotage'], rows: seq('Semaine', 8) },
    },
    topics: [{
      id: 'grignotage', pain: 'Le grignotage du soir devant la télé', goal: 'Des soirées sans grignotage automatique',
      title: 'Le grignotage du soir après 40 ans : le plan de 21 jours pour reprendre la main', dur: jours(21),
      quotes: /grignot|devant la tele/,
      bonus: {
        title: 'Bonus : le journal du soir à imprimer',
        lead: 'Une ligne par soir, pour voir ce qui déclenche vraiment l’envie.',
        paragraphs: ['Trois colonnes suffisent : l’heure, ce qui s’est passé, et ce que vous avez ressenti. Au bout d’une semaine, le déclencheur principal se voit à l’œil nu.'],
        steps: ['Noter l’heure de l’envie', 'Indiquer faim, fatigue, ennui ou émotion', 'Noter ce que vous avez fait', 'Choisir le déclencheur à travailler'],
        checklist: ['Journal imprimé', 'Rituel du soir choisi'],
        sheet: { title: 'Votre journal de 21 soirs', columns: ['Soir', 'Heure de l’envie', 'Faim, fatigue ou émotion', 'Ce que j’ai fait'], rows: seq('Soir', 21) },
      },
    }],
  },
  'relooker-meuble': {
    pain: 'Peur de rater la peinture d’un meuble ancien',
    archetype: 'projet',
    dur: jours(3),
    sheet: {
      title: 'Votre liste de matériel', columns: ['Matériel', 'Déjà là ?', 'Prix prévu', 'Acheté'],
      rows: ['Lessive St Marc ou savon noir', 'Papier de verre grain 120, 180 et 240', 'Pâte à bois', 'Sous-couche adaptée au support', 'Peinture', 'Pinceau à rechampir', 'Petit rouleau laqueur', 'Vernis mat ou cire', 'Bâche, gants et masque'],
    },
    bonus: {
      title: 'Bonus : la table de décision préparation, sous-couche et finition',
      lead: 'Avant d’acheter un pot, retrouvez votre meuble dans cette table : elle vous dit quoi faire, dans quel ordre.',
      paragraphs: [
        'Identifiez d’abord le support : un coton imbibé d’alcool ménager ramollit une cire, une lame révèle un vernis épais, une tache d’eau qui perle signale une finition encore étanche.',
        'Choisissez ensuite la ligne qui correspond, sans mélanger les colonnes. Si votre meuble relève de deux lignes, par exemple un plateau verni sur un corps ciré, traitez chaque partie séparément.',
      ],
      steps: ['Repérer la finition du meuble avec le test à l’alcool', 'Trouver la ligne correspondante dans la table', 'Noter la préparation et la sous-couche à acheter', 'Tester sur l’arrière du meuble avant de commencer'],
      checklist: ['Support identifié', 'Ligne de la table notée', 'Test réalisé sur une zone cachée'],
      sheet: {
        title: 'Quel traitement pour quel meuble ?', columns: ['Support', 'Préparation', 'Sous-couche', 'Finition'],
        rows: ['Bois brut', 'Bois verni', 'Bois ciré', 'Chêne ou merisier', 'Meuble déjà peint', 'Très ancien, peinture inconnue'],
        cells: [
          ['Dépoussiérer, égrener au grain 180', 'Sous-couche bois', 'Peinture puis vernis mat'],
          ['Dégraisser, égrener au grain 120', 'Primaire d’accroche', 'Peinture puis vernis mat'],
          ['Retirer la cire, dégraisser, égrener', 'Primaire d’accroche', 'Peinture puis cire ou vernis'],
          ['Dégraisser, égrener au grain 180', 'Sous-couche bloquante tanins', 'Deux couches fines'],
          ['Lessiver, égrener, reboucher', 'Primaire si écaillé', 'Peinture puis vernis mat'],
          ['Test plomb, ponçage à l’humide', 'Selon le test', 'Selon le test, avec protection respiratoire'],
        ],
      },
    },
    topics: [{
      id: 'reparer', pain: 'Le meuble bancal, écaillé ou abîmé avant même de pouvoir le peindre', goal: 'Un meuble solide, réparé, prêt à être peint',
      title: 'Réparer un meuble ancien avant de le peindre : le pas-à-pas en 3 soirs', dur: { n: 3, unit: 'soirs', unitOne: 'soir' },
      quotes: /tiroir|bancal|abimer|ecaill|branlant/,
      bonus: {
        title: 'Bonus : la fiche d’état des lieux à imprimer',
        lead: 'Une page pour lister les défauts du meuble et savoir par quoi commencer.',
        paragraphs: ['Reportez chaque défaut, puis classez-les : d’abord ce qui touche à la solidité, ensuite ce qui se voit. C’est dans cet ordre que vous réparez.'],
        steps: ['Lister chaque défaut', 'Séparer solidité et apparence', 'Noter le matériel nécessaire', 'Cocher au fur et à mesure'],
        checklist: ['Fiche imprimée', 'Défauts de solidité traités en premier'],
        sheet: { title: 'Votre état des lieux', columns: ['Zone', 'Défaut constaté', 'Réparation prévue', 'Matériel', 'Fait'], rows: ['Pieds', 'Assemblages', 'Plateau', 'Tiroirs', 'Portes et charnières', 'Placage'] },
      },
    }],
  },
  'potager-balcon': {
    pain: 'Les plantations ne donnent presque rien sur le balcon',
    archetype: 'projet',
    dur: mois(8),
    sheet: { title: 'Votre relevé d’ensoleillement', columns: ['Heure', 'Zone au soleil', 'Zone à l’ombre', 'Note'], rows: ['8 h', '10 h', '12 h', '14 h', '16 h', '18 h', '20 h'] },
    bonus: {
      title: 'Bonus : le calendrier du balcon, mois par mois',
      lead: 'Affichez ce calendrier près de la fenêtre : il vous dit quoi faire, sans chercher dans dix sites différents.',
      paragraphs: [
        'Ce calendrier suit le climat de la moitié nord de la France. Dans le Sud, avancez les semis de deux à trois semaines ; en altitude, retardez-les d’autant.',
        'La colonne de droite reste vide : notez-y ce que vous avez planté et la date. L’an prochain, ce sera votre meilleur repère, bien plus fiable qu’un calendrier général.',
      ],
      steps: ['Afficher le calendrier près de la porte du balcon', 'Lire le mois en cours le premier week-end', 'Noter vos dates de semis et de plantation', 'Ajuster l’an prochain selon vos notes'],
      checklist: ['Calendrier affiché', 'Région prise en compte', 'Dates notées à chaque plantation'],
      sheet: {
        title: 'Le calendrier du balcon', columns: ['Mois', 'À faire', 'Vos notes'],
        rows: ['Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre'],
        cells: [
          ['Mesurer le soleil, choisir ses plantes, semer à l’intérieur', null],
          ['Acheter pots et terreau, semer salades et aromatiques', null],
          ['Planter les plants sensibles à partir de la mi-mai', null],
          ['Tuteurer, pailler, pincer le basilic', null],
          ['Arroser au frais, ombrer aux heures chaudes', null],
          ['Récolter, préparer les absences', null],
          ['Dernières récoltes, semer les salades d’automne', null],
          ['Nettoyer les pots, garder le terreau sain', null],
        ],
      },
    },
    topics: [{
      id: 'nord', pain: 'Le balcon plein nord où rien ne semble pousser', goal: 'Un balcon à l’ombre qui donne des salades et des herbes toute la saison',
      title: 'Potager sur balcon nord : le plan de 8 mois pour récolter sans plein soleil', dur: mois(8),
      quotes: /\bnord\b|a l'ombre|sans soleil/,
      bonus: {
        title: 'Bonus : la carte de lumière de votre balcon',
        lead: 'Une grille simple pour repérer où chaque plante a sa chance.',
        paragraphs: ['Reportez les zones de votre balcon, et notez la lumière reçue le matin, à midi et le soir. La meilleure place n’est presque jamais celle que l’on croit.'],
        steps: ['Découper le balcon en quatre zones', 'Relever la lumière à trois moments', 'Attribuer une plante à chaque zone', 'Déplacer ce qui s’étiole'],
        checklist: ['Carte remplie', 'Plantes placées'],
        sheet: { title: 'La lumière de votre balcon', columns: ['Zone', 'Matin', 'Midi', 'Soir', 'Plante prévue'], rows: ['Rambarde', 'Mur du fond', 'Sol', 'En hauteur'] },
      },
    }],
  },
  'urssaf-micro': {
    pain: 'Peur de se tromper dans sa déclaration URSSAF',
    archetype: 'demarche',
    dur: jours(7),
    sheet: {
      title: 'Votre fiche d’identité micro-entreprise', columns: ['Information', 'Votre réponse', 'Où la trouver'],
      rows: ['Catégorie d’activité', 'Périodicité de déclaration', 'Taux de cotisation', 'ACRE en cours ?', 'Prochaine échéance'],
      cells: [[null, 'Avis de situation, espace URSSAF'], [null, 'Espace URSSAF, rubrique déclaration'], [null, 'Site officiel, selon l’activité'], [null, 'Espace URSSAF ou notification'], [null, 'Calendrier de votre espace']],
    },
    bonus: {
      title: 'Bonus : le tableau de suivi du chiffre d’affaires à imprimer',
      lead: 'Ce tableau est votre livre des recettes prêt à l’emploi : une ligne par encaissement, et votre déclaration est déjà faite.',
      paragraphs: [
        'Inscrivez chaque paiement le jour où il arrive sur votre compte, pas le jour où vous envoyez la facture. Au moment de déclarer, vous additionnez la colonne « Montant encaissé » pour la période, et c’est tout.',
        'La dernière colonne indique ce que vous avez mis de côté. Quand elle reste vide, vous savez que l’argent de vos cotisations est encore sur le mauvais compte.',
      ],
      steps: ['Imprimer le tableau ou le recopier dans un tableur', 'Ajouter une ligne à chaque encaissement', 'Séparer vente et prestation dans la colonne Nature', 'Additionner la période au moment de déclarer'],
      checklist: ['Tableau en place', 'Première ligne remplie', 'Compte de mise de côté ouvert'],
      sheet: { title: 'Votre suivi du chiffre d’affaires', columns: ['Date d’encaissement', 'Client', 'Nature (vente ou prestation)', 'Montant encaissé', 'Mode de paiement', 'Mis de côté'], rows: blank(14) },
    },
    topics: [{
      id: 'impots', pain: 'L’impôt, l’ACRE et la CFE qui tombent sans prévenir', goal: 'Une première année fiscale préparée, sans surprise sur l’ACRE, l’impôt et la CFE',
      title: 'Impôts, ACRE et CFE en micro-entreprise : le calendrier de votre première année', dur: mois(12),
      quotes: /\bacre\b|\bcfe\b|versement liberatoire|impot/,
      bonus: {
        title: 'Bonus : le calendrier fiscal de l’année à imprimer',
        lead: 'Une page pour voir d’un coup d’œil ce qui arrive dans l’année.',
        paragraphs: ['Ce sont les échéances habituelles. Si l’une d’elles tombe un week-end ou un jour férié, ou si l’administration la déplace, c’est la date affichée dans votre espace qui compte : reportez-la dans la colonne « Votre date ».'],
        steps: ['Reporter vos échéances', 'Ajouter vos montants prévus', 'Programmer un rappel pour chaque ligne', 'Relire le calendrier en décembre'],
        checklist: ['Calendrier rempli', 'Rappels programmés'],
        sheet: {
          title: 'Votre calendrier fiscal', columns: ['Période', 'Ce qui arrive', 'Votre date', 'Montant prévu'],
          rows: ['Chaque mois', 'Janvier', '31 janvier', '30 avril', 'Avril à juin', 'Juin', '31 juillet', '30 septembre', '31 octobre', 'Novembre', '15 décembre', '31 décembre'],
          cells: [
            ['Si vous êtes en mensuel : déclarer et payer avant la fin du mois suivant', null, null],
            ['Bilan du chiffre d’affaires, point sur l’ACRE', null, null],
            ['Si vous êtes en trimestriel : déclaration du 4e trimestre', null, null],
            ['Si vous êtes en trimestriel : déclaration du 1er trimestre', null, null],
            ['Déclaration de revenus, formulaire 2042-C-PRO : dates sur impots.gouv.fr', null, null],
            ['Commencer à provisionner la CFE', null, null],
            ['Si vous êtes en trimestriel : déclaration du 2e trimestre', null, null],
            ['Dernier jour pour demander le versement libératoire de l’année suivante', null, null],
            ['Si vous êtes en trimestriel : déclaration du 3e trimestre', null, null],
            ['Avis de CFE à consulter sur impots.gouv.fr', null, null],
            ['CFE à payer', null, null],
            ['Année de création : déclaration initiale de CFE, formulaire 1447-C-SD', null, null],
          ],
        },
      },
    }],
  },
  'toeic-800': {
    pain: 'Bloqué autour de 650-700 au TOEIC',
    archetype: 'examen',
    dur: jours(30),
    sheet: { title: 'Votre relevé de test blanc', columns: ['Partie', 'Bonnes réponses', 'Temps utilisé', 'Erreur principale'], rows: seq('Part', 7) },
    bonus: {
      title: 'Bonus : le tableau de suivi des tests blancs à imprimer',
      lead: 'Ce tableau montre ce qui rapporte vraiment des points, test après test.',
      paragraphs: [
        'Reportez après chaque test le score de chaque partie, puis l’erreur qui vous a coûté le plus de points. C’est cette erreur, et pas la partie que vous préférez, qui fixe votre travail de la semaine.',
        'Gardez le même jour et la même heure pour vos tests blancs. Une comparaison n’a de sens que si les conditions sont les mêmes.',
      ],
      steps: ['Imprimer le tableau', 'Noter les deux scores après chaque test', 'Écrire l’erreur principale en quelques mots', 'Choisir le chapitre de la semaine suivante'],
      checklist: ['Tableau imprimé', 'Date des tests blancs fixée', 'Carnet de pièges ouvert'],
      sheet: { title: 'Vos tests blancs', columns: ['Date', 'Listening', 'Reading', 'Total', 'Erreur principale', 'Travail de la semaine'], rows: seq('Test', 5) },
    },
    topics: [{
      id: 'listening', pain: 'Le Listening des parts 3 et 4 qui va beaucoup trop vite', goal: 'Suivre les parts 3 et 4 du Listening sans décrocher',
      title: 'TOEIC Listening : le plan de 14 jours pour ne plus décrocher aux parts 3 et 4', dur: jours(14),
      quotes: /listening|part 3|parlent trop vite|l'audio/,
      bonus: {
        title: 'Bonus : le carnet d’écoute à imprimer',
        lead: 'Une ligne par séance, pour voir ce que votre oreille rate vraiment.',
        paragraphs: ['Notez ce que vous avez entendu et ce qui a réellement été dit. Ces écarts reviennent : ils forment votre liste de sons et de tournures à travailler.'],
        steps: ['Choisir un extrait de 2 minutes', 'Écouter sans le texte', 'Noter l’écart avec le texte', 'Réécouter le lendemain'],
        checklist: ['Carnet imprimé', 'Source d’écoute choisie'],
        sheet: { title: 'Votre carnet d’écoute', columns: ['Jour', 'Extrait', 'Ce que j’ai entendu', 'Ce qui a été dit'], rows: seq('Jour', 14) },
      },
    }],
  },
  'oral-aide-soignante': {
    pain: 'Le stress de l’entretien d’entrée en IFAS',
    archetype: 'examen',
    dur: semaines(4),
    sheet: { title: 'Votre fil de parcours', columns: ['Date', 'Événement', 'Ce que j’en ai appris', 'Qualité utile au métier'], rows: blank(5) },
    bonus: {
      title: 'Bonus : la grille de simulation d’entretien à imprimer',
      lead: 'Donnez cette grille au proche qui joue le jury : il saura exactement quoi observer.',
      paragraphs: [
        'Un proche n’ose pas toujours vous critiquer. Avec une grille, il note des faits : vous avez regardé vos notes, vous avez donné un exemple, vous avez parlé du métier concret.',
        'Refaites la simulation au moins deux fois. Ne cherchez pas la perfection : cherchez la ligne qui s’améliore d’une fois à l’autre.',
      ],
      steps: ['Imprimer deux exemplaires de la grille', 'Donner la grille à la personne qui joue le jury', 'Simuler 20 minutes sans interruption', 'Relire ensemble la ligne la plus faible'],
      checklist: ['Grille imprimée', 'Date de simulation fixée', 'Questions tenues secrètes pour vous'],
      sheet: { title: 'Grille de simulation', columns: ['Critère', 'Simulation 1 (sur 5)', 'Simulation 2 (sur 5)', 'Point à travailler'], rows: ['Présentation claire en 2 minutes', 'Motivation sincère et concrète', 'Connaissance du métier', 'Exemples vécus', 'Mise en situation : écouter, rassurer, transmettre', 'Posture et voix'] },
    },
    topics: [{
      id: 'situations', pain: 'Les mises en situation qui font perdre ses moyens devant le jury', goal: 'Savoir répondre calmement à n’importe quelle mise en situation',
      title: 'Oral IFAS : les mises en situation expliquées, avec un plan d’entraînement de 14 jours', dur: jours(14),
      quotes: /mises? en situation|toilette/,
      bonus: {
        title: 'Bonus : les cartes de mises en situation à imprimer',
        lead: 'Dix cartes à découper pour vous entraîner au hasard, chronomètre en main.',
        paragraphs: ['Tirez une carte et répondez à voix haute. Reprenez les quatre temps : je me présente, j’observe, je rassure, je transmets.'],
        steps: ['Imprimer et découper les cartes', 'Tirer une carte au hasard', 'Répondre en deux minutes', 'Noter ce qui a manqué'],
        checklist: ['Cartes imprimées', 'Méthode en quatre temps apprise'],
        sheet: { title: 'Vos cartes d’entraînement', columns: ['Situation', 'Ce que j’observe', 'Ce que je fais', 'À qui je transmets'], rows: ['Refus de toilette', 'Chute d’un résident', 'Famille mécontente', 'Douleur exprimée', 'Refus de repas', 'Pudeur', 'Personne désorientée', 'Secret confié', 'Erreur d’un collègue', 'Fin de vie'] },
      },
    }],
  },
  'stress-bac': {
    pain: 'Le stress fait perdre ses moyens avant le bac',
    archetype: 'examen',
    dur: semaines(6),
    sheet: { title: 'Votre tableau des épreuves', columns: ['Épreuve', 'Date', 'Coefficient', 'Ce qui est solide', 'À retravailler'], rows: blank(7) },
    bonus: {
      title: 'Bonus : le planning de révisions de 6 semaines à imprimer',
      lead: 'Ce planning tient sur une page et laisse une vraie demi-journée libre chaque semaine.',
      paragraphs: [
        'Remplissez d’abord les blocs imposés, comme le lycée et le sport. Ajoutez ensuite vos révisions dans ce qui reste, et jamais l’inverse : un planning qui ignore votre vie ne dure pas deux semaines.',
        'Marquez d’une croix chaque bloc tenu. Si une semaine compte moins de la moitié de croix, le planning est trop chargé : allégez-le plutôt que de culpabiliser.',
      ],
      steps: ['Imprimer le planning', 'Bloquer les cours et le sport', 'Placer les blocs de révision', 'Cocher chaque bloc tenu'],
      checklist: ['Planning imprimé', 'Demi-journée libre bloquée', 'Planning montré à vos parents'],
      sheet: { title: 'Votre planning de 6 semaines', columns: ['Semaine', 'Matières prioritaires', 'Sujet en conditions réelles', 'Grand oral', 'Demi-journée libre'], rows: seq('Semaine', 6) },
    },
    topics: [{
      id: 'grand-oral', pain: 'Le grand oral qui terrorise et fait perdre ses moyens', goal: 'Prendre la parole 20 minutes devant le jury en sachant quoi dire',
      title: 'Grand oral du bac : le plan de 4 semaines pour parler sans réciter', dur: semaines(4),
      quotes: /grand oral|begaie|devant la classe|devant le jury/,
      bonus: {
        title: 'Bonus : la grille de répétition du grand oral à imprimer',
        lead: 'Faites remplir cette grille à la personne qui vous écoute.',
        paragraphs: ['Une note par critère, et une seule remarque à la fin. Une remarque précise fait progresser plus vite que dix compliments.'],
        steps: ['Imprimer la grille', 'Répéter devant une personne', 'Relire la remarque', 'Recommencer le lendemain'],
        checklist: ['Grille imprimée', 'Cinq répétitions prévues'],
        sheet: { title: 'Grille de répétition', columns: ['Critère', 'Répétition 1', 'Répétition 2', 'Répétition 3'], rows: ['Question claire', 'Plan en trois idées', 'Regard vers le jury', 'Voix et rythme', 'Réponses aux questions', 'Projet d’orientation'] },
      },
    }],
  },
  'mariage-moins-10k': {
    pain: 'Les devis explosent et le budget du mariage dérape',
    archetype: 'evenement',
    dur: mois(12),
    sheet: { title: 'Votre feuille de cadrage', columns: ['Question', 'Votre réponse'], rows: ['Priorité n°1', 'Priorité n°2', 'Priorité n°3', 'Budget total', 'Nombre d’invités', 'Ce que vous refusez'] },
    bonus: {
      title: 'Bonus : le tableau de budget poste par poste à imprimer',
      lead: 'Ce tableau vous donne une seule source de vérité : tout le monde lit les mêmes chiffres.',
      paragraphs: [
        'Remplissez la colonne « Prévu » avant de demander le moindre devis. Vous saurez ainsi tout de suite si une proposition rentre, au lieu de vous laisser guider par le premier prix annoncé.',
        'La ligne « Imprévus » reste à 10 % du total et n’est pas un poste comme les autres : ne la touchez pas avant le dernier mois.',
      ],
      steps: ['Reporter le budget total en haut du tableau', 'Répartir les montants prévus par poste', 'Noter chaque devis reçu', 'Suivre acomptes et soldes jusqu’au jour J'],
      checklist: ['Tableau rempli à deux', 'Marge de 10 % bloquée', 'Dates de solde notées'],
      sheet: { title: 'Votre budget poste par poste', columns: ['Poste', 'Prévu', 'Devis retenu', 'Acompte versé', 'Reste à payer'], rows: ['Lieu', 'Traiteur et boissons', 'Tenues', 'Photographe', 'Musique', 'Fleurs et décoration', 'Papeterie', 'Alliances', 'Transport et hébergement', 'Imprévus (10 %)'] },
    },
    topics: [{
      id: 'negociation', pain: 'Les devis trop chers et les prestataires qu’on n’ose pas négocier', goal: 'Faire baisser ses devis sans renoncer à ce qui compte',
      title: 'Négocier les devis de son mariage : la méthode en 4 semaines, poste par poste', dur: semaines(4),
      quotes: /devis|prestataire|frais caches|les prix x2|negoci/,
      bonus: {
        title: 'Bonus : le comparateur de devis à imprimer',
        lead: 'Un tableau pour comparer trois devis ligne par ligne.',
        paragraphs: ['Reportez chaque ligne de chaque devis dans la même grille. Ce qui manque dans une colonne devient immédiatement une question à poser.'],
        steps: ['Reporter les lignes du premier devis', 'Compléter avec les deux autres', 'Surligner ce qui manque', 'Poser vos questions par écrit'],
        checklist: ['Trois devis comparés', 'Questions envoyées'],
        sheet: { title: 'Votre comparateur de devis', columns: ['Ligne', 'Devis 1', 'Devis 2', 'Devis 3', 'Inclus partout ?'], rows: ['Prestation principale', 'Durée', 'Frais de déplacement', 'Service et personnel', 'Options', 'Acompte', 'Conditions d’annulation', 'Total'] },
      },
    }],
  },
  'japon-petit-budget': {
    pain: 'Le Japon semble hors de prix et compliqué à organiser',
    archetype: 'evenement',
    dur: mois(6),
    sheet: { title: 'Votre cadre de voyage', columns: ['Question', 'Votre réponse'], rows: ['Budget total hors vol', 'Jours sur place', 'Dates possibles', 'Bases envisagées', 'À voir absolument', 'Ce que vous acceptez de laisser'] },
    bonus: {
      title: 'Bonus : le tableau de budget du voyage à imprimer',
      lead: 'Ce tableau tient votre voyage sur une page : ce qui est prévu, ce qui est dépensé, ce qu’il reste.',
      paragraphs: [
        'Remplissez la colonne « Prévu » avant de réserver. Les prix évoluent vite, en yens comme en euros : notez la date à laquelle vous avez relevé chaque montant.',
        'Sur place, ne suivez que deux lignes au quotidien, repas et transports. Ce sont les seules qui bougent : le reste est déjà payé.',
      ],
      steps: ['Remplir les montants prévus', 'Noter la date de chaque prix relevé', 'Reporter les réservations payées', 'Mettre à jour repas et transports chaque soir sur place'],
      checklist: ['Tableau rempli', 'Réservations notées', 'Plafond quotidien fixé'],
      sheet: { title: 'Votre budget de voyage', columns: ['Poste', 'Prévu', 'Payé', 'Reste', 'Date du prix relevé'], rows: ['Vol', 'Logement', 'Transports longue distance', 'Transports urbains', 'Repas', 'Visites', 'Assurance et téléphone', 'Réserve'] },
    },
    topics: [{
      id: 'sur-place', pain: 'Le budget qui file une fois sur place, entre repas et transports', goal: 'Tenir son budget au quotidien, une fois sur place',
      title: 'Japon sur place : le plan de 14 jours pour manger et se déplacer sans se ruiner', dur: jours(14),
      quotes: /on mange|se ruiner|restaurant|\bcash\b|carte passe|konbini|sur place/,
      bonus: {
        title: 'Bonus : le carnet de dépenses du voyage à imprimer',
        lead: 'Une ligne par jour, cinq minutes le soir.',
        paragraphs: ['Notez repas, transports et visites. Un coup d’œil tous les trois jours suffit pour décider si la journée suivante doit être gratuite.'],
        steps: ['Fixer le plafond du jour', 'Noter les dépenses le soir', 'Faire le point tous les trois jours', 'Ajuster la journée suivante'],
        checklist: ['Carnet imprimé', 'Plafond fixé'],
        sheet: { title: 'Votre carnet de dépenses', columns: ['Jour', 'Repas', 'Transports', 'Visites', 'Total', 'Reste'], rows: seq('Jour', 14) },
      },
    }],
  },
  'batch-cooking-budget': {
    pain: 'Les courses explosent et on cuisine à la dernière minute',
    archetype: 'systeme',
    dur: semaines(4),
    sheet: { title: 'Votre inventaire de départ', columns: ['Zone', 'Ce qu’il reste', 'À utiliser en priorité'], rows: ['Réfrigérateur', 'Congélateur', 'Placards', 'Féculents', 'Légumineuses', 'Conserves'] },
    bonus: {
      title: 'Bonus : le planning de repas et la liste de courses à imprimer',
      lead: 'Une seule feuille, remplie le jeudi soir, et la semaine est réglée.',
      paragraphs: [
        'Le haut de la feuille décide des cinq repas ; la liste se remplit toute seule en reprenant les ingrédients qui manquent. Écrivez le budget maximum avant d’écrire la liste : c’est lui qui commande.',
        'Gardez les feuilles des semaines qui ont bien marché. Au bout d’un mois, vous aurez quatre semaines toutes prêtes à relancer les semaines où vous manquez d’idées.',
      ],
      steps: ['Remplir les cinq repas de la semaine', 'Reporter les ingrédients manquants, rayon par rayon', 'Écrire le budget maximum en haut de la liste', 'Garder la feuille si la semaine a bien marché'],
      checklist: ['Feuille imprimée', 'Cinq repas choisis', 'Budget maximum écrit'],
      sheet: { title: 'Votre semaine de repas', columns: ['Jour', 'Repas', 'Base utilisée', 'Frais ou congelé', 'À acheter'], rows: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'] },
    },
    topics: [{
      id: 'enfants', pain: 'Les enfants qui refusent la moitié des plats', goal: 'Des repas de la semaine que les enfants mangent vraiment',
      title: 'Enfants difficiles à table : le plan de 4 semaines pour nourrir toute la famille', dur: semaines(4),
      quotes: /enfants|gosses|pates au beurre|mange rien/,
      bonus: {
        title: 'Bonus : la feuille des aliments acceptés à imprimer',
        lead: 'Une feuille par enfant, à reprendre chaque mois.',
        paragraphs: ['Trois colonnes : toujours, parfois, pas encore. La colonne « pas encore » rappelle que rien n’est définitif.'],
        steps: ['Remplir une feuille par enfant', 'Bâtir chaque menu autour de la première colonne', 'Faire passer un aliment d’une colonne à l’autre', 'Refaire la feuille le mois suivant'],
        checklist: ['Une feuille par enfant', 'Menu de la semaine construit'],
        sheet: { title: 'Les aliments acceptés', columns: ['Enfant', 'Toujours', 'Parfois', 'Pas encore'], rows: blank(4) },
      },
    }],
  },
  'revendre-vinted': {
    pain: 'Les articles ne partent pas sur Vinted',
    archetype: 'systeme',
    dur: jours(30),
    sheet: { title: 'Votre tri de départ', columns: ['Article', 'Marque et taille', 'Vendre, donner ou garder', 'Prix visé'], rows: blank(12) },
    bonus: {
      title: 'Bonus : le tableau de suivi des annonces à imprimer',
      lead: 'Ce tableau vous dit quoi corriger : la photo, le prix, ou rien.',
      paragraphs: [
        'Une ligne par article, mise à jour une fois par semaine. Peu de vues au bout de sept jours, c’est la photo ou le titre ; beaucoup de vues sans vente, c’est le prix.',
        'La dernière colonne garde votre gain réel, frais d’emballage déduits. C’est le seul chiffre qui dit si l’opération vaut votre temps.',
      ],
      steps: ['Reporter chaque article publié', 'Noter vues et favoris après 7 jours', 'Décider : photo, prix, lot ou retrait', 'Noter le gain réel à la vente'],
      checklist: ['Tableau imprimé', 'Rendez-vous hebdomadaire fixé', 'Articles invendus repérés'],
      sheet: { title: 'Votre suivi des annonces', columns: ['Article', 'Publié le', 'Prix', 'Vues à 7 jours', 'Favoris', 'Vendu le', 'Gain réel'], rows: blank(14) },
    },
    topics: [{
      id: 'litiges', pain: 'Les litiges et les acheteurs de mauvaise foi', goal: 'Vendre sans craindre les litiges ni les acheteurs difficiles',
      title: 'Litiges Vinted : la méthode en 14 jours pour vendre sans vous faire avoir', dur: jours(14),
      quotes: /litige|abime|mauvaise foi|reclamation/,
      bonus: {
        title: 'Bonus : les réponses prêtes à copier en cas de litige',
        lead: 'Des réponses courtes pour ne jamais écrire sous le coup de la colère.',
        paragraphs: ['Adaptez le détail, gardez le ton. Une réponse factuelle vaut mieux qu’une longue justification, et elle se relit très bien en cas de médiation.'],
        steps: ['Identifier le type de litige', 'Choisir la réponse correspondante', 'Ajouter vos preuves', 'Envoyer sans rien ajouter'],
        checklist: ['Réponses enregistrées', 'Dossier de photos prêt'],
        sheet: { title: 'Vos réponses types', columns: ['Situation', 'Réponse à adapter'], rows: ['Article jugé abîmé', 'Colis non reçu', 'Article non conforme', 'Demande de paiement hors plateforme'], cells: [['Votre annonce indiquait l’état de l’article, photos à l’appui. Pouvez-vous envoyer une photo du défaut constaté ?'], ['Le suivi indique cette étape. Ouvrons une demande depuis la commande pour le transporteur.'], ['Pouvez-vous préciser ce qui diffère de l’annonce, avec une photo ?'], ['Je garde tous les paiements sur la plateforme, pour notre protection à tous les deux.']] },
      },
    }],
  },
  'freelance-linkedin': {
    pain: 'Aucun client malgré un profil LinkedIn',
    archetype: 'systeme',
    dur: jours(60),
    sheet: { title: 'Votre fiche de cible', columns: ['Question', 'Votre réponse'], rows: ['Secteur visé', 'Type d’entreprise', 'Problème que vous résolvez', 'Décideur à contacter', 'Preuve à montrer'] },
    bonus: {
      title: 'Bonus : le tableau de suivi de prospection à imprimer',
      lead: 'Ce tableau remplace les relances oubliées et les messages envoyés deux fois.',
      paragraphs: [
        'Une ligne par prospect, de la première observation à la réponse. La colonne « Élément cité » vous oblige à trouver quelque chose de précis avant d’écrire : c’est elle qui fait la différence avec un copier-coller.',
        'Le vendredi, regardez deux chiffres seulement : conversations ouvertes et relances à faire. Le nombre de messages envoyés ne vous dit rien.',
      ],
      steps: ['Lister les prospects de la semaine', 'Noter l’élément précis à citer', 'Dater le message et la relance', 'Faire le bilan chaque vendredi'],
      checklist: ['Tableau en place', 'Cinq prospects notés', 'Bilan du vendredi bloqué'],
      sheet: { title: 'Votre suivi de prospection', columns: ['Prospect', 'Entreprise', 'Élément cité', 'Message envoyé le', 'Relance le', 'Réponse'], rows: blank(12) },
    },
    topics: [{
      id: 'tarif', pain: 'Le TJM qu’on n’ose pas fixer ni défendre face au client', goal: 'Un tarif clair, calculé, et que vous savez défendre',
      title: 'Fixer son TJM de freelance : la méthode en 7 jours pour oser son prix', dur: jours(7),
      quotes: /\btjm\b|tarif|mon prix|trop cher/,
      bonus: {
        title: 'Bonus : la feuille de calcul du TJM à imprimer',
        lead: 'Un calcul en cinq lignes pour obtenir votre prix plancher.',
        paragraphs: ['Remplissez chaque ligne avec vos chiffres réels. Le résultat n’est pas une opinion : c’est le prix en dessous duquel votre activité ne tient pas.'],
        steps: ['Noter votre revenu mensuel visé', 'Ajouter charges et frais', 'Estimer vos jours facturables', 'Diviser pour obtenir le TJM plancher'],
        checklist: ['Calcul rempli', 'TJM plancher noté'],
        sheet: { title: 'Votre calcul de TJM', columns: ['Ligne', 'Votre chiffre'], rows: ['Revenu net visé sur l’année', 'Cotisations et impôts estimés', 'Frais professionnels', 'Total à facturer', 'Jours réellement facturables', 'TJM plancher (total divisé par jours)'] },
      },
    }],
  },
  'dme-diversification': {
    pain: 'La peur que bébé s’étouffe avec un morceau',
    archetype: 'paliers',
    dur: semaines(8),
    sheet: { title: 'Vos feux verts', columns: ['Signe à vérifier', 'Oui', 'Pas encore', 'Date'], rows: ['Tient assis avec peu de soutien', 'Attrape un objet et le porte à la bouche', 'S’intéresse à ce que vous mangez', 'Avis du professionnel qui le suit', 'Gestes de premiers secours appris'] },
    bonus: {
      title: 'Bonus : le carnet des aliments testés à imprimer',
      lead: 'Ce carnet garde la mémoire de tout ce que bébé a goûté, et de ce qu’il en a pensé.',
      paragraphs: [
        'Notez l’aliment, la forme proposée et la réaction. Un refus n’est pas un verdict : la colonne « Réessayer le » rappelle que beaucoup d’aliments demandent de nombreuses présentations.',
        'Ce carnet est aussi votre meilleur allié chez le professionnel de santé : en cas de réaction, vous avez déjà l’aliment, la quantité et l’heure.',
      ],
      steps: ['Imprimer le carnet et le poser près de la chaise haute', 'Noter chaque nouvel aliment', 'Indiquer la forme et la réaction', 'Prévoir la date du prochain essai'],
      checklist: ['Carnet imprimé', 'Stylo près de la chaise haute', 'Allergènes repérés dans la liste'],
      sheet: { title: 'Votre carnet d’aliments', columns: ['Date et heure', 'Aliment', 'Forme proposée', 'Réaction', 'Réessayer le'], rows: blank(14) },
    },
    topics: [{
      id: 'allergenes', pain: 'La peur d’introduire les allergènes', goal: 'Introduire les allergènes un par un, en sachant quoi surveiller',
      title: 'Allergènes et diversification : le plan de 6 semaines pour les introduire sereinement', dur: semaines(6),
      quotes: /allergen|l'oeuf|arachide/,
      bonus: {
        title: 'Bonus : le tableau d’introduction des allergènes à imprimer',
        lead: 'Une page pour savoir ce qui a été proposé, quand, et comment ça s’est passé.',
        paragraphs: ['Remplissez une ligne à chaque essai et conservez le tableau. Il sera utile au professionnel qui suit votre enfant si une question se pose.'],
        steps: ['Choisir l’allergène du jour', 'Noter la date et l’heure', 'Noter la quantité', 'Noter la réaction éventuelle'],
        checklist: ['Tableau imprimé', 'Numéros d’urgence notés'],
        sheet: { title: 'Vos essais d’allergènes', columns: ['Allergène', 'Date et heure', 'Quantité', 'Réaction', 'Reproposé le'], rows: ['Œuf', 'Arachide', 'Fruits à coque', 'Lait', 'Poisson', 'Gluten', 'Sésame'] },
      },
    }],
  },
};

/** Keyword rules for a niche without profile (a research topic the catalog does not know). */
const RULES: readonly [RegExp, GuideArchetype][] = [
  [/diversification|\bdme\b|sevrage|reeducation/, 'paliers'],
  [/chiot|\bchien|\bchat\b|griff|sommeil|\bbebe|\bventre/, 'habitude'],
  [/\b(bac|concours|examen|toeic|toefl|ielts|permis|oral|jury|partiel|ifas|ifsi)\b/, 'examen'],
  [/urssaf|declaration|impot|demarche|administratif|dossier|retraite|caf\b/, 'demarche'],
  [/mariage|voyage|anniversaire|bapteme|evenement|demenagement|road trip|sejour/, 'evenement'],
  [/relook|renov|bricol|\bdiy\b|meuble|peintur|potager|jardin|construire|fabriquer|amenager/, 'projet'],
  [/vinted|revente|freelance|prospection|batch cooking|meal prep|menus|clients/, 'systeme'],
];

export function classifyArchetype(n: Partial<NicheBrief>): GuideArchetype {
  const key = norm([n.nicheId, n.name, n.category, ...(n.keywords ?? [])].filter(Boolean).join(' '));
  return RULES.find(([re]) => re.test(key))?.[1] ?? 'habitude';
}

export function knownProfile(nicheId: string | null | undefined): GuideProfile | null {
  return nicheId ? PROFILES[nicheId] ?? null : null;
}

/** Rank of a niche among those of its archetype: two guides of the same kind never get the same framing variant. */
export function archetypeSlot(nicheId: string | null | undefined): number {
  const p = knownProfile(nicheId);
  if (!p) return 0;
  return Object.keys(PROFILES).filter((id) => PROFILES[id]!.archetype === p.archetype).indexOf(nicheId!);
}

/** Research (when it names one), then the profile, then the keywords of the brief. */
export function archetypeOf(n: Partial<NicheBrief>, voc?: VoiceOfCustomer | null): GuideArchetype {
  return voc?.knowledge?.archetype ?? knownProfile(n.nicheId)?.archetype ?? classifyArchetype(n);
}

/** Follow-up sub-problems prepared for a niche: what the stage creating an upsell product can read, without the market truth. */
export function upsellTopics(nicheId: string | null | undefined): { id: string; pain: string; goal: string; title: string }[] {
  return (knownProfile(nicheId)?.topics ?? []).map(({ id, pain, goal, title }) => ({ id, pain, goal, title }));
}

/** Every niche id with a profile. */
export const PROFILED_NICHES: readonly string[] = Object.keys(PROFILES);
