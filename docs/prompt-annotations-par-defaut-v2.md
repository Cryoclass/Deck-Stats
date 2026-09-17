# Reprise du chantier « annotations par défaut »

Tu reprends un chantier commencé par un autre agent, qui s'est arrêté au milieu de la partie C
faute de crédits. Rien n'est perdu, mais une partie du travail n'est ni vérifiée ni commitée.
Ton rôle : terminer le chantier.

## Pourquoi ce chantier

Testhand calcule les probabilités d'ouverture d'un deck Yu-Gi-Oh!. Je veux le vendre comme un
outil clé en main : un joueur arrive, importe son deck et lit tout de suite des chiffres justes.
Jusqu'ici, le HOPT et les profils non-engine étaient vides par défaut et propres à chaque compte :
tant qu'un joueur ne les avait pas posés à la main, ses pourcentages étaient gonflés sans aucun
signal. Le chantier les pré-remplit : détection depuis le texte des cartes, puis référence commune
posée par un référent, puis choix du compte, qui ne touche que ce compte.

## Où on en est

Tout est dans **docs/annotations-par-defaut.md**, à lire en entier. Le §11 contient mes réponses et
les décisions révisées, le §13 le modèle de la partie C et son découpage en lots C1 / C2 / C3, les
§12 et §14 les comptes rendus de A et B.

- **Partie A** (détection) : commitée, tag `annotations-a-ok`.
- **Partie B** (profil `reactive`, porte profil / étiquette levée, migration 006 initiale) :
  commitée, tag `annotations-b-ok`.
- **Partie C** : dans l'arbre de travail de la branche `wip/audit-materiaux`, **non commitée**
  (environ 35 fichiers). Deux sous-agents y travaillaient en parallèle :
  - **Lot C1 (migration et déploiement)** : terminé et rapporté (résumé ci-dessous).
  - **Lots C2 / C3 (contrat, routes, `effectiveLibrary`, appelants)** : largement écrits
    (`server/src/auth/role.ts`, `server/src/routes/references.ts`, `library.ts`,
    `web/src/lib/effectiveLibrary.ts` et ses appelants), mais **aucun rapport** : l'agent a été
    coupé. Considère ce code comme non relu et non prouvé.
- **Partie D** (interface) : pas commencée.

Ce que j'ai vérifié moi-même le 17 septembre sur l'arbre actuel : `npm run typecheck` passe, et
`node scripts/test-quiet.mjs` passe (295 tests web, 22 serveur). Rien d'autre n'a été rejoué
après l'arrêt : ni les tests d'intégration PostgreSQL, ni l'e2e, ni la répétition complète.

### Rapport du lot C1 (il n'existe que dans une conversation, le voici)

Fichiers : `db/migrations/006-annotation-defaults.sql`, `deploy/backoffice-role.sh` et `.sql`,
`deploy/lib.sh`, `deploy/check-migration.sql`, `deploy/test-migration-sequence.sh`,
`docs/deploy-runbook.md`, une ligne d'AGENTS.md.

Prouvé par exécution : `test-migration-sequence.sh` passe 130 gardes sur 130 (cas A–J, dont un cas
« F sans 006 » qui pose des données représentatives et vérifie chaque effet de la migration de
données) ; 006 rejouée deux fois sans effet ; `backoffice-role.sh --role referent|admin` en
simulation, application, liste et révocation sur un conteneur jetable ; `rehearsal.sh --fixture` vert
aux étapes restauration, séquence, recalcul et retour arrière.

Écarts au §13, à reporter dans le document (ils n'y sont pas encore) :
1. Les données ne migrent qu'une fois, sous un **second marqueur de journal
   `006-annotation-defaults/c`**. Des `update` idempotents seraient faux : après C, `is_hopt = false`
   est un choix explicite qu'un rejeu effacerait, et les aperçus recalculés seraient revidés à chaque
   déploiement. Le marqueur principal ne pouvait pas servir, des bases l'ont déjà journalisé en B.
2. **`card_reference_log.actor` n'a pas de clé étrangère.** Avec `on delete set null`, l'action
   référentielle émet un `update` que le déclencheur d'ajout seul refuse : plus aucun compte ne
   pouvait être supprimé. Même raison que `backoffice_audit` en 005.
3. « Aucune ligne `is_hopt = false` » n'est contrôlée strictement qu'à la première application
   (`check_006_data`) ; dans `check-migration.sql`, c'est informatif, sinon le premier choix
   « false » d'un utilisateur bloquerait tous les déploiements suivants.
4. `card_flags.is_hopt` garde `default false`. Toute insertion sans `is_hopt` explicite vaut donc
   « pas HOPT » et non « hérite » : à vérifier dans tout le code serveur qui insère dans `card_flags`.
5. Les cartes seulement étiquetées ne sont **pas** matérialisées en choix (cohérent avec D14′ : une
   étiquette ne déclenche plus rien). 006 exige 005, avec un refus nominatif.
6. Un bug de la partie B est corrigé : un `\n` littéral dans la boucle `docker cp` du cas I.

Problèmes laissés ouverts par C1 :
- **L'e2e de la répétition échoue** : `web/e2e/scenarios/setup.mjs` crée un plafond « Mulcharmy »
  à 1 par tour, qui entre en collision avec le groupe « Mulcharmy » (2, fourni de base) que
  `server/src/auth/account.ts` crée désormais à l'inscription.
- `check-migration.sql` met un KO sur tout compte sans groupe « Mulcharmy » fourni de base. Si un
  chemin d'inscription ne le crée pas, une seule inscription bloque le déploiement suivant. Le lien
  est fragile, à garder par un test.
- `card_references.group_name` n'a aucune garantie de correspondre à un groupe existant (résolution
  par nom côté client).
- Rejouer 005 après 006 retirerait les `grant select` de 006 ; l'ordre actuel est bon partout.
- AGENTS.md, ligne 5, décrit encore 006 dans son état de la partie B.

Autre point : la base de dev a reçu la 006 de la partie B (sans le marqueur `/c`).

## Ce que je te demande

1. **Terminer la partie C.** Relis et vérifie le code C2 / C3 contre le §13 : aucun rapport ne dit ce
   qui est fini. Complète ce qui manque (le §13 cite notamment l'archive JSON, `prune-stale-cards`, le
   rapport d'écart de `scripts/annotations-report.ts` et les tests d'intégration). Corrige la fixture
   e2e, et fais passer toute la clôture habituelle : typecheck, build, suite complète, intégration
   PostgreSQL sur 55433, `test-migration-sequence.sh`, `rehearsal.sh --fixture` entièrement conforme,
   e2e, contrôle par mutation, relecture par un sous-agent à contexte neuf. Écris ensuite le compte
   rendu C dans docs/annotations-par-defaut.md, avec les écarts de C1 ci-dessus. Consigne les
   décisions dans DECISIONS.md et docs/decisions-compressees.md, puis commit et tag
   `annotations-c-ok`, sans rien pousser.
2. **Puis la partie D** (interface, §11 « Découpage révisé » et §13 « Client ») avec la même clôture
   et le tag `annotations-d-ok`. Si D exige une décision qui n'est ni dans le document ni dans mes
   réponses, pose-la avant de coder cette partie, pas au milieu.

Tu peux déléguer des lots à des sous-agents, en parallèle quand ils ne se marchent pas dessus. Donne
à chacun une liste de fichiers qui ne recoupe pas celle des autres : l'échec e2e ci-dessus vient
précisément de deux lots qui touchaient le même comportement sans se voir.

## Limites

- Lis AGENTS.md avant tout ; ses règles sur le moteur, les migrations et deploy/ s'appliquent. Les
  oracles, les cas de référence et les valeurs de contrôle historiques ne changent pas pour faire
  passer un test (le cas Q1 de 5A a été réécrit en B sur ma décision, c'est documenté).
- Conteneurs jetables pour tout ce qui écrit. La base de dev peut recevoir la migration par stdin,
  comme en B. Rien vers le VPS ni Supabase, aucun push.
- Ne lance jamais l'e2e en même temps que `test-migration-sequence.sh` ou `rehearsal.sh`, et ne
  modifie pas un script de deploy/ pendant qu'il tourne.
- Ne t'arrête pour me demander que si c'est vraiment nécessaire : action destructive ou
  irréversible, changement de périmètre, ou décision que moi seul peux prendre.

## Compte rendu

Avant d'annoncer qu'une chose est faite, vérifie-la contre un résultat d'outil de ta session ; ce
qui n'est pas vérifié est dit comme tel. Ne reprends jamais à ton compte une affirmation de ce prompt
ou d'un sous-agent sans l'avoir revérifiée. Ton message final est lu par quelqu'un qui n'a pas suivi :
le résultat d'abord, puis ce que tu attends de moi, en phrases complètes.
