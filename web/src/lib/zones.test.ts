import { describe, expect, it } from 'vitest';
import { deckLegality, describeDeckIssue, totalCopies, zoneOfCatalog } from './zones.js';
import type { Card, DeckCard } from '../types.js';

// ─── Plans de side v2 (S8, S9, D9, D10) : légalité du deck de base, jamais un refus ───

const card = (cardId: number, zone: DeckCard['zone'], copies: number): DeckCard => ({ cardId, zone, copies });
const fill = (from: number, n: number, zone: DeckCard['zone'] = 'main'): DeckCard[] => Array.from({ length: n }, (_, i) => card(from + i, zone, 3));
const name = (id: number) => `#${id}`;
const zoneOf = (id: number) => (id >= 500 ? ('extra' as const) : id === 999 ? null : ('main' as const));

describe('deckLegality', () => {
  it('un deck au format ne produit aucun écart', () => {
    const deck = { main: [...fill(1, 13), card(14, 'main', 1)], extra: fill(500, 5, 'extra'), side: fill(100, 5, 'side') };
    expect(deck.main.reduce((n, c) => n + c.copies, 0)).toBe(40);
    expect(deckLegality(deck, zoneOf)).toEqual([]);
  });

  it('nomme le main hors 40–60 et un extra ou side au-delà de 15, sans rien refuser', () => {
    const small = { main: fill(1, 3), extra: [], side: [] };
    expect(deckLegality(small, zoneOf)).toEqual([{ kind: 'main-size', size: 9 }]);
    const big = { main: [...fill(1, 13), card(14, 'main', 1)], extra: [...fill(500, 5, 'extra'), card(505, 'extra', 1)], side: [...fill(100, 5, 'side'), card(105, 'side', 2)] };
    expect(deckLegality(big, zoneOf)).toEqual([{ kind: 'zone-size', zone: 'extra', size: 16 }, { kind: 'zone-size', zone: 'side', size: 17 }]);
  });

  it('3 copies toutes zones confondues (S9) : la même carte en main et en side se cumule', () => {
    const deck = { main: [...fill(1, 13), card(14, 'main', 1)], extra: [], side: [card(1, 'side', 1), card(14, 'side', 2)] };
    expect(deckLegality(deck, zoneOf)).toEqual([{ kind: 'over-total', cardId: 1, total: 4, byZone: { main: 3, extra: 0, side: 1 } }]);
    expect(totalCopies(deck, 1)).toBe(4);
    expect(totalCopies(deck, 14)).toBe(3);
    expect(totalCopies(deck, 77)).toBe(0);
  });

  it('une carte d’Extra Deck dans le main, ou l’inverse, est nommée ; une zone inconnue ne l’est pas', () => {
    const deck = { main: [...fill(1, 13), card(500, 'main', 1)], extra: [card(2, 'extra', 1), card(999, 'extra', 1)], side: [] };
    expect(deckLegality(deck, zoneOf)).toEqual([
      { kind: 'over-total', cardId: 2, total: 4, byZone: { main: 3, extra: 1, side: 0 } },
      { kind: 'wrong-zone', cardId: 500, zone: 'main', expected: 'extra' },
      { kind: 'wrong-zone', cardId: 2, zone: 'extra', expected: 'main' },
    ]);
  });

  it('messages en clair', () => {
    expect(describeDeckIssue({ kind: 'main-size', size: 39 }, name)).toBe('Main deck de 39 cartes — hors des bornes 40 à 60 du format.');
    expect(describeDeckIssue({ kind: 'zone-size', zone: 'side', size: 16 }, name)).toBe('Side deck de 16 cartes — 15 au plus.');
    expect(describeDeckIssue({ kind: 'over-total', cardId: 1, total: 4, byZone: { main: 3, extra: 0, side: 1 } }, name)).toBe('#1 : 4 copies toutes zones confondues (main 3, extra 0, side 1) — 3 au plus.');
    expect(describeDeckIssue({ kind: 'wrong-zone', cardId: 500, zone: 'main', expected: 'extra' }, name)).toBe('#500 : carte d’extra deck en main deck.');
  });
});

describe('zoneOfCatalog', () => {
  it('déduit la zone du type au catalogue chargé ; carte absente ou sans type = inconnue', () => {
    const cards: Record<number, Card> = { 1: { id: 1, name: 'A', type: 'Effect Monster' }, 2: { id: 2, name: 'B', type: 'XYZ Pendulum Effect Monster' }, 3: { id: 3, name: 'C', type: null }, 4: { id: 4, name: 'D', type: 'Token' } };
    const zoneOf = zoneOfCatalog(cards);
    expect([zoneOf(1), zoneOf(2), zoneOf(3), zoneOf(4), zoneOf(5)]).toEqual(['main', 'extra', null, null, null]);
  });
});
