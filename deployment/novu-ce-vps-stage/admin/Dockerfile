# =============================================================================
# TPE Admin UI  Next.js 14 standalone build, serves /admin* on :3500
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders for env vars that may be referenced by route modules.
# Real values are injected at runtime by docker-compose. Mirrors the bridge fix.
ENV NOVU_API_KEY=build-time-placeholder
ENV MONGO_URL=mongodb://placeholder:placeholder@placeholder:27017/placeholder
ENV TPE_ADMIN_PASSWORD=build-time-placeholder
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3500
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3500

CMD ["node", "server.js"]
