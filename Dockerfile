FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build

WORKDIR /src
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable pnpm \
    && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS api

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable pnpm \
    && pnpm install --prod --frozen-lockfile
COPY src/api/migrate.js src/api/server.js src/api/snapshot.js src/api/storage.js ./src/api/
COPY src/api/migrations ./src/api/migrations
USER 65532:65532
EXPOSE 8080
CMD ["node", "src/api/server.js"]

FROM caddy:2.11.7-alpine@sha256:24ec7b05bc532c7bb57f727030c5056e257ff7138b4b50460306819ff79362bd

LABEL org.opencontainers.image.source="https://github.com/manifest-configuration-language/website"
LABEL org.opencontainers.image.description="MCL language documentation and playground"
LABEL org.opencontainers.image.licenses="Apache-2.0"

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/.build/dist /srv
RUN setcap -r /usr/bin/caddy
ENV XDG_CONFIG_HOME=/tmp/caddy/config \
    XDG_DATA_HOME=/tmp/caddy/data
EXPOSE 8080
USER 10001:10001
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
