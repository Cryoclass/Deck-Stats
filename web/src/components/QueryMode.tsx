import { useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { queryProbability, criterionInvalid } from '../engine/query.js';
import type { QueryCriterion, QuerySubject } from '../engine/query.js';
import { pct } from '../lib/fmt.js';

const rid = (): string => Math.random().toString(36).slice(2);

/** Encode un sujet en valeur de <select>. */
function subjectKey(s: QuerySubject): string {
  switch (s.kind) {
    case 'starts':
      return 'starts';
    case 'redundancy':
      return 'redundancy';
    case 'nonengine':
      return 'nonengine';
    case 'category':
      return `cat:${s.categoryId}`;
    case 'group':
      return 'group';
  }
}

export function QueryMode({ onShowHands }: { onShowHands?: () => void }) {
  const result = useDeck((s) => s.result);
  const categories = useDeck((s) => s.categories);
  const criteria = useDeck((s) => s.queryCriteria);
  const setCriteria = useDeck((s) => s.setQueryCriteria);
  const savedQueries = useDeck((s) => s.savedQueries);
  const saveQuery = useDeck((s) => s.saveQuery);
  const loadSavedQuery = useDeck((s) => s.loadSavedQuery);
  const deleteSavedQuery = useDeck((s) => s.deleteSavedQuery);
  const setHandFilterByQuery = useDeck((s) => s.setHandFilterByQuery);

  const [saveName, setSaveName] = useState('');

  if (!result) return null;

  const update = (id: string, patch: Partial<QueryCriterion>) =>
    setCriteria(criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const remove = (id: string) => setCriteria(criteria.filter((c) => c.id !== id));
  const add = () =>
    setCriteria([...criteria, { id: rid(), subject: { kind: 'starts' }, min: 1, max: null }]);

  const onSubject = (id: string, key: string) => {
    let subject: QuerySubject;
    if (key === 'starts') subject = { kind: 'starts' };
    else if (key === 'redundancy') subject = { kind: 'redundancy' };
    else if (key === 'nonengine') subject = { kind: 'nonengine' };
    else if (key === 'group') subject = { kind: 'group', categoryIds: [], name: '' };
    else subject = { kind: 'category', categoryId: key.slice(4) };
    update(id, { subject });
  };

  const anyInvalid = criteria.some(criterionInvalid);
  const pFirst = queryProbability(result.first, criteria);
  const pSecond = queryProbability(result.second, criteria);

  return (
    <div className="border-t border-ink-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-ink-500">Mode requête (§3.3)</span>
        {savedQueries.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && loadSavedQuery(e.target.value)}
            className="rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-[11px] text-ink-300"
            title="Charger une requête enregistrée"
          >
            <option value="">requêtes…</option>
            {savedQueries.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {criteria.map((c) => (
          <CriterionRow
            key={c.id}
            criterion={c}
            categories={categories}
            onSubject={(k) => onSubject(c.id, k)}
            onMin={(v) => update(c.id, { min: v })}
            onMax={(v) => update(c.id, { max: v })}
            onGroup={(patch) =>
              c.subject.kind === 'group' &&
              update(c.id, { subject: { ...c.subject, ...patch } })
            }
            onRemove={() => remove(c.id)}
          />
        ))}
        {criteria.length === 0 && (
          <div className="text-[11px] text-ink-600">Aucun critère → 100 %. Ajoute un critère.</div>
        )}
      </div>

      <button
        onClick={add}
        className="mt-1.5 rounded border border-ink-700 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-800"
      >
        + critère
      </button>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <QueryResult label="Going first" value={pFirst} />
        <QueryResult label="Going second" value={pSecond} />
      </div>
      {anyInvalid && (
        <div className="mt-1 text-[11px] text-red-400">
          Un critère a min &gt; max : requête non évaluée.
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setHandFilterByQuery(true);
            onShowHands?.();
          }}
          disabled={anyInvalid}
          className="rounded bg-ink-700 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-600 disabled:opacity-40"
        >
          Voir ces mains
        </button>
        <div className="ml-auto flex items-center gap-1">
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="nommer…"
            className="w-24 rounded border border-ink-700 bg-ink-850 px-1.5 py-1 text-[11px] text-ink-100"
          />
          <button
            onClick={() => {
              if (saveName.trim()) {
                saveQuery(saveName.trim());
                setSaveName('');
              }
            }}
            disabled={!saveName.trim()}
            className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-black disabled:opacity-40"
            title="Enregistrer cette requête dans le deck"
          >
            enregistrer
          </button>
        </div>
      </div>

      {savedQueries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {savedQueries.map((q) => (
            <span
              key={q.id}
              className="flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300"
            >
              {q.name}
              <button
                onClick={() => deleteSavedQuery(q.id)}
                className="text-ink-600 hover:text-red-400"
                title="Supprimer"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CriterionRow({
  criterion,
  categories,
  onSubject,
  onMin,
  onMax,
  onGroup,
  onRemove,
}: {
  criterion: QueryCriterion;
  categories: Array<{ id: string; name: string }>;
  onSubject: (key: string) => void;
  onMin: (v: number | null) => void;
  onMax: (v: number | null) => void;
  onGroup: (patch: { categoryIds?: string[]; name?: string }) => void;
  onRemove: () => void;
}) {
  const invalid = criterionInvalid(criterion);
  const s = criterion.subject;
  return (
    <div className={`rounded-md border px-2 py-1.5 ${invalid ? 'border-red-500/40 bg-red-500/5' : 'border-ink-800 bg-ink-900'}`}>
      <div className="flex items-center gap-1.5 text-[11px]">
        <select
          value={subjectKey(s)}
          onChange={(e) => onSubject(e.target.value)}
          className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-ink-100"
        >
          <option value="starts">Starts jouables</option>
          <option value="redundancy">Redondance</option>
          <option value="nonengine">Non-engine (tous)</option>
          {categories.map((cat) => (
            <option key={cat.id} value={`cat:${cat.id}`}>
              {cat.name}
            </option>
          ))}
          <option value="group">Groupe personnalisé…</option>
        </select>
        <span className="shrink-0 text-ink-500">entre</span>
        <Bound value={criterion.min} onChange={onMin} />
        <span className="shrink-0 text-ink-500">et</span>
        <Bound value={criterion.max} onChange={onMax} />
        <button onClick={onRemove} className="shrink-0 rounded px-1 text-ink-600 hover:text-red-400">
          ✕
        </button>
      </div>

      {s.kind === 'group' && (
        <div className="mt-1.5 flex flex-col gap-1 border-t border-ink-800 pt-1.5">
          <input
            value={s.name ?? ''}
            onChange={(e) => onGroup({ name: e.target.value })}
            placeholder="nom du groupe (optionnel)"
            className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[11px] text-ink-100"
          />
          <div className="flex flex-wrap gap-1">
            {categories.map((cat) => {
              const on = s.categoryIds.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() =>
                    onGroup({
                      categoryIds: on
                        ? s.categoryIds.filter((x) => x !== cat.id)
                        : [...s.categoryIds, cat.id],
                    })
                  }
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    on ? 'bg-emerald-500/20 text-emerald-200' : 'bg-ink-800 text-ink-400'
                  }`}
                >
                  {cat.name}
                </button>
              );
            })}
            {categories.length === 0 && (
              <span className="text-[10px] text-ink-600">aucune catégorie</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Borne d'intervalle : vide = non bornée (affichée « — »). */
function Bound({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <input
      value={value === null ? '' : String(value)}
      onChange={(e) => {
        const t = e.target.value.trim();
        if (t === '') onChange(null);
        else {
          const n = Math.max(0, Math.floor(Number(t)));
          if (Number.isFinite(n)) onChange(n);
        }
      }}
      placeholder="—"
      inputMode="numeric"
      className="tnum w-8 shrink-0 rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-center text-ink-100"
    />
  );
}

function QueryResult({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 p-2 text-center">
      <div className="text-[10px] text-ink-500">{label}</div>
      <div className="tnum text-xl font-semibold text-emerald-300">
        {value === null ? '—' : pct(value, 1)}
      </div>
    </div>
  );
}
