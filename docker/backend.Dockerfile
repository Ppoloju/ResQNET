# IQOO backend — multi-stage build (node:24-alpine, free)
# node:sqlite requires Node >= 22.5, hence the 24 base image.
FROM node:24-alpine AS build
WORKDIR /build

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY shared/package.json shared/

RUN npm install --workspace backend --workspace shared --include-workspace-root

COPY shared/ shared/
COPY backend/ backend/
COPY database/ database/

# Shared must be built first: backend's dist imports @iqoo/shared/dist.
RUN npm run build -w shared && npm run build -w backend

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Mirror the monorepo layout so workspace resolution + schema path both work:
# /app/node_modules, /app/backend/dist, /app/shared/dist, /app/database/schema.sql
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/backend/dist ./backend/dist
COPY --from=build /build/backend/package.json ./backend/package.json
COPY --from=build /build/shared/dist ./shared/dist
COPY --from=build /build/shared/package.json ./shared/package.json
COPY --from=build /build/package.json ./package.json
COPY --from=build /build/database ./database

EXPOSE 4000
WORKDIR /app/backend
# Schema is applied automatically by backend/src/db.ts at boot (../../database/schema.sql).
CMD ["node", "dist/server.js"]
