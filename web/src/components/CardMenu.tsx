import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useDeck } from '../store/deckStore.js';
import { AVAILABILITY_HINT, AVAILABILITY_LABEL, type Zone } from '../types.js';
import { ZONE_LABEL } from '../lib/zones.js';
import { AVAILABILITY_PROFILES } from '../../../server/src/domain/deckConfiguration.js';

/**
 * Menu ⋯ par carte (A2 + Lot B/C) — rendu dans un portal avec détection de
 * collision (Radix : avoidCollisions + collisionPadding), donc jamais hors
 * viewport, y compris première/dernière colonne et dernière ligne. Ne contient
 * que les opérations RARES et unitaires ; tout le fréquent passe par les modes.
 * Étape 5B : profil de disponibilité et plafond partagé (annotations du compte).
 */
export function CardMenu({
  cardId,
  zone = 'main',
  onOpenDetail,
}: {
  cardId: number;
  /** Étape 10C : une tuile du side retire du side, jamais du main. */
  zone?: Zone;
  onOpenDetail: () => void;
}) {
  const cards = useDeck((s) => s.cards);
  const pairs = useDeck((s) => s.pairs);
  const deadFirst = useDeck((s) => s.deadFirst.has(cardId));
  const deadSecond = useDeck((s) => s.deadSecond.has(cardId));
  const profile = useDeck((s) => s.profiles.get(cardId));
  const groups = useDeck((s) => s.groups);
  const removeCard = useDeck((s) => s.removeCard);
  const removePair = useDeck((s) => s.removePairFromDeck);
  const toggleDeadFirst = useDeck((s) => s.toggleDeadFirst);
  const toggleDeadSecond = useDeck((s) => s.toggleDeadSecond);
  const setProfile = useDeck((s) => s.setProfile);
  const setCardGroup = useDeck((s) => s.setCardGroup);
  const origin = useDeck((s) => s.origin.get(cardId));
  const resetAnnotation = useDeck((s) => s.resetAnnotation);

  const name = (id: number) => cards[id]?.name ?? `#${id}`;
  const combos = pairs.filter((p) => p.card_a_id === cardId || p.card_b_id === cardId);
  const other = (id: number, p: { card_a_id: number; card_b_id: number }) =>
    p.card_a_id === id ? p.card_b_id : p.card_a_id;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded leading-none text-fg-3 hover:bg-ink-800 hover:text-fg-1"
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
          className="z-[55] min-w-[220px] rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-2xl shadow-black/50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="truncate px-2 py-1 text-meta font-medium text-fg-2">
            {name(cardId)}
          </div>

          <Item onSelect={onOpenDetail}>Détails de la carte</Item>
          <Item onSelect={() => removeCard(cardId, zone)} danger>
            {zone === 'main' ? 'Retirer du deck' : `Retirer du ${ZONE_LABEL[zone]}`}
          </Item>

          <DropdownMenu.Separator className="my-1 h-px bg-ink-700" />
          <div className="px-2 py-0.5 text-meta uppercase tracking-wide text-fg-3">
            Morte selon la position
          </div>
          <Check checked={deadFirst} onToggle={() => toggleDeadFirst(cardId)}>
            Morte en premier
          </Check>
          <Check checked={deadSecond} onToggle={() => toggleDeadSecond(cardId)}>
            Morte en second
          </Check>

          {/* Profil non-engine (contrat §3) : commun aux decks du compte. Depuis le 16 septembre
              2026 (D14′), le profil seul fait compter la carte : proposé à toute carte. */}
          <DropdownMenu.Separator className="my-1 h-px bg-ink-700" />
          <div className="px-2 py-0.5 text-meta uppercase tracking-wide text-fg-3">
            Profil non-engine (compte)
          </div>
          {AVAILABILITY_PROFILES.map((p) => (
                <Radio
                  key={p}
                  checked={profile?.availability === p}
                  title={AVAILABILITY_HINT[p]}
                  onSelect={() => setProfile(cardId, p)}
                >
                  {AVAILABILITY_LABEL[p]}
                </Radio>
              ))}
          <Radio checked={!profile} onSelect={() => setProfile(cardId, null)}>
            <span className="text-fg-3">Aucun (non comptée)</span>
          </Radio>

          {/* Annotations par défaut (D9) : oublier un choix du compte, par aspect. */}
          {(origin?.hopt === 'choice' || origin?.nonengine === 'choice') && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-ink-700" />
              <div className="px-2 py-0.5 text-meta uppercase tracking-wide text-fg-3">
                Revenir au défaut
              </div>
              {origin?.hopt === 'choice' && (
                <Item onSelect={() => resetAnnotation(cardId, 'hopt')}>HOPT : oublier mon choix</Item>
              )}
              {origin?.nonengine === 'choice' && (
                <Item onSelect={() => resetAnnotation(cardId, 'nonengine')}>Profil et plafond : oublier mon choix</Item>
              )}
            </>
          )}

          {/* Plafond partagé (Q2) : proposé seulement à une carte profilée. */}
          {profile && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-ink-700" />
              <div className="px-2 py-0.5 text-meta uppercase tracking-wide text-fg-3">
                Plafond partagé par tour
              </div>
              {groups.length === 0 && (
                <div className="px-2 py-1 text-meta text-fg-3">
                  aucun plafond défini (onglet Combos &amp; catégories)
                </div>
              )}
              {groups.map((g) => (
                <Radio
                  key={g.id}
                  checked={profile.groupId === g.id}
                  onSelect={() => setCardGroup(cardId, profile.groupId === g.id ? null : g.id)}
                >
                  {g.name} <span className="tnum text-fg-3">· {g.cap_per_turn}/tour</span>
                </Radio>
              ))}
            </>
          )}

          <DropdownMenu.Separator className="my-1 h-px bg-ink-700" />
          <div className="px-2 py-0.5 text-meta uppercase tracking-wide text-fg-3">
            Combos de ce deck
          </div>
          {combos.length === 0 && (
            <div className="px-2 py-1 text-meta text-fg-3">aucun</div>
          )}
          {combos.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 px-2 py-1 text-meta text-fg-3"
            >
              <span className="truncate">+ {name(other(cardId, p))}</span>
              <button
                onClick={() => removePair(p.id)}
                title="Supprimer du deck à la prochaine sauvegarde"
                className="shrink-0 rounded px-1 text-fg-3 hover:bg-red-500/10 hover:text-neg"
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
      className={`cursor-pointer rounded px-2 py-1.5 text-body outline-none data-[highlighted]:bg-ink-700 ${
        danger ? 'text-neg' : 'text-fg-2'
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
      className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-body text-fg-2 outline-none data-[highlighted]:bg-ink-700"
    >
      {children}
      <span
        className={`h-3.5 w-3.5 shrink-0 rounded-sm border ${checked ? 'border-amber-400 bg-amber-400' : 'border-ink-500'}`}
      />
    </DropdownMenu.CheckboxItem>
  );
}

function Radio({
  children,
  checked,
  title,
  onSelect,
}: {
  children: ReactNode;
  checked: boolean;
  title?: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      title={title}
      className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-body text-fg-2 outline-none data-[highlighted]:bg-ink-700"
    >
      <span>{children}</span>
      <span
        className={`h-3.5 w-3.5 shrink-0 rounded-full border ${checked ? 'border-sky-400 bg-sky-400' : 'border-ink-500'}`}
      />
    </DropdownMenu.Item>
  );
}
