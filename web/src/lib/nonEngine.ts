import type { AnnotationOrigin, Availability } from '../types.js';

/**
 * Effet du prochain clic du mode Non-engine (annotations par défaut, partie D) :
 * `poser` = profil (et étiquette) posés ; `adopter` = le profil hérité est déjà celui du mode, il
 * devient le choix du compte (chiffres inchangés) ; `retirer` = la carte porte déjà le choix
 * demandé, le clic le retire.
 */
export type NonEngineEffect = 'poser' | 'adopter' | 'retirer';

/** Ce que la carte porte, vu par le store : étiquette du mode, profil effectif et son origine. */
export interface NonEngineCardState {
  hasLabel: boolean;
  profile: Availability | null;
  origin: AnnotationOrigin | null;
}

/**
 * Règle unique du mode Non-engine, partagée par le store (ce qui est envoyé) et la grille (ce qui
 * est annoncé). Le mode porte un profil (`null` = étiquette seule) et une étiquette facultative
 * (`null` = aucune) ; depuis le 16 septembre 2026 le profil seul fait compter la carte (D14′).
 *
 * - Étiquette seule : bascule l'étiquette (le profil n'est jamais touché).
 * - Profil demandé : si la carte porte déjà ce profil en CHOIX (et l'étiquette demandée), le clic
 *   retire le profil (choix « pas non-engine ») et l'étiquette ; si elle le porte par héritage
 *   (détection, référence), le clic l'ADOPTE — réponse de l'utilisateur du 17 septembre 2026 :
 *   confirmer une détection ne l'efface jamais ; sinon le clic pose.
 * - Ni profil ni étiquette : aucun effet.
 */
export function nonEngineEffect(card: NonEngineCardState, wantedLabel: string | null, wantedProfile: Availability | null): NonEngineEffect | null {
  if (wantedProfile === null) return wantedLabel === null ? null : card.hasLabel ? 'retirer' : 'poser';
  if (card.profile !== wantedProfile) return 'poser';
  if (card.origin !== 'choice') return 'adopter';
  return wantedLabel === null || card.hasLabel ? 'retirer' : 'poser';
}
