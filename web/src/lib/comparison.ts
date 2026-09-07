import type { EngineInput, PassResult } from '../engine/types.js';
import {
  scenarioCounts,
  toComparisonMatrix,
  type ComparisonDeck,
  type ComparisonWarning,
} from '../engine/compare.js';

// ─── Assemblage d'un deck du comparateur (étape 7) ───
// Extrait de ComparePage.tsx sans changement : ce que le comparateur soumet à
// `compareDecks` est construit ici, en pur, pour que le test d'identité des données
// (dataIdentity.test.ts) suive exactement le chemin de l'écran. `compare.ts` (moteur)
// n'est pas modifié.

/** Deux passes (mode `passes` du worker : sans contributions marginales). */
export interface Passes {
  first: PassResult;
  second: PassResult;
}

export function comparisonDeckOf(name: string, input: EngineInput, passes: Passes): ComparisonDeck {
  return {
    name,
    matrices: {
      going_first: toComparisonMatrix(passes.first, 'going_first', scenarioCounts(input, 'going_first')),
      going_second: toComparisonMatrix(passes.second, 'going_second', scenarioCounts(input, 'going_second')),
    },
  };
}

/** Q5 : une carte étiquetée sans profil compte zéro dans le potentiel — à dire en
 *  clair, sinon un écart non-engine pourrait venir de l'annotation, pas des cartes.
 *  Renvoie `null` s'il n'y a rien à signaler. */
export function unprofiledWarning(name: string, unprofiledCardIds: number[]): ComparisonWarning | null {
  const n = unprofiledCardIds.length;
  if (n === 0) return null;
  const s = n > 1 ? 's' : '';
  return {
    severity: 'warning',
    code: 'unprofiled',
    message: `« ${name} » : ${n} carte${s} non-engine sans profil, non comptée${s} dans le potentiel.`,
  };
}
