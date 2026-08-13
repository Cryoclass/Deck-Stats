import { useDeck } from '../store/deckStore.js';
import { Segmented } from './ui.js';
import { AccountMenu } from './AccountMenu.js';

export function Header({
  column,
  setColumn,
  onSave,
  onHome,
}: {
  column: 'first' | 'second';
  setColumn: (c: 'first' | 'second') => void;
  onSave: () => void;
  onHome: () => void;
}) {
  const deckName = useDeck((s) => s.deckName);
  const renameDeck = useDeck((s) => s.renameDeck);
  const online = useDeck((s) => s.online);
  const deckSize = useDeck((s) => s.main.reduce((a, c) => a + c.copies, 0));
  const dirty = useDeck((s) => s.dirty);
  const lastSavedAt = useDeck((s) => s.lastSavedAt);

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

      <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-1.5 text-[11px] text-ink-500" title="Persistance backend">
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-ink-600'}`} />
          {online ? 'en ligne' : 'hors-ligne'}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-ink-400">
          <span>delta</span>
          <Segmented
            size="sm"
            value={column}
            onChange={setColumn}
            options={[
              { value: 'first', label: '1st' },
              { value: 'second', label: '2nd' },
            ]}
          />
        </div>

        {savedLabel && !dirty && (
          <span className="text-[10px] text-ink-600">enregistré {savedLabel}</span>
        )}

        <button
          onClick={onSave}
          disabled={!dirty}
          title="Enregistrer (Ctrl/Cmd + S)"
          className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors ${
            dirty
              ? 'bg-emerald-600 text-black hover:bg-emerald-500'
              : 'cursor-default bg-ink-800 text-ink-500'
          }`}
        >
          Enregistrer
          {dirty && <span className="h-1.5 w-1.5 rounded-full bg-black/70" />}
        </button>

        <AccountMenu />
      </div>
    </header>
  );
}
