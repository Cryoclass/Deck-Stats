import { useDeck } from '../store/deckStore.js';
import { Segmented } from './ui.js';
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
  const context = useDeck((s) => s.context);
  const setContext = useDeck((s) => s.setContext);

  const outOfBounds = deckSize < 40 || deckSize > 60;
  const savedLabel = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ink-800 bg-ink-950 px-4 py-2">
      <button
        onClick={onHome}
        className="rounded px-2 py-1 text-xs text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        title="Retour aux decks"
      >
        ← Decks
      </button>

      <div className="mx-1 h-5 w-px bg-ink-800" />

      <input
        value={deckName}
        onChange={(e) => renameDeck(e.target.value)}
        className="w-32 min-w-0 rounded bg-transparent px-1 py-0.5 text-sm text-ink-100 outline-none hover:bg-ink-900 focus:bg-ink-900 sm:w-52"
      />

      <span
        className={`tnum rounded px-1.5 py-0.5 text-[11px] ${
          outOfBounds ? 'bg-amber-500/15 text-amber-300' : 'bg-ink-800 text-ink-400'
        }`}
        title="Taille du main deck (extra/side exclus)"
      >
        {deckSize} cartes
      </span>

      {persistenceError && <p role="alert" className="text-xs text-red-300">{persistenceError}</p>}
      {libraryPending > 0 && <span role="status" className="text-xs text-ink-400">Enregistrement des annotations…</span>}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-1.5 text-[11px] text-ink-500" title="Persistance backend">
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-ink-600'}`} />
          {online ? 'en ligne' : 'hors-ligne'}
        </div>

        {/* Réglage UNIQUE premier/second (étape 5B) : remplace l'ancien bouton « delta ». */}
        <div className="flex items-center gap-1.5 text-[11px] text-ink-400" title={CONTEXT_TITLE}>
          <span>contexte</span>
          <Segmented
            size="sm"
            value={context}
            onChange={setContext}
            options={[
              { value: 'first', label: CONTEXT_SHORT.first, title: CONTEXT_LABEL.first },
              { value: 'second', label: CONTEXT_SHORT.second, title: CONTEXT_LABEL.second },
            ]}
          />
        </div>

        {savedLabel && !dirty && (
          <span className="text-[10px] text-ink-600">enregistré {savedLabel}</span>
        )}

        <button
          onClick={onSave}
          disabled={!dirty || saving || libraryPending > 0}
          title="Enregistrer (Ctrl/Cmd + S)"
          className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors ${
            dirty
              ? 'bg-emerald-600 text-black hover:bg-emerald-500'
              : 'cursor-default bg-ink-800 text-ink-500'
          }`}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
          {dirty && <span className="h-1.5 w-1.5 rounded-full bg-black/70" />}
        </button>

        <AccountMenu />
      </div>
    </header>
  );
}
