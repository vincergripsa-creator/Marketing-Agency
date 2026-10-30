/**
 * Showcase fixture used by demo.ts: a complete, realistic product (guide + sales page + ad)
 * for the "bébé qui se réveille toutes les 2 h" niche.
 */
import type { AdCreative, PdfContent, Product, SalesPage } from '../shared.js';
import { designFor } from './design.js';

export const DEMO_BRAND = 'Pixel Agency';

export const demoContent: PdfContent = {
  title: 'Bébé se réveille toutes les 2 heures : la méthode douce pour retrouver des nuits de 6 h',
  subtitle: 'Le plan en 14 nuits pour les parents de bébés de 6 à 12 mois — sans le laisser pleurer seul',
  audience: 'Parents épuisés d’un bébé de 6 à 12 mois qui se réveille toutes les 2 heures',
  promise: 'En 14 nuits, votre bébé apprend à enchaîner ses cycles de sommeil tout seul : vous visez des plages de 5 à 6 heures sans réveil, avec un plan clair pour chaque soir et chaque réveil.',
  introduction: [
    'Il est 3 h 12. C’est le quatrième réveil depuis le coucher. Vous connaissez la suite : le sein ou le biberon, les bras, le balancement dans le couloir, la dépose au ralenti dans le lit… et le petit cri au moment où votre main quitte son dos. À 5 h, rebelote.',
    'Si vous lisez ces lignes, vous avez sûrement déjà tout entendu : « ça passera », « il fait ses dents », « laisse-le pleurer, c’est ce qu’on faisait avant ». Rien de tout ça ne vous dit quoi faire ce soir, concrètement, à 20 h et à 2 h du matin.',
    'Ce guide part d’un constat simple, qui revient dans des centaines de témoignages de parents : entre 6 et 12 mois, la plupart des réveils toutes les 2 heures ne viennent ni de la faim ni d’un « mauvais dormeur ». Ils viennent de la façon dont bébé s’endort le soir. Ce qui l’a endormi à 20 h, il le réclame à chaque fin de cycle.',
    'La bonne nouvelle : cela s’apprend, en douceur, en restant présent. Vous allez caler la journée, installer un rituel court, puis décrocher progressivement l’aide à l’endormissement — une étape à la fois, avec un plan pour chaque réveil.',
  ],
  chapters: [
    {
      title: 'Pourquoi il se réveille toutes les 2 heures (et ce n’est pas la faim)',
      intro: 'Avant de changer quoi que ce soit, il faut comprendre ce qui se passe vraiment à 23 h, 1 h et 3 h. Les réveils ont presque toujours une logique.',
      paragraphs: [
        'Le sommeil de bébé fonctionne par cycles d’environ 45 minutes à 1 h 30. Entre deux cycles, il remonte presque à la surface : il bouge, ouvre parfois les yeux, vérifie que tout est comme au moment où il s’est endormi. C’est normal, et adulte, vous le faites aussi sans vous en souvenir.',
        'Le problème apparaît quand les conditions de l’endormissement ont disparu. S’il s’est endormi au sein, dans vos bras ou en étant bercé, il se « réveille » dans un lit immobile, sans le goût du lait ni votre chaleur. Il appelle pour retrouver ce qui l’a aidé à s’endormir. Toutes les 2 heures, ou presque.',
        'La faim réelle existe encore chez certains bébés de 6 à 9 mois, mais elle ressemble rarement à quatre tétées de cinq minutes. Un repère utile : un bébé qui a faim boit franchement et longtemps ; un bébé qui cherche à se rendormir tète deux minutes et repart au pays des rêves.',
        'Deux autres coupables reviennent souvent : une journée mal rythmée (siestes trop courtes ou trop tardives) et un coucher trop tardif, qui fatigue bébé au point de fragmenter sa nuit. On les règle au chapitre 2.',
      ],
      steps: [
        'Pendant 3 nuits, notez chaque réveil : l’heure, ce que vous avez fait, le temps qu’il a mis à se rendormir.',
        'Entourez les réveils où il s’est rendormi en moins de 5 minutes au sein ou au biberon : ce sont des réveils d’« association », pas de faim.',
        'Notez à quelle heure et comment il s’est endormi le soir (bras, sein, poussette, seul).',
        'Vérifiez avec votre pédiatre qu’aucune cause médicale (reflux, otite, apnée) n’explique les réveils avant de commencer le plan.',
      ],
      example: 'Camille, maman de Léo (8 mois) : « Je pensais qu’il avait faim, il réclamait 5 fois par nuit. Mon carnet m’a montré qu’il buvait à peine 30 ml à chaque fois. Ce n’était pas la faim : c’était son seul moyen de se rendormir. »',
      checklist: [
        'J’ai tenu mon carnet de réveils pendant 3 nuits',
        'Je sais comment mon bébé s’endort le soir',
        'J’ai repéré les réveils « express » (moins de 5 minutes)',
        'Le pédiatre a écarté une cause médicale',
      ],
      visual: {
        type: 'bar_chart',
        title: 'Ce que révèlent 100 témoignages de parents (recherche de l’agence)',
        labels: ['S’endort au sein ou au biberon', 'Siestes trop courtes', 'Coucher après 20 h 30', 'Poussées dentaires', 'Faim réelle la nuit'],
        values: [72, 54, 41, 26, 18],
      },
    },
    {
      title: 'Le bon rythme de journée : siestes et fenêtres d’éveil',
      intro: 'Une bonne nuit se prépare dès le réveil du matin. Un bébé trop fatigué ne dort pas mieux : il dort plus mal.',
      paragraphs: [
        'Entre 6 et 12 mois, un bébé tient en général 2 h à 3 h 30 d’éveil d’affilée. Au-delà, son corps produit du cortisol pour tenir le coup, et ce « second souffle » se paie la nuit : endormissement difficile, réveils en pleurs, réveil à 5 h du matin.',
        'L’objectif n’est pas un horaire militaire mais un rythme prévisible : réveil du matin à heure à peu près fixe, deux siestes (une seule vers 11-12 mois pour certains), et un coucher tôt, entre 19 h et 20 h.',
        'Le réveil du matin est votre ancre. Même après une mauvaise nuit, levez-le à heure fixe, à 30 minutes près : c’est lui qui règle tout le reste de la journée.',
      ],
      steps: [
        'Fixez l’heure du réveil du matin (par exemple 7 h) et tenez-la 7 jours d’affilée.',
        'Proposez la première sieste 2 h 30 à 3 h après le réveil, la seconde 3 h après la fin de la première.',
        'Si une sieste dure moins de 40 minutes, avancez légèrement la suivante.',
        'Visez un coucher 3 h à 3 h 30 après la fin de la dernière sieste, idéalement avant 20 h.',
        'Faites la dernière sieste au calme, la première peut se faire en poussette sans souci.',
      ],
      example: 'Sarah, maman de Jade (10 mois) : « Jade faisait une sieste à 16 h 30 et se couchait à 21 h. On a avancé la sieste et couché Jade à 19 h 30. Trois jours plus tard, plus de réveil hurlant à 23 h. »',
      checklist: [
        'L’heure du réveil du matin est fixe (à 30 minutes près)',
        'Je connais la fenêtre d’éveil qui convient à mon bébé',
        'La dernière sieste se termine avant 16 h 30',
        'Le coucher a lieu entre 19 h et 20 h',
      ],
      visual: {
        type: 'timeline',
        title: 'Une journée type pour un bébé de 8 mois',
        labels: ['7 h — réveil et lumière du jour', '9 h 45 — sieste 1 (1 h à 1 h 30)', '14 h — sieste 2 (1 h 30)', '18 h 50 — rituel du coucher', '19 h 15 — au lit, éveillé'],
        values: [],
      },
    },
    {
      title: 'Le rituel du coucher en 20 minutes',
      intro: 'Un rituel court et identique chaque soir dit au cerveau de bébé : « maintenant, on dort ». C’est le signal le plus puissant que vous ayez.',
      paragraphs: [
        'Le rituel ne doit pas durer une heure. Vingt minutes suffisent, toujours dans le même ordre, dans une lumière douce. La répétition compte plus que le contenu.',
        'Point clé : sortez la tétée ou le biberon de la fin du rituel. Proposez-le au début, lumière allumée, puis enchaînez pyjama, histoire, chanson. Bébé arrive au lit repu, détendu, mais pas endormi.',
        'La chambre compte aussi : noire (un store occultant change tout l’été), entre 18 et 20 °C, et un bruit blanc doux si la maison est bruyante. Une gigoteuse adaptée à la saison évite les réveils de froid.',
      ],
      steps: [
        'Biberon ou tétée dans le salon ou la chambre, lumière allumée.',
        'Change, pyjama et petit massage des jambes ou du dos.',
        'Une histoire courte, toujours au même endroit.',
        'Une chanson ou une phrase rituelle, la même chaque soir (« Bonne nuit, à demain matin »).',
        'Dépose au lit éveillé mais somnolent, puis restez près de lui selon le palier du chapitre 4.',
      ],
      example: 'Thomas, papa d’Inès (7 mois) : « On a juste déplacé le biberon avant le bain. La première semaine, elle râlait un peu au lit. Ensuite, elle s’est mise à s’endormir en tenant son doudou. On n’en revenait pas. »',
      checklist: [
        'Le rituel dure 20 minutes maximum',
        'Le lait est donné au début du rituel, pas à la fin',
        'La chambre est noire et à 18-20 °C',
        'Bébé est déposé éveillé dans son lit',
      ],
      visual: {
        type: 'steps_diagram',
        title: 'Le rituel en 5 temps',
        labels: ['Lait, lumière allumée', 'Pyjama et massage', 'Histoire courte', 'Phrase rituelle', 'Au lit éveillé'],
        values: [],
      },
    },
    {
      title: 'Le décrochage en douceur : se rendormir sans vous',
      intro: 'C’est le cœur de la méthode : réduire votre aide petit à petit, en restant présent, jusqu’à ce que bébé sache s’endormir seul.',
      paragraphs: [
        'On ne retire pas tout d’un coup. On avance par paliers de 3 nuits : d’abord vous l’endormez dans le lit en le touchant, puis vous posez seulement la main, puis vous restez assis à côté, puis près de la porte.',
        'Les pleurs ne sont pas interdits, l’abandon l’est. Bébé a le droit de protester contre le changement ; vous restez là, vous le rassurez par la voix et le toucher, et vous ne le reprenez dans les bras que s’il est vraiment paniqué.',
        'La cohérence fait tout : les deux parents appliquent le même palier, la même phrase, la même réponse. Un soir de sein « pour cette fois » repart pour trois nuits de réclamations.',
      ],
      steps: [
        'Nuits 1 à 3 : bébé s’endort dans son lit, votre main sur son ventre, vous chuchotez la phrase rituelle.',
        'Nuits 4 à 6 : votre main reste posée sans bouger, puis vous la retirez avant qu’il dorme.',
        'Nuits 7 à 9 : vous êtes assis près du lit, vous rassurez à la voix.',
        'Nuits 10 à 14 : la chaise recule vers la porte, vous sortez dès qu’il est calme.',
      ],
      example: 'Nadia, maman de Sami (11 mois) : « Le palier de la main a été le plus dur, il pleurait 15 minutes. À la nuit 6, il se retournait tout seul dès que je posais la main. On a dormi 5 h d’affilée pour la première fois depuis sa naissance. »',
      checklist: [
        'Nous avons choisi ensemble la date de début (pas la veille d’une reprise)',
        'Les deux parents connaissent le palier en cours',
        'Je reste présent et je rassure sans reprendre dans les bras',
        'Je passe au palier suivant toutes les 3 nuits',
      ],
      visual: {
        type: 'do_dont',
        title: 'Les bons réflexes du décrochage',
        labels: [
          'À faire : la même phrase rituelle à chaque réveil',
          'À faire : attendre 2 minutes avant d’intervenir',
          'À faire : rassurer par la voix et la main',
          'À éviter : allumer la lumière ou le téléphone',
          'À éviter : changer de méthode au bout de 2 nuits',
          'Ne pas : remettre au sein « juste cette fois »',
        ],
        values: [],
      },
    },
    {
      title: 'Gérer les réveils de nuit, nuit après nuit',
      intro: 'Le soir se passe mieux ? Parfait. Maintenant, on applique exactement la même logique aux réveils de la nuit.',
      paragraphs: [
        'À chaque réveil, attendez deux minutes. Beaucoup de bébés grognent, se retournent et repartent seuls — si vous arrivez trop vite, vous interrompez ce qu’ils étaient en train d’apprendre.',
        'Si les pleurs montent, entrez, sans lumière, et appliquez le palier du soir : même phrase, même geste, même ton. Vous êtes ennuyeux, prévisible, rassurant. La nuit n’est pas un moment de jeu.',
        'Si vous gardez une tétée de nuit (fréquent jusqu’à 9 mois), choisissez-la à l’avance, par exemple le premier réveil après 1 h du matin, et donnez-la pleinement réveillé, puis recouchez selon le palier.',
      ],
      steps: [
        'Attendez 2 minutes montre en main avant d’entrer.',
        'Entrez sans allumer, dites la phrase rituelle, posez la main.',
        'Si une tétée de nuit est prévue, donnez-la au réveil choisi uniquement.',
        'Notez le réveil dans votre carnet : vous verrez les progrès nuit après nuit.',
      ],
      example: 'Julie et Marc, parents de Rose (9 mois) : « On s’était fixé une seule tétée après 2 h. Les deux premières nuits, Rose a protesté vers minuit. La quatrième nuit, elle a dormi de 19 h 30 à 2 h, a bu, et s’est rendormie jusqu’à 6 h 40. »',
      checklist: [
        'J’attends 2 minutes avant d’intervenir',
        'Je n’allume pas la lumière la nuit',
        'La tétée de nuit est planifiée à l’avance (ou supprimée)',
        'Je note chaque réveil pour suivre les progrès',
      ],
      visual: {
        type: 'checklist_card',
        title: 'À coller sur la porte de la chambre',
        labels: ['J’attends 2 minutes', 'Pas de lumière, pas d’écran', 'Phrase rituelle et main posée', 'Je reste jusqu’au calme', 'Je note l’heure du réveil', 'Le matin : lever à heure fixe'],
        values: [],
      },
    },
    {
      title: 'Tenir sur la durée : dents, rhumes, voyages et rechutes',
      intro: 'Une rechute n’efface pas le travail accompli. Avec un plan, vous retrouvez les nuits en 2 ou 3 jours au lieu de tout recommencer.',
      paragraphs: [
        'Les poussées dentaires, les rhumes, la reprise de la crèche ou un voyage vont bousculer les nuits. C’est inévitable. Pendant ces périodes, vous pouvez aider davantage : soulager, câliner, rester plus longtemps.',
        'Le secret, c’est de revenir au palier précédent dès que l’épisode est passé — pas trois semaines plus tard. Bébé retrouve ses repères très vite parce que le rituel, lui, n’a pas changé.',
        'Vers 8-10 mois, beaucoup de bébés traversent une phase où ils s’entraînent à se lever ou à ramper dans le lit. Entraînez ces nouvelles acrobaties en journée : moins de nouveauté à tester la nuit.',
      ],
      steps: [
        'Pendant la maladie ou la poussée dentaire, soulagez sans culpabiliser.',
        'Dès le retour à la normale, reprenez au palier où vous étiez arrivé moins un.',
        'En voyage, emportez le doudou, la gigoteuse et le bruit blanc : la chambre change, pas le rituel.',
        'Au changement d’heure, décalez coucher et siestes de 15 minutes par jour.',
      ],
      example: 'Élodie, maman de Nathan (12 mois) : « Une otite et tout est reparti en vrille. J’ai repris le palier de la chaise le lendemain de la fin des antibiotiques : trois nuits plus tard, il redormait ses 10 heures. »',
      checklist: [
        'Je sais à quel palier revenir après une rechute',
        'Le kit voyage est prêt (doudou, gigoteuse, bruit blanc)',
        'Je n’abandonne pas le rituel pendant les vacances',
      ],
      visual: {
        type: 'icon_grid',
        title: 'Les 6 situations qui perturbent les nuits (et la parade)',
        labels: ['Poussée dentaire : soulager puis reprendre', 'Rhume : surélever et rassurer', 'Voyage : même rituel, même doudou', 'Changement d’heure : 15 min par jour', 'Reprise de la crèche : coucher plus tôt', 'Nouvelle acrobatie : s’entraîner le jour'],
        values: [],
      },
    },
  ],
  bonus: {
    title: 'Le kit de survie du parent épuisé',
    intro: 'Pendant ces 14 nuits, vous allez aussi devoir prendre soin de vous. Voici ce qui aide vraiment quand on dort par tranches de 2 heures.',
    paragraphs: [
      'Organisez des tours de garde : un parent gère les réveils avant 2 h, l’autre après. Chacun a ainsi au moins une plage de 4 à 5 heures de sommeil d’affilée, et le plan reste appliqué par une personne reposée.',
      'Couchez-vous tôt les trois premiers soirs, même si c’est frustrant. Les premières nuits sont souvent les plus agitées : mieux vaut les aborder avec une heure de sommeil en plus.',
      'Préparez le « plateau de nuit » : verre d’eau, lampe rouge tamisée, carnet et stylo, chaussettes. Moins vous réfléchissez à 3 h du matin, plus vous restez cohérent.',
    ],
    steps: [
      'Décidez qui gère les réveils avant et après 2 h.',
      'Préparez le plateau de nuit dès ce soir.',
      'Prévenez votre entourage : pas de visite surprise pendant 2 semaines.',
    ],
    example: 'Lucie, maman de Gabriel (7 mois) : « Le simple fait de savoir que mon conjoint prenait les réveils avant 2 h m’a permis de tenir. Je dormais 4 heures d’affilée, ça a tout changé pour garder mon calme. »',
    checklist: ['Le planning des tours de garde est affiché', 'Le plateau de nuit est prêt', 'Je me couche tôt les 3 premiers soirs'],
    visual: {
      type: 'quote',
      title: 'À relire à 3 h du matin',
      labels: ['Vous n’êtes pas en train de rater quelque chose : vous êtes en train de lui apprendre à dormir, une nuit à la fois.', 'Note de l’équipe Studio', 'Nuit 1 sur 14', 'Vous tenez le bon bout'],
      values: [],
    },
  },
  nextStep: {
    title: 'Et quand il dort enfin ses nuits ? On s’attaque aux siestes.',
    text: 'Votre bébé enchaîne ses cycles la nuit ? Bravo, le plus dur est fait. Prochaine étape : des siestes de plus d’une heure, même à la crèche ou chez la nounou.\nDans « Siestes courtes : le plan pour des siestes d’1 h 30 », vous trouverez les horaires par âge, la méthode pour prolonger une sieste de 30 minutes et les phrases à transmettre à la crèche.',
    upsellProductId: 'prd_demo_siestes',
  },
  wordCount: 3150,
};

export const demoProduct: Product = {
  id: 'prd_demo',
  nicheId: 'niche_sommeil_bebe',
  title: demoContent.title,
  subtitle: demoContent.subtitle,
  audience: demoContent.audience,
  problem: 'Votre bébé de 6 à 12 mois se réveille toutes les 2 heures et ne se rendort qu’au sein, au biberon ou dans vos bras.',
  price: 19,
  status: 'live',
  version: 1,
  content: demoContent,
  design: designFor({ nicheName: 'Sommeil de bébé 6-12 mois', category: 'parentalité', seed: 42, hint: 'nuit étoilée apaisante' }),
  salesPage: null,
  files: { pdf: null, cover: null, salesPage: null },
  quality: null,
  salesQuality: null,
  upsellProductId: 'prd_demo_siestes',
  createdDay: 3,
  launchedDay: 6,
  stats: {
    views: 1840, sales: 61, revenue: 1159, refunds: 3, refundAmount: 57, rating: 4.6, upsellSales: 9,
    reviews: [
      { id: 'rev_1', day: 9, customerId: 'cus_14', rating: 5, text: 'Enfin un guide qui ne dit pas juste « soyez patient ». Le carnet de réveils m’a ouvert les yeux, et à la nuit 8 notre fille a fait 6 h d’affilée.' },
      { id: 'rev_2', day: 11, customerId: 'cus_22', rating: 4, text: 'Très concret, surtout le rituel en 20 minutes. Le palier de la main a été dur pour nous, mais ça a fini par marcher.' },
      { id: 'rev_3', day: 12, customerId: 'cus_31', rating: 5, text: 'J’ai payé 19 € et j’aurais payé le double : on est passés de 5 réveils à 1 seul en deux semaines.' },
      { id: 'rev_4', day: 14, customerId: 'cus_40', rating: 4, text: 'Bien écrit, sans culpabiliser les parents. J’aurais aimé un peu plus de détails pour les jumeaux.' },
    ],
  },
  priceHistory: [{ day: 6, price: 14 }, { day: 12, price: 19 }],
};

export const demoSalesPage: SalesPage = {
  headline: 'Bébé se réveille toutes les 2 heures ? Retrouvez des nuits de 6 h en 14 nuits, en douceur',
  subheadline: 'La méthode pas à pas pour les parents de bébés de 6 à 12 mois — sans le laisser pleurer seul, sans tout chambouler.',
  painBullets: [
    'il se réveille toutes les 2 h et ne se rendort qu’au sein',
    'je le dépose endormi, il hurle dès que ma main quitte son dos',
    'on a tout essayé, je suis à bout et je n’ose plus sortir le soir',
    'tout le monde me dit « ça passera », mais ça fait 8 mois',
  ],
  solution: 'Ce guide vous donne un plan précis pour chaque soir et chaque réveil : un rythme de journée qui prépare la nuit, un rituel de 20 minutes, puis 4 paliers de 3 nuits pour que bébé apprenne à se rendormir sans vous — en restant présent à chaque étape.',
  chapterBlurbs: [
    { title: 'Pourquoi il se réveille toutes les 2 heures', blurb: 'Le carnet de 3 nuits qui révèle la vraie cause (et pourquoi ce n’est presque jamais la faim).' },
    { title: 'Le bon rythme de journée', blurb: 'Les fenêtres d’éveil par âge et l’heure de coucher qui supprime le réveil hurlant de 23 h.' },
    { title: 'Le rituel du coucher en 20 minutes', blurb: 'Le petit changement de place du biberon qui change tout.' },
    { title: 'Le décrochage en douceur', blurb: '4 paliers de 3 nuits, de la main posée à la chaise près de la porte.' },
    { title: 'Gérer les réveils de nuit', blurb: 'La règle des 2 minutes et quoi faire, exactement, à 3 h du matin.' },
    { title: 'Tenir sur la durée', blurb: 'Dents, rhumes, voyages : revenir aux bonnes nuits en 2 ou 3 jours.' },
  ],
  bonusBlurb: 'Le kit de survie du parent épuisé : tours de garde, plateau de nuit et la phrase à relire à 3 h du matin.',
  objections: [
    { q: 'J’ai déjà tout essayé…', a: 'La plupart des parents ont essayé des astuces isolées. Ici, vous suivez un plan complet dans le bon ordre : journée, rituel, puis décrochage. C’est l’ordre qui fait la différence.' },
    { q: 'Est-ce que je vais devoir le laisser pleurer ?', a: 'Non. Vous restez présent à chaque palier. Bébé peut protester contre le changement, mais il n’est jamais laissé seul.' },
    { q: 'C’est encore un PDF écrit par une IA ?', a: 'Le guide est construit à partir de centaines de témoignages de parents, avec leurs mots et leurs situations réelles, puis relu par notre équipe.' },
    { q: 'Je n’ai pas le temps de lire 80 pages', a: 'Le guide se lit en 15 minutes. Chaque chapitre se termine par une checklist : vous savez exactement quoi faire ce soir.' },
  ],
  guarantee: 'Vous avez 14 jours pour tester la méthode. Si elle ne vous aide pas, écrivez-nous : nous vous remboursons, sans justification.',
  cta: 'Je veux retrouver mes nuits',
  hypeLevel: 0.4,
};

export const demoCreative: AdCreative = {
  id: 'crv_demo',
  productId: 'prd_demo',
  hook: 'Il se réveille toutes les 2 h ? Ce n’est (presque) jamais la faim.',
  hookStyle: 'contrarian',
  format: 'faceless_voiceover',
  scenes: [
    { visual: 'Babyphone qui s’allume dans le noir, 3 h 12 à l’écran', onScreenText: 'Il se réveille toutes les 2 h ? Ce n’est (presque) jamais la faim.', voiceover: 'Votre bébé se réveille toutes les deux heures ? Ce n’est presque jamais la faim.', durationSec: 3 },
    { visual: 'Parent qui berce bébé dans un couloir sombre', onScreenText: 'Ce qui l’endort à 20 h, il le réclame à chaque réveil', voiceover: 'Ce qui l’endort le soir, il le réclame à chaque fin de cycle : le sein, les bras, le bercement.', durationSec: 4 },
    { visual: 'Carnet ouvert avec les heures de réveil notées', onScreenText: 'Étape 1 : notez ses réveils pendant 3 nuits', voiceover: 'Première étape : notez chaque réveil pendant trois nuits. Vous allez voir le schéma apparaître.', durationSec: 4 },
    { visual: 'Main posée sur le ventre d’un bébé dans son lit', onScreenText: 'Puis 4 paliers de 3 nuits, sans le laisser pleurer seul', voiceover: 'Ensuite, quatre paliers de trois nuits pour qu’il apprenne à se rendormir, sans jamais le laisser seul.', durationSec: 4 },
    { visual: 'Couverture du guide sur un téléphone, lumière du matin', onScreenText: 'Le plan complet en 14 nuits → lien en bio', voiceover: 'Tout le plan est dans le guide, lien en bio.', durationSec: 3 },
  ],
  caption: 'Le plan en 14 nuits pour les bébés de 6 à 12 mois qui se réveillent toutes les 2 h.',
  hashtags: ['sommeilbebe', 'parentsepuises', 'bebe8mois', 'astuceparent'],
  cta: 'Télécharger le guide',
  files: { storyboard: [], preview: null },
  quality: null,
  review: { status: 'approved', reason: null, day: 7 },
  createdDay: 7,
  createdBy: 'ag_growth_1',
};
