import { computeAll, computePass } from '../engine/index.js';
import type { EngineInput, EngineResult } from '../engine/types.js';

export interface ComputeRequest {
  id: number;
  input: EngineInput;
  // 'passes' (comparateur, itération 9) : les deux passes SANS les contributions
  // marginales (§3.2), qui coûtent n+1 énumérations et ne servent qu'à l'éditeur.
  mode?: 'full' | 'passes';
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
  const { id, input, mode } = e.data;
  const t0 = performance.now();
  const result: EngineResult =
    mode === 'passes'
      ? { first: computePass(input, 5), second: computePass(input, 6), deltas: [] }
      : computeAll(input);
  ctx.postMessage({ id, result, ms: performance.now() - t0 });
};
