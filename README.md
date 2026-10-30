# Pixel Agency — l'agence marketing autonome en pixel art

Une agence marketing composée de **31 agents IA** qui travaillent **seuls**, comme une vraie entreprise : une CEO qui fixe le cap chaque matin, des chefs d'équipe qui délèguent, une Red Team et un fact-checker qui contrôlent tout avant livraison, et un **cerveau partagé** (vault Obsidian) que chaque agent lit avant d'agir et enrichit après.

L'agence fabrique et vend des **guides PDF à forte valeur ajoutée** (avec visuels), les met en vente sur sa boutique et les promeut avec des **pubs TikTok**, de l'organique et des créateurs à la commission.

**Phase actuelle : environnement virtuel.** Les livrables sont réels (vrais PDF illustrés, vraies pages de vente, vrais storyboards de pubs), mais le marché est simulé — clients pénibles, arnaques, pubs refusées, concurrents, imprévus — et l'agence doit devenir **rentable à partir d'un budget de départ**, en apprenant de ses erreurs.

## Démarrer

```bash
npm install
```

```bash
npm run dev
```

Puis ouvrir <http://localhost:5173>. L'agence démarre seule (vitesse ×1) ; la barre du haut permet d'accélérer, de mettre en pause, d'avancer d'un jour ou de lancer un nouveau scénario (budget, difficulté, objectif).

Simulation accélérée sans interface (60 jours, difficulté cauchemar) :

```bash
npm run sim -- --days 60 --budget 500 --difficulty cauchemar --seed 7
```

Les fichiers produits (PDF, couvertures, pages de vente, pubs, cerveau de la run) sont dans `runs/<id>/`.

## Deux modes de cerveau

| Mode | Coût | Ce qui se passe |
|---|---|---|
| `heuristic` (défaut sans clé) | 0 € | Les agents écrivent avec des générateurs procéduraux nourris par leurs recherches de marché. Déterministe : idéal pour tester. |
| `claude` | tokens réels | Chaque agent pense et écrit avec Claude (Opus pour la CEO et la Red Team, Sonnet pour la rédaction, Haiku pour le volume). Plafond `MAX_COMPUTE_EUR` par run, repli automatique sur l'heuristique. |

Pour activer Claude : copier `.env.example` en `.env` et renseigner `ANTHROPIC_API_KEY` (le fichier `.env` n'est jamais commité — ce repo est public).

## Documentation
- [Architecture](docs/ARCHITECTURE.md) — modules, journée type, modèle du marché, apprentissage
- [Vidéos de référence](docs/REFERENCES.md) — ce qu'on reprend de chaque vidéo
- [Feuille de route](docs/ROADMAP.md) — du virtuel au réel
- [`brain/`](brain/00%20-%20Accueil.md) — le cerveau de départ de l'agence (règles du business, politiques, playbooks)
