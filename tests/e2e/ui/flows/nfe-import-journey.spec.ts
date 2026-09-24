// design-principles.md explicitly promises this journey as e2e-covered:
// "upload de XML → conferência → confirmação → saldo atualizado" (Pattern 5).
// Complements tests/integration/nfe-import.test.ts (API-level, no-mutation-before-confirm) by
// driving the actual review/confirm UI a real operator uses.
//
// REWRITTEN (Wave B, real-implementation verification): routes/selectors read directly from the
// implemented frontend (services/app/src/app/{produtos/novo,configuracoes/lojas,estoque/nfe,
// estoque/nfe/[importId]}/page.tsx) — Wave A's `/catalog/products/new`, `/stock/nfe-imports/new`
// and the full data-testid contract never matched what was built (no data-testid exists anywhere
// in services/app/src/app - see signup.page.ts for the fuller rationale). Signup creates the
// default "Loja principal", which this journey uses as the NF-e destination.
import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignupPage } from "../pages/signup.page";
import { DashboardPage } from "../pages/dashboard.page";
import { makeNfeXml, makeNfeItem } from "../../../fixtures/factories/nfe.factory";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { generateValidCnpj } from "../../../fixtures/cnpj";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("operator uploads NF-e XML, reviews matched items, and confirming updates the stock balance shown in the UI", async ({ page }) => {
  const email = `qa-nfe-${Date.now()}@example.com`;
  const signup = new SignupPage(page);
  await signup.goto();
  await signup.completeSignup({
    companyName: `Empresa NFe ${Date.now()}`,
    cnpj: generateValidCnpj(),
    adminName: "Admin QA",
    adminEmail: email,
    password: "SenhaForte#123",
  });
  await new DashboardPage(page).waitForLoad();

  // Verify and reuse the default store created during signup; the Basic plan allows one store.
  await page.goto("/configuracoes/lojas");
  await expect(page.getByText("Loja principal")).toBeVisible();

  // Pre-register the product so the item matches by barcode (keeps this spec focused on the
  // review/confirm UI journey rather than the unmatched-item quick-registration sub-flow).
  const item = makeNfeItem({ cEAN: "7891000100200", xProd: "Feijão Preto 1kg" });
  await page.goto("/produtos/novo");
  await page.getByLabel("SKU").fill("FEIJAO-1KG");
  await page.getByLabel("Nome do produto").fill(item.xProd);
  await page.getByLabel("Código de barras").fill(item.cEAN!);
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  await expect(page).toHaveURL(/\/produtos\/[0-9a-f-]+$/); // redirected to the new product's detail page

  const tmpDir = mkdtempSync(path.join(tmpdir(), "nfe-e2e-"));
  const xmlPath = path.join(tmpDir, "nfe.xml");
  writeFileSync(xmlPath, makeNfeXml([item]));

  await page.goto("/estoque/nfe");
  // The shared `Select` (components/ui/select.tsx) is a Radix combobox `<button>`, not a native
  // `<select>` — open it and click the option, rather than `selectOption()`.
  await page.getByLabel("Loja/depósito de destino").click();
  await page.getByRole("option", { name: "Loja principal" }).click();
  // FileDrop (components/features/file-drop.tsx) renders a real, visually-hidden `<input
  // type="file">` — setInputFiles() works on it directly without needing to simulate a drag/click.
  await page.locator('input[type="file"]').setInputFiles(xmlPath);

  // Successful upload redirects straight to the review screen (services/app/src/app/estoque/nfe/
  // page.tsx `handleFile` -> `router.push('/estoque/nfe/${importId}')`); the UI itself polls for
  // parse completion (`refetchInterval` while status === pending_parse), never a fixed sleep.
  //
  // Do not weaken this assertion to match a failed import: this full browser journey verifies the
  // intended review/confirm behavior after the app and worker share the configured upload volume.
  await expect(page.getByRole("heading", { name: "Conferência de NF-e" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Reconhecido").first()).toBeVisible();

  await page.getByRole("button", { name: "Confirmar importação e atualizar estoque" }).click();
  await expect(page).toHaveURL(/\/estoque$/);
});
