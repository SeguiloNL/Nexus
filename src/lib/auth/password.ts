import bcrypt from "bcryptjs";

export const BCRYPT_ROUNDS = 12;

/**
 * Hash een wachtwoord met bcrypt (cost = BCRYPT_ROUNDS = 12).
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Vergelijk een plaintext wachtwoord met een bcrypt hash.
 */
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}
