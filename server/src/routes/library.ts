import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';

export async function libraryRoutes(app: FastifyInstance) {
  // Snapshot complet de la bibliothèque globale (§5) — chargé au démarrage du front.
  app.get('/', async () => {
    const [flags, pairs, categories, cardCategories] = await Promise.all([
      query(
        `select card_id, is_hopt, dead_first, dead_second from card_flags
         where is_hopt or dead_first or dead_second`,
      ),
      query('select id, card_a_id, card_b_id, note from combo_pairs'),
      query('select id, name, relevance, is_builtin from nonengine_categories order by is_builtin desc, name'),
      query('select card_id, category_id from card_categories'),
    ]);
    return {
      hoptCardIds: flags.rows.filter((r) => r.is_hopt).map((r) => r.card_id),
      deadFirstCardIds: flags.rows.filter((r) => r.dead_first).map((r) => r.card_id),
      deadSecondCardIds: flags.rows.filter((r) => r.dead_second).map((r) => r.card_id),
      pairs: pairs.rows,
      categories: categories.rows,
      cardCategories: cardCategories.rows,
    };
  });

  // ─── Flags de carte (HOPT + mortes selon la position, Lot C) ───
  // Upsert partiel : seuls les champs fournis sont modifiés (coalesce).
  app.put<{
    Params: { cardId: string };
    Body: { is_hopt?: boolean; dead_first?: boolean; dead_second?: boolean };
  }>('/flags/:cardId', async (req) => {
    const cardId = Number(req.params.cardId);
    const { is_hopt, dead_first, dead_second } = req.body ?? {};
    await query(
      `insert into card_flags (card_id, is_hopt, dead_first, dead_second)
       values ($1, coalesce($2, false), coalesce($3, false), coalesce($4, false))
       on conflict (card_id) do update set
         is_hopt     = coalesce($2, card_flags.is_hopt),
         dead_first  = coalesce($3, card_flags.dead_first),
         dead_second = coalesce($4, card_flags.dead_second)`,
      [cardId, is_hopt ?? null, dead_first ?? null, dead_second ?? null],
    );
    return { ok: true };
  });

  // ─── Paires de combo (graphe global, canonicalisées a<=b) ───
  app.post<{ Body: { card_a_id: number; card_b_id: number; note?: string } }>(
    '/pairs',
    async (req, reply) => {
      let { card_a_id, card_b_id } = req.body ?? ({} as never);
      const note = req.body?.note ?? null;
      if (!Number.isFinite(card_a_id) || !Number.isFinite(card_b_id)) {
        return reply.code(400).send({ error: 'card_a_id et card_b_id requis' });
      }
      // Normalisation de l'ordre AVANT écriture (§A points d'attention) : garantit
      // qu'on ne peut pas saisir A→B et B→A comme deux arêtes distinctes.
      if (card_a_id > card_b_id) [card_a_id, card_b_id] = [card_b_id, card_a_id];
      if (card_a_id === card_b_id) {
        // Auto-combo : hors périmètre pour l'instant (§D, point ouvert 1).
        return reply.code(400).send({ error: 'auto-combo non géré' });
      }
      const { rows } = await query(
        `insert into combo_pairs (card_a_id, card_b_id, note) values ($1, $2, $3)
         on conflict (card_a_id, card_b_id) do update set note = excluded.note
         returning id, card_a_id, card_b_id, note`,
        [card_a_id, card_b_id, note],
      );
      return reply.code(201).send(rows[0]);
    },
  );

  // Suppression DÉFINITIVE d'une paire de la bibliothèque (§5 : geste explicite,
  // distinct de la simple exclusion par deck).
  app.delete<{ Params: { id: string } }>('/pairs/:id', async (req) => {
    await query('delete from combo_pairs where id = $1', [req.params.id]);
    return { ok: true };
  });

  // ─── Catégories de non-engine ───
  app.post<{ Body: { name: string; relevance: 'first' | 'second' | 'both' } }>(
    '/categories',
    async (req, reply) => {
      const name = req.body?.name?.trim();
      const relevance = req.body?.relevance ?? 'both';
      if (!name) return reply.code(400).send({ error: 'nom requis' });
      if (!['first', 'second', 'both'].includes(relevance)) {
        return reply.code(400).send({ error: 'relevance invalide' });
      }
      const { rows } = await query(
        `insert into nonengine_categories (name, relevance, is_builtin) values ($1, $2, false)
         on conflict (name) do update set relevance = excluded.relevance
         returning id, name, relevance, is_builtin`,
        [name, relevance],
      );
      return reply.code(201).send(rows[0]);
    },
  );

  app.delete<{ Params: { id: string } }>('/categories/:id', async (req, reply) => {
    const cat = await query('select is_builtin from nonengine_categories where id = $1', [
      req.params.id,
    ]);
    if (cat.rows[0]?.is_builtin) {
      return reply.code(400).send({ error: 'catégorie fournie de base, non supprimable' });
    }
    await query('delete from nonengine_categories where id = $1', [req.params.id]);
    return { ok: true };
  });

  // ─── Appartenance carte ↔ catégorie ───
  app.post<{ Body: { card_id: number; category_id: string } }>(
    '/card-categories',
    async (req, reply) => {
      const { card_id, category_id } = req.body ?? ({} as never);
      if (!Number.isFinite(card_id) || !category_id) {
        return reply.code(400).send({ error: 'card_id et category_id requis' });
      }
      await query(
        `insert into card_categories (card_id, category_id) values ($1, $2)
         on conflict do nothing`,
        [card_id, category_id],
      );
      return reply.code(201).send({ ok: true });
    },
  );

  app.delete<{ Params: { cardId: string; categoryId: string } }>(
    '/card-categories/:cardId/:categoryId',
    async (req) => {
      await query('delete from card_categories where card_id = $1 and category_id = $2', [
        Number(req.params.cardId),
        req.params.categoryId,
      ]);
      return { ok: true };
    },
  );
}
