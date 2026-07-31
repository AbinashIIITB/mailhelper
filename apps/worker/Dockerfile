# Portable worker image — usable on any container host (Fly.io, Railway,
# Koyeb, Azure Container Apps, Google Cloud Run, a VPS…). Render uses the
# native Node runtime via render.yaml instead and does not need this.
#
# Build from the REPO ROOT, not from this directory:
#   docker build -f apps/worker/Dockerfile -t mailhelper-worker .
FROM node:22-slim

# Prisma's query engine needs openssl at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install only the workspaces the worker actually needs (skips Next.js & friends).
# Every workspace package.json must be present for npm to resolve the lockfile.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
# Copied before install so @mailhelper/db's `postinstall: prisma generate` works.
COPY packages/db/prisma packages/db/prisma
RUN npm ci --include-workspace-root \
  --workspace worker \
  --workspace @mailhelper/core \
  --workspace @mailhelper/db \
  --workspace @mailhelper/queue

COPY packages packages
COPY apps/worker apps/worker
COPY tsconfig.base.json ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start", "-w", "worker"]
