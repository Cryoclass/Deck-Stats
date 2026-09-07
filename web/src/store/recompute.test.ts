import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api, type DeckDetail } from '../lib/api.js';
import { clearDraft, loadDraft, type DeckDraft } from '../lib/draft.js';
import { emptyConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { stateFromConfiguration } from '../lib/deckConfiguration.js';
import { computeAll } from '../engine/index.js';
import type { EngineInput } from '../engine/types.js';
import type { Card, Library } from '../types.js';
import type { ComputeClient, ComputeOutput } from '../worker/computeClient.js';
import type { createFakeSpawner } from '../worker/fakeWorker.js';
import * as workerClient from '../worker/client.js';
import { COMPUTE_DEBOUNCE_MS, useDeck } from './deckStore.js';

// ─── Étape 4 — recalcul : faux worker contrôlable + horloge simulée ───
// Le store reçoit un client construit sur le VRAI `computeClient` et un faux worker
// (`fakeWorker.ts`) : le test décide quand chaque requête reçoit sa réponse. Un mode
// « naïf » (client qui n'annule rien) isole la seconde garde, le versionnement du
// store, indépendamment de l'annulation.

interface NaiveTask {
  id: number;
  input: EngineInput;
  resolve: (out: ComputeOutput) => void;
}
interface Harness {
  spawner: ReturnType<typeof createFakeSpawner>;
  real: ComputeClient;
  naive: { on: boolean; tasks: NaiveTask[] };
}

vi.mock('../worker/client.js', async () => {
  const { createComputeClient } = await import('../worker/computeClient.js');
  const { createFakeSpawner } = await import('../worker/fakeWorker.js');
  const spawner = createFakeSpawner();
  const real = createComputeClient(spawner.spawn);
  const naive: Harness['naive'] = { on: false, tasks: [] };
  let seq = 1000;
  const client: ComputeClient = {
    compute(input, mode) {
      if (!naive.on) return real.compute(input, mode);
      const id = ++seq;
      let resolve!: (out: ComputeOutput) => void;
      const promise = new Promise<ComputeOutput>((r) => {
        resolve = r;
      });
      naive.tasks.push({ id, input, resolve });
      return { id, promise, cancel() {} }; // naïf : n'annule jamais
    },
    cancelAll: () => real.cancelAll(),
    dispose: () => real.dispose(),
    get pendingCount() {
      return real.pendingCount;
    },
  };
  return { createEngineClient: () => client, __harness: { spawner, real, naive } satisfies Harness };
});
vi.mock('../lib/draft.js', () => ({
  saveDraft: vi.fn(async () => {}),
  clearDraft: vi.fn(async () => {}),
  loadDraft: vi.fn(async () => null),
}));
vi.mock('../lib/api.js', async (original) => {
  const actual = await original<typeof import('../lib/api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      saveConfiguration: vi.fn(),
      getLibrary: vi.fn(),
      getDeck: vi.fn(),
      cardsByIds: vi.fn(async () => []),
      setFlags: vi.fn(),
    },
  };
});

const { spawner, real, naive } = (workerClient as unknown as { __harness: Harness }).__harness;
const state = () => useDeck.getState();
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const deckId = '00000000-0000-4000-8000-000000000001';
const mainCards = (ids: number[]) => ids.map((card_id) => ({ card_id, zone: 'main' as const, copies: 3 }));
function seed(ids = [1, 2]): void {
  useDeck.setState({ ...stateFromConfiguration(emptyConfiguration('Deck', mainCards(ids))), deckId, revision: 1 });
}
function detail(id: string, name: string, revision = 1): DeckDetail {
  return {
    id,
    name,
    revision,
    configuration_version: 2,
    cards: mainCards([1, 2]),
    starters: [1],
    pairs: [],
    pair_exclusions: [],
    conditions: [],
    deadFirst: [],
    deadSecond: [],
    params: {},
    notes: null,
    updated_at: '2026-09-07T00:00:00Z',
  };
}
const library: Library = { hoptCardIds: [], categories: [], cardCategories: [], profiles: [], groups: [] };
/** Lance le calcul courant : expire le délai et renvoie l'id de la requête postée. */
function launch(): number {
  vi.advanceTimersByTime(COMPUTE_DEBOUNCE_MS);
  const w = spawner.latest();
  return w.requests[w.requests.length - 1].id;
}
/** Calcul complet adopté : lance, répond, laisse le store adopter. */
async function settle(): Promise<void> {
  const id = launch();
  spawner.latest().respond(id);
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  real.cancelAll(); // tâche éventuellement laissée par un test précédent
  spawner.workers.length = 0;
  naive.on = false;
  naive.tasks.length = 0;
  useDeck.setState(useDeck.getInitialState(), true);
  vi.mocked(api.getLibrary).mockResolvedValue(library);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Étape 4 — recalcul', () => {
  it('sans résultat précédent : état initial de calcul, puis adoption avec version et contexte', async () => {
    seed();
    state().recompute();
    expect(state()).toMatchObject({ result: null, computing: true, stale: false, modelVersion: 1, computeError: null });
    vi.advanceTimersByTime(COMPUTE_DEBOUNCE_MS - 1);
    expect(spawner.workers).toHaveLength(0); // rien n'est lancé avant le délai
    vi.advanceTimersByTime(1);
    const id = spawner.latest().requests[0].id;
    spawner.latest().respond(id, 12);
    await flush();
    expect(state()).toMatchObject({ computing: false, stale: false, resultVersion: 1, modelVersion: 1, computeMs: 12 });
    expect(state().result?.first.total).toBe(6); // C(6, 5)
    expect(state().resultContext).toMatchObject({ deckId, deckSize: 6, unprofiledCardIds: [] });
  });

  it("contre-exemple : lancer A, modifier vers B, résoudre A avant le délai de B → A n'est jamais adopté", async () => {
    naive.on = true; // aucune annulation : seul le versionnement protège
    seed();
    state().toggleStarter(1); // version 1 → A
    vi.advanceTimersByTime(COMPUTE_DEBOUNCE_MS);
    expect(naive.tasks).toHaveLength(1);
    vi.advanceTimersByTime(10);
    state().toggleStarter(2); // version 2 → B, avant l'expiration de son délai
    expect(state()).toMatchObject({ modelVersion: 2, computing: true, result: null });
    const a = naive.tasks[0];
    a.resolve({ result: computeAll(a.input), ms: 1 }); // A répond pendant le délai de B
    await flush();
    expect(state().result).toBeNull(); // A n'est pas adopté
    expect(state().computing).toBe(true);
    vi.advanceTimersByTime(COMPUTE_DEBOUNCE_MS - 1); // le délai de B court depuis SA mutation
    expect(naive.tasks).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(naive.tasks).toHaveLength(2);
    const b = naive.tasks[1];
    expect(b.input.types.filter((t) => t.isStarter)).toHaveLength(2); // B = l'état après les deux clics
    b.resolve({ result: computeAll(b.input), ms: 2 });
    await flush();
    expect(state()).toMatchObject({ resultVersion: 2, computing: false, stale: false, computeMs: 2 });
    expect(state().model?.input).toEqual(b.input);
    // Une seconde réponse tardive de A, après l'adoption de B, est ignorée elle aussi.
    a.resolve({ result: computeAll(a.input), ms: 99 });
    await flush();
    expect(state()).toMatchObject({ resultVersion: 2, computeMs: 2 });
  });

  it('invalidation immédiate : dès la mutation, avant le délai, le résultat est périmé mais garde son contexte', async () => {
    seed();
    state().recompute();
    await settle();
    const r1 = state().result;
    expect(r1).not.toBeNull();
    // Nouvelle carte ET nouvelle catégorie : ni la taille ni les libellés du résultat affiché ne bougent.
    useDeck.setState({ categories: [{ id: 'cat-1', name: 'Handtrap', is_builtin: false }], cardCategories: new Map([[3, new Set(['cat-1'])]]) });
    state().addCard({ id: 3, name: 'C' } as Card, 3);
    expect(state()).toMatchObject({ stale: true, computing: true, modelVersion: 2, resultVersion: 1, computeError: null });
    expect(state().result).toBe(r1);
    expect(state().resultContext).toMatchObject({ deckSize: 6, categories: [] });
    expect(spawner.latest().requests).toHaveLength(1); // aucun calcul lancé avant le délai
    await settle();
    expect(state()).toMatchObject({ stale: false, computing: false, resultVersion: 2 });
    expect(state().result).not.toBe(r1);
    // La carte 3 est étiquetée sans profil : signalée avec le résultat qui la connaît (Q5).
    expect(state().resultContext).toMatchObject({ deckSize: 9, categories: [{ id: 'cat-1', name: 'Handtrap' }], unprofiledCardIds: [3] });
    expect(state().result?.second.perCategory[0].mean).toBeGreaterThan(0); // copies brutes comptées
    expect(state().result?.second.meanNonEngine).toBe(0); // potentiel nul sans profil
  });

  it('un calcul en cours pour une version antérieure est annulé : worker terminé, tâche B sur un worker neuf', async () => {
    seed();
    state().recompute();
    const idA = launch();
    const w0 = spawner.latest();
    expect(w0.terminated).toBe(false);
    state().toggleStarter(1); // invalidation pendant le calcul de A
    expect(w0.terminated).toBe(true); // ressources libérées immédiatement
    expect(state()).toMatchObject({ computing: true, computeError: null, result: null });
    expect(real.pendingCount).toBe(0);
    const idB = launch();
    expect(spawner.workers).toHaveLength(2);
    expect(spawner.latest()).not.toBe(w0);
    w0.respond(idA); // un worker terminé ne répond plus : sans effet
    expect(state().result).toBeNull();
    spawner.latest().respond(idB);
    await flush();
    expect(state()).toMatchObject({ computing: false, stale: false, resultVersion: 2, computeError: null });
    expect(state().model?.input.types.filter((t) => t.isStarter)).toHaveLength(1);
  });

  it("une erreur conserve l'ancien résultat, explicitement obsolète, et la relance aboutit", async () => {
    seed();
    state().recompute();
    await settle();
    const r1 = state().result;
    state().toggleStarter(1);
    const id = launch();
    spawner.latest().fail(id, 'Deck trop grand pour un calcul exact.');
    await flush();
    expect(state()).toMatchObject({ computing: false, stale: true, computeError: 'Deck trop grand pour un calcul exact.', resultVersion: 1, modelVersion: 2 });
    expect(state().result).toBe(r1);
    state().recompute();
    expect(state()).toMatchObject({ computing: true, stale: true, computeError: null, modelVersion: 3 });
    await settle();
    expect(state()).toMatchObject({ computing: false, stale: false, computeError: null, resultVersion: 3 });
    expect(state().result).not.toBe(r1);
  });

  it("changement de deck : le calcul en cours est annulé et aucune statistique de l'ancien deck n'est affichée", async () => {
    seed();
    state().recompute();
    await settle();
    state().toggleStarter(1);
    launch(); // calcul de A en cours, jamais répondu
    const w0 = spawner.latest();
    vi.mocked(api.getDeck).mockResolvedValue(detail('B', 'Deck B'));
    await state().loadDeck('B');
    expect(w0.terminated).toBe(true);
    expect(state()).toMatchObject({ deckId: 'B', result: null, model: null, resultContext: null, stale: false, computing: true, computeError: null });
    await settle();
    expect(state().resultContext).toMatchObject({ deckId: 'B', deckSize: 6 });
    expect(state().model?.input.types.filter((t) => t.isStarter)).toHaveLength(1); // starter de B, pas de A
  });

  it("deux chargements résolus à l'envers : l'état est celui du dernier demandé, brouillon compris", async () => {
    const dA = deferred<DeckDetail>();
    const dB = deferred<DeckDetail>();
    vi.mocked(api.getDeck).mockImplementation((id) => (id === 'A' ? dA.promise : dB.promise));
    const draftA: DeckDraft = { version: 2, deckId: 'A', updatedAt: 1, baseRevision: 1, configuration: emptyConfiguration('Brouillon A', mainCards([1, 2, 3])) };
    vi.mocked(loadDraft).mockImplementation(async (id) => (id === 'A' ? draftA : null));
    const pA = state().loadDeck('A');
    const pB = state().loadDeck('B');
    dB.resolve(detail('B', 'Deck B', 5));
    await pB;
    expect(state()).toMatchObject({ deckId: 'B', deckName: 'Deck B', revision: 5, opening: 2 });
    dA.resolve(detail('A', 'Deck A', 3));
    await pA;
    expect(state()).toMatchObject({ deckId: 'B', deckName: 'Deck B', revision: 5, draftAvailable: null, persistenceError: null });
    await settle();
    expect(state().resultContext?.deckId).toBe('B');
  });

  it("revenir sur A avant la réponse de sauvegarde : l'édition plus récente reste non enregistrée", async () => {
    vi.mocked(api.getDeck).mockImplementation(async (id) => detail(id, `Deck ${id}`, 1));
    await state().loadDeck('A');
    state().renameDeck('Édité');
    const save = deferred<{ revision: number }>();
    vi.mocked(api.saveConfiguration).mockReturnValue(save.promise);
    const saving = state().saveDeck();
    await state().loadDeck('B');
    await state().loadDeck('A'); // même deck, nouvelle ouverture : editRevision repart à 0
    expect(state()).toMatchObject({ deckId: 'A', deckName: 'Deck A', dirty: false, editRevision: 0, revision: 1 });
    state().renameDeck('Plus récent');
    expect(state()).toMatchObject({ dirty: true, editRevision: 1 }); // même editRevision que celle capturée par la sauvegarde
    save.resolve({ revision: 2 });
    await saving;
    expect(state()).toMatchObject({ deckName: 'Plus récent', dirty: true, revision: 1, saving: false, persistenceError: null });
    expect(vi.mocked(clearDraft).mock.calls.at(-1)).toEqual(['A', expect.objectContaining({ name: 'Édité' })]);
  });

  it("une annotation globale n'invalide les statistiques qu'après acquittement du serveur", async () => {
    seed();
    state().toggleStarter(1); // la carte doit être annotée pour être un type du modèle
    await settle();
    const request = deferred<{ ok: boolean; is_hopt: boolean; availability: null; group_id: null }>();
    vi.mocked(api.setFlags).mockReturnValue(request.promise);
    state().toggleHopt(1);
    await flush();
    expect(state()).toMatchObject({ stale: false, computing: false, modelVersion: 1 });
    request.resolve({ ok: true, is_hopt: true, availability: null, group_id: null });
    await flush();
    await flush();
    expect(state()).toMatchObject({ stale: true, computing: true, modelVersion: 2 });
    await settle();
    expect(state().model?.input.types[0].isHopt).toBe(true);
  });
});
