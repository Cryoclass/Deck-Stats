# Décisions & écarts vs. document de référence

## Annotations par défaut — HOPT et profils pré-remplis (16 septembre 2026)

Plan validé en séance, consigné dans [docs/annotations-par-defaut.md](docs/annotations-par-defaut.md)
(inventaire prouvé, décisions D1–D15 et révisions D3′/D4′/D5′/D7′/D14′, règles R1–R7, réponses Q1–Q9,
découpage A–D). Les décisions validées ne sont pas reprises ici ; ce qui suit est ce que l'agent a
tranché en les appliquant.

### Partie A — détection (16 septembre 2026)

- **Limites cherchées dans une fenêtre, pas dans une phrase.** Un découpage en phrases sur « . » coupe
  les noms à point (« D.D. Crow », « U.A. ») : 87 limites par nom perdues sur le catalogue. La détection
  lit « You can only use / activate … » jusqu'à la borne temporelle la plus proche (`once per turn`,
  `per Duel`, `once per Chain`, `once that turn`, `per turn`), bornée par « ; » et « ● », et vérifie
  que la carte s'y nomme (littéralement, sinon par un segment entre guillemets ÉGAL au nom normalisé :
  balises `<…>`, ponctuation, pluriel — jamais par inclusion ni hors guillemets, relecture A).
  Une fenêtre finissant par « twice / thrice per turn » n'est pas une limite à 1 (Gatling Ogre).
- **Une invocation limitée par nom (`summonOnce`) n'est pas un HOPT.** Réponse Q2 (Black Chaos) ; la
  classe reste reportée par l'inventaire pour le référent. Coût connu : Abominable Unchained Soul.
- **Le profil réactif se déduit de la clause de déclenchement** (avant le deux-points) : si elle nomme
  l'adversaire comme acteur, la carte ne sert que pendant son tour (Veiler, Nibiru, Droll, Kuriboh,
  Artifact Lancea, Herald of Orange Light) ; sinon flexible (Ash, Ghost Ogre, D.D. Crow). Les jetons
  nommés et les parenthèses ne comptent pas comme condition d'archétype (Nibiru).
- **Faux positifs et manqués nommés dans le test**, jamais corrigés par une liste (R2) : Griffoh et
  The Iris Swordsoul détectés ; Kurikara, Bystial, PSY-Framegear Gamma manqués.
- **Fixtures de textes réels dans le dépôt** (`server/tests/fixtures/card-texts*.json`,
  `played-choices.json`) : textes du catalogue et choix d'un compte numéroté, aucun email ni
  identifiant de compte. Le test garde la correspondance exacte avec les choix existants : toute
  régression de règle nomme la carte.
- **Rapport d'inventaire** (`scripts/annotations-report.ts`) : mêmes gardes que `recompute-check.ts`
  (127.0.0.1, port ≠ 5433, aucune écriture) ; le rapport d'écart par deck attend la partie C (la
  bibliothèque effective n'existe pas encore).

### Partie B — contrat et moteur (16 septembre 2026)

- **La porte « profil ET étiquette » est levée sur décision de l'utilisateur** (réponses Q3 / Q4 :
  « seuls les profils sont réellement pertinents »). `evaluate.ts` : `nonEngine[i] = profile !==
  undefined` ; une carte profilée sans étiquette entre dans U avec une signature sans catégorie
  (`neSignatures` porte `{ cats: [] }`), donc dans aucun potentiel de catégorie ni d'union. Le cas de
  référence Q1 de `chronology.test.ts` est **réécrit** et l'oracle `deckOracle.ts` étendu (`profile
  === undefined` seul écarte une copie) : c'est une révision explicite du contrat §3 (règle datée),
  pas une correction pour faire passer le code. Q5 (étiquette sans profil = 0, copies brutes
  intactes) est inchangée, ainsi que l'avertissement « sans profil » du panneau et du comparateur.
- **Une carte profilée devient un type suivi de `buildEngineModel`** même sans étiquette (sinon
  le moteur ne la verrait jamais) ; `unprofiledCardIds` reste la liste des étiquetées sans profil.
- **Cinquième profil `reactive`** (« Réactive », type Droll) : premier = tour adverse suivant ;
  second = tour adverse initial seulement ; sixième carte = aucune fenêtre (`sixthSensitive`).
  Ajouté au contrat (`AVAILABILITY_PROFILES`), au moteur (`capacities`), à l'oracle (`windows`,
  N01) et à un nouveau deck de 10 cartes du pont B02 (réactive HOPT, réactive sans étiquette,
  flexible, board breaker, starter) comparé à l'énumération physique.
- **Gardes Q1 levées partout** : serveur (`PUT /library/flags` n'exige plus d'étiquette), store
  (`setProfile`), grille (mode Profil ne saute plus les cartes sans étiquette, compteur « ignorées »
  retiré), menu ⋯ de la carte (profils proposés à toute carte — relecture B). L'ordre « étiquette
  puis profil » du mode Non-engine combiné est conservé (sans effet), et son geste « retirer » retire
  toujours l'étiquette PUIS le profil devenu seul : c'est l'annulation du geste « poser », pas une
  conséquence de l'ancienne porte (l'interface par profil seul est en partie D).
- **`N` du comparateur et de l'export Excel = copies profilées** (`scenarioCounts`), plus les
  copies étiquetées : la spec §7.6 le définit comme le nombre de non-engine, qui est désormais
  « profilée ». Les cellules ne changent pas (elles viennent du moteur) ; seul l'en-tête suit la règle.
- **Migration `006-annotation-defaults.sql`** ouverte en B avec la seule extension de la contrainte
  CHECK de `card_flags.availability` (DDL idempotent hors journal, journalisée une fois) ; la partie
  C l'étend avant tout déploiement. Branchée dans les deux compose, la séquence de `lib.sh` (deux
  branches, avant 003, après 005), `check-migration.sql`, `web/e2e/run.mjs`,
  `test-migration-sequence.sh` et les suites d'intégration (auth, persistence, purge).

### Partie C — modèle, persistance, référent (17 septembre 2026)

Lots C1 (migration, déploiement) puis C2 / C3 (contrat, routes, bibliothèque effective) écrits par
deux sous-agents ; C2 / C3 interrompu sans rapport, repris, relu et complété par l'agent suivant.

- **Données de 006 migrées une seule fois, sous un second marqueur `006-annotation-defaults/c`.**
  Après C, `is_hopt = false` est un choix explicite ; un `update … where is_hopt = false` rejoué
  l'effacerait, et `update decks set summary = null` revidait les aperçus à chaque déploiement. Le
  marqueur principal ne pouvait pas servir : des bases l'ont journalisé en B. Le DDL reste hors
  journal et idempotent.
- **`card_reference_log.actor` sans clé étrangère.** `on delete set null` émet un UPDATE que le
  déclencheur d'ajout seul refuse : plus aucun compte n'était supprimable (même raison que
  `backoffice_audit`). `card_references.updated_by` garde sa clé (table modifiable).
- **« Aucune ligne `is_hopt = false` » contrôlé à la première application seulement**
  (`check_006_data`, lib.sh) ; informatif dans `check-migration.sql`, sinon le premier choix « faux »
  d'un utilisateur bloquerait tous les déploiements suivants.
- **`card_flags.is_hopt` garde `default false`** (forme de table inchangée hors nullabilité) : toute
  insertion serveur écrit `is_hopt` explicitement. Défaut trouvé à la reprise : l'import JSON d'un
  profil insérait sans `is_hopt` et posait un choix « pas HOPT » ; corrigé (NULL explicite), gardé par
  la suite `persistence`.
- **Étiquettes hors copie sur écriture.** D14′ les sort des défauts : une étiquette est toujours un
  choix du compte. 006 ne matérialise pas les cartes seulement étiquetées, et « revenir au défaut »
  de l'aspect non-engine efface profil, plafond et choix, jamais les étiquettes (écart au tableau du
  §13, qui les supprimait).
- **La valeur héritée est dite par le client** (`inherited` : profil et NOM de plafond) au premier
  geste non-engine sur une carte héritée ; le serveur la matérialise telle quelle, validée comme tout
  profil, puis applique le geste. Changer de profil garde le plafond (hérité ou non), comme avant C.
- **Plafond fourni de base « Mulcharmy » (2)** créé par `insertAccount` (tous les chemins
  d'inscription) et rétro-créé par 006 ; non supprimable (400), limite modifiable, nom ignoré au
  PATCH. `check-migration.sql` met un KO sur tout compte qui en manque : lien gardé par
  `auth.integration.ts` (inscription réelle). `card_references.group_name` n'a aucune garantie de
  correspondre à un groupe : un nom absent chez un compte donne un profil sans plafond (testé).
- **`referencesVersion` = dernier id de `card_reference_log`** (monotone), plus le plus grand
  `updated_at` : un retrait de référence ne changeait pas la version.
- **`GET /api/library` lit les références dans sa transaction** (même instantané que les choix).
- **Rôle relu en base à chaque requête** (`auth/role.ts`), jamais en session : un retrait prend effet
  à la requête suivante. Écriture de référence par un non-référent → 404 (Q7).
- **`prune-stale-cards` : `card_reference_log` n'est ni compté ni reporté.** L'y compter bloquait au
  contrôle final toute carte renommée ayant eu une référence (le journal ne peut pas être réécrit).
  `card_references` est reportée (deux références = refus nominatif) ; HOPT tri-état fusionné
  `true > false > null`, `nonengine_choice` par OU.
- **Bibliothèque effective, un seul chemin** : `effectiveLibrary.ts` (dans `__ENGINE_VERSION__`),
  appliquée par le store (`deriveEffective` à chaque changement de cartes, de bibliothèque ou de
  groupes, et à la reprise d'un brouillon, qui charge les textes manquants) et par
  `sourceFromDetail` (accueil, comparateur, fiche de side, qui chargent les textes par
  `cardsByIds`). Une bascule HOPT part de la valeur EFFECTIVE (un clic sur un HOPT détecté pose
  « faux »).
- **Rapport d'écart** (`annotations-report.ts --gap`) : avant = choix seuls, après = bibliothèque
  effective, même moteur (porte levée) ; sur l'archive du 8 septembre (antérieure à 002, aucun
  profil), P(≥ 1 départ) et brick identiques dans les 16 decks, seul E[U] change.
- **Fixture e2e** : le scénario `setup` règle à 1 la limite du « Mulcharmy » fourni de base au lieu
  de créer un plafond du même nom (refusé, « autre limite ») — chiffres de la fixture inchangés.
- **Sans textes de cartes, aucun chiffre.** Avant C, `cardsByIds` était facultatif (images seulement) ;
  il détermine désormais les défauts. Un échec rend l'aperçu de l'accueil indisponible (rien n'est
  écrit), arrête le comparateur et la fiche de side, et fait échouer l'ouverture du deck dans
  l'éditeur (comme une bibliothèque indisponible) : jamais un chiffre calculé sans défauts ni persisté.
  `sourceFromDetail` et `compareSideOf` exigent les cartes (plus de `{}` par défaut). Relecture C.
- **Mode Non-engine combiné, geste « retirer »** : le profil n'est retiré avec la dernière étiquette
  que s'il est un CHOIX du compte ; un profil détecté ou de référence reste (sinon deux clics sur Ash
  posaient « pas non-engine »). Relecture C.
- **Conflit explicite à l'import et à la purge, pour l'aspect non-engine** : un « pas non-engine »
  choisi contre un profil importé ou reporté = 409 / annulation nominative, comme un HOPT « faux ».
- **`seedBuiltinCategories` ne crée le groupe fourni de base que si `nonengine_groups.is_builtin`
  existe** : `adopt` tourne avant 001 et une base peut précéder 006 (inscription en 500 sinon).
- **`GET /api/references`** : identifiants des auteurs (`actor`, `updated_by`) visibles des référents
  seulement ; liste et journal lus dans un même instantané ; `before` lu `for update`.
- **`web/src/lib/deckConfiguration.ts` entre dans `__ENGINE_VERSION__`** (fusion effective et
  `libraryState` déterminent l'entrée du moteur).
- **Garde e2e `side` P3** : attend le rendu du clic avant de lire (échec sous charge en répétition,
  non reproduit seul) ; ce qu'elle vérifie est inchangé.
- **Tests d'intégration adaptés sur décision, pas pour faire passer** : forme de réponse de
  `PUT /flags` (`is_hopt` null, `nonengine_choice`), groupe fourni de base exclu des comptages de
  groupes créés par le compte (suites `auth` et `persistence`).

### Partie D — interface (17 septembre 2026)

Réponses de l'utilisateur le 17 septembre 2026, avant le code : clic du mode Non-engine sur un profil
hérité identique = « adopter, puis retirer » ; bandeau retenu par compte (serveur) ; page /references
réservée aux référents. Tranché par l'agent en les appliquant :

- **`user_notices` dans le DDL de 006, pas de migration 007.** 006 n'est déployée nulle part en
  production et son DDL est déjà hors journal et idempotent : une 007 aurait ajouté montage, séquence,
  liste e2e et cas I pour une table. Clés fermées tenues en double (CHECK de 006 et
  `server/src/auth/notices.ts`) ; fermer un avis non dû écrit quand même la ligne (idempotent).
- **Bandeau dû** aux comptes créés AVANT l'application du marqueur `006-annotation-defaults/c` et qui ne
  l'ont pas fermé : un compte créé ensuite n'a jamais eu d'anciens chiffres. `GET /api/auth/me` →
  `notices` ; `POST /api/auth/notices/:notice/dismiss` (privée, 404 sur clé inconnue).
- **Un seul mode Non-engine** (profil, puis étiquette facultative), le mode « Profil » disparaît (§3,
  D14′). « Étiquette seule » est conservée comme valeur du profil : elle garde la fixture « étiquetée
  sans profil » (Q5) et ne touche jamais le profil. Règle unique `lib/nonEngine.ts` : `poser`,
  `adopter` (profil hérité identique → même valeur écrite avec `inherited`, la carte devient un choix),
  `retirer` (choix identique → étiquette demandée puis profil à NULL, « pas non-engine » choisi) ;
  « retirer » ne regarde plus la dernière étiquette (règle 9B remplacée sur décision).
- **Origine sur la tuile** : un badge hérité passe en contour sur fond noir, suffixé « auto » / « réf. » ;
  le choix garde l'aplat sans suffixe (« vous » n'est écrit que dans le détail, faute de place à 96 px).
  Détail de carte : ligne par aspect avec puce d'origine, « Revenir au défaut » sur un choix, rappel de
  la détection et de la note de référence ; menu ⋯ : « oublier mon choix » par aspect.
- **Formulaire de référence sans état global** (`ReferenceDialog`) : ouvert depuis le détail de carte
  (éditeur) et la page /references ; HOPT détection / oui / non, non-engine détection / pas non-engine /
  profil, plafond choisi parmi les groupes FOURNIS DE BASE (seuls noms communs à tous les comptes).
- **Page /references** : lien dans le menu du compte pour un référent ; un non-référent qui l'ouvre lit
  « Page réservée aux référents ». Désaccords calculés sur les textes des cartes (sans textes, erreur
  plutôt qu'un faux désaccord).
- **e2e** : scénario `defaults` en fin de liste, accès SQL `ctx.sql` ajouté à `run.mjs` (conteneur
  jetable de la pile) pour le rôle référent et l'ancienneté du compte ; cartes 90000030–31 (90000018–19
  sont pris par le jeu représentatif de la répétition) ; `setup` et `nonengine` réécrits pour le mode
  unique, fixture identique.
- **Base de dev** : le sous-agent du lot D1 y a appliqué 005 (absente) puis 006 par stdin — seule
  l'application de 006 était autorisée, 005 était son prérequis nominatif.

## Back-office — hors numérotation, socle en lecture seule (16 septembre 2026)

Plan validé en séance, consigné dans [docs/backoffice.md](docs/backoffice.md) (décisions 1 à 11,
choix techniques T1 à T16, modèle et privilèges, découpage A / B). Les décisions validées ne sont
pas reprises ici ; ce qui suit est ce que l'agent a tranché en les appliquant.

- **Rôle PostgreSQL dédié `testhand_backoffice`, privilèges par colonne, créé par la migration 005.**
  L'exigence « l'admin ne lit pas les decks » et « journal en ajout seul » doit tenir malgré un bug
  du back-office : le site se connecte avec un rôle qui n'a `SELECT` que sur les colonnes qu'il
  affiche (`decks` : `id`, `owner_id`, dates ; `sessions` : sans `token_hash` ; `user_identities` :
  sans `provider_user_id`), aucun privilège sur les tables de contenu (`deck_cards`, conditions,
  plans de side, bibliothèque, catalogue), `INSERT` + `SELECT` seuls sur `backoffice_audit`, et un
  déclencheur refuse `UPDATE` / `DELETE` / `TRUNCATE` sur le journal à tout le monde, propriétaire
  compris. Vérifié tenable dans cette architecture à trois conditions prises en charge : le mot de
  passe du rôle est posé par le déploiement et non par la migration (`backoffice_db_login`,
  `BACKOFFICE_DB_PASSWORD` dans `.env.prod`) ; `pg_dump` émettant les `GRANT`, tout cluster neuf qui
  reçoit une archive pré-crée le rôle en `NOLOGIN` (`restore_into_scratch_db`, `rehearsal.sh`) ; le
  service `admin` est arrêté pendant la séquence de migration et la restauration.
- **Attribution du rôle admin par `deploy/backoffice-role.sh` (bash + SQL à GUC, comme 003), pas par
  un sous-programme .NET.** Le rôle web n'ayant aucune écriture sur `users`, un sous-programme dans
  le conteneur du site aurait exigé les identifiants du propriétaire dans ce conteneur, ce qui
  annule la garantie. Le script passe par `db_exec` de `lib.sh` (`docker compose exec` sous le
  capot, ou `TESTHAND_DB_CONTAINER`), simule par défaut, écrit avec `--apply` et journalise dans la
  même transaction (`source = 'cli'`).
- **scrypt et TOTP implémentés en C#, sans paquet** : PBKDF2 natif + Salsa20/8 + BlockMix + ROMix,
  format `scrypt:N:r:p:sel:clé` lu tel quel, prouvés par les vecteurs 1 à 3 de la RFC 7914 (le 4e
  demande 1 Gio) et par des hachages produits par `server/src/auth/password.ts` (fixture générée) ;
  TOTP RFC 6238 (SHA-1, 30 s, 6 chiffres, ± 1 pas, anti-rejeu par dernier pas accepté) prouvé par
  les vecteurs de la RFC. Seul paquet ajouté : QRCoder (MIT, C# pur) pour le QR d'enrôlement.
- **Secret TOTP chiffré AES-256-GCM** par `BACKOFFICE_TOTP_KEY` (32 octets, base64, dans `.env.prod`) :
  un dump ne livre pas le second facteur. Perte de la clé = ré-enrôlement (question ouverte Q1).
- **Session absolue de 8 h sans glissement** : `expires_at` écrite une fois ; rôle relu par
  jointure à chaque requête ; TOTP en attente = seules `/totp` et `/logout` répondent ; cookie
  `th_backoffice` (HttpOnly, Secure hors DEV, SameSite=Strict), jamais `ygo_session`.
- **Journalisation explicite** : chaque page appelle `Audit.Record` avant de rendre ; `/health`
  (réponse `ok`, sans détail) n'est pas une consultation. « Dernière connexion » affiche
  l'ouverture de la session encore active la plus récente, sinon « — » (Q2 : une vraie date
  demanderait une écriture côté serveur Node, hors périmètre).
- **En-têtes posés par l'app** (CSP stricte sans inline, nosniff, Referrer-Policy no-referrer,
  X-Robots-Tag noindex, frame-ancestors none, Cache-Control no-store) et rappelés dans le bloc
  Caddy, qui garde HSTS. Le thème passe donc par `/js/theme.js`, pas par un script inline.
- **Contrôle « tables intactes » adapté à 005** : `users` change de forme quand 005 est appliquée
  par la séquence (colonne ajoutée) ; le contrôle exige alors effectif identique et tous les rôles
  à `user`, et reste strict quand 005 est déjà journalisée. `check-migration.sql` vérifie aussi que
  le rôle existe et n'a **aucun** privilège sur les tables de contenu.
- **Ports jetables** : 55442 (tests d'intégration .NET, `testhand-backoffice-db`), 55443 + 8795
  (garde navigateur, `testhand-backoffice-e2e-db`).
- **Relecture de la partie A (sous-agent à contexte neuf), corrections retenues** : le rejeu de 005
  retire aussi les attributs du rôle (`nosuperuser`, `nocreatedb`, `nocreaterole`, `nobypassrls`,
  `noinherit`) et les appartenances larges (`ygo`, `pg_read_all_data`, `pg_write_all_data`,
  `pg_read_all_settings`, `pg_read_all_stats`) ; le déclencheur d'ajout seul est `ENABLE ALWAYS`
  (tient en `session_replication_role = replica`) ; le mot de passe du rôle passe par l'entrée
  standard de psql, jamais en argument ; `restore.sh` tolère un service `admin` sans conteneur ;
  les variables `BACKOFFICE_*` du compose acceptent une valeur vide (le back-office ne bloque jamais
  le déploiement de l'app, Q5) ; `test-backup-restore.sh` archive une source à 005 pour exercer la
  pré-création du rôle dans le cluster neuf. Fenêtre du contrôle `users` consignée en Q4.

## Audit freemium — décisions et vérifications de prod, 16 septembre 2026

Matériaux dans [docs/audit/](docs/audit/). Six points tranchés à partir de constats faits sur la
production, pas sur le poste.

### D1. Verrou 1 (visuels et textes Konami) : pas de courrier

Pas de demande écrite à Konami ni à NAS : exposition disproportionnée au stade actuel (produit non
ouvert, noindex, aucun revenu). Le verrou est traité par son volet opérationnel :

- cache disque du relais (DON-A1), zéro requête navigateur vers images.ygoprodeck.com ;
- le paywall porte sur les capacités du moteur, jamais sur les artworks ni sur l'accès aux cartes.
  Invariant à respecter dans `entitlements.ts` et dans l'export PDF ;
- attribution et non-affiliation en pied de page, en-tête d'app et en-tête du PDF (DON-A8) ;
- plan de repli sans artwork (DON-A3 + A4 + A6, 9 à 13 j) tenu prêt derrière un flag, non développé
  tant que le seuil ci-dessous n'est pas atteint.

Seuil de réévaluation, où la question « retirer les visuels ou demander » se rouvre : ouverture
publique de l'inscription, OU **N abonnements payants actifs, avec N = 1000 € / prix mensuel de
l'abonnement** — soit 250 à 4 €, 400 à 2,50 €. Compteur relevé à chaque déploiement.

Le seuil est exprimé en revenu, pas en nombre d'abonnés, parce que c'est le revenu qui rend
l'exposition disproportionnée dans l'autre sens : tant qu'un éventuel conflit coûte plus cher que
ce que le produit rapporte, il n'y a rien à défendre ; passé ~1000 € par mois, la question du
courrier (ou du retrait des visuels) redevient un arbitrage économique ordinaire. Le prix n'étant
pas fixé, la formule est plus robuste qu'un nombre : elle survit à un changement de tarif.

**Non couvert** : les comptes gratuits. Le seuil ne se déclenche que sur des abonnements payants,
alors que l'exposition au verrou 1 suit la visibilité, pas le revenu. Un produit à 10 000 comptes
gratuits et 0 abonné ne franchit aucun seuil. Le déclencheur « ouverture publique de l'inscription »
couvre le cas le plus probable, mais pas une croissance par bouche-à-oreille sur invitations.
Question ouverte : faut-il un second seuil en comptes créés, toutes formules confondues ?

Élément aggravant relevé ce jour : la garde contournée (D3) sert le corpus complet des textes
d'effet à un inconnu en une requête. L'exposition assumée ici suppose que la garde tient ; elle doit
donc être couverte par un test d'intégration, pas seulement corrigée.

**Posture assumée** : c'est un arbitrage de risque, pas une mise en conformité. Le verrou 1 reste
ouvert et la décision est de le porter en connaissance de cause tant que le produit reste fermé.

### D2. DON-B6 tranché : l'hébergeur est OVH, pas Azure

`analysis.scratchrecode.com` → 137.74.172.32, plage OVH SAS. Le brief disait Azure (confusion
probable avec le pipeline Azure d'un autre projet). Politique de confidentialité, registre des
traitements et contrat de sous-traitance se font sur OVH. DON-B6 clos.

### D3. PER-O1 confirmé en prod, à travers le vrai Caddy

`/api/cards/search` → 401 ; `/%61pi/cards/search` → 200 et 16 617 octets de catalogue avec les
textes d'effet, sans session. Caddy ne normalise pas le chemin. Cause : Fastify décode le chemin
avant de router, la garde compare la chaîne brute de `req.url` via `startsWith('/api/')`.

Correctif retenu : garde décidée sur la route résolue, avec `config: { public: true }` pour
`/api/health` et `/api/auth/*`. Contredit DECISIONS.md:1214-1216 et server/AGENTS.md:9, qui
redeviennent vrais une fois le correctif posé.

Non tranché : PER-G4 (relais d'images atteignable par la même voie). Le test du 16/09 portait sur un
chemin inexistant et a renvoyé le fallback SPA — faux positif, à rejouer sur la route réelle.

### D4. COD-C10 confirmé : aucun en-tête de sécurité en prod

`curl -sD -` sur la racine : ni HSTS, ni CSP, ni X-Content-Type-Options, ni Referrer-Policy, ni
frame-ancestors. Le 308 http→https est la seule protection et ne couvre pas la première visite. À
ajouter dans le Caddyfile. Referrer-Policy prioritaire tant que des requêtes partent vers le CDN.

### D5. COD-C4 : le volet disque est clos, le volet RGPD reste ouvert

`/etc/docker/daemon.json` porte json-file max-size 10m / max-file 3, appliqué à `ygo-app`
(`docker inspect`). Plafond réel 30 Mo par conteneur, disque à 18 % de 38 Go. Le scénario « disque
plein, PostgreSQL s'arrête » est écarté et la demi-journée chiffrée par le volet 03 pour les
journaux tombe à zéro.

Restent dus : durée de conservation des IP et URL journalisées (DON-B5), sonde externe et alerte
hors VPS. AGENTS.md:60 (« L'app ne journalise pas les requêtes ») est faux, à corriger.

### D6. COD-C5 / DON-P2a : rétention correcte, un seul lieu, dumps de test à purger

`backup.sh` applique une rétention de 14 jours sur les archives datées (ligne 61) ; cron vérifié,
trois nuits consécutives avec contrôle sha256. Le mécanisme est sain. Restent dus :

- copie chiffrée hors VPS en fin de `backup.sh` (rclone) ;
- 7 dumps de prod en clair hors rétention dans `deploy/out/test-migration-sequence-20260909-*/backups/keep/`,
  contenant emails et hachages (cf. backup.sh:4) : à chiffrer ou supprimer, et à exclure des sorties
  de test à l'avenir ;
- rétention explicite pour `keep/`, exclu de la ligne 59 par construction ;
- les deux crons de sauvegarde (goldfish et ygo-proba) partent à 03:17 : décaler goldfish à 03:47.

## Plans de side — retouche de la fiche (lisibilité, PDF téléchargé), 11 septembre 2026

Demande de l'utilisateur après le déploiement de l'étape 10 ; « la fiche seulement » (ni l'onglet
« Plans de side » ni le comparateur). Compte rendu dans [docs/etape-10.md](docs/etape-10.md) (§15).

- **Deux cadres titrés par volet, SORT et ENTRE, côte à côte** : SORT en bordure pointillée rouge,
  ENTRE en bordure pleine verte, libellés « − Sort » / « + Entre ». Le sens ne repose jamais sur la
  couleur seule (libellé et style de bordure) : lisible en noir et blanc et par un daltonien.
- **Gros badge « ×n »** sur l'illustration d'une carte en plusieurs copies (disque noir cerclé de
  blanc, 32 px à l'écran, 7 mm sur papier) ; rien pour une copie unique : l'absence de badge vaut 1.
- **Noms masqués par défaut** : les illustrations suffisent. Case « Noms des cartes », retenue sur
  le navigateur (localStorage ; préférence de confort : sans stockage, elle vaut pour la session).
- **Cible révisée : 3 adversaires par page A4, 4 si les plans sont petits** (remplace « une page
  pour 6 à 7 adversaires », D15) : des illustrations lisibles valent mieux qu'une page unique.
- **« Télécharger le PDF » remplace « Imprimer »** : le PDF est construit dans le navigateur par
  jsPDF (licence MIT, chargé à la demande comme ExcelJS), mis en page en millimètres
  (`lib/sideSheetPdf.ts`), puis téléchargé ; l'utilisateur imprime ce fichier. Même rendu partout,
  indépendant des réglages d'impression du navigateur (fonds, marges, en-têtes). La page reste
  imprimable par Ctrl+P : `@media print` est conservé, badges et cadres en couleurs forcées
  (`print-exact`, Chrome n'imprimant pas les fonds par défaut).
- **Pagination à blocs entiers** : un adversaire n'est jamais coupé entre deux pages ; un bloc plus
  haut qu'une page reste seul sur la sienne.
- **Relais des vignettes `GET /api/cards/:id/image`** : le CDN YGOProDeck n'envoie aucun en-tête
  CORS ; une page peut afficher ses images mais pas les lire pour en faire un PDF. Le serveur les
  relaie depuis une adresse FIXE (hôte et chemin constants, passcode strictement numérique : jamais
  un relais ouvert vers une adresse fournie par le client), derrière l'authentification comme toute
  l'API ; 400 sans appel sortant pour un id invalide, 404 si l'image n'existe pas, 502 pour tout le
  reste (panne, délai de 8 s, autre chose qu'une image, plus de 2 Mo). Une image illisible devient
  dans le PDF un cadre portant le nom de la carte, jamais un échec du téléchargement.
- **Texte du PDF ramené au Latin-1** (polices standard du PDF) : « ≥ » devient « >= », tirets et
  guillemets typographiques leurs équivalents simples, tout autre caractère « ? » plutôt qu'un
  glyphe illisible. Embarquer une police aurait alourdi chaque fichier pour trois symboles.

## Plans de side — étape 10, partie D (fiche imprimable, comparateur sur un deck sidé), 11 septembre 2026

Compte rendu, vérifications, mutations et clôture de l'étape 10 dans [docs/etape-10.md](docs/etape-10.md)
(§13, §14).

- **La fiche et le comparateur lisent le deck ENREGISTRÉ.** Ce sont des pages à part (adresses
  partageables, pas d'état d'éditeur) ; les boutons de l'onglet « Plans de side » sont désactivés
  tant que quelque chose n'est pas enregistré, avec la raison en infobulle. Sinon la fiche
  imprimerait un deck que le serveur ne connaît pas, ou perdrait les modifications en cours.
- **Fiche conforme à D4, rien de plus** : échanges avec vignettes, trois indicateurs, note. Ni écart
  avec le deck de base, ni sources neutralisées (elles restent dans l'onglet). Un plan vide imprime
  « Aucun échange (deck de base) » et ses chiffres ; un plan incomplet ou à revoir est signalé, sans
  chiffre ; un chiffre sans l'empreinte courante s'imprime « — ».
- **« Tout calculer » en série, dédoublonné par empreinte** : deux plans au même deck sidé ne se
  calculent qu'une fois ; chaque chiffre est persisté pour la révision lue ; au premier refus (409 :
  le deck a changé depuis l'ouverture de la fiche), on s'arrête et on demande de recharger — les
  chiffres affichés restent justes pour la version lue.
- **L'impression est la seule exception au thème sombre** : `@media print` en clair, A4, marges de
  10 mm. Imprimer du noir en aplat n'aurait aucun sens ; l'écran, lui, ne change pas.
- **La cible « une page pour 6 à 7 adversaires » est prouvée, pas supposée** : l'e2e imprime une
  vraie fiche de sept adversaires en PDF A4 et compte les pages.
- **Comparateur : un segment `deck~adversaire~position`** dans l'adresse existante, sans nouvelle
  route ; ⇄ Inverser et l'export Excel fonctionnent tels quels. Le côté sidé porte un nom explicite
  et une note d'information (code `sided`, sévérité `info`) : ses deux scénarios sont calculés, seul
  celui de sa position correspond au plan. Le type des avertissements étant une chaîne libre, rien
  n'a changé dans le moteur (`__ENGINE_VERSION__` intact).

## Plans de side — étape 10, partie C (annotation du side, onglet « Plans de side »), 11 septembre 2026

Compte rendu, vérifications et mutations dans [docs/etape-10.md](docs/etape-10.md) (§12). Disposition
tranchée par l'utilisateur au lancement de 10C : onglet de l'éditeur, deck de base à copies marquées.

- **Un onglet, pas une page** (précise le §6 du plan, qui disait « vue /decks/:id/side ») : même
  store, même Enregistrer, mêmes brouillons et garde « non enregistré » ; le panneau de stats reste
  celui du deck de base, référence de l'écart. `/decks/:id/side` est un **lien profond** vers
  l'onglet ; changer d'onglet ne réécrit pas l'URL.
- **Le deck de base, copies marquées** : main et side tels qu'enregistrés, une tuile par exemplaire ;
  les premières copies d'une carte sont celles que le plan engage (estompées « sort » / « entre »), un
  clic sur l'une d'elles retire une copie du plan. Le geste reste symétrique et colle aux deux listes.
- **Recalcul exact plutôt que règle par carte.** `annotationCalc` compare l'entrée du moteur à celle du
  résultat frais : identique → « non enregistré » seul ; différente, ou calcul en cours, résultat
  périmé ou absent → recalcul. Une règle « la carte est-elle dans le main ? » aurait été fausse : une
  condition portée par une carte de side mais exigeant une carte du main promeut celle-ci en type
  suivi, l'entrée change. Même règle, sans « non enregistré », pour les annotations du compte
  (`libraryCalc`).
- **Le bloc side rend de vraies tuiles** (`CardTile zone="side"`, 96 px) ; le menu ⋯ retire **du
  side** (piège : il retirait du main par défaut). L'extra garde sa tuile nue (D17).
- **Un adversaire naît avec ses deux volets vides** ; volet affiché par défaut : Premier.
- **Un échange est refusé s'il CRÉE un écart** avec les zones ; un plan déjà « à revoir » accepte un
  échange qui n'aggrave rien, sinon l'utilisateur serait bloqué sans pouvoir avancer. Le refus est
  nommé dans l'en-tête (`persistenceError`) et sous la barre d'échange.
- **Chiffres du plan ouvert** : client de calcul propre à la vue (comme le comparateur), calcul
  différé de 150 ms et annulé à chaque changement, cache mémoire par empreinte, chiffres stockés
  réutilisés s'ils portent l'empreinte courante. **Persistés seulement si rien n'est « non
  enregistré »** : le plan calculé est alors celui du serveur (sinon la route vérifierait la taille
  d'un plan qui n'est pas celui calculé). Écart jamais calculé contre un résultat périmé.
- **Sources neutralisées** = condition devenue impossible dans le deck sidé (feuille exigeant plus
  d'exemplaires qu'il n'en reste, ET dont un enfant l'est, OU dont tous le sont), non imputées au plan
  si elles l'étaient déjà dans le deck de base.
- **« Échanger » est un bouton secondaire à 32 px**, pas émeraude : la charte réserve l'émeraude à une
  seule action par écran, Enregistrer.
- **Non couvert par une garde automatique** : le retrait « du side » depuis le menu ⋯ (aucun test
  React dans le dépôt, et l'e2e n'ouvre pas ce menu) — vérifié à la lecture du code.

## Plans de side — étape 10, partie B (deck sidé calculable, cache des chiffres), 11 septembre 2026

Compte rendu, vérifications et mutations dans [docs/etape-10.md](docs/etape-10.md) (§11). Partie B :
tout est pur côté client (`web/src/lib/sidePlan.ts`), seule la route des chiffres touche au serveur.

- **Un plan qui n'est pas prêt n'a pas de main.** `applyPlan` rend le statut (`ready`, `incomplete`,
  `review`), les écarts nommés et la taille après échange, mais le main dérivé **seulement** si le
  plan est prêt ; `sidedSource` rend `null` sinon. R4 et R5 (« jamais analysé ni imprimé ») tiennent
  par construction, pas par une vérification qu'un appelant pourrait oublier. « À revoir » l'emporte
  sur « incomplet » : c'est la cohérence avec les zones qu'il faut rétablir d'abord.
- **Un plan vide est prêt** : ses chiffres sont ceux du deck de base dans la position du plan — c'est
  précisément ce que la fiche doit montrer pour un adversaire contre lequel on ne side pas.
- **Les trois indicateurs sont des requêtes du mode Requête**, pas une formule à part :
  `indicatorCriteria(position)` rend des `QueryCriterion` évalués par `queryProbability`. L'égalité
  avec le mode Requête est donc stricte (`toBe`), et R7 est une garde dure : une passe de l'autre
  position lève une erreur de programmation, jamais un chiffre.
- **Clé du cache = l'entrée complète du moteur du deck sidé** (+ version du moteur, position et
  définition sérialisée des critères), hachée en FNV-1a 64 bits. Cette entrée contient déjà la
  composition, les annotations du deck, les profils, plafonds, étiquettes et HOPT du compte : une
  modification de bibliothèque périme les chiffres **sans aucune invalidation côté serveur**, à
  la différence de `decks.summary` (9A). Corollaire assumé et testé : échanger une carte neutre
  contre une autre ne périme rien, le moteur ne les distingue pas. Hachage non cryptographique :
  c'est une clé de cache, pas une signature.
- **`sidePlan.ts` est hors de `__ENGINE_VERSION__`** : l'étape ne périme aucun aperçu d'accueil.
  En contrepartie la définition des critères entre dans l'empreinte de chaque plan (paramètre
  exposé pour le prouver par test) : changer un indicateur périme ses chiffres tout seul.
- **Un plan second calcule les deux passes** (mode `passes`) : le worker n'a pas de mode « second
  seul » et n'en reçoit pas — coût ×2 sur 14 plans au plus, contre une modification du worker.
- **Route des chiffres calquée sur l'aperçu 9A** : révision courante exigée (409), taille du main
  APRÈS échange recalculée en SQL depuis le plan enregistré (400), plan inconnu 404, ni `revision`
  ni `updated_at` touchés. Les chiffres reviennent par `GET /decks/:id` dans `plan_summaries`, hors
  configuration ; aucun enregistrement ne les efface — c'est l'empreinte, calculée par le client,
  qui juge, et un plan retiré emporte sa ligne.

## Plans de side — étape 10, partie A (contrat, migration 004, persistance), 10 septembre 2026

Plan validé, décisions du cadrage (D1–D18) et découpage 10A–10D dans
[docs/etape-10.md](docs/etape-10.md). Partie A : modèle et persistance seulement, aucune interface.

- **Le contrat valide la STRUCTURE d'un plan, jamais sa cohérence avec les zones ni son
  équilibre.** C'est la décision centrale de 10A, et elle est contre-intuitive : inscrire « une
  carte entrante vient du side » dans `parseConfiguration` rendrait le deck **non enregistrable**
  dès qu'une carte quitte le side, alors que la règle retenue (D12) est de **conserver** le plan
  et de le signaler « à revoir ». Même raisonnement pour l'équilibre (D11) : une retouche laisse
  le plan « incomplet », et un état incomplet doit pouvoir être enregistré. Sont donc refusés ici,
  et là seulement : identifiant, nom, ordre, position connue et unique par adversaire, quantités
  1–3, carte répétée dans une liste, carte à la fois entrante et sortante, clés inconnues, plus de
  32 adversaires. Deux tests nomment explicitement les non-refus (carte absente du main, plan
  déséquilibré) : ce sont eux qui tiennent la décision dans le temps.
- **Clé naturelle plutôt qu'identifiant de substitution** (écart au plan, §4 de docs/etape-10.md) :
  un plan est identifié par `(deck_id, matchup_id, position)`, pas par un uuid propre. Le couple
  adversaire + position est déjà unique, et c'est ainsi que l'API d'aperçu de 10B l'adressera —
  un identifiant de plus n'aurait fait que circuler sans jamais servir. Les adversaires, eux,
  gardent l'identifiant du client sous clé `(deck_id, id)`, comme `deck_combo_pairs` : un
  identifiant venu d'un autre deck crée une ligne dans CE deck au lieu d'en détourner une autre.
- **Les lignes d'adversaire et de plan ne sont pas remplacées en bloc** (upsert, comme
  `deck_combo_pairs`, à la différence des cartes, starters, conditions et drapeaux) : le cache
  `summary` d'un plan (étape 10B) doit survivre à un enregistrement qui ne le concerne pas —
  renommer le deck, par exemple. Un `summary` devenu faux n'est pas un risque : le client ne
  l'affichera jamais s'il ne porte pas l'empreinte courante (règle R9, mécanisme de 9A).
- **`matchups` absent = aucun adversaire, jamais une erreur** : les exports JSON et les brouillons
  antérieurs à l'étape 10 restent importables sans conversion. Le document rendu est canonique
  (nom élagué, `note` absente rendue `null`).
- **004 est rejouée dans les DEUX branches de la séquence de migration, AVANT 003.** Elle est
  additive et indépendante de la purge, donc l'ordre est libre ; le placer avant l'empreinte
  intermédiaire est ce qui garde le contrôle « 003 n'a touché que ses propres objets » exact —
  après, ses trois tables seraient vues « absentes avant » et signalées comme une altération de
  003. La branche « 003 déjà journalisée » ne rejoue donc plus le schéma seul, mais le schéma et
  les migrations additives postérieures.
- **Une carte nommée par un plan entre dans le périmètre de l'archive JSON** même si elle a quitté
  sa zone (plan « à revoir ») : elle emporte ses annotations de bibliothèque, sinon l'archive
  décrirait un plan dont les cartes n'ont plus ni profil ni étiquette après import.
- **Duplication : adversaires d'identité neuve, aucun cache repris** — la copie recalcule ses
  chiffres, comme elle recalcule son aperçu de deck.
- **Aucun fichier du calcul touché** : moteur, oracles, `engineModel.ts`, `conditions.ts`,
  `summary.ts` intacts → `__ENGINE_VERSION__` inchangé, aucun aperçu d'accueil invalidé. Le
  modèle moteur ignore structurellement les plans, ce qu'un test affirme explicitement (le deck
  de base se calcule à l'identique avec et sans adversaires).
- **`prune-stale-cards` reporte aussi les cartes des plans** (hors plan initial, ajouté après
  vérification). Le script énumère tous les emplacements de passcode ; sans ce report, une purge de
  catalogue pouvait faire entrer ET sortir la même carte d'un plan — une configuration que le
  contrat refuse, donc un deck qui ne s'enregistre plus. Aucune règle inventée : dans une même liste,
  les copies se cumulent au plafond 3 comme pour `deck_cards` (somme préservée, sauf plafonnement,
  qui rend le plan « incomplet », visible) ; dans les deux sens du même plan, **tout est annulé** et
  le plan est nommé, comme pour deux conditions à fusionner.
- **Garde « base à 003 sans 004 » ajoutée à la séquence** (cas F). Aucun cas existant ne partait de
  l'état réel de la production (003 journalisée, 004 absente) : `initdb` applique 004 dans le cas I,
  la première séquence dans F et G. La mutation « 004 non rejouée sur une base purgée » passait donc
  inaperçue alors qu'elle vise la ligne dont dépend le prochain déploiement. Les mutations sur
  `deploy/` se jouent désormais sur une **copie** du dossier : une session coupée pendant une
  mutation posée sur le vrai `lib.sh` l'avait laissé muté (restauré depuis sa sauvegarde, vérifié
  octet pour octet).
- **Le runbook « déploiement courant » reste valable avec 10A** : `deploy.sh` faisant `git pull`,
  un déploiement depuis `main` emporte 004. Elle est additive et sans question ; seules trois
  sorties attendues changent (liste de `git diff -- db`, deux lignes de rejeu, quatre lignes de
  contrôle), notées en tête de la variante. Le retour arrière du code seul reste sûr : `9d281cf`
  ignore les trois tables.

## Première mission — étape 9, partie C (extra / side éditables, runbook « déploiement courant », clôture), 9 septembre 2026

Compte rendu, preuves, mutations, questions ouvertes Q14–Q18 et compte rendu final de la mission
dans [docs/etape-9.md](docs/etape-9.md) (« Compte rendu 9C », « Clôture »). Tag `etape-9-ok`.

- **La zone est un paramètre des mutations de composition, `main` par défaut** (`addCard(carte,
  copies, zone)`, `setCopies(carte, copies, zone)`, `removeCard(carte, zone)`) : tous les appels
  existants restent valides ; le dialogue d'ajout et la tuile de zone passent leur zone. Le toast
  porte la carte **avec sa zone** ; « Annuler » la restaure dans cette zone, à la même place.
- **Extra et side ne recalculent jamais** (`zoneMutation` : main → `localCalc`, sinon `markDirty`
  seul). Le modèle moteur ne lit que `main` (contrat §2, `buildEngineModel` intouché) : le
  résultat reste frais et l'aperçu joint à l'enregistrement aussi (prouvé par la garde Z4 :
  résumé écrit malgré une mutation side). Brouillon et configuration transportent déjà les trois
  zones depuis l'étape 3 ; rien à changer côté serveur.
- **Convention 1–3 par carte ET par zone** (la même carte peut être en main et en side) ; le refus
  nomme la zone. Repère de **15** en extra / side (Q5) = avertissement seulement (compteur ambre
  du bloc, bandeau du dialogue), jamais un refus, aucun repère bas ; le main garde 40–60.
- **Un bloc par zone, toujours rendu** — même sans main deck, même vide, sinon aucun ajout n'est
  possible — sous un seul repli « Extra / Side » (état `extraSideHidden` conservé). Tuile de
  **80 px** = image + stepper à 32 px, rien d'autre : aucune annotation, aucun delta, aucun
  menu ⋯ (ces zones n'ont ni rôle ni statistique). « + Ajouter » à 32 px ouvre le dialogue **sur
  la zone** (titre, compteur, plafond et repère de la zone).
- **Le test d'équivalence de 6A n'est pas modifié ; un cas « trois zones » lui est ajouté** :
  création manuelle, YDK (`#extra` / `!side`) et JSON v2 donnent les mêmes cartes par zone, et
  le modèle moteur est strictement égal au modèle « main seul » pris **avant** la saisie de
  l'extra et du side. Dit explicitement : le modèle moteur ne dépend pas de ces zones.
- **Runbook : variante « déploiement courant » en tête** (C0–C6), pour toute base non vide à 003
  sans migration : sortie attendue commande par commande (schéma seul rejoué, « 003 déjà
  journalisée », aucune question), effectifs notés avant / après, retour arrière à deux niveaux
  (code seul par `git checkout` + build + up ; données par l'archive pré-migration réelle de
  `deploy.sh` via `restore.sh`), toute question = `NON`. Preuve locale = cas « F, rejeu » de
  test-migration-sequence.sh. `rehearsal.sh` n'est pas prévu pour une archive déjà à 003 (son
  recalcul attend l'ancien modèle) : question ouverte, `restore.sh --check-only` à la place.
- **Aucun test existant modifié** ; moteur, oracles, migrations et `engineModel.ts` intacts
  (`__ENGINE_VERSION__` inchangé : 9C n'invalide aucun aperçu) ; aucune base personnelle ni VPS ;
  conteneurs jetables supprimés.

## Première mission — étape 9, partie B (attente de la DB, vue transitoire, mode combiné), 9 septembre 2026

Compte rendu, preuves, mutations et questions ouvertes Q9 / Q10 dans
[docs/etape-9.md](docs/etape-9.md) (« Compte rendu 9B »). Tag `etape-9b-ok`.

- **L'attente de la base exige le marqueur de l'entrypoint PostgreSQL, jamais une simple
  connexion.** Le serveur temporaire d'initialisation d'un volume neuf annonce lui aussi
  « ready to accept connections » et répond à `pg_isready` comme à `select 1` par le socket
  (incident 8C, reproduit sur conteneur jetable). `db_ready` (lib.sh) exige, dans l'ordre :
  `healthy` si une healthcheck existe ; dans les journaux du démarrage courant, le dernier
  « ready » **après** « PostgreSQL init process complete » (volume neuf) ou « Skipping
  initialization » (volume déjà initialisé) ; puis `select 1`. Écart au plan validé (« quand
  cette ligne existe ») : la règle littérale acceptait la fenêtre du serveur temporaire, dont le
  « ready » précède le marqueur ; un marqueur est exigé dans tous les cas. Healthcheck Compose
  intouchée (Q6). `deploy.sh` utilise `db_ready`. Preuve : cas I (témoin du premier `select 1`
  réussi sans marqueur, séquence lancée aussitôt en code 0).
- **Journaux lus depuis `StartedAt`** (`docker logs --since`) : bornés sur un conteneur qui
  tourne depuis des semaines, et un démarrage précédent n'y figure jamais ; sans `--tail`, qui
  aurait pu couper le marqueur.
- **La vue du panneau de stats est transitoire comme le contexte.** Retirée des params émis,
  acceptée en lecture (validateParams, remap d'archive, export de l'accueil qui joint encore la
  catégorie référencée), ignorée à l'ouverture. Changer de vue ne salit pas (test) ; le curseur
  d'importance reste enregistré (Q3).
- **Mode Non-engine combiné : une règle unique `nonEngineEffect`** (lib/nonEngine.ts) pour ce qui
  est envoyé (store) et ce qui est annoncé (tuile, bandeau). Conforme = étiquette portée et, si
  un profil est demandé, exactement ce profil ; conforme → retrait de l'étiquette puis du profil
  devenu orphelin ; sinon pose de ce qui manque, l'étiquette d'abord (le serveur exige une
  étiquette avant un profil). Deux requêtes au plus, dans la file globale, adoptées après
  acquittement ; un refus arrête la paire.
- **Valeur par défaut du déroulant : « profil inchangé »** (étiquette seule, comportement d'avant
  9B) — la fixture e2e reste intacte et un clic ne pose jamais un profil que personne n'a choisi.
  Profils en éléments radio (`menuitemradio`) : un profil et une étiquette de même nom (« Board
  breaker ») ne se confondent pas dans le même déroulant. Mode Profil conservé (Q4).
- **L'effet du prochain clic est annoncé sur la tuile** (badge « poser » / « retirer ») et dans le
  bandeau au survol : sur tactile, le survol n'existe pas, la tuile reste lisible seule.
- **Le retrait de la dernière étiquette retire le profil même en « profil inchangé »** : un profil
  sans étiquette ne mesure rien (Q1 de 5B) et resterait orphelin — question ouverte Q9.
- **Aucun test existant modifié** ; moteur, oracles, migrations intacts ; aucune base personnelle
  ni VPS ; conteneurs jetables supprimés. Un échec non reproduit de l'e2e `setup` sous charge
  concurrente (test A–I simultané) est consigné : ne pas lancer les deux en même temps.

## Première mission — étape 9, partie A (aperçus, finitions de 7B), 9 septembre 2026

Plan validé, réponses Q1–Q8, compte rendu et mesures dans [docs/etape-9.md](docs/etape-9.md).
Découpage 9A (points 1 et 2) / 9B (attente de la DB, vert intempestif, mode combiné) / 9C
(extra et side, runbook « déploiement courant », clôture). Tag `etape-9a-ok`.

- **Version du moteur = empreinte des sources du calcul** (`__ENGINE_VERSION__`, SHA-1 tronqué
  de `engine/*.ts` hors tests et référence, `engineModel.ts`, `conditions.ts`, `summary.ts`,
  calculé par `vite.config.ts`). Jamais une constante à incrémenter à la main (oubli garanti) :
  un commentaire changé invalide tous les aperçus, accepté (recalcul de 0,5 à 2 s pour 16 decks).
  Le serveur stocke la chaîne sans la connaître ; seule `usableSummary` (client) décide.
- **`decks.summary` reste un cache d'affichage, jamais une source de vérité** (contrat §1). Trois
  garanties : (1) à l'enregistrement, le résumé n'est joint que si le résultat courant est celui
  de la version demandée pour cette ouverture (`summaryOfState` : ni périmé, ni en cours, ni
  d'un autre deck) — sinon il reste absent ; (2) le serveur le refuse s'il ne décrit pas la
  composition enregistrée (`mainSize`) et le remet à NULL à toute écriture de configuration ou
  de bibliothèque (règle existante) ; (3) à l'accueil, tout résumé absent, malformé ou d'une
  autre version est recalculé avec le moteur courant, jamais affiché tel quel.
- **Recalcul à la demande à l'accueil, passe premier seule** (mode `first` du worker, hors
  moteur ; `second` rendue indisponible par la convention du moteur, `total === 0` + motif,
  jamais copiée ni approximée). Client de calcul propre à l'accueil (comme le comparateur),
  file séquentielle, disposé au démontage ; persistance par `PUT /decks/:id/summary` avec la
  révision lue, 409 ignoré (le deck a bougé, l'accueil suivant recalculera). Renommer un deck ne
  relance rien (clé stable des decks à recalculer).
- **Valeurs de l'aperçu = valeurs du panneau** : `startRateFirst` = cumulé « au moins 1 » de la
  vue Départs (`cumulativeOf`), `brickRate` = `pass.brick`, même chemin que `dataIdentity` ;
  arrondi au rendu (0 décimale), valeur fine (2 décimales) dans l'infobulle. Champs conservés
  tels quels (Q2) malgré leur redondance (l'un vaut 1 moins l'autre).
- **Mur sous 640 px : récapitulatif compact empilé** (« S n » sur « U n ») plutôt que « S 3 · U 1 »
  sur une ligne : six cartes à 360 px ne laissent que ~80 px à droite ; cartes de 60 px (68 dès
  640 px), note de 28 px, ligne de 65 px mesurée → huit mains par écran au lieu de cinq. Cartes
  jamais déformées (7B).
- **« ↻ Nouvelles mains » à 32 px en style neutre** : action primaire du mur par la taille, pas
  par la couleur (un seul bouton émeraude par écran, Enregistrer).
- **Δ jamais compact** (`MatrixGrid compact={false}`) : en pleine largeur sous 640 px, il a la
  place des cellules de 32 px à 10 px.
- **Densité de la grille close à 96 px.** 84 px mesuré à 1440 : les trois cibles de 32 px
  tiennent mais le delta « −1 : −6.38% » (53 px) est coupé dans 49 px (garde M4) ; ni le format
  du delta ni les cibles ne bougent → 9 colonnes à 1440, 3 à 360, garde de comptage ajoutée.
- **Arbre ET/OU profond : mise en page conservée, commandes portées à 24 px.** Validée à 1440 et
  360 px sur ET > OU > OU (et OU > OU > OU par un premier passage) ; les sélecteurs (23 px), le
  champ « ≥ n » (18 px) et le ✕ (16 px) étaient sous le minimum « ailleurs » du contrat §6 :
  `h-6` — considéré comme « cassé » au sens du contrat, seule correction.
- **Seul test existant modifié** : garde P7 « Nouvelles mains » 24 → 32 px (annoncée dans le
  plan). Les autres gardes sont ajoutées (`home`, `conditions`, P3 Δ, P7 compact, colonnes).
- Rappels tenus : moteur, oracles, migrations et deploy/ intacts ; aucune base personnelle ni
  VPS ; conteneurs jetables supprimés.

## Première mission — étape 8, partie C (exécution VPS), 8 septembre 2026

Compte rendu et incident dans [docs/etape-8.md](docs/etape-8.md) (« Compte rendu 8C ») ;
procédure dans [docs/deploy-runbook.md](docs/deploy-runbook.md) (variante « départ à vide »,
V4 complété). Clôture consignée le 9 septembre 2026, documentation seule, tag `etape-8-ok`.

- **L'étape 8 est terminée.** 8C exécutée sur le VPS par l'utilisateur le 8 septembre 2026,
  variante « départ à vide », code `9d281cf` : archive souvenir vérifiée et copiée hors VPS,
  volume recréé, 001–003 jouées à vide par `initdb`, `deploy.sh` sans aucune question, catalogue
  par `migrate-cards.js`, compte, contrôles V7, app en service. La production est sur le modèle
  v2 purgé, base neuve ; l'archive souvenir est la seule trace de l'ancien état.
- **Incident consigné, `deploy.sh` non corrigé dans cette session.** Au premier `deploy.sh` sur
  le volume neuf, l'attente `until pg_isready -q -U ygo -d ygo` (socket Unix) a accepté le serveur
  temporaire que l'entrypoint PostgreSQL lance pour jouer `docker-entrypoint-initdb.d` ;
  l'empreinte initiale (`fingerprint-0.txt`) a échoué pendant son extinction (« the database
  system is shutting down »), code 1, rien d'appliqué par la séquence, aucune app ; le second
  `deploy.sh` a été conforme (code 0). Décision : consigne manuelle dans le runbook (V4 : sur un
  volume neuf, attendre l'état `healthy` du conteneur `db` et le second « ready to accept
  connections », pas une simple connexion) et report « attente de la DB fondée sur `healthy` »
  dans l'étape 9 ; aucun code touché à la clôture de 8. Point d'attention transmis : la
  `healthcheck` de Compose utilise le même `pg_isready` par le socket, la correction devra prouver
  qu'elle exclut la fenêtre du serveur temporaire (volume neuf, conteneur jetable).
- **Le cas n'avait pas été vu en local** parce que le conteneur jetable 55443 était démarré et
  initialisé avant l'appel de la séquence ; la preuve « initdb puis séquence » ne couvrait pas
  « séquence lancée pendant initdb ». Les codes de retour (annexe A) et la garde « base vide =
  aucune question » ont tenu.
- **Questions ouvertes après 8** : Q11 (`ygo_previous`) conservée ; Q12 / Q13 sans objet tant
  qu'aucun déploiement sur base conservée n'est prévu ; équivalence `--emit-sql` / `--apply` de
  `prune-stale-cards` non prouvée depuis 8A.

## Première mission — étape 8, préparation de 8C (« départ à vide »), 8 septembre 2026

Compte rendu, preuves et passation dans [docs/etape-8.md](docs/etape-8.md) (« Préparation de
8C : départ à vide ») ; procédure dans [docs/deploy-runbook.md](docs/deploy-runbook.md)
(variante « départ à vide », V1–V7).

- **La production repart d'une base vide.** Décision de l'utilisateur après 8B : rien n'est
  conservé (ni decks, ni comptes, ni annotations). L'archive de l'état actuel est prise,
  vérifiée (`backup.sh --keep souvenir`, app arrêtée) et copiée hors VPS par principe, mais
  elle n'est plus un chemin de retour à préparer : la répétition sur archive fraîche (§0),
  l'empreinte attendue `e0efff5c…` et la ressaisie des 185 paires globales n'ont plus d'objet ;
  §7 (retour arrière) reste valable avec l'archive souvenir. Les decks utiles se réimportent
  depuis leurs fichiers YDK.
- **Base vide = volume recréé, initialisé par les fichiers montés.** Chemin principal du
  runbook : `down`, `docker volume rm ygo-proba_pgdata`, `deploy.sh`. Le premier démarrage du
  conteneur `db` joue schéma, 001, 002 et 003 (rien à purger, journalisée sans acceptation) ;
  la séquence de `lib.sh` trouve 003 journalisée et ne pose **aucune question** (prouvé : code 0,
  17 s). Toute question posée par `deploy.sh`, tout rejeu de 001, tout inventaire à 14 tables
  ou à paires non nulles signifie que la base n'était pas vide : répondre `NON` (code 3, rien de
  purgé), arrêter, comprendre. Aucun script n'a eu à changer pour ce chemin.
- **Le catalogue n'arrive ni à l'initialisation ni au démarrage de l'app.** Il est copié par le
  script embarqué `migrate-cards.js` depuis le conteneur `app` (Supabase publique, clé anon par
  défaut, upsert idempotent, estampille `catalog_version`) : 14 529 cartes, version `2026-08-31`,
  13 à 16 s, 22 Mo. `/api/health` passe de `cards: 0, catalog: null` au nombre annoncé par la
  source, égal à `catalog.cards`. Le premier remplissage par `pg_dump` local (deploy/README.md §5)
  est historique.
- **Le contrôle « tables intactes de bout en bout » traite la base vide au départ comme un cas
  légitime.** Manque révélé par la preuve : sur une base sans aucune table (base `ygo` recréée
  sans `initdb`), 001 / 002 / 003 se journalisaient sans question mais le contrôle rendait KO
  (« absente avant ») et laissait l'app arrêtée (code 2). Question posée, réponse « les deux » :
  `check_after_migration` reconnaît une empreinte initiale sans table et exige alors que les
  tables conservées existent et soient vides après (KO nominatif sinon) ; cas G (base vide,
  code 0 sans question, rejeu) et H (table conservée remplie après 003 → code 2) dans
  `test-migration-sequence.sh`. Le chemin des bases non vides est inchangé ; `rehearsal.sh
  --fixture` rejouée. L'alternative `dropdb` / `createdb` du runbook repose sur ce correctif.
- **Preuve sur conteneurs jetables, jamais sur une base personnelle ni sur le VPS ;** la Supabase
  publique a été lue (comptage et copie du catalogue) parce que la tâche le demandait
  explicitement. Les scripts de preuve restent hors dépôt (scratchpad), leurs résultats sont
  consignés dans docs/etape-8.md.

## Première mission — étape 8, partie B, 8 septembre 2026

Le [compte rendu 8B](docs/etape-8.md) contient le rapport de répétition sur le dump réel, les
preuves, les mutations et la passation vers 8C ; [docs/deploy-runbook.md](docs/deploy-runbook.md)
est la procédure d'exécution.

- **D3 concrétisée : une sauvegarde n'est « vérifiée » que restaurée.** `backup.sh` écrit
  `<archive>.sha256` puis restaure l'archive dans `ygo_verify` (recréée, supprimée après) et
  n'écrit `<archive>.fingerprint` (`fingerprint.sql` : effectif et md5 des lignes triées par
  table, réglages de session fixés) qu'à ce moment. La ligne `sauvegarde ok: …` garde son
  format et précède la vérification : le cron reste lisible tel quel ; un échec de
  vérification conserve l'archive, ajoute `sauvegarde NON vérifiée: …`, n'écrit aucun
  `.fingerprint` et rend 1 — `restore.sh` refusera cette archive sans `--without-fingerprint`.
  En cron l'app tourne : l'empreinte vivante est prise avant et après l'export, une table
  qui a bougé (`sessions`) est « non vérifiable », pas un faux positif ; en
  `--pre-migration` (app arrêtée) toute table qui bouge est un échec.
- **Rétention.** `find -maxdepth 1 -name 'ygo-*.sql.gz*' -mtime +14` : `keep/` (archives
  pré-migration et pré-restauration) est hors rétention, les compagnons partent avec
  l'archive. Comportement par défaut inchangé (aucun sous-dossier n'existait).
- **`restore.sh` restaure par bascule de bases.** Restauration de contrôle dans
  `ygo_restore`, comparaison ligne à ligne au `.fingerprint` (la moindre différence est un
  refus, rien n'est modifié), confirmation « OUI » (ou `--yes`), sauvegarde de sécurité
  vérifiée dans `keep/ygo-pre-restauration-*`, puis `ygo` → `ygo_previous` et `ygo_restore` →
  `ygo` (maintenance depuis la base `postgres`), empreinte relue. Ce qui a été vérifié est
  exactement ce qui est servi ; deux retours arrière (archive de sécurité, base précédente).
  `--check-only` vérifie une copie hors VPS sur un conteneur jetable (runbook, avant OUI).
- **Une seule séquence, dans `lib.sh`, avec des crochets d'app.** `deploy.sh` et
  `rehearsal.sh` appellent la même `run_migration_sequence` ; `deploy.sh` ne porte que
  Compose (`build`, `stop`, `start`, `up -d`). C'est ce qui rend la séquence testable hors VPS
  (`test-migration-sequence.sh`, six cas) et mutable « comme deploy.sh ». D2 appliquée :
  succès = code 0 **et** marqueur (« SIMULATION TERMINÉE », « PURGE APPLIQUÉE ») ; un code 0
  sans marqueur est un échec (cas C).
- **États d'échec, Q8 précisée.** Échec avant 003 (sauvegarde, schéma, 001, 002 :
  transactions annulées) → ancien conteneur relancé, base intacte (code 1). 003 refusée en
  simulation, en échec à l'application, ou rapport refusé (« OUI » absent, `--accept`
  différent, pas de terminal) → nouvelle app démarrée sans 003 (codes 1 et 3). Seul un
  contrôle après migration en échec laisse l'app arrêtée, la commande de restauration de
  l'archive pré-migration affichée (code 2).
- **001 et 002 ne se rejouent plus une fois 003 journalisée.** Découvert par le cas de rejeu
  (F) : 001 recrée `deck_requirements` sans condition et 003 refuse ensuite tout rejeu
  (« objet historique réapparu »). 001, 002 et 003 restent intouchées ; la séquence saute
  001 / 002 quand le journal porte 003 et rejoue toujours le schéma (bloc conditionnel D1).
  Alternative écartée : conditionner 001, contraire à « 001 et 002 ne changent pas ».
- **Contrôles après migration.** `check-migration.sql` (journal 001 / 002 / 003, objets
  historiques absents, objets v2 présents, aucun horizon, sources uniques) plus empreintes :
  tables intactes de bout en bout (`cards`, `catalog_version`, `users`, `user_identities`,
  `sessions`, `deck_cards`, `deck_starters`, `card_categories`) et périmètre de 003 (après
  002 → après 003 identique hors `app_migrations`, `card_flags`, `nonengine_categories` et
  tables supprimées). Une ligne `KO|` suffit.
- **Inventaire avant 001.** Effectifs par table, journal, résumés (que 001 met à NULL) et
  modèle historique en JSON (paires, exclusions, prérequis source paire), écrits dans le
  dossier de sortie ; identifiants internes et noms de decks seulement.
- **Recalcul : la référence est l'ancien moteur, jamais le résumé stocké.** Première
  exécution sur le dump réel contre `decks.summary` : 12 decks exacts, 4 avec un résidu. Le
  résumé est un cache de la dernière sauvegarde que l'ancienne app n'invalidait pas quand
  une paire globale bougeait ; le reproduire n'est pas l'objet du contrôle (l'étape 9 le
  recalcule). Décision : la référence est calculée par l'ancien moteur e890078 (celui de la
  production, extrait par `git show` dans `deploy/out/reference-engine-e890078/`, jamais
  versionné) sur `ygo_old` (archive pré-migration restaurée) avec l'ancien modèle ; (a)
  nouveau moteur avec paires réinjectées attendu identique à 1e-9, (b) écart après purge
  attribué et chiffré ; le résumé stocké n'est qu'une colonne informative. Les heuristiques
  intermédiaires (sous-ensemble de paires, préfixe par ordre physique, trace, budget) ont été
  retirées. Résultat : 16 / 16 identiques en (a) à 1e-12.
- **Gardes e2e sur une base fournie.** `run.mjs --db <url> --db-container <nom>` : aucun
  conteneur créé ni démonté, schéma et migrations non rejoués, cartes synthétiques
  insérées ; `cardsSql` ne comble que les images manquantes (`coalesce`) parce que le jeu
  représentatif partage les passcodes 9000xxxx sans image. Aucun scénario modifié.
- **Jeu représentatif rejoué comme une archive.** `rehearsal.sh --fixture` construit la base
  pré-001, fabrique les résumés (`--fabricate`), archive par `pg_dump` puis suit le chemin
  d'une archive réelle : un seul chemin de code.
- **Postes Windows.** `lib.sh` exporte `MSYS_NO_PATHCONV=1` (Docker) et fournit `host_path`
  (cygpath) pour les chemins destinés à Node. Un retour arrière est tombé une fois parce que
  `restore.sh` a été modifié pendant que la répétition l'exécutait (bash lit un script au fil
  de l'eau) ; non reproduit ensuite, consigne ajoutée à AGENTS.md.

## Première mission — étape 8, partie A, 8 septembre 2026

Le [compte rendu 8A](docs/etape-8.md) contient l'inventaire prouvé, le plan validé, les
réponses Q1–Q10, le rapport de simulation sur le dump réel et la passation vers 8B.

- **Inventaire prouvé avant tout code.** Catalogue relevé sur un PostgreSQL jetable après
  schéma + 001 + 002 (tables, colonnes, index, contraintes, dépendances : aucune vue ni
  trigger) et références de code par grep. Restes : `combo_pairs`, `deck_pair_exclusions`,
  `deck_start_requirements`, `deck_requirements`, `nonengine_categories.relevance`,
  `card_flags.dead_first` / `dead_second` ; `decks.summary` n'en fait pas partie (cache
  invalidé, recalcul à l'étape 9, Q9).
- **D1 : `schema.sql` garde un bloc « Modèle historique » conditionnel.** La migration 001
  lit `deck_start_requirements` et `card_flags.dead_*` sur une base neuve, et 001/002 ne
  changent pas : le schéma doit donc encore créer ces objets, mais seulement tant que 003
  n'est pas journalisée, sinon chaque rejeu du schéma (à chaque déploiement, avant les
  migrations) ressusciterait des tables vides. Le bloc est un `do $$` qui interroge
  `app_migrations` par SQL dynamique (la table peut ne pas exister) ; 003 refuse à chaque
  rejeu tout objet réapparu, et la suite le prouve en rejouant le schéma après la purge.
  `relevance` reçoit un défaut `'both'` pour que l'API cesse de l'écrire sans casser la
  suite persistence, qui s'arrête à 002. Alternative écartée : schéma en état final avec
  journal pré-rempli, qui aurait touché 001/002 par ricochet.
- **« Non convertie » a une définition vérifiable.** Le contenu des conditions ne prouve rien
  (l'utilisateur peut les avoir éditées après 002). 003 s'appuie sur des invariants
  structurels : un prérequis historique source carte est converti si son id est dans
  `deck_requirements` (001 copie les ids, la table n'est plus jamais écrite) ; un prérequis
  v2 est converti si sa (deck, source) porte une condition. Tout écart est nommé (deck, id,
  cartes) et arrête la migration sans rien modifier, de même qu'un horizon résiduel.
- **Purge exacte annoncée = empreinte du rapport.** Le rapport (P1–P6) est produit avant
  toute suppression ; son md5 (lignes triées) doit être fourni par `testhand.purge_accept`
  pour appliquer dès qu'une ligne est purgée. Une paire apparue depuis la simulation change
  l'empreinte et bloque (testé). Rien à purger = aucune acceptation, pour les bases neuves
  (initdb, e2e). L'acceptation vaut périmètre explicite de comptes (Q1 : tous, rapport par
  compte).
- **D2 : simulation = exécution réelle dans une sous-transaction annulée volontairement.**
  Le fichier reste du SQL pur (exécutable par psql et par le pilote pg des tests) ; le mode
  est une GUC de session posée avant le fichier. En simulation, suppressions et contrôles
  après sont réellement joués puis annulés par une exception interne (SQLSTATE `TH003`)
  attrapée dans le bloc ; la migration se termine normalement (code 0) sur la ligne
  « SIMULATION TERMINÉE », distincte de tout échec (exception, code 3 sous psql). Rapport
  émis à la fois par `select` (stdout) et `raise notice`, depuis la même table temporaire :
  aucune divergence possible entre ce qui est simulé et ce qui est appliqué.
- **Q5 : `dead_first` / `dead_second` purgés.** Copiés par deck par 001, jamais lus par
  l'API ; seul prune-stale-cards les fusionnait. Les lignes à drapeau vrai sont rapportées
  (P6) avant suppression des colonnes.
- **prune-stale-cards refuse avant 003 et ne tranche jamais un conflit (Q6).** L'outil
  reporte les emplacements v2 : paires par deck (collision → survivante non concernée par le
  report, porteuse de la note ; paire devenue (X, X) supprimée avec ses conditions, comptées),
  conditions (source carte, source paire, feuilles JSON), drapeaux par deck (OU), profils et
  plafonds (repris s'ils manquent). Deux conditions à fusionner ou des profils contradictoires
  annulent toute la transaction en nommant le conflit : une seule condition par source
  (contrat §4) et une annotation manuelle ne se devinent pas.
- **jsonpath en mode strict, obligatoire.** En mode lax, `$.**` rend chaque élément de
  tableau deux fois (6 feuilles comptées pour 3) ; constaté en base, corrigé en `strict` pour
  le comptage des références et la localisation des feuilles à réécrire.
- **Le rapport ne porte que des identifiants internes**, des noms de cartes (catalogue), de
  decks et de catégories, et les notes des paires ; jamais d'email ni de nom de compte, pour
  pouvoir être joint à la documentation et relu.
- **Suite `purge.integration.ts` séparée, aucune suite existante modifiée.** Elle réinitialise
  le schéma public de la base jetable, seulement si la base est vide ou porte les fixtures
  d'une suite du dépôt (même garde d'URL que persistence) ; faux Supabase HTTP local
  (≥ 10 000 ids) pour prune-stale-cards ; fixture `legacy-representative.sql` = base de
  production pré-001 à identifiants fixes. `npm run test:integration` enchaîne persistence
  puis purge.
- **`deploy.sh` ne rejoue pas encore 003** : exception assumée à la règle « nouvelle
  migration = rejeu dans deploy.sh », parce qu'un rejeu naïf refuserait (acceptation
  requise) ; l'intégration avec sauvegarde, simulation, acceptation et contrôles est le
  point 5 (8B). Un déploiement lancé maintenant appliquerait 001 et 002 seulement ; la
  nouvelle app fonctionne sans 003 (Q8).
- **Piège d'outillage** : `String.prototype.replace` interprète `$$` (→ `$`) et `$1` dans la
  chaîne de remplacement ; un patch de `schema.sql` par script a perdu ses `do $$` avant
  d'être repris avec une fonction de remplacement. Consigné dans AGENTS.md.
- **Dump réel joué en simulation dès 8A** (Q3) sur conteneur jetable : 185 paires globales,
  15 exclusions, 15 prérequis tous source carte (convertis en 14 conditions par 002), 4
  pertinences, aucun drapeau ; puis purge appliquée sur la copie avec l'empreinte,
  conditions, cartes et starters identiques avant/après, rejeux sans effet. Le dump reste
  hors dépôt.

## Première mission — étape 7, partie B, 8 septembre 2026

Le [compte rendu 7B](docs/etape-7.md) contient les verdicts par point et par largeur,
les corrections, les gardes ajoutées, le contrôle par mutation et les questions ouvertes.

- **Q3 tranchée : cellules compactes, pas de bande à défilement.** À 360 et 390 px, A et B
  s'empilaient (cartes de 296 px dans 320 px utiles). Sous 640 px, A et B occupent chacune
  une colonne d'une grille de deux colonnes ; les cellules passent à 9 px avec un
  espacement de 1 px et **20 px minimum par colonne** — sans ce minimum, une colonne ne
  contenant que « · » s'écrasait à 14 px et ses en-têtes « 4 » et « 5 » se touchaient ; le
  coin devient « S\U » ; le conteneur et les cartes se resserrent pour laisser 8,5 px de
  marge (police système différente sur Android / iOS). Δ passe en dessous en pleine
  largeur. La capture `mobile-360-matrices.png` (DPR 2) montre des cellules distinctes et
  lisibles : le repli prévu n'a pas été nécessaire.
- **Q4 appliquée** : Exporter Excel et ⇄ Inverser A/B en `py-2` (32 px), ✕ du dialogue en
  `h-8 w-8` avec `title="Fermer"` (même recette que l'aperçu d'import) ; Comparer mesurait
  déjà 32 px.
- **En-tête du comparateur : même convention que l'accueil en 6B.** Sans `flex-wrap`, rien
  ne débordait mais les libellés se coupaient sur deux à trois lignes et les noms A / B se
  tronquaient à « A. … ». Les gardes de départ (débordement, cibles) ne le voyaient pas :
  elles ont été renforcées (libellés sur une ligne, noms ≥ 40 px) avant la correction,
  pour que la garde échoue d'abord. Les noms prennent la place restante (`flex-1 basis-0
  truncate`) : ils cèdent en premier, les actions passent à la ligne sous 400 px.
- **Mur de mains : passer à la ligne plutôt qu'écraser.** Les vignettes de 68 px de haut
  étaient comprimées à 28 px de large en second à 360 px (ratio 0,41 au lieu de 59/86).
  Décision : bande de cartes `shrink-0` (jamais déformée) et ligne de main `flex-wrap`, le
  récapitulatif départs / non-engine / note passant à la ligne sous 640 px — la règle de la
  charte §6.3 (« passer à la ligne au lieu de déborder ou d'écraser »). Coût assumé : une
  main mesure 124 px de haut au lieu de 80 sous 640 px. L'alternative d'un récapitulatif
  vertical compact sans libellés n'est pas tranchée (question ouverte).
- **Gardes avant corrections, verdicts avec captures.** Le scénario `mobile` a été écrit et
  joué avant toute correction : le premier passage a produit le tableau « cassé /
  conforme » par point et par largeur, puis les corrections ont été limitées aux points
  cassés (P1, P2, P3, P7 ; P4, P5, P6, P8 intacts). Une garde initiale de P4 était fausse
  (elle ignorait le signe « − » U+2212 de `fmt.ts`) : corrigée comme défaut de garde, sans
  toucher l'écran.
- **Export non bloquant dans le scénario.** Un téléchargement impossible (bouton hors
  viewport avec la mutation X1) est enregistré comme garde en échec au lieu de lever une
  exception qui aurait masqué les autres verdicts de la largeur.
- **Contrôle par mutation sur les CSS** : sept erreurs volontaires (en-tête sans
  `flex-wrap`, police 8 px, `grid-cols-1`, ✕ 24 px, bande sans `shrink-0`, Exporter 28 px,
  `min-w-5` retiré), toutes détectées par les gardes `mobile`, fichiers restaurés et
  vérifiés par empreinte.
- **`MSYS_NO_PATHCONV=1` vérifié** : la suite PostgreSQL jetable 55433 passe depuis Git
  Bash avec cette variable (11 tests) ; consigné dans AGENTS.md à côté de la consigne
  PowerShell.
- **Hors périmètre, non tranché** : densité du mur sous 640 px, « ↻ Nouvelles mains » à
  24 px (conforme au contrat, action secondaire), Δ compacte sous 640 px, reports 6B sur la
  grille d'annotation (9 colonnes à 1440 px) et l'arbre ET/OU profond — listés dans
  docs/PLAN.md.

## Première mission — étape 7, partie A, 8 septembre 2026

Le [compte rendu 7A](docs/etape-7.md) contient le plan validé, l'inventaire des deltas
(D1–D7), les réponses Q1–Q6 et la passation vers 7B.

- **« · » signifie zéro exact, jamais une faible valeur.** L'écran affichait « · » pour une
  cellule de matrice sous 0,05 % et pour un delta de synthèse sous 0,05 pt (ou 0,005
  carte), alors que l'Excel réserve « · » au zéro exact (`0.0%;-0.0%;"·"`,
  `+0.0%;-0.0%;"·"`) et que le contrat §5 dit qu'un symbole pour une faible probabilité ne
  doit pas signifier zéro. Décision : un seul jeu de formateurs (`matrixCell`,
  `deltaPoints`, `deltaCount` dans `lib/fmt.ts`) aligné sur les formats Excel, utilisé par
  la matrice du panneau, les matrices A / B, la matrice Δ et la synthèse ; « 0.0 » et
  « +0.0 » sont acceptés ; l'infobulle garde la valeur fine. L'arrondi n'a lieu qu'au
  rendu (Q1, Q2 confirmées par l'utilisateur).
- **La couleur du delta de synthèse suit le signe du delta exact**, favorable ou non selon
  la direction de l'indicateur, neutre seulement pour le zéro exact — comme les règles
  `lessThan 0` / `greaterThan 0` de la mise en forme conditionnelle de l'Excel. Le seuil
  `negligible` masquait la direction d'un petit écart réel (D1).
- **`engine/compare.ts` est traité comme le moteur** (Q6) : intouché. L'assemblage du
  comparateur (`comparisonDeckOf`, `unprofiledWarning`) et les seaux du panneau
  (`toBuckets`, `cumulativeOf`, `resolveView`) sont extraits sans changement dans
  `web/src/lib/` pour que le test d'identité suive exactement le code de l'écran au lieu
  de réécrire ses formules — un test qui reformule les formules prouverait la formule,
  pas l'écran.
- **Identité prouvée nombre pour nombre.** Matrice du panneau (mode `full`), matrice du
  comparateur (mode `passes`) et cellules Excel sont comparées en égalité stricte : le
  même moteur sur la même entrée produit les mêmes flottants, une tolérance aurait laissé
  passer un arrondi à quatre décimales. Les agrégats sont comparés à 1e-12 (ordre de
  sommation différent), et les formules Excel sont recalculées par un évaluateur écrit
  dans le test pour la grammaire réellement émise (références, `'Feuille'!$H$6`,
  `SUM(plage)`, `+ − *`) : sans lui, une plage ou un signe faux dans une formule resterait
  invisible, ExcelJS n'évaluant rien. Le deck de test contient un plafond partagé et une
  carte étiquetée sans profil, dont la contribution nulle est prouvée par différence
  (retirer l'étiquette ne change ni U ni la matrice, mais change les copies brutes).
- **Gardes visuelles dans le dépôt** (option A, Q5) : `web/e2e/` avec `playwright-core` en
  devDependency de `web` (aucun téléchargement de navigateur ; Chrome installé ou
  `E2E_BROWSER`), `npm run e2e -w web` hors `npm test` et hors `test-quiet.mjs` parce
  qu'elle exige Docker et Chrome. `run.mjs` monte et démonte lui-même une pile jetable
  (55434 / 8790 / 5174, compte `e2e@example.test`) : aucune commande manuelle, aucun
  risque de pointer la base de dev. Les processus serveur et Vite sont **détachés** et
  journalisés sur descripteur de fichier : avec des tubes, ils mouraient à la fin du
  script (`--keep`) sur EPIPE. `--keep` / `--attach` / `--down` servent à itérer en 7B.
- **Portage fidèle de 6B** : M1–M6 et la préparation des decks reprennent les mêmes
  sélecteurs et mesures que les scripts du scratchpad (stepper 32 px, en-tête et bandeau
  sans débordement, zone de fichier lisible, delta sur une ligne, delta atténué pendant un
  recalcul ralenti par réécriture du script du worker) ; les captures « conforme » ne
  deviennent pas des gardes. Seule adaptation : sous 1024 px la durée de calcul est
  attendue dans le DOM (`state: 'attached'`), le panneau étant un onglet masqué.
- **Le scénario `compare` vérifie l'export réel** : téléchargement navigateur, relecture
  par ExcelJS, comparaison des 24 cellules de A, B et Δ des deux onglets aux infobulles de
  l'écran. C'est la seule garde de 7A qui traverse le navigateur pour l'identité des
  données ; les verdicts responsives sont laissés à 7B (« ne pas commencer le point 3
  hormis ce qui prouve que web/e2e fonctionne de bout en bout »).
- **Docker sous Git Bash** : `--tmpfs /var/lib/postgresql/data` est réécrit en chemin
  Windows par MSYS (« mount path must be absolute »). Consigné dans AGENTS.md ; la suite
  PostgreSQL se lance depuis PowerShell, `run.mjs` appelle Docker sans shell.
- **Reports vers 7B** : point 3, Q3 (cellules compactes sous 640 px, lisibilité sur
  capture), Q4 (32 px sur Exporter Excel, Comparer, ✕, ⇄ Inverser), contrat §5 / §6 et
  charte §6.3.

## Première mission — étape 6, partie B, 7 septembre 2026

Le [compte rendu 6B](docs/etape-6.md) décrit l'infrastructure jetable, les verdicts par
point avec leurs captures et les mesures mobile avant / après.

- **Q3 — les deltas de tuile sont atténués à l'état périmé.** Le §6 du contrat exige que
  « les dernières statistiques restent visibles avec leur contexte antérieur, atténuées »,
  et le delta d'une copie est un indicateur du §5. L'étape 4 avait laissé la ligne de
  delta à pleine intensité (limite consignée : « seule l'indication du panneau signale
  leur péremption ») ; à l'écran, panneau et requête à 0,45 face à des deltas à 1 étaient
  un mélange d'anciennes statistiques présentées comme courantes. Révision : la seule
  ligne de delta passe à `opacity-45` quand `stale` est vrai, infobulle « version
  précédente, recalcul en cours » ; stepper, menu ⋯ et clic restent pleins (« les
  contrôles restent utilisables »). Confirmé par l'utilisateur avant modification.
- **Défaut serveur corrigé : plafond partagé refusé sur une carte profilée.** Constaté au
  menu ⋯ (400 « Un plafond partagé exige un profil ») ; cause : PostgreSQL évalue le CHECK
  sur la ligne proposée par `insert … on conflict do update` **avant** de détecter le
  conflit, donc `group_id` seul (profil absent du corps) violait la contrainte même si la
  ligne existante portait un profil. La suite d'intégration ne couvrait que « plafond seul
  sans ligne » (400 attendu, obtenu pour la mauvaise raison) et « profil + plafond ».
  Correction côté route (pré-contrôle du profil envoyé ou enregistré ; ligne proposée qui
  respecte le CHECK) et non côté client, pour que le contrat de l'API soit vrai pour tout
  appelant ; la contrainte SQL reste la garde finale ; test d'intégration ajouté, aucun
  test existant modifié, client inchangé.
- **Cibles tactiles unifiées, pas conditionnées au pointeur.** 32 px (`h-8 w-8`, `py-2`
  sur `text-xs`) pour le stepper, le menu ⋯ d'une tuile ou d'un deck, Enregistrer,
  Nouveau deck, Importer, Terminer et le ✕ des dialogues ; 24 px minimum ailleurs (le
  sélecteur de contexte passe de 21 à 25 px). Une seule mise en page plutôt qu'une variante
  `pointer: coarse` : plus honnête à valider et sans dépendance à l'émulation.
- **Tuile de 96 px et pied sur deux lignes.** Trois cibles de 32 px ne tiennent pas dans
  78 px : le stepper prend sa ligne, le delta (insécable) et le menu ⋯ la suivante, et la
  grille impose 96 px (3 colonnes à 360 / 390, 7 à 768, 9 à 1440 au lieu de 11). Le libellé
  « −1 : −6.38% » est conservé. Charte §6.3 mise à jour.
- **Retours à la ligne plutôt que compression.** Bandeau de mode et en-tête de l'accueil
  en `flex-wrap` avec libellés insécables ; zones de fichier du dialogue d'import en une
  colonne sous 640 px (deux `<input type=file>` côte à côte forçaient le dialogue à 406 px
  pour un viewport de 360) ; pied du dialogue en `flex-wrap`.
- **Inventaire laissé tel quel.** Le problème présumé (titre tronqué par le compteur) n'a
  pas été confirmé : aucune troncature ni chevauchement mesuré aux trois largeurs, titre
  et compteur passent à la ligne. Correction uniquement de ce qui est cassé.
- **Worker ralenti ou forcé en échec par réécriture du script servi**, via une route
  Playwright qui enveloppe `onmessage` après l'évaluation du module : le moteur, le worker
  et le client de calcul sont intacts ; c'est le seul moyen d'observer « Calcul initial »,
  « Recalcul… » et « Statistiques obsolètes » sur un deck de 40 cartes calculé en 75 ms.
- **Gardes de validation hors dépôt.** Scripts Playwright et captures dans le scratchpad
  (rien installé dans le projet) ; le contrôle par mutation des corrections visuelles
  repose sur eux, celui de la correction serveur sur la suite d'intégration. Limite
  consignée : aucune non-régression automatique de l'interface dans le dépôt.
- **Largeurs validées inscrites au contrat** (§6, « Largeurs et cibles tactiles ») : 360,
  390, 768 px et bureau ; comparateur et mur de mains à l'étape 7.
- **Hors liste, corrigé par cohérence** : le ✕ du dialogue « Ajouter une carte » (même
  défaut de 13 px que celui de l'import). Question ouverte plutôt que décision silencieuse.

## Première mission — étape 6, partie A, 7 septembre 2026

Le [compte rendu](docs/etape-6.md) contient le plan validé, l'inventaire complet
(Y1–Y8, P1–P5, C1–C6) et les réponses Q1–Q5. L'étape est découpée en deux sessions ;
la partie B (validation visuelle, mobile) reprend depuis ce document.

- **Le parseur ne réduit ni n'ignore rien en silence.** `parseYdk` et
  `parsePastedIds` renvoient un rapport : quantités brutes (4 copies restent 4),
  lignes non reconnues avec leur numéro, en-têtes ressemblant à une zone mais inconnus,
  cartes hors convention. Un passcode est un entier décimal strict : `0x10`, `1e7`,
  `+123`, `12.5` ne sont plus coercés mais rapportés. La réduction à la convention
  1–3 est un geste séparé (`clampToConvention`) appelé après décision de l'utilisateur.
- **Tolérances documentées, non rapportées** : lignes avant tout `#main` rangées dans
  le main ; lignes `#…` / `!…` commentaires (sauf en-tête de zone inconnu) ; texte
  après le passcode ignoré dans le collage ; formes « 3x id », « 3 id » et « id »
  (compte 1–2 chiffres, passcode ≥ 4 chiffres, donc sans ambiguïté). Le libellé du
  champ les énonce. Un compte nul ou une ligne non reconnue est rapporté.
- **Aperçu d'import avec décision explicite (contrat §2).** Sans anomalie, l'import est
  direct. Sinon l'écran « Vérifier l'import » liste : main vide (importé avec
  avertissement, Q1 : deck vide permis), quantités hors convention (importées à 3
  copies seulement si l'utilisateur clique « Importer avec 3 copies maximum », Q5),
  lignes non reconnues, en-têtes inconnus, passcodes inconnus du catalogue (conservés
  avec leur passcode et comptés, jamais rendus neutres), catalogue indisponible (dit,
  au lieu d'être avalé). Aucune carte reconnue → erreur listant les premières lignes.
- **Constructeur strict.** `addCard` et `setCopies` refusent toute quantité hors 1–3
  ou non entière (`false`, motif dans `persistenceError`, aucune mutation, aucun
  marquage sale) ; 0 reste un retrait documenté. Le dialogue d'ajout affiche
  « ×3 · max » et désactive la ligne. Le serveur reste la garde finale (400).
- **Erreurs rendues telles quelles.** Un 400 à la création est affiché par son message
  (`ApiError`), « hors-ligne » est réservé au fetch qui rejette ; `parseDeckJson` lève
  le motif exact (`ConfigurationError` ou « Fichier JSON illisible ») au lieu de
  `null` ; `GET /api/cards?ids=` refuse en 400 tout identifiant non entier positif
  (helper pur `server/src/domain/cardIds.ts`, plus d'erreur SQL sur `12.5`).
- **Équivalence création / import mesurée sur le modèle moteur.** Le test compare les
  `buildEngineModel` des trois chemins après mise en ordre canonique du main (zone,
  passcode : l'ordre de `readConfiguration`) et prouve séparément que les agrégats de
  `computeAll` sont identiques sur le modèle non trié (à 10⁻¹² près, les seaux bruts
  suivant l'ordre d'énumération). Aucun tri n'est ajouté dans l'éditeur pendant la
  saisie ; la relecture serveur réordonne déjà.
- **Limite consignée (Q2)** : la création manuelle n'ajoute qu'au main deck ; extra et
  side ne viennent que d'un import. L'équivalence porte sur le main, seul analysé.
- **Tolérances de `buildEngineModel` inchangées** : toutes documentées en 5B et
  signalées dans l'interface (paire à membre absent, cible absente, condition inerte,
  plafond supprimé, profil sans étiquette, starter retiré).

## Première mission — étape 5, partie B, 7 septembre 2026

Le [compte rendu](docs/etape-5b.md) détaille la migration, l'interface et les exports.
Les réponses Q1–Q7 de docs/etape-5a.md (section « Réponses ») sont appliquées telles
quelles.

- **Portée des annotations selon le contrat §1.** Profil de disponibilité et plafond
  partagé sont des annotations du compte, posées sur `card_flags` (`availability`,
  `group_id`) et `nonengine_groups` ; la condition ET/OU est locale au deck
  (`deck_conditions`, une par source, FK composite vers la paire). Rien n'est déduit
  des anciens labels (Q4) ; aucun groupe n'est créé par migration (Q2).
- **Une seule représentation des conditions (Q3).** La migration 002 convertit chaque
  source de `deck_requirements` en un groupe ET de feuilles, dans l'ordre des
  identifiants, nommé par le premier ; `deck_requirements` est conservée mais plus lue
  ni écrite. L'API refuse un document portant `requirements` (400 explicite) ; archives
  JSON et brouillons antérieurs sont convertis par `upgradeConfiguration`, la règle
  exacte de la migration, jamais silencieusement côté API. Le moteur refuse une source
  portant les deux représentations (`prepare` jette) au lieu de les combiner ; chaque
  représentation seule reste acceptée, l'ancienne pour les tests historiques.
- **Étiquette sans profil = zéro contribution, signalée (Q5).** Le moteur ne connaît
  plus d'horizon ni de pertinence : un type contribue s'il est étiqueté et profilé.
  `buildEngineModel` transmet ces cartes sans profil et les liste
  (`unprofiledCardIds`) ; le panneau, le contexte du résultat et le comparateur les
  nomment. L'enregistrement n'est pas bloqué (annotations communes au compte).
- **Anciens tests du modèle historique réécrits, pas contournés.** Le bloc « horizon »
  d'`engine.test.ts` (Lot A) testait une règle retirée par décision ; il devient
  « étiquette et profil » avec les mêmes valeurs dérivées d'un profil flexible. Le test
  Q3 de `chronology.test.ts` passe de « combinés par ET » à « refusés » ; les autres
  tests Q1, Q2, Q4 conservent leurs valeurs. `oracle.ts` et `rules.test.ts` sont
  intacts ; `deckOracle.ts` perd seulement le champ `relevance` de son adaptateur.
- **Catégories sans pertinence (Q4).** `nonengine_categories.relevance` reste en base
  (`'both'` pour toute nouvelle catégorie), n'est plus renvoyée par l'API ni exportée,
  et les anciens exports qui la portent sont acceptés en l'ignorant ; l'import ne
  compare plus les pertinences.
- **Invalidation des decks concernés à toute modification globale.** Chaque route
  d'écriture de la bibliothèque met `decks.summary` à NULL : decks du compte contenant
  la carte pour un changement lié à une carte, tous les decks du compte pour une
  catégorie ou un plafond, jamais un autre compte. Le résumé reste un cache non
  affiché ; l'éditeur recalcule après acquittement (étape 4).
- **Réglage unique premier/second dans le store** (`context`, transitoire, non
  enregistré) : les deux passes restent calculées ; le réglage ne change que ce qui est
  présenté (deltas de la grille, matrice, mur de mains, colonne active). Le mur de
  mains n'a plus de scénario local.
- **Libellé « départs théoriques »** pour S dans le panneau, les requêtes, la matrice,
  le mur, le comparateur et l'Excel, avec une explication courte (« sources de start
  disponibles dans la main observée, sans preuve de ligne ») ; les clés d'agrégats
  (`brick_starters`, `starters_ge1`…) et la géométrie de l'Excel ne changent pas.
- **Éditeur d'arbre ET/OU à deux gestes** : le mode « Condition » de la grille ajoute
  une clause ET ou retire la carte ; l'inventaire et les combos éditent l'arbre
  (« ou… » sur une feuille, « ＋ ou… » sur un groupe, « ＋ et… » à la racine, ≥ n). La
  normalisation retire tout groupe vidé et rend la source inconditionnelle quand la
  racine se vide : le groupe vide reste une configuration incomplète refusée par le
  serveur, jamais produite par l'interface.
- **Guardes Q1/Q2 à trois niveaux** : interface (mode Profil ignore et compte les cartes
  sans étiquette ; plafond proposé seulement à une carte profilée), serveur (400
  explicites, contrainte SQL `group_id is null or availability is not null`), moteur
  (garde inchangée de l'étape 5A).

## Première mission — étape 5, partie A, 7 septembre 2026

Le [compte rendu](docs/etape-5a.md) détaille le moteur chronologique et ses oracles.
Aucune persistance ni interface touchée ; l'application calcule encore avec ses
annotations historiques.

- **Contexte unique `'first' | 'second'`** comme paramètre du moteur ; `5` et `6`
  restent acceptés comme synonymes (taille observée) pour les appels historiques et le
  pont B01, tout autre paramètre rend la passe indisponible. Matrice, deltas, requêtes
  et mur de mains (`evaluateHands({ context })`, dernière carte = sixième) en dérivent ;
  `toComparisonMatrix` refuse une passe d'un autre contexte que son scénario.
- **Deux dénominateurs sur `PassResult`** : `total` = mains distinctes C(D,h)
  (sens inchangé, B01 intact) et `outcomes` = issues pondérées Z du contrat §5
  (second : C(D,5)·(D−5) = 6·C(D,6)). Poids des buckets entiers sur Z ; note /10 et
  probabilités divisent par Z. Question ouverte Q7 si l'on préfère un seul champ.
- **Sixième identifiée depuis les compositions de six** : `w(k6, j) = W(k6)·k6ⱼ`
  (identité C(n,k+1)(k+1) = C(n,k)(n−k)). Seuls les types précoces et flexibles sont
  séparés ; les autres copies et le filler partagent l'évaluation « sixième neutre »,
  identique pour eux (vérifié par oracle et mutation). Coût : au plus 1 + nombre de
  types sensibles présents par composition.
- **Potentiel U = flot maximum sur deux fenêtres, par coupe minimale** :
  `min(Σ min(total, opp+own), cap + Σ own, cap + Σ opp, 2·cap)` par unité (groupe
  plafonné) ; type seul = plafond infini. HOPT borne chaque tour à 1 par identité ; une
  flexible ne sert au tour adverse que si elle est initiale ; une précoce en sixième n'a
  aucune fenêtre. En premier, une seule fenêtre (own = 0).
- **Unités couplées conservées dans les buckets** (`neCapped`) à côté de la partie
  additive par signature (`neContrib`) : une requête par catégorie ou union mesure son
  propre potentiel sous les mêmes plafonds (`cappedPotential(unit, keep)`), jamais une
  part répartie entre labels ; la clé de bucket inclut les unités canonisées.
- **Conditions ET/OU** (`Condition`) validées dans `prepare` : groupe vide, opérateur
  inconnu, quantité < 1, type hors modèle → exception explicite relayée par le worker
  (ancien résultat conservé, obsolète). Anciens prérequis traduits en feuilles et
  combinés par ET avec une condition moderne (Q3).
- **Modèle historique conservé pour les types sans profil** (pertinence + horizon) :
  aucune correspondance implicite anciens labels → profils (contrat §3), c'est l'objet
  de la migration de la partie B. Pour un type profilé, la pertinence de catégorie n'est
  pas appliquée (Q4) ; une carte profilée sans étiquette ne contribue pas (Q1) ; un
  groupe sans profil est refusé (Q2).
- **Oracles** : `deckOracle.ts` étend `oracle.ts` (intact) à des decks entiers sans
  rien partager avec la production ; `monteCarlo.ts` (10⁶ mains, mulberry32, graine
  fixe) évalue chaque classe d'issue avec les primitives brutes et vérifie le poids des
  issues indépendamment. Tolérance `5·√(p(1−p)/n) + 5/n`, jamais ajustée : toute
  divergence entre oracles ou avec le moteur est un échec.
- **Nouveaux cas de référence dans un fichier séparé** (`chronology.test.ts`) plutôt
  qu'ajoutés à `rules.test.ts`, pour ne pas toucher au fichier de l'étape 1 ; les
  appels `evaluate(prep, k, dead)` d'`engine.test.ts` sont réécrits vers la nouvelle
  signature avec leurs valeurs attendues inchangées.

## Première mission — étape 4, 7 septembre 2026

Le [compte rendu](docs/etape-4.md) détaille le recalcul versionné et annulable.

- **Deux gardes indépendantes contre une réponse périmée.** Versionnement
  (`modelVersion` avancé à la mutation, avant le délai de regroupement ; `resultVersion`
  porté par le résultat ; adoption seulement si égalité) ET annulation de la tâche en
  cours à toute invalidation. Le contre-exemple de la passation (A lancé, modification
  vers B, A résolu pendant le délai de B) est testé en mode « naïf », sans annulation,
  pour prouver que le versionnement suffit seul ; l'annulation, elle, libère les
  ressources.
- **Annuler = terminer le worker.** Un calcul synchrone dans un worker ne s'interrompt
  pas autrement. Le client repose les tâches encore attendues sur un worker neuf.
  Coût assumé : un nouveau worker par invalidation survenue pendant un calcul.
- **Propriété des tâches : un client = un worker = un propriétaire.** Le store en
  possède un pour sa durée de vie (au plus une tâche) ; le comparateur en crée un par
  montage et le dispose au démontage — terminer le worker de l'éditeur ne peut plus
  abandonner les promesses du comparateur. Toute promesse se termine
  (`ComputeCancelled`, `ComputeFailed`) ; une exception du moteur revient comme réponse
  d'erreur portant l'id, jamais par `onerror` sans id.
- **Le résultat périmé reste affiché avec SON contexte** (`resultContext` : taille,
  catégories, horizons capturés au lancement), atténué par `opacity-45` (charte §7.15)
  sous un état « Recalcul… » ; les contrôles restent vivants. Une nouvelle catégorie
  n'apparaît qu'avec le résultat qui la connaît ; l'ouverture d'un deck vide le
  résultat (état initial), jamais les statistiques du deck précédent.
- **Erreur** : ancien résultat conservé et dit obsolète (bandeau §7.12), bouton
  Relancer (`recompute()`) ; une annulation n'est jamais présentée comme une erreur.
- **Ouvertures numérotées** (`opening`, incrémenté à chaque `loadDeck`) : toute réponse
  d'une ouverture antérieure — chargement, brouillon, sauvegarde — est ignorée.
  Conséquence assumée : une sauvegarde partie d'une ouverture précédente n'adopte plus
  sa révision sur le deck rouvert ; si le rechargement a lu la base avant le commit, le
  prochain Enregistrer reçoit un 409 honnête au lieu d'écraser silencieusement le
  contenu sauvegardé par un état antérieur. Le brouillon, comparé par contenu, est
  effacé dans tous les cas.
- **Annotations globales** (HOPT, catégories) n'invalident qu'après acquittement
  serveur : le modèle ne change pas avant.
- **Limites** : aucun test React ni navigateur (Vitest en environnement `node`) ; la
  limite de coût des très grands decks n'est toujours pas bornée (réserve §2 du
  contrat), un tel calcul reste seulement annulable.

## Première mission — étapes 2 et 3, 7 septembre 2026

Les [corrections et décisions livrées](docs/etapes-2-3.md) remplacent les conventions
historiques de paires globales et d'écritures partielles : configuration version 2,
paires par deck, validation commune client/serveur, transaction et révision.
Les anciennes données de paires sont conservées, sans reprise automatique.
Les résumés statistiques historiques sont invalidés et ne sont plus affichés.
Le JSON v1 et les anciens brouillons sont refusés ; le JSON v2 conserve conditions,
notes et requêtes. La migration a été testée uniquement dans une base jetable.
La purge VPS et les recalculs annulables ne sont pas réalisés à ces étapes.

Arbitrages d'implémentation approuvés explicitement par l'utilisateur le 7 septembre 2026 :

- JSON version 1 refusé avec message explicite, sans convertisseur automatique → une ancienne sauvegarde se réimporte par sa composition et ses paires se redéfinissent ; toute conversion future sera un traitement explicitement contrôlé, jamais implicite.
- L'import JSON échoue entièrement sur conflit de bibliothèque (catégorie de même nom avec une autre pertinence, HOPT explicitement contradictoire) → aucune fusion partielle : la bibliothèque du compte et ses autres decks restent intacts tant que le conflit n'est pas résolu.

## Première mission — étape 1, 7 septembre 2026

Le [contrat métier](docs/regles-metier.md) formalise le plan révisé accepté :
paires permanentes par deck après enregistrement explicite, annotations non-engine
communes au compte, profils chronologiques, starts théoriques et conditions
résiduelles ET/OU. Les [cas de référence](docs/cas-reference.md) distinguent les
règles cibles des comportements déjà vérifiés dans le moteur. Aucun code de
production, schéma ou enregistrement n'est modifié à cette étape.

Les décisions ci-dessous constituent l'historique. En particulier, les anciens
horizons numériques, les paires globales et les descriptions de cartes « mortes »
ne doivent pas servir à contredire le nouveau contrat cible. Les défauts de
calcul identifiés restent à corriger à l'étape 2 ; les nouveaux tests de référence
ne constituent pas une certification de conformité de toute l'application.

## Historique des itérations précédentes

Conformément à §F : toute décision prise en cours d'implémentation est écrite ici.

## Coquilles relevées dans le tableau §C (valeurs de contrôle)

Le moteur calcule les probabilités **exactes**. Deux lignes du tableau §C ne
correspondent pas à la valeur mathématiquement exacte ; le moteur suit l'exact et les
tests documentent l'écart (voir `web/src/engine/engine.test.ts`).

1. **« Deck 40, 3 copies, main 5, P(≥1 copie) = 33,75 % »**
   Valeur exacte : `1 − C(37,5)/C(40,5) = 222111/658008 = 33,7551 %`.
   Arrondie au centième le plus proche → **33,76 %**. §C a tronqué la demi-unité. Les
   trois autres lignes du tableau matchent au centième, ce qui confirme que la valeur
   sous-jacente est bien 33,755 %.

2. **« Deck 40, 3 copies, main 5, P(exactement 2 copies) = 3,29 % »**
   Valeur exacte : `C(3,2)·C(37,3)/C(40,5) = 23310/658008 = 3,5425 %`.
   L'écart n'est pas un arrondi — **3,29 % est une erreur**. La valeur correcte est
   **3,54 %**.

Toutes les autres valeurs (39,43 % ; 12,50 % ; somme = 1 ; deck vide = 0 start ; les 4
cas de couplage dont le test HOPT décisif) sont reproduites exactement.

## Points de modélisation tranchés

- **Redondance** = nombre d'arêtes présentes sur **tous** les sommets de la main
  (starters inclus), pas seulement le sous-graphe non-starter. C'est la lecture
  « nombre de combos présents » de §2.4. Aucun cas de test §C ne distingue les deux
  interprétations (aucun ne combine starter + paire pour la redondance) ; ce choix est
  le plus fidèle à la définition produit.

- **Comptage non-engine** = **union** des copies appartenant à ≥1 catégorie pertinente
  (une carte dans deux catégories compte une fois dans le total, mais une fois **par
  catégorie** dans la ventilation). Les copies multiples comptent (2 Ash = 2
  interruptions). ⚠️ **Amendé à l'itération 2** : le total non-engine des cartes **HOPT**
  est désormais plafonné par un horizon de tours (`min(copies, horizon)`) — voir la
  section « Itération 2, Lot A » plus bas. La règle « HOPT ne réduit que le graphe de
  combo » ne vaut plus pour le total ; elle reste vraie pour le graphe et pour la
  ventilation par catégorie (copies brutes).

- **Contribution marginale (delta)** = `P(≥1 start) − P(≥1 start | −1 copie)`, la copie
  retirée basculant dans le filler (taille de deck constante). Calculée pour les deux
  passes ; la colonne affichée est pilotée par le sélecteur « delta 1st/2nd ».

- **Taille de deck** = somme des copies du main deck. Les curseurs de copies éditent
  réellement le deck : baisser une carte de 3→2 réduit la taille (avertissement si
  hors 40–60, §D). Le filler = cartes non annotées, indépendant des copies annotées.

- **Note /10 (§4.4)** = percentile calibré sur la distribution **exacte** des mains du
  deck (buckets de la passe), pas sur l'échantillon affiché. Score = starts (×100) puis
  non-engine en départage, pondéré par le curseur « importance ». Point-milieu pour les
  égalités.

- **Pivots colorés vs. pastilles (§D point ouvert 2)** : couverture gloutonne par degré
  décroissant → le hub d'un groupe devient pivot (coloré), ses voisins reçoivent sa
  pastille. Purement décision d'affichage, le calcul n'en dépend pas. Dual de l'exemple
  du document (qui colorait les feuilles) mais équivalent et plus économe en couleurs.

- **Couleurs** : `oklch()` natif CSS, teinte par angle d'or, L et C fixes → luminosité
  perceptuelle constante, lisible en surimpression. Non stockées, dérivées à
  l'affichage (§A).

- **Auto-combo (2 copies de la même carte = combo, §D point ouvert 1)** : non implémenté
  (collision avec HOPT). Rejeté à la saisie côté API et côté store.

- **Persistance** : best-effort. Toute annotation met à jour l'état local
  immédiatement puis tente le backend ; un échec bascule en mode « hors-ligne » sans
  jamais bloquer l'UI. L'état complet est aussi sérialisé dans l'URL (`#s=`, compressé
  lz-string) pour partage/repli sans backend.

- **Mode requête** : évalué sur les buckets d'issues (starts, redondance, comptes par
  catégorie) renvoyés par le worker → prédicats arbitraires instantanés, sans
  recalcul.

## Itération 1 — corrections

- **Cartes mortes selon la position (Lot C)** : `deadFirst`/`deadSecond` retirent la
  carte du graphe de combos ET des starters pour la passe concernée (traitée comme du
  filler : ses copies occupent toujours la main mais ne produisent ni start ni arête).
  Le comptage non-engine reste régi par la pertinence de catégorie, inchangé — une carte
  morte going first mais taggée handtrap compte toujours comme handtrap. Un flag mort sur
  une carte non annotée par ailleurs n'a aucun effet (elle est déjà filler). Deux tests
  moteur couvrent le cas ; les valeurs §C sont inchangées (défaut = non-mort).

- **Annotation par modes (Lot B)** : le menu ⋯ par carte n'est plus le canal des actions
  fréquentes. Une barre de modes bascule la grille entière (Combo/HOPT/Starter/Non-engine)
  ; on enchaîne les cartes sans rouvrir de menu. Mode combo = flux à pivot (1er clic =
  pivot coloré, clics suivants (dé)lient, re-clic pivot ou « Nouveau pivot » change de
  groupe sans sortir). Raccourcis C/H/S/N, Échap sort. Le ⋯ ne garde que le rare :
  détail, retrait du deck, suppression de paire en bibliothèque, flags morts (Lot C).

- **Radix pour les menus (A2)** : `@radix-ui/react-dropdown-menu` en portal avec
  `avoidCollisions` + `collisionPadding` → les menus ne sortent jamais du viewport
  (première/dernière colonne, dernière ligne). Remplace le Popover maison.

- **Compteur de copies (A1)** : le segmented 1/2/3 débordait de la vignette (le « 3 »
  était inatteignable). Remplacé par un stepper compact `− N +` à largeur garantie
  (`shrink-0`), sans conteneur `overflow:hidden`. La densité de la grille est préservée.

## Itération 2 — corrections

### Lot A — plafond HOPT du non-engine par horizon de tours (correction §B.3 étape 5)

La spec §B.3 étape 5 (« compter les non-engine sur la composition complète ») court-
circuitait l'effondrement HOPT : 3 Dominus Spark HOPT going first étaient comptés comme
3 non-engine alors qu'une seule copie est activable dans la fenêtre d'un tour adverse.

**Correction** : le total non-engine d'une carte **HOPT** est plafonné par un **horizon
de tours d'interaction**, propre à la passe :

```
si is_hopt(carte) : contribution = min(copies_en_main, horizon)
sinon             : contribution = copies_en_main
```

Le filtrage par pertinence de catégorie (`first`/`second`/`both`) s'applique **après** le
plafonnement. Horizon **réglable** (plage 1..3), défauts **first = 1**, **second = 2** —
c'est une hypothèse de jeu, pas une vérité (`horizonFirst`/`horizonSecond` sur
`EngineInput`, exposés dans « Options de calcul » du panneau de stats, sérialisés dans
l'URL de partage). Vérif : 3 Spark HOPT 1st → 1 ; 2 Ash HOPT 2nd → 2 ; 3 Ash HOPT 2nd → 2.

**Périmètre.** L'horizon ne touche **que** le total non-engine (`neFirst`/`neSecond`,
donc `E[non-engine]`, la distribution non-engine et la matrice croisée). Le **graphe de
combos est inchangé** : une carte HOPT reste 1 sommet (§2.3), starts et redondance ne
bougent pas (test dédié `engine.test.ts` : `startsExact` identique quand l'horizon
change).

**Point tranché — `catCounts` (ventilation par catégorie) reste en copies BRUTES**, non
plafonné. Justification : (1) le brief cible le *total* ; (2) `P(≥1)`, seule stat par
catégorie affichée dans le panneau, est invariante par plafond (`min(k,h) ≥ 1 ⇔ k ≥ 1`) ;
(3) un prédicat « catégorie ≥ N » du mode requête interroge la main *tirée* (combien j'ai
piochée), pas l'*activable*. Plafonner `catCounts` aurait exigé de rendre `evaluate`
spécifique à la passe (une seule des deux valeurs `neFirst`/`neSecond` est consommée à la
fois) pour un effet visible nul côté panneau et ambigu côté requête. Tests §C ajoutés
(carte X HOPT, carte Y non-HOPT, réglage + bornage de l'horizon, invariance des starts).

## Itération 3 — ajout / retrait de cartes

- **Retirer une carte n'efface aucune connaissance de jeu (C1).** `removeCard` supprime
  la seule ligne `deck_cards` ; starters, exclusions, flags HOPT/mort, catégories et
  paires sont **conservés**, inertes tant que la carte est absente (`buildModel` les
  ignore), et **restaurés au ré-ajout**. Corrige un bug où le starter était supprimé.
  Vérifié en base (retrait → `deck_starters` intact → ré-ajout → starter actif).
- Toute modif de `deck_cards` = **invalidation complète** puis recalcul intégral dans le
  worker (jamais de MàJ partielle) ; les mains affichées du mur sont **renotées** sans
  re-tirage (`drawHands` ⊥ `evaluateHands`).

## Itération 4 — persistance des decks

- **Séparation global / local.** La bibliothèque (paires, flags, catégories) est écrite
  **immédiatement** (connaissance de jeu, transverse). Les données **locales au deck**
  (`deck_cards`, `deck_starters`, `deck_pair_exclusions`, `params` = horizons +
  importance) relèvent du bouton **Enregistrer** (état `dirty`, Ctrl/Cmd+S, horodatage).
- **Brouillon local IndexedDB** écrit en continu (debounce 500 ms), indépendant de la
  base. Reprise proposée à l'ouverture. Comparaison brouillon/enregistré **par contenu**
  (`localSig`), pas par horodatage — robuste au décalage d'horloge client/serveur.
  Effacé à l'enregistrement.
- **`decks.summary` (jsonb)** met en cache l'aperçu de l'accueil (start≥1 1st, brick 1st,
  taille), écrit à chaque enregistrement. **Indicatif, jamais source de vérité** :
  l'éditeur recalcule toujours.
- **Routeur maison** (aucune dépendance), `/decks` (accueil) et `/decks/:id` (éditeur),
  via l'API History. Confirmation au retour accueil si `dirty` ; `beforeunload` sur
  fermeture/rechargement.
- **§4D déjà satisfait** : le calcul prend l'état de deck **en paramètre**
  (`computeAll(EngineInput)`, `buildModel(s)` ne lit aucun global) → prêt pour la
  comparaison de versions. `Dupliquer` copie composition + toutes les données locales.
- **Partage par URL (`#s=`) retiré** : remplacé par la persistance base + brouillon. Le
  lien partageable est désormais l'URL du deck (`/decks/:id`). `web/src/lib/share.ts`
  supprimé.
- **Catalogue = lookup, pas contrainte (divergence assumée vs §A).** Les colonnes
  `card_id` (deck_cards, deck_starters, card_flags, card_categories, combo_pairs) **ne
  référencent plus `cards`**. Le catalogue migré est incomplet (des passcodes récents
  manquent) et l'`id` EST le passcode (images dérivées du CDN, nom = confort). Une FK
  catalogue faisait échouer tout l'import d'un deck (rollback, 500 `23503`) dès qu'une
  seule carte manquait. Drop idempotent dans `schema.sql` pour les bases existantes.
- **Reste à faire (non bloquant, signalé)** : les **filtres du mur de mains** et les
  **requêtes enregistrées** du mode requête ne sont **pas encore** persistés dans
  `params` (seuls horizons + importance le sont). L'infrastructure `params` est prête ;
  il ne reste qu'à y brancher ces états UI.

## Itération 5 — prérequis en deck

- **Coquille du contrôle chiffré §F.** Le brief annonce **29,49 %** et affirme que
  l'exact est *en dessous* du produit naïf 33,75 % × 87,50 % = 29,53 %. C'est faux :
  « ≥1 A en main » et « B en main » portent sur des cartes **disjointes**, donc
  **négativement corrélées** en tirage sans remise → « ≥1 A » et « B *pas* en main » sont
  **positivement corrélées** → l'exact est **au-dessus** de 29,53 %. Valeur exacte par
  énumération : `(C(39,5) − C(36,5))/C(40,5) = 198765/658008 = 30,21 %`. La **table de
  vérité** (6 lignes) du brief, elle, est correcte et matche le moteur. Test asserte
  30,21 % ; c'est la 3ᵉ coquille chiffrée du corpus §C (cf. 33,75 % et 3,29 %).

- **Modèle.** Prérequis **locaux au deck** (`deck_start_requirements`), source = starter
  1-carte OU paire ; plusieurs prérequis sur une source sont **cumulatifs (ET)**. Une
  source non satisfaite : le starter ne compte pas, l'arête est retirée **avant** le
  couplage (donc hors redondance). Copies restantes = `total(req) − k(req)`.

- **Piège traité : promotion en type suivi.** Toute carte citée dans un prérequis est
  ajoutée aux types de `buildModel` même sans autre annotation ; sinon `k(req)` est
  inconnu (carte fondue dans le filler) et le prérequis est incalculable. Promotion sans
  effet sur les décks *sans* prérequis → les tests §C restent strictement identiques
  (chemin rapide `hasPrereqs=false`, 22/22 verts). Carte requise absente du deck →
  `requiredType=null`, total 0 → source morte en permanence (signalée dans l'Inventaire).

- **Pas de consommation de ressource** (hors périmètre, §C note) : 2 dépendantes HOPT +
  1 copie requise restante = le flag HOPT réduit déjà à un sommet unique.

- **UI.** Mode `Prérequis` (raccourci P), même mécanique à pivot que `Lier combo`
  (dépendante → requises). Distinction visuelle **impérative** : marqueur en **contour
  pointillé** ambre + icône « deck » (▤) au coin bas-droit (les pastilles de combo sont
  pleines, en haut-droite) ; au survol de la dépendante, ses cartes requises se
  surlignent (relation **dirigée**). Prérequis sur une **paire** : posé depuis l'onglet
  Combos. Inventaire : section « Starters conditionnels » avec les deux avertissements
  (requise absente ; requise en 1 copie + probabilité 12,5 % 1st / 15 % 2nd sur 40).

## Itération 6 — distributions non-engine parcourables (affichage seul)

- **Purement de l'affichage** : aucune valeur nouvelle, réutilisation des distributions
  déjà calculées (`startsBuckets`, `nonEngine`, `perCategory[].dist`). Tests §C
  strictement inchangés (22/22 verts).
- **Bascule de vue** (◀ / titre / ▶) : Starts jouables → Non-engine (total) → une entrée
  par catégorie. Les deux colonnes (1st/2nd) suivent la vue choisie.
- **Colonne cumulée** (« au moins n ») ajoutée à chaque ligne 0/1/2/≥3, y compris pour
  Starts. Ligne 0 = « — » (P(≥0) trivial).
- **Pertinence par passe** : une catégorie non pertinente sur une passe (ex. board
  breaker going first) affiche une mention explicite dans cette colonne, pas des zéros
  (avec `relevance ∈ {first,second,both}`, le cas « pertinent sur aucune passe » ne peut
  pas survenir, mais est géré défensivement).
- **Mémorisation** : `statsView` rejoint les params du deck (sauvegardé, brouillon,
  restauré au chargement). Le changer marque le deck « non enregistré » — cohérent avec
  `importance`/horizons (mêmes params save-gated), au prix d'un léger inconfort (une
  préférence d'affichage marque « dirty »). Assumé pour rester cohérent avec le modèle.

## Itération 7 — mode requête généralisé (sujet + intervalle, agrégats, groupes)

- **Critère = sujet + [min, max]** (bornes optionnelles, vide = non bornée, jamais
  confondue avec « ≤ 0 »). ET de tous les critères ; aucun critère → 100 % ; un critère
  `min > max` bloque l'évaluation (résultat « — »).

- **Agréger ≠ additionner (§C) — signatures.** Le piège : une carte dans deux catégories
  serait comptée deux fois. Solution : le moteur groupe les types non-engine par
  **signature = ensemble de catégories PERTINENTES pour la passe**, et chaque bucket
  porte la contribution (dédupliquée, plafond HOPT) par signature. Un groupe de catégories
  G = Σ des signatures dont l'ensemble croise G → chaque carte comptée **une fois**. Ordre
  respecté : filtrage pertinence → union (par signature) → plafond HOPT. Test décisif §E :
  groupe {A,B} partageant une carte **strictement < ** somme des deux compteurs.

- **Le sujet non-engine est « activable », pas « tiré ».** Les sujets catégorie / groupe
  / Non-engine(tous) appliquent le plafond HOPT et le filtrage par pertinence (cohérent
  avec le total `neTotal`). Cela **remplace** la note de l'itération 2 (« le mode requête
  interroge la main tirée ») : depuis l'itération 7, la requête interroge l'**activable**.
  La *ventilation par catégorie du panneau de stats* (itération 6) reste, elle, en copies
  BRUTES tirées — c'est une autre question (combien je pioche vs combien j'active).

- **Un seul système de critères (§D).** Le filtre du mur de mains EST la requête : mêmes
  critères, même contexte d'évaluation (`neContrib` + `neSignatures`) sur les buckets ET
  sur les mains tirées. « Voir ces mains » active le filtre et bascule sur l'onglet. Les
  anciens filtres `starts ≥ / non-engine ≥ / bricks` sont supprimés (exprimables par la
  requête). Requêtes **nommées** enregistrées dans les params du deck ; la requête en
  cours est un brouillon transitoire (non « dirty »).

## Itération 8 — comptes utilisateurs (Lot A : socle d'authentification)

- **Sessions serveur révocables, pas de JWT.** Token opaque de 32 octets aléatoires
  dans un cookie `httpOnly` + `SameSite=Lax` (+ `Secure` en prod), 30 jours
  **glissants** (l'expiration n'est réécrite que sous la moitié restante, pour ne pas
  faire un UPDATE par requête). Seul le **SHA-256** du token touche la base
  (`sessions.token_hash`) : un dump ne donne aucune session utilisable. Déconnexion =
  suppression de ligne, effet immédiat — pas de danse de refresh JWT.

- **Hachage scrypt natif** (`node:crypto`, N=2¹⁷ r=8 p=1, OWASP) : zéro dépendance,
  pas de build natif sous Windows. Les paramètres voyagent dans le hash
  (`scrypt:N:r:p:salt:key`) → durcissables sans invalider les comptes. Comparaison en
  temps constant, et **hash factice** calculé quand l'email est inconnu (ou compte
  OAuth sans mot de passe) pour que le timing de `/login` ne permette pas d'énumérer
  les comptes — même réponse 401 « identifiants invalides » dans tous les cas.

- **Inscription sur code d'invitation**, via `INVITE_CODES` (liste en `.env`, séparée
  par des virgules). Zéro table, zéro admin ; liste vide = inscriptions fermées ;
  révoquer = éditer + redémarrer. Le contrôle est isolé dans une fonction unique :
  passer à une table de codes traçables restera un petit changement.

- **Garde globale** en `preHandler` déclarée AVANT l'enregistrement des routes (un
  hook Fastify ne s'applique qu'aux routes enregistrées après lui). Public :
  `/api/health` et `/api/auth/*` uniquement. Rate-limit opt-in par route
  (`@fastify/rate-limit`) : login 10/min, register 5/10 min. CORS resserré sur
  `APP_ORIGIN` avec `credentials: true` — l'ancien `origin: true` est incompatible
  avec des cookies de session.

- **Email = identifiant**, unicité insensible à la casse (index sur `lower(email)`).
  `password_hash` nullable : prépare les comptes Discord seuls (Lot D), qui ne
  pourront jamais se connecter par mot de passe (le login leur répond comme à un
  email inconnu). `user_identities` créée dès maintenant, unique
  (provider, provider_user_id), **jamais** de rattachement automatique par email.

- **Correction au passage : le `.env` racine n'était jamais chargé** par le serveur.
  `npm run dev -w server` exécute avec cwd `server/`, où `import 'dotenv/config'`
  ne trouve rien — tout tournait sur les valeurs par défaut en dur. Nouveau
  `server/src/env.ts` (chemin explicite vers le `.env` racine), utilisé par l'index,
  `db.ts` et le script de migration.

- **Nouvelle commande `npm run db:schema`** : rejoue `db/schema.sql` (idempotent par
  construction) sur la base en marche. Nécessaire car `docker-entrypoint-initdb.d` ne
  s'exécute que sur un `pgdata` vierge — les `alter table` des itérations 4–5
  n'avaient jamais été appliqués autrement qu'à la main.

## Itération 8 — comptes utilisateurs (Lot B : propriété des données)

- **La bibliothèque devient PAR COMPTE** (`card_flags`, `combo_pairs`,
  `nonengine_categories` + `card_categories` par transitivité). Décision assumée vs
  « globale partagée » : personne ne peut détruire les annotations d'un autre
  (`deletePair` est définitif), et le partage existe déjà via l'export/import JSON
  complet. Clés recomposées : `card_flags` PK `(owner_id, card_id)`, unicité
  `combo_pairs (owner_id, card_a_id, card_b_id)` et
  `nonengine_categories (owner_id, name)`.

- **Les deux catégories de base** ('Handtrap', 'Board breaker') ne sont plus seedées
  par le SQL (le `on conflict (name)` n'aurait d'ailleurs plus de cible) : elles sont
  créées **pour chaque compte** à sa création, dans la même transaction
  (`server/src/auth/account.ts`, point d'entrée unique — register aujourd'hui,
  Discord/adopt aussi).

- **Deck d'autrui → 404, jamais 403** : on ne révèle pas l'existence d'une ressource.
  Toutes les requêtes decks/library sont bornées à `owner_id` ; les références
  croisées (`pair_id` d'exclusion, `source_pair_id` de prérequis, `category_id`)
  sont validées côté SQL (`insert … select … where owner_id = $n`) — un id de paire
  volé à un autre compte est silencieusement ignoré.

- **Migration legacy en deux commandes** : `npm run db:schema` (ajoute les colonnes
  `owner_id`, nullables à ce stade) puis `npm run adopt -- <email> <mdp>` — crée ou
  réutilise le compte, adopte TOUS les orphelins, bascule les anciennes clés
  (PK/unicités sans owner) vers les nouvelles, verrouille `owner_id NOT NULL`, en
  UNE transaction, relançable sans risque. Le schéma d'une base VIERGE naît
  directement dans l'état final ; `adopt` n'est que le chemin legacy.

- **Validé sur base fantôme** (copie `pg_dump` de la base réelle, adoptée puis
  éprouvée en deux comptes) : 8 decks/102 paires/73 flags/4 catégories adoptés,
  re-run no-op, 404 croisés sur GET/PUT/duplicate/starters, flags et paires isolés
  (deux comptes peuvent flagger la même carte), deck source intact.

## Itération 8 — comptes utilisateurs (Lot C : front)

- **La page de connexion est rendue À LA PLACE de la route demandée** (garde dans
  `App.tsx`), l'URL n'est jamais touchée : un lien profond `/decks/:id` aboutit
  exactement là où on voulait aller après connexion — zéro machinerie de
  « destination mémorisée », pas de route `/login`.

- **401 ≠ hors-ligne.** Le mode hors-ligne existant (backend injoignable, l'app reste
  utilisable sans persistance) avalait toutes les erreurs backend. Désormais :
  un `fetch` qui REJETTE = panne réseau → `offline` (l'app se rend, sans login
  impossible) ; un **401 du serveur** sur une route protégée = session absente/expirée
  → événement `ygo:unauthorized` → retour à la page de connexion. Sur `/auth/*`, le
  401 reste une réponse normale (sonde `/me`, mauvais identifiants). `ApiError`
  transporte le statut ET le message serveur (« code d'invitation invalide »…)
  jusqu'aux formulaires.

- **Déconnexion = purge des brouillons IndexedDB + rechargement complet.** Les
  brouillons contiennent des decks entiers (poste partagé) ; le
  `window.location.assign` garantit zéro résidu d'état en mémoire (store Zustand
  compris) d'un compte à l'autre.

- **`bootstrap()` (bibliothèque du compte) ne part plus qu'après authentification** :
  `Routed` ne monte que derrière la garde — l'ancien chargement à vide au démarrage
  disparaît.

- **Validé au navigateur** (Playwright + Edge headless, base fantôme) : login page,
  mauvais mot de passe (message serveur affiché), connexion (8 decks adoptés,
  annotations, stats moteur calculées), menu de compte, deep link + reload avec
  session persistante, déconnexion avec session révoquée côté serveur, formulaire
  d'inscription avec code d'invitation.

- **Amendement (bug trouvé au premier register réel)** : les bascules d'unicité
  (`combo_pairs`, `nonengine_categories`) sont déplacées de `adopt` vers
  `db/schema.sql` (bloc DO idempotent) — elles sont jouables AVANT l'adoption car
  NULL est distinct dans un index unique. Sans cela, un register sur base legacy
  percutait l'ancienne unicité globale `unique(name)` (seed de 'Handtrap' vs ligne
  legacy) et le 23505 était traduit à tort en « compte existe déjà » (409). Le catch
  du register est désormais scopé à la contrainte `users_email_unique`, et le seed
  utilise `where not exists` (indépendant des contraintes). Seul le PK de
  `card_flags` (qui exige NOT NULL) reste basculé par `adopt`.

## Itération 8 — comptes utilisateurs (Lot D : OAuth Discord)

- **Deux intentions, un cookie d'état court** (`ygo_oauth`, 10 min, httpOnly,
  SameSite=Lax — le Lax laisse passer le cookie sur la redirection top-level de
  retour) portant l'aléa anti-CSRF + le code d'invitation + le drapeau « liaison ».
  Le `state` du retour est comparé à l'aléa du cookie ; mismatch ou cookie absent →
  refus.

- **La porte reste fermée** : créer un compte via Discord exige un code d'invitation
  valide, embarqué dans le cookie d'état AVANT le départ chez Discord et REvalidé au
  retour (l'env a pu changer). Un code fourni mais invalide échoue avant même la
  redirection. Une identité déjà connue se connecte sans code.

- **JAMAIS de rattachement automatique par email.** Un email Discord identique à un
  compte existant → erreur explicite `email_taken` (l'email Discord ne prouve pas la
  propriété du compte : ce serait un vol de compte). La liaison est un geste
  explicite, en session (`?link=1`), depuis le menu de compte. Déliaison refusée si
  le compte n'a pas de mot de passe (il perdrait tout moyen de connexion) — comptes
  Discord seuls : `password_hash` null, traités en inconnu par le login mot de passe.

- **URLs Discord surchargeables par env** (`DISCORD_AUTHORIZE_URL` / `TOKEN_URL` /
  `USER_URL`) : le flux complet est testé contre un mock local, sans app Discord ni
  réseau. Bouton masqué côté front si non configuré (`GET /api/auth/providers`).
  Redirection via le proxy Vite (`:5173/api/...`) : tout reste même origine.

- **Vite paramétrable** (`WEB_PORT`, `API_PROXY`, `strictPort`) : permet une deuxième
  pile (tests, base fantôme) à côté de la pile de dev sans se marcher dessus.

- **Validé au navigateur** (mock Discord, base fantôme) : création avec invitation,
  refus sans invitation (client ET serveur), re-connexion par identité connue,
  liaison à un compte mot de passe puis login Discord → bon compte, email déjà pris →
  refus explicite, déliaison (identité redevient inconnue), state falsifié/absent →
  `state_mismatch`, annulation Discord → `cancelled`.

- **Amendement (revue sécurité)** : `/discord/start` est désormais rate-limité
  (10/min) — sa réponse (erreur immédiate vs redirection Discord) révèle si un code
  d'invitation est valide, ce qui en faisait un oracle de brute-force non throttlé
  sur des codes à faible entropie.

## Itération 9 — comparateur de decks (matrice starts × non-engine)

- **Le prérequis §3 de la spec (classification par scénario) était déjà satisfait** :
  le moteur porte `deadFirst`/`deadSecond` par carte et la pertinence de catégorie
  `first | second | both` — aucune migration du modèle de carte n'a été nécessaire.
  La spec supposait un moteur hypergéométrique naïf à trois catégories ; le site
  calcule en réalité des **starts jouables** (couplage maximum, prérequis, HOPT,
  horizon). Le comparateur est donc une couche PURE au-dessus des `PassResult`
  existants (`engine/compare.ts`) : il ne recalcule rien, il normalise `crossMatrix`
  en 4 × 6 à seaux fixes (`≥3`, `5+` = Σ ne ≥ 5) et compare. Libellés « starts »,
  pas « starters », pour coller à la sémantique réelle.

- **§7.4 adapté au moteur réel.** « Les marges lignes ne dépendent que de (S, D, h) »
  n'est vrai que du modèle naïf ; avec combos/prérequis/dead, un même S peut donner
  des profils de starts différents. Le garde-fou compare donc les marges OBSERVÉES :
  égales → note « seule la répartition non-engine bouge » ; différentes à S égal →
  note explicative (combos/prérequis/dead), pas « bug de classification ».

- **Incohérence interne du §11 de la spec, signalée** : le paragraphe « ce que la
  fixture doit démontrer » affirme des marges lignes identiques entre A et B
  (8.3/33.8/39.5/18.3 GF) — contredit par sa propre table d'agrégats (brick 9.2 vs
  8.3, Δ −0.9) : ces marges sont celles de B seul. Les tests reproduisent la table
  d'agrégats (cohérente avec les matrices), à ±0,3 pt après normalisation des
  matrices relevées (leurs sommes font 99,8–100,1 %).

- **Moyennes « plancher » (≥3 = 3, 5+ = 5), pas moyennes exactes** — la spec
  laissait le choix. Motif : l'onglet Synthèse de l'export est entièrement en
  FORMULES pointant sur les matrices (modifier une cellule bleue recalcule tout) ;
  une moyenne exacte serait une constante morte incohérente avec ce modèle. Le
  libellé dit « plancher » partout, écran comme Excel.

- **ExcelJS 4.4.0 confirmé** (styles, formats numériques, mise en forme
  conditionnelle — SheetJS Community n'a pas de styles, heatmap impossible).
  Génération CÔTÉ CLIENT en import dynamique → chunk séparé (~940 kB) chargé au
  premier export seulement. Le classeur réplique `docs/comparatif_mitsurugi.xlsx`
  (géométrie, formules, conventions bleu/noir/vert) ; `fullCalcOnLoad` car aucun
  résultat de formule n'est écrit. Δ de Synthèse colorés par règles `cellIs` PAR
  LIGNE (mérite selon le sens souhaité), pas par échelle de signe.

- **`buildModel` extrait du store → `lib/engineModel.ts`** (le commentaire « prêt
  pour la comparaison §4D » disait vrai) : l'éditeur passe son état Zustand, le
  comparateur assemble la même source depuis `DeckDetail` + bibliothèque API. Le
  worker gagne un mode `passes` (2 passes sans les contributions marginales, qui
  coûtent n+1 énumérations et ne servent qu'à l'éditeur).

- **Garde-fou ajouté hors spec** : horizons d'interaction différents entre les deux
  decks → avertissement (une partie de l'écart non-engine viendrait du réglage, pas
  des cartes). Idem deck < 6 cartes → erreur avant calcul (main de 6 intirable).

- **Validé au navigateur** (Playwright + Edge headless, API mockée, sans base) :
  accueil → dialogue A/B → page (matrices à échelle commune, delta ±2 pts avec
  légende, S/N par scénario, bandeau §7, synthèse mérite — hausse de « 0
  non-engine » peinte en rouge), export .xlsx téléchargé puis relu (openpyxl :
  onglets, formules, somme bloc = 1, valeurs moteur exactes), inversion A/B. La
  fixture E2E reproduit l'asymétrie §3 : handtraps → cartes going-second only fait
  bouger la matrice GF (N passe à 0) en laissant la GS strictement identique.

## Maintenance du catalogue — purge des passcodes périmés

- **Le problème.** `migrate-cards.ts` fait `on conflict (id) do update` : il ajoute
  et met à jour, **il ne supprime jamais**. Or la source retire des lignes. YGOPRODeck
  attribue aux cartes OCG un passcode **provisoire** (`1004xxxxx` / `1014xxxxx`) puis
  le remplace par le vrai passcode à la sortie TCG ; l'entrée provisoire disparaît de
  la source mais **survit en local**. Constat au 2026-08-31 : 14 590 lignes locales
  pour 14 529 côté source, soit **61 résidus** — dont 39 doublons de cartes bien
  présentes sous leur passcode courant (deux « Witchcrafter Seed » dans la recherche).

- **Purge = report, pas suppression sèche.** Le catalogue est un LOOKUP sans FK (cf.
  §A) : rien ne fait le report à notre place, et supprimer une ligne référencée
  changerait **silencieusement** les probabilités d'un deck. `prune-stale-cards.ts`
  reporte donc les 8 emplacements de passcode (`deck_cards`, `deck_starters`,
  `card_flags`, `card_categories`, `combo_pairs` ×2, `deck_start_requirements` ×2)
  vers le passcode courant **avant** de supprimer.

- **Cible = même nom, toujours dans la source.** Un seul candidat sinon on ne devine
  pas. Les homonymes légitimes (alt arts : `Blue-Eyes White Dragon` 89631139/89631143)
  sont présents des deux côtés et ne sont donc jamais des orphelins.

- **Règle de sûreté : référencé + sans cible sûre = CONSERVÉ.** Perdre la ligne
  vaudrait pire que le doublon. Le script le signale au lieu de trancher.

- **Conflits de clés composites, traités un par un** — c'est là qu'est le travail :
  `deck_cards` cumule les copies (plafond 3 du check) quand deck+zone contient déjà la
  cible ; `card_flags` fusionne par OU ; `deck_starters` / `card_categories`
  dédupliquent. `combo_pairs` est le cas épineux : unicité `(owner, a, b)` **et** check
  `a <= b`. Le remap et la recanonicalisation se font en **un seul `update`** (deux
  updates violeraient le check entre les deux) ; les paires qui collisionnent après
  report élisent une survivante — celle **non** concernée par le remap, qui porte la
  note écrite par l'utilisateur — et lui cèdent `deck_pair_exclusions` et
  `deck_start_requirements.source_pair_id`. Une paire devenue `(X, X)` est supprimée :
  hors périmètre §D, le moteur l'ignore (`if (a === b) continue`), la ligne serait morte.

- **Simulation = exécution réelle + rollback.** Le mode par défaut joue *toutes* les
  opérations puis annule : les contraintes sont donc réellement éprouvées, pas
  seulement prédites. `--apply` rejoue et valide. Une transaction unique, un contrôle
  final qui refuse le commit s'il reste une référence pendante.

- **Garde-fou sur la source** : moins de 10 000 ids lus = abandon. Sans lui, une
  Supabase en panne (réponse vide) ferait de **tout** le catalogue un « orphelin ».

- **Validé sur scénario fabriqué**, compte jetable couvrant les 8 emplacements et
  chaque branche de conflit — les 16 compteurs attendus, état final vérifié ligne à
  ligne, puis même vérification via le SQL de `--emit-sql` rejoué par `psql` sur une
  base restaurée : états identiques. Relance après purge : 0 orphelin (idempotent).

## Suivi de version du référentiel (source Supabase)

- **Ce que la clé anon peut faire.** La source expose `public.dataset_versions`
  (version, `recorded_at`, `fingerprint`, compteurs) en **lecture** ; les fonctions
  `dataset_version_status()`, `dataset_fingerprint()` et `record_dataset_version()`
  lui sont **fermées** (`42501`). L'empreinte est donc *consignée mais jamais
  revérifiée* de notre côté : un repère, pas une preuve. Recalculer côté client
  supposerait de rapatrier printings et traductions, qu'on ne migre pas.

- **Miroir local `catalog_version`**, une seule ligne (check sur la PK). Elle
  distingue trois compteurs qu'il serait tentant de confondre : `source_cards_count`
  (annoncé), `copied_cards_count` (réellement lu) et `local_cards_count` (lignes en
  base). Les deux premiers valident la copie ; le troisième diverge légitimement
  après une purge — d'où son réalignement par `prune-stale-cards`, sans quoi deux
  bases identiques paraîtraient divergentes.

- **Version lue avant ET après la copie.** Si elle bouge entre les deux, la copie est
  à cheval sur deux versions : **aucune estampille n'est posée**. Idem si le nombre
  copié ne correspond pas à l'annonce. Mieux vaut garder l'ancienne estampille,
  visiblement périmée, qu'en écrire une fausse — une estampille n'a de valeur que si
  on peut s'y fier sans la rejouer.

- **Exposé par `/api/health`**, qui est public : comparer deux déploiements devient
  `curl` ici, `curl` là-bas. Volontairement réduit à version + date + compte — un
  point de contrôle, pas un inventaire, et pas d'empreinte diffusée.

- **`catalog` vaut `null` si la table manque** (base antérieure au suivi) : `health`
  est la sonde du conteneur en production, la casser sur une base pas encore migrée
  transformerait un défaut de traçabilité en indisponibilité.

## Piège de déploiement : le schéma monté est figé à la création du conteneur

- **Constaté le 2026-08-31.** `deploy.sh` rejouait le schéma via le fichier monté
  (`-f /docker-entrypoint-initdb.d/00-schema.sql`). Or `git pull` ne modifie pas le
  fichier en place : il en écrit un nouveau et le renomme, donc **l'inode change**. Le
  bind-mount du conteneur `db` reste attaché à l'ancien inode tant que le conteneur
  n'est pas recréé — et il tourne des semaines (`Up 2 weeks`). Résultat : le
  déploiement passait au vert en rejouant le schéma **du jour du dernier `up`**.
  `catalog_version` n'est jamais arrivée en base, sans un seul message d'erreur.

- **Pourquoi ça n'était jamais sorti** : jusqu'ici le schéma n'avait pas bougé depuis
  le premier déploiement. Le premier changement l'a révélé — et l'aurait révélé bien
  plus tard sans le contrôle `\d catalog_version` fait juste après.

- **Invisible en local** : Docker Desktop (Windows) monte via un système de fichiers
  virtualisé qui relit le fichier hôte à chaque accès, là où un bind-mount Linux natif
  fige l'inode. Un rejeu de schéma correct en développement ne prouve donc rien sur le
  serveur.

- **Correctif : passer le fichier par STDIN** (`-f - < ../db/schema.sql`) dans
  `deploy.sh` comme dans `npm run db:schema`. Le contenu est alors lu par le shell au
  moment de l'exécution ; le montage ne sert plus qu'à l'initialisation du volume au
  tout premier démarrage, son seul rôle légitime.

- **À retenir** : un bind-mount de **fichier** (et non de dossier) ne suit pas les
  remplacements par renommage — ce que font `git`, `sed -i`, et la plupart des
  éditeurs. Ne jamais compter dessus pour du contenu qui évolue.

## Audit — lot 1 : garde, inscription, erreurs, identifiants (16 septembre 2026)

- **Garde décidée sur la route résolue, privée par défaut (04 O1).** `req.url` est le
  chemin brut ; Fastify route sur le chemin décodé, donc `/%61pi/cards/search` sautait la
  garde (confirmé en prod à travers Caddy). La garde lit `req.routeOptions.config` : une
  route est publique si et seulement si elle porte `config: { public: true }` ; sans marque,
  session exigée. Publiques : `/api/health`, `register`, `login`, `providers`, `logout`,
  `discord/start`, `discord/callback` (le visiteur n'a que le cookie d'état ; la liaison
  résout sa session elle-même). `/me` et la déliaison Discord passent par la garde : même
  401 qu'avant, une résolution de session en moins. `requireUser` ajouté aux trois routes
  du catalogue (défense en profondeur, comme decks et library).
- **Front statique dans un plugin encapsulé.** Première version : un hook `onRoute` posé
  sur l'instance racine juste avant `@fastify/static`. Le test « route ajoutée sans marque
  après la fabrique » l'a pris en défaut : ce hook marquait publique toute route
  enregistrée après lui. Le marquage vit donc dans un plugin encapsulé avec le
  gestionnaire 404 (repli SPA, `reply.sendFile` décoré dans ce contexte). Le gestionnaire
  404 de Fastify traverse aussi les hooks ; sans route résolue (`routeOptions.url`
  absent), la garde le laisse passer : il ne rend qu'index.html ou un 404 JSON.
- **Fabrique `buildApp()` (`server/src/app.ts`).** L'app était construite au niveau module
  avec `listen` : intestable. `index.ts` n'écoute plus qu'une app rendue par la fabrique ;
  la configuration est lue dans l'environnement à l'appel, pas au chargement.
- **Email borné à 254 caractères AVANT la regex (05 C1).** `/^\S+@\S+\.\S+$/` coûte n² sur
  une chaîne de « @ » et gèle la boucle d'événements (8,7 s pour 64 000 « @ » dans la
  suite, 44 s pour 256 000 contre l'image de prod). La preuve exigée (64 000 « @ » → 400 en
  moins de 50 ms) impose que ce corps ATTEIGNE le gestionnaire : aucun `bodyLimit`
  abaissé sur les routes d'authentification dans ce lot (le corps JSON de 1 Mio se lit en
  temps linéaire, ce n'est pas un gel). Mesuré : 1,5 ms.
- **Gestionnaire d'erreurs générique (04 O10).** Une erreur à `statusCode` 4xx garde son
  message (`ConfigurationError` 400, `error(404, …)`, 413 / 429 / JSON invalide de Fastify
  et de ses plugins — la limite de débit lève une erreur 429 et passe par lui) ; tout le
  reste répond 500 `{ error: 'erreur interne' }`, détail dans le journal seulement. Le
  corps ne porte plus `code`, `statusCode` ni `message` de Fastify : le client lit `error`
  (il lisait déjà `error` à défaut de `message`). `limit` de la recherche : entier 1..100
  ou 400 (le client officiel n'envoie jamais `limit`). `DELETE /decks/:id` : rien de
  supprimé → 404 (contrat « deck d'autrui → 404, jamais 403 » ; un faux 200 le trahissait).
- **Identifiant des étiquettes et plafonds généré par le serveur (04 O5).** L'`id` client
  est ignoré, pas refusé : le client officiel en envoie encore un et relit l'objet créé ;
  refuser casserait tous les clients déployés pour rien. `persistence.integration.ts`
  exigeait l'identifiant client : il lit désormais celui du serveur (test d'intégration,
  pas un test de référence).
- **Suite `server/tests/auth.integration.ts`, en tête de `npm run test:integration`.**
  Tests écrits avant les correctifs, chacun rouge sur le code d'origine (200 sur
  `/%61pi/…`, 8 692 ms d'inscription, 500 avec code SQL, 200 sur la suppression d'autrui,
  500 « pkey » sur la sonde d'UUID). Elle réinitialise la base jetable à la fin si elle
  porte ses fixtures, pour que `persistence` enchaîne sur le même conteneur. Budgets de
  débit réels par IP (5 inscriptions / 10 min, 10 connexions / min) : à respecter en
  ajoutant des tests. 12 tests ; persistance 14 et purge 11 inchangés.
- **Hors lot, constaté sans corriger.** `bodyLimit` des routes publiques ; en-têtes de
  sécurité (C10) ; pool et délais SQL (C3) ; fuite du store après un 401 (C2).

## Offre freemium — périmètre gratuit / payant, prix, monétisation (16 septembre 2026)

Tranché en séance, à partir des propositions du volet 04 (§4.2 matrice, §4.3 quotas, §5 axes). Ces
propositions étaient annoncées « à trancher » : là où les nombres diffèrent, **ce qui suit fait foi**
et les tableaux de l'audit redeviennent ce qu'ils sont, des points de départ. Trois lignes sont
contredites, elles sont nommées en F1, F3 et F4.

### F1. Une seule limite visible : le nombre de decks. Gratuit = 1 deck personnel

L'offre doit s'énoncer en une phrase — « gratuit = un deck ». Le comparateur n'est donc **pas** une
fonction verrouillée : il devient mécaniquement inatteignable entre deux decks à soi, puisqu'il en
faut deux. Deux règles séparées (« 2 decks mais pas de comparaison ») donneraient un bouton grisé
avec le matériel sous les yeux : ça se lit comme une punition, pas comme une démonstration.

Contredit le §4.3, qui proposait **3 decks** « pour que le comparateur reste utilisable en gratuit ».
Raison du refus : c'est précisément l'inverse qu'il faut faire. Le geste qui déclenche l'achat, dans
cet outil, c'est la **variante** — « est-ce que je passe de 3 à 2 Maxx C ? ». Il demande un second
deck et le comparateur. Donner le second deck sans le comparateur, c'est donner la moitié du geste
et confisquer la conclusion : le pire endroit où couper.

Rétrogradation : les decks au-delà du quota passent en **lecture seule**, jamais supprimés — cas
déjà couvert par la règle de non-augmentation du §4.1 (principe 3). Un compte gratuit qui possède
déjà un deck peut toujours le modifier ; sinon le gratuit devient un piège. Suppression libre et
immédiate, pour qu'essayer autre chose ne demande pas de détruire son travail.

**Non tranché** : des emplacements « archivés en lecture seule » au-delà du deck actif, qui
enlèveraient l'essentiel de la frustration sans rendre la limite poreuse.

### F2. Un ou deux decks de référence, en lecture seule, hors quota

Maintenus par l'exploitant (compte admin), non modifiables, **ne comptant pas dans le quota**. Le
compte gratuit peut donc utiliser le comparateur — son deck contre la référence — et travailler ses
plans de side contre elle.

Ce n'est pas une démo bridée, c'est une fonction : « compare ton deck au deck méta de référence ».
Utile en soi, et c'est la démonstration la plus convaincante possible du comparateur, l'utilisateur
voit exactement ce qu'il achètera. La ligne « Comparateur à l'écran : gratuit » du §4.2 est donc
tenue, mais par ce biais-là.

Coût assumé : un deck de référence périme avec le méta. Plafond de 1 à 2, vieillissement accepté.
Distinct de l'axe X7 (« démo sans compte ») : ici la démonstration est **dans** le compte gratuit,
pas anonyme — cohérent avec F6.

### F3. Plans de side : 3 adversaires en gratuit, 32 en payant (MATCHUPS_MAX)

Contredit le §4.3 et l'axe X4, qui proposaient **1 adversaire « découverte »**. Trop peu : à un seul
adversaire la fiche n'a plus de forme, donc elle ne s'imprime pas, donc elle ne circule pas — et la
circulation de la fiche est un canal d'acquisition (F4). À 3, le gratuit couvre les gros decks du
méta, reste réellement utilisable, et la forme du produit est visible.

Conséquence de rendu : la fiche d'un compte gratuit sort **3 cadres pleins**, jamais 7 cadres à
trous, plus une ligne discrète sur les adversaires supplémentaires. Une fiche à trous ne s'imprime
pas.

### F4. Les exports restent gratuits, et signés

Contredit le §4.2, qui plaçait l'export Excel du comparateur et la fiche / PDF **en payant**.
Raison : ces fichiers sont le principal canal d'acquisition d'un outil de niche. Une fiche qui
circule sur un Discord de locale est de la publicité gratuite ; la verrouiller, c'est payer pour ne
pas être vu.

- Gratuit : mention « fait avec Testhand » + lien, en pied de fiche, dans le PDF et dans le classeur
  Excel. Payant : mention retirée.
- **Prérequis technique créé par cette décision** : ouvrir le PDF à tous les comptes expose le relais
  d'images à beaucoup plus de monde. Le cache disque du relais (audit 03 A1, porte O6) cesse d'être
  une optimisation et devient une **condition d'ouverture**, avec la limite de débit du relais
  appliquée aussi au gratuit.
- Invariant D1 préservé : le paywall ne porte ni sur les artworks ni sur l'accès aux cartes.

### F5. Abonnement seul, 3 à 4 € par mois — jamais d'achat à vie

Aucune offre « à vie », pas même en lancement pour les premiers inscrits. Motif décisif et explicite :
l'exploitant doit pouvoir **couper le VPS** sans devoir rien à personne. Une offre à vie promet ce
qui ne peut pas être tenu — les coûts continuent, le revenu est figé à zéro, et ~40 % de ces offres
disparaissent en moins de trois ans. L'abonnement, lui, s'arrête en cessant de facturer.

Contrepartie inscrite aux CGU : **préavis + export complet des données** avant fermeture. Les moyens
existent déjà (archive JSON v2, YDK, Excel, PDF) : c'est la clause de sortie, elle est déjà outillée.

- Mensuel 3 à 4 €, annuel ~30 € (remise ~20 %). Montant exact non figé.
- Ancrage du marché, et non du conseil SaaS : Moxfield 1 $/mois, Archidekt 2 $/mois (Patreon, retire
  la pub). Le conseil indie usuel (19 à 49 $/mois) est du **B2B**, sans objet pour un public de
  joueurs — à 10 €/mois l'offre paraîtrait absurde à qui connaît ces outils.
- Plancher à 3 € pour une raison de frais : à ce montant, la part fixe de Stripe (~0,25 € + %)
  représente ~10 % du paiement mensuel, ~1 % en annuel. À ces prix, la **fréquence** de facturation
  pèse autant que le prix ; l'annuel est donc proposé d'emblée (30 à 50 % des inscrits le prennent
  quand on le leur propose, et il réduit le churn).
- Ordre de grandeur assumé : conversion freemium 2 à 5 % (2,6 % toutes catégories). À ~1 000 comptes
  gratuits, 4 % et 3 €, cela fait ~120 €/mois : l'hébergement et le domaine, pas un revenu. C'est
  conforme à l'objectif posé (salarié par ailleurs) et cohérent avec le seuil de D1 — N = 1000 € /
  prix mensuel, soit 250 abonnés à 4 € — qui ne sera donc pas approché de sitôt.

### F6. Compte obligatoire dès le gratuit ; OAuth Discord d'abord, Google ensuite

Pas d'usage anonyme : sans compte, pas de deck persisté, le modèle ne tient pas. Discord en premier,
c'est là que vit la communauté (les routes discord/start et discord/callback existent déjà).

Réserves notées :

- L'inscription obligatoire est une friction placée **avant** le moment de bascule ; OAuth est ce qui
  la ramène à deux clics. Ce n'est pas gratuit à écrire : l'authentification actuelle est
  email / mot de passe avec sessions maison, l'ajout est un vrai lot.
- Elle suppose la fin du code d'invitation et la vérification d'email (audit PAR-01, O12).
- **Écarté : revendre des statistiques d'utilisateurs.** Base légale lourde (RGPD) et, sur une
  communauté de niche où les gens se connaissent, un risque de réputation disproportionné. Ce qui est
  retenu à la place, sans risque et avec plus de valeur : des **statistiques agrégées et anonymes**
  sur le méta (« 62 % des decks X jouent 3 Maxx C »), publiables — un levier d'acquisition, pas un
  produit à vendre.

### F7. Pas de publicité. Bouton de soutien, emplacement sponsor en réserve

La publicité display est écartée, pour des raisons d'arithmétique et non de principe :

- un **CMP certifié Google, intégré au TCF de l'IAB**, est obligatoire dans l'EEE depuis janvier 2024
  pour servir de la publicité personnalisée — pas un bandeau maison ; il faut l'ordonnancer avant
  l'app au démarrage de la SPA, et le tenir ;
- AdSense valide du **contenu indexable** : l'app est derrière un login et noindex, l'acceptation
  est improbable. Les réseaux alternatifs demandent plus (Carbon Ads 10 000 pages vues/mois sur
  invitation, EthicalAds ~50 000 et un public tech) ;
- une SPA n'a presque pas de pages vues — l'utilisateur reste 20 minutes sur le même écran, et les
  changements de route n'en sont pas ;
- le RPM du contenu francophone est sous 0,50 $ / 1 000 impressions.

Estimation : 5 à 15 €/mois, contre un bandeau de consentement à chaque visite, du RGPD, et un encart
qui casse la charte sombre. **Quatre abonnés rapportent davantage.**

Conséquences :

- **« sans pub » ne doit pas figurer dans l'argumentaire payant** : on ne vend pas le retrait de ce
  qui n'existe pas, et l'y mettre obligerait à poser une publicité dont on ne veut pas.
- **Bouton de soutien** (paiement unique, type Ko-fi) : retenu, sans cookie tiers ni CMP. C'est le
  modèle de Moxfield et Archidekt, et il s'adresse à qui ne s'abonnera jamais. Réserve exprimée en
  séance — cumuler don et abonnement est inhabituel : si une des deux pièces doit sauter, c'est le
  bouton, jamais l'abonnement, et il peut être différé après le lancement.
- **Emplacement sponsor** servi depuis le VPS (une image, un lien, aucun cookie tiers, donc aucun
  CMP), vendu à la main à une boutique, une chaîne ou un organisateur : gardé en réserve. Un seul
  sponsor à 30 €/mois écrase la publicité programmatique.
- **Affiliation cartes écartée pour l'instant** : le parrainage Cardmarket est plafonné à 10 €/mois
  (symbolique), TCGplayer paie de vraies commissions mais vise un marché américain (attribution au
  premier clic, 48 h) que ce public n'utilise pas. La seule voie sérieuse serait un partenariat API
  Cardmarket, qui se négocie.
- **Réexamen de la publicité** seulement au-delà de ~50 000 pages vues/mois **avec du trafic public
  indexable** — ce qui supposerait l'axe X2 (pages de decks partageables), lequel serait alors un
  levier de référencement et de publicité d'un coup. Pas aujourd'hui.

### F8. Ce que le gratuit garde entier

Annotations, moteur exact, conditions ET / OU, profils, HOPT, plafonds, mode Requête, non-engine,
extra et side : **aucun paywall**. C'est le moment de bascule du produit, et le calcul tourne dans le
navigateur — il ne coûte rien au serveur. Conforme au §4.2 (D10 : « cœur de la valeur du produit :
pas de paywall »).

Formulation de l'invariant : le paywall porte sur le **volume** (nombre de decks, nombre de plans) et
sur la **mention** apposée aux exports. Jamais sur la précision des chiffres, jamais sur les
artworks (D1).

### Questions ouvertes

1. Emplacements « archivés en lecture seule » au-delà du deck actif (F1) : à trancher.
2. Prix exact (3 ou 4 €) et remise annuelle exacte (F5).
3. Quotas du §4.3 non repris ici — requêtes enregistrées (3 / deck), étiquettes (2 + 3), plafonds
   (5). À réexaminer sous la règle « une seule limite visible » de F1 : un quota qui mordrait sur le
   moteur contredirait F8.
4. Bouton de soutien au lancement ou différé (F7).
5. Second seuil en comptes créés pour D1 : inchangé, toujours ouvert.

### Repères externes utilisés

Conversion freemium : [daydream](https://www.withdaydream.com/library/insights/freemium-conversion-rate),
[Guru Startups](https://www.gurustartups.com/reports/freemium-to-paid-conversion-rate-benchmarks).
Prix du marché TCG : [Moxfield](https://www.patreon.com/moxfield), [Archidekt](https://www.patreon.com/archidekt).
Offres à vie : [The Bootstrapped Founder](https://thebootstrappedfounder.com/lifetime-deals-and-saas-businesses/).
Consentement publicitaire : [Google, exigences CMP EEE / UK / Suisse](https://support.google.com/adsense/answer/13554116?hl=en).
RPM : [benchmarks par niche et pays](https://www.techconda.com/2026/02/adsense-rpm-benchmarks.html).
Affiliation : [Cardmarket, partenariats et API](https://help.cardmarket.com/en/api-partnerships),
[TCGplayer Affiliate](https://docs.tcgplayer.com/docs/tcgplayer-affiliate-program).

## Refonte visuelle — application du verdict de l'audit 01 (16 septembre 2026)

Source : `docs/audit/01-visuel.md` §0 (verdict) et §8 (direction A « sombre relevé »), plus une
demande directe : la présentation des decks est bonne, la navigation de l'éditeur ne l'est pas.
Périmètre **purement visuel** : aucun calcul, aucune règle, aucune route, aucun schéma ; moteur,
`lib/engineModel.ts`, `lib/conditions.ts`, `lib/summary.ts` intacts, donc `__ENGINE_VERSION__`
inchangé et aucun aperçu invalidé. Compte rendu : `docs/refonte-visuelle.md`.

Décisions validées avant le code :

- **D1 — Navigation.** En-tête de l'éditeur sur une ligne à toute largeur ; onglets soulignés en
  haut dès 640 px ; **sous 640 px, barre d'onglets en bas** (48 px, libellés courts, nom complet en
  `title`). Préférée aux onglets sur deux lignes et au rail latéral.
- **D2 — Plancher typographique.** Corps 13 px, minimum 11 px ; **seule dérogation** : cellules
  compactes des matrices A / B du comparateur sous 640 px, montées de 9 à 10 px (`text-cell`), pour
  conserver la décision de 7B (A et B côte à côte sans défilement). Préférée à « 11 px partout avec
  un comparateur mobile réaménagé ».
- **D3 — Tokens.** `text-ink-*` supprimé au profit de quatre rôles `fg-1..4` ; fonds et bordures
  gardent les noms `ink-950..500` mais leurs valeurs, relevées, viennent de variables CSS.
  `ink-400..100` retirés de Tailwind (aucun fond ni bordure ne les employait). Préféré à « tout en
  rôles » (400 occurrences requalifiées à la main) et à « ink remappé seulement » (pas de couche de
  rôles).
- **D4 — Une seule passe**, une validation, un commit.

Décisions prises en cours de tâche (questions ouvertes du plan tranchées par défaut, à confirmer) :

- **Échelle fermée.** `theme.fontSize` redéfini hors `extend` : `text-xs`, `text-sm`… n'existent
  plus. Une classe d'origine oubliée ne produit rien et se voit, au lieu de survivre en silence.
- **Nom des classes de texte : `text-fg-1..4`** (et non `text-1..4` du plan) : Tailwind préfixe la
  couleur par `text-`, un groupe `text` aurait donné `text-text-1`.
- **Correspondance mécanique** : `ink-100 → fg-1`, `ink-200 → fg-2`, `ink-300/400/500/600 → fg-3`
  (tout ce qui était « atténué » devient lisible), puis `fg-4` posé à la main sur le seul vrai méta
  (date de l'accueil, passcode) et `fg-2` sur ce qui se lit (delta de tuile, texte de carte).
  `ink-300` (`#9aa2b5`) et `fg-3` (`#9aa3b6`) sont quasi identiques : aucun libellé n'a perdu en
  contraste. Accents en texte : `emerald/amber/sky/red-200/300` → `text-pos/warn/info/neg`.
- **Horodatage = état du bouton.** Le bouton d'enregistrement dit « enregistré 10:04 » au repos
  (inerte) au lieu d'un texte séparé ; « en ligne » et l'heure sont aussi dans le menu compte.
  Conséquence : les gardes e2e désignent le bouton par `data-save` et non par son libellé.
- **Contexte premier / second** : descendu de l'en-tête dans l'en-tête du panneau « Probabilités »
  (Q2 du plan) ; sous 1024 px il ne se règle donc que depuis l'onglet « Stats » et le mur de mains.
- **Barre du bas à libellés seuls** (Q3) : aucune iconographie n'existe dans l'application ; en
  introduire une est une décision de charte, reportée.
- **Une seule `<nav>` rendue** (état `compact` par `matchMedia`), jamais deux masquées par CSS :
  deux barres dans le document rendaient ambigus les sélecteurs `nav button` et la lecture d'écran.
- **Barre du bas = dernier enfant de la colonne**, pas `fixed` : aucune réserve de padding, jamais
  de contenu recouvert ; `h-screen → h-[100dvh]` partout (barre d'outils mobile dynamique).
- **Cartes de chaleur** : formule unique dans `lib/colors.ts` (`heatCell`, `heatDelta`). Case
  **opaque** (`color-mix(in srgb, teinte α, var(--ink-900))`, équivalent exact d'une superposition),
  texte **blanc pur**, puis **noir à partir de α = 0,6685** pour le vert ; le rouge garde le blanc sur
  toute l'échelle. Écart au premier jet (« noir dès α > 0,5 », translucide) : la re-mesure a trouvé du
  noir à 3,1:1 sur les cases moyennes. Calcul : au point de bascule, noir et `#f3f4f8` plafonnent à
  4,38:1 et aucun seuil unique ne tient 4,5:1 sur deux fonds différents (4,49 au mieux) ; blanc pur
  et fond fixe donnent 4,585:1 au pire (rouge 5,75). Gardé par `lib/tokens.test.ts` contre
  `index.css`. Couleurs des séries (`SERIES_STARTS`, `SERIES_COUNT`) sorties de `statsViews.ts`
  (hors `__ENGINE_VERSION__`, vérifié dans `vite.config.ts`).
- **Marqueur « sort / entre »** du planificateur : seule l'illustration d'une copie engagée
  s'estompe, plus le marqueur (4,15:1 quand il s'estompait avec elle).
- **Cibles** : tous les contrôles secondaires à 24 px minimum (`h-6`), les retours « ← Mes decks » /
  « ← Plans de side » et le ✕ du toast et du détail de carte à 32 px ; la garde `mobile` P1 « ← Mes
  decks sur une ligne » se vérifie désormais sur le texte (un seul rectangle de ligne), plus par une
  hauteur de bouton ≤ 20 px.
- **Libellés** : « E[S] / E[U] / E[copies] » → « moyenne », « E[red.] » → « redondance moyenne »,
  « C(D,5) mains » → « les 5 cartes initiales » ; références « §D », « §E », « §3.3 », « §4.4 »,
  « contrat §2 / §3 » retirées du texte affiché (les commentaires de code les gardent).
- **Badges de rôle et pastilles de tuile** descendus à `top-[11%]`, sous le bandeau de nom de
  l'illustration, qu'ils masquaient.
- **`JetBrains Mono` retirée** de la configuration (déclarée, jamais chargée) : `font-mono` système.
- **Hors périmètre** : variante claire optionnelle (Q4), `:focus-visible`, `role="dialog"` et Échap
  sur tous les dialogues (audit §2.4), page de connexion et parcours (volet 02).
