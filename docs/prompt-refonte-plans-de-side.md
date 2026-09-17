# Contexte

Testhand calcule les probabilités d'ouverture d'un deck Yu-Gi-Oh!. Pour moi, la partie la
plus intéressante et la plus sous-exploitée de l'appli, ce sont les plans de side (étape 10) :
pour chaque adversaire, en premier et en second, quelles cartes sortent du deck et lesquelles
entrent depuis le side.

L'usage que je veux rendre évident : on annote son deck, puis on essaie des échanges de side,
on voit les statistiques bouger à chaque changement, et on se convainc de ses choix.
Aujourd'hui, l'onglet « Plans de side » sait bien décrire un plan, et la fiche imprimable
(PDF) est réussie. Mais il aide mal à choisir :

- dans l'onglet, le grand panneau Probabilités de droite continue d'afficher le deck de base ;
  le deck sidé n'a que trois indicateurs dans une ligne du bas ;
- on ne voit aucun chiffre avant d'avoir sélectionné, équilibré puis validé un échange, et
  défaire un essai se fait copie par copie ;
- la fiche et le comparateur exigent un deck enregistré, mais leurs boutons grisés ne disent
  pourquoi qu'au survol, invisible au téléphone ;
- l'adversaire et la position choisis sont oubliés au rechargement ; à 360 px, le bouton
  d'échange tombe loin sous la ligne de flottaison.

Ce sont des observations rapides, faites en lisant le code et les captures e2e : vérifie-les.

# Ce que je veux

Que l'éditeur tout entier devienne l'endroit où l'on teste son side, et que chaque essai
donne sa réponse tout de suite.

Ce que j'ai déjà décidé :
- L'adversaire (et sa position) devient un contexte de l'éditeur, comme premier / second
  aujourd'hui. Quand un plan est choisi, les statistiques affichées sont celles du deck sidé
  en cours de test : panneau Probabilités, mode Requête, mur de mains. Le format téléphone
  compte autant que le bureau.
- Aperçu en direct : pendant la sélection, avant de valider, on voit ce que donnerait
  l'échange. Et un écart par carte déclenché par la sélection : une carte à sortir choisie,
  chaque carte du side montre l'effet d'un échange avec elle, et inversement. Mesure le coût
  avant de t'engager ; si c'est trop cher ou peu lisible, dis-le-moi avec les chiffres.
- Un deck sidé respecte les règles officielles : si X cartes sortent, X cartes entrent, et
  le deck reste légal.
- Les échanges avec l'Extra Deck entrent dans les plans, pour que la fiche montre le plan
  complet. Ils n'ont aucun impact sur les statistiques (le moteur ne lit que le main deck).
  Un échange doit rester dans la même zone : une carte du main ne s'échange pas contre une
  carte d'Extra Deck, et inversement (un monstre normal ne va pas dans l'Extra).
- La fiche et le comparateur continuent d'exiger un plan enregistré, mais la raison se voit
  sans survol et l'enregistrement est à portée d'un clic.
- Hors périmètre, pour un chantier futur : les archétypes à la place du nom libre de
  l'adversaire, la pertinence d'une carte selon l'adversaire, la notation des non-engine
  par archétype. Ne prépare rien pour eux au-delà de ne pas leur fermer la porte.

Ce chantier passe après celui des annotations par défaut
(docs/prompt-annotations-par-defaut.md) et avant celui des Mains types
(docs/prompt-mains-types.md), qui se greffera sur le contexte adversaire. Vérifie où en est
le premier dans docs/PLAN.md.

# Où regarder

AGENTS.md, docs/PLAN.md et son dernier compte rendu, docs/etape-10.md (décisions, règles R1–R9,
limites reportées), docs/regles-metier.md (§4–5 et plans de side), docs/design-system.md et
docs/refonte-visuelle.md, docs/audit/02-parcours.md (parcours et téléphone),
docs/decisions-compressees.md. Côté code : `SidePlanner.tsx`, `SideSheet.tsx`,
`lib/sidePlan.ts`, `lib/matchups.ts`, `lib/comparison.ts`, `StatsPanel.tsx`, `EditorPage.tsx`
et le store (`deckStore.ts`).

# Comment je travaille

Pas de code avant ma validation. Commence par un inventaire prouvé et un plan : ce que tu
proposes et pourquoi, tes décisions numérotées D, les questions que tu ne peux pas trancher
seul numérotées Q, et un découpage en parties. Puis arrête-toi et attends mon retour.

Chaque partie validée se clôt comme d'habitude dans ce projet (AGENTS.md et docs/PLAN.md) :
gardes, contrôle par mutation, e2e pour ce qui touche l'interface (les scénarios `side` et
`sidesheet` existent), docs et décisions, commit, tag non poussé.

# Limites

- Toucher au moteur, c'est lire d'abord docs/regles-metier.md §4–5 et docs/cas-reference.md.
  Les oracles, les cas de référence et les valeurs de contrôle historiques ne changent pas
  pour faire passer un test. Les chiffres d'un plan existant ne bougent pas.
- Les plans déjà enregistrés en production doivent rester lisibles et identiques.
- Tout ce qui écrit tourne sur des conteneurs jetables. Rien vers la base de dev, le VPS ni
  Supabase.
- Ne t'arrête pour me demander que si c'est vraiment nécessaire : action destructive ou
  irréversible, changement de périmètre, ou information que moi seul peux donner.

# Compte rendu

Avant d'annoncer qu'une chose est faite, vérifie-la contre un résultat d'outil de la
session ; ce qui n'est pas vérifié est dit comme tel. Pour valider une partie, un
sous-agent qui repart de zéro et confronte le travail au plan vaut mieux qu'une relecture
de ton propre travail. Ton message final est lu par quelqu'un qui n'a pas suivi : le
résultat d'abord, puis ce que tu attends de moi, en phrases complètes et sans abréviations
de travail.
