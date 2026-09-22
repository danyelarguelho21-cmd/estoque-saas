// AC-001 (BRD) / ADR-005 — the single most explicit acceptance criterion in the BRD:
// "o sistema lista os itens da nota, sinaliza produtos não cadastrados, e só grava a entrada em
//  estoque após confirmação explícita do operador."
//
// This is the highest-value oracle in the whole suite: it proves NEGATIVELY that no stock
// mutation happens on upload/parse, and POSITIVELY that confirm is what creates it — a test that
// only checked "confirm works" would miss the entire point of the acceptance criterion.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, resetTestDatabase, seedPlan, seedStore } from "../fixtures/db-test-helpers";
import { signUpAndLogin } from "../fixtures/http-test-client";
import { makeNfeItem, makeNfeXml, makeMalformedNfeXml } from "../fixtures/factories/nfe.factory";

async function stockMovementCount(db: Client, tenantId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::int AS count FROM stock_movements WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(rows[0]?.count ?? 0);
}

describe("NF-e import: no stock mutation before explicit confirm (AC-001, ADR-005)", () => {
  let planId: string;
  let db: Client;

  beforeAll(async () => {
    await resetTestDatabase();
    const admin = adminClient();
    await admin.connect();
    try {
      const plan = await seedPlan(admin, {});
      planId = plan.id;
    } finally {
      await admin.end();
    }
    db = adminClient();
    await db.connect();
  }, 30_000);

  afterAll(async () => {
    await db?.end();
  });

  it("uploading a recognized-item XML creates a pending_review import with matched items, and ZERO stock_movements", async () => {
    const { client, tenantId } = await signUpAndLogin(planId);
    const storeRes = await client.post<{ id: string }>("/api/stores", { name: "Loja Principal", type: "loja" });
    const storeId = storeRes.body.id;

    // The product must already exist in the catalog, matched by barcode (cEAN), for `status: matched`.
    const item = makeNfeItem({ cEAN: "7891000100103" });
    await client.post("/api/products", {
      sku: "ARROZ-5KG",
      name: "Arroz Branco 5kg",
      unitOfMeasure: "UN",
      barcode: item.cEAN,
    });

    const xml = makeNfeXml([item]);
    const form = new FormData();
    form.set("storeId", storeId);
    form.set("file", new Blob([xml], { type: "application/xml" }), "nfe.xml");

    const upload = await client.postMultipart<{ importId: string }>("/api/nfe-imports", form);
    expect(upload.status).toBe(202);
    const importId = upload.body.importId;

    // Poll (per ADR-005 §4: async job, UI polls status) until the parse job settles.
    let status = "pending_parse";
    let attempts = 0;
    let importBody: { status: string; items: { status: string; cEAN: string | null }[] } | undefined;
    while (status === "pending_parse" && attempts < 20) {
      const poll = await client.get<typeof importBody>(`/api/nfe-imports/${importId}`);
      importBody = poll.body ?? undefined;
      status = importBody?.status ?? "pending_parse";
      attempts += 1;
      if (status === "pending_parse") await new Promise((r) => setTimeout(r, 250));
    }

    expect(status).toBe("pending_review");
    expect(importBody?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "matched", cEAN: item.cEAN })]),
    );

    // THE critical negative assertion — this is what AC-001 is actually about.
    expect(await stockMovementCount(db, tenantId)).toBe(0);
  }, 15_000);

  it("an item with no catalog match is flagged unmatched, and confirming with unmatched items still pending is rejected (409)", async () => {
    const { client } = await signUpAndLogin(planId);
    const storeRes = await client.post<{ id: string }>("/api/stores", { name: "Loja", type: "loja" });
    const storeId = storeRes.body.id;

    const unknownItem = makeNfeItem({ cEAN: "0000000000000", xProd: "Produto Desconhecido do Fornecedor" });
    const xml = makeNfeXml([unknownItem]);
    const form = new FormData();
    form.set("storeId", storeId);
    form.set("file", new Blob([xml], { type: "application/xml" }), "nfe.xml");

    const upload = await client.postMultipart<{ importId: string }>("/api/nfe-imports", form);
    const importId = upload.body.importId;

    let importBody: { status: string; items: { status: string }[] } | undefined;
    for (let i = 0; i < 20 && (!importBody || importBody.status === "pending_parse"); i++) {
      const poll = await client.get<typeof importBody>(`/api/nfe-imports/${importId}`);
      importBody = poll.body ?? undefined;
      if (importBody?.status === "pending_parse") await new Promise((r) => setTimeout(r, 250));
    }
    expect(importBody?.items[0]?.status).toBe("unmatched");

    const confirm = await client.post(`/api/nfe-imports/${importId}/confirm`, { items: [] });
    expect(confirm.status).toBe(409);
  }, 15_000);

  it("explicit confirm creates stock_movements (type=entrada_nfe) matching item quantities, and only then", async () => {
    const { client, tenantId } = await signUpAndLogin(planId);
    const storeRes = await client.post<{ id: string }>("/api/stores", { name: "Loja", type: "loja" });
    const storeId = storeRes.body.id;

    const item = makeNfeItem({ cEAN: "7891000100103", qCom: 15 });
    await client.post("/api/products", { sku: "SKU-CONFIRM", name: item.xProd, unitOfMeasure: "UN", barcode: item.cEAN });

    const form = new FormData();
    form.set("storeId", storeId);
    form.set("file", new Blob([makeNfeXml([item])], { type: "application/xml" }), "nfe.xml");
    const upload = await client.postMultipart<{ importId: string }>("/api/nfe-imports", form);
    const importId = upload.body.importId;

    let importBody: { status: string; items: { id: string; status: string }[] } | undefined;
    for (let i = 0; i < 20 && (!importBody || importBody.status === "pending_parse"); i++) {
      const poll = await client.get<typeof importBody>(`/api/nfe-imports/${importId}`);
      importBody = poll.body ?? undefined;
      if (importBody?.status === "pending_parse") await new Promise((r) => setTimeout(r, 250));
    }
    expect(await stockMovementCount(db, tenantId)).toBe(0); // still zero right before confirm

    const confirm = await client.post(`/api/nfe-imports/${importId}/confirm`, { items: [] });
    expect(confirm.status).toBe(200);

    const { rows } = await db.query<{ type: string; quantity: number }>(
      `SELECT type, quantity FROM stock_movements WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows).toEqual([expect.objectContaining({ type: "entrada_nfe", quantity: 15 })]);

    const importStatus = await client.get<{ status: string }>(`/api/nfe-imports/${importId}`);
    expect(importStatus.body.status).toBe("confirmed");
  }, 15_000);

  it("a malformed XML fails the async parse job with status=failed, and never creates any stock movement", async () => {
    const { client, tenantId } = await signUpAndLogin(planId);
    const storeRes = await client.post<{ id: string }>("/api/stores", { name: "Loja", type: "loja" });
    const storeId = storeRes.body.id;

    const form = new FormData();
    form.set("storeId", storeId);
    form.set("file", new Blob([makeMalformedNfeXml()], { type: "application/xml" }), "malformed.xml");
    const upload = await client.postMultipart<{ importId: string }>("/api/nfe-imports", form);
    const importId = upload.body.importId;

    let status = "pending_parse";
    for (let i = 0; i < 20 && status === "pending_parse"; i++) {
      const poll = await client.get<{ status: string }>(`/api/nfe-imports/${importId}`);
      status = poll.body?.status ?? "pending_parse";
      if (status === "pending_parse") await new Promise((r) => setTimeout(r, 250));
    }

    expect(status).toBe("failed");
    expect(await stockMovementCount(db, tenantId)).toBe(0);
  }, 15_000);
});
