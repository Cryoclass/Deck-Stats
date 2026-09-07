import type { PassResult } from '../engine/types.js';
import { pct, num } from './fmt.js';

// ─── Vues du panneau de statistiques (étape 7) ───
// Réduction PURE d'une passe aux grandeurs affichées par le panneau (seaux 0/1/2/≥3,
// moyenne, brick). Extraite de StatsPanel.tsx sans changement de comportement pour que
// le test d'identité des données (dataIdentity.test.ts) compare exactement ce que le
// panneau affiche avec ce que le comparateur et l'Excel produisent — jamais une
// réécriture des formules dans le test.

/** Une vue = une distribution parcourable dans le panneau (itération 6). */
export interface StatsView {
  id: string;
  label: string;
  hint?: string;
}

export interface Resolved {
  buckets: [number, number, number, number];
  color: string;
  mean: number;
  meanLabel: string;
  extra?: string;
}

/** Réduit une distribution exacte (P(count=i)) aux 4 seaux d'affichage 0/1/2/≥3. */
export function toBuckets(dist: number[]): [number, number, number, number] {
  const b0 = dist[0] ?? 0;
  const b1 = dist[1] ?? 0;
  const b2 = dist[2] ?? 0;
  let b3 = 0;
  for (let i = 3; i < dist.length; i++) b3 += dist[i] ?? 0;
  return [b0, b1, b2, b3];
}

/** Cumulé « au moins n » affiché en regard de chaque seau : [—, P(≥1), P(≥2), P(≥3)]. */
export function cumulativeOf(buckets: [number, number, number, number]): Array<number | null> {
  const [, b1, b2, b3] = buckets;
  return [null, b1 + b2 + b3, b2 + b3, b3];
}

export function meanFromDist(dist: number[]): number {
  return dist.reduce((s, p, i) => s + (p ?? 0) * i, 0);
}

export function resolveView(pass: PassResult, viewId: string): Resolved {
  if (viewId === 'starts') {
    return {
      buckets: [
        pass.startsBuckets[0] ?? 0,
        pass.startsBuckets[1] ?? 0,
        pass.startsBuckets[2] ?? 0,
        pass.startsBuckets[3] ?? 0,
      ],
      color: '#4fae7a',
      mean: pass.meanStarts,
      meanLabel: 'E[S]',
      extra: `brick ${pct(pass.brick)} · E[red.] ${num(meanFromDist(pass.redundancy))}`,
    };
  }
  if (viewId === 'nonengine') {
    return {
      buckets: toBuckets(pass.nonEngine),
      color: '#5b8def',
      mean: pass.meanNonEngine,
      meanLabel: 'E[U]',
    };
  }
  const cat = pass.perCategory.find((c) => c.id === viewId);
  if (!cat) return { buckets: [0, 0, 0, 0], color: '#5b8def', mean: 0, meanLabel: '' };
  return {
    buckets: toBuckets(cat.dist),
    color: '#5b8def',
    mean: cat.mean,
    meanLabel: 'E[copies]',
  };
}
