# Charte du back-office — « corpo, factuel »

Charte propre au site d'administration (`admin/`, docs/backoffice.md, décision 10). Elle suit la
**méthode** de docs/design-system.md (tokens en variables CSS, échelle typographique fermée, une
signification par couleur, règles d'honnêteté) mais pas son apparence : le back-office ne doit
jamais pouvoir être confondu avec l'app de jeu. Ce qui les sépare, à tout instant :

| | App de jeu (design-system.md) | Back-office |
|---|---|---|
| Thème | sombre seul, `ink` froid | **clair par défaut (système)**, sombre disponible, bascule |
| Accent | émeraude, texte noir | **un bleu corporatif** (`--accent`), texte blanc |
| Forme | rayons 4–12 px, élévation, tuiles | **angles à 2 px, aucune ombre, aucune tuile** : tableaux bordés |
| Repère permanent | aucun | **bandeau d'environnement** en haut de chaque page (PRODUCTION ou DEV) |
| Typographie | 12 px, titres capitales espacées | **13 px**, titres en bas de casse, poids 600, chiffres tabulaires partout |
| Illustrations | cartes, vignettes | **aucune** (ni icône, ni emoji, ni image de carte) |

Aucune ressource externe : polices système, pas de CDN, pas de script tiers ; CSP stricte sans
inline (docs/backoffice.md T10), donc tout le style est dans `wwwroot/css/` et la bascule de thème
dans `wwwroot/js/theme.js`.

## 1. Intention en huit règles

1. **Factuel** : un écran = des chiffres, des identifiants, des dates ; aucun ornement, aucun
   adjectif dans l'interface. Ce que la base ne sait pas s'affiche « — », jamais une estimation.
2. **Dense** : 13 px, lignes de tableau de 32 px, marges de 8 / 16 px ; un tableau de 50 comptes
   tient sur un écran de 1440 × 900.
3. **Une couleur d'accent**, réservée à l'action primaire et au lien actif ; tout le reste est
   neutre.
4. **États en triplet teinté** (fond / bordure / texte) : `ok`, `warn`, `neg`, `info`. Le sens ne
   repose jamais sur la couleur seule : un mot l'accompagne toujours (« admin », « expirée »,
   « échec »).
5. **Bordures partout, ombres nulle part** : tableaux bordés à 1 px, cadres à 1 px, aucun relief.
6. **Chiffres tabulaires à droite**, dates en ISO (`2026-09-16 14:37 UTC`), identifiants en
   monospace tronqués avec le complet en infobulle (`title`).
7. **Deux thèmes, mêmes tokens** : chaque rôle a une valeur claire et une valeur sombre ; aucun
   composant ne connaît une couleur en dur.
8. **Le bandeau d'environnement est permanent** et non masquable ; PRODUCTION est en `neg`, DEV en
   neutre.

## 2. Tokens (`wwwroot/css/tokens.css`)

Échelle typographique **fermée** (aucune autre taille n'existe) :

| Token | Taille | Usage |
|---|---|---|
| `--fs-meta` | 12 px | méta, en-têtes de colonnes, bandeau |
| `--fs-body` | 13 px | corps, cellules, formulaires |
| `--fs-value` | 14 px | valeurs mises en avant (chiffres de fiche) |
| `--fs-head` | 16 px | titre de section |
| `--fs-title` | 20 px | titre de page |
| `--fs-kpi` | 28 px | chiffre d'un indicateur du tableau de bord |

Rôles de couleur (clair ; sombre entre parenthèses) :

| Token | Clair | Sombre | Rôle |
|---|---|---|---|
| `--bg-page` | `#f3f4f6` | `#15181d` | fond de page |
| `--bg-surface` | `#ffffff` | `#1c2027` | tableaux, cadres, formulaires |
| `--bg-sunken` | `#e9ebef` | `#111419` | en-têtes de tableau, bandeau d'en-tête |
| `--bg-hover` | `#eef2f8` | `#232934` | survol d'une ligne |
| `--border` | `#d3d7de` | `#2c333e` | toute bordure courante |
| `--border-strong` | `#aeb5c0` | `#414a58` | bordure de champ actif, séparateur de section |
| `--text-1` | `#14171c` | `#e9ecf1` | texte principal, valeurs |
| `--text-2` | `#3f4652` | `#b6bdc9` | corps |
| `--text-3` | `#6b7381` | `#8790a0` | méta, libellés |
| `--accent` | `#1f4e9c` | `#6c9ee8` | action primaire, lien actif |
| `--accent-hover` | `#183f80` | `#88b1ee` | survol |
| `--accent-fg` | `#ffffff` | `#0e1420` | texte sur accent |
| `--focus` | `#1f4e9c` | `#88b1ee` | anneau de focus (2 px, décalé de 2 px) |
| `--ok-bg / --ok-bd / --ok-fg` | `#e6f4ea / #8ccf9c / #14532d` | `rgb(52 211 153 / .12) / #2f8a5f / #8fe0b5` | état positif (admin, session active) |
| `--warn-bg / --warn-bd / --warn-fg` | `#fff4dc / #efc36c / #7a4b00` | `rgb(245 158 11 / .12) / #a26f0e / #f5cc7a` | avertissement (enrôlement en attente) |
| `--neg-bg / --neg-bd / --neg-fg` | `#fbe7e7 / #e69b9b / #7f1d1d` | `rgb(239 68 68 / .12) / #a33a3a / #f3a3a3` | négatif (échec, PRODUCTION) |
| `--info-bg / --info-bd / --info-fg` | `#e8f0fb / #9dbbe8 / #1e3a8a` | `rgb(96 165 250 / .12) / #3b6fb8 / #a9c7f5` | information neutre (DEV, note) |

Autres : `--font-ui: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` ;
`--font-mono: ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace` ; `--r: 2px` (unique
rayon) ; `--sp-1: 4px`, `--sp-2: 8px`, `--sp-3: 12px`, `--sp-4: 16px`, `--sp-6: 24px` ;
`--row: 32px` (hauteur de ligne de tableau et de contrôle) ; `--ctl: 32px` (cible minimale d'un
contrôle, mobile compris).

Mécanique du thème : `:root` porte les valeurs claires ; `@media (prefers-color-scheme: dark)`
les redéfinit sous `:root:not([data-theme="light"])` ; `:root[data-theme="dark"]` les redéfinit
aussi. `theme.js` lit `localStorage.th_theme` (`light` | `dark` | absent = système), pose
`data-theme` avant le premier rendu, et le bouton « Thème » fait tourner système → clair → sombre.
`color-scheme` suit le thème (champs natifs, ascenseurs).

## 3. Structure de page

```
┌──────────────────────────────────────────────────────────┐
│ ▮ PRODUCTION · admin.scratchrecode.com          (bandeau) │  24 px, neg (PROD) / info (DEV)
├──────────────────────────────────────────────────────────┤
│ Testhand · Back-office   Tableau de bord  Comptes  Journal│  en-tête, bg-sunken, 44 px
│                             celian@… · Thème · Déconnexion │
├──────────────────────────────────────────────────────────┤
│ Titre de page (20 px)                    sous-titre méta  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                    │  indicateurs : cadres bordés
│ │ Comptes  │ │ 7 jours  │ │ Decks    │                    │
│ │ 128      │ │ 4        │ │ 311      │                    │
│ └──────────┘ └──────────┘ └──────────┘                    │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ table bordée, en-tête sunken, chiffres à droite      │ │
│ └──────────────────────────────────────────────────────┘ │
│ pied : « aucune donnée de deck n'est lue ici », 8 h        │
└──────────────────────────────────────────────────────────┘
```

- Largeur de contenu 1200 px au plus, gouttière 16 px (8 px sous 480 px).
- Sous 720 px : la navigation passe à la ligne ; les tableaux gardent leurs colonnes et défilent
  horizontalement dans un cadre (`.table-wrap { overflow-x: auto }`), jamais de colonnes cachées
  en silence ; les indicateurs passent en colonne unique. Vérifié à 360 et 1440 px.
- Aucun dialogue, aucun menu flottant : tout est dans le flux (pages et formulaires).

## 4. Composants

- **Tableau** (`table.grid`) : bordure extérieure et intérieure 1 px `--border`, en-tête
  `--bg-sunken` en `--fs-meta` poids 600, cellules `--fs-body`, lignes `--row`, survol
  `--bg-hover`, colonnes numériques `.num` (tabular, à droite), identifiants `.mono` (tronqués,
  complet en `title`). Tri : lien dans l'en-tête, colonne active soulignée par `--accent`
  avec « ↑ » / « ↓ » en texte, jamais en couleur seule.
- **Indicateur** (`.kpi`) : cadre bordé, libellé `--fs-meta` `--text-3`, valeur `--fs-kpi`
  tabulaire `--text-1`, note `--fs-meta` (« sessions non expirées à cet instant »).
- **Étiquette d'état** (`.tag.ok|warn|neg|info`) : triplet, 20 px de haut, texte `--fs-meta`,
  toujours un mot.
- **Bouton primaire** (`.btn.primary`) : `--accent` / `--accent-fg`, 32 px, un seul par page.
  **Bouton secondaire** (`.btn`) : surface bordée `--border-strong`. **Lien** : `--accent`
  souligné au survol.
- **Champ** (`.field`) : libellé au-dessus `--fs-meta` `--text-3`, contrôle 32 px bordé, focus
  anneau `--focus` ; erreur = bandeau `neg` au-dessus du formulaire avec une phrase complète,
  jamais un champ rouge seul.
- **Bandeau** (`.banner.neg|warn|info|ok`) : dans le flux, pleine largeur, une phrase.
- **Pagination** : « ← Précédent · page 3 / 12 · Suivant → », liens, taille de page 50.
- **QR d'enrôlement** : SVG inline dans un cadre bordé de 200 px, secret en base32 monospace
  à côté, groupé par 4.

## 5. Ce qui est interdit

Couleur ou taille de texte en dur dans une page (les dimensions de mise en page — hauteur du bandeau, de l'en-tête, largeur de contenu, du QR — vivent dans `site.css`, jamais dans une page) ; `text-decoration` de couleur seule pour signifier ;
icônes, emoji, illustrations ; ombres, dégradés, animations (seule transition : aucune) ; ressource
externe ; script ou style inline ; troisième taille de police hors échelle ; « dernière activité »
ou tout libellé que la base ne sait pas tenir (voir docs/backoffice.md Q2).
