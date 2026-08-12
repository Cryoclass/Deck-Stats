import { useEffect, useMemo, useState } from 'react';
import { api, type DeckDetail, type DeckSummary } from '../lib/api.js';
import { useRouter } from '../lib/router.js';
import { buildEngineModel, type EngineModelSource } from '../lib/engineModel.js';
import { computePassesInWorker } from '../worker/client.js';
import {
  compareDecks,
  scenarioCounts,
  toComparisonMatrix,
  SCENARIOS,
  type ComparisonMatrix,
  type ComparisonWarning,
  type DeckComparison,
  type AggregateRow,
  type Scenario,
} from '../engine/compare.js';
import { downloadComparisonXlsx } from '../lib/exportComparison.js';
import { slugify } from '../lib/exportDeck.js';
import { pct, num } from '../lib/fmt.js';
import type { Library } from '../types.js';

// ─── Comparateur de decks (itération 9) — matrice starts × non-engine, A vs B ───
// Même structure que l'export Excel (§9) : matrices A et B (échelle de couleur
// PARTAGÉE par scénario, sinon la comparaison visuelle ment), matrice de delta avec
// légende obligatoire, puis table de synthèse orientée mérite. Warnings en bandeau.

const scenarioTitle: Record<Scenario, string> = {
  going_first: 'Going first — main de 5',
  going_second: 'Going second — main de 6',
};

function clampHorizon(v: unknown, fallback: number): number {
  const n = Number(v ?? fallback);
  return Number.isFinite(n) ? Math.max(1, Math.min(3, Math.round(n))) : fallback;
}

/** DeckDetail (API) + bibliothèque du compte → source du modèle moteur (§4D). */
function sourceFromDetail(detail: DeckDetail, lib: Library): EngineModelSource {
  const params = (detail.params ?? {}) as Record<string, unknown>;
  const cardCategories = new Map<number, Set<string>>();
  for (const { card_id, category_id } of lib.cardCategories) {
    (cardCategories.get(card_id) ?? cardCategories.set(card_id, new Set()).get(card_id)!).add(
      category_id,
    );
  }
  return {
    main: detail.cards
      .filter((c) => c.zone === 'main')
      .map((c) => ({ cardId: c.card_id, zone: 'main' as const, copies: c.copies })),
    hopt: new Set(lib.hoptCardIds),
    deadFirst: new Set(lib.deadFirstCardIds),
    deadSecond: new Set(lib.deadSecondCardIds),
    pairs: lib.pairs,
    categories: lib.categories,
    cardCategories,
    starters: new Set(detail.starters),
    pairExclusions: new Set(detail.pair_exclusions),
    startRequirements: (detail.start_requirements ?? []).map((r) => ({
      id: r.id,
      sourceCardId: r.source_card_id,
      sourcePairId: r.source_pair_id,
      requiredCardId: r.required_card_id,
      minInDeck: r.min_in_deck,
    })),
    horizonFirst: clampHorizon(params.horizonFirst, 1),
    horizonSecond: clampHorizon(params.horizonSecond, 2),
  };
}

interface Loaded {
  cmp: DeckComparison;
  horizons: { a: [number, number]; b: [number, number] };
}

export function ComparePage({ a, b }: { a: string; b: string }) {
  const { navigate } = useRouter();
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & Loaded)
  >({ status: 'loading' });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
      const results = await Promise.all(
        decks.map(async ({ detail, source }) => {
          const { input } = buildEngineModel(source);
          const { result } = await computePassesInWorker(input);
          return {
            name: detail.name,
            matrices: {
              going_first: toComparisonMatrix(
                result.first,
                'going_first',
                scenarioCounts(input, 'going_first'),
              ),
              going_second: toComparisonMatrix(
                result.second,
                'going_second',
                scenarioCounts(input, 'going_second'),
              ),
            },
          };
        }),
      );
      const cmp = compareDecks(results[0], results[1]);
      const [sa, sb] = decks.map((d) => d.source);
      // Hypothèse de jeu différente entre les decks → une partie de l'écart non-engine
      // vient du réglage, pas des cartes. À dire en clair (§B.3.5).
      if (sa.horizonFirst !== sb.horizonFirst || sa.horizonSecond !== sb.horizonSecond) {
        cmp.warnings.push({
          severity: 'warning',
          code: 'horizon_differs',
          message: `Horizons d'interaction différents (A : 1st=${sa.horizonFirst}/2nd=${sa.horizonSecond}, B : 1st=${sb.horizonFirst}/2nd=${sb.horizonSecond}) — le comptage non-engine des HOPT n'est pas réglé pareil.`,
        });
      }
      return {
        cmp,
        horizons: {
          a: [sa.horizonFirst, sa.horizonSecond] as [number, number],
          b: [sb.horizonFirst, sb.horizonSecond] as [number, number],
        },
      };
    })().then(
      (loaded) => !cancelled && setState({ status: 'ready', ...loaded }),
      (err: unknown) =>
        !cancelled &&
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Chargement impossible.',
        }),
    );
    return () => {
      cancelled = true;
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
      <header className="flex shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-950 px-5 py-3">
        <button
          onClick={() => navigate({ name: 'home' })}
          className="text-xs text-ink-400 hover:text-ink-100"
        >
          ← Mes decks
        </button>
        <h1 className="text-sm font-semibold text-ink-100">Comparateur</h1>
        {state.status === 'ready' && (
          <span className="min-w-0 truncate text-xs text-ink-400">
            <span className="text-ink-200">A. {state.cmp.deckA.name}</span>
            {' vs '}
            <span className="text-ink-200">B. {state.cmp.deckB.name}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate({ name: 'compare', a: b, b: a })}
            title="Échanger référence et variante"
            className="rounded border border-ink-700 px-2.5 py-1.5 text-xs text-ink-300 hover:bg-ink-800"
          >
            ⇄ Inverser A/B
          </button>
          <button
            onClick={onExport}
            disabled={state.status !== 'ready' || blocking.length > 0 || exporting}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-500 disabled:opacity-40"
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
          <div className="mx-auto max-w-5xl p-5">
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
      <div className="flex flex-wrap gap-4">
        <MatrixCard title={`A. ${cmp.deckA.name}`} m={A} maxCell={maxCell} />
        <MatrixCard title={`B. ${cmp.deckB.name}`} m={B} maxCell={maxCell} />
        <DeltaCard cmp={cmp} scenario={scenario} />
      </div>
    </section>
  );
}

function MatrixCard({ title, m, maxCell }: { title: string; m: ComparisonMatrix; maxCell: number }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 p-3">
      <div className="mb-2 text-xs font-semibold text-ink-100">{title}</div>
      <MatrixGrid
        rowLabels={m.rowLabels}
        colLabels={m.colLabels}
        cells={m.cells}
        cellStyle={(v) => ({ background: `oklch(0.7 0.13 155 / ${(v / maxCell) * 0.85})` })}
        format={(v) => (v > 0.0005 ? (v * 100).toFixed(1) : '·')}
        cellTitle={(v) => pct(v, 2)}
      />
      {/* S / N retenus par scénario (§7.6) : rend visible l'effet de la classification. */}
      <div className="tnum mt-2 text-[10px] text-ink-500">
        deck {m.deckSize} cartes · S = {m.starterCount} starters · N = {m.nonEngineCount}{' '}
        non-engine
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
  const fmt = (d: number): string =>
    d === 0 ? '·' : `${d > 0 ? '+' : '−'}${(Math.abs(d) * 100).toFixed(1)}`;

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 p-3">
      <div className="mb-2 text-xs font-semibold text-ink-100">Δ (B − A), en points de %</div>
      <MatrixGrid
        rowLabels={A.rowLabels}
        colLabels={A.colLabels}
        cells={delta}
        cellStyle={style}
        format={fmt}
        cellTitle={(v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)} pt`}
      />
      {/* Légende OBLIGATOIRE (§5) : le signe n'est pas un jugement de valeur. */}
      <div className="mt-2 max-w-[240px] text-[10px] leading-snug text-ink-500">
        vert = probabilité plus élevée dans B — <em>pas nécessairement meilleur</em> (ex. colonne
        ne = 0). La synthèse ci-dessous donne le sens de lecture.
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
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-[10px]">
        <thead>
          <tr>
            <th className="p-1 text-ink-600">↓s \ ne→</th>
            {colLabels.map((c) => (
              <th key={c} className="tnum w-8 p-1 text-right text-ink-500">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.map((row, i) => (
            <tr key={i}>
              <td className="tnum p-1 text-right text-ink-500">{rowLabels[i]}</td>
              {row.map((v, j) => (
                <td
                  key={j}
                  title={cellTitle(v)}
                  className="tnum w-8 rounded p-1 text-right text-ink-100"
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
              <th className="p-2 text-right font-medium">A GF</th>
              <th className="p-2 text-right font-medium">B GF</th>
              <th className="p-2 text-right font-medium">Δ GF</th>
              <th className="p-2 text-right font-medium">A GS</th>
              <th className="p-2 text-right font-medium">B GS</th>
              <th className="p-2 text-right font-medium">Δ GS</th>
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
  const favorable = row.direction === 'lower_is_better' ? d < 0 : d > 0;
  const negligible = Math.abs(d) < (row.unit === 'percent' ? 0.0005 : 0.005);
  const cls = negligible ? 'text-ink-500' : favorable ? 'text-emerald-300' : 'text-red-400';
  const text = negligible
    ? '·'
    : row.unit === 'percent'
      ? `${d > 0 ? '+' : '−'}${(Math.abs(d) * 100).toFixed(1)}`
      : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
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
          <button onClick={onClose} className="text-ink-500 hover:text-ink-200">
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
