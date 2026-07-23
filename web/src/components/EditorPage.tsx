import { useEffect, useState, type ReactNode } from 'react';
import { useDeck } from '../store/deckStore.js';
import { useRouter } from '../lib/router.js';
import { Header } from './Header.js';
import { AnnotationGrid } from './AnnotationGrid.js';
import { ComboList } from './ComboList.js';
import { HandWall } from './HandWall.js';
import { Inventory } from './Inventory.js';
import { StatsPanel } from './StatsPanel.js';
import { Toast } from './Toast.js';

type Tab = 'annotate' | 'combos' | 'hands' | 'inventory';

export function EditorPage({ id }: { id: string }) {
  const { navigate } = useRouter();
  const loadDeck = useDeck((s) => s.loadDeck);
  const saveDeck = useDeck((s) => s.saveDeck);
  const resumeDraft = useDeck((s) => s.resumeDraft);
  const discardDraft = useDeck((s) => s.discardDraft);
  const dirty = useDeck((s) => s.dirty);
  const deckId = useDeck((s) => s.deckId);
  const draftAvailable = useDeck((s) => s.draftAvailable);

  const [tab, setTab] = useState<Tab>('annotate');
  const [column, setColumn] = useState<'first' | 'second'>('first');
  const [highlightCardId, setHighlightCardId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadDeck(id).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, loadDeck]);

  // Confirmation à la fermeture / au rechargement d'onglet quand il y a du non-enregistré.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Ctrl/Cmd + S enregistre.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveDeck();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveDeck]);

  const goHome = () => {
    if (dirty && !window.confirm('Modifications non enregistrées. Retourner à l’accueil sans enregistrer ?'))
      return;
    navigate({ name: 'home' });
  };

  const focusCard = (cardId: number) => {
    setTab('annotate');
    setHighlightCardId(cardId);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950 text-sm text-ink-500">
        Chargement du deck…
      </div>
    );
  }
  if (deckId !== id) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-ink-950 text-sm text-ink-400">
        <p>Deck introuvable.</p>
        <button
          onClick={() => navigate({ name: 'home' })}
          className="rounded border border-ink-700 px-3 py-1.5 text-xs hover:bg-ink-800"
        >
          ← Retour aux decks
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-ink-200">
      <Header column={column} setColumn={setColumn} onSave={() => void saveDeck()} onHome={goHome} />

      {draftAvailable && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          <span>Modifications non enregistrées retrouvées pour ce deck.</span>
          <button
            onClick={resumeDraft}
            className="rounded bg-amber-500 px-2.5 py-1 text-[11px] font-medium text-black hover:bg-amber-400"
          >
            Reprendre
          </button>
          <button
            onClick={() => void discardDraft()}
            className="rounded border border-amber-500/40 px-2.5 py-1 text-[11px] hover:bg-amber-500/10"
          >
            Ignorer
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col border-r border-ink-800">
          <nav className="flex shrink-0 items-center gap-1 border-b border-ink-800 bg-ink-900 px-2 py-1.5">
            <TabButton active={tab === 'annotate'} onClick={() => setTab('annotate')}>
              Annoter
            </TabButton>
            <TabButton active={tab === 'combos'} onClick={() => setTab('combos')}>
              Combos &amp; catégories
            </TabButton>
            <TabButton active={tab === 'hands'} onClick={() => setTab('hands')}>
              Mur de mains
            </TabButton>
            <TabButton active={tab === 'inventory'} onClick={() => setTab('inventory')}>
              Inventaire
            </TabButton>
          </nav>
          <div className="min-h-0 flex-1">
            {tab === 'annotate' && (
              <AnnotationGrid
                column={column}
                highlightCardId={highlightCardId}
                onHighlightConsumed={() => setHighlightCardId(null)}
              />
            )}
            {tab === 'combos' && <ComboList />}
            {tab === 'hands' && <HandWall column={column} />}
            {tab === 'inventory' && <Inventory onFocusCard={focusCard} />}
          </div>
        </main>

        <aside className="hidden w-[500px] shrink-0 lg:block">
          <StatsPanel column={column} onShowHands={() => setTab('hands')} />
        </aside>
      </div>

      <Toast />
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
}
