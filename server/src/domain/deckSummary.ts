/** Aperçu d'un deck (étape 9, point 1) : cache d'affichage calculé par le client, jamais une
 *  source de vérité. Le serveur ne connaît pas le moteur : il valide la forme, refuse un
 *  résumé qui ne décrit pas la composition enregistrée (`mainSize`) et l'invalide à toute
 *  écriture de configuration ou de bibliothèque. Aucune dépendance serveur ici. */
import { ConfigurationError, record } from './deckConfiguration.js';

export interface DeckSummary {
  engineVersion: string;
  mainSize: number;
  startRateFirst: number;
  brickRate: number;
  computedAt: string;
}

const KEYS = ['engineVersion', 'mainSize', 'startRateFirst', 'brickRate', 'computedAt'];
const rate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

export function parseSummary(value: unknown): DeckSummary {
  if (!record(value) || !Object.keys(value).every((k) => KEYS.includes(k)) || !KEYS.every((k) => k in value)) throw new ConfigurationError('Résumé invalide.');
  const { engineVersion, mainSize, startRateFirst, brickRate, computedAt } = value;
  if (typeof engineVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(engineVersion)) throw new ConfigurationError('Résumé invalide : version du moteur.');
  if (!Number.isInteger(mainSize) || Number(mainSize) < 0 || Number(mainSize) > 32767) throw new ConfigurationError('Résumé invalide : taille du main deck.');
  if (!rate(startRateFirst) || !rate(brickRate)) throw new ConfigurationError('Résumé invalide : probabilité hors de [0, 1].');
  if (typeof computedAt !== 'string' || computedAt.length > 64 || Number.isNaN(Date.parse(computedAt))) throw new ConfigurationError('Résumé invalide : horodatage.');
  return { engineVersion, mainSize: mainSize as number, startRateFirst, brickRate, computedAt };
}

/** Le résumé doit décrire la composition qu'il accompagne : même taille de main deck. */
export function checkSummaryMatches(summary: DeckSummary, mainSize: number): void {
  if (summary.mainSize !== mainSize) throw new ConfigurationError(`Résumé refusé : calculé pour ${summary.mainSize} cartes, main deck de ${mainSize}.`);
}

/** Chiffres d'un plan de side (étape 10B) : même statut que l'aperçu d'un deck — cache
 *  d'affichage calculé par le client, forme validée ici, empreinte OPAQUE (seul le client la
 *  recalcule et la compare : `usablePlanSummary`). `mainSize` = taille du main APRÈS échange. */
export interface PlanSummary {
  engineVersion: string;
  fingerprint: string;
  mainSize: number;
  startOne: number;
  nonEngineTwo: number;
  strongHand: number;
  computedAt: string;
}

const PLAN_KEYS = ['engineVersion', 'fingerprint', 'mainSize', 'startOne', 'nonEngineTwo', 'strongHand', 'computedAt'];

export function parsePlanSummary(value: unknown): PlanSummary {
  if (!record(value) || !Object.keys(value).every((k) => PLAN_KEYS.includes(k)) || !PLAN_KEYS.every((k) => k in value)) throw new ConfigurationError('Chiffres de plan invalides.');
  const { engineVersion, fingerprint, mainSize, startOne, nonEngineTwo, strongHand, computedAt } = value;
  if (typeof engineVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(engineVersion)) throw new ConfigurationError('Chiffres de plan invalides : version du moteur.');
  if (typeof fingerprint !== 'string' || !/^[0-9a-f]{16}$/.test(fingerprint)) throw new ConfigurationError('Chiffres de plan invalides : empreinte.');
  if (!Number.isInteger(mainSize) || Number(mainSize) < 0 || Number(mainSize) > 32767) throw new ConfigurationError('Chiffres de plan invalides : taille du main deck.');
  if (!rate(startOne) || !rate(nonEngineTwo) || !rate(strongHand)) throw new ConfigurationError('Chiffres de plan invalides : probabilité hors de [0, 1].');
  if (typeof computedAt !== 'string' || computedAt.length > 64 || Number.isNaN(Date.parse(computedAt))) throw new ConfigurationError('Chiffres de plan invalides : horodatage.');
  return { engineVersion, fingerprint, mainSize: mainSize as number, startOne, nonEngineTwo, strongHand, computedAt };
}

/** Les chiffres doivent décrire le plan enregistré : même taille de main après échange. */
export function checkPlanSummaryMatches(summary: PlanSummary, mainSize: number): void {
  if (summary.mainSize !== mainSize) throw new ConfigurationError(`Chiffres refusés : calculés pour un main de ${summary.mainSize} cartes, ${mainSize} après échange.`);
}
