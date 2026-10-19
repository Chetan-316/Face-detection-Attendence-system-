# PRAVAHAx: Audit Errors and How to Fix Them

This document lists every error and risk found in the read-only audit of the project, with the file and line to change and the steps to fix each one. Work through the sections in order. The Critical items block any real deployment.

**Status key**

- **Verified**: I read the cited source during the audit.
- **Reported**: found by an audit agent, cited from its read. Confirm the line before changing it.

**Severity key**

- **Critical**: exploitable now, or it breaks production data or deployment. Fix before any real use.
- **High**: authorisation, data integrity, or biometric accuracy problems. Fix before pilot.
- **Medium**: correctness, robustness, or maintainability. Fix during hardening.
- **Low**: hygiene and polish.

---

## 0. Summary

| ID | Severity | Area | Title | Status |
|----|----------|------|-------|--------|
| C1 | Critical | Security | Committed JWT secret | Verified |
| C2 | Critical | Deploy | Production runs with development environment flags | Verified |
| C3 | Critical | Deploy | Schema pushed with `--accept-data-loss` on every build | Verified |
| C4 | Critical | Deploy | Seed with default passwords runs in build | Verified |
| C5 | Critical | Biometrics | Research-only SCRFD and AdaFace models in deployment | Verified (config), Reported (docs) |
| C6 | Critical | Database | `Hostel.returnDeadlineMinutes` has no migration | Verified |
| H1 | High | Authz | Null-hostel WARDEN and GUARD see all hostels | Verified |
| H2 | High | Authz | Profile photo hostel check fails open | Reported |
| H3 | High | Authz | Camera snapshot has no hostel scope check | Verified (partial) |
| H4 | High | Security | Session token and stream token in URLs | Verified (client), Reported (server) |
| H5 | High | Authz | Client-only role gates and mismatched recognition rule | Verified (client), Reported |
| H6 | High | Security | Password reset does not revoke sessions | Reported |
| H7 | High | Biometrics | Expected-pose path skips all quality gates | Verified |
| H8 | High | Biometrics | Enrolment fabricates a face box on detection failure | Reported |
| H9 | High | Biometrics | Worker parses parameters outside `try` | Verified |
| H10 | High | Biometrics | Embeddings aggregated without validation | Verified (worker), Reported (embedder) |
| H11 | High | Recognition | Frame throttle reset defeats backpressure | Verified |
| H12 | High | Biometrics | Unbounded image size | Reported |
| H13 | High | Database | Attendance check is not locked | Reported |
| H14 | High | Database | Attendance day uses UTC, not IST | Reported |
| H15 | High | Database | Audit actor deleted with `SetNull` | Reported (lines), Verified (449) |
| H16 | High | Database | Hard camera delete erases movement history | Verified (delete), Reported (FKs) |
| H17 | High | Database | First-IN movement race returns 500 | Reported |
| H18 | High | Backend | Movement event write not transactional | Reported |
| H19 | High | Ops | Shutdown uses a different camera service instance | Reported |
| H20 | High | Client | Rewrite hides API failures as `null` | Reported |
| H21 | High | Reports | Guard can read resident summary | Reported |
| H22 | High | Auth | Create-user race returns 500 | Reported |
| H23 | High | Repo | `.gitignore` hides new migration files | Verified |
| M1-M30 | Medium | Various | See section 6 | Mixed |
| L1-L20 | Low | Various | See section 7 | Mixed |

---

## 1. Critical

### C1. Committed JWT secret

- **Where:** `render.yaml:40-41`, `src/config/index.ts:26`
- **Status:** Verified
- **Problem:** The production `JWT_SECRET` is a literal string committed to git, and the code uses the same string as a fallback. Anyone with repo access can sign valid tokens for any user, including ADMIN.
- **Treat as compromised.** Assume any token signed with it can be forged.

**Fix**

1. Remove the literal value from `render.yaml`. Replace it with `sync: false` so the value is entered only in the Render dashboard:
   ```yaml
   - key: JWT_SECRET
     sync: false
   ```
2. Generate a new secret (do not commit the output):
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
   ```
   Paste it into Render, under the service's Environment tab.
3. In `src/config/index.ts`, remove the fallback on line 26. Throw at startup if the value is missing or shorter than 32 characters:
   ```ts
   const jwtSecret = process.env.JWT_SECRET;
   if (!jwtSecret || jwtSecret.length < 32) {
     throw new Error('JWT_SECRET must be set and at least 32 characters');
   }
   ```
4. Rotating the secret signs out every user. Tell staff before you deploy.
5. Optional but recommended: remove the old literal from git history with `git filter-repo`, then force-push. This rewrites history and affects all clones, so agree it with the team first.
6. Also remove the same literal from any `.env.example` or docs that show it.

**Verify:** `npm run build:server && node dist/src/index.js` with no `JWT_SECRET` set should exit with the new error.

---

### C2. Production runs with development environment flags

- **Where:** `render.yaml:28-32`
- **Status:** Verified (config). The guards that are disabled are reported in `src/common/lifecycle.ts:33-61`.
- **Problem:** `NODE_ENV=development` and `APP_ENV=development` turn off the production checks (JWT strength, mock-biometric block, CORS checks, and the seed guard).

**Fix**

Do this only after C1, C4 and C5 are fixed, and after step 2 of section 6 (move build tools to `dependencies`). Otherwise the build can break.

1. In `render.yaml`, set:
   ```yaml
   - key: NODE_ENV
     value: production
   - key: APP_ENV
     value: production
   ```
2. Confirm `src/common/lifecycle.ts` now enforces the production checks and that the app starts.
3. Confirm `/health` (or your existing health route) returns OK on Render.

---

### C3. Schema pushed with data loss allowed on every build

- **Where:** `render.yaml:16`
- **Status:** Verified
- **Problem:** `prisma db push --accept-data-loss` runs on every deploy. It changes the schema without migration history and drops data without asking. A future destructive edit to `schema.prisma` will be applied to production silently.

**Fix**

1. Fix C6 first, so the missing column is in a migration.
2. Check the production database against the migrations (read-only). Get `DATABASE_URL` from the Render dashboard, and do not paste it into chat or commit it:
   ```
   npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
   ```
   The output should be empty, apart from the C6 column.
3. If the production database was built with `db push` and has no `_prisma_migrations` table, baseline it. For each migration folder in order, run:
   ```
   npx prisma migrate resolve --applied <migration_folder_name>
   ```
   Do this only after step 2 shows the schema matches.
4. In `render.yaml`, change line 16 to:
   ```yaml
   && npx prisma migrate deploy
   ```
5. Keep `prisma migrate deploy` in the build or move it to `preDeployCommand`. The build step is fine for a free plan.

**Verify:** Add a no-op test migration on a branch database, run the build, and confirm `_prisma_migrations` lists it.

---

### C4. Seed with default passwords runs in the build

- **Where:** `render.yaml:18`, `prisma/seed.ts:19-30` and `:102`, `scripts/safe-seed.ts:8-20`
- **Status:** Verified
- **Problem:**
  - `seed:safe` runs on every build. It seeds whenever there are zero users (`safe-seed.ts:8-16`).
  - The seed creates ADMIN, WARDEN and GUARD accounts with password `Password123!` when `SEED_DEFAULT_PASSWORD` is not set (`seed.ts:102`).
  - The guard at `seed.ts:19-30` passes because `APP_ENV` is `development` (C2).
  - `safe-seed.ts:19-20` catches all errors and does not fail the build, so you may not notice a failure.
  - The seed also runs `deleteMany()` on 13 tables (`seed.ts:35-47`). It runs when the user table is empty, so if the user table is ever emptied while residents remain, a later build wipes them.

**Fix**

1. Remove `&& npm run seed:safe` from `render.yaml:18`.
2. In `prisma/seed.ts`, replace the default password with a required value:
   ```ts
   const defaultPassword = process.env.SEED_DEFAULT_PASSWORD;
   if (!defaultPassword || defaultPassword.length < 12) {
     throw new Error('SEED_DEFAULT_PASSWORD must be set (12+ characters)');
   }
   ```
3. In `scripts/safe-seed.ts`, remove the swallowed error at lines 18-21 so a failed seed exits non-zero. Also refuse to run when `APP_ENV` is `production`.
4. Make the seed refuse to run if any residents, movements, or attendance rows exist, not only when users are zero.
5. Check production now. Count the users and their roles (read-only query in the Render SQL console):
   ```sql
   SELECT username, role, status FROM "User";
   ```
   If `admin`, `warden` or `guard` exist with the default password, disable them, or change the password and rotate. Then delete any demo residents with `residentCode` `R001` to `R005` if they came from the seed.
6. If you want demo data, run the seed by hand against a non-production database only.

**Verify:** Run `npm run seed:safe` with `APP_ENV=production` and confirm it refuses and exits non-zero.

---

### C5. Research-only SCRFD and AdaFace models in deployment

- **Where:** `render.yaml:53-98`, `docs/SCRFD_ADAFACE_LOCAL_EVAL.md:20`
- **Status:** Verified (config), Reported (docs)
- **Problem:** The licence fields say "research/evaluation only" (`render.yaml:79`, `:98`). The project's own doc prohibits using these models in production. Using them in a deployed hostel system is a licence breach and a legal risk.

**Fix**

1. Decision for the product owner: choose a model whose licence allows commercial use, or do not deploy biometrics yet.
2. Until then, remove the SCRFD and AdaFace keys and the `BIOMETRIC_ENGINE` value from `render.yaml`, and set the deployment to a clearly documented non-biometric mode. Do not turn on `BIOMETRIC_MOCK` in production (`face_worker.py:60`).
3. Update the docs to state which licence each model needs and who signed off.
4. Verify the model URLs and checksums still match the files used for evaluation (`render.yaml:70-73`, `:89-92`). These were not fetched during the audit.

---

### C6. `Hostel.returnDeadlineMinutes` has no migration

- **Where:** `prisma/schema.prisma:155`
- **Status:** Verified (no migration found by grep)
- **Problem:** The field is used by `facility.routes.ts` and `organization.service.ts`. A database built from migrations (or `migrate deploy`, see C3) will not have the column, and those routes will fail.

**Fix**

1. Create a migration against a local dev database:
   ```
   npx prisma migrate dev --create-only --name add_hostel_return_deadline
   ```
2. Review the generated SQL. It should be similar to:
   ```sql
   ALTER TABLE "Hostel" ADD COLUMN IF NOT EXISTS "returnDeadlineMinutes" INTEGER NOT NULL DEFAULT 1260;
   ```
   Add a CHECK constraint if you want:
   ```sql
   ALTER TABLE "Hostel" ADD CONSTRAINT "Hostel_returnDeadline_range"
     CHECK ("returnDeadlineMinutes" BETWEEN 0 AND 1439);
   ```
3. Commit the migration folder (see H23 first, or it will be ignored).
4. Run section C3 step 2 to confirm production matches.

---

## 2. High

### Authorisation and security

#### H1. Null-hostel WARDEN and GUARD see all hostels

- **Where:** `src/api/routes/resident.routes.ts:54` and `:153`, `prisma/schema.prisma:198`
- **Status:** Verified
- **Problem:** `user.hostelId || undefined` turns "no hostel" into "no filter". The user list and summary then return every hostel's residents. The service layer (`resident.service.ts:470-496`) fails closed, so the leak is in the routes.

**Fix**

1. Add one helper, for example in `src/api/middleware/scope.ts`:
   ```ts
   export function requireHostelScope(user: { role: StaffRole; hostelId: string | null }): string | undefined {
     if (user.role === StaffRole.ADMIN) return undefined;
     if (!user.hostelId) throw new ForbiddenError('No hostel assigned to this account');
     return user.hostelId;
   }
   ```
2. Replace each `user.hostelId || undefined` with `requireHostelScope(user)`.
3. Grep for the same pattern and fix every occurrence:
   ```
   rg "hostelId \|\| undefined" src
   ```
4. Add a test: a WARDEN with `hostelId = null` gets 403 on list and summary.

---

#### H2. Profile photo hostel check fails open

- **Where:** `src/modules/residents/profile-photo.service.ts:81-84`
- **Status:** Reported
- **Problem:** The hostel check runs only when `actor.hostelId` is set, so a null-hostel actor passes.

**Fix:** Use `requireHostelScope` from H1 and always compare the resident's `hostelId` with the scope result. Fail closed.

---

#### H3. Camera snapshot has no hostel scope check

- **Where:** `src/api/routes/resident.routes.ts:430-454` (call at `:437`), `src/modules/cameras/camera.service.ts:297-310` and `:383-386`, `src/api/routes/camera.routes.ts:428` (reported)
- **Status:** Verified (service and route call), Reported (`camera.routes.ts`)
- **Problem:** A user with RESIDENT_MANAGE can pass any `cameraId`. The snapshot is taken from another hostel's camera and saved as a resident's profile photo.

**Fix**

1. In `CameraService`, add a scope assertion:
   ```ts
   public async assertCameraInScope(cameraId: string, scopeHostelId: string | undefined, organizationId: string) {
     const camera = await this.getCamera(cameraId);
     if (camera.organizationId !== organizationId) throw new NotFoundError('Camera', cameraId);
     if (scopeHostelId && camera.hostelId !== scopeHostelId) throw new NotFoundError('Camera', cameraId);
     return camera;
   }
   ```
   Return 404 rather than 403, so camera IDs cannot be probed.
2. Call it in `resident.routes.ts` before `captureSnapshot`, and in `camera.routes.ts` for every route that takes a camera ID.
3. Add a test: a WARDEN of hostel A posting a hostel B camera ID gets 404.

---

#### H4. Tokens in URLs

- **Where:** `client/src/api/cameras.api.ts:84-88` (verified), `src/api/middleware/auth.middleware.ts:77-137` (reported), `client/src/api/recognition.api.ts:116-124` (the correct pattern)
- **Status:** Verified (client), Reported (server)
- **Problem:** The session JWT is placed in the preview URL (`?token=`) and used as `<img src>`. URLs are written to access logs, browser history and referrers. The server also accepts `?streamToken=`.

**Fix**

1. Add a backend endpoint that issues a stream token: 60-second lifetime, scoped to one camera ID and one user.
2. In `cameras.api.ts`, call that endpoint and build the preview URL from the short-lived token. Do not use the session token.
3. Remove `?streamToken=` acceptance in `auth.middleware.ts`, or limit it to the stream route with a TTL check.
4. Configure the server log to redact the `token` and `streamToken` query parameters.

---

#### H5. Client-only role gates and mismatched recognition rule

- **Where:** `client/src/App.tsx:25-37` and `:55` (the `/` route has no `RoleRoute`), `client/src/App.tsx:123` (ADMIN only), `client/src/pages/RecognitionPage.tsx:135-137` (says WARDEN can start and stop)
- **Status:** Verified (client), Reported (server coverage)
- **Problem:** The UI hides links but does not block routes. A GUARD can reach the overview by typing the URL. The recognition rule disagrees between the router and the page.

**Fix**

1. Wrap `/` in `RoleRoute` in `App.tsx` with the roles allowed to see it.
2. Decide once whether WARDEN can start recognition. Then make `App.tsx:123` and `RecognitionPage.tsx:135-137` match, and make the backend route use the same permission.
3. Confirm every backend route calls `requirePermission` for its role. The server must be the enforcement point.

---

#### H6. Password reset does not revoke sessions

- **Where:** `src/api/routes/staff.routes.ts:228-276`, `src/api/middleware/auth.middleware.ts` (`requireAuth`), `src/modules/auth/auth.service.ts:30` (minimum length 6 per the audit; 8 in another path)
- **Status:** Reported
- **Problem:** After a reset, a stolen token stays valid until it expires. The minimum password length is inconsistent.

**Fix**

1. Add `tokenVersion Int @default(0)` to `User` (new migration, see C6 steps).
2. Put `tokenVersion` into the JWT payload at sign-in.
3. In `requireAuth`, compare the token's `tokenVersion` with the user's and reject on mismatch. `requireAuth` already loads the user, so this costs no extra query.
4. Increment `tokenVersion` on password reset, disable, and role change.
5. Set one minimum password length (8 or more) in one shared validator, and use it in all paths.

---

### Biometrics and recognition

#### H7. Expected-pose path skips all quality gates

- **Where:** `src/modules/biometrics/workers/quality.py:149`, `:191-200`
- **Status:** Verified
- **Problem:** When `expected_pose` is set, the sample is marked valid before the confidence, size, centring, blur and lighting checks. Enrolment can store poor frames as templates, which causes false matches later.

**Fix**

1. Remove the early return at `quality.py:191-200`. Run all gates first.
2. Use `expected_pose` only for the pose-match check.
3. Add tests with `expected_pose` set and a blurred, small or dark face. Each must be rejected.

---

#### H8. Enrolment fabricates a face box on detection failure

- **Where:** `src/modules/biometrics/workers/detector.py:100-124` (reported)
- **Status:** Reported
- **Problem:** On the expected-pose path, a failed detection returns a centred box with score 0.80. The embedder then builds a template from a region that may not contain a face.

**Fix:** On the enrolment path, return "no face" when detection fails. Delete the fabricated box, or limit it to mock mode.

---

#### H9. Worker parses parameters outside `try`

- **Where:** `src/modules/biometrics/workers/face_worker.py:225-226`
- **Status:** Verified
- **Problem:** `int(...)` and `float(...)` run before the `try` at line 228. One malformed value (for example, `"abc"`) raises an exception that kills the worker process, and every in-flight request fails.

**Fix**

Move the two lines into the `try`, or parse with defaults:

```python
try:
    min_face_size = int(cmd_data.get("min_face_size") or 50)
    min_confidence = float(cmd_data.get("min_confidence") or 0.6)
except (TypeError, ValueError) as e:
    send_response({"success": False, "error": "INVALID_PARAMS", "message": str(e), "faces": []})
    continue
```

---

#### H10. Embeddings aggregated without validation

- **Where:** `src/modules/biometrics/workers/face_worker.py:360-381` (verified); `embedder.aggregate_samples` (reported)
- **Status:** Verified (worker), Reported (embedder)
- **Problem:** The mock path accepts any array. A wrong dimension, NaN or Infinity is averaged into a template, which poisons matching for that resident.

**Fix**

```python
dim = EMBEDDER_INFO["embedding_dimension"]
if not isinstance(embeddings, list) or not (1 <= len(embeddings) <= 100):
    send_response({"success": False, "error": "INVALID_EMBEDDINGS"}); continue
arr = np.array(embeddings, dtype=np.float32)
if arr.ndim != 2 or arr.shape[1] != dim or not np.all(np.isfinite(arr)):
    send_response({"success": False, "error": "INVALID_EMBEDDINGS"}); continue
```

Apply the same checks in the real `embedder.aggregate_samples`.

---

#### H11. Frame throttle reset defeats backpressure

- **Where:** `src/modules/recognition/recognition.service.ts:525-527`
- **Status:** Verified
- **Problem:** Each client frame resets `isProcessingFrame` and `lastFrameProcessedTimestamp`, so the FPS cap and in-flight limit never apply. A client can drive the worker to full CPU.

**Fix**

Delete the two reset lines. If you need a "process next frame now" behaviour for a new session, add a one-shot flag that is cleared on the next processed frame, and keep the minimum interval check.

---

#### H12. Unbounded image size

- **Where:** `src/modules/biometrics/biometric.schemas.ts:11-18` (reported); global JSON limit `src/api/app.ts:107` (10 MB)
- **Status:** Reported
- **Problem:** `imageBase64` has no maximum. The 10 MB global limit is the only cap, and the base64 is decoded before `cv2.imdecode`.

**Fix**

Add a Zod maximum on the string length before decoding, for example `z.string().max(7_000_000)` (about 5 MB decoded). Reject an oversized frame before it reaches Python.

---

### Database and concurrency

#### H13. Attendance check is not locked

- **Where:** `src/modules/attendance/attendance.service.ts:252-264` and `:282`, `src/modules/attendance-decision/attendance-decision.service.ts:272-279` (reported)
- **Status:** Reported
- **Problem:** The session status is read without a lock. A PRESENT record can be written after `closeSession` commits CLOSED, so attendance is recorded for a closed session.

**Fix**

Inside one transaction, lock the session row first:

```ts
await tx.$queryRaw`SELECT id FROM "AttendanceSession" WHERE id = ${sessionId} FOR UPDATE`;
const session = await tx.attendanceSession.findUniqueOrThrow({ where: { id: sessionId } });
if (session.status !== 'ACTIVE') throw new ConflictError('Session is not active');
```

Then write the record in the same transaction.

---

#### H14. Attendance day uses UTC, not IST

- **Where:** `src/modules/attendance/attendance.service.ts:126` (reported)
- **Status:** Reported
- **Problem:** The attendance date is UTC midnight. Sessions opened between 00:00 and 05:29 IST are attributed to the previous day. Reports group and filter on this field.

**Fix**

1. Compute the date in the configured timezone, for example with luxon:
   ```ts
   const attendanceDate = DateTime.now().setZone(config.timezone).startOf('day').toJSDate();
   ```
   Confirm the column type first. If it is `DATE`, store the calendar date string instead.
2. Write a migration (or a one-off script) to recompute `attendanceDate` for existing rows, after backing up. Decide which rows are affected before changing them.
3. Add a test: a session opened at 00:30 IST gets the IST date.

---

#### H15. Audit actor erased on user delete

- **Where:** `prisma/schema.prisma:211, 217, 321, 345, 396-397, 423-424, 449` (`SetNull` on actor relations; line 449 verified)
- **Status:** Reported (lines), Verified (449)
- **Problem:** Deleting a user sets every `performedByUserId` to null, so the audit trail loses who did what. `audit_logs` can also be edited or deleted directly.

**Fix**

1. Change the actor relations to `onDelete: Restrict`. Use a `status = DISABLED` flow instead of delete.
2. Add a migration that blocks UPDATE and DELETE on `audit_logs`:
   ```sql
   CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
   BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql;
   CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON "audit_logs"
     FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
   ```
3. Add a test that deleting a user with audit rows is refused.

---

#### H16. Hard camera delete erases movement history

- **Where:** `src/modules/cameras/camera.service.ts:508-549`, specifically `:547` (verified); `SetNull` camera FKs at `schema.prisma:320` and `:394` (reported)
- **Status:** Verified (delete), Reported (FKs)
- **Problem:** Deleting a camera sets `cameraId` to null on movement records, so the device that recognised each movement is lost.

**Fix**

1. Add `deletedAt DateTime?` to `Camera`.
2. Change `deleteCamera` to set `deletedAt` and `isEnabled = false`, and keep the row.
3. Filter `deletedAt IS NULL` in `listCameras`, `getCamera` callers, and recognition listeners.
4. Change the camera FKs on movement records to `onDelete: Restrict`.

---

#### H17. First-IN movement race returns 500

- **Where:** `src/modules/movements/movement.service.ts:83-102` (reported)
- **Status:** Reported
- **Problem:** Presence is read, then created if missing. Two concurrent first-IN requests both try to create it, and one fails with an unmapped P2002, returning 500.

**Fix**

```ts
await tx.$executeRaw`INSERT INTO "ResidentPresence" ("residentId", "hostelId", "currentState")
  VALUES (${residentId}, ${hostelId}, 'OUT') ON CONFLICT ("residentId") DO NOTHING`;
await tx.$queryRaw`SELECT 1 FROM "ResidentPresence" WHERE "residentId" = ${residentId} FOR UPDATE`;
```

Then read and update the row inside the same transaction. Map any remaining P2002 to 409.

---

#### H18. Movement event write is not transactional

- **Where:** `src/api/routes/resident.routes.ts:250-264` (reported)
- **Status:** Reported
- **Problem:** `movementEvent.create` is inside `try {} catch {}`. Presence can be set to IN with no event recorded, and the error is hidden.

**Fix:** Put the event write and the presence update in one `$transaction`, and let errors propagate. Remove the empty catch.

---

### Operations and client

#### H19. Shutdown uses a different camera service

- **Where:** `src/index.ts:10` uses `defaultCameraService`; `src/api/app.ts:72` creates its own `CameraService` (reported)
- **Status:** Reported
- **Problem:** `shutdownAll()` may not stop the adapters that the app started, so cameras stay open after SIGTERM.

**Fix:** Pass the same instance into `createApp`, and call `shutdownAll()` on the instance the app uses. Remove the duplicate shutdown listener in `app.ts:72-73`.

---

#### H20. Rewrite hides API failures as `null`

- **Where:** `vercel.json:5-7` (root) and `client/vercel.json`; `client/src/api/client.ts:93-101` (reported)
- **Status:** Reported
- **Problem:** The rewrite sends `/(.*)` to `index.html`, so an API path that is not proxied returns HTML. `client.ts` returns `null` for any non-JSON 2xx response. If `VITE_API_BASE_URL` is wrong, calls silently return `null`.

**Fix**

1. Exclude `/api/` from the SPA rewrite.
2. In `client.ts`, throw an error when a response is not JSON, and show it in the UI.
3. Set `VITE_API_BASE_URL` in the Vercel project settings and check it in the build.

---

#### H21. Guard can read resident summary

- **Where:** `src/modules/reports/report.service.ts:996-1019` (reported); compare with the GUARD block at `:615`
- **Status:** Reported
- **Problem:** The summary lacks the GUARD restriction, so guards can see contact details and history.

**Fix:** Copy the GUARD restriction from `:615` into the summary function, and add a test.

---

#### H22. Create-user race returns 500

- **Where:** `src/modules/auth/auth.service.ts:26-87` (reported)
- **Status:** Reported
- **Problem:** `createUser` runs `findFirst` and then `create`. Two concurrent creates produce a unique-constraint error that is not mapped.

**Fix:** Rely on the unique constraint. Catch P2002 and return 409.

---

#### H23. `.gitignore` hides new migration files

- **Where:** `.gitignore:23-24`
- **Status:** Verified
- **Problem:** `*.sql` is ignored, so new `migration.sql` files do not show up in `git status` and are not committed. The three existing migrations are tracked only because they were added before the rule.

**Fix**

1. Add to `.gitignore`, after line 24:
   ```
   !prisma/migrations/**/*.sql
   ```
2. Run `git status` and confirm the migration folders appear. Commit them with the C6 migration.

---

## 3. Medium

### Authorisation and auth

- **M1. CORS allowlist bypass.** `src/api/app.ts:94-95` uses `origin.includes('localhost')` and `endsWith('.vercel.app')` with credentials. `http://localhost.attacker.tld` passes. Fix: parse the origin with `new URL()` and exact-match against an allowlist from `CORS_ORIGIN`. Remove `localhost` in production (`render.yaml:44`). *(Verified line; reported details.)*
- **M2. Regular-comer endpoint trusts `body.hostelId`.** `src/api/routes/resident.routes.ts:229-232` accepts any hostel when the caller has none. Fix: require a permission and check the hostel belongs to the caller's organisation and is active. *(Reported.)*
- **M3. Login timing leak.** `src/modules/auth/auth.service.ts:106-113` returns before `bcrypt.compare` for unknown users. Fix: always run a compare against a dummy hash. *(Reported.)*
- **M4. JWT algorithm not pinned.** `src/api/middleware/token.service.ts:51, 69`. Fix: `jwt.verify(token, secret, { algorithms: ['HS256'] })`. *(Reported.)*
- **M5. Refresh logs out on any error.** `client/src/auth/AuthContext.tsx:36` and `:58-66`. Fix: log out only on 401. Keep the session on network errors. *(Reported.)*
- **M6. Login error text.** `client/src/pages/LoginPage.tsx:53-59` shows server messages for non-401 errors, against its own comment. Fix: show a generic message. *(Reported.)*

### Biometrics and recognition

- **M7. Template matcher margin with one candidate.** `template-matcher.ts:128`: with one candidate, the margin equals the score, so there is no impostor separation. Fix: require at least two candidates for a margin check, or document the behaviour. *(Reported.)*
- **M8. Presence direction read outside the lock.** `src/modules/movement-decision/movement-decision.service.ts:284-297`. Fix: read the direction under `FOR UPDATE`. *(Reported.)*
- **M9. Rapid-transition guard only in ROLE mode.** `movement-decision.service.ts:355-374`. Fix: apply the guard to TOGGLE as well. *(Reported.)*
- **M10. Duplicate IN/OUT toggles.** `temporal-stabilizer.ts:119-129` and `recognition.service.ts:219-222`: the episode lock re-arms only after a gap, and restart clears it. Fix: persist the last decision per resident and reject a second toggle within the minimum interval. *(Reported.)*
- **M11. Stale camera role.** `recognition.service.ts:114-168`: `cameraRole` is not updated on role change, and listeners at `:155` and `:165` are never removed. Fix: refresh the role on change and unsubscribe on stop. *(Reported.)*
- **M12. Template cache invalidation lost.** `template-cache.ts:28-45, 129-144`: an `invalidate()` during an in-flight load is overwritten, so a revoked template can match for up to 45 seconds. Fix: use a version counter and discard loads started before the invalidation. Invalidation is also per process, so it does not reach other instances. *(Reported.)*
- **M13. Session lookup fallback.** `attendance-decision.service.ts:154-177`: the fallback query lacks `cameraId IS NULL`, so an unbound session can be skipped. Fix: add the filter. *(Reported.)*
- **M14. Python worker client.** `python-worker-client.ts:156-163` does not kill the process on init timeout. `:181-187` has no request IDs, so a late response answers the next request. `stop()` near `:367-386` can kill a newer process. Fix: add request IDs, kill on timeout, and track the child PID per instance. *(Reported.)*
- **M15. Webcam worker exits on one bad line.** `webcam_worker.py:80-105` calls `os._exit` on any exception. Fix: catch per line, return an error, and keep reading. *(Reported.)*
- **M16. Model download has no integrity check.** `model_loader.py:133-159` writes to the final path with no timeout, temp file or checksum. Fix: download to a `.part` file, verify SHA-256 against the value in config, then rename. *(Reported.)*
- **M17. Embedder dimension trusted.** `face_worker.py` uses `EMBEDDER_INFO` for the mock and `embedder` for the real path. Fix: assert the real embedder's output dimension at startup. *(Reported.)*

### Database

- **M18. Timestamps without time zone.** All `DateTime` columns are `timestamp(3)`. This is safe only while every writer sends UTC. Fix: move to `timestamptz(3)` in a planned migration.
- **M19. No one-attendance-per-day rule in the database.** Two GENERAL sessions on the same date can both mark a resident. Fix, if intended: partial unique index on `(hostelId, sessionType, attendanceDate) WHERE status <> 'CANCELLED'`.
- **M20. Recognition reference not unique.** `recognitionReference` on attendance records has no unique constraint. Fix: add a unique index on it, scoped to what makes it unique.
- **M21. Missing CHECK constraints.** Add:
  - `"returnDeadlineMinutes" BETWEEN 0 AND 1439`
  - `NOT "isCorrection" OR "correctionId" IS NOT NULL`
  - `"oldState" <> "newState"` (for movement corrections)
  - `"endTime" >= "startTime"` (for night-attendance windows)
- **M22. Cross-hostel integrity is application-only.** Fix: add `UNIQUE (id, "hostelId")` on residents and composite foreign keys from movement and presence tables.
- **M23. Missing indexes.** Add:
  - `attendance_sessions (hostelId, attendanceDate)`
  - `audit_logs (entityType, entityId, timestamp DESC)`
  - `movement_events (cameraId, effectiveTimestamp DESC)`
  - Indexes on foreign keys used by `SetNull` and `Restrict`
- **M24. Unbounded reads.** `audit.service.ts:85`, `presence.service.ts:70` (loads the full resident), `resident.service.ts:538`. Fix: add `take` and a cursor.
- **M25. Migration backfill drift.** `prisma/migrations/20260930130000_step08_attendance_session_camera_absent/migration.sql:11-19`: the comment promises a backfill from `startTime`, but `DEFAULT CURRENT_TIMESTAMP` stamps existing rows with the migration time. The foreign key also omits `ON UPDATE CASCADE`, which the schema implies. Fix: add an explicit `UPDATE` backfill, and align the foreign key with the schema. Do not edit an applied migration. Add a new one.
- **M26. Unbounded CSV export.** `src/modules/reports/report.service.ts:1108-1193` has no row cap, unlike the movement export at `:1244` (5,000 rows). Fix: apply the same cap, or stream the export.

### Build, config and tests

- **M27. Build tools only in devDependencies.** `package.json` puts `typescript`, `prisma` and `@types/*` in devDependencies. The Render build works only because `npm install` runs without production mode. Setting `NODE_ENV=production` (C2) would remove `tsc` and the Prisma CLI. Fix: move `typescript`, `prisma` and the type packages used in the build to `dependencies`, or use `npm ci --include=dev` in the build.
- **M28. Scripts not type-checked.** `tsconfig.json:16` excludes `scripts/`, so `scripts/safe-seed.ts` and `verify-*.ts` are never checked. Fix: add a `tsconfig.scripts.json` and run it in CI.
- **M29. Undocumented environment variables.** `APP_ENV`, `RECOGNITION_MAX_FPS`, `RECOGNITION_COOLDOWN_MS`, `RECOGNITION_HISTORY_LIMIT`, `MOVEMENT_AUTOMATION_ENABLED`, `MOVEMENT_MIN_TRANSITION_INTERVAL_MS`, `FFPROBE_PATH` and `PYTHONPATH` are read but absent from `.env.example`. `opencv-frame-source.ts:49` reads `PYTHON_PATH`, while `render.yaml:59` sets `PYTHON_BIN`. Fix: add them all to `.env.example` with defaults, and unify on `PYTHON_BIN`.
- **M30. Test database safety.** `tests/helpers/test-db.ts:10` accepts any URL containing "test". `tests/scale-benchmark.test.ts:18-19` and `tests/step-11-hardening.test.ts:27-28` bypass the check. Fix: route all tests through the helper, compare the parsed database name with an allowlist, and refuse to run against any host that is not localhost.
- **M31. Python dependencies not pinned.** `src/modules/biometrics/workers/requirements.txt` uses `>=` ranges. Fix: pin exact versions with `pip freeze` on a tested machine.

---

## 4. Client UI

- **U1. Hooks after early return.** `client/src/pages/CamerasPage.tsx:37-39` returns `<Navigate>` before hooks that start at line 43. This breaks the Rules of Hooks. Fix: move the role check below all hooks, or move it into a wrapper component.
- **U2. Duplicated modals.** `CamerasPage.tsx:1108-1776` reimplements `components/Modal.tsx`. The backdrop closes during a save (`:1521`). Fix: use `Modal.tsx` and disable backdrop close while saving.
- **U3. Oversized files.** `CamerasPage.tsx` (1,818 lines), `RecognitionPage.tsx` (1,316), `GatePage.tsx` (909). Webcam logic is duplicated across three pages. Fix: extract a `useWebcam` hook and a shared `CameraPreview` component.
- **U4. Polling without abort.** `CamerasPage.tsx:243-283` polls every 2 seconds without abort. `GatePage.tsx:243-270` rebuilds a 700 ms interval on every scan and can open an SSE stream after unmount. `RecognitionPage.tsx:407-415` overlaps polls. Fix: use `AbortController` in each effect and a single timer per effect.
- **U5. Side effects inside a state updater.** `RecognitionPage.tsx:173-181` runs side effects inside `setState`, which StrictMode calls twice. Fix: move the effect out of the updater.
- **U6. Stale presence.** `RecognitionPage.tsx:563-578` sets presence from an async read with no staleness check, so the IN/OUT label can be wrong. Fix: ignore responses for a resident that is no longer the current one.
- **U7. Overlay fixed at 640x480.** `RecognitionPage.tsx:794` and `:821`. Boxes drift on other resolutions. Fix: scale boxes from the frame's natural size to the displayed size.
- **U8. Timezone.** `client/src/utils/formatters.ts` and `GatePage.tsx:862-864` use the browser timezone, not hostel time. Fix: format with `Asia/Kolkata` (or the hostel's timezone from the API).
- **U9. Profile photos fetched without a token.** `client/src/api/residents.api.ts:224-226` sends no token. If the endpoint requires auth, images break. If it does not, face photos are public. Fix: check the backend first. If auth is required, use the stream-token pattern from H4.
- **U10. Report CSV duplication.** `client/src/api/reports.api.ts:743-817` has two near-identical CSV download functions. Fix: one helper with a parameter.
- **U11. IDs not encoded.** `client/src/api/movements.api.ts:330, 334` does not `encodeURIComponent` IDs. Fix: encode.
- **U12. Forced JSON content type.** `client/src/api/client.ts:67-73` forces `Content-Type: application/json`, which breaks `FormData`. Fix: set it only when the body is a string or plain object.
- **U13. `as any` casts.** There are 14 non-test `as any` casts. Fix: type the API responses.
- **U14. Accessibility.** The gate camera select has no label. Login inputs lack `autoComplete`. The recognition feed has no `aria-live` region. Fix: add the labels and attributes.
- **U15. Possibly dead page.** `AttendancePage.tsx` is not imported in `App.tsx` (verify, then delete or route it).
- **U16. Duplicated bridges.** `attendance-bridge.ts` and `movement-bridge.ts` are near-duplicates. Fix: extract the shared part.
- **U17. Alias.** `client/src/api/residents.api.ts` aliases `getResidents` to `listResidents`. Fix: keep one name.

---

## 5. Low

- **L1. Input validation gaps.** `attendance.routes.ts` POST `/sessions` has no Zod. `report.routes.ts:38-39, 147-148` uses `parseInt` without a NaN check. `movement.routes.ts:326-327, 358-359`. Fix: Zod on each route.
- **L2. Error mapping.** `src/api/app.ts:168-189` maps only `AppError`, so malformed JSON and oversized bodies return 500 instead of 400 and 413. Fix: map `SyntaxError` from body parsing to 400 and `PayloadTooLargeError` to 413.
- **L3. Visitor code collisions.** `resident.routes.ts:235` uses the last four digits of `Date.now()`. Fix: use `crypto.randomInt` with a uniqueness retry.
- **L4. Backdated return time.** `night-attendance.service.ts:148-151` checks the upper bound on `effectiveReturnTime` but not the lower. Fix: add the lower bound.
- **L5. Internal error text returned.** `movement-decision.service.ts:419-470` returns `err.message` as the reason. Fix: return a fixed code and log the detail.
- **L6. Orphaned profile photos.** `profile-photo.service.ts:114` writes the file before the database update. Photos are on local disk, which is likely ephemeral on Render. Fix: write the DB row first in a transaction, and store photos in object storage.
- **L7. Mock fallback default.** `face_worker.py:60` defaults to off, and `render.yaml:56` sets it to `"false"`. Not exploitable by default. Keep it off and add a startup check that refuses mock in production.
- **L8. Duplicate `Modal` naming.** See U2.
- **L9. Confidential document in the repo.** `PRAVAHAx_Hostel_Face_Recognition_PRD_v2.pdf` is untracked, not ignored, and marked confidential. Fix: decide whether it belongs in the repo. If not, move it out, and add it to `.gitignore`.
- **L10. Acceptance screenshots.** `docs/acceptance_screenshots/*.png` are tracked and were not viewed. Fix: check for real residents' faces. If present, remove them from git and add the folder to `.gitignore`.
- **L11. Configuration hygiene.** `README.md:99-101` shows a Postgres password literal (probably a placeholder). Fix: use `<password>`.
- **L12. Local token file.** `client/.env.local` contains a `VERCEL_OIDC_TOKEN`. It is gitignored. Fix: confirm it is not in git history, and rotate the token if it ever was.
- **L13. Stale comments in tests.** Fix: review comments in `tests/` after the changes above.
- **L14. Mixed dependency pins.** Review `package.json` ranges for the runtime dependencies once C2 is fixed.

---

## 6. Order of work

1. **Stop the bleeding:** C1 (rotate the JWT secret), C4 (remove the seed from the build and rotate or disable default accounts). Check production users now.
2. **Fix the deploy:** H23 (`.gitignore`), C6 (missing migration), C3 (`migrate deploy`), M27 (build tools), then C2 (production flags), then C5 (licensing decision).
3. **Close authorisation gaps:** H1, H2, H3, H4, H5, H6, M1.
4. **Harden biometrics:** H7, H8, H9, H10, H11, H12, then M7 to M17.
5. **Fix concurrency and data integrity:** H13 to H18, H15 (audit trail), H16 (camera soft delete), then M18 to M26.
6. **Fix client and ops:** H19, H20, H21, H22, then U1 to U17.
7. **Hygiene:** Low items, then the PRD gaps in section 8.

---

## 7. Commands to run before merging

These were not run during the audit. Run them on a branch and attach the output to the pull request.

```
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.build.json --noEmit
npm test
npm --prefix client run lint
npm --prefix client run build
python -m pip install -r src/modules/biometrics/workers/requirements.txt
python -m pytest -q
```

Confirm `npm ci` works on a clean clone. The committed `package-lock.json` does not match `package.json` until the `tsx` change is committed (see section 9).

---

## 8. Gaps against the PRD

Confirm each item against the PRD PDF before acting. The PDF was not read directly during the audit.

- **Direction from camera role, not zone crossing.** The PRD requires IN and OUT from crossing virtual zones A and B. The code takes direction from the camera role (`movement-decision.service.ts:184` and `:295`). Fix: decide with the product owner whether to build zone crossing or record this as a documented limitation. The camera role should be supporting evidence only.
- **No multi-person tracking.** `temporal-stabilizer.ts` smooths per identity. The PRD requires that one uncertain person does not block others. Fix: track each detected face separately.
- **No offline operation.** The PRD requires gates to keep working through an internet outage. Fix: add a local queue on the gate machine with sync when the connection returns.
- **Model choice.** The PRD specifies ArcFace R50. The code uses AdaFace IR50 or SFace. Fix: resolve with C5.
- **OpenVINO not present.** Not in `requirements.txt`. Fix: confirm whether it is still required.
- **No pilot-validation checklist** in `src` or `client/src`. Fix: add an admin checklist, or link to the checklist in `docs/SCRFD_ADAFACE_LOCAL_EVAL.md`.

---

## 9. Uncommitted changes

| File | Status | Action |
|------|--------|--------|
| `client/src/__tests__/CamerasPage.test.tsx` | Matches current UI | Safe to commit |
| `package-lock.json` | Adds `tsx`, which `package.json` already lists | Safe to commit. Required for `npm ci` |
| `client/src/pages/GatePage.tsx` | Falls back to any enabled camera, including GENERAL, which never records automatic movements (`movement-decision.service.ts:184-191`) | Fix the fallback to use only IN or OUT cameras, then commit |
| `prisma/seed.ts` (line 90) | Laptop Webcam role changed from GENERAL to IN | Keep only as a documented demo choice. The PRD rejects camera-based direction. Revert if the seed is no longer run in production |
| `PRAVAHAx_Hostel_Face_Recognition_PRD_v2.pdf` | Untracked, confidential | See L9 |

---

## 10. Not verified

- The Hugging Face model URLs and checksums in `render.yaml` were not fetched.
- `scripts/safe-seed.ts` was read in full. The `verify-*` scripts were not.
- `camera.service.ts` `getCamera` scope, `camera.routes.ts`, `recognition.routes.ts`, `biometric.routes.ts`, and `face-enrollment.routes.ts` were not fully read.
- `src/common/lifecycle.ts`, `auth.middleware.ts`, `profile-photo.service.ts`, and `staff.routes.ts` were read by audit agents only.
- Tests were not run.
- The PRD PDF was not read.
- `AttendancePage.tsx` reachability was taken from an agent read.
- No `.env` or `client/.env.local` contents were read or reproduced.
