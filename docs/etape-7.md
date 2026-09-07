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

| # | Endroit | Constat | Décision |
| --- | --- | --- | --- |
| D1 | `ComparePage` `DeltaCell` (synthèse) | Seuil `negligible` (0,05 pt ou 0,005 carte) : un delta non nul affiché « · », coloré neutre. L'Excel (`+0.0%;-0.0%;"·"`) réserve « · » au zéro exact et colore par signe ; spec §5 : « · pour zéro exact » ; contrat §5 : un symbole ne doit pas signifier zéro | **Corrigé** (Q1) : « · » seulement si `d === 0`, sinon signe + une décimale (« +0.0 » possible), couleur mérite par signe ; infobulle inchangée (2 décimales) |
| D2 | `DeltaCard` cellule | `d === 0` exact, arrondi au rendu | Conforme, formateur partagé |
| D3 | `engine/compare.ts` `EQ_TOL` 1e-9 (`identical`, `margins_equal`) | Tolérance de comparaison flottante, pas un arrondi ; contrat « à la tolérance numérique près » | Aucune (couche moteur) |
| D4 | `CardTile` delta marginal | `> 1e-9` puis `signedPct` au rendu | Conforme |
| D5 | `exportComparison.ts` | Données en valeur exacte, deltas et agrégats en formules | Conforme, prouvé par le point 1 |
| D6 | `compare.test.ts` fixture §11 normalisée ±0,3 pt | Test historique, pas du code | Aucune |
| D7 | Cellules de matrice (`ComparePage`, `StatsPanel`) | « · » sous 0,05 % alors que l'Excel affiche « 0.0% » ; hors delta | **Corrigé** (Q2) : « 0.0 », « · » réservé au zéro exact, même formateur |

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

| Mutation | Garde qui échoue |
| --- | --- |
| X1 `exportComparison.ts` : cellules écrites `Number(v.toFixed(4))` | `dataIdentity` (cellules Excel ≠ matrice, 2 tests) |
| X2 `comparison.ts` : passe second donnée au scénario premier | `dataIdentity` |
| X3 `exportComparison.ts` : plage fausse de `starters_ge2` (`$H$7:$H$9`) | `dataIdentity` (Synthèse recalculée) |
| X4 `exportComparison.ts` : **formule de delta inversée** (`=B6-B14`) | `dataIdentity` (bloc delta évalué) |
| X5 `fmt.ts` : seuil 0,05 pt réintroduit dans `deltaPoints` | `fmt.test.ts` |
| X6 `comparison.ts` : avertissement Q5 jamais produit | `dataIdentity` |
| X7 `CardTile.tsx` : stepper `h-5 w-5` | `npm run e2e -- --only guards` (M1 : 20×20 à 360 px) |
| X8 `ComparePage.tsx` : infobulle à 1 décimale | `npm run e2e -- --only compare` (écran ≠ classeur, 24 écarts par onglet) |

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
