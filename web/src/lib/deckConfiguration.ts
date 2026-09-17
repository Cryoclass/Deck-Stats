import { parseConfiguration, type Configuration } from '../../../server/src/domain/deckConfiguration.js';
import type { Card, CardProfile, CardReference, ComboPair, DeckCard, Library, LibraryChoice, Matchup, NonEngineGroup, StartCondition } from '../types.js';
import type { EngineModelSource } from './engineModel.js';
import { effectiveLibrary } from './effectiveLibrary.js';
import type { SavedQuery } from '../engine/query.js';
import type { DeckDetail } from './api.js';

export interface EditableDeck {
  deckName: string;
  main: DeckCard[]; extra: DeckCard[]; side: DeckCard[];
  starters: Set<number>; pairs: ComboPair[]; pairExclusions: Set<string>;
  startConditions: StartCondition[];
  deadFirst: Set<number>; deadSecond: Set<number>;
  /** Adversaires et leurs plans de side (étape 10) : donnée du deck, jamais du modèle moteur. */
  matchups: Matchup[];
  importance: number;
  savedQueries: SavedQuery[]; notes: string | null;
}

// Étape 9B : la vue du panneau de stats (`statsView`) est un réglage transitoire comme le
// contexte — jamais émise dans `params` (changer de vue ne salit pas le deck) ; une configuration
// ou une archive qui la porte encore reste acceptée en lecture (validateParams) et la valeur est
// ignorée, comme le contexte.
export function configurationFromState(s: EditableDeck): Configuration {
  return parseConfiguration({ version: 2, name: s.deckName,
    cards: [...s.main,...s.extra,...s.side].map((c) => ({ card_id: c.cardId,zone: c.zone,copies: c.copies })),
    starters: [...s.starters], pairs: s.pairs.map((p) => ({ ...p,disabled: s.pairExclusions.has(p.id) })),
    conditions: s.startConditions.map((r) => ({ id: r.id,source_card_id: r.sourceCardId,source_pair_id: r.sourcePairId,condition: r.condition })),
    deadFirst: [...s.deadFirst],deadSecond: [...s.deadSecond],matchups: s.matchups,notes: s.notes,
    params: { importance: s.importance,savedQueries: s.savedQueries },
  });
}

export function stateFromConfiguration(c: Configuration): EditableDeck {
  const cards = (zone: DeckCard['zone']): DeckCard[] => c.cards.filter((card) => card.zone === zone).map((card) => ({ cardId: card.card_id,zone,copies: card.copies }));
  return {
    deckName: c.name,main: cards('main'),extra: cards('extra'),side: cards('side'),
    starters: new Set(c.starters),pairs: c.pairs.map(({ disabled: _disabled,...p }) => p),pairExclusions: new Set(c.pairs.filter((p) => p.disabled).map((p) => p.id)),
    startConditions: c.conditions.map((r) => ({ id: r.id,sourceCardId: r.source_card_id,sourcePairId: r.source_pair_id,condition: r.condition })),
    deadFirst: new Set(c.deadFirst),deadSecond: new Set(c.deadSecond),matchups: c.matchups,notes: c.notes,
    importance: Number(c.params.importance ?? 0.5),
    savedQueries: (c.params.savedQueries ?? []) as SavedQuery[],
  };
}

export function configurationFromDetail(d: DeckDetail): Configuration {
  return parseConfiguration({ version: d.configuration_version,name: d.name,cards: d.cards,starters: d.starters,
    pairs: d.pairs,conditions: d.conditions ?? [],deadFirst: d.deadFirst,deadSecond: d.deadSecond,
    matchups: d.matchups ?? [],params: d.params ?? {},notes: d.notes ?? null });
}

/** Bibliothèque BRUTE du compte (partie C) : choix, profils matérialisés, références — rien de dérivé.
 *  `hopt` et `profiles` effectifs viennent de `effectiveLibrary` (choix > référence > détection). */
export interface LibraryState {
  /** Choix `true` explicites ; devient l'ensemble EFFECTIF après `withEffective` / `sourceFromDetail`. */
  hopt: Set<number>;
  choices: Map<number, LibraryChoice>;
  chosenProfiles: Map<number, CardProfile>;
  /** Alias de `chosenProfiles` tant qu'aucune détection n'a été appliquée (fixtures, tests) ; devient
   *  la carte EFFECTIVE après `withEffective` / `sourceFromDetail`. */
  profiles: Map<number, CardProfile>;
  categories: Library['categories'];
  cardCategories: Map<number, Set<string>>;
  groups: NonEngineGroup[];
  references: Map<number, CardReference>;
  referencesVersion: string;
}

export function libraryState(lib: Library): LibraryState {
  const cardCategories = new Map<number,Set<string>>();
  for (const cc of lib.cardCategories) {
    const categories = cardCategories.get(cc.card_id) ?? new Set<string>();
    categories.add(cc.category_id);cardCategories.set(cc.card_id,categories);
  }
  const chosenProfiles = new Map<number,CardProfile>();
  for (const p of lib.profiles ?? []) chosenProfiles.set(p.card_id,{ availability: p.availability,groupId: p.group_id ?? null });
  const choices = new Map<number,LibraryChoice>();
  for (const c of lib.choices ?? []) choices.set(c.card_id,c);
  // Serveur antérieur à la partie C : un HOPT listé est un choix `true` ; un profil listé, un choix matérialisé.
  for (const id of lib.hoptCardIds) if (!choices.has(id)) choices.set(id,{ card_id: id,is_hopt: true,nonengine_choice: chosenProfiles.has(id) });
  for (const id of chosenProfiles.keys()) if (!choices.has(id)) choices.set(id,{ card_id: id,is_hopt: null,nonengine_choice: true });
  const references = new Map<number,CardReference>();
  for (const r of lib.references ?? []) references.set(r.card_id,r);
  return { hopt: new Set(lib.hoptCardIds),choices,chosenProfiles,profiles: chosenProfiles,categories: lib.categories,cardCategories,groups: lib.groups ?? [],references,referencesVersion: lib.referencesVersion ?? '0' };
}

/** Applique la fusion effective (choix > référence > détection) à une bibliothèque brute pour les
 *  cartes données : `hopt` et `profiles` deviennent les valeurs effectives (R1). */
export function withEffective<T extends LibraryState>(state: T, cards: Record<number, Card>, cardIds: Iterable<number>): T {
  const effective = effectiveLibrary(state,cards,cardIds);
  return { ...state,hopt: effective.hopt,profiles: effective.profiles };
}

/** Source du moteur pour un deck enregistré : configuration + bibliothèque EFFECTIVE, dérivée des
 *  textes de cartes fournis (`cards` : les objets `Card` du deck ; une carte absente n'a aucun défaut). */
export function sourceFromDetail(detail: DeckDetail, library: Library, cards: Record<number, Card>): EditableDeck & LibraryState & EngineModelSource {
  const state = { ...stateFromConfiguration(configurationFromDetail(detail)),...libraryState(library) };
  const ids = [...state.main,...state.extra,...state.side].map((c) => c.cardId);
  return withEffective(state,cards,ids);
}
