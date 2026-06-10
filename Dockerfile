FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# Build stage — install deps and build all packages
FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json biome.json ./
COPY packages ./packages
COPY extensions ./extensions
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build

# Production stage — minimal runtime image with built artifacts
FROM base AS runtime
ENV NODE_ENV=production

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/memory/package.json ./packages/memory/
COPY packages/tools/package.json ./packages/tools/
COPY packages/channel-lark/package.json ./packages/channel-lark/
COPY packages/server/package.json ./packages/server/
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/memory/dist ./packages/memory/dist
COPY --from=build /app/packages/tools/dist ./packages/tools/dist
COPY --from=build /app/packages/channel-lark/dist ./packages/channel-lark/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY extensions ./extensions

EXPOSE 5100
WORKDIR /app/packages/server
CMD ["node", "dist/index.js"]
