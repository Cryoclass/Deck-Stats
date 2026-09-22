import type { ComboPair } from '../types.js';
import { pairKey } from '../types.js';
import { assignGroups, type GroupAssignment } from '../lib/colors.js';
import { prepare } from '../engine/evaluate.js';
import { buildScorer, drawHands, evaluateHands, type SampledHand } from '../engine/hand.js';
import { useDeck } from './deckStore.js';
import { buildEngineModel } from '../lib/engineModel.js';
import { columnOf, studiedSource } from './study.js';

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

/** Existe-t-il une paire (active ou non) entre a et b ? → état pour la vue combos. */
export function findPair(a: number, b: number): ComboPair | undefined {
  const key = pairKey(a, b);
  return useDeck
    .getState()
    .pairs.find((p) => pairKey(p.card_a_id, p.card_b_id) === key);
}

/** Tire des mains brutes depuis le deck ÉTUDIÉ de la position (§4.3 ; plans de side v2, S1) — sans les
 *  noter. Aucune main si le plan de la position n'est pas prêt (S2). */
export function drawHandsFromStore(handSize: number, count: number): number[][] {
  const s = useDeck.getState();
  const source = studiedSource(s, handSize <= 5 ? 'first' : 'second');
  if (!source || source.main.length === 0) return [];
  return drawHands(
    source.main.map((c) => ({ cardId: c.cardId, copies: c.copies })),
    handSize,
    count,
  );
}

/** (Re)note des mains fixes contre l'état courant (distribution + importance). Sert à
 *  renoter les mains déjà affichées quand le deck change (§4.4 / itération 3 C2). */
export function noteHandsFromStore(hands: number[][], handSize: number): SampledHand[] {
  const s = useDeck.getState();
  // Contexte unique du moteur (étape 5) : 5 cartes = premier, 6 = second (sixième
  // identifiée = dernière carte tirée), mêmes règles que la distribution exacte.
  const context = handSize <= 5 ? 'first' : 'second';
  // Plans de side v2 : la distribution et le modèle sont ceux du deck ÉTUDIÉ de la position.
  const source = studiedSource(s, context);
  const pass = columnOf(s, context, false).pass; // la passe du PLAN, jamais celle d'un aperçu
  if (!source || !pass || pass.total === 0 || hands.length === 0) return [];
  const model = buildEngineModel(source);
  const prep = prepare(model.input);
  const typeIndexByCardId = new Map(model.typeCardIds.map((id, i) => [id, i]));
  const scorer = buildScorer(pass, s.importance);
  return evaluateHands({ hands, typeIndexByCardId, prep, context, scorer });
}
