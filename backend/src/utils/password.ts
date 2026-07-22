import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id parameters — OWASP's recommended baseline (19 MiB, 2 iterations).
 * Argon2id resists both GPU cracking and side-channel attacks.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, OPTIONS);
  } catch {
    // A malformed stored digest must read as "wrong password", not a 500.
    return false;
  }
}
