# Pixel Agency — l'agence marketing autonome en pixel art

Une agence marketing d'agents IA qui travaillent **seuls**, comme une vraie entreprise : **une équipe fondatrice de 8 agents qui recrute quand les chiffres le demandent**, une CEO qui fixe le cap chaque matin, des chefs d'équipe qui délèguent, une Red Team et un fact-check qui contrôlent tout avant livraison, et un **cerveau partagé** (vault Obsidian) que chaque agent lit avant d'agir et enrichit après. Les agents sont notés sur leurs résultats : celui qui reste sous la barre passe un vrai test contre des candidats, et le poste change de main si l'un d'eux fait mieux.

L'agence fabrique et vend des **guides PDF à forte valeur ajoutée** (avec visuels), les met en vente sur sa boutique et les promeut avec des **pubs vidéo** sur cinq canaux (TikTok, Facebook & Instagram, YouTube Shorts, Pinterest, Google Search), de l'organique, des créateurs à la commission et sa propre liste e-mail.

**Phase actuelle : environnement virtuel.** Les livrables sont réels (vrais PDF illustrés, vraies pages de vente, vraies vidéos de pub en MP4), mais le marché est simulé — clients pénibles, arnaques, pubs refusées, concurrents, imprévus — et l'agence doit devenir **rentable à partir d'un budget de départ**, en apprenant de ses erreurs. Rien n'est publié, aucun euro réel n'est dépensé.

## Démarrer

Il te faut Node.js 22 ou plus. Rien d'autre : ni compte, ni clé, ni carte.

```bash
npm ci
npm run agency
```

Puis ouvre <http://localhost:4317>.

`npm ci` installe tout (22 s sur une copie propre). `npm run agency` construit l'interface si elle manque, lance le serveur en moins de 10 s, le relance s'il tombe, et reprend la même partie là où elle en était. Ses messages vont aussi dans `runs/agency.log`. Pour l'arrêter : Ctrl+C dans le terminal.

**La première fois**, une partie démarre seule, sans rien te demander : 500 €, difficulté `normal`, sans fin, graine 42, à ×1 (une journée simulée en 24 s). Les 8 fondateurs sont déjà au travail, et le premier guide sort en quelques jours simulés. Cette graine 42 est l'une des plus dures du banc : elle finit à -53 € au jour 60. Pour voir une autre partie : **Nouveau scénario**, et le dé à côté de la graine. Le bouton ×8 fait passer une journée en quelques secondes. Ces vitesses valent quand une page est ouverte, et 5 minutes après : sans personne qui regarde, l'agence passe à une année simulée par semaine réelle, environ 28 minutes par journée, quel que soit le bouton de vitesse. Elle reprend sa vitesse dès que tu reviens.

Pour travailler sur le code : `npm run dev` lance le serveur et une interface sur <http://localhost:5173>.

## Ce que tu vois à l'écran

- **Le bureau** : une île flottante par département ouvert, reliées par des ponts, avec au centre la **fontaine-cerveau**, la cafétéria, le tableau de la ligue, le podium, la table des duels et un totem par canal. Un département sans personne reste un terrain vide, une île s'agrandit avec son équipe, les recrues arrivent par le quai et les partants y repartent. Les agents marchent, travaillent à leur poste, se réunissent au stand-up du matin et à la rétro du soir ; une bulle montre ce qu'ils font. Le ciel suit l'heure de la journée simulée.
- **Le résumé du fondateur** : après 7 jours simulés sans regarder, il s'ouvre seul (touche `d` pour le rouvrir) et dit ce qui a changé : l'argent, l'équipe, les décisions. Après un arrêt d'au moins une minute, il nomme le trou.
- **Le HUD** : trésorerie, profit cumulé, jour et moment de la journée (matin, travail, marché, soir), vitesse (pause, ×1, ×2, ×4, ×8), avancer d'un tick ou d'une journée.
- **Le fil d'activité** en direct (travail, cerveau, marché) et des notifications pour les ventes, arnaques, pubs refusées, avis…
- **La barre de mission** « Donne une mission à Camille… » : la CEO (ou l'agent choisi) transforme ta demande en tâches pour son équipe. En mode `heuristic`, ta demande se lit par mots-clés, pas par le sens : elle ne tient pas toujours (`docs/BALANCE.md` §7).
- **Clic sur un agent** : une discussion, sa fiche (rôle, performance, travail en cours) et son playbook. **Clic sur une île** : aperçu, tâches et calendrier du département.
- **Les onglets** (touches 1 à 0, et `m`, `c`, `b`, `a` sous « Plus ») : Bureau, Tâches, Produits (chaque guide, ses versions, son PDF, sa page de vente, ses scores), Publicité (créas, films à regarder avec le son, campagnes, CTR/ROAS), Canaux (ce que chaque plateforme annonce et ce que la boutique a vraiment encaissé), Croissance (paliers, portefeuille, liste e-mail), Effectif (organigramme, masse salariale, postes ouverts, refus du CFO), Compétition (classement, plans d'amélioration, duels, dernier recrutement, transferts, panthéon, anciens), Finance (grand livre, budget), Galerie (tous les visuels, les vidéos, les PDF à feuilleter), Boîte mail (clients pénibles et réponses du support), Calendrier, Cerveau (le vault de la run), Apprentissage (bandits, expériences A/B, leçons).
- **Nouveau scénario** : budget de départ, horizon (ou « Sans fin »), objectif de profit, difficulté (`facile`, `normal`, `cauchemar`), graine du marché, mode cerveau et **validation fondateur** (chaque mise en ligne, canal, embauche, remplacement, licenciement et envoi à la liste attend ton clic dans l'onglet Tâches).

## Ce qui est virtuel, ce qui est réel, ce qui ne coûte rien

| | |
|---|---|
| **Virtuel** | Le marché, les clients, les ventes, les avis, la trésorerie, les plateformes. Une page de vente porte le bandeau « Boutique virtuelle Pixel Agency — environnement de test, aucun paiement réel », un film la mention « Pub simulée — jamais publiée ». |
| **Réel** | Les fichiers : PDF, pages de vente HTML, vidéos MP4. Ils sont dans `runs/<id>/`, sur ta machine, et nulle part ailleurs. |
| **Gratuit** | Tout, en mode `heuristic`, le mode par défaut : 0 €, aucune clé, aucune requête vers l'extérieur. Les polices sont servies en local. Rien n'est publié, aucun euro réel n'est dépensé. |
| **Payant, et seulement si tu le choisis** | Le mode `claude`, voir plus bas. |

Les films ont besoin de `ffmpeg-static` et `@napi-rs/canvas`, que `npm ci` installe. La voix off est celle de ta machine : une voix française de Windows, Hortense d'abord. Sans voix, sans pages ou sans ffmpeg, la partie continue et l'interface dit ce qui manque. Une pub n'a pas toujours son film : seules celles qui attendent ta décision, ou qui tournent avec au moins 1 000 impressions et une qualité d'au moins 70, sont rendues d'elles-mêmes, 3 en file au plus. Pour les autres, le lecteur propose « Générer la vidéo ».

## Comment l'agence travaille seule

Une journée simulée = 12 ticks.

| Tick | Ce qui se passe |
|---|---|
| 0 | **Stand-up** : la CEO (Camille) lit les KPI de la veille, les leçons et les playbooks, décide quoi lancer, scaler, corriger ou arrêter, et délègue aux chefs d'équipe. |
| 1-9 | **Travail** : recherche de niches et de douleurs clients, plan et rédaction des guides, visuels, fact-check, Red Team, page de vente, mise en ligne, vidéos de pub, campagnes, posts organiques, support client, partenariats créateurs, suivi du budget. |
| 10 | **Clôture du marché** : les clients virtuels voient les pubs, cliquent, achètent, se plaignent, demandent des remboursements, laissent des avis. |
| 11 | **Rétro du soir** : l'Analyse calcule les KPI, les bandits apprennent quels hooks, formats et prix marchent, les expériences A/B concluent, des leçons chiffrées sont écrites dans le cerveau et deviennent des règles de playbook. Les revues RH tombent chaque semaine. |

**Ce qu'elle apprend** : l'angle des pubs (style de hook et format par niche), le bon prix (tests A/B mesurés en revenu par visiteur, retour en arrière si une hausse coûte), où mettre l'argent (stop-loss, scale progressif, arrêt des produits perdants, nouvelle niche), quand réécrire un guide (v2, v3) et le ton du support. Chaque leçon est datée, chiffrée, confirmée ou révisée au fil des jours.

**Comment elle recrute** : au départ, les 8 fondateurs portent à eux seuls toutes les tâches, en chapeaux sur ce qui n'est pas leur métier : plus lent, et moins bien. Chaque soir la DRH lit où le travail attend. Un goulot qui dure ouvre un poste si la marge paie le salaire, sinon le CFO refuse et dit pourquoi. Chaque candidat passe un vrai test. Les salaires sont au grand livre, l'effectif s'arrête à 60, et l'agence licencie quand l'argent manque.

**Comment elle se met en compétition** : une saison dure 14 jours. La note ne lit que des résultats observés (qualité, ventes, réponses), jamais le talent caché. Sous la barre avec assez de preuves : un plan de 14 jours et un coach. Plan raté : le titulaire et 6 candidats passent 24 fois le même test réel, et le poste change de main seulement si l'un d'eux bat le titulaire de l'écart que ce test sait séparer du bruit : deux erreurs types de la différence entre les moyennes, jamais moins de 1 point. La CEO et les postes sans effet mesurable restent hors ligue : 15 rôles sur 35, dont le CFO et la DRH. Sur cinq compétences (`design`, `support`, `buying`, `research`, `polish`), le test ne voit pas le talent : un plan raté y finit sans candidat.

**Comment elle passe à l'échelle** : quatre paliers (Survie, Adéquation, Accélération, Portefeuille). Le CFO partage l'argent entre ce qui marche, les tests et la réserve, et le répartit entre les canaux selon le ROAS moyen mesuré à la boutique, pas selon ce que chaque plateforme s'attribue. L'onglet Canaux montre les deux lectures. TikTok est ouvert dès le jour 1, sans media buyer. Chacun des quatre autres canaux s'ouvre quand ses conditions sont réunies et qu'un media buyer le tient. Les guides sont lancés, doublés, retravaillés, exploités ou arrêtés au vu des chiffres, et la liste e-mail vend aux clients déjà acquis.

**Garde-fous** (dans le code, pas seulement dans le cerveau) : la pub ne dépasse pas une part de la trésorerie, stop-loss sur les campagnes perdantes, aucune dépense hors budget, rien de réel publié, rien d'inventé (fact-check), plafond de coût pour le mode Claude. En mode **validation fondateur**, chaque canal, embauche, remplacement, licenciement et envoi à la liste attend ton clic.

## Résultats actuels

Code final `67a5152`, graines 1 à 30, 60 jours, 500 € de départ, sans fin, objectif 1 000 € de profit. Les quartiles sont la médiane de chaque moitié des graines.

| Difficulté | Profit médian à J60 | Q1 / Q3 | Rentables | À perte | Objectif atteint | Faillites |
|---|---:|---:|---:|---:|---:|---:|
| facile | 8 857 € | 4 271 / 11 329 € | 28/30 | 2 | 26/30 | 0 |
| normal | 2 728 € | 245 / 5 224 € | 24/30 | 6 | 21/30 | 0 |
| cauchemar | -187 € | -375 / 852 € | 14/30 | 16 | 7/30 | 0 |

Sur 182 jours, en `normal` : 24 955 € de profit médian à J180 (Q1 18 339 €, Q3 38 782 €), 28/30 positives, 16,5 personnes en médiane, un chiffre d'affaires qui plafonne près de 4 500 € par semaine.

**Ce que ces chiffres ne disent pas :**

- **2 faillites sur 30 à J180** (graines 5 et 20, remontées, vivantes à J182), exactement à la limite du contrôle K3. La course de 60 jours ne peut pas les voir, et environ 1 graine sur 10 reste près de la mort.
- **Deux contrôles de calibration sur huit échouent sur le code livré :** K7 (0 remplacement en médiane, 5 en 30 entreprises sur 182 jours) et K8 (pente positive sur 20/30 pour 24, semaine 26 / semaine 9 à 1,79 pour 2,0). Le gagnant a été choisi par K8, à l'intérieur de son bruit.
- **Deux lignes d'acceptation sont en échec :** A6 (p95 d'une journée, 1 060 ms pour 800, lu sur `11b3f20`) et A10 (la compétition remplace trop peu).
- **Le critère de sortie de la phase 1 n'est pas rempli à la lettre :** apprentissage visible 40 % pour 70 %, 3 arrêts de pub pour 0. Passer à la phase 2 reste ta décision.
- **Le mode Claude n'a jamais été appelé en vrai, et personne n'a écouté un film.** Le son a été mesuré, pas entendu. Écoute-en un.

Tout est dans [docs/BALANCE.md](docs/BALANCE.md) (§4 résultats, §6 critère, §7 limites) et [docs/v1/ACCEPTANCE.md](docs/v1/ACCEPTANCE.md) (les 28 lignes, les contrôles, les coupes).

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `npm run agency` | L'agence sans interruption, sur le port 4317 : relance le serveur s'il tombe, reprend la même partie |
| `npm run dev` | Pour le code : serveur (port 4317) + interface (port 5173) |
| `npm run build` | Construit l'interface, si tu veux le faire à la main |
| `npm run sim -- --days 60 --budget 500 --difficulty cauchemar --seed 7` | Une partie accélérée sans interface (`--verbose` pour voir le fil des agents) |
| `npm run balance -w server` | Le banc d'essai : 15 runs de 60 jours (133 s à 3 processus, voir `docs/BALANCE.md` §5) |
| `npm test` | Tous les tests (serveur + interface) |
| `npm run typecheck` | Vérification TypeScript des deux espaces |

Les fichiers produits (PDF, couvertures, pages de vente, pubs, vidéos, cerveau de la run, `world.json`) sont dans `runs/<id>/` (non commité).

## Deux modes de cerveau

| Mode | Coût | Ce qui se passe |
|---|---|---|
| `heuristic` (défaut sans clé) | 0 € | Les agents écrivent avec des générateurs procéduraux nourris par leurs recherches de marché. Déterministe : idéal pour tester et équilibrer. Tous les chiffres de ce dépôt viennent de ce mode. |
| `claude` (optionnel) | tokens réels, sur ton compte Anthropic | Chaque agent pense et écrit avec Claude, et le modèle suit son poste, pas le travail : Opus pour la CEO, la rédactrice en chef, le head of growth et la Red Team, Sonnet pour la plupart des postes, Haiku pour les postes de volume. Un agent faible écrit un cran plus bas. Plafond `MAX_COMPUTE_EUR` par run, 3 € par défaut, repli automatique sur l'heuristique à chaque appel qui échoue. |

Pour activer Claude, il faut une clé de l'API Anthropic : copie `.env.example` en `.env` et renseigne `ANTHROPIC_API_KEY` (le fichier `.env` n'est jamais commité, ce dépôt est public). `MIND_MODE=auto` utilise Claude dès qu'une clé est présente, `heuristic` l'ignore. Sans clé, le mode `claude` se replie sur l'heuristique et le formulaire le dit. Ce mode est testé sur un faux client, jamais contre la vraie API : le premier appel réel sera le tien.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `shared/types.ts` | Le modèle de données complet (entreprise + marché caché) |
| `server/src/sim/` | Le marché virtuel : niches à vérité cachée, cinq canaux publicitaires, clients pénibles, événements, grand livre |
| `server/src/deliverables/` | PDF illustrés, couvertures, pages de vente, storyboards de pubs |
| `server/src/video/` | Le rendu MP4 des pubs : scènes, voix, musique, encodage, contrôle qualité |
| `server/src/minds/` | Le moteur d'écriture et de décision (heuristique ou Claude) |
| `server/src/learning/` | KPI, bandits, expériences, leçons, playbooks, rétro |
| `server/src/runtime/` | L'entreprise : la journée type, la stratégie de la CEO, les tâches par département, les canaux, le CFO, le portefeuille |
| `server/src/runtime/org/` | L'effectif : rôles, chapeaux, paie, charge, embauches, départs |
| `server/src/runtime/talent/` | La ligue : notes, saisons, plans d'amélioration, duels, remplacements |
| `server/src/api/` | Serveur HTTP + flux temps réel (SSE) |
| `web/` | Le bureau en pixel art et les panneaux |
| `brain/` | Le cerveau de départ (règles du business, politiques, playbooks) |

## Documentation
- [Architecture](docs/ARCHITECTURE.md) — modules, journée type, modèle du marché, apprentissage, ce que la V1 a coupé
- [Équilibrage](docs/BALANCE.md) — comment le marché décide, ce que l'agence doit apprendre, résultats, critère de sortie, limites
- [Acceptation](docs/v1/ACCEPTANCE.md) — les 28 lignes de la V1, chacune avec son nombre et son commit
- [Plan de la V1](docs/v1/PLAN.md) — le registre de construction : les décisions et les spécifications de chaque pilier
- [Vidéos de référence](docs/REFERENCES.md) — ce qu'on reprend de chaque vidéo
- [Feuille de route](docs/ROADMAP.md) — du virtuel au réel
- [`brain/`](brain/00%20-%20Accueil.md) — le cerveau de départ de l'agence
