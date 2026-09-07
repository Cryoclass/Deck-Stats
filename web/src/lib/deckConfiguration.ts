import { parseConfiguration, type Configuration } from '../../../server/src/domain/deckConfiguration.js';
import type { ComboPair, DeckCard, StartRequirement, Library } from '../types.js';
import type { EngineModelSource } from './engineModel.js';
import type { SavedQuery } from '../engine/query.js';
import type { DeckDetail } from './api.js';

export interface EditableDeck {
  deckName: string;
  main: DeckCard[]; extra: DeckCard[]; side: DeckCard[];
  starters: Set<number>; pairs: ComboPair[]; pairExclusions: Set<string>;
  startRequirements: StartRequirement[];
  deadFirst: Set<number>; deadSecond: Set<number>;
  horizonFirst: number; horizonSecond: number; importance: number;
  statsView: string; savedQueries: SavedQuery[]; notes: string | null;
}

export function configurationFromState(s: EditableDeck): Configuration {
  return parseConfiguration({ version: 2, name: s.deckName,
    cards: [...s.main,...s.extra,...s.side].map((c) => ({ card_id: c.cardId,zone: c.zone,copies: c.copies })),
    starters: [...s.starters], pairs: s.pairs.map((p) => ({ ...p,disabled: s.pairExclusions.has(p.id) })),
    requirements: s.startRequirements.map((r) => ({ id: r.id,source_card_id: r.sourceCardId,source_pair_id: r.sourcePairId,required_card_id: r.requiredCardId,min_in_deck: r.minInDeck })),
    deadFirst: [...s.deadFirst],deadSecond: [...s.deadSecond],notes: s.notes,
    params: { horizonFirst: s.horizonFirst,horizonSecond: s.horizonSecond,importance: s.importance,statsView: s.statsView,savedQueries: s.savedQueries },
  });
}

export function stateFromConfiguration(c: Configuration): EditableDeck {
  const cards = (zone: DeckCard['zone']): DeckCard[] => c.cards.filter((card) => card.zone === zone).map((card) => ({ cardId: card.card_id,zone,copies: card.copies }));
  return {
    deckName: c.name,main: cards('main'),extra: cards('extra'),side: cards('side'),
    starters: new Set(c.starters),pairs: c.pairs.map(({ disabled: _disabled,...p }) => p),pairExclusions: new Set(c.pairs.filter((p) => p.disabled).map((p) => p.id)),
    startRequirements: c.requirements.map((r) => ({ id: r.id,sourceCardId: r.source_card_id,sourcePairId: r.source_pair_id,requiredCardId: r.required_card_id,minInDeck: r.min_in_deck })),
    deadFirst: new Set(c.deadFirst),deadSecond: new Set(c.deadSecond),notes: c.notes,
    horizonFirst: Number(c.params.horizonFirst ?? 1),horizonSecond: Number(c.params.horizonSecond ?? 2),importance: Number(c.params.importance ?? 0.5),
    statsView: String(c.params.statsView ?? 'starts'),savedQueries: (c.params.savedQueries ?? []) as SavedQuery[],
  };
}

export function configurationFromDetail(d: DeckDetail): Configuration {
  return parseConfiguration({ version: d.configuration_version,name: d.name,cards: d.cards,starters: d.starters,
    pairs: d.pairs,requirements: d.start_requirements ?? [],deadFirst: d.deadFirst,deadSecond: d.deadSecond,
    params: d.params ?? {},notes: d.notes ?? null });
}

export function libraryState(lib: Library) {
  const cardCategories = new Map<number,Set<string>>();
  for (const cc of lib.cardCategories) {
    const categories = cardCategories.get(cc.card_id) ?? new Set<string>();
    categories.add(cc.category_id);cardCategories.set(cc.card_id,categories);
  }
  return { hopt: new Set(lib.hoptCardIds),categories: lib.categories,cardCategories };
}

export function sourceFromDetail(detail: DeckDetail, library: Library): EngineModelSource {
  return { ...stateFromConfiguration(configurationFromDetail(detail)),...libraryState(library) };
}
