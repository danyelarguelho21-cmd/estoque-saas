// Módulo: admin — painel administrativo interno do SaaS (platform_admins), sessão SEPARADA
// (não tenant-scoped, não sujeita a RLS por tenant — ver modules/admin/session.ts).
// Fronteira: outros módulos e Route Handlers importam SOMENTE deste index.ts (ADR-001).
export { platformAdminLogin, platformAdminLogout, requirePlatformAdmin, type PlatformAdminContext } from "./auth";
export { listTenantsAdmin, suspendTenant, reactivateTenant, type ListTenantsAdminFilters } from "./tenants";
export { getPlatformMetrics, type PlatformMetrics } from "./metrics";
