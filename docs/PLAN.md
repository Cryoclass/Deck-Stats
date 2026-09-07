# Plan de la mission de fiabilisation — 8 étapes

Source du plan : docs/cas-reference.md, « Acceptation par étape du plan révisé ».
Cible : docs/regles-metier.md (contrat métier). Comptes rendus détaillés : docs/etapes-*.md.
Chaque session lit ce fichier au début et met à jour le statut et le compte rendu en fin de tâche.

## Étapes

| # | Étape | Résultat vérifiable attendu | Statut |
| --- | --- | --- | --- |
| 1 | Règles et exemples | Contrat traçable ; fractions de contrôle ; oracle distinct ; vérifications existantes maintenues | ✅ Terminée le 7 sept. 2026 — contrat métier, cas de référence P/N/S/C/M, oracle indépendant (`web/src/engine/reference/`), 26 tests ; aucun code applicatif modifié. |
| 2 | Calculs confirmés défectueux | Tests de régression reliés au moteur et à l'affichage ; masses, arrondis et conditions corrects | ✅ Terminée le 7 sept. 2026 — delta reconstruit après remplacement, colonne 5+ agrégée, passe impossible explicitement indisponible, note /10 à arrondi exact, binomiale bigint ; 6 tests (`corrections.test.ts`). |
| 3 | Modèle et persistance | Paires manuelles propres au deck, non-engine commun au compte, enregistrement cohérent, import/export et duplication testés | ✅ Terminée le 7 sept. 2026 — configuration v2 (paires par deck, conditions, disponibilités, révision, transaction unique), migration additive `001-deck-configuration.sql`, JSON v2, duplication ; tests web/serveur/PostgreSQL, migration jouée en base jetable seulement. |
| 4 | Recalcul | État périmé visible, actions possibles, invalidation immédiate, annulation et absence de réponse ancienne adoptée | ✅ Terminée le 7 sept. 2026 — client de calcul pur avec propriété des tâches et annulation (`worker/computeClient.ts`), versionnement `modelVersion`/`resultVersion`, invalidation dès la mutation, état périmé atténué avec son contexte, erreur + relance, ouvertures numérotées pour `loadDeck`/`saveDeck` ; 16 tests avec faux worker et horloge simulée (`recompute.test.ts`, `computeClient.test.ts`). |
| 5 | Chronologie et conditions | Comparaison exacte à l'oracle sur 5 + pioche ; mêmes règles dans tous les consommateurs ; ET/OU testés | 🟡 Partie A livrée le 7 sept. 2026 (moteur : contexte unique, sixième identifiée, profils, plafonds partagés, ET/OU ; oracle étendu + oracle Monte Carlo ; 29 tests) — partie B (migration, invalidation, interface, exports) en attente de validation. |
| 6 | Configuration, création et mobile | Même deck métier depuis création/import ; erreurs explicites ; actions et sélections utilisables aux largeurs retenues | ⬜ Non commencée |
| 7 | Comparateur et exports | Matrices côte à côte sur mobile, deltas non arrondis, données identiques entre analyse/Excel/comparateur | ⬜ Non commencée |
| 8 | Déploiement | Scripts dans /deploy, inventaire et simulation, purge exacte annoncée, contrôles après migration et restauration testée | ⬜ Non commencée |

## Reports connus (à reprendre dans l'étape indiquée)

- Étape 5, partie B : profils non-engine, plafonds de groupe et conditions OU sont dans le moteur (partie A) mais ni dans la base ni dans `engineModel` ; horizons 1–3 et delta 1st/2nd conservés jusqu'à la migration ; questions ouvertes Q1–Q7 de docs/etape-5a.md à trancher.
- Étape 6 : tolérances silencieuses du parseur YDK et du constructeur ; validation visuelle au navigateur des états « Recalcul… » / obsolète de l'étape 4 (livrée sans DOM) et de l'atténuation des deltas de la grille.
- Étape 7 : validation responsive du comparateur et du mur de mains.
- Étape 8 : purge des anciennes paires (`combo_pairs`, `deck_pair_exclusions`, `deck_start_requirements` source paire), sauvegarde/restauration VPS testées, adaptation de `prune-stale-cards` aux tables v2 (un report pendant annule toute la transaction).
- Hors étape : recalcul des aperçus de l'accueil avec une version fiable, sans cache faisant autorité.

## Compte rendu de la dernière étape

À mettre à jour en fin de chaque tâche (remplacer le contenu, l'historique reste dans docs/etapes-*.md et git).

- **Date** : 7 septembre 2026.
- **Étape** : 5, partie A — détail dans docs/etape-5a.md.
- **Livré** : moteur à contexte unique (`computePass(input, 'first' | 'second')`, `PassResult.context`/`outcomes`), issues (composition initiale, sixième identifiée) de poids `Π C(nᵢ,kᵢ)·(nⱼ−kⱼ)`, profils `availability`, plafonds partagés `groups`/`group` (potentiel par coupe minimale, unités couplées `neCapped` dans les buckets et le mur de mains), conditions ET/OU `Condition` validées dans `prepare`, deltas et `evaluateHands` par contexte, garde de contexte dans `toComparisonMatrix` ; oracle étendu `reference/deckOracle.ts`, oracle Monte Carlo `reference/monteCarlo.ts`, `reference/chronology.test.ts` (29 tests : P06, N01 moteur, N08–N12, C05–C06, B02–B04, Q1–Q4). `oracle.ts`, `rules.test.ts`, persistance, `engineModel.ts` et interface strictement inchangés.
- **Vérifications exécutées** : `npm run typecheck`, `npm run build` (avertissement ExcelJS attendu), `node scripts/test-quiet.mjs` (140 tests web dont 29 nouveaux, 4 serveur) ; suite PostgreSQL jetable (7 tests) en début de session sur le code serveur, inchangé ; contrôle par mutation (six erreurs volontaires, toutes détectées).
- **Non fait / reporté** : partie B entière (migration additive profils/plafonds/conditions, invalidation des decks concernés, réglage unique premier/second, sixième carte visible, « départs théoriques », export Excel et comparateur relibellés, tests PostgreSQL) ; les cartes sans profil suivent encore le modèle historique (pertinence + horizon). Aucune base personnelle, aucun VPS, aucun catalogue distant modifié.
- **Décisions ajoutées** : DECISIONS.md, section « Première mission — étape 5, partie A » ; sept questions ouvertes (Q1–Q7) dans docs/etape-5a.md, implémentées de façon conservatrice et signalées dans les tests.
- **Prochaine action** : attendre la validation de la partie A et les réponses aux questions ouvertes ; puis partie B — `buildEngineModel` pose `availability`/`group`/`groups`/`starterCondition`/`edgeConditions` depuis les nouvelles tables, suppression des horizons et du delta 1st/2nd au profit du contexte unique, libellés « Premier · 5 cartes » / « Second · 5 cartes + pioche ».
