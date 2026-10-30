# Feuille de route — du virtuel au réel

L'agence a **le même fonctionnement qu'en réel** dès aujourd'hui : mêmes départements, mêmes tâches, mêmes livrables, mêmes garde-fous. Seul le **marché** est simulé. Le passage au réel consiste à remplacer l'implémentation de `MarketTools` (`server/src/contracts.ts`) par des adaptateurs réels, un par un.

## Phase 1 — Simulation (actuelle)
- [x] Marché virtuel avec vérité cachée, clients pénibles, arnaques, refus de pub, concurrents, événements
- [x] Livrables réels : PDF illustrés, couvertures SVG, pages de vente HTML, storyboards TikTok
- [x] Organisation de 31 agents, délégation, revues, Red Team, cerveau partagé
- [x] Apprentissage : bandits, expériences A/B, leçons chiffrées, playbooks, revues RH
- [ ] **Critère de sortie** : sur 5 seeds différents en difficulté `normal`, l'agence est rentable avant J40 ; sur `cauchemar`, elle survit (pas de faillite) sur au moins 3 seeds sur 5.

## Phase 2 — Réel en lecture seule (aucun risque)
Brancher la **recherche** sur le vrai monde, sans rien publier ni dépenser :
- `searchTrends` / `minePains` → recherche web + Apify (commentaires TikTok/YouTube, avis Amazon, Reddit)
- `listCompetitors` → Gumroad / Etsy / Stan (scraping des fiches + nombre d'avis)
- Les agents produisent de vrais PDF sur de vraies niches ; le fondateur relit.

## Phase 3 — Réel avec validation fondateur
`founderApproval: true` obligatoire : chaque publication, chaque euro dépensé, chaque remboursement > 50 € attend un clic du fondateur dans l'UI.
- Boutique : Stripe / Lemon Squeezy / Shopify (produit numérique, livraison automatique du PDF)
- Pubs : TikTok Ads API (création de campagne, budgets, statistiques, revue de conformité réelle)
- Organique : publication TikTok (vidéos générées — ex. Higgsfield / Remotion — à partir des storyboards)
- Support : Gmail (lecture + brouillons de réponse, envoi après validation)
- Créateurs : recherche + DM (envoi après validation)
- Budget réel plafonné (ex. 10 €/jour au départ)

## Phase 4 — Autonomie réelle encadrée
- Validation fondateur seulement au-dessus de seuils (dépense > X €/jour, nouveau produit, partenariat payant).
- Rapports quotidiens envoyés au fondateur (email / Slack).
- Kill-switch global dans l'UI.

## Idées d'amélioration de la simulation
- Concurrents simulés qui copient nos meilleurs PDF et baissent leurs prix
- Saisonnalité annuelle (rentrée, fêtes, été)
- Plusieurs plateformes pub (Meta, Pinterest) avec des audiences différentes
- Clients qui reviennent acheter (LTV), liste email et séquences
- Personae clients joués par Claude (mode `claude`) qui lisent réellement le PDF et la page de vente avant d'acheter
