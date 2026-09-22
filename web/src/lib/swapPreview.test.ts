import { describe, expect, it } from 'vitest';
import { computePass } from '../engine/enumerate.js';
import { parseConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { libraryState, stateFromConfiguration } from './deckConfiguration.js';
import { buildEngineModel } from './engineModel.js';
import { swapInPlan } from './matchups.js';
import { applyPlan, planIndicators, sidedSource } from './sidePlan.js';
import { CANDIDATES_AUTO_MS, EMPTY_SELECTION, adjustSelection, candidateDelta, candidateInputs, candidatesOf, estimateCandidatesMs, freeCopies, previewOf, shownPlan, zonesTouched, type Selection } from './swapPreview.js';
import type { Library, Matchup, SidePlan } from '../types.js';

// ─── Plans de side v2 (D5, D6, S3, S4) : aperçu en direct et écarts de candidats, en pur ───

const STARTER = 1; // ×3
const HT = 3; // ×3, flexible
const FILLERS = Array.from({ length: 11 }, (_, i) => 10 + i); // ×3
const SIDE_HT = 31; // ×3 en side, précoce
const SIDE_NEUTRAL = 32; // ×2 en side, neutre
const SIDE_STARTER = 30; // ×1 en side, starter
const EXTRA = 500, SIDE_EXTRA = 501;
const M = '00000000-0000-4000-8000-0000000000aa';
const name = (id: number) => `#${id}`;
const zoneOf = (id: number) => (id === 999 ? null : id >= 500 ? ('extra' as const) : ('main' as const));
const library: Library = {
  hoptCardIds: [], categories: [{ id: 'ht', name: 'Handtrap', is_builtin: true }],
  cardCategories: [{ card_id: HT, category_id: 'ht' }, { card_id: SIDE_HT, category_id: 'ht' }],
  profiles: [{ card_id: HT, availability: 'flexible', group_id: null }, { card_id: SIDE_HT, availability: 'early', group_id: null }], groups: [],
};
const configuration = parseConfiguration({
  version: 2, name: 'Deck', notes: null, params: {}, pairs: [], conditions: [], deadFirst: [], deadSecond: [],
  cards: [{ card_id: STARTER, zone: 'main', copies: 3 }, { card_id: 2, zone: 'main', copies: 1 }, { card_id: HT, zone: 'main', copies: 3 }, ...FILLERS.map((card_id) => ({ card_id, zone: 'main', copies: 3 })),
    { card_id: EXTRA, zone: 'extra', copies: 2 },
    { card_id: SIDE_STARTER, zone: 'side', copies: 1 }, { card_id: SIDE_HT, zone: 'side', copies: 3 }, { card_id: SIDE_NEUTRAL, zone: 'side', copies: 2 }, { card_id: SIDE_EXTRA, zone: 'side', copies: 1 }],
  starters: [STARTER, SIDE_STARTER],
  matchups: [{ id: M, name: 'Kewl Tune', sort_index: 0, plans: [{ position: 'first', note: null, outgoing: [{ card_id: 10, copies: 1 }], incoming: [{ card_id: SIDE_HT, copies: 1 }] }] }],
});
const state = { ...stateFromConfiguration(configuration), ...libraryState(library) };
const plan: SidePlan = state.matchups[0].plans[0];
const sel = (outgoing: Array<[number, number]>, incoming: Array<[number, number]>): Selection =>
  ({ outgoing: outgoing.map(([card_id, copies]) => ({ card_id, copies })), incoming: incoming.map(([card_id, copies]) => ({ card_id, copies })) });

describe('previewOf (S3)', () => {
  it('sélection vide : rien ; déséquilibrée : pas d’aperçu, raison dite', () => {
    expect(previewOf(state, plan, EMPTY_SELECTION, zoneOf, name)).toEqual({ kind: 'none' });
    expect(previewOf(state, plan, sel([[11, 2]], [[SIDE_HT, 1]]), zoneOf, name)).toEqual({ kind: 'unbalanced', reason: 'Échange refusé : 2 copies sortantes pour 1 entrante — il en faut autant de chaque côté.' });
    expect(previewOf(state, plan, sel([[11, 1]], [[SIDE_EXTRA, 1]]), zoneOf, name)).toMatchObject({ kind: 'unbalanced' });
  });

  it('équilibrée : l’aperçu est exactement le plan que donnerait « Échanger »', () => {
    const selection = sel([[11, 1], [EXTRA, 1]], [[SIDE_NEUTRAL, 1], [SIDE_EXTRA, 1]]);
    const preview = previewOf(state, plan, selection, zoneOf, name);
    expect(preview.kind).toBe('ready');
    if (preview.kind !== 'ready') return;
    const committed = swapInPlan(state.matchups, M, 'first', state, zoneOf, selection, name);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(preview.plan).toEqual(committed.matchups[0].plans[0]);
    expect(preview.applied).toEqual(applyPlan(state, preview.plan, zoneOf));
    expect(preview.affectsEngine).toBe(true);
    expect(shownPlan(plan, preview)).toBe(preview.plan);
    expect(zonesTouched(selection, zoneOf)).toEqual(['main', 'extra']);
  });

  it('une sélection d’Extra seule est prête mais sans effet sur les chiffres (S7)', () => {
    const preview = previewOf(state, plan, sel([[EXTRA, 1]], [[SIDE_EXTRA, 1]]), zoneOf, name);
    expect(preview).toMatchObject({ kind: 'ready', affectsEngine: false });
    if (preview.kind !== 'ready') return;
    expect(buildEngineModel(sidedSource(state, preview.applied)!).input).toEqual(buildEngineModel(sidedSource(state, applyPlan(state, plan, zoneOf))!).input);
  });

  it('un échange que « Échanger » refuserait n’a pas d’aperçu (zone inconnue, écart créé)', () => {
    const unknown = { ...state, side: [...state.side, { cardId: 999, zone: 'side' as const, copies: 1 }] };
    expect(previewOf(unknown, plan, sel([[11, 1]], [[999, 1]]), zoneOf, name)).toMatchObject({ kind: 'refused', reason: expect.stringMatching(/zone inconnue/) });
    // Une 4e copie de SIDE_HT dans le side n'existe pas : écart créé.
    expect(previewOf(state, plan, sel([[11, 3]], [[SIDE_HT, 3]]), zoneOf, name)).toMatchObject({ kind: 'refused', reason: 'Échange refusé — #31 : 4 copies à faire entrer, 3 en side.' });
    // Même carte des deux côtés du plan.
    expect(previewOf(state, plan, sel([[SIDE_HT, 1]], [[SIDE_NEUTRAL, 1]]), zoneOf, name)).toMatchObject({ kind: 'refused' });
    expect(shownPlan(plan, { kind: 'none' })).toBe(plan);
  });

  it('sur un plan qui n’est pas prêt, un échange acceptable n’est pas un aperçu « prêt » : pas de deck sans source', () => {
    const incomplete: SidePlan = { ...plan, outgoing: [{ card_id: 10, copies: 2 }], incoming: [{ card_id: SIDE_HT, copies: 1 }] };
    const preview = previewOf(state, incomplete, sel([[11, 1]], [[SIDE_NEUTRAL, 1]]), zoneOf, name);
    expect(preview.kind).toBe('not-ready');
    if (preview.kind !== 'not-ready') return;
    expect(preview.applied).toMatchObject({ status: 'incomplete', main: null });
    const review: SidePlan = { ...plan, outgoing: [{ card_id: 99, copies: 1 }] };
    expect(previewOf(state, review, sel([[11, 1]], [[SIDE_NEUTRAL, 1]]), zoneOf, name)).toMatchObject({ kind: 'not-ready', applied: { status: 'review', main: null } });
    expect(shownPlan(plan, preview)).toBe(plan);
  });
});

describe('candidatesOf (S4)', () => {
  it('une sortante de plus : chaque carte du side de type main encore libre, avec le deck de cet échange', () => {
    const r = candidatesOf(state, plan, sel([[11, 1]], []), zoneOf, name)!;
    expect(r.direction).toBe('incoming');
    // SIDE_STARTER (1 libre), SIDE_HT (3 − 1 engagée = 2 libres), SIDE_NEUTRAL (2) ; SIDE_EXTRA exclue (Extra).
    expect(r.candidates.map((c) => c.cardId)).toEqual([SIDE_STARTER, SIDE_HT, SIDE_NEUTRAL]);
    for (const c of r.candidates) {
      expect(c.applied.status).toBe('ready');
      expect(c.plan.incoming.find((x) => x.card_id === c.cardId)!.copies).toBe(c.cardId === SIDE_HT ? 2 : 1);
      expect(c.plan.outgoing).toEqual([{ card_id: 10, copies: 1 }, { card_id: 11, copies: 1 }]);
    }
  });

  it('une entrante de plus : chaque carte du main encore libre ; une copie déjà toute engagée n’est pas candidate', () => {
    const r = candidatesOf(state, plan, sel([], [[SIDE_NEUTRAL, 1]]), zoneOf, name)!;
    expect(r.direction).toBe('outgoing');
    expect(r.candidates.map((c) => c.cardId)).toEqual([STARTER, 2, HT, ...FILLERS]);
    // Une carte déjà sortie en totalité ne l'est plus : le plan sort les 3 copies de 10.
    const full: SidePlan = { ...plan, outgoing: [{ card_id: 10, copies: 3 }], incoming: [{ card_id: SIDE_HT, copies: 3 }] };
    expect(candidatesOf(state, full, sel([], [[SIDE_NEUTRAL, 1]]), zoneOf, name)!.candidates.map((c) => c.cardId)).not.toContain(10);
    // SIDE_HT ne peut plus entrer : ses 3 copies sont engagées.
    expect(candidatesOf(state, full, sel([[11, 1]], []), zoneOf, name)!.candidates.map((c) => c.cardId)).toEqual([SIDE_STARTER, SIDE_NEUTRAL]);
  });

  it('pas de candidats à zéro, à deux copies d’écart, ou avec une zone inconnue ; l’Extra ne compte pas dans l’écart', () => {
    expect(candidatesOf(state, plan, EMPTY_SELECTION, zoneOf, name)).toBeNull();
    expect(candidatesOf(state, plan, sel([[11, 2]], []), zoneOf, name)).toBeNull();
    expect(candidatesOf(state, plan, sel([[11, 1]], [[SIDE_NEUTRAL, 1]]), zoneOf, name)).toBeNull();
    const withExtraOut = candidatesOf(state, plan, sel([[11, 1], [EXTRA, 1]], []), zoneOf, name)!;
    expect(withExtraOut.direction).toBe('incoming');
    // La partie Extra de la sélection est laissée de côté (S7) : les candidats du main restent ceux du main,
    // jamais une carte d'Extra, et leur plan ne porte pas la sortante d'Extra encore déséquilibrée.
    expect(withExtraOut.candidates.map((c) => c.cardId)).toEqual([SIDE_STARTER, SIDE_HT, SIDE_NEUTRAL]);
    expect(withExtraOut.candidates[0].plan.outgoing).toEqual([{ card_id: 10, copies: 1 }, { card_id: 11, copies: 1 }]);
    const unknown = { ...state, side: [...state.side, { cardId: 999, zone: 'side' as const, copies: 1 }] };
    expect(candidatesOf(unknown, plan, sel([[11, 1]], [[999, 1]]), zoneOf, name)).toBeNull();
  });

  it('entrées dédoublonnées : deux cartes neutres donnent une seule entrée ; l’écart est mesuré contre le plan', () => {
    const r = candidatesOf(state, plan, sel([], [[SIDE_NEUTRAL, 1]]), zoneOf, name)!;
    const { byCard, inputs } = candidateInputs(state, r.candidates);
    expect(byCard.size).toBe(r.candidates.length);
    // Sortir un filler ou un autre : même entrée du moteur (11 fillers → 1 entrée) ; starter, 2, HT : trois autres.
    expect(inputs.size).toBe(3);
    expect(byCard.get(10)).toBe(byCard.get(20));
    expect(byCard.get(2)).toBe(byCard.get(10)); // la carte 2 (×1) n'est pas annotée : même entrée qu'un filler
    expect(byCard.get(STARTER)).not.toBe(byCard.get(10));
    const planInput = buildEngineModel(sidedSource(state, applyPlan(state, plan, zoneOf))!).input;
    const planIx = planIndicators(computePass(planInput, 'first'), 'first')!;
    const starterOut = planIndicators(computePass(inputs.get(byCard.get(STARTER)!)!, 'first'), 'first')!;
    const fillerOut = planIndicators(computePass(inputs.get(byCard.get(10)!)!, 'first'), 'first')!;
    expect(candidateDelta(starterOut, planIx, 'startOne')).toBeLessThan(0); // sortir un starter coûte des départs
    expect(candidateDelta(fillerOut, planIx, 'startOne')).toBe(0); // un neutre contre un neutre : même entrée du moteur, écart exactement nul
    expect(candidateDelta(fillerOut, planIx, 'strongHand')).toBe(fillerOut.strongHand - planIx.strongHand);
    expect(estimateCandidatesMs(inputs.size, 400)).toBe(1200);
    expect(estimateCandidatesMs(19, 500)).toBeGreaterThan(CANDIDATES_AUTO_MS);
  });
});

describe('sélection', () => {
  it('copies libres = copies − engagées dans le plan − sélectionnées', () => {
    const free = freeCopies(state.side, plan.incoming, sel([], [[SIDE_HT, 1]]).incoming);
    expect([free.get(SIDE_HT), free.get(SIDE_NEUTRAL), free.get(SIDE_STARTER)]).toEqual([1, 2, 1]);
  });

  it('un clic ajoute une copie jusqu’aux copies libres, un clic droit en retire une jusqu’à zéro', () => {
    let s = adjustSelection(EMPTY_SELECTION, 'incoming', SIDE_NEUTRAL, 1, 2);
    expect(s.incoming).toEqual([{ card_id: SIDE_NEUTRAL, copies: 1 }]);
    s = adjustSelection(s, 'incoming', SIDE_NEUTRAL, 1, 2);
    expect(adjustSelection(s, 'incoming', SIDE_NEUTRAL, 1, 2)).toBe(s); // au maximum : inchangé
    s = adjustSelection(s, 'incoming', SIDE_NEUTRAL, -1, 2);
    s = adjustSelection(s, 'incoming', SIDE_NEUTRAL, -1, 2);
    expect(s.incoming).toEqual([]);
    expect(adjustSelection(s, 'incoming', SIDE_NEUTRAL, -1, 2)).toBe(s);
    expect(adjustSelection(EMPTY_SELECTION, 'outgoing', 10, 1, 0)).toBe(EMPTY_SELECTION); // aucune copie libre
  });
});

// La liste d'adversaires du store et `swapInPlan` partagent la règle de l'aperçu : garde croisée.
describe('règle unique de l’échange', () => {
  it('ce que l’aperçu refuse, « Échanger » le refuse avec la même raison', () => {
    const list: Matchup[] = state.matchups;
    for (const selection of [sel([[11, 2]], [[SIDE_HT, 1]]), sel([[11, 3]], [[SIDE_HT, 3]]), sel([[SIDE_HT, 1]], [[SIDE_NEUTRAL, 1]])]) {
      const preview = previewOf(state, plan, selection, zoneOf, name);
      const r = swapInPlan(list, M, 'first', state, zoneOf, selection, name);
      expect(r.ok).toBe(false);
      if (preview.kind === 'unbalanced' || preview.kind === 'refused') expect(!r.ok && r.reason).toBe(preview.reason);
      else throw new Error('aperçu attendu refusé');
    }
  });
});
