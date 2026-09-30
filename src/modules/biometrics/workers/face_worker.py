"""
PRAVAHAx Face Biometric Worker Process
Continuous warm background worker for face detection, quality analysis, landmark alignment,
and embedding generation.
Communicates with Node.js host via JSON-lines over stdin/stdout.
"""

import sys
import os
import json
import base64
import time
import argparse
import traceback
import numpy as np

# Ensure worker directory is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from model_loader import ensure_models_downloaded, DETECTOR_INFO, EMBEDDER_INFO
from detector import FaceDetector
from quality import QualityChecker
from embedder import FaceEmbedder

def log_event(event_type, **kwargs):
    payload = {"type": event_type, "timestamp": time.time(), **kwargs}
    sys.stderr.write(json.dumps(payload) + "\n")
    sys.stderr.flush()

def send_response(data: dict):
    sys.stdout.write(json.dumps(data) + "\n")
    sys.stdout.flush()

def main():
    parser = argparse.ArgumentParser(description="PRAVAHAx Face Biometric Worker")
    parser.add_argument("--mock", action="store_true", help="Run in synthetic mock mode for tests without models")
    args = parser.parse_args()

    detector = None
    embedder = None
    quality_checker = QualityChecker()
    is_mock = args.mock

    if not is_mock:
        try:
            import cv2
            yunet_path, sface_path = ensure_models_downloaded()
            detector = FaceDetector(yunet_path)
            embedder = FaceEmbedder(sface_path)
            log_event("ready", mode="real", detector=DETECTOR_INFO["name"], embedder=EMBEDDER_INFO["name"])
        except Exception as e:
            log_event("error", error="INIT_FAILED", message=str(e), trace=traceback.format_exc())
            # If real initialization fails, fallback to mock to allow process to stay alive
            is_mock = True

    if is_mock:
        log_event("ready", mode="mock")

    # Notify ready on stdout as well
    send_response({
        "event": "started",
        "mock": is_mock,
        "detectorLoaded": not is_mock and detector is not None,
        "embedderLoaded": not is_mock and embedder is not None
    })

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd_data = json.loads(line)
        except json.JSONDecodeError as e:
            send_response({"success": False, "error": "INVALID_JSON", "message": str(e)})
            continue

        command = cmd_data.get("command")

        if command == "ping":
            send_response({"success": True, "pong": True, "time": time.time()})

        elif command == "health":
            send_response({
                "success": True,
                "status": "UP",
                "workerReady": True,
                "mock": is_mock,
                "detectorLoaded": not is_mock and detector is not None,
                "embedderLoaded": not is_mock and embedder is not None,
                "detectorName": DETECTOR_INFO["name"],
                "detectorVersion": DETECTOR_INFO["version"],
                "modelName": EMBEDDER_INFO["name"],
                "modelVersion": EMBEDDER_INFO["version"],
                "embeddingDimension": EMBEDDER_INFO["embedding_dimension"],
                "runtime": EMBEDDER_INFO["runtime"],
                "license": EMBEDDER_INFO["license"]
            })

        elif command == "process_frame":
            # Image can be passed as base64 string
            b64_data = cmd_data.get("image_base64")
            if not b64_data:
                send_response({"success": False, "error": "MISSING_IMAGE", "message": "image_base64 is required"})
                continue

            # Strip data URI header if present
            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]

            try:
                mock_override = cmd_data.get("mock_override")
                if mock_override:
                    # Direct test injection
                    send_response({
                        "success": True,
                        "quality": mock_override.get("quality"),
                        "embedding": mock_override.get("embedding")
                    })
                    continue

                if is_mock:

                    # Generate deterministic synthetic sample for mock mode
                    send_response({
                        "success": True,
                        "quality": {
                            "is_valid": True,
                            "rejection_reason": None,
                            "message": "Good quality face sample detected (mock)",
                            "face_count": 1,
                            "metrics": {
                                "face_count": 1,
                                "confidence": 0.95,
                                "blur_score": 120.0,
                                "brightness": 128.0,
                                "bbox": {"x": 200, "y": 140, "width": 240, "height": 260},
                                "frame_width": 640,
                                "frame_height": 480
                            }
                        },
                        "embedding": [round(float(np.sin(i + 0.1)), 6) for i in range(128)]
                    })
                    continue

                try:
                    img_bytes = base64.b64decode(b64_data)
                except Exception as decode_err:
                    send_response({
                        "success": False,
                        "error": "DECODE_FAILED",
                        "quality": {
                            "is_valid": False,
                            "rejection_reason": "NO_FACE",
                            "message": f"Failed to decode base64 image: {str(decode_err)}",
                            "face_count": 0,
                            "metrics": None
                        },
                        "embedding": None
                    })
                    continue

                import cv2
                np_arr = np.frombuffer(img_bytes, np.uint8)
                img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

                if img is None:
                    send_response({
                        "success": False,
                        "error": "DECODE_FAILED",
                        "quality": {
                            "is_valid": False,
                            "rejection_reason": "NO_FACE",
                            "message": "Failed to decode image frame",
                            "face_count": 0,
                            "metrics": None
                        },
                        "embedding": None
                    })
                    continue

                # Run detector
                faces = detector.detect(img)
                quality_res = quality_checker.evaluate(img, faces)

                embedding = None
                if quality_res["is_valid"] and len(faces) == 1:
                    raw_face = faces[0]["raw_face"]
                    feat = embedder.align_and_extract(img, raw_face)
                    embedding = [round(float(x), 6) for x in feat.tolist()]

                # Clear frame from memory immediately
                del img
                del np_arr

                send_response({
                    "success": True,
                    "quality": quality_res,
                    "embedding": embedding
                })

            except Exception as e:
                send_response({
                    "success": False,
                    "error": "PROCESSING_ERROR",
                    "message": str(e),
                    "trace": traceback.format_exc()
                })

        elif command == "aggregate_embeddings":
            embeddings = cmd_data.get("embeddings", [])
            if is_mock or embedder is None:
                # Mock aggregation
                if not embeddings:
                    send_response({"success": False, "error": "NO_EMBEDDINGS"})
                else:
                    arr = np.array(embeddings, dtype=np.float32)
                    mean_v = np.mean(arr, axis=0)
                    norm = np.linalg.norm(mean_v)
                    if norm > 1e-6:
                        mean_v = mean_v / norm
                    send_response({
                        "success": True,
                        "template": [round(float(x), 6) for x in mean_v.tolist()],
                        "samples_count": len(embeddings),
                        "consistency_score": 0.98,
                        "outliers_rejected": 0
                    })
            else:
                agg_res = embedder.aggregate_samples(embeddings)
                send_response(agg_res)

        elif command == "stop":
            send_response({"success": True, "event": "stopping"})
            break

        else:
            send_response({"success": False, "error": "UNKNOWN_COMMAND", "command": command})

    log_event("stopped")

if __name__ == "__main__":
    main()
