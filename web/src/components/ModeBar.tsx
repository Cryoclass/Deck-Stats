import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useDeck } from '../store/deckStore.js';
import { AVAILABILITY_HINT, AVAILABILITY_LABEL, type Availability } from '../types.js';
import { AVAILABILITY_PROFILES } from '../../../server/src/domain/deckConfiguration.js';
import { MODE_KEY, MODE_LABEL, type AnnotationMode } from './annotationModes.js';

interface Props {
  mode: AnnotationMode;
  activeCategoryId: string | null;
  /** Profil appliqué par le mode Profil ; `null` = retirer le profil. */
  activeProfile: Availability | null;
  onEnter: (mode: AnnotationMode, option?: { categoryId?: string; profile?: Availability | null }) => void;
}

export function ModeBar({ mode, activeCategoryId, activeProfile, onEnter }: Props) {
  const categories = useDeck((s) => s.categories);
  const activeCat = categories.find((c) => c.id === activeCategoryId);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-ink-800 bg-ink-900 px-2 py-1.5">
      <ModeButton
        label={MODE_LABEL.select}
        active={mode === 'select'}
        onClick={() => onEnter('select')}
      />
      <div className="mx-1 h-5 w-px bg-ink-800" />
      <ModeButton
        label={MODE_LABEL.combo}
        hint={MODE_KEY.combo}
        active={mode === 'combo'}
        accent
        onClick={() => onEnter('combo')}
      />
      <ModeButton
        label={MODE_LABEL.hopt}
        hint={MODE_KEY.hopt}
        active={mode === 'hopt'}
        onClick={() => onEnter('hopt')}
      />
      <ModeButton
        label={MODE_LABEL.starter}
        hint={MODE_KEY.starter}
        active={mode === 'starter'}
        onClick={() => onEnter('starter')}
      />

      {/* Non-engine : la catégorie (étiquette) se choisit dans le déroulant du bouton. */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === 'nonengine'
                ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40'
                : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
            }`}
          >
            {MODE_LABEL.nonengine}
            {mode === 'nonengine' && activeCat && (
              <span className="rounded bg-sky-500/30 px-1 text-[10px] text-sky-100">
                {activeCat.name}
              </span>
            )}
            <span className="text-ink-500">▾</span>
            <Kbd>{MODE_KEY.nonengine}</Kbd>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 min-w-[180px] rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-2xl shadow-black/50"
          >
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-500">
              Étiquette à poser
            </div>
            {categories.map((cat) => (
              <DropdownMenu.Item
                key={cat.id}
                onSelect={() => onEnter('nonengine', { categoryId: cat.id })}
                className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-xs text-ink-200 outline-none data-[highlighted]:bg-ink-700"
              >
                {cat.name}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Profil de disponibilité (étape 5B, contrat §3) : fenêtres d'une carte étiquetée. */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === 'profile'
                ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40'
                : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
            }`}
            title="Profil de disponibilité non-engine : détermine les fenêtres retenues (premier / second / sixième carte)."
          >
            {MODE_LABEL.profile}
            {mode === 'profile' && (
              <span className="rounded bg-sky-500/30 px-1 text-[10px] text-sky-100">
                {activeProfile ? AVAILABILITY_LABEL[activeProfile] : 'retirer'}
              </span>
            )}
            <span className="text-ink-500">▾</span>
            <Kbd>{MODE_KEY.profile}</Kbd>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 min-w-[220px] rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-2xl shadow-black/50"
          >
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-500">
              Profil à poser (cartes étiquetées)
            </div>
            {AVAILABILITY_PROFILES.map((profile) => (
              <DropdownMenu.Item
                key={profile}
                onSelect={() => onEnter('profile', { profile })}
                title={AVAILABILITY_HINT[profile]}
                className="cursor-pointer rounded px-2 py-1.5 text-xs text-ink-200 outline-none data-[highlighted]:bg-ink-700"
              >
                {AVAILABILITY_LABEL[profile]}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="my-1 h-px bg-ink-700" />
            <DropdownMenu.Item
              onSelect={() => onEnter('profile', { profile: null })}
              className="cursor-pointer rounded px-2 py-1.5 text-xs text-ink-400 outline-none data-[highlighted]:bg-ink-700"
            >
              Retirer le profil
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Conditions de start — accent ambre pour se distinguer des combos (émeraude). */}
      <button
        onClick={() => onEnter('prereq')}
        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          mode === 'prereq'
            ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
            : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
        }`}
        title="Condition de start : la source exige qu'il reste des copies d'une carte en deck après le tirage (ET/OU dans l'inventaire et les combos)."
      >
        {MODE_LABEL.prereq}
        <Kbd>{MODE_KEY.prereq}</Kbd>
      </button>
    </div>
  );
}

function ModeButton({
  label,
  hint,
  active,
  accent,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? accent
            ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40'
            : 'bg-ink-700 text-ink-100'
          : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
      }`}
    >
      {label}
      {hint && <Kbd>{hint}</Kbd>}
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-ink-700 bg-ink-950 px-1 text-[9px] leading-4 text-ink-500">
      {children}
    </kbd>
  );
}
