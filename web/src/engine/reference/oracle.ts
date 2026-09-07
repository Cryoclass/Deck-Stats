/**
 * Specification support ONLY. Never imported by application code.
 * Exhaustive physical-copy enumeration and brute-force assignments deliberately
 * differ from the production composition/matching engine. Tiny fixtures only.
 * These types are test notation, not a proposed persistence or engine API.
 */
export function choose(n: number, k: number): bigint {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0) {
    throw new Error('Invalid combination parameters');
  }
  if (k > n) return 0n;
  let result = 1n;
  for (let i = 1; i <= Math.min(k, n - k); i++) {
    result = result * BigInt(n - i + 1) / BigInt(i);
  }
  return result;
}

/** Copies have distinct indices, even when their card names are equal. */
export function physicalHands(size: number, drawn: number): number[][] {
  if (!Number.isInteger(size) || size < 0 || size > 12 ||
      !Number.isInteger(drawn) || drawn < 0) throw new Error('Tiny fixtures only');
  const result: number[][] = [];
  function visit(from: number, picked: number[]): void {
    if (picked.length === drawn) {
      result.push(picked);
      return;
    }
    for (let i = from; i <= size - (drawn - picked.length); i++) {
      visit(i + 1, [...picked, i]);
    }
  }
  visit(0, []);
  return result;
}

/** Opening order is irrelevant; the additional draw remains distinguishable. */
export function chronologicalHands(size: number, openingSize = 5): Array<{
  opening: number[];
  draw: number;
}> {
  return physicalHands(size, openingSize).flatMap((opening) =>
    Array.from({ length: size }, (_, i) => i)
      .filter((i) => !opening.includes(i)).map((draw) => ({ opening, draw })),
  );
}

export type Profile = 'early' | 'flexible' | 'prepared' | 'breaker';
export type Position = 'first' | 'second';
export type Window = 'opponent' | 'own';

export function windows(profile: Profile, position: Position, sixth = false): Window[] {
  if (position === 'first') {
    if (sixth) throw new Error('First player has no sixth opening card');
    return profile === 'flexible' || profile === 'prepared' ? ['opponent'] : [];
  }
  switch (profile) {
    case 'early': return sixth ? [] : ['opponent'];
    case 'flexible': return sixth ? ['own'] : ['opponent', 'own'];
    case 'prepared':
    case 'breaker': return ['own'];
  }
}

export interface PotentialCopy {
  name: string;
  windows: Window[];
  hopt?: boolean;
  categories?: string[];
  group?: string;
}

/** Max feasible copy count, not simulated activations or resolved interactions. */
export function potential(
  copies: PotentialCopy[],
  groupCaps: Record<string, number> = {},
  categoryUnion?: string[],
): number {
  if (copies.length > 6) throw new Error('Tiny hands only');
  const eligible = copies.filter((c) => categoryUnion === undefined ||
    c.categories?.some((label) => categoryUnion.includes(label)));
  const assigned: Array<{ copy: PotentialCopy; window: Window }> = [];
  function visit(index: number): number {
    if (index === eligible.length) return assigned.length;
    const copy = eligible[index];
    let best = visit(index + 1); // May leave this physical copy unused.
    for (const window of copy.windows) {
      const sameTurn = assigned.filter((a) => a.window === window);
      if (sameTurn.some((a) => a.copy.name === copy.name && (a.copy.hopt || copy.hopt))) continue;
      if (copy.group !== undefined) {
        const cap = groupCaps[copy.group];
        if (cap !== undefined && sameTurn.filter((a) => a.copy.group === copy.group).length >= cap) continue;
      }
      assigned.push({ copy, window });
      best = Math.max(best, visit(index + 1));
      assigned.pop();
    }
    return best;
  }
  return visit(0);
}

export type Condition =
  | { card: string; atLeast: number }
  | { and: Condition[] }
  | { or: Condition[] };

/** Counts supplied here are MAIN DECK counts AFTER the observed draws. */
export function conditionHolds(condition: Condition, remaining: Record<string, number>): boolean {
  if ('card' in condition) {
    if (!Number.isInteger(condition.atLeast) || condition.atLeast < 1) throw new Error('Invalid quantity');
    return (remaining[condition.card] ?? 0) >= condition.atLeast;
  }
  const children = 'and' in condition ? condition.and : condition.or;
  if (children.length === 0) throw new Error('An explicit condition group cannot be empty');
  // Evaluate all children so an invalid branch cannot be hidden by short-circuiting.
  const values = children.map((child) => conditionHolds(child, remaining));
  return 'and' in condition ? values.every(Boolean) : values.some(Boolean);
}

/** Exhaustive action subsets, with disjoint vertices (no matching algorithm). */
export function theoreticalStarts(
  hand: string[],
  starters: string[],
  pairs: Array<[string, string]>,
  hopt: string[] = [],
): { starts: number; redundancy: number } {
  const vertices = hand.filter((name, i) => !hopt.includes(name) || hand.indexOf(name) === i);
  if (vertices.length > 6) throw new Error('Tiny hands only');
  const actions: number[][] = [];
  let redundancy = 0;
  vertices.forEach((name, i) => {
    if (starters.includes(name)) actions.push([i]);
    for (let j = i + 1; j < vertices.length; j++) {
      if (name !== vertices[j] && pairs.some(([a, b]) =>
        (a === name && b === vertices[j]) || (b === name && a === vertices[j]))) {
        actions.push([i, j]);
        redundancy++;
      }
    }
  });
  function visit(index: number, used: number[]): number {
    if (index === actions.length) return 0;
    const skip = visit(index + 1, used);
    if (actions[index].some((v) => used.includes(v))) return skip;
    return Math.max(skip, 1 + visit(index + 1, [...used, ...actions[index]]));
  }
  return { starts: visit(0, []), redundancy };
}

/** Positive rational, nearest integer with exact half-up rounding. */
export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error('Invalid ratio');
  return (2n * numerator + denominator) / (2n * denominator);
}
