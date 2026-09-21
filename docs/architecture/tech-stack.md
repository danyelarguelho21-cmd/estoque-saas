# Tech Stack — estoque-saas

Ver justificativa completa em [ADR-003](./architecture-decision-records/ADR-003-tech-stack.md). Versões verificadas via pesquisa web em setembro de 2026.

| Camada | Escolha | Versão | Justificativa resumida |
|---|---|---|---|
| Linguagem | TypeScript (strict) | 5.x | Tipagem ponta a ponta, único idioma para todo o time |
| Runtime | Node.js | 24.x (Active LTS) | LTS ativo, performance e suporte a features modernas |
| Framework | Next.js (App Router) | 16.3.x (Active LTS) | Full-stack único, mantém monolito modular (ADR-001) |
| UI | React | 19.x | Vem com Next.js 16 |
| Estilo | Tailwind CSS + shadcn/ui | latest | Produtividade de UI, consistente com dashboard denso em dados |
| Banco relacional | PostgreSQL | 18.x | RLS nativo (ADR-002), maturidade, custo baixo |
| ORM | Prisma | 6.x | Migrations maduras + Client Extension para contexto RLS |
| Validação | Zod | latest | Schemas compartilhados API ↔ formulários |
| Fila / jobs assíncronos | BullMQ | latest | Import de XML, geração de cobranças, alertas de validade |
| Cache / broker de fila | Redis | 7.x | Suporte nativo ao BullMQ, cache de sessão/consulta |
| Autenticação | Auth.js (NextAuth v5), estratégia Credentials | latest | Login email/senha por tenant, convite de usuários |
| Gateway de pagamento | PagBank/PagSeguro (atrás de `PaymentProvider`, ADR-004) | API Pagamentos Recorrentes + API de Pedidos | Decisão do usuário; Pix/boleto avulso via API de Pedidos |
| Parser de XML | fast-xml-parser | latest | Parsing de NF-e (ADR-005) |
| Testes unit/integration | Vitest | latest | Rápido, nativo em TS/ESM |
| Testes e2e | Playwright | latest | Cobre jornadas completas (Pattern 5 do boundary-safety) |
| Container | Docker (multi-stage, `node:24-alpine`) | — | Imagem enxuta, non-root user |
| Orquestração local/inicial | Docker Compose | — | Adequado à escala e ao time (decisão de discovery) |
| CI/CD | GitHub Actions | — | Padrão de mercado, gratuito para repositório privado pequeno |

## Compatibilidade multi-cloud / portabilidade
O deploy alvo inicial é VPS genérico via Docker Compose (decisão de discovery). Nenhuma dependência proprietária de nuvem específica é usada no MVP — Postgres, Redis e a aplicação rodam em containers padrão, portáveis para qualquer VPS ou, futuramente, para um provedor gerenciado (RDS/Cloud SQL) sem mudança de código, apenas de connection string.
