import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

// promisify() perd la surcharge à 4 arguments (options) → wrapper explicite.
const scrypt = (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

// scrypt natif Node (zéro dépendance, pas de build natif sous Windows).
// Paramètres OWASP : N=2^17, r=8, p=1, 64 octets. maxmem doit couvrir
// 128·N·r ≈ 128 Mio (le défaut Node est 32 Mio → ERR_CRYPTO_INVALID_SCRYPT_PARAMS).
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 256 * 1024 * 1024;

/** Format stocké : `scrypt:N:r:p:salt_b64:key_b64` — les paramètres voyagent avec
 *  le hash, donc durcissables plus tard sans invalider les comptes existants. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt:${N}:${R}:${P}:${salt.toString('base64')}:${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  if (expected.length === 0) return false;
  const key = await scrypt(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return timingSafeEqual(key, expected); // temps constant
}

// Hash factice pré-calculable : verifyPassword est appelé même quand l'email est
// inconnu, pour que login(email inconnu) et login(mauvais mot de passe) aient le
// même coût — pas d'énumération de comptes par le timing.
let dummyHash: string | null = null;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= await hashPassword(randomBytes(16).toString('base64'));
  await verifyPassword(password, dummyHash);
  return false;
}
