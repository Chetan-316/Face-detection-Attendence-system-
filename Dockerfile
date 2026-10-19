# syntax=docker/dockerfile:1
# API + Python biometric worker image. The worker is a child process of the Node API
# (see src/modules/biometrics/python-worker-client.ts), so both ship in one container.
# ONNX models are NOT baked into the image; they are mounted read-only at /models at run time.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    APP_ENV=staging \
    PORT=3000 \
    TIMEZONE=Asia/Kolkata \
    PYTHON_BIN=/opt/pravahax-venv/bin/python \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MODELS_DIR=/models \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
COPY src/modules/biometrics/workers ./src/modules/biometrics/workers
COPY deploy/staging ./deploy/staging
RUN python3 -m venv /opt/pravahax-venv \
 && /opt/pravahax-venv/bin/pip install --no-cache-dir -r src/modules/biometrics/workers/requirements.txt \
 && chmod 0755 deploy/staging/migrate.sh \
 && mkdir -p /app/data/profile-photos \
 && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/index.js"]

# Operator-only seed image: runtime plus the seed tooling, which the API image does not carry.
FROM runtime AS seed
COPY scripts/safe-seed.ts ./scripts/
COPY scripts/lib ./scripts/lib
CMD ["node_modules/.bin/tsx", "scripts/safe-seed.ts"]
