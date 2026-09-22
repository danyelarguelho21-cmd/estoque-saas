import type { Page } from "@playwright/test";

// REWRITTEN (Wave B): real route is /painel (services/app/src/app/painel/page.tsx), heading text
// "Painel" (h1, no data-testid). Tenant name is rendered in the Header
// (services/app/src/components/layout/header.tsx) next to the mobile-nav button, only when
// `useCurrentUser()` resolves a `tenantName` — NOT inside the dashboard body itself (Wave A's
// page object assumed a `dashboard-tenant-name` testid inside the page content, which never
// existed). Logout lives behind the user-menu dropdown ("Menu do usuário" -> "Sair").
export class DashboardPage {
  constructor(private readonly page: Page) {}

  async waitForLoad() {
    await this.page.getByRole("heading", { name: "Painel", exact: true }).waitFor({ state: "visible" });
  }

  async tenantName() {
    // The tenant name is the ONLY <p> the Header component renders (semantic landmark + tag,
    // not a class selector) — rendered only on >=sm viewports (Tailwind `hidden sm:block`);
    // Playwright's default desktop viewport satisfies that breakpoint.
    const p = this.page.locator("header p");
    if ((await p.count()) === 0) return null;
    return p.first().textContent();
  }

  async logout() {
    await this.page.getByRole("button", { name: "Menu do usuário" }).click();
    await this.page.getByRole("menuitem", { name: "Sair" }).click();
  }
}
