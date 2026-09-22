import { describe, expect, it } from "vitest";
import { RateLimitedError } from "@estoque-saas/shared";
import { RATE_LIMITS, checkRateLimit, clientIp, type RateLimitStore } from "./rate-limit";

// Store em memória (sem Redis real) — só para testar a lógica de checkRateLimit isoladamente
// (security-engineer finding H-5: brute-force/credential-stuffing em /api/auth/login,
// /api/auth/signup e /api/platform-admin/login não tinha nenhuma proteção).
class FakeStore implements RateLimitStore {
  private counts = new Map<string, number>();

  async increment(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
}

describe("checkRateLimit", () => {
  it("allows requests up to the limit", async () => {
    const store = new FakeStore();
    const rule = { key: "rl:test:a", limit: 3, windowMs: 60_000 };
    await checkRateLimit(rule, store);
    await checkRateLimit(rule, store);
    await checkRateLimit(rule, store);
    // 3ª chamada (contagem chega a 3) não deve lançar — só a que EXCEDE o limite.
  });

  it("throws RateLimitedError (429) once the limit is exceeded", async () => {
    const store = new FakeStore();
    const rule = { key: "rl:test:b", limit: 2, windowMs: 60_000 };
    await checkRateLimit(rule, store);
    await checkRateLimit(rule, store);
    await expect(checkRateLimit(rule, store)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("tracks distinct keys independently (per-IP / per-email buckets do not interfere)", async () => {
    const store = new FakeStore();
    const ruleA = { key: "rl:test:ip:1.2.3.4", limit: 1, windowMs: 60_000 };
    const ruleB = { key: "rl:test:ip:5.6.7.8", limit: 1, windowMs: 60_000 };
    await checkRateLimit(ruleA, store);
    // Segunda chamada na MESMA chave estoura o limite...
    await expect(checkRateLimit(ruleA, store)).rejects.toBeInstanceOf(RateLimitedError);
    // ...mas uma chave DIFERENTE (outro IP) continua com seu próprio orçamento intacto.
    await expect(checkRateLimit(ruleB, store)).resolves.toBeUndefined();
  });

  it("fails open (never throws) when the store itself errors — Redis unavailable must not block login", async () => {
    const brokenStore: RateLimitStore = {
      increment: async () => {
        throw new Error("ECONNREFUSED (simulated Redis outage)");
      },
    };
    await expect(
      checkRateLimit({ key: "rl:test:c", limit: 1, windowMs: 60_000 }, brokenStore),
    ).resolves.toBeUndefined();
  });
});

describe("RATE_LIMITS", () => {
  // Regressão: signUpAndLogin() (tests/fixtures/http-test-client.ts) é chamado por praticamente
  // todo teste de integração e sempre origina do mesmo IP (test runner) — os defaults de produção
  // precisam ser overridable via env var (RATE_LIMIT_SIGNUP_IP_MAX etc.) em vez de hardcoded, para
  // que o ambiente de CI/integração possa afrouxar o limite sem editar código de produção nem os
  // arquivos de teste do QA. Este teste garante a forma/os defaults seguros continuam presentes.
  it("has a strictly-not-weaker admin login policy than tenant login (H-5 requirement)", () => {
    expect(RATE_LIMITS.adminLoginByEmail.limit).toBeLessThanOrEqual(RATE_LIMITS.loginByEmail.limit);
    expect(RATE_LIMITS.adminLoginByIp.limit).toBeLessThanOrEqual(RATE_LIMITS.loginByIp.limit);
  });

  it("exposes finite, positive limit/window values for every rule (env override never produces NaN/0/negative)", () => {
    for (const rule of Object.values(RATE_LIMITS)) {
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowMs).toBeGreaterThan(0);
      expect(Number.isFinite(rule.limit)).toBe(true);
      expect(Number.isFinite(rule.windowMs)).toBe(true);
    }
  });
});

describe("clientIp", () => {
  it("reads the first address from X-Forwarded-For", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
    expect(clientIp(req)).toBe("203.0.113.9");
  });

  it("falls back to X-Real-IP when X-Forwarded-For is absent", () => {
    const req = new Request("http://x", { headers: { "x-real-ip": "198.51.100.2" } });
    expect(clientIp(req)).toBe("198.51.100.2");
  });

  it("falls back to a fixed bucket (never throws / never returns empty) with no proxy headers", () => {
    const req = new Request("http://x");
    expect(clientIp(req)).toBe("unknown");
  });
});
