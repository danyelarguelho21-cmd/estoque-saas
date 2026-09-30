import { afterEach, describe, expect, it, vi } from "vitest";
import { VindiProvider } from "./vindi";

const provider = new VindiProvider({ apiKey: "private-test-key", webhookSecret: "webhook-test-secret" });

afterEach(() => vi.unstubAllGlobals());

describe("VindiProvider", () => {
  it("cria assinatura Pix recorrente e devolve o link/QR da primeira fatura", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        subscription: { id: 88, status: "active" },
        bill: {
          id: 99,
          status: "pending",
          due_at: "2026-10-05T23:59:59-03:00",
          url: "https://sandbox-app.vindi.com.br/customer/bills/99?token=opaque",
          charges: [{ last_transaction: { gateway_response_fields: { qrcode_original_path: "000201pix" } } }],
        },
      }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.createRecurringPixCharge({
      tenantId: "tenant-uuid",
      planId: "local-plan-uuid",
      gatewayPlanId: "521747",
      customerEmail: "admin@example.com",
      customerName: "Loja Teste",
      customerTaxId: "12345678901",
    });

    expect(result.gatewaySubscriptionId).toBe("88");
    expect(result.gatewayCustomerId).toBe("42");
    expect(result.status).toBe("pending");
    expect(result.initialCharge).toMatchObject({
      gatewayChargeId: "99",
      pixQrCode: "000201pix",
      boletoUrl: "https://sandbox-app.vindi.com.br/customer/bills/99?token=opaque",
    });
    const request = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({ plan_id: 521747, customer_id: 42, payment_method_code: "pix", code: "tenant-uuid" });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: `Basic ${Buffer.from("private-test-key:").toString("base64")}` });
  });

  it("traduz fatura criada e fatura paga em eventos idempotentes por identificador", () => {
    const created = provider.parseWebhookEvent({
      event: {
        type: "bill_created",
        created_at: "2026-09-30T12:00:00-03:00",
        data: { bill: { id: 99, amount: "149.9", status: "pending", due_at: "2026-10-05T23:59:59-03:00", url: "https://vindi.test/pay", payment_method: { code: "pix" }, subscription: { id: 88 } } },
      },
    });
    expect(created).toMatchObject({ type: "charge.created", gatewayChargeId: "99", gatewaySubscriptionId: "88", amountCents: 14990, paymentMethod: "pix" });

    const paid = provider.parseWebhookEvent({
      event: { type: "bill_paid", created_at: "2026-09-30T12:10:00-03:00", data: { bill: { id: 99 } } },
    });
    expect(paid).toMatchObject({ type: "charge.paid", gatewayChargeId: "99", paidAt: "2026-09-30T12:10:00-03:00" });
  });

  it("confere o segredo do webhook sem depender de cabeçalho da Vindi", () => {
    expect(provider.verifyWebhookSignature("{}", "webhook-test-secret")).toBe(true);
    expect(provider.verifyWebhookSignature("{}", "wrong-secret")).toBe(false);
  });
});
