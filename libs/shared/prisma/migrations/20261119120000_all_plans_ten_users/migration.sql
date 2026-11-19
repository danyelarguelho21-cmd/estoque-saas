-- Todos os planos passam a permitir até 10 usuários (decisão comercial: Básico era 7, Pro já era
-- 10, Enterprise era 20). scripts/seed-plans.mjs (rodado a cada deploy) também foi para 10 — sem
-- isso o seed voltaria os valores antigos no próximo deploy. Para ajustar depois, mude os dois.
UPDATE "plans" SET "max_users" = 10;
