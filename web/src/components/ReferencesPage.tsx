import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ReferenceLogEntry } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useRouter } from '../lib/router.js';
import { AVAILABILITY_LABEL, type Card, type CardReference, type NonEngineGroup } from '../types.js';
import { AccountMenu } from './AccountMenu.js';
import { ReferenceDialog, detectionSummary, type ReferenceBody } from './ReferenceDialog.js';

interface Loaded {
  references: CardReference[];
  log: ReferenceLogEntry[];
  cards: Record<number, Card>;
  groups: NonEngineGroup[];
}

const hoptText = (v: boolean | null) => (v === null ? 'détection' : v ? 'oui' : 'non');
const nonEngineText = (r: Pick<CardReference, 'nonengine_set' | 'availability' | 'group_name'>) =>
  !r.nonengine_set ? 'détection' : r.availability ? `${AVAILABILITY_LABEL[r.availability]}${r.group_name ? ` · ${r.group_name}` : ''}` : 'pas non-engine';

/** Désaccords d'une référence avec la détection (ce que le référent corrige), par aspect. */
export function disagreements(reference: CardReference, card: Card | undefined): string[] {
  // Carte absente du catalogue : aucune détection connue, donc aucun désaccord affirmé.
  if (!card) return [];
  const d = detectionSummary(card);
  const out: string[] = [];
  if (reference.is_hopt !== null && reference.is_hopt !== d.hopt) out.push(`HOPT : détection ${d.hopt ? 'oui' : 'non'}`);
  if (reference.nonengine_set && (reference.availability !== d.availability || (reference.availability !== null && (reference.group_name ?? null) !== d.group))) {
    out.push(`non-engine : détection ${d.availability ? AVAILABILITY_LABEL[d.availability] : 'aucun profil'}${d.group ? ` · ${d.group}` : ''}`);
  }
  return out;
}

/**
 * Page des références communes (annotations par défaut, D10) : liste, recherche, désaccords avec la
 * détection, journal des 50 dernières écritures. Réservée aux référents (réponse de l'utilisateur du
 * 17 septembre 2026) ; le serveur garde les écritures (404 sinon).
 */
export function ReferencesPage() {
  const { state } = useAuth();
  const { navigate } = useRouter();
  const referent = state.status === 'authenticated' && state.user.referent === true;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyDisagreements, setOnlyDisagreements] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, library] = await Promise.all([api.listReferences(), api.getLibrary()]);
      const ids = [...new Set([...list.references.map((r) => r.card_id), ...list.log.map((l) => l.card_id)])];
      const cards: Record<number, Card> = {};
      // Les désaccords se lisent sur le texte des cartes : sans lui, rien n'est affiché plutôt qu'un faux désaccord.
      for (const c of ids.length ? await api.cardsByIds(ids) : []) cards[c.id] = c;
      setLoaded({ references: list.references, log: list.log, cards, groups: library.groups });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    if (referent) void load();
  }, [referent, load]);

  const rows = useMemo(() => {
    if (!loaded) return [];
    const q = query.trim().toLowerCase();
    return loaded.references
      .map((r) => ({ reference: r, card: loaded.cards[r.card_id], gaps: disagreements(r, loaded.cards[r.card_id]) }))
      .filter((row) => !q || (row.card?.name ?? String(row.reference.card_id)).toLowerCase().includes(q) || String(row.reference.card_id).includes(q))
      .filter((row) => !onlyDisagreements || row.gaps.length > 0)
      .sort((a, b) => (a.card?.name ?? '').localeCompare(b.card?.name ?? ''));
  }, [loaded, query, onlyDisagreements]);

  const write = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Écriture impossible.');
    }
  };

  const editingReference = editing !== null ? loaded?.references.find((r) => r.card_id === editing) : undefined;

  return (
    <div className="flex h-[100dvh] flex-col bg-ink-950 text-fg-2" data-references-page>
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 bg-ink-950 px-5 py-3">
        <button onClick={() => navigate({ name: 'home' })} className="h-8 whitespace-nowrap rounded px-2 text-body text-fg-3 hover:bg-ink-800 hover:text-fg-1">
          ← Mes decks
        </button>
        <h1 className="whitespace-nowrap text-value font-semibold text-fg-1">Références communes</h1>
        <span className="ml-auto" />
        <AccountMenu />
      </header>

      {!referent ? (
        <div className="mx-auto mt-16 max-w-md rounded-xl border border-dashed border-ink-700 p-8 text-center">
          <p className="text-value text-fg-3">Page réservée aux référents.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="mb-3 max-w-3xl text-body text-fg-3">
            Valeurs par défaut communes à tous les comptes : elles corrigent la détection depuis le texte des cartes, et le choix
            d'un compte l'emporte sur elles. Une référence se pose depuis le détail d'une carte, dans l'éditeur.
          </p>
          {error && <p role="alert" className="mb-3 text-body text-neg">{error}</p>}

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input
              aria-label="Rechercher une carte"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une carte…"
              className="h-8 w-full max-w-xs rounded border border-ink-700 bg-ink-850 px-2 text-body text-fg-1 placeholder:text-fg-3"
            />
            <label className="flex items-center gap-2 text-body text-fg-3">
              <input type="checkbox" checked={onlyDisagreements} onChange={(e) => setOnlyDisagreements(e.target.checked)} />
              Désaccords avec la détection seulement
            </label>
            {loaded && <span className="tnum text-meta text-fg-3">{rows.length} / {loaded.references.length}</span>}
          </div>

          {loaded === null && !error && <div className="text-value text-fg-3">Chargement…</div>}
          {loaded && loaded.references.length === 0 && <p className="text-body text-fg-3">Aucune référence posée.</p>}

          <ul className="flex flex-col gap-1.5">
            {rows.map(({ reference, card, gaps }) => (
              <li
                key={reference.card_id}
                data-reference-row={reference.card_id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-body"
              >
                <span className="min-w-[10rem] flex-1 font-medium text-fg-1">{card?.name ?? `#${reference.card_id}`}</span>
                <span className="text-fg-3">HOPT <span className="text-fg-1">{hoptText(reference.is_hopt)}</span></span>
                <span className="text-fg-3">Non-engine <span className="text-fg-1">{nonEngineText(reference)}</span></span>
                {gaps.length > 0 && (
                  <span data-disagreement className="rounded bg-amber-500/15 px-1.5 py-0.5 text-meta text-warn" title={gaps.join(' ; ')}>
                    désaccord · {gaps.join(' ; ')}
                  </span>
                )}
                {reference.note && <span className="w-full text-meta text-fg-3">« {reference.note} »</span>}
                <button onClick={() => setEditing(reference.card_id)} className="h-8 rounded border border-ink-700 px-2.5 text-meta text-fg-2 hover:bg-ink-800">
                  Modifier
                </button>
              </li>
            ))}
          </ul>

          {loaded && loaded.log.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-meta uppercase tracking-wide text-fg-3">Journal (50 dernières écritures)</h2>
              <ul className="flex flex-col divide-y divide-ink-800 rounded-md border border-ink-800 bg-ink-900" data-reference-log>
                {loaded.log.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-body">
                    <span className="tnum text-meta text-fg-4">{new Date(l.at).toLocaleString()}</span>
                    <span className="text-fg-1">{loaded.cards[l.card_id]?.name ?? `#${l.card_id}`}</span>
                    <span className="text-fg-3">
                      {l.action === 'clear'
                        ? 'référence retirée'
                        : `HOPT ${hoptText(l.after?.is_hopt ?? null)} · non-engine ${l.after ? nonEngineText(l.after) : '—'}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {editing !== null && loaded && (
        <ReferenceDialog
          cardId={editing}
          card={loaded.cards[editing]}
          reference={editingReference}
          groups={loaded.groups}
          onSave={(body: ReferenceBody) => void write(() => api.setReference(editing, body))}
          onClear={() => void write(() => api.clearReference(editing))}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
