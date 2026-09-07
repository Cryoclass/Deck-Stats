import { evaluate, type Prepared } from './evaluate.js';
import type { AnalysisContext, CappedUnit, PassResult } from './types.js';

export interface DeckEntry {
  cardId: number;
  copies: number;
}

export interface SampledHand {
  cards: number[]; // passcodes tirés ; en second, la DERNIÈRE est la sixième pioche
  starts: number;
  redundancy: number;
  neTotal: number; // potentiel non-engine U du contexte
  catCounts: number[];
  neContrib: number[]; // contributions par signature (itération 7) — mêmes que les buckets
  neCapped: CappedUnit[]; // unités couplées (étape 5) — mêmes que les buckets
  note: number; // 0..10 (§4.4)
}

/** Score scalaire d'une main : starts d'abord (×100), non-engine en départage (§4.4). */
function handScore(starts: number, neTotal: number, importance: number): number {
  return starts * 100 + importance * neTotal;
}

/**
 * Note sur 10 = percentile auto-calibré sur le deck lui-même (§4.4) : la main est
 * meilleure que X % des mains que ce deck peut ouvrir. On calibre sur la
 * distribution EXACTE des issues (buckets du contexte), pas sur l'échantillon.
 */
export function buildScorer(
  pass: PassResult,
  importance: number,
): (starts: number, neTotal: number) => number {
  const outcomes = pass.outcomes ?? pass.total;
  const scored = pass.buckets.map((b) => ({
    s: handScore(b.starts, b.neTotal, importance),
    weight: b.weight ?? Math.round(b.p * outcomes),
  }));
  return (starts, neTotal) => {
    const s = handScore(starts, neTotal, importance);
    let below = 0;
    let equal = 0;
    for (const it of scored) {
      if (it.s < s) below += it.weight;
      else if (it.s === s) equal += it.weight;
    }
    if (pass.total === 0 || outcomes === 0) throw new Error('Note indisponible : tirage impossible.');
    // Exact half-up rational: 10*(2*below+equal)/(2*outcomes).
    const numerator = 10n * (2n * BigInt(below) + BigInt(equal));
    const denominator = 2n * BigInt(outcomes);
    return Math.max(0, Math.min(10, Number((2n * numerator + denominator) / (2n * denominator))));
  };
}

/** Tire `count` mains brutes (listes de passcodes) depuis le multiset réel du deck.
 *  Séparé de l'évaluation : les mêmes mains peuvent être RE-NOTÉES sans re-tirage
 *  quand le deck change (§4.4 / itération 3 C2). L'ordre de tirage est conservé :
 *  pour une main de 6, la dernière carte est la sixième pioche. */
export function drawHands(deck: DeckEntry[], handSize: number, count: number): number[][] {
  const pool: number[] = [];
  for (const e of deck) for (let c = 0; c < e.copies; c++) pool.push(e.cardId);
  if (!Number.isInteger(handSize) || handSize < 1 || pool.length < handSize) return [];
  const draw = handSize;
  const hands: number[][] = [];
  for (let h = 0; h < count; h++) {
    // Fisher-Yates partiel : mélange les `draw` premières positions.
    for (let i = 0; i < draw; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    hands.push(pool.slice(0, draw));
  }
  return hands;
}

/** (Re)évalue et (re)note des mains FIXES contre l'état courant du deck, avec les mêmes
 *  règles que la distribution exacte (contexte, sixième identifiée, conditions,
 *  fenêtres et plafonds). C'est ce qui renote les mains déjà affichées quand la
 *  distribution change (C2). En second, la dernière carte de chaque main est la
 *  sixième pioche ; une main de taille inattendue est ignorée. */
export function evaluateHands(params: {
  hands: number[][];
  typeIndexByCardId: Map<number, number>;
  prep: Prepared;
  context: AnalysisContext;
  scorer: (starts: number, neTotal: number) => number;
}): SampledHand[] {
  const { hands, typeIndexByCardId, prep, context, scorer } = params;
  const nTypes = prep.input.types.length;
  const handSize = context === 'first' ? 5 : 6;

  const out: SampledHand[] = [];
  for (const cards of hands) {
    if (cards.length !== handSize) continue;
    const k = new Array<number>(nTypes).fill(0);
    for (const cardId of cards) {
      const ti = typeIndexByCardId.get(cardId);
      if (ti !== undefined) k[ti] += 1;
    }
    const sixth = context === 'second' ? (typeIndexByCardId.get(cards[cards.length - 1]) ?? -1) : undefined;
    const o = evaluate(prep, context, k, sixth);
    out.push({
      cards,
      starts: o.starts,
      redundancy: o.redundancy,
      neTotal: o.ne,
      catCounts: o.catCounts,
      neContrib: o.neContrib,
      neCapped: o.neCapped,
      note: scorer(o.starts, o.ne),
    });
  }
  return out;
}

/** Tirage + évaluation en une passe (utilitaire ; conserve l'API d'origine). */
export function sampleHands(params: {
  deck: DeckEntry[];
  typeIndexByCardId: Map<number, number>;
  prep: Prepared;
  context: AnalysisContext;
  count: number;
  scorer: (starts: number, neTotal: number) => number;
}): SampledHand[] {
  const hands = drawHands(params.deck, params.context === 'first' ? 5 : 6, params.count);
  return evaluateHands({ ...params, hands });
}
