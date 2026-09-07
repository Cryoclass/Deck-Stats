import { binom } from './binomial.js';
import { prepare, evaluate, startsAtLeastOne, type Prepared } from './evaluate.js';
import type {
  AnalysisContext,
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
 * vecteur `k` (réutilisé — à ne pas conserver) et le poids de la composition
 * `Π C(nᵢ, kᵢ) · C(F, kF)`.
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

/**
 * Espace des issues d'un contexte (contrat §5). Premier : compositions de 5, poids
 * `Π C(nᵢ,kᵢ)`, Z = C(D,5). Second : issues (composition initiale, sixième identifiée),
 * poids `Π C(nᵢ,kᵢ) · (nⱼ − kⱼ)`, Z = C(D,5)·(D−5). On les obtient depuis les
 * compositions de 6 cartes : pour un ensemble de six copies, chaque copie peut être la
 * dernière piochée, d'où `w(k6, j) = W(k6) · k6ⱼ` (identité C(n,k+1)(k+1) = C(n,k)(n−k)).
 * Seuls les types dont l'issue dépend de la sixième (profils early/flexible) sont
 * distingués ; les autres copies et le filler partagent l'évaluation « sixième neutre »,
 * strictement identique pour eux. `k` couvre TOUTES les cartes observées.
 */
function enumerateOutcomes(
  prep: Prepared,
  context: AnalysisContext,
  visit: (k: number[], sixth: number, weight: number) => void,
): void {
  if (context === 'first') {
    enumerate(prep, 5, (k, w) => visit(k, -1, w));
    return;
  }
  const sensitive: number[] = [];
  for (let i = 0; i < prep.n; i++) if (prep.sixthSensitive[i]) sensitive.push(i);
  enumerate(prep, 6, (k, w) => {
    let plain = 6;
    for (const t of sensitive) {
      if (k[t] > 0) {
        visit(k, t, w * k[t]);
        plain -= k[t];
      }
    }
    if (plain > 0) visit(k, -1, w * plain);
  });
}

const handSizeOf = (context: AnalysisContext): number => (context === 'first' ? 5 : 6);

/** Nombre d'issues pondérées Z du contexte (contrat §5). */
function outcomesOf(deckSize: number, context: AnalysisContext): number {
  const c5 = binom(deckSize, 5);
  return context === 'first' ? c5 : c5 * Math.max(0, deckSize - 5);
}

/** P(≥1 start) — chemin léger pour la contribution marginale (§3.2) : prédicat
 *  booléen, sans construire sommets/couplage/comptes. Les starts ne dépendent pas de
 *  l'identité de la sixième : les compositions de 6 suffisent en second. */
function probStart(prep: Prepared, context: AnalysisContext): number {
  const handSize = handSizeOf(context);
  const total = binom(prep.input.deckSize, handSize);
  if (total === 0) return 0;
  const dead = context === 'first' ? prep.deadFirst : prep.deadSecond;
  let w1 = 0;
  enumerate(prep, handSize, (k, w) => {
    if (startsAtLeastOne(prep, k, dead)) w1 += w;
  });
  return w1 / total;
}

/** Contexte d'analyse depuis le paramètre du moteur ; `5`/`6` restent acceptés comme
 *  synonymes de premier/second (taille observée) pour les appels historiques. */
export function contextOf(pass: AnalysisContext | number): AnalysisContext | null {
  if (pass === 'first' || pass === 5) return 'first';
  if (pass === 'second' || pass === 6) return 'second';
  return null;
}

function unavailable(context: AnalysisContext, deckSize: number, reason: string): PassResult {
  return {
    context, handSize: handSizeOf(context), deckSize, total: 0, outcomes: 0,
    unavailableReason: reason,
    buckets: [], startsBuckets: [], startsExact: [], brick: 0, meanStarts: 0,
    redundancy: [], nonEngine: [], meanNonEngine: 0, perCategory: [],
    crossMatrix: [], neSignatures: [],
  };
}

export function computePass(input: EngineInput, pass: AnalysisContext | number): PassResult {
  const context = contextOf(pass);
  if (context === null) {
    return unavailable('first', input.deckSize, 'Contexte d’analyse inconnu : premier (5 cartes) ou second (5 + pioche) attendu.');
  }
  const handSize = handSizeOf(context);
  const invalid = !Number.isSafeInteger(input.deckSize) || input.deckSize < 0 ||
    input.types.some((t) => !Number.isInteger(t.copies) || t.copies < 0 || t.copies > 3) ||
    input.types.reduce((sum, t) => sum + t.copies, 0) > input.deckSize;
  const total = invalid ? 0 : binom(input.deckSize, handSize);
  const outcomes = invalid ? 0 : outcomesOf(input.deckSize, context);
  if (invalid || total === 0 || !Number.isSafeInteger(outcomes)) {
    return unavailable(context, input.deckSize, invalid ? 'Composition ou taille de main invalide.' : total === 0
      ? `Impossible de tirer ${handSize} cartes dans un deck de ${input.deckSize} cartes.`
      : 'Ce tirage dépasse la précision entière prise en charge.');
  }
  const prep = prepare(input); // jette sur condition ou plafond invalide : jamais silencieux
  const numCat = input.categories.length;

  const map = new Map<string, Bucket>();
  const startsExact: number[] = [];
  const redundancy: number[] = [];
  const nonEngine: number[] = [];
  const catDists: number[][] = Array.from({ length: numCat }, () => []);
  const cross: number[][] = [[], [], [], []]; // min(starts,3) × U

  const add = (arr: number[], idx: number, w: number) => {
    arr[idx] = (arr[idx] ?? 0) + w;
  };

  enumerateOutcomes(prep, context, (k, sixth, w) => {
    const out = evaluate(prep, context, k, sixth);
    const cappedKey = out.neCapped.length === 0
      ? ''
      : '|' + out.neCapped.map((u) => `${u.cap}:${u.members.map((m) => m.join('.')).join(';')}`).join('/');
    const key = `${out.starts}|${out.redundancy}|${out.neContrib.join(',')}${cappedKey}`;
    const existing = map.get(key);
    if (existing) existing.p += w;
    else
      map.set(key, {
        starts: out.starts,
        redundancy: out.redundancy,
        neTotal: out.ne,
        neContrib: out.neContrib.slice(),
        ...(out.neCapped.length ? { neCapped: out.neCapped } : {}),
        p: w,
      });

    add(startsExact, out.starts, w);
    add(redundancy, out.redundancy, w);
    add(nonEngine, out.ne, w);
    for (let c = 0; c < numCat; c++) add(catDists[c], out.catCounts[c], w);
    const sb = Math.min(out.starts, 3);
    add(cross[sb], out.ne, w);
  });

  // Normalisation poids entiers → probabilités, sur Z (issues pondérées).
  const norm = (arr: number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < arr.length; i++) out[i] = (arr[i] ?? 0) / outcomes;
    return out;
  };

  const buckets = [...map.values()].map((b) => ({ ...b, weight: b.p, p: b.p / outcomes }));
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
      (context === 'first' ? cat.relevance === 'first' : cat.relevance === 'second');
    const dist = norm(catDists[c]);
    return {
      id: cat.id,
      relevant,
      dist,
      mean: dist.reduce((s, p, i) => s + (p ?? 0) * i, 0),
    };
  });

  const crossMatrix = cross.map((row) => norm(row ?? []));
  const neSignatures = (context === 'first' ? prep.neSigFirst : prep.neSigSecond).map((s) => ({
    cats: s.cats,
  }));

  return {
    context,
    handSize,
    deckSize: input.deckSize,
    total,
    outcomes,
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

/** Calcul complet : les deux contextes + contributions marginales de chaque type
 *  (§3.2), chacune dérivée du même contexte que la distribution qu'elle accompagne. */
export function computeAll(input: EngineInput): EngineResult {
  const first = computePass(input, 'first');
  const second = computePass(input, 'second');

  const baseFirst = first.startsBuckets.slice(1).reduce((s, p) => s + p, 0);
  const baseSecond = second.startsBuckets.slice(1).reduce((s, p) => s + p, 0);

  const deltas = input.types.map((t, i) => {
    if (t.copies <= 0) return { first: 0, second: 0 };
    // Retirer 1 copie = elle bascule dans le filler ; deckSize inchangé, conditions
    // reconstruites depuis la composition réduite (étape 2).
    const reduced: EngineInput = {
      ...input,
      types: input.types.map((tt, j) => (j === i ? { ...tt, copies: tt.copies - 1 } : tt)),
    };
    const prepR = prepare(reduced);
    return {
      first: first.total > 0 ? baseFirst - probStart(prepR, 'first') : 0,
      second: second.total > 0 ? baseSecond - probStart(prepR, 'second') : 0,
    };
  });

  return { first, second, deltas };
}
