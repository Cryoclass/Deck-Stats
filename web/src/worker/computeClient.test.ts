import { describe, expect, it } from 'vitest';
import type { EngineInput } from '../engine/types.js';
import { ComputeCancelled, ComputeFailed, createComputeClient } from './computeClient.js';
import { createFakeSpawner } from './fakeWorker.js';

// Étape 4 — propriété des tâches du worker et fin de toute promesse.
// Le worker traite ses messages dans l'ordre : la première tâche attendue est celle
// qu'il exécute. L'annuler exige de terminer le worker ; les suivantes sont reposées.

const input: EngineInput = {
  deckSize: 40,
  types: [{ copies: 3, isHopt: false, isStarter: true, categories: [] }],
  edges: [],
  categories: [],
};
const settled = <T,>(p: Promise<T>) =>
  p.then(
    (value) => ({ status: 'ok' as const, value }),
    (error: unknown) => ({ status: 'error' as const, error }),
  );

describe('Étape 4 — client de calcul', () => {
  it('résout une tâche avec le résultat du worker et ignore une réponse inconnue', async () => {
    const spawner = createFakeSpawner();
    const client = createComputeClient(spawner.spawn);
    const task = client.compute(input);
    expect(spawner.workers).toHaveLength(1);
    expect(spawner.latest().requests.map((r) => r.id)).toEqual([task.id]);
    spawner.latest().onmessage?.({ data: { id: 999, error: 'inconnue' } });
    expect(client.pendingCount).toBe(1);
    spawner.latest().respond(task.id, 7);
    const out = await task.promise;
    expect(out.ms).toBe(7);
    expect(out.result.first.brick).toBeCloseTo(1 - 0.33755, 4);
    expect(client.pendingCount).toBe(0);
  });

  it('annuler la tâche en cours termine le worker, la rejette et repose les suivantes sur un worker neuf', async () => {
    const spawner = createFakeSpawner();
    const client = createComputeClient(spawner.spawn);
    const a = client.compute(input);
    const b = client.compute(input, 'passes');
    const first = spawner.latest();
    a.cancel();
    a.cancel(); // idempotent
    expect(first.terminated).toBe(true);
    await expect(a.promise).rejects.toBeInstanceOf(ComputeCancelled);
    expect(spawner.workers).toHaveLength(2);
    const second = spawner.latest();
    expect(second.requests).toEqual([{ id: b.id, input, mode: 'passes' }]);
    first.respond(a.id); // un worker terminé ne répond plus : sans effet
    second.respond(b.id);
    const out = await b.promise;
    expect(out.result.deltas).toEqual([]);
    expect(client.pendingCount).toBe(0);
  });

  it("annuler une tâche pas encore commencée ne termine rien ; sa réponse tardive est ignorée", async () => {
    const spawner = createFakeSpawner();
    const client = createComputeClient(spawner.spawn);
    const a = client.compute(input);
    const b = client.compute(input);
    b.cancel();
    expect(spawner.latest().terminated).toBe(false);
    await expect(b.promise).rejects.toBeInstanceOf(ComputeCancelled);
    spawner.latest().respond(b.id); // le worker la calcule quand même : réponse ignorée
    expect(client.pendingCount).toBe(1);
    spawner.latest().respond(a.id);
    await expect(a.promise).resolves.toMatchObject({ ms: 1 });
  });

  it('dispose rejette tout, termine le worker et refuse toute nouvelle tâche', async () => {
    const spawner = createFakeSpawner();
    const client = createComputeClient(spawner.spawn);
    const a = client.compute(input);
    const b = client.compute(input);
    client.dispose();
    expect(spawner.latest().terminated).toBe(true);
    expect(await settled(a.promise)).toMatchObject({ status: 'error', error: expect.any(ComputeCancelled) });
    expect(await settled(b.promise)).toMatchObject({ status: 'error', error: expect.any(ComputeCancelled) });
    await expect(client.compute(input).promise).rejects.toBeInstanceOf(ComputeCancelled);
    expect(spawner.workers).toHaveLength(1);
  });

  it("une réponse d'erreur rejette la tâche avec son message sans terminer le worker", async () => {
    const spawner = createFakeSpawner();
    const client = createComputeClient(spawner.spawn);
    const a = client.compute(input);
    const b = client.compute(input);
    spawner.latest().fail(a.id, 'Deck trop grand pour un calcul exact.');
    const err = (await settled(a.promise)) as { status: 'error'; error: Error };
    expect(err.error).toBeInstanceOf(ComputeFailed);
    expect(err.error.message).toBe('Deck trop grand pour un calcul exact.');
    expect(spawner.latest().terminated).toBe(false);
    spawner.latest().respond(b.id);
    await expect(b.promise).resolves.toBeDefined();
  });

  it('un échec du worker lui-même rejette toutes les tâches et le remplace au prochain calcul', async () => {
    const spawner = createFakeSpawner();
    const client = createComputeClient(spawner.spawn);
    const a = client.compute(input);
    const b = client.compute(input);
    spawner.latest().crash('Script introuvable');
    expect(spawner.latest().terminated).toBe(true);
    expect(await settled(a.promise)).toMatchObject({ status: 'error', error: expect.any(ComputeFailed) });
    expect(await settled(b.promise)).toMatchObject({ status: 'error', error: expect.any(ComputeFailed) });
    expect(client.pendingCount).toBe(0);
    const c = client.compute(input);
    expect(spawner.workers).toHaveLength(2);
    spawner.latest().respond(c.id);
    await expect(c.promise).resolves.toBeDefined();
  });

  it('cancelAll libère le worker et laisse le client utilisable', async () => {
    const spawner = createFakeSpawner();
    const client = createComputeClient(spawner.spawn);
    const a = client.compute(input);
    client.cancelAll();
    expect(spawner.latest().terminated).toBe(true);
    await expect(a.promise).rejects.toBeInstanceOf(ComputeCancelled);
    const b = client.compute(input);
    expect(spawner.workers).toHaveLength(2);
    spawner.latest().respond(b.id);
    await expect(b.promise).resolves.toBeDefined();
  });
});
