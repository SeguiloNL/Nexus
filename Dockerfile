FROM node:20-alpine AS base
# libc6-compat voor bepaalde glibc binary shims.
# Prisma 5.22 musl engine (library mode) linkt tegen libssl1.1 → ALPINE 3.20 / node:20-alpine heeft standaard openssl 3.x.
# Workaround:
#   1) zorg dat openssl 3 shared lib bestaat,
#   2) plaats een symlink libssl.so.1.1 → libssl.so.3 EN libcrypto.so.1.1 → libcrypto.so.3 (ABI compat op niveau dat Prisma nodig heeft: TLS 1.2/1.3 verbinding met Postgres).
#   3) anders fallback in builder laag: PRISMA_CLIENT_ENGINE_TYPE=binary.
RUN apk add --no-cache libc6-compat openssl ca-certificates \
    && ln -sf /lib/libssl.so.3    /lib/libssl.so.1.1 \
    && ln -sf /lib/libcrypto.so.3 /lib/libcrypto.so.1.1
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
# + Volledige "prisma" npm package (voor CLI — npx prisma ...)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

# Runtime entrypoint: DB connectivity check + migrations + Next.js server
COPY --chown=nextjs:nodejs entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs

EXPOSE 3000
ENV HOSTNAME=0.0.0.0

# Container start: entrypoint.sh regelt volgorde (zie bestand)
CMD ["./entrypoint.sh"]
