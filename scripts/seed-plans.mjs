#!/usr/bin/env node
// scripts/seed-plans.mjs
//
// Popula a tabela `plans` (Básico/Pro/Enterprise) — GAP real encontrado testando o fluxo de
// onboarding de ponta a ponta: /api/auth/signup exige um `planId` válido (api/openapi/auth.yaml),
// mas nada no pipeline de BUILD criava as linhas de `plans`. Sem isto, nenhum tenant consegue se
// cadastrar. Idempotente (upsert por `name`) — seguro rodar de novo.
//
// Valores de mensalidade/limite são os mesmos decididos na entrevista de CEO (ver
// Claude-Production-Grade-Suite/product-manager/BRD/brd.md, seção "Modelo de planos" /
// research-notes.md) — ajustar aqui é uma decisão comercial, não técnica.
//
// Uso: node --env-file=.env scripts/seed-plans.mjs

import { PrismaClient } from "@prisma/client";

const UNLIMITED = 999999999;

const plans = [
  {
    name: "Básico",
    priceCents: 9900,
    maxProducts: 500,
    maxUsers: 2,
    maxStores: 1,
    features: { perishableTracking: true, csvImport: true, nfeImport: true },
  },
  {
    name: "Pro",
    priceCents: 24900,
    maxProducts: 5000,
    maxUsers: 10,
    maxStores: 3,
    features: { perishableTracking: true, csvImport: true, nfeImport: true, dashboardAdvanced: true },
  },
  {
    name: "Enterprise",
    priceCents: 0, // sob consulta — cobrança negociada fora do fluxo self-service de /api/auth/signup
    maxProducts: UNLIMITED,
    maxUsers: UNLIMITED,
    maxStores: UNLIMITED,
    features: { perishableTracking: true, csvImport: true, nfeImport: true, dashboardAdvanced: true, prioritySupport: true },
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const plan of plans) {
      const existing = await prisma.plan.findFirst({ where: { name: plan.name } });
      if (existing) {
        await prisma.plan.update({ where: { id: existing.id }, data: plan });
        console.log(`[seed-plans] atualizado: ${plan.name} (${existing.id})`);
      } else {
        const created = await prisma.plan.create({ data: plan });
        console.log(`[seed-plans] criado: ${plan.name} (${created.id})`);
      }
    }
    console.log("[seed-plans] OK.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[seed-plans] falhou:", err);
  process.exit(1);
});
