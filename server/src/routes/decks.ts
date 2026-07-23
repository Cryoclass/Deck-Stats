import type { FastifyInstance } from 'fastify';
import { query, tx } from '../db.js';

interface DeckCardInput {
  card_id: number;
  zone: 'main' | 'extra' | 'side';
  copies: number;
}

export async function decksRoutes(app: FastifyInstance) {
  // Liste des decks pour l'accueil (§4C) : métadonnées + aperçu mis en cache
  // (summary) + quelques vignettes. On ne recalcule jamais ici.
  app.get('/', async () => {
    const { rows } = await query(
      `select d.id, d.name, d.created_at, d.updated_at, d.summary,
              coalesce(sum(dc.copies) filter (where dc.zone = 'main'), 0)::int as main_count,
              coalesce(
                (select array_agg(card_id) from
                   (select card_id from deck_cards
                    where deck_id = d.id and zone = 'main'
                    order by card_id limit 8) t),
                '{}'
              ) as sample_cards
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
    const [cards, starters, exclusions, requirements] = await Promise.all([
      query('select card_id, zone, copies from deck_cards where deck_id = $1', [id]),
      query('select card_id from deck_starters where deck_id = $1', [id]),
      query('select pair_id from deck_pair_exclusions where deck_id = $1', [id]),
      query(
        `select id, source_card_id, source_pair_id, required_card_id, min_in_deck
         from deck_start_requirements where deck_id = $1`,
        [id],
      ),
    ]);
    return {
      ...deck.rows[0],
      cards: cards.rows,
      starters: starters.rows.map((r) => r.card_id),
      pair_exclusions: exclusions.rows.map((r) => r.pair_id),
      start_requirements: requirements.rows,
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

  // Enregistrement d'un deck : cartes + renommage + params + aperçu/notes (§4B).
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      cards?: DeckCardInput[];
      params?: unknown;
      summary?: unknown;
      notes?: string | null;
    };
  }>('/:id', async (req) => {
    const { id } = req.params;
    const { name, cards, params, summary, notes } = req.body ?? {};
    await tx(async (c) => {
      await c.query(
        `update decks set
           name    = coalesce($2, name),
           params  = coalesce($3::jsonb, params),
           summary = coalesce($4::jsonb, summary),
           notes   = coalesce($5, notes),
           updated_at = now()
         where id = $1`,
        [
          id,
          name?.trim() ? name.trim() : null,
          params !== undefined ? JSON.stringify(params) : null,
          summary !== undefined ? JSON.stringify(summary) : null,
          notes ?? null,
        ],
      );
      if (cards) {
        await c.query('delete from deck_cards where deck_id = $1', [id]);
        await insertCards(c, id, cards);
      }
    });
    return { ok: true };
  });

  // Duplication : composition + TOUTES les données locales (§4C, prépare la
  // comparaison de versions §4D). Ne touche jamais la bibliothèque globale.
  app.post<{ Params: { id: string } }>('/:id/duplicate', async (req, reply) => {
    const { id } = req.params;
    const newId = await tx(async (c) => {
      const ins = await c.query<{ id: string }>(
        `insert into decks (name, summary, notes, params)
         select name || ' (copie)', summary, notes, params from decks where id = $1
         returning id`,
        [id],
      );
      if (ins.rowCount === 0) throw new Error('deck introuvable');
      const nid = ins.rows[0].id;
      await c.query(
        `insert into deck_cards (deck_id, card_id, zone, copies)
         select $1, card_id, zone, copies from deck_cards where deck_id = $2`,
        [nid, id],
      );
      await c.query(
        `insert into deck_starters (deck_id, card_id)
         select $1, card_id from deck_starters where deck_id = $2`,
        [nid, id],
      );
      await c.query(
        `insert into deck_pair_exclusions (deck_id, pair_id)
         select $1, pair_id from deck_pair_exclusions where deck_id = $2`,
        [nid, id],
      );
      await c.query(
        `insert into deck_start_requirements
           (deck_id, source_card_id, source_pair_id, required_card_id, min_in_deck)
         select $1, source_card_id, source_pair_id, required_card_id, min_in_deck
         from deck_start_requirements where deck_id = $2`,
        [nid, id],
      );
      return nid;
    });
    return reply.code(201).send({ id: newId });
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    // Ne supprime que le deck (cascade sur ses tables locales). La bibliothèque
    // globale (combo_pairs, card_flags, catégories) reste intacte (§4C).
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

  // Prérequis en deck (itération 5) — locaux au deck, remplacés en bloc à l'enregistrement.
  app.put<{
    Params: { id: string };
    Body: {
      requirements: Array<{
        source_card_id?: number | null;
        source_pair_id?: string | null;
        required_card_id: number;
        min_in_deck?: number;
      }>;
    };
  }>('/:id/start-requirements', async (req) => {
    const { id } = req.params;
    const reqs = req.body?.requirements ?? [];
    await tx(async (c) => {
      await c.query('delete from deck_start_requirements where deck_id = $1', [id]);
      for (const r of reqs) {
        const hasCard = r.source_card_id != null;
        const hasPair = r.source_pair_id != null;
        if (hasCard === hasPair) continue; // exactement une source (contrainte XOR)
        if (r.required_card_id == null) continue;
        await c.query(
          `insert into deck_start_requirements
             (deck_id, source_card_id, source_pair_id, required_card_id, min_in_deck)
           values ($1, $2, $3, $4, $5)`,
          [
            id,
            hasCard ? r.source_card_id : null,
            hasPair ? r.source_pair_id : null,
            r.required_card_id,
            Math.max(1, r.min_in_deck ?? 1),
          ],
        );
      }
      await c.query('update decks set updated_at = now() where id = $1', [id]);
    });
    return { ok: true };
  });
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
