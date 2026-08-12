import { describe, it, expect } from 'vitest';
import { computePass } from './enumerate.js';
import {
  compareDecks,
  scenarioCounts,
  toComparisonMatrix,
  rowMargins,
  type ComparisonDeck,
  type ComparisonMatrix,
  type Scenario,
} from './compare.js';
import type { EngineInput, EngineType } from './types.js';

const T = (over: Partial<EngineType> = {}): EngineType => ({
  copies: 1,
  isHopt: false,
  isStarter: false,
  categories: [],
  ...over,
});

// ─── Fixture spec §11 — Mitsurugi pure (A) vs Orcust (B), valeurs relevées ───
//
// ⚠️ Les tables du §11 sont relevées depuis un affichage arrondi à 0,1 % : leurs
// sommes tombent à 99,8–100,1 %. On NORMALISE chaque matrice (division par sa somme)
// pour retrouver des probabilités propres — le §7.1 exige une somme à 1 sur les
// valeurs exactes — puis on tolère ±0,3 point sur les agrégats, comme demandé.
//
// Note : le §11 affirme aussi que les marges lignes seraient IDENTIQUES entre A et B
// (8.3/33.8/39.5/18.3 going first). C'est contredit par sa propre table d'agrégats
// (brick 9.2 vs 8.3, Δ = −0.9) : ces marges sont celles de B seul. On teste la table
// d'agrégats, qui est cohérente avec les matrices.

const A_GF = [
  [0.2, 1.4, 3.5, 3.1, 0.9, 0.1],
  [1.6, 9.8, 15.6, 7.3, 0.8, 0],
  [4.8, 17.8, 14.4, 2.2, 0, 0],
  [5.8, 8.8, 2.0, 0, 0, 0],
];
const A_GS = [
  [0, 0.1, 0.5, 1.3, 1.9, 1.2],
  [0.1, 1.3, 5.4, 10.1, 8.0, 1.4],
  [0.7, 5.5, 15.5, 15.5, 3.2, 0],
  [2.7, 10.8, 12.0, 2.6, 0, 0],
];
const B_GF = [
  [0.3, 2.0, 3.7, 2.0, 0.3, 0],
  [2.8, 13.0, 13.7, 4.0, 0.3, 0],
  [7.4, 19.7, 11.1, 1.3, 0, 0],
  [7.5, 9.0, 1.8, 0, 0, 0],
];
const B_GS = [
  [0, 0, 0.3, 1.1, 1.8, 1.1],
  [0.1, 1.0, 5.0, 10.0, 7.4, 1.5],
  [0.6, 5.5, 15.5, 14.9, 3.8, 0],
  [2.9, 11.2, 12.5, 3.6, 0, 0],
];

/** % relevés → probabilités normalisées (somme exactement 1). */
function normalized(rowsPct: number[][]): number[][] {
  const total = rowsPct.reduce((s, r) => s + r.reduce((a, v) => a + v, 0), 0);
  return rowsPct.map((r) => r.map((v) => v / total));
}

function mkMatrix(
  scenario: Scenario,
  cells: number[][],
  over: Partial<ComparisonMatrix> = {},
): ComparisonMatrix {
  return {
    scenario,
    handSize: scenario === 'going_first' ? 5 : 6,
    deckSize: 40,
    starterCount: 0,
    nonEngineCount: 0,
    rowLabels: ['0', '1', '2', '≥3'],
    colLabels:
      scenario === 'going_first' ? ['0', '1', '2', '3', '4', '5'] : ['0', '1', '2', '3', '4', '5+'],
    cells,
    ...over,
  };
}

function fixtureDecks(): { deckA: ComparisonDeck; deckB: ComparisonDeck } {
  return {
    deckA: {
      name: 'Mitsurugi pure',
      matrices: {
        going_first: mkMatrix('going_first', normalized(A_GF), { starterCount: 14 }),
        going_second: mkMatrix('going_second', normalized(A_GS), { starterCount: 14 }),
      },
    },
    deckB: {
      name: 'Orcust',
      matrices: {
        going_first: mkMatrix('going_first', normalized(B_GF), { starterCount: 15 }),
        going_second: mkMatrix('going_second', normalized(B_GS), { starterCount: 15 }),
      },
    },
  };
}

// Table d'agrégats attendue (§11) : key → [A GF, B GF, Δ GF, A GS, B GS, Δ GS].
// Valeurs en %, sauf les deux moyennes (unité : cartes).
const EXPECTED: Record<string, [number, number, number, number, number, number]> = {
  brick_starters: [9.2, 8.3, -0.9, 5.0, 4.3, -0.7],
  starters_ge1: [90.9, 91.6, 0.7, 94.8, 95.5, 0.7],
  starters_ge2: [55.8, 57.8, 2.0, 68.5, 70.5, 2.0],
  starters_ge3: [16.6, 18.3, 1.7, 28.1, 30.2, 2.1],
  ne_zero: [12.4, 18.0, 5.6, 3.5, 3.6, 0.1],
  ne_ge1: [87.7, 81.9, -5.8, 96.3, 96.2, -0.1],
  ne_ge2: [49.9, 38.2, -11.7, 78.6, 78.5, -0.1],
  ne_ge3: [14.4, 7.9, -6.5, 45.2, 45.2, 0.0],
  playable: [78.7, 73.9, -4.8, 91.3, 91.9, 0.6],
  strong_hand: [18.6, 14.2, -4.4, 48.8, 50.3, 1.5],
  mean_starters: [1.63, 1.68, 0.04, 1.91, 1.96, 0.05],
  mean_ne: [1.54, 1.29, -0.25, 2.38, 2.38, 0.0],
};

const PCT_TOL = 0.003; // ±0,3 point (spec §11)
const COUNT_TOL = 0.02; // moyennes données à 2 décimales, mêmes sources arrondies

describe('compareDecks — fixture §11 (Mitsurugi vs Orcust)', () => {
  const { deckA, deckB } = fixtureDecks();
  const cmp = compareDecks(deckA, deckB);

  it('reproduit la table d’agrégats complète (±0,3 pt)', () => {
    for (const sc of ['going_first', 'going_second'] as const) {
      const off = sc === 'going_first' ? 0 : 3;
      for (const row of cmp.aggregates[sc]) {
        const exp = EXPECTED[row.key];
        expect(exp, `agrégat inconnu : ${row.key}`).toBeDefined();
        const scale = row.unit === 'percent' ? 100 : 1;
        const tol = row.unit === 'percent' ? PCT_TOL * 100 : COUNT_TOL;
        expect(Math.abs(row.valueA * scale - exp[off]), `${row.key} A ${sc}`).toBeLessThanOrEqual(tol);
        expect(Math.abs(row.valueB * scale - exp[off + 1])).toBeLessThanOrEqual(tol);
        expect(Math.abs(row.delta * scale - exp[off + 2])).toBeLessThanOrEqual(tol);
      }
    }
  });

  it('les 12 agrégats sont présents, dans l’ordre de la spec', () => {
    expect(cmp.aggregates.going_first.map((r) => r.key)).toEqual(Object.keys(EXPECTED));
  });

  it('delta cellule à cellule = B − A sur les valeurs exactes', () => {
    const a = deckA.matrices.going_first.cells[2][1];
    const b = deckB.matrices.going_first.cells[2][1];
    expect(cmp.deltas.going_first[2][1]).toBeCloseTo(b - a, 15);
    // Chaque matrice somme à 1 → la somme des deltas est nulle.
    const sum = cmp.deltas.going_second.flat().reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(0, 12);
  });

  it('matrices normalisées → aucune erreur de somme ; decks distincts → pas de « identical »', () => {
    expect(cmp.warnings.filter((w) => w.code === 'matrix_sum')).toHaveLength(0);
    expect(cmp.warnings.filter((w) => w.code === 'identical')).toHaveLength(0);
    expect(cmp.warnings.filter((w) => w.code === 'deck_size')).toHaveLength(0);
  });

  it('directions de lecture : brick et 0 non-engine sont « plus bas = mieux »', () => {
    const dirs = new Map(cmp.aggregates.going_first.map((r) => [r.key, r.direction]));
    expect(dirs.get('brick_starters')).toBe('lower_is_better');
    expect(dirs.get('ne_zero')).toBe('lower_is_better');
    expect(dirs.get('playable')).toBe('higher_is_better');
  });
});

describe('compareDecks — garde-fous (§7)', () => {
  it('§7.1 : matrice non normalisée → warning bloquant matrix_sum', () => {
    const { deckA, deckB } = fixtureDecks();
    // Somme relevée du §11 : 100,1 % — au-delà de la tolérance 1e-9.
    deckA.matrices.going_first = mkMatrix(
      'going_first',
      A_GF.map((r) => r.map((v) => v / 100)),
    );
    const cmp = compareDecks(deckA, deckB);
    const errs = cmp.warnings.filter((w) => w.code === 'matrix_sum');
    expect(errs).toHaveLength(1);
    expect(errs[0].severity).toBe('error');
    expect(errs[0].scenario).toBe('going_first');
  });

  it('§7.2 : seaux différents → refus explicite', () => {
    const { deckA, deckB } = fixtureDecks();
    deckB.matrices.going_second.colLabels = ['0', '1', '2', '3', '4', '5'];
    expect(() => compareDecks(deckA, deckB)).toThrow(/seaux/);
  });

  it('§7.3 : tailles de deck différentes → simple avertissement', () => {
    const { deckA, deckB } = fixtureDecks();
    deckB.matrices.going_first.deckSize = 60;
    deckB.matrices.going_second.deckSize = 60;
    const cmp = compareDecks(deckA, deckB);
    expect(cmp.warnings.some((w) => w.code === 'deck_size' && w.severity === 'warning')).toBe(true);
  });

  it('§7.4 : marges lignes identiques → note « profil de starts inchangé »', () => {
    const { deckA } = fixtureDecks();
    // B = A avec de la masse déplacée HORIZONTALEMENT (dans une ligne) : les marges
    // lignes sont conservées, seule la distribution non-engine bouge.
    const shift = (cells: number[][]): number[][] => {
      const c = cells.map((r) => [...r]);
      const eps = 0.001;
      c[1][1] -= eps;
      c[1][2] += eps;
      return c;
    };
    const deckB: ComparisonDeck = {
      name: 'Variante',
      matrices: {
        going_first: mkMatrix('going_first', shift(deckA.matrices.going_first.cells), {
          starterCount: 14,
        }),
        going_second: mkMatrix('going_second', shift(deckA.matrices.going_second.cells), {
          starterCount: 14,
        }),
      },
    };
    const cmp = compareDecks(deckA, deckB);
    expect(cmp.warnings.filter((w) => w.code === 'margins_equal')).toHaveLength(2);
  });

  it('§7.4 bis : même S mais marges différentes → note explicative (moteur à combos)', () => {
    const { deckA, deckB } = fixtureDecks();
    for (const sc of ['going_first', 'going_second'] as const) {
      deckA.matrices[sc].starterCount = 15;
      deckB.matrices[sc].starterCount = 15;
    }
    const cmp = compareDecks(deckA, deckB);
    expect(cmp.warnings.filter((w) => w.code === 'margins_differ_same_s').length).toBeGreaterThan(0);
  });

  it('§7.5 : decks identiques → message dédié', () => {
    const { deckA } = fixtureDecks();
    const clone: ComparisonDeck = JSON.parse(JSON.stringify({ ...deckA, name: 'Copie' }));
    const cmp = compareDecks(deckA, clone);
    expect(cmp.warnings.some((w) => w.code === 'identical')).toBe(true);
  });
});

describe('toComparisonMatrix — seaux et normalisation de forme', () => {
  // 7 copies non-engine (3+3+1, catégorie pertinente des deux côtés), aucun starter :
  // going second (main de 6), le total non-engine atteint 6 → la colonne « 5+ »
  // doit agréger P(ne = 5) + P(ne = 6).
  const input: EngineInput = {
    deckSize: 40,
    types: [
      T({ copies: 3, categories: [0] }),
      T({ copies: 3, categories: [0] }),
      T({ copies: 1, categories: [0] }),
    ],
    edges: [],
    categories: [{ id: 'ht', relevance: 'both' }],
  };

  it('going second : colonne 5+ = Σ P(ne ≥ 5), lignes complétées à zéro', () => {
    const pass = computePass(input, 6);
    const m = toComparisonMatrix(pass, 'going_second', scenarioCounts(input, 'going_second'));
    expect(m.colLabels).toEqual(['0', '1', '2', '3', '4', '5+']);
    const expected = (pass.nonEngine[5] ?? 0) + (pass.nonEngine[6] ?? 0);
    expect(m.cells[0][5]).toBeCloseTo(expected, 12);
    // Aucun starter : toute la masse est en ligne 0, les autres lignes existent et sont nulles.
    expect(rowMargins(m.cells)[0]).toBeCloseTo(1, 12);
    expect(m.cells).toHaveLength(4);
    expect(rowMargins(m.cells).slice(1)).toEqual([0, 0, 0]);
    const sum = m.cells.flat().reduce((s, v) => s + v, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('going first : main de 5, colonnes 0..5, somme exacte à 1', () => {
    const pass = computePass(input, 5);
    const m = toComparisonMatrix(pass, 'going_first', scenarioCounts(input, 'going_first'));
    expect(m.colLabels).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(m.handSize).toBe(5);
    const sum = m.cells.flat().reduce((s, v) => s + v, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('scenarioCounts : dead par scénario sort du S mais pas du N', () => {
    const inp: EngineInput = {
      deckSize: 40,
      types: [
        // Fuwalos-like : mort going first, non-engine going second.
        T({ copies: 3, deadFirst: true, categories: [0] }),
        T({ copies: 2, isStarter: true }),
        T({ copies: 1, isStarter: true, deadSecond: true }),
      ],
      edges: [],
      categories: [{ id: 'ht', relevance: 'second' }],
    };
    expect(scenarioCounts(inp, 'going_first')).toEqual({ starterCount: 3, nonEngineCount: 0 });
    expect(scenarioCounts(inp, 'going_second')).toEqual({ starterCount: 2, nonEngineCount: 3 });
  });
});
