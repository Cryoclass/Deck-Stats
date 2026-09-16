# Refonte visuelle — application du verdict de l'audit 01

Date : 16 septembre 2026. Branche `wip/audit-materiaux`. Source : `docs/audit/01-visuel.md`, §0
(verdict) et §8 (direction A, « sombre relevé »), plus une demande directe : *la présentation des
decks est bonne, la navigation de l'éditeur ne l'est pas*. Plan validé avant le code (décisions D1
à D4 ci-dessous). Preuves : `docs/refonte-visuelle/` (mesures agrégées, hauteurs de chrome,
captures, scripts rejoués).

**Périmètre purement visuel.** Aucune règle métier, aucun calcul, aucune route, aucun schéma. Le
moteur (`web/src/engine/`), `lib/engineModel.ts`, `lib/conditions.ts` et `lib/summary.ts` sont
intacts : `__ENGINE_VERSION__` ne change pas, aucun aperçu d'accueil n'est invalidé. Aucune commande
vers le VPS, Supabase ou la base de dev ; conteneurs jetables seulement, supprimés en fin de tâche.

## 1. Résultat en chiffres

Même script de mesure que l'audit (`SCAN` de `audit-visuel.mjs`), même pile jetable, mêmes 41 cartes
réelles, mêmes gestes, mêmes largeurs. La comparaison relit le `mesures.json` d'origine de l'audit
et reproduit exactement ses chiffres « avant » par page (43/78, 12/20, 29/39, 45/80…) : la méthode
est la même des deux côtés.

« Atténué » = la couleur rendue diffère de la couleur déclarée parce qu'une opacité héritée l'a
modifiée : bouton **désactivé** (`opacity-40`, stepper au maximum `opacity-30`) ou panneau
**périmé** capturé pendant « Recalcul… » (`opacity-45`). L'audit les excluait de ses constats
(WCAG exempte les contrôles inactifs) ; le critère est ici lu dans les données, pas jugé à la main.

| Largeur | Échecs AA (tous) | **Échecs AA hors atténués** | Texte < 11 px | Texte à 9 px | Cibles < 24 px | Cibles < 32 px |
|---|---|---|---|---|---|---|
| 360 | 297 → 16 | **255 → 0** | 38 % → 10 % ¹ | 16 % → 0 | 23 → 1 ² | 279 → 147 |
| 768 | 359 → 60 | **328 → 0** | 35 % → 0 | 4 % → 0 | 32 → 1 ² | 335 → 159 |
| 1440 | 667 → 70 | **531 → 0** | 41 % → 0 | 3 % → 0 | 106 → 1 ² | 438 → 298 |

¹ Uniquement les cellules des matrices A / B du comparateur à 10 px (`compare-360`,
`compare-synthese-360`) : c'est la dérogation D2, et rien d'autre.
² La case « Noms des cartes » de la fiche (16 × 16) : son `<label>` de 32 px l'entoure et l'active,
la cible réelle est conforme ; seule la boîte de l'`input` est mesurée.

Échecs restants, tous atténués : « ⇄ Comparer » (moins de deux decks), « Importer le texte » (champ
vide), « + » du stepper à 3 copies, « enregistrer » du mode Requête (sans nom), « Ajouter » et « + »
de la vue Combos, « + Ajouter » / « Fiche imprimable » / « Comparer au deck de base » du
planificateur (deck non enregistré), et le panneau périmé des pages `editor-toast` et `editor-stats`
à 768 (capturées pendant le recalcul qui suit un retrait ou un changement de contexte).

Par page, échecs sur styles de texte visibles (avant → après) : connexion 5/9 → 0/8, inscription
6/10 → 0/9, accueil 5/14 → 0/14, éditeur Annoter 1440 43/78 → 2/78 (0 hors atténués), Annoter 360
12/20 → 1/13 (0), Stats mobile 29/39 → 0/50, Combos 45/80 → 3/80 (0), Inventaire 40/82 → 1/81 (0),
Mur de mains 37/78 → 1/76 (0), Plans de side 45/85 → 4/84 (0), comparateur 25/104 → 0/47, fiche
6/16 → 0/16, fiche imprimée 0/11 → 0/11.

**Chrome de l'éditeur avant le premier contenu** (`chrome-heights.json`, deck réel) :

| Largeur | En-tête | Onglets | Onglets masqués | Barre de modes | 1ʳᵉ tuile | Part de l'écran |
|---|---|---|---|---|---|---|
| 360 × 780 | 118 → **49** | 37 en haut → **49 en bas** | 208 px → **0** | 103 → 73 | 266 → **130** | 34 % → **17 %** (23 % avec la barre du bas) |
| 390 × 844 | 118 → 49 | 37 → 49 en bas | 178 px → 0 | 71 → 73 | 234 → 130 | 28 % → 15 % |
| 768 × 1024 | 79 → 49 | 37 → 40 | 0 | 39 → 40 | 163 → 137 | 16 % → 13 % |
| 1440 × 900 | 49 → 49 | 37 → 40 | 0 | 39 → 40 | 133 → 137 | 15 % → 15 % |

Delta de tuile : 10 px `#4a5265` (2,4:1) → 11 px `#c9cfdb` (11:1).

## 2. Décisions

Validées avant le code :

- **D1 — Navigation** : en-tête sur une ligne ; onglets soulignés en haut dès 640 px ; **barre
  d'onglets en bas sous 640 px** (48 px).
- **D2 — Plancher** : corps 13 px, minimum 11 px ; seule dérogation, cellules compactes A / B du
  comparateur sous 640 px, de 9 à 10 px.
- **D3 — Tokens** : `text-ink-*` remplacé par quatre rôles de texte ; `ink-*` conservé pour les
  fonds et bordures, valeurs relevées, servies par variables CSS.
- **D4 — Une seule passe**.

Prises en cours de tâche : voir `DECISIONS.md`, section « Refonte visuelle ». Les questions
ouvertes du plan ont été tranchées par défaut et restent à confirmer (§7).

## 3. Livré

**Couche de tokens** — `web/src/index.css` (`:root` : `--ink-950..500`, `--fg-1..4`, `--pos`,
`--warn`, `--info`, `--neg`, corps 13 px) ; `web/tailwind.config.js` (couleurs `ink`, `fg`, accents
par `var(--…)` ; `fontSize` **fermé** : `cell` 10, `meta` 11, `body` 13, `value` 14, `head` 16,
`title` 18, `hero` 20, `glyph` 24 ; `ink-400..100` et `fontFamily.num` retirés).

**Migration des 25 fichiers de composants** — substitution mécanique (`text-ink-100 → fg-1`,
`200 → fg-2`, `300/400/500/600 → fg-3` ; `text-xs → body`, `text-sm → value`, `[9/10/11px] → meta` ;
`emerald/amber/sky/red-200/300 → pos/warn/info/neg`), puis corrections à la main : `fg-4` sur le seul
vrai méta (date de l'accueil, passcode), `fg-2` sur ce qui se lit (delta de tuile, texte de carte),
en-têtes de tableau en `fg-3`.

**Navigation** (`Header.tsx`, `EditorPage.tsx`, `AccountMenu.tsx`, `ModeBar.tsx`, `StatsPanel.tsx`) :
en-tête d'une ligne de 48 px (retour, nom `flex-1`, taille, Enregistrer, compte) ; le réglage
premier / second descend dans l'en-tête du panneau « Probabilités » ; le bouton d'enregistrement
(`data-save`) affiche « enregistré 10:04 » au repos ; « en ligne » et l'heure passent aussi dans le
menu compte ; une erreur de persistance prend une seconde ligne pleine. Onglets soulignés en haut dès
640 px, barre du bas en dessous (une seule `<nav>` rendue, par `matchMedia` ; dernier enfant de la
colonne, pas `fixed` ; libellé court, nom complet en `title`, `aria-current`). Touches `<kbd>` de la
barre de modes masquées sous 640 px. `h-screen → h-[100dvh]` partout.

**Données et lisibilité** — cartes de chaleur dans `lib/colors.ts` seulement (`heatCell`,
`heatDelta`) : case opaque par `color-mix` sur `ink-900`, texte blanc pur puis noir dès α = 0,6685
(vert), blanc sur tout le rouge. Couleurs des séries sorties de `statsViews.ts`. Badges de rôle et
pastilles de tuile sous le bandeau de nom de l'illustration. Marqueur « sort / entre » du
planificateur hors de l'atténuation de la copie engagée.

**Cibles** — ✕ du toast et du détail de carte, retours « ← Mes decks » / « ← Plans de side »,
sélecteur de vue ◀ ▶ du panneau à 32 px ; cases de la vue Combos à 32 px de zone tactile (marque
de 16 px inchangée) ; tous les contrôles secondaires (critères du mode Requête, ✕ de suppression,
champs numériques, titres de colonne du panneau, curseur du mur, bouton de fichier, « Reprendre » /
« Ignorer » du brouillon) à 24 px au moins ; contrôle segmenté à `h-6` / `h-7`.

**Jargon** — « (§D) », « (§E) », « (§3.3) », « (contrat §2) », « (contrat §3) », « (§4.4) » retirés
du texte affiché ; « C(D,5) mains » → « les 5 cartes initiales » ; « E[S] », « E[U] », « E[copies] »
→ « moyenne » ; « E[red.] » → « redondance moyenne ».

**Document** — `lang="fr"`, `theme-color` `#111318`, `viewport-fit=cover`, `web/public/favicon.svg`.

**Gardes** — `web/src/lib/tokens.test.ts` (29 tests) : contrastes des quatre rôles et des accents
recalculés depuis `index.css`, bordure de composant ≥ 3:1, escalier ordonné, pire case de chaque
carte de chaleur ≥ 4,5:1 et seuil à la bascule exacte, classes proscrites (`text-ink-*`, `text-xs`…,
`text-[Npx]`, `h-screen`), `text-cell` hors comparateur, formule de chaleur écrite une seule fois.
`web/e2e/scenarios/guards.mjs` : en-tête ≤ 56 px, premier contenu ≤ 140 px, barre d'onglets entière
(aucun défilement), onglet du bas ≥ 44 px, sélecteur de contexte ≥ 24 px dans le panneau.

**Documentation** — charte `docs/design-system.md` (§1, §2.1–2.3, §3.1, §3.3–3.5, §6.1–6.3, §7.8,
§12, §13, renommage des classes citées) ; `AGENTS.md` (piège « refonte visuelle ») ; `DECISIONS.md`
et `docs/decisions-compressees.md` ; `docs/PLAN.md`.

## 4. Tests existants modifiés, et pourquoi

Aucun test unitaire existant n'est modifié (254 tests web inchangés, tous verts). Les gardes e2e
touchées le sont parce que ce qu'elles désignent a bougé, jamais pour relâcher une exigence :

| Fichier | Changement | Raison |
|---|---|---|
| `setup`, `conditions`, `side`, `mobile` | `nav button:has-text("X")` → `nav button[title="X complet"]` | sous 640 px la barre du bas abrège le libellé (« Mains », « Invent. ») ; le nom complet reste en `title` à toute largeur |
| `setup`, `home`, `extraside`, `side`, `guards` | `button:has-text("Enregistrer")` → `button[data-save]` | au repos le bouton dit « enregistré 10:04 » ; `text=/enregistré/` reste attendu et fonctionne |
| `guards` | sélecteur de contexte cherché dans le panneau (onglet « Stats » sous 1024 px) au lieu de `header` ; **ajout** des gardes de chrome et d'onglets | le réglage a quitté l'en-tête |
| `mobile` P3 | police des cellules compactes ≥ **10** px (au lieu de ≥ 9) | dérogation D2 : exigence **resserrée** |
| `mobile` P1 | « ← Mes decks sur une ligne » vérifié sur le texte (un seul rectangle de ligne) ; **ajout** d'une cible ≥ 32 px | le bouton mesure désormais 32 px, la hauteur ≤ 20 px ne pouvait plus servir d'indice |

## 5. Contrôle par mutation

Fichiers sauvegardés et empreintés (SHA-256) avant, restaurés et vérifiés après chaque mutation.

| # | Mutation | Détectée par | Résultat |
|---|---|---|---|
| M1 | `--fg-3` ramené à `#4a5265` (ancien `ink-500`, 2,5:1) | `tokens.test.ts` | 4 échecs (fg-3 sur les trois surfaces, ordre des rôles) |
| M2 | `text-cell` posé sur le delta de tuile | `tokens.test.ts` | « text-cell n'existe que dans le comparateur » |
| M3 | barre d'onglets du bas supprimée | e2e `guards` | clic sur l'onglet « Stats » à 360 px expiré |
| M4 | `h-[100dvh]` ramené à `h-screen` dans l'éditeur | `tokens.test.ts` | « aucun h-screen » |
| M5 | seuil noir des cartes de chaleur ramené à 0,5 (premier jet) | `tokens.test.ts` | 3 échecs après correction de la garde (ci-dessous) |
| M5′ | seuil à 0,64 (erreur fine) | `tokens.test.ts` | 3 échecs |
| M6 | en-tête qui repasse sur plusieurs lignes | e2e `guards` | en-tête à 151 px, premier contenu à 232 px |

**Défaut de garde trouvé par M5** : au premier passage, seul le test de bascule échouait. `heat()`
renvoie `#000` en hexadécimal court, que la fonction de luminance du test lisait `NaN` ; une
comparaison `NaN < pire` étant toujours fausse, les cases noires n'étaient jamais évaluées par les
tests de pire cas. Forme courte dépliée, couleur illisible refusée ; M5 et M5′ rejouées, détectées.
M3 est détectée par une expiration de clic plutôt que par une assertion nommée : suffisant, mais moins
lisible (question ouverte).

## 6. Écarts au plan

- **Nom des classes** : `text-fg-1..4` et non `text-1..4` (Tailwind préfixe la couleur par `text-`).
- **Cartes de chaleur** : le plan disait « noir dès α > 0,5 » ; la re-mesure a trouvé du noir à 3,1:1
  sur les cases moyennes. Calcul fait : au point de bascule, noir et `#f3f4f8` plafonnent à 4,38:1
  et aucun seuil unique ne tient 4,5:1 sur deux fonds (4,49 au mieux). Retenu : case opaque sur
  `ink-900`, blanc pur, seuil exact 0,6685 → 4,585:1 au pire (rouge : 5,75:1).
- **Cibles** : le plan visait « 0 cible < 32 px ». Tenu : 0 cible < 24 px (hors la case à libellé de
  la fiche) et 32 px sur toutes les cibles nommées par l'audit ; les contrôles secondaires restent à
  24 px, comme le prévoit la charte §6.3. Cibles < 32 px : 279 / 335 / 438 → 147 / 159 / 298.
- **Chrome à 360 px** : visé ~100 px, obtenu 130 px (au lieu de 266). La barre de modes tient
  toujours sur deux lignes (73 px) ; la faire défiler reproduirait le défaut « contenu masqué sans
  indice » que l'audit reprochait aux onglets.
- **Horodatage** : devenu l'état du bouton d'enregistrement, ce qui a imposé `data-save` aux gardes.
- **Contrôles supplémentaires** non prévus au plan : marqueur « sort / entre » et quinze contrôles
  secondaires trouvés par la re-mesure.

## 7. Questions ouvertes

- **Q1** — Nom du compte rendu : `docs/refonte-visuelle.md` (retenu) ou `docs/etape-11.md` ?
- **Q2** — Le réglage premier / second n'est plus dans l'en-tête : sous 1024 px, il ne se règle que
  depuis l'onglet « Stats » et le mur de mains. Le doubler dans la barre de modes ?
- **Q3** — Barre du bas à libellés seuls (retenu : aucune iconographie n'existe) ou icônes + libellés ?
- **Q4** — À 360 px, « enregistré 16:08 » occupe ~120 px et le nom du deck se tronque à ~90 px
  (« Snake-Eye Fi »). Forme courte au repos sous 640 px (« ✓ 16:08 ») ? Elle obligerait à revoir
  les attentes `text=/enregistré/` de l'e2e.
- **Q5** — Barre de modes sur deux lignes à 360 px (73 px) : acceptable, ou menu « Mode ▾ » ?
- **Q6** — M3 détectée par expiration : ajouter une assertion explicite « barre du bas présente » ?
- Hors périmètre, signalés par l'audit et non traités : variante claire optionnelle, `:focus-visible`,
  `role="dialog"` et Échap sur tous les dialogues, page de connexion (volet 02), infobulles `title`
  inaccessibles au toucher.

## 8. Vérifications exécutées

- `npm run typecheck` — OK. `npm run build` — OK (avertissement ExcelJS attendu).
- `node scripts/test-quiet.mjs` — 283 tests web (254 + 29 `tokens.test.ts`), 14 serveur, verts.
- `npm run e2e -w web` — 10 scénarios verts sur l'état final (verdict `mobile` conforme P1–P8 aux
  quatre largeurs), avec `E2E_WEB_PORT=5178 E2E_BASE=http://localhost:5178` : le 5174 était occupé
  par un autre projet, non touché.
- Re-mesure de l'audit en trois passes : la première a trouvé les deux vrais défauts restants
  (cases de chaleur moyennes, marqueur « sort / entre ») et des cibles secondaires sous 24 px ; la
  deuxième a validé les contrastes ; la troisième, sur une pile neuve, porte l'état final et fournit
  tous les chiffres du §1.
- Mutations M1–M6 et M5′ détectées, fichiers restaurés à l'empreinte.
- Conteneur `testhand-e2e-db` supprimé ; aucune base de dev, aucun VPS.

**Non vérifié** : rendu macOS / iOS / Android (Chrome et Segoe UI sous Windows seulement, comme
l'audit) ; comportement réel de `100dvh` et de `safe-area-inset-bottom` sur appareil ; lecteur
d'écran. La variante « v2 à écart réel » du comparateur (`compare-variant.mjs` de l'audit) n'a pas été
rejouée : les pages du comparateur après refonte comptent 47 styles contre 104, les deux decks ayant
ici des matrices identiques ; leurs 0 échec restent mesurés, mais sur moins de cellules colorées.

## 9. Rejouer la mesure

Les copies adaptées sont dans `docs/refonte-visuelle/scripts/`. Écarts à celles de l'audit : port
5178, dossier de sortie, bouton `button[data-save]`, onglets par `nav button[title="…"]` (« Combos &
catégories »), passage par l'onglet « Stats » pour changer de contexte sous 1024 px ; `chrome-heights`
lit la `<nav>` où qu'elle soit. Procédure : `E2E_WEB_PORT=5178 E2E_BASE=http://localhost:5178 npm
run e2e -w web -- --keep --only setup`, charger `docs/audit/captures/visuel/scripts/cards.sql` par
`docker exec -i testhand-e2e-db psql -U e2e -d e2e -f -`, ajuster `OUT` / `SCRATCH`, lancer
`audit-visuel.mjs`, `chrome-heights.mjs`, `analyse.mjs`, puis `avant-apres.mjs <mesures d'origine>
<mesures nouvelles>` ; démonter par `-- --down`.
