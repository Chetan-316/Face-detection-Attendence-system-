# PRAVAHAx Biometric Architecture & Privacy Policy

## 1. Overview & Architectural Principles

The PRAVAHAx Biometric Subsystem provides localized, zero-cloud face enrollment and feature extraction for hostel residents.

### Biometric Architecture Rule
- **Zero Retraining Per Resident**: Adding a new resident does **not** retrain or fine-tune neural network weights. No custom YOLO classes or resident-specific classifiers are created.
- **Pretrained Embedding Space**: The system projects aligned face crops into a metric embedding space where identity consistency is governed by cosine distance.
- **Decoupled Architecture**:
  ```
  Camera Adapter / Shared Stream
             ↓ (Raw Frames)
   Face Enrollment Service
             ↓ (JSON Lines over stdin / stdout)
     Python Face Worker
             ↓ (CPU Inference)
  Detector + Embedder selected by BIOMETRIC_ENGINE
             ↓
  legacy: YuNet + SFace → 128-D
  scrfd_adaface: SCRFD 2.5G KPS + AdaFace IR50 → 512-D
   PostgreSQL FaceProfile + Resident
  ```

---

## 2. Model Stack & Specifications

The biometric worker is versioned by `BIOMETRIC_ENGINE`.

| Engine | Detector | Recognizer | Embedding | Runtime | Intended state |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `legacy` | YuNet `2023mar` | SFace `2021dec` | 128-D | OpenCV DNN | Stable rollback / existing profiles |
| `scrfd_adaface` | SCRFD `2.5G-KPS` | AdaFace `IR50` | 512-D | ONNX Runtime | New production-target architecture |

### SCRFD + AdaFace processing contract

1. SCRFD receives a padded 640×640 frame and returns face boxes plus five facial landmarks.
2. The five landmarks are transformed to the canonical 112×112 face geometry.
3. The aligned crop is normalized for the approved AdaFace IR50 export. Channel order is explicit through `ADAFACE_COLOR_SPACE` (default `RGB`) so custom/older exports can declare `BGR` when required.
4. AdaFace produces a 512-D vector.
5. The vector is L2-normalized before enrollment aggregation or cosine matching.
6. Matching remains three-state: `MATCH`, `UNCERTAIN`, or `UNKNOWN`.
7. Movement/attendance business logic remains outside the biometric worker.

### Model-artifact licensing boundary

Source code and model weights are treated separately. The repository does **not** automatically bundle SCRFD/AdaFace research checkpoints. Operators must supply model paths or approved download URLs and may optionally pin SHA-256 checksums. The worker fails closed when the selected real engine cannot load its model artifacts; mock fallback is allowed only when explicitly enabled.

### Template migration rule

SFace 128-D templates and AdaFace 512-D templates are different embedding spaces and are never mixed. When `scrfd_adaface` is activated:

- the recognition cache only loads AdaFace profiles matching the configured model/version/dimension/template contract;
- legacy SFace profiles remain enrolled as rollback-compatible profiles, but are not eligible while AdaFace is active;
- the cache selects the newest profile compatible with the currently active engine, so switching back to the legacy engine can reuse preserved SFace profiles;
- each resident must still be enrolled once with the new engine before AdaFace recognition can identify them;
- threshold values must be calibrated on the actual gate/camera environment before final acceptance.

---

## 3. Strict Biometric Privacy & Data Protection

Biometric data is classified as highly sensitive personal data. PRAVAHAx enforces the following safeguards:

1. **100% On-Premise & Local Processing**:
   - Biometric processing runs entirely on the host machine.
   - No frames, crops, or embeddings are transmitted to any external cloud, API, or third-party service.

2. **No Raw Frame Persistence**:
   - Raw webcam frames, video recordings, and full-resolution enrollment photographs are **never** stored on disk or in the database.
   - Temporary frames exist only in volatile system memory during processing and are immediately dereferenced and garbage-collected once the embedding vector is produced.

3. **Embedding Protection**:
   - Raw vector embeddings are **never** returned in normal REST API responses.
   - Raw vector embeddings are **never** written to application logs, audit logs, or error dumps.
   - Raw vector embeddings are **never** embedded in JWT tokens or accessible via client frontend state.

4. **Biometric Revocation Safeguard**:
   - When a resident's biometric profile is revoked by an authorized staff member, the stored template vector is permanently purged from the database record (`metadata.template = null`).
   - Revoked records cannot be utilized for active face matching.

---

## 4. Quality Inspection Gates & Constraints

Every enrollment sample must satisfy strict automated quality checks:

| Quality Rule | Rejection Code | Description |
| :--- | :--- | :--- |
| **Single-Face Constraint** | `NO_FACE` / `MULTIPLE_FACES` | Exactly one face must be visible. Multi-person frames are strictly rejected. |
| **Minimum Face Size** | `FACE_TOO_SMALL` | Recognition rejects faces smaller than the configured minimum; enrollment also checks relative face size. |
| **Central Positioning** | `FACE_OFF_CENTER` | Enrollment verifies that the face remains within the configured capture region. |
| **Focus & Sharpness** | `TOO_BLURRY` | Laplacian variance is used to reject heavily blurred face crops. |
| **Illumination** | `TOO_DARK` / `TOO_BRIGHT` | Mean face-crop luminance is checked against configured bounds. |
| **Detection Confidence** | `LOW_DETECTION_CONFIDENCE` | The active detector score must satisfy the configured confidence threshold. |

---

## 5. Multi-Sample Accumulation & Consistency Verification

- **Sample Pacing**: Accepted manual enrollment samples are spaced by at least 200ms.
- **Required Samples**: Five accepted samples are required: FRONT, LEFT, RIGHT, UP, and DOWN.
- **Outlier Detection & Consistency Check**:
  Prior to committing the template, pairwise cosine similarities between all accepted sample vectors and their centroid are computed:
  $$\text{sim}(\mathbf{u}, \mathbf{v}) = \frac{\mathbf{u} \cdot \mathbf{v}}{||\mathbf{u}||_2 ||\mathbf{v}||_2}$$
  - Samples falling below the active engine's consistency threshold are rejected as outliers (legacy SFace currently 0.40; AdaFace currently 0.35 pending field calibration).
  - If more than 40% of captured samples are inconsistent, enrollment fails with `BIOMETRIC_INCONSISTENT_SAMPLES`, requiring recapture.
- **Template Synthesis**: The final resident template is the element-wise mean of valid samples, subsequently L2-normalized:
  $$\mathbf{T} = \frac{\sum_{i=1}^N \mathbf{v}_i}{||\sum_{i=1}^N \mathbf{v}_i||_2}$$

---

## 6. Database Atomicity & Lifecycle

Face enrollment updates the `FaceProfile` record, the `Resident.faceEnrollmentStatus`, and records an immutable entry in `AuditLog` inside a single PostgreSQL transaction (`db.$transaction`).

Status transitions:
```
NOT_ENROLLED ──[Enrollment]──> ENROLLED ──[Revocation]──> REVOKED
                                  │
                          [Re-enrollment /
                           Invalidation]
                                  ↓
                          NEEDS_REENROLLMENT
```
