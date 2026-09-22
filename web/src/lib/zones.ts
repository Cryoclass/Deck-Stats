import type { Card, DeckCard, Zone } from '../types.js';
import { deckZoneOfType, type DeckZone } from '../../../server/src/domain/cardDefaults.js';
import { MAX_COPIES } from './ydk.js';
import type { PlanDeck, ZoneOf } from './sidePlan.js';

// ─── Zones du deck (étape 9C, légalité ajoutée par la refonte des plans de side, 22 sept. 2026) ───
// Le main deck est la seule zone analysée (contrat §2) ; extra et side sont enregistrés et
// éditables, jamais calculés. Libellés partagés par le store (messages de refus), le dialogue
// d'ajout, la grille et le toast d'annulation.

export const ZONES: readonly Zone[] = ['main', 'extra', 'side'];

export const ZONE_LABEL: Record<Zone, string> = { main: 'main deck', extra: 'extra deck', side: 'side deck' };

/** Repère de taille de l'extra et du side (Q5 de l'étape 9) : au-delà, avertissement seulement,
 *  jamais un refus — le main garde son repère 40–60 (contrat §2). */
export const EXTRA_SIDE_SOFT_LIMIT = 15;
export const MAIN_MIN = 40;
export const MAIN_MAX = 60;

/** `true` quand l'extra ou le side dépasse son repère ; le main n'est jamais concerné ici. */
export function overSoftLimit(zone: Zone, count: number): boolean {
  return zone !== 'main' && count > EXTRA_SIDE_SOFT_LIMIT;
}

export const zoneCount = (cards: ReadonlyArray<{ copies: number }>): number => cards.reduce((sum, c) => sum + c.copies, 0);

/** Zone de jeu déduite du type de carte (S5), depuis le catalogue chargé : `null` = inconnue. */
export const zoneOfCatalog = (cards: Record<number, Card>): ZoneOf => (cardId) => deckZoneOfType(cards[cardId]?.type);

/** Copies d'une carte toutes zones confondues (S9 : 3 au plus, comme la règle officielle). */
export function totalCopies(deck: PlanDeck, cardId: number): number {
  const of = (list: readonly DeckCard[]) => list.find((c) => c.cardId === cardId)?.copies ?? 0;
  return of(deck.main) + of(deck.extra) + of(deck.side);
}

/** Écart de format du DECK DE BASE (S8, S9). Un échange équilibré conserve les tailles de zone et
 *  le total de chaque carte : le deck sidé est hors format si et seulement si le deck de base l'est.
 *  C'est un avertissement, jamais un refus d'enregistrer ni de calculer (D9, Q9). */
export type DeckIssue =
  | { kind: 'main-size'; size: number }
  | { kind: 'zone-size'; zone: 'extra' | 'side'; size: number }
  | { kind: 'over-total'; cardId: number; total: number; byZone: Record<Zone, number> }
  | { kind: 'wrong-zone'; cardId: number; zone: DeckZone; expected: DeckZone };

export function deckLegality(deck: PlanDeck, zoneOf: ZoneOf): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const mainSize = zoneCount(deck.main);
  if (mainSize < MAIN_MIN || mainSize > MAIN_MAX) issues.push({ kind: 'main-size', size: mainSize });
  for (const zone of ['extra', 'side'] as const) {
    const size = zoneCount(deck[zone]);
    if (size > EXTRA_SIDE_SOFT_LIMIT) issues.push({ kind: 'zone-size', zone, size });
  }
  const seen = new Set<number>();
  for (const zone of ZONES) {
    for (const c of deck[zone]) {
      if (seen.has(c.cardId)) continue;
      seen.add(c.cardId);
      const byZone: Record<Zone, number> = { main: 0, extra: 0, side: 0 };
      for (const z of ZONES) byZone[z] = deck[z].find((x) => x.cardId === c.cardId)?.copies ?? 0;
      const total = byZone.main + byZone.extra + byZone.side;
      if (total > MAX_COPIES) issues.push({ kind: 'over-total', cardId: c.cardId, total, byZone });
    }
  }
  // Une carte d'Extra Deck dans le main, ou l'inverse : illégal, et un plan ne saurait le corriger.
  for (const zone of ['main', 'extra'] as const) {
    for (const c of deck[zone]) {
      const expected = zoneOf(c.cardId);
      if (expected !== null && expected !== zone) issues.push({ kind: 'wrong-zone', cardId: c.cardId, zone, expected });
    }
  }
  return issues;
}

const ZONE_OF_LABEL: Record<DeckZone, string> = { main: 'main deck', extra: 'extra deck' };

export function describeDeckIssue(issue: DeckIssue, name: (cardId: number) => string): string {
  switch (issue.kind) {
    case 'main-size':
      return `Main deck de ${issue.size} cartes — hors des bornes ${MAIN_MIN} à ${MAIN_MAX} du format.`;
    case 'zone-size':
      return `${ZONE_LABEL[issue.zone][0].toUpperCase()}${ZONE_LABEL[issue.zone].slice(1)} de ${issue.size} cartes — ${EXTRA_SIDE_SOFT_LIMIT} au plus.`;
    case 'over-total':
      return `${name(issue.cardId)} : ${issue.total} copies toutes zones confondues (main ${issue.byZone.main}, extra ${issue.byZone.extra}, side ${issue.byZone.side}) — ${MAX_COPIES} au plus.`;
    case 'wrong-zone':
      return `${name(issue.cardId)} : carte d’${ZONE_OF_LABEL[issue.expected]} en ${ZONE_OF_LABEL[issue.zone]}.`;
  }
}
