# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

AGENTS.md (importé ci-dessus) est la source unique des commandes, des règles et des pièges :
ne rien recopier ici. Ce fichier n'ajoute que ce qu'il ne dit pas.

## Langue

Tout le projet est en français : documentation, commentaires, interface, messages de commit
(Conventional Commits en français, vérifiés par commitlint). Écris de même. Le paquet npm
s'appelle encore `ygo-proba` ; le produit, lui, s'appelle Testhand.

## Consignes locales non citées par AGENTS.md

| Avant de modifier | Lis d'abord |
| --- | --- |
| `web/**` | `web/AGENTS.md` (pureté du moteur, oracles, worker, store, brouillons) |
| `admin/**` | `docs/backoffice.md`, `docs/design-backoffice.md` (site .NET, hors workspaces npm) |

`server/AGENTS.md` et les documents de `docs/` sont, eux, appelés par les règles d'AGENTS.md.

## Carte mentale (détail : docs/architecture.md)

Une application à **un seul moteur de calcul** et **deux canaux d'écriture**, le reste en découle.

- **Calcul** : `store/deckStore.ts` → `lib/engineModel.ts` (deck + bibliothèque effective →
  `EngineInput`) → `worker/computeClient.ts` → `engine/` (exact, par énumération) → `EngineResult`.
  Tout ce qui affiche des chiffres (stats, matrice, mode Requête, mur de mains, comparateur,
  fiche de side) lit ce résultat ou rejoue le même chemin ; rien ne recalcule par carte.
- **Canal deck** : composition, starters, paires, conditions, params, plans de side → bouton
  Enregistrer → `PUT /api/decks/:id` avec `expectedRevision` (écriture complète en une transaction).
- **Canal compte** : bibliothèque (HOPT, non-engine, profils, plafonds, références communes) →
  `/api/library/*` et `/api/references/*`, écriture immédiate, sans Enregistrer.
  Ne jamais mélanger les deux canaux dans une même action.
- **Bibliothèque effective** = choix du compte > référence commune > détection automatique
  (`server/src/domain/cardDefaults.ts` + `web/src/lib/effectiveLibrary.ts`) : c'est elle, jamais
  l'état brut de la bibliothèque, qui alimente le moteur.
- **Caches d'affichage versionnés**, jamais sources de vérité : `decks.summary` (aperçus de
  l'accueil) et `deck_side_plans.summary` (chiffres d'un plan). Ils sont invalidés par
  `__ENGINE_VERSION__`, empreinte calculée dans `web/vite.config.ts` sur les fichiers qui
  déterminent un résultat — la liste exacte est dans ce fichier, c'est elle qui fait foi.
- **Pur / impur** : `web/src/engine/`, `server/src/domain/` et les modules purs de `web/src/lib/`
  sont testables sans DOM, sans réseau, sans pg ; c'est là que vivent les invariants métier.
  Les contrats de `server/src/domain/` sont importés par le web **par chemin relatif** : ils
  doivent rester sans dépendance Node/Fastify/pg.

## Couches de test (aucune n'en couvre une autre)

| Couche | Commande | Portée |
| --- | --- | --- |
| Unitaires | `node scripts/test-quiet.mjs` | Vitest `web/src/**/*.test.ts` + node:test `server/tests/*.test.ts` |
| Un fichier | `node scripts/test-quiet.mjs web/src/engine/engine.test.ts` | un ou plusieurs chemins, web ou serveur |
| Idem, en direct | `cd web && npx vitest run src/lib/sidePlan.test.ts` · `cd server && node --import tsx --test tests/cardImage.test.ts` | sortie complète, utile pour déboguer |
| Intégration PostgreSQL | `npm run test:integration -w server` | base jetable 55433, jamais celle de dev |
| Navigateur | `npm run e2e -w web` | pile jetable complète, hors `npm test` |
| Back-office | `dotnet test admin/Testhand.Admin.slnx -c Release` · `node admin/e2e/run.mjs` | .NET, pile jetable propre |

`npm test` ne lance PAS les mêmes fichiers serveur que `test-quiet.mjs` : la cible `test` de
`server/package.json` énumère explicitement ses fichiers, `test-quiet.mjs` balaie tout
`server/tests/`. Après une modification ciblée, lance le seul fichier concerné ; la suite complète
seulement avant de conclure.
