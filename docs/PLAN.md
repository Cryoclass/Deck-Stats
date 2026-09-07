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
| 6 | Configuration, création et mobile | Même deck métier depuis création/import ; erreurs explicites ; actions et sélections utilisables aux largeurs retenues | 🟡 Partie A terminée le 7 sept. 2026 (tag `etape-6a-ok`) — inventaire Y1–Y8 / P1–P5 / C1–C6 tranché : parseur YDK et collage rapportent lignes ignorées, en-têtes inconnus et quantités hors convention sans jamais réduire, aperçu d'import avec décision explicite, constructeur qui refuse hors 1–3, messages serveur rendus tels quels, ids catalogue stricts ; test d'équivalence création / YDK / JSON v2 ; 164 tests web, 7 serveur, 10 PostgreSQL. Partie B (validation visuelle, mobile 360 / 390 / 768) à faire depuis docs/etape-6.md. |
| 7 | Comparateur et exports | Matrices côte à côte sur mobile, deltas non arrondis, données identiques entre analyse/Excel/comparateur | ⬜ Non commencée |
| 8 | Déploiement | Scripts dans /deploy, inventaire et simulation, purge exacte annoncée, contrôles après migration et restauration testée | ⬜ Non commencée |

## Reports connus (à reprendre dans l'étape indiquée)

- Étape 6, partie B (plan validé dans docs/etape-6.md) : validation visuelle au navigateur des états « Recalcul… » / obsolète de l'étape 4 (livrée sans DOM), des deltas de la grille pendant l'état périmé (Q3 : trancher d'après le §6 du contrat, l'étape 4 les a laissés sans atténuation par tuile), de l'étape 5B (mode Profil, menu ⋯ profil/plafond, éditeur d'arbre ET/OU, badge « ? », réglage unique, sixième carte du mur) et de l'aperçu d'import de 6A ; mobile aux largeurs 360 / 390 / 768 px avec cibles tactiles 32 px (stepper, menu ⋯, actions primaires) et 24 px ailleurs, largeurs à inscrire dans docs/regles-metier.md.
- Étape 7 : validation responsive du comparateur et du mur de mains ; l'éditeur d'arbre ET/OU n'a pas de mise en page dédiée pour un arbre plus profond que « ET de clauses, OU de feuilles » (seul cas produit par l'interface).
- Étape 8 : purge des anciennes paires (`combo_pairs`, `deck_pair_exclusions`, `deck_start_requirements` source paire) et de `deck_requirements` (convertie par la migration 002, plus lue), suppression de `nonengine_categories.relevance` (sans effet depuis 5B), sauvegarde/restauration VPS testées, adaptation de `prune-stale-cards` aux tables v2 et 5B (`deck_conditions.condition` en JSON, `card_flags.group_id` ; un report pendant annule toute la transaction).
- Hors étape : recalcul des aperçus de l'accueil avec une version fiable, sans cache faisant autorité.

## Compte rendu de la dernière étape

À mettre à jour en fin de chaque tâche (remplacer le contenu, l'historique reste dans docs/etapes-*.md et git).

- **Date** : 7 septembre 2026.
- **Étape** : 6, partie A — plan complet, inventaire et compte rendu dans docs/etape-6.md ; réponses Q1, Q2, Q5 appliquées, Q3 et Q4 reportées à la partie B.
- **Livré** : parseur YDK et collage (`ParseReport` : quantités brutes jamais réduites, lignes ignorées avec numéro, en-têtes inconnus, cartes hors convention ; passcode entier strict ; formes « 3x id » et « 3 id ») ; aperçu d'import « Vérifier l'import » avec décision explicite (main vide, quantités → 3, lignes ignorées, en-têtes, passcodes inconnus du catalogue conservés, catalogue indisponible) ; constructeur qui refuse hors 1–3 avec motif (`addCard`/`setCopies` renvoient `false`, dialogue « ×3 · max ») ; message serveur rendu à la création, `parseDeckJson` qui lève le motif exact, `GET /api/cards?ids=` strict (400) ; test d'équivalence création manuelle / YDK / JSON v2 (modèles identiques après ordre canonique, agrégats identiques sur le modèle non trié).
- **Vérifications exécutées** : `npm run typecheck`, `npm run build` (avertissement ExcelJS attendu), `node scripts/test-quiet.mjs` (164 tests web dont 14 nouveaux, 7 serveur dont 1 nouveau) ; suite PostgreSQL jetable (10 tests rejoués) ; contrôle par mutation, 5 erreurs volontaires toutes détectées (tableau dans docs/etape-6.md). Conteneur jetable arrêté et supprimé.
- **Non fait / reporté** : partie B (validation visuelle au navigateur, mobile 360 / 390 / 768, Q3 sur les deltas périmés, largeurs à inscrire dans regles-metier.md) ; création manuelle limitée au main (Q2, limite consignée) ; aucun test React ni navigateur pour l'aperçu d'import. Aucune base personnelle, aucun VPS, aucun catalogue distant modifié.
- **Décisions ajoutées** : DECISIONS.md, section « Première mission — étape 6, partie A » ; résumé dans docs/decisions-compressees.md.
- **Prochaine action** : étape 6, partie B, dans une nouvelle session à partir de docs/etape-6.md (points 3 et 4, infrastructure jetable sur 55434, `playwright-core` dans le scratchpad).
