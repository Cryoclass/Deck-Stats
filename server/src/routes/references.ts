import type { FastifyInstance } from 'fastify';
import { query, tx } from '../db.js';
import { requireUser } from '../auth/session.js';
import { requireReferent, roleOf } from '../auth/role.js';
import { cardIdValid, ConfigurationError, isReferentRole, parseReference, type CardReference } from '../domain/deckConfiguration.js';

/**
 * Références communes (docs/annotations-par-defaut.md, D4′, R6) : lues par tout compte
 * connecté, écrites par un référent seulement (404 sinon, Q7). Chaque écriture est journalisée
 * dans `card_reference_log` (ajout seul, déclencheur) et met à NULL l'aperçu de TOUS les decks
 * qui contiennent la carte, tous comptes confondus (D8) : le client recalcule à l'accueil.
 * Les résumés de plans se périment seuls (empreinte de l'entrée complète du moteur).
 */
const COLS = 'card_id, is_hopt, nonengine_set, availability, group_name, note, updated_by, updated_at';

type Queryable = { query: typeof query };

/** Liste complète et sa version. La version = dernière ligne du journal (ajout seul, donc monotone) :
 *  elle change aussi au RETRAIT d'une référence, ce que le plus grand `updated_at` ne ferait pas. */
export async function listReferences(c: Queryable = { query }): Promise<{ references: CardReference[]; referencesVersion: string }> {
  const { rows } = await c.query<CardReference>(`select ${COLS} from card_references order by card_id`);
  const { rows: [last] } = await c.query<{ id: string }>('select coalesce(max(id), 0)::text as id from card_reference_log');
  return {
    references: rows.map((r) => ({ card_id: r.card_id, is_hopt: r.is_hopt, nonengine_set: r.nonengine_set, availability: r.availability, group_name: r.group_name, note: r.note })),
    referencesVersion: last.id,
  };
}

export async function referencesRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const user = requireUser(req);
    const referent = isReferentRole(await roleOf(user.id));
    return tx(async (c) => {
      await c.query('set transaction isolation level repeatable read');
      const list = await listReferences(c);
      const log = await c.query<{ before: Record<string, unknown> | null; after: Record<string, unknown> | null; actor: string | null }>(
        'select id, card_id, action, before, after, actor, at from card_reference_log order by id desc limit 50');
      // Qui a écrit (identifiants de comptes) n'est montré qu'aux référents ; les autres comptes lisent le contenu.
      const hide = (row: Record<string, unknown> | null) => (row ? { ...row, updated_by: null } : null);
      return { ...list, log: referent ? log.rows : log.rows.map((r) => ({ ...r, actor: null, before: hide(r.before), after: hide(r.after) })) };
    });
  });

  app.put<{ Params: { cardId: string }; Body: unknown }>('/:cardId', async (req) => {
    const referent = await requireReferent(req);
    const cardId = Number(req.params.cardId);
    const reference = parseReference(cardId, req.body ?? {});
    return tx(async (c) => {
      const { rows: [before] } = await c.query(`select ${COLS} from card_references where card_id = $1 for update`, [cardId]);
      const { rows: [after] } = await c.query(
        `insert into card_references (card_id, is_hopt, nonengine_set, availability, group_name, note, updated_by, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (card_id) do update set is_hopt = excluded.is_hopt, nonengine_set = excluded.nonengine_set,
           availability = excluded.availability, group_name = excluded.group_name, note = excluded.note,
           updated_by = excluded.updated_by, updated_at = now()
         returning ${COLS}`,
        [cardId, reference.is_hopt, reference.nonengine_set, reference.availability, reference.group_name, reference.note, referent.id]);
      await c.query('insert into card_reference_log (card_id, action, before, after, actor) values ($1, $2, $3, $4, $5)', [cardId, 'set', before ? JSON.stringify(before) : null, JSON.stringify(after), referent.id]);
      const invalidated = await invalidateAllSummaries(c, cardId);
      return { ok: true, reference: after, invalidated_decks: invalidated };
    });
  });

  app.delete<{ Params: { cardId: string } }>('/:cardId', async (req, reply) => {
    const referent = await requireReferent(req);
    const cardId = Number(req.params.cardId);
    if (!cardIdValid(cardId)) throw new ConfigurationError('Carte invalide.');
    return tx(async (c) => {
      const { rows: [before] } = await c.query(`delete from card_references where card_id = $1 returning ${COLS}`, [cardId]);
      if (!before) return reply.code(404).send({ error: 'Aucune référence pour cette carte.' });
      await c.query('insert into card_reference_log (card_id, action, before, after, actor) values ($1, $2, $3, null, $4)', [cardId, 'clear', JSON.stringify(before), referent.id]);
      const invalidated = await invalidateAllSummaries(c, cardId);
      return { ok: true, invalidated_decks: invalidated };
    });
  });
}

/** Tous les decks de tous les comptes qui contiennent la carte perdent leur aperçu (D8). */
async function invalidateAllSummaries(c: { query: (text: string, params: unknown[]) => Promise<{ rowCount: number | null }> }, cardId: number): Promise<number> {
  const r = await c.query('update decks set summary = null where summary is not null and id in (select deck_id from deck_cards where card_id = $1)', [cardId]);
  return r.rowCount ?? 0;
}
