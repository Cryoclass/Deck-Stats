import { useMemo, useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { columnOf } from '../store/study.js';
import { queryProbability, criterionInvalid } from '../engine/query.js';
import type { QueryCriterion, QuerySubject } from '../engine/query.js';
import { pct } from '../lib/fmt.js';
import { CONTEXT_LABEL } from './Header.js';
import type { StudyColumn } from '../store/study.js';

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
  const context = useDeck((s) => s.context);
  // Plans de side v2 (S1, S2) : les probabilités sont celles des decks ÉTUDIÉS, une colonne par position.
  const studied = useDeck((s) => s.studied);
  const preview = useDeck((s) => s.preview);
  const baseStale = useDeck((s) => s.stale);
  const computing = useDeck((s) => s.computing);
  const computeError = useDeck((s) => s.computeError);
  const resultContext = useDeck((s) => s.resultContext);
  const columns = useMemo(
    () => ({ first: columnOf({ studied, result, stale: baseStale, computing, computeError, resultContext, context, preview }, 'first'), second: columnOf({ studied, result, stale: baseStale, computing, computeError, resultContext, context, preview }, 'second') }),
    [studied, result, baseStale, computing, computeError, resultContext, context, preview],
  );
  const stale = columns.first.stale || columns.second.stale;
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
  const pFirst = columns.first.pass ? queryProbability(columns.first.pass, criteria) : null;
  const pSecond = columns.second.pass ? queryProbability(columns.second.pass, criteria) : null;

  return (
    <div className="border-t border-ink-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-meta uppercase tracking-wide text-fg-3">Mode requête</span>
        {savedQueries.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && loadSavedQuery(e.target.value)}
            className="h-6 rounded border border-ink-700 bg-ink-850 px-1 text-meta text-fg-3"
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
          <div className="text-meta text-fg-3">Aucun critère → 100 %. Ajoute un critère.</div>
        )}
      </div>

      <button
        onClick={add}
        className="mt-1.5 h-6 rounded border border-ink-700 px-2 text-meta text-fg-3 hover:bg-ink-800"
      >
        + critère
      </button>

      {/* Étape 4 : probabilités d'un résultat périmé atténuées, critères toujours éditables. */}
      <div className={`mt-3 grid grid-cols-2 gap-2 transition-opacity ${stale ? 'opacity-45' : ''}`}>
        <QueryResult label={CONTEXT_LABEL.first} deck={columns.first} value={pFirst} active={context === 'first'} />
        <QueryResult label={CONTEXT_LABEL.second} deck={columns.second} value={pSecond} active={context === 'second'} />
      </div>
      {anyInvalid && (
        <div className="mt-1 text-meta text-neg">
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
          className="rounded bg-ink-700 px-2.5 py-1 text-body text-fg-1 hover:bg-ink-600 disabled:opacity-40"
        >
          Voir ces mains
        </button>
        <div className="ml-auto flex items-center gap-1">
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="nommer…"
            className="w-24 rounded border border-ink-700 bg-ink-850 px-1.5 py-1 text-meta text-fg-1"
          />
          <button
            onClick={() => {
              if (saveName.trim()) {
                saveQuery(saveName.trim());
                setSaveName('');
              }
            }}
            disabled={!saveName.trim()}
            className="h-6 rounded bg-emerald-600 px-2 text-meta font-medium text-black disabled:opacity-40"
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
              className="flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 text-meta text-fg-3"
            >
              {q.name}
              <button
                onClick={() => deleteSavedQuery(q.id)}
                className="-my-1 -mr-1 flex h-6 w-6 items-center justify-center rounded text-fg-3 hover:text-neg"
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
      <div className="flex items-center gap-1.5 text-meta">
        <select
          value={subjectKey(s)}
          onChange={(e) => onSubject(e.target.value)}
          className="h-6 min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-1 text-fg-1"
        >
          <option value="starts">Départs théoriques</option>
          <option value="redundancy">Redondance</option>
          <option value="nonengine">Non-engine (tous)</option>
          {categories.map((cat) => (
            <option key={cat.id} value={`cat:${cat.id}`}>
              {cat.name}
            </option>
          ))}
          <option value="group">Groupe personnalisé…</option>
        </select>
        <span className="shrink-0 text-fg-3">entre</span>
        <Bound value={criterion.min} onChange={onMin} />
        <span className="shrink-0 text-fg-3">et</span>
        <Bound value={criterion.max} onChange={onMax} />
        <button onClick={onRemove} title="Retirer ce critère" className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-3 hover:bg-ink-800 hover:text-neg">
          ✕
        </button>
      </div>

      {s.kind === 'group' && (
        <div className="mt-1.5 flex flex-col gap-1 border-t border-ink-800 pt-1.5">
          <input
            value={s.name ?? ''}
            onChange={(e) => onGroup({ name: e.target.value })}
            placeholder="nom du groupe (optionnel)"
            className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-meta text-fg-1"
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
                  className={`rounded px-1.5 py-0.5 text-meta ${
                    on ? 'bg-emerald-500/20 text-pos' : 'bg-ink-800 text-fg-3'
                  }`}
                >
                  {cat.name}
                </button>
              );
            })}
            {categories.length === 0 && (
              <span className="text-meta text-fg-3">aucune catégorie</span>
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
      className="tnum h-6 w-8 shrink-0 rounded border border-ink-700 bg-ink-850 px-1 text-center text-fg-1"
    />
  );
}

function QueryResult({ label, deck, value, active }: { label: string; deck: StudyColumn; value: number | null; active: boolean }) {
  return (
    <div data-query-result={deck.position} className={`rounded-lg border bg-ink-900 p-2 text-center ${active ? 'border-ink-600' : 'border-ink-800'}`} title={deck.reason ?? undefined}>
      <div className="text-meta text-fg-3">{label}</div>
      {/* S1 : le deck dont c'est le chiffre, toujours nommé ; S3 : un aperçu est dit tel quel. */}
      <div className="truncate text-meta text-fg-3" data-study-label>{deck.isPreview ? `aperçu · ${deck.label}` : deck.label}</div>
      <div className="tnum text-hero font-semibold text-pos">
        {value === null ? '—' : pct(value, 1)}
      </div>
      {deck.reason && <div className="text-meta text-warn">{deck.reason}</div>}
    </div>
  );
}
