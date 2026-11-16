-- Plano Básico passa a permitir até 7 usuários (antes: 2). Só o Básico é alterado — Pro e
-- Enterprise ficam como estão. scripts/seed-plans.mjs (rodado a cada deploy) também foi
-- atualizado para 7; sem isso o seed voltaria o valor para 2 no próximo deploy.
UPDATE "plans" SET "max_users" = 7 WHERE "name" = 'Básico';
