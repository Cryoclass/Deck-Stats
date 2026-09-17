import { describe, expect, it } from 'vitest';
import { nonEngineEffect, type NonEngineCardState } from './nonEngine.js';

const card = (over: Partial<NonEngineCardState> = {}): NonEngineCardState => ({ hasLabel: false, profile: null, origin: null, ...over });

describe('Partie D — effet du prochain clic du mode Non-engine (profil, étiquette facultative)', () => {
  it('pose un profil absent ou différent, que la carte soit étiquetée ou non', () => {
    expect(nonEngineEffect(card(), null, 'flexible')).toBe('poser');
    expect(nonEngineEffect(card({ hasLabel: true }), 'ht', 'early')).toBe('poser');
    expect(nonEngineEffect(card({ profile: 'flexible', origin: 'detection' }), null, 'early')).toBe('poser');
    expect(nonEngineEffect(card({ profile: 'flexible', origin: 'choice' }), 'ht', 'early')).toBe('poser');
  });

  it('adopte un profil hérité identique (détection ou référence) : jamais un retrait par surprise', () => {
    expect(nonEngineEffect(card({ profile: 'flexible', origin: 'detection' }), null, 'flexible')).toBe('adopter');
    expect(nonEngineEffect(card({ profile: 'reactive', origin: 'reference', hasLabel: true }), 'ht', 'reactive')).toBe('adopter');
  });

  it('retire le profil choisi (avec l’étiquette demandée) ; sans l’étiquette demandée, pose d’abord l’étiquette', () => {
    expect(nonEngineEffect(card({ profile: 'early', origin: 'choice' }), null, 'early')).toBe('retirer');
    expect(nonEngineEffect(card({ profile: 'early', origin: 'choice', hasLabel: true }), 'ht', 'early')).toBe('retirer');
    expect(nonEngineEffect(card({ profile: 'early', origin: 'choice' }), 'ht', 'early')).toBe('poser');
  });

  it('étiquette seule : bascule l’étiquette ; ni profil ni étiquette : aucun effet', () => {
    expect(nonEngineEffect(card(), 'bb', null)).toBe('poser');
    expect(nonEngineEffect(card({ hasLabel: true, profile: 'flexible', origin: 'detection' }), 'bb', null)).toBe('retirer');
    expect(nonEngineEffect(card({ profile: 'flexible', origin: 'choice' }), null, null)).toBeNull();
  });
});
