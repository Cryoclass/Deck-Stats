export const pct = (x: number, d = 1): string => `${(100 * x).toFixed(d)}%`;

export const signedPct = (x: number, d = 1): string =>
  `${x >= 0 ? '+' : '−'}${(100 * Math.abs(x)).toFixed(d)}%`;

export const num = (x: number, d = 2): string => x.toFixed(d);
