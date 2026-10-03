import { afterEach, describe, expect, it, vi } from "vitest";
import { VindiProvider } from "./vindi";

const provider = new VindiProvider({ apiKey: "private-test-key", webhookSecret: "webhook-test-secret", pixQrPollDelayMs: 0 });

const billingAddress = {
  zipcode: "01310100",
  street: "Avenida Paulista",
  number: "1000",
  complement: "Sala 12",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

const pixInput = {
  tenantId: "tenant-uuid",
  planId: "local-plan-uuid",
  gatewayPlanId: "521747",
  customerEmail: "admin@example.com",
  customerName: "Loja Teste",
  customerTaxId: "123.456.789-01",
  billingAddress,
};

const expectedVindiAddress = {
  street: "Avenida Paulista",
  number: "1000",
  additional_details: "Sala 12",
  zipcode: "01310100",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
  country: "BR",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function subscriptionResponse(charges: unknown[] = [{ last_transaction: { gateway_response_fields: { qrcode_original_path: "000201pix" } } }]) {
  return json({
    subscription: { id: 88, status: "active" },
    bill: {
      id: 99,
      amount: "149.0",
      status: "pending",
      due_at: "2026-10-05T23:59:59-03:00",
      url: "https://sandbox-app.vindi.com.br/customer/bills/99?token=opaque",
      charges,
    },
  }, 201);
}

function call(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined };
}

afterEach(() => vi.unstubAllGlobals());

describe("VindiProvider", () => {
  it("cria cliente com endereço, assinatura Pix recorrente e devolve o link/QR da primeira fatura", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ customers: [] }))
      .mockResolvedValueOnce(json({ customer: { id: 42 } }, 201))
      .mockResolvedValueOnce(subscriptionResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.createRecurringPixCharge(pixInput);

    expect(result.gatewaySubscriptionId).toBe("88");
    expect(result.gatewayCustomerId).toBe("42");
    expect(result.status).toBe("pending");
    expect(result.initialCharge).toMatchObject({
      gatewayChargeId: "99",
      amountCents: 14900,
      pixQrCode: "000201pix",
      boletoUrl: "https://sandbox-app.vindi.com.br/customer/bills/99?token=opaque",
    });

    const customer = call(fetchMock, 1);
    expect(customer.method).toBe("POST");
    expect(customer.url).toMatch(/\/customers$/);
    expect(customer.body).toEqual({
      name: "Loja Teste",
      email: "admin@example.com",
      registry_code: "12345678901",
      code: "tenant-uuid",
      address: expectedVindiAddress,
    });
    expect(call(fetchMock, 2).body).toMatchObject({ plan_id: 521747, customer_id: 42, payment_method_code: "pix", code: "tenant-uuid" });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: `Basic ${Buffer.from("private-test-key:").toString("base64")}` });
  });

  it("omite complemento e bairro vazios no endereço enviado à Vindi", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ customers: [] }))
      .mockResolvedValueOnce(json({ customer: { id: 42 } }, 201))
      .mockResolvedValueOnce(subscriptionResponse());
    vi.stubGlobal("fetch", fetchMock);

    await provider.createRecurringPixCharge({ ...pixInput, billingAddress: { ...billingAddress, complement: null, neighborhood: "", state: "sp", zipcode: "01310-100" } });

    expect(call(fetchMock, 1).body?.address).toEqual({
      street: "Avenida Paulista",
      number: "1000",
      zipcode: "01310100",
      city: "São Paulo",
      state: "SP",
      country: "BR",
    });
  });

  it("atualiza o endereço do cliente existente com PUT antes de criar a assinatura", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ customers: [{ id: 42, code: "tenant-uuid" }] }))
      .mockResolvedValueOnce(json({ customer: { id: 42 } }))
      .mockResolvedValueOnce(subscriptionResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.createRecurringPixCharge(pixInput);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(decodeURIComponent(call(fetchMock, 0).url)).toContain("query=code=tenant-uuid");
    const update = call(fetchMock, 1);
    expect(update.method).toBe("PUT");
    expect(update.url).toMatch(/\/customers\/42$/);
    expect(update.body).toEqual({ address: expectedVindiAddress });
    const subscription = call(fetchMock, 2);
    expect(subscription.url).toMatch(/\/subscriptions$/);
    expect(subscription.body).toMatchObject({ customer_id: 42 });
    expect(result.gatewayCustomerId).toBe("42");
  });

  it("não reaproveita cliente cujo code não é o do tenant (busca ignorada pela Vindi)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ customers: [{ id: 7, code: "outro-tenant" }] }))
      .mockResolvedValueOnce(json({ customer: { id: 42 } }, 201))
      .mockResolvedValueOnce(subscriptionResponse());
    vi.stubGlobal("fetch", fetchMock);

    await provider.createRecurringPixCharge(pixInput);

    expect(call(fetchMock, 1).method).toBe("POST");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/customers/7"))).toBe(false);
    expect(call(fetchMock, 2).body).toMatchObject({ customer_id: 42 });
  });

  it("recusa Pix sem endereço de cobrança antes de criar qualquer coisa na Vindi", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { billingAddress: _omitted, ...withoutAddress } = pixInput;

    await expect(provider.createRecurringPixCharge(withoutAddress)).rejects.toThrow(/endereço de cobrança/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consulta a fatura até o QR Code Pix aparecer quando a assinatura volta sem ele", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ customers: [{ id: 42, code: "tenant-uuid" }] }))
      .mockResolvedValueOnce(json({ customer: { id: 42 } }))
      .mockResolvedValueOnce(subscriptionResponse([{ last_transaction: { gateway_response_fields: {} } }]))
      .mockResolvedValueOnce(json({ bill: { id: 99, charges: [{ last_transaction: { gateway_response_fields: {} } }] } }))
      .mockResolvedValueOnce(json({ bill: { id: 99, charges: [{ last_transaction: { gateway_response_fields: { qrcode_original_path: "000201late" } } }] } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.createRecurringPixCharge(pixInput);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(call(fetchMock, 3)).toMatchObject({ method: "GET" });
    expect(call(fetchMock, 3).url).toMatch(/\/bills\/99$/);
    expect(result.initialCharge?.pixQrCode).toBe("000201late");
  });

  it("desiste do polling após 5 tentativas e mantém o link da fatura", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ customers: [{ id: 42, code: "tenant-uuid" }] }))
      .mockResolvedValueOnce(json({ customer: { id: 42 } }))
      .mockResolvedValueOnce(subscriptionResponse([]))
      .mockImplementation(async () => json({ bill: { id: 99, charges: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.createRecurringPixCharge(pixInput);

    expect(fetchMock).toHaveBeenCalledTimes(3 + 5);
    expect(result.initialCharge?.pixQrCode).toBeUndefined();
    expect(result.initialCharge?.boletoUrl).toContain("/customer/bills/99");
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
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

  it("não inventa valor quando a fatura do webhook vem sem amount (nem R$ 0,00)", () => {
    for (const amount of [undefined, "", "abc", "0"]) {
      const created = provider.parseWebhookEvent({
        event: { type: "bill_created", data: { bill: { id: 99, amount, payment_method: { code: "pix" }, subscription: { id: 88 } } } },
      });
      expect(created.type).toBe("charge.created");
      expect(created).not.toHaveProperty("amountCents");
    }
  });

  it("lê o QR Code Pix da cobrança mais recente no bill_created", () => {
    const created = provider.parseWebhookEvent({
      event: {
        type: "bill_created",
        created_at: "2026-09-30T12:00:00-03:00",
        data: {
          bill: {
            id: 99,
            amount: "149.9",
            payment_method: { code: "pix" },
            subscription: { id: 88 },
            charges: [
              { last_transaction: { gateway_response_fields: {} } },
              { last_transaction: { gateway_response_fields: { qrcode_original_path: "000201bill" } } },
            ],
          },
        },
      },
    });
    expect(created).toMatchObject({ type: "charge.created", pixQrCode: "000201bill" });
  });

  it("traduz charge_created/charge_updated com QR em atualização do Pix da fatura", () => {
    for (const type of ["charge_created", "charge_updated"]) {
      const event = provider.parseWebhookEvent({
        event: {
          type,
          created_at: "2026-09-30T12:01:00-03:00",
          data: { charge: { id: 555, status: "pending", bill: { id: 99, url: "https://vindi.test/pay" }, last_transaction: { gateway_response_fields: { qrcode_original_path: "000201charge" } } } },
        },
      });
      expect(event).toEqual({
        type: "charge.pix_updated",
        gatewayEventId: `${type}-99-2026-09-30T12:01:00-03:00`,
        gatewayChargeId: "99",
        pixQrCode: "000201charge",
        paymentUrl: "https://vindi.test/pay",
      });
    }

    const withoutQr = provider.parseWebhookEvent({
      event: { type: "charge_updated", data: { charge: { id: 555, bill: { id: 99 }, last_transaction: { gateway_response_fields: {} } } } },
    });
    expect(withoutQr.type).toBe("ignored");
  });

  it("confere o segredo do webhook sem depender de cabeçalho da Vindi", () => {
    expect(provider.verifyWebhookSignature("{}", "webhook-test-secret")).toBe(true);
    expect(provider.verifyWebhookSignature("{}", "wrong-secret")).toBe(false);
  });
});
