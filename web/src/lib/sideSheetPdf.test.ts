import { describe, expect, it } from 'vitest';
import { blockHeight, cardsPerRow, FIRST_PAGE_TOP, paginate, PDF, pdfText } from './sideSheetPdf.js';
import type { SheetMatchup } from './sideSheet.js';

// ─── Étape 10D : mise en page du PDF de la fiche (pure ; jsPDF n'est chargé qu'au téléchargement) ───

const list = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ card_id: from + i, copies: 1 }));
const plan = (position: 'first' | 'second', out: number, inn: number, note: string | null) => ({
  matchupId: 'm', position, input: null, summary: null, applied: { status: 'ready' },
  plan: { position, note, outgoing: list(out, 1), incoming: list(inn, 100) },
});
const matchup = (out: number, inn: number, note: string | null = 'Une note d’une ligne') =>
  ({ id: 'm', name: 'Adversaire', plans: [plan('first', out, inn, note), plan('second', out, inn, note)] }) as unknown as SheetMatchup;
/** Adversaires tenant sur la PREMIÈRE page (la plus petite : elle porte l'en-tête). */
const onFirstPage = (m: SheetMatchup, showNames: boolean, lines = 1) =>
  paginate(Array(7).fill(blockHeight(m, showNames, () => lines)))[0].length;

describe('PDF de la fiche : 3 adversaires par page A4, 4 si les plans sont petits', () => {
  it('deux cartes par rangée dans chaque cadre SORT / ENTRE', () => {
    expect(cardsPerRow).toBe(2);
  });

  it('listes de 3 cartes et note d’une ligne : 3 adversaires sur la première page, noms affichés ou non', () => {
    expect(onFirstPage(matchup(3, 3), false)).toBeGreaterThanOrEqual(3);
    expect(onFirstPage(matchup(3, 3), true)).toBeGreaterThanOrEqual(3);
  });

  it('plans de 1 à 2 cartes par liste : 4 adversaires au moins', () => {
    expect(onFirstPage(matchup(2, 2), false)).toBeGreaterThanOrEqual(4);
    expect(onFirstPage(matchup(1, 2), true)).toBeGreaterThanOrEqual(4);
  });

  it('un bloc n’est jamais coupé : la pagination ne place que des blocs entiers', () => {
    const tall = PDF.pageH - FIRST_PAGE_TOP - PDF.margin - 10;
    expect(paginate([tall, 50, 50])).toEqual([[0], [1, 2]]);
    // Un bloc plus haut qu'une page reste seul sur la sienne, jamais perdu.
    expect(paginate([400, 20])).toEqual([[0], [1]]);
  });
});

describe('texte du PDF (polices standard, Latin-1)', () => {
  it('ramène la typographie courante à un équivalent lisible et remplace le reste', () => {
    expect(pdfText('≥ 1 départ – “Kewl” … œuvre ★ à l’écran')).toBe('>= 1 départ - "Kewl" ... oeuvre ? à l\'écran');
    expect(pdfText('Évolution · ×2')).toBe('Évolution · ×2');
  });
});
