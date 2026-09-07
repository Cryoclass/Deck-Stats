/**
 * Specification support ONLY (étape 5A): Monte Carlo oracle. Never imported by
 * application code. Draws physical hands from the real multiset with a seeded
 * generator (deterministic), evaluating each chronological outcome with the
 * brute-force étape-1 primitives (via deckOracle.ts). It shares neither the exact
 * enumeration's weighting nor any production algorithm, so it independently checks
 * the outcome space (opening five + identified sixth) and its weights.
 */
import { evaluateOracleHand, type OracleOutcome, type OracleSpec } from './deckOracle.js';
import type { Position } from './oracle.js';

/** mulberry32: small, fast, seedable 32-bit generator (public domain). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Simulation {
  samples: number;
  /** Distinct observed outcomes (opening multiset + sixth) with their frequency. */
  cells: Array<{ count: number; result: OracleOutcome }>;
}

/**
 * `samples` shuffled draws (partial Fisher–Yates on the physical deck), each opening
 * of five plus, when going second, the next card in draw order. Evaluation is
 * memoized per outcome class, which only depends on the opening multiset and the
 * sixth card's name.
 */
export function simulate(spec: OracleSpec, position: Position, samples: number, seed: number): Simulation {
  const random = mulberry32(seed);
  const names = [...new Set(spec.deck)];
  const ids = spec.deck.map((name) => names.indexOf(name));
  const pool = ids.slice();
  const drawn = position === 'first' ? 5 : 6;
  if (pool.length < drawn) throw new Error('Deck too small for this position');
  const counts = new Map<string, number>();
  const opening = new Array<number>(5);
  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < drawn; i++) {
      const j = i + Math.floor(random() * (pool.length - i));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    for (let i = 0; i < 5; i++) opening[i] = pool[i];
    opening.sort((a, b) => a - b);
    const key = position === 'first' ? opening.join(',') : `${opening.join(',')}|${pool[5]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const cells = [...counts.entries()].map(([key, count]) => {
    const [openingPart, sixthPart] = key.split('|');
    const openingNames = openingPart.split(',').map((id) => names[Number(id)]);
    const sixth = sixthPart === undefined ? null : names[Number(sixthPart)];
    return { count, result: evaluateOracleHand(spec, position, openingNames, sixth) };
  });
  return { samples, cells };
}

/** Empirical probability of a predicate over outcomes. */
export function frequency(sim: Simulation, predicate: (o: OracleOutcome) => boolean): number {
  let hits = 0;
  for (const cell of sim.cells) if (predicate(cell.result)) hits += cell.count;
  return hits / sim.samples;
}

/**
 * Tolerance for |empirical − exact| given the exact probability p and n samples:
 * five binomial standard errors plus a floor of five draws for rare events. With a
 * fixed seed the comparison is deterministic; an exceedance is a reproducible
 * divergence, never noise to absorb by loosening the bound.
 */
export function tolerance(p: number, n: number): number {
  return 5 * Math.sqrt((p * (1 - p)) / n) + 5 / n;
}
