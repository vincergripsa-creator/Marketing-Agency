# Équilibrage du marché virtuel

> Objectif de la simulation : un **vrai défi, mais juste**. Une agence qui démarre avec **500 €** et vise **1 000 € de profit au jour 60** doit pouvoir y arriver en difficulté `normal` *si elle apprend* (hooks, formats, prix, qualité), le rater de peu si elle n'a pas de chance, et survivre de justesse en `cauchemar`.
>
> Toutes les constantes du marché sont dans `server/src/sim/balance.ts`. Les seuils de décision du CEO sont en tête de `server/src/runtime/strategy.ts`. Le banc d'essai est `server/scripts/balance.ts` (`npm run balance`).

## 1. Comment le marché décide (en clair)

Chaque niche a une **vérité cachée** (`NicheTruth`, catalogue dans `server/src/sim/catalog/`, variée de ±15 % à chaque partie selon la graine). L'agence ne la voit jamais : elle ne voit que des outils de recherche bruités et ses propres résultats.

### Ce qui fait cliquer sur une pub (CTR)

`CTR = 0,55 % × qualité de la créa × (affinité hook × affinité format)² × affinité TikTok de la niche × fatigue × bruit`

- **L'angle compte énormément.** Chaque niche préfère certains styles de hook (erreur à éviter, POV, avant/après…) et certains formats (avatar UGC, diaporama texte…). L'affinité va de 0,5 à 1,8 et elle est **élevée au carré** : le meilleur couple d'une niche clique 3 à 5 fois plus que le pire. Une créa « au hasard » fait environ 1,5-2 % de CTR, une créa sur l'angle appris 3-4 %.
- **La qualité de la créa** (hook court qui nomme le problème, mots des clients, CTA clair, pas de promesse interdite) compte avec un exposant 1,3.
- **La fatigue** : une créa perd la moitié de son CTR vers 60 000 impressions. Il faut renouveler les créas, pas seulement monter le budget.
- Le CPM (coût pour 1 000 impressions) vaut 4 à 10 € selon la niche, × la difficulté, × le jour de la semaine, × les événements (pic de CPM).

### Ce qui fait acheter (conversion de la page de vente)

`conversion ≈ 1,95 % × qualité de la page × facteur prix × note des avis × spécificité du guide × demande × concurrence × niveau de promesse`

- **Le prix** : en dessous du prix « idéal » de la niche, on vend un peu plus ; au-dessus, la conversion baisse ; **au-delà du prix maximum que les acheteurs acceptent, elle s'effondre** (sans falaise brutale, mais nettement : à 39 € pour un maximum de 33 €, chaque visiteur rapporte deux fois moins qu'à 29 €). Le bon prix est celui qui maximise le **revenu par visiteur**, pas le nombre de ventes.
- **La note des avis** : pas d'avis = 0,8 ; moyenne ≥ 4,5 = 1,2 ; moyenne < 3,5 = 0,6.
- **La promesse** : une page plus « survendue » convertit un peu mieux (jusqu'à +35 %)… et fait rembourser et mal noter si le guide ne tient pas la promesse.
- **La saturation** : une niche n'absorbe qu'un nombre limité de visiteurs par jour (120 + 450 × demande, puis rendement décroissant). Multiplier le budget par 5 ne multiplie pas les ventes par 5 : le ROAS baisse quand on scale.
- Le trafic organique convertit à 60 % du payant (public froid), les créateurs à 140 % (confiance).

### Ce qui fait rembourser, et les avis

- Le risque de remboursement = base de la difficulté × sensibilité de la niche + écart entre la promesse et le contenu + qualité du PDF trop basse + profil du client. Il est concentré sur les premiers jours après l'achat (fenêtre de 14 jours).
- Les **chasseurs de remboursement** demandent à être remboursés quoi qu'il arrive ; les « Karen », sceptiques et menaces de litige passent par la boîte mail (y répondre bien et vite évite le chargeback à 15 € de frais).
- Les avis viennent des acheteurs (2 à 5 jours après l'achat) ; un support qui ignore un client mécontent récolte un 1 étoile. **Seuls les acheteurs vérifiés notent la boutique** : un troll qu'on « nourrit » revient à la charge en message, il ne peut pas noter le guide (une vague de trolls, événement annoncé, peut en revanche laisser un 1 étoile).

### Les autres pièges

Clients pénibles, arnaques au support (« remboursez-moi la différence »), faux créateurs qui encaissent une avance, pubs refusées (mots interdits : « garanti », kilos, gains d'argent…) puis compte suspendu au 3e avertissement, concurrent qui clone le guide, tendance qui baisse, panne de paiement, réserve du prestataire de paiement (gèle une partie de la trésorerie, jamais plus de la moitié, pendant 7 jours, sans bloquer les ventes), vague de trolls, pic de CPM. Les **frais fixes** : 60 € de démarrage (thème de boutique, domaine, pixel, outil e-mail, au premier jour), boutique 29 €/mois, outils 12 €/mois, frais de paiement 1,5 % + 0,25 €. Un run refuse un budget de départ sous `minRunCash()` : 280 € pour l'équipe de 8 (démarrage + 30 jours de frais fixes et de paie des fondateurs, arrondi à la dizaine supérieure). Sans paie, `minStartingCash()` garde l'ancien plancher de 110 €.

### Pépites et pièges du catalogue

| Type | Niches | Pourquoi |
|---|---|---|
| Pépites | propreté du chiot, oral aide-soignante, URSSAF micro-entreprise, mariage < 10 k€, relooker un meuble | demande correcte, bon prix accepté, peu de concurrents sérieux, peu de risque de conformité |
| Solides | sommeil de bébé, diversification/DME, potager sur balcon, TOEIC, Japon petit budget | demande forte ou bon prix, mais plus de concurrence ou de remboursements |
| Pièges | chat qui griffe, batch cooking, stress du bac (prix acceptés de 8 à 15 €) ; freelance LinkedIn (saturé, CPM 10 €) ; ventre après 40 ans (champ de mines de conformité, remboursements) ; revendre sur Vinted (promesses d'argent refusées) | beaucoup de « buzz » dans les tendances, mais impossible d'y gagner de l'argent avec de la pub payante |

### Ce que change la difficulté

| | facile | normal | cauchemar |
|---|---|---|---|
| CPM (× base de la niche) | × 0,8 | × 1 | × 1,35 |
| Part de clients pénibles | 15 % | 30 % | 55 % |
| Remboursements de base | 2,5 % | 4 % | 12 % |
| Intensité des arnaques (messages d'arnaque et événements « tentative d'arnaque ») | 0,08 | 0,18 | 0,40 |
| Faux créateurs | 15 % | 25 % | 40 % |
| Événements par jour | 12 % | 20 % | 34 % |
| Messages clients par vente | 0,10 | 0,16 | 0,28 |

## 2. Ce que l'agence doit apprendre (et que le banc d'essai mesure)

1. **L'angle des pubs** : les bandits de Thompson par niche (`hook_style:<niche>`, `ad_format:<niche>`) apprennent quel style et quel format cliquent ; les expériences A/B le confirment ; les leçons l'écrivent dans les playbooks ; la production de créas exploite ce qui a été appris.
2. **Le prix** : tests A/B de prix mesurés en revenu par visiteur, hausse annulée si elle fait baisser ce revenu, baisse si personne n'achète.
3. **Où mettre l'argent** : stop-loss, cooldown, « pub morte » pour une version qui perd, scale progressif des gagnants, diversification vers une nouvelle niche.
4. **La qualité** : réécriture (v2/v3) sur plaintes et mauvais avis, pause d'une version qui fait fuir les acheteurs.

Le critère du §6 appelle l'apprentissage **visible** quand le CTR et le ROAS des jours 31-60 battent ceux des jours 1-30. Cette lecture mesure l'échelle autant que l'apprentissage : l'agence dépense environ 4 fois plus en 2e moitié (saturation, fatigue) et ouvre de nouvelles niches où elle repart de zéro. La preuve qui compte est le contrôle apparié (§4.6), et le §6 dit quelle lecture la suit le mieux.

## 3. Calibration d'avant la V1, et ce qui a bougé depuis

Ces tableaux datent d'avant la V1 : ils disent pourquoi le marché a sa forme. La calibration de la V1 est au §4.5. Quatre valeurs ont bougé depuis le premier tableau : `CONVERSION.base` vaut 0,0195 (0,018 avant le gagnant E), `CONVERSION.poolDemand` 450, `DIFFICULTY.facile.cpmMultiplier` 0,8, `DIFFICULTY.cauchemar.refundBase` 0,12.

### Constantes du marché (`server/src/sim/balance.ts`)

| Constante | Avant | Après | Pourquoi |
|---|---|---|---|
| `ADS.baseCtr` | 0,011 | 0,0055 | Le marché était trop généreux : rentable dès le jour 3 partout, 8 000 € de profit médian en `normal`, 1 800 € en `cauchemar`. |
| `ADS.affinityExp` (nouveau) | 1 | 2 | L'écart entre un bon et un mauvais angle était trop faible pour que l'apprentissage se voie (+5 % de CTR) ; au carré, choisir le bon hook et le bon format paie vraiment. |
| `ADS.fatigueImpressions` | 25 000 | 60 000 | Une créa perdait la moitié de son CTR en quelques heures de gros budget : la fatigue écrasait tout ce que l'agence apprenait en 2e moitié. |
| `CONVERSION.base` | 0,0285 | 0,019 | ≈ 2 % des visiteurs payants achètent un guide bien vendu au bon prix (ordre de grandeur réel d'un trafic TikTok froid). |
| `CONVERSION.poolDemand` | 900 | 650 | Plafonne les gros gagnants (une partie `normal` montait à 11 500 €) : une niche n'a qu'un nombre limité d'acheteurs par jour. |
| `FEES.setupCost` (nouveau) | 0 | 60 € | Frais de démarrage au jour 1 : l'agence part légèrement dans le rouge au lieu d'être « rentable » après sa première vente au jour 3. |
| `DIFFICULTY.facile.cpmMultiplier` | 0,85 | 0,7 | Garder `facile` nettement au-dessus de `normal` après le durcissement général. |

### Seuils et règles de décision (hors `balance.ts`, corrigés car ils faussaient l'équilibre)

| Où | Avant | Après | Pourquoi |
|---|---|---|---|
| `runtime/strategy.ts` — arrêt d'un produit | < 3 ventes et ROAS < 0,7 après 7 jours | idem sur les 14 derniers jours de la version en cours (`KILL_WINDOW_DAYS`), seulement sur un vrai échantillon : ≥ 450 visiteurs payants (`KILL_MIN_VIEWS`) ou ≥ 14 jours en ligne (`KILL_NO_TRACTION_DAYS`) ; perte nette sur 14 jours et 2 campagnes (`recentLoss`) = plus de budget | Après 7 jours et ~100 € de pub (200 visiteurs), < 3 ventes à 2 % de conversion arrive une fois sur cinq par malchance : la première niche, souvent la meilleure, était tuée dans un tiers des parties. |
| `runtime/strategy.ts` — prix (`priceMove`) | seule règle : monter d'un palier après 10 ventes, sans jamais revenir ; le gagnant d'un test A/B n'était jamais appliqué | test conclu → gagnant appliqué ; test non concluant → retour au prix d'avant ; hausse qui fait perdre > 15 % de revenu par visiteur (150 visiteurs de chaque côté) → annulée, palier abandonné ; < 0,8 % de conversion sur 300 visiteurs → un palier plus bas | Des guides restaient à 39-49 € pour une niche qui paie 33 € maximum (conversion ÷ 5). |
| `runtime/handlers/ops.ts` — tests de prix | toujours « un palier au-dessus », un seul test par guide | vers le bas si la conversion payante est < 1,5 % (`PRICE_TEST_LOW_CVR`), sinon vers le haut ; un nouveau test tous les 12 jours | Un guide lancé trop cher ne pouvait jamais apprendre à baisser. |
| `learning/experiments.ts` — gagnant d'un test de prix | le meilleur revenu par visiteur, même sur 1 vente contre 0 ; conclusion possible à 60 visiteurs | ≥ 8 ventes au total et ≥ 10 % d'écart, sinon pas de gagnant ; 120 visiteurs par variante pour conclure avant 7 jours | « 19 € gagne » sur une vente chanceuse gardait un guide à un prix que personne ne payait. |
| `learning/retro.ts` — récompense des bandits hook/format | CTR / 3 % (plafonné à 1) | CTR / 5 % ; une créa déjà vue plus de 30 000 fois ne compte qu'à 25 % | Toutes les bonnes créas (3-5 % de CTR) valaient 1, et le meilleur style, celui qu'on fait tourner le plus longtemps, était puni pour sa propre fatigue. |
| `runtime/handlers/growth.ts` — choix du hook d'une nouvelle créa | la n-ième créa prenait le n-ième hook inutilisé | tirage de Thompson sur les styles disponibles (hors créneau d'expérience) ; si le style choisi n'a plus de hook neuf, nouvelle exécution d'un hook déjà utilisé (jamais un hook refusé par TikTok) | Le rédacteur heuristique n'a que 2 à 4 textes par style : le meilleur style d'une niche s'épuisait après 2-3 créas et n'était pas plus utilisé qu'un style au hasard (15 % → 21 % des créas entre les deux moitiés ; maintenant 16 % → 29 %). |
| `runtime/acquisition.ts` — remboursements qui bloquent un produit | > 15 % (significatif) → pause, puis arrêt à la v3 | idem seulement si le produit ne rembourse plus sa pub nette des remboursements (ROAS < 1,1) ou si les remboursements dépassent 25 % | En `cauchemar`, les chasseurs de remboursement font 10-17 % des commandes : le meilleur produit d'une partie (ROAS 1,4) était mis en pause puis tué. |
| `sim/tools.ts` — troll « nourri » | 1 étoile sur la boutique, acheteur ou non | 1 étoile seulement s'il a acheté ; sinon il revient en message | Des guides notés 99/100 étaient tués par 3 avis 1 étoile de trolls qui n'avaient rien acheté (26 des 33 avis ≤ 2 étoiles sur 4 parties). |

### Empreinte de référence (`golden`)

Le run de référence (entreprise d'avant la V1, 25 jours, graine 7) ne se réenregistre que pour une décision écrite (D43 de `docs/v1/PLAN.md`), avec l'ancienne et la nouvelle empreinte ici. Toute autre différence est un bug.

| Étape | Raison | Ancienne empreinte | Nouvelle empreinte | Ce qui a bougé |
|---|---|---|---|---|
| P8.1 | Texte des guides : détail des étapes sous son propre intertitre, plan sans lignes répétées, exemple pour chaque chapitre, citations et notes en marge | `dc93c9d2173be97aade7336c20a776dd70652baf` | `efab7b77a2fb2a886d24927b06e7b5b86a2afdd4` | `ledger` et `kpis` (le texte change la note de qualité, donc les ventes) ; `tasks` et `events` inchangés. Enregistrée sur `HEAD` plus les seuls fichiers de P8.1 |
| P10.2 | Les rivaux remplacent la pénalité permanente des clones ; liste e-mail et kit côté marché | `efab7b77a2fb2a886d24927b06e7b5b86a2afdd4` | `efab7b77a2fb2a886d24927b06e7b5b86a2afdd4` (identique) | Rien : en 25 jours, la graine 7 ne voit ni clone ni rival (0 événement `competitor_clone`, `market.rivals` vide) et l'entreprise n'a ni liste ni kit. `--record` réécrit le même fichier, sur `HEAD` plus les seuls fichiers de P10.2 |
| P14.1 (S14, D145) | Le gagnant E écrit `CONVERSION.base` 0,0195, que le run de référence lit | `efab7b77a2fb2a886d24927b06e7b5b86a2afdd4` | `bf66359a8b97fe09b4a55e417d303d0608f69ac7` | `ledger`, `kpis` et `tasks` ; `events` inchangés |
| Dernière liste (D135 à D143) | Texte des guides (D1, D2, N1, `bare`) et couvertures (D3, D138) | `efab7b77a2fb2a886d24927b06e7b5b86a2afdd4` | `efab7b77a2fb2a886d24927b06e7b5b86a2afdd4` (identique) | Rien : l'empreinte est restée la même, aucun réenregistrement. Elle couvre l'entreprise d'avant la V1 sur 25 jours, pas le marché ci-dessous |
| S15 (D152, D156) | Texte des guides : titres de chapitres, jauges, plans, notes de marge, audiences avec leur âge, têtes de paragraphe, phrases cassées | `bf66359a8b97fe09b4a55e417d303d0608f69ac7` | `b6b0ec5a8530dea8a2cf7985c93eeac7253e6b2f` | `ledger`, `kpis` et `tasks` ; `events` inchangés. Vérifié : l'arbre sans le paquet pdf lit `bf66359a…` ; le monde diffère d'abord le soir du J1 par un seul titre de chapitre du plan, jusqu'au J12 par le texte du guide et ce qui le cite, le J13 par les titres, le J14 par une note qui lit ce texte, et ce que l'empreinte couvre bouge le J15 |
| Passe de texte (`9b3cdc4`, `67a5152`) | Modèles à copier, une étape du mariage, une étape URSSAF, sommaire du bonus | `b6b0ec5a8530dea8a2cf7985c93eeac7253e6b2f` | `b6b0ec5a8530dea8a2cf7985c93eeac7253e6b2f` (identique) | Rien côté empreinte : `golden.ts --check` passe sur `67a5152`. Le marché de la V1 a bougé, d'où la dernière course relancée (§4.1) |
| Dernière liste de S15 (`fff9634`, D165 à D173) | Pages de vente et kits, ordres du fondateur, test sous la ligne, fondateurs à 0 en survie | `b6b0ec5a8530dea8a2cf7985c93eeac7253e6b2f` | `b6b0ec5a8530dea8a2cf7985c93eeac7253e6b2f` (identique) | Rien côté empreinte : `golden.ts --check` passe sur `fff9634`, sans réenregistrement. Le run de référence n'a pas `scaling`, donc ni test ni nouvelle paie. Le marché de la V1 a bougé (§4.1) |

### S15 : ce qui a bougé après l'étape 4

Ces nombres comparent 9513e97 au code final, 60 jours, 500 €, `normal`. Ils mêlent les bascules de l'étape 4 (D149), le texte des guides (D152, D156) et, pour la colonne « Sur `fff9634` », la dernière liste (D165 à D173). Aucune constante de `balance.ts` n'a changé, et une graine ne prouve rien : la vraie médiane est au §4.1.

| Graine | Trésorerie J60, 9513e97 → `67a5152` | Sur `fff9634` | Première écriture différente, 9513e97 contre `67a5152` |
|---|---:|---:|---|
| 4 | 3 549,79 € → 4 559,56 € | 4 559,56 € | J7 |
| 7 | 8 684,29 € → 6 313,85 € | 6 313,85 € | J5 |
| 42 | 1 411,67 € → 447,17 € | 1 395 € | J16 |

Entre `67a5152` et `fff9634`, la médiane `normal` passe de 2 728 à 2 629 € à J60. Le bras `off`, sans l'assurance, lit déjà 2 629 € sur le code final : cet écart ne vient pas de l'assurance, et personne ne l'a découpé entre les pages, les kits et les textes de la dernière liste.

Sur un an, graines 1 à 10, lu sur `11b3f20` : médiane de la trésorerie à J360 environ 36 440 €, contre environ 21 500 € avant les dernières corrections du texte et environ 38 000 € à la lecture d'acceptation. Sur `fff9634` : médiane 29 033 €, de 14 339 à 67 805 €. Aucun plantage, aucun écart de grand livre.

### Dernière liste (D135 à D143)

L'empreinte n'a pas bougé, le marché si : un texte de guide ou un titre de couverture changent une note, donc les ventes. La même couverture a gagné 5,5 points (D138).

- **Une empreinte égale ne veut pas dire un monde égal.** Elle couvre l'entreprise d'avant la V1 sur 25 jours, pas le marché de la V1.
- **Un écart sur une graine est surtout du chaos.** À J90, ces corrections ont pris -24 % à la graine 7 et +25 % à la graine 11. Cela ne dit pas qu'un meilleur guide vend moins.

**Ce que S14 a trouvé :** le bruit vaut 1 176 € à J60 et 6 341 € à J180 (§4). Aucun effet de cette liste ne se lit sous ces nombres, et aucun n'a été réglé.

### Rivaux

Mesuré à la fin de P10.2, rien n'a été réglé dessus (`GROWTH.rivals` reste celui de scale §6).

- **Un clone mord fort et tôt.** Il coûte 10 % de conversion d'un coup, puis s'efface (demi-vie 60 jours). En `normal`, un événement `competitor_clone` tombe environ tous les 33 jours et vise un guide en ligne au hasard : avec un seul guide en vente, ces clones seuls tiennent la niche vers −26 %, tout près du plafond de −30 %.
- **Les rivaux naturels prennent le relais quand les ventes montent :** 7 rivaux sur une route de la graine 7 d'ici J127, sans aucun événement `competitor_clone`.

**Ce que S14 a trouvé :** le gagnant E relève `CONVERSION.base` de 0,018 à 0,0195 sans qu'aucun contrôle ne lise les clones à part. Sur `fff9634`, à J30, le profit médian `normal` est de 76 € et 14 graines sur 30 sont à perte : le premier mois reste le plus étroit.

### Réserve et survie

D9 dit `adCap = min(part, trésorerie − réserve)`, et le plancher de la réserve (30 % du départ) est exactement la ligne de survie : sous cette ligne le plafond valait 0 pour de bon et coupait les pubs qui rapportaient. La porte de S10 y a mis la plus petite exception qui garde l'intention (D67) : en survie la réserve ne compte plus, et le mode survie suit ses propres règles : une pub rentable continue, et rien de neuf ne se lance, sauf un petit test à la fois (D167, §4.8).

**`ORG.survivalPayCut` a changé de sens.** Il vaut toujours 0,5, mais ce n'est plus ce que prennent les fondateurs d'une partie normale : sous la ligne, ils ne se versent plus rien (`founderShare` 0, `survivalInsured`). 0,5 ne sert plus qu'au contrôle `control.noSurvivalTest` et aux parties sans `scaling`, anciennes sauvegardes comprises. Les recrues gardent leur contrat, et en faillite les fondateurs prennent 0 dans tous les cas.

**Ce que S14 et le relevé final ont trouvé :**

- `STAGE_POLICY.reserveDays` et `CFO.reserveSpendShare` n'ont pas bougé : aucun candidat ne les portait.
- 8 graines sur 30 passent par la survie sur 182 jours (`fff9634`). Cinq y cumulent de 3 à 8 jours. Les graines 5, 29 et 20 y cumulent 51, 61 et 103 jours, en 9, 5 et 9 épisodes, sans aucune clôture négative. À J182, aucune n'est en survie, la graine 20 reste au palier Survie.
- Une pub qui rapporte peut encore s'arrêter quand la trésorerie passe sous une réserve au-dessus du plancher : c'est D9 à la lettre, et `allocator.test.ts` l'épingle.
- La croissance coûte d'abord : à J60, le bras complet lit 3 053 € contre 3 699 € sans mise à l'échelle, et à J180 il ne passe devant que de 1,15 fois (étape 4, `9513e97`).

### Score visuel

Mesuré à la fin de S8, rien n'a été réglé dessus (`sim/visual.ts` reste celui de pdf §12.4).

- **`VISUAL.ref = 70` n'est pas le niveau d'une agence qui démarre,** contrairement à ce que disent pdf §12.4 et le commentaire de `sim/visual.ts`. Sur cinq runs de 60 jours (graines 1, 2, 3, 7, 42), `visual.overall` moyen va de 83,6 à 86,7. À 85, chaque produit gagne dès sa première vente environ +7,5 % de conversion, +5 % de prix acceptable, +0,2 étoile et −1,3 point de remboursement.
- **Les cibles de finition 55, 72, 88 de pdf §12.2 ne sont pas atteintes :** `interior` mesuré 79, 95, 96 sur les trois guides de `visual.test.ts`. Tout l'écart est entre la finition 0 et la finition 1.

**Ce que S14 a trouvé :** le contrôle `design` a donné le résultat mince annoncé, gain 25 € et positif 17/30, puis 15 € et 16/30 à la pente 0,25 (§4.5). Le look reste, le talent design est « non prouvé », `VISUAL.ref` et `VISUAL.cvr.slope` n'ont pas bougé. Le commentaire de `sim/visual.ts` et pdf §12.4 restent faux sur ce point.

## 4. Résultats

Ce paragraphe décrit la V1 et remplace les tableaux d'avant la V1, qui mesuraient l'ancienne équipe fixe (ils restent dans l'historique git). Chaque tableau dit de quel commit il parle. Le code final est **`fff9634`**. Ses tableaux sont recomptés sur les 90 runs du bras `on` de la lecture appariée (§4.8) : `normal` 182 jours, `facile` et `cauchemar` 60 jours. Ces runs ont été relancés sur l'arbre final, 150 sur 150 identiques aux lectures appariées (§4.7, point 10). Les contrôles appariés de l'étape 4 et les regards à 182 jours n'existent que sur un code plus ancien, et ils le disent : ils décrivent l'entreprise d'avant les bascules de l'étape 4.

- **La référence est 2 629 €**, la médiane `normal` à J60 sur `fff9634`. 2 728 € est le nombre de `67a5152`, 3 053 € celui de l'étape 3, le candidat E avant les bascules, 1 408 € celui d'avant la V1 : aucun n'est plus une référence.
- **Le bruit :** deux runs qui ne diffèrent que d'un placebo (`ADS.baseCtr` × 1,01) s'écartent en médiane de 1 176 € à J60 sur le candidat A (étape 1), de 1 301 € à J60 et de 6 341 € à J180 sur le gagnant (étape 4). La règle gardait N = 1 176 €, aucun verdict n'en change. Le commit final n'a aucune mesure de bruit. Un écart plus petit ne dit rien.
- **Une médiane ne se lit jamais seule.** Les quartiles sont la médiane de chaque moitié des 30 graines. Environ 1 graine sur 10 reste près de la mort à chaque lecture du code.
- **Une faillite** est au moins une clôture sous zéro, remontée ou non. **Rentable** : profit cumulé positif ce jour-là.

### 4.1 La dernière course, J60, commit `fff9634`

Graines 1 à 30, 500 € de départ, sans fin, comme le produit, cerveau heuristique. `normal` vient des 60 premiers jours du relevé de 182 jours du §4.2, `facile` et `cauchemar` de runs de 60 jours. Les trois ont tourné par le pilote de la lecture appariée, avec les champs de `balance.ts --open-ended` (D169).

| Difficulté | Profit médian | Q1 / Q3 | min / max | Rentables | À perte | Objectif 1 000 € | Faillites | À noter |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `facile` | 8 089 € | 4 172 / 10 758 € | -199 / 17 719 € | 29/30 | 1 | 26/30 | 0 | clôture la plus basse 121 € |
| `normal` | **2 629 €** | 181 / 5 224 € | -370 / 9 490 € | 25/30 | 5 | 19/30 | 0 | les graines 3 et 14 finissent à +1 et +3 €, 11 graines sous 1 000 €, clôture la plus basse 122 € |
| `cauchemar` | +130 € | -337 / 852 € | -393 / 3 427 € | 16/30 | 14 | 7/30 | 0 | trésorerie médiane 630 €, 8 graines en survie le dernier jour, clôture la plus basse 87 € |

« 0 faillite sur 90 » dit peu sur la solvabilité : cette course s'arrête à J60. En `normal`, la solvabilité se lit au §4.2, et sur le code final les 182 jours n'ont aucune clôture négative. Avant l'assurance, la première venait à J87 sur `67a5152` et à J66 sur les 210 runs de l'étape 3. En `cauchemar`, elles peuvent venir avant J60 : J51 à l'étape 3, 11 runs sur 210 à J60, tous sous A, B ou C, aucun sous le gagnant. Personne n'a lu `cauchemar` après J60 sur le code final.

### 4.2 Le relevé de 182 jours, commit `fff9634`

30 graines, `normal`, 500 €, sans fin.

| Profit cumulé | J60 | J120 | J180 | J182 |
|---|---:|---:|---:|---:|
| Médiane | 2 629 € | 13 906 € | **24 865 €** | 24 927 € |
| Q1 / Q3 | 181 / 5 224 € | 7 282 / 23 925 € | 18 556 / 36 316 € | 18 834 / 36 918 € |
| min / max | -370 / 9 490 € | -356 / 33 609 € | -279 / 54 973 € | -226 / 55 042 € |
| Graines à perte ce jour | 5 | 3 | 1 | 1 |
| Graines en survie ce jour | 3 | 0 | 0 | 0 |
| Faillites depuis le début | 0 | 0 | 0 | 0 |

- **À J180 :** 29/30 positives, 0 faillite. Aucune clôture sous zéro en 182 jours, la plus basse est 71,22 € (graine 20). C'est l'assurance qui l'explique, test et fondateurs à 0 mêlés : le bras `off`, qui coupe les deux, lit 2 faillites (§4.8).
- **La queue :** la graine 20 est à -279 € à J180, avec 103 jours de survie, et finit à J182 avec 273,96 € en caisse, hors du mode survie mais encore au palier Survie. Les graines 5 et 29 sont à 3 377 et 2 199 € à J180, après 51 et 61 jours de survie.
- **Palier à la fin :** 24 Portefeuille, 5 Accélération, 1 Survie.
- **Effectif médian 16**, de 10 à 18. Médianes par graine : 10 embauches, 1 départ, 0 remplacement. 4 remplacements en tout.
- **Sur 182 jours, en médiane :** 78 790 € de chiffre d'affaires pour 41 665 € de pub.
- **Intégrité :** violations 0, écarts au grand livre 0, NaN 0, sur les 90 runs.

### 4.3 Les huit contrôles sur le commit final

Recomptés sur les fichiers bruts avec la méthode de `server/scripts/calibrateLib.ts` : K1, K2, K3, K7, K8 sur le relevé de 182 jours, K4 et K5 sur les runs de 60 jours, K6 sur les 90 runs. `checksOf` lui-même, lancé sur les mêmes fichiers, donne les mêmes nombres. La colonne de droite est le candidat E à l'étape 3 (code `e6fb49336df90154`). **L'entreprise livrée rate deux contrôles, K7 et K8.**

| # | Contrôle | Cible | `fff9634` | Passe | Étape 3, E |
|---|---|---|---:|---|---:|
| K1 | `normal` : objectif à J60 | 15 à 27 sur 30 | 19/30 | oui | 21/30 |
| K2 | `normal` : médiane à J60 | 1 000 à 4 000 € | 2 629 € | oui | 3 053 € |
| K3 | `normal` : faillites à J60 et à J180 | au plus 2 à chacun | 0 et 0 | oui | 0 et 0 |
| K4 | `facile` : objectif, faillites | au moins 24 sur 30, 0 | 26/30, 0 | oui | 28/30, 0 |
| K5 | `cauchemar` : faillites, trésorerie médiane | au plus 8, au moins 250 € | 0, 630 € | oui | 0, 388 € |
| K6 | Violations, écarts au grand livre, NaN | tout à 0 | 0, 0, 0 sur 90 runs | oui | 0, 0, 0 sur 90 runs |
| K7 | `normal` : remplacements par graine, médiane | au moins 1 | **0**, 4 en tout | **NON** | 0, 3 en tout |
| K8 | `normal` : pente des semaines 9 à 26 positive, S26/S9 | au moins 24 sur 30, au moins 2,0 | **20/30, 1,92** | **NON** | 27/30, 2,06 |

K8 lit le chiffre d'affaires net des remboursements, semaine par semaine, et le brut donne aussi 1,92. 7 graines finissent la semaine 26 sous leur semaine 9.

### 4.4 La courbe de la semaine, commit `fff9634`

Médianes des 30 graines de `normal`, semaine par semaine. Le chiffre d'affaires net retire les remboursements. **CA / pub** divise tout le chiffre d'affaires brut de la semaine, organique, e-mail et upsells compris, par la pub. **ROAS pub** ne compte que les ventes de la pub, lues jour par jour : c'est le ROAS du §4.7 et du §6. Ces deux colonnes prennent la médiane des graines qui ont dépensé en pub cette semaine-là, 28 à 30 sur 30.

| Semaine | CA brut | CA net | Pub | CA / pub | ROAS pub | Profit de la semaine |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 26 € | 26 € | 33 € | 1,08 | 0,81 | -107 € |
| 2 | 126 € | 123 € | 81 € | 1,43 | 0,79 | -22 € |
| 3 | 251 € | 248 € | 132 € | 1,98 | 1,35 | 23 € |
| 4 | 313 € | 313 € | 187 € | 1,88 | 1,34 | 30 € |
| 5 | 538 € | 512 € | 238 € | 2,35 | 1,56 | 127 € |
| 6 | 998 € | 942 € | 417 € | 2,07 | 1,57 | 235 € |
| 7 | 1 564 € | 1 511 € | 578 € | 2,36 | 1,62 | 602 € |
| 8 | 1 946 € | 1 850 € | 858 € | 2,54 | 1,72 | 560 € |
| 9 | 2 543 € | 2 380 € | 1 019 € | 2,49 | 1,86 | 970 € |
| 10 | 2 618 € | 2 432 € | 1 238 € | 2,29 | 1,80 | 863 € |
| 11 | 3 030 € | 2 831 € | 1 392 € | 2,15 | 1,66 | 1 270 € |
| 12 | 3 701 € | 3 518 € | 1 648 € | 2,04 | 1,65 | 1 127 € |
| 13 | 3 502 € | 3 264 € | 1 781 € | 2,15 | 1,56 | 1 320 € |
| 14 | 4 188 € | 3 983 € | 2 176 € | 2,15 | 1,74 | 1 777 € |
| 15 | 4 330 € | 3 998 € | 2 163 € | 1,85 | 1,47 | 1 449 € |
| 16 | 4 346 € | 4 014 € | 2 330 € | 1,79 | 1,47 | 1 137 € |
| 17 | 4 070 € | 3 806 € | 2 340 € | 1,83 | 1,49 | 1 349 € |
| 18 | 4 953 € | 4 472 € | 2 723 € | 2,01 | 1,47 | 1 579 € |
| 19 | 4 810 € | 4 630 € | 2 512 € | 1,76 | 1,36 | 1 619 € |
| 20 | 5 484 € | 5 132 € | 2 664 € | 1,86 | 1,42 | 1 249 € |
| 21 | 4 731 € | 4 376 € | 2 721 € | 1,70 | 1,25 | 1 164 € |
| 22 | 4 568 € | 4 184 € | 2 791 € | 1,70 | 1,32 | 990 € |
| 23 | 4 458 € | 4 180 € | 2 687 € | 1,64 | 1,15 | 980 € |
| 24 | 4 925 € | 4 598 € | 2 807 € | 1,76 | 1,38 | 1 167 € |
| 25 | 4 612 € | 4 263 € | 3 121 € | 1,69 | 1,28 | 1 201 € |
| 26 | 4 320 € | 3 930 € | 2 743 € | 1,57 | 1,21 | 804 € |

Le chiffre d'affaires monte vite jusqu'à la semaine 15, puis il plafonne : de la semaine 15 à la semaine 26, sa médiane reste entre 4 070 et 5 484 €, près de 4 600 € par semaine. La pub, elle, continue de monter (× 2,7 entre les semaines 9 et 26, pour un chiffre d'affaires × 1,7), le CA / pub passe de 2,49 à 1,57, le ROAS pub de 1,86 à 1,21, et le profit de la semaine reste entre 800 et 1 800 € depuis la semaine 14. L'agence grandit seule, puis elle bute sur le marché (§7).

### 4.5 La calibration (`runs/calibration/step5.md`)

Une seule passe, règles fixées avant tout résultat (`docs/v1/PLAN.md` §4). Code : étapes 1 et 2 `4348f66b4b483f22`, étape 3 `e6fb49336df90154`, étape 4 `e56d3ecc0a885cb1` sur `9513e97`. **Ces nombres décrivent l'entreprise de ces commits, pas le commit final** : le relevé du §4.2 dit ce qu'elle est devenue.

**Bruit (étape 1) :** N = 1 176 €, 60 runs, 0 graine intacte sur 30.

**Leviers (étape 2) :** gain médian du talent ,8 contre ,25, sur 12 graines, à comparer à N.

| Groupe | Gain médian | Règle appliquée |
|---|---:|---|
| `copy` | 177 € | gardé |
| `page` | 1 933 € | gardé |
| `longform` + `polish` | -72 € | défauts à 0 (`TALENT.flawless`, D144) |
| `buying` | -531 € | gain négatif, mais rien à couper : ce groupe n'a pas de défaut, seulement des décisions (D144) |

**Candidats (étape 3), 630 runs.** `facile` et `cauchemar` à J60, `normal` à J182. K2 se lit dans la médiane, K3 vaut 0 à J60 pour les sept, K6 passe pour les sept (90 runs, 0, 0, 0).

| Candidat | Médiane `normal` J60 | K1 objectif | K3 faillites J180 | K4 `facile` | K5 `cauchemar` | K7 | K8 | Échecs |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A, tel que conçu | 1 601 € | 17/30 | 3 NON | 22/30 NON | 4, 121 € NON | 0 NON | 21/30, 1,62 NON | 5 |
| B, conversion 0,0195 | 2 782 € | 21/30 | 2 | 26/30 | 3, 389 € | 0 NON | 23/30, 1,66 NON | 2 |
| C, conversion 0,0165 | 316 € NON | 14/30 NON | 7 NON | 24/30 | 4, 119 € NON | 0 NON | 15/30, 1,25 NON | 6 |
| D, paie × 0,75, fondateurs 0,62 | 2 014 € | 21/30 | 1 | 26/30 | 0, 340 € | 0 NON | 22/30, 1,43 NON | 2 |
| **E, B et D** | **3 053 €** | 21/30 | 0 | 28/30 | 0, 388 € | 0 NON | 27/30, 2,06 | **1** |
| F, paie × 0,75, marché 0,60 | 1 787 € | 19/30 | 1 | 26/30 | 0, 270 € | 0 NON | 23/30, 1,83 NON | 2 |
| G, F et réservoir × 2 | 3 150 € | 23/30 | 1 | 26/30 | 0, 251 € | 0 NON | 27/30, 1,89 NON | 2 |

**Gagnant : E**, le seul à n'échouer qu'à un contrôle. Écrit dans le code : `CONVERSION.base` 0,018 → 0,0195, `ORG.payPerDay` haiku 0,5 → 0,375, sonnet 0,8 → 0,6, opus 1,2 → 0,9, `TALENT.founderMean` 0,56 → 0,62.

**Contrôles appariés (étape 4), 630 runs, code `e56d3ecc0a885cb1` sur `9513e97`.** Bras complet contre bras modifié, graine par graine.

| Contrôle | Lu | Règle | Passe | Ce qui a suivi |
|---|---|---|---|---|
| Sans apprentissage | médiane 140 €, positif 17/30 ; CTR neuf 2,40 % contre 2,08 %, angle 0,82 contre 0,75 | au moins +1 176 €, positif sur 19/30 | NON | rapporté, voir §4.6 |
| Sans ligue | M1 à M7 : 3 sur 7 ; remplacements 2 à J60, 5 à J180 | M1 à M7 | NON | rapporté |
| Sans mise à l'échelle | A1 à A5 : 3 sur 5 ; bruit 6 341 € | A1 à A5 | NON | rapporté, `priceMove` regardé une fois (§4.6) |
| Sans embauche | médiane 527 €, faillites 0 contre 0 | au moins 0, faillites pas plus hautes | oui | — |
| Équipe de 31 payée | médiane 1 620 € | au-dessus de 0 | oui | — |
| TikTok seul | × 0,90, faillites 0 contre 0 | × 1,25 à × 2,5 | NON | rapporté, voir §4.6 |
| ROAS moyen | le marginal gagne 5/30 (4 graines identiques), médiane -484 € | 19/30 et plus de 1 176 € | NON | **coupé :** l'allocateur passe au ROAS moyen, `waterFill` reste comme contrôle `marginal_roas` |
| Dernier clic | gagne 10/30 (7 graines identiques), médiane 0 € | 19/30 et plus de 1 176 € | NON | **coupé :** `RECON.claimWeight` 0, l'interface montre deux lectures, celle de la plateforme et celle de la boutique |
| Talent vidéo | CTR au moins × 1,12 sur 18/30, gain 1 759 € | 24/30, gain positif | NON | rapporté |
| Tempo | CTR J31-60 au-dessus du fixe sur 14/28 | 18/30 | NON | **coupé :** le tempo quitte le marché et le bandit |
| Talent design | gain 25 €, 17/30 ; nouvel essai, pente 0,25 : 15 €, 16/30 | gain positif, 19/30 | NON | le look reste, **« non prouvé »** |
| Règle du nouveau test (D122) | R/gagnant 1,05, au-dessus sur 16/30, placebo 1,00, faillites 0 contre 0 | au moins 1,15, 19/30, au-dessus du placebo | NON | **refusée pour de bon :** `PORTFOLIO.retestAny` quitte le code |

| Lecture | Lu | Cible | Passe |
|---|---|---|---|
| M1 talent moyen, ligue contre `flat` | +0,003, positif 14/30 | au moins +0,03, 22/30 | NON |
| M2 talent du travail fait | +0,004, positif 18/30 | au moins +0,06, 24/30 | NON |
| M3 profit | médiane 98 €, positif 17/30, IC 90 % -42 à 469 € | 20/30, médiane positive, IC sans 0 | NON |
| M4 remplacés sous la moyenne de leur famille | 100 % (5/5) | au moins 70 % | oui |
| M5 gain de talent sur le siège | +0,194 | au moins +0,10 | oui |
| M6 rotation | médiane 0, max 1 | médiane 4 au plus, max 6 au plus | oui |
| M7 note contre vrai talent | 0,39 sur 9 compétences, 405 personnes | au moins 0,5 | NON |
| A1 revenu des semaines 21 à 26 contre `scaling: false` | médiane 1,33, au-dessus de 1 sur 27/30 | au moins 2,0, 24/30 | NON |
| A2 profit à J180 contre `scaling: false` | médiane 1,15 | au moins 1,5 | NON |
| A3 pente et S26/S9 | 26/30, 2,03 | 24/30, au moins 2,0 | oui |
| A4 profit à J60 contre `scaling: false` | médiane 0,84 | au moins 0,8 | oui |
| A5 faillites à J180 | 0 contre 0 | pas plus que le contrôle + 1 | oui |

**Ce qui a été coupé en tout :** le ROAS marginal comme règle, la réconciliation des plateformes, le tempo comme effet de marché, la règle du nouveau test. Aucune constante de `balance.ts` n'a bougé après l'étape 3.

### 4.6 Les regards à 182 jours, code gelé de `9513e97`

93 runs, aucune décision n'en découle. Bras complet moins bras modifié, en médiane par graine, 30 graines, `normal`, 500 €. Les rapports suivent D126 : le bras en tête lit au-dessus de 1, quel que soit le signe.

| Bras | J60 | J120 | J180 |
|---|---:|---:|---:|
| Sans apprentissage | +140 €, 17/30, × 1,09 | +2 921 €, 21/30, × 1,25 | **+6 342 €, 26/30**, × 1,34 |
| TikTok seul | -173 €, 12/30, × 0,90 | +3 322 €, 22/30, × 1,21 | **+11 988 €, 28/30**, × 1,80 |
| ROAS moyen | -484 €, 5/30, × 0,83 | -2 982 €, 7/30, × 0,82 | -2 648 €, 12/30, × 0,91 |

Profit médian du bras complet : 3 053, 14 179, 27 916 €. Bras à J180 : 18 708, 15 176, 28 015 €. Aucune faillite d'aucun côté. CTR de la 2e moitié : 1,57 % sans apprentissage, 2,27 % avec ; angle 0,781 contre 0,925.

- **À J60, l'apprentissage ne se voit pas et les canaux perdent. À J180, les deux gagnent nettement.** Le bras complet mène de 140 € à J60 sur le bras sans apprentissage, dans le bruit, et TikTok seul le devance de 173 €. Un contrôle lu à J60 les aurait condamnés à tort.
- **Le gain de l'apprentissage à J180 vaut à peu près le bruit d'une paire** (6 341 €), mais 26 graines sur 30 vont dans le même sens.
- **`priceMove` a été regardé une fois,** puisque A1 manque : 3 mondes (graines 7, 11, 18) à J183, 105 produits en ligne. 77 guides à 0,97 en médiane du prix idéal caché, 1 au-dessus du maximum, 29 au-dessus de l'idéal, 39 en dessous, 8 sous 0,7 fois l'idéal. 28 kits à 0,33, par construction. A1 ne s'explique pas par des prix restés bas.

### 4.7 Les réserves de l'audit

Elles valent autant que les tableaux.

1. **Le gagnant a été décidé par un seul contrôle, dans son bruit.** E l'emporte à l'étape 3 parce qu'il passe K8, 27/30 et 2,06 pour 2,0 demandé. Relu sur le code de l'étape 4, celui de `9513e97`, qui lit 26/30 et 2,03 : jumeau placebo sur les mêmes graines 20/30 et 1,46 ; graines neuves 31 à 60 26/30 et 1,84 ; ces 60 graines ensemble 52/60 et 1,91, ou 53/60 et 1,97 avec les 30 de l'étape 3 ; un tirage neuf de 30 graines passerait K8 environ une fois sur trois. Si E avait raté K8, D gagnait ; si G l'avait passé aussi, G gagnait. E reste : D121 avait fixé la règle avant tout résultat, et ses K1 à K3 se répètent sur les graines neuves (23/30, 3 245 €, 0 et 0, bras `retest-winner` de l'étape 4). Sur le commit livré, K8 échoue.
2. **K7 et A10 échouent : la compétition existe et mord rarement.** Commit final : 4 remplacements en 30 entreprises sur 182 jours, 1 à J60, 4 à J180, médiane 0. Deux des quatre ont remplacé une personne sous la moyenne de sa famille, les deux autres une personne juste au-dessus. Une recrue sur quatre arrive sous cette moyenne, les trois autres au-dessus. Gain moyen de talent réel +0,14. La chaîne s'arrête au marché : D147 lisait 0,78 sur une famille de copie, graines 1 à 15, avant les bascules. Sur le commit final, le talent réel moyen de la ligue lit 0,76 en médiane à J182, et le marché reste à 0,52.
3. **« 0 faillite à J180 » est de nouveau vrai, et c'est l'assurance qui le fait.** `9513e97` lisait 0, `67a5152` lisait 2/30, les graines 5 et 20, exactement à la limite de K3. Le déclencheur de D117 (K3 ou K5 en échec) n'avait pas tiré : l'assurance a été construite parce qu'un fondateur qui lance une seule partie a environ une chance sur quinze de regarder une entreprise morte pendant des mois (D167). `fff9634` lit 0/30. Sans elle, le même code lit toujours 2 (§4.8).
4. **Une queue d'environ 1 graine sur 10 reste près de la mort.** Commit final : 5 graines à perte à J60 et les graines 3 et 14 à +1 et +3 €, 3 graines à perte à J120, 1 à perte à J180, avec 103 jours de survie à cette date. L'assurance les garde en vie, elle ne les guérit pas. Les médianes ne le montrent pas.
5. **La dernière course s'arrête à J60.** En `normal`, elle ne peut presque pas voir une faillite (§4.1). La solvabilité se lit sur 182 jours, et `cauchemar` n'a aucune lecture après J60.
6. **K6 est un contrôle de fraîcheur, pas de justesse.** `cash` et `ledgerCash` sont deux sommes des mêmes écritures, et un montant non fini est mis à zéro avant que le contrôle NaN ne le voie. K6 attrape un KPI en retard, pas un montant faux. `violations` est un vrai compte.
7. **L'allocateur au ROAS moyen est la règle de l'étape 4, lue à J60, et il a aussi retiré le plancher de ROAS de 1,15.** De J121 à J182 : ROAS médian 1,33 et 24 479 € de pub sur le commit final, 8 graines sous 1,2 ; 1,69 et 16 754 € sur `9513e97`, sous la règle marginale, 0 graine sous 1,2. Soit 46 % de pub en plus pour un profit qui reste dans le bruit : commit final moins `9513e97` à J180, -2 019 €, 13/30, tous les changements de S15 mêlés. Rien n'est prouvé après J60, pour aucune des deux règles.
8. **Le tempo est presque cosmétique.** Il a quitté le marché et le bandit, mais il change la longueur des plans (`TEMPO_SHOT`), donc le rythme, donc la note d'un film, donc son CTR : au plus ±1,6 %, sur une minorité de films.
9. **Les contrôles de l'étape 4 sont fermés (D149).** Ils décrivent l'entreprise d'avant les bascules. Aucun contrôle de mise à l'échelle n'existe sur le commit final : A1, A2 et A4 de scale n'y sont pas revendiqués. A3 y échoue (20/30, 1,92). A5 demande au plus le contrôle + 1 : avec 0 faillite à J180, il tient quel que soit le contrôle. Les trois bascules n'ont jamais été mesurées ensemble contre un contrôle.
10. **Les fichiers de résultats ne portent pas de tampon de commit.** Le banc `--json` et les runs de la lecture appariée n'en ont pas, à la différence des fichiers de calibration. Ce qui prouve leur code est un rejeu : les 150 runs ont été relancés sur l'arbre final (518 fichiers, tampon `cba37981…`), 150 sur 150 identiques, résultat complet et tests, hors durée et dossier. `npm run balance`, relancé sur `fff9634` pendant cette passe, redonne les graines 1, 2, 3 et 7 des trois difficultés à l'euro près.

Une partie dépend beaucoup de son chemin (première niche choisie, premiers avis, un événement au mauvais moment) : deux graines voisines peuvent finir à 9 490 € et à -170 € à J60 (graines 12 et 13). C'est voulu, c'est un marché, mais il faut juger un réglage sur 30 graines et contre un contrôle apparié, jamais sur une seule graine.

### 4.8 Le test sous la ligne (D167 à D173)

Tous les tableaux de cette section décrivent `fff9634`. La lecture a tourné sur `fad5554` plus 41 entrées non commitées (tampon `aa5d71e3…`, D169). Ses 150 runs ont été relancés sur l'arbre final (tampon `cba37981…`), égal à `fff9634` sur ses 518 fichiers, sauf `docs/v1/PLAN.md` : 150 sur 150 identiques (§4.7, point 10).

Jusqu'à `67a5152`, une entreprise qui tombait sous la ligne de survie sans pub qui tourne n'en sortait que par l'organique : graine 20, 113 jours de suite sans un euro de pub avec un produit vendable. L'assurance de D117 a été construite pour ça, et **elle est adoptée comme une assurance, pas comme un gain.**

**Ce qu'elle fait.** Sous la ligne (30 % du départ, 150 € ici), sans campagne qui tourne, l'agence lance un seul test à la fois : 5 €/jour pendant 6 jours au plus, 30 € en tout. Il faut une pub validée, aucun compte banni, aucune panne, aucun gel du fondateur, et au moins 30 € plus 7 jours de frais fixes et de paie encore due, soit 39,59 € pour l'équipe de départ. Aujourd'hui seul TikTok le permet : les autres canaux demandent plus de 5 € par jour. Le verdict tombe 6 jours après le lancement : un ROAS d'au moins 1,2 sur au moins 10 €, et le test devient une campagne comme les autres, sous la règle de survie. Sinon il s'arrête et le suivant attend 14 jours. Il y a une autre sortie : ce qui arrête un test avant son verdict le rate aussitôt, même s'il rapporte, sauf une panne, qui ne compte que comme un jour de repos. 2 des 41 tests fermés ont fini ainsi : `normal` graine 20, J102 → J106 ; `cauchemar` graine 9, J43 → J45, à 9,70 €. Les fondateurs ne se versent plus rien en survie (§3, Réserve et survie).

**Le bras `off` n'est pas « le même code sans le test ».** Un seul interrupteur, `control.noSurvivalTest`, retire le test et remet les fondateurs à 50 % en survie (D167). Aucun run ne sépare les deux : tout ce qui suit lit l'assurance entière, paie et test mêlés.

**La règle, fixée avant le résultat (D168).** Runs appariés sur le même code, assurance coupée (bras `off`) contre assurance en marche (bras `on`), `normal` 30 graines 182 jours, `cauchemar` 30 graines 60 jours, soit 120 runs, plus `facile` 30 graines 60 jours sur le bras `on` seulement. Adopté seulement si tout tient, sinon coupé par défaut, sans deuxième essai.

| Ligne | Demandé | Bras `off` | Bras `on` | Tient |
|---|---|---:|---:|---|
| 1. `normal` : graines au palier Survie à J182, ou jours de survie | de 2 à au plus 1, ou -30 % | 2 ; 296 jours | 1 (graine 20) ; 242 jours, -18,2 % | oui, sur sa première branche seule |
| 2. `normal` : faillites à J180 | pas plus que `off` | 2 (graines 5, 20) | 0 | oui |
| 3. `normal` : médiane à J60 et à J180 | au moins `off` moins 1 176 € et 6 341 € | 2 629,24 € ; 23 971,89 € | 2 629,24 € ; 24 864,78 € | oui |
| 4. `cauchemar` : K5 et faillites | K5 tient, faillites au plus `off` + 1 | 0 ; 293 € | 0 ; 630 € | oui |
| 5. K1, K2, K4, K6 | ils passent encore | 21/30, 2 629 €, pas de bras `facile`, 0/0/0 sur 60 runs | 19/30, 2 629 €, 26/30 et 0, 0/0/0 sur 90 runs | oui |

Aucune fuite : les 22 graines `normal` et les 14 graines `cauchemar` qui n'entrent jamais en survie sont identiques entre les deux bras, jusqu'au dernier octet des lignes. La graine `cauchemar` 13 aussi, avec son seul jour de survie.

**Ce que l'assurance change.**

| Lecture | Bras `off` | Bras `on` |
|---|---:|---:|
| `normal`, faillites à J180 | 2 | 0 |
| `normal`, clôture la plus basse | -15,94 € | 71,22 € |
| `normal`, plus long arrêt de pub avec un produit vendable | 113 jours | 15 jours |
| `normal`, jours sans pub avec un produit vendable | 485 | 326 |
| `cauchemar`, trésorerie médiane à J60 | 293 € | 630 € |
| `cauchemar`, profit médian à J60 | -207 € | +130 € |
| `cauchemar`, plus long arrêt de pub avec un produit vendable | 38 jours | 14 jours |
| `cauchemar`, en survie à J60 | 10 | 8 |

**Ces 2 faillites ne créditent pas le test.** Elles tiennent en peu d'argent : clôture la plus basse -8,39 € pour la graine 5, -15,94 € pour la graine 20. Avant sa première clôture négative, la graine 5 a versé environ 150 € de demi-paie aux fondateurs en survie, la graine 20 environ 270 €. C'est un calcul sur la paie de la semaine 1, pas un run. Sur le bras `on`, les tests de la graine 20 ont raté 6 fois sur 7. La paie seule a pu suffire, le test aussi : aucun run ne le dit.

**Ce que la règle ne lit pas.** En `normal`, sur l'argent, l'assurance ne montre rien. En `cauchemar`, 15 graines changent, 13 en hausse, 2 en baisse, somme +2 187 €, médiane +57 €. C'est sur 60 jours seulement, paie et test mêlés, sans aucune lecture après J60 : ce n'est pas un gain prouvé du test.

Graines `normal` qui changent :

| Graine | Trésorerie J182, bras `off` | Bras `on` | Écart |
|---:|---:|---:|---:|
| 5 | 417 € | 3 773 € | +3 356 € |
| 10 | 18 830 € | 30 470 € | +11 640 € |
| 14 | 27 610 € | 37 418 € | +9 808 € |
| 18 | 51 028 € | 46 431 € | -4 597 € |
| 20 | 104 € | 274 € | +170 € |
| 27 | 32 539 € | 30 586 € | -1 953 € |
| 29 | 16 493 € | 2 741 € | -13 752 € |
| 30 | 39 951 € | 24 936 € | -15 015 € |

- **4 en hausse, 4 en baisse, somme -10 344 €, médiane -892 €.** Une paire de runs a un bruit de 6 341 € à J180 : ces écarts ne prouvent rien, dans aucun sens. Les +893 € de la médiane à J180 viennent de la graine qui se trouve au milieu, pas d'un gain général.
- **La graine 29 perd 13 752 €, et on ne sait pas prouver pourquoi.** La revue du lundi lit la dépense d'un guide testé et l'a arrêté à J92, pour -11,56 € sur 28 jours, là où le bras `off` doublait la mise à J85. Mais un garde sur cet arrêt finit la graine à 3 575 €, loin des 16 493 € : il n'explique pas l'écart. La graine 30 perd 15 015 €, sans lecture non plus.
- **K1 tombe de 21 à 19**, sur les graines 18 et 30 : 1 918 → 952 € et 1 715 → 181 € à J60, chacune après un test raté. Aucun run n'isole la cause.
- **Le chemin coûte avant de rendre.** Médiane lue jour par jour : égale jusqu'à J62, derrière de J63 à J104 sauf J64, égale (-2 289 € au pire, à J81, encore -246 € à J104), égale ou à peine à côté de J105 à J118 (-103 € à J110, +347 € à J118). À partir de J119, elle n'est plus jamais derrière : devant, sauf J164 à J166 et J171, égale.
- **Trois graines passent plus de temps en survie avec le test :** 10, 29 et 30 (4 → 7, 41 → 61, 4 → 8 jours). Quatre en passent moins, la graine 14 reste à 3.
- **Les tests eux-mêmes :** `normal` 20 tests, 6 gagnés, 14 ratés, 562,50 € en tout, 29,03 € au plus. `cauchemar` 25 tests, 8 gagnés, 10 ratés, 7 encore ouverts à J60, 570,50 €.
- **Un test gagné peut être coupé le lendemain matin** par la règle de survie, qui lit les 4 derniers jours : graine 20, gagné à J167, coupé à J168 ; graine 29, J40 et J41. La graine 5, gagnée à J66, tombe à J69 sur l'enveloppe du CFO. C'est laissé ainsi exprès : c'est la règle écrite, mesurée par la lecture, et une refonte serait le deuxième essai que D168 ferme. D172 l'écrit comme un jugement, pour qu'il puisse être contesté : qui le lit comme un défaut doit reprendre l'autre moitié de la règle, le correctif touche l'argent et le bras n'est alors plus adopté.
- **`facile` n'est pas strictement inchangé.** Les graines 14, 18 et 30 y entrent en survie (10, 3 et 5 jours) et lancent 3 tests. Sans bras `off` en `facile`, l'effet ne se lit pas.

**Verdict (D173) :** adopté, `control.noSurvivalTest` reste éteint, les fondateurs prennent 0 en survie, un test tourne sous la ligne. Rien de ce qui a suivi la lecture ne touche l'argent : les 150 runs relancés sur l'arbre final sont identiques.

## 5. Lancer le banc d'essai

```bash
cd server
npm run balance                                   # graines 1,2,3,7,42 × 60 jours × facile, normal, cauchemar
npm run balance -- --open-ended                   # sans fin, comme le produit et comme chaque bras de la calibration
npx tsx scripts/balance.ts --days 60 --seeds 1,2,3,7,42 --difficulties facile,normal,cauchemar
npx tsx scripts/balance.ts --seeds 1,2,3,4,5,6,7,8,9,10,11,42 --jobs 8      # pour regarder un réglage de plus près
npx tsx scripts/balance.ts --days 182 --seeds 1,2,3 --difficulties normal --open-ended --jobs 3   # la solvabilité se lit sur 182 jours
npx tsx scripts/balance.ts --set ADS.baseCtr=0.006 --set DIFFICULTY.cauchemar.cpmMultiplier=1.5   # essayer une constante sans modifier le code
npx tsx scripts/balance.ts --seeds 7 --difficulties normal --keep --details  # garder le run (runs/bench-normal-7, chargeable dans l'UI)
npx tsx scripts/balance.ts --json resultats.json  # résultats détaillés, jour par jour
npx tsx scripts/balance.ts --no-hire              # bras de contrôle ; aussi --no-payroll et --team legacy31
```

Chaque commande ci-dessus a été lancée sur `67a5152`, sur quelques jours ou en entier. Sur `fff9634` ont tourné `npm run balance` et `--open-ended`, à 10 processus, et `--details` sur une graine. Aide complète : `npx tsx scripts/balance.ts --help`.

**Temps mesurés sur `67a5152` :**

| Commande | Processus | Durée |
|---|---:|---:|
| `npm run balance`, 15 runs de 60 jours | 3 (défaut) | 132,5 s |
| `npm run balance -- --open-ended`, 15 runs | 10 | 74,9 s |
| 60 runs de 60 jours, `facile` et `cauchemar` | 6 | 650,7 s |
| 30 runs de 182 jours, `normal` | 12 | 757,1 s |

Sur `fff9634`, à 10 processus : 77,7 s sans `--open-ended`, 77,8 s avec, et les deux tables sont identiques. Sur `11b3f20`, `--open-ended --jobs 6` a pris 97,1 s. Un run de 60 jours prend environ 50 s pour une entreprise qui marche : de 12 à 53 s à 10 processus, de 19 à 97 s à 6 processus. Un run de 182 jours a pris de 68 à 407 s à 12 processus.

- Chaque run est une vraie entreprise sans interface (une équipe fondatrice de 8 agents qui recrute quand les chiffres le demandent, cerveau heuristique, PDF et pages de vente réellement générés, pas de film) dans un dossier temporaire supprimé à la fin, sauf avec `--keep`. Les runs tournent dans `--jobs` processus (3 par défaut, 16 au plus ; `--jobs 1` = tout dans le même processus, mêmes résultats). Le mode `claude` n'est jamais utilisé par le banc (aucune clé n'est transmise).
- `--open-ended` retire l'échéance, comme le produit. Sur ces 15 runs de 60 jours, le résultat est le même avec et sans (vérifié sur `fff9634`). Avec une échéance, la ligue s'arrête 10 jours avant la fin : un bras de calibration tourne donc toujours sans fin (D125).
- Colonnes : **J>0** = premier jour où le profit cumulé (frais de démarrage compris) passe au-dessus de 0 ; **Objectif** = premier jour à 1 000 € de profit cumulé ; **Faillite** = au moins une clôture négative, remontée ou non ; **Prod. L/A** = produits en ligne / arrêtés ; **ROAS 1→2** et **CTR 1→2** = pubs payantes de la première puis de la seconde moitié du run (↑ = mieux en 2e moitié) ; **CTR neuf** = TikTok, créations sous 30 000 impressions ; **Angle** = accroche × format de ce qui a tourné, rapporté au meilleur couple de la niche ; **Remb.** = part des commandes remboursées ou contestées ; **Leçons** = leçons chiffrées écrites dans le cerveau ; **Effectif** = agents le dernier jour ; **Masse salariale**, **Embauches**, **Départs** sur tout le run ; **Survie** = jours sous la ligne du CFO ; **Violations** = invariants d'organisation rompus.
- **Artefacts** surveillés : **F** = falaise (le profit cumulé perd plus de 40 % d'un pic ≥ 100 € en moins de 7 jours ; `--details` liste la chaîne qui l'explique : événements du marché, jours de pub sans vente, vagues de remboursements) ; **S** = plus de 2 jours sans pub alors qu'il reste plus de 30 % de la trésorerie de départ, un produit vendable et un compte pub actif ; **K** = KPI du jour ≠ somme du grand livre ; **N** = valeur non numérique.
- `--set CHEMIN=N` remplace le temps du banc une constante du marché ou d'un pilier (`docs/v1/PLAN.md` §2.9). Un chemin inconnu est une erreur, pour ne jamais mesurer le marché par défaut sans le savoir.
- Les tests `server/test/balance.test.ts` vérifient aussi qu'un run de quelques jours fonctionne en mode **validation fondateur** (la mise en ligne attend le fondateur ; en approuvant, le guide passe en ligne) et en mode **`claude` sans clé** (repli heuristique, exactement le même run).

**Les autres outils :**

| Commande (dans `server/`) | Ce qu'elle fait |
|---|---|
| `npx tsx scripts/golden.ts --check` | Compare le run de référence à son empreinte (`b6b0ec5a…` sur `fff9634`) |
| `npx tsx scripts/autonomy.ts --seeds 1-30 --days 90` | Lignes A8 et A9 : l'agence tourne seule, sans action du fondateur |
| `npx tsx --max-old-space-size=500 scripts/longrun.ts --days 365 --seed 7` | Ligne A6 : un an, sous plafond de mémoire, sort en code 1 tant que le p95 d'une journée dépasse sa cible |
| `npx tsx scripts/pdfSheet.ts --run <id>` | Ligne A16 : planches d'images des guides d'un run |
| `npx tsx scripts/calibrate.ts --step 5` | Rassemble le bloc du §4.5. `--step 4` refuse depuis D149 : le contrôle a tourné une fois et ses règles ont retiré du code ce que ses bras nomment |

## 6. Critère de sortie de la phase 1 (passage à la phase 2 de `docs/ROADMAP.md`)

Ce critère a été écrit avant la V1, pour l'ancienne équipe fixe. Il reste ici tel qu'il a été écrit. Il n'est pas réécrit pour qu'il passe.

La phase 2 (« réel en lecture seule ») ne commence que si, sur la version à livrer :

1. `npm run balance` (graines 1, 2, 3, 7, 42, 60 jours, 500 €) donne :
   - en `normal` : profit cumulé positif **avant le jour 40** sur au moins 4 graines sur 5, et toujours positif au jour 60 sur au moins 4 sur 5 ;
   - en `cauchemar` : **aucune faillite** sur au moins 3 graines sur 5 ;
   - l'apprentissage visible (CTR **et** ROAS meilleurs en 2e moitié) dans au moins 70 % des parties `normal` + `cauchemar` ;
   - zéro arrêt de pub, zéro écart KPI / grand livre, zéro NaN, et aucune falaise sans chaîne d'événements.
2. Les mêmes chiffres tiennent à peu près sur 15 graines (médiane `normal` entre 1 000 et 3 000 €, aucune faillite en `normal`).
3. `npx tsc -p server/tsconfig.json`, `npx tsc -p web/tsconfig.json` et `cd server && npx vitest run` sont verts.

### Lecture sur le commit final

**État de cette version, `fff9634` : critère non rempli, à la lettre. Trois lignes échouent : l'apprentissage visible (40 % pour 70 %), les arrêts de pub (2 pour 0) et une falaise sans chaîne d'événements (1 pour 0).** Cette troisième ligne tenait sur `67a5152`. La ligne 1 lit `npm run balance` (15 runs, les mêmes avec et sans `--open-ended`, vérifié sur `fff9634`). La colonne de droite lit les 30 graines de la dernière course et du relevé de 182 jours, qui sont plus nombreuses que les 15 demandées et plus sévères que les 5 du banc.

| Ligne du critère | Cible | 5 graines, 60 jours | Verdict | 30 graines |
|---|---|---|---|---|
| `normal` : positif avant J40 | au moins 4/5 | 5/5 (J12, J13, J15, J23, J37) | tient | 21/30 |
| `normal` : positif à J60 | au moins 4/5 | 5/5 (la graine 3 à +1 €, la graine 42 à 895 €) | tient | 25/30 |
| `cauchemar` : aucune faillite | au moins 3/5 | 5/5 (la graine 42 finit à 314 € après 20 jours de survie) | tient | 30/30 à J60 |
| Apprentissage visible, CTR **et** ROAS | au moins 70 % | **40 %** (CTR 60 %, ROAS 60 %, 10 parties) | **échoue** | 63 % sur 60 parties |
| Zéro arrêt de pub | 0 | **2** (`normal` 3, `cauchemar` 2) | **échoue** | 20 arrêts sur 19 des 90 runs, de 3 à 6 jours chacun, au sens du détecteur S (§5) |
| Zéro écart KPI / grand livre | 0 | 0 | tient (K6, §4.7) | 0 sur 90 runs |
| Zéro NaN | 0 | 0 | tient | 0 sur 90 runs |
| Aucune falaise sans chaîne | 0 | **1 sans chaîne sur 2** (`normal` 42, J38 → J40, 105 € → 62 €, aucun événement ; `facile` 3 expliquée) | **échoue** | **5 inexpliquées sur 26**, sur 90 runs |
| Médiane `normal` entre 1 000 et 3 000 € | sur 15 graines | 4 625 € sur 5 graines, trop peu pour lire une médiane | tient sur 30 graines | 2 629 € |
| Aucune faillite en `normal` | sur 15 graines | 0/5 à J60 | tient à J60 et à J180 | 0/30 à J60, 0/30 à J180 |
| Types et tests | verts | voir `docs/v1/ACCEPTANCE.md`, A1 et A2 | tient | — |

**Pourquoi la lecture ROAS baisse quand l'entreprise monte.** C'est ce que disent les données, sur 30 graines, `normal`, commit final :

| Médianes | Jours 1-91 | Jours 92-182 | Mieux en 2e moitié |
|---|---:|---:|---:|
| Dépense pub | 9 793 € | 33 498 € | |
| ROAS | 1,67 | 1,39 | 13 % des graines |
| CTR | 2,16 % | 2,44 % | 70 % |
| CTR neuf | 2,52 % | 2,97 % | 90 % |
| Angle | 0,86 | 0,93 | 100 % |

Ce que l'agence met en vitrine devient meilleur, et chaque euro de plus rapporte moins. Trois raisons :

- **La saturation.** Une niche n'absorbe qu'un nombre limité de visiteurs par jour. Entre les semaines 9 et 26, la pub est multipliée par 2,7 et le chiffre d'affaires par 1,7.
- **La règle de l'allocateur.** Le ROAS moyen répartit l'enveloppe sans plancher : une ligne qui rapporte peu garde sa part (§4.7, point 7). L'enveloppe n'est pas forcément dépensée : une ligne s'arrête à 60 %, bouge d'au plus ±30 % par jour, et ce qu'elle laisse ne va pas aux autres. Graine 42, J116, lu sur `67a5152` : enveloppe 1 455 €, budgets du jour 414 €. La part laissée n'a pas été mesurée sur 30 graines.
- **La chance à J60.** Sur 60 parties, les graines où le ROAS baisse ont multiplié leur dépense par 4,20, celles où il monte par 3,45, pour 16 et 44 parties. L'écart est faible et ne prouve pas la saturation : la baisse à J60 est aussi le souvenir d'une première moitié heureuse.

**Cette ligne ne sépare pas assez ce qu'elle veut séparer.** Bras appariés de l'étape 4, code `9513e97`, 30 graines `normal` :

| Part des graines meilleures en 2e moitié | Avec apprentissage | Sans apprentissage |
|---|---:|---:|
| CTR **et** ROAS, J60 | 50 % | 37 % |
| CTR **et** ROAS, 182 jours | 30 % | 13 % |
| CTR neuf **et** angle, J60 | 70 % | 40 % |
| CTR neuf **et** angle, 182 jours | **97 %** | **50 %** |

Avec tout l'apprentissage en marche, une entreprise qui monte en dépense n'atteint pas 70 % sur la ligne écrite : 50 % à J60, 30 % sur 182 jours. Sur `fff9634`, en `normal` : 53 % à J60, 13 % sur 182 jours.

**Les meilleures lectures proposées, à côté du critère, sans le remplacer :**

| Ligne écrite | Pourquoi elle ne convient plus | Lecture proposée | Ce qu'elle lit aujourd'hui |
|---|---|---|---|
| Apprentissage visible, CTR et ROAS, 70 % | Elle mesure l'échelle autant que l'apprentissage | Contrôle apparié `control.noLearning` à 182 jours, positif sur au moins 19/30 ; et en lecture simple, CTR neuf et angle meilleurs sur au moins 70 % des runs de 182 jours | +6 342 €, 26/30, sur `9513e97` seulement ; 90 % sur `fff9634` |
| Zéro arrêt de pub | Écrite pour une équipe sans paie. Aujourd'hui une réserve du CFO peut couper la pub (D9), et le détecteur S ne compte pas les jours sous 30 % du départ. La cause de ces 20 arrêts n'a pas été lue | Aucun arrêt de plus de 7 jours avec un produit vendable et plus de 30 % du départ en caisse | 6 jours au plus, sur 90 runs. **Sans la condition de trésorerie, la lecture échoue encore :** 6 runs sur 90 passent plus de 7 jours sans pub avec un produit vendable, jusqu'à 15 jours (graine 20). C'étaient 16 runs et 113 jours sur `67a5152`, avant l'assurance. Hors jours de survie, le maximum reste 6 jours |
| Aucune faillite, lue à J60 | En `normal`, la fenêtre finit avant les premières clôtures négatives | K3 : au plus 2 sur 30 à J180 | 0/30 |

Ces lectures sont des propositions : une lecture choisie après le résultat ne prouve rien, et le contrôle apparié n'existe pas sur le commit final.

**La phase 2 reste la décision du fondateur.** Ce document donne les chiffres, il ne décide pas. Le critère écrit échoue sur trois lignes, et il reste écrit.

## 7. Limites connues

Ce qui reste vrai sur `fff9634`, lu dans le code ou à l'écran. Un nombre sans commit vient d'une lecture plus ancienne et n'a pas été recompté. Les réserves sur les chiffres sont au §4.7 et au §4.8, chaque ligne d'acceptation dans `docs/v1/ACCEPTANCE.md`. Le code n'a pas bougé après ce commit : ces défauts restent ouverts.

**Marché et argent**

- Le vrai plafond est le réservoir de chaque niche : le candidat G, qui le doublait, n'a pas gagné. Le chiffre d'affaires plafonne près de 4 600 € par semaine et retombe après J180 (D106, lu avant le gagnant E, sur 8 graines : 0,84 de la base à J270, en baisse sur 7). Personne n'a lu plus loin.
- Levier `buying` négatif, levier `copy` dans le bruit (§4.5).
- L'organique pèse peu : 176 à 180 posts en 60 jours, 11 à 13 % des tâches d'une partie qui vend, 22 % de celle qui ne vend pas (4 runs sur `67a5152`), pour 1,28 % du chiffre d'affaires sur 182 jours et 3,9 % sur les 8 premières semaines (30 graines, `fff9634`). Personne n'y a touché.
- Les arnaques au support ne coûtent presque rien à l'agence : 0 € de `scam_loss` sur 4 runs de 60 jours sur 4 (`67a5152`, `cauchemar` 1 et 103, `normal` 29 et 102).
- Un film garde le prix avec lequel il a été monté (D131).

**Le mode survie**

- Le test sous la ligne est une assurance, pas un gain : §4.8. Un test gagné peut être coupé le lendemain, et la revue du lundi lit la dépense d'un guide testé et peut l'arrêter (D172).
- Une entreprise reste vivante sans guérir : graine 20, 103 jours de survie sur 182. À la clôture de J130, 4 tests, aucun gagné, 114,40 € en caisse, encore au palier Survie.
- Les tests s'arrêtent quand les pubs validées manquent : aucune accroche neuve ne s'écrit sous la ligne. Seul TikTok peut porter un test, donc un gel du fondateur sur TikTok veut dire pas de test.
- La page Publicité ne marque pas une campagne comme test. Seuls le journal, le résumé et Croissance le disent.
- « Survie » veut dire deux choses à l'écran. Le palier 1/4 s'appelle Survie, même à J18 avec 611 € et +111 € de profit, et le mode survie veut dire une caisse sous 30 % du départ. La graine 20 revient au palier Survie à J50, le mode survie se lève à J61 à 151,57 €, et le palier ne bouge pas.
- Le grand nombre de la tuile « Trésorerie » du résumé est la variation, pas le solde : « −361,52 € », avec « 500 € → 138,48 € » en petit dessous. Le plus gros chiffre d'une entreprise en survie est donc une perte, et sa caisse passe au second plan.
- Non vérifiés : un rechargement pendant qu'un test attend le oui du fondateur, un rechargement un jour de panne pendant un test. Le jour de panne lui-même est tenu par un test du code, et un rechargement à chaque tick autour d'un test a été vérifié, graine 20, J60 à J70.
- En mode Claude, `mergePlans` peut remplacer le test par une action de même guide : `itemKey` ne lit pas `underLine`. Lu dans le code, jamais lancé.

**Ligue**

- Les compétences aveugles ne peuvent pas être remplacées : `design`, `support`, `buying`, `research`, `polish`. Un plan raté y finit sans candidat.
- Le talent de `polish` ne change plus sa propre production (D144).
- `shots`, dans un fichier de film, resserre un peu la bande de talent d'un monteur (D129).
- La fiche d'un agent dit « pas encore noté » sous Performance, à côté de « note 1 502 » dans Carrière : ce sont deux notes différentes, et rien ne le dit.

**Les ordres du fondateur**

- Le « plafond » de la semaine ne plafonne pas, alors que le fondateur lit « Plafond / jour » et « La pub peut monter jusqu'à X €/jour cette semaine ». `adTarget` est de la place pour grandir, seule l'enveloppe du jour tient (A22). Graine 42, semaine 6 : plafond 19,53 €, dépense moyenne 42,9 €, maximum 48,6 €. Graine 4, semaine 9 : 177,96 €, 233,4 €, 291 €. Graine 9467, semaine 5 : 26,77 €, 55,5 €, 81,5 €.
- Un ordre de baisse pose un plafond qui s'arrête au lundi suivant du CFO, pas avec le gel, et « reprends les pubs » rouvre le neuf en laissant ce plafond (D166).
- « reprends les pubs » n'est un ordre que quand un arrêt ou un gel tient. Sans rien d'arrêté, la phrase ouvre une mission qui commande de nouvelles pubs : graine 42, J31, `write_ad_hooks`, `produce_ad`, `launch_campaign`, sur `fff9634`.
- « Rien à baisser » sans campagne ne pose rien, c'est voulu, mais la réponse ne le dit pas : graine 9467, ordre à J18, une campagne à 14 €/jour démarre à J19.
- En mode `heuristic`, une mission se lit par mots-clés, pas par le sens. « Baisse le budget de pub » et sa famille sont réglés, 0 pub commandée sur 27 phrases (D166), mais « Baisse le budget pub, on a une perte de 50 euros » échoue sur « aucun guide sur perte », et « baisse le prix de la pub » commande un changement de prix et des pubs. Seul le libellé demandé a été rejoué à l'écran, deux fois (N1).
- Un ordre exécuté à côté d'une demande ratée laisse la mission `failed` : le titre d'une notification peut dire « ne peut pas s'en charger » au-dessus de « C'est fait ».
- Une mission qui nomme des créateurs sans nommer de guide se ferme comme faite.
- Une mission qui nomme un canal ne l'ouvre que par `keywordMission`.
- Le temps des expressions régulières sur un très long texte de mission n'a pas été mesuré.

**Le fondateur et l'entreprise**

- Un arrêt est daté par le jour du séjour suivant, réécrit à sa fin : deux arrêts de suite, à J131 puis à J132, disent deux fois « Jour 132 », et un arrêt peut sortir de la bonne fenêtre du résumé.
- Le texte du CFO dit « 0 €/jour de pub dépensés sur 7 jours » à J4, quand le run a 4 jours.
- Les jours calmes retirent les mots de progrès du fil, pas la confiance que la rétro continue de monter (D95).
- Un serveur peut ouvrir un run qu'une commande en ligne écrit encore.
- Un Ctrl+C à la main dans un terminal Windows n'a pas été essayé. Le même signal, envoyé à une console cachée sur `67a5152`, a sauvegardé le run et libéré le port. Les arrêts brutaux sont sûrs (A27), donc au pire c'en est un.
- Le mode Claude n'a jamais été appelé en vrai : aucune clé n'a servi.

**Guides et pages**

- Les guides se répètent par construction : 49,7 % des mots imprimés se trouvent aussi sur une autre page, l'arbre de décision reprend les situations mot pour mot.
- Un guide garde parfois le lien vers la v1 d'une suite republiée : la page s'ouvre, mais sur la v1 (graine 4, `prd_173` vers `prd_1425`, 1 guide sur 37).
- Le lien de la dernière page d'un guide reste relatif à la partie (`/runs/<id>/files/…`) : il devrait être mort dans un PDF téléchargé. Il attend la vraie boutique, qui fixera son adresse (`docs/ROADMAP.md`, phase 3). Lu dans le fichier, pas cliqué dans un lecteur extérieur.
- « 1 avis vérifiés » sur une page de vente : 11 pages sur 70 sur les graines 4, 7 et 42.
- Une checklist de kit se coupe entre deux pages : titre et une case en bas de page, deux cases sans titre en haut de la suivante (graine 4, `prd_9619`, p. 7 et 8).
- Des avis sur des kits disent « Le chapitre », 4 sur 23 : ce sont les mots des clients simulés, laissés tels quels (D165).
- La voix de secours `STD_VOICE`, celle des polices absentes, n'a pas été rendue sur un kit ni sur une page arrêtée.
- La ligne « Novembre » de la fiche URSSAF n'a pas de date.
- La fixture de démonstration contient des adresses générées sur de vrais domaines.

**Films**

- Le son est jugé par le volume et les silences seulement. Personne n'a écouté un film : une personne doit le faire une fois.
- Les films citent un « Avis d'acheteur » cinq étoiles écrit sur aucune page : la citation vient du champ caché `basis`, que les vues publiques retirent, pas du texte que la boutique affiche (D93). Sur les graines 4, 7 et 42, 98 passages viennent de 4 phrases, dont « Je craignais un énième PDF générique » 24 fois, sur des produits différents, alors que la boutique dit ne jamais afficher de faux témoignages. Tout est simulé aujourd'hui, mais ce serait un témoignage mal attribué le jour d'un passage au réel.
- Le zoom sur une page coupe le début de la phrase surlignée, « mmence par là », et le chiffre d'une étape. À 4:5, le badge ÉTAPE 1 mord les premières lignes de la page.
- Une partie des zones de sécurité vient d'outils tiers, à vérifier dans les applications avant tout réel.
- Crête réelle -0,3 dBFS dans le pire film, pour -2,5 demandés.
- Au premier rendu, un diaporama dépasse sa durée estimée de 31 %.
- Chez un monteur faible, l'accroche arrive après le carton-titre.
- Les storyboards SVG n'ont pas reçu le nouveau dessin.

**Tenue et marges**

- A6 échoue sur un seul nombre : le p95 d'une journée, 1 048 ms pour 800, sur `fff9634`, machine calme. `renderPdf` pèse 28,9 % de la bande de journées qui fixe ce p95 (`perf.json`). Il n'y a pas de petite correction : soit une décision qui amende la cible, soit sortir le rendu PDF de la boucle du jour.
- Les marges d'une année sont minces sur dix graines, lues sur `fff9634` : direct 399,3 kB sur 400, dossier 143,0 MB sur 150, `/api/state` 685,0 kB sur 700, et 226,4 s sur 240 pour la graine 7, sur une machine calme.
- La compaction peut laisser partir le premier signataire d'une carte d'avis, qu'un film montre encore (D131, D137).
- L'échelle de coupes du plan n'a pas servi (D65).
- `docs/v1/talent.md` n'a pas été réécrit là où les décisions l'ont dépassé : `docs/v1/PLAN.md` §8 fait foi.

## 8. Chantier design

Le chantier design (`docs/design/PLAN.md`, D200 à D209) donne aux agents huit styles de couverture, six gabarits de page et cinq visuels, un goût caché du marché pour ces looks, neutre en moyenne (D201), des bandits, des tests A/B de page et des refontes (D203, D204). Deux témoins existent : `control.designV1`, les looks de la V1 sur un marché qui ne les lit pas, et `control.noDesignLearning`, les looks tirés au hasard sans test, leçon, règle ni refonte (D205). Tout ce qui suit est lu sur `8355c93`, sauf le §8.4 (après les corrections D211), cerveau heuristique, 500 € de départ. Le goût caché n'est lu que par les scripts de mesure, jamais par un agent.

### 8.1 La lecture de contrôle qui inquiétait, et ce qu'elle était

**Ce qu'elle disait.** Graines 1 à 3, `normal`, 120 jours : le bras par défaut finit à 20 175, 15 694 et 20 657 €, le bras `noDesignLearning` à 24 859, 22 608 et 41 557 €. Apprendre les looks perdait contre les looks au hasard, de 4 684, 6 914 et 20 900 €. Ces six runs ont été refaits avec un pilote qui note tout chaque soir : mêmes nombres à l'euro près.

**Ce que les deux bras font de différent, graine par graine.**

| Lecture (défaut / `noDesignLearning`) | Graine 1 | Graine 2 | Graine 3 |
|---|---:|---:|---:|
| Profit cumulé à J60 | 7 664 / 9 180 € | 1 761 / 4 691 € | 2 131 / 9 068 € |
| Profit cumulé à J120 | 20 175 / 24 859 € | 15 694 / 22 608 € | 20 657 / 41 557 € |
| Guides lancés à J60 | 11 / 16 | 13 / 14 | 11 / 16 |
| Chiffre d'affaires sur 120 jours | 60 567 / 67 774 € | 40 404 / 58 984 € | 54 767 / 101 022 € |
| Pub sur 120 jours | 31 201 / 33 248 € | 18 465 / 27 962 € | 25 245 / 46 119 € |
| Visiteurs payés | 91 375 / 92 270 | 47 484 / 80 585 | 64 474 / 115 485 |
| Facteur de conversion des looks portés, pondéré par les visiteurs (vérité) | 1,007 / 1,052 | 0,958 / 1,007 | 1,007 / 1,050 |
| Facteur de clic des looks, pubs dont l'image est la couverture (vérité) | 1,039 / 1,040 | 0,967 / 1,031 | 1,008 / 0,969 |
| Guide-jours sur le meilleur style de la niche | 29 / 19 % | 12 / 11 % | 20 / 11 % |
| Guide-jours sur le meilleur gabarit de la niche | 9 / 14 % | 11 / 28 % | 17 / 27 % |
| Tests de prix | 4 / 11 | 4 / 9 | 4 / 11 |
| Tests de format | 13 / 17 | 10 / 20 | 9 / 17 |
| Tests de page, gagnés | 7, 0 | 6, 0 | 4, 0 |
| Jours avec un test de page en cours | 90 | 81 | 50 |
| Jours où les deux places de test sont prises | 102 / 59 | 98 / 85 | 103 / 71 |
| Refontes | 4 | 3 | 0 |

- **Les refontes ne retirent rien.** 7 refontes sur les trois graines : 0 jour hors vente, 2 jours sans pub en tout, aucun guide arrêté ni mis en pause dans les 14 jours qui suivent, les avis gardés (un guide passe de 36 à 39 puis 56 avis à travers la sienne). Elles coûtent 21 créneaux d'agents sur 7 554 (0,3 %). Leur look valait 1,033 en conversion la veille et 0,967 le lendemain, 1,016 et 1,006 sur les 24 refontes des graines 1 à 10 : elles se déclenchent sur du bruit (15 % d'écart sur 400 visiteurs, environ 8 ventes) et ne gagnent rien en look. Une refonte est pourtant une version, comme une v2 : elle relance les fenêtres de la version (ses propres avis, 7 jours avant qu'un guide puisse être arrêté, 14 jours avant la règle de perte, un test payant à refaire avant tout verdict), et la remise en ligne coupe la pression des copieurs de la niche (`refreshRivals`). Rien ne mesure ce que pèse chacun de ces effets.
- **Les tests de page prennent une place.** `run_experiment` n'ouvre rien quand deux tests tournent, et un test de page dure 14 jours, puis le suivant s'ouvre : il occupe une des deux places 42 à 75 % des jours, les tests de prix tombent de 9 à 11 à 4 par graine. Sur la variante la moins bonne (vérité), les tests de page ont perdu 66 ventes en tout. 3 des 17 ont partagé leur guide avec un test de prix, 7 jours : deux alternances par jour sur le même guide, chacune lit l'autre.
- **Ce qui creuse l'écart, ce sont les premiers looks tirés.** Les deux bras tirent sur `STREAM.design` : au premier guide, le bandit n'a rien mesuré, son tirage vaut un tirage au hasard, mais ce n'est pas le même. Graine 2, premier guide (oral d'aide-soignante, en ligne à J4 des deux côtés) : collage, `inside`, `devices` côté défaut, facteur 0,848 en conversion et 0,886 en clic ; bauhaus, `editorial`, `devices` côté témoin, 0,949 et 1,013. De J1 à J60 : 128 € de pub, 203 visiteurs, 3 ventes, contre 746 €, 1 642 visiteurs et 41 ventes. Graine 3, premier guide (propreté du chiot, J4) : grille, facteur de clic 0,916, contre pop, 1,067 ; de J1 à J45, 446 € de pub et 23 ventes contre 1 714 € et 175, et le premier test de prix monte (24 contre 29 €) d'un côté, descend de l'autre (24 contre 19 €, gagné par 19 €). Le reste suit : moins de caisse, moins de guides lancés, moins de pub.

**Les bras de démontage.** Sur une copie de l'arbre, hors dépôt, un interrupteur à la fois : sans test de page (`nopage`), sans refonte (`norefresh`), looks tirés au hasard mais tout le reste en marche (`randomlook`), tests de page hors des deux places et jamais sur un guide dont le prix est en test (`freepage`). La copie sans interrupteur refait la graine 1 à l'euro près. Graines 1 à 10, 120 jours, profit cumulé à J120 :

| Graine | `noDesignLearning` | Défaut | `nopage` | `norefresh` | `randomlook` | `freepage` |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 24 859 € | 20 175 € | 17 521 € | 24 270 € | 18 614 € | 24 163 € |
| 2 | 22 608 € | 15 694 € | 14 007 € | 11 355 € | 19 326 € | 12 179 € |
| 3 | 41 557 € | 20 657 € | 19 456 € | 20 657 € | 28 438 € | 19 695 € |
| 4 | 13 758 € | 23 861 € | 16 490 € | 17 747 € | 30 937 € | 22 248 € |
| 5 | 2 236 € | 56 € | 56 € | 56 € | 2 194 € | 56 € |
| 6 | 17 046 € | 21 822 € | 21 036 € | 16 275 € | 18 496 € | 25 568 € |
| 7 | 26 911 € | 36 307 € | 29 641 € | 27 813 € | 26 988 € | 33 277 € |
| 8 | 16 951 € | 16 322 € | 14 543 € | 13 863 € | 24 538 € | 11 685 € |
| 9 | -328 € | 290 € | 1 194 € | 308 € | -328 € | 843 € |
| 10 | 7 438 € | 30 887 € | 16 330 € | 23 533 € | 7 117 € | 26 358 € |
| Écart apparié au témoin, médiane | — | -5 € | -329 € | -680 € | -21 € | +237 € |
| Positif sur | — | 5/10 | 5/10 | 4/10 | 4/10 | 5/10 |
| Écart apparié au défaut, médiane | — | — | -1 733 € | -3 399 € | +760 € | -1 288 € |

- **Sur dix graines, l'écart disparaît** : -5 € de médiane à J120, 5 graines sur 10 en faveur du défaut, +1 304 € en moyenne. Les graines 4 à 10 vont au défaut 5 fois sur 7 (+10 103, +4 776, +9 396, +618, +23 449 €, puis -2 180 et -629 €). La lecture de contrôle avait tiré les trois pires graines sur les dix.
- **Aucun interrupteur ne referme l'écart des graines 1 à 3.** Sans test de page, 17 521, 14 007 et 19 456 € ; sans refonte, 24 270, 11 355 et 20 657 €. Les looks au hasard, qui reprennent les premiers tirages du témoin, rattrapent l'essentiel de J60 sur les graines 2 et 3 (4 919 et 7 925 € contre 4 691 et 9 068 €) : c'est la chance des premiers looks, pas un mécanisme.
- **Retirer les tests de page ou les refontes ne rapporte rien** : sans test de page, 8 graines sur 9 qui changent finissent sous le défaut ; sans refonte, 6 sur 8. Sur les dix graines, le défaut fait 54 tests de prix et 113 tests de format, le témoin 86 et 158, le bras sans test de page 74 et 165 : les tests de page en prennent la place, et l'argent ne le montre pas.
- **Le bandit choisit à peine mieux que le hasard.** Graines 4 à 10, lus contre le goût caché : styles choisis par le bandit 1,016 en moyenne, le meilleur de la niche 23 % du temps ; au hasard 1,004 et 11 %. Gabarits : 1,008 et 20 % contre 0,989 et 16 %. Le classement du bandit en fin de run suit la vérité à 0,00 pour les styles (7 niches) et à 0,19 pour les gabarits (17 niches), en corrélation de rang. Au lancement, sur dix graines, les looks valent 0,999 en conversion côté défaut et 1,004 côté témoin.

**Verdict de la phase 1 : pas de défaut à l'origine de l'écart, rien n'est corrigé pour lui.** L'écart des trois graines est la dépendance au chemin : un premier look un peu moins bon, un premier guide qui vend moins, moins de caisse, moins de guides. Trois défauts réels sont apparus en chemin, et aucun n'explique l'écart (D210, D211) :

1. **Les conventions de gabarit n'atteignent jamais les agents.** D203 lève les gabarits de la convention du genre de 12 %, par archétype de guide (§5 du plan). `shelfOf` lit l'archétype dans la recherche de l'entreprise, que l'outil de recherche ne remplit jamais : sur les 78 niches des graines 4 à 10, il est vide partout, alors que l'agence écrit chaque guide dans un archétype qu'elle connaît. Côté style la convention vaut cher : style de convention 1,077 en moyenne, neutre 0,983, opposé 0,910, et le meilleur style de la niche est une convention sur 75 niches sur 78.
2. **Un test de page prend une des deux places de test pendant 14 jours**, et les tests de prix tombent de 37 % (54 contre 86 sur dix graines).
3. **Un test de page et un test de prix peuvent tourner sur le même guide** : 14 des 47 tests de page, 27 jours, et 13 des 54 tests de prix. Les deux alternent chaque jour, chacun mesure aussi l'autre.

Les deux derniers ne coûtent rien de mesurable (bras `freepage`, -1 288 € de médiane contre le défaut, 3 graines sur 9 en hausse). Les refontes se déclenchent sur du bruit sans retirer quoi que ce soit.

### 8.2 La lecture formelle : E8, E9 et E10 sur `8355c93`

Une seule lecture, par la règle du §6 du plan, écrite avant tout résultat : graines 1 à 30, 500 €, sans fin, `runOne` avec `scenario.control`, au plus 14 processus en parallèle. `normal` sur 182 jours pour les trois bras (défaut, `noDesignLearning`, `designV1`), `facile` et `cauchemar` sur 60 jours pour le défaut, soit 150 runs, tous terminés sans erreur. Le bras `designV1` retrouve la référence de la V1 à l'euro près : 2 629 € de médiane à J60, 24 865 € à J180 (§4.2).

| Ligne | Demandé | Lu | Passe |
|---|---|---|---|
| E8, J60 | `noDesignLearning` moins `designV1`, écart apparié médian dans le bruit, au plus 1 176 € | +657 € (Q1 -183, Q3 3 716 €), positif 21/30 | oui |
| E8, J180 | au plus 6 341 € | +2 543 € (Q1 -8 192, Q3 10 203 €), positif 16/30 | oui |
| E9, argent | défaut moins `noDesignLearning`, gain apparié médian à J180 au-dessus de 0, positif sur au moins 19 sur 30 | +6 189 € (Q1 -6 022, Q3 17 881 €), positif 20/30 | oui |
| E9, meilleur style | part des guides en ligne sur le meilleur style de leur niche, en hausse de J60 à J180 | 19,6 % (61 sur 312) → 16,3 % (115 sur 706), en hausse sur 13 graines sur 30 | **NON** |
| E9, meilleur gabarit | même part, gabarits | 17,9 % (56 sur 312) → 20,1 % (142 sur 706), en hausse sur 18 graines sur 30 | oui |
| E10, K1 | `normal` : objectif à J60, 15 à 27 sur 30 | 22/30 | oui |
| E10, K2 | `normal` : médiane à J60, 1 000 à 4 000 € | 3 065 € | oui |
| E10, K3 | `normal` : faillites à J60 et à J180, au plus 2 à chacun | 0 et 0 | oui |
| E10, K4 | `facile` : objectif au moins 24 sur 30, aucune faillite | 29/30, 0 | oui |
| E10, K5 | `cauchemar` : au plus 8 faillites, trésorerie médiane au moins 250 € | 0, 801 € | oui |
| E10, K6 | violations, écarts au grand livre, NaN | 0, 0, 0 sur 90 runs | oui |
| E10, faillites | à J180, défaut au plus `designV1` + 1 | 0 contre 0 | oui |

**E8 passe, E10 passe, E9 échoue** sur une de ses trois conditions : la part de guides sur le meilleur style baisse.

**Les mêmes runs, en clair.**

| Profit cumulé, médiane (Q1 / Q3) | J60 | J120 | J180 |
|---|---:|---:|---:|
| Défaut | 3 065 € (271 / 5 755 €) | 19 158 € (13 946 / 27 259 €) | 33 234 € (28 220 / 50 723 €) |
| `noDesignLearning` | 4 423 € (605 / 6 867 €) | 20 853 € (13 758 / 27 158 €) | 30 750 € (22 328 / 41 756 €) |
| `designV1` | 2 629 € (181 / 5 224 €) | 13 906 € (7 282 / 23 925 €) | 24 865 € (18 556 / 36 316 €) |

| Écart apparié médian (positif sur 30) | J30 | J60 | J90 | J120 | J150 | J180 |
|---|---:|---:|---:|---:|---:|---:|
| Défaut moins `noDesignLearning` | -93 € (9) | -910 € (10) | -710 € (12) | -649 € (14) | +2 196 € (17) | +6 189 € (20) |
| `noDesignLearning` moins `designV1` | +77 € (19) | +657 € (21) | +2 006 € (19) | +4 020 € (19) | +3 819 € (17) | +2 543 € (16) |
| Défaut moins `designV1` | -10 € (14) | +588 € (19) | +2 722 € (18) | +8 621 € (20) | +8 469 € (21) | +10 379 € (23) |

Profit cumulé graine par graine, avec les colonnes de l'essai borné du §8.3 (le défaut avec ses deux changements) et du défaut après les corrections D211 du §8.4 (les témoins y sont les mêmes) :

| Graine | Défaut J60 | Témoin J60 | `designV1` J60 | Défaut J180 | Témoin J180 | `designV1` J180 | Essai J60 | Essai J180 | Après J60 | Après J180 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 7 664 € | 9 180 € | 5 464 € | 28 294 € | 30 645 € | 12 686 € | 7 445 € | 29 691 € | 8 659 € | 32 876 € |
| 2 | 1 761 € | 4 691 € | 4 625 € | 25 224 € | 31 245 € | 22 303 € | 2 282 € | 27 580 € | 2 505 € | 25 630 € |
| 3 | 2 131 € | 9 068 € | 1 € | 47 849 € | 63 589 € | 22 256 € | 2 131 € | 56 737 € | 1 484 € | 36 841 € |
| 4 | 7 064 € | 5 938 € | 4 060 € | 35 832 € | 17 370 € | 20 753 € | 7 119 € | 34 702 € | 9 084 € | 41 986 € |
| 5 | -359 € | -356 € | -360 € | 3 093 € | 13 581 € | 3 377 € | -359 € | 2 104 € | -359 € | 6 063 € |
| 6 | 5 692 € | 6 209 € | 4 792 € | 30 779 € | 23 819 € | 25 641 € | 5 447 € | 35 834 € | 6 425 € | 27 357 € |
| 7 | 9 230 € | 6 867 € | 5 814 € | 56 043 € | 37 122 € | 46 300 € | 10 317 € | 48 465 € | 10 056 € | 59 127 € |
| 8 | 2 803 € | 3 727 € | 3 584 € | 32 682 € | 30 343 € | 21 665 € | 2 709 € | 26 016 € | 2 748 € | 25 689 € |
| 9 | -302 € | -315 € | 1 884 € | 6 683 € | 655 € | 12 451 € | -302 € | 14 840 € | -302 € | 9 868 € |
| 10 | 3 328 € | -130 € | 457 € | 58 518 € | 25 883 € | 29 917 € | 2 859 € | 63 793 € | 2 184 € | 39 844 € |
| 11 | 4 048 € | 605 € | 3 224 € | 54 301 € | 22 328 € | 49 585 € | 5 195 € | 44 884 € | 5 562 € | 68 462 € |
| 12 | 6 655 € | 12 069 € | 9 490 € | 33 844 € | 30 856 € | 29 240 € | 8 919 € | 54 478 € | 15 206 € | 42 889 € |
| 13 | 8 606 € | -353 € | -170 € | 29 976 € | 10 187 € | 21 507 € | 4 979 € | 24 620 € | 5 176 € | 46 107 € |
| 14 | -247 € | 132 € | 3 € | 50 723 € | 41 756 € | 36 316 € | -247 € | 53 938 € | -247 € | 53 310 € |
| 15 | 5 402 € | 4 087 € | 1 989 € | 28 519 € | 18 637 € | 9 312 € | 7 608 € | 30 553 € | 5 996 € | 45 547 € |
| 16 | 7 819 € | 15 113 € | 8 905 € | 69 629 € | 54 088 € | 47 134 € | 6 638 € | 53 849 € | 10 117 € | 57 229 € |
| 17 | 1 158 € | 4 992 € | 5 224 € | 26 037 € | 32 616 € | 52 640 € | 2 185 € | 30 612 € | 2 001 € | 29 724 € |
| 18 | 1 114 € | 1 861 € | 952 € | 23 962 € | 37 964 € | 45 345 € | 4 412 € | 50 679 € | 3 679 € | 46 881 € |
| 19 | 3 865 € | -203 € | 1 043 € | 28 220 € | 20 463 € | 28 655 € | 6 171 € | 32 087 € | 2 969 € | 11 773 € |
| 20 | 1 564 € | 5 586 € | -348 € | 45 953 € | 39 604 € | -279 € | 4 784 € | 57 426 € | 2 953 € | 68 257 € |
| 21 | 5 755 € | 8 714 € | 2 034 € | 46 816 € | 47 279 € | 8 678 € | 7 954 € | 39 257 € | 7 958 € | 44 962 € |
| 22 | 10 007 € | 3 238 € | 8 392 € | 55 701 € | 23 814 € | 35 552 € | 10 007 € | 55 299 € | 11 884 € | 55 844 € |
| 23 | 3 517 € | 4 414 € | 483 € | 51 820 € | 33 939 € | 20 415 € | 4 487 € | 50 649 € | 4 473 € | 57 258 € |
| 24 | -8 € | 5 934 € | 5 771 € | 33 138 € | 49 038 € | 50 763 € | -8 € | 34 941 € | -8 € | 30 377 € |
| 25 | 5 390 € | 9 380 € | 7 044 € | 102 063 € | 58 443 € | 54 973 € | 6 148 € | 84 414 € | 7 086 € | 65 791 € |
| 26 | 271 € | 1 869 € | 5 020 € | 30 850 € | 14 483 € | 30 781 € | 271 € | 29 269 € | 271 € | 24 744 € |
| 27 | -164 € | -234 € | -196 € | 33 330 € | 27 988 € | 29 823 € | -164 € | 29 772 € | -164 € | 34 120 € |
| 28 | -307 € | 4 241 € | 3 835 € | 5 639 € | 24 682 € | 18 556 € | 95 € | 40 163 € | 95 € | 37 597 € |
| 29 | -16 € | 9 621 € | -370 € | 27 520 € | 43 595 € | 2 199 € | 2 888 € | 37 155 € | 2 377 € | 34 397 € |
| 30 | 2 121 € | 4 433 € | 181 € | 43 816 € | 43 210 € | 24 089 € | 2 121 € | 48 081 € | 2 166 € | 47 473 € |

| Looks des guides en ligne, lus contre le goût caché | J60 | J120 | J180 |
|---|---|---|---|
| Défaut | meilleur style 20 %, meilleur gabarit 18 % ; goût moyen 1,022 et 0,999 | 17 %, 19 % ; 1,016 et 1,007 | 16 %, 20 % ; 1,013 et 1,007 |
| `noDesignLearning` | 12 %, 21 % ; 0,995 et 1,005 | 13 %, 19 % ; 1,002 et 1,004 | 13 %, 20 % ; 1,003 et 1,003 |

- **Le défaut finit devant le hasard, et ce n'est pas par ses looks.** Il est derrière jusqu'à J120 (-649 €, 14 graines sur 30), devant à J150 et nettement à J180 (+6 189 €, 20 sur 30), alors que ses looks valent à peine plus : style 1,013 contre 1,003 à J180, gabarit 1,007 contre 1,003. Un style meilleur de 1 % vaut environ 0,8 % de clics sur les pubs à couverture et 0,35 % de conversion. Ce que le défaut a de plus que le témoin, à côté de ses bandits, ce sont les tests de page, les leçons, les règles et les refontes, et la phase 1 a vu que retirer les tests de page ou les refontes coûte (§8.1) ; aucun run ne dit par quel effet.
- **Le style se défait avec le temps.** À J60, les premiers guides de chaque niche portent des styles tirés surtout par l'a priori, qui lève les conventions : 20 % sur le meilleur style, contre 12 % au hasard. Ensuite le bandit apprend aussi de la conversion des pages, où le style ne pèse que style^0,35 et où chaque guide convertit à sa façon : la part tombe à 16 %. Les gabarits n'ont aucun a priori (§8.1, défaut 1), et ils ne font que suivre le hasard : 18 → 20 %, contre 21 → 20 %.
- **`noDesignLearning` contre `designV1` reste dans le bruit** à J60 comme à J180 : un marché neutre en moyenne vend autant avec des looks au hasard qu'avec ceux de la V1. Le bras défaut, lui, gagne +10 379 € de médiane sur `designV1` à J180, 23 graines sur 30.
- **Ce qu'aucune ligne ne lit** : la règle n'a pas de seuil sur l'écart de J60, où le défaut est derrière le témoin de 910 € (10 graines sur 30). K1 à K6 sont lus sur le défaut seul : le témoin et `designV1` n'ont pas de run `facile` ni `cauchemar`.

**Verdict :** E9 échoue, ses nombres sont ici et les réglages par défaut restent. Le plan permet un seul essai borné, sous une règle écrite d'abord : D212, écrite avant que E9 soit lu.

### 8.3 L'essai borné (D212) : pas adopté

**La règle, écrite avant la lecture de E9.** Deux changements du chemin d'apprentissage, rien d'autre : (a) l'étagère lit l'archétype dans lequel le rédacteur écrit le guide quand la recherche n'en nomme pas, et les conventions de gabarit du §5 du plan atteignent enfin les agents (défaut 1 du §8.1) ; (b) le bandit des styles n'apprend plus que des clics des pubs dont l'image est la couverture : la conversion du jour d'un guide ne récompense plus que son gabarit et son visuel, puisque le style ne pèse que style^0,35 sur la conversion (D201). Lu une fois, sur le bras par défaut avec l'essai, contre les runs `noDesignLearning` et `designV1` de la lecture formelle, `normal` 30 graines 182 jours, `facile` et `cauchemar` 30 graines 60 jours. Adopté seulement si E9 passe entier et si E10 tient.

**Les témoins ne lisent pas l'essai** : `noDesignLearning` graines 5 et 9 et `designV1` graine 5, relancés sur l'arbre de l'essai, sont identiques ligne pour ligne à ceux de la lecture formelle.

| Ligne | Demandé | Lecture formelle (`8355c93`) | Essai | L'essai passe |
|---|---|---|---|---|
| E9, argent | gain médian à J180 au-dessus de 0, positif sur au moins 19 sur 30 | +6 189 €, 20/30 | +11 965 € (Q1 -2 003, Q3 16 710 €), 20/30 | oui |
| E9, meilleur style | en hausse de J60 à J180 | 19,6 % → 16,3 % | 17,0 % (55 sur 323) → 16,9 % (121 sur 716), en hausse sur 14 graines | **NON** |
| E9, meilleur gabarit | en hausse de J60 à J180 | 17,9 % → 20,1 % | 22,9 % (74 sur 323) → 22,9 % (164 sur 716), en hausse sur 16 graines | **NON** |
| E10, K1 | 15 à 27 sur 30 | 22/30 | 23/30 | oui |
| E10, K2 | médiane à J60 de 1 000 à 4 000 € | 3 065 € | **4 449 €** | **NON** |
| E10, K3 | au plus 2 faillites à J60 et à J180 | 0 et 0 | 0 et 0 | oui |
| E10, K4 | `facile` : au moins 24 sur 30, aucune faillite | 29/30, 0 | 29/30, 0 | oui |
| E10, K5 | `cauchemar` : au plus 8 faillites, au moins 250 € | 0, 801 € | 0, 1 076 € | oui |
| E10, K6 | tout à 0 | 0, 0, 0 sur 90 runs | 0, 0, 0 sur 90 runs | oui |
| E10, faillites | à J180, au plus `designV1` + 1 | 0 contre 0 | 0 contre 0 | oui |

| Avec l'essai | J60 | J90 | J120 | J150 | J180 |
|---|---:|---:|---:|---:|---:|
| Défaut moins `noDesignLearning`, médiane (positif sur 30) | -761 € (12) | -203 € (13) | +1 568 € (16) | +7 015 € (20) | +11 965 € (20) |
| Défaut moins `designV1` | +1 778 € (19) | +4 901 € (20) | +8 226 € (24) | +10 670 € (23) | +12 071 € (24) |
| Profit cumulé du défaut, médiane | 4 449 € | — | 22 262 € | — | 38 206 € |

- **L'essai rapporte, et il échoue quand même**, sur trois conditions : la part sur le meilleur style ne monte pas (17,0 → 16,9 %), celle sur le meilleur gabarit non plus (22,9 → 22,9 %, 74 sur 323 puis 164 sur 716), et K2 dépasse sa borne haute à J60, 4 449 € pour 4 000 € au plus. La règle ne lit pas l'argent seul : **il n'est pas adopté**, le code garde le chemin d'apprentissage de `8355c93`.
- **Ce qu'il change, en clair** : les looks valent plus dès J60 (style 1,022, gabarit 1,011, contre 1,022 et 0,999 sans l'essai) et le restent (1,019 et 1,015 à J180, contre 1,013 et 1,007), le profit médian monte de 33 234 à 38 206 € à J180 et de 3 065 à 4 449 € à J60. Les conventions placent mieux les premiers guides de chaque niche, mais l'essai n'apprend pas ensuite à placer mieux les suivants : ses parts restent plates. C'est la condition « en hausse » qui échoue, pas le niveau, et K2 qui lit une entreprise trop à l'aise à J60.
- **Ce qui reste ouvert** : le défaut 1 du §8.1 (les conventions de gabarit n'atteignent pas les agents) reste dans le code, avec les défauts 2 et 3 ; l'essai montre ce que le premier coûte, et D212 ferme tout deuxième essai. Les trois ont été corrigés depuis, à la demande du fondateur : §8.4.

### 8.4 Après les corrections D211

**Ce qui change dans le code** (D215). Les trois défauts du §8.1 sont corrigés, et chaque correction a un test qui échoue sans elle :

1. **Les conventions de gabarit atteignent les agents.** L'étagère lit l'archétype du plan du guide : celui que nomme la recherche, sinon celui que l'éditeur donne à la niche, sinon celui des mots-clés de sa fiche, c'est-à-dire celui dans lequel le rédacteur écrit le guide. Jamais la vérité du marché. Sur les 16 niches, c'est l'archétype autour duquel le goût caché a été tiré, et les gabarits de sa convention partent avec 12 % d'avance dans l'a priori du bandit.
2. **Un test de page a sa propre place.** Les deux places de `run_experiment` gardent les hooks, les formats, les prix et le ton ; une même ronde peut ouvrir un test dans ces places et un test de page à côté, le test de page en dernier.
3. **Un test de page et un test de prix ne partagent plus un guide.** Aucun test de page ne s'ouvre sur un guide dont le prix est en test, aucun test de prix sur un guide en test de page.

**La règle, écrite et enregistrée dans le dépôt avant tout run** (D215). Les trois corrections restent quoi que dise la lecture. Une seule lecture, les mêmes runs que la lecture formelle du §8.2 : `normal`, graines 1 à 30, 182 jours, 500 €, sans fin, défaut contre `noDesignLearning` et contre `designV1` ; `facile` et `cauchemar`, graines 1 à 30, 60 jours, défaut seul, pour K1 à K6. Lignes notées : E9 argent ; part du meilleur gabarit du défaut en hausse de J60 à J180, et au-dessus de celle du témoin à J180 ; part du meilleur style du défaut à J180 au moins celle du témoin ; E8 ; K1 à K6 à J60 et faillites à J180. Une part se lit comme au §8.2 (guides en ligne sur le meilleur look de leur niche, toutes graines ensemble). Pas de réglage, pas de deuxième essai. Lu sur `28671d9` (`d99230b` et les trois corrections), 150 runs, aucun en erreur.

**Les témoins ne lisent pas les corrections** : les 60 runs `noDesignLearning` et `designV1` refaits sur l'arbre corrigé sont identiques, ligne du jour par ligne du jour, à ceux de la lecture formelle. E8 se relit donc à l'identique.

| Ligne | Demandé | Lecture formelle (`8355c93`, §8.2) | Après les corrections | Passe |
|---|---|---|---|---|
| E9, argent | défaut moins `noDesignLearning`, gain apparié médian à J180 au-dessus de 0, positif sur au moins 19 sur 30 | +6 189 €, 20/30 | +8 132 € (Q1 -2 891, Q3 22 005 €), 21/30 | oui |
| Meilleur gabarit, en hausse | part du défaut en hausse de J60 à J180 | 17,9 % (56 sur 312) → 20,1 % (142 sur 706) | 23,8 % (78 sur 328) → 22,6 % (165 sur 731), en hausse sur 16 graines sur 30 | **NON** |
| Meilleur gabarit, contre le témoin | part du défaut à J180 au-dessus de celle du témoin | 20,1 % contre 19,6 % (139 sur 710) | 22,6 % contre 19,6 % | oui |
| Meilleur style, contre le témoin | part du défaut à J180 au moins celle du témoin | 16,3 % (115 sur 706) contre 13,2 % (94 sur 710) | 15,2 % (111 sur 731) contre 13,2 % | oui |
| E8, J60 | `noDesignLearning` moins `designV1`, au plus 1 176 € | +657 €, positif 21/30 | +657 €, positif 21/30 (mêmes runs) | oui |
| E8, J180 | au plus 6 341 € | +2 543 €, positif 16/30 | +2 543 €, positif 16/30 (mêmes runs) | oui |
| E10, K1 | `normal` : objectif à J60, 15 à 27 sur 30 | 22/30 | 23/30 | oui |
| E10, K2 | `normal` : médiane à J60, 1 000 à 4 000 € | 3 065 € | 2 961 € | oui |
| E10, K3 | `normal` : au plus 2 faillites à J60 et à J180 | 0 et 0 | 0 et 0 | oui |
| E10, K4 | `facile` : objectif au moins 24 sur 30, aucune faillite | 29/30, 0 | 29/30, 0 | oui |
| E10, K5 | `cauchemar` : au plus 8 faillites, trésorerie médiane au moins 250 € | 0, 801 € | 0, 1 109 € | oui |
| E10, K6 | violations, écarts au grand livre, NaN | 0, 0, 0 sur 90 runs | 0, 0, 0 sur 90 runs | oui |
| E10, faillites | à J180, défaut au plus `designV1` + 1 | 0 contre 0 | 0 contre 0 | oui |

**Une ligne échoue** : la part du meilleur gabarit ne monte pas de J60 à J180, elle passe de 23,8 à 22,6 %. Toutes les autres passent. Lue avec cette même règle, la lecture formelle passait toutes ses lignes : c'est la hausse qui manque, pas le niveau.

**Les mêmes runs, en clair.**

| Profit cumulé, médiane (Q1 / Q3) | J60 | J120 | J180 |
|---|---:|---:|---:|
| Défaut, lecture formelle | 3 065 € (271 / 5 755 €) | 19 158 € (13 946 / 27 259 €) | 33 234 € (28 220 / 50 723 €) |
| Défaut, après les corrections | 2 961 € (1 484 / 7 086 €) | 21 778 € (14 420 / 33 355 €) | 40 915 € (29 724 / 53 310 €) |
| `noDesignLearning` (inchangé) | 4 423 € (605 / 6 867 €) | 20 853 € (13 758 / 27 158 €) | 30 750 € (22 328 / 41 756 €) |
| `designV1` (inchangé) | 2 629 € (181 / 5 224 €) | 13 906 € (7 282 / 23 925 €) | 24 865 € (18 556 / 36 316 €) |

| Écart apparié médian (positif sur 30) | J30 | J60 | J90 | J120 | J150 | J180 |
|---|---:|---:|---:|---:|---:|---:|
| Défaut moins `noDesignLearning`, lecture formelle | -93 € (9) | -910 € (10) | -710 € (12) | -649 € (14) | +2 196 € (17) | +6 189 € (20) |
| Défaut moins `noDesignLearning`, après | -72 € (12) | -191 € (14) | +68 € (15) | +1 953 € (17) | +2 536 € (21) | +8 132 € (21) |
| Défaut moins `designV1`, lecture formelle | -10 € (14) | +588 € (19) | +2 722 € (18) | +8 621 € (20) | +8 469 € (21) | +10 379 € (23) |
| Défaut moins `designV1`, après | +51 € (16) | +1 826 € (22) | +4 466 € (20) | +9 479 € (21) | +9 853 € (24) | +13 238 € (25) |
| Défaut après moins défaut avant | — | +738 € (19) | — | +1 707 € (19) | — | +3 027 € (20) |

| Looks des guides en ligne, lus contre le goût caché | J60 | J120 | J180 |
|---|---|---|---|
| Défaut, lecture formelle | meilleur style 20 %, meilleur gabarit 18 % ; goût moyen 1,022 et 0,999 | 17 %, 19 % ; 1,016 et 1,007 | 16 %, 20 % ; 1,013 et 1,007 |
| Défaut, après les corrections | 17 %, 24 % ; 1,020 et 1,013 | 16 %, 25 % ; 1,020 et 1,019 | 15 %, 23 % ; 1,016 et 1,015 |
| `noDesignLearning` | 12 %, 21 % ; 0,995 et 1,005 | 13 %, 19 % ; 1,002 et 1,004 | 13 %, 20 % ; 1,003 et 1,003 |

| Tests A/B | Défaut, lecture formelle | Défaut, après | `noDesignLearning` |
|---|---:|---:|---:|
| Graines 1 à 10, ouverts jusqu'à J120 : tests de prix | 54 | 81 | 86 |
| … tests de format | 113 | 164 | 158 |
| … tests de page | 47 | 65 | 0 |
| … tests de page sur un guide dont le prix est en test | 14 (27 jours, 13 tests de prix) | 0 | — |
| Graines 1 à 30, 182 jours : tests de prix (gagnés) | — | 460 (244) | 464 (223) |
| … tests de page (gagnés, annulés) | — | 371 (59, 42) | 0 |
| … jours-run avec un test de page en cours | — | 3 636 sur 5 460 | 0 |

La colonne « lecture formelle » des tests vient des bras de démontage du §8.1 (graines 1 à 10, 120 jours) : le témoin y comptait déjà 86 tests de prix et 158 tests de format, les mêmes qu'ici.

- **Les gabarits partent mieux, puis ne progressent plus.** Dès J60, 23,8 % des guides portent le meilleur gabarit de leur niche, contre 17,9 % avant et 21,5 % au hasard, et leur goût moyen passe de 0,999 à 1,013. Ensuite la part monte à 24,7 % à J120 puis redescend à 22,6 % à J180, toujours au-dessus du hasard (19,6 %). L'essai borné du §8.3, qui portait déjà la correction 1, lisait la même chose : 22,9 → 22,9 %. Les conventions placent bien les premiers guides ; rien, ensuite, n'apprend à placer mieux les suivants.
- **Les tests de prix reviennent.** Sur les graines 1 à 10, ils passent de 54 à 81 pour 86 au témoin, les tests de format de 113 à 164, et plus aucun test de page ne partage son guide avec un test de prix. Les tests de page, qui ont leur place, sont plus nombreux (65 contre 47) et tournent deux jours sur trois ; 59 des 371 nomment un gagnant.
- **L'argent suit.** Le défaut finit à 40 915 € de médiane à J180, contre 33 234 € avant les corrections (+3 027 € apparié, 20 graines sur 30). Il passe devant le témoin dès J90 et finit à +8 132 € (21 sur 30) ; à J60 il est encore derrière, de 191 € au lieu de 910 €. K2 reste dans sa borne (2 961 €), là où l'essai borné la dépassait.
- **Le style ne bouge pas.** 16,8 % des guides sur le meilleur style à J60, 15,2 % à J180 : au-dessus du hasard (13,2 %), en baisse comme avant (19,6 → 16,3 %). Le §6 du plan demandait les deux parts en hausse ; ni avant ni après les corrections elles ne montent.

**Verdict : une ligne sur treize échoue, la hausse de la part du meilleur gabarit (23,8 → 22,6 %).** Par la règle de D215, les trois corrections restent, sans réglage ni deuxième essai.
