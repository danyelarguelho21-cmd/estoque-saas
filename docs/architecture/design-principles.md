# Princípios de design — estoque-saas

## 12-Factor App
- Configuração 100% via variáveis de ambiente (`.env`, nunca hardcoded) — ver `.env.example`.
- Dependências declaradas explicitamente (`package.json` com lockfile commitado).
- Processos stateless: a aplicação web não guarda estado em memória entre requests (sessão via banco/Redis, não em processo).
- Logs como stream (stdout, formato JSON estruturado) — coletados pelo ambiente de execução, não geridos pela aplicação.
- Paridade dev/produção via Docker Compose — mesmo Dockerfile em todos os ambientes.

## Defesa em profundidade
1. **Autenticação** (Auth.js) — quem é o usuário.
2. **Autorização RBAC** (Admin/Operador/Vendedor) — o que o papel pode fazer, reforçada em cada Route Handler via middleware de permissão.
3. **Isolamento multi-tenant (RLS)** — mesmo que a aplicação erre, o banco não retorna dado de outro tenant (ADR-002).
4. **Auditoria imutável** — todo o resto sendo comprometido, ainda há trilha de quem fez o quê (ADR-007).

## Padrões de resiliência
- **Idempotência em escritas críticas**: webhooks de pagamento processados com chave de idempotência (`gateway_event_id` único) — reprocessar o mesmo webhook não duplica cobrança/assinatura.
- **Retry com backoff** para chamadas ao gateway de pagamento e para jobs de fila (BullMQ tem retry nativo configurável por job).
- **Timeout explícito** em toda chamada HTTP externa (PagBank).
- **Circuit breaker** não é necessário na escala atual (uma única dependência externa crítica, PagBank) — documentado como candidato de HARDEN/SRE se o volume crescer.

## Consistência de dados
- Operações que tocam múltiplas tabelas (ex: confirmar entrada de NF-e cria N `stock_movements` + atualiza saldo) rodam em uma única transação Postgres — consistência forte dentro do domínio de estoque.
- Comunicação com o gateway de pagamento é eventualmente consistente por natureza (webhook assíncrono) — o estado da assinatura reflete o último evento processado, nunca é otimista sobre um pagamento "provavelmente" aprovado.

## Zero-trust interno
- Toda Route Handler valida sessão + papel + tenant, mesmo em rotas "internas" — nenhuma rota confia implicitamente em não ser alcançada por um usuário não autorizado.
- O painel administrativo interno do SaaS (`platform_admins`) usa autenticação e sessão **completamente separadas** do login de tenants — comprometer uma não compromete a outra (ver ADR-002, tabela fora do RLS de tenant).

## Boundary safety (ver protocolo compartilhado)
- Callbacks globais (ex: webhook handler do PagBank) sempre brancham por tipo de evento — nunca retornam um resultado fixo independente do payload (Pattern 4).
- Login/onboarding usam navegação padrão do Next.js apenas para páginas; endpoints de webhook e download de XML usam rotas de API diretas, nunca `<Link>` (Pattern 1).
- Testes e2e (Playwright) cobrem jornadas completas: upload de XML → conferência → confirmação → saldo atualizado; e assinatura → pagamento (mock) → liberação de acesso (Pattern 5).
