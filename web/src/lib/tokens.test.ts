import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEAT_GREEN, HEAT_RED, HEAT_INK_FROM, HEAT_MAX_ALPHA, heatCell, heatDelta } from './colors.js';

// ─── Refonte visuelle (audit 01, docs/refonte-visuelle.md) — contrat des tokens ───
// Les valeurs vivent dans `index.css` ; ce test les relit telles qu'elles sont servies et
// recalcule les contrastes WCAG 2.x. Il garde la RÈGLE (quel rôle sur quelle surface),
// pas une liste de couleurs : changer une valeur reste libre tant que la règle tient.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(SRC, 'index.css'), 'utf8');
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));

function token(name: string): string {
  const m = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`--${name} absent de :root`);
  return m[1];
}

function luminance(color: string): number {
  // `#000` et `#000000` : la forme courte est dépliée, sinon elle se lirait NaN et une
  // comparaison `NaN < pire` ne retiendrait jamais la case (défaut trouvé par mutation).
  const hex = /^#[0-9a-fA-F]{3}$/.test(color) ? '#' + [...color.slice(1)].map((c) => c + c).join('') : color;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`couleur illisible : ${color}`);
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const PAGE = 'ink-950';
const SURFACE = 'ink-900';
const SUNKEN = 'ink-850';

describe('rôles de texte — tous lisibles là où ils sont autorisés', () => {
  for (const fg of ['fg-1', 'fg-2', 'fg-3']) {
    for (const bg of [PAGE, SURFACE, SUNKEN]) {
      it(`${fg} sur ${bg} ≥ 4,5:1`, () => {
        expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  for (const bg of [PAGE, SURFACE]) {
    it(`fg-4 (méta) sur ${bg} ≥ 4,5:1`, () => {
      expect(ratio(token('fg-4'), token(bg))).toBeGreaterThanOrEqual(4.5);
    });
  }
  for (const accent of ['pos', 'warn', 'info', 'neg']) {
    it(`accent ${accent} sur la surface ≥ 4,5:1`, () => {
      expect(ratio(token(accent), token(SURFACE))).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('la hiérarchie est ordonnée : fg-1 > fg-2 > fg-3 > fg-4 sur la surface', () => {
    const r = ['fg-1', 'fg-2', 'fg-3', 'fg-4'].map((t) => ratio(token(t), token(SURFACE)));
    expect(r).toEqual([...r].sort((a, b) => b - a));
  });
});

describe('surfaces et bordures', () => {
  it('bordure de composant (ink-500) ≥ 3:1 sur la page et la surface (WCAG 1.4.11)', () => {
    expect(ratio(token('ink-500'), token(PAGE))).toBeGreaterThanOrEqual(3);
    expect(ratio(token('ink-500'), token(SURFACE))).toBeGreaterThanOrEqual(3);
  });
  it('l’escalier des surfaces s’éclaircit de la page vers l’état actif', () => {
    const steps = ['ink-950', 'ink-900', 'ink-850', 'ink-800', 'ink-700', 'ink-600', 'ink-500'].map((t) => luminance(token(t)));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });
});

// ─── Cartes de chaleur : le texte de chaque case reste lisible sur toute l'échelle ───
// Même composition que le navigateur : `color-mix(in srgb, teinte α, ink-900)` = superposition
// à l'opacité α dans l'espace sRGB encodé. oklch → sRGB par la matrice d'Ottosson.
function oklchToRgb(css: string): number[] {
  const m = css.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
  if (!m) throw new Error(`oklch illisible : ${css}`);
  const [L, C, H] = m.slice(1).map(Number);
  const hr = (H * Math.PI) / 180;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const mm = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  return linear.map((v) => {
    const c = Math.max(0, Math.min(1, v));
    return (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255;
  });
}
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function worstCell(hue: string, style: (alpha: number) => { color?: string }): { ratio: number; alpha: number } {
  const top = oklchToRgb(hue);
  const under = hexRgb(token(SURFACE));
  let worst = { ratio: Infinity, alpha: 0 };
  for (let k = 1; k <= 1000; k++) {
    const alpha = (k / 1000) * HEAT_MAX_ALPHA;
    const mixed = toHex(top.map((t, i) => t * alpha + under[i] * (1 - alpha)));
    const r = ratio(style(alpha).color ?? '#ffffff', mixed);
    if (r < worst.ratio) worst = { ratio: r, alpha };
  }
  return worst;
}

describe('cartes de chaleur — texte ≥ 4,5:1 dans chaque case', () => {
  it('séquentielle (vert) : blanc puis noir au-delà du seuil', () => {
    const w = worstCell(HEAT_GREEN, (alpha) => heatCell(alpha / HEAT_MAX_ALPHA, 1));
    expect(w.ratio, `pire case à α = ${w.alpha.toFixed(3)}`).toBeGreaterThanOrEqual(4.5);
  });
  it('divergente, vert : même règle', () => {
    const w = worstCell(HEAT_GREEN, (alpha) => heatDelta((alpha / HEAT_MAX_ALPHA) * 0.02));
    expect(w.ratio, `pire case à α = ${w.alpha.toFixed(3)}`).toBeGreaterThanOrEqual(4.5);
  });
  it('divergente, rouge : texte clair sur toute l’échelle', () => {
    const w = worstCell(HEAT_RED, (alpha) => heatDelta(-(alpha / HEAT_MAX_ALPHA) * 0.02));
    expect(w.ratio, `pire case à α = ${w.alpha.toFixed(3)}`).toBeGreaterThanOrEqual(4.5);
  });
  it('le seuil est bien la bascule : juste avant, le blanc gagne ; juste après, le noir', () => {
    const top = oklchToRgb(HEAT_GREEN);
    const under = hexRgb(token(SURFACE));
    const mix = (a: number) => toHex(top.map((t, i) => t * a + under[i] * (1 - a)));
    const before = mix(HEAT_INK_FROM - 0.01);
    const after = mix(HEAT_INK_FROM + 0.01);
    expect(ratio('#ffffff', before)).toBeGreaterThan(ratio('#000000', before));
    expect(ratio('#000000', after)).toBeGreaterThan(ratio('#ffffff', after));
  });
  it('une case à zéro garde le fond du panneau', () => {
    expect(heatCell(0, 1)).toEqual({});
    expect(heatDelta(0)).toEqual({});
  });
});

// ─── Classes proscrites dans les composants ───
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
const files = sources(SRC).map((p) => ({ rel: path.relative(SRC, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));

function offenders(pattern: RegExp, allowed: (rel: string) => boolean = () => false): string[] {
  return files.filter((f) => pattern.test(f.text) && !allowed(f.rel)).map((f) => f.rel);
}

describe('échelle et rôles — aucune valeur contournée', () => {
  it('aucune couleur de texte sur l’ancienne échelle ink (text-ink-*)', () => {
    expect(offenders(/\btext-ink-\d{3}\b/)).toEqual([]);
  });
  it('aucune taille de l’échelle Tailwind d’origine (text-xs, text-sm, text-base, text-lg…)', () => {
    expect(offenders(/\btext-(?:xs|sm|base|lg|xl|2xl)\b/)).toEqual([]);
  });
  it('aucune taille arbitraire en px sous le plancher (text-[9px], text-[10px], text-[11px]…)', () => {
    expect(offenders(/\btext-\[\d+px\]/)).toEqual([]);
  });
  it('text-cell (10 px) n’existe que dans le comparateur (dérogation D2)', () => {
    expect(offenders(/\btext-cell\b/, (rel) => rel === 'components/ComparePage.tsx')).toEqual([]);
  });
  it('aucun h-screen : h-[100dvh] (barre d’outils mobile dynamique, onglets du bas)', () => {
    expect(offenders(/\b(?:min-)?h-screen\b/)).toEqual([]);
  });
  it('formule de carte de chaleur écrite une seule fois (lib/colors.ts)', () => {
    expect(offenders(/oklch\(0\.7 0\.13 155/, (rel) => rel === 'lib/colors.ts')).toEqual([]);
  });
});
