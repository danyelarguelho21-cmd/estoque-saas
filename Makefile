.PHONY: up down logs migrate generate dev worker test

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f app worker

migrate:
	npm run prisma:migrate --workspace libs/shared

generate:
	npm run prisma:generate --workspace libs/shared

dev:
	npm run dev

worker:
	npm run worker

test:
	npm run test
