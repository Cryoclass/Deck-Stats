# Audit visuel — l'apparence tient-elle la route pour un produit payant ?

Date : 15 septembre 2026. Lecture seule : aucun fichier du dépôt modifié hors `docs/audit/`, aucune commande vers le VPS, Supabase ou une base réelle. Prisme : freemium avec des inconnus dessus — ce qui passe pour un outil perso ne passe pas forcément pour un abonnement.

Livrables associés : 107 captures dans `docs/audit/captures/visuel/*.png` (nom = `écran-largeur`), mesures brutes `mesures.json` (contraste, cibles, tailles de police relevés dans le DOM de chaque écran), `analyse.txt` (agrégation), `chrome-heights.json` (hauteur du chrome par largeur), `journal.json`, scripts rejouables dans `captures/visuel/scripts/`.

## 0. Verdict en cinq lignes

1. **Un seul thème existe, sombre, et il est trop sombre pour son propre système de gris** : sur l'éditeur à 1440 px, 43 des 78 styles de texte visibles (55 %) sont sous le seuil WCAG AA 4,5:1, parce que trois tokens (`ink-400`, `ink-500`, `ink-600`) portent de l'information alors qu'ils mesurent 4,2 / 2,5 / 1,7:1 sur le fond.
2. **La typographie est trop petite pour un public non averti** : à 1440 px, 38 % des éléments de texte visibles sont à 10 px, 15 % à 11 px ; à 360 px, 16 % sont à 9 px. Le corps de référence est 12 px (`text-xs`).
3. **Le mobile est fonctionnel mais pas vendable** : à 360 px, en-tête + onglets + barre de modes occupent 266 px sur 780 (34 % de l'écran) avant la première carte ; 45 % des cibles mesurées font moins de 32 px.
4. **La charte est cohérente sur le papier (docs/design-system.md) mais pas tokenisée dans le code** : aucune variable CSS, les rôles sont des classes Tailwind répétées (`text-ink-500` 87 fois), les formules de couleur sont dupliquées dans trois fichiers, et des références au contrat interne (« §D », « §3.3 », « contrat §2 ») sont affichées à l'utilisateur.
5. **Faut-il passer au clair ? Non.** Il faut garder le sombre, le relever de deux crans et refaire l'échelle de texte (direction A, §8). Le clair est la bonne réponse pour la fiche imprimée et le PDF, qui existent déjà et sont les seuls écrans à 0 échec de contraste.

## 1. Méthode et environnement

- **Pile** : pile jetable de l'e2e (`npm run e2e -w web -- --keep --only setup`) : PostgreSQL 17 dans `testhand-e2e-db` (127.0.0.1:55434, `--rm --tmpfs`), API 8790, Vite 5174, compte `e2e@example.test`, fixture Deck A / Deck B (cartes synthétiques). Jamais la base de dev ni la prod.
- **Cartes réelles** : les cartes synthétiques ne permettent pas de juger un fond sombre « qui laisse respirer les artworks ». 41 cartes réelles (noms, types, URL d'images du CDN `images.ygoprodeck.com`) ont été résolues via l'API publique YGOPRODeck et insérées **dans la base jetable seulement** (`scripts/cards.sql`, `docker exec testhand-e2e-db psql`). Deck « Snake-Eye Fiendsmith » (40 main / 13 extra / 15 side, `scripts/snake-eye-fiendsmith.ydk`) importé par le dialogue YDK, annoté par les gestes de l'interface (starters, combos, HOPT, non-engine + profils, une condition), 4 adversaires et plans de side posés par l'API, variante « v2 » pour le comparateur. Un second compte (`audit.vide@example.test`) pour les états vides.
- **Captures** : Chrome installé piloté par `playwright-core` (`scripts/audit-visuel.mjs`), largeurs **360 × 780** (mobile, DPR 2), **768 × 1024** (tablette, DPR 2), **1440 × 900** (bureau), plus 320 px (reflow) et `prefers-color-scheme: light`. Police système Windows (Segoe UI) : le rendu macOS / iOS / Android n'est pas vérifié.
- **Mesures dans le DOM** (même script, fonction `SCAN`) : pour chaque élément porteur de texte visible dans le viewport, couleur calculée, fond effectif composé couche par couche (opacité héritée incluse), ratio WCAG 2.x, taille et graisse ; pour chaque contrôle (`button`, `a`, `input`, `select`, `textarea`, `[role=menuitem]`), boîte englobante. Les textes posés sur une image sont évalués au pire cas (fond noir et blanc) et signalés à part. Les états désactivés et périmés (`opacity-40/45`) sont dans les données brutes mais exclus des constats ci-dessous (WCAG les exempte).
- **Thèmes** : un seul. Vérifié : `web/src/index.css:5-7` (`color-scheme: dark`), `web/index.html:2` (`class="dark"`), `docs/design-system.md` §1 règle 1 (« aucune variante claire n'existe »), et à l'écran : sous `prefers-color-scheme: light` le fond du body reste `rgb(10, 11, 14)` (`journal.json`, capture `login-1440-prefers-light.png` identique à `login-1440.png`). La seule vue claire est l'impression de la fiche (`@media print`, `index.css:55-67`), capturée en émulation `print` (`fiche-print-full-*.png`).

### Inventaire des captures

| Écran | 360 | 768 | 1440 | Autres |
|---|---|---|---|---|
| Connexion / inscription / erreur de connexion | `login-`, `register-`, `login-erreur-` | idem | idem | `login-1440-prefers-light` |
| Accueil vide / plein / menu ⋯ / menu compte / dialogue comparer | `home-vide-`, `home-`, `home-menu-deck-`, `account-menu-`, `compare-dialog-` | idem | idem | `home-320` |
| Nouveau deck (dialogue) | `import-dialog-` | idem | idem | |
| Éditeur vide (deck de 0 carte) | `editor-vide-` | idem | idem | |
| Éditeur — Annoter, bloc extra/side, mode Starter, mode Lier combo (pivot), menu Non-engine, menu ⋯ d'une tuile, détail de carte, ajout de carte, toast, non enregistré, brouillon retrouvé | `editor-annoter-`, `editor-annoter-zones-`, `editor-mode-starter-`, `editor-mode-combo-`, `editor-menu-nonengine-`, `editor-card-menu-`, `editor-card-detail-`, `editor-add-card-`, `editor-toast-`, `editor-dirty-`, `editor-brouillon-` | idem | idem + `editor-second-1440`, `editor-panneau-bas-1440`, `editor-introuvable-1440` | `editor-annoter-320` |
| Éditeur — onglets Stats (mobile), Combos & catégories, Mur de mains, Inventaire, Plans de side (+ sélection) | `editor-stats-`, `editor-stats-bas-`, `editor-combos-`, `editor-mains-`, `editor-inventaire-`, `editor-side-`, `editor-side-selection-` | idem | idem (sans Stats : panneau latéral) | |
| Comparateur (viewport, pleine page, synthèse) | `compare-`, `compare-full-`, `compare-synthese-` | idem | idem | `compare-320` |
| Fiche des plans de side (écran, pleine page, impression) | `fiche-`, `fiche-full-`, `fiche-print-full-` | idem | idem | |

## 2. La charte réelle, extraite du code

### 2.1 Palette

**Source unique de tokens** : `web/tailwind.config.js:8-20` — onze gris froids `ink-950 … ink-100`, rien d'autre (pas de rôle sémantique, pas d'accent déclaré). Les accents sont la palette Tailwind par défaut (`emerald`, `amber`, `sky`, `red`) utilisée directement dans les composants.

| Token | Hex | Usages texte (`text-ink-*`, comptage `grep` sur `web/src`) | Usages fond (`bg-ink-*`) |
|---|---|---|---|
| ink-950 | #0a0b0e | — | 17 |
| ink-900 | #0f1116 | — | 35 |
| ink-850 | #151822 | — | 30 |
| ink-800 | #1b1f2a | — | 60 |
| ink-700 | #252a37 | — | 29 |
| ink-600 | #333a4a | **33** | 8 |
| ink-500 | #4a5265 | **87** | — |
| ink-400 | #6b7488 | **66** | — |
| ink-300 | #9aa2b5 | 37 | — |
| ink-200 | #c7ccd8 | 43 | — |
| ink-100 | #e8eaf0 | 95 | — |

Accents en texte : `text-amber-300` 22, `text-red-400` 16, `text-red-300` 16, `text-emerald-300` 10, `text-amber-200` 9, `text-emerald-200` 7, `text-sky-200` 4, `text-sky-300` 3 ; `text-black` 28 (boutons primaires et badges). Fonds teintés : `bg-emerald-600` 12, `bg-emerald-500` 9, `bg-amber-500/10` 14, `bg-red-500/10` 11, etc. (42 variantes distinctes de fond teinté, 45 variantes de bordure/anneau teinté — voir `analyse.txt`).

**Valeurs posées en dur hors tokens** (toutes les occurrences, `grep -E '#[0-9a-f]{3,6}'`) :

| Fichier:ligne | Valeur | Rôle |
|---|---|---|
| `web/src/index.css:18-19` | `#0a0b0e`, `#c7ccd8` | fond et texte du body — doublons de `ink-950` / `ink-200` |
| `web/src/index.css:33,40` | `#333a4a` ×2 | ascenseurs — doublon de `ink-600` |
| `web/src/lib/statsViews.ts:55,64,70,73` | `#4fae7a`, `#5b8def` ×3 | couleurs des deux séries de barres |
| `web/src/components/ui.tsx:4` | `#6b7488` | couleur par défaut de `Bar` — doublon de `ink-400` |
| `web/src/components/LoginPage.tsx:206` | `#5865F2`, `#4954d8` | bouton Discord (marque tierce, toléré par la charte §2.3) |
| `web/src/lib/sideSheetPdf.ts:228` | `#ffffff` | PDF |
| `web/src/components/StatsPanel.tsx:289` · `ComparePage.tsx:235,256` · `HandWall.tsx:260` · `lib/colors.ts:14,19` | `oklch(0.7 0.13 155 / α)`, `oklch(0.58 0.17 25 / α)`, `oklch(0.78 0.15 h)`, `oklch(0.72 0.15 h)` | cartes de chaleur, badge de note, couleurs de combo — **la formule de la carte de chaleur est copiée à l'identique dans deux fichiers** (`StatsPanel.tsx:289` et `ComparePage.tsx:235`), la divergente est dans `ComparePage.tsx:256` seulement |

Aucune variable CSS (`--*`) n'existe : `index.css` ne contient que `color-scheme`, le body, `.tnum`, les ascenseurs, `barGrow`, `@media print` et `.print-exact`. **Conséquence** : un thème alternatif ou un simple ajustement de l'échelle de gris impose de retoucher les 400 occurrences de classes `text-ink-*` / `bg-ink-*` une à une, ou de redéfinir la palette `ink` en espérant que tous les emplois d'un même palier veuillent la même chose — ce qui est faux (voir §4 : `ink-500` sert à la fois pour un séparateur décoratif et pour le delta d'une carte).

### 2.2 Échelle typographique

Code (`grep` des classes de taille dans `web/src/components`) : `text-[11px]` **94**, `text-xs` (12 px) **93**, `text-[10px]` **55**, `text-sm` (14 px) 47, `text-[9px]` 10, `text-base` (16 px) 6, `text-lg` 3, `text-xl` 1, `text-2xl` 1. Trois tailles sur neuf sont des valeurs arbitraires (`[9px]`, `[10px]`, `[11px]`, 159 occurrences), hors échelle Tailwind, donc invisibles pour toute retouche globale. Graisses : `font-medium` 44, `font-semibold` 24, `font-bold` 13, `font-extrabold` 1.

Rendu mesuré (éléments de texte visibles dans le viewport, cumul des écrans) :

| Largeur | 9 px | 10 px | 11 px | 12 px | 14 px | 16 px | ≥ 18 px |
|---|---|---|---|---|---|---|---|
| 360 | 16 % | 22 % | 17 % | 28 % | 11 % | 6 % | < 1 % |
| 768 | 4 % | 31 % | 18 % | 21 % | 17 % | 9 % | < 1 % |
| 1440 | 3 % | **38 %** | 15 % | 23 % | 13 % | 7 % | 1 % |

Sur l'éditeur à 1440 (`editor-annoter-1440`) : 80 éléments à 10 px, 34 à 11 px, 53 à 12 px, 43 à 14 px, 22 à 16 px (ce sont les glyphes « ⋯ » du menu), 2 à 20 px, 1 à 24 px (le « + » d'ajout). **Il n'y a pas de titre** : le plus grand texte lu est le nom du deck à 14 px (`Header.tsx:50`) et « Probabilités » à 14 px (`StatsPanel.tsx:75`). La page de connexion culmine à 18 px (`LoginPage.tsx:105`).

Familles : pile système (`index.css:20`), aucune webfont. `font-num` déclare JetBrains Mono (`tailwind.config.js:24`) mais **aucun `@font-face` ni `<link>` ne la charge** : les 4 emplois (`ImportDialog.tsx:153,232,244,257`) tombent sur `ui-monospace` (Consolas sous Windows, visible dans `import-dialog-1440.png`). Le mécanisme `.tnum` (chiffres tabulaires, `index.css:25-28`) est bien appliqué partout où des valeurs s'alignent : c'est le point fort typographique.

### 2.3 Espacements, rayons, ombres, bordures

- **Espacement** : base 4 px respectée ; valeurs employées `px-2` 58, `py-1.5` 48, `py-1` 40, `gap-2` 40, `px-3` 39, `gap-1` 35, `py-0.5` 34, `px-1` 34… (`analyse` du §2). Paddings verticaux de contrôle de 2 à 8 px : la hauteur des contrôles dépend donc de la taille de police, pas d'une hauteur fixe — d'où des cibles de 16 à 28 px (§6). Seules 27 classes `h-8` fixent 32 px (steppers, ⋯, actions primaires depuis l'étape 6B).
- **Rayons** : `rounded` (4 px) 146, `rounded-md` 22, `rounded-lg` 15, `rounded-full` 8, `rounded-xl` 7, `rounded-sm` 6. Échelle cohérente avec la charte §4.2 (« le rayon croît avec l'élévation »).
- **Ombres** : `shadow-2xl` 10 (menus, dialogues, toast), `shadow-black/50` 5, `shadow-black/60` 1, rien sur les surfaces à plat. Cohérent avec la charte §5.
- **Bordures** : toujours 1 px, `border-ink-700` 51, `border-ink-800` 46. Le problème n'est pas l'épaisseur mais le contraste (§4.3).
- **Mouvement** : `transition` 18, `duration-300` 1 (barres). Sobre, conforme.
- **Points de rupture** : `sm:` (640 px) 30 emplois, `md:` 1, `lg:` 2 (`EditorPage.tsx:146,165` : le panneau de stats devient un onglet sous 1024 px). Une seule vraie rupture de mise en page, le reste est du `flex-wrap`.

**Cohérence, en une phrase** : les rayons, ombres, espacements et le vocabulaire des composants sont tenus (la charte décrit fidèlement le code) ; la couleur et la typographie, elles, sont posées classe par classe sans couche sémantique, et c'est exactement là que les défauts mesurés se concentrent.

### 2.4 Interaction et accessibilité structurelle (relevés)

- `outline-none` 14 fois, aucun `:focus-visible` dans `index.css` : le focus clavier n'est visible que par le changement de bordure `focus:border-ink-500` (2 emplois) ou de fond (`focus:bg-ink-900`, 2). La charte l'admet (§8, « réserve honnête »). Non corrigé.
- Dialogues : seuls `AddCardDialog` (`AddCardDialog.tsx:104-105`) et les modes d'annotation (`AnnotationGrid.tsx:84`) réagissent à Échap. `ImportDialog.tsx:102`, `CompareDialog` (`ComparePage.tsx:429-432`) et `CardDetailDialog.tsx:8-11` ne se ferment qu'au clic sur le voile ou sur ✕. Aucun `role="dialog"`, aucun piège de focus (22 attributs `aria-*`/`role=` dans tous les composants, 11 balises `h1`-`h3`).
- `web/index.html:2` : `lang="en"` pour une interface entièrement en français (césure, correcteur, lecteurs d'écran). Aucun `<link rel="icon">`, aucun `theme-color`, aucun manifest (`index.html:3-7`, `web/public/` ne contient que `robots.txt`) : onglet sans icône, barre de navigation mobile claire au-dessus d'une app noire.
- 106 attributs `title=` portent des explications (`STARTS_HINT`, `CONTEXT_TITLE`, hints des profils, `pct(v, 2)` des cellules…) : **au toucher, aucune n'est accessible**. Sur mobile, la valeur fine d'une cellule de matrice, l'explication de « Départs théoriques » ou celle d'un profil n'existent pas.
- `h-screen` 10 fois, aucun `dvh` : sur un navigateur mobile à barre d'outils dynamique, le bas de la zone défilante peut passer sous la barre (non vérifié sur appareil, voir §9).
- Champs : `text-sm` (14 px) sur les champs de connexion et de nom, `text-xs` (12 px) sur les `select` (`ComboList.tsx:36`, `HandWall.tsx:105`), 11 px sur les bornes de requête (`QueryMode.tsx:201-280`). iOS Safari zoome automatiquement au focus d'un champ sous 16 px (non vérifié ici, voir §9).

## 3. Contraste WCAG AA

### 3.1 Table des tokens (calcul exact, formule WCAG 2.x)

Texte `ink-N` sur les cinq fonds réellement utilisés :

| Texte | sur ink-950 | ink-900 | ink-850 | ink-800 | ink-700 | Verdict AA (texte < 18 px) |
|---|---|---|---|---|---|---|
| ink-100 | 16,36 | 15,70 | 14,73 | 13,68 | 11,92 | OK |
| ink-200 | 12,24 | 11,74 | 11,01 | 10,23 | 8,91 | OK |
| ink-300 | 7,69 | 7,38 | 6,92 | 6,43 | 5,60 | OK |
| **ink-400** | **4,20** | **4,03** | **3,78** | **3,51** | **3,06** | **KO partout** (AA exige 4,5 ; passerait AA « grand texte » ≥ 24 px, qui n'existe pas) |
| **ink-500** | **2,52** | **2,42** | **2,27** | **2,10** | 1,83 | **KO** |
| **ink-600** | **1,73** | **1,66** | **1,56** | 1,45 | 1,26 | **KO**, même pour du décor (1.4.11 : 3:1) |

La charte (`design-system.md` §2.1) annonce « ink-400 ≈ 4,1:1 » et prescrit « ne jamais faire porter une information par ink-500 ou ink-600 ». Le code emploie `text-ink-400` 66 fois, `text-ink-500` 87 fois et `text-ink-600` 33 fois, en très grande majorité pour de l'information (voir 3.2).

Accents et boutons :

| Paire | Ratio | Où |
|---|---|---|
| noir sur emerald-600 (`bg-emerald-600 text-black`) | 5,57 | bouton primaire — OK |
| noir sur emerald-500 (survol) | 8,28 | OK |
| blanc sur #5865F2 (Discord) | 4,61 | OK de justesse |
| emerald-300 / amber-300 / sky-300 / red-400 sur ink-900 | 12,39 / 13,10 / 11,33 / 6,83 | OK |
| red-300 sur bandeau `red-500/10` | 9,15 | OK |
| ink-100 sur les cellules de chaleur les plus fortes (`oklch(0.7 0.13 155 / 0.85)` composé) | **2,77 à 4,38** pour les 10 cellules ≥ 14 % | **KO** (mesuré : `compare-1440`, 19,6 → 2,77 ; 19,3 → 2,84 ; 18,0 → 3,17 ; 16,4 → 3,64 ; 15,0 → 4,15) |
| `bg-ink-800 text-ink-500` (bouton Enregistrer désactivé, `Header.tsx:95`) | 2,10 | exempté (désactivé) mais illisible : « Enregistrer » disparaît quand rien n'est à enregistrer |
| bordure de champ ink-700 sur ink-850 / login ink-700 sur ink-950 | 1,24 / 1,32 | **KO 1.4.11** (3:1 pour la limite d'un composant) |
| bordure de surface ink-800 sur ink-900 | 1,15 | décoratif, mais c'est la seule séparation des cartes de l'accueil et des tuiles |
| onglet actif ink-700 sur ink-900 · segment actif ink-600 sur ink-850 | 1,32 · 1,56 | l'état actif ne tient que par la couleur du texte |
| pastille « en ligne » emerald-500 8 px / « hors-ligne » ink-600 | 7,76 / 1,73 | l'état hors-ligne est invisible (`Header.tsx:66`) |

### 3.2 Ce que ça donne à l'écran (mesuré, hors états désactivés/périmés et hors textes sur image)

Paires les plus fréquentes en échec, toutes largeurs confondues (`analyse.txt`, section « paires texte/fond opaque ») :

| Ratio | Style | Occurrences visibles | Exemples et sources |
|---|---|---|---|
| 1,66–1,73 | ink-600, 9–14 px | ~230 | « DÉPARTS ≥1 (PREMIER) » / « BRICK (PREMIER) » à 9 px (`HomePage.tsx:332`, `HandWall.tsx:234`), date « 15 sept. 26 » (`HomePage.tsx:309`), « enregistré 10:04 » (`Header.tsx:85`), « passcode … » (`CardDetailDialog.tsx:36`), « Aucune carte. » (`AnnotationGrid.tsx:350`), notes sous le formulaire de connexion (`LoginPage.tsx:215`), « (optionnel) » (`LoginPage.tsx:161`), « ↓S \ U→ » (`StatsPanel.tsx:270`), « hors calcul » (`CardTile.tsx:247`), « supprimer » (`ComboList.tsx:96`), « poser d'abord une étiquette » (`CardMenu.tsx:92`) |
| 2,42–2,52 | ink-500, 9–12 px | ~880 | **le delta de chaque tuile** « −1 : −1.25% » (`CardTile.tsx:254`), les libellés de section en capitales (`StatsPanel.tsx:219,263`, `SidePlanner.tsx:359,363,530`, `ModeBar.tsx:25`), en-têtes et libellés de lignes/colonnes des matrices (`StatsPanel.tsx:272,281`, `ComparePage.tsx:318,327`), la légende de Δ (`ComparePage.tsx:274`), les en-têtes de la table de synthèse (`ComparePage.tsx:363`), « en ligne » (`Header.tsx:65`), les raccourcis `<kbd>` (`ModeBar.tsx:225`), « probabilités & mains » (`HomePage.tsx:159`), la phrase d'explication sous « Départs théoriques » (`StatsPanel.tsx:153`), « Ajouter » de la tuile d'ajout, « 3518 ms », les infos type/race/attribut dans l'ajout de carte (`AddCardDialog.tsx:143`) |
| 3,51–4,20 | ink-400, 10–16 px | ~1 100 | onglets inactifs (`EditorPage.tsx:190`), tous les « ⋯ » (`CardMenu.tsx:48`), « ← Decks » (`Header.tsx:39`), « contexte », « 40 cartes » (`Header.tsx:55`), « A — référence » (`ComparePage.tsx:449`), « Nom du deck » (`ImportDialog.tsx:129`), segment inactif « Second · 5 + pioche » (`ui.tsx:37`), « Retirée : » du toast (`Toast.tsx:30`), « Premier · 5 cartes » titre de section du comparateur (`ComparePage.tsx:212`), texte de la vue Combos (`ComboList.tsx:25`) |

Par écran, part des styles de texte visibles sous AA : connexion 5/9, inscription 6/10, accueil 5/14, accueil vide 8/14, nouveau deck 13/21, éditeur Annoter 43/78 (1440) et 12/20 (360), Stats mobile 29/39, Combos 45/80, Inventaire 40/82, Mur de mains 37/78, Plans de side 45/85, comparateur 25/104, fiche 6/16, **fiche imprimée 0/11**.

Textes sur image (badges de tuile) : « S », « H », « Fx », « Pc » en noir sur aplats `emerald/sky/amber-500/90` mesurent 6,3 à 8,0 au pire cas — OK. « sort » / « entre » du planificateur (`SidePlanner.tsx:503`, ink-100 sur `black/75`) : 3,87 au pire cas sur image claire — limite. « †1er » (`CardTile.tsx:173`, red-300 sur `black/70`) : 4,45 sur image blanche — limite.

### 3.3 Lecture

Le système de gris n'est pas mauvais en soi : `ink-100/200/300` passent largement. Le défaut est **d'affectation** : la charte réserve les trois paliers sombres au décor, le code les emploie pour les libellés, les deltas, les en-têtes de tableau et les légendes — c'est-à-dire pour tout ce qu'un client paie pour lire. Ce n'est pas un problème de thème sombre, c'est un problème de rôles de texte (§7).

## 4. Hiérarchie visuelle, écran par écran

**Connexion** (`login-1440.png`, `login-360.png`). Une carte centrée, un logotype « YGO » à 18 px et un sous-titre à 12 px en `ink-500` (2,5:1). Pour un produit payant, c'est la page d'atterrissage de tout inconnu : elle ne dit ni ce que fait l'outil, ni à quoi ressemble le résultat, ni le prix ; aucune promesse, aucune illustration, aucun lien (CGU, confidentialité, support). Le mot de passe n'a ni bascule d'affichage ni « mot de passe oublié » (`LoginPage.tsx:141-155`, aucune route de réinitialisation dans `server/src/routes/auth.ts` d'après `00-materiaux.md` §4). L'inscription exige un **code d'invitation** (`LoginPage.tsx:170-182`, note ligne 217) : incompatible avec un freemium en libre-service. Le bouton Discord (`#5865F2`, blanc, 4,61:1) est visuellement plus fort que le bouton primaire émeraude à texte noir — la hiérarchie des deux actions est inversée par la marque tierce. Le message d'erreur (`login-erreur-*.png`) est une ligne rouge de 12 px sous les champs, sans icône ni rappel du champ fautif.

**Accueil** (`home-1440.png`, `home-768.png`, `home-360.png`). Grille `minmax(280px, 1fr)` (`HomePage.tsx:200`) : à 1440 px, quatre cartes tiennent sur une ligne puis l'écran est vide aux deux tiers ; à 768, deux colonnes. La carte de deck superpose un bandeau de vignettes de 64 px de haut (`HomePage.tsx:272-284`, `h-16`), coupé à droite sans dégradé ni compteur (« +32 »), puis nom 14 px, chip « 40 c. » (ink-400 sur ink-800, 3,5:1), deux chiffres à 14 px émeraude/rouge avec des libellés à **9 px en `ink-600` (1,66:1)** : « DÉPARTS ≥1 (PREMIER) » et « BRICK (PREMIER) » sont les seules explications des deux nombres, et elles sont illisibles. La date en 10 px `ink-600`. « Ouvrir » en émeraude 12 px sur toute la largeur, doublonné par le clic sur le bandeau (`title="Ouvrir"`). Le chip « 40 c. » et le « ⋯ » sont plus visibles que la valeur des chiffres. Aucun tri, aucun filtre, aucun état de sélection ; pour 30 decks, c'est une grille sans repère.

**Nouveau deck** (`import-dialog-*.png`). Dialogue correct dans sa structure (nom, deux zones fichier, collage, deck vide) mais : les `<input type="file">` natifs (« Choisir un fichier / Aucun fichier choisi », `ImportDialog.tsx:307-312`) sont stylés par le navigateur, pas par l'app ; le libellé du collage est un **paragraphe de deux lignes en capitales de 11 px** (`ImportDialog.tsx:146-148`) — le motif « étiquette de section » (charte §3.4) appliqué à une phrase d'explication ; « Créer un deck vide » est un lien fantôme 12 px `ink-400` à gauche, l'action la plus fréquente d'un débutant est la moins visible.

**Éditeur — en-tête, onglets, barre de modes** (`editor-annoter-1440.png`, `editor-annoter-360.png`, `chrome-heights.json`) :

| Largeur | en-tête | onglets | barre de modes | 1re tuile à | part de l'écran | colonnes de tuiles |
|---|---|---|---|---|---|---|
| 360 × 780 | 118 px (3 lignes) | 37 px, **208 px de contenu masqué** à droite (`overflow-x-auto`, `EditorPage.tsx:130`) sans indice visuel | 103 px (3 lignes) | **266 px** | **34 %** | 3 (110 px) |
| 390 × 844 | 118 | 37, 178 px masqués | 71 (2 lignes) | 234 | 28 % | 3 |
| 768 × 1024 | 79 (2 lignes) | 37 | 39 | 163 | 16 % | 7 |
| 1440 × 900 | 49 | 37 | 39 | 133 | 15 % | 9 |

À 360, l'en-tête empile « ← Decks · nom (tronqué à `w-32`) · 40 cartes » / « ● en ligne · contexte · [Premier · 5 | Second · 5 + pioche] » / « enregistré 10:04 · [Enregistrer] · E E2E » (`Header.tsx:36-104`, `flex-wrap`). Le nom du deck, l'indicateur de connexion, le réglage premier/second et l'heure de sauvegarde ont le même poids que l'action « Enregistrer ». Les onglets « Inventaire » et « Plans de side » sont hors écran (« Inve » coupé, capture 360) : un nouvel utilisateur ne sait pas qu'ils existent. La barre de modes affiche sept boutons avec des raccourcis clavier `<kbd>` (`ModeBar.tsx:225`) **y compris sur mobile** où ils n'ont aucun sens.

**Tuiles de cartes** (`CardTile.tsx`). L'image est le seul élément fort de l'écran : bien. Mais les badges de rôle (« S », « H », « Fx », « Pc », `CardTile.tsx:145-169`) sont posés en haut à gauche, **sur le bandeau de nom de la carte**, qu'ils cachent (« ake-Eye Ash », « LED BY THE GRAVE », lisible sur `editor-annoter-1440.png`) ; le nom n'est répété nulle part sous la tuile — l'identité de la carte passe par l'artwork seul ou par le `title` au survol. Le delta « −1 : −1.25% » (`CardTile.tsx:254`) est à 10 px en `ink-500` (2,42:1) : c'est la donnée analytique la plus fine de l'application, rendue comme un horodatage. Le stepper « − 3 + » est à 32 px (bien) mais son fond `ink-850` sur `ink-900` (1,1:1) ne se détache pas ; « + » désactivé à 3 copies passe en `opacity-30`.

**Panneau Probabilités** (`editor-panneau-bas-1440.png`, `editor-stats-360.png`, `editor-stats-768.png`). Ordre vertical : titre 14 px → bandeau ambre (carte sans profil) → sélecteur de vue « ◀ Départs théoriques ▶ » dont le titre est un bouton de 16 px de haut (`StatsPanel.tsx:138`) → phrase d'explication en 10 px `ink-500` → deux colonnes (premier/second) avec quatre barres + « exact / cumulé » → matrice → « MODE REQUÊTE (§3.3) » → deux grands pourcentages 20 px émeraude (`QueryMode.tsx:289`) → « Voir ces mains / nommer… / enregistrer ». Le seul élément de plus de 14 px est le résultat de requête (95,5 %), qui n'est pas la statistique principale ; la statistique principale (« ≥1 départ : 95,46 % ») est un chiffre de 12 px `ink-400` dans la colonne « cumulé » (`StatsPanel.tsx:233`). La colonne « Second » à `opacity-80` quand elle n'est pas le contexte actif (`StatsPanel.tsx:193`) ajoute une strate d'atténuation à des textes déjà sous le seuil. À 360, l'onglet « Stats » reproduit ce panneau sur toute la largeur : les deux colonnes s'empilent (`sm:grid-cols-2`), la matrice tient (6 colonnes), c'est le seul onglet mobile bien dimensionné.

**Mur de mains** (`editor-mains-1440.png`, `editor-mains-360.png`). Barre d'outils correcte. Chaque ligne : 5–6 vignettes de 68 px (60 px sous 640), « départs / non-eng » en paires 14 px / 9 px `ink-600`, note en pastille colorée noire (`HandWall.tsx:255-265`). À 1440 la ligne mesure ~85 px pour 6 vignettes et deux chiffres : deux tiers de la largeur sont vides. À 360, la version compacte « S 5 / U 0 » + pastille est la bonne idée. La pastille de note est le seul objet vraiment saturé de l'écran (badge rouge→vert) : il domine visuellement des chiffres plus importants.

**Combos & catégories** (`editor-combos-360.png`). Commence par un paragraphe explicatif de 11 px `ink-400` encadré (`ComboList.tsx:25-28`) — la seule mention du double régime de persistance de l'app (paires par deck / annotations par compte), reléguée en petit gris. Les cases à cocher sont des carrés de **16 px** (`ComboList.tsx:88`), « supprimer » un texte de 14 px `ink-600` (1,66:1, `ComboList.tsx:96`).

**Inventaire** (`editor-inventaire-360.png`). Bon principe (sections repliables avec « 17 copies · 7 cartes · 42,5 % du deck »). Mais le premier bloc s'intitule « STARTERS CONDITIONNELS (§E) — CONDITIONS ET/OU SUR LE DECK RESTANT » (`Inventory.tsx:32`), et le bandeau de tête finit par « Les sections se recoupent — total dédupliqué en bas » en 10 px `ink-600`.

**Plans de side** (`editor-side-1440.png`, `editor-side-768.png`, `editor-side-360.png`). Quarante-huit vignettes de 56 px « une par exemplaire » (`SidePlanner.tsx:474`) : à 360, cinq colonnes sur huit rangées, soit ~1 000 px de miniatures identiques (trois Ash, trois Impermanence…) avant d'atteindre « Sélection », « Échanger » et le plan lui-même. Les marqueurs « sort / entre » en 10 px sur `black/75` en bas à droite de vignettes de 56 px (`SidePlanner.tsx:503`) sont le seul état visible d'une copie engagée, avec `opacity-45`. Le chip « Prêt » (émeraude), la taille « main 40 → 40 » (11 px `ink-400`) et « Supprimer l'adversaire » (11 px `ink-400`, fantôme) se disputent une ligne. Les trois chiffres du plan (14 px semibold) sont sous un libellé de section en capitales 10 px `ink-500` : « DECK SIDÉ · PREMIER · 5 CARTES · ÉCART AVEC LE DECK DE BASE ».

**Comparateur** (`compare-1440.png`, `compare-360.png`, `compare-synthese-1440.png`). La structure A / B / Δ puis synthèse est la bonne. Les bandeaux d'avertissement sont rendus **avant** tout contenu (`ComparePage.tsx:162,186-197`) : avec deux decks aux distributions identiques, cinq bandeaux (trois « info » bleus, deux ambre) occupaient tout le premier écran à 360 (observé au premier passage, avant modification de la variante ; ces captures ont été remplacées par le passage final où seuls les deux bandeaux ambre restent). Cellules à 10 px, 9 px sous 640 (`ComparePage.tsx:304`) ; libellés de lignes/colonnes en `ink-500` (2,42) ; coin « ↓S \ U→ » en `ink-600` ; légende obligatoire de Δ en 10 px `ink-500` sur 240 px de large (`ComparePage.tsx:274`) — la phrase la plus importante de l'écran (« vert ≠ meilleur ») est la moins lisible. Table de synthèse : en-têtes 10 px capitales `ink-500`, colonne « Sens » en `ink-500` (« ↓ plus bas = mieux »). Les cellules les plus fortes de la carte de chaleur (19,6 ; 21,1) sont celles où le chiffre est le moins lisible (2,8:1).

**Fiche des plans de side** (`fiche-1440.png`, `fiche-print-full-1440.png`). C'est l'écran le mieux hiérarchisé de l'application : nom du deck 16 px, adversaire 16 px, « PREMIER / SECOND » 11 px gras, cadres SORT (pointillé rouge) / ENTRE (plein vert), badge « ×3 » de 32 px, chiffres 11 px gras. En impression (fond blanc, texte noir), **0 échec de contraste sur 11 styles** : c'est la preuve que la grammaire de l'app fonctionne dès que les gris cessent d'être des gris sur du noir.

**États** : le toast (`editor-toast-1440.png`) est bien placé mais son ✕ mesure 11 × 20 px (`Toast.tsx:38`). Le bandeau « Modifications non enregistrées retrouvées » (`editor-brouillon-*.png`) est le seul bouton ambre plein de l'app — visible, bien. Le deck vide (`editor-vide-1440.png`) affiche dans le panneau **trois bandeaux d'erreur et d'avertissement** (« hors bornes 40–60 (§D) », « analyse indisponible… » ×2, « Matrice indisponible ») et « — » en émeraude : un deck vide est traité comme une panne, pas comme un point de départ. « Deck introuvable » (`editor-introuvable-1440.png`) : une phrase 14 px `ink-400` et un bouton, sans logo ni cadre.

**Jargon interne affiché** (à retirer avant toute mise en vente) : « Mode requête (§3.3) » (`QueryMode.tsx:66`), « hors bornes 40–60 (§D) » (`StatsPanel.tsx:105`, `Inventory.tsx:239`), « Starters conditionnels (§E) » (`Inventory.tsx:32`), « Extra / Side — éditables, exclus des calculs (contrat §2) » (`AnnotationGrid.tsx:238`), « au-delà de 60 (§D) » et « (repère, étape 9C) » (`AddCardDialog.tsx:90,95`), « (contrat §3) » et « (§4.4) » dans des infobulles (`HandWall.tsx:157,261`). Idem pour les libellés de contexte « C(D,5) mains » (`StatsPanel.tsx:203`) et « E[red.] » (`statsViews.ts:58`).

## 5. Densité d'information

- **Bureau (1440)** : neuf colonnes de tuiles de 97 px (`AnnotationGrid.tsx:298`, `minmax(96px)`) ; une tuile = image 139 px + stepper 32 px + ligne delta/menu 32 px ≈ 215 px ; 40 cartes = 18 identités = deux rangées et demie. Le panneau latéral de 500 px (`EditorPage.tsx:165`) affiche simultanément quatre barres × deux contextes, une matrice 4 × 6, le mode requête et deux résultats : environ 120 valeurs numériques visibles sans défiler. C'est dense mais lisible **si** les gris sont corrigés : l'espace n'est pas le problème, la valeur des gris l'est.
- **Tablette (768)** : sept colonnes, panneau replié en onglet « Stats ». La grille perd le panneau alors qu'il y aurait la place pour une colonne de 300 px ; l'utilisateur doit basculer d'onglet à chaque annotation pour voir l'effet — le « temps réel visible » (charte §9.1) disparaît sous 1024 px.
- **Mobile (360)** : 34 % de l'écran en chrome avant le contenu (§4) ; trois tuiles de 110 px par rangée, 160 px d'image : les cartes sont *plus grandes* qu'au bureau, donc 13 rangées de 215 px pour 40 cartes (2 800 px de défilement) ; le delta reste à 10 px. À 320 px (`editor-annoter-320.png`), l'en-tête passe à cinq lignes.
- **Reflow** (WCAG 1.4.10) : aucun défilement horizontal de page à 320 px sur l'accueil, l'éditeur et le comparateur (`journal.json`, `scrollWidth` = 320) ; les seuls débordements sont des `truncate` volontaires.

## 6. Lisibilité des tableaux de statistiques

| Tableau | Taille | En-têtes | Valeurs | Constat |
|---|---|---|---|---|
| Distribution 0/1/2/≥3 (`StatsPanel.tsx:212-247`) | 12 px | 10 px capitales `ink-500` (2,4:1) | exact 12 px `ink-100` ; cumulé 12 px **`ink-400`** (4,0:1) | « cumulé » (P(≥ n)) est la colonne que l'on lit en premier pour un deck ; elle est la plus effacée. Le libellé de seau (« ≥3 ») en `ink-400`. « brick 4,54 % · E[red.] 0,06 » en 12 px `ink-400` ; notation E[·] non expliquée. |
| Matrice S × U (`StatsPanel.tsx:249-302`) | 10 px | lignes/colonnes 10 px `ink-500`, coin `ink-600` | `ink-100` sur chaleur verte alpha ∝ valeur/max | Les cases fortes (> 15 %) sont sous 4,5:1 (2,8 à 4,4) ; la case faible à `0.0` est la mieux lisible. Le point médian « · » pour zéro exact n'est pas expliqué à l'écran (règle documentée dans `fmt.ts:8-13` seulement). Aucune légende d'échelle. Pas de somme de ligne/colonne. Valeur fine dans `title` seulement (invisible au toucher). |
| Matrices A / B / Δ du comparateur (`ComparePage.tsx:283-344`) | 10 px, **9 px sous 640** | idem | idem, Δ en vert/rouge alpha ∝ |Δ|/2 pt | 9 px est sous toute recommandation (Material : 11 px min, Apple : 11 pt). Δ colorée par signe avec légende « pas nécessairement meilleur » en 10 px `ink-500` : la mise en garde est moins visible que ce qu'elle corrige. Rouge/vert par signe : le signe « + / − » est bien dans la cellule (`fmt.ts:19-20`), ce qui sauve la lecture daltonienne. |
| Synthèse (`ComparePage.tsx:348-394`) | 12 px | 10 px capitales `ink-500` | `ink-100`, Δ émeraude/rouge selon le mérite | Bonne idée (« ↓ plus bas = mieux ») mais la colonne « Sens » est en `ink-500` et le sens « ↑ » seul n'est pas explicité. Sept colonnes à 360 : défilement horizontal confiné, sans ombre ni indice. |
| Aperçus de l'accueil (`HomePage.tsx:322-334`) | 14 px | **9 px `ink-600` (1,66:1)** | émeraude / rouge | Les deux seuls chiffres qu'un visiteur voit avant d'ouvrir un deck ont des libellés illisibles. |
| Chiffres du plan de side (`SidePlanner.tsx:556-589`) | 14 px | 11 px `ink-500` | `ink-100`, écart émeraude/rouge | Correct ; « · » pour un écart nul sans explication. |

Transversal : l'arrondi au rendu avec valeur fine en infobulle (`fmt.ts`) est une bonne règle sur bureau et une perte d'information sur mobile ; les entêtes de tableaux sont systématiquement au niveau de gris le plus faible, à l'inverse de toute pratique de tableau statistique où l'entête guide la lecture.

## 7. Faut-il passer à un style plus clair ? — Non, et voici pourquoi

**Ce que les mesures disent.** Les échecs de contraste ne viennent pas du fond sombre : `ink-100/200/300` passent à 7–16:1. Ils viennent de trois tokens de gris moyen affectés à de l'information. Passer en clair *corrigerait mécaniquement* ces trois-là (`ink-500` sur blanc = 7,8:1, `ink-600` = 11,4:1, `ink-400` = 4,7:1) — mais casserait tout le reste : les accents en teinte 300/200 (`emerald-300` sur blanc = **1,52:1**, `amber-300` = **1,44:1**), le bouton primaire à texte noir, les cartes de chaleur en alpha sur fond sombre (`oklch(… / α)` composé sur `ink-900`, trois fichiers), les badges sur image, la note de main, les 42 fonds translucides des bandeaux. Dans les deux directions, il faut refaire les rôles de texte et d'accent ; le clair n'est donc pas « la correction », c'est un second chantier de même taille.

**Ce que le contenu impose.** Le contenu principal est une grille de 40 illustrations aux cadres saturés (orange, vert, violet, rose) avec bandeau de texte clair. Sur `ink-900`, ces cadres sont les seules couleurs de l'écran : la hiérarchie « la couleur est un signal » (charte §1) tient sans effort. Sur un fond blanc, chaque carte devient un rectangle coloré parmi quarante et les badges « S / H / Fx » n'ont plus de contraste de contexte. La fiche imprimée le montre à petite échelle (`fiche-print-full-1440.png`) : à 56 px, ça passe ; à 97–110 px sur 13 rangées, ce serait un patchwork.

**Ce que l'usage impose.** Sessions longues de réglage, souvent le soir, au milieu d'outils eux-mêmes sombres (Discord est l'unique fournisseur OAuth de l'app, `LoginPage.tsx:197-212`). Le sombre est le registre attendu de la cible ; c'est une hypothèse produit que cet audit ne peut pas mesurer, mais elle est cohérente avec le choix d'origine.

**Ce que le clair apporte quand même.** Deux choses, et elles existent déjà : l'impression et le PDF (`@media print`, `sideSheetPdf.ts`). À terme, une variante claire *optionnelle* (préférence système) est un vrai argument d'accessibilité — l'halo des textes clairs sur fond noir gêne une part notable des lecteurs astigmates — mais elle n'est possible qu'une fois la palette tokenisée (§8, direction A, principe 3).

**Position** : garder le sombre par défaut ; le relever de deux crans (le fond `#0a0b0e` est en dessous du seuil où les bordures 1 px et les surfaces se distinguent — toutes les bordures mesurent 1,15–1,32:1) ; réduire l'échelle de texte à trois rôles tous ≥ 4,5:1 ; monter le corps à 13 px et le minimum à 11 px ; passer les valeurs en couches sémantiques (variables CSS) pour qu'un thème clair devienne une option, pas une réécriture.

## 8. Deux directions visuelles alternatives

Ratios calculés (formule WCAG 2.x) sur les fonds où le rôle est autorisé.

### Direction A — « Sombre relevé » (recommandée)

| Rôle | Hex | Ratios texte (sur page / surface / creux / puce / actif) |
|---|---|---|
| page | #111318 | — |
| surface (cartes, panneaux) | #181b22 | 1,08 sur page (séparation par bordure, comme aujourd'hui) |
| creux (champs, tuiles) | #1f232c | — |
| puce / survol | #262b36 | — |
| actif (onglet, segment) | #323846 | 1,47 sur surface |
| bordure décorative | #2e3441 | 1,38 sur surface |
| bordure de composant (champs, boutons secondaires) | #5c6579 | **2,95 sur surface, 3,18 sur page** (limite 1.4.11 ; prendre #667085 = 3,46 si la bordure doit passer partout) |
| texte 1 — valeurs, titres | #f3f4f8 | 16,9 / 15,7 / 14,3 / 12,9 / 10,7 |
| texte 2 — corps | #c9cfdb | 11,9 / 11,0 / 10,1 / 9,1 / 7,5 |
| texte 3 — libellés, en-têtes de tableau | #9aa3b6 | 7,3 / 6,8 / 6,2 / 5,6 / 4,6 |
| texte 4 — méta (horodatage, aide) — **page et surface seulement** | #7f8899 | 5,2 / 4,8 (4,4 sur creux : interdit) |
| positif (texte) / positif (aplat) | #5ee3a9 / #10a56f | 10,7 sur surface / noir sur aplat 6,6 |
| attention (texte) | #f6c453 | 10,6 |
| info (texte) | #6cc7f5 | 9,1 |
| négatif (texte) | #ff8a8a | 7,6 |
| carte de chaleur | conserver l'alpha, mais **texte noir dès que α > 0,5** : noir sur `#34d399` = 10,9 (aujourd'hui `ink-100` sur la case 19,6 % = 2,8) |

Trois principes :
1. **Trois rôles de texte, pas six, tous ≥ 4,5:1 sur les surfaces où ils sont autorisés ; corps 13 px, minimum 11 px (aucun 9 ni 10 px).** Les en-têtes de tableau passent en texte 3 gras 11 px, les deltas de tuile en texte 2 11 px, les aperçus de l'accueil en texte 3 11 px.
2. **Le chrome remonte de deux paliers, le contenu reste le point le plus lumineux.** Fond `#111318` au lieu de `#0a0b0e` : les bordures 1 px et les surfaces se détachent (1,38 au lieu de 1,15), les cartes ne « flottent » plus, l'ombre des menus reste perceptible. L'état actif (onglet, segment) prend l'aplat `#323846` + texte 1, jamais un simple changement de gris.
3. **Tout passe par des variables CSS de rôle** (`--surface-*`, `--text-1..4`, `--positive-*`…) définies dans `index.css` et mappées dans `tailwind.config.js` (`colors.surface.page: 'var(--surface-page)'`) ; les formules oklch des cartes de chaleur et du badge de note vivent dans `lib/colors.ts` seul. C'est ce qui rend un thème clair possible plus tard sans toucher aux composants.

Coût : palette + `index.css` + `tailwind.config.js`, puis remplacement guidé des 186 `text-ink-400/500/600` par un rôle, et des 159 tailles `[9px]/[10px]/[11px]` par l'échelle. Les recettes de composants (charte §7) restent valables telles quelles.

### Direction B — « Clair papier »

Reprend l'ADN de la fiche imprimée : surfaces blanches sur gris très pâle, texte quasi noir, accents en teintes 700.

| Rôle | Hex | Ratios (page / surface / creux / puce / actif) |
|---|---|---|
| page | #f4f5f8 | — |
| surface | #ffffff | 1,09 sur page |
| creux | #eceef3 | — |
| puce | #e3e6ed | — |
| actif | #d6dae3 | — |
| bordure décorative / de composant | #cfd4dd / #8a93a5 | 1,49 / **3,09** sur blanc |
| texte 1 | #14171e | 16,5 / 17,9 / 15,5 / 14,4 / 12,8 |
| texte 2 | #2f3541 | 11,3 / 12,3 / 10,6 / 9,9 / 8,8 |
| texte 3 | #565e6e | 6,0 / 6,5 / 5,6 / 5,2 / 4,7 |
| texte 4 — **blanc seulement** | #6b7384 | 4,8 sur blanc (4,4 sur page : interdit) |
| positif texte / aplat | #047857 / #059669 | 5,5 sur blanc / noir sur aplat 5,6 (ou blanc sur #047857 5,5) |
| attention / info / négatif (texte) | #a15c07 / #0369a1 / #c81e1e | 5,2 / 5,9 / 5,7 sur blanc |
| carte de chaleur | teinte pleine `#a7f3d0 → #10b981`, texte 1 : 16,4 sur la case la plus pâle, 11,8 sur `#6ee7b7` |

Trois principes :
1. **L'écran devient la fiche** : mêmes cadres pointillé / plein, mêmes badges noirs cerclés, la version imprimée et la version écran ne diffèrent que par la barre d'outils.
2. **Les illustrations sont posées sur blanc avec une ombre courte (0 1px 2px rgb(0 0 0 / .15)) et sans bordure** ; les badges de rôle passent en pastilles pleines teinte 700 à texte blanc.
3. **Aucun accent en teinte < 600 pour du texte** ; les fonds d'état sont des teintes 50–100 opaques (plus de translucidité).

Coût : tout le §2.4 de la charte (deux formules d'accent) est à refaire, les 42 fonds translucides et 45 bordures teintées à remapper, la carte de chaleur à repenser (l'alpha sur blanc éclaircit au lieu d'assombrir), les badges sur image à re-contraster. Le PDF et l'impression, eux, sont déjà conformes.

### Recommandation : A

Parce que (1) A conserve l'unique vrai atout visuel actuel — les artworks isolés sur un chrome neutre — et corrige ce qui est mesuré faux (gris et tailles), là où B corrige la même chose au prix d'une réécriture des accents et des cartes de chaleur ; (2) A ne change aucune recette de composant, seulement leurs tokens ; (3) A crée la couche de variables qui manque et rend B (ou une variante claire optionnelle) atteignable ensuite au lieu de la rendre nécessaire maintenant ; (4) B a déjà sa place, et elle est bonne : le PDF et l'impression, qui sont ce que l'utilisateur emporte au tournoi.

## 9. Non vérifié

- **Rendu sur macOS, iOS et Android** (polices SF / Roboto, lissage, comportement des barres d'outils mobiles sur `h-screen`, zoom automatique d'iOS sur les champs < 16 px) : mesuré sous Windows / Chrome seulement.
- **Lecteurs d'écran et navigation clavier complète** : seuls les faits structurels (`outline-none`, absence de `role="dialog"`, `lang="en"`) sont relevés ; aucun parcours NVDA / VoiceOver.
- **Simulation daltonienne** de la carte de chaleur divergente : non simulée ; constat limité au fait que le signe est écrit dans la cellule.
- **Impression physique** : l'émulation `print` de Chrome a servi de base ; le PDF généré par `sideSheetPdf.ts` n'a pas été ouvert dans cet audit (voir `03-donnees-conformite.md` si besoin).
- **Registre visuel des outils concurrents** (Master Duel, YGOPRODeck, EDOPro, etc.) : non consulté ; l'argument « le sombre est le registre attendu » est une hypothèse produit, pas une mesure.
- **Captures du comparateur avec decks identiques** (cinq bandeaux) : observées, puis remplacées par le passage final ; le comportement est sourcé dans `ComparePage.tsx:186-197`, la capture ne l'est plus.
- **Latence perçue** (« Recalcul… », « 3518 ms ») : hors périmètre visuel ; mentionnée seulement parce que l'état périmé à `opacity-45` aggrave le contraste.

## 10. Environnement démonté

Pile jetable arrêtée en fin d'audit (`npm run e2e -w web -- --down`) : conteneur `testhand-e2e-db` supprimé (`--rm`), serveur 8790 et Vite 5174 arrêtés. Le dépôt n'a pas été modifié hors `docs/audit/` (`git status`).
