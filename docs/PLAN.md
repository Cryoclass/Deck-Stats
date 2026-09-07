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
| 4 | Recalcul | État périmé visible, actions possibles, invalidation immédiate, annulation et absence de réponse ancienne adoptée | ⬜ Non commencée |
| 5 | Chronologie et conditions | Comparaison exacte à l'oracle sur 5 + pioche ; mêmes règles dans tous les consommateurs ; ET/OU testés | ⬜ Non commencée |
| 6 | Configuration, création et mobile | Même deck métier depuis création/import ; erreurs explicites ; actions et sélections utilisables aux largeurs retenues | ⬜ Non commencée |
| 7 | Comparateur et exports | Matrices côte à côte sur mobile, deltas non arrondis, données identiques entre analyse/Excel/comparateur | ⬜ Non commencée |
| 8 | Déploiement | Scripts dans /deploy, inventaire et simulation, purge exacte annoncée, contrôles après migration et restauration testée | ⬜ Non commencée |

## Reports connus (à reprendre dans l'étape indiquée)

- Étape 4 : annulation du worker, affichage des statistiques périmées, réponse ancienne jamais adoptée (`web/src/store/deckStore.ts`, `web/src/worker/client.ts`).
- Étape 5 : profils non-engine, plafonds de groupe, sixième carte identifiée, conditions OU — ni dans le calcul ni dans la base ; horizons 1–3 conservés en attendant.
- Étape 6 : tolérances silencieuses du parseur YDK et du constructeur.
- Étape 7 : validation responsive du comparateur et du mur de mains.
- Étape 8 : purge des anciennes paires (`combo_pairs`, `deck_pair_exclusions`, `deck_start_requirements` source paire), sauvegarde/restauration VPS testées, adaptation de `prune-stale-cards` aux tables v2 (un report pendant annule toute la transaction).
- Hors étape : recalcul des aperçus de l'accueil avec une version fiable, sans cache faisant autorité.

## Compte rendu de la dernière étape

À mettre à jour en fin de chaque tâche (remplacer le contenu, l'historique reste dans docs/etapes-*.md et git).

- **Date** : 7 septembre 2026.
- **Étape** : 3 (livrée avec la 2) — détail dans docs/etapes-2-3.md.
- **Livré** : module pur `server/src/domain/deckConfiguration.ts` partagé client/serveur ; tables `deck_combo_pairs`, `deck_requirements`, `deck_flags`, `decks.revision`, `app_migrations` ; enregistrement transactionnel avec révision ; import/export JSON v2, duplication avec remappage ; anciens endpoints partiels en 410.
- **Vérifications exécutées** : `npm run test -w web` (95 tests, 7 fichiers), `npm run test -w server` (4 tests), `npm run test:integration -w server` sur base jetable (7 tests), `npm run typecheck`, `npm run build` (avertissement ExcelJS attendu).
- **Non fait / reporté** : voir « Reports connus ». Aucune base personnelle, aucun VPS, aucun catalogue distant modifié.
- **Décisions ajoutées** : DECISIONS.md, section « Première mission — étapes 2 et 3 ».
- **Prochaine action** : étape 4 — invalidation immédiate, versionnement des réponses du worker, annulation, état « Recalcul… » ; tests dans `web/src/store/`.
