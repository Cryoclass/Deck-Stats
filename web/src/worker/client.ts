import EngineWorker from './engine.worker.ts?worker';
import { createComputeClient, type ComputeClient, type WorkerLike } from './computeClient.js';

// Seul module à connaître le worker Vite (`?worker`) : tout le reste (annulation,
// propriété des tâches, erreurs) est dans `computeClient.ts`, pur et testable.
// Un client = un worker = un propriétaire : l'éditeur (store) en garde un pour la
// durée de vie du store ; le comparateur en crée un par montage et le dispose.
export function createEngineClient(): ComputeClient {
  return createComputeClient(() => new EngineWorker() as unknown as WorkerLike);
}
