import type { Page } from "@playwright/test";

// REWRITTEN (Wave B): real route is /entrar (services/app/src/app/entrar/page.tsx), labeled
// fields ("E-mail"/"Senha") instead of the data-testid contract Wave A assumed — see
// signup.page.ts for the full rationale (same finding applies here).
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/entrar");
  }

  async login(email: string, password: string) {
    await this.page.getByLabel("E-mail").fill(email);
    await this.page.getByLabel("Senha").fill(password);
    await this.page.getByRole("button", { name: "Entrar" }).click();
  }

  /** Returns the alert's text if present, or `null` without throwing (safe for `expect.poll`) —
   * the shared `Alert` component (services/app/src/components/ui/alert.tsx) renders `role="alert"`. */
  async errorMessage(): Promise<string | null> {
    const alert = this.page.getByRole("alert");
    if ((await alert.count()) === 0) return null;
    return alert.first().textContent();
  }
}
