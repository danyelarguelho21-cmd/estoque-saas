import type { Page } from "@playwright/test";

// Page Object Model — Playwright rule: resilient selectors only (data-testid / ARIA role/label),
// never CSS classes or DOM structure (qa-engineer skill Phase 5 rule 4).
//
// REWRITTEN (Wave B, real-implementation verification): Wave A assumed an English `/signup` route
// with `data-testid` attributes throughout. The real frontend (read directly from
// services/app/src/app/cadastro/page.tsx) uses Portuguese routes and ships ZERO `data-testid`
// attributes anywhere (verified: `grep -r data-testid services/app/src/app` finds nothing) —
// instead every field is a properly `<label htmlFor>`-associated `<Input>` (via the shared
// `Field` component), which is the MORE resilient selector per the skill's own rule, so this
// rewrite leans on `getByLabel`/`getByRole` rather than chasing a testid contract the frontend
// never implemented. Also: signup is a real two-step wizard (company info + plan -> payment
// method), not a single form — Wave A's `fill()`+`submit()` shape modeled only step 1.
export class SignupPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/cadastro");
  }

  async fill(input: { companyName: string; cnpj: string; adminName: string; adminEmail: string; password: string }) {
    await this.page.getByLabel("Nome da empresa").fill(input.companyName);
    await this.page.getByLabel("CNPJ").fill(input.cnpj);
    await this.page.getByLabel("Seu nome").fill(input.adminName);
    await this.page.getByLabel("Seu e-mail").fill(input.adminEmail);
    await this.page.getByLabel("Senha").fill(input.password);
  }

  /** Selects a plan card. `planName` is matched case-insensitively against the plan's displayed
   * name; when omitted, picks whichever plan card renders first (the specific plan rarely matters
   * to a journey test, and the dev database can carry multiple same-named seeded plans). */
  async selectPlan(planName?: string) {
    const cards = planName
      ? this.page.getByRole("button", { name: new RegExp(planName, "i") })
      : this.page.getByRole("button", { name: /produtos/i }); // every PlanCard's text includes "Até N produtos"
    await cards.first().click();
  }

  /** Step 1 -> Step 2 (company info + plan selection -> payment method). */
  async submitStep1() {
    await this.page.getByRole("button", { name: "Continuar" }).click();
  }

  /** Step 2: keeps the default "Pix ou boleto" payment method (no card tokenization dependency)
   * and completes the subscription, landing on /painel. */
  async submitStep2Pix() {
    await this.page.getByRole("button", { name: "Concluir assinatura" }).click();
  }

  /** Convenience: the full two-step flow with sensible defaults (Pix/boleto, first plan). */
  async completeSignup(input: { companyName: string; cnpj: string; adminName: string; adminEmail: string; password: string }) {
    await this.fill(input);
    await this.selectPlan();
    await this.submitStep1();
    await this.submitStep2Pix();
  }
}
