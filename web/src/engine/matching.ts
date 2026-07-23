/**
 * Couplage maximum sur un petit graphe (≤ 6 sommets, §2.4 / §B.3 étape 3).
 * Mémoïsation sur bitmask des sommets — largement suffisant, « inutile de sortir
 * Blossom ». Les sommets portent une étiquette = index de type ; deux sommets sont
 * adjacents ssi leurs types combottent (matrice `typeAdj`) — deux sommets du même
 * type ne le sont jamais (l'auto-combo n'est pas modélisé, §D point ouvert 1).
 */

/** Nombre maximal d'arêtes deux à deux disjointes sur les sommets donnés. */
export function maxMatching(labels: number[], typeAdj: boolean[][]): number {
  const n = labels.length;
  if (n < 2) return 0;

  // Adjacence au niveau des sommets, en bitmask.
  const adj = new Array<number>(n).fill(0);
  let anyEdge = false;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (typeAdj[labels[a]]?.[labels[b]]) {
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
    // Premier sommet libre.
    const a = 31 - Math.clz32(mask & -mask);
    const without = mask & ~(1 << a);
    // Option 1 : laisser `a` non couplé.
    let best = solve(without);
    // Option 2 : coupler `a` avec chaque voisin encore disponible.
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

/** Nombre d'arêtes présentes (redondance § 2.4 : combos présents, recouvrements inclus). */
export function countEdges(labels: number[], typeAdj: boolean[][]): number {
  let count = 0;
  for (let a = 0; a < labels.length; a++) {
    for (let b = a + 1; b < labels.length; b++) {
      if (typeAdj[labels[a]]?.[labels[b]]) count++;
    }
  }
  return count;
}
