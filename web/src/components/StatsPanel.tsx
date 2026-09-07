import { useDeck } from '../store/deckStore.js';
import type { AnalysisContext, PassResult } from '../engine/types.js';
import { pct, num } from '../lib/fmt.js';
import { Bar } from './ui.js';
import { QueryMode } from './QueryMode.js';
import { toComparisonMatrix } from '../engine/compare.js';
import { CONTEXT_LABEL } from './Header.js';

/** Une vue = une distribution parcourable dans le panneau (itération 6). */
interface StatsView {
  id: string;
  label: string;
  hint?: string;
}

/** « Départs théoriques » (contrat §4) : sources de start disponibles dans la main
 *  observée, sans preuve qu'une ligne soit successivement réalisable. */
export const STARTS_LABEL = 'Départs théoriques';
export const STARTS_HINT =
  'Nombre S de sources de start disponibles dans la main observée (starter ou paire, conditions et disponibilités appliquées). Théorique : aucune ligne de jeu n’est prouvée réalisable.';

export function StatsPanel({ onShowHands }: { onShowHands?: () => void }) {
  const result = useDeck((s) => s.result);
  const liveCategories = useDeck((s) => s.categories);
  const computing = useDeck((s) => s.computing);
  const stale = useDeck((s) => s.stale);
  const computeError = useDeck((s) => s.computeError);
  const resultContext = useDeck((s) => s.resultContext);
  const recompute = useDeck((s) => s.recompute);
  const computeMs = useDeck((s) => s.computeMs);
  const liveDeckSize = useDeck((s) => s.main.reduce((a, c) => a + c.copies, 0));
  const context = useDeck((s) => s.context);
  const setContext = useDeck((s) => s.setContext);
  const statsView = useDeck((s) => s.statsView);
  const setStatsView = useDeck((s) => s.setStatsView);
  const cards = useDeck((s) => s.cards);

  if (!result) {
    // Sans résultat précédent : état initial de calcul, ou erreur avec relance (§6).
    return (
      <div className="p-4 text-sm text-ink-400">
        {computeError ? (
          <ComputeErrorNotice message={computeError} onRetry={recompute} standalone />
        ) : computing ? (
          <span role="status">Calcul initial des statistiques…</span>
        ) : (
          'Les statistiques apparaîtront ici dès qu’un deck est chargé.'
        )}
      </div>
    );
  }

  // Étape 4 : le résultat s'affiche avec SON contexte (catégories, taille de deck et
  // cartes sans profil du calcul), jamais avec les libellés de l'état courant — pas de
  // mélange d'anciennes statistiques avec de nouveaux labels.
  const categories = resultContext?.categories ?? liveCategories;
  const deckSize = resultContext?.deckSize ?? liveDeckSize;
  const unprofiled = resultContext?.unprofiledCardIds ?? [];
  const outOfBounds = deckSize < 40 || deckSize > 60;

  // Cycle : Départs théoriques → Non-engine (total) → une entrée par étiquette (§6).
  const views: StatsView[] = [
    { id: 'starts', label: STARTS_LABEL, hint: STARTS_HINT },
    { id: 'nonengine', label: 'Non-engine (potentiel)', hint: 'Potentiel U : copies distinctes affectables aux fenêtres retenues, plafonds et HOPT appliqués.' },
    ...categories.map((c) => ({ id: c.id, label: c.name, hint: 'Copies brutes piochées portant cette étiquette, sans fenêtre ni plafond.' })),
  ];
  let idx = views.findIndex((v) => v.id === statsView);
  if (idx < 0) idx = 0;
  const view = views[idx];
  // Navigation LINÉAIRE (pas de boucle) : « Départs théoriques » est le premier / défaut.
  const atFirst = idx === 0;
  const atLast = idx === views.length - 1;
  const go = (dir: number) => {
    const next = idx + dir;
    if (next >= 0 && next < views.length) setStatsView(views[next].id);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-ink-100">Probabilités</h2>
        <span className="tnum text-[10px] text-ink-500">
          {computing ? (
            <span role="status" className="rounded bg-ink-800 px-1.5 py-0.5 text-ink-300">
              Recalcul…
            </span>
          ) : computeError ? (
            <span className="text-red-300">calcul en échec</span>
          ) : (
            `${computeMs.toFixed(0)} ms`
          )}
        </span>
      </div>

      {/* Résultat périmé : dit explicitement, avec son contexte, et atténué plus bas. */}
      {stale &&
        (computeError ? (
          <ComputeErrorNotice message={computeError} onRetry={recompute} />
        ) : (
          <div
            role="status"
            className="border-b border-sky-500/20 bg-sky-500/5 px-3 py-1.5 text-[11px] text-sky-300/90"
          >
            Recalcul… Statistiques de la version précédente (deck de {deckSize} cartes) affichées
            en attendant.
          </div>
        ))}

      {outOfBounds && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
          Deck de {deckSize} cartes — hors bornes 40–60 (§D). Calcul effectué quand même.
        </div>
      )}

      {/* Q5 : cartes étiquetées sans profil, comptées zéro dans le potentiel — listées. */}
      {unprofiled.length > 0 && (
        <div
          role="status"
          className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300"
          title="Le profil de disponibilité (mode Profil) détermine les fenêtres retenues ; sans profil, la carte reste comptée dans les copies brutes de son étiquette mais pas dans le potentiel."
        >
          {unprofiled.length} carte{unprofiled.length > 1 ? 's' : ''} non-engine sans profil, non comptée
          {unprofiled.length > 1 ? 's' : ''} dans le potentiel :{' '}
          {unprofiled.map((id) => cards[id]?.name ?? `#${id}`).join(', ')}.
        </div>
      )}

      {/* Bascule de vue : flèches ◀ ▶ ou clic sur le titre. Aux extrémités, la flèche
          correspondante disparaît (on garde sa place pour ne pas décaler le titre). */}
      <div className="flex items-center justify-center gap-2 border-b border-ink-800 bg-ink-900 px-3 py-1.5">
        <button
          onClick={() => go(-1)}
          title="Distribution précédente"
          className={`rounded px-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100 ${
            atFirst ? 'invisible pointer-events-none' : ''
          }`}
        >
          ◀
        </button>
        <button
          onClick={() => go(1)}
          disabled={atLast}
          title={view.hint ?? (atLast ? undefined : 'Distribution suivante')}
          className="min-w-[150px] text-center text-xs font-semibold text-ink-100 enabled:hover:text-emerald-300 disabled:cursor-default"
        >
          {view.label}
        </button>
        <button
          onClick={() => go(1)}
          title="Distribution suivante"
          className={`rounded px-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100 ${
            atLast ? 'invisible pointer-events-none' : ''
          }`}
        >
          ▶
        </button>
      </div>
      {view.id === 'starts' && (
        <div className="border-b border-ink-800 px-3 py-1 text-[10px] leading-snug text-ink-500">
          Sources de start disponibles dans la main observée (starter ou paire), conditions et
          disponibilités appliquées — sans preuve qu’une ligne soit réalisable.
        </div>
      )}

      {/* Périmé = estompé par opacité (charte §7.15), jamais masqué ni flouté. */}
      <div className={`transition-opacity ${stale ? 'opacity-45' : ''}`}>
        <div className="grid grid-cols-1 gap-px bg-ink-800 sm:grid-cols-2">
          <PassColumn context="first" active={context === 'first'} onSelect={() => setContext('first')} pass={result.first} view={view} />
          <PassColumn context="second" active={context === 'second'} onSelect={() => setContext('second')} pass={result.second} view={view} />
        </div>

        <CrossMatrix pass={context === 'first' ? result.first : result.second} column={context} />
      </div>

      <QueryMode onShowHands={onShowHands} />
    </div>
  );
}

/** Réduit une distribution exacte (P(count=i)) aux 4 seaux d'affichage 0/1/2/≥3. */
function toBuckets(dist: number[]): [number, number, number, number] {
  const b0 = dist[0] ?? 0;
  const b1 = dist[1] ?? 0;
  const b2 = dist[2] ?? 0;
  let b3 = 0;
  for (let i = 3; i < dist.length; i++) b3 += dist[i] ?? 0;
  return [b0, b1, b2, b3];
}

interface Resolved {
  buckets: [number, number, number, number];
  color: string;
  mean: number;
  meanLabel: string;
  extra?: string;
}

function resolveView(pass: PassResult, viewId: string): Resolved {
  if (viewId === 'starts') {
    return {
      buckets: [
        pass.startsBuckets[0] ?? 0,
        pass.startsBuckets[1] ?? 0,
        pass.startsBuckets[2] ?? 0,
        pass.startsBuckets[3] ?? 0,
      ],
      color: '#4fae7a',
      mean: pass.meanStarts,
      meanLabel: 'E[S]',
      extra: `brick ${pct(pass.brick)} · E[red.] ${num(meanFromDist(pass.redundancy))}`,
    };
  }
  if (viewId === 'nonengine') {
    return {
      buckets: toBuckets(pass.nonEngine),
      color: '#5b8def',
      mean: pass.meanNonEngine,
      meanLabel: 'E[U]',
    };
  }
  const cat = pass.perCategory.find((c) => c.id === viewId);
  if (!cat) return { buckets: [0, 0, 0, 0], color: '#5b8def', mean: 0, meanLabel: '' };
  return {
    buckets: toBuckets(cat.dist),
    color: '#5b8def',
    mean: cat.mean,
    meanLabel: 'E[copies]',
  };
}

function PassColumn({
  context,
  active,
  onSelect,
  pass,
  view,
}: {
  context: AnalysisContext;
  active: boolean;
  onSelect: () => void;
  pass: PassResult;
  view: StatsView;
}) {
  const title = CONTEXT_LABEL[context];
  if (pass.total === 0) return <div className="bg-ink-900 p-3 text-xs text-amber-300">{title} : analyse indisponible. {pass.unavailableReason}</div>;
  const r = resolveView(pass, view.id);
  return (
    <div className={`bg-ink-900 p-3 ${active ? '' : 'opacity-80'}`}>
      <div className="mb-2 flex items-baseline justify-between">
        <button
          onClick={onSelect}
          title="Choisir ce contexte d’analyse (deltas, matrice, mur de mains)"
          className={`rounded px-1 text-xs font-semibold ${active ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:text-ink-100'}`}
        >
          {title}
        </button>
        <span className="text-[10px] text-ink-500">
          {context === 'first' ? 'C(D,5) mains' : 'sixième pioche identifiée'}
        </span>
      </div>
      <DistTable {...r} />
    </div>
  );
}

/** Table 0/1/2/≥3 avec colonnes « exact » et « cumulé » (au moins n) — §6. */
function DistTable({ buckets, color, mean, meanLabel, extra }: Resolved) {
  const [, b1, b2, b3] = buckets;
  const labels = ['0', '1', '2', '≥3'];
  // Cumulé = P(≥ n). Ligne 0 = trivialement 100 % → affiché « — ».
  const cum: Array<number | null> = [null, b1 + b2 + b3, b2 + b3, b3];

  return (
    <>
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-500">
        <span className="w-5" />
        <span className="flex-1" />
        <span className="w-11 text-right">exact</span>
        <span className="w-11 text-right">cumulé</span>
      </div>
      <div className="flex flex-col gap-1">
        {buckets.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="tnum w-5 text-right text-xs text-ink-400">{labels[i]}</span>
            <div className="flex-1">
              <Bar value={b} color={color} />
            </div>
            <span className="tnum w-11 text-right text-xs text-ink-100">{pct(b)}</span>
            <span className="tnum w-11 text-right text-xs text-ink-400">
              {cum[i] === null ? '—' : pct(cum[i]!)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 border-t border-ink-800 pt-2 text-xs text-ink-400">
        {extra && <span>{extra}</span>}
        <span className="ml-auto">
          {meanLabel} <span className="tnum text-ink-100">{num(mean)}</span>
        </span>
      </div>
    </>
  );
}

export function CrossMatrix({ pass, column }: { pass: PassResult; column: 'first' | 'second' }) {
  if (pass.total === 0) return <div className="p-3 text-xs text-amber-300">Matrice indisponible. {pass.unavailableReason}</div>;
  const matrix = toComparisonMatrix(pass, column === 'first' ? 'going_first' : 'going_second', { starterCount: 0, nonEngineCount: 0 });
  const maxNe = Math.max(1, pass.nonEngine.length - 1);
  const cols = Array.from({ length: Math.min(maxNe, 5) + 1 }, (_, i) => i);
  const rows = [0, 1, 2, 3];
  const rowLabels = ['0', '1', '2', '≥3'];
  const maxCell = Math.max(
    ...rows.flatMap((r) => cols.map((c) => matrix.cells[r][c])),
    1e-9,
  );

  return (
    <div className="border-t border-ink-800 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-ink-500" title={STARTS_HINT}>
        Matrice départs théoriques × non-engine — {CONTEXT_LABEL[column]}
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-[10px]">
          <thead>
            <tr>
              <th className="p-1 text-ink-600" title="lignes : départs théoriques S ; colonnes : potentiel non-engine U">↓S \ U→</th>
              {cols.map((c) => (
                <th key={c} className="tnum p-1 text-right text-ink-500">
                  {matrix.colLabels[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                <td className="tnum p-1 text-right text-ink-500">{rowLabels[ri]}</td>
                {cols.map((c) => {
                  const v = matrix.cells[r][c];
                  return (
                    <td
                      key={c}
                      title={pct(v)}
                      className="tnum rounded p-1 text-right text-ink-100"
                      style={{ background: `oklch(0.7 0.13 155 / ${(v / maxCell) * 0.85})` }}
                    >
                      {v > 0.0005 ? (v * 100).toFixed(1) : '·'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function meanFromDist(dist: number[]): number {
  return dist.reduce((s, p, i) => s + (p ?? 0) * i, 0);
}

/** Erreur de calcul (charte §7.12) avec relance. L'ancien résultat, s'il existe, reste
 *  affiché et est explicitement dit obsolète ; sans résultat, le bandeau est seul. */
function ComputeErrorNotice({
  message,
  onRetry,
  standalone = false,
}: {
  message: string;
  onRetry: () => void;
  standalone?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`${standalone ? 'rounded-lg border' : 'border-b'} border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300`}
    >
      {standalone ? 'Le calcul a échoué' : 'Statistiques obsolètes : le recalcul a échoué'} — {message}
      <button
        onClick={onRetry}
        className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-red-200 hover:bg-red-500/30"
      >
        Relancer
      </button>
    </div>
  );
}
