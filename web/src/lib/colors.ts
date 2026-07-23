/**
 * Couleurs de combo (§4.2 / §E) : espace perceptuel, angle d'or pour l'écart
 * maximal entre teintes, luminosité + chroma fixes pour rester lisible en
 * surimpression sur les artworks. Non stockées : dérivées à l'affichage (§A).
 */
const GOLDEN_ANGLE = 137.508;

export function comboHue(index: number): number {
  return (index * GOLDEN_ANGLE + 20) % 360;
}

/** Couleur pleine (pastille). */
export function comboColor(index: number): string {
  return `oklch(0.72 0.15 ${comboHue(index)})`;
}

/** Voile translucide teinté par-dessus l'artwork de la carte pivot. */
export function comboVeil(index: number, alpha = 0.42): string {
  return `oklch(0.68 0.16 ${comboHue(index)} / ${alpha})`;
}

export interface GroupAssignment {
  /** cardId pivot → index de couleur. */
  colorOf: Map<number, number>;
  /** cardId → indices de couleur des pastilles qu'elle porte. */
  pastillesOf: Map<number, number[]>;
}

/**
 * Choix des pivots (colorés) vs pastilles — décision d'affichage seule, le calcul
 * n'en dépend pas (§D point ouvert 2). Heuristique : couverture gloutonne par
 * degré décroissant → le « hub » d'un groupe devient pivot, ses voisins reçoivent
 * sa pastille. Réciprocité gérée : une arête n'est jamais dessinée deux fois.
 */
export function assignGroups(edges: Array<[number, number]>): GroupAssignment {
  const adj = new Map<number, Set<number>>();
  for (const [a, b] of edges) {
    if (a === b) continue;
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  }
  const nodes = [...adj.keys()].sort((x, y) => {
    const d = (adj.get(y)?.size ?? 0) - (adj.get(x)?.size ?? 0);
    return d !== 0 ? d : x - y;
  });

  const colorOf = new Map<number, number>();
  const covered = new Set<string>();
  const key = (a: number, b: number) => (a <= b ? `${a}:${b}` : `${b}:${a}`);

  let next = 0;
  for (const node of nodes) {
    const hasUncovered = [...(adj.get(node) ?? [])].some((n) => !covered.has(key(node, n)));
    if (!hasUncovered) continue;
    colorOf.set(node, next++);
    for (const n of adj.get(node) ?? []) covered.add(key(node, n));
  }

  const pastillesOf = new Map<number, number[]>();
  const addPastille = (card: number, color: number) => {
    const arr = pastillesOf.get(card) ?? [];
    if (!arr.includes(color)) arr.push(color);
    pastillesOf.set(card, arr);
  };
  for (const [a, b] of edges) {
    if (a === b) continue;
    const ca = colorOf.get(a);
    const cb = colorOf.get(b);
    if (ca !== undefined && cb === undefined) addPastille(b, ca);
    else if (cb !== undefined && ca === undefined) addPastille(a, cb);
  }

  return { colorOf, pastillesOf };
}
