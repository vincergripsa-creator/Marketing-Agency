# Acceptation de la V1

Les 28 lignes de `docs/v1/PLAN.md` §5, chacune avec son verdict, son nombre et le commit sur lequel elle a été lue. **26 passent, A6 et A10 échouent.** Une ligne qui passe ne dit pas que tout va bien : les réserves sont dans `docs/BALANCE.md` §4.7 et les limites au §7.

Le code final est `67a5152`. Trois autres repères :

- **`67a5152` + cette passe :** le code final, avec les titres de tests, les deux tests ajoutés et les documents de cette passe. Rien sous `server/src`, `shared` ou `web/src` n'a changé hors des fichiers de test.
- **`11b3f20` :** le code avant la passe de texte. `9b3cdc4` et `67a5152` n'y ajoutent que des corrections de texte, des commentaires et un test. L'empreinte `b6b0ec5a…` est la même.
- **`9513e97` :** l'entreprise d'avant les bascules de l'étape 4. Une ligne lue là décrit une entreprise qui a changé depuis.

## Les 28 lignes

| # | Ligne | Verdict | Nombre | Lu sur |
|---|---|---|---|---|
| A1 | Types | pass | `npm run typecheck`, code 0 | `67a5152` + cette passe |
| A2 | Tests | pass | Serveur 2 856 passés, 3 ignorés, 61 fichiers ; interface 546 passés, 16 fichiers ; liste des tâches sans handler vide. `test:long` 5 sur 5 lu sur `11b3f20`, pas relancé | `67a5152` + cette passe |
| A3 | Build | pass | `npm run build`, code 0, 0 `http` dans `dist/index.html`, pdfjs dans un seul morceau chargé à la demande | `67a5152` + cette passe |
| A4 | Même graine, même run | pass | `replay.test.ts` vert : 2 runs complets de 45 jours identiques sous le filtre `decisions()` | `67a5152` + cette passe |
| A5 | Recharger = ne pas interrompre | pass | `replay.test.ts` vert, en `flat` (route du licenciement sur la graine 3) et en `league` | `67a5152` + cette passe |
| A6 | Un an, graine 7 | **ÉCHEC** | **p95 d'une journée 1 060 ms pour 800**, de 760 à 1 317 ms selon les graines, seule la graine 9 passe sous 800. Tout le reste tient : 225,4 s pour 240, `world.json` 10,8 MB pour 12, direct 363,6 kB pour 400, `/api/state` 683,0 kB pour 700, tas 305,5 MiB sous 500 MB, Σ grand livre = trésorerie, violations 0. La commande sort en code 1 sur cette seule cible | `11b3f20` |
| A7 | Un an, 10 graines | pass | 0 plantage, 0 NaN, 0 écart de grand livre, 0 violation. Marges minces : direct jusqu'à 397,6 kB pour 400, dossier 148,4 MB pour 150, `/api/state` 693,0 kB pour 700 | `11b3f20` |
| A8 | Tourne seule | pass | Guide en ligne à J15 sur 30/30 (il en faut 28), premier guide de J4 à J7. Aucune tâche ouverte plus de 10 jours, la plus vieille 9 jours. 241 embauches sur 28/30 graines, 0 tâche en attente du fondateur | `11b3f20` |
| A9 | Bonne taille d'équipe | pass | Effectif à J60 : 10 valeurs de 8 à 18, médiane 14, aucune graine à 31. Paie au grand livre sur 30/30, médiane 1 369 € | `11b3f20` |
| A10 | La compétition est réelle | **ÉCHEC** | **Médiane 0 remplacement à J180** pour 1 demandé. 1 à J60, 4 à J180, 5 à J182, sur 30 entreprises. Les 5 ont remplacé quelqu'un sous la moyenne de sa famille, gain moyen de talent réel +0,17. Tenu par les tests : chaque `leftBecause` a ses nombres, chaque embauche bat le titulaire de sa marge. Deux essais bornés n'ont pas suffi (D146, D147) | `67a5152` (relevé de 182 jours) |
| A11 | Les agents progressent | pass | `meanLeague` à J60 au-dessus de J1 sur 25/30 (il en faut 24), bras `flat`, médianes 0,614 → 0,677. Test talent 12 et `talent-levers.test.ts` verts sur `67a5152` + cette passe | `9513e97` |
| A12 | Grandit seule | pass, comme rapport | La ligne demande de rapporter, et de sortir la courbe : c'est fait (`docs/BALANCE.md` §4.4, §4.5). **Sur le fond, scale rate 2 cibles sur 5 :** A1 1,33 pour 2,0, A2 1,15 pour 1,5. A3 2,03, A4 0,84, A5 0 contre 0 passent. **Sur le commit final, A3 échoue (20/30, 1,79), et A1, A2, A4, A5 n'ont pas de contrôle :** l'étape 4 est fermée (D149) | `9513e97`, A3 relu sur `67a5152` |
| A13 | Vrai MP4 | pass | 12 sur 12 sur les graines 3 et 11, trois formats, en 9:16 et 4:5 : h264, aac, 23 à 43 s, `qa.ok`, -14,3 à -13,9 LUFS. Ces 12 films n'ont pas été rendus de nouveau, les corrections suivantes ne touchent ni l'encodage ni la composition. D'autres films l'ont été depuis : A19 et A26 sur `11b3f20`, et 22 films de la graine 42 sur `67a5152` pendant une relecture indépendante, tous `qa.ok`, 18 à 41 s, -14,6 à -13,8 LUFS | passe de contrôle, avant `11b3f20` ; graine 42 : `67a5152` |
| A14 | La vidéo est regardée | pass | Accroche lisible 12 sur 12, vraie page du guide sur 8 films voix sur 8, couverture sur 4 diaporamas sur 4. Le son est mesuré, **personne n'a écouté un film** | passe de contrôle, avant `11b3f20` |
| A15 | Plus de « 31 » | pass | La commande de la ligne sort 2 lignes, deux titres du test de l'ancienne équipe dans `runtime.test.ts` | `67a5152` + cette passe |
| A16 | PDF en images | pass | 5 guides lus à l'œil sur trois voix, 6 pages intérieures chacun à 1 100 px, 2 guides lus page par page : 0 débordement, 0 page à moitié vide, accents justes. La voix `signal` n'est vue que sur la planche de `fin4`. Les corrections de texte suivantes n'ont été relues en image que sur un guide, en A18 | `11b3f20` |
| A17 | Structure des PDF | pass | 29 guides réels : 7 à 8 `/FontFile2`, 0 police standard, `/Outlines` 29/29, 0 mot perdu aux ligatures, deux rendus identiques 29/29. `design.test.ts` et `layout.test.ts` verts sur `67a5152` + cette passe | `11b3f20` |
| A18 | Page de vente | pass | Ouverte dans le navigateur, deux lectures. Graine 7, 22 jours, `prd_162` : livre en SVG, 5 vraies pages, 29 € partout, le prix du monde, bandeau « Boutique virtuelle Pixel Agency — environnement de test, aucun paiement réel », 1 requête, 0 externe, 0 erreur de console. Graine 42, partie en direct, relecture indépendante : `prd_149` et `prd_1555` v2, sur ordinateur et à 375 px sans défilement de côté, prix de la page = prix du monde sur 13 produits sur 13, `prd_149` passé de 24 à 19 € et sa page a suivi, 1 requête, 0 externe, 0 erreur, les 4 boutons d'achat donnent l'alerte de paiement simulé, PDF `prd_1555` v2 feuilleté et son texte lu en entier sur 29 pages. **La ligne passe, mais un acheteur verrait des défauts :** la page annonce 4 actions de plus que le PDF, un kit de 8 pages promet 7 chapitres, le lien de fin du PDF est relatif, des coutures de gabarit restent (`docs/BALANCE.md` §7) | `67a5152` |
| A19 | Replis propres | pass | 4 niveaux sur 4 : `storyboard_only`, `no_voice`, `no_pages` forcés, et un vrai `npm ci --omit=optional`. Le run finit, l'interface dit ce qui manque, 0 erreur de console | `11b3f20` |
| A20 | Polices absentes | pass | Dossier vide, 4 voix : `degraded`, `interior` 60 exactement, 0 plantage. Entreprise entière sur 45 jours, 0 tâche échouée | `11b3f20` |
| A21 | Vérité cachée | pass | `truth.test.ts`, `views.test.ts` et le test de route verts sur `67a5152` + cette passe. Balayage réel de 603 fichiers : les 9 fichiers serveur répondent 403, les 594 autres ne tiennent pas la sentinelle | tests : cette passe ; balayage : `9513e97` |
| A22 | Garde-fous | pass | `withoutYes` tout à 0 sur les graines 3, 9 et 1 à 130 jours, 1 licenciement demandé et signé sur les graines 9 et 1. La ligne avait échoué : les licenciements attendent le fondateur depuis D150 | `11b3f20` |
| A23 | Grand livre | pass | 1 428 runs de calibration et les 90 runs finals : violations 0, écarts 0, NaN 0. Par canal : `channels.test.ts`. C'est un contrôle de fraîcheur, pas de justesse (`docs/BALANCE.md` §4.7) | étapes 1 à 4 et `67a5152` |
| A24 | Vieille sauvegarde | pass | Chargée, J21 à J26, 0 plantage, Σ grand livre = trésorerie sur 5 jours sur 5, 0 ligne de salaire, TikTok seul, aussi par le vrai serveur. « Se comporte comme avant » repose sur ces lignes, pas sur une égalité d'empreinte | `11b3f20` |
| A25 | Rien de réel | pass | Les deux commandes de la ligne ne sortent aucun point réel, seulement le test `noExternal.test.ts` qui interdit ces adresses. Ce test est vert. Aucune requête externe vue dans le navigateur (A26). Le banc a tourné deux fois sans clé sur `67a5152`, en cerveau heuristique, 132,5 et 74,9 s : il ne transmet aucune clé | `67a5152` + cette passe ; navigateur : `11b3f20` |
| A26 | Depuis zéro, navigateur | pass | Copie propre : `npm ci` 22 s, `npm run build` 5 s, `npm run agency` debout en moins de 10 s. Nouvelle partie « Sans fin », graine 24631, ×8, J16 en 30 s environ. Effectif, Compétition, Canaux, Croissance, Galerie ouverts, 0 erreur de console. PDF feuilleté. Film `cre_1550` lu avec le son : 1080×1920, 26,27 s, -14,1 LUFS, QA ok, mais écouté par personne. Onglet caché 8 jours simulés : le résumé « Pendant ton absence · J47 → J59 » s'ouvre. Rechargé : même jour, même trésorerie, 5 178,84 € | `11b3f20` |
| A27 | La nuit | pass | `taskkill /F /T` en plein film à J71, tick 1, 6 988,78 €. Au redémarrage : même run, même jour, même tick, même trésorerie, la file de films continue, vitesse revenue à ×1, résumé « Jour 71 : arrêt brutal de l'agence ». Un Ctrl+C à la main n'a pas été essayé. Le même signal, envoyé à une console cachée sur `67a5152`, sauvegarde le run et libère le port | `11b3f20` |
| A28 | Documents | pass | `README.md`, `docs/ARCHITECTURE.md`, `docs/BALANCE.md`, `docs/ROADMAP.md` suivent ce qui est livré, les coupes sont listées ci-dessous | `67a5152` + cette passe |

**Ce qui n'a pas tourné sur le commit final :** A6 à A9, A13, A14, A16, A17 sur de vrais fichiers, A19, A20, A22, A24, A26 et A27 sont lus sur `11b3f20` ou avant. A11, A12 et tout contrôle de l'étape 4 sont lus sur `9513e97`, et ces contrôles ne peuvent plus être relancés. Aucun test de longue durée n'a été refait après la passe de texte. Sur `67a5152`, seule la relecture indépendante a rendu des films et ouvert un guide, sur une partie de la graine 42 : 22 films, un regardé, un PDF feuilleté. Rien de systématique.

## Les huit contrôles sur le commit final

Recomptés sur `sweep182.json` et `last-fc.json` (`67a5152`) avec la méthode de `server/scripts/calibrateLib.ts`. **Deux échouent, K7 et K8.**

| # | Contrôle | Cible | Lu | Verdict |
|---|---|---|---:|---|
| K1 | `normal` : objectif à J60 | 15 à 27 sur 30 | 21/30 | pass |
| K2 | `normal` : médiane à J60 | 1 000 à 4 000 € | 2 728 € | pass |
| K3 | `normal` : faillites à J60 et à J180 | au plus 2 à chacun | 0 et 2 | pass, à la limite |
| K4 | `facile` : objectif, faillites | au moins 24 sur 30, aucune | 26/30, 0 | pass |
| K5 | `cauchemar` : faillites, trésorerie médiane | au plus 8, au moins 250 € | 0, 313 € | pass |
| K6 | Violations, écarts, NaN, 90 runs | tout à 0 | 0, 0, 0 | pass, contrôle de fraîcheur |
| K7 | `normal` : remplacements par graine, médiane | au moins 1 | 0, 5 en tout | **ÉCHEC** |
| K8 | `normal` : pente positive des semaines 9 à 26, S26/S9 | au moins 24 sur 30, au moins 2,0 | 20/30, 1,79 | **ÉCHEC** |

L'étape 3 lisait 27/30 et 2,06 sur K8 pour le candidat E, et c'est K8 qui l'a fait gagner : `docs/BALANCE.md` §4.7.

## Les coupes (PLAN §6, D65)

### Ce qui a été coupé

Chaque coupe a été vérifiée dans le code livré. `0` veut dire que le nom n'apparaît nulle part sous `server/src`, `shared` et `web/src`.

| Coupe | État |
|---|---|
| Sièges stables, `personId`, renommages | Coupés, `personId` 0 |
| CEO dans la ligue, compétence `direction`, preuve `board` | Coupés, la CEO reste hors ligue |
| Promotion au poste de chef | Coupée |
| `budgetPct`, `talentSpeed`, gel à l'arrivée, `HIRE_COST` | Coupés, 0 |
| `payrollCap` | Coupé, 0 |
| Reciblage | Coupé. Il reste une clé `retarget` dans `ALLOC.priorElasticity`, qu'aucun canal ne lit |
| Organique hors TikTok | Coupé |
| `channel_cpm_spike` | Coupé, 0 |
| Témoins `platform_claims` et `no_bandit` | Coupés, 0 |
| `buyerScore`, `talentEdge`, `thumbFactor` | Coupés, seul un commentaire dit que `thumbFactor` est coupé |
| Marque (`market.brand`) | Coupée, 0 |
| Porte de palier sur les canaux et les embauches | Coupée |
| Scènes vidéo `before_after`, `step_list`, vidéo 2:3 | `step_list` 0. `before_after` reste un style d'accroche et un tableau de guide, pas une scène de film. **Pas tout à fait coupée :** l'agence ne produit pas de vidéo 2:3, les épingles Pinterest 2:3 sont des images fixes, mais `video/stage.ts` garde ce format et la route l'accepte. Non lu par A13 |
| Caveat, `@expo-google-fonts` | Coupés, 0 |
| 6 héros sur 14, 2 mises en page de couverture sur 4 | 5 héros coupés et non 6 : le pinceau a été dessiné (D133). 2 mises en page sur 4 restent coupées, avec des alias |
| Ballon, salle d'entretien, banc des candidats, statues, échafaudage, feux d'artifice, arche de scène | Coupés, 0 |
| `CandidateChip`, `scene.candidates` | Coupés, 0 |
| Calibration séparée dans chaque spécification | Coupée : une seule passe à la fin (S14) |

### Ce qui n'a pas été coupé

L'échelle de coupes de §6 n'a pas servi : son horloge était une estimation, le fondateur n'a pas fixé de date (D65). Les sept barreaux sont livrés.

| Barreau | État |
|---|---|
| P12.3, le monde en entier | Livré, pas réduit au quai et au tableau de la ligue |
| P3.6, duels formels | Livrés |
| P7.2, narrateur de `ugc_avatar` | Livré |
| P4.3, attributions et dernier clic | Livrés, puis la réconciliation a été coupée par la règle de l'étape 4, pas par l'échelle : `RECON.claimWeight` 0, D149 |
| Rivaux de P10.2 | Livrés |
| Pinterest | Livré, cinq canaux |
| P8.3, aperçus de pages | Livrés, relus par A18 |

Un seul point de la liste « à ne jamais couper » a bougé : la réconciliation, par la règle de l'étape 4 et non par l'échelle (D149). `reconcile_channels` reste comme rapport. Le reste n'a pas été touché : paie, défi de la ligue, QA, test du monde, replis, compaction, résumé, S14, S15.

Quatre choses ont quitté le produit par les règles de l'étape 4, et non par une coupe de plan : le ROAS marginal comme règle du budget, la réconciliation, le tempo comme effet de marché, la règle du nouveau test (`docs/BALANCE.md` §4.5).
