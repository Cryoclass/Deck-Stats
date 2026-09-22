# Refonte des plans de side — le deck sidé au centre de l'éditeur

Statut : **plan validé le 22 septembre 2026** (réponses Q1–Q13 en fin de document) ; parties A à E livrées le
22 septembre 2026 (comptes rendus §12 à §16), chantier clos (§17). Rédigé le 17 septembre 2026 sans aucune ligne de code ni de test modifiée.
Prompt d'origine : [prompt-refonte-plans-de-side.md](prompt-refonte-plans-de-side.md).
Inventaire mené en lecture seule sur le dépôt (commit `471fadd`), sur le catalogue de la base de
dev (une requête `select type, count(*)`, aucune écriture) et sur une restauration jetable de
l'archive de production du 8 septembre 2026 (conteneur `testhand-side-v2-inventory`, 55447,
détruit en fin de mesure). Aucune commande vers le VPS ni Supabase.

## 1. Intention

On annote son deck, puis on essaie des échanges de side et on **voit les chiffres bouger à chaque
geste**, sur tout l'éditeur : panneau Probabilités, matrice, mode Requête, mur de mains et écarts
par carte. L'adversaire devient un **contexte** de l'éditeur, comme premier / second : choisir
« contre Kewl Tune » fait de toutes les statistiques celles du deck sidé, et le dit partout. Pendant
qu'on sélectionne, un aperçu montre ce que donnerait l'échange, et chaque carte candidate affiche
ce que coûterait ou rapporterait son entrée. L'Extra Deck entre dans les plans pour que la fiche
décrive le plan complet, sans effet sur les chiffres. La fiche et le comparateur restent sur le plan
enregistré, mais la raison se lit sans survol et un seul geste enregistre puis ouvre.

L'onglet sait aujourd'hui **décrire** un plan ; la refonte doit l'aider à **choisir**.

## 2. Inventaire prouvé

### 2.1 Observations du prompt, confirmées ou corrigées

| # | Observation | Verdict | Preuve |
| --- | --- | --- | --- |
| 1 | Le panneau de droite montre le deck de base ; le deck sidé n'a que 3 chiffres | **Confirmée** | `EditorPage.tsx:192-194` rend `<StatsPanel>` dans un `<aside … hidden lg:block>` indépendant de l'onglet ; `StatsPanel.tsx:18`, `QueryMode.tsx:27`, `HandWall.tsx:10`, `AnnotationGrid.tsx:26` lisent tous `s.result`, calculé par `launchCompute` sur `buildEngineModel(s)` (`deckStore.ts:224`), donc sur `s.main`. Le deck sidé n'a que `PlanFigures` (`SidePlanner.tsx:562-596`). Capture `web/e2e/out/side-1440-plan.png` : plan « Second » prêt, panneau à droite sur le deck de base (63,1 % / 71,0 % au mode Requête), chiffres du plan sur une ligne. Seul le comparateur calcule un deck sidé en entier (`lib/comparison.ts:81-94`). |
| 2 | Aucun chiffre pendant la sélection ; 150 ms ; défaire copie par copie | **Confirmée** | `SidePlanner.tsx:216-220` (sélection = état local, jamais calculée), `:150` et `:169` (`setTimeout(…, 150)`), `:116` (`createEngineClient()` propre à l'onglet), `:229-231` et `:548` (retrait d'**une** copie par clic : `removeFromPlan(…, copies = 1)`, `lib/matchups.ts:102`). Aucun « annuler l'échange » ni « vider le plan ». |
| 3 | Fiche et comparateur grisés sans raison visible | **Confirmée** | `SidePlanner.tsx:314-315` et `:442-443` : `disabled={dirty…}` et raison dans `title` seulement. Aucun texte rendu. |
| 4 | Adversaire et position perdus au rechargement ; « Échanger » loin sous la ligne de flottaison à 360 px | **Confirmée** | `SidePlanner.tsx:85-87` (`useState` locaux, défaut `first`). Le contexte premier / second de l'éditeur est lui aussi transitoire (`deckStore.ts:64-68`, défaut `'first'` `:356`). À 360 px : capture `side-360.png` (fixture Deck A, 40 copies en main, 5 tuiles par rangée ≈ 99 px) — 8 rangées de copies du main puis le side avant « Échanger », soit une position **estimée** à ≈ 1 200 px pour une fenêtre utile de ≈ 684 px (780 − en-tête 48 − barre du bas 48). Estimation lue sur la capture ; la mesure exacte est une garde de la partie D. |
| 5 | Tuiles de copies sans nom | **Confirmée** | `SidePlanner.tsx:501-504` : `CardImage` seul ; le nom n'est que dans `title` (`:493`). |
| 6 | Pas d'Extra Deck dans un plan | **Confirmée, et plus grave** | `applyPlan` ne connaît que `main` et `side` (`lib/sidePlan.ts:48-74`) ; `CopyGrid` du side liste **toutes** les cartes du side (`SidePlanner.tsx:369`), y compris une carte de type Extra Deck : elle peut donc aujourd'hui « entrer » dans le **main** (plan prêt et analysé, deck illégal). Le moteur la compte alors comme une carte de main. |
| 7 | 1 à 3 copies par carte **et par zone** | **Confirmée** | `docs/regles-metier.md:63-65`, `lib/ydk.ts:9-10` (`MAX_COPIES = 3`), refus du store `deckStore.ts:539-541` et `:558-560`, contrat serveur par ligne `deckConfiguration.ts:263`. La fixture e2e s'en sert : `web/e2e/scenarios/side.mjs:17` (« Filler Lambda : 3 en main, 1 en side »). Impact mesuré en §2.4.1. |

### 2.2 Ce que l'existant permet déjà

- **Deck sidé = modèle dérivé pur.** `applyPlan` → `sidedSource` → `buildEngineModel` (`lib/sidePlan.ts:48-81`) :
  le deck sidé porte toutes les annotations du deck (R6 de l'étape 10). Aucune annotation propre à un plan.
- **Les deux passes sont déjà calculées** pour le deck de base (`computeAll`, `engine/enumerate.ts:231-254`) :
  premier et second s'affichent côte à côte (`StatsPanel.tsx:176-179`, `QueryMode.tsx:60-61`) ; le
  réglage `context` ne choisit que la matrice, les deltas de tuile et le mur (`CardTile.tsx:94`,
  `StatsPanel.tsx:180`, `HandWall.tsx:77`).
- **Écarts par carte existants** = contribution marginale « −1 copie » sur P(S ≥ 1), par contexte
  (`enumerate.ts:238-251`, chemin léger `probStart` `:92-104`, non exporté), rendus « −1 : x % » sur la
  tuile (`CardTile.tsx:274`). Le mode `passes` du worker les omet (`engine.worker.ts:37-42`).
- **Le client de calcul sait annuler** (`worker/computeClient.ts:128-143` : `terminate()` puis reprise) ;
  un client = un worker = un propriétaire (`:14-17`).
- **Cache des chiffres de plan** : empreinte FNV-1a de la version du moteur, de la position, des critères
  et de l'entrée complète (`lib/sidePlan.ts:139-141`) ; affichés seulement si l'empreinte correspond
  (`:156-163`) ; persistés seulement hors « non enregistré » (`SidePlanner.tsx:185-199`).
- **Contrôle serveur de taille** : la route des chiffres compare `mainSize` à `main − Σ sortantes + Σ entrantes`
  toutes lignes du plan confondues (`routes/decks.ts:174-179`, `domain/deckSummary.ts:60-62`).
- **Le contrat ne valide que la structure d'un plan** (`deckConfiguration.ts:169-229`) : ni zone, ni
  équilibre (étape 10, §4).

### 2.3 Constats nouveaux

1. **`isMainDeckType` se trompe sur 18 cartes d'Extra Deck.** Le motif `EXCLUDED_TYPE`
   (`server/src/domain/cardDefaults.ts:64`) écrit « Synchro Pendulum Monster » et « XYZ Pendulum
   Monster », qui n'existent pas au catalogue ; les types réels sont « Synchro Pendulum Effect Monster »
   (8 cartes) et « XYZ Pendulum Effect Monster » (10 cartes). Preuves :
   `docker compose exec -T db psql -U ygo -d ygo -At -c "select type, count(*) from cards group by type order by 1"`
   (29 types, lecture seule) puis
   `node --import tsx -e "import('file:///C:/dev/Testhand/server/src/domain/cardDefaults.ts').then(m => …isMainDeckType(t))"`
   → `Synchro Pendulum Effect Monster -> true`, `XYZ Pendulum Effect Monster -> true`,
   `Pendulum Effect Fusion Monster -> false`. Conséquences : la règle R2 du contrat §9 (« une carte
   d'extra deck n'a jamais de défaut ») est violée pour ces 18 cartes, et la décision 5 du prompt
   (zone déduite du type) les rangerait dans le main. `cardDefaults.ts` est dans `__ENGINE_VERSION__`
   (`web/vite.config.ts:23`) : le corriger périme une fois tous les aperçus **et tous les chiffres de
   plan** (la version du moteur fait partie de l'empreinte, `sidePlan.ts:140`), recalculés à l'identique
   sauf pour un deck qui aurait l'une de ces cartes **dans son main** (aucun des 16 decks du 8 septembre,
   §2.4.1).
2. **`lib/deckConfiguration.ts` est aussi dans l'empreinte** (`vite.config.ts:20`). Toute retouche de ce
   fichier (par exemple pour y faire transiter un contexte) périme aperçus et chiffres de plan. Le
   contexte d'étude n'a pas à y passer (§5).
3. **Le panneau affiche deux colonnes, premier et second** (`StatsPanel.tsx:176-179`), et le mode
   Requête deux valeurs (`QueryMode.tsx:60-61`). Or un adversaire a **deux** plans, donc deux decks
   sidés. C'est le cœur de l'articulation « contexte premier / second × position d'un plan » (§4, D2).
4. **Un échange équilibré conserve tout** : taille du main, de l'Extra et du side, et total d'une carte
   toutes zones confondues (une copie ne fait que changer de zone). Donc, zone par zone et à équilibre
   strict, **le deck sidé est légal si et seulement si le deck de base l'est** (40–60, 15 au plus en
   Extra et en side) — et, si la règle des 3 copies toutes zones est adoptée, l'écart « main dérivé
   au-delà de 3 » (R3, `sidePlan.ts:68`) devient impossible sur un deck légal. La décision 4 du prompt
   n'ajoute donc aucun refus au geste d'échange ; elle se réduit à un état du deck de base (D9).
5. **Le contrôle de taille du serveur reste exact avec l'Extra** : pour un plan prêt, Σ sortantes et
   Σ entrantes de l'Extra s'annulent, `main − Σout + Σin` vaut toujours la taille du main dérivé. Aucune
   route ni migration à changer pour cela (§5.2).
6. **Le mur de mains tire dans `s.main`** (`store/selectors.ts:44-52`) et note avec `s.model` / `s.result`
   (`:56-68`) : il doit lire le deck étudié, pas seulement son résultat.

### 2.4 Mesures

Mesures menées par un sous-agent, scripts hors dépôt (dossier de session `scratchpad/side-v2/` :
`extract.mts`, `bench.mts`, `m1b.sql`) ; conditions et commandes en §2.4.3. Les chiffres ci-dessous ont
été relus sur les fichiers de sortie (`mesures.md`, `bench-archive-A-r7.md`, `bench-fixture-AB-r7.md`).

#### 2.4.1 Règle des 3 copies toutes zones

**Fixture e2e** (lecture des scénarios) : une seule violation, **voulue** — Deck A pendant `side.mjs` :
Filler Lambda 3 en main (`setup.mjs:13`) + 1 en side (`side.mjs:39`) = 4. `sidesheet.mjs` pose Rho 0 + 3,
Omicron 1 + 2 et Iota 2 + 1 : pile à la limite, aucune violation, **aucun plan de la fixture invalide**.
Les autres scénarios ne touchent ni l'Extra ni le side au-delà de 3.

**Archive du 8 septembre** (`ygo-prod-2026-09-08.sql.gz`, données identiques à l'archive « souvenir »
hors en-têtes `--clean` ; restaurée, puis schéma, 001, 002, 004, 005, 006 et 003 acceptée par
l'empreinte `e0efff5c2ddacc8d27bbd9e9e76694b1`, reproduite). Requête `having sum(copies) > 3` par deck et
carte, toutes zones :

| Deck | Carte | Main | Extra | Side | Total |
| --- | --- | --- | --- | --- | --- |
| D10 · Ryzeal onomat | Seventh Tachyon | 2 | 0 | 3 | 5 |
| D15 · Mitsu Orcust | Ash Blossom & Joyous Spring | 3 | 0 | 3 | 6 |
| D15 · Mitsu Orcust | Mulcharmy Purulia | 3 | 0 | 1 | 4 |

- **2 decks sur 16, 3 cartes.** 18 couples (deck, carte) sont dans deux zones ; 15 restent ≤ 3 au total.
- **Aucun plan de side dans l'archive** : elle précède l'étape 10 (tables de 004 absentes avant migration,
  0 ligne après). Les plans réels (3 adversaires, 6 plans au 11 septembre) sont en production, **non
  mesurés**.
- **Aucune carte de side de type Extra Deck** dans les 16 decks (side : Effect 81 copies, Spell 52, Trap 32,
  Tuner 15, Ritual Effect 1). Tailles : main 40 à 60, aucun Extra ni side au-delà de 15.
- Aucune des 18 cartes mal classées par `isMainDeckType` (§2.3-1) n'est dans ces 16 decks (requête sur
  `cards.type in ('Synchro Pendulum Effect Monster', 'XYZ Pendulum Effect Monster')`).
- 9 lignes de `deck_cards` portent une carte **absente du catalogue** (dont 2 en main) ;
  `isMainDeckType(undefined)` vaut vrai : une déduction de zone naïve rangerait une carte d'Extra inconnue
  dans le main. D'où `unknown-zone` en D8.
- **Piège de mise en œuvre** : `applyPlan` ne dérive que le main (`sidePlan.ts:62-67`). Un contrôle « main
  dérivé + side de base » compterait deux fois les copies entrantes (Rho : 1 + 3 = 4) ; la règle se juge sur
  le deck de base (§2.3-4), ou sur main et side dérivés ensemble.

#### 2.4.2 Coût du moteur

Temps en millisecondes, « médiane / max » sur 7 répétitions après 2 échauffements, sous Node (même V8
que le worker du navigateur : ordre de grandeur, pas une mesure du navigateur). Bibliothèque **effective**
(choix > référence > détection, construction de `annotations-report.ts --gap`).

| Deck | Main | Types | `computePass` premier | `computePass` second | `computeAll` (2 passes + écarts) |
| --- | --- | --- | --- | --- | --- |
| Fixture Deck A (le plus lourd de la fixture) | 40 | 11 | 17 / 23 | 65 / 69 | 96 / 100 |
| D3 · Branded (le plus léger) | 40 | 11 | 6 / 7 | 24 / 25 | 44 / 50 |
| D1 · Azamina RoLaD | 40 | 11 | 11 / 13 | 64 / 101 | 87 / 88 |
| D12 · Mitsu Orcust (heavy orcust) | 41 | 16 | 33 / 48 | 281 / 393 | 536 / 559 |
| D10 · Ryzeal onomat | 40 | 18 | 51 / 53 | 476 / 484 | 763 / 922 |
| D5 · Mitsu Rolad test | 50 | 17 | 49 / 65 | 377 / 394 | 848 / 907 |
| D15 · Mitsu Orcust | 50 | 17 | 48 / 51 | 469 / 591 | 908 / 929 |
| **D16 · YCS paris 2 (le plus lourd)** | 60 | 18 | 57 / 62 | 469 / 593 | **1 024 / 1 219** |

Les 16 decks : `computeAll` de 44 à 1 024 ms, 10 sur 16 sous 250 ms. `buildEngineModel` ≤ 0,04 ms. La
passe **second** domine (5 à 9 fois la passe premier) ; les écarts par carte coûtent environ
`computeAll − 2 passes` (≈ 500 ms sur D16).

**Écarts de candidats (D6)**, `buildEngineModel` compris, total pour tous les candidats d'une sélection :

| Sélection | Candidats | Premier seul | Second (deux passes, borne haute) | Par candidat, premier / deux passes |
| --- | --- | --- | --- | --- |
| Une sortante du main → cartes du side (fixture `sidesheet`) | 3 | 29 / 30 | 235 / 243 | 10 / 78 |
| idem, D1 · Azamina RoLaD | 6 | 58 / 59 | 523 / 557 | 10 / 87 |
| idem, D10 · Ryzeal onomat | 8 | 459 / 475 | 5 179 / 5 329 | 57 / 647 |
| idem, D16 · YCS paris 2 | 7 | 437 / 440 | 4 147 / 4 251 | 62 / 592 |
| Une entrante du side → cartes du main, D3 · Branded | 21 | 131 / 166 | 611 / 613 | — |
| idem, D10 · Ryzeal onomat | 23 | 1 114 / 1 219 | 11 591 / 11 625 | — |
| idem, D16 · YCS paris 2 | 34 | 1 940 / 2 051 | 17 607 / 18 030 | — |

(Inverse : 1 échauffement, 3 répétitions.) Les candidats partagent souvent la même entrée du moteur (cartes
neutres) : D16 34 candidats → 19 entrées distinctes, D10 23 → 18 ; le dédoublonnage par empreinte est
donc rentable. La colonne « deux passes » est une borne haute : un candidat en position second n'a besoin
que de la passe second (≈ 90 % de ce total).

« Tout calculer » de la fiche de la fixture (13 plans prêts) : 678 / 690 ms.

**Avec les paires : un ordre de grandeur de plus.** La base migrée n'a **aucune paire** (003 purge les
185 paires globales ; depuis l'étape 3 elles sont propres au deck et ressaisies). Les chiffres ci-dessus
sous-estiment donc un deck réel ressaisi avec ses paires. Passage indicatif avec les paires historiques
réinjectées (variante B, **une seule répétition, sans échauffement**, `bench-archive-AB.md`) :

| Deck (paires) | Types | `computePass` premier | `computePass` second | `computeAll` | Candidats du side, deux passes |
| --- | --- | --- | --- | --- | --- |
| D1 · Azamina RoLaD (12) | 18 | 56 | 560 | 903 | 4 623 (6 candidats) |
| D13 · Crystron (22) | 21 | 112 | 1 242 | 1 984 | — |
| D5 · Mitsu Rolad test (11) | 24 | 228 | 1 904 | 5 308 | 20 531 (8) |
| D15 · Mitsu Orcust (8) | 21 | 145 | 1 728 | 4 562 | 9 591 (7) |
| **D16 · YCS paris 2 (42)** | 33 | 1 196 | 11 864 | **42 484** | **89 959** (7) |

13 decks sur 16 restent entre 0,9 et 2 s pour `computeAll` ; D5 et D15 (50 cartes) passent 4,5 s ; D16
(60 cartes, 42 paires) atteint 42 s — **l'éditeur actuel met déjà ce temps à ouvrir ce deck**. La variante B
n'a pas été répétée (arrêtée pour ne pas prolonger la mesure) : ordre de grandeur seulement.

**Lecture pour le budget.**
- *Aperçu* (une position, sans écarts de tuile) : ≤ 62 ms en premier et ≤ 593 ms en second sur le deck le
  plus lourd, ≤ 70 ms sur la fixture. Instantané en premier, visible (« calcul… ») en second sur les gros
  decks, jamais bloquant.
- *Deck étudié* (`computeAll` par deck sidé, écarts de tuile compris) : sans paires ≤ 1,2 s par plan ; avec
  paires 1 à 5 s sur 15 decks sur 16, et 42 s sur D16. Deux plans différents doublent ce temps : il faut
  afficher les passes **avant** les écarts de tuile (D4).
- *Candidats* : sans paires, en premier ≤ 0,5 s (side) et ≤ 2 s (main) ; en second jusqu'à ≈ 5 s (side) et
  ≈ 16 à 18 s (main). Avec paires, candidats du side en deux passes : 3,5 à 20 s, **90 s** sur D16. Un calcul
  complet à chaque clic est exclu ; seul un calcul estimé, progressif, annulable, et à la demande au-delà
  d'un seuil est tenable (D6).

#### 2.4.3 Conditions de mesure

Intel Core i5-1235U (12 processeurs logiques), Windows 11, Node v22.18.0 (`Get-CimInstance
Win32_Processor`, `node --version`). Restauration et migration faites avant les chronos ; aucun autre
calcul lourd pendant les mesures. Conteneur `testhand-side-v2-inventory` (`--rm`, `--tmpfs`, 55447).
Commandes : `docker exec -i testhand-side-v2-inventory psql -U ygo -d ygo -v ON_ERROR_STOP=1 -f - < m1b.sql` ;
`node --import tsx extract.mts` puis `node --import tsx bench.mts --variant A` (cwd `C:\dev\Testhand`).
Non mesuré : le navigateur (worker réel, téléphone), les plans de production.

## 3. Avis sur les décisions tranchées

- **Décision 1 (adversaire = contexte de l'éditeur) — juste**, et c'est la seule façon de rendre le
  mode Requête, la matrice et le mur utiles au side. Deux points à régler, instruits en D2 et D14 :
  (a) le panneau montre **deux** positions à la fois, alors qu'un adversaire a deux plans ; (b) l'onglet
  Annoter édite la **composition du deck de base** : en contexte sidé, il faut dire sans ambiguïté que
  les chiffres portent sur le deck sidé mais que les steppers modifient le deck de base.
- **Décision 2 (aperçu en direct) — juste.** Risque : afficher un aperçu comme un fait. D'où un badge
  « aperçu » et un écart **avec le plan** (pas avec le deck de base) tant que rien n'est échangé (D5).
  Une sélection déséquilibrée n'a pas d'aperçu : cohérent avec l'équilibre strict.
- **Décision 3 (écart par carte déclenché par la sélection) — juste sur le fond, coûteuse et à cadrer.**
  Il faut choisir **quel** chiffre on montre sur une tuile de 56 à 96 px (un seul tient) et **par
  rapport à quoi**. Le « −1 : x % » actuel mesure P(S ≥ 1) : pour une handtrap qui entre, il est
  presque toujours négatif et pousserait à ne rien sider. Je propose « main forte » (I3) par défaut,
  modifiable (D6, Q4). Le coût est en §2.4.2 et fixe les seuils de D6.
- **Décision 4 (équilibre strict et légalité) — juste, mais la légalité ne se juge pas au geste** :
  constat §2.3-4, un échange équilibré ne peut ni créer ni corriger une illégalité. Ce qui reste à
  décider, c'est ce qu'on fait d'un deck **de base** hors format (40 cartes pas encore atteintes, side
  de 16) : je propose d'avertir sans bloquer, comme le panneau le fait déjà (`StatsPanel.tsx:118-122`,
  contrat §2) — Q9.
- **Décision 5 (Extra dans les plans) — juste**, avec deux réserves : le bogue `isMainDeckType` (§2.3-1)
  doit être corrigé avant de s'y fier (Q7), et un plan existant qui fait entrer une carte d'Extra dans
  le main change de statut (Q8), ce qui touche l'invariant de non-régression.
- **Décision 6 (fiche et comparateur sur le plan enregistré) — juste.** Le geste unique est simple :
  `saveDeck()` puis navigation seulement si l'enregistrement a réussi et que rien n'est redevenu
  « non enregistré » entre-temps.
- **Décision 7 (hors périmètre) — juste.** Aucun élément de ce plan ne suppose un archétype.
- **Point discutable non tranché par le prompt : une tuile par copie.** D16 de l'étape 10 dépliait les
  copies ; c'est ce qui repousse « Échanger » à ≈ 1 200 px, et l'écart par carte (décision 3) est par
  **carte**, pas par copie. Je propose une tuile par carte avec un sélecteur de copies (D7, Q2).

## 4. Décisions proposées

**D1 — Contexte d'étude.** L'éditeur a un contexte `étude = { adversaire: id | aucun ; position:
premier | second }`. La position est le `context` existant ; l'adversaire est nouveau. Transitoire
comme `context` (jamais dans la configuration, le brouillon ni « non enregistré ») et **reflété dans
l'URL** par `history.replaceState` (`/decks/:id?contre=<matchupId>&position=second`, onglet side
compris), pour survivre au rechargement sans polluer l'historique. Un adversaire inconnu (supprimé,
autre deck) retombe sur le deck de base avec un avis. *Pourquoi* : l'URL est la seule mémoire qui
survit au rechargement sans écrire nulle part ni salir le deck ; elle suit la convention d'adressage
déjà prise par le comparateur (`deck~adversaire~position`, `lib/comparison.ts:62`). Q11 pour la
mémoire au-delà du rechargement.

**D2 — Deux colonnes, un plan chacune.** Contre un adversaire, la colonne « Premier » est le deck
après le plan premier, la colonne « Second » le deck après le plan second ; chaque titre de colonne le
dit (« Premier · plan contre Kewl Tune »). Basculer la position change le deck qui gouverne la
matrice, les écarts par carte, le mur et le plan ouvert dans l'onglet side. *Pourquoi* : R7 de
l'étape 10 est respecté par construction (un plan n'est jamais lu dans l'autre position), la vue
côte à côte est conservée, et Mains types (« premier et second côte à côte », sur plans de side) s'y
greffe sans rien changer. Alternative écartée : une seule colonne en contexte sidé — perd la vue côte
à côte et oblige à deux présentations du panneau.

**D3 — Le deck étudié se nomme partout.** Une barre de contexte unique, sous l'en-tête, visible sur
tous les onglets : sélecteur « Deck de base / contre … » et bascule Premier / Second (celle du panneau
et du mur deviennent la même commande). Chaque bloc chiffré (colonne, matrice, requête, mur, bandeau
de tuile) porte le nom court du deck qu'il mesure. Un plan pas prêt ne montre **aucun** chiffre dans sa
colonne (« Plan second incomplet : −2 / +1 »), jamais ceux du deck de base à sa place. *Pourquoi* :
invariant d'affichage du prompt.

**D4 — Calcul : deck de base + deck étudié, par empreinte.** Le store garde le résultat du deck de base
(inchangé, nécessaire aux écarts « avec le deck de base ») et, contre un adversaire, les résultats des
deux decks sidés, dédoublonnés par entrée du moteur (plan premier = plan second → un seul calcul ; plan
vide → le résultat du deck de base). Petit cache par empreinte (16 entrées, mémoire de session) : revenir
à un adversaire déjà vu est instantané. Le client de calcul propre à `SidePlanner` disparaît : l'onglet
lit le store. **Mode de calcul, moteur inchangé, en deux temps** : d'abord les passes (mode `passes`,
ou la seule passe utile si les deux plans sont identiques au deck de base dans l'autre position), qui
alimentent colonnes, matrice, requête et mur ; ensuite `computeAll` pour les écarts de tuile, en basse
priorité, les tuiles restant « … » d'ici là. Coût mesuré (§2.4.2) : ≤ 1,2 s par plan sans paires, 1 à
5 s avec paires, 42 s sur le deck de 60 cartes à 42 paires — où l'éditeur actuel met déjà 42 s. Un mode
« un contexte avec ses écarts » gagnerait au mieux la moitié et toucherait `engine/enumerate.ts` : pas
dans ce chantier (Q13).

**D5 — Aperçu en direct.** Une sélection **équilibrée zone par zone** produit un deck d'aperçu =
plan + sélection. La colonne de la position ouverte l'affiche avec un badge « aperçu » et un écart
**avec le plan** ; l'autre colonne ne bouge pas (son plan n'est pas touché). Une sélection
déséquilibrée n'a pas d'aperçu : la colonne garde le plan et dit « sélection −2 / +1, pas d'aperçu ».
Une sélection d'Extra seule dit « sans effet sur les chiffres ». L'aperçu vit dans le store (le panneau
est un autre composant), hors configuration, brouillon et « non enregistré » ; chaque changement annule
le calcul précédent. L'aperçu calcule **la seule passe de la position ouverte**, sans écarts de tuile :
nouveau mode `second` du worker, symétrique du mode `first` existant (`engine.worker.ts:37-42` ; le worker
est hors empreinte, `computePass` est déjà exporté). Seuils proposés (Q5), mesurés sur le deck le plus
lourd de l'archive : regroupement 50 ms comme le store (`deckStore.ts:201`) ; sans paires, ≤ 62 ms en
premier et ≤ 593 ms en second sur D16 ; avec paires, 56–228 ms en premier et 0,4–1,9 s en second sur 15 decks
sur 16, 1,2 s / 11,9 s sur D16. Au-delà de 150 ms, la colonne garde le chiffre précédent atténué avec
« calcul de l'aperçu… » (charte §7.15), jamais vide ni faux ; chaque nouveau clic annule le calcul en cours,
seul le dernier état de la sélection est calculé.

**D6 — Écart par carte déclenché par la sélection.** Quand la sélection du main a **exactement une copie
sortante de plus** que d'entrantes, chaque carte libre du side (de type main deck) affiche l'écart d'un
échange avec elle ; symétriquement, une entrante de plus → chaque carte libre du main affiche l'écart de
sa sortie. Définition : `indicateur(plan + sélection + ce candidat) − indicateur(plan)`, dans la position
ouverte — « écart avec le plan actuel », même référence que l'aperçu. Un seul chiffre par tuile,
l'indicateur choisi parmi I1, I2, I3 (défaut I3 « main forte », Q4). Calcul sur un **second client** de
calcul, à basse priorité, en série, annulé à tout changement de sélection, affiché progressivement
(« … » tant qu'il manque). Une seule passe (celle de la position), dédoublonnage par empreinte (D16 :
34 candidats → 19 calculs). Seuils proposés (Q5), à partir de §2.4.2 : **calcul automatique** si
l'estimation `candidats distincts × durée de la dernière passe de cette position` est ≤ 3 s (tous les cas
en premier, les candidats du side en second sur les decks de moins de 15 types) ; **au-delà, calcul à la
demande** par un bouton « Calculer les écarts (≈ 12 s) » avec progression « 7 / 19 » et annulation. Les
cas les plus chers mesurés — sans paires ≈ 16 s (D16, une entrante choisie, second), avec paires ≈ 90 s
(D16, une sortante choisie, deux passes) — ne sont lisibles qu'en progressif et à la demande.
Les écarts arrivent dans l'ordre d'affichage des tuiles.

**D7 — Une tuile par carte dans l'onglet side (sous réserve de Q2).** Une tuile par carte distincte,
nom sous l'image (une ligne, tronquée, nom complet en `aria-label`), compteur « engagées / disponibles »,
sélecteur de copies à 32 px ; un clic sur l'image ajoute une copie à la sélection (et revient à zéro au
maximum), le clic droit en retire une. *Pourquoi* : 40 copies deviennent 15 à 25 tuiles (« Échanger »
remonte), l'écart de D6 est par carte, le nom est lisible (observation 5). Revient sur D8 et D16 de
l'étape 10 : d'où Q2.

**D8 — L'Extra Deck dans les plans, zone déduite du type.** `SidePlanCard` ne change pas ; la zone
d'une carte de plan est `main` ou `extra` selon son type (`isMainDeckType` corrigé, Q7). L'onglet side
montre un bloc Extra (copies à sortir) face aux cartes de side de type Extra (à faire entrer) ; un
échange ne traverse jamais les zones. `applyPlan` reçoit la zone de chaque carte : équilibre jugé zone
par zone, écarts nommés par zone (`extra-outgoing-missing`, `zone-mismatch`, `unknown-zone` si le type
de la carte n'est pas chargé → « à revoir »). Main dérivé et entrée du moteur inchangés pour tout plan
sans carte d'Extra → mêmes empreintes, mêmes chiffres. Fiche et PDF : les cartes d'Extra dans les cadres
SORT / ENTRE, sous un intertitre « Extra ». **Aucune migration** (§5.2).

**D9 — Légalité : un état du deck de base, pas un refus d'échange.** Constat §2.3-4. La barre de contexte
et le plan avertissent quand le deck de base est hors format (main hors 40–60, Extra ou side au-delà de
15, et 3 copies toutes zones si Q1) : « le deck sidé l'est aussi ». Les chiffres restent calculés, comme
aujourd'hui pour un main hors bornes (`StatsPanel.tsx:118-122`). Q9 si tu préfères bloquer.

**D10 — 3 copies toutes zones (sous réserve de Q1).** Règle de l'**éditeur** et de l'import, jamais du
contrat serveur : ajout ou quantité refusés au-delà de 3 copies toutes zones (message qui nomme les zones),
import YDK qui le rapporte comme les dépassements actuels (décision explicite), deck existant qui la viole
signalé par un avertissement « hors format », **toujours enregistrable**. Les statuts de plan ne changent
pas (leurs règles R1–R5 sont inchangées) : l'invariant de non-régression tient. Impact en §2.4.1.

**D11 — Fiche et comparateur : raison visible et geste unique.** Tant que quelque chose n'est pas
enregistré : texte visible à côté des boutons (« La fiche lit le deck enregistré »), et bouton
« Enregistrer et ouvrir la fiche » / « Enregistrer et comparer » (32 px) qui appelle `saveDeck()` puis
navigue si l'enregistrement a réussi et que le deck n'est pas redevenu « non enregistré ». Plan pas prêt :
raison visible, pas de geste.

**D12 — Téléphone et tablette.** Sous 1024 px, dans l'onglet side : barre d'action collante en bas du
contenu (sélection, trois chiffres de l'aperçu ou du plan avec écart, « Échanger ») et panneau
Probabilités rendu **sous** le contenu du plan (décision 1) ; l'onglet « Stats » reste pour les autres
onglets (Q10). La barre de contexte tient sur une ligne à 360 px (nom d'adversaire tronqué, sélecteur
natif).

**D13 — Défaire un essai.** « Annuler l'échange » (pile des échanges de la session pour le plan ouvert,
transitoire) et « Vider le plan » (avec confirmation). Retirer une carte du plan retire toutes ses copies
depuis la liste « Sort » / « Entre » ; le sélecteur de D7 garde le retrait copie par copie.

**D14 — Onglet Annoter en contexte sidé.** Les écarts de tuile sont ceux du deck étudié dans la position
ouverte. Une carte du main entièrement sortie par le plan affiche « sort (plan) » au lieu d'un écart ; une
carte de side entrante perd « hors calcul » et affiche son écart et « entre (plan) ». Les steppers et les
modes éditent toujours le **deck de base** : un bandeau le dit (« Vous annotez le deck de base ; chiffres :
contre Kewl Tune, second »). Q6.

**D15 — Non-régression prouvée, pas supposée.** Test de référence : pour chaque plan des fixtures et un
jeu de plans synthétiques sans carte d'Extra, le nouvel `applyPlan` rend le même statut, le même main
dérivé, la même entrée du moteur et la même empreinte que l'actuel (copie figée de l'actuel dans le test,
comme `recompute-check.ts` fige l'ancien moteur). Les plans existants qui font entrer une carte d'Extra
dans le main : Q8.

**D16 — Porte ouverte à Mains types.** Le deck étudié est une fonction pure
`studiedDecks(state, étude) → { first, second }` (source du moteur, nom, statut) dans un fichier hors
empreinte (`lib/studiedDeck.ts`) ; tout consommateur de chiffres passe par elle. Mains types n'aura qu'à
lire les mêmes deux decks.

**D17 — Caches.** `lib/sidePlan.ts` reste hors `__ENGINE_VERSION__` ; la définition de l'empreinte d'un
plan ne change pas (elle ne lit que l'entrée du moteur, où l'Extra n'entre pas : un échange d'Extra ne
périme aucun chiffre, et c'est juste). La persistance des chiffres de plan passe de `SidePlanner` au store
(même règle : deck sans modification non enregistrée, révision lue, 409 ignoré). Seule la correction de
`isMainDeckType` (Q7) et, selon D4, un nouveau mode du moteur périment les caches, une fois.

## 5. Modèle

### 5.1 Contrat et règles pures

- `server/src/domain/cardDefaults.ts` : `EXCLUDED_TYPE` corrigé (Q7) ; nouvelle `deckZoneOfType(type):
  'main' | 'extra' | null` (`null` = jeton, compétence ou type inconnu).
- `server/src/domain/deckConfiguration.ts` : **inchangé** (structure seulement ; pas de règle de zone,
  d'équilibre ni de 3 copies toutes zones — un deck ou un plan devenu incohérent reste enregistrable).
- `web/src/lib/sidePlan.ts` : `applyPlan(main, extra, side, plan, zoneOf)` ; `PlanIssue` étendu ;
  `AppliedPlan` gagne `extraOutgoing` / `extraIncoming` ; `planFingerprint`, `usablePlanSummary`,
  `planIndicators` inchangés.
- `web/src/lib/matchups.ts` : `swapInPlan` par zone ; `undoSwap`, `clearPlan`.
- `web/src/lib/zones.ts` : `deckLegality(main, extra, side, zoneOf)` → liste d'écarts de format (D9, D10).
- Nouveaux fichiers purs, hors empreinte : `lib/studiedDeck.ts` (D16), `lib/swapPreview.ts` (deck d'aperçu,
  candidats de D6, définition de l'écart).

### 5.2 Schéma : aucune migration

Preuve que l'Extra n'en demande pas :
1. `deck_side_plan_cards` a pour clé `(deck_id, matchup_id, position, card_id, direction)`
   (`db/migrations/004-side-plans.sql`) ; une carte a un seul type, donc une seule zone de jeu : la zone
   est une fonction de `card_id` et n'a pas à être stockée.
2. Le contrat ne valide ni zone ni équilibre (`deckConfiguration.ts:169-229`) : une ligne d'Extra y est
   déjà acceptée.
3. La route des chiffres reste exacte (§2.3-5).
4. `prune-stale-cards` reporte déjà les cartes de plan (étape 10A, écart 2).

Risque accepté : une carte absente du catalogue chargé n'a pas de zone connue → le plan est « à revoir »
(nommé), jamais deviné. Alternative écartée : colonne `zone` additive (migration 007) — redondante avec le
type, et elle ferait diverger zone stockée et zone réelle pour les 18 cartes mal classées.

### 5.3 Store (`web/src/store/deckStore.ts`)

- État transitoire : `study: { matchupId: string | null }` (la position reste `context`),
  `selection` (copies choisies par zone et direction), `swapHistory` ; jamais dans `configurationFromState`.
- Résultats : `result` (deck de base, inchangé) ; `studied: { first, second }` = pour chaque position
  `{ status, name, input, result | null, stale, computing }` ; `preview` ; `candidates` (écarts de D6).
- Orchestration : deux clients (principal = deck de base puis decks sidés puis aperçu ; exploration =
  candidats), versionnement et annulation sur le modèle de `scheduleCompute` (`deckStore.ts:207-246`).
- Persistance des chiffres de plan déplacée de `SidePlanner.tsx:185-199`.

### 5.4 Routes

Aucune route nouvelle ni modifiée. `GET /decks/:id` rend déjà `matchups` et `plan_summaries`.

### 5.5 Composants

`EditorPage.tsx` (barre de contexte, URL, panneau sous le contenu en onglet side sous 1024 px) ·
nouveau `StudyBar.tsx` · `StatsPanel.tsx`, `QueryMode.tsx`, `HandWall.tsx` + `store/selectors.ts`,
`AnnotationGrid.tsx` + `CardTile.tsx` (lisent le deck étudié, D3, D14) · `SidePlanner.tsx` (refonte :
D5–D8, D11–D13) · `SideSheet.tsx`, `lib/sideSheet.ts`, `lib/sideSheetPdf.ts` (Extra) ·
`lib/router.tsx` (paramètres de requête) · `ComparePage.tsx` inchangé (un plan d'Extra seul compare le
deck de base à lui-même, dit par la note existante).

## 6. Règles métier à inscrire au contrat (`docs/regles-metier.md` §8, sous « Plans de side v2 »)

- **S1 — Deck étudié.** L'éditeur étudie le deck de base, ou un adversaire. Contre un adversaire, la
  position premier étudie le deck après le plan premier, la position second le deck après le plan second.
  Tout chiffre de l'éditeur porte sur le deck étudié de sa position et le nomme.
- **S2 — Plan pas prêt.** Une position dont le plan est incomplet ou à revoir n'affiche aucun chiffre ;
  jamais ceux du deck de base à sa place.
- **S3 — Aperçu.** Une sélection équilibrée zone par zone montre le deck « plan + sélection », marqué
  aperçu, avec son écart avec le plan. Un aperçu n'est jamais enregistré, ne salit pas le deck, ne
  s'imprime pas et n'est pas persisté comme chiffre de plan.
- **S4 — Écart d'un candidat.** Sélection du main à une copie près : écart d'un candidat =
  indicateur(plan + sélection + candidat) − indicateur(plan), dans la position ouverte, pour l'indicateur
  choisi (I1, I2 ou I3 du §8).
- **S5 — Zones d'un plan.** Un plan fait sortir des cartes du main et de l'Extra et entrer des cartes du
  side ; la zone de jeu d'une carte est déduite de son type ; un échange reste dans sa zone. Une carte dont
  la zone est inconnue rend le plan « à revoir ».
- **S6 — Équilibre par zone.** Un plan est prêt si, dans le main comme dans l'Extra, les copies sortantes
  égalent les entrantes (et R1, R3, R5 du §8).
- **S7 — Extra sans effet.** Les cartes d'Extra d'un plan n'entrent ni dans le calcul ni dans l'empreinte
  de ses chiffres.
- **S8 — Légalité.** Un échange équilibré conserve les tailles de zone et le total de chaque carte : le
  deck sidé est hors format si et seulement si le deck de base l'est ; c'est un avertissement, jamais un
  refus d'enregistrer ni de calculer (sous réserve de Q9).
- **S9 — 3 copies toutes zones** (si Q1) : convention de l'éditeur et de l'import, avertissement sur un
  deck existant, jamais un refus d'enregistrement.
- **S10 — Fiche et comparateur** : plan enregistré ; raison visible sans survol ; « Enregistrer et
  ouvrir » n'ouvre qu'après un enregistrement réussi.

## 7. Découpage

| Partie | Résultat attendu | Fichiers touchés | Tag |
| --- | --- | --- | --- |
| **A — Règles pures** | Zones de plan (Extra), équilibre par zone, `isMainDeckType` corrigé (Q7), légalité du deck (D9, D10), deck étudié et aperçu en pur, définition des écarts de candidat, test de non-régression D15 ; contrat §8 et §2. Aucune interface. | `cardDefaults.ts` (+ tests), `lib/sidePlan.ts`, `lib/matchups.ts`, `lib/zones.ts`, nouveaux `lib/studiedDeck.ts`, `lib/swapPreview.ts` et leurs tests, `docs/regles-metier.md` | `side-v2-a-ok` |
| **B — Store et calcul** | Contexte d'étude, résultats par deck étudié, cache par empreinte, aperçu, second client pour les candidats, persistance des chiffres de plan dans le store, contexte dans l'URL ; selon D4, mode de calcul « un contexte avec écarts ». | `store/deckStore.ts`, `store/selectors.ts`, `worker/*` (et `engine/enumerate.ts` seulement si D4 l'exige), `lib/router.tsx`, tests `store/study.test.ts`, `store/preview.test.ts` étendu | `side-v2-b-ok` |
| **C — Éditeur en contexte** | Barre de contexte, panneau / matrice / requête / mur / tuiles sur le deck étudié et nommés, plan pas prêt sans chiffre, bandeau « vous annotez le deck de base » ; e2e `study`. | `EditorPage.tsx`, `StudyBar.tsx`, `StatsPanel.tsx`, `QueryMode.tsx`, `HandWall.tsx`, `AnnotationGrid.tsx`, `CardTile.tsx`, `web/e2e/scenarios/study.mjs`, `web/e2e/run.mjs` | `side-v2-c-ok` |
| **D — Onglet side refondu** | Tuiles par carte (Q2), aperçu et écarts de candidat affichés, bloc Extra, barre d'action collante, panneau sous le contenu au téléphone, annuler / vider, raisons visibles et « Enregistrer et ouvrir », règle des 3 copies dans l'éditeur et l'import (Q1) ; e2e `side` réécrit (écart expliqué en §8). | `SidePlanner.tsx`, `AddCardDialog.tsx`, `ImportDialog.tsx`, `lib/ydk.ts`, `store/deckStore.ts` (règle d'ajout), `web/e2e/scenarios/side.mjs`, `extraside.mjs` | `side-v2-d-ok` |
| **E — Fiche, PDF, clôture** | Extra dans la fiche et le PDF, comparateur vérifié sur un plan à Extra, docs, charte, AGENTS.md, décisions ; e2e `sidesheet` étendu ; clôture du chantier. | `SideSheet.tsx`, `lib/sideSheet.ts`, `lib/sideSheetPdf.ts` (+ tests), `web/e2e/scenarios/sidesheet.mjs`, `docs/design-system.md`, `AGENTS.md`, `DECISIONS.md`, `docs/decisions-compressees.md`, `docs/PLAN.md` | `side-v2-e-ok` puis `side-v2-ok` |

A et B sont testables sans navigateur ; C rend visible le contexte avant que l'onglet side ne change, de
sorte qu'une régression du panneau se voie seule.

## 8. Vérifications prévues

Pour **chaque** partie : `npm run typecheck`, `npm run build`, `node scripts/test-quiet.mjs` (fichier ciblé
puis suite complète), contrôle par mutation (≥ 4 erreurs volontaires, fichiers restaurés et vérifiés par
empreinte), relecture par un sous-agent à contexte neuf, compte rendu dans ce document.

| Partie | En plus | Mutations prévues (exemples) |
| --- | --- | --- |
| A | Test D15 (plans actuels : statut, main dérivé, empreinte identiques) ; `cardDefaults.test.ts` sur les 29 types du catalogue ; `annotations-report.ts --gap` sur l'archive restaurée pour prouver que la correction de Q7 ne change aucun deck du 8 septembre. Aucune migration → ni `test-migration-sequence.sh` ni `rehearsal.sh`. | équilibre jugé toutes zones confondues ; carte d'Extra acceptée contre une carte du main ; zone inconnue traitée comme main ; écart de candidat mesuré contre le deck de base au lieu du plan |
| B | Tests du store avec faux worker et horloge simulée (`fakeWorker.ts`) : réponse d'un ancien contexte jamais adoptée, aperçu annulé, candidats annulés, plan vide = résultat de base sans calcul, aperçu jamais « non enregistré ». Si `enumerate.ts` bouge : égalité stricte avec `computeAll` sur les cas de référence et `dataIdentity.test.ts` inchangé. | aperçu qui salit le deck ; réponse périmée adoptée ; persistance d'un chiffre de plan pour un deck « non enregistré » ; dédoublonnage par position au lieu de l'empreinte |
| C | `npm run e2e -w web` complet ; nouveau scénario `study` : choix d'adversaire, colonnes nommées, chiffres identiques à ceux de l'onglet side et du comparateur sidé (égalité lue à l'écran et par l'API), plan incomplet sans chiffre, rechargement, mur de mains tiré dans le deck sidé, à **360 / 390 / 768 / 1440** avec verdict par largeur ; captures relues. | colonne sans nom de deck ; chiffres de base affichés pour un plan incomplet ; contexte perdu au rechargement |
| D | e2e `side` réécrit (le sélecteur `[data-copy]` par copie disparaît si Q2 : écart au test existant annoncé ici) : aperçu visible avant « Échanger » sans « non enregistré », écarts de candidat présents et égaux à l'aperçu du même échange, Extra échangé sans recalcul, annuler / vider, « Enregistrer et ouvrir la fiche », « Échanger » dans la fenêtre à 360 px ; `extraside` pour la règle des 3 copies ; aux 4 largeurs. | écart de candidat ≠ aperçu du même échange ; bouton « Échanger » hors de la fenêtre à 360 ; ouverture de la fiche malgré un enregistrement refusé |
| E | e2e `sidesheet` : cartes d'Extra dans les cadres et le PDF ; comparateur sur un plan à Extra ; `npm run e2e -w web` complet de clôture ; tests d'intégration PostgreSQL (55433) une fois pour prouver la route des chiffres avec un plan à Extra. | Extra imprimé dans le main ; chiffre de plan périmé par un échange d'Extra |

## 9. Risques et pièges

- **Charge de calcul.** Deux decks sidés + base + aperçu + candidats = jusqu'à deux workers occupés en
  continu pendant la sélection. Budget chiffré en §2.4.2, annulation systématique, candidats en basse
  priorité. Sur téléphone, à mesurer en partie D sur l'émulation 360 px (pas sur appareil réel).
- **Performance sur les gros decks à paires** : mesures indicatives (une répétition) de 42 s pour ouvrir un
  deck de 60 cartes à 42 paires, 12 s pour un aperçu en second, 90 s pour ses écarts de candidats. Défaut
  **préexistant** du moteur (l'éditeur actuel met déjà 42 s), que la refonte rend plus visible : Q13.
- **Afficher un chiffre sur le mauvais deck** : c'est l'échec le plus grave de ce chantier. Chaque bloc
  chiffré reçoit son deck étudié **avec** son résultat (jamais `s.result` d'un côté et le nom de l'autre),
  et les gardes e2e comparent l'écran à l'API.
- **Empreintes** : `lib/deckConfiguration.ts` et `cardDefaults.ts` sont dans `__ENGINE_VERSION__`
  (§2.3-1, §2.3-2). Ne pas y faire transiter le contexte ; la correction de Q7 périme une fois aperçus et
  chiffres de plan (recalculés à l'identique, à prouver par D15 et le rapport `--gap`).
- **Tests existants modifiés** : `side.mjs` (sélecteurs par copie si Q2), `sidesheet.mjs` (Extra) ; chaque
  modification annoncée dans le compte rendu de sa partie, jamais pour faire passer du code.
- **Plans en production** : 3 adversaires et 6 plans au 11 septembre (docs/etape-10.md §15, C2). Je ne
  peux pas savoir, sans commande vers le VPS, si l'un d'eux fait entrer une carte d'Extra (Q8).
- **Mains types** ne doit pas être construit ici : `lib/studiedDeck.ts` est l'unique point de greffe.
- **Jamais** l'e2e en même temps que `test-migration-sequence.sh` ou `rehearsal.sh` (aucun des deux n'est
  prévu, faute de migration).

## 10. Questions ouvertes

- **Q1 — Règle des 3 copies toutes zones.** Impact mesuré (§2.4.1) : 2 decks sur 16 dans l'archive du
  8 septembre (Ryzeal onomat : Seventh Tachyon 2 + 3 ; Mitsu Orcust : Ash Blossom 3 + 3, Mulcharmy Purulia
  3 + 1), une violation voulue dans la fixture (`side.mjs`), aucun plan de la fixture invalide ; plans de
  production non mesurés. *Recommandation* : l'adopter comme
  règle de l'éditeur et de l'import (D10), avertissement sur les decks existants, contrat serveur inchangé,
  statuts de plan inchangés. *Ce que ça change* : `addCard` / `setCopies` / import YDK refusent
  davantage ; un deck existant peut afficher « hors format » ; la fixture `side.mjs` (Lambda 3 + 1) reste
  valide pour le serveur mais devient un deck hors format à l'écran.
- **Q2 — Une tuile par carte au lieu d'une par copie dans l'onglet side** (D7, revient sur D8 et D16 de
  l'étape 10). *Recommandation* : oui. *Ce que ça change* : « Échanger » remonte, le nom se lit, l'écart
  de candidat a sa place ; le geste « clic sur une copie » devient « clic = +1 copie, clic droit = −1 » ;
  le scénario `side` est réécrit.
- **Q3 — Articulation premier / second contre un adversaire** (D2 : deux colonnes, un plan chacune ;
  basculer la position change le deck qui gouverne matrice, tuiles et mur). *Recommandation* : D2.
  *Alternative* : une seule colonne en contexte sidé.
- **Q4 — Chiffre des écarts de candidat.** *Recommandation* : I3 « main forte » par défaut, sélecteur
  I1 / I2 / I3 dans l'onglet ; référence = le plan actuel. *Ce que ça change* : I1 seul pousserait à ne
  jamais sider de non-engine ; une référence « deck de base » mêlerait l'effet des échanges déjà faits.
- **Q5 — Seuils de temps.** *Recommandation* (D5, D6, mesures §2.4.2) : aperçu d'une seule passe, objectif
  ≤ 100 ms en premier et ≤ 700 ms en second sur le deck le plus lourd, chiffre précédent atténué au-delà de
  150 ms ; écarts de candidats automatiques si l'estimation est ≤ 3 s, sinon à la demande avec progression.
  *Ce que ça change* : sur les decks courants sans paires, presque tout est automatique ; avec paires, en
  second, les écarts demandent souvent un clic et de 5 à 20 s (90 s sur un deck de 60 cartes à 42 paires),
  et l'aperçu en second prend 0,4 à 2 s (12 s sur ce deck). *Alternative* : optimiser le moteur
  pour ces écarts (chemin léger limité aux trois indicateurs), qui touche `engine/` et rouvre les oracles —
  à réserver à un chantier dédié si l'usage le demande.
- **Q6 — Tuiles de l'onglet Annoter en contexte sidé** (D14). *Recommandation* : écarts du deck étudié,
  badges « sort (plan) » / « entre (plan) », bandeau « vous annotez le deck de base ». *Alternative* :
  masquer les écarts en contexte sidé.
- **Q7 — Corriger `isMainDeckType`** (18 cartes « Synchro Pendulum Effect » et « XYZ Pendulum Effect »).
  *Recommandation* : oui, en partie A. *Ce que ça change* : ces cartes perdent leurs défauts HOPT et
  profil (R2 du §9 enfin respectée), aperçus et chiffres de plan recalculés une fois ; aucune de ces 18 cartes
  n'est dans les 16 decks du 8 septembre (§2.4.1), donc aucun chiffre de ces decks ne change.
- **Q8 — Plan existant qui fait entrer une carte d'Extra dans le main.** Illégal aujourd'hui mais accepté
  et analysé. Avec S5, il devient « à revoir » (écart nommé : « carte d'Extra, entre dans le main »).
  *Recommandation* : l'accepter comme le seul changement de statut autorisé, et, si tu le souhaites, me
  demander explicitement une requête en lecture seule sur la production pour savoir si un tel plan existe.
- **Q9 — Deck de base hors format** (main hors 40–60, Extra ou side > 15). *Recommandation* : avertir sans
  bloquer (D9). *Alternative* : aucun chiffre de plan tant que le deck de base est hors format.
- **Q10 — « Le panneau passe sous le contenu » au téléphone** : dans l'onglet side seulement, ou dans tous
  les onglets à la place de l'onglet « Stats » ? *Recommandation* : onglet side seulement (le mur et la
  grille sont déjà longs).
- **Q11 — Mémoire du contexte.** *Recommandation* : l'URL seule (rechargement, lien partagé) ; rouvrir un
  deck depuis l'accueil repart du deck de base. *Alternative* : mémoriser le dernier adversaire par deck
  dans le navigateur.
- **Q12 — « Annuler l'échange » et « Vider le plan »** (D13) dans ce chantier ? *Recommandation* : oui,
  c'est ce qui rend les essais bon marché.
- **Q13 — Coût du moteur sur les gros decks à paires** (§2.4.2 : 42 s pour D16 avec 42 paires, déjà vrai
  aujourd'hui). *Recommandation* : ne pas toucher au moteur dans ce chantier (calcul en deux temps,
  annulation, écarts à la demande suffisent à garder l'interface réactive) et ouvrir un chantier de
  performance dédié, mesuré avec répétitions sur des decks réels à paires. *Alternative* : l'inclure ici,
  au prix des oracles et de `__ENGINE_VERSION__`.

## 11. Révisions après validation (22 septembre 2026)

Aucune réponse ne contredit une recommandation ; les révisions sont de forme, notées ici pour que
le code et le plan disent la même chose.

- **Signature d'`applyPlan`** : `applyPlan(deck, plan, zoneOf)` avec `deck = { main, extra, side }`
  (le store et `sourceFromDetail` portent déjà ces trois champs), au lieu de cinq arguments (§5.1).
  `AppliedPlan` gagne `zones` (sortantes / entrantes par zone), `extraSize` et `extra` (Extra dérivé,
  jamais dans le moteur), les écarts portent leur zone, et un écart `unknown-zone` nomme une carte
  dont le type n'est pas chargé.
- **`swapInPlan(list, id, position, deck, zoneOf, delta, name)`** : un échange est un `SwapDelta`
  `{ outgoing, incoming }`, unité d'« Annuler l'échange » (`undoSwap`) ; la règle de l'échange est
  `trySwap`, partagée avec l'aperçu (`previewOf`) — un aperçu montre exactement ce que donnerait
  « Échanger », et rien qu'il refuserait (S3 précisée).
- **Zone inconnue** : conséquence de S5 à connaître — une carte absente du catalogue chargé (par
  exemple une carte trop récente pour `npm run migrate`) ne peut plus être échangée et rend « à
  revoir » un plan qui la porte, nommée ; avant la v2 elle était rangée dans le main sans le dire.
  Aucun plan de production n'est concerné au 22 septembre (Q8) ; à surveiller après déploiement.
- **Légalité** : `deckLegality` nomme aussi une carte d'Extra Deck posée dans le main (ou l'inverse),
  `wrong-zone` — gratuit une fois la zone déduite du type, et sans quoi un plan ne saurait jamais
  sortir cette carte (S5 la cherche dans la zone de son type).
- **Q8, statut d'un plan d'avant la v2 qui faisait entrer une carte d'Extra dans le main** : la réponse
  disait « à revoir, écart nommé ». Impossible à produire fidèlement : rien dans les données ne
  distingue ce plan d'un échange d'Extra légitime dont la sortante n'est pas encore choisie (une
  entrante d'Extra va dans l'extra, c'est S5). Il devient donc **« incomplet »**, avec un déséquilibre
  dit zone par zone (« main 1 sortante pour 0 entrante, extra 0 sortante pour 1 entrante ») — jamais
  analysé ni imprimé, ce qui est la garantie qui compte. Écart à la lettre de Q8, signalé par la
  relecture indépendante et assumé ; aucun plan de production n'est concerné.
- **Cartes de plan chargées par le store** (relecture, E3) : `loadDeck` et `resumeDraft` chargent les
  objets `Card` des cartes nommées par les plans, comme le comparateur et la fiche le faisaient déjà,
  sinon une carte retirée du side aurait été dite « zone inconnue » au lieu de « plus en side ».
- **`previewOf` sur un plan déjà incomplet ou à revoir** (relecture, C1) : un échange acceptable qui
  ne l'aggrave pas rend `not-ready` (statut et écarts), jamais un aperçu « prêt » sans deck.
- **Q8 mesuré en production** par Célian (7 adversaires, 14 plans, 102 cartes de plan, 0 carte
  d'Extra) : aucun plan existant ne change de statut ; D15 le prouve pour la règle elle-même.

## Réponses

Réponses de Célian, 22 septembre 2026. Le plan est **validé** : révise-le si une réponse le
demande, puis exécute la phase 2, partie par partie, dans l'ordre A → E.

- **Q1 — Oui**, la règle des 3 copies toutes zones confondues devient celle de l'éditeur et de
  l'import (D10). Un deck existant qui la viole est **averti**, jamais bloqué ni modifié
  d'office ; les statuts de plan et le contrat serveur ne changent pas.
- **Q2 — Oui**, une tuile par carte dans l'onglet side, avec son nom. Les décisions D8 et D16 de
  l'étape 10 sont remplacées ; l'écart au scénario `side` existant est annoncé dans le compte
  rendu de la partie D, comme prévu.
- **Q3 — Oui**, D2 : deux colonnes contre un adversaire, une par plan, et la position gouverne le
  deck étudié (matrice, tuiles, mur de mains).
- **Q4 — Oui**, D6 : l'écart de candidat est « main forte » par défaut, mesuré **par rapport au
  plan actuel**, avec le sélecteur I1 / I2 / I3 dans l'onglet.
- **Q5 — Oui**, les seuils recommandés (aperçu d'une seule passe, chiffre précédent atténué au-delà
  de 150 ms, écarts automatiques sous 3 s d'estimation et à la demande au-delà). Ce sont des
  objectifs mesurés, pas des garanties : si une mesure les dément, dis-le dans le compte rendu de
  la partie concernée plutôt que de dégrader l'exactitude.
- **Q6 — Oui**, D14 : en contexte sidé, les tuiles de l'onglet Annoter montrent les écarts du deck
  étudié, les badges « sort (plan) » et « entre (plan) », et le bandeau « vous annotez le deck de
  base ».
- **Q7 — Oui**, corrige `isMainDeckType` en partie A (les types « Synchro Pendulum Effect Monster »
  et « XYZ Pendulum Effect Monster »). C'est un bogue, pas un changement de règle. Prouve par le
  rapport `--gap` et par D15 qu'aucun deck de l'archive du 8 septembre ne change de chiffres.
- **Q8 — Mesuré en production le 22 septembre 2026** (requête en lecture seule sur le VPS, demandée
  explicitement par Célian) : 7 adversaires, 14 plans, 102 cartes de plan, **0 carte d'Extra Deck
  entrante, 0 sortante**, et aucun deck ne contient de Pendule d'Extra. Aucun plan existant ne
  change donc de statut. Le changement de statut reste autorisé pour l'avenir, comme prévu.
- **Q9 — Avertir sans bloquer** (D9). Un deck hors format garde ses chiffres : quelqu'un qui
  construit son deck ne doit pas être puni.
- **Q10 — Onglet side seulement** : au téléphone, le panneau passe sous le contenu dans cet onglet,
  pas ailleurs.
- **Q11 — L'URL seule.** Rouvrir un deck depuis l'accueil repart du deck de base.
- **Q12 — Oui**, « Annuler l'échange » et « Vider le plan » font partie de ce chantier (D13).
- **Q13 — Ne touche pas au moteur ici.** La lenteur des gros decks à paires est un défaut
  préexistant : consigne les mesures, et elle fera l'objet d'un chantier de performance séparé.

## 12. Compte rendu de la partie A — règles pures (22 septembre 2026)

**Périmètre** : tout ce qui se décide sans interface ni store — zones de plan, échange par zone,
légalité, deck étudié, aperçu et candidats en pur, non-régression prouvée, contrat. Aucun composant
refondu (les appelants sont seulement adaptés à la nouvelle signature), aucune migration, aucune
route, moteur intact.

### Livré

- `server/src/domain/cardDefaults.ts` : motif des types d'Extra Deck corrigé (Q7 : « Synchro Pendulum
  Effect Monster », « XYZ Pendulum Effect Monster »), `deckZoneOfType(type)` → `main` / `extra` /
  `null` (jamais deviné). Fichier dans `__ENGINE_VERSION__` : aperçus et chiffres de plan périmés une
  fois au prochain déploiement, recalculés à l'identique (preuve ci-dessous).
- `web/src/lib/sidePlan.ts` : `applyPlan(deck, plan, zoneOf)` — sortantes prises dans la zone que leur
  type désigne, entrantes dans le side, équilibre zone par zone (S6), main ET extra dérivés (l'extra
  jamais dans le moteur, S7), convention 1–3 sur les deux zones dérivées, écarts avec zone,
  `unknown-zone` (S5). `sidedSource`, `planFingerprint`, `usablePlanSummary`, `neutralizedSources`
  inchangés.
- `web/src/lib/matchups.ts` : `trySwap` (règle unique de l'échange : zone inconnue, sélection vide,
  déséquilibre par zone, carte des deux côtés, écart créé), `swapInPlan` sur un `SwapDelta`, `undoSwap`
  (exact, jamais sous zéro, sans rééquilibrage), `clearPlan` (note conservée), `addCopies` /
  `removeCopies` / `withSwap` / `countByZone` exportés, `describeIssue` avec zones.
- `web/src/lib/zones.ts` : `zoneOfCatalog(cards)`, `totalCopies`, `deckLegality` (main hors 40–60,
  extra / side > 15, 3 copies toutes zones, `wrong-zone`), `describeDeckIssue` (S8, S9, D9, D10).
- `web/src/lib/studiedDeck.ts` (D16) : `studiedDeck` / `studiedDecks` (deck de base ou deck après le
  plan de la position, `source` nulle si le plan n'est pas prêt, libellé, raison), `sameMain`.
- `web/src/lib/swapPreview.ts` (D5, D6) : `previewOf` (aperçu = ce que donnerait « Échanger », rien
  d'autre ; `affectsEngine`), `candidatesOf` (main seulement, à une copie près, partie Extra de la
  sélection laissée de côté), `candidateInputs` (dédoublonnage par entrée du moteur), `candidateDelta`,
  `CANDIDATES_AUTO_MS = 3000`, `estimateCandidatesMs`, `freeCopies`, `adjustSelection`.
- Appelants adaptés (aucune refonte) : `lib/comparison.ts`, `lib/sideSheet.ts` (+ paramètre `zoneOf`),
  `SideSheet.tsx`, `SidePlanner.tsx`, `store/deckStore.ts` (`swapInPlan` passe les trois zones et
  `zoneOfCatalog(s.cards)`).
- Contrat : `docs/regles-metier.md` §2 (3 copies toutes zones = règle de l'éditeur et de l'import) et
  §8 « Plans de side v2 » (S1–S10 + « Défaire ») ; §9 R2 précisée. DECISIONS.md, décisions compressées,
  AGENTS.md (piège « zone déduite du type, cartes de plan à charger, `trySwap` unique, copie figée »).

### Tests

Nouveaux : `lib/sidePlanLegacy.test.ts` (D15 : copie figée de l'`applyPlan` de 471fadd, 8 plans des
fixtures e2e `side` / `sidesheet` — statut, main dérivé, taille, écarts, entrée du moteur, empreinte —
et 500 plans tirés au sort par générateur déterministe, les trois statuts exercés), `lib/zones.test.ts`,
`lib/studiedDeck.test.ts`, `lib/swapPreview.test.ts` (dont la garde croisée « ce que l'aperçu refuse,
Échanger le refuse avec la même raison »). Étendus : `lib/sidePlan.test.ts` (bloc Extra Deck),
`lib/matchups.test.ts` (annuler / vider, échange par zone, zone inconnue),
`server/tests/cardDefaults.test.ts` (les 29 types du catalogue, `deckZoneOfType`).

**Tests existants modifiés** (annoncés, pour la signature ou la zone, jamais pour faire passer du
code) : `sidePlan.test.ts` (`applyPlan(src, plan, MAIN)`, écarts avec `zone`), `matchups.test.ts`
(même chose, `SwapDelta`), `sideSheet.test.ts` (`sheetOf(…, zoneOf, version)` ; `compareSideOf` reçoit
un catalogue typé au lieu de `{}` — un échange exige désormais la zone), `store/sidePlans.test.ts`
(cartes typées dans `cards`), `server/tests/cardDefaults.test.ts` (les deux types d'Extra passent
côté exclus).

### Vérifications exécutées

- `npm run typecheck` (serveur, web, scripts) · `npm run build` (avertissement ExcelJS attendu) ·
  `node scripts/test-quiet.mjs` : **355 tests web** (309 avant la partie), **22 serveur**, tous verts.
- Aucune migration ni script de deploy/ touché → ni `test-migration-sequence.sh`, ni `rehearsal.sh`,
  ni tests d'intégration PostgreSQL (aucune route ni schéma modifié) ; aucune interface refondue →
  pas d'e2e pour cette partie (l'e2e complet sera rejoué en C, D et E). Ces trois familles seront
  toutes rejouées avant la clôture du chantier.
- **Preuve Q7 (rapport `--gap` avant / après)** : archive du 8 septembre restaurée sur un conteneur
  jetable (`testhand-side-v2-gap`, 55447, détruit), séquence schéma → 001 → 002 → 004 → 005 → 006 →
  003 (empreinte `e0efff5c2ddacc8d27bbd9e9e76694b1` reproduite) ; `annotations-report.ts --gap` lancé
  avec le `cardDefaults.ts` de 471fadd (fichier remplacé le temps du rapport, restauré et vérifié par
  SHA-256 identique) puis avec le fichier corrigé. Diff : **14 lignes, toutes dans le tableau du
  catalogue entier** (excluded 2 400 → 2 418, soit les 18 cartes ; byName 4 623 → 4 612, summonOnce
  97 → 96, soft 1 279 → 1 274, none 6 117 → 6 116) ; les sections « cartes jouées », « profils
  proposés » et « écart par deck » sont identiques octet pour octet : **aucun des 16 decks ne change
  de chiffres**.

### Contrôle par mutation (8 posées : 7 détectées, 1 équivalente)

| # | Mutation | Garde qui tombe |
| --- | --- | --- |
| M1 | Équilibre jugé toutes zones confondues (S6) | `sidePlan.test.ts` « une sortante du main contre une entrante d'Extra est incomplet » |
| M2 | `trySwap` ne compare plus zone par zone | `matchups.test.ts` « refus nommé, zone par zone » et `swapPreview.test.ts` (aperçu déséquilibré) |
| M3 | Zone inconnue devinée « main » | `zones.test.ts` `zoneOfCatalog` et `cardDefaults.test.ts` |
| M4 | Copies engagées comptées comme libres pour les candidats | **Non détectée — équivalente** : `trySwap` refuse le candidat par `incoming-missing` / `outgoing-missing` ; le filtre des copies libres est une économie de calcul, pas une règle. Une première forme de M4 (cartes d'Extra candidates) était équivalente pour la même raison. |
| M5 | Entrante déjà en main ajoutée en fin de liste (ordre du main dérivé) | `sidePlanLegacy.test.ts` (D15 : mains dérivés et empreintes ≠ 471fadd) |
| M6 | Motif des types d'Extra ramené au bogue de Q7 | `cardDefaults.test.ts` (29 types) |
| M7 | « Annuler l'échange » passe sous zéro | `matchups.test.ts` « annuler après une retouche : jamais sous zéro » (garde renforcée pour elle) |
| M8 | Légalité sans les copies du side (S9) | `zones.test.ts` « 3 copies toutes zones confondues » |

Mutations posées par script sur les vrais fichiers, restaurés après chaque passage et vérifiés par
SHA-256 identique. Deux gardes avaient d'abord laissé passer M4 (Extra candidat) et M7 : la première
s'est révélée équivalente, la seconde a été renforcée (retouche partielle, puis annulation).

### Relecture indépendante

Sous-agent à contexte neuf, mandat : confronter la partie A au prompt et au plan, avec preuves
(fichier:ligne, sorties de commandes ; sonde temporaire créée puis supprimée, arbre vérifié). Verdict :
**recevable, rien de bloquant, quatre points à corriger**, tous corrigés avant le tag :

- **E1 / C2** — un plan d'avant la v2 qui faisait entrer une carte d'Extra dans le main devient
  « incomplet » sans écart nommé, et le message additionnait les zones (« 1 sortante pour 1 entrante »).
  Corrigé : déséquilibre dit **zone par zone** (« main 1 sortante pour 0 entrante, extra 0 sortante pour
  1 entrante ») par `unavailableReasonOf` ; le statut « incomplet » au lieu de « à revoir » est un écart
  à la lettre de Q8, assumé et expliqué en §11 (rien dans les données ne distingue ce plan d'un
  échange d'Extra légitime en cours).
- **C1** — `previewOf` rendait `ready` avec `applied.main === null` sur un plan déjà incomplet ou à
  revoir (échange acceptable qui n'aggrave rien). Corrigé : `kind: 'not-ready'` avec le plan appliqué ;
  test ajouté.
- **E3** — `loadDeck` et `resumeDraft` ne chargeaient pas les objets `Card` des cartes de plan retirées
  du deck : « zone inconnue » au lieu de « plus en side ». Corrigé (`planCardIds`), garde dans
  `store/recompute.test.ts`.
- **E2** — contrat §2 en avance sur le code (refus des 3 copies dit livré) : reformulé (avertissement en
  A, refus en D) ; §8 précise quelles règles entrent en vigueur avec quelle partie.
- **C3** — le message « à revoir » ne nommait pas la carte : il passe par `describeIssue` (nom en
  paramètre facultatif de `studiedDeck`).
- Remarques suivies : en-tête de la copie figée reformulé (E4 : logique identique, deux aides
  déplacées, types renommés), S7 précisée « à version de moteur donnée » (E5).
- Confirmé par la relecture : copie figée sémantiquement identique à 471fadd, règle unique de l'échange,
  `planFingerprint` intact, `lib/sidePlan.ts` hors empreinte, `cardDefaults.ts` seul fichier modifié dans
  l'empreinte, contrat serveur et migrations inchangés, 353 + 22 tests verts (355 après ses corrections), docs conformes au code.
  Non vérifié par elle : le rapport `--gap` (conteneur détruit), le build, les mutations.

### Écarts au plan

- `applyPlan(deck, plan, zoneOf)` au lieu de cinq arguments, `swapInPlan` sur un `SwapDelta`,
  `sheetOf` avec `zoneOf` (§11).
- Les candidats laissent de côté la partie Extra de la sélection (D6 ne le disait pas) : sans cela,
  une sortante d'Extra encore déséquilibrée privait le main de tous ses écarts, alors que l'Extra ne
  change aucun chiffre (S7).
- `deckLegality` nomme aussi `wrong-zone` (§11).
- Q8 : « incomplet, zone par zone » au lieu de « à revoir nommé » (§11, relecture E1).
- Deux filtres de `candidatesOf` (carte d'Extra, copies libres) sont redondants avec `trySwap` :
  conservés comme économie de calcul, dits tels quels dans le code.

### Non fait / reporté

- Store, contexte d'étude, aperçu et candidats **calculés** (partie B) ; barre de contexte et
  consommateurs de chiffres (C) ; onglet side refondu, règle des 3 copies dans `addCard` /
  `setCopies` / import (D) ; fiche et PDF avec Extra (E).
- `undoSwap` et `clearPlan` ne sont pas encore branchés au store (B) ; `previewOf` `not-ready` à
  afficher en D.
- Conséquence de S5 à surveiller après déploiement : une carte absente du catalogue chargé ne peut
  plus être échangée (§11).
- Rien n'est poussé ; aucune commande vers la base de dev, le VPS ni Supabase.

## 13. Compte rendu de la partie B — store et calcul (22 septembre 2026)

**Périmètre** : l'orchestration. Le store connaît le contexte d'étude (adversaire + position), calcule
les deux decks étudiés, l'aperçu d'une sélection et les écarts des candidats, et reflète le contexte
dans l'URL. Aucun composant n'affiche encore ces états (C et D) ; `SidePlanner` garde son propre
client jusqu'à D.

### Livré

- `web/src/worker/*` : mode `second` (passe second seule), symétrique du mode `first` ; `notComputedPass`
  dit laquelle des deux passes a été demandée.
- `web/src/store/study.ts` (nouveau, orchestration seulement — les règles sont dans lib/) :
  - **decks étudiés** (D1, D2, D4) : `studiedDeck` par position ; plan vide, main identique **ou même
    entrée du moteur** que le deck de base (échange neutre) → `reusesBase`, aucun calcul ; sinon calcul
    par **entrée** (deux positions au même deck sidé = une tâche), en deux temps — `passes` puis `full`
    pour les écarts de tuile — sur le client principal, derrière le deck de base ; cache par entrée
    (32 entrées) ; réponse adoptée seulement si sa clé est encore attendue ; résultat précédent gardé
    `stale` en attendant ;
  - **aperçu** (D5) : `previewOf` puis, si l'entrée diffère de celle du plan, la seule passe de la
    position sur un client dédié, regroupée à 50 ms, annulée à chaque changement ; passe déjà connue
    (cache, deck de base frais, deck étudié frais) servie sans calcul ; ancien chiffre gardé `stale` ;
  - **candidats** (D6, Q5) : `candidatesOf` + `candidateInputs` ; passes connues déduites ; estimation
    = entrées inconnues × dernière passe mesurée de la position (`lastPassMs`, sinon `computeMs`) ;
    automatique si ≤ `CANDIDATES_AUTO_MS` (3 s), sinon `pending` jusqu'à `runCandidates` ; troisième
    client, tâches annulées dès que la sélection change ; `candidateDeltaOf` = candidat − plan ;
  - **chiffres de plan persistés** (D17, déplacé de `SidePlanner`, qui le fait encore jusqu'à D) :
    deck sans modification non enregistrée, révision lue, une fois par empreinte ;
  - `openPlan`, `studiedPass`, `resetStudyEngine` (tests).
- `web/src/store/deckStore.ts` : état transitoire `study`, `studied`, `selection`, `swapHistory`,
  `preview`, `candidates`, `candidateIndicator`, `lastPassMs` (jamais dans la configuration ni le
  brouillon) ; actions `setStudy`, `setSelection`, `adjustSelectionCopy`, `clearSelection`,
  `commitSelection` (règle `trySwap`, historique), `undoLastSwap`, `clearOpenPlan`,
  `setCandidateIndicator`, `runCandidates` ; `setContext` abandonne sélection et historique (le plan
  ouvert change) ; toute mutation d'un plan ou d'une zone resynchronise decks étudiés, aperçu et
  candidats ; `loadDeck` remet tout à zéro ; un enregistrement réussi relance la persistance des
  chiffres.
- `web/src/lib/studyUrl.ts` + `lib/router.tsx` + `EditorPage.tsx` : `?contre=<adversaire>&position=`
  lu à l'ouverture, reflété par `replaceState` à chaque changement (D1, Q11) ; `App.tsx` passe
  `initialStudy`.

### Tests

Nouveaux : `store/study.test.ts` (12 : réutilisation du deck de base — sans adversaire, plan vide,
échange neutre —, passes puis complet derrière la base, dédoublonnage de deux positions, plan pas
prêt, cache et réponse périmée jamais adoptée, aperçu sur son propre worker et jamais « non
enregistré », annulation et cache de l'aperçu, échanger / annuler / vider / refus / changement de
position, candidats automatiques et écarts contre le plan, candidats au-delà du budget puis annulés,
persistance des chiffres, `loadDeck`), `lib/studyUrl.test.ts` (2). Harnais : un client par
`createEngineClient()` (comme l'application) et journal chronologique des requêtes tous workers
confondus. Aucun test existant modifié.

### Vérifications exécutées

- `npm run typecheck` (serveur, web, scripts) · `npm run build` (avertissement ExcelJS attendu) ·
  `node scripts/test-quiet.mjs` : **373 tests web** (355 après A), **22 serveur**, tous verts.
- `npm run e2e -w web` (pile jetable, ports web déplacés par `E2E_WEB_PORT` / `E2E_BASE`) : **11 scénarios OK** (setup, guards, compare, mobile, home, conditions, nonengine, extraside, side,
  sidesheet, defaults), dont `side` et `sidesheet` sur le store de B ; aucun scénario nouveau (aucune
  interface nouvelle en B).
- Ni migration, ni schéma, ni route, ni deploy/ touchés → ni tests d'intégration PostgreSQL, ni séquence,
  ni répétition pour cette partie (rejoués avant la clôture du chantier).

### Contrôle par mutation

10 posées : 9 détectées, 1 équivalente (jouées après les corrections de la relecture).

| # | Mutation | Garde qui tombe |
| --- | --- | --- |
| B1 | Changer de position garde la sélection et l'historique | `study.test.ts` « Échanger… changer de position abandonne » |
| B2 | L'aperçu marque le deck « non enregistré » | `study.test.ts` « jamais non enregistré » |
| B3 | Chiffres d'un plan persistés même « non enregistré » | `study.test.ts` « seulement pour un deck sans modification » |
| B4 | Une entrée déjà en cours de calcul est relancée à chaque resynchronisation | `study.test.ts` « deux positions au même deck sidé » (garde renforcée pour elle : resynchronisation pendant le calcul) |
| B5 | Échange neutre recalculé au lieu de réutiliser le deck de base | `study.test.ts` « échange neutre » et « candidats… écarts contre le plan » |
| B6 | Candidats lancés quel que soit le budget | `study.test.ts` « au-delà du budget » |
| B7 | Aperçu en deux passes au lieu de la seule passe de la position | `study.test.ts` « une seule passe » (mode `second`) et candidats |
| B8 | Position inconnue acceptée dans l'URL | `studyUrl.test.ts` |
| B9 | Ouvrir un autre deck garde le contexte et la sélection | `study.test.ts` « loadDeck repart du deck de base » |
| B10 | Une annotation sur une carte de side ne resynchronise plus le deck étudié (relecture C1) | `study.test.ts` « une annotation sur une carte de side… resynchronise » |
| — | Réponse adoptée pour une clé qui n'est plus attendue (garde retirée) | **Équivalente** : une réponse est une fonction pure de sa clé d'entrée, l'adopter ne change aucun chiffre et le client ignore déjà une réponse annulée ; la garde reste défensive, comme la seconde garde de l'étape 4. Remplacée par B1. |

Mutations posées par script sur les vrais fichiers, restaurés et vérifiés par SHA-256 identique.

### Relecture indépendante

Sous-agent à contexte neuf (mandat : confronter la partie B au plan et au prompt, preuves exigées,
rien d'écrit). Verdict : **recevable sur l'architecture, un défaut bloquant, trois à corriger**, tous
corrigés avant le tag, plus les remarques suivies :

- **C1, bloquant** — une annotation portée par une carte de side (starter, paire, condition, mortes ;
  HOPT, profil, plafond du compte) ne changeait pas le deck de base (`modelUnchanged`), donc ne
  resynchronisait ni le deck étudié, ni l'aperçu, ni les candidats : un chiffre aurait pu s'afficher
  sous le nom du deck sidé sans correspondre à son entrée — l'échec « le plus grave » du §9. Corrigé :
  `annotationCalc` et `libraryCalc` appellent `studySync()` quand le deck de base ne bouge pas ; garde
  « une annotation sur une carte de side… resynchronise » ; mutation B10.
- **C2** — `lastPassMs` était posé à `ms / 2` pour les deux positions à chaque réponse, résultat
  complet compris (surestimation ×2 à ×4 sur les gros decks → « à la demande » à tort), et écrasait
  les mesures exactes de l'aperçu et des candidats. Corrigé : première estimation depuis les passes
  seulement, jamais depuis un résultat complet, jamais par-dessus une valeur déjà mesurée.
- **C3** — `lastPassMs` survivait à `loadDeck` (budget d'un deck léger appliqué à un deck lourd).
  Corrigé : remis à zéro dans `freshStudy`, comme la position (voir E5) ; garde dans « loadDeck ».
- **C4** — annuler k candidats en ordre de dépôt provoquait k terminaisons de worker et k(k−1)/2
  reposts (`computeClient.cancel` tient la première tâche en attente pour « en cours »). Corrigé :
  annulation en ordre inverse (les tâches en attente retirées sans effet, la tâche en cours terminée
  une fois) ; idem dans `reset()`.
- **C5** — sur un plan pas prêt, l'aperçu retombait sur « les chiffres du plan » (clé de base) alors
  que le plan n'en a pas. Corrigé, et la règle déplacée en lib : `previewOf` reçoit la source et juge
  `affectsEngine` sur l'**entrée du moteur** (échange neutre = sans effet) quand le plan est prêt ;
  l'orchestrateur n'écrase plus ce champ.
- **C6** — un résultat périmé d'un autre adversaire restait affiché sous le nom du nouveau. Corrigé
  (gardé seulement pour le même adversaire) ; garde « jamais un chiffre de M1 sous le nom de M2 ».
- **C7** — `knownPass` consulte aussi le cache des résultats complets. **C8** — un brouillon repris
  abandonne sélection et historique. **C11** — une panne de persistance laisse un nouvel essai.
- **E1** — `setStudy` regroupe comme le deck de base (`scheduleStudied`) : à l'ouverture par l'URL,
  le deck de base est bien posté avant le deck sidé (D4) ; test réécrit dans ce sens. **E5** — la
  position repart à « premier » à l'ouverture d'un deck (Q11 : le contexte vient de l'URL seule).
  **E2 / E3 / E4** — écarts au plan dits ci-dessous. **E7** — motif de `cancelAll` reformulé.
- **Tests (T1, T2)** — le test « réponse jamais adoptée » renommé pour ce qu'il prouve (tâche annulée,
  worker terminé) ; écart d'un candidat prouvé contre un plan **différent** du deck de base (candidat
  neutre = 0 exactement, alors que le plan diffère de la base).
- Non retenu : **C9** (`freeCopies` sur main + extra confond une carte présente dans les deux zones —
  deck déjà hors format) et **C10** (`popstate` vers le même deck avec un autre contexte) : marginaux,
  notés pour C.
- Confirmé par la relecture : trois clients, réponse adoptée seulement si sa clé est attendue, aperçu
  et sélection hors `markDirty` / brouillon / configuration, persistance sous les bonnes gardes, rien
  sous `engine/`, `server/src`, `db/`, `lib/sidePlan.ts` ; `planFingerprint` intact.

### Écarts au plan

- D4 : « même entrée que le deck de base » remplace « même main » pour réutiliser le résultat de base
  (un échange neutre ne se recalcule pas) ; l'aperçu et les candidats réutilisent de même toute passe
  déjà connue (cache, base fraîche, deck étudié frais). Cache de 32 entrées au lieu de 16.
- §5.3 annonçait deux clients : trois (principal, aperçu, candidats), l'aperçu ne devant jamais attendre
  derrière un `computeAll`.
- §7 annonçait `store/selectors.ts` et `store/preview.test.ts` étendus : les sélecteurs de chiffres
  (`studiedPass`, `candidateDeltaOf`) vivent dans `store/study.ts` ; `preview.test.ts` (aperçu de
  l'accueil, étape 9) n'avait rien à gagner. Les consommateurs arrivent en C.
- Q11 étendue : la position repart aussi à « premier » à l'ouverture d'un deck (elle est désormais
  visible dans l'URL).
- `SidePlanner` garde son client et sa persistance jusqu'à la partie D : quand l'adversaire étudié est
  celui de l'onglet, le deck sidé peut être calculé deux fois (une fois par le store, une fois par
  l'onglet) et le même chiffre persisté deux fois à l'identique — transitoire, sans effet visible.

### Non fait / reporté

- Parties C (barre de contexte, consommateurs), D (onglet), E (fiche, clôture).
- Le budget réel dans le navigateur (worker, téléphone) reste à mesurer en C / D ; `lastPassMs` est
  mesuré à la première passe de chaque position.

## 14. Compte rendu de la partie C — l'éditeur en contexte (22 septembre 2026)

**Périmètre** : ce que l'utilisateur voit. Une barre de contexte, et tous les consommateurs de chiffres
lisent le deck étudié et le nomment. L'onglet « Plans de side » n'est pas refondu (D).

### Livré

- `store/study.ts` : sélecteurs `columnOf(s, position)` (S1 : nom du deck ; S2 : rien sans plan prêt,
  raison ; S3 : l'aperçu prend la place dans la position ouverte, ancien chiffre atténué en attendant)
  et `studiedSource(s, position)` (source du moteur du deck étudié). `store/selectors.ts` : le mur tire
  et note dans le deck étudié.
- `components/StudyBar.tsx` (nouveau, D3) : sous l'en-tête, sur tous les onglets — sélecteur natif du
  deck étudié (« Deck de base » / « contre X »), bascule Premier / Second (24 px), raison d'un plan
  sans chiffre, avis « adversaire introuvable », une ligne de 32 px à 360 px. Les bascules du panneau
  « Probabilités » et du mur de mains sont retirées : une seule commande.
- `StatsPanel.tsx` : deux colonnes, chacune sur le deck étudié de sa position, nommée
  (`data-study-label`, `data-study-kind` = base / sided / preview), atténuation par colonne, plan pas
  prêt = raison seule, matrice nommée (`data-matrix-title`), cartes sans profil du deck sidé.
- `QueryMode.tsx` : probabilités sur les deux decks étudiés, nommées, « — » avec la raison.
- `HandWall.tsx` : mains tirées et notées dans le deck étudié de la position (S1), raison à la place
  des mains (S2), nom du deck dans la barre du mur.
- `AnnotationGrid.tsx` + `CardTile.tsx` (D14, Q6) : écarts de tuile du deck étudié (résultat complet
  du deck sidé, ou du deck de base réutilisé), badge « sort ×n » / « entre ×n », « sort (plan) » à la
  place de l'écart d'une carte entièrement sortie, écart à la place de « hors calcul » pour une carte
  de side entrante, bandeau « vous annotez le deck de base ».
- `EditorPage.tsx` : la barre rendue après le bandeau des annotations par défaut.
- e2e `study` (nouveau) ; `guards` et `mobile` : les deux gardes de la bascule de contexte désignent
  la barre (`[data-study-bar]`) ; `guards` : « premier contenu » à 360 px ≤ 180 px au lieu de 140
  (la barre ajoute 32 px de chrome ; mesuré 162 px). Charte §6.2 et §6.3, AGENTS.md.

### Tests

`store/study.test.ts` (+3 : colonnes deck de base / plan pas prêt, deck sidé et mur tiré dedans,
aperçu dans la colonne), e2e `study` (C1–C7 à 1440, puis 360 / 390 / 768 / 1440 ; P(≥ 1) à l'écran
strictement égal au chiffre persisté lu par l'API). Tests existants modifiés : `guards.mjs` (seuil et
sélecteur, annoncés ci-dessus), `mobile.mjs` (sélecteur de la bascule), tous deux pour D3.

### Vérifications exécutées

- `npm run typecheck` (serveur, web, scripts) · `npm run build` (avertissement ExcelJS attendu) ·
  `node scripts/test-quiet.mjs` : **376 tests web** (373 après B), **22 serveur**, tous verts.
- `npm run e2e -w web` complet sur le code final : **12 scénarios OK** (les 11 existants, dont `guards`
  et `mobile` avec leurs gardes déplacées sur la barre, et `study` C1–C7 aux quatre largeurs). Premier passage de `guards` : « premier contenu
  à 205 px » à 360 px — la barre tenait sur deux lignes ; contrôles ramenés à 24 px (32 px de barre,
  premier contenu à 162 px), seuil relevé à 180. Premier passage de `study` : deux gardes du scénario
  en échec, aucune de l'application — un plan neutre ne change pas les chiffres (S7 : Side Rho est
  désormais starter dans la fixture) et le titre de la matrice est en majuscules CSS (comparaison
  insensible à la casse, même piège qu'en 10C). Un 404 en console (chiffres persistés pour un volet
  absent du plan enregistré) corrigé dans `persistSummary`.
- Ni migration, ni schéma, ni route, ni deploy/ touchés → ni intégration PostgreSQL, ni séquence, ni
  répétition pour cette partie (rejoués avant la clôture).

### Contrôle par mutation

5 posées, 5 détectées (garde C5 renforcée pour la dernière).

| # | Mutation | Garde qui tombe |
| --- | --- | --- |
| C1 | Un plan pas prêt affiche les chiffres du deck de base à sa place (S2) | `study.test.ts` « colonnes… plan pas prêt : aucune passe, raison » |
| C2 | L'aperçu n'est jamais montré dans la colonne (S3) | `study.test.ts` « aperçu (S3) : la colonne prend la passe de l'aperçu » |
| C3 | Le mur tire dans le deck de base au lieu du deck étudié (S1) | `study.test.ts` « le mur tire dans le deck sidé » (la carte entrée se tire) |
| C4 | La colonne d'un deck sidé se nomme « Deck de base » (S1) | `study.test.ts` (libellés des colonnes) |
| C5 | Le mur note avec la passe du deck de base | `study.test.ts` « notées avec le modèle ET la passe du deck sidé » (égalité stricte avec `evaluateHands`, inégalité avec la passe de base) |

Mutations posées par script sur les vrais fichiers, restaurés et vérifiés par SHA-256 identique. Les
gardes visuelles (badges, bandeau, barre) sont tenues par l'e2e `study`, non mutées.

### Relecture indépendante

Sous-agent à contexte neuf (mandat : invariant d'affichage endroit par endroit, D2 / D3 / D14 /
S1–S3, cas limites de `columnOf`, mur, tuiles, mobile, gardes e2e, style). Verdict : **recevable,
rien de bloquant, quatre points à corriger**, tous corrigés avant le tag, plus des remarques suivies :

- **E1** — en contexte sidé, tant que le résultat complet du deck sidé n'était pas là, les tuiles
  affichaient un blanc — qui signifie un écart nul exact (D4 violée pendant 0,5 à 1 s). Corrigé :
  « … » (`data-delta-pending`) tant que les écarts manquent ; garde e2e C6 sur la valeur d'un écart
  du deck sidé (Side Rho, Starter Alpha : « −1 : … » non vide).
- **C1** — le mur de mains aurait suivi l'aperçu dès D (mains tirées dans le deck du plan, notées avec
  la passe de l'aperçu, signatures d'un autre modèle). Corrigé : `columnOf(…, false)` — le mur
  montre le plan, jamais l'aperçu (l'aperçu est dans le panneau) ; test étendu.
- **C3** — l'atténuation et l'infobulle « recalcul en cours » d'une tuile lisaient la péremption du deck
  de base même en contexte sidé. Corrigé (`deltaStale` du deck étudié).
- **C7** — badges « sort / entre » posés même pour un plan incomplet ou à revoir, bandeau « chiffres
  du deck étudié » sous un plan sans chiffre, bandeau pour un adversaire introuvable. Corrigé :
  badges pour un plan prêt seulement, bandeau qui porte la raison, aucun bandeau sans adversaire.
- **C6** — messages du mur en contexte sidé (« Calcul initial… », « Charge un deck… » en cas d'erreur).
  Corrigés.
- **E2 / C4** — la garde e2e « P(≥ 1) à l'écran = chiffre persisté » compare deux lectures du même
  store : elle prouve que la persistance D17 atteint l'API depuis l'onglet Annoter et que la colonne
  affiche la passe persistée, pas que le chiffre est le bon ; la garde « le deck sidé change le
  chiffre » attrape une colonne qui montrerait le deck de base. L'identité avec le comparateur sidé
  et l'onglet, annoncée en §8, n'est pas rejouée par l'e2e : elle repose sur `lib/sidePlan.test.ts`
  (deck sidé = main édité à la main, indicateurs = mode Requête) et `lib/sideSheet.test.ts`
  (comparateur sidé = `applyPlan`). Dit en « Écarts au plan ».
- **E3 / E4** — charte : 24 px (pas 28) ; la barre tient sur une ligne à 360 px sans raison de plan,
  une raison passe à la ligne (non mesurée à 360 px avec un plan incomplet : noté pour D, qui
  refond l'onglet et rejouera les largeurs).
- **E6** — `selectDeltas` (code mort) retiré ; règle d'AGENTS.md reformulée (lire `s.result` reste
  juste pour le deck de base lui-même).
- **E5** — deux commandes de position dans l'onglet side (barre + onglet) jusqu'à D : accepté.
- Confirmé par la relecture : chaque bloc chiffré rendu en C lit `columnOf` / `studiedSource` et nomme
  son deck ; aucun `columnOf` dans un sélecteur `useDeck` ; style conforme (aucune couleur ni taille en
  dur) ; typecheck et 52 tests ciblés verts.

### Écarts au plan

- La bascule Premier / Second n'apparaît qu'une fois, dans la barre (D3) : les gardes e2e qui la
  cherchaient dans le panneau et dans le mur ont été déplacées ; le seuil « premier contenu ≤ 140 px »
  de l'audit 01 passe à 180 px, la barre étant une ligne de chrome décidée par D3.
- Le scénario e2e a d'abord posé un plan **neutre** (Side Rho non annotée) : les chiffres du deck sidé
  étaient ceux du deck de base — c'est juste (S7). Side Rho est désormais starter dans la fixture du
  scénario, restaurée en fin de scénario.
- §8 annonçait une égalité e2e des chiffres avec l'onglet side et le comparateur sidé : non rejouée par
  l'e2e (relecture E2) ; l'égalité est tenue par les tests purs (`sidePlan.test.ts`, `sideSheet.test.ts`)
  et la garde e2e « le deck sidé change le chiffre » attrape une colonne qui montrerait le deck de base.
- Le mur de mains ne suit pas l'aperçu (relecture C1) : D5 ne le demandait pas, S3 place l'aperçu
  dans le panneau ; des mains tirées dans un deck et notées avec la passe d'un autre seraient fausses.

### Non fait / reporté

- Onglet « Plans de side » (D) : aperçu et candidats ne sont pas encore affichés là ; `SidePlanner`
  garde son client.
- Panneau sous le contenu au téléphone dans l'onglet side (D12, Q10) : partie D.
- Fiche et PDF (E).

## 15. Compte rendu de la partie D — l'onglet « Plans de side » refondu (22 septembre 2026)

**Périmètre** : l'onglet qui aide à choisir. Une tuile par carte, la sélection alimente l'aperçu et les
écarts des candidats du store, l'Extra Deck entre dans les plans, annuler / vider, raisons visibles et
« Enregistrer et ouvrir », panneau sous le plan au téléphone, règle des 3 copies dans l'éditeur et
l'import.

### Livré

- `SidePlanner.tsx` réécrit : l'adversaire ouvert **est** l'adversaire étudié (puce = `setStudy`, le
  premier est ouvert quand aucun ne l'est), la position est celle de la barre (plus de bascule dans
  l'onglet, relecture C E5) ; **une tuile par carte** (`ChoiceTile`, Q2 : image, nom, « libres / copies »,
  badge « sort ×n » / « entre ×n », « +k » sélectionnées, clic = +1, clic droit = −1, menu natif
  neutralisé) ; blocs Main → à sortir, Side → à faire entrer, Extra → à sortir et Side → vers l'extra
  (D8, zone déduite du type ; carte de zone inconnue inerte et dite) ; écarts des candidats sur les
  tuiles (S4 : « · » pour zéro, signe et couleur, « … » en cours), sélecteur I1 / I2 / I3, « Calculer les
  écarts (≈ n s) » au-delà du budget (Q5) ; **barre d'action collante** (sélection, aperçu avec ses trois
  chiffres et l'écart avec le plan (S3), « Vider la sélection », « Échanger » inerte avec la raison
  visible) ; plan : listes « Sort / Entre » (✕ retire toutes les copies, D13), écarts, sources
  neutralisées, chiffres du deck étudié et écart avec le deck de base, « Annuler l'échange »,
  « Vider le plan » (note conservée), recopie, note ; légalité du deck de base en avertissement (S8,
  S9) ; **« Enregistrer et ouvrir la fiche » / « Enregistrer et comparer »** avec la raison visible sans
  survol (D11) ; **panneau « Probabilités » sous le plan** sous 1024 px (D12, Q10). Plus de client de
  calcul ni de persistance propres à l'onglet : le store (B) fait tout.
- `EditorPage.tsx` : `withPanel` sous 1024 px pour cet onglet seulement.
- **Règle des 3 copies toutes zones** (S9, Q1) : `addCard` / `setCopies` refusent au-delà de 3 copies
  toutes zones confondues (message qui nomme la répartition), le dialogue d'ajout dit « max » ;
  l'import rapporte `overTotal` (main, extra, side) et la réduction explicite retire du side, puis de
  l'extra, jamais du main (`clampToConvention`) ; le dialogue de vérification le dit.
- e2e `side` réécrit (P1–P6 : aperçu avant « Échanger » sans « non enregistré », écarts de candidats,
  annuler, retrait depuis la liste, raison visible, barre collante et panneau sous le plan à 360 px) ;
  `extraside` Z3 bis (ajout refusé au-delà de 3 toutes zones).

### Tests

`store/zones.test.ts` et `lib/deckEquivalence.test.ts` **modifiés pour Q1** (une carte à 3 en main ne
peut plus entrer en side : refus nommé ; à 2 en main, acceptée — annoncé ici) ; `lib/ydk.test.ts` (+1 :
`overTotal`, réduction side puis extra, rapport d'origine intact). Aucun test React dans le dépôt :
l'onglet est gardé par l'e2e `side` (réécrit, écart annoncé au §7) et `extraside`.

### Vérifications exécutées

- `npm run typecheck`, `npm run build` (avertissement ExcelJS attendu) : verts.
- `node scripts/test-quiet.mjs` : **377 web + 22 serveur**, verts (+1 garde `store/sidePlans.test.ts` : retrait de
  toutes les copies par le ✕, ajoutée après le contrôle par mutation ; +1 `lib/ydk.test.ts`).
- `npm run e2e -w web` complet, **12 scénarios**, sur le code final (pile jetable 55434 / 8790 / 5178) :
  `setup`, `guards`, `compare`, `mobile`, `home`, `conditions`, `nonengine`, `extraside` (Z3 bis), `side`
  (P1–P6 réécrit, 360 / 390 / 768 px), `sidesheet`, `defaults`, `study`.
- Incidents de la chaîne, tous consignés : (1) Z3 bis — le dialogue d'ajout ne disait pas « max » pour une
  carte à 3 copies dans une AUTRE zone (le clic était refusé en silence) : ligne rendue cohérente avec
  `atMax` (badge « ×n toutes zones · max », bouton inerte, infobulle) ; (2) `side` — boucle de rendu
  (« Maximum update depth exceeded ») : sélecteur `useDeck` rendant un objet neuf (piège déjà écrit en
  AGENTS.md pour la partie C), remplacé par des sélecteurs simples + `useMemo` ; (3) `sidesheet` F2 — course
  connue du scénario (l'onglet éditeur persiste son volet après le premier comptage) : recompte après
  rechargement ; (4) `mobile` — une « strict mode violation » (30 éléments) vue une fois sur un lancement
  complet, non reproduite sur trois relances, sans modification du scénario : consignée comme non reproduite ;
  (5) `defaults` — « login → 429 » quand P6 ouvrait un navigateur (donc une connexion) par largeur : le
  serveur limite le login à 10 par minute ; P6 partage un seul navigateur redimensionné (`setViewportSize`).
- Intégration PostgreSQL, séquence, répétition : non rejouées (ni schéma, ni serveur, ni deploy/ touchés) ;
  intégration à rejouer en E comme promis en C.

### Contrôle par mutation

Script `mutations-d.mjs` (hors dépôt, fichiers restaurés et vérifiés par SHA-256) :

| # | Mutation | Détectée par |
| --- | --- | --- |
| D1 | `addCard` ne compte plus les autres zones (convention par zone seule) | `store/zones.test.ts`, `lib/deckEquivalence.test.ts` |
| D2 | `setCopies` ne compte plus les autres zones | `store/zones.test.ts` |
| D3 | la réduction à l'import retire du main en premier | `lib/ydk.test.ts` |
| D4 | `overTotal` ne rapporte plus rien | `lib/ydk.test.ts` |
| D5 | `removeFromPlan` du store ignore le nombre de copies (le ✕ ne retirerait qu'une copie) | **non détectée au premier passage** : garde ajoutée dans `store/sidePlans.test.ts` (`removeFromPlan(…, Infinity)` vide la liste), puis détectée |

5 / 5 détectées. L'onglet lui-même (aucun test React dans le dépôt) est gardé par les e2e `side` et
`extraside`, non mutés.

### Relecture indépendante

Sous-agent à contexte neuf, sur le code et les captures de la pile en cours (rapport intégral hors dépôt).
Verdict : recevable sur le fond, un défaut bloquant (E1) — celui de l'incident (2) ci-dessus, corrigé pendant
la relecture —, deux manquements à l'invariant d'affichage (E2, E3), quatre écarts (E4–E7), deux remarques
(E8, E9), dix défauts de code ou de test (c1–c10). Traitement :

- **E1** sélecteur objet → boucle de rendu : corrigé (sélecteurs simples + `useMemo`).
- **E2** l'aperçu montrait les chiffres de la sélection précédente comme ceux de la courante pendant le
  calcul (D5) : `PreviewFigures` lit `preview.computing` — chiffres atténués (`opacity-45`),
  « calcul de l'aperçu… », `data-preview="stale"` tant que la nouvelle passe n'est pas là.
- **E3** entre `setStudy` et le regroupement du store (50 ms), l'onglet lisait le deck étudié de
  l'adversaire précédent sous le nom du nouveau : `inSync` (le deck étudié doit porter l'adversaire ouvert),
  sinon statut, tailles, chiffres et écarts sont tenus pour absents (« Calcul du deck sidé… »).
- **E4** barre collante à toutes les largeurs (D12 la voulait sous 1024 px) : `lg:static`.
- **E5** gardes plus faibles que §8 : le scénario `side` clique désormais « Enregistrer et ouvrir la
  fiche » (API : note enregistrée AVANT l'ouverture), puis joue un enregistrement refusé (révision périmée
  par une écriture de l'API → 409 : page en place, alerte « modifié ailleurs », rien d'ouvert), et P6 se joue
  à 360, 390 et 768 px.
- **E6** (les chiffres du plan ne sont pas dans la barre sans sélection) : écart assumé, ajouté ci-dessous.
- **E7** chiffres du plan et aperçu sans le nom de l'adversaire (S1) : « Deck sidé · contre X · … » et
  « aperçu · contre X · … » ; garde P5.
- **E8** l'ouverture automatique du premier adversaire annulait un choix « Deck de base » ultérieur et
  l'avis « adversaire introuvable » de la barre : ouverture à l'arrivée sur l'onglet seulement (`useRef`),
  et seulement si aucun adversaire n'est étudié — décision ajoutée à DECISIONS.md.
- **E9** `aria-label` ajouté sur la tuile (le `title` reste).
- **c1** « +0.0 » sur un écart au bruit flottant : `exact()` (seuil 1e-9, celui de `CardTile`) avant
  « · » dans les chiffres du plan, l'aperçu et les candidats. **c2** valeur fine du candidat dans l'infobulle.
  **c3** « … » seulement quand les candidats tournent (`running`). **c6** « Annuler l'échange » inerte
  (raison en infobulle) quand les copies du dernier échange ont déjà été retirées à la main. **c9** la
  garde P2 dit ce qu'elle prouve (« l'aperçu ne touche pas au plan »).
- Sans suite, consignés : **c4** carte présente en main ET en extra (deck hors format) : `freeCopies` sur
  `[...main, ...extra]` écrase l'entrée main (C9 de B, marginal) ; **c5** un plan rendu incomplet par ✕ ne
  se complète pas par une sélection (écart déjà dit) ; **c7** conforme, gardé désormais par P5 ; **c8** Z3
  bis prouve le libellé et l'absence de tuile, le refus du store reste tenu par les unitaires ; **c10** sous
  1024 px deux `StatsPanel` sont montées (une masquée par CSS, préexistant).

### Écarts au plan

- D7 : « sélecteur de copies à 32 px » remplacé par le geste clic / clic droit sur la tuile (cible ≥ 32 px)
  et le compteur « libres / copies » ; un stepper par tuile aurait doublé la hauteur des grilles.
- La bascule de position de l'onglet disparaît (relecture C, E5) : la barre de contexte est la seule
  commande ; l'onglet dit « plan premier / second ».
- Un échange est équilibré en soi (règle `trySwap`) : une sélection ne « complète » pas un plan
  incomplet ; le scénario `side` P3 rééquilibre en retirant la sortante puis en refaisant l'échange.
- D12 : sans sélection, la barre ne porte que « Sélection : −0 / +0 » et « Échanger » ; les trois chiffres
  du plan restent dans le bloc du plan (E6 de la relecture), la barre ne les répète pas.
- D1 : l'ouverture automatique du premier adversaire ne se fait qu'à l'arrivée sur l'onglet, et seulement
  si aucun adversaire n'est étudié ; « Deck de base » choisi ensuite dans la barre est respecté.

### Non fait / reporté

- Fiche et PDF avec l'Extra (E) ; clôture (E).
- Avertissement « hors format » hors de l'onglet side (l'en-tête ne le dit pas).

## 16. Compte rendu de la partie E — fiche, PDF, clôture (22 septembre 2026)

**Périmètre** : l'Extra Deck dans la fiche imprimable et le PDF (D8), le comparateur vérifié sur un
plan à Extra, la route des chiffres prouvée avec un plan à Extra, la clôture du chantier.

### Livré

- `lib/sideSheet.ts` : `ZoneGroups` et `groupByZone(list, zoneOf)` — les cartes d'un cadre sont
  groupées par zone de jeu (main, puis Extra, puis zone inconnue), jamais mêlées ; `SheetPlan.groups`
  est calculé une fois par `sheetOf` et lu tel quel par l'écran et le PDF (même source, D8).
- `SideSheet.tsx` : dans chaque cadre SORT / ENTRE, les cartes du main puis, sous un intertitre
  « Extra » (`[data-sheet-zone="extra"]`), celles de l'Extra ; « Zone inconnue » (`text-warn`) pour une
  carte dont le type n'est pas chargé (plan « à revoir », déjà signalé sans chiffre). Rien d'autre ne
  change : chiffres, « — », « Tout calculer », noms, impression.
- `lib/sideSheetPdf.ts` : `boxHeight(groups, showNames)` réserve l'intertitre (`PDF.zoneLabelH` = 4 mm)
  et les rangées de chaque groupe ; `drawBox` dessine main, « EXTRA », « ZONE INCONNUE » (ambre) dans
  cet ordre. Le dessin et la hauteur lisent les mêmes groupes.
- Comparateur : inchangé (plan §5.5). Prouvé plutôt qu'affirmé : un plan à Extra se compare sur son
  main dérivé (même main qu'un plan sans Extra au même échange de main) ; un plan d'Extra seul rend le
  deck de base, et la note « matrices identiques » de `engine/compare.ts` le dit.
- Serveur : rien à changer. Le contrôle « main − sortantes + entrantes » de `PUT …/plans/:position/summary`
  compte toutes les zones : juste pour tout plan prêt, équilibré zone par zone (S6, S7) — dit dans le
  test d'intégration 10B, qui porte désormais un échange d'Extra (604 ↔ 605).
- e2e `sidesheet` étendu : fixture avec « Extra Pi » (Fusion, ×1 en extra) et une nouvelle carte
  synthétique « Extra Chi » (90000032, Synchro, ×1 en side) ; le plan premier de « Kewl Tune » les
  échange. F2 : intertitre « Extra » dans SORT et ENTRE de ce volet seulement, Extra Pi / Extra Chi
  dessous, cartes du main hors de l'intertitre, volet prêt ; F3 : chiffres de « Kewl Tune » premier
  = « Yubel » premier (S7 à l'écran) ; F4 : « EXTRA » dans le PDF, 8 illustrations ; F5 : comparateur
  sur le plan premier avec Extra (nommé « (premier) », plan appliqué).

### Tests

`lib/sideSheet.test.ts` (+3 : groupes par zone ; S7 — entrée du moteur et chiffre identiques avec ou
sans Extra, plan d'Extra seul = deck de base au moteur avec extra dérivé ; comparateur sur un plan à
Extra et sur un plan d'Extra seul) ; `lib/sideSheetPdf.test.ts` (+2 : hauteur d'un cadre avec Extra,
bloc plus haut du seul intertitre et de la rangée en plus ; le gabarit de plan du test porte `groups`).
`server/tests/persistence.integration.ts` 10B : plan à Extra. Aucun test existant modifié pour faire
passer du code.

### Vérifications exécutées

- `npm run typecheck`, `npm run build` (avertissement ExcelJS attendu) : verts.
- `node scripts/test-quiet.mjs` : **383 web + 22 serveur**, verts (+3 `sideSheet.test.ts`, +3 `sideSheetPdf.test.ts`, dont la garde de pagination ajoutée après la relecture).
- Intégration PostgreSQL (conteneur jetable `testhand-step23-db` sur 55433, détruit ensuite) :
  `auth` 13, `persistence` 17 (10B avec un plan à Extra), `purge` 13 — verts.
- `npm run e2e -w web` : `sidesheet` seul d'abord (F1–F5 étendus), puis la suite complète de clôture,
  **12 scénarios verts** sur le code final (pile jetable 55434 / 8790 / 5178), rejouée une seconde fois
  après les retouches de la relecture (attribut d'intertitre, restauration de la fixture sur l'extra).
- Séquence de migration et répétition : non rejouées — aucune migration, aucun script de deploy/ ni
  schéma touché par le chantier (§5.2) ; le déploiement suit la variante « déploiement courant »
  (docs/deploy-runbook.md, C0–C6). `__ENGINE_VERSION__` a changé une fois (correction de
  `cardDefaults.ts`, partie A) : aperçus et chiffres de plan se recalculent à l'identique (D15).

### Contrôle par mutation

Script `mutations-e.mjs` (hors dépôt, fichiers restaurés et vérifiés par SHA-256) :

| # | Mutation | Détectée par |
| --- | --- | --- |
| E1 | Extra imprimé dans le main (`groupByZone` ignore la zone) | `lib/sideSheet.test.ts` |
| E2 | le PDF ne réserve pas la place de l'intertitre « EXTRA » | `lib/sideSheetPdf.test.ts` (2 tests) |
| E3 | chiffre de plan périmé par un échange d'Extra (l'extra dérivé entre dans le moteur) | `lib/sidePlan.test.ts`, `lib/sideSheet.test.ts` |
| E4 | « Tout calculer » compte aussi les plans pas prêts | `lib/sideSheet.test.ts` (2 tests) |
| E5 | le comparateur range toute carte de plan dans le main (zone du catalogue ignorée) | `lib/sideSheet.test.ts` |

5 / 5 détectées.

### Relecture indépendante

Sous-agent à contexte neuf, sur le diff non commité (rapport intégral hors dépôt). Verdict : recevable, aucun défaut bloquant ; les invariants (S7 hors moteur et hors empreinte, rien d'un plan pas prêt, chiffre sous l'empreinte courante seulement, zone inconnue nommée, mêmes groupes pour l'écran et le PDF, hauteurs cohérentes avec le dessin, serveur zone-agnostique juste pour un plan prêt) ont été vérifiés fichier par fichier. Deux écarts « avant commit / avant tag » : la clôture documentaire n'était pas encore dans le diff, l'e2e complet pas encore annoncé — les deux sont faits ci-dessus. Remarques traitées : **(3)** pagination avec un plan à Extra, mesurée par la relecture (noms masqués : première page `[0,1,2]`, remplie à 287,6 mm sur 289 ; noms affichés : 2 adversaires seulement sur la première page) — garde unitaire ajoutée (`sideSheetPdf.test.ts` : 3 sur la première page noms masqués, jamais moins de 2 noms affichés) et dit dans la charte ; **c1** section « zone inconnue » de `boxHeight` exercée ; **c2** la restauration de la fixture vérifie aussi l'extra ; **c3** `mt-2` conditionnel pour la zone inconnue ; **c5** intertitre désigné par `[data-sheet-zone-label]`. Sans suite, consignés : **(4)** le cas « Extra seul » du comparateur n'est couvert qu'en unitaire (§8 ne l'exige pas à l'écran) ; **c4** la garde F3 « Kewl Tune premier = Yubel premier » prouve l'égalité S7, pas que le plan est appliqué (ce que F5 et `branded.input` = `kewl.input` avec `deckSize` prouvent).

### Écarts au plan

- Aucun sur le fond. Le plan prévoyait « comparateur vérifié sur un plan à Extra » : vérifié par test
  unitaire (main dérivé identique, plan d'Extra seul = base) et à l'écran (F5) sans toucher au
  comparateur.
- Le plan disait « tests d'intégration PostgreSQL une fois pour prouver la route des chiffres avec un
  plan à Extra » : le test 10B existant porte l'échange d'Extra plutôt qu'un test de plus (même route,
  même preuve, un test de moins à maintenir).

### Non fait / reporté

- Aucune carte d'Extra dans un plan de production au 22 septembre (Q8) : le rendu réel de l'intertitre
  sur un vrai deck sera vu après déploiement.

## 17. Clôture du chantier (22 septembre 2026)

- **Livré** : parties A à E, tags `side-v2-a-ok` … `side-v2-e-ok`, `side-v2-ok` sur le dernier commit ;
  rien poussé, aucune migration, aucun changement de deploy/ ni du serveur (hors un test).
- **Invariants prouvés** : non-régression des plans existants (D15, `--gap` avant / après, Q8 mesuré :
  aucun plan de production ne change de statut) ; aucun chiffre sans son deck (S1, S2 : `columnOf` /
  `studiedSource`, `inSync` de l'onglet, e2e `study` et `side`) ; l'aperçu n'est jamais enregistré ni
  persisté (S3) ; l'Extra hors moteur et hors empreinte (S7) ; empreinte de plan jamais réduite ;
  oracle et cas de référence intacts.
- **Ce qui change pour l'utilisateur** : la barre de contexte (adversaire, position) commande tout
  l'éditeur ; le panneau, la matrice, le mode Requête, le mur et les tuiles parlent du deck étudié ;
  l'onglet « Plans de side » choisit (tuile par carte, aperçu, écarts de candidats, Extra, annuler /
  vider, raisons visibles, panneau sous le plan au téléphone) ; 3 copies toutes zones à l'éditeur et à
  l'import ; la fiche et le PDF impriment l'Extra à part.
- **À surveiller après déploiement** : une carte de plan absente du catalogue chargé (« zone
  inconnue ») rend son plan « à revoir » et le nomme (§11) ; « hors format » sur un deck existant
  (avertissement seul) ; premier ouverture d'un gros deck à paires (Q13, perf hors chantier).
- **Points ouverts, hors chantier** : Q13 (performance du moteur sur les gros decks à paires) ;
  avertissement « hors format » hors de l'onglet side ; une carte présente en main ET en extra (deck
  hors format) partage ses copies entre les deux tuiles (relecture D, c4, marginal) ; un plan rendu
  incomplet par ✕ se complète en refaisant l'échange (c5) ; deux `StatsPanel` montées sous 1024 px
  (préexistant).
- **Retour arrière** : code par `git checkout 471fadd` (dernier commit avant le chantier) + build + up ;
  données : rien à défaire (aucune migration ; `plan_summaries` et `decks.summary` sont des caches
  réinvalidés par la version du moteur).
