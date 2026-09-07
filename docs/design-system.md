# Charte de design — interface « YGO · probabilités & mains »

> **But de ce document.** Décrire, de façon autonome et vérifiable, le système visuel
> de cette application pour qu'un **autre projet** puisse le reprendre et produire une
> interface cohérente avec celle-ci, sans avoir accès à ce dépôt.
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
   variante claire n'existe. Le fond est très profond (`#0a0b0e`, quasi-noir), pas un
   gris moyen : c'est ce qui laisse « respirer » les images et fait ressortir les chiffres.
2. **Le chrome est chromatiquement neutre.** Toute l'ossature — fonds, bordures, textes,
   boutons secondaires — vit sur une seule échelle de gris froids. **La couleur est un
   signal, jamais une décoration.** Une teinte qui apparaît veut dire quelque chose.
3. **La séparation se fait par bordures 1 px et paliers de fond, pas par ombres.**
   Les surfaces posées à plat n'ont aucune ombre. Seuls les éléments *flottants*
   (popover, dialogue, toast) en portent une, et volontairement lourde.
4. **Les chiffres sont le produit.** Toute valeur numérique est en chiffres tabulaires
   (`font-variant-numeric: tabular-nums`), alignée à droite, et affichée dans la couleur
   de texte la plus claire de l'échelle. Le libellé, lui, est discret.
5. **Densité assumée.** La taille de texte de référence de l'interface est **12 px**,
   pas 14 ni 16. Les paddings sont de l'ordre de 4–10 px. On privilégie de voir
   beaucoup d'un coup plutôt que de l'air.
6. **Hiérarchie par la valeur de gris, pas par la graisse.** Six niveaux de texte
   du plus clair au plus effacé font tout le travail. `font-semibold` est réservé aux
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

### 2.1 L'échelle neutre `ink` — la colonne vertébrale

Onze paliers de **gris froids** (légèrement bleutés, ~230° de teinte : jamais du gris
pur, jamais du chaud). C'est la particularité principale de la palette.

| Token | Hex | Rôle canonique |
|---|---|---|
| `ink-950` | `#0a0b0e` | Fond de l'application, fond de l'en-tête, fond des `<kbd>` |
| `ink-900` | `#0f1116` | Surface de contenu : cartes, panneaux, lignes de liste, dialogues |
| `ink-850` | `#151822` | Contrôles en creux (champs, `select`, steppers) et surfaces flottantes |
| `ink-800` | `#1b1f2a` | **Bordure de séparation par défaut** · fond de puce · fond de survol · piste de barre |
| `ink-700` | `#252a37` | **Bordure des surfaces flottantes et des champs** · fond d'onglet actif · bouton secondaire |
| `ink-600` | `#333a4a` | Bouton segmenté actif · pouce d'ascenseur · bordure en pointillés |
| `ink-500` | `#4a5265` | Texte méta / inactif · icônes discrètes (décoratif) |
| `ink-400` | `#6b7488` | Libellés secondaires, texte atténué |
| `ink-300` | `#9aa2b5` | Texte secondaire lisible, corps des menus |
| `ink-200` | `#c7ccd8` | **Couleur de texte par défaut du `<body>`** |
| `ink-100` | `#e8eaf0` | Texte principal, titres, **valeurs numériques** |

Contrastes mesurés sur `ink-950` (approximatifs) : `ink-100` ≈ 15:1 · `ink-200` ≈ 12:1 ·
`ink-300` ≈ 7,7:1 · `ink-400` ≈ 4,1:1 · `ink-500` ≈ 2,5:1.
**Conséquence à respecter :** `ink-500` et `ink-600` sont *décoratifs* — horodatages,
séparateurs, texte désactivé. Ne jamais y mettre une information dont la lecture est
nécessaire.

### 2.2 L'escalier des surfaces

L'empilement est strict et se lit du plus sombre (le plus loin) au plus clair (le plus près) :

```
ink-950   fond de page + en-tête           ← le plus sombre : la page « recule »
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
texte   : <teinte>-200 ou -300                  (text-emerald-200)
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

/* Monospace : réservée aux saisies de données brutes (listes d'identifiants) */
font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
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

L'échelle est **basse et resserrée**. Fréquence réelle dans le code : 12 px (70×),
11 px (53×), 10 px (41×), 14 px (34×) — puis presque rien.

| Taille | Graisse | Emploi |
|---|---|---|
| 24 px | — | Le `+` de la tuile d'ajout. Unique. |
| 20 px | semibold | Le résultat de probabilité mis en avant. Unique. |
| 18 px | bold | Logotype de la page de connexion. |
| 16 px | semibold | Titre de dialogue. Rien d'autre. |
| **14 px** | semibold / normal | Titres de panneau, noms d'objets, valeurs de statistiques |
| **12 px** | medium / normal | **Taille de référence** : boutons, onglets, corps dense, lignes de liste |
| **11 px** | normal | Libellés secondaires, aides, méta dense |
| **10 px** | medium | Étiquettes de section en capitales, puces, horodatages |
| 9 px | bold | Micro-badges sur les vignettes (`†1st`, touches clavier) |

### 3.4 La formule d'étiquette de section

Un seul motif pour tous les titres de section, sur-titres et en-têtes de tableau :

```
10–11 px · MAJUSCULES · letter-spacing: 0.025em · couleur ink-500 (ou ink-400)
```

C'est le marqueur typographique le plus identifiable de l'interface. Aucun titre de
section n'est en gros et en gras : la hiérarchie vient du contraste faible + capitales,
pas de la taille.

### 3.5 Paire libellé / valeur

Motif récurrent (fiches de deck, récapitulatifs de mains) : **valeur au-dessus,
libellé en dessous**, jamais l'inverse.

```
valeur   14 px  semibold  tabulaire  coloré (émeraude / rouge / ink-200)
libellé   9 px  MAJUSCULES  tracking-wide  ink-600
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
h-screen · flex-col
├── <header>  shrink-0        ink-950, bordure basse ink-800, px 16 py 8
├── [bandeau d'alerte]        conditionnel, teinté, dans le flux
└── <div>     flex-1 min-h-0  ← la seule zone en overflow-y-auto
     ├── <main>  flex-1 min-w-0, bordure droite ink-800
     │    ├── <nav>  barre d'onglets, shrink-0, fond ink-900
     │    └── contenu
     └── <aside>  largeur fixe 500 px, masqué sous 1024 px
```

Le couple **`min-h-0` + `flex-1`** est indispensable : c'est lui qui garde l'en-tête
et les barres d'outils toujours visibles et confine le défilement à une seule colonne.

### 6.2 En-tête

Une seule ligne, `flex-wrap`, gouttières 12 px horizontales / 6 px verticales.
Ordre invariable : **retour → séparateur → identité éditable → état → `ml-auto` →
contrôles → action primaire → compte**.
`margin-left: auto` sur le groupe de droite est le mécanisme d'alignement unique ;
aucune grille n'est utilisée dans les barres.

### 6.3 Responsive

Un seul point de rupture significatif : **1024 px**.
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
(`h-8 w-8` ou `py-2` sur `text-xs`) pour le stepper de copies, le menu ⋯ d'une tuile ou
d'un deck, les actions primaires (Enregistrer, Nouveau deck, Importer, Terminer, ✕ d'un
dialogue) ; **24 px minimum** partout ailleurs (onglets, boutons de mode, sélecteur de
contexte, lignes d'inventaire, entrées de menu). Le minimum de 96 px par tuile vient de
là : un stepper de trois cibles de 32 px sur sa propre ligne, puis le delta insécable et le
menu ⋯ côte à côte.

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
`bg-emerald-600 text-black text-xs font-medium px-3 py-1.5 rounded hover:bg-emerald-500`
— désactivé : `bg-ink-800 text-ink-500 cursor-default` (pas seulement une opacité).

### 7.2 Bouton secondaire
`border border-ink-700 text-ink-200 px-3 py-1.5 rounded text-xs hover:bg-ink-800`
— désactivé : `disabled:opacity-40`.

### 7.3 Bouton fantôme (le plus courant)
`text-ink-400 px-2 py-1 rounded text-xs hover:bg-ink-800 hover:text-ink-100`
Le survol agit **sur deux propriétés à la fois** : le fond apparaît *et* le texte
s'éclaircit d'un cran. C'est systématique.

### 7.4 Champ de saisie
`bg-ink-850 border border-ink-700 rounded px-2 py-1.5 text-sm text-ink-100
outline-none placeholder:text-ink-600 focus:border-ink-500`
Variante « éditable en place » (nom de deck, nom de carte) : **aucun cadre au repos**,
`bg-transparent`, un fond apparaît au survol et au focus (`hover:bg-ink-900
focus:bg-ink-900`). Le champ ne se déclare comme champ qu'à l'approche.

### 7.5 Contrôle segmenté
Conteneur `inline-flex rounded-md border border-ink-700 bg-ink-850 overflow-hidden`,
segments sans bordure interne. Actif `bg-ink-600 text-ink-100`, inactif
`text-ink-400 hover:bg-ink-800 hover:text-ink-200`. Deux tailles : 11 px / 8×2 px et
12 px / 10×4 px.

### 7.6 Stepper numérique
`flex items-center rounded border border-ink-700 bg-ink-850`, `−` et `+` en
`text-ink-300 hover:text-ink-100 disabled:opacity-30`, valeur au centre en tabulaire
sur une largeur fixe pour que rien ne bouge.

### 7.7 Puce / badge
`rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400` — variante d'alerte :
`bg-amber-500/15 text-amber-300`.

### 7.8 Onglet
Actif `bg-ink-700 text-ink-100`, inactif `text-ink-400 hover:bg-ink-800 hover:text-ink-200`,
`rounded px-3 py-1 text-xs font-medium`. Barre d'onglets sur `bg-ink-900`, bordure basse
`ink-800`, `overflow-x-auto` pour ne jamais casser sur mobile. **Pas de soulignement**
d'onglet actif : c'est un remplissage.

### 7.9 Dialogue
Voile `fixed inset-0 z-50 bg-black/70 p-4` fermant au clic ; panneau
`rounded-xl border border-ink-700 bg-ink-900 p-5 shadow-2xl`, `max-w-md`/`max-w-lg`,
`max-h-[80vh]` avec défilement interne, et `stopPropagation` sur le panneau.
En-tête de dialogue : titre 16 px semibold `ink-100` + `✕` en `text-ink-500 hover:text-ink-200`.

### 7.10 Menu déroulant / popover
`rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-2xl shadow-black/50`,
largeur minimale 170–200 px. Éléments : `rounded px-2 py-1.5 text-xs text-ink-200`,
survol `bg-ink-700`. Élément destructif en `text-red-300`.
Toujours rendu dans un *portal* avec évitement de collision (`collisionPadding: 8`).

### 7.11 Case à cocher
Un simple carré de 14 px : `h-3.5 w-3.5 rounded-sm border`, non coché
`border-ink-500`, coché **aplat plein de la teinte** `border-emerald-400 bg-emerald-400`
(ou ambre selon le sens). Pas de coche dessinée — le remplissage suffit.

### 7.12 Bandeau d'alerte
`border-b px-3 py-1.5 text-xs` avec la formule d'accent A. Trois sévérités :

```
erreur        border-red-500/40    bg-red-500/10    text-red-300
avertissement border-amber-500/30  bg-amber-500/10  text-amber-300
information   border-sky-500/20    bg-sky-500/5     text-sky-300/90
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
| Désactivé | `opacity-40` (ou 30) **+ `cursor-default`** — parfois remplacé par un vrai style éteint `bg-ink-800 text-ink-500` pour le bouton primaire |
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

### 12.1 CSS pur (projet sans Tailwind)

```css
:root {
  color-scheme: dark;

  /* Neutres froids */
  --ink-950: #0a0b0e;  --ink-900: #0f1116;  --ink-850: #151822;
  --ink-800: #1b1f2a;  --ink-700: #252a37;  --ink-600: #333a4a;
  --ink-500: #4a5265;  --ink-400: #6b7488;  --ink-300: #9aa2b5;
  --ink-200: #c7ccd8;  --ink-100: #e8eaf0;

  /* Rôles de surface */
  --surface-page:    var(--ink-950);
  --surface-raised:  var(--ink-900);
  --surface-sunken:  var(--ink-850);
  --surface-chip:    var(--ink-800);
  --surface-active:  var(--ink-700);
  --border-flat:     var(--ink-800);
  --border-floating: var(--ink-700);

  /* Rôles de texte */
  --text-primary:   var(--ink-100);
  --text-body:      var(--ink-200);
  --text-secondary: var(--ink-300);
  --text-muted:     var(--ink-400);
  --text-faint:     var(--ink-500);   /* décoratif : jamais d'information */

  /* Accents */
  --positive:    #059669;  --positive-hover: #10b981;
  --positive-fg: #6ee7b7;  --positive-fill:  #34d399;
  --caution:     #f59e0b;  --caution-fg:     #fcd34d;
  --info:        #0ea5e9;  --info-fg:        #7dd3fc;
  --danger:      #ef4444;  --danger-fg:      #f87171;

  /* Séries de données */
  --series-1: #4fae7a;
  --series-2: #5b8def;

  /* Rayons */
  --r-xs: 2px; --r-sm: 4px; --r-md: 6px; --r-lg: 8px; --r-xl: 12px;

  /* Élévation */
  --shadow-float: 0 25px 50px -12px rgb(0 0 0 / .5);
  --scrim:        rgb(0 0 0 / .7);

  /* Typo */
  --font-ui:  system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-num: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}

html, body, #root { height: 100%; }

body {
  margin: 0;
  background: var(--surface-page);
  color: var(--text-body);
  font-family: var(--font-ui);
  font-size: 12px;
  -webkit-font-smoothing: antialiased;
}

/* Le détail le plus rentable du système */
.tnum { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }

* { scrollbar-width: thin; scrollbar-color: var(--ink-600) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb { background: var(--ink-600); border-radius: var(--r-md); }

@keyframes barGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }

/* Ajout recommandé, absent de l'original (cf. §8) */
:focus-visible { outline: 2px solid var(--positive-fill); outline-offset: 2px; }
```

### 12.2 Configuration Tailwind (projet Tailwind)

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0b0e', 900: '#0f1116', 850: '#151822', 800: '#1b1f2a',
          700: '#252a37', 600: '#333a4a', 500: '#4a5265', 400: '#6b7488',
          300: '#9aa2b5', 200: '#c7ccd8', 100: '#e8eaf0',
        },
      },
      fontFamily: {
        num: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
```

Les accents (`emerald`, `amber`, `sky`, `red`) sont ceux de la palette Tailwind par
défaut : ne rien redéfinir, se contenter de respecter l'affectation sémantique de la §2.3.
Le document racine porte `<html class="dark">` et `:root { color-scheme: dark }` ;
aucune variante claire n'est prévue.

---

## 13. Liste de contrôle de reprise

À vérifier sur un premier écran du projet cible pour savoir s'il est « de la même famille » :

- [ ] Le fond de page est-il sous `#101014` ? Les gris sont-ils froids ?
- [ ] L'en-tête est-il **plus sombre** que le contenu ?
- [ ] Y a-t-il des ombres sur des éléments non flottants ? (il ne devrait pas)
- [ ] Le corps de l'interface est-il à 12 px ?
- [ ] Les titres de section sont-ils en 10 px capitales espacées et gris moyen ?
- [ ] Les nombres sont-ils tabulaires, à droite, en `ink-100` ?
- [ ] Y a-t-il exactement un bouton émeraude à texte noir par écran ?
- [ ] Chaque couleur présente à l'écran a-t-elle une signification déclarée ?
- [ ] Les états teintés sont-ils translucides plutôt qu'en aplat ?
- [ ] Les avertissements sont-ils des bandeaux dans le flux, avec une phrase complète ?
- [ ] Les bordures sont-elles toutes à 1 px ?
- [ ] Le pointillé est-il réservé aux emplacements et conditions ?
