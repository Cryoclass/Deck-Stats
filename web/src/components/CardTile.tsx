import { useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { imageSmall, type Card } from '../types.js';
import { comboColor, comboVeil, type GroupAssignment } from '../lib/colors.js';
import { signedPct } from '../lib/fmt.js';
import { CardMenu } from './CardMenu.js';
import { CardDetailDialog } from './CardDetailDialog.js';
import type { AnnotationMode } from './annotationModes.js';

interface Props {
  cardId: number;
  column: 'first' | 'second';
  groups: GroupAssignment;
  delta?: { first: number; second: number };
  mode: AnnotationMode;
  activeCategoryId: string | null;
  comboPivot: number | null;
  linkedToPivot: boolean;
  onCardClick: (cardId: number) => void;
}

export function CardTile({
  cardId,
  column,
  groups,
  delta,
  mode,
  activeCategoryId,
  comboPivot,
  linkedToPivot,
  onCardClick,
}: Props) {
  const card = useDeck((s) => s.cards[cardId]) as Card | undefined;
  const copies = useDeck((s) => s.main.find((m) => m.cardId === cardId)?.copies ?? 1);
  const isStarter = useDeck((s) => s.starters.has(cardId));
  const isHopt = useDeck((s) => s.hopt.has(cardId));
  const deadFirst = useDeck((s) => s.deadFirst.has(cardId));
  const deadSecond = useDeck((s) => s.deadSecond.has(cardId));
  const inActiveCat = useDeck((s) =>
    activeCategoryId ? !!s.cardCategories.get(cardId)?.has(activeCategoryId) : false,
  );
  const setCopies = useDeck((s) => s.setCopies);

  const [detailOpen, setDetailOpen] = useState(false);

  const pivotColor = groups.colorOf.get(cardId);
  const pastilles = groups.pastillesOf.get(cardId) ?? [];

  const isPivot = mode === 'combo' && comboPivot === cardId;
  const pivotActive = mode === 'combo' && comboPivot !== null;
  const dimmed = pivotActive && !isPivot && !linkedToPivot;
  const highlightCat = mode === 'nonengine' && inActiveCat;

  const border = isPivot
    ? 'border-emerald-300 ring-2 ring-emerald-300'
    : pivotActive && linkedToPivot
      ? 'border-emerald-400/70 ring-1 ring-emerald-400/60'
      : highlightCat
        ? 'border-sky-400/70 ring-1 ring-sky-400/50'
        : 'border-ink-800';

  return (
    <div
      className={`group relative flex flex-col rounded-md border bg-ink-900 transition-opacity ${border} ${
        dimmed ? 'opacity-45' : 'opacity-100'
      }`}
    >
      <button
        onClick={() => onCardClick(cardId)}
        className={`relative block aspect-[59/86] w-full overflow-hidden rounded-t-md ${
          mode === 'select' ? 'cursor-default' : 'cursor-pointer'
        }`}
        title={card?.name ?? String(cardId)}
      >
        <img
          src={card?.image_url_small ?? imageSmall(cardId)}
          alt={card?.name ?? String(cardId)}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        {pivotColor !== undefined && (
          <span
            className="pointer-events-none absolute inset-0"
            style={{ background: comboVeil(pivotColor) }}
          />
        )}
        {/* Pastilles des groupes qui combottent avec cette carte (§4.2). */}
        <span className="pointer-events-none absolute right-1 top-1 flex flex-col gap-1">
          {pastilles.map((c) => (
            <span
              key={c}
              className="h-3 w-3 rounded-full ring-1 ring-black/50"
              style={{ background: comboColor(c) }}
            />
          ))}
        </span>
        {/* Badges rôle. */}
        <span className="pointer-events-none absolute left-1 top-1 flex flex-wrap gap-1">
          {isStarter && (
            <span className="rounded bg-emerald-500/90 px-1 text-[10px] font-bold text-black">S</span>
          )}
          {isHopt && (
            <span className="rounded bg-amber-500/90 px-1 text-[10px] font-bold text-black">H</span>
          )}
        </span>
        {(deadFirst || deadSecond) && (
          <span className="pointer-events-none absolute bottom-1 left-1 flex gap-1">
            {deadFirst && (
              <span className="rounded bg-black/70 px-1 text-[9px] font-medium text-red-300">†1st</span>
            )}
            {deadSecond && (
              <span className="rounded bg-black/70 px-1 text-[9px] font-medium text-red-300">†2nd</span>
            )}
          </span>
        )}
        {/* Feedback modes. */}
        {pivotActive && linkedToPivot && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-emerald-500/15 text-lg text-emerald-200">
            ✓
          </span>
        )}
        {highlightCat && (
          <span className="pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full bg-sky-400 ring-1 ring-black/50" />
        )}
      </button>

      {/* Footer : compteur de copies (A1) + menu ⋯ (rare ops). */}
      <div className="flex items-center justify-between gap-1 px-1 py-1">
        <div className="flex shrink-0 items-center rounded border border-ink-700 bg-ink-850">
          <button
            onClick={() => setCopies(cardId, copies - 1)}
            disabled={copies <= 1}
            className="px-1.5 py-0.5 text-xs text-ink-300 hover:text-ink-100 disabled:opacity-30"
            title="Moins de copies"
          >
            −
          </button>
          <span className="tnum w-3 text-center text-[11px] text-ink-100">{copies}</span>
          <button
            onClick={() => setCopies(cardId, copies + 1)}
            disabled={copies >= 3}
            className="px-1.5 py-0.5 text-xs text-ink-300 hover:text-ink-100 disabled:opacity-30"
            title="Plus de copies"
          >
            +
          </button>
        </div>
        <CardMenu cardId={cardId} onOpenDetail={() => setDetailOpen(true)} />
      </div>

      {/* Delta permanent : contribution marginale (§3.2). */}
      <div className="h-4 px-1 pb-1 text-center text-[10px] tnum leading-none text-ink-500">
        {delta && Math.abs(column === 'first' ? delta.first : delta.second) > 1e-9
          ? `−1 : ${signedPct(-(column === 'first' ? delta.first : delta.second))}`
          : ' '}
      </div>

      {detailOpen && <CardDetailDialog cardId={cardId} onClose={() => setDetailOpen(false)} />}
    </div>
  );
}
