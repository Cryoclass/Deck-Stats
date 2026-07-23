import { useEffect, useState, type ReactNode } from 'react';
import { useDeck } from './store/deckStore.js';
import { api } from './lib/api.js';
import { readStateFromHash } from './lib/share.js';
import { Header } from './components/Header.js';
import { AnnotationGrid } from './components/AnnotationGrid.js';
import { ComboList } from './components/ComboList.js';
import { HandWall } from './components/HandWall.js';
import { StatsPanel } from './components/StatsPanel.js';
import { ImportDialog } from './components/ImportDialog.js';

type Tab = 'annotate' | 'combos' | 'hands';

export default function App() {
  const bootstrap = useDeck((s) => s.bootstrap);
  const loadShared = useDeck((s) => s.loadShared);
  const hasDeck = useDeck((s) => s.main.length > 0);

  const [tab, setTab] = useState<Tab>('annotate');
  const [column, setColumn] = useState<'first' | 'second'>('first');
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    (async () => {
      await bootstrap();
      const shared = readStateFromHash();
      if (shared) {
        const ids = shared.cards.map((c) => c.cardId);
        let cards: Awaited<ReturnType<typeof api.cardsByIds>> = [];
        try {
          cards = await api.cardsByIds(ids);
        } catch {
          /* images dérivables du CDN */
        }
        loadShared(shared, cards);
      }
    })();
  }, [bootstrap, loadShared]);

  useEffect(() => {
    if (!hasDeck && !importOpen) {
      const t = setTimeout(() => setImportOpen(true), 300);
      return () => clearTimeout(t);
    }
  }, [hasDeck, importOpen]);

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-ink-200">
      <Header column={column} setColumn={setColumn} onOpenImport={() => setImportOpen(true)} />

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
          </nav>
          <div className="min-h-0 flex-1">
            {tab === 'annotate' && <AnnotationGrid column={column} />}
            {tab === 'combos' && <ComboList />}
            {tab === 'hands' && <HandWall column={column} />}
          </div>
        </main>

        <aside className="hidden w-[500px] shrink-0 lg:block">
          <StatsPanel column={column} />
        </aside>
      </div>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
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
