# web — spécifique (complète ../AGENTS.md)

- `src/engine/` est pur : aucune importation React/DOM/store/API ; entrée `EngineInput`, sortie `EngineResult` ; exact par énumération de compositions et couplage maximum, jamais Monte-Carlo, jamais carte par carte.
- Une passe indisponible porte `unavailableReason` et `total = 0` : teste-la avant de lire ses champs ; ne dérive jamais `1 − brick`.
- Poids entiers conservés dans `Bucket.weight` (note /10 à arrondi exact) ; `binom` calcule en bigint ; agrège sur valeurs non arrondies, l'arrondi n'intervient qu'à l'affichage (`lib/fmt.ts`).
- `src/engine/reference/oracle.ts` est un oracle indépendant réservé aux tests : jamais importé par le code applicatif, jamais adapté au moteur. Les IDs P/N/S/C/M de `rules.test.ts` renvoient à docs/cas-reference.md.
- `lib/engineModel.ts` est l'unique passage deck + annotations → `EngineInput` (éditeur et comparateur) ; `engine/compare.ts` est une couche pure sur deux `PassResult`, elle ne recalcule rien.
- `worker/engine.worker.ts` calcule, c'est tout (une exception du moteur revient comme réponse `error` portant l'id). `worker/computeClient.ts` est pur et testable avec `worker/fakeWorker.ts` : un client = un worker = un propriétaire ; annuler la tâche en cours termine le worker et repose les suivantes sur un worker neuf ; toute promesse se termine (`ComputeCancelled` ou `ComputeFailed`), jamais bloquée. `worker/client.ts` est le seul module à importer le worker Vite.
- Recalcul (étape 4) : le store possède un client et au plus une tâche ; `modelVersion` avance à la mutation (avant le debounce de 50 ms), `result` porte `resultVersion`, `stale` = périmé (affiché atténué avec son `resultContext`), une réponse d'une autre version n'est jamais adoptée, une erreur garde l'ancien résultat et `recompute()` relance. Le comparateur crée son propre client par montage et le `dispose()` au démontage.
- `loadDeck`/`saveDeck` : `opening` numérote chaque ouverture ; toute réponse (chargement, brouillon, sauvegarde) d'une ouverture antérieure est ignorée — l'identité du deck seule ne suffit pas.
- Store : les données locales au deck (composition, starters, paires, conditions, disponibilités, params, notes) passent par Enregistrer (`dirty`, révision, 409) ; HOPT et catégories du compte s'écrivent immédiatement. Ne mélange pas les deux canaux.
- `lib/deckConfiguration.ts` importe le contrat serveur par chemin relatif ; `configurationFromState`/`stateFromConfiguration` restent un aller-retour sans perte (`store/persistence.test.ts`).
- Brouillons IndexedDB (`lib/draft.ts`) : résolution au commit de la transaction, jamais à `onsuccess` ; effacés seulement si identiques au sauvegardé.
- ExcelJS uniquement en import dynamique (`lib/exportComparison.ts`) ; l'onglet Synthèse est en formules, pas en constantes.
- Tests Vitest : `src/**/*.test.ts`, globals, environnement node (pas de DOM) ; un fichier : `npx vitest run src/engine/x.test.ts` depuis `web/`.
- Interface : sombre uniquement, densité 12 px, couleurs oklch dérivées jamais stockées ; réfère-toi à docs/design-system.md.
