# PRAVAHAx Face Recognition Hostel Attendance & Resident Movement System

PRAVAHAx is an on-premise, privacy-focused facial recognition system designed for residential student hostels. It provides automated gate movement tracking (`IN` / `OUT`), scheduled roll-call attendance sessions, real-time presence monitoring, and operational reporting—without cloud dependencies or persistent video recording.

---

## 1. What the System Does

- **Automated Gate Movement**: Directs entry and exit logging using dedicated ingress/egress cameras. Recognizes residents, enforces alternating state transitions (`IN` ↔ `OUT`), and suppresses duplicates.
- **Roll Call & Curfew Attendance**: Conducts timed attendance sessions (e.g., Night Roll Call) linked to attendance cameras. Enrolled residents are marked `PRESENT` automatically; closing a session marks all remaining unmarked residents as `ABSENT`.
- **Real-Time Presence Tracking**: Maintains an authoritative, indexed presence state (`IN` vs `OUT`) for every resident, providing staff with instant headcounts of residents currently inside or outside the hostel.
- **Audited Manual Corrections**: Enables wardens to correct attendance and movement anomalies (e.g., missed entry logs) with mandatory written justification recorded in an append-only audit trail.
- **Operational Reporting & CSV Export**: Offers search, trend charts, and RFC 4180 compliant CSV exports with built-in spreadsheet formula injection protection.
- **On-Premise Privacy**: Discards raw enrollment photos immediately after computing 128-dimensional embedding templates; never persists surveillance video feeds or unknown face galleries.

---

## 2. Architecture

PRAVAHAx is built as a modular monolith in TypeScript and Node.js with PostgreSQL:

```text
Camera Stream (USB Webcam / RTSP IP Camera via FFmpeg)
  │
  ▼
CameraService (Frame decoding, JPEG extraction, multi-camera pub/sub)
  │
  ▼
RecognitionService (Orchestrator)
  │
  ├── Biometric Worker (Python / ONNX / OpenCV YuNet + SFace)
  │     ├── YuNet Detection (Face bounding box & 5-point landmarks)
  │     ├── Quality Gate (Blur, pose, minimum face size, confidence)
  │     └── SFace Embedder (128-dim normalized embedding)
  │
  ├── TemplateMatcher (Cosine similarity against in-memory template cache)
  └── TemporalStabilizer (Multi-frame confirmation window)
        │
        ▼
   Stable MATCH
  ┌─────┴────────────────────────────────┐
  │                                      │
  ▼                                      ▼
MovementDecisionEngine        AttendanceDecisionEngine
  │                                      │
  ▼                                      ▼
MovementEvent & ResidentPresence   AttendanceRecord & Session Update
  │                                      │
  └──────────────────┬───────────────────┘
                     ▼
           AuditLog & Reports
```

---

## 3. Features

- **Multi-Role Access Control**: Granular permissions for `ADMIN` (organization-wide), `WARDEN` (assigned hostel management), and `GUARD` (real-time gate oversight, no historical exports or corrections).
- **Camera Abstraction (`ICameraAdapter`)**: Unifies USB webcams and RTSP IP cameras behind a single frame-distribution pipeline.
- **Continuous Local Recognition**: 3-state classification (`MATCH`, `UNCERTAIN`, `UNKNOWN`) with IoU spatial tracking, multi-frame stabilization window, and cooldown deduplication.
- **Hostel-Scoped Biometric Cache**: In-memory template cache loaded per hostel, auto-invalidated on biometric enrollment, update, or revocation.
- **Production Guardrails**: Startup database verification, health liveness probes, readiness probes, and environment safeguards enforcing strict secret and CORS policies.

---

## 4. Requirements

- **Node.js**: v18+ LTS or v20+ LTS
- **npm**: v9+
- **PostgreSQL**: v14, v15, or v16
- **Python**: v3.10 or v3.11 with:
  - `opencv-python>=4.8.0`
  - `numpy>=1.24.0`
  - `onnxruntime>=1.15.0`
- **FFmpeg**: v5.x or v6.x (required for RTSP network camera streaming)
- **Pretrained ONNX Models**:
  - YuNet Face Detector (`face_detection_yunet_2023mar.onnx`)
  - SFace Face Embedder (`face_recognition_sface_2021dec.onnx`)

---

## 5. Setup & Installation

### Step 1: Clone and Install Dependencies
```bash
git clone https://github.com/Chetan-316/Face-detection-Attendence-system-.git
cd Face-detection-Attendence-system-
npm ci
cd client && npm ci && cd ..
```

### Step 2: Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Configure local database credentials and runtime variables:
```ini
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5433/pravahax_db?schema=public"
TEST_DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5433/pravahax_test_db?schema=public"
JWT_SECRET="replace_with_a_secure_random_secret_at_least_32_characters_long"
CORS_ORIGIN="http://localhost:3000,http://127.0.0.1:3000"
NODE_ENV="development"
PORT=3000
TIMEZONE="Asia/Kolkata"
```

### Step 3: Run Database Migrations
```bash
npx prisma migrate dev
```

### Step 4: Build and Start
```bash
# Compile backend and client bundle
npm run build

# Start production server
npm start
```
For local development with live reload:
```bash
npm run dev
```

---

## 6. Database Architecture

- **Engine**: PostgreSQL with row-level locking (`SELECT ... FOR UPDATE`), strict foreign keys, and compound unique constraints.
- **ORM**: Prisma ORM v6 with version-controlled migrations in `prisma/migrations`.
- **Core Entities**:
  - `Resident`: Profile, room group, status (`ACTIVE`, `INACTIVE`, `SUSPENDED`, `ARCHIVED`).
  - `FaceProfile`: 128-dimensional biometric template vector (isolated from resident demographics).
  - `MovementEvent`: Immutable chronological gate transactions (`IN` / `OUT`).
  - `ResidentPresence`: Current indexed physical location (`IN` or `OUT`) for instant querying.
  - `AttendanceSession`: Timed roll-call window with status (`SCHEDULED`, `ACTIVE`, `CLOSED`).
  - `AttendanceRecord`: Session roll call records (`PRESENT`, `ABSENT`, `EXCUSED`, `CORRECTED_PRESENT`).
  - `Camera`: Hardware registration, RTSP connection parameters, and operational roles.
  - `AuditLog`: Append-only security audit log recording all critical state mutations.

---

## 7. Camera Configuration

PRAVAHAx supports two primary camera sources:

| Camera Type | Adapter | Status | Details |
| :--- | :--- | :--- | :--- |
| **USB / Built-in Webcam** | `WebcamAdapter` | **VERIFIED** | Local DirectShow / V4L2 device capture via OpenCV worker (`webcam_worker.py`). |
| **RTSP IP Camera** | `RtspAdapter` | **IMPLEMENTED** | Software RTSP pipeline: **VERIFIED**; Physical external IP camera: **PENDING**. Ingests H.264/H.265 streams via FFmpeg. |

### Camera Roles & Routing
- `CameraRole.IN`: Ingress gate. Stable matches create `IN` movements and transition resident to `IN`.
- `CameraRole.OUT`: Egress gate. Stable matches create `OUT` movements and transition resident to `OUT`.
- `CameraRole.ATTENDANCE`: Roll call station. Stable matches mark residents `PRESENT` during an active attendance session. Never triggers movement transitions.
- `CameraRole.GENERAL`: Live preview and passive monitoring only. Never triggers business side-effects.

---

## 8. Biometric Face Recognition

- **Two-Stage Metric Architecture**: Uses YuNet for face detection and 5-point landmark alignment, followed by SFace for generating a 128-dimensional normalized embedding vector.
- **Quality Gates**: Every candidate face is filtered for minimum bounding-box size, blur score, confidence threshold, and pose angle before feature extraction.
- **Matching & Temporal Stabilization**:
  - Cosine similarity against the hostel's in-memory template cache.
  - Margin verification: Requires separation between the best and second-best candidate to avoid look-alike misidentifications.
  - Spatial IoU tracker over a sliding window (requires 3 consistent match observations within 5 frames) before emitting a confirmed `MATCH`.
  - Configurable cooldown window (default 8 seconds) prevents repeated triggering while an individual remains in the frame.

---

## 9. Gate Movement Engine

- **Strict Alternating Transitions**: Enforces `OUT` → `IN` and `IN` → `OUT`. Same-state recognitions (`IN` when already `IN`) are safely suppressed (`ALREADY_IN`).
- **Concurrency & Locking**: Row-level locking (`SELECT ... FOR UPDATE`) on `ResidentPresence` prevents race conditions when a resident approaches dual-camera gates simultaneously.
- **Rapid Transition Guard**: Suppresses impossible back-to-back oscillations across adjacent cameras (`MOVEMENT_MIN_TRANSITION_INTERVAL_MS`, default 5000ms).
- **Warden Corrections**: Missed gate events can be resolved by Wardens with mandatory justifications, synchronizing `ResidentPresence` and logging to `AuditLog`.

---

## 10. Attendance Sessions & Roll Call

- **Single Active Session Rule**: Hostels can run at most one active attendance session at any given time.
- **Automatic Marking**: Faces observed by `ATTENDANCE` role cameras are automatically recorded as `PRESENT`.
- **Atomic Session Closure**: When the Warden closes an attendance session, all enrolled and un-enrolled active residents who were not marked are atomically marked as `ABSENT` in a single transactional batch.
- **Night Attendance Protection**: A resident recorded as currently `OUT` of the hostel is blocked from automatic `PRESENT` roll call marking until a Warden reviews and executes a formal Missed-IN resolution.

---

## 11. Operational Reports & Data Export

- **Attendance Reports**: Session roll call summaries, attendance percentages (`Present / Expected × 100`), and daily historical rate trends.
- **Movement Reports**: Searchable, paginated gate movement audit logs and real-time headcounts ("Currently Inside" vs "Currently Outside").
- **Spreadsheet-Safe CSV Export**: RFC 4180 compliant CSV export with UTF-8 BOM encoding and formula injection neutralization (sanitizes `=`, `+`, `-`, `@` characters).
- **Role Scoping**: Guards are restricted to real-time presence rosters; historical reports, analytics, and exports are restricted to Wardens and Admins.

---

## 12. Deployment & Lifecycle

PRAVAHAx includes production lifecycle orchestration via `LifecycleManager`:

### Probes & Monitoring
- **Liveness Probe**: `GET /health`
  - Cheap, fast process liveness probe. Returns `200 { "status": "UP", "service": "PRAVAHAx", "timestamp": "..." }`.
  - Does **NOT** access PostgreSQL, cameras, FFmpeg, Python worker, or recognition service.
- **Readiness Probe**: `GET /ready`
  - Validates critical database availability. Returns `200 { "status": "READY", "service": "PRAVAHAx", "database": "CONNECTED", "timestamp": "..." }` or `503 { "status": "NOT_READY", "database": "DISCONNECTED" }`.
  - Zero internal error details or database credentials leaked in probe responses.
  - Camera availability does not block application readiness.

### Graceful Shutdown
- Catches `SIGTERM` and `SIGINT` signals.
- Stops the HTTP listener, disconnects camera adapters, terminates child FFmpeg and Python worker processes, and disconnects Prisma clients. Idempotent across repeated calls.

---

## 13. Security & Data Privacy

- **Zero Raw Photo Retention**: Enrollment photos are processed ephemerally in RAM; only the 128-float mathematical embedding is persisted.
- **No Surveillance Gallery**: Unmatched faces are discarded immediately; no persistent unknown-face gallery is stored.
- **Server-Side Template Isolation**: Biometric templates and similarity scores are never sent to the browser client.
- **CORS Protection**: In production (`NODE_ENV=production`), `CORS_ORIGIN` is mandatory; wildcard `*` is rejected at startup.
- **Credential Storage & Redaction**:
  - RTSP passwords are stored in PostgreSQL `Camera.configMetadata`. They are **NOT** vault-encrypted.
  - Plaintext passwords are automatically redacted from API responses (`rtsp://***:***@...`) and sanitized from application logs and error messages.
- **Production Guardrails**: Production mode blocks weak `JWT_SECRET` keys (< 32 characters), blocks `BIOMETRIC_MOCK=true`, and disables synthetic camera overrides.

---

## 14. Testing & Verification

Run the full automated test suite against an isolated PostgreSQL test database:

```bash
# Run backend tests (318 passing tests)
npm test

# Run frontend test suite (72 passing tests)
cd client && npm test -- --run && cd ..
```

### Performance & Scale Benchmarks
Measured on reference node (PostgreSQL local, 500 residents, 10,000 movements):
- **500 Residents Roster Insert**: `~53 ms`
- **500 Residents Roster Query**: `~3.6 ms`
- **Template Cache Load (500 profiles)**: `~14 ms`
- **Attendance Session Close (500 residents)**: `~31 ms`
- **10k Movement Ingestion**: `~1,216 ms`
- **10k Movement Paginated Query**: `~52 ms`
- **10k Movement CSV Export**: `~286 ms`

---

## 15. Known Limitations & Security Disclaimers

> [!CAUTION]
> **CRITICAL SECURITY DISCLAIMER: Anti-Spoofing & Liveness**
> Anti-spoofing/liveness is not implemented. Printed photographs or screen replay attacks are not guaranteed to be rejected.
> - High-resolution printed photos or screen video replays can potentially fool the system.
> - PRAVAHAx is designed for supervised hostel environments (wardens/guards present) and is **not spoof-proof**.

### Additional Operational Limitations
1. **Physical IP Camera Hardware Pending**: Software RTSP pipeline is **VERIFIED**; field validation on physical external IP camera brands (Hikvision, Dahua, CP Plus) remains **PENDING** site-specific network deployment.
2. **Camera Credential Encryption**: RTSP passwords are stored in PostgreSQL `Camera.configMetadata` (not vault-encrypted). Enterprise HSM/Vault integration is deferred.
3. **No CCTV / NVR Continuous Recording**: The system captures frames purely for real-time inference and does not store continuous surveillance recordings.
4. **No ONVIF Auto-Discovery**: Cameras must be manually configured using their RTSP URLs.
5. **No Automated Leave / Gate Pass System**: Resident leave management remains a future operational integration.

---

## 16. Deployment Readiness Classification

```text
DEVELOPMENT COMPLETE — PILOT READY WITH STATED LIMITATIONS
```
