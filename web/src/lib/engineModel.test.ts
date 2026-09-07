import { describe, expect, it } from 'vitest';
import { buildEngineModel, type EngineModelSource } from './engineModel.js';
import { computePass } from '../engine/enumerate.js';
import { prepare, evaluate } from '../engine/evaluate.js';
import { addClause, addToGroup, leaf, leavesOf, removeAt, removeLeavesOfCard, setAtLeast, toEngineCondition, wrapOr, describeCondition } from './conditions.js';
import type { ConditionNode } from '../types.js';

// ─── Étape 5B — constructeur de modèle : profils, plafonds, conditions ET/OU, cartes sans profil ───

function source(over: Partial<EngineModelSource> = {}): EngineModelSource {
  return {
    main: [
      { cardId: 1, zone: 'main', copies: 3 }, // Ash : étiquette h, flexible, HOPT
      { cardId: 2, zone: 'main', copies: 3 }, // Fuwalos : étiquette m, précoce, plafond mulcharmy
      { cardId: 3, zone: 'main', copies: 2 }, // Purulia : étiquette m, précoce, plafond mulcharmy
      { cardId: 4, zone: 'main', copies: 3 }, // étiquetée h, SANS profil (Q5)
      { cardId: 5, zone: 'main', copies: 3 }, // starter conditionnel
      { cardId: 6, zone: 'main', copies: 1 }, // cible de condition
      { cardId: 7, zone: 'main', copies: 1 }, // cible de condition
      { cardId: 8, zone: 'main', copies: 24 - 16 },
    ],
    hopt: new Set([1]),
    profiles: new Map([
      [1, { availability: 'flexible', groupId: null }],
      [2, { availability: 'early', groupId: 'g' }],
      [3, { availability: 'early', groupId: 'g' }],
      [9, { availability: 'breaker', groupId: null }], // carte absente du deck : ignorée
    ]),
    groups: [{ id: 'g', name: 'Mulcharmy', cap_per_turn: 2 }],
    categories: [{ id: 'h', name: 'Handtrap', is_builtin: true }, { id: 'm', name: 'Mulcharmy', is_builtin: false }],
    cardCategories: new Map([[1, new Set(['h'])], [2, new Set(['m'])], [3, new Set(['m'])], [4, new Set(['h'])]]),
    deadFirst: new Set(),
    deadSecond: new Set(),
    pairs: [],
    starters: new Set([5]),
    pairExclusions: new Set(),
    startConditions: [
      { id: 'c1', sourceCardId: 5, sourcePairId: null, condition: { kind: 'and', all: [leaf(6), { kind: 'or', any: [leaf(7), leaf(6, 1)] }] } },
    ],
    ...over,
  };
}

describe('buildEngineModel — profils, plafonds et conditions depuis la bibliothèque et le deck', () => {
  it('pose availability, group, groups et starterCondition ; aucun horizon, aucune pertinence', () => {
    const model = buildEngineModel(source());
    const type = (cardId: number) => model.input.types[model.typeCardIds.indexOf(cardId)];
    expect(type(1)).toMatchObject({ copies: 3, isHopt: true, availability: 'flexible', categories: [0] });
    expect(type(1).group).toBeUndefined();
    expect(type(2)).toMatchObject({ availability: 'early', group: 0, categories: [1] });
    expect(type(3)).toMatchObject({ availability: 'early', group: 0 });
    expect(model.input.groups).toEqual([{ id: 'g', capPerTurn: 2 }]);
    expect(model.groupIds).toEqual(['g']);
    expect(model.input.categories).toEqual([{ id: 'h' }, { id: 'm' }]);
    expect(model.input).not.toHaveProperty('horizonFirst');
    // Starter conditionnel : cartes cibles promues en types suivis, index traduits.
    const t6 = model.typeCardIds.indexOf(6);
    const t7 = model.typeCardIds.indexOf(7);
    expect(t6).toBeGreaterThanOrEqual(0);
    expect(type(5).starterCondition).toEqual({ kind: 'and', all: [{ kind: 'remaining', type: t6, atLeast: 1 }, { kind: 'or', any: [{ kind: 'remaining', type: t7, atLeast: 1 }, { kind: 'remaining', type: t6, atLeast: 1 }] }] });
    expect(type(5)).not.toHaveProperty('starterPrereqs');
    // La carte 8 n'est pas annotée : filler.
    expect(model.typeCardIds).not.toContain(8);
    expect(model.input.deckSize).toBe(24);
  });

  it('Q5 : une carte étiquetée sans profil est transmise sans profil, listée, et compte zéro', () => {
    const model = buildEngineModel(source());
    expect(model.unprofiledCardIds).toEqual([4]);
    const t4 = model.typeCardIds.indexOf(4);
    expect(model.input.types[t4].availability).toBeUndefined();
    const prep = prepare(model.input);
    const k = new Array(model.input.types.length).fill(0);
    k[t4] = 2;
    const out = evaluate(prep, 'second', k, -1);
    expect(out.ne).toBe(0);
    expect(out.catCounts).toEqual([2, 0]); // copies brutes de l'étiquette h
    // Une fois profilée, elle compte.
    const profiled = buildEngineModel(source({ profiles: new Map([...source().profiles, [4, { availability: 'flexible', groupId: null }]]) }));
    expect(profiled.unprofiledCardIds).toEqual([]);
    expect(evaluate(prepare(profiled.input), 'second', k, -1).ne).toBe(2);
  });

  it('un plafond supprimé de la bibliothèque est ignoré ; le profil reste', () => {
    const model = buildEngineModel(source({ groups: [] }));
    expect(model.input.groups).toBeUndefined();
    expect(model.groupIds).toEqual([]);
    expect(model.input.types[model.typeCardIds.indexOf(2)]).toMatchObject({ availability: 'early' });
    expect(model.input.types[model.typeCardIds.indexOf(2)].group).toBeUndefined();
    expect(computePass(model.input, 'second').total).toBeGreaterThan(0);
  });

  it('une condition de paire suit son arête ; une condition sur une carte non starter reste hors du modèle', () => {
    const s = source({
      pairs: [{ id: 'p', card_a_id: 6, card_b_id: 7 }],
      startConditions: [
        { id: 'c1', sourceCardId: 4, sourcePairId: null, condition: { kind: 'and', all: [leaf(6)] } },
        { id: 'c2', sourceCardId: null, sourcePairId: 'p', condition: { kind: 'and', all: [leaf(1, 2)] } },
      ],
    });
    const model = buildEngineModel(s);
    expect(model.input.edges).toHaveLength(1);
    expect(model.input.edgeConditions).toEqual([{ kind: 'and', all: [{ kind: 'remaining', type: model.typeCardIds.indexOf(1), atLeast: 2 }] }]);
    expect(model.input.types[model.typeCardIds.indexOf(4)].starterCondition).toBeUndefined();
    // Cible absente du deck : feuille jamais satisfaite (type null), jamais une exception.
    const absent = buildEngineModel(source({ startConditions: [{ id: 'c', sourceCardId: 5, sourcePairId: null, condition: { kind: 'and', all: [leaf(99)] } }] }));
    expect(absent.input.types[absent.typeCardIds.indexOf(5)].starterCondition).toEqual({ kind: 'and', all: [{ kind: 'remaining', type: null, atLeast: 1 }] });
    expect(computePass(absent.input, 'first').brick).toBe(1);
  });
});

describe('conditions — opérations pures sur l’arbre ET/OU', () => {
  const tree: ConditionNode = { kind: 'and', all: [leaf(1), { kind: 'or', any: [leaf(2), leaf(3, 2)] }] };
  const name = (id: number) => `C${id}`;

  it('lit et décrit l’arbre', () => {
    expect(leavesOf(tree).map((l) => [l.leaf.card_id, l.path])).toEqual([[1, [0]], [2, [1, 0]], [3, [1, 1]]]);
    expect(describeCondition(tree, name)).toBe('C1 ET (C2 OU C3 ≥2)');
    expect(toEngineCondition(tree, (id) => (id === 3 ? undefined : id + 10))).toEqual({ kind: 'and', all: [{ kind: 'remaining', type: 11, atLeast: 1 }, { kind: 'or', any: [{ kind: 'remaining', type: 12, atLeast: 1 }, { kind: 'remaining', type: null, atLeast: 2 }] }] });
  });

  it('ajoute une clause ET, une alternative OU, un membre de groupe, règle ≥ n', () => {
    expect(addClause(null, leaf(5))).toEqual({ kind: 'and', all: [leaf(5)] });
    expect(addClause(leaf(1), leaf(5))).toEqual({ kind: 'and', all: [leaf(1), leaf(5)] });
    expect(addClause(tree, leaf(5)).kind === 'and' && (addClause(tree, leaf(5)) as { all: unknown[] }).all).toHaveLength(3);
    expect(wrapOr(tree, [0], leaf(9))).toEqual({ kind: 'and', all: [{ kind: 'or', any: [leaf(1), leaf(9)] }, { kind: 'or', any: [leaf(2), leaf(3, 2)] }] });
    expect(wrapOr(tree, [1], leaf(9))).toEqual({ kind: 'and', all: [leaf(1), { kind: 'or', any: [leaf(2), leaf(3, 2), leaf(9)] }] });
    expect(addToGroup(tree, [1], leaf(9))).toEqual(wrapOr(tree, [1], leaf(9)));
    expect(setAtLeast(tree, [1, 0], 3)).toEqual({ kind: 'and', all: [leaf(1), { kind: 'or', any: [leaf(2, 3), leaf(3, 2)] }] });
    expect(setAtLeast(tree, [1, 0], 0)).toEqual({ kind: 'and', all: [leaf(1), { kind: 'or', any: [leaf(2, 1), leaf(3, 2)] }] }); // jamais < 1
  });

  it('retire sans jamais laisser un groupe vide ; racine vidée = source inconditionnelle', () => {
    expect(removeAt(tree, [1, 0])).toEqual({ kind: 'and', all: [leaf(1), leaf(3, 2)] }); // OU singleton aplati
    expect(removeAt(removeAt(tree, [1, 0])!, [1])).toEqual({ kind: 'and', all: [leaf(1)] });
    expect(removeAt({ kind: 'and', all: [leaf(1)] }, [0])).toBeNull();
    expect(removeLeavesOfCard(tree, 1)).toEqual({ kind: 'and', all: [{ kind: 'or', any: [leaf(2), leaf(3, 2)] }] });
    expect(removeLeavesOfCard({ kind: 'and', all: [leaf(1), { kind: 'or', any: [leaf(1), leaf(1, 2)] }] }, 1)).toBeNull();
    // Une racine qui n'est pas un ET est normalisée en ET après édition.
    expect(removeAt({ kind: 'or', any: [leaf(1), leaf(2), leaf(3)] }, [0])).toEqual({ kind: 'and', all: [{ kind: 'or', any: [leaf(2), leaf(3)] }] });
  });
});
