# Étape 5, partie A — moteur et oracles

Livrée le 7 septembre 2026. Cible : les sections 3 (« Premier / second et
chronologie », profils, copies et plafonds), 4 (starts et conditions ET/OU) et 5
(espace des tirages) du [contrat métier](regles-metier.md). **Ni la persistance, ni
l'interface, ni le constructeur de modèle (`lib/engineModel.ts`) ne sont modifiés** :
l'application continue de calculer avec ses annotations actuelles ; les nouvelles
règles sont exercées par les tests et les oracles, et deviendront accessibles avec la
migration et l'interface de la partie B.

## Livré

### Contexte d'analyse unique

`computePass(input, context)` prend `'first'` ou `'second'` (les tailles 5 et 6
restent des synonymes pour les appels historiques ; tout autre paramètre rend la passe
indisponible avec motif). Matrice, distributions, buckets de requête, contributions
marginales (`computeAll`) et mur de mains (`evaluateHands({ context })`, dernière carte
= sixième pioche) dérivent tous de ce contexte. Le comparateur refuse une passe dont
le contexte ne correspond pas au scénario (`toComparisonMatrix`), de sorte que les
matrices A/B partagent exactement les hypothèses.

### Espace des issues

| Contexte | Cartes observées                 | Issues Z (`outcomes`)   | Mains distinctes (`total`) |
| -------- | -------------------------------- | ----------------------- | -------------------------- |
| Premier  | 5 initiales                      | C(D,5)                  | C(D,5)                     |
| Second   | 5 initiales + sixième identifiée | C(D,5)·(D−5) = 6·C(D,6) | C(D,6)                     |

Le moteur énumère les compositions de six cartes et distingue, pour chacune, le type
de la sixième : `w(k6, j) = W(k6) · k6ⱼ`, identité `C(n,k+1)(k+1) = C(n,k)(n−k)` du
contrat §5. Seuls les types dont l'issue dépend de la sixième (profils précoce et
flexible) sont séparés ; les autres copies et le filler partagent l'évaluation
« sixième neutre », strictement identique pour eux (vérifié par l'oracle et par
mutation). Les poids des buckets sont entiers sur Z ; la note /10 et les probabilités
divisent par Z. Le champ `total` conserve son sens de mains distinctes, ce qui laisse
le pont B01 de l'étape 1 intact.

### Profils, HOPT et plafonds partagés

`EngineType.availability` (`early` | `flexible` | `prepared` | `breaker`) détermine
les fenêtres selon le tableau du contrat ; `EngineType.group` renvoie à
`EngineInput.groups[{ id, capPerTurn }]`. Pour une issue, chaque type profilé reçoit
trois capacités : tour adverse (copies initiales seulement pour une flexible),
tour propre (initiales + sixième pour flexible, préparée, board breaker), et copies
disposant d'au moins une fenêtre ; le HOPT borne chaque tour à 1 par identité. Le
potentiel U est un flot maximum sur deux fenêtres, calculé par coupe minimale :

```
U(unité) = min( Σ min(total, opp + own), cap + Σ own, cap + Σ opp, 2·cap )
```

Un type sans groupe est une unité de plafond infini (`min(total, opp + own)`). En
premier, la fenêtre propre n'existe pas et la formule se réduit à `min(Σ opp, cap)`.
Copies brutes par catégorie (`catCounts`, `perCategory`) restent comptées sur toutes
les cartes observées, sixième incluse, sans fenêtre ni plafond.

Séparation « exemplaires tirés » / « contributions retenues » : `Bucket.neContrib`
porte la partie additive par signature de catégories ; `Bucket.neCapped` conserve
chaque unité couplée (plafond + membres avec leur signature) pour que les requêtes
par catégorie ou union mesurent **leur propre potentiel sous les mêmes plafonds**
(`cappedPotential(unit, keep)`), jamais une part répartie entre labels. Le mur de
mains (`SampledHand.neCapped`) utilise le même contexte de requête.

### Conditions ET/OU

`Condition = remaining(type, atLeast ≥ 1) | and[...] | or[...]`, sur
`EngineType.starterCondition` et `EngineInput.edgeConditions[e]`. Évaluée sur le deck
restant après **toutes** les cartes observées du contexte. `prepare` valide chaque
arbre : groupe vide, opérateur inconnu, quantité < 1 ou type hors modèle jettent une
erreur explicite (relayée par le worker comme échec de calcul, l'ancien résultat
restant affiché obsolète) — rien ne devient silencieusement vrai. Les anciens
`starterPrereqs` / `edgePrereqs` sont traduits en feuilles et combinés par ET.

### Modèle historique conservé

Un type **sans** profil suit le modèle précédent (pertinence de catégorie, plafond
HOPT `min(copies, horizon)`), y compris `horizonFirst/Second`. C'est la seule voie
que l'application emprunte aujourd'hui : aucune règle de correspondance entre anciens
labels et profils n'est décidée ici (contrat §3 : « pas de priorité implicite »).

## Preuves

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/test-quiet.mjs
node scripts/test-quiet.mjs web/src/engine/reference/chronology.test.ts
```

Résultats : **140 tests web** (10 fichiers ; 29 nouveaux dans
`engine/reference/chronology.test.ts`), **4 tests serveur** ; suite PostgreSQL
jetable (**7 tests**) exécutée en début de session sur le code serveur, inchangé ici
(conteneur `testhand-step23-tests` arrêté et supprimé). Build vert avec
l'avertissement ExcelJS attendu. Les 111 tests antérieurs passent avec leurs
valeurs inchangées ; seuls les appels `evaluate(prep, k, dead)` de `engine.test.ts`
ont été réécrits vers `evaluate(prep, context, k, sixth)`, et `rules.test.ts` /
`oracle.ts` sont strictement intacts.

- **Oracle d'énumération étendu** ([deckOracle.ts](../web/src/engine/reference/deckOracle.ts)) :
  decks entiers, mains physiques puis chaque sixième, starts par sous-ensembles
  d'actions, potentiel par affectation brute (`potential`), conditions ET/OU
  (`conditionHolds`), starts désactivés par position, copie remplacée par une neutre.
- **Oracle Monte Carlo** ([monteCarlo.ts](../web/src/engine/reference/monteCarlo.ts)) :
  10⁶ mains par cas, graine fixe (mulberry32), tirage par mélange partiel du multiset
  physique, évaluation mémoïsée par classe d'issue avec les primitives brutes.
  Tolérance `5·√(p(1−p)/n) + 5/n` ; jamais ajustée.
- **Ponts** (détail dans [cas-reference.md](cas-reference.md)) : B02 moteur =
  énumération à 10⁻¹² sur trois decks de 10 cartes (distributions, matrice, requêtes
  par catégorie et union, mur de mains avec note /10, deltas par contexte) ; B03
  Monte Carlo contre énumération **et** contre moteur ; B04 deck de 40 cartes contre
  Monte Carlo (hors portée de l'énumération physique).
- **Cas exacts** : P06, N01 (moteur), N08–N12, C05–C06 avec fractions bigint.
- **Mutation** : six erreurs volontaires (sixième ignorée, plafond sans 2·cap, flexible
  sixième au tour adverse, OU→ET, HOPT ignoré, précoce sixième avec fenêtre) font
  chacune échouer 3 à 13 tests, y compris les ponts Monte Carlo.

Durée de la nouvelle suite : ≈ 17 s (quatre simulations de 10⁶ mains).

## Limites

- **L'application ne voit pas encore les nouvelles règles** : `engineModel.ts` ne
  pose ni profil, ni groupe, ni condition OU ; l'interface garde les horizons 1–3 et
  le bouton delta 1st/2nd. Partie B.
- Les ponts exhaustifs sont bornés à 10 cartes (oracle de l'étape 1 : 12 maximum) ;
  au-delà, seule la comparaison Monte Carlo est possible.
- Le coût exact d'un très grand deck reste non borné (réserve §2 du contrat). La
  séparation de la sixième multiplie les évaluations par au plus 1 + nombre de types
  précoces/flexibles présents ; aucune mesure de temps sur deck réel n'a été faite ici.
- `perCategory[].relevant` reste calculé sur la pertinence historique ; pour une carte
  profilée portant une catégorie « premier seulement », la distribution brute est
  produite en second avec le drapeau `relevant = false` (à réviser avec la migration).
- Aucun test React ni navigateur ; le mur de mains est prouvé par `evaluateHands`.

## Questions ouvertes

Implémentées de façon conservatrice et signalées dans
`chronology.test.ts` (bloc « Interprétations conservatrices »). À trancher avant ou
pendant la partie B.

1. **Carte profilée sans étiquette (Q1)** : contribution nulle. Le contrat lie le
   potentiel aux étiquettes (« union des labels ») ; un profil seul ne suffit-il pas ?
2. **Plafond de groupe sur une carte sans profil (Q2)** : refusé avec message (pas
   ignoré, pas appliqué au modèle historique). La migration doit poser profil et
   groupe ensemble, ou l'interface doit l'empêcher.
3. **Anciens prérequis ET et nouvelle condition sur la même source (Q3)** : combinés
   par ET. Après migration, une seule représentation devrait subsister.
4. **Pertinence de catégorie pour une carte profilée (Q4)** : non appliquée (le
   contrat cible ne connaît que des étiquettes). Que devient `relevance` à la
   migration : supprimée, ou convertie en profil pour les cartes sans annotation ?
5. **Cartes étiquetées sans profil après migration** : le contrat demande de les
   identifier sans priorité implicite. Faut-il une valeur « profil non renseigné »
   qui rend la passe indisponible, ou un état d'interface bloquant l'enregistrement ?
6. **Sensibilité flexible** : seule, une flexible HOPT donne le même U que la sixième
   soit initiale ou non ; la différence n'apparaît qu'avec un plafond partagé avec une
   carte à tour propre seul. Le moteur la sépare toujours (sûr, coût léger) ; confirmer
   que cette lecture du tableau (sixième flexible = tour propre uniquement) est voulue.
7. **`total` vs `outcomes`** : deux dénominateurs coexistent sur `PassResult` pour
   préserver B01. Si l'on préfère un seul champ, le test de référence B01 devra être
   réécrit explicitement (jamais « pour faire passer le code »).

## Réponses

1. **Q1 — Confirmé : contribution nulle.** Un profil décrit _quand_ une
   contribution est disponible, l'étiquette décrit _ce qui_ est compté ; un
   profil sans étiquette ne mesure rien. La partie B empêche dans l'interface
   d'enregistrer un profil sur une carte sans catégorie non-engine. La garde
   moteur reste.

2. **Q2 — Confirmé : refus.** Un groupe de plafond partagé n'est proposé que
   pour une carte déjà profilée. La migration ne crée aucun groupe : les
   groupes sont une annotation nouvelle, saisie manuellement. La garde moteur
   reste, comme filet.

3. **Q3 — Une seule représentation : la nouvelle.** La migration convertit
   chaque ancien prérequis en un groupe ET de la nouvelle structure de
   conditions. Après migration, le moteur ne reçoit plus d'anciens prérequis ;
   le chemin de combinaison ET ne doit plus être un cas normal (le garder
   comme garde qui signale, pas comme fonctionnalité).

4. **Q4 : PAS de conversion de `relevance`** (le titre était erroné)
   Redéfinition manuelle des profils ; `buildEngineModel` ignore `relevance`, la colonne est conservée jusqu'à la purge de l'étape 8. Conséquence assumée : après migration, les cartes non-engine tombent dans le cas Q5 jusqu'à ressaisie.

5. **Q5 — Passe disponible, contribution nulle, avertissement explicite.**
   Une carte étiquetée sans profil compte zéro dans les
   contributions retenues, reste comptée dans les exemplaires tirés, et les
   statistiques affichent la liste des cartes concernées (« 2 cartes
   non-engine sans profil, non comptées »). Aucun profil n'est deviné.
   L'enregistrement n'est pas bloqué : les catégories étant communes au
   compte, une passe indisponible bloquerait tous les decks à la fois.

6. **Q6 — Confirmé.** Flexible tirée sixième = tour propre uniquement,
   conformément au tableau du contrat. Le moteur conserve la séparation.

7. **Q7 — Garder les deux champs.** `total` = mains distinctes (dénominateur
   des probabilités de main), `outcomes` = issues pondérées avec sixième
   identifiée (dénominateur des contributions en second). Sémantique
   documentée sur `PassResult` ; B01 n'est pas réécrit.

## Passation

- Décisions dans DECISIONS.md, section « Première mission — étape 5, partie A » ;
  résumé dans docs/decisions-compressees.md.
- `engine/reference/deckOracle.ts` et `monteCarlo.ts` sont réservés aux tests, comme
  `oracle.ts` : jamais importés par l'application, jamais adaptés au moteur. La
  notation `OracleSpec` (noms de cartes, listes physiques) n'est pas un schéma.
- Pour la partie B : `buildEngineModel` doit poser `availability`, `group`,
  `groups`, `starterCondition` / `edgeConditions` depuis les nouvelles tables ; le
  store passe déjà par `localCalc`/`scheduleCompute` ; `evaluateHands` attend un
  `context`, la dernière carte d'une main de six étant la sixième (déjà vrai pour
  `drawHands`). `PassResult.context` et `outcomes` sont disponibles pour les libellés
  « Premier · 5 cartes » / « Second · 5 cartes + pioche » et « départs théoriques ».
- Contrôle par mutation : script jetable dans le bac à sable de session (non
  versionné) ; le refaire à la main consiste à altérer une règle du moteur et vérifier
  qu'au moins un pont échoue.
- Sous PowerShell en bac à sable, `Remove-Item` à plusieurs chemins a été bloqué ;
  passer par Bash (`rm`) ou un script Node pour les fichiers temporaires.
