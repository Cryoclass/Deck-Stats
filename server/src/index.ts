import './env.js';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { pool } from './db.js';
import { resolveSession } from './auth/session.js';
import { authRoutes } from './routes/auth.js';
import { discordRoutes } from './routes/discord.js';
import { cardsRoutes } from './routes/cards.js';
import { decksRoutes } from './routes/decks.js';
import { libraryRoutes } from './routes/library.js';

const PORT = Number(process.env.PORT ?? 8787);
// Cookies de session → CORS restreint à l'origine du front, avec credentials
// (l'ancien `origin: true` est incompatible avec des cookies). En dev le front
// passe par le proxy Vite (même origine), ceci couvre les accès directs.
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';

// TRUST_PROXY=1 en production derrière Caddy : notre rate-limit lit `req.ip` —
// sans ça, tous les visiteurs partageraient l'IP du conteneur proxy (un seul
// seau). Sûr ici : l'app ne publie aucun port, seul Caddy peut l'atteindre, et
// Caddy n'accepte pas de X-Forwarded-For forgé sans trusted_proxies.
const app = Fastify({
  logger: { transport: undefined },
  trustProxy: process.env.TRUST_PROXY === '1',
});

await app.register(cors, { origin: APP_ORIGIN, credentials: true });
await app.register(cookie);
await app.register(rateLimit, { global: false }); // opt-in par route (login, register)

app.decorateRequest('user', null);

// Garde globale (itération 8) — déclarée AVANT les routes : un hook Fastify ne
// s'applique qu'aux routes enregistrées après lui. Elle ne protège que l'API :
// le front statique (WEB_DIST) est public — c'est lui qui porte la page de
// connexion. Public côté API : health + auth.
app.addHook('preHandler', async (req, reply) => {
  const path = req.url.split('?')[0];
  if (!path.startsWith('/api')) return;
  if (path === '/api/health' || path.startsWith('/api/auth/')) return;
  const user = await resolveSession(req, reply);
  if (!user) return reply.code(401).send({ error: 'non authentifié' });
  req.user = user;
});

app.get('/api/health', async () => {
  const { rows } = await pool.query<{ count: string }>(
    'select count(*)::text as count from cards',
  );
  return { ok: true, cards: Number(rows[0].count) };
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
  await app.register(fastifyStatic, { root: path.resolve(WEB_DIST) });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api')) {
      return reply.code(404).send({ error: 'introuvable' });
    }
    return reply.sendFile('index.html');
  });
}

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`API prête sur http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
