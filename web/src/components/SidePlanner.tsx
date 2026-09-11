import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useDeck } from '../store/deckStore.js';
import { api } from '../lib/api.js';
import { buildEngineModel } from '../lib/engineModel.js';
import {
  applyPlan,
  neutralizedSources,
  planComputeMode,
  planFingerprint,
  planIndicators,
  planSummaryFromPass,
  usablePlanSummary,
  type PlanIndicators,
} from '../lib/sidePlan.js';
import { describeIssue, planOf, type PlanDirection } from '../lib/matchups.js';
import { createEngineClient } from '../worker/client.js';
import { ComputeCancelled, type ComputeClient, type ComputeTask } from '../worker/computeClient.js';
import { deltaPoints, pct } from '../lib/fmt.js';
import { CardImage } from './CardImage.js';
import { Segmented } from './ui.js';
import type { DeckCard, SidePlanCard, SidePlanPosition } from '../types.js';
import type { PlanSummary } from '../../../server/src/domain/deckSummary.js';

// ─── Plans de side (étape 10C) : un adversaire, deux volets, deux listes agrégées ───
// Main et side restent ceux du DECK DE BASE, copies dépliées une par une (D16) ; les copies déjà
// engagées dans le plan sont estompées « sort » / « entre », un clic les retire du plan. Clic gauche
// ET clic droit sélectionnent (D8). « Échanger » n'accepte qu'une sélection équilibrée (D10).
// Les chiffres du plan sont calculés par un client de calcul PROPRE à la vue (comme le comparateur),
// dans le contexte de sa position (R7), jamais pour un plan incomplet ou à revoir (R4, R5), et
// persistés seulement quand rien n'est « non enregistré » (le plan calculé est alors celui du serveur).

const POSITION_LABEL: Record<SidePlanPosition, string> = { first: 'Premier', second: 'Second' };
const STRONG_HINT: Record<SidePlanPosition, string> = {
  first: 'Main forte en premier : au moins 2 départs théoriques ET au moins 1 de potentiel non-engine.',
  second: 'Main forte en second : au moins 2 départs théoriques ET au moins 2 de potentiel non-engine.',
};

type Figures =
  | { kind: 'none'; reason: string }
  | { kind: 'computing' }
  | { kind: 'ready'; summary: PlanSummary }
  | { kind: 'unavailable'; reason: string };

type Side = 'main' | 'side';
const copyKey = (zone: Side, cardId: number, index: number) => `${zone}:${cardId}:${index}`;

function picked(selection: Set<string>, zone: Side): SidePlanCard[] {
  const counts = new Map<number, number>();
  for (const key of selection) {
    const [z, id] = key.split(':');
    if (z === zone) counts.set(Number(id), (counts.get(Number(id)) ?? 0) + 1);
  }
  return [...counts].map(([card_id, copies]) => ({ card_id, copies }));
}
const countOf = (list: readonly SidePlanCard[]) => list.reduce((n, c) => n + c.copies, 0);

export function SidePlanner() {
  const matchups = useDeck((s) => s.matchups);
  const main = useDeck((s) => s.main);
  const side = useDeck((s) => s.side);
  const cards = useDeck((s) => s.cards);
  const starters = useDeck((s) => s.starters);
  const pairs = useDeck((s) => s.pairs);
  const pairExclusions = useDeck((s) => s.pairExclusions);
  const startConditions = useDeck((s) => s.startConditions);
  const deadFirst = useDeck((s) => s.deadFirst);
  const deadSecond = useDeck((s) => s.deadSecond);
  const hopt = useDeck((s) => s.hopt);
  const profiles = useDeck((s) => s.profiles);
  const groups = useDeck((s) => s.groups);
  const categories = useDeck((s) => s.categories);
  const cardCategories = useDeck((s) => s.cardCategories);
  const addMatchup = useDeck((s) => s.addMatchup);
  const renameMatchup = useDeck((s) => s.renameMatchup);
  const removeMatchup = useDeck((s) => s.removeMatchup);
  const swapInPlan = useDeck((s) => s.swapInPlan);
  const removeFromPlan = useDeck((s) => s.removeFromPlan);
  const setPlanNote = useDeck((s) => s.setPlanNote);
  const copyPlan = useDeck((s) => s.copyPlan);

  const ordered = useMemo(() => [...matchups].sort((a, b) => a.sort_index - b.sort_index), [matchups]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = ordered.find((m) => m.id === selectedId) ?? ordered[0] ?? null;
  const [position, setPosition] = useState<SidePlanPosition>('first');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [draftName, setDraftName] = useState(current?.name ?? '');
  const [swapError, setSwapError] = useState<string | null>(null);

  useEffect(() => {
    setSelection(new Set());
    setSwapError(null);
  }, [current?.id, position]);
  useEffect(() => setDraftName(current?.name ?? ''), [current?.id, current?.name]);

  const name = (id: number) => cards[id]?.name ?? `#${id}`;
  const plan = current ? planOf(current, position) : null;
  const applied = useMemo(() => (plan ? applyPlan(main, side, plan) : null), [plan, main, side]);

  // Chiffres du plan ouvert (10B) : entrée du moteur du deck sidé, cache stocké puis calcul.
  const input = useMemo(
    () => (applied?.main ? buildEngineModel({ main: applied.main, starters, pairs, pairExclusions, startConditions, deadFirst, deadSecond, hopt, profiles, groups, categories, cardCategories }).input : null),
    [applied, starters, pairs, pairExclusions, startConditions, deadFirst, deadSecond, hopt, profiles, groups, categories, cardCategories],
  );
  const inputKey = input ? JSON.stringify(input) : null;
  const storedKey = current ? `${current.id}:${position}` : '';
  const stored = useDeck((s) => s.planSummaries[storedKey]);
  const clientRef = useRef<ComputeClient | null>(null);
  const cacheRef = useRef(new Map<string, PlanSummary>());
  const [figures, setFigures] = useState<Figures>({ kind: 'none', reason: '' });

  useEffect(() => {
    const client = createEngineClient();
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!applied || !input) {
      setFigures({
        kind: 'none',
        reason:
          applied?.status === 'incomplete'
            ? 'Plan incomplet : aucun chiffre tant que les deux listes ne s’équilibrent pas.'
            : applied?.status === 'review'
              ? 'Plan à revoir : aucun chiffre tant qu’une carte n’est plus dans sa zone.'
              : '',
      });
      return;
    }
    const usable = usablePlanSummary(stored, input, position);
    if (usable) {
      setFigures({ kind: 'ready', summary: usable });
      return;
    }
    const fingerprint = planFingerprint(input, position);
    const cached = cacheRef.current.get(fingerprint);
    if (cached) {
      setFigures({ kind: 'ready', summary: cached });
      return;
    }
    setFigures({ kind: 'computing' });
    let task: ComputeTask | null = null;
    const timer = setTimeout(() => {
      const client = clientRef.current;
      if (!client) return;
      task = client.compute(input, planComputeMode(position));
      task.promise.then(
        ({ result }) => {
          const summary = planSummaryFromPass(result[position], input, position);
          if (!summary) {
            setFigures({ kind: 'unavailable', reason: result[position].unavailableReason ?? 'Analyse indisponible.' });
            return;
          }
          cacheRef.current.set(fingerprint, summary);
          setFigures({ kind: 'ready', summary });
        },
        (e: unknown) => {
          if (e instanceof ComputeCancelled) return;
          setFigures({ kind: 'unavailable', reason: e instanceof Error ? e.message : 'Calcul impossible.' });
        },
      );
    }, 150);
    return () => {
      clearTimeout(timer);
      task?.cancel();
    };
    // `inputKey` porte l'identité de `input` ; `applied.status` celle de l'état du plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, position, stored, applied?.status]);

  // Persistance : seulement si rien n'est « non enregistré » (le plan calculé est celui du serveur),
  // pour la révision lue ; 409 ou panne ignorés (recalculé à la prochaine ouverture).
  const dirty = useDeck((s) => s.dirty);
  const deckId = useDeck((s) => s.deckId);
  const revision = useDeck((s) => s.revision);
  const setPlanSummary = useDeck((s) => s.setPlanSummary);
  const persistedRef = useRef(new Set<string>());
  useEffect(() => {
    if (figures.kind !== 'ready' || dirty || !deckId || !current) return;
    const summary = figures.summary;
    if ((stored as PlanSummary | undefined)?.fingerprint === summary.fingerprint) return;
    const key = `${current.id}:${position}:${summary.fingerprint}:${revision}`;
    if (persistedRef.current.has(key)) return;
    persistedRef.current.add(key);
    const matchupId = current.id;
    api.putPlanSummary(deckId, matchupId, position, summary, revision).then(
      () => setPlanSummary(matchupId, position, summary),
      () => {
        /* 409 ou panne : cache non écrit, recalculé à la prochaine ouverture. */
      },
    );
  }, [figures, dirty, deckId, revision, current, position, stored, setPlanSummary]);

  // Écart avec le deck de base, dans la même position — jamais contre un résultat périmé.
  const result = useDeck((s) => s.result);
  const stale = useDeck((s) => s.stale);
  const computing = useDeck((s) => s.computing);
  const resultContext = useDeck((s) => s.resultContext);
  const base = useMemo<PlanIndicators | null>(
    () => (result && !stale && !computing && resultContext?.deckId === deckId ? planIndicators(result[position], position) : null),
    [result, stale, computing, resultContext, deckId, position],
  );

  const neutralized = useMemo(
    () => (applied?.main ? neutralizedSources({ starters, pairs, pairExclusions, startConditions }, main, applied.main) : []),
    [applied, starters, pairs, pairExclusions, startConditions, main],
  );

  const outgoing = picked(selection, 'main');
  const incoming = picked(selection, 'side');
  const out = countOf(outgoing);
  const inn = countOf(incoming);
  const canSwap = !!current && out > 0 && out === inn;

  const toggle = (key: string) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const release = (direction: PlanDirection, cardId: number) => {
    if (current) removeFromPlan(current.id, position, direction, cardId);
  };
  const doSwap = () => {
    if (!current || !canSwap) return;
    if (swapInPlan(current.id, position, outgoing, incoming)) {
      setSelection(new Set());
      setSwapError(null);
    } else setSwapError(useDeck.getState().persistenceError);
  };
  const submitNew = (e: React.FormEvent) => {
    e.preventDefault();
    const id = addMatchup(newName);
    if (id) {
      setSelectedId(id);
      setNewName('');
    }
  };
  const commitName = () => {
    if (current && draftName.trim() && draftName.trim() !== current.name) renameMatchup(current.id, draftName);
    else setDraftName(current?.name ?? '');
  };

  const addForm = (
    <form onSubmit={submitNew} className="flex items-center gap-1">
      <input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder="Nouvel adversaire…"
        maxLength={200}
        aria-label="Nom du nouvel adversaire"
        className="h-8 w-40 min-w-0 rounded border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100 outline-none placeholder:text-ink-600 focus:border-ink-500"
      />
      <button
        type="submit"
        data-add-matchup
        disabled={!newName.trim()}
        className="h-8 shrink-0 rounded border border-ink-700 px-2.5 text-[11px] text-ink-200 hover:bg-ink-800 disabled:opacity-40"
      >
        + Ajouter
      </button>
    </form>
  );

  if (!current || !plan || !applied) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto p-8 text-center text-sm text-ink-400">
        <p>Aucun adversaire. Ajoutes-en un pour préparer ses deux plans de side, en premier et en second.</p>
        {addForm}
      </div>
    );
  }

  const other: SidePlanPosition = position === 'first' ? 'second' : 'first';
  const planIsEmpty = plan.outgoing.length === 0 && plan.incoming.length === 0;
  const engaged = (list: readonly SidePlanCard[]) => new Map(list.map((c) => [c.card_id, c.copies]));
  const statusChip =
    applied.status === 'ready'
      ? { cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200', text: planIsEmpty ? 'Aucun échange — deck de base' : 'Prêt' }
      : applied.status === 'incomplete'
        ? { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-200', text: `Incomplet : ${applied.outgoing} sortante${applied.outgoing > 1 ? 's' : ''} pour ${applied.incoming} entrante${applied.incoming > 1 ? 's' : ''}` }
        : { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-200', text: 'À revoir' };
  const baseSize = main.reduce((n, c) => n + c.copies, 0);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-2" data-side-planner>
      {/* Adversaires : ordre d'ajout (Q4), aucune recherche (D15). */}
      <div className="flex flex-wrap items-center gap-2">
        {ordered.map((m) => (
          <button
            key={m.id}
            data-matchup={m.name}
            onClick={() => setSelectedId(m.id)}
            className={`h-8 max-w-[14rem] truncate rounded px-3 text-xs ${
              m.id === current.id ? 'bg-ink-700 font-medium text-ink-100' : 'border border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-ink-100'
            }`}
          >
            {m.name}
          </button>
        ))}
        {addForm}
      </div>

      {/* Adversaire ouvert : nom, volet, suppression. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 pb-2">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          maxLength={200}
          aria-label="Nom de l’adversaire"
          className="h-8 w-44 min-w-0 rounded bg-transparent px-1 text-sm text-ink-100 outline-none hover:bg-ink-900 focus:bg-ink-900"
        />
        <Segmented
          size="sm"
          value={position}
          onChange={setPosition}
          options={[
            { value: 'first', label: POSITION_LABEL.first, title: 'Plan quand tu joues en premier' },
            { value: 'second', label: POSITION_LABEL.second, title: 'Plan quand tu joues en second' },
          ]}
        />
        <span data-plan-status={applied.status} className={`rounded border px-1.5 py-0.5 text-[11px] ${statusChip.cls}`}>
          {statusChip.text}
        </span>
        <span className="tnum text-[11px] text-ink-400" title="Taille du main deck avant et après échange">
          main {baseSize} → {applied.mainSize}
        </span>
        <button
          onClick={() => window.confirm(`Supprimer l’adversaire « ${current.name} » et ses deux plans ?`) && removeMatchup(current.id)}
          className="ml-auto h-8 rounded px-2.5 text-[11px] text-ink-400 hover:bg-ink-800 hover:text-red-300"
        >
          Supprimer l’adversaire
        </button>
      </div>

      {/* Main et side du deck de base, copies dépliées (D16). */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-label="Main deck">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-500">Main — copies à sortir</div>
          <CopyGrid zone="main" list={main} engaged={engaged(plan.outgoing)} selection={selection} onToggle={toggle} onRelease={(id) => release('outgoing', id)} name={name} />
        </section>
        <section aria-label="Side deck">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-500">Side — copies à faire entrer</div>
          {side.length === 0 ? (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
              Side deck vide : ajoute des cartes depuis l’onglet Annoter (bloc Side) pour pouvoir échanger.
            </p>
          ) : (
            <CopyGrid zone="side" list={side} engaged={engaged(plan.incoming)} selection={selection} onToggle={toggle} onRelease={(id) => release('incoming', id)} name={name} />
          )}
        </section>
      </div>

      {/* Échange : sélection équilibrée seulement (D10). Bouton principal par la taille, pas par la
          couleur (un seul bouton émeraude par écran : Enregistrer). */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="tnum text-xs text-ink-300" data-selection>
          Sélection : −{out} / +{inn}
        </span>
        <button
          data-swap
          onClick={doSwap}
          disabled={!canSwap}
          className="h-8 rounded bg-ink-700 px-3 text-xs font-medium text-ink-100 hover:bg-ink-600 disabled:cursor-default disabled:bg-ink-800 disabled:text-ink-500"
          title={canSwap ? 'Ajouter ces copies au plan' : 'Sélectionne autant de copies du main à sortir que de copies du side à faire entrer'}
        >
          Échanger
        </button>
        {selection.size > 0 && (
          <button onClick={() => setSelection(new Set())} className="h-8 rounded px-2.5 text-[11px] text-ink-400 hover:bg-ink-800 hover:text-ink-100">
            Vider la sélection
          </button>
        )}
        <span className="text-[11px] text-ink-500">Clic gauche ou droit sur une copie ; sur une copie estompée, la retire du plan.</span>
      </div>
      {swapError && (
        <p role="alert" className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
          {swapError}
        </p>
      )}

      {/* Le plan : deux listes agrégées (D6), écarts, sources neutralisées, chiffres, note. */}
      <section className="flex flex-col gap-2 rounded-md border border-ink-800 bg-ink-900 p-2" data-plan={position}>
        <div className="grid gap-2 sm:grid-cols-2">
          <PlanList label="Sort" direction="outgoing" list={plan.outgoing} name={name} onRemove={release} />
          <PlanList label="Entre" direction="incoming" list={plan.incoming} name={name} onRemove={release} />
        </div>
        {applied.issues.length > 0 && (
          <ul className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200" data-plan-issues>
            {applied.issues.map((issue) => (
              <li key={`${issue.kind}:${issue.cardId}`}>{describeIssue(issue, name)}</li>
            ))}
          </ul>
        )}
        {neutralized.length > 0 && (
          <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200" data-neutralized>
            Neutralisé{neutralized.length > 1 ? 's' : ''} par ce plan (condition devenue impossible) :{' '}
            {neutralized.map((n) => (n.kind === 'starter' ? name(n.cardId) : `paire ${name(n.cardA)} + ${name(n.cardB)}`)).join(' · ')}
          </p>
        )}
        <PlanFigures figures={figures} base={base} position={position} />
        <div className="flex flex-wrap items-start gap-2">
          <textarea
            value={plan.note ?? ''}
            onChange={(e) => setPlanNote(current.id, position, e.target.value)}
            placeholder="Note pour ce plan (imprimée sur la fiche)…"
            rows={2}
            aria-label="Note du plan"
            className="min-w-0 flex-1 resize-y rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-100 outline-none placeholder:text-ink-600 focus:border-ink-500"
          />
          <button
            onClick={() => {
              if (planIsEmpty || window.confirm(`Remplacer le plan ${POSITION_LABEL[position].toLowerCase()} par celui en ${POSITION_LABEL[other].toLowerCase()} ?`)) copyPlan(current.id, other, position);
            }}
            className="h-8 shrink-0 rounded border border-ink-700 px-2.5 text-[11px] text-ink-200 hover:bg-ink-800"
          >
            Recopier depuis {POSITION_LABEL[other].toLowerCase()}
          </button>
        </div>
      </section>
    </div>
  );
}

/** Copies d'une zone, une tuile par exemplaire (D16). Les premières copies d'une carte sont celles
 *  que le plan engage ; les suivantes sont sélectionnables. */
function CopyGrid({
  zone,
  list,
  engaged,
  selection,
  onToggle,
  onRelease,
  name,
}: {
  zone: Side;
  list: DeckCard[];
  engaged: Map<number, number>;
  selection: Set<string>;
  onToggle: (key: string) => void;
  onRelease: (cardId: number) => void;
  name: (cardId: number) => string;
}) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}>
      {list.flatMap((c) =>
        Array.from({ length: c.copies }, (_, i) => {
          const key = copyKey(zone, c.cardId, i);
          const isEngaged = i < (engaged.get(c.cardId) ?? 0);
          const isSelected = !isEngaged && selection.has(key);
          const act = (e: MouseEvent) => {
            e.preventDefault(); // clic droit : pas de menu du navigateur dans cette vue (D8)
            if (isEngaged) onRelease(c.cardId);
            else onToggle(key);
          };
          return (
            <button
              key={key}
              data-copy={zone}
              data-card-id={c.cardId}
              data-state={isEngaged ? 'engaged' : isSelected ? 'selected' : 'free'}
              onClick={act}
              onContextMenu={act}
              title={`${name(c.cardId)} — copie ${i + 1}/${c.copies}${isEngaged ? ` (${zone === 'main' ? 'sort' : 'entre'} : clic pour la retirer du plan)` : ''}`}
              className={`relative block aspect-[59/86] w-full overflow-hidden rounded-md border transition-opacity ${
                isSelected ? 'border-emerald-300 ring-2 ring-emerald-300' : 'border-ink-800'
              } ${isEngaged ? 'opacity-45' : ''}`}
            >
              <CardImage cardId={c.cardId} />
              {isSelected && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-emerald-500/20 text-lg text-emerald-100">✓</span>
              )}
              {isEngaged && (
                <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 text-[10px] text-ink-100">
                  {zone === 'main' ? 'sort' : 'entre'}
                </span>
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}

function PlanList({
  label,
  direction,
  list,
  name,
  onRemove,
}: {
  label: string;
  direction: PlanDirection;
  list: SidePlanCard[];
  name: (cardId: number) => string;
  onRemove: (direction: PlanDirection, cardId: number) => void;
}) {
  return (
    <div data-plan-list={direction}>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-500">
        {label} <span className="tnum text-ink-400">{countOf(list)}</span>
      </div>
      {list.length === 0 ? (
        <p className="text-[11px] text-ink-600">—</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {list.map((c) => (
            <li key={c.card_id} className="flex h-6 items-center gap-1 rounded bg-ink-800 pl-2 text-[11px] text-ink-200">
              <span className="max-w-[10rem] truncate">{name(c.card_id)}</span>
              <span className="tnum text-ink-400">×{c.copies}</span>
              <button
                onClick={() => onRemove(direction, c.card_id)}
                title="Retirer une copie du plan"
                className="flex h-6 w-6 items-center justify-center rounded text-ink-400 hover:bg-ink-700 hover:text-ink-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanFigures({ figures, base, position }: { figures: Figures; base: PlanIndicators | null; position: SidePlanPosition }) {
  if (figures.kind === 'none') return figures.reason ? <p className="text-[11px] text-ink-500">{figures.reason}</p> : null;
  if (figures.kind === 'computing') return <p className="text-[11px] text-ink-500" data-plan-figures="computing">Calcul du deck sidé…</p>;
  if (figures.kind === 'unavailable') return <p className="text-[11px] text-amber-300">{figures.reason}</p>;
  const s = figures.summary;
  const cells: Array<{ key: keyof PlanIndicators; label: string; hint: string }> = [
    { key: 'startOne', label: '≥ 1 départ', hint: 'P(au moins 1 départ théorique)' },
    { key: 'nonEngineTwo', label: '≥ 2 non-engine', hint: 'P(potentiel non-engine ≥ 2)' },
    { key: 'strongHand', label: 'Main forte', hint: STRONG_HINT[position] },
  ];
  return (
    <div data-plan-figures="ready">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-500">
        Deck sidé · {position === 'first' ? 'premier · 5 cartes' : 'second · 5 cartes + pioche'}
        {base ? ' · écart avec le deck de base' : ' · écart : en attente du calcul du deck de base'}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {cells.map(({ key, label, hint }) => {
          const d = base ? s[key] - base[key] : null;
          return (
            <div key={key} className="flex items-baseline gap-1.5" title={`${hint} — ${(100 * s[key]).toFixed(4)} %`} data-figure={key}>
              <span className="text-[11px] text-ink-500">{label}</span>
              <span className="tnum text-sm font-semibold text-ink-100">{pct(s[key], 1)}</span>
              {d !== null && (
                <span className={`tnum text-[11px] ${d > 0 ? 'text-emerald-300' : d < 0 ? 'text-red-300' : 'text-ink-500'}`} title={`Écart : ${(100 * d).toFixed(4)} points`}>
                  {deltaPoints(d)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
