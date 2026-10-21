FROM node:24.22.0-alpine AS docs

WORKDIR /src
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY docs ./docs
COPY scripts ./scripts
COPY src ./src
COPY rspress.config.ts ./rspress.config.ts
COPY security-headers.conf ./security-headers.conf
COPY theme ./theme
RUN pnpm run build && node scripts/write-csp.mjs .build/rspress/dist .build/security-headers.conf

FROM nginx:1.30-alpine

LABEL org.opencontainers.image.source="https://github.com/manifest-configuration-language/website"
LABEL org.opencontainers.image.description="MCL language documentation and playground"
LABEL org.opencontainers.image.licenses="Apache-2.0"

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=docs /src/.build/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=docs /src/.build/rspress/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
