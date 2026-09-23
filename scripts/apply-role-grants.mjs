#!/usr/bin/env node
// scripts/apply-role-grants.mjs
//
// Aplica schemas/migrations/0003_app_role_and_grants.sql e 0004_auth_lookup_function.sql contra o
// banco apontado por DATABASE_URL (deve ser a role ADMINISTRATIVA — a mesma usada por
// `prisma migrate deploy`, nunca app_user). Roda DEPOIS de `prisma migrate deploy` (as tabelas
// precisam existir para os GRANTs funcionarem). Ver security-engineer finding C-1/C-2 e o
// cabeçalho de cada .sql.
//
// Não depende do cliente `psql` estar instalado (o container da app não o inclui) — usa o
// @prisma/client já presente no projeto para abrir a conexão administrativa.
//
// Uso: APP_DB_PASSWORD=<senha-forte> DATABASE_URL=<conexão-admin> node scripts/apply-role-grants.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlFiles = [
  "0008_enable_row_level_security.sql",
  "0003_app_role_and_grants.sql",
  "0004_auth_lookup_function.sql",
  "0009_auth_lookup_tenant_name.sql", // DROP+CREATE de 0004 com tenant_name — deve rodar DEPOIS
  "0005_billing_webhook_lookup_function.sql",
  "0006_platform_admin_role.sql",
  "0007_platform_list_active_tenants_function.sql",
  "0010_role_timeouts.sql", // depende de 0003/0006 já terem criado as roles
].map((f) =>
  path.join(__dirname, "..", "schemas", "migrations", f),
);

function splitStatements(sql) {
  // Divide em statements top-level por ";", preservando blocos DO $$ ... $$; (que contêm ";"
  // internamente) como uma unidade atômica. Suficiente para o SQL controlado deste repositório —
  // não é um parser SQL genérico.
  const statements = [];
  let buffer = "";
  let inDollarBlock = false;
  const lines = sql.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) continue;
    buffer += line + "\n";
    const dollarMatches = (line.match(/\$\$/g) ?? []).length;
    if (dollarMatches % 2 === 1) {
      inDollarBlock = !inDollarBlock;
    }
    // Comentário inline no fim da linha (ex: "GRANT ...; -- nota") faz `trimmed` não terminar em
    // ";" mesmo quando a linha É o fim de um statement — remove o comentário só para ESTA checagem
    // (o buffer enviado ao Postgres mantém a linha original, comentário incluso, inofensivo).
    const codeOnly = trimmed.replace(/--.*$/, "").trim();
    if (!inDollarBlock && codeOnly.endsWith(";")) {
      const stmt = buffer.trim();
      if (stmt.length > 0) statements.push(stmt);
      buffer = "";
    }
  }
  const rest = buffer.trim();
  if (rest.length > 0) statements.push(rest);
  return statements;
}

async function main() {
  const appDbPassword = process.env.APP_DB_PASSWORD;
  const platformAdminDbPassword = process.env.PLATFORM_ADMIN_DB_PASSWORD;
  if (!appDbPassword) {
    console.error("[apply-role-grants] ERRO: APP_DB_PASSWORD não definida — abortando (nunca criar role sem senha forte).");
    process.exit(1);
  }
  if (!platformAdminDbPassword) {
    console.error("[apply-role-grants] ERRO: PLATFORM_ADMIN_DB_PASSWORD não definida — abortando.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    let total = 0;
    for (const sqlPath of sqlFiles) {
      const rawSql = readFileSync(sqlPath, "utf8")
        .replaceAll("__APP_DB_PASSWORD__", appDbPassword)
        .replaceAll("__PLATFORM_ADMIN_DB_PASSWORD__", platformAdminDbPassword);
      const statements = splitStatements(rawSql);
      for (const stmt of statements) {
        await prisma.$executeRawUnsafe(stmt);
      }
      total += statements.length;
      console.log(`[apply-role-grants] aplicado ${path.basename(sqlPath)} (${statements.length} statements).`);
    }
    console.log(`[apply-role-grants] OK — ${total} statements aplicados no total (role app_user + grants + função de login).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[apply-role-grants] falhou:", err);
  process.exit(1);
});
