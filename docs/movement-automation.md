# PRAVAHAx Gate Movement Automation Engine (Step 07)

## 1. System Architecture

The Movement Decision Engine converts temporally stabilized face recognition observations from gate cameras into safe, deterministic hostel movement decisions (`IN` / `OUT`) and updates authoritative resident presence.

Biometric inference remains strictly decoupled from business side effects:

```
Camera Stream (Laptop Webcam / RTSP / Smart Camera)
   │
   ▼
CameraService (Frame Acquisition & MJPEG Stream)
   │
   ▼
RecognitionService (Python Worker Inference -> TemplateMatcher -> TemporalStabilizer)
   │
   ▼ [Stable MATCH Observation Only]
MovementRecognitionBridge
   │
   ▼
MovementDecisionService (Eligibility, Scope, Presence State Machine, Guards, Idempotency)
   │
   ▼ [Validated State Transition]
MovementService (Atomic PostgreSQL Transaction with FOR UPDATE Row-Level Locking)
   │
   ├─► MovementEvent Created (Persistent Operational Record, Source: FACE_RECOGNITION)
   ├─► ResidentPresence Updated (Authoritative IN / OUT Hostel State)
   └─► AuditLog Recorded (Comprehensive Traceability)
```

### Architectural Guardrails
- **Inference Separation**: Python workers and biometric template matchers never write directly to PostgreSQL or make business movement decisions.
- **Server-Derived Direction**: Movement direction (`IN` / `OUT`) is derived strictly from `camera.role`. Client requests are never allowed to dictate movement direction for automatic recognition.
- **Stable MATCH Only**: Automatic movement occurs **only** when `classification === 'MATCH'`, `isStable === true`, and `shouldEmitEvent === true`. `UNKNOWN`, `UNCERTAIN`, and `QUALITY_INSUFFICIENT` classifications never create movement side effects.

---

## 2. Camera Role Rules

| Camera Role | Recognition Allowed? | Automatic Movement Side Effect |
| :--- | :--- | :--- |
| `IN` | Yes | Stable MATCH triggers `OUT -> IN` movement event & updates presence to `IN`. |
| `OUT` | Yes | Stable MATCH triggers `IN -> OUT` movement event & updates presence to `OUT`. |
| `GENERAL` | Yes | Passive recognition only. Return: `CAMERA_NOT_MOVEMENT_CAPABLE`. No movement created. |
| `ATTENDANCE` | Yes | Reserved for assembly / roll-call checkpoints. Return: `CAMERA_NOT_MOVEMENT_CAPABLE`. No gate movement created. |

---

## 3. Movement State Machine

Authoritative hostel residency is stored in `ResidentPresence` (`currentState: IN | OUT`).

| Current Presence | Camera Role | Action Taken | Result Status |
| :--- | :--- | :--- | :--- |
| `OUT` | `IN` | Commit IN MovementEvent; set Presence = `IN` | `MOVEMENT_CREATED` |
| `IN` | `IN` | No movement event; presence remains `IN` | `ALREADY_IN` (Duplicate Suppressed) |
| `IN` | `OUT` | Commit OUT MovementEvent; set Presence = `OUT` | `MOVEMENT_CREATED` |
| `OUT` | `OUT` | No movement event; presence remains `OUT` | `ALREADY_OUT` (Duplicate Suppressed) |

---

## 4. Initial Presence Policy

When a resident has no initial `ResidentPresence` record in PostgreSQL (e.g. legacy or edge-case records):
- **IN Camera**: Safely initializes the resident's presence to `IN` and creates the `IN` `MovementEvent`.
- **OUT Camera**: Safely **refuses** automatic `OUT` movement (`INITIAL_PRESENCE_MISSING`). Because default hostel admission assumes new residents originate outside until entering, an automated egress gate cannot assume prior inside presence without human staff verification.

---

## 5. Idempotency & Replay Defense

Every recognition observation carries a unique identifier (`obs.id`).
1. **In-Memory Cache**: `MovementDecisionService` caches recent processed observation IDs with an LRU policy. Repeated observation calls within the window immediately return `DUPLICATE_OBSERVATION_SUPPRESSED`.
2. **Database Deduplication**: `MovementEvent.recognitionReference` stores the originating observation ID. If an observation is replayed after a service restart or SSE reconnect, the database is queried for `where: { recognitionReference: observation.id }` and returns `DUPLICATE_OBSERVATION_SUPPRESSED`.
3. Exactly **one** `MovementEvent` can be generated per observation.

---

## 6. Guards & Cooldowns

1. **Biometric Stabilization Cooldown**:
   - `TemporalStabilizer` requires consistent recognition across sliding frames (`minConsistentFrames = 3`) and enforces an 8000ms cooldown before emitting another stable event for the same resident.
2. **Operational Transition Guard**:
   - `MOVEMENT_MIN_TRANSITION_INTERVAL_MS` (default: `5000ms`).
   - If a resident is recognized at an IN gate and appears at an OUT gate within 5 seconds (rapid oscillation or overlapping cameras), the opposite transition is blocked:
   - Return status: `TRANSITION_SUPPRESSED`.

---

## 7. Automation Switches & Safety Controls

To safeguard operations, automatic side effects can be toggled without halting face recognition:
1. **Global Automation Switch**:
   - Config: `MOVEMENT_AUTOMATION_ENABLED` (env var, default `false`).
   - Runtime: `GET /api/v1/movements/automation-status` and `PATCH /api/v1/movements/automation-status`.
   - When disabled: observations return `AUTOMATION_DISABLED`, no database changes occur, recognition monitor displays `Movement automation: DISABLED`.
2. **Per-Camera Switch**:
   - Stored in `Camera.configMetadata.movementAutomationEnabled` (boolean).
   - Allows disabling automation on specific gate hardware while keeping other gates active.

---

## 8. Data Privacy & Vector Protection

- `MovementEvent` stores: `residentId`, `hostelId`, `locationId`, `cameraId`, `movementType`, `source = FACE_RECOGNITION`, `recognitionReference`, `effectiveTimestamp`, `notes`.
- **STRICT PROHIBITION**: `MovementEvent`, `ResidentPresence`, and `AuditLog` **never** store face embeddings, 128-d vectors, biometric templates, or face crops.

---

## 9. Role-Based Access Control

| Role | Movement History | Toggle Automation | Live Gate Feed | Template Editing |
| :--- | :--- | :--- | :--- | :--- |
| `ADMIN` | All in Organization | Yes (Global) | Yes | Restricted to enrolled flows |
| `WARDEN` | Assigned Hostel Only | Yes (Hostel/Global) | Yes | Yes (Authorized) |
| `GUARD` | Assigned Hostel Only | No (View-Only) | Yes | Forbidden |

---

## 10. Side-Effect Isolation Proof

Step 07 maintains complete independence between gate movement and other hostel modules:
- **No Attendance Side Effects**: Does not create or update `AttendanceSession` or `AttendanceRecord`.
- **No Leave Side Effects**: Does not approve, cancel, or modify resident leave records.
- **Physical Verification**: Tested with consenting test subjects for:
  - Valid `OUT -> IN` and `IN -> OUT` transitions.
  - Duplicate same-direction presence suppression.
  - Rejection of unknown, uncertain, and low-quality faces.
  - Operational behavior when movement automation is switched off.
