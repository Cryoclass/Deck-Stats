import type { FastifyInstance } from 'fastify';
import { query, tx } from '../db.js';

interface DeckCardInput {
  card_id: number;
  zone: 'main' | 'extra' | 'side';
  copies: number;
}

export async function decksRoutes(app: FastifyInstance) {
  // Liste des decks (métadonnées seulement).
  app.get('/', async () => {
    const { rows } = await query(
      `select d.id, d.name, d.created_at, d.updated_at,
              coalesce(sum(dc.copies) filter (where dc.zone = 'main'), 0)::int as main_count
       from decks d left join deck_cards dc on dc.deck_id = d.id
       group by d.id order by d.updated_at desc`,
    );
    return rows;
  });

  // Deck complet : cartes + starters + exclusions de paires.
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { id } = req.params;
    const deck = await query('select * from decks where id = $1', [id]);
    if (deck.rowCount === 0) return reply.code(404).send({ error: 'deck introuvable' });
    const [cards, starters, exclusions] = await Promise.all([
      query('select card_id, zone, copies from deck_cards where deck_id = $1', [id]),
      query('select card_id from deck_starters where deck_id = $1', [id]),
      query('select pair_id from deck_pair_exclusions where deck_id = $1', [id]),
    ]);
    return {
      ...deck.rows[0],
      cards: cards.rows,
      starters: starters.rows.map((r) => r.card_id),
      pair_exclusions: exclusions.rows.map((r) => r.pair_id),
    };
  });

  // Création : nom + cartes (issu d'un import YDK typiquement).
  app.post<{ Body: { name: string; cards?: DeckCardInput[] } }>('/', async (req, reply) => {
    const { name, cards = [] } = req.body ?? {};
    if (!name?.trim()) return reply.code(400).send({ error: 'nom requis' });
    const deckId = await tx(async (c) => {
      const ins = await c.query<{ id: string }>(
        'insert into decks (name) values ($1) returning id',
        [name.trim()],
      );
      const id = ins.rows[0].id;
      await insertCards(c, id, cards);
      return id;
    });
    return reply.code(201).send({ id: deckId });
  });

  // Remplacement des cartes / renommage.
  app.put<{ Params: { id: string }; Body: { name?: string; cards?: DeckCardInput[] } }>(
    '/:id',
    async (req, reply) => {
      const { id } = req.params;
      const { name, cards } = req.body ?? {};
      await tx(async (c) => {
        if (name?.trim()) {
          await c.query('update decks set name = $1, updated_at = now() where id = $2', [
            name.trim(),
            id,
          ]);
        } else {
          await c.query('update decks set updated_at = now() where id = $1', [id]);
        }
        if (cards) {
          await c.query('delete from deck_cards where deck_id = $1', [id]);
          await insertCards(c, id, cards);
        }
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    await query('delete from decks where id = $1', [req.params.id]);
    return { ok: true };
  });

  // Starters 1-carte (locaux au deck, §5).
  app.put<{ Params: { id: string }; Body: { cardIds: number[] } }>(
    '/:id/starters',
    async (req) => {
      const { id } = req.params;
      const ids = req.body?.cardIds ?? [];
      await tx(async (c) => {
        await c.query('delete from deck_starters where deck_id = $1', [id]);
        for (const cardId of ids) {
          await c.query(
            'insert into deck_starters (deck_id, card_id) values ($1, $2) on conflict do nothing',
            [id, cardId],
          );
        }
        await c.query('update decks set updated_at = now() where id = $1', [id]);
      });
      return { ok: true };
    },
  );

  // Liste noire des paires globales désactivées pour ce deck (§5, §A).
  app.put<{ Params: { id: string }; Body: { pairIds: string[] } }>(
    '/:id/pair-exclusions',
    async (req) => {
      const { id } = req.params;
      const ids = req.body?.pairIds ?? [];
      await tx(async (c) => {
        await c.query('delete from deck_pair_exclusions where deck_id = $1', [id]);
        for (const pairId of ids) {
          await c.query(
            'insert into deck_pair_exclusions (deck_id, pair_id) values ($1, $2) on conflict do nothing',
            [id, pairId],
          );
        }
        await c.query('update decks set updated_at = now() where id = $1', [id]);
      });
      return { ok: true };
    },
  );
}

async function insertCards(
  c: import('pg').PoolClient,
  deckId: string,
  cards: DeckCardInput[],
): Promise<void> {
  for (const card of cards) {
    if (!['main', 'extra', 'side'].includes(card.zone)) continue;
    const copies = Math.max(1, Math.min(3, card.copies)); // §D: copies > 3 rejetées
    await c.query(
      `insert into deck_cards (deck_id, card_id, zone, copies) values ($1, $2, $3, $4)
       on conflict (deck_id, card_id, zone) do update set copies = excluded.copies`,
      [deckId, card.card_id, card.zone, copies],
    );
  }
}
