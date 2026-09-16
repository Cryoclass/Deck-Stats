# Audit UX — parcours réel (préparation freemium)

Date : 14 septembre 2026. Lecture seule : aucun fichier du dépôt modifié hors `docs/audit/`,
aucune commande vers le VPS, Supabase ou une base réelle. Grille de lecture : ce qui est
acceptable pour un outil perso ne l'est pas forcément pour un produit payant ouvert à des
inconnus.

## Méthode

1. **Reconstitution du parcours depuis le code** : routage (`web/src/lib/router.tsx`,
   `App.tsx`), écrans (`web/src/components/*.tsx`), règles métier (`docs/regles-metier.md`),
   charte (`docs/design-system.md`).
2. **Parcours réels au navigateur**, Chrome piloté par `playwright-core` (même mécanisme que
   `web/e2e/`), trois comptes de test créés via le code d'invitation trouvé dans `.env`
   (`duel-2026`) — aucun compte réel touché. Script et captures : voir « Environnement de
   test » plus bas. 47 captures dans `docs/audit/captures/*.png`, journal complet des actions
   dans `docs/audit/captures/log.json`.
3. Trois personas joués de bout en bout, décrits ci-dessous, puis synthétisés dans le tableau
   des frictions.

## Environnement de test

`npm run db:up` pointait vers le port 5433 déjà occupé par un conteneur d'un **autre projet**
sur cette machine (`siteclients-tests-db`) : la base de dev de Testhand (`ygo-proba-db`,
conteneur existant, données réelles présentes) a été démarrée sur le port **5533** via un
fichier `docker-compose` de dépassement de port conservé **hors du dépôt** (`ports: !override`),
sans toucher `docker-compose.yml`. En pointant dessus, la création de compte échouait avec une
erreur 500 brute affichée à l'écran (`null value in column "relevance" of relation
"nonengine_categories" violates not-null constraint`). Vérification : cette base de dev locale
porte un schéma **incohérent** — ni l'état d'avant la migration 003 (colonne `relevance` avec
défaut `'both'`, `db/schema.sql:129`) ni l'état d'après (colonne supprimée,
`db/migrations/003-purge-legacy.sql:218`) : la colonne existe, `NOT NULL`, sans défaut. C'est un
artefact de cette copie locale (jamais rejouée avec `003` ni avec un `db/schema.sql` récent),
**pas un défaut de code** : rejoué sur une base jetable neuve (schéma + migrations 001→004 dans
l'ordre documenté par `AGENTS.md`, catalogue de 14 529 cartes copié en lecture seule depuis la
base de dev), la création de compte réussit normalement. Tout le reste de cet audit a été rejoué
sur cette base jetable propre (conteneur `testhand-audit-db2`, détruit en fin de session). Ce
point est reprise en détail dans « Non vérifié / écarté » — il n'apparaît **pas** dans le tableau
des frictions.

Le fait générique qu'il a révélé, lui, est confirmé indépendamment du schéma local et **reste
dans le tableau** : voir F11.

## Reconstitution du parcours (depuis le code)

- **Routage** (`web/src/lib/router.tsx:7-28`) : 5 routes (`/decks`, `/decks/:id`,
  `/decks/:id/side`, `/decks/:id/side/fiche`, `/compare/:a/:b`), pas de bibliothèque de
  routage, comparaison de chaînes faite à la main.
- **Garde d'authentification** (`App.tsx:32-43`) : tant qu'aucune session n'existe, `LoginPage`
  est rendue **à la place** de la route demandée — l'URL n'est jamais réécrite (bon point pour
  les liens profonds après connexion).
- **Première visite** : `LoginPage` (`web/src/components/LoginPage.tsx`), bascule
  Connexion/Inscription, aucune autre porte d'entrée (pas de mode démo, pas de deck d'exemple).
- **Compte neuf, 0 deck** : état vide sur `HomePage.tsx:185-198` — « Aucun deck pour l'instant. »
  + « Commence par importer un fichier YDK — c'est le plus rapide. » + un seul bouton
  « + Importer un deck ».
- **Création** : une seule modale (`ImportDialog.tsx`) réunit 4 chemins (YDK, JSON complet,
  coller des passcodes, deck vide) ; un import avec anomalies (passcode inconnu, quantité hors
  convention, ligne non reconnue) ouvre un écran de vérification explicite avant confirmation
  (`ReviewPanel`, `ImportDialog.tsx:187-283`) — conforme au contrat §2 (aucune réduction
  silencieuse).
- **Après création** : atterrissage direct sur l'onglet « Annoter » de l'éditeur, sans étape de
  configuration forcée — mais voir F2/F3 : le panneau de stats est déjà « vivant » avec un
  deck vide de sens tant que rien n'est annoté.
- **Comparateur** : exige deux decks **déjà enregistrés** (pas de notion de version/historique
  sur un même deck) ; dupliquer un deck est le seul raccourci pour obtenir « deux versions ».
- **Persistance à deux vitesses** : les starters/paires/conditions n'existent que dans l'éditeur
  jusqu'au clic « Enregistrer » (`Header.tsx:88-100`, désactivé si `!dirty`) ; les étiquettes
  non-engine/profils/plafonds/HOPT, elles, s'enregistrent immédiatement à chaque clic (compte,
  pas deck) — la seule mention de cette différence à l'utilisateur est un paragraphe dans
  l'onglet « Combos & catégories » (`ComboList.tsx:26-27`), jamais répété ailleurs.

## Trois parcours joués

### Persona 1 — joueur compétitif (bureau, 1440×900)

But : créer un deck de 40 cartes, l'annoter, comparer deux versions. Compte
`audit.competitif@example.test`.

1. Connexion → **Inscription** (1 clic) → formulaire (email, mot de passe, nom affiché, code
   d'invitation) → **Créer le compte** (1 clic) → accueil vide (0,9 s après soumission).
   Captures `P1-competitif-00-login.png` → `02-home-after-register.png`.
2. **+ Importer un deck** (clic 3) → collage de 14 lignes `qté passcode` (40 cartes) → **Importer
   le texte** (clic 4) → éditeur, onglet Annoter, 40 cartes, **0 % partout** (aucune étiquette).
   Capture `04-editor-fresh.png` ; texte exact du panneau capturé dans `log.json`
   (`statsText1`) : `brick 100.00% · E[red.] 0.00`, matrice à 100 % en case (0,0).
3. Mode **Starter** (clic 5) → 2 tuiles cliquées (Ash Blossom, Effect Veiler — clics 6 et 7) →
   départs ≥1 passe de 0 % à **57,7 %** (premier) / **65,0 %** (second) instantanément.
   Capture `05-after-starter-tags.png`.
4. **Enregistrer** (clic 8) → **← Decks** (clic 9) → carte de deck sur l'accueil avec ses deux
   chiffres (« 58 % départs ≥1 », « 42 % brick »), sans légende. Capture `07-home-with-deck.png`.
5. Menu **⋯** (clic 10) → **Dupliquer** (clic 11) → deuxième carte « … (copie) » apparaît, nom
   par défaut non descriptif. Capture `08-home-after-duplicate.png`.
6. Ouverture de la copie, renommage manuel, retrait d'une copie d'une carte (stepper −),
   **Enregistrer**, **← Decks**, **⇄ Comparer** (clic 12), sélection A/B déjà pré-remplie par
   défaut (ordre de l'API, pas par pertinence), **Comparer** (clic 13) → deux matrices
   côte à côte + delta coloré + bandeau « Tailles de deck différentes (39 vs 40) : la
   comparaison reste valide mais les probabilités ne jouent pas à armes égales. »
   Capture `12-compare-result-diff.png` — exemple honnête et bien sourcé de la charte §9.6
   (« les deux jeux comparés partagent la même échelle »).

**Total : 13 clics** pour aller de la page de connexion à une comparaison A/B exploitable sur un
deck qu'on vient de créer — dont 6 rien que pour dupliquer, renommer, éditer et rouvrir le
comparateur (étapes 5-6). Voir F6.

### Persona 2 — joueur occasionnel, vocabulaire inconnu (bureau, 1440×900)

But : mesurer le temps et les clics jusqu'à la première valeur significative, sans fichier YDK
sous la main. Compte `audit.decouverte2@example.test`.

1. Connexion → Inscription (identique à P1, 2 clics, code d'invitation obligatoire — voir F1).
2. **+ Importer un deck** (clic 3) → pas de fichier, pas de passcodes connus par cœur → clique
   **Créer un deck vide** (clic 4, lien texte discret, pas un bouton) → éditeur, « Nouveau
   deck », 0 carte. Capture `04-editor-empty-deck.png`.
   Panneau de droite (texte exact, `log.json` → `statsEmpty`) :
   `Deck de 0 cartes — hors bornes 40–60 (§D). Calcul effectué quand même. […] Premier · 5
   cartes : analyse indisponible. Impossible de tirer 5 cartes dans un deck de 0 cartes.`
   — message correct, mais la zone principale répète au même instant
   **« Importe un deck (fichier YDK ou liste collée) pour commencer à annoter »**, alors que
   l'utilisateur vient justement de refuser cette option. Voir F2.
3. **+ Ajouter une carte** (clic 5) → 6 recherches/Entrée (nom ou passcode : Ash Blossom, Effect
   Veiler, Maxx, 3 passcodes bruts) → Échap → 6 cartes, deck de 6, **toujours 0 %** partout
   (`stats6` dans `log.json` : `brick 100.00%`, matrice 100 % en case 0). Capture
   `06-editor-6-cards-no-tags.png`. Rien à l'écran n'indique que ce 0 % vient de l'absence
   totale d'étiquetage, pas du contenu du deck. Voir F3.
4. Mode **Starter** (clic 6) → 1 tuile cliquée (Ash Blossom, clic 7) → départs ≥1 passe de
   **0 % à 83,3 %** (premier) instantanément. Capture `07-after-first-starter-tag.png`.

**Première valeur non nulle : 7 clics, ~9,4 s mesurées en automatisé** (script, sans le temps
de lecture/hésitation d'un humain réel — à traiter comme un plancher, pas une mesure terrain).
Sur ces 7 clics, 2 sont imposés par l'inscription (dont le code d'invitation, F1), 2 par le choix
« deck vide », 1 pour entrer en mode Starter et 1 pour taguer — soit **3 clics de « vraie »
mise en route** une fois le compte créé et le vocabulaire compris. Le problème n'est donc pas
le nombre de clics : c'est qu'aucun des deux messages successifs (« importe un fichier » puis
« 0 % partout ») ne dit à cet utilisateur *quoi faire* pour sortir de cet état.

### Persona 3 — arrivée sur mobile, 360 px

But : inscription et prise en main à l'étroit. Compte `audit.mobile360@example.test`,
viewport 360×740, tactile simulé.

1. Connexion/Inscription identiques (clics 1-2). Capture `00-login.png` — le formulaire
   d'inscription (email, mot de passe, nom, code d'invitation, bouton Discord) tient sans
   défilement horizontal à 360 px.
2. **+ Importer un deck** (clic 3) → modale à une colonne, zones YDK/JSON empilées (conforme à
   la charte §6.3), collage de 13 cartes → **Importer le texte** (clic 4) → éditeur.
   Capture `04-editor-360-annotate-tab.png`.
3. **Barre d'onglets tronquée sans indice de défilement** : à l'arrivée, seuls « Annoter »,
   « Combos & catégories », « Mur de mains » et un « Inve[ntaire] » coupé au ras du bord sont
   visibles ; **« Plans de side » est entièrement hors champ**, aucune flèche, dégradé ou point
   n'indique qu'il faut balayer. Capture `04-editor-360-annotate-tab.png` (bord droit). En
   cliquant sur l'onglet « Plans de side » par son nom accessible (clic 9, la page défile
   automatiquement pour l'atteindre — un geste que Playwright fait à ma place, pas un vrai
   doigt), la barre défile à l'autre extrémité et **« Annoter » disparaît à son tour** côté
   gauche. Capture `06-tab-Plansdeside-360.png`. Voir F5.
4. Onglet **Stats** (clic 5, présent seulement sous 1024 px, `EditorPage.tsx:65-72,146`) :
   panneau complet lisible, aucune coupe. Capture `05-stats-tab-360.png`.
5. Parcours des 4 autres onglets (clics 6-9), retour Annoter (clic 10). Cibles tactiles
   mesurées : bouton mode « Starter » 77,6×26 px (≥ 24 px, conforme au minimum secondaire de la
   charte), bloc « + Ajouter une carte » 110×160 px (large, conforme).
6. **← Decks** (clic 11) → bouton **⇄ Comparer désactivé**, un seul deck sur le compte. Le motif
   du désactivé n'existe que dans l'attribut `title=` de `HomePage.tsx:164-168`
   (« Il faut au moins deux decks pour comparer. ») — **jamais visible au doigt, sans survol
   possible sur tactile**. Capture `07-home-360-one-deck.png`. Voir F12.

## Tableau des frictions

| Écran | Persona | Friction | Gravité | Correctif proposé |
| --- | --- | --- | --- | --- |
| Connexion/Inscription (`LoginPage.tsx:170-182`) | Tous, surtout occasionnel | **Inscription bloquée derrière un code d'invitation unique et manuel** (`INVITE_CODES` en variable d'environnement, `server/src/routes/auth.ts:8-16` : « Zéro table, zéro écran d'admin ; révoquer = éditer .env + redémarrer »). Aucune table, aucun flux « demander un accès », aucun indice à l'écran sur comment obtenir un code. Un inconnu qui découvre l'outil ne peut tout simplement pas créer de compte. | **Critique** pour un modèle freemium : bloque 100 % des inscriptions organiques avant même le premier écran. | Découpler l'inscription publique (offre gratuite) du système d'invitation bêta : ouvrir l'email/mot de passe sans code pour le tier gratuit, garder l'invitation pour un accès anticipé optionnel. |
| Connexion/Inscription | Tous | **Aucun moyen de récupérer un compte** : ni lien « mot de passe oublié » dans `LoginPage.tsx` (101-223, absent), ni route serveur de réinitialisation (`grep -i reset\|forgot` sur `server/src/` : aucun résultat). | Élevée | Ajouter un flux minimal de réinitialisation par email avant l'ouverture publique — un utilisateur payant verrouillé dehors sans recours est un point de friction commercial direct (support manuel obligatoire). |
| Éditeur, deck vide créé volontairement (`AnnotationGrid.tsx`, capture `P2-occasionnel-04-editor-empty-deck.png`) | Occasionnel | Le texte d'aide dit **« Importe un deck (fichier YDK ou liste collée) pour commencer à annoter »** alors que l'utilisateur vient d'explicitement refuser l'import (« Créer un deck vide ») — message contradictoire au moment précis où il a le moins de repères. | Élevée | Message conditionnel selon l'origine : pour un deck vide créé à dessein, pointer directement vers le bouton « + Ajouter une carte » juste en dessous plutôt que suggérer de recommencer. |
| Panneau Probabilités, deck sans aucune étiquette (`StatsPanel.tsx`, capture `P2-occasionnel-06-editor-6-cards-no-tags.png`) | Occasionnel | Dès qu'un deck a des cartes mais aucune n'est marquée starter, **tout affiche 0 % / « brick 100.00% »** sans dire que c'est parce que rien n'a été annoté (vs. « ce deck est mauvais »). Mesuré : 0 → 83,3 % en un seul clic une fois la première carte taguée. | Élevée | Bandeau contextuel tant qu'aucun starter n'existe : « 0 carte marquée starter — les probabilités resteront à 0 % tant que tu n'auras pas annoté au moins une source de start (mode Starter, ou touche S). » |
| Grille d'annotation et panneau Stats (vocabulaire) | Occasionnel | Aucun glossaire nulle part dans l'UI (confirmé par recherche exhaustive : ni composant `Tooltip`/`HelpCircle`, ni page d'aide). Couverture des info-bulles très inégale : « profil » et « plafond » ont une vraie phrase d'explication (`ComboList.tsx:227`, `ModeBar.tsx:134`), mais le bouton de mode **« Starter » lui-même n'a aucune bulle** (`annotationModes.ts`), et **« brick » n'est expliqué nulle part** dans le code (seule occurrence textuelle : `brick ${pct}` concaténé sans `title=`, `web/src/lib/statsViews.ts:58`) — y compris sur la toute première carte de deck vue sur l'accueil (`HomePage.tsx:308`, « brick (premier) »). | Moyenne | Un point d'entrée « ? » discret ouvrant un glossaire de 6-8 termes (starter, non-engine, brick, plafond, profil, HOPT, ET/OU, départs théoriques) — pas une refonte, juste une porte de sortie pour qui ne connaît pas le jargon compétitif YGO. |
| Éditeur, barre d'onglets à 360 px (`EditorPage.tsx:131-149`, captures `P3-mobile360-04…png` et `…06-tab-Plansdeside-360.png`) | Mobile | Les 5 onglets débordent horizontalement (`overflow-x-auto`, conforme à la charte §7.8 « ne jamais casser ») mais **sans aucun indice visuel de défilement** (pas de dégradé, flèche ou point) : « Inventaire » est tronqué au bord, **« Plans de side » est entièrement hors champ au chargement** — une fonctionnalité entière invisible sans un balayage que rien ne suggère. | Élevée | Dégradé de bord (fade) sur la barre quand elle déborde, ou chevrons cliquables aux extrémités. |
| Accueil, bouton « ⇄ Comparer » désactivé (`HomePage.tsx:164-168`, capture `P3-mobile360-07-home-360-one-deck.png`) | Mobile | Le motif du désactivé (« Il faut au moins deux decks pour comparer. ») n'existe que dans l'attribut natif `title=`, **jamais visible au doigt** (pas de survol sur tactile) : le bouton reste juste grisé, sans explication. | Moyenne | Afficher le message en un petit texte permanent sous le bouton, ou au clic sur un bouton désactivé (toast), plutôt que réserver l'explication au survol. |
| Accueil → Comparer (flux complet, persona 1) | Compétitif | Comparer deux versions d'un même deck impose 6 étapes manuelles après la création initiale (dupliquer via ⋯, ouvrir la copie, **renommer à la main** — le nom par défaut est juste «… (copie)» —, éditer, Enregistrer, revenir, rouvrir Comparer) : **13 clics mesurés** au total pour une seule comparaison A/B, et le comparateur n'a **aucune notion de version/historique** — deux decks totalement indépendants à chaque fois. | Moyenne | Un raccourci « Dupliquer et comparer » depuis le menu ⋯ du deck, ou une action « Comparer avec la version précédente » proposée juste après une duplication. |
| Éditeur, annotations (persistance à deux vitesses) | Compétitif, occasionnel | Les starters/paires/conditions ne persistent qu'au clic explicite **« Enregistrer »**, alors que les étiquettes non-engine/profils/plafonds/HOPT s'enregistrent **immédiatement** à chaque clic (compte, pas deck). La seule mention de cette différence à l'utilisateur est un paragraphe isolé dans l'onglet « Combos & catégories » (`ComboList.tsx:26-27`), jamais répété ailleurs ni sur l'onglet Annoter (l'onglet par défaut). | Moyenne | Rappel visuel bref (badge ou légende) directement dans l'onglet Annoter, là où l'utilisateur agit le plus, plutôt que dans un onglet qu'il peut ne jamais ouvrir. |
| Import de deck, modale « Nouveau deck » (`ImportDialog.tsx:99,161-163`) | Occasionnel | Pour qui n'a ni fichier YDK ni passcodes en tête, la **seule option réellement utilisable** (« Créer un deck vide ») est stylée en simple lien texte discret (`text-ink-400`), visuellement la moins engageante des quatre options — face à un bouton vert plein « Importer le texte ». | Faible | Élever visuellement « Créer un deck vide » (ou reformuler en « Je n'ai pas de fichier — ajouter les cartes une à une ») pour qu'il ne soit pas la seule option à ressembler à un renoncement. |
| Toute route (API, gestion d'erreurs) | Tous (risque, pas encore observé en conditions normales) | Aucun `setErrorHandler` Fastify côté serveur (`grep` sur `server/src` : aucun résultat) : toute exception non prévue renvoie son `error.message` brut dans le corps JSON, et le client l'affiche **tel quel** à l'écran (`web/src/lib/api.ts:36-51`, `LoginPage.tsx:96` : `err.message` affiché sans filtrage). Observé concrètement pendant cet audit (message Postgres brut affiché sur l'écran d'inscription, cf. « Environnement de test » — dû à un artefact de ma base locale, mais le **mécanisme** qui l'a laissé passer jusqu'à l'écran est bien réel et généralisé à toute l'API. | Élevée | Ajouter un `setErrorHandler` qui journalise l'erreur complète côté serveur mais ne renvoie au client qu'un message générique pour toute exception non explicitement gérée (celles qui sont déjà traduites, comme le code d'invitation invalide, continuent de passer telles quelles). |
| Accueil, connexion réussie mais session absente en tâche de fond | Tous (constaté au tout premier chargement) | Deux requêtes `401` systématiques dans la console au premier chargement de toute page (`GET /api/auth/me` avant authentification — comportement normal de la sonde de session) ne sont pas fautives en soi, mais **aucune n'a de temps de chargement affiché à l'utilisateur** : entre le chargement du bundle Vite et la réponse de la sonde, l'écran est un simple « Chargement… » sans indication de progression (`App.tsx:35-39`). | Faible | Non bloquant — mentionné pour mémoire, aucun correctif prioritaire (latence locale mesurée < 1 s). |

## Non vérifié / écarté

- **Erreur 500 à l'inscription sur la base de dev locale** (`nonengine_categories.relevance`
  NOT NULL sans défaut) : confirmée comme un artefact de schéma **local et non représentatif**
  (voir « Environnement de test »), reproduite puis **infirmée** sur une base rejouée proprement
  avec `db/schema.sql` + migrations 001→004. N'est **pas** un défaut de code — retiré du tableau
  des frictions. Le mécanisme générique qu'elle a mis en évidence (pas de sanitisation des
  erreurs serveur) reste, lui, une vraie friction (F « toute route »).
- **Comportement réel de la limite de débit à l'inscription** (`max: 5 requêtes / 10 min`,
  `server/src/routes/auth.ts:56`) : non testé en conditions de charge (un réseau partagé —
  université, entreprise — pourrait bloquer plusieurs inscriptions légitimes derrière une même
  IP en peu de temps) ; hypothèse non vérifiée, à surveiller si le produit s'ouvre au public.
- **Rendu des illustrations de carte en environnement réel** : le catalogue utilisé pendant cet
  audit est une copie en lecture seule de la base de dev (14 529 cartes, mêmes URL d'images que
  la prod) — les vignettes se sont chargées normalement dans les captures, mais je n'ai pas
  testé le relais `GET /api/cards/:id/image` ni un réseau dégradé/lent en conditions mobiles
  réelles (3G, latence). Non vérifié.
- **Flux Discord OAuth** : le bouton n'apparaît que si le serveur le déclare configuré
  (`LoginPage.tsx:46-54`) — non configuré dans mon environnement de test, donc jamais affiché ;
  je n'ai pas pu vérifier ce chemin d'inscription/connexion alternatif.
- **Persona compétitif avec le compte réel** (`celian.crepin@gmail.com`, 2 decks existants) :
  volontairement non utilisé — je n'ai ni le mot de passe ni l'autorisation explicite de m'y
  connecter, et l'usage d'un compte de test frais est plus représentatif d'un vrai nouvel
  utilisateur payant de toute façon.

## Note de méthode sur l'estimation « temps jusqu'à la première valeur »

Les temps mesurés (persona 2 : ~9,4 s, 7 clics) sont ceux d'un script Playwright headless, donc
un **plancher artificiel** : aucune hésitation, aucune lecture des libellés, aucun temps de
réflexion sur « c'est quoi un starter ? ». Le nombre de clics (7, dont 4 imposés par
l'inscription/le choix du chemin de création) est en revanche directement transposable — c'est
la métrique la plus fiable de ce document pour comparer des variantes de parcours.
