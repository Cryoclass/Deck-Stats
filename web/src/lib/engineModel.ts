import type { Category, ComboPair, DeckCard, StartRequirement } from '../types.js';
import type { EngineInput, Prereq } from '../engine/types.js';

// ─── Construction du modèle moteur à partir d'un deck + annotations (§B.1) ───
// Extrait du store (itération 9) pour servir DEUX consommateurs : l'éditeur (état
// Zustand) et le comparateur de decks (§4D), qui assemble la même structure depuis
// un `DeckDetail` de l'API + la bibliothèque du compte. Fonction pure, zéro global.

/** Ce que `buildEngineModel` a besoin de savoir — l'état du store est structurellement
 *  compatible (il porte ces champs, plus le reste). */
export interface EngineModelSource {
  main: DeckCard[];
  // Bibliothèque globale du compte
  hopt: Set<number>;
  deadFirst: Set<number>;
  deadSecond: Set<number>;
  pairs: ComboPair[];
  categories: Category[];
  cardCategories: Map<number, Set<string>>;
  // Local au deck
  starters: Set<number>;
  pairExclusions: Set<string>;
  startRequirements: StartRequirement[];
  horizonFirst: number;
  horizonSecond: number;
}

export interface EngineModel {
  input: EngineInput;
  typeCardIds: number[]; // typeIndex → cardId (aligné sur result.deltas)
  categoryIds: string[]; // categoryIndex → categoryId
}

export function buildEngineModel(s: EngineModelSource): EngineModel {
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
  // Itération 5 : toute carte requise par un prérequis est promue en type suivi, sinon
  // sa présence résiduelle en deck serait structurellement incalculable (§C).
  for (const r of s.startRequirements) {
    if (mainCopies.has(r.requiredCardId)) annotated.add(r.requiredCardId);
  }

  const typeCardIds = s.main.map((c) => c.cardId).filter((id) => annotated.has(id));
  const typeIndex = new Map(typeCardIds.map((id, i) => [id, i]));
  const categoryIds = s.categories.map((c) => c.id);
  const catIndex = new Map(categoryIds.map((id, i) => [id, i]));

  // Carte requise absente du deck → requiredType null, total 0 → jamais satisfait.
  const toPrereq = (requiredCardId: number, minInDeck: number): Prereq => {
    const rt = typeIndex.get(requiredCardId);
    return {
      requiredType: rt !== undefined ? rt : null,
      requiredTotal: mainCopies.get(requiredCardId) ?? 0,
      minInDeck: Math.max(1, minInDeck),
    };
  };

  const types = typeCardIds.map((id) => {
    const cats = [...(s.cardCategories.get(id) ?? [])]
      .map((cid) => catIndex.get(cid))
      .filter((i): i is number => i !== undefined);
    const cardReqs = s.startRequirements.filter((r) => r.sourceCardId === id);
    return {
      copies: mainCopies.get(id) ?? 0,
      isHopt: s.hopt.has(id),
      isStarter: s.starters.has(id),
      categories: cats,
      deadFirst: s.deadFirst.has(id),
      deadSecond: s.deadSecond.has(id),
      starterPrereqs: cardReqs.length
        ? cardReqs.map((r) => toPrereq(r.requiredCardId, r.minInDeck))
        : undefined,
    };
  });

  const edges = activePairs.map(
    (p): [number, number] => [typeIndex.get(p.card_a_id)!, typeIndex.get(p.card_b_id)!],
  );
  const edgePrereqs = activePairs.map((p) => {
    const reqs = s.startRequirements.filter((r) => r.sourcePairId === p.id);
    return reqs.length ? reqs.map((r) => toPrereq(r.requiredCardId, r.minInDeck)) : undefined;
  });

  const categories = s.categories.map((c) => ({ id: c.id, relevance: c.relevance }));

  return {
    input: {
      deckSize,
      types,
      edges,
      edgePrereqs,
      categories,
      horizonFirst: s.horizonFirst,
      horizonSecond: s.horizonSecond,
    },
    typeCardIds,
    categoryIds,
  };
}
