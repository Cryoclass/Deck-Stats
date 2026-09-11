# Décisions & écarts vs. document de référence

## Plans de side — étape 10, partie A (contrat, migration 004, persistance), 10 septembre 2026

Plan validé, décisions du cadrage (D1–D18) et découpage 10A–10D dans
[docs/etape-10.md](docs/etape-10.md). Partie A : modèle et persistance seulement, aucune interface.

- **Le contrat valide la STRUCTURE d'un plan, jamais sa cohérence avec les zones ni son
  équilibre.** C'est la décision centrale de 10A, et elle est contre-intuitive : inscrire « une
  carte entrante vient du side » dans `parseConfiguration` rendrait le deck **non enregistrable**
  dès qu'une carte quitte le side, alors que la règle retenue (D12) est de **conserver** le plan
  et de le signaler « à revoir ». Même raisonnement pour l'équilibre (D11) : une retouche laisse
  le plan « incomplet », et un état incomplet doit pouvoir être enregistré. Sont donc refusés ici,
  et là seulement : identifiant, nom, ordre, position connue et unique par adversaire, quantités
  1–3, carte répétée dans une liste, carte à la fois entrante et sortante, clés inconnues, plus de
  32 adversaires. Deux tests nomment explicitement les non-refus (carte absente du main, plan
  déséquilibré) : ce sont eux qui tiennent la décision dans le temps.
- **Clé naturelle plutôt qu'identifiant de substitution** (écart au plan, §4 de docs/etape-10.md) :
  un plan est identifié par `(deck_id, matchup_id, position)`, pas par un uuid propre. Le couple
  adversaire + position est déjà unique, et c'est ainsi que l'API d'aperçu de 10B l'adressera —
  un identifiant de plus n'aurait fait que circuler sans jamais servir. Les adversaires, eux,
  gardent l'identifiant du client sous clé `(deck_id, id)`, comme `deck_combo_pairs` : un
  identifiant venu d'un autre deck crée une ligne dans CE deck au lieu d'en détourner une autre.
- **Les lignes d'adversaire et de plan ne sont pas remplacées en bloc** (upsert, comme
  `deck_combo_pairs`, à la différence des cartes, starters, conditions et drapeaux) : le cache
  `summary` d'un plan (étape 10B) doit survivre à un enregistrement qui ne le concerne pas —
  renommer le deck, par exemple. Un `summary` devenu faux n'est pas un risque : le client ne
  l'affichera jamais s'il ne porte pas l'empreinte courante (règle R9, mécanisme de 9A).
- **`matchups` absent = aucun adversaire, jamais une erreur** : les exports JSON et les brouillons
  antérieurs à l'étape 10 restent importables sans conversion. Le document rendu est canonique
  (nom élagué, `note` absente rendue `null`).
- **004 est rejouée dans les DEUX branches de la séquence de migration, AVANT 003.** Elle est
  additive et indépendante de la purge, donc l'ordre est libre ; le placer avant l'empreinte
  intermédiaire est ce qui garde le contrôle « 003 n'a touché que ses propres objets » exact —
  après, ses trois tables seraient vues « absentes avant » et signalées comme une altération de
  003. La branche « 003 déjà journalisée » ne rejoue donc plus le schéma seul, mais le schéma et
  les migrations additives postérieures.
- **Une carte nommée par un plan entre dans le périmètre de l'archive JSON** même si elle a quitté
  sa zone (plan « à revoir ») : elle emporte ses annotations de bibliothèque, sinon l'archive
  décrirait un plan dont les cartes n'ont plus ni profil ni étiquette après import.
- **Duplication : adversaires d'identité neuve, aucun cache repris** — la copie recalcule ses
  chiffres, comme elle recalcule son aperçu de deck.
- **Aucun fichier du calcul touché** : moteur, oracles, `engineModel.ts`, `conditions.ts`,
  `summary.ts` intacts → `__ENGINE_VERSION__` inchangé, aucun aperçu d'accueil invalidé. Le
  modèle moteur ignore structurellement les plans, ce qu'un test affirme explicitement (le deck
  de base se calcule à l'identique avec et sans adversaires).
- **`prune-stale-cards` reporte aussi les cartes des plans** (hors plan initial, ajouté après
  vérification). Le script énumère tous les emplacements de passcode ; sans ce report, une purge de
  catalogue pouvait faire entrer ET sortir la même carte d'un plan — une configuration que le
  contrat refuse, donc un deck qui ne s'enregistre plus. Aucune règle inventée : dans une même liste,
  les copies se cumulent au plafond 3 comme pour `deck_cards` (somme préservée, sauf plafonnement,
  qui rend le plan « incomplet », visible) ; dans les deux sens du même plan, **tout est annulé** et
  le plan est nommé, comme pour deux conditions à fusionner.
- **Garde « base à 003 sans 004 » ajoutée à la séquence** (cas F). Aucun cas existant ne partait de
  l'état réel de la production (003 journalisée, 004 absente) : `initdb` applique 004 dans le cas I,
  la première séquence dans F et G. La mutation « 004 non rejouée sur une base purgée » passait donc
  inaperçue alors qu'elle vise la ligne dont dépend le prochain déploiement. Les mutations sur
  `deploy/` se jouent désormais sur une **copie** du dossier : une session coupée pendant une
  mutation posée sur le vrai `lib.sh` l'avait laissé muté (restauré depuis sa sauvegarde, vérifié
  octet pour octet).
- **Le runbook « déploiement courant » reste valable avec 10A** : `deploy.sh` faisant `git pull`,
  un déploiement depuis `main` emporte 004. Elle est additive et sans question ; seules trois
  sorties attendues changent (liste de `git diff -- db`, deux lignes de rejeu, quatre lignes de
  contrôle), notées en tête de la variante. Le retour arrière du code seul reste sûr : `9d281cf`
  ignore les trois tables.

## Première mission — étape 9, partie C (extra / side éditables, runbook « déploiement courant », clôture), 9 septembre 2026

Compte rendu, preuves, mutations, questions ouvertes Q14–Q18 et compte rendu final de la mission
dans [docs/etape-9.md](docs/etape-9.md) (« Compte rendu 9C », « Clôture »). Tag `etape-9-ok`.

- **La zone est un paramètre des mutations de composition, `main` par défaut** (`addCard(carte,
  copies, zone)`, `setCopies(carte, copies, zone)`, `removeCard(carte, zone)`) : tous les appels
  existants restent valides ; le dialogue d'ajout et la tuile de zone passent leur zone. Le toast
  porte la carte **avec sa zone** ; « Annuler » la restaure dans cette zone, à la même place.
- **Extra et side ne recalculent jamais** (`zoneMutation` : main → `localCalc`, sinon `markDirty`
  seul). Le modèle moteur ne lit que `main` (contrat §2, `buildEngineModel` intouché) : le
  résultat reste frais et l'aperçu joint à l'enregistrement aussi (prouvé par la garde Z4 :
  résumé écrit malgré une mutation side). Brouillon et configuration transportent déjà les trois
  zones depuis l'étape 3 ; rien à changer côté serveur.
- **Convention 1–3 par carte ET par zone** (la même carte peut être en main et en side) ; le refus
  nomme la zone. Repère de **15** en extra / side (Q5) = avertissement seulement (compteur ambre
  du bloc, bandeau du dialogue), jamais un refus, aucun repère bas ; le main garde 40–60.
- **Un bloc par zone, toujours rendu** — même sans main deck, même vide, sinon aucun ajout n'est
  possible — sous un seul repli « Extra / Side » (état `extraSideHidden` conservé). Tuile de
  **80 px** = image + stepper à 32 px, rien d'autre : aucune annotation, aucun delta, aucun
  menu ⋯ (ces zones n'ont ni rôle ni statistique). « + Ajouter » à 32 px ouvre le dialogue **sur
  la zone** (titre, compteur, plafond et repère de la zone).
- **Le test d'équivalence de 6A n'est pas modifié ; un cas « trois zones » lui est ajouté** :
  création manuelle, YDK (`#extra` / `!side`) et JSON v2 donnent les mêmes cartes par zone, et
  le modèle moteur est strictement égal au modèle « main seul » pris **avant** la saisie de
  l'extra et du side. Dit explicitement : le modèle moteur ne dépend pas de ces zones.
- **Runbook : variante « déploiement courant » en tête** (C0–C6), pour toute base non vide à 003
  sans migration : sortie attendue commande par commande (schéma seul rejoué, « 003 déjà
  journalisée », aucune question), effectifs notés avant / après, retour arrière à deux niveaux
  (code seul par `git checkout` + build + up ; données par l'archive pré-migration réelle de
  `deploy.sh` via `restore.sh`), toute question = `NON`. Preuve locale = cas « F, rejeu » de
  test-migration-sequence.sh. `rehearsal.sh` n'est pas prévu pour une archive déjà à 003 (son
  recalcul attend l'ancien modèle) : question ouverte, `restore.sh --check-only` à la place.
- **Aucun test existant modifié** ; moteur, oracles, migrations et `engineModel.ts` intacts
  (`__ENGINE_VERSION__` inchangé : 9C n'invalide aucun aperçu) ; aucune base personnelle ni VPS ;
  conteneurs jetables supprimés.

## Première mission — étape 9, partie B (attente de la DB, vue transitoire, mode combiné), 9 septembre 2026

Compte rendu, preuves, mutations et questions ouvertes Q9 / Q10 dans
[docs/etape-9.md](docs/etape-9.md) (« Compte rendu 9B »). Tag `etape-9b-ok`.

- **L'attente de la base exige le marqueur de l'entrypoint PostgreSQL, jamais une simple
  connexion.** Le serveur temporaire d'initialisation d'un volume neuf annonce lui aussi
  « ready to accept connections » et répond à `pg_isready` comme à `select 1` par le socket
  (incident 8C, reproduit sur conteneur jetable). `db_ready` (lib.sh) exige, dans l'ordre :
  `healthy` si une healthcheck existe ; dans les journaux du démarrage courant, le dernier
  « ready » **après** « PostgreSQL init process complete » (volume neuf) ou « Skipping
  initialization » (volume déjà initialisé) ; puis `select 1`. Écart au plan validé (« quand
  cette ligne existe ») : la règle littérale acceptait la fenêtre du serveur temporaire, dont le
  « ready » précède le marqueur ; un marqueur est exigé dans tous les cas. Healthcheck Compose
  intouchée (Q6). `deploy.sh` utilise `db_ready`. Preuve : cas I (témoin du premier `select 1`
  réussi sans marqueur, séquence lancée aussitôt en code 0).
- **Journaux lus depuis `StartedAt`** (`docker logs --since`) : bornés sur un conteneur qui
  tourne depuis des semaines, et un démarrage précédent n'y figure jamais ; sans `--tail`, qui
  aurait pu couper le marqueur.
- **La vue du panneau de stats est transitoire comme le contexte.** Retirée des params émis,
  acceptée en lecture (validateParams, remap d'archive, export de l'accueil qui joint encore la
  catégorie référencée), ignorée à l'ouverture. Changer de vue ne salit pas (test) ; le curseur
  d'importance reste enregistré (Q3).
- **Mode Non-engine combiné : une règle unique `nonEngineEffect`** (lib/nonEngine.ts) pour ce qui
  est envoyé (store) et ce qui est annoncé (tuile, bandeau). Conforme = étiquette portée et, si
  un profil est demandé, exactement ce profil ; conforme → retrait de l'étiquette puis du profil
  devenu orphelin ; sinon pose de ce qui manque, l'étiquette d'abord (le serveur exige une
  étiquette avant un profil). Deux requêtes au plus, dans la file globale, adoptées après
  acquittement ; un refus arrête la paire.
- **Valeur par défaut du déroulant : « profil inchangé »** (étiquette seule, comportement d'avant
  9B) — la fixture e2e reste intacte et un clic ne pose jamais un profil que personne n'a choisi.
  Profils en éléments radio (`menuitemradio`) : un profil et une étiquette de même nom (« Board
  breaker ») ne se confondent pas dans le même déroulant. Mode Profil conservé (Q4).
- **L'effet du prochain clic est annoncé sur la tuile** (badge « poser » / « retirer ») et dans le
  bandeau au survol : sur tactile, le survol n'existe pas, la tuile reste lisible seule.
- **Le retrait de la dernière étiquette retire le profil même en « profil inchangé »** : un profil
  sans étiquette ne mesure rien (Q1 de 5B) et resterait orphelin — question ouverte Q9.
- **Aucun test existant modifié** ; moteur, oracles, migrations intacts ; aucune base personnelle
  ni VPS ; conteneurs jetables supprimés. Un échec non reproduit de l'e2e `setup` sous charge
  concurrente (test A–I simultané) est consigné : ne pas lancer les deux en même temps.

## Première mission — étape 9, partie A (aperçus, finitions de 7B), 9 septembre 2026

Plan validé, réponses Q1–Q8, compte rendu et mesures dans [docs/etape-9.md](docs/etape-9.md).
Découpage 9A (points 1 et 2) / 9B (attente de la DB, vert intempestif, mode combiné) / 9C
(extra et side, runbook « déploiement courant », clôture). Tag `etape-9a-ok`.

- **Version du moteur = empreinte des sources du calcul** (`__ENGINE_VERSION__`, SHA-1 tronqué
  de `engine/*.ts` hors tests et référence, `engineModel.ts`, `conditions.ts`, `summary.ts`,
  calculé par `vite.config.ts`). Jamais une constante à incrémenter à la main (oubli garanti) :
  un commentaire changé invalide tous les aperçus, accepté (recalcul de 0,5 à 2 s pour 16 decks).
  Le serveur stocke la chaîne sans la connaître ; seule `usableSummary` (client) décide.
- **`decks.summary` reste un cache d'affichage, jamais une source de vérité** (contrat §1). Trois
  garanties : (1) à l'enregistrement, le résumé n'est joint que si le résultat courant est celui
  de la version demandée pour cette ouverture (`summaryOfState` : ni périmé, ni en cours, ni
  d'un autre deck) — sinon il reste absent ; (2) le serveur le refuse s'il ne décrit pas la
  composition enregistrée (`mainSize`) et le remet à NULL à toute écriture de configuration ou
  de bibliothèque (règle existante) ; (3) à l'accueil, tout résumé absent, malformé ou d'une
  autre version est recalculé avec le moteur courant, jamais affiché tel quel.
- **Recalcul à la demande à l'accueil, passe premier seule** (mode `first` du worker, hors
  moteur ; `second` rendue indisponible par la convention du moteur, `total === 0` + motif,
  jamais copiée ni approximée). Client de calcul propre à l'accueil (comme le comparateur),
  file séquentielle, disposé au démontage ; persistance par `PUT /decks/:id/summary` avec la
  révision lue, 409 ignoré (le deck a bougé, l'accueil suivant recalculera). Renommer un deck ne
  relance rien (clé stable des decks à recalculer).
- **Valeurs de l'aperçu = valeurs du panneau** : `startRateFirst` = cumulé « au moins 1 » de la
  vue Départs (`cumulativeOf`), `brickRate` = `pass.brick`, même chemin que `dataIdentity` ;
  arrondi au rendu (0 décimale), valeur fine (2 décimales) dans l'infobulle. Champs conservés
  tels quels (Q2) malgré leur redondance (l'un vaut 1 moins l'autre).
- **Mur sous 640 px : récapitulatif compact empilé** (« S n » sur « U n ») plutôt que « S 3 · U 1 »
  sur une ligne : six cartes à 360 px ne laissent que ~80 px à droite ; cartes de 60 px (68 dès
  640 px), note de 28 px, ligne de 65 px mesurée → huit mains par écran au lieu de cinq. Cartes
  jamais déformées (7B).
- **« ↻ Nouvelles mains » à 32 px en style neutre** : action primaire du mur par la taille, pas
  par la couleur (un seul bouton émeraude par écran, Enregistrer).
- **Δ jamais compact** (`MatrixGrid compact={false}`) : en pleine largeur sous 640 px, il a la
  place des cellules de 32 px à 10 px.
- **Densité de la grille close à 96 px.** 84 px mesuré à 1440 : les trois cibles de 32 px
  tiennent mais le delta « −1 : −6.38% » (53 px) est coupé dans 49 px (garde M4) ; ni le format
  du delta ni les cibles ne bougent → 9 colonnes à 1440, 3 à 360, garde de comptage ajoutée.
- **Arbre ET/OU profond : mise en page conservée, commandes portées à 24 px.** Validée à 1440 et
  360 px sur ET > OU > OU (et OU > OU > OU par un premier passage) ; les sélecteurs (23 px), le
  champ « ≥ n » (18 px) et le ✕ (16 px) étaient sous le minimum « ailleurs » du contrat §6 :
  `h-6` — considéré comme « cassé » au sens du contrat, seule correction.
- **Seul test existant modifié** : garde P7 « Nouvelles mains » 24 → 32 px (annoncée dans le
  plan). Les autres gardes sont ajoutées (`home`, `conditions`, P3 Δ, P7 compact, colonnes).
- Rappels tenus : moteur, oracles, migrations et deploy/ intacts ; aucune base personnelle ni
  VPS ; conteneurs jetables supprimés.

## Première mission — étape 8, partie C (exécution VPS), 8 septembre 2026

Compte rendu et incident dans [docs/etape-8.md](docs/etape-8.md) (« Compte rendu 8C ») ;
procédure dans [docs/deploy-runbook.md](docs/deploy-runbook.md) (variante « départ à vide »,
V4 complété). Clôture consignée le 9 septembre 2026, documentation seule, tag `etape-8-ok`.

- **L'étape 8 est terminée.** 8C exécutée sur le VPS par l'utilisateur le 8 septembre 2026,
  variante « départ à vide », code `9d281cf` : archive souvenir vérifiée et copiée hors VPS,
  volume recréé, 001–003 jouées à vide par `initdb`, `deploy.sh` sans aucune question, catalogue
  par `migrate-cards.js`, compte, contrôles V7, app en service. La production est sur le modèle
  v2 purgé, base neuve ; l'archive souvenir est la seule trace de l'ancien état.
- **Incident consigné, `deploy.sh` non corrigé dans cette session.** Au premier `deploy.sh` sur
  le volume neuf, l'attente `until pg_isready -q -U ygo -d ygo` (socket Unix) a accepté le serveur
  temporaire que l'entrypoint PostgreSQL lance pour jouer `docker-entrypoint-initdb.d` ;
  l'empreinte initiale (`fingerprint-0.txt`) a échoué pendant son extinction (« the database
  system is shutting down »), code 1, rien d'appliqué par la séquence, aucune app ; le second
  `deploy.sh` a été conforme (code 0). Décision : consigne manuelle dans le runbook (V4 : sur un
  volume neuf, attendre l'état `healthy` du conteneur `db` et le second « ready to accept
  connections », pas une simple connexion) et report « attente de la DB fondée sur `healthy` »
  dans l'étape 9 ; aucun code touché à la clôture de 8. Point d'attention transmis : la
  `healthcheck` de Compose utilise le même `pg_isready` par le socket, la correction devra prouver
  qu'elle exclut la fenêtre du serveur temporaire (volume neuf, conteneur jetable).
- **Le cas n'avait pas été vu en local** parce que le conteneur jetable 55443 était démarré et
  initialisé avant l'appel de la séquence ; la preuve « initdb puis séquence » ne couvrait pas
  « séquence lancée pendant initdb ». Les codes de retour (annexe A) et la garde « base vide =
  aucune question » ont tenu.
- **Questions ouvertes après 8** : Q11 (`ygo_previous`) conservée ; Q12 / Q13 sans objet tant
  qu'aucun déploiement sur base conservée n'est prévu ; équivalence `--emit-sql` / `--apply` de
  `prune-stale-cards` non prouvée depuis 8A.

## Première mission — étape 8, préparation de 8C (« départ à vide »), 8 septembre 2026

Compte rendu, preuves et passation dans [docs/etape-8.md](docs/etape-8.md) (« Préparation de
8C : départ à vide ») ; procédure dans [docs/deploy-runbook.md](docs/deploy-runbook.md)
(variante « départ à vide », V1–V7).

- **La production repart d'une base vide.** Décision de l'utilisateur après 8B : rien n'est
  conservé (ni decks, ni comptes, ni annotations). L'archive de l'état actuel est prise,
  vérifiée (`backup.sh --keep souvenir`, app arrêtée) et copiée hors VPS par principe, mais
  elle n'est plus un chemin de retour à préparer : la répétition sur archive fraîche (§0),
  l'empreinte attendue `e0efff5c…` et la ressaisie des 185 paires globales n'ont plus d'objet ;
  §7 (retour arrière) reste valable avec l'archive souvenir. Les decks utiles se réimportent
  depuis leurs fichiers YDK.
- **Base vide = volume recréé, initialisé par les fichiers montés.** Chemin principal du
  runbook : `down`, `docker volume rm ygo-proba_pgdata`, `deploy.sh`. Le premier démarrage du
  conteneur `db` joue schéma, 001, 002 et 003 (rien à purger, journalisée sans acceptation) ;
  la séquence de `lib.sh` trouve 003 journalisée et ne pose **aucune question** (prouvé : code 0,
  17 s). Toute question posée par `deploy.sh`, tout rejeu de 001, tout inventaire à 14 tables
  ou à paires non nulles signifie que la base n'était pas vide : répondre `NON` (code 3, rien de
  purgé), arrêter, comprendre. Aucun script n'a eu à changer pour ce chemin.
- **Le catalogue n'arrive ni à l'initialisation ni au démarrage de l'app.** Il est copié par le
  script embarqué `migrate-cards.js` depuis le conteneur `app` (Supabase publique, clé anon par
  défaut, upsert idempotent, estampille `catalog_version`) : 14 529 cartes, version `2026-08-31`,
  13 à 16 s, 22 Mo. `/api/health` passe de `cards: 0, catalog: null` au nombre annoncé par la
  source, égal à `catalog.cards`. Le premier remplissage par `pg_dump` local (deploy/README.md §5)
  est historique.
- **Le contrôle « tables intactes de bout en bout » traite la base vide au départ comme un cas
  légitime.** Manque révélé par la preuve : sur une base sans aucune table (base `ygo` recréée
  sans `initdb`), 001 / 002 / 003 se journalisaient sans question mais le contrôle rendait KO
  (« absente avant ») et laissait l'app arrêtée (code 2). Question posée, réponse « les deux » :
  `check_after_migration` reconnaît une empreinte initiale sans table et exige alors que les
  tables conservées existent et soient vides après (KO nominatif sinon) ; cas G (base vide,
  code 0 sans question, rejeu) et H (table conservée remplie après 003 → code 2) dans
  `test-migration-sequence.sh`. Le chemin des bases non vides est inchangé ; `rehearsal.sh
  --fixture` rejouée. L'alternative `dropdb` / `createdb` du runbook repose sur ce correctif.
- **Preuve sur conteneurs jetables, jamais sur une base personnelle ni sur le VPS ;** la Supabase
  publique a été lue (comptage et copie du catalogue) parce que la tâche le demandait
  explicitement. Les scripts de preuve restent hors dépôt (scratchpad), leurs résultats sont
  consignés dans docs/etape-8.md.

## Première mission — étape 8, partie B, 8 septembre 2026

Le [compte rendu 8B](docs/etape-8.md) contient le rapport de répétition sur le dump réel, les
preuves, les mutations et la passation vers 8C ; [docs/deploy-runbook.md](docs/deploy-runbook.md)
est la procédure d'exécution.

- **D3 concrétisée : une sauvegarde n'est « vérifiée » que restaurée.** `backup.sh` écrit
  `<archive>.sha256` puis restaure l'archive dans `ygo_verify` (recréée, supprimée après) et
  n'écrit `<archive>.fingerprint` (`fingerprint.sql` : effectif et md5 des lignes triées par
  table, réglages de session fixés) qu'à ce moment. La ligne `sauvegarde ok: …` garde son
  format et précède la vérification : le cron reste lisible tel quel ; un échec de
  vérification conserve l'archive, ajoute `sauvegarde NON vérifiée: …`, n'écrit aucun
  `.fingerprint` et rend 1 — `restore.sh` refusera cette archive sans `--without-fingerprint`.
  En cron l'app tourne : l'empreinte vivante est prise avant et après l'export, une table
  qui a bougé (`sessions`) est « non vérifiable », pas un faux positif ; en
  `--pre-migration` (app arrêtée) toute table qui bouge est un échec.
- **Rétention.** `find -maxdepth 1 -name 'ygo-*.sql.gz*' -mtime +14` : `keep/` (archives
  pré-migration et pré-restauration) est hors rétention, les compagnons partent avec
  l'archive. Comportement par défaut inchangé (aucun sous-dossier n'existait).
- **`restore.sh` restaure par bascule de bases.** Restauration de contrôle dans
  `ygo_restore`, comparaison ligne à ligne au `.fingerprint` (la moindre différence est un
  refus, rien n'est modifié), confirmation « OUI » (ou `--yes`), sauvegarde de sécurité
  vérifiée dans `keep/ygo-pre-restauration-*`, puis `ygo` → `ygo_previous` et `ygo_restore` →
  `ygo` (maintenance depuis la base `postgres`), empreinte relue. Ce qui a été vérifié est
  exactement ce qui est servi ; deux retours arrière (archive de sécurité, base précédente).
  `--check-only` vérifie une copie hors VPS sur un conteneur jetable (runbook, avant OUI).
- **Une seule séquence, dans `lib.sh`, avec des crochets d'app.** `deploy.sh` et
  `rehearsal.sh` appellent la même `run_migration_sequence` ; `deploy.sh` ne porte que
  Compose (`build`, `stop`, `start`, `up -d`). C'est ce qui rend la séquence testable hors VPS
  (`test-migration-sequence.sh`, six cas) et mutable « comme deploy.sh ». D2 appliquée :
  succès = code 0 **et** marqueur (« SIMULATION TERMINÉE », « PURGE APPLIQUÉE ») ; un code 0
  sans marqueur est un échec (cas C).
- **États d'échec, Q8 précisée.** Échec avant 003 (sauvegarde, schéma, 001, 002 :
  transactions annulées) → ancien conteneur relancé, base intacte (code 1). 003 refusée en
  simulation, en échec à l'application, ou rapport refusé (« OUI » absent, `--accept`
  différent, pas de terminal) → nouvelle app démarrée sans 003 (codes 1 et 3). Seul un
  contrôle après migration en échec laisse l'app arrêtée, la commande de restauration de
  l'archive pré-migration affichée (code 2).
- **001 et 002 ne se rejouent plus une fois 003 journalisée.** Découvert par le cas de rejeu
  (F) : 001 recrée `deck_requirements` sans condition et 003 refuse ensuite tout rejeu
  (« objet historique réapparu »). 001, 002 et 003 restent intouchées ; la séquence saute
  001 / 002 quand le journal porte 003 et rejoue toujours le schéma (bloc conditionnel D1).
  Alternative écartée : conditionner 001, contraire à « 001 et 002 ne changent pas ».
- **Contrôles après migration.** `check-migration.sql` (journal 001 / 002 / 003, objets
  historiques absents, objets v2 présents, aucun horizon, sources uniques) plus empreintes :
  tables intactes de bout en bout (`cards`, `catalog_version`, `users`, `user_identities`,
  `sessions`, `deck_cards`, `deck_starters`, `card_categories`) et périmètre de 003 (après
  002 → après 003 identique hors `app_migrations`, `card_flags`, `nonengine_categories` et
  tables supprimées). Une ligne `KO|` suffit.
- **Inventaire avant 001.** Effectifs par table, journal, résumés (que 001 met à NULL) et
  modèle historique en JSON (paires, exclusions, prérequis source paire), écrits dans le
  dossier de sortie ; identifiants internes et noms de decks seulement.
- **Recalcul : la référence est l'ancien moteur, jamais le résumé stocké.** Première
  exécution sur le dump réel contre `decks.summary` : 12 decks exacts, 4 avec un résidu. Le
  résumé est un cache de la dernière sauvegarde que l'ancienne app n'invalidait pas quand
  une paire globale bougeait ; le reproduire n'est pas l'objet du contrôle (l'étape 9 le
  recalcule). Décision : la référence est calculée par l'ancien moteur e890078 (celui de la
  production, extrait par `git show` dans `deploy/out/reference-engine-e890078/`, jamais
  versionné) sur `ygo_old` (archive pré-migration restaurée) avec l'ancien modèle ; (a)
  nouveau moteur avec paires réinjectées attendu identique à 1e-9, (b) écart après purge
  attribué et chiffré ; le résumé stocké n'est qu'une colonne informative. Les heuristiques
  intermédiaires (sous-ensemble de paires, préfixe par ordre physique, trace, budget) ont été
  retirées. Résultat : 16 / 16 identiques en (a) à 1e-12.
- **Gardes e2e sur une base fournie.** `run.mjs --db <url> --db-container <nom>` : aucun
  conteneur créé ni démonté, schéma et migrations non rejoués, cartes synthétiques
  insérées ; `cardsSql` ne comble que les images manquantes (`coalesce`) parce que le jeu
  représentatif partage les passcodes 9000xxxx sans image. Aucun scénario modifié.
- **Jeu représentatif rejoué comme une archive.** `rehearsal.sh --fixture` construit la base
  pré-001, fabrique les résumés (`--fabricate`), archive par `pg_dump` puis suit le chemin
  d'une archive réelle : un seul chemin de code.
- **Postes Windows.** `lib.sh` exporte `MSYS_NO_PATHCONV=1` (Docker) et fournit `host_path`
  (cygpath) pour les chemins destinés à Node. Un retour arrière est tombé une fois parce que
  `restore.sh` a été modifié pendant que la répétition l'exécutait (bash lit un script au fil
  de l'eau) ; non reproduit ensuite, consigne ajoutée à AGENTS.md.

## Première mission — étape 8, partie A, 8 septembre 2026

Le [compte rendu 8A](docs/etape-8.md) contient l'inventaire prouvé, le plan validé, les
réponses Q1–Q10, le rapport de simulation sur le dump réel et la passation vers 8B.

- **Inventaire prouvé avant tout code.** Catalogue relevé sur un PostgreSQL jetable après
  schéma + 001 + 002 (tables, colonnes, index, contraintes, dépendances : aucune vue ni
  trigger) et références de code par grep. Restes : `combo_pairs`, `deck_pair_exclusions`,
  `deck_start_requirements`, `deck_requirements`, `nonengine_categories.relevance`,
  `card_flags.dead_first` / `dead_second` ; `decks.summary` n'en fait pas partie (cache
  invalidé, recalcul à l'étape 9, Q9).
- **D1 : `schema.sql` garde un bloc « Modèle historique » conditionnel.** La migration 001
  lit `deck_start_requirements` et `card_flags.dead_*` sur une base neuve, et 001/002 ne
  changent pas : le schéma doit donc encore créer ces objets, mais seulement tant que 003
  n'est pas journalisée, sinon chaque rejeu du schéma (à chaque déploiement, avant les
  migrations) ressusciterait des tables vides. Le bloc est un `do $$` qui interroge
  `app_migrations` par SQL dynamique (la table peut ne pas exister) ; 003 refuse à chaque
  rejeu tout objet réapparu, et la suite le prouve en rejouant le schéma après la purge.
  `relevance` reçoit un défaut `'both'` pour que l'API cesse de l'écrire sans casser la
  suite persistence, qui s'arrête à 002. Alternative écartée : schéma en état final avec
  journal pré-rempli, qui aurait touché 001/002 par ricochet.
- **« Non convertie » a une définition vérifiable.** Le contenu des conditions ne prouve rien
  (l'utilisateur peut les avoir éditées après 002). 003 s'appuie sur des invariants
  structurels : un prérequis historique source carte est converti si son id est dans
  `deck_requirements` (001 copie les ids, la table n'est plus jamais écrite) ; un prérequis
  v2 est converti si sa (deck, source) porte une condition. Tout écart est nommé (deck, id,
  cartes) et arrête la migration sans rien modifier, de même qu'un horizon résiduel.
- **Purge exacte annoncée = empreinte du rapport.** Le rapport (P1–P6) est produit avant
  toute suppression ; son md5 (lignes triées) doit être fourni par `testhand.purge_accept`
  pour appliquer dès qu'une ligne est purgée. Une paire apparue depuis la simulation change
  l'empreinte et bloque (testé). Rien à purger = aucune acceptation, pour les bases neuves
  (initdb, e2e). L'acceptation vaut périmètre explicite de comptes (Q1 : tous, rapport par
  compte).
- **D2 : simulation = exécution réelle dans une sous-transaction annulée volontairement.**
  Le fichier reste du SQL pur (exécutable par psql et par le pilote pg des tests) ; le mode
  est une GUC de session posée avant le fichier. En simulation, suppressions et contrôles
  après sont réellement joués puis annulés par une exception interne (SQLSTATE `TH003`)
  attrapée dans le bloc ; la migration se termine normalement (code 0) sur la ligne
  « SIMULATION TERMINÉE », distincte de tout échec (exception, code 3 sous psql). Rapport
  émis à la fois par `select` (stdout) et `raise notice`, depuis la même table temporaire :
  aucune divergence possible entre ce qui est simulé et ce qui est appliqué.
- **Q5 : `dead_first` / `dead_second` purgés.** Copiés par deck par 001, jamais lus par
  l'API ; seul prune-stale-cards les fusionnait. Les lignes à drapeau vrai sont rapportées
  (P6) avant suppression des colonnes.
- **prune-stale-cards refuse avant 003 et ne tranche jamais un conflit (Q6).** L'outil
  reporte les emplacements v2 : paires par deck (collision → survivante non concernée par le
  report, porteuse de la note ; paire devenue (X, X) supprimée avec ses conditions, comptées),
  conditions (source carte, source paire, feuilles JSON), drapeaux par deck (OU), profils et
  plafonds (repris s'ils manquent). Deux conditions à fusionner ou des profils contradictoires
  annulent toute la transaction en nommant le conflit : une seule condition par source
  (contrat §4) et une annotation manuelle ne se devinent pas.
- **jsonpath en mode strict, obligatoire.** En mode lax, `$.**` rend chaque élément de
  tableau deux fois (6 feuilles comptées pour 3) ; constaté en base, corrigé en `strict` pour
  le comptage des références et la localisation des feuilles à réécrire.
- **Le rapport ne porte que des identifiants internes**, des noms de cartes (catalogue), de
  decks et de catégories, et les notes des paires ; jamais d'email ni de nom de compte, pour
  pouvoir être joint à la documentation et relu.
- **Suite `purge.integration.ts` séparée, aucune suite existante modifiée.** Elle réinitialise
  le schéma public de la base jetable, seulement si la base est vide ou porte les fixtures
  d'une suite du dépôt (même garde d'URL que persistence) ; faux Supabase HTTP local
  (≥ 10 000 ids) pour prune-stale-cards ; fixture `legacy-representative.sql` = base de
  production pré-001 à identifiants fixes. `npm run test:integration` enchaîne persistence
  puis purge.
- **`deploy.sh` ne rejoue pas encore 003** : exception assumée à la règle « nouvelle
  migration = rejeu dans deploy.sh », parce qu'un rejeu naïf refuserait (acceptation
  requise) ; l'intégration avec sauvegarde, simulation, acceptation et contrôles est le
  point 5 (8B). Un déploiement lancé maintenant appliquerait 001 et 002 seulement ; la
  nouvelle app fonctionne sans 003 (Q8).
- **Piège d'outillage** : `String.prototype.replace` interprète `$$` (→ `$`) et `$1` dans la
  chaîne de remplacement ; un patch de `schema.sql` par script a perdu ses `do $$` avant
  d'être repris avec une fonction de remplacement. Consigné dans AGENTS.md.
- **Dump réel joué en simulation dès 8A** (Q3) sur conteneur jetable : 185 paires globales,
  15 exclusions, 15 prérequis tous source carte (convertis en 14 conditions par 002), 4
  pertinences, aucun drapeau ; puis purge appliquée sur la copie avec l'empreinte,
  conditions, cartes et starters identiques avant/après, rejeux sans effet. Le dump reste
  hors dépôt.

## Première mission — étape 7, partie B, 8 septembre 2026

Le [compte rendu 7B](docs/etape-7.md) contient les verdicts par point et par largeur,
les corrections, les gardes ajoutées, le contrôle par mutation et les questions ouvertes.

- **Q3 tranchée : cellules compactes, pas de bande à défilement.** À 360 et 390 px, A et B
  s'empilaient (cartes de 296 px dans 320 px utiles). Sous 640 px, A et B occupent chacune
  une colonne d'une grille de deux colonnes ; les cellules passent à 9 px avec un
  espacement de 1 px et **20 px minimum par colonne** — sans ce minimum, une colonne ne
  contenant que « · » s'écrasait à 14 px et ses en-têtes « 4 » et « 5 » se touchaient ; le
  coin devient « S\U » ; le conteneur et les cartes se resserrent pour laisser 8,5 px de
  marge (police système différente sur Android / iOS). Δ passe en dessous en pleine
  largeur. La capture `mobile-360-matrices.png` (DPR 2) montre des cellules distinctes et
  lisibles : le repli prévu n'a pas été nécessaire.
- **Q4 appliquée** : Exporter Excel et ⇄ Inverser A/B en `py-2` (32 px), ✕ du dialogue en
  `h-8 w-8` avec `title="Fermer"` (même recette que l'aperçu d'import) ; Comparer mesurait
  déjà 32 px.
- **En-tête du comparateur : même convention que l'accueil en 6B.** Sans `flex-wrap`, rien
  ne débordait mais les libellés se coupaient sur deux à trois lignes et les noms A / B se
  tronquaient à « A. … ». Les gardes de départ (débordement, cibles) ne le voyaient pas :
  elles ont été renforcées (libellés sur une ligne, noms ≥ 40 px) avant la correction,
  pour que la garde échoue d'abord. Les noms prennent la place restante (`flex-1 basis-0
  truncate`) : ils cèdent en premier, les actions passent à la ligne sous 400 px.
- **Mur de mains : passer à la ligne plutôt qu'écraser.** Les vignettes de 68 px de haut
  étaient comprimées à 28 px de large en second à 360 px (ratio 0,41 au lieu de 59/86).
  Décision : bande de cartes `shrink-0` (jamais déformée) et ligne de main `flex-wrap`, le
  récapitulatif départs / non-engine / note passant à la ligne sous 640 px — la règle de la
  charte §6.3 (« passer à la ligne au lieu de déborder ou d'écraser »). Coût assumé : une
  main mesure 124 px de haut au lieu de 80 sous 640 px. L'alternative d'un récapitulatif
  vertical compact sans libellés n'est pas tranchée (question ouverte).
- **Gardes avant corrections, verdicts avec captures.** Le scénario `mobile` a été écrit et
  joué avant toute correction : le premier passage a produit le tableau « cassé /
  conforme » par point et par largeur, puis les corrections ont été limitées aux points
  cassés (P1, P2, P3, P7 ; P4, P5, P6, P8 intacts). Une garde initiale de P4 était fausse
  (elle ignorait le signe « − » U+2212 de `fmt.ts`) : corrigée comme défaut de garde, sans
  toucher l'écran.
- **Export non bloquant dans le scénario.** Un téléchargement impossible (bouton hors
  viewport avec la mutation X1) est enregistré comme garde en échec au lieu de lever une
  exception qui aurait masqué les autres verdicts de la largeur.
- **Contrôle par mutation sur les CSS** : sept erreurs volontaires (en-tête sans
  `flex-wrap`, police 8 px, `grid-cols-1`, ✕ 24 px, bande sans `shrink-0`, Exporter 28 px,
  `min-w-5` retiré), toutes détectées par les gardes `mobile`, fichiers restaurés et
  vérifiés par empreinte.
- **`MSYS_NO_PATHCONV=1` vérifié** : la suite PostgreSQL jetable 55433 passe depuis Git
  Bash avec cette variable (11 tests) ; consigné dans AGENTS.md à côté de la consigne
  PowerShell.
- **Hors périmètre, non tranché** : densité du mur sous 640 px, « ↻ Nouvelles mains » à
  24 px (conforme au contrat, action secondaire), Δ compacte sous 640 px, reports 6B sur la
  grille d'annotation (9 colonnes à 1440 px) et l'arbre ET/OU profond — listés dans
  docs/PLAN.md.

## Première mission — étape 7, partie A, 8 septembre 2026

Le [compte rendu 7A](docs/etape-7.md) contient le plan validé, l'inventaire des deltas
(D1–D7), les réponses Q1–Q6 et la passation vers 7B.

- **« · » signifie zéro exact, jamais une faible valeur.** L'écran affichait « · » pour une
  cellule de matrice sous 0,05 % et pour un delta de synthèse sous 0,05 pt (ou 0,005
  carte), alors que l'Excel réserve « · » au zéro exact (`0.0%;-0.0%;"·"`,
  `+0.0%;-0.0%;"·"`) et que le contrat §5 dit qu'un symbole pour une faible probabilité ne
  doit pas signifier zéro. Décision : un seul jeu de formateurs (`matrixCell`,
  `deltaPoints`, `deltaCount` dans `lib/fmt.ts`) aligné sur les formats Excel, utilisé par
  la matrice du panneau, les matrices A / B, la matrice Δ et la synthèse ; « 0.0 » et
  « +0.0 » sont acceptés ; l'infobulle garde la valeur fine. L'arrondi n'a lieu qu'au
  rendu (Q1, Q2 confirmées par l'utilisateur).
- **La couleur du delta de synthèse suit le signe du delta exact**, favorable ou non selon
  la direction de l'indicateur, neutre seulement pour le zéro exact — comme les règles
  `lessThan 0` / `greaterThan 0` de la mise en forme conditionnelle de l'Excel. Le seuil
  `negligible` masquait la direction d'un petit écart réel (D1).
- **`engine/compare.ts` est traité comme le moteur** (Q6) : intouché. L'assemblage du
  comparateur (`comparisonDeckOf`, `unprofiledWarning`) et les seaux du panneau
  (`toBuckets`, `cumulativeOf`, `resolveView`) sont extraits sans changement dans
  `web/src/lib/` pour que le test d'identité suive exactement le code de l'écran au lieu
  de réécrire ses formules — un test qui reformule les formules prouverait la formule,
  pas l'écran.
- **Identité prouvée nombre pour nombre.** Matrice du panneau (mode `full`), matrice du
  comparateur (mode `passes`) et cellules Excel sont comparées en égalité stricte : le
  même moteur sur la même entrée produit les mêmes flottants, une tolérance aurait laissé
  passer un arrondi à quatre décimales. Les agrégats sont comparés à 1e-12 (ordre de
  sommation différent), et les formules Excel sont recalculées par un évaluateur écrit
  dans le test pour la grammaire réellement émise (références, `'Feuille'!$H$6`,
  `SUM(plage)`, `+ − *`) : sans lui, une plage ou un signe faux dans une formule resterait
  invisible, ExcelJS n'évaluant rien. Le deck de test contient un plafond partagé et une
  carte étiquetée sans profil, dont la contribution nulle est prouvée par différence
  (retirer l'étiquette ne change ni U ni la matrice, mais change les copies brutes).
- **Gardes visuelles dans le dépôt** (option A, Q5) : `web/e2e/` avec `playwright-core` en
  devDependency de `web` (aucun téléchargement de navigateur ; Chrome installé ou
  `E2E_BROWSER`), `npm run e2e -w web` hors `npm test` et hors `test-quiet.mjs` parce
  qu'elle exige Docker et Chrome. `run.mjs` monte et démonte lui-même une pile jetable
  (55434 / 8790 / 5174, compte `e2e@example.test`) : aucune commande manuelle, aucun
  risque de pointer la base de dev. Les processus serveur et Vite sont **détachés** et
  journalisés sur descripteur de fichier : avec des tubes, ils mouraient à la fin du
  script (`--keep`) sur EPIPE. `--keep` / `--attach` / `--down` servent à itérer en 7B.
- **Portage fidèle de 6B** : M1–M6 et la préparation des decks reprennent les mêmes
  sélecteurs et mesures que les scripts du scratchpad (stepper 32 px, en-tête et bandeau
  sans débordement, zone de fichier lisible, delta sur une ligne, delta atténué pendant un
  recalcul ralenti par réécriture du script du worker) ; les captures « conforme » ne
  deviennent pas des gardes. Seule adaptation : sous 1024 px la durée de calcul est
  attendue dans le DOM (`state: 'attached'`), le panneau étant un onglet masqué.
- **Le scénario `compare` vérifie l'export réel** : téléchargement navigateur, relecture
  par ExcelJS, comparaison des 24 cellules de A, B et Δ des deux onglets aux infobulles de
  l'écran. C'est la seule garde de 7A qui traverse le navigateur pour l'identité des
  données ; les verdicts responsives sont laissés à 7B (« ne pas commencer le point 3
  hormis ce qui prouve que web/e2e fonctionne de bout en bout »).
- **Docker sous Git Bash** : `--tmpfs /var/lib/postgresql/data` est réécrit en chemin
  Windows par MSYS (« mount path must be absolute »). Consigné dans AGENTS.md ; la suite
  PostgreSQL se lance depuis PowerShell, `run.mjs` appelle Docker sans shell.
- **Reports vers 7B** : point 3, Q3 (cellules compactes sous 640 px, lisibilité sur
  capture), Q4 (32 px sur Exporter Excel, Comparer, ✕, ⇄ Inverser), contrat §5 / §6 et
  charte §6.3.

## Première mission — étape 6, partie B, 7 septembre 2026

Le [compte rendu 6B](docs/etape-6.md) décrit l'infrastructure jetable, les verdicts par
point avec leurs captures et les mesures mobile avant / après.

- **Q3 — les deltas de tuile sont atténués à l'état périmé.** Le §6 du contrat exige que
  « les dernières statistiques restent visibles avec leur contexte antérieur, atténuées »,
  et le delta d'une copie est un indicateur du §5. L'étape 4 avait laissé la ligne de
  delta à pleine intensité (limite consignée : « seule l'indication du panneau signale
  leur péremption ») ; à l'écran, panneau et requête à 0,45 face à des deltas à 1 étaient
  un mélange d'anciennes statistiques présentées comme courantes. Révision : la seule
  ligne de delta passe à `opacity-45` quand `stale` est vrai, infobulle « version
  précédente, recalcul en cours » ; stepper, menu ⋯ et clic restent pleins (« les
  contrôles restent utilisables »). Confirmé par l'utilisateur avant modification.
- **Défaut serveur corrigé : plafond partagé refusé sur une carte profilée.** Constaté au
  menu ⋯ (400 « Un plafond partagé exige un profil ») ; cause : PostgreSQL évalue le CHECK
  sur la ligne proposée par `insert … on conflict do update` **avant** de détecter le
  conflit, donc `group_id` seul (profil absent du corps) violait la contrainte même si la
  ligne existante portait un profil. La suite d'intégration ne couvrait que « plafond seul
  sans ligne » (400 attendu, obtenu pour la mauvaise raison) et « profil + plafond ».
  Correction côté route (pré-contrôle du profil envoyé ou enregistré ; ligne proposée qui
  respecte le CHECK) et non côté client, pour que le contrat de l'API soit vrai pour tout
  appelant ; la contrainte SQL reste la garde finale ; test d'intégration ajouté, aucun
  test existant modifié, client inchangé.
- **Cibles tactiles unifiées, pas conditionnées au pointeur.** 32 px (`h-8 w-8`, `py-2`
  sur `text-xs`) pour le stepper, le menu ⋯ d'une tuile ou d'un deck, Enregistrer,
  Nouveau deck, Importer, Terminer et le ✕ des dialogues ; 24 px minimum ailleurs (le
  sélecteur de contexte passe de 21 à 25 px). Une seule mise en page plutôt qu'une variante
  `pointer: coarse` : plus honnête à valider et sans dépendance à l'émulation.
- **Tuile de 96 px et pied sur deux lignes.** Trois cibles de 32 px ne tiennent pas dans
  78 px : le stepper prend sa ligne, le delta (insécable) et le menu ⋯ la suivante, et la
  grille impose 96 px (3 colonnes à 360 / 390, 7 à 768, 9 à 1440 au lieu de 11). Le libellé
  « −1 : −6.38% » est conservé. Charte §6.3 mise à jour.
- **Retours à la ligne plutôt que compression.** Bandeau de mode et en-tête de l'accueil
  en `flex-wrap` avec libellés insécables ; zones de fichier du dialogue d'import en une
  colonne sous 640 px (deux `<input type=file>` côte à côte forçaient le dialogue à 406 px
  pour un viewport de 360) ; pied du dialogue en `flex-wrap`.
- **Inventaire laissé tel quel.** Le problème présumé (titre tronqué par le compteur) n'a
  pas été confirmé : aucune troncature ni chevauchement mesuré aux trois largeurs, titre
  et compteur passent à la ligne. Correction uniquement de ce qui est cassé.
- **Worker ralenti ou forcé en échec par réécriture du script servi**, via une route
  Playwright qui enveloppe `onmessage` après l'évaluation du module : le moteur, le worker
  et le client de calcul sont intacts ; c'est le seul moyen d'observer « Calcul initial »,
  « Recalcul… » et « Statistiques obsolètes » sur un deck de 40 cartes calculé en 75 ms.
- **Gardes de validation hors dépôt.** Scripts Playwright et captures dans le scratchpad
  (rien installé dans le projet) ; le contrôle par mutation des corrections visuelles
  repose sur eux, celui de la correction serveur sur la suite d'intégration. Limite
  consignée : aucune non-régression automatique de l'interface dans le dépôt.
- **Largeurs validées inscrites au contrat** (§6, « Largeurs et cibles tactiles ») : 360,
  390, 768 px et bureau ; comparateur et mur de mains à l'étape 7.
- **Hors liste, corrigé par cohérence** : le ✕ du dialogue « Ajouter une carte » (même
  défaut de 13 px que celui de l'import). Question ouverte plutôt que décision silencieuse.

## Première mission — étape 6, partie A, 7 septembre 2026

Le [compte rendu](docs/etape-6.md) contient le plan validé, l'inventaire complet
(Y1–Y8, P1–P5, C1–C6) et les réponses Q1–Q5. L'étape est découpée en deux sessions ;
la partie B (validation visuelle, mobile) reprend depuis ce document.

- **Le parseur ne réduit ni n'ignore rien en silence.** `parseYdk` et
  `parsePastedIds` renvoient un rapport : quantités brutes (4 copies restent 4),
  lignes non reconnues avec leur numéro, en-têtes ressemblant à une zone mais inconnus,
  cartes hors convention. Un passcode est un entier décimal strict : `0x10`, `1e7`,
  `+123`, `12.5` ne sont plus coercés mais rapportés. La réduction à la convention
  1–3 est un geste séparé (`clampToConvention`) appelé après décision de l'utilisateur.
- **Tolérances documentées, non rapportées** : lignes avant tout `#main` rangées dans
  le main ; lignes `#…` / `!…` commentaires (sauf en-tête de zone inconnu) ; texte
  après le passcode ignoré dans le collage ; formes « 3x id », « 3 id » et « id »
  (compte 1–2 chiffres, passcode ≥ 4 chiffres, donc sans ambiguïté). Le libellé du
  champ les énonce. Un compte nul ou une ligne non reconnue est rapporté.
- **Aperçu d'import avec décision explicite (contrat §2).** Sans anomalie, l'import est
  direct. Sinon l'écran « Vérifier l'import » liste : main vide (importé avec
  avertissement, Q1 : deck vide permis), quantités hors convention (importées à 3
  copies seulement si l'utilisateur clique « Importer avec 3 copies maximum », Q5),
  lignes non reconnues, en-têtes inconnus, passcodes inconnus du catalogue (conservés
  avec leur passcode et comptés, jamais rendus neutres), catalogue indisponible (dit,
  au lieu d'être avalé). Aucune carte reconnue → erreur listant les premières lignes.
- **Constructeur strict.** `addCard` et `setCopies` refusent toute quantité hors 1–3
  ou non entière (`false`, motif dans `persistenceError`, aucune mutation, aucun
  marquage sale) ; 0 reste un retrait documenté. Le dialogue d'ajout affiche
  « ×3 · max » et désactive la ligne. Le serveur reste la garde finale (400).
- **Erreurs rendues telles quelles.** Un 400 à la création est affiché par son message
  (`ApiError`), « hors-ligne » est réservé au fetch qui rejette ; `parseDeckJson` lève
  le motif exact (`ConfigurationError` ou « Fichier JSON illisible ») au lieu de
  `null` ; `GET /api/cards?ids=` refuse en 400 tout identifiant non entier positif
  (helper pur `server/src/domain/cardIds.ts`, plus d'erreur SQL sur `12.5`).
- **Équivalence création / import mesurée sur le modèle moteur.** Le test compare les
  `buildEngineModel` des trois chemins après mise en ordre canonique du main (zone,
  passcode : l'ordre de `readConfiguration`) et prouve séparément que les agrégats de
  `computeAll` sont identiques sur le modèle non trié (à 10⁻¹² près, les seaux bruts
  suivant l'ordre d'énumération). Aucun tri n'est ajouté dans l'éditeur pendant la
  saisie ; la relecture serveur réordonne déjà.
- **Limite consignée (Q2)** : la création manuelle n'ajoute qu'au main deck ; extra et
  side ne viennent que d'un import. L'équivalence porte sur le main, seul analysé.
- **Tolérances de `buildEngineModel` inchangées** : toutes documentées en 5B et
  signalées dans l'interface (paire à membre absent, cible absente, condition inerte,
  plafond supprimé, profil sans étiquette, starter retiré).

## Première mission — étape 5, partie B, 7 septembre 2026

Le [compte rendu](docs/etape-5b.md) détaille la migration, l'interface et les exports.
Les réponses Q1–Q7 de docs/etape-5a.md (section « Réponses ») sont appliquées telles
quelles.

- **Portée des annotations selon le contrat §1.** Profil de disponibilité et plafond
  partagé sont des annotations du compte, posées sur `card_flags` (`availability`,
  `group_id`) et `nonengine_groups` ; la condition ET/OU est locale au deck
  (`deck_conditions`, une par source, FK composite vers la paire). Rien n'est déduit
  des anciens labels (Q4) ; aucun groupe n'est créé par migration (Q2).
- **Une seule représentation des conditions (Q3).** La migration 002 convertit chaque
  source de `deck_requirements` en un groupe ET de feuilles, dans l'ordre des
  identifiants, nommé par le premier ; `deck_requirements` est conservée mais plus lue
  ni écrite. L'API refuse un document portant `requirements` (400 explicite) ; archives
  JSON et brouillons antérieurs sont convertis par `upgradeConfiguration`, la règle
  exacte de la migration, jamais silencieusement côté API. Le moteur refuse une source
  portant les deux représentations (`prepare` jette) au lieu de les combiner ; chaque
  représentation seule reste acceptée, l'ancienne pour les tests historiques.
- **Étiquette sans profil = zéro contribution, signalée (Q5).** Le moteur ne connaît
  plus d'horizon ni de pertinence : un type contribue s'il est étiqueté et profilé.
  `buildEngineModel` transmet ces cartes sans profil et les liste
  (`unprofiledCardIds`) ; le panneau, le contexte du résultat et le comparateur les
  nomment. L'enregistrement n'est pas bloqué (annotations communes au compte).
- **Anciens tests du modèle historique réécrits, pas contournés.** Le bloc « horizon »
  d'`engine.test.ts` (Lot A) testait une règle retirée par décision ; il devient
  « étiquette et profil » avec les mêmes valeurs dérivées d'un profil flexible. Le test
  Q3 de `chronology.test.ts` passe de « combinés par ET » à « refusés » ; les autres
  tests Q1, Q2, Q4 conservent leurs valeurs. `oracle.ts` et `rules.test.ts` sont
  intacts ; `deckOracle.ts` perd seulement le champ `relevance` de son adaptateur.
- **Catégories sans pertinence (Q4).** `nonengine_categories.relevance` reste en base
  (`'both'` pour toute nouvelle catégorie), n'est plus renvoyée par l'API ni exportée,
  et les anciens exports qui la portent sont acceptés en l'ignorant ; l'import ne
  compare plus les pertinences.
- **Invalidation des decks concernés à toute modification globale.** Chaque route
  d'écriture de la bibliothèque met `decks.summary` à NULL : decks du compte contenant
  la carte pour un changement lié à une carte, tous les decks du compte pour une
  catégorie ou un plafond, jamais un autre compte. Le résumé reste un cache non
  affiché ; l'éditeur recalcule après acquittement (étape 4).
- **Réglage unique premier/second dans le store** (`context`, transitoire, non
  enregistré) : les deux passes restent calculées ; le réglage ne change que ce qui est
  présenté (deltas de la grille, matrice, mur de mains, colonne active). Le mur de
  mains n'a plus de scénario local.
- **Libellé « départs théoriques »** pour S dans le panneau, les requêtes, la matrice,
  le mur, le comparateur et l'Excel, avec une explication courte (« sources de start
  disponibles dans la main observée, sans preuve de ligne ») ; les clés d'agrégats
  (`brick_starters`, `starters_ge1`…) et la géométrie de l'Excel ne changent pas.
- **Éditeur d'arbre ET/OU à deux gestes** : le mode « Condition » de la grille ajoute
  une clause ET ou retire la carte ; l'inventaire et les combos éditent l'arbre
  (« ou… » sur une feuille, « ＋ ou… » sur un groupe, « ＋ et… » à la racine, ≥ n). La
  normalisation retire tout groupe vidé et rend la source inconditionnelle quand la
  racine se vide : le groupe vide reste une configuration incomplète refusée par le
  serveur, jamais produite par l'interface.
- **Guardes Q1/Q2 à trois niveaux** : interface (mode Profil ignore et compte les cartes
  sans étiquette ; plafond proposé seulement à une carte profilée), serveur (400
  explicites, contrainte SQL `group_id is null or availability is not null`), moteur
  (garde inchangée de l'étape 5A).

## Première mission — étape 5, partie A, 7 septembre 2026

Le [compte rendu](docs/etape-5a.md) détaille le moteur chronologique et ses oracles.
Aucune persistance ni interface touchée ; l'application calcule encore avec ses
annotations historiques.

- **Contexte unique `'first' | 'second'`** comme paramètre du moteur ; `5` et `6`
  restent acceptés comme synonymes (taille observée) pour les appels historiques et le
  pont B01, tout autre paramètre rend la passe indisponible. Matrice, deltas, requêtes
  et mur de mains (`evaluateHands({ context })`, dernière carte = sixième) en dérivent ;
  `toComparisonMatrix` refuse une passe d'un autre contexte que son scénario.
- **Deux dénominateurs sur `PassResult`** : `total` = mains distinctes C(D,h)
  (sens inchangé, B01 intact) et `outcomes` = issues pondérées Z du contrat §5
  (second : C(D,5)·(D−5) = 6·C(D,6)). Poids des buckets entiers sur Z ; note /10 et
  probabilités divisent par Z. Question ouverte Q7 si l'on préfère un seul champ.
- **Sixième identifiée depuis les compositions de six** : `w(k6, j) = W(k6)·k6ⱼ`
  (identité C(n,k+1)(k+1) = C(n,k)(n−k)). Seuls les types précoces et flexibles sont
  séparés ; les autres copies et le filler partagent l'évaluation « sixième neutre »,
  identique pour eux (vérifié par oracle et mutation). Coût : au plus 1 + nombre de
  types sensibles présents par composition.
- **Potentiel U = flot maximum sur deux fenêtres, par coupe minimale** :
  `min(Σ min(total, opp+own), cap + Σ own, cap + Σ opp, 2·cap)` par unité (groupe
  plafonné) ; type seul = plafond infini. HOPT borne chaque tour à 1 par identité ; une
  flexible ne sert au tour adverse que si elle est initiale ; une précoce en sixième n'a
  aucune fenêtre. En premier, une seule fenêtre (own = 0).
- **Unités couplées conservées dans les buckets** (`neCapped`) à côté de la partie
  additive par signature (`neContrib`) : une requête par catégorie ou union mesure son
  propre potentiel sous les mêmes plafonds (`cappedPotential(unit, keep)`), jamais une
  part répartie entre labels ; la clé de bucket inclut les unités canonisées.
- **Conditions ET/OU** (`Condition`) validées dans `prepare` : groupe vide, opérateur
  inconnu, quantité < 1, type hors modèle → exception explicite relayée par le worker
  (ancien résultat conservé, obsolète). Anciens prérequis traduits en feuilles et
  combinés par ET avec une condition moderne (Q3).
- **Modèle historique conservé pour les types sans profil** (pertinence + horizon) :
  aucune correspondance implicite anciens labels → profils (contrat §3), c'est l'objet
  de la migration de la partie B. Pour un type profilé, la pertinence de catégorie n'est
  pas appliquée (Q4) ; une carte profilée sans étiquette ne contribue pas (Q1) ; un
  groupe sans profil est refusé (Q2).
- **Oracles** : `deckOracle.ts` étend `oracle.ts` (intact) à des decks entiers sans
  rien partager avec la production ; `monteCarlo.ts` (10⁶ mains, mulberry32, graine
  fixe) évalue chaque classe d'issue avec les primitives brutes et vérifie le poids des
  issues indépendamment. Tolérance `5·√(p(1−p)/n) + 5/n`, jamais ajustée : toute
  divergence entre oracles ou avec le moteur est un échec.
- **Nouveaux cas de référence dans un fichier séparé** (`chronology.test.ts`) plutôt
  qu'ajoutés à `rules.test.ts`, pour ne pas toucher au fichier de l'étape 1 ; les
  appels `evaluate(prep, k, dead)` d'`engine.test.ts` sont réécrits vers la nouvelle
  signature avec leurs valeurs attendues inchangées.

## Première mission — étape 4, 7 septembre 2026

Le [compte rendu](docs/etape-4.md) détaille le recalcul versionné et annulable.

- **Deux gardes indépendantes contre une réponse périmée.** Versionnement
  (`modelVersion` avancé à la mutation, avant le délai de regroupement ; `resultVersion`
  porté par le résultat ; adoption seulement si égalité) ET annulation de la tâche en
  cours à toute invalidation. Le contre-exemple de la passation (A lancé, modification
  vers B, A résolu pendant le délai de B) est testé en mode « naïf », sans annulation,
  pour prouver que le versionnement suffit seul ; l'annulation, elle, libère les
  ressources.
- **Annuler = terminer le worker.** Un calcul synchrone dans un worker ne s'interrompt
  pas autrement. Le client repose les tâches encore attendues sur un worker neuf.
  Coût assumé : un nouveau worker par invalidation survenue pendant un calcul.
- **Propriété des tâches : un client = un worker = un propriétaire.** Le store en
  possède un pour sa durée de vie (au plus une tâche) ; le comparateur en crée un par
  montage et le dispose au démontage — terminer le worker de l'éditeur ne peut plus
  abandonner les promesses du comparateur. Toute promesse se termine
  (`ComputeCancelled`, `ComputeFailed`) ; une exception du moteur revient comme réponse
  d'erreur portant l'id, jamais par `onerror` sans id.
- **Le résultat périmé reste affiché avec SON contexte** (`resultContext` : taille,
  catégories, horizons capturés au lancement), atténué par `opacity-45` (charte §7.15)
  sous un état « Recalcul… » ; les contrôles restent vivants. Une nouvelle catégorie
  n'apparaît qu'avec le résultat qui la connaît ; l'ouverture d'un deck vide le
  résultat (état initial), jamais les statistiques du deck précédent.
- **Erreur** : ancien résultat conservé et dit obsolète (bandeau §7.12), bouton
  Relancer (`recompute()`) ; une annulation n'est jamais présentée comme une erreur.
- **Ouvertures numérotées** (`opening`, incrémenté à chaque `loadDeck`) : toute réponse
  d'une ouverture antérieure — chargement, brouillon, sauvegarde — est ignorée.
  Conséquence assumée : une sauvegarde partie d'une ouverture précédente n'adopte plus
  sa révision sur le deck rouvert ; si le rechargement a lu la base avant le commit, le
  prochain Enregistrer reçoit un 409 honnête au lieu d'écraser silencieusement le
  contenu sauvegardé par un état antérieur. Le brouillon, comparé par contenu, est
  effacé dans tous les cas.
- **Annotations globales** (HOPT, catégories) n'invalident qu'après acquittement
  serveur : le modèle ne change pas avant.
- **Limites** : aucun test React ni navigateur (Vitest en environnement `node`) ; la
  limite de coût des très grands decks n'est toujours pas bornée (réserve §2 du
  contrat), un tel calcul reste seulement annulable.

## Première mission — étapes 2 et 3, 7 septembre 2026

Les [corrections et décisions livrées](docs/etapes-2-3.md) remplacent les conventions
historiques de paires globales et d'écritures partielles : configuration version 2,
paires par deck, validation commune client/serveur, transaction et révision.
Les anciennes données de paires sont conservées, sans reprise automatique.
Les résumés statistiques historiques sont invalidés et ne sont plus affichés.
Le JSON v1 et les anciens brouillons sont refusés ; le JSON v2 conserve conditions,
notes et requêtes. La migration a été testée uniquement dans une base jetable.
La purge VPS et les recalculs annulables ne sont pas réalisés à ces étapes.

Arbitrages d'implémentation approuvés explicitement par l'utilisateur le 7 septembre 2026 :

- JSON version 1 refusé avec message explicite, sans convertisseur automatique → une ancienne sauvegarde se réimporte par sa composition et ses paires se redéfinissent ; toute conversion future sera un traitement explicitement contrôlé, jamais implicite.
- L'import JSON échoue entièrement sur conflit de bibliothèque (catégorie de même nom avec une autre pertinence, HOPT explicitement contradictoire) → aucune fusion partielle : la bibliothèque du compte et ses autres decks restent intacts tant que le conflit n'est pas résolu.

## Première mission — étape 1, 7 septembre 2026

Le [contrat métier](docs/regles-metier.md) formalise le plan révisé accepté :
paires permanentes par deck après enregistrement explicite, annotations non-engine
communes au compte, profils chronologiques, starts théoriques et conditions
résiduelles ET/OU. Les [cas de référence](docs/cas-reference.md) distinguent les
règles cibles des comportements déjà vérifiés dans le moteur. Aucun code de
production, schéma ou enregistrement n'est modifié à cette étape.

Les décisions ci-dessous constituent l'historique. En particulier, les anciens
horizons numériques, les paires globales et les descriptions de cartes « mortes »
ne doivent pas servir à contredire le nouveau contrat cible. Les défauts de
calcul identifiés restent à corriger à l'étape 2 ; les nouveaux tests de référence
ne constituent pas une certification de conformité de toute l'application.

## Historique des itérations précédentes

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

## Maintenance du catalogue — purge des passcodes périmés

- **Le problème.** `migrate-cards.ts` fait `on conflict (id) do update` : il ajoute
  et met à jour, **il ne supprime jamais**. Or la source retire des lignes. YGOPRODeck
  attribue aux cartes OCG un passcode **provisoire** (`1004xxxxx` / `1014xxxxx`) puis
  le remplace par le vrai passcode à la sortie TCG ; l'entrée provisoire disparaît de
  la source mais **survit en local**. Constat au 2026-08-31 : 14 590 lignes locales
  pour 14 529 côté source, soit **61 résidus** — dont 39 doublons de cartes bien
  présentes sous leur passcode courant (deux « Witchcrafter Seed » dans la recherche).

- **Purge = report, pas suppression sèche.** Le catalogue est un LOOKUP sans FK (cf.
  §A) : rien ne fait le report à notre place, et supprimer une ligne référencée
  changerait **silencieusement** les probabilités d'un deck. `prune-stale-cards.ts`
  reporte donc les 8 emplacements de passcode (`deck_cards`, `deck_starters`,
  `card_flags`, `card_categories`, `combo_pairs` ×2, `deck_start_requirements` ×2)
  vers le passcode courant **avant** de supprimer.

- **Cible = même nom, toujours dans la source.** Un seul candidat sinon on ne devine
  pas. Les homonymes légitimes (alt arts : `Blue-Eyes White Dragon` 89631139/89631143)
  sont présents des deux côtés et ne sont donc jamais des orphelins.

- **Règle de sûreté : référencé + sans cible sûre = CONSERVÉ.** Perdre la ligne
  vaudrait pire que le doublon. Le script le signale au lieu de trancher.

- **Conflits de clés composites, traités un par un** — c'est là qu'est le travail :
  `deck_cards` cumule les copies (plafond 3 du check) quand deck+zone contient déjà la
  cible ; `card_flags` fusionne par OU ; `deck_starters` / `card_categories`
  dédupliquent. `combo_pairs` est le cas épineux : unicité `(owner, a, b)` **et** check
  `a <= b`. Le remap et la recanonicalisation se font en **un seul `update`** (deux
  updates violeraient le check entre les deux) ; les paires qui collisionnent après
  report élisent une survivante — celle **non** concernée par le remap, qui porte la
  note écrite par l'utilisateur — et lui cèdent `deck_pair_exclusions` et
  `deck_start_requirements.source_pair_id`. Une paire devenue `(X, X)` est supprimée :
  hors périmètre §D, le moteur l'ignore (`if (a === b) continue`), la ligne serait morte.

- **Simulation = exécution réelle + rollback.** Le mode par défaut joue *toutes* les
  opérations puis annule : les contraintes sont donc réellement éprouvées, pas
  seulement prédites. `--apply` rejoue et valide. Une transaction unique, un contrôle
  final qui refuse le commit s'il reste une référence pendante.

- **Garde-fou sur la source** : moins de 10 000 ids lus = abandon. Sans lui, une
  Supabase en panne (réponse vide) ferait de **tout** le catalogue un « orphelin ».

- **Validé sur scénario fabriqué**, compte jetable couvrant les 8 emplacements et
  chaque branche de conflit — les 16 compteurs attendus, état final vérifié ligne à
  ligne, puis même vérification via le SQL de `--emit-sql` rejoué par `psql` sur une
  base restaurée : états identiques. Relance après purge : 0 orphelin (idempotent).

## Suivi de version du référentiel (source Supabase)

- **Ce que la clé anon peut faire.** La source expose `public.dataset_versions`
  (version, `recorded_at`, `fingerprint`, compteurs) en **lecture** ; les fonctions
  `dataset_version_status()`, `dataset_fingerprint()` et `record_dataset_version()`
  lui sont **fermées** (`42501`). L'empreinte est donc *consignée mais jamais
  revérifiée* de notre côté : un repère, pas une preuve. Recalculer côté client
  supposerait de rapatrier printings et traductions, qu'on ne migre pas.

- **Miroir local `catalog_version`**, une seule ligne (check sur la PK). Elle
  distingue trois compteurs qu'il serait tentant de confondre : `source_cards_count`
  (annoncé), `copied_cards_count` (réellement lu) et `local_cards_count` (lignes en
  base). Les deux premiers valident la copie ; le troisième diverge légitimement
  après une purge — d'où son réalignement par `prune-stale-cards`, sans quoi deux
  bases identiques paraîtraient divergentes.

- **Version lue avant ET après la copie.** Si elle bouge entre les deux, la copie est
  à cheval sur deux versions : **aucune estampille n'est posée**. Idem si le nombre
  copié ne correspond pas à l'annonce. Mieux vaut garder l'ancienne estampille,
  visiblement périmée, qu'en écrire une fausse — une estampille n'a de valeur que si
  on peut s'y fier sans la rejouer.

- **Exposé par `/api/health`**, qui est public : comparer deux déploiements devient
  `curl` ici, `curl` là-bas. Volontairement réduit à version + date + compte — un
  point de contrôle, pas un inventaire, et pas d'empreinte diffusée.

- **`catalog` vaut `null` si la table manque** (base antérieure au suivi) : `health`
  est la sonde du conteneur en production, la casser sur une base pas encore migrée
  transformerait un défaut de traçabilité en indisponibilité.

## Piège de déploiement : le schéma monté est figé à la création du conteneur

- **Constaté le 2026-08-31.** `deploy.sh` rejouait le schéma via le fichier monté
  (`-f /docker-entrypoint-initdb.d/00-schema.sql`). Or `git pull` ne modifie pas le
  fichier en place : il en écrit un nouveau et le renomme, donc **l'inode change**. Le
  bind-mount du conteneur `db` reste attaché à l'ancien inode tant que le conteneur
  n'est pas recréé — et il tourne des semaines (`Up 2 weeks`). Résultat : le
  déploiement passait au vert en rejouant le schéma **du jour du dernier `up`**.
  `catalog_version` n'est jamais arrivée en base, sans un seul message d'erreur.

- **Pourquoi ça n'était jamais sorti** : jusqu'ici le schéma n'avait pas bougé depuis
  le premier déploiement. Le premier changement l'a révélé — et l'aurait révélé bien
  plus tard sans le contrôle `\d catalog_version` fait juste après.

- **Invisible en local** : Docker Desktop (Windows) monte via un système de fichiers
  virtualisé qui relit le fichier hôte à chaque accès, là où un bind-mount Linux natif
  fige l'inode. Un rejeu de schéma correct en développement ne prouve donc rien sur le
  serveur.

- **Correctif : passer le fichier par STDIN** (`-f - < ../db/schema.sql`) dans
  `deploy.sh` comme dans `npm run db:schema`. Le contenu est alors lu par le shell au
  moment de l'exécution ; le montage ne sert plus qu'à l'initialisation du volume au
  tout premier démarrage, son seul rôle légitime.

- **À retenir** : un bind-mount de **fichier** (et non de dossier) ne suit pas les
  remplacements par renommage — ce que font `git`, `sed -i`, et la plupart des
  éditeurs. Ne jamais compter dessus pour du contenu qui évolue.
