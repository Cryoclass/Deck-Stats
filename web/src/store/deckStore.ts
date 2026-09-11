import { create } from 'zustand';
import type { Availability, Card, CardProfile, Category, ComboPair, ConditionNode, DeckCard, Matchup, NonEngineGroup, SidePlanCard, SidePlanPosition, StartCondition, Zone } from '../types.js';
import { addMatchup as addMatchupTo, copyPlan as copyPlanIn, removeFromPlan as removeFromPlanIn, removeMatchup as removeMatchupFrom, renameMatchup as renameMatchupIn, setPlanNote as setPlanNoteIn, swapInPlan as swapInto, type PlanDirection } from '../lib/matchups.js';
import { pairKey } from '../types.js';
import type { AnalysisContext, EngineResult } from '../engine/types.js';
import type { QueryCriterion, SavedQuery } from '../engine/query.js';
import { createEngineClient } from '../worker/client.js';
import { ComputeCancelled, type ComputeClient, type ComputeTask } from '../worker/computeClient.js';
import { ApiError, api } from '../lib/api.js';
import { MAX_COPIES, type ParsedDeck } from '../lib/ydk.js';
import { saveDraft, loadDraft, clearDraft, type DeckDraft } from '../lib/draft.js';
import type { DeckJson } from '../lib/exportDeck.js';
import { buildEngineModel, type EngineModel } from '../lib/engineModel.js';
import { configurationFromState, configurationFromDetail, stateFromConfiguration, libraryState } from '../lib/deckConfiguration.js';
import { addClause, leaf, leavesOf, removeLeavesOfCard } from '../lib/conditions.js';
import { summaryOfState } from '../lib/summary.js';
import { nonEngineEffect } from '../lib/nonEngine.js';
import { ZONE_LABEL } from '../lib/zones.js';

interface State {
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
  hopt: Set<number>;
  profiles: Map<number, CardProfile>;
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
  /** Mode Non-engine combiné (9B) : rend la carte conforme au couple étiquette + profil (`null`
   *  = profil inchangé) ; si elle le porte déjà exactement, retire l'étiquette puis, s'il ne
   *  reste aucune étiquette, le profil. Deux requêtes au plus, dans l'ordre, dans la file globale. */
  applyNonEngine: (cardId: number, categoryId: string, profile: Availability | null) => void;
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
}

/** Contexte d'un résultat : ce qu'il faut pour l'afficher avec ses propres libellés. */
export interface ResultContext {
  deckId: string | null;
  deckSize: number;
  categories: Category[];
  /** Cartes étiquetées sans profil au moment du calcul : non comptées (Q5), signalées. */
  unprofiledCardIds: number[];
}

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
const engineClient = (): ComputeClient => (computeClient ??= createEngineClient());

function scheduleCompute(get: () => State, set: (p: Partial<State>) => void): void {
  if (computeTimer) clearTimeout(computeTimer);
  if (inflight) {
    inflight.cancel();
    inflight = null;
  }
  const version = get().modelVersion + 1;
  set({ modelVersion: version, stale: get().result !== null, computing: true, computeError: null });
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

export const useDeck = create<State>((set, get) => {
  const recompute = () => scheduleCompute(get, set);
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
    else markDirty();
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
  const annotationCalc = () => {
    if (modelUnchanged()) markDirty();
    else localCalc();
  };
  // Annotations du compte (HOPT, étiquette, profil, plafond d'une carte) : même règle, sans
  // « non enregistré » (elles sont déjà persistées par l'API).
  const libraryCalc = () => {
    if (!modelUnchanged()) recompute();
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
    context: 'first',
    statsView: 'starts',
    savedQueries: [],
    queryCriteria: defaultQuery(),
    handFilterByQuery: false,
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
        const ids = new Set([...configuration.cards.map((c) => c.card_id),...configuration.pairs.flatMap((p) => [p.card_a_id,p.card_b_id]),...configuration.conditions.flatMap((r) => leavesOf(r.condition).map((l) => l.leaf.card_id))]);
        try { for (const c of await api.cardsByIds([...ids])) cardMap[c.id] = c; } catch { /* Catalogue lookup is optional. */ }
        if (!current()) return;
        // Aucune ancienne statistique ne survit à l'ouverture d'un deck : état initial de
        // calcul, jamais un mélange avec le résultat du deck précédent (§6).
        set({ ...stateFromConfiguration(configuration),cards: cardMap,deckId: id,revision: detail.revision,
          planSummaries: Object.fromEntries((detail.plan_summaries ?? []).map((r) => [`${r.matchup_id}:${r.position}`,r.summary])),
          dirty: false,editRevision: 0,lastSavedAt: Date.parse(detail.updated_at ?? ''),draftAvailable: null,
          persistenceError: null,removalToast: null,queryCriteria: defaultQuery(),handFilterByQuery: false,
          result: null,model: null,resultContext: null,stale: false,computeError: null });
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
      set({ ...stateFromConfiguration(d.configuration),draftAvailable: null,dirty: true,editRevision: get().editRevision+1 });
      // Keep the loaded server revision; an old draft is an explicit user restoration.
      recompute();
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
      set({ context }); // affichage seul : les deux passes sont déjà calculées
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
      set({ matchups: removeMatchupFrom(get().matchups,id) });
      markDirty();
    },
    swapInPlan(matchupId, position, outgoing, incoming) {
      const s = get();
      const r = swapInto(s.matchups,matchupId,position,s.main,s.side,outgoing,incoming,(id) => s.cards[id]?.name ?? `#${id}`);
      if (!r.ok) { set({ persistenceError: r.reason }); return false; }
      set({ matchups: r.matchups,persistenceError: null });
      markDirty();
      return true;
    },
    removeFromPlan(matchupId, position, direction, cardId) {
      set({ matchups: removeFromPlanIn(get().matchups,matchupId,position,direction,cardId) });
      markDirty();
    },
    setPlanNote(matchupId, position, note) {
      set({ matchups: setPlanNoteIn(get().matchups,matchupId,position,note) });
      markDirty();
    },
    copyPlan(matchupId, from, to) {
      set({ matchups: copyPlanIn(get().matchups,matchupId,from,to) });
      markDirty();
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
        const hopt = new Set(get().hopt);
        const on = !hopt.has(cardId);
        await api.setFlags(cardId,{ is_hopt: on });
        if (on) hopt.add(cardId); else hopt.delete(cardId);
        set({ hopt }); libraryCalc();
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
    // Étape 9B — mode Non-engine combiné. L'effet est décidé au clic sur l'état adopté (acquitté),
    // puis rejoué dans la file : l'étiquette d'abord (le serveur exige une étiquette avant un
    // profil, Q1 de 5B), le profil ensuite ; en retrait, l'étiquette puis le profil devenu orphelin.
    // Chaque écriture est adoptée après son acquittement ; une erreur arrête la paire et laisse
    // l'état tel qu'acquitté (persistenceError).
    applyNonEngine(cardId, categoryId, profile) {
      persist(set, async () => {
        const has = get().cardCategories.get(cardId)?.has(categoryId) ?? false;
        const current = get().profiles.get(cardId)?.availability ?? null;
        const conforming = nonEngineEffect(has,current,profile) === 'retirer';
        const adoptFlags = (saved: { availability: Availability | null; group_id: string | null }) => {
          const profiles = new Map(get().profiles);
          if (saved.availability) profiles.set(cardId,{ availability: saved.availability,groupId: saved.group_id });
          else profiles.delete(cardId);
          set({ profiles });
        };
        const setCats = (cats: Set<string>) => { const cc = new Map(get().cardCategories); cc.set(cardId,cats); set({ cardCategories: cc }); };
        if (!conforming) {
          if (!has) { await api.addCardCategory(cardId,categoryId); setCats(new Set([...(get().cardCategories.get(cardId) ?? []),categoryId])); }
          if (profile !== null && current !== profile) adoptFlags(await api.setFlags(cardId,{ availability: profile }));
        } else {
          await api.removeCardCategory(cardId,categoryId);
          const remaining = new Set([...(get().cardCategories.get(cardId) ?? [])].filter((id) => id !== categoryId));
          setCats(remaining);
          if (remaining.size === 0 && get().profiles.has(cardId)) adoptFlags(await api.setFlags(cardId,{ availability: null }));
        }
        libraryCalc();
      });
    },
    // ─── Profils de disponibilité et plafonds partagés (étape 5B, contrat §3) ───
    // Annotations du compte : adoptées après acquittement, puis recalcul (les
    // statistiques de tout deck contenant la carte deviennent périmées).
    setProfile(cardId, availability) {
      // Q1 : un profil sans étiquette ne mesure rien — refusé ici, comme sur le serveur.
      if (availability && (get().cardCategories.get(cardId)?.size ?? 0) === 0) {
        set({ persistenceError: 'Choisir d’abord une catégorie non-engine pour cette carte avant son profil.' });
        return;
      }
      persist(set, async () => {
        const saved = await api.setFlags(cardId,{ availability });
        const profiles = new Map(get().profiles);
        if (saved.availability) profiles.set(cardId,{ availability: saved.availability,groupId: saved.group_id });
        else profiles.delete(cardId);
        set({ profiles }); libraryCalc();
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
        const saved = await api.setFlags(cardId,{ group_id: groupId });
        const profiles = new Map(get().profiles);
        if (saved.availability) profiles.set(cardId,{ availability: saved.availability,groupId: saved.group_id });
        else profiles.delete(cardId);
        set({ profiles }); libraryCalc();
      });
    },
    addGroup(name, capPerTurn) {
      persist(set, async () => {
        const created = await api.addGroup(name,capPerTurn,uid());
        set({ groups: [...get().groups.filter((g) => g.id !== created.id),created] });
        recompute();
      });
    },
    updateGroup(id, patch) {
      persist(set, async () => {
        const updated = await api.updateGroup(id,patch);
        set({ groups: get().groups.map((g) => (g.id === id ? updated : g)) });
        recompute();
      });
    },
    deleteGroup(id) {
      persist(set, async () => {
        await api.deleteGroup(id);
        // Les membres gardent leur profil et perdent leur plafond (FK on delete set null).
        set({ groups: get().groups.filter((g) => g.id !== id),
          profiles: new Map([...get().profiles].map(([card,p]) => [card,p.groupId === id ? { ...p,groupId: null } : p])) });
        recompute();
      });
    },

    setExtraSideHidden(hidden) {
      set({ extraSideHidden: hidden });
    },
  };
});
