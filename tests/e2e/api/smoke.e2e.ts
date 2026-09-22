// Absolute minimum "is the app alive" checks — runs on every deploy, per qa-engineer skill
// Phase 5 rule 5. Deliberately has zero dependency on auth/DB seed state so it stays meaningful
// even when nothing else in the suite can run.
import { expect, test } from "@playwright/test";

test.describe("Smoke", () => {
  test("GET /api/healthz returns ok", async ({ request }) => {
    const res = await request.get("/api/healthz");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok" });
  });

  test("GET /api/readyz returns ok once DB/Redis are reachable", async ({ request }) => {
    const res = await request.get("/api/readyz");
    expect(res.status()).toBe(200);
  });

  test("GET / (public landing) responds without requiring auth", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBeLessThan(400);
  });
});
