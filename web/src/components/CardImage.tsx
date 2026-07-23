import { useDeck } from '../store/deckStore.js';
import { imageSmall, type Card } from '../types.js';

/** Vignette d'image de carte, partagée entre la grille d'annotation et l'inventaire.
 *  Fallback : l'image est dérivée de l'id via le CDN si elle n'est pas encore résolue
 *  (reutiliser-la-bdd.md). Purement présentationnel — aucun geste d'annotation. */
export function CardImage({ cardId, className }: { cardId: number; className?: string }) {
  const card = useDeck((s) => s.cards[cardId]) as Card | undefined;
  return (
    <img
      src={card?.image_url_small ?? imageSmall(cardId)}
      alt={card?.name ?? String(cardId)}
      loading="lazy"
      className={className ?? 'h-full w-full object-cover'}
    />
  );
}
