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

### S15 : ce qui a bougé après l'étape 4

Ces nombres comparent 9513e97 au code final, 60 jours, 500 €, `normal`. Ils mêlent les bascules de l'étape 4 (D149) et le texte des guides (D152, D156). Aucune constante de `balance.ts` n'a changé, et une graine ne prouve rien : la vraie médiane est au §4.1.

| Graine | Trésorerie J60, 9513e97 → `67a5152` | Première écriture différente |
|---|---:|---|
| 4 | 3 549,79 € → 4 559,56 € | J7 |
| 7 | 8 684,29 € → 6 313,85 € | J5 |
| 42 | 1 411,67 € → 447,17 € | J16 |

Sur un an, graines 1 à 10, lu sur `11b3f20` : médiane de la trésorerie à J360 environ 36 440 €, contre environ 21 500 € avant les dernières corrections du texte et environ 38 000 € à la lecture d'acceptation. Aucun plantage, aucun écart de grand livre.

### Dernière liste (D135 à D143)

L'empreinte n'a pas bougé, le marché si : un texte de guide ou un titre de couverture changent une note, donc les ventes. La même couverture a gagné 5,5 points (D138).

- **Une empreinte égale ne veut pas dire un monde égal.** Elle couvre l'entreprise d'avant la V1 sur 25 jours, pas le marché de la V1.
- **Un écart sur une graine est surtout du chaos.** À J90, ces corrections ont pris -24 % à la graine 7 et +25 % à la graine 11. Cela ne dit pas qu'un meilleur guide vend moins.

**Ce que S14 a trouvé :** le bruit vaut 1 176 € à J60 et 6 341 € à J180 (§4). Aucun effet de cette liste ne se lit sous ces nombres, et aucun n'a été réglé.

### Rivaux

Mesuré à la fin de P10.2, rien n'a été réglé dessus (`GROWTH.rivals` reste celui de scale §6).

- **Un clone mord fort et tôt.** Il coûte 10 % de conversion d'un coup, puis s'efface (demi-vie 60 jours). En `normal`, un événement `competitor_clone` tombe environ tous les 33 jours et vise un guide en ligne au hasard : avec un seul guide en vente, ces clones seuls tiennent la niche vers −26 %, tout près du plafond de −30 %.
- **Les rivaux naturels prennent le relais quand les ventes montent :** 7 rivaux sur une route de la graine 7 d'ici J127, sans aucun événement `competitor_clone`.

**Ce que S14 a trouvé :** le gagnant E relève `CONVERSION.base` de 0,018 à 0,0195 sans qu'aucun contrôle ne lise les clones à part. Sur `67a5152`, à J30, le profit médian `normal` est de 76 € et 14 graines sur 30 sont à perte : le premier mois reste le plus étroit.

### Réserve et survie

D9 dit `adCap = min(part, trésorerie − réserve)`, et le plancher de la réserve (30 % du départ) est exactement la ligne de survie : sous cette ligne le plafond valait 0 pour de bon et coupait les pubs qui rapportaient. La porte de S10 y a mis la plus petite exception qui garde l'intention (D67) : en survie la réserve ne compte plus, et le mode survie suit ses propres règles, rien de neuf ne se lance, une pub rentable continue.

**Ce que S14 et le relevé final ont trouvé :**

- `STAGE_POLICY.reserveDays` et `CFO.reserveSpendShare` n'ont pas bougé : aucun candidat ne les portait.
- 8 graines sur 30 passent par la survie sur 182 jours (`67a5152`). Six y cumulent de 3 à 41 jours. Les graines 5 et 20, les deux seules faillites, y cumulent 104 et 122 jours, en 7 et 5 épisodes : à J182, la graine 5 en est sortie, pas la graine 20.
- Une pub qui rapporte peut encore s'arrêter quand la trésorerie passe sous une réserve au-dessus du plancher : c'est D9 à la lettre, et `allocator.test.ts` l'épingle.
- La croissance coûte d'abord : à J60, le bras complet lit 3 053 € contre 3 699 € sans mise à l'échelle, et à J180 il ne passe devant que de 1,15 fois (étape 4, `9513e97`).

### Score visuel

Mesuré à la fin de S8, rien n'a été réglé dessus (`sim/visual.ts` reste celui de pdf §12.4).

- **`VISUAL.ref = 70` n'est pas le niveau d'une agence qui démarre,** contrairement à ce que disent pdf §12.4 et le commentaire de `sim/visual.ts`. Sur cinq runs de 60 jours (graines 1, 2, 3, 7, 42), `visual.overall` moyen va de 83,6 à 86,7. À 85, chaque produit gagne dès sa première vente environ +7,5 % de conversion, +5 % de prix acceptable, +0,2 étoile et −1,3 point de remboursement.
- **Les cibles de finition 55, 72, 88 de pdf §12.2 ne sont pas atteintes :** `interior` mesuré 79, 95, 96 sur les trois guides de `visual.test.ts`. Tout l'écart est entre la finition 0 et la finition 1.

**Ce que S14 a trouvé :** le contrôle `design` a donné le résultat mince annoncé, gain 25 € et positif 17/30, puis 15 € et 16/30 à la pente 0,25 (§4.5). Le look reste, le talent design est « non prouvé », `VISUAL.ref` et `VISUAL.cvr.slope` n'ont pas bougé. Le commentaire de `sim/visual.ts` et pdf §12.4 restent faux sur ce point.

## 4. Résultats

Ce paragraphe décrit la V1 et remplace les tableaux d'avant la V1, qui mesuraient l'ancienne équipe fixe (ils restent dans l'historique git). Chaque tableau dit de quel commit il parle. Le code final est **`67a5152`**. Les contrôles appariés et les regards à 182 jours n'existent que sur un code plus ancien, et ils le disent : ils décrivent l'entreprise d'avant les bascules de l'étape 4.

- **La référence est 2 728 €**, la médiane `normal` à J60 sur `67a5152`. 3 053 € reste le nombre de l'étape 3, celui du candidat E avant les bascules, et n'est plus une référence. 1 408 € (avant la V1) non plus.
- **Le bruit :** deux runs qui ne diffèrent que d'un placebo (`ADS.baseCtr` × 1,01) s'écartent en médiane de 1 176 € à J60 sur le candidat A (étape 1), de 1 301 € à J60 et de 6 341 € à J180 sur le gagnant (étape 4). La règle gardait N = 1 176 €, aucun verdict n'en change. Le commit final n'a aucune mesure de bruit. Un écart plus petit ne dit rien.
- **Une médiane ne se lit jamais seule.** Les quartiles sont la médiane de chaque moitié des 30 graines. Environ 1 graine sur 10 reste près de la mort à chaque lecture du code.
- **Une faillite** est au moins une clôture sous zéro, remontée ou non. **Rentable** : profit cumulé positif ce jour-là.

### 4.1 La dernière course, J60, commit `67a5152`

Graines 1 à 30, 500 € de départ, sans fin (`--open-ended`, comme le produit), cerveau heuristique. `facile` et `cauchemar` viennent de `last-fc`, `normal` des 60 premiers jours du relevé de 182 jours du §4.2 : ces 60 lignes égalent un run de 60 jours (vérifié sur 30 graines sur 30, sur `11b3f20`).

| Difficulté | Profit médian | Q1 / Q3 | min / max | Rentables | À perte | Objectif 1 000 € | Faillites | À noter |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `facile` | 8 857 € | 4 271 / 11 329 € | -110 / 15 652 € | 28/30 | 2 | 26/30 | 0 | clôture la plus basse 121 € |
| `normal` | **2 728 €** | 245 / 5 224 € | -416 / 9 512 € | 24/30 | 6 | 21/30 | 0 | la graine 3 finit à +1 €, 9 graines sous 1 000 €, clôture la plus basse 84 € |
| `cauchemar` | -187 € | -375 / 852 € | -462 / 3 427 € | 14/30 | 16 | 7/30 | 0 | trésorerie médiane 313 €, 10 graines en survie le dernier jour, clôture la plus basse 38 € |

« 0 faillite sur 90 » dit peu sur la solvabilité : cette course s'arrête à J60. En `normal`, les premières clôtures négatives viennent après : J66 sur les 210 runs de l'étape 3, J87 sur le commit final. En `cauchemar`, elles peuvent venir avant : J51 à l'étape 3, 11 runs sur 210 à J60, tous sous A, B ou C, aucun sous le gagnant. La solvabilité se lit au §4.2.

### 4.2 Le relevé de 182 jours, commit `67a5152`

30 graines, `normal`, 500 €, sans fin.

| Profit cumulé | J60 | J120 | J180 | J182 |
|---|---:|---:|---:|---:|
| Médiane | 2 728 € | 12 389 € | **24 955 €** | 24 744 € |
| Q1 / Q3 | 245 / 5 224 € | 6 696 / 24 835 € | 18 339 / 38 782 € | 18 594 / 39 451 € |
| min / max | -416 / 9 512 € | -465 / 32 250 € | -386 / 55 775 € | -396 / 57 008 € |
| Graines à perte ce jour | 6 | 2 | 2 | 2 |
| Graines en survie ce jour | 3 | 2 | 1 | 1 |
| Faillites depuis le début | 0 | 1 | 2 | 2 |

- **À J180 :** 28/30 positives, 2 faillites, aucune morte. Graine 5 : 4 clôtures négatives de J87 à J90, -8,39 € au plus bas. Graine 20 : 14 clôtures négatives entre J150 et J171, -15,94 € au plus bas. Les deux sont vivantes à J182, avec 417 € et 104 € en caisse, après 104 et 122 jours cumulés en survie.
- **Palier à la fin :** 26 Portefeuille, 2 Accélération, 2 Survie.
- **Effectif médian 16,5**, de 8 à 19. Médianes par graine : 10 embauches, 1 départ, 0 remplacement. 5 remplacements en tout.
- **Sur 182 jours, en médiane :** 81 057 € de chiffre d'affaires pour 44 061 € de pub.
- **Intégrité :** violations 0, écarts au grand livre 0, NaN 0.

### 4.3 Les huit contrôles sur le commit final

Recomptés sur les fichiers bruts avec la méthode de `server/scripts/calibrateLib.ts` : K1, K2, K3, K7, K8 sur le relevé de 182 jours, K4 et K5 sur `last-fc`, K6 sur les 90 runs. La colonne de droite est le candidat E à l'étape 3 (code `e6fb49336df90154`). **L'entreprise livrée rate deux contrôles, K7 et K8, et non un seul.**

| # | Contrôle | Cible | `67a5152` | Passe | Étape 3, E |
|---|---|---|---:|---|---:|
| K1 | `normal` : objectif à J60 | 15 à 27 sur 30 | 21/30 | oui | 21/30 |
| K2 | `normal` : médiane à J60 | 1 000 à 4 000 € | 2 728 € | oui | 3 053 € |
| K3 | `normal` : faillites à J60 et à J180 | au plus 2 à chacun | 0 et 2 | oui, à la limite | 0 et 0 |
| K4 | `facile` : objectif, faillites | au moins 24 sur 30, 0 | 26/30, 0 | oui | 28/30, 0 |
| K5 | `cauchemar` : faillites, trésorerie médiane | au plus 8, au moins 250 € | 0, 313 € | oui | 0, 388 € |
| K6 | Violations, écarts au grand livre, NaN | tout à 0 | 0, 0, 0 sur 90 runs | oui | 0, 0, 0 sur 90 runs |
| K7 | `normal` : remplacements par graine, médiane | au moins 1 | **0**, 5 en tout | **NON** | 0, 3 en tout |
| K8 | `normal` : pente des semaines 9 à 26 positive, S26/S9 | au moins 24 sur 30, au moins 2,0 | **20/30, 1,79** | **NON** | 27/30, 2,06 |

K8 lit le chiffre d'affaires net des remboursements, semaine par semaine : le brut donne 1,80. 7 graines finissent la semaine 26 sous leur semaine 9.

### 4.4 La courbe de la semaine, commit `67a5152`

Médianes des 30 graines de `normal`, semaine par semaine. Le chiffre d'affaires net retire les remboursements. **CA / pub** divise tout le chiffre d'affaires brut de la semaine, organique, e-mail et upsells compris, par la pub. **ROAS pub** ne compte que les ventes de la pub, lues jour par jour : c'est le ROAS du §4.7 et du §6. Ces deux colonnes prennent la médiane des graines qui ont dépensé en pub cette semaine-là, 28 à 30 sur 30.

| Semaine | CA brut | CA net | Pub | CA / pub | ROAS pub | Profit de la semaine |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 26 € | 26 € | 33 € | 1,08 | 0,81 | -107 € |
| 2 | 126 € | 123 € | 81 € | 1,43 | 0,79 | -22 € |
| 3 | 251 € | 248 € | 132 € | 1,98 | 1,35 | 23 € |
| 4 | 313 € | 313 € | 187 € | 1,88 | 1,34 | 24 € |
| 5 | 538 € | 512 € | 238 € | 2,47 | 1,65 | 127 € |
| 6 | 998 € | 942 € | 417 € | 2,21 | 1,58 | 235 € |
| 7 | 1 564 € | 1 511 € | 578 € | 2,46 | 1,67 | 602 € |
| 8 | 1 946 € | 1 850 € | 858 € | 2,40 | 1,71 | 714 € |
| 9 | 2 502 € | 2 380 € | 1 048 € | 2,38 | 1,82 | 1 060 € |
| 10 | 2 750 € | 2 555 € | 1 271 € | 2,28 | 1,73 | 834 € |
| 11 | 2 914 € | 2 657 € | 1 457 € | 2,07 | 1,57 | 1 021 € |
| 12 | 3 752 € | 3 447 € | 1 812 € | 1,93 | 1,64 | 950 € |
| 13 | 3 164 € | 2 978 € | 1 695 € | 2,13 | 1,60 | 1 213 € |
| 14 | 4 014 € | 3 884 € | 1 910 € | 2,18 | 1,71 | 1 489 € |
| 15 | 3 970 € | 3 640 € | 2 177 € | 1,98 | 1,51 | 1 325 € |
| 16 | 4 346 € | 4 048 € | 2 290 € | 1,91 | 1,54 | 1 331 € |
| 17 | 4 140 € | 3 824 € | 2 334 € | 1,88 | 1,41 | 1 272 € |
| 18 | 4 072 € | 3 742 € | 2 506 € | 1,85 | 1,38 | 1 181 € |
| 19 | 4 188 € | 3 869 € | 2 164 € | 1,82 | 1,43 | 1 561 € |
| 20 | 4 728 € | 4 439 € | 2 601 € | 1,88 | 1,51 | 1 146 € |
| 21 | 4 644 € | 4 234 € | 2 697 € | 1,67 | 1,29 | 1 287 € |
| 22 | 4 784 € | 4 415 € | 2 626 € | 1,81 | 1,32 | 1 368 € |
| 23 | 4 362 € | 4 078 € | 2 633 € | 1,72 | 1,33 | 1 415 € |
| 24 | 4 864 € | 4 456 € | 2 908 € | 1,68 | 1,25 | 1 134 € |
| 25 | 4 710 € | 4 373 € | 3 110 € | 1,64 | 1,28 | 1 139 € |
| 26 | 4 476 € | 4 213 € | 3 012 € | 1,53 | 1,19 | 912 € |

Le chiffre d'affaires monte vite jusqu'à la semaine 16, puis lentement : un plateau près de 4 500 € par semaine. La pub, elle, continue de monter (× 2,9 entre les semaines 9 et 26, pour un chiffre d'affaires × 1,8), le CA / pub passe de 2,38 à 1,53, le ROAS pub de 1,82 à 1,19, et le profit de la semaine reste entre 900 et 1 600 € depuis la semaine 14. L'agence grandit seule, puis elle bute sur le marché (§7).

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
2. **K7 et A10 échouent : la compétition existe et mord rarement.** Commit final : 5 remplacements en 30 entreprises sur 182 jours, 1 à J60, 4 à J180, médiane 0. Les 5 ont pris une personne sous la moyenne de sa famille, gain moyen de talent réel +0,17. La chaîne s'arrête au marché : D147 lisait 0,78 sur une famille de copie, graines 1 à 15, avant les bascules. Sur le commit final, le talent réel moyen de la ligue lit 0,76 en médiane à J182, et le marché reste à 0,52.
3. **« 0 faillite à J180 » ne vaut que pour le code de `9513e97` et d'avant.** Le commit livré lit 2/30, exactement à la limite de K3, sans marge. L'assurance de D117 n'est pas construite, puisque son déclencheur (K3 ou K5 en échec) n'a pas tiré.
4. **Une queue d'environ 1 graine sur 10 reste près de la mort.** Commit final : 6 graines à perte à J60 et la graine 3 à +1 €, 2 graines à perte à J180, qui cumulent 104 et 120 jours de survie à cette date. Les médianes ne le montrent pas.
5. **La dernière course s'arrête à J60.** En `normal`, elle ne peut presque pas voir une faillite (§4.1). La solvabilité se lit sur 182 jours.
6. **K6 est un contrôle de fraîcheur, pas de justesse.** `cash` et `ledgerCash` sont deux sommes des mêmes écritures, et un montant non fini est mis à zéro avant que le contrôle NaN ne le voie. K6 attrape un KPI en retard, pas un montant faux. `violations` est un vrai compte.
7. **L'allocateur au ROAS moyen est la règle de l'étape 4, lue à J60, et il a aussi retiré le plancher de ROAS de 1,15.** De J121 à J182 : ROAS médian 1,37 et 22 713 € de pub sur le commit final, 9 graines sous 1,2 ; 1,69 et 16 754 € sur `9513e97`, sous la règle marginale, 0 graine sous 1,2. Soit 36 % de pub en plus pour un profit qui reste dans le bruit : commit final moins `9513e97` à J180, -957 €, 14/30, tous les changements de S15 mêlés. Rien n'est prouvé après J60, pour aucune des deux règles.
8. **Le tempo est presque cosmétique.** Il a quitté le marché et le bandit, mais il change la longueur des plans (`TEMPO_SHOT`), donc le rythme, donc la note d'un film, donc son CTR : au plus ±1,6 %, sur une minorité de films.
9. **Les contrôles de l'étape 4 sont fermés (D149).** Ils décrivent l'entreprise d'avant les bascules. Aucun contrôle de mise à l'échelle n'existe sur le commit final : A1, A2, A4 et A5 de scale n'y sont pas revendiqués. A3 y échoue (20/30, 1,79). A5 demande au plus le contrôle + 1 : le commit final lit 2 faillites à J180, donc A5 échoue si le contrôle lit encore 0, ce qui n'est pas mesuré. Les trois bascules n'ont jamais été mesurées ensemble contre un contrôle.
10. **Les fichiers `--json` du banc ne portent pas de tampon de code** (`sweep182`, `last-fc`), à la différence des fichiers de calibration. Ce qui prouve leur commit est un rejeu : `npm run balance`, relancé sur `67a5152` pendant cette passe, redonne les graines 1, 2, 3 et 7 du relevé à l'euro près.

Une partie dépend beaucoup de son chemin (première niche choisie, premiers avis, un événement au mauvais moment) : deux graines voisines peuvent finir à 9 512 € et à -170 € à J60 (graines 12 et 13). C'est voulu, c'est un marché, mais il faut juger un réglage sur 30 graines et contre un contrôle apparié, jamais sur une seule graine.

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

Chaque commande ci-dessus a été lancée sur le code final, sur quelques jours ou en entier. Aide complète : `npx tsx scripts/balance.ts --help`.

**Temps mesurés sur `67a5152` :**

| Commande | Processus | Durée |
|---|---:|---:|
| `npm run balance`, 15 runs de 60 jours | 3 (défaut) | 132,5 s |
| `npm run balance -- --open-ended`, 15 runs | 10 | 74,9 s |
| 60 runs de 60 jours, `facile` et `cauchemar` | 6 | 650,7 s |
| 30 runs de 182 jours, `normal` | 12 | 757,1 s |

Sur `11b3f20`, `--open-ended --jobs 6` a pris 97,1 s. Un run de 60 jours prend environ 50 s pour une entreprise qui marche : de 12 à 53 s à 10 processus, de 19 à 97 s à 6 processus. Un run de 182 jours a pris de 68 à 407 s à 12 processus.

- Chaque run est une vraie entreprise sans interface (une équipe fondatrice de 8 agents qui recrute quand les chiffres le demandent, cerveau heuristique, PDF et pages de vente réellement générés, pas de film) dans un dossier temporaire supprimé à la fin, sauf avec `--keep`. Les runs tournent dans `--jobs` processus (3 par défaut, 16 au plus ; `--jobs 1` = tout dans le même processus, mêmes résultats). Le mode `claude` n'est jamais utilisé par le banc (aucune clé n'est transmise).
- `--open-ended` retire l'échéance, comme le produit. Sur ces 15 runs de 60 jours, le résultat est le même avec et sans (vérifié sur `67a5152`). Avec une échéance, la ligue s'arrête 10 jours avant la fin : un bras de calibration tourne donc toujours sans fin (D125).
- Colonnes : **J>0** = premier jour où le profit cumulé (frais de démarrage compris) passe au-dessus de 0 ; **Objectif** = premier jour à 1 000 € de profit cumulé ; **Faillite** = au moins une clôture négative, remontée ou non ; **Prod. L/A** = produits en ligne / arrêtés ; **ROAS 1→2** et **CTR 1→2** = pubs payantes de la première puis de la seconde moitié du run (↑ = mieux en 2e moitié) ; **CTR neuf** = TikTok, créations sous 30 000 impressions ; **Angle** = accroche × format de ce qui a tourné, rapporté au meilleur couple de la niche ; **Remb.** = part des commandes remboursées ou contestées ; **Leçons** = leçons chiffrées écrites dans le cerveau ; **Effectif** = agents le dernier jour ; **Masse salariale**, **Embauches**, **Départs** sur tout le run ; **Survie** = jours sous la ligne du CFO ; **Violations** = invariants d'organisation rompus.
- **Artefacts** surveillés : **F** = falaise (le profit cumulé perd plus de 40 % d'un pic ≥ 100 € en moins de 7 jours ; `--details` liste la chaîne qui l'explique : événements du marché, jours de pub sans vente, vagues de remboursements) ; **S** = plus de 2 jours sans pub alors qu'il reste plus de 30 % de la trésorerie de départ, un produit vendable et un compte pub actif ; **K** = KPI du jour ≠ somme du grand livre ; **N** = valeur non numérique.
- `--set CHEMIN=N` remplace le temps du banc une constante du marché ou d'un pilier (`docs/v1/PLAN.md` §2.9). Un chemin inconnu est une erreur, pour ne jamais mesurer le marché par défaut sans le savoir.
- Les tests `server/test/balance.test.ts` vérifient aussi qu'un run de quelques jours fonctionne en mode **validation fondateur** (la mise en ligne attend le fondateur ; en approuvant, le guide passe en ligne) et en mode **`claude` sans clé** (repli heuristique, exactement le même run).

**Les autres outils :**

| Commande (dans `server/`) | Ce qu'elle fait |
|---|---|
| `npx tsx scripts/golden.ts --check` | Compare le run de référence à son empreinte (`b6b0ec5a…` sur `67a5152`) |
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

**État de cette version, `67a5152` : critère non rempli, à la lettre. Deux lignes échouent : l'apprentissage visible (40 % pour 70 %) et les arrêts de pub (3 pour 0).** La ligne 1 lit `npm run balance` (15 runs, les mêmes avec et sans `--open-ended`). La colonne de droite lit les 30 graines de la dernière course et du relevé de 182 jours, qui sont plus nombreuses que les 15 demandées et plus sévères que les 5 du banc.

| Ligne du critère | Cible | 5 graines, 60 jours | Verdict | 30 graines |
|---|---|---|---|---|
| `normal` : positif avant J40 | au moins 4/5 | 4/5 (J12, J13, J15, J23 ; la graine 42 jamais) | tient | 21/30 |
| `normal` : positif à J60 | au moins 4/5 | 4/5 (la graine 3 à +1 €, la graine 42 à -53 €) | tient, à 1 € près | 24/30 |
| `cauchemar` : aucune faillite | au moins 3/5 | 5/5 (la graine 42 finit à 48 € après 28 jours de survie) | tient | 30/30 à J60 |
| Apprentissage visible, CTR **et** ROAS | au moins 70 % | **40 %** (CTR 60 %, ROAS 40 %, 10 parties) | **échoue** | 57 % sur 60 parties |
| Zéro arrêt de pub | 0 | **3** (`normal` 3 et 42, `cauchemar` 2) | **échoue** | 18 sur 90 runs, de 3 à 6 jours chacun, au sens du détecteur S (§5) |
| Zéro écart KPI / grand livre | 0 | 0 | tient (K6, §4.7) | 0 sur 90 runs |
| Zéro NaN | 0 | 0 | tient | 0 sur 90 runs |
| Aucune falaise sans chaîne | 0 | 1 falaise, expliquée | tient sur 5 graines | **5 inexpliquées sur 22**, sur 90 runs |
| Médiane `normal` entre 1 000 et 3 000 € | sur 15 graines | 4 625 € sur 5 graines, trop peu pour lire une médiane | tient sur 30 graines | 2 728 € |
| Aucune faillite en `normal` | sur 15 graines | 0/5 à J60 | tient à J60, **échoue à J180** | 0/30 à J60, 2/30 à J180 |
| Types et tests | verts | voir `docs/v1/ACCEPTANCE.md`, A1 et A2 | tient | — |

**Pourquoi la lecture ROAS baisse quand l'entreprise monte.** C'est ce que disent les données, sur 30 graines, `normal`, commit final :

| Médianes | Jours 1-91 | Jours 92-182 | Mieux en 2e moitié |
|---|---:|---:|---:|
| Dépense pub | 9 781 € | 33 581 € | |
| ROAS | 1,63 | 1,41 | 20 % des graines |
| CTR | 2,15 % | 2,54 % | 73 % |
| CTR neuf | 2,52 % | 3,14 % | 87 % |
| Angle | 0,86 | 0,94 | 100 % |

Ce que l'agence met en vitrine devient meilleur, et chaque euro de plus rapporte moins. Trois raisons :

- **La saturation.** Une niche n'absorbe qu'un nombre limité de visiteurs par jour. Entre les semaines 9 et 26, la pub est multipliée par 2,9 et le chiffre d'affaires par 1,8.
- **La règle de l'allocateur.** Le ROAS moyen répartit l'enveloppe sans plancher : une ligne qui rapporte peu garde sa part (§4.7, point 7). L'enveloppe n'est pas forcément dépensée : une ligne s'arrête à 60 %, bouge d'au plus ±30 % par jour, et ce qu'elle laisse ne va pas aux autres. Graine 42, J116, `67a5152` : enveloppe 1 455 €, budgets du jour 414 €. La part laissée n'a pas été mesurée sur 30 graines.
- **La chance à J60.** Sur 60 parties, les graines où le ROAS baisse et celles où il monte ont multiplié leur dépense autant l'une que l'autre (× 3,97 et × 4,03). La baisse à J60 n'est donc pas prouvée être de la saturation : c'est aussi le souvenir d'une première moitié heureuse.

**Cette ligne ne sépare pas assez ce qu'elle veut séparer.** Bras appariés de l'étape 4, code `9513e97`, 30 graines `normal` :

| Part des graines meilleures en 2e moitié | Avec apprentissage | Sans apprentissage |
|---|---:|---:|
| CTR **et** ROAS, J60 | 50 % | 37 % |
| CTR **et** ROAS, 182 jours | 30 % | 13 % |
| CTR neuf **et** angle, J60 | 70 % | 40 % |
| CTR neuf **et** angle, 182 jours | **97 %** | **50 %** |

Avec tout l'apprentissage en marche, une entreprise qui monte en dépense n'atteint pas 70 % sur la ligne écrite : 50 % à J60, 30 % sur 182 jours.

**Les meilleures lectures proposées, à côté du critère, sans le remplacer :**

| Ligne écrite | Pourquoi elle ne convient plus | Lecture proposée | Ce qu'elle lit aujourd'hui |
|---|---|---|---|
| Apprentissage visible, CTR et ROAS, 70 % | Elle mesure l'échelle autant que l'apprentissage | Contrôle apparié `control.noLearning` à 182 jours, positif sur au moins 19/30 ; et en lecture simple, CTR neuf et angle meilleurs sur au moins 70 % des runs de 182 jours | +6 342 €, 26/30, sur `9513e97` seulement ; 87 % sur `67a5152` |
| Zéro arrêt de pub | Écrite pour une équipe sans paie. Aujourd'hui une réserve du CFO peut couper la pub (D9), et le détecteur S ne compte pas les jours sous 30 % du départ. La cause de ces 18 arrêts n'a pas été lue | Aucun arrêt de plus de 7 jours avec un produit vendable et plus de 30 % du départ en caisse | 6 jours au plus, sur 90 runs. **Sans la condition de trésorerie, la lecture échoue :** 16 runs sur 90 passent plus de 7 jours sans pub avec un produit vendable, jusqu'à 113 jours (graine 20, J61 à J173) et 71 jours (graine 5, J37 à J107). Hors jours de survie, le maximum retombe à 6 jours |
| Aucune faillite, lue à J60 | En `normal`, la fenêtre finit avant les premières clôtures négatives | K3 : au plus 2 sur 30 à J180 | 2/30, à la limite |

Ces lectures sont des propositions : une lecture choisie après le résultat ne prouve rien, et le contrôle apparié n'existe pas sur le commit final.

**La phase 2 reste la décision du fondateur.** Ce document donne les chiffres, il ne décide pas. Le critère écrit échoue sur deux lignes, et il reste écrit.

## 7. Limites connues

Ce qui reste vrai sur le commit final, lu dans le code ou à l'écran. Un nombre sans commit vient d'une lecture plus ancienne et n'a pas été recompté. Les réserves sur les chiffres sont au §4.7, chaque ligne d'acceptation dans `docs/v1/ACCEPTANCE.md`.

**Marché et argent**

- Le vrai plafond est le réservoir de chaque niche : le candidat G, qui le doublait, n'a pas gagné. Le chiffre d'affaires plafonne près de 4 500 € par semaine et retombe après J180 (D106, lu avant le gagnant E, sur 8 graines : 0,84 de la base à J270, en baisse sur 7). Personne n'a lu plus loin.
- Levier `buying` négatif, levier `copy` dans le bruit (§4.5).
- L'organique pèse peu : 176 à 180 posts en 60 jours, 11 à 13 % des tâches d'une partie qui vend, 22 % de celle qui ne vend pas (4 runs sur `67a5152`), pour 1,24 % du chiffre d'affaires sur 182 jours et 3,9 % sur les 8 premières semaines (30 graines). Personne n'y a touché.
- Les arnaques au support ne coûtent presque rien à l'agence : 0 € de `scam_loss` sur 4 runs de 60 jours sur 4 (`67a5152`, `cauchemar` 1 et 103, `normal` 29 et 102).
- Le mode survie ne lance rien de neuf : une entreprise qui y entre sans pub qui tourne n'en sort que par l'organique. Graine 20 : 113 jours de suite sans un euro de pub avec un produit vendable, J61 à J173. Graine 5 : 71 jours, J37 à J107.
- Un film garde le prix avec lequel il a été monté (D131).

**Ligue**

- Les compétences aveugles ne peuvent pas être remplacées : `design`, `support`, `buying`, `research`, `polish`. Un plan raté y finit sans candidat.
- Le talent de `polish` ne change plus sa propre production (D144).
- `shots`, dans un fichier de film, resserre un peu la bande de talent d'un monteur (D129).

**Le fondateur et l'entreprise**

- Une mission qui nomme des créateurs sans nommer de guide se ferme comme faite.
- Une mission qui nomme un canal ne l'ouvre que par `keywordMission`.
- Les jours calmes retirent les mots de progrès du fil, pas la confiance que la rétro continue de monter (D95).
- Un serveur peut ouvrir un run qu'une commande en ligne écrit encore.
- Un Ctrl+C à la main dans un terminal Windows n'a pas été essayé. Le même signal, envoyé à une console cachée sur `67a5152`, a sauvegardé le run et libéré le port. Les arrêts brutaux sont sûrs (A27), donc au pire c'en est un.
- Le mode Claude n'a jamais été appelé en vrai : aucune clé n'a servi.
- En mode `heuristic`, une mission se lit par mots-clés, pas par le sens. Graine 42 : « Baisse le budget de pub » a commandé des accroches, une campagne et deux pubs, le contraire de la demande, et une demande composée (« Baisse le budget de pub sur TikTok et prépare un nouveau guide sur le jardinage en balcon ») a échoué sur « aucune niche de notre veille ne correspond ».
- La fiche d'un agent peut écrire « Pas encore de tâche pour Nadia » à côté de « 7 tâches faites » : la liste et le compteur ne lisent pas la même chose.
- Le résumé ouvert par `d` s'appelle « Les 7 derniers jours » même au J3, quand il couvre J1 → J3.
- Dans la Galerie, le compteur « Vidéo pub » lit d'abord les films du flux direct, puis le vrai total après le clic : 3, puis 11.
- Un guide arrêté par l'agence garde sa page de vente et ses boutons d'achat simulés.

**Guides**

- Les guides se répètent par construction : 49,7 % des mots imprimés se trouvent aussi sur une autre page, l'arbre de décision reprend les situations mot pour mot.
- Un guide garde parfois le lien vers la v1 d'une suite republiée : la page s'ouvre, 1 guide sur 29.
- La page de vente compte les actions du bonus, pas le PDF : 4 actions de plus sur 20 guides sur 20 (graine 42, `prd_1555` v2 : 35 contre 31).
- Un kit garde le gabarit d'un guide : `prd_13520`, 8 pages, annonce « 7 chapitres, 35 actions guidées » et « Chapitre par chapitre », et ses lignes finissent par deux points.
- Le lien de la dernière page d'un guide est relatif à la partie (`/runs/<id>/files/…`) : il devrait être mort dans un PDF téléchargé. Lu dans le fichier, pas cliqué dans un lecteur extérieur.
- Des coutures de gabarit restent visibles : « Remplir chaque ligne : question, votre réponse. », un bloc « À surveiller » qui liste des conseils, une citation qui perd ses guillemets dans une autre.
- Les avis d'une page sont datés du jour de la partie, « Jour 94 », pas d'une date.
- La ligne « Novembre » de la fiche URSSAF n'a pas de date.
- La fixture de démonstration contient des adresses générées sur de vrais domaines.

**Films**

- Le son est jugé par le volume et les silences seulement. Personne n'a écouté un film : une personne doit le faire une fois.
- Une partie des zones de sécurité vient d'outils tiers, à vérifier dans les applications avant tout réel.
- Crête réelle -0,3 dBFS dans le pire film, pour -2,5 demandés.
- Au premier rendu, un diaporama dépasse sa durée estimée de 31 %.
- Chez un monteur faible, l'accroche arrive après le carton-titre.
- La preuve d'une pub cite la base d'un avis, que l'avis public ne montre pas (D93).
- Les storyboards SVG n'ont pas reçu le nouveau dessin.

**Tenue et marges**

- A6 échoue sur un seul nombre : le p95 d'une journée, 1 060 ms pour 800, lu sur `11b3f20`.
- Les marges d'une année sont minces sur dix graines, lues sur `11b3f20` : direct 397,6 kB sur 400, dossier 148,4 MB sur 150, `/api/state` 693,0 kB sur 700, et 225,4 s sur 240 pour la graine 7, sur une machine calme.
- La compaction peut laisser partir le premier signataire d'une carte d'avis, qu'un film montre encore (D131, D137).
- L'échelle de coupes du plan n'a pas servi (D65).
- `docs/v1/talent.md` n'a pas été réécrit là où les décisions l'ont dépassé : `docs/v1/PLAN.md` §8 fait foi.
