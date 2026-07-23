import { useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { parsePastedIds, parseYdk, type ParsedDeck } from '../lib/ydk.js';
import { parseDeckJson } from '../lib/exportDeck.js';
import { api } from '../lib/api.js';
import type { Card } from '../types.js';

/** Création d'un deck (§4C) : import YDK, collage de passcodes, deck vide, ou import
 *  JSON complet (deck + annotations fusionnées dans la bibliothèque). */
export function ImportDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const createDeckFromParsed = useDeck((s) => s.createDeckFromParsed);
  const importDeckJson = useDeck((s) => s.importDeckJson);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (parsed: ParsedDeck, deckName: string) => {
    setBusy(true);
    setError(null);
    const ids = [...parsed.main.keys(), ...parsed.extra.keys(), ...parsed.side.keys()];
    let resolved: Card[] = [];
    try {
      resolved = await api.cardsByIds(ids);
    } catch {
      /* images dérivables du CDN */
    }
    const id = await createDeckFromParsed(deckName || 'Deck importé', parsed, resolved);
    setBusy(false);
    if (id) onCreated(id);
    else setError('Backend indisponible — impossible de créer le deck.');
  };

  const onYdkFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseYdk(String(reader.result));
      if (parsed.main.size === 0) return setError('Aucune carte dans le main deck de ce fichier.');
      void create(parsed, name || file.name.replace(/\.ydk$/i, ''));
    };
    reader.readAsText(file);
  };

  const onJsonFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const json = parseDeckJson(String(reader.result));
      if (!json) return setError('Fichier JSON invalide (format ygo-proba-deck attendu).');
      setBusy(true);
      setError(null);
      const id = await importDeckJson({ ...json, name: name || json.name });
      setBusy(false);
      if (id) onCreated(id);
      else setError('Backend indisponible — import impossible.');
    };
    reader.readAsText(file);
  };

  const onPaste = () => {
    const main = parsePastedIds(text);
    if (main.size === 0) return setError('Aucun passcode reconnu dans le texte collé.');
    void create({ main, extra: new Map(), side: new Map() }, name);
  };

  const onEmpty = () => void create({ main: new Map(), extra: new Map(), side: new Map() }, name || 'Nouveau deck');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-100">Nouveau deck</h2>
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

        <div className="mb-3 grid grid-cols-2 gap-3">
          <FileZone label="Fichier YDK" accept=".ydk,text/plain" onFile={onYdkFile} />
          <FileZone label="Fichier JSON complet" accept=".json,application/json" onFile={onJsonFile} />
        </div>

        <div className="mb-3">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
            ou coller des passcodes (un par ligne, « 3x 12345678 » toléré)
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="w-full resize-y rounded border border-ink-700 bg-ink-850 px-2 py-1.5 font-num text-xs text-ink-100"
            placeholder={'27204311\n27204311\n27204311\n14558127'}
          />
        </div>

        {error && <div className="mb-3 text-xs text-red-400">{error}</div>}

        <div className="flex items-center justify-between gap-2">
          <button onClick={onEmpty} disabled={busy} className="text-xs text-ink-400 hover:text-ink-200">
            Créer un deck vide
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">
              Annuler
            </button>
            <button
              onClick={onPaste}
              disabled={busy || !text.trim()}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
            >
              {busy ? 'Création…' : 'Importer le texte'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileZone({
  label,
  accept,
  onFile,
}: {
  label: string;
  accept: string;
  onFile: (file: File) => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-ink-700 p-3 text-center">
      <span className="mb-2 block text-[11px] uppercase tracking-wide text-ink-400">{label}</span>
      <input
        type="file"
        accept={accept}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        className="mx-auto block w-full text-[11px] text-ink-300 file:mr-2 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-ink-100"
      />
    </div>
  );
}
