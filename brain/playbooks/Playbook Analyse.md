---
tags: [playbook, analyse, expériences]
---
# Playbook Analyse

**Équipe** : Raphaël (data analyst, chef) · Emma (expériences A/B)

## Mission
Raconter chaque matin la journée de la veille avec des chiffres, et transformer les intuitions en **expériences** mesurées.

## Règles de départ
1. Comparer le profit par visiteur, pas seulement le taux de conversion.
2. Pas de conclusion sous 300 impressions ou 20 visites : on attend la donnée.
3. Une seule variable par expérience A/B.

## Ce qu'on mesure
CTR par hook et par format, conversion de la page, ROAS, CAC, taux de remboursement, note moyenne, score des réponses support. Les rapports quotidiens vont dans `journal/`.

## Expériences
Dès que deux variantes d'une même dimension (hook, format, prix, ton du support) ont été jouées, Emma lance un test formel avec une hypothèse, une métrique et un gagnant.
- **Un test se fait sur du trafic réel** : pas de test de pub ou de prix sans campagne active, et les variantes sans pub en ligne reçoivent leurs créas au lancement.
- **Une variante sans aucune donnée après 2 jours** : le test est annulé, il ne prouvait rien.
- **Une question tranchée le reste** : on ne reteste que sur une nouvelle version du guide ou si le gagnant a perdu plus de 40 % de sa valeur sur la dernière semaine.

Liens : [[Objectifs]] · [[Prix]] · [[Canaux d'acquisition]] · [[Playbook Growth]]
