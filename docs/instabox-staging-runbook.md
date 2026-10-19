# InstaBox Staging Runbook

Scope: an isolated staging stack on one InstaBox host. This is not a production deployment and is not production-certified. Commands are run from the repository root.

## Stack

| Service | Image | Networks | Published |
|---|---|---|---|
| `db` | postgres:16-bookworm | `data` (internal, no egress) | no |
| `migrate` (profile `ops`) | pravahax-api:staging | `data` | no |
| `api` (Node + Python biometric worker) | pravahax-api:staging | `edge`, `data` | no |
| `web` (nginx, proxies `/api/` to `api`) | pravahax-web:staging | `edge` | `${PUBLIC_HTTP_PORT:-8080}` |

The Python biometric worker runs inside the `api` container because the Node server spawns it as a child process. There is no separate worker service.

USB webcams are not reachable from containers. Cameras must be RTSP streams reachable from the `edge` network.

## Prerequisites (host)

- Debian 12 with Docker Engine and Compose v2 (`docker compose version` must report v2.x).
- A checkout of `production-hardening` at the commit being deployed.
- Model files in a host directory (set as `MODELS_HOST_DIR`), mounted read-only into `api`:
  - `scrfd_2.5g_kps.onnx`
  - `adaface_ir50.onnx`
  Record their SHA-256 values with `sha256sum` for `SCRFD_MODEL_SHA256` and `ADAFACE_MODEL_SHA256`. Model binaries must never be committed to git.
- Licensing for the model weights must be cleared by the license owner before staging use. The repository marks them as research-only.

## 1. Create the operator env file

```sh
cp .env.staging.example .env.staging
chmod 600 .env.staging
```

Fill every `<...>` placeholder. Generate secrets with `openssl rand -base64 48`.

- `MIGRATION_DATABASE_URL` uses the owner role and must end in `/pravahax_staging`.
- `RUNTIME_DATABASE_URL` uses `RUNTIME_DB_ROLE` and the same database.
- `ADAFACE_COLOR_SPACE` must match the channel order used when templates were exported and enrolled (`RGB` or `BGR`). It is required and has no default, so it cannot be left unset by accident.
- `CORS_ORIGIN` must be the exact browser origin, for example `http://<host>:8080`.

`.env.staging` is ignored by git. Keep it on the host only.

## 2. Build images

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml build
```

## 3. Start the database

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d db
docker compose --env-file .env.staging -f docker-compose.staging.yml ps db
```

Wait until `db` reports `healthy`.

## 4. Migrate (operator-triggered, never automatic)

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml --profile ops run --rm migrate
```

`deploy/staging/migrate.sh` runs three steps:

1. `deploy/staging/migration-gate.mjs` refuses a non-empty database that has no `_prisma_migrations` history, refuses unknown applied migrations, and requires a `preflight.sql` for every pending migration.
2. `prisma migrate deploy` applies pending migrations.
3. `prisma migrate status` confirms the result.

Staging uses `prisma migrate deploy` only. `prisma db push` is never used. Do not run the migration container on a database you have not backed up (see section 9).

## 5. Create or rotate the runtime role (after every migration)

```sh
set -a; . ./.env.staging; set +a
deploy/staging/bootstrap-runtime-role.sh
```

The runtime role is `RUNTIME_DB_ROLE`. It is NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, and NOINHERIT. It has DML only, no TRUNCATE, and it does not own `audit_logs`. `audit_logs` is restricted to SELECT and INSERT. The script ends with a verification block that fails the run if any of these properties do not hold. The script is idempotent.

Run it after every migration, because new tables would otherwise be missing grants.

## 6. Start the API and web services

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d api web
```

`api` does not start until `db` is healthy. Startup guards in `src/common/lifecycle.ts` refuse to boot on a placeholder or short `JWT_SECRET`, mock biometrics, a missing `*_MODEL_SHA256`, an unset `CORS_ORIGIN`, or `ALLOW_DESTRUCTIVE_SEED=true`.

## 7. Health checks

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml ps
docker compose --env-file .env.staging -f docker-compose.staging.yml exec api \
  node -e "fetch('http://127.0.0.1:3000/health').then(r=>console.log('health', r.status))"
curl -fsS -o /dev/null -w "web %{http_code}\n" http://127.0.0.1:8080/
```

All services should show `healthy`. Check `api` logs for model SHA-256 errors and biometric worker start failures before treating the deployment as usable.

## 8. Logs, stop, restart

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml logs -f api
docker compose --env-file .env.staging -f docker-compose.staging.yml stop
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d
```

Never run `docker compose down -v`. It deletes the `pravahax-staging-pg-data` volume and therefore the staging database.

## 9. Backup and upgrade order

Backup before every upgrade. Store the dump outside the repository.

```sh
mkdir -p ~/pravahax-backups && chmod 700 ~/pravahax-backups
docker compose --env-file .env.staging -f docker-compose.staging.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > ~/pravahax-backups/pravahax_staging_$(date +%Y%m%d_%H%M%S).dump
chmod 600 ~/pravahax-backups/*.dump
```

Upgrade order: check out the new commit, back up, `build`, `migrate` (section 4), `bootstrap-runtime-role.sh` (section 5), then `up -d api web` (section 6).

## 10. Initial admin (manual, not automatic)

Containers do not seed data. The seed tooling lives in the source checkout and is not part of the runtime image. It refuses to run unless `APP_ENV=staging`, `SAFE_SEED_DATABASE_URL` names a `pravahax_staging*` database, and the `user` table is empty. It creates demo residents and staff, so run it only on this isolated staging database:

```sh
npm ci
APP_ENV=staging SAFE_SEED_DATABASE_URL='<owner URL to pravahax_staging>' \
  SEED_DEFAULT_PASSWORD='<strong one-time password>' npm run seed:safe
```

Change every seeded password after first sign-in.

## Known limits (not isolated-staging blockers; resolve before any production use)

- **SCRFD confidence has three values:** detector default 0.45 (`src/modules/biometrics/workers/detector.py`), compose default `SCRFD_SCORE_THRESHOLD` 0.5, and the live-path fallback 0.6 (`face_worker.py`, used when the caller passes no `min_confidence`). A face scoring between them is accepted or rejected depending on the path. Calibrate and pass one value explicitly.
- **Blur gate differs:** enrollment (`quality.py`) uses 8.0; live recognition (`face_worker.py`) uses 20.0. Enrollment can accept samples that live recognition always rejects as `TOO_BLURRY`.
- **ADAFACE_COLOR_SPACE default in code is RGB,** while `render.yaml` and the research scripts use BGR. The compose file requires the variable, so staging is safe, but the value must match the enrollment export.
- **Worker timeouts** mark a request abandoned but leave the worker running. A hung worker can fill the request queue until restart. There is no restart backoff.
- **Camera stream error state:** a worker crash puts a camera stream in `ERROR`, and it does not recover until the service restarts.
- **Single-camera IN/OUT toggle:** the per-resident episode state is in memory. A restart while a resident is still in view can flip a present resident to OUT.
- **Preflight files** for the applied migration `20260930130000_step08_attendance_session_camera_absent` contain a known hazard: its backfill uses `CURRENT_TIMESTAMP`. The gate refuses it on a non-empty database. A fresh staging database is unaffected.
- **Physical camera calibration and model licensing** are post-deployment, on-site blockers for production.
