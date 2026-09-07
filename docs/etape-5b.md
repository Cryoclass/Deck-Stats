# Étape 5, partie B — migration, interface et exports

Livrée le 7 septembre 2026. Cible : les sections 1 (portée des annotations), 3
(contexte d'analyse, profils, plafonds) et 4 (conditions ET/OU) du
[contrat métier](regles-metier.md), et les réponses Q1–Q7 de
[l'étape 5A](etape-5a.md). L'application calcule désormais avec les règles du moteur
livré en partie A ; le modèle historique (pertinence de catégorie, horizons 1–3) n'existe
plus, ni dans le moteur, ni dans la base, ni dans l'interface.

## Livré

### Migration additive `002-profiles-and-conditions.sql`

Selon le tableau de portée du contrat (§1) :

| Objet | Portée | Stockage |
| --- | --- | --- |
| Profil de disponibilité | Compte | `card_flags.availability` (`early` / `flexible` / `prepared` / `breaker`, nullable) |
| Plafond partagé par tour | Compte | `nonengine_groups (id, owner_id, name, cap_per_turn)` ; `card_flags.group_id` (FK, `on delete set null`) ; contrainte `group_id is null or availability is not null` (Q2) |
| Condition ET/OU d'une source de start | Deck | `deck_conditions (deck_id, id, source_card_id ⊕ source_pair_id, condition jsonb)` ; une condition par source (unicités), FK composite vers `deck_combo_pairs` |

Effets sur les données, une seule fois (journal `app_migrations`, verrou consultatif,
transaction) : chaque groupe de lignes `deck_requirements` d'une même source devient
**un groupe ET** de feuilles `{ kind: 'remaining', card_id, at_least }` dans l'ordre
des identifiants, nommé par le premier (Q3) ; les horizons sont retirés de
`decks.params` ; `decks.summary` est invalidé pour tous les decks (Q5 change le
potentiel). Aucun profil ni plafond n'est créé (Q2, Q4 : redéfinition manuelle) ;
`deck_requirements` est conservée mais plus jamais lue ni écrite (purge à l'étape 8).
La migration exige 001, refuse une ligne v2 invalide en annulant aussi le DDL, et se
rejoue sans effet. Montée dans les deux Compose et rejouée par stdin dans `deploy.sh`.

### Contrat de domaine et API

- `Configuration.conditions` remplace `requirements` : `{ id, source_card_id,
  source_pair_id, condition }`, arbre validé (`validateCondition` : opérateur connu,
  groupe non vide, quantité entière ≥ 1, profondeur ≤ 8, ≤ 64 feuilles), une condition
  par source. `params` ne connaît plus `horizonFirst/Second`.
- **Une seule représentation** (Q3) : `PUT /api/decks/:id` refuse un document portant
  `requirements` (400 « format antérieur », le client périmé doit recharger) ; les
  archives JSON et brouillons IndexedDB antérieurs sont convertis explicitement par
  `upgradeConfiguration`, avec exactement la règle de la migration.
- Bibliothèque : `GET /api/library` renvoie `profiles` et `groups` ;
  `PUT /api/library/flags/:cardId` accepte `is_hopt`, `availability`, `group_id`
  (champs absents inchangés ; retirer le profil retire le plafond) ; profil sur une
  carte sans étiquette → 400 (Q1) ; plafond sans profil → 400 depuis la contrainte SQL
  (Q2) ; `POST/PATCH/DELETE /api/library/groups`. Les catégories n'ont plus de
  pertinence (Q4) : `relevance` reste en base avec `'both'`, jamais renvoyée ni lue.
- **Invalidation des statistiques des decks concernés** : toute écriture globale
  (HOPT, profil, plafond, étiquette, affectation) met `decks.summary` à NULL pour les
  decks du compte contenant la carte, ou pour tous les decks du compte quand le
  changement n'est pas lié à une carte (catégorie, plafond) ; jamais un autre compte.
  Dans l'éditeur, le recalcul suit l'acquittement serveur (étape 4) et `resultContext`
  porte la liste des cartes sans profil du calcul affiché.
- Import JSON : fusion des profils et plafonds avec la bibliothèque ; profil
  contradictoire, plafond de même nom à limite différente ou HOPT contradictoire font
  échouer tout l'import (409), comme à l'étape 3.

### Moteur

- `EngineInput` n'a plus `horizonFirst/Second` ; `EngineCategory` n'a plus de
  `relevance` ; `CategoryDist.relevant` disparaît. Un type est non-engine s'il est
  **étiqueté et profilé** ; étiqueté sans profil = zéro contribution retenue, copies
  brutes comptées (Q5) ; profilé sans étiquette = zéro (Q1). Les signatures sont
  identiques dans les deux contextes.
- `prepare` refuse une source portant à la fois d'anciens `starterPrereqs`/`edgePrereqs`
  et une `Condition` (« une seule représentation attendue ») ; chaque représentation
  seule reste évaluable (les tests historiques §F utilisent l'ancienne).
- `scenarioCounts` : N = copies étiquetées, identique par scénario (composition, pas
  activations).

### Interface

- **Réglage unique premier/second** dans l'en-tête (« Premier · 5 » / « Second · 5 +
  pioche »), porté par le store (`context`) et repris par les deltas de la grille, la
  matrice, les colonnes de statistiques, la requête et le mur de mains, qui n'a plus de
  scénario local ; le bouton « delta 1st/2nd » et les steppers d'horizon disparaissent.
- **Sixième carte** : dans le mur de mains en second, la dernière carte porte un anneau
  et une pastille « 6ᵉ », avec une légende « sixième carte = pioche ».
- **« Départs théoriques »** remplace « starts jouables » : vue du panneau (avec une
  explication courte sous le titre), sujet de requête, matrice « départs théoriques ×
  non-engine », récapitulatif du mur, agrégats du comparateur et de l'Excel, avec
  info-bulle : sources de start disponibles dans la main observée, sans preuve de ligne.
- **Profils** : mode d'annotation « Profil » (touche D, déroulant des quatre profils +
  retrait), qui ignore et compte les cartes sans étiquette (Q1) ; menu ⋯ de la carte
  (profil, plafond partagé proposé seulement à une carte profilée, Q2) ; badge de
  profil sur la tuile et badge « ? » ambre sur une carte étiquetée sans profil.
- **Plafonds partagés** : gestion dans « Combos & catégories » (nom, limite par tour,
  membres) ; sections par profil et par plafond dans l'inventaire, plus un filet
  « Étiquetées sans profil — non comptées ».
- **Conditions ET/OU** : éditeur d'arbre (`ConditionEditor`) dans l'inventaire (sources
  carte) et sous chaque paire : feuilles « ▤ carte ≥ n », « ou… » sur une feuille,
  « ＋ ou… » sur un groupe, « ＋ et… » à la racine ; le mode « Condition » de la grille
  ajoute une clause ET ou retire la carte de l'arbre. Un groupe vidé disparaît ; une
  racine vidée rend la source inconditionnelle : l'éditeur ne peut pas produire le
  groupe vide, que le serveur refuse de toute façon.
- **Avertissement Q5** dans le panneau (« N cartes non-engine sans profil, non
  comptées dans le potentiel : … »), avec le résultat qui les connaît, et dans le
  comparateur (avertissement par deck).
- Comparateur et Excel : scénarios nommés « Premier · 5 cartes » / « Second · 5 cartes +
  pioche », en-têtes « départs \ ne », N = copies étiquetées, plus d'avertissement
  d'horizons.

## Preuves

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/test-quiet.mjs
# PostgreSQL jetable (deploy/configuration-v2.md)
$env:TEST_DATABASE_URL = 'postgres://step23:step23-disposable@127.0.0.1:55433/step23'
npm.cmd run test:integration -w server
```

Résultats : **150 tests web** (11 fichiers ; état de départ 140), **6 tests serveur**
(état de départ 4), **10 tests PostgreSQL** (état de départ 7) ; build vert avec
l'avertissement ExcelJS attendu ; conteneur `testhand-step23-tests` arrêté et supprimé.

- **Migration 002** ([persistence.integration.ts](../server/tests/persistence.integration.ts)) :
  refus sans 001 ; ligne v2 invalide (contrainte retirée pour l'injection) → rollback
  complet, DDL compris ; application ; conversion vérifiée (source carte à deux
  prérequis → un ET de deux feuilles dans l'ordre des identifiants, source paire →
  condition de paire, deck de l'étape 3 converti aussi) ; horizons retirés, résumés
  invalidés, quatre lignes `deck_requirements` conservées ; **rejeu** sans effet ;
  aucun profil ni plafond créé ; ancien format refusé par l'API.
- **Routes** : profils/plafonds (Q1, Q2, HOPT indépendant, mise à jour partielle,
  retrait du profil = retrait du plafond, suppression d'un plafond = profil conservé,
  autre compte → 404), invalidation des résumés (decks contenant la carte ; tous les
  decks du compte pour une catégorie ou un plafond ; jamais un autre compte), import
  avec profils et plafonds et deux conflits 409 sans écriture, duplication d'une
  condition de paire remappée, deux conditions sur une source et groupe vide → 400.
- **Contrat** ([configuration.test.ts](../server/tests/configuration.test.ts)) :
  validation des arbres (opérateur, groupe vide, quantité, profondeur), refus de
  l'ancien format, conversion exacte des archives et brouillons, archives avec profils.
- **Web** : `engineModel.test.ts` (profils, plafonds, groupes supprimés, conditions
  de carte et de paire, cible absente, cartes sans profil transmises sans profil et
  comptées zéro ; opérations pures sur l'arbre), `deckArchive.test.ts` (aller-retour
  avec conditions ET/OU, profils et plafonds ; conversion explicite des anciens
  fichiers et brouillons), `persistence.test.ts` (clics = clauses ET, dernière feuille
  retirée = source inconditionnelle, gardes Q1/Q2 locales, profil sans marquage sale),
  `recompute.test.ts` (`unprofiledCardIds` dans le contexte du résultat, copies brutes
  comptées et potentiel nul sans profil).
- **Moteur** : `engine.test.ts` (ancien bloc « horizon » remplacé par « étiquette et
  profil » : mêmes valeurs dérivées d'un profil flexible, étiquette sans profil = 0,
  ancien champ d'horizon sans effet, HOPT sans effet sur les starts), `chronology.test.ts`
  Q3 réécrit vers le refus, Q4/Q5 ; ponts B02–B04 et `rules.test.ts` inchangés et verts ;
  `oracle.ts` intact.

## Limites

- Aucun test React ni navigateur : l'éditeur d'arbre, le mode Profil, les badges et le
  réglage unique sont prouvés au niveau du store, des aides pures et des libellés ; la
  validation visuelle reste regroupée avec l'étape 6.
- L'éditeur d'arbre couvre ET de clauses et OU de feuilles (deux niveaux, le cas du
  contrat) ; un arbre plus profond importé par JSON est affiché et éditable par les
  mêmes gestes, sans mise en page dédiée.
- `prune-stale-cards` ne reporte pas encore les identifiants contenus dans
  `deck_conditions.condition` (JSON) ni `card_flags.group_id` (report déjà prévu pour
  les tables v2 à l'étape 8).
- `nonengine_categories.relevance` reste en base (`'both'` pour les nouvelles) sans
  effet ; sa suppression relève de l'étape 8.
- Le contexte d'analyse n'est pas enregistré avec le deck (réglage d'affichage,
  « premier » à l'ouverture).

## Passation

- Décisions dans DECISIONS.md, section « Première mission — étape 5, partie B » ;
  résumé dans docs/decisions-compressees.md ; procédure de migration dans
  deploy/configuration-v2.md.
- Pour une base existante, jouer 001 puis 002 par stdin, app arrêtée ; `deploy.sh` le
  fait. Les anciens exports JSON restent importables (conversion explicite) ; un client
  ouvert avant le déploiement reçoit 400 à l'enregistrement et doit recharger, son
  brouillon est converti à la réouverture.
- Le mode « Profil » n'annote que des cartes déjà étiquetées : poser d'abord les
  étiquettes (mode N), puis les profils (mode D), puis les plafonds (menu ⋯).
- Conteneur PostgreSQL jetable : `docker run … --rm --tmpfs …` ; un second passage exige
  de recréer le conteneur (la suite refuse une base non vide).
