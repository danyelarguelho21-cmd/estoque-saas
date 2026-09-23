# Auth & Onboarding

Spec: [`api/openapi/auth.yaml`](../../api/openapi/auth.yaml) · Implementação: [`services/app/src/modules/auth`](../../services/app/src/modules/auth)

Ver também [tenants.md](./tenants.md) (dados do tenant/lojas/usuários já autenticados) e
[ADR-002](../architecture/architecture-decision-records/ADR-002-multi-tenancy-strategy.md) para
como a sessão se conecta ao isolamento de tenant.

## `POST /api/auth/signup`

Onboarding self-service — cria o tenant **e** o primeiro usuário admin em uma única operação.

**Body**
```json
{
  "companyName": "Mercadinho Silva",
  "cnpj": "12.345.678/0001-90",
  "adminName": "Maria Silva",
  "adminEmail": "maria@mercadinhosilva.com.br",
  "password": "senha-forte-8+",
  "planId": "uuid-do-plano"
}
```

- `201` — `{ tenantId, userId }`.
- `400` — validação (ver [Erros](./README.md#erros)).
- `409` — CNPJ ou e-mail já cadastrado.

Sujeito a rate limit por IP (`RATE_LIMIT_SIGNUP_IP_MAX`, default 5/hora — ver `.env.example`).

## `POST /api/auth/login`

Autentica por e-mail/senha e cria a sessão Auth.js (cookie `__Host-session`).

**Body:** `{ email, password }` -> `200` (sessão criada) ou `401`.

Sujeito a rate limit por IP **e** por e-mail (`RATE_LIMIT_LOGIN_IP_MAX`/`RATE_LIMIT_LOGIN_EMAIL_MAX`
— o segundo existe especificamente para não deixar um atacante forçar login em uma conta
específica escondido atrás de múltiplos IPs).

## `POST /api/auth/logout`

Requer sessão (`sessionCookie`). Encerra a sessão atual -> `204`.

## `POST /api/users/invite`

Admin convida um novo usuário para o tenant. Requer sessão + permissão `users:manage` (só
`admin`, ver [tabela RBAC](./README.md#rbac-papéis-dentro-de-um-tenant)).

**Body:** `{ name, email, role }` com `role` em `admin | operador | vendedor`.

- `201` — usuário criado com `status=invited`.
- `403` — sem permissão.
- `409` — `PLAN_LIMIT_REACHED` (limite de usuários do plano atingido — ver
  [`libs/shared/src/plan-limits`](../../libs/shared/src/plan-limits/index.ts)).

## Próximos passos

- [tenants.md](./tenants.md) — gerenciar papéis de usuários já convidados (`PATCH /api/users/{id}/role`).
- [Guia do desenvolvedor](../guides/developer-guide.md#autenticação-em-desenvolvimento) — como obter uma sessão localmente para testar rotas autenticadas.
