import { describe, expect, it } from 'vitest';
import { computePass } from '../engine/enumerate.js';
import { queryProbability, type QueryCriterion } from '../engine/query.js';
import { notComputedPass } from '../worker/computeClient.js';
import { buildEngineModel } from './engineModel.js';
import { libraryState, stateFromConfiguration } from './deckConfiguration.js';
import { parseConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import {
  applyPlan,
  indicatorCriteria,
  planComputeMode,
  planFingerprint,
  planIndicators,
  planSummaryFromPass,
  sidedSource,
  usablePlanSummary,
} from './sidePlan.js';
import type { Library, SidePlan } from '../types.js';

// ─── Étape 10B : le deck sidé est un deck comme un autre (R6), ses chiffres sont ceux du mode
// Requête (R8), calculés dans le contexte de sa position (R7), jamais affichés périmés (R9). ───

const STARTER = 1; // ×3, starter conditionné : il faut qu'il reste TARGET ≥ 1
const TARGET = 2; // ×1
const HT = 3; // ×3, étiquette ht, profil flexible
const FILLERS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]; // ×3, cartes neutres
const SIDE_STARTER = 30; // ×2 en side, annotée starter DANS le side (R6)
const SIDE_HT = 31; // ×3 en side, étiquette ht, profil précoce

const library: Library = {
  hoptCardIds: [],
  categories: [{ id: 'ht', name: 'Handtrap', is_builtin: true }],
  cardCategories: [{ card_id: HT, category_id: 'ht' }, { card_id: SIDE_HT, category_id: 'ht' }],
  profiles: [{ card_id: HT, availability: 'flexible', group_id: null }, { card_id: SIDE_HT, availability: 'early', group_id: null }],
  groups: [],
};

type Main = Array<[number, number]>;
const BASE: Main = [[STARTER, 3], [TARGET, 1], [HT, 3], ...FILLERS.map((id): [number, number] => [id, 3])];

function configuration(main: Main) {
  return parseConfiguration({
    version: 2, name: 'Side',
    cards: [
      ...main.map(([card_id, copies]) => ({ card_id, zone: 'main', copies })),
      { card_id: SIDE_STARTER, zone: 'side', copies: 2 },
      { card_id: SIDE_HT, zone: 'side', copies: 3 },
    ],
    starters: [STARTER, SIDE_STARTER],
    pairs: [],
    conditions: [{ id: '00000000-0000-4000-8000-000000000001', source_card_id: STARTER, source_pair_id: null, condition: { kind: 'remaining', card_id: TARGET, at_least: 1 } }],
    deadFirst: [], deadSecond: [], params: {}, notes: null,
  });
}
const source = (main: Main = BASE, lib: Library = library) => ({ ...stateFromConfiguration(configuration(main)), ...libraryState(lib) });

/** Plan second de référence : TARGET et deux neutres sortent, les deux SIDE_STARTER et un SIDE_HT entrent. */
const SECOND: SidePlan = {
  position: 'second', note: null,
  outgoing: [{ card_id: TARGET, copies: 1 }, { card_id: 10, copies: 2 }],
  incoming: [{ card_id: SIDE_STARTER, copies: 2 }, { card_id: SIDE_HT, copies: 1 }],
};
/** Le même main, édité à la main : TARGET retiré, un seul exemplaire de 10, entrées ajoutées à la fin. */
const EDITED_BY_HAND: Main = [[STARTER, 3], [HT, 3], [10, 1], ...FILLERS.slice(1).map((id): [number, number] => [id, 3]), [SIDE_STARTER, 2], [SIDE_HT, 1]];

/** Critère tel que le mode Requête le construit (`QueryMode`, bouton « + critère »). */
const asQueryMode = (subject: 'starts' | 'nonengine', min: number): QueryCriterion =>
  ({ id: Math.random().toString(36).slice(2), subject: subject === 'starts' ? { kind: 'starts' } : { kind: 'nonengine' }, min, max: null });

const sidedInput = (plan: SidePlan = SECOND, lib: Library = library) => {
  const src = source(BASE, lib);
  return buildEngineModel(sidedSource(src, applyPlan(src.main, src.side, plan))!).input;
};

describe('applyPlan', () => {
  const src = source();

  it('rend le main dérivé d’un plan équilibré, dans l’ordre d’une édition à la main', () => {
    const applied = applyPlan(src.main, src.side, SECOND);
    expect(applied).toMatchObject({ status: 'ready', issues: [], outgoing: 3, incoming: 3, mainSize: 40 });
    expect(applied.main).toEqual(stateFromConfiguration(configuration(EDITED_BY_HAND)).main);
  });

  it('un plan vide est prêt et rend le main du deck tel quel', () => {
    const applied = applyPlan(src.main, src.side, { position: 'first', note: null, outgoing: [], incoming: [] });
    expect(applied.status).toBe('ready');
    expect(applied.main).toEqual(src.main);
  });

  it('un plan déséquilibré est « incomplet » : taille donnée, aucun main, donc jamais analysé (R4)', () => {
    const applied = applyPlan(src.main, src.side, { ...SECOND, incoming: [{ card_id: SIDE_STARTER, copies: 1 }] });
    expect(applied).toMatchObject({ status: 'incomplete', issues: [], outgoing: 3, incoming: 1, mainSize: 38, main: null });
  });

  it('une carte qui a quitté sa zone met le plan « à revoir » et nomme la carte, même équilibré (R1, R5)', () => {
    const absent = applyPlan(src.main, src.side, { ...SECOND, outgoing: [{ card_id: 99, copies: 1 }, { card_id: 10, copies: 2 }] });
    expect(absent).toMatchObject({ status: 'review', main: null });
    expect(absent.issues).toEqual([{ kind: 'outgoing-missing', cardId: 99, wanted: 1, available: 0 }]);
    const tooMany = applyPlan(src.main, src.side, { ...SECOND, outgoing: [{ card_id: 10, copies: 3 }], incoming: [{ card_id: SIDE_STARTER, copies: 3 }] });
    expect(tooMany.issues).toEqual([{ kind: 'incoming-missing', cardId: SIDE_STARTER, wanted: 3, available: 2 }]);
    // « À revoir » l'emporte sur « incomplet » : c'est la cohérence qu'il faut rétablir d'abord.
    expect(applyPlan(src.main, src.side, { ...SECOND, outgoing: [{ card_id: 99, copies: 2 }] }).status).toBe('review');
  });

  it('une entrée qui porterait une carte à 4 exemplaires dans le main met le plan « à revoir » (R3)', () => {
    const side = [...src.side, { cardId: HT, zone: 'side' as const, copies: 1 }]; // même carte en main ET en side (9C)
    const applied = applyPlan(src.main, side, { position: 'second', note: null, outgoing: [{ card_id: 10, copies: 1 }], incoming: [{ card_id: HT, copies: 1 }] });
    expect(applied).toMatchObject({ status: 'review', main: null, issues: [{ kind: 'over-limit', cardId: HT, copies: 4 }] });
  });
});

describe('le deck sidé est un deck comme un autre (R6)', () => {
  it('même modèle moteur que le main édité à la main, avec toutes les annotations du deck', () => {
    const src = source();
    const model = buildEngineModel(sidedSource(src, applyPlan(src.main, src.side, SECOND))!);
    expect(model).toEqual(buildEngineModel(source(EDITED_BY_HAND)));
    // La carte annotée starter pendant qu'elle était dans le side devient un starter en entrant.
    expect(buildEngineModel(src).typeCardIds).not.toContain(SIDE_STARTER);
    expect(model.input.types[model.typeCardIds.indexOf(SIDE_STARTER)].isStarter).toBe(true);
    // La condition de STARTER exige TARGET, qui sort : feuille hors modèle, donc fausse (evaluate.ts).
    expect(model.input.types[model.typeCardIds.indexOf(STARTER)].starterCondition).toEqual({ kind: 'remaining', type: null, atLeast: 1 });
  });

  it('un plan qui n’est pas prêt n’a pas de source de modèle', () => {
    const src = source();
    expect(sidedSource(src, applyPlan(src.main, src.side, { ...SECOND, incoming: [] }))).toBeNull();
  });
});

describe('les trois indicateurs sont ceux du mode Requête (R8), dans le contexte du plan (R7)', () => {
  for (const position of ['first', 'second'] as const) {
    it(`plan ${position} : égalité stricte avec les critères du mode Requête`, () => {
      const input = sidedInput({ ...SECOND, position });
      const pass = computePass(input, position);
      const indicators = planIndicators(pass, position)!;
      expect(indicators.startOne).toBe(queryProbability(pass, [asQueryMode('starts', 1)]));
      expect(indicators.nonEngineTwo).toBe(queryProbability(pass, [asQueryMode('nonengine', 2)]));
      expect(indicators.strongHand).toBe(queryProbability(pass, [asQueryMode('starts', 2), asQueryMode('nonengine', position === 'first' ? 1 : 2)]));
      expect(indicators.strongHand).toBeLessThan(indicators.startOne);
      expect(indicators.strongHand).toBeGreaterThan(0);
    });
  }

  it('la « main forte » n’a pas la même définition en premier et en second', () => {
    const pass = computePass(sidedInput(), 'second');
    const firstDefinition = queryProbability(pass, [asQueryMode('starts', 2), asQueryMode('nonengine', 1)])!;
    expect(planIndicators(pass, 'second')!.strongHand).toBeLessThan(firstDefinition);
  });

  it('refuse la passe de l’autre position et choisit le mode de calcul minimal', () => {
    const input = sidedInput();
    expect(() => planIndicators(computePass(input, 'first'), 'second')).toThrow(/R7/);
    expect(planComputeMode('first')).toBe('first');
    expect(planComputeMode('second')).toBe('passes');
  });
});

describe('cache des chiffres d’un plan : jamais affiché périmé (R9)', () => {
  const NOW = new Date('2026-09-11T10:00:00Z');
  const input = sidedInput();
  const pass = computePass(input, 'second');
  const summary = planSummaryFromPass(pass, input, 'second', 'v1', NOW)!;

  it('porte exactement les indicateurs, la taille du main après échange et l’empreinte', () => {
    expect(summary).toEqual({ engineVersion: 'v1', fingerprint: planFingerprint(input, 'second', 'v1'), mainSize: 40, ...planIndicators(pass, 'second')!, computedAt: NOW.toISOString() });
    expect(summary.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(planSummaryFromPass(notComputedPass('second', 40), input, 'second', 'v1', NOW)).toBeNull();
  });

  it('affichable pour le même deck sidé, y compris après un aller-retour JSON (jsonb)', () => {
    expect(usablePlanSummary(summary, input, 'second', 'v1')).toEqual(summary);
    expect(usablePlanSummary(JSON.parse(JSON.stringify(summary)), sidedInput(), 'second', 'v1')).toEqual(summary);
  });

  it('périmé dès que le moteur, la position, le deck sidé ou la bibliothèque changent', () => {
    expect(usablePlanSummary(summary, input, 'second', 'v2')).toBeNull();
    expect(usablePlanSummary(summary, input, 'first', 'v1')).toBeNull();
    const otherPlan = sidedInput({ ...SECOND, incoming: [{ card_id: SIDE_STARTER, copies: 1 }, { card_id: SIDE_HT, copies: 2 }] });
    expect(usablePlanSummary(summary, otherPlan, 'second', 'v1')).toBeNull();
    const flexible: Library = { ...library, profiles: library.profiles.map((p) => (p.card_id === SIDE_HT ? { ...p, availability: 'flexible' as const } : p)) };
    expect(usablePlanSummary(summary, sidedInput(SECOND, flexible), 'second', 'v1')).toBeNull();
  });

  it('une nouvelle définition des indicateurs change l’empreinte à elle seule', () => {
    const redefined = { ...indicatorCriteria('second'), startOne: [asQueryMode('starts', 2)] };
    expect(planFingerprint(input, 'second', 'v1', redefined)).not.toBe(summary.fingerprint);
  });

  it('échanger une carte neutre contre une autre ne périme rien : le moteur ne les distingue pas', () => {
    const neutralSwap = sidedInput({ ...SECOND, outgoing: [{ card_id: TARGET, copies: 1 }, { card_id: 11, copies: 2 }] });
    expect(neutralSwap).toEqual(input);
    expect(usablePlanSummary(summary, neutralSwap, 'second', 'v1')).toEqual(summary);
  });

  it('refuse une forme altérée, même avec la bonne empreinte', () => {
    for (const bad of [null, [], 'x', { ...summary, mainSize: 41 }, { ...summary, startOne: 2 }, { ...summary, strongHand: NaN }, { ...summary, computedAt: 12 }]) {
      expect(usablePlanSummary(bad, input, 'second', 'v1')).toBeNull();
    }
    const { strongHand: _omitted, ...incomplete } = summary;
    expect(usablePlanSummary(incomplete, input, 'second', 'v1')).toBeNull();
  });
});
