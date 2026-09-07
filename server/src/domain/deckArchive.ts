import { cardIdValid, ConfigurationError, parseConfiguration, record, type Configuration } from './deckConfiguration.js';

export interface DeckArchive {
  format: 'ygo-proba-deck';
  version: 2;
  configuration: Configuration;
  library: {
    hoptCardIds: number[];
    categories: Array<{ id: string; name: string; relevance: 'first' | 'second' | 'both' }>;
    cardCategories: Array<{ card_id: number; category_id: string }>;
  };
}

export function parseArchive(value: unknown): DeckArchive {
  const fail = (message: string): never => { throw new ConfigurationError(message); };
  if (!record(value) || value.format !== 'ygo-proba-deck') fail('Format JSON de deck invalide.');
  const v = value as Record<string, unknown>;
  if (v.version !== 2) fail('Version JSON non prise en charge. Les exports version 1 doivent être convertis explicitement ; leurs paires globales ne sont pas réimportées.');
  const configuration = parseConfiguration(v.configuration);
  if (!record(v.library)) fail('Bibliothèque requise.');
  const lib = v.library as Record<string, unknown>;
  if (!Array.isArray(lib.hoptCardIds) || !lib.hoptCardIds.every(cardIdValid)) fail('HOPT invalides.');
  if (!Array.isArray(lib.categories) || !Array.isArray(lib.cardCategories)) fail('Catégories invalides.');
  const seenIds = new Set<string>(); const seenNames = new Set<string>();
  for (const c of lib.categories as unknown[]) {
    if (!record(c) || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim() || !['first','second','both'].includes(String(c.relevance))) fail('Catégorie invalide.');
    const cat = c as { id: string; name: string };
    if (seenIds.has(cat.id) || seenNames.has(cat.name)) fail('Catégorie dupliquée.');
    seenIds.add(cat.id); seenNames.add(cat.name);
  }
  for (const cc of lib.cardCategories as unknown[]) {
    if (!record(cc) || !cardIdValid(cc.card_id) || typeof cc.category_id !== 'string' || !seenIds.has(cc.category_id)) fail('Affectation de catégorie invalide.');
  }
  remapCategoryReferences(configuration.params, new Map([...seenIds].map((id) => [id,id])));
  return { format: 'ygo-proba-deck', version: 2, configuration, library: structuredClone(lib) as unknown as DeckArchive['library'] };
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
