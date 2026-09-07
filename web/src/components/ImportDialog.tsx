import { useState, type ReactNode } from 'react';
import { useDeck } from '../store/deckStore.js';
import { clampToConvention, deckCardCount, parsePastedIds, parseYdk, MAX_COPIES, type ParsedDeck, type ParseReport } from '../lib/ydk.js';
import { parseDeckJson } from '../lib/exportDeck.js';
import { api } from '../lib/api.js';
import type { Card } from '../types.js';

/** Aperçu d'un import partiellement reconnu (étape 6, contrat §2) : tout écart est
 *  présenté et l'import ne continue que sur décision explicite. */
interface Review {
  report: ParseReport;
  name: string;
  resolved: Card[];
  /** Passcodes absents du catalogue : conservés tels quels, jamais rendus neutres (Y8). */
  unknownCardIds: number[];
  /** Le catalogue n'a pas répondu : noms non vérifiés, dit plutôt qu'avalé. */
  catalogueError: boolean;
}

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
  const [review, setReview] = useState<Review | null>(null);

  const create = async (parsed: ParsedDeck, deckName: string, resolved: Card[]) => {
    setBusy(true);
    setError(null);
    const id = await createDeckFromParsed(deckName || 'Deck importé', parsed, resolved);
    setBusy(false);
    if (id) onCreated(id);
    else setError(useDeck.getState().persistenceError ?? 'Import impossible.');
  };

  // Analyse → résolution du catalogue → import direct si rien à signaler, sinon aperçu.
  const prepare = async (report: ParseReport, deckName: string) => {
    setError(null);
    if (deckCardCount(report.deck) === 0) {
      const detail = report.ignored.length ? ` ${report.ignored.length} ligne${report.ignored.length > 1 ? 's' : ''} non reconnue${report.ignored.length > 1 ? 's' : ''} : ${report.ignored.slice(0, 3).map((l) => `« ${l.text} »`).join(', ')}${report.ignored.length > 3 ? '…' : ''}.` : '';
      return setError(`Aucune carte reconnue.${detail}`);
    }
    const ids = [...report.deck.main.keys(), ...report.deck.extra.keys(), ...report.deck.side.keys()];
    let resolved: Card[] = [];
    let catalogueError = false;
    setBusy(true);
    try {
      resolved = await api.cardsByIds(ids);
    } catch {
      catalogueError = true;
    }
    setBusy(false);
    const known = new Set(resolved.map((c) => c.id));
    const unknownCardIds = catalogueError ? [] : ids.filter((id) => !known.has(id));
    const anomalies =
      report.ignored.length > 0 || report.unknownHeaders.length > 0 || report.overLimit.length > 0 ||
      unknownCardIds.length > 0 || catalogueError || report.deck.main.size === 0;
    if (!anomalies) return create(report.deck, deckName, resolved);
    setReview({ report, name: deckName, resolved, unknownCardIds, catalogueError });
  };

  const onYdkFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => void prepare(parseYdk(String(reader.result)), name || file.name.replace(/\.ydk$/i, ''));
    reader.readAsText(file);
  };

  const onJsonFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      let json;
      try {
        json = parseDeckJson(String(reader.result));
      } catch (e) {
        return setError(e instanceof Error ? e.message : 'Fichier JSON invalide.');
      }
      setBusy(true);
      setError(null);
      const id = await importDeckJson({ ...json, configuration: { ...json.configuration, name: name || json.configuration.name } });
      setBusy(false);
      if (id) onCreated(id);
      else setError(useDeck.getState().persistenceError ?? 'Import impossible.');
    };
    reader.readAsText(file);
  };

  const onPaste = () => void prepare(parsePastedIds(text), name);

  const onEmpty = () => void create({ main: new Map(), extra: new Map(), side: new Map() }, name || 'Nouveau deck', []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-100">{review ? 'Vérifier l’import' : 'Nouveau deck'}</h2>
          <button
            onClick={onClose}
            title="Fermer"
            className="flex h-8 w-8 items-center justify-center rounded text-ink-500 hover:bg-ink-800 hover:text-ink-200"
          >
            ✕
          </button>
        </div>

        {review ? (
          <ReviewPanel
            review={review}
            busy={busy}
            error={error}
            onBack={() => { setReview(null); setError(null); }}
            onConfirm={() => void create(clampToConvention(review.report.deck), review.name, review.resolved)}
          />
        ) : (
          <>
            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Nom du deck</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex. Ryzeal going second"
                className="w-full rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-sm text-ink-100"
              />
            </label>

            {/* Étape 6B : une colonne sous 640 px — deux zones de fichier côte à côte
                forçaient le dialogue au-delà de 360 px (largeur minimale des <input type=file>). */}
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FileZone label="Fichier YDK" accept=".ydk,text/plain" onFile={onYdkFile} />
              <FileZone label="Fichier JSON complet" accept=".json,application/json" onFile={onJsonFile} />
            </div>

            <div className="mb-3">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
                ou coller des passcodes (main deck, un par ligne : « 12345678 », « 3x 12345678 » ou « 3 12345678 » ; texte après le passcode et lignes « # » ignorés)
              </span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                className="w-full resize-y rounded border border-ink-700 bg-ink-850 px-2 py-1.5 font-num text-xs text-ink-100"
                placeholder={'27204311\n27204311\n27204311\n14558127'}
              />
            </div>

            {error && <div role="alert" className="mb-3 text-xs text-red-400">{error}</div>}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button onClick={onEmpty} disabled={busy} className="whitespace-nowrap py-1 text-xs text-ink-400 hover:text-ink-200">
                Créer un deck vide
              </button>
              <div className="ml-auto flex gap-2">
                <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">
                  Annuler
                </button>
                <button
                  onClick={onPaste}
                  disabled={busy || !text.trim()}
                  className="whitespace-nowrap rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
                >
                  {busy ? 'Création…' : 'Importer le texte'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Chaque écart est listé (contrat §2 : lignes ignorées présentées, quantité hors
 *  convention signalée avant enregistrement, carte inconnue jamais neutre) ; le bouton
 *  d'import nomme les ajustements qu'il applique. */
function ReviewPanel({
  review,
  busy,
  error,
  onBack,
  onConfirm,
}: {
  review: Review;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { report, resolved, unknownCardIds, catalogueError } = review;
  const nameOf = (id: number) => resolved.find((c) => c.id === id)?.name ?? `#${id}`;
  const zoneLabel = { main: 'main', extra: 'extra', side: 'side' } as const;
  const recognised = deckCardCount(report.deck);
  const mainEmpty = report.deck.main.size === 0;

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="text-ink-300">
        <span className="font-medium text-ink-100">{review.name || 'Deck importé'}</span> — {recognised} carte{recognised > 1 ? 's' : ''} lue{recognised > 1 ? 's' : ''} ({report.deck.main.size} identité{report.deck.main.size > 1 ? 's' : ''} en main, {report.deck.extra.size} en extra, {report.deck.side.size} en side).
      </div>

      {mainEmpty && (
        <Notice tone="amber" title="Main deck vide">
          Le deck sera enregistré sans main deck (extra et side conservés) ; aucune analyse n’est possible tant que le main est vide.
        </Notice>
      )}

      {report.overLimit.length > 0 && (
        <Notice tone="amber" title={`Quantités hors convention 1–${MAX_COPIES}`}>
          <ul className="mt-1 flex flex-col gap-0.5">
            {report.overLimit.map((o) => (
              <li key={`${o.zone}-${o.cardId}`}>
                {nameOf(o.cardId)} ({zoneLabel[o.zone]}) : <span className="tnum">{o.copies}</span> copies → ramenée à {MAX_COPIES} si vous importez.
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {report.ignored.length > 0 && (
        <Notice tone="amber" title={`${report.ignored.length} ligne${report.ignored.length > 1 ? 's' : ''} non reconnue${report.ignored.length > 1 ? 's' : ''} (aucune carte ajoutée pour elles)`}>
          <ul className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-y-auto font-num">
            {report.ignored.map((l) => (
              <li key={l.line} className="truncate">
                <span className="text-ink-500">l.{l.line}</span> {l.text}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {report.unknownHeaders.length > 0 && (
        <Notice tone="amber" title="En-têtes de zone non reconnus">
          <ul className="mt-1 flex flex-col gap-0.5 font-num">
            {report.unknownHeaders.map((l) => (
              <li key={l.line}>
                <span className="text-ink-500">l.{l.line}</span> {l.text} — attendu « #main », « #extra » ou « !side » ; les cartes qui suivent restent dans la zone précédente.
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {unknownCardIds.length > 0 && (
        <Notice tone="amber" title={`${unknownCardIds.length} passcode${unknownCardIds.length > 1 ? 's' : ''} inconnu${unknownCardIds.length > 1 ? 's' : ''} du catalogue`}>
          Conservé{unknownCardIds.length > 1 ? 's' : ''} avec leur passcode et compté{unknownCardIds.length > 1 ? 's' : ''} comme cartes du deck (image tentée depuis le CDN, nom absent) :{' '}
          <span className="font-num">{unknownCardIds.join(', ')}</span>.
        </Notice>
      )}

      {catalogueError && (
        <Notice tone="red" title="Catalogue indisponible">
          Les noms n’ont pas pu être vérifiés ; les cartes seront enregistrées par passcode. Réessayez plus tard pour les vérifier.
        </Notice>
      )}

      {error && <div role="alert" className="text-red-400">{error}</div>}

      <div className="mt-2 flex items-center justify-end gap-2">
        <button onClick={onBack} disabled={busy} className="rounded px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">
          Retour
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
        >
          {busy ? 'Création…' : report.overLimit.length > 0 ? `Importer avec ${MAX_COPIES} copies maximum` : 'Importer quand même'}
        </button>
      </div>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: 'amber' | 'red'; title: string; children: ReactNode }) {
  const cls = tone === 'red' ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return (
    <div role="status" className={`rounded-md border px-2.5 py-1.5 ${cls}`}>
      <div className="font-medium">{title}</div>
      <div className="mt-0.5 text-[11px] opacity-90">{children}</div>
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
        className="mx-auto block w-full min-w-0 text-[11px] text-ink-300 file:mr-2 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-ink-100"
      />
    </div>
  );
}
