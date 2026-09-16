import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireUser } from '../auth/session.js';
import { parseCardIdList } from '../domain/cardIds.js';
import { cardImageUpstream } from '../domain/cardImage.js';

const CARD_COLS =
  'id, name, type, race, attribute, atk, def, level, description, image_url, image_url_small, image_url_cropped';

/** Taille maximale d'une vignette relayée : une vignette du CDN pèse quelques dizaines de ko. */
const CARD_IMAGE_MAX_BYTES = 2_000_000;

const SEARCH_LIMIT_DEFAULT = 30;
const SEARCH_LIMIT_MAX = 100;

export async function cardsRoutes(app: FastifyInstance, opts: { fetchImage?: typeof fetch } = {}) {
  const fetchImage = opts.fetchImage ?? fetch;
  // Catalogue réservé aux comptes (textes de Konami, audit 03 B2) : derrière la garde globale,
  // et `requireUser` dans chaque gestionnaire comme dans decks.ts et library.ts (audit 04 O1).

  // Résolution par ids (import YDK → passcodes). GET /api/cards?ids=123,456
  // Étape 6 (C5) : passcodes entiers positifs stricts, sinon 400 explicite.
  app.get<{ Querystring: { ids?: string } }>('/', async (req, reply) => {
    requireUser(req);
    const raw = req.query.ids;
    if (!raw) return reply.code(400).send({ error: 'paramètre `ids` requis' });
    const ids = parseCardIdList(raw);
    if (!ids) return reply.code(400).send({ error: 'paramètre `ids` invalide : passcodes entiers positifs séparés par des virgules' });
    const { rows } = await query(
      `select ${CARD_COLS} from cards where id = any($1::bigint[])`,
      [ids],
    );
    return rows;
  });

  // Recherche par nom. GET /api/cards/search?q=dragon&limit=30
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/search',
    async (req, reply) => {
      requireUser(req);
      const q = (req.query.q ?? '').trim();
      // Audit 04 O10 : `limit=-1` ou `0.5` partaient tels quels en SQL (500 avec le code SQL).
      const rawLimit = req.query.limit;
      const limit = rawLimit === undefined ? SEARCH_LIMIT_DEFAULT : Number(rawLimit);
      if (rawLimit !== undefined && (!/^\d+$/.test(rawLimit) || limit < 1 || limit > SEARCH_LIMIT_MAX)) {
        return reply.code(400).send({ error: `paramètre \`limit\` invalide : entier de 1 à ${SEARCH_LIMIT_MAX}` });
      }
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

  // Vignette relayée (étape 10D) : GET /api/cards/:id/image — pour que la fiche des plans de side
  // puisse intégrer les illustrations dans son PDF (domain/cardImage.ts). Passcode invalide : 400
  // sans aucun appel sortant ; amont absent : 404 ; tout le reste (panne, délai, autre chose
  // qu'une image, taille démesurée) : 502. Derrière l'authentification, comme toute l'API.
  app.get<{ Params: { id: string } }>('/:id/image', async (req, reply) => {
    requireUser(req);
    const upstream = cardImageUpstream(req.params.id);
    if (!upstream) return reply.code(400).send({ error: 'passcode invalide' });
    let res: Response;
    try {
      res = await fetchImage(upstream, { signal: AbortSignal.timeout(8000) });
    } catch {
      return reply.code(502).send({ error: 'vignette indisponible' });
    }
    if (!res.ok) return reply.code(res.status === 404 ? 404 : 502).send({ error: 'vignette indisponible' });
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return reply.code(502).send({ error: 'vignette indisponible' });
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > CARD_IMAGE_MAX_BYTES) return reply.code(502).send({ error: 'vignette indisponible' });
    return reply.header('content-type', type).header('cache-control', 'private, max-age=86400').send(body);
  });
}
