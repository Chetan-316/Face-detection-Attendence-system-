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
  Detector (YuNet) + Embedder (SFace)
             ↓ (128-d L2 Normalized Vector)
   PostgreSQL FaceProfile + Resident
  ```

---

## 2. Model Stack & Specifications

| Component | Model Name | Version | Source | License | Input Shape | Output / Dimension | Runtime |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Face Detector** | YuNet | `2023mar` | OpenCV Zoo / libfacedetection | **Apache-2.0** | Dynamic `[1, 3, H, W]` | Bounding box, confidence score, 5 facial landmarks | OpenCV DNN using ONNX model files |
| **Face Embedder** | SFace | `2021dec` | OpenCV Zoo (SphereFace2) | **Apache-2.0** | `[1, 3, 112, 112]` | 128-d L2-normalized float vector | OpenCV DNN using ONNX model files |

### Landmark Alignment & Preprocessing
1. Five facial landmarks are extracted: right eye, left eye, nose tip, right mouth corner, left mouth corner.
2. The face region is aligned to a canonical 112x112 frontal crop via similarity transformation (`FaceRecognizerSF.alignCrop`).
3. Embeddings are extracted and explicitly L2-normalized ($||\mathbf{v}||_2 = 1$).

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
| **Minimum Face Size** | `FACE_TOO_SMALL` | Face bounding box must be at least 80x80 px and occupy at least 12% of frame dimensions. |
| **Central Positioning** | `FACE_OFF_CENTER` | Face centroid must be located within the central 75% capture region. |
| **Focus & Sharpness** | `TOO_BLURRY` | Laplacian variance of the face crop must be $\ge 50.0$. |
| **Illumination** | `TOO_DARK` / `TOO_BRIGHT` | Mean luminance must be between 40 and 220 (out of 255). |
| **Detection Confidence** | `LOW_DETECTION_CONFIDENCE` | YuNet detection confidence score must be $\ge 0.65$. |

---

## 5. Multi-Sample Accumulation & Consistency Verification

- **Sample Pacing**: The automated capture loop spaces accepted frames by at least 400ms to capture natural micro-variations rather than duplicate frames.
- **Required Samples**: Between 5 and 10 accepted frames (default: 7) are required to complete enrollment.
- **Outlier Detection & Consistency Check**:
  Prior to committing the template, pairwise cosine similarities between all accepted sample vectors and their centroid are computed:
  $$\text{sim}(\mathbf{u}, \mathbf{v}) = \frac{\mathbf{u} \cdot \mathbf{v}}{||\mathbf{u}||_2 ||\mathbf{v}||_2}$$
  - Samples falling below the consistency threshold ($0.65$) are rejected as outliers.
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
