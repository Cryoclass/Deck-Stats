import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { cardImageUpstream } from '../src/domain/cardImage.js';

// Étape 10D : relais des vignettes pour le PDF de la fiche. Aucune base ici : la route d'image n'en
// lit aucune, et le pool pg n'ouvre de connexion qu'à sa première requête.
process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:1/unused';
const { cardsRoutes } = await import('../src/routes/cards.js');

test('the image relay only targets the CDN, through a fixed path and a strictly numeric passcode (étape 10D)', () => {
  assert.equal(cardImageUpstream('483'), 'https://images.ygoprodeck.com/images/cards_small/483.jpg');
  for (const bad of ['0', '-1', 'abc', '1e3', '12.5', '0123', '1234567890123', '483/../../x', '%2e%2e', '483.jpg', ' 483', '']) {
    assert.equal(cardImageUpstream(bad), null, JSON.stringify(bad));
  }
});

test('the image route relays an image, refuses an invalid id without any outgoing call, and never relays anything else (étape 10D)', async () => {
  const calls: string[] = [];
  let upstream: () => Response = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'content-type': 'image/jpeg' } });
  const fakeFetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return upstream();
  }) as typeof fetch;
  const app = Fastify();
  await app.register(cardsRoutes, { prefix: '/api/cards', fetchImage: fakeFetch });

  const ok = await app.inject({ method: 'GET', url: '/api/cards/483/image' });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.headers['content-type'], 'image/jpeg');
  assert.deepEqual([...ok.rawPayload], [0xff, 0xd8, 0xff, 0xd9]);
  assert.match(String(ok.headers['cache-control']), /max-age=\d+/);
  assert.deepEqual(calls, ['https://images.ygoprodeck.com/images/cards_small/483.jpg']);

  for (const bad of ['abc', '0', '..%2F..%2Fetc']) assert.equal((await app.inject({ method: 'GET', url: `/api/cards/${bad}/image` })).statusCode, 400, bad);
  assert.equal(calls.length, 1, 'aucun appel sortant pour un id invalide');

  upstream = () => new Response('absent', { status: 404 });
  assert.equal((await app.inject({ method: 'GET', url: '/api/cards/484/image' })).statusCode, 404);
  upstream = () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
  assert.equal((await app.inject({ method: 'GET', url: '/api/cards/485/image' })).statusCode, 502);
  upstream = () => new Response(new Uint8Array(2_000_001), { headers: { 'content-type': 'image/jpeg' } });
  assert.equal((await app.inject({ method: 'GET', url: '/api/cards/486/image' })).statusCode, 502);
  upstream = () => { throw new Error('réseau coupé'); };
  assert.equal((await app.inject({ method: 'GET', url: '/api/cards/487/image' })).statusCode, 502);
  await app.close();
});
