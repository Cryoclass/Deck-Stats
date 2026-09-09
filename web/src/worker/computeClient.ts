import type { AnalysisContext, EngineInput, EngineResult, PassResult } from '../engine/types.js';
import type { ComputeRequest, ComputeResponse } from './engine.worker.js';

/** Passe volontairement non calculée (mode `first`) : même convention que le moteur pour une
 *  passe indisponible (`total === 0` + motif explicite) ; jamais copiée ni approximée. Partagée
 *  par le worker réel et le faux worker de test. */
export function notComputedPass(context: AnalysisContext, deckSize: number): PassResult {
  return { unavailableReason: 'Passe non calculée : aperçu de l’accueil (passe premier seule).', context, handSize: context === 'first' ? 5 : 6, deckSize, total: 0, outcomes: 0, buckets: [], startsBuckets: [0, 0, 0, 0], startsExact: [], brick: 0, meanStarts: 0, redundancy: [], nonEngine: [], meanNonEngine: 0, perCategory: [], crossMatrix: [], neSignatures: [] };
}

// ─── Client de calcul (étape 4) — propriété des tâches, annulation, erreurs ───
// Module PUR (aucun import Vite/DOM) : `spawn` fournit le worker, ce qui permet un
// faux worker contrôlable en test. Règles :
//   • un client = un worker = UN propriétaire (l'éditeur en garde un pour la durée
//     de vie du store ; le comparateur en crée un par montage et le dispose) ;
//   • le worker traite ses messages dans l'ordre : la première tâche en attente est
//     celle qu'il exécute. L'annuler exige `terminate()` (seule interruption possible
//     d'un calcul synchrone) ; les tâches suivantes sont reposées sur un worker neuf ;
//   • annuler une tâche non encore commencée la retire simplement de l'attente ;
//   • toute promesse se termine : `ComputeCancelled` après annulation / dispose,
//     `ComputeFailed` si le worker signale une erreur. Jamais de promesse bloquée ;
//   • une réponse dont l'id n'est plus attendu (tâche annulée, worker remplacé) est
//     ignorée : le versionnement côté appelant reste la seconde garde.

/** Sous-ensemble de `Worker` utilisé, pour qu'un faux worker de test le remplace. */
export interface WorkerLike {
  postMessage(message: ComputeRequest): void;
  terminate(): void;
  onmessage: ((e: { data: ComputeResponse }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
}

/** 'full' : éditeur (deux passes + contributions marginales) · 'passes' : comparateur ·
 *  'first' : aperçu de l'accueil (étape 9), passe premier seule, `second` rendue indisponible. */
export type ComputeMode = 'full' | 'passes' | 'first';

export interface ComputeOutput {
  result: EngineResult;
  ms: number;
}

/** Rejet d'une tâche annulée (`cancel`, `cancelAll`, `dispose`). */
export class ComputeCancelled extends Error {
  constructor() {
    super('Calcul annulé.');
    this.name = 'ComputeCancelled';
  }
}

/** Rejet d'une tâche dont le worker a signalé une erreur (moteur ou chargement). */
export class ComputeFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComputeFailed';
  }
}

export interface ComputeTask {
  readonly id: number;
  readonly promise: Promise<ComputeOutput>;
  /** Idempotent ; sans effet si la tâche est déjà réglée. */
  cancel(): void;
}

export interface ComputeClient {
  compute(input: EngineInput, mode?: ComputeMode): ComputeTask;
  /** Annule toutes les tâches en attente et termine le worker ; le client reste utilisable. */
  cancelAll(): void;
  /** `cancelAll` puis refus de toute nouvelle tâche (propriétaire démonté). */
  dispose(): void;
  /** Tâches non encore réglées (diagnostic, tests). */
  readonly pendingCount: number;
}

interface Pending {
  request: ComputeRequest;
  resolve: (out: ComputeOutput) => void;
  reject: (err: Error) => void;
}

export function createComputeClient(spawn: () => WorkerLike): ComputeClient {
  let worker: WorkerLike | null = null;
  let seq = 0;
  let disposed = false;
  // Ordre d'insertion = ordre de traitement par le worker : la première clé est la
  // tâche en cours d'exécution (ou sur le point de l'être).
  const pending = new Map<number, Pending>();

  function terminateWorker(): void {
    if (!worker) return;
    const w = worker;
    worker = null;
    w.onmessage = null;
    w.onerror = null;
    w.terminate();
  }

  function attach(w: WorkerLike): void {
    w.onmessage = (e) => {
      if (w !== worker) return; // worker déjà remplacé
      const { id, result, ms, error } = e.data;
      const p = pending.get(id);
      if (!p) return; // tâche annulée ou inconnue : réponse ignorée
      pending.delete(id);
      if (error !== undefined || !result) p.reject(new ComputeFailed(error ?? 'Réponse du worker invalide.'));
      else p.resolve({ result, ms: ms ?? 0 });
    };
    w.onerror = (e) => {
      if (w !== worker) return;
      // Worker inutilisable (script en échec) : tout rejeter, terminer, respawn au
      // prochain calcul. Aucune promesse ne reste en attente.
      const failed = [...pending.values()];
      pending.clear();
      terminateWorker();
      const message = e.message || 'Le worker de calcul a échoué.';
      for (const p of failed) p.reject(new ComputeFailed(message));
    };
  }

  function ensure(): WorkerLike {
    if (!worker) {
      worker = spawn();
      attach(worker);
    }
    return worker;
  }

  function cancel(id: number): void {
    const p = pending.get(id);
    if (!p) return;
    const running = pending.keys().next().value === id;
    pending.delete(id);
    p.reject(new ComputeCancelled());
    if (running && worker) {
      // Seule façon d'interrompre le calcul en cours : terminer le worker (ressources
      // libérées), puis reposer les tâches encore attendues sur un worker neuf.
      terminateWorker();
      if (pending.size > 0) {
        const w = ensure();
        for (const q of pending.values()) w.postMessage(q.request);
      }
    }
  }

  function cancelAll(): void {
    const all = [...pending.values()];
    pending.clear();
    terminateWorker();
    for (const p of all) p.reject(new ComputeCancelled());
  }

  return {
    compute(input, mode = 'full') {
      const id = ++seq;
      if (disposed) {
        return { id, promise: Promise.reject(new ComputeCancelled()), cancel() {} };
      }
      const request: ComputeRequest = mode === 'full' ? { id, input } : { id, input, mode };
      const promise = new Promise<ComputeOutput>((resolve, reject) => {
        pending.set(id, { request, resolve, reject });
      });
      ensure().postMessage(request);
      return { id, promise, cancel: () => cancel(id) };
    },
    cancelAll,
    dispose() {
      disposed = true;
      cancelAll();
    },
    get pendingCount() {
      return pending.size;
    },
  };
}
