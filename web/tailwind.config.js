/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Échelle FERMÉE (audit 01 §0.2, direction A) : corps 13 px, plancher 11 px, aucun 9 px.
    // `text-xs` / `text-sm` / `text-[10px]` n'existent plus : une classe oubliée ne produit rien
    // et se voit immédiatement à l'écran comme au re-mesurage.
    fontSize: {
      cell: ['10px', '1.2'], // dérogation D2 : cellules des matrices A / B / Δ sous 640 px, nulle part ailleurs.
      meta: ['11px', '1.35'],
      body: ['13px', '1.45'],
      value: ['14px', '1.4'],
      head: ['16px', '1.35'],
      title: ['18px', '1.3'],
      hero: ['20px', '1.2'],
      glyph: ['24px', '1'],
    },
    extend: {
      colors: {
        // Surfaces et bordures — escalier de la charte §2.2, relevé de deux paliers (direction A).
        // Les valeurs vivent dans index.css : c'est ce qui rend un thème clair possible plus tard.
        ink: {
          950: 'var(--ink-950)',
          900: 'var(--ink-900)',
          850: 'var(--ink-850)',
          800: 'var(--ink-800)',
          700: 'var(--ink-700)',
          600: 'var(--ink-600)',
          500: 'var(--ink-500)',
        },
        // Rôles de texte — quatre, tous ≥ 4,5:1 sur les surfaces où ils sont autorisés.
        // `fg-4` est interdit sur ink-850 et plus clair (4,4:1).
        fg: {
          1: 'var(--fg-1)',
          2: 'var(--fg-2)',
          3: 'var(--fg-3)',
          4: 'var(--fg-4)',
        },
        // Accents EN TEXTE (charte §2.3, quatre significations). Les aplats et les contenants
        // d'état translucides restent la palette Tailwind (emerald/amber/sky/red).
        pos: 'var(--pos)',
        warn: 'var(--warn)',
        info: 'var(--info)',
        neg: 'var(--neg)',
      },
    },
  },
  plugins: [],
};
