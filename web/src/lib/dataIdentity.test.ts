import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { computeAll, computePass } from '../engine/enumerate.js';
import {
  compareDecks,
  toComparisonMatrix,
  SCENARIOS,
  type DeckComparison,
  type Scenario,
} from '../engine/compare.js';
import type { EngineResult, PassResult } from '../engine/types.js';
import { buildEngineModel, type EngineModel, type EngineModelSource } from './engineModel.js';
import { libraryState, stateFromConfiguration } from './deckConfiguration.js';
import { parseConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { comparisonDeckOf, unprofiledWarning } from './comparison.js';
import { cumulativeOf, resolveView } from './statsViews.js';
import { buildComparisonWorkbook } from './exportComparison.js';
import type { Library } from '../types.js';

// ─── Étape 7, point 1 — identité des données (PLAN : « données identiques entre
// analyse, Excel et comparateur »). Pour un même deck et un même contexte, on suit les
// TROIS chemins réels, avant tout arrondi d'affichage :
//   • analyse : `buildEngineModel` → `computeAll` (mode `full` du store) → helpers du
//     panneau (`resolveView`, `cumulativeOf`, matrice de `CrossMatrix`) ;
//   • comparateur : même modèle → `computePass` × 2 (mode `passes` du worker) →
//     `comparisonDeckOf` → `compareDecks` ;
//   • Excel : `buildComparisonWorkbook` relu par ExcelJS ; cellules de données en valeur,
//     totaux / deltas / synthèse en FORMULES, recalculées ici par un petit évaluateur de
//     la grammaire réellement émise (références, `'Feuille'!$H$6`, `SUM(plage)`, + − *).
// Le deck contient une carte étiquetée sans profil (Q5 : contribution nulle, listée)
// et un plafond partagé. Le moteur n'est pas l'objet du test : il est la source commune.

const ids = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const leaf = (card_id: number, at_least = 1) => ({ kind: 'remaining' as const, card_id, at_least });

// Identités du deck de référence (A). Copies : 40.
const STARTER_A = 1; // ×3, starter conditionné : Target ≥ 1 ET (X ≥ 1 OU Y ≥ 2)
const STARTER_B = 2; // ×2, starter mort en second
const COMBO_C = 3; // ×3 ┐ paire C + D, conditionnée : Target ≥ 1
const COMBO_D = 4; // ×2 ┘
const HT_E = 5; // ×3, HOPT, étiquette ht, flexible, plafond partagé « cap » (1 / tour)
const HT_F = 6; // ×3, étiquette ht, flexible, même plafond
const MULCH_G = 7; // ×3, étiquette ht, précoce, morte en premier
const QP_H = 8; // ×2, étiquette bb, préparée
const TARGET = 9; // ×1
const X = 10; // ×1
const Y = 11; // ×2
const BREAKER_K = 12; // ×2, étiquette bb, board breaker
const UNPROFILED_L = 13; // ×3, étiquette ht SANS profil (Q5)
const FILLER = [14, 15, 16] as const; // ×3 chacune
const FILLER_Q = 17; // ×1
const HT_M = 18; // ×1, variante B : remplace FILLER_Q (étiquette ht, flexible)

const CAP_GROUP = ids(900);
const PAIR_CD = ids(100);

const library: Library = {
  hoptCardIds: [HT_E],
  categories: [
    { id: 'ht', name: 'Handtrap', is_builtin: true },
    { id: 'bb', name: 'Board breaker', is_builtin: true },
  ],
  cardCategories: [
    { card_id: HT_E, category_id: 'ht' },
    { card_id: HT_F, category_id: 'ht' },
    { card_id: MULCH_G, category_id: 'ht' },
    { card_id: QP_H, category_id: 'bb' },
    { card_id: BREAKER_K, category_id: 'bb' },
    { card_id: UNPROFILED_L, category_id: 'ht' },
    { card_id: HT_M, category_id: 'ht' },
  ],
  profiles: [
    { card_id: HT_E, availability: 'flexible', group_id: CAP_GROUP },
    { card_id: HT_F, availability: 'flexible', group_id: CAP_GROUP },
    { card_id: MULCH_G, availability: 'early', group_id: null },
    { card_id: QP_H, availability: 'prepared', group_id: null },
    { card_id: BREAKER_K, availability: 'breaker', group_id: null },
    { card_id: HT_M, availability: 'flexible', group_id: null },
  ],
  groups: [{ id: CAP_GROUP, name: 'Plafond partagé', cap_per_turn: 1 }],
};

function deckSource(name: string, variant: boolean): EngineModelSource {
  const main = (card_id: number, copies: number) => ({ card_id, zone: 'main' as const, copies });
  const cards = [
    main(STARTER_A, 3), main(STARTER_B, 2), main(COMBO_C, 3), main(COMBO_D, 2),
    main(HT_E, 3), main(HT_F, 3), main(MULCH_G, 3), main(QP_H, 2),
    main(TARGET, 1), main(X, 1), main(Y, 2), main(BREAKER_K, 2), main(UNPROFILED_L, 3),
    ...FILLER.map((id) => main(id, 3)),
    variant ? main(HT_M, 1) : main(FILLER_Q, 1),
  ];
  const configuration = parseConfiguration({
    version: 2,
    name,
    cards,
    starters: [STARTER_A, STARTER_B],
    pairs: [{ id: PAIR_CD, card_a_id: COMBO_C, card_b_id: COMBO_D, note: null, disabled: false }],
    conditions: [
      { id: ids(200), source_card_id: STARTER_A, source_pair_id: null,
        condition: { kind: 'and', all: [leaf(TARGET), { kind: 'or', any: [leaf(X), leaf(Y, 2)] }] } },
      { id: ids(201), source_card_id: null, source_pair_id: PAIR_CD, condition: leaf(TARGET) },
    ],
    deadFirst: [MULCH_G],
    deadSecond: [STARTER_B],
    params: {},
    notes: null,
  });
  return { ...stateFromConfiguration(configuration), ...libraryState(library) };
}

/** Chemin de l'éditeur : modèle + calcul complet (deltas compris) + contexte du résultat. */
interface Analysis {
  model: EngineModel;
  result: EngineResult;
  unprofiledCardIds: number[]; // ce que `resultContext` transporte vers le panneau
}
function analyse(source: EngineModelSource): Analysis {
  const model = buildEngineModel(source);
  return { model, result: computeAll(model.input), unprofiledCardIds: model.unprofiledCardIds };
}

/** Chemin du comparateur : mêmes modèles, mode `passes` du worker. */
function compare(a: EngineModelSource, b: EngineModelSource): DeckComparison {
  const deck = (name: string, s: EngineModelSource) => {
    const model = buildEngineModel(s);
    const passes = { first: computePass(model.input, 'first'), second: computePass(model.input, 'second') };
    return { deck: comparisonDeckOf(name, model.input, passes), warning: unprofiledWarning(name, model.unprofiledCardIds) };
  };
  const A = deck('Référence', a);
  const B = deck('Variante', b);
  const cmp = compareDecks(A.deck, B.deck);
  for (const w of [A.warning, B.warning]) if (w) cmp.warnings.push(w);
  return cmp;
}

const passOf = (r: { first: PassResult; second: PassResult }, sc: Scenario): PassResult =>
  sc === 'going_first' ? r.first : r.second;
/** Matrice telle que le panneau la construit (`CrossMatrix`). */
const panelMatrix = (pass: PassResult, sc: Scenario): number[][] =>
  toComparisonMatrix(pass, sc, { starterCount: 0, nonEngineCount: 0 }).cells;

const close = (a: number, b: number, tol = 1e-12): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
};

// ─── Évaluateur de formules : exactement la grammaire émise par exportComparison.ts ───

type Tok = { t: 'num'; v: number } | { t: 'ref'; sheet?: string; addr: string } | { t: 'op'; v: string } | { t: 'fn'; v: string };

function tokenize(formula: string): Tok[] {
  const re = /'([^']+)'!(\$?[A-Z]+\$?\d+)|(\$?[A-Z]+\$?\d+)|([A-Z]+)\(|(\d+(?:\.\d+)?)|([+\-*():])|(\s+)/gy;
  const out: Tok[] = [];
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(formula)) !== null) {
    last = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'ref', sheet: m[1], addr: m[2].replace(/\$/g, '') });
    else if (m[3] !== undefined) out.push({ t: 'ref', addr: m[3].replace(/\$/g, '') });
    else if (m[4] !== undefined) out.push({ t: 'fn', v: m[4] }, { t: 'op', v: '(' });
    else if (m[5] !== undefined) out.push({ t: 'num', v: Number(m[5]) });
    else if (m[6] !== undefined) out.push({ t: 'op', v: m[6] });
    if (last === formula.length) break;
  }
  if (last !== formula.length) throw new Error(`Formule non reconnue : ${formula}`);
  return out;
}

const colIndex = (letters: string): number => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
const colLetters = (n: number): string => {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
function expandRange(from: string, to: string): string[] {
  const [, c1, r1] = /^([A-Z]+)(\d+)$/.exec(from)!;
  const [, c2, r2] = /^([A-Z]+)(\d+)$/.exec(to)!;
  const out: string[] = [];
  for (let c = colIndex(c1); c <= colIndex(c2); c++)
    for (let r = Number(r1); r <= Number(r2); r++) out.push(`${colLetters(c)}${r}`);
  return out;
}

function makeEvaluator(wb: ExcelJS.Workbook) {
  const cache = new Map<string, number>();
  const cell = (sheet: string, addr: string): number => {
    const key = `${sheet}!${addr}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const ws = wb.getWorksheet(sheet);
    if (!ws) throw new Error(`Feuille inconnue : ${sheet}`);
    const v = ws.getCell(addr).value;
    let out: number;
    if (typeof v === 'number') out = v;
    else if (v === null || v === undefined) out = 0;
    else if (typeof v === 'object' && 'formula' in v) out = evalFormula(sheet, (v as ExcelJS.CellFormulaValue).formula);
    else throw new Error(`Cellule non numérique ${key} : ${String(v)}`);
    cache.set(key, out);
    return out;
  };
  function evalFormula(sheet: string, formula: string): number {
    const toks = tokenize(formula);
    let i = 0;
    const peek = () => toks[i];
    const take = () => toks[i++];
    const expr = (): number => {
      let v = term();
      while (peek()?.t === 'op' && (peek() as { v: string }).v === '+' || peek()?.t === 'op' && (peek() as { v: string }).v === '-') {
        const op = (take() as { v: string }).v;
        const r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    };
    const term = (): number => {
      let v = factor();
      while (peek()?.t === 'op' && (peek() as { v: string }).v === '*') { take(); v = v * factor(); }
      return v;
    };
    const factor = (): number => {
      const tok = take();
      if (!tok) throw new Error(`Formule incomplète : ${formula}`);
      if (tok.t === 'num') return tok.v;
      if (tok.t === 'ref') return cell(tok.sheet ?? sheet, tok.addr);
      if (tok.t === 'fn') {
        if (tok.v !== 'SUM') throw new Error(`Fonction non prise en charge : ${tok.v}`);
        take(); // (
        const from = take();
        const colon = take();
        const to = take();
        const close = take();
        if (from?.t !== 'ref' || colon?.t !== 'op' || colon.v !== ':' || to?.t !== 'ref' || close?.t !== 'op' || close.v !== ')')
          throw new Error(`SUM attend une plage : ${formula}`);
        const target = from.sheet ?? sheet;
        return expandRange(from.addr, to.addr).reduce((s, a) => s + cell(target, a), 0);
      }
      if (tok.t === 'op' && tok.v === '(') { const v = expr(); take(); return v; }
      throw new Error(`Jeton inattendu dans ${formula}`);
    };
    const v = expr();
    if (i !== toks.length) throw new Error(`Formule non consommée : ${formula}`);
    return v;
  }
  return cell;
}

// ─── Fixtures calculées une fois ───

const SHEET: Record<Scenario, string> = { going_first: 'Going First', going_second: 'Going Second' };
const DATA_COLS = ['B', 'C', 'D', 'E', 'F', 'G'];
const A_TOP = 6;
const B_TOP = 14;
const D_TOP = 22;

const sourceA = deckSource('Référence', false);
const sourceB = deckSource('Variante', true);
const analysisA = analyse(sourceA);
const analysisB = analyse(sourceB);
const cmp = compare(sourceA, sourceB);

describe('Étape 7 — identité des données analyse / comparateur / Excel', () => {
  let wb: ExcelJS.Workbook;
  let cell: (sheet: string, addr: string) => number;

  beforeAll(async () => {
    const buffer = await buildComparisonWorkbook(cmp);
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    cell = makeEvaluator(wb);
  });

  it('le deck de référence exerce bien Q5 et un plafond partagé', () => {
    expect(analysisA.model.input.deckSize).toBe(40);
    expect(analysisA.model.input.groups).toEqual([{ id: CAP_GROUP, capPerTurn: 1 }]);
    expect(analysisA.unprofiledCardIds).toEqual([UNPROFILED_L]);
    for (const sc of SCENARIOS) expect(passOf(analysisA.result, sc).total).toBeGreaterThan(0);
  });

  it('matrice du panneau = matrice du comparateur = cellules Excel, nombre pour nombre', () => {
    for (const sc of SCENARIOS) {
      for (const [analysis, deck, top] of [[analysisA, cmp.deckA, A_TOP], [analysisB, cmp.deckB, B_TOP]] as const) {
        const fromPanel = panelMatrix(passOf(analysis.result, sc), sc);
        const fromCompare = deck.matrices[sc].cells;
        expect(fromCompare).toHaveLength(4);
        // Mode `full` (éditeur) et mode `passes` (comparateur) : mêmes flottants.
        expect(fromCompare).toEqual(fromPanel);
        const ws = wb.getWorksheet(SHEET[sc])!;
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < 6; j++) {
            const written = ws.getCell(`${DATA_COLS[j]}${top + i}`).value;
            expect(written, `${SHEET[sc]} ${DATA_COLS[j]}${top + i}`).toBe(fromPanel[i][j]);
          }
      }
    }
  });

  it('les agrégats du comparateur sont les seaux et cumulés du panneau (valeurs exactes)', () => {
    for (const sc of SCENARIOS) {
      for (const [analysis, side] of [[analysisA, 'valueA'], [analysisB, 'valueB']] as const) {
        const pass = passOf(analysis.result, sc);
        const starts = resolveView(pass, 'starts');
        const ne = resolveView(pass, 'nonengine');
        const cumS = cumulativeOf(starts.buckets);
        const cumU = cumulativeOf(ne.buckets);
        const agg = new Map(cmp.aggregates[sc].map((r) => [r.key, r[side]]));
        close(agg.get('brick_starters')!, starts.buckets[0]);
        close(agg.get('brick_starters')!, pass.brick);
        close(agg.get('starters_ge1')!, cumS[1]!);
        close(agg.get('starters_ge2')!, cumS[2]!);
        close(agg.get('starters_ge3')!, cumS[3]!);
        close(agg.get('ne_zero')!, ne.buckets[0]);
        close(agg.get('ne_ge1')!, cumU[1]!);
        close(agg.get('ne_ge2')!, cumU[2]!);
        close(agg.get('ne_ge3')!, cumU[3]!);
        // Zone jouable et main forte : depuis les issues pondérées du moteur (mode requête).
        const mass = (ok: (starts: number, u: number) => boolean) =>
          pass.buckets.reduce((s, b) => s + (ok(b.starts, b.neTotal) ? b.p : 0), 0);
        close(agg.get('playable')!, mass((s, u) => s >= 1 && u >= 1));
        close(agg.get('strong_hand')!, mass((s, u) => s >= 2 && u >= 2));
        // Moyennes PLANCHERS (seaux ≥3 et 5+) : ≤ E[S] / E[U] du panneau, jamais égales
        // à une moyenne exacte par accident de libellé.
        const floorS = pass.startsExact.reduce((s, p, i) => s + (p ?? 0) * Math.min(i, 3), 0);
        const floorU = pass.nonEngine.reduce((s, p, j) => s + (p ?? 0) * Math.min(j, 5), 0);
        close(agg.get('mean_starters')!, floorS);
        close(agg.get('mean_ne')!, floorU);
        expect(agg.get('mean_starters')!).toBeLessThanOrEqual(starts.mean + 1e-12);
        expect(agg.get('mean_ne')!).toBeLessThanOrEqual(ne.mean + 1e-12);
        expect(starts.mean).toBe(pass.meanStarts);
        expect(ne.mean).toBe(pass.meanNonEngine);
      }
    }
  });

  it('les deltas du comparateur sont B − A des valeurs exactes, sans arrondi intermédiaire', () => {
    for (const sc of SCENARIOS) {
      const A = cmp.deckA.matrices[sc].cells;
      const B = cmp.deckB.matrices[sc].cells;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 6; j++) expect(cmp.deltas[sc][i][j]).toBe(B[i][j] - A[i][j]);
      for (const row of cmp.aggregates[sc]) expect(row.delta).toBe(row.valueB - row.valueA);
      // La somme des deltas d'une matrice est nulle (deux matrices de somme 1).
      close(cmp.deltas[sc].flat().reduce((s, d) => s + d, 0), 0, 1e-9);
    }
    // La variante change réellement quelque chose (sinon le test ne prouverait rien).
    expect(cmp.warnings.some((w) => w.code === 'identical')).toBe(false);
    expect(cmp.deltas.going_second.flat().some((d) => d !== 0)).toBe(true);
  });

  it('les formules Excel recalculées donnent totaux, bloc delta et synthèse du comparateur', () => {
    for (const sc of SCENARIOS) {
      const sheet = SHEET[sc];
      for (const [deck, top] of [[cmp.deckA, A_TOP], [cmp.deckB, B_TOP]] as const) {
        const cells = deck.matrices[sc].cells;
        for (let i = 0; i < 4; i++) close(cell(sheet, `H${top + i}`), cells[i].reduce((s, v) => s + v, 0));
        for (let j = 0; j < 6; j++) close(cell(sheet, `${DATA_COLS[j]}${top + 4}`), cells.reduce((s, r) => s + r[j], 0));
        close(cell(sheet, `H${top + 4}`), 1, 1e-9);
      }
      // Bloc delta : `=B14-B6` etc. — même soustraction que compareDecks, mêmes flottants.
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 6; j++)
          expect(cell(sheet, `${DATA_COLS[j]}${D_TOP + i}`), `${sheet} delta ${i},${j}`).toBe(cmp.deltas[sc][i][j]);
      close(cell(sheet, `H${D_TOP + 4}`), 0, 1e-9);
    }
    // Synthèse : une ligne par agrégat, colonnes B..D (premier) et E..G (second).
    cmp.aggregates.going_first.forEach((gf, k) => {
      const gs = cmp.aggregates.going_second[k];
      const r = 5 + k;
      expect(String(wb.getWorksheet('Synthèse')!.getCell(`A${r}`).value)).toBe(gf.label);
      close(cell('Synthèse', `B${r}`), gf.valueA);
      close(cell('Synthèse', `C${r}`), gf.valueB);
      close(cell('Synthèse', `D${r}`), gf.delta);
      close(cell('Synthèse', `E${r}`), gs.valueA);
      close(cell('Synthèse', `F${r}`), gs.valueB);
      close(cell('Synthèse', `G${r}`), gs.delta);
    });
  });

  it('carte étiquetée sans profil : listée à l’identique, comptée dans N, contribution nulle', () => {
    // Même liste pour le panneau (`resultContext`) et l'avertissement du comparateur.
    expect(analysisA.unprofiledCardIds).toEqual([UNPROFILED_L]);
    expect(analysisB.unprofiledCardIds).toEqual([UNPROFILED_L]);
    const warnings = cmp.warnings.filter((w) => w.code === 'unprofiled').map((w) => w.message);
    expect(warnings).toEqual([
      '« Référence » : 1 carte non-engine sans profil, non comptée dans le potentiel.',
      '« Variante » : 1 carte non-engine sans profil, non comptée dans le potentiel.',
    ]);
    // N = composition : copies étiquetées, carte sans profil comprise (contrat §5).
    const labelled = library.cardCategories.map((cc) => cc.card_id);
    const copiesA = new Map(sourceA.main.map((c) => [c.cardId, c.copies]));
    const expectedN = labelled.reduce((s, id) => s + (copiesA.get(id) ?? 0), 0);
    expect(expectedN).toBe(3 + 3 + 3 + 2 + 2 + 3);
    for (const sc of SCENARIOS) expect(cmp.deckA.matrices[sc].nonEngineCount).toBe(expectedN);
    // Contribution nulle : retirer son étiquette ne change ni U ni la matrice…
    const stripped: EngineModelSource = {
      ...sourceA,
      cardCategories: new Map([...sourceA.cardCategories].filter(([id]) => id !== UNPROFILED_L)),
    };
    const without = analyse(stripped);
    expect(without.unprofiledCardIds).toEqual([]);
    for (const sc of SCENARIOS) {
      const withL = passOf(analysisA.result, sc);
      const noL = passOf(without.result, sc);
      expect(withL.nonEngine.length).toBe(noL.nonEngine.length);
      withL.nonEngine.forEach((p, j) => close(p, noL.nonEngine[j] ?? 0));
      panelMatrix(withL, sc).forEach((row, i) => row.forEach((v, j) => close(v, panelMatrix(noL, sc)[i][j])));
      // … mais ses copies brutes sont bien comptées dans l'étiquette (Q5).
      const ht = withL.perCategory.find((c) => c.id === 'ht')!;
      const htNoL = noL.perCategory.find((c) => c.id === 'ht')!;
      expect(ht.mean).toBeGreaterThan(htNoL.mean);
    }
  });

  it('le plafond partagé agit sur la source commune des trois chemins', () => {
    const uncapped: EngineModelSource = {
      ...sourceA,
      profiles: new Map([...sourceA.profiles].map(([id, p]) => [id, { ...p, groupId: null }])),
    };
    const free = analyse(uncapped);
    expect(free.model.input.groups).toBeUndefined();
    for (const sc of SCENARIOS) {
      const capped = passOf(analysisA.result, sc);
      const open = passOf(free.result, sc);
      // Deux handtraps flexibles sous un plafond de 1 : le potentiel U ne peut plus les
      // cumuler sur un même tour → distribution différente, matrice différente.
      expect(capped.meanNonEngine).toBeLessThan(open.meanNonEngine);
      const a = panelMatrix(capped, sc).flat();
      const b = panelMatrix(open, sc).flat();
      expect(a.some((v, k) => v !== b[k])).toBe(true);
      // Et c'est bien la matrice plafonnée qui est dans le comparateur (donc dans l'Excel).
      expect(cmp.deckA.matrices[sc].cells.flat()).toEqual(a);
    }
  });
});
