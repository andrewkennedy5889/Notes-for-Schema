# ── Build stage: install all deps + build frontend ───────────────────────────
FROM node:20-alpine AS build

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy node_modules from build (includes better-sqlite3 native bindings + tsx)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./

# Persistent data directory (mount a volume here)
RUN mkdir -p /data /data/images

ENV NODE_ENV=production
ENV DB_PATH=/data/schema-planner.db
ENV IMAGE_STORAGE_PATH=/data/images

EXPOSE 3100

CMD ["npx", "tsx", "server/index.ts"]
