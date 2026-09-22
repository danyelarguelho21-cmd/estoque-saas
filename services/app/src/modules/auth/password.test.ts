import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes a password to a bcrypt string distinct from the plaintext", async () => {
    const hash = await hashPassword("Senha1234!");
    expect(hash).not.toBe("Senha1234!");
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("verifies the correct password against its hash", async () => {
    const hash = await hashPassword("Senha1234!");
    expect(await verifyPassword("Senha1234!", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("Senha1234!");
    expect(await verifyPassword("SenhaErrada", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const h1 = await hashPassword("Senha1234!");
    const h2 = await hashPassword("Senha1234!");
    expect(h1).not.toBe(h2);
  });
});
