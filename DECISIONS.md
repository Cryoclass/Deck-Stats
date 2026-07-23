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
  interruptions) — le flag HOPT ne réduit **que** les sommets du graphe de combo, pas le
  compte de non-engine.

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
