# Charte de design — interface « YGO · probabilités & mains »

> **But de ce document.** Décrire, de façon autonome et vérifiable, le système visuel
> de cette application pour qu'un **autre projet** puisse le reprendre et produire une
> interface cohérente avec celle-ci, sans avoir accès à ce dépôt.
>
> **Refonte visuelle du 16 septembre 2026** (audit `docs/audit/01-visuel.md`, direction A
> « sombre relevé » ; compte rendu `docs/refonte-visuelle.md`) : palette relevée de deux
> paliers, quatre rôles de texte tous ≥ 4,5:1, échelle typographique fermée (corps 13 px,
> plancher 11 px), valeurs servies par des variables CSS, en-tête sur une ligne et onglets
> en bas sous 640 px. Les sections 1, 2, 3, 6, 7.8, 12 et 13 décrivent l'état refondu.
>
> Tout ce qui suit est extrait du code réel (`web/tailwind.config.js`, `web/src/index.css`,
> `web/src/lib/colors.ts`, `web/src/components/*`). Les classes Tailwind citées servent
> de référence d'implémentation ; la §12 donne les mêmes tokens en CSS pur pour un projet
> qui n'utilise pas Tailwind.

---

## 1. L'intention en dix règles

Ce sont les décisions qui produisent la sensation « épurée et sombre ». Les copier
suffit à obtenir une interface de la même famille ; les enfreindre casse l'accord
même si la palette est respectée.

1. **Le sombre n'est pas un thème, c'est le seul mode.** `color-scheme: dark`, aucune
   variante claire n'existe (les variables CSS la rendent possible, elle n'est pas faite).
   Le fond est profond (`#111318`), pas un gris moyen : c'est ce qui laisse « respirer » les
   images et fait ressortir les chiffres. Il a été relevé de `#0a0b0e` à la refonte : en
   dessous, une bordure de 1 px ne se distinguait plus de la surface (1,15:1).
2. **Le chrome est chromatiquement neutre.** Toute l'ossature — fonds, bordures, textes,
   boutons secondaires — vit sur une seule échelle de gris froids. **La couleur est un
   signal, jamais une décoration.** Une teinte qui apparaît veut dire quelque chose.
3. **La séparation se fait par bordures 1 px et paliers de fond, pas par ombres.**
   Les surfaces posées à plat n'ont aucune ombre. Seuls les éléments *flottants*
   (popover, dialogue, toast) en portent une, et volontairement lourde.
4. **Les chiffres sont le produit.** Toute valeur numérique est en chiffres tabulaires
   (`font-variant-numeric: tabular-nums`), alignée à droite, et affichée dans la couleur
   de texte la plus claire de l'échelle. Le libellé, lui, est discret.
5. **Densité assumée, lisibilité garantie.** Le corps de l'interface est à **13 px**, et
   **aucun texte n'est sous 11 px** (seule dérogation : les cellules des matrices A / B du
   comparateur sous 640 px, à 10 px). Les paddings sont de l'ordre de 4–10 px. On
   privilégie de voir beaucoup d'un coup plutôt que de l'air.
6. **Hiérarchie par la valeur de gris, pas par la graisse.** Quatre rôles de texte
   (`fg-1` à `fg-4`), tous lisibles (≥ 4,5:1), font tout le travail. `font-semibold` est réservé aux
   titres courts et aux valeurs ; il n'y a pas de `font-bold` généralisé.
7. **Le rayon d'arrondi croît avec l'élévation.** 4 px pour les contrôles à plat,
   6 px pour les tuiles et lignes de liste, 8 px pour les surfaces flottantes,
   12 px pour les dialogues et les grandes cartes.
8. **Les états se disent par un triplet teinté**, toujours le même : fond translucide
   (10–20 %), texte clair de la teinte, contour translucide (30–40 %). Jamais d'aplat
   saturé pour un état — l'aplat est réservé à l'action.
9. **Les avertissements sont dans l'interface, jamais dans la console.** Toute condition
   anormale (hors bornes, donnée manquante, requête invalide) prend la forme d'un
   bandeau teinté à sa place dans le flux, avec le texte complet de l'explication.
10. **Le mouvement ne sert qu'à la lisibilité.** Transitions de couleur ~150 ms,
    barres qui grandissent en 300 ms, rien d'autre. Pas d'entrée animée, pas de parallaxe.

---

## 2. Couleur

### 2.1 Surfaces `ink` et rôles de texte `fg` — la colonne vertébrale

Deux familles, servies par des **variables CSS** (`web/src/index.css`, `:root`) et exposées
à Tailwind par `web/tailwind.config.js` (`ink-900: 'var(--ink-900)'`). Aucun composant ne
connaît une valeur hexadécimale : un thème alternatif se fait en redéfinissant `:root`.

**Surfaces et bordures** — gris froids (≈ 230° de teinte, jamais du gris pur ni chaud) :

| Token | Hex | Rôle canonique |
|---|---|---|
| `ink-950` | `#111318` | Fond de l'application, de l'en-tête et de la barre d'onglets du bas, fond des `<kbd>` |
| `ink-900` | `#181b22` | Surface de contenu : cartes, panneaux, lignes de liste, dialogues |
| `ink-850` | `#1f232c` | Contrôles en creux (champs, `select`, steppers) et surfaces flottantes |
| `ink-800` | `#262b36` | **Bordure de séparation par défaut** · fond de puce · fond de survol · piste de barre |
| `ink-700` | `#323846` | **Bordure des surfaces flottantes et des champs** · état actif · bouton secondaire |
| `ink-600` | `#3d4452` | Bouton segmenté actif · pouce d'ascenseur · bordure en pointillés |
| `ink-500` | `#667085` | **Bordure de composant** (3,46:1 sur la surface : passe WCAG 1.4.11) · couleur par défaut de `Bar` |

`ink-400` à `ink-100` **n'existent plus** : ils ne servaient qu'au texte.

**Texte — quatre rôles**, tous ≥ 4,5:1 sur les surfaces où ils sont autorisés :

| Classe | Hex | Emploi | Ratio page / surface / creux |
|---|---|---|---|
| `text-fg-1` | `#f3f4f8` | Valeurs numériques, titres, noms d'objets | 16,9 / 15,7 / 14,3 |
| `text-fg-2` | `#c9cfdb` | Corps, couleur du `<body>`, delta de tuile, texte de carte | 11,9 / 11,0 / 10,1 |
| `text-fg-3` | `#9aa3b6` | Libellés, en-têtes de tableau, étiquettes de section, onglets inactifs | 7,3 / 6,8 / 6,2 |
| `text-fg-4` | `#7f8899` | Méta pur : date, horodatage, passcode | 5,2 / 4,8 / **4,4 — interdit sur `ink-850`** |

**Règle d'affectation** (c'est elle que la refonte corrige : avant, trois paliers sous le
seuil — 4,2 / 2,5 / 1,7:1 — portaient des libellés, des deltas et des en-têtes de tableau) :
une information dont la lecture est nécessaire n'est **jamais** en `fg-4`, et `fg-4` n'est
jamais posé sur un creux. Tout ce qui est « atténué » passe par `fg-3`, qui reste lisible.

### 2.2 L'escalier des surfaces

L'empilement est strict et se lit du plus sombre (le plus loin) au plus clair (le plus près) :

```
ink-950   fond de page + en-tête           ← le plus sombre : la page « recule » (#111318)
  └ ink-900   panneau / carte / dialogue      + bordure ink-800
      └ ink-850   champ, select, popover       + bordure ink-700
          └ ink-800   puce, badge, survol
              └ ink-700   état actif, bouton secondaire
```

Deux points contre-intuitifs mais essentiels :

- **L'en-tête est plus sombre que le contenu** (`ink-950` sur `ink-900`), à l'inverse
  de l'habitude. Le chrome s'efface ; c'est le contenu qui est éclairé.
- **La bordure d'une surface flottante est plus claire (`ink-700`) que celle d'une
  surface à plat (`ink-800`).** C'est ce décalage, plus l'ombre, qui signale « ceci
  est au-dessus » sans recourir à un fond plus clair.

### 2.3 Accents — quatre teintes, quatre significations

Chaque teinte a un sens unique et non négociable. Une cinquième couleur n'existe pas.

| Teinte | Signification | Où |
|---|---|---|
| **Émeraude** | Action primaire · positif · confirmé · « bon » | Bouton Enregistrer, bouton Créer, mode de liaison, taux favorables, deltas favorables |
| **Ambre** | Attention · condition · à vérifier — jamais une erreur | Hors bornes, brouillon retrouvé, dépendances, éléments non annotés |
| **Ciel** | Information · catégorisation neutre | Mode de catégorisation, bandeaux informatifs, marquage de la carte piochée en plus |
| **Rouge** | Destructif · négatif · invalide | Supprimer / se déconnecter, taux défavorables, erreurs de saisie |

**En texte**, chaque teinte passe par un token (`index.css`) : `text-pos` `#5ee3a9`,
`text-warn` `#f6c453`, `text-info` `#6cc7f5`, `text-neg` `#ff8a8a` (7,6 à 10,7:1 sur la
surface). Les aplats et les contenants translucides gardent la palette Tailwind par défaut :

Valeurs utiles (palette Tailwind par défaut, à reproduire telles quelles) :

```
emerald-600 #059669   emerald-500 #10b981   emerald-400 #34d399   emerald-300 #6ee7b7   emerald-200 #a7f3d0
amber-500   #f59e0b   amber-400   #fbbf24   amber-300   #fcd34d   amber-200   #fde68a
sky-500     #0ea5e9   sky-400     #38bdf8   sky-300     #7dd3fc   sky-200     #bae6fd
red-500     #ef4444   red-400     #f87171   red-300     #fca5a5
```

Seule exception au principe « la couleur est un signal » : **`#5865F2`**, la couleur de
marque Discord sur son bouton d'authentification. Une couleur de marque tierce est
tolérée uniquement sur le contrôle qui invoque cette marque.

### 2.4 Les deux formules d'accent

Tout usage d'accent tombe dans l'un des deux moules suivants. Il n'y a pas de troisième cas.

**A. « Contenant d'état » — pour un mode actif, un bandeau, une puce de statut.**
Fond translucide très faible, texte clair de la teinte, contour translucide :

```
fond    : <teinte>-500 à 10–20 % d'opacité      (bg-emerald-500/10 … /20)
texte   : <teinte>-200 ou -300                  (text-pos)
contour : <teinte>-500 à 30–40 %                (border-…/30  ou  ring-1 ring-…/40)
```

La translucidité est le point clé : l'accent se pose **sur** le fond sombre et en
hérite la profondeur, au lieu de le percer.

**B. « Action » — pour le bouton primaire uniquement.**
Aplat opaque, **texte noir** (pas blanc), teinte qui s'éclaircit au survol :

```
bg-emerald-600  text-black   hover:bg-emerald-500
```

Le texte noir sur émeraude est délibéré : il crée le seul point vraiment lumineux de
l'écran et rend le bouton primaire impossible à manquer dans une interface par
ailleurs entièrement sourde. La même recette sert en ambre pour une action de
récupération (`bg-amber-500 text-black`).

---

## 3. Typographie

### 3.1 Familles

```css
/* Interface : pile système, aucune police chargée */
font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
-webkit-font-smoothing: antialiased;

/* Monospace : réservée aux saisies de données brutes (listes d'identifiants), `font-mono`.
   JetBrains Mono était déclarée sans jamais être chargée : retirée à la refonte. */
font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
```

Aucune webfont n'est téléchargée. C'est un choix : la pile système participe au
caractère « outil » et supprime tout FOUT.

### 3.2 Le mécanisme des chiffres — à reprendre absolument

Les nombres **ne passent pas** par une police monospace. Ils utilisent une classe
utilitaire appliquée partout où une valeur est affichée :

```css
.tnum {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}
```

On garde donc la police d'interface (compacte, familière) tout en obtenant des colonnes
de chiffres parfaitement alignées qui ne « sautent » pas quand la valeur change en
temps réel. C'est le détail le plus rentable de tout le système.

### 3.3 Échelle

**Échelle fermée** : `theme.fontSize` est redéfini en entier dans `tailwind.config.js` ;
`text-xs`, `text-sm`, `text-base`… n'existent plus, et une classe d'origine oubliée ne
produit rien. Les tailles arbitraires (`text-[10px]`) sont proscrites.

| Classe | Taille | Graisse | Emploi |
|---|---|---|---|
| `text-glyph` | 24 px | — | Le `+` de la tuile d'ajout. Unique. |
| `text-hero` | 20 px | semibold | Le résultat de probabilité mis en avant. Unique. |
| `text-title` | 18 px | bold | Logotype de la page de connexion, ✓ de sélection sur tuile. |
| `text-head` | 16 px | semibold | Titre de dialogue, titre de la fiche. |
| **`text-value`** | **14 px** | semibold / normal | Titres de panneau, noms d'objets, valeurs de statistiques |
| **`text-body`** | **13 px** | medium / normal | **Corps de référence** : boutons, onglets, lignes de liste, texte |
| **`text-meta`** | **11 px** | normal / medium | **Plancher** : libellés, étiquettes de section, puces, horodatages, badges |
| `text-cell` | 10 px | — | **Dérogation unique** : cellules compactes des matrices A / B du comparateur sous 640 px |

La dérogation `text-cell` est motivée (étape 7B) : sous 640 px, A et B restent côte à côte
sans défilement ; à 11 px, six colonnes ne tiennent plus dans une demi-largeur de 360 px.
Elle monte de 9 à 10 px à la refonte. Dès 640 px, les mêmes cellules sont en `text-meta`.

### 3.4 La formule d'étiquette de section

Un seul motif pour tous les titres de section, sur-titres et en-têtes de tableau :

```
text-meta (11 px) · MAJUSCULES · letter-spacing: 0.025em · text-fg-3
```

En-tête de tableau : même formule. **Jamais** le palier le plus faible de l'écran :
l'en-tête guide la lecture du tableau. C'est le marqueur typographique le plus
identifiable de l'interface. Aucun titre de
section n'est en gros et en gras : la hiérarchie vient du contraste faible + capitales,
pas de la taille.

### 3.5 Paire libellé / valeur

Motif récurrent (fiches de deck, récapitulatifs de mains) : **valeur au-dessus,
libellé en dessous**, jamais l'inverse.

```
valeur   text-value (14 px)  semibold  tabulaire  coloré (text-pos / text-neg / text-fg-2)
libellé  text-meta (11 px)   MAJUSCULES  tracking-wide  text-fg-3
```

---

## 4. Espacement, rayons, bordures

### 4.1 Rythme

Base 4 px, valeurs réellement employées : 2, 4, 6, 8, 12, 16, 20.
Paddings de contrôle typiques : **horizontal 6–12 px, vertical 2–6 px**.
Gouttières : 4 px (dense) · 6 px (grille de vignettes) · 8 px (groupes de contrôles) ·
12 px (blocs indépendants).

Padding par conteneur : dialogue 20 px · panneau 12 px · barre d'outils 8 × 6 px ·
ligne de liste 8 × 6 px.

### 4.2 Rayons — l'échelle suit l'élévation

| Rayon | Emploi |
|---|---|
| 2 px | Barres de progression, cases à cocher |
| **4 px** | **Défaut** : boutons, puces, champs, éléments de menu |
| 6 px | Tuiles, lignes de liste, blocs encadrés |
| 8 px | Popovers, contenus de menu déroulant, toasts, cartes de matrice |
| 12 px | Dialogues, cartes de deck, blocs d'état vide |
| 50 % | Pastilles de statut, avatar, badge de note |

### 4.3 Bordures

**Toujours 1 px.** Il n'y a pas de bordure épaisse dans le système — l'emphase passe
par un *ring* (contour extérieur) de 1 ou 2 px, pas par un épaississement.

- Séparation dans le flux : `ink-800`
- Contour de surface flottante ou de champ : `ink-700`
- Bordure « à créer / à remplir » : **pointillés** `ink-600` ou `ink-700`
- Séparateur fin dans un menu : 1 px de `ink-700`, marge verticale 4 px
- Séparateur vertical dans une barre : `width:1px; height:20px; background:ink-800`

Le **pointillé** est sémantique : il signifie « emplacement, condition, ou dépendance »
(zone de dépôt de fichier, état vide, marqueur de prérequis). Ne jamais l'employer
décorativement.

---

## 5. Élévation

Trois niveaux seulement, et **l'ombre n'existe qu'au niveau 3**.

| Niveau | Recette |
|---|---|
| 0 — page | `ink-950`, aucune bordure |
| 1 — surface | `ink-900` + bordure 1 px `ink-800`. **Aucune ombre.** |
| 2 — creux | `ink-850` + bordure 1 px `ink-700` (champs, contrôles en retrait) |
| 3 — flottant | `ink-850`/`ink-900` + bordure 1 px `ink-700` + **ombre noire lourde** |

L'ombre du niveau 3 :

```css
box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.5);   /* popovers, menus */
box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.6);   /* toast */
```

Une ombre **noire à 50–60 %**, pas une ombre grise diffuse : sur un fond quasi-noir,
c'est le seul type d'ombre qui reste perceptible.

Voile de modale : `rgb(0 0 0 / 0.7)` plein écran, sans flou d'arrière-plan.

---

## 6. Structure de page

### 6.1 Le squelette

Toutes les pages suivent la même armature — hauteur d'écran fixe, une seule zone qui
défile :

```
h-[100dvh] · flex-col
├── <header>  shrink-0        ink-950, bordure basse ink-800, une ligne de 48 px (h-12)
├── [bandeau d'alerte]        conditionnel, teinté, dans le flux
├── <div>     flex-1 min-h-0  ← la seule zone en overflow-y-auto
│    ├── <main>  flex-1 min-w-0, bordure droite ink-800
│    │    ├── <nav>  onglets soulignés, shrink-0, fond ink-900   (dès 640 px seulement)
│    │    └── contenu
│    └── <aside>  largeur fixe 500 px, masqué sous 1024 px
└── <nav>     shrink-0        barre d'onglets du bas, 48 px     (sous 640 px seulement)
```

`h-[100dvh]` et non `h-screen` : sur mobile, la barre d'outils dynamique du navigateur
recouvrirait la barre d'onglets du bas. **Une seule des deux `<nav>` est rendue** (état
`compact`, `matchMedia('(max-width: 639px)')`), jamais les deux masquées par CSS. La barre
du bas est le dernier enfant de la colonne, pas un `fixed` : elle ne recouvre jamais le
contenu.

Le couple **`min-h-0` + `flex-1`** est indispensable : c'est lui qui garde l'en-tête
et les barres d'outils toujours visibles et confine le défilement à une seule colonne.

### 6.2 En-tête

**Une seule ligne à toute largeur** (48 px, sans `flex-wrap`). Ordre invariable :
**retour → identité éditable (`flex-1 min-w-0`, cède la place en premier) → puce de taille
→ `ml-auto` → action primaire → compte**. Sous 640 px, « ← Decks » devient « ← » et le menu
compte n'affiche que l'initiale.

N'y figurent **ni réglage d'analyse ni état** (avant la refonte, l'en-tête de l'éditeur
tenait sur trois lignes et 118 px à 360 px) :
- le réglage de contexte vit dans la **barre de contexte** sous l'en-tête (plans de side v2, D3,
  `StudyBar`) : sélecteur natif du deck étudié (« Deck de base » / « contre X », 24 px), bascule
  Premier / Second (contrôle segmenté `sm`, 24 px — plancher des cibles secondaires), raison d'un
  plan sans chiffre en `text-warn` ; `flex-wrap` : les deux commandes tiennent sur une ligne de
  32 px à 360 px (libellé « Étudier » masqué sous 640 px), une raison passe à la ligne ; une seule
  commande pour tous les onglets, le panneau et le mur n'ont plus la leur ;
- le bouton d'enregistrement (`data-save`) dit « Enregistrer » quand il y a du
  non-enregistré et « enregistré 10:04 » au repos, inerte : l'horodatage est son état ;
- « en ligne / hors-ligne » est une ligne d'état du menu compte ;
- une erreur de persistance prend une seconde ligne pleine (bandeau rouge, §7.12).
`margin-left: auto` sur le groupe de droite est le mécanisme d'alignement unique ;
aucune grille n'est utilisée dans les barres.

### 6.3 Responsive

Deux points de rupture structurels. **640 px** : la navigation de l'éditeur passe en bas,
au pouce (six entrées de 48 px à libellé court — Annoter, Combos, Mains, Invent., Side,
Stats —, nom complet en `title`), et la barre de modes masque ses touches `<kbd>`, sans
objet au toucher. **1024 px** :
Au-dessus, le panneau de statistiques est une colonne latérale permanente. En dessous,
il **devient un onglet** de la zone principale — et l'onglet se referme automatiquement
quand la fenêtre repasse en large. La stratégie est donc « déplacer le contenu dans la
navigation », pas « empiler ».

Grilles fluides, jamais de nombre de colonnes en dur :

```css
grid-template-columns: repeat(auto-fill, minmax(96px,  1fr));  /* tuiles de cartes (grille d'annotation) */
grid-template-columns: repeat(auto-fill, minmax(72px,  1fr));  /* vignettes en lecture (inventaire) */
grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));  /* cartes de deck */
```

Largeurs validées à l'écran (étape 6B, contrat §6) : **360, 390 et 768 px** en plus du
bureau. Sous 400 px, les barres d'en-tête et les bandeaux de mode **passent à la ligne**
(`flex-wrap`) au lieu de déborder ou d'écraser leurs pastilles ; les zones de fichier du
dialogue d'import passent en une colonne sous 640 px (`sm:`). Cibles tactiles : **32 px**
(`h-8 w-8` ou `py-2` sur `text-body`) pour le stepper de copies, le menu ⋯ d'une tuile ou
d'un deck, les actions primaires (Enregistrer, Nouveau deck, Importer, Terminer, ✕ d'un
dialogue) ; **24 px minimum** partout ailleurs (onglets, boutons de mode, sélecteur de
contexte, lignes d'inventaire, entrées de menu). Le minimum de 96 px par tuile vient de
là : un stepper de trois cibles de 32 px sur sa propre ligne, puis le delta insécable et le
menu ⋯ côte à côte.

Comparateur et mur de mains (étape 7B, contrat §5 / §6, gardés par `web/e2e/` scénario
`mobile`) : l'en-tête du comparateur suit la recette de l'accueil (`flex-wrap`,
`gap-x-3 gap-y-2`, libellés `whitespace-nowrap`, noms A / B en `flex-1 basis-0 truncate`
pour qu'ils cèdent la place en premier) ; ⇄ Inverser A/B, Exporter Excel, Comparer et le ✕
du dialogue rejoignent la liste des cibles de 32 px. Les matrices A et B restent **côte à
côte à toute largeur** : sous 640 px, `grid grid-cols-2 gap-2` avec Δ en `col-span-2`, puis
`sm:flex sm:flex-wrap sm:gap-4` ; les cellules deviennent compactes sous 640 px (`text-cell`,
`border-spacing-px`, `px-px py-1`, `min-w-5` soit 20 px par colonne pour qu'une colonne de
« · » n'écrase pas son en-tête, coin « S\U »), puis reprennent `text-meta`, `w-8`, `p-1`
comme la matrice du panneau ; le conteneur et les cartes se resserrent (`p-2` / `p-1.5`)
sous 640 px pour garder quelques pixels de marge quelle que soit la police système. La
matrice Δ, seule en pleine largeur sous 640 px, n'est jamais compacte (étape 9A :
`MatrixGrid compact={false}`, `text-meta`, `w-8`, `p-1` partout). Une ligne de main du mur
garde une bande de cartes `shrink-0` : les vignettes ne sont jamais déformées. Étape 9A : sous
640 px la ligne est compacte (`p-1`, cartes `h-[60px]`, récapitulatif empilé « S n / U n » en
11 px et note `h-7 w-7` à droite des cartes, sur la même ligne, ligne ≤ 80 px) ; dès 640 px
(`sm:`), `flex-wrap`, cartes `h-[68px]`, récapitulatif complet (paire valeur / libellé, §3.5)
et note `h-9 w-9`. « ↻ Nouvelles mains » suit la recette du bouton secondaire à 32 px
(`px-3 py-2 font-medium`, fond `ink-700`) : action primaire par la taille, pas par la couleur
(un seul bouton émeraude par écran). L'éditeur de condition ET/OU rend chaque groupe imbriqué
par un encadré `border-ink-700 bg-ink-900/60` en `flex-wrap` ; ses sélecteurs, champ « ≥ n »
et ✕ mesurent 24 px (`h-6`). La tuile d'annotation reste à 96 px minimum : à 84 px, les trois
cibles de 32 px tiennent mais le delta « −1 : −6.38% » est coupé (mesuré en 9A).

Extra et side (étape 9C, `ZoneCardTile`, `ZoneBlock` dans la grille d'annotation) : un bloc par
zone sous un seul repli, en-tête `flex-wrap` (nom de la zone, compteur en puce `tnum` — ambre
au-delà de 15, repère sans refus —, « + Ajouter » à 32 px `h-8` aligné à droite), puis
`repeat(auto-fill, minmax(80px, 1fr))` : la tuile de zone n'a que l'image (ratio 59/86) et le
stepper de la recette §7.6 à 32 px (`h-8 w-8`), aucun delta ni menu ⋯, d'où 80 px et non 96
(4 colonnes à 360 px, 10 à 1440 px avec le panneau). Le toast de retrait (§7.13) nomme la zone
quittée (« Retirée du side deck : … ») et son « Annuler » restaure dans cette zone.

Plans de side v2, partie C (22 septembre 2026) — **tout chiffre nomme son deck** (S1) : chaque
colonne du panneau porte, sous son titre, le nom du deck étudié (`data-study-label`, `text-fg-3`
pour le deck de base, `text-fg-2` pour un deck sidé, `text-info` préfixé « aperçu · » pour un
échange en préparation) ; la matrice, les deux résultats du mode Requête et la barre du mur de mains
le répètent. Un plan pas prêt n'affiche **aucun chiffre** dans sa colonne, seulement sa raison en
`text-warn` (S2) ; le mur de mains affiche la raison à la place des mains. Sur les tuiles, un badge
`bg-black/75` en bas à droite dit ce que le plan étudié fait de la carte (« sort ×n » / « entre ×n ») ;
une carte entièrement sortie remplace son écart par « sort (plan) », une carte de side entrante
remplace « hors calcul » par son écart ; un bandeau `text-info/90` rappelle en tête de grille que les
steppers et les modes éditent le deck de base.

Plans de side (étape 10C). Dans la grille d'annotation, le bloc **side** rend de vraies tuiles
(`CardTile zone="side"`, 96 px comme le main : tous les modes, badges, menu ⋯ qui retire **du side**) ;
à la place du delta, « hors calcul » en `text-fg-3` (ni delta ni couleur de groupe : ces cartes ne
sont pas dans le calcul du deck de base). L'extra garde `ZoneCardTile` (80 px, nu). L'onglet
« Plans de side » **v2, partie D (22 septembre 2026)** : puces d'adversaire à 32 px (la puce active est
l'adversaire étudié de la barre) ; ligne de l'adversaire (nom, « plan premier / second », puce d'état,
tailles « main 40 → 40 · extra 15 → 15 ») ; avertissement de format en bandeau ambre ; grilles d'une
**tuile par carte** (`repeat(auto-fill, minmax(84px, 1fr))`, image au ratio 59/86, nom en `text-meta`
`text-fg-2` tronqué, « libres / copies » en `tnum`) : sélectionnée = `ring-2 ring-emerald-300` + voile
`emerald-500/20` et « +k » ; engagée = image `opacity-45` + badge « sort ×n » / « entre ×n » ; épuisée =
`opacity-60` ; écart du candidat en `text-pos` / `text-neg`, « · » pour zéro, « … » en cours ; blocs
Main / Side, puis Extra / Side → extra quand l'un des deux existe ; **barre d'action collante** en bas
(`sticky bottom-0`, `bg-ink-950/95`) : sélection, aperçu (« aperçu · second » en `text-info`, trois
chiffres, écart avec le plan), « Vider la sélection », « Échanger » (32 px, `bg-ink-700`, inerte avec la
raison en `text-warn` dessous) ; plan : listes en puces de 24 px (✕ = toutes les copies), « Annuler
l'échange », « Vider le plan », recopie, note, puis « Fiche imprimable » / « Comparer » qui deviennent
« Enregistrer et ouvrir… » avec la raison en `text-fg-3` à côté ; sous 1024 px, le panneau
« Probabilités » est rendu sous le plan (`[data-side-panel]`, bordure `ink-800`).

Ancienne description (étape 10C, remplacée) : puces d'adversaire à 32 px (`h-8`, active `bg-ink-700`) en
`flex-wrap`, champ d'ajout et « + Ajouter » à 32 px ; ligne de l'adversaire en `flex-wrap` (nom en
champ transparent, contrôle segmenté Premier / Second, puce d'état en triplet — émeraude « Prêt »,
ambre « Incomplet » / « À revoir » —, taille « main 40 → 40 » en `tnum`, « Supprimer l'adversaire »
fantôme). Main et side en `md:grid-cols-[2fr_1fr]`, empilés sous 768 px ; une tuile **par
exemplaire** (`repeat(auto-fill, minmax(56px, 1fr))`, image seule au ratio 59/86) : sélectionnée =
`ring-2 ring-emerald-300` + voile `emerald-500/20` et ✓ ; engagée dans le plan = `opacity-45` et
marqueur « sort » / « entre » en bas à droite (`bg-black/75`, 10 px, §7.15) ; clic gauche et clic
droit ont le même effet (menu natif neutralisé dans cette vue). « Échanger » est le bouton
secondaire à 32 px (`bg-ink-700`, `font-medium`) : un seul bouton émeraude par écran, et c'est
Enregistrer. Listes du plan en puces de 24 px avec ✕ de 24 px ; écarts et sources neutralisées en
bandeau ambre (§7.12) ; chiffres en paires libellé / valeur (§3.5), écart signé en émeraude / rouge
par signe exact, « · » pour zéro.

Fiche imprimable (étape 10D, retouchée le 11 septembre 2026, `/decks/:id/side/fiche`) : page
autonome, sombre à l'écran ; barre d'outils `print:hidden` (retour, case « Noms des cartes »,
« Tout calculer (n) » en bouton secondaire à 32 px avec progression `tnum`, « Télécharger le PDF »
émeraude — la seule action émeraude de la page). Un bloc par adversaire (`break-inside-avoid`,
`rounded-md border-ink-800 bg-ink-900 p-2.5`), deux colonnes `sm:grid-cols-2` (toujours deux à
l'impression) : libellé de volet en étiquette de section (§3.4), puis deux cadres côte à côte —
**SORT** (`border-2 border-dashed`, rouge, « − Sort ») et **ENTRE** (`border-2 border-solid`,
émeraude, « + Entre ») : le sens tient au libellé et au style de bordure, jamais à la couleur
seule. Vignettes au ratio 59/86 de 56 px de large (14 mm à l'impression), nom masqué par défaut ;
une carte en plusieurs copies porte un **gros badge « ×n »** (disque noir cerclé de blanc, 32 px,
texte blanc extra-gras, 7 mm à l'impression) qu'on ne peut pas rater. Trois paires libellé / valeur en 11 px (« — » pour
un chiffre à calculer), note en italique. Badges et cadres portent `print-exact`
(`print-color-adjust: exact`) : Chrome n'imprime pas les fonds par défaut. **L'impression est la
seule exception au thème sombre** : `@media print` (index.css) passe `html`, `body` et `#root` en
fond blanc et texte noir, A4, marges de 10 mm ; les classes `print:` éclaircissent bordures et
textes. Le PDF téléchargé (`lib/sideSheetPdf.ts`) reprend la même grammaire en millimètres : fond
blanc, cadres pointillé rouge / plein vert sur fond pâle, vignettes de 14 mm, badge de 7,2 mm,
pagination à blocs entiers. Cible prouvée par l'e2e `sidesheet` : au moins 3 adversaires par page
A4 (sept en trois pages au plus), 4 si les plans sont petits (`lib/sideSheetPdf.test.ts`).
Comparateur sur un deck sidé : même page, nom « Deck — Adversaire (position) » et note
d'information bleue (§7.12, `info`).

### 6.4 Ascenseurs

Discrets et cohérents avec le chrome — à reprendre tel quel :

```css
* { scrollbar-width: thin; scrollbar-color: #333a4a transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb { background: #333a4a; border-radius: 6px; }
```

---

## 7. Recettes de composants

Décrites sémantiquement, avec les classes Tailwind d'origine comme référence.

### 7.1 Bouton primaire
`bg-emerald-600 text-black text-body font-medium px-3 py-1.5 rounded hover:bg-emerald-500`
— désactivé : `bg-ink-800 text-fg-3 cursor-default` (pas seulement une opacité).

### 7.2 Bouton secondaire
`border border-ink-700 text-fg-2 px-3 py-1.5 rounded text-body hover:bg-ink-800`
— désactivé : `disabled:opacity-40`.

### 7.3 Bouton fantôme (le plus courant)
`text-fg-3 px-2 py-1 rounded text-body hover:bg-ink-800 hover:text-fg-1`
Le survol agit **sur deux propriétés à la fois** : le fond apparaît *et* le texte
s'éclaircit d'un cran. C'est systématique.

### 7.4 Champ de saisie
`bg-ink-850 border border-ink-700 rounded px-2 py-1.5 text-value text-fg-1
outline-none placeholder:text-fg-4 focus:border-ink-500`
Variante « éditable en place » (nom de deck, nom de carte) : **aucun cadre au repos**,
`bg-transparent`, un fond apparaît au survol et au focus (`hover:bg-ink-900
focus:bg-ink-900`). Le champ ne se déclare comme champ qu'à l'approche.

### 7.5 Contrôle segmenté
Conteneur `inline-flex rounded-md border border-ink-700 bg-ink-850 overflow-hidden`,
segments sans bordure interne. Actif `bg-ink-600 text-fg-1`, inactif
`text-fg-3 hover:bg-ink-800 hover:text-fg-2`. Deux tailles : 11 px / 8×2 px et
12 px / 10×4 px.

### 7.6 Stepper numérique
`flex items-center rounded border border-ink-700 bg-ink-850`, `−` et `+` en
`text-fg-3 hover:text-fg-1 disabled:opacity-30`, valeur au centre en tabulaire
sur une largeur fixe pour que rien ne bouge.

### 7.7 Puce / badge
`rounded bg-ink-800 px-1.5 py-0.5 text-meta text-fg-3` — variante d'alerte :
`bg-amber-500/15 text-warn`.

### 7.8 Onglet
**Souligné** (refonte : l'ancien remplissage `bg-ink-700` se distinguait à peine).
`-mb-px h-10 px-3 border-b-2 text-body font-medium` ; actif `border-emerald-500 text-fg-1`,
inactif `border-transparent text-fg-3 hover:border-ink-600 hover:text-fg-1`,
`aria-current="page"` sur l'actif. Barre sur `bg-ink-900`, bordure basse `ink-800`, **jamais
de défilement horizontal** : avant la refonte, 208 px d'onglets étaient masqués à 360 px sans
indice. Sous 640 px, barre du bas : `h-12 flex-1 border-t-2 text-meta`, même couleur d'actif.
Chaque onglet porte son nom complet en `title` à toute largeur.

### 7.9 Dialogue
Voile `fixed inset-0 z-50 bg-black/70 p-4` fermant au clic ; panneau
`rounded-xl border border-ink-700 bg-ink-900 p-5 shadow-2xl`, `max-w-md`/`max-w-lg`,
`max-h-[80vh]` avec défilement interne, et `stopPropagation` sur le panneau.
En-tête de dialogue : titre 16 px semibold `ink-100` + `✕` en `text-fg-3 hover:text-fg-2`.

### 7.10 Menu déroulant / popover
`rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-2xl shadow-black/50`,
largeur minimale 170–200 px. Éléments : `rounded px-2 py-1.5 text-body text-fg-2`,
survol `bg-ink-700`. Élément destructif en `text-neg`.
Toujours rendu dans un *portal* avec évitement de collision (`collisionPadding: 8`).

### 7.11 Case à cocher
Un simple carré de 14 px : `h-3.5 w-3.5 rounded-sm border`, non coché
`border-ink-500`, coché **aplat plein de la teinte** `border-emerald-400 bg-emerald-400`
(ou ambre selon le sens). Pas de coche dessinée — le remplissage suffit.

### 7.12 Bandeau d'alerte
`border-b px-3 py-1.5 text-body` avec la formule d'accent A. Trois sévérités :

```
erreur        border-red-500/40    bg-red-500/10    text-neg
avertissement border-amber-500/30  bg-amber-500/10  text-warn
information   border-sky-500/20    bg-sky-500/5     text-info
```

### 7.13 Toast
`fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-ink-700 bg-ink-850
px-3 py-2 shadow-2xl shadow-black/60`, disparition automatique à 6 s, et **contient
son action d'annulation** en bouton primaire compact.

### 7.14 État vide
`rounded-xl border border-dashed border-ink-700 p-8 text-center`, centré, largeur
maximale ~448 px. Trois strates : une phrase de constat (14 px `ink-300`), une phrase
de conseil (12 px `ink-500`), un bouton primaire. Jamais d'illustration.

### 7.15 Tuile média (ici : tuile de carte)
Ratio d'image fixe, image en `object-cover`, `rounded-md`, bordure 1 px `ink-800` qui
**change de couleur selon l'état** plutôt que de s'épaissir. Les incrustations sont
positionnées par coin, chacune avec un rôle réservé :

```
haut-gauche  : badges de rôle (aplat coloré, texte noir, 10 px bold)
haut-droite  : pastilles d'appartenance (ronds de 12 px, ring-1 ring-black/50)
bas-gauche   : marqueurs d'état négatif (bg-black/70, texte rouge, 9 px)
bas-droite   : marqueur de relation / compteur (bg-black/75, 10 px)
```

Annotations par défaut (17 septembre 2026) : un badge de rôle **hérité** (détection, référence)
n'est pas un aplat mais un contour sur fond noir (`bg-black/75 ring-1 ring-<teinte>-400/80`,
texte de la teinte) suffixé « auto » ou « réf. » ; le choix du compte garde l'aplat. Dans le détail de
carte, l'origine est une puce : « vous » neutre (`bg-ink-800`), « réf. » ciel, « auto » ambre.

Toute incrustation sur image porte un fond noir semi-opaque ou un `ring-1 ring-black/50` :
c'est ce qui garantit la lisibilité quelle que soit l'image dessous.
Ce qui n'est pas concerné est estompé par `opacity-45` — **jamais** par un floutage
ou une désaturation.

### 7.16 Tableau
`border-separate border-spacing-0.5` (les cellules sont des pastilles séparées, pas
une grille), texte 10 px, en-têtes en capitales `ink-500`, valeurs tabulaires alignées
à droite en `ink-100`, lignes séparées par `border-b border-ink-800`.
Toujours enveloppé dans un `overflow-x-auto`.

---

## 8. États d'interaction

| État | Traitement |
|---|---|
| Survol (fantôme) | fond `ink-800` **et** texte remonté d'un cran vers `ink-100` |
| Survol (surface) | fond `ink-850`, ou bordure qui passe à `emerald-500/60` si l'élément est cliquable-vers-l'avant |
| Actif / sélectionné | fond `ink-700` (neutre) ou contenant d'état teinté (formule A) |
| Désactivé | `opacity-40` (ou 30) **+ `cursor-default`** — parfois remplacé par un vrai style éteint `bg-ink-800 text-fg-3` pour le bouton primaire |
| Focus | `outline-none` puis `focus:border-ink-500` ou `focus:border-emerald-500/60` |
| Mise en évidence transitoire | `outline outline-2 outline-offset-1 outline-amber-300`, effacé automatiquement après ~2,2 s |
| Erreur de saisie | `border-red-500/40 bg-red-500/5` sur le conteneur du champ |

> **Réserve honnête à corriger en reprenant le système :** le focus clavier est
> systématiquement neutralisé (`outline-none`) et remplacé par un simple changement de
> bordure, insuffisant en accessibilité. Un projet qui reprend cette charte devrait
> définir un `:focus-visible` explicite — par exemple `outline: 2px solid #34d399;
> outline-offset: 2px` — sans rien changer d'autre au style.

---

## 9. Visualisation de données

C'est là que se concentrent les décisions les plus spécifiques, et les plus réutilisables.

### 9.1 Barre horizontale

```
piste       : hauteur 8 px, fond ink-800, rayon 2 px
remplissage : rayon 2 px, origin-left, transition width 300 ms ease-out
```

Deux couleurs de série, fixes et jamais interverties :
`#4fae7a` (vert — série principale) et `#5b8def` (bleu — série secondaire).
Ce sont des verts/bleus **désaturés** : sur fond noir, une couleur saturée « brûle ».

### 9.2 Palette catégorielle générative

Les couleurs de groupe ne sont **ni codées en dur, ni stockées** : elles sont dérivées
d'un index à l'affichage, par angle d'or dans un espace perceptuel. À reprendre tel quel :

```js
const GOLDEN_ANGLE = 137.508;
const hue = (index) => (index * GOLDEN_ANGLE + 20) % 360;

const color = (i) => `oklch(0.72 0.15 ${hue(i)})`;                   // pastille pleine
const veil  = (i, a = 0.42) => `oklch(0.68 0.16 ${hue(i)} / ${a})`;  // voile sur image
```

L'intérêt : **luminosité et chroma constants**, seule la teinte varie. Toutes les
catégories ont donc exactement le même poids visuel, quel qu'en soit le nombre, et
restent lisibles en surimpression. L'angle d'or maximise l'écart entre teintes voisines.

### 9.3 Carte de chaleur séquentielle

Une seule teinte, **encodée en opacité** par-dessus le fond sombre — pas un dégradé
entre deux couleurs :

```js
background = `oklch(0.7 0.13 155 / ${(valeur / max) * 0.85})`;
```

Plafond d'alpha à 0.85 pour que la cellule la plus forte ne devienne jamais un aplat
opaque. Les valeurs négligeables affichent `·` plutôt que `0.0` — le silence est un
signal, et cela vide le tableau de son bruit.

### 9.4 Carte de chaleur divergente

Centrée sur zéro, deux teintes en miroir, alpha proportionnel à l'écart avec un
plafond explicite :

```js
const alpha = Math.min(Math.abs(d) / 0.02, 1) * 0.85;
d > 0 ? `oklch(0.7  0.13 155 / ${alpha})`   // vert
      : `oklch(0.58 0.17 25  / ${alpha})`;  // rouge
```

### 9.5 Badge de note continue

Teinte interpolée du rouge au vert sur 140° de teinte, luminosité et chroma constants,
**texte noir** sur la pastille :

```js
const hue = (note / 10) * 140;
background = `oklch(0.78 0.15 ${hue})`;
```

### 9.6 Trois règles d'honnêteté graphique

Ce sont des règles de fond, pas de style, et elles font partie du design :

1. **Deux jeux comparés partagent la même échelle de couleur.** Deux maxima
   indépendants rendraient la comparaison visuelle mensongère.
2. **Un delta est coloré selon le mérite, pas selon le signe.** Un indicateur pour
   lequel « plus bas est mieux » se colore en vert quand il baisse.
3. **Toute carte de chaleur divergente porte une légende obligatoire** rappelant que
   la couleur ne vaut pas jugement.

Et un principe de coût : les couleurs dérivées sont recalculées à l'affichage,
jamais persistées.

---

## 10. Mouvement

| Élément | Animation |
|---|---|
| Boutons, onglets, puces | `transition-colors` (~150 ms) |
| Remplissage de barre | `transition-[width] 300ms ease-out` |
| Apparition de barre | `@keyframes barGrow { from { transform: scaleX(0) } to { transform: scaleX(1) } }` |
| Opacité de tuile estompée | `transition-opacity` |
| Navigation vers un élément | `scrollIntoView({ block: 'center', behavior: 'smooth' })` |

Durées de vie non animées mais structurantes : toast **6 s**, mise en évidence
après navigation **2,2 s**.

Il n'y a **aucune** animation d'entrée de page, de modale ou de liste. L'interface
apparaît, elle ne se déplie pas.

---

## 11. À faire / à ne pas faire

**À faire**
- Utiliser des gris **froids**, jamais des gris purs ni chauds.
- Descendre la taille de texte de référence à 12 px et assumer la densité.
- Mettre toutes les valeurs numériques en tabulaire et alignées à droite.
- Séparer par une bordure 1 px `ink-800` avant d'envisager quoi que ce soit d'autre.
- Réserver l'ombre aux seuls éléments réellement flottants, et la faire franchement noire.
- Faire du survol un double signal (fond + éclaircissement du texte).
- Écrire l'avertissement dans l'écran, en toutes lettres, à l'endroit concerné.
- Dériver les couleurs de série par formule plutôt que de les lister à la main.

**À ne pas faire**
- Un fond gris moyen (`#1a1a1a` et au-dessus) : la profondeur disparaît.
- Des ombres portées sur les cartes à plat.
- Du blanc pur (`#fff`) en texte : le plus clair de l'échelle est `#e8eaf0`.
- Un dégradé, une lueur, un verre dépoli, une bordure de plus de 1 px.
- Une couleur sans signification attribuée, ou une cinquième teinte d'accent.
- Un aplat saturé pour signaler un état (les états sont translucides).
- Du texte blanc sur le bouton primaire émeraude — il est **noir**.
- Faire porter une information par `ink-500` ou `ink-600`.

---

## 12. Tokens prêts à copier

La source de vérité est `web/src/index.css` (valeurs) et `web/tailwind.config.js` (classes).

### 12.1 CSS pur (projet sans Tailwind)

```css
:root {
  color-scheme: dark;

  /* Surfaces et bordures */
  --ink-950: #111318;  --ink-900: #181b22;  --ink-850: #1f232c;
  --ink-800: #262b36;  --ink-700: #323846;  --ink-600: #3d4452;
  --ink-500: #667085;

  /* Texte — quatre rôles, tous >= 4,5:1 là où ils sont autorisés */
  --fg-1: #f3f4f8;   /* valeurs, titres */
  --fg-2: #c9cfdb;   /* corps */
  --fg-3: #9aa3b6;   /* libellés, en-têtes de tableau */
  --fg-4: #7f8899;   /* méta : page et surface seulement */

  /* Accents en texte */
  --pos: #5ee3a9;  --warn: #f6c453;  --info: #6cc7f5;  --neg: #ff8a8a;

  /* Accents en aplat (palette Tailwind) */
  --positive: #059669;  --positive-hover: #10b981;  --caution: #f59e0b;

  /* Séries de données (lib/colors.ts) */
  --series-1: #4fae7a;
  --series-2: #5b8def;

  /* Rayons */
  --r-xs: 2px; --r-sm: 4px; --r-md: 6px; --r-lg: 8px; --r-xl: 12px;

  /* Élévation */
  --shadow-float: 0 25px 50px -12px rgb(0 0 0 / .5);
  --scrim:        rgb(0 0 0 / .7);

  /* Typo : échelle fermée */
  --font-ui:   system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --text-cell:  10px;  /* dérogation : matrices compactes sous 640 px */
  --text-meta:  11px;  /* plancher */
  --text-body:  13px;  /* corps */
  --text-value: 14px;
  --text-head:  16px;
  --text-title: 18px;
  --text-hero:  20px;
  --text-glyph: 24px;
}

html, body, #root { height: 100%; }

body {
  margin: 0;
  background: var(--ink-950);
  color: var(--fg-2);
  font-family: var(--font-ui);
  font-size: var(--text-body);
  -webkit-font-smoothing: antialiased;
}

/* Le détail le plus rentable du système */
.tnum { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }

* { scrollbar-width: thin; scrollbar-color: var(--ink-600) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb { background: var(--ink-600); border-radius: var(--r-md); }

@keyframes barGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }

/* Ajout recommandé, toujours absent du code (cf. §8) */
:focus-visible { outline: 2px solid var(--pos); outline-offset: 2px; }
```

### 12.2 Configuration Tailwind (projet Tailwind)

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Échelle FERMÉE : hors `extend`, les tailles d'origine disparaissent.
    fontSize: {
      cell: ['10px', '1.2'], meta: ['11px', '1.35'], body: ['13px', '1.45'],
      value: ['14px', '1.4'], head: ['16px', '1.35'], title: ['18px', '1.3'],
      hero: ['20px', '1.2'], glyph: ['24px', '1'],
    },
    extend: {
      colors: {
        ink: {
          950: 'var(--ink-950)', 900: 'var(--ink-900)', 850: 'var(--ink-850)',
          800: 'var(--ink-800)', 700: 'var(--ink-700)', 600: 'var(--ink-600)',
          500: 'var(--ink-500)',
        },
        fg: { 1: 'var(--fg-1)', 2: 'var(--fg-2)', 3: 'var(--fg-3)', 4: 'var(--fg-4)' },
        pos: 'var(--pos)', warn: 'var(--warn)', info: 'var(--info)', neg: 'var(--neg)',
      },
    },
  },
  plugins: [],
};
```

Les aplats et contenants d'état (`bg-emerald-600`, `bg-amber-500/10`…) restent la palette
Tailwind par défaut ; en **texte**, seuls `text-pos`, `text-warn`, `text-info` et `text-neg`
sont employés. Le document racine porte `<html lang="fr" class="dark">`,
`<meta name="theme-color" content="#111318">` et `:root { color-scheme: dark }`.

---

## 13. Liste de contrôle de reprise

À vérifier sur un premier écran du projet cible pour savoir s'il est « de la même famille » :

- [ ] Le fond de page est-il autour de `#111318` ? Les gris sont-ils froids ?
- [ ] L'en-tête est-il **plus sombre** que le contenu ?
- [ ] Y a-t-il des ombres sur des éléments non flottants ? (il ne devrait pas)
- [ ] Le corps de l'interface est-il à 13 px, et aucun texte sous 11 px ?
- [ ] Les titres de section sont-ils en 11 px capitales espacées, en `fg-3` lisible ?
- [ ] Les nombres sont-ils tabulaires, à droite, en `fg-1` ?
- [ ] Y a-t-il exactement un bouton émeraude à texte noir par écran ?
- [ ] Chaque couleur présente à l'écran a-t-elle une signification déclarée ?
- [ ] Les états teintés sont-ils translucides plutôt qu'en aplat ?
- [ ] Les avertissements sont-ils des bandeaux dans le flux, avec une phrase complète ?
- [ ] Les bordures sont-elles toutes à 1 px ?
- [ ] Le pointillé est-il réservé aux emplacements et conditions ?
