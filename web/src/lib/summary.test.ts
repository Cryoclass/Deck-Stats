import { describe, expect, it } from 'vitest';
import { computeAll, computePass } from '../engine/index.js';
import type { EngineInput } from '../engine/types.js';
import { ENGINE_VERSION, summaryFromPass, summaryOfState, usableSummary } from './summary.js';
import { cumulativeOf, resolveView } from './statsViews.js';
import { notComputedPass } from '../worker/computeClient.js';

// ─── Étape 9, point 1 : l'aperçu de l'accueil n'est jamais un cache faisant autorité ───

const input: EngineInput = {
  deckSize: 40,
  types: [
    { copies: 3, isHopt: false, isStarter: true, categories: [], deadFirst: false, deadSecond: false },
    { copies: 2, isHopt: false, isStarter: true, categories: [], deadFirst: false, deadSecond: false },
    { copies: 3, isHopt: true, isStarter: false, categories: [0], deadFirst: false, deadSecond: false, availability: 'flexible' },
  ],
  edges: [],
  categories: [{ id: 'c' }],
};
const NOW = new Date('2026-09-09T10:00:00Z');

describe('summaryFromPass', () => {
  it('porte exactement les valeurs du panneau (cumulé « au moins 1 » et brick de la vue Départs)', () => {
    const pass = computePass(input, 'first');
    const s = summaryFromPass(pass, 40, 'v1', NOW)!;
    const view = resolveView(pass, 'starts');
    expect(s).toEqual({ engineVersion: 'v1', mainSize: 40, startRateFirst: cumulativeOf(view.buckets)[1], brickRate: pass.brick, computedAt: NOW.toISOString() });
    expect(s.startRateFirst).toBeGreaterThan(0.3);
    expect(s.startRateFirst + s.brickRate).toBeCloseTo(1, 12);
  });
  it('rend null pour une passe indisponible (aucune valeur inventée)', () => {
    expect(summaryFromPass(notComputedPass('first', 40), 40, 'v1', NOW)).toBeNull();
    expect(summaryFromPass(computePass({ ...input, deckSize: 3, types: [] }, 'first'), 3, 'v1', NOW)).toBeNull();
  });
  it('utilise la version du moteur du build par défaut', () => {
    expect(ENGINE_VERSION).toMatch(/^[0-9a-f]{16}$/);
    expect(summaryFromPass(computePass(input, 'first'), 40)!.engineVersion).toBe(ENGINE_VERSION);
  });
});

describe('usableSummary', () => {
  const ok = { engineVersion: 'v1', mainSize: 40, startRateFirst: 0.7, brickRate: 0.3, computedAt: NOW.toISOString() };
  it('accepte un résumé complet de la version courante', () => {
    expect(usableSummary(ok, 'v1')).toEqual(ok);
  });
  it('refuse un résumé absent, malformé ou d’une autre version du moteur — jamais affiché tel quel', () => {
    expect(usableSummary(null, 'v1')).toBeNull();
    expect(usableSummary(undefined, 'v1')).toBeNull();
    expect(usableSummary({ ...ok, engineVersion: 'v0' }, 'v1')).toBeNull();
    expect(usableSummary({ startRateFirst: 1 }, 'v1')).toBeNull(); // résumé historique (avant l'étape 9)
    expect(usableSummary({ ...ok, startRateFirst: 1.5 }, 'v1')).toBeNull();
    expect(usableSummary({ ...ok, mainSize: 40.5 }, 'v1')).toBeNull();
    expect(usableSummary([ok], 'v1')).toBeNull();
  });
});

describe('summaryOfState', () => {
  const result = computeAll(input);
  const fresh = { deckId: 'd', result, resultContext: { deckId: 'd', deckSize: 40 }, stale: false, computing: false, modelVersion: 4, resultVersion: 4 };
  it('joint le résumé du résultat de la version demandée pour ce deck', () => {
    expect(summaryOfState(fresh, 'v1', NOW)).toEqual(summaryFromPass(result.first, 40, 'v1', NOW));
  });
  it('n’envoie rien d’un résultat périmé, en cours, d’une autre version ou d’un autre deck', () => {
    expect(summaryOfState({ ...fresh, stale: true }, 'v1', NOW)).toBeNull();
    expect(summaryOfState({ ...fresh, computing: true }, 'v1', NOW)).toBeNull();
    expect(summaryOfState({ ...fresh, modelVersion: 5 }, 'v1', NOW)).toBeNull();
    expect(summaryOfState({ ...fresh, resultContext: { deckId: 'other', deckSize: 40 } }, 'v1', NOW)).toBeNull();
    expect(summaryOfState({ ...fresh, result: null }, 'v1', NOW)).toBeNull();
    expect(summaryOfState({ ...fresh, deckId: null, resultContext: { deckId: null, deckSize: 40 } }, 'v1', NOW)).toBeNull();
  });
});
