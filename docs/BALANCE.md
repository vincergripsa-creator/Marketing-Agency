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

`conversion ≈ 1,9 % × qualité de la page × facteur prix × note des avis × spécificité du guide × demande × concurrence × niveau de promesse`

- **Le prix** : en dessous du prix « idéal » de la niche, on vend un peu plus ; au-dessus, la conversion baisse ; **au-delà du prix maximum que les acheteurs acceptent, elle s'effondre** (sans falaise brutale, mais nettement : à 39 € pour un maximum de 33 €, chaque visiteur rapporte deux fois moins qu'à 29 €). Le bon prix est celui qui maximise le **revenu par visiteur**, pas le nombre de ventes.
- **La note des avis** : pas d'avis = 0,9 ; moyenne ≥ 4,5 = 1,1 ; moyenne < 3,5 = 0,6.
- **La promesse** : une page plus « survendue » convertit un peu mieux (jusqu'à +35 %)… et fait rembourser et mal noter si le guide ne tient pas la promesse.
- **La saturation** : une niche n'absorbe qu'un nombre limité de visiteurs par jour (120 + 650 × demande, puis rendement décroissant). Multiplier le budget par 5 ne multiplie pas les ventes par 5 : le ROAS baisse quand on scale.
- Le trafic organique convertit à 60 % du payant (public froid), les créateurs à 140 % (confiance).

### Ce qui fait rembourser, et les avis

- Le risque de remboursement = base de la difficulté × sensibilité de la niche + écart entre la promesse et le contenu + qualité du PDF trop basse + profil du client. Il est concentré sur les premiers jours après l'achat (fenêtre de 14 jours).
- Les **chasseurs de remboursement** demandent à être remboursés quoi qu'il arrive ; les « Karen », sceptiques et menaces de litige passent par la boîte mail (y répondre bien et vite évite le chargeback à 15 € de frais).
- Les avis viennent des acheteurs (2 à 5 jours après l'achat) ; un support qui ignore un client mécontent récolte un 1 étoile. **Seuls les acheteurs vérifiés notent la boutique** : un troll qu'on « nourrit » revient à la charge en message, il ne peut pas noter le guide (une vague de trolls, événement annoncé, peut en revanche laisser un 1 étoile).

### Les autres pièges

Clients pénibles, arnaques au support (« remboursez-moi la différence »), faux créateurs qui encaissent une avance, pubs refusées (mots interdits : « garanti », kilos, gains d'argent…) puis compte suspendu au 3e avertissement, concurrent qui clone le guide, tendance qui baisse, panne de paiement, réserve du prestataire de paiement (gèle une partie de la trésorerie, jamais plus de la moitié, pendant 7 jours, sans bloquer les ventes), vague de trolls, pic de CPM. Les **frais fixes** : 60 € de démarrage (thème de boutique, domaine, pixel, outil e-mail, au premier jour), boutique 29 €/mois, outils 12 €/mois, frais de paiement 1,5 % + 0,25 €. Un run refuse un budget de départ sous `minStartingCash()` (110 € : démarrage + 30 jours de frais fixes, arrondi à la dizaine supérieure).

### Pépites et pièges du catalogue

| Type | Niches | Pourquoi |
|---|---|---|
| Pépites | propreté du chiot, oral aide-soignante, URSSAF micro-entreprise, mariage < 10 k€, relooker un meuble | demande correcte, bon prix accepté, peu de concurrents sérieux, peu de risque de conformité |
| Solides | sommeil de bébé, diversification/DME, potager sur balcon, TOEIC, Japon petit budget | demande forte ou bon prix, mais plus de concurrence ou de remboursements |
| Pièges | chat qui griffe, batch cooking, stress du bac (prix acceptés de 8 à 15 €) ; freelance LinkedIn (saturé, CPM 10 €) ; ventre après 40 ans (champ de mines de conformité, remboursements) ; revendre sur Vinted (promesses d'argent refusées) | beaucoup de « buzz » dans les tendances, mais impossible d'y gagner de l'argent avec de la pub payante |

### Ce que change la difficulté

| | facile | normal | cauchemar |
|---|---|---|---|
| CPM (× base de la niche) | × 0,7 | × 1 | × 1,35 |
| Part de clients pénibles | 15 % | 30 % | 55 % |
| Remboursements de base | 2,5 % | 4 % | 7 % |
| Intensité des arnaques (messages d'arnaque et événements « tentative d'arnaque ») | 0,08 | 0,18 | 0,40 |
| Faux créateurs | 15 % | 25 % | 40 % |
| Événements par jour | 12 % | 20 % | 34 % |
| Messages clients par vente | 0,10 | 0,16 | 0,28 |

## 2. Ce que l'agence doit apprendre (et que le banc d'essai mesure)

1. **L'angle des pubs** : les bandits de Thompson par niche (`hook_style:<niche>`, `ad_format:<niche>`) apprennent quel style et quel format cliquent ; les expériences A/B le confirment ; les leçons l'écrivent dans les playbooks ; la production de créas exploite ce qui a été appris.
2. **Le prix** : tests A/B de prix mesurés en revenu par visiteur, hausse annulée si elle fait baisser ce revenu, baisse si personne n'achète.
3. **Où mettre l'argent** : stop-loss, cooldown, « pub morte » pour une version qui perd, scale progressif des gagnants, diversification vers une nouvelle niche.
4. **La qualité** : réécriture (v2/v3) sur plaintes et mauvais avis, pause d'une version qui fait fuir les acheteurs.

L'apprentissage est **visible** quand le CTR et le ROAS des jours 31-60 battent ceux des jours 1-30, alors même que l'agence dépense souvent 2 à 5 fois plus en 2e moitié (saturation, fatigue) et ouvre de nouvelles niches où elle repart de zéro.

## 3. Calibration de cette version

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

### S15 : ce qui a bougé après l'étape 4

Ces nombres comparent 9513e97 à l'arbre final, 60 jours, 500 €, `normal`. Ils mêlent les bascules de l'étape 4 (D149) et le texte des guides (D152, D156). Aucune constante de `balance.ts` n'a changé, et une graine ne prouve rien : la dernière course de l'étape 5 donne la vraie médiane.

| Graine | Trésorerie J60, 9513e97 → final | Première écriture différente |
|---|---:|---|
| 4 | 3 549,79 € → 4 559,56 € | J7 |
| 7 | 8 684,29 € → 6 313,85 € | J5 |
| 42 | 1 411,67 € → 447,17 € | J16 |

Sur un an, graines 1 à 10 : médiane de la trésorerie à J360 environ 36 440 €, contre environ 21 500 € avant les dernières corrections du texte et environ 38 000 € à la lecture d'acceptation. Aucun plantage, aucun écart de grand livre.

### Dernière liste : à lire à S14

L'empreinte n'a pas bougé, le marché si. D1, D2 et N1 changent le texte d'un guide, donc parfois le brouillon gardé. D3 change le titre qu'une couverture imprime, donc `lineBalance`, donc la note visuelle (D138). `balance.ts` n'a pas changé.

| Graine | Trésorerie J60, 878f021 → final | Trésorerie J90, 878f021 → final | Première écriture différente |
|---|---:|---:|---|
| 7 | 7 777,60 € → 6 496,98 € | 14 465,66 € → 11 006,48 € | J43 |
| 11 | 3 427,24 € → 3 404,65 € | 8 399,47 € → 10 509,15 € | J51 |
| 42 | 1 623,79 € → 1 623,79 € | 3 633,24 € → 4 217,45 € | après J60 |
| 12 | | 13 458,19 € → 13 458,19 € | aucune d'ici J90, mais la ligue a bougé : une note de design, `underBar`, une mise à l'épreuve |

- **D3 seul**, D1, D2 et N1 retirés : graine 7 dès J57 (7 777,60 € → 7 735,29 €), graine 11 dès J51 (3 427,24 € → 3 404,65 €). D3 retiré aussi, les écritures et les KPI redeviennent ceux de 878f021 sur les graines 7, 11 et 42. Q-1 retiré en plus, le monde entier leur est égal, jour après jour jusqu'à J60.
- **La même couverture vaut 5,5 points de plus** : « La peur que bébé… » passe de 76 à 81,5 sur la graine 7, de 70,2 à 75,8 sur la graine 42.
- **Les écarts de J90 sont surtout du chaos** : un guide, une note ou une date de lancement qui bouge à J43 déplace tout ce qui suit, dans un sens ou dans l'autre (−24 % sur la graine 7, +25 % sur la graine 11). Ils ne disent pas qu'un meilleur guide vend moins. Pour lire un effet, il faut le contrôle apparié des 30 graines de S14.
- **Les corrections de la porte ne bougent rien** : le monde final est égal, jour après jour jusqu'à J60 sur les graines 7, 11 et 42, à celui d'avant ces corrections (`fitDisplay` élargi, colonne des fiches, cases à cocher, arches, étoiles, soleil, `bare`).

### Rivaux : à lire à S14

Mesuré à la fin de P10.2, rien n'a été réglé dessus (`GROWTH.rivals` reste celui de scale §6).

- **Un clone mord plus fort et plus tôt qu'avant.** Il coûtait environ 4 % de conversion pour de bon (`competition + 0,1`, poids 0,4). Il coûte maintenant 10 % d'un coup, puis s'efface (demi-vie 60 jours). En `normal`, un événement `competitor_clone` tombe environ tous les 33 jours et vise un guide en ligne au hasard : avec un seul guide en vente, ces clones seuls tiennent la niche vers −26 %, tout près du plafond de −30 %.
- **Conséquence visible :** le test `sim.test.ts` « une politique compétente qui n'apprend pas » finissait la graine 3 à +1,45 €, il la finit à −23,30 € (2 clones d'ici J21). Pour cette seule graine, son assertion `bankrupt` est passée à `cash > −50 €`, décision D43. Les graines 1 et 2 ne bougent pas de statut et gardent la leur.
- **La route de la graine 7 :** le premier licenciement du test `talent-league.test.ts` tombe à J127, après la borne de 110 jours du test : la borne est passée à 180, l'assertion n'a pas changé.
- **Rivaux naturels :** sur cette même route, 7 rivaux ont paru d'ici J127 sans qu'aucun événement `competitor_clone` ne tombe : c'est la mécanique qui prend le relais quand les ventes montent.

À S14 : lire d'abord la médiane `normal` avec un seul guide en ligne (les 30 premiers jours), avant d'y voir un défaut de `CONVERSION.base`.

### Réserve et survie : à lire à S14

Mesuré à la porte de S10, rien n'a été réglé dessus. D9 dit `adCap = min(part, trésorerie − réserve)`, et le plancher de la réserve (30 % du départ) est exactement la ligne de survie : sous cette ligne le plafond valait 0 pour de bon et coupait les pubs qui rapportaient. La porte y met une exception, la plus petite qui garde l'intention de D9 : en survie la réserve ne compte plus, et le mode survie suit ses propres règles, celles du témoin (rien de neuf ne se lance, une pub rentable continue).

| Graine, 500 €, `normal` | Avant | Après | Témoin |
|---|---|---|---|
| 13, J120 | 114,55 €, retour à 60 % du départ à J103 | 1 970,37 €, retour à J60 | 1 171,40 €, retour à J63 |
| 10, J175 | faillite à J175, 69 jours de suite à plafond 0 | 43,59 €, 3 jours de suite | 5 052,50 € |
| 9, J175 | 48 jours de suite à plafond 0 | 40,18 €, 4 jours de suite | faillite à J112 |
| 7, créneau 11 de J28 sauté | faillite à J106 | faillite à J106, plafond positif dès J68 | 14 879,42 € à J110 |

Ce qui reste, et qui n'est pas ce défaut :

- **Une pub qui rapporte s'arrête encore quand la trésorerie passe sous une réserve au-dessus du plancher.** Graine 7, créneau sauté : à J62, 214 € en caisse pour 227 € de réserve, plafond 0, et `cpg_13603` s'arrête à un ROAS de 2,5. C'est D9 à la lettre, et `allocator.test.ts` l'épingle.
- **Le mode survie ne lance rien, dans les deux bras** (scale §4.3 : garde-fou inchangé). Une entreprise qui y entre sans pub qui tourne n'en sort que par l'organique. Graine 10 : ses pubs d'avant la chute ne vendaient presque rien, elle reste en survie, à faible dépense.
- **La croissance dépense bien moins que le témoin.** Graine 7, créneau sauté, de J50 à J66 : 5 à 15 €/jour contre environ 180 €/jour. Sur 500 € de départ, avec 11 personnes, la réserve dépasse 45 % du départ.

À S14 : lire ces trois points sur 30 graines, pas sur celles-ci, avant de toucher à `STAGE_POLICY.reserveDays` ou `CFO.reserveSpendShare`.

### Score visuel : à lire à S14, avant le contrôle apparié

Mesuré à la fin de S8, rien n'a été réglé dessus (`sim/visual.ts` reste celui de pdf §12.4).

- **`VISUAL.ref = 70` n'est pas le niveau d'une agence qui démarre,** contrairement à ce que disent pdf §12.4 et le commentaire de `sim/visual.ts`. Sur cinq runs de 60 jours (graines 1, 2, 3, 7, 42), `visual.overall` moyen va de 83,6 à 86,7, le plus bas à 72,3. À 85, chaque produit gagne dès sa première vente environ +7,5 % de conversion, +5 % de prix acceptable, +0,2 étoile et −1,3 point de remboursement.
- **Les cibles de finition 55, 72, 88 de pdf §12.2 ne sont pas atteintes :** `interior` mesuré 79, 95, 96 sur les trois guides de `visual.test.ts` (`cover` 75, 77, 78). Tout l'écart est entre la finition 0 et la finition 1.
- **Conséquence pour la compétition `design` :** le par est à 75 (écart-type 10), tous les graphistes le battent, et les finitions 1 et 2 ne diffèrent que de 2 points d'`overall` moyen quand les guides d'un même run vont de 72 à 90. Le contrôle apparié de pdf §12.5 (designers à 0,25 contre 1) compare justement ces deux finitions : s'attendre à un résultat mince, voire « non prouvé ».

À S14 : soit `ref` passe au niveau de départ mesuré, soit le commentaire de `sim/visual.ts` et pdf §12.4 sont corrigés.

## 4. Résultats

Ces tableaux datent d'avant la V1 : ils mesurent l'ancienne équipe fixe, sans salaires ni embauches. Ils ne servent plus de référence, y compris le critère du §6, jusqu'à la calibration finale (`docs/v1/PLAN.md` §4), qui écrira ici ses candidats, son gagnant et chaque contrôle.

Banc d'essai final : graines 1, 2, 3, 7, 42 × 60 jours × 3 difficultés, 500 € de départ, cerveau heuristique (`npm run balance`, 28 s sur 8 processus).

```
Difficulté │ Graine │ Trésorerie │    Profit │       Pic │  J>0 │ Objectif │ Faillite │    Prod. L/A │       ROAS 1→2 │            CTR 1→2 │   Remb. │ Leçons │ Artefacts
───────────┼────────┼────────────┼───────────┼───────────┼──────┼──────────┼──────────┼──────────────┼────────────────┼────────────────────┼─────────┼────────┼──────────
facile     │ 1      │    5 636 € │   5 136 € │   5 136 € │   J5 │      J24 │      non │          6/0 │    1,59→1,53 ↓ │    2,54 %→2,96 % ↑ │   4,5 % │     36 │     aucun
facile     │ 2      │    3 252 € │   2 752 € │   2 752 € │  J20 │      J46 │      non │          6/0 │    1,22→1,58 ↑ │    2,32 %→3,02 % ↑ │   3,8 % │     34 │     aucun
facile     │ 3      │    6 193 € │   5 693 € │   5 693 € │   J4 │      J16 │      non │          6/0 │    1,67→1,61 ↓ │    2,44 %→2,45 % ↑ │   3,4 % │     36 │     aucun
facile     │ 7      │    5 000 € │   4 500 € │   4 500 € │  J11 │      J25 │      non │          6/0 │    1,61→1,66 ↑ │    1,73 %→2,42 % ↑ │   3,2 % │     35 │     aucun
facile     │ 42     │    4 203 € │   3 703 € │   3 703 € │  J14 │      J42 │      non │          6/0 │    1,37→1,58 ↑ │    2,45 %→2,28 % ↓ │   2,6 % │     33 │     aucun

normal     │ 1      │      717 € │     217 € │     351 € │  J25 │        — │      non │          6/0 │    1,44→0,95 ↓ │    2,77 %→3,08 % ↑ │   7,9 % │     33 │        1F
normal     │ 2      │    1 424 € │     924 € │     924 € │  J10 │        — │      non │          7/1 │    1,24→1,51 ↑ │    2,12 %→3,18 % ↑ │   5,7 % │     39 │        1F
normal     │ 3      │    5 345 € │   4 845 € │   4 845 € │   J4 │      J20 │      non │          6/0 │    1,85→1,46 ↓ │    1,82 %→2,56 % ↑ │   7,1 % │     37 │     aucun
normal     │ 7      │    2 126 € │   1 626 € │   1 626 € │   J8 │      J48 │      non │          7/0 │    1,29→1,42 ↑ │    2,03 %→2,56 % ↑ │   5,5 % │     39 │     aucun
normal     │ 42     │    1 544 € │   1 044 € │   1 044 € │   J9 │      J60 │      non │          5/0 │    1,32→1,41 ↑ │    2,05 %→2,61 % ↑ │   8,3 % │     36 │     aucun

cauchemar  │ 1      │      427 € │     -73 € │       0 € │    — │        — │      non │          5/0 │    0,74→1,26 ↑ │    1,79 %→2,99 % ↑ │  12,2 % │     23 │     aucun
cauchemar  │ 2      │      866 € │     366 € │     366 € │  J32 │        — │      non │          5/0 │    1,07→1,19 ↑ │    2,22 %→2,48 % ↑ │  11,2 % │     29 │        1F
cauchemar  │ 3      │    1 002 € │     502 € │     502 € │  J15 │        — │      non │          5/1 │    1,09→1,61 ↑ │    3,16 %→4,24 % ↑ │  14,2 % │     32 │        1F
cauchemar  │ 7      │      649 € │     149 € │     149 € │  J45 │        — │      non │          5/0 │    0,62→1,28 ↑ │    2,65 %→3,88 % ↑ │  15,9 % │     31 │     aucun
cauchemar  │ 42     │      463 € │     -37 € │       0 € │    — │        — │      non │          4/4 │    0,51→1,39 ↑ │    2,39 %→2,46 % ↑ │  20,5 % │     31 │     aucun

facile     │ profit médian 4 500 € (min 2 752 €, max 5 693 €) · rentables 5/5 · objectif 5/5 · faillites 0/5 · 1er jour > 0 médian J11
normal     │ profit médian 1 044 € (min 217 €, max 4 845 €) · rentables 5/5 · objectif 3/5 · faillites 0/5 · 1er jour > 0 médian J9
cauchemar  │ profit médian 149 € (min -73 €, max 502 €) · rentables 3/5 · objectif 0/5 · faillites 0/5 · 1er jour > 0 médian J32
Apprentissage visible (normal + cauchemar, 10 runs) : CTR 100 % · ROAS 80 % · les deux 80 % des runs font mieux en 2e moitié.
Artefacts : 0 arrêt de pub, 0 jour où le KPI ≠ grand livre, 0 NaN ; 4 falaises, toutes expliquées par une chaîne d'événements
(panne de paiement, arnaque au support, vague de trolls, jours de pub sans aucune vente).
```

| Cible | Visée | Obtenu |
|---|---|---|
| facile | 5/5 rentables, objectif ≥ 4/5, médiane 2 000-6 000 € | 5/5, 5/5, 4 500 € ✔ |
| normal | ≥ 4/5 rentables, objectif 2-4/5, médiane 1 000-3 000 €, 1er jour > 0 entre J8 et J35, aucun run > 6 000 € | 5/5, 3/5, 1 044 €, J4/J8/J9/J10/J25, max 4 845 € ✔ |
| cauchemar | 1-3/5 rentables, ≤ 2 faillites, médiane −300 à +800 € | 3/5, 0, 149 € ✔ |
| apprentissage | ≥ 70 % des runs normal + cauchemar meilleurs en CTR **et** ROAS en 2e moitié | 80 % ✔ |
| artefacts | aucune falaise inexpliquée, aucun arrêt de pub, KPI = grand livre, pas de NaN | ✔ |

**Avant cette calibration** (même banc, mêmes graines) : profit médian 5 567 € en `facile`, 8 249 € en `normal` (max 11 471 €), 1 794 € en `cauchemar` (5/5 rentables) ; rentable dès le jour 3 dans 14 parties sur 15 ; apprentissage visible dans 20 % des parties.

**Robustesse** (15 graines : 1 à 14 et 42) : `facile` médiane 4 345 €, 15/15 rentables et objectif ; `normal` médiane 1 626 €, 15/15 rentables, objectif 12/15, max 4 845 € ; `cauchemar` médiane 149 €, 10/15 rentables, 0 faillite ; apprentissage visible (CTR et ROAS) dans 67 % des 30 parties normal + cauchemar (CTR 83 %, ROAS 73 %). En moyenne, le ROAS passe de 1,29 à 1,43 en `normal` et de 0,88 à 1,26 en `cauchemar` entre les deux moitiés, pendant que la dépense pub est souvent multipliée par 2 à 5.

Une partie dépend beaucoup de son chemin (première niche choisie, premiers avis, un événement au mauvais moment) : deux graines voisines peuvent finir à 200 € et à 4 800 €. C'est voulu (c'est un marché), mais ça veut dire qu'il faut juger un réglage sur au moins 10-15 graines, jamais sur une seule.

## 5. Lancer le banc d'essai

```bash
cd server
npm run balance                                   # graines 1,2,3,7,42 × 60 jours × facile, normal, cauchemar
npx tsx scripts/balance.ts --days 60 --seeds 1,2,3,7,42 --difficulties facile,normal,cauchemar
npx tsx scripts/balance.ts --seeds 1,2,3,4,5,6,7,8,9,10,11,42 --jobs 8      # pour juger un réglage
npx tsx scripts/balance.ts --set ADS.baseCtr=0.006 --set DIFFICULTY.cauchemar.cpmMultiplier=1.5   # essayer une constante sans modifier le code
npx tsx scripts/balance.ts --seeds 7 --difficulties normal --keep --details  # garder le run (runs/bench-normal-7, chargeable dans l'UI)
npx tsx scripts/balance.ts --json resultats.json  # résultats détaillés, jour par jour
```

- Chaque run est une vraie entreprise sans interface (une équipe fondatrice de 8 agents qui recrute quand les chiffres le demandent, cerveau heuristique, PDF et pages de vente réellement générés) dans un dossier temporaire supprimé à la fin, sauf avec `--keep`. Les runs tournent dans `--jobs` processus (3 par défaut ; `--jobs 1` = tout dans le même processus, mêmes résultats). Un run de 60 jours prend ~30 s. Le mode `claude` n'est jamais utilisé par le banc (aucune clé n'est transmise).
- Colonnes : **J>0** = premier jour où le profit cumulé (frais de démarrage compris) passe au-dessus de 0 ; **Objectif** = premier jour à 1 000 € de profit cumulé ; **Faillite** = trésorerie négative un soir ; **Prod. L/A** = produits en ligne / arrêtés ; **ROAS 1→2** et **CTR 1→2** = pubs payantes des jours 1-30 puis 31-60 (↑ = mieux en 2e moitié) ; **Remb.** = part des commandes remboursées ou contestées ; **Leçons** = leçons chiffrées écrites dans le cerveau.
- **Artefacts** surveillés : **F** = falaise (le profit cumulé perd plus de 40 % d'un pic ≥ 100 € en moins de 7 jours ; `--details` liste la chaîne qui l'explique : événements du marché, jours de pub sans vente, vagues de remboursements) ; **S** = plus de 2 jours sans pub alors qu'il reste plus de 30 % de la trésorerie de départ, un produit vendable et un compte pub actif ; **K** = KPI du jour ≠ somme du grand livre ; **N** = valeur non numérique.
- `--set CHEMIN=N` remplace une constante de `server/src/sim/balance.ts` le temps du banc (chemin inconnu = erreur, pour ne jamais mesurer le marché par défaut sans le savoir).
- Les tests `server/test/balance.test.ts` vérifient aussi qu'un run de 5 jours fonctionne en mode **validation fondateur** (la mise en ligne attend le fondateur ; en approuvant, le guide passe en ligne) et en mode **`claude` sans clé** (repli heuristique, exactement le même run).

## 6. Critère de sortie de la phase 1 (passage à la phase 2 de `docs/ROADMAP.md`)

La phase 2 (« réel en lecture seule ») ne commence que si, sur la version à livrer :

1. `npm run balance` (graines 1, 2, 3, 7, 42, 60 jours, 500 €) donne :
   - en `normal` : profit cumulé positif **avant le jour 40** sur au moins 4 graines sur 5, et toujours positif au jour 60 sur au moins 4 sur 5 ;
   - en `cauchemar` : **aucune faillite** sur au moins 3 graines sur 5 ;
   - l'apprentissage visible (CTR **et** ROAS meilleurs en 2e moitié) dans au moins 70 % des parties `normal` + `cauchemar` ;
   - zéro arrêt de pub, zéro écart KPI / grand livre, zéro NaN, et aucune falaise sans chaîne d'événements.
2. Les mêmes chiffres tiennent à peu près sur 15 graines (médiane `normal` entre 1 000 et 3 000 €, aucune faillite en `normal`).
3. `npx tsc -p server/tsconfig.json`, `npx tsc -p web/tsconfig.json` et `cd server && npx vitest run` sont verts.

État de cette version : **critère rempli** (profit positif avant J40 en `normal` sur 5/5 graines — J4 à J25 —, 0 faillite en `cauchemar`, apprentissage visible dans 80 % des parties, aucun artefact).

## 7. Limites connues

- Le rédacteur heuristique produit des guides et des pages de vente que le marché note 90-100/100 dès la v1 : la qualité ne différencie presque plus les produits, et les réécritures v2/v3 n'améliorent pas la conversion. L'apprentissage visible vient surtout des pubs (angle, format), du prix et de l'allocation du budget. Un évaluateur plus exigeant (ou le mode Claude) rendrait la boucle qualité utile.
- En 2e moitié, une partie qui a trouvé un gros gagnant tôt voit souvent son ROAS baisser (elle scale jusqu'à la saturation : c'est la bonne décision pour le profit) ; c'est la principale raison des runs où le ROAS ne progresse pas.
- En `cauchemar`, environ deux tiers des parties sur 15 graines finissent légèrement rentables, un peu plus que la cible « 1 à 3 sur 5 » ; les 5 graines du banc sont dans la cible.
- La règle douce de réécriture (remboursements > 10 % sur 8 ventes) déclenche encore des v2/v3 inutiles en `cauchemar`, où les chasseurs de remboursement font partie du marché.
- Le critère « premier jour > 0 » reste sensible à la chance des premiers jours (une très bonne journée au jour 4 suffit) ; regarder aussi la courbe complète avec `--json`.
