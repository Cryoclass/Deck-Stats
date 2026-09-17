import { describe, expect, it } from 'vitest';
import { disagreements } from './ReferencesPage.js';
import type { Card, CardReference } from '../types.js';

// Page /references (partie D) : désaccords d'une référence avec la détection, par aspect.
const SIGMA: Card = { id: 1, name: 'Auto Sigma', type: 'Effect Monster', description: 'When a card or effect is activated that includes any of these effects (Quick Effect): You can discard this card; negate that effect. You can only use this effect of "Auto Sigma" once per turn.' };
const ref = (over: Partial<CardReference>): CardReference => ({ card_id: 1, is_hopt: null, nonengine_set: false, availability: null, group_name: null, note: null, ...over });

describe('disagreements', () => {
  it('signale un aspect qui contredit la détection, jamais un aspect laissé à la détection ni un accord', () => {
    expect(disagreements(ref({ is_hopt: false }), SIGMA)).toEqual(['HOPT : détection oui']);
    expect(disagreements(ref({ is_hopt: true, nonengine_set: true, availability: 'flexible' }), SIGMA)).toEqual([]);
    expect(disagreements(ref({ nonengine_set: true, availability: null }), SIGMA)).toEqual(['non-engine : détection Flexible']);
    expect(disagreements(ref({ nonengine_set: true, availability: 'flexible', group_name: 'Mulcharmy' }), SIGMA)).toHaveLength(1);
  });

  it('carte absente du catalogue : aucun désaccord affirmé', () => {
    expect(disagreements(ref({ is_hopt: true }), undefined)).toEqual([]);
  });
});
