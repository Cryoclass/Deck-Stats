import { useDeck } from '../store/deckStore.js';
import type { AnalysisContext, PassResult } from '../engine/types.js';
import { pct, num, matrixCell } from '../lib/fmt.js';
import { heatCell } from '../lib/colors.js';
import { Bar, Segmented } from './ui.js';
import { QueryMode } from './QueryMode.js';
import { toComparisonMatrix } from '../engine/compare.js';
import { CONTEXT_LABEL, CONTEXT_SHORT, CONTEXT_TITLE } from './Header.js';
import { cumulativeOf, resolveView, type Resolved, type StatsView } from '../lib/statsViews.js';

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
      <div className="p-4 text-value text-fg-3">
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ink-800 px-3 py-2">
        <h2 className="text-value font-semibold text-fg-1">Probabilités</h2>
        {/* Réglage de contexte (étape 5B) : descendu de l'en-tête (audit 01 §4) jusqu'ici,
            à côté des chiffres qu'il gouverne. Le mur de mains garde le sien. */}
        <div className="flex items-center gap-1.5 text-meta text-fg-3" title={CONTEXT_TITLE}>
          <span>contexte</span>
          <Segmented
            size="sm"
            value={context}
            onChange={setContext}
            options={[
              { value: 'first', label: CONTEXT_SHORT.first, title: CONTEXT_LABEL.first },
              { value: 'second', label: CONTEXT_SHORT.second, title: CONTEXT_LABEL.second },
            ]}
          />
        </div>
        <span className="tnum ml-auto text-meta text-fg-3">
          {computing ? (
            <span role="status" className="rounded bg-ink-800 px-1.5 py-0.5 text-fg-3">
              Recalcul…
            </span>
          ) : computeError ? (
            <span className="text-neg">calcul en échec</span>
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
            className="border-b border-sky-500/20 bg-sky-500/5 px-3 py-1.5 text-meta text-info/90"
          >
            Recalcul… Statistiques de la version précédente (deck de {deckSize} cartes) affichées
            en attendant.
          </div>
        ))}

      {outOfBounds && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-meta text-warn">
          Deck de {deckSize} cartes — hors des bornes 40 à 60 du format. Calcul effectué quand même.
        </div>
      )}

      {/* Q5 : cartes étiquetées sans profil, comptées zéro dans le potentiel — listées. */}
      {unprofiled.length > 0 && (
        <div
          role="status"
          className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-meta text-warn"
          title="Le profil de disponibilité (mode Non-engine ou menu ⋯ de la carte) détermine les fenêtres retenues ; sans profil, la carte reste comptée dans les copies brutes de son étiquette mais pas dans le potentiel."
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
          className={`flex h-8 w-8 items-center justify-center rounded text-fg-3 hover:bg-ink-800 hover:text-fg-1 ${
            atFirst ? 'invisible pointer-events-none' : ''
          }`}
        >
          ◀
        </button>
        <button
          onClick={() => go(1)}
          disabled={atLast}
          title={view.hint ?? (atLast ? undefined : 'Distribution suivante')}
          className="h-8 min-w-[150px] rounded px-2 text-center text-body font-semibold text-fg-1 enabled:hover:text-pos disabled:cursor-default"
        >
          {view.label}
        </button>
        <button
          onClick={() => go(1)}
          title="Distribution suivante"
          className={`flex h-8 w-8 items-center justify-center rounded text-fg-3 hover:bg-ink-800 hover:text-fg-1 ${
            atLast ? 'invisible pointer-events-none' : ''
          }`}
        >
          ▶
        </button>
      </div>
      {view.id === 'starts' && (
        <div className="border-b border-ink-800 px-3 py-1 text-meta leading-snug text-fg-3">
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

// Seaux, cumulés et moyennes : lib/statsViews.ts (pur, partagé avec le test d'identité).

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
  if (pass.total === 0) return <div className="bg-ink-900 p-3 text-body text-warn">{title} : analyse indisponible. {pass.unavailableReason}</div>;
  const r = resolveView(pass, view.id);
  return (
    <div className={`bg-ink-900 p-3 ${active ? '' : 'opacity-80'}`}>
      <div className="mb-2 flex items-baseline justify-between">
        <button
          onClick={onSelect}
          title="Choisir ce contexte d’analyse (deltas, matrice, mur de mains)"
          className={`h-6 rounded px-1.5 text-body font-semibold ${active ? 'bg-ink-700 text-fg-1' : 'text-fg-3 hover:text-fg-1'}`}
        >
          {title}
        </button>
        <span className="text-meta text-fg-3">
          {context === 'first' ? 'les 5 cartes initiales' : 'sixième pioche identifiée'}
        </span>
      </div>
      <DistTable {...r} />
    </div>
  );
}

/** Table 0/1/2/≥3 avec colonnes « exact » et « cumulé » (au moins n) — §6. */
function DistTable({ buckets, color, mean, meanLabel, extra }: Resolved) {
  const labels = ['0', '1', '2', '≥3'];
  // Cumulé = P(≥ n). Ligne 0 = trivialement 100 % → affiché « — ».
  const cum = cumulativeOf(buckets);

  return (
    <>
      <div className="mb-1 flex items-center gap-2 text-meta uppercase tracking-wide text-fg-3">
        <span className="w-5" />
        <span className="flex-1" />
        <span className="w-11 text-right">exact</span>
        <span className="w-11 text-right">cumulé</span>
      </div>
      <div className="flex flex-col gap-1">
        {buckets.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="tnum w-5 text-right text-body text-fg-3">{labels[i]}</span>
            <div className="flex-1">
              <Bar value={b} color={color} />
            </div>
            <span className="tnum w-11 text-right text-body text-fg-1">{pct(b)}</span>
            <span className="tnum w-11 text-right text-body text-fg-3">
              {cum[i] === null ? '—' : pct(cum[i]!)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 border-t border-ink-800 pt-2 text-body text-fg-3">
        {extra && <span>{extra}</span>}
        <span className="ml-auto">
          {meanLabel} <span className="tnum text-fg-1">{num(mean)}</span>
        </span>
      </div>
    </>
  );
}

export function CrossMatrix({ pass, column }: { pass: PassResult; column: 'first' | 'second' }) {
  if (pass.total === 0) return <div className="p-3 text-body text-warn">Matrice indisponible. {pass.unavailableReason}</div>;
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
      <div className="mb-2 text-meta uppercase tracking-wide text-fg-3" title={STARTS_HINT}>
        Matrice départs théoriques × non-engine — {CONTEXT_LABEL[column]}
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-meta">
          <thead>
            <tr>
              <th className="p-1 text-fg-3" title="lignes : départs théoriques S ; colonnes : potentiel non-engine U">↓S \ U→</th>
              {cols.map((c) => (
                <th key={c} className="tnum p-1 text-right text-fg-3">
                  {matrix.colLabels[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                <td className="tnum p-1 text-right text-fg-3">{rowLabels[ri]}</td>
                {cols.map((c) => {
                  const v = matrix.cells[r][c];
                  return (
                    <td
                      key={c}
                      title={pct(v)}
                      className="tnum rounded p-1 text-right text-fg-1"
                      style={heatCell(v, maxCell)}
                    >
                      {matrixCell(v)}
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
      className={`${standalone ? 'rounded-lg border' : 'border-b'} border-red-500/40 bg-red-500/10 px-3 py-1.5 text-meta text-neg`}
    >
      {standalone ? 'Le calcul a échoué' : 'Statistiques obsolètes : le recalcul a échoué'} — {message}
      <button
        onClick={onRetry}
        className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-neg hover:bg-red-500/30"
      >
        Relancer
      </button>
    </div>
  );
}
