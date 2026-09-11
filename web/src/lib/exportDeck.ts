import type { Library, Zone } from '../types.js';
import type { Configuration } from '../../../server/src/domain/deckConfiguration.js';
import { parseArchive, type DeckArchive } from '../../../server/src/domain/deckArchive.js';
import { requiredCardIds } from './conditions.js';

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

/** Portable snapshot including dormant local annotations, query references, profiles and caps. */
export function buildDeckJson(configuration: Configuration, library: Library): DeckArchive {
  const cardIds = new Set([...configuration.cards.map((c) => c.card_id),...configuration.starters,
    ...configuration.pairs.flatMap((p) => [p.card_a_id,p.card_b_id]),
    ...configuration.conditions.flatMap((r) => [...requiredCardIds(r.condition),...(r.source_card_id ? [r.source_card_id] : [])]),
    ...configuration.deadFirst,...configuration.deadSecond,
    // Étape 10 : une carte nommée par un plan de side emporte ses annotations de bibliothèque,
    // y compris si elle a quitté sa zone (plan « à revoir ») et n'est donc plus dans `cards`.
    ...configuration.matchups.flatMap((m) => m.plans.flatMap((p) => [...p.outgoing,...p.incoming].map((c) => c.card_id)))]);
  const cardCategories = library.cardCategories.filter((cc) => cardIds.has(cc.card_id));
  const categoryIds = new Set(cardCategories.map((cc) => cc.category_id));
  // Étape 9B : la vue n'est plus émise par l'éditeur (réglage transitoire) ; un deck enregistré
  // avant 9B peut encore la porter dans ses params (export depuis l'accueil) — acceptée en lecture,
  // sa catégorie reste jointe pour que `parseArchive` (remap des références) ne refuse pas l'archive.
  const view = configuration.params.statsView;
  if (typeof view === 'string' && !['starts','nonengine'].includes(view)) categoryIds.add(view);
  for (const q of (configuration.params.savedQueries ?? []) as Array<{ criteria: Array<{ subject: { kind: string; categoryId?: string; categoryIds?: string[] } }> }>) {
    for (const { subject } of q.criteria) {
      if (subject.kind === 'category') categoryIds.add(subject.categoryId!);
      if (subject.kind === 'group') subject.categoryIds!.forEach((id) => categoryIds.add(id));
    }
  }
  const profiles = (library.profiles ?? []).filter((p) => cardIds.has(p.card_id)).map((p) => ({ card_id: p.card_id,availability: p.availability,group_id: p.group_id ?? null }));
  const groupIds = new Set(profiles.map((p) => p.group_id).filter((id): id is string => id !== null));
  return parseArchive({ format: 'ygo-proba-deck',version: 2,configuration,
    library: { hoptCardIds: library.hoptCardIds.filter((id) => cardIds.has(id)),
      categories: library.categories.filter((c) => categoryIds.has(c.id)).map(({ id,name }) => ({ id,name })),
      cardCategories,
      profiles,
      groups: (library.groups ?? []).filter((g) => groupIds.has(g.id)).map(({ id,name,cap_per_turn }) => ({ id,name,cap_per_turn })) } });
}

/** Lit une archive JSON. Toute cause de refus est une exception porteuse du message
 *  exact (`ConfigurationError` de `parseArchive`, ou JSON illisible), jamais un `null`
 *  muet : le dialogue d'import affiche ce message. */
export function parseDeckJson(text: string): DeckArchive {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Fichier JSON illisible.'); }
  return parseArchive(value);
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
