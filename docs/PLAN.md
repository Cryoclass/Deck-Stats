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
| 5 | Chronologie et conditions | Comparaison exacte à l'oracle sur 5 + pioche ; mêmes règles dans tous les consommateurs ; ET/OU testés | ⬜ Non commencée |
| 6 | Configuration, création et mobile | Même deck métier depuis création/import ; erreurs explicites ; actions et sélections utilisables aux largeurs retenues | ⬜ Non commencée |
| 7 | Comparateur et exports | Matrices côte à côte sur mobile, deltas non arrondis, données identiques entre analyse/Excel/comparateur | ⬜ Non commencée |
| 8 | Déploiement | Scripts dans /deploy, inventaire et simulation, purge exacte annoncée, contrôles après migration et restauration testée | ⬜ Non commencée |

## Reports connus (à reprendre dans l'étape indiquée)

- Étape 5 : profils non-engine, plafonds de groupe, sixième carte identifiée, conditions OU — ni dans le calcul ni dans la base ; horizons 1–3 conservés en attendant.
- Étape 6 : tolérances silencieuses du parseur YDK et du constructeur ; validation visuelle au navigateur des états « Recalcul… » / obsolète de l'étape 4 (livrée sans DOM) et de l'atténuation des deltas de la grille.
- Étape 7 : validation responsive du comparateur et du mur de mains.
- Étape 8 : purge des anciennes paires (`combo_pairs`, `deck_pair_exclusions`, `deck_start_requirements` source paire), sauvegarde/restauration VPS testées, adaptation de `prune-stale-cards` aux tables v2 (un report pendant annule toute la transaction).
- Hors étape : recalcul des aperçus de l'accueil avec une version fiable, sans cache faisant autorité.

## Compte rendu de la dernière étape

À mettre à jour en fin de chaque tâche (remplacer le contenu, l'historique reste dans docs/etapes-*.md et git).

- **Date** : 7 septembre 2026.
- **Étape** : 4 — détail dans docs/etape-4.md.
- **Livré** : `web/src/worker/computeClient.ts` (client pur : un client = un worker = un propriétaire, annulation par `terminate`, promesses toujours réglées) + `fakeWorker.ts` (tests) ; store : `modelVersion`/`resultVersion`, `stale`, `resultContext`, `computeError`, `recompute()`, `opening` ; panneau de stats, mur de mains et mode requête avec état périmé atténué, « Recalcul… », erreur + Relancer ; comparateur propriétaire de son client (dispose au démontage) ; worker relayant les exceptions par id.
- **Vérifications exécutées** : `npm run typecheck`, `npm run build` (avertissement ExcelJS attendu), `node scripts/test-quiet.mjs` (111 tests web dont 16 nouveaux, 4 serveur) ; suite PostgreSQL jetable (7 tests) exécutée en début de session sur le code serveur, inchangé par l'étape.
- **Non fait / reporté** : aucun test React/navigateur (validation visuelle reportée à l'étape 6) ; coût des très grands decks non borné. Aucune base personnelle, aucun VPS, aucun catalogue distant modifié.
- **Décisions ajoutées** : DECISIONS.md, section « Première mission — étape 4 » ; arbitrages JSON v1 / conflit d'import des étapes 2-3 consignés comme approuvés.
- **Prochaine action** : étape 5 — chronologie premier/second avec sixième carte identifiée, profils non-engine, conditions ET/OU, comparaison exacte à l'oracle (`web/src/engine/reference/`), mêmes règles dans tous les consommateurs ; passer par `localCalc`/`scheduleCompute`, ne jamais écrire `result` directement.
