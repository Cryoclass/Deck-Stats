import { useMemo, useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import type { Relevance } from '../types.js';
import { Segmented } from './ui.js';

export function ComboList() {
  const pairs = useDeck((s) => s.pairs);
  const excl = useDeck((s) => s.pairExclusions);
  const main = useDeck((s) => s.main);
  const cards = useDeck((s) => s.cards);
  const setPairExcluded = useDeck((s) => s.setPairExcluded);
  const removePairFromLibrary = useDeck((s) => s.removePairFromLibrary);
  const togglePair = useDeck((s) => s.togglePair);

  const inMain = useMemo(() => new Set(main.map((c) => c.cardId)), [main]);
  const name = (id: number) => cards[id]?.name ?? `#${id}`;

  const [a, setA] = useState<number | ''>('');
  const [b, setB] = useState<number | ''>('');

  const applicable = pairs.filter((p) => inMain.has(p.card_a_id) && inMain.has(p.card_b_id));
  const inapplicable = pairs.filter((p) => !inMain.has(p.card_a_id) || !inMain.has(p.card_b_id));

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      {/* Ajout d'une paire depuis les cartes du main deck. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-ink-800 bg-ink-900 p-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-400">Nouveau combo</span>
        <select
          value={a}
          onChange={(e) => setA(e.target.value ? Number(e.target.value) : '')}
          className="max-w-[42%] flex-1 rounded border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-ink-100"
        >
          <option value="">carte A…</option>
          {main.map((m) => (
            <option key={m.cardId} value={m.cardId}>
              {name(m.cardId)}
            </option>
          ))}
        </select>
        <span className="text-ink-500">+</span>
        <select
          value={b}
          onChange={(e) => setB(e.target.value ? Number(e.target.value) : '')}
          className="max-w-[42%] flex-1 rounded border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-ink-100"
        >
          <option value="">carte B…</option>
          {main.map((m) => (
            <option key={m.cardId} value={m.cardId}>
              {name(m.cardId)}
            </option>
          ))}
        </select>
        <button
          disabled={a === '' || b === '' || a === b}
          onClick={() => {
            if (a !== '' && b !== '' && a !== b) {
              togglePair(a, b);
              setA('');
              setB('');
            }
          }}
          className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-black disabled:opacity-40"
        >
          Ajouter
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {applicable.length === 0 && (
          <li className="px-1 py-2 text-xs text-ink-500">Aucun combo applicable à ce deck.</li>
        )}
        {applicable.map((p) => {
          const active = !excl.has(p.id);
          return (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-md border border-ink-800 bg-ink-900 px-2 py-1.5 text-sm"
            >
              <button
                onClick={() => setPairExcluded(p.id, active)}
                title={active ? 'Désactiver pour ce deck' : 'Réactiver'}
                className={`h-4 w-4 shrink-0 rounded-sm border ${active ? 'border-emerald-400 bg-emerald-400' : 'border-ink-500'}`}
              />
              <span className={active ? 'text-ink-100' : 'text-ink-500 line-through'}>
                {name(p.card_a_id)} <span className="text-ink-500">+</span> {name(p.card_b_id)}
              </span>
              <button
                onClick={() => removePairFromLibrary(p.id)}
                title="Supprimer définitivement de la bibliothèque"
                className="ml-auto rounded px-1.5 text-ink-600 hover:bg-red-500/10 hover:text-red-400"
              >
                supprimer
              </button>
            </li>
          );
        })}
      </ul>

      {inapplicable.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-500">
            Conservés en bibliothèque, carte absente du deck (§D)
          </div>
          <ul className="flex flex-col gap-1">
            {inapplicable.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-md border border-ink-850 px-2 py-1 text-xs text-ink-500"
              >
                {name(p.card_a_id)} + {name(p.card_b_id)}
                <button
                  onClick={() => removePairFromLibrary(p.id)}
                  className="ml-auto rounded px-1.5 hover:bg-red-500/10 hover:text-red-400"
                >
                  supprimer
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <CategoryManager />
    </div>
  );
}

function CategoryManager() {
  const categories = useDeck((s) => s.categories);
  const cardCategories = useDeck((s) => s.cardCategories);
  const addCategory = useDeck((s) => s.addCategory);
  const deleteCategory = useDeck((s) => s.deleteCategory);

  const [name, setName] = useState('');
  const [rel, setRel] = useState<Relevance>('both');

  const countFor = (id: string) =>
    [...cardCategories.values()].filter((set) => set.has(id)).length;

  return (
    <div className="mt-6 border-t border-ink-800 pt-3">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-400">
        Catégories non-engine (§2.6)
      </div>
      <ul className="mb-2 flex flex-col gap-1">
        {categories.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-2 rounded-md border border-ink-800 bg-ink-900 px-2 py-1 text-xs"
          >
            <span className="text-ink-100">{c.name}</span>
            <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">
              {c.relevance === 'both' ? 'les deux' : c.relevance === 'first' ? 'going 1st' : 'going 2nd'}
            </span>
            <span className="tnum text-ink-500">{countFor(c.id)} cartes</span>
            {!c.is_builtin && (
              <button
                onClick={() => deleteCategory(c.id)}
                className="ml-auto rounded px-1 text-ink-600 hover:text-red-400"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nouvelle catégorie…"
          className="flex-1 rounded border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-ink-100"
        />
        <Segmented
          size="sm"
          value={rel}
          onChange={setRel}
          options={[
            { value: 'both', label: '2', title: 'les deux' },
            { value: 'first', label: '1st', title: 'going first' },
            { value: 'second', label: '2nd', title: 'going second' },
          ]}
        />
        <button
          disabled={!name.trim()}
          onClick={() => {
            addCategory(name.trim(), rel);
            setName('');
          }}
          className="rounded bg-ink-700 px-2 py-1 text-xs text-ink-100 hover:bg-ink-600 disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}
