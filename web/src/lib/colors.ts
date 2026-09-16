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

/**
 * Cartes de chaleur (charte §9.3 et §9.4) : UNE formule, deux consommateurs (panneau
 * Probabilités et comparateur). Elle était copiée à l'identique dans les deux fichiers.
 *
 * La case est OPAQUE : la teinte est mélangée à `ink-900` (`color-mix`, équivalent exact
 * d'une superposition à l'opacité α), quel que soit le fond du panneau. C'est ce qui permet
 * un choix de texte exact : blanc pur, puis noir au-delà de `HEAT_INK_FROM` pour le vert.
 * Au point de bascule noir et blanc se valent ; aucun seuil unique ne tenait 4,5:1 sur deux
 * fonds différents (4,49 au mieux), un fond fixe le permet (4,58 au pire). Le rouge, plus
 * sombre, garde le blanc sur toute l'échelle (5,75 au pire). Vérifié par `tokens.test.ts`
 * contre les valeurs de `index.css`.
 */
export const HEAT_MAX_ALPHA = 0.85;
export const HEAT_GREEN = 'oklch(0.7 0.13 155)';
export const HEAT_RED = 'oklch(0.58 0.17 25)';
/** Opacité du vert à partir de laquelle le texte noir contraste mieux que le blanc (sur ink-900). */
export const HEAT_INK_FROM = 0.6685;

function heat(hue: string, alpha: number, inkFrom: number): { background?: string; color?: string } {
  if (alpha <= 0) return {};
  return {
    background: `color-mix(in srgb, ${hue} ${(alpha * 100).toFixed(2)}%, var(--ink-900))`,
    color: alpha >= inkFrom ? '#000' : '#fff',
  };
}

/** Séquentielle : vert dont l'opacité suit la valeur rapportée au maximum de la matrice. */
export function heatCell(value: number, max: number): { background?: string; color?: string } {
  return heat(HEAT_GREEN, (Math.max(0, value) / Math.max(max, 1e-9)) * HEAT_MAX_ALPHA, HEAT_INK_FROM);
}

/** Divergente : vert au-dessus de zéro, rouge en dessous, bornes ±2 points. */
export function heatDelta(d: number): { background?: string; color?: string } {
  const alpha = Math.min(Math.abs(d) / 0.02, 1) * HEAT_MAX_ALPHA;
  return d > 0 ? heat(HEAT_GREEN, alpha, HEAT_INK_FROM) : d < 0 ? heat(HEAT_RED, alpha, Infinity) : {};
}

/**
 * Séries des distributions (charte §9.1) : deux couleurs, posées ici et nulle part ailleurs.
 * Elles étaient en dur dans `statsViews.ts` (audit 01 §2.1).
 */
export const SERIES_STARTS = '#4fae7a';
export const SERIES_COUNT = '#5b8def';
