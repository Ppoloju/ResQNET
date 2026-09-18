# IQOO frontend — multi-stage build: Vite bundle + nginx static serve (node:24-alpine, free).
# The /api and /realtime/stream locations proxy to the backend service so the
# deployed app talks same-origin, exactly like the Vite dev proxy.
FROM node:24-alpine AS build
WORKDIR /build

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/
COPY shared/package.json shared/

RUN npm install --workspace frontend --workspace shared --include-workspace-root

COPY shared/ shared/
COPY frontend/ frontend/

# Shared must be built first: frontend imports @iqoo/shared/dist.
RUN npm run build -w shared && npm run build -w frontend

FROM nginx:alpine AS runtime
COPY --from=build /build/frontend/dist /usr/share/nginx/html
COPY docker/frontend.nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
