export const pct = (x: number, d = 2): string => `${(100 * x).toFixed(d)}%`;

export const signedPct = (x: number, d = 2): string =>
  `${x >= 0 ? '+' : '−'}${(100 * Math.abs(x)).toFixed(d)}%`;

export const num = (x: number, d = 2): string => x.toFixed(d);

// ─── Cellules de matrice et deltas (étape 7, Q1 / Q2) ───
// Mêmes règles que les formats de nombre de l'export Excel : `0.0%;-0.0%;"·"` pour une
// probabilité, `+0.0%;-0.0%;"·"` pour un delta en points, `+0.00;-0.00;"·"` pour une
// moyenne. « · » est réservé au ZÉRO EXACT : une faible valeur s'affiche « 0.0 » (ou
// « +0.0 »), jamais comme un zéro (contrat §5). L'arrondi n'a lieu qu'ici, au rendu ;
// la valeur fine reste accessible dans l'infobulle.

/** Probabilité en % à une décimale, sans le signe % (cellule de matrice). */
export const matrixCell = (v: number): string => (v === 0 ? '·' : (100 * v).toFixed(1));

/** Delta en points de pourcentage, signe explicite, une décimale. */
export const deltaPoints = (d: number): string =>
  d === 0 ? '·' : `${d > 0 ? '+' : '−'}${(100 * Math.abs(d)).toFixed(1)}`;

/** Delta d'une moyenne (unité : cartes), signe explicite, deux décimales. */
export const deltaCount = (d: number): string =>
  d === 0 ? '·' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
