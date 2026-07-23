import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useDeck } from '../store/deckStore.js';

/**
 * Menu ⋯ par carte (A2 + Lot B/C) — rendu dans un portal avec détection de
 * collision (Radix : avoidCollisions + collisionPadding), donc jamais hors
 * viewport, y compris première/dernière colonne et dernière ligne. Ne contient
 * que les opérations RARES et unitaires ; tout le fréquent passe par les modes.
 */
export function CardMenu({
  cardId,
  onOpenDetail,
}: {
  cardId: number;
  onOpenDetail: () => void;
}) {
  const cards = useDeck((s) => s.cards);
  const pairs = useDeck((s) => s.pairs);
  const deadFirst = useDeck((s) => s.deadFirst.has(cardId));
  const deadSecond = useDeck((s) => s.deadSecond.has(cardId));
  const removeCard = useDeck((s) => s.removeCard);
  const removePair = useDeck((s) => s.removePairFromLibrary);
  const toggleDeadFirst = useDeck((s) => s.toggleDeadFirst);
  const toggleDeadSecond = useDeck((s) => s.toggleDeadSecond);

  const name = (id: number) => cards[id]?.name ?? `#${id}`;
  const combos = pairs.filter((p) => p.card_a_id === cardId || p.card_b_id === cardId);
  const other = (id: number, p: { card_a_id: number; card_b_id: number }) =>
    p.card_a_id === id ? p.card_b_id : p.card_a_id;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="rounded px-1.5 py-0.5 leading-none text-ink-400 hover:bg-ink-800 hover:text-ink-100"
          title="Plus d'actions"
          onClick={(e) => e.stopPropagation()}
        >
          ⋯
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="start"
          sideOffset={4}
          avoidCollisions
          collisionPadding={8}
          className="z-[55] min-w-[200px] rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-2xl shadow-black/50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="truncate px-2 py-1 text-[11px] font-medium text-ink-200">
            {name(cardId)}
          </div>

          <Item onSelect={onOpenDetail}>Détails de la carte</Item>
          <Item onSelect={() => removeCard(cardId)} danger>
            Retirer du deck
          </Item>

          <DropdownMenu.Separator className="my-1 h-px bg-ink-700" />
          <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-500">
            Morte selon la position
          </div>
          <Check checked={deadFirst} onToggle={() => toggleDeadFirst(cardId)}>
            Morte going first
          </Check>
          <Check checked={deadSecond} onToggle={() => toggleDeadSecond(cardId)}>
            Morte going second
          </Check>

          <DropdownMenu.Separator className="my-1 h-px bg-ink-700" />
          <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-500">
            Combos en bibliothèque
          </div>
          {combos.length === 0 && (
            <div className="px-2 py-1 text-[11px] text-ink-600">aucun</div>
          )}
          {combos.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-ink-300"
            >
              <span className="truncate">+ {name(other(cardId, p))}</span>
              <button
                onClick={() => removePair(p.id)}
                title="Supprimer définitivement de la bibliothèque"
                className="shrink-0 rounded px-1 text-ink-600 hover:bg-red-500/10 hover:text-red-400"
              >
                supprimer
              </button>
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Item({
  children,
  onSelect,
  danger,
}: {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={`cursor-pointer rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-ink-700 ${
        danger ? 'text-red-300' : 'text-ink-200'
      }`}
    >
      {children}
    </DropdownMenu.Item>
  );
}

function Check({
  children,
  checked,
  onToggle,
}: {
  children: ReactNode;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onToggle}
      onSelect={(e) => e.preventDefault()}
      className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-xs text-ink-200 outline-none data-[highlighted]:bg-ink-700"
    >
      {children}
      <span
        className={`h-3.5 w-3.5 shrink-0 rounded-sm border ${checked ? 'border-amber-400 bg-amber-400' : 'border-ink-500'}`}
      />
    </DropdownMenu.CheckboxItem>
  );
}
