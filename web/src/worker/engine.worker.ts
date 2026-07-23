import { computeAll } from '../engine/index.js';
import type { EngineInput, EngineResult } from '../engine/types.js';

export interface ComputeRequest {
  id: number;
  input: EngineInput;
}
export interface ComputeResponse {
  id: number;
  result: EngineResult;
  ms: number;
}

// Contexte worker typé minimalement (on n'inclut pas la lib WebWorker pour éviter
// le conflit `self` DOM/Worker). L'énumération tourne ici pour ne jamais figer
// l'UI (§3.2 / §6.3) — le worker est volontairement bête : il calcule, c'est tout.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ComputeRequest>) => void) | null;
  postMessage: (m: ComputeResponse) => void;
};

ctx.onmessage = (e) => {
  const { id, input } = e.data;
  const t0 = performance.now();
  const result = computeAll(input);
  ctx.postMessage({ id, result, ms: performance.now() - t0 });
};
