# Feuille de route — du virtuel au réel

L'agence a **le même fonctionnement qu'en réel** dès aujourd'hui : mêmes départements, mêmes tâches, mêmes livrables, mêmes garde-fous. Seul le **marché** est simulé. Le passage au réel consiste à remplacer l'implémentation de `MarketTools` (`server/src/contracts.ts`) par des adaptateurs réels, un par un.

## Phase 1 — Simulation (actuelle)
- [x] Marché virtuel avec vérité cachée, clients pénibles, arnaques, refus de pub, concurrents, événements
- [x] Livrables réels : PDF illustrés, couvertures SVG, pages de vente HTML, storyboards TikTok
- [x] Organisation : une équipe fondatrice de 8 agents qui recrute quand les chiffres le demandent, délégation, revues, Red Team, cerveau partagé
- [x] Apprentissage : bandits, expériences A/B, leçons chiffrées, playbooks, revues RH
- [x] Compétition : notes sur résultats observés, saisons, plans d'amélioration, duels, remplacement sur test réel
- [x] Cinq canaux publicitaires, ventes lues à la boutique, deux lectures à l'écran, répartition par le CFO selon le ROAS moyen (l'allocateur marginal reste comme contrôle)
- [x] Vraies vidéos de pub en MP4 avec voix et sous-titres, PDF refaits, aperçus de pages sur la page de vente
- [x] Licenciements qui attendent le fondateur en mode validation, comme chaque canal, embauche, remplacement et envoi
- [x] Polices auto-hébergées : l'interface ne fait aucune requête vers l'extérieur
- [x] Partie sans fin : paliers, portefeuille, liste e-mail, concurrents, résumé du fondateur, compaction, parties d'un an sans plantage
- [x] Acceptation lue ligne par ligne : `docs/v1/ACCEPTANCE.md` (26 lignes passent, A6 et A10 échouent)
- [ ] **Critère de sortie** : sur au moins 4 seeds sur 5 en difficulté `normal`, l'agence est rentable avant J40 ; sur `cauchemar`, elle survit (pas de faillite) sur au moins 3 seeds sur 5. Le critère complet est dans `docs/BALANCE.md` §6. Lu sur le code final, il **n'est pas rempli à la lettre** : ces deux lignes tiennent, mais l'apprentissage visible lit 40 % pour 70 % et les arrêts de pub 3 pour 0. Passer à la phase 2 reste la décision du fondateur.

## Phase 2 — Réel en lecture seule (aucun risque)
Brancher la **recherche** sur le vrai monde, sans rien publier ni dépenser :
- `searchTrends` / `minePains` → recherche web + Apify (commentaires TikTok/YouTube, avis Amazon, Reddit)
- `listCompetitors` → Gumroad / Etsy / Stan (scraping des fiches + nombre d'avis)
- Les agents produisent de vrais PDF sur de vraies niches ; le fondateur relit.

## Phase 3 — Réel avec validation fondateur
`founderApproval: true` obligatoire : chaque publication, chaque euro dépensé, chaque remboursement > 50 € attend un clic du fondateur dans l'UI.
- Boutique : Stripe / Lemon Squeezy / Shopify (produit numérique, livraison automatique du PDF)
- Pubs : TikTok Ads API (création de campagne, budgets, statistiques, revue de conformité réelle), puis les autres régies. L'allocateur marginal se rejoue alors sur de vraies données
- Organique : publication TikTok des MP4 que l'agence rend déjà
- Support : Gmail (lecture + brouillons de réponse, envoi après validation)
- Créateurs : recherche + DM (envoi après validation)
- Budget réel plafonné (ex. 10 €/jour au départ)

## Phase 4 — Autonomie réelle encadrée
- Validation fondateur seulement au-dessus de seuils (dépense > X €/jour, nouveau produit, partenariat payant).
- Rapports quotidiens envoyés au fondateur (email / Slack).
- Kill-switch global dans l'UI.

## Idées d'amélioration de la simulation
- Saisonnalité annuelle (rentrée, fêtes, été)
- Un contrôle de mise à l'échelle sur le code final : celui de l'étape 4 décrit l'entreprise d'avant les bascules
- Un contrôle du grand livre qui ne relise pas les mêmes écritures, en recalculant la trésorerie depuis les commandes et les dépenses
- Personae clients joués par Claude (mode `claude`) qui lisent réellement le PDF et la page de vente avant d'acheter
