# Contrat métier — première mission

Statut : règles cibles du plan révisé accepté par l'utilisateur, formalisées à
l'étape 1 le 7 septembre 2026. **Leur formalisation ne signifie pas que
l'application les implémente déjà.** Les écarts et preuves exécutables sont dans
[les cas de référence](cas-reference.md). Ce document prime sur les descriptions
historiques pour la cible de cette mission ; les anciens documents restent utiles
pour comprendre le fonctionnement actuel.

Avancement : [étapes 2 et 3 livrées](etapes-2-3.md), avec migration additive testée
en base jetable ; [étape 4 livrée](etape-4.md) : recalcul versionné, invalidation
immédiate, annulation, état périmé visible. La purge reste à l’étape 8.
[Étape 5, partie A livrée](etape-5a.md) : le moteur implémente la chronologie
premier/second avec sixième identifiée, les profils, les plafonds partagés et les
conditions ET/OU, vérifiés par oracle d’énumération et oracle Monte Carlo ; la
persistance, l’interface et la migration des annotations historiques relèvent de la
partie B. [Partie B livrée](etape-5b.md) : profils, plafonds et conditions ET/OU en
base et dans l’interface (migration additive 002), contexte d’analyse unique, cartes
étiquetées sans profil signalées et non comptées, « départs théoriques » partout.

La stack est conservée. Les notations des tests sont indépendantes du futur
schéma SQL et des interfaces du moteur. Aucun moteur de résolution de cartes ou
de lignes de jeu n'est introduit à cette étape.

## 1. Portée des annotations et enregistrement

| Objet | Portée cible | Règle |
| --- | --- | --- |
| Catalogue et identité d'une carte | Catalogue existant | Une identité stable, plusieurs copies physiques ; aucun rôle déduit du nom ou du texte |
| Composition main / extra / side | Deck | Import et création manuelle alimentent le même modèle |
| Catégories non-engine et affectations | Compte, communes à ses decks | Manuelles ; plusieurs catégories par carte possibles |
| Profil de disponibilité non-engine, HOPT et limites partagées | Compte | Annotations manuelles, réutilisées entre decks |
| Starter une carte et conditions de ce rôle | Deck | Indépendants du rôle non-engine |
| Paire de deux cartes et conditions de cette paire | Deck | Définition manuelle et conservation permanente après enregistrement |
| Résultat statistique | Dérivé d'une version du deck et des annotations | Une ancienne synthèse ne doit pas devenir une vérité persistante |

« Global » signifie commun aux decks **du même compte**, pas partagé entre tous
les utilisateurs. L'étiquette engine n'est pas nécessaire au calcul : une carte
peut être starter, membre d'une paire, non-engine, plusieurs de ces rôles ou aucun.
Une absence d'annotation n'est pas une déclaration de carte inutile.

Cliquer deux cartes prépare une paire dans le deck en cours. L'action
**Enregistrer** conserve explicitement la configuration ; elle ne publie plus de
paire dans une bibliothèque globale. Un brouillon restaurable reste distinct de
cet enregistrement. Dupliquer un deck doit copier ses paires et conditions.
Une paire A+B est la même que B+A. Les paires A+A ne font pas partie de cette
mission, conformément au graphe actuel. Une paire dont un membre n'est pas dans
le main deck ne peut produire aucun start ; l'interface doit signaler la référence
inactive plutôt que supprimer silencieusement la définition.

Les sources « starter une carte » et « paire » devront pouvoir être référencées
de façon stable par de futures lignes de combo. Le choix des tables et des
identifiants relève de l'étape 3.

## 2. Decks et tirages

Le deck analysé est le **main deck uniquement**. Extra et side sont enregistrés
mais ne participent ni au numérateur, ni au dénominateur, ni aux conditions de
présence en deck de cette mission.

Le constructeur reste libre : enregistrer un deck vide ou incomplet est possible.
Le repère 40–60 cartes donne un avertissement, sans imposer une légalité de format.
Les entrées sont des identités de carte et des quantités entières ; la convention
actuelle de 1 à 3 copies par carte et par zone est conservée, sans ajouter une
banlist ou une validation interzones. Zéro signifie retirer l'entrée.
Les doublons de lignes désignent des copies de la même carte, pas deux identités.
Une quantité invalide ou un cumul hors convention doit être signalé avant
enregistrement, sans arrondi ni réduction silencieuse.

Un import partiellement reconnu doit présenter les lignes/cartes ignorées et
permettre une décision explicite avant de conserver le résultat partiel. Une
carte inconnue ne doit pas être transformée silencieusement en carte neutre.
La recherche du constructeur utilise le catalogue existant. L'ordre d'affichage
des cartes n'a aucun effet sur les probabilités d'un deck mélangé.

Pour un scénario demandant h cartes, D < h signifie **analyse indisponible**,
jamais « 100 % de mains jouables », ni une main raccourcie à D cartes. Un deck de
5 cartes autorise donc le premier, pas le second. Un deck inhabituellement grand
ne justifie pas un résultat tronqué ou une simulation non annoncée. La limite
pratique de coût exact reste à déterminer par mesure lors du travail sur les
calculs ; aucune nouvelle borne arbitraire n'est fixée ici.

## 3. Premier / second et chronologie

| Contexte | Cartes observées | Starts évalués | Fenêtres non-engine observées |
| --- | --- | --- | --- |
| Premier | Les 5 cartes initiales | Sur ces 5 cartes, pour son premier tour | Le premier tour adverse qui suit |
| Second | Les 5 cartes initiales **et** une sixième pioche identifiée | Sur les 6 cartes, pour son premier tour | Le premier tour adverse, puis son propre premier tour |

Les cartes ne sont pas retirées de la main théorique après une activation
supposée. Aucune interaction adverse, pioche supplémentaire, condition de terrain
ou dépense de ressource n'est simulée. Les deux axes d'une matrice décrivent des
potentiels de la main ; leur présence conjointe ne prouve pas qu'on peut les
réaliser tous au cours d'une même ligne.

Le choix premier/second devient un contexte d'analyse explicite, commun à la
matrice, aux deltas, aux filtres et au mur de mains. Formulation cible :
« Premier · 5 cartes » / « Second · 5 cartes + pioche » ; la sixième reste
visuellement identifiable. Les vues comparatives peuvent présenter les deux
contextes en les nommant. Les anciens horizons numériques réglables 1–3 ne
définissent plus la chronologie métier.

### Profils non-engine

Les catégories sont des étiquettes manuelles. Un **profil de disponibilité par
carte** détermine les fenêtres, sans additionner des profils au gré des étiquettes.
Les intitulés ci-dessous décrivent une valeur statistique choisie par l'utilisateur,
pas une classification automatique de toutes les cartes de ce type.

| Profil | Premier, carte initiale | Second, carte initiale | Second, sixième carte |
| --- | --- | --- | --- |
| Précoce, type Mulcharmy | Aucune fenêtre retenue | Tour adverse initial | Aucune fenêtre retenue |
| Flexible, type handtrap | Tour adverse suivant | Tour adverse initial ou son propre tour | Son propre tour |
| Préparé, type magie rapide | Tour adverse suivant, après préparation | Son propre tour | Son propre tour |
| Board breaker | Aucune fenêtre retenue | Son propre tour | Son propre tour |

Le profil préparé distingue une magie rapide qu'il faut préalablement poser pour
l'utiliser pendant le tour adverse d'une carte flexible utilisable depuis la main.
Il ne prétend pas représenter toutes les exceptions de texte. Le profil board
breaker exprime l'utilité retenue en second ; il n'interdit pas juridiquement
l'activation d'une carte en premier.

Une Fuwalos en sixième carte reste **une carte non-engine piochée**, mais apporte
zéro contribution dans la fenêtre précoce retenue. Elle n'est pas déclarée morte
pour toute la partie. Les profils n'évaluent ni la force d'un effet ni son succès.

### Copies, HOPT et plafonds

On distingue le nombre de **copies brutes piochées** du **potentiel non-engine U** :
nombre maximum de copies distinctes que l'on peut affecter aux fenêtres autorisées,
en respectant les plafonds déclarés.

- Une copie physique contribue au plus une fois, même si elle a deux fenêtres.
- Le HOPT limite une même identité de carte à une contribution par tour. Une
  flexible HOPT en un exemplaire vaut au plus 1 ; deux exemplaires peuvent valoir
  2 en second, dont un sur chaque tour, mais au plus 1 en premier.
- Une limite de groupe est partagée par ses membres sur chaque tour. Elle est
  distincte d'un HOPT individuel. Par exemple, un groupe Mulcharmy limité à 2
  effets par tour ne signifie pas automatiquement « une seule copie par nom ».
- Les cartes sans HOPT conservent la possibilité de plusieurs contributions par
  tour, sous réserve des éventuelles limites de groupe.
- Une union de catégories déduplique les copies avant le calcul. Pour un
  sous-ensemble de catégories, on mesure son propre potentiel sous les mêmes
  plafonds. Additionner les résultats des catégories peut dépasser celui de leur
  union : ce ne sont pas des contributions réparties arbitrairement entre labels.

Deux critères portant sur des catégories mesurent chacun ce potentiel ; leur
conjonction ne promet pas une affectation commune de toutes ces contributions.
C'est la même limite d'interprétation que pour le cumul starter/non-engine.
Les configurations historiques contradictoires devront être identifiées à la
migration : pas de priorité implicite entre anciens labels pour choisir un profil.

Points de contrôle externes : le
[livret officiel, version 10](https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf)
décrit la main initiale, l'absence de pioche au premier tour du premier joueur et
l'utilisation des magies rapides. Le
[texte officiel de Fuwalos](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=20500&ope=2&request_locale=en)
permet un autre effet de monstre Mulcharmy dans le tour, d'où l'exemple de plafond
familial de 2. Sources consultées lors de l'audit du 7 septembre 2026. Ces textes
servent à vérifier les exemples, pas à automatiser les annotations.

## 4. Starts théoriques et conditions

Un start est une source configurée dans le deck, disponible dans la main observée :
starter une carte ou paire de cartes distinctes. On conserve la convention
structurelle actuelle :

1. Chaque copie en main fournit un sommet, ramené à un seul par identité HOPT.
2. Chaque sommet starter actif fournit un start ; ces sommets sont retirés du
   calcul des paires supplémentaires.
3. Parmi les sommets restants, prendre le nombre maximum de paires disjointes.
4. La somme est S, le nombre de **starts théoriques**, sans preuve de lignes
   successivement réalisables.

La redondance R est le nombre de liens de paire présents sur tous les sommets,
starters inclus, après application des conditions et des disponibilités. Elle
peut dépasser S. A+B et B+C dans A,B,C donnent S=1, R=2. Les déclarations dupliquées
d'une paire ne créent pas de lien supplémentaire. Sans HOPT, A,A,B,B avec A+B
donne S=2, R=4 (quatre couples de copies physiques).

Une condition s'attache à une **source de start**, pas à tous les rôles de la carte.
L'échec d'une condition starter n'empêche pas cette carte d'être non-engine ou de
participer à une autre paire dont la condition est satisfaite. Les désactivations
de starts par position restent distinctes des profils non-engine.

La primitive actuelle étendue est « il reste au moins q copies de X dans le main
deck **après le tirage observé** », q entier ≥1. En premier, on retire les 5 cartes ;
en second, les 5 et la sixième. La présence de X seulement dans l'extra, le side ou
la main ne satisfait pas cette primitive.

On doit pouvoir composer des groupes **ET / OU**, par exemple
`B ≥ 1 ET (C ≥ 1 OU D ≥ 1)`. Plusieurs alternatives vraies n'ajoutent pas de start.
Les cibles ne sont pas consommées : deux starters peuvent exiger la même dernière
copie en deck et compter chacun. Répéter `B ≥ 1` ne devient pas `B ≥ 2`.
Une source sans condition est inconditionnelle ; un groupe explicitement vide
est une configuration incomplète, à signaler. Un opérateur inconnu ou une quantité
invalide ne doit pas devenir silencieusement vrai.

Présence en main générale, GY, terrain, ordre d'actions, substituts consommables et
incompatibilités de résolution restent hors périmètre. Les alternatives actuelles
portent sur des présences résiduelles, sans prétendre être un moteur de substituts.

## 5. Définitions mathématiques des statistiques

### Espace des tirages

D est le nombre de copies physiques du main deck ; nᵢ la quantité de l'identité i ;
kᵢ sa quantité dans la main initiale. Les copies sont équiprobables, les tirages
sont sans remise. Les annotations ne modifient jamais ces chances.

- Premier : Z = C(D,5). Une composition k a un poids entier
  `w(k) = produit C(nᵢ,kᵢ)`, pour `somme kᵢ = 5`.
- Second : Z = C(D,5) × (D−5). Une issue est la paire (composition initiale k,
  identité j de la sixième carte). Son poids est
  `w(k,j) = produit C(nᵢ,kᵢ) × (nⱼ−kⱼ)`.
- Les copies neutres peuvent être regroupées en filler de quantité F : facteur
  `C(F, 5−somme kᵢ)` si seuls les types annotés sont énumérés. Une cible de condition
  doit rester identifiable ; elle ne peut pas disparaître dans ce regroupement.

Sans dépendance à la chronologie, on retrouve C(D,6) : chaque ensemble de six copies
a six choix de carte piochée en dernier et `C(D,5)(D−5) = 6 C(D,6)`. Si la valeur
dépend de cette dernière carte, il faut conserver cette distinction.

Pour chaque événement E, `P(E) = somme des poids des issues satisfaisant E / Z`.
Une issue n'est comptée qu'une fois, même si plusieurs combos ou alternatives
satisfont l'événement. Aucune indépendance entre starts et non-engine n'est
supposée. Une hypergéométrique en trois catégories disjointes ne convient pas au
cas général des rôles superposés et des paires.

### Indicateurs et arrondis

Les distributions sont calculées exactement par dénombrement, sans Monte-Carlo.
Le moteur actuel utilise des nombres flottants pour normaliser les poids ;
l'oracle utilise des dénombrements entiers et des fractions vérifiables.
Les mains du mur sont, elles, des exemples échantillonnés : leur fréquence ne
remplace pas les probabilités exactes.

| Indicateur | Définition / numérateur avant division par Z |
| --- | --- |
| P(S=s), starts 0 / 1 / 2 / ≥3 | Poids des issues de S exact, puis somme des s≥3 pour le dernier seau |
| Brick starters | P(S=0), pas probabilité d'une défaite ou d'une main globalement inutile |
| E[S], E[R], E[U] | Somme `w × valeur` ; moyennes exactes avant regroupement |
| Redondance | Distribution du nombre R de liens, sans assimiler ces liens à des lignes indépendantes |
| Copies brutes d'une catégorie | Distribution de copies piochées portant le label, sans plafond HOPT et sans perte de la sixième |
| Potentiel total non-engine | Distribution de U, fenêtres et plafonds appliqués, union des labels dédupliquée |
| Potentiel d'une catégorie ou union | Même définition de U restreinte aux copies portant au moins un label sélectionné |
| Matrice | Poids des issues où `min(S,3)=ligne` et `min(U,5)=colonne` ; 5 est noté 5+ en second |
| Requête | Poids des issues satisfaisant tous les intervalles inclusifs ; bornes absentes non limitées |
| Delta d'une copie | `P_base(S≥1) − P_remplacement(S≥1)` ; copie remplacée par une neutre, D constant, conditions reconstruites |
| Note /10 d'une main | `arrondi(10 × (poids strictement inférieur + poids égal / 2) / Z)` |

Les catégories brutes restent visibles comme telles et ne doivent pas porter le
même libellé que le potentiel utilisé dans les requêtes. Un filtre sans critère
vaut 100 % sur un espace valide. Un intervalle inversé est invalide, pas zéro ni
100 %. Un groupe de catégories vide compte zéro. Filtrer le mur ne change pas
le dénominateur de la probabilité annoncée : il reste le deck entier du scénario.

Pour la note, le classement est starts en priorité, non-engine en départage si
l'option est activée. Désactivée, seules les starts départagent. C'est la sémantique
de l'actuel score `100 × S + importance × U` dans ses bornes, avec une présentation
plus explicite prévue ensuite. La note est relative à ce deck et ce scénario,
pas une probabilité de victoire ni un classement absolu entre decks. Les égalités
utilisent le milieu de leur masse ; 7,5 s'arrondit à 8, sans erreur de flottant.

Les pourcentages sont arrondis au plus proche au centième ; cellules de matrice et
comparateur au dixième selon leur affichage actuel, valeurs fines accessibles.
Les moyennes suivent la précision de leur libellé. Aucun arrondi intermédiaire
avant agrégation, delta ou notation. La somme des valeurs affichées peut différer
de 100 % à cause de l'arrondi ; la somme sous-jacente doit valoir 1 à la tolérance
numérique près. Un symbole pour une faible probabilité ne doit pas signifier zéro :
depuis l'étape 7, « · » dans une matrice, une matrice de delta ou la synthèse du
comparateur signifie **zéro exact** ; une valeur non nulle qui s'arrondit à zéro s'affiche
« 0.0 » (ou « +0.0 » / « −0.0 » pour un delta), comme dans les formats de nombre de
l'export Excel, et la valeur fine reste accessible dans l'infobulle. La couleur d'un
delta de synthèse suit le signe du delta exact selon la direction de l'indicateur, neutre
seulement pour le zéro exact.

### Comparateur

Les matrices A/B conservent leurs seaux communs 4×6 et leur disposition côte à côte,
y compris sur mobile. Disposition validée à l'étape 7 (partie B) aux largeurs du §6 :
sous 640 px, A et B occupent chacune une colonne d'une grille de deux colonnes, avec des
cellules compactes (police 9 px, 20 px minimum par colonne, aucun défilement interne) et
la matrice Δ en dessous sur toute la largeur avec sa légende ; à partir de 640 px, les
trois cartes gardent leur largeur naturelle sur une ligne (Δ passe seule à la ligne
suivante à 768 px). L'échelle de couleur reste commune à A et B, la ligne « deck, S, N »
reste sous chaque matrice. Le repli en bande à défilement confiné n'a pas été nécessaire.
Les deltas sont **B−A**, en points de pourcentage pour une probabilité ; ils sont
distincts du delta marginal d'une carte. Les calculs utilisent les valeurs non
arrondies, avec des échelles visuelles comparables.

Les douze agrégats existants sont définis par : P(S=0), P(S≥1), P(S≥2), P(S≥3),
P(U=0), P(U≥1), P(U≥2), P(U≥3), P(S≥1 ET U≥1), P(S≥2 ET U≥2), E[min(S,3)] et
E[min(U,5)]. Les deux dernières moyennes sont des **planchers**, à nommer comme
tels ; elles ne remplacent pas E[S] et E[U]. Les expressions historiques
« zone jouable » et « main forte » désignent ces seuils, sans garantir de ligne.
Les quantités annotées affichées sous une matrice décrivent la composition du deck,
pas le nombre d'activations promises.

## 6. Contrats transversaux à réaliser après l'étape 1

### Recalcul et sauvegarde

Toute modification invalide immédiatement la version statistique, dès avant le
délai de regroupement des changements. Les dernières statistiques restent visibles
avec leur contexte antérieur, atténuées et accompagnées d'un état « Recalcul… ».
Les contrôles restent utilisables. Une réponse n'est adoptée que si sa version est
encore celle demandée ; un calcul périmé est annulé si possible et ses ressources
sont libérées. Une erreur conserve un ancien résultat explicitement obsolète et
permet une relance. Sans résultat précédent, afficher un état initial de calcul.
Éviter tout mélange d'anciennes statistiques avec de nouveaux labels ou un nouveau
deck. Une sauvegarde terminée ne doit pas effacer le statut modifié d'une édition
plus récente. Les tests de ces contrats relèvent des étapes 3 et 4.

### Largeurs et cibles tactiles (étape 6, partie B)

L'interface est validée au navigateur sur bureau et aux largeurs **360 px** (petit
téléphone), **390 px** (téléphone courant) et **768 px** (tablette portrait, sous le point
de rupture de 1024 px où le panneau de statistiques devient un onglet). À ces largeurs,
aucune barre ne déborde horizontalement, les actions et sélections restent utilisables,
et les cibles tactiles mesurent **32 px** pour le stepper de copies, le menu ⋯ d'une
tuile ou d'un deck et les actions primaires (Enregistrer, Nouveau deck, Importer,
Terminer un mode, fermer un dialogue), **24 px minimum avec espacement** ailleurs
(WCAG 2.5.8). Les raccourcis clavier affichés sur tactile restent tels quels.

Comparateur et mur de mains (étape 7, partie B, mêmes largeurs plus 1440 px en
non-régression) : l'en-tête du comparateur passe ses actions à la ligne sous 400 px sans
couper leurs libellés, les noms A / B se tronquent en dernier ; **32 px** aussi pour
Exporter Excel, ⇄ Inverser A/B, le bouton Comparer et le ✕ du dialogue « Comparer deux
decks » ; la synthèse défile dans son propre conteneur, jamais le corps de page ; les
avertissements passent à la ligne. Dans le mur de mains, une ligne de main garde ses
cartes entières et non déformées (ratio 59/86) : sous 640 px (étape 9A), les cartes
mesurent 60 px de haut et le récapitulatif compact « S n / U n » avec la note reste à droite
des cartes sur la même ligne (ligne ≤ 80 px, huit mains par écran) ; dès 640 px, cartes de
68 px et récapitulatif complet départs / non-engine / note. « ↻ Nouvelles mains », action
primaire du mur, mesure **32 px** ; les autres commandes de la barre (contexte, n, filtre,
tri) au moins 24 px ; la sixième carte reste marquée « 6ᵉ » et l'état périmé reste annoncé.
La matrice Δ, en pleine largeur sous 640 px, garde ses cellules de 10 px et 32 px à toute
largeur (jamais compactes). L'éditeur de condition ET/OU (Inventaire, combos) rend un arbre
plus profond que « ET de clauses, OU de feuilles » par encadrés imbriqués qui passent à la
ligne sans débordement à 360 px ; ses sélecteurs, son champ « ≥ n » et son ✕ mesurent au
moins 24 px. La grille d'annotation garde des tuiles de 96 px minimum (9 colonnes à 1440 px,
3 à 360 px) : une tuile plus étroite couperait le delta. Ces règles sont gardées par les
scénarios `mobile`, `guards` et `conditions` de `web/e2e/`.

Aperçus de l'accueil (étape 9A) : `decks.summary` est un cache d'affichage recalculé à chaque
enregistrement à partir du résultat courant, seulement s'il est celui de la version demandée ;
un résumé absent, malformé ou calculé par une autre version du moteur (empreinte des sources du
calcul, injectée au build) est recalculé à la demande par l'accueil, avec le moteur courant,
puis persisté pour la révision lue ; il n'est jamais affiché tel quel. Les valeurs affichées
sont celles du panneau (P(≥1 départ) et brick, premier · 5 cartes), arrondies au rendu, la
valeur fine restant dans l'infobulle. Gardé par le scénario `home` de `web/e2e/`.

Vue et mode combiné (étape 9B) : la vue du panneau de statistiques est un réglage transitoire,
comme le contexte premier / second — jamais enregistrée, changer de vue ne marque pas le deck
« non enregistré » ; le curseur d'importance reste un paramètre enregistré. Le mode Non-engine
pose une étiquette et, si un profil est choisi, ce profil (l'étiquette d'abord, le serveur
exigeant une étiquette avant un profil) ; sur une carte déjà conforme au couple, le clic retire
l'étiquette puis, s'il ne reste aucune étiquette, le profil devenu orphelin. La tuile annonce
l'effet du prochain clic. Gardé par le scénario `nonengine` de `web/e2e/` (chaque clic vérifié
par l'API).

Extra et side (étape 9C) : les deux zones sont éditables dans l'éditeur (ajout, copies, retrait
avec annulation dans la même zone) et enregistrées avec le main dans la même configuration ;
elles n'entrent jamais dans le modèle moteur (§2) : une modification d'extra ou de side marque le
deck « non enregistré » **sans recalcul**, le résultat courant et l'aperçu joint à
l'enregistrement restent valables. La convention de 1 à 3 copies s'applique par carte **et par
zone** (une carte peut être en main et en side) ; au-delà de 15 cartes en extra ou en side,
l'interface avertit sans refuser, aucun repère bas. Les tuiles de ces zones mesurent 80 px
minimum (image et stepper de copies à 32 px, aucune annotation), « + Ajouter » 32 px. Gardé par
`store/zones.test.ts`, l'équivalence création / YDK / JSON v2 sur les trois zones et le scénario
`extraside` de `web/e2e/`.

### Suppression ciblée, à préparer dans /deploy

La remise à zéro des anciennes paires concerne les `combo_pairs` du périmètre de
comptes explicitement retenu, leurs notes, leurs `deck_pair_exclusions` et les
`deck_start_requirements` dont la **source est une paire supprimée**. Les conditions
de source carte, les starters, les catégories et leurs affectations, les decks et
le catalogue doivent être conservés. Les caches, résumés et brouillons liés à
l'ancien modèle doivent être invalidés ou versionnés ; un ancien import JSON ne
doit pas réintroduire les paires globales sans traitement explicite.

La liste des identifiants et les effectifs devront être produits par une simulation
sur chaque base cible, avant suppression. Sauvegarde, transaction, vérification
après migration, relance contrôlée et restauration doivent être documentées et
testées avec les scripts de déploiement. **Aucune purge ni migration n'est exécutée
à l'étape 1 ; l'accès à la base locale n'a pas permis d'en inventorier les lignes.**

## 7. Limites et feuille de route

La mission actuelle livre une analyse statique et chronologique de mains non
résolues. Les lignes de combo, interruptions, réponses aux handtraps, chemins
alternatifs, ressources consommées, terrain/GY et plans de side/statistiques après
side viendront ensuite. Stocker le side maintenant ne signifie pas le simuler.

La représentation de conditions doit pouvoir évoluer et signaler une version ou
un opérateur non supporté ; cela ne justifie pas de construire dès maintenant un
moteur général. Restent à choisir lors des étapes prévues : organisation ergonomique
précise des groupes ET/OU, stratégie de calcul et d'annulation, schéma de
persistance, traitement explicite des anciennes annotations ambiguës et limite de
coût des très grands decks. Toute découverte modifiant les règles ci-dessus devra
être annoncée avant de les changer.

## 8. Plans de side (étape 10)

Source : docs/etape-10.md (décisions D1–D18, règles R1–R9). Un **adversaire** porte deux volets,
premier et second ; un **plan** est deux listes agrégées, sans appariement : copies qui quittent le
main, copies qui entrent depuis le side.

- **Structure contre cohérence.** Le contrat de configuration valide la structure d'un plan (copies
  1–3, carte non répétée dans une liste, jamais entrante et sortante à la fois, une position au plus
  par adversaire, 32 adversaires au plus). Il ne valide **ni** l'appartenance des cartes à leur zone,
  **ni** l'équilibre des listes, **ni** la convention 1–3 du main dérivé : un plan devenu incohérent
  reste enregistrable.
- **États d'un plan.** *Prêt* : cartes dans leur zone, listes équilibrées, main dérivé conforme.
  *Incomplet* : listes déséquilibrées (une retouche l'a produit). *À revoir* : une carte a quitté sa
  zone, ou le main dérivé dépasserait 3 exemplaires ; prime sur *incomplet*. Seul un plan prêt est
  analysé ou imprimé ; un plan vide est prêt et vaut le deck de base.
- **Échange.** N'accepte qu'une sélection équilibrée ; refusé s'il ferait entrer et sortir la même
  carte, ou s'il **crée** un écart avec les zones (un écart déjà présent ne bloque pas un échange qui
  ne l'aggrave pas). Retirer une copie d'un plan ne rééquilibre jamais rien en silence.
- **Deck sidé.** Main dérivé + toutes les annotations du deck, inchangées : une carte de side
  annotée (starter, paire, condition, mortes) s'active en entrant ; une condition dont une carte
  requise sort, ou n'y reste plus en assez d'exemplaires, devient impossible — la source est dite
  **neutralisée par le plan** (pas si elle l'était déjà dans le deck de base).
- **Annoter le side.** Une annotation ne relance le calcul du deck de base que si elle change
  l'entrée du moteur ; une annotation portée par une carte hors main ne la change pas. La règle est
  exacte : une condition de carte de side qui exige une carte du main promeut celle-ci en type
  suivi, l'entrée change, le calcul repart.
- **Indicateurs d'un plan**, calculés dans le contexte de sa position (un plan premier en premier ·
  5 cartes, un plan second en second · 5 cartes + pioche) :

  | | Définition |
  | --- | --- |
  | I1 | P(S ≥ 1) |
  | I2 | P(U ≥ 2) |
  | I3 « main forte » | premier : P(S ≥ 2 et U ≥ 1) · second : P(S ≥ 2 et U ≥ 2) |

  S et U sont ceux du §5 ; les indicateurs sont des requêtes du mode Requête, au bit près. L'écart
  affiché est celui du deck sidé moins le deck de base dans la même position, jamais contre un
  résultat périmé.
- **Cache.** Les chiffres d'un plan portent l'empreinte de l'entrée complète du moteur du deck sidé,
  de la version du moteur, de la position et de la définition des indicateurs ; une empreinte
  différente = pas affichés, recalculés. Ils ne sont persistés que pour un deck sans modification non
  enregistrée.
- **Fiche imprimable.** Le deck **enregistré** : un bloc par adversaire (ordre d'ajout), volets
  premier et second, cartes qui sortent et qui entrent (deux cadres distincts, le nombre de copies
  sur chaque carte en plusieurs exemplaires), trois indicateurs, note. Un indicateur sans
  l'empreinte courante s'imprime « — », jamais un ancien chiffre ; un plan incomplet ou à revoir n'a
  pas d'indicateur. Elle se télécharge en PDF A4, à imprimer ; un adversaire n'est jamais coupé
  entre deux pages. Cible : 3 adversaires par page, 4 si les plans sont petits.
- **Comparateur.** Un côté peut être le deck sidé d'un plan prêt (adresse `deck~adversaire~position`) ;
  ses deux scénarios sont calculés, seul celui de la position du plan correspond au plan — c'est
  dit par une note d'information. Un plan incomplet ou à revoir ne se compare pas.
