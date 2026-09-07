# Étape 6 — configuration, création et mobile

Résultat attendu (docs/PLAN.md) : même deck métier depuis création et import ; erreurs
explicites ; actions et sélections utilisables aux largeurs retenues. Cible : sections
1 et 2 du [contrat métier](regles-metier.md). L'étape est découpée en deux sessions :

- **6A, livrée le 7 septembre 2026** (tag `etape-6a-ok`) : points 1 et 2 ci-dessous,
  tolérances du parseur YDK et du constructeur, test d'équivalence création / import.
- **6B, à lancer dans une nouvelle session à partir de ce document** : points 3 et 4,
  validation visuelle au navigateur et mobile.

Aucun changement au moteur, aux oracles, à la migration 002 ni à deploy/ ; aucune base
personnelle, aucun VPS.

## Plan validé (7 septembre 2026)

### Constats de départ

- Le contrat §2 exige : quantité invalide ou cumul hors convention signalé sans
  réduction silencieuse ; import partiellement reconnu présenté avec décision
  explicite ; carte inconnue jamais transformée en carte neutre.
- Aucune largeur mobile n'était définie dans regles-metier.md ; la charte
  (design-system.md §6.3) ne connaît qu'un point de rupture, 1024 px.
- « Constructeur » couvre la création manuelle (ajout de carte, compteur de copies) et
  le passage import → API. Les tolérances de `buildEngineModel` sont toutes documentées
  et signalées dans l'interface depuis 5B ; elles ne changent pas.
- Outillage navigateur disponible sans rien installer dans le projet : Chromium de
  Playwright déjà en cache (`%LOCALAPPDATA%\ms-playwright\chromium-1169`), Chrome
  installé. `playwright-core` sera installé dans le scratchpad uniquement (6B).

### Point 1 — inventaire des tolérances silencieuses

Parseur YDK, [ydk.ts](../web/src/lib/ydk.ts) :

| # | Entrée acceptée | Ce que ça produisait | Décision |
| --- | --- | --- | --- |
| Y1 | Ligne non numérique (nom de carte, `12345678abc`) | Ignorée sans trace | Rapportée dans l'aperçu d'import, décision de l'utilisateur |
| Y2 | `0x10`, `1e7`, `+123`, `12.5` (coercition `Number`) | Passcodes 16, 10000000, 123, 12.5 (400 serveur) | Regex stricte `^\d+$`, sinon comme Y1 |
| Y3 | Passcode ≤ 0 | Ignoré sans trace | Comme Y1 |
| Y4 | 4 lignes ou plus d'un même passcode | Réduit à 3 silencieusement | Listé (« X : 4 copies ») ; import avec 3 copies seulement sur décision explicite (Q5) |
| Y5 | En-tête inconnu (`#side`, `!extra`) | Commentaire, cartes suivantes dans la zone précédente | Listé dans l'aperçu ; les autres `#…` restent des commentaires documentés |
| Y6 | Lignes avant tout `#main` | Main par défaut | Tolérance documentée |
| Y7 | Main vide avec extra/side | Erreur « Aucune carte dans le main deck » | Import avec avertissement (Q1 : deck vide permis) |
| Y8 | Passcode absent du catalogue | Carte créée sans nom ; échec de `cardsByIds` avalé | Conservée avec son passcode, listée « inconnue du catalogue » ; échec du catalogue signalé |

Collage de passcodes, `parsePastedIds` :

| # | Entrée acceptée | Ce que ça produisait | Décision |
| --- | --- | --- | --- |
| P1 | `0x 12345678` | Compte 0 devenait 1 copie | Ligne invalide, listée |
| P2 | `5x 12345678` ou cumul de lignes > 3 | Réduit à 3 silencieusement | Comme Y4 |
| P3 | `3 12345678` (sans x) | Ignorée, contrairement au commentaire du code | Prise en charge documentée (compte 1–2 chiffres, passcode ≥ 4 chiffres) |
| P4 | `3x 123` et toute ligne non reconnue | Ignorée sans trace | Comme Y1 |
| P5 | `12345678 Ash Blossom` | Texte ignoré | Tolérance documentée dans le libellé du champ |

Constructeur et chaîne import → API :

| # | Entrée acceptée | Ce que ça produisait | Décision |
| --- | --- | --- | --- |
| C1 | `addCard` sur une carte déjà à 3 copies | Aucun effet, dialogue « ×3 → +1 » | Le store refuse avec motif ; dialogue « ×3 · max », ajout désactivé |
| C2 | `setCopies` hors 1–3 ou non entier | Réduit à 3 silencieusement | Refusé avec motif, sans réduction ; 0 = retrait documenté |
| C3 | 400 du serveur à la création (nom, passcode, quantité) | « Backend indisponible » | Message serveur affiché ; hors-ligne réservé au fetch qui rejette |
| C4 | JSON invalide avec message précis | Message générique | Message de `parseArchive` affiché |
| C5 | `GET /api/cards?ids=1e3,0x10,12.5` | Coercition, erreur SQL 500 possible | Identifiants stricts, 400 sinon |
| C6 | Extra et side non saisissables à la main | Seul le main est constructible | Q2 : laissé tel quel, limite consignée |

Tolérances de `buildEngineModel`, documentées et signalées, inchangées : paire à membre
absent inactive, cible de condition absente jamais satisfaite, condition sur une carte non
starter inerte, plafond supprimé ignoré, profil sans étiquette transmis à zéro, starter
retiré du deck conservé inerte.

### Point 2 — équivalence création / import

Test `web/src/lib/deckEquivalence.test.ts` : même deck métier construit à la main via
le store, par YDK (chemin réel `createDeckFromParsed` → document `POST /api/decks`) et
par JSON v2 ; les trois `buildEngineModel` sont identiques après mise en ordre canonique
du main (zone, passcode : l'ordre de relecture du serveur) ; les agrégats de `computeAll`
sont identiques sur le modèle non trié (l'ordre n'a aucun effet, contrat §2). Aucun tri
n'est ajouté dans l'éditeur pendant la saisie.

### Point 3 — validation visuelle au navigateur (6B)

Infrastructure sans base personnelle : conteneur PostgreSQL jetable dédié sur
127.0.0.1:55434 (distinct de 55433 réservé à la suite d'intégration), schéma puis
migrations 001 et 002 par stdin, quelques cartes synthétiques insérées dans `cards`,
compte de test créé par l'API d'inscription (`INVITE_CODES` de l'environnement). Serveur
lancé avec `DATABASE_URL` et `PORT=8790` dans l'environnement (le `.env` racine
n'écrase jamais une variable déjà définie), Vite sur 5174 avec `API_PROXY`. Pilotage par
`playwright-core` installé dans le scratchpad sur le Chromium en cache. Captures dans
le scratchpad, décrites ici.

Points contrôlés, avec capture ou description précise :

1. Étape 4 : bandeau « Recalcul… » et atténuation des colonnes après une mutation ;
   erreur avec relance (worker forcé en échec) ; calcul initial.
2. Deltas de la grille pendant l'état périmé : Q3 ci-dessous.
3. Réglage premier/second de l'en-tête : deltas, matrice, colonne active et mur qui
   suivent ; sixième carte cerclée « 6ᵉ » avec sa légende.
4. Mode Profil : déroulant des quatre profils, badge de profil sur la tuile, compteur
   « sans étiquette, ignorées ».
5. Menu ⋯ : profil, plafond proposé seulement à une carte profilée, badge « ? » ambre.
6. Éditeur ET/OU dans l'inventaire et sous une paire : « ou… », « ＋ ou… », « ＋ et… »,
   ≥ n, retrait de la dernière feuille.
7. Avertissement « N cartes non-engine sans profil » dans le panneau.

Correction uniquement de ce qui est cassé à l'écran.

### Point 4 — mobile (6B)

Largeurs validées : **360 px** (petit téléphone), **390 px** (téléphone courant),
**768 px** (tablette portrait, sous le point de rupture 1024). À ajouter à
docs/regles-metier.md en 6B. Cibles tactiles validées : **32 px** pour le stepper de
copies, le menu ⋯ et les actions primaires ; **24 px minimum avec espacement** pour le
reste (WCAG 2.5.8). Le comparateur et le mur de mains restent hors périmètre (étape 7).
Les raccourcis clavier affichés sur tactile restent tels quels (hors périmètre).

Problèmes repérés dans le code, à confirmer à ces largeurs avant correction :

- Bandeau de mode (`ModeBanner`, AnnotationGrid.tsx) sans retour à la ligne.
- En-tête de l'accueil (HomePage.tsx) sans retour à la ligne.
- Lignes de section de l'inventaire (Inventory.tsx) sans retour à la ligne, titre
  tronqué par le compteur.
- Pied de tuile (CardTile.tsx) : stepper et menu ⋯ d'environ 20 px de haut.
- Aperçu d'import sur deux colonnes (`grid-cols-2`) à 360 px.

### Réponses aux questions ouvertes (validation du 7 septembre 2026)

- **Q1** : import avec avertissement (contrat : deck vide permis). Appliqué en 6A.
- **Q2** : création manuelle limitée au main, laissé tel quel et consigné comme limite ;
  l'équivalence porte sur le modèle moteur (main).
- **Q3** (6B) : faire foi au §6 du contrat. S'il exige l'atténuation des résultats
  périmés, atténuer la ligne de delta quand `stale` est vrai et consigner dans
  DECISIONS.md la révision de la décision de l'étape 4 avec sa justification. S'il est
  muet, conserver l'étape 4 et corriger la formulation de PLAN.md. Citer le passage
  du §6 utilisé.
- **Q4** (6B) : largeurs 360 / 390 / 768 et cibles tactiles ci-dessus.
- **Q5** : import avec 3 copies après décision explicite dans l'aperçu. Appliqué en 6A.

## Compte rendu 6A (7 septembre 2026)

### Livré

- **Parseur** ([ydk.ts](../web/src/lib/ydk.ts)) : `parseYdk` et `parsePastedIds`
  renvoient un `ParseReport` : `deck` aux quantités **brutes** (4 copies restent 4),
  `ignored` (numéro et texte de chaque ligne non reconnue), `unknownHeaders`,
  `overLimit`. Passcode = entier décimal strict. `clampToConvention` est le seul geste
  de réduction, appelé après décision. Formes de collage reconnues : « 12345678 »,
  « 3x 12345678 », « 3 12345678 » (compte 1–2 chiffres, passcode ≥ 4 chiffres),
  texte après le passcode ignoré, lignes « # » et « ! » commentaires.
- **Aperçu d'import** ([ImportDialog.tsx](../web/src/components/ImportDialog.tsx)) :
  après analyse et résolution du catalogue, l'import est direct s'il n'y a rien à
  signaler ; sinon un écran « Vérifier l'import » liste main vide, quantités hors
  convention (« → ramenée à 3 si vous importez »), lignes non reconnues, en-têtes
  inconnus, passcodes inconnus du catalogue (conservés tels quels) et catalogue
  indisponible ; le bouton nomme l'ajustement (« Importer avec 3 copies maximum »).
  Aucune carte reconnue → erreur explicite avec les premières lignes ignorées.
- **Constructeur** : `addCard` et `setCopies` renvoient `false` avec motif dans
  `persistenceError` hors convention 1–3 ou non entier ; 0 reste un retrait. Le
  dialogue d'ajout affiche « ×3 · max » et désactive la ligne.
- **Erreurs explicites** : `createDeckFromParsed` rend le message d'un refus serveur
  (400) et ne dit « hors-ligne » que sur un fetch qui rejette ; `parseDeckJson` lève
  le message exact (`ConfigurationError` ou « Fichier JSON illisible ») au lieu de
  `null` ; `GET /api/cards?ids=` refuse en 400 tout identifiant non entier positif
  ([cardIds.ts](../server/src/domain/cardIds.ts), pur).
- **Équivalence** : `deckEquivalence.test.ts`, deux tests (modèles identiques après
  ordre canonique ; agrégats identiques sur le modèle non trié à 10⁻¹² près, les
  seaux `buckets` suivant l'ordre d'énumération).

### Preuves

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/test-quiet.mjs
# PostgreSQL jetable (deploy/configuration-v2.md)
$env:TEST_DATABASE_URL = 'postgres://step23:step23-disposable@127.0.0.1:55433/step23'
npm.cmd run test:integration -w server
```

Résultats : **164 tests web** (13 fichiers ; état de départ 150), **7 tests serveur**
(état de départ 6), **10 tests PostgreSQL** (inchangés, rejoués) ; build vert avec
l'avertissement ExcelJS attendu ; conteneur `testhand-step23-tests` (label
`purpose=testhand-step23`) arrêté et supprimé.

Nouveaux tests : `ydk.test.ts` (9 : Y1–Y6, P1–P5, aller-retour `toYdk`),
`deckEquivalence.test.ts` (2), `persistence.test.ts` (+3 : C1–C3),
`deckArchive.test.ts` (C4 : motifs exacts), `configuration.test.ts` (+1 : C5).

Contrôle par mutation, chaque erreur volontaire détectée par un test puis annulée :

| Mutation | Test qui échoue |
| --- | --- |
| `parseYdk` réduit à 3 en silence | `ydk.test.ts` Y4 |
| `parseYdk` ignore une ligne sans la rapporter | `ydk.test.ts` Y1 |
| `setCopies` borne à 3 au lieu de refuser | `persistence.test.ts` C2 |
| Le chemin YDK perd une copie avant `buildEngineModel` | `deckEquivalence.test.ts` |
| `parseCardIdList` coerce `1e3` en 1000 | `configuration.test.ts` C5 |

### Limites et reports vers 6B

- Aucun test React ni navigateur : l'aperçu d'import et le libellé « max » sont
  prouvés au niveau du parseur, du store et des messages ; à regarder en 6B avec les
  autres validations visuelles (l'aperçu à 360 px en fait partie).
- Y7 : un YDK sans aucune carte reconnue reste refusé (avec les lignes ignorées) ; un
  main vide avec extra/side est importé avec avertissement.
- C6 : la création manuelle n'ajoute qu'en main (limite consignée, Q2).
- Le comparateur et l'ancien contenu d'un brouillon ne sont pas concernés : un brouillon
  hors convention est déjà refusé par `validDraft`.

### Passation vers 6B

Lire ce document, docs/PLAN.md et docs/design-system.md, puis dérouler les points 3 et
4 avec l'infrastructure décrite (conteneur jetable dédié sur 55434, `playwright-core`
dans le scratchpad, jamais dans le projet). Ajouter les largeurs à regles-metier.md,
trancher Q3 en citant le §6, corriger uniquement ce qui est cassé, puis commit, tag
`etape-6-ok`, mise à jour de PLAN.md, section « étape 6, partie B » dans DECISIONS.md.
