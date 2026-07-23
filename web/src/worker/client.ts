import type { EngineInput, EngineResult } from '../engine/types.js';
import EngineWorker from './engine.worker.ts?worker';
import type { ComputeRequest, ComputeResponse } from './engine.worker.js';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: { result: EngineResult; ms: number }) => void>();

function ensure(): Worker {
  if (!worker) {
    worker = new EngineWorker();
    worker.onmessage = (e: MessageEvent<ComputeResponse>) => {
      const { id, result, ms } = e.data;
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve({ result, ms });
      }
    };
  }
  return worker;
}

/** Lance un calcul dans le worker. Le dernier appel gagne côté appelant. */
export function computeInWorker(
  input: EngineInput,
): Promise<{ result: EngineResult; ms: number }> {
  const w = ensure();
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, input } satisfies ComputeRequest);
  });
}
