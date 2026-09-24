// AC (BRD Epic 1) + boundary-safety Pattern 5 — full cross-boundary journey test.
//
// "An auth test must check the user actually lands on the dashboard, not just that a token was
// issued." This spec drives a real browser through: unauthenticated redirect -> signup ->
// (explicit) login -> dashboard with tenant-scoped content -> logout -> protected route
// re-redirects. Each hop's final STATE is asserted, not just an intermediate response code.
//
// REWRITTEN (Wave B, real app verification): routes/copy read directly from the implemented
// frontend (services/app/src/app/{cadastro,entrar,painel}/page.tsx, src/proxy.ts) — Wave A's
// English `/signup`, `/login`, `/dashboard` routes and `data-testid` contract never matched what
// was actually built. See the Page Object files for the per-selector rationale.
import { expect, test } from "@playwright/test";
import { SignupPage } from "../pages/signup.page";
import { LoginPage } from "../pages/login.page";
import { DashboardPage } from "../pages/dashboard.page";
import { generateValidCnpj } from "../../../fixtures/cnpj";

function uniqueEmail() {
  return `qa-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}
function uniqueCnpj() {
  return generateValidCnpj();
}

test.describe("Signup -> Login -> Dashboard journey (Pattern 5)", () => {
  test("an unauthenticated visitor hitting /painel directly is redirected to /entrar (Pattern 2 — framework auth guard via proxy.ts, not an ad-hoc client check)", async ({ page }) => {
    await page.goto("/painel");
    await expect(page).toHaveURL(/\/entrar/);
  });

  test("self-service signup creates the tenant + admin and lands the user on an authenticated dashboard showing the company name", async ({ page }) => {
    const companyName = `Empresa QA ${Date.now()}`;
    const email = uniqueEmail();
    const password = "SenhaForte#123";

    const signup = new SignupPage(page);
    await signup.goto();
    await signup.completeSignup({ companyName, cnpj: uniqueCnpj(), adminName: "Admin QA", adminEmail: email, password });

    // The real end state that matters: NOT "a 201 was returned" but "the user is authenticated
    // and sees THEIR company's dashboard" — this is the boundary-safety Pattern 5 assertion.
    const dashboard = new DashboardPage(page);
    await dashboard.waitForLoad();
    await expect(page).toHaveURL(/\/painel/);
    await expect.poll(() => dashboard.tenantName()).toContain(companyName);
  });

  test("explicit login with wrong password shows an inline error and does NOT navigate away from /entrar", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login("nonexistent-user@example.com", "wrong-password");

    await expect(page).toHaveURL(/\/entrar/);
    await expect.poll(() => login.errorMessage()).toBeTruthy();
  });

  test("full loop: login with valid credentials reaches the dashboard, and logout returns to a state where /painel redirects to /entrar again", async ({ page }) => {
    // Reuses a fresh signup to get known-good credentials, then drives an EXPLICIT login (not
    // the session persisted from signup) to prove the login hop itself works end-to-end.
    const companyName = `Empresa QA Login ${Date.now()}`;
    const email = uniqueEmail();
    const password = "SenhaForte#123";
    const signup = new SignupPage(page);
    await signup.goto();
    await signup.completeSignup({ companyName, cnpj: uniqueCnpj(), adminName: "Admin QA", adminEmail: email, password });

    const dashboardAfterSignup = new DashboardPage(page);
    await dashboardAfterSignup.waitForLoad();
    await dashboardAfterSignup.logout();
    await expect(page).toHaveURL(/\/entrar/);

    const login = new LoginPage(page);
    await login.login(email, password);

    const dashboard = new DashboardPage(page);
    await dashboard.waitForLoad();
    await expect(page).toHaveURL(/\/painel/);

    // NOTE (test-bug fix, Wave B): signOut() (next-auth/react) performs its OWN client-side
    // navigation to `callbackUrl` after clearing the session cookie server-side — asserting the
    // URL settles to /entrar FIRST (as already proven earlier in this same test, ~line 68) avoids
    // a race where an immediate page.goto("/painel") could fire before the cookie-clearing
    // request completes, which would abort/interleave with signOut()'s own in-flight navigation
    // and produce a false "still authenticated" read that has nothing to do with the app itself.
    await dashboard.logout();
    await expect(page).toHaveURL(/\/entrar/);
    await page.goto("/painel");
    await expect(page).toHaveURL(/\/entrar/); // session truly terminated, not just UI-hidden
  });
});
