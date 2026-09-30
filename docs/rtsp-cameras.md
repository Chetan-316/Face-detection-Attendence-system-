# Production RTSP / IP Camera Integration Guide

This document specifies the architecture, deployment practices, and operational behavior of the RTSP camera pipeline in PRAVAHAx.

---

## 1. Architectural Overview

PRAVAHAx treats all camera hardware uniformly via the `ICameraAdapter` contract. Whether the video originates from a laptop USB camera or an industrial PoE network camera, the downstream facial recognition, movement tracking, and attendance engines consume the identical `CameraFrame` abstraction.

```
+------------------+
| IP / PoE Camera  | (Standard RTSP stream over LAN)
+--------+---------+
         |
         v
+------------------+
|  FFmpeg Process  | (Hardware-agnostic H.264/H.265 decode, low-latency pipe)
+--------+---------+
         | (image2pipe MJPEG stdout chunks)
         v
+------------------+
| RtspFrameSource  | (Chunk-boundary marker parser 0xFFD8..0xFFD9, buffer safety)
+--------+---------+
         |
         v
+------------------+
|   RtspAdapter    | (BaseCameraAdapter implementation, FPS & telemetry tracking)
+--------+---------+
         |
         v
+------------------+
|  CameraService   | (Shared active adapter singleton per camera)
+----+--------+----+
     |        |
     |        +----------------------------------------+
     v                                                 v
+------------------------+                 +------------------------+
|   Live MJPEG Preview   |                 |   RecognitionService   |
| (GET /cameras/:id/preview)               | (WorkerYuNet + SFace)  |
+------------------------+                 +-----------+------------+
                                                       |
                                                       v
                                           +------------------------+
                                           | Movement / Attendance  |
                                           |  Decision Services     |
                                           +------------------------+
```

### Key Architectural Tenets
1. **Recognition Decoupling**: `RecognitionService` is completely unaware of RTSP, FFmpeg, or network sockets.
2. **Single Camera Stream**: One underlying connection is shared across live preview, AI face recognition, and manual snapshots. No duplicated FFmpeg processes are spawned.
3. **No CCTV Recording / NVR**: Continuous video recording is deliberately out of scope. The pipeline processes live frames in volatile memory for biometric identification only.
4. **LAN-First & Cloud-Independent**: All streams stay strictly on the local area network. No video frames are routed outside the premises.

---

## 2. Prerequisites & FFmpeg Requirement

The RTSP ingestion engine relies on **FFmpeg** and **FFprobe** subprocess execution.

- **Supported Video Codecs**: H.264 (AVC), H.265 (HEVC), MJPEG.
- **Audio**: Disabled via `-an` (audio is neither captured nor stored).
- **Subprocess Discovery**: PRAVAHAx dynamically detects `ffmpeg` and `ffprobe` binaries in:
  1. `process.env.FFMPEG_PATH` and `process.env.FFPROBE_PATH`
  2. Operating system `PATH`
  3. Windows WinGet package locations (`%LOCALAPPDATA%\Microsoft\WinGet\Packages\...`)
  4. Standard directory fallbacks (`C:\ffmpeg\bin`, `/usr/bin/ffmpeg`)

If FFmpeg is absent, the system exposes clear diagnostics indicating that FFmpeg must be installed.

---

## 3. Recommended Deployment Topology & Hardware

### Hardware Recommendations
- **Camera Type**: Standard PoE IP Security Camera (ONVIF Profile S compatible, RTSP standard).
- **Resolution**: 2 MP (1080p) or 4 MP is sufficient. For face recognition inference, streams are downscaled to 1280x720 or 960x540.
- **Framerate**: 15–25 FPS capable camera.
- **Dynamic Range**: Wide Dynamic Range (WDR >= 120 dB) is strongly recommended for gate/ingress doorways to prevent backlighting silhouetting.
- **Lens**: 2.8 mm (wide angle for entry turnstiles) or 3.6 mm / 6 mm (narrower corridors).
- **Enclosure**: IP66 or IP67 weather-rated for external hostel gates.

### Recommended Local Network Topology

```
[PoE Camera 1 (IN)]   [PoE Camera 2 (OUT)]   [PoE Camera 3 (ATTENDANCE)]
        |                     |                         |
        +---------------------+-------------------------+
                              | (CAT6 Ethernet Cables)
                              v
                +----------------------------+
                |     Managed PoE Switch     |
                |   (Isolated Camera VLAN)   |
                +--------------+-------------+
                               |
                               v
                +----------------------------+
                | Recognition Server / Edge  |
                |   Hostel On-Premises PC    |
                +----------------------------+
```

### Network Stability & IP Addressing
1. **Static IP / DHCP Reservation**: Always assign static IP addresses or DHCP reservations on the local router/switch to prevent cameras from changing addresses after power outages.
2. **Camera VLAN**: In enterprise hostel deployments, isolate camera traffic into a dedicated CCTV/Camera VLAN to prevent student network saturation.

---

## 4. Main Stream vs. Substream Strategy

Most IP security cameras expose two RTSP stream profiles:
- **Main Stream**: High resolution (4MP/8MP), high bitrate. Intended for physical security NVR recording.
- **Sub Stream**: Standard resolution (640x360 or 720p), moderate bitrate. Ideal for low-latency computer vision and real-time preview.

**Recommendation**: Configure PRAVAHAx with the camera's **RTSP substream**. This minimizes CPU decoding overhead and ensures sub-second latency for gate passage.

### URL Examples (Synthetic / Illustrative)
- **Standard Generic**: `rtsp://camera-ip:554/stream1`
- **CP Plus / Dahua Substream**: `rtsp://admin:password@192.168.1.108:554/cam/realmonitor?channel=1&subtype=1`
- **Hikvision Substream**: `rtsp://admin:password@192.168.1.64:554/Streaming/Channels/102`

*(Note: Actual channel paths vary by camera manufacturer firmware).*

---

## 5. Transport Protocols: TCP vs. UDP

The transport protocol is configurable per camera (`transport: 'tcp' | 'udp'`):

- **TCP (`-rtsp_transport tcp`) — Default & Recommended**:
  Guarantees packet ordering and eliminates packet loss artifacts. Essential for face recognition accuracy and gate stability.
- **UDP (`-rtsp_transport udp`)**:
  Lower overhead, but susceptible to packet drops and frame tearing under congested network conditions.

---

## 6. Credential Privacy & Redaction Security

Hostel security credentials must remain strictly protected:

1. **Storage**: Stored securely in backend `configMetadata`.
2. **API Scrubbing**: The centralized `toSafeCameraDto` serializer automatically masks RTSP URLs (`rtsp://***:***@...`), deletes the `password` property, and emits `credentialsConfigured: true`.
3. **No Credential Return**: Neither staff nor warden web interfaces ever receive plaintext passwords or credentialed URLs back from the server.
4. **Log & Stderr Redaction**: Every FFmpeg stderr chunk and diagnostic message passes through `redactRtspUrl()` before logging. Passwords never appear in application logs or `AuditLog` records.
5. **Editing Workflows**: When editing a camera, leaving the password field blank retains the existing saved password safely.

---

## 7. Reconnection & Error Recovery

Network drops and switch reboots happen in production environments. PRAVAHAx includes state machine resilience:

```
[ Active Stream (ONLINE) ]
            |
            | (Network drop or FFmpeg exit)
            v
[ Degraded State (DEGRADED) ]
            |
            | (Bounded exponential backoff: 1s -> 2s -> 4s -> 8s -> max 15s)
            v
[ Reconnect Attempt (FFmpeg spawn) ]
            |
    +-------+-------+
    |               |
(First frame arrives) (Failure)
    v               v
[ ONLINE ]      [ DEGRADED (Next backoff) ]
```

### Manual Stop Distinction
If an operator clicks **Stop Preview** or disables the camera, `manualStop` is set to `true`. Reconnect timers are cleared, and the camera remains offline without re-spawning processes.

---

## 8. Troubleshooting

| Symptom | Probable Cause | Action |
| :--- | :--- | :--- |
| **"Camera authentication failed"** | Incorrect RTSP username or password | Update credentials via Camera Edit modal. |
| **"Connection timed out"** | Camera IP unreachable or RTSP port (554) blocked | Verify camera PoE link, ping camera IP from host, check switch port. |
| **"Stream format error"** | Malformed RTSP stream or unsupported transport | Switch transport between TCP and UDP in camera configuration. |
| **High CPU usage** | Main stream configured instead of substream | Point RTSP URL to camera substream (e.g. channel 102 or subtype 1). |
