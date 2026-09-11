# Étape 10 — Plans de side

> **Plan validé le 10 septembre 2026. Partie A livrée le même jour** (compte rendu en §10), **partie B le 11 septembre** (§11).
> Cadrage mené en trois tours de questions ; les décisions sont consignées en §2 (D1–D18),
> les questions ouvertes tranchées en §9. Reste à faire : 10C, 10D (§6).

## 1. Intention

Décrire, pour chaque adversaire, ce qu'on change entre le main et le side — en premier et en
second — puis (a) mesurer le deck ainsi sidé avec le moteur exact existant et (b) sortir une
fiche imprimable qui tient sur une page en tournoi.

Trois objets :

- **Adversaire** — un nom libre propre au deck (« Kewl Tune »). *À terme* : une référence à un
  archétype connu, avec son icône en tête du plan (hors étape 10, cf. §9).
- **Plan de side** — le volet « premier » ou « second » d'un adversaire. Un adversaire porte
  toujours ses deux volets ; chacun peut être vide.
- **Échange** — le geste : on sélectionne des copies dans le side, autant dans le main, on
  valide. Le plan ne retient que **deux listes agrégées** (copies entrantes, copies sortantes) ;
  aucun appariement n'est conservé.

## 2. Décisions du cadrage

| # | Décision | Retenu |
| --- | --- | --- |
| D1 | Portée | Descriptif **et** analytique : le deck sidé est calculé par le moteur. |
| D2 | Annotation des cartes de side | Directement dans le bloc side de la grille d'annotation, qui redevient annotable (revient sur la décision de 9C). |
| D3 | Analyse affichée | Les deux : chiffres clés dans la vue Side **et** comparateur complet sur le deck sidé. |
| D4 | Sortie | Page imprimable (→ PDF), swaps + 3 chiffres + une note libre par plan. |
| D5 | Grandeur « non-engine » | Le **potentiel U** (fenêtres retenues, plafonds partagés, HOPT appliqués), comme partout ailleurs dans l'app. |
| D6 | Granularité | Deux listes agrégées, pas d'appariement. |
| D7 | Interface | Vue dédiée « Side », copies dépliées une par une. |
| D8 | Geste | Clic gauche **et** clic droit basculent la sélection (menu natif neutralisé dans cette vue seulement). |
| D9 | Stockage | Tables dédiées, migration `004`. |
| D10 | Équilibre | Refus strict : « Échanger » n'accepte qu'une sélection équilibrée. |
| D11 | Retouche | Un plan peut redevenir déséquilibré ; il est alors **incomplet** : conservé et enregistré, jamais analysé ni imprimé. |
| D12 | Incohérence | Un plan qui référence une carte absente de sa zone est **à revoir** : conservé tel quel, jamais modifié en silence. |
| D13 | Chiffres | Cache versionné, sur le mécanisme des aperçus de 9A : un chiffre d'une autre empreinte n'est jamais affiché. |
| D14 | Adversaire | Texte libre pour l'instant ; le modèle prépare la référence à un archétype. |
| D15 | Volume | 6 à 7 adversaires par deck en pratique (4 suffiraient). Aucune recherche dans la liste, la fiche tient sur une page ; le modèle reste évolutif — borne de représentation large, jamais un plafond métier. |

Confirmé le 10 septembre 2026 (Q2) :

- **D16** — Les copies ne sont dépliées une par une que dans la vue Side. Partout ailleurs (grille
  d'annotation, inventaire, mur de mains) la tuile reste **par carte** avec son compteur : deltas,
  couleurs de groupe, paires et modes sont définis par carte, pas par copie.
- **D17** — L'extra reste non annotable : aucune de ses cartes ne peut entrer dans le main, donc
  aucune annotation portée là ne pourrait influencer un chiffre. Seul le bloc side s'ouvre (D2).
- **D18** — Libellés d'interface en français : « plan de side », « adversaire », « échanger ».
  Le code et les tables gardent l'anglais, comme partout ailleurs (`deck_matchups`, `SidePlan`,
  à l'image de `deck_combo_pairs`).

## 3. Ce que l'existant permet déjà — vérifié

- **Les annotations sont déjà indépendantes de la zone.** `removeCard` (web/src/store/deckStore.ts:471)
  documente « Retrait : uniquement `deck_cards`. Annotations CONSERVÉES, inertes, restaurées au
  ré-ajout ». `parseConfiguration` ne contraint ni `starters`, ni `pairs`, ni `conditions` à
  appartenir au main. Annoter une carte de side ne demande **ni migration ni changement de contrat**.
- **Le moteur ignore structurellement tout ce qui n'est pas dans le main.** `buildEngineModel`
  (web/src/lib/engineModel.ts) filtre chaque annotation par `mainCopies.has(...)` : paires,
  starters, étiquettes, feuilles de condition. Une annotation portée par une carte de side est
  inerte tant qu'elle n'est pas dans le main, et devient active dès qu'elle y entre. **Le moteur
  n'est pas touché par l'étape 10.**
- **Les 3 chiffres existent déjà.** `queryProbability` (web/src/engine/query.ts) évalue des
  critères combinés par ET sur les sujets `starts` (S) et `nonengine` (U) — exactement les
  grandeurs du panneau, de la matrice et de l'Excel, couvertes par `dataIdentity.test.ts`.
- **Le cache versionné a un précédent éprouvé** : `web/src/lib/summary.ts` (9A) — empreinte,
  `usableSummary`, jamais d'affichage d'un résumé d'une autre version, recalcul à la demande.
- **Piège de calcul à connaître** : une feuille de condition dont la carte est absente du modèle
  vaut **faux** (`type: null` → `return false`, web/src/engine/evaluate.ts:118). Un starter dont
  la condition exige une carte que le plan fait sortir ne démarre donc plus dans le deck sidé.
  C'est correct, et c'est la première cause de « pourquoi ce chiffre s'effondre » : la vue Side
  doit nommer ces sources neutralisées.

## 4. Modèle

### Contrat (`server/src/domain/deckConfiguration.ts`, partagé avec le web)

```ts
export interface SidePlanCard { card_id: number; copies: number }   // copies 1–3
export interface SidePlan {
  position: 'first' | 'second';
  note: string | null;
  outgoing: SidePlanCard[];   // quittent le main
  incoming: SidePlanCard[];   // entrent depuis le side
}
export interface Matchup {
  id: string;         // uuid
  name: string;       // texte libre, 1–200
  sort_index: number; // ordre d'affichage stable
  plans: SidePlan[];  // 0 à 2, une position au plus chacune
}
// Configuration v2 : + matchups: Matchup[]
```

**Le contrat valide la structure, jamais la cohérence avec les zones.** Ids, copies 1–3, pas de
doublon carte × direction, pas de carte à la fois entrante et sortante, une position au plus par
adversaire, longueurs. Il n'exige **ni** que les cartes soient dans la bonne zone, **ni** que le
plan soit équilibré : sinon retirer une carte du side rendrait le deck non enregistrable (D11, D12).
Ces cohérences-là sont des règles de l'éditeur et des états affichés.

Une seule borne de taille, **de représentation et non métier** — même esprit que
`CONDITION_MAX_DEPTH` / `CONDITION_MAX_LEAVES` : `MATCHUPS_MAX = 32` adversaires par deck. L'usage
réel en compte 6 à 7 (D15) ; la borne existe pour qu'un document ne puisse pas grossir sans limite,
jamais pour contraindre la façon de travailler. Aucune limite sur le nombre de cartes d'un plan
au-delà de ce que les zones permettent (R1).

### Schéma (`db/migrations/004-side-plans.sql`, additive)

Tel qu'implémenté en 10A — un plan n'a **pas** d'identifiant de substitution, son couple
(adversaire, position) suffit et sera l'adresse de l'API d'aperçu de 10B (§10, écart 1) :

```sql
create table if not exists deck_matchups (
  deck_id     uuid not null references decks on delete cascade,
  id          uuid not null,
  name        text not null check (length(name) between 1 and 200),
  sort_index  int  not null default 0 check (sort_index >= 0),
  primary key (deck_id, id)          -- comme deck_combo_pairs : l'id vient du client
);

create table if not exists deck_side_plans (
  deck_id     uuid not null,
  matchup_id  uuid not null,
  position    text not null check (position in ('first', 'second')),  -- mot-clé non réservé
  note        text,
  summary     jsonb,          -- cache d'affichage des 3 chiffres, jamais une vérité
  primary key (deck_id, matchup_id, position),
  foreign key (deck_id, matchup_id) references deck_matchups (deck_id, id) on delete cascade
);

create table if not exists deck_side_plan_cards (
  deck_id     uuid   not null,
  matchup_id  uuid   not null,
  position    text   not null,
  card_id     bigint not null check (card_id > 0),   -- passcode ; pas de FK catalogue (note §A)
  direction   text   not null check (direction in ('out', 'in')),
  copies      smallint not null check (copies between 1 and 3),
  primary key (deck_id, matchup_id, position, card_id, direction),
  foreign key (deck_id, matchup_id, position) references deck_side_plans (deck_id, matchup_id, position) on delete cascade
);
```

Écriture par `writeConfiguration` dans **la même transaction** que le reste ; adversaires et plans
en upsert (lignes stables, comme `deck_combo_pairs`) pour qu'un enregistrement sans rapport ne
détruise pas le `summary` d'un plan, cartes de plan remplacées. `db/schema.sql` ne reçoit **rien** :
comme les tables de 001 et 002, celles-ci ne vivent que dans la migration, jouée par `initdb` sur
une base neuve. Montage dans `docker-compose.yml`, `deploy/docker-compose.prod.yml`, rejeu dans
`run_migration_sequence` (`deploy/lib.sh`) et dans `web/e2e/run.mjs`.

L'archive JSON n'a **rien à changer** : les plans voyagent dans `configuration`, donc export,
import et duplication les emportent — à prouver par les tests d'équivalence existants étendus.

## 5. Règles métier (à inscrire au contrat, nouvelle section « Plans de side »)

- **R1** — Un plan ne fait entrer que des cartes du side, au plus les copies qui s'y trouvent, et
  ne fait sortir que des cartes du main, au plus leurs copies. Règle de l'éditeur (§4).
- **R2** — Une carte n'est jamais à la fois entrante et sortante dans le même plan (contrat).
- **R3** — Le main dérivé respecte la convention 1–3 par carte : une copie entrante d'une carte
  déjà en main est refusée si elle porterait le total au-delà de 3. Règle de l'éditeur.
- **R4** — Un plan est **équilibré** si Σ copies sortantes = Σ copies entrantes. « Échanger »
  n'accepte qu'une sélection équilibrée ; une retouche peut déséquilibrer le plan, qui devient
  **incomplet** : conservé, enregistré, jamais analysé ni imprimé.
- **R5** — Un plan dont une carte a quitté sa zone est **à revoir** : conservé tel quel, jamais
  modifié en silence, ni analysé ni imprimé, les cartes en cause nommées.
- **R6** — Le deck sidé = main dérivé + **toutes les annotations du deck**, inchangées (starters,
  paires, conditions, mortes, profils, plafonds, HOPT, étiquettes). Aucune annotation propre à un plan.
- **R7** — Un plan « premier » s'analyse en contexte premier, « second » en contexte second, quel
  que soit le réglage courant du deck.
- **R8** — Les trois indicateurs d'un plan :

  | | Définition |
  | --- | --- |
  | I1 | P(S ≥ 1) |
  | I2 | P(U ≥ 2) |
  | I3 « main forte » | premier : P(S ≥ 2 **et** U ≥ 1) · second : P(S ≥ 2 **et** U ≥ 2) |

  S = départs théoriques (starter ou paire, conditions et disponibilités appliquées).
  U = potentiel non-engine (fenêtres retenues, plafonds partagés et HOPT appliqués).
  Calculés par `queryProbability` : ce sont, au bit près, les grandeurs du panneau et de l'Excel.
- **R9** — Un indicateur n'est **jamais** affiché s'il ne porte pas l'empreinte courante (version
  du moteur + modèle dérivé + définition sérialisée des critères) : absent, il est recalculé à la
  demande. Rien de périmé ne s'imprime.

## 6. Découpage

### 10A — modèle, contrat, persistance (aucune interface)

`Configuration.matchups` et sa validation ; `004-side-plans.sql` + `schema.sql` + les deux compose
+ `run_migration_sequence` ; lecture/écriture dans `deckRepository` (transaction unique, ids
stables) ; extension des tests d'équivalence création / YDK / JSON v2 et de duplication.
**Preuves** : refus nominatifs du contrat, suite `persistence` sur base jetable, révision et
409 inchangés, `test-migration-sequence.sh` (cas A–I) et `rehearsal.sh --fixture`.

### 10B — deck sidé calculable (pur, sans interface)

`web/src/lib/sidePlan.ts` : `applyPlan(main, plan)` pur, rendant le main dérivé **et** les
incohérences R1/R3/R5 constatées. `planIndicators(pass, position)` bâti sur `engine/query.ts`,
sans toucher au moteur. `planSummary.ts` sur le modèle de `summary.ts` (empreinte, `usable…`,
recalcul à la demande) et la route `PUT /api/decks/:id/side-plans/:planId/summary` (révision,
409 ignoré), calquée sur `PUT /decks/:id/summary`.
**Preuves** : `sidePlan.test.ts` ; test d'identité des données — les 3 chiffres d'un plan sont
**strictement égaux** à ce que le mode Requête affiche avec les mêmes critères sur le même deck
dérivé (dans l'esprit de `dataIdentity.test.ts`, jamais une formule réécrite dans le test).

### 10C — annotation du side + vue Side

Bloc side de la grille annotable : vraies tuiles, tous les modes, menu ⋯, conditions ET/OU ;
`annotationMutation(cardId)` ne recalcule que si la carte est dans le main, sinon « non
enregistré » seul (extension de la règle `zoneMutation` de 9C) ; traitement visuel « annotée,
hors calcul » ; l'extra reste inchangé.
Vue `/decks/:id/side` : main et side côte à côte, copies dépliées, sélection au clic gauche comme
au clic droit, « Échanger » actif à sélection équilibrée, deux listes agrégées, note libre,
liste d'adversaires (ajout par nom, ordre, recopie premier → second) tenant à l'écran sans
recherche ni repli à 6–7 entrées (D15), états « incomplet » et
« à revoir », taille du main dérivé toujours affichée, **sources de start neutralisées par le
plan** nommées (§3, dernier point). Chiffres du plan ouvert et écart signé avec le deck de base —
jamais d'écart si le résultat de base est périmé. Empilement à 360 px.
**Preuves** : `store` (annotation hors main sans recalcul), scénario e2e `side` à 1440 et 360.

### 10D — comparateur étendu + fiche imprimable

`/compare/:a/:b` accepte un segment `<deckId>~<planId>` (deck sidé) ; `comparisonDeckOf` applique
le plan. `/decks/:id/side/fiche` : un bloc par adversaire, colonnes premier / second, vignettes,
3 chiffres, note libre ; CSS d'impression ; bouton « tout calculer » enchaînant en série les plans
sans chiffres frais, avec progression ; « — » plutôt qu'un vieux chiffre. Cible de mise en page :
**les 6 à 7 adversaires d'un deck tiennent sur une page** (D15) ; au-delà, la coupure se fait
entre deux blocs, jamais au milieu d'un plan.
**Preuves** : scénario e2e `side-fiche` (rendu 1440 + impression simulée), export du comparateur
inchangé.

## 7. Risques et pièges

- **Le contrat ne doit jamais refuser un plan devenu incohérent** : sinon retirer une carte du
  side rendrait le deck non enregistrable. C'est la contrainte la plus importante de 10A.
- **Nouvelle migration** : le prochain déploiement n'est plus le C0–C6 trivial de 9C mais la
  variante avec migration — répétition `rehearsal.sh` obligatoire avant de conclure.
- **`__ENGINE_VERSION__`** : si `planIndicators` atterrit dans un fichier couvert par l'empreinte,
  tous les aperçus de l'accueil s'invalident une fois (sans gravité, ils se recalculent).
  L'empreinte du cache de plan est **indépendante** et inclut la définition sérialisée des
  critères, pour qu'un changement de définition invalide les chiffres tout seul.
- **Volume** : 7 adversaires = 14 plans au plus, donc 14 calculs pour une fiche complète partant
  de zéro — court. Le cache versionné évite de les refaire, le bouton « tout calculer » les
  enchaîne en série. Ce n'est donc pas un risque de performance, seulement une raison de garder
  le cache honnête (R9).
- **Jamais** `npm run e2e -w web` en même temps que `test-migration-sequence.sh` ou `rehearsal.sh`.
- 9C avait décidé « side jamais annoté » : D2 revient dessus, à consigner dans DECISIONS.md.

## 8. Vérifications à chaque partie

`npm run typecheck` · `npm run build` · `node scripts/test-quiet.mjs` (fichier ciblé puis suite
complète) · `npm run test:integration -w server` · `npm run e2e -w web` ; pour 10A en plus
`bash deploy/test-migration-sequence.sh` puis `bash deploy/rehearsal.sh --fixture`, en série.
Contrôle par mutation à chaque partie, comme aux étapes 6 à 9.

## 9. Questions ouvertes

- ~~**Q1** — Combien d'adversaires par deck en pratique ?~~ **Tranchée** (10 sept. 2026) : 6 à 7 au
  plus, 4 suffiraient ; prévoir large et évolutif. → D15, borne de représentation `MATCHUPS_MAX = 32`,
  ni recherche ni repli dans la liste, fiche sur une page.
- ~~**Q2** — Confirmer les trois défauts de §2 ?~~ **Tranchée** (10 sept. 2026) : les trois retenus
  tels quels → D16, D17, D18.
- ~~**Q3** — Afficher les sources de start neutralisées par le plan ?~~ **Tranchée** (10 sept. 2026) :
  oui. Livré en 10C : un plan qui fait sortir une carte exigée par la condition d'un starter ou
  d'une paire nomme les sources ainsi rendues inconditionnellement fausses (§3, `evaluate.ts:118`).
- ~~**Q4** — Ordre des adversaires sur la fiche ?~~ **Tranchée** (10 sept. 2026) : **ordre d'ajout**,
  gratuit — `deck_matchups.sort_index` est déjà au modèle et ouvre le réordonnancement manuel plus
  tard sans migration.
- **Q5** (hors étape) — Archétypes connus avec icône, en remplacement du nom libre : à cadrer
  séparément (catalogue d'archétypes, source des icônes, rattachement des plans existants).

## 10. Compte rendu 10A (10 septembre 2026)

**Périmètre** : modèle, contrat et persistance. Aucune interface, aucun calcul — le deck sidé
n'est pas encore calculable (10B), les plans ne sont pas encore éditables (10C).

### Livré

- **Contrat** (`server/src/domain/deckConfiguration.ts`) : `SidePlan`, `Matchup`,
  `SIDE_PLAN_POSITIONS`, `MATCHUPS_MAX = 32`, `validateMatchups`, `Configuration.matchups`.
  Validation **structurelle seulement** (§5, R1/R4/R5) ; `matchups` absent = `[]`.
- **Schéma** : `db/migrations/004-side-plans.sql` — `deck_matchups` (clé `(deck_id, id)` comme
  `deck_combo_pairs`), `deck_side_plans` (clé naturelle `(deck_id, matchup_id, position)`,
  colonne `summary` pour 10B), `deck_side_plan_cards` (`direction` = `out` / `in`, copies 1–3).
  Montée dans les deux compose, rejouée dans `run_migration_sequence` (les deux branches,
  avant 003), contrôlée par `check-migration.sql` (journal + trois tables).
- **Persistance** : `deckRepository` lit et écrit dans la transaction unique ; adversaires et
  plans en **upsert** (lignes stables), cartes de plan remplacées ; `GET /decks/:id` rend
  `matchups` ; la duplication régénère les identités.
- **Web** : `EditableDeck.matchups`, `configurationFromState` / `stateFromConfiguration` /
  `configurationFromDetail`, état du store (aucune mutation avant 10C), `DeckDetail.matchups`,
  périmètre de l'archive JSON étendu aux cartes nommées par un plan.
- **Hors plan, ajouté après vérification** (§ Écarts) : `prune-stale-cards` connaît
  `deck_side_plan_cards` ; `web/e2e/run.mjs` applique 004.

### Écarts au plan

1. **Clé naturelle au lieu d'un identifiant de plan** (§4 annonçait un uuid par plan) :
   `(deck_id, matchup_id, position)` suffit et sera l'adresse de l'API d'aperçu de 10B.
2. **`prune-stale-cards` étendu** — non prévu au §6. Le script énumère tous les emplacements de
   passcode ; les plans en contiennent désormais. Sans lui, une purge de catalogue pouvait
   reporter une carte et produire un plan la faisant **entrer et sortir** — une configuration que
   le contrat refuse, donc un deck qui ne s'enregistre plus. Règle retenue, sans rien inventer :
   dans une même liste les copies se cumulent (plafond 3, comme `deck_cards`) ; dans les deux
   sens du même plan, **tout est annulé** et le plan est nommé (comme le conflit de conditions).
3. **`web/e2e/run.mjs`** n'appliquait pas 004 : un `npm run e2e` autonome aurait monté une base
   sans les tables, et l'API échoue à lire le moindre deck. Corrigé.

### Vérifications exécutées (en série)

`npm run typecheck` · `npm run build` · `node scripts/test-quiet.mjs` (209 web, 11 serveur) ·
`npm run test:integration -w server` (persistence 13, purge 11) · `npm run e2e -w web`
(8 scénarios) · `bash deploy/test-migration-sequence.sh` (cas A–I, **68 gardes**, dont le cas « F sans 004 » ajouté au passage, cf. ci-dessous) ·
`bash deploy/rehearsal.sh --fixture` (**conforme** : séquence, recalcul contre l'ancien moteur
e890078, 8 scénarios e2e sur la pile migrée, retour arrière). Conteneurs jetables supprimés ;
aucune commande vers le VPS ni la base de dev.

**Incident d'environnement** (aucun rapport avec le code) : la première répétition a échoué parce
qu'un **autre projet** occupait le port 5174 (`C:\dev\ReplayAnalyzer`). Son serveur n'a pas été
touché : la pile a été déplacée par `E2E_WEB_PORT`. Piège découvert au passage et consigné dans
AGENTS.md — `E2E_WEB_PORT` seul ne suffit pas, `E2E.base` étant figée à l'import de
`web/e2e/lib.mjs` ; sans `E2E_BASE`, le navigateur tape le 5174 du voisin et le login rend 404.

### Le cas « F sans 004 » : une garde qui manquait

Préparer la mutation M6 (004 non rejouée sur une base déjà purgée) a montré qu'**aucun cas de la
séquence ne l'aurait détectée** : dans le cas I, c'est `initdb` qui applique 004 ; dans F et G, la
première séquence l'applique avant que le rejeu ne passe par la branche « 003 déjà journalisée ».
Or une base à 003 **sans** 004, c'est exactement l'état de la production depuis 8C — la ligne la
plus exposée de toute l'étape n'était donc couverte par rien. Ajouté à la suite du cas F : tables
de 004 supprimées et journal retiré, séquence rejouée → code 0 sans question, 003 « déjà
journalisée », 004 rejouée par la branche post-003, journal 001 à 004, trois tables, aucun KO
(6 gardes, 68 au total). M6 a été rejouée sur une **copie** de `deploy/` : la session précédente
s'était coupée pendant une mutation posée sur le vrai `lib.sh`, restauré depuis sa sauvegarde et
vérifié octet pour octet avant toute autre chose.

### Contrôle par mutation (7 posées, 7 détectées)

| # | Mutation | Garde qui tombe |
| --- | --- | --- |
| M1 | Le contrat exige qu'une carte sortante soit dans le main | contrat, « structure seulement » |
| M2 | Le contrat exige l'équilibre des deux listes | contrat, « structure seulement » |
| M3 | La garde « carte répétée dans une liste » disparaît | contrat, refus structurels |
| M4 | Les adversaires sont remplacés en bloc à l'enregistrement | intégration, cache d'un plan détruit |
| M5 | `configurationFromState` n'émet plus `matchups` | web, aller-retour de l'éditeur |
| M6 | 004 n'est plus rejouée sur une base déjà purgée | séquence, cas « F sans 004 » (ajouté pour elle) |
| M7 | Le script de purge ne refuse plus le conflit entrer / sortir | purge, plan nommé et rien de modifié |

### Non fait / reporté

Aucun test existant affaibli (les seules retouches sont additives : 004 appliquée dans les deux
suites d'intégration, trois tables ajoutées au `snapshot()` de la suite purge, journal attendu de
la séquence). Moteur, oracles, `engineModel.ts`, `conditions.ts` et `summary.ts` intacts →
`__ENGINE_VERSION__` inchangé, aucun aperçu d'accueil invalidé. La migration 004 n'est pas jouée
sur le VPS : le prochain déploiement redevient un déploiement **avec migration**.

### Passation vers 10B

Le contrat, la table `deck_side_plans.summary` et la clé naturelle `(deck, adversaire, position)`
sont en place : 10B n'a plus qu'à écrire `applyPlan`, `planIndicators` (sur `queryProbability`),
l'empreinte du cache et la route `PUT /api/decks/:id/matchups/:matchupId/plans/:position/summary`,
calquée sur `PUT /decks/:id/summary` (révision, 409 ignoré). Rien de l'interface n'est commencé.

## 11. Compte rendu 10B (11 septembre 2026)

**Périmètre** : le deck sidé devient calculable, ses trois chiffres ont un cache honnête. Tout est
pur côté client ; aucune interface — le calcul n'est encore lancé par personne (10C l'orchestrera).

### Livré

- **`web/src/lib/sidePlan.ts`** (hors `__ENGINE_VERSION__`) :
  - `applyPlan(main, side, plan)` → statut (`ready` / `incomplete` / `review`), écarts nommés
    (`outgoing-missing`, `incoming-missing`, `over-limit`), copies sortantes et entrantes, taille
    après échange, et main dérivé **seulement** si le plan est prêt, dans l'ordre d'une édition à
    la main ;
  - `sidedSource(source, applied)` : toutes les annotations du deck sur le main dérivé (R6), `null`
    si le plan n'est pas prêt ;
  - `indicatorCriteria(position)` / `planIndicators(pass, position)` : I1, I2, I3 comme requêtes du
    mode Requête (R8), passe de la position du plan exigée (R7) ; `planComputeMode(position)` ;
  - `planFingerprint`, `planSummaryFromPass`, `usablePlanSummary` : empreinte FNV-1a 64 de la
    version du moteur, de la position, des critères et de l'entrée complète du moteur (R9).
- **Serveur** : `PlanSummary`, `parsePlanSummary`, `checkPlanSummaryMatches` (domaine pur) ; route
  `PUT /decks/:id/matchups/:matchupId/plans/:position/summary` (révision 409, taille après échange
  400, plan inconnu 404, révision et `updated_at` intacts) ; `plan_summaries` dans `GET /decks/:id`.
- **Client API** : `api.putPlanSummary`, `DeckDetail.plan_summaries`.

### Vérifications exécutées

`npm run typecheck` · `npm run build` · `node scripts/test-quiet.mjs` (226 web, 12 serveur) ·
`npm run test:integration -w server` (persistence 14, purge 11). Ni la séquence de migration ni la
répétition : 10B ne touche ni `deploy/`, ni migration, ni schéma. Pas d'e2e : aucune interface
touchée (`GET /decks/:id` gagne un champ, aucun consommateur existant ne le lit).

Tests ajoutés : `lib/sidePlan.test.ts` (17) — application du plan et ses trois statuts ; **deck sidé
= main édité à la main** (modèle moteur strictement égal) avec la carte de side annotée starter qui
s'active en entrant et la condition dont la carte requise sort, devenue fausse ; **égalité stricte
avec le mode Requête** en premier et en second ; R7 ; cache périmé par le moteur, la position, le
plan, la bibliothèque et la définition des critères, pas par un échange neutre ; formes altérées.
Contrat serveur (1), intégration de la route (1).

### Contrôle par mutation (7 posées, 7 détectées)

| # | Mutation | Garde qui tombe |
| --- | --- | --- |
| W1 | `applyPlan` ignore les cartes sortantes | main dérivé ≠ édition à la main |
| W2 | R7 retirée : la passe de l'autre position est acceptée | « refuse la passe de l'autre position » |
| W3 | Main forte en second avec U ≥ 1 | égalité stricte avec le mode Requête (second) |
| W4 | Empreinte sans la définition des critères | « une nouvelle définition change l'empreinte » |
| W5 | Cache affiché sans vérifier l'empreinte | « périmé dès que … changent » |
| W6 | Plan déséquilibré considéré prêt | « un plan déséquilibré est incomplet » |
| S1 | Route des chiffres sans garde de révision | intégration, 409 attendu sur révision périmée |

Les mutations web ont été jouées par script sur le vrai fichier avec restauration en `finally`
(vérifiée à l'identique) ; S1 sur une base jetable neuve.

### Non fait / reporté

Rien de 10B. Aucun test existant modifié ; moteur, oracles, worker, `engineModel.ts`,
`conditions.ts`, `summary.ts` intacts (`__ENGINE_VERSION__` inchangé). Les « sources de start
neutralisées par le plan » (Q3) restent en 10C, comme prévu au §6 — le test R6 montre déjà la
mécanique (feuille `type: null`).

### Passation vers 10C

Tout ce que la vue Side doit calculer existe : pour un adversaire et une position,
`applyPlan(state.main, state.side, plan)` → si `ready`, `buildEngineModel(sidedSource(state, applied))`
→ `client.compute(model.input, planComputeMode(position))` → `result[position]` →
`planSummaryFromPass` → affichage, puis `api.putPlanSummary(deckId, matchupId, position, summary,
revision)` (409 ignoré). À l'ouverture, `usablePlanSummary(detail.plan_summaries…, model.input,
position)` dit si un chiffre stocké est affichable. Restent à 10C : les mutations du store sur
`matchups` (ajout d'adversaire, échange, retrait, note), le bloc side annotable sans recalcul hors
main, la vue elle-même, et la liste des sources neutralisées.
