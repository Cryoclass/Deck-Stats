import { describe, expect, it } from 'vitest';
import { parseConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { libraryState, stateFromConfiguration } from './deckConfiguration.js';
import { buildEngineModel } from './engineModel.js';
import { sameMain, studiedDeck, studiedDecks, studyLabel } from './studiedDeck.js';
import type { Library } from '../types.js';

// ─── Plans de side v2 (D1, D2, D16, S1, S2) : le deck étudié, en pur ───

const A = '00000000-0000-4000-8000-0000000000a1';
const STARTER = 1, SIDE = 30, EXTRA = 500, SIDE_EXTRA = 501;
const FILLERS = Array.from({ length: 12 }, (_, i) => 10 + i);
const library: Library = { hoptCardIds: [], categories: [], cardCategories: [], profiles: [], groups: [] };
const zoneOf = (id: number) => (id >= 500 ? ('extra' as const) : ('main' as const));
const configuration = parseConfiguration({
  version: 2, name: 'Deck', notes: null, params: {}, pairs: [], conditions: [], deadFirst: [], deadSecond: [],
  cards: [{ card_id: STARTER, zone: 'main', copies: 3 }, { card_id: 2, zone: 'main', copies: 1 }, ...FILLERS.map((card_id) => ({ card_id, zone: 'main', copies: 3 })), { card_id: EXTRA, zone: 'extra', copies: 2 }, { card_id: SIDE, zone: 'side', copies: 2 }, { card_id: SIDE_EXTRA, zone: 'side', copies: 1 }],
  starters: [STARTER, SIDE],
  matchups: [{ id: A, name: 'Kewl Tune', sort_index: 0, plans: [
    // Premier : plan vide (vaut le deck de base) ; second : prêt (2 sortent, 2 entrent) + un échange d'Extra.
    { position: 'first', note: null, outgoing: [], incoming: [] },
    { position: 'second', note: null, outgoing: [{ card_id: 10, copies: 2 }, { card_id: EXTRA, copies: 1 }], incoming: [{ card_id: SIDE, copies: 2 }, { card_id: SIDE_EXTRA, copies: 1 }] },
  ] }],
});
const state = { ...stateFromConfiguration(configuration), ...libraryState(library) };

describe('studiedDecks', () => {
  it('sans adversaire : le deck de base dans les deux positions, nommé', () => {
    const decks = studiedDecks(state, null, zoneOf);
    for (const position of ['first', 'second'] as const) {
      expect(decks[position]).toMatchObject({ position, kind: 'base', matchup: null, plan: null, applied: null, label: 'Deck de base', unavailableReason: null });
      expect(decks[position].source).toBe(state);
    }
  });

  it('contre un adversaire : la colonne premier étudie le plan premier, la colonne second le plan second (D2)', () => {
    const decks = studiedDecks(state, A, zoneOf);
    expect(decks.first).toMatchObject({ kind: 'sided', matchup: { id: A, name: 'Kewl Tune' }, label: 'contre Kewl Tune · premier', unavailableReason: null });
    expect(decks.second).toMatchObject({ kind: 'sided', label: 'contre Kewl Tune · second', unavailableReason: null });
    // Plan vide : même main que le deck de base, un seul calcul suffit (D4) ; le plan second dérive un autre main.
    expect(sameMain(decks.first.source!.main, state.main)).toBe(true);
    expect(sameMain(decks.second.source!.main, state.main)).toBe(false);
    expect(decks.second.source!.main.find((c) => c.cardId === SIDE)).toEqual({ cardId: SIDE, zone: 'main', copies: 2 });
    // Le deck sidé porte toutes les annotations du deck (R6) : la carte de side starter s'active en entrant.
    const model = buildEngineModel(decks.second.source!);
    expect(model.input.types[model.typeCardIds.indexOf(SIDE)].isStarter).toBe(true);
    // L'échange d'Extra du plan second est bien dans le plan appliqué, sans toucher au main.
    expect(decks.second.applied).toMatchObject({ status: 'ready', zones: { extra: { outgoing: 1, incoming: 1 } } });
  });

  it('un plan qui n’est pas prêt n’a aucune source, jamais le deck de base à sa place (S2)', () => {
    const incomplete = { ...state, matchups: [{ ...state.matchups[0], plans: [{ position: 'second' as const, note: null, outgoing: [{ card_id: 10, copies: 2 }], incoming: [{ card_id: SIDE, copies: 1 }] }] }] };
    const d = studiedDeck(incomplete, A, 'second', zoneOf);
    expect(d.source).toBeNull();
    expect(d.unavailableReason).toBe('Plan second incomplet : main 2 sortantes pour 1 entrante — aucun chiffre tant que chaque zone ne s’équilibre pas.');
    // Une carte d'Extra entrante face à une sortante du main (plan d'avant la v2) : déséquilibre dit zone par zone.
    const crossed = { ...state, matchups: [{ ...state.matchups[0], plans: [{ position: 'second' as const, note: null, outgoing: [{ card_id: 10, copies: 1 }], incoming: [{ card_id: SIDE_EXTRA, copies: 1 }] }] }] };
    expect(studiedDeck(crossed, A, 'second', zoneOf).unavailableReason).toBe('Plan second incomplet : main 1 sortante pour 0 entrante, extra 0 sortante pour 1 entrante — aucun chiffre tant que chaque zone ne s’équilibre pas.');
    const review = { ...state, matchups: [{ ...state.matchups[0], plans: [{ position: 'first' as const, note: null, outgoing: [{ card_id: 99, copies: 1 }], incoming: [{ card_id: SIDE, copies: 1 }] }] }] };
    expect(studiedDeck(review, A, 'first', zoneOf, (id) => `carte ${id}`)).toMatchObject({ source: null, unavailableReason: 'Plan premier à revoir — carte 99 : 1 copie à sortir, 0 en main. Aucun chiffre tant qu’il n’est pas corrigé.' });
    // Le volet absent vaut un plan vide : prêt, deck de base.
    expect(studiedDeck(incomplete, A, 'first', zoneOf)).toMatchObject({ kind: 'sided', unavailableReason: null });
  });

  it('un adversaire inconnu retombe sur le deck de base, ce que `matchup` laisse voir', () => {
    expect(studiedDeck(state, '00000000-0000-4000-8000-0000000000ff', 'first', zoneOf)).toMatchObject({ kind: 'base', matchup: null, label: 'Deck de base' });
  });

  it('libellés et comparaison de mains', () => {
    expect(studyLabel(null, 'first')).toBe('Deck de base');
    expect(studyLabel('Snake-Eye', 'second')).toBe('contre Snake-Eye · second');
    expect(sameMain(null, null)).toBe(true);
    expect(sameMain(null, state.main)).toBe(false);
    expect(sameMain(state.main, [...state.main].reverse())).toBe(false); // l'ordre compte : c'est l'ordre du moteur
  });
});
