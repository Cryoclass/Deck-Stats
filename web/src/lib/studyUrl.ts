import type { SidePlanPosition } from '../types.js';
import { SIDE_PLAN_POSITIONS } from '../../../server/src/domain/deckConfiguration.js';

// ─── Contexte d'étude dans l'URL (plans de side v2, D1, Q11) ───
// `/decks/:id?contre=<adversaire>&position=second` : la seule mémoire du contexte, qui survit au
// rechargement sans rien écrire (ni configuration, ni brouillon, ni stockage local). Posée par
// `history.replaceState` : changer d'adversaire n'empile pas d'entrée d'historique.

export interface StudyParams {
  matchupId: string | null;
  position: SidePlanPosition | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lit le contexte d'une chaîne de requête ; une valeur inconnue est ignorée, jamais devinée. */
export function studyFromSearch(search: string): StudyParams {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const contre = params.get('contre');
  const position = params.get('position');
  return {
    matchupId: contre && UUID.test(contre) ? contre.toLowerCase() : null,
    position: (SIDE_PLAN_POSITIONS as readonly string[]).includes(position ?? '') ? (position as SidePlanPosition) : null,
  };
}

/** La chaîne de requête d'un contexte : vide pour le deck de base en premier (l'URL d'origine). */
export function searchForStudy(matchupId: string | null, position: SidePlanPosition): string {
  const params = new URLSearchParams();
  if (matchupId) params.set('contre', matchupId);
  if (position !== 'first') params.set('position', position);
  const s = params.toString();
  return s ? `?${s}` : '';
}
