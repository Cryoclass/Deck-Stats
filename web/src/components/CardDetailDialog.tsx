import { useDeck } from '../store/deckStore.js';
import { imageCropped, type Card } from '../types.js';

export function CardDetailDialog({ cardId, onClose }: { cardId: number; onClose: () => void }) {
  const card = useDeck((s) => s.cards[cardId]) as Card | undefined;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md gap-4 rounded-xl border border-ink-700 bg-ink-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageCropped(cardId)}
          alt={card?.name ?? String(cardId)}
          className="h-40 w-40 shrink-0 rounded-lg object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-100">{card?.name ?? `#${cardId}`}</h3>
            <button onClick={onClose} className="text-ink-500 hover:text-ink-200">
              ✕
            </button>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-400">
            {[card?.type, card?.race, card?.attribute].filter(Boolean).join(' · ')}
            {card?.atk != null && (
              <span className="tnum"> · ATK {card.atk} / DEF {card?.def ?? '?'}</span>
            )}
          </div>
          <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-ink-300">
            {card?.description ?? '—'}
          </p>
          <div className="tnum mt-2 text-[10px] text-ink-600">passcode {cardId}</div>
        </div>
      </div>
    </div>
  );
}
