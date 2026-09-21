# Multi-stage build — imagem enxuta, usuário non-root (design-principles.md)
FROM node:24-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY package.json package-lock.json* ./
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
COPY --from=build /repo/services/app/.next/standalone ./
COPY --from=build /repo/services/app/.next/static ./services/app/.next/static
COPY --from=build /repo/services/app/public ./services/app/public
USER app
EXPOSE 3000
CMD ["node", "services/app/server.js"]
