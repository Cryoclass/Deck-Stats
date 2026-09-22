import type { EngineInput } from '../engine/types.js';
import type { DeckCard, Matchup, SidePlan, SidePlanCard, SidePlanPosition } from '../types.js';
import { SIDE_PLAN_POSITIONS } from '../../../server/src/domain/deckConfiguration.js';
import type { PlanSummary } from '../../../server/src/domain/deckSummary.js';
import { buildEngineModel, type EngineModelSource } from './engineModel.js';
import { applyPlan, sidedSource, usablePlanSummary, type AppliedPlan, type ZoneOf } from './sidePlan.js';
import { planOf } from './matchups.js';
import { ENGINE_VERSION } from './summary.js';

// ─── Fiche imprimable des plans de side (étape 10D) : ce qui s'imprime, établi en pur ───
// Un bloc par adversaire (ordre d'ajout, Q4), un volet par position. Un chiffre ne figure sur la
// fiche que s'il porte l'empreinte du deck sidé COURANT (R9) : sinon « — », jamais un vieux chiffre.
// Un plan qui n'est pas prêt n'a ni entrée de moteur ni chiffre (R4, R5).
// Plans de side v2 (D8, S5) : les cartes d'un cadre sont groupées par zone de jeu — main d'abord,
// puis « Extra » sous un intertitre, puis « zone inconnue » (plan « à revoir ») ; jamais mêlées.

/** Les cartes d'une liste du plan par zone de jeu, dans l'ordre d'impression. */
export interface ZoneGroups {
  main: SidePlanCard[];
  extra: SidePlanCard[];
  /** Type absent du catalogue chargé : le plan est « à revoir », la carte est nommée à part. */
  unknown: SidePlanCard[];
}

export function groupByZone(list: readonly SidePlanCard[], zoneOf: ZoneOf): ZoneGroups {
  const groups: ZoneGroups = { main: [], extra: [], unknown: [] };
  for (const c of list) {
    const zone = zoneOf(c.card_id);
    (zone === 'extra' ? groups.extra : zone === null ? groups.unknown : groups.main).push(c);
  }
  return groups;
}

export interface SheetPlan {
  matchupId: string;
  position: SidePlanPosition;
  plan: SidePlan;
  applied: AppliedPlan;
  /** Cadres SORT / ENTRE groupés par zone (D8) : ce qui s'imprime, l'écran et le PDF lisent la même chose. */
  groups: { outgoing: ZoneGroups; incoming: ZoneGroups };
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
  source: EngineModelSource & { extra: DeckCard[]; side: DeckCard[] },
  matchups: readonly Matchup[],
  stored: Record<string, unknown>,
  zoneOf: ZoneOf,
  engineVersion = ENGINE_VERSION,
): SheetMatchup[] {
  return [...matchups]
    .sort((a, b) => a.sort_index - b.sort_index)
    .map((m) => ({
      id: m.id,
      name: m.name,
      plans: SIDE_PLAN_POSITIONS.map((position) => {
        const plan = planOf(m, position);
        const applied = applyPlan(source, plan, zoneOf);
        const sided = sidedSource(source, applied);
        const input = sided ? buildEngineModel(sided).input : null;
        const summary = input ? usablePlanSummary(stored[planKey(m.id, position)], input, position, engineVersion) : null;
        const groups = { outgoing: groupByZone(plan.outgoing, zoneOf), incoming: groupByZone(plan.incoming, zoneOf) };
        return { matchupId: m.id, position, plan, applied, groups, input, summary };
      }),
    }));
}

/** Plans à calculer (« Tout calculer ») : prêts, sans chiffre affichable. */
export const plansToCompute = (sheet: readonly SheetMatchup[]): SheetPlan[] =>
  sheet.flatMap((m) => m.plans).filter((p) => p.input !== null && p.summary === null);
