import { describe, expect, it } from 'vitest';
import { computePass } from '../engine/enumerate.js';
import { parseConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { libraryState, stateFromConfiguration } from './deckConfiguration.js';
import { applyPlan, planSummaryFromPass } from './sidePlan.js';
import { groupByZone, planKey, plansToCompute, sheetOf } from './sideSheet.js';
import { compareSegment, compareSideOf, parseCompareTarget, sidedNotice } from './comparison.js';
import type { DeckDetail } from './api.js';
import type { Library } from '../types.js';
import { zoneOfCatalog } from './zones.js';

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
const MAIN = () => 'main' as const; // v2 : toutes les cartes de ce test sont de type main deck
// v2 (S5) : le comparateur déduit la zone de chaque carte de plan de son type au catalogue chargé.
const catalog = Object.fromEntries([STARTER, TARGET, ...FILLERS, SIDE].map((id) => [id, { id, name: `#${id}`, type: 'Effect Monster' }]));
const detail: DeckDetail = {
  id: DECK, revision: 3, configuration_version: 2, name: 'Deck', cards: configuration.cards, starters: configuration.starters,
  pairs: [], pair_exclusions: [], conditions: [], deadFirst: [], deadSecond: [], matchups: configuration.matchups, params: {}, notes: null,
};

describe('fiche imprimable', () => {
  it('un bloc par adversaire dans l’ordre d’ajout, deux volets premier puis second', () => {
    const sheet = sheetOf(source, source.matchups, {}, MAIN, 'v1');
    expect(sheet.map((m) => m.name)).toEqual(['Snake-Eye', 'Kewl Tune']);
    expect(sheet.map((m) => m.plans.map((p) => p.position))).toEqual([['first', 'second'], ['first', 'second']]);
    // Volet absent ou vide : prêt, c'est le deck de base dans cette position.
    expect(sheet[0].plans[0]).toMatchObject({ applied: { status: 'ready' }, summary: null });
    expect(sheet[0].plans[0].input?.deckSize).toBe(40);
  });

  it('un plan qui n’est pas prêt n’a ni entrée de moteur ni chiffre, et n’est jamais « à calculer »', () => {
    const sheet = sheetOf(source, source.matchups, {}, MAIN, 'v1');
    const incomplete = sheet[0].plans[1];
    expect(incomplete).toMatchObject({ applied: { status: 'incomplete' }, input: null, summary: null });
    expect(plansToCompute(sheet).map((p) => `${p.matchupId}:${p.position}`)).toEqual([`${B}:first`, `${A}:first`, `${A}:second`]);
  });

  it('un chiffre stocké n’est imprimé que s’il porte l’empreinte courante, sinon « — »', () => {
    const ready = sheetOf(source, source.matchups, {}, MAIN, 'v1')[1].plans[1];
    const summary = planSummaryFromPass(computePass(ready.input!, 'second'), ready.input!, 'second', 'v1')!;
    const stored = { [planKey(A, 'second')]: summary };
    const printed = sheetOf(source, source.matchups, stored, MAIN, 'v1');
    expect(printed[1].plans[1].summary).toEqual(summary);
    expect(plansToCompute(printed)).toHaveLength(2);
    expect(sheetOf(source, source.matchups, stored, MAIN, 'v2')[1].plans[1].summary).toBeNull(); // autre moteur
    const edited = { ...source, starters: new Set([STARTER]) }; // le starter du side n'en est plus un
    expect(sheetOf(edited, source.matchups, stored, MAIN, 'v1')[1].plans[1].summary).toBeNull();
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
    const base = compareSideOf(detail, library, parseCompareTarget(DECK), catalog);
    expect(base).toMatchObject({ name: 'Deck', plan: null });
    expect(base.source.main).toEqual(source.main);
    const sided = compareSideOf(detail, library, parseCompareTarget(compareSegment(DECK, A, 'second')), catalog);
    expect(sided.name).toBe('Deck — Kewl Tune (second)');
    expect(sided.source.main).toEqual(applyPlan(source, source.matchups[0].plans[1], MAIN).main);
    expect(sidedNotice(sided)?.message).toBe('« Deck — Kewl Tune (second) » : deck après le plan second contre « Kewl Tune » — seul le scénario second correspond à ce plan, le scénario premier est donné pour information.');
    expect(sidedNotice(base)).toBeNull();
  });

  it('un plan pas prêt ou un adversaire disparu : refus explicite, rien n’est comparé', () => {
    expect(() => compareSideOf(detail, library, parseCompareTarget(compareSegment(DECK, B, 'second')), catalog)).toThrow('Plan second contre « Snake-Eye » incomplet : rien à comparer tant qu’il n’est pas prêt.');
    expect(() => compareSideOf(detail, library, parseCompareTarget(compareSegment(DECK, '00000000-0000-4000-8000-0000000000ff', 'first')), catalog)).toThrow(/adversaire introuvable/);
  });
});

// ─── Plans de side v2, partie E : l'Extra Deck dans la fiche et le comparateur (D8, S5, S7) ───
const EXTRA_PI = 40; // Fusion, ×1 en extra
const EXTRA_CHI = 41; // Synchro, ×1 en side
const catalogV2 = {
  ...catalog,
  [EXTRA_PI]: { id: EXTRA_PI, name: 'Extra Pi', type: 'Fusion Monster' },
  [EXTRA_CHI]: { id: EXTRA_CHI, name: 'Extra Chi', type: 'Synchro Monster' },
};
const zoneV2 = zoneOfCatalog(catalogV2 as never);
const C = '00000000-0000-4000-8000-0000000000c1';
const D = '00000000-0000-4000-8000-0000000000d2';
const configurationV2 = parseConfiguration({
  ...configuration,
  cards: [...configuration.cards, { card_id: EXTRA_PI, zone: 'extra', copies: 1 }, { card_id: EXTRA_CHI, zone: 'side', copies: 1 }],
  matchups: [
    ...configuration.matchups,
    // Même échange de main que « Kewl Tune » second, plus un échange d'Extra : mêmes chiffres (S7).
    { id: C, name: 'Branded', sort_index: 2, plans: [
      { position: 'second', note: null, outgoing: [{ card_id: 10, copies: 2 }, { card_id: EXTRA_PI, copies: 1 }], incoming: [{ card_id: SIDE, copies: 2 }, { card_id: EXTRA_CHI, copies: 1 }] },
    ] },
    // Échange d'Extra seul : le main dérivé est le deck de base.
    { id: D, name: 'Ryzeal', sort_index: 3, plans: [
      { position: 'first', note: null, outgoing: [{ card_id: EXTRA_PI, copies: 1 }], incoming: [{ card_id: EXTRA_CHI, copies: 1 }] },
    ] },
  ],
});
const sourceV2 = { ...stateFromConfiguration(configurationV2), ...libraryState(library) };
const detailV2: DeckDetail = { ...detail, cards: configurationV2.cards, matchups: configurationV2.matchups };

describe('fiche imprimable — Extra Deck (v2)', () => {
  it('les cartes d’un cadre sont groupées par zone : main, puis Extra, puis zone inconnue — jamais mêlées', () => {
    const list = [{ card_id: EXTRA_PI, copies: 1 }, { card_id: 10, copies: 2 }, { card_id: 999, copies: 1 }];
    expect(groupByZone(list, zoneV2)).toEqual({ main: [{ card_id: 10, copies: 2 }], extra: [{ card_id: EXTRA_PI, copies: 1 }], unknown: [{ card_id: 999, copies: 1 }] });
    const sheet = sheetOf(sourceV2, sourceV2.matchups, {}, zoneV2, 'v1');
    const branded = sheet.find((m) => m.name === 'Branded')!.plans[1];
    expect(branded.applied.status).toBe('ready');
    expect(branded.groups).toEqual({
      outgoing: { main: [{ card_id: 10, copies: 2 }], extra: [{ card_id: EXTRA_PI, copies: 1 }], unknown: [] },
      incoming: { main: [{ card_id: SIDE, copies: 2 }], extra: [{ card_id: EXTRA_CHI, copies: 1 }], unknown: [] },
    });
  });

  it('S7 : l’Extra ne change ni l’entrée du moteur ni l’empreinte — mêmes chiffres qu’un plan sans Extra', () => {
    const sheet = sheetOf(sourceV2, sourceV2.matchups, {}, zoneV2, 'v1');
    const kewl = sheet.find((m) => m.name === 'Kewl Tune')!.plans[1];
    const branded = sheet.find((m) => m.name === 'Branded')!.plans[1];
    expect(branded.input).toEqual(kewl.input);
    const summary = planSummaryFromPass(computePass(kewl.input!, 'second'), kewl.input!, 'second', 'v1')!;
    const printed = sheetOf(sourceV2, sourceV2.matchups, { [planKey(C, 'second')]: summary }, zoneV2, 'v1');
    expect(printed.find((m) => m.name === 'Branded')!.plans[1].summary).toEqual(summary);
    // Échange d'Extra seul : deck de base au moteur, extra dérivé pour la fiche.
    const ryzeal = sheet.find((m) => m.name === 'Ryzeal')!.plans[0];
    expect(ryzeal.applied).toMatchObject({ status: 'ready', extraSize: 1, extra: [{ cardId: EXTRA_CHI, copies: 1 }] });
    expect(ryzeal.input).toEqual(sheet.find((m) => m.name === 'Snake-Eye')!.plans[0].input);
  });

  it('comparateur : un plan à Extra se compare sur son main dérivé ; un plan d’Extra seul compare le deck de base à lui-même', () => {
    const branded = compareSideOf(detailV2, library, parseCompareTarget(compareSegment(DECK, C, 'second')), catalogV2 as never);
    expect(branded.name).toBe('Deck — Branded (second)');
    expect(branded.source.main).toEqual(applyPlan(sourceV2, sourceV2.matchups.find((m) => m.id === C)!.plans[0], zoneV2).main);
    expect(branded.source.main).toEqual(compareSideOf(detailV2, library, parseCompareTarget(compareSegment(DECK, A, 'second')), catalogV2 as never).source.main);
    const ryzeal = compareSideOf(detailV2, library, parseCompareTarget(compareSegment(DECK, D, 'first')), catalogV2 as never);
    expect(ryzeal.source.main).toEqual(sourceV2.main);
    expect(ryzeal.plan).toEqual({ matchupName: 'Ryzeal', position: 'first' });
  });
});
