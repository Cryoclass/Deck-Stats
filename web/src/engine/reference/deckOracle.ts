/**
 * Specification support ONLY (étape 5A). Never imported by application code.
 * Extends the étape-1 oracle (oracle.ts, unchanged) to whole decks: exhaustive
 * physical enumeration of chronological outcomes (opening five + identified sixth),
 * brute-force starts, brute-force non-engine potential with profiles, HOPT and shared
 * caps, AND/OR conditions on the remaining deck. It deliberately shares NO algorithm
 * with the production engine (composition enumeration, matching, min-cut). The spec
 * notation below is test notation, not a persistence or engine API.
 */
import {
  chronologicalHands, conditionHolds, physicalHands, potential, theoreticalStarts, windows,
  type Condition, type PotentialCopy, type Position, type Profile,
} from './oracle.js';
import type { Condition as EngineCondition, EngineInput, EngineType } from '../types.js';

export interface OracleSpec {
  /** Physical copies by name. Names without any annotation are neutral filler. */
  deck: string[];
  starters?: string[];
  hopt?: string[];
  pairs?: Array<[string, string]>;
  /** Availability profile per name; required for any labelled (non-engine) card. */
  profiles?: Record<string, Profile>;
  /** Non-engine labels (categories) per name. */
  labels?: Record<string, string[]>;
  /** Shared-cap group per name, and cap per turn per group. */
  groups?: Record<string, string>;
  groupCaps?: Record<string, number>;
  starterConditions?: Record<string, Condition>;
  /** Keyed by the canonical pair key `a+b` with a < b (see `pairKey`). */
  pairConditions?: Record<string, Condition>;
  deadFirst?: string[];
  deadSecond?: string[];
}

export const pairKey = (a: string, b: string): string => (a < b ? `${a}+${b}` : `${b}+${a}`);

export interface OracleOutcome {
  starts: number;
  redundancy: number;
  potential: number;
  catCounts: Record<string, number>;
  /** Copies eligible for non-engine potential, with their windows for this outcome. */
  copies: PotentialCopy[];
}

export function conditionTargets(c: Condition, into: Set<string> = new Set()): Set<string> {
  if ('card' in c) into.add(c.card);
  else for (const child of 'and' in c ? c.and : c.or) conditionTargets(child, into);
  return into;
}

/** Evaluates one chronological outcome with the étape-1 primitives only. */
export function evaluateOracleHand(
  spec: OracleSpec,
  position: Position,
  opening: string[],
  sixth: string | null,
): OracleOutcome {
  if ((position === 'first') !== (sixth === null)) throw new Error('Sixth card only when going second');
  const observed = sixth === null ? opening : [...opening, sixth];
  const remaining: Record<string, number> = {};
  for (const name of spec.deck) remaining[name] = (remaining[name] ?? 0) + 1;
  for (const name of observed) remaining[name] -= 1;

  const dead = new Set(position === 'first' ? spec.deadFirst ?? [] : spec.deadSecond ?? []);
  const starters = (spec.starters ?? []).filter((name) => {
    const c = spec.starterConditions?.[name];
    return !dead.has(name) && (c === undefined || conditionHolds(c, remaining));
  });
  const pairs = (spec.pairs ?? []).filter(([a, b]) => {
    if (dead.has(a) || dead.has(b)) return false;
    const c = spec.pairConditions?.[pairKey(a, b)];
    return c === undefined || conditionHolds(c, remaining);
  });
  const hand = observed.filter((name) => !dead.has(name));
  const { starts, redundancy } = theoreticalStarts(hand, starters, pairs, spec.hopt ?? []);

  const catCounts: Record<string, number> = {};
  const copies: PotentialCopy[] = [];
  observed.forEach((name, i) => {
    const labels = spec.labels?.[name] ?? [];
    for (const label of labels) catCounts[label] = (catCounts[label] ?? 0) + 1;
    const profile = spec.profiles?.[name];
    if (labels.length === 0 || profile === undefined) return;
    const isSixth = sixth !== null && i === observed.length - 1;
    copies.push({
      name,
      windows: windows(profile, position, isSixth),
      hopt: spec.hopt?.includes(name) ?? false,
      categories: labels,
      group: spec.groups?.[name],
    });
  });
  return { starts, redundancy, potential: potential(copies, spec.groupCaps ?? {}), catCounts, copies };
}

/** Potential restricted to copies carrying at least one of the labels, same caps. */
export function potentialOf(spec: OracleSpec, outcome: OracleOutcome, labels: string[]): number {
  return potential(outcome.copies, spec.groupCaps ?? {}, labels);
}

export interface ExactOutcome {
  opening: string[];
  sixth: string | null;
  result: OracleOutcome;
}

/** Every physical outcome once: Z = C(D,5) going first, C(D,5)·(D−5) going second. */
export function enumerateExact(spec: OracleSpec, position: Position): ExactOutcome[] {
  const D = spec.deck.length;
  if (position === 'first') {
    return physicalHands(D, 5).map((indices) => {
      const opening = indices.map((i) => spec.deck[i]);
      return { opening, sixth: null, result: evaluateOracleHand(spec, position, opening, null) };
    });
  }
  return chronologicalHands(D).map(({ opening, draw }) => {
    const names = opening.map((i) => spec.deck[i]);
    const sixth = spec.deck[draw];
    return { opening: names, sixth, result: evaluateOracleHand(spec, position, names, sixth) };
  });
}

/** Integer tally of a per-outcome value: value → number of outcomes. */
export function tally(outcomes: ExactOutcome[], value: (o: ExactOutcome) => number): Map<number, number> {
  const out = new Map<number, number>();
  for (const o of outcomes) {
    const v = value(o);
    out.set(v, (out.get(v) ?? 0) + 1);
  }
  return out;
}

/** Names that the engine must track as types (anything annotated or targeted). */
export function annotatedNames(spec: OracleSpec): string[] {
  const names = new Set<string>([
    ...(spec.starters ?? []), ...(spec.hopt ?? []), ...(spec.pairs ?? []).flat(),
    ...Object.keys(spec.labels ?? {}), ...Object.keys(spec.profiles ?? {}), ...Object.keys(spec.groups ?? {}),
    ...(spec.deadFirst ?? []), ...(spec.deadSecond ?? []),
  ]);
  for (const c of Object.values(spec.starterConditions ?? {})) for (const t of conditionTargets(c)) names.add(t);
  for (const c of Object.values(spec.pairConditions ?? {})) for (const t of conditionTargets(c)) names.add(t);
  const order: string[] = [];
  for (const name of spec.deck) if (names.has(name) && !order.includes(name)) order.push(name);
  // A name referenced but absent from the deck still needs an index → copies 0.
  for (const name of names) if (!order.includes(name)) order.push(name);
  return order;
}

export interface EngineFixture {
  input: EngineInput;
  names: string[]; // type index → name
  labels: string[]; // category index → label
  cardIdOf: (name: string) => number; // stable pseudo passcodes for hand-wall tests
}

/** Test-side adapter: spec notation → EngineInput. Not the application's builder. */
export function toEngineInput(spec: OracleSpec): EngineFixture {
  const names = annotatedNames(spec);
  const index = new Map(names.map((name, i) => [name, i]));
  const labels = [...new Set(Object.values(spec.labels ?? {}).flat())].sort();
  const labelIndex = new Map(labels.map((l, i) => [l, i]));
  const groupIds = [...new Set(Object.values(spec.groups ?? {}))].sort();
  const groups = groupIds.map((id) => {
    const cap = spec.groupCaps?.[id];
    if (cap === undefined) throw new Error(`Missing cap for group ${id}`);
    return { id, capPerTurn: cap };
  });
  const convert = (c: Condition): EngineCondition => {
    if ('card' in c) return { kind: 'remaining', type: index.get(c.card) ?? null, atLeast: c.atLeast };
    if ('and' in c) return { kind: 'and', all: c.and.map(convert) };
    return { kind: 'or', any: c.or.map(convert) };
  };
  const types: EngineType[] = names.map((name) => {
    const cardLabels = spec.labels?.[name] ?? [];
    if (cardLabels.length > 0 && spec.profiles?.[name] === undefined) {
      throw new Error(`Labelled card ${name} needs a profile in oracle specs (the legacy model is not an oracle rule)`);
    }
    const group = spec.groups?.[name];
    const condition = spec.starterConditions?.[name];
    return {
      copies: spec.deck.filter((n) => n === name).length,
      isHopt: spec.hopt?.includes(name) ?? false,
      isStarter: spec.starters?.includes(name) ?? false,
      categories: cardLabels.map((l) => labelIndex.get(l)!),
      deadFirst: spec.deadFirst?.includes(name) || undefined,
      deadSecond: spec.deadSecond?.includes(name) || undefined,
      availability: spec.profiles?.[name],
      group: group === undefined ? undefined : groupIds.indexOf(group),
      starterCondition: condition === undefined ? undefined : convert(condition),
    };
  });
  const edges = (spec.pairs ?? []).map(([a, b]): [number, number] => [index.get(a)!, index.get(b)!]);
  const edgeConditions = (spec.pairs ?? []).map(([a, b]) => {
    const c = spec.pairConditions?.[pairKey(a, b)];
    return c === undefined ? undefined : convert(c);
  });
  return {
    input: {
      deckSize: spec.deck.length,
      types,
      edges,
      edgeConditions,
      categories: labels.map((id) => ({ id, relevance: 'both' as const })),
      groups,
    },
    names,
    labels,
    cardIdOf: (name) => 1000 + (index.get(name) ?? names.length + spec.deck.indexOf(name)),
  };
}

/** Replaces one physical copy of `name` by neutral filler (marginal contribution). */
export function withOneCopyReplaced(spec: OracleSpec, name: string): OracleSpec {
  const deck = [...spec.deck];
  const at = deck.indexOf(name);
  if (at < 0) throw new Error(`No copy of ${name}`);
  deck[at] = `neutral(${name})`;
  return { ...spec, deck };
}
