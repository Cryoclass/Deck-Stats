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

## Compte rendu 6B (7 septembre 2026)

### Infrastructure jetable

Conteneur `testhand-step6b-visual` (label `purpose=testhand-step6b`, `--rm`, données en
tmpfs) sur 127.0.0.1:**55434**, distinct du 55433 de la suite d'intégration ; schéma puis
migrations 001 et 002 rejoués **par stdin** (`docker exec -i … psql -f -`) ; 17 cartes
synthétiques (passcodes 90000001–90000017, images SVG inline en `data:` : aucune requête
réseau, captures déterministes) ; compte `step6b@example.test` créé par
`POST /api/auth/register` avec `INVITE_CODES` posé dans l'environnement ; serveur
`npx tsx src/index.ts` avec `DATABASE_URL`, `PORT=8790`, `APP_ORIGIN=http://localhost:5174`
(le `.env` racine n'écrase rien) ; Vite `WEB_PORT=5174 API_PROXY=http://localhost:8790`.
Pilotage par `playwright-core` 1.55.0 installé dans le scratchpad sur le Chromium 1169
du cache ; dix scripts de scénario (préparation, étape 4, contexte, menu, conditions,
import, mobile, bureau, garde de cibles, Q3) et 92 captures dans le scratchpad, **non
versionnés**. Le deck « Deck 6B » (40 cartes, 15 identités) est importé par collage puis
annoté avec les modes de l'interface (starters Alpha/Beta, combo Gamma+Delta, HOPT
Epsilon, étiquettes Handtrap / Board breaker, profils, condition Alpha → Target Xi) et
enregistré. Aucune base personnelle, aucun VPS, rien installé dans le projet.

### Point 3 — verdicts

| # | Point | Captures (scratchpad) | Verdict |
| --- | --- | --- | --- |
| 1 | Étape 4 | `02-etape4-calcul-initial` (« Calcul initial des statistiques… », grille sans delta ; worker ralenti à 3 s par réécriture du script servi par Vite, moteur intact) ; `02-etape4-recalcul-stale` (en-tête « 41 cartes », pastille « Recalcul… », bandeau « Statistiques de la version précédente (deck de 40 cartes) », colonnes, matrice et requête à opacité 0,45, stepper et menus vifs) ; `02-etape4-recalcul-termine` (retour à 1) ; `02-etape4-erreur-relance` (worker forcé en échec après annulation d'un calcul en cours : « Statistiques obsolètes : le recalcul a échoué — Uncaught Error: Échec forcé du worker (validation 6B) », bouton Relancer, anciennes statistiques atténuées) ; `02-etape4-apres-relance` ; `02-etape4-erreur-initiale` (sans résultat : « Le calcul a échoué — … Relancer » seul) ; `02-etape4-erreur-initiale-relancee` | Conforme |
| 2 | Deltas périmés (Q3) | `02-etape4-recalcul-stale` : ligne « −1 : −6.38% » à opacité 1 pendant le recalcul → écart au §6 ; après correction `02-q3-recalcul-stale-delta-attenue` et `02-q3-tuile-delta-stale` : 0,45, infobulle « version précédente, recalcul en cours », stepper à 1, retour à 1 après le calcul | Corrigé (Q3) |
| 3 | Réglage premier/second | `03-contexte-premier` / `03-contexte-second` : delta d'Alpha −6.38 % → −6.17 %, titre de matrice « … — Second · 5 cartes + pioche » avec colonne 5+, colonne active surlignée, infobulle du delta « contexte second » ; `03-mur-second-sixieme` : 60 mains de 6, sixième cerclée bleu avec badge « 6ᵉ », légende « sixième carte = pioche » ; `03-mur-premier` : mains de 5, sans légende | Conforme |
| 4 | Mode Profil | `04-mode-profil-menu` (Précoce, Flexible, Préparée, Board breaker, Retirer le profil) ; `04-mode-profil-flexible-skipped` (badges Fx sur Epsilon et Zeta, « 2 modif. · 1 sans étiquette, ignorée » après un clic sur Filler Lambda) ; badges Pc / Pp ensuite | Conforme |
| 5 | Menu ⋯ | `05-menu-sans-etiquette` (« poser d'abord une étiquette non-engine », aucune section plafond) ; `05-menu-etiquetee-sans-profil` (quatre profils + « Aucun » coché, aucune section plafond) ; `05-menu-profilee-sans-plafond` (« aucun plafond défini ») ; `05-combos-plafond-cree` ; `05-menu-plafond-propose` (« Mulcharmy · 2/tour ») ; badge « ? » ambre (`rgba(251,191,36)`) `05-tuile-kappa-badge-interrogation` | **Cassé** puis corrigé : choisir le plafond répondait 400 « Un plafond partagé exige un profil de disponibilité sur la carte » (message en en-tête, `05-grille-apres-plafond` avant correction). Après correction : badge « Pc· » avec infobulle « Profil Précoce · plafond « Mulcharmy » » (`05-tuile-eta-badge-plafond`), radio cochée (`05-menu-plafond-coche`), retrait du plafond qui garde le profil |
| 6 | Éditeur ET/OU | `06-mode-condition` (dépendante cerclée ambre, « ↑ requise en deck » sur Target Xi, marqueur ▤) ; `06-inventaire-condition-initiale` ; `06-inventaire-ou` (« ou… » → groupe OU avec « ＋ ou… ») ; `06-inventaire-et-ou-n` (« ＋ et… » → clause ET Starter Beta, ≥ 2 saisi, probabilités recalculées) ; `06-inventaire-derniere-feuille` (retrait de toutes les feuilles → section disparue, marqueur ▤ retiré : source inconditionnelle) ; `06-combos-condition-paire` (« requiert en deck : » sous Gamma + Delta, avec OU) | Conforme ; le texte « source inconditionnelle » n'apparaît jamais dans l'inventaire, qui ne liste que les sources conditionnées |
| 7 | Avertissement sans profil | `01-editor-annotated` : « 1 carte non-engine sans profil, non comptée dans le potentiel : Breaker Kappa. » ; « 4 cartes … » pendant l'annotation (`04-mode-profil-flexible-skipped`) | Conforme |
| 8 | Aperçu d'import (6A) | `07-import-apercu` (4 copies « → ramenée à 3 », lignes l.8 et l.9 non reconnues, en-tête `#side` l.11, passcode 12345678 inconnu conservé, bouton « Importer avec 3 copies maximum ») ; `07-import-main-vide` (« Importer quand même ») ; `07-import-aucune-carte` (erreur avec les trois lignes) ; `01-ajout-carte-max` (« ×3 · max », ligne désactivée) | Conforme |

**Défaut hors visuel corrigé** (point 5) : `PUT /api/library/flags/:cardId` avec
`group_id` seul échouait sur toute carte déjà profilée. Cause : `insert … on conflict do
update` — PostgreSQL évalue le CHECK `card_flags_group_requires_profile` sur la ligne
**proposée à l'insertion** (profil `null`, plafond renseigné) avant de détecter le conflit,
donc avant la branche `do update` qui aurait conservé le profil. Reproduit en SQL sur la
base jetable, corrigé dans `server/src/routes/library.ts` : pré-contrôle du profil
(envoyé, sinon celui enregistré) et ligne proposée qui respecte le CHECK ; la contrainte
SQL reste la garde finale. Test ajouté dans `persistence.integration.ts` (plafond seul sur
carte profilée → 200 ; `group_id: null` garde le profil ; profil nul + plafond → 400) ;
aucun test existant modifié. Le client (`setCardGroup`) est inchangé.

### Point 4 — mobile

Mesures à 360 px **avant** correction (script Playwright, `isMobile`, `hasTouch`) :

| Problème présumé | Mesure à l'écran | Verdict | Correction |
| --- | --- | --- | --- |
| Bandeau de mode sans retour à la ligne | Pas de débordement (scrollWidth = clientWidth) mais consigne écrasée en colonne étroite, pastille « 0 modif. » coupée sur deux lignes, « Terminer » 58×20 (`m360-avant-bandeau-condition`) | Confirmé (écrasement, cibles) | `flex-wrap`, consigne `flex-1`, compteur insécable, boutons du mode 32 px |
| En-tête de l'accueil sans retour à la ligne | scrollWidth 440 > 360, « + Nouveau deck » 73×60 sur trois lignes, « Comparer » 80×46 (`m360-avant-accueil`) | Confirmé | `flex-wrap`, libellés insécables, boutons 32 px, menu ⋯ 32×32 |
| Lignes de section de l'inventaire | 9 lignes mesurées à 360 / 390 / 768 : aucun débordement, aucune troncature du titre, aucun chevauchement titre/compteur (titre et compteur passent à la ligne, `m360-avant-inventaire`) | **Non confirmé** | Aucune |
| Stepper de la tuile ~20 px | 20×20 | Confirmé | 32×32 |
| Menu ⋯ de la tuile ~20 px | 26×20 | Confirmé | 32×32 |
| Aperçu d'import à deux colonnes | Dialogue de 406 px pour un viewport de 360 (largeur minimale des `<input type=file>`), contenu coupé à droite (`m360-avant-import`) | Confirmé | Une colonne sous 640 px, `min-w-0` |

Le plan comptait « six problèmes » sur cinq puces : stepper et menu ⋯ sont comptés
séparément. Autres cibles mesurées et corrigées par la même règle : Enregistrer 24 → 32,
sélecteur de contexte 21 → 25, ✕ des dialogues (import et ajout de carte) 13×24 → 32×32,
« Créer un deck vide » 16 → 24, menu ⋯ d'un deck 26×28 → 32×32, pied du dialogue d'import
en `flex-wrap` (le bouton « Importer le texte » se cassait sur deux lignes à 360).
Conservées (≥ 24 px) : onglets 24, boutons de mode 26, entrées de menu 28, lignes
d'inventaire 32. Conséquence assumée : le stepper (3 × 32 px) prend sa propre ligne, le
delta insécable et le menu ⋯ partagent la suivante, et la tuile impose 96 px de large
(78 avant) : 3 colonnes à 360 et 390, 7 à 768, 9 à 1440 (11 avant).

Mesures **après** correction (captures `m{360,390,768}-apres-*`, `01-editor-apres-corrections`) :

| Largeur | Débordement (accueil, éditeur, bandeau, inventaire, stats) | Stepper / ⋯ / ✕ / Enregistrer / Nouveau deck | Contexte | Delta | Colonnes |
| --- | --- | --- | --- | --- | --- |
| 360 | aucun | 32 / 32 / 32 / 32 / 32 | 25 | une ligne, non coupé | 3 |
| 390 | aucun | idem | 25 | idem | 3 |
| 768 | aucun | idem | 25 | idem | 7 |
| 1440 | aucun | idem | 25 | idem | 9 |

Le menu ⋯ ouvert reste dans le viewport aux trois largeurs (`m*-menu`) ; la matrice tient
sans ascenseur horizontal ; l'onglet Stats mobile empile les deux contextes (`m360-apres-stats`).
Comparateur et mur de mains : captures `m*-mur` pour mémoire seulement (étape 7).

### Preuves

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/test-quiet.mjs
$env:TEST_DATABASE_URL = 'postgres://step23:step23-disposable@127.0.0.1:55433/step23'
npm.cmd run test:integration -w server
```

Résultats : **164 tests web** (inchangés), **7 tests serveur**, **11 tests PostgreSQL**
(10 + 1 nouveau, conteneur 55433 recréé pour chaque passage) ; build vert avec
l'avertissement ExcelJS attendu ; conteneurs 55433 et 55434 arrêtés et supprimés.

Contrôle par mutation, chaque erreur volontaire détectée puis annulée (fichiers comparés
octet à octet à leur copie de référence) :

| Mutation | Garde qui échoue |
| --- | --- |
| S1 `library.ts` : ligne proposée sans le `case` (forme fautive) | `persistence.integration.ts` test 8 (plafond seul → 400) |
| S2 `library.ts` : pré-contrôle du profil neutralisé | `persistence.integration.ts` test 7 (plafond sans profil ni ligne accepté en silence) |
| M1 `CardTile` : stepper `h-5 w-5` | script de garde (scratchpad) : stepper 20×20 à 360 et 1440 |
| M2 `HomePage` : en-tête sans `flex-wrap` | script de garde : « + Nouveau deck » inatteignable (débordement) |
| M3 `ImportDialog` : `grid-cols-2` | script de garde : zone de fichier 111 px |
| M4 `AnnotationGrid` : tuile 78 px | script de garde : delta coupé (53 px pour 43) |
| M5 `ModeBanner` : sans `flex-wrap` | script de garde : bandeau déborde à 360 |
| M6 `CardTile` : delta jamais atténué | script Q3 : opacité 1 pendant le recalcul |

Les gardes M1–M6 sont des scripts Playwright du scratchpad, pas des tests du dépôt (Vitest
tourne en environnement `node`, sans DOM) : elles prouvent la validation de cette session,
pas une non-régression future.

### Limites et reports vers l'étape 7

- Aucun test React ni navigateur dans le dépôt ; les scripts et captures de 6B ne sont pas
  versionnés (rien installé dans le projet).
- Grille d'annotation moins dense sur bureau (9 colonnes à 1440 px au lieu de 11) : coût
  des cibles de 32 px ; à réévaluer si jugé gênant (grille plus dense sur pointeur fin).
- Comparateur et mur de mains hors périmètre ; raccourcis clavier affichés sur tactile
  inchangés.
- En dev, le navigateur journalise un 404 sur `/favicon.ico` (aucune icône servie) : sans
  effet, hors périmètre.
- L'éditeur ET/OU n'a toujours pas de mise en page dédiée pour un arbre plus profond que
  « ET de clauses, OU de feuilles ».

### Questions ouvertes (non tranchées silencieusement)

- Le ✕ du dialogue « Ajouter une carte » a été porté à 32 px par cohérence avec celui de
  l'import (même défaut, 13 px de large) bien qu'il ne figure pas dans la liste du plan.
- Le libellé « −1 : −6.38% » du delta est conservé tel quel ; une forme plus courte aurait
  permis une tuile plus étroite.
- La densité de la grille sur bureau (ci-dessus) est une conséquence acceptée, à confirmer.
