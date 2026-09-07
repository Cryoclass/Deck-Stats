import { describe, it, expect } from 'vitest';
import { matrixCell, deltaPoints, deltaCount } from './fmt.js';

// ─── Étape 7 (Q1 / Q2) — « · » réservé au zéro exact, même règle que l'Excel ───
// Formats Excel : `0.0%;-0.0%;"·"` (probabilité), `+0.0%;-0.0%;"·"` (delta en points),
// `+0.00;-0.00;"·"` (delta de moyenne). L'arrondi n'a lieu qu'au rendu.

describe('matrixCell — cellule de matrice', () => {
  it('« · » pour le zéro exact seulement', () => {
    expect(matrixCell(0)).toBe('·');
    expect(matrixCell(-0)).toBe('·');
  });
  it('une faible probabilité s’affiche « 0.0 », jamais comme un zéro', () => {
    expect(matrixCell(0.0003)).toBe('0.0');
    expect(matrixCell(0.00049)).toBe('0.0');
    expect(matrixCell(1e-12)).toBe('0.0');
  });
  it('arrondi au dixième de point, au plus proche', () => {
    expect(matrixCell(0.12345)).toBe('12.3');
    expect(matrixCell(0.1235)).toBe('12.3');
    expect(matrixCell(0.00051)).toBe('0.1');
    expect(matrixCell(1)).toBe('100.0');
  });
});

describe('deltaPoints — delta en points de pourcentage', () => {
  it('« · » pour le zéro exact seulement, signe explicite sinon', () => {
    expect(deltaPoints(0)).toBe('·');
    expect(deltaPoints(0.0004)).toBe('+0.0');
    expect(deltaPoints(-0.0004)).toBe('−0.0');
  });
  it('une décimale, signe + ou − (U+2212)', () => {
    expect(deltaPoints(0.0567)).toBe('+5.7');
    expect(deltaPoints(-0.1171)).toBe('−11.7');
    expect(deltaPoints(0.02)).toBe('+2.0');
  });
});

describe('deltaCount — delta d’une moyenne (cartes)', () => {
  it('« · » pour le zéro exact, deux décimales sinon', () => {
    expect(deltaCount(0)).toBe('·');
    expect(deltaCount(0.001)).toBe('+0.00');
    expect(deltaCount(-0.254)).toBe('−0.25');
    expect(deltaCount(0.046)).toBe('+0.05');
  });
});
