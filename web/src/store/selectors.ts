import type { ComboPair } from '../types.js';
import { pairKey } from '../types.js';
import { assignGroups, type GroupAssignment } from '../lib/colors.js';
import { prepare } from '../engine/evaluate.js';
import { buildScorer, drawHands, evaluateHands, type SampledHand } from '../engine/hand.js';
import { useDeck } from './deckStore.js';

/** Paires actives : non exclues et dont les deux cartes sont dans le main deck. */
export function selectActivePairs(): ComboPair[] {
  const s = useDeck.getState();
  const inMain = new Set(s.main.map((c) => c.cardId));
  return s.pairs.filter(
    (p) =>
      !s.pairExclusions.has(p.id) && inMain.has(p.card_a_id) && inMain.has(p.card_b_id),
  );
}

/** Assignation pivots/pastilles + couleurs (dérivée, §4.2). */
export function selectGroups(): GroupAssignment {
  const edges = selectActivePairs().map((p): [number, number] => [p.card_a_id, p.card_b_id]);
  return assignGroups(edges);
}

/** Contribution marginale par carte : Δ P(≥1 start) si −1 copie (§3.2). */
export function selectDeltas(): Map<number, { first: number; second: number }> {
  const s = useDeck.getState();
  const out = new Map<number, { first: number; second: number }>();
  if (!s.result || !s.model) return out;
  s.model.typeCardIds.forEach((cardId, i) => {
    out.set(cardId, s.result!.deltas[i] ?? { first: 0, second: 0 });
  });
  return out;
}

/** Existe-t-il une paire (active ou non) entre a et b ? → état pour la vue combos. */
export function findPair(a: number, b: number): ComboPair | undefined {
  const key = pairKey(a, b);
  return useDeck
    .getState()
    .pairs.find((p) => pairKey(p.card_a_id, p.card_b_id) === key);
}

/** Tire des mains brutes depuis le deck courant (§4.3) — sans les noter. */
export function drawHandsFromStore(handSize: number, count: number): number[][] {
  const s = useDeck.getState();
  if (s.main.length === 0) return [];
  return drawHands(
    s.main.map((c) => ({ cardId: c.cardId, copies: c.copies })),
    handSize,
    count,
  );
}

/** (Re)note des mains fixes contre l'état courant (distribution + importance). Sert à
 *  renoter les mains déjà affichées quand le deck change (§4.4 / itération 3 C2). */
export function noteHandsFromStore(hands: number[][], handSize: number): SampledHand[] {
  const s = useDeck.getState();
  if (!s.model || !s.result || hands.length === 0) return [];
  const prep = prepare(s.model.input);
  const typeIndexByCardId = new Map(s.model.typeCardIds.map((id, i) => [id, i]));
  const pass = handSize <= 5 ? s.result.first : s.result.second;
  const scorer = buildScorer(pass, s.importance);
  return evaluateHands({ hands, typeIndexByCardId, prep, handSize, scorer });
}
