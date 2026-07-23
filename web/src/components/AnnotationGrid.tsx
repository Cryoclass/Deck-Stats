import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { assignGroups } from '../lib/colors.js';
import { imageSmall } from '../types.js';
import { CardTile } from './CardTile.js';
import { ModeBar } from './ModeBar.js';
import { AddCardDialog } from './AddCardDialog.js';
import { KEY_TO_MODE, MODE_LABEL, type AnnotationMode } from './annotationModes.js';

export function AnnotationGrid({
  column,
  highlightCardId = null,
  onHighlightConsumed,
}: {
  column: 'first' | 'second';
  highlightCardId?: number | null;
  onHighlightConsumed?: () => void;
}) {
  const main = useDeck((s) => s.main);
  const extra = useDeck((s) => s.extra);
  const side = useDeck((s) => s.side);
  const pairs = useDeck((s) => s.pairs);
  const excl = useDeck((s) => s.pairExclusions);
  const result = useDeck((s) => s.result);
  const model = useDeck((s) => s.model);
  const cards = useDeck((s) => s.cards);
  const categories = useDeck((s) => s.categories);
  const togglePair = useDeck((s) => s.togglePair);
  const toggleHopt = useDeck((s) => s.toggleHopt);
  const toggleStarter = useDeck((s) => s.toggleStarter);
  const toggleCardCategory = useDeck((s) => s.toggleCardCategory);
  const extraSideHidden = useDeck((s) => s.extraSideHidden);
  const setExtraSideHidden = useDeck((s) => s.setExtraSideHidden);

  const [mode, setMode] = useState<AnnotationMode>('select');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [comboPivot, setComboPivot] = useState<number | null>(null);
  const [modCount, setModCount] = useState(0);
  const [addOpen, setAddOpen] = useState(false);

  const enterMode = useCallback(
    (next: AnnotationMode, categoryId?: string) => {
      setMode(next);
      setComboPivot(null);
      setModCount(0);
      if (next === 'nonengine') {
        setActiveCategoryId(categoryId ?? activeCategoryId ?? categories[0]?.id ?? null);
      }
    },
    [activeCategoryId, categories],
  );

  const exitMode = useCallback(() => {
    setMode('select');
    setComboPivot(null);
  }, []);

  // Raccourcis clavier (§ Lot B). Échap sort toujours ; on ignore la saisie texte.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t?.isContentEditable) return;
      if (e.key === 'Escape') {
        exitMode();
        return;
      }
      const m = KEY_TO_MODE[e.key.toLowerCase()];
      if (m && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        enterMode(m);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enterMode, exitMode]);

  // La mise en évidence (saut depuis l'Inventaire) est éphémère : CardTile scrolle la
  // carte au centre puis on efface l'état ~2,2 s après pour que le ring s'estompe. Le
  // callback passe par une ref → le timer ne se réarme pas à chaque rendu du parent.
  const consumeRef = useRef(onHighlightConsumed);
  consumeRef.current = onHighlightConsumed;
  useEffect(() => {
    if (highlightCardId === null) return;
    const t = setTimeout(() => consumeRef.current?.(), 2200);
    return () => clearTimeout(t);
  }, [highlightCardId]);

  const groups = useMemo(() => {
    const inMain = new Set(main.map((c) => c.cardId));
    const edges = pairs
      .filter((p) => !excl.has(p.id) && inMain.has(p.card_a_id) && inMain.has(p.card_b_id))
      .map((p): [number, number] => [p.card_a_id, p.card_b_id]);
    return assignGroups(edges);
  }, [pairs, excl, main]);

  const deltas = useMemo(() => {
    const m = new Map<number, { first: number; second: number }>();
    if (result && model) model.typeCardIds.forEach((id, i) => m.set(id, result.deltas[i]));
    return m;
  }, [result, model]);

  // Cartes actuellement liées au pivot (pastille pivot instantanée en mode combo).
  const linkedSet = useMemo(() => {
    const s = new Set<number>();
    if (comboPivot === null) return s;
    const inMain = new Set(main.map((c) => c.cardId));
    for (const p of pairs) {
      if (excl.has(p.id)) continue;
      if (p.card_a_id === comboPivot && inMain.has(p.card_b_id)) s.add(p.card_b_id);
      if (p.card_b_id === comboPivot && inMain.has(p.card_a_id)) s.add(p.card_a_id);
    }
    return s;
  }, [comboPivot, pairs, excl, main]);

  const dispatch = (cardId: number) => {
    switch (mode) {
      case 'hopt':
        toggleHopt(cardId);
        setModCount((c) => c + 1);
        break;
      case 'starter':
        toggleStarter(cardId);
        setModCount((c) => c + 1);
        break;
      case 'nonengine':
        if (activeCategoryId) {
          toggleCardCategory(cardId, activeCategoryId);
          setModCount((c) => c + 1);
        }
        break;
      case 'combo':
        if (comboPivot === null) setComboPivot(cardId);
        else if (comboPivot === cardId) setComboPivot(null); // termine le groupe
        else {
          togglePair(comboPivot, cardId);
          setModCount((c) => c + 1);
        }
        break;
      default:
        break;
    }
  };

  if (main.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-ink-400">
        <p>Importe un deck (fichier YDK ou liste collée) pour commencer à annoter.</p>
        <button
          onClick={() => setAddOpen(true)}
          className="rounded border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800"
        >
          + Ajouter une carte
        </button>
        {addOpen && <AddCardDialog onClose={() => setAddOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ModeBar mode={mode} activeCategoryId={activeCategoryId} onEnter={enterMode} />

      {mode !== 'select' && (
        <ModeBanner
          mode={mode}
          modCount={modCount}
          comboPivot={comboPivot}
          pivotName={comboPivot !== null ? cards[comboPivot]?.name ?? `#${comboPivot}` : null}
          categoryName={categories.find((c) => c.id === activeCategoryId)?.name ?? null}
          onNewPivot={() => setComboPivot(null)}
          onDone={exitMode}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))' }}
        >
          {main.map((c) => (
            <CardTile
              key={c.cardId}
              cardId={c.cardId}
              column={column}
              groups={groups}
              delta={deltas.get(c.cardId)}
              mode={mode}
              activeCategoryId={activeCategoryId}
              comboPivot={comboPivot}
              linkedToPivot={linkedSet.has(c.cardId)}
              onCardClick={dispatch}
              highlighted={highlightCardId === c.cardId}
            />
          ))}
          {/* Ajout d'une carte en fin de grille (itération 3, A). */}
          <button
            onClick={() => setAddOpen(true)}
            title="Ajouter une carte"
            className="flex aspect-[59/86] flex-col items-center justify-center rounded-md border border-dashed border-ink-600 text-ink-500 transition-colors hover:border-emerald-500/60 hover:text-emerald-300"
          >
            <span className="text-2xl leading-none">+</span>
            <span className="mt-1 text-[10px]">Ajouter</span>
          </button>
        </div>

        {(extra.length > 0 || side.length > 0) && (
          <div className="mt-4">
            <button
              onClick={() => setExtraSideHidden(!extraSideHidden)}
              className="mb-2 text-[11px] uppercase tracking-wide text-ink-500 hover:text-ink-300"
            >
              {extraSideHidden ? '▸' : '▾'} Extra / Side — exclus des calculs (§4.1)
            </button>
            {!extraSideHidden && (
              <div
                className="grid gap-1 opacity-60"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))' }}
              >
                {[...extra, ...side].map((c) => (
                  <img
                    key={`${c.zone}-${c.cardId}`}
                    src={cards[c.cardId]?.image_url_small ?? imageSmall(c.cardId)}
                    alt={cards[c.cardId]?.name ?? String(c.cardId)}
                    title={`${cards[c.cardId]?.name ?? c.cardId} (${c.zone})`}
                    loading="lazy"
                    className="w-full rounded"
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {addOpen && <AddCardDialog onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function ModeBanner({
  mode,
  modCount,
  comboPivot,
  pivotName,
  categoryName,
  onNewPivot,
  onDone,
}: {
  mode: AnnotationMode;
  modCount: number;
  comboPivot: number | null;
  pivotName: string | null;
  categoryName: string | null;
  onNewPivot: () => void;
  onDone: () => void;
}) {
  const accent =
    mode === 'combo'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : mode === 'nonengine'
        ? 'border-sky-500/30 bg-sky-500/10 text-sky-200'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-200';

  let hint: string;
  if (mode === 'combo') {
    hint =
      comboPivot === null
        ? 'Clique une carte pour choisir le pivot.'
        : `Pivot : ${pivotName}. Clique les partenaires ; re-clique le pivot pour en changer.`;
  } else if (mode === 'nonengine') {
    hint = `Catégorie « ${categoryName ?? '—'} » : clique les cartes à (dé)marquer.`;
  } else {
    hint = `Clique les cartes à basculer en ${MODE_LABEL[mode]}.`;
  }

  return (
    <div className={`flex items-center gap-3 border-b px-3 py-1.5 text-xs ${accent}`}>
      <span className="font-semibold">Mode {MODE_LABEL[mode]}</span>
      <span className="opacity-90">{hint}</span>
      <span className="tnum ml-auto rounded bg-black/20 px-1.5 py-0.5 text-[11px]">
        {modCount} modif.
      </span>
      {mode === 'combo' && comboPivot !== null && (
        <button
          onClick={onNewPivot}
          className="rounded border border-white/20 px-2 py-0.5 text-[11px] hover:bg-black/20"
        >
          Nouveau pivot
        </button>
      )}
      <button
        onClick={onDone}
        className="rounded bg-black/25 px-2 py-0.5 text-[11px] hover:bg-black/40"
        title="Échap"
      >
        Terminer
      </button>
    </div>
  );
}
