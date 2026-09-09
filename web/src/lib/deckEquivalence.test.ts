import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { useDeck } from '../store/deckStore.js';
import { buildEngineModel, type EngineModelSource } from './engineModel.js';
import { libraryState, stateFromConfiguration, configurationFromState } from './deckConfiguration.js';
import { buildDeckJson, parseDeckJson, toYdk } from './exportDeck.js';
import { parseYdk } from './ydk.js';
import { computeAll } from '../engine/enumerate.js';
import { emptyConfiguration, parseConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import type { Card, DeckCard, Library } from '../types.js';

// ─── Étape 6 (6A) — même deck métier depuis la création manuelle, l'import YDK et
// l'import JSON v2 : modèle moteur identique (contrat §1 « Import et création manuelle
// alimentent le même modèle » ; §2 « L'ordre d'affichage n'a aucun effet »). ───

vi.mock('../worker/client.js', () => ({ createEngineClient: () => ({ compute: () => ({ id: 0, promise: new Promise(() => {}), cancel() {} }), cancelAll() {}, dispose() {}, pendingCount: 0 }) }));
vi.mock('./draft.js', () => ({ saveDraft: vi.fn(async () => {}), clearDraft: vi.fn(async () => {}), loadDraft: vi.fn(async () => null) }));
vi.mock('./api.js', async (original) => {
  const actual = await original<typeof import('./api.js')>();
  return { ...actual, api: { ...actual.api, createDeck: vi.fn(), getLibrary: vi.fn(), cardsByIds: vi.fn(async () => []) } };
});

const deckId = '00000000-0000-4000-8000-000000000006';
const card = (id: number, name: string): Card => ({ id, name });
const A = card(1, 'Ash'); // 3 copies, HOPT, étiquette handtrap, profil flexible
const B = card(2, 'Starter'); // 2 copies, starter, condition : il reste ≥1 E
const C = card(3, 'Combo C'); // 2 copies, paire C+D
const D = card(4, 'Combo D'); // 1 copie
const E = card(5, 'Cible'); // 1 copie, cible de condition
const F = card(6, 'Filler'); // 3 copies, sans rôle

const library: Library = {
  hoptCardIds: [A.id],
  categories: [{ id: 'h', name: 'Handtrap', is_builtin: true }],
  cardCategories: [{ card_id: A.id, category_id: 'h' }],
  profiles: [{ card_id: A.id, availability: 'flexible', group_id: null }],
  groups: [],
};

/** Mêmes gestes d'annotation sur les trois decks (paires et conditions sont locales). */
function annotate(): void {
  const s = useDeck.getState();
  s.toggleStarter(B.id);
  s.togglePair(D.id, C.id);
  s.toggleRequirement({ cardId: B.id }, E.id);
}

/** Ordre canonique du serveur (`readConfiguration` : zone, card_id) ; aucun tri n'est
 *  appliqué dans l'éditeur pendant la saisie. */
function canonical(source: EngineModelSource): EngineModelSource {
  return { ...source, main: [...source.main].sort((x, y) => x.zone.localeCompare(y.zone) || x.cardId - y.cardId) };
}

/** Égalité à 1e-12 près sur toute structure numérique (l'ordre des types change l'ordre
 *  des sommations flottantes, pas les valeurs). */
function expectApprox(actual: unknown, expected: unknown, path = ''): void {
  if (typeof expected === 'number') {
    expect(typeof actual, path).toBe('number');
    expect(Math.abs((actual as number) - expected), path).toBeLessThanOrEqual(1e-12);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual) && (actual as unknown[]).length === expected.length, path).toBe(true);
    expected.forEach((v, i) => expectApprox((actual as unknown[])[i], v, `${path}[${i}]`));
  } else if (expected && typeof expected === 'object') {
    expect(Object.keys(actual as object).sort(), path).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) expectApprox((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
  } else {
    expect(actual, path).toEqual(expected);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  useDeck.setState(useDeck.getInitialState(), true);
  useDeck.setState({ ...libraryState(library), deckId, revision: 1 });
});

describe('Étape 6 — équivalence création / import', () => {
  it('création manuelle, import YDK et import JSON v2 donnent le même modèle moteur', async () => {
    // 1. Création manuelle : ajouts et compteur de copies, dans un ordre quelconque.
    const s = useDeck.getState();
    for (const c of [F, F, F, E, D, C, C, B, A, A, A]) expect(s.addCard(c)).toBe(true);
    expect(s.setCopies(B.id, 2)).toBe(true);
    annotate();
    const manual = { ...useDeck.getState() };
    const manualConfig = configurationFromState(manual);
    expect(manualConfig.cards.map((c) => [c.card_id, c.copies])).toEqual([[6, 3], [5, 1], [4, 1], [3, 2], [2, 2], [1, 3]]);

    // 2. Import YDK : fichier écrit à la main dans un autre ordre, avec commentaires et CRLF,
    //    passé par le chemin réel (createDeckFromParsed → document POST /api/decks).
    const ydk = ['#created by hand', '#main', '1', '1', '1', '2', '2', '3', '3', '4', '5', '6', '6', '6', '#extra', '!side', ''].join('\r\n');
    const report = parseYdk(ydk);
    expect(report).toMatchObject({ ignored: [], unknownHeaders: [], overLimit: [] });
    vi.mocked(api.createDeck).mockResolvedValue({ id: deckId });
    expect(await useDeck.getState().createDeckFromParsed('Import', report.deck, [])).toBe(deckId);
    const [name, cards] = vi.mocked(api.createDeck).mock.calls[0];
    const importedConfig = parseConfiguration(emptyConfiguration(name, cards)); // ce que le serveur valide
    useDeck.setState({ ...useDeck.getInitialState(), ...libraryState(library), ...stateFromConfiguration(importedConfig), deckId, revision: 1 }, true);
    annotate();
    const fromYdk = { ...useDeck.getState() };

    // 3. Import JSON v2 : archive complète (annotations comprises) relue.
    const archive = parseDeckJson(JSON.stringify(buildDeckJson(manualConfig, library)));
    const fromJson: EngineModelSource = {
      ...stateFromConfiguration(archive.configuration),
      ...libraryState({ ...archive.library, categories: archive.library.categories.map((c) => ({ ...c, is_builtin: false })) }),
    };

    // Modèles identiques après mise en ordre canonique (celui de la relecture serveur).
    const reference = buildEngineModel(canonical(manual));
    expect(buildEngineModel(canonical(fromYdk))).toEqual(reference);
    expect(buildEngineModel(canonical(fromJson))).toEqual(reference);
    expect(reference.typeCardIds).toEqual([1, 2, 3, 4, 5]);
    expect(reference.input.deckSize).toBe(12);
    expect(reference.input.types.find((t) => t.isStarter)?.starterCondition).toEqual({ kind: 'and', all: [{ kind: 'remaining', type: 4, atLeast: 1 }] });

    // Même YDK relu depuis l'export du deck manuel : aucun écart.
    const roundTrip = parseYdk(toYdk(manualConfig.cards.map((c) => ({ cardId: c.card_id, zone: c.zone, copies: c.copies }))));
    expect([...roundTrip.deck.main]).toEqual(manualConfig.cards.map((c) => [c.card_id, c.copies]));
  });

  it('l’ordre de saisie ne change aucune probabilité : mêmes résultats sur le modèle non trié', () => {
    const s = useDeck.getState();
    for (const c of [F, F, F, E, D, C, C, B, A, A, A]) s.addCard(c);
    s.setCopies(B.id, 2);
    annotate();
    const unsorted = buildEngineModel({ ...useDeck.getState() });
    const sorted = buildEngineModel(canonical({ ...useDeck.getState() }));
    expect(unsorted.typeCardIds).toEqual([5, 4, 3, 2, 1]);
    const ru = computeAll(unsorted.input);
    const rs = computeAll(sorted.input);
    // Les seaux (`buckets`) suivent l'ordre d'énumération des types : on compare les
    // distributions et agrégats, qui sont les grandeurs du contrat §5.
    const aggregates = (p: typeof ru.first) => ({
      total: p.total, outcomes: p.outcomes, brick: p.brick, startsBuckets: p.startsBuckets, startsExact: p.startsExact,
      meanStarts: p.meanStarts, redundancy: p.redundancy, nonEngine: p.nonEngine, meanNonEngine: p.meanNonEngine,
      perCategory: p.perCategory, crossMatrix: p.crossMatrix, bucketMass: p.buckets.reduce((s, b) => s + b.p, 0),
    });
    expectApprox(aggregates(ru.first), aggregates(rs.first), 'first');
    expectApprox(aggregates(ru.second), aggregates(rs.second), 'second');
    const byCard = (model: typeof unsorted, deltas: typeof ru.deltas) => Object.fromEntries(model.typeCardIds.map((id, i) => [id, deltas[i]]));
    expectApprox(byCard(unsorted, ru.deltas), byCard(sorted, rs.deltas), 'deltas');
    expect(rs.first.brick).toBeGreaterThan(0);
    expect(rs.first.brick).toBeLessThan(1);
  });

  // Étape 9C : l'équivalence couvre les trois zones. Le modèle moteur ne dépend que du main
  // deck (contrat §2, `buildEngineModel` ne lit que `main`) : extra et side saisis, importés ou
  // relus doivent être identiques entre les trois chemins ET laisser le modèle strictement égal
  // au modèle « main seul ».
  it('les trois zones sont équivalentes depuis la création, le YDK et le JSON v2 ; le modèle moteur ne dépend ni de l’extra ni du side', async () => {
    const X = card(7, 'Extra Pi');
    const Y = card(8, 'Side Rho');
    const zonesOf = (src: { main: DeckCard[]; extra: DeckCard[]; side: DeckCard[] }) =>
      [...src.main, ...src.extra, ...src.side].map((c) => [c.zone, c.cardId, c.copies] as const).sort((p, q) => p[0].localeCompare(q[0]) || p[1] - q[1]);

    // 1. Création manuelle : main d'abord, modèle de référence pris AVANT l'extra et le side.
    const s = useDeck.getState();
    for (const c of [F, F, F, E, D, C, C, B, A, A, A]) expect(s.addCard(c)).toBe(true);
    expect(s.setCopies(B.id, 2)).toBe(true);
    annotate();
    const mainOnly = buildEngineModel(canonical({ ...useDeck.getState() }));
    expect(s.addCard(X, 1, 'extra')).toBe(true);
    expect(s.addCard(X, 1, 'extra')).toBe(true);
    expect(s.addCard(Y, 1, 'side')).toBe(true);
    expect(s.addCard(A, 1, 'side')).toBe(true); // A est aussi en main : la convention 1–3 est par zone
    const manual = { ...useDeck.getState() };
    const manualConfig = configurationFromState(manual);
    expect(manualConfig.cards.filter((c) => c.zone !== 'main')).toEqual([
      { card_id: 7, zone: 'extra', copies: 2 }, { card_id: 8, zone: 'side', copies: 1 }, { card_id: 1, zone: 'side', copies: 1 },
    ]);
    expect(buildEngineModel(canonical(manual))).toEqual(mainOnly);

    // 2. Import YDK avec les sections #extra et !side, par le chemin réel.
    const ydk = ['#main', '1', '1', '1', '2', '2', '3', '3', '4', '5', '6', '6', '6', '#extra', '7', '7', '!side', '8', '1', ''].join('\n');
    const report = parseYdk(ydk);
    expect(report).toMatchObject({ ignored: [], unknownHeaders: [], overLimit: [] });
    vi.mocked(api.createDeck).mockResolvedValue({ id: deckId });
    expect(await useDeck.getState().createDeckFromParsed('Import', report.deck, [])).toBe(deckId);
    const [name, cards] = vi.mocked(api.createDeck).mock.calls[0];
    const importedConfig = parseConfiguration(emptyConfiguration(name, cards));
    useDeck.setState({ ...useDeck.getInitialState(), ...libraryState(library), ...stateFromConfiguration(importedConfig), deckId, revision: 1 }, true);
    annotate();
    const fromYdk = { ...useDeck.getState() };

    // 3. Import JSON v2 relu depuis l'archive du deck manuel.
    const archive = parseDeckJson(JSON.stringify(buildDeckJson(manualConfig, library)));
    const fromJson = {
      ...stateFromConfiguration(archive.configuration),
      ...libraryState({ ...archive.library, categories: archive.library.categories.map((c) => ({ ...c, is_builtin: false })) }),
    };

    expect(zonesOf(fromYdk)).toEqual(zonesOf(manual));
    expect(zonesOf(fromJson)).toEqual(zonesOf(manual));
    expect(zonesOf(manual).filter(([zone]) => zone !== 'main')).toEqual([['extra', 7, 2], ['side', 1, 1], ['side', 8, 1]]);
    expect(buildEngineModel(canonical(fromYdk))).toEqual(mainOnly);
    expect(buildEngineModel(canonical(fromJson))).toEqual(mainOnly);
    expect(mainOnly.input.deckSize).toBe(12);
    expect(mainOnly.typeCardIds).not.toContain(7);
    expect(mainOnly.typeCardIds).not.toContain(8);

    // YDK réexporté puis relu : les trois sections reviennent identiques.
    const roundTrip = parseYdk(toYdk(manualConfig.cards.map((c) => ({ cardId: c.card_id, zone: c.zone, copies: c.copies }))));
    expect([...roundTrip.deck.extra]).toEqual([[7, 2]]);
    expect([...roundTrip.deck.side]).toEqual([[8, 1], [1, 1]]);
  });
});
