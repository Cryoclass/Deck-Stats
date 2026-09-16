# Audit 05 — Code : ce qui casse quand vous n'êtes plus seul devant l'app

- **Date** : 15 septembre 2026. Code audité : branche `wip/audit-materiaux` à `b79d320`. Le code est identique à la prod déclarée `4cf9493` (docs/PLAN.md:50) : `git diff --stat 4cf9493 b79d320` ne liste que des fichiers de `docs/`.
- **Prisme** : commercialisation en freemium (offre gratuite limitée + abonnement), donc des inconnus comme utilisateurs.
- **Nature** : constats sourcés (fichier:ligne, commande exécutée, mesure ou capture), classés par gravité. Les recommandations visent ce dépôt ; aucune n'a été appliquée.
- **Périmètre respecté** :
  - aucun fichier du projet modifié hors `docs/audit/` ; aucun commit ;
  - aucune commande vers le VPS, la base de prod, la base de dev ou Supabase ;
  - les tests, mutations, mesures de couverture et expériences tournent sur une **copie** du code (`git archive HEAD`) dans le scratchpad de session et sur des conteneurs jetables étiquetés `purpose=testhand-audit05` (§8).
- **Articulation avec les audits précédents** : les portes de l'audit 04 (permissions) et les constats de l'audit 03 (données, RGPD) ne sont pas redécrits. Ils figurent dans le classement du §0 avec leur identifiant. La porte O1 a été **revérifiée ici** sur l'image de production reconstruite.

Preuves brutes et scripts : [`preuves-05/`](preuves-05/).

---

## 0. Synthèse

### 0.1 Classement unique par gravité

« 05 » = constat de cet audit ; « 04 Ox » / « 03 Bx » = constat d'un audit précédent, résumé ici en une ligne.

| Rang | ID | Gravité | Domaine | Constat | Preuve principale |
|---|---|---|---|---|---|
| 1 | **C1** (05) | Critique | Sécurité · disponibilité | Une seule inscription avec un email piégé gèle **toute** l'API : 256 000 « @ » = 44 s de gel pour tous les clients ; 1 Mio ≈ 12 min (extrapolé) | `auth.ts:18, 64-67` ; `redos-probe-256k.json` |
| 2 | 04 O1 | Critique | Sécurité | Garde d'authentification contournée par `/%61pi/…` : le catalogue répond sans session. **Revérifié sur l'image de prod** | `index.ts:41-48` ; `headers-probe.txt` |
| 3 | **C2** (05) | Haute | Isolation | Dans un même onglet, après un 401, le compte suivant voit le deck du compte précédent : nom, cartes, annotations, statistiques | `EditorPage.tsx:92` ; capture `S3-B-apres-connexion.png` |
| 4 | **C3** (05) | Haute | Scalabilité | Effondrement à ≈ 75 req/s, soit ≈ 300 utilisateurs actifs selon le modèle d'usage du §3.3 : p50 de 23 s, 8 connexions sur 10 bloquées « idle in transaction » | `deckRepository.ts:36-62` ; `db.ts:12` ; `paced-results.jsonl` |
| 5 | **C4** (05) | Haute | Exploitation | Aucune alerte ni métrique. La healthcheck n'a aucun effet : un conteneur « unhealthy » tourne indéfiniment. Journaux sans rotation | `docker-compose.prod.yml:31-60` ; `healthcheck-unhealthy.txt` |
| 6 | **C5** (05) | Haute | Exploitation | Toutes les sauvegardes sont sur le même VPS. Copie hors VPS manuelle et facultative ; perte maximale de 24 h ; restauration de la base entière seulement | `backup.sh:39-44` ; `README.md:145` ; `restore.sh:96-109` |
| 7 | **C6** (05) | Haute | Qualité | Le chemin applicatif du calcul n'est gardé par aucun test : 9 mutants sur 55 survivent (paires désactivées, cartes « mortes » inversées, critère Redondance, mur de mains). Le code actuel, lui, est juste sur 2 000 decks aléatoires | `mutants-results.jsonl` ; `fuzz-builder-2000.json` |
| 8 | **C7** (05) | Haute | Qualité · sécurité | Garde, sessions, login, inscription et Discord n'ont **aucun** test automatique. Il n'existe aucune CI | `persistence.integration.ts:24-27` ; coverage serveur |
| 9 | 04 O2 · O3 | Haute | Sécurité · scalabilité | Configuration de taille non bornée, une instruction SQL par ligne ; un seul compte sature le pool de tous les autres | audit 04 §3 |
| 10 | 04 O6 | Haute | Sécurité · tiers | Relais d'images sans limite ni cache, joignable anonymement par O1 | audit 04 §3 |
| 11 | **C8** (05) | Moyenne | Exploitation | Processus fragile : arrêt sur redémarrage de PostgreSQL, SIGTERM ignoré (tué au bout du délai), aucun délai de requête ni SQL, travail poursuivi après abandon du client | `db.ts:12` ; `pg-redemarrage-arret-api.txt` ; `arret-conteneur-sigterm.txt` |
| 12 | **C9** (05) | Moyenne | Exploitation · scalabilité | La vérification des sauvegardes casse avec la croissance : `fingerprint.sql` échoue au-delà de 1 Go de texte par table (≈ 9 300 comptes au profil mesuré), ce qui bloque `deploy.sh`. Pendant ce temps, la coupure de déploiement croît avec la base | `fingerprint.sql:18-22` ; `fingerprint-limite-1go.txt` |
| 13 | **C10** (05) | Moyenne | Sécurité | Aucun en-tête de sécurité HTTP : ni CSP, ni anti-iframe, ni nosniff, ni Referrer-Policy. HSTS absent de la configuration Caddy documentée | `index.ts:26-33` ; `README.md:75-79` ; `headers-probe.txt` |
| 14 | **C11** (05) | Moyenne | Sécurité | Image : exécutée en root, avec npm, apk et wget, et les dépendances du front. Docker Scout : 3 critiques et 27 hautes. `deploy.sh` ne tire jamais d'image de base récente | `Dockerfile:15-28` ; `deploy.sh:50` ; `docker-scout-cves.txt` |
| 15 | **C12** (05) | Moyenne | Scalabilité | `GET /api/library` balaye les étiquettes de **tous** les comptes (index manquant). Cette requête part à chaque ouverture de deck | `schema.sql:149-153` ; `library.ts:39` ; `explain.out` [C] |
| 16 | **C13** (05) | Moyenne | Exploitation | Déploiement construit sur le VPS de prod depuis `main`, avec coupure. Retour arrière = `git checkout` + reconstruction (minutes), aucune image versionnée | `deploy.sh:26, 50` ; runbook C5 |
| 17 | **C14** (05) | Moyenne | Scalabilité (client) | Recalcul de 14 s à chaque modification pour un deck « tout annoté » de 28 types, sur un poste rapide. Tous les aperçus se recalculent en série après chaque déploiement qui touche le moteur | `engine-cost-realiste.jsonl` ; `HomePage.tsx:38-78` |
| 18 | **C15** (05) | Moyenne | Qualité (calcul) | `lib/statsViews.ts` alimente l'aperçu stocké mais est absent de l'empreinte `__ENGINE_VERSION__` : le modifier laisserait des chiffres périmés passer pour frais | `vite.config.ts:20` ; `summary.ts:2, 32` |
| 19 | 04 O4, O5, O7, O9, O10, O11, O12 | Moyenne | Sécurité · produit | Aucun quota ; UUID choisis par le client (oracle d'existence) ; moteur sans borne ; scrypt coûteux et anonyme ; erreurs internes renvoyées ; textes non bornés ; code d'invitation partagé | audit 04 §3 |
| 20 | 03 B5 | Moyenne | RGPD · exploitation | IP et URL journalisées à chaque requête, sans durée de conservation. Mesuré ici : 412 octets par requête | audit 03 §5.1 ; C4 |
| 21 | **C16** (05) | Faible | Sécurité | 4 vulnérabilités npm en production (fastify, fast-uri, exceljs/uuid), **non atteignables** par le code actuel. Elles le deviennent dès l'ajout de schémas JSON | `npm-audit-resume.txt` |
| 22 | **C17** (05) | Faible | Scalabilité | Recherche à 2 caractères : balayage complet du catalogue ; 7,5 cœurs PostgreSQL à 196 req/s. Jokers `%` et `_` non échappés | `cards.ts:33-41` ; `load-results.jsonl` |
| 23 | **C18** (05) | Faible | Isolation | Existence d'un compte révélée par l'inscription (409) et par Discord (`email_taken`) | `auth.ts:86-88` ; `discord.ts:201-209` |
| 24 | **C19** (05) | Faible | Isolation | Limites de débit par IP seulement : tous les joueurs d'une salle de tournoi partagent 10 connexions par minute | `auth.ts:56, 101` |
| 25 | **C20** (05) | Faible | Sécurité (poste) | Base de dev publiée sur toutes les interfaces avec `ygo/ygo` ; API de dev à l'écoute sur le réseau local | `docker-compose.yml:9-12` ; `index.ts:98` |
| 26 | **C21** (05) | Faible | Qualité | Dette qui ralentira : store de 819 lignes, ancienne représentation des prérequis gardée pour les tests, types d'API recopiés, versions majeures en retard, 1,7 % de couverture des composants | §5.4 |
| 27 | 04 O8, O13, O14, O15 ; 03 (sessions) | Faible | Divers | Chiffres stockés falsifiables ; pas de déconnexion globale ; requêtes « simples » acceptées ; validation client en retard ; sessions expirées jamais purgées | audits 03, 04 |

### 0.2 Seuils de charge mesurés

Conditions : image de production reconstruite, **un** processus Node, pool de 10 connexions, 1 000 comptes synthétiques, poste de 12 cœurs. Le modèle d'usage est une hypothèse (§3.3) : une requête toutes les 4 s par utilisateur actif, dont un enregistrement complet par minute.

| Utilisateurs actifs en même temps | Débit | Résultat mesuré |
|---|---|---|
| 100 | 25 req/s | Tient. p50 22–31 ms, p95 484–676 ms ; enregistrement d'un deck p95 0,96–2,5 s |
| 200 | 50 req/s | Dégradé mais stable. p95 796 ms ; enregistrement p50 1,1 s, p95 2,1 s ; Node à 103 % d'un cœur |
| 300 | 75 req/s | **Effondrement**. p50 23 s pour toutes les routes, 8 connexions sur 10 « idle in transaction » |
| 1 000 | 250 req/s | **Effondrement**. p50 109 s, p95 172 s |

**Condition de ce tableau.** La plupart des enregistrements y réécrivent un deck déjà enregistré, avec les mêmes identifiants de paires et d'adversaires : c'est le cas courant.

**Cas plus lourd.** Quand chaque enregistrement remplace entièrement un deck (après un import par exemple), l'app est déjà dégradée à 50 req/s : p50 1,4 s, p95 4,3 s.

**Avec une écriture en lot.** Le même cas lourd tient à 50 req/s (p50 24 ms) et reste dégradé sans s'effondrer à 75 req/s (C3, expérience).

Indépendamment du nombre d'utilisateurs, **un seul acteur** met aujourd'hui l'app hors service : C1, 04 O2, O3.

### 0.3 Ce qui tient déjà

- **Isolation serveur.** Chaque requête SQL est bornée au propriétaire ; une ressource d'autrui répond 404 (sonde P3 de l'audit 04 ; relecture fichier par fichier au §2).
- **Aucune injection SQL.** Tout est paramétré. Les seuls identifiants dynamiques sont des constantes : `decks.ts:17`, `deckRepository.ts:32`, `cards.ts:22-41`, et `adopt-legacy.ts:50, 97` pour un script. Les SQL émis par `prune-stale-cards` passent par une liste blanche (`prune-stale-cards.ts:104-115`).
- **Sessions.**
  - Jeton aléatoire de 32 octets, seul son SHA-256 est stocké (`session.ts:25-26, 46`).
  - Cookie `HttpOnly; Secure; SameSite=Lax` mesuré (`headers-probe.txt`).
  - Un `X-Forwarded-For` forgé ne passe pas Caddy 2.11.4 configuré comme la doc : 429 au 11ᵉ essai malgré 12 adresses forgées (`caddy-x-forwarded-for.txt`).
- **Pas de secret dans le dépôt ni dans l'image.**
  - Aucun `.env` jamais versionné (`git log --all --diff-filter=A`).
  - Aucun `.env` dans l'image (`image-docker-surface.txt`).
  - Seule clé présente : la clé *publishable* de Supabase, déjà traitée par l'audit 03.
- **Base non exposée en prod** : aucun `ports:` (`docker-compose.prod.yml:3-4`).
- **XSS.** React échappe tout, aucun `dangerouslySetInnerHTML` ni `innerHTML` (grep sur `web/src`).
- **Cœur du moteur remarquablement gardé.**
  - 96,8 % des lignes et 92,1 % des branches couvertes.
  - 36 mutants sur 40 tués ; les 4 survivants concernent la redondance et le mur de mains.
  - Oracles indépendants par énumération physique et Monte Carlo (`chronology.test.ts`).
- **Déconnexion explicite propre** : brouillons purgés, rechargement complet, « Précédent » n'affiche rien (`auth.tsx:70-82` ; `precedent-apres-deconnexion.json`).
- **Sauvegardes vérifiées chaque nuit par restauration.** `test-backup-restore.sh`, rejoué ici depuis la copie : 57 gardes vertes, 0 rouge (`test-backup-restore-extrait.txt`).

---

## 1. Constats détaillés (gravité décroissante)

### C1 — Une inscription gèle toute l'API (expression régulière quadratique) · critique

- **Mécanisme.**
  - `EMAIL_RE = /^\S+@\S+\.\S+$/` (`server/src/routes/auth.ts:18`) est testée sur l'email complet (`auth.ts:67`). Aucune borne de longueur ne la précède.
  - `\S` accepte aussi `@` : sur une chaîne faite de `@`, le moteur essaie toutes les coupes, soit un coût ∝ n².
  - Le corps de requête est limité au défaut de Fastify, 1 Mio (`index.ts:26-29`, aucun `bodyLimit`).
  - Node exécute la regex sur l'unique fil de la boucle d'événements : pendant ce temps, **aucune** autre requête n'est servie.
  - Seule condition : un code d'invitation valide, contrôlé juste avant (`auth.ts:64-66`). Ce code est partagé et réutilisable (04 O12) ; en inscription ouverte, il n'y en aura plus.
- **Preuves.**
  - Regex seule (`redos-email-regex-local.txt`) : 16 000 « @ » = 272 ms ; 64 000 = 10 s ; 128 000 = 37 s (croissance en n²).
  - Contre l'image de production (`redos-probe.mjs`) : un client sonde `/api/health` toutes les 100 ms pendant qu'un autre envoie **une** inscription.

    | Email | Code d'invitation | Réponse | Durée de l'inscription | Pire latence de `/api/health` pour l'autre client |
    |---|---|---|---|---|
    | 64 000 « @ » | valide | 400 « email invalide » | 2 751 ms | **2 684 ms** (74 ms avant) |
    | 256 000 « @ » | valide | 400 « email invalide » | 43 925 ms | **43 906 ms** (83 ms avant) |
    | 64 000 « @ » | invalide | 403 | 17 ms | 12 ms |

    À 1 Mio, (1 048 576 / 256 000)² × 44 s ≈ **12 min** de gel par requête. Ce chiffre est extrapolé, pas joué (§7).
- **Effet.**
  - Toute personne qui connaît le code gèle le service pour tous, clients payants compris.
  - La limite de 5 inscriptions par IP toutes les 10 min (`auth.ts:56`) laisse 5 gels de 12 min par fenêtre.
  - Rien ne le signale (C4).
- **Correctif.**
  1. Refuser `email.length > 254` **avant** la regex dans `auth.ts:67`.
  2. Poser `bodyLimit: 16_384` sur les routes de `authRoutes` et `discordRoutes`.
  3. Ajouter au test d'intégration de l'authentification (à créer, C7) : inscription avec 64 000 « @ » → 400 en moins de 50 ms.

### 04 O1 — Garde d'authentification contournée · critique (revérifiée)

Détail et correctif : audit 04 §3 O1.

**Revérification.** Sur l'image construite depuis `deploy/Dockerfile`, `GET /%61pi/cards/search?q=card&limit=100` sans cookie répond **200** avec 46 201 octets de cartes, alors que `/api/decks` répond 401 (`headers-probe.txt`).

### C2 — Fuite entre comptes dans un même onglet après un 401 · haute

- **Mécanisme.**
  1. Sur un 401 d'une route protégée, `api.ts:47-49` émet `ygo:unauthorized`. `auth.tsx:54-58` passe alors l'état à `anonymous`, **sans** vider le store Zustand ni les brouillons (le vidage n'existe que dans `logout`, `auth.tsx:70-82`).
  2. `App.tsx:41` rend la page de connexion **à la place** de la route : l'URL `/decks/<id du deck de A>` reste en place.
  3. B se connecte. `EditorPage` recharge le deck : `loadDeck` échoue en 404 et se contente de poser `persistenceError` (`deckStore.ts:419-421`). Le store garde `deckId`, les cartes, les annotations et le résultat de A.
  4. `EditorPage.tsx:92` affiche l'éditeur dès que `deckId === id`, ce qui est vrai.
  5. De plus, les brouillons IndexedDB sont indexés par deck, pas par compte (`draft.ts:16`) : ceux de A restent dans le navigateur.
- **Preuve (navigateur, `audit05-session-switch.mjs`).**
  - A se connecte et ouvre « Deck secret de A ». Ses sessions sont ensuite supprimées en base, ce qui équivaut à une expiration ou à une révocation.
  - A lance une recherche de carte : 401, la page de connexion s'affiche dans le même onglet.
  - B se connecte dans cet onglet. Résultats (`session-switch-resultats.json`) :
    - `/api/auth/me` = B ;
    - nom « Deck secret de A » affiché ;
    - **20 tuiles de cartes de A sur 20** visibles ;
    - `GET /api/decks/<deck de A>` avec la session de B → **404** ;
    - seul indice : un petit « Deck introuvable. » rouge dans l'en-tête.
  - Capture [`S3-B-apres-connexion.png`](preuves-05/S3-B-apres-connexion.png) : « Compte B » en haut à droite, grille, starters, probabilités et matrice du deck de A.
- **Effet.**
  - **Scénario réaliste en freemium** : un joueur oublie sa session sur le PC d'une boutique de tournoi, puis la coupe à distance. C'est justement la « déconnexion globale » recommandée par 04 O13, et la suspension admin H2 produirait la même chose. Le joueur suivant ouvre l'onglet resté ouvert, se connecte… et lit la stratégie du premier.
  - Le store mêle de plus le deck de A et la bibliothèque de B : `loadDeck` recharge la bibliothèque avant l'appel qui échoue (`deckStore.ts:398-401`). Tout recalcul déclenché par B produit des chiffres qui ne correspondent à aucun des deux comptes.
- **Correctif.**
  - Dans le gestionnaire `onUnauthorized` (`auth.tsx:55`), faire la même chose que `logout` : `clearAllDrafts()` puis `window.location.assign(window.location.pathname)`. Le rechargement vide le store ; l'URL est conservée pour le lien profond.
  - Dans `loadDeck` (`deckStore.ts:419-421`), en cas d'échec, réinitialiser `deckId`, `main`, `result` et `model`, pour que `EditorPage.tsx:92` ne puisse plus afficher un état antérieur.
  - Garde : scénario e2e « bascule de compte après 401 », calqué sur `audit05-session-switch.mjs`.

### C3 — Effondrement sous charge modérée · haute

- **Mécanisme.**
  - **Écriture ligne à ligne.** `PUT /api/decks/:id` écrit la configuration par `writeConfiguration` (`deckRepository.ts:29-66`), une instruction par ligne (boucles `:36-43`, `:49-65`). Pour un deck compétitif annoté, avec 5 adversaires, cela fait **170 allers-retours SQL dans une transaction** : `begin` et 3 lectures dont le verrou, 1 `update`, 6 `delete`, 10 paires, 45 cartes, 8 starters, 4 conditions, 1 drapeau, 90 écritures d'adversaires et de plans, `commit`.
  - **Connexion immobilisée.** Chaque aller-retour attend son tour dans la **seule** boucle d'événements Node. La connexion reste alors « idle in transaction » au pool, qui compte 10 connexions (`db.ts:12` ; `pg-pool/index.js:89`).
  - **Aucun frein.** Aucun délai (`statement_timeout`, `idle_in_transaction_session_timeout`, `requestTimeout`) ni aucun rejet sous pression ne limite la file (grep sur `server/src`).
- **Preuves.**
  - **Charge à débit imposé**, mélange de routes du §3.3 (`paced.mjs`, `paced-results.jsonl`) : voir §0.2. À 75 req/s, `pg_stat_activity` montre **8 connexions « idle in transaction » sur 10**, et toutes les routes passent à p50 ≈ 23 s, jusqu'à `/api/auth/me`.
  - **Boucle fermée** (`load-results.jsonl`) :
    - l'enregistrement plafonne à **37 écritures/s** (37,3 à 10 clients, 36,8 à 50) ;
    - à 50 clients, p50 = 1 339 ms ;
    - Node reste à ≈ 105 % d'un cœur.
  - **Après l'arrêt du générateur**, `/api/health` met encore **12,9 s** à répondre : le serveur traite les requêtes déjà abandonnées (C8).
- **Effet.**
  - Les pics prévisibles d'un produit de jeu (sortie d'un set, tournoi, campagne) suffisent à tout arrêter.
  - La dégradation n'est pas progressive : au-delà du coude, **toutes** les routes deviennent inutilisables, connexion comprise.
- **Correctif mesuré.** Voir « Expérience : écriture en lot » ci-dessous.
- **Correctifs complémentaires.**
  - `new pg.Pool({ connectionString, max: 20, statement_timeout: 10_000, idle_in_transaction_session_timeout: 15_000 })` dans `db.ts:12`, à dimensionner avec `max_connections` de PostgreSQL (100 par défaut).
  - `requestTimeout` et `connectionTimeout` dans `Fastify({...})` (`index.ts:26`).
  - Un rejet sous pression, 503 au-delà d'un délai de boucle d'événements, par exemple avec `@fastify/under-pressure` : mieux vaut refuser proprement que s'effondrer.

#### Expérience : écriture en lot (copie du code, jamais le dépôt)

**Variante testée** (`scripts/deckRepository.experience-ecriture-en-lot.ts`) :

- mêmes écritures que `writeConfiguration`, regroupées par table avec `insert … select … from unnest($2::bigint[], …)` ;
- les `upsert` des paires, adversaires et plans restent identiques ;
- lecture inchangée ;
- **22 instructions par enregistrement au lieu de 170** (17 au lieu de 165 dans `writeConfiguration` elle-même).

**Équivalence fonctionnelle.** `persistence.integration.ts` passe sur la variante : 14 / 14 (`ecriture-en-lot-persistence.txt`).

**Comparaison** (`ab-batch-results.jsonl`) :

- même image de base, même mélange de routes (`paced.mjs`) ;
- base restaurée depuis un instantané avant **chaque** palier. Chaque enregistrement remplace alors entièrement un deck synthétique : c'est le cas le plus lourd, par exemple juste après un import.

| Variante | Débit | p50 global | p95 global | Enregistrement p50 / p95 | Connexions « idle in transaction » | CPU Node |
|---|---|---|---|---|---|---|
| actuelle | 50 req/s | 1 440 ms | 4 274 ms | 3 121 / 6 109 ms | 7 | 104 % |
| **en lot** | 50 req/s | **24 ms** | **466 ms** | **108 / 996 ms** | 0 | 52 % |
| actuelle | 75 req/s | 25 601 ms | 31 856 ms | 26 712 / 33 033 ms | 9 | 107 % |
| **en lot** | 75 req/s | **1 391 ms** | **3 527 ms** | 1 494 / 3 884 ms | 5 | 106 % |
| en lot | 100 req/s | 16 959 ms | 18 724 ms | 17 360 / 19 009 ms | 6 | 103 % |
| en lot | 250 req/s | 55 005 ms | 97 084 ms | 51 689 / 96 942 ms | 8 | 121 % |

**Lecture.**

- L'écriture en lot divise la latence médiane par 60 à 50 req/s et décale l'effondrement d'un palier (de 75 à 100 req/s).
- Au-delà, le processus Node unique sature un cœur : pour 1 000 utilisateurs actifs, il faut **en plus** plusieurs processus (§3.6).
- **Correctif prioritaire** : l'écriture en lot dans `deckRepository.ts:29-66` et dans `mergeLibrary` (`decks.ts:63-78`, même motif), puis la multiplication des processus.

### C4 — Aucune supervision : une panne n'est vue que par les clients · haute

| Élément | État constaté | Preuve |
|---|---|---|
| Alertes, métriques, suivi d'erreurs (Sentry…), sonde externe | **Aucun** | grep `sentry\|prometheus\|grafana\|uptime\|alerte\|monitoring\|métrique` sur le code, `deploy/` et `docs/` : aucune occurrence pertinente |
| Healthcheck de l'app | Existe (`docker-compose.prod.yml:49-57`), mais **sans effet** : Docker ne redémarre pas un conteneur « unhealthy » | `healthcheck-unhealthy.txt` : `santé=unhealthy échecs_consécutifs=7 redémarrages=0` sous `restart: unless-stopped` |
| Gestionnaire d'erreurs | Aucun `setErrorHandler` : les erreurs partent au client (02, 04 O10) et ne sont pas classées | grep `server/src` |
| Journaux | Pino par défaut : deux lignes JSON par requête, IP et URL comprises, **412 octets par requête** ; pilote `json-file` **sans rotation** ; `AGENTS.md:60` affirme « L'app ne journalise pas les requêtes » | `index.ts:26-27` ; `docker inspect` : `LogConfig={"Type":"json-file","Config":{}}` ; 55 393 757 octets pour 134 284 requêtes |
| Échec de sauvegarde | Écrit dans `~/ygo-backup.log` ; personne n'est prévenu | `README.md:145` ; `backup.sh:74-76` |

- **Effet.**
  - À 25 req/s (les 100 utilisateurs actifs du §3.3) pendant 8 h par jour, les journaux croissent de ≈ 300 Mo par jour (412 octets mesurés par requête), sans limite, sur le disque du VPS. Un disque plein arrête PostgreSQL.
  - Une saturation (C3), un gel (C1) ou une sauvegarde non vérifiée durent jusqu'à ce qu'un client écrive.
- **Correctif.**
  1. Sonde externe sur `https://analysis.scratchrecode.com/api/health` avec alerte (mail ou Discord), exécutée **hors du VPS**.
  2. Dans `docker-compose.prod.yml`, pour `db` et `app` : `logging: { driver: json-file, options: { max-size: "20m", max-file: "5" } }`.
  3. Dans `backup.sh`, en cas de « NON vérifiée » (`:74-76`), pousser une alerte en plus du journal.
  4. Un `setErrorHandler` qui journalise l'erreur complète avec `reqId` et l'identifiant du compte, et renvoie un message générique.
  5. Remplacer la healthcheck passive par un redémarrage effectif. Docker ne le fait pas : il faut `autoheal`, ou un contrôle `curl` + `docker restart` en cron, qui alerte aussi.

### C5 — Sauvegardes sur le seul VPS, perte jusqu'à 24 h, restauration tout-ou-rien · haute

- **Mécanisme.**
  - **Emplacement.** `backup.sh` écrit dans `/var/backups/ygo-proba` **sur le VPS** (`backup.sh:39-44`), chaque nuit à 03:17 (`README.md:145`). Aucune copie automatique ailleurs : grep `rsync|rclone|restic|borg|s3` sur `deploy/` et la doc, sans résultat.
  - **Copie hors VPS.** Seulement par `scp` manuel, noté « pas obligatoire » pour un déploiement courant (`docs/deploy-runbook.md:254-255`).
  - **Restauration.** `restore.sh` remplace la **base entière** par renommage (`restore.sh:96-109`) : pas de restauration par compte.
  - **Journal WAL.** Aucun archivage, donc aucune reprise à un instant précis.
  - **Hébergement partagé.** Le VPS porte aussi goldfish, dont le Caddy sert Testhand (`README.md:15-24, 59-90`).
- **Preuves.** Lecture des fichiers cités. Le mécanisme lui-même est solide : `test-backup-restore.sh`, rejoué depuis la copie, passe **57 gardes, 0 échec** (`test-backup-restore-extrait.txt`).
- **Effet pour un produit payant.**
  - Une perte du VPS (disque, incident chez l'hébergeur, compte compromis) emporte base **et** sauvegardes.
  - Au mieux, le dernier export reste sur votre poste (audit 03 §5.1).
  - « J'ai supprimé mon deck par erreur » (suppression immédiate, `decks.ts:201-205`) n'a que deux issues : ramener tous les comptes à la veille, ou extraire à la main dans une base de travail.
- **Correctif.**
  1. À la fin de `backup.sh`, après « sauvegarde vérifiée », pousser l'archive et ses `.sha256` / `.fingerprint` vers un stockage objet d'un **autre** hébergeur (`rclone copy` ou `restic`), chiffrée côté client ; alerte si l'envoi échoue.
  2. Un script `deploy/extract-deck.sh <archive> <deck_id>` : restauration dans `ygo_restore` (fonction existante `restore_into_scratch_db`, `lib.sh:135-151`), puis export JSON v2 du deck. Il répond au support sans ramener les autres comptes en arrière.
  3. Si la perte de 24 h n'est pas acceptable pour l'offre payante, ajouter l'archivage WAL (par exemple `wal-g` vers le même stockage objet).

### C6 — Erreur de calcul silencieuse possible à la prochaine modification · haute

- **Contexte.**
  - Le cœur du moteur est très bien protégé (§5.2).
  - En revanche, les oracles comparent le moteur à un **adaptateur de test** : `toEngineInput`, « Test-side adapter … Not the application's builder » (`reference/deckOracle.ts:158`). Ils ne passent jamais par `buildEngineModel`, le seul chemin de l'application.
  - Aucun test ne vérifie non plus les sélecteurs qui placent les chiffres à l'écran (`store/selectors.ts` : 0 % de couverture, `coverage-web-resume.txt`).
- **Preuve : 55 mutations plausibles**, injectées une à une dans la copie, suite web complète après chacune (`mutants-results.jsonl`). **9 survivent** : les 254 tests restent verts.

  | Mutant | Erreur simulée | Où | Ce que verrait un client |
  |---|---|---|---|
  | B1 | paire désactivée encore comptée | `lib/engineModel.ts:52` | départs gonflés malgré « désactiver » |
  | B2 | « morte en premier » et « morte en second » inversées | `lib/engineModel.ts:108` | chiffres premier / second faux |
  | E9 | seaux fusionnés sans la redondance | `engine/enumerate.ts:157` | critère « Redondance » faux |
  | Q3 | critère « Redondance » lit les départs | `engine/query.ts:63` | idem ; option exposée (`QueryMode.tsx:208`) |
  | SV1 | vue « étiquette » du panneau = non-engine global | `lib/statsViews.ts:72` | distribution d'une étiquette fausse |
  | S1 | delta affiché sur la tuile d'une autre carte | `store/selectors.ts:30` | « Δ P(≥1 start) » attribué à la mauvaise carte |
  | S2 | mains de 6 notées avec la passe premier | `store/selectors.ts:63` | notes /10 du mur fausses en second |
  | H4 | curseur « importance non-engine » ignoré | `engine/hand.ts:22` | notes /10 insensibles au réglage |
  | H2 | mélange biaisé (Fisher–Yates cassé) | `engine/hand.ts:68` | mur de mains non représentatif |

  Par lecture des assertions, aucun scénario e2e ne porte sur ces effets chiffrés : ils mesurent tailles, opacités et « écran = Excel » (`web/e2e/scenarios/guards.mjs:52-108`, `compare.mjs:33-73`). Les mutants n'ont pas été rejoués contre l'e2e (§7).
- **Le code actuel est juste.**
  - Test différentiel aléatoire (`audit05-fuzz-builder.ts`) : état de l'éditeur → `buildEngineModel` → moteur, comparé à l'énumération physique de l'oracle.
  - Périmètre : 2 000 decks de 7 à 11 cartes avec starters, HOPT, paires (dont désactivées), conditions ET/OU, cartes mortes, profils, étiquettes avec ou sans profil, plafond ; distributions, requêtes par étiquette et deltas.
  - Résultat : **160 761 vérifications, 0 divergence** (`fuzz-builder-2000.json`).
  - Pouvoir de détection : réinjectés, B1 donne 235 divergences, B2 524, V1 268, V14 17 et LC1 408 (`fuzz-sanity.txt`). E9 n'est pas vu : le test n'interroge pas le critère Redondance.
- **Effet.** Aucune CI (C7) ; `npm test` n'est lancé qu'à la main. Une refonte du store, du panneau ou du constructeur peut afficher des probabilités fausses à des clients payants sans qu'aucun garde-fou ne réagisse. C'est le scénario que vous jugez le pire.
- **Correctif.**
  1. Verser le test différentiel dans le dépôt (`web/src/engine/reference/builder.fuzz.test.ts`), à graine fixe. Ajouter au générateur un critère « Redondance » pour couvrir E9 et Q3. 300 decks suffisent à tuer B1, B2, V1, V14 et LC1, soit ≈ 30 s (estimé d'après les 178 s mesurées pour 2 000 decks).
  2. Extraire le calcul de `selectDeltas` et `noteHandsFromStore` en fonctions pures prenant `(model, result)` et les tester : cela tue S1 et S2. Ajouter la vue « étiquette » à `dataIdentity.test.ts` (SV1).
  3. Tester `buildScorer` avec deux importances différentes (H4), et `drawHands` par un test du χ² à graine fixe sur un petit deck (H2).

### C7 — L'authentification n'a aucun test ; il n'existe aucune CI · haute

- **Preuves.**
  - `server/tests/persistence.integration.ts:24-27` monte `decksRoutes` et `libraryRoutes` sur un Fastify nu et **injecte** `req.user` par un hook. `index.ts` (la garde), `auth.ts`, `discord.ts`, `session.ts` (hors `requireUser`), `password.ts` et `account.ts` ne sont chargés par **aucun** test.
  - Couverture Node :
    - unitaires, 14 tests (`coverage-serveur-unitaires.txt`) : seuls `domain/*` et `cards.ts` apparaissent ;
    - persistance, 14 tests (`coverage-serveur-integration-persistence.txt`) : `decks.ts` 97,1 %, `library.ts` 96,6 %, `deckRepository.ts` 100 %, `session.ts` 46,9 % ; les autres fichiers d'authentification sont absents.
  - L'e2e n'utilise l'authentification que sur le chemin nominal : une inscription, puis des connexions (`web/e2e/run.mjs:152` ; `lib.mjs:40-44`).
  - Aucun fichier de CI suivi (`git ls-files` : ni `.github/`, ni `gitlab-ci`) ; seul hook : `commitlint` (`.husky/commit-msg:1`).
- **Effet.** C'est exactement ainsi que O1 (`/%61pi`) et C1 sont passés. Pour un produit payant, toute modification de la garde, du cookie ou de l'inscription peut ouvrir l'API sans qu'un test ne rougisse.
- **Correctif.**
  1. Suite `server/tests/auth.integration.ts` qui monte **l'app réelle** et joue au moins :
     - 401 sans cookie ;
     - `/%61pi/cards/search` → 401 ;
     - cookie `HttpOnly; Secure; SameSite=Lax` ;
     - session expirée → 401 et cookie effacé ;
     - 429 au 11ᵉ login ;
     - code d'invitation refusé ;
     - email de 64 000 « @ » → 400 rapide ;
     - déliaison Discord refusée sans mot de passe.
     Il faut pour cela exporter une fabrique `buildApp()` depuis `index.ts` : aujourd'hui `listen` est appelé au chargement (`index.ts:97-103`).
  2. CI minimale (GitHub Actions, dépôt `Cryoclass/Deck-Stats`) : `npm ci`, `npm run typecheck`, `node scripts/test-quiet.mjs`, puis la suite d'intégration sur un service `postgres:17-alpine`, et `npm audit --omit=dev --audit-level=high`. Protéger `main`, puisque `deploy.sh:26` déploie `main`.

### C8 — Processus fragile : arrêt sur redémarrage de PostgreSQL, SIGTERM ignoré, aucun délai · moyenne

| Défaut | Mécanisme | Preuve |
|---|---|---|
| Arrêt du processus si PostgreSQL redémarre | `new pg.Pool(...)` sans `pool.on('error')` (`db.ts:12` ; grep `on('error'` : aucun). Une connexion inactive qui reçoit « terminating connection » fait émettre `'error'` au pool (`pg-pool/index.js:56-62`), sans auditeur | `pg-redemarrage-arret-api.txt` : `Unhandled 'error' event … terminating connection due to administrator command`, puis `PROCESSUS TERMINÉ code=1` |
| Arrêt non gracieux | Node est le PID 1 du conteneur (`Dockerfile:28`) et n'installe aucun gestionnaire SIGTERM (grep `SIGTERM` : aucun) | `arret-conteneur-sigterm.txt` : `docker stop -t 10` = 12 293 ms, `ExitCode=137` (tué par SIGKILL) |
| Aucun délai, aucune annulation | ni `requestTimeout`, ni `statement_timeout`, ni `idle_in_transaction_session_timeout` (grep) ; un gestionnaire poursuit après abandon du client | C3 : 12,9 s de file après l'arrêt du générateur ; audit 04 P7a : transaction de 10 min poursuivie après abandon |

- **Effet.**
  - Le redémarrage de `db` survient notamment quand un montage change dans le compose de prod, ce qui recrée le conteneur `db` (AGENTS.md, Pièges ; runbook, note C3), ou lors d'une mise à jour ou d'un arrêt de PostgreSQL. Il fait tomber l'app ; `restart: unless-stopped` la relance, mais les requêtes en cours sont perdues.
  - Chaque `dc stop app` d'un déploiement (`deploy.sh:58`) ajoute ≈ 10 s de coupure et coupe net les requêtes en vol.
- **Correctif.**
  1. `pool.on('error', (err) => app.log.error({ err }, 'pg idle client'))` dans `db.ts`.
  2. Dans `index.ts`, `process.on('SIGTERM', () => app.close().then(() => pool.end()).finally(() => process.exit(0)))`, ou `init: true` sur le service `app` du compose (tini).
  3. Les délais de C3.

### C9 — L'outillage de sauvegarde casse avec la croissance · moyenne

- **Mécanisme.**
  - `fingerprint.sql:18-22` calcule, pour chaque table, `md5(string_agg(x::text, E'\n' order by x::text))` : **toute** la table devient une seule valeur texte, or PostgreSQL plafonne une valeur à 1 Go.
  - `backup.sh` calcule cette empreinte sur la base vivante avant l'export, puis sur `ygo_verify` (`backup.sh:53-54, 70` ; `lib.sh:158-182`).
  - En déploiement, la sauvegarde pré-migration est **obligatoire** et se fait **app arrêtée** (`lib.sh:360-374`). Une empreinte impossible bloque la séquence (`backup.sh:64-68`, `lib.sh:368-370`).
  - `restore.sh` refuse une archive sans `.fingerprint`, sauf `--without-fingerprint` (`lib.sh:192-194`).
- **Preuves.**
  - Même forme de requête sur une table de 1,10 Go de texte : `ERROR: out of memory — Cannot enlarge string buffer containing 1073740926 bytes` (`fingerprint-limite-1go.txt`).
  - Jeu synthétique de 1 000 comptes (20 decks, 5 adversaires chacun) : `deck_side_plan_cards` pèse déjà **115 Mo** de texte, `deck_cards` 49 Mo. La limite est atteinte vers **9 300 comptes** pour la première, ≈ 22 000 pour la seconde, à profil égal.
  - Au même volume (base de 506 Mo), les étapes de `backup.sh` prennent ≈ **77 s** (`sauvegarde-duree-1000-comptes.txt`), que la coupure de chaque déploiement subit.
- **Effet.**
  - Au-delà du seuil : chaque nuit « sauvegarde NON vérifiée », `deploy.sh` en échec avant toute migration, et restauration seulement en forçant.
  - On ne peut alors plus déployer, **correctifs de sécurité compris**, précisément quand le produit a du succès.
  - Avant le seuil, la coupure croît linéairement avec la base.
- **Correctif.**
  - Dans `fingerprint.sql`, remplacer l'agrégat texte par un agrégat de hachés de lignes, qui reste borné : `select count(*), md5(string_agg(md5(x::text), '' order by md5(x::text)))`. Il plafonne encore vers ≈ 32 millions de lignes par table ; au-delà, hacher par tranches de clé primaire.
  - Ce changement modifie toutes les empreintes. Versionner le format (première ligne `format|2` du fichier) pour que `restore.sh` recalcule selon le format de l'archive, sinon les archives existantes seraient refusées (`restore.sh:60-66`).
  - Faire la sauvegarde pré-migration **app en marche** quand aucune migration destructive n'est au programme (cas « déploiement courant » C0–C6), la base étant alors cohérente par transaction.

### C10 — Aucun en-tête de sécurité HTTP · moyenne

- **Preuve (`headers-probe.txt`).**
  - `GET /`, un fichier `/assets/*.js`, `/api/health` et `/api/decks` ne renvoient que des en-têtes de contenu, de CORS et de cache.
  - Aucun `Content-Security-Policy`, `X-Frame-Options` / `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` ni `Strict-Transport-Security`.
  - À travers Caddy 2.11.4 configuré selon `README.md:75-79`, rejoué en HTTP local, s'ajoutent seulement `Via` et `X-Robots-Tag`.
  - Pas de `<meta http-equiv>` de CSP dans `web/index.html:1-12`.
- **Effet.**
  - La page peut être intégrée en iframe par un site tiers : détournement de clic sur « Supprimer » ou « Délier Discord ».
  - Le référent de l'app part au CDN d'images (audit 03 §1.3).
  - Si un XSS apparaît un jour (noms de decks partagés, axe X2 de l'audit 04), aucune seconde barrière n'existe.
  - HTTPS non forcé côté navigateur : HSTS n'a pas été vérifié en prod (§7).
- **Correctif.** Dans le bloc Caddy du Caddyfile goldfish :

  ```
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    Content-Security-Policy "default-src 'self'; img-src 'self' data: blob: https://images.ygoprodeck.com; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  }
  ```

  À valider par `npm run e2e -w web` : le worker du moteur, le PDF (`jspdf` et `html2canvas` chargés dynamiquement) et les styles en ligne de React doivent passer. Retirer l'hôte du CDN de `img-src` une fois l'alternative A1 de l'audit 03 en place.

### C11 — Surface de l'image et fraîcheur des correctifs · moyenne

- **Preuves.**
  - **Contenu de l'image** (`image-docker-surface.txt`, image construite depuis `deploy/Dockerfile`) :
    - `id` → `uid=0(root)` : aucune directive `USER` (`Dockerfile:15-28`) ;
    - `npm`, `npx`, `apk` et `wget` présents ;
    - `/app/node_modules` pèse 153 Mo, **dépendances du front comprises** (`exceljs`, `jspdf`, `react`, `recharts`…), parce que `npm prune --omit=dev` garde les dépendances de production des deux espaces de travail (`Dockerfile:13, 18`).
  - **Docker Scout** (`docker-scout-cves.txt`) :
    - critiques : 2 dans OpenSSL (paquet Alpine 3.5.7-r0), 1 dans le `tar` embarqué par npm ;
    - hautes : 7 OpenSSL, 10 dans les modules internes de npm, 10 dans `fast-uri` (dépendance de l'app, voir C16).
  - **Fraîcheur des correctifs.**
    - `deploy.sh:50` fait `dc build` sans `--pull` : l'image `node:22-alpine` en cache sur le VPS n'est jamais rafraîchie.
    - `postgres:17-alpine` n'est jamais tiré, malgré le commentaire « correctifs mineurs au prochain pull » (`docker-compose.prod.yml:12`), puisque aucune commande ne tire.
  - **Durcissement.** Aucun `read_only`, `cap_drop`, `no-new-privileges` ni limite de mémoire ou de CPU dans `docker-compose.prod.yml` (grep).
- **Effet.** Une faille dans une dépendance donne un shell root outillé (npm, apk, wget) dans un conteneur relié au réseau `edge` partagé avec goldfish.
- **Correctif.**
  - **Étage final** : `FROM node:22-alpine` épinglé par empreinte, `npm prune --omit=dev -w server` puis copie des seuls `node_modules` utiles, `RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npx`, `USER node`.
  - **Déploiement** : `dc build --pull` et `dc pull db` dans `deploy.sh`, avant le `build` actuel.
  - **Compose** : `read_only: true`, `tmpfs: [/tmp]`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `mem_limit` sur `app`.
  - **Suivi** : `docker scout cves` en CI (C7).

### C12 — `GET /api/library` balaye les étiquettes de tous les comptes · moyenne

- **Mécanisme.**
  - `card_categories` a pour clé `(card_id, category_id)` et **aucun index sur `category_id`** (`schema.sql:149-153`).
  - La lecture de la bibliothèque joint par `category_id` (`library.ts:39`) ; la suppression d'une étiquette cascade par la même colonne.
  - Cette lecture part à chaque montage de l'app (`App.tsx:18-20`), à **chaque ouverture de deck** (`deckStore.ts:398`), à l'accueil (`HomePage.tsx:48`), au comparateur et à la fiche.
- **Preuve** (`explain.out`, 1 000 comptes) :
  - [C] `Seq Scan on card_categories … rows=40000`, 27,2 ms pour renvoyer 40 lignes ;
  - [F] cascade `card_categories_category_id_fkey` : 5,2 ms.
  - La latence croît avec le nombre **total** de comptes : ≈ 10 fois plus à 10 000 comptes, à profil égal (extrapolé).
- **Correctif.** `create index if not exists card_categories_category on card_categories (category_id);`, dans une migration additive `005`, montée et rejouée selon la règle d'AGENTS.md (Pièges).

### C13 — Déploiement : construction en prod, coupure, retour arrière lent · moyenne

- **Mécanisme.**
  - `deploy.sh:26` fait `git pull --ff-only` de `main` **sur le VPS**, puis `dc build` (`:50`) : Vite et `tsc` tournent sur la machine qui sert les clients.
  - La séquence arrête l'app pendant la sauvegarde pré-migration et les contrôles (`lib.sh:360-436`) : coupure de ≈ 21 s au dernier déploiement (docs/PLAN.md:50), qui croît avec la base (C9), plus ≈ 10 s d'arrêt forcé (C8).
  - Retour arrière du code : `git checkout <commit>` puis `build` et `up` (`docs/deploy-runbook.md:219-235`), soit une reconstruction complète. L'image n'est pas étiquetée par commit (`container_name: ygo-app`, image implicite de Compose, `docker-compose.prod.yml:32-35`).
- **Effet.**
  - Chaque mise en production coupe les clients.
  - Un retour arrière urgent prend le temps d'une construction sur un VPS chargé.
  - Ce qui est déployé est ce qui se trouve sur `main` à l'instant du `pull`, sans CI pour le vérifier (C7).
- **Correctif.**
  - Construire l'image en CI, étiquetée par commit (`ghcr.io/…/testhand:<sha>`), et la vérifier (tests, Scout).
  - `deploy.sh` fait alors `image: …:${TAG}` + `dc pull app` ; le retour arrière devient `TAG=<sha précédent> dc up -d app`, en quelques secondes.
  - Ne garder la séquence « app arrêtée » que si une migration est annoncée.

### C14 — Coût du calcul chez le client · moyenne

Complète l'audit 04 O7 (bornes extrêmes).

- **Preuves.**
  - **Decks annotés réalistes**, moteur du dépôt sous Node 22 (`engine-cost-realiste.jsonl`) :

    | Deck | Types suivis | `computeAll` (éditeur) | Deux passes (comparateur) | Passe premier (accueil) |
    |---|---|---|---|---|
    | 40 cartes, 6 starters, 6 pièces, 8 paires, 6 handtraps profilés, plafond, 4 conditions | 18 | 860 ms | 584 ms | 57 ms |
    | 40 cartes « tout annoter » : 12 starters et 10 pièces à 1 copie, 12 paires, 6 handtraps | 28 | **14 161 ms** | 7 539 ms | 718 ms |
    | 60 cartes : 8 starters, 8 pièces, 12 paires, 8 handtraps | 24 | **11 767 ms** | 5 313 ms | 505 ms |

  - **Fréquence.** L'éditeur relance le calcul à chaque mutation du main ou d'une annotation, avec debounce et annulation (docs/architecture.md:7-8).
  - **Accueil.** Il recalcule **en série** tout aperçu absent ou d'une autre version (`HomePage.tsx:38-78`). Toute modification de `engine/*.ts`, `engineModel.ts`, `conditions.ts` ou `summary.ts` change `__ENGINE_VERSION__` (`vite.config.ts:14-29`), donc **chaque** déploiement du moteur relance tous les aperçus de tous les comptes, deck par deck, avec 2 requêtes par deck.
  - **Fiche.** « Tout calculer » enchaîne jusqu'à 14 plans, deux passes pour un plan second (`sidePlan.ts:83-87`) : ≈ 53 s pour 7 plans seconds du deck à 28 types.
- **Effet.**
  - Aucun coût serveur.
  - Sur un téléphone, plusieurs fois plus lent qu'un poste de 12 cœurs (non mesuré, §7), un deck très annoté met plus d'une minute à chaque clic.
  - L'utilisateur gratuit sur mobile vit le produit comme « Recalcul… » permanent.
- **Correctif.**
  - Estimer le nombre de compositions avant de lancer le worker (produit des bornes de `enumerate.ts:37`) et proposer « calculer premier seulement » au-delà d'un seuil ; les deltas coûtent n + 1 énumérations par contexte (`enumerate.ts:238-251`).
  - Calculer les deltas à la demande (survol de la tuile) plutôt qu'à chaque recalcul.
  - Paralléliser les aperçus de l'accueil sur `navigator.hardwareConcurrency - 1` workers.

### C15 — Invalidation des aperçus incomplète · moyenne

- **Mécanisme.**
  - `__ENGINE_VERSION__` hache `engine/*.ts`, `lib/engineModel.ts`, `lib/conditions.ts` et `lib/summary.ts` (`vite.config.ts:17-20`).
  - Or `summary.ts:2, 32` calcule `startRateFirst` avec `cumulativeOf` de `lib/statsViews.ts`, **absent** de la liste.
  - La liste est tenue à la main : aucun test ne vérifie qu'elle couvre le graphe d'imports de `summary.ts`.
- **Effet.** Une correction ou une régression de `cumulativeOf` ne périmerait aucun aperçu stocké : l'accueil afficherait des chiffres d'une autre définition comme frais. C'est exactement ce que l'étape 9A voulait interdire (`summary.ts:4-10`).
- **Correctif.** Calculer la liste dans `vite.config.ts` à partir des imports réels : parcours récursif des `import … from './…'` depuis `lib/summary.ts` et `lib/engineModel.ts`. Ou, au minimum, ajouter `lib/statsViews.ts` et un test qui échoue si un fichier importé par `summary.ts` manque à la liste.

### C16 — Dépendances vulnérables, non atteignables aujourd'hui · faible

- **Preuves** (`npm-audit-resume.txt`, `npm audit` et `npm audit --omit=dev`).
  - **Production** : 4 vulnérabilités.
    - `fastify` 5.10.0 : contournement de validation de schéma, et falsification de `X-Forwarded-*` en mode compte de sauts.
    - `fast-uri` 3.1.4 et 4.1.1 : confusion d'hôte, SSRF.
    - `exceljs` → `uuid` 8.3.2 : dépassement de tampon en v3/v5/v6.
  - **Avec les outils de dev** : 12, dont `vitest` (critique : serveur UI), `vite` et `esbuild` (serveur de dev).
- **Atteignabilité.**
  - Aucune route ne déclare de schéma (grep `schema` sur `server/src` : 0). Or `fast-uri` n'est chargé que par `@fastify/ajv-compiler` et `fast-json-stringify` (`npm ls fast-uri`).
  - `trustProxy` vaut `true`, pas un compte de sauts (`index.ts:28`).
  - `uuid` n'est utilisé que par ExcelJS, dans le navigateur.
- **Effet.** Nul aujourd'hui. L'audit 04 recommande des schémas et des `bodyLimit` par route : `fast-uri` et le contournement Fastify deviennent alors pertinents.
- **Correctif.** Monter `fastify` à ≥ 5.12.1 et `fast-uri` aux versions corrigées **avant** d'ajouter des schémas ; passer `vitest` à une version corrigée. Gate `npm audit --omit=dev --audit-level=high` en CI (C7).

### C17 — Recherche du catalogue à deux caractères · faible

- **Mécanisme.**
  - `cards.ts:36-41` filtre par `lower(name) like '%' || lower($1) || '%'` dès 2 caractères.
  - L'index trigramme (`schema.sql:22`) n'est utilisable qu'à partir de 3 caractères.
  - `%` et `_` saisis ne sont pas échappés : `q=%%` renvoie n'importe quelle carte.
- **Preuves.**
  - `explain.out` [G] : `Seq Scan on cards`, 40 ms. [H], 5 caractères : index trigramme, 20 ms.
  - Charge : 196 req/s à 2 caractères font monter PostgreSQL à **755 %** de CPU ; 184 req/s à 5 caractères, à 334 % (`load-results.jsonl`).
- **Correctif.**
  - Minimum de 3 caractères côté serveur (`cards.ts:35`) et côté client, ou recherche par préfixe `lower(name) like $1 || '%'` à 2 caractères.
  - Échapper `%`, `_` et `\` avec `like … escape '\'`.

### C18 — Existence d'un compte révélée · faible

- **Mécanisme.**
  - La connexion est protégée contre l'énumération (`auth.ts:97-117`), mais l'inscription répond 409 « un compte existe déjà avec cet email » (`auth.ts:86-88`).
  - Le retour Discord distingue `email_taken` et `discord_taken` (`discord.ts:159-161, 201-209`).
- **Effet.** Faible derrière un code d'invitation. En inscription ouverte, n'importe qui teste si une adresse est cliente : c'est une donnée personnelle.
- **Correctif.** Avec la vérification d'email (audit 03 P1), répondre toujours « si l'adresse est libre, un lien vous a été envoyé ».

### C19 — Limites de débit partagées derrière une même adresse · faible

- **Mécanisme.** Les limites portent sur l'IP seule (`auth.ts:56, 101` ; `discord.ts:86`) et sont gardées en mémoire du processus (`index.ts:33`).
- **Effet.**
  - Dans une salle de tournoi, une école ou un réseau mobile en NAT, **tous** les joueurs partagent 10 connexions par minute et 5 inscriptions toutes les 10 min.
  - Avec plusieurs instances, chaque processus aurait son propre compteur.
- **Correctif.** Clé combinée IP + email visé pour `/login` (voir aussi 04 O9), et un magasin partagé si l'app passe à plusieurs instances (§3.6).

### C20 — Poste de développement exposé sur le réseau local · faible

- **Mécanisme.**
  - `docker-compose.yml:9-12` publie PostgreSQL sur `5433:5432`, donc sur toutes les interfaces, avec `ygo` / `ygo`.
  - L'API écoute sur `0.0.0.0` (`index.ts:98`) : au lancement, le journal annonce `Server listening at http://<adresse-réseau-local>:8798` (`pg-redemarrage-arret-api.txt`).
  - Le poste garde des archives de production en clair (audit 03 §5.1).
- **Correctif.**
  - `"127.0.0.1:5433:5432"` dans `docker-compose.yml`.
  - `host: process.env.HOST ?? '127.0.0.1'` dans `index.ts:98`, avec `HOST=0.0.0.0` dans `docker-compose.prod.yml`.

### C21 — Dette qui ralentira les évolutions · faible

Mesures au §5.4. En bref :

- un store de 819 lignes ;
- l'ancienne représentation des prérequis maintenue dans le moteur pour les seuls tests ;
- des types de réponse d'API recopiés côté client ;
- 15 dépendances à une version majeure de retard, dont une branche abandonnée ;
- 1,7 % de lignes couvertes dans les composants.

---

## 2. Isolation multi-tenant, fichier par fichier

Question posée : si deux comptes existaient aujourd'hui, qu'est-ce qui fuirait de l'un à l'autre ?

**Aucune donnée d'un compte n'est lisible par un autre via l'API** (sonde P3 de l'audit 04 et relecture ci-dessous). Les fuites réelles sont côté navigateur (C2), en disponibilité (C1, C3, 04 O3) et en métadonnées (C18, 04 O5). L'isolation repose **entièrement** sur le code applicatif : aucune politique de sécurité au niveau des lignes (grep `row level security|create policy` sur `db/` et `server/` : aucun résultat).

| Fichier | Ce qui isole | Ce qui fuit ou peut fuir | Constat |
|---|---|---|---|
| `server/src/index.ts` | Garde globale, 401 sans session (`:41-48`) | Contournement par encodage du chemin (catalogue, pas de données de compte) ; limites de débit par IP partagées entre comptes (`:33`) ; un seul journal pour tous (IP, URL avec ids de decks) | 04 O1, C19, C4 |
| `server/src/db.ts` | — | **Un pool de 10 connexions pour tous** : un compte qui écrit beaucoup bloque les autres | C3, 04 O3 |
| `server/src/auth/session.ts` | Résolution par SHA-256 du jeton ; jointure `users` (`:64-69`) | Pas de révocation globale (`:92-96`) ; sessions expirées jamais purgées | 04 O13 |
| `server/src/auth/password.ts` | Sel par compte, comparaison à temps constant (`:43-49`) | scrypt de 128 Mio dans le pool libuv partagé : les connexions des uns ralentissent celles des autres (mesuré : 5,6 connexions/s, 400 % CPU, 474 Mio) | 04 O9 ; `load-results.jsonl` |
| `server/src/auth/account.ts` | Étiquettes de base créées **par compte** (`:15-29`) | — | — |
| `server/src/routes/auth.ts` | Pas d'énumération à la connexion (`:113-117`) | 409 à l'inscription ; gel de tous par une regex | C18, C1 |
| `server/src/routes/discord.ts` | Liaison exigeant une session, jamais par email (`:151-170, 201-208`) | `email_taken` / `discord_taken` | C18 |
| `server/src/routes/cards.ts` | Catalogue commun, sans donnée de compte | Relais d'images partagé et sans limite | 04 O6 |
| `server/src/routes/decks.ts` | `lockDeck` exige `owner_id` et un UUID valide (`:15-19`) ; liste filtrée (`:85-89`) ; import fusionné dans la bibliothèque **du compte** sous verrou (`:42-81`) | `DELETE` d'autrui → 200 trompeur (`:201-205`) | 04 P3 / O10 |
| `server/src/routes/library.ts` | Chaque requête filtrée par `owner_id` (`:37-40, 62, 76, 106, 116, 124, 134, 150, 166, 174`) ; invalidation limitée au compte (`:14-19`) | `id` choisi par le client dans des tables à clé **globale** : oracle d'existence d'un UUID d'autrui ; lecture qui balaye les lignes de tous (C12, performance seulement) | 04 O5, C12 |
| `server/src/domain/deckRepository.ts` | **Aucun contrôle propre** : il fait confiance à l'appelant (« Caller owns the transaction and locks the deck row », `:4`) ; aucune requête ne porte `owner_id` (`:6-14, 30-62`) | Toute future route qui l'appelle sans `lockDeck` lit ou écrit le deck d'autrui | risque de conception |
| `server/src/domain/deckConfiguration.ts`, `deckArchive.ts`, `deckSummary.ts` | Validation pure ; références d'étiquettes remappées sur le compte (`deckArchive.ts:64-79`) | Contenu d'un résumé non vérifiable : jamais à montrer à un tiers | 04 O8 |
| `db/schema.sql`, `db/migrations/*` | FK `on delete cascade` depuis `users` ; clés `(deck_id, id)` pour paires, conditions, adversaires | `nonengine_categories.id`, `nonengine_groups.id` : clés globales (`schema.sql:124`, `002:11`) ; `card_categories` sans `owner_id`, isolée seulement par jointure (`schema.sql:149-153`) | 04 O5 |
| `server/scripts/*.ts` | Outils d'administration hors API | `prune-stale-cards` réécrit les decks de **tous** les comptes, par conception | — |
| `deploy/backup.sh`, `restore.sh` | Archives en `umask 077` (`backup.sh:23`) | Une seule archive pour tous ; restauration de tous les comptes à la fois | C5 |
| `web/src/lib/auth.tsx`, `App.tsx`, `store/deckStore.ts`, `components/EditorPage.tsx` | Déconnexion explicite : brouillons purgés et rechargement (`auth.tsx:70-82`), vérifié | **Après un 401, le compte suivant voit l'état du précédent** | **C2** (prouvé) |
| `web/src/lib/draft.ts` | Purgés à la déconnexion explicite | Base IndexedDB `ygo-proba` indexée par deck, pas par compte (`:15-16`) ; conservée après un 401 (lecture, non joué) | C2 |
| `web/src/components/SideSheet.tsx` | — | Préférence « noms visibles » en `localStorage`, par navigateur | négligeable |
| `web/src/worker/*`, `engine/*` | État par onglet, aucun cache partagé | — | — |

---

## 3. Scalabilité : où ça coûte, et à quel seuil ça casse

### 3.1 Où tourne le calcul

- **Tout le calcul de probabilités tourne dans le navigateur**, dans un Web Worker (`worker/engine.worker.ts:33-47`) : aucun coût serveur.
- **Complexité.** Énumération exacte des compositions de 5 ou 6 cartes sur les types suivis (`enumerate.ts:19-46`). Chaque composition est évaluée avec un couplage maximum mémoïsé sur 6 sommets au plus (`matching.ts:30-73`). `computeAll` y ajoute 2 énumérations allégées par type (`enumerate.ts:238-251`).
- **Croissance.** Le coût croît en combinaison du nombre de types suivis. Mesures au C14 et dans l'audit 04 O7 : 30 starters à une copie = 5,7 s ; 40 = 50,3 s.

### 3.2 Coût serveur par route (boucle fermée)

Conditions : image de prod, 1 000 comptes, 15 s par mesure (`load-results.jsonl`). La colonne CPU de Node est lue par `docker stats`.

| Route | 1 client | 10 clients | 50 clients | CPU Node à saturation | CPU PostgreSQL |
|---|---|---|---|---|---|
| `GET /api/auth/me` | 345 req/s, p95 4 ms | — | 1 079 req/s, p95 74 ms | 104 % | 122 % |
| `GET /api/decks` (20 decks) | — | — | 525 req/s, p95 196 ms | 103 % | 244 % |
| `GET /api/decks/:id` | 102 req/s, p95 17 ms | — | 284 req/s, p95 299 ms | 112 % | 146 % |
| `GET /api/library` | 101 req/s, p95 16 ms | — | 282 req/s, p95 279 ms | 105 % | 245 % |
| `PUT /api/library/flags/:cardId` | 42 req/s, p95 33 ms | 104 req/s, p95 144 ms | — | 104 % | 90 % |
| `GET /api/cards/search` (« card xx ») | 63 req/s, p95 23 ms | 166 req/s, p95 99 ms | — | 106 % | 120 % |
| `PUT /api/decks/:id` (deck réaliste) | 9,7 req/s, p95 245 ms | **37,3 req/s**, p95 419 ms | **36,8 req/s**, p95 1 831 ms | 105 % | 258 % |
| `POST /api/auth/login` (scrypt) | — | 4 clients : 4 req/s | 16 clients : **5,6 req/s**, p95 6,9 s | **400 %** (pool libuv), 474 Mio | ≈ 0 % |

Lecture : **le processus Node sature un cœur** sur toutes les routes. L'enregistrement plafonne à ≈ 37/s, la connexion à ≈ 6/s.

### 3.3 Charge réaliste à débit imposé et seuils 100 / 1 000 utilisateurs

**Modèle d'usage (hypothèse, aucune donnée d'usage dans le dépôt).** Un utilisateur actif dans l'éditeur envoie une requête toutes les 4 s, dont un enregistrement complet par minute. Chaque clic d'annotation écrit immédiatement la bibliothèque (docs/architecture.md:9).

Répartition (`paced.mjs`) : enregistrement 7 %, écriture de bibliothèque 25 %, recherche 25 %, ouverture de deck 10 %, bibliothèque 10 %, liste 10 %, session 13 %.

| Débit | ≈ Utilisateurs actifs | p50 global | p95 global | `PUT /api/decks/:id` p50 / p95 | Connexions « idle in transaction » | Verdict |
|---|---|---|---|---|---|---|
| 25 req/s | 100 | 22–31 ms | 484–676 ms | 510–794 ms / 955–2 510 ms | 2 à 4 | tient |
| 50 req/s | 200 | 53 ms | 796 ms | 1 066 / 2 051 ms | 5 | dégradé, stable |
| 75 req/s | 300 | **22 930 ms** | 28 404 ms | 24 226 / 29 660 ms | **8 / 10** | effondrement |
| 100 req/s | 400 | 31 794 ms | 46 309 ms | 32 441 / 47 241 ms | — | effondrement |
| 250 req/s | 1 000 | 109 350 ms | 172 373 ms | 91 574 / 170 557 ms | — | effondrement |

**Comment lire ce tableau.**

- **Fourchettes à 25 req/s** : elles viennent de deux runs, de 60 s et de 30 s.
- **Ordre des runs sur une même base** : 25 req/s (60 s), 100, 250, puis 25 req/s (30 s), 50, 75.
  - Les premiers remplacent surtout des decks synthétiques.
  - Les derniers réécrivent surtout des decks déjà réécrits : environ 80 % des comptes à ce stade, soit le cas courant.
- **Cas où chaque enregistrement remplace entièrement un deck** : voir la comparaison A/B du C3, où l'app actuelle est déjà à p50 1,4 s à 50 req/s.
- **Aucune erreur 5xx** : les requêtes finissent, mais trop tard pour un navigateur (délai `fetch` typique de 300 s, patience humaine de quelques secondes).

**Seuils.**

- **100 utilisateurs actifs simultanés : tient**, avec des enregistrements parfois lents (p95 1–2,5 s).
- **≈ 200** : limite de confort.
- **≈ 300 : effondrement** de toute l'app.
- **1 000 utilisateurs actifs : impossible** en l'état. L'écriture en lot seule ne suffit pas non plus (effondrement à 100 req/s mesuré) ; il faut plusieurs processus (§3.6).

En comptes inscrits, avec un taux de présence simultanée typique de quelques pourcents (non mesuré, pas de données d'usage), 1 000 inscrits restent sous le seuil hors pics. Une sortie de set ou un tournoi le franchissent.

### 3.4 Requêtes et index (1 000 comptes, `explain.out`)

| Requête | Plan | Temps | Verdict |
|---|---|---|---|
| [A] `resolveSession` (`session.ts:64-69`) | clé primaire | 0,65 ms | OK |
| [B] `GET /api/decks` (`decks.ts:85-89`) | index `decks_owner` + clé primaire de `deck_cards` par deck | 11,5 ms (20 decks) | OK ; pas de pagination, borné par les quotas à venir (04 §4.3) |
| [C] `GET /api/library`, affectations (`library.ts:39`) | **Seq Scan card_categories (40 000 lignes)** | 27,2 ms | **C12** |
| [D] invalidation avec carte (`library.ts:17`) | semi-jointure sur clé primaire | 3,2 ms | OK (pas d'index `deck_cards(card_id)` nécessaire) |
| [E] étiquette présente (`library.ts:76`) | clé primaire | 0,9 ms | OK |
| [F] suppression d'étiquette | cascade sans index | 7,5 ms | C12 |
| [G] recherche à 2 caractères | **Seq Scan cards** | 40 ms | C17 |
| [H] recherche à 5 caractères | index trigramme | 20 ms | OK |
| [I] suppression d'un compte (cascade) | clés et index existants | 164 ms | OK |
| [J] purge des sessions expirées | Seq Scan (pas d'index `expires_at`) | 2 ms | à indexer si une purge est ajoutée |

Motifs N+1 et allers-retours :

- **Écriture d'un deck** : 170 instructions, 22 avec l'écriture en lot testée (C3).
- **Import d'archive** : deux requêtes par HOPT et une par affectation (`decks.ts:63-78`, 04 Q4 : 88 s pour 20 000 HOPT).
- **Lecture d'un deck** : 11 requêtes séquentielles (`decks.ts:92-101` + `deckRepository.ts:6-14`).
- **Accueil** : 2 requêtes HTTP par deck à recalculer (`HomePage.tsx:49-64`).

### 3.5 Volume de données et outillage

- **Volume.** Profil synthétique : 20 decks par compte, 45 cartes, 8 starters, 10 paires, 5 adversaires × 2 plans × 6 cartes. Il donne **506 Mo pour 1 000 comptes**, soit ≈ 0,5 Mo par compte. `deck_side_plan_cards` en représente 221 Mo, dont 124 Mo d'index.
- **Archive.** `pg_dump | gzip` : 40,7 Mo en 10 s ; restauration de vérification 18 s ; empreintes 15–17 s chacune (`sauvegarde-duree-1000-comptes.txt`).
- **Seuil de l'empreinte.** Vers 9 300 comptes, `fingerprint.sql` échoue et les déploiements sont bloqués (C9).
- **Rétention.** 14 jours × 40,7 Mo + une archive `keep/` par déploiement, hors rétention (`backup.sh:59-61`) : ≈ 0,6 Go à 1 000 comptes, ≈ 6 Go à 10 000, sur le même disque que la base (C5).

### 3.6 Ce qui empêche de passer à plusieurs instances

- **Nom de conteneur fixe** : `container_name: ygo-app` (`docker-compose.prod.yml:35`), cible unique du `reverse_proxy` (`README.md:78`). Compose ne peut pas créer plusieurs réplicas.
- **Limites de débit en mémoire du processus** (`index.ts:33`), une par instance.
- **Migrations et sauvegarde** orchestrées par `deploy.sh` sur un hôte unique.
- **Ce qui est déjà prêt** : les sessions sont en base (`session.ts`) et l'app ne garde aucun état utilisateur en mémoire, hors limites de débit et `dummyHash`.

Il suffirait donc d'un `reverse_proxy` à plusieurs cibles, d'un magasin partagé pour `@fastify/rate-limit` (option `redis`) et d'un pool dimensionné par instance, `instances × max ≤ max_connections`.

---

## 4. Exploitation

| Sujet | État | Preuve | Constat |
|---|---|---|---|
| Journaux | Chaque requête en JSON (IP, URL), sans rotation, sans identifiant de compte, sans niveau utile pour les erreurs métier | `index.ts:26-27` ; `docker inspect` LogConfig | C4, 03 B5 |
| Erreurs | Aucun gestionnaire global ; messages internes au client ; aucun suivi d'erreurs | grep `setErrorHandler` | C4, 04 O10 |
| Métriques, alertes | Aucune | grep | C4 |
| Healthcheck | Sans effet sur un conteneur « unhealthy » | `healthcheck-unhealthy.txt` | C4 |
| Robustesse du processus | Arrêt sur redémarrage de PostgreSQL ; SIGTERM ignoré ; aucun délai | `pg-redemarrage-arret-api.txt`, `arret-conteneur-sigterm.txt` | C8 |
| Sauvegardes | Quotidiennes, **vérifiées par restauration et empreinte** (point fort) ; même VPS ; perte jusqu'à 24 h ; `keep/` sans rétention | `backup.sh` ; `test-backup-restore-extrait.txt` (57 / 57) | C5 |
| Restauration | Réversible (`ygo_previous`, sauvegarde de sécurité) et testée ; base entière seulement | `restore.sh:1-19, 96-119` | C5 |
| Retour arrière | Données : archive pré-migration ; code : `git checkout` + reconstruction | runbook C5 (`:219-247`) | C13 |
| Déploiement | Construction sur la prod, coupure ≈ 21 s + arrêt forcé, sans `--pull`, sans CI | `deploy.sh:26, 50` ; docs/PLAN.md:50 | C11, C13, C7 |
| Point unique de défaillance | Un VPS (base, app, sauvegardes, Caddy de goldfish) ; DNS Cloudflare en « DNS only », IP du VPS publique | `README.md:15-30, 59-90` | C5 |
| Mises à jour de sécurité | Image de base et PostgreSQL jamais tirés | `deploy.sh:50` ; `docker-compose.prod.yml:12` | C11 |
| Opérateur | Une personne ; commandes VPS depuis un poste | AGENTS.md (Commandes, Prod) | — |

---

## 5. Qualité

### 5.1 Inventaire et couverture réelle

| Suite | Tests | Exécutée ici | Couverture |
|---|---|---|---|
| Web (Vitest) | 254 tests dans 26 fichiers, 35 s | oui, sur la copie : 254 / 254 | lignes 36,5 % (3 004 / 8 234), branches 89,2 % |
| · `src/engine` | — | — | lignes **96,8 %**, branches 92,1 % ; lignes jamais exécutées = gardes d'erreur, plus `drawHands` (`hand.ts:63-76`) |
| · `src/lib` | — | — | lignes 70,0 % ; `sideSheetPdf.ts` 22,9 %, `draft.ts` 16,3 %, `api.ts` 46,1 %, `router.tsx` 0 %, `colors.ts` 0 % |
| · `src/store` | — | — | `deckStore.ts` 82,3 %, **`selectors.ts` 0 %** |
| · `src/worker` | — | — | `computeClient.ts` 100 %, **`engine.worker.ts` 0 %**, `client.ts` 0 % |
| · `src/components` | — | — | **1,7 %** (78 / 4 611 lignes) ; aucun test de composant (docs/PLAN.md:36) |
| Serveur unitaires (node:test) | 14 | oui : 14 / 14 | `domain/*` et `cards.ts` seulement |
| Serveur persistance (PostgreSQL jetable) | 14 | oui : 14 / 14 | `decks.ts` 97,1 %, `library.ts` 96,6 %, `deckRepository.ts` 100 % |
| Serveur purge | 11 (AGENTS.md) | non (§7) | — |
| Authentification, garde, Discord | **0** | — | `index.ts`, `auth.ts`, `discord.ts`, `password.ts`, `account.ts` jamais chargés |
| e2e (Chrome) | 10 scénarios (`web/e2e/scenarios/`) | non (§7) | rendu, mise en page, écran = Excel |
| Sauvegarde et restauration | 57 gardes | oui : 57 / 57 | `backup.sh`, `restore.sh` |
| CI | **aucune** | — | — |

Détail des trous du moteur : `coverage-engine-trous.txt`.

### 5.2 Mutations : ce que les tests attrapent vraiment

- **Méthode.** 55 mutants plausibles (`scripts/mutants.mjs`), injectés un à un dans la copie (1 occurrence exacte exigée, restauration contrôlée par hash). Suite web complète avec `--bail=1` (`scripts/run-mutants.mjs`).

| Zone | Mutants | Tués | Survivants |
|---|---|---|---|
| Moteur : énumération, évaluation, couplage, requêtes, mains, comparateur, binomiale | 40 | 36 | E9, Q3 (redondance) ; H2, H4 (mur de mains) |
| Application : constructeur, conditions, vues, aperçu, sélecteurs, plans de side | 15 | 10 | B1, B2 (constructeur) ; SV1 (vue étiquette) ; S1, S2 (sélecteurs) |
| **Total** | **55** | **46** | **9** (détail au C6) |

- **Mutants tués significatifs.**
  - Poids de la sixième carte (E3) ; dénominateur du second (E4) ; contribution marginale qui retire la copie du deck au lieu de la neutraliser (E5).
  - Condition évaluée sur le deck entier au lieu du deck restant (V11) ; profil précoce qui compterait la sixième (V5).
  - Couplage glouton (MT1) ; plafond partagé tronqué (V7, V8).
  - Garde de précision entière retirée (E11) ; empreinte de plan sans critères (SP3).

### 5.3 Test différentiel du chemin applicatif

Voir C6 : 2 000 decks aléatoires, 0 divergence ; pouvoir de détection vérifié sur 5 mutants. Il n'existe pas dans le dépôt : c'est la recommandation principale pour le calcul.

### 5.4 Dette qui ralentira les évolutions

| Dette | Mesure | Coût pour la suite |
|---|---|---|
| Store unique | `web/src/store/deckStore.ts` : 819 lignes. État de l'éditeur, bibliothèque, calcul, persistance, brouillons et plans de side ; l'état d'un deck survit à un échec de chargement (C2) | Toute fonction payante (quotas, partage, historique) passe par ce fichier |
| Ancienne représentation des prérequis dans le moteur | `Prereq`, `starterPrereqs`, `edgePrereqs` (`engine/types.ts:34-38, 73, 97`) et leur traduction (`evaluate.ts:84-107, 183-199`), **utilisés par les seuls tests** (grep hors tests : aucun usage) | Chemins en plus au cœur du calcul, à maintenir à chaque règle |
| Contrat de réponse non partagé | `DeckDetail` recopié côté client (`web/src/lib/api.ts:65-93`) alors que la réponse est construite à la main (`decks.ts:98-100`) ; aucun schéma de réponse | Divergence silencieuse client / serveur à chaque ajout de champ |
| Lignes denses | 60 lignes de plus de 160 caractères sur 1 717 dans `server/src`, par exemple `decks.ts:56, 88` ; aucun linter ni formateur (AGENTS.md) | Revue difficile, erreurs d'isolation plus faciles à manquer |
| Versions majeures en retard | `npm outdated` : vitest 2 → 5, vite 6 → 8, React 18 → 19, recharts 2 → 3 (« 1.x and 2.x branches are no longer active », journal de construction), tailwindcss 3 → 4, @vitejs/plugin-react 4 → 6, @fastify/cors 10 → 11 | Montées groupées plus risquées ; vulnérabilités de dev non corrigeables sans majeure (C16) |
| Poids de la documentation par étape | Lignes ajoutées par commit : 10A code 393 / tests 94 / docs 483 ; 10C 895 / 401 / 201 ; retouche fiche 689 / 176 / 134 (`git show --numstat`) | Chaque évolution impose de mettre à jour DECISIONS, décisions compressées, PLAN, compte rendu, AGENTS : un contributeur externe s'y perdra |

---

## 6. Ordre de correction proposé

### P0 — avant d'ouvrir l'app à un seul inconnu

| Action | Ferme | Fichiers | Preuve de fermeture attendue |
|---|---|---|---|
| Longueur d'email ≤ 254 avant la regex ; `bodyLimit` des routes d'authentification | C1 | `auth.ts:67`, `index.ts` (enregistrement des routes) | `redos-probe.mjs … 256000` → 400 en moins de 50 ms, `/api/health` inchangé |
| Garde sur la route résolue (04 O1) | 04 O1 | `index.ts:41-48`, `cards.ts` | `/%61pi/cards/search` → 401 |
| Rechargement complet et purge des brouillons sur 401 ; réinitialisation du store si `loadDeck` échoue | C2 | `auth.tsx:55`, `deckStore.ts:419-421` | `audit05-session-switch.mjs` : 0 tuile de A visible |
| Écriture en lot (`deckRepository.ts`, `mergeLibrary`), délais SQL, pool dimensionné, rejet sous pression (503 plutôt qu'effondrement) | C3, C8 | `deckRepository.ts:29-66`, `decks.ts:63-78`, `db.ts:12`, `index.ts:26` | `ab-batch.ps1` rejoué : 50 req/s à p50 < 50 ms ; au-delà, 503 rapides plutôt que p50 de plusieurs secondes |
| `pool.on('error')`, arrêt gracieux | C8 | `db.ts`, `index.ts`, `docker-compose.prod.yml` | redémarrage de `db` sans arrêt de l'API ; `docker stop` en moins de 2 s, code 0 |
| Sonde externe + alerte ; rotation des journaux | C4 | `docker-compose.prod.yml`, `backup.sh` | alerte reçue quand l'app est arrêtée |
| Copie chiffrée des sauvegardes hors VPS | C5 | `backup.sh` | archive listée chez le second hébergeur, `restore.sh --check-only` depuis cette copie |

### P1 — avant de facturer

| Action | Ferme | Fichiers |
|---|---|---|
| `auth.integration.ts` sur l'app réelle + CI protégeant `main` | C7 | `server/tests/`, `index.ts` (fabrique `buildApp`), `.github/workflows/` |
| Test différentiel du constructeur, sélecteurs purs testés | C6 | `web/src/engine/reference/`, `store/selectors.ts`, `lib/dataIdentity.test.ts` |
| En-têtes de sécurité | C10 | Caddyfile goldfish (bloc `analysis`) |
| Image non root, sans npm, dépendances serveur seulement, `--pull` | C11 | `deploy/Dockerfile`, `deploy/deploy.sh`, `deploy/docker-compose.prod.yml` |
| Index `card_categories(category_id)` | C12 | `db/migrations/005-*.sql` + montages + `lib.sh` |
| Empreinte bornée ; sauvegarde pré-déploiement app en marche hors migration | C9, C13 | `deploy/fingerprint.sql`, `deploy/lib.sh` |
| Image construite en CI et étiquetée ; retour arrière par étiquette | C13 | `deploy/deploy.sh`, `deploy/docker-compose.prod.yml` |
| Montée de `fastify` et de `fast-uri` avant tout schéma | C16 | `server/package.json` |
| Liste de `__ENGINE_VERSION__` calculée depuis les imports | C15 | `web/vite.config.ts` |

### P2 — avec la croissance

| Action | Ferme | Fichiers |
|---|---|---|
| Estimation du coût avant calcul, deltas à la demande, aperçus en parallèle | C14 | `worker/computeClient.ts`, `store/deckStore.ts`, `HomePage.tsx` |
| Plusieurs instances : `container_name` retiré, magasin partagé des limites, `reverse_proxy` multi-cibles | §3.6, C19 | `docker-compose.prod.yml`, `index.ts:33`, Caddyfile |
| Archivage WAL si une perte de 24 h n'est plus acceptable ; extraction d'un deck depuis une archive | C5 | `deploy/` |
| Recherche : 3 caractères ou préfixe, jokers échappés | C17 | `cards.ts:33-41`, `AddCardDialog.tsx` |
| Poste de dev : base et API sur 127.0.0.1 | C20 | `docker-compose.yml:11-12`, `index.ts:98` |

---

## 7. Non vérifié

Chaque point est un trou assumé :

1. **En-têtes réels de la prod en HTTPS** (HSTS en particulier) et Caddyfile réel de goldfish : non lus, prod non interrogée (consigne). À vérifier par vous : `curl -sI https://analysis.scratchrecode.com/ | grep -iE 'strict-transport|content-security|x-frame|x-content-type|referrer'`.
2. **Capacité du VPS.** Processeurs, mémoire et disque non consultés. Les seuils du §3 viennent d'un poste de 12 cœurs sous Docker Desktop, base sans limite de ressources. Node sature un cœur quel que soit l'hôte, mais la vitesse d'un cœur du VPS et la concurrence avec goldfish sont inconnues : les seuils réels peuvent être plus bas.
3. **Modèle d'usage** du §3.3 (une requête toutes les 4 s, un enregistrement par minute) : hypothèse, sans aucune donnée d'usage.
4. **Profil de données réel** (decks et adversaires par compte) : le seuil de ≈ 9 300 comptes de C9 et les volumes du §3.5 sont extrapolés du profil synthétique.
5. **Gel à 1 Mio (C1)** : extrapolé de 64 000 et 256 000 caractères, loi en n² vérifiée ; non joué pour ne pas geler 12 min la pile d'audit.
6. **Mutants survivants face à l'e2e** : l'absence d'assertion chiffrée repose sur la lecture des scénarios ; `npm run e2e -w web` n'a pas été lancé, ni sur le code intact ni avec les mutants.
7. **Brouillons IndexedDB après un 401 (C2)** : conservation déduite du code (`auth.tsx:55`, `draft.ts:62-64`) ; le scénario joué ne créait pas de brouillon.
8. **Coût du moteur sur mobile** : mesuré sous Node 22 sur un poste, pas dans un navigateur mobile.
9. **Test différentiel** limité à des decks de 7 à 11 cartes (limite de l'oracle exhaustif). Les grands decks restent couverts par le Monte Carlo à 40 cartes du dépôt (`chronology.test.ts:387-429`), non étendu ici.
10. **Suites non rejouées** : `purge.integration.ts`, `test-migration-sequence.sh`, `rehearsal.sh`, e2e.
11. **Atteignabilité des CVE OpenSSL** : Node officiel embarque-t-il sa propre OpenSSL ou utilise-t-il le paquet Alpine ? Non déterminé ; seule la présence du paquet est constatée.
12. **Rotation des journaux au niveau du démon Docker du VPS** (`/etc/docker/daemon.json`) : non lue. Si elle y est configurée, le volet « sans rotation » de C4 tombe.
13. **Copies hors VPS faites en dehors du dépôt** (cron sur une autre machine, sauvegarde de l'hébergeur) : rien dans le dépôt ne l'indique, sans pouvoir l'exclure.
14. **Code d'invitation de prod** : sa robustesse n'a pas été évaluée. Le `.env` local porte un code court et devinable (relevé par l'audit 02, non recopié ici) ; `.env.prod.example` recommande un code non devinable.
15. **Parcours Discord** : non exercé.
16. **Écriture en lot** : son équivalence a été vérifiée par la seule suite de persistance (14 tests), pas par la suite de purge, ni par `prune-stale-cards`, ni par l'e2e.

---

## 8. Méthode, commandes, incidents, démontage

**Lectures.**

- Tout `server/src`, `db/schema.sql` et les migrations 001, 002, 004.
- `deploy/` : Dockerfile, compose, `deploy.sh`, `backup.sh`, `restore.sh`, `lib.sh`, `fingerprint.sql`, README, runbook (variante C0–C6).
- `web/src` : `engine/*` (dont `reference/`), `lib/api.ts`, `auth.tsx`, `draft.ts`, `engineModel.ts`, `conditions.ts`, `summary.ts`, `statsViews.ts`, `sidePlan.ts`, `store/deckStore.ts` (chargement), `selectors.ts`, `worker/engine.worker.ts`, `App.tsx`, `EditorPage.tsx`, `HomePage.tsx`, `LoginPage.tsx`.
- Tests serveur et web cités ; AGENTS.md, server/AGENTS.md, docs/PLAN.md, docs/architecture.md, docs/regles-metier.md §2 et §7 ; audits 00 à 04.

**Copie du code (scratchpad de session, jamais le dépôt).**

- `git archive HEAD web server scripts db package.json | tar -x` dans `audit05/mirror`, puis `deploy` pour le test de sauvegarde. `git diff --stat HEAD` sur ces dossiers : vide.
- `node_modules` : jonctions vers ceux du projet, sauf `vitest`, `@vitest/*` et `vite-node`, pris dans une installation séparée `audit05/covdeps` (`npm install @vitest/coverage-v8@2.1.9 vitest@2.1.9`) pour la couverture.
- Jonctions retirées en fin d'audit par `rmdir`, qui ne suit pas la cible. `node_modules` du projet contrôlé : 398 entrées avant et après.

**Commandes principales.**

```bash
# Tests et couverture (copie)
node node_modules/vitest/vitest.mjs run                                   # 254/254, 35 s
node node_modules/vitest/vitest.mjs run --coverage.enabled=true --coverage.provider=v8 --coverage.include='src/**/*.{ts,tsx}' --coverage.exclude='src/**/*.test.ts'
node --import tsx --test --experimental-test-coverage tests/configuration.test.ts tests/cardImage.test.ts
TEST_DATABASE_URL=postgres://step23:step23-disposable@127.0.0.1:55433/step23 node --import tsx --test --experimental-test-coverage tests/persistence.integration.ts
node run-mutants.mjs                                                       # 55 mutants, ≈ 12 min
node --import tsx audit05-fuzz-builder.ts 20260915 2000 2                  # 160 761 vérifications, 178 s
node fuzz-sanity.mjs B1 B2 E9 V1 V14 LC1
node --import tsx audit05-engine-cost.ts
bash deploy/test-backup-restore.sh                                         # depuis la copie : 57 ✓
# Sécurité
npm audit --json ; npm audit --omit=dev --json ; npm ls fast-uri uuid ; npm outdated --json
git log --all --diff-filter=A --name-only | grep -i env ; git grep -n -I -E '(password|secret|token|api[_-]?key)…'
docker build -f deploy/Dockerfile -t testhand-audit05-app:cff8a75 .       # contexte = dépôt, lecture seule
docker scout quickview … ; docker scout cves … --only-severity critical,high
# Pile jetable
docker run -d --rm --name testhand-audit05-db --label purpose=testhand-audit05 --tmpfs /var/lib/postgresql/data -p 127.0.0.1:55470:5432 postgres:17-alpine
#   schema.sql puis 001 → 004 par stdin ; gen-data.sql (1 000 comptes, 5 min) ; explain.sql
docker network create testhand-audit05-net ; docker network connect --alias db testhand-audit05-net testhand-audit05-db
docker run -d --name testhand-audit05-app --network testhand-audit05-net -p 127.0.0.1:8797:8787 -e NODE_ENV=production -e TRUST_PROXY=1 -e INVITE_CODES=audit05-code … testhand-audit05-app:cff8a75
docker run --rm --network testhand-audit05-net -v <scratchpad>:/audit node:22-alpine node /audit/load.mjs http://testhand-audit05-app:8787 <scénario> <clients> <s>
docker run --rm --network testhand-audit05-net -v <scratchpad>:/audit node:22-alpine node /audit/paced.mjs http://testhand-audit05-app:8787 <req/s> 60
docker run -d --rm --name testhand-audit05-caddy --network testhand-audit05-net -p 127.0.0.1:55471:80 -v …/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine
node redos-probe.mjs http://127.0.0.1:8797 64000 audit05-code             # puis 256000, puis code invalide
# Expérience d'écriture en lot (copie mirror-batch = git archive HEAD + deckRepository remplacé)
TEST_DATABASE_URL=… node --import tsx --test tests/persistence.integration.ts   # 14/14 sur la variante
docker build -f deploy/Dockerfile -t testhand-audit05-app:batch .            # contexte = copie
create database ygo_snapshot template ygo                                    # puis, avant chaque palier : drop database ygo with (force) ; create database ygo template ygo_snapshot
powershell ab-batch.ps1                                                      # actuelle 50/75, en lot 50/75/100/250 req/s
node audit05-session-switch.mjs docs/audit/preuves-05 ; node audit05-back-after-logout.mjs docs/audit/preuves-05
```

**Incidents, dans l'ordre.**

1. **Premier essai de couverture en échec.** Le fournisseur de couverture était introuvable depuis `vite-node` du projet. Corrigé en construisant un `node_modules` de jonctions dans la copie, sans rien installer dans le projet.
2. **Jeu synthétique effacé.** Le test de redémarrage de PostgreSQL (C8) a vidé la base jetable, dont le stockage est en tmpfs. Schéma, migrations et données ont été rejoués à l'identique (même graine).
3. **Premier passage de charge écarté.** Les jetons de session synthétiques étaient mal numérotés (numérotation sur le produit comptes × sessions) : la moitié des requêtes répondaient 401. Sessions recréées, puis toutes les mesures du §3.2 rejouées ; seules les secondes sont retenues.
4. **Paramètres JSON passés à `docker run`.** PowerShell 5.1 retirait les guillemets ; les options sont passées en `clé=valeur`.
5. **Palier à 400 req/s interrompu.** Les paliers précédents s'étaient effondrés ; le générateur a été arrêté (`docker stop`), l'API a résorbé sa file en ≈ 20 s.
6. **Exposition sur le réseau local.** Pendant le test C8, l'API lancée depuis la copie écoutait sur toutes les interfaces du poste (`index.ts:98`), quelques secondes, sans autre donnée que le jeu synthétique. Les adresses locales sont masquées dans `pg-redemarrage-arret-api.txt`. Les autres serveurs de l'audit tournaient en conteneur, publiés sur 127.0.0.1 seulement.

**Démontage.**

- Conteneurs `testhand-audit05-db`, `-int`, `-caddy`, `-app` et `-app-batch` arrêtés et supprimés ; ceux lancés pour `load.mjs` et `paced.mjs` étaient en `--rm`. `docker ps -a --filter label=purpose=testhand-audit05` ne renvoie plus rien.
- Réseau `testhand-audit05-net` supprimé ; images `testhand-audit05-app:cff8a75` et `:batch` supprimées.
- Le cache de construction de Docker n'a pas été purgé : un `docker builder prune` toucherait les autres projets du poste.
- Conteneurs de `test-backup-restore.sh` (`testhand-bkp-src` / `-dst`) retirés par le script lui-même.
- Jonctions `node_modules` des deux copies retirées par suppression non récursive du point de jonction ; `node_modules` du projet : 398 entrées avant, 398 après.
- Les copies, la couverture et les rapports intermédiaires restent dans le scratchpad de session, hors dépôt.
- `web/node_modules/.vite*` et `deploy/out/test-migration-sequence-*` existaient avant cet audit (dates du 14 septembre et du 10 au 11 septembre) ; ils n'ont pas été touchés.
- Aucune commande vers le VPS, la base de prod, la base de dev (conteneur `ygo-proba-db` absent, jamais démarré) ni le CDN : les images des cartes étaient bloquées dans les tests navigateur.
- **Services tiers contactés**, à savoir :
  - le registre npm (`npm audit`, `npm outdated`, installation de `@vitest/coverage-v8` dans le scratchpad) ;
  - Docker Scout (`docker scout quickview` et `cves`), qui reçoit la liste des paquets de l'image construite, pas le code.

Dépôt : seuls `docs/audit/05-code.md` et `docs/audit/preuves-05/` ont été ajoutés.
