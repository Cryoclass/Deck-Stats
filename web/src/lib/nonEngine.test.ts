import { describe, expect, it } from 'vitest';
import { nonEngineEffect } from './nonEngine.js';

describe('Étape 9B — effet du prochain clic du mode Non-engine combiné', () => {
  it('pose ce qui manque : étiquette absente, ou profil différent de celui demandé', () => {
    expect(nonEngineEffect(false, null, null)).toBe('poser');
    expect(nonEngineEffect(false, 'flexible', 'flexible')).toBe('poser');
    expect(nonEngineEffect(true, null, 'early')).toBe('poser');
    expect(nonEngineEffect(true, 'flexible', 'early')).toBe('poser');
  });

  it('retire quand la carte porte exactement le couple ; « profil inchangé » ne regarde que l’étiquette', () => {
    expect(nonEngineEffect(true, 'early', 'early')).toBe('retirer');
    expect(nonEngineEffect(true, null, null)).toBe('retirer');
    expect(nonEngineEffect(true, 'flexible', null)).toBe('retirer');
  });
});
