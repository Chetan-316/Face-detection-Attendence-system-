# PRAVAHAx Face Recognition Hostel Attendance & Resident Movement System

## Step 01 & Step 01.1: Core Architecture, PostgreSQL Foundation & Domain Business Engine

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
│   └── seed.ts                 # Seed script with production safety guards
├── src/
│   ├── api/
│   │   └── app.ts              # Express application factory & health check routes
│   ├── common/
│   │   ├── errors/             # Domain errors (DomainIntegrityError, Conflict, etc.)
│   │   └── utils/              # Timezone handling (UTC <-> Asia/Kolkata)
│   ├── config/
│   │   └── index.ts            # Validated environment configuration
│   ├── database/
│   │   └── client.ts           # PrismaClient singleton with test URL support
│   ├── modules/
│   │   ├── audit/              # Append-oriented audit trail service (sensitive data redacted)
│   │   ├── auth/               # Staff authentication & hostel-scoped permission guards
│   │   ├── attendance/         # General attendance sessions & duplicate-safe records
│   │   ├── biometrics/         # FaceProfile entity (logical separation from resident)
│   │   ├── cameras/            # Camera registry & ICameraAdapter contracts
│   │   ├── movements/          # Atomic IN/OUT movement engine with row locking
│   │   ├── night-attendance/   # Hostel Night Attendance & atomic Warden resolution engine
│   │   ├── organizations/      # Organization, Hostel, and Location hierarchy
│   │   ├── presence/           # Ultra-fast indexed IN/OUT count and presence query
│   │   └── residents/          # Resident domain (safe deactivation preserving history)
│   └── index.ts                # HTTP application entry point
├── tests/
│   ├── helpers/
│   │   └── test-db.ts          # Test database connection and fail-fast safety check
│   ├── attendance.test.ts      # Session lifecycle & duplicate attendance tests
│   ├── database.test.ts        # PostgreSQL database-level constraints & FK tests
│   ├── integrity.test.ts       # Cross-hostel, camera, location & same-state regression tests
│   ├── movement.test.ts        # IN/OUT alternating rules & history storage tests
│   ├── night-attendance.test.ts# OUT-blocking & atomic Warden Missed-IN resolution tests
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

Configuration variables (use your actual local PostgreSQL credentials):

```ini
# Database URLs (Placeholders - replace with your local database credentials)
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5433/pravahax_db?schema=public"

# Isolated test database connection string
TEST_DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5433/pravahax_test_db?schema=public"

# Application settings
APP_ENV="development"
PORT=3000
TIMEZONE="Asia/Kolkata"

# Security (JWT secret for staff auth tokens)
JWT_SECRET="replace_with_a_secure_random_secret_in_production"

# Seed configuration (LOCAL DEVELOPMENT / DEMO ONLY)
SEED_DEFAULT_PASSWORD="replace_with_demo_password_for_local_seed"
ALLOW_DESTRUCTIVE_SEED="false"
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
   $env:DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5433/pravahax_test_db?schema=public"; npx prisma migrate deploy
   ```

4. **Seed Database with Prototype Data** (Protected against accidental production execution):
   ```bash
   npm run seed
   ```

---

## 6. Running Automated Tests

Run the full automated test suite against the isolated test database:

```bash
npm test
```

Test coverage includes:
- **Resident Domain**: Creation, uniqueness constraint rejection, safe deactivation preserving history.
- **Movement Transitions**: Alternating IN <-> OUT enforcement, strict rejection of IN -> IN and OUT -> OUT, complete event preservation, presence decoupled from attendance.
- **Cross-Hostel Integrity**: Rejection of cross-hostel movements, cross-hostel warden corrections, and cross-hostel attendance markings.
- **Device & Location Integrity**: Rejection of disabled cameras, cross-hostel cameras, and location/hostel mismatches.
- **Transaction Safety**: Atomic rollback upon error (no orphaned rows), row-level locking (`SELECT ... FOR UPDATE`) preventing race conditions under concurrent operations.
- **Guard Permissions & Scope**: Normal gate operations allowed; corrections, invalid transition bypass, and manual overrides strictly blocked. Guard and Warden actions strictly bounded to their assigned hostel.
- **Warden Corrections**: Missed IN and Missed OUT corrections, rejection of same-state corrections (IN -> IN, OUT -> OUT), mandatory reason validation, old event immutability, current presence synchronization, and audit trail creation.
- **Night Attendance (Fully Atomic)**: OUT resident blocked from automatic Present, Guard override blocked, Warden Missed-IN resolution with return time and mandatory reason executed inside a single atomic PostgreSQL transaction boundary.
- **Database Constraints**: Composite unique constraint `(attendanceSessionId, residentId)`, unique resident code, and foreign key cascading protections verified directly at the database level.
- **Safety Guards**: Destructive seed refused in production environments; test runner refuses execution if `TEST_DATABASE_URL` is unsafe.

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

### Night Attendance Rule & Atomic Resolution
A resident currently recorded as `OUT` is **never** automatically marked `PRESENT` during Night Attendance, even if their face is observed. The system flags this inconsistency. Guard cannot override it. A Warden reviews the resident in person and executes an atomic **Resolve Missed IN and Mark Night Attendance Present** workflow:
1. Validates that the resident has not already been marked in the session (prevents partial mutation before failure).
2. Validates the return time (cannot be in the future beyond clock skew tolerance).
3. Creates a `MovementCorrection` record and a new `MovementEvent` with `source: WARDEN_CORRECTION`.
4. Updates `ResidentPresence` to `IN`.
5. Inserts the `AttendanceRecord` marked as `CORRECTED_PRESENT`.
6. Appends audit log entries.
All 6 operations are committed in a **single atomic PostgreSQL transaction**. If any step fails, the entire workflow rolls back completely.

### Append-Oriented Application Audit Log
The system maintains an append-oriented historical audit trail with application-level write controls. All critical mutations (movements, corrections, session lifecycle, attendance overrides) record who performed the action, which role, what changed, and mandatory justification reasons where applicable. Sensitive data (passwords, tokens, biometric templates) is automatically redacted before persistence.

### Camera Abstraction Principle & Step 04 Implementation
The business logic does not depend on webcam indices or video libraries. The `ICameraAdapter` contract decouples devices (`WEBCAM`, `RTSP`, `SMART_CAMERA`) so camera sources can be swapped without modifying movement, presence, attendance, or resident management services.

```
Camera Database Configuration
             ↓
       CameraService
             ↓
       ICameraAdapter
             ↓
  ┌───────────────────────┐
  │ Webcam Adapter        │ ← Step 04 Implementation (Laptop & USB)
  ├───────────────────────┤
  │ RTSP Adapter          │ ← Future IP Camera Streams
  ├───────────────────────┤
  │ Smart Camera Adapter  │ ← Future Edge AI Node Streams
  └───────────────────────┘
             ↓
        Frame Source (OpenCV Worker / Synthetic Engine)
             ↓
    Live Preview Stream (MJPEG via /api/v1/cameras/:id/preview)
```

#### Step 04 Deliverables Verified:
- **Laptop Hardware Capture**: Proven on Windows laptop built-in webcam via DirectShow / OpenCV (`webcam_worker.py`).
- **Encapsulated Configuration**: Business logic calls `CameraService` by `cameraId` only; device indices remain strictly inside `Camera.configMetadata`.
- **Live Preview Stream**: High-performance HTTP multipart MJPEG stream served directly to client `<img>` elements without heavy plugins.
- **Hardware Telemetry**: Real-time FPS, total frames captured, resolution, error status, and clean resource release.
- **Biometric Isolation**: Biometric face enrollment and recognition remain strictly decoupled.

### Biometric Face Enrollment (Step 05 & 05.1)
- **Zero Retraining Per Resident**: Pretrained metric embedding space (YuNet 2023mar detector + SFace 2021dec 128-d embedder).
- **Atomic Template Aggregation**: Quality-filtered multi-sample aggregation (minimum 3 samples) with strict isolation.
- **Privacy Controls**: Raw images and video are never persisted; biometric vectors are strictly server-internal and purged upon revocation.

### Continuous Local Face Recognition Engine (Step 06)
- **Local Passive Inference**: Real-time face detection, alignment, embedding, and template matching from shared camera streams.
- **Three-State Classification**: Classifies every usable face into `MATCH`, `UNCERTAIN`, or `UNKNOWN`.
- **Candidate Margin Separation**: Enforces minimum margin between best and second-best candidate to prevent look-alike ambiguities.
- **Temporal Stabilization & Cooldown**: IoU spatial tracking over a 5-frame sliding window (requires 3 consistent matches) with 8-second deduplication cooldown.
- **Hostel-Scoped Template Cache**: Fast in-memory template cache scoped strictly to the camera's hostel, auto-invalidated on biometric lifecycle changes.
- **Multi-Face Independence**: Independent processing of multiple faces visible within the same video frame.
- **Observation-Only Mode**: Strictly produces ephemeral recognition observations without mutating movement, presence, or attendance records.

#### Explicitly Deferred (Future Steps):
- Liveness detection / anti-spoofing verification
- Automated IN/OUT movement event generation (Step 07)
- Automated gate / turnstile relay control
- Attendance roll call automation
- Night attendance recognition
- Production threshold calibration for specific camera optics and environments

