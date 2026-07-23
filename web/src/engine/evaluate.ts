import { maxMatching, countEdges, edgeKey } from './matching.js';
import type { EngineInput, Outcome, Prereq } from './types.js';

/** Vue précompilée de l'entrée : matrice d'adjacence + flags de pertinence. */
export interface Prepared {
  input: EngineInput;
  n: number;
  filler: number; // §B.1 : taille_deck − Σ copies annotées
  typeAdj: boolean[][];
  neFirst: boolean[]; // type i pertinent going first (catégorie first|both)
  neSecond: boolean[]; // type i pertinent going second (catégorie second|both)
  deadFirst: boolean[]; // type i mort going first → filler pour cette passe (Lot C)
  deadSecond: boolean[]; // type i mort going second
  horizonFirst: number; // §B.3.5 : plafond activable d'une carte HOPT non-engine (1..3)
  horizonSecond: number;
  // Itération 5 : prérequis en deck.
  hasPrereqs: boolean; // aucun prérequis → chemin rapide strictement identique à avant
  starterPrereqs: Array<Prereq[] | undefined>; // par type
  edgePrereqs: Array<Prereq[] | undefined>; // aligné sur input.edges
  // Itération 7 : signatures non-engine (types groupés par ensemble de catégories
  // PERTINENTES pour la passe) — permet d'agréger tout groupe de catégories sans double
  // comptage. Une signature porte ses cartes (types) et ses ids de catégories.
  neSigFirst: NeSignature[];
  neSigSecond: NeSignature[];
}

interface NeSignature {
  cats: string[]; // ids des catégories pertinentes partagées par ces types
  types: number[]; // index des types de cette signature
}

/** §B.3.5 : horizon = entier dans [1, 3]. Défauts : first=1 (on pose un board, un seul
 *  tour adverse), second=2 (la partie s'étend, plusieurs tours servent). */
function clampHorizon(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isFinite(v)) return fallback;
  return Math.max(1, Math.min(3, Math.round(v)));
}

/** Prérequis (ET) satisfaits ? copies restantes en deck = requiredTotal − k[requiredType]. */
function prereqsSatisfied(prereqs: Prereq[], k: number[]): boolean {
  for (const p of prereqs) {
    const kReq = p.requiredType !== null ? k[p.requiredType] ?? 0 : 0;
    if (p.requiredTotal - kReq < p.minInDeck) return false;
  }
  return true;
}

export function prepare(input: EngineInput): Prepared {
  const n = input.types.length;
  const typeAdj: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  for (const [a, b] of input.edges) {
    if (a === b) continue; // auto-combo hors périmètre (§D)
    if (a < 0 || b < 0 || a >= n || b >= n) continue;
    typeAdj[a][b] = true;
    typeAdj[b][a] = true;
  }

  const neFirst = new Array<boolean>(n).fill(false);
  const neSecond = new Array<boolean>(n).fill(false);
  const deadFirst = new Array<boolean>(n).fill(false);
  const deadSecond = new Array<boolean>(n).fill(false);
  const starterPrereqs = new Array<Prereq[] | undefined>(n).fill(undefined);
  let hasPrereqs = false;
  for (let i = 0; i < n; i++) {
    for (const c of input.types[i].categories) {
      const rel = input.categories[c]?.relevance;
      if (rel === 'first' || rel === 'both') neFirst[i] = true;
      if (rel === 'second' || rel === 'both') neSecond[i] = true;
    }
    deadFirst[i] = !!input.types[i].deadFirst;
    deadSecond[i] = !!input.types[i].deadSecond;
    const sp = input.types[i].starterPrereqs;
    if (sp && sp.length > 0) {
      starterPrereqs[i] = sp;
      hasPrereqs = true;
    }
  }

  const edgePrereqs = input.edges.map((_, e) => {
    const ep = input.edgePrereqs?.[e];
    if (ep && ep.length > 0) {
      hasPrereqs = true;
      return ep;
    }
    return undefined;
  });

  const usedCopies = input.types.reduce((s, t) => s + t.copies, 0);
  const filler = Math.max(0, input.deckSize - usedCopies);

  // Signatures non-engine : on groupe les types par leur ensemble de catégories
  // PERTINENTES pour la passe. Le filtrage par pertinence se fait donc AVANT l'union.
  const catRelFirst = input.categories.map((c) => c.relevance === 'first' || c.relevance === 'both');
  const catRelSecond = input.categories.map((c) => c.relevance === 'second' || c.relevance === 'both');
  const relCats = (i: number, rel: boolean[]): string[] =>
    input.types[i].categories
      .filter((c) => rel[c])
      .map((c) => input.categories[c].id)
      .sort();
  const buildSigs = (rel: boolean[]): NeSignature[] => {
    const map = new Map<string, NeSignature>();
    for (let i = 0; i < n; i++) {
      const cats = relCats(i, rel);
      if (cats.length === 0) continue;
      const key = cats.join('|');
      const sig = map.get(key) ?? { cats, types: [] };
      sig.types.push(i);
      map.set(key, sig);
    }
    return [...map.values()];
  };

  return {
    input,
    n,
    filler,
    typeAdj,
    neFirst,
    neSecond,
    deadFirst,
    deadSecond,
    horizonFirst: clampHorizon(input.horizonFirst, 1),
    horizonSecond: clampHorizon(input.horizonSecond, 2),
    hasPrereqs,
    starterPrereqs,
    edgePrereqs,
    neSigFirst: buildSigs(catRelFirst),
    neSigSecond: buildSigs(catRelSecond),
  };
}

/**
 * evaluer(composition) — §B.3. `k[i]` = nombre de copies du type i dans la main.
 * Ne dépend pas de la taille de main pour starts/redondance ; `dead[i]` retire les
 * cartes mortes de la passe courante (Lot C). Itération 5 : AVANT les étapes 2 et 3,
 * les sources de start (starter ou arête) dont le prérequis en deck n'est pas satisfait
 * sont neutralisées — le starter ne compte pas, l'arête est retirée du graphe (donc de
 * la redondance). Le comptage non-engine (étape 5) n'est pas concerné.
 */
export function evaluate(prep: Prepared, k: number[], dead: boolean[]): Outcome {
  const { input, typeAdj, horizonFirst, horizonSecond } = prep;

  // 0. Prérequis (itération 5) — chemin rapide sauté si aucun prérequis.
  let disabled: Set<number> | undefined;
  const starterOff = (ti: number): boolean =>
    prep.hasPrereqs
      ? !!prep.starterPrereqs[ti] && !prereqsSatisfied(prep.starterPrereqs[ti]!, k)
      : false;
  if (prep.hasPrereqs) {
    for (let e = 0; e < input.edges.length; e++) {
      const ep = prep.edgePrereqs[e];
      if (ep && !prereqsSatisfied(ep, k)) {
        const [a, b] = input.edges[e];
        (disabled ??= new Set()).add(edgeKey(a, b));
      }
    }
  }

  // 1. Sommets : ki sommets, ou 1 seul si HOPT (§2.3). Cartes mortes ignorées.
  const vertices: number[] = [];
  for (let i = 0; i < k.length; i++) {
    if (k[i] <= 0 || dead[i]) continue;
    const t = input.types[i];
    const count = t.isHopt ? 1 : k[i];
    for (let v = 0; v < count; v++) vertices.push(i);
  }

  // 2. Starters 1-carte : retirés d'abord, +1 chacun — sauf prérequis non satisfait,
  //    auquel cas le sommet redevient une pièce ordinaire disponible pour le couplage.
  let starts = 0;
  const nonStarter: number[] = [];
  for (const ti of vertices) {
    if (input.types[ti].isStarter && !starterOff(ti)) starts += 1;
    else nonStarter.push(ti);
  }

  // 3. Couplage maximum sur les sommets restants (arêtes non satisfaites retirées).
  starts += maxMatching(nonStarter, typeAdj, disabled);

  // 4. Redondance = arêtes présentes (§2.4) APRÈS retrait des arêtes non satisfaites.
  const redundancy = countEdges(vertices, typeAdj, disabled);

  // 5. Non-engine : ventilation brute par catégorie (pour le panneau de stats) +
  //    contributions dédupliquées par SIGNATURE (union par catégories pertinentes, PUIS
  //    plafond HOPT — l'ordre est impératif, §C). Le total par passe = Σ des signatures.
  const catCounts = new Array<number>(input.categories.length).fill(0);
  for (let i = 0; i < k.length; i++) {
    if (k[i] <= 0) continue;
    for (const c of input.types[i].categories) catCounts[c] += k[i];
  }

  const contribOf = (sigs: NeSignature[], horizon: number): number[] =>
    sigs.map((sig) => {
      let sum = 0;
      for (const t of sig.types) {
        if (k[t] <= 0) continue;
        sum += input.types[t].isHopt ? Math.min(k[t], horizon) : k[t];
      }
      return sum;
    });
  const neContribFirst = contribOf(prep.neSigFirst, horizonFirst);
  const neContribSecond = contribOf(prep.neSigSecond, horizonSecond);
  const neFirstTotal = neContribFirst.reduce((s, v) => s + v, 0);
  const neSecondTotal = neContribSecond.reduce((s, v) => s + v, 0);

  return {
    starts,
    redundancy,
    catCounts,
    neFirst: neFirstTotal,
    neSecond: neSecondTotal,
    neContribFirst,
    neContribSecond,
  };
}

/**
 * Prédicat rapide « starts ≥ 1 » pour la contribution marginale (§3.2). Sans prérequis,
 * comportement strictement identique à avant. Avec prérequis : un starter compte s'il est
 * présent ET son prérequis satisfait ; une arête suffit si ses deux extrémités sont
 * présentes ET son prérequis satisfait (à ce stade aucun starter « comptant » n'est
 * présent, sinon la première boucle aurait déjà renvoyé vrai).
 */
export function startsAtLeastOne(prep: Prepared, k: number[], dead: boolean[]): boolean {
  const { input } = prep;
  const hp = prep.hasPrereqs;
  for (let i = 0; i < k.length; i++) {
    if (k[i] > 0 && !dead[i] && input.types[i].isStarter) {
      if (!hp) return true;
      const pr = prep.starterPrereqs[i];
      if (!pr || prereqsSatisfied(pr, k)) return true;
    }
  }
  for (let e = 0; e < input.edges.length; e++) {
    const [a, b] = input.edges[e];
    if (a === b) continue;
    if (k[a] > 0 && k[b] > 0 && !dead[a] && !dead[b]) {
      if (!hp) {
        if (!input.types[a].isStarter && !input.types[b].isStarter) return true;
      } else {
        const pr = prep.edgePrereqs[e];
        if (!pr || prereqsSatisfied(pr, k)) return true;
      }
    }
  }
  return false;
}
