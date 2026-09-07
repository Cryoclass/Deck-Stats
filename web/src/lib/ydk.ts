import type { Zone } from '../types.js';

export interface ParsedDeck {
  main: Map<number, number>; // cardId → copies
  extra: Map<number, number>;
  side: Map<number, number>;
}

/** Convention de composition (contrat §2) : 1 à 3 copies par carte et par zone. */
export const MAX_COPIES = 3;

/**
 * Rapport d'analyse d'un fichier YDK ou d'un texte collé (étape 6, contrat §2).
 * Le parseur ne réduit ni n'ignore rien en silence : `deck` porte les quantités
 * BRUTES (4 copies restent 4), et chaque écart est listé pour être présenté avant
 * l'import. La réduction à la convention est un geste explicite (`clampToConvention`).
 */
export interface ParseReport {
  deck: ParsedDeck;
  /** Lignes non reconnues (texte, passcode non entier, zéro ou négatif, compte nul). */
  ignored: Array<{ line: number; text: string }>;
  /** Lignes ressemblant à un en-tête de zone mais inconnues (`#side`, `!extra`) : les
   *  cartes qui suivent restent dans la zone précédente. */
  unknownHeaders: Array<{ line: number; text: string }>;
  /** Cartes au-delà de la convention 1–3, avec la quantité demandée. */
  overLimit: Array<{ cardId: number; zone: Zone; copies: number }>;
}

const emptyDeck = (): ParsedDeck => ({ main: new Map(), extra: new Map(), side: new Map() });
const ZONE_WORDS = new Set(['main', 'extra', 'side']);
/** Un passcode = entier décimal strict ; aucune coercition (`0x10`, `1e7`, `12.5` refusés). */
const PASSCODE = /^\d+$/;

function add(map: Map<number, number>, id: number, count: number): void {
  map.set(id, (map.get(id) ?? 0) + count);
}

function finish(deck: ParsedDeck, ignored: ParseReport['ignored'], unknownHeaders: ParseReport['unknownHeaders']): ParseReport {
  return { deck, ignored, unknownHeaders, overLimit: overLimit(deck) };
}

/** Cartes hors convention (copies > 3) d'un deck brut. */
export function overLimit(deck: ParsedDeck): ParseReport['overLimit'] {
  const out: ParseReport['overLimit'] = [];
  for (const zone of ['main', 'extra', 'side'] as const) {
    for (const [cardId, copies] of deck[zone]) if (copies > MAX_COPIES) out.push({ cardId, zone, copies });
  }
  return out;
}

/** Réduction EXPLICITE à la convention 1–3, après décision de l'utilisateur. */
export function clampToConvention(deck: ParsedDeck): ParsedDeck {
  const clamp = (m: Map<number, number>) => new Map([...m].map(([id, n]) => [id, Math.min(MAX_COPIES, n)]));
  return { main: clamp(deck.main), extra: clamp(deck.extra), side: clamp(deck.side) };
}

export function deckCardCount(deck: ParsedDeck): number {
  const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  return sum(deck.main) + sum(deck.extra) + sum(deck.side);
}

/**
 * Parse un fichier YDK (§4.1). Format : sections #main / #extra / !side, une ligne =
 * un passcode (= cards.id), copies multiples en lignes répétées. Tolérances
 * documentées : lignes avant tout `#main` rangées dans le main ; autres lignes `#…`
 * ou `!…` = commentaires. Tout le reste est rapporté, jamais absorbé.
 */
export function parseYdk(text: string): ParseReport {
  const deck = emptyDeck();
  const ignored: ParseReport['ignored'] = [];
  const unknownHeaders: ParseReport['unknownHeaders'] = [];
  let zone: Zone = 'main';
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const lineNo = index + 1;
    const lower = line.toLowerCase();
    if (lower.startsWith('#extra')) { zone = 'extra'; return; }
    if (lower.startsWith('!side')) { zone = 'side'; return; }
    if (lower.startsWith('#main')) { zone = 'main'; return; }
    if (line.startsWith('#') || line.startsWith('!')) {
      const word = /^[#!]\s*([a-z]+)/i.exec(line)?.[1]?.toLowerCase();
      if (word && ZONE_WORDS.has(word)) unknownHeaders.push({ line: lineNo, text: line });
      return; // autres commentaires
    }
    if (!PASSCODE.test(line) || Number(line) <= 0 || !Number.isSafeInteger(Number(line))) {
      ignored.push({ line: lineNo, text: line });
      return;
    }
    add(deck[zone], Number(line), 1);
  });
  return finish(deck, ignored, unknownHeaders);
}

/**
 * Parse une liste texte collée (main deck seulement). Formes reconnues, documentées
 * dans le libellé du champ : « 12345678 », « 3x 12345678 », « 3 12345678 »
 * (compte de 1 à 2 chiffres, passcode d'au moins 4 chiffres, donc sans ambiguïté) ;
 * un texte après le passcode est ignoré (« 12345678 Ash Blossom »). Les lignes
 * `#…` / `!…` sont des commentaires. Un compte nul ou une ligne non reconnue est
 * rapporté ; les noms ne sont pas résolus ici (§4.1).
 */
export function parsePastedIds(text: string): ParseReport {
  const deck = emptyDeck();
  const ignored: ParseReport['ignored'] = [];
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) return;
    const m = /^(?:(\d{1,2})\s*(?:[x×*]\s*|\s+))?(\d{4,})(?:\s+.*)?$/i.exec(line);
    const count = m ? (m[1] === undefined ? 1 : Number(m[1])) : 0;
    const id = m ? Number(m[2]) : 0;
    if (!m || count < 1 || id <= 0 || !Number.isSafeInteger(id)) {
      ignored.push({ line: index + 1, text: line });
      return;
    }
    add(deck.main, id, count);
  });
  return finish(deck, ignored, []);
}
