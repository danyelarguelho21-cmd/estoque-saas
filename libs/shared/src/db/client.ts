import { Prisma, PrismaClient } from "@prisma/client";

// Cliente Prisma com contexto de tenant via RLS (ADR-002).
// withTenant() abre uma transação, seta app.tenant_id (escopo de transação via set_config(..., true)),
// executa o callback, e comita/rollback — toda query dentro do callback é automaticamente
// filtrada pelas políticas RLS do Postgres, mesmo que o código da aplicação esqueça um WHERE.
//
// IMPORTANTE (security-engineer finding C-1): este cliente runtime conecta com APP_DATABASE_URL
// (role restrita "app_user", NOBYPASSRLS — ver schemas/migrations/0003_app_role_and_grants.sql),
// NUNCA com DATABASE_URL (role administrativa/superuser usada apenas por `prisma migrate`). A
// imagem oficial `postgres` torna POSTGRES_USER superuser, e políticas RLS nunca se aplicam a um
// superuser — conectar com a role errada torna a RLS inteiramente inerte, mesmo com set_config
// correto. `schema.prisma` continua referenciando DATABASE_URL via env() apenas para satisfazer o
// `prisma generate`/`migrate` (que precisam de uma URL estática no arquivo); em runtime a URL real
// é sobrescrita abaixo via `datasources.db.url`.
const runtimeDatabaseUrl = process.env.APP_DATABASE_URL;
if (!runtimeDatabaseUrl) {
  // Falha aberta aqui seria pior que falhar cedo: preferimos um erro de boot claro a rodar
  // silenciosamente contra a role administrativa (bypassa RLS). Em ambientes sem Postgres
  // (ex: testes unitários que não tocam o banco), esta env var simplesmente não é lida —
  // PrismaClient só abre conexão de fato na primeira query.
  console.warn(
    "[db/client] APP_DATABASE_URL não definida — caindo para DATABASE_URL. " +
      "Isso NUNCA deve acontecer em produção: DATABASE_URL é a role administrativa " +
      "(superuser), que ignora Row-Level Security. Configure APP_DATABASE_URL (ver .env.example).",
  );
}

const basePrisma = new PrismaClient(
  runtimeDatabaseUrl ? { datasources: { db: { url: runtimeDatabaseUrl } } } : undefined,
);

export type TenantScopedClient = Prisma.TransactionClient;

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantScopedClient) => Promise<T>,
): Promise<T> {
  return basePrisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

// Generic version of the same contention fix as stock/balance.ts's lockStockRow (CR-1) —
// pg_advisory_xact_lock keyed on an arbitrary string, released automatically at
// commit/rollback. Use whenever a transaction reads a "is X due/needed?" state and then writes a
// derived row based on it, and two concurrent callers (a cron run overlapping a manual trigger, a
// double-submitted form, a retried job) could both read the same "due" state before either
// commits — the exact shape of bug CR-1/HI-4 fixed for stock and webhook idempotency
// respectively. Domain-specific helpers (like lockStockRow) may wrap this with a narrower key
// convention; this is the primitive for anywhere else that needs the same guarantee.
export async function lockOnKey(tx: TenantScopedClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

// Uso restrito: apenas rotinas de plataforma (platform_admins, plans) que não são tenant-scoped
// operam diretamente com basePrisma, sem set_config — essas tabelas estão fora do RLS (ADR-002).
export const platformPrisma = basePrisma;

// Segundo cliente, role "platform_admin_role" (BYPASSRLS explícito — ver
// schemas/migrations/0006_platform_admin_role.sql) — USO RESTRITO ao módulo admin
// (services/app/src/modules/admin), nunca importado por módulos tenant-scoped. O painel
// administrativo interno do SaaS precisa ler/agregar dados de TODOS os tenants (listar
// assinantes, MRR, inadimplência) — isso é uma exceção deliberada ao isolamento de tenant, não um
// bug: RLS existe para proteger tenants uns dos outros, não para esconder dados do dono da
// plataforma. A mesma separação de privilégio mínimo se aplica aqui: esta role só tem GRANT em
// exatamente as tabelas que o painel admin precisa (tenants, subscriptions, invoices,
// platform_admins), nunca DML amplo em toda tabela tenant-scoped.
const platformAdminDatabaseUrl = process.env.PLATFORM_ADMIN_DATABASE_URL;
export const platformAdminPrisma: PrismaClient = platformAdminDatabaseUrl
  ? new PrismaClient({ datasources: { db: { url: platformAdminDatabaseUrl } } })
  : basePrisma; // fallback de dev sem a role dedicada configurada — ver .env.example

// Usado pelos jobs de worker que varrem todos os tenants (generate-monthly-charge,
// scan-expiry-alerts) — ver schemas/migrations/0007_platform_list_active_tenants_function.sql.
// Devolve SOMENTE ids; cada tenant é então processado dentro do seu próprio withTenant().
export async function listActiveTenantIds(): Promise<string[]> {
  const rows = await platformPrisma.$queryRaw<Array<{ tenant_id: string }>>`
    SELECT * FROM platform_list_active_tenant_ids()
  `;
  return rows.map((r) => r.tenant_id);
}
