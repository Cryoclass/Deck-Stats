# Décisions compressées — une ligne par décision (décision → contrainte)

Source : DECISIONS.md (raisonnement complet). Ce fichier ne le remplace pas : toute nouvelle décision s'écrit d'abord là-bas, puis ici.

## Coquilles du tableau §C et du brief
- P(≥1 A) pour 40 cartes / 3 copies / main de 5 = 33,76 % (pas 33,75) → les tests assertent l'exact, ne pas aligner sur le brief.
- P(A = 2) = 3,54 % (pas 3,29) → idem.
- Prérequis §F : 30,21 % (pas 29,49) → idem ; la table de vérité du brief reste valide.

## Modélisation initiale
- Redondance = arêtes présentes sur tous les sommets de la main, starters inclus → pas de restriction au sous-graphe non-starter.
- Total non-engine = union des copies à ≥1 catégorie pertinente, plafond HOPT par horizon (it. 2) → la ventilation par catégorie reste en copies brutes.
- Delta d'une copie = P(≥1 start) − P(≥1 start | copie basculée en filler), taille de deck constante → jamais en retirant la carte du deck.
- Taille de deck = somme des copies du main ; filler = cartes non annotées → avertissement hors 40–60, pas d'interdiction.
- Note /10 = percentile sur la distribution exacte (buckets), score 100×S + importance×U, milieu pour les égalités → jamais calibrée sur l'échantillon affiché.
- Pivots colorés / pastilles = couverture gloutonne par degré → affichage seul, aucun effet sur le calcul.
- Couleurs oklch dérivées à l'affichage → jamais stockées.
- Auto-combo A+A rejeté à la saisie (API et store) → hors périmètre.
- Mode requête évalué sur les buckets renvoyés par le worker → aucune ré-énumération.
- Persistance best-effort et partage par URL `#s=` → remplacés à l'itération 4 (obsolète).

## Itérations 1 à 3
- Cartes mortes par position : hors graphe et hors starters pour la passe, comptage non-engine inchangé → flag sans effet sur une carte non annotée.
- Annotation par modes (raccourcis C/H/S/N, P) ; menu ⋯ réservé au rare → pas de nouvelle action fréquente dans le menu.
- Menus Radix en portal avec évitement de collisions ; stepper « − N + » en `shrink-0` → pas de conteneur `overflow:hidden` autour.
- Horizon HOPT réglable 1..3 (défauts first = 1, second = 2) ne touche que le total non-engine → graphe de combos jamais affecté ; `catCounts` brut. La chronologie cible (étape 5) remplacera ces horizons.
- Retirer une carte ne supprime que `deck_cards` ; annotations conservées et restaurées au ré-ajout → jamais de cascade sur starters/flags/paires.
- Toute modification de deck = invalidation complète + recalcul intégral ; mains du mur renotées sans re-tirage.

## Itération 4 — persistance
- Local au deck = bouton Enregistrer (`dirty`, Ctrl+S) ; bibliothèque du compte écrite immédiatement → deux canaux distincts.
- Brouillon IndexedDB continu, comparé par contenu → jamais par horodatage.
- `decks.summary` = cache indicatif → jamais source de vérité (mis à NULL en v2, plus affiché).
- Routeur maison `/decks`, `/decks/:id`, `/compare/:a/:b` → aucune dépendance de routage.
- Le moteur prend l'état en paramètre (`computeAll(EngineInput)`) → aucune lecture de global.
- Partage `#s=` supprimé → le lien partageable est `/decks/:id`.
- Catalogue = lookup sans FK (`card_id` ne référence pas `cards`) → ne jamais réintroduire de FK catalogue.

## Itération 5 — prérequis en deck
- Prérequis locaux au deck, source starter ou paire, cumulatifs (ET) → primitive « il reste ≥ q copies de X en deck après le tirage ».
- Toute carte requise est promue en type suivi → chemin rapide sans prérequis identique aux tests §C.
- Pas de consommation de ressource → deux sources peuvent exiger la même dernière copie.
- Marqueur pointillé ambre + icône ▤, relation dirigée surlignée au survol → visuellement distinct des pastilles de combo.

## Itération 6 — distributions parcourables
- Bascule Starts → Non-engine → catégorie, colonne cumulée « au moins n » → aucune valeur nouvelle calculée.
- Catégorie non pertinente sur une passe = mention explicite, pas des zéros.
- `statsView` dans les params du deck → le changer marque « dirty ».

## Itération 7 — mode requête
- Critère = sujet + [min, max] ; ET des critères ; aucun critère = 100 % ; min > max = invalide (« — »), jamais 0 ni 100 %.
- Agrégation par signatures de catégories pertinentes → une carte comptée une fois par groupe ; ordre : pertinence → union → plafond HOPT.
- Sujet non-engine = activable (plafond HOPT) ; ventilation du panneau = brut tiré → deux libellés distincts.
- Un seul système de critères : le filtre du mur EST la requête → pas de filtres parallèles ; requêtes nommées dans les params, requête courante transitoire.

## Itération 8 — comptes
- Sessions opaques (32 octets), cookie httpOnly SameSite=Lax (+Secure en prod), 30 jours glissants, SHA-256 seul en base → pas de JWT.
- scrypt natif N=2^17 r=8 p=1, paramètres embarqués dans le hash, hash factice si email inconnu → réponse 401 uniforme.
- Inscription par `INVITE_CODES` (env, liste vide = fermé) → contrôle isolé dans une fonction unique.
- Garde `preHandler` globale déclarée avant les routes ; public = `/api/health` et `/api/auth/*` → rate-limit opt-in par route ; CORS restreint à `APP_ORIGIN` avec credentials.
- Email = identifiant, unicité `lower(email)` ; `password_hash` nullable ; `user_identities` unique (provider, id) → jamais de rattachement automatique par email.
- `server/src/env.ts` charge le `.env` racine par chemin explicite → importer `./env.js` en premier partout.
- `npm run db:schema` rejoue le schéma idempotent → initdb ne joue rien sur un `pgdata` existant.
- Bibliothèque par compte (`owner_id` dans `card_flags`, `combo_pairs`, `nonengine_categories`) → partage uniquement par export/import JSON.
- Catégories de base créées par compte dans `auth/account.ts` (point d'entrée unique) → pas de seed SQL.
- Ressource d'autrui → 404, jamais 403 ; références croisées validées en SQL bornées à `owner_id`.
- Legacy : `db:schema` puis `adopt -- <email> <mdp>` en une transaction relançable ; bascules d'unicité dans `schema.sql` (bloc DO), PK `card_flags` par `adopt`.
- Page de connexion rendue à la place de la route, URL intacte → pas de route `/login`.
- 401 serveur ≠ hors-ligne : fetch rejeté → mode offline ; 401 → événement `ygo:unauthorized` → connexion.
- Déconnexion = purge IndexedDB + rechargement complet ; `bootstrap()` seulement après authentification.
- OAuth Discord : cookie d'état 10 min (aléa, code d'invitation, drapeau liaison) revalidé au retour ; liaison explicite en session ; déliaison refusée sans mot de passe ; URLs surchargeables par env ; `/discord/start` rate-limité.
- Vite paramétrable (`WEB_PORT`, `API_PROXY`, `strictPort`) → deuxième pile possible en parallèle.

## Itération 9 — comparateur
- Couche pure sur `PassResult` (`engine/compare.ts`), matrices normalisées 4×6 (≥3 ; 5+ = somme des ne ≥ 5) → ne recalcule rien ; libellé « starts », pas « starters ».
- Garde-fou §7.4 sur marges observées → note explicative, pas « bug de classification ».
- Incohérence interne du §11 de la spec signalée → tests sur la table d'agrégats à ±0,3 pt.
- Moyennes « plancher » (≥3 = 3, 5+ = 5) → onglet Synthèse Excel 100 % formules.
- ExcelJS 4.4.0 en import dynamique, `fullCalcOnLoad`, deltas colorés par règle par ligne → jamais d'import statique.
- `buildModel` extrait dans `lib/engineModel.ts` ; worker mode `passes` sans deltas.
- Horizons différents entre les deux decks → avertissement ; deck < 6 cartes → erreur avant calcul.

## Maintenance du catalogue
- `migrate` ne supprime jamais ; `prune-stale-cards` reporte les emplacements de passcode puis supprime → jamais de delete sec.
- Cible = même nom, candidat unique, encore dans la source ; référencé sans cible sûre = conservé et signalé.
- Conflits : copies cumulées (plafond 3), flags fusionnés par OU, dédup starters/catégories, paires recanonicalisées en un seul update, survivante = paire non remappée, paire (X, X) supprimée.
- Simulation = exécution réelle + rollback ; `--apply` valide ; contrôle final refuse le commit s'il reste une référence pendante.
- Moins de 10 000 ids lus côté source = abandon.
- v2 : le script compte les nouvelles tables mais ne fusionne pas encore `deck_combo_pairs`/`deck_requirements` → un report pendant annule tout (à poursuivre).

## Version du référentiel
- `catalog_version` une ligne : `source_cards_count`, `copied_cards_count`, `local_cards_count` → réaligné par `prune-cards`.
- Version lue avant et après la copie ; divergence ou compte différent = aucune estampille posée.
- Empreinte consignée, jamais revérifiée (fonction fermée à la clé anon) → repère, pas preuve.
- `/api/health` expose version + date + compte ; `catalog` vaut null si la table manque → la sonde reste verte.

## Déploiement
- Rejeu du schéma et des migrations par stdin (`-f -`) → jamais via le fichier monté (inode figé après `git pull`).
- Aucun `ports:` en prod ; réseau `edge` partagé avec le Caddy goldfish ; `TRUST_PROXY=1`.
- `deploy.sh` : build → db → stop app → schéma → migration → up ; si la migration échoue, l'app reste arrêtée.

## Étapes 2 et 3 (7 septembre 2026)
- Configuration v2 = document unique validé par `parseConfiguration` côté client et serveur → aucune écriture partielle (HTTP 410).
- Enregistrement = une transaction, verrou du deck, `expectedRevision` (409) → un id de paire ne change jamais de cartes.
- Paires (`deck_combo_pairs`), conditions ET (`deck_requirements`, FK composite), disponibilités (`deck_flags`) par deck → anciennes tables conservées jusqu'à l'étape 8, non copiées.
- HOPT, catégories et affectations restent au compte.
- JSON v1 refusé sans convertisseur (approuvé le 7 sept. 2026) → réimporter la composition et redéfinir les paires ; toute conversion future est explicite. JSON v2 complet.
- Import JSON = une transaction, fusion avec la bibliothèque ; conflit de pertinence ou HOPT contradictoire = échec total (approuvé le 7 sept. 2026) → jamais de fusion partielle.
- Duplication remappe paires et conditions → aucune paire héritée par simple présence des cartes.
- Passe impossible = `unavailableReason`, `total = 0` → toujours tester la disponibilité avant usage.
- Buckets avec poids entiers ; percentile par rapport entier → 7,5 donne 8.
- Pourcentages au centième, matrices au dixième, agrégation sur non-arrondi.
- Résumés persistés non affichés ; brouillons v2 effacés seulement si identiques au sauvegardé ; anciens brouillons non repris.
- Tests PostgreSQL uniquement sur conteneur jetable 127.0.0.1:55433.

## Étape 4 (7 septembre 2026)
- Réponse adoptée seulement si sa version demandée = `modelVersion` courant ; `modelVersion` avance à la mutation, avant le debounce → jamais d'adoption d'une réponse périmée, même sans annulation (testé en mode naïf).
- Annuler = terminer le worker et reposer les tâches suivantes sur un worker neuf → un client par propriétaire : le store en possède un (une tâche à la fois), le comparateur un par montage, disposé au démontage.
- Toute promesse du client se termine (`ComputeCancelled` / `ComputeFailed`) ; exception moteur = réponse `error` avec id → jamais de promesse bloquée.
- Résultat périmé affiché atténué (`opacity-45`) avec son `resultContext` et « Recalcul… », contrôles vivants ; ouverture d'un deck = résultat vidé → jamais d'anciennes statistiques sous de nouveaux labels ou pour un autre deck.
- Erreur = ancien résultat conservé et dit obsolète + Relancer (`recompute()`) ; annulation ≠ erreur.
- `opening` numérote chaque `loadDeck` ; réponses d'ouvertures antérieures ignorées → une sauvegarde d'une ouverture précédente n'adopte pas sa révision (409 honnête possible ensuite), brouillon effacé par contenu.
- Annotations globales n'invalident qu'après acquittement serveur.
- `worker/fakeWorker.ts` réservé aux tests, répond avec le moteur réel → assertions sur des valeurs exactes.

## Étape 5, partie A (7 septembre 2026)
- Contexte unique `'first' | 'second'` paramètre du moteur (5/6 synonymes tolérés) → matrice, deltas, requêtes, mur de mains et comparateur (`toComparisonMatrix` garde le contexte) dérivent tous du même contexte.
- `PassResult.total` = mains distinctes C(D,h), `outcomes` = issues Z (second : C(D,5)·(D−5) = 6·C(D,6)) → poids des buckets et note /10 sur Z ; B01 intact.
- Sixième identifiée depuis les compositions de six, `w(k6,j) = W(k6)·k6ⱼ` ; seuls early/flexible séparés → sixième neutre pour les autres, identique.
- Profils `availability` (early/flexible/prepared/breaker) = fenêtres ; U = flot maximum par coupe minimale `min(Σ min(total, opp+own), cap+Σown, cap+Σopp, 2·cap)` → HOPT = 1 par identité et par tour ; flexible au tour adverse seulement si initiale ; précoce sixième sans fenêtre.
- Plafond partagé `groups`/`group` = unité couplée conservée dans les buckets (`neCapped`) → requêtes par catégorie/union mesurent leur propre potentiel sous les mêmes plafonds, jamais additives.
- Conditions ET/OU validées dans `prepare` (groupe vide, opérateur inconnu, quantité < 1, type hors modèle = exception) → rien ne devient vrai par défaut ; anciens prérequis + condition = ET.
- Types sans profil = modèle historique (pertinence + horizon) jusqu'à la migration → aucune correspondance implicite labels → profils ; profilée sans étiquette = 0 ; groupe sans profil refusé ; pertinence non appliquée aux profilées (questions Q1–Q7 de docs/etape-5a.md).
- Oracles réservés aux tests : `deckOracle.ts` (énumération physique de decks entiers) et `monteCarlo.ts` (10⁶ mains, graine fixe, tolérance `5·√(p(1−p)/n)+5/n` jamais ajustée) → toute divergence = échec ; nouveaux cas dans `chronology.test.ts`, `oracle.ts` et `rules.test.ts` intacts.


## Étape 5, partie B (7 septembre 2026)
- Profil (`card_flags.availability`) et plafond (`nonengine_groups`, `card_flags.group_id`) = annotations du compte ; condition ET/OU (`deck_conditions`, jsonb, une par source) = locale au deck → rien n'est déduit des anciens labels, aucun groupe créé par migration (Q2, Q4).
- Migration 002 : chaque source de `deck_requirements` → un groupe ET de feuilles (ordre des ids, nommé par le premier), horizons retirés de `params`, `summary` invalidé partout ; `deck_requirements` conservée, plus lue ni écrite → une seule représentation (Q3), purge à l'étape 8.
- API : `requirements` refusé (400 « format antérieur »), archives JSON et brouillons convertis par `upgradeConfiguration` (règle exacte de la migration) → jamais de conversion silencieuse côté API.
- Moteur : plus d'horizon ni de pertinence ; contribue = étiquetée ET profilée ; étiquette sans profil = 0 mais copies brutes comptées (Q5) ; prérequis anciens + condition sur une source = exception → l'application ne produit que des `Condition`.
- `buildEngineModel` liste `unprofiledCardIds` ; panneau (« N cartes non-engine sans profil, non comptées »), `resultContext` et comparateur les nomment → enregistrement jamais bloqué.
- Toute écriture de bibliothèque met `decks.summary` à NULL (decks contenant la carte ; tous les decks du compte pour catégorie/plafond ; jamais un autre compte) → le cache ne certifie rien.
- Réglage unique `context` dans le store (transitoire) → deltas, matrice, requête active, mur de mains suivent ; plus de bouton delta ni de scénario local du mur.
- « Départs théoriques » = libellé de S partout (panneau, requête, matrice, mur, comparateur, Excel) avec explication courte ; clés d'agrégats et géométrie Excel inchangées.
- Éditeur ET/OU : mode Condition = clause ET / retrait ; inventaire et combos = « ou… », « ＋ ou… », « ＋ et… », ≥ n ; groupe vidé retiré, racine vidée = inconditionnelle → le groupe vide n'est jamais produit, toujours refusé par le serveur.
- Gardes Q1/Q2 : interface (Profil ignore les cartes sans étiquette, plafond seulement si profilée), serveur (400 + contrainte SQL), moteur (5A) → trois niveaux.
- Catégories sans pertinence : colonne `relevance` conservée (`'both'`), jamais renvoyée ni comparée à l'import → étiquette pure.
- Tests du modèle historique réécrits vers la règle décidée (bloc horizon d'`engine.test.ts`, Q3 de `chronology.test.ts`) ; `oracle.ts`, `rules.test.ts`, ponts B02–B04 intacts → jamais « pour faire passer le code ».

## Étape 6, partie A (7 septembre 2026)
- Parseur YDK / collage = rapport (`deck` brut, `ignored` numérotées, `unknownHeaders`, `overLimit`) ; passcode = entier décimal strict → jamais de réduction ni d'absorption silencieuse ; `clampToConvention` = geste explicite après décision.
- Tolérances documentées dans le libellé : lignes avant `#main` → main ; `#…`/`!…` commentaires sauf en-tête de zone inconnu ; « 3x id », « 3 id », texte après le passcode ignoré.
- Aperçu « Vérifier l'import » dès une anomalie (main vide importé avec avertissement Q1 ; > 3 copies → 3 seulement sur clic explicite Q5 ; lignes ignorées ; passcodes inconnus conservés, jamais neutres ; catalogue indisponible dit) → contrat §2 « décision explicite ».
- Constructeur : `addCard`/`setCopies` → `false` + motif hors 1–3 ou non entier, 0 = retrait ; dialogue « ×3 · max » → le serveur reste la garde finale.
- Messages rendus tels quels : 400 de création affiché (hors-ligne = fetch rejeté), `parseDeckJson` lève le motif, `GET /api/cards?ids=` strict (400) via `domain/cardIds.ts`.
- Équivalence création / YDK / JSON v2 = mêmes `buildEngineModel` après ordre canonique (zone, passcode) + mêmes agrégats sur le modèle non trié → aucun tri ajouté à la saisie ; création manuelle limitée au main (Q2).
