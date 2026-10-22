FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build

WORKDIR /src
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN PNPM_PACKAGE=$(node -p "require('./package.json').packageManager.split('+')[0]") \
    && npm install --global "$PNPM_PACKAGE" --fetch-retries=5 --fetch-timeout=300000 \
    && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM caddy:2.11.7-alpine@sha256:4c989fd92fe0c67a045def7acd32242f7eddf50ab16ae399dc63dd6d3ebc5ce5

LABEL org.opencontainers.image.source="https://github.com/manifest-configuration-language/website"
LABEL org.opencontainers.image.description="MCL language documentation and playground"
LABEL org.opencontainers.image.licenses="Apache-2.0"

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/.build/dist /srv
ENV XDG_CONFIG_HOME=/tmp/caddy/config \
    XDG_DATA_HOME=/tmp/caddy/data
EXPOSE 8080
USER 10001:10001
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
