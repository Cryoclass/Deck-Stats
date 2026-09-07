import type { CardProfile, Category, ComboPair, DeckCard, NonEngineGroup, StartCondition } from '../types.js';
import type { Condition, EngineInput } from '../engine/types.js';
import { requiredCardIds, toEngineCondition } from './conditions.js';

// ─── Construction du modèle moteur à partir d'un deck + annotations (§B.1) ───
// Extrait du store (itération 9) pour servir DEUX consommateurs : l'éditeur (état
// Zustand) et le comparateur de decks (§4D), qui assemble la même structure depuis
// un `DeckDetail` de l'API + la bibliothèque du compte. Fonction pure, zéro global.
//
// Étape 5B : profils de disponibilité et plafonds partagés viennent de la bibliothèque
// du compte, les conditions ET/OU du deck ; aucun horizon, aucune pertinence de
// catégorie. Une carte étiquetée sans profil est transmise sans profil (contribution
// nulle, Q5) et listée dans `unprofiledCardIds` pour être signalée.

/** Ce que `buildEngineModel` a besoin de savoir — l'état du store est structurellement
 *  compatible (il porte ces champs, plus le reste). */
export interface EngineModelSource {
  main: DeckCard[];
  // Bibliothèque globale du compte
  hopt: Set<number>;
  profiles: Map<number, CardProfile>;
  groups: NonEngineGroup[];
  categories: Category[];
  cardCategories: Map<number, Set<string>>;
  // Local au deck
  deadFirst: Set<number>;
  deadSecond: Set<number>;
  pairs: ComboPair[];
  starters: Set<number>;
  pairExclusions: Set<string>;
  startConditions: StartCondition[];
}

export interface EngineModel {
  input: EngineInput;
  typeCardIds: number[]; // typeIndex → cardId (aligné sur result.deltas)
  categoryIds: string[]; // categoryIndex → categoryId
  groupIds: string[]; // groupIndex → id du plafond partagé
  /** Cartes du main deck étiquetées non-engine mais sans profil : non comptées (Q5). */
  unprofiledCardIds: number[];
}

export function buildEngineModel(s: EngineModelSource): EngineModel {
  const mainCopies = new Map(s.main.map((c) => [c.cardId, c.copies]));
  const deckSize = s.main.reduce((sum, c) => sum + c.copies, 0);
  const catIndex = new Map(s.categories.map((c, i) => [c.id, i]));
  const labelsOf = (id: number): number[] =>
    [...(s.cardCategories.get(id) ?? [])].map((cid) => catIndex.get(cid)).filter((i): i is number => i !== undefined);

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
  for (const [cardId] of s.cardCategories) {
    if (labelsOf(cardId).length > 0 && mainCopies.has(cardId)) annotated.add(cardId);
  }
  // Toute carte requise par une condition est promue en type suivi, sinon sa présence
  // résiduelle en deck serait structurellement incalculable (§C).
  for (const r of s.startConditions) {
    for (const id of requiredCardIds(r.condition)) if (mainCopies.has(id)) annotated.add(id);
  }

  const typeCardIds = s.main.map((c) => c.cardId).filter((id) => annotated.has(id));
  const typeIndex = new Map(typeCardIds.map((id, i) => [id, i]));
  const categoryIds = s.categories.map((c) => c.id);
  const typeIndexOf = (cardId: number): number | undefined => typeIndex.get(cardId);

  // Plafonds partagés effectivement référencés par une carte profilée du deck (Q2 : un
  // groupe sans profil n'existe pas en base ; un groupe supprimé est ignoré).
  const groupById = new Map(s.groups.map((g) => [g.id, g]));
  const groupIds: string[] = [];
  const groupIndex = new Map<string, number>();
  const groupOf = (cardId: number): number | undefined => {
    const profile = s.profiles.get(cardId);
    if (!profile?.groupId || !groupById.has(profile.groupId)) return undefined;
    let gi = groupIndex.get(profile.groupId);
    if (gi === undefined) {
      gi = groupIds.length;
      groupIds.push(profile.groupId);
      groupIndex.set(profile.groupId, gi);
    }
    return gi;
  };

  const conditionOf = (r: StartCondition | undefined): Condition | undefined =>
    r ? toEngineCondition(r.condition, typeIndexOf) : undefined;

  const unprofiledCardIds: number[] = [];
  const types = typeCardIds.map((id) => {
    const cats = labelsOf(id);
    const profile = s.profiles.get(id);
    if (cats.length > 0 && !profile) unprofiledCardIds.push(id);
    const group = profile ? groupOf(id) : undefined;
    return {
      copies: mainCopies.get(id) ?? 0,
      isHopt: s.hopt.has(id),
      isStarter: s.starters.has(id),
      categories: cats,
      deadFirst: s.deadFirst.has(id),
      deadSecond: s.deadSecond.has(id),
      ...(profile ? { availability: profile.availability } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(s.starters.has(id) ? { starterCondition: conditionOf(s.startConditions.find((r) => r.sourceCardId === id)) } : {}),
    };
  });

  const edges = activePairs.map(
    (p): [number, number] => [typeIndex.get(p.card_a_id)!, typeIndex.get(p.card_b_id)!],
  );
  const edgeConditions = activePairs.map((p) => conditionOf(s.startConditions.find((r) => r.sourcePairId === p.id)));

  return {
    input: {
      deckSize,
      types,
      edges,
      ...(edgeConditions.some((c) => c !== undefined) ? { edgeConditions } : {}),
      categories: s.categories.map((c) => ({ id: c.id })),
      ...(groupIds.length ? { groups: groupIds.map((gid) => ({ id: gid, capPerTurn: groupById.get(gid)!.cap_per_turn })) } : {}),
    },
    typeCardIds,
    categoryIds,
    groupIds,
    unprofiledCardIds,
  };
}
