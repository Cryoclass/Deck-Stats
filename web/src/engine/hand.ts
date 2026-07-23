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
  neContrib: number[]; // contributions par signature (itération 7) — mêmes que les buckets
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

/** Tire `count` mains brutes (listes de passcodes) depuis le multiset réel du deck.
 *  Séparé de l'évaluation : les mêmes mains peuvent être RE-NOTÉES sans re-tirage
 *  quand le deck change (§4.4 / itération 3 C2). */
export function drawHands(deck: DeckEntry[], handSize: number, count: number): number[][] {
  const pool: number[] = [];
  for (const e of deck) for (let c = 0; c < e.copies; c++) pool.push(e.cardId);
  if (pool.length === 0) return [];
  const draw = Math.min(handSize, pool.length);
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

/** (Re)évalue et (re)note des mains FIXES contre l'état courant du deck. C'est ce
 *  qui renote les mains déjà affichées quand la distribution change (C2). */
export function evaluateHands(params: {
  hands: number[][];
  typeIndexByCardId: Map<number, number>;
  prep: Prepared;
  handSize: number;
  scorer: (starts: number, neTotal: number) => number;
}): SampledHand[] {
  const { hands, typeIndexByCardId, prep, handSize, scorer } = params;
  const nTypes = prep.input.types.length;
  const dead = handSize <= 5 ? prep.deadFirst : prep.deadSecond;

  return hands.map((cards) => {
    const k = new Array<number>(nTypes).fill(0);
    for (const cardId of cards) {
      const ti = typeIndexByCardId.get(cardId);
      if (ti !== undefined) k[ti] += 1;
    }
    const out = evaluate(prep, k, dead);
    const neTotal = handSize <= 5 ? out.neFirst : out.neSecond;
    return {
      cards,
      starts: out.starts,
      redundancy: out.redundancy,
      neTotal,
      catCounts: out.catCounts,
      neContrib: handSize <= 5 ? out.neContribFirst : out.neContribSecond,
      note: scorer(out.starts, neTotal),
    };
  });
}

/** Tirage + évaluation en une passe (utilitaire ; conserve l'API d'origine). */
export function sampleHands(params: {
  deck: DeckEntry[];
  typeIndexByCardId: Map<number, number>;
  prep: Prepared;
  handSize: number;
  count: number;
  scorer: (starts: number, neTotal: number) => number;
}): SampledHand[] {
  const hands = drawHands(params.deck, params.handSize, params.count);
  return evaluateHands({ ...params, hands });
}
