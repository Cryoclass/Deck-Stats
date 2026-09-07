import { useMemo, useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { ConditionEditor } from './ConditionEditor.js';

export function ComboList() {
  const pairs = useDeck((s) => s.pairs);
  const excl = useDeck((s) => s.pairExclusions);
  const main = useDeck((s) => s.main);
  const cards = useDeck((s) => s.cards);
  const setPairExcluded = useDeck((s) => s.setPairExcluded);
  const removePairFromDeck = useDeck((s) => s.removePairFromDeck);
  const togglePair = useDeck((s) => s.togglePair);

  const inMain = useMemo(() => new Set(main.map((c) => c.cardId)), [main]);
  const name = (id: number) => cards[id]?.name ?? `#${id}`;

  const [a, setA] = useState<number | ''>('');
  const [b, setB] = useState<number | ''>('');

  const applicable = pairs.filter((p) => inMain.has(p.card_a_id) && inMain.has(p.card_b_id));
  const inapplicable = pairs.filter((p) => !inMain.has(p.card_a_id) || !inMain.has(p.card_b_id));

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-3 rounded-md border border-ink-800 px-2.5 py-1.5 text-[11px] text-ink-400">
        Les paires et leurs conditions appartiennent à ce deck. Cliquez sur Enregistrer pour les conserver.
        Les étiquettes non-engine, profils, plafonds partagés et HOPT sont communs à vos decks et enregistrés lors de leur modification.
      </div>

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
              className="flex flex-col gap-1 rounded-md border border-ink-800 bg-ink-900 px-2 py-1.5 text-sm"
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPairExcluded(p.id, active)}
                  title={active ? 'Désactiver pour ce deck' : 'Réactiver'}
                  className={`h-4 w-4 shrink-0 rounded-sm border ${active ? 'border-emerald-400 bg-emerald-400' : 'border-ink-500'}`}
                />
                <span className={active ? 'text-ink-100' : 'text-ink-500 line-through'}>
                  {name(p.card_a_id)} <span className="text-ink-500">+</span> {name(p.card_b_id)}
                </span>
                <button
                  onClick={() => removePairFromDeck(p.id)}
                  title="Supprimer du deck à la prochaine sauvegarde"
                  className="ml-auto rounded px-1.5 text-ink-600 hover:bg-red-500/10 hover:text-red-400"
                >
                  supprimer
                </button>
              </div>
              <PairCondition pairId={p.id} />
            </li>
          );
        })}
      </ul>

      {inapplicable.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-500">
            Conservés dans ce deck, carte absente
          </div>
          <ul className="flex flex-col gap-1">
            {inapplicable.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-md border border-ink-850 px-2 py-1 text-xs text-ink-500"
              >
                {name(p.card_a_id)} + {name(p.card_b_id)}
                <button
                  onClick={() => removePairFromDeck(p.id)}
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
      <GroupManager />
    </div>
  );
}

/** Condition ET/OU posée sur une PAIRE (contrat §4) — depuis l'onglet Combos. */
function PairCondition({ pairId }: { pairId: string }) {
  const condition = useDeck((s) => s.startConditions.find((r) => r.sourcePairId === pairId)?.condition ?? null);
  return (
    <div className="flex flex-wrap items-start gap-1.5 pl-6 text-[11px]">
      <span className="pt-0.5 text-amber-300/80">requiert en deck :</span>
      <ConditionEditor source={{ pairId }} condition={condition} />
    </div>
  );
}

function CategoryManager() {
  const categories = useDeck((s) => s.categories);
  const cardCategories = useDeck((s) => s.cardCategories);
  const addCategory = useDeck((s) => s.addCategory);
  const deleteCategory = useDeck((s) => s.deleteCategory);

  const [name, setName] = useState('');

  const countFor = (id: string) =>
    [...cardCategories.values()].filter((set) => set.has(id)).length;

  return (
    <div className="mt-6 border-t border-ink-800 pt-3">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">
        Étiquettes non-engine (compte)
      </div>
      <div className="mb-2 text-[10px] text-ink-500">
        Une étiquette dit ce qui est compté ; les fenêtres viennent du profil de chaque carte (mode Profil).
      </div>
      <ul className="mb-2 flex flex-col gap-1">
        {categories.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-2 rounded-md border border-ink-800 bg-ink-900 px-2 py-1 text-xs"
          >
            <span className="text-ink-100">{c.name}</span>
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
          placeholder="Nouvelle étiquette…"
          className="flex-1 rounded border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-ink-100"
        />
        <button
          disabled={!name.trim()}
          onClick={() => {
            addCategory(name.trim());
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

/** Plafonds partagés par tour (contrat §3) — annotation du compte, saisie manuelle (Q2). */
function GroupManager() {
  const groups = useDeck((s) => s.groups);
  const profiles = useDeck((s) => s.profiles);
  const addGroup = useDeck((s) => s.addGroup);
  const updateGroup = useDeck((s) => s.updateGroup);
  const deleteGroup = useDeck((s) => s.deleteGroup);

  const [name, setName] = useState('');
  const [cap, setCap] = useState(2);

  const membersOf = (id: string) => [...profiles.values()].filter((p) => p.groupId === id).length;

  return (
    <div className="mt-6 border-t border-ink-800 pt-3">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">
        Plafonds partagés par tour (compte)
      </div>
      <div className="mb-2 text-[10px] text-ink-500">
        Les membres d’un plafond cumulent au plus sa limite par tour (ex. Mulcharmy : 2 effets). Distinct du HOPT ;
        s’attribue à une carte déjà profilée, depuis son menu ⋯.
      </div>
      <ul className="mb-2 flex flex-col gap-1">
        {groups.length === 0 && <li className="px-1 text-[11px] text-ink-600">aucun plafond défini</li>}
        {groups.map((g) => (
          <li
            key={g.id}
            className="flex items-center gap-2 rounded-md border border-ink-800 bg-ink-900 px-2 py-1 text-xs"
          >
            <span className="text-ink-100">{g.name}</span>
            <label className="flex items-center gap-1 text-ink-400">
              limite
              <input
                type="number"
                min={1}
                value={g.cap_per_turn}
                onChange={(e) => {
                  const v = Math.max(1, Math.floor(Number(e.target.value)));
                  if (Number.isFinite(v) && v !== g.cap_per_turn) updateGroup(g.id, { cap_per_turn: v });
                }}
                className="tnum w-12 rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-center text-ink-100"
              />
              /tour
            </label>
            <span className="tnum text-ink-500">{membersOf(g.id)} cartes</span>
            <button
              onClick={() => deleteGroup(g.id)}
              title="Supprimer : les membres gardent leur profil, sans plafond"
              className="ml-auto rounded px-1 text-ink-600 hover:text-red-400"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nouveau plafond (ex. Mulcharmy)…"
          className="flex-1 rounded border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-ink-100"
        />
        <label className="flex items-center gap-1 text-[11px] text-ink-400">
          limite
          <input
            type="number"
            min={1}
            value={cap}
            onChange={(e) => setCap(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
            className="tnum w-12 rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-center text-ink-100"
          />
        </label>
        <button
          disabled={!name.trim()}
          onClick={() => {
            addGroup(name.trim(), cap);
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
