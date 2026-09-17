import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useDeck } from '../store/deckStore.js';
import { AVAILABILITY_HINT, AVAILABILITY_LABEL, type Availability } from '../types.js';
import { AVAILABILITY_PROFILES } from '../../../server/src/domain/deckConfiguration.js';
import { MODE_KEY, MODE_LABEL, type AnnotationMode } from './annotationModes.js';

export interface ModeOption {
  /** Mode Non-engine (partie D) : étiquette facultative posée avec le profil ; `null` = aucune. */
  categoryId?: string | null;
  /** Mode Non-engine : profil posé ; `null` = étiquette seule (le profil n'est pas touché). */
  nonEngineProfile?: Availability | null;
}

interface Props {
  mode: AnnotationMode;
  activeCategoryId: string | null;
  nonEngineProfile: Availability | null;
  onEnter: (mode: AnnotationMode, option?: ModeOption) => void;
}

const ITEM = 'flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-body text-fg-2 outline-none data-[highlighted]:bg-ink-700';
const SECTION = 'px-2 py-1 text-meta uppercase tracking-wide text-fg-3';

export function ModeBar({ mode, activeCategoryId, nonEngineProfile, onEnter }: Props) {
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

      {/* Non-engine (partie D des annotations par défaut, D14′) : le PROFIL fait compter la carte,
          l'étiquette est un axe facultatif. Le déroulant choisit le profil (ou « étiquette seule ») puis
          l'étiquette (ou « aucune ») ; profils et étiquettes sont des éléments radio distincts (un
          profil et une étiquette peuvent porter le même nom, « Board breaker »). */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            data-mode-trigger="nonengine"
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-body font-medium transition-colors ${
              mode === 'nonengine'
                ? 'bg-sky-500/20 text-info ring-1 ring-sky-500/40'
                : 'text-fg-3 hover:bg-ink-800 hover:text-fg-1'
            }`}
            title="Non-engine : pose le profil choisi (et l'étiquette, si choisie). Sur une carte au profil hérité identique, le clic l'adopte comme votre choix ; sur votre choix, il le retire."
          >
            {MODE_LABEL.nonengine}
            {mode === 'nonengine' && (
              <span className="rounded bg-sky-500/30 px-1 text-meta text-sky-100">
                {[nonEngineProfile ? AVAILABILITY_LABEL[nonEngineProfile] : null, activeCat?.name ?? null].filter(Boolean).join(' + ') || '—'}
              </span>
            )}
            <span className="text-fg-3">▾</span>
            <Kbd>{MODE_KEY.nonengine}</Kbd>
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
            <div className={SECTION}>Profil</div>
            <DropdownMenu.RadioGroup
              value={nonEngineProfile ?? 'none'}
              onValueChange={(v) => onEnter('nonengine', { nonEngineProfile: v === 'none' ? null : (v as Availability) })}
            >
              {AVAILABILITY_PROFILES.map((profile) => (
                <DropdownMenu.RadioItem key={profile} value={profile} data-ne-profile={profile} title={AVAILABILITY_HINT[profile]} className={ITEM}>
                  {AVAILABILITY_LABEL[profile]}
                  <DropdownMenu.ItemIndicator className="text-info">✓</DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
              <DropdownMenu.RadioItem value="none" data-ne-profile="none" className={`${ITEM} text-fg-3`}>
                Étiquette seule (profil inchangé)
                <DropdownMenu.ItemIndicator className="text-info">✓</DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="my-1 h-px bg-ink-700" />
            <div className={SECTION}>Étiquette (facultative)</div>
            <DropdownMenu.RadioGroup
              value={activeCategoryId ?? 'none'}
              onValueChange={(v) => onEnter('nonengine', { categoryId: v === 'none' ? null : v })}
            >
              <DropdownMenu.RadioItem value="none" data-ne-label="none" className={`${ITEM} text-fg-3`}>
                Aucune
                <DropdownMenu.ItemIndicator className="text-info">✓</DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
              {categories.map((cat) => (
                <DropdownMenu.RadioItem key={cat.id} value={cat.id} data-ne-label={cat.name} className={ITEM}>
                  {cat.name}
                  <DropdownMenu.ItemIndicator className="text-info">✓</DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Conditions de start — accent ambre pour se distinguer des combos (émeraude). */}
      <button
        onClick={() => onEnter('prereq')}
        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-body font-medium transition-colors ${
          mode === 'prereq'
            ? 'bg-amber-500/20 text-warn ring-1 ring-amber-500/40'
            : 'text-fg-3 hover:bg-ink-800 hover:text-fg-1'
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
      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-body font-medium transition-colors ${
        active
          ? accent
            ? 'bg-emerald-500/20 text-pos ring-1 ring-emerald-500/40'
            : 'bg-ink-700 text-fg-1'
          : 'text-fg-3 hover:bg-ink-800 hover:text-fg-1'
      }`}
    >
      {label}
      {hint && <Kbd>{hint}</Kbd>}
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="hidden rounded border border-ink-700 bg-ink-950 px-1 text-meta leading-4 text-fg-3 sm:inline">
      {children}
    </kbd>
  );
}
