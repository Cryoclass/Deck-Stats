import { useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { Segmented } from './ui.js';

export function Header({
  column,
  setColumn,
  onOpenImport,
}: {
  column: 'first' | 'second';
  setColumn: (c: 'first' | 'second') => void;
  onOpenImport: () => void;
}) {
  const deckName = useDeck((s) => s.deckName);
  const renameDeck = useDeck((s) => s.renameDeck);
  const online = useDeck((s) => s.online);
  const deckSize = useDeck((s) => s.main.reduce((a, c) => a + c.copies, 0));
  const hasDeck = useDeck((s) => s.main.length > 0);

  const [copied, setCopied] = useState(false);

  const outOfBounds = hasDeck && (deckSize < 40 || deckSize > 60);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-950 px-4 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold tracking-tight text-ink-100">YGO</span>
        <span className="text-[11px] text-ink-500">probabilités &amp; mains</span>
      </div>

      <div className="mx-1 h-5 w-px bg-ink-800" />

      {hasDeck && (
        <input
          value={deckName}
          onChange={(e) => renameDeck(e.target.value)}
          className="w-52 rounded bg-transparent px-1 py-0.5 text-sm text-ink-100 outline-none hover:bg-ink-900 focus:bg-ink-900"
        />
      )}

      {hasDeck && (
        <span
          className={`tnum rounded px-1.5 py-0.5 text-[11px] ${
            outOfBounds ? 'bg-amber-500/15 text-amber-300' : 'bg-ink-800 text-ink-400'
          }`}
          title="Taille du main deck (extra/side exclus)"
        >
          {deckSize} cartes
        </span>
      )}

      <div className="ml-auto flex items-center gap-3">
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

        {hasDeck && (
          <button
            onClick={copyLink}
            className="rounded border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:bg-ink-800"
          >
            {copied ? 'copié !' : 'copier le lien'}
          </button>
        )}

        <button
          onClick={onOpenImport}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-black hover:bg-emerald-500"
        >
          Importer
        </button>
      </div>
    </header>
  );
}
