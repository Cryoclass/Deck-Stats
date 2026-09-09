import type { PassResult } from '../engine/types.js';
import { cumulativeOf } from './statsViews.js';

// ─── Aperçu d'un deck à l'accueil (étape 9, point 1) ───
// `decks.summary` n'est qu'un cache d'affichage : il est recalculé à chaque enregistrement
// (résultat frais joint au PUT) et, à l'accueil, tout résumé absent ou d'une autre version du
// moteur est recalculé à la demande puis persisté ; il n'est JAMAIS affiché tel quel
// (contrat §1 : « une ancienne synthèse ne doit pas devenir une vérité persistante »).
// Les valeurs sont celles du panneau : P(≥1 départ) = cumulé « au moins 1 » de la vue
// « Départs théoriques », brick = `pass.brick` (statsViews.ts, même chemin que dataIdentity).

/** Version du moteur du build courant (vite.config.ts) ; `unversioned` hors Vite (scripts). */
export const ENGINE_VERSION: string = typeof __ENGINE_VERSION__ === 'string' ? __ENGINE_VERSION__ : 'unversioned';

export interface DeckSummary {
  engineVersion: string;
  mainSize: number;
  /** P(≥1 départ théorique), premier · 5 cartes. */
  startRateFirst: number;
  /** P(0 départ), premier · 5 cartes. */
  brickRate: number;
  computedAt: string;
}

const SUMMARY_KEYS = ['engineVersion', 'mainSize', 'startRateFirst', 'brickRate', 'computedAt'] as const;
const rate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Résumé de la passe premier d'un résultat ; `null` si la passe est indisponible. */
export function summaryFromPass(pass: PassResult, mainSize: number, engineVersion = ENGINE_VERSION, now = new Date()): DeckSummary | null {
  if (pass.total === 0) return null;
  const buckets: [number, number, number, number] = [pass.startsBuckets[0] ?? 0, pass.startsBuckets[1] ?? 0, pass.startsBuckets[2] ?? 0, pass.startsBuckets[3] ?? 0];
  return { engineVersion, mainSize, startRateFirst: cumulativeOf(buckets)[1]!, brickRate: pass.brick, computedAt: now.toISOString() };
}

/** Un résumé stocké n'est affichable que s'il a la forme attendue ET la version du moteur courant. */
export function usableSummary(value: unknown, engineVersion = ENGINE_VERSION): DeckSummary | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  if (!SUMMARY_KEYS.every((k) => k in s)) return null;
  if (s.engineVersion !== engineVersion) return null;
  if (!Number.isInteger(s.mainSize) || !rate(s.startRateFirst) || !rate(s.brickRate) || typeof s.computedAt !== 'string') return null;
  return { engineVersion, mainSize: s.mainSize as number, startRateFirst: s.startRateFirst, brickRate: s.brickRate, computedAt: s.computedAt };
}

/** Ce que le store doit exposer pour qu'un enregistrement joigne un résumé. */
export interface ResultState {
  deckId: string | null;
  result: { first: PassResult } | null;
  resultContext: { deckId: string | null; deckSize: number } | null;
  stale: boolean;
  computing: boolean;
  modelVersion: number;
  resultVersion: number;
}

/** Résumé du résultat courant, seulement s'il est celui de la version demandée pour CE deck
 *  (ni périmé, ni en cours, ni d'une ouverture précédente) ; sinon `null` et l'enregistrement
 *  laisse le résumé absent (recalculé à l'accueil). Jamais un résultat périmé. */
export function summaryOfState(s: ResultState, engineVersion = ENGINE_VERSION, now = new Date()): DeckSummary | null {
  if (!s.result || !s.resultContext || s.stale || s.computing) return null;
  if (s.resultVersion !== s.modelVersion || s.resultContext.deckId !== s.deckId || s.deckId === null) return null;
  return summaryFromPass(s.result.first, s.resultContext.deckSize, engineVersion, now);
}
