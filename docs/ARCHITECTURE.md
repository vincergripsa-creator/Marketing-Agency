# Architecture — Pixel Agency

> Une agence marketing **autonome** de ~30 agents IA, visible comme un jeu pixel art, qui fabrique de **vrais livrables** (PDF illustrés, pages de vente, pubs TikTok) et les vend dans un **marché virtuel** hostile. Objectif : devenir rentable à partir d'un budget de départ, en apprenant de ses erreurs. Le passage au réel se fait en remplaçant l'implémentation de `MarketTools` — le code de l'entreprise ne change pas.

```
┌──────────────────────────── web/ (Vite + React + canvas) ───────────────────────────┐
│  Monde isométrique pixel art · panneaux Agent/Département · onglets Tâches, Produits,│
│  Pub TikTok, Boîte mail, Finance, Cerveau, Apprentissage · barre de mission au CEO  │
└───────────────▲─────────────────────────────── SSE /api/stream, REST /api/* ────────┘
                │ CompanySnapshot (jamais la vérité cachée du marché)
┌───────────────┴──────────────────────── server/ (Node + TypeScript) ────────────────┐
│ api/        HTTP + SSE, sauvegarde runs/<id>/world.json, CLI headless               │
│ runtime/    Company : roster, tâches, délégation, revue, stratégie CEO, boucle jour  │
│ learning/   cerveau (vault markdown), bandits, expériences, leçons, rétro, RH        │
│ minds/      ContentEngine : heuristique (hors-ligne, gratuit) | Claude (API)        │
│ deliverables/ PDF (pdfkit + visuels vectoriels), couverture SVG, page de vente HTML, │
│             storyboard TikTok 9:16 + aperçu HTML                                    │
│ sim/        MARCHÉ VIRTUEL : niches (vérité cachée), outils de recherche bruités,    │
│             boutique, plateforme pub TikTok, organique, créateurs, clients pénibles, │
│             boîte mail, événements, finance (grand livre)                           │
│ core/       rng déterministe, ids, journal d'activité, chemins                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Tout l'état tient dans **un seul objet sérialisable** `WorldState` (`shared/types.ts`). Les modules sont des fonctions qui le lisent/modifient. Les contrats entre modules sont dans `server/src/contracts.ts`.

## La journée d'une agence (12 ticks)

| Tick | Phase | Ce qui se passe |
|---|---|---|
| 0 | `morning` | **Stand-up** : le CEO lit le cerveau (KPI, leçons, trésorerie), le CFO fixe l'enveloppe du jour, le CEO crée les **missions** → chaque chef les découpe en **tâches** et délègue (l'agent délégué marche jusqu'à son bureau). |
| 1-9 | `work` | Les agents exécutent leurs tâches. Avant : `brain_read` (l'agent va à la fontaine du Cerveau). Après : livrable + `brain_write`. Les tâches avec `reviewer` passent en **revue** (fact-check, Red Team, chef) : approuvé / à corriger (nouvelle tentative avec les notes) / rejeté. Les agents sans travail vont à la **cafétéria**. |
| 10 | `market` | **Clôture du marché** (`tickMarket`) : diffusion des pubs, trafic, ventes, upsells, remboursements, avis, nouveaux messages clients, événements, frais fixes, escalades des messages ignorés. |
| 11 | `evening` | **Rétro** : KPI du jour, mise à jour des bandits et expériences, extraction de **leçons** (avec chiffres) → `brain/lecons/`, règles ajoutées aux **playbooks** des agents concernés, rapport `brain/journal/jour-XXX.md`. Le dimanche (jour % 7 == 0) : **revue RH** des agents et post-mortems. |

## Le pipeline produit (inspiré de la vidéo business)

`scan_trends` → `mine_pains` + `scan_competitors` → `pick_opportunity` (règle du un) → `red_team` (essaie de tuer l'idée) → `write_titles` → `write_outline` → `write_pdf` → `humanize_pdf` → `fact_check` → `design_cover` → `render_pdf` → `write_sales_page` → `set_price` → `publish_product` → `write_ad_hooks` → `produce_ad` (×2-3 variantes) → `launch_campaign` → chaque jour `optimize_ads`, `post_organic`, `reply_inbox`, `find_creators`/`negotiate_deal`, et `design_upsell` → 2e PDF dès qu'un produit est rentable.

## Le marché virtuel (pourquoi c'est un vrai test)

Chaque niche a une **vérité cachée** (`NicheTruth`) : demande, consentement à payer, concurrence, affinité TikTok, CPM, **affinités par style de hook et format** (inconnues des agents, apprenables), sensibilité aux remboursements, risque de conformité. Les agents ne la voient qu'à travers des **outils bruités** (tendances, concurrents, commentaires clients) — comme dans la vraie vie.

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
Remplacer `createMarketTools` par des adaptateurs réels : TikTok Ads API, boutique (Stripe/Shopify/Lemon Squeezy), Gmail, TikTok organique, recherche web (Apify). Garder `founderApproval: true` au début. Voir `docs/ROADMAP.md`.
