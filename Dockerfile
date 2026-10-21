FROM golang:1.27.3-alpine AS go

FROM node:24.22.0-alpine AS runtime

COPY --from=go /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOTOOLCHAIN=local

WORKDIR /src
COPY mcl-runtime.json ./
COPY scripts/prepare-runtime.mjs scripts/prepare-runtime.mjs
RUN node scripts/prepare-runtime.mjs

FROM node:24.22.0-alpine AS grammar

WORKDIR /src
COPY vscode-grammar.json ./
COPY scripts/prepare-grammar.mjs scripts/prepare-grammar.mjs
RUN node scripts/prepare-grammar.mjs

FROM node:24.22.0-alpine AS build

WORKDIR /src
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
COPY --from=runtime /src/public/mcl.wasm.gz /src/public/mcl.wasm.gz
COPY --from=runtime /src/public/wasm_exec.js /src/public/wasm_exec.js
COPY --from=runtime /src/.build/mcl-runtime-ref /src/.build/mcl-runtime-ref
COPY --from=grammar /src/src/playground/mcl.tmLanguage.json /src/src/playground/mcl.tmLanguage.json
COPY --from=grammar /src/.build/vscode-grammar-ref /src/.build/vscode-grammar-ref
RUN pnpm run build

FROM nginxinc/nginx-unprivileged:1.30-alpine

LABEL org.opencontainers.image.source="https://github.com/manifest-configuration-language/website"
LABEL org.opencontainers.image.description="MCL language documentation and playground"
LABEL org.opencontainers.image.licenses="Apache-2.0"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/.build/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /src/.build/dist /usr/share/nginx/html
EXPOSE 8080
