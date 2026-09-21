import { PrismaClient } from "@prisma/client";

// Cliente Prisma com contexto de tenant via RLS (ADR-002).
// withTenant() abre uma transação, seta app.tenant_id (escopo de transação via set_config(..., true)),
// executa o callback, e comita/rollback — toda query dentro do callback é automaticamente
// filtrada pelas políticas RLS do Postgres, mesmo que o código da aplicação esqueça um WHERE.

const basePrisma = new PrismaClient();

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>,
): Promise<T> {
  return basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

// Uso restrito: apenas rotinas de plataforma (platform_admins) que não são tenant-scoped
// operam diretamente com basePrisma, sem set_config — essas tabelas estão fora do RLS (ADR-002).
export const platformPrisma = basePrisma;
