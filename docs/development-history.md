# PRAVAHAx Development History & Milestones Archive

This document preserves the chronological development milestones of the PRAVAHAx system from inception through pilot readiness.

## Milestone Chronology

- **Step 01 & 01.1: Core Architecture, PostgreSQL Foundation & Domain Business Engine**
  - Modular monolith architecture in TypeScript and Node.js.
  - PostgreSQL schema with strict foreign keys, composite unique constraints, and B-tree indexes.
  - Atomic IN/OUT movement engine with row-level locking (`SELECT ... FOR UPDATE`).
  - Night roll call atomic Warden resolution.
  - Append-only `AuditLog` service.

- **Step 02: Resident Domain & Staff Permissions**
  - Resident lifecycle: registration, room grouping, active/inactive/suspended states.
  - Safe deactivation preserving movement and attendance history.
  - Role-based access control (`ADMIN`, `WARDEN`, `GUARD`).

- **Step 03: Web Administration & Staff Interface**
  - React + TypeScript client portal.
  - Role-scoped views, resident rosters, and audit oversight.

- **Step 04: Camera Infrastructure & Live Preview**
  - `ICameraAdapter` decoupling devices (`WEBCAM`, `RTSP`).
  - Laptop hardware capture via DirectShow / OpenCV (`webcam_worker.py`).
  - High-performance HTTP multipart MJPEG preview streams.

- **Step 05 & 05.1: Biometric Face Enrollment**
  - Pretrained metric embedding pipeline (YuNet 2023mar detector + SFace 2021dec 128-d embedder).
  - Multi-sample quality-filtered template aggregation.
  - Immediate disposal of raw photos from memory.

- **Step 06 & 06.1: Continuous Local Face Recognition Engine**
  - Real-time face detection, alignment, embedding, and template matching.
  - Three-state classification: `MATCH`, `UNCERTAIN`, `UNKNOWN`.
  - IoU spatial tracking over a 5-frame sliding window with 8-second deduplication cooldown.
  - In-memory template cache scoped to hostel.

- **Step 07 & 07.1: Automated Gate Movement Decision Engine**
  - Converts stable `MATCH` observations from gate cameras into real-world `IN` / `OUT` movement decisions.
  - Duplicate suppression (`ALREADY_IN`, `ALREADY_OUT`) with zero redundant DB writes.
  - Observation idempotency and rapid transition guard.

- **Step 08: Hostel Night Attendance Workflow**
  - Timed attendance sessions linked to attendance cameras.
  - Single active session per hostel constraint.
  - Automated marking via face recognition; atomic session closure marking unmarked residents as `ABSENT`.
  - Audited manual corrections with mandatory written justification.

- **Step 09: Operational Attendance & Movement Reporting**
  - Session roll call summaries and rate trends.
  - Paginated gate movement history and real-time presence counts.
  - RFC 4180 CSV export with spreadsheet formula injection protection.

- **Step 10 & 10.1: Production RTSP / IP Camera Frame Pipeline**
  - Ingestion and decoding of H.264/H.265 IP network camera feeds via FFmpeg subprocesses.
  - Shared camera connection between live preview, face recognition, and snapshots.
  - Resilient state recovery with bounded exponential backoff auto-reconnect.
  - Credential redaction in URLs and logs.

- **Step 11 & 11.1: Production Hardening, System Acceptance & Contract Consistency**
  - Deterministic startup sequence via `LifecycleManager`.
  - Fast cheap liveness probe (`/health`) and database-backed readiness probe (`/ready`).
  - Non-leaking probe responses concealing internal database errors.
  - Production guards: mandatory `CORS_ORIGIN`, secure `JWT_SECRET`, disabled `BIOMETRIC_MOCK`, and synthetic camera protections.
  - Scale benchmark testing (500 residents, 10k movements).
