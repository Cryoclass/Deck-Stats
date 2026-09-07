import { useEffect, useRef, useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { AVAILABILITY_LABEL, AVAILABILITY_SHORT, type Card } from '../types.js';
import { comboColor, comboVeil, type GroupAssignment } from '../lib/colors.js';
import { signedPct } from '../lib/fmt.js';
import { CardImage } from './CardImage.js';
import { CardMenu } from './CardMenu.js';
import { CardDetailDialog } from './CardDetailDialog.js';
import type { AnnotationMode } from './annotationModes.js';

interface Props {
  cardId: number;
  groups: GroupAssignment;
  delta?: { first: number; second: number };
  mode: AnnotationMode;
  activeCategoryId: string | null;
  comboPivot: number | null;
  linkedToPivot: boolean;
  onCardClick: (cardId: number) => void;
  /** Mis en évidence après un saut depuis l'Inventaire : ring + scroll-into-view. */
  highlighted?: boolean;
  // Conditions de start (itération 5, étape 5B).
  showPrereqMarker?: boolean; // carte dépendante (a une condition) → marqueur permanent
  prereqHighlight?: 'source' | 'required' | null; // relation dirigée dépendante → requise
  prereqDim?: boolean;
  onHoverChange?: (hovered: boolean) => void;
}

export function CardTile({
  cardId,
  groups,
  delta,
  mode,
  activeCategoryId,
  comboPivot,
  linkedToPivot,
  onCardClick,
  highlighted = false,
  showPrereqMarker = false,
  prereqHighlight = null,
  prereqDim = false,
  onHoverChange,
}: Props) {
  const card = useDeck((s) => s.cards[cardId]) as Card | undefined;
  const copies = useDeck((s) => s.main.find((m) => m.cardId === cardId)?.copies ?? 1);
  const isStarter = useDeck((s) => s.starters.has(cardId));
  const isHopt = useDeck((s) => s.hopt.has(cardId));
  const deadFirst = useDeck((s) => s.deadFirst.has(cardId));
  const deadSecond = useDeck((s) => s.deadSecond.has(cardId));
  const labelled = useDeck((s) => (s.cardCategories.get(cardId)?.size ?? 0) > 0);
  const profile = useDeck((s) => s.profiles.get(cardId));
  const groupName = useDeck((s) => s.groups.find((g) => g.id === profile?.groupId)?.name);
  const context = useDeck((s) => s.context);
  // Q3 (étape 6B, contrat §6) : le delta est une statistique du dernier résultat ; périmé,
  // il reste visible mais atténué comme le panneau — les contrôles de la tuile, eux, restent vifs.
  const stale = useDeck((s) => s.stale);
  const inActiveCat = useDeck((s) =>
    activeCategoryId ? !!s.cardCategories.get(cardId)?.has(activeCategoryId) : false,
  );
  const setCopies = useDeck((s) => s.setCopies);

  const [detailOpen, setDetailOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Saut depuis l'Inventaire : amener la carte visée au centre du viewport.
  useEffect(() => {
    if (!highlighted) return;
    const id = requestAnimationFrame(() =>
      rootRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
    return () => cancelAnimationFrame(id);
  }, [highlighted]);

  const pivotColor = groups.colorOf.get(cardId);
  const pastilles = groups.pastillesOf.get(cardId) ?? [];

  const isPivot = mode === 'combo' && comboPivot === cardId;
  const pivotActive = mode === 'combo' && comboPivot !== null;
  const dimmed = (pivotActive && !isPivot && !linkedToPivot) || prereqDim;
  const highlightCat = mode === 'nonengine' && inActiveCat;
  // Q5 : étiquetée sans profil → non comptée dans le potentiel, signalée en ambre.
  const unprofiled = labelled && !profile;
  const contextDelta = delta ? (context === 'first' ? delta.first : delta.second) : 0;

  // Marqueur condition en contour POINTILLÉ (jamais une pastille pleine de combo, §D).
  const border = isPivot
    ? 'border-emerald-300 ring-2 ring-emerald-300'
    : pivotActive && linkedToPivot
      ? 'border-emerald-400/70 ring-1 ring-emerald-400/60'
      : prereqHighlight === 'source'
        ? 'border-amber-300 ring-2 ring-amber-300'
        : prereqHighlight === 'required'
          ? 'border-dashed border-amber-400 ring-1 ring-amber-400/60'
          : highlightCat
            ? 'border-sky-400/70 ring-1 ring-sky-400/50'
            : mode === 'profile' && labelled
              ? 'border-sky-400/40'
              : 'border-ink-800';

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={`group relative flex flex-col rounded-md border bg-ink-900 transition-opacity ${border} ${
        dimmed ? 'opacity-45' : 'opacity-100'
      } ${highlighted ? 'outline outline-2 outline-offset-1 outline-amber-300' : ''}`}
    >
      <button
        onClick={() => onCardClick(cardId)}
        className={`relative block aspect-[59/86] w-full overflow-hidden rounded-t-md ${
          mode === 'select' ? 'cursor-default' : 'cursor-pointer'
        }`}
        title={card?.name ?? String(cardId)}
      >
        <CardImage cardId={cardId} />
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
          {profile && (
            <span
              className="rounded bg-sky-500/90 px-1 text-[10px] font-bold text-black"
              title={`Profil ${AVAILABILITY_LABEL[profile.availability]}${groupName ? ` · plafond « ${groupName} »` : ''}`}
            >
              {AVAILABILITY_SHORT[profile.availability]}
              {groupName ? '·' : ''}
            </span>
          )}
          {unprofiled && (
            <span
              className="rounded bg-amber-400/90 px-1 text-[10px] font-bold text-black"
              title="Étiquetée non-engine sans profil de disponibilité : non comptée dans le potentiel (copies brutes seulement)."
            >
              ?
            </span>
          )}
        </span>
        {(deadFirst || deadSecond) && (
          <span className="pointer-events-none absolute bottom-1 left-1 flex gap-1">
            {deadFirst && (
              <span className="rounded bg-black/70 px-1 text-[9px] font-medium text-red-300">†1er</span>
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
        {/* Marqueur condition permanent — contour pointillé + icône « deck », coin
            distinct des pastilles de combo (§D). */}
        {showPrereqMarker && (
          <span
            className="pointer-events-none absolute bottom-1 right-1 flex h-4 items-center rounded border border-dashed border-amber-400 bg-black/60 px-1 text-[9px] font-bold text-amber-300"
            title="Son start dépend de cartes restant en deck (condition ET/OU)"
          >
            ▤
          </span>
        )}
        {/* Rebond au survol de la dépendante : relation dirigée → la requise. */}
        {prereqHighlight === 'required' && (
          <span className="pointer-events-none absolute inset-x-0 top-0 bg-amber-500/25 text-center text-[9px] font-medium text-amber-100">
            ↑ requise en deck
          </span>
        )}
      </button>

      {/* Footer (étape 6B, cibles tactiles 32 px) : le stepper de copies (A1) occupe sa
          propre ligne ; le menu ⋯ (rare ops) partage la ligne du delta, insécable. La
          grille garantit 96 px par tuile (AnnotationGrid) pour que les deux tiennent. */}
      <div className="flex items-center justify-center pt-1">
        <div className="flex shrink-0 items-center rounded border border-ink-700 bg-ink-850">
          <button
            onClick={() => setCopies(cardId, copies - 1)}
            className="flex h-8 w-8 items-center justify-center text-sm text-ink-300 hover:text-ink-100"
            title={copies <= 1 ? 'Retirer du deck (0 copie)' : 'Moins de copies'}
          >
            −
          </button>
          <span className="tnum w-3 text-center text-[11px] text-ink-100">{copies}</span>
          <button
            onClick={() => setCopies(cardId, copies + 1)}
            disabled={copies >= 3}
            className="flex h-8 w-8 items-center justify-center text-sm text-ink-300 hover:text-ink-100 disabled:opacity-30"
            title="Plus de copies"
          >
            +
          </button>
        </div>
      </div>

      {/* Delta permanent : contribution marginale (§3.2) du contexte d'analyse courant. */}
      <div className="flex items-center gap-0.5 pb-0.5 pl-0.5">
        <div
          className={`tnum min-w-0 flex-1 whitespace-nowrap text-center text-[10px] leading-none text-ink-500 transition-opacity ${
            stale ? 'opacity-45' : ''
          }`}
          title={`Δ P(≥1 départ théorique) si l'on retire une copie — contexte ${context === 'first' ? 'premier' : 'second'}${
            stale ? ' — version précédente, recalcul en cours' : ''
          }`}
        >
          {delta && Math.abs(contextDelta) > 1e-9 ? `−1 : ${signedPct(-contextDelta)}` : ' '}
        </div>
        <CardMenu cardId={cardId} onOpenDetail={() => setDetailOpen(true)} />
      </div>

      {detailOpen && <CardDetailDialog cardId={cardId} onClose={() => setDetailOpen(false)} />}
    </div>
  );
}
