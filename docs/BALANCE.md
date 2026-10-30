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

Clients pénibles, arnaques au support (« remboursez-moi la différence »), faux créateurs qui encaissent une avance, pubs refusées (mots interdits : « garanti », kilos, gains d'argent…) puis compte suspendu au 3e avertissement, concurrent qui clone le guide, tendance qui baisse, panne de paiement, réserve du prestataire de paiement (gèle une partie de la trésorerie, jamais plus de la moitié, pendant 7 jours, sans bloquer les ventes), vague de trolls, pic de CPM. Les **frais fixes** : 60 € de démarrage (thème de boutique, domaine, pixel, outil e-mail, au premier jour), boutique 29 €/mois, outils 12 €/mois, frais de paiement 1,5 % + 0,25 €.

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
| `runtime/strategy.ts` — arrêt d'un produit | < 3 ventes et ROAS < 0,7 après 7 jours | idem, mais seulement sur un vrai échantillon : ≥ 450 visiteurs payants (`KILL_MIN_VIEWS`) ou ≥ 14 jours en ligne (`KILL_NO_TRACTION_DAYS`) | Après 7 jours et ~100 € de pub (200 visiteurs), < 3 ventes à 2 % de conversion arrive une fois sur cinq par malchance : la première niche, souvent la meilleure, était tuée dans un tiers des parties. |
| `runtime/strategy.ts` — prix (`priceMove`) | seule règle : monter d'un palier après 10 ventes, sans jamais revenir ; le gagnant d'un test A/B n'était jamais appliqué | test conclu → gagnant appliqué ; test non concluant → retour au prix d'avant ; hausse qui fait perdre > 15 % de revenu par visiteur (150 visiteurs de chaque côté) → annulée, palier abandonné ; < 0,8 % de conversion sur 300 visiteurs → un palier plus bas | Des guides restaient à 39-49 € pour une niche qui paie 33 € maximum (conversion ÷ 5). |
| `runtime/handlers/ops.ts` — tests de prix | toujours « un palier au-dessus », un seul test par guide | vers le bas si la conversion payante est < 1,5 % (`PRICE_TEST_LOW_CVR`), sinon vers le haut ; un nouveau test tous les 12 jours | Un guide lancé trop cher ne pouvait jamais apprendre à baisser. |
| `learning/experiments.ts` — gagnant d'un test de prix | le meilleur revenu par visiteur, même sur 1 vente contre 0 ; conclusion possible à 60 visiteurs | ≥ 8 ventes au total et ≥ 10 % d'écart, sinon pas de gagnant ; 120 visiteurs par variante pour conclure avant 7 jours | « 19 € gagne » sur une vente chanceuse gardait un guide à un prix que personne ne payait. |
| `learning/retro.ts` — récompense des bandits hook/format | CTR / 3 % (plafonné à 1) | CTR / 5 % ; une créa déjà vue plus de 30 000 fois ne compte qu'à 25 % | Toutes les bonnes créas (3-5 % de CTR) valaient 1, et le meilleur style, celui qu'on fait tourner le plus longtemps, était puni pour sa propre fatigue. |
| `runtime/handlers/growth.ts` — choix du hook d'une nouvelle créa | la n-ième créa prenait le n-ième hook inutilisé | tirage de Thompson sur les styles disponibles (hors créneau d'expérience) ; si le style choisi n'a plus de hook neuf, nouvelle exécution d'un hook déjà utilisé (jamais un hook refusé par TikTok) | Le rédacteur heuristique n'a que 2 à 4 textes par style : le meilleur style d'une niche s'épuisait après 2-3 créas et n'était pas plus utilisé qu'un style au hasard (15 % → 21 % des créas entre les deux moitiés ; maintenant 16 % → 29 %). |
| `runtime/acquisition.ts` — remboursements qui bloquent un produit | > 15 % (significatif) → pause, puis arrêt à la v3 | idem seulement si le produit ne rembourse plus sa pub nette des remboursements (ROAS < 1,1) ou si les remboursements dépassent 25 % | En `cauchemar`, les chasseurs de remboursement font 10-17 % des commandes : le meilleur produit d'une partie (ROAS 1,4) était mis en pause puis tué. |
| `sim/tools.ts` — troll « nourri » | 1 étoile sur la boutique, acheteur ou non | 1 étoile seulement s'il a acheté ; sinon il revient en message | Des guides notés 99/100 étaient tués par 3 avis 1 étoile de trolls qui n'avaient rien acheté (26 des 33 avis ≤ 2 étoiles sur 4 parties). |

## 4. Résultats

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

- Chaque run est une vraie entreprise sans interface (31 agents, cerveau heuristique, PDF et pages de vente réellement générés) dans un dossier temporaire supprimé à la fin, sauf avec `--keep`. Les runs tournent dans `--jobs` processus (3 par défaut ; `--jobs 1` = tout dans le même processus, mêmes résultats). Un run de 60 jours prend ~10 s. Le mode `claude` n'est jamais utilisé par le banc (aucune clé n'est transmise).
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
