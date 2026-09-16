# Audit 04 — Permissions : ce qu'un utilisateur inconnu doit pouvoir toucher

- **Date** : 15 septembre 2026. Code audité : branche `wip/audit-materiaux` à `b79d320`, identique à `main` `cff8a75` pour le code (`git diff --stat cff8a75 b79d320` : un seul fichier, `docs/audit/00-materiaux.md`). Prod déclarée `4cf9493` (docs/PLAN.md:50).
- **Prisme** : commercialisation en freemium (offre gratuite limitée + abonnement), donc des inconnus comme utilisateurs.
- **Nature** : constats sourcés (fichier:ligne, sonde HTTP exécutée ou mesure). Les **quotas chiffrés du §4.3 sont des propositions à trancher**, pas des constats.
- **Périmètre respecté** : aucun fichier du projet modifié hors `docs/audit/`, aucun commit, aucune commande vers le VPS, la base de prod ou un service tiers. Les sondes tournent sur une pile jetable (PostgreSQL `testhand-audit04-db` sur 127.0.0.1:55460, API sur 8796). Méthode et démontage au §9.

Preuves brutes et scripts : [`preuves-04/`](preuves-04/).

---

## 0. Synthèse

### 0.1 Ce qui empêche d'ouvrir l'app à des inconnus

| # | Porte | Qui peut l'ouvrir | Effet prouvé | Preuve principale |
|---|---|---|---|---|
| O1 | La garde d'authentification se contourne en encodant une lettre du chemin (`/%61pi/…`). Les routes du catalogue répondent sans session, **y compris à travers Caddy** configuré comme en prod | **N'importe qui**, sans compte | Catalogue et textes d'effet aspirables ; relais d'images appelable ; les autres routes tombent en 500 | `server/src/index.ts:42-43`, `routes/cards.ts:17-66` ; sondes Q7 et Caddy 2.11.4 (§3) |
| O3 | Un seul compte sature le pool de 10 connexions PostgreSQL | Tout compte gratuit | `/api/auth/me` d'un **autre** compte : de 11 ms à **16,1 s** pendant 12 requêtes de 163 Kio | `db.ts:12` ; sonde Q2 |
| O2 | Aucune borne sur la taille d'une configuration, une instruction SQL par ligne | Tout compte gratuit | Une requête de 1 Mio tient une transaction **≈ 10 min** ; un import de 107 Kio bloque la bibliothèque du compte 87 s | `deckRepository.ts:36-62` ; sondes P7a, Q1, Q4 |
| O6 | Relais d'images sans limite de débit ni cache, joignable anonymement par O1 | N'importe qui | Faire bannir l'IP du VPS par YGOPRODeck (menace publiée, audit 03 §2.1) | `cards.ts:51-66` ; Q7 |
| O12 | Code d'invitation unique, réutilisable ; email non vérifié | Quiconque obtient le code | Comptes illimités, 5 par IP toutes les 10 min, avec l'email d'un tiers | `auth.ts:11-18, 64-69` ; sonde P1 |
| O10 · O5 | Erreurs internes renvoyées au client ; identifiants choisis par le client dans des tables à clé globale | Tout compte | Messages SQL exposés, oracle d'existence d'UUID entre comptes | sondes P2, P4, Q9 |
| O4 | Aucun quota, aucune limite de débit hors authentification | Tout compte | 300 decks en 8,5 s, 500 étiquettes en 9,2 s | sonde P6 |

Autres portes, moins graves ou conditionnelles : O7 (coût du moteur sans borne, **bloquant avant tout partage de deck**), O8 (chiffres stockés falsifiables), O9 (scrypt de 128 Mio par tentative anonyme), O11 (textes libres sans borne), O13 (pas de déconnexion globale), O14 (requêtes « simples » acceptées depuis le même site), O15 (validation client en retard).

### 0.2 Ce qui tient déjà

- **Isolation entre comptes.** Toute lecture ou écriture d'un autre compte est refusée (sonde P3, §1.3).
- **Catalogue en lecture seule.** Aucune route n'écrit le catalogue (`cards.ts` : trois `GET`).
- **Authentification.**
  - Sessions opaques, hachées en base (`session.ts:25-26`).
  - Connexion qui ne permet pas d'énumérer les comptes (`auth.ts:97-117`).
  - Pas de rattachement Discord par email (`discord.ts:13-15`).
- **Aucun coût serveur de calcul.** Le moteur tourne dans le navigateur (docs/architecture.md:7).
- **Textes échappés.** Aucun HTML injecté dans le front (grep `dangerouslySetInnerHTML` : zéro) ; aucune cellule Excel formée par un texte utilisateur (`exportComparison.ts:63`).

### 0.3 Décisions en bref (détail au §2)

- **Admin.** Rien de ce que l'utilisateur touche aujourd'hui ne doit passer admin. Le seul contenu d'admin, le catalogue, n'a déjà aucune route d'écriture. Ce qui manque est **nouveau** :
  - codes et offres ;
  - suspension de compte ;
  - modèles d'annotation publiés.
- **Payant.** Les fonctions à forte valeur perçue, sans être le cœur du calcul :
  - plans de side, fiche et PDF ;
  - export Excel ;
  - comparateur sur un deck sidé ;
  - volumes : decks, étiquettes personnelles, requêtes enregistrées, historique, liens de partage.
- **Contraint.** Presque toute saisie libre : listes de la configuration, textes, identifiants, paramètre `limit`, taille des corps, relais d'images, et bornes du moteur.
- **Libre.** Le reste :
  - les annotations qui font le calcul (starters, paires, conditions, profils, HOPT) ;
  - les réglages du navigateur ;
  - le comparateur à l'écran ;
  - les exports YDK / JSON (portabilité) ;
  - les droits sur son compte.

---

## 1. Modèle d'accès actuel

### 1.1 Un seul niveau de droit : « connecté = propriétaire de ses données »

| Élément | Constat | Preuve |
|---|---|---|
| Rôles, offres, quotas | **Aucun.** Ni colonne, ni table, ni vérification. `/api/auth/me` renvoie `id, email, display_name, providers, has_password`, rien d'autre | `db/schema.sql:48-54` ; `server/src/routes/auth.ts:36-48` ; sonde P1b |
| Entrée | Code d'invitation **partagé et réutilisable**, lu dans l'environnement ; « Zéro table, zéro écran d'admin » | `auth.ts:8-16, 60-66` ; DECISIONS.md:1209-1212 ; sonde P1 : 4 comptes créés avec le même code, le 6ᵉ essai depuis la même IP reçoit 429 |
| Limites de débit | Trois routes seulement : register 5 / 10 min, login 10 / min, départ Discord 10 / min, **par IP**. Rien sur les routes de decks, de bibliothèque ou du catalogue | `server/src/index.ts:33` (`global: false`) ; `auth.ts:56, 101` ; `discord.ts:86` |
| Garde d'authentification | `preHandler` global qui laisse passer `/api/health` et `/api/auth/*`, décidé sur le **chemin brut** `req.url` | `index.ts:41-48` |
| Isolation entre comptes | Chaque requête filtre sur `owner_id` ; ressource d'autrui → 404 | `decks.ts:15-20` ; `library.ts:62, 116, 124, 166, 174` ; DECISIONS.md:1254 ; sonde P3 (§1.3) |
| Taille d'un corps de requête | Défaut de Fastify (1 Mio), aucun `bodyLimit` explicite | `index.ts:26-29` ; sonde P5 : 1 Mio + 10 octets → 413 |
| Administration | Hors application : shell du VPS, `.env.prod`, scripts CLI du catalogue | AGENTS.md (Commandes, Prod) ; `deploy/README.md:47-50` ; `server/scripts/*.ts` |
| Calcul | **Entièrement dans le navigateur** (Web Worker). Le serveur ne lit jamais un résumé, il en valide la forme | docs/architecture.md:7 ; `server/AGENTS.md:6` |

Conséquence directe pour le freemium : il n'existe **aucun point d'ancrage** pour distinguer un compte gratuit d'un compte payant, ni un administrateur d'un utilisateur. Tout est à créer (§4.4).

### 1.2 Surface de l'API

| Route | Garde | Portée | Limite de débit | Remarque |
|---|---|---|---|---|
| `GET /api/health` | public | — | non | expose nombre de cartes et version du catalogue (`index.ts:53-74`) |
| `POST /api/auth/register` | public | — | 5 / 10 min / IP | code d'invitation, email non vérifié |
| `POST /api/auth/login` | public | — | 10 / min / IP | scrypt même si l'email est inconnu (`auth.ts:113-116`) |
| `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/providers` | public (session résolue à la main pour `me`) | session | non | |
| `GET /api/auth/discord/start`, `/callback` ; `DELETE /api/auth/discord` | public, session résolue à la main | session | 10 / min pour `start` | état anti-CSRF en cookie (`discord.ts:49-67, 119-121`) |
| `GET /api/cards`, `/api/cards/search`, `/api/cards/:id/image` | garde globale **seulement** (aucun `requireUser`) | catalogue commun | non | le relais d'images appelle le CDN à chaque requête (`cards.ts:51-66`) |
| `GET/POST/PUT/PATCH/DELETE /api/decks…` | garde + `requireUser` | `owner_id` | non | |
| `GET/PUT/POST/PATCH/DELETE /api/library…` | garde + `requireUser` | `owner_id` | non | |

`requireUser` apparaît sur 15 lignes de `decks.ts` et 13 de `library.ts` (import compris), **sur aucune** de `cards.ts` (grep `requireUser` sur `server/src/routes`).

### 1.3 Ce qui tient déjà (sonde P3 : B agit sur les ressources de A)

| Action de B sur A | Résultat |
|---|---|
| `GET`, `PUT`, `PATCH`, `POST …/duplicate`, `PUT …/summary` sur le deck de A | 404 |
| `PATCH` / `DELETE` du plafond partagé de A | 404 |
| `DELETE` de l'étiquette de A | 400 « Catégorie absente ou fournie de base » |
| Affecter une carte à l'étiquette de A ; poser le plafond de A sur une carte | 404 |
| Créer un deck dont `params.statsView` vise l'étiquette de A | 400 « Catégorie référencée absente » (`deckArchive.ts:64-70`) |
| `DELETE` du deck de A | **200 `{ ok: true }`**, deck de A intact (relu par A) : pas de fuite, mais une réponse trompeuse (`decks.ts:201-205`) |

L'isolation par compte est solide. Les failles sont ailleurs : chemin d'accès, identifiants choisis par le client, absence de bornes et de quotas (§3).

---

## 2. Inventaire de tout ce qu'un utilisateur modifie, et décision

**Légende des décisions**
- **L — libre** : aucune restriction au-delà de la validation déjà en place.
- **C — contraint** : reste accessible, mais avec une validation ou une borne à ajouter (précisée).
- **A — admin** : réservé à un rôle administrateur.
- **P — payant** : fonction de l'offre payante ; « C + P » = borne basse en gratuit, borne haute en payant.

Les bornes « aujourd'hui » sont listées dans l'ordre client / serveur / base. « — » = aucune.

### 2.1 Compte et accès

| # | Élément | Où | Bornes aujourd'hui | Décision | Justification |
|---|---|---|---|---|---|
| A1 | Inscription : email, mot de passe, nom affiché, code | `LoginPage.tsx:129-181` → `POST /api/auth/register` (`auth.ts:52-95`) | email : `type=email` / regex `^\S+@\S+\.\S+$` (`auth.ts:18`) / unicité insensible à la casse (`schema.sql:56`). Mot de passe : `minLength 8` / ≥ 8, **pas de maximum** (`auth.ts:70`). Nom affiché : **— / — / —** (`LoginPage.tsx:163-168`, `auth.ts:77`, `schema.sql:51`) | **C** | Ouvert à des inconnus : email à vérifier (aujourd'hui un compte peut porter l'email d'un tiers, audit 03 §5.5) ; nom affiché ≤ 50 caractères, caractères de contrôle et de direction refusés ; mot de passe 8 à 128 |
| A2 | Code d'invitation | `.env` (`auth.ts:11-16`) | code partagé, réutilisable sans limite (P1) | **A** | Si l'offre reste sur invitation au lancement : codes en table, à usage compté et révocables, créés par un admin. Si l'inscription s'ouvre : supprimer le code et le remplacer par la vérification d'email |
| A3 | Connexion | `POST /api/auth/login` | 10 / min / IP | **C** | Chaque tentative, même sur un email inconnu, coûte un scrypt de 128 Mio (§3, O9) : ajouter une limite par email visé en plus de l'IP |
| A4 | Lier / délier Discord | `AccountMenu.tsx:41-62` → `discord.ts:85-108, 218-233` | liaison exige une session dès le départ ; déliaison refusée sans mot de passe | **L** | Garde-fous corrects : pas de rattachement par email (`discord.ts:13-15, 201-208`) |
| A5 | Déconnexion | `AccountMenu.tsx:66-72` → `auth.ts:127-130` | ne ferme que la session courante (Q6) | **L** + à compléter | Ajouter « déconnecter toutes les sessions » : un compte payant compromis doit pouvoir couper les autres appareils |
| A6 | Changer nom, email, mot de passe ; supprimer le compte ; exporter le compte | **n'existe pas** (routes de `auth.ts` complètes) | — | **L** (à créer) | Droits RGPD (audit 03 §5.5). Jamais derrière l'offre payante |
| A7 | Offre, rôle, statut d'abonnement | **n'existe pas** | — | **A** (écriture) | Écrit par l'admin ou par le webhook du prestataire de paiement, jamais par une route utilisateur |

### 2.2 Deck (propriétaire ; écrit par « Enregistrer » → `PUT /api/decks/:id`, sauf mention)

| # | Élément | Où | Bornes aujourd'hui | Décision | Justification |
|---|---|---|---|---|---|
| D1 | Créer un deck (vide, YDK, texte collé) | `ImportDialog.tsx:47-99` → `POST /api/decks` (`decks.ts:102-109`) | **nombre de decks : —** (P6 : 300 decks créés en 8,5 s, aucun refus) | **C + P** | Seul coût serveur réel (stockage, transactions). Quota par compte = levier naturel du freemium, calculable sans donnée nouvelle (`decks_owner`, `schema.sql:95`) |
| D2 | Importer une archive JSON (deck + bibliothèque) | `ImportDialog.tsx:78-95` → `POST /api/decks/import` (`decks.ts:110-117`) | 1 Mio ; listes de la bibliothèque **—** (`deckArchive.ts:26-58`) | **C** (compte dans le quota D1) | Portabilité : doit rester gratuit. Mais deux requêtes SQL par HOPT sous verrou de compte (`decks.ts:43, 63-67`) : Q4 mesure 88 s pour 20 000 HOPT (§3 O2). Borner chaque liste |
| D3 | Dupliquer | `HomePage.tsx:364-366` → `decks.ts:185-200` | — | **C + P** | Crée un deck : même quota que D1 |
| D4 | Supprimer | `HomePage.tsx:374-376` → `decks.ts:201-205` | `window.confirm` | **L** | Corriger la réponse 200 sur un deck d'autrui en 404 (P3), par cohérence avec DECISIONS.md:1254 |
| D5 | Nom du deck (éditeur, accueil) | `Header.tsx:47-51` ; `HomePage.tsx:288-294` → `PATCH` (`decks.ts:178-184`) | **— (aucun `maxLength`)** / ≤ 200 (`deckConfiguration.ts:212`, `decks.ts:180`) / — | **C** | Garder 200 ; ajouter `maxLength` côté client (aujourd'hui un nom trop long **arrête silencieusement les brouillons**, `deckStore.ts:241-243`) ; refuser les caractères de contrôle et de direction (P5 : `<img src=x onerror=alert(1)>` + U+202E accepté). Le contenu reste libre : React échappe tout (aucun `dangerouslySetInnerHTML` dans `web/src`) |
| D6 | Composition main / extra / side, copies | `CardTile.tsx:223-238` ; `ZoneCardTile.tsx:25-40` ; `AddCardDialog.tsx` | copies : bouton `+` bloqué à 3 / 1–3 (`deckConfiguration.ts:216`) / `check (copies between 1 and 3)` (`schema.sql:101`). **Nombre de cartes distinctes : — / — / —** (P5 : 1 000 cartes × 3 acceptées ; Q1 : ≈ 24 000 lignes acceptées) | **L** (règle) + **C** (borne de service) | Le contrat veut un constructeur libre, 40–60 en avertissement seulement (`docs/regles-metier.md:61-62`). Mais aucune borne de **représentation** n'existe, alors que le contrat en pose ailleurs (`CONDITION_MAX_*`, `MATCHUPS_MAX`, `deckConfiguration.ts:53-55, 93-95`). Question Q1 du §7 |
| D7 | Starters | mode Starter (`AnnotationGrid.tsx:172-175`) | ids positifs distincts, **nombre —**, **carte hors du deck acceptée** (`deckConfiguration.ts:222`) | **C** | Borner au nombre de cartes du main ; refuser un starter absent du main (le moteur l'ignore déjà, `engineModel.ts:58`) |
| D8 | Morte en premier / en second | `CardMenu.tsx:78-83` | idem D7 ; écriture en `includes` dans une boucle (`deckRepository.ts:43`) | **C** | Même borne. C'est cette liste qui a produit la requête de ≈ 10 min (§3 O2) |
| D9 | Paires (créer, désactiver, supprimer) | `AnnotationGrid.tsx:191-198` ; `ComboList.tsx:33-99` | A < B, pas de doublon ; **nombre —** ; note : pas d'UI, **chaîne non bornée** par l'API (`deckConfiguration.ts:227`) | **C** | Borner par le nombre de cartes du main ; note ≤ 500 caractères ou retirée du contrat tant qu'aucune UI ne l'écrit |
| D10 | Conditions ET / OU, valeur « au moins » | `ConditionEditor.tsx:47-127, 79-85` | profondeur 8, 64 feuilles (vérifiées **à l'enregistrement seulement**) ; `at_least` : `min=1` / ≤ 32 767 (`deckConfiguration.ts:105`) | **L** + **C** | Cœur de la valeur du produit : pas de paywall. `at_least` ≤ 3 suffit (convention 1–3 par zone) ; afficher les bornes 8 / 64 dans l'éditeur plutôt qu'à l'enregistrement |
| D11 | Importance non-engine (0–1) | `HandWall.tsx:117-125` | `range 0..1 step 0.05` / fini, 0..1 (`deckConfiguration.ts:190`) | **L** | Déjà borné, sans coût serveur |
| D12 | Requêtes enregistrées (nom, critères min / max, sujet) | `QueryMode.tsx:135-153, 202-283` | nom : **— / — / —** (P5 : 100 000 caractères acceptés) ; nombre **—** ; sujet : **clés libres stockées** (P5 : `subject.libre` relu tel quel, `deckConfiguration.ts:197-203` ne fait pas de `knownKeys`) ; min > max : enregistrable côté UI (`QueryMode.tsx:141-148`, `deckStore.ts:567-575`) puis **refus de tout enregistrement du deck** (`deckConfiguration.ts:199`) | **C + P** | `knownKeys` sur le sujet ; nom ≤ 80 ; refuser min > max au clic « enregistrer » ; nombre : 3 par deck en gratuit, 20 en payant (proposition) |
| D13 | Vue du panneau (`statsView`) | `StatsPanel.tsx:125-150` | chaîne ; doit être `starts`, `nonengine` ou une étiquette du compte (`deckArchive.ts:71`) | **L** | Déjà vérifiée côté serveur ; transitoire depuis 9B (docs/PLAN.md:19) |
| D14 | Notes du deck | **pas d'UI** (état `deckStore.ts:23`, contrat `deckConfiguration.ts:251`) | **— / — / —** (P5 : 900 Kio acceptés) | **C** | ≤ 10 000 caractères, ou retirer du contrat tant qu'aucune UI ne l'écrit |
| D15 | Adversaires (nom, ordre) | `SidePlanner.tsx:252-271, 324-353` | nom `maxLength 200` / ≤ 200 / `check length between 1 and 200` (`004-side-plans.sql:21`) ; ≤ 32 par deck (`deckConfiguration.ts:55, 148`) | **P** | Fonction de l'étape 10, déjà bien bornée (32 = représentation, usage 6–7, docs/etape-10.md:41) |
| D16 | Plans de side : listes sortantes / entrantes, note | `SidePlanner.tsx:380-547, 423-430` | listes 1–3 copies, sans doublon (`deckConfiguration.ts:124-140`) ; **note : — / — / —** (`<textarea>` sans `maxLength`, `deckConfiguration.ts:173`, `004-side-plans.sql:35`) ; un bloc trop haut n'est pas coupé et déborde de la page PDF (`sideSheetPdf.ts:73-88`) | **P** + **C** | Note ≤ 500 caractères, alignée sur ce que la fiche peut imprimer |
| D17 | Export YDK / JSON | `HomePage.tsx:367-372` → `lib/exportDeck.ts` | local | **L** | Portabilité (RGPD art. 20) : jamais payant |
| D18 | Comparateur à l'écran | `ComparePage.tsx:452-484` | lecture seule, deux decks du compte | **L** | Fonction phare mais calculée dans le navigateur : aucun coût serveur |
| D19 | Export Excel du comparateur | `ComparePage.tsx:141-147` → `lib/exportComparison.ts:348-359` | local ; aucune cellule issue d'un texte utilisateur n'est une formule (`exportComparison.ts:63`) | **P** | Livrable « pro » (préparation de tournoi, partage d'équipe) sans coût serveur |
| D20 | Comparateur sur un deck sidé, fiche imprimable, PDF | `/compare/:a/:b` avec `deck~adversaire~position` (`lib/comparison.ts:91`) ; `SideSheet.tsx:187-195` → `lib/sideSheetPdf.ts` | PDF : une requête au relais d'images par carte (`sideSheetPdf.ts:208-252`) | **P** | Seule fonction qui fait travailler le serveur **et** un tiers (CDN, audit 03 B1) : à réserver et à limiter en débit |

### 2.3 Bibliothèque du compte (écriture immédiate, `/api/library/*`)

| # | Élément | Où | Bornes aujourd'hui | Décision | Justification |
|---|---|---|---|---|---|
| B1 | HOPT d'une carte | mode HOPT (`AnnotationGrid.tsx:168-171`) → `PUT /library/flags/:cardId` | booléen (`library.ts:56`) ; **n'importe quel passcode positif**, nombre **—** | **L** + **C** | Annotation personnelle sans coût. Borne : passcode ≤ 12 chiffres, comme le relais (`cardImage.ts:11`), au lieu de tout entier sûr (`deckConfiguration.ts:75`, P5 : 9 007 199 254 740 991 accepté) |
| B2 | Étiquettes non-engine : créer, supprimer | `ComboList.tsx:167-202` → `library.ts:102-119` | nom : **— / ≤ 200 / —** ; nombre **—** (P6 : 500 en 9,2 s) ; **UUID fourni par le client** accepté (`library.ts:108`) ; suppression sans confirmation (`ComboList.tsx:176-181`) | **C + P** | UUID généré par le serveur seulement (§3 O5) ; 2 de base + 3 personnelles en gratuit, illimitées en payant (proposition) — c'est l'axe « catégories personnalisées » du §5 |
| B3 | Affecter / retirer une étiquette | mode Non-engine (`ModeBar.tsx:63-122`) → `library.ts:121-136` | étiquette du compte vérifiée en SQL | **L** | Borné de fait par B2 |
| B4 | Profil de disponibilité | mode Profil (`ModeBar.tsx:126-174`) ; `CardMenu.tsx:97-110` → `library.ts:57, 73-78` | énumération de 4 valeurs (`deckConfiguration.ts:4`, `002-profiles-and-conditions.sql:22`) ; exige une étiquette | **L** | Déjà fermé |
| B5 | Plafonds partagés : créer, limite, supprimer | `ComboList.tsx:209-293` → `library.ts:140-177` | nom : **— / ≤ 200 / 1..200** ; limite : `min=1` / 1..32 767 / `>= 1` ; UUID client accepté (`library.ts:155`) ; **un `PATCH` par frappe**, et vider le champ envoie 1 (`ComboList.tsx:244-246`) | **C** | Limite ≤ 6 : une main observée compte au plus 6 cartes (docs/architecture.md:28, contexte second = 5 + 1), au-delà la valeur ne change rien ; UUID serveur ; envoi au `blur` |

### 2.4 Réglages du navigateur (jamais envoyés au serveur)

| # | Élément | Où | Décision | Justification |
|---|---|---|---|---|
| N1 | Premier / second | `Header.tsx:73-81` ; `HandWall.tsx:84-91` → `deckStore.ts:591-593` | **L** | Aucun effet serveur |
| N2 | Critères de requête en cours, chargement d'une requête | `QueryMode.tsx:68-80, 202-283` | **L** | Transitoire |
| N3 | Mur de mains : « Nouvelles mains », n ∈ {30, 60, 120, 240}, tri, filtre | `HandWall.tsx:94-146` | **L** | Borné par la liste fermée |
| N4 | Mode d'annotation, repli des zones, position du plan | `AnnotationGrid.tsx:42-96, 234-239` ; `SidePlanner.tsx:333-341` | **L** | |
| N5 | « Noms des cartes » sur la fiche | `SideSheet.tsx:27-54` (localStorage) | **L** | |
| N6 | Brouillon IndexedDB (reprendre, ignorer) | `EditorPage.tsx:113-124` ; `lib/draft.ts:10-16` | **L** | Purgé à la déconnexion (`lib/auth.tsx:78`) |

### 2.5 Caches écrits par le client

| # | Élément | Où | Bornes aujourd'hui | Décision | Justification |
|---|---|---|---|---|---|
| K1 | Aperçu d'un deck (`decks.summary`) | `HomePage.tsx:62` → `PUT /decks/:id/summary` (`decks.ts:141-153`) | forme, probabilités dans [0, 1], `mainSize` = main enregistré (`deckSummary.ts:18-31`). **Contenu non vérifiable** : P5 enregistre `startRateFirst: 1, brickRate: 0` avec `engineVersion: "n-importe-quoi"`, relu tel quel par `GET /api/decks` | **C** (interne) | Acceptable tant que seul le propriétaire le voit. **Ne jamais** l'afficher à un tiers ni l'utiliser pour un classement : un deck partagé se recalcule chez celui qui le regarde (§5) |
| K2 | Chiffres d'un plan de side | `SidePlanner.tsx:185-199` ; `SideSheet.tsx:179-186` → `decks.ts:157-177` | idem, empreinte opaque (`deckSummary.ts:48-57`) | **C** (interne) | Même règle que K1 |

### 2.6 « Paramètres du moteur »

Le moteur n'a **aucun paramètre libre côté serveur** : il tourne dans le navigateur et ses entrées dérivent du deck et de la bibliothèque (`lib/engineModel.ts:43-135`). Les « paramètres » manipulables sont donc les annotations ci-dessus, vues sous l'angle du coût.

| # | Entrée du moteur | Dérivée de | Bornes aujourd'hui | Décision | Justification |
|---|---|---|---|---|---|
| M1 | `deckSize` | somme des copies du main (`engineModel.ts:45`) | commentaire « 40..60 (§D) » **non appliqué** (`engine/types.ts:92`) ; seul refus : issues au-delà de l'entier sûr (`enumerate.ts:128-136`) | **C** | Un main de 1 000 cartes est calculé, seconde passe comprise ; à 1 200, seule la seconde passe est refusée, par précision entière (O7). Aujourd'hui, c'est la précision qui fait office de limite. Borne à fixer avec la question Q1 |
| M2 | Nombre de types suivis `n` | cartes du main annotées : starter, paire active, étiquette, carte requise par une condition (`engineModel.ts:57-72`) | **—** | **C** | Coût exponentiel mesuré : 13 types × 3 copies = 109 ms ; 30 starters à une copie = 5,7 s ; 40 = 50,3 s (O7). Il faut une garde d'estimation **avant** le calcul (confirmation ou refus annoncé), jamais une troncature ni une simulation cachée (`docs/regles-metier.md:76-81`). Question Q2 |
| M3 | Catégories, plafonds, conditions | bibliothèque et deck | conditions 8 / 64 ; catégories **—** (boucle par catégorie à chaque issue, `enumerate.ts:173`) | **C** | Bornées par B2 et D10 |
| M4 | Contexte premier / second | N1 | énumération fermée (`enumerate.ts:106-110`) | **L** | |

### 2.7 Catalogue

| # | Élément | Où | Bornes aujourd'hui | Décision | Justification |
|---|---|---|---|---|---|
| G1 | Contenu (`cards`, `catalog_version`) | aucune route d'écriture (`cards.ts:17-66` : trois `GET`) ; scripts `migrate-cards.ts`, `prune-stale-cards.ts`, `adopt-legacy.ts` en shell | déjà hors de portée de l'utilisateur | **A** | À conserver hors de l'API. Si une interface admin est ajoutée, elle déclenche les scripts existants (simulation d'abord, `server/AGENTS.md:16`), elle n'écrit jamais `cards` directement |
| G2 | Lire le catalogue (recherche, ids) | `AddCardDialog.tsx` → `cards.ts:17-45` | recherche : `limit` ≤ 100 (`cards.ts:34`), **`limit=-1` → 500** « LIMIT must not be negative », **`limit=0.5` → 500** (P5) ; accès **anonyme possible** (§3 O1) | **C** | Réservé aux comptes (textes de Konami, audit 03 B2) ; `limit` entier 1..100 |
| G3 | Référencer un passcode absent du catalogue | `schema.sql:41-45` | voulu : cartes récentes (audit 03 §4.3) | **L** + borne B1 | |
| G4 | Relais d'images | `cards.ts:51-66` | passcode ≤ 12 chiffres ; **aucune limite de débit, aucun cache** ; accès **anonyme possible** (§3 O1) | **C** (+ **P** via D20) | Chaque appel = une requête du VPS vers YGOPRODeck, qui menace de bannir l'IP (audit 03 §2.1) |

### 2.8 Administration (aujourd'hui hors application)

| # | Élément | Où aujourd'hui | Décision |
|---|---|---|---|
| H1 | Codes d'invitation, offres | `.env.prod` + redémarrage (`deploy/README.md:50`) | **A** |
| H2 | Suspendre un compte, révoquer ses sessions | **n'existe pas** (seul `DELETE` de session : `session.ts:92-96`, pour soi) | **A** |
| H3 | Mise à jour du catalogue | shell VPS (`deploy/README.md:172-197`) | **A** |
| H4 | Migrations, sauvegardes, déploiement | `deploy/*.sh`, VPS seulement (AGENTS.md) | **A**, et **hors application** : aucune route ne doit les déclencher |

---

## 3. Portes ouvertes

Chaque porte : mécanisme dans le code, preuve exécutée, effet, correctif propre à ce dépôt. Les identifiants P1–P6 et Q0–Q9 renvoient aux sondes du §9. **Réserve sur les durées** : elles sont mesurées sous Docker Desktop (Windows), avec un aller-retour réseau par instruction SQL. En prod, l'app et la base partagent un réseau Docker : les durées absolues y seront plus courtes (non mesurées). Le **nombre d'instructions SQL par requête**, lui, ne dépend pas de l'environnement.

### O1 — La garde d'authentification se contourne en encodant un caractère du chemin · critique

- **Mécanisme.** La garde compare le chemin **brut** : `const path = req.url.split('?')[0]; if (!path.startsWith('/api')) return;` (`index.ts:42-43`). Le routeur de Fastify, lui, décode `%61` en `a`. `GET /%61pi/cards/search` saute donc la garde et atteint la route `/api/cards/search`.
- **Deux cas.**
  - Les routes de decks et de bibliothèque appellent `requireUser`, qui lève une exception (`session.ts:87-89`) : la requête tombe en 500, sans fuite de données.
  - Les trois routes du catalogue n'appellent **jamais** `requireUser` (`cards.ts:17-66`) : elles répondent.
- **Preuves.**
  - Sonde P2 : `/%61pi/decks` sans session → 500 `"requireUser appelé hors de la garde auth"` ; `/api/decks` → 401 ; `//api/decks`, `/API/decks`, `/api/auth/%2e%2e/decks` → 404.
  - Sonde Q7, sans session :

    | Chemin | Réponse |
    |---|---|
    | `/api/cards/search?q=audit` | 401 |
    | `/%61pi/cards/search?q=audit&limit=100` | **200**, cartes avec `description` |
    | `/%61pi/cards?ids=900000001,900000002` | **200** |
    | `/%61pi/cards/abc/image` | **400 « passcode invalide »** : le gestionnaire du relais est atteint |
    | `/%61pi/library`, `/%61pi/decks` | 500 |
  - **À travers Caddy.** Le bloc documenté (`deploy/README.md:75-79`) a été rejoué localement sur Caddy 2.11.4 (`reverse_proxy` vers l'API d'audit). `/%61pi/cards/search?q=audit` → 200 avec les cartes ; `/%61pi/decks` → 500. Le journal de l'API montre le chemin reçu encore encodé : `"url":"/%61pi/cards?ids=900000001"`.
- **Effet.** N'importe qui sur Internet, sans compte :
  - aspire le catalogue, noms et **textes d'effet de Konami** (audit 03 B2), sans limite de débit : 100 cartes par recherche (`cards.ts:34`), ou des listes entières de passcodes par `/cards?ids=` (sonde P5, avec session : 1 500 ids dans une URL de 9 014 caractères → 200 en 53 ms, `preuves-04/journal-serveur-extraits.txt`) ;
  - fait appeler le CDN de YGOPRODeck par l'IP du VPS, autant de fois qu'il veut (O6).

  Cela contredit la règle écrite « Public : `/api/health` et `/api/auth/*` uniquement » (DECISIONS.md:1214-1216 ; `server/AGENTS.md:9`).
- **Correctif.**
  - Décider sur la **route résolue** : lire `req.routeOptions.config` et déclarer une route publique par `config: { public: true }`, au lieu du préfixe de `req.url`.
  - Appeler `requireUser` dans les trois gestionnaires de `cards.ts`.
  - Ajouter une sonde `/%61pi/cards/search` → 401 à `server/tests/persistence.integration.ts`.

### O2 — Aucune borne sur la taille d'une configuration ; une instruction SQL par ligne · haute

- **Mécanisme.**
  - Le contrat ne borne ni `cards`, ni `starters`, ni `deadFirst` / `deadSecond`, ni `pairs`, ni le nombre de conditions (`deckConfiguration.ts:213-248`). L'archive ne borne aucune de ses listes de bibliothèque (`deckArchive.ts:26-58`). Seule limite : le corps de 1 Mio de Fastify, jamais réglé (`index.ts:26-29`).
  - L'écriture fait **un `insert` par ligne** : `deckRepository.ts:36-43` et `61-62` pour les decks, `decks.ts:63-78` pour l'import (deux requêtes par HOPT). Tout se passe dans une transaction qui verrouille le deck (`decks.ts:17`) ou le compte (`decks.ts:43`).
- **Preuves.**

  | Sonde | Requête | Taille | Résultat |
  |---|---|---|---|
  | P5 | `POST /api/decks` : 1 000 cartes × 3 + 1 000 starters | 46 Kio | 201 en 5,2 s |
  | Q1 | `POST /api/decks` : 23 514 lignes | 977 Kio | 201 en 60,9 s |
  | **P7a** | `PUT /api/decks/:id` : `deadFirst` de 158 729 passcodes | ≈ 1 Mio | transaction ouverte à 09:26:31 UTC, 158 729 lignes validées constatées à 09:36:43, soit **≈ 10 min** sur une connexion. Le client HTTP (délai par défaut d'undici) a abandonné à 300 s ; le serveur a continué jusqu'au bout |
  | Q4 | `POST /api/decks/import` : 20 000 HOPT | 107 Kio | 201 en 88,2 s. Une écriture de bibliothèque du même compte, lancée 1,5 s après, a attendu 86,7 s (verrou `users … for update`) |
- **Effet.** Une seule requête d'un compte gratuit occupe une connexion à la base pendant des minutes. Aucune borne de représentation ne protège le stockage.
- **Correctif.**
  - Bornes de représentation dans `parseConfiguration` et `parseArchive`, dans l'esprit de `MATCHUPS_MAX` et `CONDITION_MAX_*` (`deckConfiguration.ts:53-55, 93-95`). Valeurs : question Q1.
  - `bodyLimit` par route (§4.3).
  - Insertions en lot : un seul `insert … select from unnest($2::bigint[], …)` par table dans `writeConfiguration`.
  - `statement_timeout` et `idle_in_transaction_session_timeout` passés au `Pool` (`db.ts:12`).

### O3 — Un seul compte sature le pool de connexions de tous les autres · haute

- **Mécanisme.**
  - `new pg.Pool({ connectionString })` sans `max` (`db.ts:12`), donc 10 connexions (`node_modules/pg-pool/index.js:89`).
  - Chaque requête d'écriture en garde une pendant toute sa transaction (O2).
  - Aucune limite de débit ni de concurrence par compte (`index.ts:33`).
- **Preuve (Q2).**
  - Montage : le compte A envoie **12** `POST /api/decks` simultanés de 4 000 lignes (163 Kio). Pendant ce temps, B charge sa session en boucle (`GET /api/auth/me`, une requête SQL).
  - Requête seule : 8,7 s. En rafale : 10 requêtes finissent vers 16 s et 2 vers 28 s, qui ont attendu une connexion libre.
  - `/api/auth/me` de B : **11 ms avant, jusqu'à 16 126 ms pendant**.
  - La boucle d'événements reste réactive (94 ms au plus sur `/api/auth/providers`) : c'est le pool qui est saturé, pas le processus. Même constat en Q3 (6 000 paires, boucle ≤ 10 ms) : aucun blocage de boucle n'est retenu.
- **Effet.** Un utilisateur gratuit, avec un simple script, rend l'application inutilisable pour tous : connexion, chargement des decks, bibliothèque. La connexion elle-même lit la base (`auth.ts:107-111`).
- **Correctif.**
  - Les correctifs d'O2.
  - Une limite de concurrence d'écriture par compte (une écriture de configuration à la fois par `owner_id`).
  - Une limite de débit par compte (§4.3).

### O4 — Aucun quota, aucune limite de débit hors authentification · moyenne (levier du freemium)

- **Preuve (P6).** 300 `POST /api/decks` en 8,5 s, puis 500 `POST /api/library/categories` en 9,2 s : tous en 201.
- **Mécanisme.** `rateLimit` en `global: false` (`index.ts:33`), configuré sur trois routes seulement ; aucun compteur par compte (§1.1).
- **Correctif.** Quotas par offre (§4.2 à §4.4).

### O5 — Des identifiants choisis par le client dans des tables à clé globale · moyenne

- **Mécanisme.** `POST /api/library/categories` et `POST /api/library/groups` acceptent un `id` du client (`library.ts:104, 108, 147, 155`). Or `nonengine_categories.id` et `nonengine_groups.id` sont des clés primaires **globales** (`schema.sql:124` ; `002-profiles-and-conditions.sql:11`). Le client officiel envoie un `crypto.randomUUID()` (`deckStore.ts:173, 708, 793`), mais rien n'y oblige.
- **Preuve (P4).** B crée une étiquette avec l'UUID de celle de A : **500** `{"code":"23505","message":"duplicate key value violates unique constraint \"nonengine_categories_pkey\""}`. Même chose pour un plafond (`nonengine_groups_pkey`).
- **Effet.**
  - Un oracle d'existence d'identifiants entre comptes, contraire à « on ne révèle pas l'existence d'une ressource » (DECISIONS.md:1254).
  - Des 500 à la place de 400.
  - Les tables à clé `(deck_id, id)` ne sont pas concernées : paires, conditions, adversaires (`001-deck-configuration.sql:14`, `002-profiles-and-conditions.sql:41`, `004-side-plans.sql:23`).
- **Correctif.** Ignorer l'`id` reçu et laisser `gen_random_uuid()`. Le client relit déjà l'objet créé (`deckStore.ts:709, 794`).

### O6 — Relais d'images sans limite de débit ni cache, atteignable sans compte · haute

- **Mécanisme.** Chaque `GET /api/cards/:id/image` refait un `fetch` vers `images.ygoprodeck.com` (`cards.ts:56`), sans stockage et sans limite. Par O1, la route est atteignable anonymement : Q7 et la reproduction Caddy prouvent que le gestionnaire est atteint.
- **Effet.** Le CDN de YGOPRODeck annonce le bannissement d'IP en cas de volume (citations dans audit 03 §2.1). Un tiers peut faire bannir l'IP du VPS et casser les illustrations du PDF de tous les clients. Aucune requête n'a été envoyée au CDN pendant cet audit : le passcode invalide est rejeté avant tout appel sortant (`cardImage.ts:10-13`).
- **Correctif.**
  - Fermer O1.
  - Limite de débit par compte.
  - Relais avec cache disque persistant (audit 03, alternative A1).
  - Réserver le relais aux comptes qui ont la fiche (§4.2).

### O7 — Le moteur n'a aucune borne de coût · moyenne aujourd'hui, haute dès qu'un deck est partagé

- **Mécanisme.**
  - Énumération exacte par composition (`enumerate.ts:19-46`). `computeAll` y ajoute deux énumérations par type suivi pour les contributions marginales (`enumerate.ts:238-251`).
  - Le nombre de types suivis n'est pas borné (`engineModel.ts:57-72`).
  - La taille « 40..60 » n'est qu'un commentaire (`engine/types.ts:92`) ; seul refus : un nombre d'issues au-delà de l'entier sûr (`enumerate.ts:133-136`).
- **Preuve.** Moteur du dépôt importé tel quel sous Node 22 (script `engine-cost.mts`, §9), temps de `computeAll` sauf mention :

  | Deck | Temps |
  |---|---|
  | 13 types × 3 copies, main de 40 | 109 ms |
  | 20 types × 3 copies, main de 60 | 935 ms |
  | 20 starters à une copie, main de 40 | 255 ms |
  | 30 starters à une copie, main de 40 | 5 667 ms |
  | **40 starters à une copie, main de 40** | **50 285 ms** (premier seul : 1 769 ms ; second seul : 11 198 ms) |
  | Main de 1 000 cartes | accepté, deux passes disponibles |
  | Main de 1 200 cartes | premier disponible ; second « Ce tirage dépasse la précision entière prise en charge. » |
- **Effet aujourd'hui.** Le calcul tourne dans un Web Worker annulable du navigateur du propriétaire (docs/architecture.md:7) : **aucun coût serveur**. Mais un deck « highlander » annoté carte par carte est légitime et déjà lent.
- **Effet avec le partage (X2) ou la démo (X7).** Un deck piégé fait tourner le processeur du lecteur pendant des minutes.
- **Correctif.** Estimer le nombre de compositions avant de lancer le worker (produit des bornes de `enumerate.ts:37`) et demander confirmation au-delà d'un seuil mesuré. Jamais de résultat tronqué (`docs/regles-metier.md:76-81`). Question Q2.

### O8 — Les chiffres stockés sont falsifiables · faible aujourd'hui, bloquant pour le partage

- **Preuve (P5, Q9).** `PUT /api/decks/:id/summary` avec `startRateFirst: 1, brickRate: 0, engineVersion: "n-importe-quoi", computedAt: "2030-01-01T00:00:00Z"` → 200 ; `GET /api/decks` le relit tel quel.
- **Mécanisme.** Le serveur ne connaît pas le moteur et ne valide que la forme (`deckSummary.ts:1-4, 18-31`). La version attendue par le client est une chaîne publique du bundle (`__ENGINE_VERSION__`, AGENTS.md).
- **Effet.** Aucun tant que seul le propriétaire voit ses aperçus. Tout affichage à un tiers (partage, classement, « meilleur deck ») serait falsifiable.
- **Correctif.** Règle d'architecture à écrire dans `server/AGENTS.md` : un résumé stocké n'est **jamais** montré à un autre compte ; le lecteur recalcule.

### O9 — Chaque tentative de connexion anonyme coûte un scrypt de 128 Mio · moyenne

- **Mécanisme.** scrypt N = 2¹⁷, r = 8 (`password.ts:22-26`), exécuté aussi pour un email inconnu (`auth.ts:113-116`, voulu contre l'énumération). Seule protection : 10 tentatives par minute **par IP** (`auth.ts:101`).
- **Preuve.** `scrypt-cost.mts` (§9), fonctions du dépôt importées telles quelles, 12 cœurs :

  | Charge | Durée | Mémoire (RSS) |
  |---|---|---|
  | un hachage | 547 ms | — |
  | 4 vérifications simultanées | 1 353 ms | de 75 à **587 Mio** |
  | 16 vérifications simultanées | 4 728 ms | pic toujours 587 Mio : le pool libuv de 4 fils plafonne |
- **Effet.** Quelques IP suffisent à occuper en continu les 4 fils du pool libuv et ≈ 0,5 Gio de mémoire. La mémoire du VPS n'a pas été vérifiée.
- **Correctif.** Ajouter une limite par email visé et une limite de concurrence globale sur `/login` (file de 4) ; garder le hachage factice.

### O10 — Les erreurs internes sont renvoyées telles quelles · moyenne

- **Mécanisme.** Aucun `setErrorHandler` (grep sur `server/`) : Fastify renvoie `message` et `code` de toute exception.
- **Preuves.**

  | Sonde | Réponse renvoyée au client |
  |---|---|
  | P2 | 500 `"requireUser appelé hors de la garde auth"` |
  | P4 | 500 avec le nom de la contrainte SQL et le code `23505` |
  | Q9 | `GET /api/cards/search?limit=-1` → 500 `{"code":"2201W","message":"LIMIT must not be negative"}` |
  | Q9 | `limit=0.5` → 500 `{"code":"22P02","message":"invalid input syntax for type bigint: \"0.5\""}` (`cards.ts:34`) |
- **Réponse trompeuse, dans le même esprit.** `DELETE` du deck d'autrui → 200 `{ ok: true }` (Q9, deck de A relu intact) : `decks.ts:201-205` ignore le nombre de lignes supprimées.
- **Correctif.**
  - Un `app.setErrorHandler` qui garde les messages des `ConfigurationError` (400) et des erreurs à `statusCode` explicite, et renvoie « Erreur interne » pour le reste (détail dans le journal seulement).
  - `limit` validé en entier 1..100.
  - 404 si `rowCount = 0` sur `DELETE`.

### O11 — Textes et structures libres sans borne · moyenne

- **Preuves.**

  | Sonde | Champ | Accepté |
  |---|---|---|
  | Q8 | nom affiché | 102 400 caractères (201, relu en entier) ; renvoyé à chaque `GET /api/auth/me` (`auth.ts:137`) |
  | P5 | notes du deck | 900 Kio |
  | P5 | nom de requête enregistrée | 100 000 caractères |
  | P5 | sujet de critère | clé arbitraire `libre` stockée et relue (`deckConfiguration.ts:197`, pas de `knownKeys`) |
  | P5 | nom de deck | `<img src=x onerror=alert(1)>` + U+202E |
- **Autres champs sans borne.** La note de plan (`SidePlanner.tsx:423-430`, `004-side-plans.sql:35`) et la note de paire (`deckConfiguration.ts:227`).
- **Ce qui protège déjà.** React échappe tout ; aucun `dangerouslySetInnerHTML` dans `web/src`. Le PDF ramène le texte au Latin-1 (`sideSheetPdf.ts:39-52`). Les cellules Excel issues de textes ne sont jamais des formules (`exportComparison.ts:63`).
- **Effet.**
  - Stockage.
  - Réponses gonflées.
  - Une fiche PDF qui déborde : un bloc trop haut n'est pas coupé (`sideSheetPdf.ts:73-88`).
  - Avec le partage (X2), des noms trompeurs (inversion de direction) montrés à des tiers.
- **Correctif.** Bornes du §2, `knownKeys` sur `subject`, refus des caractères de contrôle et de direction dans les noms.

### O12 — Inscription : un code partagé et réutilisable, un email non vérifié · moyenne

- **Preuve (P1).** Quatre comptes créés avec le même code ; le 6ᵉ essai depuis la même IP → 429 « retry in 10 minutes ».
- **Mécanisme.** `inviteCodes().includes(invite_code)` (`auth.ts:64`) sans compteur d'usage ; regex d'email seule (`auth.ts:18, 67`).
- **Effet en freemium.** Un code qui fuit ouvre des comptes illimités, 5 par IP toutes les 10 minutes, avec l'email de n'importe qui.
- **Correctif.** A1 et A2 du §2.

### O13 — Ni liste des sessions, ni déconnexion globale · faible à moyenne

- **Preuve (Q6).** Deux sessions de C ; après déconnexion de la première, elle répond 401 et la seconde 200.
- **Mécanisme.** `destroySession` ne supprime que le jeton présenté (`session.ts:92-96`).
- **Effet.** Un compte payant compromis ne peut pas couper un appareil volé ; un admin ne peut pas suspendre un compte.
- **Correctif.** `DELETE /api/auth/sessions` (toutes sauf la courante) et le geste admin H2, tous deux par `delete from sessions where user_id = $1`.

### O14 — Des requêtes « simples » sont acceptées sur des routes à effet · faible

- **Preuve (Q5).** `POST /api/decks/:id/duplicate` avec `content-type: text/plain` et corps vide → **201** (deck dupliqué, 17 → 19 decks avec l'essai sans `content-type`). Avec `application/x-www-form-urlencoded` → 415.
- **Mécanisme.**
  - Le cookie est `SameSite=Lax` (`session.ts:35`).
  - « Lax » porte sur le **site**, pas sur l'origine. Or `tcg.scratchrecode.com` (goldfish), sur le même VPS et derrière le même Caddy, est le même site qu'`analysis.scratchrecode.com` (`deploy/README.md:15-23`).
  - Un formulaire HTML `enctype="text/plain"` posté depuis ce sous-domaine emporterait le cookie : c'est une requête simple, sans pré-vol CORS.
- **Effet.** Borné : il faut connaître l'UUID d'un deck. Seules les routes sans corps JSON sont concernées : `duplicate` (prouvé) et `logout`, de même forme mais non essayée en `text/plain` (`api.ts:118, 143-145`).
- **Correctif.** Exiger `content-type: application/json` ou un en-tête propre à l'app sur toute méthode non `GET`, ou refuser `Sec-Fetch-Site` ≠ `same-origin`.

### O15 — La validation du client est en retard sur celle du serveur · faible (ergonomie, mais c'est le « contraint avec validation »)

| Écart | Source |
|---|---|
| Une requête enregistrée avec min > max est acceptée par le bouton, puis **tout enregistrement du deck échoue** (« Intervalle inversé ») | `QueryMode.tsx:141-148` ; `deckStore.ts:567-575` ; `deckConfiguration.ts:199` |
| Un nom de deck de plus de 200 caractères **arrête silencieusement les brouillons** | `Header.tsx:47-51` ; `deckStore.ts:241-243` |
| Les bornes 8 / 64 de l'arbre ET / OU ne sont vues qu'à l'enregistrement | `deckConfiguration.ts:94-95` |
| La limite d'un plafond envoie un `PATCH` par frappe, et vider le champ envoie 1 | `ComboList.tsx:244-246` |

---

## 4. Modèle de rôles minimal et matrice des droits

### 4.1 Quatre rôles

| Rôle | Qui | Déterminé par (à créer, §4.4) | Aujourd'hui |
|---|---|---|---|
| **Anonyme** | Visiteur sans session valide | Absence de cookie `ygo_session` résolu (`session.ts:57-84`) | Existe, mais la garde se contourne (O1) |
| **Gratuit** | Compte à email vérifié, sans abonnement actif | `users.plan = 'free'` | Tout compte connecté, **sans aucune limite** |
| **Payant** | Compte à abonnement actif | `users.plan = 'paid'` et `plan_until > now()`, écrits par le webhook du prestataire de paiement ou par un admin | N'existe pas |
| **Admin** | Exploitant | `users.role = 'admin'`, attribué **en SQL ou en CLI seulement**, jamais par une route | N'existe pas (shell du VPS) |

Trois principes propres à ce code :

1. **L'admin gère des comptes, des offres et le catalogue ; il ne lit pas les decks.** Le calcul et les annotations sont des données personnelles de stratégie ; aucune fonction d'administration n'a besoin de leur contenu. Un accès « support » se fait à la demande écrite de l'utilisateur, par une procédure journalisée, pas par un droit permanent (minimisation, audit 03 §5.5).
2. **Le rôle admin porte sur un compte distinct**, avec une session courte : les sessions actuelles durent 30 jours glissants (`session.ts:7-10`), acceptable pour un joueur, pas pour un compte qui peut modifier les offres des autres.
3. **Rétrogradation sans perte ni blocage.** `PUT /api/decks/:id` réécrit la configuration complète (`deckRepository.ts:29-66`). Un contrôle naïf « adversaires interdits en gratuit » empêcherait un ancien abonné d'enregistrer la moindre copie dans un deck qui porte encore ses plans. Règle proposée : un enregistrement est accepté s'il **n'augmente** aucun compteur au-delà de `max(quota de l'offre, valeur déjà enregistrée)` ; les fonctions payantes restent consultables et exportables, pas modifiables.

### 4.2 Matrice des droits

✅ autorisé · ❌ refusé · les nombres sont les **quotas proposés** (§4.3, à trancher) · « borné » renvoie aux bornes de service du §2.

| Domaine | Action | Anonyme | Gratuit | Payant | Admin |
|---|---|---|---|---|---|
| **Accès** | Front statique, page de connexion, pages légales | ✅ | ✅ | ✅ | ✅ |
| | `GET /api/health` | ✅ `{ ok }` seul | ✅ `{ ok }` seul | ✅ `{ ok }` seul | ✅ détail catalogue (`index.ts:65-73`) |
| | S'inscrire (email vérifié ; code d'invitation si maintenu) | ✅ limite IP | — | — | — |
| | Se connecter (mot de passe, Discord) | ✅ limite IP **et** email | — | — | — |
| **Compte** | Lier / délier Discord, se déconnecter | ❌ | ✅ | ✅ | ✅ |
| | Déconnecter toutes ses sessions | ❌ | ✅ | ✅ | ✅ |
| | Modifier nom, email, mot de passe ; exporter ; supprimer son compte | ❌ | ✅ | ✅ | ✅ |
| | Voir son offre ; souscrire ; résilier | ❌ | ✅ | ✅ | — |
| **Catalogue** | Rechercher, résoudre des passcodes | ❌ | ✅ borné | ✅ borné | ✅ |
| | Vignettes par le relais du serveur | ❌ | ❌ (✅ si le relais devient un cache, audit 03 A1) | ✅ limite de débit | ✅ |
| | Mettre à jour le catalogue (`migrate`, `prune --apply`) | ❌ | ❌ | ❌ | ✅ CLI, simulation d'abord |
| **Decks** | Decks enregistrés (créer, importer, dupliquer) | ❌ | **3** | **100** | ✅ ses propres decks |
| | Composition, starters, morte, paires, conditions ET / OU | ❌ | ✅ borné | ✅ borné | ✅ borné |
| | Requêtes enregistrées | ❌ | **3 / deck** | **20 / deck** | idem payant |
| | Renommer, supprimer, exporter YDK / JSON | ❌ | ✅ | ✅ | ✅ |
| | Comparateur à l'écran | ❌ | ✅ | ✅ | ✅ |
| | Export Excel du comparateur | ❌ | ❌ | ✅ | ✅ |
| | Adversaires et plans de side | ❌ | **1 adversaire** (découverte) | **32 / deck** (`MATCHUPS_MAX`) | idem payant |
| | Fiche imprimable, PDF, comparateur sur un deck sidé | ❌ | ❌ | ✅ | ✅ |
| **Bibliothèque** | HOPT, affectations, profils | ❌ | ✅ borné | ✅ borné | ✅ |
| | Étiquettes personnelles | ❌ | **2 de base + 3** | **50** | idem payant |
| | Plafonds partagés | ❌ | **5**, limite 1–6 | **30**, limite 1–6 | idem payant |
| **Caches** | Écrire aperçu et chiffres de plan (ses decks) | ❌ | ✅ jamais montrés à un tiers | ✅ idem | ✅ idem |
| **Extensions (§5)** | Ouvrir un deck partagé en lecture | ✅ calcul chez le lecteur | ✅ | ✅ | ✅ |
| | Publier un lien de partage | ❌ | **1 lien actif** | ✅ | ✅ |
| | Historique des versions d'un deck | ❌ | dernière version | **30 versions** | idem payant |
| **Administration** | Codes d'invitation, offres promotionnelles | ❌ | ❌ | ❌ | ✅ journalisé |
| | Attribuer ou retirer une offre à la main | ❌ | ❌ | ❌ | ✅ journalisé |
| | Suspendre un compte, révoquer ses sessions | ❌ | ❌ | ❌ | ✅ journalisé |
| | Lire les métadonnées d'un compte (email, offre, nombre de decks, création, dernière session) | ❌ | ❌ | ❌ | ✅ |
| | Lire le contenu des decks d'un autre compte | ❌ | ❌ | ❌ | ❌ (procédure support, principe 1) |
| **Hors application** | Migrations, sauvegardes, restauration, déploiement | ❌ | ❌ | ❌ | shell du VPS seulement (AGENTS.md) |

### 4.3 Quotas et débits proposés (à trancher)

Aucun de ces nombres ne vient du code : ce sont des points de départ. Seuls ancrages existants : `MATCHUPS_MAX = 32` (`deckConfiguration.ts:55`), l'usage réel de 6 à 7 adversaires (docs/etape-10.md:41), les 2 étiquettes de base (`account.ts:10-13`), le contexte second limité à 6 cartes observées (docs/architecture.md:28).

| Limite | Gratuit | Payant | Pourquoi ce niveau |
|---|---|---|---|
| Decks enregistrés | 3 | 100 | 3 = un deck principal, une variante, un deck à comparer : le comparateur reste utilisable en gratuit |
| Écritures API (decks, bibliothèque) | 60 / min / compte | 300 / min / compte | P6 : 300 decks en 8,5 s aujourd'hui, sans refus |
| Relais d'images | — | 120 / min / compte | Une fiche de 7 adversaires appelle le relais une fois par carte distincte des plans (`sideSheetPdf.ts:208-252`) |
| Recherche du catalogue | 60 / min | 120 / min | Recherche au fil de la frappe, avec délai (`AddCardDialog.tsx:30-46`) |
| Corps de requête | 256 Kio sur `PUT/POST /api/decks`, 64 Kio sur `/api/library/*` et `/api/auth/*` | idem | Q1 : 977 Kio acceptés aujourd'hui ; un deck réaliste pèse quelques Kio (P5 : 1 000 cartes × 3 + 1 000 starters = 46 Kio) |

### 4.4 Où l'implémenter dans ce code

1. **Migration additive `db/migrations/005-accounts-plans.sql`** : `users.role` (`'user' | 'admin'`, défaut `'user'`), `users.plan` (`'free' | 'paid'`), `users.plan_until`, `users.email_verified_at` ; table `invite_codes` (empreinte du code, `max_uses`, `used`, `expires_at`) si les invitations restent. Montage dans `docker-compose.yml` et `deploy/docker-compose.prod.yml`, rejeu dans `run_migration_sequence` de `deploy/lib.sh` avant 003 (règle d'AGENTS.md, Pièges) ; ajouter un montage recrée le conteneur `db` au déploiement suivant (même source).
2. **Session** : ajouter `role`, `plan`, `plan_until` à `SessionUser` (`session.ts:13-17`) et à la requête de `resolveSession` (`session.ts:64-69`). Une seule requête, déjà faite à chaque appel.
3. **Garde** (`index.ts:41-48`) : décider sur la **route résolue** et non sur `req.url` (O1). Déclarer le caractère public dans la route (`config: { public: true }`) et le lire dans le hook via `req.routeOptions.config` ; ajouter `requireUser` dans `cards.ts` comme dans `decks.ts` et `library.ts`. Routes d'administration dans un plugin `/api/admin/*` avec un `preHandler` `requireRole('admin')`, **hors** du préfixe `/api/auth/` qui est exempté de la garde.
4. **Droits par offre** : un module pur `server/src/domain/entitlements.ts` (quotas par offre, fonction « cet enregistrement augmente-t-il un compteur ? »), sans dépendance Node, importé par le web comme `deckConfiguration.ts` l'est déjà (`web/src/lib/deckConfiguration.ts`, règle d'AGENTS.md). Contrôles dans `decks.ts:102-117` (création, import : comptage sous `select … from users … for update`, verrou déjà utilisé par `library.ts:24` et `decks.ts:43`), `decks.ts:185-200` (duplication), `decks.ts:118-137` (règle de non-augmentation), `library.ts:102-112` et `144-159` (étiquettes, plafonds).
5. **Débits par compte** : `@fastify/rate-limit` accepte `keyGenerator` et `hook` (`node_modules/@fastify/rate-limit/types/index.d.ts:125, 137`) ; une clé `req.user.id` suppose un hook postérieur à la garde.
6. **Interface** : ajouter l'offre à `AuthUser` (`web/src/lib/api.ts`, `/api/auth/me`) pour griser Excel, la fiche et les plans au-delà du quota. Le client n'est jamais la barrière : il valide déjà en local avec `parseConfiguration` (`web/src/lib/deckConfiguration.ts:23-31`), le serveur revalide tout.

---

## 5. Axes d'extension produit qui découlent du code existant

Chaque axe part d'un mécanisme déjà présent. La colonne « prérequis » renvoie aux portes du §3 à fermer **avant** d'ouvrir l'axe à des inconnus.

| # | Axe | Ce qui existe déjà | Gratuit | Payant | Prérequis |
|---|---|---|---|---|---|
| X1 | **Étiquettes personnalisées** | Étiquettes par compte, 2 fournies de base (`account.ts:10-13`) ; elles portent les axes des critères `category` / `group` (`deckConfiguration.ts:201-203`) et le comptage par catégorie du moteur (`enumerate.ts:173`) | Les 2 de base + 3 | Illimitées (≤ 50) ; **jeux d'étiquettes** exportables et importables sans deck | O5 (UUID serveur), borne B2. À trancher avant d'investir : le moteur ne compte une carte non-engine que si elle a un profil **et** une étiquette (`evaluate.ts:179`), couplage qui rend l'étiquette obligatoire même quand elle ne sert à rien. Aujourd'hui, importer une bibliothèque exige d'importer un deck (`decks.ts:110-117`) |
| X2 | **Partage de deck en lecture** | Le partage existe par fichier : archive JSON v2 complète, deck **et** sous-ensemble de bibliothèque (`exportDeck.ts:30`, `deckArchive.ts:3-15`), réimportable avec refus des conflits (`decks.ts:42-81`) ; décision explicite « le partage passe par l'export / import JSON » (`schema.sql:106-108`, DECISIONS.md:1240-1246) | 1 lien actif, lecture seule | Liens illimités et révocables ; « copier dans mon compte » (soumis au quota) ; comparer son deck à un deck partagé | Le lien doit servir une **archive figée** (même forme que `buildDeckJson`) : la bibliothèque étant par compte, un lecteur qui recalcule avec la sienne obtiendrait d'autres chiffres. Le lecteur **recalcule** : jamais d'aperçu stocké affiché (K1, O8). Bornes du moteur obligatoires (M1, M2), sinon un deck partagé bloque le navigateur du lecteur (O7). Jeton en table, haché comme les sessions (`session.ts:25-26`). Noms nettoyés (D5) |
| X3 | **Historique des versions** | `decks.revision` et `expectedRevision` → 409 (`001-deck-configuration.sql:5`, `decks.ts:121-126`) ; chaque enregistrement écrit la configuration complète dans une transaction (`decks.ts:124-136`) ; format canonique `readConfiguration` (`deckRepository.ts:5-27`) ; brouillon local (`lib/draft.ts`) | Revenir au dernier enregistrement | 30 versions ; restaurer ; comparer deux versions dans le comparateur (`compareDecks`, `engine/compare.ts:259`, prend deux modèles quelconques) | Table `deck_versions (deck_id, revision, configuration jsonb, created_at)` écrite dans la même transaction que `PUT /api/decks/:id`, avant `writeConfiguration`. Limite explicite dans l'interface : la bibliothèque (HOPT, profils, plafonds) est au compte (`docs/regles-metier.md:31-32`), une version ne la restaure pas. Borne de taille (O2), sinon 30 versions × 1 Mio |
| X4 | **Plans de side et fiche** | Étape 10 complète : adversaires, plans, chiffres, fiche, PDF, comparateur sidé (docs/PLAN.md:29-32) | 1 adversaire, sans fiche | Jusqu'à 32 adversaires, fiche PDF, comparateur sidé | O6 : le relais d'images doit devenir un cache (audit 03 A1) avant d'ouvrir le PDF à plus de monde ; note de plan bornée (D16) |
| X5 | **Comparateur** | Matrices côte à côte, deltas, export Excel à données identiques (docs/PLAN.md:17) | À l'écran | Export Excel | Aucun : calcul et export dans le navigateur |
| X6 | **Modèles d'annotation publiés** | Les annotations sont manuelles et au compte (`docs/regles-metier.md:29-32`) ; la fusion d'une bibliothèque importée refuse déjà toute contradiction (`decks.ts:56, 65, 72-73`) | Importer un modèle officiel (profils et HOPT des handtraps courants) | Modèles d'équipe | Rôle **admin** pour publier. Compatible avec « aucun rôle déduit du nom ou du texte » (`regles-metier.md:29`) : l'import reste un geste explicite de l'utilisateur |
| X7 | **Démo sans compte** | Le moteur tourne dans le navigateur (docs/architecture.md:7) : un deck de démonstration ne coûte rien au serveur | ✅ anonyme | — | Données de la démo embarquées dans le front (le catalogue reste réservé aux comptes, G2) ; bornes M1 / M2 |
| X8 | **Équipes (écriture partagée)** | Rien : un deck a **un** propriétaire (`schema.sql:81`), et « d'autrui → 404 » est un principe (DECISIONS.md:1254) | — | Deck d'équipe avec droits lecture / écriture | Hors du modèle minimal : demande une table de membres et de revoir la sémantique 404. À ne pas mélanger avec X2 |

---

## 6. Ordre de correction

### P0 — avant d'ouvrir l'app à un seul inconnu

| Action | Ferme | Fichiers | Preuve de fermeture attendue |
|---|---|---|---|
| Garde décidée sur la route résolue ; `requireUser` dans `cards.ts` | O1, O6 (accès anonyme) | `server/src/index.ts:41-48`, `server/src/routes/cards.ts` | `/%61pi/cards/search` → 401, en test d'intégration **et** à travers Caddy |
| `setErrorHandler` générique ; `limit` entier 1..100 ; `DELETE` → 404 si rien supprimé | O10 | `server/src/index.ts`, `cards.ts:34`, `decks.ts:201-205` | Q9 rejouée : aucun `code` SQL dans une réponse |
| `id` client ignoré pour les étiquettes et les plafonds | O5 | `library.ts:102-112, 144-159` | P4 rejouée → 201 avec un nouvel UUID |
| Bornes de représentation (Q1) + `bodyLimit` par route + `statement_timeout` / `idle_in_transaction_session_timeout` | O2 | `server/src/domain/deckConfiguration.ts`, `deckArchive.ts`, `server/src/db.ts:12`, déclaration des routes | P7a, Q1, Q4 rejouées → 400 ou 413 immédiat |
| Insertions en lot dans `writeConfiguration` et `mergeLibrary` | O2, O3 | `server/src/domain/deckRepository.ts:36-62`, `decks.ts:63-78` | Q2 rejouée : `/api/auth/me` d'un autre compte reste sous 100 ms |
| Limite de débit et de concurrence d'écriture par compte ; limite du relais d'images | O3, O4, O6 | `server/src/index.ts:33`, `decks.ts`, `library.ts`, `cards.ts:51` | P6 rejouée → 429 au-delà du seuil |
| Inscription : codes en table à usage compté **ou** vérification d'email | O12 | `auth.ts:11-16, 52-95`, `discord.ts:34-38, 183` | P1 rejouée : le code épuisé est refusé |

### P1 — avant de facturer

| Action | Ferme / ouvre | Fichiers |
|---|---|---|
| Migration 005 (rôle, offre, email vérifié), session enrichie, plugin `/api/admin` | §4.1, §4.4 | `db/migrations/005-*.sql`, `session.ts`, `index.ts`, compose et `deploy/lib.sh` |
| Module pur `entitlements.ts` et contrôles de quota avec règle de non-augmentation | O4, §4.2 | `server/src/domain/`, `decks.ts:102-137, 185-200`, `library.ts:102-159` |
| Limite par email visé et concurrence bornée sur `/login` | O9 | `auth.ts:99-122` |
| Bornes des textes, `knownKeys` sur `subject`, refus des caractères de contrôle et de direction | O11 | `deckConfiguration.ts:160, 173, 195-203, 212, 227` ; `auth.ts:77` |
| Déconnexion globale ; suspension par un admin | O13 | `session.ts`, `auth.ts` |
| Mutations exigeant du JSON ou un en-tête propre | O14 | `server/src/index.ts` (hook), `web/src/lib/api.ts:24-34` |
| Droits RGPD : modifier, exporter, supprimer son compte (audit 03 §5.5) | A6 | `auth.ts`, `AccountMenu.tsx` |

### P2 — avec les axes d'extension

| Action | Préalable à | Fichiers |
|---|---|---|
| Garde d'estimation du coût avant calcul (Q2) | X2, X7 | `web/src/worker/computeClient.ts`, `web/src/store/deckStore.ts` (planification du calcul), `web/src/engine/enumerate.ts:19-46` (en lecture : la formule d'estimation ne touche pas au moteur ni aux oracles) |
| Règle « un résumé stocké n'est jamais montré à un tiers » écrite dans le contrat | X2 | `server/AGENTS.md`, `docs/regles-metier.md` §1 |
| Validation du client alignée : requête min > max, nom > 200, bornes ET / OU affichées, `PATCH` au `blur` | O15 | `QueryMode.tsx:141-148`, `Header.tsx:47-51`, `ConditionEditor.tsx`, `ComboList.tsx:240-249` |

---

## 7. Questions à trancher

| # | Question | Pourquoi elle vous revient | Proposition |
|---|---|---|---|
| Q1 | Fixer une **borne de représentation** sur la composition, alors que le contrat dit « aucune nouvelle borne arbitraire n'est fixée ici » (`docs/regles-metier.md:79-81`) et laisse ouverte « la limite de coût des très grands decks » (`:401-402`) ? | Change le contrat métier §2 | Une borne de **service**, pas de légalité : 3 × les maxima du jeu (main ≤ 180 copies, extra et side ≤ 45), starters, cartes mortes et paires limités aux cartes présentes. Le repère 40–60 reste un avertissement |
| Q2 | Au-delà de quel coût estimé le calcul demande-t-il confirmation, et refuse-t-on un deck partagé trop coûteux ? | Arbitrage entre exactitude promise et confort ; le contrat refuse la troncature (`regles-metier.md:76-81`) | Seuil calé sur la mesure : confirmation au-delà de ≈ 5 s estimées (30 starters à une copie) ; pour un deck partagé, calcul à la demande seulement |
| Q3 | Lancement sur invitation ou inscription ouverte ? | Choix commercial ; conditionne O12 | Invitation à usage compté pour une bêta payante, puis email vérifié à l'ouverture |
| Q4 | Contenu des offres (§4.3) : 3 decks et 1 adversaire en gratuit sont-ils assez pour convertir sans frustrer ? | Choix produit, aucune donnée de marché dans le dépôt | Démarrer avec §4.3, mesurer, ajuster |
| Q5 | L'admin peut-il lire le contenu d'un deck ? | Confiance et RGPD | Non par défaut ; procédure support à la demande écrite, journalisée |
| Q6 | La fiche PDF reste-t-elle proposée tant que le relais n'est pas un cache (audit 03 A1) ? | Risque tiers, pas technique | Réservée au payant **et** limitée en débit ; cache avant toute campagne |
| Q7 | Le nom affiché devient-il visible par des tiers (partage X2, auteur d'un modèle X6) ? | Ouvre la modération | Si oui, borne de 50 caractères, caractères de direction refusés, signalement traité par un admin |

---

## 8. Non vérifié

Chaque point est un trou assumé :

1. **O1 en production.** La reproduction utilise Caddy 2.11.4 et le bloc de `deploy/README.md:75-79`. La version de Caddy de la pile goldfish et le Caddyfile réel du VPS n'ont pas été lus ; la prod n'a pas été interrogée (consigne). À vérifier par l'utilisateur : `curl -s -o /dev/null -w '%{http_code}' 'https://analysis.scratchrecode.com/%61pi/cards/search?q=ash'` (200 = porte ouverte ; 401 = fermée par le proxy).
2. **Durées en production** (O2, O3, Q4). Mesurées sous Docker Desktop (Windows), avec redirection de port. En prod, l'app et la base partagent un réseau Docker : durées plus courtes, ordre de grandeur inconnu. Le nombre d'instructions SQL par ligne et la taille du pool (10) ne dépendent pas de l'environnement.
3. **Mémoire et processeurs du VPS** : impact réel d'O9 et d'O3 inconnu.
4. **O14 dans un vrai navigateur.** L'envoi du cookie `Lax` sur un formulaire `text/plain` posté depuis `tcg.scratchrecode.com` découle de la définition de SameSite (site, pas origine) mais n'a pas été joué. Le fait que goldfish expose ou non du contenu contrôlable par un tiers n'a pas été examiné.
5. **Coût du moteur dans le navigateur.** Mesuré sous Node 22 (même moteur V8, sans Web Worker ni machine d'utilisateur réelle).
6. **Option `hook` de `@fastify/rate-limit`** : présente dans les types (`index.d.ts:137`), comportement non essayé.
7. **Parcours Discord** : non exercé (aucune application Discord configurée sur la pile d'audit).
8. **Inscriptions depuis plusieurs IP** : non testées ; la limite de 5 / 10 min est prouvée pour une seule IP.
9. **Quotas du §4.3** : aucune donnée de marché ni d'usage dans le dépôt ; ce sont des points de départ.
10. **Suppression en cascade d'un compte** : non rejouée ici (lecture des FK dans l'audit 03).
11. **Aspects juridiques** (RGPD, droits de Konami) : hors périmètre, voir audit 03.

---

## 9. Méthode, commandes, incidents, démontage

**Lectures.**
- Serveur complet : `server/src/**`.
- Schéma et migrations 001, 002, 004.
- Client : `web/src/lib/api.ts`, `ydk.ts`, `engineModel.ts`, `sideSheetPdf.ts`, `engine/enumerate.ts`, `engine/types.ts`, store, et les composants cités.
- Documentation : DECISIONS.md, `server/AGENTS.md`, `docs/regles-metier.md`, `docs/architecture.md`, `deploy/README.md`, audits 00 et 03.
- L'inventaire des contrôles de l'interface (§2) a été préparé par un agent de recherche en lecture seule ; chaque ligne citée dans ce document a été relue.

**Pile jetable** (jamais la base de dev, ni la prod) :

```bash
docker run -d --rm --name testhand-audit04-db --label purpose=testhand-audit04 --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=ygo -e POSTGRES_PASSWORD=audit04 -e POSTGRES_DB=ygo -p 127.0.0.1:55460:5432 postgres:17-alpine
# schema.sql puis 001 → 004 par stdin (psql -v ON_ERROR_STOP=1 -f -) ; 003 : « PURGE APPLIQUÉE … 0 ligne(s) »
# 2 cartes synthétiques : insert into cards (id,name,type,description) values (900000001,…),(900000002,…)
cd server && DATABASE_URL=postgres://ygo:audit04@127.0.0.1:55460/ygo PORT=8796 INVITE_CODES=audit04 \
  NODE_ENV=development COOKIE_SECURE=0 TRUST_PROXY=0 DISCORD_CLIENT_ID= DISCORD_CLIENT_SECRET= WEB_DIST= \
  node --import tsx src/index.ts
```

**Sondes** (scripts et sorties dans `preuves-04/`) :

| Fichier | Contenu |
|---|---|
| `probe04.mjs` → `probe04-P1-P6-stdout.txt` | P1 inscriptions et limite ; P2 variantes de chemin ; P3 isolation ; P4 collision d'UUID ; P5 valeurs absurdes ; P6 rafales ; P7a requête maximale (relevés dans `p7a-transaction.txt`) |
| `probe04b.mjs` → `probe04b-results.json` | Q0 comptes ; Q1 1 Mio de cartes ; Q2 saturation du pool ; Q3 paires ; Q4 import ; Q5 requêtes simples ; Q6 sessions ; Q7 accès anonyme par `/%61pi/` ; Q8 nom affiché ; Q9 relectures |
| `Caddyfile-reproduction` | `docker run --rm --name testhand-audit04-caddy -p 127.0.0.1:55461:80 -v …/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine`, puis `curl --path-as-is` sur `/%61pi/…` |
| `engine-cost.mts` → `engine-cost-resultats.jsonl` | Moteur importé tel quel (`node --import tsx`), aucune modification |
| `scrypt-cost.mts` → `scrypt-cost-resultat.json` | `hashPassword` et `verifyAgainstDummy` importés tels quels |
| `journal-serveur-extraits.txt` | Lignes du journal de l'API d'audit : erreurs, réponses de plus de 5 s, chemins `/%61pi/`, requête de 1 500 ids |

**Incidents, dans l'ordre.**

1. **Mon premier script de sondes a bouclé** : il recalculait la taille de la charge à chaque ajout (construction quadratique). Aucune requête n'était partie ; processus arrêté, construction corrigée, base vidée (`truncate users cascade`) et serveur relancé avant la vraie exécution. Seul le passage corrigé est retenu.
2. **P7a a dépassé le délai du client.** Le `fetch` de Node (undici) abandonne à 300 s d'attente d'en-têtes ; le serveur a poursuivi la transaction jusqu'à sa validation, observée dans PostgreSQL. D'où le relevé par `pg_stat_activity` et le passage à `node:http` sans délai pour la seconde série. P7b à P9 du premier script n'ont pas tourné : ils sont remplacés par Q1 à Q6.
3. **Scénario « réaliste » mal construit** dans le premier passage du moteur : 14 types × 3 copies dans un main de 40, refusé à juste titre par le moteur. Corrigé en 13 × 3 ; les deux lignes figurent dans `engine-cost-resultats.jsonl`.
4. **Docker Desktop s'est arrêté entre deux sessions de travail.** La base jetable, en `--rm` sur tmpfs, a disparu avec lui. Je l'ai relancé (il tournait au début de l'audit) et j'ai reconstruit la pile à l'identique : même schéma, mêmes migrations, et les deux cartes synthétiques insérées dès le départ. P1–P7a viennent de la première pile ; Q0–Q9, Caddy, scrypt et moteur de la seconde. Aucune commande n'a visé un autre conteneur.
5. **Exposition sur le réseau local.** L'API d'audit écoutait sur `0.0.0.0` (`server/src/index.ts:98`), donc joignable depuis le réseau local pendant les sondes. Elle ne portait que des comptes et des cartes synthétiques.

**Démontage.**
- Serveur d'audit arrêté (processus identifié par le port 8796).
- `testhand-audit04-db` et `testhand-audit04-caddy` arrêtés, donc retirés par `--rm`. `docker ps -a --filter label=purpose=testhand-audit04` ne renvoie plus rien.
- Aucune commande vers le VPS, la base de prod, la base de dev ou le CDN.
- Dépôt : seuls `docs/audit/04-permissions.md` et `docs/audit/preuves-04/` ajoutés.
