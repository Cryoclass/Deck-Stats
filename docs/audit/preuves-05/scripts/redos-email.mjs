// Même expression que server/src/routes/auth.ts:18, mesurée hors serveur.
const EMAIL_RE = /^\S+@\S+\.\S+$/;
for (const [label, make] of [
  ['@ répété', (n) => '@'.repeat(n)],
  ['a@ répété', (n) => 'a@'.repeat(n / 2)],
  ['a (sans @)', (n) => 'a'.repeat(n)],
  ['a@b sans point', (n) => 'a@' + 'b'.repeat(n - 2)],
]) {
  for (const n of [1000, 2000, 4000, 8000, 16000]) {
    const s = make(n);
    const t0 = process.hrtime.bigint();
    const ok = EMAIL_RE.test(s.trim());
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`${label.padEnd(16)} n=${String(n).padStart(6)}  ${ms.toFixed(1).padStart(9)} ms  match=${ok}`);
    if (ms > 20000) break;
  }
}
