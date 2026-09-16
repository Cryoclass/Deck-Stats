import './env.js';
import { buildApp } from './app.js';

const PORT = Number(process.env.PORT ?? 8787);

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`API prête sur http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
