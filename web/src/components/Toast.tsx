import { useEffect } from 'react';
import { useDeck } from '../store/deckStore.js';

/**
 * Toast d'annulation d'un retrait de carte (itération 3, B). « Annuler » restaure la
 * carte à sa position — et, comme aucune annotation n'est effacée au retrait (C1),
 * l'annulation ne coûte jamais de travail d'annotation. Auto-dismiss après 6 s.
 */
export function Toast() {
  const toast = useDeck((s) => s.removalToast);
  const undoRemove = useDeck((s) => s.undoRemove);
  const dismiss = useDeck((s) => s.dismissRemovalToast);
  const name = useDeck((s) =>
    s.removalToast ? s.cards[s.removalToast.card.cardId]?.name ?? `#${s.removalToast.card.cardId}` : '',
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, 6000);
    return () => clearTimeout(t);
  }, [toast, dismiss]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-ink-100 shadow-2xl shadow-black/60">
      <span>
        <span className="text-ink-400">Retirée :</span> {name}
      </span>
      <button
        onClick={undoRemove}
        className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-black hover:bg-emerald-500"
      >
        Annuler
      </button>
      <button onClick={dismiss} className="text-ink-500 hover:text-ink-200" title="Fermer">
        ✕
      </button>
    </div>
  );
}
