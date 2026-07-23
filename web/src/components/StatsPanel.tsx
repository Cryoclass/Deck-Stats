import { useDeck } from '../store/deckStore.js';
import type { PassResult } from '../engine/types.js';
import { pct, num } from '../lib/fmt.js';
import { Bar } from './ui.js';
import { QueryMode } from './QueryMode.js';

/** Une vue = une distribution parcourable dans le panneau (itération 6). */
interface StatsView {
  id: string;
  label: string;
}

export function StatsPanel({ column }: { column: 'first' | 'second' }) {
  const result = useDeck((s) => s.result);
  const categories = useDeck((s) => s.categories);
  const computing = useDeck((s) => s.computing);
  const computeMs = useDeck((s) => s.computeMs);
  const deckSize = useDeck((s) => s.main.reduce((a, c) => a + c.copies, 0));
  const horizonFirst = useDeck((s) => s.horizonFirst);
  const horizonSecond = useDeck((s) => s.horizonSecond);
  const setHorizon = useDeck((s) => s.setHorizon);
  const statsView = useDeck((s) => s.statsView);
  const setStatsView = useDeck((s) => s.setStatsView);

  if (!result) {
    return (
      <div className="p-4 text-sm text-ink-400">
        Les statistiques apparaîtront ici dès qu'un deck est chargé.
      </div>
    );
  }

  const outOfBounds = deckSize < 40 || deckSize > 60;

  // Cycle : Starts jouables → Non-engine (total) → une entrée par catégorie (§6).
  const views: StatsView[] = [
    { id: 'starts', label: 'Starts jouables' },
    { id: 'nonengine', label: 'Non-engine (total)' },
    ...categories.map((c) => ({ id: c.id, label: c.name })),
  ];
  let idx = views.findIndex((v) => v.id === statsView);
  if (idx < 0) idx = 0;
  const view = views[idx];
  const cycle = (dir: number) => setStatsView(views[(idx + dir + views.length) % views.length].id);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-ink-100">Probabilités</h2>
        <span className="tnum text-[10px] text-ink-500">
          {computing ? 'calcul…' : `${computeMs.toFixed(0)} ms`}
        </span>
      </div>

      {outOfBounds && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
          Deck de {deckSize} cartes — hors bornes 40–60 (§D). Calcul effectué quand même.
        </div>
      )}

      <div
        className="flex items-center gap-3 border-b border-ink-800 px-3 py-1.5"
        title="Nombre de tours adverses pendant lesquels une carte HOPT non-engine reste activable (§B.3.5). Plafonne son comptage à min(copies, horizon). Hypothèse de jeu — n'affecte pas les combos."
      >
        <span className="text-[10px] uppercase tracking-wide text-ink-500">Horizon d’interaction</span>
        <HorizonStepper label="1st" value={horizonFirst} onChange={(v) => setHorizon('first', v)} />
        <HorizonStepper label="2nd" value={horizonSecond} onChange={(v) => setHorizon('second', v)} />
      </div>

      {/* Bascule de vue : flèches ◀ ▶ ou clic sur le titre. */}
      <div className="flex items-center justify-center gap-2 border-b border-ink-800 bg-ink-900 px-3 py-1.5">
        <button
          onClick={() => cycle(-1)}
          title="Distribution précédente"
          className="rounded px-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          ◀
        </button>
        <button
          onClick={() => cycle(1)}
          title="Distribution suivante"
          className="min-w-[150px] text-center text-xs font-semibold text-ink-100 hover:text-emerald-300"
        >
          {view.label}
        </button>
        <button
          onClick={() => cycle(1)}
          title="Distribution suivante"
          className="rounded px-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          ▶
        </button>
      </div>

      <div className="grid grid-cols-2 gap-px bg-ink-800">
        <PassColumn title="Going first" subtitle="main de 5" pass={result.first} view={view} />
        <PassColumn title="Going second" subtitle="main de 6" pass={result.second} view={view} />
      </div>

      <CrossMatrix pass={column === 'first' ? result.first : result.second} column={column} />

      <QueryMode />
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
  relevant: boolean;
  buckets: [number, number, number, number];
  color: string;
  mean: number;
  meanLabel: string;
  extra?: string;
}

function resolveView(pass: PassResult, viewId: string): Resolved {
  if (viewId === 'starts') {
    return {
      relevant: true,
      buckets: [
        pass.startsBuckets[0] ?? 0,
        pass.startsBuckets[1] ?? 0,
        pass.startsBuckets[2] ?? 0,
        pass.startsBuckets[3] ?? 0,
      ],
      color: '#4fae7a',
      mean: pass.meanStarts,
      meanLabel: 'E[starts]',
      extra: `brick ${pct(pass.brick)} · E[red.] ${num(meanFromDist(pass.redundancy))}`,
    };
  }
  if (viewId === 'nonengine') {
    return {
      relevant: true,
      buckets: toBuckets(pass.nonEngine),
      color: '#5b8def',
      mean: pass.meanNonEngine,
      meanLabel: 'E[non-engine]',
    };
  }
  const cat = pass.perCategory.find((c) => c.id === viewId);
  if (!cat) return { relevant: false, buckets: [0, 0, 0, 0], color: '#5b8def', mean: 0, meanLabel: '' };
  return {
    relevant: cat.relevant,
    buckets: toBuckets(cat.dist),
    color: '#5b8def',
    mean: cat.mean,
    meanLabel: 'E[copies]',
  };
}

function PassColumn({
  title,
  subtitle,
  pass,
  view,
}: {
  title: string;
  subtitle: string;
  pass: PassResult;
  view: StatsView;
}) {
  const r = resolveView(pass, view.id);
  return (
    <div className="bg-ink-900 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-ink-100">{title}</span>
        <span className="text-[10px] text-ink-500">{subtitle}</span>
      </div>
      {!r.relevant ? (
        <div className="rounded border border-ink-800 bg-ink-850 px-2 py-3 text-center text-[11px] text-ink-500">
          « {view.label} » n'est pas pertinent {title.toLowerCase()} (§2.6).
        </div>
      ) : (
        <DistTable {...r} />
      )}
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

function CrossMatrix({ pass, column }: { pass: PassResult; column: 'first' | 'second' }) {
  const maxNe = Math.max(1, pass.nonEngine.length - 1);
  const cols = Array.from({ length: Math.min(maxNe, 5) + 1 }, (_, i) => i);
  const rows = [0, 1, 2, 3];
  const rowLabels = ['0', '1', '2', '≥3'];
  const maxCell = Math.max(
    ...rows.flatMap((r) => cols.map((c) => pass.crossMatrix[r]?.[c] ?? 0)),
    1e-9,
  );

  return (
    <div className="border-t border-ink-800 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-ink-500">
        Matrice starts × non-engine — {column === 'first' ? 'going first' : 'going second'}
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-[10px]">
          <thead>
            <tr>
              <th className="p-1 text-ink-600">↓s \ ne→</th>
              {cols.map((c) => (
                <th key={c} className="tnum p-1 text-right text-ink-500">
                  {c === cols.length - 1 && maxNe > 5 ? `${c}+` : c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                <td className="tnum p-1 text-right text-ink-500">{rowLabels[ri]}</td>
                {cols.map((c) => {
                  const v = pass.crossMatrix[r]?.[c] ?? 0;
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

/** Stepper compact 1..3 pour l'horizon d'une passe (§B.3.5). */
function HorizonStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-ink-400">{label}</span>
      <div className="flex items-center rounded border border-ink-700 bg-ink-850">
        <button
          onClick={() => onChange(value - 1)}
          disabled={value <= 1}
          className="px-1.5 py-0.5 text-xs text-ink-300 hover:text-ink-100 disabled:opacity-30"
          title="Diminuer l’horizon"
        >
          −
        </button>
        <span className="tnum w-3 text-center text-[11px] text-ink-100">{value}</span>
        <button
          onClick={() => onChange(value + 1)}
          disabled={value >= 3}
          className="px-1.5 py-0.5 text-xs text-ink-300 hover:text-ink-100 disabled:opacity-30"
          title="Augmenter l’horizon"
        >
          +
        </button>
      </div>
    </div>
  );
}

function meanFromDist(dist: number[]): number {
  return dist.reduce((s, p, i) => s + (p ?? 0) * i, 0);
}
