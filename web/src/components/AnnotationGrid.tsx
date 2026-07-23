import { useEffect, useMemo, useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { assignGroups } from '../lib/colors.js';
import { imageSmall } from '../types.js';
import { CardTile } from './CardTile.js';

export function AnnotationGrid({ column }: { column: 'first' | 'second' }) {
  const main = useDeck((s) => s.main);
  const extra = useDeck((s) => s.extra);
  const side = useDeck((s) => s.side);
  const pairs = useDeck((s) => s.pairs);
  const excl = useDeck((s) => s.pairExclusions);
  const result = useDeck((s) => s.result);
  const model = useDeck((s) => s.model);
  const cards = useDeck((s) => s.cards);
  const togglePair = useDeck((s) => s.togglePair);
  const extraSideHidden = useDeck((s) => s.extraSideHidden);
  const setExtraSideHidden = useDeck((s) => s.setExtraSideHidden);

  const [linkFrom, setLinkFrom] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLinkFrom(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups = useMemo(() => {
    const inMain = new Set(main.map((c) => c.cardId));
    const edges = pairs
      .filter((p) => !excl.has(p.id) && inMain.has(p.card_a_id) && inMain.has(p.card_b_id))
      .map((p): [number, number] => [p.card_a_id, p.card_b_id]);
    return assignGroups(edges);
  }, [pairs, excl, main]);

  const deltas = useMemo(() => {
    const m = new Map<number, { first: number; second: number }>();
    if (result && model) model.typeCardIds.forEach((id, i) => m.set(id, result.deltas[i]));
    return m;
  }, [result, model]);

  const pickLink = (id: number) => {
    if (linkFrom === null) return;
    if (linkFrom !== id) togglePair(linkFrom, id);
    setLinkFrom(null);
  };

  if (main.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-400">
        Importe un deck (fichier YDK ou liste collée) pour commencer à annoter.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {linkFrom !== null && (
        <div className="flex items-center justify-between gap-2 border-b border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
          <span>
            Combo depuis <b>{cards[linkFrom]?.name ?? linkFrom}</b> — clique la carte partenaire.
          </span>
          <button onClick={() => setLinkFrom(null)} className="text-emerald-300 hover:underline">
            Annuler (Échap)
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))' }}
        >
          {main.map((c) => (
            <CardTile
              key={c.cardId}
              cardId={c.cardId}
              column={column}
              linkFrom={linkFrom}
              onStartLink={setLinkFrom}
              onPickLink={pickLink}
              groups={groups}
              delta={deltas.get(c.cardId)}
            />
          ))}
        </div>

        {(extra.length > 0 || side.length > 0) && (
          <div className="mt-4">
            <button
              onClick={() => setExtraSideHidden(!extraSideHidden)}
              className="mb-2 text-[11px] uppercase tracking-wide text-ink-500 hover:text-ink-300"
            >
              {extraSideHidden ? '▸' : '▾'} Extra / Side — exclus des calculs (§4.1)
            </button>
            {!extraSideHidden && (
              <div
                className="grid gap-1 opacity-60"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))' }}
              >
                {[...extra, ...side].map((c) => (
                  <img
                    key={`${c.zone}-${c.cardId}`}
                    src={cards[c.cardId]?.image_url_small ?? imageSmall(c.cardId)}
                    alt={cards[c.cardId]?.name ?? String(c.cardId)}
                    title={`${cards[c.cardId]?.name ?? c.cardId} (${c.zone})`}
                    loading="lazy"
                    className="w-full rounded"
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
