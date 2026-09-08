# Étape 7 — comparateur et exports

Résultat attendu (docs/PLAN.md) : matrices côte à côte sur mobile, deltas non arrondis,
données identiques entre analyse, Excel et comparateur. Cible : [contrat métier](regles-metier.md)
§5 « Comparateur » et §6 « Largeurs et cibles tactiles ». L'étape 6 (tag `etape-6-ok`) est
acceptée ; ses largeurs et cibles s'appliquent ici. L'étape est découpée en deux sessions :

- **7A, livrée le 8 septembre 2026** (tag `etape-7a-ok`) : points 1, 2 et 4 ci-dessous
  (identité des données, deltas et cellules non arrondis, gardes visuelles versionnées).
- **7B, à lancer dans une nouvelle session à partir de ce document** : point 3 (validation
  responsive du comparateur et du mur de mains depuis `web/e2e/`), corrections
  responsives, mise à jour de regles-metier.md §5 / §6 et design-system.md §6.3.

Aucun changement au moteur (`web/src/engine/`, `compare.ts` compris), aux oracles, aux
migrations ni à deploy/ ; aucun test existant modifié ; aucune base personnelle, aucun VPS.

## Plan validé (7 septembre 2026)

### Constats de départ

- Trois consommateurs, une seule matrice : le panneau (`CrossMatrix`), le comparateur et
  l'Excel passent tous par `toComparisonMatrix` sur un `PassResult`. L'éditeur calcule en
  mode `full` (`computeAll`), le comparateur en mode `passes` (`computePass` × 2) :
  identité attendue, jamais prouvée sur un vrai deck. L'Excel écrit les cellules en valeur
  exacte et le reste en formules sans résultat mis en cache : ExcelJS ne les évalue pas,
  l'identité des agrégats Excel n'avait donc jamais été testée.
- L'assemblage du comparateur (`buildEngineModel` → calcul → `toComparisonMatrix` +
  `scenarioCounts`, avertissement Q5) vivait dans le `useEffect` de `ComparePage` ; les
  seaux du panneau (`toBuckets`, `resolveView`) étaient privés dans `StatsPanel.tsx`.
- Contrat §5 : matrices A/B côte à côte « y compris sur mobile ». `ScenarioSection` est un
  `flex-wrap` de trois cartes d'environ 300 px : à 360 px, A, B et Δ s'empilent (à
  confirmer à l'écran en 7B).

### Point 1 — identité des données

Test `web/src/lib/dataIdentity.test.ts` : deck fixe de 40 cartes (starters, paire,
condition ET/OU, HOPT, quatre profils, **plafond partagé** à 1 par tour sur deux
handtraps, **carte étiquetée sans profil**, cartes mortes en premier / second, filler) et
variante B ; trois chemins réels par contexte ; assertions strictes (`===`) là où le code
est le même, 1e-12 là où l'ordre de sommation diffère ; évaluateur de formules Excel dans
le test pour recalculer totaux, bloc delta et Synthèse.

### Point 2 — inventaire des deltas (moteur exclu)

| #   | Endroit                                                          | Constat                                                                                                                                                                                                                                                         | Décision                                                                                                                                                      |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `ComparePage` `DeltaCell` (synthèse)                             | Seuil `negligible` (0,05 pt ou 0,005 carte) : un delta non nul affiché « · », coloré neutre. L'Excel (`+0.0%;-0.0%;"·"`) réserve « · » au zéro exact et colore par signe ; spec §5 : « · pour zéro exact » ; contrat §5 : un symbole ne doit pas signifier zéro | **Corrigé** (Q1) : « · » seulement si `d === 0`, sinon signe + une décimale (« +0.0 » possible), couleur mérite par signe ; infobulle inchangée (2 décimales) |
| D2  | `DeltaCard` cellule                                              | `d === 0` exact, arrondi au rendu                                                                                                                                                                                                                               | Conforme, formateur partagé                                                                                                                                   |
| D3  | `engine/compare.ts` `EQ_TOL` 1e-9 (`identical`, `margins_equal`) | Tolérance de comparaison flottante, pas un arrondi ; contrat « à la tolérance numérique près »                                                                                                                                                                  | Aucune (couche moteur)                                                                                                                                        |
| D4  | `CardTile` delta marginal                                        | `> 1e-9` puis `signedPct` au rendu                                                                                                                                                                                                                              | Conforme                                                                                                                                                      |
| D5  | `exportComparison.ts`                                            | Données en valeur exacte, deltas et agrégats en formules                                                                                                                                                                                                        | Conforme, prouvé par le point 1                                                                                                                               |
| D6  | `compare.test.ts` fixture §11 normalisée ±0,3 pt                 | Test historique, pas du code                                                                                                                                                                                                                                    | Aucune                                                                                                                                                        |
| D7  | Cellules de matrice (`ComparePage`, `StatsPanel`)                | « · » sous 0,05 % alors que l'Excel affiche « 0.0% » ; hors delta                                                                                                                                                                                               | **Corrigé** (Q2) : « 0.0 », « · » réservé au zéro exact, même formateur                                                                                       |

Aucun delta n'était calculé depuis une valeur arrondie : les seuls écarts étaient D1
(seuil avant la décision de symbole et de couleur) et D7 (symbole de zéro pour une
probabilité non nulle).

### Point 3 — validation navigateur (7B)

Depuis `web/e2e/` (scénarios à ajouter), à 360 / 390 / 768 et 1440 px, verdict par point,
correction uniquement si cassé :

1. Comparateur, en-tête : débordement horizontal, retour à la ligne, « Exporter Excel »
   et « ⇄ Inverser » atteignables.
2. Dialogue « Comparer deux decks » : sélecteurs, ✕, bouton Comparer.
3. Matrices A et B **côte à côte** sur la même ligne, échelle de couleur commune, ligne
   S / N, Δ avec légende, sans débordement du body.
4. Table de synthèse : défilement confiné à son conteneur ; D1 visible à l'écran.
5. Bandeau d'avertissements (Q5, tailles de deck).
6. Export Excel réel comparé aux infobulles (déjà en place à 1440 dans `compare.mjs`).
7. Mur de mains, premier et second (6 cartes + « 6ᵉ ») : barre de contrôle, largeur d'une
   ligne de main, cibles (Nouvelles mains, contexte, n, filtre, tri), état périmé.
8. Bureau 1440 : non-régression du comparateur après toute modification CSS.

Correction prévue si l'empilement est confirmé (Q3) : sous 640 px, cellules compactes
pour que A et B tiennent ensemble dans 320 px utiles, Δ en dessous en pleine largeur ;
repli : bande `flex-nowrap` à défilement confiné seulement si illisible sur la capture à
360 px, décision consignée.

### Point 4 — gardes visuelles versionnées

Option A retenue : `web/e2e/` avec `playwright-core` en devDependency de `web`, commande
`npm run e2e -w web` séparée (hors `npm test`, hors `test-quiet.mjs`), pile jetable
montée et démontée par `run.mjs`, portage des gardes M1–M6 et de la préparation des decks
(fixture commune), premier scénario comparateur ; scénarios de l'étape 7 en 7B ; les
captures « conforme » de 6B ne deviennent pas des gardes.

### Réponses aux questions ouvertes (validation du 7 septembre 2026)

- **Q1** : alignement sur l'Excel — « · » uniquement pour le zéro exact, « +0.0 » accepté,
  couleur par signe. Appliqué en 7A.
- **Q2** : aligner aussi les cellules de matrice : une cellule sous 0,05 % affiche « 0.0 »
  comme l'Excel, « · » réservé au zéro exact ; même formateur partagé par les cellules et
  les deltas ; infobulle à la valeur fine conservée. Appliqué en 7A.
- **Q3** : cellules compactes sous 640 px ; lisibilité à vérifier en 7B sur capture à
  360 px ; repli bande à défilement confiné seulement si illisible, décision consignée.
- **Q4** : règle 6B (32 px) sur Exporter Excel, Comparer, ✕ du dialogue et ⇄ Inverser.
  À appliquer en 7B avec les mesures.
- **Q5** : option A ; portage de M1–M6 et de la préparation des decks ; procédure dans
  AGENTS.md avec le prérequis Docker ; `npm run e2e` reste hors test-quiet.mjs.
- **Q6** : `engine/compare.ts` fait partie du moteur (intouché) ; l'assemblage va dans
  `web/src/lib/`.
- Ajout demandé au contrôle par mutation de 7A : une erreur volontaire dans une formule de
  delta Excel, détectée par l'évaluateur du test.

## Compte rendu 7A (8 septembre 2026)

### Livré

- **Extractions pures, sans changement de comportement** :
  [statsViews.ts](../web/src/lib/statsViews.ts) (`toBuckets`, `cumulativeOf`,
  `meanFromDist`, `resolveView`, utilisés par `StatsPanel`) et
  [comparison.ts](../web/src/lib/comparison.ts) (`comparisonDeckOf`, `unprofiledWarning`,
  utilisés par `ComparePage`). Le test d'identité suit exactement ce que l'écran affiche
  au lieu de réécrire les formules.
- **Formateurs partagés** ([fmt.ts](../web/src/lib/fmt.ts)) : `matrixCell`, `deltaPoints`,
  `deltaCount`, mêmes règles que les formats de nombre de l'Excel ; « · » = zéro exact ;
  utilisés par la matrice du panneau, les matrices A / B, la matrice Δ et la synthèse du
  comparateur. `DeltaCell` colore par le signe du delta exact (mérite selon la direction),
  neutre seulement pour le zéro exact.
- **Test d'identité** ([dataIdentity.test.ts](../web/src/lib/dataIdentity.test.ts), 7 tests) :
  matrice du panneau = matrice du comparateur = cellules Excel (`===`, modes `full` et
  `passes` confondus) ; agrégats = seaux et cumulés du panneau, brick = P(S=0), zone jouable
  et main forte recalculées depuis les issues pondérées, moyennes planchers = Σ min(i,3)·P
  et Σ min(j,5)·P, ≤ E[S] / E[U] ; deltas = B − A exacts (cellules et agrégats) ; formules
  Excel recalculées (totaux à 1 ± 1e-9, bloc delta strictement égal, Synthèse à 1e-12,
  libellés) ; carte sans profil listée à l'identique dans `resultContext` et dans
  l'avertissement du comparateur, comptée dans N, contribution nulle (retirer son étiquette
  ne change ni U ni la matrice, mais change les copies brutes) ; plafond partagé effectif
  (E[U] plus petit, matrice différente, et c'est bien elle qui part dans le comparateur).
- **Test des formateurs** ([fmt.test.ts](../web/src/lib/fmt.test.ts), 6 tests).
- **Gardes visuelles versionnées** ([web/e2e/](../web/e2e/)) : `run.mjs` (pile jetable :
  conteneur `testhand-e2e-db` sur 55434, schéma et migrations 001 / 002 par stdin, 17
  cartes synthétiques en `data:`, serveur 8790, Vite 5174, compte `e2e@example.test` par
  `POST /api/auth/register` avec `INVITE_CODES`, processus détachés journalisés dans
  `out/`, démontage ; options `--only`, `--keep`, `--attach`, `--down`), `lib.mjs`,
  `fixtures/cards.mjs`, scénarios `setup` (Deck A et Deck B annotés par les gestes de
  l'interface, dont plafond « Mulcharmy » à 1/tour et Breaker Kappa sans profil, contrôle
  de la fixture par l'API), `guards` (M1–M6 de 6B à 360 et 1440 px, worker ralenti par
  réécriture du script servi) et `compare` (page chargée, trois sections, avertissement Q5
  par deck, 24 cellules par matrice, export Excel réel téléchargé, relu par ExcelJS et
  comparé nombre à nombre aux infobulles de l'écran pour A, B et Δ des deux onglets).
  `playwright-core` 1.55 en devDependency de `web` ; navigateur = Chrome installé
  (`channel: 'chrome'`) ou `E2E_BROWSER`. Procédure dans AGENTS.md.

### Preuves

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/test-quiet.mjs
# PostgreSQL jetable (deploy/configuration-v2.md), depuis PowerShell
$env:TEST_DATABASE_URL = 'postgres://step23:step23-disposable@127.0.0.1:55433/step23'
npm.cmd run test:integration -w server
npm.cmd run e2e -w web
```

Résultats : **177 tests web** (15 fichiers ; état de départ 164), **7 tests serveur**,
**11 tests PostgreSQL** (inchangés, rejoués) ; build vert avec l'avertissement ExcelJS
attendu ; `npm run e2e` : `setup` 16 s, `guards` 18 s, `compare` 4 s, 13 captures ;
conteneurs `testhand-e2e-db` (55434) et `testhand-step23-tests` (55433) arrêtés et
supprimés, ports 5174 / 8790 / 55433 / 55434 libres.

Contrôle par mutation, chaque erreur volontaire détectée par une garde puis fichier
restauré et comparé par empreinte SHA-256 à l'original :

| Mutation                                                                | Garde qui échoue                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| X1 `exportComparison.ts` : cellules écrites `Number(v.toFixed(4))`      | `dataIdentity` (cellules Excel ≠ matrice, 2 tests)                       |
| X2 `comparison.ts` : passe second donnée au scénario premier            | `dataIdentity`                                                           |
| X3 `exportComparison.ts` : plage fausse de `starters_ge2` (`$H$7:$H$9`) | `dataIdentity` (Synthèse recalculée)                                     |
| X4 `exportComparison.ts` : **formule de delta inversée** (`=B6-B14`)    | `dataIdentity` (bloc delta évalué)                                       |
| X5 `fmt.ts` : seuil 0,05 pt réintroduit dans `deltaPoints`              | `fmt.test.ts`                                                            |
| X6 `comparison.ts` : avertissement Q5 jamais produit                    | `dataIdentity`                                                           |
| X7 `CardTile.tsx` : stepper `h-5 w-5`                                   | `npm run e2e -- --only guards` (M1 : 20×20 à 360 px)                     |
| X8 `ComparePage.tsx` : infobulle à 1 décimale                           | `npm run e2e -- --only compare` (écran ≠ classeur, 24 écarts par onglet) |

### Limites et reports vers 7B

- Point 3 non commencé, hormis le scénario `compare` à 1440 px qui prouve la chaîne
  page → export → relecture. Les verdicts 360 / 390 / 768 (comparateur et mur de mains),
  Q3 (cellules compactes), Q4 (cibles 32 px du comparateur) et les mises à jour de
  regles-metier.md §5 / §6 et design-system.md §6.3 relèvent de 7B.
- Contrat §5 : la règle « · = zéro exact, une faible valeur s'affiche 0.0 » est appliquée
  et consignée dans AGENTS.md ; à inscrire au §5 du contrat en 7B avec les largeurs du
  comparateur.
- `npm run e2e` n'est pas lancé par `npm test` ni par `test-quiet.mjs` (Docker et Chrome
  requis) ; aucune intégration continue dans le dépôt.
- Le navigateur journalise toujours un 404 sur `/favicon.ico` en dev (hors périmètre).
- `web/e2e/out/` (captures, classeur exporté, journaux, `stack.json`) est ignoré par git.

### Passation vers 7B

Lire ce document, docs/PLAN.md, docs/regles-metier.md §5 « Comparateur » et §6, puis
docs/design-system.md §6.3. Monter la pile avec `npm run e2e -w web -- --keep`, ajouter les
scénarios `mobile` (mesures et gardes du point 3 à 360 / 390 / 768 pour le comparateur et
le mur de mains, captures) dans `web/e2e/scenarios/` et les inscrire dans `ALL_SCENARIOS`
de `run.mjs`, itérer avec `-- --attach --only …`, démonter avec `-- --down`. Corriger
uniquement ce qui est cassé (Q3 : cellules compactes sous 640 px, verdict de lisibilité sur
capture ; Q4 : cibles 32 px), rejouer `npm run e2e` complet, puis contrôle par mutation
(gardes e2e), commit, tag `etape-7-ok`, PLAN.md, section « étape 7, partie B » dans
DECISIONS.md et decisions-compressees.md.

## Compte rendu 7B (8 septembre 2026)

Le plan du point 3 est resté cohérent après 7A : le point 6 (export Excel comparé aux
infobulles) était déjà couvert à 1440 px par `compare.mjs` ; le scénario `mobile` ajoute
seulement le téléchargement réel aux quatre largeurs. Aucune incohérence à signaler.

### Scénario `mobile` ([web/e2e/scenarios/mobile.mjs](../web/e2e/scenarios/mobile.mjs))

Inscrit dans `ALL_SCENARIOS` de `run.mjs`, joué après `compare` (62 s). Pour chaque largeur
360 / 390 / 768 (tactile, DPR 2) et 1440 px (non-régression) : accueil → dialogue
« Comparer deux decks » (P2) → page du comparateur (P1 en-tête, P5 avertissements, P3
matrices, P4 synthèse, P6 export réel, P8 bureau) → éditeur de Deck A, onglet « Mur de
mains » avec le worker ralenti à 4 s par réécriture du script servi (P7 premier, second
avec « 6ᵉ », état périmé après une copie de plus dans l'onglet Annoter). Toutes les
gardes d'une largeur sont évaluées avant l'échec global ; l'export est non bloquant (un
téléchargement impossible est une garde en échec, pas une exception qui masquerait le
reste) ; un tableau **verdict par point et par largeur** est imprimé en fin de scénario.
Captures : `mobile-{largeur}-{dialogue, comparateur (pleine page), matrices (section
« Premier »), mains-premier, mains-second, mains-perime}` (24) et
`mobile-{largeur}-export.xlsx` (4).

### Point 3 — verdicts avant correction (premier passage, captures relues)

| Point             | 360                                                                                                                                                                                                                                                 | 390                                               | 768                                                         | 1440                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| P1 en-tête        | **cassé** : aucun débordement, mais « ← Mes decks », « ⇄ Inverser A/B » et « Exporter Excel » coupés sur 2 à 3 lignes, noms A / B tronqués à « A. … » (les gardes de départ ne le voyaient pas ; renforcées : libellés sur une ligne, noms ≥ 40 px) | idem                                              | **cassé** (Q4) : Inverser 100 × 30, Exporter 101 × 28       | idem                               |
| P2 dialogue       | **cassé** (Q4) : ✕ 13 × 24 ; sélecteurs et Comparer (32 px) conformes                                                                                                                                                                               | idem                                              | idem                                                        | idem                               |
| P3 matrices       | **cassé** : A (296 px) et B empilés, Δ 278 px                                                                                                                                                                                                       | idem                                              | conforme : A et B côte à côte, Δ seul sur la ligne suivante | conforme : A, B et Δ sur une ligne |
| P4 synthèse       | conforme (défilement confiné, D1 visible : « +6.4 », « −6.4 », « · » réservé au zéro exact)                                                                                                                                                         | conforme                                          | conforme                                                    | conforme                           |
| P5 avertissements | conforme (2 × Q5, retour à la ligne)                                                                                                                                                                                                                | conforme                                          | conforme                                                    | conforme                           |
| P6 export         | conforme (classeur réel téléchargé)                                                                                                                                                                                                                 | conforme                                          | conforme                                                    | conforme                           |
| P7 mur de mains   | **cassé** : en second, cartes écrasées à 28 × 68 px (ratio 0,41 au lieu de 59/86 = 0,686), en premier 36 × 68 ; barre de contrôle, cibles ≥ 24 px, « 6ᵉ », état périmé conformes                                                                    | **cassé** : 33 × 68 en second, 41 × 68 en premier | conforme                                                    | conforme                           |
| P8 bureau         | —                                                                                                                                                                                                                                                   | —                                                 | —                                                           | conforme                           |

La première version de la garde P4 comptait 11 deltas sur 24 : elle ignorait le signe
« − » (U+2212) émis par `fmt.ts`. Défaut de garde, pas d'écran ; corrigée (lecture des
colonnes 4 et 7 de chaque ligne).

### Corrections (CSS et structure JSX seulement, moteur et `compare.ts` intacts)

- **En-tête du comparateur** ([ComparePage.tsx](../web/src/components/ComparePage.tsx)) :
  `flex-wrap` avec `gap-x-3 gap-y-2`, libellés `whitespace-nowrap`, noms A / B en
  `flex-1 basis-0 truncate` (ils prennent la place restante de la première ligne, les
  actions passent à la ligne sous 400 px), ⇄ Inverser et Exporter Excel en `py-2` (32 px,
  Q4). Même convention que l'accueil en 6B.
- **Dialogue** : ✕ en `h-8 w-8` avec `title="Fermer"` (même recette que l'aperçu d'import).
- **Matrices (Q3)** : sous 640 px, `grid grid-cols-2 gap-2` pour A et B, Δ en `col-span-2`
  (pleine largeur, légende sous la matrice) ; à partir de 640 px, `flex flex-wrap gap-4`
  inchangé. Cellules compactes sous 640 px : police 9 px, `border-spacing` 1 px,
  `px-px py-1`, **20 px minimum par colonne** (sans ce minimum, une colonne ne contenant
  que « · » s'écrasait et ses en-têtes « 4 » et « 5 » se touchaient), en-tête de coin
  « S\U » (« ↓S \ U→ » dès 640 px) ; conteneur `p-2` et cartes `p-1.5` sous 640 px.
  Mesures à 360 px : cartes de 168 px, tableau de 145,5 px, cellules 20 × 22 px, marge
  ≥ 3 px dans la carte (garde), aucun défilement interne.
- **Mur de mains** ([HandWall.tsx](../web/src/components/HandWall.tsx)) : la bande de
  cartes est `shrink-0` (jamais déformée) et la ligne de main est `flex-wrap` : sous
  640 px, le récapitulatif départs / non-engine / note passe à la ligne, aligné à droite,
  au lieu d'écraser les cartes (charte §6.3, « passer à la ligne au lieu de déborder ou
  d'écraser »). À 768 px et plus, une seule ligne comme avant.

### Verdict Q3 sur capture

`mobile-360-matrices.png` (720 px physiques, DPR 2) : A et B côte à côte, chaque cellule
lisible (« 16.9 », « 20.9 », « 0.1 », « · » distincts), échelle de couleur commune
conservée, ligne S / N sur deux lignes sous chaque matrice, Δ en dessous en pleine largeur
avec sa légende. Le repli « bande à défilement confiné » n'a pas été nécessaire.
`mobile-390-matrices.png` identique avec 15 px de plus par carte.

### Gardes ajoutées (transformation des corrections)

Toutes dans `mobile.mjs`, évaluées aux quatre largeurs sauf mention :

| Garde                                                                                                                                                                                                                                                                                                                                                                                        | Correction protégée                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| en-tête sans débordement, body sans défilement horizontal, ⇄ Inverser et Exporter Excel dans le viewport, ≥ 32 px et ≤ 36 px (une ligne), « ← Mes decks » ≤ 20 px, noms A / B ≥ 40 px                                                                                                                                                                                                        | en-tête `flex-wrap`, `py-2`, `basis-0`                         |
| dialogue dans le viewport, ✕ (`title="Fermer"`) ≥ 32 px, Comparer ≥ 32 px, sélecteurs ≥ 24 px, ⇄ Comparer de l'accueil ≥ 32 px                                                                                                                                                                                                                                                               | ✕ `h-8 w-8`                                                    |
| A et B sur la même ligne (même `y`, B à droite de A), dans le viewport ; matrice entière (aucun défilement interne) ; 24 cellules ; police ≥ 9 px, hauteur ≥ 14 px, aucune coupée ; colonnes ≥ 18 px ; marge ≥ 3 px dans la carte (< 640) ; ligne S / N ; Δ avec légende, dans le viewport, sous A / B en pleine largeur (< 640) ; A, B, Δ sur une ligne (≥ 1024)                            | grille 2 colonnes, cellules compactes, `min-w-5`, `col-span-2` |
| synthèse dans le viewport, `overflow-x: auto` sans défilement du body, 24 deltas, « · » ⇔ infobulle « 0.00 pt » / « 0.000 », au moins un delta non nul                                                                                                                                                                                                                                       | D1 (7A)                                                        |
| 2 avertissements « sans profil », chacun dans le viewport sans débordement                                                                                                                                                                                                                                                                                                                   | —                                                              |
| export Excel réel > 1 ko                                                                                                                                                                                                                                                                                                                                                                     | —                                                              |
| barre de contrôle sans débordement ; Nouvelles mains, contexte, n, filtre, tri ≥ 24 px ; ligne de main dans le viewport sans débordement ; 5 puis 6 cartes, entières, ratio 59/86 à ± 0,03, ≥ 40 px de large ; récapitulatif dans le viewport ; badge « 6ᵉ » et mention « sixième carte = pioche » ; état périmé annoncé (« Recalcul… notes de la version précédente »), mains à 0,45 puis 1 | `shrink-0`, `flex-wrap`                                        |

### Preuves

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/test-quiet.mjs
npm.cmd run e2e -w web
```

```bash
# Git Bash : suite PostgreSQL jetable 55433 sans réécriture MSYS du chemin tmpfs
export MSYS_NO_PATHCONV=1
docker run --name testhand-step23-tests --label purpose=testhand-step23 --rm --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=step23 -e POSTGRES_PASSWORD=step23-disposable -e POSTGRES_DB=step23 -p 127.0.0.1:55433:5432 -d postgres:17-alpine
TEST_DATABASE_URL='postgres://step23:step23-disposable@127.0.0.1:55433/step23' npm run test:integration -w server
docker stop testhand-step23-tests
```

Résultats : **177 tests web**, **7 serveur**, **11 PostgreSQL** (inchangés : aucun test
existant modifié, `guards.mjs` et `compare.mjs` intacts) ; build vert avec l'avertissement
ExcelJS attendu ; `npm run e2e` complet : `setup`, `guards`, `compare`, `mobile`, verdict
« conforme » sur les huit points aux quatre largeurs, 35 captures et 5 classeurs dans
`web/e2e/out/`. Conteneurs `testhand-e2e-db` et `testhand-step23-tests` arrêtés et
supprimés, serveur et Vite détachés arrêtés, ports 5174 / 8790 / 55433 / 55434 libres.

Contrôle par mutation sur la pile conservée (`--attach --only mobile`), fichier restauré
depuis une copie et vérifié par empreinte SHA-256 après chaque essai :

| Mutation                                                          | Garde qui échoue                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| X1 `ComparePage.tsx` : en-tête sans `flex-wrap`                   | 360 / 390 : en-tête déborde (417 px), noms A / B à 0 px, export impossible (clic hors viewport) |
| X2 `ComparePage.tsx` : cellules `text-[8px]`                      | 360 / 390 : police 8 < 9 px (A, B, premier et second)                                           |
| X3 `ComparePage.tsx` : `grid-cols-1`                              | 360 / 390 : A et B empilés, matrice tronquée (défilement interne), marge négative               |
| X4 `ComparePage.tsx` : ✕ `h-6 w-6`                                | quatre largeurs : ✕ 24 × 24                                                                     |
| X5 `HandWall.tsx` : bande sans `shrink-0`, ligne sans `flex-wrap` | 360 / 390 : cartes 28–41 × 68 px, ratio faux                                                    |
| X6 `ComparePage.tsx` : Exporter Excel `py-1.5`                    | quatre largeurs : 101 × 28                                                                      |
| X7 `ComparePage.tsx` : `min-w-5` retiré                           | 360 / 390 : colonnes de 14 px (en-têtes collés)                                                 |

### Limites

- Les gardes mesurent le rendu de Chrome avec la police système de Windows (Segoe UI) :
  sur Android / iOS les chiffres sont un peu plus larges, d'où la marge exigée (≥ 3 px,
  8,5 px mesurés) et le minimum de 20 px par colonne qui absorbe la variation.
- Sous 640 px, la ligne de main passe de 80 à 124 px de haut (récapitulatif à la ligne) :
  cinq mains visibles à 360 × 740 au lieu de huit. Alternative non retenue : un
  récapitulatif vertical compact (« S 3 / U 1 ») aurait gardé la densité au prix des
  libellés — question ouverte ci-dessous.
- La matrice Δ garde les cellules compactes de 9 px sous 640 px bien qu'elle dispose de
  toute la largeur (cohérence avec A et B ; un rendu à 10 px y serait possible).
- Le 404 `/favicon.ico` en dev subsiste (hors périmètre).

### Questions ouvertes (non tranchées)

1. Densité du mur sous 640 px : conserver le récapitulatif à la ligne (libellés complets,
   cartes intactes) ou le compacter à droite des cartes (« S 3 · U 1 » + note) ?
2. « ↻ Nouvelles mains » mesure 24 px (conforme au contrat §6, « ailleurs ») ; le
   promouvoir en action primaire de 32 px comme Enregistrer ?
3. Reports 6B listés sous 7B mais hors du point 3 : densité de la grille d'annotation sur
   bureau (9 colonnes à 1440 px) et mise en page d'un arbre ET/OU plus profond que « ET de
   clauses, OU de feuilles » — non traités, à replacer (étape 8 ou hors étape).
4. Δ sous 640 px en cellules de 10 px (taille bureau) plutôt que compactes ?

### Réponses

Aucune des quatre questions ne relève de l'étape 8. Elles sont regroupées dans une
étape 9 « Finitions interface », après le déploiement, avec la décision déjà prise pour
chacune afin que la session 9 n'ait qu'à implémenter.

1. **Compacter.** Récapitulatif « S 3 · U 1 » (+ note) à droite des cartes sous 640 px.
   Le mur sert à balayer beaucoup de mains ; 124 px par main, c'est cinq mains par écran
   contre huit. Cartes jamais déformées, conformément à 7B.
2. **Promouvoir à 32 px.** « ↻ Nouvelles mains » est l'action primaire du mur, même règle
   qu'Enregistrer (6B).
3. **Étape 9.** Densité de la grille à 1440 px : réduire la tuile si une disposition
   conserve trois cibles de 32 px, sinon garder 96 px et clore. Arbre ET/OU profond :
   mise en page validée au navigateur, corrigée seulement si cassée.
4. **Oui.** Δ en cellules de 10 px sous 640 px puisqu'il est en pleine largeur.
