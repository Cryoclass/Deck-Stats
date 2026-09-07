import { describe, expect, it } from 'vitest';
import { choose, roundRatio, windows, type Position, type Profile } from './oracle.js';
import {
  enumerateExact, potentialOf, tally, toEngineInput, withOneCopyReplaced,
  type ExactOutcome, type OracleSpec,
} from './deckOracle.js';
import { frequency, simulate, tolerance, type Simulation } from './monteCarlo.js';
import { computeAll, computePass } from '../enumerate.js';
import { evaluate, prepare } from '../evaluate.js';
import { buildScorer, evaluateHands } from '../hand.js';
import { handContext, queryProbability, subjectValue, type QueryCriterion } from '../query.js';
import { scenarioCounts, toComparisonMatrix } from '../compare.js';
import type { AnalysisContext, EngineInput, EngineType, PassResult } from '../types.js';

// Étape 5A — chronologie premier/second, profils, plafonds, conditions ET/OU.
// Les IDs renvoient à docs/cas-reference.md. Les fractions sont exactes (bigint) ;
// la comparaison moteur/oracle tolère seulement la normalisation flottante (1e-12).

const T = (over: Partial<EngineType> = {}): EngineType => ({ copies: 1, isHopt: false, isStarter: false, categories: [], ...over });
const ratio = (num: bigint, den: bigint): number => Number(num) / Number(den);
const contexts: AnalysisContext[] = ['first', 'second'];
const positionOf = (c: AnalysisContext): Position => c;
const ge = (dist: number[], n: number): number => dist.reduce((s, p, i) => (i >= n ? s + (p ?? 0) : s), 0);
const crit = (subject: QueryCriterion['subject'], min: number | null, max: number | null): QueryCriterion => ({ id: 'c', subject, min, max });

describe('Référence P — espace des issues chronologiques dans le moteur', () => {
  it('P06 : second = C(D,5)·(D−5) issues pondérées, poids entiers ; premier = C(D,5)', () => {
    const input: EngineInput = { deckSize: 7, types: [T({ copies: 1, isStarter: true })], edges: [], categories: [] };
    const first = computePass(input, 'first');
    const second = computePass(input, 'second');
    expect([first.total, first.outcomes]).toEqual([21, 21]);
    expect([second.total, second.outcomes]).toEqual([7, 42]); // C(7,6) mains distinctes, 6 origines chacune
    expect(second.buckets.reduce((s, b) => s + (b.weight ?? 0), 0)).toBe(42);
    expect(second.buckets.every((b) => Number.isInteger(b.weight))).toBe(true);
    const big = computePass({ ...input, deckSize: 40 }, 'second');
    expect(big.outcomes).toBe(Number(choose(40, 5) * 35n));
    expect(big.outcomes).toBe(6 * Number(choose(40, 6)));
    // D = 5 : une main premier, aucune issue second (P05).
    const five = computePass({ ...input, deckSize: 5 }, 'second');
    expect(five.outcomes).toBe(0);
    expect(five.unavailableReason).toBeTruthy();
    // Les tailles historiques 5/6 restent des synonymes ; tout autre paramètre est refusé.
    expect(computePass(input, 6).outcomes).toBe(42);
    expect(computePass(input, 4).unavailableReason).toMatch(/Contexte/);
  });
});

describe('Référence N — profils, sixième carte et plafonds (moteur)', () => {
  const profiled = (profile: Profile, over: Partial<EngineType> = {}): EngineInput => ({
    deckSize: 40,
    types: [T({ copies: 3, categories: [0], availability: profile, ...over })],
    edges: [],
    categories: [{ id: 'ne' }],
  });

  it('N01 (moteur) : chaque profil suit exactement le tableau des fenêtres de l’oracle', () => {
    const profiles: Profile[] = ['early', 'flexible', 'prepared', 'breaker'];
    for (const profile of profiles) {
      const prep = prepare(profiled(profile, { copies: 1 }));
      expect(evaluate(prep, 'first', [1]).ne).toBe(windows(profile, 'first').length > 0 ? 1 : 0);
      expect(evaluate(prep, 'second', [1], -1).ne).toBe(windows(profile, 'second').length > 0 ? 1 : 0);
      expect(evaluate(prep, 'second', [1], 0).ne).toBe(windows(profile, 'second', true).length > 0 ? 1 : 0);
      // Copies brutes : toujours comptées, sixième incluse, sans fenêtre ni plafond.
      expect(evaluate(prep, 'second', [1], 0).catCounts).toEqual([1]);
    }
  });

  it('N08 : Fuwalos (précoce) initiale vs sixième — piochée mais sans fenêtre', () => {
    const second = computePass(profiled('early'), 'second');
    const first = computePass(profiled('early'), 'first');
    // Potentiel ≥1 en second = Fuwalos parmi les 5 initiales : 222111/658008 (P02).
    expect(ge(second.nonEngine, 1)).toBeCloseTo(ratio(222111n, 658008n), 12);
    // Copies brutes ≥1 parmi les 6 : 1513596/3838380 — la sixième compte comme piochée.
    expect(ge(second.perCategory[0].dist, 1)).toBeCloseTo(ratio(1513596n, 3838380n), 12);
    // L'écart est exactement « première Fuwalos en sixième » (P04) : 1307691/23030280.
    expect(ge(second.perCategory[0].dist, 1) - ge(second.nonEngine, 1)).toBeCloseTo(ratio(1307691n, 23030280n), 12);
    // Jamais déclarée morte : jusqu'à 3 contributions si les trois sont initiales.
    expect(second.nonEngine[3]).toBeCloseTo(ratio(choose(3, 3) * choose(37, 2) * 35n, 23030280n), 12);
    // Premier : aucune fenêtre retenue, potentiel nul, copies brutes intactes.
    expect(first.nonEngine).toEqual([1]);
    expect(ge(first.perCategory[0].dist, 1)).toBeCloseTo(ratio(222111n, 658008n), 12);
  });

  it('N09 : une Ash (flexible HOPT) sur un horizon de deux tours vaut une contribution', () => {
    const second = computePass(profiled('flexible', { isHopt: true }), 'second');
    const first = computePass(profiled('flexible', { isHopt: true }), 'first');
    // Exactement une Ash parmi les 6 (initiale ou sixième) : U = 1, 1307691/3838380.
    expect(second.nonEngine[1]).toBeCloseTo(ratio(1307691n, 3838380n), 12);
    expect(first.nonEngine[1]).toBeCloseTo(ratio(222111n, 658008n), 12);
    expect(first.nonEngine.length).toBe(2); // au plus 1 en premier, quel que soit le nombre de copies
  });

  it('N10 : deux Ash valent deux fenêtres en second, une seule en premier', () => {
    const second = computePass(profiled('flexible', { isHopt: true }), 'second');
    const first = computePass(profiled('flexible', { isHopt: true }), 'first');
    // ≥2 Ash parmi les 6 : 205905/3838380, y compris quand la seconde est la sixième
    // (elle sert au tour propre pendant que l'initiale sert au tour adverse).
    expect(second.nonEngine[2]).toBeCloseTo(ratio(205905n, 3838380n), 12);
    expect(ge(second.nonEngine, 3)).toBe(0); // trois copies : deux tours seulement
    expect(ge(first.nonEngine, 2)).toBe(0);
    // Sans HOPT, chaque copie contribue : ≥2 en premier redevient possible.
    const free = computePass(profiled('flexible'), 'first');
    expect(ge(free.nonEngine, 2)).toBeCloseTo(ratio(3n * choose(37, 3) + choose(37, 2), 658008n), 12);
  });

  it('N11 : plafond Mulcharmy partagé (2 effets par tour), distinct d’un HOPT par nom', () => {
    const mulcharmy = (cap: number, purulia = 3): EngineInput => ({
      deckSize: 40,
      types: [
        T({ copies: 3, categories: [0], availability: 'early', group: 0 }),
        ...(purulia > 0 ? [T({ copies: purulia, categories: [0], availability: 'early', group: 0 })] : []),
      ],
      edges: [],
      categories: [{ id: 'm' }],
      groups: [{ id: 'mulcharmy', capPerTurn: cap }],
    });
    const capped = computePass(mulcharmy(2), 'second');
    // ≥2 des 6 Mulcharmy parmi les 5 initiales : 101496/658008 ; jamais 3.
    expect(capped.nonEngine[2]).toBeCloseTo(ratio(101496n, 658008n), 12);
    expect(ge(capped.nonEngine, 3)).toBe(0);
    const loose = computePass(mulcharmy(3), 'second');
    expect(loose.nonEngine[3]).toBeCloseTo(ratio(11736n, 658008n), 12);
    // Deux copies du même nom comptent sous le plafond : pas « une seule copie par nom ».
    const sameName = computePass(mulcharmy(2, 0), 'second');
    expect(sameName.nonEngine[2]).toBeCloseTo(ratio(3n * choose(37, 3) + choose(37, 2), 658008n), 12);
    // Le plafond se remet à zéro au tour suivant : deux fenêtres, deux fois le plafond.
    const twoTurns: EngineInput = {
      ...mulcharmy(1),
      types: mulcharmy(1).types.map((t) => ({ ...t, availability: 'flexible' as const })),
    };
    const prep = prepare(twoTurns);
    expect(evaluate(prep, 'second', [2, 2], -1).ne).toBe(2);
    expect(evaluate(prep, 'first', [2, 2]).ne).toBe(1);
    // Premier : aucune fenêtre précoce → potentiel nul malgré le plafond.
    expect(computePass(mulcharmy(2), 'first').nonEngine).toEqual([1]);
  });
});

// ─── Spécifications de decks pour les ponts moteur ↔ oracles ───

const SPECS: Record<string, OracleSpec> = {
  'profils, HOPT, plafond partagé, paire et condition OU': {
    deck: ['E', 'E', 'Q', 'F', 'F', 'P', 'K', 'S', 'R', 'W'],
    starters: ['S'],
    hopt: ['F', 'S'],
    pairs: [['R', 'W']],
    profiles: { E: 'early', Q: 'early', F: 'flexible', P: 'prepared', K: 'breaker' },
    labels: { E: ['m'], Q: ['m'], F: ['h'], P: ['h', 't'], K: ['b'] },
    groups: { E: 'mulcharmy', Q: 'mulcharmy' },
    groupCaps: { mulcharmy: 2 },
    starterConditions: { S: { or: [{ card: 'E', atLeast: 1 }, { card: 'Q', atLeast: 1 }] } },
  },
  'conditions ET/OU, paires conditionnées, starts désactivés par position': {
    deck: ['A', 'A', 'B', 'C', 'D', 'T', 'T', 'X', 'X', 'X'],
    starters: ['A'],
    hopt: ['A'],
    pairs: [['B', 'C'], ['A', 'D']],
    starterConditions: { A: { and: [{ card: 'B', atLeast: 1 }, { or: [{ card: 'C', atLeast: 1 }, { card: 'D', atLeast: 1 }] }] } },
    pairConditions: { 'B+C': { card: 'T', atLeast: 2 } },
    deadFirst: ['D'],
    deadSecond: ['C'],
  },
  'catégories recouvrantes, flexible et préparée sous un même plafond': {
    deck: ['F', 'F', 'F', 'P', 'P', 'M', 'S', 'S', 'X', 'X'],
    starters: ['S'],
    hopt: ['F'],
    profiles: { F: 'flexible', P: 'prepared', M: 'early' },
    labels: { F: ['h'], P: ['h', 'q'], M: ['m', 'q'] },
    groups: { F: 'w', P: 'w', M: 'w' },
    groupCaps: { w: 1 },
  },
};

function labelSubsets(labels: string[]): string[][] {
  const out: string[][] = [];
  for (let mask = 1; mask < 1 << labels.length; mask++) out.push(labels.filter((_, i) => mask & (1 << i)));
  return out;
}

/** Distribution oracle exacte d'une valeur, comparée à une distribution moteur normalisée. */
function expectDistribution(engine: number[], exact: ExactOutcome[], value: (o: ExactOutcome) => number, label: string): void {
  const counts = tally(exact, value);
  const max = Math.max(engine.length - 1, ...counts.keys());
  for (let i = 0; i <= max; i++) {
    expect(engine[i] ?? 0, `${label} = ${i}`).toBeCloseTo((counts.get(i) ?? 0) / exact.length, 12);
  }
}

function comparePassToOracle(spec: OracleSpec, context: AnalysisContext): { pass: PassResult; exact: ExactOutcome[] } {
  const fixture = toEngineInput(spec);
  const exact = enumerateExact(spec, positionOf(context));
  const pass = computePass(fixture.input, context);
  const D = spec.deck.length;
  expect(pass.total).toBe(Number(choose(D, context === 'first' ? 5 : 6)));
  expect(pass.outcomes).toBe(exact.length);
  expect(pass.buckets.reduce((s, b) => s + (b.weight ?? 0), 0)).toBe(exact.length);

  expectDistribution(pass.startsExact, exact, (o) => o.result.starts, 'starts');
  expectDistribution(pass.redundancy, exact, (o) => o.result.redundancy, 'redundancy');
  expectDistribution(pass.nonEngine, exact, (o) => o.result.potential, 'U');
  fixture.labels.forEach((label, c) => {
    expectDistribution(pass.perCategory[c].dist, exact, (o) => o.result.catCounts[label] ?? 0, `raw ${label}`);
  });

  // Matrice starts × non-engine : mêmes seaux que le comparateur (≥3 ; 5+ en second).
  const scenario = context === 'first' ? 'going_first' : 'going_second';
  const matrix = toComparisonMatrix(pass, scenario, scenarioCounts(fixture.input, scenario));
  for (let r = 0; r < 4; r++) {
    for (let col = 0; col < 6; col++) {
      const count = exact.filter((o) => Math.min(o.result.starts, 3) === r && Math.min(o.result.potential, 5) === col).length;
      expect(matrix.cells[r][col], `matrice [${r}][${col}]`).toBeCloseTo(count / exact.length, 12);
    }
  }

  // Requêtes : potentiel de chaque catégorie et de chaque union, mesuré sous les mêmes
  // plafonds (non additif), pour chaque valeur possible.
  for (const subset of labelSubsets(fixture.labels)) {
    const subject: QueryCriterion['subject'] = subset.length === 1
      ? { kind: 'category', categoryId: subset[0] }
      : { kind: 'group', categoryIds: subset };
    const counts = tally(exact, (o) => potentialOf(spec, o.result, subset));
    for (let n = 0; n <= 6; n++) {
      const p = queryProbability(pass, [crit(subject, n, n)]);
      expect(p, `potentiel {${subset.join(',')}} = ${n}`).toBeCloseTo((counts.get(n) ?? 0) / exact.length, 12);
    }
  }
  const all = tally(exact, (o) => o.result.potential);
  for (let n = 0; n <= 6; n++) {
    expect(queryProbability(pass, [crit({ kind: 'nonengine' }, n, n)])).toBeCloseTo((all.get(n) ?? 0) / exact.length, 12);
  }
  return { pass, exact };
}

describe('Pont B02 — moteur contre énumération physique exhaustive (toutes les règles)', () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    for (const context of contexts) {
      it(`${name} — ${context} : distributions, matrice, requêtes`, () => {
        comparePassToOracle(spec, context);
      });
    }

    it(`${name} — mur de mains : chaque issue physique est notée avec les mêmes règles`, () => {
      const fixture = toEngineInput(spec);
      const prep = prepare(fixture.input);
      const typeIndexByCardId = new Map(fixture.names.map((n, i) => [fixture.cardIdOf(n), i]));
      for (const context of contexts) {
        const { pass, exact } = comparePassToOracle(spec, context);
        const importance = 0.5;
        const scorer = buildScorer(pass, importance);
        const hands = exact.map((o) => [...o.opening, ...(o.sixth === null ? [] : [o.sixth])].map(fixture.cardIdOf));
        const noted = evaluateHands({ hands, typeIndexByCardId, prep, context, scorer });
        expect(noted).toHaveLength(exact.length);
        const score = (o: ExactOutcome) => 100 * o.result.starts + importance * o.result.potential;
        noted.forEach((hand, i) => {
          const o = exact[i];
          expect(hand.starts).toBe(o.result.starts);
          expect(hand.redundancy).toBe(o.result.redundancy);
          expect(hand.neTotal).toBe(o.result.potential);
          for (const subset of labelSubsets(fixture.labels)) {
            const subject: QueryCriterion['subject'] = subset.length === 1
              ? { kind: 'category', categoryId: subset[0] }
              : { kind: 'group', categoryIds: subset };
            expect(subjectValue(subject, handContext(hand, pass.neSignatures))).toBe(potentialOf(spec, o.result, subset));
          }
          // Note /10 : percentile exact sur les issues (starts d'abord, non-engine en départage).
          const s = score(o);
          let below = 0n;
          let equal = 0n;
          for (const other of exact) {
            const t = score(other);
            if (t < s) below++;
            else if (t === s) equal++;
          }
          expect(hand.note).toBe(Number(roundRatio(10n * (2n * below + equal), 2n * BigInt(exact.length))));
        });
      }
    });

    it(`${name} — contributions marginales : copie remplacée par une neutre, par contexte`, () => {
      const fixture = toEngineInput(spec);
      const result = computeAll(fixture.input);
      const pStart = (s: OracleSpec, context: AnalysisContext) => {
        const exact = enumerateExact(s, positionOf(context));
        return exact.filter((o) => o.result.starts >= 1).length / exact.length;
      };
      fixture.names.forEach((cardName, i) => {
        if (fixture.input.types[i].copies === 0) return;
        const reduced = withOneCopyReplaced(spec, cardName);
        for (const context of contexts) {
          expect(result.deltas[i][context], `delta ${cardName} ${context}`).toBeCloseTo(pStart(spec, context) - pStart(reduced, context), 12);
        }
      });
    });
  }

  it('N12 : catégories recouvrantes — un sous-ensemble mesure son propre potentiel, la somme peut dépasser l’union', () => {
    const spec = SPECS['catégories recouvrantes, flexible et préparée sous un même plafond'];
    const { pass } = comparePassToOracle(spec, 'second');
    const mean = (subject: QueryCriterion['subject']) => {
      let e = 0;
      for (let n = 0; n <= 6; n++) e += n * (queryProbability(pass, [crit(subject, n, n)]) ?? 0);
      return e;
    };
    const h = mean({ kind: 'category', categoryId: 'h' });
    const q = mean({ kind: 'category', categoryId: 'q' });
    const union = mean({ kind: 'group', categoryIds: ['h', 'q'] });
    expect(union).toBeGreaterThan(0);
    expect(union).toBeLessThan(h + q); // P porte h et q : dédupliquée ; plafond w partagé
    expect(union).toBeLessThanOrEqual(mean({ kind: 'nonengine' }) + 1e-12);
  });
});

describe('Référence C — conditions ET/OU sur le deck restant (moteur et oracle)', () => {
  it('C05 : une alternative OU satisfaite deux fois compte une seule fois', () => {
    const spec: OracleSpec = {
      deck: ['A', 'A', 'C', 'D', 'X', 'X', 'X', 'X'],
      starters: ['A'],
      starterConditions: { A: { or: [{ card: 'C', atLeast: 1 }, { card: 'D', atLeast: 1 }] } },
    };
    const { pass } = comparePassToOracle(spec, 'first');
    expect(pass.startsExact[1]).toBeCloseTo(18 / 56, 12);
    expect(pass.startsExact[2]).toBeCloseTo(16 / 56, 12);
    expect(ge(pass.startsExact, 1)).toBeCloseTo(34 / 56, 12);
    expect(ge(pass.startsExact, 3)).toBe(0); // deux copies de A : jamais plus de deux starts
    // Répéter « C ≥ 1 » ne devient pas « C ≥ 2 » ; ET vide ou quantité nulle refusés.
    const prep = prepare(toEngineInput({ ...spec, starterConditions: { A: { and: [{ card: 'C', atLeast: 1 }, { card: 'C', atLeast: 1 }] } } }).input);
    expect(evaluate(prep, 'first', [1, 0, 0]).starts).toBe(1);
    for (const bad of [{ kind: 'and', all: [] }, { kind: 'or', any: [] }, { kind: 'remaining', type: 1, atLeast: 0 }, { kind: 'unless', type: 1 }, { kind: 'remaining', type: 9, atLeast: 1 }]) {
      const input = toEngineInput(spec).input;
      input.types[0].starterCondition = bad as never;
      expect(() => computePass(input, 'first'), JSON.stringify(bad)).toThrow(/Condition de start invalide/);
    }
  });

  it('C06 : condition évaluée sur 5 cartes en premier, sur 5 + sixième en second', () => {
    const spec: OracleSpec = {
      deck: ['A', 'B', 'X', 'X', 'X', 'X', 'X'],
      starters: ['A'],
      starterConditions: { A: { card: 'B', atLeast: 1 } },
    };
    const first = comparePassToOracle(spec, 'first').pass;
    const second = comparePassToOracle(spec, 'second').pass;
    expect(ge(first.startsExact, 1)).toBeCloseTo(5 / 21, 12); // A parmi les 5, B restant
    expect(ge(second.startsExact, 1)).toBeCloseTo(6 / 42, 12); // les 6 = A + cinq X, six origines
    // C04 : D = 6, B seul restant après les 5 initiales, piochée en sixième → faux.
    const six: OracleSpec = { ...spec, deck: ['A', 'B', 'X', 'Y', 'Z', 'W'] };
    expect(ge(comparePassToOracle(six, 'first').pass.startsExact, 1)).toBeCloseTo(1 / 6, 12);
    expect(ge(comparePassToOracle(six, 'second').pass.startsExact, 1)).toBe(0);
  });
});

// ─── Oracle Monte Carlo : tirages réels à graine fixe ───

const SAMPLES = 1_000_000;

function expectSimulationClose(sim: Simulation, exactP: (predicate: (o: { starts: number; potential: number }) => boolean) => number, label: string): void {
  const predicates: Array<[string, (o: { starts: number; potential: number }) => boolean]> = [];
  for (let s = 0; s <= 3; s++) predicates.push([`S=${s}`, (o) => o.starts === s]);
  predicates.push(['S≥3', (o) => o.starts >= 3]);
  for (let u = 0; u <= 6; u++) predicates.push([`U=${u}`, (o) => o.potential === u]);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
    predicates.push([`cell ${r},${c}`, (o) => Math.min(o.starts, 3) === r && Math.min(o.potential, 5) === c]);
  }
  for (const [name, predicate] of predicates) {
    const p = exactP(predicate);
    const observed = frequency(sim, predicate);
    expect(Math.abs(observed - p), `${label} ${name} : ${observed} vs ${p}`).toBeLessThanOrEqual(tolerance(p, sim.samples));
  }
}

describe('Pont B03 — Monte Carlo (graine fixe, 10⁶ mains) contre énumération et moteur', () => {
  const spec = SPECS['profils, HOPT, plafond partagé, paire et condition OU'];
  for (const context of contexts) {
    it(`${context} : écart sous cinq erreurs types + cinq tirages, jamais ajusté`, () => {
      const exact = enumerateExact(spec, positionOf(context));
      const pass = computePass(toEngineInput(spec).input, context);
      const sim = simulate(spec, positionOf(context), SAMPLES, 20260907);
      expect(sim.samples).toBe(SAMPLES);
      // Contre l'énumération physique.
      expectSimulationClose(sim, (pred) => exact.filter((o) => pred(o.result)).length / exact.length, 'exact');
      // Contre le moteur, dont les buckets portent starts et potentiel.
      expectSimulationClose(sim, (pred) => pass.buckets.reduce((s, b) => (pred({ starts: b.starts, potential: b.neTotal }) ? s + b.p : s), 0), 'engine');
    });
  }
});

describe('Pont B04 — deck de 40 cartes : Monte Carlo contre le moteur (hors portée de l’énumération physique)', () => {
  const spec: OracleSpec = {
    deck: [
      ...Array(3).fill('Ash'), ...Array(3).fill('Fuwalos'), ...Array(2).fill('Purulia'),
      ...Array(3).fill('Imperm'), ...Array(2).fill('Nibiru'), ...Array(3).fill('S'),
      ...Array(2).fill('T'), 'U', ...Array(3).fill('R'), ...Array(2).fill('Q'),
      ...Array(16).fill('X'),
    ],
    starters: ['S'],
    hopt: ['Ash', 'S', 'Imperm'],
    pairs: [['R', 'Q']],
    profiles: { Ash: 'flexible', Fuwalos: 'early', Purulia: 'early', Imperm: 'prepared', Nibiru: 'breaker' },
    labels: { Ash: ['h'], Fuwalos: ['m'], Purulia: ['m'], Imperm: ['h', 't'], Nibiru: ['b'] },
    groups: { Fuwalos: 'mulcharmy', Purulia: 'mulcharmy' },
    groupCaps: { mulcharmy: 2 },
    starterConditions: { S: { or: [{ card: 'T', atLeast: 1 }, { card: 'U', atLeast: 1 }] } },
    pairConditions: { 'Q+R': { card: 'T', atLeast: 1 } },
    deadFirst: ['Q'],
  };
  expect(spec.deck).toHaveLength(40);
  for (const context of contexts) {
    it(`${context} : 40 cartes, 10⁶ mains, starts, potentiel et matrice`, () => {
      const fixture = toEngineInput(spec);
      const pass = computePass(fixture.input, context);
      expect(pass.outcomes).toBe(Number(context === 'first' ? choose(40, 5) : choose(40, 5) * 35n));
      const sim = simulate(spec, positionOf(context), SAMPLES, 5_0907);
      expectSimulationClose(sim, (pred) => pass.buckets.reduce((s, b) => (pred({ starts: b.starts, potential: b.neTotal }) ? s + b.p : s), 0), 'engine');
      // Potentiel par catégorie (requête) contre la fréquence observée.
      for (const subset of [['h'], ['m'], ['h', 'm'], ['h', 't', 'b']]) {
        for (let n = 0; n <= 4; n++) {
          const subject: QueryCriterion['subject'] = subset.length === 1 ? { kind: 'category', categoryId: subset[0] } : { kind: 'group', categoryIds: subset };
          const p = queryProbability(pass, [crit(subject, n, n)]) ?? 0;
          const observed = frequency(sim, (o) => potentialOf(spec, o, subset) === n);
          expect(Math.abs(observed - p), `{${subset.join(',')}} = ${n}`).toBeLessThanOrEqual(tolerance(p, sim.samples));
        }
      }
    });
  }
});

// Questions ouvertes de l'étape 5A, tranchées le 7 septembre 2026 (docs/etape-5a.md,
// « Réponses ») : Q1, Q2 et Q4 confirment l'interprétation conservatrice ; Q3 remplace
// la combinaison par ET par un refus explicite (une seule représentation par source).
describe('Questions Q1–Q4 tranchées (étape 5B)', () => {
  it('Q1 : une carte profilée sans étiquette n’apporte aucune contribution', () => {
    const prep = prepare({ deckSize: 40, types: [T({ copies: 3, availability: 'flexible' })], edges: [], categories: [] });
    expect(evaluate(prep, 'second', [2], -1).ne).toBe(0);
  });

  it('Q2 : un plafond de groupe sur une carte sans profil est refusé, pas ignoré', () => {
    const input: EngineInput = {
      deckSize: 40,
      types: [T({ copies: 3, categories: [0], group: 0 })],
      edges: [],
      categories: [{ id: 'm' }],
      groups: [{ id: 'g', capPerTurn: 2 }],
    };
    expect(() => computePass(input, 'first')).toThrow(/sans profil/);
    expect(() => computePass({ ...input, groups: [{ id: 'g', capPerTurn: 0 }] }, 'first')).toThrow(/Plafond/);
  });

  it('Q3 : une source portant anciens prérequis ET condition ET/OU est refusée (une seule représentation)', () => {
    const legacy: EngineType = T({ isStarter: true, starterPrereqs: [{ requiredType: 1, requiredTotal: 1, minInDeck: 1 }] });
    const modern: EngineType = T({ isStarter: true, starterCondition: { kind: 'remaining', type: 1, atLeast: 1 } });
    const both: EngineType = { ...legacy, starterCondition: modern.starterCondition };
    const make = (t: EngineType): EngineInput => ({ deckSize: 40, types: [t, T()], edges: [], categories: [] });
    // Chaque représentation seule reste évaluable, avec le même résultat.
    expect(evaluate(prepare(make(legacy)), 'first', [1, 1]).starts).toBe(0);
    expect(evaluate(prepare(make(modern)), 'first', [1, 1]).starts).toBe(0);
    expect(evaluate(prepare(make(modern)), 'first', [1, 0]).starts).toBe(1);
    expect(() => prepare(make(both))).toThrow(/une seule représentation/);
    // Idem pour une arête.
    const edgeInput: EngineInput = {
      deckSize: 40,
      types: [T(), T(), T()],
      edges: [[0, 1]],
      edgePrereqs: [[{ requiredType: 2, requiredTotal: 1, minInDeck: 1 }]],
      edgeConditions: [{ kind: 'remaining', type: 2, atLeast: 1 }],
      categories: [],
    };
    expect(() => computePass(edgeInput, 'first')).toThrow(/une seule représentation/);
  });

  it('Q4/Q5 : les étiquettes n’ont plus de pertinence par contexte ; sans profil, aucune contribution retenue', () => {
    const prep = prepare({
      deckSize: 40,
      types: [T({ categories: [0], availability: 'flexible' }), T({ categories: [0] })],
      edges: [],
      categories: [{ id: 'first-only' }],
    });
    expect(evaluate(prep, 'second', [1, 0], -1).ne).toBe(1); // profilée : compte en second
    expect(evaluate(prep, 'second', [0, 1], -1).ne).toBe(0); // étiquetée sans profil : zéro (Q5)
    expect(evaluate(prep, 'second', [0, 1], -1).catCounts).toEqual([1]); // mais piochée
  });
});
