import { useMemo, useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import type { Relevance } from '../types.js';
import { pct } from '../lib/fmt.js';
import { CardImage } from './CardImage.js';

/**
 * Section « Starters conditionnels » (§E) — chaque source de prérequis avec ses cartes
 * requises en clair. Deux avertissements en accent : carte requise absente (source morte
 * en permanence) ; carte requise en 1 copie (source perdue dès qu'elle est piochée, avec
 * la probabilité correspondante — utile pour le deckbuilding).
 */
function ConditionalStarters() {
  const startRequirements = useDeck((s) => s.startRequirements);
  const main = useDeck((s) => s.main);
  const starters = useDeck((s) => s.starters);
  const pairs = useDeck((s) => s.pairs);
  const cards = useDeck((s) => s.cards);

  const deckSize = main.reduce((a, c) => a + c.copies, 0);
  const mainCopies = useMemo(() => new Map(main.map((c) => [c.cardId, c.copies])), [main]);
  const name = (id: number) => cards[id]?.name ?? `#${id}`;

  if (startRequirements.length === 0) return null;

  // Regroupement par source (carte starter ou paire).
  const groups = new Map<string, { label: string; note?: string; reqs: typeof startRequirements }>();
  for (const r of startRequirements) {
    const key = r.sourceCardId !== null ? `c:${r.sourceCardId}` : `p:${r.sourcePairId}`;
    if (!groups.has(key)) {
      let label: string;
      let note: string | undefined;
      if (r.sourceCardId !== null) {
        label = name(r.sourceCardId);
        if (!mainCopies.has(r.sourceCardId)) note = 'source absente du deck';
        else if (!starters.has(r.sourceCardId)) note = 'pas un starter — prérequis inerte';
      } else {
        const p = pairs.find((pp) => pp.id === r.sourcePairId);
        label = p ? `${name(p.card_a_id)} + ${name(p.card_b_id)}` : 'paire supprimée';
      }
      groups.set(key, { label, note, reqs: [] });
    }
    groups.get(key)!.reqs.push(r);
  }

  return (
    <div className="border-b border-ink-800 p-3">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-400">
        Starters conditionnels (§E)
      </div>
      <ul className="flex flex-col gap-2">
        {[...groups.values()].map((g, i) => (
          <li key={i} className="rounded-md border border-ink-800 bg-ink-900 p-2 text-xs">
            <div className="font-medium text-ink-100">
              {g.label}
              {g.note && <span className="ml-2 text-[10px] text-ink-500">({g.note})</span>}
            </div>
            <ul className="mt-1 flex flex-col gap-1">
              {g.reqs.map((r) => {
                const total = mainCopies.get(r.requiredCardId) ?? 0;
                const absent = total === 0;
                const single = total === 1 && r.minInDeck === 1;
                const pFirst = deckSize > 0 ? Math.min(5, deckSize) / deckSize : 0;
                const pSecond = deckSize > 0 ? Math.min(6, deckSize) / deckSize : 0;
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-300">
                      requiert <b className="text-amber-200">▤ {name(r.requiredCardId)}</b>
                      {r.minInDeck > 1 ? ` ≥${r.minInDeck}` : ''} en deck
                    </span>
                    {absent ? (
                      <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                        carte absente du deck — source morte en permanence
                      </span>
                    ) : single ? (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                        1 seule copie — source perdue dès qu'elle est piochée ·{' '}
                        <span className="tnum">
                          {pct(pFirst, 1)} 1st / {pct(pSecond, 1)} 2nd
                        </span>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Onglet Inventaire (Lot B, itération 2) — vue statique en LECTURE de la composition du
 * deck : combien de quoi, et lesquelles. Aucune édition ici (copies, annotations) : ces
 * gestes vivent dans l'onglet « Annoter ». Le seul geste interactif est le dépliage d'une
 * section et le saut vers « Annoter » (via `onFocusCard`) sur clic d'une vignette.
 *
 * Deux pièges de comptage traités explicitement :
 *  - on affiche TOUJOURS copies ET cartes distinctes (« 11 copies · 5 cartes ») ;
 *  - les sections se recoupent (une carte peut être handtrap ET pièce de combo), donc la
 *    somme des sections dépasse la taille du deck. Le pied de vue donne un total
 *    dédupliqué pour lever toute ambiguïté.
 */
export function Inventory({ onFocusCard }: { onFocusCard: (cardId: number) => void }) {
  const main = useDeck((s) => s.main);
  const extra = useDeck((s) => s.extra);
  const side = useDeck((s) => s.side);
  const starters = useDeck((s) => s.starters);
  const deadFirst = useDeck((s) => s.deadFirst);
  const deadSecond = useDeck((s) => s.deadSecond);
  const categories = useDeck((s) => s.categories);
  const cardCategories = useDeck((s) => s.cardCategories);
  const pairs = useDeck((s) => s.pairs);
  const pairExclusions = useDeck((s) => s.pairExclusions);

  const { sections, mainCopies, deckSize, annotatedCopies, nonAnnotatedCopies } = useMemo(() => {
    const mainCopies = new Map(main.map((c) => [c.cardId, c.copies]));
    const mainIds = main.map((c) => c.cardId);
    const deckSize = main.reduce((s, c) => s + c.copies, 0);

    // Membres d'au moins une paire active (non exclue, les deux cartes dans le main deck).
    const comboMembers = new Set<number>();
    for (const p of pairs) {
      if (pairExclusions.has(p.id)) continue;
      if (mainCopies.has(p.card_a_id) && mainCopies.has(p.card_b_id)) {
        comboMembers.add(p.card_a_id);
        comboMembers.add(p.card_b_id);
      }
    }

    // Une carte est « annotée » si un RÔLE lui a été donné (starter, pièce de combo,
    // catégorie non-engine, morte selon la position). HOPT est un simple modificateur,
    // pas un rôle : une carte n'ayant QUE HOPT reste « Non annotée ».
    const isAnnotated = (id: number) =>
      starters.has(id) ||
      comboMembers.has(id) ||
      (cardCategories.get(id)?.size ?? 0) > 0 ||
      deadFirst.has(id) ||
      deadSecond.has(id);

    const pick = (pred: (id: number) => boolean) => mainIds.filter(pred);

    const sections: Section[] = [
      { key: 'starters', title: 'Starters 1-carte', ids: pick((id) => starters.has(id)) },
      {
        key: 'combo',
        title: 'Pièces de combo 2-cartes',
        ids: pick((id) => comboMembers.has(id)),
      },
      ...categories.map((cat) => ({
        key: `cat-${cat.id}`,
        title: cat.name,
        relevance: cat.relevance,
        ids: pick((id) => !!cardCategories.get(id)?.has(cat.id)),
      })),
      {
        key: 'dead1',
        title: 'Mortes going first',
        ids: pick((id) => deadFirst.has(id)),
        hideIfEmpty: true,
      },
      {
        key: 'dead2',
        title: 'Mortes going second',
        ids: pick((id) => deadSecond.has(id)),
        hideIfEmpty: true,
      },
      { key: 'none', title: 'Non annotées', ids: pick((id) => !isAnnotated(id)), safetyNet: true },
    ];

    const annotatedCopies = mainIds.reduce(
      (s, id) => s + (isAnnotated(id) ? (mainCopies.get(id) ?? 0) : 0),
      0,
    );

    return {
      sections,
      mainCopies,
      deckSize,
      annotatedCopies,
      nonAnnotatedCopies: deckSize - annotatedCopies,
    };
  }, [main, starters, deadFirst, deadSecond, categories, cardCategories, pairs, pairExclusions]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setExpanded((e) => ({ ...e, [key]: !e[key] }));

  if (main.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-400">
        Importe un deck pour voir sa composition.
      </div>
    );
  }

  const extraCount = extra.reduce((s, c) => s + c.copies, 0);
  const sideCount = side.reduce((s, c) => s + c.copies, 0);
  const outOfBounds = deckSize < 40 || deckSize > 60;

  return (
    <div className="flex h-full flex-col">
      {/* Bandeau de tête : tailles des trois zones + alerte de plage. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-800 bg-ink-900 px-3 py-2 text-xs">
        <span className="font-semibold text-ink-100">Inventaire</span>
        <span
          className={`tnum rounded px-1.5 py-0.5 ${
            outOfBounds ? 'bg-amber-500/15 text-amber-300' : 'bg-ink-800 text-ink-300'
          }`}
          title="Taille du main deck (extra/side exclus des calculs)"
        >
          Main {deckSize}
        </span>
        <span className="tnum rounded bg-ink-800 px-1.5 py-0.5 text-ink-400">Extra {extraCount}</span>
        <span className="tnum rounded bg-ink-800 px-1.5 py-0.5 text-ink-400">Side {sideCount}</span>
        {outOfBounds && (
          <span className="text-[11px] text-amber-300">hors bornes 40–60 (§D)</span>
        )}
        <span className="ml-auto text-[10px] text-ink-600">
          Les sections se recoupent — total dédupliqué en bas.
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ConditionalStarters />
        {sections
          .filter((s) => !(s.hideIfEmpty && s.ids.length === 0))
          .map((s) => (
            <SectionRow
              key={s.key}
              section={s}
              expanded={!!expanded[s.key]}
              onToggle={() => toggle(s.key)}
              onFocusCard={onFocusCard}
              mainCopies={mainCopies}
              deckSize={deckSize}
            />
          ))}
      </div>

      {/* Pied de vue : total dédupliqué (une carte comptée une fois quel que soit le
          nombre de sections qui la contiennent). */}
      <div className="shrink-0 border-t border-ink-800 bg-ink-900 px-3 py-2 text-xs text-ink-400">
        Total annoté : <span className="tnum text-ink-100">{annotatedCopies}</span> copies ·{' '}
        <span className="tnum text-ink-100">{deckSize}</span> dans le deck ·{' '}
        <span className={`tnum ${nonAnnotatedCopies > 0 ? 'text-amber-300' : 'text-ink-300'}`}>
          {nonAnnotatedCopies}
        </span>{' '}
        non annotées
      </div>
    </div>
  );
}

interface Section {
  key: string;
  title: string;
  ids: number[];
  relevance?: Relevance;
  hideIfEmpty?: boolean;
  safetyNet?: boolean;
}

function SectionRow({
  section,
  expanded,
  onToggle,
  onFocusCard,
  mainCopies,
  deckSize,
}: {
  section: Section;
  expanded: boolean;
  onToggle: () => void;
  onFocusCard: (cardId: number) => void;
  mainCopies: Map<number, number>;
  deckSize: number;
}) {
  const copies = section.ids.reduce((s, id) => s + (mainCopies.get(id) ?? 0), 0);
  const cartes = section.ids.length;
  const empty = cartes === 0;
  const share = deckSize > 0 ? copies / deckSize : 0;
  const accent = section.safetyNet && !empty;

  return (
    <div className="border-b border-ink-800">
      <button
        onClick={onToggle}
        disabled={empty}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs ${
          empty ? 'cursor-default text-ink-600' : 'text-ink-200 hover:bg-ink-900'
        }`}
      >
        <span className="w-3 shrink-0 text-ink-500">{empty ? '' : expanded ? '▾' : '▸'}</span>
        <span className={`font-medium ${accent ? 'text-amber-300' : empty ? '' : 'text-ink-100'}`}>
          {section.title}
        </span>
        {section.relevance && (
          <span className="rounded bg-ink-800 px-1 text-[10px] text-ink-500">
            {section.relevance === 'both' ? '1st+2nd' : section.relevance === 'first' ? '1st' : '2nd'}
          </span>
        )}
        <span
          className={`tnum ml-auto ${accent ? 'font-medium text-amber-300' : 'text-ink-400'}`}
        >
          {copies} copies · {cartes} cartes · {pct(share, 1)} du deck
        </span>
      </button>

      {expanded && !empty && (
        <div
          className="grid gap-1.5 px-3 pb-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}
        >
          {section.ids.map((id) => (
            <ThumbButton
              key={id}
              cardId={id}
              copies={mainCopies.get(id) ?? 1}
              onClick={() => onFocusCard(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ThumbButton({
  cardId,
  copies,
  onClick,
}: {
  cardId: number;
  copies: number;
  onClick: () => void;
}) {
  const name = useDeck((s) => s.cards[cardId]?.name);
  return (
    <button
      onClick={onClick}
      title={`${name ?? cardId} — ouvrir dans Annoter`}
      className="relative block aspect-[59/86] overflow-hidden rounded-md border border-ink-800 bg-ink-900 transition-colors hover:border-emerald-500/60"
    >
      <CardImage cardId={cardId} />
      <span className="tnum pointer-events-none absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] font-bold text-ink-100">
        ×{copies}
      </span>
    </button>
  );
}
