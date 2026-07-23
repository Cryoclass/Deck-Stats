import type { Bucket, NonEngineSignature, PassResult } from './types.js';
import type { SampledHand } from './hand.js';

/**
 * Mode requête (§3.3, itération 7). Un critère = un SUJET + un INTERVALLE [min, max]
 * (bornes optionnelles). Les critères se combinent par ET. Le même objet sert au panneau
 * de requête ET au filtre du mur de mains (§D — un seul système de critères).
 */
export type QuerySubject =
  | { kind: 'starts' }
  | { kind: 'redundancy' }
  | { kind: 'nonengine' } // agrégat de TOUTES les catégories (dédupliqué)
  | { kind: 'category'; categoryId: string }
  | { kind: 'group'; categoryIds: string[]; name?: string };

export interface QueryCriterion {
  id: string;
  subject: QuerySubject;
  min: number | null; // borne vide = non bornée (jamais « au plus 0 » par accident)
  max: number | null;
}

export interface SavedQuery {
  id: string;
  name: string;
  criteria: QueryCriterion[];
}

/** Contexte d'évaluation partagé par un bucket (distribution exacte) et une main tirée. */
export interface QueryContext {
  starts: number;
  redundancy: number;
  neTotal: number;
  neContrib: number[]; // par signature (aligné sur neSignatures)
  neSignatures: NonEngineSignature[];
}

/**
 * Agrégat d'un groupe de catégories : Σ des signatures dont l'ensemble de catégories
 * pertinentes CROISE le groupe. Chaque signature (donc chaque carte) compté UNE fois →
 * la déduplication est structurelle (§C : agréger ≠ additionner).
 */
function groupAggregate(ctx: QueryContext, ids: Set<string>): number {
  let sum = 0;
  for (let s = 0; s < ctx.neSignatures.length; s++) {
    const cats = ctx.neSignatures[s].cats;
    for (let i = 0; i < cats.length; i++) {
      if (ids.has(cats[i])) {
        sum += ctx.neContrib[s];
        break;
      }
    }
  }
  return sum;
}

export function subjectValue(subject: QuerySubject, ctx: QueryContext): number {
  switch (subject.kind) {
    case 'starts':
      return ctx.starts;
    case 'redundancy':
      return ctx.redundancy;
    case 'nonengine':
      return ctx.neTotal;
    case 'category':
      return groupAggregate(ctx, new Set([subject.categoryId]));
    case 'group':
      return groupAggregate(ctx, new Set(subject.categoryIds));
  }
}

/** Invalide si les deux bornes sont présentes et min > max. */
export function criterionInvalid(cr: QueryCriterion): boolean {
  return cr.min !== null && cr.max !== null && cr.min > cr.max;
}

export function criterionMatches(cr: QueryCriterion, ctx: QueryContext): boolean {
  const v = subjectValue(cr.subject, ctx);
  if (cr.min !== null && v < cr.min) return false;
  if (cr.max !== null && v > cr.max) return false;
  return true;
}

/** ET de tous les critères. Aucun critère → vrai (100 %, §D). */
export function queryMatches(criteria: QueryCriterion[], ctx: QueryContext): boolean {
  for (const cr of criteria) if (!criterionMatches(cr, ctx)) return false;
  return true;
}

export function bucketContext(b: Bucket, neSignatures: NonEngineSignature[]): QueryContext {
  return {
    starts: b.starts,
    redundancy: b.redundancy,
    neTotal: b.neTotal,
    neContrib: b.neContrib,
    neSignatures,
  };
}

export function handContext(h: SampledHand, neSignatures: NonEngineSignature[]): QueryContext {
  return {
    starts: h.starts,
    redundancy: h.redundancy,
    neTotal: h.neTotal,
    neContrib: h.neContrib,
    neSignatures,
  };
}

/**
 * Probabilité exacte de la requête sur une passe = Σ des buckets qui matchent. Un critère
 * invalide (min > max) bloque l'évaluation → null (l'UI signale l'invalidité).
 */
export function queryProbability(pass: PassResult, criteria: QueryCriterion[]): number | null {
  if (criteria.some(criterionInvalid)) return null;
  let p = 0;
  for (const b of pass.buckets) {
    if (queryMatches(criteria, bucketContext(b, pass.neSignatures))) p += b.p;
  }
  return p;
}
