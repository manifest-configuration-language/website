FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build

COPY --from=golang:1.27.3-alpine@sha256:f2c872bcee949b7be9c490efd02b48a8a2fbf947cdf533f1c58525ec9d8170fd /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOTOOLCHAIN=local

WORKDIR /src
COPY mcl-runtime.json vscode-grammar.json ./
COPY scripts/prepare-runtime.mjs scripts/prepare-grammar.mjs scripts/
RUN node scripts/prepare-runtime.mjs && node scripts/prepare-grammar.mjs

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN PNPM_PACKAGE=$(node -p "require('./package.json').packageManager.split('+')[0]") \
    && npm install --global "$PNPM_PACKAGE" --fetch-retries=5 --fetch-timeout=300000 \
    && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM nginxinc/nginx-unprivileged:1.30-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

LABEL org.opencontainers.image.source="https://github.com/manifest-configuration-language/website"
LABEL org.opencontainers.image.description="MCL language documentation and playground"
LABEL org.opencontainers.image.licenses="Apache-2.0"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/.build/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /src/.build/dist /usr/share/nginx/html
EXPOSE 8080
USER 101:101
