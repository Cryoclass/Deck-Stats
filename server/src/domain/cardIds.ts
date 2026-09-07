/** Pure helper shared by the catalogue lookup route; no server/framework imports. */
import { cardIdValid } from './deckConfiguration.js';

/**
 * Liste de passcodes « 123,456 » → entiers positifs (étape 6, C5). Aucune coercition :
 * `1e3`, `0x10`, `12.5`, un vide ou un négatif rendent la liste invalide (`null`) au
 * lieu d'être absorbés ou de finir en erreur SQL. Les doublons sont dédupliqués.
 */
export function parseCardIdList(raw: string): number[] | null {
  const ids: number[] = [];
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    if (!cardIdValid(n)) return null;
    if (!ids.includes(n)) ids.push(n);
  }
  return ids;
}
