import { availabilityValid, cardIdValid, ConfigurationError, parseConfiguration, record, upgradeConfiguration, type Availability, type Configuration } from './deckConfiguration.js';

export interface DeckArchive {
  format: 'ygo-proba-deck';
  version: 2;
  configuration: Configuration;
  library: {
    hoptCardIds: number[];
    categories: Array<{ id: string; name: string }>;
    cardCategories: Array<{ card_id: number; category_id: string }>;
    /** Profils de disponibilité (contrat §3) et plafonds partagés du compte. */
    profiles: Array<{ card_id: number; availability: Availability; group_id: string | null }>;
    groups: Array<{ id: string; name: string; cap_per_turn: number }>;
  };
}

export function parseArchive(value: unknown): DeckArchive {
  const fail = (message: string): never => { throw new ConfigurationError(message); };
  if (!record(value) || value.format !== 'ygo-proba-deck') fail('Format JSON de deck invalide.');
  const v = value as Record<string, unknown>;
  if (v.version !== 2) fail('Version JSON non prise en charge. Les exports version 1 doivent être convertis explicitement ; leurs paires globales ne sont pas réimportées.');
  // Archives antérieures à l'étape 5B : prérequis ET convertis explicitement (règle de la migration 002).
  const configuration = parseConfiguration(upgradeConfiguration(v.configuration));
  if (!record(v.library)) fail('Bibliothèque requise.');
  const lib = v.library as Record<string, unknown>;
  if (!Array.isArray(lib.hoptCardIds) || !lib.hoptCardIds.every(cardIdValid)) fail('HOPT invalides.');
  if (!Array.isArray(lib.categories) || !Array.isArray(lib.cardCategories)) fail('Catégories invalides.');
  const seenIds = new Set<string>(); const seenNames = new Set<string>();
  const categories: DeckArchive['library']['categories'] = [];
  for (const c of lib.categories as unknown[]) {
    // `relevance` des anciens exports est ignorée : une catégorie est une étiquette (Q4).
    if (!record(c) || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 200) fail('Catégorie invalide.');
    const cat = c as { id: string; name: string };
    if (seenIds.has(cat.id) || seenNames.has(cat.name)) fail('Catégorie dupliquée.');
    seenIds.add(cat.id); seenNames.add(cat.name);
    categories.push({ id: cat.id, name: cat.name });
  }
  for (const cc of lib.cardCategories as unknown[]) {
    if (!record(cc) || !cardIdValid(cc.card_id) || typeof cc.category_id !== 'string' || !seenIds.has(cc.category_id)) fail('Affectation de catégorie invalide.');
  }
  const groups: DeckArchive['library']['groups'] = [];
  const groupIds = new Set<string>(); const groupNames = new Set<string>();
  for (const g of (lib.groups ?? []) as unknown[]) {
    if (!record(g) || typeof g.id !== 'string' || !g.id || typeof g.name !== 'string' || !g.name.trim() || g.name.length > 200 || !Number.isInteger(g.cap_per_turn) || Number(g.cap_per_turn) < 1 || Number(g.cap_per_turn) > 32767) fail('Plafond partagé invalide.');
    const group = g as { id: string; name: string; cap_per_turn: number };
    if (groupIds.has(group.id) || groupNames.has(group.name)) fail('Plafond partagé dupliqué.');
    groupIds.add(group.id); groupNames.add(group.name);
    groups.push({ id: group.id, name: group.name, cap_per_turn: group.cap_per_turn });
  }
  const profiles: DeckArchive['library']['profiles'] = [];
  const profiled = new Set<number>();
  for (const p of (lib.profiles ?? []) as unknown[]) {
    if (!record(p) || !cardIdValid(p.card_id) || !availabilityValid(p.availability) || (p.group_id != null && (typeof p.group_id !== 'string' || !groupIds.has(p.group_id)))) fail('Profil de disponibilité invalide.');
    const profile = p as { card_id: number; availability: Availability; group_id?: string | null };
    if (profiled.has(profile.card_id)) fail('Profil dupliqué.');
    profiled.add(profile.card_id);
    profiles.push({ card_id: profile.card_id, availability: profile.availability, group_id: profile.group_id ?? null });
  }
  remapCategoryReferences(configuration.params, new Map([...seenIds].map((id) => [id,id])));
  return { format: 'ygo-proba-deck', version: 2, configuration,
    library: { hoptCardIds: [...(lib.hoptCardIds as number[])], categories, cardCategories: structuredClone(lib.cardCategories) as DeckArchive['library']['cardCategories'], profiles, groups } };
}

export function remapCategoryReferences(params: Record<string, unknown>, mapping: Map<string,string>): Record<string, unknown> {
  const out = structuredClone(params);
  const map = (id: string): string => {
    const target = mapping.get(id);
    if (!target) throw new ConfigurationError(`Catégorie référencée absente : ${id}`);
    return target;
  };
  if (typeof out.statsView === 'string' && !['starts','nonengine'].includes(out.statsView)) out.statsView = map(out.statsView);
  for (const q of (out.savedQueries ?? []) as Array<{ criteria: Array<{ subject: { kind: string; categoryId?: string; categoryIds?: string[] } }> }>) {
    for (const { subject: s } of q.criteria) {
      if (s.kind === 'category') s.categoryId = map(s.categoryId!);
      if (s.kind === 'group') s.categoryIds = s.categoryIds!.map(map);
    }
  }
  return out;
}
