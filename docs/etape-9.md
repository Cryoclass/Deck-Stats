# Étape 9 — finitions d'interface et reports

Résultat attendu (docs/PLAN.md) : réponses de 7B appliquées (mur compact, « ↻ Nouvelles
mains » à 32 px, densité de la grille, arbre ET/OU profond, Δ à 10 px), aperçus de l'accueil
recalculés sans cache faisant autorité, attente de la DB fondée sur `healthy` dans `deploy.sh`,
et les retours de la ressaisie des 16 decks. L'étape 8 (commit `c17038d`, tag `etape-8-ok`) est
acceptée ; la production tourne sur `9d281cf`, base v2 avec 003 journalisée.

Découpage validé le 9 septembre 2026 :

- **9A** (cette session) : points 1 et 2 — aperçus de l'accueil, finitions de 7B ; tag
  `etape-9a-ok`, vérifications complètes.
- **9B** : point 3 (attente de la DB), vert intempestif du bouton Enregistrer, mode Non-engine et
  profil combiné ; tag `etape-9b-ok`.
- **9C** : extra et side éditables, variante « déploiement courant » du runbook, clôture ; tag
  `etape-9-ok`.

## Plan validé (9 septembre 2026)

### Constats de départ

- Aperçus : l'API renvoyait `summary: null` pour la liste et le détail, rien n'écrivait jamais
  `decks.summary`, l'accueil affichait « — » partout ; le serveur invalidait déjà le résumé à
  chaque enregistrement et à chaque écriture de bibliothèque ; aucun identifiant de version du
  moteur n'existait.
- Coût mesuré (Node, deck de 40 cartes) : passe premier 10 à 100 ms pour 8 à 20 types annotés,
  passe second jusqu'à 650 ms, calcul complet de l'éditeur (deux passes + contributions
  marginales) jusqu'à 3,3 s. Seize decks en passe premier : 0,5 à 2 s au total.
- Bouton Enregistrer : la vue du panneau de stats est un paramètre du deck, donc `setStatsView`
  marque « non enregistré » (décision de l'itération 6).
- Extra et side : le store, le dialogue d'ajout et le stepper ne touchaient que le main ; la
  configuration v2, le serveur et le brouillon transportent déjà les trois zones.
- Non-engine et profil : deux modes distincts, deux passages sur chaque carte ; le serveur exige
  une étiquette avant un profil (Q1 de 5B).
- Attente de la DB : `deploy.sh` attend par socket ; `db_ready` de lib.sh (deux `select 1`
  consécutifs, aussi par socket) souffre du même défaut dès que l'initialisation dure plus de
  deux secondes ; `run.mjs` des e2e est exposé en théorie mais ne monte aucun script
  d'initialisation.

### Point 1 — aperçus recalculés (moteur intact)

- Version du moteur : `vite.config.ts` calcule au démarrage un hash SHA-1 du contenu de
  `web/src/engine/*.ts` (hors tests et `reference/`), de `lib/engineModel.ts`, de
  `lib/conditions.ts` et de `lib/summary.ts`, injecté par `define` comme `__ENGINE_VERSION__`
  (16 hexadécimaux). Un commentaire changé invalide tous les aperçus : accepté (Q1).
- Résumé `{ engineVersion, mainSize, startRateFirst, brickRate, computedAt }` validé par le
  serveur (bornes 0–1, entier, chaîne courte, `mainSize` égal à la taille du main enregistré).
  `usableSummary(summary, version)` (pur) décide seul de l'affichage.
- À l'enregistrement : `saveDeck` joint le résumé au PUT (champ de premier niveau, hors
  `configuration`) seulement si le résultat courant est celui de la version demandée pour ce
  deck (`!stale`, `!computing`, `resultVersion === modelVersion`, même ouverture) ; le serveur
  l'écrit dans la même transaction, après le `summary = null` existant.
- À la demande : l'accueil possède son propre client de calcul (comme le comparateur) ; pour
  chaque deck sans résumé ou d'une autre version, il charge le détail, construit le modèle avec
  la bibliothèque, calcule la passe premier seule (mode `first` du worker, hors moteur),
  affiche, puis persiste par `PUT /api/decks/:id/summary` avec `expectedRevision` ; un 409 est
  ignoré (Q7). `GET /decks` renvoie le résumé stocké ; `GET /decks/:id` garde `summary: null` (Q8).
- Valeurs affichées inchangées : « départs ≥1 (premier) » et « brick (premier) » (Q2), arrondies
  au rendu, valeur fine dans l'infobulle.

### Point 2 — finitions de 7B

- Mur sous 640 px : récapitulatif compact « S 3 · U 1 » plus la note, à droite des cartes sur
  la même ligne, cartes jamais déformées ; ligne ≤ 80 px.
- « ↻ Nouvelles mains » en cible de 32 px (garde P7 passée de 24 à 32 px : seule modification
  d'un test existant, annoncée).
- Δ sous 640 px : cellules de 10 px et 32 px comme sur bureau (Δ est en pleine largeur).
- Densité à 1440 px : tuile réduite seulement si M1 (steppers 32 px), M4 (delta sur une ligne,
  non coupé) et le menu ⋯ à 32 px tiennent à 360 et 1440 ; sinon 96 px et point clos, mesure
  consignée.
- Arbre ET/OU profond : scénario e2e `conditions` qui construit « ET > OU > OU » par les gestes
  de l'Inventaire, capture à 360 et 1440 ; correction seulement si une garde casse.

### Point 3 — attente de la DB (9B)

`db_ready` de lib.sh réécrit : conteneur `healthy` si une healthcheck existe, puis, dans les
journaux, la dernière ligne « ready to accept connections » doit suivre « PostgreSQL init
process complete » quand cette ligne existe, puis un `select 1`. `deploy.sh` remplace sa boucle
`pg_isready` par `db_ready || die`. Preuve : cas I de test-migration-sequence.sh (conteneur créé
par `docker create` + `docker cp` des scripts d'initialisation et d'un `98-slow.sql` à
`pg_sleep(6)`, témoin du premier `select 1` par socket antérieur à « init process complete »,
séquence lancée aussitôt en code 0 sans « shutting down »), puis `rehearsal.sh --fixture` et la
suite A–I. Healthcheck Compose non touchée, notée comme amélioration (Q6).

### Point 4 — retours de la ressaisie (9B, 9C)

- Non-engine et profil combinés (9B) : le déroulant « Non-engine » choisit l'étiquette et le
  profil à poser (ou « profil inchangé ») ; un clic rend la carte conforme au couple choisi
  (étiquette posée si absente, profil posé s'il diffère) ; si la carte porte déjà exactement ce
  couple, le clic retire l'étiquette et, s'il ne reste aucune étiquette, le profil. Le bouton du
  mode annonce l'effet du prochain clic (poser / retirer) ; la valeur par défaut du déroulant
  est explicitée dans ce document lors de 9B — **retenue en 9B : « profil inchangé »** (l'étiquette
  seule, comportement d'avant 9B ; l'étiquette par défaut reste la première catégorie du compte,
  comme avant). Le mode Profil seul est conservé (Q4).
- Vert intempestif (9B) : la vue du panneau devient transitoire comme le contexte, retirée des
  paramètres émis, toujours acceptée en lecture ; le curseur d'importance reste un paramètre
  enregistré (Q3).
- Extra et side (9C) : `addCard`, `setCopies`, `removeCard` prennent une zone ; mutations extra
  et side marquées « non enregistré » sans recalcul ; section éditable par zone avec
  « + Ajouter », tuiles de 80 px et stepper de 32 px, toast d'annulation sensible à la zone ;
  au-delà de 15 cartes, avertissement seulement (Q5).

### Réponses aux questions ouvertes (validation du 9 septembre 2026)

1. Version du moteur par hash de build (`__ENGINE_VERSION__`) ; l'invalidation sur un
   commentaire est acceptée.
2. Conserver « départs ≥1 » et « brick (premier) » tels quels.
3. Le curseur d'importance reste un paramètre enregistré.
4. Mode Profil conservé ; dans le mode combiné, le bouton annonce l'effet du prochain clic
   (poser / retirer) ; la valeur par défaut du déroulant est explicitée ici (9B).
5. Extra et side : avertissement seulement au-delà de 15.
6. Healthcheck Compose non touchée, notée comme amélioration.
7. Persistance par `PUT /api/decks/:id/summary` avec `expectedRevision`, 409 ignoré.
8. `GET /decks/:id` garde `summary: null`.

Rappels : moteur, oracles, migrations intacts (le mode `first` du worker n'est pas le moteur) ;
aucune base personnelle, aucun VPS ; la seule modification d'un test existant annoncée est la
garde P7 (24 → 32 px).

## Compte rendu 9A (9 septembre 2026)

### Livré — point 1, aperçus

- [web/vite.config.ts](../web/vite.config.ts) : `__ENGINE_VERSION__` (SHA-1 tronqué des sources
  du calcul), déclaré dans `vite-env.d.ts` ; Vitest le reçoit par la même configuration.
- [web/src/lib/summary.ts](../web/src/lib/summary.ts) (pur) : `ENGINE_VERSION`,
  `summaryFromPass` (cumulé « au moins 1 » et brick de la vue Départs, même chemin que le panneau
  et `dataIdentity`), `usableSummary` (forme + version, sinon `null`), `summaryOfState` (résumé
  du résultat frais seulement).
- [web/src/worker/computeClient.ts](../web/src/worker/computeClient.ts) et
  [engine.worker.ts](../web/src/worker/engine.worker.ts) : mode `first` (passe premier seule,
  `second` rendue indisponible par `notComputedPass` : `total === 0` + motif, jamais copiée) ;
  faux worker aligné.
- [web/src/store/deckStore.ts](../web/src/store/deckStore.ts) : `saveDeck` joint
  `summaryOfState(s)` au PUT ; [api.ts](../web/src/lib/api.ts) : `saveConfiguration(…, summary)`,
  `putSummary`, `summary: unknown` (la version n'est vérifiée qu'à l'affichage).
- [web/src/components/HomePage.tsx](../web/src/components/HomePage.tsx) : `usePreviews` (client
  propre, file séquentielle par clé stable des decks à recalculer, disposé au démontage ; renommer
  ne relance rien), états « … » (en cours) et « n/d » (motif du moteur en infobulle), attribut
  `data-preview` pour les gardes, infobulle à deux décimales.
- [server/src/domain/deckSummary.ts](../server/src/domain/deckSummary.ts) (pur) :
  `parseSummary`, `checkSummaryMatches` ; [routes/decks.ts](../server/src/routes/decks.ts) :
  `GET /decks` renvoie `d.summary`, `PUT /decks/:id` accepte `summary` (écrit après
  `writeConfiguration`, même transaction, refus 400 si la taille ne correspond pas),
  `PUT /decks/:id/summary` (verrou, 409 si révision différente, 400 si taille ou forme, ni
  révision ni `updated_at` modifiées, 404 pour autrui).
- Tests : `summary.test.ts` (7), `preview.test.ts` (4 : joint si frais, rien sans résultat, rien
  si périmé, rien d'une autre ouverture), `configuration.test.ts` (+1 : validation stricte et
  taille), `persistence.integration.ts` (+1 : écriture avec la configuration, refus de taille,
  effacement sans résumé, 409 / 400 / 200 sur l'endpoint, révision et `updated_at` intactes,
  404 autrui, invalidation par la bibliothèque) ; scénario e2e `home` (H1 faux résumé d'une
  autre version jamais affiché, H2 valeurs = panneau, H3 persistance et accueil suivant sans
  recalcul, H4 résumé joint à l'enregistrement, H4 bis rien de joint pendant un recalcul).

### Livré — point 2, finitions de 7B

- Mur ([HandWall.tsx](../web/src/components/HandWall.tsx)) : sous 640 px, ligne `p-1`, cartes
  de 60 px (68 dès 640 px), récapitulatif compact `CompactRecap` (« S n » sur « U n », mêmes
  couleurs et infobulles) et note de 28 px à droite des cartes sur la même ligne ; dès 640 px,
  récapitulatif complet et note de 36 px comme avant. Mesuré à 360 px, second (6 cartes) :
  ligne de 65 px, cartes de 41 px, aucun débordement ; huit mains par écran au lieu de cinq.
  Le récapitulatif est empilé et non « S 3 · U 1 » sur une ligne parce que six cartes à 360 px
  ne laissent que ~80 px à droite (décision consignée).
- « ↻ Nouvelles mains » : `px-3 py-2 font-medium`, 32 px, style neutre conservé (un seul bouton
  émeraude par écran, charte §13 : Enregistrer).
- Δ ([ComparePage.tsx](../web/src/components/ComparePage.tsx)) : `MatrixGrid` reçoit `compact`
  (défaut `true` pour A et B) ; Δ passe `compact={false}` → cellules de 10 px et 32 px à toute
  largeur, coin « ↓S \ U→ ». Mesuré à 360 px : 24 cellules de 32 px, aucune coupée, aucun
  défilement interne.
- Densité de la grille ([AnnotationGrid.tsx](../web/src/components/AnnotationGrid.tsx)) :
  `minmax(84px, 1fr)` essayé et mesuré — à 1440 px les trois cibles de 32 px tiennent, mais le
  delta « −1 : −6.38% » (53 px) est coupé dans les 49 px restants (garde M4 en échec) ; à 360 px
  rien ne change (3 colonnes dans les deux cas). **96 px conservé, point clos** : 9 colonnes à
  1440 px, 3 à 360 px (garde de comptage ajoutée à `guards.mjs`).
- Arbre ET/OU ([ConditionEditor.tsx](../web/src/components/ConditionEditor.tsx)) : mise en page
  validée au navigateur à 1440 et 360 px sur « (Xi OU (Delta OU Beta)) ET (Zeta OU Eta) »
  (profondeur 3, ET > OU > OU) et, par un premier passage du scénario, sur une profondeur 4 ;
  groupes imbriqués rendus par encadrés, retour à la ligne sans débordement (éditeur de 317 px à
  360). **Seule correction** : sélecteurs, champ « ≥ n » et ✕ portés à 24 px (`h-6`) — ils
  mesuraient 23, 18 et 16 px, sous le minimum « ailleurs » du contrat §6.
- Gardes : `mobile.mjs` (P7 : Nouvelles mains ≥ 32 px ; sous 640 px récapitulatif compact
  visible, à droite des cartes sur la même ligne, ligne ≤ 80 px ; dès 640 px récapitulatif
  complet ; P3 : Δ police ≥ 10 px, cellules ≥ 28 px, aucune coupée, aucun défilement interne),
  `guards.mjs` (colonnes de la grille : 9 à 1440, 3 à 360), nouveau scénario `conditions`
  (structure de l'arbre, opérateurs dans l'ordre OU, OU, ET, OU, éditeur et section sans
  débordement, body sans défilement, sélecteurs et « ≥ n » ≥ 24 px, un ✕ par feuille,
  captures).

### Preuves

```powershell
npm.cmd run typecheck                      # serveur, web, scripts : 0 erreur
npm.cmd run build                          # avertissement ExcelJS attendu seulement
node scripts/test-quiet.mjs                # 188 tests web (17 fichiers), 8 serveur
npm.cmd run e2e -w web                     # setup, guards, compare, mobile (P1–P8 conformes aux 4 largeurs), home, conditions : OK
bash deploy/test-migration-sequence.sh     # cas A–H, 49 gardes (deploy/ intouché en 9A)
# PostgreSQL jetable 55433 (deploy/configuration-v2.md), puis :
# TEST_DATABASE_URL=postgres://step23:step23-disposable@127.0.0.1:55433/step23 npm run test:integration -w server
#   → persistence 12 tests, purge 10 tests
```

Conteneurs jetables arrêtés (55433, 55434, 55440) ; seule la base de dev `ygo-proba-db` (5433)
reste, jamais touchée.

### Contrôle par mutation

| Mutation                                                            | Garde qui casse                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| M1 `usableSummary` ignore la version du moteur                      | `summary.test.ts` (« refuse … d'une autre version »)                   |
| M2 `summaryOfState` accepte un résultat périmé ou en cours          | `summary.test.ts` (« n'envoie rien d'un résultat périmé … »)           |
| M3 `checkSummaryMatches` sans effet (serveur)                       | `configuration.test.ts` (« Missing expected exception »)               |
| M4 « ↻ Nouvelles mains » en `py-1` (24 px)                          | `mobile` P7 aux quatre largeurs (`h: 24`)                              |
| M5 récapitulatif compact masqué (récapitulatif complet sous 640 px) | `mobile` P7 à 360 / 390 (compact absent, ligne 344 > 341, débordement) |
| M6 Δ en cellules compactes                                          | `mobile` P3 à 360 / 390 (police 9, largeur 20)                         |
| M7 sélecteurs ET/OU sans `h-6` (23 px)                              | `conditions` (9 sélecteurs à 23 px)                                    |

Fichiers restaurés par copie après chaque mutation, vérifiés par `grep` ; la suite complète a
été rejouée ensuite depuis une pile neuve.

### Limites

- Les aperçus dépendent de la bibliothèque du compte au moment du calcul (comme le panneau) ;
  une écriture de bibliothèque les invalide côté serveur (règle existante), l'accueil suivant
  recalcule.
- Le hash de version couvre les sources du calcul, pas le worker ni les composants : un
  changement d'affichage ne recalcule rien, à dessein.
- `GET /decks` transporte le résumé stocké tel quel (`unknown`) : seule `usableSummary` décide ;
  un résumé historique (`{"startRateFirst": 1}`) est ignoré comme un résumé d'une autre version.
- Le récapitulatif compact est empilé ; la lecture « S 3 · U 1 » sur une ligne aurait exigé des
  cartes de moins de 40 px à 360 px en second.
- Les gardes mesurent le rendu de Chrome avec la police système de Windows (comme en 7B).

### Questions ouvertes (non tranchées)

- Aucune nouvelle question de 9A. Les questions de 8 restent : Q11 (`ygo_previous`), Q12 / Q13
  sans objet, équivalence `--emit-sql` / `--apply`.

### Passation vers 9B

- Point 3 : `db_ready` (lib.sh) et `deploy.sh`, cas I de test-migration-sequence.sh,
  `rehearsal.sh --fixture` rejouée ; ne jamais modifier un script de deploy/ pendant qu'il
  tourne.
- Vert intempestif : `statsView` transitoire (retirer des `params` émis dans
  `configurationFromState`, garder `validateParams` permissif, `setStatsView` sans `markDirty`) ;
  vérifier `exportDeck.ts` (référence de catégorie de la vue dans l'archive) et
  `deckArchive.ts` (remap) qui la lisent encore.
- Mode combiné : `ModeBar` (déroulant étiquette + profil, valeur par défaut à expliciter ici),
  `AnnotationGrid.dispatch`, bandeau annonçant l'effet du prochain clic ; fixture e2e intacte
  (mode Profil conservé) ; garde e2e sur l'API après un clic.

## Compte rendu 9B (9 septembre 2026)

### Livré — point 3, attente de la DB

- [deploy/lib.sh](../deploy/lib.sh) : `db_ready` réécrite — (1) état `healthy` du conteneur
  quand une healthcheck existe (`docker inspect`, `none` sinon) ; (2) dans les journaux du
  démarrage courant (`docker logs --since <StartedAt>`, bornés), le **dernier** « database
  system is ready to accept connections » doit suivre le **marqueur de l'entrypoint** :
  « PostgreSQL init process complete » (volume neuf) ou « PostgreSQL Database directory appears
  to contain a database; Skipping initialization » (volume déjà initialisé) ; sans marqueur,
  l'initialisation est en cours et rien n'est définitif ; (3) un `select 1`. 120 s au plus.
  `db_container_id` (nom jetable ou `compose ps -q db`), `db_startup_logs`,
  `db_definitive_server_announced`. `rehearsal.sh`, `test-backup-restore.sh` et
  `test-migration-sequence.sh` héritent de la nouvelle attente sans changement.
- [deploy/deploy.sh](../deploy/deploy.sh) : la boucle `pg_isready` par le socket est remplacée
  par `db_ready || die`, message nommant `ps` / `logs db`.
- **Écart au plan, consigné** : le plan disait « le dernier « ready » après « init process
  complete » _quand cette ligne existe_ ». Vérifié sur conteneur jetable : le serveur temporaire
  annonce lui aussi « ready to accept connections » **avant** que le marqueur n'existe ; la règle
  littérale aurait donc accepté la fenêtre qu'elle devait exclure. Le marqueur « Skipping
  initialization » (volume déjà initialisé, présent à chaque redémarrage) permet d'exiger un
  marqueur dans tous les cas. La healthcheck Compose est intouchée (Q6) : elle est un préalable,
  pas la preuve.
- Cas I de [deploy/test-migration-sequence.sh](../deploy/test-migration-sequence.sh), comme
  planifié : conteneur `docker create` + `docker cp` (schéma, 001, 002, 003 comme en production,
  plus `98-slow.sql` = `pg_sleep(6)` qui prolonge la fenêtre une fois la base complète), démarré ;
  témoin en arrière-plan (premier `select 1` réussi par le socket, journaux capturés à cet
  instant) ; `db_ready` ; séquence lancée aussitôt (`interactive`, sans terminal). Douze gardes :
  témoin réussi **sans** « init process complete » dans les journaux (fenêtre ouverte, l'ancienne
  attente aurait accepté) et avec le premier « ready » du serveur temporaire ; à la sortie de
  `db_ready`, « init process complete » suivi du second « ready » ; `98-slow.sql` joué ; code 0,
  « déjà journalisée », 001–003 journalisées, app démarrée, aucun « shutting down » dans les
  sorties de la séquence (journaux du conteneur exclus), aucun KO. `begin_case` accepte `fresh`
  (aucune réinitialisation : la séquence part de l'état laissé par `initdb`, comme le premier
  `deploy.sh` de 8C). Chemins hôte de `docker cp` par `host_path` (Git Bash).

### Livré — vert intempestif (vue du panneau transitoire)

- [web/src/lib/deckConfiguration.ts](../web/src/lib/deckConfiguration.ts) : `statsView` retirée
  d'`EditableDeck`, jamais émise dans `params` ; `stateFromConfiguration` l'ignore.
  `validateParams` (serveur) et le remap d'archive restent permissifs : une configuration ou une
  archive enregistrée avant 9B qui la porte encore est **acceptée en lecture**, la valeur ignorée
  (comme le contexte, qui n'est pas non plus rétabli à l'ouverture). L'export depuis l'accueil
  d'un deck antérieur joint toujours la catégorie qu'une vue héritée référence, pour que
  `parseArchive` ne refuse pas l'archive ([exportDeck.ts](../web/src/lib/exportDeck.ts)).
- [web/src/store/deckStore.ts](../web/src/store/deckStore.ts) : `setStatsView` ne fait que
  changer la vue (ni `markDirty`, ni brouillon, ni recalcul) ; le curseur d'importance reste un
  paramètre enregistré (Q3).
- Tests : [statsView.test.ts](../web/src/store/statsView.test.ts) (3) — « changer de vue ne salit
  pas » (`dirty`, `editRevision`, brouillon, `modelVersion` intacts), vue jamais émise (état et
  requête d'enregistrement), configuration héritée acceptée et vue ignorée.

### Livré — mode Non-engine et profil combinés

- [web/src/lib/nonEngine.ts](../web/src/lib/nonEngine.ts) (pur) : `nonEngineEffect(étiquette
portée, profil courant, profil voulu)` → `poser` / `retirer` ; règle unique partagée par le
  store (ce qui est envoyé) et la grille (ce qui est annoncé).
- Store : `applyNonEngine(carte, étiquette, profil | null)` dans la file globale existante — pas
  conforme : `POST card-categories` si l'étiquette manque, puis `PUT flags` si le profil demandé
  diffère (l'étiquette d'abord : le serveur exige une étiquette avant un profil, Q1 de 5B) ;
  conforme : `DELETE card-categories`, puis `PUT flags { availability: null }` s'il ne reste
  aucune étiquette et que la carte est profilée. Deux requêtes au plus, chacune adoptée après
  acquittement ; un refus arrête la paire et laisse l'état acquitté (`persistenceError`). Les
  annotations du compte ne marquent jamais « non enregistré ». `toggleCardCategory` et
  `setProfile` (mode Profil) sont conservés.
- [ModeBar.tsx](../web/src/components/ModeBar.tsx) : le déroulant « Non-engine » a deux sections —
  « Étiquette à poser » (éléments `menuitem`, ✓ sur l'active) et « Profil posé avec l'étiquette »
  (groupe radio `menuitemradio` : **« Profil inchangé » par défaut**, puis Précoce, Flexible,
  Préparée, Board breaker). Les profils sont des éléments radio pour qu'un profil et une
  étiquette de même nom (« Board breaker ») ne se confondent pas — condition de la fixture e2e
  intacte. Le chip du bouton rappelle le couple (« Handtrap + Précoce »). Le mode Profil est
  conservé tel quel (Q4).
- [AnnotationGrid.tsx](../web/src/components/AnnotationGrid.tsx) et
  [CardTile.tsx](../web/src/components/CardTile.tsx) : chaque tuile porte, en mode Non-engine, un
  badge « poser » (aplat sky) ou « retirer » (fond noir, anneau sky) = effet du prochain clic sur
  cette carte (`data-nonengine-effect`) ; le bandeau annonce le couple et, au survol, « Prochain
  clic : poser / retirer « X » + profil « P » — carte ».
- Tests : [nonEngine.test.ts](../web/src/lib/nonEngine.test.ts) (2),
  [nonengine.test.ts](../web/src/store/nonengine.test.ts) (7 : deux requêtes dans l'ordre, profil
  inchangé, profil différent seul, retrait puis profil orphelin, autre étiquette restante, refus
  qui arrête la paire, deux clics enchaînés dans la file). Scénario e2e
  [`nonengine`](../web/e2e/scenarios/nonengine.mjs) (1440 px) : couple Handtrap + Précoce
  choisi dans le déroulant, chip vérifié, badges attendus sur trois tuiles (nue / profil différent
  / conforme), bandeau au survol, puis **chaque clic vérifié par l'API** `/api/library` (étiquette
  et profil posés sur Combo Gamma, retirés au second clic, profil seul changé sur Handtrap Zeta
  puis restauré, étiquette seule sur Breaker Kappa qui reste sans profil), mode Profil toujours
  présent, bibliothèque identique à la fixture à la fin. Fixture `setup` intacte.

### Preuves

```powershell
npm.cmd run typecheck                      # serveur, web, scripts : 0 erreur
npm.cmd run build                          # avertissement ExcelJS attendu seulement
node scripts/test-quiet.mjs                # 200 tests web (20 fichiers), 8 serveur
# PostgreSQL jetable 55433, puis TEST_DATABASE_URL=… npm run test:integration -w server
#   → persistence 12 tests, purge 10 tests (inchangés)
bash deploy/test-migration-sequence.sh     # cas A–I, 61 gardes (db_ready rendue en 9 s, fenêtre de 6 s exclue)
npm.cmd run e2e -w web                     # setup, guards, compare, mobile, home, conditions, nonengine : OK
bash deploy/rehearsal.sh --fixture         # conforme : séquence code 0 (empreinte cc59821b…, 14 lignes), recalcul 4 / 4 decks,
                                           # 7 scénarios e2e sur la pile migrée, retour arrière (empreinte initiale retrouvée)
```

Conteneurs jetables arrêtés (55433, 55434, 55436, 55440) ; seule la base de dev `ygo-proba-db`
(5433) reste, jamais touchée. Un premier passage complet de l'e2e, lancé **en même temps** que
la mutation de `db_ready` (Docker et CPU saturés), a échoué dans `setup` sur un clic « Terminer »
(« element was detached from the DOM ») ; `setup` seul puis la suite complète rejouée sans charge
concurrente sont conformes — non reproduit, à surveiller.

### Contrôle par mutation

| Mutation                                                     | Garde qui casse                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 `db_ready` à un seul `select 1` (ni healthy, ni journaux) | cas I : « à la sortie de db_ready : init process complete suivi du second ready » (rendue pendant la fenêtre) ; la séquence lancée ensuite a pu passer — la garde déterministe sur les journaux est la preuve, pas le code de la séquence |
| M2 `setStatsView` marque « non enregistré » (`markDirty`)    | `statsView.test.ts` (« changer de vue ne salit pas » : `editRevision` 1, `dirty` true)                                                                                                                                                    |
| M3 `applyNonEngine` envoie le profil avant l'étiquette       | `nonengine.test.ts` (ordre des requêtes ; refus de l'étiquette n'arrête plus la paire) — 2 tests                                                                                                                                          |
| M4 badge « poser / retirer » retiré de la tuile              | e2e `nonengine` (`[data-nonengine-effect]` introuvable sur Combo Gamma, aucun clic joué)                                                                                                                                                  |

Fichiers restaurés par copie après chaque mutation, vérifiés par `diff` (lib.sh par SHA-256) ;
la suite complète a été rejouée ensuite.

### Limites

- `db_ready` lit les journaux de l'image PostgreSQL officielle (marqueurs de son entrypoint) :
  une autre image ou un entrypoint muet la mettrait en échec après 120 s, avec le message qui
  renvoie à `ps` / `logs db` — préférable à une attente satisfaite par le mauvais serveur.
- `run.mjs` des e2e garde sa propre attente (deux `select 1`) : il ne monte aucun script
  d'initialisation, le cas ne s'y présente pas.
- La vue héritée d'un deck antérieur à 9B n'est pas rétablie à l'ouverture (comme le contexte) ;
  elle disparaît des params au premier enregistrement.
- Sur une carte conforme, le retrait de la dernière étiquette retire le profil **même avec
  « profil inchangé »** : un profil sans étiquette ne mesure rien (Q1 de 5B) et resterait
  orphelin. Question ouverte ci-dessous.
- Le badge de tuile est posé au centre bas de l'image ; le point sky (carte dans l'étiquette
  active) et le marqueur ▤ restent à droite.

### Questions ouvertes (non tranchées)

- **Q9** — « Profil inchangé » + carte conforme dont c'est la dernière étiquette : le profil est
  retiré (choix de 9B, cohérent avec Q1 et avec la formulation du plan) ; l'alternative serait de
  le laisser orphelin et signalé « ? ». À confirmer.
- **Q10** — Faut-il rétablir à l'ouverture la vue héritée d'un deck antérieur à 9B (une seule
  fois, jusqu'au premier enregistrement) ? 9B l'ignore, comme le contexte.
- Les questions de 8 restent : Q11 (`ygo_previous`), Q12 / Q13 sans objet, équivalence
  `--emit-sql` / `--apply`.

### Réponses (9B)

- **Q9 — Confirmé.** Un profil sans étiquette ne mesure rien (Q1 de 5B) ; retirer la
  dernière étiquette retire le profil orphelin. Le bandeau l'annonce dans le libellé
  du prochain clic (« retirer l'étiquette et le profil »).
- **Q10 — Confirmé, sans rétablissement.** La vue du panneau est transitoire depuis 9B ;
  un deck s'ouvre sur la vue par défaut. La valeur héritée reste lue sans effet, elle
  disparaît à la prochaine écriture des paramètres.

### Passation vers 9C

- Extra et side éditables (`addCard`, `setCopies`, `removeCard` avec zone ; marquage « non
  enregistré » sans recalcul ; section par zone, « + Ajouter », tuiles de 80 px, stepper de 32 px,
  toast sensible à la zone ; avertissement seulement au-delà de 15, Q5) ; gardes e2e.
- Runbook « déploiement courant » (base non vide, 003 journalisée, aucune question attendue) :
  `deploy.sh` attend désormais la base par `db_ready` ; la consigne manuelle de V4 devient un
  rappel, l'incident reste consigné. Rien n'a été déployé en 9B.
- Clôture de l'étape 9 : docs/PLAN.md, contrat (§6 : scénario `nonengine` à citer si l'on
  inscrit le mode combiné), tag `etape-9-ok`.
- Ne jamais modifier un script de deploy/ pendant qu'un test ou une répétition tourne ; ne pas
  lancer l'e2e en même temps qu'un test A–I (échec non reproduit de `setup` sous charge).

## Compte rendu 9C (9 septembre 2026)

Périmètre validé (plan, point 4 « Extra et side », Q5) : extra et side éditables, variante
« déploiement courant » du runbook, clôture de l'étape 9 et de la mission. Décisions prises en
cours de tâche numérotées D1–D7 (DECISIONS.md, « étape 9, partie C ») ; questions non tranchées
Q14–Q18 ci-dessous.

### Livré — extra et side éditables

- [web/src/store/deckStore.ts](../web/src/store/deckStore.ts) : `addCard(carte, copies, zone)`,
  `setCopies(carte, copies, zone)`, `removeCard(carte, zone)` — zone `main` par défaut, tous les
  appels existants inchangés (D1). `zoneMutation(zone)` : main → `localCalc` (recalcul + « non
  enregistré » + brouillon), extra / side → `markDirty` seul (D2). Le refus 1–3 nomme la zone
  (« déjà 3 copies en side deck », « Quantité 4 refusée en side deck ») ; la même carte peut être
  en main et en side (D3). Le toast porte la carte avec sa zone ; `undoRemove` restaure dans
  cette zone, à la même place.
- [web/src/lib/zones.ts](../web/src/lib/zones.ts) (pur) : `ZONE_LABEL`, `EXTRA_SIDE_SOFT_LIMIT`
  = 15, `overSoftLimit` (jamais le main), `zoneCount`.
- [AddCardDialog.tsx](../web/src/components/AddCardDialog.tsx) : propriété `zone` — titre
  (« Ajouter une carte — side deck », `data-add-zone`), compteur `side : n`, plafond 1–3 lu
  dans la zone, bandeau ambre au-delà de 15 en extra / side (le bandeau « ≥ 60 » du main est
  inchangé) ; ajout par `addCard(carte, 1, zone)`.
- [AnnotationGrid.tsx](../web/src/components/AnnotationGrid.tsx) : section « Extra / Side —
  éditables, exclus des calculs (contrat §2) » **toujours rendue** — même sans main deck (état
  vide) et même vide, sinon aucun ajout n'est possible (D4) — sous le repli existant
  (`extraSideHidden`, commun aux deux zones, D5) ; `ZoneBlock` par zone (`data-zone-block`) :
  en-tête nom + compteur (`data-zone-count`, ambre et mention « au-delà de 15 (repère) » sans
  refus) + « + Ajouter » à 32 px (`data-zone-add`) qui ouvre le dialogue sur la zone ; grille
  `minmax(80px, 1fr)`.
- [ZoneCardTile.tsx](../web/src/components/ZoneCardTile.tsx) : image 59/86 + stepper à 32 px
  (`data-zone-tile`, `data-card-id`), rien d'autre — ni annotation, ni delta, ni menu ⋯ (ces
  zones n'ont ni rôle ni statistique, D6) ; « − » à 1 copie = « Retirer du side (0 copie) ».
- [Toast.tsx](../web/src/components/Toast.tsx) : « Retirée du side deck : X » (`data-removal-zone`),
  libellé du main inchangé.
- **Modèle moteur intact** : [engineModel.ts](../web/src/lib/engineModel.ts) ne lit que `main`
  et n'est pas modifié ; `__ENGINE_VERSION__` est donc inchangé et 9C n'invalide aucun aperçu.
  Le résultat courant reste frais après une mutation extra / side, l'aperçu est joint à
  l'enregistrement (garde Z4).
- Tests : [store/zones.test.ts](../web/src/store/zones.test.ts) (5 : zones distinctes et
  convention par zone, « non enregistré » + brouillon sans recalcul et modèle moteur identique,
  retrait / toast / annulation dans la zone, enregistrement des trois zones, repère 15 sans
  refus) ; **équivalence 6A** ([deckEquivalence.test.ts](../web/src/lib/deckEquivalence.test.ts)) :
  les deux tests existants sont **intacts**, un troisième cas « trois zones » est ajouté —
  création manuelle (extra et side saisis après le main), YDK avec `#extra` / `!side` par le
  chemin réel, JSON v2 relu : mêmes cartes par zone, et modèle moteur strictement égal au modèle
  « main seul » pris avant la saisie de l'extra et du side. **Dit explicitement : le modèle
  moteur ne dépend pas de l'extra ni du side** (`buildEngineModel` ne lit que `main`), donc
  l'équivalence sur les trois zones porte sur la configuration enregistrée, le modèle étant
  invariant par construction.
- Scénario e2e [`extraside`](../web/e2e/scenarios/extraside.mjs) (Deck A) : Z1 bloc side vide,
  « + Ajouter » 32 px, dialogue ouvert sur le side ; Z2 tuile ≥ 80 px, stepper 32 px, compteur,
  Enregistrer activé, grille du main inchangée (15 identités), **aucun recalcul** (durée de
  calcul du panneau inchangée, aucun « Recalcul… ») ; Z3 stepper + / −, retrait à 0 copie, toast
  « Retirée du side deck : Side Rho », « Annuler » restaure dans le side, toujours sans recalcul ;
  Z4 enregistrement vérifié par l'API (side = [Side Rho ×1], main 40, révision +1, **aperçu
  joint** : le résultat est resté frais), rechargement (tuile présente, rien à enregistrer) ; Z5 à
  360 px : stepper et « + Ajouter » 32 px, section sans débordement, body sans défilement ; puis
  fixture restaurée (side vide, main 40, vérifié par l'API). Captures `extraside-1440-ajout`,
  `-toast`, `-recharge`, `extraside-360`.

### Livré — runbook « déploiement courant »

[docs/deploy-runbook.md](deploy-runbook.md) : nouveau titre (« Runbook — déploiement sur le
VPS »), trois variantes nommées, et la variante **« déploiement courant »** en tête (C0–C6) pour
l'état réel de la production (base non vide, 003 journalisée, `9d281cf`, aucune migration :
`git diff --stat 9d281cf..HEAD -- db` vide) — c'est celle à jouer pour déployer l'étape 9 :

- C0 la veille : propreté, tag, diff `db/` vide, `test-migration-sequence.sh` (le cas « F,
  rejeu » est exactement ce déploiement : base non vide, 003 journalisée → code 0, « déjà
  journalisée », empreinte identique), `rehearsal.sh --fixture`, push ; `rehearsal.sh` n'est pas
  prévu pour une archive réelle déjà à 003 (Q17) → `restore.sh --check-only` ;
- C1 code (commit noté = retour du code) ; C2 état des lieux, **effectifs notés** (`users`,
  `decks`, `extra_side`, `summaries` = 0 attendu), `backup.sh` ;
- C3 `deploy.sh` sans option : sortie attendue commande par commande (attente rendue en quelques
  secondes, archive pré-migration réelle, `inventaire : 16 table(s), journal « 001…,002…,003… »`,
  « 003 déjà journalisée : … schéma seulement », `rejeu par stdin : db/schema.sql` **seul**,
  « 003 déjà journalisée : aucun effet, contrôles seulement », contrôles OK|, app démarrée, code
  0) ; **toute question = `NON`** ;
- C4 contrôles : API, journal, effectifs identiques, puis au navigateur les cinq points de
  l'étape 9 (aperçus « … » puis valeurs et persistés, vue transitoire, mode combiné, extra / side,
  enregistrement) ;
- C5 retour arrière à deux niveaux : code seul (`git checkout` + build + up — l'ancienne app lit
  la même base : aucune migration, `summary` ignoré, cartes side relues), données (archive
  pré-migration réelle de C3 par `restore.sh`, pertes explicites) ;
- C6 après coup (rapports, `keep/` à purger à la main).

La variante « départ à vide » (V1–V7) et les §3–§5 sont conservés ; l'ancien préambule
(« décision après 8B ») devient un encart d'historique. deploy/README.md §9 renvoie à la
variante.

### Preuves

```powershell
npm.cmd run typecheck                      # serveur, web, scripts : 0 erreur
npm.cmd run build                          # avertissement ExcelJS attendu seulement
node scripts/test-quiet.mjs                # 206 tests web (21 fichiers), 8 serveur
# PostgreSQL jetable 55433 (deploy/configuration-v2.md), puis TEST_DATABASE_URL=… npm run test:integration -w server
#   → persistence 12 tests, purge 10 tests (inchangés)
npm.cmd run e2e -w web                     # setup, guards, compare, mobile, home, conditions, nonengine, extraside : OK
bash deploy/test-migration-sequence.sh     # cas A–I, 61 gardes (deploy/ intouché en 9C)
bash deploy/rehearsal.sh --fixture         # conforme (séquence, recalcul 4 / 4, 8 scénarios e2e sur la pile migrée, retour arrière)
```

Chaîne jouée **en série** (jamais l'e2e en même temps que A–I ou la répétition). Conteneurs
jetables arrêtés (55433, 55434, 55436, 55440) ; seule la base de dev `ygo-proba-db` (5433)
reste, jamais touchée. Le scénario `extraside` a d'abord été joué seul sur une pile conservée
(`--keep` / `--attach`), avec `guards` et `mobile` (conformes aux quatre largeurs) avant la
suite complète.

### Contrôle par mutation

Fichiers sauvegardés hors dépôt avant chaque mutation, restaurés par copie (ou `git checkout`
pour `engineModel.ts`) et vérifiés par SHA-256 après chacune.

| Mutation                                                                          | Garde qui casse                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 `zoneMutation` recalcule pour toute zone (mutation side → recalcul)            | `zones.test.ts` (« sans recalcul » : `modelVersion` 1 au lieu de 0 ; « Annuler » : 4 au lieu de 2) ; e2e `extraside` Z2 et Z3 (durée 602 ms → 235 ms / 325 ms) |
| M2 `buildEngineModel` lit aussi `side` (une copie side fuit dans le modèle)        | `zones.test.ts` (`deckSize` 7 au lieu de 6) ; équivalence « trois zones » (`deckSize` 14 au lieu de 12, copies 1 au lieu de 3)                                    |
| M3 `AddCardDialog` ignore la zone (`addCard(carte, 1)`)                           | e2e `extraside` avorté en Z2 : tuile Side Rho absente du bloc side (`boundingBox` expiré, ligne 71) — la carte est allée au main, rien n'a été enregistré         |
| M4 `undoRemove` restaure toujours dans le main                                    | `zones.test.ts` (« Annuler restaure la carte dans la même zone »)                                                                                                |
| M5 convention 1–3 lue dans le main au lieu de la zone                             | `zones.test.ts` (« les zones sont distinctes »)                                                                                                                  |
| M6 stepper de la tuile de zone à 28 px (`h-7`)                                    | e2e `extraside` Z2 et Z5 (`h: 28`)                                                                                                                               |

### Limites

- La garde « aucun recalcul » de l'e2e s'appuie sur la durée de calcul affichée par le panneau
  et sur l'absence de « Recalcul… » pendant 400 ms ; le test store (`modelVersion` inchangé)
  est la garde exacte, l'e2e la garde d'intégration.
- Les tuiles d'extra et de side n'ouvrent ni détail de carte ni menu : seul le stepper est
  offert (D6, Q15).
- L'Inventaire affiche toujours « Extra n » / « Side n » sans ambre au-delà de 15 (Q14).
- Le repère 15 n'a pas de garde navigateur (seize ajouts réels par le dialogue) : il est gardé
  par `zones.test.ts` (`overSoftLimit`) et par la composante pure ; l'affichage ambre du bloc et
  du dialogue a été vérifié à la main dans le code, pas par capture.
- La variante « déploiement courant » du runbook a été **écrite, pas jouée** sur le VPS ; sa
  preuve locale est le cas « F, rejeu » de test-migration-sequence.sh et `rehearsal.sh
  --fixture` (séquence complète depuis pré-001). Les effectifs attendus (`16 table(s)`, `0
  résumé(s)`) viennent de 8C et du code de 9A ; les valeurs réelles seront celles notées en C2.

### Questions ouvertes (non tranchées)

- **Q14** — Faut-il passer les puces « Extra n » / « Side n » de l'Inventaire en ambre au-delà
  de 15, comme le bloc de la grille ? 9C ne touche pas l'Inventaire.
- **Q15** — Les tuiles d'extra et de side doivent-elles offrir « Détails de la carte » (menu ⋯
  ou clic sur l'image) ? 9C ne donne que le stepper (aucune annotation possible).
- **Q16** — Le repli « Extra / Side » reste commun aux deux zones (état `extraSideHidden`
  existant) ; un repli par zone est-il souhaité ?
- **Q17** — `rehearsal.sh` sur une archive réelle déjà à 003 : le contrôle de recalcul attend
  l'ancien modèle dans `ygo_old` ; faut-il un mode « sans recalcul » (séquence + e2e + retour
  arrière seulement) pour répéter un déploiement courant sur le dump du cron ?
- **Q18** — `keep/` reçoit une archive pré-migration (≈ 1,5 Mo) à chaque `deploy.sh`, hors
  rétention : purge manuelle (C6) ou rétention dédiée ?
- Les questions de 9B restent : Q9 et Q10 confirmées (« Réponses (9B) ») ; celles de 8 : Q11
  (`ygo_previous`), Q12 / Q13 sans objet, équivalence `--emit-sql` / `--apply`.

## Clôture de l'étape 9 — compte rendu final de la mission (9 septembre 2026)

- **Étape 9 terminée** : 9A (aperçus sans cache faisant autorité, finitions de 7B), 9B (attente
  de la DB par `db_ready`, vue transitoire, mode Non-engine combiné), 9C (extra / side
  éditables, runbook « déploiement courant », clôture). Tags `etape-9a-ok`, `etape-9b-ok`,
  `etape-9-ok` ; rien poussé.
- **Mission de fiabilisation (9 étapes, 7–9 septembre 2026)** : contrat métier et cas de
  référence à oracle indépendant (1) ; corrections des calculs défectueux (2) ; configuration v2
  par deck, transaction unique, révision (3) ; recalcul versionné, annulation, état périmé (4) ;
  contexte unique premier / second, profils, plafonds partagés, conditions ET/OU (5) ; création /
  import équivalents, validation navigateur et mobile (6) ; comparateur et Excel à données
  identiques, gardes visuelles versionnées (7) ; migrations 001–003, purge exacte, sauvegarde
  vérifiée, restauration, répétition, déploiement 8C sur le VPS (8) ; finitions et reports (9).
  État final : 206 tests web, 8 serveur, 12 + 10 PostgreSQL, 8 scénarios e2e, 61 gardes A–I,
  répétition conforme ; moteur et oracles jamais modifiés pour faire passer un test ; valeurs de
  contrôle historiques intactes.
- **Production** : `9d281cf` (8C) sur base v2 purgée. Le déploiement de l'étape 9 se joue par la
  variante « déploiement courant » (runbook C0–C6) après le push des commits et des tags — c'est
  la prochaine action, à la main de l'utilisateur.
- **Reports hors mission** : Q9–Q18 ci-dessus, Q11 (`ygo_previous`), équivalence `--emit-sql` /
  `--apply` de prune-stale-cards, healthcheck Compose (Q6), catégorie / profil à réexaminer
  (modèle jugé redondant, hors étape 9).
