/**
 * Password hashing via Web Crypto's PBKDF2, no external deps. Runs in
 * Cloudflare Workers (no Node crypto/bcrypt available there) and in
 * `astro dev` (Node's webcrypto also implements the same SubtleCrypto
 * interface), so this is the one implementation that works in both.
 *
 * Format stored in participant_users.password_hash:
 *   pbkdf2$<iterations>$<saltBase64>$<hashBase64>
 * Versioned with the iteration count baked into the string so a future
 * bump to the work factor doesn't invalidate already-hashed passwords —
 * verify() reads whatever iteration count is stored, it doesn't assume
 * PBKDF2_ITERATIONS matches every existing hash.
 */

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function deriveHash(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    HASH_BITS
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hashBits = await deriveHash(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt.buffer)}$${toBase64(hashBits)}`;
}

/**
 * Constant-time-ish comparison: both sides are always the same fixed
 * length (a SHA-256 digest, 32 bytes) since we compare derived hashes, not
 * raw passwords, so a length-based short-circuit isn't a meaningful timing
 * leak here the way it would be for arbitrary-length secrets.
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const [, iterationsRaw, saltB64, hashB64] = parts;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const salt = fromBase64(saltB64);
  const expected = fromBase64(hashB64);
  const actual = new Uint8Array(await deriveHash(password, salt, iterations));

  return bytesEqual(actual, expected);
}
