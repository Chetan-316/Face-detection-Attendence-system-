# PRAVAHAx: Production Readiness & Pilot Deployment Guide

## 1. System Architecture Overview

PRAVAHAx is an on-premise, privacy-focused facial recognition hostel attendance and gate movement automation system.

```text
Camera Stream (Webcam / RTSP IP Camera via FFmpeg)
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

## 2. Infrastructure & System Requirements

### Hardware Requirements (Minimum Pilot Node)
- **CPU**: Intel Core i5 / AMD Ryzen 5 (4+ physical cores)
- **RAM**: 8 GB minimum (16 GB recommended for multi-stream deployments)
- **Storage**: 50 GB SSD for OS, database, and logs (no raw video or photo history is persisted)
- **Network**: Dedicated Gigabit LAN for IP cameras to prevent frame packet drop

### Software Dependencies
- **Operating System**: Windows 10/11 / Windows Server or Linux (Ubuntu 22.04 LTS+)
- **Node.js**: v18.x or v20.x LTS
- **PostgreSQL**: v14, v15, or v16
- **Python**: v3.10 or v3.11 with `opencv-python>=4.8.0`, `numpy>=1.24.0`, `onnxruntime>=1.15.0`
- **FFmpeg**: v5.x or v6.x (must be installed in system `PATH` or configured via `FFMPEG_PATH`)
- **Pretrained ONNX Models**:
  - YuNet Detection: `face_detection_yunet_2023mar.onnx`
  - SFace Embedder: `face_recognition_sface_2021dec.onnx`

---

## 3. Production Deployment Procedure

### Step 1: Clone and Install
```bash
git clone https://github.com/Chetan-316/Face-detection-Attendence-system-.git
cd Face-detection-Attendence-system-
npm ci
cd client && npm ci && cd ..
```

### Step 2: Configure Environment
Copy `.env.example` to `.env` and fill in real production secrets:
```bash
cp .env.example .env
```
Ensure:
- `NODE_ENV=production`
- `JWT_SECRET` has at least 32 cryptographically random characters
- `CORS_ORIGIN` lists only authorized frontend hostnames (e.g., `http://hostel-server:3000`)
- `BIOMETRIC_MOCK=false`

### Step 3: Database Migrations
Always run production migrations using Prisma's non-destructive command:
```bash
npx prisma migrate deploy
```
*(Never run `prisma migrate reset` in production environments).*

### Step 4: Build Application
```bash
npm run build
```
This compiles the backend TypeScript to `dist/` and compiles the frontend React bundle to `dist/public` or `client/dist`.

### Step 5: Start Service
```bash
npm start
```

---

## 4. Startup, Health & Shutdown Lifecycle

### Startup Reliability & Production Guards
PRAVAHAx initializes through `LifecycleManager`:
1. **Database Startup Check**: Verifies PostgreSQL connection before launching HTTP listener. If PostgreSQL is unreachable, the process fails fast with code 1, preventing a half-running corrupted state.
2. **Production Guards**:
   - `JWT_SECRET`: Must be explicitly configured with a secure random key of at least 32 characters in production.
   - `BIOMETRIC_MOCK`: Must remain `false` in production; any attempt to run mock biometrics in production causes immediate startup failure.
   - `CORS_ORIGIN`: Must be explicitly set with trusted frontend origin(s) in production; missing, empty, or wildcard `*` values cause immediate startup rejection.
   - `testInputOverride`: Synthetic camera feed overrides are strictly forbidden in production on `/cameras` routes.
3. **Decoupled Camera Startup**: Physical cameras are **lazy-loaded**. A dead or offline camera does **not** block backend startup or HTTP readiness.

### Endpoints
- **Liveness Probe**: `GET /health`
  - Cheap, fast process liveness probe. Returns `200 { "status": "UP", "service": "PRAVAHAx", "timestamp": "..." }`.
  - Must **NOT** access PostgreSQL, cameras, FFmpeg, Python worker, or recognition service.
  - Returns 200 as long as the Node process is running.
- **Readiness Probe**: `GET /ready`
  - Validates critical database availability. Returns `200 { status: "READY", service: "PRAVAHAx", database: "CONNECTED", timestamp: "..." }` or `503 { status: "NOT_READY", database: "DISCONNECTED" }`.
  - Operational camera status does not control application readiness.
  - Zero internal Prisma, PostgreSQL, or network error details are disclosed in failure responses.

### Graceful Shutdown
PRAVAHAx catches `SIGTERM` and `SIGINT` signals:
1. Stops accepting incoming HTTP requests (`server.close()`).
2. Disconnects all active camera adapters and kills child FFmpeg processes.
3. Signals and terminates the Python biometric worker process.
4. Closes active SSE connections.
5. Disconnects the Prisma database client.
- **Idempotency**: Repeated calls to `shutdown()` are protected by a state flag and will not crash or hang.

---

## 5. Camera Recovery & Resilience

### RTSP IP Camera Pipeline
- **Auto-Reconnect**: If a network cable drops or an RTSP stream drops, the camera transitions to `DEGRADED` status and enters an exponential backoff reconnect loop (1s, 2s, 4s... max 30s).
- **Auto-Recovery**: When the camera stream becomes available again, FFmpeg resumes piping frames, transitions back to `ONLINE`, and recognition resumes without requiring a backend restart.
- **Credential Masking**: All RTSP URLs containing passwords (`rtsp://user:pass@host/...`) are sanitized before being logged or returned through the API (`rtsp://***:***@host/...`).

### USB / Built-in Webcam
- OpenCV VideoCapture backend manages device handle. If physically unplugged, the adapter catches the frame failure, logs diagnostic warnings, and cleanly stops without crashing the Node.js server.

---

## 6. Biometric Worker Recovery & Fail-Safe Writes

- **Worker Process Isolation**: The biometric detection and embedding runs in an isolated Python process communicating via JSON IPC over stdin/stdout.
- **Crash Recovery**: If the Python worker crashes unexpectedly, `BiometricService` marks the worker state as offline and attempts bounded auto-recovery.
- **Zero False Writes**: When biometrics or frames fail, the recognition service reports `QUALITY_INSUFFICIENT` or error. It **never** guesses resident identity and produces **zero** false `MovementEvent` or `AttendanceRecord` writes.

---

## 7. Data Privacy & Retention Policy

PRAVAHAx strictly observes on-premise biometric privacy principles:

| Stored in Database | NOT Stored / Transient Only |
| :--- | :--- |
| Resident Metadata (Name, Code, Room, Status) | Raw enrollment photographs (discarded after template extraction) |
| Normalized 128-dimensional SFace templates | Gallery of unknown faces |
| Attendance Records & Session Audit Logs | Full-frame CCTV surveillance recordings |
| Gate Movement History & Presence State | Raw camera video feeds (never saved to disk) |
| Staff User Accounts & Hashed Passwords | Raw embeddings returned to browser UI |

- **No Raw Photos**: Face enrollment photos are processed in-memory. Only the mathematical 128-float embedding vector is stored.
- **Unknown Faces**: Faces that do not match enrolled residents are discarded immediately after temporal evaluation; no surveillance images of un-enrolled persons are persisted.
- **Security Headers**: Production uses Helmet middleware, restricting referrer headers and blocking MIME sniffing.

---

## 8. Backup & Disaster Recovery

### PostgreSQL Backup (`pg_dump`)
Run a scheduled daily database backup:
```bash
pg_dump -U postgres -h localhost -p 5433 -F c -b -v -f "pravahax_backup_$(date +%Y%m%d_%H%M%S).dump" pravahax_db
```

### PostgreSQL Restore (`pg_restore`)
In disaster recovery scenarios:
```bash
# 1. Stop the application
npm stop  # or kill Node process

# 2. Restore database
pg_restore -U postgres -h localhost -p 5433 -d pravahax_db -v -c "pravahax_backup_YYYYMMDD_HHMMSS.dump"

# 3. Verify schema & restart application
npx prisma migrate status
npm start
```

---

## 9. Performance & Scale Benchmarks

Measured on reference development node (PostgreSQL local, 500 residents, 10,000 movements):

- **Resident Roster Insertion (500 residents)**: ~53 ms
- **Paginated Resident Roster Retrieval**: ~3.6 ms
- **Template Cache Loading (500 profiles)**: ~14.2 ms
- **Attendance Session Close (500 residents, 100 auto-absent marks)**: ~31.7 ms
- **Movement Event Ingestion (10,000 events)**: ~1,216 ms
- **Paginated Movement History Query (10,000 events)**: ~52.8 ms
- **Filtered Movement Query**: ~17.6 ms
- **Large CSV Export (10,000 rows with formula sanitization)**: ~286 ms

---

## 10. Known Limitations & Security Disclaimers

> [!CAUTION]
> **CRITICAL SECURITY DISCLAIMER: Anti-Spoofing & Liveness**
> Anti-spoofing/liveness is not implemented. Printed photographs or screen replay attacks are not guaranteed to be rejected.
> - High-resolution printed photographs or screen replay videos presented to the camera can potentially trigger false matches.
> - For high-security gates, facial recognition must be paired with physical turnstiles, guard verification, or secondary credentials.

### Additional Limitations
1. **Physical IP Camera Hardware Status**:
   - The software RTSP streaming pipeline, FFmpeg ingestion, credential redaction, and auto-reconnect logic are **VERIFIED**.
   - Deployment on physical external IP camera hardware remains **PENDING** site-specific network validation (RTSP URL formats vary across Dahua, Hikvision, CP Plus).
2. **Camera Credential Storage**:
   - RTSP passwords are stored in PostgreSQL `Camera.configMetadata`. They are **NOT** vault-encrypted.
   - Credentials are automatically redacted from API responses (`rtsp://***:***@...`) and stripped from application logs and error messages. Enterprise HSM/Vault integration is deferred.
3. **No CCTV / NVR Continuous Recording**:
   - PRAVAHAx is an attendance and movement logging tool, not a continuous Network Video Recorder. No continuous video storage is provided.
4. **No ONVIF Auto-Discovery**:
   - Cameras must be configured manually via IP/RTSP URL.

---

## 11. Acceptance Status & Deployment Readiness

- **Readiness Classification**:
  `DEVELOPMENT COMPLETE — PILOT READY WITH STATED LIMITATIONS`
- **Software RTSP Pipeline**: `VERIFIED`
- **Physical Network Camera**: `PENDING`
