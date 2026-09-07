# Étape 4 — recalcul

Livrée le 7 septembre 2026. Cible : le contrat « Recalcul et sauvegarde » du
[contrat métier](regles-metier.md) §6. L'étape 5 (chronologie premier/second,
sixième carte, conditions ET/OU) n'est pas commencée : le moteur, l'oracle et les
cas de référence sont strictement inchangés.

## Contre-exemple et versionnement

Le travail a commencé, comme le recommandait la passation, par un faux worker
contrôlable ([fakeWorker.ts](../web/src/worker/fakeWorker.ts)) et une horloge
simulée (Vitest), avant toute retouche d'affichage. Le contre-exemple « lancer A,
modifier vers B, résoudre A avant l'expiration du délai de B » est reproduit dans
[recompute.test.ts](../web/src/store/recompute.test.ts) en mode **naïf** : un client
qui n'annule rien. Il prouve que le versionnement suffit, à lui seul, à refuser A ;
la réponse tardive de A après l'adoption de B est refusée de même.

| Règle §6 | Réalisation |
| --- | --- |
| Invalidation immédiate | `modelVersion` avance à la mutation, avant le délai de regroupement (50 ms). Le résultat précédent reste en place, marqué `stale`, avec son propre `resultContext` (taille de deck, catégories, horizons capturés au lancement). |
| Réponse adoptée seulement si sa version est encore demandée | Chaque lancement capture sa version ; l'adoption compare `resultVersion` demandé et `modelVersion` courant. Seconde garde indépendante de l'annulation. |
| Calcul périmé annulé, ressources libérées | Toute invalidation annule la tâche en cours ; annuler la tâche que le worker exécute termine le worker (seule interruption possible d'un calcul synchrone). Testé : worker terminé immédiatement, tâche B posée sur un worker neuf, réponse tardive du worker terminé sans effet. |
| Erreur : ancien résultat obsolète, relance possible | Une exception du moteur revient comme réponse `error` portant l'id ; le store garde le résultat, pose `computeError`, et `recompute()` relance. Une annulation n'est jamais une erreur. |
| Sans résultat précédent : état initial | `result` nul et `computing` vrai ; le panneau affiche « Calcul initial des statistiques… ». |
| Aucun mélange avec un nouveau deck ou de nouveaux labels | `loadDeck` vide le résultat avant de relancer ; le panneau lit catégories et taille dans `resultContext`, pas dans l'état courant. Testé : une catégorie ajoutée n'apparaît qu'avec le résultat qui la connaît. |
| Annotations globales | HOPT et catégories n'invalident qu'après acquittement serveur, car le modèle ne change pas avant. Testé. |

## Propriété des tâches du worker

[computeClient.ts](../web/src/worker/computeClient.ts) est un module pur, sans
import Vite ni DOM ; [client.ts](../web/src/worker/client.ts) est le seul à
connaître le worker Vite. Règles, testées dans
[computeClient.test.ts](../web/src/worker/computeClient.test.ts) :

- **Un client = un worker = un propriétaire.** Le store de l'éditeur possède un
  client pour sa durée de vie et n'a jamais plus d'une tâche en cours. Le
  comparateur crée son propre client à chaque montage et le `dispose()` au
  démontage ou au changement de decks : terminer le worker de l'éditeur ne peut
  donc plus abandonner les promesses du comparateur, point signalé en passation.
- Le worker traite ses messages dans l'ordre : la première tâche attendue est celle
  qu'il exécute. L'annuler termine le worker et repose les tâches suivantes, avec
  leurs ids, sur un worker neuf. Annuler une tâche pas encore commencée la retire
  seulement ; sa réponse tardive est ignorée.
- **Toute promesse se termine** : `ComputeCancelled` après annulation ou
  `dispose`, `ComputeFailed` sur réponse d'erreur ou échec du worker lui-même
  (`onerror` : tout est rejeté, le worker est remplacé au calcul suivant). Une
  réponse dont l'id n'est plus attendu est ignorée. Un client disposé refuse toute
  nouvelle tâche par une promesse déjà rejetée.

## Affichage de l'état périmé

Le panneau de statistiques garde les dernières distributions, la matrice et la
requête visibles, **atténuées** par `opacity-45` (charte §7.15, jamais de floutage
ni de masquage), sous un bandeau d'information « Recalcul… Statistiques de la
version précédente (deck de N cartes) » et un état « Recalcul… » dans l'en-tête.
Les contrôles restent vivants : les steppers d'horizon affichent la valeur courante
et les critères de requête restent éditables ; seules les probabilités de la
requête sont atténuées. En erreur, un bandeau §7.12 « Statistiques obsolètes : le
recalcul a échoué — motif » porte le bouton **Relancer** ; sans résultat précédent,
le même bandeau est seul. Le mur de mains signale « Recalcul… notes de la version
précédente » et atténue ses mains ; pendant le calcul initial il annonce le calcul
au lieu d'inviter à charger un deck.

## Ouvertures et sauvegarde

L'identité du deck seule ne distingue pas deux ouvertures : `opening` est
incrémenté à chaque `loadDeck`, et chaque attente (bibliothèque, deck, catalogue,
brouillon) est suivie d'un contrôle. Deux chargements résolus à l'envers laissent
l'état du dernier demandé, brouillon compris (testé). `saveDeck` n'adopte sa
réponse que pour l'ouverture qui l'a demandée : le scénario « sauvegarder A,
quitter A, revenir à A avant la réponse » conserve le statut modifié de l'édition
plus récente, même à `editRevision` égale, et le brouillon comparé par contenu est
bien effacé (testé).

Conséquence assumée : une sauvegarde partie d'une ouverture précédente ne pose plus
sa révision sur le deck rouvert. Si le rechargement a lu la base avant le commit,
le prochain **Enregistrer** reçoit un 409 honnête et conserve le brouillon, plutôt
que d'écraser silencieusement le contenu sauvegardé par un état antérieur.

## Vérifications et limites

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/test-quiet.mjs
```

Résultats : **111 tests web** (9 fichiers, dont 9 nouveaux dans
`store/recompute.test.ts` et 7 dans `worker/computeClient.test.ts`), **4 tests
serveur**. La suite PostgreSQL (7 tests, conteneur jetable `127.0.0.1:55433`,
procédure de [configuration-v2.md](../deploy/configuration-v2.md)) a été exécutée
au début de la session sur le code serveur, inchangé par cette étape ; le conteneur
a été arrêté et supprimé. Vite garde son avertissement attendu sur le bloc ExcelJS.
Aucune base personnelle, aucun VPS, aucun catalogue distant touché.

Limites :

- Aucun test React ni navigateur (environnement Vitest `node`) : l'atténuation, les
  bandeaux et le comportement du comparateur au démontage sont prouvés au niveau du
  store et du client (`dispose`), pas dans un DOM. La validation visuelle est à
  regrouper avec la revue mobile de l'étape 6.
- Le coût d'une annulation est un nouveau worker par invalidation survenue pendant
  un calcul (chargement du chunk moteur). Jugé acceptable ; aucune mesure de temps
  de démarrage n'a été faite ici.
- La limite pratique de coût exact des très grands decks (§2 du contrat) n'est pas
  fixée : un tel calcul reste annulable et une exception du moteur devient une
  erreur affichée, mais rien ne le borne a priori.
- Les deltas de la grille d'annotation viennent du dernier résultat, cohérents avec
  son modèle, sans atténuation par tuile : seule l'indication du panneau signale
  leur péremption.

## Passation

- Les décisions de cette étape sont dans DECISIONS.md, section « Première mission —
  étape 4 » ; leur résumé dans docs/decisions-compressees.md.
- `web/src/worker/fakeWorker.ts` est réservé aux tests ; il appelle réellement le
  moteur pur pour produire des réponses exactes, ce qui permet d'asserter sur des
  valeurs (C(6,5) = 6) plutôt que sur des objets factices.
- Sous Git Bash, `docker run --tmpfs /var/lib/...` échoue par conversion MSYS du
  chemin : préfixer par `MSYS_NO_PATHCONV=1`, ou utiliser PowerShell comme le
  documente configuration-v2.md.
- Un heredoc Bash de plusieurs fichiers a échoué une fois sur ce poste sans cause
  identifiée ; les fichiers sources ont été écrits par l'outil d'édition, les textes
  français par un script Node lisant un JSON UTF-8 (jamais par un pipe PowerShell).
- Pour l'étape 5, le versionnement est prêt : un changement de chronologie ou de
  conditions ne demande que de passer par les mêmes mutations (`localCalc`) ; ne pas
  contourner `scheduleCompute` ni écrire `result` directement.
