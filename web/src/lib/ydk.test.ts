import { describe, expect, it } from 'vitest';
import { clampToConvention, deckCardCount, overLimit, parsePastedIds, parseYdk } from './ydk.js';
import { toYdk } from './exportDeck.js';

// ─── Étape 6 (6A) — tolérances du parseur YDK et du collage : rapportées, jamais absorbées ───

const m = (map: Map<number, number>) => Object.fromEntries(map);

describe('parseYdk — inventaire Y1–Y6', () => {
  it('Y1/Y2/Y3 : lignes non numériques, coercitions et passcodes ≤ 0 sont rapportées avec leur numéro de ligne', () => {
    const r = parseYdk(['#created by test', '#main', 'Ash Blossom', '12345678abc', '0x10', '1e7', '+123', '12.5', '0', '-5', '14558127', ''].join('\n'));
    expect(m(r.deck.main)).toEqual({ 14558127: 1 });
    expect(r.ignored).toEqual([
      { line: 3, text: 'Ash Blossom' },
      { line: 4, text: '12345678abc' },
      { line: 5, text: '0x10' },
      { line: 6, text: '1e7' },
      { line: 7, text: '+123' },
      { line: 8, text: '12.5' },
      { line: 9, text: '0' },
      { line: 10, text: '-5' },
    ]);
    expect(r.unknownHeaders).toEqual([]);
    expect(r.overLimit).toEqual([]);
  });

  it('Y4 : quatre lignes d’un même passcode restent quatre copies brutes, listées ; la réduction est un geste explicite', () => {
    const r = parseYdk('#main\n1\n1\n1\n1\n2\n#extra\n3\n3\n3\n3\n3\n!side\n2\n');
    expect(m(r.deck.main)).toEqual({ 1: 4, 2: 1 });
    expect(m(r.deck.extra)).toEqual({ 3: 5 });
    expect(r.overLimit).toEqual([
      { cardId: 1, zone: 'main', copies: 4 },
      { cardId: 3, zone: 'extra', copies: 5 },
    ]);
    expect(deckCardCount(r.deck)).toBe(11);
    const clamped = clampToConvention(r.deck);
    expect(m(clamped.main)).toEqual({ 1: 3, 2: 1 });
    expect(m(clamped.extra)).toEqual({ 3: 3 });
    expect(m(clamped.side)).toEqual({ 2: 1 });
    expect(overLimit(clamped)).toEqual([]);
    // Le rapport d'origine n'est pas modifié par la réduction.
    expect(m(r.deck.main)).toEqual({ 1: 4, 2: 1 });
  });

  it('Y5 : un en-tête ressemblant à une zone mais inconnu est rapporté ; les cartes suivantes restent dans la zone précédente ; les autres commentaires sont tolérés', () => {
    const r = parseYdk('#main\n1\n#side\n2\n!extra\n3\n#created by x\n!Side Deck\n4\n');
    expect(m(r.deck.main)).toEqual({ 1: 1, 2: 1, 3: 1 });
    expect(m(r.deck.side)).toEqual({ 4: 1 });
    expect(r.unknownHeaders).toEqual([
      { line: 3, text: '#side' },
      { line: 5, text: '!extra' },
    ]);
    expect(r.ignored).toEqual([]);
  });

  it('Y6 : sans en-tête, les lignes vont dans le main ; CRLF, espaces, BOM et en-têtes en majuscules acceptés', () => {
    const r = parseYdk('﻿ 10 \r\n10\r\n#EXTRA\r\n20\r\n!SIDE\r\n30\r\n');
    expect(m(r.deck.main)).toEqual({ 10: 2 });
    expect(m(r.deck.extra)).toEqual({ 20: 1 });
    expect(m(r.deck.side)).toEqual({ 30: 1 });
    expect(r.ignored).toEqual([]);
  });

  it('aller-retour : un export YDK se relit sans écart ni ligne rapportée', () => {
    const rows = [
      { cardId: 14558127, zone: 'main' as const, copies: 3 },
      { cardId: 27204311, zone: 'main' as const, copies: 1 },
      { cardId: 1, zone: 'extra' as const, copies: 2 },
      { cardId: 2, zone: 'side' as const, copies: 1 },
    ];
    const r = parseYdk(toYdk(rows));
    expect(m(r.deck.main)).toEqual({ 14558127: 3, 27204311: 1 });
    expect(m(r.deck.extra)).toEqual({ 1: 2 });
    expect(m(r.deck.side)).toEqual({ 2: 1 });
    expect(r).toMatchObject({ ignored: [], unknownHeaders: [], overLimit: [] });
  });
});

describe('parsePastedIds — inventaire P1–P5', () => {
  it('P3/P5 : « 3x id », « 3 id », « id texte » sont reconnus ; les commentaires sont tolérés', () => {
    const r = parsePastedIds('# liste\n3x 14558127\n2 27204311\n3*1000\n2×2000\n5000 Ash Blossom\n1x3000\n');
    expect(m(r.deck.main)).toEqual({ 14558127: 3, 27204311: 2, 1000: 3, 2000: 2, 5000: 1, 3000: 1 });
    expect(r.ignored).toEqual([]);
    expect(r.overLimit).toEqual([]);
  });

  it('P1/P4 : compte nul, passcode court, texte libre et coercitions sont rapportés, jamais transformés en 1 copie', () => {
    const r = parsePastedIds('0x 14558127\n3x 123\nAsh Blossom\n1e7\n12.5\n14558127\n');
    expect(m(r.deck.main)).toEqual({ 14558127: 1 });
    expect(r.ignored).toEqual([
      { line: 1, text: '0x 14558127' },
      { line: 2, text: '3x 123' },
      { line: 3, text: 'Ash Blossom' },
      { line: 4, text: '1e7' },
      { line: 5, text: '12.5' },
    ]);
  });

  it('P2 : « 5x » ou un cumul de lignes au-delà de 3 reste brut et listé', () => {
    const r = parsePastedIds('5x 1000\n2x 2000\n2x 2000\n');
    expect(m(r.deck.main)).toEqual({ 1000: 5, 2000: 4 });
    expect(r.overLimit).toEqual([
      { cardId: 1000, zone: 'main', copies: 5 },
      { cardId: 2000, zone: 'main', copies: 4 },
    ]);
    expect(m(clampToConvention(r.deck).main)).toEqual({ 1000: 3, 2000: 3 });
  });

  it('texte vide ou uniquement des commentaires : aucune carte, aucune ligne rapportée', () => {
    expect(deckCardCount(parsePastedIds('').deck)).toBe(0);
    expect(parsePastedIds('# rien\n\n!rien').ignored).toEqual([]);
  });
});
