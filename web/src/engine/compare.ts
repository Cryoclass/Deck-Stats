import type { EngineInput, PassResult } from './types.js';

// ─── Comparateur de decks — matrice Starts × Non-Engine (spec comparateur §4–§7) ───
//
// Couche PURE au-dessus du moteur : on compare deux `PassResult` par scénario, sans
// jamais refaire le calcul. Toutes les valeurs sont EXACTES en [0,1] ; l'arrondi à
// une décimale est un choix d'affichage — agrégats et deltas se calculent toujours
// sur les valeurs exactes (règle impérative de la spec, §4).

export type Scenario = 'going_first' | 'going_second';

export const SCENARIOS: Scenario[] = ['going_first', 'going_second'];

export interface ComparisonMatrix {
  scenario: Scenario;
  handSize: number; // 5 | 6
  deckSize: number;
  starterCount: number; // S affiché sous la matrice (§9) — copies starter vivantes du scénario
  nonEngineCount: number; // N affiché — copies portant ≥1 catégorie pertinente du scénario
  rowLabels: string[]; // ['0','1','2','≥3']
  colLabels: string[]; // ['0'..'5'] (GF) | ['0'..'4','5+'] (GS)
  cells: number[][]; // 4 × 6, probabilités exactes en [0,1], somme = 1
}

export interface ComparisonDeck {
  name: string;
  matrices: Record<Scenario, ComparisonMatrix>;
}

export type WarningSeverity = 'error' | 'warning' | 'info';

export interface ComparisonWarning {
  severity: WarningSeverity;
  code: string;
  scenario?: Scenario;
  message: string;
}

export interface AggregateRow {
  key: string;
  label: string;
  valueA: number;
  valueB: number;
  delta: number; // B − A, exact
  direction: 'higher_is_better' | 'lower_is_better';
  unit: 'percent' | 'count';
}

export interface DeckComparison {
  deckA: ComparisonDeck;
  deckB: ComparisonDeck;
  deltas: Record<Scenario, number[][]>; // B − A, en [0,1]
  aggregates: Record<Scenario, AggregateRow[]>;
  warnings: ComparisonWarning[];
}

export const ROW_LABELS = ['0', '1', '2', '≥3'];
export const NUM_COLS = 6;

/** Poids « plancher » des seaux plafonnés (spec §6.1 / §10) : ≥3 compté = 3, 5+ = 5.
 *  Tableaux explicites — on ne parse JAMAIS un label comme un nombre. */
export const ROW_WEIGHTS = [0, 1, 2, 3];
export const COL_WEIGHTS = [0, 1, 2, 3, 4, 5];

const colLabelsFor = (scenario: Scenario): string[] =>
  scenario === 'going_first' ? ['0', '1', '2', '3', '4', '5'] : ['0', '1', '2', '3', '4', '5+'];

/** S et N par scénario, depuis l'entrée moteur (§9). S = copies starter non mortes
 *  pour la passe ; N = copies portant au moins une catégorie pertinente (les cartes
 *  mortes restent comptées côté non-engine : « dead » ne régit que les starts). */
export function scenarioCounts(
  input: EngineInput,
  scenario: Scenario,
): { starterCount: number; nonEngineCount: number } {
  const first = scenario === 'going_first';
  const relevant = input.categories.map(
    (c) => c.relevance === 'both' || c.relevance === (first ? 'first' : 'second'),
  );
  let s = 0;
  let n = 0;
  for (const t of input.types) {
    const dead = first ? t.deadFirst : t.deadSecond;
    if (t.isStarter && !dead) s += t.copies;
    if (t.categories.some((c) => relevant[c])) n += t.copies;
  }
  return { starterCount: s, nonEngineCount: n };
}

/**
 * Normalise le `crossMatrix` d'une passe en matrice 4 × 6 aux seaux fixes :
 * lignes 0/1/2/≥3 (déjà plafonnées par le moteur), colonnes 0..5 avec la dernière
 * colonne = Σ des totaux non-engine ≥ 5 (« 5+ » going second, main de 6).
 */
export function toComparisonMatrix(
  pass: PassResult,
  scenario: Scenario,
  counts: { starterCount: number; nonEngineCount: number },
): ComparisonMatrix {
  const cells: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const src = pass.crossMatrix[i] ?? [];
    const row = new Array<number>(NUM_COLS).fill(0);
    for (let j = 0; j < src.length; j++) {
      row[Math.min(j, NUM_COLS - 1)] += src[j] ?? 0;
    }
    cells.push(row);
  }
  return {
    scenario,
    handSize: pass.handSize,
    deckSize: pass.deckSize,
    starterCount: counts.starterCount,
    nonEngineCount: counts.nonEngineCount,
    rowLabels: [...ROW_LABELS],
    colLabels: colLabelsFor(scenario),
    cells,
  };
}

/** Marges lignes R[i] = Σⱼ M[i][j]. */
export function rowMargins(cells: number[][]): number[] {
  return cells.map((row) => row.reduce((s, v) => s + v, 0));
}

/** Marges colonnes C[j] = Σᵢ M[i][j]. */
export function colMargins(cells: number[][]): number[] {
  const out = new Array<number>(NUM_COLS).fill(0);
  for (const row of cells) for (let j = 0; j < NUM_COLS; j++) out[j] += row[j] ?? 0;
  return out;
}

const sumCells = (cells: number[][]): number =>
  cells.reduce((s, row) => s + row.reduce((r, v) => r + v, 0), 0);

/** Somme des cellules i ≥ i0 et j ≥ j0. */
const tailSum = (cells: number[][], i0: number, j0: number): number => {
  let s = 0;
  for (let i = i0; i < cells.length; i++)
    for (let j = j0; j < NUM_COLS; j++) s += cells[i][j] ?? 0;
  return s;
};

interface AggregateDef {
  key: string;
  label: string;
  direction: AggregateRow['direction'];
  unit: AggregateRow['unit'];
  compute: (cells: number[][]) => number;
}

// Mêmes définitions que l'onglet Synthèse de l'export : sommes de cellules, jamais
// « 1 − x » — robustes à une matrice dont la somme n'est pas rigoureusement 1.
// Les deux moyennes sont des PLANCHERS (seaux ≥3 / 5+), le libellé le dit (§6.1).
export const AGGREGATE_DEFS: AggregateDef[] = [
  {
    key: 'brick_starters',
    label: 'Brick starters (0 start)',
    direction: 'lower_is_better',
    unit: 'percent',
    compute: (m) => rowMargins(m)[0],
  },
  {
    key: 'starters_ge1',
    label: '≥1 start',
    direction: 'higher_is_better',
    unit: 'percent',
    compute: (m) => tailSum(m, 1, 0),
  },
  {
    key: 'starters_ge2',
    label: '≥2 starts',
    direction: 'higher_is_better',
    unit: 'percent',
    compute: (m) => tailSum(m, 2, 0),
  },
  {
    key: 'starters_ge3',
    label: '≥3 starts',
    direction: 'higher_is_better',
    unit: 'percent',
    compute: (m) => tailSum(m, 3, 0),
  },
  {
    key: 'ne_zero',
    label: '0 non-engine',
    direction: 'lower_is_better',
    unit: 'percent',
    compute: (m) => colMargins(m)[0],
  },
  {
    key: 'ne_ge1',
    label: '≥1 non-engine',
    direction: 'higher_is_better',
    unit: 'percent',
    compute: (m) => tailSum(m, 0, 1),
  },
  {
    key: 'ne_ge2',
    label: '≥2 non-engine',
    direction: 'higher_is_better',
    unit: 'percent',
    compute: (m) => tailSum(m, 0, 2),
  },
  {
    key: 'ne_ge3',
    label: '≥3 non-engine',
    direction: 'higher_is_better',
    unit: 'percent',
    compute: (m) => tailSum(m, 0, 3),
  },
  {
    key: 'playable',
    label: 'Zone jouable : ≥1 start ET ≥1 non-engine',
    direction: 'higher_is_better',
    unit: 'percent',
    compute: (m) => tailSum(m, 1, 1),
  },
  {
    key: 'strong_hand',
    label: 'Main forte : ≥2 starts ET ≥2 non-engine',
    direction: 'higher_is_better',
    unit: 'percent',
    compute: (m) => tailSum(m, 2, 2),
  },
  {
    key: 'mean_starters',
    label: 'Moyenne starts (plancher, ≥3 compté = 3)',
    direction: 'higher_is_better',
    unit: 'count',
    compute: (m) => rowMargins(m).reduce((s, r, i) => s + r * ROW_WEIGHTS[i], 0),
  },
  {
    key: 'mean_ne',
    label: 'Moyenne non-engine (plancher, 5+ compté = 5)',
    direction: 'higher_is_better',
    unit: 'count',
    compute: (m) => colMargins(m).reduce((s, c, j) => s + c * COL_WEIGHTS[j], 0),
  },
];

const SUM_TOL = 1e-9; // §7.1 : au-delà, c'est un bug de calcul, pas du bruit flottant
const EQ_TOL = 1e-9; // égalité de marges / de cellules sur valeurs exactes
const scenarioFr = (s: Scenario): string => (s === 'going_first' ? 'going first' : 'going second');

/**
 * Assemble la comparaison complète : deltas cellule à cellule (B − A), agrégats
 * comparés et garde-fous (§7). Jette si les seaux d'A et B diffèrent (§7.2 — on
 * refuse d'aligner à l'aveugle) ; les autres anomalies partent dans `warnings`,
 * une somme de matrice fausse étant marquée `severity: 'error'` (§7.1).
 */
export function compareDecks(deckA: ComparisonDeck, deckB: ComparisonDeck): DeckComparison {
  const warnings: ComparisonWarning[] = [];
  const deltas = {} as Record<Scenario, number[][]>;
  const aggregates = {} as Record<Scenario, AggregateRow[]>;

  for (const sc of SCENARIOS) {
    const A = deckA.matrices[sc];
    const B = deckB.matrices[sc];
    if (
      A.rowLabels.join('|') !== B.rowLabels.join('|') ||
      A.colLabels.join('|') !== B.colLabels.join('|')
    ) {
      throw new Error(
        `Comparaison impossible (${scenarioFr(sc)}) : les seaux des deux matrices diffèrent.`,
      );
    }

    for (const [deck, m] of [
      [deckA.name, A],
      [deckB.name, B],
    ] as const) {
      const sum = sumCells(m.cells);
      if (Math.abs(sum - 1) > SUM_TOL) {
        warnings.push({
          severity: 'error',
          code: 'matrix_sum',
          scenario: sc,
          message: `La matrice de « ${deck} » (${scenarioFr(sc)}) somme à ${(sum * 100).toFixed(3)} % au lieu de 100 % — bug de calcul en amont.`,
        });
      }
    }

    deltas[sc] = A.cells.map((row, i) => row.map((v, j) => (B.cells[i][j] ?? 0) - v));
    aggregates[sc] = AGGREGATE_DEFS.map((def) => {
      const valueA = def.compute(A.cells);
      const valueB = def.compute(B.cells);
      return {
        key: def.key,
        label: def.label,
        valueA,
        valueB,
        delta: valueB - valueA,
        direction: def.direction,
        unit: def.unit,
      };
    });

    // §7.4 adapté au moteur réel : les « starts » viennent d'un couplage (combos,
    // prérequis, dead par scénario), pas d'un simple comptage S — l'égalité des
    // marges n'est donc pas une équation en (S, D, h). On compare les marges
    // observées et on explique ce qu'elles disent.
    const rA = rowMargins(A.cells);
    const rB = rowMargins(B.cells);
    const marginsEqual = rA.every((v, i) => Math.abs(v - rB[i]) <= EQ_TOL);
    if (marginsEqual) {
      warnings.push({
        severity: 'info',
        code: 'margins_equal',
        scenario: sc,
        message: `${scenarioFr(sc)} : le profil de starts est identique entre les deux decks — seule la répartition non-engine bouge.`,
      });
    } else if (
      A.starterCount === B.starterCount &&
      A.deckSize === B.deckSize &&
      A.starterCount > 0
    ) {
      warnings.push({
        severity: 'info',
        code: 'margins_differ_same_s',
        scenario: sc,
        message: `${scenarioFr(sc)} : même nombre de copies starter (S = ${A.starterCount}) mais profil de starts différent — l'écart vient des combos, prérequis ou cartes mortes, pas du compte de starters.`,
      });
    }
  }

  const dA = deckA.matrices.going_first.deckSize;
  const dB = deckB.matrices.going_first.deckSize;
  if (dA !== dB) {
    warnings.push({
      severity: 'warning',
      code: 'deck_size',
      message: `Tailles de deck différentes (${dA} vs ${dB}) : la comparaison reste valide mais les probabilités ne jouent pas à armes égales.`,
    });
  }

  const identical = SCENARIOS.every((sc) =>
    deltas[sc].every((row) => row.every((d) => Math.abs(d) <= EQ_TOL)),
  );
  if (identical) {
    warnings.push({
      severity: 'info',
      code: 'identical',
      message: 'Les deux decks produisent des matrices identiques — rien à comparer.',
    });
  }

  return { deckA, deckB, deltas, aggregates, warnings };
}
