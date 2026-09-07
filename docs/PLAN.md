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
| 5 | Chronologie et conditions | Comparaison exacte à l'oracle sur 5 + pioche ; mêmes règles dans tous les consommateurs ; ET/OU testés | ✅ Terminée le 7 sept. 2026 — partie A (moteur : contexte unique, sixième identifiée, profils, plafonds partagés, ET/OU ; oracle étendu + oracle Monte Carlo) et partie B (migration additive `002-profiles-and-conditions.sql`, profils/plafonds au compte, conditions ET/OU par deck, invalidation des résumés à toute modification globale, réglage unique premier/second, sixième carte distinguée, « départs théoriques », Excel et comparateur relibellés) ; 150 tests web, 6 serveur, 10 PostgreSQL. |
| 6 | Configuration, création et mobile | Même deck métier depuis création/import ; erreurs explicites ; actions et sélections utilisables aux largeurs retenues | ⬜ Non commencée |
| 7 | Comparateur et exports | Matrices côte à côte sur mobile, deltas non arrondis, données identiques entre analyse/Excel/comparateur | ⬜ Non commencée |
| 8 | Déploiement | Scripts dans /deploy, inventaire et simulation, purge exacte annoncée, contrôles après migration et restauration testée | ⬜ Non commencée |

## Reports connus (à reprendre dans l'étape indiquée)

- Étape 6 : tolérances silencieuses du parseur YDK et du constructeur ; validation visuelle au navigateur des états « Recalcul… » / obsolète de l'étape 4 (livrée sans DOM), de l'atténuation des deltas de la grille, et de l'étape 5B (mode Profil, menu ⋯ profil/plafond, éditeur d'arbre ET/OU, badge « ? », réglage unique, sixième carte du mur).
- Étape 7 : validation responsive du comparateur et du mur de mains ; l'éditeur d'arbre ET/OU n'a pas de mise en page dédiée pour un arbre plus profond que « ET de clauses, OU de feuilles » (seul cas produit par l'interface).
- Étape 8 : purge des anciennes paires (`combo_pairs`, `deck_pair_exclusions`, `deck_start_requirements` source paire) et de `deck_requirements` (convertie par la migration 002, plus lue), suppression de `nonengine_categories.relevance` (sans effet depuis 5B), sauvegarde/restauration VPS testées, adaptation de `prune-stale-cards` aux tables v2 et 5B (`deck_conditions.condition` en JSON, `card_flags.group_id` ; un report pendant annule toute la transaction).
- Hors étape : recalcul des aperçus de l'accueil avec une version fiable, sans cache faisant autorité.

## Compte rendu de la dernière étape

À mettre à jour en fin de chaque tâche (remplacer le contenu, l'historique reste dans docs/etapes-*.md et git).

- **Date** : 7 septembre 2026.
- **Étape** : 5, partie B — détail dans docs/etape-5b.md ; réponses Q1–Q7 appliquées (docs/etape-5a.md, « Réponses »).
- **Livré** : migration additive `db/migrations/002-profiles-and-conditions.sql` (profil `card_flags.availability` et plafond `nonengine_groups`/`card_flags.group_id` au compte, `deck_conditions` jsonb par source de start au deck ; conversion de chaque source de `deck_requirements` en un groupe ET ; horizons retirés des params ; résumés invalidés ; aucun profil deviné ; rejeu sans effet), montée dans les Compose et rejouée par `deploy.sh` ; contrat `Configuration.conditions` (arbre validé, une condition par source ; `requirements` refusé par l'API, converti explicitement pour archives et brouillons) ; routes profils/plafonds et invalidation de `decks.summary` des decks concernés à toute écriture de bibliothèque ; moteur sans horizon ni pertinence (étiquette sans profil = zéro, copies brutes comptées ; double représentation refusée) ; `buildEngineModel` pose profils, plafonds, conditions et liste `unprofiledCardIds` ; interface : réglage unique premier/second (store `context`), sixième carte cerclée « 6ᵉ » dans le mur, « départs théoriques » avec explication, mode Profil (D), menu ⋯ profil/plafond, gestion des plafonds, éditeur d'arbre ET/OU, avertissement des cartes sans profil ; comparateur et Excel relibellés.
- **Vérifications exécutées** : `npm run typecheck`, `npm run build` (avertissement ExcelJS attendu), `node scripts/test-quiet.mjs` (150 tests web dont 10 nouveaux, 6 serveur) ; suite PostgreSQL jetable (10 tests, dont migration 002 : refus sans 001, rollback complet sur ligne invalide, conversion, rejeu) ; état de départ vérifié (140 web, 4 serveur ; 7 PostgreSQL rejoués dans la suite étendue). Conteneur jetable arrêté et supprimé.
- **Non fait / reporté** : aucun test React ni navigateur (validation visuelle regroupée à l'étape 6) ; `prune-stale-cards` ignore encore `deck_conditions` (JSON) et `card_flags.group_id` (étape 8) ; `nonengine_categories.relevance` et `deck_requirements` conservées jusqu'à l'étape 8 ; contexte d'analyse non enregistré avec le deck. Aucune base personnelle, aucun VPS, aucun catalogue distant modifié.
- **Décisions ajoutées** : DECISIONS.md, section « Première mission — étape 5, partie B » ; résumé dans docs/decisions-compressees.md ; procédure dans deploy/configuration-v2.md.
- **Prochaine action** : étape 6 (configuration, création et mobile) — commencer par la validation visuelle des états des étapes 4 et 5B, puis les tolérances du parseur YDK et du constructeur.
