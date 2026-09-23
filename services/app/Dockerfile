# Multi-stage build — usuário non-root, imagem única usada por `app` e `worker`
# (docker-compose.yml troca apenas o `command`). Ver design-principles.md.
FROM node:24-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY package.json package-lock.json* .npmrc ./
COPY libs/shared/package.json libs/shared/package.json
COPY services/app/package.json services/app/package.json
RUN npm install --workspaces --include-workspace-root

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate
RUN npm run build --workspace services/app

FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
WORKDIR /repo
# qa-engineer finding C-1: LocalFileStorage's default UPLOADS_DIR ("./.data/uploads", relative to
# CWD) resolves under /repo, which this stage's non-root `app` user does not own — every NF-e/CSV
# upload hit EACCES on mkdir. Pre-create the directory and chown it to `app` BEFORE `USER app` so
# the ownership is baked into the image layer; docker-compose.yml mounts a named volume at this
# exact absolute path (shared between `app` and `worker`, since the parse job reads what the web
# process wrote) and sets UPLOADS_DIR to match — a named volume with no host bind inherits the
# image directory's ownership on first creation, so this chown is what makes the volume writable
# on a fresh boot too, not just the in-image directory.
RUN mkdir -p /repo/.data/uploads && chown -R app:app /repo/.data
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /repo/libs/shared ./libs/shared
COPY --from=build /repo/services/app/.next ./services/app/.next
COPY --from=build /repo/services/app/public ./services/app/public
COPY --from=build /repo/services/app/package.json ./services/app/package.json
COPY --from=build /repo/services/app/tsconfig.json ./services/app/tsconfig.json
COPY --from=build /repo/services/app/src ./services/app/src
COPY --from=build /repo/services/app/next.config.ts ./services/app/next.config.ts
USER app
EXPOSE 3000
# Default: web app. docker-compose.yml sobrepõe `command` no serviço `worker`
# para `npm run worker --workspace services/app` (tsx executa src/worker/index.ts direto,
# sem etapa de build separada — worker roda em Node.js real, TS via tsx é suficiente na escala atual).
CMD ["npm", "run", "start", "--workspace", "services/app"]
