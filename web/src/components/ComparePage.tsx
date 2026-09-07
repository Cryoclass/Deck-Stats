import { useEffect, useMemo, useState } from 'react';
import { api, type DeckSummary } from '../lib/api.js';
import { useRouter } from '../lib/router.js';
import { buildEngineModel } from '../lib/engineModel.js';
import { createEngineClient } from '../worker/client.js';
import { ComputeCancelled } from '../worker/computeClient.js';
import {
  compareDecks,
  SCENARIOS,
  type ComparisonMatrix,
  type ComparisonWarning,
  type DeckComparison,
  type AggregateRow,
  type Scenario,
} from '../engine/compare.js';
import { comparisonDeckOf, unprofiledWarning } from '../lib/comparison.js';
import { downloadComparisonXlsx } from '../lib/exportComparison.js';
import { slugify } from '../lib/exportDeck.js';
import { pct, num, matrixCell, deltaPoints, deltaCount } from '../lib/fmt.js';
import { sourceFromDetail } from '../lib/deckConfiguration.js';
import { STARTS_HINT } from './StatsPanel.js';

// ─── Comparateur de decks (itération 9) — matrice départs théoriques × non-engine, A vs B ───
// Même structure que l'export Excel (§9) : matrices A et B (échelle de couleur
// PARTAGÉE par scénario, sinon la comparaison visuelle ment), matrice de delta avec
// légende obligatoire, puis table de synthèse orientée mérite. Warnings en bandeau.

const scenarioTitle: Record<Scenario, string> = {
  going_first: 'Premier · 5 cartes',
  going_second: 'Second · 5 cartes + pioche',
};

interface Loaded {
  cmp: DeckComparison;
}

export function ComparePage({ a, b }: { a: string; b: string }) {
  const { navigate } = useRouter();
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & Loaded)
  >({ status: 'loading' });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Le comparateur POSSÈDE son client de calcul (étape 4) : un worker par montage,
    // deux tâches. Démontage ou changement de decks → `dispose()` : worker terminé,
    // promesses rejetées (`ComputeCancelled`), jamais bloquées ni adoptées.
    const client = createEngineClient();
    setState({ status: 'loading' });
    (async () => {
      const [da, db, lib] = await Promise.all([api.getDeck(a), api.getDeck(b), api.getLibrary()]);
      const decks = [da, db].map((d) => ({ detail: d, source: sourceFromDetail(d, lib) }));
      for (const { detail, source } of decks) {
        const size = source.main.reduce((s, c) => s + c.copies, 0);
        if (size < 6) {
          throw new Error(
            `« ${detail.name} » n'a que ${size} carte(s) en main deck — impossible de tirer une main de 6.`,
          );
        }
      }
      const unprofiled: ComparisonWarning[] = [];
      const results = await Promise.all(
        decks.map(async ({ detail, source }) => {
          const { input, unprofiledCardIds } = buildEngineModel(source);
          const warning = unprofiledWarning(detail.name, unprofiledCardIds);
          if (warning) unprofiled.push(warning);
          const { result } = await client.compute(input, 'passes').promise;
          return comparisonDeckOf(detail.name, input, result);
        }),
      );
      const cmp = compareDecks(results[0], results[1]);
      // Q5 : signalé par deck (lib/comparison.ts), après les garde-fous du comparateur.
      cmp.warnings.push(...unprofiled);
      return { cmp };
    })().then(
      (loaded) => !cancelled && setState({ status: 'ready', ...loaded }),
      (err: unknown) => {
        if (cancelled || err instanceof ComputeCancelled) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Chargement impossible.',
        });
      },
    );
    return () => {
      cancelled = true;
      client.dispose();
    };
  }, [a, b]);

  const onExport = async () => {
    if (state.status !== 'ready') return;
    setExporting(true);
    try {
      await downloadComparisonXlsx(
        state.cmp,
        `comparatif_${slugify(state.cmp.deckA.name)}_vs_${slugify(state.cmp.deckB.name)}.xlsx`,
      );
    } finally {
      setExporting(false);
    }
  };

  const blocking =
    state.status === 'ready' ? state.cmp.warnings.filter((w) => w.severity === 'error') : [];

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-ink-200">
      {/* Étape 7B (Q4, charte §6.3) : sous 400 px les actions passent sur une seconde ligne
          (flex-wrap) au lieu de couper leurs libellés ; les noms A / B prennent la place
          restante (basis-0, truncate) ; ⇄ Inverser et Exporter Excel mesurent 32 px. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 bg-ink-950 px-5 py-3">
        <button
          onClick={() => navigate({ name: 'home' })}
          className="whitespace-nowrap text-xs text-ink-400 hover:text-ink-100"
        >
          ← Mes decks
        </button>
        <h1 className="whitespace-nowrap text-sm font-semibold text-ink-100">Comparateur</h1>
        {state.status === 'ready' && (
          <span className="min-w-0 flex-1 basis-0 truncate text-xs text-ink-400">
            <span className="text-ink-200">A. {state.cmp.deckA.name}</span>
            {' vs '}
            <span className="text-ink-200">B. {state.cmp.deckB.name}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate({ name: 'compare', a: b, b: a })}
            title="Échanger référence et variante"
            className="whitespace-nowrap rounded border border-ink-700 px-2.5 py-2 text-xs text-ink-300 hover:bg-ink-800"
          >
            ⇄ Inverser A/B
          </button>
          <button
            onClick={onExport}
            disabled={state.status !== 'ready' || blocking.length > 0 || exporting}
            className="whitespace-nowrap rounded bg-emerald-600 px-3 py-2 text-xs font-medium text-black hover:bg-emerald-500 disabled:opacity-40"
          >
            {exporting ? 'Export…' : 'Exporter Excel'}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.status === 'loading' && (
          <div className="p-6 text-sm text-ink-500">Calcul des quatre matrices…</div>
        )}
        {state.status === 'error' && (
          <div className="m-5 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            {state.message}
          </div>
        )}
        {state.status === 'ready' && (
          <div className="mx-auto max-w-5xl p-2 sm:p-5">
            <WarningsBanner warnings={state.cmp.warnings} />
            {blocking.length === 0 && (
              <>
                {SCENARIOS.map((sc) => (
                  <ScenarioSection key={sc} cmp={state.cmp} scenario={sc} />
                ))}
                <SynthTable cmp={state.cmp} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bandeau de garde-fous (§7) — visible, jamais en console ───

const WARN_STYLES: Record<ComparisonWarning['severity'], string> = {
  error: 'border-red-500/40 bg-red-500/10 text-red-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  info: 'border-sky-500/20 bg-sky-500/5 text-sky-300/90',
};

function WarningsBanner({ warnings }: { warnings: ComparisonWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      {warnings.map((w, i) => (
        <div key={i} className={`rounded-md border px-3 py-1.5 text-xs ${WARN_STYLES[w.severity]}`}>
          {w.message}
        </div>
      ))}
    </div>
  );
}

// ─── Matrices d'un scénario : A, B (échelle commune) puis delta ───

function ScenarioSection({ cmp, scenario }: { cmp: DeckComparison; scenario: Scenario }) {
  const A = cmp.deckA.matrices[scenario];
  const B = cmp.deckB.matrices[scenario];
  // Échelle de couleur PARTAGÉE entre A et B (§9) — sinon la comparaison visuelle ment.
  const maxCell = useMemo(
    () => Math.max(...A.cells.flat(), ...B.cells.flat(), 1e-9),
    [A, B],
  );

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
        {scenarioTitle[scenario]}
      </h2>
      {/* Étape 7B (Q3, contrat §5) : sous 640 px, A et B restent côte à côte dans une grille
          de deux colonnes à cellules compactes, Δ en dessous sur toute la largeur ; à partir
          de 640 px, les trois cartes gardent leur largeur naturelle (flex-wrap). */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-4">
        <MatrixCard title={`A. ${cmp.deckA.name}`} m={A} maxCell={maxCell} />
        <MatrixCard title={`B. ${cmp.deckB.name}`} m={B} maxCell={maxCell} />
        <DeltaCard cmp={cmp} scenario={scenario} />
      </div>
    </section>
  );
}

function MatrixCard({ title, m, maxCell }: { title: string; m: ComparisonMatrix; maxCell: number }) {
  return (
    <div className="min-w-0 rounded-lg border border-ink-800 bg-ink-900 p-1.5 sm:p-3">
      <div className="mb-2 truncate text-xs font-semibold text-ink-100" title={title}>{title}</div>
      <MatrixGrid
        rowLabels={m.rowLabels}
        colLabels={m.colLabels}
        cells={m.cells}
        cellStyle={(v) => ({ background: `oklch(0.7 0.13 155 / ${(v / maxCell) * 0.85})` })}
        format={matrixCell}
        cellTitle={(v) => pct(v, 2)}
      />
      {/* S / N retenus par scénario (§7.6) : rend visible l'effet de la classification. */}
      <div className="tnum mt-2 text-[10px] text-ink-500">
        deck {m.deckSize} cartes · S = {m.starterCount} starters · N = {m.nonEngineCount}{' '}
        non-engine étiquetées
      </div>
    </div>
  );
}

function DeltaCard({ cmp, scenario }: { cmp: DeckComparison; scenario: Scenario }) {
  const A = cmp.deckA.matrices[scenario];
  const delta = cmp.deltas[scenario];
  // Échelle divergente centrée sur 0, bornes ±2 points (§5).
  const style = (d: number) => {
    const alpha = Math.min(Math.abs(d) / 0.02, 1) * 0.85;
    return {
      background:
        d > 0 ? `oklch(0.7 0.13 155 / ${alpha})` : d < 0 ? `oklch(0.58 0.17 25 / ${alpha})` : undefined,
    };
  };
  return (
    <div className="col-span-2 rounded-lg border border-ink-800 bg-ink-900 p-1.5 sm:p-3">
      <div className="mb-2 text-xs font-semibold text-ink-100">Δ (B − A), en points de %</div>
      <MatrixGrid
        rowLabels={A.rowLabels}
        colLabels={A.colLabels}
        cells={delta}
        cellStyle={style}
        format={deltaPoints}
        cellTitle={(v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)} pt`}
      />
      {/* Légende OBLIGATOIRE (§5) : le signe n'est pas un jugement de valeur. */}
      <div className="mt-2 max-w-[240px] text-[10px] leading-snug text-ink-500">
        vert = probabilité plus élevée dans B — <em>pas nécessairement meilleur</em> (ex. colonne
        U = 0). Lignes = départs théoriques S, colonnes = potentiel non-engine U. La synthèse
        ci-dessous donne le sens de lecture.
      </div>
    </div>
  );
}

function MatrixGrid({
  rowLabels,
  colLabels,
  cells,
  cellStyle,
  format,
  cellTitle,
}: {
  rowLabels: string[];
  colLabels: string[];
  cells: number[][];
  cellStyle: (v: number) => React.CSSProperties;
  format: (v: number) => string;
  cellTitle: (v: number) => string;
}) {
  return (
    // Cellules compactes sous 640 px (Q3) : police 9 px, espacement 1 px, largeur au
    // contenu avec un minimum de 20 px par colonne (sinon une colonne de « · » écrase son
    // en-tête) ; à partir de 640 px, cellules de 32 px à 10 px comme le panneau.
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-px text-[9px] sm:border-spacing-0.5 sm:text-[10px]">
        <thead>
          <tr>
            <th className="px-px py-1 text-ink-600 sm:p-1" title={STARTS_HINT}>
              <span className="sm:hidden">S\U</span>
              <span className="hidden sm:inline">↓S \ U→</span>
            </th>
            {colLabels.map((c) => (
              <th key={c} className="tnum min-w-5 px-px py-1 text-right text-ink-500 sm:w-8 sm:p-1">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.map((row, i) => (
            <tr key={i}>
              <td className="tnum px-px py-1 text-right text-ink-500 sm:p-1">{rowLabels[i]}</td>
              {row.map((v, j) => (
                <td
                  key={j}
                  title={cellTitle(v)}
                  className="tnum min-w-5 rounded px-px py-1 text-right text-ink-100 sm:w-8 sm:p-1"
                  style={cellStyle(v)}
                >
                  {format(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Synthèse comparée (§6) — coloration orientée MÉRITE, pas signe ───

function SynthTable({ cmp }: { cmp: DeckComparison }) {
  const rows = cmp.aggregates.going_first.map((gf, i) => ({
    gf,
    gs: cmp.aggregates.going_second[i],
  }));
  const val = (r: AggregateRow, v: number): string => (r.unit === 'percent' ? pct(v) : num(v));

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
        Synthèse — Δ coloré selon le sens souhaité
      </h2>
      <div className="overflow-x-auto rounded-lg border border-ink-800 bg-ink-900">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-ink-800 text-[10px] uppercase tracking-wide text-ink-500">
              <th className="p-2 text-left font-medium">Indicateur</th>
              <th className="p-2 text-right font-medium" title={scenarioTitle.going_first}>A · 1er</th>
              <th className="p-2 text-right font-medium" title={scenarioTitle.going_first}>B · 1er</th>
              <th className="p-2 text-right font-medium" title={scenarioTitle.going_first}>Δ · 1er</th>
              <th className="p-2 text-right font-medium" title={scenarioTitle.going_second}>A · 2nd</th>
              <th className="p-2 text-right font-medium" title={scenarioTitle.going_second}>B · 2nd</th>
              <th className="p-2 text-right font-medium" title={scenarioTitle.going_second}>Δ · 2nd</th>
              <th className="p-2 text-left font-medium">Sens</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ gf, gs }) => (
              <tr key={gf.key} className="border-b border-ink-850 last:border-0">
                <td className="p-2 text-ink-300">{gf.label}</td>
                <td className="tnum p-2 text-right text-ink-100">{val(gf, gf.valueA)}</td>
                <td className="tnum p-2 text-right text-ink-100">{val(gf, gf.valueB)}</td>
                <DeltaCell row={gf} />
                <td className="tnum p-2 text-right text-ink-100">{val(gs, gs.valueA)}</td>
                <td className="tnum p-2 text-right text-ink-100">{val(gs, gs.valueB)}</td>
                <DeltaCell row={gs} />
                <td className="p-2 text-ink-500">
                  {gf.direction === 'lower_is_better' ? '↓ plus bas = mieux' : '↑'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DeltaCell({ row }: { row: AggregateRow }) {
  const d = row.delta;
  // Favorable selon la DIRECTION de l'indicateur (§6.2), pas selon le signe brut.
  // Étape 7 (Q1) : décision par le signe du delta EXACT, comme la mise en forme
  // conditionnelle de l'Excel (`lessThan 0` / `greaterThan 0`) ; « · » et neutre
  // seulement pour le zéro exact — jamais de seuil qui ferait passer un delta pour nul.
  const favorable = row.direction === 'lower_is_better' ? d < 0 : d > 0;
  const cls = d === 0 ? 'text-ink-500' : favorable ? 'text-emerald-300' : 'text-red-400';
  const text = row.unit === 'percent' ? deltaPoints(d) : deltaCount(d);
  return (
    <td className={`tnum p-2 text-right ${cls}`} title={row.unit === 'percent' ? `${(d * 100).toFixed(2)} pt` : d.toFixed(3)}>
      {text}
    </td>
  );
}

// ─── Sélection des deux decks (depuis l'accueil) ───

export function CompareDialog({
  decks,
  onClose,
}: {
  decks: DeckSummary[];
  onClose: () => void;
}) {
  const { navigate } = useRouter();
  const [a, setA] = useState(decks[0]?.id ?? '');
  const [bSel, setB] = useState(decks[1]?.id ?? '');

  const selectCls =
    'w-full rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-sm text-ink-100';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-100">Comparer deux decks</h2>
          <button
            onClick={onClose}
            title="Fermer"
            className="flex h-8 w-8 items-center justify-center rounded text-ink-500 hover:bg-ink-800 hover:text-ink-200"
          >
            ✕
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
            A — référence
          </span>
          <select value={a} onChange={(e) => setA(e.target.value)} className={selectCls}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.main_count} c.)
              </option>
            ))}
          </select>
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
            B — variante
          </span>
          <select value={bSel} onChange={(e) => setB(e.target.value)} className={selectCls}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.main_count} c.)
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-ink-500">
            Le delta se lit B − A : A est l'état de départ.
          </span>
          <button
            onClick={() => navigate({ name: 'compare', a, b: bSel })}
            disabled={!a || !bSel || a === bSel}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-500 disabled:opacity-40"
          >
            Comparer
          </button>
        </div>
        {a === bSel && a && (
          <div className="mt-2 text-[11px] text-amber-300">
            Même deck des deux côtés — choisis deux versions différentes.
          </div>
        )}
      </div>
    </div>
  );
}
