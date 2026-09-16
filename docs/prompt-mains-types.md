# Contexte

Testhand calcule les probabilités d'ouverture d'un deck Yu-Gi-Oh!. Les joueurs se posent
tout le temps la même question : « combien de mes mains ressemblent à ça ? ». Par exemple :
au moins deux non-engine forts et un starter. Les calculateurs hypergéométriques en ligne y
répondent, mais jamais de façon visuelle et jamais à partir de la vraie decklist. Testhand a
la decklist : il peut répondre avec les cartes elles-mêmes.

Aujourd'hui, le mode Requête répond à une partie de la question, mais sur des groupes
prédéfinis (étiquettes annotées, agrégats starts / non-engine) et sans rien montrer. Pour
viser « Ash Blossom, Fydraulis, Fuwalos ou Ghost Belle », il faut d'abord créer une
étiquette et l'annoter carte par carte. Je veux un outil, « Mains types », où l'on compose
la main que l'on veut voir avec les cartes que l'on veut.

Pour moi, la partie la plus intéressante et la plus sous-exploitée de l'appli, ce sont les
plans de side et les statistiques calculées dessus. Mains types doit s'y greffer : on
annote, puis on teste ses entrées / sorties de side et on voit ce que deviennent ses mains
types. C'est ce qui permet à un joueur de se convaincre de ses choix.

# Ordre des chantiers

Ce chantier passe après deux autres :
1. les annotations par défaut (HOPT, étiquettes, plafonds pré-remplis ;
   docs/prompt-annotations-par-defaut.md) ;
2. une refonte des plans de side, pour centrer leur usage sur les statistiques.

Vérifie où ils en sont (docs/PLAN.md et comptes rendus). Si ce sur quoi tu dois t'appuyer
n'est pas livré, dis-le-moi avant de planifier.

# Ce que je veux

L'idée de départ : on voit une main de 5 cartes, 5 slots vides, « n'importe quoi » par
défaut. On clique un slot et on choisit les cartes qui peuvent l'occuper : ça forme un
groupe, et une probabilité s'affiche. On peut étendre ce groupe à un autre slot (« au moins
deux cartes de ce groupe »). On peut remplir d'autres slots avec d'autres groupes, des
starters par exemple. Le calcul suit.

Ce que j'ai décidé :
- Mains types vit dans le moteur, avec la même exigence d'exactitude que le reste. Un
  chiffre n'est jamais une estimation.
- Un slot veut dire « au moins » : une main avec 3 non-engine valide une main type qui en
  demande 2.
- Slots d'exclusion : « aucune carte de ce groupe ».
- Plusieurs mains types combinées par OU (un « + » pour ajouter une main). On le prévoit
  dès le départ, pas après coup.
- Par défaut, une copie en main ne remplit qu'un slot, même si sa carte est dans deux
  groupes. Une case « groupes indépendants » lève cette règle.
- Option par groupe « respecter les limites d'activation par tour » : une identité HOPT ne
  compte qu'une fois (2 Ash valent 1, 2 Fuwalos valent 2), un plafond partagé borne ses
  membres. On s'appuie sur les annotations du compte, sans les fenêtres de tour des profils :
  l'outil doit rester lisible.
- La 6ᵉ carte en second doit être personnalisable. On doit pouvoir dire si un groupe
  accepte d'être rempli par la carte piochée (une handtrap piochée arrive trop tard, un
  starter non), et y poser un groupe ou une exclusion (« la pioche n'est pas une brique »).
  Premier et second s'affichent côte à côte.
- Ça fonctionne sur le deck et sur les plans de side : même main type, deck de base contre
  deck sidé.
- Ce qui rend l'outil visuel fait partie du livrable : le chiffre qui évolue à chaque slot
  rempli (on voit ce que coûte chaque exigence), « 1 main sur N » à côté du pourcentage,
  des exemples de mains tirées qui correspondent, et un ajout rapide des cartes d'une
  étiquette au groupe (on retire ensuite ce qu'on ne veut pas).
- Mains types et mode Requête coexistent. Mains types absorbera sans doute les requêtes un
  jour, pas dans ce chantier.
- Pas de paywall pour l'instant.

# Où regarder

AGENTS.md, docs/PLAN.md et son dernier compte rendu, docs/regles-metier.md (§4–5, mode
Requête, contexte premier / second et sixième carte), docs/cas-reference.md,
docs/etape-10.md (plans de side, fiche, comparateur sidé), docs/design-system.md et
docs/refonte-visuelle.md, docs/decisions-compressees.md. Côté code : le mode Requête
(`web/src/engine/query.ts`, `QueryMode.tsx`), le mur de mains (`HandWall.tsx`,
`engine/hand.ts`), l'énumération (`engine/enumerate.ts`, qui sépare déjà l'identité de la
sixième carte en second) et `lib/sidePlan.ts`.

# Comment je travaille

Pas de code avant ma validation. Commence par un inventaire prouvé et un plan : le sens
exact d'une main type (à écrire dans le contrat métier avant tout calcul), ce que tu
proposes et pourquoi, tes décisions numérotées D, les questions que tu ne peux pas trancher
seul numérotées Q, et un découpage en parties. Puis arrête-toi et attends mon retour. Mesure
le coût du calcul sur des cas réalistes (plusieurs mains types, groupes d'une vingtaine de
cartes, en second, sur un plan de side) avant de choisir une approche.

Chaque partie validée se clôt comme d'habitude dans ce projet (AGENTS.md et docs/PLAN.md) :
gardes, contrôle par mutation, e2e pour ce qui touche l'interface, docs et décisions,
commit, tag non poussé.

# Limites

- Toucher au moteur, c'est lire d'abord docs/regles-metier.md §4–5 et docs/cas-reference.md.
  Les oracles existants, les cas de référence et les valeurs de contrôle historiques ne
  changent pas pour faire passer un test. Les chiffres existants (starts, non-engine,
  requêtes, plans de side) ne bougent pas : c'est un ajout.
- Tout ce qui écrit tourne sur des conteneurs jetables. Rien vers la base de dev, le VPS ni
  Supabase.
- Ne t'arrête pour me demander que si c'est vraiment nécessaire : action destructive ou
  irréversible, changement de périmètre, ou information que moi seul peux donner.

# Compte rendu

Avant d'annoncer qu'une chose est faite, vérifie-la contre un résultat d'outil de la
session ; ce qui n'est pas vérifié est dit comme tel. Pour valider une partie, un
sous-agent qui repart de zéro et confronte le travail au contrat vaut mieux qu'une relecture
de ton propre travail. Ton message final est lu par quelqu'un qui n'a pas suivi : le
résultat d'abord, puis ce que tu attends de moi, en phrases complètes et sans abréviations
de travail.
