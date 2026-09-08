# Étape 8 — déploiement

Résultat attendu (docs/PLAN.md) : scripts dans /deploy, inventaire et simulation, purge
exacte annoncée, contrôles après migration, restauration testée. L'étape 7 (commit
`493822b`, tag `etape-7-ok`) est acceptée.

Découpage validé le 8 septembre 2026 :

- **8A** (cette session, entièrement en local) : points 1 et 2 — inventaire prouvé du modèle
  historique, migration 003 de purge, adaptation de `prune-stale-cards` aux tables v2,
  suite `purge.integration.ts`, décision D1 sur `schema.sql`, harnais ; rapport de
  simulation produit sur le dump réel de production.
- **8B** (nouvelle session) : points 3, 4 et 5 — sauvegarde et restauration vérifiées,
  répétition complète sur le dump réel avec recalcul, `deploy.sh` et runbook.
- **8C** : exécution sur le VPS avec le runbook, pilotée par l'utilisateur.

Règle absolue : aucune commande vers le VPS, aucune connexion SSH, aucune base
personnelle ; tout se joue sur des conteneurs jetables. Le dump de production n'est jamais
commité ni copié dans le dépôt (`*.sql.gz` ignoré).

## Plan validé (8 septembre 2026)

### Constats de départ

- La production n'a reçu aucun déploiement depuis l'étape 1 : schéma pré-001, ancienne API
  en service, qui écrit encore les tables historiques. En 8C, 001, 002 et 003 se jouent à
  la suite, app arrêtée (confirmé, Q4).
- `db/schema.sql` est rejoué à chaque déploiement **avant** les migrations : sans changement,
  il recréerait les tables historiques vides après leur suppression, et ses bascules
  d'unicité et retraits de FK échoueraient sur une table absente.
- La migration 001 lit `deck_start_requirements` et `card_flags.dead_*` sur une base
  neuve : ces objets doivent encore exister à l'initialisation. 001 et 002 ne changent pas.
- Un `deploy/backup.sh` existe et tourne en cron (17 3 \* \* \*, journal `~/ygo-backup.log`,
  archives `ygo-AAAAMMJJ-HHMMSS.sql.gz` d'environ 1,5 Mo, dernière réussie le 8 septembre
  2026) : à étendre en 8B, pas à doubler.
- Dump réel de production pris le 8 septembre 2026 (pg_dump plain gzippé, 14 tables,
  catalogue inclus, aucune table de journal), hors dépôt :
  `C:\Users\ccrepin\Documents\Gitlab\testhand-dumps\ygo-prod-2026-09-08.sql.gz`.

### Point 1 — inventaire prouvé du modèle historique

Catalogue relevé sur un PostgreSQL 17 jetable (127.0.0.1:55435, supprimé ensuite) après
schéma + 001 + 002 : 20 tables, aucune vue, aucun trigger, aucune fonction dépendante.
Références de code par grep (fichiers de test cités à part).

| Reste | Défini dans | Encore lu ou écrit par | Converti par 001 / 002 | Sort dans 003 |
| --- | --- | --- | --- | --- |
| Table `combo_pairs` : id, owner_id, card_a_id, card_b_id, note ; `combo_pairs_pkey`, unique `combo_pairs_owner_pair`, check `combo_pairs_check` (a ≤ b), FK `combo_pairs_owner_id_fkey` → users | schema.sql (création, bascule d'unicité, retrait des FK catalogue) | API : rien, `POST/DELETE /library/pairs` → 410. Scripts : `adopt-legacy.ts` (bascule d'unicité), `prune-stale-cards.ts` (report). Test : persistence.integration.ts (fixture « Keep until purge ») | Jamais, par décision de l'étape 3 (aucune paire locale créée depuis une paire globale, JSON v1 refusé) | Purge annoncée ligne par ligne (compte, cartes nommées, note, exclusions et prérequis rattachés), `drop table` |
| Table `deck_pair_exclusions` : deck_id, pair_id ; PK, FK deck cascade, FK `deck_pair_exclusions_pair_id_fkey` → combo_pairs cascade | schema.sql | API : rien, `PUT /decks/:id/pair-exclusions` → 410. `prune-stale-cards.ts`. Test : persistence | Jamais (la désactivation v2 est `deck_combo_pairs.disabled`) | Purge annoncée, `drop table` |
| Table `deck_start_requirements` : id, deck_id, source_card_id, source_pair_id, required_card_id, min_in_deck ; PK, index `dsr_deck`, check XOR des sources, FK deck cascade, FK `deck_start_requirements_source_pair_id_fkey` → combo_pairs cascade | schema.sql | API : rien (410). Lue par 001 (lignes source carte). `prune-stale-cards.ts`. Test : persistence | Source carte → `deck_requirements` avec le même id (001), seulement les lignes présentes à ce moment ; source paire jamais copiée, par conception | Source carte : contrôle « id présent dans deck_requirements », sinon refus nominatif ; source paire : purge annoncée ; `drop table` |
| Table `deck_requirements` (v2 intermédiaire) : deck_id, id, source_card_id, source_pair_id, required_card_id, min_in_deck ; PK, trois checks, FK deck cascade, FK composite → deck_combo_pairs cascade | 001 | API : rien ; `parseConfiguration` refuse `requirements`, le dépôt lit `deck_conditions`. `prune-stale-cards.ts` (comptage). Test : persistence | → `deck_conditions` par 002, un groupe ET par (deck, source), id = premier id | Contrôle « (deck, source) porte une condition », sinon refus nominatif ; `drop table` |
| Colonne `nonengine_categories.relevance` : text not null, check `nonengine_categories_relevance_check` | schema.sql | Écrite par `account.ts` (seed), `decks.ts` (import), `library.ts` (création) ; jamais lue (`library.ts` sélectionne id, name, is_builtin ; `deckArchive.ts` l'ignore). Test : persistence (insert, absence dans la réponse) | Rien (5B, Q4 : étiquette pure) | Répartition rapportée, `drop column` (le check part avec), le serveur cesse de l'écrire |
| Colonnes `card_flags.dead_first`, `dead_second` | schema.sql | API : jamais lues ni écrites (`PUT /flags` refuse `dead_first`). Copiées par 001. Fusionnées par `prune-stale-cards.ts`. Test : persistence (fixture) | → `deck_flags` pour chaque deck du compte (001) | Lignes à drapeau vrai rapportées, `drop column` ×2 (Q5) |
| Clés `params.horizonFirst` / `horizonSecond` | aucune colonne | Refusées par `validateParams`, retirées des archives par `upgradeConfiguration` | Retirées par 002 | Contrôle « aucun deck n'en porte », sinon refus ; rien à supprimer |
| `decks.summary` | schema.sql | Cache mis à NULL à chaque écriture, renvoyé null | NULL par 001 et 002 | Conservée : recalcul des aperçus = étape 9 (Q9) |

`adopt-legacy.ts` reste tel quel : une base pré-comptes est forcément pré-001, l'outil
s'exécute avant 001 (Q10).

### Point 2 — migration 003 et prune-stale-cards

`db/migrations/003-purge-legacy.sql`, même mécanisme que 001/002 (transaction, verrou
consultatif, journal), sans aucun psql-isme :

1. Refus si 001 ou 002 n'est pas journalisée ; refus si un objet attendu manque.
2. Refus nominatif, sans rien modifier, sur donnée non convertie : prérequis historique
   source carte absent de `deck_requirements` ; prérequis v2 dont (deck, source) n'a pas de
   condition ; deck dont `params` porte encore un horizon.
3. Rapport ligne par ligne : `compte` (par compte), `P1` paires globales (cartes nommées
   depuis le catalogue, note, exclusions et prérequis rattachés), `P2` exclusions, `P3`
   prérequis source paire, `P4` prérequis v2 convertis (avec la condition qui les porte),
   `P5` pertinences, `P6` drapeaux ; comptages `avant` ; `résumé` ; `empreinte` (md5 des
   lignes P1–P6 triées). Émis par `select` (stdout) et par `raise notice` depuis la même
   table temporaire.
4. Point de non-retour : en mode réel, dès qu'une ligne est purgée, l'empreinte acceptée
   (`testhand.purge_accept`) doit égaler l'empreinte recalculée ; sinon refus. Rien à
   purger = aucune acceptation (base neuve).
5. Purge (suppressions explicites, `drop table` ×4, `drop column` ×3), effectifs des tables
   conservées comparés avant/après, absence des objets vérifiée, journal.
6. Simulation (`testhand.purge_mode = 'simulate'`) : les mêmes suppressions et contrôles
   dans une sous-transaction annulée volontairement (SQLSTATE `TH003` interne) ; fin
   normale, code 0, dernière ligne « SIMULATION TERMINÉE ». Tout échec reste une exception
   (code 3 sous psql) : message et code distincts, exigence de D2.
7. Rejeu : sans effet si journalisée ; refus si un objet historique est réapparu.

`prune-stale-cards.ts` : refus tant que 003 n'est pas journalisée ; emplacements v2
(`deck_combo_pairs` avec collision par deck et survivante non concernée, paire dégénérée
supprimée avec ses conditions comptées ; `deck_conditions.source_card_id`,
`source_pair_id` et feuilles `card_id` de l'arbre JSON en jsonpath **strict** ;
`deck_flags` fusionnés par OU ; `card_flags` avec profil et plafond repris s'ils manquent) ;
tout conflit non résoluble annule la transaction en nommant le conflit (Q6) ; contrôle
final étendu aux feuilles ; `--emit-sql` inline aussi le JSON d'une condition.

### Points 3, 4 et 5 — reportés en 8B

Point 3 : `backup.sh` étendu (archive horodatée, `.sha256`, vérification par restauration
dans `ygo_verify`, empreinte de données par table, `keep/` hors rétention pour les
archives pré-migration et pré-restauration) ; `restore.sh` réversible (sauvegarde de
sécurité, refus sans `.sha256`, empreinte comparée) ; test sur deux conteneurs jetables.
Point 4 : `rehearsal.sh` sur le dump réel (restauration, inventaire, sauvegarde, schéma,
001, 002, 003 simulée puis appliquée, contrôles, recalcul des decks comparé aux résumés
d'avant purge : `startRateFirst = 1 − brick`, `brickRate = brick` de la passe premier,
`mainSize`). Point 5 : `deploy.sh` (sauvegarde obligatoire, simulation, « OUI » interactif
plus `--accept <empreinte>`, contrôles, app démarrée sans 003 si le rapport est refusé)
et `docs/deploy-runbook.md` (copie de l'archive pré-migration hors VPS, empreinte
vérifiée, avant le point de non-retour).

### Décisions validées et réponses (8 septembre 2026)

- **D1** : section historique de `schema.sql` (trois tables, index, colonnes `dead_*`,
  bascule d'unicité de `combo_pairs`, retraits de ses FK catalogue) dans un bloc
  conditionnel « 003 non journalisée » ; `relevance` avec défaut `'both'` pour que l'API
  cesse de l'écrire sans casser la suite persistence, qui s'arrête à 002.
- **D2** : simulation par exécution réelle et annulation volontaire, GUC de session ;
  message et code de sortie distincts de tout échec, sur lesquels `deploy.sh` et
  `rehearsal.sh` s'appuieront (8B).
- **D3** : chaque sauvegarde vérifiée par restauration puis empreinte ; `restore.sh`
  réversible (8B).
- **Q1** tous les comptes, rapport par compte, acceptation = périmètre explicite. **Q2**
  `backup.sh` existant étendu, `keep/` hors rétention, copie hors VPS imposée par le
  runbook. **Q3** dump réel fourni (ci-dessus) ; jeu représentatif conservé pour les tests ;
  rapport P1 produit dès 8A et joint ci-dessous. **Q4** prod pré-001 confirmée. **Q5**
  `dead_first` / `dead_second` purgés. **Q6** refus total sur conflit. **Q7** « OUI »
  interactif + empreinte recalculée, `--accept` pour répétition et tests. **Q8** app
  démarrée sans 003 si le rapport est refusé. **Q9** `decks.summary` conservée. **Q10**
  `adopt-legacy.ts` conservé, avant 001 seulement.
- Mutations de 8A : M1, M3, M4, M5, M6 ; M2 (restauration sans empreinte) en 8B.

## Compte rendu 8A (8 septembre 2026)

### Livré

- [db/migrations/003-purge-legacy.sql](../db/migrations/003-purge-legacy.sql) : refus
  nominatifs, rapport, empreinte, acceptation, purge, contrôles avant/après, simulation
  annulée volontairement, rejeu défensif. Montée dans `docker-compose.yml` et
  `deploy/docker-compose.prod.yml` (`03-purge-legacy.sql`) ; appliquée par le harnais
  `web/e2e/run.mjs` (base neuve, rien à purger). **`deploy.sh` ne la rejoue pas encore**
  (8B) : exception assumée à la règle « nouvelle migration = rejeu dans deploy.sh ».
- [db/schema.sql](../db/schema.sql) : bloc « Modèle historique » conditionnel (D1),
  `relevance` avec défaut, retraits de FK et bascule de `combo_pairs` déplacés dans le
  bloc ; le reste du schéma est inchangé.
- Serveur : `account.ts`, `routes/decks.ts`, `routes/library.ts` n'écrivent plus
  `relevance` ; `BUILTIN_CATEGORIES` ne porte plus que le nom.
- [server/scripts/prune-stale-cards.ts](../server/scripts/prune-stale-cards.ts) : version
  v2 décrite au point 2.
- [server/tests/purge.integration.ts](../server/tests/purge.integration.ts), 10 tests,
  enchaînée après `persistence` par `npm run test:integration` ; fixture
  [legacy-representative.sql](../server/tests/fixtures/legacy-representative.sql) (base de
  production pré-001 : deux comptes, quatre decks, 19 cartes synthétiques, quatre paires
  globales dont une exclue, prérequis des deux sources dont deux sur la même source,
  drapeaux `dead_*`, catégories aux trois pertinences, horizons et requêtes dans `params` ;
  `summary` limité à `mainSize`, les taux d'avant purge seront fabriqués en 8B par le moteur
  sur le modèle équivalent). Faux Supabase HTTP local pour `prune-stale-cards` : aucun
  réseau. La suite réinitialise le schéma public de la base jetable, seulement si elle est
  vide ou porte les fixtures d'une suite du dépôt.
- Aucun test existant modifié. Harnais modifiés : `server/package.json`
  (`test:integration` enchaîne deux fichiers), `web/e2e/run.mjs` (003 appliquée).
- Documentation : AGENTS.md, server/AGENTS.md, docs/architecture.md, deploy/README.md,
  deploy/configuration-v2.md (section 003), DECISIONS.md, docs/decisions-compressees.md,
  docs/PLAN.md (étape 9 ajoutée avant le début des travaux, statut de 8A).
- `.gitignore` : `*.sql.gz`, `deploy/out/`.

Ce que le test prouve, dans l'ordre : `prune-stale-cards` refuse avant 003 ; 003 refuse
sans journal 002, sur prérequis historique non converti (nommé), sur prérequis v2 sans
condition (nommé), sur horizon résiduel (nommé), chaque fois sans rien modifier ; la
simulation rend 14 lignes à purger sur la fixture (P1 4, P2 1, P3 2, P5 5, P6 2, P4 3
converties), une empreinte déterministe, la ligne « SIMULATION TERMINÉE », et laisse tout
intact ; l'application refuse sans empreinte, avec une empreinte fausse, et avec la bonne
empreinte si une paire est apparue depuis ; avec la bonne empreinte elle purge exactement
les 14 lignes, garde 2 conditions (`e001` = ET de deux feuilles, `e003`), 61 cartes de
deck, 6 drapeaux par deck, 5 catégories, et l'API lit, enregistre, duplique et crée une
catégorie sans pertinence ; 003 se rejoue sans effet, `schema.sql` rejoué ne recrée rien,
une table `combo_pairs` recréée à la main fait refuser 003 ; `prune-stale-cards` reporte
un passcode périmé sur les dix emplacements (cartes cumulées, starters dédupliqués, paire
dégénérée supprimée avec sa condition, paire perdante fusionnée et sa condition reportée
sur la survivante, source et feuilles JSON réécrites y compris imbriquées, drapeaux et
profils fusionnés, `catalog_version` réalignée), conserve les orphelins sans cible sûre,
simule d'abord sans rien changer, écrit un SQL autonome contenant le JSON réécrit, puis
annule tout, état identique à l'empreinte près, quand deux conditions devraient fusionner
ou que deux profils se contredisent.

### Rapport de simulation sur le dump réel (8 septembre 2026)

Conteneur jetable `testhand-step8-dump` (127.0.0.1:55437), dump restauré tel quel, puis
`schema.sql`, 001, 002 (base pré-001 : 14 tables, aucun journal, 14 529 cartes, 1 compte,
16 decks, 663 lignes de deck, 105 starters, 122 drapeaux, 4 catégories, 16 decks avec
horizons, 16 résumés). Simulation de 003 : code 0, rien modifié (185 paires toujours en
base, journal à 001 et 002). Puis, toujours sur la copie jetable, application avec
l'empreinte : 204 lignes supprimées, `deck_conditions`, `deck_cards` et `deck_starters`
identiques avant et après (empreintes md5 des lignes triées), 16 tables restantes, aucun
objet historique, rejeu de 003 et de `schema.sql` sans effet. Conteneur supprimé.

Ce que 8C purgera, tel que le rapport le nomme (identifiants internes seulement, aucun
email ni nom de compte ; les 15 prérequis v2 convertis (P4) et les 4 pertinences (P5)
sont résumés par leurs effectifs ; aucune paire ne porte de note ; 14 paires sont exclues
dans au moins un deck) :

```text
compte | compte 70f2598f-858b-4ad8-b82f-48045111f1da : 185 paire(s) globale(s), 15 exclusion(s), 0 prérequis source paire, 16 deck(s)
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire edbee8c1-84b2-47bb-93c7-4d9fff4cf67d : 1111 « hors catalogue » + 2222 « hors catalogue » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire bd9a5cae-2eab-4290-9ee9-a5a0ba7e33e5 : 2526224 « Fire King High Avatar Kirin » + 44455560 « Fire King Courtier Ulcanix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 65394652-9645-44a8-9d8c-f414e3250bf4 : 2526224 « Fire King High Avatar Kirin » + 57554544 « Fire King Island » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b8f53a9a-c39f-4e3a-aed0-f256c6e0780e : 2526224 « Fire King High Avatar Kirin » + 65305978 « Fire King Sanctuary » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 90d8f05c-b3f1-4cfa-8901-7dfb61b612ee : 2526224 « Fire King High Avatar Kirin » + 66431519 « Sacred Fire King Garunix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 26208e62-8b79-4704-8348-fead0f4673e8 : 2526224 « Fire King High Avatar Kirin » + 90681088 « Legendary Fire King Ponix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 38deeacc-ef82-4519-bcfb-ab3ad32866d6 : 3422200 « Crystron Sulfefnir » + 25865565 « Crystron Sulfador » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire c69addcb-8571-489c-a87d-8629bf6d7c08 : 3422200 « Crystron Sulfefnir » + 28642461 « K9-66a Jokul » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 52816a65-bffd-4fe5-8d0a-b1832d6b95af : 3422200 « Crystron Sulfefnir » + 31552317 « Crystron Inclusion » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire bded53fd-bd5c-4125-9dd9-90045d99ef7f : 3422200 « Crystron Sulfefnir » + 53829527 « Crystron Cluster » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 58a3a296-21fb-4a39-b71a-d6f30dae40d6 : 3422200 « Crystron Sulfefnir » + 55031170 « K9-66b Lantern » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 5aa6c0dc-a22c-4752-aa19-fed84d719d0f : 3422200 « Crystron Sulfefnir » + 81439174 « hors catalogue » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire df78dd9d-34d1-4681-908d-f56412af0c5b : 3422200 « Crystron Sulfefnir » + 83443619 « Crystron Smiger » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 32027fc8-988d-4eb4-bfae-1f808ae97729 : 3422200 « Crystron Sulfefnir » + 99471856 « Crystron Tristaros » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 78f7c7e2-8d52-4406-97a3-5ec990ef938e : 3739500 « Ruler of the End of the World » + 13332685 « Ame no Habakiri no Mitsurugi » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b9ab551e-5563-477a-98f0-5c4cd8555247 : 3739500 « Ruler of the End of the World » + 19899073 « Ame no Murakumo no Mitsurugi » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 755d2be9-1e3e-4523-9359-9e73b96166f8 : 3739500 « Ruler of the End of the World » + 24461358 « Ragged Records of Rites » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire af78caab-a3e8-4205-86ad-c5441638cda4 : 3739500 « Ruler of the End of the World » + 55397172 « Futsu no Mitama no Mitsurugi » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 991fe8f5-4481-4654-b042-4c54f3b12faa : 10266279 « Junoldo the Shadespirit Power Patron » + 56651978 « Elfnote Regina » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 72ea75e8-ff70-40ba-94e2-b95e96f1211d : 10266279 « Junoldo the Shadespirit Power Patron » + 64491754 « Elfnotes: Welcome Home » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire a5a0c884-fe91-4d08-8bd0-d8eef238085d : 12375297 « Elfnote Power Patron » + 56651978 « Elfnote Regina » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 849d250e-f374-4b0b-a7d9-21318d135ceb : 12375297 « Elfnote Power Patron » + 64491754 « Elfnotes: Welcome Home » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire dd1bbe74-c364-4859-8318-edc82858ed84 : 12375297 « Elfnote Power Patron » + 85976588 « Elfnote Fortuna » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 7bb05950-3f26-489a-bc39-607d68a0d5da : 13048472 « Pre-Preparation of Rites » + 66328392 « Deception of the Sinful Spoils » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 6241b9ac-0b1b-481e-a63c-2af98ff3f4e9 : 13048472 « Pre-Preparation of Rites » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 1b49ed9d-c338-4168-b6a7-c2ff2948eb2c : 13332685 « Ame no Habakiri no Mitsurugi » + 18176525 « Mitsurugi no Mikoto, Saji » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 9421358e-4000-4273-a105-9c7311ecbad8 : 13332685 « Ame no Habakiri no Mitsurugi » + 66328392 « Deception of the Sinful Spoils » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 6322428f-5f1a-4fc5-8250-70f3cf5cc79f : 13332685 « Ame no Habakiri no Mitsurugi » + 81560239 « Mitsurugi Ritual » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire e389a5bc-dc92-4bd3-a2c1-544a5a1d02eb : 13597785 « Elfnote Lucina » + 56651978 « Elfnote Regina » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 7df22031-0f1f-43dc-8ddb-5ac4b473e3f6 : 13597785 « Elfnote Lucina » + 64491754 « Elfnotes: Welcome Home » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 1a0db04f-9527-4021-a364-1b98adb549c9 : 14558127 « Ash Blossom & Joyous Spring » + 27204311 « Nibiru, the Primal Being » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire f1961231-a020-4674-91d8-ea563412700f : 14558127 « Ash Blossom & Joyous Spring » + 44455560 « Fire King Courtier Ulcanix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 88fde411-1534-4887-a9c4-e56293deb76b : 14558127 « Ash Blossom & Joyous Spring » + 57554544 « Fire King Island » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 8ae714a6-796d-4000-bae5-ed108d32c34d : 14558127 « Ash Blossom & Joyous Spring » + 64491754 « Elfnotes: Welcome Home » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire ec73abe2-7ab6-4d02-9a21-4291d0ef8237 : 14558127 « Ash Blossom & Joyous Spring » + 65305978 « Fire King Sanctuary » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire c361b46c-dcc4-48a0-a910-18e13a34ec36 : 14558127 « Ash Blossom & Joyous Spring » + 66328392 « Deception of the Sinful Spoils » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire baf7cffa-0768-4cec-a163-62672929e473 : 14558127 « Ash Blossom & Joyous Spring » + 90681088 « Legendary Fire King Ponix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 0abe08dc-478a-4746-9671-36dfed890fc2 : 18176525 « Mitsurugi no Mikoto, Saji » + 19899073 « Ame no Murakumo no Mitsurugi » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire f5bc6bd3-bc9b-4e30-b02a-c2fb8467a55d : 18176525 « Mitsurugi no Mikoto, Saji » + 45171524 « Mitsurugi Prayers » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 52c65932-6463-448d-bb77-98346a8ce99a : 18176525 « Mitsurugi no Mikoto, Saji » + 55397172 « Futsu no Mitama no Mitsurugi » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire a96dfce6-f4a9-434e-a27e-0c1c929b1385 : 18176525 « Mitsurugi no Mikoto, Saji » + 66328392 « Deception of the Sinful Spoils » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire fba14f25-e4aa-4583-9de8-d434403956a0 : 18176525 « Mitsurugi no Mikoto, Saji » + 81560239 « Mitsurugi Ritual » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 1e3526b7-e66f-4f83-8fca-d7ac3ad03d7a : 18621798 « Fire King Avatar Arvata » + 44455560 « Fire King Courtier Ulcanix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b67a132f-16dc-4246-a8d5-974b1e7d0361 : 18621798 « Fire King Avatar Arvata » + 57554544 « Fire King Island » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 3eb0def5-e5ed-4db5-b1d7-fba67bb7ee91 : 18621798 « Fire King Avatar Arvata » + 65305978 « Fire King Sanctuary » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 7f4d64ce-e7a5-4113-97de-85767a5d65cb : 18621798 « Fire King Avatar Arvata » + 90681088 « Legendary Fire King Ponix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 1729d421-e9d2-4496-a55f-8fbb15ac5065 : 19096726 « Tri-Brigade Mercourier » + 29948294 « Branded in High Spirits » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 00f74096-0545-486f-a8b5-35a2831823f5 : 19304410 « Tri-Brigade Springans Kitt » + 29948294 « Branded in High Spirits » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire d6ad3565-4f0d-455d-ad2c-9b4c2e04fc6a : 19899073 « Ame no Murakumo no Mitsurugi » + 66328392 « Deception of the Sinful Spoils » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 764ef4c7-171c-409d-be03-7fe4f19c6fba : 19899073 « Ame no Murakumo no Mitsurugi » + 81560239 « Mitsurugi Ritual » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b3114dde-33a7-4471-a3cd-0bb46c53e400 : 22283204 « The Gaze of Timaeus » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire c87503c3-a34d-4612-8ef4-a50a71a37144 : 23015896 « Fire King High Avatar Garunix » + 44455560 « Fire King Courtier Ulcanix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 4cda07f2-a561-40f6-abcc-4071773f4672 : 23015896 « Fire King High Avatar Garunix » + 57554544 « Fire King Island » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 7ae1f21e-5d2e-471f-96a9-77a3e08945cf : 23015896 « Fire King High Avatar Garunix » + 65305978 « Fire King Sanctuary » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire f87e7757-66af-44bb-a230-05369e1e4ecd : 23015896 « Fire King High Avatar Garunix » + 90681088 « Legendary Fire King Ponix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 666792cb-a894-494b-9dcf-afc714753387 : 23720856 « Zubababancho Gagagacoat » + 55088578 « Onomatokage » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b4cc1d65-9186-4aa5-a0d5-d5e59d729c81 : 24088928 « Skull Archfiend of Chaos » + 29948294 « Branded in High Spirits » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 2dd04491-0c74-41d4-a942-084311fc747a : 24088928 « Skull Archfiend of Chaos » + 50073633 « Celtic Mystic » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 4890de8c-9de4-445c-a62e-0f14a198cf48 : 24088928 « Skull Archfiend of Chaos » + 66328392 « Deception of the Sinful Spoils » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 19bbc7a8-9d20-4e5a-b848-b3c36a3754d6 : 24088928 « Skull Archfiend of Chaos » + 95515789 « Blazing Cartesia, the Virtuous » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire d32b23a7-d215-4cc0-a601-f06da26720bd : 24092792 « Elfnotes: Rhapsodia of Madness » + 56651978 « Elfnote Regina » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b84c3e60-976f-4f33-8744-fc5cf83d5c6f : 24092792 « Elfnotes: Rhapsodia of Madness » + 64491754 « Elfnotes: Welcome Home » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire aa73a895-55f0-4a36-8932-7b846f6123b7 : 24224830 « Called by the Grave » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 049f80d2-8775-43c4-b9fa-95a702ad801c : 24461358 « Ragged Records of Rites » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b5d1bfbf-9470-4ef2-80ca-413322324380 : 24749710 « Mind Shuffle » + 50073633 « Celtic Mystic » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 371d3b61-f4b7-4097-b74e-e9eca10deab1 : 25451383 « Albion the Shrouded Dragon » + 29948294 « Branded in High Spirits » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 299d8f1c-69cc-46df-b723-ea08c60c5d6e : 25865565 « Crystron Sulfador » + 28642461 « K9-66a Jokul » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 163c00ec-aab6-4a66-bc28-f79ee0da2ebd : 25865565 « Crystron Sulfador » + 55031170 « K9-66b Lantern » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 36d3030c-2277-4056-873d-0c1f48833c42 : 25865565 « Crystron Sulfador » + 80181649 « "A Case for K9" » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 2fe7b32e-08da-47b6-9fc2-c2415d84e4ba : 25865565 « Crystron Sulfador » + 83443619 « Crystron Smiger » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 1e597362-4cf5-48e3-b077-e205e9d87c9f : 25865565 « Crystron Sulfador » + 92221402 « Chaotic Elements » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire c59ea7c4-8cbe-407e-adab-a6f3f78f5a52 : 25865565 « Crystron Sulfador » + 99471856 « Crystron Tristaros » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire c0f7015b-fd3a-4a77-ae01-2625c643850f : 26236560 « Unchained Twins - Aruha » + 27412542 « Abomination's Prison » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 81994493-8941-49d8-bffe-cdc83de5a3c0 : 26236560 « Unchained Twins - Aruha » + 31531914 « Unchained Ogre Shma » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire d4c08c84-1447-47a1-b728-1ad7d435d95d : 26236560 « Unchained Twins - Aruha » + 31588572 « Unchained Twins - Sarama » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 8cd243df-ce41-4928-9f03-5ef3cf228157 : 26236560 « Unchained Twins - Aruha » + 41165831 « Unchained Soul of Sharvara » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b6e2136c-0e97-4a0d-bd14-450ffc9b2e5b : 26236560 « Unchained Twins - Aruha » + 53417695 « Escape of the Unchained » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 45cf27b6-a72d-4f36-b0dd-e3edd289b420 : 26236560 « Unchained Twins - Aruha » + 53624265 « Unchained Twins - Rakea » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 979cd5c8-8e1e-410f-b936-d45421862e48 : 26236560 « Unchained Twins - Aruha » + 67803035 « Reincarnation of the Unchained » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire cc8ac8bf-cc97-4e25-b1d9-6902eabef6fc : 26236560 « Unchained Twins - Aruha » + 80801743 « Abominable Chamber of the Unchained » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire a8e3d177-1459-430f-9eaf-5068edf460c1 : 26236560 « Unchained Twins - Aruha » + 93898740 « Unchained Syncretism » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 2b955c3a-c485-42fd-8f9b-25c7aac0dfe5 : 26236560 « Unchained Twins - Aruha » + 95136979 « Unchained Ogre Shara » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire fccbf3ba-d450-4b9e-af6c-a7ccb844b516 : 27412542 « Abomination's Prison » + 53624265 « Unchained Twins - Rakea » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire ed69397d-9b4a-46fb-a268-179840342dc7 : 28642461 « K9-66a Jokul » + 55031170 « K9-66b Lantern » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire da8d8a77-5748-45fc-8ce6-bd3b1c6bedc8 : 28642461 « K9-66a Jokul » + 80181649 « "A Case for K9" » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 7e2fa2ef-97ac-4106-aeea-19c8300373e3 : 28642461 « K9-66a Jokul » + 91025875 « K9-ØØ Lupis » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 2daa5b5f-026e-434a-8d5c-0ae50bd00b40 : 28642461 « K9-66a Jokul » + 92221402 « Chaotic Elements » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 992972a8-599f-41e6-8403-1e9a5052f3e8 : 28642461 « K9-66a Jokul » + 92248362 « K9-17 Izuna » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire cb1bf754-c806-4373-b793-eb2933fee949 : 29948294 « Branded in High Spirits » + 42141493 « Mulcharmy Fuwalos » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 04ce38b2-04de-489a-8868-ed2d0e790321 : 29948294 « Branded in High Spirits » + 44001993 « Magician of Dark Chaos - Black Chaos » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 049ee48c-e74c-4240-aaba-4fc8d4652f0e : 29948294 « Branded in High Spirits » + 45883110 « Guiding Quem, the Virtuous » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 3db3bbee-a92c-4242-9d73-580df76d0e89 : 29948294 « Branded in High Spirits » + 55273560 « Incredible Ecclesia, the Virtuous » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 554fbfc0-d39d-45ad-ad1f-e7ab304379cd : 29948294 « Branded in High Spirits » + 60303688 « Dogmatika Ecclesia, the Virtuous » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire de4552f3-b336-41c9-b6a1-d67c34e36b05 : 29948294 « Branded in High Spirits » + 62962630 « Aluber the Jester of Despia » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 97a8a261-4fe2-4a99-8212-3f2eabe06f5f : 29948294 « Branded in High Spirits » + 68468459 « Fallen of Albaz » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire ab13a953-767f-408c-8b6d-e25f8003afd2 : 29948294 « Branded in High Spirits » + 70088809 « Fydraulis Harmonia » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire c5217c7c-9cf2-474c-9139-ca22e3780930 : 29948294 « Branded in High Spirits » + 70405001 « Black Luster Soldier - Soldier of Light and Darkness » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire d5cb9d3f-a525-4b09-a0e3-e830df41ba62 : 29948294 « Branded in High Spirits » + 73819701 « Fallen of the White Dragon » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 790108aa-4536-4830-bd53-5d3dab66f9e2 : 29948294 « Branded in High Spirits » + 82489470 « The Golden Swordsoul » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire d553d23e-bbd8-466b-892a-b231d5eef7e6 : 29948294 « Branded in High Spirits » + 95515789 « Blazing Cartesia, the Virtuous » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 76600662-f40a-49ae-8562-0c3e477cc285 : 29948294 « Branded in High Spirits » + 97462632 « Griffoh » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 957b37b7-8dd1-4d96-88ff-f9c7e17d9f3d : 29948294 « Branded in High Spirits » + 98684220 « Black Chaos » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 4090eb58-fe67-48de-b490-7eac73511a38 : 31531914 « Unchained Ogre Shma » + 41165831 « Unchained Soul of Sharvara » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 5473f4f5-c5c7-408e-951f-d4d76b961298 : 31588572 « Unchained Twins - Sarama » + 41165831 « Unchained Soul of Sharvara » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire f48d5bfd-b047-4283-9365-94fa40bc5a72 : 33599853 « Light and Darkness Ritual » + 44001993 « Magician of Dark Chaos - Black Chaos » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b582d64b-75c2-4c6d-a920-2d6f9c046466 : 33599853 « Light and Darkness Ritual » + 50073633 « Celtic Mystic » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 64400f9b-e1b4-4860-b8ee-a386139d6997 : 33599853 « Light and Darkness Ritual » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 98a98575-6fcd-4691-ac3c-6d5f3c134970 : 38572779 « Miscellaneousaurus » + 44455560 « Fire King Courtier Ulcanix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b9c688da-8085-4f8a-b668-05708e5c2e30 : 38572779 « Miscellaneousaurus » + 57554544 « Fire King Island » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 29ffef42-e513-4734-82a3-88ad3a8999eb : 38572779 « Miscellaneousaurus » + 65305978 « Fire King Sanctuary » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 4016b28a-ef93-442d-b3fd-0041c4f3c13f : 38572779 « Miscellaneousaurus » + 90681088 « Legendary Fire King Ponix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire f0729e9b-e041-4d9d-8d07-8e6b90b50385 : 40543231 « Mitsurugi no Mikoto, Aramasa » + 66328392 « Deception of the Sinful Spoils » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire df4047fb-6b93-4ac0-b250-4d72a1ced1b3 : 41165831 « Unchained Soul of Sharvara » + 53417695 « Escape of the Unchained » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 3b54eae5-52d6-4ec3-b636-a8e3c4a980a3 : 41165831 « Unchained Soul of Sharvara » + 53624265 « Unchained Twins - Rakea » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire e7150f40-fb1e-43d2-89ef-cb2c969ebd0d : 41165831 « Unchained Soul of Sharvara » + 80801743 « Abominable Chamber of the Unchained » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 14c0db1c-bd57-4280-9b6e-b95a1a57546c : 41165831 « Unchained Soul of Sharvara » + 93898740 « Unchained Syncretism » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire a164bbf3-e861-4764-be0b-667e082df387 : 41350417 « Dark Magical Curtain » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 18efce69-db3f-4c21-b9c4-50bc9edbe92c : 42141493 « Mulcharmy Fuwalos » + 64491754 « Elfnotes: Welcome Home » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire d3aa9c8a-b2d7-4813-9ea0-cc900efde72c : 42141493 « Mulcharmy Fuwalos » + 66328392 « Deception of the Sinful Spoils » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 902b4b45-876e-4f8b-abe1-b915da9f0a6e : 42141493 « Mulcharmy Fuwalos » + 90681088 « Legendary Fire King Ponix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire a26445bd-62e9-4e41-82e3-9750907a650d : 44001993 « Magician of Dark Chaos - Black Chaos » + 50073633 « Celtic Mystic » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 619abd9e-89d0-44ea-8433-38856343291f : 44001993 « Magician of Dark Chaos - Black Chaos » + 66328392 « Deception of the Sinful Spoils » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b85daf05-c0e1-4cc1-80cf-4eb830a4fae6 : 44001993 « Magician of Dark Chaos - Black Chaos » + 98684220 « Black Chaos » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 9a0b31ff-d049-4692-ba3f-3d421937e90f : 44455560 « Fire King Courtier Ulcanix » + 57554544 « Fire King Island » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 5cceebba-c135-4d79-8bc9-12833b39a791 : 44455560 « Fire King Courtier Ulcanix » + 65305978 « Fire King Sanctuary » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire da99982c-1406-4565-a3d2-b55c0fb41a90 : 44455560 « Fire King Courtier Ulcanix » + 66431519 « Sacred Fire King Garunix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 5acd3d86-54ba-40ee-b5e3-91c8a739176b : 44455560 « Fire King Courtier Ulcanix » + 90681088 « Legendary Fire King Ponix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 7f0577f7-040c-4c2f-8d98-e08149f072b0 : 44455560 « Fire King Courtier Ulcanix » + 93170499 « Jurrac Megalo » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire d4728fec-fa24-4fe0-9549-b97358d6e8df : 44455560 « Fire King Courtier Ulcanix » + 96594609 « Fire King Avatar Kirin » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 74eaf923-4396-4dbe-8b64-d03277bae106 : 45171524 « Mitsurugi Prayers » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire ccb3cb9a-c24c-441a-931c-428c42ad374f : 46986420 « Dark Magician » + 66328392 « Deception of the Sinful Spoils » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 1371a4bd-dbc5-4c65-a329-18b425be8827 : 49721684 « Mitsurugi Mirror » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 0ab01068-8fd4-4b72-bc9d-d0c365f1cf38 : 50073633 « Celtic Mystic » + 66328392 « Deception of the Sinful Spoils » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire dd537b79-6a09-4171-8cff-0a983cdf3d45 : 50073633 « Celtic Mystic » + 70405001 « Black Luster Soldier - Soldier of Light and Darkness » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 9a6a3028-b981-41a0-a2fc-1ffc7956b0d0 : 50073633 « Celtic Mystic » + 97462632 « Griffoh » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 564fdea2-75fe-4b60-b482-81c30a2c4f48 : 50073633 « Celtic Mystic » + 98684220 « Black Chaos » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 3b3b868e-18b7-487b-bdd5-6ef55b712cf7 : 53417695 « Escape of the Unchained » + 53624265 « Unchained Twins - Rakea » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 4df91b42-34c5-4bf7-a01e-41386464151a : 53624265 « Unchained Twins - Rakea » + 67803035 « Reincarnation of the Unchained » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire d29757db-3e4e-4312-b7a0-57820462f2c4 : 53624265 « Unchained Twins - Rakea » + 80801743 « Abominable Chamber of the Unchained » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 0395e383-7494-45e9-9131-394aaa6e1df2 : 53624265 « Unchained Twins - Rakea » + 93898740 « Unchained Syncretism » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire f1f8847b-e151-460b-be62-e6cacc257e43 : 55031170 « K9-66b Lantern » + 80181649 « "A Case for K9" » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire a6b9214d-047c-46df-af8c-c7adb432a170 : 55031170 « K9-66b Lantern » + 91025875 « K9-ØØ Lupis » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire c6edf88a-6788-4600-8824-2765afc2e9f4 : 55031170 « K9-66b Lantern » + 92248362 « K9-17 Izuna » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 9ff2ef5a-b76a-4671-8a4f-f5932031e4a4 : 55397172 « Futsu no Mitama no Mitsurugi » + 81560239 « Mitsurugi Ritual » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire be6cfb70-0c3b-4117-a33c-c54f34297cb8 : 56651978 « Elfnote Regina » + 59581480 « Elfnote Tinia » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 3161ef21-e00d-45d9-9d0b-2e93cce13ab5 : 56651978 « Elfnote Regina » + 64491754 « Elfnotes: Welcome Home » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 482abfc2-54e9-43d0-ba31-514d83f8ecbf : 56651978 « Elfnote Regina » + 85976588 « Elfnote Fortuna » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 66491413-4868-4b8c-85b5-e7b0366d263d : 57554544 « Fire King Island » + 66431519 « Sacred Fire King Garunix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 15f95b19-5574-456e-a818-b94f6b843d96 : 57554544 « Fire King Island » + 90681088 « Legendary Fire King Ponix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 49238728-7829-40e4-9a23-59ebae569098 : 57554544 « Fire King Island » + 93170499 « Jurrac Megalo » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b3ea7d28-e515-4bfc-9841-cfcca70d37e2 : 57554544 « Fire King Island » + 96594609 « Fire King Avatar Kirin » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 01317179-88d8-4aa2-a037-bd973bc61761 : 59438930 « Ghost Ogre & Snow Rabbit » + 64491754 « Elfnotes: Welcome Home » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 80e17adc-e3a6-4a10-a5ce-cc1f459e2923 : 59581480 « Elfnote Tinia » + 64491754 « Elfnotes: Welcome Home » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 48a395de-e1cf-4191-813d-e36b66383cdf : 64491754 « Elfnotes: Welcome Home » + 70088809 « Fydraulis Harmonia » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 757ef9a6-80d2-41c2-b9f5-d5a4d352fda7 : 64491754 « Elfnotes: Welcome Home » + 70488851 « Vidolium the Unstable Power Patron of Unity » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire d41f6562-2191-4bf2-9e77-84b7b330dcf4 : 64491754 « Elfnotes: Welcome Home » + 73642296 « Ghost Belle & Haunted Mansion » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire f79cba02-7684-4762-9f77-76f37bbe34f2 : 64491754 « Elfnotes: Welcome Home » + 85976588 « Elfnote Fortuna » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 5397a7c3-3f12-452d-9e1d-b37d39744ba0 : 64491754 « Elfnotes: Welcome Home » + 97268402 « Effect Veiler » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 71d65fe9-60d6-4d2a-8088-8e515ae903a5 : 64491754 « Elfnotes: Welcome Home » + 97556336 « Medius the Pure » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 605f059c-6c9c-487d-9e0f-b606959875c4 : 65305978 « Fire King Sanctuary » + 66431519 « Sacred Fire King Garunix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 2eb4c81e-640e-4368-8ea5-50c87836afa8 : 65305978 « Fire King Sanctuary » + 90681088 « Legendary Fire King Ponix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 7366c510-5d57-4e91-bd3e-2f80287e0f06 : 65305978 « Fire King Sanctuary » + 93170499 « Jurrac Megalo » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 36d567d9-6ac8-4c94-b260-38637bb7cbaa : 65305978 « Fire King Sanctuary » + 96594609 « Fire King Avatar Kirin » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 548d47f0-e865-4e93-ac27-23db82bba3e7 : 65681983 « Crossout Designator » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 8cee25d3-0b29-43e2-b059-52209d6a0d80 : 66328392 « Deception of the Sinful Spoils » + 70405001 « Black Luster Soldier - Soldier of Light and Darkness » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 9f89ac56-2da8-4dc7-9296-5d8ff79cbd82 : 66328392 « Deception of the Sinful Spoils » + 72270339 « Diabellstar the Black Witch » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 7a718162-69e1-4ab4-9263-1f2bb6789917 : 66328392 « Deception of the Sinful Spoils » + 81560239 « Mitsurugi Ritual » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire fc60ebbd-f96c-4ce0-97ea-5d1a4a93c7a3 : 66328392 « Deception of the Sinful Spoils » + 82782870 « Mitsurugi no Mikoto, Kusanagi » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 6b8013da-02d6-4c1c-96d1-28aef8bd3509 : 66328392 « Deception of the Sinful Spoils » + 84192580 « Mulcharmy Purulia » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 4473fa4d-2cd6-4fa8-90fd-e2bc8c4455d5 : 66328392 « Deception of the Sinful Spoils » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b2e69f2a-5e5c-42d9-960c-a7ac8b407e07 : 66328392 « Deception of the Sinful Spoils » + 94145021 « Droll & Lock Bird » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b5cddd71-7586-4067-9b95-e4c788e8b166 : 66328392 « Deception of the Sinful Spoils » + 94845588 « The Hallowed Azamina » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire bcc5f1f0-e2f4-48a9-b231-dd84a5833cdb : 66328392 « Deception of the Sinful Spoils » + 97462632 « Griffoh » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 307821c2-9e20-407a-bc46-e8b5e5614e05 : 66328392 « Deception of the Sinful Spoils » + 97631303 « Magicians' Souls » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire f639fdb1-c136-4d74-9962-dc361c6ecb94 : 66328392 « Deception of the Sinful Spoils » + 98476659 « Pot of Sloth » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 74fc4eb2-5cb7-48ff-8d4f-eb6732835021 : 66328392 « Deception of the Sinful Spoils » + 98684220 « Black Chaos » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 6d8aedb2-806e-4380-b99b-889659f3055b : 66431519 « Sacred Fire King Garunix » + 90681088 « Legendary Fire King Ponix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 5bedf6c1-becd-4edf-af4e-3558dfff083b : 70405001 « Black Luster Soldier - Soldier of Light and Darkness » + 98684220 « Black Chaos » · sans note · exclue dans 2 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire b24eaa94-0898-4439-93cb-540cd0be9a28 : 80845034 « WANTED: Seeker of Sinful Spoils » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 1afad059-1b7f-428b-a753-27cbd9083dbd : 81560239 « Mitsurugi Ritual » + 88570003 « Dark Magician, the Pharaoh's Servant » · sans note · exclue dans 1 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 0e595366-6f68-4d77-b12c-0c3910924b94 : 84192580 « Mulcharmy Purulia » + 90681088 « Legendary Fire King Ponix » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 9bb2b61e-5e48-4a6d-a569-384a2cd1177e : 88570003 « Dark Magician, the Pharaoh's Servant » + 94845588 « The Hallowed Azamina » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 0e7fe2e2-3504-492f-9eb1-d9467bad784d : 88570003 « Dark Magician, the Pharaoh's Servant » + 98476659 « Pot of Sloth » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire a23e7055-6fca-401e-b35d-763cc09fff4b : 90681088 « Legendary Fire King Ponix » + 93170499 « Jurrac Megalo » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P1 | compte 70f2598f-858b-4ad8-b82f-48045111f1da · paire 4a65da56-a41d-4785-b878-d775c4f5aa77 : 90681088 « Legendary Fire King Ponix » + 96594609 « Fire King Avatar Kirin » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire
P2 | deck 36f2806f-b5aa-41ed-a8c8-8264791b0ffc « YCS paris 2 » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire 1afad059-1b7f-428b-a753-27cbd9083dbd
P2 | deck 36f2806f-b5aa-41ed-a8c8-8264791b0ffc « YCS paris 2 » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire 1b49ed9d-c338-4168-b6a7-c2ff2948eb2c
P2 | deck 36f2806f-b5aa-41ed-a8c8-8264791b0ffc « YCS paris 2 » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire 764ef4c7-171c-409d-be03-7fe4f19c6fba
P2 | deck 36f2806f-b5aa-41ed-a8c8-8264791b0ffc « YCS paris 2 » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire 7a718162-69e1-4ab4-9263-1f2bb6789917
P2 | deck 36f2806f-b5aa-41ed-a8c8-8264791b0ffc « YCS paris 2 » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire 7bb05950-3f26-489a-bc39-607d68a0d5da
P2 | deck 36f2806f-b5aa-41ed-a8c8-8264791b0ffc « YCS paris 2 » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire 9421358e-4000-4273-a105-9c7311ecbad8
P2 | deck 36f2806f-b5aa-41ed-a8c8-8264791b0ffc « YCS paris 2 » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire b5cddd71-7586-4067-9b95-e4c788e8b166
P2 | deck 36f2806f-b5aa-41ed-a8c8-8264791b0ffc « YCS paris 2 » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire f5bc6bd3-bc9b-4e30-b02a-c2fb8467a55d
P2 | deck 36f2806f-b5aa-41ed-a8c8-8264791b0ffc « YCS paris 2 » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire f639fdb1-c136-4d74-9962-dc361c6ecb94
P2 | deck 3b4bf5c4-a5fb-4637-9d71-ce47f66f09a2 « RoLaD Branded » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire 5bedf6c1-becd-4edf-af4e-3558dfff083b
P2 | deck 3b4bf5c4-a5fb-4637-9d71-ce47f66f09a2 « RoLaD Branded » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire b85daf05-c0e1-4cc1-80cf-4eb830a4fae6
P2 | deck 3b4bf5c4-a5fb-4637-9d71-ce47f66f09a2 « RoLaD Branded » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire f48d5bfd-b047-4283-9365-94fa40bc5a72
P2 | deck 600d923d-d763-4857-ac03-533ba9807656 « Elfnote » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire b84c3e60-976f-4f33-8744-fc5cf83d5c6f
P2 | deck 6e98056b-4998-40d7-bf5b-7c6022c724e5 « Azamina RoLaD » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire 5bedf6c1-becd-4edf-af4e-3558dfff083b
P2 | deck ccbbf28f-46e1-45bb-80a4-656295f8c7b1 « Ryzeal onomat » (compte 70f2598f-858b-4ad8-b82f-48045111f1da) : exclut la paire 1a0db04f-9527-4021-a364-1b98adb549c9
résumé | à purger : 204 ligne(s) — P1 paires 185, P2 exclusions 15, P3 prérequis source paire 0, P5 pertinences 4, P6 drapeaux 0 ; P4 prérequis v2 convertis retirés avec leur table : 15
empreinte | empreinte du rapport : e0efff5c2ddacc8d27bbd9e9e76694b1
statut | SIMULATION TERMINÉE : purge jouée puis annulée volontairement, aucune modification. Pour appliquer : set testhand.purge_accept = 'e0efff5c2ddacc8d27bbd9e9e76694b1' puis rejouer ce fichier sans testhand.purge_mode.
```

En 8C, ce rapport est régénéré sur la base réelle par `deploy.sh` ; son empreinte ne sera
identique que si aucune paire, exclusion, prérequis, catégorie ou drapeau n'a bougé depuis
le dump.

### Preuves

```powershell
npm.cmd run typecheck                      # serveur et web
npm.cmd run build                          # avertissement ExcelJS attendu
node scripts/test-quiet.mjs                # 177 tests web, 7 serveur
# PostgreSQL jetable 55433 (deploy/configuration-v2.md), depuis Git Bash avec MSYS_NO_PATHCONV=1
TEST_DATABASE_URL=postgres://step23:step23-disposable@127.0.0.1:55433/step23 npm run test:integration -w server
                                           # persistence 11 tests, purge 10 tests
npm.cmd run e2e -w web                     # setup, guards, compare, mobile : conformes
```

Contrôle par mutation, chaque erreur volontaire détectée par la garde attendue, fichier
restauré depuis une copie et vérifié par empreinte SHA-256 :

| Mutation | Garde qui échoue |
| --- | --- |
| M1 003 : contrôle « prérequis historique présent dans deck_requirements » neutralisé (supprime malgré une ligne non convertie) | `003 refuses and names a legacy card-source requirement never converted by 001` (et, par cascade, les tests suivants) |
| M3a prune : refus « deux conditions à fusionner » neutralisé | `prune-stale-cards rolls back everything…` (l'unicité SQL casse alors le report, mais le message attendu manque) |
| M3b prune : refus « profils contradictoires » neutralisé (valide en choisissant silencieusement un profil) | `prune-stale-cards rolls back everything…` |
| M4 003 : garde « 002 journalisée » neutralisée | `003 refuses without the 002 journal entry` |
| M5 schema.sql : bloc historique inconditionnel (ressuscite `combo_pairs` après 003) | `003 replays without effect, schema.sql no longer resurrects…` |
| M6 003 : acceptation par empreinte neutralisée (applique sans rapport accepté) | `apply requires the accepted fingerprint…` |

Conteneurs 55433, 55435 et 55437 arrêtés et supprimés (`--rm`), pile e2e démontée, ports
libres. Aucune base personnelle, aucun VPS, aucun catalogue distant touché ; moteur,
oracles, migrations 001/002 et interface intacts.

### Limites

- `deploy.sh` ne rejoue pas 003 : un déploiement lancé maintenant appliquerait 001 et 002
  seulement (la nouvelle app fonctionne sans 003, prouvé par la suite persistence).
- Le rapport P1 nomme les cartes depuis le catalogue local : une paire dont une carte a
  disparu du catalogue apparaît « hors catalogue » (une paire de test `1111 + 2222` dans
  le dump).
- L'équivalence complète `--emit-sql` / `--apply` n'est pas prouvée (le SQL émis est
  vérifié sur son contenu, pas rejoué sur un second état identique).
- `legacy-representative.sql` porte des résumés réduits à `mainSize` ; les taux d'avant
  purge nécessaires au contrôle de recalcul sont à fabriquer en 8B.
- Sous Git Bash, `npm run test:integration` hors TTY utilise le rapporteur tap (`ok` /
  `not ok`), pas `✔`.

### Passation vers 8B

- Lire d'abord `deploy/backup.sh` tel qu'il tourne en cron (rétention 14 jours par `find
  -mtime +14 -delete` : les archives `keep/` doivent en être exclues) ; étendre, ne pas
  doubler.
- `rehearsal.sh <archive>` doit enchaîner exactement ce que `deploy.sh` jouera (bibliothèque
  commune `deploy/lib.sh`) et s'appuyer sur la ligne « SIMULATION TERMINÉE » et le code 0
  de 003 pour distinguer simulation et échec (D2). Le dump réel donne 185 paires : prévoir
  la relecture du rapport en fichier, pas seulement à l'écran.
- Contrôle de recalcul : ancienne définition des résumés `startRateFirst = 1 − brick`,
  `brickRate = brick` de la passe premier, `mainSize` (commit `e890078`,
  `web/src/store/deckStore.ts:404-406`). Règle : `mainSize` égal partout ; taux égal à
  1e-9 près pour un deck sans paire globale ni prérequis source paire (Deck A3 de la
  fixture) ; sinon écart attribué et chiffré. Le script refuse toute base hors 127.0.0.1
  et le port 5433.
- Les résumés d'avant purge du dump réel existent dans le dump (16) : l'inventaire de
  `deploy.sh` doit les capturer avant 001, qui les met à NULL.
- Mutation M2 (restauration sans vérification d'empreinte) en 8B ; ajouter une mutation sur
  `deploy.sh` qui saute la sauvegarde si la structure le permet.
- Ne pas oublier la règle AGENTS.md sur `String.prototype.replace` (`$$`) pour tout patch
  de SQL par script.

## Compte rendu 8B (8 septembre 2026)

Points 3, 4 et 5 du plan validé (D2, D3, Q2, Q3, Q7, Q8), sur conteneurs jetables et sur le
dump réel du 8 septembre (hors dépôt). Le rapport P1 de 8A est accepté tel quel : les 185
paires globales sont purgées et seront ressaisies à la main, aucune conversion ajoutée.
Rien n'a touché le moteur, les oracles, 001 / 002 / 003, `prune-stale-cards`, l'interface ni
un test existant ; aucune commande vers le VPS ni vers la base de dev (5433).

### Points signalés avant de commencer

- Le dump réel (pg_dump 17.10) commence par la méta-commande `\restrict` : restauration par
  psql ≥ 17.6 seulement (psql 17.10 du conteneur), jamais par le pilote pg — tous les scripts
  restaurent par psql dans le conteneur.
- La rétention `find "$DIR" -name 'ygo-*.sql.gz' -mtime +14 -delete` du cron aurait suivi
  `keep/` : `-maxdepth 1` ajouté, motif étendu aux compagnons `.sha256` / `.fingerprint`.
  Comportement observable inchangé (aucun sous-dossier n'existait).
- En cron, l'app tourne pendant l'export : empreinte vivante prise avant et après, comparaison
  stricte sur les tables stables, tables modifiées listées « non vérifiables » ; en
  `--pre-migration` (app arrêtée) toute table qui bouge est un échec.
- États d'échec de `deploy.sh` : avant 003 (sauvegarde, schéma, 001, 002) → ancien conteneur
  relancé, base intacte ; 003 en échec ou rapport refusé → nouvelle app démarrée sans 003 (Q8) ;
  seul un contrôle après migration en échec laisse l'app arrêtée.
- Deux ajouts de périmètre : `deploy/test-migration-sequence.sh` (cas négatifs de la séquence
  partagée, `deploy.sh` ne pouvant pas tourner hors VPS) et le mode `--db` / `--db-container`
  de `web/e2e/run.mjs` (harnais, aucun scénario ni test modifié).

### Point devenu incohérent après 8A, découvert par le cas de rejeu

Un second `deploy.sh` après 8C aurait échoué : 001 recrée `deck_requirements` sans condition
(`create table if not exists`) et 003, journalisée, refuse alors le rejeu (« objet historique
réapparu »). 001, 002 et 003 restent intouchées : la séquence de `lib.sh` ne rejoue 001 et 002
que tant que 003 n'est pas journalisée, le schéma se rejoue toujours (bloc conditionnel D1).
Prouvé par le cas F de `test-migration-sequence.sh` (séquence complète puis rejeu : code 0,
« déjà journalisée », base identique).

### Livré

- [deploy/lib.sh](../deploy/lib.sh) : accès à la base (Compose de production par défaut,
  `TESTHAND_DB_CONTAINER` pour un conteneur jetable, jamais un port hôte), empreintes
  (`db_fingerprint`, `fingerprint_diff`), bases de travail (`ygo_verify`, `ygo_restore`,
  `ygo_previous`, garde contre la base servie et les bases système), vérification d'archive
  (`verify_backup`, `check_archive_files`), inventaire, `simulate_003` / `apply_003` (code 0
  **et** marqueur), `accept_report` (« OUI » sur /dev/tty, `auto`, ou empreinte fournie ;
  `EXPECTED_FINGERPRINT` affichée), `check_after_migration`, `run_migration_sequence` avec
  crochets d'app et codes 0 / 1 / 2 / 3.
- [deploy/fingerprint.sql](../deploy/fingerprint.sql) (effectif et md5 des lignes triées par
  table, empreinte globale, réglages de session fixés),
  [deploy/inventory.sql](../deploy/inventory.sql) (effectifs, journal, résumés, modèle
  historique en jsonb, SQL dynamique : jamais d'erreur sur une table absente),
  [deploy/check-migration.sql](../deploy/check-migration.sql) (lignes `OK|` / `KO|`).
- [deploy/backup.sh](../deploy/backup.sh) étendu : `.sha256`, restauration dans `ygo_verify`,
  `.fingerprint`, `--pre-migration` et `--keep <libellé>` dans `keep/` hors rétention ; ligne
  `sauvegarde ok: …` inchangée, `sauvegarde vérifiée: …` ou `sauvegarde NON vérifiée: …`
  (archive conservée, sans `.fingerprint`, code 1). Chemin par défaut, cron, `umask 077`
  et `sudo mkdir` conservés.
- [deploy/restore.sh](../deploy/restore.sh) (D3) : refus sans `.sha256`, somme fausse,
  `.fingerprint` absent (sauf `--without-fingerprint`) ou différent ; restauration de contrôle
  dans `ygo_restore`, « OUI » ou `--yes`, sauvegarde de sécurité vérifiée
  `keep/ygo-pre-restauration-*`, bascule `ygo` → `ygo_previous` et `ygo_restore` → `ygo`,
  empreinte relue, app redémarrée ; `--check-only` pour une copie hors VPS.
- [deploy/rehearsal.sh](../deploy/rehearsal.sh) : conteneur jetable 55436, restauration de
  l'archive (ou `--fixture` : jeu représentatif archivé puis rejoué comme une archive réelle),
  séquence partagée avec `--accept <empreinte>` (attendue) ou acceptation automatique,
  recalcul, gardes e2e sur la pile migrée, retour arrière par `restore.sh`, rapport
  `deploy/out/rehearsal-<horodatage>/rapport.md`, démontage.
- [deploy/deploy.sh](../deploy/deploy.sh) : `git pull` → build → db → séquence partagée
  (crochets Compose) → `up -d` ; `--expect <empreinte>` (comparaison affichée avant « OUI »),
  `--accept <empreinte>` (sans question) ; rapports dans `deploy/out/deploy-<horodatage>/`.
- [deploy/test-backup-restore.sh](../deploy/test-backup-restore.sh) (deux conteneurs 55438 /
  55439, huit cas, M2 incluse) et
  [deploy/test-migration-sequence.sh](../deploy/test-migration-sequence.sh) (55440, cas A–F :
  sauvegarde en échec, 003 refusée, marqueur absent avec code 0, empreinte différente,
  contrôle après migration en échec, acceptation exacte puis rejeu).
- [scripts/recompute-check.ts](../scripts/recompute-check.ts) (+ `scripts/tsconfig.json`,
  `scripts/package.json`, `npm run typecheck` étendu) : référence = ancien moteur e890078
  matérialisé depuis git dans `deploy/out/reference-engine-e890078/` (ignoré, jamais versionné)
  sur `ygo_old` (archive pré-migration restaurée) avec l'ancien modèle ; (a) nouveau moteur
  avec paires globales réinjectées, attendu identique à 1e-9 ; (b) nouveau moteur après
  purge, écart attribué et chiffré ; résumé stocké informatif seulement ; `--fabricate` pour
  le jeu représentatif ; refuse tout hôte hors 127.0.0.1 et le port 5433.
- [web/e2e/run.mjs](../web/e2e/run.mjs) : `--db <url> --db-container <nom>` (base fournie,
  aucun conteneur créé ni démonté, migrations non rejouées, cartes synthétiques insérées) ;
  [web/e2e/fixtures/cards.mjs](../web/e2e/fixtures/cards.mjs) ne comble que les images
  manquantes (`coalesce`) : le jeu représentatif partage les passcodes 9000xxxx sans image.
- [docs/deploy-runbook.md](deploy-runbook.md) pour 8C : commande par commande, sorties
  attendues, retour arrière à chaque étape, point de non-retour à la saisie de « OUI », copie
  de l'archive pré-migration par scp et `restore.sh --check-only` avant ce point, lecture du
  rapport réel (empreinte attendue `e0efff5c2ddacc8d27bbd9e9e76694b1`, différences à
  expliquer par `diff` avec le rapport de 8A), contrôles navigateur après.
- Documentation : AGENTS.md (exception « `deploy.sh` ne rejoue pas 003 » retirée, commandes
  et pièges de 8B), server/AGENTS.md, docs/architecture.md, deploy/README.md (§7, §9),
  deploy/configuration-v2.md, DECISIONS.md, docs/decisions-compressees.md, docs/PLAN.md.

### Rapport de répétition sur le dump réel (8 septembre 2026)

Archive `ygo-prod-2026-09-08.sql.gz` (1,5 Mo, SHA-256
`066fcb08d32259be39df78a18450926602f78c8e99919a2ec2bf854bd60c562e`), conteneur jetable
`testhand-rehearsal-db` (127.0.0.1:55436), `--accept e0efff5c2ddacc8d27bbd9e9e76694b1` ;
identifiants internes et noms de decks seulement.

| Étape | Résultat | Détail |
| --- | --- | --- |
| 1. Restauration de l'archive | ok | 14 tables, 16 decks, 14 529 cartes (23 s) |
| 2. Séquence partagée (sauvegarde pré-migration vérifiée, inventaire, schéma, 001, 002, 003 simulée et appliquée, contrôles) | ok | code 0 ; à purger : 204 lignes — P1 paires 185, P2 exclusions 15, P3 prérequis source paire 0, P5 pertinences 4, P6 drapeaux 0 ; P4 prérequis v2 convertis retirés avec leur table : 15 ; empreinte `e0efff5c2ddacc8d27bbd9e9e76694b1`, identique à 8A (85 s) |
| 3. Recalcul : ancien moteur e890078 (référence) contre nouveau moteur, paires réinjectées puis purgées | ok | 16 decks comparés, 16 identiques en (a), 0 en échec (126 s) |
| 4. Gardes e2e sur la pile migrée | ok | setup 37,0 s, guards 35,1 s, compare 14,6 s, mobile 107,7 s (336 s) |
| 5. Retour arrière par `restore.sh` sur l'archive pré-migration | ok | empreinte initiale `9a50ef2e4172434f45b63dcf79f87920` retrouvée ligne à ligne (397 s) |

Inventaire avant migration (journal vide = base pré-001) : card_categories 23, card_flags 122,
cards 14 529, catalog_version 1, combo_pairs 185, deck_cards 663, deck_pair_exclusions 15,
deck_start_requirements 15 (source carte 15, source paire 0), deck_starters 105, decks 16
(16 résumés non nuls), nonengine_categories 4 (relevance : second 2, both 2), sessions 4,
user_identities 1, users 1. Archive pré-migration `keep/ygo-pre-migration-20260908-114338.sql.gz`,
sha256 `30d2c8dd…b71e0bf`, empreinte `9a50ef2e4172434f45b63dcf79f87920` = empreinte initiale.
Après 003 : deck_conditions 14 (inchangées entre après 002 et après 003), deck_flags 0,
deck_combo_pairs 0, `PURGE APPLIQUÉE : 003-purge-legacy journalisée, 204 ligne(s)
supprimée(s)`. Contrôles après migration : 33 lignes `OK|`, aucune `KO|` (journal 001 / 002 /
003, quatre tables et trois colonnes historiques absentes, objets v2 présents, aucun horizon,
sources uniques, tables intactes de bout en bout, 003 limitée à ses propres objets).

Recalcul, passe premier (5 cartes), tolérance 1e-9 ; (a) = nouveau moteur avec les paires
globales purgées réinjectées, écart à la référence nul à 12 décimales sur les 16 decks ; (b) =
nouveau moteur après purge ; le résumé stocké (cache de la dernière sauvegarde) est donné à
titre informatif :

| Deck | Main | Référence (ancien moteur) | (a) réinjecté | (b) après purge | Δ brick | Paires actives purgées | Résumé stocké − référence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Azamina RoLaD | 40 | 0,076798458377 | identique | 0,099968389442 | +2,3170 pts | 12 | +0,000434645172 |
| Branded | 40 | 0,053478073215 | identique | 0,099968389442 | +4,6490 pts | 12 | 0 |
| Crystron | 40 | 0,222363557890 | identique | 0,422876317613 | +20,0513 pts | 22 | 0 |
| Elfnote | 40 | 0,082584102321 | identique | 0,180476529161 | +9,7892 pts | 21 | +0,004361649098 |
| Mitsu Orcust (06e8834e) | 50 | 0,078797504201 | identique | 0,086572334762 | +0,7775 pts | 8 | 0 |
| Mitsu Orcust (95f31d1a) | 40 | 0,082786227523 | identique | 0,099968389442 | +1,7182 pts | 8 | 0 |
| Mitsu Orcust (heavy orcust) | 41 | 0,058990015986 | identique | 0,064850720178 | +0,5861 pts | 6 | 0 |
| Mitsu Rolad | 44 | 0,063212241530 | identique | 0,074336468976 | +1,1124 pts | 11 | +0,002017480535 |
| Mitsu Rolad no Futsu | 40 | 0,075047719785 | identique | 0,087232981970 | +1,2185 pts | 9 | 0 |
| Mitsu Rolad test | 50 | 0,060813872265 | identique | 0,069903622874 | +0,9090 pts | 11 | 0 |
| Mitsurugi Pure | 40 | 0,090874275085 | identique | 0,136063695274 | +4,5189 pts | 8 | 0 |
| Mitsurugi Pure (post Mamo) | 40 | 0,104164387059 | identique | 0,164336907758 | +6,0173 pts | 12 | 0 |
| RoLaD Branded | 41 | 0,085663425843 | identique | 0,158467196336 | +7,2804 pts | 14 | 0 |
| Ryzeal onomat | 40 | 0,049116424116 | identique | 0,051137676138 | +0,2021 pts | 1 | 0 |
| Unchained Soul | 40 | 0,112498632235 | identique | 0,216571834993 | +10,4073 pts | 21 | 0 |
| YCS paris 2 | 60 | 0,045106739672 | identique | 0,074813714590 | +2,9707 pts | 42 | +0,009314270480 |

Lecture : aucun deck n'est sans paire globale active (0 « identique sans paire ») ; la purge
élève le brick de chaque deck de 0,2 à 20 points, ce qui est exactement l'effet des paires
globales retirées (les 185 paires sont à ressaisir par deck). Pour quatre decks, le résumé
stocké dépasse la référence : cache de la dernière sauvegarde, jamais invalidé par
l'ancienne app quand une paire globale bougeait ; il n'est pas une référence et l'étape 9 le
recalcule. La première exécution du contrôle comparait aux résumés stockés (12 exacts, 4
résidus) ; des heuristiques de datation ont été essayées puis retirées à la demande de
l'utilisateur, la référence étant l'ancien moteur lui-même.

Gardes e2e (`run.mjs --db`) : compte `e2e@example.test` créé sur la copie migrée, cartes
synthétiques ajoutées, scénarios setup, guards, compare et mobile conformes (captures dans
`web/e2e/out/`). Retour arrière : `restore.sh` sur l'archive pré-migration (restauration de
contrôle dans `ygo_restore`, sauvegarde de sécurité `keep/ygo-pre-restauration-*`, bascule),
empreinte de la base identique ligne à ligne à l'empreinte initiale. Durée totale 401 s ;
conteneur supprimé.

### Répétition sur le jeu représentatif

`rehearsal.sh --fixture` : schéma + `legacy-representative.sql`, résumés fabriqués par le
moteur (`--fabricate`), archivé par pg_dump puis rejoué. Simulation : 14 lignes à purger
(P1 4, P2 1, P3 2, P5 5, P6 2 ; P4 3), empreinte `cc59821b5dfd55935ae3b98ae978325f`,
purge appliquée, contrôles OK, gardes e2e conformes, retour arrière prouvé (empreinte
`ecbd6641468ba57f2eaf4e3cbae53d74`), 219 s. Recalcul (référence = ancien moteur sur la
base pré-001) : Deck A3, sans paire globale active, identique avant et après purge
(0,422876317613) ; Deck A1 (3 paires actives, 1 prérequis source paire) +6,0197 points de
brick après purge, Deck A2 (2 paires) +8,2148 points, Deck B1 (1 paire, 1 prérequis) écart
nul (la paire Alpha + Beta n'ajoute aucun départ : ses deux cartes sont déjà starters) ; (a)
identique sur les 4 decks ; les résumés fabriqués par `--fabricate` coïncident avec la
référence. RECALCUL CONFORME.

### Preuves

Toutes jouées en fin de tâche, après les mutations, sur les scripts restaurés :

```powershell
npm.cmd run typecheck                      # serveur, web, scripts/recompute-check.ts : 0 erreur
npm.cmd run build                          # avertissement ExcelJS attendu
node scripts/test-quiet.mjs                # 177 tests web (15 fichiers), 7 serveur — inchangés
# PostgreSQL jetable 55433 (deploy/configuration-v2.md), depuis Git Bash avec MSYS_NO_PATHCONV=1
TEST_DATABASE_URL=postgres://step23:step23-disposable@127.0.0.1:55433/step23 npm run test:integration -w server
                                           # persistence 11 tests, purge 10 tests
npm.cmd run e2e -w web                     # pile jetable standard : setup, guards, compare, mobile conformes
bash deploy/test-backup-restore.sh         # 57 gardes, deux conteneurs 55438 / 55439
bash deploy/test-migration-sequence.sh     # cas A–F, 34 gardes, conteneur 55440
bash deploy/rehearsal.sh --fixture         # jeu représentatif : RÉPÉTITION CONFORME
bash deploy/rehearsal.sh ../testhand-dumps/ygo-prod-2026-09-08.sql.gz --accept e0efff5c2ddacc8d27bbd9e9e76694b1
                                           # dump réel : RÉPÉTITION CONFORME (rapport ci-dessus)
```

Conteneurs 55433, 55434, 55436, 55438, 55439, 55440 et 55441 supprimés (`--rm`), ports
libres ; base de dev 5433 jamais touchée ; aucune commande vers le VPS ; dump réel et archives
de répétition hors dépôt (`deploy/out/` ignoré, `*.sql.gz` ignoré).

### Contrôle par mutation

Chaque erreur volontaire est appliquée par remplacement exact, le test attendu est joué,
le fichier est restauré depuis sa copie d'origine et vérifié par SHA-256 (les trois
sommes d'origine retrouvées à la fin). Six mutations, six détections :

| Mutation | Erreur volontaire | Test | Gardes en échec (extrait) |
| --- | --- | --- | --- |
| M2a | `lib.sh` (`check_archive_files`) : somme SHA-256 non vérifiée | `test-backup-restore.sh` | « 5b message « somme SHA-256 différente » » (l'archive corrompue n'est plus refusée par la somme mais par gunzip lors de la restauration de contrôle : le test distingue les deux) |
| M2b (M2) | `restore.sh` : empreinte enregistrée non comparée, une empreinte fausse est acceptée | `test-backup-restore.sh` | « 5c empreinte globale fausse : code 2 », « 5c empreinte table fausse : code 2 », « 5 la cible n'a pas été modifiée », « 5 aucune sauvegarde de sécurité créée » (6 gardes) |
| M7 | `lib.sh` (séquence de `deploy.sh`) : résultat du contrôle après migration ignoré | `test-migration-sequence.sh` | « E code 2 », « E app laissée arrêtée avec la commande de restauration », « E aucun démarrage de l'app » (4 gardes) |
| M8 | `lib.sh` : marqueur « SIMULATION TERMINÉE » non exigé, le code 0 seul vaut succès | `test-migration-sequence.sh` | « C code 1 (le code 0 de psql sans marqueur n'est pas un succès) », « C 003 non journalisée », « C la table combo_pairs existe encore » (5 gardes) |
| M9 | `backup.sh` : vérification en échec sans code de retour 1 | `test-backup-restore.sh` | « code 1 » du cas 4 (extension en échec partiel) |
| M10 | `lib.sh` (séquence de `deploy.sh`) : sauvegarde pré-migration sautée et gardes de l'archive retirées | `test-migration-sequence.sh` | « A code 1 », « A ancienne app relancée », « A base intacte », « E app laissée arrêtée avec la commande de restauration » (6 gardes) |

Les mutations M1, M3–M6 de 8A restent celles du compte rendu 8A.

### Limites

- `deploy.sh` n'a pas tourné sur le VPS : sa partie Compose (`build`, `stop`, `start`,
  `up -d`, crochets) n'est prouvée que par lecture ; la séquence partagée l'est par
  `rehearsal.sh` et `test-migration-sequence.sh`.
- La vérification d'une sauvegarde en cron restaure l'archive dans `ygo_verify` sur le même
  serveur : elle prouve que l'archive se restaure et porte les données, pas que le disque
  sous-jacent survivra ; la copie hors VPS (runbook §4) reste indispensable.
- `fingerprint.sql` repose sur `x::text` des lignes : deux bases identiques donnent la même
  empreinte, mais une différence de représentation textuelle (version majeure de PostgreSQL)
  la ferait diverger ; comparer toujours entre bases d'une même majeure (17).
- Le contrôle de recalcul ne couvre que la passe premier (brick), comme le résumé historique ;
  les autres indicateurs sont couverts par les oracles du moteur (étapes 1 et 5).
- Un retour arrière de répétition a échoué une fois parce que `restore.sh` était modifié
  pendant son exécution (bash lit le script au fil de l'eau) ; non reproduit sur trois
  passages suivants ; consigne ajoutée à AGENTS.md.
- L'équivalence complète `--emit-sql` / `--apply` de `prune-stale-cards` (report de 8A) n'est
  toujours pas prouvée.

### Questions ouvertes

- **Q11** — `ygo_previous` : `restore.sh` garde la base remplacée sous ce nom jusqu'à la
  restauration suivante (deuxième retour arrière, immédiat). Faut-il la supprimer d'office à
  la fin d'une restauration réussie, ou après un délai ? Non tranché : conservée.
- **Q12** — `--without-fingerprint` : les archives quotidiennes antérieures à 8B n'ont ni
  `.sha256` ni `.fingerprint` ; `restore.sh` les refuse. Faut-il un mode qui vérifie une telle
  archive par restauration seule (somme calculée sur place) ? Non tranché : refus, l'option
  explicite `--without-fingerprint` exige encore le `.sha256`.
- **Q13** — deploy.sh sur un rapport refusé (code 3) démarre la nouvelle app sans 003 ; les
  tables historiques restent en base et l'ancien modèle n'est plus servi. Combien de temps cet
  état intermédiaire est-il acceptable avant de relancer ? Non tranché : à décider en 8C.

### Passation vers 8C

- Suivre docs/deploy-runbook.md ; commit et tag de 8B à pousser au préalable (rien n'est
  poussé par cette session), `git pull` sur le VPS avant `deploy.sh`.
- Empreinte attendue `e0efff5c2ddacc8d27bbd9e9e76694b1` si la production n'a pas bougé depuis
  le dump du 8 septembre ; sinon répéter d'abord sur une archive fraîche (runbook §0).
- Les 185 paires globales sont à ressaisir par deck après 8C (décision de l'utilisateur) ;
  poser ensuite les profils des cartes étiquetées.
- Étape 9 : recalcul des aperçus (`decks.summary` reste NULL après 001 / 002).

## Préparation de 8C : départ à vide (8 septembre 2026)

Session courte, sans nouvelle session de code lourde. Tag `etape-8c-ready`, rien poussé.

### Décision

Après 8B, l'utilisateur a décidé que **la production repart d'une base vide**. Rien n'est
conservé : ni decks, ni comptes, ni annotations. L'archive de l'état actuel est prise, vérifiée
et copiée hors VPS par principe (souvenir), mais elle n'est plus un chemin de retour à préparer.
Conséquences :

- le runbook reçoit une **variante « départ à vide »** (V1–V7) qui remplace ses §3 à §5 ; §0
  (répétition sur archive fraîche) devient inutile, l'empreinte `e0efff5c…` n'est plus attendue
  en production, §7 (retour arrière) reste valable avec l'archive souvenir ;
- la ressaisie manuelle des 185 paires globales est **sans objet** (aucun deck repris) ; les decks
  utiles se réimportent depuis leurs fichiers YDK ;
- le contrôle de recalcul contre l'ancien moteur (8B) reste prouvé mais ne s'applique plus à la
  production (aucun deck à comparer) ; le recalcul des aperçus de l'étape 9 garde son sens
  pour les decks réimportés ;
- Q12 (archives antérieures à 8B) et Q13 (durée de l'état « app sans 003 ») perdent leur objet en
  8C : sur base vide, toute question posée par `deploy.sh` signifie que la base n'était pas vide
  et se refuse (`NON`) ; Q11 (`ygo_previous`) est inchangée.

### Point 1 — comment une base neuve reçoit le catalogue, et en combien de temps

Vérifié par lecture puis prouvé sur conteneurs jetables (55442, 55443 ; jamais la base de dev,
aucune commande vers le VPS ; lecture seule de la Supabase publique, demandée explicitement).

- **Schéma et migrations.** Un volume neuf est initialisé par les quatre fichiers montés dans
  `docker-entrypoint-initdb.d` (`docker-compose.prod.yml`) au premier démarrage du conteneur
  `db` : schéma (bloc historique créé, 003 non journalisée), 001, 002, 003 (rien à purger,
  journalisée sans acceptation) en ≈ 5 s. La séquence de `lib.sh` trouve ensuite 003
  journalisée : schéma rejoué seul, aucune simulation, aucune question, contrôles OK, app
  démarrée — code 0 en 17 s (conteneur 55443, mode `interactive` sans terminal : une question
  aurait rendu 3).
- **Catalogue.** Ni l'app (`server/src/index.ts` ne charge rien au démarrage, `/api/health`
  compte la table `cards`) ni l'initialisation ne le remplissent : `/api/health` répond
  `{"ok":true,"cards":0,"catalog":null}` sur une base neuve. La copie se fait par
  `server/scripts/migrate-cards.ts` (dans l'image : `server/dist/scripts/migrate-cards.js`,
  exécuté dans le conteneur `app`, deploy/README.md §8) : PostgREST de la Supabase publique avec
  la clé anon par défaut, pages de 1 000, upsert par lots de 500, version lue avant et après,
  estampille `catalog_version`. Mesuré : **14 529 cartes, version source `2026-08-31`, 13 à
  16 s, base de 22 Mo** ; `Content-Range: 0-0/14529` côté source, `dataset_versions` annonce
  14 529.
- **Santé.** Serveur démarré (tsx, port 8791) sur la base jetable remplie :
  `{"ok":true,"cards":14529,"catalog":{"version":"2026-08-31","migratedAt":"…","cards":14529}}`
  = nombre du catalogue distant. Inscription par `POST /api/auth/register` avec un code
  d'invitation : compte créé, `GET /api/decks` = `[]`, `users 1, decks 0`. Rejeu de la séquence
  sur la base remplie : code 0, « déjà journalisée », empreinte identique.
- **Compose sans conteneur app** (après `down`) : `docker compose stop app` rend 0 (crochet
  d'arrêt sans effet), `start app` rend 1 (« no container to start », absorbé par `|| true` dans
  `hook_start_old_app`). Vérifié sur une pile Compose minimale jetable.

### Manque révélé et correctif validé (point 3)

Sur une base **réellement vide** (base `ygo` recréée sans `initdb`, aucune table), la séquence
journalisait bien 001 / 002 / 003 sans question (« rien à purger : aucune acceptation requise »,
« 0 ligne(s) supprimée(s) ») mais le contrôle « tables intactes de bout en bout » rendait KO
(les huit tables conservées « absentes avant ») et laissait l'app **arrêtée** (code 2). Arrêt et
question posée à l'utilisateur, qui a retenu **les deux** : runbook sur le volume recréé (aucun
script requis) **et** correctif du contrôle :

- [deploy/lib.sh](../deploy/lib.sh), `check_after_migration` : si `fingerprint-0.txt` ne porte
  aucune table (base vide au départ), les tables conservées doivent exister après et être vides
  — `OK|base vide au départ (aucune table avant le schéma) : tables conservées créées vides par
  le schéma : …`, sinon KO nominatif (`users (1 ligne(s))`, `cards (absente après)`) ; le contrôle
  du périmètre de 003 (après 002 → après 003) est inchangé. Les bases non vides suivent
  exactement l'ancien chemin.
- [deploy/test-migration-sequence.sh](../deploy/test-migration-sequence.sh) : `begin_case
  <lettre> empty` ; cas **G** (base vide, mode interactif sans terminal → code 0, journal
  001 / 002 / 003, 0 ligne purgée, contrôle « base vide au départ » OK, aucun KO, tables
  conservées vides ; rejeu → code 0, « déjà journalisée », base identique) et **H** (base vide
  mais `users` remplie après 003 → code 2, app laissée arrêtée, KO nominatif). Cas A–F intouchés.
- Preuve rejouée après correctif sur base vide (55442) : code 0 en 30 s, ligne OK « base vide au
  départ », catalogue 13 s, santé conforme.

### Preuves

```powershell
npm.cmd run typecheck                      # serveur, web, scripts : 0 erreur
npm.cmd run build                          # avertissement ExcelJS attendu
node scripts/test-quiet.mjs                # 177 tests web, 7 serveur — inchangés
bash deploy/test-migration-sequence.sh     # cas A–H, 49 gardes (34 + 15), conteneur 55440
bash deploy/rehearsal.sh --fixture         # jeu représentatif : RÉPÉTITION CONFORME (séquence 14 lignes, recalcul 4 / 4, e2e, retour arrière ; 229 s)
# preuve « départ à vide » (scripts de session hors dépôt) : conteneurs 55442 (base vide, séquence
# lib.sh, migrate-cards, serveur 8791, /api/health, inscription, rejeu) et 55443 (initdb par les
# quatre fichiers montés, puis séquence) ; résultats ci-dessus
```

Conteneurs 55440, 55442, 55443 et la pile Compose minimale supprimés ; base de dev 5433 jamais
touchée ; aucune commande vers le VPS ; Supabase lue seulement (catalogue public).

### Limites

- La partie Compose de `deploy.sh` (`build`, `stop`, `up -d`) et la suppression du volume
  (`ygo-proba_pgdata`, nom déduit du projet Compose `ygo-proba` et du volume `pgdata`, à confirmer
  par `docker volume ls`) ne sont prouvées que par lecture et par une pile minimale ; le premier
  `deploy.sh` réel reste à faire sur le VPS (runbook V4).
- La durée de la copie du catalogue est mesurée depuis le poste ; le réseau du VPS peut
  différer, l'ordre de grandeur reste la dizaine de secondes.
- En mode `--keep`, `backup.sh` exige une base immobile : l'app doit être arrêtée avant la
  sauvegarde souvenir (V1), sinon « NON vérifiée ».

### Passation vers 8C (révisée)

- Pousser le commit et le tag `etape-8c-ready` (rien n'est poussé par cette session), `git pull`
  sur le VPS, puis suivre la variante « départ à vide » de docs/deploy-runbook.md : V1 arrêt et
  sauvegarde souvenir vérifiée, V2 copie hors VPS et `--check-only`, V3 volume supprimé (point de
  non-retour), V4 `deploy.sh` sans aucune question, V5 catalogue, V6 compte, V7 contrôles.
- Ensuite l'étape 9 (docs/PLAN.md).
