import { configurationFromDetail, sourceFromDetail } from '../lib/deckConfiguration.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useRouter } from '../lib/router.js';
import { api, type DeckSummary } from '../lib/api.js';
import { imageSmall } from '../types.js';
import { buildDeckJson, downloadText, slugify, toYdk } from '../lib/exportDeck.js';
import { pct } from '../lib/fmt.js';
import { buildEngineModel } from '../lib/engineModel.js';
import { summaryFromPass, usableSummary, type DeckSummary as Preview } from '../lib/summary.js';
import { createEngineClient } from '../worker/client.js';
import { ComputeCancelled } from '../worker/computeClient.js';
import { ImportDialog } from './ImportDialog.js';
import { AccountMenu } from './AccountMenu.js';
import { CompareDialog } from './ComparePage.js';

// ─── Aperçus (étape 9, point 1) ───
// Un résumé stocké n'est affiché que s'il est de la version du moteur courant (usableSummary) ;
// sinon il est recalculé ici, à la demande, par un client de calcul PROPRE à l'accueil (comme
// le comparateur), deck après deck (passe premier seule, mode `first`), affiché puis persisté
// par PUT /decks/:id/summary avec la révision lue (un 409 est ignoré : le deck a bougé, l'accueil
// suivant recalculera). Démontage ou nouvelle liste → client disposé, réponses ignorées.
type PreviewState =
  | { kind: 'computing' }
  | { kind: 'ready'; summary: Preview }
  | { kind: 'unavailable'; reason: string };

function usePreviews(decks: DeckSummary[] | null): Record<string, PreviewState> {
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const ref = useRef(previews);
  ref.current = previews;
  // Clé stable : les decks dont le résumé stocké n'est pas affichable. Renommer un deck ne
  // relance rien ; une nouvelle liste (duplication, suppression) relance pour les manquants.
  const pendingKey = useMemo(
    () => (decks ?? []).filter((d) => usableSummary(d.summary) === null).map((d) => d.id).join(','),
    [decks],
  );
  useEffect(() => {
    const todo = pendingKey ? pendingKey.split(',').filter((id) => ref.current[id]?.kind !== 'ready') : [];
    if (todo.length === 0) return;
    let cancelled = false;
    const client = createEngineClient();
    const set = (id: string, state: PreviewState) => {
      if (!cancelled) setPreviews((p) => ({ ...p, [id]: state }));
    };
    for (const id of todo) set(id, { kind: 'computing' });
    (async () => {
      const library = await api.getLibrary();
      for (const id of todo) {
        if (cancelled) return;
        try {
          const detail = await api.getDeck(id);
          const source = sourceFromDetail(detail, library);
          const mainSize = source.main.reduce((sum, c) => sum + c.copies, 0);
          const { result } = await client.compute(buildEngineModel(source).input, 'first').promise;
          const summary = summaryFromPass(result.first, mainSize);
          if (!summary) {
            set(id, { kind: 'unavailable', reason: result.first.unavailableReason ?? 'Analyse indisponible.' });
            continue;
          }
          set(id, { kind: 'ready', summary });
          void api.putSummary(id, summary, detail.revision).catch(() => {
            /* 409 ou panne : cache non écrit, recalculé à la prochaine visite. */
          });
        } catch (e) {
          if (cancelled || e instanceof ComputeCancelled) return;
          set(id, { kind: 'unavailable', reason: e instanceof Error ? e.message : 'Calcul impossible.' });
        }
      }
    })().catch((e: unknown) => {
      if (cancelled) return;
      for (const id of todo) set(id, { kind: 'unavailable', reason: e instanceof Error ? e.message : 'Bibliothèque indisponible.' });
    });
    return () => {
      cancelled = true;
      client.dispose();
    };
  }, [pendingKey]);
  return previews;
}

export function HomePage() {
  const { navigate } = useRouter();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const previews = usePreviews(decks);
  const [newOpen, setNewOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [actionError,setActionError] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>) => {
    setActionError(null);
    void action().catch((e: unknown) => setActionError(e instanceof Error ? e.message : 'Action impossible.'));
  };

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
    await api.renameDeck(id,name);
    setDecks((d) => d?.map((x) => (x.id === id ? { ...x, name } : x)) ?? d);
  };

  const duplicate = async (id: string) => {
    await api.duplicateDeck(id);
    await refresh();
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Supprimer « ${name} » ? Ses paires et conditions seront supprimées. Les catégories et HOPT partagés sont conservés.`))
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
    const library = await api.getLibrary();
    const json = buildDeckJson(configurationFromDetail(d),library);
    downloadText(`${slugify(name)}.json`, JSON.stringify(json, null, 2), 'application/json');
  };

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-ink-200">
      {/* Étape 6B : sous 400 px les actions passent sur une seconde ligne (flex-wrap) au lieu
          de déborder ; boutons primaires 32 px, libellés insécables. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 bg-ink-950 px-5 py-3">
        <span className="text-sm font-bold tracking-tight text-ink-100">YGO</span>
        <span className="whitespace-nowrap text-[11px] text-ink-500">probabilités &amp; mains</span>
        <h1 className="ml-2 whitespace-nowrap text-sm text-ink-300">Mes decks</h1>
        <button
          onClick={() => setCompareOpen(true)}
          disabled={(decks?.length ?? 0) < 2}
          title={
            (decks?.length ?? 0) < 2
              ? 'Il faut au moins deux decks pour comparer.'
              : 'Comparer deux decks (matrice starts × non-engine)'
          }
          className="ml-auto whitespace-nowrap rounded border border-ink-700 px-3 py-2 text-xs font-medium text-ink-200 hover:bg-ink-800 disabled:opacity-40"
        >
          ⇄ Comparer
        </button>
        <button
          onClick={() => setNewOpen(true)}
          className="whitespace-nowrap rounded bg-emerald-600 px-3 py-2 text-xs font-medium text-black hover:bg-emerald-500"
        >
          + Nouveau deck
        </button>
        <AccountMenu />
      </header>

      {actionError && <p role="alert" className="px-5 py-2 text-sm text-red-300">{actionError}</p>}
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
              className="mt-4 rounded bg-emerald-600 px-3 py-2 text-xs font-medium text-black hover:bg-emerald-500"
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
              preview={previews[d.id]}
              onOpen={() => open(d.id)}
              onRename={(name) => run(() => rename(d.id, name))}
              onDuplicate={() => run(() => duplicate(d.id))}
              onDelete={() => run(() => remove(d.id, d.name))}
              onExportYdk={() => run(() => exportYdk(d.id, d.name))}
              onExportJson={() => run(() => exportJson(d.id, d.name))}
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

      {compareOpen && decks && decks.length >= 2 && (
        <CompareDialog decks={decks} onClose={() => setCompareOpen(false)} />
      )}
    </div>
  );
}

function DeckCard({
  deck,
  preview,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onExportYdk,
  onExportJson,
}: {
  deck: DeckSummary;
  preview?: PreviewState;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExportYdk: () => void;
  onExportJson: () => void;
}) {
  const [name, setName] = useState(deck.name);
  const thumbs = (deck.sample_cards ?? []).map((x) => Number(x)).filter(Number.isFinite);
  // Résumé stocké de la version courante, sinon l'aperçu recalculé ici ; jamais un résumé
  // d'une autre version.
  const summary = usableSummary(deck.summary) ?? (preview?.kind === 'ready' ? preview.summary : null);
  const pending: { text: string; title: string } | null = summary
    ? null
    : preview?.kind === 'unavailable'
      ? { text: 'n/d', title: preview.reason }
      : { text: '…', title: 'Aperçu en cours de calcul' };
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

      <div className="flex items-center gap-4 px-3 py-2 text-xs" data-preview={summary ? 'ready' : preview?.kind ?? 'pending'}>
        <Stat label="départs ≥1 (premier)" value={summary?.startRateFirst} pending={pending} good />
        <Stat label="brick (premier)" value={summary?.brickRate} pending={pending} />
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

function Stat({ label, value, pending, good }: { label: string; value?: number; pending: { text: string; title: string } | null; good?: boolean }) {
  // Arrondi au rendu seulement : la valeur fine reste dans l'infobulle (même règle que les matrices).
  return (
    <div>
      <div
        className={`tnum text-sm font-semibold ${value === undefined ? 'text-ink-400' : good ? 'text-emerald-300' : 'text-red-400'}`}
        title={value === undefined ? pending?.title : pct(value, 2)}
      >
        {value === undefined ? pending?.text ?? '—' : pct(value, 0)}
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
        <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-400 hover:bg-ink-800 hover:text-ink-100">
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
