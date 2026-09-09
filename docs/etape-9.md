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
  est explicitée dans ce document lors de 9B. Le mode Profil seul est conservé (Q4).
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

| Mutation                                                                          | Garde qui casse                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| M1 `usableSummary` ignore la version du moteur                                    | `summary.test.ts` (« refuse … d'une autre version »)                |
| M2 `summaryOfState` accepte un résultat périmé ou en cours                        | `summary.test.ts` (« n'envoie rien d'un résultat périmé … »)        |
| M3 `checkSummaryMatches` sans effet (serveur)                                     | `configuration.test.ts` (« Missing expected exception »)            |
| M4 « ↻ Nouvelles mains » en `py-1` (24 px)                                        | `mobile` P7 aux quatre largeurs (`h: 24`)                           |
| M5 récapitulatif compact masqué (récapitulatif complet sous 640 px)               | `mobile` P7 à 360 / 390 (compact absent, ligne 344 > 341, débordement) |
| M6 Δ en cellules compactes                                                        | `mobile` P3 à 360 / 390 (police 9, largeur 20)                      |
| M7 sélecteurs ET/OU sans `h-6` (23 px)                                            | `conditions` (9 sélecteurs à 23 px)                                 |

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
