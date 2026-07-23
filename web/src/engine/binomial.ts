/**
 * Coefficients binomiaux exacts, mémoïsés. C(60,6) ≈ 5·10^7 et toutes les sommes
 * de poids restent < 2^53 → le type `number` (double IEEE-754) est exact ici.
 */
const cache = new Map<number, number>();

export function binom(n: number, k: number): number {
  if (k < 0 || k > n || n < 0) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  const key = n * 64 + kk;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let result = 1;
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  result = Math.round(result);
  cache.set(key, result);
  return result;
}
