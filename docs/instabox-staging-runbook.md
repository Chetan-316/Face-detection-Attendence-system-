# InstaBox Staging Runbook

Scope: one isolated staging stack on one InstaBox host. This is not a production deployment and is not production-certified. Commands run from the repository root unless stated otherwise. Every command below was exercised end to end on a clean Docker host before this runbook was written.

## Stack

| Service | Image | Networks | Published |
|---|---|---|---|
| `db` | postgres:16-bookworm | `data` (internal) | no |
| `migrate` (profile `ops`) | pravahax-api:staging | `data` | no |
| `seed` (profile `ops`) | pravahax-seed:staging | `data` | no |
| `api` (Node + Python biometric worker) | pravahax-api:staging | `edge`, `data` | no |
| `web` (nginx, proxies `/api/` to `api`) | pravahax-web:staging | `edge` | `${PUBLIC_HTTP_PORT:-8080}` |

The Python biometric worker runs inside `api` because the Node server spawns it as a child process.

Persistent state lives in two named Docker volumes:

| Volume | Mounted at | Contents |
|---|---|---|
| `pravahax-staging-pg-data` | `db` `/var/lib/postgresql/data` | PostgreSQL data |
| `pravahax-staging-profile-photos` | `api` `/app/data` | `profile-photos/` (resident photos) |

USB webcams are not reachable from containers. Cameras must be RTSP streams reachable from the `edge` network.

## 0. Host prerequisites

- Debian 12 with Docker Engine and Compose v2 (`docker compose version` reports v2.x).
- Git.
- Model files in a host directory. Record their SHA-256 values. Model binaries are never committed to git.

```sh
sudo mkdir -p /opt/pravahax/models
sudo cp /path/to/scrfd_2.5g_kps.onnx /path/to/adaface_ir50.onnx /opt/pravahax/models/
sha256sum /opt/pravahax/models/scrfd_2.5g_kps.onnx /opt/pravahax/models/adaface_ir50.onnx
```

Model licensing must be cleared by the license owner before staging use. The repository marks the weights as research-only.

## 1. Check out the commit being deployed

```sh
git clone https://github.com/Chetan-316/Face-detection-Attendence-system-.git pravahax && cd pravahax
git fetch origin production-hardening
git checkout <commit-hash>
git rev-parse HEAD
```

Record the commit hash in the deployment log. Never deploy from `main`. The repository ships `.gitattributes` that keeps shell and Dockerfile line endings LF, and the operator scripts are committed with the executable bit. You can still invoke them through `bash` as shown below.

## 2. Create the operator env file

```sh
cp .env.staging.example .env.staging
chmod 600 .env.staging
```

Fill every `<...>` placeholder. Generate secrets with `openssl rand -base64 48`.

- `MODELS_HOST_DIR` is the absolute host directory from step 0.
- `SCRFD_MODEL_SHA256` and `ADAFACE_MODEL_SHA256` are the values from `sha256sum`.
- `ADAFACE_COLOR_SPACE` must match the channel order used when templates were exported and enrolled (`RGB` or `BGR`). It is required and has no default.
- `CORS_ORIGIN` is the exact browser origin, for example `https://<instabox-host>` or `http://<host>:8080`.
- `MIGRATION_DATABASE_URL` uses the owner role and must end in `/pravahax_staging`.
- `RUNTIME_DATABASE_URL` uses `RUNTIME_DB_ROLE` and the same database.

The seed credentials are deliberately NOT stored in this file. Section 8 passes them in the shell for one run.

`.env.staging` is git-ignored. It stays on the host only.

## 3. Build images

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml build
```

This builds `pravahax-api:staging`, `pravahax-seed:staging` (the same runtime image plus seed tooling, for the operator-only seed run), and `pravahax-web:staging`.

## 4. Start PostgreSQL

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d db
docker compose --env-file .env.staging -f docker-compose.staging.yml ps db
```

Wait until `db` reports `healthy`. `docker compose ps` shows port `5432/tcp` for `db` with no host mapping. That is expected: PostgreSQL is reachable only on the internal `data` network.

## 5. Migrate (operator-triggered, never automatic)

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml --profile ops run --rm migrate
```

`deploy/staging/migrate.sh` runs three steps:

1. `deploy/staging/migration-gate.mjs` refuses a non-empty database with no `_prisma_migrations` history, refuses unknown applied migrations, and requires a `preflight.sql` for every pending migration.
2. `prisma migrate deploy` applies pending migrations.
3. `prisma migrate status` confirms the result. It must print `Database schema is up to date!`.

Staging uses `prisma migrate deploy` only. `prisma db push` is never used.

## 6. Create or rotate the runtime role (after every migration)

```sh
set -a; . ./.env.staging; set +a
bash deploy/staging/bootstrap-runtime-role.sh
```

The runtime role is `RUNTIME_DB_ROLE`: NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, NOINHERIT, DML only, no TRUNCATE, and no ownership of `audit_logs`. `audit_logs` is restricted to SELECT and INSERT. The script ends with a verification block that fails the run if any property does not hold. It is idempotent. Run it after every migration, because new tables would otherwise be missing grants. The script ends with `runtime role '<role>' applied and verified.`

## 7. Seed the empty staging database (one time, operator-only)

Seeding creates demo residents and staff. Run it once, on an empty `pravahax_staging` database, and only on this isolated staging stack. The seed runs on the Compose network, publishes nothing, and is never started by `up`.

The seed refuses to run unless:

- `APP_ENV` is `staging` (set by Compose),
- `SAFE_SEED_DATABASE_URL` is set and names a `pravahax_staging*` database,
- the `user` table is empty (a re-run prints `Skipping seed` and exits 0),
- `SEED_DEFAULT_PASSWORD` is at least 12 characters.

Pass both values in the shell so they are not written to disk:

```sh
read -rs -p "Owner DB URL (pravahax_staging): " SAFE_SEED_DATABASE_URL; echo
read -rs -p "One-time seed password (12+ chars): " SEED_DEFAULT_PASSWORD; echo
export SAFE_SEED_DATABASE_URL SEED_DEFAULT_PASSWORD
docker compose --env-file .env.staging -f docker-compose.staging.yml --profile ops run --rm seed
unset SAFE_SEED_DATABASE_URL SEED_DEFAULT_PASSWORD
```

Use the owner URL with the in-network host, for example `postgresql://pravahax_owner:<OWNER_PASSWORD>@db:5432/pravahax_staging?schema=public`. A `localhost` URL does not work here because `db` resolves only inside the Compose network.

Change every seeded password after first sign-in.

## 8. Create the profile-photo volume and migrate existing photos (once)

Resident photos are written to `/app/data/profile-photos` inside `api`, which is the `pravahax-staging-profile-photos` named volume. Docker seeds the volume's ownership from the image (`node:node`), so the API writes without any host chown.

Create the volume through Compose, so it carries the project labels:

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml create api
```

If this host previously ran the temporary workaround that bind-mounted `/opt/pravahax/data` to `/app/data`, copy those photos into the volume once. Skip this block on a fresh host:

```sh
docker run --rm --user root --entrypoint sh \
  -v /opt/pravahax/data/profile-photos:/src:ro \
  -v pravahax-staging-profile-photos:/dst \
  pravahax-api:staging -c 'mkdir -p /dst/profile-photos && cp -an /src/. /dst/profile-photos/ && chown -R node:node /dst'
```

Do not run `docker compose -f /opt/pravahax/docker-compose.instabox.yml` or any override that mounts `/opt/pravahax/data`. It is no longer needed.

## 9. Start the API and web services

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d api web
```

`api` does not start until `db` is healthy. Startup guards in `src/common/lifecycle.ts` refuse to boot on a placeholder or short `JWT_SECRET`, mock biometrics, a missing `*_MODEL_SHA256`, an unset `CORS_ORIGIN`, or `ALLOW_DESTRUCTIVE_SEED=true`. The API never seeds data on startup.

## 10. Verify the deployment

Container state:

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml ps
```

`db`, `api`, and `web` must show `healthy`. `migrate` and `seed` must not be running.

Liveness, readiness, and the web entry point:

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml exec api \
  node -e "fetch('http://127.0.0.1:3000/health').then(r=>console.log('health', r.status))"
docker compose --env-file .env.staging -f docker-compose.staging.yml exec api \
  node -e "fetch('http://127.0.0.1:3000/ready').then(r=>console.log('ready', r.status))"
curl -fsS -o /dev/null -w "web %{http_code}\n" http://127.0.0.1:8080/
```

Biometric worker and models (authenticated; use an Admin or Warden account). `workerReady`, `detectorLoaded`, and `embedderLoaded` must all be `true`, and `engine` must be `scrfd_adaface`:

```sh
TOKEN=$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"username":"<admin-username>","password":"<password>"}' http://127.0.0.1:8080/api/v1/auth/login \
  | node -pe 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); j.token ?? j.data?.token')
curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/api/v1/biometrics/health
unset TOKEN
```

Check `api` logs for model SHA-256 errors and worker start failures:

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml logs --tail=200 api
```

Persistent profile-photo storage (confirms `/app/data` is writable by the non-root user):

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml exec api \
  sh -c 'id -un && touch /app/data/profile-photos/.write-check && rm /app/data/profile-photos/.write-check && echo writable'
```

It must print `node`, then `writable`.

## 11. Public HTTPS

The stack publishes HTTP on host port `${PUBLIC_HTTP_PORT:-8080}` only. TLS termination is provided by the operator's reverse proxy or the InstaBox edge in front of `127.0.0.1:8080`; it is not part of this repository. The public HTTPS origin must equal `CORS_ORIGIN`, and the proxy must forward `/` and `/api/` to port 8080 unchanged.

## 12. Logs, stop, restart

```sh
docker compose --env-file .env.staging -f docker-compose.staging.yml logs -f api
docker compose --env-file .env.staging -f docker-compose.staging.yml stop
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d
```

Never run `docker compose down -v`. It deletes the `pravahax-staging-pg-data` database volume and the `pravahax-staging-profile-photos` photo volume.

## 13. Backup

Back up both volumes before every upgrade. Store the output outside the repository.

```sh
mkdir -p ~/pravahax-backups && chmod 700 ~/pravahax-backups
STAMP=$(date +%Y%m%d_%H%M%S)
docker compose --env-file .env.staging -f docker-compose.staging.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > ~/pravahax-backups/pravahax_staging_$STAMP.dump
docker run --rm --entrypoint sh -v pravahax-staging-profile-photos:/data:ro -v ~/pravahax-backups:/backup \
  pravahax-api:staging -c "tar -C /data -czf /backup/profile_photos_$STAMP.tar.gz ."
chmod 600 ~/pravahax-backups/*
```

## 14. Update (upgrade order)

1. Check out the new commit (step 1) and record its hash.
2. Back up (step 13).
3. Rebuild: `docker compose --env-file .env.staging -f docker-compose.staging.yml build`.
4. Migrate (step 5).
5. Rotate the runtime role (step 6).
6. Restart the API and web services: `up -d api web` (step 9), then verify (step 10).

Do not run the seed during an update. It refuses a populated database, and it is not part of the update path.

## 15. Known limits (not isolated-staging blockers; resolve before any production use)

- **SCRFD confidence has three values:** detector default 0.45 (`src/modules/biometrics/workers/detector.py`), compose default `SCRFD_SCORE_THRESHOLD` 0.5, and the live-path fallback 0.6 (`face_worker.py`, used when the caller passes no `min_confidence`). Calibrate and pass one value explicitly.
- **Blur gate differs:** enrollment (`quality.py`) uses 8.0; live recognition (`face_worker.py`) uses 20.0. Enrollment can accept samples that live recognition always rejects as `TOO_BLURRY`.
- **ADAFACE_COLOR_SPACE default in code is RGB,** while `render.yaml` and the research scripts use BGR. Compose requires the variable, so staging is safe, but the value must match the enrollment export.
- **Worker timeouts** mark a request abandoned but leave the worker running. A hung worker can fill the request queue until restart. There is no restart backoff.
- **Camera stream error state:** a worker crash puts a camera stream in `ERROR`, and it does not recover until the service restarts.
- **Single-camera IN/OUT toggle:** the per-resident episode state is in memory. A restart while a resident is still in view can flip a present resident to OUT.
- **Preflight files** for the applied migration `20260930130000_step08_attendance_session_camera_absent` contain a known hazard: its backfill uses `CURRENT_TIMESTAMP`. The gate refuses it on a non-empty database. A fresh staging database is unaffected.
- **Physical RTSP camera behavior** has not been validated on hardware in this deployment pass.
- **Model licensing and on-site calibration** are post-deployment blockers for production.
