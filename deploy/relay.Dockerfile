FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/node/package.json packages/node/
COPY packages/relay/package.json packages/relay/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
RUN pnpm install --frozen-lockfile --prod --filter @satchel/relay... --filter @satchel/core

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production SATCHEL_RELAY_PUBLIC_PORT=443 SATCHEL_RELAY_CONTROL_PORT=7443
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/relay/node_modules ./packages/relay/node_modules
COPY packages/core packages/core
COPY packages/relay packages/relay
RUN printf '#!/bin/sh\nexec node /app/packages/relay/src/cli.ts "$@"\n' > /usr/local/bin/satchel-relay && chmod +x /usr/local/bin/satchel-relay
# Binding 443 as non-root is allowed by the default docker sysctl net.ipv4.ip_unprivileged_port_start=0
USER node
EXPOSE 443 7443
ENTRYPOINT ["satchel-relay"]
CMD ["serve"]
