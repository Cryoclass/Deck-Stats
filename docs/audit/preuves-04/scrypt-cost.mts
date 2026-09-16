// Coût d'une vérification de mot de passe (server/src/auth/password.ts), importé tel quel.
import { hashPassword, verifyAgainstDummy } from 'file:///C:/dev/Testhand/server/src/auth/password.ts';
import os from 'node:os';

const peak = { rss: 0 };
const sampler = setInterval(() => { peak.rss = Math.max(peak.rss, process.memoryUsage().rss); }, 5);
const rss0 = process.memoryUsage().rss;
let t = performance.now();
await hashPassword('motdepasse-audit');
const hashMs = Math.round(performance.now() - t);
t = performance.now();
await verifyAgainstDummy('x'); // email inconnu : même coût (auth.ts:113-116)
const dummyMs = Math.round(performance.now() - t);
// 4 vérifications simultanées (taille par défaut du pool libuv), comme 4 tentatives de connexion parallèles.
peak.rss = 0;
t = performance.now();
await Promise.all(Array.from({ length: 4 }, () => verifyAgainstDummy('y')));
const par4Ms = Math.round(performance.now() - t);
const peak4 = peak.rss;
peak.rss = 0;
t = performance.now();
await Promise.all(Array.from({ length: 16 }, () => verifyAgainstDummy('z')));
const par16Ms = Math.round(performance.now() - t);
clearInterval(sampler);
console.log(JSON.stringify({ cpus: os.cpus().length, uvThreadpool: process.env.UV_THREADPOOL_SIZE ?? '4 (défaut)', hashMs, dummyMs, par4Ms, rssAvantMio: Math.round(rss0 / 2 ** 20), rssPic4Mio: Math.round(peak4 / 2 ** 20), par16Ms, rssPic16Mio: Math.round(peak.rss / 2 ** 20) }));
