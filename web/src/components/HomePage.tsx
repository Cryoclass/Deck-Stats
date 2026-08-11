import { useCallback, useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useDeck } from '../store/deckStore.js';
import { useRouter } from '../lib/router.js';
import { api, type DeckSummary } from '../lib/api.js';
import { imageSmall } from '../types.js';
import { buildDeckJson, downloadText, slugify, toYdk } from '../lib/exportDeck.js';
import { pct } from '../lib/fmt.js';
import { ImportDialog } from './ImportDialog.js';
import { AccountMenu } from './AccountMenu.js';

export function HomePage() {
  const { navigate } = useRouter();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setDecks(await api.listDecks());
    } catch {
      setDecks([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Erreur d'une LIAISON Discord (Lot D) : l'utilisateur est connecté, la page de
  // connexion (qui affiche les autres erreurs OAuth) n'est pas rendue ici.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('discord_error');
    if (!code) return;
    window.alert(
      code === 'discord_taken'
        ? 'Ce compte Discord est déjà lié à un autre compte.'
        : `Liaison Discord impossible (${code}).`,
    );
    params.delete('discord_error');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

  const open = (id: string) => navigate({ name: 'editor', id });

  const rename = async (id: string, name: string) => {
    await api.updateDeck(id, { name });
    setDecks((d) => d?.map((x) => (x.id === id ? { ...x, name } : x)) ?? d);
  };

  const duplicate = async (id: string) => {
    await api.duplicateDeck(id);
    await refresh();
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Supprimer « ${name} » ? La bibliothèque globale (combos, catégories, flags) n'est pas touchée.`))
      return;
    await api.deleteDeck(id);
    await refresh();
  };

  const exportYdk = async (id: string, name: string) => {
    const d = await api.getDeck(id);
    downloadText(`${slugify(name)}.ydk`, toYdk(d.cards.map((c) => ({ cardId: c.card_id, zone: c.zone, copies: c.copies }))));
  };

  const exportJson = async (id: string, name: string) => {
    const d = await api.getDeck(id);
    const s = useDeck.getState();
    const p = (d.params ?? {}) as Record<string, unknown>;
    const json = buildDeckJson({
      name: d.name,
      cards: d.cards.map((c) => ({ cardId: c.card_id, zone: c.zone, copies: c.copies })),
      starters: d.starters,
      excludedPairIds: d.pair_exclusions,
      pairs: s.pairs,
      hopt: s.hopt,
      deadFirst: s.deadFirst,
      deadSecond: s.deadSecond,
      categories: s.categories,
      cardCategories: s.cardCategories,
      params: {
        horizonFirst: Number(p.horizonFirst ?? 1),
        horizonSecond: Number(p.horizonSecond ?? 2),
        importance: typeof p.importance === 'number' ? p.importance : 0.5,
      },
    });
    downloadText(`${slugify(name)}.json`, JSON.stringify(json, null, 2), 'application/json');
  };

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-ink-200">
      <header className="flex shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-950 px-5 py-3">
        <span className="text-sm font-bold tracking-tight text-ink-100">YGO</span>
        <span className="text-[11px] text-ink-500">probabilités &amp; mains</span>
        <h1 className="ml-2 text-sm text-ink-300">Mes decks</h1>
        <button
          onClick={() => setNewOpen(true)}
          className="ml-auto rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-500"
        >
          + Nouveau deck
        </button>
        <AccountMenu />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {decks === null && <div className="text-sm text-ink-500">Chargement…</div>}
        {decks !== null && decks.length === 0 && (
          <div className="mx-auto mt-16 max-w-md rounded-xl border border-dashed border-ink-700 p-8 text-center">
            <p className="text-sm text-ink-300">Aucun deck pour l'instant.</p>
            <p className="mt-1 text-xs text-ink-500">
              Commence par importer un fichier YDK — c'est le plus rapide.
            </p>
            <button
              onClick={() => setNewOpen(true)}
              className="mt-4 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-500"
            >
              + Importer un deck
            </button>
          </div>
        )}

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {decks?.map((d) => (
            <DeckCard
              key={d.id}
              deck={d}
              onOpen={() => open(d.id)}
              onRename={(name) => rename(d.id, name)}
              onDuplicate={() => duplicate(d.id)}
              onDelete={() => remove(d.id, d.name)}
              onExportYdk={() => exportYdk(d.id, d.name)}
              onExportJson={() => exportJson(d.id, d.name)}
            />
          ))}
        </div>
      </div>

      {newOpen && (
        <ImportDialog
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            navigate({ name: 'editor', id });
          }}
        />
      )}
    </div>
  );
}

function DeckCard({
  deck,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onExportYdk,
  onExportJson,
}: {
  deck: DeckSummary;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExportYdk: () => void;
  onExportJson: () => void;
}) {
  const [name, setName] = useState(deck.name);
  const thumbs = (deck.sample_cards ?? []).map((x) => Number(x)).filter(Number.isFinite);
  const startRate = deck.summary?.startRateFirst;
  const brick = deck.summary?.brickRate;
  const updated = new Date(deck.updated_at).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
      {/* Bandeau de vignettes pour la reconnaissance visuelle. */}
      <button onClick={onOpen} className="flex h-16 gap-0.5 overflow-hidden bg-ink-950 px-2 pt-2" title="Ouvrir">
        {thumbs.length === 0 && (
          <span className="flex w-full items-center justify-center text-[10px] text-ink-600">deck vide</span>
        )}
        {thumbs.map((id) => (
          <img
            key={id}
            src={imageSmall(id)}
            alt=""
            loading="lazy"
            className="h-full rounded-t object-cover"
          />
        ))}
      </button>

      <div className="flex items-center gap-2 px-3 pt-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== deck.name && onRename(name.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-medium text-ink-100 outline-none hover:bg-ink-850 focus:bg-ink-850"
        />
        <span className="tnum shrink-0 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">
          {deck.main_count} c.
        </span>
        <DeckMenu
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onExportYdk={onExportYdk}
          onExportJson={onExportJson}
        />
      </div>

      <div className="flex items-center gap-4 px-3 py-2 text-xs">
        <Stat label="start ≥1 (1st)" value={startRate} good />
        <Stat label="brick (1st)" value={brick} />
        <span className="ml-auto text-[10px] text-ink-600">{updated}</span>
      </div>

      <button
        onClick={onOpen}
        className="mt-auto border-t border-ink-800 py-1.5 text-xs font-medium text-emerald-300 hover:bg-ink-850"
      >
        Ouvrir
      </button>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value?: number; good?: boolean }) {
  return (
    <div>
      <div className={`tnum text-sm font-semibold ${good ? 'text-emerald-300' : 'text-red-400'}`}>
        {value === undefined ? '—' : pct(value, 0)}
      </div>
      <div className="text-[9px] uppercase tracking-wide text-ink-600">{label}</div>
    </div>
  );
}

function DeckMenu({
  onDuplicate,
  onDelete,
  onExportYdk,
  onExportJson,
}: {
  onDuplicate: () => void;
  onDelete: () => void;
  onExportYdk: () => void;
  onExportJson: () => void;
}) {
  const item =
    'cursor-pointer rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-ink-700';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="shrink-0 rounded px-1.5 py-0.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100">
          ⋯
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 min-w-[170px] rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-2xl shadow-black/50"
        >
          <DropdownMenu.Item className={`${item} text-ink-200`} onSelect={onDuplicate}>
            Dupliquer
          </DropdownMenu.Item>
          <DropdownMenu.Item className={`${item} text-ink-200`} onSelect={onExportYdk}>
            Exporter YDK
          </DropdownMenu.Item>
          <DropdownMenu.Item className={`${item} text-ink-200`} onSelect={onExportJson}>
            Exporter JSON complet
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-ink-700" />
          <DropdownMenu.Item className={`${item} text-red-300`} onSelect={onDelete}>
            Supprimer
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
