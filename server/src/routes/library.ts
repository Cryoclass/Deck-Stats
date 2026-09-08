import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { query, tx } from '../db.js';
import { requireUser } from '../auth/session.js';
import { availabilityValid, cardIdValid, ConfigurationError, uuidPattern } from '../domain/deckConfiguration.js';

/**
 * Toute modification globale (HOPT, profil, plafond, catégorie, affectation) invalide
 * les statistiques dérivées des decks concernés du compte : `decks.summary` est un
 * cache, jamais une source de vérité (contrat §1 et §6). Avec une carte, seuls les
 * decks qui la contiennent sont touchés ; sans carte (catégorie, plafond), tous les
 * decks du compte. `updated_at` reste celui de la dernière édition du deck.
 */
export async function invalidateOwnerSummaries(c: PoolClient, uid: string, cardId?: number): Promise<number> {
  const result = cardId === undefined
    ? await c.query('update decks set summary=null where owner_id=$1 and summary is not null', [uid])
    : await c.query('update decks set summary=null where owner_id=$1 and summary is not null and id in (select deck_id from deck_cards where card_id=$2)', [uid,cardId]);
  return result.rowCount ?? 0;
}

async function libraryWrite<T>(uid: string, fn: (c: PoolClient) => Promise<T>, cardId?: number): Promise<T> {
  return tx(async (c) => {
    // Imports and interactive writes serialize on the same account row.
    await c.query('select id from users where id=$1 for update', [uid]);
    const out = await fn(c);
    await invalidateOwnerSummaries(c,uid,cardId);
    return out;
  });
}

const CHECK_VIOLATION = '23514';

export async function libraryRoutes(app: FastifyInstance) {
  app.get('/', async (req) => tx(async (c) => {
    await c.query('set transaction isolation level repeatable read');
    const uid = requireUser(req).id;
    const flags = await c.query('select card_id,is_hopt,availability,group_id from card_flags where owner_id=$1 and (is_hopt or availability is not null)', [uid]);
    const categories = await c.query('select id,name,is_builtin from nonengine_categories where owner_id=$1 order by is_builtin desc,name', [uid]);
    const memberships = await c.query('select cc.card_id,cc.category_id from card_categories cc join nonengine_categories c on c.id=cc.category_id where c.owner_id=$1', [uid]);
    const groups = await c.query('select id,name,cap_per_turn from nonengine_groups where owner_id=$1 order by name', [uid]);
    return {
      hoptCardIds: flags.rows.filter((r) => r.is_hopt).map((r) => r.card_id),
      categories: categories.rows,
      cardCategories: memberships.rows,
      profiles: flags.rows.filter((r) => r.availability !== null).map((r) => ({ card_id: r.card_id,availability: r.availability,group_id: r.group_id })),
      groups: groups.rows,
    };
  }));

  // Drapeaux d'une carte pour ce compte : HOPT, profil de disponibilité, plafond partagé.
  app.put<{ Params: { cardId: string }; Body: { is_hopt?: boolean; availability?: string | null; group_id?: string | null } }>('/flags/:cardId', async (req) => {
    const id = Number(req.params.cardId);
    const body = req.body ?? {};
    const keys = Object.keys(body);
    if (!cardIdValid(id) || keys.length === 0 || keys.some((k) => !['is_hopt','availability','group_id'].includes(k))) throw new ConfigurationError('Annotation de carte invalide.');
    if (body.is_hopt !== undefined && typeof body.is_hopt !== 'boolean') throw new ConfigurationError('Annotation HOPT invalide.');
    if (body.availability !== undefined && body.availability !== null && !availabilityValid(body.availability)) throw new ConfigurationError('Profil de disponibilité inconnu.');
    if (body.group_id !== undefined && body.group_id !== null && !uuidPattern.test(body.group_id)) throw new ConfigurationError('Plafond partagé invalide.');
    const uid = requireUser(req).id;
    return libraryWrite(uid, async (c) => {
      if (body.group_id) {
        const owned = await c.query('select id from nonengine_groups where id=$1 and owner_id=$2', [body.group_id,uid]);
        if (!owned.rowCount) throw Object.assign(new Error('Plafond partagé introuvable.'), { statusCode: 404 });
        // Q2 : le plafond exige un profil — celui envoyé, sinon celui déjà enregistré. La
        // contrainte SQL seule ne suffit pas : PostgreSQL évalue le CHECK sur la ligne
        // proposée à l'insertion AVANT de détecter le conflit, donc « group_id » seul sur
        // une carte déjà profilée échouait à tort (constaté à l'écran, étape 6B).
        const profile = body.availability !== undefined
          ? body.availability
          : (await c.query<{ availability: string | null }>('select availability from card_flags where owner_id=$1 and card_id=$2', [uid,id])).rows[0]?.availability ?? null;
        if (!profile) throw new ConfigurationError('Un plafond partagé exige un profil de disponibilité sur la carte.');
      }
      if (body.availability) {
        // Q1 : un profil décrit quand une contribution est disponible, l'étiquette ce qui
        // est compté ; sans catégorie non-engine, un profil ne mesure rien.
        const labelled = await c.query('select 1 from card_categories cc join nonengine_categories n on n.id=cc.category_id where n.owner_id=$1 and cc.card_id=$2 limit 1', [uid,id]);
        if (!labelled.rowCount) throw new ConfigurationError('Choisir d’abord une catégorie non-engine pour cette carte avant son profil.');
      }
      try {
        const { rows: [row] } = await c.query(
          `insert into card_flags (owner_id,card_id,is_hopt,availability,group_id)
           values ($1,$2,coalesce($3,false),$4,case when $4::text is null then null else $5::uuid end)
           on conflict (owner_id,card_id) do update set
             is_hopt=coalesce($3,card_flags.is_hopt),
             availability=case when $6 then $4 else card_flags.availability end,
             group_id=case when $7 then $5 when $6 and $4 is null then null else card_flags.group_id end
           returning is_hopt,availability,group_id`,
          [uid,id,body.is_hopt ?? null,body.availability ?? null,body.group_id ?? null,body.availability !== undefined,body.group_id !== undefined]);
        return { ok: true, card_id: id, is_hopt: row.is_hopt, availability: row.availability, group_id: row.group_id };
      } catch (e) {
        // Q2 : un plafond partagé exige un profil (contrainte SQL, relayée en clair).
        if ((e as { code?: string }).code === CHECK_VIOLATION) throw new ConfigurationError('Un plafond partagé exige un profil de disponibilité sur la carte.');
        throw e;
      }
    }, id);
  });

  // Stale clients cannot resurrect or purge legacy global combos.
  for (const method of ['POST','DELETE'] as const) app.route({ method, url: method === 'POST' ? '/pairs' : '/pairs/:id', handler: async (_req,reply) => reply.code(410).send({ error: 'Les paires sont enregistrées avec chaque deck. Rechargez cette application.' }) });

  // Catégorie = étiquette manuelle (Q4) ; la `relevance` historique n'est plus écrite (purgée par 003).
  app.post<{ Body: { id?: string; name: string } }>('/categories', async (req,reply) => {
    const { id, name } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || (id !== undefined && !uuidPattern.test(id))) throw new ConfigurationError('Catégorie invalide.');
    const result = await libraryWrite(requireUser(req).id, async (c) => {
      const existing = await c.query('select id,name,is_builtin from nonengine_categories where owner_id=$1 and name=$2', [requireUser(req).id,name.trim()]);
      if (existing.rows[0]) return existing.rows[0];
      const { rows: [row] } = await c.query('insert into nonengine_categories (id,owner_id,name) values (coalesce($1::uuid,gen_random_uuid()),$2,$3) returning id,name,is_builtin', [id ?? null,requireUser(req).id,name.trim()]);
      return row;
    });
    return reply.code(201).send(result);
  });

  app.delete<{ Params: { id: string } }>('/categories/:id', async (req,reply) => {
    if (!uuidPattern.test(req.params.id)) throw new ConfigurationError('Identifiant invalide.');
    const result = await libraryWrite(requireUser(req).id,(c) => c.query('delete from nonengine_categories where id=$1 and owner_id=$2 and not is_builtin returning id', [req.params.id,requireUser(req).id]));
    if (!result.rowCount) return reply.code(400).send({ error: 'Catégorie absente ou fournie de base.' });
    return { ok: true };
  });

  app.post<{ Body: { card_id: number; category_id: string } }>('/card-categories', async (req,reply) => {
    const { card_id,category_id } = req.body ?? {};
    if (!cardIdValid(card_id) || !uuidPattern.test(category_id ?? '')) throw new ConfigurationError('Affectation invalide.');
    const result = await libraryWrite(requireUser(req).id,(c) => c.query('insert into card_categories (card_id,category_id) select $1,id from nonengine_categories where id=$2 and owner_id=$3 on conflict do nothing returning card_id', [card_id,category_id,requireUser(req).id]),card_id);
    if (!result.rowCount) {
      const owned = await query('select id from nonengine_categories where id=$1 and owner_id=$2', [category_id,requireUser(req).id]);
      if (!owned.rowCount) return reply.code(404).send({ error: 'Catégorie introuvable.' });
    }
    return reply.code(201).send({ ok: true });
  });
  app.delete<{ Params: { cardId: string; categoryId: string } }>('/card-categories/:cardId/:categoryId', async (req) => {
    const cardId = Number(req.params.cardId);
    if (!cardIdValid(cardId) || !uuidPattern.test(req.params.categoryId)) throw new ConfigurationError('Affectation invalide.');
    await libraryWrite(requireUser(req).id,(c) => c.query('delete from card_categories cc using nonengine_categories c where c.id=cc.category_id and c.owner_id=$3 and cc.card_id=$1 and cc.category_id=$2', [cardId,req.params.categoryId,requireUser(req).id]),cardId);
    return { ok: true };
  });

  // ─── Plafonds partagés (contrat §3 « Copies, HOPT et plafonds ») — annotation
  //     nouvelle du compte, saisie manuellement (Q2 : jamais créée par migration). ───
  const validGroup = (name: unknown, cap: unknown, partial: boolean): void => {
    if (name !== undefined || !partial) { if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new ConfigurationError('Nom de plafond invalide.'); }
    if (cap !== undefined || !partial) { if (!Number.isInteger(cap) || Number(cap) < 1 || Number(cap) > 32767) throw new ConfigurationError('Limite par tour invalide : entier ≥ 1 attendu.'); }
  };
  app.post<{ Body: { id?: string; name: string; cap_per_turn: number } }>('/groups', async (req,reply) => {
    const { id, name, cap_per_turn } = req.body ?? {};
    validGroup(name,cap_per_turn,false);
    if (id !== undefined && !uuidPattern.test(id)) throw new ConfigurationError('Identifiant invalide.');
    const uid = requireUser(req).id;
    const row = await libraryWrite(uid, async (c) => {
      const existing = await c.query('select id,name,cap_per_turn from nonengine_groups where owner_id=$1 and name=$2', [uid,name.trim()]);
      if (existing.rows[0]) {
        if (existing.rows[0].cap_per_turn !== cap_per_turn) throw new ConfigurationError('Un plafond de même nom a une autre limite.');
        return existing.rows[0];
      }
      const { rows: [created] } = await c.query('insert into nonengine_groups (id,owner_id,name,cap_per_turn) values (coalesce($1::uuid,gen_random_uuid()),$2,$3,$4) returning id,name,cap_per_turn', [id ?? null,uid,name.trim(),cap_per_turn]);
      return created;
    });
    return reply.code(201).send(row);
  });
  app.patch<{ Params: { id: string }; Body: { name?: string; cap_per_turn?: number } }>('/groups/:id', async (req,reply) => {
    if (!uuidPattern.test(req.params.id)) throw new ConfigurationError('Identifiant invalide.');
    const { name, cap_per_turn } = req.body ?? {};
    validGroup(name,cap_per_turn,true);
    if (name === undefined && cap_per_turn === undefined) throw new ConfigurationError('Rien à modifier.');
    const uid = requireUser(req).id;
    const result = await libraryWrite(uid,(c) => c.query('update nonengine_groups set name=coalesce($3,name),cap_per_turn=coalesce($4,cap_per_turn) where id=$1 and owner_id=$2 returning id,name,cap_per_turn', [req.params.id,uid,name?.trim() ?? null,cap_per_turn ?? null]));
    if (!result.rowCount) return reply.code(404).send({ error: 'Plafond partagé introuvable.' });
    return result.rows[0];
  });
  app.delete<{ Params: { id: string } }>('/groups/:id', async (req,reply) => {
    if (!uuidPattern.test(req.params.id)) throw new ConfigurationError('Identifiant invalide.');
    const uid = requireUser(req).id;
    // Les membres perdent leur plafond (FK on delete set null), jamais leur profil.
    const result = await libraryWrite(uid,(c) => c.query('delete from nonengine_groups where id=$1 and owner_id=$2 returning id', [req.params.id,uid]));
    if (!result.rowCount) return reply.code(404).send({ error: 'Plafond partagé introuvable.' });
    return { ok: true };
  });
}
