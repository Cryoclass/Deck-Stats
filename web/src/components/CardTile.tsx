import { useDeck } from '../store/deckStore.js';
import { imageSmall, type Card } from '../types.js';
import { comboColor, comboVeil, type GroupAssignment } from '../lib/colors.js';
import { signedPct } from '../lib/fmt.js';
import { Popover, Segmented, Toggle } from './ui.js';

interface Props {
  cardId: number;
  column: 'first' | 'second';
  linkFrom: number | null;
  onStartLink: (id: number) => void;
  onPickLink: (id: number) => void;
  groups: GroupAssignment;
  delta?: { first: number; second: number };
}

export function CardTile({
  cardId,
  column,
  linkFrom,
  onStartLink,
  onPickLink,
  groups,
  delta,
}: Props) {
  const card = useDeck((s) => s.cards[cardId]) as Card | undefined;
  const copies = useDeck((s) => s.main.find((m) => m.cardId === cardId)?.copies ?? 1);
  const isStarter = useDeck((s) => s.starters.has(cardId));
  const isHopt = useDeck((s) => s.hopt.has(cardId));
  const categories = useDeck((s) => s.categories);
  const myCats = useDeck((s) => s.cardCategories.get(cardId));
  const setCopies = useDeck((s) => s.setCopies);
  const toggleStarter = useDeck((s) => s.toggleStarter);
  const toggleHopt = useDeck((s) => s.toggleHopt);
  const toggleCardCategory = useDeck((s) => s.toggleCardCategory);

  const pivotColor = groups.colorOf.get(cardId);
  const pastilles = groups.pastillesOf.get(cardId) ?? [];
  const isLinkSource = linkFrom === cardId;
  const isLinkTarget = linkFrom !== null && linkFrom !== cardId;
  const d = column === 'first' ? delta?.first : delta?.second;

  return (
    <div
      className={`group relative flex flex-col rounded-md border bg-ink-900 ${
        isLinkSource
          ? 'border-emerald-400 ring-1 ring-emerald-400'
          : isLinkTarget
            ? 'border-ink-600 hover:border-emerald-400/70'
            : 'border-ink-800'
      }`}
    >
      <button
        onClick={() => (isLinkTarget ? onPickLink(cardId) : isLinkSource ? onPickLink(cardId) : undefined)}
        className="relative block aspect-[59/86] w-full overflow-hidden rounded-t-md"
        title={card?.name ?? String(cardId)}
      >
        <img
          src={card?.image_url_small ?? imageSmall(cardId)}
          alt={card?.name ?? String(cardId)}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        {/* Voile teinté sur la carte pivot (§4.2). */}
        {pivotColor !== undefined && (
          <span
            className="pointer-events-none absolute inset-0"
            style={{ background: comboVeil(pivotColor) }}
          />
        )}
        {/* Pastilles des groupes qui combottent avec cette carte. */}
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
        <span className="pointer-events-none absolute left-1 top-1 flex gap-1">
          {isStarter && (
            <span className="rounded bg-emerald-500/90 px-1 text-[10px] font-bold text-black">S</span>
          )}
          {isHopt && (
            <span className="rounded bg-amber-500/90 px-1 text-[10px] font-bold text-black">H</span>
          )}
        </span>
        {isLinkTarget && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[11px] font-medium text-emerald-300 opacity-0 group-hover:opacity-100">
            lier ici
          </span>
        )}
      </button>

      {/* Footer : copies + delta + menu. */}
      <div className="flex items-center justify-between gap-1 px-1 py-1">
        <Segmented
          size="sm"
          value={copies}
          onChange={(v) => setCopies(cardId, v)}
          options={[
            { value: 1, label: '1' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
          ]}
        />
        <Popover
          trigger={(_open, toggle) => (
            <button
              onClick={toggle}
              className="rounded px-1.5 py-0.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
              title="Annoter"
            >
              ⋯
            </button>
          )}
        >
          {(close) => (
            <div className="flex flex-col">
              <Toggle checked={isStarter} onChange={() => toggleStarter(cardId)} label="Starter 1-carte" />
              <Toggle checked={isHopt} onChange={() => toggleHopt(cardId)} label="HOPT" />
              <button
                onClick={() => {
                  onStartLink(cardId);
                  close();
                }}
                className="rounded-md px-2 py-1.5 text-left text-xs text-emerald-300 hover:bg-ink-800"
              >
                Lier un combo…
              </button>
              {categories.length > 0 && (
                <>
                  <div className="mt-1 px-2 pt-1 text-[10px] uppercase tracking-wide text-ink-500">
                    Non-engine
                  </div>
                  {categories.map((cat) => (
                    <Toggle
                      key={cat.id}
                      checked={!!myCats?.has(cat.id)}
                      onChange={() => toggleCardCategory(cardId, cat.id)}
                      label={cat.name}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </Popover>
      </div>

      {/* Delta permanent : contribution marginale (§3.2). */}
      <div className="h-4 px-1 pb-1 text-center text-[10px] tnum leading-none text-ink-500">
        {d !== undefined && Math.abs(d) > 1e-9 ? `−1 copie : ${signedPct(-d)}` : ' '}
      </div>
    </div>
  );
}
