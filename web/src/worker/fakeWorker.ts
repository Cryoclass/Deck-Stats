import { computeAll, computePass } from '../engine/index.js';
import type { EngineResult } from '../engine/types.js';
import type { ComputeRequest, ComputeResponse } from './engine.worker.js';
import { notComputedPass, type WorkerLike } from './computeClient.js';

// ─── Faux worker contrôlable — RÉSERVÉ AUX TESTS (étape 4) ───
// Il ne calcule rien de lui-même : le test décide QUAND une requête reçoit sa réponse
// (`respond`, en appelant réellement le moteur pur), une erreur (`fail`) ou un crash du
// worker (`crash`). Un worker terminé ne répond plus, comme un vrai `Worker`.

export interface FakeWorker extends WorkerLike {
  readonly requests: ComputeRequest[];
  readonly terminated: boolean;
  /** Répond à la requête d'id donné avec le résultat exact du moteur (hors worker). */
  respond(id: number, ms?: number): void;
  /** Répond par une réponse d'erreur (exception du moteur relayée par le worker). */
  fail(id: number, message: string): void;
  /** Simule un échec du worker lui-même (script), sans id. */
  crash(message: string): void;
}

export function createFakeWorker(): FakeWorker {
  const requests: ComputeRequest[] = [];
  let terminated = false;
  const find = (id: number): ComputeRequest => {
    const r = requests.find((q) => q.id === id);
    if (!r) throw new Error(`Requête ${id} jamais postée sur ce worker.`);
    return r;
  };
  const worker: FakeWorker = {
    requests,
    get terminated() {
      return terminated;
    },
    onmessage: null,
    onerror: null,
    postMessage(message) {
      if (terminated) throw new Error('postMessage sur un worker terminé.');
      requests.push(message);
    },
    terminate() {
      terminated = true;
    },
    respond(id, ms = 1) {
      const { input, mode } = find(id);
      if (terminated) return; // un worker terminé ne répond plus
      const result: EngineResult =
        mode === 'passes'
          ? { first: computePass(input, 'first'), second: computePass(input, 'second'), deltas: [] }
          : mode === 'first'
            ? { first: computePass(input, 'first'), second: notComputedPass('second', input.deckSize), deltas: [] }
            : computeAll(input);
      worker.onmessage?.({ data: { id, result, ms } satisfies ComputeResponse });
    },
    fail(id, message) {
      find(id);
      if (terminated) return;
      worker.onmessage?.({ data: { id, error: message } });
    },
    crash(message) {
      if (terminated) return;
      worker.onerror?.({ message });
    },
  };
  return worker;
}

/** Fabrique de faux workers : chaque `spawn` en crée un nouveau, tous restent observables. */
export function createFakeSpawner(): {
  spawn: () => FakeWorker;
  workers: FakeWorker[];
  latest(): FakeWorker;
} {
  const workers: FakeWorker[] = [];
  return {
    workers,
    spawn() {
      const w = createFakeWorker();
      workers.push(w);
      return w;
    },
    latest() {
      const w = workers[workers.length - 1];
      if (!w) throw new Error('Aucun worker créé.');
      return w;
    },
  };
}
