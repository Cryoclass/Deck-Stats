import { useEffect, useMemo, useState } from 'react';
import { api, type DeckSummary } from '../lib/api.js';
import type { Card } from '../types.js';
import { useRouter } from '../lib/router.js';
import { heatCell, heatDelta } from '../lib/colors.js';
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
import { compareSideOf, comparisonDeckOf, parseCompareTarget, sidedNotice, unprofiledWarning } from '../lib/comparison.js';
import { downloadComparisonXlsx } from '../lib/exportComparison.js';
import { slugify } from '../lib/exportDeck.js';
import { pct, num, matrixCell, deltaPoints, deltaCount } from '../lib/fmt.js';
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
      // Étape 10D : un côté peut être un deck sidé (segment `deck~adversaire~position`).
      const targets = [parseCompareTarget(a), parseCompareTarget(b)];
      const [da, db, lib] = await Promise.all([api.getDeck(targets[0].deckId), api.getDeck(targets[1].deckId), api.getLibrary()]);
      // Partie C : les textes de cartes des deux decks (plans compris) alimentent la fusion effective.
      const cards: Record<number, Card> = {};
      const ids = new Set<number>([da, db].flatMap((d) => [...d.cards.map((c) => c.card_id), ...(d.matchups ?? []).flatMap((m) => m.plans.flatMap((p) => [...p.outgoing, ...p.incoming].map((c) => c.card_id)))]));
      // Sans les textes, pas de défauts : l'erreur arrête la comparaison plutôt que d'afficher des chiffres faux.
      for (const c of await api.cardsByIds([...ids])) cards[c.id] = c;
      const decks = [da, db].map((d, i) => compareSideOf(d, lib, targets[i], cards));
      for (const { name, source } of decks) {
        const size = source.main.reduce((s, c) => s + c.copies, 0);
        if (size < 6) {
          throw new Error(
            `« ${name} » n'a que ${size} carte(s) en main deck — impossible de tirer une main de 6.`,
          );
        }
      }
      const unprofiled: ComparisonWarning[] = [];
      const results = await Promise.all(
        decks.map(async ({ name, source }) => {
          const { input, unprofiledCardIds } = buildEngineModel(source);
          const warning = unprofiledWarning(name, unprofiledCardIds);
          if (warning) unprofiled.push(warning);
          const { result } = await client.compute(input, 'passes').promise;
          return comparisonDeckOf(name, input, result);
        }),
      );
      const cmp = compareDecks(results[0], results[1]);
      // Q5 : signalé par deck (lib/comparison.ts), après les garde-fous du comparateur.
      cmp.warnings.push(...unprofiled);
      for (const side of decks) {
        const notice = sidedNotice(side);
        if (notice) cmp.warnings.push(notice);
      }
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
    <div className="flex h-[100dvh] flex-col bg-ink-950 text-fg-2">
      {/* Étape 7B (Q4, charte §6.3) : sous 400 px les actions passent sur une seconde ligne
          (flex-wrap) au lieu de couper leurs libellés ; les noms A / B prennent la place
          restante (basis-0, truncate) ; ⇄ Inverser et Exporter Excel mesurent 32 px. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 bg-ink-950 px-5 py-3">
        <button
          onClick={() => navigate({ name: 'home' })}
          className="flex h-8 items-center whitespace-nowrap rounded px-2 text-body text-fg-3 hover:bg-ink-800 hover:text-fg-1"
        >
          ← Mes decks
        </button>
        <h1 className="whitespace-nowrap text-value font-semibold text-fg-1">Comparateur</h1>
        {state.status === 'ready' && (
          <span className="min-w-0 flex-1 basis-0 truncate text-body text-fg-3">
            <span className="text-fg-2">A. {state.cmp.deckA.name}</span>
            {' vs '}
            <span className="text-fg-2">B. {state.cmp.deckB.name}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate({ name: 'compare', a: b, b: a })}
            title="Échanger référence et variante"
            className="flex h-8 items-center whitespace-nowrap rounded border border-ink-700 px-2.5 text-body text-fg-3 hover:bg-ink-800"
          >
            ⇄ Inverser A/B
          </button>
          <button
            onClick={onExport}
            disabled={state.status !== 'ready' || blocking.length > 0 || exporting}
            className="flex h-8 items-center whitespace-nowrap rounded bg-emerald-600 px-3 text-body font-medium text-black hover:bg-emerald-500 disabled:opacity-40"
          >
            {exporting ? 'Export…' : 'Exporter Excel'}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.status === 'loading' && (
          <div className="p-6 text-value text-fg-3">Calcul des quatre matrices…</div>
        )}
        {state.status === 'error' && (
          <div className="m-5 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-value text-neg">
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
  error: 'border-red-500/40 bg-red-500/10 text-neg',
  warning: 'border-amber-500/30 bg-amber-500/10 text-warn',
  info: 'border-sky-500/20 bg-sky-500/5 text-info/90',
};

function WarningsBanner({ warnings }: { warnings: ComparisonWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      {warnings.map((w, i) => (
        <div key={i} className={`rounded-md border px-3 py-1.5 text-body ${WARN_STYLES[w.severity]}`}>
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
      <h2 className="mb-2 text-body font-semibold uppercase tracking-wide text-fg-3">
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
      <div className="mb-2 truncate text-body font-semibold text-fg-1" title={title}>{title}</div>
      <MatrixGrid
        rowLabels={m.rowLabels}
        colLabels={m.colLabels}
        cells={m.cells}
        cellStyle={(v) => heatCell(v, maxCell)}
        format={matrixCell}
        cellTitle={(v) => pct(v, 2)}
      />
      {/* S / N retenus par scénario (§7.6) : rend visible l'effet de la classification. */}
      <div className="tnum mt-2 text-meta text-fg-3">
        deck {m.deckSize} cartes · S = {m.starterCount} starters · N = {m.nonEngineCount}{' '}
        non-engine étiquetées
      </div>
    </div>
  );
}

function DeltaCard({ cmp, scenario }: { cmp: DeckComparison; scenario: Scenario }) {
  const A = cmp.deckA.matrices[scenario];
  const delta = cmp.deltas[scenario];
  // Échelle divergente centrée sur 0, bornes ±2 points (§5) — formule partagée (lib/colors).
  return (
    <div className="col-span-2 rounded-lg border border-ink-800 bg-ink-900 p-1.5 sm:p-3">
      <div className="mb-2 text-body font-semibold text-fg-1">Δ (B − A), en points de %</div>
      {/* Étape 9 (réponse 4 de 7B) : Δ occupe toute la largeur sous 640 px, donc cellules de
          10 px et 32 px à toute largeur (jamais compactes). */}
      <MatrixGrid
        rowLabels={A.rowLabels}
        colLabels={A.colLabels}
        cells={delta}
        cellStyle={heatDelta}
        format={deltaPoints}
        cellTitle={(v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)} pt`}
        compact={false}
      />
      {/* Légende OBLIGATOIRE (§5) : le signe n'est pas un jugement de valeur. */}
      <div className="mt-2 max-w-[240px] text-meta leading-snug text-fg-3">
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
  compact = true,
}: {
  rowLabels: string[];
  colLabels: string[];
  cells: number[][];
  cellStyle: (v: number) => React.CSSProperties;
  format: (v: number) => string;
  cellTitle: (v: number) => string;
  /** Cellules compactes sous 640 px (A et B côte à côte) ; `false` = taille bureau partout (Δ). */
  compact?: boolean;
}) {
  // Cellules compactes sous 640 px (Q3, étape 7B) : espacement 1 px, largeur au contenu
  // avec un minimum de 20 px par colonne (sinon une colonne de « · » écrase son en-tête).
  // Audit 01, dérogation D2 : ce sont les SEULES cellules sous le plancher de 11 px, et
  // elles sont montées de 9 à 10 px (`text-cell`) ; dès 640 px, plancher commun.
  const table = compact ? 'border-spacing-px text-cell sm:border-spacing-0.5 sm:text-meta' : 'border-spacing-0.5 text-meta';
  const corner = compact ? 'px-px py-1 sm:p-1' : 'p-1';
  const head = compact ? 'min-w-5 px-px py-1 sm:w-8 sm:p-1' : 'w-8 p-1';
  const label = compact ? 'px-px py-1 sm:p-1' : 'p-1';
  return (
    <div className="overflow-x-auto">
      <table className={`border-separate ${table}`}>
        <thead>
          <tr>
            <th className={`${corner} text-fg-3`} title={STARTS_HINT}>
              <span className={compact ? 'sm:hidden' : 'hidden'}>S\U</span>
              <span className={compact ? 'hidden sm:inline' : ''}>↓S \ U→</span>
            </th>
            {colLabels.map((c) => (
              <th key={c} className={`tnum ${head} text-right text-fg-3`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.map((row, i) => (
            <tr key={i}>
              <td className={`tnum ${label} text-right text-fg-3`}>{rowLabels[i]}</td>
              {row.map((v, j) => (
                <td
                  key={j}
                  title={cellTitle(v)}
                  className={`tnum ${head} rounded text-right text-fg-1`}
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
      <h2 className="mb-2 text-body font-semibold uppercase tracking-wide text-fg-3">
        Synthèse — Δ coloré selon le sens souhaité
      </h2>
      <div className="overflow-x-auto rounded-lg border border-ink-800 bg-ink-900">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="border-b border-ink-800 text-meta uppercase tracking-wide text-fg-3">
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
                <td className="p-2 text-fg-3">{gf.label}</td>
                <td className="tnum p-2 text-right text-fg-1">{val(gf, gf.valueA)}</td>
                <td className="tnum p-2 text-right text-fg-1">{val(gf, gf.valueB)}</td>
                <DeltaCell row={gf} />
                <td className="tnum p-2 text-right text-fg-1">{val(gs, gs.valueA)}</td>
                <td className="tnum p-2 text-right text-fg-1">{val(gs, gs.valueB)}</td>
                <DeltaCell row={gs} />
                <td className="p-2 text-fg-3">
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
  const cls = d === 0 ? 'text-fg-3' : favorable ? 'text-pos' : 'text-neg';
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
    'w-full rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-value text-fg-1';

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
          <h2 className="text-head font-semibold text-fg-1">Comparer deux decks</h2>
          <button
            onClick={onClose}
            title="Fermer"
            className="flex h-8 w-8 items-center justify-center rounded text-fg-3 hover:bg-ink-800 hover:text-fg-2"
          >
            ✕
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-meta uppercase tracking-wide text-fg-3">
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
          <span className="mb-1 block text-meta uppercase tracking-wide text-fg-3">
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
          <span className="text-meta text-fg-3">
            Le delta se lit B − A : A est l'état de départ.
          </span>
          <button
            onClick={() => navigate({ name: 'compare', a, b: bSel })}
            disabled={!a || !bSel || a === bSel}
            className="rounded bg-emerald-600 px-3 py-1.5 text-value font-medium text-black hover:bg-emerald-500 disabled:opacity-40"
          >
            Comparer
          </button>
        </div>
        {a === bSel && a && (
          <div className="mt-2 text-meta text-warn">
            Même deck des deux côtés — choisis deux versions différentes.
          </div>
        )}
      </div>
    </div>
  );
}
