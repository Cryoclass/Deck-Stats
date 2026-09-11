/** Relais des vignettes de cartes (étape 10D, PDF de la fiche des plans de side). Le CDN
 *  YGOProDeck n'envoie aucun en-tête CORS : une page peut AFFICHER ses images mais pas les LIRE
 *  (canvas → PDF). Servies par notre domaine, elles deviennent lisibles. L'adresse amont est FIXE —
 *  hôte et chemin constants, seul le passcode (strictement numérique) varie : jamais un relais
 *  ouvert vers une adresse fournie par le client. Aucune dépendance serveur ici. */
export const CARD_IMAGE_ORIGIN = 'https://images.ygoprodeck.com';

/** Adresse amont de la vignette d'un passcode, ou `null` si l'id n'est pas un entier positif écrit
 *  en chiffres (sans zéro de tête, 12 chiffres au plus). */
export function cardImageUpstream(rawId: string): string | null {
  if (!/^[1-9]\d{0,11}$/.test(rawId)) return null;
  return `${CARD_IMAGE_ORIGIN}/images/cards_small/${rawId}.jpg`;
}
