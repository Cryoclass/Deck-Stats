import type { EngineInput, EngineResult, PassResult } from '../engine/types.js';
import type { SidePlan, SidePlanPosition } from '../types.js';
import { SIDE_PLAN_POSITIONS } from '../../../server/src/domain/deckConfiguration.js';
import type { PlanSummary } from '../../../server/src/domain/deckSummary.js';
import { api } from '../lib/api.js';
import { buildEngineModel, type EngineModelSource } from '../lib/engineModel.js';
import { planOf, type PlanDirection } from '../lib/matchups.js';
import { planIndicators, planSummaryFromPass, sidedSource, type AppliedPlan, type PlanIndicators } from '../lib/sidePlan.js';
import { studiedDeck, type StudiedDeck } from '../lib/studiedDeck.js';
import { CANDIDATES_AUTO_MS, DEFAULT_INDICATOR, candidateInputs, candidatesOf, estimateCandidatesMs, previewOf, type Indicator, type Selection } from '../lib/swapPreview.js';
import { zoneOfCatalog } from '../lib/zones.js';
import { createEngineClient } from '../worker/client.js';
import { ComputeCancelled, type ComputeClient, type ComputeMode, type ComputeTask } from '../worker/computeClient.js';
import type { State } from './deckStore.js';

// ─── Deck étudié, aperçu et candidats : l'orchestration (plans de side v2, partie B) ───
// Tout ce qui est pur vit dans lib/ (studiedDeck.ts, swapPreview.ts, sidePlan.ts) ; ici, seulement le
// QUAND et le SUR QUEL WORKER, sur le modèle du recalcul du deck de base (étape 4) :
//   • deck étudié (D1, D2, D4) : pour chaque position, le deck après le plan de l'adversaire étudié ;
//     un plan vide ou un échange neutre (même ENTRÉE du moteur que le deck de base) RÉUTILISE le
//     résultat de base (aucun calcul) ;
//     sinon calcul par ENTRÉE du moteur (deux positions au même main = un seul calcul), en deux temps
//     — les passes d'abord (mode `passes`), puis les écarts de tuile (`full`) — sur le client
//     principal du store, derrière le deck de base ; cache par entrée pour la session ;
//   • aperçu (D5) : la seule passe de la position ouverte, sur un client à part, regroupée à 50 ms,
//     annulée à chaque changement de sélection ; jamais enregistré, jamais « non enregistré » ;
//   • candidats (D6) : une passe par entrée distincte, sur un troisième client, en série ; automatique
//     si l'estimation tient dans CANDIDATES_AUTO_MS, sinon à la demande (`runCandidates`).
// Une réponse n'est adoptée que si la clé qu'elle porte est encore celle attendue (seconde garde,
// comme `modelVersion` pour le deck de base) ; tout changement de deck (`loadDeck`) remet à zéro.

export interface StudiedResult {
  deck: StudiedDeck;
  /** Entrée du moteur du deck étudié et sa clé ; `null` si le plan n'est pas prêt ou si le deck de base
   *  est réutilisé. */
  key: string | null;
  input: EngineInput | null;
  /** Même main que le deck de base : ses chiffres sont ceux de `result` du store (D4). */
  reusesBase: boolean;
  /** Passes (puis résultat complet) du deck étudié ; `null` tant que rien n'est calculé. */
  result: EngineResult | null;
  /** `result` vient de `computeAll` (écarts de tuile disponibles). */
  hasDeltas: boolean;
  computing: boolean;
  /** `result` est celui d'une entrée précédente (affiché atténué en attendant). */
  stale: boolean;
  error: string | null;
}

export type PreviewState =
  | { kind: 'none' }
  | { kind: 'unbalanced'; reason: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'not-ready'; applied: AppliedPlan }
  | {
      kind: 'ready';
      plan: SidePlan;
      applied: AppliedPlan;
      /** Le main de l'aperçu diffère de celui du plan ; sinon les chiffres du plan valent pour l'aperçu. */
      affectsEngine: boolean;
      key: string | null;
      pass: PassResult | null;
      computing: boolean;
      stale: boolean;
      error: string | null;
    };

export interface CandidatesState {
  direction: PlanDirection | null;
  /** Cartes candidates dans l'ordre des zones, avec la clé de leur entrée du moteur. */
  cards: Array<{ cardId: number; key: string }>;
  /** Entrées distinctes à calculer et estimation du coût (Q5). */
  distinct: number;
  estimateMs: number;
  auto: boolean;
  status: 'none' | 'pending' | 'running' | 'done';
  done: number;
  /** Indicateurs par clé d'entrée ; absent = pas encore calculé. */
  indicators: Record<string, PlanIndicators>;
  error: string | null;
}

export const EMPTY_STUDIED = (deck: StudiedDeck): StudiedResult => ({ deck, key: null, input: null, reusesBase: false, result: null, hasDeltas: false, computing: false, stale: false, error: null });
export const NO_CANDIDATES: CandidatesState = { direction: null, cards: [], distinct: 0, estimateMs: 0, auto: true, status: 'none', done: 0, indicators: {}, error: null };
export const STUDY_DEBOUNCE_MS = 50;
const CACHE_LIMIT = 32;

type Get = () => State;
type SetState = (partial: Partial<State>) => void;

/** Sous-ensemble de l'état lu par l'orchestrateur (aussi par les sélecteurs). */
export type StudyView = Pick<State, 'study' | 'context' | 'matchups' | 'main' | 'extra' | 'side' | 'cards' | 'selection' | 'studied' | 'preview' | 'candidates' | 'result' | 'stale' | 'computing' | 'lastPassMs' | 'computeMs' | 'dirty' | 'deckId' | 'revision' | 'planSummaries'>;

const passMode = (position: SidePlanPosition): ComputeMode => position;

/** Le plan ouvert : l'adversaire étudié dans la position courante ; `null` sans adversaire. */
export function openPlan(s: Pick<State, 'study' | 'context' | 'matchups'>): { matchupId: string; position: SidePlanPosition; plan: SidePlan } | null {
  if (!s.study.matchupId) return null;
  const matchup = s.matchups.find((m) => m.id === s.study.matchupId);
  if (!matchup) return null;
  return { matchupId: matchup.id, position: s.context, plan: planOf(matchup, s.context) };
}

/** Passe du deck étudié d'une position, résultat de base compris (D4) ; `null` si absente ou périmée. */
export function studiedPass(s: Pick<State, 'studied' | 'result' | 'stale'>, position: SidePlanPosition): PassResult | null {
  const st = s.studied[position];
  if (st.reusesBase) return s.result && !s.stale ? s.result[position] : null;
  return st.result && !st.stale ? st.result[position] : null;
}

/** Source du moteur du deck étudié d'une position : l'état lui-même pour le deck de base, le deck sidé
 *  sinon ; `null` si le plan n'est pas prêt (S2). */
export function studiedSource(s: Pick<State, 'studied'> & EngineModelSource, position: SidePlanPosition): EngineModelSource | null {
  const deck = s.studied[position].deck;
  return deck.kind === 'base' ? s : deck.source;
}

/** Ce qu'une colonne de chiffres affiche pour une position (S1 : nommée ; S2 : rien sans plan prêt ;
 *  S3 : l'aperçu prend la place dans la position ouverte). Pur ; à mémoïser côté composant. */
export interface StudyColumn {
  position: SidePlanPosition;
  kind: 'base' | 'sided';
  /** Nom du deck dont les chiffres sont ceux-ci (« Deck de base », « contre Kewl Tune · second »). */
  label: string;
  /** Pourquoi il n'y a pas de chiffre (plan incomplet ou à revoir) ; `null` sinon. */
  reason: string | null;
  pass: PassResult | null;
  stale: boolean;
  computing: boolean;
  error: string | null;
  /** La passe est celle de l'aperçu d'un échange en préparation (position ouverte). */
  isPreview: boolean;
  deckSize: number | null;
}

export function columnOf(s: Pick<State, 'studied' | 'result' | 'stale' | 'computing' | 'computeError' | 'resultContext' | 'context' | 'preview'>, position: SidePlanPosition, withPreview = true): StudyColumn {
  const st = s.studied[position];
  const base: StudyColumn = { position, kind: st.deck.kind, label: st.deck.label, reason: null, pass: null, stale: false, computing: false, error: null, isPreview: false, deckSize: null };
  let column: StudyColumn;
  if (!st.deck.source) column = { ...base, reason: st.deck.unavailableReason };
  else if (st.reusesBase) column = { ...base, pass: s.result ? s.result[position] : null, stale: s.stale, computing: s.computing, error: s.computeError, deckSize: s.resultContext?.deckSize ?? null };
  else column = { ...base, pass: st.result ? st.result[position] : null, stale: st.stale, computing: st.computing, error: st.error, deckSize: st.input?.deckSize ?? null };
  // Aperçu (S3) : dans la position ouverte, une sélection prête qui change les chiffres prend la place ;
  // tant que sa passe n'est pas là, l'ancien chiffre reste, atténué.
  // Le mur de mains ne suit pas l'aperçu (`withPreview = false`) : ses mains sont tirées dans le deck du
  // plan, elles ne peuvent pas être notées avec la passe d'un autre deck.
  if (withPreview && position === s.context && s.preview.kind === 'ready' && s.preview.affectsEngine) {
    const p = s.preview;
    if (p.pass) column = { ...column, reason: null, pass: p.pass, stale: false, computing: p.computing, error: p.error, isPreview: true, deckSize: p.applied.mainSize };
    else column = { ...column, stale: column.pass !== null, computing: true, error: p.error, isPreview: true };
  }
  return column;
}

/** Écart d'un candidat (S4) pour l'indicateur choisi : `null` tant que le candidat ou le plan n'est pas calculé. */
export function candidateDeltaOf(s: Pick<State, 'studied' | 'result' | 'stale' | 'candidates' | 'candidateIndicator' | 'context'>, cardId: number): number | null {
  const entry = s.candidates.cards.find((c) => c.cardId === cardId);
  if (!entry) return null;
  const candidate = s.candidates.indicators[entry.key];
  const pass = studiedPass(s, s.context);
  const plan = pass ? planIndicators(pass, s.context) : null;
  if (!candidate || !plan) return null;
  return candidate[s.candidateIndicator] - plan[s.candidateIndicator];
}

function bounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.size >= CACHE_LIMIT && !map.has(key)) map.delete(map.keys().next().value as K);
  map.set(key, value);
}

export interface StudyEngine {
  /** Recalcule les decks étudiés dès maintenant (après le lancement du deck de base). */
  syncStudied: () => void;
  /** Idem, regroupé à STUDY_DEBOUNCE_MS (mutations d'un plan, changement d'adversaire). */
  scheduleStudied: () => void;
  syncPreview: () => void;
  syncCandidates: () => void;
  /** Lance les candidats en attente (au-delà du budget automatique). */
  runCandidates: () => void;
  /** Nouveau deck ou nouvelle ouverture : tout annuler, caches vidés. */
  reset: () => void;
  /** Diagnostic et tests. */
  readonly pending: { studied: number; preview: number; candidates: number };
}

export function createStudyEngine(get: Get, set: SetState, mainClient: () => ComputeClient): StudyEngine {
  const resultCache = new Map<string, { passes?: EngineResult; full?: EngineResult }>();
  const passCache = new Map<string, PassResult>();
  const running = new Map<string, { mode: 'passes' | 'full'; task: ComputeTask }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let previewClient: ComputeClient | null = null;
  let candidateClient: ComputeClient | null = null;
  let previewTask: ComputeTask | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let candidateTasks: ComputeTask[] = [];
  let candidateSignature = '';
  const persisted = new Set<string>();

  const passKey = (position: SidePlanPosition, key: string) => `${position}|${key}`;
  /** Clé de l'entrée du deck de base (composition courante, annotations effectives). */
  const keyOfBase = (s: State): string => JSON.stringify(buildEngineModel(s).input);
  /** Passe déjà connue pour une clé : cache, deck de base frais, ou deck étudié frais de la position. */
  const knownPass = (s: State, position: SidePlanPosition, key: string, baseKey: string): PassResult | null => {
    const cached = passCache.get(passKey(position, key));
    if (cached) return cached;
    const full = resultCache.get(key);
    if (full?.full ?? full?.passes) return (full.full ?? full.passes)![position];
    if (key === baseKey && s.result && !s.stale) return s.result[position];
    const st = s.studied[position];
    if (st.key === key && st.result && !st.stale) return st.result[position];
    return null;
  };
  const zoneOfState = (s: State) => zoneOfCatalog(s.cards);
  const nameOf = (s: State) => (id: number) => s.cards[id]?.name ?? `#${id}`;

  /** Chiffres d'un plan persistés (D17, déplacé de `SidePlanner`) : seulement pour un deck sans
   *  modification non enregistrée, pour la révision lue ; 409 ou panne ignorés. */
  const persistSummary = (position: SidePlanPosition): void => {
    const s = get();
    const st = s.studied[position];
    const matchup = st.deck.matchup;
    if (!matchup || s.dirty || !s.deckId || st.deck.kind !== 'sided' || st.stale) return;
    // Un volet absent du plan enregistré n'a pas de ligne en base (404 sinon) : rien à persister pour lui.
    if (!s.matchups.find((m) => m.id === matchup.id)?.plans.some((p) => p.position === position)) return;
    const pass = studiedPass(s, position);
    const input = st.reusesBase ? (s.model?.input ?? null) : st.input;
    if (!pass || !input) return;
    const summary = planSummaryFromPass(pass, input, position);
    if (!summary) return;
    const stored = s.planSummaries[`${matchup.id}:${position}`] as PlanSummary | undefined;
    if (stored?.fingerprint === summary.fingerprint) return;
    const key = `${matchup.id}:${position}:${summary.fingerprint}:${s.revision}`;
    if (persisted.has(key)) return;
    persisted.add(key);
    const { deckId, revision } = s;
    api.putPlanSummary(deckId, matchup.id, position, summary, revision).then(
      () => get().setPlanSummary(matchup.id, position, summary),
      () => { persisted.delete(key); /* 409 ou panne : cache non écrit, nouvel essai au prochain geste. */ },
    );
  };

  /** Pose le résultat d'une clé sur toutes les positions qui l'attendent encore. */
  const adopt = (key: string, result: EngineResult, mode: 'passes' | 'full', ms: number): void => {
    const s = get();
    const studied = { ...s.studied };
    let touched = false;
    for (const position of SIDE_PLAN_POSITIONS) {
      const st = studied[position];
      if (st.key !== key) continue;
      studied[position] = { ...st, result, hasDeltas: mode === 'full', computing: mode === 'passes', stale: false, error: null };
      bounded(passCache, passKey(position, key), result[position]);
      touched = true;
    }
    if (!touched) return;
    // Première estimation d'une passe (moitié du mode `passes`), jamais au-dessus d'une mesure exacte
    // (aperçu, candidats) ni depuis un résultat complet (écarts de tuile compris).
    const prev = get().lastPassMs;
    const lastPassMs = mode === 'passes' ? { first: prev.first ?? Math.max(1, ms / 2), second: prev.second ?? Math.max(1, ms / 2) } : prev;
    set({ studied, lastPassMs });
    for (const position of SIDE_PLAN_POSITIONS) if (studied[position].key === key) persistSummary(position);
  };

  const launch = (key: string, input: EngineInput, mode: 'passes' | 'full'): void => {
    const task = mainClient().compute(input, mode);
    running.set(key, { mode, task });
    task.promise.then(
      ({ result, ms }) => {
        if (running.get(key)?.task !== task) return;
        running.delete(key);
        const cached = resultCache.get(key) ?? {};
        bounded(resultCache, key, { ...cached, [mode]: result });
        adopt(key, result, mode, ms);
        // Deux temps (D4) : les passes affichées, les écarts de tuile suivent, en basse priorité.
        if (mode === 'passes' && SIDE_PLAN_POSITIONS.some((p) => get().studied[p].key === key)) launch(key, input, 'full');
      },
      (e: unknown) => {
        if (running.get(key)?.task !== task) return;
        running.delete(key);
        if (e instanceof ComputeCancelled) return;
        const s = get();
        const studied = { ...s.studied };
        for (const position of SIDE_PLAN_POSITIONS) {
          if (studied[position].key === key) studied[position] = { ...studied[position], computing: false, error: e instanceof Error ? e.message : 'Calcul impossible.' };
        }
        set({ studied });
      },
    );
  };

  const syncStudied = (): void => {
    if (timer) { clearTimeout(timer); timer = null; }
    const s = get();
    const zoneOf = zoneOfState(s);
    const name = nameOf(s);
    const wanted = new Map<string, EngineInput>();
    const studied = { ...s.studied };
    const baseKey = keyOfBase(s);
    for (const position of SIDE_PLAN_POSITIONS) {
      const deck = studiedDeck(s, s.study.matchupId, position, zoneOf, name);
      const prev = s.studied[position];
      if (!deck.source) { studied[position] = EMPTY_STUDIED(deck); continue; }
      if (deck.kind === 'base') { studied[position] = { ...EMPTY_STUDIED(deck), reusesBase: true }; continue; }
      const input = buildEngineModel(deck.source).input;
      const key = JSON.stringify(input);
      // Même ENTRÉE que le deck de base — plan vide, ou échange neutre (le moteur ne distingue pas deux
      // cartes sans annotation) : ses chiffres sont ceux du deck de base, rien à calculer (D4).
      if (key === baseKey) { studied[position] = { ...EMPTY_STUDIED(deck), reusesBase: true }; continue; }
      wanted.set(key, input);
      const cached = resultCache.get(key);
      if (cached?.full) studied[position] = { deck, key, input, reusesBase: false, result: cached.full, hasDeltas: true, computing: false, stale: false, error: null };
      else if (cached?.passes) studied[position] = { deck, key, input, reusesBase: false, result: cached.passes, hasDeltas: false, computing: true, stale: false, error: null };
      else {
        // L'ancien résultat n'est gardé (atténué) que s'il est celui du MÊME adversaire : jamais un
        // chiffre de M1 sous le nom de M2 (invariant d'affichage).
        const keep = prev.result !== null && prev.deck.matchup?.id === deck.matchup?.id ? prev.result : null;
        studied[position] = { deck, key, input, reusesBase: false, result: keep, hasDeltas: false, computing: true, stale: keep !== null, error: null };
      }
    }
    set({ studied });
    for (const [key, r] of running) if (!wanted.has(key)) { r.task.cancel(); running.delete(key); }
    for (const [key, input] of wanted) {
      const cached = resultCache.get(key);
      if (cached?.full || running.has(key)) continue;
      launch(key, input, cached?.passes ? 'full' : 'passes');
    }
    for (const position of SIDE_PLAN_POSITIONS) if (studied[position].result && !studied[position].stale) persistSummary(position);
    if (SIDE_PLAN_POSITIONS.some((p) => studied[p].reusesBase)) for (const position of SIDE_PLAN_POSITIONS) if (studied[position].reusesBase) persistSummary(position);
  };

  const scheduleStudied = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; syncStudied(); }, STUDY_DEBOUNCE_MS);
  };

  const cancelPreview = (): void => {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    previewTask?.cancel();
    previewTask = null;
  };

  const syncPreview = (): void => {
    cancelPreview();
    const s = get();
    const open = openPlan(s);
    if (!open) { if (s.preview.kind !== 'none') set({ preview: { kind: 'none' } }); return; }
    const p = previewOf(s, open.plan, s.selection, zoneOfState(s), nameOf(s), s);
    if (p.kind !== 'ready') { set({ preview: p }); return; }
    const { position } = open;
    // Sans effet sur l'entrée du moteur (lib) : les chiffres du plan valent pour l'aperçu, rien à calculer.
    if (!p.affectsEngine) { set({ preview: { ...p, key: null, pass: null, computing: false, stale: false, error: null } }); return; }
    const input = buildEngineModel(sidedSource(s, p.applied)!).input;
    const key = JSON.stringify(input);
    const baseKey = keyOfBase(s);
    const cached = knownPass(s, position, key, baseKey);
    if (cached) { set({ preview: { ...p, key, pass: cached, computing: false, stale: false, error: null } }); return; }
    const prevPass = s.preview.kind === 'ready' ? s.preview.pass : null;
    set({ preview: { ...p, key, pass: prevPass, computing: true, stale: prevPass !== null, error: null } });
    previewTimer = setTimeout(() => {
      previewTimer = null;
      previewClient ??= createEngineClient();
      const task = previewClient.compute(input, passMode(position));
      previewTask = task;
      task.promise.then(
        ({ result, ms }) => {
          if (previewTask !== task) return;
          previewTask = null;
          bounded(passCache, passKey(position, key), result[position]);
          const cur = get();
          if (cur.preview.kind === 'ready' && cur.preview.key === key) set({ preview: { ...cur.preview, pass: result[position], computing: false, stale: false }, lastPassMs: { ...cur.lastPassMs, [position]: ms } });
        },
        (e: unknown) => {
          if (previewTask !== task) return;
          previewTask = null;
          if (e instanceof ComputeCancelled) return;
          const cur = get();
          if (cur.preview.kind === 'ready' && cur.preview.key === key) set({ preview: { ...cur.preview, computing: false, error: e instanceof Error ? e.message : 'Calcul impossible.' } });
        },
      );
    }, STUDY_DEBOUNCE_MS);
  };

  /** En ordre inverse de dépôt : les tâches en attente sont retirées sans effet, la tâche en cours
   *  (la première) termine le worker une seule fois, sans rien reposter. */
  const cancelCandidates = (): void => {
    for (const t of [...candidateTasks].reverse()) t.cancel();
    candidateTasks = [];
  };

  const runKeys = (position: SidePlanPosition, inputs: Map<string, EngineInput>, known: Set<string>): void => {
    candidateClient ??= createEngineClient();
    const toRun = [...inputs].filter(([key]) => !known.has(key));
    if (toRun.length === 0) { set({ candidates: { ...get().candidates, status: 'done', done: get().candidates.distinct } }); return; }
    set({ candidates: { ...get().candidates, status: 'running' } });
    const signature = candidateSignature;
    for (const [key, input] of toRun) {
      const task = candidateClient.compute(input, passMode(position));
      candidateTasks.push(task);
      task.promise.then(
        ({ result, ms }) => {
          if (candidateSignature !== signature) return;
          bounded(passCache, passKey(position, key), result[position]);
          const cur = get();
          const ix = planIndicators(result[position], position);
          const indicators = ix ? { ...cur.candidates.indicators, [key]: ix } : cur.candidates.indicators;
          const done = cur.candidates.done + 1;
          set({ candidates: { ...cur.candidates, indicators, done, status: done >= cur.candidates.distinct ? 'done' : 'running' }, lastPassMs: { ...cur.lastPassMs, [position]: ms } });
        },
        (e: unknown) => {
          if (candidateSignature !== signature || e instanceof ComputeCancelled) return;
          set({ candidates: { ...get().candidates, status: 'done', error: e instanceof Error ? e.message : 'Calcul impossible.' } });
        },
      );
    }
  };

  const syncCandidates = (manual = false): void => {
    const s = get();
    const open = openPlan(s);
    const c = open ? candidatesOf(s, open.plan, s.selection, zoneOfState(s), nameOf(s)) : null;
    if (!open || !c || c.candidates.length === 0) {
      cancelCandidates();
      candidateSignature = '';
      if (s.candidates.status !== 'none') set({ candidates: NO_CANDIDATES });
      return;
    }
    const { position } = open;
    const { byCard, inputs } = candidateInputs(s, c.candidates);
    const cards = c.candidates.map((x) => ({ cardId: x.cardId, key: byCard.get(x.cardId)! }));
    const signature = `${position}|${c.direction}|${cards.map((x) => x.key).join('')}`;
    const indicators: Record<string, PlanIndicators> = {};
    const baseKey = keyOfBase(s);
    for (const key of inputs.keys()) {
      const pass = knownPass(s, position, key, baseKey);
      const ix = pass ? planIndicators(pass, position) : null;
      if (ix) indicators[key] = ix;
    }
    const known = Object.keys(indicators).length;
    const lastPass = s.lastPassMs[position] ?? (s.computeMs > 0 ? s.computeMs : 1000);
    const estimateMs = estimateCandidatesMs(inputs.size - known, lastPass);
    const auto = estimateMs <= CANDIDATES_AUTO_MS;
    if (signature === candidateSignature && s.candidates.status === 'running') {
      set({ candidates: { ...s.candidates, cards, indicators: { ...s.candidates.indicators, ...indicators } } });
      if (manual) return;
      return;
    }
    if (signature !== candidateSignature) { cancelCandidates(); candidateSignature = signature; }
    const base: CandidatesState = { direction: c.direction, cards, distinct: inputs.size, estimateMs, auto, status: known >= inputs.size ? 'done' : 'pending', done: known, indicators, error: null };
    set({ candidates: base });
    if (base.status === 'done') return;
    if (auto || manual) runKeys(position, inputs, new Set(Object.keys(indicators)));
  };

  const reset = (): void => {
    if (timer) { clearTimeout(timer); timer = null; }
    for (const r of [...running.values()].reverse()) r.task.cancel();
    running.clear();
    cancelPreview();
    cancelCandidates();
    candidateSignature = '';
    resultCache.clear();
    passCache.clear();
    persisted.clear();
  };

  return {
    syncStudied,
    scheduleStudied,
    syncPreview,
    syncCandidates: () => syncCandidates(false),
    runCandidates: () => syncCandidates(true),
    reset,
    get pending() {
      return { studied: running.size, preview: previewTask ? 1 : 0, candidates: candidateTasks.length };
    },
  };
}

export const DEFAULT_CANDIDATE_INDICATOR: Indicator = DEFAULT_INDICATOR;
export type { Selection };
