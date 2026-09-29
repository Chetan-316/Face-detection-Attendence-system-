# PRAVAHAx API Reference - Step 02

This document provides the API specification for the **Authentication** and **Resident Management** modules implemented in Step 02.

---

## Base URL & Versioning

- Base URL: `http://localhost:3000/api/v1`
- Unversioned health check: `http://localhost:3000/health`

---

## Authentication & Headers

Protected endpoints require a JSON Web Token (JWT) provided in the `Authorization` HTTP header:

```http
Authorization: Bearer <JWT_ACCESS_TOKEN>
```

Tokens are valid for 8 hours (`28800` seconds) and signed server-side using `JWT_SECRET`.

### Actor Identity Rule
Client requests **never** supply `performedByUserId`, `performedByRole`, `organizationId`, or `hostelId` in the body to grant permissions or bypass checks. The server strictly derives the actor identity, allowed role, organization, and assigned hostel from the verified JWT payload and validates against the database in real time.

---

## Roles & Permissions

| Role | Resident Management Permission | Scoping Rules |
| :--- | :--- | :--- |
| `ADMIN` | Full resident management within organization | If unassigned to a specific hostel, may manage any hostel in their organization. If assigned to a specific hostel, locked to that hostel. |
| `WARDEN` | Full resident management within assigned hostel | Strictly locked to their assigned hostel. Cannot access, list, or mutate residents of other hostels. |
| `GUARD` | Read-only in Gate workflows (future) | Strictly **forbidden** from resident mutation endpoints (create, update, deactivate, reactivate). Attempts return `403 Forbidden`. |

---

## API Endpoints

### 1. Health Check

#### `GET /health`
Returns system health, database connectivity status, and implementation stage.

**Response `200 OK`:**
```json
{
  "status": "UP",
  "service": "PRAVAHAx Face Recognition Hostel Attendance & Resident Movement System",
  "stage": "STEP_02_RESIDENT_API",
  "appEnv": "development",
  "timezone": "Asia/Kolkata",
  "database": "CONNECTED",
  "timestamp": "2026-09-29T16:20:00.000Z"
}
```

---

### 2. Staff Authentication

#### `POST /api/v1/auth/login`
Authenticates a staff member using their username and password. Protected by IP rate limiting (10 attempts/minute).

**Request Body:**
```json
{
  "username": "warden_user",
  "password": "Password@123"
}
```

**Response `200 OK`:**
```json
{
  "user": {
    "id": "11111111-2222-3333-4444-555555555555",
    "username": "warden_user",
    "fullName": "Main Hostel Warden",
    "email": "warden@hostel.edu",
    "role": "WARDEN",
    "organizationId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "hostelId": "ffffffff-gggg-hhhh-iiii-jjjjjjjjjjjj",
    "status": "ACTIVE"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 28800
}
```

**Common Error Responses:**
- `401 Unauthorized`: Invalid credentials (generic message: `"Invalid username or password"`) or inactive/suspended account.
- `400 Bad Request`: Validation error (empty username or password).
- `429 Too Many Requests`: Rate limit exceeded.

---

### 3. Resident Management

#### `GET /api/v1/residents`
Paginated, searchable, and filterable list of residents. Scope is enforced server-side.

**Query Parameters:**
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `page` | Integer | `1` | Page number (min 1) |
| `pageSize` | Integer | `20` | Items per page (min 1, max 100) |
| `search` | String | - | Case-insensitive search on `residentCode` or `fullName` |
| `status` | Enum | - | Filter by `ACTIVE`, `INACTIVE`, `SUSPENDED`, `ARCHIVED` |
| `presence` | Enum | - | Filter by `IN`, `OUT` |
| `faceEnrollmentStatus` | Enum | - | Filter by `NOT_ENROLLED`, `ENROLLED`, `NEEDS_REENROLLMENT`, `REVOKED` |
| `roomGroup` | String | - | Case-insensitive filter on room or group |
| `hostelId` | UUID | - | For organization-level Admin only |

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "resident-uuid-001",
      "organizationId": "org-uuid",
      "hostelId": "hostel-uuid",
      "residentCode": "R101",
      "fullName": "Aarav Sharma",
      "roomGroup": "Room 201",
      "contactPhone": "9876543210",
      "contactEmail": "aarav@example.com",
      "status": "ACTIVE",
      "faceEnrollmentStatus": "NOT_ENROLLED",
      "presence": {
        "currentState": "IN",
        "lastMovementType": "IN",
        "lastMovementTime": "2026-09-29T10:30:00.000Z",
        "updatedAt": "2026-09-29T10:30:00.000Z"
      },
      "hostel": {
        "id": "hostel-uuid",
        "code": "H1",
        "name": "Cauvery Boys Hostel"
      },
      "createdAt": "2026-09-29T08:00:00.000Z",
      "updatedAt": "2026-09-29T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

---

#### `POST /api/v1/residents`
Registers a new resident. Restricted to `ADMIN` and `WARDEN`. `GUARD` is rejected with `403`.

**Request Body:**
```json
{
  "residentCode": "R102",
  "fullName": "Rohan Verma",
  "roomGroup": "Room 202",
  "contactPhone": "9876543211",
  "contactEmail": "rohan@example.com",
  "initialPresence": "OUT",
  "hostelId": "hostel-uuid"
}
```
*Note: For Wardens, `hostelId` is always derived from their staff record, preventing cross-hostel creation.*

**Response `201 Created`:**
```json
{
  "id": "resident-uuid-002",
  "organizationId": "org-uuid",
  "hostelId": "hostel-uuid",
  "residentCode": "R102",
  "fullName": "Rohan Verma",
  "roomGroup": "Room 202",
  "contactPhone": "9876543211",
  "contactEmail": "rohan@example.com",
  "status": "ACTIVE",
  "faceEnrollmentStatus": "NOT_ENROLLED",
  "presence": {
    "currentState": "OUT",
    "lastMovementType": null,
    "lastMovementTime": null,
    "updatedAt": "2026-09-29T11:00:00.000Z"
  },
  "hostel": {
    "id": "hostel-uuid",
    "code": "H1",
    "name": "Cauvery Boys Hostel"
  },
  "createdAt": "2026-09-29T11:00:00.000Z",
  "updatedAt": "2026-09-29T11:00:00.000Z"
}
```

---

#### `GET /api/v1/residents/:id`
Retrieves resident details. If the resident belongs to another hostel or organization outside the staff's scope, returns `404 Not Found` to prevent resource probing.

**Response `200 OK`:** Safe resident object including presence and hostel info.

---

#### `GET /api/v1/residents/by-code/:residentCode`
Retrieves resident by unique resident code within actor's permitted hostel/organization scope.

---

#### `PATCH /api/v1/residents/:id`
Updates allowed resident fields. Restricted to `ADMIN` and `WARDEN`.

**Allowed editable fields (whitelist-only):**
- `fullName`
- `roomGroup`
- `contactPhone`
- `contactEmail`
- `residentCode` (validated for organization-wide uniqueness)

Attempts to pass `hostelId`, `organizationId`, `presence`, `status`, or `faceEnrollmentStatus` are strictly rejected.

**Request Body:**
```json
{
  "fullName": "Rohan S. Verma",
  "roomGroup": "Room 205",
  "contactPhone": "9876500000"
}
```

**Response `200 OK`:** Updated safe resident object.

---

#### `POST /api/v1/residents/:id/deactivate`
Deactivates a resident. Historical movements, presence logs, and attendance records are fully preserved. Restricted to `ADMIN` and `WARDEN`.

**Request Body:**
```json
{
  "reason": "Graduated and completed hostel tenure"
}
```
*Note: `reason` is mandatory.*

**Response `200 OK`:** Safe resident object with `status: "INACTIVE"`.

---

#### `POST /api/v1/residents/:id/reactivate`
Reactivates an inactive resident. Restricted to `ADMIN` and `WARDEN`.

**Request Body:**
```json
{
  "reason": "Re-enrolled for higher semester"
}
```
*Note: `reason` is mandatory.*

**Response `200 OK`:** Safe resident object with `status: "ACTIVE"`.

---

### 4. Camera Abstraction & Live Preview (Step 04)

The camera subsystem provides hardware abstraction for laptop webcams, RTSP IP cameras, and smart edge devices without coupling business logic to hardware device indices.

#### `GET /api/v1/cameras`
Lists cameras accessible within the user's role and hostel scope.

**Headers:**
`Authorization: Bearer <TOKEN>`

**Query Parameters:**
- `hostelId` (optional, Admin only): Filter cameras by specific hostel.
- `role` (optional): Filter cameras by operational role (`GENERAL`, `IN`, `OUT`, `ATTENDANCE`).

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "c76a9fb0-9943-4dc6-8c0c-88229b47e221",
      "name": "Laptop Webcam",
      "sourceType": "WEBCAM",
      "role": "GENERAL",
      "isEnabled": true,
      "healthStatus": "ONLINE",
      "isStreaming": true,
      "fps": 15,
      "lastSeenAt": "2026-09-29T17:30:00.000Z"
    }
  ],
  "count": 1
}
```

---

#### `POST /api/v1/cameras`
Registers a new camera. Allowed for `ADMIN` and `WARDEN` (wardens restricted to assigned hostel).

**Request Body:**
```json
{
  "name": "Gate 1 Ingress Camera",
  "sourceType": "WEBCAM",
  "role": "IN",
  "locationId": "a1b2c3d4-...",
  "configMetadata": {
    "deviceIndex": 0,
    "fps": 15
  }
}
```

---

#### `GET /api/v1/cameras/:id`
Retrieves camera details and live telemetry diagnostics.

---

#### `POST /api/v1/cameras/:id/start`
Opens the camera hardware device and starts frame acquisition.

**Response `200 OK`:**
```json
{
  "message": "Camera stream started successfully",
  "data": {
    "cameraId": "c76a9fb0-...",
    "isActive": true,
    "healthStatus": "ONLINE",
    "fps": 15,
    "totalFramesCaptured": 45
  }
}
```

---

#### `POST /api/v1/cameras/:id/stop`
Stops frame acquisition and releases camera hardware cleanly.

---

#### `GET /api/v1/cameras/:id/health`
Returns detailed health diagnostics, current FPS, error state, and adapter capabilities.

---

#### `GET /api/v1/cameras/:id/snapshot`
Captures a single still frame.
- If `format=json` query or `Accept: application/json` is sent, returns JSON with Base64 JPEG data.
- By default or with `Accept: image/jpeg`, returns binary `image/jpeg` payload directly.

---

#### `GET /api/v1/cameras/:id/preview`
Streams a real-time live MJPEG feed (`multipart/x-mixed-replace; boundary=--pravahax-frame`).
Supports both `Authorization: Bearer <TOKEN>` header and `?token=<JWT>` query parameter for standard HTML `<img>` tag embedding.

---

## Standard Error Response Format

All error responses adhere to a consistent schema:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Resident full name is required",
    "details": {
      "fullName": "Resident full name is required"
    }
  }
}
```

### Common Error Codes
- `400 Bad Request` -> `VALIDATION_ERROR`
- `401 Unauthorized` -> `UNAUTHORIZED`
- `403 Forbidden` -> `PERMISSION_DENIED` / `FORBIDDEN`
- `404 Not Found` -> `NOT_FOUND`
- `409 Conflict` -> `CONFLICT`
- `422 Unprocessable Entity` -> `INVALID_STATE_TRANSITION` / `ATTENDANCE_RULE_VIOLATION`
- `429 Too Many Requests` -> `TOO_MANY_REQUESTS`
- `500 Internal Server Error` -> `INTERNAL_SERVER_ERROR`
