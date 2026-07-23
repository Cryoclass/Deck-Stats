import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';

const CARD_COLS =
  'id, name, type, race, attribute, atk, def, level, description, image_url, image_url_small, image_url_cropped';

export async function cardsRoutes(app: FastifyInstance) {
  // Résolution par ids (import YDK → passcodes). GET /api/cards?ids=123,456
  app.get<{ Querystring: { ids?: string } }>('/', async (req, reply) => {
    const raw = req.query.ids;
    if (!raw) return reply.code(400).send({ error: 'paramètre `ids` requis' });
    const ids = raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) return [];
    const { rows } = await query(
      `select ${CARD_COLS} from cards where id = any($1::bigint[])`,
      [ids],
    );
    return rows;
  });

  // Recherche par nom. GET /api/cards/search?q=dragon&limit=30
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/search',
    async (req) => {
      const q = (req.query.q ?? '').trim();
      const limit = Math.min(Number(req.query.limit ?? 30) || 30, 100);
      if (q.length < 2) return [];
      const { rows } = await query(
        `select ${CARD_COLS} from cards
         where lower(name) like '%' || lower($1) || '%'
         order by (lower(name) = lower($1)) desc, length(name) asc, name asc
         limit $2`,
        [q, limit],
      );
      return rows;
    },
  );
}
