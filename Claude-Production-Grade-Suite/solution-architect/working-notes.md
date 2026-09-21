# Solution Architect — Notas de trabalho

## Entradas lidas
- `Claude-Production-Grade-Suite/product-manager/BRD/brd.md`, `research-notes.md`, `constraints.md`
- `Claude-Production-Grade-Suite/.orchestrator/settings.md` (engajamento Standard)

## Discovery (4 perguntas, Standard)
1. Escala/time → Solo/dupla, <1K tenants no 1º ano → **monolito modular** (ADR-001).
2. Isolamento multi-tenant → **Schema compartilhado + RLS** (ADR-002).
3. Alvo de deploy → **VPS via Docker Compose** (influencia SHIP/IaC futuro).
4. Tempo real → **Não necessário** (polling leve) → sem infraestrutura de websocket no MVP.

## Pesquisa de freshness (set/2026)
- Next.js 16.3.x (Active LTS), Node.js 24.x (Active LTS), PostgreSQL 18.x — verificados via WebSearch.
- Padrão de mercado 2026 para RLS multi-tenant com Prisma: schema compartilhado + `set_config` por
  transação + Prisma Client Extension — usado como base do ADR-002 e de `libs/shared/src/db/client.ts`.

## Decisões que ficaram como TODO explícito para o BUILD
- Implementação real das chamadas ao PagBank em `PagBankProvider` (contrato já fixado).
- Modelagem Prisma completa de `stock_movements`, `sales`, `nfe_imports`, `transfers`,
  `notifications` etc. — schema SQL de referência já completo em `schemas/migrations/0001_init.sql`;
  Prisma schema tem os modelos centrais (tenant, users, stores, billing, catalog, batches, audit)
  como exemplo do padrão a seguir, para não duplicar manutenção de ~20 tabelas em dois formatos
  antes do BUILD começar.
- Processors reais dos jobs BullMQ (`parse-nfe`, `generate-monthly-charge`, `scan-expiry-alerts`).
- Telas (UI) — apenas layout raiz e health checks foram scaffolded.

## Escopo não coberto (intencional)
- Emissão fiscal, app mobile/PDV, e-commerce — fora de escopo do MVP (ver BRD "Out of Scope").
