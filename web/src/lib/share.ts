import LZString from 'lz-string';
import type { Category, ComboPair, DeckCard } from '../types.js';

/** État sérialisable partageable par URL compressée (§6.3). Ne contient que des
 *  ids — noms et images sont re-résolus/dérivés à la lecture. */
export interface SharedState {
  v: 1;
  name: string;
  cards: DeckCard[];
  starters: number[];
  pairExclusions: string[];
  pairs: ComboPair[];
  hopt: number[];
  categories: Category[];
  cardCategories: Array<[number, string]>;
}

export function encodeState(s: SharedState): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(s));
}

export function decodeState(encoded: string): SharedState | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed = JSON.parse(json);
    return parsed?.v === 1 ? (parsed as SharedState) : null;
  } catch {
    return null;
  }
}

export function readStateFromHash(): SharedState | null {
  const hash = window.location.hash.replace(/^#s=/, '');
  return hash && hash !== window.location.hash ? decodeState(hash) : null;
}

export function writeStateToHash(s: SharedState): void {
  const encoded = encodeState(s);
  history.replaceState(null, '', `#s=${encoded}`);
}
