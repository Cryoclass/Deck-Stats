import { useMemo } from 'react';
import { useDeck } from '../store/deckStore.js';
import { Segmented } from './ui.js';
import { CONTEXT_LABEL, CONTEXT_SHORT, CONTEXT_TITLE } from './Header.js';

/**
 * Barre de contexte de l'éditeur (plans de side v2, D1, D3, S1) : UNE commande pour le deck étudié
 * (deck de base ou un adversaire) et la position (premier / second), visible sur tous les onglets,
 * sous l'en-tête. Les bascules du panneau « Probabilités » et du mur de mains sont remplacées par
 * celle-ci. Sélecteur natif (au téléphone, le système ouvre sa liste) ; un adversaire supprimé
 * pendant l'étude est dit, et le deck de base reprend. La raison d'un plan sans chiffre (S2) est dite
 * ici aussi, à côté de la commande qui l'a choisi. Une ligne de 32 px à 360 px : contrôles de 24 px
 * (plancher des cibles secondaires), libellé « Étudier » masqué sous 640 px.
 */
export function StudyBar() {
  const matchups = useDeck((s) => s.matchups);
  const matchupId = useDeck((s) => s.study.matchupId);
  const context = useDeck((s) => s.context);
  const setStudy = useDeck((s) => s.setStudy);
  const setContext = useDeck((s) => s.setContext);
  const reason = useDeck((s) => s.studied[s.context].deck.unavailableReason);
  const ordered = useMemo(() => [...matchups].sort((a, b) => a.sort_index - b.sort_index), [matchups]);
  const unknown = matchupId !== null && !matchups.some((m) => m.id === matchupId);

  return (
    <div data-study-bar className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-ink-800 bg-ink-900 px-3 py-1 sm:gap-x-3">
      <span className="hidden text-meta uppercase tracking-wide text-fg-3 sm:inline">Étudier</span>
      <select
        data-study-select
        value={unknown ? '' : (matchupId ?? '')}
        onChange={(e) => setStudy(e.target.value || null)}
        aria-label="Deck étudié"
        title="Le deck dont l'éditeur affiche les chiffres : le deck de base, ou le deck après le plan d'un adversaire"
        className="h-6 max-w-[9rem] rounded border border-ink-700 bg-ink-850 px-1.5 text-body text-fg-1 outline-none focus:border-ink-500"
      >
        <option value="">Deck de base</option>
        {ordered.map((m) => (
          <option key={m.id} value={m.id}>
            contre {m.name}
          </option>
        ))}
      </select>
      <span title={CONTEXT_TITLE}>
        <Segmented
          size="sm"
          value={context}
          onChange={setContext}
          options={[
            { value: 'first', label: CONTEXT_SHORT.first, title: CONTEXT_LABEL.first },
            { value: 'second', label: CONTEXT_SHORT.second, title: CONTEXT_LABEL.second },
          ]}
        />
      </span>
      {unknown && (
        <span role="status" className="text-meta text-warn">
          Adversaire introuvable (supprimé ?) : les chiffres sont ceux du deck de base.
        </span>
      )}
      {!unknown && reason && (
        <span role="status" data-study-reason className="text-meta text-warn">
          {reason}
        </span>
      )}
      {matchups.length === 0 && matchupId === null && (
        <span className="hidden text-meta text-fg-3 md:inline">Ajoute un adversaire dans « Plans de side » pour étudier un deck sidé.</span>
      )}
    </div>
  );
}
