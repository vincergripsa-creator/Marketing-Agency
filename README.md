# Pixel Agency — l'agence marketing autonome en pixel art

Une agence marketing composée de **31 agents IA** qui travaillent **seuls**, comme une vraie entreprise : une CEO qui fixe le cap chaque matin, des chefs d'équipe qui délèguent, une Red Team et un fact-checker qui contrôlent tout avant livraison, et un **cerveau partagé** (vault Obsidian) que chaque agent lit avant d'agir et enrichit après.

L'agence fabrique et vend des **guides PDF à forte valeur ajoutée** (avec visuels), les met en vente sur sa boutique et les promeut avec des **pubs TikTok**, de l'organique et des créateurs à la commission.

**Phase actuelle : environnement virtuel.** Les livrables sont réels (vrais PDF illustrés, vraies pages de vente, vrais storyboards de pubs), mais le marché est simulé — clients pénibles, arnaques, pubs refusées, concurrents, imprévus — et l'agence doit devenir **rentable à partir d'un budget de départ**, en apprenant de ses erreurs. Rien n'est publié, aucun euro réel n'est dépensé.

## Démarrer

Prérequis : Node.js 22 ou plus.

```bash
npm install
```

```bash
npm run dev
```

Puis ouvrir <http://localhost:5173>. L'agence démarre seule et travaille sans qu'on lui demande rien.

## Ce que tu vois à l'écran

- **Le bureau** : une île flottante par département (Direction, Recherche, Studio, Création, Growth, Boutique, Support, Analyse, Finance, RH, Partenariats), reliées par des ponts, avec au centre la **fontaine-cerveau** et la cafétéria. Les 31 agents marchent, travaillent à leur poste, se réunissent au stand-up du matin et à la rétro du soir ; une bulle montre ce qu'ils font. Le ciel suit l'heure de la journée simulée.
- **Le HUD** : trésorerie, profit cumulé, jour et heure, vitesse (pause, ×1, ×2, ×4, ×8), avancer d'un tick ou d'une journée.
- **Le fil d'activité** en direct (travail, cerveau, marché) et des notifications pour les ventes, arnaques, pubs refusées, avis…
- **La barre de mission** « Donne une mission à Camille… » : la CEO (ou l'agent choisi) transforme ta demande en tâches pour son équipe.
- **Clic sur un agent** : discussion avec lui, sa fiche (rôle, revue RH, travail en cours) et son playbook. **Clic sur une île** : aperçu, tâches et calendrier du département.
- **Les onglets** (touches 1 à 0) : Bureau, Tâches, Calendrier, Produits (chaque guide, ses versions, son PDF, sa page de vente, ses scores), Pub TikTok (créas, storyboards, campagnes, CTR/ROAS), Boîte mail (clients pénibles et réponses du support), Finance (grand livre, budget), Cerveau (le vault de la run), Apprentissage (bandits, expériences A/B, leçons), Galerie (tous les visuels).
- **Nouveau scénario** : budget de départ, horizon, objectif de profit, difficulté (`facile`, `normal`, `cauchemar`), graine du marché, mode cerveau et **validation fondateur** (chaque mise en ligne attend ton clic dans l'onglet Tâches).

## Comment l'agence travaille seule

Une journée simulée = 12 ticks.

| Tick | Ce qui se passe |
|---|---|
| 0 | **Stand-up** : la CEO (Camille) lit les KPI de la veille, les leçons et les playbooks, décide quoi lancer, scaler, corriger ou arrêter, et délègue aux chefs d'équipe. |
| 1-9 | **Travail** : recherche de niches et de douleurs clients, plan et rédaction des guides, visuels, fact-check (Samuel), Red Team (Axel), page de vente, mise en ligne, créas TikTok, campagnes, posts organiques, support client, partenariats créateurs, suivi du budget. |
| 10 | **Clôture du marché** : les clients virtuels voient les pubs, cliquent, achètent, se plaignent, demandent des remboursements, laissent des avis. |
| 11 | **Rétro du soir** : l'Analyse calcule les KPI, les bandits apprennent quels hooks, formats et prix marchent, les expériences A/B concluent, des leçons chiffrées sont écrites dans le cerveau et deviennent des règles de playbook. Les revues RH tombent chaque semaine. |

**Ce qu'elle apprend** : l'angle des pubs (style de hook et format par niche), le bon prix (tests A/B mesurés en revenu par visiteur, retour en arrière si une hausse coûte), où mettre l'argent (stop-loss, scale progressif, arrêt des produits perdants, nouvelle niche), quand réécrire un guide (v2, v3) et le ton du support. Chaque leçon est datée, chiffrée, confirmée ou révisée au fil des jours.

**Garde-fous** (dans le code, pas seulement dans le cerveau) : la pub ne dépasse pas une part de la trésorerie, stop-loss sur les campagnes perdantes, aucune dépense hors budget, rien de réel publié, rien d'inventé (fact-check), plafond de coût pour le mode Claude.

## Résultats actuels

Banc d'essai : 5 graines × 60 jours × 3 difficultés, 500 € de départ, objectif 1 000 € de profit (`npm run balance`).

| Difficulté | Profit médian à J60 | Rentables | Objectif atteint | Faillites |
|---|---|---|---|---|
| facile | 4 500 € | 5/5 | 5/5 | 0 |
| normal | 1 044 € | 5/5 | 3/5 | 0 |
| cauchemar | 149 € | 3/5 | 0/5 | 0 |

L'apprentissage se voit : dans 80 % des parties `normal` et `cauchemar`, le CTR **et** le ROAS des jours 31-60 battent ceux des jours 1-30, alors que l'agence dépense 2 à 5 fois plus en 2e moitié. Détails, modèle du marché et calibration : [docs/BALANCE.md](docs/BALANCE.md).

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `npm run dev` | Serveur (port 4317) + interface (port 5173) |
| `npm run sim -- --days 60 --budget 500 --difficulty cauchemar --seed 7` | Une partie accélérée sans interface (`--verbose` pour voir le fil des agents) |
| `npm run balance -w server` | Le banc d'essai complet (≈ 30 s) |
| `npm test` | Tous les tests (serveur + interface) |
| `npm run typecheck` | Vérification TypeScript des deux espaces |

Les fichiers produits (PDF, couvertures, pages de vente, pubs, cerveau de la run, `world.json`) sont dans `runs/<id>/` (non commité).

## Deux modes de cerveau

| Mode | Coût | Ce qui se passe |
|---|---|---|
| `heuristic` (défaut sans clé) | 0 € | Les agents écrivent avec des générateurs procéduraux nourris par leurs recherches de marché. Déterministe : idéal pour tester et équilibrer. |
| `claude` | tokens réels | Chaque agent pense et écrit avec Claude (Opus pour la CEO et la Red Team, Sonnet pour la rédaction, Haiku pour le volume). Plafond `MAX_COMPUTE_EUR` par run, repli automatique sur l'heuristique à chaque appel qui échoue. |

Pour activer Claude : copier `.env.example` en `.env` et renseigner `ANTHROPIC_API_KEY` (le fichier `.env` n'est jamais commité — ce repo est public). `MIND_MODE=auto` utilise Claude dès qu'une clé est présente.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `shared/types.ts` | Le modèle de données complet (entreprise + marché caché) |
| `server/src/sim/` | Le marché virtuel : niches à vérité cachée, plateforme pub TikTok, clients pénibles, événements, grand livre |
| `server/src/deliverables/` | PDF illustrés, couvertures, pages de vente, storyboards de pubs |
| `server/src/minds/` | Le moteur d'écriture et de décision (heuristique ou Claude) |
| `server/src/learning/` | KPI, bandits, expériences, leçons, playbooks, rétro |
| `server/src/runtime/` | L'entreprise : les 31 agents, la journée type, la stratégie de la CEO, les tâches par département |
| `server/src/api/` | Serveur HTTP + flux temps réel (SSE) |
| `web/` | Le bureau en pixel art et les panneaux |
| `brain/` | Le cerveau de départ (règles du business, politiques, playbooks) |

## Documentation
- [Architecture](docs/ARCHITECTURE.md) — modules, journée type, modèle du marché, apprentissage
- [Équilibrage](docs/BALANCE.md) — comment le marché décide, ce que l'agence doit apprendre, résultats
- [Vidéos de référence](docs/REFERENCES.md) — ce qu'on reprend de chaque vidéo
- [Feuille de route](docs/ROADMAP.md) — du virtuel au réel
- [`brain/`](brain/00%20-%20Accueil.md) — le cerveau de départ de l'agence
