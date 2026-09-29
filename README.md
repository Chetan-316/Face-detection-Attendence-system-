# PRAVAHAx Face Recognition Hostel Attendance & Resident Movement System

## Step 01: Core Architecture, PostgreSQL Foundation & Domain Business Engine

A robust, enterprise-grade foundation for residential hostel attendance and resident movement tracking, built as a modular monolith in TypeScript, Node.js, and PostgreSQL.

---

## 1. Prerequisites

- **Node.js**: v18+ (tested on Node.js v24.13.0)
- **npm**: v9+ (tested on npm 11.6.2)
- **PostgreSQL**: v14+ (tested on PostgreSQL 18.4)
- **TypeScript**: v5+ / v6

---

## 2. Technology Stack

- **Runtime & Language**: Node.js + TypeScript (Strict Type Checking)
- **Database**: PostgreSQL with row-level locking (`SELECT ... FOR UPDATE`), foreign key constraints, composite unique constraints, and B-tree indexes
- **ORM & Migrations**: Prisma ORM v6 (`prisma migrate dev`, `prisma migrate deploy`, `prisma db seed`)
- **API Framework**: Express.js with JSON middleware, CORS, and centralized error handling
- **Password Security**: bcryptjs (10 salt rounds)
- **Timezone Management**: Luxon (UTC database persistence with `Asia/Kolkata` presentation)
- **Automated Testing**: Vitest with isolated PostgreSQL test database runner

---

## 3. Architecture & Directory Layout

A clean **Modular Monolith** structure where business logic is strictly decoupled from camera hardware and future AI models:

```
├── prisma/
│   ├── migrations/             # Version-controlled, reproducible SQL migrations
│   │   └── 20260929101840_init/
│   │       └── migration.sql
│   ├── schema.prisma           # Prisma domain schema with models, relations & indexes
│   └── seed.ts                 # Deterministic seed data script
├── src/
│   ├── api/
│   │   └── app.ts              # Express application factory & health check routes
│   ├── common/
│   │   ├── errors/             # Domain errors (Conflict, PermissionDenied, etc.)
│   │   └── utils/              # Timezone handling (UTC <-> Asia/Kolkata)
│   ├── config/
│   │   └── index.ts            # Validated environment configuration
│   ├── database/
│   │   └── client.ts           # PrismaClient singleton with test URL support
│   ├── modules/
│   │   ├── audit/              # Sensitive-data-redacted audit trail service
│   │   ├── auth/               # Staff user authentication & RBAC permission guards
│   │   ├── attendance/         # General attendance sessions & duplicate-safe records
│   │   ├── biometrics/         # FaceProfile entity (logical separation from resident)
│   │   ├── cameras/            # Camera registry & ICameraAdapter contracts
│   │   ├── movements/          # Atomic IN/OUT movement engine with row locking
│   │   ├── night-attendance/   # Hostel Night Attendance & Warden resolution engine
│   │   ├── organizations/      # Organization, Hostel, and Location hierarchy
│   │   ├── presence/           # Ultra-fast indexed IN/OUT count and presence query
│   │   └── residents/          # Resident domain (safe deactivation preserving history)
│   └── index.ts                # HTTP application entry point
├── tests/
│   ├── helpers/
│   │   └── test-db.ts          # Test database connection and reset utility
│   ├── attendance.test.ts      # Session lifecycle & duplicate attendance tests
│   ├── database.test.ts        # PostgreSQL database-level constraints & FK tests
│   ├── movement.test.ts        # IN/OUT alternating rules & history storage tests
│   ├── night-attendance.test.ts# OUT-blocking & Warden Missed-IN resolution tests
│   ├── permissions.test.ts     # Guard vs Warden permission boundary tests
│   ├── resident.test.ts        # Registration & historical preservation tests
│   ├── transactions.test.ts    # Concurrency locking & rollback tests
│   └── warden-correction.test.ts # Missed IN/OUT corrections with mandatory reasons
├── .env.example                # Configuration template
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 4. Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Configuration variables:

```ini
# Main PostgreSQL connection string
DATABASE_URL="postgresql://postgres:123456@localhost:5433/pravahax_db?schema=public"

# Isolated test database connection string
TEST_DATABASE_URL="postgresql://postgres:123456@localhost:5433/pravahax_test_db?schema=public"

# Application settings
APP_ENV="development"
PORT=3000
TIMEZONE="Asia/Kolkata"

# JWT secret
JWT_SECRET="dev_secret_pravahax_attendance_movement_2026_key"
```

---

## 5. Database Setup, Migrations & Seeding

1. **Create Databases** (if not already created in PostgreSQL):
   ```sql
   CREATE DATABASE pravahax_db;
   CREATE DATABASE pravahax_test_db;
   ```

2. **Run Migrations on Main Database**:
   ```bash
   npx prisma migrate dev
   ```

3. **Deploy Migrations to Test Database**:
   ```bash
   $env:DATABASE_URL="postgresql://postgres:123456@localhost:5433/pravahax_test_db?schema=public"; npx prisma migrate deploy
   ```

4. **Seed Database with Prototype Data**:
   ```bash
   npm run seed
   ```

---

## 6. Running Automated Tests

Run the full automated test suite (26 passing tests across 8 test suites):

```bash
npm test
```

Test coverage includes:
- **Resident Domain**: Creation, uniqueness constraint rejection, safe deactivation preserving history.
- **Movement Transitions**: Alternating IN <-> OUT enforcement, strict rejection of IN -> IN and OUT -> OUT, complete event preservation, presence decoupled from attendance.
- **Transaction Safety**: Atomic rollback upon error (no orphaned rows), row-level locking (`SELECT ... FOR UPDATE`) preventing race conditions under concurrent operations.
- **Guard Permissions**: Normal gate operations allowed; corrections, invalid transition bypass, and manual overrides strictly blocked.
- **Warden Corrections**: Missed IN and Missed OUT corrections, mandatory reason validation, old event immutability, current presence synchronization, and audit trail creation.
- **Attendance Sessions**: Session lifecycle (DRAFT -> ACTIVE -> CLOSED), record creation, and duplicate attendance prevention.
- **Night Attendance**: OUT resident blocked from automatic Present, Guard override blocked, Warden Missed-IN resolution with return time and mandatory reason, and audit logging.
- **Database Constraints**: Composite unique constraint `(attendanceSessionId, residentId)`, unique resident code, and foreign key cascading protections verified directly at the database level.

---

## 7. Starting the Application

Start in development mode with hot reload:

```bash
npm run dev
```

Or run standard startup:

```bash
npm start
```

### Health Check

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "UP",
  "service": "PRAVAHAx Face Recognition Hostel Attendance & Resident Movement System",
  "stage": "STEP_01_FOUNDATION",
  "appEnv": "development",
  "timezone": "Asia/Kolkata",
  "database": "CONNECTED",
  "timestamp": "2026-09-29T10:26:26.147Z"
}
```

---

## 8. Domain Rules & Architecture Highlights

### Three Separate Concepts
1. **Attendance**: Session-based roll call (e.g. resident was present for Morning Assembly or Night Roll Call).
2. **Movement History**: Immutable audit log of every gate pass (07:30 OUT, 08:20 IN, etc.). Never overwritten or deleted.
3. **Current Presence State**: The resident's current real-time physical state (`IN` or `OUT`), derived from validated movement transactions and indexed on `(hostelId, currentState)`.

### Night Attendance Rule (Critical)
A resident currently recorded as `OUT` is **never** automatically marked `PRESENT` during Night Attendance, even if their face is observed. The system flags this inconsistency. Guard cannot override it. A Warden must review the resident in person and perform a **Correct Missed IN** action with a specified return time and mandatory reason. Once committed, the presence updates to `IN` and the Night Attendance record is marked `CORRECTED_PRESENT`.

### Camera Abstraction Principle
The business logic does not depend on webcam indices or video libraries. The `ICameraAdapter` contract decouples devices (`WEBCAM`, `RTSP`, `SMART_CAMERA`) so camera sources can be swapped without modifying movement, presence, attendance, or resident management services.
