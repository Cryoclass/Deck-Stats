import { describe, expect, it } from 'vitest';
import { searchForStudy, studyFromSearch } from './studyUrl.js';

// ─── Plans de side v2 (D1, Q11) : le contexte d'étude dans l'URL, et rien d'autre ───
const M = '00000000-0000-4000-8000-0000000000AA';

describe('studyFromSearch / searchForStudy', () => {
  it('aller-retour : adversaire et position ; le deck de base en premier n’a pas de requête', () => {
    expect(searchForStudy(null, 'first')).toBe('');
    expect(searchForStudy(null, 'second')).toBe('?position=second');
    expect(searchForStudy(M.toLowerCase(), 'first')).toBe(`?contre=${M.toLowerCase()}`);
    expect(studyFromSearch(searchForStudy(M.toLowerCase(), 'second'))).toEqual({ matchupId: M.toLowerCase(), position: 'second' });
    expect(studyFromSearch('')).toEqual({ matchupId: null, position: null });
  });

  it('une valeur inconnue est ignorée, jamais devinée ; l’identifiant est ramené en minuscules', () => {
    expect(studyFromSearch(`?contre=${M}&position=third`)).toEqual({ matchupId: M.toLowerCase(), position: null });
    expect(studyFromSearch('?contre=pas-un-uuid&position=second')).toEqual({ matchupId: null, position: 'second' });
    expect(studyFromSearch('contre=&position=first')).toEqual({ matchupId: null, position: 'first' });
  });
});
