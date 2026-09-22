// Hash de senha — bcrypt, cost 12 (OWASP 2026 — ver security-engineer finding M-1).
// bcryptjs (implementação pura em JS) evita dependência de binário nativo (node-gyp), relevante
// para build multi-stage em Docker (Dockerfile alpine) e para este ambiente de desenvolvimento.
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
