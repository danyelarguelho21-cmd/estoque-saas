#!/usr/bin/env node
// scripts/bootstrap-platform-admin.mjs
//
// Provisiona o primeiro platform_admin a partir de
// PLATFORM_ADMIN_BOOTSTRAP_EMAIL / PLATFORM_ADMIN_BOOTSTRAP_PASSWORD (.env.example) — sem isso,
// /api/platform-admin/login nunca teria uma linha para autenticar contra (mesmo problema de
// "ovo e galinha" resolvido para tenants pelo /api/auth/signup, mas platform_admins não tem um
// endpoint de self-service equivalente — é intencionalmente só provisionável por quem já tem
// acesso ao ambiente/infra, nunca por uma rota HTTP pública).
//
// Idempotente e seguro em deploys repetidos: cria o admin só se ainda não existir. Não altera a
// senha existente durante um deploy normal. Para uma rotação explícita, passe --reset-password.
// Roda contra DATABASE_URL (role administrativa) já que
// platform_admins não tem RLS (ADR-002) e o objetivo é justamente popular o dado inicial antes de
// qualquer outra role existir.
//
// Uso: node --env-file=.env scripts/bootstrap-platform-admin.mjs [--reset-password]

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

async function main() {
  const email = process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) {
    console.error(
      "[bootstrap-platform-admin] PLATFORM_ADMIN_BOOTSTRAP_EMAIL/PASSWORD ausentes — nada a fazer. " +
        "Defina-os em .env para provisionar o primeiro admin da plataforma.",
    );
    process.exit(1);
  }
  if (password.length < 16) {
    console.error("[bootstrap-platform-admin] PLATFORM_ADMIN_BOOTSTRAP_PASSWORD precisa ter ao menos 16 caracteres.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.platformAdmin.findUnique({ where: { email } });
    if (existing && !process.argv.includes("--reset-password")) {
      console.log(`[bootstrap-platform-admin] admin já existe; senha preservada (id ${existing.id}).`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = existing
      ? await prisma.platformAdmin.update({ where: { email }, data: { passwordHash } })
      : await prisma.platformAdmin.create({ data: { name: "Platform Admin", email, passwordHash } });
    console.log(`[bootstrap-platform-admin] OK — platform_admin provisionado (id ${admin.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bootstrap-platform-admin] falhou:", err);
  process.exit(1);
});
