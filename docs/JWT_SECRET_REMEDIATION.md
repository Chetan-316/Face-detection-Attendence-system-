# JWT Secret Remediation (Runbook, Not Executed)

## Status

A hardcoded JWT signing literal was committed to git history in these commits:

- `f3c5b51` feat: complete Step 01 foundation
- `29b2165` fix: harden cross-hostel integrity and atomic attendance workflows
- `47f271e` chore: complete production hardening and final QA
- `3f9daf3` feat(deploy): add Render blueprint and production build config

The literal has been removed from the current tree. `src/config/index.ts` reads `JWT_SECRET` from the environment only, and `src/common/lifecycle.ts` refuses production startup for weak, placeholder, or short secrets.

Treat the literal as compromised. Anyone with read access to the repository history can forge tokens for any deployment that still uses it.

This runbook has not been executed. Each step below requires explicit owner approval.

## 1. Rotate the production secret (Render)

1. In the Render dashboard, open the `pravahax` web service, then Environment.
2. Replace `JWT_SECRET` with a new value generated outside the repository, for example `openssl rand -base64 48`.
3. Save. Render redeploys. Existing tokens signed with the old secret stop verifying as soon as the new process starts.
4. Do not write the new secret into any file, commit, chat, or ticket.

## 2. Invalidate existing sessions

Rotating the secret already invalidates signed tokens. As defense in depth, bump `users.tokenVersion` so any token issued under a previous session model is rejected. The column exists (`20261017100300_user_token_version`).

Run only against the production database, only after approval, and after taking a backup:

```sql
UPDATE "users" SET "tokenVersion" = "tokenVersion" + 1;
```

Preflight (read-only): `SELECT COUNT(*) FROM "users";` to confirm the number of accounts that will be forced to sign in again.

## 3. Remove the literal from git history

This rewrites history and changes every commit hash. It requires explicit approval for a force-push, and every collaborator must re-clone afterward.

1. Make a full mirror backup first: `git clone --mirror <remote> pravahax-backup.git`.
2. Use `git filter-repo` (preferred) or BFG Repo-Cleaner to replace the literal with `REDACTED`:
   ```
   git filter-repo --replace-text expressions.txt
   ```
   where `expressions.txt` contains `<OLD_JWT_LITERAL>==>REDACTED` and is kept outside the repository. The owner supplies the literal from the offline record; it is never written into the repository.
3. Verify locally: `git log --all -S "<OLD_JWT_LITERAL>" --oneline` returns nothing.
4. Only after explicit owner approval: `git push --force-with-lease --all` and `git push --force-with-lease --tags`.
5. Notify all collaborators to re-clone. Old clones still contain the literal and must not be pushed back.
6. Ask the hosting provider to garbage-collect cached objects, and consider the old repository state exposed if it was ever public.

## 4. Confirm

- New production token is accepted; a token signed with the old literal is rejected (test with a locally forged token against a staging instance only).
- `npm test` for the server passes, including `tests/step-11-hardening.test.ts` production guard cases.
- The literal does not appear in the current tree: `git grep -n "<OLD_JWT_LITERAL>"` returns nothing. The guard test uses a synthetic `dev_secret_*` fixture that is still rejected by the `dev_secret` marker.

## Owner decisions required

- Approval window for the Render secret rotation and the `tokenVersion` bump.
- Approval for the force-push in step 3.
- Whether the repository has ever been public.
