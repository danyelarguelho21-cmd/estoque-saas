-- Teste gratuito liberado manualmente pelo dono da plataforma (painel /admin). Só é válido com
-- status 'trialing' E trial_ends_at no futuro; linhas 'trialing' antigas (sem data) continuam
-- bloqueadas como antes (ver services/app/src/modules/auth/rbac.ts#isSubscriptionBlocked).
ALTER TABLE "subscriptions" ADD COLUMN "trial_ends_at" TIMESTAMP(3);
