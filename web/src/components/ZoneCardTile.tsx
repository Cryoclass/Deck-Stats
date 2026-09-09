import { useDeck } from '../store/deckStore.js';
import { MAX_COPIES } from '../lib/ydk.js';
import type { Card, Zone } from '../types.js';
import { CardImage } from './CardImage.js';

/**
 * Tuile d'une carte de l'extra ou du side (étape 9C) : image au ratio 59/86 et stepper de
 * copies à 32 px, rien d'autre — aucune annotation, aucun delta, aucun menu : ces zones ne
 * participent jamais au calcul (contrat §2). 80 px suffisent (charte §6.3) : le stepper est
 * la seule ligne sous l'image. 0 copie = retrait avec toast d'annulation dans la même zone.
 */
export function ZoneCardTile({ cardId, zone }: { cardId: number; zone: Zone }) {
  const card = useDeck((s) => s.cards[cardId]) as Card | undefined;
  const copies = useDeck((s) => s[zone].find((m) => m.cardId === cardId)?.copies ?? 1);
  const setCopies = useDeck((s) => s.setCopies);
  const name = card?.name ?? String(cardId);

  return (
    <div data-zone-tile={zone} data-card-id={cardId} className="group relative flex flex-col rounded-md border border-ink-800 bg-ink-900">
      <div className="relative block aspect-[59/86] w-full overflow-hidden rounded-t-md" title={name}>
        <CardImage cardId={cardId} />
      </div>
      <div className="flex items-center justify-center pt-1">
        <div className="flex shrink-0 items-center rounded border border-ink-700 bg-ink-850">
          <button
            onClick={() => setCopies(cardId, copies - 1, zone)}
            className="flex h-8 w-8 items-center justify-center text-sm text-ink-300 hover:text-ink-100"
            title={copies <= 1 ? `Retirer du ${zone} (0 copie)` : 'Moins de copies'}
          >
            −
          </button>
          <span className="tnum w-3 text-center text-[11px] text-ink-100">{copies}</span>
          <button
            onClick={() => setCopies(cardId, copies + 1, zone)}
            disabled={copies >= MAX_COPIES}
            className="flex h-8 w-8 items-center justify-center text-sm text-ink-300 hover:text-ink-100 disabled:opacity-30"
            title="Plus de copies"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
