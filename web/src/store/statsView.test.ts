import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { saveDraft } from '../lib/draft.js';
import { useDeck } from './deckStore.js';
import { emptyConfiguration, parseConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { configurationFromState, stateFromConfiguration } from '../lib/deckConfiguration.js';

// Étape 9B — la vue du panneau de stats est transitoire comme le contexte : changer de vue ne
// salit pas le deck, la vue n'est jamais émise, une valeur héritée est acceptée en lecture et ignorée.
vi.mock('../worker/client.js',() => ({ createEngineClient: () => ({ compute: () => ({ id: 0,promise: new Promise(() => {}),cancel() {} }),cancelAll() {},dispose() {},pendingCount: 0 }) }));
vi.mock('../lib/draft.js',() => ({ saveDraft: vi.fn(async () => {}),clearDraft: vi.fn(async () => {}),loadDraft: vi.fn(async () => null) }));
vi.mock('../lib/api.js',async (original) => {
  const actual=await original<typeof import('../lib/api.js')>();
  return { ...actual,api:{ ...actual.api,saveConfiguration:vi.fn() } };
});
const deckId='00000000-0000-4000-8000-000000000001';
const cards=[{ card_id:1,zone:'main' as const,copies:3 },{ card_id:2,zone:'main' as const,copies:3 }];
beforeEach(() => {
  vi.useFakeTimers();vi.clearAllMocks();
  useDeck.setState(useDeck.getInitialState(),true);
  useDeck.setState({ ...stateFromConfiguration(emptyConfiguration('Deck',cards)),deckId,revision:1 });
});
afterEach(() => { vi.clearAllTimers();vi.useRealTimers(); });

describe('Étape 9B — vue du panneau transitoire',() => {
  it('changer de vue ne salit pas : ni « non enregistré », ni brouillon, ni recalcul',() => {
    const { modelVersion }=useDeck.getState();
    useDeck.getState().setStatsView('nonengine');
    expect(useDeck.getState()).toMatchObject({ statsView:'nonengine',dirty:false,editRevision:0,modelVersion });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(useDeck.getState().draftAvailable).toBeNull();
  });

  it('la vue n’est jamais émise dans les paramètres enregistrés',async () => {
    useDeck.getState().setStatsView('nonengine');
    expect(configurationFromState(useDeck.getState()).params).toEqual({ importance:0.5,savedQueries:[] });
    vi.mocked(api.saveConfiguration).mockResolvedValue({ revision:2 });
    useDeck.getState().renameDeck('Vue');
    await useDeck.getState().saveDeck();
    const [,snapshot]=vi.mocked(api.saveConfiguration).mock.calls[0];
    expect(snapshot.params).not.toHaveProperty('statsView');
    expect(useDeck.getState()).toMatchObject({ dirty:false,statsView:'nonengine' });
  });

  it('une configuration enregistrée avant 9B qui porte encore une vue est acceptée en lecture et la vue ignorée',() => {
    const legacy=emptyConfiguration('Ancien',cards);
    legacy.params={ importance:0.25,statsView:'nonengine',savedQueries:[] };
    const configuration=parseConfiguration(legacy); // validateParams reste permissif
    const state=stateFromConfiguration(configuration);
    expect(state).not.toHaveProperty('statsView');
    expect(state.importance).toBe(0.25);
    useDeck.setState({ statsView:'starts' });
    useDeck.setState({ ...state });
    expect(useDeck.getState().statsView).toBe('starts');
    expect(configurationFromState(useDeck.getState()).params).not.toHaveProperty('statsView');
  });
});
