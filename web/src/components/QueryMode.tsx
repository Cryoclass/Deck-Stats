import { useMemo, useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import type { PassResult } from '../engine/types.js';
import { pct } from '../lib/fmt.js';

export function QueryMode() {
  const result = useDeck((s) => s.result);
  const categories = useDeck((s) => s.categories);

  const [minStarts, setMinStarts] = useState(1);
  const [minRedundancy, setMinRedundancy] = useState(0);
  const [catMins, setCatMins] = useState<Record<string, number>>({});

  const catIndex = useMemo(
    () => new Map(categories.map((c, i) => [c.id, i])),
    [categories],
  );

  const evalPass = (pass: PassResult): number => {
    let p = 0;
    for (const b of pass.buckets) {
      if (b.starts < minStarts) continue;
      if (b.redundancy < minRedundancy) continue;
      let ok = true;
      for (const [id, min] of Object.entries(catMins)) {
        if (min <= 0) continue;
        const idx = catIndex.get(id);
        if (idx === undefined || (b.catCounts[idx] ?? 0) < min) {
          ok = false;
          break;
        }
      }
      if (ok) p += b.p;
    }
    return p;
  };

  if (!result) return null;
  const pFirst = evalPass(result.first);
  const pSecond = evalPass(result.second);

  return (
    <div className="border-t border-ink-800 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-ink-500">Mode requête (§3.3)</div>
      <div className="flex flex-col gap-1.5">
        <Cond label="Starts ≥" value={minStarts} onChange={setMinStarts} max={6} />
        <Cond label="Redondance ≥" value={minRedundancy} onChange={setMinRedundancy} max={10} />
        {categories.map((c) => (
          <Cond
            key={c.id}
            label={`${c.name} ≥`}
            value={catMins[c.id] ?? 0}
            onChange={(v) => setCatMins((m) => ({ ...m, [c.id]: v }))}
            max={6}
          />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <QueryResult label="Going first" value={pFirst} />
        <QueryResult label="Going second" value={pSecond} />
      </div>
    </div>
  );
}

function Cond({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-ink-300">{label}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          className="h-5 w-5 rounded bg-ink-800 text-ink-300 hover:bg-ink-700"
        >
          −
        </button>
        <span className="tnum w-5 text-center text-xs text-ink-100">{value}</span>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          className="h-5 w-5 rounded bg-ink-800 text-ink-300 hover:bg-ink-700"
        >
          +
        </button>
      </div>
    </div>
  );
}

function QueryResult({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 p-2 text-center">
      <div className="text-[10px] text-ink-500">{label}</div>
      <div className="tnum text-xl font-semibold text-emerald-300">{pct(value, 1)}</div>
    </div>
  );
}
