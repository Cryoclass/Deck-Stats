import { describe, expect, it } from 'vitest';
import {
  choose, chronologicalHands, conditionHolds, physicalHands, potential,
  roundRatio, theoreticalStarts, windows,
  type Condition, type PotentialCopy, type Profile, type Window,
} from './oracle.js';
import { computePass } from '../enumerate.js';
import type { EngineInput } from '../types.js';

// IDs link to docs/cas-reference.md. Most tests specify the TARGET rules using
// only the independent oracle. The last suite explicitly checks production too.
describe('Reference P — exact sampling without replacement', () => {
  it('P01: physical copies have six equiprobable hands, not four compositions', () => {
    const deck = ['A', 'A', 'X', 'Y'];
    const hands = physicalHands(4, 2);
    const counts = [0, 0, 0];
    for (const hand of hands) counts[hand.filter((i) => deck[i] === 'A').length]++;
    expect(hands).toHaveLength(6);
    expect(counts).toEqual([1, 4, 1]);
  });

  it('P02: 40 cards, three A, opening five; exact fractions and display rounding', () => {
    const denominator = choose(40, 5);
    expect(denominator).toBe(658008n);
    const atLeastOne = denominator - choose(37, 5);
    const exactlyTwo = choose(3, 2) * choose(37, 3);
    expect(atLeastOne).toBe(222111n);
    expect(exactlyTwo).toBe(23310n);
    expect(roundRatio(10000n * atLeastOne, denominator)).toBe(3376n);
    expect(roundRatio(10000n * exactlyTwo, denominator)).toBe(354n);
  });

  it('P03: second = opening five plus one distinct draw; each set of six has six origins', () => {
    const outcomes = chronologicalHands(7);
    expect(outcomes).toHaveLength(42); // C(7,5) * 2 = C(7,6) * 6.
    const sets = new Map<string, number>();
    for (const { opening, draw } of outcomes) {
      expect(opening).not.toContain(draw);
      const key = [...opening, draw].sort().join(',');
      sets.set(key, (sets.get(key) ?? 0) + 1);
    }
    expect([...sets.values()]).toEqual(new Array(7).fill(6));
    expect(outcomes.filter((s) => s.opening.includes(0))).toHaveLength(30);
    expect(outcomes.filter((s) => s.draw === 0)).toHaveLength(6);
  });

  it('P04: first A on sixth is disjoint from A in opening five', () => {
    // Lift both methods to the same denominator to avoid float comparisons.
    const chronologicalDenominator = choose(40, 5) * 35n;
    const firstOnSixth = choose(37, 5) * 3n;
    const opening = (choose(40, 5) - choose(37, 5)) * 35n;
    expect(chronologicalDenominator).toBe(choose(40, 6) * 6n);
    expect(opening + firstOnSixth).toBe((choose(40, 6) - choose(37, 6)) * 6n);
    expect(Number(firstOnSixth) / Number(chronologicalDenominator)).toBeCloseTo(0.05678137651821863, 14);
  });

  it('P05: impossible draws have zero outcomes, not 100% playable hands', () => {
    for (const size of [0, 4]) expect(physicalHands(size, 5)).toEqual([]);
    expect(physicalHands(5, 5)).toHaveLength(1);
    expect(chronologicalHands(5)).toEqual([]);
    expect(choose(5, 6)).toBe(0n);
    expect(() => roundRatio(0n, 0n)).toThrow(); // No probability with denominator zero.
  });
});

describe('Reference N — chronology and non-engine potential, not resolved play', () => {
  const cases: Array<[Profile, Window[], Window[], Window[]]> = [
    ['early', [], ['opponent'], []],
    ['flexible', ['opponent'], ['opponent', 'own'], ['own']],
    ['prepared', ['opponent'], ['own'], ['own']],
    ['breaker', [], ['own'], ['own']],
  ];
  it.each(cases)('N01: profile %s has the specified three availability cases', (profile, first, second, sixth) => {
    expect(windows(profile, 'first')).toEqual(first);
    expect(windows(profile, 'second')).toEqual(second);
    expect(windows(profile, 'second', true)).toEqual(sixth);
  });

  it('N02: one early card in seven: raw 6/7 versus second potential 5/7', () => {
    const outcomes = chronologicalHands(7);
    let raw = 0;
    let useful = 0;
    for (const { opening, draw } of outcomes) {
      const present = opening.includes(0) || draw === 0;
      raw += Number(present);
      useful += potential(present ? [{ name: 'M', windows: windows('early', 'second', draw === 0) }] : []);
    }
    expect([raw, useful, outcomes.length]).toEqual([36, 30, 42]);
  });

  it('N03: a physical card never contributes twice, even with two windows', () => {
    expect(potential([{ name: 'H', hopt: true, windows: windows('flexible', 'second') }])).toBe(1);
  });

  it('N04: HOPT is per name per turn; the sixth cannot be used on the previous turn', () => {
    const copy = (sixth = false): PotentialCopy => ({ name: 'H', hopt: true, windows: windows('flexible', 'second', sixth) });
    expect(potential([copy(), copy(), copy()])).toBe(2);
    expect(potential([copy(), copy(true)])).toBe(2);
    expect(potential([copy(true)])).toBe(1);
    expect(potential([copy(), copy()].map((c) => ({ ...c, windows: windows('flexible', 'first') })))).toBe(1);
    expect(potential([copy(), { ...copy(), name: 'J' }])).toBe(2);
  });

  it('N05: prepared cards have one window in second; non-HOPT copies remain distinct', () => {
    const copy: PotentialCopy = { name: 'Q', hopt: true, windows: windows('prepared', 'second') };
    expect(potential([copy, copy])).toBe(1);
    expect(potential([copy, copy].map((c) => ({ ...c, hopt: false })))).toBe(2);
  });

  it('N06: a shared per-turn cap is neither an individual HOPT nor a category sum', () => {
    const copies: PotentialCopy[] = ['M', 'M', 'P'].map((name) => ({
      name, group: 'family', windows: ['opponent'],
    }));
    expect(potential(copies, { family: 2 })).toBe(2);
    expect(potential(copies.slice(0, 2), { family: 2 })).toBe(2);
    expect(potential(copies.slice(0, 2).map((c) => ({ ...c, hopt: true })), { family: 2 })).toBe(1);
    expect(potential([...copies, { ...copies[0], windows: ['own'] }], { family: 2 })).toBe(3);
  });

  it('N07: category unions deduplicate; each subset measures its own potential', () => {
    const shared: PotentialCopy = { name: 'A', categories: ['x', 'y'], windows: ['own'] };
    expect(potential([shared], {}, ['x'])).toBe(1);
    expect(potential([shared], {}, ['y'])).toBe(1);
    expect(potential([shared], {}, ['x', 'y', 'x'])).toBe(1);
    expect(potential([shared], {}, [])).toBe(0);
    const capped: PotentialCopy[] = [
      { ...shared, categories: ['x'], group: 'g' },
      { ...shared, name: 'B', categories: ['y'], group: 'g' },
    ];
    expect(potential(capped, { g: 1 }, ['x'])).toBe(1);
    expect(potential(capped, { g: 1 }, ['y'])).toBe(1);
    expect(potential(capped, { g: 1 }, ['x', 'y'])).toBe(1);
  });
});

describe('Reference S/C — theoretical starts and remaining-deck conditions', () => {
  it('S01: overlapping AB and BC are one start, two redundancies', () => {
    expect(theoreticalStarts(['A', 'B', 'C'], [], [['A', 'B'], ['B', 'C']])).toEqual({ starts: 1, redundancy: 2 });
    const deck = ['A', 'B', 'C', 'X'];
    const good = physicalHands(4, 2).filter((h) =>
      theoreticalStarts(h.map((i) => deck[i]), [], [['A', 'B'], ['B', 'C']]).starts > 0);
    expect(good).toHaveLength(2); // 2/6, not a sum of non-disjoint larger-hand events.
  });

  it('S02: HOPT collapses starts, redundancy includes starters, duplicate pair declarations add nothing', () => {
    expect(theoreticalStarts(['A', 'A'], ['A'], [], ['A']).starts).toBe(1);
    expect(theoreticalStarts(['A', 'A'], ['A'], []).starts).toBe(2);
    expect(theoreticalStarts(['A', 'B'], ['A'], [['A', 'B'], ['B', 'A']])).toEqual({ starts: 1, redundancy: 1 });
    expect(theoreticalStarts(['A', 'A', 'B', 'B'], [], [['A', 'B']])).toEqual({ starts: 2, redundancy: 4 });
    expect(theoreticalStarts(['A', 'A'], [], [['A', 'A']]).starts).toBe(0); // Self-pair out of current scope.
  });

  it('S03: start and non-engine axes may both count the same physical card', () => {
    const starts = theoreticalStarts(['R', 'E'], [], [['R', 'E']]).starts;
    const ne = potential([{ name: 'R', windows: ['own'] }]);
    expect([starts, ne]).toEqual([1, 1]);
  });

  const target: Condition = { card: 'B', atLeast: 1 };
  it('C01: only remaining main-deck copies meet a requirement', () => {
    expect(conditionHolds(target, { B: 1 })).toBe(true);
    expect(conditionHolds(target, { B: 0 })).toBe(false);
    expect(conditionHolds(target, {})).toBe(false);
    expect(conditionHolds({ card: 'B', atLeast: 2 }, { B: 1 })).toBe(false);
    expect(conditionHolds({ card: 'B', atLeast: 2 }, { B: 2 })).toBe(true);
  });

  it('C02: B AND (C OR D); two satisfied alternatives are still one condition', () => {
    const condition: Condition = { and: [target, { or: [{ card: 'C', atLeast: 1 }, { card: 'D', atLeast: 1 }] }] };
    expect(conditionHolds(condition, { B: 1, C: 1 })).toBe(true);
    expect(conditionHolds(condition, { B: 1, D: 1 })).toBe(true);
    expect(conditionHolds(condition, { B: 1, C: 1, D: 1 })).toBe(true);
    expect(conditionHolds(condition, { B: 1 })).toBe(false);
    expect(conditionHolds(condition, { C: 1, D: 1 })).toBe(false);
    expect(() => conditionHolds({ or: [] }, {})).toThrow();
    expect(() => conditionHolds({ card: 'B', atLeast: 0 }, {})).toThrow();
  });

  it('C03: conditions neither consume targets nor disable a card in other roles', () => {
    const remaining = { B: 1 };
    const enabled = ['A', 'C'].filter(() => conditionHolds(target, remaining));
    expect(theoreticalStarts(['A', 'C'], enabled, [], ['A', 'C']).starts).toBe(2);
    expect(remaining).toEqual({ B: 1 });
    const disabledStarter = conditionHolds(target, {}) ? ['A'] : [];
    expect(theoreticalStarts(['A', 'C'], disabledStarter, [['A', 'C']]).starts).toBe(1);
    expect(potential([{ name: 'A', windows: ['own'] }])).toBe(1);
  });

  it('C04: drawing the last target as sixth disables the source for the own turn', () => {
    const deck = ['A', 'B', 'X', 'Y', 'Z', 'W'];
    const opening = [0, 2, 3, 4, 5];
    const remainingBefore = deck.filter((_, i) => !opening.includes(i));
    expect(conditionHolds(target, { B: remainingBefore.filter((c) => c === 'B').length })).toBe(true);
    expect(conditionHolds(target, { B: 0 })).toBe(false); // Sixth is necessarily B.
  });
});

describe('Reference M — expected results for subsequent corrections', () => {
  it('M01: replacing a required target with neutral filler has a positive loss delta', () => {
    const deck = ['A', 'A', 'B', 'X'];
    const hands = physicalHands(4, 2);
    const countStarts = (cards: string[]) => hands.filter((h) =>
      h.some((i) => cards[i] === 'A') && cards.some((c, i) => c === 'B' && !h.includes(i))).length;
    expect(countStarts(deck)).toBe(3); // AA, A1X, A2X; denominator 6.
    expect(countStarts(['A', 'A', 'neutral', 'X'])).toBe(0);
    expect(choose(39, 5) - choose(36, 5)).toBe(198765n); // 40 cards, A×3, B×1.
    expect(Number(198765n) / Number(choose(40, 5))).toBeCloseTo(0.3020707954918481, 14);
  });

  it('M02: six retained non-engine belong entirely in 5+; exact mean differs from floor', () => {
    const u = potential(Array.from({ length: 6 }, (_, i) => ({ name: String(i), windows: ['own'] })));
    const columns = [0, 0, 0, 0, 0, 0];
    columns[Math.min(u, 5)]++;
    expect(u).toBe(6);
    expect(columns).toEqual([0, 0, 0, 0, 0, 1]);
    expect(columns.reduce((sum, mass) => sum + mass, 0)).toBe(1);
    expect(columns.reduce((sum, mass, i) => sum + mass * i, 0)).toBe(5);
  });

  it('M03: percentile midpoint 36 below, 12 equal, 56 total rounds 7.5 to 8', () => {
    expect(roundRatio(10n * (2n * 36n + 12n), 2n * 56n)).toBe(8n);
    expect(roundRatio(10n * (2n * 36n + 11n), 2n * 56n)).toBe(7n);
  });
});

describe('Bridge B — production compared with physical enumeration on unchanged rules', () => {
  it('B01: 32 deterministic configurations, both hand sizes, all physical hands', () => {
    const deck = ['A', 'A', 'B', 'B', 'C', 'C', 'X', 'X'];
    const names = ['A', 'B', 'C'];
    for (let mask = 0; mask < 32; mask++) {
      const starters = names.filter((_, i) => Boolean(mask & (1 << i)));
      const hopt = mask & 8 ? ['A', 'B'] : [];
      const pairs: Array<[string, string]> = mask & 16 ? [['A', 'B'], ['B', 'C']] : [['A', 'C']];
      const input: EngineInput = {
        deckSize: deck.length,
        types: names.map((name) => ({ copies: 2, isHopt: hopt.includes(name), isStarter: starters.includes(name), categories: [] })),
        edges: pairs.map(([a, b]) => [names.indexOf(a), names.indexOf(b)]),
        categories: [],
      };
      for (const size of [5, 6]) {
        const hands = physicalHands(deck.length, size);
        const starts = new Array<number>(size + 1).fill(0);
        const redundancy = new Map<number, number>();
        for (const hand of hands) {
          const result = theoreticalStarts(hand.map((i) => deck[i]), starters, pairs, hopt);
          starts[result.starts]++;
          redundancy.set(result.redundancy, (redundancy.get(result.redundancy) ?? 0) + 1);
        }
        const actual = computePass(input, size);
        expect(actual.total).toBe(hands.length);
        starts.forEach((count, i) => expect(actual.startsExact[i] ?? 0).toBeCloseTo(count / hands.length, 12));
        const maxRedundancy = Math.max(actual.redundancy.length - 1, ...redundancy.keys());
        for (let i = 0; i <= maxRedundancy; i++) {
          expect(actual.redundancy[i] ?? 0).toBeCloseTo((redundancy.get(i) ?? 0) / hands.length, 12);
        }
      }
    }
  });
});
