import type { Page } from "@playwright/test";

export class DashboardPage {
  constructor(private readonly page: Page) {}

  async waitForLoad() {
    await this.page.getByTestId("dashboard-heading").waitFor({ state: "visible" });
  }

  async tenantName() {
    return this.page.getByTestId("dashboard-tenant-name").textContent();
  }

  async logout() {
    await this.page.getByTestId("nav-logout").click();
  }
}
