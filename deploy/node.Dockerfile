# Satchel node: runs TypeScript directly on Node 24 (native type stripping), no build step.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/node/package.json packages/node/
COPY packages/relay/package.json packages/relay/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
RUN pnpm install --frozen-lockfile --prod --filter @satchel/node... --filter @satchel/core

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production SATCHEL_DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/node/node_modules ./packages/node/node_modules
COPY packages/core packages/core
COPY packages/node packages/node
COPY deploy/node-entrypoint.sh /usr/local/bin/satchel-entrypoint
RUN chmod +x /usr/local/bin/satchel-entrypoint && mkdir -p /data /vault && chown node:node /data /vault
USER node
VOLUME ["/data"]
EXPOSE 7710
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:7710/admin/api/session').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["satchel-entrypoint"]
