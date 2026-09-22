import { create } from 'zustand';
import type { Availability, Card, CardOrigin, CardProfile, CardReference, Category, ComboPair, ConditionNode, DeckCard, LibraryChoice, Matchup, NonEngineGroup, SidePlanCard, SidePlanPosition, StartCondition, Zone } from '../types.js';
import { addMatchup as addMatchupTo, clearPlan as clearPlanIn, copyPlan as copyPlanIn, removeFromPlan as removeFromPlanIn, removeMatchup as removeMatchupFrom, renameMatchup as renameMatchupIn, setPlanNote as setPlanNoteIn, swapInPlan as swapInto, undoSwap as undoSwapIn, type PlanDirection, type SwapDelta } from '../lib/matchups.js';
import { EMPTY_SELECTION, adjustSelection, freeCopies, type Indicator, type Selection } from '../lib/swapPreview.js';
import { BASE_LABEL } from '../lib/studiedDeck.js';
import { DEFAULT_CANDIDATE_INDICATOR, EMPTY_STUDIED, NO_CANDIDATES, createStudyEngine, openPlan, type CandidatesState, type PreviewState, type StudiedResult, type StudyEngine } from './study.js';
import { pairKey } from '../types.js';
import type { AnalysisContext, EngineResult } from '../engine/types.js';
import type { QueryCriterion, SavedQuery } from '../engine/query.js';
import { createEngineClient } from '../worker/client.js';
import { ComputeCancelled, type ComputeClient, type ComputeTask } from '../worker/computeClient.js';
import { ApiError, api, type CardFlagsRow } from '../lib/api.js';
import { effectiveLibrary, effectiveOf } from '../lib/effectiveLibrary.js';
import { MAX_COPIES, type ParsedDeck } from '../lib/ydk.js';
import { saveDraft, loadDraft, clearDraft, type DeckDraft } from '../lib/draft.js';
import type { DeckJson } from '../lib/exportDeck.js';
import { buildEngineModel, type EngineModel } from '../lib/engineModel.js';
import { configurationFromState, configurationFromDetail, stateFromConfiguration, libraryState } from '../lib/deckConfiguration.js';
import { addClause, leaf, leavesOf, removeLeavesOfCard } from '../lib/conditions.js';
import { summaryOfState } from '../lib/summary.js';
import { nonEngineEffect } from '../lib/nonEngine.js';
import { ZONE_LABEL, zoneOfCatalog } from '../lib/zones.js';

export interface State {
  revision: number;
  editRevision: number;
  notes: string | null;
  saving: boolean;
  persistenceError: string | null;
  libraryPending: number;
  cards: Record<number, Card>;
  deckId: string | null;
  deckName: string;
  main: DeckCard[];
  extra: DeckCard[];
  side: DeckCard[];

  // Account-wide HOPT/categories/profiles/caps; pairs and start availability are deck-local.
  // Partie C (docs/annotations-par-defaut.md, D1, D6) : `hopt` et `profiles` sont les valeurs
  // EFFECTIVES (choix > référence > détection), dérivées de la bibliothèque brute ci-dessous et des
  // textes de `cards` par `deriveEffective` ; `origin` dit d'où vient chaque valeur.
  hopt: Set<number>;
  profiles: Map<number, CardProfile>;
  choices: Map<number, LibraryChoice>;
  chosenProfiles: Map<number, CardProfile>;
  references: Map<number, CardReference>;
  referencesVersion: string;
  origin: Map<number, CardOrigin>;
  groups: NonEngineGroup[];
  deadFirst: Set<number>;
  deadSecond: Set<number>;
  pairs: ComboPair[];
  categories: Category[];
  cardCategories: Map<number, Set<string>>;

  // ─── Local au deck : relève du bouton Enregistrer (§4A) ───
  starters: Set<number>;
  pairExclusions: Set<string>;
  startConditions: StartCondition[]; // étape 5 : conditions ET/OU par source de start
  // Étape 10 : adversaires et plans de side. Donnée du deck (enregistrée, exportée, dupliquée),
  // jamais du modèle moteur — le deck sidé est un modèle DÉRIVÉ, calculé à part.
  matchups: Matchup[];
  /** Étape 10B/10C : chiffres stockés des plans (`GET /decks/:id`, clé « adversaire:position »),
   *  caches à valider par `usablePlanSummary` — jamais dans la configuration ni le brouillon. */
  planSummaries: Record<string, unknown>;
  importance: number;
  // Contexte d'analyse unique (contrat §3) : premier · 5 cartes / second · 5 + pioche.
  // Réglage d'affichage transitoire, commun à la grille (deltas), à la matrice, aux
  // requêtes et au mur de mains ; il ne modifie pas le modèle (les deux passes sont
  // toujours calculées) et n'est pas enregistré.
  context: AnalysisContext;
  // Vue du panneau de stats ('starts' | 'nonengine' | catId). Étape 9B : transitoire comme le
  // contexte — plus un paramètre du deck (changer de vue ne salit pas), jamais émise, une valeur
  // encore présente dans une configuration enregistrée avant 9B est acceptée et ignorée.
  statsView: string;
  savedQueries: SavedQuery[]; // itération 7 : requêtes nommées (param du deck)
  // Requête en cours (brouillon de travail, non enregistrée) + filtre du mur de mains
  // unifié avec elle (§D) : les deux sont transitoires, hors params.
  queryCriteria: QueryCriterion[];
  handFilterByQuery: boolean;

  // ─── Plans de side v2 (partie B) : contexte d'étude, decks étudiés, aperçu, candidats ───
  // Tout est TRANSITOIRE (jamais dans la configuration, le brouillon ni « non enregistré ») ; la
  // position étudiée est `context`. L'orchestration vit dans store/study.ts.
  study: { matchupId: string | null };
  studied: Record<SidePlanPosition, StudiedResult>;
  /** Échange en préparation sur le plan ouvert (adversaire étudié, position courante). */
  selection: Selection;
  /** Échanges validés sur le plan ouvert pendant la session (« Annuler l'échange »). */
  swapHistory: SwapDelta[];
  preview: PreviewState;
  candidates: CandidatesState;
  candidateIndicator: Indicator;
  /** Durée mesurée de la dernière passe calculée par position (estimation du coût des candidats). */
  lastPassMs: Record<SidePlanPosition, number | null>;

  online: boolean;
  result: EngineResult | null;
  model: EngineModel | null;
  computeMs: number;
  computing: boolean; // une version est demandée et pas encore calculée (dès l'invalidation)
  // ─── Recalcul (étape 4, contrat §6) ───
  // `modelVersion` avance à CHAQUE invalidation, dès la mutation et avant le délai de
  // regroupement ; `resultVersion` est la version pour laquelle `result` a été calculé ;
  // `stale` = résultat présent mais d'une version antérieure (affiché atténué) ;
  // `resultContext` = contexte (taille, catégories, cartes sans profil) de CE résultat, pour le
  // présenter avec ses propres libellés et non ceux de l'état courant.
  modelVersion: number;
  resultVersion: number;
  stale: boolean;
  computeError: string | null;
  resultContext: ResultContext | null;
  // Numéro d'ouverture (loadDeck). L'identité du deck seule ne distingue pas deux
  // ouvertures du même deck : toute réponse d'une ouverture antérieure est ignorée.
  opening: number;
  removalToast: { card: DeckCard; index: number; ts: number } | null;
  extraSideHidden: boolean;

  // Persistance explicite (§4B).
  dirty: boolean; // modifications non enregistrées portant sur les données LOCALES
  lastSavedAt: number | null;
  draftAvailable: DeckDraft | null; // brouillon retrouvé à l'ouverture

  // actions
  bootstrap: () => Promise<void>;
  createDeckFromParsed: (name: string, parsed: ParsedDeck, cards: Card[]) => Promise<string | null>;
  importDeckJson: (json: DeckJson) => Promise<string | null>;
  loadDeck: (id: string) => Promise<void>;
  saveDeck: () => Promise<void>;
  recompute: () => void; // relance explicite (après une erreur de calcul)
  resumeDraft: () => void;
  discardDraft: () => Promise<void>;
  /** `false` = refusé (convention 1–3 par carte et par zone), motif dans `persistenceError`.
   *  Étape 9C : la zone (défaut `main`) désigne la liste éditée ; extra et side marquent « non
   *  enregistré » sans recalcul (jamais dans le modèle moteur, contrat §2). */
  addCard: (card: Card, copies?: number, zone?: Zone) => boolean;
  setCopies: (cardId: number, copies: number, zone?: Zone) => boolean;
  undoRemove: () => void;
  dismissRemovalToast: () => void;
  removeCard: (cardId: number, zone?: Zone) => void;
  toggleStarter: (cardId: number) => void;
  toggleHopt: (cardId: number) => void;
  /** Retour au défaut d'un aspect (D6) : la carte hérite à nouveau de la référence ou de la détection. */
  resetAnnotation: (cardId: number, aspect: 'hopt' | 'nonengine') => void;
  toggleDeadFirst: (cardId: number) => void;
  toggleDeadSecond: (cardId: number) => void;
  togglePair: (a: number, b: number) => void;
  setPairExcluded: (pairId: string, excluded: boolean) => void;
  removePairFromDeck: (pairId: string) => void;
  toggleRequirement: (
    source: { cardId: number } | { pairId: string },
    requiredCardId: number,
  ) => void;
  /** Remplace l'arbre d'une source (`null` = source inconditionnelle). */
  setCondition: (source: { cardId: number } | { pairId: string }, condition: ConditionNode | null) => void;
  removeCondition: (id: string) => void;
  addCategory: (name: string) => void;
  deleteCategory: (id: string) => void;
  toggleCardCategory: (cardId: number, categoryId: string) => void;
  /** Mode Non-engine (partie D) : `categoryId` et `profile` facultatifs, jamais les deux absents. */
  applyNonEngine: (cardId: number, categoryId: string | null, profile: Availability | null) => void;
  saveReference: (cardId: number, reference: Omit<CardReference, 'card_id'>) => void;
  clearReference: (cardId: number) => void;
  setProfile: (cardId: number, availability: Availability | null) => void;
  setCardGroup: (cardId: number, groupId: string | null) => void;
  addGroup: (name: string, capPerTurn: number) => void;
  updateGroup: (id: string, patch: { name?: string; cap_per_turn?: number }) => void;
  deleteGroup: (id: string) => void;
  setImportance: (v: number) => void;
  setContext: (context: AnalysisContext) => void;
  setStatsView: (view: string) => void;
  setQueryCriteria: (criteria: QueryCriterion[]) => void;
  saveQuery: (name: string) => void;
  loadSavedQuery: (id: string) => void;
  deleteSavedQuery: (id: string) => void;
  setHandFilterByQuery: (on: boolean) => void;
  setExtraSideHidden: (hidden: boolean) => void;
  renameDeck: (name: string) => void;
  // Étape 10C : adversaires et plans de side (lib/matchups.ts) — « non enregistré », jamais de recalcul.
  addMatchup: (name: string) => string | null;
  renameMatchup: (id: string, name: string) => void;
  removeMatchup: (id: string) => void;
  swapInPlan: (matchupId: string, position: SidePlanPosition, outgoing: SidePlanCard[], incoming: SidePlanCard[]) => boolean;
  removeFromPlan: (matchupId: string, position: SidePlanPosition, direction: PlanDirection, cardId: number) => void;
  setPlanNote: (matchupId: string, position: SidePlanPosition, note: string) => void;
  copyPlan: (matchupId: string, from: SidePlanPosition, to: SidePlanPosition) => void;
  setPlanSummary: (matchupId: string, position: SidePlanPosition, summary: unknown) => void;
  // Plans de side v2 (partie B) : contexte d'étude et sélection — transitoires, jamais « non enregistré ».
  setStudy: (matchupId: string | null) => void;
  setSelection: (selection: Selection) => void;
  /** Clic (+1) ou clic droit (−1) sur une carte de la zone, borné par ses copies libres. */
  adjustSelectionCopy: (direction: PlanDirection, cardId: number, delta: 1 | -1) => void;
  clearSelection: () => void;
  /** « Échanger » : la sélection rejoint le plan ouvert (règle `trySwap`), l'échange entre dans l'historique. */
  commitSelection: () => boolean;
  undoLastSwap: () => void;
  clearOpenPlan: () => void;
  setCandidateIndicator: (indicator: Indicator) => void;
  runCandidates: () => void;
}

/** Contexte d'un résultat : ce qu'il faut pour l'afficher avec ses propres libellés. */
export interface ResultContext {
  deckId: string | null;
  deckSize: number;
  categories: Category[];
  /** Cartes étiquetées sans profil au moment du calcul : non comptées (Q5), signalées. */
  unprofiledCardIds: number[];
}

/** Cartes nommées par les plans de side d'un deck (entrantes et sortantes), zones comprises ou non. */
const planCardIds = (matchups: readonly Matchup[]): number[] => matchups.flatMap((m) => m.plans.flatMap((p) => [...p.outgoing,...p.incoming].map((c) => c.card_id)));

const toDeck = (m: Map<number, number>, zone: DeckCard['zone']): DeckCard[] =>
  [...m].map(([cardId, copies]) => ({ cardId, copies, zone }));

const uid = (): string => crypto.randomUUID();
const defaultQuery = (): QueryCriterion[] => [
  { id: uid(), subject: { kind: 'starts' }, min: 1, max: null },
];

// Toute modification (locale ou globale) invalide entièrement l'état calculé puis
// déclenche un recalcul intégral dans le worker (§4C.2) — jamais de MàJ partielle.
// La construction du modèle vit dans lib/engineModel.ts (partagée avec le comparateur).
//
// Étape 4 (contrat §6) :
//   1. l'invalidation est IMMÉDIATE : `modelVersion` avance à la mutation, avant le
//      délai de regroupement ; l'ancien résultat reste affiché, marqué `stale` ;
//   2. un calcul en cours pour une version antérieure est ANNULÉ (worker terminé,
//      ressources libérées) — le store possède un seul client et au plus une tâche ;
//   3. une réponse n'est adoptée que si sa version est encore celle demandée ;
//   4. une erreur conserve l'ancien résultat (obsolète, explicite) et `recompute()`
//      permet la relance ; une annulation n'est pas une erreur.
export const COMPUTE_DEBOUNCE_MS = 50;
let computeTimer: ReturnType<typeof setTimeout> | null = null;
let computeClient: ComputeClient | null = null;
let inflight: ComputeTask | null = null;
let studyEngine: StudyEngine | null = null;
const engineClient = (): ComputeClient => (computeClient ??= createEngineClient());
/** Tests seulement : caches et tâches de l'orchestrateur d'étude remis à zéro (ce que `loadDeck` fait). */
export const resetStudyEngine = (): void => studyEngine?.reset();

const initialStudied = (): Record<SidePlanPosition, StudiedResult> => ({
  first: { ...EMPTY_STUDIED({ position: 'first', kind: 'base', matchup: null, plan: null, applied: null, source: null, label: BASE_LABEL, unavailableReason: null }), reusesBase: true },
  second: { ...EMPTY_STUDIED({ position: 'second', kind: 'base', matchup: null, plan: null, applied: null, source: null, label: BASE_LABEL, unavailableReason: null }), reusesBase: true },
});
/** État transitoire d'étude à l'ouverture d'un deck : deck de base, rien de sélectionné. */
const freshStudy = () => ({ study: { matchupId: null }, studied: initialStudied(), selection: EMPTY_SELECTION, swapHistory: [] as SwapDelta[], preview: { kind: 'none' } as PreviewState, candidates: NO_CANDIDATES, lastPassMs: { first: null, second: null } as Record<SidePlanPosition, number | null>, context: 'first' as AnalysisContext });

function scheduleCompute(get: () => State, set: (p: Partial<State>) => void): void {
  if (computeTimer) clearTimeout(computeTimer);
  if (inflight) {
    inflight.cancel();
    inflight = null;
  }
  const version = get().modelVersion + 1;
  set({ modelVersion: version, stale: get().result !== null, computing: true, computeError: null });
  // Plans de side v2 : l'aperçu et les candidats se recalculent dès l'invalidation (leur entrée a pu
  // changer) ; les decks étudiés suivent le deck de base, derrière lui (launchCompute).
  studyEngine?.syncPreview();
  studyEngine?.syncCandidates();
  computeTimer = setTimeout(() => {
    computeTimer = null;
    launchCompute(version, get, set);
  }, COMPUTE_DEBOUNCE_MS);
}

function launchCompute(version: number, get: () => State, set: (p: Partial<State>) => void): void {
  if (get().modelVersion !== version) return; // une invalidation plus récente a repris la main
  const s = get();
  const model = buildEngineModel(s);
  const resultContext: ResultContext = {
    deckId: s.deckId,
    deckSize: s.main.reduce((sum, c) => sum + c.copies, 0),
    categories: s.categories,
    unprofiledCardIds: model.unprofiledCardIds,
  };
  const task = engineClient().compute(model.input);
  inflight = task;
  studyEngine?.syncStudied();
  task.promise.then(
    ({ result, ms }) => {
      if (inflight === task) inflight = null;
      if (get().modelVersion !== version) return; // réponse d'une version périmée : jamais adoptée
      set({ result, model, resultContext, resultVersion: version, stale: false, computing: false, computeMs: ms, computeError: null });
    },
    (e: unknown) => {
      if (inflight === task) inflight = null;
      if (e instanceof ComputeCancelled) return; // annulée par une invalidation plus récente
      if (get().modelVersion !== version) return;
      set({ computing: false, computeError: e instanceof Error ? e.message : 'Calcul impossible.' });
    },
  );
}

// Each draft captures the edited deck immediately, even if navigation follows.
function scheduleDraft(get: () => State): void {
  const s = get();
  if (!s.deckId) return;
  try {
    void saveDraft({ version: 2,deckId: s.deckId,updatedAt: Date.now(),baseRevision: s.revision,configuration: configurationFromState(s) });
  } catch { /* Incomplete input remains dirty and is reported by explicit save. */ }
}
let libraryQueue = Promise.resolve();
let libraryPending = 0;
function persist(set: (p: Partial<State>) => void, fn: () => Promise<unknown>): void {
  set({ libraryPending: ++libraryPending,persistenceError: null });
  libraryQueue = libraryQueue.then(fn).then(() => { set({ online: true }); }, (e: unknown) => {
    set({ persistenceError: e instanceof Error ? e.message : 'Enregistrement des annotations impossible.',online: e instanceof ApiError });
  }).finally(() => set({ libraryPending: --libraryPending }));
}

export const CATALOG_UNAVAILABLE = 'Catalogue des cartes indisponible : sans le texte des cartes, les annotations par défaut manquent et les chiffres seraient faux. Rechargez.';

/** Valeurs effectives (R1) de toutes les cartes connues du store (catalogue chargé et zones). */
function effectiveOfState(s: Pick<State, 'choices' | 'chosenProfiles' | 'groups' | 'references' | 'cards' | 'main' | 'extra' | 'side'>): Pick<State, 'hopt' | 'profiles' | 'origin'> {
  const ids = new Set<number>([...Object.keys(s.cards).map(Number), ...s.main.map((c) => c.cardId), ...s.extra.map((c) => c.cardId), ...s.side.map((c) => c.cardId)]);
  return effectiveLibrary({ hopt: new Set(), choices: s.choices, chosenProfiles: s.chosenProfiles, groups: s.groups, references: s.references }, s.cards, ids);
}

export const useDeck = create<State>((set, get) => {
  const recompute = () => scheduleCompute(get, set);
  studyEngine = createStudyEngine(get, set, engineClient);
  const study = studyEngine;
  /** Une mutation qui peut changer un plan, une zone ou la sélection : decks étudiés (regroupés), aperçu, candidats. */
  const studySync = () => {
    study.scheduleStudied();
    study.syncPreview();
    study.syncCandidates();
  };
  const deriveEffective = () => set(effectiveOfState(get()));
  /** Ce que le serveur doit matérialiser au premier geste sur l'aspect non-engine d'une carte héritée. */
  const inheritedOf = (cardId: number) => {
    const s = get();
    if (s.choices.get(cardId)?.nonengine_choice) return undefined;
    const e = effectiveOf({ hopt: new Set(), choices: s.choices, chosenProfiles: s.chosenProfiles, groups: s.groups, references: s.references }, cardId, s.cards[cardId]);
    return e.origin.nonengine === null ? undefined : e.inherited; // rien à matérialiser sans défaut
  };
  /** Adopte une ligne de drapeaux acquittée par le serveur (choix et profil matérialisé), puis dérive. */
  const adoptFlags = (cardId: number, row: CardFlagsRow) => {
    const choices = new Map(get().choices);
    if (row.is_hopt === null && !row.nonengine_choice) choices.delete(cardId);
    else choices.set(cardId, { card_id: cardId, is_hopt: row.is_hopt, nonengine_choice: row.nonengine_choice });
    const chosenProfiles = new Map(get().chosenProfiles);
    if (row.availability) chosenProfiles.set(cardId, { availability: row.availability, groupId: row.group_id });
    else chosenProfiles.delete(cardId);
    set({ choices, chosenProfiles });
    deriveEffective();
  };
  const markDirty = () => {
    set({ dirty: true,editRevision: get().editRevision+1 });
    scheduleDraft(get);
  };
  // Mutation LOCALE affectant le calcul : recalcul + marquage sale + brouillon.
  const localCalc = () => {
    recompute();
    markDirty();
  };
  // Étape 9C : une mutation de composition ne recalcule que si elle touche le main deck ;
  // extra et side ne sont jamais dans le modèle moteur (contrat §2) — « non enregistré » seul.
  const zoneMutation = (zone: Zone) => {
    if (zone === 'main') localCalc();
    else {
      markDirty();
      studySync(); // un plan peut devenir « à revoir », une sélection invalide (plans de side v2)
    }
  };
  // Étape 10C : une annotation ne recalcule que si elle change l'ENTRÉE du moteur. Une annotation
  // portée par une carte hors main (side annoté pour un plan de side) ne la change pas : « non
  // enregistré » seul, le résultat reste frais. Règle exacte, pas une heuristique par carte : une
  // condition de carte de side qui exige une carte du main promeut celle-ci en type suivi, l'entrée
  // change, on recalcule. Dans le doute (calcul en cours, résultat périmé ou absent), on recalcule.
  const modelUnchanged = (): boolean => {
    const s = get();
    return s.model !== null && s.result !== null && !s.computing && !s.stale && s.resultVersion === s.modelVersion
      && JSON.stringify(buildEngineModel(s).input) === JSON.stringify(s.model.input);
  };
  // Plans de side v2 : une annotation qui ne change pas le deck de base (carte de side) peut changer le
  // deck ÉTUDIÉ, l'aperçu et les candidats — ils se resynchronisent (le recalcul de base le fait déjà).
  const annotationCalc = () => {
    if (modelUnchanged()) { markDirty(); studySync(); }
    else localCalc();
  };
  // Annotations du compte (HOPT, étiquette, profil, plafond d'une carte) : même règle, sans
  // « non enregistré » (elles sont déjà persistées par l'API).
  const libraryCalc = () => {
    if (!modelUnchanged()) recompute();
    else studySync();
  };

  return {
    revision: 0,editRevision: 0,notes: null,saving: false,persistenceError: null,libraryPending: 0,
    cards: {},
    deckId: null,
    deckName: 'Sans titre',
    main: [],
    extra: [],
    side: [],
    hopt: new Set(),
    profiles: new Map(),
    choices: new Map(),
    chosenProfiles: new Map(),
    references: new Map(),
    referencesVersion: '0',
    origin: new Map(),
    groups: [],
    deadFirst: new Set(),
    deadSecond: new Set(),
    pairs: [],
    categories: [],
    cardCategories: new Map(),
    starters: new Set(),
    pairExclusions: new Set(),
    startConditions: [],
    matchups: [],
    planSummaries: {},
    importance: 0.5,
    statsView: 'starts',
    savedQueries: [],
    queryCriteria: defaultQuery(),
    handFilterByQuery: false,
    ...freshStudy(),
    candidateIndicator: DEFAULT_CANDIDATE_INDICATOR,
    online: true,
    result: null,
    model: null,
    computeMs: 0,
    computing: false,
    modelVersion: 0,
    resultVersion: 0,
    stale: false,
    computeError: null,
    resultContext: null,
    opening: 0,
    removalToast: null,
    extraSideHidden: false,
    dirty: false,
    lastSavedAt: null,
    draftAvailable: null,

    // Bibliothèque globale (transverse aux decks) — chargée une fois au démarrage.
    async bootstrap() {
      try {
        const lib = await api.getLibrary();
        set({
          ...libraryState(lib),
          online: true,
        });
        deriveEffective();
      } catch {
        set({ online: false });
      }
    },

    // Crée un deck en base (import YDK / collage / vide) et renvoie son id. Ne charge
    // pas l'état d'édition : l'éditeur appelle loadDeck(id) après navigation.
    // Étape 6 (C3) : un refus du serveur (400 : quantité, passcode, nom) est rendu par
    // son message dans `persistenceError` ; seul un fetch qui rejette vaut « hors-ligne ».
    async createDeckFromParsed(name, parsed, cards) {
      const cardMap: Record<number, Card> = { ...get().cards };
      for (const c of cards) cardMap[c.id] = c;
      set({ cards: cardMap, persistenceError: null });
      deriveEffective();
      const all = [
        ...toDeck(parsed.main, 'main'),
        ...toDeck(parsed.extra, 'extra'),
        ...toDeck(parsed.side, 'side'),
      ];
      try {
        const { id } = await api.createDeck(
          name.trim() || 'Deck importé',
          all.map((c) => ({ card_id: c.cardId, zone: c.zone, copies: c.copies })),
        );
        return id;
      } catch (e) {
        if (e instanceof ApiError) set({ persistenceError: e.message, online: true });
        else set({ online: false, persistenceError: 'Backend indisponible — impossible de créer le deck.' });
        return null;
      }
    },

    // One server transaction includes imported global annotations and the deck.
    async importDeckJson(json) {
      try {
        const { id } = await api.importArchive(json);
        await get().bootstrap();
        return id;
      } catch (e) {
        set({ persistenceError: e instanceof Error ? e.message : 'Import impossible.' });
        return null;
      }
    },

    // Charge un deck depuis la base dans l'éditeur, puis propose un brouillon si présent.
    // Chaque appel ouvre une NOUVELLE ouverture (étape 4) : après chaque attente, une
    // ouverture plus récente rend celle-ci muette. Deux chargements résolus à l'envers
    // laissent donc l'état du dernier demandé ; un brouillon ou une sauvegarde d'une
    // ouverture antérieure ne touchent jamais l'état.
    async loadDeck(id) {
      const opening = get().opening + 1;
      set({ opening });
      const current = () => get().opening === opening;
      try {
        // Library must be ready before building the model for this deck.
        await libraryQueue;
        await get().bootstrap();
        if (!current()) return;
        if (!get().online) throw new Error('Bibliothèque indisponible : impossible de charger une configuration fiable.');
        const detail = await api.getDeck(id);
        if (!current()) return;
        const configuration = configurationFromDetail(detail);
        const cardMap = { ...get().cards };
        // Plans de side v2 (S5) : la zone d'une carte de plan vient de son type → les cartes de plan sont
        // chargées aussi, même retirées du deck (sinon « zone inconnue » au lieu de « plus en side »).
        const ids = new Set([...configuration.cards.map((c) => c.card_id),...configuration.pairs.flatMap((p) => [p.card_a_id,p.card_b_id]),...configuration.conditions.flatMap((r) => leavesOf(r.condition).map((l) => l.leaf.card_id)),...planCardIds(configuration.matchups)]);
        // Partie C : les textes des cartes déterminent les annotations par défaut, donc les chiffres (et
        // l'aperçu joint à l'enregistrement) ; sans eux, aucun calcul plutôt qu'un calcul faux.
        try { for (const c of await api.cardsByIds([...ids])) cardMap[c.id] = c; } catch { throw new Error(CATALOG_UNAVAILABLE); }
        if (!current()) return;
        // Aucune ancienne statistique ne survit à l'ouverture d'un deck : état initial de
        // calcul, jamais un mélange avec le résultat du deck précédent (§6).
        study.reset();
        set({ ...stateFromConfiguration(configuration),cards: cardMap,deckId: id,revision: detail.revision,...freshStudy(),
          planSummaries: Object.fromEntries((detail.plan_summaries ?? []).map((r) => [`${r.matchup_id}:${r.position}`,r.summary])),
          dirty: false,editRevision: 0,lastSavedAt: Date.parse(detail.updated_at ?? ''),draftAvailable: null,
          persistenceError: null,removalToast: null,queryCriteria: defaultQuery(),handFilterByQuery: false,
          result: null,model: null,resultContext: null,stale: false,computeError: null });
        deriveEffective();
        recompute();
        const draft = await loadDraft(id);
        if (!current()) return;
        if (draft && JSON.stringify(draft.configuration) !== JSON.stringify(configuration)) set({ draftAvailable: draft });
      } catch (e) {
        if (current()) set({ persistenceError: e instanceof Error ? e.message : 'Chargement impossible.' });
      }
    },

    async saveDeck() {
      if (get().saving) return;
      set({ saving: true,persistenceError: null });
      const s = get();
      if (!s.deckId) { set({ saving: false }); return; }
      // La réponse n'est adoptée que par l'OUVERTURE qui l'a demandée (étape 4) : quitter
      // puis rouvrir le même deck avant la réponse ne doit ni effacer le statut modifié
      // d'une édition plus récente, ni poser une révision sur un état rechargé (dont on ne
      // sait pas s'il précède ou suit le commit). Le brouillon, comparé par contenu,
      // est effacé dans tous les cas s'il correspond au sauvegardé.
      const sameOpening = () => get().opening === s.opening && get().deckId === s.deckId;
      try {
        const configuration = configurationFromState(s);
        // Étape 9 : l'aperçu de l'accueil est joint seulement si le résultat courant est celui de la
        // version demandée (ni périmé, ni en cours) ; sinon il reste absent et l'accueil recalcule.
        const saved = await api.saveConfiguration(s.deckId,configuration,s.revision,summaryOfState(s));
        if (sameOpening()) {
          const unchanged = get().editRevision === s.editRevision;
          set({ revision: saved.revision,dirty: !unchanged,lastSavedAt: Date.now(),online: true });
          if (!unchanged) scheduleDraft(get);
          else study.scheduleStudied(); // chiffres des plans étudiés persistables pour la révision enregistrée
        }
        await clearDraft(s.deckId,configuration);
      } catch (e) {
        if (sameOpening()) set({ dirty: true,persistenceError: e instanceof Error ? e.message : 'Enregistrement impossible.' });
      } finally {
        set({ saving: false });
      }
    },

    recompute() {
      recompute();
    },

    resumeDraft() {
      const d = get().draftAvailable;
      if (!d) return;
      set({ ...stateFromConfiguration(d.configuration),draftAvailable: null,dirty: true,editRevision: get().editRevision+1,selection: EMPTY_SELECTION,swapHistory: [] });
      // Keep the loaded server revision; an old draft is an explicit user restoration.
      deriveEffective();
      recompute();
      // Partie C : une carte ajoutée dans le brouillon n'a pas encore son texte ; sans lui, aucun défaut.
      const missing = [...d.configuration.cards.map((c) => c.card_id),...planCardIds(d.configuration.matchups)].filter((cardId) => !get().cards[cardId]);
      if (missing.length) void api.cardsByIds(missing).then((loaded) => {
        if (get().deckId !== d.deckId) return;
        set({ cards: { ...get().cards,...Object.fromEntries(loaded.map((c) => [c.id,c])) } });
        deriveEffective();
        recompute();
      }).catch(() => { set({ persistenceError: CATALOG_UNAVAILABLE }); });
    },

    async discardDraft() {
      const d = get().draftAvailable;
      set({ draftAvailable: null });
      if (d) await clearDraft(d.deckId);
    },

    // ─── Mutations LOCALES au deck (marquent « non enregistré ») ───
    // Étape 6 (C1, C2) : la convention 1–3 copies (contrat §2) est REFUSÉE, jamais
    // appliquée par réduction silencieuse ; le refus est dit dans `persistenceError`
    // et la mutation retourne `false`. 0 copie = retrait, documenté (§D).
    // Étape 9C : chaque mutation porte sa zone. Seul le main deck entre dans le modèle
    // moteur (contrat §2) : une mutation de l'extra ou du side marque « non enregistré »
    // (brouillon compris) SANS recalcul — le résultat courant reste frais et l'aperçu joint à
    // l'enregistrement le reste aussi.
    addCard(card, copies = 1, zone = 'main') {
      const existing = get()[zone].find((m) => m.cardId === card.id);
      const requested = existing ? existing.copies + 1 : copies;
      if (!Number.isInteger(requested) || requested < 1 || requested > MAX_COPIES) {
        set({ persistenceError: `${card.name} : déjà ${existing?.copies ?? 0} copie${(existing?.copies ?? 0) > 1 ? 's' : ''} en ${ZONE_LABEL[zone]} — convention 1 à ${MAX_COPIES} par carte et par zone, aucune réduction appliquée.` });
        return false;
      }
      const cards = { ...get().cards, [card.id]: card };
      const list = existing
        ? get()[zone].map((m) => (m.cardId === card.id ? { ...m, copies: requested } : m))
        : [...get()[zone], { cardId: card.id, copies: requested, zone }];
      set({ cards, [zone]: list, persistenceError: null });
      deriveEffective();
      zoneMutation(zone);
      return true;
    },

    setCopies(cardId, copies, zone = 'main') {
      if (copies <= 0) {
        get().removeCard(cardId, zone); // 0 copie = retrait (§D)
        return true;
      }
      if (!Number.isInteger(copies) || copies > MAX_COPIES) {
        set({ persistenceError: `Quantité ${copies} refusée en ${ZONE_LABEL[zone]} : convention 1 à ${MAX_COPIES} copies par carte et par zone, aucune réduction appliquée.` });
        return false;
      }
      set({ [zone]: get()[zone].map((m) => (m.cardId === cardId ? { ...m, copies } : m)), persistenceError: null });
      zoneMutation(zone);
      return true;
    },

    // Retrait : uniquement deck_cards. Annotations CONSERVÉES, inertes, restaurées au
    // ré-ajout (§4C1). Toast d'annulation ; la carte retirée porte sa zone (9C).
    removeCard(cardId, zone = 'main') {
      const index = get()[zone].findIndex((m) => m.cardId === cardId);
      if (index < 0) return;
      const card = get()[zone][index];
      set({
        [zone]: get()[zone].filter((m) => m.cardId !== cardId),
        removalToast: { card, index, ts: Date.now() },
      });
      zoneMutation(zone);
    },

    undoRemove() {
      const t = get().removalToast;
      if (!t) return;
      const zone = t.card.zone;
      const list = get()[zone].filter((c) => c.cardId !== t.card.cardId);
      list.splice(Math.min(t.index, list.length), 0, t.card);
      set({ [zone]: list, removalToast: null });
      zoneMutation(zone);
    },

    dismissRemovalToast() {
      set({ removalToast: null });
    },

    toggleStarter(cardId) {
      const starters = new Set(get().starters);
      if (starters.has(cardId)) starters.delete(cardId);
      else starters.add(cardId);
      set({ starters });
      annotationCalc();
    },

    setPairExcluded(pairId, excluded) {
      const pairExclusions = new Set(get().pairExclusions);
      if (excluded) pairExclusions.add(pairId);
      else pairExclusions.delete(pairId);
      set({ pairExclusions });
      annotationCalc();
    },

    setImportance(v) {
      set({ importance: v });
      markDirty(); // n'affecte pas le calcul, seulement les notes → pas de recompute
    },

    setStatsView(view) {
      set({ statsView: view }); // affichage seul (9B) : ni recalcul, ni « non enregistré », ni brouillon
    },

    // ─── Mode requête (itération 7) : la requête en cours est transitoire ; seules les
    //     requêtes NOMMÉES rejoignent les params du deck (enregistrables). ───
    setQueryCriteria(criteria) {
      set({ queryCriteria: criteria });
    },

    saveQuery(name) {
      const q: SavedQuery = {
        id: uid(),
        name: name.trim() || 'Requête',
        criteria: get().queryCriteria,
      };
      set({ savedQueries: [...get().savedQueries, q] });
      markDirty();
    },

    loadSavedQuery(id) {
      const q = get().savedQueries.find((x) => x.id === id);
      if (q) set({ queryCriteria: q.criteria.map((c) => ({ ...c, id: uid() })) });
    },

    deleteSavedQuery(id) {
      set({ savedQueries: get().savedQueries.filter((x) => x.id !== id) });
      markDirty();
    },

    setHandFilterByQuery(on) {
      set({ handFilterByQuery: on });
    },

    setContext(context) {
      // Affichage seul : les deux passes sont déjà calculées. Plans de side v2 : la position change le plan
      // OUVERT, donc la sélection en cours et l'historique des échanges tombent (transitoires).
      if (get().context === context) return;
      set({ context,selection: EMPTY_SELECTION,swapHistory: [] });
      study.syncPreview();
      study.syncCandidates();
    },

    // ─── Adversaires et plans de side (étape 10C) : données du deck, jamais du modèle moteur du
    //     deck de base → « non enregistré » + brouillon, AUCUN recalcul. Mutations pures dans
    //     lib/matchups.ts ; un échange refusé nomme sa raison (persistenceError) et ne change rien. ───
    addMatchup(name) {
      if (!name.trim()) return null;
      const id = uid();
      set({ matchups: addMatchupTo(get().matchups,name,id) });
      markDirty();
      return id;
    },
    renameMatchup(id, name) {
      if (!name.trim()) return;
      set({ matchups: renameMatchupIn(get().matchups,id,name) });
      markDirty();
    },
    removeMatchup(id) {
      set({ matchups: removeMatchupFrom(get().matchups,id),...(get().study.matchupId === id ? { selection: EMPTY_SELECTION,swapHistory: [] } : {}) });
      markDirty();
      studySync();
    },
    swapInPlan(matchupId, position, outgoing, incoming) {
      const s = get();
      // v2 (S5, S6) : zone de chaque carte déduite de son type, équilibre jugé zone par zone.
      const r = swapInto(s.matchups,matchupId,position,{ main: s.main,extra: s.extra,side: s.side },zoneOfCatalog(s.cards),{ outgoing,incoming },(id) => s.cards[id]?.name ?? `#${id}`);
      if (!r.ok) { set({ persistenceError: r.reason }); return false; }
      set({ matchups: r.matchups,persistenceError: null });
      markDirty();
      studySync();
      return true;
    },
    removeFromPlan(matchupId, position, direction, cardId) {
      set({ matchups: removeFromPlanIn(get().matchups,matchupId,position,direction,cardId) });
      markDirty();
      studySync();
    },
    setPlanNote(matchupId, position, note) {
      set({ matchups: setPlanNoteIn(get().matchups,matchupId,position,note) });
      markDirty();
    },
    copyPlan(matchupId, from, to) {
      set({ matchups: copyPlanIn(get().matchups,matchupId,from,to) });
      markDirty();
      studySync();
    },

    // ─── Plans de side v2 (partie B) : contexte d'étude, sélection, aperçu, candidats ───
    // Rien ici n'est enregistré ni ne marque « non enregistré » : seul `commitSelection` (= un échange
    // dans le plan) passe par `markDirty`, comme `swapInPlan`.
    setStudy(matchupId) {
      if (get().study.matchupId === matchupId) return;
      set({ study: { matchupId },selection: EMPTY_SELECTION,swapHistory: [],candidates: NO_CANDIDATES });
      studySync(); // regroupé : derrière un recalcul du deck de base en cours (ouverture par l'URL)
    },
    setSelection(selection) {
      set({ selection });
      study.syncPreview();
      study.syncCandidates();
    },
    adjustSelectionCopy(direction, cardId, delta) {
      const s = get();
      const open = openPlan(s);
      if (!open) return;
      const pool = direction === 'incoming' ? s.side : [...s.main,...s.extra];
      const engaged = direction === 'incoming' ? open.plan.incoming : open.plan.outgoing;
      const free = freeCopies(pool,engaged,s.selection[direction]).get(cardId) ?? 0;
      const next = adjustSelection(s.selection,direction,cardId,delta,free + (s.selection[direction].find((c) => c.card_id === cardId)?.copies ?? 0));
      if (next === s.selection) return;
      set({ selection: next });
      study.syncPreview();
      study.syncCandidates();
    },
    clearSelection() {
      if (get().selection === EMPTY_SELECTION) return;
      set({ selection: EMPTY_SELECTION });
      study.syncPreview();
      study.syncCandidates();
    },
    commitSelection() {
      const s = get();
      const open = openPlan(s);
      if (!open) return false;
      const delta = s.selection;
      const r = swapInto(s.matchups,open.matchupId,open.position,{ main: s.main,extra: s.extra,side: s.side },zoneOfCatalog(s.cards),delta,(id) => s.cards[id]?.name ?? `#${id}`);
      if (!r.ok) { set({ persistenceError: r.reason }); return false; }
      set({ matchups: r.matchups,selection: EMPTY_SELECTION,swapHistory: [...s.swapHistory,delta],persistenceError: null });
      markDirty();
      studySync();
      return true;
    },
    undoLastSwap() {
      const s = get();
      const open = openPlan(s);
      const last = s.swapHistory.at(-1);
      if (!open || !last) return;
      set({ matchups: undoSwapIn(s.matchups,open.matchupId,open.position,last),swapHistory: s.swapHistory.slice(0,-1),selection: EMPTY_SELECTION });
      markDirty();
      studySync();
    },
    clearOpenPlan() {
      const s = get();
      const open = openPlan(s);
      if (!open) return;
      set({ matchups: clearPlanIn(s.matchups,open.matchupId,open.position),swapHistory: [],selection: EMPTY_SELECTION });
      markDirty();
      studySync();
    },
    setCandidateIndicator(indicator) {
      set({ candidateIndicator: indicator });
    },
    runCandidates() {
      study.runCandidates();
    },
    // Cache d'affichage seulement : ni « non enregistré », ni brouillon.
    setPlanSummary(matchupId, position, summary) {
      set({ planSummaries: { ...get().planSummaries,[`${matchupId}:${position}`]: summary } });
    },

    renameDeck(name) {
      set({ deckName: name });
      markDirty();
    },

    // ─── Conditions ET/OU (étape 5) — locales au deck (bouton Enregistrer) ───
    // Une source (carte starter ou paire) porte au plus un arbre. Le clic en mode
    // Prérequis ajoute une clause ET « il reste ≥1 copie » ou retire toutes les feuilles
    // de la carte ; l'éditeur d'arbre (inventaire, combos) passe par `setCondition`.
    toggleRequirement(source, requiredCardId) {
      const isCard = 'cardId' in source;
      const existing = get().startConditions.find((r) => (isCard ? r.sourceCardId === source.cardId : r.sourcePairId === source.pairId));
      const present = existing ? leavesOf(existing.condition).some((l) => l.leaf.card_id === requiredCardId) : false;
      const next = present ? removeLeavesOfCard(existing!.condition, requiredCardId) : addClause(existing?.condition ?? null, leaf(requiredCardId));
      get().setCondition(source, next);
    },

    setCondition(source, condition) {
      const isCard = 'cardId' in source;
      const matches = (r: StartCondition) => (isCard ? r.sourceCardId === source.cardId : r.sourcePairId === source.pairId);
      const existing = get().startConditions.find(matches);
      let startConditions: StartCondition[];
      if (condition === null) startConditions = get().startConditions.filter((r) => !matches(r));
      else if (existing) startConditions = get().startConditions.map((r) => (matches(r) ? { ...r, condition } : r));
      else startConditions = [...get().startConditions, { id: uid(), sourceCardId: isCard ? source.cardId : null, sourcePairId: isCard ? null : source.pairId, condition }];
      set({ startConditions });
      annotationCalc();
    },

    removeCondition(id) {
      set({ startConditions: get().startConditions.filter((r) => r.id !== id) });
      annotationCalc();
    },

    // Global annotations are adopted only after acknowledgement; queued in order.
    toggleHopt(cardId) {
      persist(set, async () => {
        // Bascule par rapport à la valeur EFFECTIVE : un clic sur un HOPT détecté pose un choix « faux ».
        const on = !get().hopt.has(cardId);
        adoptFlags(cardId, await api.setFlags(cardId,{ is_hopt: on }));
        libraryCalc();
      });
    },
    resetAnnotation(cardId, aspect) {
      persist(set, async () => {
        adoptFlags(cardId, await api.resetFlags(cardId, aspect));
        libraryCalc();
      });
    },
    toggleDeadFirst(cardId) {
      const deadFirst = new Set(get().deadFirst);
      if (deadFirst.has(cardId)) deadFirst.delete(cardId); else deadFirst.add(cardId);
      set({ deadFirst }); annotationCalc();
    },
    toggleDeadSecond(cardId) {
      const deadSecond = new Set(get().deadSecond);
      if (deadSecond.has(cardId)) deadSecond.delete(cardId); else deadSecond.add(cardId);
      set({ deadSecond }); annotationCalc();
    },
    togglePair(a,b) {
      if (a === b) return;
      const existing = get().pairs.find((p) => pairKey(p.card_a_id,p.card_b_id) === pairKey(a,b));
      if (existing) { get().setPairExcluded(existing.id,!get().pairExclusions.has(existing.id)); return; }
      set({ pairs: [...get().pairs,{ id: uid(),card_a_id: Math.min(a,b),card_b_id: Math.max(a,b) }] });
      annotationCalc();
    },
    removePairFromDeck(pairId) {
      set({ pairs: get().pairs.filter((p) => p.id !== pairId),
        pairExclusions: new Set([...get().pairExclusions].filter((id) => id !== pairId)),
        startConditions: get().startConditions.filter((r) => r.sourcePairId !== pairId) });
      annotationCalc();
    },
    addCategory(name) {
      persist(set, async () => {
        const created = await api.addCategory(name,uid());
        set({ categories: [...get().categories.filter((c) => c.id !== created.id),created] });
        recompute();
      });
    },
    deleteCategory(id) {
      persist(set, async () => {
        await api.deleteCategory(id);
        set({ categories: get().categories.filter((c) => c.id !== id),
          cardCategories: new Map([...get().cardCategories].map(([card,cats]) => [card,new Set([...cats].filter((cat) => cat !== id))])) });
        recompute();
      });
    },
    toggleCardCategory(cardId,categoryId) {
      persist(set, async () => {
        const cc = new Map(get().cardCategories);
        const cats = new Set(cc.get(cardId) ?? []);
        if (cats.has(categoryId)) { await api.removeCardCategory(cardId,categoryId);cats.delete(categoryId); }
        else { await api.addCardCategory(cardId,categoryId);cats.add(categoryId); }
        cc.set(cardId,cats);set({ cardCategories: cc });libraryCalc();
      });
    },
    // Mode Non-engine (partie D, lib/nonEngine.ts) : l'effet est décidé au clic sur l'état adopté
    // (acquitté), puis rejoué dans la file — étiquette d'abord, profil ensuite ; en retrait, l'étiquette
    // demandée puis le profil (choix « pas non-engine »). Chaque écriture est adoptée après son
    // acquittement ; une erreur arrête la suite et laisse l'état tel qu'acquitté (persistenceError).
    applyNonEngine(cardId, categoryId, profile) {
      persist(set, async () => {
        const has = categoryId !== null && (get().cardCategories.get(cardId)?.has(categoryId) ?? false);
        const current = get().profiles.get(cardId)?.availability ?? null;
        const effect = nonEngineEffect({ hasLabel: has,profile: current,origin: get().origin.get(cardId)?.nonengine ?? null },categoryId,profile);
        if (effect === null) return;
        const setCats = (cats: Set<string>) => { const cc = new Map(get().cardCategories); cc.set(cardId,cats); set({ cardCategories: cc }); };
        if (effect === 'retirer') {
          if (categoryId !== null && has) {
            await api.removeCardCategory(cardId,categoryId);
            setCats(new Set([...(get().cardCategories.get(cardId) ?? [])].filter((id) => id !== categoryId)));
          }
          if (profile !== null) adoptFlags(cardId, await api.setFlags(cardId,{ availability: null }));
        } else {
          if (categoryId !== null && !has) { await api.addCardCategory(cardId,categoryId); setCats(new Set([...(get().cardCategories.get(cardId) ?? []),categoryId])); }
          // `adopter` écrit la même valeur : le serveur matérialise l'héritage, la carte devient un choix.
          if (profile !== null && (current !== profile || effect === 'adopter')) adoptFlags(cardId, await api.setFlags(cardId,{ availability: profile,inherited: inheritedOf(cardId) }));
        }
        libraryCalc();
      });
    },
    /** Référence commune (référent, partie D) : écrite puis adoptée pour toutes les cartes du store. */
    saveReference(cardId, reference) {
      persist(set, async () => {
        const saved = await api.setReference(cardId, reference);
        const references = new Map(get().references); references.set(cardId, { ...saved.reference, card_id: cardId });
        set({ references }); deriveEffective(); libraryCalc();
      });
    },
    clearReference(cardId) {
      persist(set, async () => {
        await api.clearReference(cardId);
        const references = new Map(get().references); references.delete(cardId);
        set({ references }); deriveEffective(); libraryCalc();
      });
    },
    // ─── Profils de disponibilité et plafonds partagés (étape 5B, contrat §3) ───
    // Annotations du compte : adoptées après acquittement, puis recalcul (les
    // statistiques de tout deck contenant la carte deviennent périmées).
    setProfile(cardId, availability) {
      // Depuis le 16 septembre 2026 (docs/annotations-par-defaut.md, D14′) : le profil seul
      // déclenche le comptage ; une étiquette n'est plus requise (ancienne garde Q1 levée).
      persist(set, async () => {
        adoptFlags(cardId, await api.setFlags(cardId,{ availability,inherited: inheritedOf(cardId) }));
        libraryCalc();
      });
    },
    setCardGroup(cardId, groupId) {
      const current = get().profiles.get(cardId);
      // Q2 : un plafond partagé n'est proposé qu'à une carte profilée.
      if (groupId && !current) {
        set({ persistenceError: 'Choisir d’abord un profil de disponibilité avant un plafond partagé.' });
        return;
      }
      persist(set, async () => {
        adoptFlags(cardId, await api.setFlags(cardId,{ group_id: groupId,inherited: inheritedOf(cardId) }));
        libraryCalc();
      });
    },
    addGroup(name, capPerTurn) {
      persist(set, async () => {
        const created = await api.addGroup(name,capPerTurn,uid());
        set({ groups: [...get().groups.filter((g) => g.id !== created.id),created] });
        deriveEffective();
        recompute();
      });
    },
    updateGroup(id, patch) {
      persist(set, async () => {
        const updated = await api.updateGroup(id,patch);
        set({ groups: get().groups.map((g) => (g.id === id ? updated : g)) });
        deriveEffective(); // un plafond de référence se résout par son nom
        recompute();
      });
    },
    deleteGroup(id) {
      persist(set, async () => {
        await api.deleteGroup(id);
        // Les membres gardent leur profil et perdent leur plafond (FK on delete set null).
        set({ groups: get().groups.filter((g) => g.id !== id),
          chosenProfiles: new Map([...get().chosenProfiles].map(([card,p]) => [card,p.groupId === id ? { ...p,groupId: null } : p])) });
        deriveEffective();
        recompute();
      });
    },

    setExtraSideHidden(hidden) {
      set({ extraSideHidden: hidden });
    },
  };
});
