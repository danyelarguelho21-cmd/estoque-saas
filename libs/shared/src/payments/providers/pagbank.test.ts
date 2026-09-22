import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PagBankProvider } from "./pagbank";

const provider = new PagBankProvider({
  apiKey: "test-key",
  baseUrl: "https://sandbox.api.pagseguro.com",
  webhookSecret: "account-token-123",
});

describe("PagBankProvider.verifyWebhookSignature", () => {
  it("accepts a signature computed as sha256(secret-payload) over the RAW body", () => {
    const rawPayload = '{"id":"ORDE_1","charges":[{"id":"CHAR_1","status":"PAID"}]}';
    const signature = createHash("sha256").update(`account-token-123-${rawPayload}`).digest("hex");
    expect(provider.verifyWebhookSignature(rawPayload, signature)).toBe(true);
  });

  it("rejects a tampered payload even if the signature format matches", () => {
    const rawPayload = '{"id":"ORDE_1","charges":[{"id":"CHAR_1","status":"PAID"}]}';
    const signature = createHash("sha256").update(`account-token-123-${rawPayload}`).digest("hex");
    const tampered = rawPayload.replace("PAID", "DECLINED");
    expect(provider.verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  it("rejects when re-serialization changes whitespace (byte-for-byte requirement)", () => {
    const rawPayload = '{"id":"ORDE_1"}';
    const signature = createHash("sha256").update(`account-token-123-${rawPayload}`).digest("hex");
    const reformatted = '{ "id": "ORDE_1" }';
    expect(provider.verifyWebhookSignature(reformatted, signature)).toBe(false);
  });

  it("rejects a garbage signature", () => {
    expect(provider.verifyWebhookSignature('{"a":1}', "not-a-real-signature")).toBe(false);
  });
});

describe("PagBankProvider constructor", () => {
  it("fails fast when apiKey is missing", () => {
    expect(() => new PagBankProvider({ apiKey: "", baseUrl: "x", webhookSecret: "y" })).toThrow(/apiKey/);
  });

  it("fails fast when webhookSecret is missing", () => {
    expect(() => new PagBankProvider({ apiKey: "x", baseUrl: "y", webhookSecret: "" })).toThrow(/webhookSecret/);
  });
});

describe("PagBankProvider.parseWebhookEvent", () => {
  it("normalizes a subscription.canceled event", () => {
    const event = provider.parseWebhookEvent({
      event: "subscription.canceled",
      id: "evt-1",
      resource: { id: "SUBS_ABC" },
    });
    expect(event).toEqual({
      type: "subscription.canceled",
      gatewayEventId: "evt-1",
      gatewaySubscriptionId: "SUBS_ABC",
    });
  });

  it("normalizes an order webhook with a PAID charge to charge.paid", () => {
    const event = provider.parseWebhookEvent({
      id: "ORDE_1",
      charges: [{ id: "CHAR_1", status: "PAID" }],
    });
    expect(event.type).toBe("charge.paid");
    if (event.type === "charge.paid") {
      expect(event.gatewayChargeId).toBe("CHAR_1");
    }
  });

  it("normalizes an order webhook with a DECLINED charge to charge.failed", () => {
    const event = provider.parseWebhookEvent({
      id: "ORDE_2",
      charges: [{ id: "CHAR_2", status: "DECLINED" }],
    });
    expect(event.type).toBe("charge.failed");
  });

  it("throws on an unrecognized payload shape", () => {
    expect(() => provider.parseWebhookEvent({ foo: "bar" })).toThrow();
  });
});
