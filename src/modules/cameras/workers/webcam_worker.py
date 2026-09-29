"""
PRAVAHAx Webcam Capture Worker
Standalone helper process for webcam frame acquisition using OpenCV.
Communication with Node.js host:
- Command line arguments for device configuration
- Framed binary packets over stdout.buffer for video frames
- JSON status & error logs over stderr
- Clean signal handling (SIGINT, SIGTERM) & stdin commands
"""

import sys
import os
import time
import struct
import argparse
import json
import threading

def parse_args():
    parser = argparse.ArgumentParser(description="PRAVAHAx Webcam Frame Capture Worker")
    parser.add_argument("--device", type=int, default=0, help="Webcam device index (default: 0)")
    parser.add_argument("--width", type=int, default=640, help="Requested frame width (default: 640)")
    parser.add_argument("--height", type=int, default=480, help="Requested frame height (default: 480)")
    parser.add_argument("--fps", type=int, default=15, help="Target frames per second (default: 15)")
    parser.add_argument("--quality", type=int, default=80, help="JPEG quality 1-100 (default: 80)")
    return parser.parse_args()

def log_event(event_type, **kwargs):
    payload = {"type": event_type, "timestamp": time.time(), **kwargs}
    sys.stderr.write(json.dumps(payload) + "\n")
    sys.stderr.flush()

def main():
    args = parse_args()
    log_event("starting", device=args.device, fps=args.fps, width=args.width, height=args.height)

    try:
        import cv2
    except ImportError as e:
        log_event("error", error="OPENCV_NOT_FOUND", message=str(e))
        sys.exit(1)

    # On Windows, try CAP_DSHOW first for rapid non-blocking startup
    cap = None
    if os.name == 'nt' and hasattr(cv2, 'CAP_DSHOW'):
        try:
            cap = cv2.VideoCapture(args.device, cv2.CAP_DSHOW)
        except Exception:
            cap = None

    if cap is None or not cap.isOpened():
        # Fallback to standard capture
        try:
            cap = cv2.VideoCapture(args.device)
        except Exception as e:
            log_event("error", error="DEVICE_OPEN_EXCEPTION", message=str(e))
            sys.exit(2)

    if not cap.isOpened():
        log_event("error", error="DEVICE_UNAVAILABLE", message=f"Cannot open webcam device index {args.device}")
        sys.exit(2)

    # Set requested capture properties
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
    cap.set(cv2.CAP_PROP_FPS, args.fps)

    # Test read first frame to verify hardware response
    ret, test_frame = cap.read()
    if not ret or test_frame is None:
        cap.release()
        log_event("error", error="FRAME_READ_FAILED", message="Failed to read initial frame from webcam")
        sys.exit(3)

    actual_h, actual_w = test_frame.shape[:2]
    log_event("ready", device=args.device, width=actual_w, height=actual_h, fps=args.fps)

    stop_requested = threading.Event()

    def listen_stdin():
        while not stop_requested.is_set():
            try:
                line = sys.stdin.readline()
                if not line:
                    # stdin closed by parent process
                    stop_requested.set()
                    break
                cmd_data = json.loads(line.strip())
                if cmd_data.get("command") == "stop":
                    stop_requested.set()
                    break
            except Exception:
                break

    stdin_thread = threading.Thread(target=listen_stdin, daemon=True)
    stdin_thread.start()

    frame_interval = 1.0 / max(1, args.fps)
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), max(10, min(100, args.quality))]
    magic = b'PXF1'

    consecutive_errors = 0
    max_consecutive_errors = 10

    try:
        while not stop_requested.is_set():
            start_time = time.time()

            ret, frame = cap.read()
            if not ret or frame is None:
                consecutive_errors += 1
                if consecutive_errors >= max_consecutive_errors:
                    log_event("error", error="CAMERA_DISCONNECTED", message="Camera stopped delivering frames")
                    break
                time.sleep(0.05)
                continue

            consecutive_errors = 0
            h, w = frame.shape[:2]

            encode_ret, jpeg_buffer = cv2.imencode('.jpg', frame, encode_params)
            if not encode_ret:
                continue

            jpeg_bytes = jpeg_buffer.tobytes()
            payload_len = len(jpeg_bytes)
            timestamp_ms = int(time.time() * 1000)

            # Header structure (20 bytes):
            # 4s (magic: 'PXF1')
            # I  (payload len, uint32 BE)
            # Q  (timestamp ms, uint64 BE)
            # H  (width, uint16 BE)
            # H  (height, uint16 BE)
            header = struct.pack('>4sIQHH', magic, payload_len, timestamp_ms, w, h)

            try:
                sys.stdout.buffer.write(header)
                sys.stdout.buffer.write(jpeg_bytes)
                sys.stdout.buffer.flush()
            except (BrokenPipeError, IOError):
                # Host process disconnected or closed pipe
                break

            elapsed = time.time() - start_time
            sleep_time = frame_interval - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        log_event("stopped")

if __name__ == "__main__":
    main()
