FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ----------
# Dependencies laag: installeren alleen wanneer package.json / lock veranderen
# ----------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN \
  if [ -f package-lock.json ]; then npm ci; \
  else echo "package-lock.json niet gevonden, abort." && exit 1; \
  fi

# ----------
# Build laag: compile Next.js + Prisma client voor Alpine musl
# ----------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma client genereren voor Alpine (musl) target — belangrijk, anders runtime crash
ENV PRISMA_CLIENT_ENGINE_TYPE=library
RUN npx prisma generate

# Next.js standalone build (output: ".next/standalone" + ".next/static")
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ----------
# Runtime laag: minimaal image, non-root user, draait standalone server.js
# ----------
FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Non-root gebruiker aanmaken (node:20-alpine heeft al standaard "node" gebruiker, id 1000)
RUN addgroup --system --gid 1001 nodejs || true
RUN adduser  --system --uid 1001 nextjs || true

# Kopieer benodigde assets uit builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Next.js standalone folder bevat alle JS code
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma schemabestand + client (nodig voor runtime prisma.* calls in standalone)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs

EXPOSE 3000
ENV HOSTNAME=0.0.0.0

# Container start: eerst prisma migrations deployen, daarna standalone Next.js server
# Je kunt dit ook splitsen met een aparte "migrate" service in docker-compose; dit is 1-service shortcut
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 node node_modules/prisma/build/index.js migrate deploy && node server.js"]
