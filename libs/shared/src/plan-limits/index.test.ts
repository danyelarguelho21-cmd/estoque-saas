import { describe, expect, it } from "vitest";
import { PlanLimitReachedError } from "../errors/index";
import { assertWithinPlanLimit, fitsWithinPlan, type PlanLimits } from "./index";

const limits: PlanLimits = { maxProducts: 100, maxUsers: 5, maxStores: 2 };

describe("assertWithinPlanLimit", () => {
  it("allows creation when under the limit", () => {
    expect(() => assertWithinPlanLimit("products", 99, limits)).not.toThrow();
  });

  it("throws PlanLimitReachedError when creation would exceed the limit", () => {
    expect(() => assertWithinPlanLimit("products", 100, limits)).toThrow(PlanLimitReachedError);
  });

  it("throws exactly at the boundary (limit is inclusive of max)", () => {
    expect(() => assertWithinPlanLimit("users", 4, limits)).not.toThrow();
    expect(() => assertWithinPlanLimit("users", 5, limits)).toThrow(PlanLimitReachedError);
  });
});

describe("fitsWithinPlan", () => {
  it("returns true when all current counts fit the target plan", () => {
    expect(fitsWithinPlan({ products: 10, users: 2, stores: 1 }, limits)).toBe(true);
  });

  it("returns violating resources when a downgrade would exceed the target plan", () => {
    const result = fitsWithinPlan({ products: 150, users: 10, stores: 1 }, limits);
    expect(result).toEqual(["products", "users"]);
  });
});
