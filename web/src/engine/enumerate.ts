import { binom } from './binomial.js';
import { prepare, evaluate, startsAtLeastOne, type Prepared } from './evaluate.js';
import type {
  Bucket,
  CategoryDist,
  EngineInput,
  EngineResult,
  PassResult,
} from './types.js';

/**
 * Énumération par composition (§3.1 / §B.2) — exact, jamais Monte-Carlo, jamais
 * carte par carte. On parcourt les vecteurs (k1..kn) des seuls types annotés, le
 * reste du deck étant fusionné dans le paquet `filler`. Le visiteur reçoit le
 * vecteur `k` (réutilisé — à ne pas conserver) et le poids de la composition.
 */
function enumerate(
  prep: Prepared,
  handSize: number,
  visit: (k: number[], weight: number) => void,
): void {
  const { input, filler, n } = prep;
  const copies = input.types.map((t) => t.copies);
  const k = new Array<number>(n).fill(0);

  const dfs = (i: number, sumK: number, weightProd: number): void => {
    if (i === n) {
      const kF = handSize - sumK;
      if (kF < 0 || kF > filler) return; // §B.2 : kF > filler → passer
      const w = weightProd * binom(filler, kF);
      if (w === 0) return;
      visit(k, w);
      return;
    }
    const maxi = Math.min(copies[i], handSize - sumK);
    for (let ki = 0; ki <= maxi; ki++) {
      k[i] = ki;
      dfs(i + 1, sumK + ki, weightProd * binom(copies[i], ki));
    }
    k[i] = 0;
  };

  dfs(0, 0, 1);
}

/** P(≥1 start) — chemin léger pour la contribution marginale (§3.2) : prédicat
 *  booléen, sans construire sommets/couplage/comptes. */
function probStart(prep: Prepared, handSize: number): number {
  const total = binom(prep.input.deckSize, handSize);
  if (total === 0) return 0;
  const dead = handSize <= 5 ? prep.deadFirst : prep.deadSecond;
  let w1 = 0;
  enumerate(prep, handSize, (k, w) => {
    if (startsAtLeastOne(prep, k, dead)) w1 += w;
  });
  return w1 / total;
}

export function computePass(input: EngineInput, handSize: number): PassResult {
  const prep = prepare(input);
  const total = binom(input.deckSize, handSize);
  const numCat = input.categories.length;
  const dead = handSize <= 5 ? prep.deadFirst : prep.deadSecond;

  const map = new Map<string, { b: Bucket }>();
  const startsExact: number[] = [];
  const redundancy: number[] = [];
  const nonEngine: number[] = [];
  const catDists: number[][] = Array.from({ length: numCat }, () => []);
  const cross: number[][] = [[], [], [], []]; // min(starts,3) × neTotal

  const add = (arr: number[], idx: number, w: number) => {
    arr[idx] = (arr[idx] ?? 0) + w;
  };

  enumerate(prep, handSize, (k, w) => {
    const out = evaluate(prep, k, dead);
    const neContrib = handSize <= 5 ? out.neContribFirst : out.neContribSecond;
    const neTotal = handSize <= 5 ? out.neFirst : out.neSecond;
    const key = `${out.starts}|${out.redundancy}|${neContrib.join(',')}`;
    const existing = map.get(key);
    if (existing) existing.b.p += w;
    else
      map.set(key, {
        b: {
          starts: out.starts,
          redundancy: out.redundancy,
          neTotal,
          neContrib: neContrib.slice(),
          p: w,
        },
      });

    add(startsExact, out.starts, w);
    add(redundancy, out.redundancy, w);
    add(nonEngine, neTotal, w);
    for (let c = 0; c < numCat; c++) add(catDists[c], out.catCounts[c], w);
    const sb = Math.min(out.starts, 3);
    if (!cross[sb]) cross[sb] = [];
    add(cross[sb], neTotal, w);
  });

  // Normalisation counts → probabilités.
  const norm = (arr: number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < arr.length; i++) out[i] = (arr[i] ?? 0) / total;
    return out;
  };

  const buckets = [...map.values()].map((v) => ({ ...v.b, p: v.b.p / total }));
  const startsExactP = norm(startsExact);
  const startsBuckets = [
    startsExactP[0] ?? 0,
    startsExactP[1] ?? 0,
    startsExactP[2] ?? 0,
    startsExactP.slice(3).reduce((s, p) => s + (p ?? 0), 0),
  ];
  const meanStarts = startsExactP.reduce((s, p, i) => s + (p ?? 0) * i, 0);
  const nonEngineP = norm(nonEngine);
  const meanNonEngine = nonEngineP.reduce((s, p, i) => s + (p ?? 0) * i, 0);

  const perCategory: CategoryDist[] = input.categories.map((cat, c) => {
    const relevant =
      cat.relevance === 'both' ||
      (handSize <= 5 ? cat.relevance === 'first' : cat.relevance === 'second');
    const dist = norm(catDists[c]);
    return {
      id: cat.id,
      relevant,
      dist,
      mean: dist.reduce((s, p, i) => s + (p ?? 0) * i, 0),
    };
  });

  const crossMatrix = cross.map((row) => norm(row ?? []));
  const neSignatures = (handSize <= 5 ? prep.neSigFirst : prep.neSigSecond).map((s) => ({
    cats: s.cats,
  }));

  return {
    handSize,
    deckSize: input.deckSize,
    total,
    buckets,
    startsBuckets,
    startsExact: startsExactP,
    brick: startsExactP[0] ?? 0,
    meanStarts,
    redundancy: norm(redundancy),
    nonEngine: nonEngineP,
    meanNonEngine,
    perCategory,
    crossMatrix,
    neSignatures,
  };
}

/** Calcul complet : deux passes + contributions marginales de chaque type (§3.2). */
export function computeAll(input: EngineInput): EngineResult {
  const first = computePass(input, 5);
  const second = computePass(input, 6);

  const baseFirst = 1 - first.brick;
  const baseSecond = 1 - second.brick;

  const deltas = input.types.map((t, i) => {
    if (t.copies <= 0) return { first: 0, second: 0 };
    // Retirer 1 copie = elle bascule dans le filler ; deckSize inchangé.
    const reduced: EngineInput = {
      ...input,
      types: input.types.map((tt, j) => (j === i ? { ...tt, copies: tt.copies - 1 } : tt)),
    };
    const prepR = prepare(reduced);
    return {
      first: baseFirst - probStart(prepR, 5),
      second: baseSecond - probStart(prepR, 6),
    };
  });

  return { first, second, deltas };
}
