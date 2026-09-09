import type { Availability } from '../types.js';

/** Effet du prochain clic en mode Non-engine combiné (étape 9B). */
export type NonEngineEffect = 'poser' | 'retirer';

/**
 * Règle unique du mode Non-engine combiné, partagée par le store (ce qui est envoyé) et la
 * grille (ce qui est annoncé) : la carte est conforme au couple (étiquette, profil) si elle
 * porte l'étiquette et, quand un profil est demandé, exactement ce profil ; `wanted === null`
 * = profil inchangé (seule l'étiquette compte). Conforme → le clic retire ; sinon il pose ce
 * qui manque (l'étiquette si absente, le profil s'il diffère).
 */
export function nonEngineEffect(hasLabel: boolean, current: Availability | null, wanted: Availability | null): NonEngineEffect {
  return hasLabel && (wanted === null || current === wanted) ? 'retirer' : 'poser';
}
