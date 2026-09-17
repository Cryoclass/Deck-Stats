import { query } from '../db.js';

/**
 * Avis d'interface fermés par compte (table `user_notices`, migration 006, partie D, lot D1).
 * Liste FERMÉE, identique au CHECK de la table : une clé nouvelle s'ajoute ici ET dans 006.
 *
 * `annotation-defaults` — bandeau « Les annotations par défaut sont actives : vos chiffres ont pu
 * changer ; vos choix sont conservés » (docs/annotations-par-defaut.md, D9, §11 Q8). Dû à un compte
 * si et seulement si :
 *   • le compte a été créé AVANT l'application du marqueur « 006-annotation-defaults/c » (un compte
 *     créé après n'a jamais eu d'anciens chiffres) — marqueur absent = base antérieure = pas dû ;
 *   • et le compte ne l'a pas encore fermé (aucune ligne `user_notices`).
 * Relu à chaque appel, jamais mis en cache.
 */
export const NOTICES = ['annotation-defaults'] as const;
export type Notice = (typeof NOTICES)[number];

export const noticeValid = (value: unknown): value is Notice =>
  typeof value === 'string' && (NOTICES as readonly string[]).includes(value);

/** Clés des avis dus au compte, dans l'ordre de `NOTICES`. */
export async function noticesDue(userId: string): Promise<Notice[]> {
  const { rows } = await query<{ annotation_defaults: boolean }>(
    `select exists (
              select 1 from app_migrations m join users u on u.id = $1
               where m.id = '006-annotation-defaults/c' and u.created_at < m.applied_at)
            and not exists (
              select 1 from user_notices n where n.user_id = $1 and n.notice = 'annotation-defaults')
            as annotation_defaults`,
    [userId],
  );
  return rows[0]?.annotation_defaults ? ['annotation-defaults'] : [];
}

/** Ferme un avis pour ce compte ; idempotent (une seconde fermeture ne change rien). */
export async function dismissNotice(userId: string, notice: Notice): Promise<void> {
  await query(
    'insert into user_notices (user_id, notice) values ($1, $2) on conflict (user_id, notice) do nothing',
    [userId, notice],
  );
}
