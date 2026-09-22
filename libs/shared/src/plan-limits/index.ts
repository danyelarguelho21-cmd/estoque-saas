// Enforcement de limites de plano (produtos/usuários/lojas) — função pura, sem I/O,
// para ser testável sem banco. A camada de domínio (modules/catalog, modules/auth,
// modules/tenants) busca as contagens atuais + limites do plano e chama checkPlanLimit().

import { PlanLimitReachedError } from "../errors/index";

export type PlanLimitResource = "products" | "users" | "stores";

export interface PlanLimits {
  maxProducts: number;
  maxUsers: number;
  maxStores: number;
}

const LIMIT_KEY_BY_RESOURCE: Record<PlanLimitResource, keyof PlanLimits> = {
  products: "maxProducts",
  users: "maxUsers",
  stores: "maxStores",
};

const RESOURCE_LABEL: Record<PlanLimitResource, string> = {
  products: "produtos",
  users: "usuários",
  stores: "lojas",
};

// Lança PlanLimitReachedError se `currentCount + increment` excede o limite do plano.
// increment default = 1 (criação de um novo recurso).
export function assertWithinPlanLimit(
  resource: PlanLimitResource,
  currentCount: number,
  limits: PlanLimits,
  increment = 1,
): void {
  const limitKey = LIMIT_KEY_BY_RESOURCE[resource];
  const max = limits[limitKey];
  if (currentCount + increment > max) {
    throw new PlanLimitReachedError(
      `Limite de ${RESOURCE_LABEL[resource]} do plano atingido (${max}).`,
      { resource, currentCount, max },
    );
  }
}

export interface ResourceCounts {
  products: number;
  users: number;
  stores: number;
}

// Usado por downgrade de plano (billing): verifica se as contagens ATUAIS do tenant
// cabem no plano ALVO, sem considerar incremento — usado para bloquear downgrade inválido.
export function fitsWithinPlan(counts: ResourceCounts, target: PlanLimits): true | PlanLimitResource[] {
  const violations: PlanLimitResource[] = [];
  if (counts.products > target.maxProducts) violations.push("products");
  if (counts.users > target.maxUsers) violations.push("users");
  if (counts.stores > target.maxStores) violations.push("stores");
  return violations.length === 0 ? true : violations;
}
