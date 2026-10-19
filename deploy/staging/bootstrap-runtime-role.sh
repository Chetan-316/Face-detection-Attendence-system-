#!/usr/bin/env bash
# Creates/rotates the staging runtime DB role, applies grants, re-restricts audit_logs, and verifies.
# Run from the repository root on the InstaBox host AFTER migrations. Idempotent; re-run after every migration.
#   set -a; . ./.env.staging; set +a; deploy/staging/bootstrap-runtime-role.sh
set -euo pipefail

: "${RUNTIME_DB_ROLE:?RUNTIME_DB_ROLE is required}"
: "${RUNTIME_DB_PASSWORD:?RUNTIME_DB_PASSWORD is required}"

COMPOSE=(docker compose --env-file .env.staging -f docker-compose.staging.yml)

# The password travels as an env var name only; psql receives it inside the db container.
cat deploy/staging/runtime-role.sql deploy/sql/audit_logs_runtime_role.sql deploy/staging/verify-runtime-role.sql |
  "${COMPOSE[@]}" exec -T -e RUNTIME_DB_ROLE -e RUNTIME_DB_PASSWORD db sh -c '
    exec psql -v ON_ERROR_STOP=1 -X -q \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -v app_role="$RUNTIME_DB_ROLE" \
      -v pw="$RUNTIME_DB_PASSWORD" \
      -f -'

echo "[bootstrap-runtime-role] runtime role '$RUNTIME_DB_ROLE' applied and verified."
