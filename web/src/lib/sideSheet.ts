import type { EngineInput } from '../engine/types.js';
import type { DeckCard, Matchup, SidePlan, SidePlanPosition } from '../types.js';
import { SIDE_PLAN_POSITIONS } from '../../../server/src/domain/deckConfiguration.js';
import type { PlanSummary } from '../../../server/src/domain/deckSummary.js';
import { buildEngineModel, type EngineModelSource } from './engineModel.js';
import { applyPlan, sidedSource, usablePlanSummary, type AppliedPlan } from './sidePlan.js';
import { planOf } from './matchups.js';
import { ENGINE_VERSION } from './summary.js';

// ─── Fiche imprimable des plans de side (étape 10D) : ce qui s'imprime, établi en pur ───
// Un bloc par adversaire (ordre d'ajout, Q4), un volet par position. Un chiffre ne figure sur la
// fiche que s'il porte l'empreinte du deck sidé COURANT (R9) : sinon « — », jamais un vieux chiffre.
// Un plan qui n'est pas prêt n'a ni entrée de moteur ni chiffre (R4, R5).

export interface SheetPlan {
  matchupId: string;
  position: SidePlanPosition;
  plan: SidePlan;
  applied: AppliedPlan;
  /** Entrée du moteur du deck sidé ; `null` si le plan n'est pas prêt. */
  input: EngineInput | null;
  /** Chiffres affichables, ou `null` (« — » : à calculer, ou plan pas prêt). */
  summary: PlanSummary | null;
}

export interface SheetMatchup {
  id: string;
  name: string;
  plans: SheetPlan[];
}

/** Clé d'un plan dans les chiffres stockés (`plan_summaries`, `planSummaries` du store). */
export const planKey = (matchupId: string, position: SidePlanPosition): string => `${matchupId}:${position}`;

export function sheetOf(
  source: EngineModelSource & { side: DeckCard[] },
  matchups: readonly Matchup[],
  stored: Record<string, unknown>,
  engineVersion = ENGINE_VERSION,
): SheetMatchup[] {
  return [...matchups]
    .sort((a, b) => a.sort_index - b.sort_index)
    .map((m) => ({
      id: m.id,
      name: m.name,
      plans: SIDE_PLAN_POSITIONS.map((position) => {
        const plan = planOf(m, position);
        const applied = applyPlan(source.main, source.side, plan);
        const sided = sidedSource(source, applied);
        const input = sided ? buildEngineModel(sided).input : null;
        const summary = input ? usablePlanSummary(stored[planKey(m.id, position)], input, position, engineVersion) : null;
        return { matchupId: m.id, position, plan, applied, input, summary };
      }),
    }));
}

/** Plans à calculer (« Tout calculer ») : prêts, sans chiffre affichable. */
export const plansToCompute = (sheet: readonly SheetMatchup[]): SheetPlan[] =>
  sheet.flatMap((m) => m.plans).filter((p) => p.input !== null && p.summary === null);
