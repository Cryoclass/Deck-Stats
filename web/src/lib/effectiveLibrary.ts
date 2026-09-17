import { cardDefaults } from '../../../server/src/domain/cardDefaults.js';
import type { Availability, Card, CardOrigin, CardProfile, CardReference, LibraryChoice, NonEngineGroup } from '../types.js';

// ─── Bibliothèque effective (docs/annotations-par-defaut.md, D1, R1) ───
// Valeur effective d'une carte = choix du compte, sinon référence commune, sinon détection depuis le
// texte de la carte. Fonction pure : le serveur ne calcule jamais la détection (D13), le client la
// dérive des objets `Card` qu'il possède déjà. Ce fichier entre dans `__ENGINE_VERSION__`.
//
// Deux aspects indépendants (D6) : HOPT (`is_hopt` tri-état du choix, puis référence, puis détection)
// et non-engine (profil + plafond : `nonengine_choice` → profil matérialisé, même absent = « pas
// non-engine » ; sinon référence si `nonengine_set` ; sinon détection). Un plafond est désigné par
// son NOM (« Mulcharmy ») et résolu vers le groupe du compte qui porte ce nom (fourni de base, D7′) ;
// sans groupe de ce nom, le profil reste et le plafond tombe.

/** Ce que le client sait du compte et des références, sans rien de dérivé. */
export interface RawLibrary {
  /** Choix explicites `true` (aussi présents dans `choices`). */
  hopt: Set<number>;
  choices: Map<number, LibraryChoice>;
  /** Profils matérialisés (aspect non-engine choisi, avec profil). */
  chosenProfiles: Map<number, CardProfile>;
  groups: NonEngineGroup[];
  references: Map<number, CardReference>;
}

export interface EffectiveCard {
  isHopt: boolean;
  profile: CardProfile | null;
  origin: CardOrigin;
  /** Ce que le serveur doit matérialiser au premier geste sur l'aspect non-engine (D6). */
  inherited: { availability: Availability | null; group_name: string | null };
}

export interface EffectiveLibrary {
  hopt: Set<number>;
  profiles: Map<number, CardProfile>;
  origin: Map<number, CardOrigin>;
}

const groupIdByName = (groups: readonly NonEngineGroup[], name: string | null): string | null => {
  if (!name) return null;
  const builtin = groups.find((g) => g.name === name && g.is_builtin) ?? groups.find((g) => g.name === name);
  return builtin?.id ?? null;
};
const groupNameById = (groups: readonly NonEngineGroup[], id: string | null): string | null => (id ? groups.find((g) => g.id === id)?.name ?? null : null);

/** Valeur effective d'une carte. `card` absent (catalogue incomplet) = aucune détection. */
export function effectiveOf(raw: RawLibrary, cardId: number, card: Card | undefined): EffectiveCard {
  const choice = raw.choices.get(cardId);
  const reference = raw.references.get(cardId);
  const detected = card ? cardDefaults({ name: card.name, type: card.type ?? null, race: card.race ?? null, description: card.description ?? null }) : null;

  let isHopt = false;
  let hoptOrigin: CardOrigin['hopt'] = null;
  if (choice && choice.is_hopt !== null) { isHopt = choice.is_hopt; hoptOrigin = 'choice'; }
  else if (reference && reference.is_hopt !== null) { isHopt = reference.is_hopt; hoptOrigin = 'reference'; }
  else if (detected) { isHopt = detected.isHopt; hoptOrigin = detected.isHopt ? 'detection' : null; }

  let profile: CardProfile | null = null;
  let nonengineOrigin: CardOrigin['nonengine'] = null;
  let inherited: EffectiveCard['inherited'] = { availability: null, group_name: null };
  if (choice?.nonengine_choice) {
    profile = raw.chosenProfiles.get(cardId) ?? null;
    nonengineOrigin = 'choice';
    inherited = { availability: profile?.availability ?? null, group_name: groupNameById(raw.groups, profile?.groupId ?? null) };
  } else if (reference?.nonengine_set) {
    inherited = { availability: reference.availability, group_name: reference.availability ? reference.group_name : null };
    profile = reference.availability ? { availability: reference.availability, groupId: groupIdByName(raw.groups, reference.group_name) } : null;
    nonengineOrigin = 'reference';
  } else if (detected && detected.availability) {
    inherited = { availability: detected.availability, group_name: detected.group };
    profile = { availability: detected.availability, groupId: groupIdByName(raw.groups, detected.group) };
    nonengineOrigin = 'detection';
  }
  return { isHopt, profile, origin: { hopt: hoptOrigin, nonengine: nonengineOrigin }, inherited };
}

/** Bibliothèque effective pour un ensemble de cartes (main deck, tuiles, inventaire). */
export function effectiveLibrary(raw: RawLibrary, cards: Record<number, Card>, cardIds: Iterable<number>): EffectiveLibrary {
  const hopt = new Set<number>();
  const profiles = new Map<number, CardProfile>();
  const origin = new Map<number, CardOrigin>();
  for (const id of new Set(cardIds)) {
    const e = effectiveOf(raw, id, cards[id]);
    if (e.isHopt) hopt.add(id);
    if (e.profile) profiles.set(id, e.profile);
    origin.set(id, e.origin);
  }
  return { hopt, profiles, origin };
}
