// AC (BRD Epic 1) + boundary-safety Pattern 5 — full cross-boundary journey test.
//
// "An auth test must check the user actually lands on the dashboard, not just that a token was
// issued." This spec drives a real browser through: unauthenticated redirect -> signup ->
// (explicit) login -> dashboard with tenant-scoped content -> logout -> protected route
// re-redirects. Each hop's final STATE is asserted, not just an intermediate response code.
import { expect, test } from "@playwright/test";
import { SignupPage } from "../pages/signup.page";
import { LoginPage } from "../pages/login.page";
import { DashboardPage } from "../pages/dashboard.page";

function uniqueEmail() {
  return `qa-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}
function uniqueCnpj() {
  return Array.from({ length: 14 }, () => Math.floor(Math.random() * 10)).join("");
}

test.describe("Signup -> Login -> Dashboard journey (Pattern 5)", () => {
  test("an unauthenticated visitor hitting /dashboard directly is redirected to /login (Pattern 2 — framework auth guard, not an ad-hoc client check)", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("self-service signup creates the tenant + admin and lands the user on an authenticated dashboard showing the company name", async ({ page }) => {
    const companyName = `Empresa QA ${Date.now()}`;
    const email = uniqueEmail();
    const password = "SenhaForte#123";

    const signup = new SignupPage(page);
    await signup.goto();
    await signup.fill({ companyName, cnpj: uniqueCnpj(), adminName: "Admin QA", adminEmail: email, password });
    await signup.selectPlan("basico");
    await signup.submit();

    // The real end state that matters: NOT "a 201 was returned" but "the user is authenticated
    // and sees THEIR company's dashboard" — this is the boundary-safety Pattern 5 assertion.
    const dashboard = new DashboardPage(page);
    await dashboard.waitForLoad();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect.poll(() => dashboard.tenantName()).toContain(companyName);
  });

  test("explicit login with wrong password shows an inline error and does NOT navigate away from /login", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login("nonexistent-user@example.com", "wrong-password");

    await expect(page).toHaveURL(/\/login/);
    await expect.poll(() => login.errorMessage()).toBeTruthy();
  });

  test("full loop: login with valid credentials reaches the dashboard, and logout returns to a state where /dashboard redirects to /login again", async ({ page }) => {
    // Reuses a fresh signup to get known-good credentials, then drives an EXPLICIT login (not
    // the session persisted from signup) to prove the login hop itself works end-to-end.
    const companyName = `Empresa QA Login ${Date.now()}`;
    const email = uniqueEmail();
    const password = "SenhaForte#123";
    const signup = new SignupPage(page);
    await signup.goto();
    await signup.fill({ companyName, cnpj: uniqueCnpj(), adminName: "Admin QA", adminEmail: email, password });
    await signup.selectPlan("basico");
    await signup.submit();

    const dashboardAfterSignup = new DashboardPage(page);
    await dashboardAfterSignup.waitForLoad();
    await dashboardAfterSignup.logout();
    await expect(page).toHaveURL(/\/login/);

    const login = new LoginPage(page);
    await login.login(email, password);

    const dashboard = new DashboardPage(page);
    await dashboard.waitForLoad();
    await expect(page).toHaveURL(/\/dashboard/);

    await dashboard.logout();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/); // session truly terminated, not just UI-hidden
  });
});
