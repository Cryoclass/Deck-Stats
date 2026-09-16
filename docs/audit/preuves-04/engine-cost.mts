// Coût du moteur exact (web/src/engine) selon le nombre de types annotés. Lecture seule du dépôt :
// le moteur est importé tel quel, aucune modification. Lancement : node --import tsx engine-cost.mts
import { computeAll, computePass } from 'file:///C:/dev/Testhand/web/src/engine/index.ts';
import type { EngineInput } from 'file:///C:/dev/Testhand/web/src/engine/types.ts';

const starters = (n: number, copies: number, deckSize: number): EngineInput => ({
  deckSize,
  types: Array.from({ length: n }, () => ({ copies, isHopt: false, isStarter: true, categories: [] })),
  edges: [],
  categories: [],
});
const time = <T>(fn: () => T): [T, number] => { const t = performance.now(); const r = fn(); return [r, Math.round(performance.now() - t)]; };
const scenario = (label: string, input: EngineInput, mode: 'all' | 'first' | 'second') => {
  const [r, ms] = time(() => (mode === 'all' ? computeAll(input) : computePass(input, mode)));
  const pass = mode === 'all' ? (r as ReturnType<typeof computeAll>).first : (r as ReturnType<typeof computePass>);
  console.log(JSON.stringify({ label, mode, types: input.types.length, deckSize: input.deckSize, ms, total: pass.total, unavailable: pass.unavailableReason ?? null, secondUnavailable: mode === "all" ? ((r as ReturnType<typeof computeAll>).second.unavailableReason ?? null) : undefined }));
};

const only = process.argv[2];
const plan: Array<[string, () => void]> = [
  ['realiste', () => scenario('réaliste : 13 types × 3 copies, deck 40', starters(13, 3, 40), 'all')],
  ['n20x3', () => scenario('20 types × 3 copies, deck 60', starters(20, 3, 60), 'all')],
  ['n20', () => scenario('20 starters × 1 copie, deck 40', starters(20, 1, 40), 'all')],
  ['n30', () => scenario('30 starters × 1 copie, deck 40', starters(30, 1, 40), 'all')],
  ['n40first', () => scenario('40 starters × 1 copie, deck 40', starters(40, 1, 40), 'first')],
  ['n40second', () => scenario('40 starters × 1 copie, deck 40', starters(40, 1, 40), 'second')],
  ['n40all', () => scenario('40 starters × 1 copie, deck 40', starters(40, 1, 40), 'all')],
  ['n60first', () => scenario('60 starters × 1 copie, deck 60', starters(60, 1, 60), 'first')],
  ['deck1000', () => scenario('0 type annoté, deck 1000 (taille acceptée par le serveur)', starters(0, 1, 1000), 'all')],
  ['deck1200', () => scenario('0 type annoté, deck 1200', starters(0, 1, 1200), 'all')],
];
for (const [key, run] of plan) if (!only || only.split(',').includes(key)) run();
