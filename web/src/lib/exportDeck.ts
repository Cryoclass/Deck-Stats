import type { Library, Zone } from '../types.js';
import type { Configuration } from '../../../server/src/domain/deckConfiguration.js';
import { parseArchive, type DeckArchive } from '../../../server/src/domain/deckArchive.js';

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

export type DeckJson = DeckArchive;

/** Portable snapshot including dormant local annotations and query references. */
export function buildDeckJson(configuration: Configuration, library: Library): DeckArchive {
  const cardIds = new Set([...configuration.cards.map((c) => c.card_id),...configuration.starters,
    ...configuration.pairs.flatMap((p) => [p.card_a_id,p.card_b_id]),
    ...configuration.requirements.flatMap((r) => [r.required_card_id,...(r.source_card_id ? [r.source_card_id] : [])]),
    ...configuration.deadFirst,...configuration.deadSecond]);
  const cardCategories = library.cardCategories.filter((cc) => cardIds.has(cc.card_id));
  const categoryIds = new Set(cardCategories.map((cc) => cc.category_id));
  const view = configuration.params.statsView;
  if (typeof view === 'string' && !['starts','nonengine'].includes(view)) categoryIds.add(view);
  for (const q of (configuration.params.savedQueries ?? []) as Array<{ criteria: Array<{ subject: { kind: string; categoryId?: string; categoryIds?: string[] } }> }>) {
    for (const { subject } of q.criteria) {
      if (subject.kind === 'category') categoryIds.add(subject.categoryId!);
      if (subject.kind === 'group') subject.categoryIds!.forEach((id) => categoryIds.add(id));
    }
  }
  return parseArchive({ format: 'ygo-proba-deck',version: 2,configuration,
    library: { hoptCardIds: library.hoptCardIds.filter((id) => cardIds.has(id)),
      categories: library.categories.filter((c) => categoryIds.has(c.id)).map(({ id,name,relevance }) => ({ id,name,relevance })),
      cardCategories } });
}

export function parseDeckJson(text: string): DeckArchive | null {
  try { return parseArchive(JSON.parse(text)); } catch { return null; }
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
