# Vidéos de référence — ce qu'on en reprend

## 1. « J'ai créé une agence marketing avec 31 agents IA » — Zeyneb Madi (Néom)
<https://www.youtube.com/watch?v=-Q4SvlX9KyU> · vidéo sœur (boulangerie, même plateforme) : <https://www.youtube.com/watch?v=q_1q425nehM>

**Le concept** : un *monde virtuel* où vit toute l'entreprise. Construit avec Claude Code (Opus), modèle sélectionnable par agent (Opus / Sonnet / Haiku).

| Élément vu dans la vidéo | Repris dans Pixel Agency |
|---|---|
| Monde pixel art isométrique, **une île flottante = un département**, ponts en bois entre les îles, ciel, nuages, montagnes | `web/src/world` — rendu canvas isométrique procédural |
| Au centre : **la Direction** + **le Cerveau** (fontaine/cristal) | Place centrale : Direction + Cerveau + Cafétéria |
| **Cafétéria** : les agents sans travail vont prendre un café | statut `coffee`, l'énergie remonte |
| Clic sur un agent → **panneau à droite** : Discussion (chat, vocal) + Fiche (rôle, outils connectés, tâches récentes, livrables) | `AgentPanel` : Discussion / Fiche / Playbook |
| Clic sur une île → **panneau équipe** : Aperçu (tâches du jour, en cours, délai moyen), outils connectés, compétences, agents avec le **chef** | `DeptPanel` |
| Onglets : **Bureau, Tâches, Calendrier, Éditorial, Galerie, Cerveau** | + Produits, Pub TikTok, Boîte mail, Finance, Apprentissage |
| Barre du bas : **« Donne une mission à Noam »** (le CEO qui orchestre et délègue) | `MissionBar` → CEO |
| **Mode flux** : on voit les agents aller lire le cerveau avant chaque action, et les « transactions » cerveau → département | activités `brain_read`, lignes animées |
| **Hiérarchie** : chaque département a un chef qui délègue (« Margaux va chercher Léa : viens à ton bureau ») | `team.delegate`, l'agent marche jusqu'à son bureau |
| **Contrôle qualité** avant livraison : Bastien, fact-checker, relit slide par slide | revue obligatoire (`reviewer`) + Red Team |
| Le **CEO vérifie** puis livre au fondateur | approbation CEO (ou fondateur en mode `founderApproval`) |
| **Plan du bureau** (minimap) pour sauter d'un département à l'autre | minimap cliquable |
| **Cerveau Obsidian** : notes markdown liées par `[[liens]]`, l'agent le consulte *avant* d'agir et **l'alimente après chaque action** (cerveau évolutif) | `brain/` (vault seed) copié dans chaque run, lu/écrit par les agents |
| Honnêteté des agents (« la recherche est partielle, le quota web est épuisé ») | les agents rapportent leurs limites dans le journal |

## 2. « J'ai essayé ce business en ligne hyper rentable (+27 000 €) »
<https://www.youtube.com/watch?v=qzNcvbeDEvU> — le **business model** de l'agence.

1. **La règle du un** : un seul problème, pour un seul type de personne. « Un guide qui parle à tout le monde ne parle à personne » (ex. : « frapper une balle courbe au baseball, enfants de 8-12 ans » → 1,2 M$).
2. **Trouver le PDF** : ce que les gens sont *prêts à payer* (pas ce qu'on sait). Méthodes : IA qui fouille commentaires, avis Amazon, blogs ; regarder ce qui marche aux US / sur Gumroad (nombre d'avis = estimation des ventes) ; sujets YouTube/Udemy qui performent.
3. **Créer le PDF en < 10 min** à partir de la recherche :
   - **10 titres** : chacun dit le problème, pour qui, avec *leurs* mots ;
   - **plan qui vend** : intro qui reformule le problème + ce qu'on aura à la fin → étapes numérotées → 1-2 exemples concrets → **chapitre bonus** (« cadeau inside » sur la page de vente) → **chapitre final qui redirige vers la suite** ;
   - rédaction complète, phrases simples, pages prêtes pour la mise en page ;
   - **passe d'humanisation** : couper les phrases génériques d'IA (« chaque bébé est différent », « soyez patient ») et les remplacer par des détails issus de la recherche.
4. **Couverture** (seule chose vue avant l'achat) : visuel généré, format vertical, titre gros, pas surchargé, inspiré des best-sellers de la niche.
5. **Page de vente** sur **son propre site** (pas noyé sur Amazon/Etsy) : mots exacts des clients, douleur → solution, contenu chapitre par chapitre, curiosité, **objections traitées à l'avance**.
6. **Prix** : 9 € à 49 € ; commencer bas pour les premières ventes puis monter ; plus l'audience a d'argent / plus le problème est complexe, plus c'est cher.
7. **Upsell** : dernière page « La suite est ici » → 2e PDF pour le même public.
8. **Acquisition** : (a) payer un YouTuber de la niche + % des ventes ; (b) petits créateurs **à la commission seulement** ; (c) contenu organique TikTok/Instagram sur le point de douleur ; (d) posts écrits X/Reddit/LinkedIn ; (e) **pubs** (Meta/TikTok) — le plus rapide mais le plus cher, il faut une pub de qualité.
9. « Comme tout business, il faut **tester, apprendre de ses erreurs et s'améliorer**. »

## 3. Bonus de la même créatrice — « Claude m'a construit une entreprise à partir d'un seul prompt »
<https://www.youtube.com/watch?v=2SMkP92gz-c>

Garde-fous repris tels quels pour l'autonomie : **zéro dépense hors budget, ne rien publier dans le réel, ne rien inventer (sources), ne jamais demander**. Orchestration multi-agents (chercheurs en parallèle), **Red Team** qui attaque les recherches et le produit, et une étape « **essaie de tuer le projet** » avant le verdict final.
