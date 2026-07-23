import { evaluate, type Prepared } from './evaluate.js';
import type { PassResult } from './types.js';

export interface DeckEntry {
  cardId: number;
  copies: number;
}

export interface SampledHand {
  cards: number[]; // passcodes tirés (handSize)
  starts: number;
  redundancy: number;
  neTotal: number; // non-engine pertinents pour la passe
  catCounts: number[];
  note: number; // 0..10 (§4.4)
}

/** Score scalaire d'une main : starts d'abord (×100), non-engine en départage (§4.4). */
function handScore(starts: number, neTotal: number, importance: number): number {
  return starts * 100 + importance * neTotal;
}

/**
 * Note sur 10 = percentile auto-calibré sur le deck lui-même (§4.4) : la main est
 * meilleure que X % des mains que ce deck peut ouvrir. On calibre sur la
 * distribution EXACTE des mains (buckets de la passe), pas sur l'échantillon.
 */
export function buildScorer(
  pass: PassResult,
  importance: number,
): (starts: number, neTotal: number) => number {
  const scored = pass.buckets.map((b) => ({
    s: handScore(b.starts, b.neTotal, importance),
    p: b.p,
  }));
  return (starts, neTotal) => {
    const s = handScore(starts, neTotal, importance);
    let below = 0;
    let equal = 0;
    for (const it of scored) {
      if (it.s < s) below += it.p;
      else if (it.s === s) equal += it.p;
    }
    const pct = below + 0.5 * equal; // point milieu pour les égalités
    return Math.max(0, Math.min(10, Math.round(pct * 10)));
  };
}

/** Tirage de `count` mains aléatoires depuis le multiset réel du main deck. */
export function sampleHands(params: {
  deck: DeckEntry[];
  typeIndexByCardId: Map<number, number>;
  prep: Prepared;
  handSize: number;
  count: number;
  scorer: (starts: number, neTotal: number) => number;
}): SampledHand[] {
  const { deck, typeIndexByCardId, prep, handSize, count, scorer } = params;
  const pool: number[] = [];
  for (const e of deck) for (let c = 0; c < e.copies; c++) pool.push(e.cardId);
  if (pool.length === 0) return [];

  const nTypes = prep.input.types.length;
  const hands: SampledHand[] = [];
  const draw = Math.min(handSize, pool.length);

  for (let h = 0; h < count; h++) {
    // Fisher-Yates partiel : mélange les `draw` premières positions.
    for (let i = 0; i < draw; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    const cards = pool.slice(0, draw);

    const k = new Array<number>(nTypes).fill(0);
    for (const cardId of cards) {
      const ti = typeIndexByCardId.get(cardId);
      if (ti !== undefined) k[ti] += 1;
    }
    const out = evaluate(prep, k);
    const neTotal = handSize <= 5 ? out.neFirst : out.neSecond;
    hands.push({
      cards,
      starts: out.starts,
      redundancy: out.redundancy,
      neTotal,
      catCounts: out.catCounts,
      note: scorer(out.starts, neTotal),
    });
  }
  return hands;
}
