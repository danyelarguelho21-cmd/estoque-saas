// Closes a real bug found via manual e2e browser testing: finishing a sale at /vendas/nova
// correctly created the sale in the database (confirmed via /vendas history), but the UI
// redirected to /vendas/undefined and showed "Venda não encontrada" — POST /api/sales returns
// {saleId, totalAmountCents} (services/app/src/modules/sales/sales.ts's SaleResult), not a full
// Sale object with an `.id` field, but the frontend read `sale.id` (undefined) and the API client
// was mistyped as returning `Sale` instead of the real response shape. Fixed in
// services/app/src/lib/api/{sales,types}.ts and services/app/src/app/vendas/nova/page.tsx.
//
// This is exactly the class of bug an API-level integration test CANNOT catch (the response body
// itself was never wrong — the bug was purely "what does the browser do with it," i.e. does the
// final rendered page/URL match what a real user would see) — boundary-safety Pattern 5: verify
// the user's actual final state, not an intermediate response code.
import { expect, test } from "@playwright/test";
import { SignupPage } from "../pages/signup.page";
import { DashboardPage } from "../pages/dashboard.page";

test("finishing a sale redirects to the REAL sale's detail page, not /vendas/undefined", async ({ page }) => {
  const email = `qa-sale-${Date.now()}@example.com`;
  const signup = new SignupPage(page);
  await signup.goto();
  await signup.completeSignup({
    companyName: `Empresa Venda ${Date.now()}`,
    cnpj: Array.from({ length: 14 }, () => Math.floor(Math.random() * 10)).join(""),
    adminName: "Admin QA",
    adminEmail: email,
    password: "SenhaForte#123",
  });
  await new DashboardPage(page).waitForLoad();

  // Signup creates no store — same prerequisite as nfe-import-journey.spec.ts.
  await page.goto("/configuracoes/lojas");
  await page.getByRole("button", { name: "Nova loja" }).click();
  await page.getByLabel("Nome").fill("Loja Principal");
  await page.getByRole("button", { name: "Cadastrar" }).click();
  await expect(page.getByText("Loja Principal")).toBeVisible();

  // Register a product with stock via /produtos/novo, then a manual stock entry so the sale
  // doesn't 409 on insufficient stock (keeps this spec focused on the redirect bug, not FEFO).
  const sku = `VENDA-${Date.now()}`;
  await page.goto("/produtos/novo");
  await page.getByLabel("SKU").fill(sku);
  await page.getByLabel("Nome do produto").fill("Produto para Venda");
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  await expect(page).toHaveURL(/\/produtos\/[0-9a-f-]+$/);

  await page.goto("/estoque/entrada");
  await page.getByPlaceholder("Buscar produto por nome, SKU ou código de barras").fill("Produto para Venda");
  await page.getByRole("option", { name: /Produto para Venda/ }).click();
  await page.getByLabel("Loja/depósito de destino").click();
  await page.getByRole("option", { name: "Loja Principal" }).click();
  await page.getByLabel("Quantidade").fill("50");
  await page.getByRole("button", { name: "Registrar entrada" }).click();
  await expect(page).toHaveURL(/\/estoque$/);

  // The actual flow under test.
  await page.goto("/vendas/nova");
  await page.getByLabel("Loja").click();
  await page.getByRole("option", { name: "Loja Principal" }).click();
  await page.getByPlaceholder("Buscar produto por nome, SKU ou código de barras").fill("Produto para Venda");
  await page.getByRole("option", { name: /Produto para Venda/ }).click();
  await page.getByLabel("Preço unit. (R$)").fill("29.90");
  await page.getByRole("button", { name: "Finalizar venda" }).click();

  // THE bug: this used to be /vendas/undefined with an EmptyState("Venda não encontrada").
  // A real UUID in the URL and the real sale detail heading are the actual end state that matters.
  await expect(page).toHaveURL(/\/vendas\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Venda" })).toBeVisible();
  await expect(page.getByText("Venda não encontrada")).not.toBeVisible();
  await expect(page.getByText("R$ 29,90").first()).toBeVisible(); // total amount rendered, not a broken/empty page
});
