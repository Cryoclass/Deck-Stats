// Audit 05 — test différentiel aléatoire (copie du code, scratchpad) : chemin RÉEL de l'application
// (état de l'éditeur → buildEngineModel → moteur) contre l'oracle par énumération physique
// (engine/reference/deckOracle.ts). Les tests du dépôt comparent l'oracle au moteur via un
// adaptateur de test (toEngineInput), jamais via buildEngineModel.
import { buildEngineModel, type EngineModelSource } from './src/lib/engineModel.js';
import { computeAll, computePass } from './src/engine/index.js';
import { queryProbability, type QueryCriterion } from './src/engine/query.js';
import { enumerateExact, tally, potentialOf, withOneCopyReplaced, pairKey, type OracleSpec } from './src/engine/reference/deckOracle.js';
import { mulberry32 } from './src/engine/reference/monteCarlo.js';
import type { Condition, Profile } from './src/engine/reference/oracle.js';
import type { ConditionNode } from './src/types.js';

const SEED = Number(process.argv[2] ?? 20260915);
const RUNS = Number(process.argv[3] ?? 300);
const DELTA_EVERY = Number(process.argv[4] ?? 5);
const rnd = mulberry32(SEED);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const chance = (p: number) => rnd() < p;
const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const LABELS = ['h', 'm', 'q'];
const PROFILES: Profile[] = ['early', 'flexible', 'prepared', 'breaker'];
const cardId = (name: string) => (name === 'X' ? 999 : 1000 + name.charCodeAt(0));
const CTX = ['first', 'second'] as const;
const TOL = 1e-9;

function randomCondition(depth: number): Condition {
  if (depth >= 2 || chance(0.5)) return { card: chance(0.1) ? 'Z' : pick(NAMES), atLeast: chance(0.75) ? 1 : 2 };
  const children = [randomCondition(depth + 1), randomCondition(depth + 1)];
  return chance(0.5) ? { and: children } : { or: children };
}
function toNode(c: Condition): ConditionNode {
  if ('card' in c) return { kind: 'remaining', card_id: cardId(c.card), at_least: c.atLeast };
  if ('and' in c) return { kind: 'and', all: c.and.map(toNode) };
  return { kind: 'or', any: c.or.map(toNode) };
}

function randomCase(): { spec: OracleSpec; source: EngineModelSource } {
  const D = 7 + Math.floor(rnd() * 5); // 7..11 cartes physiques
  const deck: string[] = [];
  for (const name of NAMES) {
    if (deck.length >= D || chance(0.35)) continue;
    const copies = Math.min(1 + Math.floor(rnd() * 3), D - deck.length);
    for (let i = 0; i < copies; i++) deck.push(name);
  }
  while (deck.length < D) deck.push('X');
  const present = [...new Set(deck.filter((n) => n !== 'X'))];
  const sub = (p: number) => present.filter(() => chance(p));
  const starters = sub(0.35);
  const hopt = sub(0.35);
  const deadFirst = sub(0.12);
  const deadSecond = sub(0.12);
  const allPairs: Array<[string, string]> = [];
  for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) allPairs.push([present[i], present[j]]);
  const pairs = allPairs.filter(() => chance(0.25)).slice(0, 5);
  const excluded = new Set(pairs.filter(() => chance(0.2)).map(([a, b]) => pairKey(a, b)));
  const labels: Record<string, string[]> = {};
  const profiles: Record<string, Profile> = {};
  const groups: Record<string, string> = {};
  for (const name of present) {
    if (chance(0.45)) {
      labels[name] = LABELS.filter(() => chance(0.5));
      if (labels[name].length === 0) labels[name] = [pick(LABELS)];
      if (chance(0.85)) profiles[name] = pick(PROFILES); // sinon : étiquette sans profil (Q5)
      if (profiles[name] && chance(0.4)) groups[name] = 'g';
    } else if (chance(0.1)) {
      profiles[name] = pick(PROFILES); // profil sans étiquette (Q1)
    }
  }
  const groupCaps = { g: 1 + Math.floor(rnd() * 2) };
  const starterConditions: Record<string, Condition> = {};
  for (const s of starters) if (chance(0.4)) starterConditions[s] = randomCondition(0);
  const pairConditions: Record<string, Condition> = {};
  for (const [a, b] of pairs) if (chance(0.4)) pairConditions[pairKey(a, b)] = randomCondition(0);

  const activePairs = pairs.filter(([a, b]) => !excluded.has(pairKey(a, b)));
  const spec: OracleSpec = {
    deck, starters, hopt, pairs: activePairs, profiles, labels, groups, groupCaps, deadFirst, deadSecond,
    starterConditions, pairConditions: Object.fromEntries(Object.entries(pairConditions).filter(([k]) => !excluded.has(k))),
  };
  // Même deck, tel que l'éditeur le porte (DeckCard, bibliothèque du compte, annotations du deck).
  const counts = new Map<string, number>();
  for (const n of deck) counts.set(n, (counts.get(n) ?? 0) + 1);
  const pairId = (a: string, b: string) => `p-${pairKey(a, b)}`;
  const source: EngineModelSource = {
    main: [...counts].map(([n, c]) => ({ cardId: cardId(n), zone: 'main', copies: c })),
    hopt: new Set(hopt.map(cardId)),
    profiles: new Map(Object.entries(profiles).map(([n, p]) => [cardId(n), { availability: p, groupId: groups[n] ? 'g' : null }])),
    groups: [{ id: 'g', name: 'Plafond', cap_per_turn: groupCaps.g }],
    categories: LABELS.map((id) => ({ id, name: id, is_builtin: false })),
    cardCategories: new Map(Object.entries(labels).map(([n, ls]) => [cardId(n), new Set(ls)])),
    deadFirst: new Set(deadFirst.map(cardId)),
    deadSecond: new Set(deadSecond.map(cardId)),
    pairs: pairs.map(([a, b]) => { const [x, y] = [cardId(a), cardId(b)].sort((p, q) => p - q); return { id: pairId(a, b), card_a_id: x, card_b_id: y }; }),
    starters: new Set(starters.map(cardId)),
    pairExclusions: new Set(pairs.filter(([a, b]) => excluded.has(pairKey(a, b))).map(([a, b]) => pairId(a, b))),
    startConditions: [
      ...Object.entries(starterConditions).map(([n, c]) => ({ id: `c-${n}`, sourceCardId: cardId(n), sourcePairId: null, condition: toNode(c) })),
      ...Object.entries(pairConditions).map(([k, c]) => { const [a, b] = k.split('+'); return { id: `c-${k}`, sourceCardId: null, sourcePairId: pairId(a, b), condition: toNode(c) }; }),
    ],
  };
  return { spec, source };
}

const crit = (subject: QueryCriterion['subject'], n: number): QueryCriterion => ({ id: 'q', subject, min: n, max: n });
const mismatches: string[] = [];
let checks = 0;
const t0 = performance.now();
for (let run = 0; run < RUNS; run++) {
  const { spec, source } = randomCase();
  const model = buildEngineModel(source);
  for (const ctx of CTX) {
    const pass = computePass(model.input, ctx);
    const exact = enumerateExact(spec, ctx);
    const dist = (label: string, engine: number[], value: (o: typeof exact[number]) => number) => {
      const t = tally(exact, value);
      const max = Math.max(engine.length - 1, ...t.keys());
      for (let i = 0; i <= max; i++) {
        checks++;
        const e = engine[i] ?? 0;
        const o = (t.get(i) ?? 0) / exact.length;
        if (Math.abs(e - o) > TOL) { mismatches.push(`run ${run} ${ctx} ${label}=${i} moteur ${e} oracle ${o} :: ${JSON.stringify(spec)}`); break; }
      }
    };
    dist('starts', pass.startsExact, (o) => o.result.starts);
    dist('redondance', pass.redundancy, (o) => o.result.redundancy);
    dist('U', pass.nonEngine, (o) => o.result.potential);
    for (const label of LABELS) {
      const cat = pass.perCategory.find((c) => c.id === label);
      dist(`copies ${label}`, cat?.dist ?? [], (o) => o.result.catCounts[label] ?? 0);
      for (let n = 0; n <= 6; n++) {
        checks++;
        const e = queryProbability(pass, [crit({ kind: 'category', categoryId: label }, n)]) ?? 0;
        const o = exact.filter((x) => potentialOf(spec, x.result, [label]) === n).length / exact.length;
        if (Math.abs(e - o) > TOL) { mismatches.push(`run ${run} ${ctx} requête ${label}=${n} moteur ${e} oracle ${o}`); break; }
      }
    }
  }
  if (run % DELTA_EVERY === 0) {
    const all = computeAll(model.input);
    model.typeCardIds.forEach((id, i) => {
      if (id === 999) return;
      const name = String.fromCharCode(id - 1000);
      if (!spec.deck.includes(name)) return;
      for (const ctx of CTX) {
        checks++;
        const p = (s: OracleSpec) => { const ex = enumerateExact(s, ctx); return ex.filter((o) => o.result.starts >= 1).length / ex.length; };
        const o = p(spec) - p(withOneCopyReplaced(spec, name));
        const e = all.deltas[i][ctx];
        if (Math.abs(e - o) > TOL) mismatches.push(`run ${run} ${ctx} delta ${name} moteur ${e} oracle ${o} :: ${JSON.stringify(spec)}`);
      }
    });
  }
}
console.log(JSON.stringify({ seed: SEED, decks: RUNS, verifications: checks, divergences: mismatches.length, seconds: Math.round((performance.now() - t0) / 1000), premieres: mismatches.slice(0, 5) }, null, 2));
