# PRAVAHAx Frontend

## Purpose
The PRAVAHAx Frontend is the dedicated staff web interface for residential hostel operations, supporting:
- Staff authentication & session security
- Resident profile lifecycle management
- Real-time resident status tracking
- Current IN / OUT perimeter visibility
- Biometric face enrollment status visibility

---

## Technology Stack
- **Framework**: React 19
- **Language**: TypeScript (Strict typing)
- **Bundler & Tooling**: Vite
- **Routing**: React Router v7
- **Testing**: Vitest + React Testing Library + happy-dom
- **Icons**: Lucide React

---

## Setup & Installation

Navigate to the `client` directory and install dependencies:

```bash
cd client
npm install
```

---

## Environment Configuration

Configure client environment variables by creating a `.env` file in the `client/` root or supplying them through your development environment:

```ini
# Base URL for the PRAVAHAx backend REST API
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

> [!CAUTION]
> **Security Notice**: Never expose backend secrets (such as `JWT_SECRET`, `DATABASE_URL`, or database credentials) to the frontend application or prefix them with `VITE_`. All environment variables prefixed with `VITE_` are bundled into the public client build.

---

## Available Scripts

### Development
Start the local development server with Hot Module Replacement (HMR):
```bash
npm run dev
```

### Build
Type-check and compile production assets into `client/dist/`:
```bash
npm run build
```

### Testing
Run unit and integration test suites:
```bash
npm test
```

---

## Current Platform Capabilities
- **Staff Authentication**: Secure username/password login, JWT storage in secure cookies/memory, and automatic session verification.
- **Protected Routing**: Role-aware layout and route-level redirection protecting unauthorized views.
- **Hostel Overview**: Live metrics for total, active, IN/OUT occupancy, and face enrollment counts with security scope cards.
- **Resident Directory**: Paginated resident list with search (by name, code, room) and faceted filtering (status, presence, enrollment).
- **Resident Profile Lifecycle**: Modal workflows for adding residents, editing contact details and rooms, and deactivating/reactivating residents with mandatory reasons and full audit preservation.
- **Role-Aware UI Controls**: Granular permission gating between ADMIN, WARDEN, and GUARD roles (e.g. guards restricted to read-only views).

---

## Deferred Capabilities
The following capabilities are intentionally deferred to upcoming implementation phases:
- Camera device integration & hardware abstraction
- Face enrollment workflows & biometric template registration
- Real-time face recognition and feature vector matching
- Automated gate movement verification
- Night attendance session management & roll call UI
