/**
 * Couplage maximum sur un petit graphe (≤ 6 sommets, §2.4 / §B.3 étape 3).
 * Mémoïsation sur bitmask des sommets — largement suffisant, « inutile de sortir
 * Blossom ». Les sommets portent une étiquette = index de type ; deux sommets sont
 * adjacents ssi leurs types combottent (matrice `typeAdj`) — deux sommets du même
 * type ne le sont jamais (l'auto-combo n'est pas modélisé, §D point ouvert 1).
 *
 * `disabled` (itération 5) : arêtes (paires de types) désactivées pour CETTE
 * composition car leur prérequis en deck n'est pas satisfait. Clé = edgeKey(i, j).
 * Omis (undefined) → comportement strictement identique à avant (aucune surcharge).
 */
const STRIDE = 1 << 16;

/** Clé canonique d'une arête de types (i, j), i ≠ j. */
export function edgeKey(i: number, j: number): number {
  return i < j ? i * STRIDE + j : j * STRIDE + i;
}

function active(
  typeAdj: boolean[][],
  li: number,
  lj: number,
  disabled?: Set<number>,
): boolean {
  if (!typeAdj[li]?.[lj]) return false;
  return !disabled || !disabled.has(edgeKey(li, lj));
}

/** Nombre maximal d'arêtes deux à deux disjointes sur les sommets donnés. */
export function maxMatching(
  labels: number[],
  typeAdj: boolean[][],
  disabled?: Set<number>,
): number {
  const n = labels.length;
  if (n < 2) return 0;

  const adj = new Array<number>(n).fill(0);
  let anyEdge = false;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (active(typeAdj, labels[a], labels[b], disabled)) {
        adj[a] |= 1 << b;
        adj[b] |= 1 << a;
        anyEdge = true;
      }
    }
  }
  if (!anyEdge) return 0;

  const memo = new Map<number, number>();
  const full = (1 << n) - 1;

  const solve = (mask: number): number => {
    if (mask === 0) return 0;
    const cached = memo.get(mask);
    if (cached !== undefined) return cached;
    const a = 31 - Math.clz32(mask & -mask);
    const without = mask & ~(1 << a);
    let best = solve(without);
    let opts = adj[a] & without;
    while (opts) {
      const b = 31 - Math.clz32(opts & -opts);
      opts &= opts - 1;
      const sub = solve(without & ~(1 << b));
      if (sub + 1 > best) best = sub + 1;
    }
    memo.set(mask, best);
    return best;
  };

  return solve(full);
}

/** Nombre d'arêtes présentes (redondance § 2.4), sur le graphe APRÈS retrait des
 *  arêtes à prérequis non satisfait (itération 5). */
export function countEdges(
  labels: number[],
  typeAdj: boolean[][],
  disabled?: Set<number>,
): number {
  let count = 0;
  for (let a = 0; a < labels.length; a++) {
    for (let b = a + 1; b < labels.length; b++) {
      if (active(typeAdj, labels[a], labels[b], disabled)) count++;
    }
  }
  return count;
}
