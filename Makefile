.PHONY: up down logs migrate generate dev worker test bootstrap-admin seed-plans

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f app worker

migrate:
	npm run prisma:migrate --workspace libs/shared
	node --env-file=.env scripts/apply-role-grants.mjs
	node --env-file=.env scripts/seed-plans.mjs

bootstrap-admin:
	node --env-file=.env scripts/bootstrap-platform-admin.mjs

seed-plans:
	node --env-file=.env scripts/seed-plans.mjs

generate:
	npm run prisma:generate --workspace libs/shared

dev:
	npm run dev

worker:
	npm run worker

test:
	npm run test
