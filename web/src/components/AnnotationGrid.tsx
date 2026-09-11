import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDeck } from '../store/deckStore.js';
import { assignGroups } from '../lib/colors.js';
import { leavesOf } from '../lib/conditions.js';
import { nonEngineEffect, type NonEngineEffect } from '../lib/nonEngine.js';
import { AVAILABILITY_LABEL, type Availability, type DeckCard, type Zone } from '../types.js';
import { EXTRA_SIDE_SOFT_LIMIT, ZONE_LABEL, overSoftLimit, zoneCount } from '../lib/zones.js';
import { CardTile } from './CardTile.js';
import { ZoneCardTile } from './ZoneCardTile.js';
import { ModeBar, type ModeOption } from './ModeBar.js';
import { AddCardDialog } from './AddCardDialog.js';
import { KEY_TO_MODE, MODE_LABEL, type AnnotationMode } from './annotationModes.js';

export function AnnotationGrid({
  highlightCardId = null,
  onHighlightConsumed,
}: {
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
  const cardCategories = useDeck((s) => s.cardCategories);
  const togglePair = useDeck((s) => s.togglePair);
  const toggleHopt = useDeck((s) => s.toggleHopt);
  const toggleStarter = useDeck((s) => s.toggleStarter);
  const profiles = useDeck((s) => s.profiles);
  const applyNonEngine = useDeck((s) => s.applyNonEngine);
  const setProfile = useDeck((s) => s.setProfile);
  const startConditions = useDeck((s) => s.startConditions);
  const toggleRequirement = useDeck((s) => s.toggleRequirement);
  const extraSideHidden = useDeck((s) => s.extraSideHidden);
  const setExtraSideHidden = useDeck((s) => s.setExtraSideHidden);

  const [mode, setMode] = useState<AnnotationMode>('select');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  // Étape 9B : profil posé avec l'étiquette par le mode Non-engine ; `null` = profil inchangé
  // (valeur par défaut : l'étiquette seule, comportement d'avant 9B — docs/etape-9.md).
  const [nonEngineProfile, setNonEngineProfile] = useState<Availability | null>(null);
  const [activeProfile, setActiveProfile] = useState<Availability | null>('flexible');
  const [comboPivot, setComboPivot] = useState<number | null>(null);
  const [prereqSource, setPrereqSource] = useState<number | null>(null);
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);
  const [modCount, setModCount] = useState(0);
  const [skipped, setSkipped] = useState(0); // mode Profil : cartes sans étiquette ignorées (Q1)
  // Étape 9C : le dialogue d'ajout porte la zone visée (main, extra ou side), `null` = fermé.
  const [addOpen, setAddOpen] = useState<Zone | null>(null);

  const enterMode = useCallback(
    (next: AnnotationMode, option?: ModeOption) => {
      setMode(next);
      setComboPivot(null);
      setPrereqSource(null);
      setModCount(0);
      setSkipped(0);
      if (next === 'nonengine') {
        setActiveCategoryId(option?.categoryId ?? activeCategoryId ?? categories[0]?.id ?? null);
        if (option && 'nonEngineProfile' in option) setNonEngineProfile(option.nonEngineProfile ?? null);
      }
      if (next === 'profile' && option && 'profile' in option) setActiveProfile(option.profile ?? null);
    },
    [activeCategoryId, categories],
  );

  const exitMode = useCallback(() => {
    setMode('select');
    setComboPivot(null);
    setPrereqSource(null);
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
    // Étape 10C : le side s'annote aussi (paire entre une carte de side et une carte du main).
    const inDeck = new Set([...main, ...side].map((c) => c.cardId));
    for (const p of pairs) {
      if (excl.has(p.id)) continue;
      if (p.card_a_id === comboPivot && inDeck.has(p.card_b_id)) s.add(p.card_b_id);
      if (p.card_b_id === comboPivot && inDeck.has(p.card_a_id)) s.add(p.card_a_id);
    }
    return s;
  }, [comboPivot, pairs, excl, main, side]);

  // Cartes dépendantes (sources de condition carte) → marqueur permanent (§D).
  const dependents = useMemo(
    () => new Set(startConditions.filter((r) => r.sourceCardId !== null).map((r) => r.sourceCardId!)),
    [startConditions],
  );
  // Dépendante « active » : la source en mode Condition, sinon la carte survolée si
  // elle est dépendante. Ses cartes requises sont mises en évidence par rebond (§D).
  const activeDependent =
    mode === 'prereq'
      ? prereqSource
      : hoveredCard !== null && dependents.has(hoveredCard)
        ? hoveredCard
        : null;
  const requiredByActive = useMemo(() => {
    const s = new Set<number>();
    if (activeDependent === null) return s;
    const r = startConditions.find((c) => c.sourceCardId === activeDependent);
    if (r) for (const l of leavesOf(r.condition)) s.add(l.leaf.card_id);
    return s;
  }, [activeDependent, startConditions]);

  // Étape 9B : effet du prochain clic en mode Non-engine, annoncé sur chaque tuile et dans le
  // bandeau (carte survolée) — même règle que le store (lib/nonEngine.ts).
  const effectOf = (cardId: number): NonEngineEffect | null =>
    mode === 'nonengine' && activeCategoryId
      ? nonEngineEffect(cardCategories.get(cardId)?.has(activeCategoryId) ?? false, profiles.get(cardId)?.availability ?? null, nonEngineProfile)
      : null;
  const hoveredEffect = hoveredCard !== null ? effectOf(hoveredCard) : null;

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
          applyNonEngine(cardId, activeCategoryId, nonEngineProfile);
          setModCount((c) => c + 1);
        }
        break;
      case 'profile':
        // Q1 : un profil sans étiquette ne mesure rien — la carte est ignorée, et dite ignorée.
        if (activeProfile !== null && (cardCategories.get(cardId)?.size ?? 0) === 0) {
          setSkipped((c) => c + 1);
          break;
        }
        setProfile(cardId, activeProfile);
        setModCount((c) => c + 1);
        break;
      case 'combo':
        if (comboPivot === null) setComboPivot(cardId);
        else if (comboPivot === cardId) setComboPivot(null); // termine le groupe
        else {
          togglePair(comboPivot, cardId);
          setModCount((c) => c + 1);
        }
        break;
      case 'prereq':
        if (prereqSource === null) setPrereqSource(cardId); // 1er clic = dépendante
        else if (prereqSource === cardId) setPrereqSource(null); // change de source
        else {
          toggleRequirement({ cardId: prereqSource }, cardId); // (dé)pose une clause ET
          setModCount((c) => c + 1);
        }
        break;
      default:
        break;
    }
  };

  // Props communes d'une tuile annotable, main ou side (étape 10C) : mêmes modes, mêmes marqueurs.
  const tileProps = (cardId: number) => ({
    cardId,
    groups,
    mode,
    activeCategoryId,
    nonEngineEffect: effectOf(cardId),
    comboPivot,
    linkedToPivot: linkedSet.has(cardId),
    onCardClick: dispatch,
    highlighted: highlightCardId === cardId,
    showPrereqMarker: dependents.has(cardId),
    prereqHighlight: activeDependent === cardId ? ('source' as const) : requiredByActive.has(cardId) ? ('required' as const) : null,
    prereqDim: mode === 'prereq' && prereqSource !== null && prereqSource !== cardId && !requiredByActive.has(cardId),
    onHoverChange: (h: boolean) => setHoveredCard((prev) => (h ? cardId : prev === cardId ? null : prev)),
  });

  // Étape 9C : extra et side éditables, un bloc par zone (« + Ajouter », tuiles de 80 px,
  // stepper de 32 px), toujours rendus — même sans main deck, même vides — pour qu'un ajout
  // reste possible ; le repli (▸ / ▾) masque les deux blocs ensemble.
  const zoneSection = (
    <div className="mt-4" data-zone-section>
      <button
        onClick={() => setExtraSideHidden(!extraSideHidden)}
        className="mb-2 flex h-6 items-center text-[11px] uppercase tracking-wide text-ink-500 hover:text-ink-300"
      >
        {extraSideHidden ? '▸' : '▾'} Extra / Side — éditables, exclus des calculs (contrat §2)
      </button>
      {!extraSideHidden && (
        <div className="flex flex-col gap-4">
          <ZoneBlock zone="extra" cards={extra} onAdd={() => setAddOpen('extra')} />
          {/* Étape 10C : le side s'annote (vraies tuiles, tous les modes) pour les plans de side ; l'extra reste nu (D17). */}
          <ZoneBlock zone="side" cards={side} onAdd={() => setAddOpen('side')} renderTile={(c) => <CardTile key={`side-${c.cardId}`} zone="side" {...tileProps(c.cardId)} />} />
        </div>
      )}
    </div>
  );
  const addDialog = addOpen && <AddCardDialog zone={addOpen} onClose={() => setAddOpen(null)} />;

  if (main.length === 0) {
    return (
      <div className="flex h-full flex-col overflow-y-auto p-2">
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-ink-400">
          <p>Importe un deck (fichier YDK ou liste collée) pour commencer à annoter.</p>
          <button
            onClick={() => setAddOpen('main')}
            className="rounded border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800"
          >
            + Ajouter une carte
          </button>
        </div>
        {zoneSection}
        {addDialog}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ModeBar mode={mode} activeCategoryId={activeCategoryId} nonEngineProfile={nonEngineProfile} activeProfile={activeProfile} onEnter={enterMode} />

      {mode !== 'select' && (
        <ModeBanner
          mode={mode}
          modCount={modCount}
          skipped={skipped}
          comboPivot={comboPivot}
          pivotName={comboPivot !== null ? cards[comboPivot]?.name ?? `#${comboPivot}` : null}
          prereqSource={prereqSource}
          sourceName={prereqSource !== null ? cards[prereqSource]?.name ?? `#${prereqSource}` : null}
          categoryName={categories.find((c) => c.id === activeCategoryId)?.name ?? null}
          nonEngineProfileName={nonEngineProfile ? AVAILABILITY_LABEL[nonEngineProfile] : null}
          hovered={hoveredEffect && hoveredCard !== null ? { name: cards[hoveredCard]?.name ?? `#${hoveredCard}`, effect: hoveredEffect } : null}
          profileName={activeProfile ? AVAILABILITY_LABEL[activeProfile] : null}
          onNewPivot={() => setComboPivot(null)}
          onNewSource={() => setPrereqSource(null)}
          onDone={exitMode}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div
          className="grid gap-1.5"
          // Étape 9 (réponse 3 de 7B) : 84 px essayé et mesuré — les trois cibles de 32 px tiennent
          // mais le delta « −1 : −6.38% » (53 px) est coupé dans les 49 px restants à 1440 (garde M4).
          // 96 px conservé : 9 colonnes à 1440 px, point clos.
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}
        >
          {main.map((c) => (
            <CardTile key={c.cardId} {...tileProps(c.cardId)} delta={deltas.get(c.cardId)} />
          ))}
          {/* Ajout d'une carte en fin de grille (itération 3, A). */}
          <button
            onClick={() => setAddOpen('main')}
            title="Ajouter une carte"
            className="flex aspect-[59/86] flex-col items-center justify-center rounded-md border border-dashed border-ink-600 text-ink-500 transition-colors hover:border-emerald-500/60 hover:text-emerald-300"
          >
            <span className="text-2xl leading-none">+</span>
            <span className="mt-1 text-[10px]">Ajouter</span>
          </button>
        </div>

        {zoneSection}
      </div>

      {addDialog}
    </div>
  );
}

/** Bloc d'une zone hors calcul (étape 9C) : compteur (repère 15, avertissement seulement — Q5),
 *  « + Ajouter » à 32 px, tuiles de 80 px (image + stepper). Étape 10C : `renderTile` rend de vraies
 *  tuiles annotables (side), à 96 px comme la grille du main. */
function ZoneBlock({ zone, cards, onAdd, renderTile }: { zone: Zone; cards: DeckCard[]; onAdd: () => void; renderTile?: (c: DeckCard) => ReactNode }) {
  const count = zoneCount(cards);
  const over = overSoftLimit(zone, count);
  return (
    <section data-zone-block={zone} aria-label={ZONE_LABEL[zone]}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-ink-200">{ZONE_LABEL[zone].charAt(0).toUpperCase() + ZONE_LABEL[zone].slice(1)}</span>
        <span
          data-zone-count={zone}
          className={`tnum rounded px-1.5 py-0.5 ${over ? 'bg-amber-500/15 text-amber-300' : 'bg-ink-800 text-ink-400'}`}
          title={over ? `Au-delà de ${EXTRA_SIDE_SOFT_LIMIT} cartes : repère seulement, rien n'est refusé.` : `${count} carte${count > 1 ? 's' : ''}`}
        >
          {count}
        </span>
        {over && <span className="text-[11px] text-amber-300">au-delà de {EXTRA_SIDE_SOFT_LIMIT} (repère)</span>}
        <button
          onClick={onAdd}
          data-zone-add={zone}
          title={`Ajouter une carte au ${ZONE_LABEL[zone]}`}
          className="ml-auto h-8 rounded border border-ink-700 px-2.5 text-[11px] text-ink-200 hover:bg-ink-800"
        >
          + Ajouter
        </button>
      </div>
      {cards.length === 0 ? (
        <p className="text-[11px] text-ink-600">Aucune carte.</p>
      ) : (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${renderTile ? 96 : 80}px, 1fr))` }}>
          {cards.map((c) => (renderTile ? renderTile(c) : <ZoneCardTile key={`${zone}-${c.cardId}`} cardId={c.cardId} zone={zone} />))}
        </div>
      )}
    </section>
  );
}

function ModeBanner({
  mode,
  modCount,
  skipped,
  comboPivot,
  pivotName,
  prereqSource,
  sourceName,
  categoryName,
  nonEngineProfileName,
  hovered,
  profileName,
  onNewPivot,
  onNewSource,
  onDone,
}: {
  mode: AnnotationMode;
  modCount: number;
  skipped: number;
  comboPivot: number | null;
  pivotName: string | null;
  prereqSource: number | null;
  sourceName: string | null;
  categoryName: string | null;
  nonEngineProfileName: string | null;
  /** Mode Non-engine : carte survolée et effet de son prochain clic (9B). */
  hovered: { name: string; effect: NonEngineEffect } | null;
  profileName: string | null;
  onNewPivot: () => void;
  onNewSource: () => void;
  onDone: () => void;
}) {
  const accent =
    mode === 'combo'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : mode === 'nonengine' || mode === 'profile'
        ? 'border-sky-500/30 bg-sky-500/10 text-sky-200'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-200';

  let hint: string;
  if (mode === 'combo') {
    hint =
      comboPivot === null
        ? 'Clique une carte pour choisir le pivot.'
        : `Pivot : ${pivotName}. Clique les partenaires ; re-clique le pivot pour en changer.`;
  } else if (mode === 'prereq') {
    hint =
      prereqSource === null
        ? 'Clique la carte dépendante (son start exige qu’il reste une carte en deck).'
        : `Dépendante : ${sourceName}. Clique les cartes requises EN DECK (clauses ET) ; les alternatives OU se composent dans l’inventaire. Re-clique la dépendante pour en changer.`;
  } else if (mode === 'nonengine') {
    // 9B : le couple choisi, puis l'effet du prochain clic sur la carte survolée (poser / retirer).
    const couple = `« ${categoryName ?? '—'} »${nonEngineProfileName ? ` + profil « ${nonEngineProfileName} »` : ''}`;
    hint = hovered
      ? `Prochain clic : ${hovered.effect} ${couple} — ${hovered.name}${hovered.effect === 'retirer' ? ' (le profil part avec la dernière étiquette)' : ''}.`
      : `${couple} : clique une carte pour la rendre conforme ; sur une carte déjà conforme, le clic retire l'étiquette (et le profil s'il ne reste aucune étiquette).`;
  } else if (mode === 'profile') {
    hint = profileName
      ? `Profil « ${profileName} » : clique les cartes étiquetées non-engine (annotation du compte).`
      : 'Retirer le profil : clique les cartes concernées (elles ne seront plus comptées).';
  } else {
    hint = `Clique les cartes à basculer en ${MODE_LABEL[mode]}.`;
  }

  return (
    // Étape 6B : sous 400 px la consigne passe sur sa propre ligne (flex-wrap) au lieu
    // d'écraser le compteur et les boutons ; actions du mode à 32 px de haut.
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs ${accent}`}>
      <span className="shrink-0 font-semibold">Mode {MODE_LABEL[mode]}</span>
      <span className="min-w-[12rem] flex-1 opacity-90">{hint}</span>
      <span className="tnum ml-auto shrink-0 whitespace-nowrap rounded bg-black/20 px-1.5 py-0.5 text-[11px]">
        {modCount} modif.
        {skipped > 0 ? ` · ${skipped} sans étiquette, ignorée${skipped > 1 ? 's' : ''}` : ''}
      </span>
      {mode === 'combo' && comboPivot !== null && (
        <button
          onClick={onNewPivot}
          className="h-8 shrink-0 rounded border border-white/20 px-2.5 text-[11px] hover:bg-black/20"
        >
          Nouveau pivot
        </button>
      )}
      {mode === 'prereq' && prereqSource !== null && (
        <button
          onClick={onNewSource}
          className="h-8 shrink-0 rounded border border-white/20 px-2.5 text-[11px] hover:bg-black/20"
        >
          Nouvelle source
        </button>
      )}
      <button
        onClick={onDone}
        className="h-8 shrink-0 rounded bg-black/25 px-2.5 text-[11px] hover:bg-black/40"
        title="Échap"
      >
        Terminer
      </button>
    </div>
  );
}
