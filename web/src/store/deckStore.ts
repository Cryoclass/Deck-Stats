import { create } from 'zustand';
import type { Card, Category, ComboPair, DeckCard, Relevance } from '../types.js';
import { pairKey } from '../types.js';
import type { EngineInput, EngineResult } from '../engine/types.js';
import { computeInWorker } from '../worker/client.js';
import { api } from '../lib/api.js';
import type { ParsedDeck } from '../lib/ydk.js';
import { writeStateToHash, type SharedState } from '../lib/share.js';

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

  hopt: Set<number>;
  deadFirst: Set<number>; // Lot C
  deadSecond: Set<number>; // Lot C
  pairs: ComboPair[];
  categories: Category[];
  cardCategories: Map<number, Set<string>>;

  starters: Set<number>;
  pairExclusions: Set<string>;

  online: boolean;
  importance: number;
  // §B.3.5 (itération 2) — horizon de tours d'interaction, réglable par passe (1..3).
  horizonFirst: number;
  horizonSecond: number;

  result: EngineResult | null;
  model: EngineModel | null;
  computeMs: number;
  computing: boolean;

  // Toast d'annulation d'un retrait (itération 3, B). Transitoire, hors snapshot.
  removalToast: { card: DeckCard; index: number; ts: number } | null;

  // actions
  bootstrap: () => Promise<void>;
  importDeck: (name: string, parsed: ParsedDeck, cards: Card[]) => Promise<void>;
  loadShared: (s: SharedState, cards: Card[]) => void;
  addCard: (card: Card, copies?: number) => void;
  setCopies: (cardId: number, copies: number) => void;
  undoRemove: () => void;
  dismissRemovalToast: () => void;
  toggleStarter: (cardId: number) => void;
  toggleHopt: (cardId: number) => void;
  toggleDeadFirst: (cardId: number) => void;
  toggleDeadSecond: (cardId: number) => void;
  removeCard: (cardId: number) => void;
  togglePair: (a: number, b: number) => void;
  setPairExcluded: (pairId: string, excluded: boolean) => void;
  removePairFromLibrary: (pairId: string) => void;
  addCategory: (name: string, relevance: Relevance) => void;
  deleteCategory: (id: string) => void;
  toggleCardCategory: (cardId: number, categoryId: string) => void;
  setImportance: (v: number) => void;
  setHorizon: (pass: 'first' | 'second', value: number) => void;
  setExtraSideHidden: (hidden: boolean) => void;
  extraSideHidden: boolean;
  renameDeck: (name: string) => void;
}

/** §B.3.5 : horizon borné à [1, 3] (défauts first=1, second=2). */
function clampHorizon(v: number): number {
  return Math.max(1, Math.min(3, Math.round(v)));
}

// ─── Construction du modèle moteur à partir du deck + annotations (§B.1) ───
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

  // Ordre stable : ordre du main deck.
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
    .map((p): [number, number] => [
      typeIndex.get(p.card_a_id)!,
      typeIndex.get(p.card_b_id)!,
    ])
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

// Debounce du recalcul temps réel (§3.2) — dernier appel gagne.
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

// Persistance best-effort : n'interrompt jamais l'UI (§5). Échec → mode hors-ligne.
function persist(set: (p: Partial<State>) => void, fn: () => Promise<unknown>): void {
  fn().catch(() => set({ online: false }));
}

function snapshot(s: State): SharedState {
  return {
    v: 1,
    name: s.deckName,
    cards: [...s.main, ...s.extra, ...s.side],
    starters: [...s.starters],
    pairExclusions: [...s.pairExclusions],
    pairs: s.pairs,
    hopt: [...s.hopt],
    deadFirst: [...s.deadFirst],
    deadSecond: [...s.deadSecond],
    categories: s.categories,
    cardCategories: [...s.cardCategories].flatMap(([cid, set2]) =>
      [...set2].map((catId): [number, string] => [cid, catId]),
    ),
    horizonFirst: s.horizonFirst,
    horizonSecond: s.horizonSecond,
  };
}

export const useDeck = create<State>((set, get) => {
  // Après chaque mutation du modèle : recalcul + mise à jour du hash de partage.
  const touch = () => {
    scheduleCompute(get, set);
    writeStateToHash(snapshot(get()));
  };

  // Toute modification de deck_cards (ajout / retrait / copies) est persistée en
  // remplaçant l'ensemble des cartes du deck côté backend (§5).
  const syncDeckCards = () => {
    const { deckId } = get();
    if (!deckId) return;
    persist(set, () =>
      api.updateDeck(deckId, {
        cards: get()
          .main.concat(get().extra, get().side)
          .map((m) => ({ card_id: m.cardId, zone: m.zone, copies: m.copies })),
      }),
    );
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
    online: true,
    importance: 0.5,
    horizonFirst: 1,
    horizonSecond: 2,
    result: null,
    model: null,
    computeMs: 0,
    computing: false,
    removalToast: null,
    extraSideHidden: false,

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

    async importDeck(name, parsed, cards) {
      const cardMap: Record<number, Card> = { ...get().cards };
      for (const c of cards) cardMap[c.id] = c;
      const toDeck = (m: Map<number, number>, zone: DeckCard['zone']): DeckCard[] =>
        [...m].map(([cardId, copies]) => ({ cardId, copies, zone }));

      const main = toDeck(parsed.main, 'main');
      set({
        cards: cardMap,
        deckName: name,
        main,
        extra: toDeck(parsed.extra, 'extra'),
        side: toDeck(parsed.side, 'side'),
        starters: new Set(),
        pairExclusions: new Set(),
      });
      touch();

      // Persistance : création du deck côté backend (§5).
      persist(set, async () => {
        const all = [...main, ...toDeck(parsed.extra, 'extra'), ...toDeck(parsed.side, 'side')];
        const { id } = await api.createDeck(
          name,
          all.map((c) => ({ card_id: c.cardId, zone: c.zone, copies: c.copies })),
        );
        set({ deckId: id });
      });
    },

    loadShared(s, cards) {
      const cardMap: Record<number, Card> = { ...get().cards };
      for (const c of cards) cardMap[c.id] = c;
      const cc = new Map<number, Set<string>>();
      for (const [cid, catId] of s.cardCategories) {
        (cc.get(cid) ?? cc.set(cid, new Set()).get(cid)!).add(catId);
      }
      set({
        cards: cardMap,
        deckName: s.name,
        main: s.cards.filter((c) => c.zone === 'main'),
        extra: s.cards.filter((c) => c.zone === 'extra'),
        side: s.cards.filter((c) => c.zone === 'side'),
        pairs: s.pairs,
        categories: s.categories,
        hopt: new Set(s.hopt),
        deadFirst: new Set(s.deadFirst ?? []),
        deadSecond: new Set(s.deadSecond ?? []),
        cardCategories: cc,
        starters: new Set(s.starters),
        pairExclusions: new Set(s.pairExclusions),
        horizonFirst: clampHorizon(s.horizonFirst ?? 1),
        horizonSecond: clampHorizon(s.horizonSecond ?? 2),
      });
      scheduleCompute(get, set);
    },

    // Ajout d'une carte (itération 3, A). Déjà présente → incrément (plafond 3) ;
    // sinon append au main deck. Ne touche à aucune annotation (elles peuvent déjà
    // exister en bibliothèque et se réactivent d'elles-mêmes, cf. C1).
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
      touch();
      syncDeckCards();
    },

    // §D : 0 copie = retrait du deck (le stepper descend jusqu'à 0, itération 3, B).
    setCopies(cardId, copies) {
      if (copies <= 0) {
        get().removeCard(cardId);
        return;
      }
      const c = Math.min(3, copies);
      set({ main: get().main.map((m) => (m.cardId === cardId ? { ...m, copies: c } : m)) });
      touch();
      syncDeckCards();
    },

    undoRemove() {
      const t = get().removalToast;
      if (!t) return;
      const main = [...get().main];
      main.splice(Math.min(t.index, main.length), 0, t.card); // ré-insère à sa position
      set({ main, removalToast: null });
      touch();
      syncDeckCards();
    },

    dismissRemovalToast() {
      set({ removalToast: null });
    },

    toggleStarter(cardId) {
      const starters = new Set(get().starters);
      if (starters.has(cardId)) starters.delete(cardId);
      else starters.add(cardId);
      set({ starters });
      touch();
      const { deckId } = get();
      if (deckId) persist(set, () => api.setStarters(deckId, [...starters]));
    },

    toggleHopt(cardId) {
      const hopt = new Set(get().hopt);
      const on = !hopt.has(cardId);
      if (on) hopt.add(cardId);
      else hopt.delete(cardId);
      set({ hopt });
      touch();
      persist(set, () => api.setFlags(cardId, { is_hopt: on }));
    },

    toggleDeadFirst(cardId) {
      const deadFirst = new Set(get().deadFirst);
      const on = !deadFirst.has(cardId);
      if (on) deadFirst.add(cardId);
      else deadFirst.delete(cardId);
      set({ deadFirst });
      touch();
      persist(set, () => api.setFlags(cardId, { dead_first: on }));
    },

    toggleDeadSecond(cardId) {
      const deadSecond = new Set(get().deadSecond);
      const on = !deadSecond.has(cardId);
      if (on) deadSecond.add(cardId);
      else deadSecond.delete(cardId);
      set({ deadSecond });
      touch();
      persist(set, () => api.setFlags(cardId, { dead_second: on }));
    },

    // Retrait du deck (itération 3, B/C1). On supprime UNIQUEMENT la ligne deck_cards
    // — starters, exclusions, flags HOPT/mort, catégories et paires sont CONSERVÉS,
    // inertes tant que la carte est absente (buildModel les ignore) et restaurés au
    // ré-ajout. Retirer une carte n'efface aucune connaissance de jeu (§D).
    removeCard(cardId) {
      const index = get().main.findIndex((m) => m.cardId === cardId);
      if (index < 0) return;
      const card = get().main[index];
      set({
        main: get().main.filter((m) => m.cardId !== cardId),
        removalToast: { card, index, ts: Date.now() },
      });
      touch();
      syncDeckCards();
    },

    togglePair(a, b) {
      if (a === b) return; // auto-combo hors périmètre (§D)
      const key = pairKey(a, b);
      const [ca, cb] = a <= b ? [a, b] : [b, a];
      const existing = get().pairs.find((p) => pairKey(p.card_a_id, p.card_b_id) === key);
      if (existing) {
        // Retirer un combo depuis la vue d'annotation = exclusion locale au deck (§5).
        get().setPairExcluded(existing.id, !get().pairExclusions.has(existing.id));
        return;
      }
      // Nouvelle paire dans la bibliothèque globale.
      const tempId = `tmp-${key}`;
      set({ pairs: [...get().pairs, { id: tempId, card_a_id: ca, card_b_id: cb }] });
      touch();
      persist(set, async () => {
        const created = await api.addPair(ca, cb);
        set({
          pairs: get().pairs.map((p) => (p.id === tempId ? { ...p, id: created.id } : p)),
        });
      });
    },

    setPairExcluded(pairId, excluded) {
      const pairExclusions = new Set(get().pairExclusions);
      if (excluded) pairExclusions.add(pairId);
      else pairExclusions.delete(pairId);
      set({ pairExclusions });
      touch();
      const { deckId } = get();
      if (deckId) persist(set, () => api.setPairExclusions(deckId, [...pairExclusions]));
    },

    removePairFromLibrary(pairId) {
      set({
        pairs: get().pairs.filter((p) => p.id !== pairId),
        pairExclusions: new Set([...get().pairExclusions].filter((id) => id !== pairId)),
      });
      touch();
      persist(set, () => api.deletePair(pairId));
    },

    addCategory(name, relevance) {
      const tempId = `tmp-cat-${name}`;
      set({
        categories: [...get().categories, { id: tempId, name, relevance, is_builtin: false }],
      });
      touch();
      persist(set, async () => {
        const created = await api.addCategory(name, relevance);
        set({
          categories: get().categories.map((c) => (c.id === tempId ? created : c)),
        });
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
      touch();
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
      touch();
      persist(set, () =>
        on
          ? api.addCardCategory(cardId, categoryId)
          : api.removeCardCategory(cardId, categoryId),
      );
    },

    setImportance(v) {
      set({ importance: v });
    },

    setHorizon(pass, value) {
      const v = clampHorizon(value);
      set(pass === 'first' ? { horizonFirst: v } : { horizonSecond: v });
      touch(); // hypothèse de jeu → recalcul + persistance dans l'URL de partage
    },

    setExtraSideHidden(hidden) {
      set({ extraSideHidden: hidden });
    },

    renameDeck(name) {
      set({ deckName: name });
      writeStateToHash(snapshot(get()));
      const { deckId } = get();
      if (deckId && name.trim()) persist(set, () => api.updateDeck(deckId, { name: name.trim() }));
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
