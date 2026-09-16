import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { pool } from './db.js';
import { markRoutesPublic, registerAuthGuard } from './auth/guard.js';
import { authRoutes } from './routes/auth.js';
import { discordRoutes } from './routes/discord.js';
import { cardsRoutes } from './routes/cards.js';
import { decksRoutes } from './routes/decks.js';
import { libraryRoutes } from './routes/library.js';

export interface BuildAppOptions {
  /** Journal Fastify (pino). Désactivé par les tests d'intégration. */
  logger?: boolean;
}

/**
 * Fabrique de l'application : tout est branché (CORS, cookies, limites de débit, garde
 * d'authentification, routes, front statique), rien n'écoute. `index.ts` appelle `listen` ;
 * les tests d'intégration injectent des requêtes sur l'app réelle (`app.inject`).
 * La configuration est lue dans l'environnement AU MOMENT de l'appel, pas au chargement du
 * module : un test peut la poser avant d'appeler la fabrique.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  // Cookies de session → CORS restreint à l'origine du front, avec credentials
  // (l'ancien `origin: true` est incompatible avec des cookies). En dev le front
  // passe par le proxy Vite (même origine), ceci couvre les accès directs.
  const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';

  // TRUST_PROXY=1 en production derrière Caddy : notre rate-limit lit `req.ip` —
  // sans ça, tous les visiteurs partageraient l'IP du conteneur proxy (un seul
  // seau). Sûr ici : l'app ne publie aucun port, seul Caddy peut l'atteindre, et
  // Caddy n'accepte pas de X-Forwarded-For forgé sans trusted_proxies.
  const app = Fastify({
    logger: opts.logger === false ? false : { transport: undefined },
    trustProxy: process.env.TRUST_PROXY === '1',
  });

  await app.register(cors, { origin: APP_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false }); // opt-in par route (login, register)

  app.decorateRequest('user', null);

  // Garde globale (itération 8, refaite à l'audit 04 O1) : décidée sur la route résolue,
  // privée par défaut ; une route publique le déclare par `config: { public: true }`.
  // Public aujourd'hui : health, inscription / connexion / fournisseurs / déconnexion,
  // départ et retour OAuth Discord, et le front statique (il porte la page de connexion).
  registerAuthGuard(app);

  // Public : sert aussi à comparer deux déploiements (`catalog` renvoie la version
  // du référentiel copiée ici). Volontairement sans détail de source ni empreinte —
  // c'est un point de contrôle, pas un inventaire.
  app.get('/api/health', { config: { public: true } }, async () => {
    const { rows } = await pool.query<{ count: string }>(
      'select count(*)::text as count from cards',
    );
    // La table peut manquer sur une base antérieure au suivi de version : health
    // doit rester vert (c'est la sonde du conteneur), catalog vaut alors null.
    const catalog = await pool
      .query<{ version: string; migrated_at: Date; local_cards_count: number }>(
        'select version, migrated_at, local_cards_count from catalog_version',
      )
      .then((r) => r.rows[0] ?? null)
      .catch(() => null);
    return {
      ok: true,
      cards: Number(rows[0].count),
      catalog: catalog && {
        version: catalog.version,
        migratedAt: catalog.migrated_at,
        cards: catalog.local_cards_count,
      },
    };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(discordRoutes, { prefix: '/api/auth/discord' });
  await app.register(cardsRoutes, { prefix: '/api/cards' });
  await app.register(decksRoutes, { prefix: '/api/decks' });
  await app.register(libraryRoutes, { prefix: '/api/library' });

  // Production : le serveur sert aussi le front construit (WEB_DIST → web/dist),
  // même origine que l'API — pas de CORS, cookies simples (même modèle que le
  // proxy Vite en dev). Fallback SPA : toute route non-API sans fichier renvoie
  // index.html, la query string reste intacte côté navigateur.
  const WEB_DIST = process.env.WEB_DIST ?? '';
  if (WEB_DIST) {
    // Plugin encapsulé : seules les routes du front y sont marquées publiques (la garde est
    // privée par défaut ; une route enregistrée plus tard sur l'app reste fermée). Le
    // gestionnaire 404 vit dans le même contexte, où @fastify/static décore `reply.sendFile`.
    await app.register(async (front) => {
      markRoutesPublic(front);
      await front.register(fastifyStatic, { root: path.resolve(WEB_DIST) });
      front.setNotFoundHandler((req, reply) => {
        if (req.raw.url?.startsWith('/api')) {
          return reply.code(404).send({ error: 'introuvable' });
        }
        return reply.sendFile('index.html');
      });
    });
  }

  return app;
}
