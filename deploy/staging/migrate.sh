#!/bin/sh
# Operator-run migration procedure for the STAGING database only.
# Usage: docker compose --env-file .env.staging -f docker-compose.staging.yml --profile ops run --rm migrate
set -eu

: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"

if [ "${APP_ENV:-}" != "staging" ]; then
  echo "[migrate] APP_ENV must be exactly 'staging'" >&2
  exit 1
fi

case "$MIGRATION_DATABASE_URL" in
  */pravahax_staging|*/pravahax_staging\?*) ;;
  *)
    echo "[migrate] MIGRATION_DATABASE_URL must target the pravahax_staging database" >&2
    exit 1
    ;;
esac

export DATABASE_URL="$MIGRATION_DATABASE_URL"

echo "[migrate] Step 1/3: schema-state gate and preflight"
node deploy/staging/migration-gate.mjs

echo "[migrate] Step 2/3: prisma migrate deploy"
node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

echo "[migrate] Step 3/3: prisma migrate status"
node_modules/.bin/prisma migrate status --schema prisma/schema.prisma

echo "[migrate] Done. Next: deploy/staging/bootstrap-runtime-role.sh (re-run after every migration)."
