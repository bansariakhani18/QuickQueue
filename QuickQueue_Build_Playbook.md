# QuickQueue V1 — Build Playbook
**Coding agent: any AI coding agent capable of reading/editing files in this repository and running terminal commands (CLI-based, IDE-integrated, or otherwise). Reference: `SRS.md` (frozen, single source of truth).**

This playbook takes a QuickQueue project from an empty folder to a deployed, tested V1. It must work correctly in **two different starting situations**, and every agent using it must first determine which situation applies:

1. **Fresh start** — an empty folder, no repository, nothing built yet.
2. **Resume / handoff** — an existing, partially-built repository (possibly built using ad hoc prompts rather than this Playbook, and possibly by a different coding agent that is no longer available) that a new agent is picking up mid-project.

Nothing in this playbook assumes a specific coding agent, IDE, CLI, model, or vendor, and nothing in it assumes the executing agent has any memory of prior sessions — including sessions run by a *different* agent. **The repository itself, not any conversation history, is the only reliable source of truth about what has actually been done.**

---

## Part 1 — Mandatory First Step: Determine Actual Project State

Before doing anything else — before Phase 0, before assuming any phase is "next," before touching any file — every agent picking up this project must run a **State Discovery Pass**. **The State Discovery Pass is strictly read-only: do not create, modify, delete, restore, reset, stage, stash, or commit any files during this pass.** This applies even if a human tells the agent "we're on Phase N" or "the previous agent finished Phase N": verify it directly rather than trusting the claim, because prior reports (including this Playbook's own "Changes made" notes from a previous editing pass) can be stale, incomplete, or produced by a session that never actually ran verification.

### 1.1 State Discovery checklist

Run, in order:

1. `git log --oneline -30` and `git status` — is there a repository at all? What's the HEAD commit and message? What is staged, unstaged, or untracked?
2. `git diff` (and `git diff --stat` for a quick overview) — what do the uncommitted changes actually contain?
3. List the repository structure (`backend/`, `frontend/`, `docs/`, `SRS.md`, config files) — which of the expected directories/files from Phase 0's structure actually exist?
4. If `backend/` exists: inspect `backend/package.json`, `backend/src/`, `backend/prisma/` (schema, migrations folder), `backend/.env` / `.env.example`, and any test files. Do not assume — open and read them. **During a resume/handoff, if `backend/.env` or any other existing `.env` file is present, do not overwrite, regenerate, delete, or replace it during state discovery; preserve its contents and treat it as existing project state unless the human explicitly approves a change.**
5. If a database is reachable locally (check `docker-compose.yml` for the actual configured port — **do not assume port 5432**; a machine may have a native PostgreSQL install already occupying 5432, in which case the project's Docker Postgres may be deliberately mapped to a different host port), connect and inspect the actual schema (`npx prisma studio`, or direct `psql`/SQL) rather than only reading `schema.prisma`.
6. Check for `docs/PROGRESS.md`. If it exists, read it — but treat it as a claim to verify against the above, not as ground truth on its own. If it doesn't exist, that does **not** mean no work has been done; it may simply mean the project wasn't previously run through this Playbook's process (e.g., it was built via ad hoc prompts to a different agent).
7. Check any other `docs/` files (e.g. a development/setup doc) for staleness — compare what they claim against what you actually observed in steps 1–6. Flag any doc that describes a state that no longer holds (e.g., a doc claiming a phase "hasn't begun" when the repository shows it has, or a doc citing a port/config value that doesn't match the actual `docker-compose.yml`/`.env.example`). Do not modify it during the read-only State Discovery Pass.

### 1.2 Map findings to Playbook phases

Once you know what actually exists, map it against the Phase list in Part 4 below to determine, phase by phase, one of three statuses: **complete and verified**, **partially done / needs verification**, or **not started**. Do this explicitly — write it down (this becomes the basis for `docs/PROGRESS.md`, see 1.3).

Rules while doing this:

- **During a resume/handoff, never reset, restore, discard, clean, stash, overwrite, or otherwise remove existing uncommitted or untracked work merely to obtain a clean working tree. Inspect and preserve it until the human decides what to do with it.**
- **Never blindly restart or redo a phase** that inspection shows is already substantively complete. Verify it (run its tests, hit its endpoints, inspect its schema) rather than re-implementing it from scratch.
- **Never assume a phase is complete** just because a later phase's artifacts exist or because a document says so — verify directly.
- If a phase appears partially done (e.g., files exist but don't run, or a migration exists but wasn't applied), treat it as **in progress**, not complete or not-started — finish/fix it against the SRS rather than discarding and rebuilding, unless what exists actively contradicts the frozen SRS, in which case stop and ask the human before overwriting it.
- If local environment specifics were deliberately changed from a plausible "default" (for example, a database port remapped because the default port is already in use by another local service), **treat that deliberate change as the current correct configuration**, not as drift to be reverted. Confirm the change is applied *consistently* across every file that references it (`docker-compose.yml`, `.env.example`, any backend config/docs) — a value changed in one place but not the others is the actual bug to fix, not the change itself.

### 1.3 Create or correct `docs/PROGRESS.md` after audit approval

**Do not create or modify `docs/PROGRESS.md` during the initial State Discovery Pass.** First report the discovered project state to the human and obtain approval to proceed. Only after that approval, if `docs/PROGRESS.md` does not exist, create it populated with the real state determined above (not a fresh "Phase 0" starting point if work already exists). If it exists but is stale or wrong, correct it after approval. From that point on, treat `docs/PROGRESS.md` as required reading and required updating for every phase, per the Standard Phase Protocol below.

Also correct any other stale documentation found in step 1.1 above as an immediate, standalone fix **after the initial audit has been reviewed and approved** — do not leave known-false statements sitting in the repo's docs while working on unrelated phases.

---

## Part 2 — How This Workflow Actually Runs

Because different coding agents do not share conversation history with each other — and even the same agent may not retain context between sessions, and an agent may become unavailable (rate-limited, deprecated, or otherwise inaccessible) partway through the project — **the repository itself is the only reliable source of continuity.** Every phase must be executable by an agent that has never seen this project before, working entirely from: `SRS.md`, this Playbook, the actual files in the repository, Git history/status/diff, existing tests, existing configuration, and existing migrations/database state. No phase prompt below relies on an agent "remembering" anything from an earlier conversation, and none of it assumes the same agent will be available for the next phase.

### The Standard Phase Protocol

Every phase in this playbook follows the same loop, and every phase prompt should be understood as implicitly including the following instructions to the coding agent, even where not repeated verbatim:

1. **Run the Part 1 State Discovery Pass first** (or re-confirm it if it was already run this session) — do not assume the phase you're about to start hasn't already been partially or fully done by an earlier session or a different agent.
2. **Read `SRS.md` in full, or at minimum the sections relevant to this phase, before making any change.** Treat it as authoritative and frozen — do not deviate from it, simplify it, or "improve" on it based on the agent's own preferences.
3. **Read this Playbook's description of the current phase**, and skim the phases before and after it for context.
4. **Inspect the existing repository before changing anything**: read the relevant existing files, run `git log --oneline -20`, `git status`, and `git diff` to understand what already exists and what state the working tree is in.
5. **Preserve completed work.** Do not blindly rewrite working code, reset or discard existing changes, or overwrite existing implementation without first inspecting and understanding it. If something looks wrong or inconsistent with the SRS, flag it and ask before overwriting it, rather than silently replacing it.
6. **Make changes only for the current phase.** Do not implement future phases early, and do not modify files unrelated to the current phase's scope.
7. **Do not invent requirements not present in `SRS.md`.** If a phase prompt seems to require a decision the SRS doesn't cover, stop and ask rather than guessing or introducing a new architectural choice.
8. **Do not make architectural changes based on the agent's own preferences.** The stack, schema, security model, and product decisions are frozen. A coding agent's opinion that a different library, pattern, or structure would be "better" is not a reason to deviate. This includes local environment accommodations already made for good reason (e.g., a non-default database port) — do not "fix" those back to a generic default.
9. **Run the required tests, typechecks, and builds for the phase**, and do not report a phase as complete because the implementation "looks correct" without having actually run verification.
10. **At the end of the phase, report:**
    - exactly what was completed,
    - anything left incomplete or uncertain (including any place real-world behavior — especially Meta/WhatsApp behavior — differed from what was assumed, per the SRS's "External Validation Dependency" markers),
    - the current `git status` and a summary of `git diff`,
    - an update to `docs/PROGRESS.md` reflecting the phase's status.
11. **Stop.** Do not proceed to the next phase, and do not commit automatically — committing is a decision made by the human running this playbook, not the agent, unless a specific phase prompt explicitly says otherwise.

### `docs/PROGRESS.md` — the handoff document

Maintain a single running file, `docs/PROGRESS.md`, updated at the end of every phase, recording: which phases are complete (and how that was verified, not just asserted), which phase is in progress, any open questions or uncertain outcomes (especially real Meta/WhatsApp behavior discovered during testing that the SRS had marked as an External Validation Dependency), any deviation from the original phase plan and why, and any deliberate local-environment accommodations (e.g., a non-default port) so a future agent doesn't mistake them for drift. This file, together with Git history, is what lets a completely new coding agent — one with no access to any prior conversation, and possibly replacing an agent that became unavailable mid-project — pick up exactly where the last one left off without redoing or breaking existing work.

### The loop, in short

1. **You** give the coding agent the phase's prompt (provided below — copy/paste it, or adapt it to whatever interface your agent uses).
2. **The agent** runs the State Discovery Pass, inspects the relevant part of the repo, makes a scoped change (or, if the phase is already done, verifies it and says so), runs tests/build/typecheck, and reports what it changed, what remains uncertain, and updates `docs/PROGRESS.md`.
3. **You** read the diff (`git diff`), skim the reported changes, and actually run the app locally where relevant — don't just trust the report.
4. **You** decide whether to commit. Only once committed do you move to the next phase's prompt.

Never queue up multiple phase prompts at once. Never accept "I've implemented the whole backend" as a single unreviewable blob — if a coding agent ever produces a sprawling, multi-concern diff for what should have been a scoped phase, stop, ask it to explain what it touched and why, and consider reverting (`git checkout -- .` before you've committed) and re-running the phase with a narrower prompt, possibly with a different agent if the current one is struggling to stay scoped or has become unavailable.

---

## Part 3 — Phase 0: Zero to First Local Run (Windows)

**If you are resuming an existing project, do not re-run this phase mechanically.** Use it as a checklist to confirm the foundation is actually in place (repo initialized, GitHub remote configured, project structure created, Docker Postgres running) — most or all of it may already be done. Only perform the specific steps that inspection shows are missing.

Run these in **PowerShell**, in the folder where the project lives (e.g., `C:\dev\quickqueue`).

### 0.1 Install required software

| Tool | Why | Verify |
|---|---|---|
| Node.js LTS | Frontend/backend runtime | `node -v` → shows a version |
| Git | Version control | `git --version` |
| Docker Desktop | Local PostgreSQL | `docker --version` (Docker Desktop must be running) |
| VS Code (or your preferred editor/IDE) | Editing environment | — |
| GitHub CLI (optional but recommended) | Easier repo creation | `gh --version` |
| Your chosen AI coding agent | Executes the phases in this playbook | Follow that tool's own installation and authentication instructions — this playbook does not assume which one you're using. Confirm it can (a) read and edit files in this repository, and (b) run terminal commands in this repository, before starting Phase 1. |

Run each verify command. If any fails, install that tool before continuing — do not proceed with a missing tool "for now."

### 0.2 Create the project folder and Git repo

```powershell
mkdir C:\dev\quickqueue
cd C:\dev\quickqueue
git init
```
Successful result: `Initialized empty Git repository in C:/dev/quickqueue/.git/`

### 0.3 Create the GitHub repository

```powershell
gh auth login
gh repo create quickqueue --private --source=. --remote=origin
```
If you don't have `gh`, create the repo manually on github.com, then:
```powershell
git remote add origin https://github.com/<your-username>/quickqueue.git
```

### 0.4 Project structure

QuickQueue is two applications in one repo (a simple, standard structure — not a complex monorepo tool):

```
quickqueue/
  backend/       ← Node.js + TypeScript + Express + Prisma
  frontend/      ← React + TypeScript + Vite
  docs/          ← developer documentation (Part 13) + PROGRESS.md (Part 2)
  SRS.md         ← copy of the frozen SRS, for the coding agent to read
  .gitignore
  README.md
```

```powershell
mkdir backend, frontend, docs
```

Copy your frozen `QuickQueue_SRS_Final.md` into the repo root as `SRS.md`. **This is not optional** — whichever coding agent you use should read this file at the start of every phase, and every prompt below tells it to.

### 0.5 Root `.gitignore`

Create `.gitignore` in the repo root:
```
node_modules/
.env
.env.local
dist/
build/
*.log
```

### 0.6 First commit

```powershell
git add .
git commit -m "chore: initial project structure and SRS"
git push -u origin main
```

### 0.7 Local PostgreSQL via Docker

Create `docker-compose.yml` in the repo root. **Choose the host port deliberately, and only after checking for a conflict.** Windows machines that already have a native PostgreSQL install listening on `5432` cannot also bind Docker's Postgres to `5432` — in that case, map the container's `5432` to a free host port instead (this project currently uses **`5433`** for exactly this reason: `POSTGRES_PORT=5433` in `.env.example`, and `DATABASE_URL=postgresql://quickqueue:quickqueue_dev_only@localhost:5433/quickqueue?schema=public`). Whatever port is chosen, it must match, consistently, across `docker-compose.yml`, `.env.example`/`backend/.env`, and any documentation that mentions it — a mismatch between these is a bug to fix immediately, not a stylistic choice to leave alone.

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: quickqueue
      POSTGRES_PASSWORD: quickqueue_dev_only
      POSTGRES_DB: quickqueue
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```
```powershell
docker compose up -d
```
Successful result: `docker ps` shows a running `postgres:16` container, listening on whichever host port was configured (confirm with `docker ps` output, not assumption). This is your local database for the entire project — the same major version (16) you will use in production, per the frozen SRS's environment-parity requirement.

You now have an empty repo, Git, GitHub, and a running local database. **Commit this**, then proceed to Phase 1.

> **Note for resumed projects:** if `docker-compose.yml`, `.env.example`, `backend/package.json`, or `package-lock.json` currently show as *uncommitted* changes in `git status`, that does not necessarily mean they're wrong — it means a human needs to review and commit them (per the Standard Phase Protocol, committing is always a human decision). Read the actual diff before assuming anything is broken or incomplete.

---

## Part 4 — Development Phases and Agent Prompts

Each prompt below is written to be given to whichever coding agent you're currently using — copy it as-is, or adapt its delivery to your tool's interface (a CLI prompt, a chat panel inside an IDE, a task description, etc.). Every prompt assumes the agent will follow the Standard Phase Protocol from Part 2 (including the State Discovery Pass from Part 1) in addition to the phase-specific instructions given. **For any phase, if State Discovery shows the phase's goal is already substantially met, the agent's job is to verify it thoroughly against the SRS and this phase's acceptance criteria — filling any real gaps found — not to redo it from scratch.**

Every prompt tells the agent to read `SRS.md` first — this is deliberate and should never be dropped, even once the codebase is large, because it's the anchor that prevents scope drift, and it's the only way a new agent with no shared history can start from the correct baseline.

### Phase 1 — Backend Skeleton

**Goal:** a running Express + TypeScript server with a health check, connected to nothing else yet.

```
Follow the Standard Phase Protocol, starting with the State Discovery Pass: inspect backend/ directly (package.json, src/, tsconfig.json) to determine whether this phase is already done, partially done, or not started — do not assume based on a prior report. Read SRS.md fully before doing anything else, and check whether docs/PROGRESS.md exists and is accurate — if not, create or correct it now as the running record of phase status for this project.

If the backend skeleton does not yet exist, in the backend/ folder, set up a Node.js + TypeScript + Express project:
- package.json with TypeScript, Express, ts-node-dev (or tsx) for local dev, and appropriate @types packages
- tsconfig.json with strict mode enabled
- A minimal src/index.ts that starts an Express server on a PORT from environment variables (default 4000)
- A GET /health endpoint that returns 200 with a simple JSON body (no database check yet — that comes in a later phase)
- An npm script "dev" that runs the server with hot reload, and a "build" script

If the skeleton already exists (fully or partially), verify each of the above pieces actually works — run the dev server yourself and confirm /health responds — and fill in only what's genuinely missing or broken. Do not rewrite working code.

Do not add any database, ORM, authentication, or business logic yet — this phase is only the skeleton and the health check.

Report exactly what files you created or verified, confirm the health check worked, note anything incomplete or uncertain, show the current git status/diff, and update docs/PROGRESS.md to record Phase 1's true status. Then stop — do not begin Phase 2.
```

**Verify:** run `cd backend && npm run dev`, visit `http://localhost:4000/health` yourself in a browser or with `curl`. **Commit.**

### Phase 2 — Database Schema and First Migration

**Goal:** the exact schema from Section 14 of the SRS, migrated into your local Postgres, with the hand-written partial unique index applied.

```
Follow the Standard Phase Protocol, starting with the State Discovery Pass: inspect backend/prisma/ directly (schema.prisma, migrations/ folder), check the installed Prisma/@prisma/client versions in backend/package.json, and — if a database is reachable — inspect the actual live schema (npx prisma studio, or direct SQL against pg_indexes / information_schema) to determine what already exists. Do not assume this phase is either "done" or "not started" without checking directly; a prior agent (which may no longer be available to ask) may have completed some or all of it.

Read SRS.md Section 14 (Database / Data Model) carefully — this is the authoritative schema. Do not invent, simplify, or "improve" any part of it.

If Prisma is not yet set up:
- Install Prisma and @prisma/client
- Initialize Prisma with the PostgreSQL provider
- Set DATABASE_URL in backend/.env to connect to the local Docker Postgres, using whatever host port docker-compose.yml and .env.example actually specify for this project (confirm the real value rather than assuming 5432 — this project may deliberately use a different port, e.g. 5433, if the default is already occupied by a native local Postgres install).
- Copy the exact schema.prisma content from SRS.md Section 14.2 into backend/prisma/schema.prisma — every enum, every model, every field, every index, exactly as written. Do not rename fields, change types, or add fields that are not in the SRS.
- Run the first migration (prisma migrate dev --name init) against the local database.
- After the migration is generated, find the new migration SQL file and add the hand-written partial unique index from SRS.md Section 14.2 ("Hand-added migration SQL") to the end of that same migration file, exactly as written in the SRS. Re-run the migration if needed so it actually applies.

If Prisma, the schema, and a migration already exist (as State Discovery may show), do NOT regenerate or re-run migrations blindly. Instead, verify:
- schema.prisma matches SRS.md Section 14.2 exactly, field for field
- the migration in backend/prisma/migrations/ was actually applied to the local database (check via prisma migrate status or by querying the database directly)
- DATABASE_URL in backend/.env / .env.example matches the port docker-compose.yml actually exposes, and that the Docker Postgres container is actually running and reachable on that port

Verify the result regardless of which path above applied: connect to the local database (via `npx prisma studio` or a direct psql query) and confirm all five tables exist (restaurants, whatsapp_connections, orders, notification_attempts, notification_opt_outs), and confirm the partial unique index exists by querying pg_indexes for "one_active_attempt_per_order".

Report the exact verification output, not just "it worked" or "it was already done." Note anything incomplete, uncertain, or inconsistent (e.g., a port mismatch between files). Show git status/diff, including whether backend/prisma/ is currently tracked or untracked in git. Update docs/PROGRESS.md. Stop.
```

**Verify yourself:** don't just trust the report — open Prisma Studio (`npx prisma studio` in `backend/`) and look at the five tables with your own eyes. Confirm the migration file in `backend/prisma/migrations/` contains the partial unique index SQL. **Commit**, including the migration files (never gitignore migrations) and the previously-untracked `backend/prisma/` directory if it isn't tracked yet.

### Phase 3 — Authentication Core

**Goal:** restaurant signup/login, password hashing, HTTP-only session cookie, `sessionVersion` validation. No password reset yet (that's Phase 4).

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Read docs/PROGRESS.md and inspect the repository to confirm Phases 1–2's actual state before proceeding — do not trust the log alone. Read SRS.md Sections 9.1 and 17 before starting. Implement exactly the authentication model described there — nothing more.

In backend/, implement:
- POST /auth/login: accepts email + password, verifies against the hashed password in the restaurants table (use bcrypt or argon2 — pick one, install it, and use it consistently), and on success issues an HTTP-only, secure session cookie. The cookie payload must include the restaurant's id and the sessionVersion value at the time of login (sign the cookie so it cannot be tampered with — use a signed/encrypted cookie approach, e.g. cookie-session or a signed JWT stored in an HTTP-only cookie; choose one and use it consistently).
- POST /auth/logout: clears the session cookie.
- Authentication middleware that: reads and verifies the session cookie, looks up the restaurant, compares the cookie's sessionVersion to the restaurant's current sessionVersion in the database, and rejects the request (401) if they don't match or the cookie is invalid/missing. This middleware must attach the authenticated restaurant's id to the request for downstream handlers to use — this is the ONLY source of restaurantId for any authenticated route in this entire application, per SRS NFR-001. Do not accept restaurantId from any request body, query string, or path parameter anywhere in this codebase, now or in any future phase.
- A minimal way to create a restaurant account for local testing purposes (a POST /auth/signup endpoint is fine for now, matching FR-002 and FR-006 — email must be unique, password must be hashed before storage).

Write tests covering: successful login, wrong password, login with an already-used email at signup, and a request with no cookie being rejected by the middleware.

Run the tests and the TypeScript build. Report the results and exactly which files you created or changed, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify:** run the test suite yourself. Manually hit `/auth/signup` and `/auth/login` with a tool like `curl` or Postman/Insomnia and confirm a cookie is actually set. **Commit.**

### Phase 4 — Password Reset

**Goal:** FR-007 end to end, including `sessionVersion` invalidation.

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current state of Phase 3's work by inspecting the repository directly. Read SRS.md FR-007 exactly. Before writing code, state: which transactional email provider will be used for sending the reset link in local development, and how will a real email provider account be avoided just to test this locally? (Expected approach: use a fake/console-logging email sender in development that prints the reset link to the terminal, with a real provider swapped in only at deployment time via an environment-based abstraction — implement it that way.)

Implement:
- POST /auth/password-reset/request: given an email, if a matching restaurant exists, generate a cryptographically random token, store only its hash and an expiry on the restaurant record, and "send" the reset link (console-log it in development) containing the raw token. If a prior unexpired reset token exists for this restaurant, it must become invalid the moment the new one is issued (per FR-007 — only the most recent token is ever valid). Always return the same success response whether or not the email matched, so this endpoint cannot be used to enumerate valid restaurant emails.
- POST /auth/password-reset/confirm: given the raw token and a new password, look up the restaurant whose stored token hash matches, verify it hasn't expired, hash and store the new password, clear the reset token fields, and increment sessionVersion (this invalidates every existing session immediately, per FR-007).

Write tests covering: a valid reset flow end-to-end, an expired token being rejected, a reused (already-consumed) token being rejected, requesting a second reset invalidating the first token, and confirming that a session cookie issued before the reset is rejected by the auth middleware afterward.

Run tests and build. Report results, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify:** run the tests, and manually walk through the flow once using the console-logged token. **Commit.**

### Phase 5 — CSRF, Rate Limiting, Health Check with DB

**Goal:** FR-008, FR-009, NFR-014, NFR-015.

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Verify the actual current repository state before proceeding. Read SRS.md FR-008, FR-009, NFR-014, NFR-015.

Implement:
- Origin validation middleware applied to all state-changing (POST/PUT/PATCH/DELETE) routes: reject the request if the Origin header does not match a configured allowlist (read from an environment variable, comma-separated, defaulting to http://localhost:5173 for local frontend dev).
- Rate limiting on /auth/login and /auth/password-reset/request, keyed by a combination of IP and the submitted email/account, using a simple in-memory or lightweight package-based limiter (do not introduce Redis for this — an in-process limiter is sufficient at V1 scale per the SRS's no-Redis constraint).
- Update GET /health to also verify database connectivity (a trivial query) and return 503 if the database is unreachable, per NFR-015.

Write a test confirming a request from a disallowed Origin is rejected on a state-changing endpoint, and a test confirming the rate limiter blocks after the configured threshold.

Run tests and build. Report results, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify and commit** as before.

### Phase 6 — Order CRUD and Tenant Isolation

**Goal:** FR-010 through FR-026, NFR-001, with the repository-layer tenant-isolation pattern.

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the current repository state directly rather than assuming. Read SRS.md Sections 9.2 and 9.3, and NFR-001, in full before starting.

Implement a repository layer for Order access: every function that reads or writes an order must require restaurantId as an explicit, non-optional first argument, sourced only from the authenticated request (never from the client). Do not write any ad hoc Prisma query for orders outside this repository layer, in this phase or any future one.

Implement:
- POST /orders: create an order per FR-010–FR-018 (required displayToken, required customerPhone normalized to E.164 using a standard library like libphonenumber-js — reject unparseable numbers with a clear error, required explicit consentGiven boolean with no default, consentMethod set per FR-016's exact rule).
- GET /orders: list the authenticated restaurant's own active orders (PREPARING or READY) per FR-026's default sort (READY before PREPARING, oldest-first within each group), with optional search by displayToken and/or customerPhone per FR-025.
- Do NOT implement READY, RECALL, COLLECTED, or CANCELLED transitions yet — those come in Phase 7. This phase is order creation and listing only.

Write tests covering: creating an order with valid data, rejecting an invalid phone number, rejecting a request with no explicit consent value, confirming two orders with the same displayToken for the same restaurant both persist independently, and — critically — a cross-tenant isolation test: create orders for two different restaurants and confirm restaurant A's GET /orders never returns restaurant B's orders, including when B's order id is guessed and requested directly if any single-order-fetch endpoint exists.

Run tests and build. Report results, and explicitly confirm no query was written that accepts restaurantId from the client. Note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify and commit.**

### Phase 7 — Order Status Transitions with Row Locking

**Goal:** FR-020 through FR-024, FR-021a, NFR-011 (transaction discipline).

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the current repository state directly. Read SRS.md Section 9.3 in full, especially FR-021 (allowed transitions), FR-021a (terminalAt), FR-022 (row locking), and FR-023 (idempotent READY).

Implement, inside the existing order repository layer:
- POST /orders/:id/ready, /orders/:id/collected, /orders/:id/cancel — each performing the corresponding transition.
- Every transition must run inside a database transaction that first acquires a row lock on the target order (SELECT ... FOR UPDATE via Prisma's $transaction with a raw locking query, or Prisma's documented pattern for this), then validates the current status against the allowed-transitions table in FR-021 before applying the change. Reject with a clear error any transition not in that table.
- Repeated READY requests on an already-READY order must succeed idempotently (return current state, no error, no duplicate side effect) per FR-023.
- On transition to COLLECTED or CANCELLED, set terminalAt to the transition timestamp in the same transaction, per FR-021a. Do not touch terminalAt on any other transition.

Do NOT create any NotificationAttempt yet — that begins in Phase 8. For this phase, READY should only change status and set no notification-related field.

Write tests covering: every valid transition, every invalid transition explicitly rejected, and a concurrency test that fires two conflicting transition requests (e.g. READY and CANCELLED) at nearly the same time against the same order and confirms the outcome is deterministic and never leaves the order in an invalid combined state (this may require running the two requests in parallel within the test and asserting on the final state plus that exactly one succeeded).

Run tests and build. Report results, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify and commit.**

### Phase 8 — Notification Attempt Creation and the READY Transaction Guarantee

**Goal:** FR-027, FR-028, FR-019 (opt-out check), the `NotificationOptOut` table, and the core transactional guarantee — still with a **mocked** WhatsApp send (no real Meta call yet).

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current state of Phases 1–7 by inspecting the repository. Read SRS.md FR-027, FR-028, FR-019, and Section 9.6 (the retry vs. RECALL distinction) before starting — Section 9.6 is critical and must inform how fields are named and structured now, even though retries/RECALL aren't implemented until later phases.

Implement:
- Before the READY transition (from Phase 7) commits, check for a NotificationOptOut record matching (restaurantId, normalized customerPhone). If one exists, OR if the order's consentGiven is false, the READY transition must complete WITHOUT creating any NotificationAttempt (per FR-028), and the order should be queryable in a way that lets the frontend later show "notify manually."
- If consentGiven is true and no opt-out exists, the READY transition, in the SAME database transaction as the status change, must create a NotificationAttempt row with jobStatus = PENDING, attemptNumber = 1, channel = WHATSAPP. This is the single most important transactional guarantee in the whole system per FR-027 — write a test that specifically tries to simulate a failure between the two writes (e.g. by throwing inside the transaction after the order update but before the attempt insert) and confirms the transaction rolls back entirely rather than leaving the order READY with no attempt.
- For now, do NOT call any real WhatsApp API. Create a placeholder/mock notification-sending function that always "succeeds" — this will be replaced with the real Meta integration in Phase 12. The point of this phase is the database transaction guarantee and the opt-out/consent gating logic, not the actual send.

Write tests covering: consent true + no opt-out → exactly one PENDING attempt created; consent false → no attempt created; opt-out exists → no attempt created even when consent is true; the transactional-rollback test described above.

Run tests and build. Report results, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify and commit.**

### Phase 9 — Background Processor, Claiming, and Crash Recovery

**Goal:** FR-029 through FR-034 — the in-process processor, `FOR UPDATE SKIP LOCKED` claiming, and stuck-job recovery. Still using the mock send from Phase 8.

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state. Read SRS.md Section 9.5 (FR-029 through FR-034) in full.

Implement an in-process background processor in the backend:
- Runs on a fixed interval (make this configurable via environment variable, default a few seconds).
- Each tick, claims one eligible PENDING notification attempt using a raw SQL query with FOR UPDATE SKIP LOCKED (Prisma's $queryRaw), moving it to PROCESSING and committing that change BEFORE calling the mock send function. Per FR-029, the claim query must exclude any PENDING attempt whose order belongs to a restaurant with status = DEACTIVATED (even though restaurant deactivation isn't implemented until a later phase, write the query to already respect this field now).
- After the mock send "completes," update the attempt to SENT (the mock should succeed by default, but make it configurable in tests to simulate a failure).
- Implement stuck-job recovery: a separate check (can run on the same interval or a slower one) that finds attempts stuck in PROCESSING beyond a configurable threshold (default 2 minutes) and returns them to PENDING, per FR-034.
- Do not hold a database transaction open across the mock "external call" — commit the PROCESSING state change first, then call the mock function, per FR-030.

Write tests covering: the claim query only claims one attempt even when called concurrently (simulate two claim calls racing), a stuck PROCESSING job being recovered after the threshold, and confirming a PENDING attempt belonging to a restaurant manually set to DEACTIVATED status is never claimed.

Run tests and build. Report results, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify and commit.**

### Phase 10 — Automatic Retry Classification and RECALL

**Goal:** FR-033 (retry classification) and FR-035 through FR-038 (RECALL). This is the phase most likely to introduce the retry/RECALL confusion the SRS explicitly warns against — read Section 9.6 twice.

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state. Read SRS.md Section 9.6 and FR-033 through FR-038 very carefully. The distinction between automatic retry and manual RECALL is the single most important thing to get right in this phase — re-read the diagram in Section 9.6 before writing any code.

Implement:
- Failure classification in the mock send function (extend it to accept a "failure type" parameter for testing: transient or permanent).
- On a transient failure, the SAME NotificationAttempt row increments retryCount and becomes eligible for another processor attempt, up to a maximum of 3 (FR-033), with roughly a 30-second backoff (configurable). After 3 failed retries, the attempt transitions to FAILED. attemptNumber does NOT change during this process.
- On a permanent failure, the attempt transitions directly to FAILED with no retry.
- POST /orders/:id/recall: implement exactly the eligibility rules in FR-035 (status must be READY, no active PENDING/PROCESSING attempt, under the max of 3 RECALL-created attempts per FR-036). On success, create a NEW NotificationAttempt row with attemptNumber incremented, generated inside a transaction that locks the parent order first (per FR-037) to prevent colliding attempt numbers under concurrent RECALL requests. Reject server-side (not just hide the button) when any eligibility condition fails.

Write tests covering: a transient failure retrying within the same attempt row up to the max before failing; a permanent failure failing immediately with no retry; RECALL succeeding when eligible; RECALL rejected when status isn't READY, when an attempt is active, and when the max RECALL count is reached; two concurrent RECALL requests never producing a duplicate or colliding attemptNumber; and an explicit assertion that automatic retries never increment attemptNumber and manual RECALL never resets retryCount on a prior attempt.

Run tests and build. Report results, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify and commit. This is a good point to run an independent second-opinion review using a different AI tool/model than the one used for implementation: paste the diff for this phase and ask it to specifically check for retry/RECALL conflation.**

### Phase 11 — Retention / Phone Scrubbing

**Goal:** NFR-002, using `terminalAt` exclusively, per FR-021a.

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state. Read SRS.md NFR-002, FR-021a, and Section 14.4.

Implement a scheduled cleanup process (can run on the same in-process interval pattern as the notification processor, at a coarser interval like hourly) that finds orders where terminalAt is older than a configurable retention window (default 72 hours) and customerPhone is not already null, and sets customerPhone to null and phoneScrubbedAt to the current timestamp. Use the (status, terminalAt) index — do not write a query that scans the whole orders table.

Confirm this process is idempotent: running it twice in a row must not error or double-process already-scrubbed rows.

Write tests covering: an order past the retention window gets scrubbed; an order not yet past the window is untouched; an order still PREPARING or READY (terminalAt is null) is never touched regardless of age; running the cleanup twice is safe; and confirming that after scrubbing, the order's notificationAttempts and their snapshot fields remain fully intact and readable.

Run tests and build. Report results, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify and commit.**

### Phase 12 — Real WhatsApp Integration (Development/Test Environment Only)

**STOP before this phase and do the following yourself, outside the coding agent, first:**
1. Create a Meta developer account and a Meta app with the WhatsApp product enabled.
2. Note the auto-provisioned free test phone number and test WhatsApp Business Account ID.
3. Add your own personal WhatsApp number to the allowlisted test recipients in the Meta developer console.
4. Retrieve the temporary test access token and your app's webhook verify token — put these in `backend/.env`, never commit them.

This phase depends entirely on real Meta credentials existing first. Do not ask the coding agent to "set up WhatsApp" without these in place.

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state. Read SRS.md Section 9.4 (FR-027, FR-028, FR-032), Section 15 (WhatsApp Architecture), and Section 22 (External Dependencies) before starting. Note explicitly which parts of Meta's behavior are marked "External Validation Dependency" in the SRS — do not assume undocumented behavior for those; where the real API response differs from what was assumed, report it immediately rather than silently working around it.

Replace the mock send function from Phase 8 with a real call to the WhatsApp Cloud API, using the test phone number ID and test access token from environment variables. Send the single QuickQueue-authored template (per FR-045 — for this phase, use a simple pre-approved test template if a custom one isn't approved yet; note in the report that production template approval is a separate, later step).

Implement:
- The actual API call, storing the returned providerMessageId on the NotificationAttempt.
- Classify real API error responses into transient vs. permanent per the categories in FR-033 (network/5xx/rate-limit = transient; invalid number/recipient not on WhatsApp/invalid template/auth error = permanent). If Meta's actual error response shape differs from what was expected, report exactly what was observed rather than guessing.

Do NOT implement the webhook receiver yet — that's the next phase. For this phase, only the outbound send needs to work.

After implementing, actually send a real test message to the allowlisted number in .env and report the real API response received, including the actual providerMessageId format Meta returned. Note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify:** check your own phone for the real WhatsApp message. This is the first point where the system has left "internal simulation" — verify carefully. **Commit.**

### Phase 13 — Webhook Receiver

**STOP before this phase:** configure the webhook URL in the Meta developer console (you'll need a public URL — use a tunnel tool like `ngrok` for local development) and subscribe to the `messages` and `message_status` webhook fields.

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state. Read SRS.md NFR-009 in full — this is a security-critical section, read it twice.

Implement:
- A webhook verification handshake endpoint (GET, matching Meta's challenge-response requirement) and the actual event-receiving endpoint (POST).
- Signature verification on every incoming POST using Meta's documented mechanism, rejecting any request that fails verification before any parsing occurs. This is non-negotiable per NFR-009 — do not build a version that "trusts" the payload even temporarily for testing convenience.
- Event correlation to the correct NotificationAttempt using whatever identifiers Meta's real payload actually contains — inspect the real webhook payloads received during testing and report exactly what structure they have BEFORE hardcoding field paths, since this is explicitly marked an External Validation Dependency in the SRS.
- Idempotent processing: replaying the same event must not corrupt state. Out-of-order events must not regress jobStatus backward (e.g. a late-arriving SENT-level event must not overwrite an already-recorded READ). Events that cannot be correlated to a known attempt, or that reference a disconnected/deactivated restaurant, must be safely ignored and logged, not error.
- Never trust any restaurant or order identifier if one appears directly in the webhook payload — correlation must go through the provider identifiers, never a client/payload-supplied tenant identifier.

Send a real test notification (using the send logic from Phase 12), let the real delivery/read webhook events arrive, and report exactly what payload structure was observed and confirm the attempt's status updated correctly in the database.

Write tests using a captured/sample version of the real payload structure just observed (not a guessed one) covering: valid signature accepted, invalid signature rejected, duplicate event no-ops, out-of-order event doesn't regress state, and an unknown-attempt event is safely ignored. Note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify:** watch the real status update in your database as your test message gets delivered/read. **Commit.**

### Phase 14 — STOP / Opt-Out

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state. Read SRS.md Section 9.11 (FR-048 through FR-051).

Using the real inbound "messages" webhook event structure observed in Phase 13, implement: if an inbound message's text content matches an opt-out command (e.g. "STOP", case-insensitive) for a given restaurant's WhatsApp number, create (or confirm) a NotificationOptOut record for that (restaurantId, normalizedPhone) pair.

Confirm this is wired into Phase 8's opt-out check — a subsequent order for that phone at that restaurant reaching READY must not create a notification attempt.

Send a real "STOP" message on the allowlisted test number and confirm the suppression record is created and that a subsequent order for that number at that restaurant does not trigger a notification attempt.

Write a test using the real inbound payload structure covering: STOP creates suppression, a later READY for that (restaurant, phone) creates no attempt, and the same phone at a DIFFERENT restaurant is unaffected. Note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify and commit.**

### Phase 15 — Embedded Signup and Multi-Restaurant WhatsApp Connections

**STOP before this phase:** apply for Meta Tech Provider status if you haven't already (Section 22 flags this as an uncontrolled-timeline dependency — start this application well before you need it approved).

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state. Read SRS.md FR-043 through FR-047, and NFR-004 (credential encryption).

Implement:
- The Embedded Signup flow: a backend endpoint that initiates it and a callback/completion endpoint that receives the resulting WABA ID and phone number ID from Meta, storing them on the restaurant's WhatsAppConnection record.
- Encrypt any received access token/credential material using AES-256-GCM (or an equivalent standard authenticated encryption library) before storing it, per NFR-004. The encryption key must come from an environment variable, never be stored in the database, and the stored value must include its nonce/IV and auth tag.
- Update the notification-sending logic from Phase 12 to use each restaurant's own connection (phoneNumberId, decrypted access token) instead of the single hardcoded test credentials, so multiple restaurants can genuinely operate independently.
- Attempt to register the combined display name ("<Restaurant Name> via QuickQueue") during signup; if Meta rejects it, fall back to the plain restaurant name and record whichever was actually approved in approvedDisplayName, per FR-037/FR-047. Report the actual outcome observed — this is an explicit External Validation Dependency in the SRS and must not be assumed.

This phase cannot be fully tested without at least one real restaurant going through real Embedded Signup — if a second real WhatsApp-capable business isn't available yet to test with, implement and unit-test everything possible, and clearly flag what remains to be validated against a real second connection. Note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify and commit.**

### Phase 16 — Restaurant Deactivation

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state. Read SRS.md Section 9.12 (FR-052, FR-053) carefully — the exact PENDING-vs-PROCESSING distinction here has already been precisely defined; implement it exactly as written, not an approximation.

Implement:
- Blocking login, order creation, READY, and RECALL for a restaurant whose status is DEACTIVATED (this should mostly already be true from Phase 9's claim-query exclusion — confirm it explicitly with a test, and add the login/creation/RECALL blocks if not already present).
- Confirm (per FR-053) that a PENDING attempt for a deactivated restaurant is never claimed, while an already-PROCESSING attempt is allowed to finish and record its outcome normally.
- Confirm the recovery mechanism from Phase 9 also respects deactivation — a recovered (previously stuck) attempt must not be re-claimed if its restaurant has since been deactivated.

Write tests covering all three of the above scenarios explicitly, including one that deactivates a restaurant WHILE an attempt is genuinely PROCESSING and confirms that specific attempt is still allowed to complete.

Run tests and build. Report results, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify and commit.**

### Phase 17 — Frontend: Core Application

**Before this prompt**, review whatever frontend-design guidance is available to your current tooling for tone: the SRS explicitly wants "simple, authentic, practical, trustworthy" — not a generic AI-dashboard look.

```
Follow the Standard Phase Protocol, including the State Discovery Pass (inspect frontend/ directly — it may be partially scaffolded already). Confirm the actual current repository state, including the backend endpoints already implemented in prior phases. Read SRS.md Sections 9 (all restaurant-facing FRs), FR-026 (Active Orders/Search), and 26 (UI/Usability guidance).

Set up frontend/ as a React + TypeScript + Vite project, with React Query for data fetching/polling (if not already set up — verify first). Build:
- A login screen and a password-reset request/confirm flow, calling the backend endpoints from Phases 3 and 4.
- An order-creation form: display token field, phone number field, a consent checkbox defaulted to checked (per FR-014), large and fast to fill on a touchscreen.
- An active-orders view: polling the backend every few seconds (React Query's refetchInterval), sorted per FR-026 (READY before PREPARING, oldest first within each), showing the display token prominently, current notification status mapped exactly per FR-039's internal-to-display mapping, and READY/RECALL/COLLECTED/CANCEL actions with clear disabled states matching the server-side eligibility rules (e.g. RECALL visually disabled when ineligible, with the reason shown, not just missing).
- Clear loading, error, and empty states throughout — per NFR-007, never show an operation as successful if the backend call failed; on ambiguous failures (timeouts), refetch the authoritative state rather than assuming success.

Do NOT invent features not in the SRS. Do not add customer-facing pages, QR codes, or anything from the SRS's Out of Scope section (21).

Keep styling plain, high-contrast, and functional — large touch targets, clear typography, no decorative gradients or dashboard-template aesthetics. This is a fast operational tool for a busy counter, not a marketing site.

Run the frontend dev server, click through the full flow against the local backend, and report what was built, confirm the flow works end to end locally, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify:** click through it yourself. **Commit.**

### Phase 18 — Frontend Visual Quality Review (Dedicated Pass)

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state. Read SRS.md Section 26 again. Now critically review the frontend built in Phase 17, specifically checking for:
- Any generic "AI-generated dashboard" visual patterns: unnecessary gradients, glassmorphism, excessive card shadows, decorative icons with no functional purpose, fake charts/analytics, or generic purple/blue AI-tool color schemes.
- Whether the display token and notification status are the most visually prominent elements on the active-orders screen (they should be — everything else is secondary).
- Whether touch targets are large enough for a tablet used quickly during a rush (buttons should not be small or closely packed).
- Whether color is used as the ONLY indicator of status anywhere (it must not be — pair color with text/icon per accessibility guidance).
- Whether the visual design would look intentionally designed by someone who thought about a real restaurant counter, versus a generic template.

List every issue found, then fix them. Do not add new features in this pass — only refine what exists for genuine visual/usability quality against the goals above. Report what was changed, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify by actually looking at it on a phone-sized browser window and a tablet-sized one. Commit.**

### Phase 19 — Documentation

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state by reading through the full backend and frontend codebase, and SRS.md. Also re-check every existing file in docs/ for staleness against what actually exists now (for example, a setup doc that still cites an old database port, or claims a phase "hasn't begun" when it has) — correct any such statement as part of this phase, don't leave it standing.

Create or correct concise documentation in docs/ (alongside the existing docs/PROGRESS.md):
- SETUP.md: how to get the project running locally from a fresh clone (Docker Postgres — including the actual host port this project uses, environment variables needed, install/run commands for both frontend and backend). If a pre-existing setup/development doc already covers this (e.g. docs/development.md), update it in place rather than creating a duplicate, and make sure it reflects the actual current DATABASE_URL/port and actual phase status.
- ARCHITECTURE.md: a brief overview of the system (can largely summarize SRS.md Sections 12–15, but should reflect what was ACTUALLY built, noting any place implementation ended up differing from the original SRS assumption due to real Meta behavior discovered during Phases 12–15).
- ENVIRONMENT_VARIABLES.md: every environment variable used across both apps, what it's for, and whether it's a secret.
- NOTIFICATION_ENGINE.md: how the processor, claiming, retry, and RECALL mechanisms actually work in the code, referencing the real file/function names.
- WHATSAPP_INTEGRATION.md: how Embedded Signup, sending, and webhooks actually work, explicitly documenting the REAL payload structures and behaviors observed from Meta (not the assumed ones from the SRS) — this file is the permanent record of what turned out to be true versus assumed.
- KNOWN_LIMITATIONS.md: the accepted at-least-once delivery limitation (NFR-006), and any other explicitly accepted trade-off from the SRS.
- TROUBLESHOOTING.md: common local setup issues and how to resolve them (including any port-conflict issue like a native local Postgres install colliding with Docker's default port, and how this project resolved it).

Keep each file short and genuinely useful — this is not meant to be exhaustive, just enough that returning to this project in two months, or handing it to a different coding agent, does not require re-deriving how things work. Report what was created or corrected, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Commit.**

### Phase 20 — Test Suite Consolidation and Gap Audit

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state. Read SRS.md Section 19 (Testing Requirements) in full. Go through the entire existing test suite across backend and frontend and cross-check it against every item listed in Section 19.

Identify any gap: any testing requirement listed in the SRS that is not actually covered by an existing test. For each gap found, write the missing test now.

Do not weaken, delete, or skip any existing test to make this pass faster.

Run the full test suite. Report a clear list of what Section 19 requires versus what is now actually covered, confirm the full suite passes, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**Verify and commit.**

### Phase 21 — Deployment: Backend and Database (Render)

**Before this prompt, do yourself, outside the coding agent:**
1. Create a Render account, a new Web Service pointing at your `backend/` folder in GitHub, and a new Render-managed PostgreSQL instance.
2. Note the production `DATABASE_URL` Render provides.

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state. Read SRS.md Section 18 (Deployment and Environment Requirements) and NFR-011 (Migration Safety).

Prepare the backend for Render deployment:
- Confirm the build script produces a runnable production build.
- Confirm the start script runs prisma migrate deploy BEFORE starting the server (not prisma migrate dev — that command is for local development only and must never run in production).
- Produce a checklist of every environment variable the production backend needs (cross-reference docs/ENVIRONMENT_VARIABLES.md), for manual entry into Render's dashboard. Note that the production DATABASE_URL will be Render's own managed connection string, not the local Docker port used in development — do not carry the local port number into any production configuration.
- Confirm the GET /health endpoint is suitable for Render's health check configuration.

Do not commit any real secret values anywhere in the repository. Report the exact environment variable checklist, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**You then:** enter the real production environment variables into Render's dashboard yourself, deploy, and confirm `/health` responds on the live Render URL, and confirm the migration ran (check the Render deploy logs).

### Phase 22 — Deployment: Frontend (Vercel)

```
Follow the Standard Phase Protocol, including the State Discovery Pass. Confirm the actual current repository state.

Prepare the frontend for Vercel deployment: confirm the build script works, and produce a checklist of any environment variables the frontend needs (e.g. the production backend URL for API calls).

Confirm the frontend's API base URL is read from an environment variable rather than hardcoded, so it can point at the Render backend URL in production and localhost in development. Report the checklist, note anything incomplete or uncertain, show git status/diff, update docs/PROGRESS.md, and stop.
```

**You then:** connect the repo to Vercel, set the environment variable, deploy, and confirm the live frontend loads and can reach the live backend (check CORS/Origin configuration matches the deployed Vercel URL in the backend's allowlist from Phase 5 — update it if needed).

---

## Part 5 — Final Repository Audits

Run each of these as its own prompt, in order, once all phases above are complete and deployed. Each audit prompt should itself begin with the State Discovery Pass, since the agent performing the audit may not be the same one that performed the implementation.

```
AUDIT 1 — ARCHITECTURE CONFORMANCE
Confirm the current repository state directly, then read SRS.md in full again, start to finish. Go through the actual repository and confirm, section by section, that the implementation matches what the SRS specifies. List any deviation found, however small, and explain why it exists (a deliberate, documented adjustment discovered during Meta integration, recorded in docs/ARCHITECTURE.md, is acceptable; an undocumented drift is not). Do not fix anything yet — just report.
```

```
AUDIT 2 — DATABASE
Confirm the current repository and database state directly. Inspect the actual current database schema (via Prisma Studio or direct SQL) and every migration file in order. Confirm: every primary key is a UUID, every foreign key and its ON DELETE behavior matches Section 14.3, the partial unique index exists and is enforced (test it live by attempting to violate it), all indexes from the schema exist, consentMethod is genuinely nullable and enforced as null-iff-consent-false at the application layer, and terminalAt behaves exactly as specified in FR-021a. Attempt to violate at least one constraint directly against the database to confirm it actually rejects the violation, not just that the Prisma schema claims to define it.
```

```
AUDIT 3 — SECURITY / TENANT ISOLATION
Confirm the current repository state directly. Attempt, against the real running system, to have one authenticated restaurant access another restaurant's orders, notification attempts, and WhatsApp connection data by guessing/enumerating IDs. Attempt to submit a restaurantId in a request body/query string and confirm it is ignored in favor of the session-derived value. Confirm password hashing, session cookie security flags, sessionVersion invalidation, CSRF Origin validation, and rate limiting are all genuinely active in the deployed environment, not just in local development. Report any successful bypass in detail — this audit exists specifically to find one, not to confirm everything is fine.
```

```
AUDIT 4 — NOTIFICATION ENGINE
Confirm the current repository state directly, then confirm against the real system: concurrent READY/RECALL requests cannot create duplicate active attempts; a simulated stuck PROCESSING job is actually recovered; retry and RECALL remain genuinely distinct in the real running code (not just in tests); and webhook idempotency and non-regression hold against replayed/out-of-order real Meta events if still triggerable, or against the recorded sample payloads from Phase 13 if not.
```

```
AUDIT 5 — WHATSAPP INTEGRATION
Confirm the current repository state directly. Confirm the real, currently-deployed webhook signature verification actually rejects a deliberately malformed signature. Confirm the actual sender display name outcome observed for at least one connected restaurant, and confirm this matches what docs/WHATSAPP_INTEGRATION.md claims. Flag any remaining unvalidated assumption from SRS Section 22 that has still not actually been tested against real Meta behavior.
```

```
AUDIT 6 — FRONTEND QUALITY
Confirm the current repository state directly. Re-review the deployed frontend against SRS Section 26 one more time, on both a narrow mobile-width and a tablet-width viewport. Confirm the UI still looks intentional and operational rather than generic, and that nothing regressed visually across the later phases.
```

```
AUDIT 7 — MAINTAINABILITY
Read through the codebase as if encountering it for the first time, with no memory of how it was built. Identify any code that is confusing, duplicated, inconsistently structured, or under-documented relative to docs/. Propose specific, scoped fixes — do not silently rewrite large sections; list what would change and why, and only proceed with fixes that are explicitly approved.
```

```
AUDIT 8 — DEPLOYMENT
Confirm the current repository state directly. Confirm the production build actually succeeds from a clean clone (simulate this if possible), confirm migrations apply cleanly to a fresh database, and confirm the documented environment variable list in docs/ENVIRONMENT_VARIABLES.md is complete and accurate against what the deployed services actually require.
```

---

## Part 6 — Final Production Launch Checklist

Do not consider QuickQueue V1 production-ready until every item below is confirmed true, with evidence (a test result, a manual check, or an audit finding), not assumption:

- [ ] Core workflow (create → READY → WhatsApp → RECALL if needed → COLLECTED) works end-to-end against production Meta credentials with at least one real connected restaurant.
- [ ] Login, logout, password reset, and session invalidation all verified in production.
- [ ] Tenant isolation confirmed unbroken via Audit 3, in production.
- [ ] Database schema, constraints, and migrations confirmed via Audit 2, in production.
- [ ] Concurrency protections (row locking, partial unique index, `FOR UPDATE SKIP LOCKED`) confirmed via Audit 4, in production.
- [ ] WhatsApp signature verification, opt-out handling, and retry/RECALL distinction confirmed via Audits 4–5, in production.
- [ ] Retention/phone-scrubbing job confirmed running on a real schedule in production.
- [ ] Frontend confirmed usable on an actual phone and an actual tablet, not just a resized browser window.
- [ ] Accessibility basics (color not the sole status indicator, adequate touch targets) confirmed.
- [ ] All secrets present only in Render/Vercel environment configuration, never in the repository.
- [ ] Logging confirmed to exclude phone numbers, credentials, passwords, and reset tokens — spot-check real production logs.
- [ ] `/health` confirmed wired into Render's health-check configuration.
- [ ] Vercel and Render deployments both confirmed building and running from the current `main` branch.
- [ ] Render-managed PostgreSQL backup/retention window confirmed and documented (per SRS Section 18).
- [ ] Meta Tech Provider approval confirmed granted; at least one restaurant has completed real Embedded Signup.
- [ ] Git history is clean, all phases committed, `main` branch reflects the audited state.
- [ ] `docs/` (including `PROGRESS.md`) reviewed once more for accuracy against the final deployed system.
- [ ] Local-environment-specific configuration (e.g. a non-default database port) confirmed to have no effect on and no presence in production configuration.

Only once every box is checked should QuickQueue take its first real paying restaurant.

---

## Changes made in this corrective pass

This revision was produced by comparing the previous agent-neutral rewrite against the actual current state of the QuickQueue project, and correcting instructions that were stale, contradictory to reality, or unsafe for a mid-project handoff:

1. **Added a new Part 1 — "Mandatory First Step: Determine Actual Project State."** The previous version only generalized *tooling*; it never addressed the case where the *project itself* is already partially built by an agent that is no longer available. This is now an explicit, required first step for any agent touching the repo, with a concrete checklist (git log/status/diff, repo structure, Prisma/backend inspection, live database inspection, `docs/PROGRESS.md` and other docs staleness check) before any phase work begins.
2. **Corrected the assumed database port.** The original Phase 0 hardcoded `5432` as the Docker Postgres host port and the sample `.env`/connection string. This is factually wrong for this project: a native local PostgreSQL install already occupies `5432`, so this project's Docker Postgres is deliberately mapped to `5433`. The playbook now: (a) documents this specific project's actual configuration, (b) generalizes the underlying instruction so future forks check for a port conflict rather than assuming `5432`, and (c) explicitly instructs agents *not* to "fix" this back to `5432` — that would break the documented, deliberate setup.
3. **Added explicit "never blindly restart a phase" rules**, both in the new Part 1 and reinforced in the Standard Phase Protocol, since the earlier version was written entirely from a "fresh project" mental model and gave no guidance for an agent discovering that, e.g., Phase 2 already appears complete.
4. **Rewrote Phase 1 and Phase 2 prompts to branch on discovered state** rather than assuming a blank slate — each now includes explicit "if this already exists, verify against these criteria rather than redo it" logic, matching the actual current state (backend foundation and Prisma/database work already done by Codex before it became unavailable).
5. **Added explicit handling for uncommitted/untracked files** matching the real `git status` described (`.env.example`, `backend/package.json`, `docker-compose.yml`, `package-lock.json` uncommitted; `backend/prisma/` untracked) — the playbook now tells the agent this is a human-review-and-commit matter, not evidence of incomplete or broken work, and reminds it that committing is never automatic.
6. **Corrected stale documentation instead of leaving it standing.** The old playbook never addressed the fact that `docs/development.md` currently makes two false claims (Postgres on `5432`; Prisma/database phase not begun). Part 1 now requires an immediate correction of any such stale doc, and Phase 19's documentation prompt was updated to update existing docs in place (rather than only ever creating new ones) and to specifically re-check for exactly this kind of drift.
7. **Added `docs/PROGRESS.md` creation as an immediate action**, not something deferred to "whichever phase happens to run first," since it did not previously exist despite two phases' worth of real work already being done — the playbook now requires it be created (populated with the *actual* discovered state, not a blank "Phase 0" starting point) before any further phase work proceeds.
8. **Generalized every phase prompt** to explicitly invoke the State Discovery Pass and to allow a "verify, don't redo" outcome, rather than only carrying over the previous rewrite's more limited "inspect the repo" instruction, which was worded as if inspection would always confirm a fresh, empty starting point.
9. **Preserved, unchanged:** all phase numbering, all technical requirements (FR-/NFR- IDs), all architecture/database/security/deployment decisions from the frozen SRS, the audits in Part 5, and the production checklist in Part 6 (with one addition: an explicit checklist item confirming local-only configuration like the non-default port never leaks into production). No product or architecture decision was altered to make the document easier to write.
10. **Kept all agent-neutral language** from the prior rewrite (no named tool, generic "coding agent" phrasing throughout, generic second-opinion-review instruction in Phase 10) since that correction was accurate and did not need revision — but added an explicit acknowledgment that an agent may become *unavailable* mid-project (not just "different agents may run different phases"), since that is what actually happened here.
