import { create } from 'zustand';
import type { Card, Category, ComboPair, DeckCard, Relevance } from '../types.js';
import { pairKey } from '../types.js';
import type { EngineInput, EngineResult } from '../engine/types.js';
import { computeInWorker } from '../worker/client.js';
import { api } from '../lib/api.js';
import type { ParsedDeck } from '../lib/ydk.js';
import { saveDraft, loadDraft, clearDraft, type DeckDraft } from '../lib/draft.js';
import type { DeckJson } from '../lib/exportDeck.js';

interface EngineModel {
  input: EngineInput;
  typeCardIds: number[]; // typeIndex → cardId (aligné sur result.deltas)
  categoryIds: string[]; // categoryIndex → categoryId
}

interface State {
  cards: Record<number, Card>;
  deckId: string | null;
  deckName: string;
  main: DeckCard[];
  extra: DeckCard[];
  side: DeckCard[];

  // ─── Bibliothèque globale : enregistrée IMMÉDIATEMENT (connaissance de jeu, §4A) ───
  hopt: Set<number>;
  deadFirst: Set<number>;
  deadSecond: Set<number>;
  pairs: ComboPair[];
  categories: Category[];
  cardCategories: Map<number, Set<string>>;

  // ─── Local au deck : relève du bouton Enregistrer (§4A) ───
  starters: Set<number>;
  pairExclusions: Set<string>;
  importance: number;
  horizonFirst: number; // §B.3.5
  horizonSecond: number;

  online: boolean;
  result: EngineResult | null;
  model: EngineModel | null;
  computeMs: number;
  computing: boolean;
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
  resumeDraft: () => void;
  discardDraft: () => Promise<void>;
  addCard: (card: Card, copies?: number) => void;
  setCopies: (cardId: number, copies: number) => void;
  undoRemove: () => void;
  dismissRemovalToast: () => void;
  removeCard: (cardId: number) => void;
  toggleStarter: (cardId: number) => void;
  toggleHopt: (cardId: number) => void;
  toggleDeadFirst: (cardId: number) => void;
  toggleDeadSecond: (cardId: number) => void;
  togglePair: (a: number, b: number) => void;
  setPairExcluded: (pairId: string, excluded: boolean) => void;
  removePairFromLibrary: (pairId: string) => void;
  addCategory: (name: string, relevance: Relevance) => void;
  deleteCategory: (id: string) => void;
  toggleCardCategory: (cardId: number, categoryId: string) => void;
  setImportance: (v: number) => void;
  setHorizon: (pass: 'first' | 'second', value: number) => void;
  setExtraSideHidden: (hidden: boolean) => void;
  renameDeck: (name: string) => void;
}

/** §B.3.5 : horizon borné à [1, 3] (défauts first=1, second=2). */
function clampHorizon(v: number): number {
  return Math.max(1, Math.min(3, Math.round(v)));
}

const toDeck = (m: Map<number, number>, zone: DeckCard['zone']): DeckCard[] =>
  [...m].map(([cardId, copies]) => ({ cardId, copies, zone }));

// ─── Construction du modèle moteur à partir du deck + annotations (§B.1) ───
// Prend l'état en PARAMÈTRE, ne lit aucun global : prêt pour la comparaison de decks (§4D).
function buildModel(s: State): EngineModel {
  const mainCopies = new Map(s.main.map((c) => [c.cardId, c.copies]));
  const deckSize = s.main.reduce((sum, c) => sum + c.copies, 0);

  const activePairs = s.pairs.filter(
    (p) =>
      !s.pairExclusions.has(p.id) &&
      mainCopies.has(p.card_a_id) &&
      mainCopies.has(p.card_b_id),
  );

  const annotated = new Set<number>();
  for (const id of s.starters) if (mainCopies.has(id)) annotated.add(id);
  for (const p of activePairs) {
    annotated.add(p.card_a_id);
    annotated.add(p.card_b_id);
  }
  for (const [cardId, cats] of s.cardCategories) {
    if (cats.size > 0 && mainCopies.has(cardId)) annotated.add(cardId);
  }

  const typeCardIds = s.main.map((c) => c.cardId).filter((id) => annotated.has(id));
  const typeIndex = new Map(typeCardIds.map((id, i) => [id, i]));
  const categoryIds = s.categories.map((c) => c.id);
  const catIndex = new Map(categoryIds.map((id, i) => [id, i]));

  const types = typeCardIds.map((id) => {
    const cats = [...(s.cardCategories.get(id) ?? [])]
      .map((cid) => catIndex.get(cid))
      .filter((i): i is number => i !== undefined);
    return {
      copies: mainCopies.get(id) ?? 0,
      isHopt: s.hopt.has(id),
      isStarter: s.starters.has(id),
      categories: cats,
      deadFirst: s.deadFirst.has(id),
      deadSecond: s.deadSecond.has(id),
    };
  });

  const edges = activePairs
    .map((p): [number, number] => [typeIndex.get(p.card_a_id)!, typeIndex.get(p.card_b_id)!])
    .filter(([a, b]) => a !== undefined && b !== undefined);

  const categories = s.categories.map((c) => ({ id: c.id, relevance: c.relevance }));

  return {
    input: {
      deckSize,
      types,
      edges,
      categories,
      horizonFirst: s.horizonFirst,
      horizonSecond: s.horizonSecond,
    },
    typeCardIds,
    categoryIds,
  };
}

// Toute modification (locale ou globale) invalide entièrement l'état calculé puis
// déclenche un recalcul intégral dans le worker (§4C.2) — jamais de MàJ partielle.
let computeTimer: ReturnType<typeof setTimeout> | null = null;
let computeSeq = 0;
function scheduleCompute(get: () => State, set: (p: Partial<State>) => void): void {
  if (computeTimer) clearTimeout(computeTimer);
  set({ computing: true });
  computeTimer = setTimeout(async () => {
    const model = buildModel(get());
    const mySeq = ++computeSeq;
    const { result, ms } = await computeInWorker(model.input);
    if (mySeq !== computeSeq) return; // périmé
    set({ result, model, computeMs: ms, computing: false });
  }, 50);
}

// Brouillon local (§4B) : écriture debouncée dans IndexedDB à chaque modif locale.
let draftTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDraft(get: () => State): void {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const s = get();
    if (!s.deckId) return;
    void saveDraft({
      deckId: s.deckId,
      updatedAt: Date.now(),
      name: s.deckName,
      main: s.main,
      extra: s.extra,
      side: s.side,
      starters: [...s.starters],
      pairExclusions: [...s.pairExclusions],
      horizonFirst: s.horizonFirst,
      horizonSecond: s.horizonSecond,
      importance: s.importance,
    });
  }, 500);
}

// Persistance best-effort de la bibliothèque globale : n'interrompt jamais l'UI (§5).
function persist(set: (p: Partial<State>) => void, fn: () => Promise<unknown>): void {
  fn().catch(() => set({ online: false }));
}

/** Signature des données LOCALES au deck — pour comparer brouillon vs version enregistrée. */
function localSig(o: {
  name: string;
  main: DeckCard[];
  extra: DeckCard[];
  side: DeckCard[];
  starters: number[];
  pairExclusions: string[];
  horizonFirst: number;
  horizonSecond: number;
  importance: number;
}): string {
  const norm = (arr: DeckCard[]) =>
    arr.map((c) => `${c.cardId}:${c.zone}:${c.copies}`).sort().join(',');
  return JSON.stringify({
    n: o.name,
    m: norm(o.main),
    e: norm(o.extra),
    s: norm(o.side),
    st: [...o.starters].sort((a, b) => a - b),
    px: [...o.pairExclusions].sort(),
    h1: o.horizonFirst,
    h2: o.horizonSecond,
    im: o.importance,
  });
}

export const useDeck = create<State>((set, get) => {
  const recompute = () => scheduleCompute(get, set);
  const markDirty = () => {
    set({ dirty: true });
    scheduleDraft(get);
  };
  // Mutation LOCALE affectant le calcul : recalcul + marquage sale + brouillon.
  const localCalc = () => {
    recompute();
    markDirty();
  };

  return {
    cards: {},
    deckId: null,
    deckName: 'Sans titre',
    main: [],
    extra: [],
    side: [],
    hopt: new Set(),
    deadFirst: new Set(),
    deadSecond: new Set(),
    pairs: [],
    categories: [],
    cardCategories: new Map(),
    starters: new Set(),
    pairExclusions: new Set(),
    importance: 0.5,
    horizonFirst: 1,
    horizonSecond: 2,
    online: true,
    result: null,
    model: null,
    computeMs: 0,
    computing: false,
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
          hopt: new Set(lib.hoptCardIds),
          deadFirst: new Set(lib.deadFirstCardIds),
          deadSecond: new Set(lib.deadSecondCardIds),
          pairs: lib.pairs,
          categories: lib.categories,
          cardCategories: groupCardCategories(lib.cardCategories),
          online: true,
        });
      } catch {
        set({ online: false });
      }
    },

    // Crée un deck en base (import YDK / collage / vide) et renvoie son id. Ne charge
    // pas l'état d'édition : l'éditeur appelle loadDeck(id) après navigation.
    async createDeckFromParsed(name, parsed, cards) {
      const cardMap: Record<number, Card> = { ...get().cards };
      for (const c of cards) cardMap[c.id] = c;
      set({ cards: cardMap });
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
      } catch {
        set({ online: false });
        return null;
      }
    },

    // Import JSON (§4C) : fusionne les annotations globales SANS écraser les paires
    // existantes (addPair est idempotent), crée le deck, puis rafraîchit la bibliothèque.
    async importDeckJson(json) {
      try {
        const nameToCatId = new Map<string, string>();
        for (const c of get().categories) nameToCatId.set(c.name, c.id);
        for (const cat of json.categories ?? []) {
          if (!nameToCatId.has(cat.name)) {
            const created = await api.addCategory(cat.name, cat.relevance);
            nameToCatId.set(created.name, created.id);
          }
        }
        const pairIdByKey = new Map<string, string>();
        for (const p of get().pairs) pairIdByKey.set(pairKey(p.card_a_id, p.card_b_id), p.id);
        for (const p of json.pairs ?? []) {
          const created = await api.addPair(p.a, p.b, p.note ?? undefined);
          pairIdByKey.set(pairKey(created.card_a_id, created.card_b_id), created.id);
        }
        for (const id of json.hopt ?? []) await api.setFlags(id, { is_hopt: true });
        for (const id of json.deadFirst ?? []) await api.setFlags(id, { dead_first: true });
        for (const id of json.deadSecond ?? []) await api.setFlags(id, { dead_second: true });
        for (const [cardId, catName] of json.cardCategories ?? []) {
          const cid = nameToCatId.get(catName);
          if (cid) await api.addCardCategory(cardId, cid);
        }

        const { id } = await api.createDeck(
          json.name || 'Deck importé',
          (json.cards ?? []).map((c) => ({ card_id: c.cardId, zone: c.zone, copies: c.copies })),
        );
        await api.setStarters(id, json.starters ?? []);
        const exclIds = (json.excludedPairs ?? [])
          .map(([a, b]) => pairIdByKey.get(pairKey(a, b)))
          .filter((x): x is string => !!x);
        await api.setPairExclusions(id, exclIds);
        if (json.params) await api.updateDeck(id, { params: json.params });
        await get().bootstrap(); // recharge la bibliothèque enrichie
        return id;
      } catch {
        set({ online: false });
        return null;
      }
    },

    // Charge un deck depuis la base dans l'éditeur, puis propose un brouillon si présent.
    async loadDeck(id) {
      let detail: Awaited<ReturnType<typeof api.getDeck>>;
      try {
        detail = await api.getDeck(id);
      } catch {
        set({ online: false });
        return;
      }
      const ids = detail.cards.map((c) => c.card_id);
      const cardMap: Record<number, Card> = { ...get().cards };
      try {
        for (const c of await api.cardsByIds(ids)) cardMap[c.id] = c;
      } catch {
        /* images dérivables du CDN */
      }
      const params = (detail.params ?? {}) as Record<string, unknown>;
      const asCards = (zone: DeckCard['zone']): DeckCard[] =>
        detail.cards.filter((c) => c.zone === zone).map((c) => ({ cardId: c.card_id, zone, copies: c.copies }));

      set({
        cards: cardMap,
        deckId: id,
        deckName: detail.name,
        main: asCards('main'),
        extra: asCards('extra'),
        side: asCards('side'),
        starters: new Set(detail.starters),
        pairExclusions: new Set(detail.pair_exclusions),
        horizonFirst: clampHorizon(Number(params.horizonFirst ?? 1)),
        horizonSecond: clampHorizon(Number(params.horizonSecond ?? 2)),
        importance: typeof params.importance === 'number' ? params.importance : 0.5,
        dirty: false,
        lastSavedAt: detail.updated_at ? Date.parse(detail.updated_at) : Date.now(),
        draftAvailable: null,
        removalToast: null,
      });
      recompute();

      // Brouillon plus récent que la version enregistrée ? (§4B, comparaison par contenu)
      const draft = await loadDraft(id);
      if (draft) {
        const s = get();
        const savedSig = localSig({
          name: s.deckName,
          main: s.main,
          extra: s.extra,
          side: s.side,
          starters: [...s.starters],
          pairExclusions: [...s.pairExclusions],
          horizonFirst: s.horizonFirst,
          horizonSecond: s.horizonSecond,
          importance: s.importance,
        });
        if (localSig(draft) !== savedSig) set({ draftAvailable: draft });
        else void clearDraft(id); // brouillon identique = obsolète
      }
    },

    async saveDeck() {
      const s = get();
      if (!s.deckId) return;
      const summary = s.result
        ? {
            startRateFirst: 1 - s.result.first.brick,
            brickRate: s.result.first.brick,
            mainSize: s.main.reduce((a, c) => a + c.copies, 0),
          }
        : undefined;
      try {
        await Promise.all([
          api.updateDeck(s.deckId, {
            name: s.deckName,
            cards: [...s.main, ...s.extra, ...s.side].map((m) => ({
              card_id: m.cardId,
              zone: m.zone,
              copies: m.copies,
            })),
            params: { horizonFirst: s.horizonFirst, horizonSecond: s.horizonSecond, importance: s.importance },
            summary,
          }),
          api.setStarters(s.deckId, [...s.starters]),
          api.setPairExclusions(s.deckId, [...s.pairExclusions]),
        ]);
        set({ dirty: false, lastSavedAt: Date.now(), online: true });
        await clearDraft(s.deckId);
      } catch {
        set({ online: false }); // dirty reste vrai : l'utilisateur voit que ce n'est pas enregistré
      }
    },

    resumeDraft() {
      const d = get().draftAvailable;
      if (!d) return;
      set({
        deckName: d.name,
        main: d.main,
        extra: d.extra,
        side: d.side,
        starters: new Set(d.starters),
        pairExclusions: new Set(d.pairExclusions),
        horizonFirst: clampHorizon(d.horizonFirst),
        horizonSecond: clampHorizon(d.horizonSecond),
        importance: d.importance,
        draftAvailable: null,
        dirty: true,
      });
      recompute();
    },

    async discardDraft() {
      const d = get().draftAvailable;
      set({ draftAvailable: null });
      if (d) await clearDraft(d.deckId);
    },

    // ─── Mutations LOCALES au deck (marquent « non enregistré ») ───
    addCard(card, copies = 1) {
      const cards = { ...get().cards, [card.id]: card };
      const existing = get().main.find((m) => m.cardId === card.id);
      const main = existing
        ? get().main.map((m) =>
            m.cardId === card.id ? { ...m, copies: Math.min(3, m.copies + 1) } : m,
          )
        : [
            ...get().main,
            { cardId: card.id, copies: Math.max(1, Math.min(3, copies)), zone: 'main' as const },
          ];
      set({ cards, main });
      localCalc();
    },

    setCopies(cardId, copies) {
      if (copies <= 0) {
        get().removeCard(cardId); // 0 copie = retrait (§D)
        return;
      }
      const c = Math.min(3, copies);
      set({ main: get().main.map((m) => (m.cardId === cardId ? { ...m, copies: c } : m)) });
      localCalc();
    },

    // Retrait : uniquement deck_cards. Annotations CONSERVÉES, inertes, restaurées au
    // ré-ajout (§4C1). Toast d'annulation.
    removeCard(cardId) {
      const index = get().main.findIndex((m) => m.cardId === cardId);
      if (index < 0) return;
      const card = get().main[index];
      set({
        main: get().main.filter((m) => m.cardId !== cardId),
        removalToast: { card, index, ts: Date.now() },
      });
      localCalc();
    },

    undoRemove() {
      const t = get().removalToast;
      if (!t) return;
      const main = [...get().main];
      main.splice(Math.min(t.index, main.length), 0, t.card);
      set({ main, removalToast: null });
      localCalc();
    },

    dismissRemovalToast() {
      set({ removalToast: null });
    },

    toggleStarter(cardId) {
      const starters = new Set(get().starters);
      if (starters.has(cardId)) starters.delete(cardId);
      else starters.add(cardId);
      set({ starters });
      localCalc();
    },

    setPairExcluded(pairId, excluded) {
      const pairExclusions = new Set(get().pairExclusions);
      if (excluded) pairExclusions.add(pairId);
      else pairExclusions.delete(pairId);
      set({ pairExclusions });
      localCalc();
    },

    setImportance(v) {
      set({ importance: v });
      markDirty(); // n'affecte pas le calcul, seulement les notes → pas de recompute
    },

    setHorizon(pass, value) {
      const v = clampHorizon(value);
      set(pass === 'first' ? { horizonFirst: v } : { horizonSecond: v });
      localCalc();
    },

    renameDeck(name) {
      set({ deckName: name });
      markDirty();
    },

    // ─── Mutations GLOBALES (bibliothèque) : enregistrées immédiatement, jamais « sale » ───
    toggleHopt(cardId) {
      const hopt = new Set(get().hopt);
      const on = !hopt.has(cardId);
      if (on) hopt.add(cardId);
      else hopt.delete(cardId);
      set({ hopt });
      recompute();
      persist(set, () => api.setFlags(cardId, { is_hopt: on }));
    },

    toggleDeadFirst(cardId) {
      const deadFirst = new Set(get().deadFirst);
      const on = !deadFirst.has(cardId);
      if (on) deadFirst.add(cardId);
      else deadFirst.delete(cardId);
      set({ deadFirst });
      recompute();
      persist(set, () => api.setFlags(cardId, { dead_first: on }));
    },

    toggleDeadSecond(cardId) {
      const deadSecond = new Set(get().deadSecond);
      const on = !deadSecond.has(cardId);
      if (on) deadSecond.add(cardId);
      else deadSecond.delete(cardId);
      set({ deadSecond });
      recompute();
      persist(set, () => api.setFlags(cardId, { dead_second: on }));
    },

    togglePair(a, b) {
      if (a === b) return; // auto-combo hors périmètre (§D)
      const key = pairKey(a, b);
      const [ca, cb] = a <= b ? [a, b] : [b, a];
      const existing = get().pairs.find((p) => pairKey(p.card_a_id, p.card_b_id) === key);
      if (existing) {
        // Retirer un combo depuis l'annotation = exclusion LOCALE au deck (§5).
        get().setPairExcluded(existing.id, !get().pairExclusions.has(existing.id));
        return;
      }
      // Nouvelle paire = connaissance GLOBALE, enregistrée immédiatement.
      const tempId = `tmp-${key}`;
      set({ pairs: [...get().pairs, { id: tempId, card_a_id: ca, card_b_id: cb }] });
      recompute();
      persist(set, async () => {
        const created = await api.addPair(ca, cb);
        set({ pairs: get().pairs.map((p) => (p.id === tempId ? { ...p, id: created.id } : p)) });
      });
    },

    removePairFromLibrary(pairId) {
      set({
        pairs: get().pairs.filter((p) => p.id !== pairId),
        pairExclusions: new Set([...get().pairExclusions].filter((id) => id !== pairId)),
      });
      recompute();
      persist(set, () => api.deletePair(pairId));
    },

    addCategory(name, relevance) {
      const tempId = `tmp-cat-${name}`;
      set({
        categories: [...get().categories, { id: tempId, name, relevance, is_builtin: false }],
      });
      recompute();
      persist(set, async () => {
        const created = await api.addCategory(name, relevance);
        set({ categories: get().categories.map((c) => (c.id === tempId ? created : c)) });
      });
    },

    deleteCategory(id) {
      set({
        categories: get().categories.filter((c) => c.id !== id),
        cardCategories: new Map(
          [...get().cardCategories].map(([cid, cats]) => {
            const next = new Set(cats);
            next.delete(id);
            return [cid, next] as [number, Set<string>];
          }),
        ),
      });
      recompute();
      persist(set, () => api.deleteCategory(id));
    },

    toggleCardCategory(cardId, categoryId) {
      const cc = new Map(get().cardCategories);
      const cats = new Set(cc.get(cardId) ?? []);
      const on = !cats.has(categoryId);
      if (on) cats.add(categoryId);
      else cats.delete(categoryId);
      cc.set(cardId, cats);
      set({ cardCategories: cc });
      recompute();
      persist(set, () =>
        on ? api.addCardCategory(cardId, categoryId) : api.removeCardCategory(cardId, categoryId),
      );
    },

    setExtraSideHidden(hidden) {
      set({ extraSideHidden: hidden });
    },
  };
});

function groupCardCategories(
  rows: Array<{ card_id: number; category_id: string }>,
): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();
  for (const { card_id, category_id } of rows) {
    (map.get(card_id) ?? map.set(card_id, new Set()).get(card_id)!).add(category_id);
  }
  return map;
}
