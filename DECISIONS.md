# Décisions & écarts vs. document de référence

Conformément à §F : toute décision prise en cours d'implémentation est écrite ici.

## Coquilles relevées dans le tableau §C (valeurs de contrôle)

Le moteur calcule les probabilités **exactes**. Deux lignes du tableau §C ne
correspondent pas à la valeur mathématiquement exacte ; le moteur suit l'exact et les
tests documentent l'écart (voir `web/src/engine/engine.test.ts`).

1. **« Deck 40, 3 copies, main 5, P(≥1 copie) = 33,75 % »**
   Valeur exacte : `1 − C(37,5)/C(40,5) = 222111/658008 = 33,7551 %`.
   Arrondie au centième le plus proche → **33,76 %**. §C a tronqué la demi-unité. Les
   trois autres lignes du tableau matchent au centième, ce qui confirme que la valeur
   sous-jacente est bien 33,755 %.

2. **« Deck 40, 3 copies, main 5, P(exactement 2 copies) = 3,29 % »**
   Valeur exacte : `C(3,2)·C(37,3)/C(40,5) = 23310/658008 = 3,5425 %`.
   L'écart n'est pas un arrondi — **3,29 % est une erreur**. La valeur correcte est
   **3,54 %**.

Toutes les autres valeurs (39,43 % ; 12,50 % ; somme = 1 ; deck vide = 0 start ; les 4
cas de couplage dont le test HOPT décisif) sont reproduites exactement.

## Points de modélisation tranchés

- **Redondance** = nombre d'arêtes présentes sur **tous** les sommets de la main
  (starters inclus), pas seulement le sous-graphe non-starter. C'est la lecture
  « nombre de combos présents » de §2.4. Aucun cas de test §C ne distingue les deux
  interprétations (aucun ne combine starter + paire pour la redondance) ; ce choix est
  le plus fidèle à la définition produit.

- **Comptage non-engine** = **union** des copies appartenant à ≥1 catégorie pertinente
  (une carte dans deux catégories compte une fois dans le total, mais une fois **par
  catégorie** dans la ventilation). Les copies multiples comptent (2 Ash = 2
  interruptions). ⚠️ **Amendé à l'itération 2** : le total non-engine des cartes **HOPT**
  est désormais plafonné par un horizon de tours (`min(copies, horizon)`) — voir la
  section « Itération 2, Lot A » plus bas. La règle « HOPT ne réduit que le graphe de
  combo » ne vaut plus pour le total ; elle reste vraie pour le graphe et pour la
  ventilation par catégorie (copies brutes).

- **Contribution marginale (delta)** = `P(≥1 start) − P(≥1 start | −1 copie)`, la copie
  retirée basculant dans le filler (taille de deck constante). Calculée pour les deux
  passes ; la colonne affichée est pilotée par le sélecteur « delta 1st/2nd ».

- **Taille de deck** = somme des copies du main deck. Les curseurs de copies éditent
  réellement le deck : baisser une carte de 3→2 réduit la taille (avertissement si
  hors 40–60, §D). Le filler = cartes non annotées, indépendant des copies annotées.

- **Note /10 (§4.4)** = percentile calibré sur la distribution **exacte** des mains du
  deck (buckets de la passe), pas sur l'échantillon affiché. Score = starts (×100) puis
  non-engine en départage, pondéré par le curseur « importance ». Point-milieu pour les
  égalités.

- **Pivots colorés vs. pastilles (§D point ouvert 2)** : couverture gloutonne par degré
  décroissant → le hub d'un groupe devient pivot (coloré), ses voisins reçoivent sa
  pastille. Purement décision d'affichage, le calcul n'en dépend pas. Dual de l'exemple
  du document (qui colorait les feuilles) mais équivalent et plus économe en couleurs.

- **Couleurs** : `oklch()` natif CSS, teinte par angle d'or, L et C fixes → luminosité
  perceptuelle constante, lisible en surimpression. Non stockées, dérivées à
  l'affichage (§A).

- **Auto-combo (2 copies de la même carte = combo, §D point ouvert 1)** : non implémenté
  (collision avec HOPT). Rejeté à la saisie côté API et côté store.

- **Persistance** : best-effort. Toute annotation met à jour l'état local
  immédiatement puis tente le backend ; un échec bascule en mode « hors-ligne » sans
  jamais bloquer l'UI. L'état complet est aussi sérialisé dans l'URL (`#s=`, compressé
  lz-string) pour partage/repli sans backend.

- **Mode requête** : évalué sur les buckets d'issues (starts, redondance, comptes par
  catégorie) renvoyés par le worker → prédicats arbitraires instantanés, sans
  recalcul.

## Itération 1 — corrections

- **Cartes mortes selon la position (Lot C)** : `deadFirst`/`deadSecond` retirent la
  carte du graphe de combos ET des starters pour la passe concernée (traitée comme du
  filler : ses copies occupent toujours la main mais ne produisent ni start ni arête).
  Le comptage non-engine reste régi par la pertinence de catégorie, inchangé — une carte
  morte going first mais taggée handtrap compte toujours comme handtrap. Un flag mort sur
  une carte non annotée par ailleurs n'a aucun effet (elle est déjà filler). Deux tests
  moteur couvrent le cas ; les valeurs §C sont inchangées (défaut = non-mort).

- **Annotation par modes (Lot B)** : le menu ⋯ par carte n'est plus le canal des actions
  fréquentes. Une barre de modes bascule la grille entière (Combo/HOPT/Starter/Non-engine)
  ; on enchaîne les cartes sans rouvrir de menu. Mode combo = flux à pivot (1er clic =
  pivot coloré, clics suivants (dé)lient, re-clic pivot ou « Nouveau pivot » change de
  groupe sans sortir). Raccourcis C/H/S/N, Échap sort. Le ⋯ ne garde que le rare :
  détail, retrait du deck, suppression de paire en bibliothèque, flags morts (Lot C).

- **Radix pour les menus (A2)** : `@radix-ui/react-dropdown-menu` en portal avec
  `avoidCollisions` + `collisionPadding` → les menus ne sortent jamais du viewport
  (première/dernière colonne, dernière ligne). Remplace le Popover maison.

- **Compteur de copies (A1)** : le segmented 1/2/3 débordait de la vignette (le « 3 »
  était inatteignable). Remplacé par un stepper compact `− N +` à largeur garantie
  (`shrink-0`), sans conteneur `overflow:hidden`. La densité de la grille est préservée.

## Itération 2 — corrections

### Lot A — plafond HOPT du non-engine par horizon de tours (correction §B.3 étape 5)

La spec §B.3 étape 5 (« compter les non-engine sur la composition complète ») court-
circuitait l'effondrement HOPT : 3 Dominus Spark HOPT going first étaient comptés comme
3 non-engine alors qu'une seule copie est activable dans la fenêtre d'un tour adverse.

**Correction** : le total non-engine d'une carte **HOPT** est plafonné par un **horizon
de tours d'interaction**, propre à la passe :

```
si is_hopt(carte) : contribution = min(copies_en_main, horizon)
sinon             : contribution = copies_en_main
```

Le filtrage par pertinence de catégorie (`first`/`second`/`both`) s'applique **après** le
plafonnement. Horizon **réglable** (plage 1..3), défauts **first = 1**, **second = 2** —
c'est une hypothèse de jeu, pas une vérité (`horizonFirst`/`horizonSecond` sur
`EngineInput`, exposés dans « Options de calcul » du panneau de stats, sérialisés dans
l'URL de partage). Vérif : 3 Spark HOPT 1st → 1 ; 2 Ash HOPT 2nd → 2 ; 3 Ash HOPT 2nd → 2.

**Périmètre.** L'horizon ne touche **que** le total non-engine (`neFirst`/`neSecond`,
donc `E[non-engine]`, la distribution non-engine et la matrice croisée). Le **graphe de
combos est inchangé** : une carte HOPT reste 1 sommet (§2.3), starts et redondance ne
bougent pas (test dédié `engine.test.ts` : `startsExact` identique quand l'horizon
change).

**Point tranché — `catCounts` (ventilation par catégorie) reste en copies BRUTES**, non
plafonné. Justification : (1) le brief cible le *total* ; (2) `P(≥1)`, seule stat par
catégorie affichée dans le panneau, est invariante par plafond (`min(k,h) ≥ 1 ⇔ k ≥ 1`) ;
(3) un prédicat « catégorie ≥ N » du mode requête interroge la main *tirée* (combien j'ai
piochée), pas l'*activable*. Plafonner `catCounts` aurait exigé de rendre `evaluate`
spécifique à la passe (une seule des deux valeurs `neFirst`/`neSecond` est consommée à la
fois) pour un effet visible nul côté panneau et ambigu côté requête. Tests §C ajoutés
(carte X HOPT, carte Y non-HOPT, réglage + bornage de l'horizon, invariance des starts).

## Itération 3 — ajout / retrait de cartes

- **Retirer une carte n'efface aucune connaissance de jeu (C1).** `removeCard` supprime
  la seule ligne `deck_cards` ; starters, exclusions, flags HOPT/mort, catégories et
  paires sont **conservés**, inertes tant que la carte est absente (`buildModel` les
  ignore), et **restaurés au ré-ajout**. Corrige un bug où le starter était supprimé.
  Vérifié en base (retrait → `deck_starters` intact → ré-ajout → starter actif).
- Toute modif de `deck_cards` = **invalidation complète** puis recalcul intégral dans le
  worker (jamais de MàJ partielle) ; les mains affichées du mur sont **renotées** sans
  re-tirage (`drawHands` ⊥ `evaluateHands`).

## Itération 4 — persistance des decks

- **Séparation global / local.** La bibliothèque (paires, flags, catégories) est écrite
  **immédiatement** (connaissance de jeu, transverse). Les données **locales au deck**
  (`deck_cards`, `deck_starters`, `deck_pair_exclusions`, `params` = horizons +
  importance) relèvent du bouton **Enregistrer** (état `dirty`, Ctrl/Cmd+S, horodatage).
- **Brouillon local IndexedDB** écrit en continu (debounce 500 ms), indépendant de la
  base. Reprise proposée à l'ouverture. Comparaison brouillon/enregistré **par contenu**
  (`localSig`), pas par horodatage — robuste au décalage d'horloge client/serveur.
  Effacé à l'enregistrement.
- **`decks.summary` (jsonb)** met en cache l'aperçu de l'accueil (start≥1 1st, brick 1st,
  taille), écrit à chaque enregistrement. **Indicatif, jamais source de vérité** :
  l'éditeur recalcule toujours.
- **Routeur maison** (aucune dépendance), `/decks` (accueil) et `/decks/:id` (éditeur),
  via l'API History. Confirmation au retour accueil si `dirty` ; `beforeunload` sur
  fermeture/rechargement.
- **§4D déjà satisfait** : le calcul prend l'état de deck **en paramètre**
  (`computeAll(EngineInput)`, `buildModel(s)` ne lit aucun global) → prêt pour la
  comparaison de versions. `Dupliquer` copie composition + toutes les données locales.
- **Partage par URL (`#s=`) retiré** : remplacé par la persistance base + brouillon. Le
  lien partageable est désormais l'URL du deck (`/decks/:id`). `web/src/lib/share.ts`
  supprimé.
- **Catalogue = lookup, pas contrainte (divergence assumée vs §A).** Les colonnes
  `card_id` (deck_cards, deck_starters, card_flags, card_categories, combo_pairs) **ne
  référencent plus `cards`**. Le catalogue migré est incomplet (des passcodes récents
  manquent) et l'`id` EST le passcode (images dérivées du CDN, nom = confort). Une FK
  catalogue faisait échouer tout l'import d'un deck (rollback, 500 `23503`) dès qu'une
  seule carte manquait. Drop idempotent dans `schema.sql` pour les bases existantes.
- **Reste à faire (non bloquant, signalé)** : les **filtres du mur de mains** et les
  **requêtes enregistrées** du mode requête ne sont **pas encore** persistés dans
  `params` (seuls horizons + importance le sont). L'infrastructure `params` est prête ;
  il ne reste qu'à y brancher ces états UI.

## Itération 5 — prérequis en deck

- **Coquille du contrôle chiffré §F.** Le brief annonce **29,49 %** et affirme que
  l'exact est *en dessous* du produit naïf 33,75 % × 87,50 % = 29,53 %. C'est faux :
  « ≥1 A en main » et « B en main » portent sur des cartes **disjointes**, donc
  **négativement corrélées** en tirage sans remise → « ≥1 A » et « B *pas* en main » sont
  **positivement corrélées** → l'exact est **au-dessus** de 29,53 %. Valeur exacte par
  énumération : `(C(39,5) − C(36,5))/C(40,5) = 198765/658008 = 30,21 %`. La **table de
  vérité** (6 lignes) du brief, elle, est correcte et matche le moteur. Test asserte
  30,21 % ; c'est la 3ᵉ coquille chiffrée du corpus §C (cf. 33,75 % et 3,29 %).

- **Modèle.** Prérequis **locaux au deck** (`deck_start_requirements`), source = starter
  1-carte OU paire ; plusieurs prérequis sur une source sont **cumulatifs (ET)**. Une
  source non satisfaite : le starter ne compte pas, l'arête est retirée **avant** le
  couplage (donc hors redondance). Copies restantes = `total(req) − k(req)`.

- **Piège traité : promotion en type suivi.** Toute carte citée dans un prérequis est
  ajoutée aux types de `buildModel` même sans autre annotation ; sinon `k(req)` est
  inconnu (carte fondue dans le filler) et le prérequis est incalculable. Promotion sans
  effet sur les décks *sans* prérequis → les tests §C restent strictement identiques
  (chemin rapide `hasPrereqs=false`, 22/22 verts). Carte requise absente du deck →
  `requiredType=null`, total 0 → source morte en permanence (signalée dans l'Inventaire).

- **Pas de consommation de ressource** (hors périmètre, §C note) : 2 dépendantes HOPT +
  1 copie requise restante = le flag HOPT réduit déjà à un sommet unique.

- **UI.** Mode `Prérequis` (raccourci P), même mécanique à pivot que `Lier combo`
  (dépendante → requises). Distinction visuelle **impérative** : marqueur en **contour
  pointillé** ambre + icône « deck » (▤) au coin bas-droit (les pastilles de combo sont
  pleines, en haut-droite) ; au survol de la dépendante, ses cartes requises se
  surlignent (relation **dirigée**). Prérequis sur une **paire** : posé depuis l'onglet
  Combos. Inventaire : section « Starters conditionnels » avec les deux avertissements
  (requise absente ; requise en 1 copie + probabilité 12,5 % 1st / 15 % 2nd sur 40).

## Itération 6 — distributions non-engine parcourables (affichage seul)

- **Purement de l'affichage** : aucune valeur nouvelle, réutilisation des distributions
  déjà calculées (`startsBuckets`, `nonEngine`, `perCategory[].dist`). Tests §C
  strictement inchangés (22/22 verts).
- **Bascule de vue** (◀ / titre / ▶) : Starts jouables → Non-engine (total) → une entrée
  par catégorie. Les deux colonnes (1st/2nd) suivent la vue choisie.
- **Colonne cumulée** (« au moins n ») ajoutée à chaque ligne 0/1/2/≥3, y compris pour
  Starts. Ligne 0 = « — » (P(≥0) trivial).
- **Pertinence par passe** : une catégorie non pertinente sur une passe (ex. board
  breaker going first) affiche une mention explicite dans cette colonne, pas des zéros
  (avec `relevance ∈ {first,second,both}`, le cas « pertinent sur aucune passe » ne peut
  pas survenir, mais est géré défensivement).
- **Mémorisation** : `statsView` rejoint les params du deck (sauvegardé, brouillon,
  restauré au chargement). Le changer marque le deck « non enregistré » — cohérent avec
  `importance`/horizons (mêmes params save-gated), au prix d'un léger inconfort (une
  préférence d'affichage marque « dirty »). Assumé pour rester cohérent avec le modèle.
