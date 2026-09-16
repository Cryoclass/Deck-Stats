// Audit 05 — coût du moteur du dépôt (copie identique) sur des decks annotés réalistes.
// Mesure computeAll (éditeur), deux passes (comparateur) et passe premier (accueil).
import { computeAll, computePass } from './src/engine/index.js';
import type { EngineInput, EngineType } from './src/engine/types.js';

function deck(opts: { deckSize: number; starters: number[]; extenders: number[]; pairs: number; handtraps: number[]; group: boolean; conditions: number }): EngineInput {
  const types: EngineType[] = [];
  for (const c of opts.starters) types.push({ copies: c, isHopt: true, isStarter: true, categories: [] });
  for (const c of opts.extenders) types.push({ copies: c, isHopt: false, isStarter: false, categories: [] });
  const htStart = types.length;
  opts.handtraps.forEach((c, i) => types.push({ copies: c, isHopt: i % 2 === 0, isStarter: false, categories: [i % 3 === 0 ? 1 : 0], availability: (['flexible', 'early', 'prepared', 'breaker'] as const)[i % 4], ...(opts.group && i % 4 === 1 ? { group: 0 } : {}) }));
  const nS = opts.starters.length;
  const edges: Array<[number, number]> = [];
  for (let e = 0; e < opts.pairs; e++) edges.push([nS + (e % opts.extenders.length), nS + ((e + 1) % opts.extenders.length)]);
  for (let s = 0; s < opts.conditions && s < nS; s++) types[s].starterCondition = { kind: 'or', any: [{ kind: 'remaining', type: nS + s, atLeast: 1 }, { kind: 'remaining', type: nS + s + 1, atLeast: 1 }] };
  const annotated = types.reduce((n, t) => n + t.copies, 0);
  if (annotated > opts.deckSize) throw new Error('trop de copies annotées');
  void htStart;
  return { deckSize: opts.deckSize, types, edges, categories: [{ id: 'h' }, { id: 'b' }], groups: opts.group ? [{ id: 'g', capPerTurn: 2 }] : [] };
}

const cases: Array<[string, EngineInput]> = [
  ['compétitif 40 : 6 starters (3/3/3/2/1/1), 6 pièces, 8 paires, 6 handtraps profilés, plafond, 4 conditions', deck({ deckSize: 40, starters: [3, 3, 3, 2, 1, 1], extenders: [3, 2, 1, 1, 1, 1], pairs: 8, handtraps: [3, 3, 3, 2, 1, 1], group: true, conditions: 4 })],
  ['« tout annoter » 40 : 12 starters à 1 copie, 10 pièces à 1 copie, 12 paires, 6 handtraps', deck({ deckSize: 40, starters: Array(12).fill(1), extenders: Array(10).fill(1), pairs: 12, handtraps: [3, 3, 3, 2, 1, 1], group: true, conditions: 4 })],
  ['60 cartes : 8 starters, 8 pièces, 12 paires, 8 handtraps', deck({ deckSize: 60, starters: [3, 3, 3, 2, 2, 2, 1, 1], extenders: [3, 3, 2, 2, 1, 1, 1, 1], pairs: 12, handtraps: [3, 3, 3, 3, 2, 2, 1, 1], group: true, conditions: 4 })],
];

const time = (fn: () => unknown): number => { const t0 = performance.now(); fn(); return Math.round(performance.now() - t0); };
for (const [label, input] of cases) {
  computePass(input, 'first'); // chauffe JIT
  const types = input.types.length;
  const copies = input.types.reduce((n, t) => n + t.copies, 0);
  const all = time(() => computeAll(input));
  const passes = time(() => { computePass(input, 'first'); computePass(input, 'second'); });
  const first = time(() => computePass(input, 'first'));
  console.log(JSON.stringify({ deck: label, typesSuivis: types, copiesAnnotees: copies, computeAll_ms: all, deuxPasses_ms: passes, passePremier_ms: first }));
}
