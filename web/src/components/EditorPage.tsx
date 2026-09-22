import { useEffect, useState, type ReactNode } from 'react';
import { useDeck } from '../store/deckStore.js';
import { useRouter } from '../lib/router.js';
import { DefaultsNotice } from './DefaultsNotice.js';
import { Header } from './Header.js';
import { AnnotationGrid } from './AnnotationGrid.js';
import { ComboList } from './ComboList.js';
import { HandWall } from './HandWall.js';
import { Inventory } from './Inventory.js';
import { StatsPanel } from './StatsPanel.js';
import { SidePlanner } from './SidePlanner.js';
import { Toast } from './Toast.js';
import { searchForStudy, type StudyParams } from '../lib/studyUrl.js';

type Tab = 'annotate' | 'combos' | 'hands' | 'inventory' | 'side' | 'stats';

/**
 * Onglets de l'éditeur. `label` est le nom complet (onglets du haut, `title` et nom
 * accessible à toute largeur) ; `short` est le libellé de la barre du bas, où six entrées
 * se partagent 360 px. Audit 01 §4 : les onglets défilaient avec 208 px masqués à droite,
 * sans le moindre indice — « Inventaire » et « Plans de side » n'existaient pas pour qui
 * ne faisait pas glisser la barre.
 */
const TABS: ReadonlyArray<{ id: Tab; label: string; short: string; belowLgOnly?: boolean }> = [
  { id: 'annotate', label: 'Annoter', short: 'Annoter' },
  { id: 'combos', label: 'Combos & catégories', short: 'Combos' },
  { id: 'hands', label: 'Mur de mains', short: 'Mains' },
  { id: 'inventory', label: 'Inventaire', short: 'Invent.' },
  { id: 'side', label: 'Plans de side', short: 'Side' },
  { id: 'stats', label: 'Stats', short: 'Stats', belowLgOnly: true },
];

export function EditorPage({ id, initialTab, initialStudy }: { id: string; initialTab?: 'side'; initialStudy?: StudyParams }) {
  const { navigate } = useRouter();
  const loadDeck = useDeck((s) => s.loadDeck);
  const saveDeck = useDeck((s) => s.saveDeck);
  const resumeDraft = useDeck((s) => s.resumeDraft);
  const discardDraft = useDeck((s) => s.discardDraft);
  const dirty = useDeck((s) => s.dirty);
  const deckId = useDeck((s) => s.deckId);
  const draftAvailable = useDeck((s) => s.draftAvailable);
  const persistenceError = useDeck((s) => s.persistenceError);
  const studyMatchupId = useDeck((s) => s.study.matchupId);
  const context = useDeck((s) => s.context);
  const setStudy = useDeck((s) => s.setStudy);
  const setContext = useDeck((s) => s.setContext);

  const [tab, setTab] = useState<Tab>(initialTab ?? 'annotate');
  const [highlightCardId, setHighlightCardId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // Sous 640 px la navigation passe en bas. Une seule des deux barres est RENDUE (pas
  // seulement masquée) : il n'existe jamais deux <nav> d'onglets dans le document.
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadDeck(id).finally(() => {
      if (!alive) return;
      // Plans de side v2 (D1, Q11) : le contexte d'étude vient de l'URL seule, appliqué une fois le deck lu.
      if (initialStudy?.position) setContext(initialStudy.position);
      if (initialStudy?.matchupId) setStudy(initialStudy.matchupId);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
    // `initialStudy` ne vaut qu'à l'ouverture : le store est ensuite la seule source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadDeck]);

  // Le contexte d'étude est reflété dans l'URL par `replaceState` (jamais une entrée d'historique) :
  // il survit au rechargement sans rien écrire ailleurs (D1).
  useEffect(() => {
    if (loading || deckId !== id) return;
    const search = searchForStudy(studyMatchupId, context);
    if (window.location.search !== search) window.history.replaceState(null, '', `${window.location.pathname}${search}`);
  }, [loading, deckId, id, studyMatchupId, context]);

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

  // Le panneau latéral de stats n'existe qu'à partir de lg : si la fenêtre repasse
  // en large alors que l'onglet mobile « Stats » est actif, on revient sur « Annoter ».
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onChange = () => setCompact(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (mq.matches) setTab((t) => (t === 'stats' ? 'annotate' : t));
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
      <div className="flex h-[100dvh] items-center justify-center bg-ink-950 text-value text-fg-3">
        Chargement du deck…
      </div>
    );
  }
  if (deckId !== id) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-ink-950 text-value text-fg-3">
        <p>{persistenceError ?? 'Deck introuvable.'}</p>
        <button
          onClick={() => navigate({ name: 'home' })}
          className="rounded border border-ink-700 px-3 py-1.5 text-body hover:bg-ink-800"
        >
          ← Retour aux decks
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-ink-950 text-fg-2">
      <Header onSave={() => void saveDeck()} onHome={goHome} />
      <DefaultsNotice />

      {draftAvailable && (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-body text-warn">
          <span>Modifications non enregistrées retrouvées pour ce deck.</span>
          <button
            onClick={resumeDraft}
            className="h-7 rounded bg-amber-500 px-2.5 text-body font-medium text-black hover:bg-amber-400"
          >
            Reprendre
          </button>
          <button
            onClick={() => void discardDraft()}
            className="h-7 rounded border border-amber-500/40 px-2.5 text-body hover:bg-amber-500/10"
          >
            Ignorer
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col border-r border-ink-800">
          {/* Dès 640 px : onglets soulignés sur une seule ligne, rien de masqué. */}
          {!compact && (
            <nav className="flex shrink-0 items-center gap-1 border-b border-ink-800 bg-ink-900 px-2">
              {TABS.map((t) => (
                <TabButton
                  key={t.id}
                  label={t.label}
                  active={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={t.belowLgOnly ? 'lg:hidden' : ''}
                >
                  {t.label}
                </TabButton>
              ))}
            </nav>
          )}
          <div className="min-h-0 flex-1">
            {tab === 'annotate' && (
              <AnnotationGrid
                highlightCardId={highlightCardId}
                onHighlightConsumed={() => setHighlightCardId(null)}
              />
            )}
            {tab === 'combos' && <ComboList />}
            {tab === 'hands' && <HandWall />}
            {tab === 'inventory' && <Inventory onFocusCard={focusCard} />}
            {tab === 'side' && <SidePlanner />}
            {tab === 'stats' && <StatsPanel onShowHands={() => setTab('hands')} />}
          </div>
        </main>

        <aside className="hidden w-[500px] shrink-0 lg:block">
          <StatsPanel onShowHands={() => setTab('hands')} />
        </aside>
      </div>

      {/* Sous 640 px : la navigation passe en bas, au pouce (48 px), en dernier enfant de la
          colonne — jamais en survol du contenu, donc aucune réserve de padding à tenir. */}
      {compact && (
        <nav className="flex shrink-0 border-t border-ink-800 bg-ink-950 pb-[env(safe-area-inset-bottom)]">
          {TABS.map((t) => (
            <button
              key={t.id}
              title={t.label}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
              className={`flex h-12 flex-1 items-center justify-center border-t-2 px-0.5 text-meta font-medium transition-colors ${
                tab === t.id ? 'border-emerald-500 text-fg-1' : 'border-transparent text-fg-3'
              }`}
            >
              {t.short}
            </button>
          ))}
        </nav>
      )}

      <Toast />
    </div>
  );
}

/** Onglet souligné (charte §7.8) : l'état actif est un trait plein + le texte le plus
 *  clair, pas un simple changement de gris. */
function TabButton({
  active,
  label,
  onClick,
  children,
  className = '',
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={`-mb-px flex h-10 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-body font-medium transition-colors ${
        active
          ? 'border-emerald-500 text-fg-1'
          : 'border-transparent text-fg-3 hover:border-ink-600 hover:text-fg-1'
      } ${className}`}
    >
      {children}
    </button>
  );
}
