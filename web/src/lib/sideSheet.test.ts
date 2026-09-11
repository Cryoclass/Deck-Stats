import { describe, expect, it } from 'vitest';
import { computePass } from '../engine/enumerate.js';
import { parseConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { libraryState, stateFromConfiguration } from './deckConfiguration.js';
import { applyPlan, planSummaryFromPass } from './sidePlan.js';
import { planKey, plansToCompute, sheetOf } from './sideSheet.js';
import { compareSegment, compareSideOf, parseCompareTarget, sidedNotice } from './comparison.js';
import type { DeckDetail } from './api.js';
import type { Library } from '../types.js';

// ─── Étape 10D : la fiche imprimable et le comparateur sur un deck sidé ───

const STARTER = 1; // ×3
const TARGET = 2; // ×1
const FILLERS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]; // ×3
const SIDE = 30; // ×2 en side
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b1';
const DECK = '00000000-0000-4000-8000-0000000000d1';
const library: Library = { hoptCardIds: [], categories: [], cardCategories: [], profiles: [], groups: [] };

const configuration = parseConfiguration({
  version: 2, name: 'Deck', notes: null, params: {}, pairs: [], conditions: [], deadFirst: [], deadSecond: [],
  cards: [{ card_id: STARTER, zone: 'main', copies: 3 }, { card_id: TARGET, zone: 'main', copies: 1 }, ...FILLERS.map((card_id) => ({ card_id, zone: 'main', copies: 3 })), { card_id: SIDE, zone: 'side', copies: 2 }],
  starters: [STARTER, SIDE],
  matchups: [
    // Ajouté en second (sort_index 1) : premier vide, second prêt.
    { id: A, name: 'Kewl Tune', sort_index: 1, plans: [
      { position: 'first', note: null, outgoing: [], incoming: [] },
      { position: 'second', note: 'Garder le side', outgoing: [{ card_id: 10, copies: 2 }], incoming: [{ card_id: SIDE, copies: 2 }] },
    ] },
    // Ajouté en premier : second incomplet (2 sortent, 1 entre), aucun volet premier.
    { id: B, name: 'Snake-Eye', sort_index: 0, plans: [
      { position: 'second', note: null, outgoing: [{ card_id: 10, copies: 2 }], incoming: [{ card_id: SIDE, copies: 1 }] },
    ] },
  ],
});
const source = { ...stateFromConfiguration(configuration), ...libraryState(library) };
const detail: DeckDetail = {
  id: DECK, revision: 3, configuration_version: 2, name: 'Deck', cards: configuration.cards, starters: configuration.starters,
  pairs: [], pair_exclusions: [], conditions: [], deadFirst: [], deadSecond: [], matchups: configuration.matchups, params: {}, notes: null,
};

describe('fiche imprimable', () => {
  it('un bloc par adversaire dans l’ordre d’ajout, deux volets premier puis second', () => {
    const sheet = sheetOf(source, source.matchups, {}, 'v1');
    expect(sheet.map((m) => m.name)).toEqual(['Snake-Eye', 'Kewl Tune']);
    expect(sheet.map((m) => m.plans.map((p) => p.position))).toEqual([['first', 'second'], ['first', 'second']]);
    // Volet absent ou vide : prêt, c'est le deck de base dans cette position.
    expect(sheet[0].plans[0]).toMatchObject({ applied: { status: 'ready' }, summary: null });
    expect(sheet[0].plans[0].input?.deckSize).toBe(40);
  });

  it('un plan qui n’est pas prêt n’a ni entrée de moteur ni chiffre, et n’est jamais « à calculer »', () => {
    const sheet = sheetOf(source, source.matchups, {}, 'v1');
    const incomplete = sheet[0].plans[1];
    expect(incomplete).toMatchObject({ applied: { status: 'incomplete' }, input: null, summary: null });
    expect(plansToCompute(sheet).map((p) => `${p.matchupId}:${p.position}`)).toEqual([`${B}:first`, `${A}:first`, `${A}:second`]);
  });

  it('un chiffre stocké n’est imprimé que s’il porte l’empreinte courante, sinon « — »', () => {
    const ready = sheetOf(source, source.matchups, {}, 'v1')[1].plans[1];
    const summary = planSummaryFromPass(computePass(ready.input!, 'second'), ready.input!, 'second', 'v1')!;
    const stored = { [planKey(A, 'second')]: summary };
    const printed = sheetOf(source, source.matchups, stored, 'v1');
    expect(printed[1].plans[1].summary).toEqual(summary);
    expect(plansToCompute(printed)).toHaveLength(2);
    expect(sheetOf(source, source.matchups, stored, 'v2')[1].plans[1].summary).toBeNull(); // autre moteur
    const edited = { ...source, starters: new Set([STARTER]) }; // le starter du side n'en est plus un
    expect(sheetOf(edited, source.matchups, stored, 'v1')[1].plans[1].summary).toBeNull();
  });
});

describe('comparateur sur un deck sidé', () => {
  it('lit « deck~adversaire~position », refuse une adresse tronquée', () => {
    expect(parseCompareTarget(DECK)).toEqual({ deckId: DECK, plan: null });
    expect(parseCompareTarget(compareSegment(DECK, A, 'second'))).toEqual({ deckId: DECK, plan: { matchupId: A, position: 'second' } });
    expect(() => parseCompareTarget(`${DECK}~${A}`)).toThrow(/deck~adversaire~position/);
    expect(() => parseCompareTarget(`${DECK}~${A}~third`)).toThrow(/deck~adversaire~position/);
  });

  it('le côté sidé porte le main dérivé du plan et un nom qui le dit ; le deck de base est inchangé', () => {
    const base = compareSideOf(detail, library, parseCompareTarget(DECK));
    expect(base).toMatchObject({ name: 'Deck', plan: null });
    expect(base.source.main).toEqual(source.main);
    const sided = compareSideOf(detail, library, parseCompareTarget(compareSegment(DECK, A, 'second')));
    expect(sided.name).toBe('Deck — Kewl Tune (second)');
    expect(sided.source.main).toEqual(applyPlan(source.main, source.side, source.matchups[0].plans[1]).main);
    expect(sidedNotice(sided)?.message).toBe('« Deck — Kewl Tune (second) » : deck après le plan second contre « Kewl Tune » — seul le scénario second correspond à ce plan, le scénario premier est donné pour information.');
    expect(sidedNotice(base)).toBeNull();
  });

  it('un plan pas prêt ou un adversaire disparu : refus explicite, rien n’est comparé', () => {
    expect(() => compareSideOf(detail, library, parseCompareTarget(compareSegment(DECK, B, 'second')))).toThrow('Plan second contre « Snake-Eye » incomplet : rien à comparer tant qu’il n’est pas prêt.');
    expect(() => compareSideOf(detail, library, parseCompareTarget(compareSegment(DECK, '00000000-0000-4000-8000-0000000000ff', 'first')))).toThrow(/adversaire introuvable/);
  });
});
