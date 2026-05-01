# =============================================================================
# Novu Bridge — Next.js standalone build
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder for the Next.js "collect page data" step. @novu/framework's
# serve() validates this env var when imported. The real secret is injected
# by docker-compose at runtime; standalone builds don't bake server env vars
# into the output, so this placeholder is safe.
ENV NOVU_SECRET_KEY=build-time-placeholder-not-used-at-runtime
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4001

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Removed `COPY --from=builder /app/public ./public` — this Bridge has no
# /public folder, and BuildKit COPY does not support shell `||` fallbacks.
# Next.js standalone runs fine without it.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 4001

# Healthcheck handled by docker-compose; no curl in alpine base.
CMD ["node", "server.js"]
