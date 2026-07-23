import { useState, type ReactNode } from 'react';

/** Barre horizontale animée (temps réel visible, §E). */
export function Bar({ value, color = '#6b7488' }: { value: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-sm bg-ink-800">
      <div
        className="h-full origin-left rounded-sm transition-[width] duration-300 ease-out"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }}
      />
    </div>
  );
}

/** Sélecteur segmenté compact (copies 1/2/3, colonnes…). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-ink-700 bg-ink-850">
      {options.map((o) => (
        <button
          key={String(o.value)}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'} tnum transition-colors ${
            value === o.value
              ? 'bg-ink-600 text-ink-100'
              : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Petit popover contrôlé (menu par carte), fermeture au clic extérieur. */
export function Popover({
  trigger,
  children,
  align = 'right',
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      {trigger(open, () => setOpen((v) => !v))}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-50 mt-1 ${align === 'right' ? 'right-0' : 'left-0'} min-w-[190px] rounded-lg border border-ink-700 bg-ink-850 p-1.5 shadow-2xl shadow-black/50`}
          >
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs text-ink-200 hover:bg-ink-800"
    >
      <span>{label}</span>
      <span
        className={`h-3.5 w-3.5 shrink-0 rounded-sm border ${checked ? 'border-emerald-400 bg-emerald-400' : 'border-ink-500'}`}
      />
    </button>
  );
}

export function StatLine({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] uppercase tracking-wide text-ink-400">{label}</span>
      <span className="tnum text-ink-100">{children}</span>
    </div>
  );
}
