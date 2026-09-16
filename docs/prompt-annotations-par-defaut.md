# Contexte

Testhand calcule les probabilités d'ouverture d'un deck Yu-Gi-Oh!. Je veux le vendre comme
un outil clé en main : un joueur arrive, importe son deck et lit tout de suite des chiffres
justes. Ce n'est pas le cas aujourd'hui. Plusieurs annotations dont dépend le moteur sont
vides par défaut et propres à chaque compte : le HOPT (une identité de carte ne contribue
qu'une fois par tour), les étiquettes non-engine et les plafonds partagés (onglet
« Combos & catégories »). Tant que le joueur ne les a pas posées à la main, ses
pourcentages sont gonflés et rien ne le lui signale. C'est lourd pour un habitué et
rédhibitoire pour un nouveau venu.

# Ce que je veux

Qu'un utilisateur de base trouve ces annotations déjà remplies, et justes, pour les cartes
qu'il joue, sans jamais pouvoir fausser celles des autres.

Ce que j'ai déjà décidé :
- Les valeurs par défaut viennent de deux sources : une détection automatique à partir du
  texte des cartes (`cards.description`, en anglais) et un référent qui corrige ou complète.
  Le choix d'un utilisateur ne vaut que pour son compte et prime sur le défaut.
- Référent est un vrai rôle attribuable. L'attribution se fera dans un back office que je
  construis dans un autre workspace : pas d'écran d'attribution ici, mais ce dépôt doit
  savoir qu'un compte est référent. Au début, le seul référent, c'est moi.
- Les `is_hopt = true` existants deviennent des choix explicites (seuls deux comptes de
  confiance en ont posé).
- Étiquettes et plafonds sont pré-remplis eux aussi, pas seulement le HOPT : le but est de
  réduire les choix laissés à l'utilisateur.

Le texte des cartes nomme la limite, ce qui distingue une limite par nom d'une limite par
exemplaire. Par exemple : « You can only use each effect of "Girsu, the Orcust Mekk-Knight"
once per turn. », « You can only use this effect of "…" once per turn. », « You can only use
1 of the following effects of "…" per turn. », ou une limite de groupe comme celle des
Mulcharmy. Un « Once per turn » sans « You can only » limite l'exemplaire, pas le nom.

Un premier sondage à la regex grossière, à ne pas prendre pour acquis : 14 529 cartes, de
l'ordre de 5 000 à formulation nette par nom, 1 800 « once per turn » sans nom, 278
« You can only Special Summon "X" once per turn » dont le sens dépend du rôle de la carte.
Une regex naïve rate déjà Maxx "C" (guillemets imbriqués). Le catalogue n'a pas de colonne
archétype.

# Où regarder

AGENTS.md, docs/PLAN.md et son dernier compte rendu, docs/regles-metier.md (« Copies, HOPT
et plafonds », §4–5), docs/decisions-compressees.md, server/AGENTS.md. docs/audit/, surtout
02-parcours.md, décrit le parcours d'un nouvel utilisateur. Le couple étiquette / profil a
déjà été jugé bancal (une carte n'est non-engine qu'avec un profil ET une étiquette) et son
réexamen avait été reporté : ce chantier le rouvre probablement. Donne-moi ton avis plutôt
que de le contourner.

# Comment je travaille

Pas de code avant ma validation. Commence par un inventaire prouvé et un plan : ce que tu
proposes et pourquoi, tes décisions numérotées D, les questions que tu ne peux pas trancher
seul numérotées Q, et un découpage en parties si c'est gros. Puis arrête-toi et attends mon
retour. Mesure la détection sur le vrai catalogue avant de choisir une approche : je veux
sa couverture et ses erreurs sur des cartes réellement jouées, pas sur des exemples choisis.

Chaque partie validée se clôt comme d'habitude dans ce projet (AGENTS.md et docs/PLAN.md) :
gardes, contrôle par mutation, docs et décisions, commit, tag non poussé.

# Limites

- Le moteur (`web/src/engine`), les oracles, les cas de référence et les valeurs de contrôle
  historiques ne changent pas pour faire passer un test.
- La base de dev est en lecture seule, pour l'inventaire. Tout ce qui écrit tourne sur des
  conteneurs jetables. Rien vers le VPS ni Supabase.
- Les chiffres des decks existants vont bouger. Ce changement doit être visible et assumé,
  et aucun cache ne doit afficher un chiffre calculé avec d'anciennes annotations.
- Ne t'arrête pour me demander que si c'est vraiment nécessaire : action destructive ou
  irréversible, changement de périmètre, ou information que moi seul peux donner.

# Compte rendu

Avant d'annoncer qu'une chose est faite, vérifie-la contre un résultat d'outil de la
session ; ce qui n'est pas vérifié est dit comme tel. Pour valider une partie, un
sous-agent qui repart de zéro et confronte le travail au plan vaut mieux qu'une relecture
de ton propre travail. Ton message final est lu par quelqu'un qui n'a pas suivi : le
résultat d'abord, puis ce que tu attends de moi, en phrases complètes et sans abréviations
de travail.
