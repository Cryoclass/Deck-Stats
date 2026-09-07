import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { computeAll, computePass } from './enumerate.js';
import { buildScorer, drawHands } from './hand.js';
import { queryProbability } from './query.js';
import { toComparisonMatrix } from './compare.js';
import { physicalHands, theoreticalStarts } from './reference/oracle.js';
import type { EngineInput, EngineType } from './types.js';
import { CrossMatrix } from '../components/StatsPanel.js';
import { pct } from '../lib/fmt.js';
vi.mock('../worker/client.js', () => ({ computeInWorker: vi.fn() }));

const type = (over: Partial<EngineType> = {}): EngineType => ({ copies: 1, isHopt: false, isStarter: false, categories: [], ...over });
const input = (types: EngineType[], size = 40): EngineInput => ({ deckSize: size, types, edges: [], categories: [] });

describe('Étape 2 — régressions reliées au moteur', () => {
  it('M01: enlever la dernière cible désactive le starter, delta +30,207 points', () => {
    const result = computeAll(input([
      type({ copies: 3, isStarter: true, starterPrereqs: [{ requiredType: 1, requiredTotal: 1, minInDeck: 1 }] }), type(),
    ]));
    expect(result.deltas[1].first).toBeCloseTo(198765 / 658008, 12);
    expect(pct(222111 / 658008)).toBe('33.76%');
  });

  it('M01: conditions de paire et de starter comparées aux mains physiques après chaque remplacement', () => {
    const deck = ['A', 'A', 'B', 'B', 'T', 'T', 'X', 'X'];
    const names = ['A', 'B', 'T'];
    for (const source of ['card', 'pair']) {
      const model = input(names.map((name) => type({ copies: 2, isStarter: source === 'card' && name === 'A' })), 8);
      const req = [{ requiredType: 2, requiredTotal: 2, minInDeck: 1 }];
      if (source === 'card') model.types[0].starterPrereqs = req;
      else { model.edges = [[0, 1]]; model.edgePrereqs = [req]; }
      const result = computeAll(model);
      for (const size of [5, 6]) {
        const hands = physicalHands(8, size);
        const probability = (cards: string[]) => hands.filter((indices) => {
          if (!cards.some((c, i) => c === 'T' && !indices.includes(i))) return false;
          return theoreticalStarts(indices.map((i) => cards[i]), source === 'card' ? ['A'] : [], source === 'pair' ? [['A', 'B']] : []).starts > 0;
        }).length / hands.length;
        names.forEach((name, index) => {
          const reduced = [...deck];
          reduced[reduced.indexOf(name)] = 'neutral';
          expect(result.deltas[index][size === 5 ? 'first' : 'second']).toBeCloseTo(probability(deck) - probability(reduced), 12);
        });
      }
    }
  });

  it('P05: aucune probabilité, note ou main raccourcie pour un tirage impossible', () => {
    for (const size of [0, 4, 5]) {
      const result = computeAll(input([], size));
      expect(result.second.unavailableReason).toBeTruthy();
      expect(result.second.total).toBe(0);
      expect(queryProbability(result.second, [])).toBeNull();
      expect(() => toComparisonMatrix(result.second,'going_second',{ starterCount:0,nonEngineCount:0 })).toThrow();
      expect(() => buildScorer(result.second, 0.5)(0, 0)).toThrow();
      expect(drawHands([{ cardId: 1, copies: size }], 6, 10)).toEqual([]);
    }
    expect(computePass(input([], 5), 5).total).toBe(1);
  });

  it('rejette explicitement les quantités invalides et les poids au-delà des entiers sûrs', () => {
    for (const model of [input([type({ copies: 1.5 })]), input([type({ copies: 3 })], 2), input([], -1), input([], 1e9)]) {
      expect(computePass(model, 5).unavailableReason).toBeTruthy();
    }
  });

  it('M02: six non-engine rejoignent la cellule 5+ sans perte de masse', () => {
    const model = input(Array.from({ length: 6 }, () => type({ categories: [0], availability: 'flexible' })), 6);
    model.categories = [{ id: 'ne' }];
    const pass = computePass(model, 6);
    const matrix = toComparisonMatrix(pass, 'going_second', { starterCount: 0, nonEngineCount: 6 });
    expect(matrix.cells[0]).toEqual([0, 0, 0, 0, 0, 1]);
    expect(pass.meanNonEngine).toBe(6);
    const html = renderToStaticMarkup(createElement(CrossMatrix, { pass, column: 'second' }));
    expect(html).toContain('5+');
    expect(html).toContain('100.0');
  });

  it('M03: les masses entières conservent exactement les demi-unités des percentiles', () => {
    const pass = computePass(input([], 8), 5);
    pass.buckets = [
      { starts: 0, redundancy: 0, neTotal: 0, neContrib: [], p: 36 / 56, weight: 36 },
      { starts: 1, redundancy: 0, neTotal: 0, neContrib: [], p: 12 / 56, weight: 12 },
      { starts: 2, redundancy: 0, neTotal: 0, neContrib: [], p: 8 / 56, weight: 8 },
    ];
    expect(buildScorer(pass, 0)(1, 0)).toBe(8);
    // Exported/legacy distributions without explicit weights remain readable.
    pass.buckets.forEach((b) => delete b.weight);
    expect(buildScorer(pass, 0)(1, 0)).toBe(8);
  });
});
