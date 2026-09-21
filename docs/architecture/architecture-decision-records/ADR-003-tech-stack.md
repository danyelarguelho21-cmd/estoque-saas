# ADR-003: Stack tecnológica principal

**Status:** Accepted
**Context:** O usuário sugeriu Next.js + Postgres, mas pediu para o Architect escolher livremente se houvesse algo melhor para multi-tenant robusto. O time é solo/dupla, o deploy alvo é um VPS via Docker Compose, e não há requisito de tempo real forte.
**Decision:**
| Camada | Escolha | Versão verificada (set/2026) |
|---|---|---|
| Linguagem | TypeScript (strict mode) | 5.x |
| Runtime | Node.js | 24.x (Active LTS) |
| Framework full-stack | Next.js (App Router, Route Handlers como API) | 16.3.x (Active LTS) |
| Banco relacional | PostgreSQL | 18.x |
| ORM | Prisma (com Client Extension para contexto RLS) | 6.x |
| Fila / background jobs | BullMQ + Redis | Redis 7.x |
| Cache | Redis (mesma instância da fila, DB index separado) | — |
| Autenticação | Auth.js (NextAuth v5) com estratégia de credenciais (email/senha) + sessão em banco | — |
| Validação | Zod (schemas compartilhados entre API e formulários) | — |
| UI | React 19 (via Next.js) + Tailwind CSS + shadcn/ui | — |
| Testes | Vitest (unit/integration) + Playwright (e2e) | — |
| Empacotamento | Docker multi-stage, imagem `node:24-alpine` | — |
| Orquestração local/produção inicial | Docker Compose | — |

**Rationale:**
- **Next.js full-stack** mantém o monolito modular (ADR-001) em um único deployável, com API (Route Handlers) e UI no mesmo processo — reduz superfície operacional para o time atual, mantendo a stack sugerida pelo usuário.
- **Prisma** foi escolhido sobre Drizzle por maturidade de migrations, introspecção e ecossistema; a limitação conhecida do Prisma (não expõe RLS nativamente) é resolvida via Client Extension que injeta o contexto de tenant por transação (ver ADR-002) — padrão validado em pesquisa de mercado 2026.
- **BullMQ + Redis** cobre os três processamentos assíncronos do domínio: parsing de XML de NF-e (pode ser pesado), geração mensal de cobranças Pix/boleto, e job diário de varredura de alertas de validade/estoque baixo. Evita bloquear requisições HTTP com trabalho pesado.
- **Auth.js** é a solução de autenticação mais madura para Next.js; estratégia de credenciais (não OAuth social) porque o público (PMEs) espera login com email/senha da empresa, com convite de usuários pelo admin do tenant.
- **VPS + Docker Compose** (não Kubernetes) é proporcional à escala (<1K tenants, time solo) — decisão confirmada na entrevista de discovery.
**Consequences:** Stack 100% TypeScript de ponta a ponta reduz custo de troca de contexto para um time pequeno. Dependência de um único processo Next.js para servir toda a aplicação é aceitável na escala atual, mas o worker de jobs roda como processo Node separado (mesma imagem, `CMD` diferente) desde o início, para não acoplar processamento assíncrono ao ciclo de vida de requests HTTP.
**Alternatives Considered:**
- **NestJS (backend) + Next.js (frontend) separados:** mais "enterprise", mas dobra a superfície de deploy e contratos internos para um ganho não justificado na escala atual. Rejeitado por ora — a fronteira modular do ADR-001 permite essa extração depois, se necessário.
- **Drizzle ORM:** mais leve e com SQL mais explícito, mas ecossistema de migrations e tooling ainda menos maduro que Prisma em 2026 para o caso de uso de RLS multi-tenant. Rejeitado.
- **Supabase (Postgres gerenciado com RLS nativo de auth):** atrativo para RLS, mas acopla a aplicação à infraestrutura da Supabase, dificultando o alvo de deploy em VPS genérico já decidido. Rejeitado.
