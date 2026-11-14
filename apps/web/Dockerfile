# Next.js app for the lab (Coolify, Dockerfile build, port 3000). Build context: repo root.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @games/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
# Coolify health check host must be 127.0.0.1, not localhost (GC-5).
CMD ["node", "apps/web/server.js"]
