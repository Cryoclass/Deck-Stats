# Annotations par défaut — HOPT, étiquettes et plafonds pré-remplis

Statut : **plan proposé le 16 septembre 2026, en attente de validation** (aucun code écrit).
Prompt d'origine : [prompt-annotations-par-defaut.md](prompt-annotations-par-defaut.md).
Inventaire mené en lecture seule sur la base de dev (catalogue) et sur une restauration
jetable de l'archive de production du 8 septembre 2026 (`../testhand-dumps/`, conteneur
`testhand-annot-inventory` sur 55446, détruit en fin de session). Aucune commande vers le
VPS ni Supabase.

## 1. Intention

Un joueur importe son deck et lit des chiffres justes sans annoter à la main le HOPT, les
étiquettes non-engine et les plafonds partagés des cartes courantes. Trois couches :

1. **Détection** depuis le texte anglais de la carte (`cards.description`), pure et
   déterministe, jamais stockée : recalculée par le client à partir du catalogue.
2. **Référence** posée par un **référent** (rôle attribué hors de ce dépôt), commune à
   tous les comptes, qui corrige ou complète la détection carte par carte.
3. **Choix** du compte, qui prime sur les deux autres et ne touche que ce compte.

Valeur effective d'une carte = choix du compte, sinon référence, sinon détection.

## 2. Inventaire prouvé

### 2.1 Modèle existant (vérifié dans le code)

| Objet | Où | Constat |
| --- | --- | --- |
| HOPT | `card_flags.is_hopt boolean not null default false` (par compte) | Aucune valeur par défaut au-delà de `false` ; une ligne `false` peut venir d'un clic « retirer » comme d'un profil posé : les deux cas sont indiscernables en base. |
| Étiquettes | `nonengine_categories` (par compte, `is_builtin` pour « Handtrap » et « Board breaker », créées à l'inscription par `auth/account.ts`) + `card_categories` | Aucune identité d'étiquette commune aux comptes : deux comptes ont deux « Handtrap » d'`id` différents. |
| Profil et plafond | `card_flags.availability`, `card_flags.group_id` → `nonengine_groups` (par compte, `cap_per_turn`) | Le serveur refuse un profil sans étiquette (`library.ts`, Q1 de 5A) et un plafond sans profil (contrainte SQL). Aucun groupe n'existe par défaut. |
| Moteur | `evaluate.ts` : `nonEngine[i] = profile !== undefined && categories.length > 0` ; HOPT = 1 sommet par identité et 1 contribution par tour | Une carte n'est comptée non-engine qu'avec profil **et** étiquette (cas de référence Q1 de `chronology.test.ts`). |
| Assemblage | `lib/engineModel.ts` (`buildEngineModel`) lit `hopt`, `profiles`, `cardCategories`, `groups` de la bibliothèque du compte ; appelé par le store, l'accueil (`sourceFromDetail`), le comparateur, la fiche de side | L'accueil construit le modèle **sans objets `Card`** (pas de texte de carte sous la main) ; le store, le comparateur et la fiche chargent les cartes par `api.cardsByIds` (colonne `description` servie par `GET /api/cards`). |
| Caches | `decks.summary` (version du moteur seulement), `deck_side_plans.summary` (empreinte de l'entrée complète du moteur, `lib/sidePlan.ts`) | Une modification de bibliothèque met à NULL les résumés des decks du **même compte** seulement (`invalidateOwnerSummaries`). |
| Rôles | `users.role in ('user','admin')` (migration 005), écrit par `deploy/backoffice-role.sh` seulement ; `/api/auth/me` ne renvoie pas le rôle | Rien ne dit « référent » aujourd'hui. |
| Archive JSON | `deckArchive.library` = `hoptCardIds`, `categories`, `cardCategories`, `profiles`, `groups` ; import = fusion avec la bibliothèque, conflit explicite = refus total | Un défaut ne doit pas s'exporter comme un choix. |
| Purge du catalogue | `prune-stale-cards` reporte `card_flags` et `card_categories` | Une table de références devra y entrer. |

### 2.2 Données réelles disponibles

| Source | Comptes | Decks | Cartes de main distinctes | `is_hopt = true` | Étiquettes |
| --- | --- | --- | --- | --- | --- |
| Base de dev (5433, lecture seule) | 1 | 1 | — | 0 | 2 (fournies de base) |
| Archive prod du 8 sept. 2026 (restaurée sur 55446) | 1 | 16 | 127 (56 dans ≥ 2 decks) | 114 sur 122 lignes | « Handtrap » 12, « Board Disruption » 7, « Dead First » 3, « Board breaker » 1 |

L'archive de production date du déploiement 8C (« départ à vide ») : c'est la base
historique d'un seul compte (le tien). Les deux comptes de confiance mentionnés dans le
prompt sont dans la production **actuelle**, hors de portée sans commande vers le VPS
(question Q9). Les 127 cartes jouées et leurs 122 drapeaux sont donc la seule vérité
terrain de cet inventaire ; elle est cohérente (un compte expert).

### 2.3 Mesure de la détection HOPT (limite par nom)

Règles mesurées (scripts de session, hors dépôt) : une limite **par nom** est une phrase
« You can only use / activate … "Nom propre de la carte" … once per turn | 1 … per turn |
once that turn | per Chain | per Duel » ; le nom propre est cherché **littéralement**
(les guillemets imbriqués de Maxx "C", Therion "King" Regulus ou World Legacy - "World
Crown" ne posent alors aucun problème, le suffixe « (s) » est accepté). « You can only
Special Summon "Nom" once per turn (this way) » est retenu comme HOPT pour un monstre de
main deck (son invocation depuis la main est son rôle de starter). « twice / thrice per
turn » n'est pas HOPT. Un « once per turn » sans nom est une limite par exemplaire
(`soft`) : pas HOPT. Les types d'extra deck, jetons et cartes de compétence sont exclus.

Catalogue entier (14 529 cartes, 12 129 éligibles au main deck) :

| Classe | Cartes | Lecture |
| --- | --- | --- |
| `byName` (HOPT) | 4 616 | limite par nom propre |
| `summonOnce` (HOPT) | 94 | invocation spéciale limitée par nom |
| `byName2` (pas HOPT) | 14 | deux ou trois fois par tour, par nom |
| `soft` (pas HOPT) | 1 291 | limite par exemplaire seulement |
| `none` (pas HOPT) | 6 114 | aucune limite (monstres normaux, anciennes cartes…) |
| exclues | 2 400 | extra deck, jetons, compétences |

Limites citant un **autre** nom que celui de la carte : 51 cas, dont 41 sont le nom propre
avec guillemets imbriqués (déjà couverts), 3 la famille Mulcharmy (« You can only activate
1 other "Mulcharmy" monster effect » = plafond de groupe, voir §2.5), et 7 des écarts de
graphie du catalogue (« Maliss <C> MTP-07 » vs « Maliss MTP-07 », « Migratory Zereort » vs
« Zereort Migrator », « Spell Shattering Sword » vs « Spell-Shattering Sword », pluriels
« Servant(s) of Endymion »). Au total **15 cartes sur 12 129** (0,12 %) échappent au nom
littéral : une normalisation (retrait de `<…>`, ponctuation, pluriel) les récupère, à
mesurer en partie A. Aucune limite d'archétype du type « 1 "X" Spell per turn » n'existe
dans ce catalogue en dehors de Mulcharmy.

Cartes réellement jouées (127) contre les choix du compte expert :

| Détection \ compte | `true` (114 lignes, 99 cartes jouées) | `false` (8) | aucun choix (20) |
| --- | --- | --- | --- |
| HOPT (`byName` + `summonOnce`) | **97** | 4 | 11 |
| pas HOPT (`none`, `soft`) | 2 | 4 | 8 |
| carte absente du catalogue | 0 | 0 | 1 |

- Les 2 « vrai chez toi, pas détecté » : **Droll & Lock Bird** (aucune limite dans le
  texte ; une seconde activation est simplement inutile) et **Pot of Sloth** (« you cannot
  activate "Pot of Sloth" for the rest of this turn » : formulation à ajouter aux motifs,
  0 autre carte de main deck ne l'emploie avec son propre nom).
- Les 4 « détecté, faux chez toi » : Black Chaos (invocation limitée par nom, effet de
  défausse sans limite), Black Luster Soldier - Soldier of Light and Darkness (chaque
  effet limité par nom, mais monstre de boss : le HOPT ne change rien à ses starts),
  Elfnote Regina et Elfnotes: Welcome Home. Aucune des 8 lignes `false` ne porte de
  drapeau `dead_*` : ce sont des clics explicites (voir Q2).
- Les 4 « pas détecté, faux chez toi » (Called by the Grave, Foolish Burial, Mulcharmy
  Fuwalos, Super Polymerization) concordent.

Couverture : 112 cartes jouées sur 127 reçoivent un défaut HOPT ; sur les 63 cartes jouées à
2 ou 3 exemplaires (celles où le HOPT change un chiffre), 55 sont détectées HOPT et 5
d'entre elles n'avaient aucun choix (Light and Darkness Ritual, Ghost Ogre & Snow Rabbit,
Fydraulis Harmonia, Elfnote Power Patron, Ruler of the End of the World). **La détection
textuelle du HOPT est fiable** ; ses seuls désaccords sont des jugements (redondance
d'effet, boss monster) que la couche référence prend en charge.

### 2.4 Mesure de la détection des étiquettes et profils

Heuristiques mesurées :

- **Mulcharmy** : gabarit « If you control no cards (Quick Effect): You can discard this
  card; apply these effects this turn » → Handtrap, profil précoce, groupe « Mulcharmy »
  (3 cartes, exactes).
- **Handtrap générique (monstre)** : une phrase contenant une fenêtre rapide (« (Quick
  Effect) », « During your opponent's / either player's turn », « When your opponent
  activates ») **et** une action depuis la main (discard / send / Tribute / Special
  Summon this card from your hand / reveal), **sans** condition d'archétype dans la phrase
  (nom entre guillemets, « you control », « your … monster »).
- **Handtrap (piège)** : « you can activate this card from your hand » sans condition
  d'archétype (Dominus Impulse / Purge / Spark, Infinite Impermanence, Evenly Matched,
  Red Reboot).
- **Board breaker (magie)** : retrait de masse (« Destroy / Negate the effects of /
  Banish / Return … all | as many … your opponent controls | on the field ») sans nom
  d'archétype.

Résultats sur le catalogue : 98 monstres Handtrap génériques, 3 précoces, 10 pièges
« depuis la main », 68 Board breakers. Sur les cartes jouées, **les 14 monstres et pièges
détectés Handtrap sont tous des handtraps** (12 étiquetés Handtrap par ton compte, plus
Ghost Ogre & Snow Rabbit et Griffoh non étiquetés) ; aucun faux positif parmi les jouées.
Mais sur un échantillon aléatoire de 45 monstres détectés dans tout le catalogue, j'en
juge **environ 15 vraiment génériques** (Hanewata, Maxx "C", Kuriboh, Skull Meister, Ghost
Belle, Herald of Orange / Green Light, Swift Scarecrow, Gemini Imps, Lifeforce Harmonizer,
Ghost Reaper & Winter Cherries, Fire Cracker…) et **30 cartes d'archétype ou de niche**
(The Iris Swordsoul, Scrap Breaker, Battlin' Boxer Promoter, Trickstar Narkissus,
Mementotlan Shleepy, Gouki Octostretch, Kaiser Glider - Golden Burst…). Précision élevée
sur le méta joué, faible sur la longue traîne. Manqués notables : Kurikara Divincarnate,
les Bystial (la fenêtre rapide est dans une phrase séparée), Contact "C", Gnomaterial,
les Kaiju, Lava Golem, Sphere Mode. Board breakers : Raigeki, Lightning Storm, Dark Hole,
Harpie's Feather Duster, Dark Ruler No More sont trouvés ; Forbidden Droplet, Triple
Tactics Talent, Super Polymerization, Called by the Grave (ta catégorie « Board
Disruption ») ne sont pas des retraits de masse et ne sont pas trouvés ; 60 des 68
trouvés sont des cartes anciennes jamais jouées (Final Destiny, Ojama Delta Hurricane…).

Conclusion : **une étiquette ou un profil ne se détecte pas de façon fiable dans le
texte** ; ce qui se détecte bien, c'est un sous-ensemble précis (gabarit Mulcharmy,
handtraps génériques de monstre, pièges activables depuis la main, retraits de masse sans
archétype). La couche référence doit porter le reste : une centaine de cartes non-engine
réellement jouées, corrigées par le référent, couvrent le méta bien mieux que n'importe
quelle regex. Le profil **préparé** (magie rapide, piège à poser) n'est jamais un défaut
de détection : la plupart des magies rapides et pièges sont des cartes d'engine (Mitsurugi
Prayers, Branded Opening…), les compter non-engine serait faux.

### 2.5 Plafonds partagés

Seule la famille Mulcharmy porte une limite de groupe dans le catalogue (3 cartes, « You
can only activate 1 other "Mulcharmy" monster effect, the turn you activate this effect »,
soit 2 effets par tour, l'exemple du contrat §3). Aucune autre famille de main deck n'a
de limite « 1 "X" … per turn » citant un autre nom que le sien. Le défaut de plafond est
donc un gabarit unique, à étendre par la référence si une famille apparaît.

## 3. Avis sur le couple étiquette / profil

Diagnostic (mémoire du 8 septembre) : les étiquettes ne sont pas inertes (axes de la
matrice, critères `category` / `group`, comptage brut) ; le doublon est la **porte** —
rien n'est compté sans profil **et** étiquette (Q1 et Q5 de 5A).

Ce chantier rend la porte plus visible, pas moins : un défaut doit poser les deux pour
compter, et un utilisateur qui retire l'étiquette « Handtrap » d'Ash sans toucher au
profil obtient une carte profilée qui ne compte plus, sans le voir. Mon avis :

- **Le bon modèle est « profil = déclencheur, étiquettes = axes facultatifs »** : une carte
  est non-engine dès qu'elle a un profil ; elle entre dans U (potentiel total) ; ses
  étiquettes ne servent qu'à la ventilation et aux critères. Un seul geste utilisateur
  (« cette carte est une handtrap flexible ») suffit ; le mode « Non-engine » et le mode
  « Profil » de la grille fusionnent en un seul.
- Coût : changement du contrat (§3, Q1), du moteur (`nonEngine[i] = profile !==
  undefined`, une ligne, mais `__ENGINE_VERSION__` change), du cas de référence Q1 de
  `chronology.test.ts` (**réécrit sur décision, jamais pour faire passer le code**), de la
  garde serveur « profil sans étiquette refusé » (levée), de l'interface (un mode au lieu
  de deux). Après ce chantier, les cartes profilées sans étiquette seront rares (les
  défauts posent les deux) : l'impact numérique de la levée de la porte est faible et
  mesurable par le rapport d'écart.
- Recommandation : **le faire, dans une partie D distincte**, après A–C, si tu réponds oui
  à Q3. Sans ton accord explicite, A–C conservent la porte et les défauts posent toujours
  profil et étiquette ensemble.

## 4. Décisions proposées

- **D1 — Trois couches, valeur effective calculée côté client.** Détection = module pur
  `server/src/domain/cardDefaults.ts` (partagé avec le web comme `deckConfiguration.ts`,
  aucune dépendance Node), appliqué par le client sur les objets `Card` ; ajouté à la
  liste de `__ENGINE_VERSION__` (vite.config.ts) : tout changement de règle de détection
  invalide aperçus et chiffres de plans. Référence = table serveur. Choix = `card_flags`
  et `card_categories` du compte. Fusion dans un module pur `web/src/lib/effectiveLibrary.ts`
  qui produit un `EngineModelSource` **et** la source de chaque valeur (`auto` /
  `référence` / `vous`) ; `buildEngineModel` ne change pas.
- **D2 — Règles HOPT de détection** : celles du §2.3, plus la normalisation des noms (`<…>`,
  ponctuation, pluriel « (s) ») et la formulation « you cannot activate "Nom" … this turn ».
  Strictement textuelles : aucune liste de cartes en dur dans le code (Droll, Dimension
  Shifter… relèvent de la référence, Q5).
- **D3 — Règles d'étiquette / profil / plafond de détection** : uniquement les quatre gabarits
  précis du §2.4 (Mulcharmy → Handtrap + précoce + groupe « Mulcharmy » 2 ; handtrap
  générique de monstre → Handtrap + flexible ; piège activable depuis la main → Handtrap +
  flexible ; retrait de masse sans archétype → Board breaker + board breaker). Jamais de
  profil « préparé » par détection. Tout le reste : aucun défaut.
- **D4 — Référence = table `card_references`** (`card_id` pk, `is_hopt boolean null`,
  `nonengine jsonb null` = `{ availability, labels: [...], group: 'Mulcharmy' | null }` ou
  `null` explicite = « pas non-engine », `note text`, `updated_by`, `updated_at`), chaque
  aspect pouvant être laissé à la détection (`is_hopt` absent = détection). Journal
  `card_reference_log` en ajout seul (même déclencheur que `backoffice_audit`). Livrée à
  tout compte connecté dans `GET /api/library` (`references`, `referencesVersion`).
- **D5 — Référent = colonne `users.referent_since timestamptz null`**, indépendante de
  `users.role` (un compte peut être admin et référent). Exposée par `/api/auth/me`
  (`referent: boolean`), garde `requireReferent` sur les routes d'écriture de la
  référence. Ce dépôt n'écrit jamais cette colonne depuis une route ; la migration 006
  accorde `select, update (referent_since)` sur `users` au rôle `testhand_backoffice`
  pour le back-office (question Q1 pour l'amorçage).
- **D6 — Choix du compte = copie sur écriture par aspect.** Aspect HOPT : `card_flags.is_hopt`
  devient nullable (`null` = hérite). Aspect non-engine : nouvelle colonne
  `card_flags.nonengine_choice boolean not null default false` ; `true` = le triplet
  (profil, plafond, étiquettes du compte sur cette carte) est l'état voulu, même vide.
  Premier geste de l'utilisateur sur un aspect hérité : le serveur matérialise la valeur
  effective puis applique le geste. Action « revenir au défaut » par aspect
  (`DELETE /api/library/flags/:cardId?aspect=hopt|nonengine`). Migration : `is_hopt = true`
  → explicite ; `is_hopt = false` → `null` (Q2) ; toute ligne avec `availability` ou toute
  carte ayant une affectation d'étiquette → `nonengine_choice = true`.
- **D7 — Étiquettes et groupe de référence = objets fournis de base par compte**, comme
  aujourd'hui pour « Handtrap » et « Board breaker » : `nonengine_groups.is_builtin` et un
  groupe « Mulcharmy » (2) créé à l'inscription et rétro-créé par la migration 006 pour
  les comptes existants. La détection et la référence désignent une étiquette ou un groupe
  par son **nom fourni de base** ; le client résout vers l'`id` du compte (Q4).
- **D8 — Aucun chiffre calculé avec d'anciennes annotations** : (a) la migration 006 met à
  NULL tous les `decks.summary` ; (b) toute écriture de référence met à NULL les résumés de
  tous les decks contenant la carte, **tous comptes confondus** ; (c) les résumés de plans
  se périment seuls (empreinte de l'entrée complète, qui inclut HOPT, profil, étiquettes,
  plafond) ; (d) un changement de règle de détection change `__ENGINE_VERSION__` (D1).
- **D9 — Changement visible et assumé** : pastille de source sur la tuile et dans le détail
  de carte (« auto », « réf. », « vous »), action « revenir au défaut », bandeau une fois
  après le déploiement (« Les annotations par défaut sont actives : vos chiffres ont pu
  changer ; vos choix sont conservés »), et **rapport d'écart** (script `scripts/`, sur une
  restauration jetable) joint au compte rendu : pour chaque deck existant, P(≥ 1 départ),
  brick et E[U] avant / après.
- **D10 — Interface du référent, minimale, dans l'éditeur** : depuis le détail de carte
  (menu ⋯), « Définir la référence » (HOPT oui / non / détection ; non-engine : profil,
  étiquettes, groupe, ou « pas non-engine », ou détection ; note) ; page `/references`
  (liste, recherche, désaccords détection / référence, journal). Aucun écran
  d'attribution du rôle (Q7).
- **D11 — Import / export JSON** : la section `library` de l'archive ne contient que les
  **choix explicites** du compte (jamais un défaut) ; l'import fusionne des choix avec les
  règles de conflit actuelles ; les références ne s'exportent pas.
- **D12 — `prune-stale-cards`** reporte `card_references` (fusion ; deux références
  contradictoires = annulation nommée, comme profils / plafonds).
- **D13 — Détection jamais persistée** : pas de table `card_detections`, pas de
  régénération au `migrate` ; le script d'inventaire (partie A) sert de rapport.
- **D14 — Porte profil / étiquette** : conservée en A–C ; levée en D si Q3 = oui (§3).

## 5. Modèle

### Contrat (`server/src/domain/`)

- `cardDefaults.ts` (nouveau, pur) : `detectHopt(card): 'byName' | 'summonOnce' | 'byName2'
  | 'soft' | 'none' | 'excluded'` avec la phrase-preuve ; `detectNonEngine(card): { availability,
  labels, group } | null` avec le gabarit ; `cardDefaults(card)` = les deux.
- `deckConfiguration.ts` : `Library` gagne `references`, `referencesVersion`, `groups[].is_builtin` ;
  `CardReference` validé (`parseReference`) ; `Availability` inchangé.
- `deckArchive.ts` : inchangé en forme ; sémantique « choix seulement » (D11).

### Schéma (`db/migrations/006-annotation-defaults.sql`, additive sauf la nullabilité)

```
alter table users add column if not exists referent_since timestamptz;
grant select (…, referent_since), update (referent_since) on users to testhand_backoffice;
alter table card_flags alter column is_hopt drop not null;            -- null = hérite
alter table card_flags add column if not exists nonengine_choice boolean not null default false;
alter table nonengine_groups add column if not exists is_builtin boolean not null default false;
create table if not exists card_references (card_id bigint primary key, is_hopt boolean,
  nonengine jsonb, note text, updated_by uuid references users, updated_at timestamptz not null default now());
create table if not exists card_reference_log (… ajout seul, déclencheur …);
-- une seule fois (journal app_migrations) :
update card_flags set is_hopt = null where is_hopt = false;                        -- Q2
update card_flags set nonengine_choice = true where availability is not null;
insert into card_flags (owner_id, card_id, nonengine_choice) … from card_categories … on conflict do update set nonengine_choice = true;
insert into nonengine_groups (owner_id, name, cap_per_turn, is_builtin) select id, 'Mulcharmy', 2, true from users … where not exists …;
update decks set summary = null;
```

Montage dans `docker-compose.yml` et `deploy/docker-compose.prod.yml`, rejeu dans
`run_migration_sequence` (deux branches, avant 003, comme 004 et 005), liste de
`web/e2e/run.mjs`, cas I de `test-migration-sequence.sh`, `check-migration.sql` (privilèges
du rôle back-office sur la nouvelle colonne). Le montage recrée le conteneur `db` au
déploiement suivant (constaté à l'étape 10, Q8).

### Routes

| Route | Garde | Effet |
| --- | --- | --- |
| `GET /api/library` | compte | + `references[]`, `referencesVersion` (max `updated_at`), `groups[].is_builtin` |
| `PUT /api/library/flags/:cardId` | compte | inchangée en forme ; matérialise l'aspect hérité avant d'appliquer (D6) |
| `DELETE /api/library/flags/:cardId?aspect=` | compte | revenir au défaut pour cet aspect |
| `POST /DELETE /api/library/card-categories…` | compte | matérialisent l'aspect non-engine (D6) |
| `PUT /api/references/:cardId` | référent | écrit la référence + journal, NULL sur les résumés de tous les decks contenant la carte |
| `DELETE /api/references/:cardId` | référent | retire la référence (retour à la détection), même invalidation |
| `GET /api/references` | compte | liste complète (pour la page `/references` et l'inventaire) |
| `GET /api/auth/me` | compte | + `referent` |

Toute route nouvelle est privée par défaut (garde `auth.integration.ts`).

### Client

- `lib/effectiveLibrary.ts` (pur) : `(library, cards) → { source: EngineModelSource, origin:
  Map<cardId, { hopt: 'auto'|'ref'|'you'|null, nonengine: … }> }`.
- Appelants de `buildEngineModel` : store (`libraryCalc`), accueil (`sourceFromDetail` reçoit
  désormais les cartes : un `cardsByIds` par deck à recalculer), comparateur, fiche de side,
  planificateur.
- `lib/summary.ts` : inchangé (D8 repose sur `__ENGINE_VERSION__` et la mise à NULL serveur).

## 6. Règles métier (à inscrire au contrat, nouvelle section « Annotations par défaut »)

- **R1** Une valeur effective vient du choix du compte, sinon de la référence, sinon de la
  détection ; l'origine est toujours affichable.
- **R2** La détection est une fonction pure du texte, du nom et du type de la carte ; elle ne
  contient aucune liste de cartes. Une carte d'extra deck n'a jamais de défaut.
- **R3** Le HOPT détecté est une limite **par nom** énoncée par la carte sur elle-même ;
  « once per turn » sans nom n'en est pas une.
- **R4** Un défaut non-engine pose toujours profil **et** étiquette (et plafond pour
  Mulcharmy) ; jamais un profil « préparé ».
- **R5** Un choix du compte ne vaut que pour ce compte, aspect par aspect ; un défaut
  n'est jamais exporté comme un choix.
- **R6** Une référence ne peut être écrite que par un référent ; chaque écriture est
  journalisée et invalide les aperçus des decks qui contiennent la carte, tous comptes.
- **R7** Aucun résumé calculé avec d'autres annotations que les annotations effectives
  courantes n'est affiché (D8).

## 7. Découpage

### A — Détection et rapport (pur, aucune interface, aucun schéma)

`server/src/domain/cardDefaults.ts` + tests sur une **fixture de textes réels** (les 127
cartes jouées, les cartes connues du §2.4, les 15 cas de graphie, Maxx "C", Pot of Sloth,
les 3 Mulcharmy) ; ajout du fichier à `__ENGINE_VERSION__` ; `scripts/annotations-report.ts`
(sur une base fournie : couverture par classe, désaccords avec les choix existants, rapport
d'écart par deck avant / après — même mécanique que `recompute-check.ts`). Livrable : les
tableaux du §2 reproduits par le script, vérifiés contre ceux de cette session. Mutations :
regex affaiblie (nom non littéral), « twice » compté HOPT, extra deck annoté, gabarit Mulcharmy
sans groupe. Tag `annotations-a-ok`.

### B — Modèle, persistance, référent (aucune interface)

Migration 006 et sa séquence, contrat, routes du §5, garde `requireReferent`, `/me`,
sémantique copie sur écriture de `PUT /flags` et des affectations, `DELETE …?aspect=`,
invalidation tous comptes, `effectiveLibrary.ts` et ses appelants, archive JSON (D11),
`prune-stale-cards` (D12). Tests : contrat, intégration PostgreSQL (référence refusée à un
non-référent → 404 / 403 ? — voir Q7 ; matérialisation ; retour au défaut ; NULL des
résumés d'un autre compte ; import n'exporte pas un défaut), `test-migration-sequence.sh`
(cas « F sans 006 »), `rehearsal.sh --fixture`, équivalence 6A sur bibliothèque effective.
Mutations : garde référent retirée, résumé d'autrui non invalidé, `false` → explicite,
défaut exporté. Tag `annotations-b-ok`.

### C — Interface et clôture

Pastilles d'origine, « revenir au défaut », bandeau unique après déploiement, formulaire de
référence (détail de carte) et page `/references`, texte d'aide de l'onglet « Combos &
catégories » ; cartes synthétiques de l'e2e dotées de textes qui exercent la détection ;
scénario e2e `defaults` (compte neuf : HOPT et Handtrap effectifs sans clic, pastille
« auto », retrait puis retour au défaut, référence posée par un compte référent visible
chez un autre compte à la recharge, chiffres persistés) ; rapport d'écart sur l'archive du
8 septembre joint au compte rendu ; docs (contrat, AGENTS.md, server/AGENTS.md, runbook
« déploiement courant » avec migration, DECISIONS.md, décisions compressées, PLAN.md).
Tag `annotations-c-ok`.

### D — Porte profil / étiquette (si Q3 = oui)

Contrat §3, moteur (`nonEngine[i] = profile !== undefined`), cas Q1 réécrit sur décision,
garde serveur levée, mode « Non-engine » unique dans la grille, e2e `nonengine` adapté,
rapport d'écart. Tag `annotations-d-ok`.

## 8. Vérifications à chaque partie

`npm run typecheck`, `npm run build`, `node scripts/test-quiet.mjs`, `test:integration`
(55433) dès B, `npm run e2e -w web` dès B (fixture) puis scénario `defaults` en C,
`test-migration-sequence.sh` et `rehearsal.sh --fixture` en B et C (jamais en parallèle de
l'e2e), contrôle par mutation (≥ 4 par partie), relecture par un sous-agent neuf confrontant
le livré à ce plan, commit Conventional Commits, tag non poussé. Conteneurs jetables détruits.

## 9. Risques et pièges

- **Accueil sans textes de carte** : un appel `cardsByIds` par deck recalculé ; un catalogue
  incomplet (carte absente, cf. la carte inconnue des 127) donne « aucun défaut », jamais une
  erreur.
- **Renommage du catalogue** (Maliss <C>, Zereort) : la normalisation de nom est mesurée en A ;
  au-delà, la référence corrige.
- **Utilisateur en session pendant une écriture de référence** : ses chiffres suivent la
  bibliothèque chargée au démarrage jusqu'à la recharge (comme aujourd'hui entre deux onglets).
- **Migration 006** : nullabilité de `is_hopt` = seule modification non additive ; retour
  arrière par l'archive pré-migration de `deploy.sh`.
- **Rôle back-office** : la colonne `referent_since` doit rester dans `KEPT_ACROSS_SEQUENCE`
  et `check_after_migration` (forme de `users` changée une seconde fois, `RESHAPED_BY_006`).
- **E2E** : la fixture attend « HOPT absent » sur 90000005 par choix explicite ; les textes
  synthétiques ne doivent pas déclencher la détection par accident.

## 10. Questions ouvertes

- **Q1 — Référent : colonne `users.referent_since` (D5) ou valeur de `users.role` ?** Une
  valeur de rôle empêche un compte d'être admin **et** référent (toi). Et l'amorçage du
  premier référent : par le back-office de l'autre workspace (il lui faut alors le nom de
  colonne, que je fige), ou par une action `referent grant | revoke` ajoutée à
  `deploy/backoffice-role.sh` (même chemin journalisé que l'admin) ?
- **Q2 — Lignes `is_hopt = false` existantes** : tu as dit que seules les `true` deviennent des
  choix explicites ; les 8 `false` de ton compte sont pourtant des clics explicites (aucun
  drapeau `dead_*`), et 4 d'entre elles (Black Chaos, Black Luster Soldier - Soldier of Light
  and Darkness, Elfnote Regina, Elfnotes: Welcome Home) passeraient à HOPT par détection.
  Je propose `false` → hérite (ta consigne) ; confirmes-tu, ou `false` → choix explicite ?
- **Q3 — Partie D** : lever la porte (profil seul déclenche le comptage, Q1 de 5A inversée par
  décision) ? Oui / non / plus tard.
- **Q4 — Étiquettes de référence** : les seuls noms fournis de base (« Handtrap », « Board
  breaker ») suffisent-ils ? Ton compte utilise « Board Disruption » et « Dead First ». Si le
  référent doit pouvoir créer une étiquette commune, elle devient un objet système supplémentaire
  (table, rétro-création par compte) : je le ferais en C seulement sur demande.
- **Q5 — Détection strictement textuelle** (D2) : les cartes « redondantes » sans limite écrite
  (Droll & Lock Bird, Dimension Shifter, Called by the Grave à deux exemplaires…) restent sans
  défaut HOPT tant que la référence ne les pose pas. D'accord ?
- **Q6 — Aucun profil « préparé » par détection** (D3) : Called by the Grave, Crossout
  Designator, Forbidden Droplet, Solemn Strike n'ont pas de défaut non-engine ; le référent les
  pose. D'accord ?
- **Q7 — Écriture de référence par un non-référent** : 404 (comme une ressource d'autrui) ou 403
  (le rôle existe, il manque) ? Le dépôt n'a jamais renvoyé 403 ; je propose 404 par cohérence.
- **Q8 — Déploiement** : la migration 006 recrée le conteneur `db` (nouveau montage) ; le runbook
  « déploiement courant » repasse par une vraie migration (variante avec archive pré-migration
  vérifiée). Texte du bandeau à valider.
- **Q9 — Rapport d'écart** : sur l'archive du 8 septembre seulement (16 decks, ton compte), ou
  sur une archive fraîche de la production (sauvegarde sur le VPS, sur ta demande explicite,
  copiée hors dépôt), qui contiendrait les decks des autres comptes ?

## 11. Réponses du 16 septembre 2026 et plan révisé

Réponses de l'utilisateur aux questions du §10, et ce qui change dans le plan :

- **Q1 → hiérarchie de rôles `admin > referent > user`** : `users.role` gagne la valeur
  `referent` ; un admin est référent. Le back-office est fusionné dans `main` (vérifié :
  la branche `wip/audit-materiaux` est identique à `main`, `admin/` présent) ; l'attribution
  reste hors des routes de ce dépôt (`deploy/backoffice-role.sh` apprend la cible `referent`,
  même chemin journalisé que l'admin). La base de dev peut recevoir un rôle pour les essais.
  **D5 remplacée.**
- **Q2 → `false` existants → hérite ; détection = valeur par défaut.** Black Chaos ne doit pas
  être HOPT : la classe `summonOnce` (invocation limitée par nom) **n'est plus un HOPT par
  détection** (94 cartes du catalogue, 1 jouée) ; elle reste reportée par l'inventaire. Les
  trois autres désaccords étaient des erreurs de saisie : la détection les corrige.
- **Q3 et Q4 → les étiquettes sortent des couches par défaut ; le profil seul compte.**
  Formulation simple de Q3 : aujourd'hui une carte n'est comptée non-engine que si elle a
  un profil ET une étiquette. Désormais **le profil suffit** ; les étiquettes restent des
  axes facultatifs du compte (ventilation, critères), jamais posées par la détection ni par la
  référence. Le moteur, l'oracle de référence et le cas Q1 de 5A changent **sur cette
  décision** (jamais pour faire passer un test) : une carte profilée sans étiquette entre dans
  le potentiel U et dans aucune catégorie. **D3, D4, D7, D14 remplacées ; la partie D du §7 est
  intégrée au plan.**
- **Q4 (suite) → cinquième profil « Tour adverse seul, type Droll »** (`reactive`) : premier,
  carte initiale = tour adverse suivant ; second, carte initiale = tour adverse initial
  seulement ; second, sixième carte = aucune fenêtre. Contrat §3, moteur, oracle, libellés.
  La détection distingue `reactive` de `flexible` par la clause de déclenchement : si elle
  nomme l'adversaire comme acteur (« your opponent … », « opponent's … ») avant le deux-points,
  la carte est réactive (Effect Veiler, Nibiru, Droll, Skull Meister) ; sinon flexible (Ash,
  Ghost Ogre, Ghost Belle, D.D. Crow). Mesuré en partie A.
- **Q5 → confirmé** (détection strictement textuelle, aucune liste de cartes).
- **Q6 → confirmé** (jamais de profil « préparé » par détection).
- **Q7 → 404** pour une écriture de référence par un non-référent.
- **Q8 → confirmé** : la migration recrée le conteneur `db` ; texte du bandeau validé.
- **Q9 → rapport d'écart sur l'archive du 8 septembre seulement** ; la base de production
  peut être remise à zéro au déploiement si ses données gênaient (ce n'est pas le cas : la
  migration 006 s'applique à une base existante), décision et exécution restant à
  l'utilisateur.

### Décisions révisées

- **D3′** Détection non-engine = **profil** (et plafond « Mulcharmy »), jamais une étiquette :
  gabarit Mulcharmy → `early` + groupe « Mulcharmy » (2) ; handtrap générique de monstre →
  `reactive` ou `flexible` selon la clause de déclenchement ; piège activable depuis la main
  sans condition d'archétype → `flexible` ; retrait de masse sans archétype → `breaker`.
- **D4′** `card_references` : `is_hopt boolean null` (null = détection), `availability text null`
  + `nonengine_set boolean` (true et null = « pas non-engine »), `group_name text null`, note,
  auteur, date ; journal en ajout seul.
- **D5′** `users.role in ('user','referent','admin')` ; `isReferent = role in ('referent','admin')`
  exposé par `/api/auth/me` ; garde `requireReferent` → 404 ; `backoffice-role.sh grant <email>
  --role referent|admin`.
- **D7′** Un seul objet fourni de base nouveau : groupe « Mulcharmy » (2) par compte
  (`nonengine_groups.is_builtin`), créé à l'inscription et rétro-créé par 006. Les étiquettes
  fournies de base (« Handtrap », « Board breaker ») restent ce qu'elles sont : des axes du compte.
- **D14′** Porte levée : `nonEngine[i] = profile !== undefined` ; garde serveur « profil sans
  étiquette » supprimée ; mode « Non-engine » de la grille = choix du profil (étiquette
  facultative) ; avertissement « étiquetée sans profil, non comptée » conservé.
- **D15** HOPT par détection = classe `byName` seulement (limite par nom propre, y compris « you
  cannot activate "Nom" … this turn » et « once per Duel ») ; `summonOnce`, `byName2`, `soft`,
  `none` = pas HOPT.

### Découpage révisé

| Partie | Contenu | Tag |
| --- | --- | --- |
| A | `server/src/domain/cardDefaults.ts` (pur, partagé), fixture de textes réels et vérité terrain des 127 cartes jouées (sans donnée de compte), tests, empreinte `__ENGINE_VERSION__`, `scripts/annotations-report.ts` (couverture et accords sur une base jetable) | `annotations-a-ok` |
| B | Contrat §3 et moteur : profil `reactive`, porte levée (oracle, cas Q1 réécrit sur décision, garde serveur), libellés | `annotations-b-ok` |
| C | Migration 006 (rôle `referent`, `is_hopt` nullable, `nonengine_choice`, groupe fourni de base, `card_references` + journal, résumés à NULL), routes, `effectiveLibrary.ts` et appelants, archive JSON, `prune-stale-cards`, `backoffice-role.sh`, séquence de déploiement, tests d'intégration, rapport d'écart | `annotations-c-ok` |
| D | Interface : pastilles d'origine, retour au défaut, bandeau, mode Non-engine par profil, formulaire et page de référence, scénario e2e `defaults`, docs et clôture | `annotations-d-ok` |

## 12. Compte rendu A (16 septembre 2026)

### Livré

- `server/src/domain/cardDefaults.ts` (pur, partagé avec le web, sans dépendance Node) :
  `detectHopt` (classes `byName` / `summonOnce` / `byName2` / `soft` / `none` / `excluded`, avec
  la fenêtre-preuve), `detectNonEngine` (gabarits `mulcharmy` → précoce + plafond « Mulcharmy »,
  `monster-handtrap` → réactive ou flexible selon la clause de déclenchement, `trap-from-hand` →
  flexible, `mass-removal` → board breaker), `cardDefaults` (HOPT = `byName` seulement, D15),
  `normalizeName`, `isMainDeckType`, `MULCHARMY_GROUP` / `MULCHARMY_CAP`. Les limites sont
  cherchées dans une **fenêtre** « You can only … → borne temporelle », pas dans une phrase :
  un découpage en phrases coupait les noms à point (« D.D. Crow », « U.A. ») et perdait 87 cartes.
  Le type `DefaultAvailability` = profils du contrat + `reactive`, qui entre au contrat en B.
- `web/vite.config.ts` : le module entre dans l'empreinte `__ENGINE_VERSION__` (D1, D8).
- Fixtures de textes réels, sans donnée de compte : `server/tests/fixtures/card-texts.json`
  (84 cartes choisies : handtraps, board breakers, engine, boss, graphies, guillemets imbriqués,
  « twice », « per Duel »), `card-texts-played.json` (les 126 cartes de main de l'archive du
  8 septembre présentes au catalogue), `played-choices.json` (decks, copies max, choix HOPT et
  étiquettes du compte expert, comptes numérotés).
- `server/tests/cardDefaults.test.ts` (7 tests, `npm test -w server` et test-quiet) : classes
  attendues carte par carte, accord exact avec les choix du compte expert (97 des 99 HOPT
  retrouvés ; manqués : Droll & Lock Bird, Abominable Unchained Soul ; 3 « faux » corrigés :
  Black Luster Soldier - Soldier of Light and Darkness, Elfnote Regina, Elfnotes: Welcome Home ;
  Black Chaos reste `summonOnce`), 11 cartes sans choix couvertes, profils proposés sur les
  jouées (liste exacte), manqués et faux positifs assumés nommés.
- `scripts/annotations-report.ts` (base jetable seulement, `--out`) : classes sur le catalogue,
  matrice détection / choix par compte numéroté, désaccords nommés, profils proposés face aux
  étiquettes existantes ; tolère une archive antérieure à 002.

### Mesures reproduites par le script (archive du 8 septembre, conteneur 55446)

| Classe HOPT | Cartes |
| --- | --- |
| `byName` (HOPT) | 4 623 |
| `summonOnce` | 97 |
| `byName2` | 13 |
| `soft` | 1 279 |
| `none` | 6 117 |
| exclues | 2 400 |

Gabarits non-engine : retrait de masse 68, handtrap réactive 48, handtrap flexible 48, piège depuis
la main 13, Mulcharmy 3. Cartes jouées : 111 HOPT par défaut sur 126 (88 %), 55 à deux exemplaires
ou plus ; désaccords avec le compte : les 5 nommés ci-dessus, tous expliqués.

### Écarts au plan

- `summonOnce` n'est plus HOPT (Q2) : Abominable Unchained Soul (invocation depuis la main limitée
  par nom, jouée à 1 exemplaire) rejoint Droll parmi les cartes à poser par la référence.
- Faux positifs assumés et nommés dans le test : Griffoh, The Iris Swordsoul (formulation générique
  sur une carte d'engine). Manqués assumés : Kurikara Divincarnate, Bystial Magnamhut,
  PSY-Framegear Gamma (la fenêtre rapide est dans une autre phrase, ou l'effet cite une autre
  carte). Herald of Orange Light et Artifact Lancea, prévus manqués au §2.4, sont trouvés
  (« send this card and 1 other … », « Tribute this card from your hand »), tous deux réactifs.
- Kuriboh est réactif (déclenché par l'attaque adverse), pas flexible comme prévu au §2.4.

### Relecture indépendante (sous-agent à contexte neuf)

Un bloquant corrigé (« Lancea » cité comme manqué dans les décisions compressées alors qu'elle est
trouvée) ; remarque retenue : le repli de nom normalisé acceptait un nom **préfixe** d'un autre nom cité
(« Dark Magician » dans « "Dark Magician Girl" ») et un nom **hors guillemets** — il ne compare plus que
les segments entre guillemets de la fenêtre, par égalité ; les deux textes adverses sont dans le test ;
chiffres du catalogue inchangés (4 623 byName). Commentaire dupliqué et mise en forme de
`scripts/tsconfig.json` corrigés. Remarques laissées : découpage en phrases des gabarits non-engine (faux
négatifs sur les noms à point, assumés), branche « up to N times » sans carte de fixture.

### Vérifications exécutées

`npm run typecheck` (serveur, web, scripts), `npm run build -w web`, `node scripts/test-quiet.mjs` (283 web, 21 serveur),
`scripts/annotations-report.ts` sur la restauration jetable, contrôle par mutation (voir ci-dessous).
Conteneur `testhand-annot-inventory` détruit en fin de partie.

### Contrôle par mutation (6 posées, 6 détectées)

M1 repli de nom normalisé retiré · M2 « twice per turn » compté comme limite à 1 · M3 extra deck
annoté · M4 gabarit Mulcharmy sans plafond · M5 invocation limitée comptée HOPT · M6 clause de
déclenchement ignorée (tout flexible). Fichier restauré, empreinte identique.

## 13. Modèle révisé pour la partie C (après les réponses du §11)

### Schéma — extension de `006-annotation-defaults.sql` (ouverte en B)

```
-- rôles (Q1) : hiérarchie admin > referent > user
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('user', 'referent', 'admin'));
-- choix du compte, copie sur écriture par aspect (D6)
alter table card_flags alter column is_hopt drop not null;            -- null = hérite du défaut
alter table card_flags add column if not exists nonengine_choice boolean not null default false;
-- plafond fourni de base (D7′)
alter table nonengine_groups add column if not exists is_builtin boolean not null default false;
-- référence commune (D4′)
create table if not exists card_references (
  card_id bigint primary key check (card_id > 0),
  is_hopt boolean,                     -- null = laisser la détection décider
  nonengine_set boolean not null default false,  -- true = availability/group font foi (même null = « pas non-engine »)
  availability text check (availability in ('early','flexible','prepared','breaker','reactive')),
  group_name text check (group_name is null or length(group_name) between 1 and 200),
  note text check (note is null or length(note) <= 2000),
  updated_by uuid references users on delete set null,
  updated_at timestamptz not null default now(),
  check (nonengine_set or (availability is null and group_name is null)),
  check (group_name is null or availability is not null)
);
create table if not exists card_reference_log (… card_id, action, before jsonb, after jsonb, actor uuid, at … ; ajout seul par déclencheur, comme backoffice_audit);
-- une seule fois (journal 006) :
update card_flags set is_hopt = null where is_hopt = false;                          -- Q2
update card_flags set nonengine_choice = true where availability is not null;
insert into card_flags (owner_id, card_id, is_hopt, nonengine_choice) select n.owner_id, cc.card_id, null, true from card_categories cc join nonengine_categories n on n.id = cc.category_id on conflict (owner_id, card_id) do update set nonengine_choice = true;
insert into nonengine_groups (owner_id, name, cap_per_turn, is_builtin) select u.id, 'Mulcharmy', 2, true from users u where not exists (select 1 from nonengine_groups g where g.owner_id = u.id and g.name = 'Mulcharmy');
update nonengine_groups set is_builtin = true where name = 'Mulcharmy' and not is_builtin;
update decks set summary = null;
```

`auth/account.ts` crée aussi le groupe « Mulcharmy » (2, `is_builtin`) à l'inscription ; un groupe
fourni de base ne se supprime pas (`DELETE /library/groups/:id` → 400 comme une étiquette de base),
sa limite reste modifiable. Le rôle `testhand_backoffice` reçoit `select` sur `card_references`
(lecture seule, futur écran) — rien d'autre.

### Sémantique des choix (copie sur écriture par aspect)

| Aspect | État hérité | Matérialisation | Retour au défaut |
| --- | --- | --- | --- |
| HOPT | `card_flags.is_hopt is null` (ou aucune ligne) | `PUT /flags/:id { is_hopt }` écrit true / false | `DELETE /flags/:id?aspect=hopt` → `is_hopt = null` |
| Non-engine (profil, plafond, étiquettes) | `nonengine_choice = false` (ou aucune ligne) | premier geste (`PUT /flags` avec `availability` ou `group_id`, `POST/DELETE /card-categories`) : le serveur pose d'abord la valeur EFFECTIVE (profil + plafond de base résolus depuis `references` puis détection **fournie par le client** dans la requête, voir ci-dessous), passe `nonengine_choice = true`, puis applique le geste | `DELETE /flags/:id?aspect=nonengine` → `availability = null`, `group_id = null`, `nonengine_choice = false`, affectations d'étiquettes supprimées |

Le serveur ne calcule jamais la détection (D13) : le client envoie, avec le premier geste sur un
aspect hérité, la valeur effective qu'il affiche (`inherited: { availability, group_name }`) ; le
serveur la matérialise telle quelle. Une écriture sans ce champ sur un aspect hérité matérialise
la référence seule (ou rien). C'est le seul chemin où le client « dit » une valeur par défaut au
serveur, et elle est validée par le contrat comme n'importe quel profil.

### Routes

| Route | Garde | Effet |
| --- | --- | --- |
| `GET /api/library` | compte | + `references: CardReference[]`, `referencesVersion` (max `updated_at` ou `'0'`), `groups[].is_builtin`, `flags` avec `is_hopt: boolean | null` et `nonengine_choice` |
| `PUT /api/library/flags/:cardId` | compte | corps : `{ is_hopt?, availability?, group_id?, inherited? }` ; matérialise l'aspect hérité avant d'appliquer |
| `DELETE /api/library/flags/:cardId?aspect=hopt|nonengine` | compte | retour au défaut pour cet aspect |
| `POST / DELETE /api/library/card-categories…` | compte | matérialisent l'aspect non-engine (avec `inherited` optionnel dans le corps du POST) |
| `GET /api/references` | compte | liste complète + journal des 50 dernières écritures |
| `PUT /api/references/:cardId` | référent (404 sinon) | corps `{ is_hopt: boolean | null, nonengine_set, availability, group_name, note }` ; journal ; `update decks set summary = null where id in (select deck_id from deck_cards where card_id = $1)` tous comptes |
| `DELETE /api/references/:cardId` | référent (404 sinon) | retire la référence ; journal ; même invalidation |
| `GET /api/auth/me` | compte | + `role` (`user` / `referent` / `admin`) et `referent: boolean` |

Garde `requireReferent(req)` : `role in ('referent','admin')`, sinon `error(404)`. Le rôle est lu
avec la session (`SessionUser.role`).

### Client

- `web/src/lib/effectiveLibrary.ts` (pur, dans `__ENGINE_VERSION__`) :
  `effectiveLibrary(library, cards: Record<number, Card>, cardIds: number[])` → `{ source:
  EngineModelSource-partiel (hopt, profiles, groups), origin: Map<cardId, { hopt: Origin | null;
  nonengine: Origin | null }> }` avec `Origin = 'choice' | 'reference' | 'detection'`. Le plafond
  d'un défaut se résout par nom vers le groupe fourni de base du compte ; absent → profil sans plafond.
- Appelants : store (`libraryCalc`, `annotationCalc`), accueil (`sourceFromDetail` reçoit les cartes),
  comparateur, fiche de side, planificateur, `scripts/annotations-report.ts` (rapport d'écart).
- Archive JSON : `library.hoptCardIds` = choix explicites `true` seulement ; `profiles` = aspects
  non-engine matérialisés seulement ; import : un `hoptCardIds` matérialise `true`, un profil
  matérialise l'aspect.

### Découpage de C en lots délégables

| Lot | Contenu | Dépend de |
| --- | --- | --- |
| C1 | 006 étendue (§ ci-dessus), `account.ts` (groupe de base), `backoffice-role.sh` (`--role referent|admin`), séquence et gardes (`test-migration-sequence.sh` : cas « 005 sans 006 » vérifie `is_hopt` false → null, `nonengine_choice`, groupe de base), `check-migration.sql` | B |
| C2 | Contrat (`CardReference`, `parseReference`, `Library`), routes (`library.ts`, `references.ts`, `auth` `/me`), `requireReferent`, invalidation tous comptes, tests d'intégration (55433) | C1 (schéma) |
| C3 | `effectiveLibrary.ts` + tests, appelants, archive JSON, `prune-stale-cards` (`card_references`), rapport d'écart dans `annotations-report.ts` | C2 (forme de `Library`) |

## 14. Compte rendu B (16 septembre 2026)

### Livré

- **Profil `reactive`** (« Réactive », « Ra », type Droll) : contrat (`AVAILABILITY_PROFILES`), moteur
  (`PROFILES`, `capacities` : premier = tour adverse suivant, second = tour adverse initial, sixième
  sans fenêtre ; `sixthSensitive`), oracle (`windows`, N01 de `rules.test.ts`), libellés et infobulle
  (`types.ts`), deck « profil réactif et carte profilée sans étiquette » ajouté aux SPECS du pont B02
  (`chronology.test.ts`), tests moteur (`engine.test.ts`) et modèle (`engineModel.test.ts`).
- **Porte profil / étiquette levée** (D14′, réponses Q3 / Q4) : `nonEngine[i] = profile !==
  undefined`, signature `{ cats: [] }` pour une profilée sans étiquette ; `deckOracle.ts` aligné ;
  cas Q1 de `chronology.test.ts` **réécrit sur décision** (commenté et daté) ; `buildEngineModel`
  suit les cartes profilées sans étiquette ; gardes Q1 levées dans `library.ts`, `deckStore.ts`
  (`setProfile`), `AnnotationGrid.tsx` (mode Profil sans compteur « ignorées ») ; textes du mode Profil
  et de `ModeBar` ; tests `persistence.test.ts` et `persistence.integration.ts` adaptés ; contrat
  §3 (tableau et révision datée), `cas-reference.md` (ligne Q1–Q5).
- **Migration `006-annotation-defaults.sql`** (sous-agent, relu) : contrainte CHECK de
  `card_flags.availability` retrouvée par `pg_constraint` (seule colonne), supprimée, recréée avec
  `reactive` ; DDL idempotent hors journal, journalisation une fois, refus nominatif sans 002 ;
  branchée dans les trois composes (`06-annotation-defaults.sql`), `lib.sh` (deux branches, après
  005, avant 003), `check-migration.sql`, `web/e2e/run.mjs`, `test-migration-sequence.sh` (cas
  « F sans 006 » + rejeu, cas I), suites d'intégration (auth, persistence, purge), README de la pile
  locale, runbook (bloc prospectif de la variante « déploiement courant »), AGENTS.md et
  server/AGENTS.md. Appliquée par stdin sur la base de dev (journal 001, 002, 003, 004, 006).

### Vérifications exécutées

`npm run typecheck` · `npm run build` · `node scripts/test-quiet.mjs` (291 web, 21 serveur) ·
`test:integration` sur 55433 (12 + 14 + 11) · `npm run e2e -w web` (10 scénarios OK, `nonengine`
compris) · `bash deploy/test-migration-sequence.sh` (99 gardes A–J, +13 pour 006) ·
`bash deploy/rehearsal.sh --fixture` (RÉPÉTITION CONFORME, 269 s) · conteneur jetable 55447 :
`reactive` refusé avant 006, accepté après, `bogus` refusé, rejeu sans effet, refus sans 002.
Conteneurs jetables supprimés.

### Contrôle par mutation (5 posées, 5 détectées)

M1 porte rétablie (profil ET étiquette) → `engine.test` « Profil sans étiquette » · M2 réactive =
flexible en second → `engine.test` « Profil réactif » · M3 sixième réactive non distinguée → pont B02
« profil réactif » · M4 modèle : carte profilée sans étiquette non suivie → `engineModel.test` D14′ ·
M5 oracle : réactive sans fenêtre en premier → N01. Fichiers restaurés, empreintes identiques.

### Relecture indépendante (sous-agent à contexte neuf)

Un bloquant corrigé : le menu ⋯ d'une carte imposait encore « poser d'abord une étiquette » avant
de proposer un profil (garde retirée, profils proposés à toute carte). Remarques retenues : `N` du
comparateur et de l'export Excel = copies **profilées** (`scenarioCounts`, test d'identité de
l'étape 7 aligné : 13 au lieu de 16 sur la fixture) ; plafond partagé ajouté aux deux réactives du
deck B02 (« w », 1) ; `deckConfiguration.ts` entre dans `__ENGINE_VERSION__` ; texte de l'onglet
« Combos & catégories », commentaire du scénario `nonengine`, continuation de ligne du cas I,
runbook C5 qualifié (l'ancienne app n'écrit jamais `reactive` mais ne sait pas le lire). Décision
consignée : le geste « retirer » du mode combiné retire l'étiquette puis le profil devenu seul
(annulation du geste « poser »). Vérifications rejouées après corrections : typecheck, suite complète,
e2e `setup, guards, nonengine, compare`.

### Écarts au plan et notes

- La détection distingue `reactive` de `flexible` (partie A) ; le mode Non-engine combiné de la
  grille pose toujours étiquette + profil (l'interface par profil seul est en partie D).
- Deux « 06 » dans `deploy/docker-compose.local.yml` (`06-annotation-defaults.sql` et le fichier
  local `06-backoffice-login`) : ordre lexical correct ; à renuméroter en C si gênant.
- `deploy/README.md` §9 énumère toujours « schéma → 001 → 002 → 003 » (énumération partielle
  par choix) ; seule la ligne de la pile locale cite 006.

## 15. Compte rendu C (17 septembre 2026)

Deux sous-agents en parallèle : C1 (migration et déploiement), terminé et rapporté ; C2 / C3 (contrat,
routes, bibliothèque effective), interrompu sans rapport. Repris par un agent suivant, qui a relu tout
le code C2 / C3 contre le §13, corrigé, complété, puis fait passer la clôture.

### Livré

- **Migration 006 étendue** (C1) : rôle `referent` (`users_role_check` à trois valeurs), `card_flags.is_hopt`
  nullable, `card_flags.nonengine_choice`, `nonengine_groups.is_builtin`, `card_references`,
  `card_reference_log` (ajout seul, déclencheur `enable always`), `grant select` des deux tables au rôle
  `testhand_backoffice` ; refus nominatifs sans 002 ou 005 ; données migrées une fois sous
  `006-annotation-defaults/c`. Séquence (`lib.sh` : `snapshot_before_006`, `check_006_data`),
  `check-migration.sql`, `test-migration-sequence.sh` (cas « F sans 006 » avec données représentatives),
  `backoffice-role.sh grant <email> --role referent|admin`, runbook.
- **Contrat** (`deckConfiguration.ts`) : `USER_ROLES`, `isReferentRole`, `CardReference`, `parseReference`.
- **Routes** : `GET /api/library` (+ `choices`, `references`, `referencesVersion`, `groups[].is_builtin`),
  `PUT /library/flags/:id` en copie sur écriture (`inherited`), `DELETE /library/flags/:id?aspect=`,
  `GET /api/references` (+ journal, auteurs visibles des référents seuls), `PUT` / `DELETE
  /api/references/:id` (référent ou admin, sinon 404 ; journal ; aperçus à NULL tous comptes),
  `/api/auth/me` (+ `role`, `referent`) ; `auth/role.ts` (rôle relu à chaque requête) ; plafond fourni de
  base non supprimable ; `insertAccount` crée « Mulcharmy » (2).
- **Client** : `web/src/lib/effectiveLibrary.ts` (fusion pure, origine par aspect, valeur héritée) ;
  store (`deriveEffective`, `resetAnnotation`, bascule HOPT depuis la valeur effective, `inherited` au
  premier geste non-engine) ; `sourceFromDetail` / `compareSideOf` avec cartes obligatoires (accueil,
  comparateur, fiche de side) ; `api.ts` (références, retour au défaut).
- **Archive JSON** : export = choix seuls (inchangé en forme) ; import d'un HOPT = choix `true`, d'un
  profil = aspect matérialisé (`is_hopt` NULL explicite) ; « faux » ou « pas non-engine » choisis
  contredisent l'import (409).
- **`prune-stale-cards`** : `card_references` reportée (deux références = refus), HOPT tri-état,
  `nonengine_choice`, conflit « pas non-engine » contre profil ; journal ni compté ni reporté.
- **Rapport d'écart** : `scripts/annotations-report.ts --gap` (ci-dessous).

### Défauts trouvés à la reprise et corrigés

Relecture de l'agent : import JSON d'un profil posant « pas HOPT » (`default false`) ; journal des
références compté par `prune-stale-cards` (toute carte renommée ayant eu une référence bloquait le
contrôle final) ; `referencesVersion` inchangée au retrait ; références lues hors de la transaction de
`GET /library` ; reprise d'un brouillon sans textes des cartes ajoutées ; fixture e2e en collision avec
le « Mulcharmy » fourni de base (le scénario règle désormais sa limite à 1) ; tests d'intégration jamais
exécutés et faux (enregistrement tardif des routes, formes de réponse d'avant C, plafond conservé au
changement de profil). Relecture indépendante (sous-agent à contexte neuf, aucun bloquant) : deux clics
du mode Non-engine combiné effaçaient un profil détecté ; un échec de `cardsByIds` produisait et
persistait des chiffres sans défauts ; import d'un profil contre « pas non-engine » choisi accepté ;
`adopt` et inscription sur base antérieure à 006 en échec ; aucune garde sur `sourceFromDetail` ; auteurs
des références exposés à tout compte ; `lib/deckConfiguration.ts` hors `__ENGINE_VERSION__` ; sélecteur
fragile dans `setup.mjs`. Tous corrigés et gardés. Remarques laissées : `referencesVersion` n'est lue par
aucun client (un aperçu calculé avant une écriture de référence peut être réécrit après son
invalidation, risque assumé au §9) ; une archive dont le « Mulcharmy » vaut 1 s'importe en 409 sur un
compte resté à 2 (règle « autre limite » inchangée) ; ✕ affiché sur le plafond fourni de base (partie
D) ; `recompute-check.ts` reste une preuve d'équivalence du moteur sur les choix bruts, l'effet des
défauts n'est mesuré que par `--gap`.

### Écarts au §13 (dont ceux du lot C1)

1. Données migrées une seule fois sous le second marqueur `006-annotation-defaults/c` : un `update`
   idempotent effacerait les `false` devenus choix et revidait les aperçus à chaque déploiement ; le
   marqueur principal était déjà journalisé en B sur des bases d'essai.
2. `card_reference_log.actor` sans clé étrangère : `on delete set null` émet un UPDATE refusé par le
   déclencheur d'ajout seul, plus aucun compte n'était supprimable.
3. « Aucune ligne `is_hopt = false` » contrôlé strictement à la première application seulement
   (`check_006_data`) ; informatif dans `check-migration.sql`.
4. `card_flags.is_hopt` garde `default false` : toute insertion serveur écrit `is_hopt` explicitement
   (vérifié dans `library.ts` et `decks.ts`, gardé par la suite `persistence`).
5. Cartes seulement étiquetées non matérialisées ; plus généralement les étiquettes restent hors copie
   sur écriture : « revenir au défaut » non-engine les conserve (le tableau du §13 les supprimait).
6. Bug de la partie B corrigé par C1 : `\n` littéral dans la boucle `docker cp` du cas I.
7. `referencesVersion` = dernier id du journal (au lieu du plus grand `updated_at`).
8. Plafond fourni de base : nom ignoré au PATCH (pas de 400).

Liens fragiles gardés : `check-migration.sql` met un KO sur tout compte sans « Mulcharmy » fourni de base
→ `auth.integration.ts` vérifie le groupe après une inscription réelle (tous les chemins passent par
`insertAccount`). `card_references.group_name` n'est garanti par rien → un nom absent donne un profil sans
plafond (`effectiveLibrary.test.ts`). Rejouer 005 après 006 retirerait les `grant select` de 006 → l'ordre
est 005 puis 006 partout, et `check-migration.sql` le signale.

### Rapport d'écart (archive du 8 septembre, conteneur jetable 55446, détruit)

`node --import tsx scripts/annotations-report.ts --db …55446… --gap`, après restauration, schéma, 001, 002,
004, 005, 006 puis 003 (empreinte `e0efff5c…`). Avant = choix seuls, après = bibliothèque effective, même
moteur. L'archive précède 002 : aucun profil n'était posé, aucune référence n'existe ; tout l'écart vient
donc de la détection.

- **P(≥ 1 départ) et brick : écart exactement nul dans les 16 decks, en premier comme en second.** Les HOPT
  détectés en plus (cartes Elfnote, Light and Darkness Ritual, Black Luster Soldier - Soldier of Light and
  Darkness, The Hallowed Azamina, Ruler of the End of the World, Crystron Tristaros, Fydraulis Harmonia,
  Ghost Ogre & Snow Rabbit) ne changent pas ces deux grandeurs sur ces decks.
- **E[U] : de 0 à +1,500 en premier (15 decks sur 16 ; Branded inchangé), de +0,374 à +2,166 en second
  (16 decks).** Plus grands écarts : Elfnote (+1,500 / +2,157), Ryzeal (+1,424 / +2,109), Azamina RoLaD
  (+1,350 / +2,166). Cartes en cause : Mulcharmy Fuwalos et Purulia (précoce + plafond), Ash Blossom,
  Dominus Impulse et Spark, Infinite Impermanence, Ghost Ogre, Ghost Belle, Dimension Shifter
  (flexible), Droll & Lock Bird, Effect Veiler, Fydraulis Harmonia, K9-17 Izuna, K9-ØØ Lupis (réactive),
  et Griffoh (flexible, faux positif assumé en A, présent dans six decks).

### Vérifications exécutées

`npm run typecheck` · `npm run build` · `node scripts/test-quiet.mjs` (301 web, 22 serveur) ·
`test:integration` sur 55433 (auth 12, persistence 17, purge 13) · `bash deploy/test-migration-sequence.sh`
(130 gardes, cas A–J) · `bash deploy/rehearsal.sh --fixture` : RÉPÉTITION CONFORME (restauration, séquence, recalcul contre l'ancien moteur, 10 scénarios e2e sur la pile migrée, retour arrière ; un premier passage avait échoué sur la garde P3 du scénario `side`, lue avant le rendu du clic, non reproduite seule, garde rendue robuste) · `npm run e2e -w web` (10 scénarios) · `seedBuiltinCategories` exécutée sur une base au schéma seul
(étiquettes créées, groupe sauté) · conteneurs jetables détruits.

### Contrôle par mutation (10 posées, 10 détectées)

W1 détection prioritaire sur la référence (HOPT) → `effectiveLibrary.test`, `defaults.test` · W2 bascule
HOPT depuis le choix brut → `defaults.test` · W3 valeur héritée non envoyée → `defaults.test` · W4
`sourceFromDetail` sans fusion → `effectiveLibrary.test` · W5 « retirer » efface un profil détecté →
`defaults.test` · S1 garde référent retirée → `persistence` · S2 aperçus d'autrui non invalidés →
`persistence` · S3 import d'un profil sans `is_hopt` explicite → `persistence` · S4 journal compté par
`prune-stale-cards` → `purge` · S5 auteurs visibles de tous → `persistence`. Fichiers restaurés,
empreintes identiques.
