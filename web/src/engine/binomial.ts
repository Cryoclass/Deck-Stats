/**
 * Coefficients binomiaux exacts, mémoïsés. C(60,6) ≈ 5·10^7 et toutes les sommes
 * de poids restent < 2^53 → le type `number` (double IEEE-754) est exact ici.
 */
const cache = new Map<string, number>();

export function binom(n: number, k: number): number {
  if (!Number.isSafeInteger(n) || !Number.isInteger(k) || k < 0 || k > n || n < 0) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  const key = `${n}:${kk}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let exact = 1n;
  for (let i = 0; i < kk; i++) {
    exact = (exact * BigInt(n - i)) / BigInt(i + 1);
  }
  const result = Number(exact);
  cache.set(key, result);
  return result;
}
