# Back-office — hors numérotation (socle, lecture seule)

Plan validé avec l'utilisateur dans une session antérieure (16 septembre 2026), consigné ici sans
le rouvrir. Les décisions 1 à 11 sont acquises ; les choix techniques T1 à T16 sont ceux de
l'agent, chacun avec sa raison. Comptes rendus par partie en fin de document.

## 1. Intention

Le produit passe en freemium (DECISIONS.md, « Audit freemium » et « Offre freemium » du
16 septembre 2026). Il faut un outil pour gérer les comptes et les droits ; aujourd'hui tout se
fait au shell du VPS. Ce lot pose les **fondations** d'un back-office séparé : modèle de sécurité,
journal, charte. Les actions sur les comptes (suspension, offres, codes d'invitation, révocation de
sessions) viennent dans un lot suivant et s'appuient sur ce socle. Ce qui compte ici est la
solidité, pas le nombre d'écrans.

Deux garanties ne doivent pas se diluer, même si le code du back-office a un bug :

- **l'admin ne lit jamais le contenu d'un deck** (audit 04 §4.1, principe 1) ;
- **le journal est en ajout seul**.

Les deux sont tenues par PostgreSQL (rôle dédié, privilèges par colonne, déclencheur), pas
seulement par le code (§4).

## 2. Décisions validées (rappel, non rouvertes)

| # | Décision |
|---|---|
| 1 | Site séparé en **.NET 10, ASP.NET Core Razor Pages**, sans SPA ; dossier `admin/` à la racine, hors des workspaces npm. |
| 2 | Accès direct à PostgreSQL (même base `ygo`). Serveur Fastify et web inchangés ; l'app publique n'expose aucune route d'administration. |
| 3 | Sous-domaine **bo.scratchrecode.com** (le plan disait admin.scratchrecode.com ; sous-domaine choisi par l'utilisateur à la mise en ligne, 16 septembre 2026), protégé par la connexion admin ; en production, service `admin` dans `deploy/docker-compose.prod.yml`, réseau `edge`, **aucun `ports:`**, joint par un bloc du Caddyfile goldfish (documenté, pas appliqué) ; en-têtes de sécurité et `noindex`. |
| 4 | `users.role` (`user` ou `admin`, défaut `user`) par la migration additive **005**, qui n'ajoute que le rôle et les tables du back-office. Aucune colonne d'offre, d'abonnement ou de suspension. |
| 5 | Le rôle admin s'attribue et se retire **uniquement en ligne de commande** (simulation par défaut, écriture explicite, exécutable sur le VPS par `docker compose exec`), jamais par une route ni une page. Un admin peut posséder des decks. |
| 6 | Authentification propre : mot de passe du compte au format `scrypt:N:r:p:sel:clé` (compatibilité prouvée contre des hachages Node et les vecteurs de la RFC 7914) ; **TOTP obligatoire** ; session de **8 heures absolues**, coupée dès que le rôle est retiré (rôle relu à chaque requête) ; aucun lien avec `ygo_session`, pas de Discord, limite de débit sur la connexion. |
| 7 | Minimisation : la fiche compte montre le **nombre** de decks, jamais leurs noms. |
| 8 | **Tout est journalisé** : connexions réussies et échouées, étapes TOTP, déconnexions, chaque consultation, chaque attribution ou retrait de rôle. Journal en ajout seul, consultable dans le back-office. |
| 9 | Périmètre en **lecture seule** : connexion et enrôlement TOTP ; tableau de bord (comptes, créés sur 7 et 30 jours, sessions actives, decks, version du catalogue) ; liste des comptes (email, nom, création, dernière connexion, nombre de decks, fournisseurs, rôle ; recherche, tri, pagination côté serveur) ; fiche compte (métadonnées, sessions : appareil, création, expiration) ; journal filtrable. Libellés honnêtes : les sessions sont supprimées à la déconnexion et à l'expiration, « dernière connexion » n'est pas « dernière activité ». |
| 10 | Charte **« corpo, factuel »** : sobre et dense, tableaux bordés, chiffres tabulaires, une couleur d'accent, états en triplet teinté ; **clair et sombre avec bascule** (préférence retenue, système par défaut) ; bandeau d'environnement permanent (PRODUCTION ou DEV) ; tokens en variables CSS et échelle typographique fermée ; aucune ressource externe ; documentée dans `docs/design-backoffice.md`. Jamais confondable avec l'app de jeu. |
| 11 | Hors numérotation : tag `backoffice-a-ok` (socle : modèle, sécurité, ligne de commande, migration, séquence de déploiement), puis `backoffice-ok` (site : écrans, charte, garde navigateur, mise en ligne documentée). |

Hors périmètre : commandes vers le VPS, Supabase, la base de dev ou une base réelle ; DNS et
Caddyfile (préparés dans le runbook seulement) ; actions sur les comptes ; changement de
comportement de `server/` ou `web/` hors migration 005 et séquence ; rien n'est poussé.

## 3. Choix techniques de l'agent

| # | Choix | Raison |
|---|---|---|
| T1 | `admin/Testhand.Admin.slnx` ; `admin/src/Testhand.Admin` (Razor Pages, `net10.0`) ; `admin/tests/Testhand.Admin.Tests` (xunit, `Microsoft.AspNetCore.Mvc.Testing`) ; garde navigateur `admin/e2e/run.mjs`. | Un seul projet exécutable, un seul projet de tests ; le SDK 10.0.301 est installé. |
| T2 | Npgsql en SQL paramétré, sans ORM ; une requête = une liste explicite de colonnes. | Le point de la minimisation est de savoir exactement ce qui est lu ; un ORM lit « l'entité ». |
| T3 | Rôle PostgreSQL `testhand_backoffice` créé par 005 en `NOLOGIN`, privilèges **par colonne** (§4) ; `LOGIN` et mot de passe posés hors migration par `backoffice_db_login` (`deploy/lib.sh`, lu dans `.env.prod` : `BACKOFFICE_DB_PASSWORD`), rejoué par `deploy.sh` après la séquence. | Une migration versionnée ne porte aucun secret ; `initdb` sur volume neuf crée le rôle sans mot de passe, le déploiement le complète. |
| T4 | Journal `backoffice_audit` : `INSERT` et `SELECT` seuls pour le rôle ; déclencheur `backoffice_audit_append_only` qui refuse `UPDATE`, `DELETE` et `TRUNCATE` pour tout le monde, propriétaire compris. | « Ajout seul » tenu par la base, pas par le code ; le déclencheur couvre aussi la ligne de commande, qui écrit en tant que `ygo`. |
| T5 | scrypt implémenté en C# (`Rfc2898DeriveBytes.Pbkdf2` natif, Salsa20/8, BlockMix, ROMix), sans dépendance ; format `scrypt:N:r:p:sel:clé` lu tel quel ; comparaison en temps constant. Vecteurs 1 à 3 de la RFC 7914 (le 4e demande 1 Gio, non joué) et hachages produits par `server/src/auth/password.ts` (`admin/tests/.../fixtures/scrypt-node-vectors.json`, générés par `make-scrypt-vectors.mjs`). | Aucun paquet NuGet scrypt n'est à la fois maintenu, sans code natif et alignés sur ce format ; 150 lignes vérifiables valent mieux qu'une dépendance opaque. |
| T6 | TOTP RFC 6238 maison (HMAC-SHA1, pas de 30 s, 6 chiffres, fenêtre ± 1 pas, anti-rejeu par dernier pas accepté), vérifié contre les vecteurs de la RFC. Secret chiffré **AES-256-GCM** par `BACKOFFICE_TOTP_KEY` (32 octets en base64) avant stockage dans `backoffice_totp`. QR par **QRCoder** (MIT, C# pur) rendu en SVG dans la page, secret aussi affiché en base32. | Une sauvegarde ou un dump ne doit pas livrer le second facteur en clair ; la clé vit avec `POSTGRES_PASSWORD` dans `.env.prod`. Perte de la clé = ré-enrôlement des admins (documenté). |
| T7 | Session : jeton de 32 octets aléatoires, SHA-256 en base (`backoffice_sessions.token_hash`), cookie `th_backoffice` (HttpOnly, Secure hors DEV, SameSite=Strict, chemin `/`) ; `expires_at = created_at + 8 h`, jamais réécrite ; rôle relu à chaque requête par jointure `users.role = 'admin'` ; TOTP non validé = seules `/totp` et `/logout` répondent. | Décision 6 ; une session absolue n'a pas de « glissement » à tester, seulement une horloge (`TimeProvider` injecté, simulée en test). |
| T8 | Chaque page appelle explicitement `Audit.Record(...)` avant de rendre (pas de filtre implicite) ; `/health` (réponse `ok` sans détail) n'est pas une consultation. | Une ligne oubliée se voit dans le code de la page et dans le test qui compte les lignes. |
| T9 | Ligne de commande : `deploy/backoffice-role.sh grant|revoke|list <email> [--apply]` (bash, `lib.sh`, `db_exec psql`, donc `docker compose exec` sous le capot, ou `TESTHAND_DB_CONTAINER` en dev et en test) pilotant `deploy/backoffice-role.sql` par GUC de session comme 003 ; simulation par défaut (transaction annulée, rapport), `--apply` écrit **et** journalise dans la même transaction (`source = 'cli'`). | Le rôle web n'a **aucun** droit d'écriture sur `users` : l'attribution ne peut passer ni par le site ni par ses identifiants. Un sous-programme .NET aurait exigé les identifiants du propriétaire dans le conteneur du site, ce qui annule la garantie. |
| T10 | En-têtes posés par l'app : CSP stricte sans inline (`default-src 'self'`, `img-src 'self' data:`, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Permissions-Policy` restrictive (caméra, micro, position, paiement refusés), `Cache-Control: no-store` ; HSTS dans le bloc Caddy (qui termine TLS), rappelé dans le runbook. | Défense en profondeur : les en-têtes ne dépendent pas du proxy ; le CSP sans inline force le thème en fichier (T11). |
| T11 | Bascule de thème par `/js/theme.js` (fichier, avant le rendu), préférence dans `localStorage`, `data-theme` sur `<html>`, système par défaut ; tokens dans `wwwroot/css/tokens.css`. | Décision 10 sous CSP stricte. |
| T12 | Limite de débit sur `POST /login` : 10 tentatives par 5 minutes et par adresse (ASP.NET Core `RateLimiter`), 429 journalisé ; adresse réelle lue dans `X-Forwarded-For` seulement si `BACKOFFICE_TRUST_PROXY=1` ; scrypt factice sur email inconnu ou compte non admin (même coût, même réponse). | Même raisonnement que `server/src/auth/password.ts` (`verifyAgainstDummy`) et que `TRUST_PROXY` du serveur. |
| T13 | Tests d'intégration .NET sur conteneur jetable `testhand-backoffice-db`, **127.0.0.1:55442**, URL exacte exigée (`BACKOFFICE_TEST_DATABASE_URL`), base vide exigée ; l'app y est branchée **avec le rôle restreint**, le propriétaire `ygo` ne servant qu'aux fixtures ; garde navigateur sur `testhand-backoffice-e2e-db` **55443** et site **8795**. | Ports libres, hors de la liste d'AGENTS.md ; brancher l'app avec le rôle restreint fait des tests une preuve des privilèges, pas seulement du code. |
| T14 | Image `deploy/Dockerfile.admin` (`sdk:10.0-alpine` → `aspnet:10.0-alpine`, utilisateur non root, port 8080) ; service `admin` (`container_name: ygo-admin`, réseaux `default` + `edge`, sans `ports:`, `depends_on: db healthy`, healthcheck sur `/health`) ; variables `BACKOFFICE_DATABASE_URL`, `BACKOFFICE_TOTP_KEY`, `BACKOFFICE_ENV=PRODUCTION`, `BACKOFFICE_TRUST_PROXY=1`. | Décision 3 ; mêmes règles que `app`. |
| T15 | Séquence (`deploy/lib.sh`) : 005 rejouée dans les deux branches, avant 003 (règle de 004) ; `hook_stop_app` arrête aussi `admin` (sinon le journal bouge pendant la sauvegarde pré-migration vérifiée, mode `keep` = échec) ; contrôle « tables intactes » : quand 005 vient d'être appliquée, `users` change de forme (colonne ajoutée) — on exige alors effectif identique et tous les rôles à `user` ; `check-migration.sql` vérifie journal 005, colonne `users.role`, tables `backoffice_*`, existence du rôle et **absence de privilège** sur les tables de contenu ; `restore_into_scratch_db` et la restauration de `rehearsal.sh` pré-créent le rôle (`NOLOGIN`) dans un cluster neuf, parce que `pg_dump` émet les `GRANT`. | Sans la pré-création, toute archive prise après 005 serait irrestaurable dans un conteneur jetable (`role "testhand_backoffice" does not exist` sous `ON_ERROR_STOP`). |
| T16 | `restore.sh` arrête aussi `admin` avant la bascule de bases. | Une session admin ouverte pendant la restauration écrirait dans la base remplacée. |

## 4. Modèle (migration 005) et privilèges

`db/migrations/005-backoffice.sql`, additive, transactionnelle, rejeu sans effet, journalisée
`005-backoffice` :

- `users.role text not null default 'user'`, contrainte `users_role_check` (`user` | `admin`) ;
- `backoffice_totp (user_id pk → users, secret_enc bytea, confirmed_at, last_counter bigint, created_at)` :
  secret chiffré (T6), `confirmed_at` nul tant que l'enrôlement n'est pas prouvé par un code,
  `last_counter` = dernier pas accepté (anti-rejeu) ;
- `backoffice_sessions (token_hash bytea pk, user_id → users on delete cascade, created_at, expires_at, totp_verified_at, user_agent, ip)` ;
- `backoffice_audit (id identity pk, at, actor_user_id, actor_email, action, target_user_id, detail jsonb, source 'web' | 'cli')` +
  déclencheur `backoffice_audit_append_only` (T4) ;
- rôle `testhand_backoffice` (`NOLOGIN` ; T3) et ses privilèges, révoqués puis réaccordés à
  chaque rejeu :

| Table | Privilège du rôle `testhand_backoffice` | Ce qu'il ne voit pas |
|---|---|---|
| `users` | `SELECT (id, email, display_name, password_hash, created_at, role)` | — (aucune écriture : le rôle se change en ligne de commande) |
| `sessions` | `SELECT (user_id, created_at, expires_at, user_agent)` | `token_hash` |
| `user_identities` | `SELECT (provider, user_id, created_at)` | `provider_user_id` |
| `decks` | `SELECT (id, owner_id, created_at, updated_at)` | `name`, `notes`, `params`, `summary` |
| `catalog_version` | `SELECT` | — |
| `backoffice_sessions` | `SELECT, INSERT, UPDATE, DELETE` | — |
| `backoffice_totp` | `SELECT, INSERT, UPDATE` | — |
| `backoffice_audit` | `SELECT, INSERT` + `USAGE` sur sa séquence | `UPDATE`, `DELETE`, `TRUNCATE` (et le déclencheur les refuse à tous) |
| `deck_cards`, `deck_starters`, `deck_combo_pairs`, `deck_conditions`, `deck_flags`, `deck_matchups`, `deck_side_plans`, `deck_side_plan_cards`, `card_flags`, `nonengine_categories`, `nonengine_groups`, `card_categories`, `cards`, `app_migrations` | **aucun** | tout |

Réponse à l'exigence « rôle PostgreSQL dédié » : **oui, c'est tenable dans cette
architecture**, à trois conditions, toutes prises en charge dans ce lot : (a) le secret du rôle ne
peut pas être dans la migration → `LOGIN` et mot de passe posés par le déploiement (T3) ; (b)
`pg_dump` émet les `GRANT` vers le rôle → tout cluster neuf qui reçoit une archive pré-crée le rôle
(T15) ; (c) le back-office écrit dans le journal à chaque requête → il est arrêté pendant la
séquence et pendant une restauration (T15, T16). Les tests d'intégration branchent l'app avec ce
rôle et prouvent les refus (`permission denied`) sur `decks.name`, `deck_cards`, `users.role`
(écriture) et `backoffice_audit` (suppression).

## 5. Authentification et session (site)

1. `GET /login` (public) → formulaire email + mot de passe. `POST /login` : limite de débit (T12) ;
   lecture de `users (id, email, password_hash, role)` par email insensible à la casse ; scrypt
   réel si le compte existe **et** est admin **et** a un mot de passe, factice sinon ; échec =
   même message générique, journal `login.failure` avec la raison (`empty`, `unknown`, `not-admin`,
   `no-password`, `bad-password`) visible seulement dans le journal ; succès = session créée
   (`totp_verified_at` nul), journal `login.success`, redirection `/totp`.
2. `GET /totp` : si `backoffice_totp.confirmed_at` est nul → enrôlement (QR + base32, T6) ;
   `POST /totp` avec un code : vérification ± 1 pas, anti-rejeu ; premier code bon = enrôlement
   confirmé (`totp.enrol`), puis `totp.success` ; mauvais code = `totp.failure`. Succès →
   `totp_verified_at` posé, redirection `/`.
3. Toute page hors `/login`, `/totp`, `/logout`, `/health` : cookie → session non expirée →
   `users.role = 'admin'` relu → `totp_verified_at` non nul ; sinon session supprimée, cookie
   effacé, redirection `/login` (ou `/totp`). Un cookie `ygo_session` est ignoré (nom différent,
   table différente).
4. `POST /logout` : session supprimée, journal `logout`.

## 6. Journal (`backoffice_audit`)

Actions : `login.success`, `login.failure`, `login.throttled`, `totp.enrol`, `totp.success`,
`totp.failure`, `logout`, `session.expired`, `session.revoked` (rôle retiré constaté à la requête
suivante), `view.dashboard`, `view.accounts` (détail : recherche, tri, page), `view.account`
(cible), `view.audit` (détail : filtres), `role.grant`, `role.revoke` (source `cli`, acteur = le
compte d'exploitation nommé par `--actor`, sinon l'utilisateur système). `detail` porte aussi
l'adresse et l'agent utilisateur. Page `/audit` : filtres par action, acteur, cible, période ;
pagination côté serveur.

## 7. Découpage

| Partie | Contenu | Tag |
|---|---|---|
| A — socle | Migration 005 (modèle, rôle, privilèges, déclencheur) ; `backoffice-role.sh` + `.sql` ; `lib.sh` (séquence, `backoffice_db_login`, pré-création du rôle à la restauration, arrêt d'`admin`), `deploy.sh`, `restore.sh`, `check-migration.sql`, montages Compose et e2e, service `admin` du compose de production et `Dockerfile.admin` (T15 exige que la séquence arrête `admin`, donc le service existe dès A), `test-migration-sequence.sh` (cas 005 et ligne de commande), `test-backup-restore.sh` (archive portant les GRANT) ; solution .NET avec les primitives de sécurité pures (scrypt, TOTP, base32, chiffrement du secret, politique de session) et leurs tests unitaires ; documentation (ce fichier, DECISIONS, PLAN, AGENTS, server/AGENTS, architecture, README §10, runbook B0–B7). | `backoffice-a-ok` |
| B — site | Razor Pages (connexion, TOTP, tableau de bord, comptes, fiche, journal), accès base avec le rôle restreint, journalisation, en-têtes, thème et charte (`docs/design-backoffice.md`), tests d'intégration sur 55442, garde navigateur (55443 / 8795). Les deux parties ont été développées dans la même session ; le tag `backoffice-a-ok` est posé sur le commit du socle, `backoffice-ok` sur celui du site. | `backoffice-ok` |

## 8. Vérifications à chaque partie

- `dotnet build` et `dotnet test` (unitaires en A ; intégration en B avec `BACKOFFICE_TEST_DATABASE_URL`) ;
- `npm run typecheck`, `npm run build`, `node scripts/test-quiet.mjs` ;
- `TEST_DATABASE_URL=… npm run test:integration -w server` ; `bash deploy/test-migration-sequence.sh` ;
  `bash deploy/rehearsal.sh --fixture` ; `npm run e2e -w web` — en série ;
- B : garde navigateur `node admin/e2e/run.mjs` (connexion, TOTP, chaque page, bascule de thème,
  360 et 1440 px) ;
- au moins 4 mutations volontaires par partie, détectées, fichiers restaurés et vérifiés par
  empreinte ;
- relecture par un sous-agent à contexte neuf contre ce document avant chaque tag.

## 9. Questions ouvertes

- Q1 — Chiffrement du secret TOTP par une clé d'environnement (T6) : perte de la clé = ré-enrôlement.
  Alternative écartée pour l'instant : secret en clair (plus simple, mais un dump livre le second
  facteur).
- Q2 — « Dernière connexion » n'existe pas en base : la colonne affiche l'ouverture de la session
  **encore active** la plus récente, ou « — ». Une vraie date de dernière connexion demanderait une
  colonne `users.last_login_at` écrite par le serveur Node (hors périmètre : pas de changement de
  comportement dans `server/`).
- Q3 — Le journal grossit sans borne (une ligne par consultation). Rétention à décider avec le lot
  suivant ; rien n'est supprimé ici (ajout seul).
- Q4 — Contrôle « tables intactes » au déploiement qui applique 005 : `users` change de forme, le
  contrôle vérifie l'effectif et les rôles, pas le contenu des autres colonnes. Fenêtre acceptée
  (l'app est arrêtée pendant la séquence, seule la migration écrit) ; une empreinte de `users`
  restreinte aux colonnes d'avant la fermerait sans toucher au plan.
- Q6 — Les sessions du back-office expirées et jamais réutilisées restent en base (aucun balayage) ;
  elles sont refusées à la première requête et alors supprimées. Un balayage périodique viendra
  avec la rétention du journal (Q3).
- Q5 — `.env.prod` sans `BACKOFFICE_DB_PASSWORD` / `BACKOFFICE_TOTP_KEY` : Compose accepte la valeur
  vide (db et app vivent), le service `admin` ne peut pas se connecter (mot de passe vide) ou s'arrête
  au démarrage (clé absente), et `deploy.sh` avertit après la séquence. Choix : ne jamais bloquer le
  déploiement de l'app de jeu à cause du back-office.

## 10. Comptes rendus

### Compte rendu A — socle (16 septembre 2026, tag `backoffice-a-ok`)

**Livré.** `db/migrations/005-backoffice.sql` (colonne `users.role` + contrainte, tables
`backoffice_totp` / `backoffice_sessions` / `backoffice_audit`, déclencheur d'ajout seul, rôle
`testhand_backoffice` NOLOGIN à privilèges par colonne, révoqués puis réaccordés à chaque rejeu) ;
`deploy/backoffice-role.sh` + `deploy/backoffice-role.sql` (GUC `testhand.role_*`, simulation par
sous-transaction annulée, `--apply` écrit et journalise `role.grant` / `role.revoke` en source `cli`
dans la même transaction, `list`, refus nominatifs code 1) ; `deploy/lib.sh` (005 dans les deux
branches avant 003, `ensure_backoffice_role` appelée par `restore_into_scratch_db` et `rehearsal.sh`,
`backoffice_db_login`, `env_prod_value`, contrôle « tables intactes » avec `users` reformée :
effectif identique et tous les rôles `user` la première fois) ; `deploy/check-migration.sql`
(journal 005, colonne, tables, existence du rôle, absence de privilège sur les tables de contenu,
`decks.name` / `notes` / `params` / `summary` illisibles, `users` en lecture seule, `token_hash`
illisible, journal en ajout seul) ; `deploy.sh` (arrêt d'`app` et `admin`, mot de passe du rôle après
la séquence), `restore.sh`, montages `05-backoffice.sql` (dev et prod), `web/e2e/run.mjs` ;
`test-migration-sequence.sh` (journaux à cinq migrations, cas « F sans 005 » = état de la
production avant ce lot, rejeu strict après, cas J = ligne de commande et privilèges) ;
`admin/` : solution, projet web (Npgsql, QRCoder), projet de tests, `Security/` (scrypt RFC 7914
sans paquet, format Node, plafond 512 Mio, temps constant ; TOTP RFC 6238 ± 1 pas et anti-rejeu ;
base32 ; AES-256-GCM ; politique de session 8 h sans prolongation ; URI otpauth) et leurs 150 tests
(vecteurs RFC 7914 §8–§12 sauf le 4e à 1 Gio, 8 hachages Node par fixture générée, RFC 6238 et 4226,
RFC 4648, malformations) ; docs (ce fichier, DECISIONS, décisions compressées, PLAN, AGENTS,
server/AGENTS, architecture).

**Vérifications exécutées.** `dotnet build` et `dotnet test` (Release) : 150 / 150 ; scrypt
N = 2^17, r = 8 : 423 ms ; `bash deploy/test-migration-sequence.sh` : 86 / 86 gardes, cas A–J ;
`npm run typecheck`, `npm run build`, `node scripts/test-quiet.mjs` (254 web, 14 serveur) ;
`npm run test:integration -w server` sur 55433 (auth 12, persistence 14, purge 11) ;
`npm run e2e -w web` (10 scénarios OK, ports 5175 / 8791 : le 5174 était occupé par un autre
projet) ; `bash deploy/rehearsal.sh --fixture` : répétition conforme (restauration, séquence code 0
avec 005, recalcul 4 decks, 10 scénarios e2e, retour arrière avec empreinte initiale retrouvée).
`bash deploy/test-backup-restore.sh` : 57 / 57 gardes (archives portant les GRANT du rôle, restaurées dans le cluster neuf 55439 grâce à `ensure_backoffice_role`). Après les correctifs de relecture, rejoués : séquence 86 / 86, sauvegarde-restauration 57 / 57, `dotnet test` 168 / 168, garde navigateur 49 / 49, répétition sur le jeu représentatif.
Preuves manuelles sur 55442 : `count(*)` avec privilège de colonne accepté par PostgreSQL ;
`REVOKE ALL ON TABLE` retire bien les privilèges de colonne (rejeu défensif prouvé) ; `pg_dump`
émet 23 lignes `GRANT … TO testhand_backoffice` (d'où `ensure_backoffice_role`).

**Mutations (fichiers restaurés et vérifiés par SHA-256).** A1 005 sans déclencheur → KO de
`check-migration.sql` ; A2 005 accorde SELECT sur `deck_cards` → KO ; A3 `lib.sh` sans 005 dans la
branche post-003 → cas « F sans 005 » de `test-migration-sequence.sh` : 7 gardes en échec (« F sans 005 » et son rejeu), 79 autres vertes ; A4
`backoffice-role.sql` journalise en source `web` → test d'intégration de la ligne de commande ; A5
rotation Salsa20/8 altérée → 13 tests scrypt / hachages Node en échec ; A6 session de 9 h → tests
de politique et d'intégration.

**Relecture (sous-agent à contexte neuf).** Aucun bloquant ; sept points corrigés avant le tag :
variables `BACKOFFICE_*` du compose acceptant une valeur vide (l'avertissement de `deploy.sh`
devient atteignable, Q5) ; `test-backup-restore.sh` archive une source à 005 (la pré-création du
rôle dans le cluster neuf est réellement exercée) ; `restore.sh` tolère un service `admin` sans
conteneur ; mot de passe du rôle par l'entrée standard de psql et non en argument ; rejeu de 005
qui retire aussi attributs et appartenances larges du rôle, déclencheur `ENABLE ALWAYS` ; §7
redécrit (le compose, le Dockerfile et `deploy.sh` sont dans A) ; comptes rendus écrits avant le
tag. Remarque consignée en Q4 (fenêtre du contrôle `users`).

**Écarts au plan.** Aucun sur les décisions. La ligne de commande est bash + SQL et non un
sous-programme .NET (T9, raison consignée). Les suites d'intégration Node n'appliquent pas 005
(l'API ne la lit pas) ; la séquence, l'e2e et `initdb` l'appliquent.

### Compte rendu B — site (16 septembre 2026, tag `backoffice-ok`)

**Livré.** `admin/src/Testhand.Admin` : `Program.cs` (options d'environnement, Npgsql avec le rôle
restreint, limite de débit 10 / 5 min par adresse sur `POST /login`, en-têtes, garde), `Data/`
(session : jeton aléatoire, SHA-256, cookie `th_backoffice`, 8 h absolues, rôle relu ; journal ;
comptes, tableau de bord, journal, TOTP), `Web/` (garde privée par défaut, en-têtes T10, QR en
SVG sans style inline, formats), pages `/login`, `/totp`, `/`, `/comptes` (recherche, tri par liste
blanche, pagination `p`), `/comptes/:id` (nombre de decks, sessions actives), `/journal` (filtres
action / acteur / cible / période), `/logout` (POST), `/erreur`, `/health` ; `wwwroot` (tokens,
styles, `theme.js`) ; charte `docs/design-backoffice.md` ; `deploy/Dockerfile.admin`, service
`admin` (réseau `edge`, sans port, healthcheck `/health`), `.env.prod.example`, README §10, runbook
« première mise en ligne du back-office » B0–B7 ; `admin/e2e/run.mjs`.

**Vérifications exécutées.** `dotnet test` avec `BACKOFFICE_TEST_DATABASE_URL` sur 55442 :
168 / 168 (150 unitaires + 18 d'intégration : refus sans session, cookie `ygo_session` et jeton
forgé, compte `user` / admin sans mot de passe / mauvais mot de passe / inconnu (même réponse,
raison au journal), hachage Node accepté puis TOTP exigé, enrôlement confirmé au premier code
juste, une ligne de journal par consultation avec son détail, aucun marqueur de deck dans aucune
page et 16 requêtes refusées par PostgreSQL au rôle (`42501`) plus le déclencheur contre le
propriétaire, session coupée à 8 h sans glissement, rôle retiré = session coupée à la requête
suivante et connexion refusée ensuite, déconnexion, en-têtes, 429 à la 11e tentative journalisé,
ligne de commande simulation / application / retrait / inconnu, POST sans jeton antiforgery refusé, fiche inconnue journalisée puis 404, pagination bornée, /erreur hors garde) ; garde navigateur
`node admin/e2e/run.mjs` : 49 / 49 (1440 et 360 px, bandeau PRODUCTION au second démarrage,
captures dans `admin/e2e/out/`) ; essai manuel du site sur 55442 avec le rôle restreint (curl :
en-têtes, connexion, TOTP, cinq pages sans marqueur).

**Mutations (restaurées, SHA-256 vérifié).** B1 garde sans exigence du second facteur → suite
d'intégration en échec ; B2 rôle non relu → test « retrait du rôle » ; B3 le site lit
`decks.name` dans un sous-select → PostgreSQL refuse (`42501`), test « aucun contenu de deck » :
c'est la preuve que la garantie tient malgré un bug du site ; B4 fiche sans ligne de journal →
test « chaque consultation » ; B5 CSP retirée → test des en-têtes.

**Corrections en cours de route.** `page` est réservé par Razor Pages (pagination `p`) ;
`Email@SortMark` lu comme une adresse email par Razor ; le formulaire de déconnexion du gabarit
précède celui de la page (sélecteurs `.form`) ; Npgsql rend `timestamptz` en `DateTime` ; accents
HTML-encodés dans les assertions ; une instance d'app par test pour la limite de débit.

**Relecture (sous-agent à contexte neuf).** Aucun bloquant ; cinq points corrigés avant le tag :
analyse de l'URL de connexion à la main (un `/` de base64 dans le mot de passe cassait `Uri` ;
`.env.prod.example`, runbook et README recommandent désormais `openssl rand -hex 24`) ; `/erreur`
hors de la garde ; pagination bornée à 100 000 et filtres du journal bornés ; anti-rejeu TOTP
atomique (`update … where last_counter < pas`) ; LOGIN du rôle posé avant `up -d` dans
`hook_start_app`. Remarques prises : hachage factice calculé au démarrage, email borné dans le refus
429, `.dockerignore` pour `admin/**/bin` et `obj`, procédure de ré-enrôlement dans le runbook
(B6), charte alignée (`.mono`, « Déconnexion », dimensions de mise en page dans `site.css`), Q6
(sessions expirées jamais réutilisées), deux tests ajoutés (POST sans jeton antiforgery → 400 ;
fiche inconnue journalisée puis 404, pagination bornée, `/erreur`).

**Non fait / reporté.** Aucune action sur les comptes (lot suivant). Le healthcheck du service
`admin` suppose `wget` (BusyBox) dans `aspnet:10.0-alpine` : à confirmer au premier
`docker compose ps` en production (B6). Rien n'est poussé ; aucune commande vers le VPS.

