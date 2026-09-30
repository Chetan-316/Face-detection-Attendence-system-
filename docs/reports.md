# Operational Reporting Layer

PRAVAHAx provides an administrative operational reporting module tailored for hostel wardens and administrators. It turns verified historical attendance sessions, resident movements, and current presence states into clear, actionable reports and safe CSV exports.

---

## 1. Report Categories

The reporting interface is organized into three core administrative areas:

1. **Attendance Reports**:
   - Session-level attendance summaries and roster views.
   - Aggregate metrics: Total Sessions, Average Attendance Rate, Total Present, Total Absent.
   - Attendance trend visualization over time (grouped by logical attendance date).
   - Detailed session rosters with real status badges, marked timestamps, methods, and correction audit details.

2. **Movement History**:
   - Filterable, paginated audit trail of gate entries (`IN`) and exits (`OUT`).
   - Authoritative hostel presence overview (`Currently Inside` vs `Currently Outside`).
   - "Currently Outside" operational roster showing residents currently outside the hostel perimeter with last departure timestamp and gate.

3. **Resident Summary**:
   - Consolidated resident operational profile.
   - Overall attendance rate (`Present / Total Sessions × 100`) and attendance history.
   - Gate movement timeline for individual residents.
   - Current presence state and last movement metadata.

---

## 2. API Endpoints and Query Parameters

| Endpoint | Method | Allowed Roles | Description | Query Parameters |
|---|---|---|---|---|
| `/api/v1/reports/attendance` | GET | ADMIN, WARDEN, GUARD* | Lists attendance sessions with aggregated counts | `hostelId`, `sessionId`, `status`, `sessionType`, `date`, `dateFrom`, `dateTo`, `page`, `pageSize` |
| `/api/v1/reports/attendance/sessions/:sessionId` | GET | ADMIN, WARDEN, GUARD* | Full session roster with filters | `status` (`ALL`, `PRESENT`, `ABSENT`), `search` |
| `/api/v1/reports/attendance/trend` | GET | ADMIN, WARDEN | Historical daily attendance rates | `hostelId`, `dateFrom`, `dateTo`, `days` |
| `/api/v1/reports/residents/:residentId/attendance` | GET | ADMIN, WARDEN | Individual resident attendance breakdown | None |
| `/api/v1/reports/movements` | GET | ADMIN, WARDEN, GUARD | Paginated movement history | `hostelId`, `residentId`, `direction`, `cameraId`, `source`, `search`, `dateFrom`, `dateTo`, `page`, `pageSize` |
| `/api/v1/reports/residents/:residentId/movements` | GET | ADMIN, WARDEN | Individual resident movement timeline | `limit` |
| `/api/v1/reports/presence` | GET | ADMIN, WARDEN, GUARD | Current hostel presence summary | `hostelId` |
| `/api/v1/reports/presence/outside` | GET | ADMIN, WARDEN, GUARD | Roster of residents currently OUT | `hostelId` |
| `/api/v1/reports/residents/:residentId/summary` | GET | ADMIN, WARDEN | Full resident operational summary | None |
| `/api/v1/reports/export/attendance` | GET | ADMIN, WARDEN | Download Attendance CSV | `hostelId`, `sessionId`, `dateFrom`, `dateTo` |
| `/api/v1/reports/export/movements` | GET | ADMIN, WARDEN | Download Movement CSV | `hostelId`, `residentId`, `direction`, `dateFrom`, `dateTo` |

*\*Note: Guards are restricted to their assigned hostel and read-only operational oversight.*

---

## 3. Aggregation Rules & Formulas

### Attendance Rate Formula
$$\text{Attendance Rate} = \frac{\text{Present Residents}}{\text{Total Expected Residents}} \times 100$$

- **Numerator (`Present`)**: Residents marked with `PRESENT` or `CORRECTED_PRESENT`.
- **Denominator (`Expected`)**:
  - **For CLOSED Sessions**: Total attendance records for the session. Upon session close, all eligible active residents who were not marked present are automatically marked `ABSENT`. Thus, the record count is the exact finalized expected roster.
  - **For ACTIVE Sessions**: Total currently active residents in the hostel at query time (or existing records count, whichever is larger).

### Active vs. Closed Sessions
- **CLOSED Sessions**: Finalized metrics with definitive `Present`, `Absent`, and `Attendance Rate`.
- **ACTIVE Sessions**: In-progress tracking with `Present so far` and `Remaining Count` ($\text{Remaining} = \max(0, \text{Expected} - \text{Present})$). Active sessions **never** finalize absence metrics prematurely before warden closure.

### Midnight-Crossing Attendance Sessions
Sessions starting before midnight and closing after midnight logically belong to their configured `attendanceDate`. All reporting group queries filter and group sessions by `AttendanceSession.attendanceDate`, preventing midnight split errors.

### Historical Preservation of Inactive Residents
Historical attendance and movement records for residents who are later deactivated remain fully visible in historical reports and exports. Deactivating a resident updates current eligibility for new sessions but does not delete historical attendance records.

---

## 4. Current Presence Semantics

Presence counts (`Currently Inside` and `Currently Outside`) are derived **strictly** from `ResidentPresence` as the single authoritative source of truth:
- `insideCount`: `ResidentPresence.currentState = IN`
- `outsideCount`: `ResidentPresence.currentState = OUT`

The system does not guess current presence by inspecting arbitrary `MovementEvent` rows.

---

## 5. Role Authorization & Least Privilege

1. **ADMIN**:
   - Organization-wide reporting authority.
   - Can inspect reports across all hostels in their organization or filter by a specific hostel.
   - Strict cross-organization isolation (attempts to query another organization's hostel return 404).

2. **WARDEN**:
   - Strictly scoped to their assigned hostel (`actor.hostelId`).
   - Cross-hostel queries return non-leaking `404 Not Found`.
   - Full access to attendance sessions, trend charts, resident summaries, and CSV exports for their hostel.

3. **GUARD**:
   - Authorized for real-time gate oversight:
     - Can view current hostel presence summary (`/reports/presence`).
     - Can view currently outside roster (`/reports/presence/outside`).
     - Can view current gate movements (`/reports/movements`).
     - Can view today's active attendance session.
   - Explicitly **forbidden (403)** from:
     - Historical attendance trend analytics (`/reports/attendance/trend`).
     - Individual resident historical profiles (`/reports/residents/:residentId/*`).
     - CSV data exports (`/reports/export/*`).

---

## 6. CSV Export & Spreadsheet Safety

### Safe Formatting
All CSV exports generated server-side follow RFC 4180 rules with UTF-8 BOM (`\uFEFF`) to ensure Excel, LibreOffice, and Google Sheets display special characters correctly.

### Formula Injection Protection
To protect against formula injection / CSV injection attacks:
- Any cell value starting with `=`, `+`, `-`, or `@` is prepended with a single quote (`'`).
- Spreadsheet software treats the cell strictly as plain text, neutralizing command execution or external URL hijacking.

### Privacy Guarantees
CSV exports and report API payloads **strictly exclude**:
- Face embeddings / biometric vectors
- Recognition similarity scores or candidate rankings
- Raw image frames, face crops, or canvas data
- Sensitive audit internals, hashes, or passwords

---

## 7. Performance & Query Strategy

- **No N+1 Queries**: Session listing uses batch aggregation via Prisma `groupBy` to calculate counts across all sessions in a single database roundtrip.
- **Indexed Lookups**:
  - `AttendanceSession(hostelId, sessionType, status)` and `AttendanceSession(attendanceDate DESC)`
  - `AttendanceRecord(attendanceSessionId, residentId)` and `AttendanceRecord(status)`
  - `MovementEvent(hostelId, effectiveTimestamp DESC)` and `MovementEvent(residentId, effectiveTimestamp DESC)`
  - `ResidentPresence(hostelId, currentState)`
- **Database Migrations**: Existing database schema indexes adequately cover all reporting queries. No additional migrations required.
