# Architecture — Pixel Agency

> Une agence marketing **autonome** d'agents IA, une équipe fondatrice de 8 agents qui recrute quand les chiffres le demandent, visible comme un jeu pixel art, qui fabrique de **vrais livrables** (PDF illustrés, pages de vente, vidéos de pub) et les vend dans un **marché virtuel** hostile. Objectif : devenir rentable à partir d'un budget de départ, en apprenant de ses erreurs. Le passage au réel se fait en remplaçant l'implémentation de `MarketTools` — le code de l'entreprise ne change pas.

```
┌──────────────────────────── web/ (Vite + React + canvas) ───────────────────────────┐
│  Monde isométrique pixel art · panneaux Agent/Département · résumé du fondateur     │
│  Onglets Tâches, Produits, Acquisition, Canaux, Croissance, Effectif, Compétition,  │
│  Finance, Galerie, Boîte mail, Calendrier, Cerveau, Apprentissage · barre de mission│
└───────────────▲─────────────────────────────── SSE /api/stream, REST /api/* ────────┘
                │ CompanySnapshot (jamais la vérité cachée du marché ni le vrai talent)
┌───────────────┴──────────────────────── server/ (Node + TypeScript) ────────────────┐
│ api/        HTTP + SSE, vues des onglets, sauvegarde runs/<id>/, CLI headless       │
│ runtime/    Company : tâches, délégation, revue, stratégie CEO, boucle jour,        │
│             canaux, CFO, paliers, portefeuille, audience, résumé, compaction        │
│   org/      rôles, chapeaux, paie, charge, embauches, départs, reconcileOrg         │
│   talent/   ligue : notes, saisons, plans de progrès, duels, remplacements          │
│ learning/   cerveau (vault markdown), bandits, expériences, leçons, rétro, RH       │
│ minds/      ContentEngine : heuristique (hors-ligne, gratuit) | Claude (API)        │
│ deliverables/ PDF (pdfkit + visuels vectoriels), couverture SVG, page de vente HTML,│
│             storyboard 9:16 + aperçu HTML, plan de montage                          │
│ video/      rendu MP4 des pubs : scènes, voix, musique, encodage, contrôle qualité  │
│ sim/        MARCHÉ VIRTUEL : niches (vérité cachée), outils de recherche bruités,   │
│             boutique, cinq canaux pub, organique, créateurs, clients pénibles,      │
│             boîte mail, audience, concurrents, événements, finance (grand livre)    │
│ core/       rng déterministe, ids, journal d'activité, chemins                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Tout l'état tient dans **un seul objet sérialisable** `WorldState` (`shared/types.ts`). Les modules sont des fonctions qui le lisent/modifient. Les contrats entre modules sont dans `server/src/contracts.ts`.

Une graine est un marché : deux parties de même graine sont identiques à l'octet près, et une partie rechargée à n'importe quel tick finit comme une partie sans interruption. Chaque tirage aléatoire a son propre flux, et rien dans la simulation ne lit l'heure réelle. Le grand livre est la seule source d'argent. La vérité cachée (marché, vrai talent) ne quitte jamais le serveur, sauf en mode dieu.

## La journée d'une agence (12 ticks)

| Tick | Phase | Ce qui se passe |
|---|---|---|
| 0 | `morning` | **Stand-up** : le CEO lit le cerveau (KPI, leçons, trésorerie), le CFO fixe l'enveloppe du jour, le CEO crée les **missions** → chaque chef les découpe en **tâches** et délègue (l'agent délégué marche jusqu'à son bureau). |
| 1-9 | `work` | Les agents exécutent leurs tâches. Avant : `brain_read` (l'agent va à la fontaine du Cerveau). Après : livrable + `brain_write`. Les tâches avec `reviewer` passent en **revue** (fact-check, Red Team, chef) : approuvé / à corriger (nouvelle tentative avec les notes) / rejeté. Une boucle compte 2 reprises au plus, puis une décision : dérogation consignée ou arrêt (`review.closeLoop`) ; le verdict de la Red Team sur un guide est une porte de `publish_product` (`runtime/redteam.ts`). Les agents sans travail vont à la **cafétéria**. |
| 10 | `market` | **Clôture du marché** (`tickMarket`) : diffusion des pubs, trafic, ventes, upsells, remboursements, avis, nouveaux messages clients, événements, frais fixes, escalades des messages ignorés. |
| 11 | `evening` | **Rétro** : KPI du jour, mise à jour des bandits et expériences, extraction de **leçons** (avec chiffres) → `brain/lecons/`, règles ajoutées aux **playbooks** des agents concernés, rapport `brain/journal/jour-XXX.md`. Le dimanche (jour % 7 == 0) : **revue RH** des agents et post-mortems. |

## Le pipeline produit (inspiré de la vidéo business)

`scan_trends` → `mine_pains` + `scan_competitors` → `pick_opportunity` (règle du un) → `red_team` (essaie de tuer l'idée) → `write_titles` → `write_outline` → `write_pdf` → `humanize_pdf` → `fact_check` → `design_cover` → `render_pdf` → `write_sales_page` → `set_price` → `publish_product` → `write_ad_hooks` → `produce_ad` (×2-3 variantes) → `launch_campaign` → chaque jour `optimize_ads`, `post_organic`, `reply_inbox`, `find_creators`/`negotiate_deal`, et `design_upsell` → 2e PDF dès qu'un produit est rentable.

## L'organisation : un effectif à la demande

Le catalogue compte 13 départements, 35 rôles et 47 types de tâches, pour 60 personnes au plus. Une partie démarre avec **8 fondateurs**, qui portent en chapeaux les tâches sans titulaire (24 sur 47 au jour 1). Un chapeau coûte du temps et de la qualité : hors de son métier, un agent tire son talent bien plus bas.

- **`reconcileOrg`** dérive tout de qui est là : chapeaux, départements ouverts, chefs, bureaux (`offices`), où va le travail ouvert. Une embauche, un départ et un rechargement passent par le même code. Un département sans personne reste un terrain vide, un autre porte ses tâches.
- **Embauches** : `headcount_review` lit l'attente par type de tâche. Un goulot qui dure ouvre un poste s'il passe les portes d'argent, tirées du grand livre, sinon le refus est consigné avec ses chiffres. Chaque candidat passe le vrai test de son métier (`Candidate.interview`). Une recrue prend 3 jours pour sa vitesse et 7 pour sa qualité.
- **Départs** : remplacement, licenciement quand l'argent manque (`L1`) ou quand un rôle dort (`L2`), ordre du fondateur. Chaque personne garde son identifiant à vie, son nom n'est jamais réutilisé, ses salaires et son solde passent au grand livre.

## La compétition

Chaque agent hors CEO a une note qui ne lit que des résultats observés (`recordEvidence`), notée contre un par, sur sa compétence principale : jamais sur un chapeau. Une saison dure 14 jours. Sous la barre avec assez de preuves : plan de 14 jours et coach. Plan raté : `runChallenge` fait passer au titulaire et à trois candidats le même test réel, et le poste ne change de main que si l'un bat le titulaire de la marge fixée. Le remplacement est atomique, dans `league_review`. Les fondateurs autres que la CEO peuvent être remplacés. Le talent réel reste caché : ni les agents, ni le snapshot, ni l'interface ne le lisent.

## Les canaux

Cinq canaux (TikTok, Facebook & Instagram, YouTube Shorts, Pinterest, Google Search), quatre comptes publicitaires : YouTube et Search partagent celui de Google. Un canal s'ouvre quand ses propres conditions sont réunies et qu'un media buyer de ce canal est en poste, puis passe une vérification. Chaque plateforme s'attribue trop de ventes : `reconcile_channels` les ramène au grand livre, et `allocate_channels` répartit le budget sur cette lecture.

## Vidéo et PDF

- **Vidéo** (`server/src/video/`) : `planCut` fait le plan de montage, le rendu donne un MP4 h264 et un contrôle qualité. Les fichiers n'entrent jamais dans le monde : `CompanySnapshot.videos`, `runs/<id>/video/manifest.json`. Rendu `auto` dans le serveur, `off` en CLI et au banc. Sans ffmpeg, sans voix ou sans pages, la partie continue en repli (`no_voice`, `no_pages`, `storyboard_only`) et l'interface le dit.
- **PDF** : polices `.woff` embarquées (`server/assets/fonts/`), mise en page paginée, couverture et motifs générés, aperçus de vraies pages sur la page de vente. Le talent `design` joue sur la finition, le modèle `visual` sur la vente.

## Autonomie et passage à l'échelle

- **Sans fin** : `openEnded` retire l'échéance. `npm run agency` (`scripts/forever.mjs`) relance le serveur s'il tombe, et la partie reprend. Les sauvegardes et points de reprise vivent dans `runs/<id>/`, jamais servis au navigateur (`world*.json`, `checkpoints/`, `archive/` : 403). La compaction hebdomadaire archive les vieilles lignes pour qu'une partie d'un an tienne en mémoire.
- **Paliers** (`stages.ts`) : Survie, Adéquation, Accélération, Portefeuille. Le CFO (`cfo.ts`) en déduit la part mise à l'échelle, testée et gardée en réserve.
- **Portefeuille** (`portfolio.ts`) : `portfolio_review` lance, double, retravaille, exploite ou arrête un guide. Une niche fermée peut rouvrir, sauf si le fondateur l'a fermée.
- **Audience** (`audience.ts`) : aimant à e-mails, séquences, envois à la liste, bump de commande.
- **Résumé du fondateur** (`digest.ts`) : ce qui a changé depuis sa dernière visite.

## Le marché virtuel (pourquoi c'est un vrai test)

Chaque niche a une **vérité cachée** (`NicheTruth`) : demande, consentement à payer, concurrence, affinité par canal, CPM, **affinités par style de hook et format** (inconnues des agents, apprenables), sensibilité aux remboursements, risque de conformité. Les agents ne la voient qu'à travers des **outils bruités** (tendances, concurrents, commentaires clients) — comme dans la vraie vie.

Modèle de conversion (simplifié) :
- impressions = dépense / CPM × 1000 ; CPM = base niche × difficulté × événements × bruit
- CTR = base × qualité du hook × affinité(hook, format) × affinité TikTok × fatigue(fréquence) × bruit
- conversion page = f(qualité page de vente, prix vs consentement à payer, note des avis, adéquation règle du un) × demande × jour de la semaine
- remboursements = f(écart promesse/contenu, qualité PDF, part de chasseurs de remboursement)
- clients pénibles générés selon la difficulté (`facile` / `normal` / `cauchemar`) : impatients, sceptiques, trolls, « Karen », menaces de chargeback, arnaqueurs, faux créateurs.

## Apprentissage (mesurable, même sans LLM)

1. **Bandits de Thompson** sur les dimensions de décision (style de hook, format pub, palier de prix, niveau de survente, ton du support) — mis à jour par les résultats réels du marché.
2. **Expériences A/B** formalisées (hypothèse, variantes, métrique, gagnant).
3. **Leçons** chiffrées écrites dans le cerveau et injectées dans les **playbooks** des agents (règles apprises), donc dans leurs prochains prompts (mode Claude) ou leurs heuristiques.
4. **Revues RH** : score de chaque agent (taux d'approbation, échecs, impact) → coaching / montée de niveau.
5. **PDF v2** : les plaintes qualité remontent au Studio qui réécrit le guide.

## Deux cerveaux possibles
- `heuristic` : générateurs procéduraux en français, nourris par la recherche du marché (pas d'API, gratuit, déterministe). Sert aux tests et au mode démo.
- `claude` : chaque agent réfléchit et écrit avec Claude (Opus pour le CEO, Sonnet pour la rédaction, Haiku pour le volume). Plafond de dépense `MAX_COMPUTE_EUR` ; en cas d'erreur ou de plafond atteint, repli automatique sur l'heuristique pour l'appel concerné.

## Passage au réel (plus tard)
Remplacer `createMarketTools` par des adaptateurs réels : régies publicitaires, boutique (Stripe/Shopify/Lemon Squeezy), Gmail, TikTok organique, recherche web (Apify). Garder `founderApproval: true` au début. Voir `docs/ROADMAP.md`.

## Ce que la V1 a coupé

Chacune de ces coupes est une décision, pas une tâche en attente (`docs/v1/PLAN.md` §6).

| Coupe | Pourquoi |
|---|---|
| Sièges stables, `personId`, renommages | Un agent est une personne, à vie. Plus aucun identifiant en dur à protéger |
| CEO dans la ligue, compétence `direction`, preuve `board` | Un seul levier, la preuve la plus bruitée, et elle ne peut pas partir |
| Promotion au poste de chef | Peu d'effet réel sur une équipe légère, logique d'échange lourde |
| Prime `budgetPct`, `talentSpeed`, gel à l'arrivée, `HIRE_COST` | Effets de second ordre, chacun une règle de plus à prouver |
| `payrollCap` | Faux par construction : il aurait gelé les embauches pour toujours |
| Reciblage | Second piège à côté de Search, demande un état des visiteurs |
| Organique hors TikTok | Quatre créneaux par jour, chiffres minces, longue traîne à borner |
| `channel_cpm_spike` | Le pic TikTok existant enseigne la même chose |
| Témoins `platform_claims` et `no_bandit` | Prouvent peu au-delà de `last_click` et `tiktok_only` |
| `buyerScore`, `talentEdge`, `thumbFactor` | Le ROAS réconcilié suffit ; la vignette reste un libellé tant qu'aucun fil ne la montre |
| Marque (`market.brand`) | Les canaux ajoutent déjà de la capacité, deux mécaniques impossibles à distinguer |
| Porte de palier sur les canaux et les embauches | Leurs propres portes d'argent décident : une règle par décision |
| Beats `before_after`, `step_list`, vidéo 2:3 | Conçus, jamais rendus ; deux scènes de plus de la même grammaire |
| Caveat, `@expo-google-fonts` | Toutes les polices sont des `.woff` non modifiés |
| 6 héros sur 14, 2 mises en page de couverture sur 4 | Chaque héros demande plusieurs passes à l'œil ; des alias gardent chaque motif valide |
| Ballon, salle d'entretien, banc des candidats, statues, échafaudage, feux d'artifice, arche de scène | Mise en scène sans résultat : la marche jusqu'au quai porte le renvoi |
| `CandidateChip`, `scene.candidates` | Un remplacement tient en un tick : rien à mettre en scène |
| Calibration séparée dans chaque spécification | Une seule passe à la fin : sept boucles sur du bruit, c'est comme ça qu'une partie reste bloquée |
