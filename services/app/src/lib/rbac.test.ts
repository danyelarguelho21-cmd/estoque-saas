import { describe, expect, it } from "vitest";
import { can } from "./rbac";

describe("rbac.can", () => {
  it("grants admin every permission tenant roles have", () => {
    expect(can("admin", "billing:manage")).toBe(true);
    expect(can("admin", "users:manage")).toBe(true);
    expect(can("admin", "sales:create")).toBe(true);
  });

  it("denies operador access to billing and user management (BRD Business Rules)", () => {
    expect(can("operador", "billing:manage")).toBe(false);
    expect(can("operador", "users:manage")).toBe(false);
    expect(can("operador", "catalog:manage")).toBe(true);
  });

  it("restricts vendedor to sales and denies catalog cost visibility", () => {
    expect(can("vendedor", "sales:create")).toBe(true);
    expect(can("vendedor", "sales:view")).toBe(true);
    expect(can("vendedor", "catalog:view-cost")).toBe(false);
    expect(can("vendedor", "stock:entry")).toBe(false);
  });

  it("denies everything when role is undefined (unauthenticated)", () => {
    expect(can(undefined, "sales:view")).toBe(false);
  });
});
