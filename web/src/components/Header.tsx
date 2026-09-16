import { useDeck } from '../store/deckStore.js';
import { AccountMenu } from './AccountMenu.js';

/** Libellés du contexte d'analyse (contrat §3), communs à toute l'interface. */
export const CONTEXT_LABEL = {
  first: 'Premier · 5 cartes',
  second: 'Second · 5 cartes + pioche',
} as const;
export const CONTEXT_SHORT = {
  first: 'Premier · 5',
  second: 'Second · 5 + pioche',
} as const;
export const CONTEXT_TITLE =
  'Contexte d’analyse unique : premier = les 5 cartes initiales ; second = les 5 initiales et une sixième pioche identifiée. Il s’applique aux deltas de la grille, à la matrice, aux requêtes et au mur de mains.';

/**
 * En-tête de l'éditeur — UNE ligne à toute largeur (audit 01 §4 : trois lignes et 118 px à
 * 360 px avant cette mise en page). N'y restent que l'identité du deck et l'action.
 * Ce qui en sort :
 *  - le réglage de contexte premier / second, descendu dans le panneau « Probabilités », à
 *    côté des chiffres qu'il gouverne (le mur de mains a déjà le sien) ;
 *  - l'heure du dernier enregistrement, qui devient l'état au repos du bouton lui-même —
 *    un bouton inerte qui dit « enregistré 10:04 » vaut mieux qu'un horodatage séparé ;
 *  - l'état de la persistance, passé en ligne d'état du menu compte.
 * Une erreur de persistance, elle, prend une seconde ligne pleine : elle doit se voir.
 */
export function Header({ onSave, onHome }: { onSave: () => void; onHome: () => void }) {
  const deckName = useDeck((s) => s.deckName);
  const renameDeck = useDeck((s) => s.renameDeck);
  const online = useDeck((s) => s.online);
  const deckSize = useDeck((s) => s.main.reduce((a, c) => a + c.copies, 0));
  const dirty = useDeck((s) => s.dirty);
  const saving = useDeck((s) => s.saving);
  const persistenceError = useDeck((s) => s.persistenceError);
  const libraryPending = useDeck((s) => s.libraryPending);
  const lastSavedAt = useDeck((s) => s.lastSavedAt);

  const outOfBounds = deckSize < 40 || deckSize > 60;
  const savedLabel = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;
  const atRest = !dirty && !saving && savedLabel !== null;

  return (
    <header className="shrink-0 border-b border-ink-800 bg-ink-950">
      <div className="flex h-12 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <button
          onClick={onHome}
          className="flex h-8 shrink-0 items-center rounded px-2 text-body text-fg-3 hover:bg-ink-800 hover:text-fg-1"
          title="Retour aux decks"
        >
          <span aria-hidden>←</span>
          <span className="ml-1 hidden sm:inline">Decks</span>
        </button>

        <input
          value={deckName}
          onChange={(e) => renameDeck(e.target.value)}
          aria-label="Nom du deck"
          className="min-w-0 flex-1 rounded bg-transparent px-1.5 py-1 text-value text-fg-1 outline-none hover:bg-ink-900 focus:bg-ink-900 sm:max-w-[22rem]"
        />

        <span
          className={`tnum shrink-0 rounded px-1.5 py-0.5 text-meta ${
            outOfBounds ? 'bg-amber-500/15 text-warn' : 'bg-ink-800 text-fg-3'
          }`}
          title="Taille du main deck (extra/side exclus)"
        >
          {deckSize}
          <span className="hidden sm:inline"> cartes</span>
          <span className="sm:hidden"> c.</span>
        </span>

        {libraryPending > 0 && (
          <span role="status" className="hidden text-meta text-fg-3 sm:inline">
            Enregistrement des annotations…
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            data-save
            onClick={onSave}
            disabled={!dirty || saving || libraryPending > 0}
            title={atRest ? `Dernier enregistrement à ${savedLabel}` : 'Enregistrer (Ctrl/Cmd + S)'}
            className={`tnum flex h-8 items-center gap-1.5 rounded px-3 text-body font-medium transition-colors ${
              dirty
                ? 'bg-emerald-600 text-black hover:bg-emerald-500'
                : 'cursor-default bg-ink-800 text-fg-3'
            }`}
          >
            {saving ? 'Enregistrement…' : atRest ? `enregistré ${savedLabel}` : 'Enregistrer'}
            {dirty && <span className="h-1.5 w-1.5 rounded-full bg-black/70" />}
          </button>

          <AccountMenu status={{ online, savedLabel }} />
        </div>
      </div>

      {persistenceError && (
        <p role="alert" className="border-t border-red-500/30 bg-red-500/10 px-4 py-1.5 text-body text-neg">
          {persistenceError}
        </p>
      )}
    </header>
  );
}
