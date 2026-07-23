import type { Category, ComboPair, Relevance, Zone } from '../types.js';

export interface DeckCardRow {
  cardId: number;
  zone: Zone;
  copies: number;
}

/** Fichier YDK (§4.1) : sections #main / #extra / !side, un passcode par ligne, répété. */
export function toYdk(cards: DeckCardRow[]): string {
  const lines: string[] = ['#created by ygo-proba', '#main'];
  const emit = (zone: Zone) => {
    for (const c of cards.filter((x) => x.zone === zone))
      for (let i = 0; i < c.copies; i++) lines.push(String(c.cardId));
  };
  emit('main');
  lines.push('#extra');
  emit('extra');
  lines.push('!side');
  emit('side');
  return lines.join('\n') + '\n';
}

/** Sauvegarde JSON réellement complète (§4C) : le deck ET les annotations globales
 *  qu'il utilise. Références par ids de cartes / noms de catégorie → portable. */
export interface DeckJson {
  format: 'ygo-proba-deck';
  version: 1;
  name: string;
  cards: DeckCardRow[];
  starters: number[];
  excludedPairs: Array<[number, number]>; // paires canoniques désactivées pour ce deck
  pairs: Array<{ a: number; b: number; note?: string | null }>; // paires globales entre cartes du deck
  hopt: number[];
  deadFirst: number[];
  deadSecond: number[];
  categories: Array<{ name: string; relevance: Relevance }>;
  cardCategories: Array<[number, string]>; // [cardId, categoryName]
  params: { horizonFirst: number; horizonSecond: number; importance: number };
}

export function buildDeckJson(input: {
  name: string;
  cards: DeckCardRow[];
  starters: number[];
  excludedPairIds: string[];
  pairs: ComboPair[];
  hopt: Set<number>;
  deadFirst: Set<number>;
  deadSecond: Set<number>;
  categories: Category[];
  cardCategories: Map<number, Set<string>>;
  params: { horizonFirst: number; horizonSecond: number; importance: number };
}): DeckJson {
  const inDeck = new Set(input.cards.filter((c) => c.zone === 'main').map((c) => c.cardId));
  const catById = new Map(input.categories.map((c) => [c.id, c]));
  const pairById = new Map(input.pairs.map((p) => [p.id, p]));

  // On ne conserve que les annotations touchant des cartes du main deck.
  const relevantPairs = input.pairs.filter((p) => inDeck.has(p.card_a_id) && inDeck.has(p.card_b_id));
  const usedCategoryIds = new Set<string>();
  const cardCategories: Array<[number, string]> = [];
  for (const [cardId, cats] of input.cardCategories) {
    if (!inDeck.has(cardId)) continue;
    for (const cid of cats) {
      const cat = catById.get(cid);
      if (!cat) continue;
      usedCategoryIds.add(cid);
      cardCategories.push([cardId, cat.name]);
    }
  }

  const excludedPairs: Array<[number, number]> = input.excludedPairIds
    .map((id) => pairById.get(id))
    .filter((p): p is ComboPair => !!p)
    .map((p) => [p.card_a_id, p.card_b_id] as [number, number]);

  return {
    format: 'ygo-proba-deck',
    version: 1,
    name: input.name,
    cards: input.cards,
    starters: input.starters.filter((id) => inDeck.has(id)),
    excludedPairs,
    pairs: relevantPairs.map((p) => ({ a: p.card_a_id, b: p.card_b_id, note: p.note })),
    hopt: [...input.hopt].filter((id) => inDeck.has(id)),
    deadFirst: [...input.deadFirst].filter((id) => inDeck.has(id)),
    deadSecond: [...input.deadSecond].filter((id) => inDeck.has(id)),
    categories: input.categories
      .filter((c) => usedCategoryIds.has(c.id))
      .map((c) => ({ name: c.name, relevance: c.relevance })),
    cardCategories,
    params: input.params,
  };
}

export function parseDeckJson(text: string): DeckJson | null {
  try {
    const j = JSON.parse(text);
    return j?.format === 'ygo-proba-deck' ? (j as DeckJson) : null;
  } catch {
    return null;
  }
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(name: string): string {
  return (name || 'deck').trim().replace(/[^\w-]+/g, '_').slice(0, 60) || 'deck';
}
