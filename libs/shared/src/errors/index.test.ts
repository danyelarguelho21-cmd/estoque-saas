import { describe, expect, it } from "vitest";
import {
  ConflictError,
  NotFoundError,
  PlanLimitReachedError,
  RateLimitedError,
  ValidationError,
  toErrorResponse,
} from "./index";

describe("toErrorResponse", () => {
  it("maps ValidationError to 400 with code VALIDATION_ERROR", () => {
    const { status, body } = toErrorResponse(new ValidationError("campo obrigatório"), "t-1");
    expect(status).toBe(400);
    expect(body).toEqual({ code: "VALIDATION_ERROR", message: "campo obrigatório", trace_id: "t-1" });
  });

  it("maps NotFoundError to 404", () => {
    const { status, body } = toErrorResponse(new NotFoundError(), "t-2");
    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("maps ConflictError to 409 and preserves details", () => {
    const { status, body } = toErrorResponse(new ConflictError("estoque insuficiente", { productId: "p1" }), "t-3");
    expect(status).toBe(409);
    expect(body.details).toEqual({ productId: "p1" });
  });

  it("maps PlanLimitReachedError to 409 with code PLAN_LIMIT_REACHED", () => {
    const { status, body } = toErrorResponse(new PlanLimitReachedError("limite de produtos atingido"), "t-4");
    expect(status).toBe(409);
    expect(body.code).toBe("PLAN_LIMIT_REACHED");
  });

  it("never leaks internal error messages for unknown errors", () => {
    const { status, body } = toErrorResponse(new Error("stack trace sensível / segredo"), "t-5");
    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).not.toContain("segredo");
  });

  it("maps RateLimitedError to 429 with code RATE_LIMITED (security-engineer finding H-5)", () => {
    const { status, body } = toErrorResponse(new RateLimitedError(), "t-6");
    expect(status).toBe(429);
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("always includes the trace_id passed in", () => {
    const { body } = toErrorResponse(new Error("x"), "trace-xyz");
    expect(body.trace_id).toBe("trace-xyz");
  });
});
