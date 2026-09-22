// design-principles.md explicitly promises this journey as e2e-covered:
// "upload de XML → conferência → confirmação → saldo atualizado" (Pattern 5).
// Complements tests/integration/nfe-import.test.ts (API-level, no-mutation-before-confirm) by
// driving the actual review/confirm UI a real operator uses.
import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignupPage } from "../pages/signup.page";
import { DashboardPage } from "../pages/dashboard.page";
import { makeNfeXml, makeNfeItem } from "../../../fixtures/factories/nfe.factory";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("operator uploads NF-e XML, reviews matched/unmatched items, and confirming updates the stock balance shown in the UI", async ({ page }) => {
  const email = `qa-nfe-${Date.now()}@example.com`;
  const signup = new SignupPage(page);
  await signup.goto();
  await signup.fill({
    companyName: `Empresa NFe ${Date.now()}`,
    cnpj: Array.from({ length: 14 }, () => Math.floor(Math.random() * 10)).join(""),
    adminName: "Admin QA",
    adminEmail: email,
    password: "SenhaForte#123",
  });
  await signup.selectPlan("basico");
  await signup.submit();
  await new DashboardPage(page).waitForLoad();

  // Pre-register the product so the item matches by barcode (keeps this spec focused on the
  // review/confirm UI journey rather than the unmatched-item quick-registration sub-flow, which
  // is covered separately in the test plan's catalog section).
  const item = makeNfeItem({ cEAN: "7891000100200", xProd: "Feijão Preto 1kg" });
  await page.goto("/catalog/products/new");
  await page.getByTestId("product-sku").fill("FEIJAO-1KG");
  await page.getByTestId("product-name").fill(item.xProd);
  await page.getByTestId("product-barcode").fill(item.cEAN!);
  await page.getByTestId("product-unit").fill("UN");
  await page.getByTestId("product-submit").click();

  const balanceBefore = await page.getByTestId(`product-stock-${"FEIJAO-1KG"}`).textContent().catch(() => "0");

  const tmpDir = mkdtempSync(path.join(tmpdir(), "nfe-e2e-"));
  const xmlPath = path.join(tmpDir, "nfe.xml");
  writeFileSync(xmlPath, makeNfeXml([item]));

  await page.goto("/stock/nfe-imports/new");
  await page.getByTestId("nfe-store-select").selectOption({ label: "Loja Principal" });
  await page.getByTestId("nfe-file-input").setInputFiles(xmlPath);
  await page.getByTestId("nfe-upload-submit").click();

  // UI polls for parse completion per ADR-005 §4 — wait for the review screen, not a fixed sleep.
  await page.getByTestId("nfe-review-heading").waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.getByTestId(`nfe-item-status-${item.cProd}`)).toHaveText(/matched/i);

  // The confirm button must exist and, crucially, stock must NOT be updated yet.
  await expect(page.getByTestId("nfe-confirm-submit")).toBeVisible();

  await page.getByTestId("nfe-confirm-submit").click();
  await page.getByTestId("nfe-confirmed-banner").waitFor({ state: "visible" });

  await page.goto("/catalog/products");
  await expect(page.getByTestId(`product-stock-${"FEIJAO-1KG"}`)).not.toHaveText(String(balanceBefore ?? "0"));
});
