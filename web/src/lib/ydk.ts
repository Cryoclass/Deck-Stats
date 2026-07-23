import type { Zone } from '../types.js';

export interface ParsedDeck {
  main: Map<number, number>; // cardId → copies
  extra: Map<number, number>;
  side: Map<number, number>;
}

/**
 * Parse un fichier YDK (§4.1). Format : sections #main / #extra / !side,
 * une ligne = un passcode (= cards.id). Les copies multiples apparaissent en
 * lignes répétées. Copies > 3 rejetées à l'import (§D).
 */
export function parseYdk(text: string): ParsedDeck {
  const deck: ParsedDeck = { main: new Map(), extra: new Map(), side: new Map() };
  let zone: Zone = 'main';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (lower.startsWith('#extra')) {
      zone = 'extra';
      continue;
    }
    if (lower.startsWith('!side')) {
      zone = 'side';
      continue;
    }
    if (lower.startsWith('#main')) {
      zone = 'main';
      continue;
    }
    if (line.startsWith('#') || line.startsWith('!')) continue; // autres commentaires
    const id = Number(line);
    if (!Number.isFinite(id) || id <= 0) continue;
    const map = deck[zone];
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  clampCopies(deck.main);
  clampCopies(deck.extra);
  clampCopies(deck.side);
  return deck;
}

/**
 * Parse une liste texte collée. Deux formats tolérés :
 *   - « 3x 12345678 » / « 3 12345678 » / « 12345678 » (passcodes)
 *   - passcodes bruts un par ligne
 * Les noms ne sont pas résolus ici (on ne connaît que les ids côté import, §4.1).
 */
export function parsePastedIds(text: string): Map<number, number> {
  const map = new Map<number, number>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const m = line.match(/^(?:(\d+)\s*[x*]\s*)?(\d{4,})/i);
    if (!m) continue;
    const count = m[1] ? Number(m[1]) : 1;
    const id = Number(m[2]);
    if (!Number.isFinite(id)) continue;
    map.set(id, (map.get(id) ?? 0) + count);
  }
  clampCopies(map);
  return map;
}

function clampCopies(map: Map<number, number>): void {
  for (const [id, n] of map) map.set(id, Math.max(1, Math.min(3, n)));
}
