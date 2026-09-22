import type { Page } from "@playwright/test";

// Page Object Model — Playwright rule: resilient selectors only (data-testid / ARIA role),
// never CSS classes or DOM structure (qa-engineer skill Phase 5 rule 4).
//
// data-testid contract assumed here (documented for the Frontend Engineer building against this
// scaffold): every field/button below must carry the matching `data-testid`. If the actual
// implementation names them differently, update this Page Object — the flow assertions in the
// spec files are the actual acceptance criteria, not these selector strings.
export class SignupPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/signup");
  }

  async fill(input: { companyName: string; cnpj: string; adminName: string; adminEmail: string; password: string }) {
    await this.page.getByTestId("signup-company-name").fill(input.companyName);
    await this.page.getByTestId("signup-cnpj").fill(input.cnpj);
    await this.page.getByTestId("signup-admin-name").fill(input.adminName);
    await this.page.getByTestId("signup-admin-email").fill(input.adminEmail);
    await this.page.getByTestId("signup-password").fill(input.password);
  }

  async selectPlan(planName: string) {
    await this.page.getByTestId(`signup-plan-${planName.toLowerCase()}`).click();
  }

  async submit() {
    await this.page.getByTestId("signup-submit").click();
  }
}
