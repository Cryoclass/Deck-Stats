import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import {
  compareDecks,
  type ComparisonDeck,
  type ComparisonMatrix,
  type DeckComparison,
  type Scenario,
} from '../engine/compare.js';
import { buildComparisonWorkbook } from './exportComparison.js';

// ─── Fixture synthétique minimale : deux decks aux matrices normalisées (somme 1) ───

function mkMatrix(scenario: Scenario, cells: number[][]): ComparisonMatrix {
  return {
    scenario,
    handSize: scenario === 'going_first' ? 5 : 6,
    deckSize: 40,
    starterCount: 12,
    nonEngineCount: 9,
    rowLabels: ['0', '1', '2', '≥3'],
    colLabels:
      scenario === 'going_first' ? ['0', '1', '2', '3', '4', '5'] : ['0', '1', '2', '3', '4', '5+'],
    cells,
  };
}

const CELLS_A = [
  [0.1, 0.1, 0, 0, 0, 0],
  [0.2, 0.3, 0, 0, 0, 0],
  [0.1, 0.1, 0, 0, 0, 0],
  [0.05, 0.05, 0, 0, 0, 0],
];
const CELLS_B = [
  [0.05, 0.1, 0.05, 0, 0, 0],
  [0.15, 0.3, 0.05, 0, 0, 0],
  [0.1, 0.1, 0, 0, 0, 0],
  [0.05, 0.05, 0, 0, 0, 0],
];

function fixture(): DeckComparison {
  const deckA: ComparisonDeck = {
    name: 'Référence',
    matrices: {
      going_first: mkMatrix('going_first', CELLS_A),
      going_second: mkMatrix('going_second', CELLS_A),
    },
  };
  const deckB: ComparisonDeck = {
    name: 'Variante',
    matrices: {
      going_first: mkMatrix('going_first', CELLS_B),
      going_second: mkMatrix('going_second', CELLS_B),
    },
  };
  return compareDecks(deckA, deckB);
}

describe('export Excel (spec §8) — géométrie et formules du classeur', () => {
  let wb: ExcelJS.Workbook;

  beforeAll(async () => {
    const buffer = await buildComparisonWorkbook(fixture());
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
  });

  it('trois onglets, dans l’ordre : Going First, Going Second, Synthèse', () => {
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Going First', 'Going Second', 'Synthèse']);
  });

  it('données en VALEUR exacte (bleu), totaux en FORMULE', () => {
    const ws = wb.getWorksheet('Going First')!;
    expect(ws.getCell('B6').value).toBe(0.1); // A[0][0]
    expect(ws.getCell('D14').value).toBe(0.05); // B[0][2]
    expect(ws.getCell('B6').numFmt).toBe('0.0%;-0.0%;"·"');
    expect(ws.getCell('B6').font?.color?.argb).toBe('FF1F4E9C');
    // Totaux ligne (H) et colonne (ligne 10) en SUM().
    expect((ws.getCell('H6').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(B6:G6)');
    expect((ws.getCell('B10').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(B6:B9)');
    expect((ws.getCell('H18').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(H14:H17)');
  });

  it('bloc delta : formules =B14-B6 etc., format signé', () => {
    const ws = wb.getWorksheet('Going First')!;
    expect((ws.getCell('B22').value as ExcelJS.CellFormulaValue).formula).toBe('B14-B6');
    expect((ws.getCell('G25').value as ExcelJS.CellFormulaValue).formula).toBe('G17-G9');
    expect(ws.getCell('B22').numFmt).toBe('+0.0%;-0.0%;"·"');
    // Ligne et colonne Total du bloc delta.
    expect((ws.getCell('H22').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(B22:G22)');
    expect((ws.getCell('B26').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(B22:B25)');
  });

  it('going second : dernière colonne étiquetée 5+, going first : 5', () => {
    expect(wb.getWorksheet('Going First')!.getCell('G5').value).toBe('5');
    expect(wb.getWorksheet('Going Second')!.getCell('G5').value).toBe('5+');
    expect(wb.getWorksheet('Going Second')!.getCell('G13').value).toBe('5+');
  });

  it('légende du delta présente sur les onglets scénario (§5)', () => {
    const legend = String(wb.getWorksheet('Going First')!.getCell('A28').value);
    expect(legend).toMatch(/probabilité plus élevée/);
    expect(legend).toMatch(/pas nécessairement meilleur/);
  });

  it('Synthèse : valeurs en formules pointant vers les onglets scénario (vert)', () => {
    const ws = wb.getWorksheet('Synthèse')!;
    expect((ws.getCell('B5').value as ExcelJS.CellFormulaValue).formula).toBe(
      "'Going First'!$H$6",
    );
    expect((ws.getCell('C5').value as ExcelJS.CellFormulaValue).formula).toBe(
      "'Going First'!$H$14",
    );
    expect((ws.getCell('D5').value as ExcelJS.CellFormulaValue).formula).toBe('C5-B5');
    expect((ws.getCell('E6').value as ExcelJS.CellFormulaValue).formula).toBe(
      "SUM('Going Second'!$H$7:$H$9)",
    );
    expect(ws.getCell('B5').font?.color?.argb).toBe('FF107C41');
  });

  it('Synthèse : 12 agrégats, moyennes en plancher avec format 0.00', () => {
    const ws = wb.getWorksheet('Synthèse')!;
    expect(String(ws.getCell('A15').value)).toMatch(/plancher/);
    expect(String(ws.getCell('A16').value)).toMatch(/plancher/);
    expect((ws.getCell('B15').value as ExcelJS.CellFormulaValue).formula).toContain('*3');
    expect((ws.getCell('B16').value as ExcelJS.CellFormulaValue).formula).toContain('*5');
    expect(ws.getCell('B15').numFmt).toBe('0.00');
    expect(ws.getCell('D15').numFmt).toBe('+0.00;-0.00;"·"');
    expect(ws.getCell('H5').value).toBe('↓ plus bas = mieux');
    expect(ws.getCell('H6').value).toBe('↑');
  });

  it('mise en forme conditionnelle : heatmaps A/B + delta, Δ de Synthèse orientés mérite', () => {
    const gf = wb.getWorksheet('Going First')! as unknown as {
      conditionalFormattings: Array<{ ref: string; rules: Array<{ type: string }> }>;
    };
    const refs = gf.conditionalFormattings.map((c) => c.ref);
    expect(refs).toContain('B6:G9');
    expect(refs).toContain('B14:G17');
    expect(refs).toContain('B22:G25');
    const delta = gf.conditionalFormattings.find((c) => c.ref === 'B22:G25')!;
    expect(delta.rules[0].type).toBe('colorScale');

    const synth = wb.getWorksheet('Synthèse')! as unknown as {
      conditionalFormattings: Array<{ ref: string; rules: Array<{ type: string; operator?: string }> }>;
    };
    // 12 lignes × 2 colonnes Δ = 24 plages en règles cellIs (mérite, pas signe brut).
    const cellIs = synth.conditionalFormattings.filter((c) =>
      c.rules.every((r) => r.type === 'cellIs'),
    );
    expect(cellIs.length).toBe(24);
    // Brick (ligne 5, lower_is_better) : le vert est sur lessThan.
    const brick = synth.conditionalFormattings.find((c) => c.ref === 'D5')!;
    expect(brick.rules[0].operator).toBe('lessThan');
    // ≥1 start (ligne 6, higher_is_better) : le vert est sur greaterThan.
    const ge1 = synth.conditionalFormattings.find((c) => c.ref === 'D6')!;
    expect(ge1.rules[0].operator).toBe('greaterThan');
  });
});
