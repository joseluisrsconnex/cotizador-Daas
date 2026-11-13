# The lockfile excludes native binaries for platforms other than linux/amd64.
FROM --platform=linux/amd64 node:24.22.1-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_PROXY_ENABLED=false
ARG VITE_CLERK_PROXY_URL=
ENV BASE_PATH=/ PORT=3000
RUN test -n "$VITE_CLERK_PUBLISHABLE_KEY" && pnpm run build:app

FROM --platform=linux/amd64 node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
# Keep workspace tools for the explicit one-shot migration/seed commands.
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production PORT=3000 STATIC_DIR=../cotizador-daas/dist/public
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
