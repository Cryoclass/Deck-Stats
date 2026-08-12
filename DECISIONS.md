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

## Itération 7 — mode requête généralisé (sujet + intervalle, agrégats, groupes)

- **Critère = sujet + [min, max]** (bornes optionnelles, vide = non bornée, jamais
  confondue avec « ≤ 0 »). ET de tous les critères ; aucun critère → 100 % ; un critère
  `min > max` bloque l'évaluation (résultat « — »).

- **Agréger ≠ additionner (§C) — signatures.** Le piège : une carte dans deux catégories
  serait comptée deux fois. Solution : le moteur groupe les types non-engine par
  **signature = ensemble de catégories PERTINENTES pour la passe**, et chaque bucket
  porte la contribution (dédupliquée, plafond HOPT) par signature. Un groupe de catégories
  G = Σ des signatures dont l'ensemble croise G → chaque carte comptée **une fois**. Ordre
  respecté : filtrage pertinence → union (par signature) → plafond HOPT. Test décisif §E :
  groupe {A,B} partageant une carte **strictement < ** somme des deux compteurs.

- **Le sujet non-engine est « activable », pas « tiré ».** Les sujets catégorie / groupe
  / Non-engine(tous) appliquent le plafond HOPT et le filtrage par pertinence (cohérent
  avec le total `neTotal`). Cela **remplace** la note de l'itération 2 (« le mode requête
  interroge la main tirée ») : depuis l'itération 7, la requête interroge l'**activable**.
  La *ventilation par catégorie du panneau de stats* (itération 6) reste, elle, en copies
  BRUTES tirées — c'est une autre question (combien je pioche vs combien j'active).

- **Un seul système de critères (§D).** Le filtre du mur de mains EST la requête : mêmes
  critères, même contexte d'évaluation (`neContrib` + `neSignatures`) sur les buckets ET
  sur les mains tirées. « Voir ces mains » active le filtre et bascule sur l'onglet. Les
  anciens filtres `starts ≥ / non-engine ≥ / bricks` sont supprimés (exprimables par la
  requête). Requêtes **nommées** enregistrées dans les params du deck ; la requête en
  cours est un brouillon transitoire (non « dirty »).

## Itération 8 — comptes utilisateurs (Lot A : socle d'authentification)

- **Sessions serveur révocables, pas de JWT.** Token opaque de 32 octets aléatoires
  dans un cookie `httpOnly` + `SameSite=Lax` (+ `Secure` en prod), 30 jours
  **glissants** (l'expiration n'est réécrite que sous la moitié restante, pour ne pas
  faire un UPDATE par requête). Seul le **SHA-256** du token touche la base
  (`sessions.token_hash`) : un dump ne donne aucune session utilisable. Déconnexion =
  suppression de ligne, effet immédiat — pas de danse de refresh JWT.

- **Hachage scrypt natif** (`node:crypto`, N=2¹⁷ r=8 p=1, OWASP) : zéro dépendance,
  pas de build natif sous Windows. Les paramètres voyagent dans le hash
  (`scrypt:N:r:p:salt:key`) → durcissables sans invalider les comptes. Comparaison en
  temps constant, et **hash factice** calculé quand l'email est inconnu (ou compte
  OAuth sans mot de passe) pour que le timing de `/login` ne permette pas d'énumérer
  les comptes — même réponse 401 « identifiants invalides » dans tous les cas.

- **Inscription sur code d'invitation**, via `INVITE_CODES` (liste en `.env`, séparée
  par des virgules). Zéro table, zéro admin ; liste vide = inscriptions fermées ;
  révoquer = éditer + redémarrer. Le contrôle est isolé dans une fonction unique :
  passer à une table de codes traçables restera un petit changement.

- **Garde globale** en `preHandler` déclarée AVANT l'enregistrement des routes (un
  hook Fastify ne s'applique qu'aux routes enregistrées après lui). Public :
  `/api/health` et `/api/auth/*` uniquement. Rate-limit opt-in par route
  (`@fastify/rate-limit`) : login 10/min, register 5/10 min. CORS resserré sur
  `APP_ORIGIN` avec `credentials: true` — l'ancien `origin: true` est incompatible
  avec des cookies de session.

- **Email = identifiant**, unicité insensible à la casse (index sur `lower(email)`).
  `password_hash` nullable : prépare les comptes Discord seuls (Lot D), qui ne
  pourront jamais se connecter par mot de passe (le login leur répond comme à un
  email inconnu). `user_identities` créée dès maintenant, unique
  (provider, provider_user_id), **jamais** de rattachement automatique par email.

- **Correction au passage : le `.env` racine n'était jamais chargé** par le serveur.
  `npm run dev -w server` exécute avec cwd `server/`, où `import 'dotenv/config'`
  ne trouve rien — tout tournait sur les valeurs par défaut en dur. Nouveau
  `server/src/env.ts` (chemin explicite vers le `.env` racine), utilisé par l'index,
  `db.ts` et le script de migration.

- **Nouvelle commande `npm run db:schema`** : rejoue `db/schema.sql` (idempotent par
  construction) sur la base en marche. Nécessaire car `docker-entrypoint-initdb.d` ne
  s'exécute que sur un `pgdata` vierge — les `alter table` des itérations 4–5
  n'avaient jamais été appliqués autrement qu'à la main.

## Itération 8 — comptes utilisateurs (Lot B : propriété des données)

- **La bibliothèque devient PAR COMPTE** (`card_flags`, `combo_pairs`,
  `nonengine_categories` + `card_categories` par transitivité). Décision assumée vs
  « globale partagée » : personne ne peut détruire les annotations d'un autre
  (`deletePair` est définitif), et le partage existe déjà via l'export/import JSON
  complet. Clés recomposées : `card_flags` PK `(owner_id, card_id)`, unicité
  `combo_pairs (owner_id, card_a_id, card_b_id)` et
  `nonengine_categories (owner_id, name)`.

- **Les deux catégories de base** ('Handtrap', 'Board breaker') ne sont plus seedées
  par le SQL (le `on conflict (name)` n'aurait d'ailleurs plus de cible) : elles sont
  créées **pour chaque compte** à sa création, dans la même transaction
  (`server/src/auth/account.ts`, point d'entrée unique — register aujourd'hui,
  Discord/adopt aussi).

- **Deck d'autrui → 404, jamais 403** : on ne révèle pas l'existence d'une ressource.
  Toutes les requêtes decks/library sont bornées à `owner_id` ; les références
  croisées (`pair_id` d'exclusion, `source_pair_id` de prérequis, `category_id`)
  sont validées côté SQL (`insert … select … where owner_id = $n`) — un id de paire
  volé à un autre compte est silencieusement ignoré.

- **Migration legacy en deux commandes** : `npm run db:schema` (ajoute les colonnes
  `owner_id`, nullables à ce stade) puis `npm run adopt -- <email> <mdp>` — crée ou
  réutilise le compte, adopte TOUS les orphelins, bascule les anciennes clés
  (PK/unicités sans owner) vers les nouvelles, verrouille `owner_id NOT NULL`, en
  UNE transaction, relançable sans risque. Le schéma d'une base VIERGE naît
  directement dans l'état final ; `adopt` n'est que le chemin legacy.

- **Validé sur base fantôme** (copie `pg_dump` de la base réelle, adoptée puis
  éprouvée en deux comptes) : 8 decks/102 paires/73 flags/4 catégories adoptés,
  re-run no-op, 404 croisés sur GET/PUT/duplicate/starters, flags et paires isolés
  (deux comptes peuvent flagger la même carte), deck source intact.

## Itération 8 — comptes utilisateurs (Lot C : front)

- **La page de connexion est rendue À LA PLACE de la route demandée** (garde dans
  `App.tsx`), l'URL n'est jamais touchée : un lien profond `/decks/:id` aboutit
  exactement là où on voulait aller après connexion — zéro machinerie de
  « destination mémorisée », pas de route `/login`.

- **401 ≠ hors-ligne.** Le mode hors-ligne existant (backend injoignable, l'app reste
  utilisable sans persistance) avalait toutes les erreurs backend. Désormais :
  un `fetch` qui REJETTE = panne réseau → `offline` (l'app se rend, sans login
  impossible) ; un **401 du serveur** sur une route protégée = session absente/expirée
  → événement `ygo:unauthorized` → retour à la page de connexion. Sur `/auth/*`, le
  401 reste une réponse normale (sonde `/me`, mauvais identifiants). `ApiError`
  transporte le statut ET le message serveur (« code d'invitation invalide »…)
  jusqu'aux formulaires.

- **Déconnexion = purge des brouillons IndexedDB + rechargement complet.** Les
  brouillons contiennent des decks entiers (poste partagé) ; le
  `window.location.assign` garantit zéro résidu d'état en mémoire (store Zustand
  compris) d'un compte à l'autre.

- **`bootstrap()` (bibliothèque du compte) ne part plus qu'après authentification** :
  `Routed` ne monte que derrière la garde — l'ancien chargement à vide au démarrage
  disparaît.

- **Validé au navigateur** (Playwright + Edge headless, base fantôme) : login page,
  mauvais mot de passe (message serveur affiché), connexion (8 decks adoptés,
  annotations, stats moteur calculées), menu de compte, deep link + reload avec
  session persistante, déconnexion avec session révoquée côté serveur, formulaire
  d'inscription avec code d'invitation.

- **Amendement (bug trouvé au premier register réel)** : les bascules d'unicité
  (`combo_pairs`, `nonengine_categories`) sont déplacées de `adopt` vers
  `db/schema.sql` (bloc DO idempotent) — elles sont jouables AVANT l'adoption car
  NULL est distinct dans un index unique. Sans cela, un register sur base legacy
  percutait l'ancienne unicité globale `unique(name)` (seed de 'Handtrap' vs ligne
  legacy) et le 23505 était traduit à tort en « compte existe déjà » (409). Le catch
  du register est désormais scopé à la contrainte `users_email_unique`, et le seed
  utilise `where not exists` (indépendant des contraintes). Seul le PK de
  `card_flags` (qui exige NOT NULL) reste basculé par `adopt`.

## Itération 8 — comptes utilisateurs (Lot D : OAuth Discord)

- **Deux intentions, un cookie d'état court** (`ygo_oauth`, 10 min, httpOnly,
  SameSite=Lax — le Lax laisse passer le cookie sur la redirection top-level de
  retour) portant l'aléa anti-CSRF + le code d'invitation + le drapeau « liaison ».
  Le `state` du retour est comparé à l'aléa du cookie ; mismatch ou cookie absent →
  refus.

- **La porte reste fermée** : créer un compte via Discord exige un code d'invitation
  valide, embarqué dans le cookie d'état AVANT le départ chez Discord et REvalidé au
  retour (l'env a pu changer). Un code fourni mais invalide échoue avant même la
  redirection. Une identité déjà connue se connecte sans code.

- **JAMAIS de rattachement automatique par email.** Un email Discord identique à un
  compte existant → erreur explicite `email_taken` (l'email Discord ne prouve pas la
  propriété du compte : ce serait un vol de compte). La liaison est un geste
  explicite, en session (`?link=1`), depuis le menu de compte. Déliaison refusée si
  le compte n'a pas de mot de passe (il perdrait tout moyen de connexion) — comptes
  Discord seuls : `password_hash` null, traités en inconnu par le login mot de passe.

- **URLs Discord surchargeables par env** (`DISCORD_AUTHORIZE_URL` / `TOKEN_URL` /
  `USER_URL`) : le flux complet est testé contre un mock local, sans app Discord ni
  réseau. Bouton masqué côté front si non configuré (`GET /api/auth/providers`).
  Redirection via le proxy Vite (`:5173/api/...`) : tout reste même origine.

- **Vite paramétrable** (`WEB_PORT`, `API_PROXY`, `strictPort`) : permet une deuxième
  pile (tests, base fantôme) à côté de la pile de dev sans se marcher dessus.

- **Validé au navigateur** (mock Discord, base fantôme) : création avec invitation,
  refus sans invitation (client ET serveur), re-connexion par identité connue,
  liaison à un compte mot de passe puis login Discord → bon compte, email déjà pris →
  refus explicite, déliaison (identité redevient inconnue), state falsifié/absent →
  `state_mismatch`, annulation Discord → `cancelled`.

- **Amendement (revue sécurité)** : `/discord/start` est désormais rate-limité
  (10/min) — sa réponse (erreur immédiate vs redirection Discord) révèle si un code
  d'invitation est valide, ce qui en faisait un oracle de brute-force non throttlé
  sur des codes à faible entropie.

## Itération 9 — comparateur de decks (matrice starts × non-engine)

- **Le prérequis §3 de la spec (classification par scénario) était déjà satisfait** :
  le moteur porte `deadFirst`/`deadSecond` par carte et la pertinence de catégorie
  `first | second | both` — aucune migration du modèle de carte n'a été nécessaire.
  La spec supposait un moteur hypergéométrique naïf à trois catégories ; le site
  calcule en réalité des **starts jouables** (couplage maximum, prérequis, HOPT,
  horizon). Le comparateur est donc une couche PURE au-dessus des `PassResult`
  existants (`engine/compare.ts`) : il ne recalcule rien, il normalise `crossMatrix`
  en 4 × 6 à seaux fixes (`≥3`, `5+` = Σ ne ≥ 5) et compare. Libellés « starts »,
  pas « starters », pour coller à la sémantique réelle.

- **§7.4 adapté au moteur réel.** « Les marges lignes ne dépendent que de (S, D, h) »
  n'est vrai que du modèle naïf ; avec combos/prérequis/dead, un même S peut donner
  des profils de starts différents. Le garde-fou compare donc les marges OBSERVÉES :
  égales → note « seule la répartition non-engine bouge » ; différentes à S égal →
  note explicative (combos/prérequis/dead), pas « bug de classification ».

- **Incohérence interne du §11 de la spec, signalée** : le paragraphe « ce que la
  fixture doit démontrer » affirme des marges lignes identiques entre A et B
  (8.3/33.8/39.5/18.3 GF) — contredit par sa propre table d'agrégats (brick 9.2 vs
  8.3, Δ −0.9) : ces marges sont celles de B seul. Les tests reproduisent la table
  d'agrégats (cohérente avec les matrices), à ±0,3 pt après normalisation des
  matrices relevées (leurs sommes font 99,8–100,1 %).

- **Moyennes « plancher » (≥3 = 3, 5+ = 5), pas moyennes exactes** — la spec
  laissait le choix. Motif : l'onglet Synthèse de l'export est entièrement en
  FORMULES pointant sur les matrices (modifier une cellule bleue recalcule tout) ;
  une moyenne exacte serait une constante morte incohérente avec ce modèle. Le
  libellé dit « plancher » partout, écran comme Excel.

- **ExcelJS 4.4.0 confirmé** (styles, formats numériques, mise en forme
  conditionnelle — SheetJS Community n'a pas de styles, heatmap impossible).
  Génération CÔTÉ CLIENT en import dynamique → chunk séparé (~940 kB) chargé au
  premier export seulement. Le classeur réplique `docs/comparatif_mitsurugi.xlsx`
  (géométrie, formules, conventions bleu/noir/vert) ; `fullCalcOnLoad` car aucun
  résultat de formule n'est écrit. Δ de Synthèse colorés par règles `cellIs` PAR
  LIGNE (mérite selon le sens souhaité), pas par échelle de signe.

- **`buildModel` extrait du store → `lib/engineModel.ts`** (le commentaire « prêt
  pour la comparaison §4D » disait vrai) : l'éditeur passe son état Zustand, le
  comparateur assemble la même source depuis `DeckDetail` + bibliothèque API. Le
  worker gagne un mode `passes` (2 passes sans les contributions marginales, qui
  coûtent n+1 énumérations et ne servent qu'à l'éditeur).

- **Garde-fou ajouté hors spec** : horizons d'interaction différents entre les deux
  decks → avertissement (une partie de l'écart non-engine viendrait du réglage, pas
  des cartes). Idem deck < 6 cartes → erreur avant calcul (main de 6 intirable).

- **Validé au navigateur** (Playwright + Edge headless, API mockée, sans base) :
  accueil → dialogue A/B → page (matrices à échelle commune, delta ±2 pts avec
  légende, S/N par scénario, bandeau §7, synthèse mérite — hausse de « 0
  non-engine » peinte en rouge), export .xlsx téléchargé puis relu (openpyxl :
  onglets, formules, somme bloc = 1, valeurs moteur exactes), inversion A/B. La
  fixture E2E reproduit l'asymétrie §3 : handtraps → cartes going-second only fait
  bouger la matrice GF (N passe à 0) en laissant la GS strictement identique.
