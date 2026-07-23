import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { sampleFromStore } from '../store/selectors.js';
import type { SampledHand } from '../engine/hand.js';
import { imageSmall } from '../types.js';
import { Segmented } from './ui.js';

export function HandWall({ column }: { column: 'first' | 'second' }) {
  const result = useDeck((s) => s.result);
  const importance = useDeck((s) => s.importance);
  const setImportance = useDeck((s) => s.setImportance);
  const cards = useDeck((s) => s.cards);
  const mainLen = useDeck((s) => s.main.length);

  const [col, setCol] = useState<'first' | 'second'>(column);
  const [count, setCount] = useState(60);
  const [batch, setBatch] = useState<SampledHand[]>([]);
  const [sortByNote, setSortByNote] = useState(true);
  const [minStarts, setMinStarts] = useState(0);
  const [minNe, setMinNe] = useState(0);
  const [onlyBricks, setOnlyBricks] = useState(false);

  const handSize = col === 'first' ? 5 : 6;

  const regenerate = useCallback(() => {
    setBatch(sampleFromStore(handSize, count));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handSize, count, importance, result]);

  useEffect(() => regenerate(), [regenerate]);

  const view = useMemo(() => {
    let v = batch.filter(
      (h) => h.starts >= minStarts && h.neTotal >= minNe && (!onlyBricks || h.starts === 0),
    );
    if (sortByNote) v = [...v].sort((a, b) => b.note - a.note || b.starts - a.starts);
    return v;
  }, [batch, minStarts, minNe, onlyBricks, sortByNote]);

  if (!result || mainLen === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        Charge un deck pour générer des mains de test.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Barre de contrôle. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-800 px-3 py-2 text-xs">
        <Segmented
          value={col}
          onChange={setCol}
          options={[
            { value: 'first', label: 'Going 1st · 5' },
            { value: 'second', label: 'Going 2nd · 6' },
          ]}
        />
        <button
          onClick={regenerate}
          className="rounded bg-ink-700 px-2.5 py-1 text-ink-100 hover:bg-ink-600"
        >
          ↻ Nouvelles mains
        </button>
        <label className="flex items-center gap-1 text-ink-400">
          n
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-ink-100"
          >
            {[30, 60, 120, 240].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1 text-ink-400">
          <span>importance non-engine</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}
            className="w-24 accent-emerald-500"
          />
          <span className="tnum w-8 text-right text-ink-200">{importance.toFixed(2)}</span>
        </div>

        <div className="ml-auto flex items-center gap-2 text-ink-400">
          <FilterStep label="starts ≥" value={minStarts} onChange={setMinStarts} max={6} />
          <FilterStep label="non-eng ≥" value={minNe} onChange={setMinNe} max={6} />
          <button
            onClick={() => setOnlyBricks((v) => !v)}
            className={`rounded px-2 py-1 ${onlyBricks ? 'bg-red-500/20 text-red-300' : 'bg-ink-800 text-ink-300'}`}
          >
            bricks
          </button>
          <button
            onClick={() => setSortByNote((v) => !v)}
            className={`rounded px-2 py-1 ${sortByNote ? 'bg-ink-700 text-ink-100' : 'bg-ink-800 text-ink-400'}`}
            title="Trier par note (sinon flux aléatoire)"
          >
            {sortByNote ? 'tri: note' : 'flux libre'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="mb-2 text-[11px] text-ink-500">
          {view.length} mains affichées{' '}
          {batch.length !== view.length ? `(sur ${batch.length} tirées)` : ''}
        </div>
        <div className="flex flex-col gap-1.5">
          {view.map((h, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md border border-ink-800 bg-ink-900 p-1.5"
            >
              <div className="flex gap-1">
                {h.cards.map((id, ci) => (
                  <img
                    key={ci}
                    src={cards[id]?.image_url_small ?? imageSmall(id)}
                    alt={cards[id]?.name ?? String(id)}
                    title={cards[id]?.name ?? String(id)}
                    loading="lazy"
                    className={`h-[68px] rounded ${
                      col === 'second' && ci === h.cards.length - 1
                        ? 'ring-2 ring-sky-400'
                        : ''
                    }`}
                  />
                ))}
              </div>
              <div className="ml-auto flex items-center gap-3 pr-1">
                <Recap label="starts" value={h.starts} tone={h.starts === 0 ? 'bad' : 'good'} />
                <Recap label="non-eng" value={h.neTotal} tone="neutral" />
                <NoteBadge note={h.note} />
              </div>
            </div>
          ))}
          {view.length === 0 && (
            <div className="p-6 text-center text-sm text-ink-500">
              Aucune main ne correspond à ces filtres.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Recap({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'good' | 'bad' | 'neutral';
}) {
  const color =
    tone === 'bad' ? 'text-red-400' : tone === 'good' ? 'text-emerald-300' : 'text-ink-200';
  return (
    <div className="text-center">
      <div className={`tnum text-sm font-semibold ${color}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-ink-600">{label}</div>
    </div>
  );
}

function NoteBadge({ note }: { note: number }) {
  const hue = (note / 10) * 140; // rouge → vert
  return (
    <div
      className="tnum flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-black"
      style={{ background: `oklch(0.78 0.15 ${hue})` }}
      title="Note = percentile parmi les mains de ce deck (§4.4)"
    >
      {note}
    </div>
  );
}

function FilterStep({
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
    <span className="flex items-center gap-1">
      <span>{label}</span>
      <button
        onClick={() => onChange(Math.max(0, value - 1))}
        className="h-5 w-5 rounded bg-ink-800 hover:bg-ink-700"
      >
        −
      </button>
      <span className="tnum w-4 text-center text-ink-100">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        className="h-5 w-5 rounded bg-ink-800 hover:bg-ink-700"
      >
        +
      </button>
    </span>
  );
}
