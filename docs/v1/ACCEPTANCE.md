# Acceptation de la V1

Les 28 lignes de `docs/v1/PLAN.md` §5, chacune avec son verdict, son nombre et le commit sur lequel elle a été lue. **26 passent, A6 et A10 échouent.** Une ligne qui passe ne dit pas que tout va bien : les réserves sont dans `docs/BALANCE.md` §4.7 et §4.8, les limites au §7.

Le code final est `fff9634`. Il contient la dernière liste : les pages de vente, les ordres du fondateur, le test sous la ligne (D165 à D173). Trois autres repères :

- **`fff9634` + cette passe :** le code final, avec les documents de cette passe. Rien sous `server/src`, `shared` ou `web/src` n'a changé.
- **`67a5152` :** le code avant la dernière liste, sans le test sous la ligne, sans l'ordre de baisse et avec les anciennes pages. Plus aucune ligne n'est lue là, seul un essai de console l'est, en A27.
- **`9513e97` :** l'entreprise d'avant les bascules de l'étape 4. Une ligne lue là décrit une entreprise qui a changé depuis.

## Les 28 lignes

| # | Ligne | Verdict | Nombre | Lu sur |
|---|---|---|---|---|
| A1 | Types | pass | `npm run typecheck`, code 0 | `fff9634` + cette passe |
| A2 | Tests | pass | Serveur 2 954 passés, 3 ignorés, 62 fichiers ; interface 554 passés, 16 fichiers ; liste des tâches sans handler vide (`pillars.test.ts`). `test:long` 5 sur 5, 486,7 s, lu sur `fff9634` avant cette passe, pas relancé | `fff9634` + cette passe |
| A3 | Build | pass | `npm run build`, code 0, sur une copie propre 1,5 s, 0 `http` dans `dist/index.html`, pdfjs dans un seul morceau chargé à la demande | `fff9634` |
| A4 | Même graine, même run | pass | `replay.test.ts` vert : 2 runs complets de 45 jours identiques sous le filtre `decisions()` | `fff9634` + cette passe |
| A5 | Recharger = ne pas interrompre | pass | `replay.test.ts` vert, en `flat` (route du licenciement sur la graine 3) et en `league` | `fff9634` + cette passe |
| A6 | Un an, graine 7 | **ÉCHEC** | **p95 d'une journée 1 048,0 ms pour 800**, sur une machine calme, mesuré : le reste de la machine a pris 0,4 % de ses 20 fils. Tout le reste tient : 226,4 s pour 240, `world.json` 10,8 MB pour 12, direct 362,0 kB pour 400, `/api/state` 685,0 kB pour 700, tas 292,9 MiB sous 500 MB, dossier 143,0 MB pour 150, Σ grand livre = trésorerie, violations 0. Trésorerie J360 67 805,36 €. La commande sort en code 1 sur cette seule cible. Connu, pas nouveau : soit une décision amende la cible, soit le rendu PDF sort de la boucle du jour | `fff9634` |
| A7 | Un an, 10 graines | pass | 10 graines sur 10, 365 jours : 0 plantage, 0 NaN, 0 écart de grand livre, 0 violation. Marges minces : direct jusqu'à 399,3 kB pour 400 (graine 5), dossier 143,0 MB pour 150, `/api/state` 685,0 kB pour 700, tas 303,5 MiB. Trésorerie J360 de 14 339 à 67 805 €, médiane 29 033 €. Chaque graine sort en code 1, seulement sur le temps ou le p95 (186,6 à 450 s, 965 à 2 362 ms), à côté d'autres travaux : ces temps ne sont pas des mesures, et la ligne ne demande que 0 plantage et 0 NaN. La graine 7 redonne au centime la trésorerie J360 d'A6 | `fff9634` |
| A8 | Tourne seule | pass | Guide en ligne à J15 sur 30/30 (il en faut 28), premier guide J4 sur 26 graines, J6 sur 3, J7 sur 1. Aucune tâche ouverte plus de 10 jours, la plus vieille 9 jours. 233 embauches sur 28/30 graines, 0 tâche en attente du fondateur. Les graines 5 et 29 n'ont aucune embauche à J90 | `fff9634` |
| A9 | Bonne taille d'équipe | pass | Effectif à J60 : 9 valeurs de 8 à 18, médiane 14, aucune graine à 31. Paie au grand livre sur 30/30, médiane 1 357 € | `fff9634` |
| A10 | La compétition est réelle | **ÉCHEC** | **Médiane 0 remplacement à J180** pour 1 demandé. 1 à J60, 4 à J180, 4 à J182, sur 30 entreprises. Deux des quatre ont remplacé quelqu'un sous la moyenne de sa famille, gain moyen de talent réel +0,14. Tenu par les tests : chaque `leftBecause` a ses nombres, chaque embauche bat le titulaire de sa marge. Deux essais bornés n'ont pas suffi (D146, D147) | `fff9634` (relevé de 182 jours, recompté dans cette passe) |
| A11 | Les agents progressent | pass | `meanLeague` à J60 au-dessus de J1 sur 25/30 (il en faut 24), bras `flat`, médianes 0,614 → 0,677. Test talent 12 et `talent-levers.test.ts` verts sur `fff9634` + cette passe | `9513e97` |
| A12 | Grandit seule | pass, comme rapport | La ligne demande de rapporter, et de sortir la courbe : c'est fait (`docs/BALANCE.md` §4.4, §4.5). **Sur le fond, scale rate 2 cibles sur 5 :** A1 1,33 pour 2,0, A2 1,15 pour 1,5. A3 2,03, A4 0,84, A5 0 contre 0 passent. **Sur le commit final, A3 échoue (20/30, 1,92), et A1, A2, A4 n'ont pas de contrôle :** l'étape 4 est fermée (D149) | `9513e97`, A3 relu sur `fff9634` |
| A13 | Vrai MP4 | pass | 12 films sur 12 de ce commit, 6 de la graine 4, 6 de la graine 7, trois formats aux deux formats d'image : h264, yuv420p, 30/1, 6 en 1080×1920 et 6 en 1080×1350, aac, 20,0 à 28,97 s, 3,14 à 6,01 MB, moov avant mdat 12/12 lu dans les octets, `qa.ok` 12/12, -14,5 à -13,9 LUFS | `fff9634` |
| A14 | La vidéo est regardée | pass | 8 tuiles de 12 images lues à l'œil, sur 12 films : accroche lisible image 1 sur 8/8, vraie page du guide sur 5 films voix sur 5, couverture sur 3 diaporamas sur 3, texte dans les zones. `blackdetect` et `freezedetect` : 0 sur 12 films. Les 4 autres tuiles sont tracées, sondées, pas ouvertes. Deux défauts faibles et un moyen vus ici (`docs/BALANCE.md` §7, Films). Le son est mesuré, **personne n'a écouté un film** | `fff9634` |
| A15 | Plus de « 31 » | pass | La commande de la ligne sort 2 lignes, deux titres du test de l'ancienne équipe dans `runtime.test.ts` | `fff9634` + cette passe |
| A16 | PDF en images | pass | Les 4 voix sur le run de la graine 4 : conte `prd_6208`, dossier `prd_173`, atelier `prd_7713`, signal `prd_3004`, 7 pages chacun. 0 débordement, 0 page à moitié vide, accents justes, art voulu. En plus, les 8 pages du kit `prd_9619` et trois pages de vente. Lues réduites à 1 900 px, une seule paire à pleine taille, aucun guide page par page. Les planches de la graine 7 sont tracées, pas lues. Un défaut faible : une checklist coupée entre p. 7 et p. 8 du kit | `fff9634` |
| A17 | Structure des PDF | pass | `design.test.ts` et `layout.test.ts` : 132 passés. 37 vrais guides des graines 4 et 7 : 7 à 8 `/FontFile2`, 0 police standard, `/Outlines` 37/37, 10 à 11 signets, 0 mot perdu aux ligatures. Deux rendus identiques 48/48, les 11 kits compris, qu'un autre moteur dessine. Égal au fichier du run 36/37 : l'exception est `prd_173`, dont le lien de suite pointe la v1. Recensement des 66 PDF : au moins 7 polices, `/Outlines` partout | `fff9634` |
| A18 | Page de vente | pass | Ouverte dans le navigateur, `prd_1836` : livre en 3D avec deux écrans de vraies pages, 29 € partout et égal au prix du monde, bandeau « Boutique virtuelle Pixel Agency — environnement de test, aucun paiement réel », 1 requête, 0 externe. Audit des fichiers sur les graines 4, 7 et 42 : 50 pages de guide, 13 de kit, 87 PDF, 0 défaut compté, dont actions de la page = PDF sur 50 guides, kits qui disent ce qu'ils sont, aucun double point, aucun avis daté par le jour de la partie. 9 guides republiés sur 9 : page, PDF, nombre de pages et prix d'accord. Le haut de page est vu à l'œil, le reste lu en texte, sur ordinateur seulement : 375 px pas regardé, boutons d'achat pas cliqués. Un défaut d'accord reste, « 1 avis vérifiés », et le lien de fin du PDF attend la vraie boutique (`docs/BALANCE.md` §7) | `fff9634` |
| A19 | Replis propres | pass | 4 niveaux sur 4, dans l'ordre de la ligne, sur une copie propre. `storyboard_only` : run fini, « Indisponible : ffmpeg introuvable », bouton désactivé. `no_voice` : 2 films `qa.ok`, « Sans voix sur cette machine ». `no_pages` : 2 films `qa.ok`, voix Hortense, « Sans pages du guide ». Réel, `npm ci --omit=optional` : code 0, « Indisponible : moteur de dessin introuvable », bouton désactivé. 0 erreur de console sur les 4, 3 guides en ligne, `lastError` null. `forever.mjs` démarre sur cette installation. `pdfSheet` sort en 1 et nomme `@napi-rs/canvas`, comme son en-tête le promet | `fff9634` |
| A20 | Polices absentes | pass | Dossier vide, 4 voix : `degraded`, `interior` 60 exactement (témoin 89,2 à 98,2), 0 `/FontFile2`, 0 débordement, 0 plantage, le problème « Polices » signalé. Entreprise entière, 45 jours, graine 42 : `running`, 6 produits, 4 en ligne, `interior` 60, 0 tâche échouée. La voix `signal` sort en 28 pages au lieu de 30 dans les polices de secours | `fff9634` |
| A21 | Vérité cachée | pass | `truth.test.ts`, `views.test.ts` et le test de route verts sur `fff9634` + cette passe. Balayage réel de 603 fichiers : les 9 fichiers serveur répondent 403, les 594 autres ne tiennent pas la sentinelle | tests : cette passe ; balayage : `9513e97` |
| A22 | Garde-fous | pass | 210 tests sur 4 fichiers et 76 sur le filtre approbation et conformité. 9 runs d'approbation : `withoutYes` à 0 partout. Sans signature, graine 12, 60 jours : 2 demandes ouvertes, 0 guide, 0 embauche, 0 canal, 0 pub. Tout signé : 9 embauches, 4 canaux, 7 envois, 23 campagnes. Argent seul : 0 embauche, 0 canal. Sauf `open_channel` et `send_broadcast` : 4 et 3 demandes ouvertes, 0 canal, 0 envoi. Remplacement non signé : 0 départ, 1 demande ouverte. Graine 9, 130 jours : 1 licenciement, demandé et signé. 0 jour au-dessus de l'enveloppe du jour du CFO, 0 sortie réseau. Le « plafond » de la semaine, lui, ne plafonne pas (`docs/BALANCE.md` §7) | `fff9634` |
| A23 | Grand livre | pass | 5 runs gardés, 485 jours : grand livre cumulé = KPI de trésorerie chaque jour, 0 écart. Pub KPI = grand livre et CA KPI = grand livre sur 5/5. Par canal, grand livre = stats du marché au centime sur les graines 4, 7 et 42 ; sur les graines 20 et 5, des lignes du marché sont retirées par compaction et le détail ne se compare pas. Fin de run sur les 40 runs d'A7 et A8 : 0 écart. Les 150 runs de la lecture appariée : 0 écart. C'est un contrôle de fraîcheur, pas de justesse (`docs/BALANCE.md` §4.7) | `fff9634` |
| A24 | Vieille sauvegarde | pass | Copie chargée, J21 à J26, 5 jours, 0 plantage, Σ grand livre = trésorerie 5 jours sur 5, 0 NaN, les mêmes identifiants du début à la fin, 0 ligne de salaire, 0 embauche, 0 poste, pas de ligue, pas de `talentTruth`, TikTok seul. Trésorerie 762,67 → 779,59 €. Fixture `fe3c3399` identique avant et après. Run legacy neuf = empreinte enregistrée `b6b0ec5a`. « Se comporte comme avant » repose sur ces lignes, pas sur une égalité d'empreinte : à J25, la vieille sauvegarde diffère d'un run neuf sur `ledger`, `kpis` et `tasks`. Pas repassé par le vrai serveur sur ce commit | `fff9634` |
| A25 | Rien de réel | pass | Les deux commandes de la ligne ne sortent aucun point réel, seulement le test `noExternal.test.ts` qui interdit ces adresses. Ce test est vert. Aucune requête externe vue dans le navigateur (A26). Le banc a tourné deux fois sans clé sur `fff9634`, en cerveau heuristique, 77,7 et 77,8 s : il ne transmet aucune clé | `fff9634` + cette passe |
| A26 | Depuis zéro, navigateur | pass | Troisième copie propre : `npm ci` 10,6 s, `npm run build` 1,5 s, 0 `http`, `npm run agency` debout en 5 s. « Sans fin », graine 9467, ×8 : J15 en 25 s environ, 2 guides en ligne. Effectif, Compétition, Canaux, Croissance, Galerie ouverts, 0 erreur de console à chaque lecture. PDF feuilleté, pages 2-3 sur 8. Film `cre_1061` lu non muet, 1080×1920, 32,47 s, audio décodé, écouté par personne. Résumé « Pendant ton absence · J85 → J100 » ouvert seul. Rechargé : même run, J103, tick 3, 11 813,93 €, même effectif. **Limite :** le volet ne cache pas vraiment un onglet : l'onglet caché a été simulé, `visibilityState` surchargé et vrai événement, 8 jours simulés | `fff9634` |
| A27 | La nuit | pass | Deux arrêts brutaux par `taskkill /F /T`. À ×8 en plein film : même run au redémarrage, ×1, 1 film en rendu et 2 en file. À ×1, pour une mesure exacte : tué à J132 tick 1, 23 252,93 €, reparti à J132 tick 0, même trésorerie au centime, `lastError` null, debout en 2 s. Le redémarrage repart de la dernière sauvegarde : un tick en arrière, pas le même tick. Résumé ouvert seul, « Jour 132 : arrêt brutal de l'agence ». La date du premier arrêt est fausse d'un jour (`docs/BALANCE.md` §7). Un Ctrl+C à la main n'a pas été essayé. Le même signal, envoyé à une console cachée sur `67a5152`, sauvegarde le run et libère le port | `fff9634` |
| A28 | Documents | pass | `README.md`, `docs/ARCHITECTURE.md`, `docs/BALANCE.md`, `docs/ROADMAP.md` suivent ce qui est livré, les coupes sont listées ci-dessous | `fff9634` + cette passe |

**Ce qui n'a pas tourné sur le commit final :** A11 et A12 sont lus sur `9513e97`, comme tout contrôle de l'étape 4, et ces contrôles ne peuvent plus être relancés. Le balayage d'A21 est lu là aussi : personne ne l'a relancé sur `fff9634`. Le reste est lu sur `fff9634`, mais pas en entier :

- **Le son :** aucun film écouté par une personne, seuls le volume, la piste aac et le décodage sont mesurés.
- **A14 :** 4 tuiles sur 12 tracées, sondées, pas ouvertes (graine 7, `cre_7490`, `cre_14330`, `cre_9212`, `cre_18891`).
- **A16 :** planches de la graine 7 tracées, pas lues. Aucun guide lu page par page.
- **A18 :** sur ordinateur seulement, 375 px pas regardé, boutons d'achat pas cliqués. La page de kit d'un guide en pause et les nouveaux mots des pages arrêtées ne sont lus qu'en texte.
- **A19 :** le téléphone de l'aperçu reste noir à `storyboard_only`, le volet refuse cet iframe. Son aspect n'est pas jugé.
- **A24 :** pas repassé par `/api/load` du vrai serveur, lu par `persist.loadWorld` seulement.
- **A26 :** un onglet réellement caché est impossible dans ce volet.
- **A27 :** à ×8, l'état exact à l'arrêt n'est pas connu, seul l'arrêt à ×1 mesure. Ctrl+C à la main pas essayé.
- **A7 :** temps lus à côté d'autres travaux. Aucune graine autre que la 7 n'a de p95 sur machine calme.
- **A23 et K6 :** contrôle par canal au centime sur 3 runs seulement.
- **Le test sous la ligne :** pas vérifiés, un rechargement pendant qu'un test attend le oui du fondateur, un rechargement un jour de panne pendant un test. Un test gagné est lu dans le monde, pas à l'écran.
- **L'ordre de baisse :** à l'écran, un seul libellé essayé, deux fois. Les phrases de D166 et D171 viennent de bancs hors du dépôt. Des 60 de D171, 32 sont dans les tests mot pour mot, 28 non. Le tableau de D166 compte aujourd'hui 34 phrases, 29 dans les tests, 5 non. `orders.test.ts` garde 55 phrases de baisse. Les 60 ont été rejouées sur `fff9634` dans cette passe, moteur seul, graines 42 et 7, jamais au navigateur : 3 commandent des tâches de pub, deux demandes d'accroches, qui sont du travail demandé, et « baisse le prix de la pub », un défaut connu (`docs/BALANCE.md` §7).
- **Trois points de la revue, pas lancés :** la voix de secours `STD_VOICE` sur un kit ou une page arrêtée, le temps des expressions régulières sur un très long texte de mission, et `mergePlans` en mode Claude (`docs/BALANCE.md` §7).

## Les corrections de la dernière liste, relues sur `fff9634`

Sept points de D165 à D172, relus un par un dans l'interface ou sur de vrais fichiers.

| # | Point | Verdict | Nombre |
|---|---|---|---|
| N1 | « Baisse le budget de pub » | pass | Avec une campagne : 18,20 → 12,74 €/jour tout de suite, 0 nouvelle pub jusqu'au jour 30, 7 tâches annulées, plafond de la semaine posé. Dépense J25 à J29 : 11,83 à 12,58 €, 0 lancement avant J31. Sans campagne : « Rien à baisser : aucune campagne ne tourne » |
| N2 | Bandeau d'objectif | pass | Masqué à J59, rechargé à J103 : il ne revient pas, 0 erreur |
| N3 | Titre du résumé | pass | Touche `d` à J4 : « Depuis le début · J1 → J4 », « 4 jours de l'agence ». Le texte en dessous dit encore « sur 7 jours » (`docs/BALANCE.md` §7) |
| N4 | Carte d'un agent | pass | Nadia à J39 : « 68 tâches faites », « Aucune tâche en cours », tâches récentes listées. Plus de contradiction sur les tâches, une autre reste sur la note (§7) |
| N5 | Compteur de la Galerie | pass | « Vidéo pub » : 2 avant le clic, 2 après |
| N6 | Guide arrêté | pass | `prd_8933`, graine 42 : « Ce guide n'est plus en vente. », 0 bouton d'achat, 0 prix, 0 script, 1 requête. Les avis restent |
| N7 | Sortie de survie | pass | Graine 20 : mode survie à J60, levé J61 à 151,57 €, repris J62, test le même jour. Journal, résumé et Croissance disent le même test, avec les montants, en français clair. Test raté : ROAS 0,00 pour 28,90 €, pas de nouveau test avant le jour 82, 14 jours tenus. Graine 20, 130 jours : 4 tests, 0 gagné, 114,40 €. Graine 5 : 4 tests, 2 gagnés, 386 €. Plus longue période sans pub : 15 jours sur la graine 20, 9 sur la 5. La page Publicité ne marque pas la campagne comme test |

## Les huit contrôles sur le commit final

Recomptés sur les 90 runs du bras `on` (`normal` 182 jours, `facile` et `cauchemar` 60 jours), identiques au commit final, avec la méthode de `server/scripts/calibrateLib.ts`. **Deux échouent, K7 et K8.**

| # | Contrôle | Cible | Lu | Verdict |
|---|---|---|---:|---|
| K1 | `normal` : objectif à J60 | 15 à 27 sur 30 | 19/30 | pass |
| K2 | `normal` : médiane à J60 | 1 000 à 4 000 € | 2 629 € | pass |
| K3 | `normal` : faillites à J60 et à J180 | au plus 2 à chacun | 0 et 0 | pass |
| K4 | `facile` : objectif, faillites | au moins 24 sur 30, aucune | 26/30, 0 | pass |
| K5 | `cauchemar` : faillites, trésorerie médiane | au plus 8, au moins 250 € | 0, 630 € | pass |
| K6 | Violations, écarts, NaN, 90 runs | tout à 0 | 0, 0, 0 | pass, contrôle de fraîcheur |
| K7 | `normal` : remplacements par graine, médiane | au moins 1 | 0, 4 en tout | **ÉCHEC** |
| K8 | `normal` : pente positive des semaines 9 à 26, S26/S9 | au moins 24 sur 30, au moins 2,0 | 20/30, 1,92 | **ÉCHEC** |

L'étape 3 lisait 27/30 et 2,06 sur K8 pour le candidat E, et c'est K8 qui l'a fait gagner : `docs/BALANCE.md` §4.7. K6 tient aussi sur les 45 autres runs de la lecture d'acceptation (10 d'A7, 30 d'A8, 5 gardés). K3 lit 0 grâce à l'assurance, test et fondateurs à 0 mêlés : le bras `off`, qui coupe les deux d'un seul interrupteur, lit 0 et 2. Aucun run ne les sépare (`docs/BALANCE.md` §4.8).

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
