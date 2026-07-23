import { maxMatching, countEdges } from './matching.js';
import type { EngineInput, Outcome } from './types.js';

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
}

/** §B.3.5 : horizon = entier dans [1, 3]. Défauts : first=1 (on pose un board, un seul
 *  tour adverse), second=2 (la partie s'étend, plusieurs tours servent). */
function clampHorizon(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isFinite(v)) return fallback;
  return Math.max(1, Math.min(3, Math.round(v)));
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
  for (let i = 0; i < n; i++) {
    for (const c of input.types[i].categories) {
      const rel = input.categories[c]?.relevance;
      if (rel === 'first' || rel === 'both') neFirst[i] = true;
      if (rel === 'second' || rel === 'both') neSecond[i] = true;
    }
    deadFirst[i] = !!input.types[i].deadFirst;
    deadSecond[i] = !!input.types[i].deadSecond;
  }

  const usedCopies = input.types.reduce((s, t) => s + t.copies, 0);
  const filler = Math.max(0, input.deckSize - usedCopies);

  const horizonFirst = clampHorizon(input.horizonFirst, 1);
  const horizonSecond = clampHorizon(input.horizonSecond, 2);

  return {
    input,
    n,
    filler,
    typeAdj,
    neFirst,
    neSecond,
    deadFirst,
    deadSecond,
    horizonFirst,
    horizonSecond,
  };
}

/**
 * evaluer(composition) — §B.3. `k[i]` = nombre de copies du type i dans la main.
 * Ne dépend pas de la taille de main pour starts/redondance ; `dead[i]` retire les
 * cartes mortes de la passe courante du graphe et des starters (Lot C). Le comptage
 * non-engine (étape 5) reste inchangé, régi par la pertinence de catégorie.
 */
export function evaluate(prep: Prepared, k: number[], dead: boolean[]): Outcome {
  const { input, typeAdj, neFirst, neSecond, horizonFirst, horizonSecond } = prep;

  // 1. Sommets : ki sommets, ou 1 seul si HOPT (§2.3). Cartes mortes ignorées.
  const vertices: number[] = [];
  for (let i = 0; i < k.length; i++) {
    if (k[i] <= 0 || dead[i]) continue;
    const t = input.types[i];
    const count = t.isHopt ? 1 : k[i];
    for (let v = 0; v < count; v++) vertices.push(i);
  }

  // 2. Starters 1-carte : retirés d'abord, +1 chacun (optimal, cf. note §B.3).
  let starts = 0;
  const nonStarter: number[] = [];
  for (const ti of vertices) {
    if (input.types[ti].isStarter) starts += 1;
    else nonStarter.push(ti);
  }

  // 3. Couplage maximum sur les sommets restants.
  starts += maxMatching(nonStarter, typeAdj);

  // 4. Redondance = nombre total d'arêtes présentes (combos présents, §2.4),
  //    sur TOUS les sommets de la main (recouvrements et starters inclus).
  const redundancy = countEdges(vertices, typeAdj);

  // 5. Non-engine : compté séparément sur la composition complète, sans retirer
  //    les sommets consommés (§2.5). Total (union) par passe, plafonné par l'horizon
  //    HOPT (§B.3.5, itération 2) : une carte HOPT ne pouvant s'activer qu'un nombre
  //    borné de fois dans la fenêtre d'interaction, sa contribution au TOTAL est
  //    `min(copies, horizon)`. Le filtrage par pertinence de catégorie s'applique après
  //    le plafonnement. La ventilation `catCounts` reste en copies BRUTES (physiques) :
  //    P(≥1) — seule stat par catégorie affichée — est invariante par plafond, et un
  //    prédicat « catégorie ≥ N » du mode requête interroge la main tirée, pas
  //    l'activable (voir DECISIONS.md, itération 2).
  const catCounts = new Array<number>(input.categories.length).fill(0);
  let neFirstTotal = 0;
  let neSecondTotal = 0;
  for (let i = 0; i < k.length; i++) {
    if (k[i] <= 0) continue;
    const isHopt = input.types[i].isHopt;
    for (const c of input.types[i].categories) catCounts[c] += k[i];
    if (neFirst[i]) neFirstTotal += isHopt ? Math.min(k[i], horizonFirst) : k[i];
    if (neSecond[i]) neSecondTotal += isHopt ? Math.min(k[i], horizonSecond) : k[i];
  }

  return { starts, redundancy, catCounts, neFirst: neFirstTotal, neSecond: neSecondTotal };
}

/**
 * Prédicat rapide « starts ≥ 1 » pour la contribution marginale (§3.2) : évite de
 * construire les sommets, le couplage et les comptes. starts ≥ 1 ssi un starter est
 * présent, OU une arête active a ses deux extrémités présentes et non-starter (une
 * seule arête dans le sous-graphe non-starter suffit à un couplage ≥ 1).
 */
export function startsAtLeastOne(prep: Prepared, k: number[], dead: boolean[]): boolean {
  const { input } = prep;
  for (let i = 0; i < k.length; i++) {
    if (k[i] > 0 && !dead[i] && input.types[i].isStarter) return true;
  }
  for (const [a, b] of input.edges) {
    if (a === b) continue;
    if (
      k[a] > 0 &&
      k[b] > 0 &&
      !dead[a] &&
      !dead[b] &&
      !input.types[a].isStarter &&
      !input.types[b].isStarter
    ) {
      return true;
    }
  }
  return false;
}
