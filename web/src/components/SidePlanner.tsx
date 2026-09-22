import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useDeck } from '../store/deckStore.js';
import { candidateDeltaOf, studiedPass } from '../store/study.js';
import { neutralizedSources, planIndicators, type PlanIndicators } from '../lib/sidePlan.js';
import { describeIssue, planOf, type PlanDirection } from '../lib/matchups.js';
import { INDICATOR_LABEL, freeCopies, type Indicator } from '../lib/swapPreview.js';
import { deckLegality, describeDeckIssue, zoneOfCatalog } from '../lib/zones.js';
import { compareSegment } from '../lib/comparison.js';
import { useRouter } from '../lib/router.js';
import { deltaPoints, pct, signedPct } from '../lib/fmt.js';
import { CardImage } from './CardImage.js';
import { StatsPanel } from './StatsPanel.js';
import type { DeckCard, SidePlanCard, SidePlanPosition } from '../types.js';
import type { DeckZone } from '../../../server/src/domain/cardDefaults.js';

// ─── Plans de side v2, partie D : l'onglet qui aide à CHOISIR ───
// L'adversaire ouvert ici EST l'adversaire étudié par tout l'éditeur (barre de contexte, D1), et la
// position est celle de la barre : un seul plan ouvert, `openPlan` du store. Une tuile par carte (Q2),
// clic = une copie de plus dans la sélection, clic droit = une de moins ; pendant la sélection, l'aperçu
// (S3) et les écarts des candidats (S4) viennent du store. Les chiffres du plan sont ceux du deck
// étudié (`studiedPass`), l'écart avec le deck de base celui de `result`. Rien ici ne calcule : le
// store orchestre (store/study.ts). Au téléphone, le panneau « Probabilités » est rendu SOUS le plan
// (D12, Q10 : cet onglet seulement).

const POSITION_LABEL: Record<SidePlanPosition, string> = { first: 'Premier', second: 'Second' };
const STRONG_HINT: Record<SidePlanPosition, string> = {
  first: 'Main forte en premier : au moins 2 départs théoriques ET au moins 1 de potentiel non-engine.',
  second: 'Main forte en second : au moins 2 départs théoriques ET au moins 2 de potentiel non-engine.',
};
const CELLS: Array<{ key: keyof PlanIndicators; label: string; hint: string }> = [
  { key: 'startOne', label: '≥ 1 départ', hint: 'P(au moins 1 départ théorique)' },
  { key: 'nonEngineTwo', label: '≥ 2 non-engine', hint: 'P(potentiel non-engine ≥ 2)' },
  { key: 'strongHand', label: 'Main forte', hint: '' },
];
const countOf = (list: readonly SidePlanCard[]) => list.reduce((n, c) => n + c.copies, 0);

export function SidePlanner({ withPanel = false }: { withPanel?: boolean }) {
  const { navigate } = useRouter();
  const matchups = useDeck((s) => s.matchups);
  const main = useDeck((s) => s.main);
  const extra = useDeck((s) => s.extra);
  const side = useDeck((s) => s.side);
  const cards = useDeck((s) => s.cards);
  const studyId = useDeck((s) => s.study.matchupId);
  const position = useDeck((s) => s.context);
  const studied = useDeck((s) => s.studied[s.context]);
  const selection = useDeck((s) => s.selection);
  const preview = useDeck((s) => s.preview);
  const candidates = useDeck((s) => s.candidates);
  const indicator = useDeck((s) => s.candidateIndicator);
  const swapHistory = useDeck((s) => s.swapHistory);
  const dirty = useDeck((s) => s.dirty);
  const saving = useDeck((s) => s.saving);
  const deckId = useDeck((s) => s.deckId);
  const result = useDeck((s) => s.result);
  const baseStale = useDeck((s) => s.stale);
  const baseComputing = useDeck((s) => s.computing);
  const persistenceError = useDeck((s) => s.persistenceError);
  const starters = useDeck((s) => s.starters);
  const pairs = useDeck((s) => s.pairs);
  const pairExclusions = useDeck((s) => s.pairExclusions);
  const startConditions = useDeck((s) => s.startConditions);
  const setStudy = useDeck((s) => s.setStudy);
  const addMatchup = useDeck((s) => s.addMatchup);
  const renameMatchup = useDeck((s) => s.renameMatchup);
  const removeMatchup = useDeck((s) => s.removeMatchup);
  const removeFromPlan = useDeck((s) => s.removeFromPlan);
  const setPlanNote = useDeck((s) => s.setPlanNote);
  const copyPlan = useDeck((s) => s.copyPlan);
  const adjustSelectionCopy = useDeck((s) => s.adjustSelectionCopy);
  const clearSelection = useDeck((s) => s.clearSelection);
  const commitSelection = useDeck((s) => s.commitSelection);
  const undoLastSwap = useDeck((s) => s.undoLastSwap);
  const clearOpenPlan = useDeck((s) => s.clearOpenPlan);
  const setCandidateIndicator = useDeck((s) => s.setCandidateIndicator);
  const runCandidates = useDeck((s) => s.runCandidates);
  const saveDeck = useDeck((s) => s.saveDeck);

  const ordered = useMemo(() => [...matchups].sort((a, b) => a.sort_index - b.sort_index), [matchups]);
  const current = ordered.find((m) => m.id === studyId) ?? null;
  // À l'arrivée sur l'onglet, le premier adversaire s'ouvre si aucun n'est étudié (D1) — une seule fois :
  // choisir ensuite « Deck de base » dans la barre, ou un `?contre=` inconnu (avis de la barre), est respecté.
  const openedOnce = useRef(false);
  useEffect(() => {
    if (openedOnce.current) return;
    openedOnce.current = true;
    if (studyId === null && ordered.length > 0) setStudy(ordered[0].id);
  }, [studyId, ordered, setStudy]);

  const [newName, setNewName] = useState('');
  const [draftName, setDraftName] = useState(current?.name ?? '');
  useEffect(() => setDraftName(current?.name ?? ''), [current?.id, current?.name]);
  const [swapError, setSwapError] = useState<string | null>(null);
  useEffect(() => setSwapError(null), [current?.id, position]);

  const name = (id: number) => cards[id]?.name ?? `#${id}`;
  const zoneOf = useMemo(() => zoneOfCatalog(cards), [cards]);
  const plan = current ? planOf(current, position) : null;
  // Jamais un chiffre de l'adversaire précédent sous le nom du nouveau (§9) : entre `setStudy` et le
  // regroupement du store (50 ms), `studied` porte encore l'ancien adversaire — on le tient pour absent.
  const inSync = studied.deck.kind === 'sided' && studied.deck.matchup?.id === current?.id;
  const applied = inSync && studied.deck.kind === 'sided' ? studied.deck.applied : null;
  const legality = useMemo(() => deckLegality({ main, extra, side }, zoneOf), [main, extra, side, zoneOf]);

  // Chiffres du plan (deck étudié de la position) et écart avec le deck de base, jamais contre un
  // résultat périmé (R8, R9).
  const studiedAll = useDeck((s) => s.studied);
  const studyView = useMemo(() => ({ studied: studiedAll, result, stale: baseStale }), [studiedAll, result, baseStale]); // jamais un objet neuf dans le sélecteur (boucle de rendu)
  const planPass = inSync ? studiedPass(studyView, position) : null;
  const planIx = planPass ? planIndicators(planPass, position) : null;
  const baseIx = result && !baseStale && !baseComputing ? planIndicators(result[position], position) : null;
  const previewIx = preview.kind === 'ready' && preview.pass ? planIndicators(preview.pass, position) : null;
  const neutralized = useMemo(
    () => (applied?.main ? neutralizedSources({ starters, pairs, pairExclusions, startConditions }, main, applied.main) : []),
    [applied, starters, pairs, pairExclusions, startConditions, main],
  );

  // Copies encore libres par carte et par sens (ni engagées dans le plan, ni sélectionnées).
  const free = useMemo(() => {
    if (!plan) return { outgoing: new Map<number, number>(), incoming: new Map<number, number>() };
    return {
      outgoing: freeCopies([...main, ...extra], plan.outgoing, selection.outgoing),
      incoming: freeCopies(side, plan.incoming, selection.incoming),
    };
  }, [plan, main, extra, side, selection]);
  const selectedOf = (direction: PlanDirection, cardId: number) => selection[direction].find((c) => c.card_id === cardId)?.copies ?? 0;
  const engagedOf = (direction: PlanDirection, cardId: number) => (plan ? plan[direction].find((c) => c.card_id === cardId)?.copies ?? 0 : 0);
  const candidateDelta = (cardId: number, direction: PlanDirection): { value: number | null; pending: boolean } | null => {
    if (candidates.direction !== direction || !candidates.cards.some((c) => c.cardId === cardId)) return null;
    const value = candidateDeltaOf({ ...studyView, candidates, candidateIndicator: indicator, context: position }, cardId);
    // « … » seulement quand un calcul tourne pour cette tuile (pas « à calculer », pas « fait sans chiffre »).
    return { value, pending: value === null && candidates.status === 'running' };
  };

  const submitNew = (e: React.FormEvent) => {
    e.preventDefault();
    const id = addMatchup(newName);
    if (id) {
      setStudy(id);
      setNewName('');
    }
  };
  const commitName = () => {
    if (current && draftName.trim() && draftName.trim() !== current.name) renameMatchup(current.id, draftName);
    else setDraftName(current?.name ?? '');
  };
  const doSwap = () => {
    if (commitSelection()) setSwapError(null);
    else setSwapError(useDeck.getState().persistenceError ?? persistenceError);
  };
  /** D11 : enregistrer puis ouvrir, seulement si l'enregistrement a réussi et que rien n'est redevenu « non enregistré ». */
  const saveThen = async (go: () => void) => {
    await saveDeck();
    const s = useDeck.getState();
    if (!s.dirty && !s.persistenceError) go();
  };

  const addForm = (
    <form onSubmit={submitNew} className="flex items-center gap-1">
      <input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder="Nouvel adversaire…"
        maxLength={200}
        aria-label="Nom du nouvel adversaire"
        className="h-8 w-40 min-w-0 rounded border border-ink-700 bg-ink-900 px-2 text-body text-fg-1 outline-none placeholder:text-fg-3 focus:border-ink-500"
      />
      <button type="submit" data-add-matchup disabled={!newName.trim()} className="h-8 shrink-0 rounded border border-ink-700 px-2.5 text-meta text-fg-2 hover:bg-ink-800 disabled:opacity-40">
        + Ajouter
      </button>
    </form>
  );

  if (!current || !plan) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto p-8 text-center text-value text-fg-3">
        <p>Aucun adversaire. Ajoutes-en un pour préparer ses deux plans de side, en premier et en second.</p>
        {addForm}
      </div>
    );
  }

  const other: SidePlanPosition = position === 'first' ? 'second' : 'first';
  const planIsEmpty = plan.outgoing.length === 0 && plan.incoming.length === 0;
  const status = applied?.status ?? 'ready';
  const statusChip =
    status === 'ready'
      ? { cls: 'border-emerald-500/30 bg-emerald-500/10 text-pos', text: planIsEmpty ? 'Aucun échange — deck de base' : 'Prêt' }
      : status === 'incomplete'
        ? { cls: 'border-amber-500/30 bg-amber-500/10 text-warn', text: `Incomplet : main −${applied!.zones.main.outgoing} / +${applied!.zones.main.incoming}${applied!.zones.extra.outgoing + applied!.zones.extra.incoming > 0 ? `, extra −${applied!.zones.extra.outgoing} / +${applied!.zones.extra.incoming}` : ''}` }
        : { cls: 'border-amber-500/30 bg-amber-500/10 text-warn', text: 'À revoir' };
  const mainSize = main.reduce((n, c) => n + c.copies, 0);
  const extraSize = extra.reduce((n, c) => n + c.copies, 0);
  const sideMain = side.filter((c) => zoneOf(c.cardId) !== 'extra');
  const sideExtra = side.filter((c) => zoneOf(c.cardId) === 'extra');
  const selOut = countOf(selection.outgoing);
  const selIn = countOf(selection.incoming);
  const savedReason = dirty ? 'Enregistre le deck : la fiche et le comparateur lisent le deck enregistré.' : null;
  const lastSwap = swapHistory.at(-1) ?? null;
  const undoable = !!lastSwap && (lastSwap.outgoing.some((c) => engagedOf('outgoing', c.card_id) > 0) || lastSwap.incoming.some((c) => engagedOf('incoming', c.card_id) > 0));

  const tile = (c: DeckCard, direction: PlanDirection, zone: DeckZone) => (
    <ChoiceTile
      key={`${direction}-${c.cardId}`}
      cardId={c.cardId}
      zone={zone}
      direction={direction}
      copies={c.copies}
      engaged={engagedOf(direction, c.cardId)}
      selected={selectedOf(direction, c.cardId)}
      free={free[direction].get(c.cardId) ?? 0}
      unknownZone={zoneOf(c.cardId) === null}
      candidate={zone === 'main' ? candidateDelta(c.cardId, direction) : null}
      indicator={indicator}
      name={name(c.cardId)}
      onAdjust={(delta) => adjustSelectionCopy(direction, c.cardId, delta)}
    />
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto" data-side-planner>
      <div className="flex flex-col gap-3 p-2">
        {/* Adversaires : ordre d'ajout (Q4), aucune recherche (D15) ; la puce active = l'adversaire étudié. */}
        <div className="flex flex-wrap items-center gap-2">
          {ordered.map((m) => (
            <button
              key={m.id}
              data-matchup={m.name}
              onClick={() => setStudy(m.id)}
              className={`h-8 max-w-[14rem] truncate rounded px-3 text-body ${m.id === current.id ? 'bg-ink-700 font-medium text-fg-1' : 'border border-ink-700 text-fg-3 hover:bg-ink-800 hover:text-fg-1'}`}
            >
              {m.name}
            </button>
          ))}
          {addForm}
        </div>

        {/* Adversaire ouvert : nom, état, tailles, suppression. La position est celle de la barre de contexte. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 pb-2">
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            maxLength={200}
            aria-label="Nom de l’adversaire"
            className="h-8 w-44 min-w-0 rounded bg-transparent px-1 text-value text-fg-1 outline-none hover:bg-ink-900 focus:bg-ink-900"
          />
          <span className="text-meta text-fg-3">plan {POSITION_LABEL[position].toLowerCase()}</span>
          <span data-plan-status={status} className={`rounded border px-1.5 py-0.5 text-meta ${statusChip.cls}`}>{statusChip.text}</span>
          <span className="tnum text-meta text-fg-3" title="Taille du main deck et de l'extra deck avant et après échange">
            main {mainSize} → {applied?.mainSize ?? mainSize}{extraSize > 0 || (applied?.extraSize ?? 0) > 0 ? ` · extra ${extraSize} → ${applied?.extraSize ?? extraSize}` : ''}
          </span>
          <button
            onClick={() => window.confirm(`Supprimer l’adversaire « ${current.name} » et ses deux plans ?`) && removeMatchup(current.id)}
            className="ml-auto h-8 rounded px-2.5 text-meta text-fg-3 hover:bg-ink-800 hover:text-neg"
          >
            Supprimer l’adversaire
          </button>
        </div>

        {/* Légalité du deck de base (S8, S9) : avertissement, jamais un refus. */}
        {legality.length > 0 && (
          <ul data-deck-legality className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-meta text-warn">
            <li className="font-medium">Deck de base hors format — le deck sidé l’est aussi (chiffres calculés quand même) :</li>
            {legality.map((issue, i) => (
              <li key={i}>{describeDeckIssue(issue, name)}</li>
            ))}
          </ul>
        )}

        {/* Cartes du deck de base, une tuile par carte (Q2) ; l'Extra Deck face au side de type Extra (D8). */}
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section aria-label="Main deck">
            <div className="mb-1 text-meta uppercase tracking-wide text-fg-3">Main — à sortir</div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>{main.map((c) => tile(c, 'outgoing', 'main'))}</div>
          </section>
          <section aria-label="Side deck">
            <div className="mb-1 text-meta uppercase tracking-wide text-fg-3">Side — à faire entrer</div>
            {sideMain.length === 0 ? (
              <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-meta text-warn">
                Side deck vide : ajoute des cartes depuis l’onglet Annoter (bloc Side) pour pouvoir échanger.
              </p>
            ) : (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>{sideMain.map((c) => tile(c, 'incoming', 'main'))}</div>
            )}
          </section>
          {(extra.length > 0 || sideExtra.length > 0) && (
            <>
              <section aria-label="Extra deck">
                <div className="mb-1 text-meta uppercase tracking-wide text-fg-3">Extra — à sortir <span className="normal-case tracking-normal text-fg-3">(sans effet sur les chiffres)</span></div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>{extra.map((c) => tile(c, 'outgoing', 'extra'))}</div>
              </section>
              <section aria-label="Side deck (extra)">
                <div className="mb-1 text-meta uppercase tracking-wide text-fg-3">Side — vers l’extra</div>
                {sideExtra.length === 0 ? <p className="text-meta text-fg-3">—</p> : <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>{sideExtra.map((c) => tile(c, 'incoming', 'extra'))}</div>}
              </section>
            </>
          )}
        </div>

        {/* Écarts des candidats (S4) : l'indicateur affiché, et le calcul à la demande au-delà du budget (Q5). */}
        {candidates.status !== 'none' && (
          <div data-candidates={candidates.status} className="flex flex-wrap items-center gap-2 text-meta text-fg-3">
            <span>Écart de chaque {candidates.direction === 'incoming' ? 'entrante' : 'sortante'} possible, contre le plan actuel :</span>
            <select value={indicator} onChange={(e) => setCandidateIndicator(e.target.value as Indicator)} aria-label="Indicateur des écarts" className="h-6 rounded border border-ink-700 bg-ink-850 px-1 text-meta text-fg-1">
              {(Object.keys(INDICATOR_LABEL) as Indicator[]).map((k) => (
                <option key={k} value={k}>{INDICATOR_LABEL[k]}</option>
              ))}
            </select>
            {candidates.status === 'pending' && (
              <button data-run-candidates onClick={runCandidates} className="h-6 rounded border border-ink-700 px-2 text-meta text-fg-2 hover:bg-ink-800">
                Calculer les écarts (≈ {Math.max(1, Math.round(candidates.estimateMs / 1000))} s)
              </button>
            )}
            {candidates.status === 'running' && <span role="status">calcul {candidates.done} / {candidates.distinct}…</span>}
            {candidates.error && <span className="text-neg">{candidates.error}</span>}
          </div>
        )}

        {/* Le plan : deux listes agrégées (D6), écarts, sources neutralisées, chiffres, note. */}
        <section className="flex flex-col gap-2 rounded-md border border-ink-800 bg-ink-900 p-2" data-plan={position}>
          <div className="grid gap-2 sm:grid-cols-2">
            <PlanList label="Sort" direction="outgoing" list={plan.outgoing} name={name} zoneOf={zoneOf} onRemove={(direction, id) => removeFromPlan(current.id, position, direction, id, Infinity)} />
            <PlanList label="Entre" direction="incoming" list={plan.incoming} name={name} zoneOf={zoneOf} onRemove={(direction, id) => removeFromPlan(current.id, position, direction, id, Infinity)} />
          </div>
          {applied && applied.issues.length > 0 && (
            <ul className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-meta text-warn" data-plan-issues>
              {applied.issues.map((issue) => (
                <li key={`${issue.kind}:${issue.cardId}`}>{describeIssue(issue, name)}</li>
              ))}
            </ul>
          )}
          {neutralized.length > 0 && (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-meta text-warn" data-neutralized>
              Neutralisé{neutralized.length > 1 ? 's' : ''} par ce plan (condition devenue impossible) :{' '}
              {neutralized.map((n) => (n.kind === 'starter' ? name(n.cardId) : `paire ${name(n.cardA)} + ${name(n.cardB)}`)).join(' · ')}
            </p>
          )}
          <PlanFigures position={position} matchupName={current.name} status={status} reason={inSync ? studied.deck.unavailableReason : null} plan={planIx} base={baseIx} computing={!inSync || studied.computing || (studied.reusesBase && baseComputing)} stale={inSync && studied.stale} error={inSync ? studied.error : null} />
          <div className="flex flex-wrap items-center gap-2">
            {lastSwap && (
              <button data-undo-swap onClick={undoLastSwap} disabled={!undoable} title={undoable ? 'Retirer du plan les copies du dernier échange' : 'Les copies du dernier échange ont déjà été retirées du plan'} className="h-8 rounded border border-ink-700 px-2.5 text-meta text-fg-2 hover:bg-ink-800 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent">
                Annuler l’échange
              </button>
            )}
            {!planIsEmpty && (
              <button data-clear-plan onClick={() => window.confirm(`Vider le plan ${POSITION_LABEL[position].toLowerCase()} contre « ${current.name} » ? La note est conservée.`) && clearOpenPlan()} className="h-8 rounded px-2.5 text-meta text-fg-3 hover:bg-ink-800 hover:text-neg">
                Vider le plan
              </button>
            )}
            <button
              onClick={() => {
                if (planIsEmpty || window.confirm(`Remplacer le plan ${POSITION_LABEL[position].toLowerCase()} par celui en ${POSITION_LABEL[other].toLowerCase()} ?`)) copyPlan(current.id, other, position);
              }}
              className="h-8 rounded border border-ink-700 px-2.5 text-meta text-fg-2 hover:bg-ink-800"
            >
              Recopier depuis {POSITION_LABEL[other].toLowerCase()}
            </button>
          </div>
          <textarea
            value={plan.note ?? ''}
            onChange={(e) => setPlanNote(current.id, position, e.target.value)}
            placeholder="Note pour ce plan (imprimée sur la fiche)…"
            rows={2}
            aria-label="Note du plan"
            className="min-w-0 resize-y rounded border border-ink-700 bg-ink-950 px-2 py-1 text-body text-fg-1 outline-none placeholder:text-fg-3 focus:border-ink-500"
          />
          {/* D11 : fiche et comparateur lisent le deck ENREGISTRÉ — la raison se voit, un geste enregistre puis ouvre. */}
          <div className="flex flex-wrap items-center gap-2" data-open-actions>
            <button
              data-open-sheet
              onClick={() => deckId && (dirty ? void saveThen(() => navigate({ name: 'sideSheet', id: deckId })) : navigate({ name: 'sideSheet', id: deckId }))}
              disabled={saving || !deckId}
              className="h-8 rounded border border-ink-700 px-2.5 text-meta text-fg-2 hover:bg-ink-800 disabled:opacity-40"
            >
              {dirty ? 'Enregistrer et ouvrir la fiche' : 'Fiche imprimable'}
            </button>
            <button
              data-compare-plan
              onClick={() => deckId && (dirty ? void saveThen(() => navigate({ name: 'compare', a: deckId, b: compareSegment(deckId, current.id, position) })) : navigate({ name: 'compare', a: deckId, b: compareSegment(deckId, current.id, position) }))}
              disabled={status !== 'ready' || saving || !deckId}
              className="h-8 rounded border border-ink-700 px-2.5 text-meta text-fg-2 hover:bg-ink-800 disabled:opacity-40"
            >
              {dirty ? 'Enregistrer et comparer' : 'Comparer au deck de base'}
            </button>
            {(savedReason || status !== 'ready') && (
              <span data-open-reason className="text-meta text-fg-3">{status !== 'ready' ? 'Seul un plan prêt se compare.' : savedReason}</span>
            )}
          </div>
        </section>

        {/* Au téléphone (D12, Q10) : le panneau Probabilités sous le plan, dans cet onglet seulement. */}
        {withPanel && (
          <div data-side-panel className="rounded-md border border-ink-800">
            <StatsPanel />
          </div>
        )}
      </div>

      {/* Barre d'action collante (D12) : la sélection, ce qu'elle donnerait (S3), « Échanger ». */}
      <div data-action-bar className="sticky bottom-0 mt-auto flex flex-wrap lg:static items-center gap-x-3 gap-y-1 border-t border-ink-800 bg-ink-950/95 px-2 py-1.5 backdrop-blur">
        <span className="tnum text-body text-fg-3" data-selection>
          Sélection : −{selOut} / +{selIn}
        </span>
        <PreviewFigures position={position} matchupName={current.name} preview={previewIx} plan={planIx} />
        <div className="ml-auto flex items-center gap-2">
          {(selOut > 0 || selIn > 0) && (
            <button onClick={clearSelection} className="h-8 rounded px-2.5 text-meta text-fg-3 hover:bg-ink-800 hover:text-fg-1">
              Vider la sélection
            </button>
          )}
          <button
            data-swap
            onClick={doSwap}
            disabled={preview.kind !== 'ready' && preview.kind !== 'not-ready'}
            className="h-8 rounded bg-ink-700 px-3 text-body font-medium text-fg-1 hover:bg-ink-600 disabled:cursor-default disabled:bg-ink-800 disabled:text-fg-3"
            title={preview.kind === 'ready' || preview.kind === 'not-ready' ? 'Ajouter ces copies au plan' : preview.kind === 'none' ? 'Clic sur une carte : une copie de plus à sortir ou à faire entrer ; clic droit : une de moins' : preview.reason}
          >
            Échanger
          </button>
        </div>
        {(preview.kind === 'unbalanced' || preview.kind === 'refused') && (
          <span data-preview-reason className="w-full text-meta text-warn">{preview.reason}</span>
        )}
        {swapError && (
          <span role="alert" className="w-full text-meta text-neg">{swapError}</span>
        )}
      </div>
    </div>
  );
}

/** Un écart plus petit que le bruit flottant est un zéro exact (« · »), même seuil que `CardTile`. */
const exact = (d: number): number => (Math.abs(d) < 1e-9 ? 0 : d);

/** Une carte, ses copies, ce que le plan en fait, la sélection en cours et, à une copie près, l'écart
 *  que son échange donnerait (S4). Clic = +1 copie sélectionnée, clic droit = −1 (menu natif neutralisé). */
function ChoiceTile({
  cardId, zone, direction, copies, engaged, selected, free, unknownZone, candidate, indicator, name, onAdjust,
}: {
  cardId: number; zone: DeckZone; direction: PlanDirection; copies: number; engaged: number; selected: number; free: number; unknownZone: boolean;
  candidate: { value: number | null; pending: boolean } | null; indicator: Indicator; name: string; onAdjust: (delta: 1 | -1) => void;
}) {
  const act = (delta: 1 | -1) => (e: MouseEvent) => {
    e.preventDefault();
    onAdjust(delta);
  };
  const state = selected > 0 ? 'selected' : engaged >= copies ? 'engaged' : free === 0 ? 'exhausted' : 'free';
  return (
    <div
      data-choice={direction}
      data-card-id={cardId}
      data-state={state}
      className={`relative flex flex-col rounded-md border bg-ink-900 ${selected > 0 ? 'border-emerald-300 ring-2 ring-emerald-300' : 'border-ink-800'} ${state === 'exhausted' ? 'opacity-60' : ''}`}
    >
      <button
        onClick={act(1)}
        onContextMenu={act(-1)}
        disabled={unknownZone}
        aria-label={name}
        title={`${name} — ${copies} copie${copies > 1 ? 's' : ''}${engaged ? `, ${engaged} ${direction === 'outgoing' ? 'sortante' : 'entrante'}${engaged > 1 ? 's' : ''} dans le plan` : ''}${selected ? `, ${selected} sélectionnée${selected > 1 ? 's' : ''}` : ''} — clic : une copie de plus, clic droit : une de moins`}
        className="relative block aspect-[59/86] w-full overflow-hidden rounded-t-md disabled:cursor-not-allowed"
      >
        <CardImage cardId={cardId} className={`h-full w-full object-cover ${engaged >= copies ? 'opacity-45' : ''}`} />
        {selected > 0 && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-emerald-500/20 text-title font-bold text-emerald-100">+{selected}</span>
        )}
        {engaged > 0 && (
          <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 text-meta text-fg-1" data-engaged={engaged}>
            {direction === 'outgoing' ? 'sort' : 'entre'} ×{engaged}
          </span>
        )}
        {zone === 'extra' && <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-black/75 px-1 text-meta text-fg-3">extra</span>}
        {unknownZone && <span className="pointer-events-none absolute inset-x-0 top-0 bg-amber-500/25 text-center text-meta text-amber-100">zone inconnue</span>}
      </button>
      <div className="truncate px-1 pt-0.5 text-meta leading-tight text-fg-2" title={name}>{name}</div>
      <div className="flex items-center justify-between px-1 pb-0.5 text-meta leading-tight text-fg-3">
        <span className="tnum" title="Copies libres / copies dans la zone">{free}/{copies}</span>
        {candidate && (
          <span data-candidate-delta={candidate.value === null ? 'pending' : 'ready'} className={`tnum ${candidate.value === null ? '' : exact(candidate.value) > 0 ? 'text-pos' : exact(candidate.value) < 0 ? 'text-neg' : ''}`} title={`Écart « ${INDICATOR_LABEL[indicator]} » si cette copie ${direction === 'outgoing' ? 'sort' : 'entre'}, contre le plan actuel${candidate.value === null ? '' : ` : ${(100 * candidate.value).toFixed(4)} points`}`}>
            {candidate.value === null ? (candidate.pending ? '…' : '') : exact(candidate.value) === 0 ? '·' : signedPct(candidate.value, 1)}
          </span>
        )}
      </div>
    </div>
  );
}

function PlanList({ label, direction, list, name, zoneOf, onRemove }: { label: string; direction: PlanDirection; list: SidePlanCard[]; name: (cardId: number) => string; zoneOf: (id: number) => DeckZone | null; onRemove: (direction: PlanDirection, cardId: number) => void }) {
  return (
    <div data-plan-list={direction}>
      <div className="mb-1 text-meta uppercase tracking-wide text-fg-3">
        {label} <span className="tnum text-fg-3">{countOf(list)}</span>
      </div>
      {list.length === 0 ? (
        <p className="text-meta text-fg-3">—</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {list.map((c) => (
            <li key={c.card_id} className="flex h-6 items-center gap-1 rounded bg-ink-800 pl-2 text-meta text-fg-2">
              <span className="max-w-[10rem] truncate">{name(c.card_id)}</span>
              <span className="tnum text-fg-3">×{c.copies}</span>
              {zoneOf(c.card_id) === 'extra' && <span className="text-fg-3">extra</span>}
              <button onClick={() => onRemove(direction, c.card_id)} title="Retirer cette carte du plan (toutes ses copies)" className="flex h-6 w-6 items-center justify-center rounded text-fg-3 hover:bg-ink-700 hover:text-fg-1">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Les trois chiffres du plan ouvert (deck étudié) et l'écart avec le deck de base (R8). */
function PlanFigures({ position, matchupName, status, reason, plan, base, computing, stale, error }: { position: SidePlanPosition; matchupName: string; status: string; reason: string | null; plan: PlanIndicators | null; base: PlanIndicators | null; computing: boolean; stale: boolean; error: string | null }) {
  if (status !== 'ready') return <p className="text-meta text-warn" data-plan-figures="none">{reason ?? 'Aucun chiffre tant que le plan n’est pas prêt.'}</p>;
  if (!plan) return <p className="text-meta text-fg-3" data-plan-figures="computing">{error ? `Calcul en échec : ${error}` : 'Calcul du deck sidé…'}</p>;
  return (
    <div data-plan-figures="ready" className={stale ? 'opacity-45' : ''}>
      <div className="mb-1 text-meta uppercase tracking-wide text-fg-3">
        Deck sidé · contre {matchupName} · {position === 'first' ? 'premier · 5 cartes' : 'second · 5 cartes + pioche'}
        {base ? ' · écart avec le deck de base' : ' · écart : en attente du calcul du deck de base'}
        {computing ? ' · écarts de tuile en cours' : ''}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {CELLS.map(({ key, label, hint }) => {
          const d = base ? exact(plan[key] - base[key]) : null;
          return (
            <div key={key} className="flex items-baseline gap-1.5" title={`${key === 'strongHand' ? STRONG_HINT[position] : hint} — ${(100 * plan[key]).toFixed(4)} %`} data-figure={key}>
              <span className="text-meta text-fg-3">{label}</span>
              <span className="tnum text-value font-semibold text-fg-1">{pct(plan[key], 1)}</span>
              {d !== null && (
                <span className={`tnum text-meta ${d > 0 ? 'text-pos' : d < 0 ? 'text-neg' : 'text-fg-3'}`} title={`Écart : ${(100 * d).toFixed(4)} points`}>
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

/** L'aperçu de la sélection (S3) : les trois chiffres du deck « plan + sélection » et l'écart avec le plan. */
function PreviewFigures({ position, matchupName, preview, plan }: { position: SidePlanPosition; matchupName: string; preview: PlanIndicators | null; plan: PlanIndicators | null }) {
  const state = useDeck((s) => s.preview);
  if (state.kind === 'none') return null;
  if (state.kind === 'not-ready') return <span data-preview="not-ready" className="text-meta text-warn">Échange acceptable, mais le plan reste {state.applied.status === 'incomplete' ? 'incomplet' : 'à revoir'} : pas d’aperçu.</span>;
  if (state.kind !== 'ready') return null;
  if (!state.affectsEngine) return <span data-preview="same" className="text-meta text-fg-3">Aperçu : mêmes chiffres que le plan (échange sans effet sur le calcul).</span>;
  if (!preview) return <span data-preview="computing" className="text-meta text-fg-3">{state.error ? `Aperçu en échec : ${state.error}` : 'Calcul de l’aperçu…'}</span>;
  // D5 : pendant le calcul d'une nouvelle sélection, les chiffres de la précédente restent lisibles mais
  // atténués et dits « calcul de l'aperçu… » — jamais présentés comme ceux de la sélection courante.
  const pending = state.computing;
  return (
    <span data-preview={pending ? 'stale' : 'ready'} className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 ${pending ? 'opacity-45' : ''}`}>
      <span className="text-meta text-info">aperçu · contre {matchupName} · {POSITION_LABEL[position].toLowerCase()}{pending ? ' · calcul de l’aperçu…' : ''}</span>
      {CELLS.map(({ key, label }) => {
        const d = plan ? exact(preview[key] - plan[key]) : null;
        return (
          <span key={key} className="flex items-baseline gap-1" data-preview-figure={key}>
            <span className="text-meta text-fg-3">{label}</span>
            <span className="tnum text-body font-semibold text-fg-1">{pct(preview[key], 1)}</span>
            {d !== null && <span className={`tnum text-meta ${d > 0 ? 'text-pos' : d < 0 ? 'text-neg' : 'text-fg-3'}`} title="Écart avec le plan actuel">{deltaPoints(d)}</span>}
          </span>
        );
      })}
    </span>
  );
}
