import type * as ExcelNS from 'exceljs';
import type { ComparisonMatrix, DeckComparison, Scenario } from '../engine/compare.js';
import { AGGREGATE_DEFS } from '../engine/compare.js';

// ─── Export Excel du comparateur (spec §8) — réplique docs/comparatif_mitsurugi.xlsx ───
//
// Trois onglets : Going First / Going Second (même géométrie, blocs A, B, Delta
// empilés) + Synthèse. Les cellules de DONNÉES sont écrites en VALEUR exacte (jamais
// arrondie — l'arrondi est porté par le format d'affichage) ; totaux, deltas et
// agrégats sont des FORMULES : l'utilisateur peut modifier une entrée et voir le
// classeur se recalculer. Convention de police, utile à l'audit : bleu = saisie,
// noir = formule locale, vert = référence à un autre onglet.

const SHEET: Record<Scenario, string> = {
  going_first: 'Going First',
  going_second: 'Going Second',
};
const SHEET_SYNTH = 'Synthèse';

// Géométrie d'un onglet scénario (1-indexée, identique au classeur de référence) :
// bloc A : titre 4, en-têtes 5, données 6–9, total 10 ; bloc B : 12–18 ; delta : 20–26.
const A_TOP = 6;
const B_TOP = 14;
const D_TOP = 22;
const LEGEND_ROW = 28;
const DATA_COLS = ['B', 'C', 'D', 'E', 'F', 'G'];
const TOTAL_COL = 'H';

const FMT_PCT = '0.0%;-0.0%;"·"';
const FMT_PCT_DELTA = '+0.0%;-0.0%;"·"';
const FMT_MEAN = '0.00';
const FMT_MEAN_DELTA = '+0.00;-0.00;"·"';

// Bleu = saisie, noir = formule locale, vert = référence inter-onglets.
const COLOR_INPUT = 'FF1F4E9C';
const COLOR_XREF = 'FF107C41';
// Échelles de couleur (défauts Excel) : blanc → vert ; rouge / blanc / vert.
const SCALE_GREEN = 'FF63BE7B';
const SCALE_RED = 'FFF8696B';
const SCALE_WHITE = 'FFFFFFFF';

/** Interop CJS/ESM : le bundle navigateur d'ExcelJS est UMD, Node passe par `main`. */
async function loadExcelJS(): Promise<typeof ExcelNS> {
  const mod = (await import('exceljs')) as unknown as
    | typeof ExcelNS
    | { default: typeof ExcelNS };
  return 'Workbook' in mod ? mod : mod.default;
}

type Sheet = ExcelNS.Worksheet;

function setCell(
  ws: Sheet,
  addr: string,
  value: number | string | { formula: string },
  opts: { numFmt?: string; bold?: boolean; color?: string; italic?: boolean } = {},
): void {
  const cell = ws.getCell(addr);
  cell.value = typeof value === 'object' ? { formula: value.formula } : value;
  if (opts.numFmt) cell.numFmt = opts.numFmt;
  if (opts.bold || opts.color || opts.italic) {
    cell.font = {
      bold: opts.bold || undefined,
      italic: opts.italic || undefined,
      color: opts.color ? { argb: opts.color } : undefined,
    };
  }
}

/** Bloc matrice (A ou B) : en-têtes, données en valeur (bleu), totaux en formule. */
function matrixBlock(ws: Sheet, top: number, title: string, m: ComparisonMatrix): void {
  setCell(ws, `A${top - 2}`, title, { bold: true });
  setCell(ws, `A${top - 1}`, 'is \\ ne', { bold: true });
  m.colLabels.forEach((label, j) => setCell(ws, `${DATA_COLS[j]}${top - 1}`, label, { bold: true }));
  setCell(ws, `${TOTAL_COL}${top - 1}`, 'Total', { bold: true });

  m.cells.forEach((row, i) => {
    const r = top + i;
    setCell(ws, `A${r}`, m.rowLabels[i], { bold: true });
    row.forEach((v, j) =>
      setCell(ws, `${DATA_COLS[j]}${r}`, v, { numFmt: FMT_PCT, color: COLOR_INPUT }),
    );
    setCell(
      ws,
      `${TOTAL_COL}${r}`,
      { formula: `SUM(B${r}:G${r})` },
      { numFmt: FMT_PCT },
    );
  });

  const totalRow = top + 4;
  setCell(ws, `A${totalRow}`, 'Total', { bold: true });
  for (const col of DATA_COLS)
    setCell(
      ws,
      `${col}${totalRow}`,
      { formula: `SUM(${col}${top}:${col}${top + 3})` },
      { numFmt: FMT_PCT },
    );
  setCell(
    ws,
    `${TOTAL_COL}${totalRow}`,
    { formula: `SUM(${TOTAL_COL}${top}:${TOTAL_COL}${top + 3})` },
    { numFmt: FMT_PCT, bold: true },
  );
}

/** Bloc delta : intégralement en formules `=B14-B6`, format signé en points de %. */
function deltaBlock(ws: Sheet, top: number, title: string, m: ComparisonMatrix): void {
  setCell(ws, `A${top - 2}`, title, { bold: true });
  setCell(ws, `A${top - 1}`, 'is \\ ne', { bold: true });
  m.colLabels.forEach((label, j) => setCell(ws, `${DATA_COLS[j]}${top - 1}`, label, { bold: true }));
  setCell(ws, `${TOTAL_COL}${top - 1}`, 'Total', { bold: true });

  for (let i = 0; i < 4; i++) {
    const r = top + i;
    setCell(ws, `A${r}`, m.rowLabels[i], { bold: true });
    for (const col of DATA_COLS)
      setCell(
        ws,
        `${col}${r}`,
        { formula: `${col}${B_TOP + i}-${col}${A_TOP + i}` },
        { numFmt: FMT_PCT_DELTA },
      );
    setCell(ws, `${TOTAL_COL}${r}`, { formula: `SUM(B${r}:G${r})` }, { numFmt: FMT_PCT_DELTA });
  }

  const totalRow = top + 4;
  setCell(ws, `A${totalRow}`, 'Total', { bold: true });
  for (const col of [...DATA_COLS, TOTAL_COL])
    setCell(
      ws,
      `${col}${totalRow}`,
      { formula: `SUM(${col}${top}:${col}${top + 3})` },
      { numFmt: FMT_PCT_DELTA },
    );
}

function scenarioSheet(wb: ExcelNS.Workbook, cmp: DeckComparison, scenario: Scenario): void {
  const ws = wb.addWorksheet(SHEET[scenario]);
  const A = cmp.deckA.matrices[scenario];
  const B = cmp.deckB.matrices[scenario];
  const label = scenario === 'going_first' ? 'GOING FIRST' : 'GOING SECOND';

  ws.getColumn('A').width = 11;
  for (const col of [...DATA_COLS, TOTAL_COL]) ws.getColumn(col).width = 9;

  setCell(ws, 'A1', `MATRICE STARTS × NON-ENGINE — ${label}`, { bold: true });
  setCell(
    ws,
    'A2',
    `Probabilité de la main d'ouverture (${A.handSize} cartes). is = starts jouables, ne = non-engine pertinent. Données saisies en bleu, le reste se recalcule.`,
    { italic: true },
  );

  const meta = (m: ComparisonMatrix): string =>
    `(deck ${m.deckSize} cartes, S = ${m.starterCount}, N = ${m.nonEngineCount})`;
  matrixBlock(ws, A_TOP, `A. ${cmp.deckA.name.toUpperCase()} ${meta(A)}`, A);
  matrixBlock(ws, B_TOP, `B. ${cmp.deckB.name.toUpperCase()} ${meta(B)}`, B);
  deltaBlock(ws, D_TOP, `C. DELTA (${cmp.deckB.name} − ${cmp.deckA.name}, en points de %)`, A);

  setCell(
    ws,
    `A${LEGEND_ROW}`,
    `Delta : vert = probabilité plus élevée dans « ${cmp.deckB.name} », rouge = moins — pas nécessairement meilleur (ex. colonne ne = 0). Voir l'onglet Synthèse pour le sens de lecture.`,
    { italic: true },
  );

  // Heatmaps : même échelle pour A et B (comparaison honnête) ; delta divergent ±2 pts.
  for (const top of [A_TOP, B_TOP]) {
    ws.addConditionalFormatting({
      ref: `B${top}:G${top + 3}`,
      rules: [
        {
          type: 'colorScale',
          priority: 1,
          cfvo: [
            { type: 'num', value: 0 },
            { type: 'num', value: 0.19 },
          ],
          color: [{ argb: SCALE_WHITE }, { argb: SCALE_GREEN }],
        },
      ],
    });
  }
  ws.addConditionalFormatting({
    ref: `B${D_TOP}:G${D_TOP + 3}`,
    rules: [
      {
        type: 'colorScale',
        priority: 1,
        cfvo: [
          { type: 'num', value: -0.02 },
          { type: 'num', value: 0 },
          { type: 'num', value: 0.02 },
        ],
        color: [{ argb: SCALE_RED }, { argb: SCALE_WHITE }, { argb: SCALE_GREEN }],
      },
    ],
  });
}

/** Formule Synthèse d'un agrégat, pointée sur le bloc (A ou B) d'un onglet scénario. */
function aggFormula(key: string, scenario: Scenario, top: number): string {
  const S = `'${SHEET[scenario]}'!`;
  const total = top + 4;
  switch (key) {
    case 'brick_starters':
      return `${S}$H$${top}`;
    case 'starters_ge1':
      return `SUM(${S}$H$${top + 1}:$H$${top + 3})`;
    case 'starters_ge2':
      return `SUM(${S}$H$${top + 2}:$H$${top + 3})`;
    case 'starters_ge3':
      return `${S}$H$${top + 3}`;
    case 'ne_zero':
      return `${S}$B$${total}`;
    case 'ne_ge1':
      return `SUM(${S}$C$${total}:$G$${total})`;
    case 'ne_ge2':
      return `SUM(${S}$D$${total}:$G$${total})`;
    case 'ne_ge3':
      return `SUM(${S}$E$${total}:$G$${total})`;
    case 'playable':
      return `SUM(${S}$C$${top + 1}:$G$${top + 3})`;
    case 'strong_hand':
      return `SUM(${S}$D$${top + 2}:$G$${top + 3})`;
    case 'mean_starters':
      return `${S}$H$${top + 1}*1+${S}$H$${top + 2}*2+${S}$H$${top + 3}*3`;
    case 'mean_ne':
      return `${S}$C$${total}*1+${S}$D$${total}*2+${S}$E$${total}*3+${S}$F$${total}*4+${S}$G$${total}*5`;
    default:
      throw new Error(`Agrégat inconnu : ${key}`);
  }
}

function synthSheet(wb: ExcelNS.Workbook, cmp: DeckComparison): void {
  const ws = wb.addWorksheet(SHEET_SYNTH);
  ws.getColumn('A').width = 40;
  for (const col of DATA_COLS) ws.getColumn(col).width = 11;
  ws.getColumn('H').width = 18;

  setCell(
    ws,
    'A1',
    `SYNTHÈSE COMPARATIVE — ${cmp.deckA.name.toUpperCase()} vs ${cmp.deckB.name.toUpperCase()}`,
    { bold: true },
  );
  setCell(
    ws,
    'A2',
    'Agrégats calculés PAR FORMULE depuis les onglets Going First / Going Second. Δ en points de %. Les moyennes sont des planchers (seaux ≥3 et 5+).',
    { italic: true },
  );

  const headers = [
    'Indicateur',
    `${cmp.deckA.name} GF`,
    `${cmp.deckB.name} GF`,
    'Δ GF',
    `${cmp.deckA.name} GS`,
    `${cmp.deckB.name} GS`,
    'Δ GS',
    'Sens souhaité',
  ];
  headers.forEach((h, i) => setCell(ws, `${'ABCDEFGH'[i]}4`, h, { bold: true }));

  AGGREGATE_DEFS.forEach((def, i) => {
    const r = 5 + i;
    const isMean = def.unit === 'count';
    const fmt = isMean ? FMT_MEAN : FMT_PCT;
    const fmtDelta = isMean ? FMT_MEAN_DELTA : FMT_PCT_DELTA;
    setCell(ws, `A${r}`, def.label);
    setCell(ws, `B${r}`, { formula: aggFormula(def.key, 'going_first', A_TOP) }, { numFmt: fmt, color: COLOR_XREF });
    setCell(ws, `C${r}`, { formula: aggFormula(def.key, 'going_first', B_TOP) }, { numFmt: fmt, color: COLOR_XREF });
    setCell(ws, `D${r}`, { formula: `C${r}-B${r}` }, { numFmt: fmtDelta });
    setCell(ws, `E${r}`, { formula: aggFormula(def.key, 'going_second', A_TOP) }, { numFmt: fmt, color: COLOR_XREF });
    setCell(ws, `F${r}`, { formula: aggFormula(def.key, 'going_second', B_TOP) }, { numFmt: fmt, color: COLOR_XREF });
    setCell(ws, `G${r}`, { formula: `F${r}-E${r}` }, { numFmt: fmtDelta });
    setCell(ws, `H${r}`, def.direction === 'lower_is_better' ? '↓ plus bas = mieux' : '↑');

    // Coloration ORIENTÉE MÉRITE (§6.2) : favorable = vert, défavorable = rouge —
    // c'est ce qui évite de peindre en vert une hausse de bricks.
    const goodWhen = def.direction === 'lower_is_better' ? 'lessThan' : 'greaterThan';
    const badWhen = def.direction === 'lower_is_better' ? 'greaterThan' : 'lessThan';
    for (const col of ['D', 'G']) {
      ws.addConditionalFormatting({
        ref: `${col}${r}`,
        rules: [
          {
            type: 'cellIs',
            priority: 1,
            operator: goodWhen,
            formulae: [0],
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC6EFCE' } },
              font: { color: { argb: 'FF006100' } },
            },
          },
          {
            type: 'cellIs',
            priority: 2,
            operator: badWhen,
            formulae: [0],
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } },
              font: { color: { argb: 'FF9C0006' } },
            },
          },
        ],
      });
    }
  });

  const legendRow = 5 + AGGREGATE_DEFS.length + 1;
  setCell(
    ws,
    `A${legendRow}`,
    'Lecture du Δ : vert = favorable, rouge = défavorable — le sens est donné par la colonne « Sens souhaité », pas par le signe.',
    { italic: true },
  );
  setCell(
    ws,
    `A${legendRow + 2}`,
    'Bleu = valeur saisie (exacte, non arrondie) · noir = formule locale · vert = référence à un autre onglet. Modifier une cellule bleue recalcule tout le classeur.',
    { italic: true },
  );
}

/** Construit le classeur complet et renvoie son contenu (.xlsx). */
export async function buildComparisonWorkbook(cmp: DeckComparison): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ygo-proba';
  // Aucun résultat de formule n'est écrit : forcer le recalcul à l'ouverture.
  wb.calcProperties.fullCalcOnLoad = true;
  scenarioSheet(wb, cmp, 'going_first');
  scenarioSheet(wb, cmp, 'going_second');
  synthSheet(wb, cmp);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Déclenche le téléchargement navigateur du classeur. */
export async function downloadComparisonXlsx(cmp: DeckComparison, filename: string): Promise<void> {
  const buffer = await buildComparisonWorkbook(cmp);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
