# Spec — Comparateur de decks (matrice Starters × Non-Engine)

Feature à intégrer au site : comparer **deux versions d'un deck** sur l'analytic « matrice Starters × Non-Engine », en going first et going second, avec un export Excel.

Le site sait déjà calculer la matrice pour **un** deck. Cette spec ne réécrit pas ce calcul : elle décrit la couche de comparaison au-dessus, plus deux ou trois points sur le calcul existant qui doivent être vérifiés avant de construire dessus (§3 et §6).

---

## 1. Objectif

À partir de deux decks A (référence) et B (variante), produire :

1. les 4 matrices (A/GF, A/GS, B/GF, B/GS) ;
2. deux **matrices de delta** cellule à cellule (B − A), une par scénario ;
3. une **table d'agrégats** comparée, avec sens de lecture ;
4. un **export Excel** reprenant le tout.

Le livrable qui compte pour l'utilisateur final est l'Excel ; l'affichage écran reprend la même structure.

---

## 2. Rappel : ce qu'est la matrice

Distribution de probabilité jointe de la main d'ouverture, sur deux axes :

- **lignes** = nombre de *starters* dans la main : `0`, `1`, `2`, `≥3`
- **colonnes** = nombre de *non-engine* dans la main : `0`, `1`, `2`, `3`, `4`, `5` (going first) ou `5+` (going second)

Chaque matrice somme à 100 %. Taille de main : **5 going first**, **6 going second**.

Le calcul est une hypergéométrique multivariée à trois catégories (starter / non-engine / autre) :

```
P(i starters, j non-engine)
  = C(S, i) * C(N, j) * C(D - S - N, h - i - j) / C(D, h)
```

avec `D` = taille du deck, `S` = nombre de starters, `N` = nombre de non-engine, `h` = taille de main. Les buckets plafonnés (`≥3`, `5+`) sont la somme sur toutes les valeurs de l'intervalle.

---

## 3. Point critique : la classification dépend du scénario

**C'est le piège principal de cette feature.** Un même exemplaire peut changer de catégorie entre going first et going second.

Exemples concrets : *Pot de Paresse*, *Mulcharmy Fuwalos* et les cartes du même genre comptent comme **non-engine going second** mais sont **mortes going first**.

Conséquence sur le modèle : la catégorie n'est **pas** un attribut global de la carte, c'est une fonction de `(carte, scénario)`. Si le code actuel stocke un simple tag `role: 'starter' | 'non_engine' | 'other'` sur la carte, il faut le remplacer par deux champs.

```ts
type Role = 'starter' | 'non_engine' | 'dead';

interface CardEntry {
  cardId: string;
  copies: number;          // 1..3
  roleGoingFirst: Role;    // ex. Fuwalos -> 'dead'
  roleGoingSecond: Role;   // ex. Fuwalos -> 'non_engine'
}
```

`'dead'` n'est ni starter ni non-engine : la carte tombe dans la catégorie « autre » de l'hypergéométrique. Une main peut donc avoir `starters + non_engine < handSize`, c'est normal.

Corollaire à garder en tête pour l'interprétation : **une modification de deck peut faire bouger la matrice going first sans toucher la going second** (ou l'inverse), si les cartes échangées ne sont vivantes que d'un côté. Ce n'est pas un bug.

---

## 4. Modèle de données

```ts
type Scenario = 'going_first' | 'going_second';

interface Matrix {
  scenario: Scenario;
  handSize: number;              // 5 | 6
  deckSize: number;              // 40 typiquement
  starterCount: number;          // S, utile pour les garde-fous du §7
  nonEngineCount: number;        // N
  rowLabels: string[];           // ['0','1','2','≥3']
  colLabels: string[];           // ['0','1','2','3','4','5'] | [...,'5+']
  cells: number[][];             // probabilités EXACTES en [0,1], somme = 1
}

interface DeckComparison {
  deckA: { name: string; matrices: Record<Scenario, Matrix> };
  deckB: { name: string; matrices: Record<Scenario, Matrix> };
  deltas: Record<Scenario, number[][]>;      // B - A, en [0,1]
  aggregates: Record<Scenario, AggregateRow[]>;
  warnings: Warning[];
}
```

**Règle impérative sur les arrondis :** `cells` stocke les probabilités exactes en flottant. L'arrondi à une décimale est **uniquement** un choix d'affichage. Tous les agrégats et deltas se calculent sur les valeurs exactes, jamais sur les valeurs arrondies — sinon les erreurs s'accumulent et les totaux tombent à 99.8 % au lieu de 100 %.

---

## 5. Delta cellule à cellule

```
delta[i][j] = B.cells[i][j] - A.cells[i][j]
```

Exprimé en **points de pourcentage** à l'affichage (pas en pourcentage relatif). Format d'affichage : signe explicite, une décimale, `+1.4` / `−3.3` / `·` pour zéro exact.

Les deux matrices comparées doivent avoir des `rowLabels` et `colLabels` identiques. Si les buckets diffèrent, refuser la comparaison plutôt que d'aligner à l'aveugle.

### Coloration

Pour la matrice de delta, colorer par **signe brut** : vert = plus de probabilité dans B, rouge = moins. Échelle divergente centrée sur 0, bornes à ±2 points.

Afficher impérativement une légende : *« vert = probabilité plus élevée dans B, pas nécessairement meilleur »*. Une hausse dans la colonne `ne = 0` est un mauvais signe alors qu'elle sera verte. Pour les agrégats en revanche, la coloration est orientée mérite (§6.2), là on connaît le sens.

---

## 6. Agrégats

Notations sur une matrice : `M[i][j]`, marges lignes `R[i] = Σⱼ M[i][j]`, marges colonnes `C[j] = Σᵢ M[i][j]`.

### 6.1 Définitions

| Clé | Libellé | Formule | Sens |
|---|---|---|---|
| `brick_starters` | Brick starters (0 starter) | `R[0]` | ↓ mieux |
| `starters_ge1` | ≥1 starter | `1 - R[0]` | ↑ |
| `starters_ge2` | ≥2 starters | `R[2] + R[3]` | ↑ |
| `starters_ge3` | ≥3 starters | `R[3]` | ↑ |
| `ne_zero` | 0 non-engine | `C[0]` | ↓ mieux |
| `ne_ge1` | ≥1 non-engine | `1 - C[0]` | ↑ |
| `ne_ge2` | ≥2 non-engine | `Σ_{j≥2} C[j]` | ↑ |
| `ne_ge3` | ≥3 non-engine | `Σ_{j≥3} C[j]` | ↑ |
| `playable` | Zone jouable : ≥1 starter ET ≥1 non-engine | `Σ_{i≥1, j≥1} M[i][j]` | ↑ |
| `strong_hand` | Main forte : ≥2 starters ET ≥2 non-engine | `Σ_{i≥2, j≥2} M[i][j]` | ↑ |
| `mean_starters` | Moyenne starters (plancher) | `Σᵢ i · R[i]`, bucket `≥3` compté = 3 | ↑ |
| `mean_ne` | Moyenne non-engine (plancher) | `Σⱼ j · C[j]`, bucket `5+` compté = 5 | ↑ |

`playable` et `strong_hand` sont les deux indicateurs composites les plus parlants : ils ne se déduisent pas des marges, il faut sommer les cellules.

**Les deux moyennes sont des planchers**, à cause des buckets plafonnés. Le libellé affiché doit le dire, sinon on croit à une moyenne exacte. Alternative si tu veux la vraie moyenne : la recalculer directement depuis l'hypergéométrique sans bucketing (`Σ i · P(i)` sur tout le support) — c'est plus propre et ça ne coûte rien puisque le modèle est analytique. À toi de voir si tu préfères la cohérence avec la matrice affichée ou l'exactitude.

### 6.2 Ligne d'agrégat

```ts
interface AggregateRow {
  key: string;
  label: string;
  valueA: number;
  valueB: number;
  delta: number;                       // B - A
  direction: 'higher_is_better' | 'lower_is_better';
  unit: 'percent' | 'count';           // count pour les deux moyennes
}
```

La coloration du delta d'agrégat est **orientée mérite** : `favorable = direction === 'lower_is_better' ? delta < 0 : delta > 0`. C'est ce qui évite de peindre en vert une hausse de bricks.

---

## 7. Validations et garde-fous

À produire dans `warnings[]`, sans bloquer le rendu sauf mention contraire.

1. **Somme des matrices.** Chaque matrice doit sommer à 1 ± 1e-9 sur les valeurs exactes. Écart au-delà → erreur bloquante, c'est un bug de calcul.
2. **Buckets compatibles.** `rowLabels` et `colLabels` identiques entre A et B pour un scénario donné. Sinon → erreur bloquante.
3. **Tailles de deck.** Si `A.deckSize !== B.deckSize`, avertir : la comparaison reste valide mais l'interprétation change.
4. **Cohérence des marges starters.** Les marges lignes ne dépendent que de `(S, D, h)`. Donc si `A.starterCount === B.starterCount` et `A.deckSize === B.deckSize`, alors `R_A[i] === R_B[i]` pour tout `i`. Si ce n'est pas le cas → bug de classification, avertir explicitement. Inversement, si les marges diffèrent alors que l'utilisateur pensait n'avoir touché qu'à du non-engine, l'avertissement lui apprend quelque chose.
5. **Decks identiques.** Si tous les deltas sont nuls, afficher un message dédié plutôt qu'un tableau vide de sens.
6. **Cohérence inter-scénarios.** Deux matrices du même deck partagent `S` et `N`… sauf si des cartes changent de rôle selon le scénario (§3), ce qui est le cas normal. Ne pas transformer ça en erreur : au mieux, afficher en clair les `S`/`N` retenus par scénario pour que l'utilisateur voie l'effet de sa classification.

---

## 8. Export Excel

Trois onglets : `Going First`, `Going Second`, `Synthèse`.

### Onglets scénario

Trois blocs empilés, même géométrie pour les deux onglets (ça permet aux formules de la Synthèse d'être identiques à un offset près) :

| Ligne | Contenu |
|---|---|
| 1 | Titre |
| 2 | Sous-titre (taille de main, définitions) |
| 4 | `A. <nom deck A>` |
| 5 | En-têtes : `is \ ne`, `0`…`5`, `Total` |
| 6–9 | Données A (lignes `0`, `1`, `2`, `≥3`) |
| 10 | Ligne Total |
| 12–18 | Même structure pour `B. <nom deck B>` |
| 20–26 | Bloc Delta (formules `=B14-B6` etc.) |
| 28 | Légende |

Colonne `H` = total de ligne, ligne de bas de bloc = total de colonne, en formules `SUM()`.

- Les cellules de données sont écrites **en valeur** ; tout le reste (totaux, deltas, agrégats) **en formule**, pour que l'utilisateur puisse modifier une entrée et voir le classeur se recalculer.
- Formats : `0.0%;-0.0%;"·"` pour les probabilités, `+0.0%;-0.0%;"·"` pour les deltas, `0.00` / `+0.00;-0.00;"·"` pour les moyennes.
- Mise en forme conditionnelle : échelle 2 couleurs blanc → vert sur les blocs A et B (borne haute ~0.19) ; échelle 3 couleurs rouge / blanc / vert centrée sur 0, bornes ±0.02, sur le bloc Delta.
- Convention de couleur de police, utile pour l'audit : bleu = saisie, noir = formule locale, vert = référence à un autre onglet.

### Onglet Synthèse

Une ligne par agrégat, colonnes : `Indicateur | A GF | B GF | Δ GF | A GS | B GS | Δ GS | Sens souhaité`.

Les valeurs sont des **formules pointant vers les onglets scénario** (`='Going First'!$H$6`), pas des constantes. Coloration conditionnelle orientée mérite sur les colonnes Δ.

### Librairie

**ExcelJS** est le choix indiqué côté Node : il gère les styles, les formats de nombre et la mise en forme conditionnelle nativement. L'édition communautaire de SheetJS ne couvre pas le style, ce qui rendrait la heatmap impossible. Vérifie l'état actuel des deux avant de trancher, l'écosystème bouge.

Génération côté serveur si tu veux garder la logique en un seul endroit ; côté client c'est faisable aussi et ça évite un aller-retour, ExcelJS tourne dans le navigateur.

---

## 9. Rendu écran

Reprendre la structure de l'Excel : les deux matrices puis la matrice de delta, puis la table de synthèse. Points d'attention :

- même échelle de couleur entre A et B, sinon la comparaison visuelle ment ;
- légende de la matrice de delta obligatoire (§5) ;
- afficher `S` et `N` par scénario sous chaque matrice ;
- les warnings du §7 en bandeau visible, pas en console.

---

## 10. Cas limites

- **Bucket `≥3` / `5+`** : ne jamais traiter le label comme un nombre. Prévoir un tableau de poids explicite pour les moyennes.
- **Deck où `S = 0` ou `N = 0`** : la matrice dégénère sur une ligne ou une colonne. Doit rester affichable.
- **`S + N > D`** : impossible, erreur de saisie, à rejeter en amont.
- **Main plus grande que le deck** : garde-fou trivial mais à avoir.
- **Cartes classées `dead` dans les deux scénarios** : autorisé (une brick assumée), elles tombent en « autre ».

---

## 11. Jeu de test de référence

Données réelles, deck Mitsurugi. À utiliser comme fixture de non-régression.

⚠️ Ces valeurs sont **relevées depuis un affichage arrondi à 0.1 %**. Les totaux tombent donc à 99.8–100.1 au lieu de 100. Tolérance de test : **±0.3 point** sur les agrégats. Pour un test exact, régénère la fixture depuis le moteur avec des valeurs non arrondies.

### Deck A — Mitsurugi pure

Going first (main de 5) :

| is \ ne | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| 0 | 0.2 | 1.4 | 3.5 | 3.1 | 0.9 | 0.1 |
| 1 | 1.6 | 9.8 | 15.6 | 7.3 | 0.8 | · |
| 2 | 4.8 | 17.8 | 14.4 | 2.2 | · | · |
| ≥3 | 5.8 | 8.8 | 2.0 | · | · | · |

Going second (main de 6) :

| is \ ne | 0 | 1 | 2 | 3 | 4 | 5+ |
|---|---|---|---|---|---|---|
| 0 | · | 0.1 | 0.5 | 1.3 | 1.9 | 1.2 |
| 1 | 0.1 | 1.3 | 5.4 | 10.1 | 8.0 | 1.4 |
| 2 | 0.7 | 5.5 | 15.5 | 15.5 | 3.2 | · |
| ≥3 | 2.7 | 10.8 | 12.0 | 2.6 | · | · |

### Deck B — Orcust

Going first :

| is \ ne | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| 0 | 0.3 | 2.0 | 3.7 | 2.0 | 0.3 | · |
| 1 | 2.8 | 13.0 | 13.7 | 4.0 | 0.3 | · |
| 2 | 7.4 | 19.7 | 11.1 | 1.3 | · | · |
| ≥3 | 7.5 | 9.0 | 1.8 | · | · | · |

Going second :

| is \ ne | 0 | 1 | 2 | 3 | 4 | 5+ |
|---|---|---|---|---|---|---|
| 0 | · | · | 0.3 | 1.1 | 1.8 | 1.1 |
| 1 | 0.1 | 1.0 | 5.0 | 10.0 | 7.4 | 1.5 |
| 2 | 0.6 | 5.5 | 15.5 | 14.9 | 3.8 | · |
| ≥3 | 2.9 | 11.2 | 12.5 | 3.6 | · | · |

### Agrégats attendus (en %, sauf moyennes)

| Indicateur | A GF | B GF | Δ GF | A GS | B GS | Δ GS |
|---|---|---|---|---|---|---|
| Brick starters | 9.2 | 8.3 | −0.9 | 5.0 | 4.3 | −0.7 |
| ≥1 starter | 90.9 | 91.6 | +0.7 | 94.8 | 95.5 | +0.7 |
| ≥2 starters | 55.8 | 57.8 | +2.0 | 68.5 | 70.5 | +2.0 |
| ≥3 starters | 16.6 | 18.3 | +1.7 | 28.1 | 30.2 | +2.1 |
| 0 non-engine | 12.4 | 18.0 | +5.6 | 3.5 | 3.6 | +0.1 |
| ≥1 non-engine | 87.7 | 81.9 | −5.8 | 96.3 | 96.2 | −0.1 |
| ≥2 non-engine | 49.9 | 38.2 | −11.7 | 78.6 | 78.5 | −0.1 |
| ≥3 non-engine | 14.4 | 7.9 | −6.5 | 45.2 | 45.2 | 0.0 |
| Zone jouable | 78.7 | 73.9 | −4.8 | 91.3 | 91.9 | +0.6 |
| Main forte | 18.6 | 14.2 | −4.4 | 48.8 | 50.3 | +1.5 |
| Moyenne starters | 1.63 | 1.68 | +0.04 | 1.91 | 1.96 | +0.05 |
| Moyenne non-engine | 1.54 | 1.29 | −0.25 | 2.38 | 2.38 | ≈0 |

### Ce que la fixture doit démontrer

Ce couple de decks est un bon test parce qu'il exhibe le comportement du §3 : les marges lignes (starters) sont **identiques entre les deux versions** — 8.3 / 33.8 / 39.5 / 18.3 en going first — donc le nombre de starters n'a pas changé, alors que la distribution de non-engine s'effondre going first et reste intacte going second. C'est la signature d'un échange de cartes vivantes des deux côtés contre des cartes going-second only. Si ton implémentation ne reproduit pas cette asymétrie, la classification par scénario n'est pas correctement branchée.

---

## 12. Découpage suggéré

1. Migrer le modèle de carte vers une classification par scénario (§3) — c'est le prérequis, tout le reste en dépend.
2. Extraire le calcul de matrice existant derrière une fonction pure `computeMatrix(deck, scenario): Matrix`, avec valeurs exactes.
3. `compareDecks(deckA, deckB): DeckComparison` — deltas, agrégats, warnings. Couvrir par la fixture du §11.
4. Export Excel `exportComparison(comparison): Buffer`.
5. UI.

Les étapes 3 et 4 sont indépendantes de l'UI et testables seules, à faire en premier.
