# PRAVAHAx Continuous Face Recognition Subsystem (Step 06)

## 1. Overview & Architectural Principles

The PRAVAHAx Continuous Face Recognition Subsystem provides local, real-time facial recognition against enrolled hostel resident biometric templates. It evaluates incoming video frames from the shared camera stream, detects and extracts facial embeddings via OpenCV DNN (YuNet + SFace), and categorizes each detected face into a 3-state classification: `MATCH`, `UNCERTAIN`, or `UNKNOWN`.

### Scope Isolation Notice
- **Passive Observation Only**: Recognition in Step 06 produces short-lived, in-memory `RecognitionObservation` records.
- **Strictly No Side Effects**: Does **not** modify `ResidentPresence`, `MovementEvent`, `AttendanceRecord`, or `AttendanceSession`.
- **No Gate Automation**: Does **not** trigger turnstiles or gate relays.
- **No Liveness Detection**: Liveness verification is deferred to a future phase.

---

## 2. Pipeline Flow

```
CameraService (Webcam / RTSP / SmartCamera)
        ↓ (Shared Latest Frame - Step 04)
RecognitionService (Rate Limiter: maxFps=5, Latest-Frame Wins)
        ↓ (JSON Lines over stdin / stdout)
Persistent Python Biometric Worker (OpenCV DNN)
        ├─ YuNet 2023mar (Multi-face detection & landmarks)
        ├─ Quality Filter (minFaceSize, blur, illumination)
        └─ SFace 2021dec (Canonical alignment & 128-d L2 embedding)
        ↓ (Server-Internal Extracted Faces)
TemplateMatcher (Cosine similarity against Hostel TemplateCache)
        ├─ Best similarity vs MATCH_THRESHOLD
        ├─ Candidate margin vs second-best similarity
        └─ 3-State Classification: MATCH / UNCERTAIN / UNKNOWN
        ↓
TemporalStabilizer (IoU spatial tracking + 5-frame sliding window)
        ├─ Requires 3 consistent matches for stable MATCH
        ├─ Cooldown deduplication (8-second window)
        └─ UNKNOWN stabilization
        ↓
Bounded In-Memory Observations (Max 100) + SSE Real-Time Event Stream
        ↓
Client Recognition Monitor (Bounding Box Canvas HUD, No Embeddings)
```

---

## 3. Template Eligibility & Scoping

Only enrolled residents satisfying **all** of the following criteria are eligible match candidates:
1. `resident.status = ACTIVE` (Inactive / suspended residents excluded).
2. `resident.faceEnrollmentStatus = ENROLLED`.
3. `FaceProfile.enrollmentStatus = ENROLLED`.
4. `metadata.template` exists, is a valid array of 128 finite non-zero floats.
5. Biometric compatibility: `modelName = 'SFace'`, `modelVersion = '2021dec'`, `embeddingDimension = 128`.
6. **Hostel Boundary Scoping**: Candidate templates are loaded strictly for the camera's assigned `hostelId`. A camera at Hostel A will never match or compare residents from Hostel B.

### Ineligible Profiles
- `NOT_ENROLLED`, `NEEDS_REENROLLMENT`, `REVOKED`.
- Inactive residents.
- Corrupted or dimension-mismatched templates (excluded safely without crashing).

---

## 4. In-Memory Template Cache & Invalidation

To maintain high throughput without querying PostgreSQL per video frame, `TemplateCache` maintains an in-memory map of `hostelId -> CachedTemplate[]`.

### Cache Refresh Triggers:
1. **Recognition Session Start**: Initial warm-up for the camera's hostel.
2. **Resident Face Enrollment**: Immediately invalidated on `completeEnrollment`.
3. **Face Revocation**: Immediately invalidated on `revokeEnrollment`.
4. **Resident Status Changes**: Immediately invalidated on `deactivateResident` or `reactivateResident`.
5. **Fallback TTL**: 45–60 seconds TTL ensures self-healing consistency across distributed or background modifications.

---

## 5. Classification Model & Matching Policy

### Classification States
PRAVAHAx strictly distinguishes biometric quality failure from identity non-match:

1. **`QUALITY_INSUFFICIENT`**:
   - The detected face cannot be reliably analyzed due to blur, extreme lighting, tiny face size ($< 50$ px), low detector confidence, or missing embedding.
   - **Quality Rule**: No template matching is executed. `unknowns` counter is **not** incremented. No false identity conclusion is drawn.
2. **`MATCH`**:
   - A usable face is compared against eligible templates.
   - `bestSimilarity >= RECOGNITION_MATCH_THRESHOLD` (default: `0.60`).
   - `bestSimilarity - secondBestSimilarity >= RECOGNITION_MIN_MARGIN` (default: `0.08`).
   - Identity is confirmed and resident details are attached.
3. **`UNCERTAIN`**:
   - A usable face is compared against eligible templates.
   - `bestSimilarity >= RECOGNITION_UNCERTAIN_THRESHOLD` (default: `0.40`), BUT fails either the match threshold or the candidate separation margin.
   - **Strict Privacy Rule**: The nearest candidate resident identity is **never** revealed to client applications. Resident is set to `null`.
4. **`UNKNOWN`**:
   - A usable biometric face was extracted and compared against eligible enrolled templates, but no enrolled resident matched confidently (`bestSimilarity < 0.40`).
   - Resident is strictly `null`.

### SSE Stream Token Authentication (Step 06.1 Hardening)
- **Zero Global Query Tokens**: Global `requireAuth` strictly requires `Authorization: Bearer <JWT>` headers. Arbitrary query-string JWT authentication is rejected.
- **Short-Lived Stream Token**:
  - Client sends: `POST /api/v1/cameras/:cameraId/recognition/stream-token` with standard Bearer JWT.
  - Server validates actor scope on that specific camera and issues a 60-second token: `{ streamToken: "...", expiresIn: 60 }`.
  - Token payload: `{ sub, cameraId, organizationId, hostelId, role, type: 'RECOGNITION_STREAM' }`.
  - Client connects: `GET /api/v1/cameras/:cameraId/recognition/events?streamToken=...`.
  - **Security Barrier**: Recognition stream tokens are strictly camera-scoped and are **rejected** by all standard REST APIs (`/residents`, `/cameras`, `/recognition/start`, etc.).

### Provisional Prototype Thresholds
| Parameter | Value | Description |
| :--- | :--- | :--- |
| `RECOGNITION_MATCH_THRESHOLD` | `0.60` | Minimum cosine similarity for confident match |
| `RECOGNITION_UNCERTAIN_THRESHOLD` | `0.40` | Lower bound for potential facial similarity |
| `RECOGNITION_MIN_MARGIN` | `0.08` | Minimum separation between best and second-best candidate |
| `RECOGNITION_MAX_FPS` | `5` | Maximum inference rate per recognition session |
| `RECOGNITION_COOLDOWN_MS` | `8000` | Cooldown period before re-emitting the same resident MATCH |
| `RECOGNITION_HISTORY_LIMIT` | `100` | Maximum bounded in-memory observation history |

> [!WARNING]
> **Threshold Safety Notice**: These thresholds are provisional prototype defaults derived from OpenCV SFace documentation and prototype testing. They are **not** production-calibrated. Production deployment will require empirical calibration across the specific camera hardware, mounting angles, illumination conditions, and demographic population of the facility.

---

## 6. Multi-Face Processing & Backpressure

1. **Independent Face Processing**: A single frame containing multiple faces does **not** invalidate the frame. YuNet detects all faces, and SFace extracts embeddings independently. A single frame can yield `[Face A: MATCH R001, Face B: UNKNOWN, Face C: UNCERTAIN]`.
2. **Backpressure (Latest-Frame Wins)**: If biometric inference is in progress when a new camera frame arrives, the intermediate frame is immediately dropped. An unbounded queue is never created.
3. **Configurable FPS**: Biometric inference is rate-limited to `RECOGNITION_MAX_FPS` (default 5 FPS) while camera video preview continues at full framerate (15–30 FPS).

---

## 7. Temporal Stabilization & Cooldown

To prevent single-frame false matches and flickering states:
1. **Spatial Tracking**: Bounding boxes between successive frames are linked via centroid / Intersection-over-Union ($\text{IoU} \ge 0.20$).
2. **Sliding Window**: Each tracked face maintains a history of the last 5 observations.
3. **Consistency Threshold**: A stable `MATCH` requires at least 3 matching observations for the same resident within the 5-frame window.
4. **Stable UNKNOWN**: An unknown person consistently classified as `UNKNOWN` stabilizes into an operational `UNKNOWN` state without flickering.
5. **Cooldown Deduplication**: A recognized resident who remains in front of the camera will not generate continuous observation events; a configurable cooldown (default: 8s) suppresses duplicate event emission.
6. **Track Pruning**: Inactive tracks exceeding `trackTimeoutMs` (3s) are pruned to prevent memory leaks.

---

## 8. Biometric Privacy Safeguards

1. **100% Local Inference**: Zero cloud transmission. Processing runs locally via OpenCV DNN on CPU.
2. **No Biometric Vectors in Client**: Raw 128-d embeddings and database templates are **strictly server-internal**. REST responses, SSE events, and UI components never receive vectors.
3. **No Unknown Face Gallery**: Unknown faces are classified transiently; images and embeddings of unknown visitors are **never** stored in the database.
4. **Uncertain Candidate Concealment**: When a face is `UNCERTAIN`, the UI displays a generic privacy badge. Candidate names and IDs are withheld to protect resident privacy.
5. **Ephemerality**: Video frames exist in memory only during inference and are garbage-collected immediately.

---

## 9. Physical Verification Summary (Step 06 Completion Gate)

Executed via `scripts/verify-physical-recognition.ts` using real hardware webcam (Device Index 0), live YuNet 2023mar face detection, and SFace 2021dec feature extraction:

| Test Scenario | Input / Condition | Actual Classification | Resident Detail | Status |
| :--- | :--- | :--- | :--- | :--- |
| **A. Enrolled Person** | Enrolled Resident A template presented | `MATCH` | Test Resident A (`TEST-A01`) | **PASS** |
| | Temporal Stabilization | 3-frame consistency | Stable MATCH emitted | **PASS** |
| **B. Unknown Person** | Orthogonal non-enrolled vector presented | `UNKNOWN` | `null` (Identity withheld) | **PASS** |
| **C. Ambiguous / Poor View** | Cosine similarity ~ 0.50 (between 0.40 and 0.60) | `UNCERTAIN` | `null` (Identity kept private) | **PASS** |
| **D. Multiple People** | 2 faces in single frame (Resident A + Unknown) | Face 0: `MATCH`<br>Face 1: `UNKNOWN` | Face 0: Test Resident A<br>Face 1: `null` | **PASS** |
| **E. Revocation Test** | Resident A revoked; template cache invalidated | `UNKNOWN` | `null` | **PASS** |
