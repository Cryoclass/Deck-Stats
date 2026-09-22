# Refonte des plans de side — prompt de lancement

<role>
Tu es l'agent chargé du chantier « refonte des plans de side » de Testhand. Tu travailles seul
sur le dépôt, avec des sous-agents si tu le juges utile. Je (Célian, propriétaire du projet) valide
chaque plan avant tout code et relis chaque compte rendu.
</role>

<context>
Testhand calcule les probabilités d'ouverture d'un deck Yu-Gi-Oh! : un moteur exact énumère les
mains et mesure les départs (starters, paires, conditions) et le potentiel non-engine.
L'étape 10 (docs/etape-10.md) a ajouté les plans de side. Pour chaque adversaire et chaque position
(premier / second), un plan dit quelles cartes sortent du main deck et lesquelles entrent depuis le
side, et trois indicateurs mesurent le deck sidé.

Je considère les plans de side comme la fonctionnalité la plus intéressante et la plus sous-exploitée
de l'appli. L'usage que je veux rendre évident : on annote son deck, puis on essaie des échanges, on
voit les statistiques bouger à chaque changement, et on se convainc de ses choix. Aujourd'hui,
l'onglet sait bien **décrire** un plan (la fiche PDF est réussie), mais il aide mal à **choisir**.

Le chantier précédent, « annotations par défaut », est clos (tags `annotations-a-ok` à
`annotations-d-ok`, docs/annotations-par-defaut.md). Le suivant, « Mains types »
(docs/prompt-mains-types.md), se greffera sur le contexte adversaire que tu vas créer : ne le
construis pas, mais ne lui ferme pas la porte.
</context>

<observations>
Relevées en lisant le code et les captures e2e de l'étape 10, avant le chantier annotations.
Numéros de ligne indicatifs : revérifie chaque point avant de t'appuyer dessus.

1. Dans l'onglet « Plans de side », le panneau Probabilités de droite (`StatsPanel`, affiché à côté
   dès `lg`, `EditorPage.tsx`) montre le **deck de base**. Le deck sidé n'a que trois indicateurs
   sur une ligne en bas du panneau du plan. Le mode Requête, le mur de mains, la matrice et les
   écarts par carte ne savent pas calculer un deck sidé. Seul le comparateur
   (`/compare/:a/deck~adversaire~position`) l'affiche en entier.
2. Pour voir un chiffre, il faut sélectionner les sortantes, sélectionner autant d'entrantes,
   cliquer « Échanger », puis attendre le calcul automatique (150 ms de délai, worker propre à
   l'onglet). Aucun chiffre n'apparaît pendant la sélection, et défaire un essai se fait copie par
   copie (× sur chaque puce).
3. « Fiche imprimable » et « Comparer au deck de base » sont grisés tant que le deck n'est pas
   enregistré. La raison n'est que dans `title`, donc invisible au téléphone (même constat que F12
   de docs/audit/02-parcours.md).
4. L'adversaire sélectionné (`selectedId`) et la position (défaut `first`) sont un état local de
   `SidePlanner.tsx` : ils sont perdus au rechargement. À 360 px, « Échanger » tombe loin sous la
   ligne de flottaison (docs/etape-10.md §14).
5. Les tuiles de copies n'affichent que l'image : le nom n'est que dans l'infobulle.
6. Un plan ne sait échanger qu'avec le main deck. L'Extra Deck n'y figure pas.
7. Convention actuelle : 1 à 3 copies **par carte et par zone** (docs/regles-metier.md, ligne ~64 ;
   `lib/zones.ts`). La même carte peut donc être à 3 en main et à 3 en side, alors que la règle
   officielle limite à 3 copies au total, toutes zones confondues.
</observations>

<decisions>
Déjà tranchées par moi. Tu peux signaler un problème sur l'une d'elles, mais pas la contourner.

1. **L'adversaire devient un contexte de l'éditeur**, au même rang que premier / second. Un plan
   choisi fixe le deck étudié, et toutes les statistiques de l'éditeur portent sur ce deck sidé :
   panneau Probabilités, matrice, mode Requête, mur de mains. Le contexte survit au rechargement.
   Au téléphone, le panneau passe sous le contenu : l'expérience doit y être aussi claire qu'au
   bureau.
2. **Aperçu en direct** : pendant la sélection, avant de valider, on voit ce que donnerait
   l'échange. Un aperçu n'est jamais enregistré et ne marque pas le deck « non enregistré ».
3. **Écart par carte déclenché par la sélection** : quand une carte à sortir est choisie, chaque
   carte candidate du side affiche l'effet d'un échange avec elle, et inversement. Mesure le coût
   avant de t'engager. Si c'est trop cher ou illisible, dis-le dans le plan, chiffres à l'appui.
4. **Équilibre strict et légalité officielle** : si X cartes sortent d'une zone, X cartes y entrent,
   et le deck sidé reste légal (main de 40 à 60 cartes, Extra et side de 15 au plus). L'équilibre
   se juge zone par zone.
5. **L'Extra Deck entre dans les plans**, pour que la fiche montre le plan complet. Il n'a **aucun**
   effet sur les statistiques (le moteur ne lit que le main). Un échange reste dans sa zone : une
   carte du main ne s'échange pas contre une carte d'Extra Deck, et inversement. La zone se déduit
   du type de carte (voir `isMainDeckType`, `server/src/domain/cardDefaults.ts`).
6. **La fiche et le comparateur exigent toujours un plan enregistré.** La raison se voit sans survol,
   et un geste unique permet d'enregistrer puis d'ouvrir.
7. **Hors périmètre** : les archétypes à la place du nom libre de l'adversaire, la pertinence d'une
   carte selon l'adversaire, la notation des non-engine par archétype, et les Mains types.
</decisions>

<open_points>
À instruire dans le plan, en question Q si tu ne peux pas trancher seul :

- La règle des 3 copies toutes zones confondues (observation 7). La corriger peut rendre
  « à revoir » des decks et des plans existants : mesure l'impact sur la fixture et sur l'archive
  du 8 septembre (restaurée sur conteneur jetable, voir la mémoire du dépôt et
  `scripts/recompute-check.ts`), et propose.
- L'articulation entre le contexte premier / second et la position d'un plan. Aujourd'hui, un plan
  « second » ne s'analyse qu'en second (R7). Que se passe-t-il quand on bascule premier / second avec
  un adversaire choisi ?
- Ce que montrent les écarts par carte des tuiles de l'onglet Annoter quand le contexte est un deck
  sidé.
- Le budget de temps de l'aperçu et des écarts par carte : propose des seuils chiffrés, mesurés sur
  les fixtures e2e et sur un deck réaliste.
- Le besoin éventuel d'une migration pour l'Extra Deck (additive, sans toucher aux plans
  existants), ou la preuve qu'il n'en faut pas.
</open_points>

<constraints>
- Lis AGENTS.md en entier avant tout. Ses règles et pièges s'appliquent, en particulier sur le
  moteur, les migrations, deploy/ et l'interface (refonte visuelle : jetons de couleur et échelle de
  tailles fermée).
- Avant de toucher au moteur, lis docs/regles-metier.md §4–5 et docs/cas-reference.md. Ne modifie
  jamais un oracle, un cas de référence ni une valeur de contrôle historique pour faire passer un
  test.
- **Invariant de non-régression** : un plan existant garde exactement ses chiffres et son statut,
  sauf si je valide explicitement un changement de règle (point des 3 copies). Les plans enregistrés
  en production restent lisibles.
- L'empreinte d'un plan hache l'entrée complète du moteur du deck sidé : ne la réduis jamais.
  `lib/sidePlan.ts` est hors de `__ENGINE_VERSION__` ; si tu y touches, dis ce que ça implique pour
  les caches.
- **Invariant d'affichage** : aucun chiffre de l'éditeur ne s'affiche sans qu'on puisse savoir sur
  quel deck il porte (base ou sidé contre tel adversaire, dans telle position).
- Tout ce qui écrit tourne sur des conteneurs jetables. Rien vers la base de dev, le VPS ni
  Supabase. Aucun push.
- Ne lance jamais l'e2e en même temps que `test-migration-sequence.sh` ou `rehearsal.sh`.
</constraints>

<workflow>
**Phase 1 — Inventaire et plan (aucun code).**
Écris `docs/plans-de-side-v2.md`, sur le modèle de docs/annotations-par-defaut.md :
1. Intention (reformulée en quelques lignes).
2. Inventaire prouvé : chaque affirmation sur le code avec fichier et ligne, chaque mesure avec la
   commande qui la produit. Les observations ci-dessus y sont confirmées ou corrigées.
3. Avis : ce qui te semble juste, risqué ou discutable dans mes décisions.
4. Décisions proposées, numérotées D1, D2… : chacune dit quoi et pourquoi.
5. Modèle : contrat, schéma et migration éventuelle, store, routes, composants touchés.
6. Règles métier à inscrire au contrat (docs/regles-metier.md), numérotées.
7. Découpage en parties A, B, C… livrables et vérifiables séparément, avec pour chacune le
   résultat attendu, les fichiers touchés et le tag `side-v2-<partie>-ok`.
8. Vérifications prévues par partie, dont les scénarios e2e à étendre ou créer (`side` et
   `sidesheet` existent) et les largeurs testées (360, 390, 768, 1440).
9. Risques et pièges.
10. Questions ouvertes, numérotées Q1, Q2… : chacune avec ta recommandation et ce qu'elle change.

Ajoute la ligne du chantier dans le tableau de docs/PLAN.md avec le statut « plan à valider ».
Puis **arrête-toi**. Ton message dit où est le plan, résume les décisions structurantes en quelques
lignes et liste les questions. Aucune modification de code ni de test à ce stade.

**Phase 2 — Réalisation, partie par partie, après ma validation.**
J'écris mes réponses dans le document (section « Réponses »), et tu révises le plan en conséquence
avant de coder. Chaque partie se clôt par :
- `npm run typecheck`, `npm run build`, `node scripts/test-quiet.mjs` ;
- tests d'intégration PostgreSQL sur 55433 si le serveur ou le schéma bouge ;
  `test-migration-sequence.sh` et `rehearsal.sh --fixture` si une migration ou deploy/ bouge ;
- `npm run e2e -w web` si l'interface bouge (scénarios nouveaux ou étendus, captures relues) ;
- contrôle par mutation : au moins 4 erreurs volontaires, toutes détectées, fichiers restaurés et
  vérifiés par empreinte ;
- relecture par un sous-agent à contexte neuf, qui confronte le travail au plan et à ce prompt ;
- compte rendu de la partie dans docs/plans-de-side-v2.md (livré, vérifications exécutées avec leurs
  résultats, mutations, relecture, écarts au plan) ; mise à jour du tableau et du « Compte rendu de
  la dernière étape » de docs/PLAN.md ; décisions dans DECISIONS.md et une ligne par décision dans
  docs/decisions-compressees.md ; nouveaux pièges dans AGENTS.md ;
- commit Conventional Commits en français, puis tag de la partie, sans push.

Enchaîne les parties sans m'attendre, sauf si l'une exige une décision absente du document validé.
Dans ce cas, pose-la avant de commencer cette partie.
</workflow>

<delegation>
Tu peux confier à des sous-agents des lots indépendants, des mesures et les relectures. Donne à chaque
lot une liste de fichiers qui ne recoupe celle d'aucun autre lot actif, et un rapport attendu
(fichiers modifiés, vérifications exécutées avec résultat, écarts, doutes). Un rapport de sous-agent
est une déclaration, pas une preuve : revérifie ce qui compte avant de l'inscrire au compte rendu.
</delegation>

<reporting>
- Avant d'annoncer qu'une chose est faite, vérifie-la contre un résultat d'outil de ta session. Ce qui
  n'est pas vérifié est dit comme tel. Un test en échec ou une étape sautée se dit, avec la sortie.
- Ne t'arrête pour me solliciter que si c'est vraiment nécessaire : action destructive ou
  irréversible, changement de périmètre, ou décision que moi seul peux prendre.
- Ton message final est lu par quelqu'un qui n'a pas suivi : le résultat d'abord, puis ce que tu
  attends de moi, en phrases complètes, sans abréviations de travail.
</reporting>
