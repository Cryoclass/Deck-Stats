# Étapes 2 et 3 — calculs et persistance

Livrées le 7 septembre 2026. Le [contrat métier](regles-metier.md) reste la cible
de l'ensemble de la mission. **L'étape 4 n'est pas commencée** : annulation du
worker et affichage des statistiques périmées ne sont pas livrés ici. La nouvelle
chronologie premier/second et les conditions OU relèvent toujours de l'étape 5.

## Corrections mathématiques

| Défaut | Correction et preuve |
| --- | --- |
| Delta d'une cible de condition | `prepare` reconstruit le total requis depuis la composition courante, y compris après remplacement d'une copie. D=40, A×3 starter exigeant B×1 restant : perte après remplacement de B = `(C(39,5)−C(36,5))/C(40,5)` = **+30,2070795… points**. Test direct, plus comparaison aux mains physiques pour sources carte et paire, mains de 5 et 6. |
| Matrice de l'éditeur, colonne 5+ | Même agrégation que le comparateur : somme des indices ≥5. Six non-engine donnent toute la masse en 5+, E[U]=6 ; la moyenne plancher reste 5. Le test vérifie aussi le HTML de la matrice. |
| Tirage impossible | Passe explicitement indisponible (`total=0`, motif), sans probabilité de requête, note ou main raccourcie. L'éditeur indique le motif et le comparateur refuse la passe. Les zéros internes de cette passe sont des valeurs de structure, pas des probabilités ; toujours vérifier sa disponibilité avant usage. |
| Arrondi de la note | Les buckets conservent leurs poids entiers. Le percentile utilise un rapport entier et un arrondi exact : `10×(36+12/2)/56=7,5` donne 8. Les anciens buckets sans poids sont reconstruits depuis leur dénominateur. |
| Précision binomiale | Produits intermédiaires en `bigint`, clé de cache sans collision ; une passe dépassant les entiers sûrs est signalée comme indisponible. Les probabilités normalisées restent des nombres JavaScript. |

Les pourcentages généraux et deltas sont désormais affichés au centième ; les
cellules de matrice et les vues explicitement au dixième gardent cette précision.
Les agrégations utilisent les valeurs non arrondies. L'oracle de l'étape 1 reste
indépendant et les 52 tests historiques continuent de passer.

## Modèle et flux d'enregistrement

Le module pur [deckConfiguration.ts](../server/src/domain/deckConfiguration.ts)
définit et valide le document métier version 2. Il ne dépend ni de Fastify, ni de
PostgreSQL, ni de React. Le client importe ce contrat directement ; aucun nouveau
package ou framework n'est nécessaire. Les accès SQL restent dans
[deckRepository.ts](../server/src/domain/deckRepository.ts), les routes gèrent
authentification, transaction et révision, et l'adaptateur web convertit ce document
pour le store, l'export et le comparateur. Une extraction ultérieure du contrat
dans un package partagé ne demanderait pas de changer ses règles.

| Stockage | Responsabilité |
| --- | --- |
| `deck_combo_pairs` | Paire par deck, identifiant UUID stable, cartes canoniques A<B, note et état désactivé |
| `deck_requirements` | Conditions actuelles ET ; identifiant stable et source carte ou paire du même deck, FK composite pour interdire les références entre decks |
| `deck_flags` | Disponibilité des starts en premier/second, locale au deck |
| `decks.revision` | Contrôle des écritures concurrentes |
| `card_flags.is_hopt`, catégories et affectations | Bibliothèque manuelle commune aux decks du compte |
| Anciennes tables de paires et conditions | Données conservées pour l'inventaire et la purge de l'étape 8 ; plus utilisées par la nouvelle API |

Les profils non-engine et plafonds de groupe du contrat cible ne sont pas encore
introduits dans le calcul ou la base. Les pertinences et horizons actuels sont
conservés en attendant l'étape 5.

Un clic sur deux cartes modifie seulement le deck en cours et son brouillon.
**Enregistrer** envoie une seule configuration avec la révision attendue. Une
transaction verrouille le deck, valide ses références, puis écrit composition,
starters, paires, conditions, disponibilités, paramètres et notes. Une erreur
annule tout ; une révision ancienne reçoit HTTP 409. Un identifiant de paire ne
peut pas être réaffecté à d'autres cartes. Les anciens endpoints d'écriture
partielle et de paires globales répondent HTTP 410.

Une modification pendant l'enregistrement reste marquée non enregistrée. La
réponse d'un deck quitté ne modifie pas celui désormais ouvert. Les brouillons
version 2 capturent le document et ne sont effacés après sauvegarde que si leur
contenu correspond à celui sauvegardé ; les anciens brouillons ne sont pas repris.
IndexedDB reste une récupération locale facultative, sans garantie en cas de quota
ou de stockage indisponible. Les confirmations de transaction attendent son commit.

Les écritures globales sont exécutées dans l'ordre, avec un état d'enregistrement
visible. L'interface adopte le changement après acquittement serveur ; une erreur
est affichée et ne laisse pas croire à une annotation enregistrée. La création de
catégorie ne diffuse plus d'identifiant temporaire à ses affectations.

Les anciens aperçus statistiques persistés ne sont plus affichés à l'accueil ni
enregistrés depuis un résultat potentiellement périmé. Nom, taille et vignettes
restent disponibles ; le recalcul des aperçus avec une version fiable sera une
évolution explicite, sans réintroduire de cache faisant autorité.

## Import, export, duplication

- L'import YDK et la création vide utilisent le même document validé côté serveur.
  La révision du parseur YDK et du constructeur reste prévue à l'étape 6 ; les
  tolérances historiques du parseur ne sont pas corrigées par cette étape.
- Le JSON version 2 contient le document complet et ses annotations globales
  utiles, y compris les catégories référencées uniquement par une requête.
  Paires dormantes, désactivations, conditions, notes et requêtes sont conservées.
- L'import JSON est une seule transaction : il enrichit la bibliothèque du compte
  puis crée le deck. Les identifiants des catégories sont remappés dans les
  affectations, la vue et les requêtes. Une catégorie existante de même nom mais
  d'autre pertinence, ou un HOPT explicitement contradictoire, fait échouer tout
  l'import. Les affectations existantes sont conservées ; les nouvelles sont
  ajoutées. Il s'agit d'une fusion avec la bibliothèque du compte, pas d'un
  remplacement des annotations de ses autres decks.
- Les JSON version 1 sont refusés avec un message explicite. Aucun convertisseur
  automatique ne restaure les anciennes paires globales. Pour une ancienne
  sauvegarde, réimporter sa composition et redéfinir les paires, ou prévoir une
  conversion explicitement contrôlée ultérieurement.
- La duplication copie toutes les données locales, crée les nouveaux identifiants
  de paires et conditions, et remappe leurs références. Une paire n'apparaît jamais
  dans un autre deck par simple appartenance des deux cartes au catalogue.
- Le comparateur et l'éditeur passent par le même adaptateur. La structure visuelle
  du comparateur n'est pas refondue ici ; la validation mobile reste à l'étape 7.

Une référence de catégorie disparue dans une requête ou une vue enregistrée est
signalée lors d'une sauvegarde/export plutôt qu'effacée silencieusement. Il faut
corriger la vue ou la requête concernée.

## Migration et maintenance

La [migration additive](../db/migrations/001-deck-configuration.sql) est nécessaire
avant de démarrer cette version sur une base existante. Elle crée les nouvelles
tables, copie uniquement les conditions de source carte, copie les disponibilités
historiques vers les decks du même compte, et invalide `decks.summary`.
Les anciennes paires, leurs notes, exclusions et conditions de source paire sont
**conservées physiquement et ne sont pas copiées dans le nouveau modèle**.

Elle est transactionnelle, verrouillée contre un second migrateur et inscrite dans
`app_migrations`. Un rejeu ne réintroduit pas d'anciennes conditions. Des conditions
historiques invalides ou des données sans propriétaire provoquent un arrêt ; pour
une base antérieure aux comptes, effectuer d'abord l'adoption historique.
Les contrôles et commandes figurent dans [deploy/configuration-v2.md](../deploy/configuration-v2.md).

Le script de nettoyage du catalogue compte maintenant les références des nouvelles
tables. Son ancien algorithme de report de passcodes ne sait pas encore fusionner
les nouvelles paires et conditions : si un report laisse ces références pendantes,
le contrôle final annule la transaction entière. Les cartes référencées sans cible
sont conservées. Cette adaptation de maintenance reste documentée à poursuivre,
sans exécuter de nettoyage ici ni perdre silencieusement des références.

## Vérifications et limites

Les commandes et tests ne dépendent d'aucune donnée personnelle :

```powershell
npm.cmd run test -w web -- --no-cache
npm.cmd run test -w server
npm.cmd run typecheck
npm.cmd run build
```

Les tests PostgreSQL utilisent un conteneur jetable en mémoire, sur
`127.0.0.1:55433`, jamais le `DATABASE_URL` habituel. Leur procédure complète est
dans [la documentation de migration](../deploy/configuration-v2.md).

Résultats : **95 tests web, 4 tests serveur et 7 tests PostgreSQL réussis**.
La suite SQL teste aussi le rollback d'une migration invalide, son rejeu,
l'isolation des comptes, les conflits de révision, une panne injectée au milieu
d'une écriture et le rollback d'un import après conflit de bibliothèque.
Le HTML de la matrice est testé ; aucune inspection visuelle mobile ou exécution
IndexedDB dans un navigateur réel n'est revendiquée.

Types et builds serveur/web réussis. Vite conserve son avertissement sur le bloc
ExcelJS de 940,19 kB minifié (271,33 kB gzip). Aucun lint n'est configuré dans le
projet. Une première exécution de `npm test` a rencontré une restriction Windows
d'accès d'esbuild ; la commande web sans cache et les tests serveur ont ensuite
réussi.

`git diff --check`, les 28 liens locaux des documents de référence, la syntaxe Bash
de `deploy.sh` et les deux configurations Docker Compose ont également été
contrôlés avec succès. Aucun script de déploiement n'a été exécuté : seule sa
syntaxe a été vérifiée. Le conteneur PostgreSQL jetable a été arrêté et supprimé
après les tests, avec ses données temporaires.

La migration n'a été exécutée que dans la base jetable. Aucune base personnelle,
aucun VPS ni catalogue distant n'a été modifié. La purge, les procédures complètes
de sauvegarde/restauration VPS et leur validation restent à l'étape 8.

## Passation

- Les politiques de compatibilité JSON (version 1 refusée sans convertisseur) et
  de conflit de bibliothèque (échec de tout l'import) étaient des arbitrages
  d'implémentation ; elles ont été approuvées par l'utilisateur le 7 septembre
  2026 et consignées dans DECISIONS.md.
- J'ai volontairement évité de refondre le cycle de vie asynchrone du store
  pendant la séparation des données : cela aurait engagé la stratégie
  d'annulation de l'étape 4 sans ses tests de concurrence.
- Sur ce poste, Git a refusé le dépôt pour différence de propriétaire. Utiliser
  `git -c safe.directory=C:/Users/ccrepin/Documents/Gitlab/Testhand …`
  évite de modifier la configuration globale. Le sandbox a aussi bloqué
  esbuild sur la lecture de `../../../..` et l'accès au canal Docker ;
  la relance autorisée hors sandbox a permis les vérifications.
- PowerShell peut altérer les accents d'un script envoyé à Node par un pipe
  avec l'encodage par défaut ; ses apostrophes typographiques sont également
  des délimiteurs. Employer un patch ou un fichier explicitement UTF-8 pour
  les textes français, sans chercher à corriger le code après cette corruption.
- Vigilance sur `loadDeck`/`saveDeck` dans `web/src/store/deckStore.ts` : le
  scénario « sauvegarder A, quitter A, revenir à A avant la réponse » n'est
  pas éprouvé. L'identité du deck seule ne distingue pas deux ouvertures ;
  `editRevision` repart à zéro. Tester aussi deux chargements résolus à l'envers.
- Dans `web/src/worker/client.ts`, terminer le worker partagé pour annuler
  l'éditeur pourrait abandonner les deux promesses du comparateur. Définir
  d'abord qui possède chaque tâche et comment toute promesse annulée se termine.
- Je commencerais l'étape 4 par un faux worker contrôlable et une horloge simulée :
  lancer A, modifier vers B, résoudre A avant l'expiration du debounce de B ;
  vérifier que A n'est pas adopté, puis éprouver la navigation et l'annulation
  pendant une comparaison. Ce contre-exemple doit guider le versionnement
  avant de retoucher l'apparence des statistiques.
