#!/usr/bin/env node
// scripts/bootstrap-platform-admin.mjs
//
// Cria (ou atualiza a senha de) o primeiro platform_admin a partir de
// PLATFORM_ADMIN_BOOTSTRAP_EMAIL / PLATFORM_ADMIN_BOOTSTRAP_PASSWORD (.env.example) — sem isso,
// /api/platform-admin/login nunca teria uma linha para autenticar contra (mesmo problema de
// "ovo e galinha" resolvido para tenants pelo /api/auth/signup, mas platform_admins não tem um
// endpoint de self-service equivalente — é intencionalmente só provisionável por quem já tem
// acesso ao ambiente/infra, nunca por uma rota HTTP pública).
//
// Idempotente: se o e-mail já existe, apenas atualiza o hash de senha (permite rodar de novo
// após girar a senha do bootstrap). Roda contra DATABASE_URL (role administrativa) já que
// platform_admins não tem RLS (ADR-002) e o objetivo é justamente popular o dado inicial antes de
// qualquer outra role existir.
//
// Uso: node --env-file=.env scripts/bootstrap-platform-admin.mjs

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
  if (password.length < 8) {
    console.error("[bootstrap-platform-admin] PLATFORM_ADMIN_BOOTSTRAP_PASSWORD precisa ter ao menos 8 caracteres.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.platformAdmin.upsert({
      where: { email },
      create: { name: "Platform Admin", email, passwordHash },
      update: { passwordHash },
    });
    console.log(`[bootstrap-platform-admin] OK — platform_admin pronto: ${admin.email} (id ${admin.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bootstrap-platform-admin] falhou:", err);
  process.exit(1);
});
