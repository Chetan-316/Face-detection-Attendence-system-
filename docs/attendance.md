# Hostel Night Attendance Workflow (Step 08)

This document describes the architectural design, workflow semantics, business constraints, camera integration, and manual correction protocol for the PRAVAHAx Hostel Night Attendance system.

---

## 1. Architectural Overview & Responsibility Separation

The hostel attendance subsystem is designed as an operational roll call engine that operates on top of the continuous local face recognition pipeline while strictly preserving system invariants:

```
Camera Frame Source (DirectShow / RTSP / Virtual)
                      │
                      ▼
   Continuous Face Recognition Engine (Step 06)
          (YuNet -> SFace -> Temporal Stabilization)
                      │
           Stable MATCH Observation
                      │
                      ▼
          Recognition Event Router
        ┌─────────────┴─────────────┐
        ▼                           ▼
CameraRole.IN / OUT         CameraRole.ATTENDANCE
Movement Decision Engine    Attendance Decision Service
(Step 07 - Gate Movements)  (Step 08 - Hostel Attendance)
  • Updates ResidentPresence  • Finds active AttendanceSession
  • Creates MovementEvent     • Creates AttendanceRecord (PRESENT)
  • Zero Attendance Records   • Zero Movement Events
                              • ResidentPresence untouched!
```

### Complete Decoupling from Gate Movement
1. **Attendance Cameras (`CameraRole.ATTENDANCE`)**:
   - Only evaluate active attendance sessions.
   - Insert `AttendanceRecord` with status `PRESENT` and mark method `FACE_RECOGNITION`.
   - **Never create MovementEvents**.
   - **Never mutate ResidentPresence**.
2. **Gate Cameras (`CameraRole.IN` / `CameraRole.OUT`)**:
   - Only evaluate gate ingress / egress.
   - Create `MovementEvent` and transition `ResidentPresence`.
   - **Never create AttendanceRecords**.
3. **General Cameras (`CameraRole.GENERAL`)**:
   - Produce recognition observations only without automated side effects.

---

## 2. Attendance Session Lifecycle

An attendance session represents a bounded roll call window (typically a daily night attendance or assembly) for an assigned hostel.

### Session States
- `PENDING`: Created by Warden/Admin with title, date, start time, end time, and optional camera assignment.
- `ACTIVE`: Explicitly started by Warden. Only **one active session** is permitted per hostel at any time. Recognition-driven attendance marking is enabled only while the session is `ACTIVE`.
- `CLOSED`: Explicitly closed by Warden or Admin. Server-side batch generation marks all remaining active, unmarked residents as `ABSENT`. No further automatic marks can be recorded.

### Single Active Session Constraint
If an active session already exists in the hostel, starting another session is strictly rejected with a `409 Conflict` domain error (`ACTIVE_SESSION_EXISTS`).

---

## 3. Real-Time Recognition Attendance Evaluation

When an attendance camera captures a resident face:
1. **Detection & Alignment**: YuNet isolates and aligns the face bounding box.
2. **Feature Extraction**: SFace generates a 128-dimensional L2-normalized embedding.
3. **Template Match**: Compared against the hostel-scoped face profiles.
4. **Temporal Stabilization**: 5-frame window with IoU tracking requires at least 3 matching frames to emit a `stableMatch`.
5. **Bridge Routing**: The recognition bridge checks `camera.role === 'ATTENDANCE'`. If true, forwards to `AttendanceDecisionService.evaluateObservation()`.
6. **Decision Processing**:
   - **Session Verification**: Searches for an active session assigned to this camera or generally for this hostel. If no active session exists, drops with `NO_ACTIVE_SESSION`.
   - **Schedule Window Guard**: Verifies current time falls within `[startTime - 15m, endTime + 30m]`. If outside, drops with `OUTSIDE_SESSION_WINDOW`.
   - **Scope Verification**: Ensures `resident.hostelId === session.hostelId` and `resident.organizationId === session.organizationId`.
   - **Status Verification**: Resident must have `status === 'ACTIVE'`.
   - **Idempotency & Duplicate Suppression**: If the resident already has an `AttendanceRecord` in this session, the event is immediately acknowledged as `ALREADY_MARKED` with zero database writes.
   - **Concurrent Duplicate Protection**: In-flight in-memory deduplication and database composite unique constraint `(attendanceSessionId, residentId)` prevent concurrent double-marking under high traffic.
   - **Record Creation**: Atomically inserts `AttendanceRecord` with `status: 'PRESENT'`, `markedAt: now()`, and `markMethod: 'FACE_RECOGNITION'`.

---

## 4. Session Closing & Server-Side Absence Generation

When a Warden or Admin closes an attendance session via `POST /api/v1/attendance/sessions/:id/close`:
1. **Concurrency Lock**: Row-level locking ensures atomic session status transition from `ACTIVE` to `CLOSED`.
2. **Roster Evaluation**: Queries all active residents belonging to the session's hostel who do **not** have an `AttendanceRecord` for this session.
3. **Atomic Absence Batching**: Unmarked residents are batch-inserted with `status: 'ABSENT'`, `markMethod: 'SYSTEM_ABSENT'`, and `markedAt: session.endTime || now()`.
4. **Active Residents Without Face Profile**: Residents who are active but not enrolled for facial recognition are fully included in the roster and marked `ABSENT` upon session closure.
5. **Idempotency**: Repeated close calls on an already closed session return the existing closed state and stats without error or duplicate insertion.

---

## 5. Audited Manual Corrections

Wardens and Admins may manually override attendance records (e.g., resident was physically present in the room or reported late):
- **Endpoint**: `PATCH /api/v1/attendance/sessions/:sessionId/records/:residentId`
- **Permissions**: WARDEN and ADMIN only (GUARD requests are rejected with `403 Forbidden`).
- **Mandatory Justification**: A non-empty reason (`reason.trim().length >= 3`) is strictly enforced.
- **Audit Trail**: Generates an append-only `AuditLog` entry with action `ATTENDANCE_OVERRIDE`, recording previous status, new status, actor details, timestamp, and justification reason.
- **Record Integrity**: Sets `correctionReason` and changes `markMethod` to `MANUAL_OVERRIDE`.

---

## 6. Resident Roster & Statistics

The attendance roster endpoint (`GET /api/v1/attendance/sessions/:id/records`) provides a single, comprehensive roll call view:
- **Expected Count**: Total active residents enrolled in the hostel at session time.
- **Present Count**: Residents marked `PRESENT`.
- **Absent Count**: Residents marked `ABSENT`.
- **Remaining Count**: Unmarked residents (`expectedResidents - presentCount`).
- **Roster Items**: Every resident row includes `residentId`, `residentCode`, `fullName`, `roomGroup`, `faceEnrollmentStatus` (`ENROLLED` vs `NOT_ENROLLED`), current `status` (`PRESENT`, `ABSENT`, or `NOT_RECORDED`), `markedAt`, `markMethod`, and `correctionReason`.

---

## 7. Privacy & Enterprise SaaS Standards

1. **Biometric Decoupling**: No face images, bounding box coordinates, or raw embeddings are exposed in attendance responses or client state.
2. **Professional SaaS Wording**: Standard user-facing views strictly avoid AI and computer vision jargon (no "neural network", "cosine similarity", "embedding distance", or "AI attendance engine"). UI terms use standard residential administration language ("Roll Call", "Attendance Session", "Present", "Absent", "Automatic Recognition").
3. **Role-Based Guards**: Guards can view live roster counts but cannot create sessions, start sessions, close sessions, or execute manual corrections.
