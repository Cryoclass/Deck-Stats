import { useDeck } from '../store/deckStore.js';
import type { PassResult } from '../engine/types.js';
import { pct, num } from '../lib/fmt.js';
import { Bar } from './ui.js';
import { QueryMode } from './QueryMode.js';

export function StatsPanel({ column }: { column: 'first' | 'second' }) {
  const result = useDeck((s) => s.result);
  const categories = useDeck((s) => s.categories);
  const computing = useDeck((s) => s.computing);
  const computeMs = useDeck((s) => s.computeMs);
  const deckSize = useDeck((s) => s.main.reduce((a, c) => a + c.copies, 0));
  const horizonFirst = useDeck((s) => s.horizonFirst);
  const horizonSecond = useDeck((s) => s.horizonSecond);
  const setHorizon = useDeck((s) => s.setHorizon);

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  if (!result) {
    return (
      <div className="p-4 text-sm text-ink-400">
        Les statistiques apparaîtront ici dès qu'un deck est chargé.
      </div>
    );
  }

  const outOfBounds = deckSize < 40 || deckSize > 60;

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

      <div className="grid grid-cols-2 gap-px bg-ink-800">
        <PassColumn title="Going first" subtitle="main de 5" pass={result.first} catName={catName} />
        <PassColumn title="Going second" subtitle="main de 6" pass={result.second} catName={catName} />
      </div>

      <CrossMatrix pass={column === 'first' ? result.first : result.second} column={column} />

      <QueryMode />
    </div>
  );
}

function PassColumn({
  title,
  subtitle,
  pass,
  catName,
}: {
  title: string;
  subtitle: string;
  pass: PassResult;
  catName: (id: string) => string;
}) {
  const startLabels = ['0', '1', '2', '≥3'];
  const startColors = ['#e05a5a', '#7c8598', '#4fae7a', '#3ddc84'];
  return (
    <div className="bg-ink-900 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-ink-100">{title}</span>
        <span className="text-[10px] text-ink-500">{subtitle}</span>
      </div>

      <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-500">Starts jouables</div>
      <div className="flex flex-col gap-1">
        {pass.startsBuckets.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="tnum w-5 text-right text-xs text-ink-400">{startLabels[i]}</span>
            <div className="flex-1">
              <Bar value={p} color={startColors[i]} />
            </div>
            <span className="tnum w-12 text-right text-xs text-ink-100">{pct(p)}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-between border-t border-ink-800 pt-2 text-xs">
        <span className="text-ink-400">
          Brick <span className="tnum text-red-400">{pct(pass.brick)}</span>
        </span>
        <span className="text-ink-400">
          E[starts] <span className="tnum text-ink-100">{num(pass.meanStarts)}</span>
        </span>
        <span className="text-ink-400">
          E[red.] <span className="tnum text-ink-100">{num(meanFromDist(pass.redundancy))}</span>
        </span>
      </div>

      <div className="mt-3 mb-1 text-[10px] uppercase tracking-wide text-ink-500">
        Non-engine <span className="text-ink-600">· E {num(pass.meanNonEngine)}</span>
      </div>
      <div className="flex flex-col gap-1">
        {pass.perCategory.length === 0 && (
          <span className="text-[11px] text-ink-600">aucune catégorie</span>
        )}
        {pass.perCategory.map((c) => {
          const pAtLeast1 = 1 - (c.dist[0] ?? 1);
          return (
            <div
              key={c.id}
              className={`flex items-center gap-2 ${c.relevant ? '' : 'opacity-40'}`}
              title={c.relevant ? '' : 'non pertinent pour cette colonne (§2.6)'}
            >
              <span className="w-20 truncate text-[11px] text-ink-300">{catName(c.id)}</span>
              <div className="flex-1">
                <Bar value={pAtLeast1} color="#5b8def" />
              </div>
              <span className="tnum w-16 text-right text-[11px] text-ink-400">
                ≥1 {pct(pAtLeast1, 0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
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
