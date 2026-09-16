// Génère scrypt-node-vectors.json avec le code réel du serveur (server/src/auth/password.ts),
// pour prouver que PasswordHash.Verify (.NET) lit les hachages produits par Node.
//
// À lancer depuis le dossier server/ du dépôt (tsx est une dépendance de ce workspace) :
//   node --import tsx ../admin/tests/Testhand.Admin.Tests/fixtures/make-scrypt-vectors.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword } from '../../../../server/src/auth/password.ts';

const here = dirname(fileURLToPath(import.meta.url));

// Six mots de passe qui doivent correspondre : ASCII, espaces, accents, emoji, 200 caractères, vide.
const matching = [
  'password',
  'correct horse battery staple',
  'été à Paris, ça marche',
  'main de 5 cartes 🃏🎴',
  'Lorem-ipsum-0123456789-'.repeat(9).slice(0, 200),
  '',
];

// Deux hachages valides vérifiés avec un autre mot de passe : doivent échouer.
const mismatching = [
  { hashed: 'hunter2', tried: 'hunter3' },
  { hashed: 'été', tried: 'ete' },
];

const entries = [];
for (const password of matching) {
  const hash = await hashPassword(password);
  if (!(await verifyPassword(password, hash))) throw new Error(`Node ne vérifie pas son propre hachage : ${password}`);
  entries.push({ password, hash, matches: true });
}
for (const { hashed, tried } of mismatching) {
  const hash = await hashPassword(hashed);
  if (await verifyPassword(tried, hash)) throw new Error(`Node accepte un mauvais mot de passe : ${tried}`);
  entries.push({ password: tried, hash, matches: false });
}

if (entries[4].password.length !== 200) throw new Error('le mot de passe long doit faire 200 caractères');

const out = join(here, 'scrypt-node-vectors.json');
writeFileSync(out, JSON.stringify({ generatedBy: 'server/src/auth/password.ts', entries }, null, 2) + '\n', 'utf8');
console.log(`${entries.length} entrées écrites dans ${out}`);
