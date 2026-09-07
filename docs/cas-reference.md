# Cas de référence et état de conformité

Références établies à l’étape 1, 7 septembre 2026, étendues à l’étape 5A
(section « Cas de l’étape 5A » ci-dessous).
Les [étapes 2 et 3 sont maintenant livrées](etapes-2-3.md) ; les résultats
ci-dessous relatifs à la seule étape 1 constituent le relevé historique. Lire le [contrat métier](regles-metier.md) pour la
sémantique cible. **Un test de référence réussi prouve son exemple, pas la
conformité actuelle de l'application à toutes les nouvelles règles.**

## Reproduire les vérifications

Depuis la racine, sous PowerShell (ailleurs, `npm` convient) :

```powershell
npm.cmd run test -w web -- --no-cache
npm.cmd run typecheck
npm.cmd run build
```

Pour les seuls nouveaux cas :

```powershell
npm.cmd run test -w web -- src/engine/reference/rules.test.ts --no-cache
```

Pour les cas de l’étape 5A (chronologie, profils, plafonds, ET/OU, oracles) :

```powershell
node scripts/test-quiet.mjs web/src/engine/reference/chronology.test.ts
```

Aucune base, réseau, graine aléatoire ou donnée personnelle n'est nécessaire aux
tests. Le projet n'a pas de commande lint configurée ; ne pas confondre la
vérification TypeScript avec un lint.

Résultats exécutés à l'étape 1 :

| Vérification | Résultat |
| --- | --- |
| `npm.cmd run test -w web -- --no-cache` | 4 fichiers, 78 tests réussis : 52 historiques et 26 nouveaux |
| `npm.cmd run typecheck` | Serveur et web réussis |
| `npm.cmd run build` | Serveur et web réussis ; avertissement Vite sur le bloc ExcelJS de 940,19 kB minifié, 271,33 kB gzip |
| `git diff --check` | Aucun problème dans les fichiers suivis modifiés |
| Liens locaux des deux nouveaux documents | 19 chemins contrôlés, tous présents |

Le build génère les répertoires `dist` ignorés par Git. Aucun service ni script de
base de données n'a été lancé pour ces vérifications. Les performances sur de
grands decks, l'affichage responsive et la migration restent à vérifier aux
étapes qui les concernent.

Le support [oracle.ts](../web/src/engine/reference/oracle.ts) est réservé aux tests :
il énumère les sous-ensembles de **copies physiques identifiées**, puis les choix
de sixième carte ; il explore les sous-ensembles d'actions disjointes pour les
starts et les affectations de copies à des fenêtres pour le potentiel non-engine.
Il n'importe aucun algorithme de production, ne sert pas à l'application et ne
propose pas un schéma de stockage. Sa recherche exhaustive est bornée à de petits
exemples (12 cartes, mains d'au plus 6 pour l'évaluation).

La formule binomiale indépendante utilise des entiers `bigint`. Les fractions et
les arrondis de référence sont donc contrôlés sans arrondi flottant préalable.
L'oracle ne simule pas le texte des cartes : ses profils et plafonds sont les
hypothèses explicites de chaque exemple.

## Références calculables à la main

Les identifiants correspondent aux tests dans
[rules.test.ts](../web/src/engine/reference/rules.test.ts).

| ID | Exemple et résultat attendu | Ce que cela vérifie |
| --- | --- | --- |
| P01 | A₁,A₂,X,Y ; tirer 2 : AA, A₁X, A₁Y, A₂X, A₂Y, XY. Copies de A : masses 1/6, 4/6, 1/6 | Poids des exemplaires, sans remise ; les compositions ne sont pas équiprobables |
| P02 | D=40, A×3, h=5 : P(A≥1)=222111/658008=33,7550607… %, affiché 33,76 %. P(A=2)=23310/658008=3,5425101… %, affiché 3,54 % | Numérateur, dénominateur et arrondi exacts |
| P03 | D=7 : C(7,5)×2=42 issues chronologiques ; chaque ensemble de six apparaît 6 fois | Sixième distincte, sans remplacement |
| P04 | D=40, A×3 : première A en sixième = C(37,5)×3 / (C(40,5)×35) = 5,67813765… % | L'événement est disjoint de « A dans les cinq premières » ; leur somme vaut P(A dans les six) |
| P05 | D<5 : aucune main initiale ; D=5 : une main premier, aucune issue second | Dénominateur nul : indisponible, pas 100 % jouable |
| N01 | Les quatre lignes du tableau des profils, chacune en premier, second initial et second sixième | Fenêtres autorisées ; aucun horizon implicite de plusieurs tours adverses |
| N02 | Une carte précoce parmi 7 : présente dans les six dans 36/42 cas ; dans les cinq premières dans 30/42 cas | Copies brutes 6/7 contre potentiel 5/7 en second |
| N03 | Une flexible HOPT initiale en second : U=1 | Deux fenêtres ne doublent pas une copie |
| N04 | Deux flexibles HOPT de même nom : U=1 en premier, U=2 en second ; initiale + sixième : U=2 ; sixième seule : U=1 | Limite par nom et par tour, respect de la chronologie |
| N05 | Deux préparées de même nom en second : U=1 si HOPT, U=2 sinon | Une fenêtre n'est pas automatiquement un plafond d'une carte |
| N06 | M,M,P dans une fenêtre, groupe limité à 2 : U=2. M,M sans HOPT individuel : U=2 ; avec HOPT : U=1 | Plafond partagé distinct d'un HOPT ; remise à zéro du plafond au tour suivant |
| N07 | Une copie dans x et y : potentiel x=1, y=1, union=1. Deux cartes distinctes x/y sous cap commun 1 : mêmes potentiels | Déduplication et non-additivité des sous-ensembles |
| S01 | A,B,C avec AB et BC : S=1, R=2. Dans A,B,C,X, h=2 : 2 mains avec start sur 6 | Combos simultanément présents mais non disjoints |
| S02 | A,A starter : S=1 si HOPT, 2 sinon. A,A,B,B avec AB sans HOPT : S=2, R=4 | Graphe de copies, redondance, doublons de déclarations |
| S03 | R,E avec paire RE ; R est également non-engine : (S,U)=(1,1) | Un même exemplaire peut contribuer aux deux axes |
| C01 | B requis à ≥1 : reste 1 → vrai, reste 0 ou absent → faux ; ≥2 exige 2 | Quantités résiduelles, pas présence totale initiale |
| C02 | B ET (C OU D) vrai avec BC ou BD, faux sans B ou sans alternative | Composition booléenne, pas d'addition des alternatives ; groupe vide invalide |
| C03 | A et C requièrent chacun B restant×1 : S=2, B n'est pas consommé. A starter désactivé peut encore former AC | Conditions par source ; pas de simulation de ressources |
| C04 | D=6, A en main initiale et B seul restant ; B pioché en sixième | La condition « B restant » devient fausse pour le start évalué sur six |
| M01 | A₁,A₂,B,X, h=2, A requiert B restant : AA, A₁X, A₂X donnent 3/6. Remplacer B par neutre : 0/6 ; delta de perte +1/2 | Reconstruction des conditions après remplacement, D constant |
| M02 | Six non-engine retenus : toute la masse est dans la colonne 5+ ; E[U]=6 mais moyenne plancher=5 | Conservation de masse et sens des moyennes du comparateur |
| M03 | 36 issues moins bien classées, 12 égales, 56 au total : 10×(36+12/2)/56=7,5 → note 8 | Traitement exact de la demi-unité ; 11 égales donne une note 7 |

Pour M01 à taille habituelle, D=40, A×3 et B×1 : les mains valides évitent B et
contiennent A. Leur nombre est `C(39,5)−C(36,5)=198765`, sur `C(40,5)=658008`.
Le delta de perte après remplacement de B est donc **+30,2070795… points**.
Ce calcul ne suppose aucune indépendance entre A en main et B restant en deck.

## Comparaison avec la production

**B01** compare réellement `computePass` à l'oracle indépendant pour les règles
inchangées de starts et redondance : deck A,A,B,B,C,C,X,X, 32 configurations
déterministes de starters/HOPT/paires, mains de 5 et de 6. Cela représente
**64 distributions et 2 688 mains physiques évaluées** :
`32 × (C(8,5)+C(8,6)) = 32 × (56+28)`.

Tous les bins de starts et redondance, y compris les valeurs nulles, sont comparés
avec une tolérance de 10⁻¹². Le dénominateur est comparé au nombre entier de mains.
Les 52 tests historiques restent exécutés pour les calculs, le comparateur et
l'export Excel. Les nouveaux tests n'ajoutent aucun test ignoré ou marqué comme
« échec attendu » pour dissimuler un défaut.

Les suites P/N/S/C/M valident les exemples du contrat indépendamment de la
production. N01–N07 et C02 ne sont donc **pas** des preuves que le nouveau calcul
chronologique, les plafonds de groupe et le OU existent déjà dans l'application.
P05 et M01–M03 ont depuis été reliés aux tests de régression de production dans
[corrections.test.ts](../web/src/engine/corrections.test.ts), à l’étape 2.

## Cas de l’étape 5A — chronologie, profils, plafonds et conditions

Ajoutés le 7 septembre 2026 dans
[chronology.test.ts](../web/src/engine/reference/chronology.test.ts). L’oracle de
l’étape 1 ([oracle.ts](../web/src/engine/reference/oracle.ts), inchangé) est étendu
par [deckOracle.ts](../web/src/engine/reference/deckOracle.ts) : énumération
physique exhaustive de decks entiers (mains de cinq, puis chaque sixième carte
distinguée), starts par sous-ensembles d’actions, potentiel par affectation brute des
copies aux fenêtres, conditions ET/OU sur le deck restant. Un second oracle
[monteCarlo.ts](../web/src/engine/reference/monteCarlo.ts) tire un million de mains
par cas avec une graine fixe (mulberry32) depuis le multiset physique. Ni l’un ni
l’autre n’importe un algorithme de production ; l’adaptateur spec → `EngineInput`
est du code de test.

Notation : D taille du deck ; en second, Z = C(D,5)·(D−5) issues (composition
initiale, sixième identifiée), soit 6·C(D,6). Le moteur expose `total` = C(D,h)
mains distinctes et `outcomes` = Z ; les poids des buckets sont entiers sur Z.

| ID | Exemple et résultat attendu | Ce que cela vérifie |
| --- | --- | --- |
| P06 | D=7 : 21 issues en premier ; 7 mains distinctes et 42 issues en second, poids entiers de somme 42 ; D=40 : Z = C(40,5)·35 = 6·C(40,6) = 23 030 280 ; D=5 : aucune issue second | Espace chronologique du contrat §5 dans le moteur ; 5/6 restent des synonymes de premier/second |
| N01 (moteur) | Une carte de chaque profil, seule dans D=40 : premier, second initiale, second sixième | Le moteur reproduit exactement le tableau des fenêtres de l’oracle ; copies brutes toujours comptées |
| N08 | Fuwalos ×3 précoce, D=40. Second : P(U≥1) = 222111/658008 (Fuwalos parmi les 5 initiales) ; copies brutes P(≥1 parmi 6) = 1513596/3838380 ; écart = première Fuwalos en sixième = 1307691/23030280 = 5,678… % ; P(U=3) = C(37,2)·35/23030280. Premier : U ≡ 0, copies brutes 222111/658008 | Une sixième précoce est piochée mais sans fenêtre ; jamais déclarée morte |
| N09 | Ash ×3 flexible HOPT, D=40. Second : P(U=1) = 1307691/3838380 (exactement une Ash parmi 6, initiale ou sixième). Premier : P(U=1) = 222111/658008, U ≤ 1 | Une copie contribue une fois malgré deux fenêtres |
| N10 | Mêmes Ash. Second : P(U=2) = 205905/3838380 (≥2 parmi 6, même si la seconde est la sixième), U ≤ 2. Premier : P(U≥2) = 0 ; sans HOPT, P(U≥2) = (3·C(37,3)+C(37,2))/658008 | Un tour par copie HOPT, sixième affectée au tour propre |
| N11 | Fuwalos ×3 + Purulia ×3 précoces, groupe plafonné à 2, D=40. Second : P(U=2) = 101496/658008, P(U≥3) = 0 ; plafond 3 : P(U=3) = 11736/658008 ; Fuwalos seules sous plafond 2 : P(U=2) = (3·C(37,3)+C(37,2))/658008 ; deux flexibles sous plafond 1 : U=2 en second (un par tour), 1 en premier | Plafond partagé par tour, distinct du HOPT, remis à zéro au tour suivant |
| N12 | D=10 : F×3 flexible HOPT (h), P×2 préparée (h,q), M précoce (m,q), groupe w plafonné à 1. Second : E[U(h)] + E[U(q)] > E[U(h∪q)] > 0, et U(h∪q) ≤ U total | Sous-ensembles mesurés sous les mêmes plafonds ; déduplication ; non-additivité |
| C05 | D=8 : A,A,C,D,X×4 ; A starter exige (C≥1 OU D≥1) restant. Premier : P(S=1) = 18/56, P(S=2) = 16/56, P(S≥1) = 34/56, P(S≥3) = 0 ; « C≥1 ET C≥1 » = « C≥1 » ; groupe vide, quantité 0, opérateur inconnu, type hors modèle : refusés | Une alternative satisfaite deux fois compte une fois ; rien ne devient vrai par défaut |
| C06 | D=7 : A,B,X×5 ; A exige B≥1 restant. Premier : 5/21 ; second : 6/42 (les six observées = A + cinq X). D=6 (C04) : 1/6 en premier, 0 en second | Condition évaluée après les 5 cartes, puis après les 5 + sixième |
| B02 | Trois decks de 10 cartes cumulant profils, HOPT, plafond partagé, paire, conditions ET/OU, paires conditionnées, starts désactivés par position, catégories recouvrantes : premier (252 mains) et second (1 260 issues) | Moteur = énumération physique à 10⁻¹² : starts, redondance, U, copies brutes, matrice du comparateur, requêtes par catégorie et union pour chaque valeur, mur de mains (starts, U, sujets, note /10), contributions marginales par contexte |
| B03 | Deck B02 n° 1, 10⁶ mains par contexte, graine 20260907 | Monte Carlo contre énumération et contre le moteur : S, U et 24 cellules sous 5 erreurs types + 5 tirages |
| B04 | 40 cartes (Ash, Fuwalos, Purulia plafonnées, Imperm, Nibiru, starter OU, paire conditionnée, start désactivé en premier), 10⁶ mains par contexte, graine 50907 | Hors portée de l’énumération physique : moteur contre Monte Carlo sur S, U, matrice et potentiels par catégorie |
| Q1–Q4 | Interprétations conservatrices (voir [etape-5a.md](etape-5a.md), questions ouvertes) | Profilée sans étiquette = 0 ; groupe sans profil refusé ; anciens prérequis ET condition = ET ; pertinence historique non appliquée aux cartes profilées |

Tolérance Monte Carlo : pour une probabilité exacte p et n tirages,
`5·√(p(1−p)/n) + 5/n`, soit cinq erreurs types plus cinq tirages pour les événements
rares. À graine fixe, le résultat est déterministe : un dépassement est une
divergence reproductible, jamais un bruit à absorber. Aucun test n’ajuste cette borne.

Vérification par mutation (7 septembre 2026, non versionnée) : six erreurs
volontaires du moteur — sixième ignorée, plafond sans terme 2·cap, flexible en
sixième au tour adverse, OU évalué comme ET, HOPT ignoré, précoce en sixième avec
fenêtre — font chacune échouer de 3 à 13 tests des ponts, dont les ponts Monte Carlo.

## Écarts de l’audit initial et étapes responsables

| Zone actuelle | Écart / risque constaté | Preuve et résultat exigé ensuite |
| --- | --- | --- |
| [enumerate.ts](../web/src/engine/enumerate.ts), `computeAll` | Le remplacement d'une copie conserve les `requiredTotal` des prérequis | Étape 2 : M01 contre `computeAll`, y compris source carte et paire ; reconstruire les totaux |
| [enumerate.ts](../web/src/engine/enumerate.ts), passe impossible | Distribution vide puis `1−brick` peut donner 1 | Étape 2 : P05 à l'API moteur et dans les états d'interface |
| [StatsPanel.tsx](../web/src/components/StatsPanel.tsx), `CrossMatrix` | La cellule étiquetée 5+ lit seulement l'indice 5, omettant l'indice 6 | Étape 2 : M02 appliqué à l'affichage ; même matrice que le comparateur |
| [hand.ts](../web/src/engine/hand.ts), `buildScorer` | Une accumulation flottante peut placer une demi-unité du mauvais côté de l'arrondi | Étape 2 : M03 puis fixtures réelles de distribution avec égalités |
| [evaluate.ts](../web/src/engine/evaluate.ts), [types.ts](../web/src/engine/types.ts) | La main de six n'a pas d'origine de pioche ; horizon numérique, prérequis ET seulement | Étape 5A livrée : contexte unique, sixième identifiée, profils, plafonds, ET/OU (P06, N08–N12, C05–C06, B02–B04) ; l’horizon historique subsiste pour les cartes sans profil jusqu’à la migration (5B) |
| [deckStore.ts](../web/src/store/deckStore.ts), `togglePair`, `saveDeck` | Création de paires globales immédiate ; plusieurs écritures de sauvegarde indépendantes | Étape 3 : sauvegarde explicite, paires par deck, tests d'isolation et d'atomicité |
| [deckStore.ts](../web/src/store/deckStore.ts), `scheduleCompute`, [client.ts](../web/src/worker/client.ts) | Version changée après debounce, pas d'annulation du worker ni de rejet général des promesses | Étape 4 : réponse ancienne durant debounce ignorée, nouvelle édition pendant calcul, erreur/arrêt/changement de deck sans promesse bloquée |
| [ydk.ts](../web/src/lib/ydk.ts), [exportDeck.ts](../web/src/lib/exportDeck.ts) | Tolérance silencieuse de lignes invalides/quantités ; export version 1 incomplet pour conditions et requêtes | Étapes 3/6 : import explicite, modèle commun et aller-retour sans perte des données prises en charge |
| [ComparePage.tsx](../web/src/components/ComparePage.tsx) et [HandWall.tsx](../web/src/components/HandWall.tsx) | Repli des matrices et listes de mains volumineuses ; scénario local au mur | Étapes 6/7 : vérification responsive et synchronisation du contexte |
| [schema.sql](../db/schema.sql) et [/deploy](../deploy/README.md) | Anciennes paires globales et dépendances en cascade ; pas d'inventaire des lignes accessible | Étape 8 : simulation ciblée, sauvegarde/restauration et contrôle de conservation des autres données |

Les liens désignent les zones identifiées lors de l’audit. Les corrections réalisées
aux étapes 2 et 3 et leurs tests de régression sont détaillés dans le rapport associé.
La somme S+U peut dépasser la taille de main sans être une erreur : S et U ne sont
pas des catégories disjointes. Les moyennes planchers du comparateur et la
redondance supérieure aux starts sont également des conventions à expliciter,
pas des défauts mathématiques.

## Acceptation par étape du plan révisé

| Étape | Résultat vérifiable attendu | Statut après l’étape 3 |
| --- | --- | --- |
| 1. Règles et exemples | Contrat traçable ; fractions de contrôle ; oracle distinct ; vérifications existantes maintenues | Livré par ces documents et les 26 nouveaux tests |
| 2. Calculs confirmés défectueux | Tests de régression reliés au moteur et à l’affichage ; masses, arrondis et conditions corrects | Livrée, 6 nouveaux tests de régression |
| 3. Modèle et persistance | Paires manuelles propres au deck, non-engine commun au compte, enregistrement cohérent, import/export et duplication testés | Livrée, tests web/serveur/PostgreSQL ; migration seulement en base jetable |
| 4. Recalcul | État périmé visible, actions possibles, invalidation immédiate, annulation et absence de réponse ancienne adoptée | Livrée, tests `store/recompute.test.ts` et `worker/computeClient.test.ts` (faux worker, horloge simulée) |
| 5. Chronologie et conditions | Comparaison exacte à l'oracle sur 5+pioche ; mêmes règles dans tous les consommateurs ; ET/OU testés | Partie A livrée (moteur et oracles, [etape-5a.md](etape-5a.md)) ; partie B (persistance, interface) à venir |
| 6. Configuration, création et mobile | Même deck métier depuis création/import ; erreurs explicites ; principales actions et sélections utilisables aux largeurs retenues | Non commencée |
| 7. Comparateur et exports | Matrices côte à côte sur mobile, deltas non arrondis, données identiques entre analyse/Excel/comparateur | Non commencée |
| 8. Déploiement | Scripts dans /deploy, inventaire et simulation, purge exacte annoncée, contrôles après migration et restauration testée | Non commencée |

L'étape 1 ne comporte ni mutation métier, ni changement de schéma, ni suppression,
ni validation visuelle dans un navigateur. Le document préexistant
`docs/design-system.md` reste hors des modifications de cette étape.
