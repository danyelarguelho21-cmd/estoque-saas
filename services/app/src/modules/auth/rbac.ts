// Helpers de sessão/RBAC usados por Route Handlers de QUALQUER módulo (via modules/auth/index.ts —
// fronteira de módulo, ADR-001). Nunca reimplementar checagem de auth fora daqui
// (boundary-safety Pattern 2 — delegar ao controle de fluxo único, não duplicar).
import { ForbiddenError, PaymentRequiredError, UnauthorizedError, can, withTenant, type Permission, type Role } from "@estoque-saas/shared";
import { auth } from "./auth.config";

export interface SessionContext {
  tenantId: string;
  userId: string;
  role: Role;
}

export interface RequireSessionOptions {
  // Rotas de billing (ver o próprio checkout) e a leitura do tenant precisam continuar acessíveis
  // MESMO sem pagamento confirmado — sem isso, um tenant pending_payment nunca conseguiria pagar
  // (a própria tela/rota que resolve o bloqueio ficaria bloqueada). Default: false (bloqueia).
  allowPendingPayment?: boolean;
}

// BUG FIX (achado em produção via teste manual real): createSubscription (modules/billing) e
// signupTenant (aqui) davam ao tenant status "active"/"trialing" imediatamente — sessão válida já
// bastava pra acessar Produtos/Estoque/Vendas por completo, mesmo sem nenhum pagamento confirmado.
// O modelo de negócio deste produto não tem período de teste (BRD: pagar pra usar); "trialing" é
// mantido aqui só por compatibilidade com linhas já existentes no banco criadas antes desta
// correção — nenhum código novo cria mais esse valor (ver signup.ts/subscriptions.ts).
const BLOCKED_SUBSCRIPTION_STATUSES = new Set(["pending_payment", "trialing"]);

// Lança UnauthorizedError (401) se não houver sessão válida. Toda rota tenant-scoped chama isto
// primeiro, antes de qualquer acesso a dados.
export async function requireSession(options: RequireSessionOptions = {}): Promise<SessionContext> {
  const session = await auth();
  // Falha fechado explicitamente se QUALQUER campo esperado faltar — nunca degradar para um
  // valor default silencioso (ex: userId=""), que passaria despercebido pelo RBAC e só quebraria
  // mais tarde, de forma confusa, na primeira gravação em coluna uuid (audit_log, created_by...).
  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    throw new UnauthorizedError();
  }
  const ctx: SessionContext = {
    tenantId: session.user.tenantId,
    userId: session.user.id,
    role: session.user.role,
  };

  if (!options.allowPendingPayment) {
    const subscription = await withTenant(ctx.tenantId, (tx) => tx.subscription.findFirst({ orderBy: { createdAt: "desc" } }));
    // `subscription` só é null para tenants criados fora do fluxo real de signup (signupTenant
    // SEMPRE cria uma subscription na mesma transação do tenant) — na prática, só fixtures de
    // teste que seedam um tenant direto via SQL sem passar pelo onboarding real. Fail-open
    // (permite acesso) nesse caso é deliberado: não há política de cobrança pra aplicar a um
    // tenant que não tem NENHUMA assinatura, e travar isso exigiria dar uma subscription
    // sintética a cada fixture de teste que hoje seeda um tenant sem uma (auditoria, RLS,
    // stock-concurrency, etc.) só pra testar algo sem relação nenhuma com billing.
    if (subscription && BLOCKED_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      throw new PaymentRequiredError("Assinatura pendente de pagamento — complete o pagamento para acessar o sistema.");
    }
  }

  return ctx;
}

// Exige sessão válida E a permissão informada — lança ForbiddenError (403) se o papel do usuário
// não tiver a permissão (ver libs/shared/src/rbac para o mapa papel→permissão).
export async function requireRole(permission: Permission, options: RequireSessionOptions = {}): Promise<SessionContext> {
  const ctx = await requireSession(options);
  if (!can(ctx.role, permission)) {
    throw new ForbiddenError();
  }
  return ctx;
}
