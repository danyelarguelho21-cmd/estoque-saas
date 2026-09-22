import { describe, expect, it } from "vitest";
import { can, isRole } from "./index";

describe("rbac", () => {
  it("isRole accepts only known roles", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("operador")).toBe(true);
    expect(isRole("vendedor")).toBe(true);
    expect(isRole("superadmin")).toBe(false);
    expect(isRole(42)).toBe(false);
  });

  it("admin can manage billing, vendedor cannot", () => {
    expect(can("admin", "billing:manage")).toBe(true);
    expect(can("vendedor", "billing:manage")).toBe(false);
    expect(can("operador", "billing:manage")).toBe(false);
  });

  it("vendedor can write sales but not catalog", () => {
    expect(can("vendedor", "sales:write")).toBe(true);
    expect(can("vendedor", "catalog:write")).toBe(false);
  });

  it("operador can write stock and catalog but not manage users", () => {
    expect(can("operador", "stock:write")).toBe(true);
    expect(can("operador", "catalog:write")).toBe(true);
    expect(can("operador", "users:manage")).toBe(false);
  });
});
