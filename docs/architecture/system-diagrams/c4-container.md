# C4 — Container

```mermaid
C4Container
  title estoque-saas — Diagrama de Container

  Person(user, "Usuário (admin/operador/vendedor)", "")
  Person(saas_admin, "Admin do SaaS", "")

  System_Boundary(estoque_saas, "estoque-saas") {
    Container(web, "App Next.js", "Node.js 24 / Next.js 16", "UI (React) + API (Route Handlers). Módulos: auth, catalog, stock, sales, billing, admin")
    Container(worker, "Worker de jobs", "Node.js 24 / BullMQ", "Parsing de XML de NF-e, geração de cobranças, alertas de validade/estoque baixo")
    ContainerDb(postgres, "PostgreSQL 18", "Banco relacional", "Schema único, RLS por tenant_id (ADR-002)")
    ContainerDb(redis, "Redis 7", "Fila + cache", "Fila BullMQ, cache de sessão/consulta")
    Container(storage, "File Storage", "Volume local (dev) / S3-compatible (prod)", "XMLs de NF-e enviados")
  }

  System_Ext(pagbank, "PagBank/PagSeguro", "Gateway de pagamento")

  Rel(user, web, "HTTPS")
  Rel(saas_admin, web, "HTTPS (painel /admin, sessão separada)")
  Rel(web, postgres, "SQL (Prisma, contexto RLS por request)")
  Rel(web, redis, "Enfileira jobs, lê cache")
  Rel(web, storage, "Grava XML enviado")
  Rel(worker, redis, "Consome jobs")
  Rel(worker, postgres, "SQL (Prisma, contexto RLS por job)")
  Rel(worker, storage, "Lê XML para parsing")
  Rel(web, pagbank, "Cria cobrança / assinatura", "HTTPS/REST")
  Rel(pagbank, web, "Webhook de pagamento", "HTTPS/REST")
```

## Notas
- `web` e `worker` compartilham a mesma imagem Docker e base de código (monolito modular, ADR-001); diferem apenas no `CMD` de entrada.
- Nenhum container tem acesso direto à internet exceto `web` (inbound) e as chamadas outbound de `web`/`worker` ao PagBank — superfície de ataque mínima.
- Em produção (VPS via Docker Compose), todos os containers compartilham uma rede Docker privada; apenas `web` expõe porta pública (atrás de um reverse proxy/TLS, fora do escopo desta arquitetura de aplicação — tratado no SHIP).
