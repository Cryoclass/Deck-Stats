import type { jsPDF as JsPdf } from 'jspdf';
import type { SheetMatchup, SheetPlan } from './sideSheet.js';
import type { SidePlanCard } from '../types.js';

// ─── PDF de la fiche des plans de side (étape 10D, 11 septembre 2026) ───
// Construit dans le navigateur par jsPDF (chargé à la demande, comme ExcelJS), puis TÉLÉCHARGÉ :
// l'utilisateur imprime ce fichier. Même contenu que la fiche à l'écran : un bloc par adversaire,
// volets premier / second, cadres SORT (pointillé, rouge) et ENTRE (plein, vert), grandes
// illustrations, gros badge « ×n » sur les cartes en plusieurs copies, noms selon la case, trois
// chiffres, note. Cible : 3 adversaires par page A4 avec des listes de 3 cartes, 4 si les plans sont
// petits ; un bloc n'est jamais coupé entre deux pages. Le sens ne repose jamais sur la couleur
// seule (libellé + style de bordure). Images : lues par la page (canvas → JPEG), donc de MÊME
// ORIGINE — relais /api/cards/:id/image, le CDN n'envoyant pas d'en-tête CORS — ou `data:` ; une
// image illisible devient un cadre portant le nom de la carte.

export interface SheetPdfInput {
  deckName: string;
  date: string;
  sheet: SheetMatchup[];
  showNames: boolean;
  name: (cardId: number) => string;
  /** Adresse LISIBLE par la page : même origine ou `data:` — jamais le CDN directement. */
  imageUrl: (cardId: number) => string;
}

// ─── Géométrie (millimètres) ───
export const PDF = { pageW: 210, pageH: 297, margin: 8, headerH: 13, blockGap: 2, blockPad: 2.5, nameH: 6.5, colGap: 6, boxGap: 3, labelH: 4.5, boxHead: 6.5, artW: 14, cardGap: 3, cardNameH: 4, figuresH: 4.5, noteLine: 3.6 } as const;
const ART_H = (PDF.artW * 86) / 59;
const CONTENT_W = PDF.pageW - 2 * PDF.margin;
const COL_W = (CONTENT_W - 2 * PDF.blockPad - PDF.colGap) / 2;
const BOX_W = (COL_W - PDF.boxGap) / 2;
/** Première ligne utile de la première page (sous l'en-tête) ; les suivantes commencent à la marge. */
export const FIRST_PAGE_TOP = PDF.margin + PDF.headerH;
export const cardsPerRow = Math.max(1, Math.floor((BOX_W - 4 + PDF.cardGap) / (PDF.artW + PDF.cardGap)));
const rowH = (showNames: boolean) => ART_H + (showNames ? PDF.cardNameH : 0) + PDF.cardGap;

/** Texte sûr pour les polices standard du PDF (Latin-1) : la typographie courante est ramenée à
 *  un équivalent lisible, tout autre caractère devient « ? » plutôt qu'un glyphe illisible. */
export function pdfText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[−–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/€/g, 'EUR')
    .replace(/[^ -~ -ÿ]/g, '?');
}

function boxHeight(n: number, showNames: boolean): number {
  if (n === 0) return PDF.boxHead + 5;
  return PDF.boxHead + Math.ceil(n / cardsPerRow) * rowH(showNames);
}

function planHeight(p: SheetPlan, showNames: boolean, noteLines: (note: string) => number): number {
  const empty = p.plan.outgoing.length === 0 && p.plan.incoming.length === 0;
  const boxes = empty ? 6 : Math.max(boxHeight(p.plan.outgoing.length, showNames), boxHeight(p.plan.incoming.length, showNames));
  const figures = p.applied.status === 'ready' ? PDF.figuresH : 0;
  const note = p.plan.note ? noteLines(p.plan.note) * PDF.noteLine + 1 : 0;
  return PDF.labelH + boxes + figures + note;
}

/** Hauteur d'un bloc d'adversaire (mm) ; `noteLines` compte les lignes d'une note à la largeur
 *  d'une colonne (jsPDF en vrai, une estimation en test). */
export function blockHeight(m: SheetMatchup, showNames: boolean, noteLines: (note: string) => number): number {
  return PDF.nameH + Math.max(...m.plans.map((p) => planHeight(p, showNames, noteLines))) + 2 * PDF.blockPad;
}

/** Répartit des blocs entiers sur des pages : un bloc qui ne tient plus passe à la page suivante
 *  (un bloc plus haut qu'une page reste seul sur la sienne). Rend les indices par page. */
export function paginate(heights: readonly number[], firstTop = FIRST_PAGE_TOP): number[][] {
  const bottom = PDF.pageH - PDF.margin;
  const pages: number[][] = [[]];
  let y = firstTop;
  heights.forEach((h, i) => {
    if (y + h > bottom && pages[pages.length - 1].length > 0) {
      pages.push([]);
      y = PDF.margin;
    }
    pages[pages.length - 1].push(i);
    y += h + PDF.blockGap;
  });
  return pages;
}

type Rgb = [number, number, number];
const INK: Rgb = [20, 20, 20];
const GREY: Rgb = [95, 95, 95];
const FRAME: Rgb = [200, 200, 200];
const AMBER: Rgb = [146, 64, 14];
const OUT = { border: [185, 28, 28] as Rgb, fill: [254, 242, 242] as Rgb, text: [153, 27, 27] as Rgb };
const IN = { border: [4, 120, 87] as Rgb, fill: [236, 253, 245] as Rgb, text: [6, 95, 70] as Rgb };

function fit(doc: JsPdf, text: string, width: number): string {
  const s = pdfText(text);
  if (doc.getTextWidth(s) <= width) return s;
  let t = s;
  while (t.length > 1 && doc.getTextWidth(`${t}.`) > width) t = t.slice(0, -1);
  return `${t}.`;
}

function drawCard(doc: JsPdf, input: SheetPdfInput, images: Map<number, string>, c: SidePlanCard, x: number, y: number): void {
  const data = images.get(c.card_id);
  if (data) doc.addImage(data, 'JPEG', x, y, PDF.artW, ART_H);
  else {
    doc.setDrawColor(...GREY);
    doc.setFillColor(240, 240, 240);
    doc.setLineWidth(0.2);
    doc.rect(x, y, PDF.artW, ART_H, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(pdfText(input.name(c.card_id)), PDF.artW - 1).slice(0, 5), x + 0.5, y + 2.5);
  }
  if (c.copies > 1) {
    // Gros badge, qu'on ne le rate pas : disque noir cerclé de blanc, chiffre blanc en gras.
    const r = 3.6;
    const cx = x + PDF.artW - 1.8;
    const cy = y + ART_H - 1.8;
    doc.setFillColor(0, 0, 0);
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.6);
    doc.circle(cx, cy, r, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(`×${c.copies}`, cx, cy + 1.35, { align: 'center' });
  }
  if (input.showNames) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...INK);
    doc.text(fit(doc, input.name(c.card_id), PDF.artW + PDF.cardGap - 0.5), x, y + ART_H + 3.2);
  }
}

function drawBox(doc: JsPdf, input: SheetPdfInput, images: Map<number, string>, kind: 'out' | 'in', list: SidePlanCard[], x: number, y: number, h: number): void {
  const style = kind === 'out' ? OUT : IN;
  doc.setLineWidth(0.5);
  doc.setDrawColor(...style.border);
  doc.setFillColor(...style.fill);
  doc.setLineDashPattern(kind === 'out' ? [1.4, 0.9] : [], 0);
  doc.roundedRect(x, y, BOX_W, h - 0.5, 1.2, 1.2, 'FD');
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...style.text);
  doc.text(kind === 'out' ? '- SORT' : '+ ENTRE', x + 2, y + 4.3);
  if (list.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GREY);
    doc.text('-', x + 2, y + PDF.boxHead + 3);
    return;
  }
  list.forEach((c, i) => {
    const col = i % cardsPerRow;
    const row = Math.floor(i / cardsPerRow);
    drawCard(doc, input, images, c, x + 2 + col * (PDF.artW + PDF.cardGap), y + PDF.boxHead + row * rowH(input.showNames));
  });
}

function drawPlan(doc: JsPdf, input: SheetPdfInput, images: Map<number, string>, p: SheetPlan, x: number, y: number): void {
  const title = p.position === 'first' ? 'PREMIER' : 'SECOND';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text(title, x, y + 3.2);
  if (p.applied.status !== 'ready') {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...AMBER);
    doc.text(pdfText(p.applied.status === 'incomplete' ? 'plan incomplet — à terminer' : 'plan à revoir'), x + doc.getTextWidth(title) + 3, y + 3.2);
  }
  let cy = y + PDF.labelH;
  const empty = p.plan.outgoing.length === 0 && p.plan.incoming.length === 0;
  if (empty) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(pdfText('Aucun échange (deck de base)'), x, cy + 4);
    cy += 6;
  } else {
    const h = Math.max(boxHeight(p.plan.outgoing.length, input.showNames), boxHeight(p.plan.incoming.length, input.showNames));
    drawBox(doc, input, images, 'out', p.plan.outgoing, x, cy, h);
    drawBox(doc, input, images, 'in', p.plan.incoming, x + BOX_W + PDF.boxGap, cy, h);
    cy += h;
  }
  if (p.applied.status === 'ready') {
    const s = p.summary;
    const v = (x: number | undefined) => (x === undefined ? '—' : `${(100 * x).toFixed(1)}%`);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(pdfText(`≥ 1 départ ${v(s?.startOne)} · ≥ 2 non-engine ${v(s?.nonEngineTwo)} · main forte ${v(s?.strongHand)}`), x, cy + 3.3);
    cy += PDF.figuresH;
  }
  if (p.plan.note) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(pdfText(p.plan.note), COL_W), x, cy + 3);
  }
}

/** Lit une image par la page et la rend en JPEG (fond blanc, recadrée comme `object-cover`) ;
 *  `null` si elle est illisible (erreur, délai, canvas bloqué par l'origine). */
function rasterize(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 10000);
    const done = (value: string | null) => {
      clearTimeout(timer);
      resolve(value);
    };
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = 236;
        const h = Math.round((w * 86) / 59);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return done(null);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        const iw = img.naturalWidth || w;
        const ih = img.naturalHeight || h;
        const scale = Math.max(w / iw, h / ih);
        ctx.drawImage(img, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
        done(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        done(null);
      }
    };
    img.onerror = () => done(null);
    img.src = src;
  });
}

/** Construit le PDF de la fiche et le télécharge sous `filename`. */
export async function downloadSideSheetPdf(input: SheetPdfInput, filename: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const ids = [...new Set(input.sheet.flatMap((m) => m.plans.flatMap((p) => [...p.plan.outgoing, ...p.plan.incoming].map((c) => c.card_id))))];
  const images = new Map<number, string>();
  await Promise.all(
    ids.map(async (id) => {
      const data = await rasterize(input.imageUrl(id));
      if (data) images.set(id, data);
    }),
  );

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const M = PDF.margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text(pdfText(`${input.deckName} — plans de side`), M, M + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...GREY);
  doc.text(
    pdfText(`${input.date} · ≥ 1 départ = P(S ≥ 1) · ≥ 2 non-engine = P(U ≥ 2) · main forte = S ≥ 2 et U ≥ 1 en premier, U ≥ 2 en second`),
    M,
    M + 10,
    { maxWidth: CONTENT_W },
  );

  const noteLines = (note: string) => {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    return doc.splitTextToSize(pdfText(note), COL_W).length;
  };
  const heights = input.sheet.map((m) => blockHeight(m, input.showNames, noteLines));
  paginate(heights).forEach((indices, page) => {
    if (page > 0) doc.addPage();
    let y = page === 0 ? FIRST_PAGE_TOP : M;
    for (const i of indices) {
      const m = input.sheet[i];
      doc.setDrawColor(...FRAME);
      doc.setLineWidth(0.3);
      doc.setLineDashPattern([], 0);
      doc.rect(M, y, CONTENT_W, heights[i]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...INK);
      doc.text(pdfText(m.name), M + PDF.blockPad, y + PDF.blockPad + 4.3);
      const top = y + PDF.blockPad + PDF.nameH;
      m.plans.forEach((p, k) => drawPlan(doc, input, images, p, M + PDF.blockPad + k * (COL_W + PDF.colGap), top));
      y += heights[i] + PDF.blockGap;
    }
  });
  doc.save(filename);
}
