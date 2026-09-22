import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api, type DeckDetail } from '../lib/api.js';
import { saveDraft } from '../lib/draft.js';
import { parseConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { stateFromConfiguration } from '../lib/deckConfiguration.js';
import { buildEngineModel } from '../lib/engineModel.js';
import { computePass } from '../engine/index.js';
import { planIndicators } from '../lib/sidePlan.js';
import type { Card, Library } from '../types.js';
import type { ComputeClient } from '../worker/computeClient.js';
import type { ComputeRequest } from '../worker/engine.worker.js';
import type { FakeWorker } from '../worker/fakeWorker.js';
import * as workerClient from '../worker/client.js';
import { COMPUTE_DEBOUNCE_MS, resetStudyEngine, useDeck } from './deckStore.js';
import { candidateDeltaOf, columnOf, studiedPass, studiedSource } from './study.js';
import { drawHandsFromStore, noteHandsFromStore } from './selectors.js';
import { prepare } from '../engine/evaluate.js';
import { buildScorer, evaluateHands } from '../engine/hand.js';

// ─── Plans de side v2, partie B : decks étudiés, aperçu et candidats orchestrés par le store ───
// Même harnais que recompute.test.ts (vrai `computeClient`, faux worker contrôlable, horloge simulée),
// à une différence près : chaque `createEngineClient()` rend un client À PART (deck de base, aperçu,
// candidats ont chacun leur worker, comme dans l'application), et un journal chronologique garde
// l'ordre de dépôt des requêtes tous workers confondus.

interface Posted { req: ComputeRequest; worker: FakeWorker }
interface Harness { posted: Posted[]; clients: ComputeClient[] }
vi.mock('../worker/client.js', async () => {
  const { createComputeClient } = await import('../worker/computeClient.js');
  const { createFakeWorker } = await import('../worker/fakeWorker.js');
  const posted: Posted[] = [];
  const clients: ComputeClient[] = [];
  const spawn = () => {
    const w = createFakeWorker();
    const orig = w.postMessage.bind(w);
    w.postMessage = (m) => { posted.push({ req: m, worker: w }); orig(m); };
    return w;
  };
  return { createEngineClient: () => { const c = createComputeClient(spawn); clients.push(c); return c; }, __harness: { posted, clients } satisfies Harness };
});
vi.mock('../lib/draft.js', () => ({ saveDraft: vi.fn(async () => {}), clearDraft: vi.fn(async () => {}), loadDraft: vi.fn(async () => null) }));
vi.mock('../lib/api.js', async (original) => {
  const actual = await original<typeof import('../lib/api.js')>();
  return { ...actual, api: { ...actual.api, saveConfiguration: vi.fn(), getLibrary: vi.fn(), getDeck: vi.fn(), cardsByIds: vi.fn(async () => []), putPlanSummary: vi.fn(async () => ({ ok: true, revision: 1 })) } };
});

const harness = (workerClient as unknown as { __harness: Harness }).__harness;
const state = () => useDeck.getState();
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const tick = () => vi.advanceTimersByTime(COMPUTE_DEBOUNCE_MS);
const posted = () => harness.posted;
const modes = (from: number) => posted().slice(from).map((p) => p.req.mode);
/** Répond à la i-ème requête postée (ordre chronologique) avec le résultat exact du moteur. */
const respond = async (i: number, ms = 1) => { const p = posted()[i]; p.worker.respond(p.req.id, ms); await flush(); };
const terminated = (i: number) => posted()[i].worker.terminated;

const deckId = '00000000-0000-4000-8000-000000000001';
const M = '00000000-0000-4000-8000-0000000000aa';
const STARTER = 1, NEUTRAL_A = 2, NEUTRAL_B = 3, NEUTRAL_C = 4;
const SIDE_NEUTRAL = 7, SIDE_STARTER = 8, SIDE_EXTRA = 9, EXTRA = 20;
const library: Library = { hoptCardIds: [], categories: [], cardCategories: [], profiles: [], groups: [] };
const catalog: Record<number, Card> = Object.fromEntries([
  [STARTER, 'Effect Monster'], [NEUTRAL_A, 'Normal Monster'], [NEUTRAL_B, 'Normal Monster'], [NEUTRAL_C, 'Spell Card'],
  [SIDE_NEUTRAL, 'Trap Card'], [SIDE_STARTER, 'Effect Monster'], [SIDE_EXTRA, 'Link Monster'], [EXTRA, 'Fusion Monster'],
].map(([id, type]) => [id, { id: Number(id), name: `#${id}`, type: String(type) }]));

type PlanSpec = { position: 'first' | 'second'; outgoing: Array<[number, number]>; incoming: Array<[number, number]> };
function seed(plans: PlanSpec[]): void {
  const configuration = parseConfiguration({
    version: 2, name: 'Deck', notes: null, params: {}, pairs: [], conditions: [], deadFirst: [], deadSecond: [],
    cards: [{ card_id: STARTER, zone: 'main', copies: 3 }, { card_id: NEUTRAL_A, zone: 'main', copies: 3 }, { card_id: NEUTRAL_B, zone: 'main', copies: 3 }, { card_id: NEUTRAL_C, zone: 'main', copies: 3 },
      { card_id: EXTRA, zone: 'extra', copies: 1 }, { card_id: SIDE_NEUTRAL, zone: 'side', copies: 2 }, { card_id: SIDE_STARTER, zone: 'side', copies: 1 }, { card_id: SIDE_EXTRA, zone: 'side', copies: 1 }],
    starters: [STARTER, SIDE_STARTER],
    matchups: [{ id: M, name: 'Kewl Tune', sort_index: 0, plans: plans.map((p) => ({ position: p.position, note: null, outgoing: p.outgoing.map(([card_id, copies]) => ({ card_id, copies })), incoming: p.incoming.map(([card_id, copies]) => ({ card_id, copies })) })) }],
  });
  useDeck.setState({ ...stateFromConfiguration(configuration), cards: catalog, deckId, revision: 1, context: 'second' });
}
/** Plan second neutre : un neutre sort, le neutre du side entre — même ENTRÉE du moteur que le deck de base. */
const NEUTRAL_SWAP: PlanSpec = { position: 'second', outgoing: [[NEUTRAL_A, 1]], incoming: [[SIDE_NEUTRAL, 1]] };
/** Plan second qui change les chiffres : un neutre sort, le starter du side entre. */
const STARTER_SWAP: PlanSpec = { position: 'second', outgoing: [[NEUTRAL_A, 1]], incoming: [[SIDE_STARTER, 1]] };
const sel = (outgoing: Array<[number, number]>, incoming: Array<[number, number]>) =>
  ({ outgoing: outgoing.map(([card_id, copies]) => ({ card_id, copies })), incoming: incoming.map(([card_id, copies]) => ({ card_id, copies })) });

/** Deck de base calculé et adopté (résultat frais) ; rend l'index de sa requête. */
async function baseComputed(): Promise<number> {
  const i = posted().length;
  state().recompute();
  tick();
  await respond(i, 40);
  return i;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  for (const c of harness.clients) c.cancelAll();
  resetStudyEngine(); // caches par entrée et tâches : jamais d'un test à l'autre
  harness.posted.length = 0;
  useDeck.setState(useDeck.getInitialState(), true);
  vi.mocked(api.getLibrary).mockResolvedValue(library);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('deck étudié (D1, D2, D4, S1, S2)', () => {
  it('sans adversaire : les deux positions réutilisent le deck de base, aucun calcul de plus', async () => {
    seed([STARTER_SWAP]);
    await baseComputed();
    expect(state().studied.first).toMatchObject({ reusesBase: true, key: null, deck: { kind: 'base', label: 'Deck de base' } });
    expect(posted()).toHaveLength(1);
    expect(studiedPass(state(), 'second')).toBe(state().result!.second);
  });

  it('contre un adversaire : plan vide = deck de base réutilisé ; plan qui change le main = passes puis résultat complet, derrière le deck de base', async () => {
    seed([STARTER_SWAP]);
    state().recompute(); // ouverture par l'URL : le deck de base est déjà demandé
    state().setStudy(M);
    expect(posted()).toHaveLength(0); // regroupés à 50 ms, tous les deux
    tick();
    expect(state().studied.first).toMatchObject({ reusesBase: true, deck: { kind: 'sided', label: 'contre Kewl Tune · premier' } });
    expect(state().studied.second).toMatchObject({ reusesBase: false, computing: true, result: null, stale: false, deck: { label: 'contre Kewl Tune · second' } });
    const input = state().studied.second.input!;
    expect(input).toEqual(buildEngineModel(state().studied.second.deck.source!).input);
    // Le deck de base d'abord (mode `full`, omis dans la requête), le deck étudié derrière lui (D4).
    expect(modes(0)).toEqual([undefined, 'passes']);
    await respond(0, 40);
    expect(state().result).not.toBeNull();
    await respond(1, 30);
    expect(state().studied.second).toMatchObject({ computing: true, hasDeltas: false, stale: false });
    expect(state().studied.second.result!.second).toEqual(computePass(input, 'second'));
    expect(state().lastPassMs).toEqual({ first: 15, second: 15 }); // première estimation : la moitié des deux passes
    // Deux temps (D4) : le résultat complet suit, pour les écarts de tuile (mode `full`, omis dans la requête).
    expect(posted()).toHaveLength(3);
    expect(posted()[2].req.input).toEqual(input);
    await respond(2, 90);
    expect(state().studied.second).toMatchObject({ computing: false, hasDeltas: true });
    expect(state().lastPassMs).toEqual({ first: 15, second: 15 }); // un résultat complet n'est pas une passe : rien n'est écrasé
    expect(state().studied.second.result!.deltas.length).toBeGreaterThan(0);
    expect(studiedPass(state(), 'second')).toBe(state().studied.second.result!.second);
  });

  it('un échange neutre (même entrée que le deck de base) réutilise le résultat de base : rien à calculer', async () => {
    seed([NEUTRAL_SWAP]);
    await baseComputed();
    state().setStudy(M);
    tick();
    expect(state().studied.second).toMatchObject({ reusesBase: true, computing: false, deck: { kind: 'sided' } });
    expect(state().studied.second.deck.applied!.status).toBe('ready');
    expect(studiedPass(state(), 'second')).toBe(state().result!.second);
    expect(posted()).toHaveLength(1);
  });

  it('deux positions au même deck sidé = un seul calcul ; un plan pas prêt = aucune source, aucun calcul', async () => {
    seed([{ ...STARTER_SWAP, position: 'first' }, STARTER_SWAP]);
    state().setStudy(M);
    tick();
    expect(state().studied.first.key).toBe(state().studied.second.key);
    expect(posted()).toHaveLength(1);
    // Une resynchronisation pendant le calcul (ici, une carte ajoutée au side) ne relance pas une entrée déjà en cours.
    state().addCard({ id: 99, name: 'Ajout', type: 'Spell Card' }, 1, 'side');
    tick();
    expect(posted()).toHaveLength(1);
    await respond(0);
    expect(state().studied.first.result).toBe(state().studied.second.result);
    seed([{ position: 'second', outgoing: [[NEUTRAL_A, 2]], incoming: [[SIDE_STARTER, 1]] }]);
    state().setStudy(null); state().setStudy(M);
    tick();
    expect(state().studied.second).toMatchObject({ result: null, computing: false, key: null, deck: { source: null, unavailableReason: expect.stringMatching(/incomplet/) } });
  });

  it('cache par entrée : revenir à un adversaire déjà calculé est instantané ; la tâche d’une entrée qui n’est plus attendue est annulée (worker terminé, sa réponse n’arrive jamais)', async () => {
    seed([STARTER_SWAP]);
    state().setStudy(M);
    tick();
    await respond(0);
    await respond(1);
    const full = state().studied.second.result;
    expect(state().studied.second.hasDeltas).toBe(true);
    state().setStudy(null);
    tick();
    expect(state().studied.second.reusesBase).toBe(true);
    state().setStudy(M);
    tick();
    expect(state().studied.second).toMatchObject({ result: full, hasDeltas: true, computing: false });
    expect(posted()).toHaveLength(2);
    // Le plan change (un starter sort en plus) : nouvelle entrée, ancien résultat gardé mais périmé.
    expect(state().swapInPlan(M, 'second', [{ card_id: STARTER, copies: 1 }], [{ card_id: SIDE_NEUTRAL, copies: 1 }])).toBe(true);
    tick();
    expect(state().studied.second).toMatchObject({ computing: true, stale: true, result: full });
    expect(posted()).toHaveLength(3);
    // Nouveau changement avant la réponse : la tâche partie pour l'entrée précédente est annulée (worker
    // terminé), sa réponse n'arrive jamais ; l'état reste périmé, en attente de la bonne entrée.
    expect(state().swapInPlan(M, 'second', [{ card_id: STARTER, copies: 1 }], [{ card_id: SIDE_NEUTRAL, copies: 1 }])).toBe(true);
    tick();
    expect(terminated(2)).toBe(true);
    expect(posted()).toHaveLength(4);
    await respond(2);
    expect(state().studied.second).toMatchObject({ computing: true, stale: true, result: full });
    expect(state().studied.second.input!.deckSize).toBe(12);
    await respond(3);
    expect(state().studied.second).toMatchObject({ computing: true, stale: false, hasDeltas: false });
  });

  it('un résultat périmé n’est gardé que pour le MÊME adversaire : jamais un chiffre de M1 sous le nom de M2', async () => {
    seed([STARTER_SWAP]);
    state().setStudy(M);
    tick();
    await respond(0);
    expect(state().studied.second.result).not.toBeNull();
    const M2 = '00000000-0000-4000-8000-0000000000bb';
    useDeck.setState({ matchups: [...state().matchups, { id: M2, name: 'Snake-Eye', sort_index: 1, plans: [{ position: 'second', note: null, outgoing: [{ card_id: STARTER, copies: 1 }], incoming: [{ card_id: SIDE_NEUTRAL, copies: 1 }] }] }] });
    state().setStudy(M2);
    tick();
    expect(state().studied.second).toMatchObject({ result: null, stale: false, computing: true, deck: { label: 'contre Snake-Eye · second' } });
  });

  it('une annotation sur une carte de side ne recalcule pas le deck de base, mais resynchronise le deck étudié, l’aperçu et les candidats (R6)', async () => {
    seed([NEUTRAL_SWAP]);
    await baseComputed();
    state().setStudy(M);
    tick();
    expect(state().studied.second.reusesBase).toBe(true);
    state().setSelection(sel([[NEUTRAL_B, 1]], []));
    expect(state().candidates.cards.map((c) => c.cardId)).toEqual([SIDE_NEUTRAL, SIDE_STARTER]);
    const before = state().candidates.cards.map((c) => c.key);
    const { modelVersion } = state();
    state().toggleStarter(SIDE_NEUTRAL); // carte de side : le deck de base ne change pas…
    expect(state()).toMatchObject({ modelVersion, dirty: true });
    tick();
    // …mais le deck étudié, lui, fait entrer un starter de plus : nouvelle entrée, calcul lancé.
    expect(state().studied.second).toMatchObject({ reusesBase: false, computing: true });
    expect(state().candidates.cards.map((c) => c.key)).not.toEqual(before);
  });
});

describe('aperçu (D5, S3)', () => {
  it('sélection équilibrée qui change le main : une seule passe, celle de la position, sur son client ; jamais « non enregistré »', async () => {
    seed([NEUTRAL_SWAP]);
    state().setStudy(M);
    const n = (await baseComputed()) + 1;
    state().setSelection(sel([[NEUTRAL_B, 1]], [[SIDE_STARTER, 1]]));
    expect(state().preview).toMatchObject({ kind: 'ready', affectsEngine: true, computing: true, pass: null, stale: false });
    expect(posted()).toHaveLength(n); // regroupement à 50 ms
    tick();
    expect(modes(n)).toEqual(['second']);
    expect(posted()[n].worker).not.toBe(posted()[0].worker); // son propre client, son propre worker
    await respond(n, 7);
    const preview = state().preview;
    expect(preview.kind).toBe('ready');
    if (preview.kind !== 'ready') return;
    expect(preview.pass).toEqual(computePass(buildEngineModel({ ...state(), main: preview.applied.main! }).input, 'second'));
    expect(preview.pass!.context).toBe('second');
    expect(state().lastPassMs.second).toBe(7);
    expect(state().dirty).toBe(false);
    expect(vi.mocked(saveDraft)).not.toHaveBeenCalled();
    // Une sélection d'Extra seule est prête sans rien calculer ; un échange neutre non plus (mêmes
    // chiffres que le plan) ; une sélection déséquilibrée n'a pas d'aperçu.
    const m = posted().length;
    state().setSelection(sel([[EXTRA, 1]], [[SIDE_EXTRA, 1]]));
    expect(state().preview).toMatchObject({ kind: 'ready', affectsEngine: false, pass: null, computing: false });
    state().setSelection(sel([[NEUTRAL_B, 1]], [[SIDE_NEUTRAL, 1]]));
    expect(state().preview).toMatchObject({ kind: 'ready', affectsEngine: false, pass: null, computing: false });
    state().setSelection(sel([[NEUTRAL_B, 2]], [[SIDE_STARTER, 1]]));
    expect(state().preview).toMatchObject({ kind: 'unbalanced' });
    tick();
    expect(posted()).toHaveLength(m);
  });

  it('changer la sélection avant la réponse annule l’aperçu en cours ; l’ancien chiffre reste, atténué ; une entrée déjà vue revient du cache', async () => {
    seed([NEUTRAL_SWAP]);
    state().setStudy(M);
    const n = (await baseComputed()) + 1;
    state().setSelection(sel([[NEUTRAL_B, 1]], [[SIDE_STARTER, 1]]));
    tick();
    await respond(n);
    const pass = (state().preview as { pass: unknown }).pass;
    state().setSelection(sel([[STARTER, 1]], [[SIDE_STARTER, 1]]));
    expect(state().preview).toMatchObject({ kind: 'ready', computing: true, stale: true, pass });
    tick();
    expect(posted()).toHaveLength(n + 2);
    // Retour à une entrée déjà vue (un autre neutre sort) : servie du cache ; la passe en cours est annulée.
    state().setSelection(sel([[NEUTRAL_C, 1]], [[SIDE_STARTER, 1]]));
    expect(state().preview).toMatchObject({ kind: 'ready', computing: false, stale: false, pass });
    expect(terminated(n + 1)).toBe(true);
    await respond(n + 1);
    expect(state().preview).toMatchObject({ kind: 'ready', computing: false, pass });
    state().clearSelection();
    expect(state().preview).toEqual({ kind: 'none' });
  });

  it('sur un plan incomplet, un échange équilibré acceptable n’est jamais un aperçu « prêt » sans deck : `not-ready`, rien de calculé', async () => {
    seed([{ position: 'second', outgoing: [[NEUTRAL_A, 1]], incoming: [] }]);
    state().setStudy(M);
    const n = (await baseComputed()) + 1;
    expect(state().studied.second.deck.source).toBeNull();
    state().setSelection(sel([[NEUTRAL_B, 1]], [[SIDE_NEUTRAL, 1]]));
    expect(state().preview).toMatchObject({ kind: 'not-ready', applied: { status: 'incomplete', main: null } });
    // Une sélection qui compléterait le plan n'est pas un échange (déséquilibrée en soi) : pas d'aperçu non plus.
    state().setSelection(sel([], [[SIDE_NEUTRAL, 1]]));
    expect(state().preview).toMatchObject({ kind: 'unbalanced' });
    tick();
    expect(posted()).toHaveLength(n);
  });

  it('« Échanger » = la sélection rejoint le plan (non enregistré), annuler l’échange le retire, vider le plan l’efface', async () => {
    seed([NEUTRAL_SWAP]);
    state().setStudy(M);
    state().adjustSelectionCopy('outgoing', NEUTRAL_B, 1);
    state().adjustSelectionCopy('incoming', SIDE_STARTER, 1);
    state().adjustSelectionCopy('incoming', SIDE_STARTER, 1); // une seule copie en side : bornée
    expect(state().selection).toEqual(sel([[NEUTRAL_B, 1]], [[SIDE_STARTER, 1]]));
    expect(state().commitSelection()).toBe(true);
    expect(state()).toMatchObject({ dirty: true, selection: { outgoing: [], incoming: [] }, preview: { kind: 'none' } });
    expect(state().swapHistory).toHaveLength(1);
    const plan = () => state().matchups[0].plans.find((p) => p.position === 'second')!;
    expect(plan().outgoing).toEqual([{ card_id: NEUTRAL_A, copies: 1 }, { card_id: NEUTRAL_B, copies: 1 }]);
    state().undoLastSwap();
    expect(plan().outgoing).toEqual([{ card_id: NEUTRAL_A, copies: 1 }]);
    expect(state().swapHistory).toHaveLength(0);
    state().clearOpenPlan();
    expect(plan()).toMatchObject({ outgoing: [], incoming: [] });
    // Un échange refusé nomme sa raison et ne change rien.
    state().setSelection(sel([[NEUTRAL_B, 2]], [[SIDE_STARTER, 1]]));
    expect(state().commitSelection()).toBe(false);
    expect(state().persistenceError).toMatch(/2 copies sortantes pour 1 entrante/);
    // Changer de position abandonne la sélection en cours et l'historique.
    state().setContext('first');
    expect(state()).toMatchObject({ selection: { outgoing: [], incoming: [] }, swapHistory: [], preview: { kind: 'none' } });
  });
});

describe('candidats (D6, S4, Q5)', () => {
  it('à une copie près : une passe par entrée distincte inconnue, automatique sous le budget, écarts contre le plan', async () => {
    seed([NEUTRAL_SWAP]);
    state().setStudy(M);
    const n = (await baseComputed()) + 1;
    state().setSelection(sel([[NEUTRAL_B, 1]], []));
    const c = state().candidates;
    // SIDE_NEUTRAL (1 copie libre) et SIDE_STARTER ; SIDE_EXTRA exclue. Deux entrées distinctes, dont
    // celle du neutre = celle du deck de base, déjà connue : une seule passe à calculer.
    expect(c).toMatchObject({ direction: 'incoming', distinct: 2, auto: true, status: 'running', done: 1 });
    expect(c.cards.map((x) => x.cardId)).toEqual([SIDE_NEUTRAL, SIDE_STARTER]);
    expect(modes(n)).toEqual(['second']);
    expect(candidateDeltaOf(state(), SIDE_STARTER)).toBeNull();
    expect(candidateDeltaOf(state(), SIDE_NEUTRAL)).toBe(0);
    await respond(n, 3);
    expect(state().candidates).toMatchObject({ status: 'done', done: 2 });
    // Écart = indicateur(plan + sélection + candidat) − indicateur(plan), le plan neutre valant le deck de base.
    const planIx = planIndicators(state().result!.second, 'second')!;
    const starterIn = state().candidates.cards.find((x) => x.cardId === SIDE_STARTER)!;
    const ix = state().candidates.indicators[starterIn.key];
    expect(candidateDeltaOf(state(), SIDE_STARTER)).toBe(ix.strongHand - planIx.strongHand);
    state().setCandidateIndicator('startOne');
    expect(candidateDeltaOf(state(), SIDE_STARTER)).toBe(ix.startOne - planIx.startOne);
    expect(candidateDeltaOf(state(), SIDE_STARTER)).toBeGreaterThan(0);
    // Un candidat déjà calculé ne se recalcule pas : la sélection change de sortante neutre, mêmes entrées.
    const m = posted().length;
    state().setSelection(sel([[NEUTRAL_C, 1]], []));
    expect(state().candidates).toMatchObject({ status: 'done', done: 2 });
    expect(posted()).toHaveLength(m);
  });

  it('la référence de l’écart est le PLAN, pas le deck de base : sur un plan qui change les chiffres, un candidat neutre vaut exactement zéro', async () => {
    seed([STARTER_SWAP]);
    await baseComputed();
    state().setStudy(M);
    tick();
    await respond(1);
    expect(studiedPass(state(), 'second')).not.toBe(state().result!.second);
    state().setSelection(sel([[NEUTRAL_B, 1]], []));
    // SIDE_STARTER est déjà toute engagée : seul le neutre est candidat, et son entrée est celle du plan.
    expect(state().candidates.cards.map((c) => c.cardId)).toEqual([SIDE_NEUTRAL]);
    expect(state().candidates).toMatchObject({ status: 'done', done: 1 });
    expect(candidateDeltaOf(state(), SIDE_NEUTRAL)).toBe(0);
    expect(planIndicators(state().result!.second, 'second')!.startOne).not.toBe(planIndicators(studiedPass(state(), 'second')!, 'second')!.startOne);
  });

  it('au-delà du budget : en attente jusqu’à « Calculer les écarts », puis progressif ; annulé si la sélection change', async () => {
    seed([NEUTRAL_SWAP]);
    state().setStudy(M);
    const n = (await baseComputed()) + 1;
    useDeck.setState({ lastPassMs: { first: null, second: 4000 } });
    state().setSelection(sel([[NEUTRAL_B, 1]], []));
    expect(state().candidates).toMatchObject({ status: 'pending', auto: false, estimateMs: 4000, distinct: 2, done: 1 });
    expect(posted()).toHaveLength(n);
    state().runCandidates();
    expect(state().candidates.status).toBe('running');
    expect(posted()).toHaveLength(n + 1);
    state().setSelection(sel([[NEUTRAL_B, 1]], [[SIDE_STARTER, 1]]));
    expect(state().candidates.status).toBe('none');
    expect(terminated(n)).toBe(true); // la passe en cours est annulée
    await respond(n);
    expect(state().candidates.status).toBe('none');
  });
});

describe('chiffres des plans persistés depuis le store (D17)', () => {
  it('seulement pour un deck sans modification non enregistrée, une fois par empreinte et révision', async () => {
    seed([STARTER_SWAP]);
    state().setStudy(M);
    tick();
    await respond(0);
    expect(vi.mocked(api.putPlanSummary)).toHaveBeenCalledTimes(1);
    const [id, matchupId, position, summary, revision] = vi.mocked(api.putPlanSummary).mock.calls[0];
    expect([id, matchupId, position, revision]).toEqual([deckId, M, 'second', 1]);
    expect(summary.mainSize).toBe(12);
    expect(state().planSummaries[`${M}:second`]).toEqual(summary);
    // Le volet premier (vide, deck de base réutilisé) n'existe pas dans le plan enregistré : rien n'est envoyé pour lui.
    expect(vi.mocked(api.putPlanSummary).mock.calls.every(([, , position]) => position === 'second')).toBe(true);
    await respond(1); // résultat complet : même empreinte, pas de second envoi
    expect(vi.mocked(api.putPlanSummary)).toHaveBeenCalledTimes(1);
    // Deck « non enregistré » : rien n'est persisté.
    state().swapInPlan(M, 'second', [{ card_id: STARTER, copies: 1 }], [{ card_id: SIDE_NEUTRAL, copies: 1 }]);
    tick();
    await respond(2);
    expect(state().dirty).toBe(true);
    expect(vi.mocked(api.putPlanSummary)).toHaveBeenCalledTimes(1);
  });
});

describe('ouverture d’un deck', () => {
  it('loadDeck repart du deck de base sans sélection ; le contexte vient ensuite de l’URL (EditorPage)', async () => {
    seed([STARTER_SWAP]);
    state().setStudy(M);
    const detail: DeckDetail = { id: 'B', name: 'Deck B', revision: 1, configuration_version: 2, cards: [{ card_id: 1, zone: 'main', copies: 3 }], starters: [], pairs: [], pair_exclusions: [], conditions: [], deadFirst: [], deadSecond: [], params: {}, notes: null, updated_at: '2026-09-07T00:00:00Z' };
    vi.mocked(api.getDeck).mockResolvedValue(detail);
    useDeck.setState({ lastPassMs: { first: 5, second: 4000 } });
    await state().loadDeck('B');
    // Position « premier » et mesures oubliées : l'estimation du budget d'un autre deck ne vaut rien ici.
    expect(state()).toMatchObject({ deckId: 'B', study: { matchupId: null }, context: 'first', lastPassMs: { first: null, second: null }, selection: { outgoing: [], incoming: [] }, swapHistory: [], preview: { kind: 'none' } });
    expect(state().studied.first.reusesBase).toBe(true);
  });
});

// ─── Partie C : ce que les consommateurs affichent (S1, S2, S3) ───
describe('colonnes de chiffres (columnOf) et mur de mains', () => {
  it('deck de base : deux colonnes nommées « Deck de base » sur le résultat de base ; plan pas prêt : aucune passe, raison (S2)', async () => {
    seed([{ position: 'second', outgoing: [[NEUTRAL_A, 2]], incoming: [[SIDE_STARTER, 1]] }]);
    await baseComputed();
    expect(columnOf(state(), 'second')).toMatchObject({ kind: 'base', label: 'Deck de base', reason: null, pass: state().result!.second, stale: false, computing: false, isPreview: false, deckSize: 12 });
    state().setStudy(M);
    tick();
    const col = columnOf(state(), 'second');
    expect(col).toMatchObject({ kind: 'sided', label: 'contre Kewl Tune · second', pass: null, isPreview: false });
    expect(col.reason).toMatch(/incomplet/);
    expect(columnOf(state(), 'first')).toMatchObject({ kind: 'sided', label: 'contre Kewl Tune · premier', reason: null, pass: state().result!.first }); // volet vide = deck de base, nommé autrement
    expect(drawHandsFromStore(6, 10)).toEqual([]); // aucune main d'un plan pas prêt
    expect(noteHandsFromStore([[1, 2, 3, 4, 7, 8]], 6)).toEqual([]);
  });

  it('deck sidé : la colonne porte la passe du deck étudié, périmée en attendant ; le mur tire dans le deck sidé', async () => {
    seed([STARTER_SWAP]);
    await baseComputed();
    state().setStudy(M);
    tick();
    expect(columnOf(state(), 'second')).toMatchObject({ kind: 'sided', label: 'contre Kewl Tune · second', pass: null, computing: true, stale: false });
    await respond(1);
    const col = columnOf(state(), 'second');
    expect(col).toMatchObject({ pass: state().studied.second.result!.second, computing: true, stale: false, deckSize: 12 }); // passes là, écarts en route
    // Le mur tire dans le main dérivé (SIDE_STARTER entré, un NEUTRAL_A de moins) et note avec la passe du deck sidé.
    const source = studiedSource(state(), 'second')!;
    expect(source.main.find((c) => c.cardId === SIDE_STARTER)).toEqual({ cardId: SIDE_STARTER, zone: 'main', copies: 1 });
    const hands = drawHandsFromStore(6, 40);
    expect(hands).toHaveLength(40);
    expect(hands.every((h) => h.length === 6 && h.every((c) => source.main.some((m) => m.cardId === c)))).toBe(true);
    expect(hands.some((h) => h.includes(SIDE_STARTER))).toBe(true); // la carte entrée par le plan se tire (P(jamais en 40 mains) ≈ 1e-12)
    const noted = noteHandsFromStore(hands, 6);
    expect(noted).toHaveLength(40);
    expect(noted.some((h) => h.starts >= 1)).toBe(true);
    // Notées avec le modèle ET la passe du deck sidé (jamais la passe du deck de base) : égalité stricte
    // avec le calcul direct du moteur.
    const model = buildEngineModel(source);
    const expected = evaluateHands({ hands, typeIndexByCardId: new Map(model.typeCardIds.map((id, i) => [id, i])), prep: prepare(model.input), context: 'second', scorer: buildScorer(col.pass!, state().importance) });
    expect(noted).toEqual(expected);
    const withBasePass = evaluateHands({ hands, typeIndexByCardId: new Map(model.typeCardIds.map((id, i) => [id, i])), prep: prepare(model.input), context: 'second', scorer: buildScorer(state().result!.second, state().importance) });
    expect(noted).not.toEqual(withBasePass);
  });

  it('aperçu (S3) : dans la position ouverte, la colonne prend la passe de l’aperçu, dite telle quelle, l’ancien chiffre atténué en attendant', async () => {
    seed([NEUTRAL_SWAP]);
    state().setStudy(M);
    const n = (await baseComputed()) + 1;
    state().setSelection(sel([[NEUTRAL_B, 1]], [[SIDE_STARTER, 1]]));
    expect(columnOf(state(), 'second')).toMatchObject({ isPreview: true, computing: true, stale: true, pass: state().result!.second, label: 'contre Kewl Tune · second' });
    expect(columnOf(state(), 'first')).toMatchObject({ isPreview: false, computing: false }); // l'autre position ne bouge pas
    tick();
    await respond(n, 5);
    const col = columnOf(state(), 'second');
    expect(col).toMatchObject({ isPreview: true, computing: false, stale: false, deckSize: 12 });
    expect(col.pass).not.toBe(state().result!.second);
    expect(col.pass!.context).toBe('second');
    // Le mur de mains ne suit pas l'aperçu : la colonne « sans aperçu » reste celle du plan.
    expect(columnOf(state(), 'second', false)).toMatchObject({ isPreview: false, pass: state().result!.second });
    expect(noteHandsFromStore(drawHandsFromStore(6, 5), 6).every((h) => h.cards.length === 6)).toBe(true);
    state().clearSelection();
    expect(columnOf(state(), 'second')).toMatchObject({ isPreview: false, pass: state().result!.second });
  });
});
