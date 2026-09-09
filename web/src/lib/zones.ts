import type { Zone } from '../types.js';

// ─── Zones du deck (étape 9C) ───
// Le main deck est la seule zone analysée (contrat §2) ; extra et side sont enregistrés et
// éditables, jamais calculés. Libellés partagés par le store (messages de refus), le dialogue
// d'ajout, la grille et le toast d'annulation.

export const ZONES: readonly Zone[] = ['main', 'extra', 'side'];

export const ZONE_LABEL: Record<Zone, string> = { main: 'main deck', extra: 'extra deck', side: 'side deck' };

/** Repère de taille de l'extra et du side (Q5 de l'étape 9) : au-delà, avertissement seulement,
 *  jamais un refus — le main garde son repère 40–60 (contrat §2). */
export const EXTRA_SIDE_SOFT_LIMIT = 15;

/** `true` quand l'extra ou le side dépasse son repère ; le main n'est jamais concerné ici. */
export function overSoftLimit(zone: Zone, count: number): boolean {
  return zone !== 'main' && count > EXTRA_SIDE_SOFT_LIMIT;
}

export const zoneCount = (cards: ReadonlyArray<{ copies: number }>): number => cards.reduce((sum, c) => sum + c.copies, 0);
