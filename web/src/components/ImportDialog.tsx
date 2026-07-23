import { useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { parsePastedIds, parseYdk, type ParsedDeck } from '../lib/ydk.js';
import { api } from '../lib/api.js';
import type { Card } from '../types.js';

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const importDeck = useDeck((s) => s.importDeck);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (parsed: ParsedDeck, deckName: string) => {
    setBusy(true);
    setError(null);
    const ids = [...parsed.main.keys(), ...parsed.extra.keys(), ...parsed.side.keys()];
    let resolved: Card[] = [];
    try {
      resolved = await api.cardsByIds(ids);
    } catch {
      // Backend indisponible : on garde les ids, les images restent dérivables du CDN.
    }
    await importDeck(deckName || 'Deck importé', parsed, resolved);
    setBusy(false);
    onClose();
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseYdk(String(reader.result));
      if (parsed.main.size === 0) {
        setError('Aucune carte dans le main deck de ce fichier.');
        return;
      }
      void run(parsed, name || file.name.replace(/\.ydk$/i, ''));
    };
    reader.readAsText(file);
  };

  const onPaste = () => {
    const main = parsePastedIds(text);
    if (main.size === 0) {
      setError('Aucun passcode reconnu dans le texte collé.');
      return;
    }
    void run({ main, extra: new Map(), side: new Map() }, name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-100">Importer un deck</h2>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-200">
            ✕
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Nom du deck</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex. Ryzeal going second"
            className="w-full rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>

        <div className="mb-4 rounded-lg border border-dashed border-ink-700 p-4 text-center">
          <span className="mb-2 block text-[11px] uppercase tracking-wide text-ink-400">Fichier YDK</span>
          <input
            type="file"
            accept=".ydk,text/plain"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="mx-auto block text-xs text-ink-300 file:mr-3 file:rounded file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-ink-100"
          />
        </div>

        <div className="mb-3">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
            ou coller des passcodes (un par ligne, « 3x 12345678 » toléré)
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className="w-full resize-y rounded border border-ink-700 bg-ink-850 px-2 py-1.5 font-num text-xs text-ink-100"
            placeholder={'27204311\n27204311\n27204311\n14558127'}
          />
        </div>

        {error && <div className="mb-3 text-xs text-red-400">{error}</div>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">
            Annuler
          </button>
          <button
            onClick={onPaste}
            disabled={busy || !text.trim()}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
          >
            {busy ? 'Import…' : 'Importer le texte'}
          </button>
        </div>
      </div>
    </div>
  );
}
