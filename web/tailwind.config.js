/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Chrome neutre (§E) — les seuls accents chromatiques sont les couleurs de combo.
        ink: {
          950: '#0a0b0e',
          900: '#0f1116',
          850: '#151822',
          800: '#1b1f2a',
          700: '#252a37',
          600: '#333a4a',
          500: '#4a5265',
          400: '#6b7488',
          300: '#9aa2b5',
          200: '#c7ccd8',
          100: '#e8eaf0',
        },
      },
      fontFamily: {
        // Chiffres tabulaires pour les stats (§E : « les chiffres sont le produit »).
        num: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
