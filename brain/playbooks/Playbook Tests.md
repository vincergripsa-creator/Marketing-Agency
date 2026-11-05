---
tags: [playbook, analyse, expériences, tests, échantillon]
---
# Playbook Tests

**Qui s'en sert** : les expériences de [[Playbook Analyse]], et toute équipe qui compare deux couvertures, deux pages, deux prix ou deux créas.

## Combien d'événements
Pour voir une hausse relative r à 80 % de puissance et 5 % de risque, il faut environ **16 × (1 − p) / r² événements par variante** (clics ou ventes, p le taux de base) [calcul sur la règle d'Evan Miller]. Toute expérience, test de prix, de hook ou de couverture, calcule cet échantillon avant de commencer : 1 600 pour +10 %, 400 pour +20 %, 178 pour +30 %, 64 pour +50 % [calcul]. À l'envers, n événements ne lisent qu'un écart d'environ 4 / √n : 8 ventes, +140 % ; 100 ventes, +40 % [calcul]. Les clics sont 20 à 50 fois plus fréquents que les achats : couverture, première image et pub se testent au CTR, les achats se gardent pour le prix et l'offre [inférence].

## La plupart des tests sont plats
Sur 127 000 expériences, 12 % seulement améliorent significativement la métrique visée [observationnel] ; sur 1 001 tests, 33,5 % donnent un gagnant, qui pèse +7,5 % en médiane [observationnel, 2021-2022]. Un test plat est le cas normal : on planifie 5 à 15 % par gagnant confirmé [inférence].

## Les règles
- En semaines entières, au moins 7 jours ; 2 à 4 semaines pour un prix ou une page [inférence]. Un test de gabarit de page alterne les deux pages jour par jour et s'arrête sur son échantillon ou au bout de 14 jours.
- L'arrêt se fixe avant le départ : regarder sans cesse et s'arrêter au premier p < 0,05 fait passer les faux positifs de 5 % à 26,1 % [simulation, 2010]. Un plan séquentiel prévu d'avance économise environ 26 % d'échantillon [observationnel].
- Une seule chose change par test, mais elle peut être grosse : un gabarit entier plutôt qu'une retouche [inférence].
- Un test sous 50 % de puissance : son effet est divisé par deux avant qu'on s'en serve [inférence].
- Toute victoire de plus de +30 % se rejoue avant de devenir une règle [inférence] : six gains Airbnb, 7,2 % au total, n'en valaient que 4 % face à un groupe témoin [observationnel, 2017, lu via un résumé].
- Un prix se juge au profit par visiteur, pas à la conversion [vendeur]. Une créa presque pas diffusée est « non testée », pas « perdante » [inférence].
- Un panel ou un score interne écarte les perdants évidents, il ne désigne pas le gagnant : les humains devinent l'issue d'un test A/B 59 fois sur 100, contre 50 au hasard [observationnel, 2022].
- Chaque segment testé à part redemande ses propres 400 événements pour voir +20 % [calcul].

## Quoi tester d'abord
Le concept visuel et le message, puis le prix et l'offre, puis la clarté de la valeur, les retouches en dernier [inférence] : la créa explique 49 % des ventes que la pub ajoute [méta-analyse, résumé secondaire]. Dès trois variantes, un bandit bat un partage égal 63,9 fois sur 100, contre 49,7 à deux [observationnel] : nos styles, gabarits et héros passent par des bandits.

Liens : [[Playbook Analyse]] · [[Prix]] · [[Playbook Couverture]] · [[Playbook Page de vente]] · [[Playbook Visuels et formats pub|Playbook Visuels pub]] · [[Playbook Boutique]]
