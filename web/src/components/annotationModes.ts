/** Modes d'annotation (Lot B) — bascule la grille entière dans un mode répétitif. */
export type AnnotationMode = 'select' | 'combo' | 'hopt' | 'starter' | 'nonengine';

export const MODE_LABEL: Record<AnnotationMode, string> = {
  select: 'Sélection',
  combo: 'Lier combo',
  hopt: 'HOPT',
  starter: 'Starter',
  nonengine: 'Non-engine',
};

/** Raccourcis clavier (§ Lot B). `Échap` sort toujours. */
export const KEY_TO_MODE: Record<string, AnnotationMode> = {
  c: 'combo',
  h: 'hopt',
  s: 'starter',
  n: 'nonengine',
};

export const MODE_KEY: Partial<Record<AnnotationMode, string>> = {
  combo: 'C',
  hopt: 'H',
  starter: 'S',
  nonengine: 'N',
};
