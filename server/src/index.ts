import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { pool } from './db.js';
import { cardsRoutes } from './routes/cards.js';
import { decksRoutes } from './routes/decks.js';
import { libraryRoutes } from './routes/library.js';

const PORT = Number(process.env.PORT ?? 8787);

const app = Fastify({ logger: { transport: undefined } });

await app.register(cors, { origin: true });

app.get('/api/health', async () => {
  const { rows } = await pool.query<{ count: string }>(
    'select count(*)::text as count from cards',
  );
  return { ok: true, cards: Number(rows[0].count) };
});

await app.register(cardsRoutes, { prefix: '/api/cards' });
await app.register(decksRoutes, { prefix: '/api/decks' });
await app.register(libraryRoutes, { prefix: '/api/library' });

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`API prête sur http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
