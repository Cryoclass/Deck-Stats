import { useEffect, useRef, useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { api } from '../lib/api.js';
import type { Card } from '../types.js';
import { CardImage } from './CardImage.js';

/**
 * Recherche modale d'ajout de carte (itération 3, A). Reste ouverte après un ajout
 * pour en enchaîner plusieurs (même logique que la barre de modes). Recherche par
 * nom (Postgres local) ou par passcode collé. `Entrée` ajoute le premier résultat,
 * `Échap` ferme. Ajout à 1 copie ; carte déjà présente → incrément.
 */
export function AddCardDialog({ onClose }: { onClose: () => void }) {
  const addCard = useDeck((s) => s.addCard);
  const main = useDeck((s) => s.main);
  const deckSize = main.reduce((a, c) => a + c.copies, 0);
  const copiesOf = (id: number) => main.find((m) => m.cardId === id)?.copies ?? 0;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = /^\d{4,}$/.test(q)
          ? await api.cardsByIds([Number(q)]) // passcode collé
          : await api.searchCards(q); // nom (instantané, local)
        if (!cancelled) setResults(res);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const add = (card: Card) => {
    addCard(card);
    inputRef.current?.focus(); // rester au clavier pour enchaîner
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-ink-700 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
          <h2 className="text-base font-semibold text-ink-100">Ajouter une carte</h2>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-200">
            ✕
          </button>
        </div>

        {deckSize >= 60 && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-300">
            Main deck à {deckSize} cartes — au-delà de 60 (§D). Ajout autorisé quand même.
          </div>
        )}

        <div className="p-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && results[0]) {
                e.preventDefault();
                add(results[0]);
              }
            }}
            placeholder="Nom de carte ou passcode…"
            className="w-full rounded border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-ink-100 outline-none focus:border-emerald-500/60"
          />
          <div className="mt-1 flex justify-between text-[10px] text-ink-600">
            <span>Entrée ajoute le premier résultat · Échap ferme</span>
            <span className="tnum">main : {deckSize}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {loading && <div className="px-2 py-3 text-xs text-ink-500">recherche…</div>}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <div className="px-2 py-3 text-xs text-ink-500">Aucun résultat.</div>
          )}
          <ul className="flex flex-col gap-0.5">
            {results.map((card, i) => {
              const inDeck = copiesOf(card.id);
              return (
                <li key={card.id}>
                  <button
                    onClick={() => add(card)}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-ink-800 ${
                      i === 0 ? 'ring-1 ring-inset ring-emerald-500/30' : ''
                    }`}
                  >
                    <span className="block aspect-[59/86] w-9 shrink-0 overflow-hidden rounded">
                      <CardImage cardId={card.id} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-100">{card.name}</span>
                      <span className="block truncate text-[11px] text-ink-500">
                        {[card.type, card.race, card.attribute].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {inDeck > 0 ? (
                      <span className="tnum shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] text-emerald-200">
                        ×{inDeck} → +1
                      </span>
                    ) : (
                      <span className="shrink-0 rounded bg-ink-700 px-1.5 py-0.5 text-[11px] text-ink-200">
                        + ajouter
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
